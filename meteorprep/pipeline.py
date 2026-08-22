"""Deterministic, resumable pipeline orchestrator (§1.2).

Every mechanical/geometric step is automated; every aesthetic decision is
surfaced as a PSD layer toggle and never baked in (§8).

Disk strategy: the *search* for meteors runs on half-size decodes and
caches only small binned luminance images; only the handful of frames that
turned out to contain a meteor are ever reprojected at full quality, and
that happens on demand at the end.

The clean starfield is built in two streaming passes over the night — one
to measure each pixel's mean and spread, one to average what falls inside
the clip bounds — so no pass ever holds more than a band of one frame.
The passes exchange per-worker moment arrays through the scratch folder;
everything else lives in shared memory and is freed as it is merged.
"""

from __future__ import annotations

import logging
import os
from datetime import timezone
from pathlib import Path

import numpy as np

from meteorprep.assemble.contact_sheet import make_contact_sheet
from meteorprep.assemble.layers import (Layer, LayerGroup, LayerStack,
                                        candidate_flag, meteor_layer_name)
from meteorprep.assemble.pngjsx import write_pngjsx
from meteorprep.assemble.psd import write_psd
from meteorprep.astrometry.lensdistort import Poly3Distortion, lookup_lensfun_k1
from meteorprep.astrometry.pole import pole_pixel_xy
from meteorprep.astrometry.reproject_frames import reproject_frame
from meteorprep.astrometry.solve import (build_tan_wcs, detect_stars,
                                         propagate_wcs, refine_wcs,
                                         solve_frame, solve_rms_px)
from meteorprep.cache.store import CacheStore
from meteorprep.config import SIDEREAL_DEG_PER_SEC, Config
from meteorprep.detect.classify import classify
from meteorprep.detect.diff import difference
from meteorprep.detect.hough import _line_profile, detect_streaks
from meteorprep.detect.radiant import radiant_at_epoch
from meteorprep.detect.reference import RunningReference
from meteorprep.detect.track import build_tracks
from meteorprep.ingest import raw as raw_mod
from meteorprep.ingest.exif import read_metadata, scan_input_dir
from meteorprep.ingest.lightpaint import flag_lightpainted, ground_luminance
from meteorprep.ingest.segment_folder import segment_folder
from meteorprep.mask.extract import extract_meteor
from meteorprep.report.sidecar import write_sidecar
from meteorprep.segment.sky_ground import segment_sky
from meteorprep.stack.startrail import lighten_stack
from meteorprep.stack.streaming import frame_noise_weights

log = logging.getLogger("meteorprep")


def _wcs_to_str(wcs) -> str:
    return wcs.to_header(relax=True).tostring(sep="\n")


def _wcs_from_str(s: str):
    from astropy.io import fits
    from astropy.wcs import WCS
    return WCS(fits.Header.fromstring(s, sep="\n"))


def scale_wcs(wcs, s: float):
    """The same sky mapping expressed for an image resampled by factor s
    (s=2: detection-space WCS -> full-resolution WCS).  SIP terms are in
    pixel units and cannot be carried across a resolution change, so they
    are dropped: lens distortion is pre-corrected analytically (§4.2) and
    the scaled WCS is pure TAN."""
    # build fresh: header round-trips store the linear part as PC+CDELT,
    # fits as CD — pixel_scale_matrix reads both, and a clean CD-only TAN
    # keeps every consumer (including the closed-form remapper) on the
    # same convention
    from astropy.wcs import WCS as _WCS
    out = _WCS(naxis=2)
    out.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    out.wcs.crval = [float(wcs.wcs.crval[0]), float(wcs.wcs.crval[1])]
    out.wcs.cd = np.asarray(wcs.pixel_scale_matrix, dtype=float) / s
    out.wcs.crpix = [s * (wcs.wcs.crpix[0] - 0.5) + 0.5,
                     s * (wcs.wcs.crpix[1] - 0.5) + 0.5]
    return out


# ----------------------------------------------------------------------
# process-pool workers (top-level: picklable, spawn-safe)
# ----------------------------------------------------------------------

def _save_npy_atomic(path, arr) -> None:
    """Write a .npy through a temporary and rename it into place.

    Three fallback paths in this file re-run work on ONE core after a
    worker pool dies, and shutting a pool down cancels only the tasks
    still queued — a worker already inside its chunk keeps running, and
    keeps writing.  So the parent and a survivor can be saving the same
    file at the same moment.  A rename is atomic, so a reader sees one
    complete version or the other, never half of each.  (The temporary
    keeps the .npy suffix: np.save appends one to any name that lacks it.)
    """
    import numpy as _np
    path = Path(path)
    tmp = path.with_suffix(f".{os.getpid()}.tmp.npy")
    _np.save(tmp, arr)
    os.replace(tmp, path)


def _detect_reproject_one(args) -> int:
    """Align one frame's cached half-size luminance onto the base grid and
    store it + its footprint (small: ~12 MB per 20 MP frame)."""
    (i, path, src_wcs_str, det_wcs_str, shape_hw, det_dir_str,
     bad_pixels, k1, lum_path) = args
    import numpy as _np
    from meteorprep.astrometry.lensdistort import Poly3Distortion as _P3
    from meteorprep.astrometry.reproject_frames import reproject_frame as _rp
    from meteorprep.ingest import raw as _raw

    det_dir = Path(det_dir_str)
    if lum_path and Path(lum_path).exists():
        lum = _np.load(lum_path).astype(_np.float32)
    else:
        rgb = _raw.decode(Path(path), "detect", bad_pixels, half_size=True)
        lum = _raw.luminance(rgb)
    distort = (_P3(k1, lum.shape[:2]).distort if abs(k1) > 1e-9 else None)
    arr, foot = _rp(lum, _wcs_from_str(src_wcs_str),
                    _wcs_from_str(det_wcs_str), tuple(shape_hw),
                    quality=False, distort=distort)
    _save_npy_atomic(det_dir / f"lum_{i:04d}.npy",
                     _np.clip(arr, 0, 65535).astype(_np.uint16))
    _save_npy_atomic(det_dir / f"foot_{i:04d}.npy", foot.astype(_np.uint8))
    return i


def _det_lum_one(args) -> str:
    """Decode one frame at half size and store its luminance — done ONCE
    per frame per run; ranking, star-lock verification and alignment all
    read this cache instead of re-decoding the RAW (3x decode saved)."""
    (path, out_path, bad_pixels) = args
    import numpy as _np
    from meteorprep.ingest import raw as _raw
    rgb = _raw.decode(Path(path), "detect", bad_pixels, half_size=True)
    lum = _raw.luminance(rgb)
    tmp = out_path + ".part"
    _np.save(tmp, _np.clip(lum, 0, 65535).astype(_np.uint16))
    Path(tmp + ".npy").rename(out_path)
    return out_path


def _streak_search_chunk(args) -> list:
    """Search a chunk of frames for streaks against the rolling reference.
    Runs in a worker: aligned luminances are memory-mapped from the cache."""
    (indices, n, det_dir_str, sky_path, cfg, S, exclude, diff_dir_str,
     prog_path) = args
    import numpy as _np
    from meteorprep.detect.hough import detect_streaks
    from meteorprep.detect.reference import RunningReference
    from meteorprep.fastmath import mad_sigma as _mad_sigma

    det_dir = Path(det_dir_str)
    diff_dir = Path(diff_dir_str)

    class _L:
        """Loader with a small LRU: consecutive frames share 6 of their 7
        window neighbours, so caching kills ~85% of the load+convert cost
        (a dozen half-size frames is ~250 MB, fine for one worker)."""
        def __init__(self, pattern, cap=12, dtype=_np.float32):
            self._p = pattern
            self._cap = cap
            self._dt = dtype                  # foots stay uint8: 4x less RAM
            self._c: dict = {}
        def __getitem__(self, i):
            a = self._c.pop(i, None)
            if a is None:
                a = _np.load(det_dir / (self._p % i),
                             mmap_mode="r").astype(self._dt)
            self._c[i] = a                    # re-insert = most recent
            while len(self._c) > self._cap:
                self._c.pop(next(iter(self._c)))
            return a
        def __len__(self):
            return n

    lums = _L("lum_%04d.npy")
    foots = _L("foot_%04d.npy", dtype=_np.uint8)
    sky_bin = (_np.load(sky_path) >= 0.5) if sky_path else None
    ref = RunningReference(lums, cfg.ref_window, cfg.ref_sigma,
                           exclude=set(exclude), footprints=foots)
    out = []
    for k, i in enumerate(indices):
        if prog_path:                       # live per-photo progress
            try:
                Path(prog_path).write_text(str(k))
            except OSError:
                pass
        # The noise figure has to be measured on the UNCLIPPED residual.
        # difference() throws the negatives away, so on any frame whose
        # sky sits at or below its own rolling-median reference more than
        # half the sky pixels are exactly zero: the median is 0, the
        # median absolute deviation is 0, and the "robust sigma" comes
        # back as the floor.  Inverse-variance weighting then handed
        # those frames a million times the weight of the rest, and the
        # stack ended up weighted 10:1 by which way the sky happened to
        # drift that minute rather than by how noisy each photo was.  The
        # MAD does not care about an offset, so measuring before the clip
        # drops the drift and leaves the noise.
        foot_i = foots[i]
        d = (lums[i].astype(_np.float32)
             - ref.for_frame(i).astype(_np.float32))
        m = foot_i != 0
        if sky_bin is not None:
            m &= sky_bin
        noise = 0.0                       # 0.0 means "could not measure"
        if int(m.sum()) >= 1000:
            _, noise = _mad_sigma(d[m], floor=0.0)
            # What that measured is the photo's noise AND the reference's,
            # added in quadrature.  The reference is a median of the
            # neighbouring photos, and there are fewer neighbours at the
            # two ends of a night, so without dividing this out the first
            # and last photos measure noisier than they are and get
            # weighted down for being at the edge of the sequence.
            noise = float(noise) / ref.noise_inflation(i)
            if not _np.isfinite(noise):
                noise = 0.0
        del m
        _np.clip(d, 0, None, out=d)
        d[foot_i == 0] = 0.0
        if sky_bin is not None:
            d = d * sky_bin
        # Subtract everything smoother than a streak.  The reference
        # cancels the stars but not a sky that is brightening (dawn, a
        # rising moon, thin cloud drifting through), and that residual
        # wash is what forced the detection threshold up to a level where
        # short faint meteors were missed.  Measured on a real night: at
        # the same threshold this cuts spurious detections in half while
        # keeping every real streak.
        if cfg.detect_highpass_sigma > 0:
            import cv2 as _cv2h
            d = d - _cv2h.GaussianBlur(d, (0, 0),
                                       float(cfg.detect_highpass_sigma))
            _np.clip(d, 0, None, out=d)
            if sky_bin is not None:
                d *= sky_bin
        streaks = detect_streaks(d, i, cfg, rgb_diff=None, bin_factor=S,
                                 min_thresh=cfg.detect_min_thresh)
        diff_path = ""
        if streaks:
            diff_path = str(diff_dir / f"diff_{i:04d}.npy")
            _save_npy_atomic(diff_path,
                             _np.clip(d, 0, 65535).astype(_np.uint16))
        out.append((i, streaks, noise, diff_path))
    return out


def _paint_segments(mask: np.ndarray, segments) -> None:
    """Paint streak corridors (tiny endpoint lists, not stored bitmaps)."""
    import cv2
    for (x0, y0, x1, y1, half_width) in segments:
        cv2.line(mask, (int(round(x0)), int(round(y0))),
                 (int(round(x1)), int(round(y1))), 1,
                 thickness=max(int(2 * half_width), 3))


_DISK_FULL_MSG = (
    "Your disk is full — METEORPREP ran out of space for its working "
    "files. Free up several GB (empty the Trash, delete old *_meteorprep "
    "folders), then press Find my meteors again, leaving 'Start over' "
    "unticked — it will pick up where it stopped rather than beginning "
    "again.")


# zlib's cheapest setting.  On smooth 16-bit sky data level 1 lands
# within 4% of the default's file size (73.0 MB vs 75.7 MB measured on a
# 20 MP frame) for a fifth of the time (6.2s -> 1.2s), and the file is
# ordinary zlib-compressed TIFF either way.
_TIF_LEVEL = 1


def _write_cache_tif(path, arr_u16, compress: bool = True) -> None:
    """Write one of the big cache images as fast as zlib allows.

    ``compress=False`` for images that only ever live in the scratch
    cache: even at level 1, zlib costs about a second per 20 MP image and
    saves 45 MB, and the scratch directory is measured in gigabytes.  The
    files a person keeps are still compressed.
    """
    import tifffile
    if not compress:
        tifffile.imwrite(path, arr_u16)
        return
    try:
        tifffile.imwrite(path, arr_u16, compression="zlib",
                         compressionargs={"level": _TIF_LEVEL})
    except TypeError:              # very old tifffile: no compressionargs
        tifffile.imwrite(path, arr_u16, compression="zlib")


def _disk_full(exc) -> bool:
    """True when an exception chain smells like an out-of-space write.
    numpy's tofile raises a bare OSError('N requested and M written')
    with no errno, so the string is checked too."""
    import errno
    seen, hops = exc, 0
    while seen is not None and hops < 8:
        if isinstance(seen, OSError) and seen.errno in (
                errno.ENOSPC, getattr(errno, "EDQUOT", errno.ENOSPC)):
            return True
        s = str(seen)
        if "requested and" in s and "written" in s:
            return True
        seen = seen.__cause__ or seen.__context__
        hops += 1
    return False


# row band for the clip-and-accumulate inner loop: big enough that the
# per-call overhead disappears, small enough that its temporaries stay in
# cache instead of streaming a quarter-gigabyte through memory
# Row band for the stack's clip-and-accumulate (and for the finalise).
# The loop touches eight 20 MP-shaped arrays per band, so the band height
# decides whether that working set stays in cache: measured on a 20 MP
# frame with three workers running at once, 512 rows cost 1.05s a frame,
# 128 rows 0.60s and 64 rows 0.54s — the arithmetic never changed, only
# how far the data had to travel.
# One spawn pool per worker count, reused for the whole run.  Spawning a
# worker costs about a second and a half — it re-imports numpy, OpenCV and
# LibRaw before it can touch a photo — and a run used to pay that four
# times over, once per parallel stage.
_POOLS: dict = {}


def _shared_pool(n_workers: int, exclusive: bool = False):
    """The run's pool for this worker count, started on first use.

    ``exclusive``: close every pool of a different size first.  The stack
    asks for this — its workers are the memory-hungry ones, and idle
    workers left over from the search would be holding a few hundred
    megabytes each on a machine that is about to need all of it.
    """
    n = max(int(n_workers), 1)
    if exclusive:
        for other in [k for k in _POOLS if k != n]:
            _drop_shared_pool(other)
    pool = _POOLS.get(n)
    if pool is None:
        import multiprocessing as _mp
        from concurrent.futures import ProcessPoolExecutor
        # spawn (not fork): forking a process that already ran threaded
        # numeric code can deadlock the children on Linux; macOS spawns
        # by default anyway
        pool = ProcessPoolExecutor(max_workers=n,
                                   mp_context=_mp.get_context("spawn"))
        _POOLS[n] = pool
    return pool


def _drop_shared_pool(n_workers: int) -> None:
    """Discard a pool — after a failure, or to free its workers."""
    pool = _POOLS.pop(max(int(n_workers), 1), None)
    if pool is not None:
        try:
            pool.shutdown(wait=False, cancel_futures=True)
        except Exception:
            pass


def _close_shared_pools() -> None:
    for n in list(_POOLS):
        _drop_shared_pool(n)


def _stopwatch():
    """Returns a tick(label) that logs elapsed time when METEORPREP_PROF
    is set, and does nothing otherwise."""
    import os
    import time as _t
    if not os.environ.get("METEORPREP_PROF"):
        return lambda label: None
    last = [_t.perf_counter()]

    def tick(label):
        now = _t.perf_counter()
        log.info("PROF-STAGE %-28s %6.2fs", label, now - last[0])
        last[0] = now
    return tick


_CLIP_BAND = 64
# The frozen-ground sum and the star-trail maximum read the same decoded
# frame; a band of it feeds both while it is still in cache.
_FG_BAND = 256
# The worker id the one-core retry runs under.  Deliberately not 0: a
# worker from the attempt that just failed may still be alive and still
# writing into block 0's shared segment and into csum_0.npy, and the
# retry must not share either with it.
_RETRY_WID = -1
# How the per-photo noise in cache/frame_noise.json was measured.  Bump it
# whenever that changes: the detect stage hash covers configuration, not
# the program, so a folder cached by an older build resumes into a newer
# one and the numbers have to be able to say they are not comparable.
_NOISE_ESTIMATOR = "unclipped-residual-v2"



class _SharedAccums:
    """One worker's big accumulators, shared with the parent.

    Each worker used to np.save ~0.6 GB of sums for the parent to np.load
    straight back — 2 GB of round-trip per run that never needed to
    exist.  Shared memory is the same bytes on both sides: the worker
    writes into it, the parent adds from it, and nothing is serialised.

    POSIX shared memory first, a file mapping in the scratch directory
    as the fallback.  Both work; the difference is that a file mapping's
    dirty pages get written back to the disk, and the stack rewrites
    every byte of these blocks once per photo, so the kernel ends up
    pushing gigabytes to the SSD that nothing will ever read.  (POSIX
    shared memory was tried once before and reverted: attaching in a
    child registers the segment with the resource tracker a second time,
    and the cleanup printed a KeyError traceback per block into the
    user's run log.  The child now says up front that it does not own
    the segment, which is what that needed.)
    """

    KEYS = (("csum", 3, "<f4"), ("cwsum", 3, "<f4"),
            ("fcount", 0, "<u2"), ("rcount", 0, "<u2"))

    def __init__(self, shape_hw, tmp_dir, worker_id):
        self.arrays, self.spec, self._paths, self._blocks = {}, {}, [], []
        try:
            self._build(shape_hw, tmp_dir, worker_id)
        except BaseException:
            # half a gigabyte of POSIX shared memory does not go away by
            # itself: whatever was allocated before the failure has to be
            # unlinked here, because the caller only ever sees the raise
            self.close()
            raise

    def _build(self, shape_hw, tmp_dir, worker_id):
        h, w = shape_hw
        for name, nch, dt in self.KEYS:
            shape = (h, w, nch) if nch else (h, w)
            nbytes = int(np.prod(shape)) * np.dtype(dt).itemsize
            blk = None
            try:
                from multiprocessing import shared_memory
                blk = shared_memory.SharedMemory(create=True, size=nbytes)
                # a fresh segment is zero-filled by the kernel
                self.arrays[name] = np.ndarray(shape, dtype=dt,
                                               buffer=blk.buf)
                self.spec[name] = ("shm", blk.name, list(shape), dt)
                self._blocks.append(blk)
                continue
            except Exception:
                if blk is not None:
                    try:
                        blk.close()
                        blk.unlink()
                    except Exception:
                        pass
            path = Path(tmp_dir) / f"shm_{name}_{worker_id}.dat"
            # mode "w+" makes a sparse file that reads back as zeros;
            # writing the zeros explicitly would push 1.6 GB (four blocks
            # x three workers at 20 MP) through the disk between the two
            # passes, for pages most frames never touch anyway
            self.arrays[name] = np.memmap(path, dtype=dt, mode="w+",
                                          shape=shape)
            self.spec[name] = ("map", str(path), list(shape), dt)
            self._paths.append(path)

    def close(self):
        self.arrays.clear()
        for blk in self._blocks:
            try:
                blk.close()
                blk.unlink()
            except Exception:
                pass
        self._blocks.clear()
        for path in self._paths:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        self._paths.clear()


def _dont_track_shm() -> None:
    """Before 3.13 there is no ``track=False``: a child that attaches to
    a segment registers it with the resource tracker as if it owned it.
    Unregistering afterwards is worse than not registering — the tracker
    keeps one set of names, so the child's unregister removes the
    parent's entry and the parent's own unlink then fails with a
    KeyError traceback in the run log.  Decline the registration
    instead; the parent still owns, and still unlinks, every segment.
    """
    import multiprocessing as _mp
    from multiprocessing import resource_tracker
    if _mp.parent_process() is None:
        return          # the parent owns these segments and must unlink
    if getattr(resource_tracker.register, "_meteorprep", False):
        return
    _orig = resource_tracker.register

    def register(name, rtype):
        if rtype == "shared_memory":
            return
        _orig(name, rtype)

    register._meteorprep = True
    resource_tracker.register = register


def _attach_shared(spec):
    """Worker side: attach the parent's blocks and view them as arrays.

    A segment attached here belongs to the parent.  Saying so — via
    ``track=False`` where the interpreter offers it, or by declining to
    register at all — is what keeps the resource tracker from trying to
    clean up a segment it does not own.
    """
    import numpy as _np
    arrays, blocks = {}, []
    for name, ent in spec.items():
        kind, where, shape, dt = ent
        if kind == "shm":
            from multiprocessing import shared_memory
            try:
                blk = shared_memory.SharedMemory(name=where, track=False)
            except TypeError:          # before 3.13: say it up front
                _dont_track_shm()
                blk = shared_memory.SharedMemory(name=where)
            arrays[name] = _np.ndarray(tuple(shape), dtype=dt,
                                       buffer=blk.buf)
            blocks.append(blk)
        else:
            arrays[name] = _np.memmap(where, dtype=dt, mode="r+",
                                      shape=tuple(shape))
    return arrays, blocks


def _release_shared(arrays, blocks):
    """Detach.  Shared memory is coherent between processes, so there is
    nothing to flush and nothing to hand back — the parent already has
    every byte the worker wrote.  The array views have to go before the
    blocks, or the buffer is still exported and will not close."""
    arrays.clear()
    for blk in blocks:
        try:
            blk.close()
        except Exception:
            pass
    blocks.clear()


def _stack_pass(args) -> dict:
    """One streaming pass over a subset of frames.

    mode "moments": accumulate Welford per-pixel moments (mean/M2/count) for
    the sigma-clip bounds, and optionally an *unaligned* foreground sum (the
    ground is static on a fixed tripod, so the frozen-ground stack costs no
    extra decodes).  mode "clipped": accumulate the frame-weighted mean of
    samples within sigma of the pass-1 mean.

    Returns a dict of .npy paths for whatever this worker accumulated,
    except when the parent handed it shared-memory accumulators to add
    into directly, in which case there is nothing to hand back but
    ``{"shared": True}``.  Memory-conscious (float32, in place);
    unreadable frames are skipped rather than failing the night.
    """
    (mode, indices, paths, wcs_strs, base_wcs_str, shape_hw,
     segments_per_frame, frame_weights, tmp_dir_str, worker_id, half_size,
     bad_pixels, sigma, want_fg, want_trail, k1, sky_path,
     shared_spec, cv_threads) = args
    import json as _json

    import cv2 as _cv2
    import numpy as _np
    from meteorprep.astrometry.lensdistort import Poly3Distortion as _P3
    from meteorprep.astrometry.reproject_frames import (
        plain_tan_pair as _tan_pair, reproject_frame as _rp)
    from meteorprep.astrometry.tanmap import (
        footprint_from_maps as _foot_from_maps, remap_band as _rb,
        tan_to_tan_maps as _tan_maps)
    from meteorprep.ingest import raw as _raw
    from meteorprep.stack.gradient import eval_frame_sky, fit_frame_sky
    from meteorprep.stack.streaming import RunningMoments

    h, w = shape_hw
    # This function runs in a spawned worker normally, and IN THE PARENT
    # on the one-core fallback.  Everything below that changes state for
    # a whole process — the OpenCV thread count, the resource tracker —
    # is therefore conditional: doing it in the parent left every later
    # stage of the run single-threaded, and broke the parent's own
    # shared-memory bookkeeping.
    import multiprocessing as _mp_ctx
    in_child = _mp_ctx.parent_process() is not None
    if in_child:
        # OpenCV threads every elementwise op it runs.  With one worker
        # that is free speed; with four workers on four cores it is four
        # processes each asking for four threads, and they spend the
        # difference fighting over cache.  The parent decides the split.
        try:
            _cv2.setNumThreads(int(cv_threads))
        except Exception:
            pass
    tmp = Path(tmp_dir_str)
    base_wcs = _wcs_from_str(base_wcs_str)
    bgs = {}
    sky_half = None
    # only the statistics pass fits a per-frame sky surface, and only it
    # needs the mask; the full-resolution pass was loading and later
    # upsampling 20 MB per worker that nothing read
    if sky_path and mode == "moments":
        sky_half = _np.load(sky_path)         # detection-scale sky mask
    if mode == "moments":
        # statistics pass at half resolution: the clip bounds don't need
        # 20 MP, and the half-size decode + resample is ~4x cheaper
        hs, ws = h // 2, w // 2
        stat_wcs = scale_wcs(base_wcs, 0.5)
        mom = RunningMoments((hs, ws, 3))
        scratch = _np.zeros((h, w), _np.uint8)
        norm_coef: dict = {}
    else:
        hs, ws = h, w
        stat_wcs = base_wcs
        clip_mean = _np.load(tmp / "clip_mean.npy")
        clip_bound = _np.load(tmp / "clip_bound.npy")
        # The clip statistics are measured at half resolution and were
        # then blown up to the full canvas and held there — half a
        # gigabyte per worker, a quarter of its whole footprint, to store
        # numbers that carry no detail above half resolution.  When the
        # canvas is exactly twice the statistics (the normal case) each
        # band is upsampled as it is used instead, which is the same
        # bilinear result to the last bit for a fortieth of the memory.
        clip_half = (clip_mean.shape[:2] != (h, w)
                     and clip_mean.shape[0] * 2 == h
                     and clip_mean.shape[1] * 2 == w)
        if clip_mean.shape[:2] != (h, w) and not clip_half:
            clip_mean = _cv2.resize(clip_mean, (w, h),
                                    interpolation=_cv2.INTER_LINEAR)
            clip_bound = _cv2.resize(clip_bound, (w, h),
                                     interpolation=_cv2.INTER_LINEAR)

        def _clip_rows(arr_half, r0, r1):
            """Rows [r0, r1) of the full-resolution upsample, built from
            just the half-resolution rows that feed them."""
            hh = arr_half.shape[0]
            s0 = max((r0 // 2) - 1, 0)
            s1 = min(((r1 - 1) // 2) + 2, hh)
            blk = _cv2.resize(arr_half[s0:s1], (w, (s1 - s0) * 2),
                              interpolation=_cv2.INTER_LINEAR)
            off = r0 - s0 * 2
            return blk[off:off + (r1 - r0)]
        try:
            norm_coef = {int(k): _np.asarray(v, _np.float32) for k, v in
                         _json.loads((tmp / "norm_coef.json")
                                     .read_text()).items()}
        except (OSError, ValueError):
            norm_coef = {}
        shm_arrays, shm_blocks = ({}, [])
        if shared_spec:
            try:
                shm_arrays, shm_blocks = _attach_shared(shared_spec)
            except Exception as exc:   # fall back to private arrays + files
                log.warning("could not attach the shared accumulators "
                            "(%s); using this worker's own memory", exc)
                shm_arrays, shm_blocks = {}, []
                shared_spec = None
        ssum = shm_arrays.get("csum")
        if ssum is None:
            ssum = _np.zeros((h, w, 3), _np.float32)
        wsum = shm_arrays.get("cwsum")
        if wsum is None:
            wsum = _np.zeros((h, w, 3), _np.float32)
        fcount = shm_arrays.get("fcount")     # coverage for the crop
        if fcount is None:
            fcount = _np.zeros((h, w), _np.uint16)
        # per-pixel count of samples the sigma clip threw away — the
        # meteors, planes, satellites, cosmic rays and wind-shaken twigs
        # that never reached the clean starfield.  Shipped as evidence:
        # "show me what you removed" should be answerable with a file,
        # not a claim.
        rcount = shm_arrays.get("rcount")
        if rcount is None:
            rcount = _np.zeros((h, w), _np.uint16)
        # Buffers the resample needs for every frame, allocated once.
        # They were being created and thrown away per frame — 650 MB of
        # allocator and page-fault churn each time round, which in a
        # worker that already holds two gigabytes cost more than the
        # arithmetic did.
        map_buf = (_np.empty((h, w), _np.float32),
                   _np.empty((h, w), _np.float32))
        foot_buf = _np.empty((h, w), _np.uint8)
        # one band of the resampled frame, raw and developed.  The whole
        # frame used to be built at 20 MP and then read back a band at a
        # time; a band is 4 MB and never leaves cache.
        band_u16 = _np.empty((_CLIP_BAND, w, 3), _np.uint16)
        band_f32 = _np.empty((_CLIP_BAND, w, 3), _np.float32)
        band_sky_buf = _np.empty((_CLIP_BAND, w, 3), _np.float32)
        out_buf = None            # only the whole-frame fallback needs it
        src_buf = None            # camera-sized; made on the first decode
        fg_sum = None      # allocated at camera size on the first decode
        fg_n = 0
        trail_max = None   # camera-space lighten-max (free star trails)
        scratch = _np.zeros((h, w), _np.uint8)
    if sky_half is not None and sky_half.shape[:2] != (hs, ws):
        sky_half = _cv2.resize(sky_half, (ws, hs),
                               interpolation=_cv2.INTER_LINEAR)

    def _frame_background(a, okm):
        """Per-channel sky level (Siril-style normalisation): 20th
        percentile of a subsample of covered pixels."""
        step = max(okm.shape[0] // 256, 1)
        sub = a[::step, ::step]
        oksub = okm[::step, ::step]
        if oksub.sum() < 32:
            return _np.zeros(3, _np.float32)
        return _np.percentile(sub[oksub], 20, axis=0).astype(_np.float32)

    stats_extra_half = (mode == "moments" and not half_size)

    # prefetch: LibRaw decoding releases the GIL, so a producer thread
    # develops frame N+1 while the main thread aligns/accumulates frame N
    # — the stage's wall time drops to max(decode, math) instead of their
    # sum.  Queue depth 1 caps extra memory at one frame.
    from queue import Queue
    from threading import Thread
    # depth 1 at full resolution (a frame in the queue is 120 MB); at
    # half size the maths finishes as fast as LibRaw does, so one more
    # frame in hand — 30 MB — keeps the decoder from becoming the wall
    _q: Queue = Queue(maxsize=2 if half_size else 1)

    def _producer():
        for i_, path_, wstr_ in zip(indices, paths, wcs_strs):
            try:
                rgb_ = _raw.decode(Path(path_), "final", bad_pixels,
                                   half_size=(half_size
                                              or mode == "moments"))
            except Exception as exc_:
                log.warning("skipping unreadable frame %s in the stack: %s",
                            Path(path_).name, exc_)
                continue
            _q.put((i_, wstr_, rgb_))
        _q.put(None)

    Thread(target=_producer, daemon=True).start()
    n_done = 0
    import os as _os_prof
    import time as _tprof
    _prof = {} if _os_prof.environ.get("METEORPREP_PROF") else None

    def _tick(key, t0):
        if _prof is not None:
            _prof[key] = _prof.get(key, 0.0) + _tprof.perf_counter() - t0
        return _tprof.perf_counter()

    while True:
        _t = _tprof.perf_counter()
        item = _q.get()
        _t = _tick("wait_decode", _t)
        if item is None:
            break
        i, wstr, rgb = item
        try:                                # live per-photo progress
            (tmp / f"prog_{mode}_{worker_id}.txt").write_text(str(n_done))
        except OSError:
            pass
        n_done += 1
        if mode != "moments" and (want_fg or want_trail):
            if want_fg and fg_sum is None:
                # deliberately NOT one of the shared mappings: this one is
                # read-modify-written over its whole extent every frame,
                # and backing that with a file makes the kernel write the
                # dirty pages back again and again — measured at 64.4s
                # against 54.9s for the same night.
                fg_sum = _np.zeros(rgb.shape, _np.float32)
            # The frozen-ground sum was the most expensive thing in the
            # whole pass — not the decode, not the resample.  "fg_sum +=
            # rgb.astype(float32)" builds a 242 MB temporary per frame,
            # and under this worker's memory pressure that cost 2.4s of
            # the 7s each frame took.  cv2.accumulate adds a uint16 image
            # into a float32 one directly, with no temporary at all.
            if want_trail and trail_max is None:
                trail_max = _np.zeros(rgb.shape, _np.uint16)
            # both walk the same undeveloped frame, so they walk it
            # together: one band of the decode feeds the running sum and
            # the running maximum while it is still in cache
            for r0 in range(0, rgb.shape[0], _FG_BAND):
                r1 = min(r0 + _FG_BAND, rgb.shape[0])
                blk = rgb[r0:r1]
                if want_fg:
                    _cv2.accumulate(blk, fg_sum[r0:r1])
                if want_trail:
                    _cv2.max(trail_max[r0:r1], blk, dst=trail_max[r0:r1])
            fg_n += 1 if want_fg else 0
        _t = _tick("fg_trail", _t)
        distort = (_P3(k1, rgb.shape[:2]).distort if abs(k1) > 1e-9
                   else None)
        src_wcs = _wcs_from_str(wstr)
        if stats_extra_half:
            # frames were decoded at half size for the stats pass, but the
            # supplied WCS describes the full-size frame — rescale it or
            # the resample reads only the top-left quarter of the data
            src_wcs = scale_wcs(src_wcs, 0.5)
        # The full-resolution pass resamples band by band inside the
        # accumulate loop below (arr stays None): only the maps and the
        # footprint are built whole-frame, and the frame itself is never
        # assembled at 20 MP.  Anything that is not a plain TAN pair, or
        # that has no pass-1 sky fit to replay, falls back to building
        # the whole frame the ordinary way.
        arr = None
        band_src = None
        if mode != "moments" and _tan_pair(src_wcs, stat_wcs) \
                and norm_coef.get(i) is not None:
            mapx, mapy = _tan_maps(src_wcs, stat_wcs, (hs, ws),
                                   distort=distort, out=map_buf)
            foot = _foot_from_maps(mapx, mapy, rgb.shape[:2],
                                   foot_buf=foot_buf)
            band_src = rgb
        elif mode != "moments":
            if src_buf is None or src_buf.shape != rgb.shape:
                src_buf = _np.empty(rgb.shape, _np.float32)
            if out_buf is None:
                out_buf = _np.empty((hs, ws, 3), _np.float32)
            arr, foot = _rp(rgb, src_wcs, stat_wcs, (hs, ws),
                            quality=True, distort=distort,
                            src_buf=src_buf, out=out_buf,
                            foot_buf=foot_buf, maps=map_buf)
        else:
            arr, foot = _rp(rgb, src_wcs, stat_wcs, (hs, ws),
                            quality=True, distort=distort)
        if band_src is None:
            del rgb
        _t = _tick("reproject", _t)
        ok = foot.astype(bool)
        segs = segments_per_frame.get(i)
        if segs:
            scratch[:] = 0
            _paint_segments(scratch, segs)
            if (hs, ws) != (h, w):
                ok &= _cv2.resize(scratch, (ws, hs),
                                  interpolation=_cv2.INTER_NEAREST) == 0
            else:
                ok &= scratch == 0
        # local normalization: subtract this frame's own low-order sky
        # surface (twilight/light-pollution gradients differ frame to
        # frame and a scalar offset cannot equalize them); the average
        # surface is restored to the stack afterwards, so nothing is
        # destructively flattened.  Pass 2 replays pass 1's coefficients
        # exactly, keeping the clip bounds valid.
        coef = None
        if mode == "moments":
            coef = fit_frame_sky(arr, foot.astype(bool), sky_half)
            if coef is not None:
                norm_coef[i] = coef
        else:
            coef = norm_coef.get(i)
            if coef is None and band_src is not None:
                raise AssertionError("banded path without a sky fit")
        band_sky = None
        if coef is not None:
            if mode == "moments":
                arr -= eval_frame_sky(coef, hs, ws)
            else:
                # subtracted band by band below, so the surface is never
                # built at full size just to be used once
                band_sky = coef
            bgs[i] = [float(v) for v in coef[:, 0]]
        else:
            bg = _frame_background(arr, foot.astype(bool))
            bgs[i] = [float(v) for v in bg]
            arr -= bg[None, None, :]     # remove this frame's sky drift
        if mode == "moments":
            mom.add(arr, ok)
        else:
            fcount += ok.astype(_np.uint16)
            wgt = float(frame_weights.get(i, 1.0))
            # The clip-and-accumulate is the stack's inner loop, and it
            # was five separate NumPy passes over a 20 MP frame per
            # channel.  OpenCV's elementwise kernels are threaded and
            # write into their destination, and in row bands the working
            # set stays in cache: same numbers to the last bit, measured
            # 2.5x faster (1.14s -> 0.46s per frame at 20 MP).
            ok_u8 = _np.where(ok, _np.uint8(255), _np.uint8(0))
            for r0 in range(0, hs, _CLIP_BAND):
                r1 = min(r0 + _CLIP_BAND, hs)
                if band_src is not None:
                    # resample straight into the band, then develop it to
                    # float in place.  Cubic on uint16 rounds the sample
                    # to the nearest ADU, which the float path threw away
                    # anyway: the stack is written as 16-bit, and across
                    # N frames that rounding averages down by sqrt(N).
                    _rb(band_src, mapx, mapy, r0, r1,
                        out=band_u16[:r1 - r0])
                    a_b = band_f32[:r1 - r0]
                    _np.copyto(a_b, band_u16[:r1 - r0])
                else:
                    a_b = arr[r0:r1]
                if band_sky is not None:
                    a_b -= eval_frame_sky(band_sky, hs, ws, r0, r1,
                                          out=band_sky_buf[:r1 - r0])
                ok_b = ok_u8[r0:r1]
                cm_b = (_clip_rows(clip_mean, r0, r1) if clip_half
                        else clip_mean[r0:r1])
                cb_b = (_clip_rows(clip_bound, r0, r1) if clip_half
                        else clip_bound[r0:r1])
                d_b = _cv2.absdiff(a_b, cm_b)
                keep = _cv2.compare(d_b, cb_b, _cv2.CMP_LE)
                _cv2.bitwise_and(keep, _cv2.merge([ok_b] * 3), dst=keep)
                all_k = _cv2.min(_cv2.min(keep[:, :, 0], keep[:, :, 1]),
                                 keep[:, :, 2])
                rcount[r0:r1] += ((ok_b > 0) & (all_k == 0))
                kf = keep.astype(_np.float32)
                _cv2.multiply(kf, wgt / 255.0, dst=kf)
                _cv2.add(wsum[r0:r1], kf, dst=wsum[r0:r1])
                _cv2.multiply(kf, a_b, dst=kf)
                _cv2.add(ssum[r0:r1], kf, dst=ssum[r0:r1])
        _t = _tick("accumulate", _t)
        del arr, foot, ok, band_src
        rgb = None
    if _prof is not None:
        from meteorprep.astrometry.tanmap import prof_dump
        prof_dump(f"{mode} w{worker_id}")
        import resource as _res
        _rss = _res.getrusage(_res.RUSAGE_SELF).ru_maxrss / 1e6
        line = (f"PROF {mode} w{worker_id} n={n_done} peakGB={_rss:.2f} "
                + " ".join(f"{k}={v:.2f}" for k, v in sorted(_prof.items())))
        try:
            with open(_os_prof.environ["METEORPREP_PROF"], "a") as fh:
                fh.write(line + "\n")
        except OSError:
            pass
    out = {"bg": bgs}
    if mode == "moments":
        out["coef"] = {int(k): _np.asarray(v).tolist()
                       for k, v in norm_coef.items()}
        for name, a in (("count", mom.count), ("mean", mom.mean),
                        ("m2", mom.m2)):
            p = tmp / f"{name}_{worker_id}.npy"
            _np.save(p, a)
            out[name] = str(p)
    else:
        out["worker_id"] = worker_id
        if shared_spec:
            out["shared"] = True
            # the last references to the shared buffers, or close() will
            # refuse (see _release_shared)
            ssum = wsum = fcount = rcount = None
            _release_shared(shm_arrays, shm_blocks)
        else:
            for name, a in (("csum", ssum), ("cwsum", wsum),
                            ("fcount", fcount), ("rcount", rcount)):
                p = tmp / f"{name}_{worker_id}.npy"
                _np.save(p, a)
                out[name] = str(p)
        if fg_sum is not None:
            p = tmp / f"fg_{worker_id}.npy"
            _np.save(p, fg_sum)
            out["fg"] = str(p)
            out["fg_n"] = fg_n
        if trail_max is not None:
            p = tmp / f"trail_{worker_id}.npy"
            _np.save(p, trail_max)
            out["trail"] = str(p)
    return out


def _available_ram_gb() -> float:
    import os
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1e9
    except (ValueError, OSError, AttributeError):
        return 16.0


# ----------------------------------------------------------------------

def run(cfg: Config, progress=None) -> dict:
    """Run the pipeline; returns a summary dict with output paths."""
    import warnings as _warnings
    # astropy's iterative inverse warns loudly on wide fields; it is
    # handled (results are verified downstream) and the console flood
    # reads like an error to people
    _warnings.filterwarnings("ignore", message=".*all_world2pix.*")
    logging.basicConfig(level=logging.INFO,
                        format="%(levelname)s %(message)s")
    # flight recorder: everything the run says, in one plain file the user
    # can send when something looks wrong
    cfg.output_path.mkdir(parents=True, exist_ok=True)
    # a quick look and the full run share an output folder, and the log
    # is the file support asks for — one must not erase the other
    _log_name = "run_log_quick.txt" if cfg.draft else "run_log.txt"
    _fh = logging.FileHandler(cfg.output_path / _log_name,
                              mode="w", encoding="utf-8")
    _fh.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)s %(message)s"))
    _fh.setLevel(logging.INFO)
    _mp_log = logging.getLogger("meteorprep")
    # The run log is the file support asks for, so it has to be complete
    # whatever the host application did to logging first.  basicConfig is
    # a no-op once the root logger has handlers, and an inherited level
    # above INFO drops the records before any handler sees them — the log
    # then exists, is named run_log.txt, and is empty.
    _prev_level = _mp_log.level
    _mp_log.setLevel(logging.INFO)
    _mp_log.addHandler(_fh)
    try:
        return _run(cfg, _fh, progress)
    finally:
        # every exit path, not just the one that reaches the end: a folder
        # with no photos in it raised before the old cleanup and left the
        # handler attached, so the NEXT run's lines were written into the
        # previous run's log as well as its own
        _mp_log.removeHandler(_fh)
        _mp_log.setLevel(_prev_level)
        _fh.close()


def _run(cfg: Config, _fh, progress=None) -> dict:
    import platform
    from meteorprep import __version__ as _ver
    log.info("METEORPREP %s on %s / Python %s", _ver, platform.platform(),
             platform.python_version())

    _base_notify = progress or (lambda frac, msg: None)

    def notify(frac, msg):
        log.info("[%3d%%] %s", int(frac * 100), msg)
        _base_notify(frac, msg)
    # optional overrides shipped alongside the frames (tests / power users)
    override = Path(cfg.input_dir) / "meteorprep_config.json"
    if override.exists():
        import dataclasses as _dcs
        import json as _json
        # Real dataclass fields only.  hasattr() also says yes to
        # output_path and cache_path, which are read-only properties, so
        # a plausible typo used to hand a photographer a raw traceback
        # instead of the "no such setting" line this loop exists to
        # print — and yes to every method name, which was accepted in
        # silence and blew up much later.
        _settings = {f.name for f in _dcs.fields(Config)}
        try:
            _data = _json.loads(override.read_text())
            if not isinstance(_data, dict):
                raise ValueError("the file has to hold a { } block of "
                                 "settings")
            for k, v in _data.items():
                if k in Config.DERIVED_ONLY:
                    log.warning("meteorprep_config.json: ignoring %r — it "
                                "is already in effect by the time this "
                                "file is read.  The run mode is chosen "
                                "with --mode (quick / full / smaller) or "
                                "in the window; the folders are chosen "
                                "on the command line", k)
                elif cfg.draft and k in Config.DRAFT_DERIVED:
                    log.warning("meteorprep_config.json: ignoring %r — a "
                                "quick look decides that one.  Run "
                                "--mode full or --mode smaller if you "
                                "want it.", k)
                elif k in _settings:
                    setattr(cfg, k, v)
                else:
                    log.warning("meteorprep_config.json: no such setting "
                                "%r — ignored", k)
        except (ValueError, OSError) as exc:
            log.warning("ignoring bad meteorprep_config.json: %s", exc)
    out_root = cfg.output_path
    out_root.mkdir(parents=True, exist_ok=True)

    # ---------------- ingest ----------------
    import time as _time
    _t_ingest = _time.time()
    notify(0.02, "scanning input folder")
    paths = scan_input_dir(Path(cfg.input_dir), cfg.raw_extensions)
    if not paths:
        raise FileNotFoundError(f"no frames found under {cfg.input_dir}")
    # the hot-pixel map is a property of the sensor, not the run: cache it
    # (key from the file set alone, so the cache check needs no metadata
    # and a fresh scan can run CONCURRENTLY with the exif read below)
    try:
        first_size = Path(paths[0]).stat().st_size
    except OSError:
        first_size = 0
    bp_key = "|".join([str(len(paths)), Path(paths[0]).name,
                       Path(paths[-1]).name, str(first_size)])
    bp_npy = cfg.cache_path / "bad_pixels.npy"
    bp_keyf = cfg.cache_path / "bad_pixels.key"
    bad_pixels = None
    scan_thread = None
    scan_out: dict = {}
    reused = False
    if (not cfg.force and bp_npy.exists() and bp_keyf.exists()
            and bp_keyf.read_text() == bp_key):
        try:
            bad_pixels = np.load(bp_npy)
            reused = True
        except (ValueError, OSError, EOFError):
            # a run killed part-way through the save leaves a truncated
            # .npy that the key still vouches for — the same hazard the
            # ground mask is written atomically to avoid
            log.info("the saved hot-pixel map is damaged; scanning again")
            bp_npy.unlink(missing_ok=True)
            bp_keyf.unlink(missing_ok=True)
            bad_pixels = None
    if reused:
        log.info("hot-pixel map reused from cache (%d pixels)",
                 len(bad_pixels))
        if len(bad_pixels) == 0:
            bad_pixels = None
    else:
        from threading import Thread

        def _scan():
            try:
                scan_out["bad"] = raw_mod.find_bad_pixels(list(paths))
            except Exception as exc:
                log.warning("hot-pixel scan failed: %s", exc)

        scan_thread = Thread(target=_scan, daemon=True)
        scan_thread.start()
    metas = read_metadata(paths)
    if scan_thread is not None:
        scan_thread.join()
        if "bad" in scan_out:              # scan actually completed
            bad_pixels = scan_out["bad"]
            cfg.cache_path.mkdir(parents=True, exist_ok=True)
            _save_npy_atomic(bp_npy, bad_pixels if bad_pixels is not None
                             else np.empty((0, 2), np.int64))
            bp_keyf.write_text(bp_key)
        else:                              # crashed: never cache failure
            log.warning("hot-pixel scan did not finish — running without "
                        "repair this time; it will retry on the next run")
            bad_pixels = None

    pre_timings = [("folder scan + hot-pixel map",
                    _time.time() - _t_ingest)]
    groups = segment_folder(metas, cfg.max_gap_factor)
    log.info("found %d frame(s) in %d group(s)", len(metas), len(groups))

    real_groups = [g for g in groups if len(g.frames) >= 5]
    for g in groups:
        if len(g.frames) < 5:
            log.info("skipping group %s: only %d frame(s) (test shots?)",
                     g.group_id, len(g.frames))
    if not real_groups:
        raise RuntimeError(
            "No usable shooting sequence found — the folder seems to hold "
            "only a handful of scattered shots. This tool needs one "
            "continuous run of frames from a fixed tripod.")
    results = {"groups": []}
    errors = []
    try:
        _run_groups(cfg, real_groups, bad_pixels, notify, results, errors,
                    pre_timings)
    except Exception as exc:
        if _disk_full(exc) and not isinstance(exc, RuntimeError):
            raise RuntimeError(_DISK_FULL_MSG) from exc
        raise
    finally:
        _close_shared_pools()
    if errors and not results["groups"]:
        raise RuntimeError(f"every group failed: {errors}")
    return results


def _run_groups(cfg, real_groups, bad_pixels, notify, results, errors,
                pre_timings=None):
    for group in real_groups:
        try:
            res = _run_group(cfg, group, bad_pixels, notify, pre_timings)
            results["groups"].append(res)
        except Exception:
            if len(real_groups) == 1:
                raise
            log.exception("group %s failed; continuing with the others",
                          group.group_id)
            errors.append(group.group_id)


# Streak coordinates are stored in OUTPUT-canvas pixels, and the output
# canvas is half as wide at half size — so the same night saved from a
# quick look and from a full run holds numbers that differ by a factor
# of two.  The saved file records which scale it is in, and _load
# rescales.  Without this the quick-look-then-full-quality handoff (the
# whole point of sharing the search between modes) silently placed every
# meteor at half its true position: the corridors masked the wrong part
# of the sky and the layer windows cut blank sky, while the report still
# counted the right number of meteors.
_COORD_SCALED = ("x0", "y0", "x1", "y1", "length_px", "fwhm_px")


def _angsep_deg(a, b) -> float:
    """Angle between two (ra, dec) points, in degrees."""
    ra0, de0 = np.deg2rad(a[0]), np.deg2rad(a[1])
    ra1, de1 = np.deg2rad(b[0]), np.deg2rad(b[1])
    u = np.array([np.cos(de0) * np.cos(ra0), np.cos(de0) * np.sin(ra0),
                  np.sin(de0)])
    v = np.array([np.cos(de1) * np.cos(ra1), np.cos(de1) * np.sin(ra1),
                  np.sin(de1)])
    return float(np.rad2deg(np.arccos(np.clip(u @ v, -1.0, 1.0))))


def _candidates_scale(cache, name="candidates.json"):
    """The output scale a saved detection is in, or None when the file
    does not say — in which case it cannot safely be reused, because
    there is no way to tell which canvas its numbers describe."""
    import json as _json
    try:
        doc = _json.loads(cache.path(name).read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(doc, dict):
        return None
    try:
        v = float(doc.get("coord_scale") or 0.0)
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


def _save_candidates(cache, candidates, name="candidates.json",
                     scale=1.0) -> None:
    """Persist the detection result so a re-run resumes instead of
    repeating the search (the expensive half of a long night)."""
    import dataclasses as _dc
    import json as _json

    def _plain(o):
        if isinstance(o, (np.floating, np.integer)):
            return o.item()
        if isinstance(o, np.ndarray):
            return o.tolist()
        return str(o)

    from meteorprep import __version__ as _ver
    cache.path(name).write_text(_json.dumps(
        {"tool_version": _ver, "coord_scale": float(scale),
         "candidates": [_dc.asdict(c) for c in candidates]}, default=_plain))


def _reject_below_horizon(result, possible, label, stash=None):
    """Set aside a star match that lands on sky which never rises from
    the photographer's latitude, so the search keeps looking for one that
    does.  The rejected match is kept in ``stash``: if nothing better
    turns up it is used anyway (with the alignment marked degraded),
    because the only thing worse than a suspect solve is no picture at
    all — and a mistyped latitude must never cost the user their night."""
    if result is None:
        return None
    ok, dec_c = possible(result.wcs)
    if ok:
        return result
    log.warning("setting aside the %s star match: it centres your frame "
                "on declination %+.0f deg, which never rises above the "
                "horizon from your latitude — so it cannot be the sky in "
                "these photos (unless the location is wrong). Looking for "
                "another match", label, dec_c)
    if stash is not None and stash.get("result") is None:
        stash["result"] = result
        stash["dec"] = dec_c
    return None


def _detect_tripod_bump(wcs_list, frames, bump_px: float):
    """Find the photo where the tripod was knocked, or None.

    A fixed tripod's pointing changes only by the sky's own rotation, so
    each frame's WCS should match its predecessor's advanced by the
    sidereal rate.  Anything left over is the camera itself moving.  The
    comparison is between NEIGHBOURS, never against the first frame of the
    night: propagation over ten seconds is exact, propagation over five
    hours accumulates model error and would report a bump on a tripod that
    never moved.

    A bump is a STEP that stays.  One frame alone out of place is a bad
    solve, so a jump only counts when the frame after it sits still again.

    Returns {"index", "file", "shift_px", "n_after"} in detection pixels,
    or None.
    """
    n = len(frames)
    if n < 6:
        return None
    steps = np.full(n, np.nan)
    for i in range(1, n):
        a, b = wcs_list[i - 1], wcs_list[i]
        if a is None or b is None:
            continue
        dt = (frames[i].epoch_mid
              - frames[i - 1].epoch_mid).total_seconds()
        pred = propagate_wcs(a, dt)
        cx = float(pred.wcs.crpix[0]) - 1.0
        cy = float(pred.wcs.crpix[1]) - 1.0
        ra, dec = pred.pixel_to_world_values(cx, cy)
        px, py = b.world_to_pixel_values(ra, dec)
        if not (np.isfinite(px) and np.isfinite(py)):
            continue
        steps[i] = float(np.hypot(float(px) - cx, float(py) - cy))
    if not np.isfinite(steps).any():
        return None
    i = int(np.nanargmax(steps))
    if not (steps[i] > bump_px) or i >= n - 2:
        return None
    after = steps[i + 1]
    if np.isfinite(after) and after > bump_px * 0.5:
        return None          # still moving: one bad solve, not a bump
    return {"index": i, "file": frames[i].file,
            "shift_px": float(steps[i]), "n_after": int(n - i)}


def _save_solve(cache, frames, det_wcs, base_file, k1, solver, quality,
                solve_files) -> None:
    """Park the star lock so the next run does not redo it.

    Deliberately NOT saved: the output-space base WCS and the pole
    position.  Both are the detection-space solve scaled by the output
    canvas, and the canvas is the one thing a quick look and a full run
    disagree about — caching them would hand a half-size run's geometry
    to the full-size one.  They are two cheap lines to recompute.
    """
    def _rms(m):
        # the sentinel is NaN, not None (ingest/exif.py), and a bare NaN
        # token is not valid JSON — light-painted frames are never
        # verified, so they always carry it
        v = getattr(m, "solve_rms_px", None)
        return float(v) if v is not None and v == v else None

    try:
        cache.write_json("solve.json", {
            "k1": float(k1), "solver": solver, "quality": quality,
            # the base frame defines the whole output canvas; it is
            # chosen from the light-paint flags and the sharpness
            # ranking, so the file has to name it and the reload has to
            # refuse a lock that was solved around a different one
            "base_file": base_file,
            "solve_files": list(solve_files),
            # keyed by file name, not by position: a folder rescanned in
            # a different order must not silently pair a photo with
            # someone else's sky
            "frames": [{"file": m.file,
                        "wcs": _wcs_to_str(w) if w is not None else "",
                        "source": getattr(m, "wcs_source", ""),
                        "rms_px": _rms(m)}
                       for m, w in zip(frames, det_wcs)],
        })
    except (OSError, ValueError, TypeError) as exc:
        log.debug("could not save the star lock (%s); it will be redone "
                  "next run", exc)


def _restore_solve(cache, frames, det_wcs, base_file):
    """Put a saved star lock back.  Returns the run-level facts, or None
    if there is nothing usable saved."""
    try:
        rec = cache.read_json("solve.json")
    except (OSError, ValueError):     # never written, or a killed run
        return None
    if not isinstance(rec, dict) or not rec.get("frames"):
        return None
    if rec.get("base_file") != base_file:
        # a different photo is the base now, so the whole canvas is
        # different: solve again rather than adopt a frame's WCS that was
        # only ever propagated
        return None
    by_file = {f.get("file"): f for f in rec["frames"]}
    if any(m.file not in by_file for m in frames):
        return None                       # different photos: solve again
    try:
        for i, m in enumerate(frames):
            f = by_file[m.file]
            if not f.get("wcs"):
                return None               # a frame with no sky: solve again
            det_wcs[i] = _wcs_from_str(f["wcs"])
            m.wcs_source = f.get("source", "")
            rms = f.get("rms_px")
            m.solve_rms_px = float("nan") if rms is None else float(rms)
    except Exception as exc:
        log.info("the saved star lock would not load (%s); solving again",
                 exc)
        return None
    return {"k1": float(rec.get("k1", 0.0)),
            "solver": rec.get("solver", "cached"),
            "quality": rec.get("quality", "nominal"),
            "solve_files": list(rec.get("solve_files", []))}


def _observing_site(cfg, frames):
    """Where the camera actually stood: (lat, lon, how we know).

    Returns (None, None, None) when nobody knows.  Height, range and
    duration all hang off the observing site, so a guess here would turn
    into confident wrong numbers in the report — better to say nothing
    and tell the photographer how to fill it in.
    """
    lats = [m.gps_lat for m in frames
            if getattr(m, "gps_lat", None) is not None]
    lons = [m.gps_lon for m in frames
            if getattr(m, "gps_lon", None) is not None]
    if lats and lons:
        import statistics
        return (float(statistics.median(lats)), float(statistics.median(lons)),
                "the GPS position your camera recorded")
    if getattr(cfg, "site_explicit", False):
        return float(cfg.site_lat), float(cfg.site_lon), "the location you entered"
    return None, None, None


def _load_candidates(cache, name: str = "candidates.json", scale=1.0):
    import json as _json

    from meteorprep.detect.hough import Streak
    from meteorprep.detect.track import Candidate
    from meteorprep import __version__ as _ver
    doc = _json.loads(cache.path(name).read_text())
    if isinstance(doc, list):            # pre-1.14 cache
        doc = {"tool_version": "older", "candidates": doc}
    if doc.get("tool_version") != _ver:
        log.info("the saved detection was made by METEORPREP %s; reusing it "
                 "(tick 'Force re-run' to search again from scratch)",
                 doc.get("tool_version"))
    # bring the coordinates onto THIS run's canvas (see _COORD_SCALED)
    saved = float(doc.get("coord_scale") or 0.0)
    ratio = (float(scale) / saved) if saved > 0 else 1.0
    out = []
    for cd in doc.get("candidates", []):
        cd = dict(cd)
        streaks = [Streak(**st) for st in cd.pop("streaks", [])]
        if abs(ratio - 1.0) > 1e-9:
            for st in streaks:
                for f_ in _COORD_SCALED:
                    setattr(st, f_, getattr(st, f_) * ratio)
                st.area_px = int(round(st.area_px * ratio * ratio))
            cd.pop("endpoints_pix_base", None)   # rebuilt from the streaks
            # the candidate's own summary of its streaks' width is in
            # pixels too, and the classifier reads it (a cosmic-ray hit
            # and a saturated star are both width judgements)
            if cd.get("fwhm_px"):
                cd["fwhm_px"] = float(cd["fwhm_px"]) * ratio
        out.append(Candidate(streaks=streaks, **cd))
    if abs(ratio - 1.0) > 1e-9:
        log.info("the saved detection was measured on a %s canvas; its "
                 "coordinates were rescaled by %.3g for this one",
                 "half-size" if ratio > 1 else "full-size", ratio)
    return out


def _run_group(cfg: Config, group, bad_pixels, notify,
               pre_timings=None) -> dict:
    frames = group.frames
    n = len(frames)
    # a quick look is a look-at-it-now picture, not the deliverable: it
    # goes in its own folder so it can never be mistaken for the real
    # files, and so a later full run does not have to overwrite it
    out_dir = cfg.output_path / group.group_id
    if cfg.draft:
        out_dir = out_dir / "quick-look"
    out_dir.mkdir(parents=True, exist_ok=True)
    cache = CacheStore(cfg.cache_path / group.group_id)
    skipped = 0
    # per-stage wall clock for the run report ("where the time went")
    import time as _time
    timings: list = list(pre_timings or [])
    _t_last = [_time.time()]

    sw = _stopwatch()          # METEORPREP_PROF: fine-grained step timing

    def mark(label):
        now = _time.time()
        timings.append((label, now - _t_last[0]))
        _t_last[0] = now
    # frame-set fingerprint: adding/removing/replacing files re-runs stages
    import hashlib as _hashlib
    _fp = _hashlib.sha256()
    for m in frames:
        try:
            _fp.update(f"{m.file}:{m.path.stat().st_size}".encode())
        except OSError:
            _fp.update(m.file.encode())
    frames_fp = _fp.hexdigest()[:16]

    def stage_cached(stage):
        """Is this stage's saved marker still current?  Side-effect free:
        stage_fresh counts a skip, and asking the same question twice
        must not count it twice."""
        return (not cfg.force
                and cache.is_done(stage, cfg.stage_hash(stage) + ":"
                                  + frames_fp))

    def stage_fresh(stage):
        nonlocal skipped
        if stage_cached(stage):
            skipped += 1
            return False
        return True

    def stage_done(stage):
        cache.mark_done(stage, cfg.stage_hash(stage) + ":" + frames_fp)

    # Detection space: always half-size decode (the spec's 2x2 binning).
    # Output space: full resolution (optionally super-sampled), or half.
    # decode scale first; the super_sample factor joins AFTER the RAM
    # guard below has had its say (a stale S once described a canvas 1.5x
    # larger than the one actually built)
    S = float(1 if cfg.half_size else 2)

    # ------- decode-once cache: every stage reads half-size luminance
    # ------- from here instead of re-decoding the RAW (3x decode saved)
    det_lum_dir = cache.dir("det_lum")
    if cfg.force:
        for _f in det_lum_dir.glob("*.npy"):
            _f.unlink()

    def det_lum_file(i):
        return det_lum_dir / (Path(frames[i].file).stem + ".npy")

    # Only three things read these small decodes: the sizing-up pass, the
    # star lock and the alignment.  When none of them is going to run —
    # re-opening a finished folder, and the second half of every
    # quick-look-then-full handoff — this prefetch used to re-read every
    # RAW of the night to fill a cache that nothing then opened and the
    # run deleted again.
    #
    # The alignment is the awkward one: a finished full run deletes its
    # aligned previews and retires the marker, so "reproject is stale"
    # is true on every re-run — but the block that would rebuild them
    # only runs when the search or the second look still needs them, and
    # on a finished folder neither does.  That condition is worked out
    # properly 500 lines further down, once the candidate file has been
    # read; here it is only worth approximating, and an approximation is
    # safe because decode_det_lum falls back to reading the photo.
    _detect_saved = (stage_cached("detect")
                     and cache.path("candidates.json").exists())
    _faint_saved = (not cfg.faint_harvest) or stage_cached("faint")
    _will_align = (cfg.find_meteors
                   and (not _detect_saved or not _faint_saved)
                   and not stage_cached("reproject"))
    needs_det_lum = (cfg.force
                     or not stage_cached("lightpaint")
                     or not stage_cached("solve")
                     or _will_align)
    missing = ([i for i in range(n) if not det_lum_file(i).exists()]
               if needs_det_lum else [])
    if missing:
        notify(0.05, "reading every photo once (small size)")
        dl_work = [(str(frames[i].path), str(det_lum_file(i)), bad_pixels)
                   for i in missing]
        done_dl = 0
        if cfg.jobs > 1 and len(dl_work) > 3:
            from concurrent.futures import as_completed
            n_dl = max(min(cfg.jobs, 6), 1)
            try:
                pool = _shared_pool(n_dl)
                futs = [pool.submit(_det_lum_one, a) for a in dl_work]
                for fut in as_completed(futs,
                                        timeout=120 + 30 * len(dl_work)):
                    fut.result()
                    done_dl += 1
                    notify(0.05 + 0.04 * done_dl / len(dl_work),
                           f"reading every photo once "
                           f"({done_dl}/{len(dl_work)})")
            except Exception as exc:
                _drop_shared_pool(n_dl)
                log.warning("parallel decode failed (%s); one core", exc)
        for a in dl_work:
            if not Path(a[1]).exists():
                _det_lum_one(a)

    def decode_det_lum(i):
        p = det_lum_file(i)
        if p.exists():
            return np.load(p).astype(np.float32)
        rgb = raw_mod.decode(frames[i].path, "detect", bad_pixels,
                             half_size=True)
        return raw_mod.luminance(rgb)

    # ---------------- light-paint flags + frame sharpness ----------------
    # Same rule as the starfield below: the marker is only worth what the
    # file behind it is worth, and cache/ is a folder the guide tells
    # people they may delete.  Read it HERE, before the branch is chosen,
    # so anything wrong with it means "measure it again" instead of a
    # traceback on the way past.
    _lp_saved = None
    if not cfg.force and stage_cached("lightpaint"):
        try:
            rec = cache.read_json("lightpaint.json")
            if isinstance(rec, dict):
                _lp_saved = (np.array(rec["lp"], dtype=bool),
                             rec.get("sharp", [0.0] * n))
            else:                      # older cache format
                _lp_saved = (np.array(rec, dtype=bool), [0.0] * n)
            if len(_lp_saved[0]) != n:
                _lp_saved = None
        except (OSError, ValueError, KeyError, TypeError):
            _lp_saved = None
        if _lp_saved is None:
            log.info("the saved frame ranking is gone or damaged; sizing "
                     "the photos up again")
            cache.invalidate("lightpaint")
    if stage_fresh("lightpaint"):
        notify(0.06, "sizing up every frame")
        gmed, sharp = [], []
        for i in range(n):
            lum = decode_det_lum(i)
            gmed.append(ground_luminance(lum, None))
            # star-sharpness proxy: high-frequency energy of the centre crop
            c = lum[lum.shape[0] // 4: -lum.shape[0] // 4,
                    lum.shape[1] // 4: -lum.shape[1] // 4]
            sharp.append(float(np.mean(np.abs(np.diff(c, axis=1)))))
        lp = flag_lightpainted(np.array(gmed), cfg.lp_window, cfg.lp_sigma)
        cache.write_json("lightpaint.json",
                         {"lp": lp.tolist(), "sharp": sharp})
        stage_done("lightpaint")
    else:
        lp, sharp = _lp_saved
    for m, f in zip(frames, lp):
        m.lightpainted = bool(f)
    ok_idx = [i for i in range(n) if not lp[i]]
    if not ok_idx:
        raise RuntimeError("every frame is flagged light-painted")

    # base frame: the sharpest frame in the middle half of the run
    mid = ok_idx[len(ok_idx) // 4: max(3 * len(ok_idx) // 4, len(ok_idx) // 4 + 1)]
    base_i = (max(mid, key=lambda i: sharp[i]) if mid and any(sharp)
              else ok_idx[len(ok_idx) // 2])
    base_meta = frames[base_i]
    base_rgb_final = raw_mod.decode(base_meta.path, "final", bad_pixels,
                                    half_size=cfg.half_size)
    ss = max(float(cfg.super_sample), 1.0)
    if ss > 1.001 and _available_ram_gb() < 12:
        log.warning("super_sample needs more memory than this machine has; "
                    "staying at 1.0")
        ss = 1.0
    if ss > 1.001:
        import cv2 as _cv2
        h0, w0 = base_rgb_final.shape[:2]
        base_rgb_final = _cv2.resize(
            base_rgb_final, (int(round(w0 * ss)), int(round(h0 * ss))),
            interpolation=_cv2.INTER_CUBIC)
        log.info("drizzle-style output grid: %.2fx (natural rotation dither)",
                 ss)
    S = (1 if cfg.half_size else 2) * ss   # det -> output scale, final
    h, w = base_rgb_final.shape[:2]
    base_det_lum = decode_det_lum(base_i)
    hd, wd = base_det_lum.shape[:2]

    # ---------------- free-disk preflight ----------------
    # a full night's caches + stacking scratch + outputs are a real load
    # on a laptop drive; failing here with a number beats an OSError
    # after twenty minutes of work
    try:
        import shutil as _sh
        canvas_mb = h * w * 3 * 4 / 1e6                 # one float32 canvas
        det_mb = hd * wd * 3 / 1e6                      # uint16 lum + foot
        det_total = 2 * n * det_mb                      # both decode caches
        stack_total = (4 * 2.2 * canvas_mb              # scratch parts
                       + 6 * canvas_mb)                 # PSD/PNG/tifs out
        # with cleanup enabled the camera-decode cache is freed after
        # alignment, but the aligned cache stays through stacking for the
        # faint-meteor harvest
        need_mb = (max(det_total, n * det_mb + stack_total)
                   if cfg.cleanup_cache
                   else det_total + stack_total) + 2000
        # Credit what a previous run already built.  A quick look now
        # leaves its aligned previews behind on purpose, so the full run
        # after it does not have to make them — and budgeting as if it
        # did, while the draft's own gigabytes are counted as "not free",
        # refused runs that fit perfectly well.
        have_mb = 0.0
        for _d in (cache.dir("detect_aligned"), cache.dir("det_lum")):
            try:
                have_mb += sum(f.stat().st_size
                               for f in _d.glob("*.npy")) / 1e6
            except OSError:
                pass
        need_mb = max(need_mb - have_mb, stack_total + 2000)
        free_mb = _sh.disk_usage(str(out_dir)).free / 1e6
        if free_mb < need_mb:
            raise RuntimeError(
                f"Not enough free disk space: this night needs roughly "
                f"{need_mb / 1000:.0f} GB of working room and the drive "
                f"holding {out_dir.name} has only {free_mb / 1000:.1f} GB "
                f"free. Free up space (empty the Trash, delete old "
                f"*_meteorprep folders), then press Find my meteors "
                f"again — or choose 'Full quality, half size', which "
                f"needs about a quarter of the room.")
        if free_mb < 1.5 * need_mb:
            log.warning("disk space is tight: ~%.0f GB free, ~%.0f GB "
                        "needed — the run should fit, but closing other "
                        "apps' downloads or emptying the Trash is wise",
                        free_mb / 1000, need_mb / 1000)
    except RuntimeError:
        raise
    except Exception:
        pass                                            # preflight is advisory

    # ---------------- plate solving (at detection scale) ----------------
    mark("reading + ranking the photos")
    notify(0.12, "matching your stars to the star map")
    if base_meta.pixel_pitch_um > 0:
        pitch_um = base_meta.pixel_pitch_um
        log.info("sensor pixel spacing read from your photos: %.2f um (%s)",
                 pitch_um, base_meta.model or "unknown camera")
    else:
        pitch_um = cfg.pixel_pitch_um
        log.warning("your photos don't record their sensor pixel size; "
                    "assuming %.2f um — if star matching fails, this "
                    "assumption is the first suspect", pitch_um)
    det_pitch_um = pitch_um * 2.0   # half-size decode
    det_scale_deg = float(np.rad2deg(np.arctan(
        det_pitch_um * 1e-3 / max(base_meta.focal_mm, 1e-3))))
    log.info("assumed sky coverage: %.0f x %.0f deg (%.1f mm lens)",
             det_scale_deg * wd, det_scale_deg * hd, base_meta.focal_mm)
    # matching catalog: user-supplied, else the bundled naked-eye catalog —
    # solving needs no network and no pointing hints
    from meteorprep.astrometry.blind import blind_solve, load_bright_catalog
    if cfg.catalog_file:
        catalog = np.load(cfg.catalog_file)[:, :2]
        blind_catalog = catalog
    else:
        blind_catalog = load_bright_catalog()
        catalog = blind_catalog[:, :2]

    k1 = cfg.lens_k1
    if abs(k1) < 1e-12:
        found = lookup_lensfun_k1(cfg.lens_model, base_meta.focal_mm)
        if found is not None:
            k1 = found
            log.info("Lensfun k1=%.5f for %s", k1, cfg.lens_model)
    dist = Poly3Distortion(k1, (hd, wd))   # k1 is scale-invariant
    undistort = None if dist.identity() else dist.undistort

    det_wcs: list = [None] * n   # per-frame WCS in detection space
    site_lat, site_lon, site_source = _observing_site(cfg, frames)
    if site_lat is None:
        log.info("no observing location (no GPS in the photos, none "
                 "entered): the height/distance estimates and the "
                 "below-the-horizon check on the star match are both "
                 "skipped — type your latitude, longitude in the app to "
                 "switch them on")

    def _pointing_possible(wcs_try):
        """A star match that lands on sky which never rises at all from
        the photographer's latitude is provably false — the failure mode
        an RMS gate cannot see, because a mirrored pattern still fits its
        own wrong stars tightly.

        Deliberately a visibility test, not an altitude test: EXIF stamps
        the camera's local clock with no timezone, so "how high was it at
        that moment" can be a whole hemisphere out.  Declination against
        latitude needs no clock at all — a field centred below
        (latitude - 90) deg is under the horizon every hour of every
        night, whatever the camera thought the time was.
        """
        if site_lat is None or wcs_try is None:
            return True, None
        try:
            _ra_c, dec_c = wcs_try.pixel_to_world_values(wd / 2.0, hd / 2.0)
            dec_c = float(dec_c)
        except Exception:
            return True, None
        # The test is on the field CENTRE, so the margin covers pointing
        # and fit error only — not half the field.  A centre below
        # (latitude - 90) deg is sky that is under the horizon at every
        # hour, so the middle of the photograph cannot be showing it,
        # however the camera was aimed.
        margin = 5.0
        never_up = (dec_c < (site_lat - 90.0) - margin
                    or dec_c > (site_lat + 90.0) + margin)
        return (not never_up), dec_c

    below_horizon: dict = {"result": None, "dec": None}
    solver_used = "none"
    alignment_quality = "nominal"
    solve_files: list[str] = []

    # The star lock is minutes of work and a few kilobytes of answer, and
    # it was the one expensive stage with no saved artifact at all: both
    # the window and the guide promise "a second run reuses the star
    # lock", and every single run re-solved the whole night.  Its stage
    # hash deliberately leaves out half_size and super_sample, so a quick
    # look and the full run that follows share this file.
    saved_solve = (_restore_solve(cache, frames, det_wcs, base_meta.file)
                   if stage_cached("solve") else None)
    if saved_solve is not None:
        k1 = saved_solve["k1"]
        dist = Poly3Distortion(k1, (hd, wd))
        undistort = None if dist.identity() else dist.undistort
        solver_used = saved_solve["solver"]
        alignment_quality = saved_solve["quality"]
        solve_files = saved_solve["solve_files"]
        base_det_wcs = det_wcs[base_i]
        # NOT restored from the file: these two are the detection solve
        # scaled onto the output canvas, and the canvas is the one thing
        # a quick look and a full run disagree about
        base_wcs = scale_wcs(base_det_wcs, S)
        pole_xy = pole_pixel_xy(base_wcs)
        skipped += 1
        log.info("star lock reused from the last run (%s, %s)",
                 solver_used, alignment_quality)
    elif cfg.align_mode == "reproject_tan":
        seed = None
        if np.isfinite(cfg.seed_ra_deg) and np.isfinite(cfg.seed_dec_deg):
            seed = build_tan_wcs(cfg.seed_ra_deg, cfg.seed_dec_deg,
                                 det_scale_deg, (hd, wd),
                                 rotation_deg=cfg.seed_rotation_deg)
        elif cfg.pointed_compass:
            # optional hint: "which way was the camera facing" -> seed.
            # EXIF times are camera-local; approximate UTC from the site
            # longitude (1 h per 15 deg) — a seed only needs to be rough.
            from datetime import timedelta

            from meteorprep.cloudrun import altaz_seed, parse_pointing
            try:
                utc_guess = base_meta.epoch_mid - timedelta(
                    hours=cfg.site_lon / 15.0)
                ra_s, dec_s = altaz_seed(
                    cfg.site_lat, cfg.site_lon, utc_guess.isoformat(),
                    parse_pointing(cfg.pointed_compass),
                    cfg.pointed_elevation_deg)
                seed = build_tan_wcs(ra_s, dec_s, det_scale_deg, (hd, wd),
                                     rotation_deg=cfg.seed_rotation_deg)
                log.info("pointing %s at %.0f deg up -> seed RA %.1f Dec %.1f",
                         cfg.pointed_compass, cfg.pointed_elevation_deg,
                         ra_s, dec_s)
            except (ValueError, RuntimeError) as exc:
                log.warning("could not derive a seed from the pointing "
                            "hint (%s); solving blind", exc)
        result = (solve_frame(base_det_lum, seed, catalog, cfg,
                              undistort=undistort)
                  if seed is not None else None)
        result = _reject_below_horizon(result, _pointing_possible, "seeded",
                                          below_horizon)
        if result is None:
            # fully automatic: search every plausible pointing against the
            # bundled naked-eye catalog — no hints, no network
            notify(0.14, "working out where the camera pointed")
            result = blind_solve(base_det_lum, det_scale_deg,
                                 catalog_radec=blind_catalog,
                                 undistort=undistort)
            result = _reject_below_horizon(result, _pointing_possible,
                                           "blind", below_horizon)
        if result is None:
            # the pair-distance gate is only as good as the assumed plate
            # scale; sweep plausible crop/zoom factors before giving up
            # Measured on real frames: the matcher tolerates an assumed
            # field that is too WIDE by up to ~8%, but fails as soon as
            # it is ~2% too NARROW — a wider guess only adds candidate
            # star pairs, a narrower one drops the true ones.  The old
            # ladder started at 1.6x and skipped the entire few-percent
            # neighbourhood, so a camera whose EXIF pixel pitch is off by
            # 2% (which is all it takes) got "I couldn't match the stars"
            # instead of a picture.  Fine steps first, upward before
            # downward, then the old coarse rungs for a truly wrong lens.
            for mult in (1.03, 1.06, 1.10, 0.97, 1.15, 0.94, 1.22, 0.90,
                         1.3, 1 / 1.3, 1.45, 0.85, 1.6, 1 / 1.6, 2.0, 0.5):
                notify(0.14, "working out where the camera pointed "
                             f"(trying a different lens guess: {mult:.2f}x)")
                log.info("blind solve retry at %.2fx assumed field of view",
                         mult)
                result = blind_solve(base_det_lum, det_scale_deg * mult,
                                     catalog_radec=blind_catalog,
                                     undistort=undistort)
                result = _reject_below_horizon(result, _pointing_possible,
                                               f"blind at {mult:.2f}x",
                                               below_horizon)
                if result is not None:
                    det_scale_deg *= mult
                    log.info("star match locked at %.2fx the assumed field "
                             "of view — the lens/sensor guess was off; "
                             "solved scale is now trusted instead", mult)
                    break
        if result is None and below_horizon["result"] is not None:
            result = below_horizon["result"]
            alignment_quality = "degraded"
            log.warning(
                "the only star match I can find is for sky that never "
                "rises from the latitude on record (%+.0f deg "
                "declination). Using it so you still get your picture, "
                "but treat the sky coordinates and the meteor "
                "height/distance estimates as unreliable: check the "
                "location you entered (a missing minus sign is the usual "
                "cause), or that these photos are the night you think "
                "they are", below_horizon["dec"])
        if result is None:
            raise RuntimeError(
                "I couldn't match the stars in your photos to the star map, "
                "even after trying several field-of-view guesses. This "
                "usually means the reference frame shows too few stars "
                "(clouds, trees, or heavy light pollution). Try removing the "
                "worst frames from the folder and running again — the tool "
                "will pick a different reference frame. If it keeps "
                "happening, send me the run_log.txt file from the output "
                "folder.")
        base_det_wcs = result.wcs
        solver_used = result.source
        # polish the lock against the full star list: identifies nearly
        # every detected star and averages the lens distortion fairly
        stars_full = detect_stars(base_det_lum, max_stars=200,
                                  max_elongation=3.0)
        if undistort is not None and len(stars_full):
            stars_full = undistort(stars_full)
        polished = refine_wcs(stars_full, catalog, base_det_wcs,
                              sip_order=None)
        # second round through the improved fit: from a marginal blind
        # seed the first 25 px match picks up wrong pairs at the edges
        if polished is not None:
            again = refine_wcs(stars_full, catalog, polished.wcs,
                               sip_order=None)
            if again is not None and again.n_matched >= polished.n_matched:
                polished = again
        if polished is not None and polished.n_matched > result.n_matched:
            log.info("base polish: %d -> %d stars, rms %.2f px",
                     result.n_matched, polished.n_matched, polished.rms_px)
            base_det_wcs = polished.wcs
            result = polished
        # self-calibrate the lens's barrel curvature from the matched stars
        # (no lens database needed) — uncorrected curvature blurs the
        # stack: each frame's stars land a few px apart at the field edges
        if dist.identity() and polished is not None and len(stars_full) >= 40:
            from meteorprep.astrometry.lensdistort import estimate_k1
            from scipy.spatial import cKDTree as _KD

            # iterative: with real barrel curvature the corner stars sit
            # tens of px off a straight TAN fit — outside any safe match
            # net.  Each round undistorts with the current k1, re-matches
            # wider, and re-estimates, pulling the corners in gradually.
            k1_cur = 0.0
            wcs_cur = base_det_wcs
            rms_pair = (None, None)
            n_match = 0
            for _round in range(3):
                pts = (Poly3Distortion(k1_cur, (hd, wd)).undistort(stars_full)
                       if abs(k1_cur) > 1e-9 else stars_full)
                _pred = np.column_stack(wcs_cur.world_to_pixel_values(
                    catalog[:, 0], catalog[:, 1]))
                _ok = np.isfinite(_pred).all(axis=1)
                _d, _nn = _KD(_pred[_ok]).query(pts,
                                                distance_upper_bound=25.0)
                _sel = np.isfinite(_d)
                n_match = int(_sel.sum())
                if n_match < 40:
                    break
                m_xy = stars_full[_sel]          # raw (distorted) coords
                m_world = catalog[np.nonzero(_ok)[0][_nn[_sel]]]
                crval0 = (float(wcs_cur.wcs.crval[0]),
                          float(wcs_cur.wcs.crval[1]))
                k1_new, rms_b, rms_a = estimate_k1(m_xy, m_world, crval0,
                                                   (hd, wd))
                rms_pair = (rms_b, rms_a)
                converged = abs(k1_new - k1_cur) < 3e-4
                k1_cur = k1_new
                refit = refine_wcs(
                    Poly3Distortion(k1_cur, (hd, wd)).undistort(stars_full)
                    if abs(k1_cur) > 1e-9 else stars_full,
                    catalog, wcs_cur, sip_order=None)
                if refit is not None:
                    wcs_cur = refit.wcs
                if converged:
                    break
            if rms_pair[0] is not None:
                log.info("lens self-calibration: k1=%+.4f, star fit "
                         "%.2f -> %.2f px over %d stars",
                         k1_cur, rms_pair[0], rms_pair[1], n_match)
            if (rms_pair[0] is not None and abs(k1_cur) > 1e-4
                    and rms_pair[1] < 0.95 * rms_pair[0]):
                k1 = k1_cur
                dist = Poly3Distortion(k1, (hd, wd))
                undistort = dist.undistort
                base_det_wcs = wcs_cur
                final = refine_wcs(dist.undistort(stars_full), catalog,
                                   base_det_wcs, sip_order=None)
                if final is not None:
                    base_det_wcs = final.wcs
                    result = final
                log.info("lens curvature adopted: k1=%+.4f — corner stars "
                         "now land where the star map says", k1)
        base_meta.wcs_source = "solved"
        base_meta.solve_rms_px = result.rms_px
        det_wcs[base_i] = base_det_wcs
        solve_files.append(base_meta.file)
        log.info("base solve via %s: rms=%.2f px (%d stars)",
                 result.source, result.rms_px, result.n_matched)
        # a real lens leaves a few px of residual at the corners of an
        # ultra-wide field; judge per-frame solves relative to what the
        # base itself achieved rather than by an absolute lab number
        rms_gate = max(cfg.solve_rms_max_px, 1.5 * float(result.rms_px))
        import dataclasses as _dc
        # with the analytic k1 correction active, per-frame SIP fitting is
        # redundant — and SIP WCS make every later transform iterative
        # (slow, and the source of the astropy convergence warning spam)
        cfg_solve = _dc.replace(cfg, solve_rms_max_px=rms_gate,
                                sip_order=(0 if undistort is not None
                                           else cfg.sip_order))

        # sparse subset: every K-th frame; others propagated + verified
        base_mid = base_meta.epoch_mid
        solve_targets = {i for i in range(0, n, max(cfg.solve_every_k, 1))}
        solve_targets.add(base_i)
        solved = {base_i: base_det_wcs}
        n_sparse = len(solve_targets)
        for k_s, i in enumerate(sorted(solve_targets)):
            if i == base_i or lp[i]:
                continue
            notify(0.14 + 0.04 * k_s / max(n_sparse, 1),
                   f"checking the star lock ({k_s + 1}/{n_sparse} anchors)")
            dt = (frames[i].epoch_mid - base_mid).total_seconds()
            seed_i = propagate_wcs(base_det_wcs, dt)
            res_i = solve_frame(decode_det_lum(i), seed_i, catalog, cfg_solve,
                                undistort=undistort)
            if res_i is not None and res_i.rms_px <= rms_gate:
                solved[i] = res_i.wcs
                frames[i].wcs_source = "solved"
                frames[i].solve_rms_px = res_i.rms_px
                solve_files.append(frames[i].file)
            else:
                log.info("frame %s: solve failed/poor, will propagate",
                         frames[i].file)
        for i in range(n):
            if i in solved:
                det_wcs[i] = solved[i]
                continue
            nearest = min(solved, key=lambda j: abs(
                (frames[i].epoch_mid - frames[j].epoch_mid).total_seconds()))
            dt = (frames[i].epoch_mid - frames[nearest].epoch_mid).total_seconds()
            det_wcs[i] = propagate_wcs(solved[nearest], dt)
            frames[i].wcs_source = "propagated"
        verify_idx = [i for i in range(n)
                      if i not in solved and catalog is not None
                      and not lp[i]]
        if verify_idx:
            notify(0.18, "verifying the star lock frame by frame")

            def _verify_one(i):
                return i, solve_rms_px(
                    det_wcs[i],
                    _detected_for_verify(decode_det_lum(i), undistort),
                    catalog)

            # detection + matching release the GIL: thread-map the checks
            from concurrent.futures import ThreadPoolExecutor
            done_v = 0
            with ThreadPoolExecutor(max_workers=min(6, cfg.jobs or 1)) as tp:
                for i, (rms, nm) in tp.map(_verify_one, verify_idx):
                    frames[i].solve_rms_px = rms
                    done_v += 1
                    if done_v % 20 == 0:
                        notify(0.18 + 0.06 * done_v / len(verify_idx),
                               f"verifying the star lock "
                               f"({done_v}/{len(verify_idx)})")
                    if rms > rms_gate and nm >= cfg.solve_min_stars:
                        res_i = solve_frame(decode_det_lum(i), det_wcs[i],
                                            catalog, cfg_solve,
                                            undistort=undistort)
                        if res_i is not None:
                            det_wcs[i] = res_i.wcs
                            frames[i].wcs_source = "solved"
                            frames[i].solve_rms_px = res_i.rms_px
                            solve_files.append(frames[i].file)
        _save_solve(cache, frames, det_wcs, base_meta.file, k1,
                    solver_used, alignment_quality, solve_files)
        # Then read it straight back and use THAT.  A WCS written to a
        # FITS header and parsed again differs from the one in memory in
        # about the eleventh decimal of a pixel — nothing anyone can see,
        # but enough that the same folder run twice produced two files
        # that were not byte-identical, which is a claim this tool makes.
        # Taking the geometry from the file on both runs makes the claim
        # exactly true rather than nearly.
        _restore_solve(cache, frames, det_wcs, base_meta.file)
        base_det_wcs = det_wcs[base_i]
        cache.mark_done("solve", cfg.stage_hash("solve") + ":" + frames_fp)
        base_wcs = scale_wcs(base_det_wcs, S)   # output-space base WCS
        pole_xy = pole_pixel_xy(base_wcs)
    else:
        # --align-mode=rotate2d: explicitly degraded (§4.7)
        alignment_quality = "degraded"
        solver_used = "rotate2d"
        base_det_wcs = None
        base_wcs = None
        pole_xy = None
        log.warning("ALIGNMENT DEGRADED: rotate2d mode — corner stars "
                    "mis-register by up to ~720 px/hr and meteors will not "
                    "radiate correctly from the true radiant")

    # ---- did the tripod get knocked?  The sky survives one: every frame
    # is solved or verified against the catalogue and reprojected to where
    # it really pointed, so the stars and the meteors still land in the
    # right places.  What does not survive is the averaged frozen ground,
    # which stacks the frames in CAMERA space and comes out with two
    # horizons on top of each other, so that layer is dropped instead.
    tripod_bump = None
    if base_det_wcs is not None:
        try:
            tripod_bump = _detect_tripod_bump(det_wcs, frames,
                                              float(cfg.bump_px))
        except Exception as exc:
            log.debug("tripod-bump check skipped (%s)", exc)
        if tripod_bump:
            log.warning(
                "the camera moved during the night: at %s the pointing "
                "jumped %.0f px beyond the sky's own drift, and the %d "
                "photos from there on are framed differently.  Every star "
                "and every meteor is still placed correctly.  The "
                "low-noise averaged foreground would show two horizons, "
                "so it is left out of this run — use the FOREGROUND layer "
                "that comes from a single photo.",
                tripod_bump["file"], tripod_bump["shift_px"],
                tripod_bump["n_after"])
    mark("star lock (solve + verify)")
    # ---- can this run resume?  the search is the expensive half of a
    # night, and its result is a few kB of JSON: reuse it when the frame
    # set and the detection parameters are unchanged
    # A run that is not hunting meteors is a nightscape build: same
    # aligned sky, same frozen foreground, same layers — no search.  The
    # search cache is neither read nor written, so checking the box later
    # searches properly rather than trusting a run that never looked.
    want_meteors = bool(cfg.find_meteors)
    detect_cached = bool(
        want_meteors
        and not cfg.force
        and cache.path("candidates.json").exists()
        and cache.is_done("detect", cfg.stage_hash("detect") + ":" + frames_fp)
        # a file that does not record which canvas its coordinates are on
        # (written before that was stored) cannot be moved onto this one
        and _candidates_scale(cache) is not None)
    # The second look is cached separately, because it is the one part of
    # the search a draft leaves out: a draft and the full run share the
    # first pass exactly, and the full run afterwards has only the faint
    # pass left to do.
    faint_cached = bool(
        detect_cached
        and cache.path("candidates_faint.json").exists()
        and cache.is_done("faint",
                          cfg.stage_hash("faint") + ":" + frames_fp)
        and _candidates_scale(cache, "candidates_faint.json") is not None)
    want_faint = want_meteors and bool(cfg.faint_harvest) and not faint_cached
    # the aligned small previews feed the first pass AND the second look;
    # a nightscape build needs neither (its horizon matte comes from the
    # frozen ground stack, not from the search's ground mask)
    need_det_dir = want_meteors and ((not detect_cached) or want_faint)
    if detect_cached:
        log.info("meteor search is up to date — resuming from the saved "
                 "result instead of searching every photo again")
        skipped += 1

    # ------- detection-space alignment cache (small: ~12 MB/frame) -------
    det_dir = cache.dir("detect_aligned")
    # A quick look leaves these files behind on purpose so the full run
    # can reuse them, which means the marker now vouches for a few GB of
    # files sitting in a folder the guide calls safe to delete.  Check
    # they are actually there before believing it: without this, deleting
    # cache/ between the two runs made the full run skip alignment on the
    # marker's word and then quietly skip the second look for faint
    # meteors, on the one run the photographer cares about.
    if ok_idx and not cfg.force and not stage_cached("reproject"):
        pass                      # already going to rebuild
    elif ok_idx and not all((det_dir / f"lum_{i:04d}.npy").exists()
                            for i in (ok_idx[0], ok_idx[-1])):
        if not cfg.force:
            log.info("the saved alignment is marked done but its files are "
                     "gone; aligning again")
        cache.invalidate("reproject")
    if need_det_dir and stage_fresh("reproject"):
        notify(0.25, "aligning small previews to search for meteors")
        if cfg.align_mode == "reproject_tan":
            det_str = _wcs_to_str(base_det_wcs)
            work = [(i, str(frames[i].path), _wcs_to_str(det_wcs[i]),
                     det_str, (hd, wd), str(det_dir), bad_pixels, k1,
                     str(det_lum_file(i)))
                    for i in range(n)]
            # workers only load a cached luminance and remap it: light on
            # memory, so use every requested core
            jobs_eff = max(cfg.jobs, 1)
            failed: list = []
            if jobs_eff > 1:
                from concurrent.futures import as_completed
                pending: dict = {}
                try:
                    # the timeout turns a silent hang into a clean
                    # single-core fallback
                    pool = _shared_pool(jobs_eff)
                    futs = {pool.submit(_detect_reproject_one, a): a
                            for a in work}
                    done = 0
                    pending.update(futs)
                    for fut in as_completed(
                            futs, timeout=600 + 240 * len(work)):
                        done += 1
                        pending.pop(fut, None)
                        try:
                            fut.result()
                        except Exception as exc:
                            failed.append((futs[fut], exc))
                        notify(0.25 + 0.15 * done / n,
                               f"searching preparation ({done}/{n})")
                except Exception as exc:
                    _drop_shared_pool(jobs_eff)
                    log.warning("parallel alignment failed (%s); finishing "
                                "the remaining frames on one core", exc)
                    failed.extend((a, None) for a in
                                  (pending.values() if pending else work))
            else:
                failed = [(a, None) for a in work]
            for k, (args, prev_exc) in enumerate(failed):
                try:
                    _detect_reproject_one(args)
                except Exception as exc:
                    # unreadable frame: blank footprint keeps the run alive
                    i_bad = args[0]
                    log.warning("frame %s is unreadable (%s); skipping it",
                                frames[i_bad].file, exc)
                    det_dir.mkdir(parents=True, exist_ok=True)
                    _save_npy_atomic(det_dir / f"lum_{i_bad:04d}.npy",
                                     np.zeros((hd, wd), np.uint16))
                    _save_npy_atomic(det_dir / f"foot_{i_bad:04d}.npy",
                                     np.zeros((hd, wd), np.uint8))
                if jobs_eff <= 1:
                    notify(0.25 + 0.15 * (k + 1) / n,
                           f"searching preparation ({k + 1}/{n})")
        else:
            from meteorprep.astrometry.reproject_frames import rotate2d_frame
            for i in range(n):
                lum = decode_det_lum(i)
                dt = (frames[i].epoch_mid - base_meta.epoch_mid).total_seconds()
                arr, foot = rotate2d_frame(lum, SIDEREAL_DEG_PER_SEC * dt,
                                           (wd / 2.0, hd / 2.0))
                np.save(det_dir / f"lum_{i:04d}.npy",
                        np.clip(arr, 0, 65535).astype(np.uint16))
                np.save(det_dir / f"foot_{i:04d}.npy", foot.astype(np.uint8))
        stage_done("reproject")

    if cfg.cleanup_cache:
        # the camera-space luminance cache (~10 MB/frame) has no consumer
        # after alignment: free it NOW, not at the end — the stacking and
        # assembly stages ahead are exactly when disk pressure peaks.
        # (aligned workers fall back to decoding the RAW if a later resume
        # ever needs these again)
        import shutil as _shutil
        _shutil.rmtree(det_lum_dir, ignore_errors=True)
        log.info("freed the decode cache early (%s)", det_lum_dir.name)

    mark("aligning small previews")

    def load_det_lum(i):
        return np.load(det_dir / f"lum_{i:04d}.npy", mmap_mode="r")

    def load_det_foot(i):
        return np.load(det_dir / f"foot_{i:04d}.npy", mmap_mode="r")

    # ---------------- detection ----------------
    # Workers memory-map the aligned cache: RAM stays flat, never all 226.
    if want_meteors:
        notify(0.45, "searching every frame for meteors")
    else:
        notify(0.45, "skipping the meteor hunt (not asked for this run)")

    # ground mask from alignment physics: static ground and flickering
    # lights deviate from the aligned-sky consensus in most frames, so
    # they are excluded BEFORE streak detection — a porch light cannot
    # become an "aircraft"
    from meteorprep.segment.sky_ground import ground_from_alignment
    sky_det = None
    have_aligned = (det_dir / f"lum_{ok_idx[0]:04d}.npy").exists() \
        if ok_idx else False
    sky_file = cache.path("sky_det.npy")
    # The mask is measured in the aligned detection canvas from the
    # photos that were NOT light-painted, so it is only valid for the
    # alignment and the exclusion set that produced it.  Keyed on nothing
    # but ".exists()", it outlived a changed lp_sigma, a re-solve, and a
    # different canvas size — and "Start over", whose whole job is to
    # trust nothing, quietly trusted it.
    sky_key = (cfg.stage_hash("reproject") + "|"
               + cfg.stage_hash("lightpaint") + ":" + frames_fp)
    if cfg.force or not cache.is_done("sky_det", sky_key):
        sky_file.unlink(missing_ok=True)
        cache.invalidate("sky_det")
    if sky_file.exists():
        try:
            sky_det = np.load(sky_file)
        except (ValueError, OSError, EOFError):
            # a run killed mid-save leaves a truncated .npy behind
            sky_file.unlink(missing_ok=True)
            sky_det = None
        if sky_det is not None and sky_det.shape != (hd, wd):
            sky_det = None               # different canvas: measure again
    if not want_meteors:
        # this mask exists to keep porch lights and treetops out of the
        # STREAK SEARCH; the composite's own horizon matte is measured
        # from the frozen ground stack later.  With no search to protect
        # there is nothing to measure here — though one saved by an
        # earlier meteor run was loaded above and still helps the
        # no-foreground fallback.
        pass
    elif sky_det is None and base_wcs is not None and not have_aligned:
        # A night with no ground in frame (pointed straight up) never
        # writes a mask, so there is nothing to reload — and by the
        # second run the aligned previews it would be measured from have
        # been cleaned up.  Finding no ground is the right answer here,
        # not a reason to fall over on a missing file.
        log.info("no ground mask saved and the aligned previews are gone; "
                 "carrying on with the whole frame as sky")
    elif sky_det is None and base_wcs is not None:
        sky_det = ground_from_alignment(load_det_lum, load_det_foot, n,
                                        exclude=set(np.nonzero(lp)[0]))
        if sky_det is not None:
            log.info("ground found from alignment physics: %.0f%% of the "
                     "frame masked out of the meteor search",
                     100.0 * (sky_det < 0.5).mean())
    sw("detect: ground mask")
    sky_path = ""
    if sky_det is not None:
        sky_path = str(sky_file)
        # write-then-rename: a run killed here used to leave a half
        # written .npy that every later run tripped over
        # the temporary keeps the .npy suffix on purpose: np.save appends
        # ".npy" to any name that does not already end in it
        tmp_sky = sky_file.with_suffix(".tmp.npy")
        np.save(tmp_sky, sky_det.astype(np.float32))
        os.replace(tmp_sky, sky_file)
        cache.mark_done("sky_det", sky_key)
    diff_dir = cache.dir("diffs")
    exclude_lp = [int(v) for v in np.nonzero(lp)[0]]
    search_idx = ([] if (detect_cached or not want_meteors)
                  else [i for i in range(n) if not lp[i]])
    streaks_per_frame = {}
    diffs_det = {}
    noise_sigmas = {}
    results_sr = []
    n_chunks = max(min(cfg.jobs, 4), 1)
    if n_chunks > 1 and len(search_idx) >= 8:
        chunk_sz = (len(search_idx) + n_chunks - 1) // n_chunks
        sr_chunks = [search_idx[k:k + chunk_sz]
                     for k in range(0, len(search_idx), chunk_sz)]
        import time as _time
        from concurrent.futures import FIRST_COMPLETED, wait
        prog_paths = [cache.path(f"prog_sr_{k}.txt")
                      for k in range(len(sr_chunks))]
        try:
            pool = _shared_pool(len(sr_chunks))
            futs = [pool.submit(
                _streak_search_chunk,
                (ch, n, str(det_dir), sky_path, cfg, S, exclude_lp,
                 str(diff_dir), str(prog_paths[k])))
                for k, ch in enumerate(sr_chunks)]
            pending = set(futs)
            finished_frames = 0
            last_seen = -1
            deadline = _time.time() + 300 + 60 * len(search_idx)
            while pending:
                done_set, pending = wait(pending, timeout=2,
                                         return_when=FIRST_COMPLETED)
                for fut in done_set:
                    part = fut.result()
                    results_sr.extend(part)
                    finished_frames += len(part)
                # live count: finished chunks + each worker's counter
                in_flight = 0
                for k, fut in enumerate(futs):
                    if not fut.done():
                        try:
                            in_flight += int(
                                prog_paths[k].read_text() or 0)
                        except (OSError, ValueError):
                            pass
                # max(): a counter read can race its writer and come
                # back empty — progress must never appear to go back
                seen = max(min(finished_frames + in_flight,
                               len(search_idx)), last_seen)
                if seen != last_seen:
                    last_seen = seen
                    notify(0.45 + 0.08 * seen / len(search_idx),
                           f"searching every frame for meteors "
                           f"(photo {seen}/{len(search_idx)})")
                if _time.time() > deadline:
                    raise TimeoutError("meteor search timed out")
        except Exception as exc:
            _drop_shared_pool(len(sr_chunks))
            log.warning("parallel meteor search failed (%s); one core", exc)
            results_sr = []
        finally:
            for p in prog_paths:
                p.unlink(missing_ok=True)
    if not results_sr:
        results_sr = _streak_search_chunk(
            (search_idx, n, str(det_dir), sky_path, cfg, S, exclude_lp,
             str(diff_dir), ""))
    for (i, s, noise, diff_path) in results_sr:
        noise_sigmas[i] = noise
        if s:
            streaks_per_frame[i] = s
            diffs_det[i] = np.load(diff_path, mmap_mode="r")


    # ---------------- tracking + colour + classification ----------------
    notify(0.55, "telling meteors from planes and satellites")
    if base_wcs is not None:
        def world_endpoints(fi, s):
            r0 = base_wcs.pixel_to_world_values(s.x0, s.y0)
            r1 = base_wcs.pixel_to_world_values(s.x1, s.y1)
            return ((float(r0[0]), float(r0[1])), (float(r1[0]), float(r1[1])))
    else:
        det_scale_out = det_scale_deg / S
        def world_endpoints(fi, s):
            return ((s.x0 * det_scale_out, s.y0 * det_scale_out),
                    (s.x1 * det_scale_out, s.y1 * det_scale_out))

    sw("detect: streak search")
    candidates = build_tracks(streaks_per_frame, world_endpoints,
                              [m.file for m in frames])
    from meteorprep.detect.track import merge_same_frame_fragments
    candidates = merge_same_frame_fragments(candidates, world_endpoints,
                                            pad=25.0 * S / _TUNED_SCALE)
    _measure_candidate_colors(candidates, frames, det_wcs, base_det_wcs,
                              (hd, wd), S, bad_pixels, k1)
    sw("detect: candidate colours")
    radiant = radiant_at_epoch(cfg, base_meta.epoch_mid)
    candidates = classify(candidates, cfg, radiant)
    sw("detect: classify")
    _absorb_track_fragments(candidates,
                            {m.file: i for i, m in enumerate(frames)},
                            frames, scale=S)
    if detect_cached:
        _cand_file = ("candidates_faint.json" if faint_cached
                      else "candidates.json")
        _saved_scale = _candidates_scale(cache, _cand_file)
        candidates = _load_candidates(cache, _cand_file, scale=S)
        if _saved_scale and abs(_saved_scale - S) > 1e-9:
            # Sky positions were read off the other canvas.  They agree
            # to about ten arcseconds, which is close enough for the eye
            # and not close enough for a file that claims to be a
            # measurement — so they are read again from the pixels that
            # were just rescaled onto this one.
            for c in candidates:
                c.endpoints_world = [
                    [list(w) for w in world_endpoints(0, st)]
                    for st in c.streaks]
                c.length_deg = float(max(
                    _angsep_deg(seg[0], seg[1])
                    for seg in c.endpoints_world))
        # The saved file holds the measurements, not the verdicts.  What
        # counts as a meteor is a judgement made from settings the user
        # can change — the radiant tolerance, the cosmic-ray size, the
        # frame-edge gap — and those settings live in the "classify"
        # stage, which has no saved artifact of its own.  Reloading the
        # old labels meant widening the radiant tolerance re-stacked the
        # entire night (classify is upstream of the stack) and then
        # showed the same verdicts it had before.
        candidates = classify(candidates, cfg, radiant)
        _absorb_track_fragments(candidates, {m.file: i for i, m
                                             in enumerate(frames)}, frames,
                                scale=S)
        log.info("restored %d candidate(s) from the previous run%s",
                 len(candidates),
                 "" if faint_cached else " (the second look still to do)")
    base_mid = base_meta.epoch_mid
    file_to_idx = {m.file: i for i, m in enumerate(frames)}
    for c in candidates:
        i0 = file_to_idx[c.frames[0]]
        c.rotation_deg = SIDEREAL_DEG_PER_SEC * (
            frames[i0].epoch_mid - base_mid).total_seconds()
        s = c.streaks[0]
        c.endpoints_pix_base = [[s.x0, s.y0], [s.x1, s.y1]]
        # physics annotations: where in the sky it burned, and — under
        # stated shower assumptions — how high, how far and how long
        if base_wcs is not None and site_lat is not None:
            try:
                from meteorprep.detect.physics import annotate
                c.physics = annotate(
                    c, site_lat, site_lon, frames[i0].epoch_mid,
                    float(frames[i0].exposure_s or 0.0),
                    entry_km_s=cfg.shower_entry_km_s,
                    ablation_km=cfg.shower_ablation_km,
                    meteor_assumptions=(c.label == "meteor"))
            except Exception as exc:
                log.debug("physics annotation skipped for %s: %s", c.id, exc)

    if not want_meteors:
        # nothing was searched, so there is nothing to save — and a
        # composite run must not leave an empty candidates file that a
        # later meteor run could mistake for a night already searched.
        # A saved noise measurement from an earlier meteor run, though,
        # is still the right weighting for this stack: fall through.
        pass
    elif not detect_cached:    # the first pass is complete and reusable
        _save_candidates(cache, candidates, scale=S)
        # The per-frame noise the search measured is what weights the
        # stack.  It was not saved, so a resumed run re-stacked the whole
        # night with every frame weighted equally — a slightly different,
        # slightly worse picture than the same folder produced the first
        # time, for no reason anyone could see.  It is a float per photo.
        # Stamped with how it was measured.  These numbers changed
        # meaning once already (they used to be taken from a residual
        # whose negatives had been clipped away, which pinned most of a
        # night to the floor), and nothing in the detect cache key
        # mentions the program's version — so an upgraded run on an old
        # folder would have loaded old-style numbers into the new
        # weighting and produced exactly the lopsided stack the change
        # was meant to end.
        cache.write_json("frame_noise.json",
                         {"measured": _NOISE_ESTIMATOR,
                          "sigmas": {str(k): float(v)
                                     for k, v in noise_sigmas.items()}})
        stage_done("detect")
        detect_cached = True
    if not noise_sigmas and (not want_meteors or detect_cached):
        try:
            rec = cache.read_json("frame_noise.json")
            if (isinstance(rec, dict)
                    and rec.get("measured") == _NOISE_ESTIMATOR):
                noise_sigmas = {int(k): float(v)
                                for k, v in rec["sigmas"].items()}
            else:
                log.info("the saved per-photo noise was measured a "
                         "different way; this stack weights every photo "
                         "equally (tick Start over to measure it again)")
        except FileNotFoundError:
            if want_meteors:
                log.info("the saved run did not record its per-photo "
                         "noise; this stack weights every photo equally")
            # a fresh composite run simply has none yet — nothing to say
        except (OSError, ValueError, AttributeError, TypeError):
            log.info("the saved per-photo noise would not read; this "
                     "stack weights every photo equally")

    meteor_cands = [c for c in candidates if c.label == "meteor"]
    flagged_cands = [c for c in candidates if c.label != "meteor"]
    meteor_cands.sort(key=lambda c: file_to_idx[c.frames[0]])

    # ---- streak corridors: endpoint lists, painted on demand (tiny) ----
    corridor_segments: dict[int, list] = {}
    for c in candidates:
        for frame_file, st in zip(c.frames, c.streaks):
            i = file_to_idx[frame_file]
            corridor_segments.setdefault(i, []).append(
                (st.x0, st.y0, st.x1, st.y1,
                 max(3.0 * max(st.fwhm_px, 2.0), 12.0)))

    # ---------------- streaming full-resolution base stack --------------
    weights = (frame_noise_weights(noise_sigmas) if cfg.frame_weighting
               else {})
    # The marker says this stage finished; the files are what it finished
    # with.  The guide tells people cache/ is safe to delete, and a run
    # that was stopped or ran out of room can leave a half-written TIFF,
    # so check before trusting: a missing base.tif used to end the run in
    # a traceback and a missing coverage map used to sail on and quietly
    # skip the seam crop.
    def _load_npy(name):
        """A cached measurement, or None — never a traceback and never a
        truncated array read as if it were whole."""
        f = cache.path(name)
        if not f.exists():
            return None
        try:
            return np.load(f)
        except (ValueError, OSError, EOFError):
            log.info("the saved %s is damaged; this run does without it",
                     name)
            f.unlink(missing_ok=True)
            return None

    _base_saved = None
    if not cfg.force and stage_cached("base_sky"):
        _want = ["base.tif"]
        if cfg.emit_foreground_stack:
            _want.append("fg_stack.tif")
        _gone = [f for f in _want if not cache.path(f).exists()]
        if _gone:
            log.info("the saved starfield is marked done but %s %s missing; "
                     "building it again", ", ".join(_gone),
                     "is" if len(_gone) == 1 else "are")
            cache.invalidate("base_sky")
        else:
            # Read it now rather than after the branch is chosen: a run
            # that was stopped during the ~120 MB compressed write leaves
            # a file the marker still vouches for, and the header of a
            # half-written TIFF reads back perfectly well.  Only actually
            # decoding it settles the question — and the shape it comes
            # back as settles the other one, that this is the canvas this
            # run is building.
            try:
                import tifffile as _tfc
                _base_saved = _tfc.imread(
                    cache.path("base.tif")).astype(np.float32)
                if _base_saved.shape[:2] != (h, w):
                    log.info("the saved starfield is %sx%s and this run "
                             "builds %sx%s; building it again",
                             _base_saved.shape[1], _base_saved.shape[0],
                             w, h)
                    _base_saved = None
            except Exception as exc:
                log.info("the saved starfield could not be read (%s); "
                         "building it again", exc)
                _base_saved = None
            if _base_saved is not None and base_wcs is not None \
                    and _load_npy("coverage.npy") is None:
                # coverage decides the seam crop, so losing it does not
                # mean "carry on without the receipts" — it means the
                # canvas comes out a different size than the run that
                # made this cache, with the stacking seams still in it
                log.info("the saved coverage map is gone or damaged; "
                         "building the starfield again")
                _base_saved = None
            if _base_saved is None:
                cache.invalidate("base_sky")
    if stage_fresh("base_sky"):
        mark("meteor search + classification")
        notify(0.60, "building the clean starfield from every frame")
        # This stage owns every file below, and it is about to rebuild
        # them: clear the previous configuration's first, at the TOP, so
        # that neither the reload branch nor a run killed halfway through
        # can find a cache describing two different runs.  Turning the
        # frozen foreground off and running again used to leave the old
        # fg_stack.tif on disk, and the third run — a clean cache hit —
        # loaded it and composited the foreground the user had switched
        # off.  A startrail.tif or a coverage map from a different canvas
        # size is the same hazard with a worse failure.
        #
        # Retire the marker BEFORE deleting the bytes it vouches for.
        # The marker is only rewritten at the very end of the stage, so
        # without this a run that is stopped (or runs out of memory)
        # between here and there leaves a marker saying "complete" over
        # files that are gone — and the next run takes the cache-hit
        # branch and quietly ships a night with no frozen foreground, no
        # seam crop and no evidence maps, reporting only "1 stage(s)
        # up-to-date, skipped".
        cache.invalidate("base_sky")
        for _stale in ("fg_stack.tif", "startrail.tif", "coverage.npy",
                       "rejected.npy", "removed_half.npy",
                       "noise_half.npy"):
            cache.path(_stale).unlink(missing_ok=True)
        (base_img, fg_stack, coverage, trail_img, rejected,
         removed_half) = _stream_base(
            cfg, frames, ok_idx, det_wcs, base_wcs, base_det_wcs, (h, w), S,
            corridor_segments, weights, cache, bad_pixels, notify, k1,
            sky_path)
        # the three big cache images are ~120 MB each before compression
        # and they are written back to back.  zlib releases the GIL, so
        # three threads finish in roughly the time of the slowest one
        # instead of the sum (measured 18.5s serial -> 9.5s threaded at
        # the default level, and level 1 turns 6.2s per image into 1.2s
        # for 4% more disk).
        tick = _stopwatch()
        jobs = [("base.tif", base_img)]
        if fg_stack is not None:
            jobs.append(("fg_stack.tif", fg_stack))
        if trail_img is not None:
            jobs.append(("startrail.tif", trail_img))
        u16 = {name: np.clip(arr, 0, 65535).astype(np.uint16)
               for name, arr in jobs}
        from concurrent.futures import ThreadPoolExecutor
        _tif_pool = ThreadPoolExecutor(max_workers=len(u16))
        # startrail.tif is the one the user keeps (it is copied out to
        # the results folder), so it stays compressed; base and fg_stack
        # exist only to let a re-run resume
        _tif_futures = [_tif_pool.submit(_write_cache_tif,
                                         cache.path(nm), u16[nm],
                                         nm == "startrail.tif")
                        for nm in u16]
        tick("cache tiffs submitted")
        if coverage is not None:
            np.save(cache.path("coverage.npy"), coverage)
        # evidence products survive cleanup and a resumed run alongside
        # coverage, so re-opening a finished folder still has its receipts
        if rejected is not None:
            np.save(cache.path("rejected.npy"), rejected)
        if removed_half is not None:
            np.save(cache.path("removed_half.npy"), removed_half)
        # already in hand: reading 240 MB of TIFF straight back would only
        # reproduce the uint16 rounding, which is one astype away
        base_img = u16["base.tif"].astype(np.float32)
        fg_stack = (u16["fg_stack.tif"].astype(np.float32)
                    if "fg_stack.tif" in u16 else None)
        del jobs, trail_img
        tick("evidence npy + rehydrate")

        def _finish_cache_writes():
            """Wait for the deferred cache images, then mark the stage
            done.  zlib runs with the GIL released, so the ~3s of
            compression overlaps the faint-meteor harvest that follows;
            nothing reads these files before the join, and the stage is
            only marked complete once every byte is on disk."""
            if not _tif_futures:
                return
            try:
                for fut in _tif_futures:
                    fut.result()
            finally:
                _tif_pool.shutdown(wait=True)
            _tif_futures.clear()
            u16.clear()
            tick("cache tiffs joined")
            stage_done("base_sky")
    else:
        import tifffile
        base_img = _base_saved          # already read, and checked
        # the setting decides, not the filesystem
        fg_stack = None
        if (cfg.emit_foreground_stack
                and cache.path("fg_stack.tif").exists()):
            try:
                fg_stack = tifffile.imread(
                    cache.path("fg_stack.tif")).astype(np.float32)
            except Exception as exc:
                log.info("the saved frozen foreground is damaged (%s); "
                         "this run uses the single-photo one", exc)
        def _finish_cache_writes():
            return
    coverage = _load_npy("coverage.npy")
    rejected = _load_npy("rejected.npy")
    base_lum = raw_mod.luminance(base_img)
    # the starfield is finished here; what follows is a different job
    # (searching it), and lumping the two together hid which was slow
    mark("building the clean starfield")

    # ------- second-pass faint-meteor harvest vs the clean base ---------
    faint_ran = False
    if (want_faint and base_wcs is not None
            and (det_dir / f"lum_{ok_idx[0]:04d}.npy").exists()):
        try:
            import cv2 as _cv2
            from meteorprep.detect.harvest import harvest_faint_meteors
            notify(0.815, "hunting fainter meteors against the clean sky")
            base_lum_det = _cv2.resize(base_lum, (wd, hd),
                                       interpolation=_cv2.INTER_AREA)
            known_segs = [seg for segs in corridor_segments.values()
                          for seg in segs]
            sky_bin_h = ((sky_det >= 0.5).astype(np.float32)
                         if sky_det is not None else None)
            new_cands = harvest_faint_meteors(
                load_det_lum, load_det_foot, base_lum_det, n,
                set(exclude_lp), sky_bin_h,
                known_segs, cfg, S, world_endpoints, radiant,
                [m.file for m in frames], mad_k=cfg.faint_mad_k,
                jobs=max(min(cfg.jobs, 4), 1),
                progress=lambda done, tot: notify(
                    0.815, f"hunting fainter meteors (photo {done}/{tot})"))
            if new_cands:
                # build_tracks restarts ids at C000: renumber the harvest
                # finds past every existing id before they join the pool
                import re as _re
                used = [int(m_.group(1)) for c in candidates
                        if (m_ := _re.match(r"C(\d+)$", str(c.id)))]
                nxt = (max(used) + 1) if used else 0
                for j, c in enumerate(new_cands):
                    c.id = f"C{nxt + j:03d}"
                    i0 = file_to_idx[c.frames[0]]
                    c.rotation_deg = SIDEREAL_DEG_PER_SEC * (
                        frames[i0].epoch_mid - base_mid).total_seconds()
                    s0 = c.streaks[0]
                    c.endpoints_pix_base = [[s0.x0, s0.y0], [s0.x1, s0.y1]]
                candidates.extend(new_cands)
                # the fragment/pair gauntlet must see the COMBINED list: a
                # faint single-frame fragment collinear with a known
                # satellite track gets demoted here, not shipped as a
                # meteor
                # the harvest adds candidates that never went through
                # fragment merging, and a bright meteor answers the faint
                # pass more than once too
                candidates = merge_same_frame_fragments(
                    candidates, world_endpoints,
                    pad=25.0 * S / _TUNED_SCALE)
                _absorb_track_fragments(candidates, file_to_idx, frames,
                                        scale=S)
                meteor_cands = [c for c in candidates
                                if c.label == "meteor"]
                flagged_cands = [c for c in candidates
                                 if c.label != "meteor"]
                meteor_cands.sort(key=lambda c: file_to_idx[c.frames[0]])
                n_kept = sum(1 for c in new_cands if c.label == "meteor")
                log.info("faint harvest added %d meteor(s) "
                         "(%d demoted by the track gauntlet)",
                         n_kept, len(new_cands) - n_kept)
            faint_ran = True          # reached the end without raising
        except Exception as exc:
            log.warning("faint harvest skipped (%s); first-pass results "
                        "are unaffected", exc)

    # Only when it actually ran: writing the marker on the skip path (no
    # plate solve, no aligned cache) or after the except below meant one
    # failed second look suppressed it for that folder for ever, and
    # nothing told the user why their faint meteors never appeared.
    if want_faint and faint_ran:
        _save_candidates(cache, candidates, "candidates_faint.json",
                         scale=S)
        stage_done("faint")
    elif want_faint:
        log.info("the second look for faint meteors did not run this "
                 "time; it will be tried again on the next run")

    if cfg.cleanup_cache and not cfg.draft:
        # the aligned-luminance cache is now truly done (first pass AND
        # harvest): free its GBs before assembly.  Invalidate the
        # alignment stage so a later resume rebuilds rather than trusting
        # missing files.  A draft keeps it: the whole point of a draft is
        # that a full run usually follows, and that run's second look
        # reads exactly these files.
        import shutil as _shutil
        _shutil.rmtree(det_dir, ignore_errors=True)
        cache.invalidate("reproject")
        log.info("freed the alignment cache (%s)", det_dir.name)

    # ---------------- extraction (full quality, meteor frames only) -----
    _finish_cache_writes()
    mark("second look for fainter meteors")
    notify(0.82, "cutting each meteor onto its own layer")
    sw("harvest + cache join")
    star_cat_xy = detect_stars(base_img, max_stars=500)
    sw("extract: detect_stars on the base")

    _dec_cache: dict[int, np.ndarray] = {}

    def decoded_full(i):
        """Full-quality decode of one frame, cached one at a time."""
        if i not in _dec_cache:
            _dec_cache.clear()
            _dec_cache[i] = raw_mod.decode(frames[i].path, "final",
                                           bad_pixels,
                                           half_size=cfg.half_size)
        return _dec_cache[i]

    # A streak occupies a few hundred pixels of a twenty-megapixel frame,
    # and the extractor never looks more than ~250 px beyond its endpoints
    # (it grows along the axis and measures the halo out to 200 px).
    # Resampling the whole frame to cut that one box was most of this
    # stage's time; a window is the same pixels for a fraction of the work.
    _WIN_MARGIN = 480
    _rot_cache: dict = {}

    def aligned_window(i, seg):
        """Reproject just the neighbourhood of one streak.  Returns
        (rgb_win float32, foot_win, x0, y0) in output-canvas pixels."""
        x0 = int(max(min(seg.x0, seg.x1) - _WIN_MARGIN, 0))
        y0 = int(max(min(seg.y0, seg.y1) - _WIN_MARGIN, 0))
        x1 = int(min(max(seg.x0, seg.x1) + _WIN_MARGIN, w))
        y1 = int(min(max(seg.y0, seg.y1) + _WIN_MARGIN, h))
        rgb = decoded_full(i)
        if cfg.align_mode == "reproject_tan":
            distort_full = (Poly3Distortion(k1, rgb.shape[:2]).distort
                            if abs(k1) > 1e-9 else None)
            win_wcs = base_wcs.deepcopy()
            win_wcs.wcs.crpix = [base_wcs.wcs.crpix[0] - x0,
                                 base_wcs.wcs.crpix[1] - y0]
            arr, foot = reproject_frame(
                rgb, scale_wcs(det_wcs[i], 1 if cfg.half_size else 2),
                win_wcs, (y1 - y0, x1 - x0),
                quality=True, distort=distort_full)
        else:
            # the plain-rotation fallback has no per-window shortcut, so
            # the rotated frame is cached whole and sliced per candidate
            if _rot_cache.get("i") != i:
                from meteorprep.astrometry.reproject_frames import \
                    rotate2d_frame
                dt = (frames[i].epoch_mid
                      - base_meta.epoch_mid).total_seconds()
                a_, f_ = rotate2d_frame(rgb, SIDEREAL_DEG_PER_SEC * dt,
                                        (w / 2.0, h / 2.0))
                _rot_cache.clear()
                _rot_cache.update(i=i, arr=a_, foot=f_)
            arr = _rot_cache["arr"][y0:y1, x0:x1]
            foot = _rot_cache["foot"][y0:y1, x0:x1]
        return arr.astype(np.float32), foot, x0, y0

    meteor_layers, flagged_layers = [], []
    roi_images = {}
    # group by frame so every photo is decoded exactly once, even when
    # several candidates (a long aircraft pass) share it — and narrate
    # progress: a whole night's worth of plane trails means dozens of
    # full-quality decodes here
    work_items = []
    for kind, group_list in (("m", meteor_cands), ("f", flagged_cands)):
        for c in group_list:
            for si, (frame_file, seg_streak) in enumerate(
                    zip(c.frames, c.streaks)):
                work_items.append((file_to_idx[frame_file], kind, c, si,
                                   seg_streak))
    work_items.sort(key=lambda t: t[0])
    n_extract = len({t[0] for t in work_items})
    done_ex = 0
    cur_i = None
    d_full = None
    arr = None
    for (i, kind, c, si, seg_streak) in work_items:
        if i != cur_i:
            cur_i = i
            done_ex += 1
            notify(0.82 + 0.06 * done_ex / max(n_extract, 1),
                   f"cutting candidate layers (photo {done_ex}/{n_extract})")
        arr, foot, wx, wy = aligned_window(i, seg_streak)
        wh, ww = arr.shape[:2]
        d_win = difference(raw_mod.luminance(arr),
                           base_lum[wy:wy + wh, wx:wx + ww], foot)
        stars_win = None
        if star_cat_xy is not None and len(star_cat_xy):
            sx = star_cat_xy[:, 0] - wx
            sy = star_cat_xy[:, 1] - wy
            keep = ((sx > -10) & (sx < ww + 10)
                    & (sy > -10) & (sy < wh + 10))
            stars_win = np.column_stack([sx[keep], sy[keep]])
        layer = extract_meteor(
            d_win, arr,
            ((seg_streak.x0 - wx, seg_streak.y0 - wy),
             (seg_streak.x1 - wx, seg_streak.y1 - wy)),
            seg_streak.fwhm_px, star_xy=stars_win,
            base_rgb=base_img[wy:wy + wh, wx:wx + ww])
        if layer is None:
            continue
        x0, y0, x1, y1 = layer.bbox
        roi_images.setdefault(c.id, d_win[y0:y1, x0:x1].copy())
        # the layer was cut in window coordinates: put it back on the canvas
        layer.bbox = (x0 + wx, y0 + wy, x1 + wx, y1 + wy)
        (meteor_layers if kind == "m" else flagged_layers).append(
            (c, layer, i, si))
    _dec_cache.clear()

    # contact-sheet ROIs for candidates whose extraction produced nothing:
    # fall back to the detection-space difference crop
    for c in candidates:
        if c.id in roi_images:
            continue
        i = file_to_idx[c.frames[0]]
        if i in diffs_det:
            st = c.streaks[0]
            x0 = int(max(min(st.x0, st.x1) / S - 30, 0))
            y0 = int(max(min(st.y0, st.y1) / S - 30, 0))
            x1 = int(min(max(st.x0, st.x1) / S + 30, wd))
            y1 = int(min(max(st.y0, st.y1) / S + 30, hd))
            roi_images[c.id] = np.asarray(diffs_det[i][y0:y1, x0:x1]).copy()

    # ---------------- sky/ground segmentation ----------------
    sw("extract: candidate layers")
    notify(0.88, "finding the horizon")
    if sky_det is not None:
        # the alignment-physics mask (already proven at detection time),
        # brought up to output resolution
        import cv2 as _cv2
        sky_mask = _cv2.resize(sky_det.astype(np.float32), (w, h),
                               interpolation=_cv2.INTER_LINEAR)
        sky_mask = np.clip(sky_mask, 0.0, 1.0)
    else:
        sky_mask = segment_sky(base_rgb_final)

    # ---------------- assembly ----------------
    mark("cutting layers + horizon")
    sw("extract: horizon")
    notify(0.92, "assembling layers")

    # seam-removing crop: keep the region where most frames overlap — the
    # sky rotates during the session, so the canvas rim is covered by only
    # a few frames and shows visible level steps
    h_full, w_full = h, w
    crop = None
    if (coverage is not None and cfg.crop_coverage_frac > 0
            and coverage.max() >= 3):
        need = max(int(np.ceil(cfg.crop_coverage_frac
                               * float(coverage.max()))), 2)
        good = coverage >= need
        x0c, y0c, x1c, y1c = 0, 0, w, h
        for _ in range(h + w):
            edges = [(~good[y0c, x0c:x1c]).sum(),
                     (~good[y1c - 1, x0c:x1c]).sum(),
                     (~good[y0c:y1c, x0c]).sum(),
                     (~good[y0c:y1c, x1c - 1]).sum()]
            k_worst = int(np.argmax(edges))
            if edges[k_worst] == 0:
                break
            if k_worst == 0:
                y0c += 1
            elif k_worst == 1:
                y1c -= 1
            elif k_worst == 2:
                x0c += 1
            else:
                x1c -= 1
            if (y1c - y0c) < h // 2 or (x1c - x0c) < w // 2:
                break   # never crop away more than half the canvas
        if (x0c, y0c, x1c, y1c) != (0, 0, w, h):
            crop = (x0c, y0c, x1c, y1c)
            log.info("cropping the canvas to the well-covered region: "
                     "%dx%d -> %dx%d (removes stacking seams at the rim)",
                     w, h, x1c - x0c, y1c - y0c)
            base_img = base_img[y0c:y1c, x0c:x1c]
            base_lum = base_lum[y0c:y1c, x0c:x1c]
            sky_mask = sky_mask[y0c:y1c, x0c:x1c]
            h, w = base_img.shape[:2]

    # written AFTER the seam crop so it overlays the shipped canvas 1:1.
    # Deferred until the foreground matte exists, so this file shows the
    # mask the FOREGROUND layers were actually cut with — the report
    # describes it as "your treeline's silhouette", and it must be.
    _skymask_path = out_dir / "skymask.png"

    def _fit_output(arr):
        """Bring a camera-sized array onto the (possibly cropped) canvas."""
        import cv2 as _cv2
        if arr.shape[0] != h_full or arr.shape[1] != w_full:
            arr = _cv2.resize(arr, (w_full, h_full),
                              interpolation=_cv2.INTER_CUBIC)
        if crop is not None:
            arr = arr[crop[1]:crop[3], crop[0]:crop[2]]
        return arr

    # The alignment mask exists to EXCLUDE ground from the meteor search;
    # as an alpha channel its blocky edge and swept sky-islands paste the
    # reference frame's brighter sky over the stack.  Reduce it to a clean
    # treeline silhouette for compositing (the raw mask still ships as
    # skymask.png and still drives detection).
    # Foreground alpha comes from the FROZEN (camera-space) stack, where
    # the trees are static and the sky is a smooth wash — not from the
    # sky-aligned detection mask, which marks the whole swept band on a
    # coarse block grid and pastes bright single-frame sky into the
    # picture when used as a cutout.
    from meteorprep.segment.silhouette import foreground_sky_mask
    fg_ref = _fit_output(base_rgb_final)
    try:
        sky_cam = foreground_sky_mask(fg_stack if fg_stack is not None
                                      else base_rgb_final)
    except Exception as exc:      # 90% into a long run: never lose it
        log.warning("foreground segmentation failed (%s); falling back to "
                    "the alignment mask", exc)
        sky_cam = None
    sky_fg = _fit_output(sky_cam) if sky_cam is not None else sky_mask
    sky_fg = np.clip(sky_fg, 0.0, 1.0)
    fg_alpha = 1.0 - sky_fg
    # match the foreground's sky level to the stack IN THE LAYERS too, not
    # only in the preview: a foreground that drops in at a different
    # brightness or colour than the sky it sits against is the single
    # most jarring thing to open in Photoshop
    from meteorprep.segment.silhouette import match_sky_level
    lvl_ctx: dict = {}      # the band above the treeline, worked out once
    fg_ref = match_sky_level(fg_ref, base_img, sky_fg, ctx=lvl_ctx)
    from PIL import Image
    Image.fromarray((np.clip(sky_fg, 0, 1) * 255).astype(np.uint8)).save(
        _skymask_path)
    fg_layers = [Layer(name="FG_base_time", rgb=fg_ref,
                       alpha=fg_alpha, blend="normal", visible=True)]
    if fg_stack is not None and tripod_bump:
        # the camera moved partway through the night, so this average is
        # two horizons on top of each other.  Dropping it also drops it
        # out of preview.jpg, which prefers it when it exists.
        log.info("frozen-ground stack dropped: the tripod moved at %s",
                 tripod_bump["file"])
        fg_stack = None
    if fg_stack is not None:
        fg_stack = match_sky_level(_fit_output(fg_stack), base_img, sky_fg,
                                   ctx=lvl_ctx)
    if fg_stack is not None:
        # frozen-ground stack: all frames averaged in camera space — far
        # lower noise than any single frame's foreground
        fg_layers.insert(0, Layer(name="FG_stacked_low_noise", rgb=fg_stack,
                                  alpha=fg_alpha, blend="normal",
                                  visible=False))
    for i in np.nonzero(lp)[0]:
        rgb_lp = _fit_output(raw_mod.decode(frames[i].path, "final",
                                            bad_pixels,
                                            half_size=cfg.half_size))
        fg_layers.append(Layer(name=f"FG_lightpaint_{frames[i].file}",
                               rgb=rgb_lp,
                               alpha=fg_alpha, blend="normal",
                               visible=False))

    def to_layers(pairs, visible, start=0):
        # ``start`` continues the M-numbering across the two groups.
        # Restarting it inside FLAGGED put a second M001 in the same
        # document, and dragging a mislabelled layer from FLAGGED into
        # METEORS — the one repair the guide tells people to make —
        # then produced two layers with the same number.
        out = []
        for k, (c, layer, i, si) in enumerate(pairs):
            rgb_l, alpha_l, bbox_l = layer.rgb, layer.alpha, layer.bbox
            if crop is not None and bbox_l is not None:
                x0, y0, x1, y1 = bbox_l
                nx0, ny0 = max(x0 - crop[0], 0), max(y0 - crop[1], 0)
                nx1 = min(x1 - crop[0], w)
                ny1 = min(y1 - crop[1], h)
                if nx1 <= nx0 or ny1 <= ny0:
                    continue          # fell entirely inside the cropped rim
                sx0, sy0 = nx0 + crop[0] - x0, ny0 + crop[1] - y0
                sx1, sy1 = sx0 + (nx1 - nx0), sy0 + (ny1 - ny0)
                rgb_l = rgb_l[sy0:sy1, sx0:sx1]
                alpha_l = (alpha_l[sy0:sy1, sx0:sx1]
                           if alpha_l is not None else None)
                bbox_l = (nx0, ny0, nx1, ny1)
            flag = candidate_flag(c)
            name = meteor_layer_name(
                start + k + 1, c.frames[min(si, len(c.frames) - 1)],
                frames[i].epoch_mid.astimezone(timezone.utc).isoformat(),
                c.rotation_deg, c.confidence, flag, c.physics)
            # Screen, not Lighten: the layer holds the streak's own added
            # light, so screening it onto the sky is the physical
            # composite and leaves no box edge where the layer is zero
            out.append(Layer(name=name, rgb=rgb_l, alpha=alpha_l,
                             bbox=bbox_l, blend="screen", visible=visible))
        return out

    # The sky-tools layers are two more full-canvas images, and they
    # exist to be toggled inside the Photoshop file.  A quick look does
    # not write one, so it was building a quarter of a gigabyte apiece to
    # throw away unwritten.  (The colour calibration itself is kept — the
    # preview uses its gains.)
    want_layers = bool(cfg.emit_psd or cfg.emit_pngjsx)
    extra_layers = []
    color_cal = None
    if base_wcs is not None:
        from meteorprep.calibrate import star_white_balance
        canvas_wcs = base_wcs
        if crop is not None:
            canvas_wcs = base_wcs.deepcopy()
            canvas_wcs.wcs.crpix = [base_wcs.wcs.crpix[0] - crop[0],
                                    base_wcs.wcs.crpix[1] - crop[1]]
        try:
            color_cal = star_white_balance(base_img, canvas_wcs, blind_catalog)
        except Exception as exc:
            log.warning("star colour calibration failed: %s", exc)
        if color_cal is not None and want_layers:
            g_ = np.asarray(color_cal["gains"], np.float32)
            extra_layers.append(Layer(
                name="BASE_SKY_star_calibrated_colors",
                rgb=np.clip(base_img * g_[None, None, :], 0, 65535),
                blend="normal", visible=False))
    if cfg.emit_gradient_layer and want_layers:
        from meteorprep.stack.gradient import fit_sky_gradient
        grad = fit_sky_gradient(base_img, sky_mask)
        if grad is not None:
            extra_layers.append(Layer(
                name="SKY_GRADIENT_set_to_Subtract_to_flatten",
                rgb=grad, blend="subtract", visible=False))
    # the foreground layers are transparent above the treeline; storing
    # and compressing that half of the canvas helps nobody
    from meteorprep.assemble.layers import crop_layers_to_alpha
    crop_layers_to_alpha(fg_layers, fg_alpha)
    stack = LayerStack(
        width=w, height=h,
        base=Layer(name="BASE_SKY", rgb=base_img, blend="normal", visible=True),
        groups=[
            LayerGroup("SKY_TOOLS", extra_layers, visible=False)
            if extra_layers else LayerGroup("SKY_TOOLS", [], visible=False),
            LayerGroup("FOREGROUND", fg_layers, visible=True),
        ] + ([
            LayerGroup("METEORS", to_layers(meteor_layers, True),
                       visible=True),
            LayerGroup("FLAGGED",
                       to_layers(flagged_layers, False,
                                 start=len(meteor_layers)),
                       visible=False),
            # a nightscape build carries no empty METEORS drawer — a
            # composite is not a meteor hunt that found nothing
        ] if want_meteors else []))

    outputs = {}
    psd_path = None
    sw("assemble: layer stack built")
    if cfg.emit_psd:
        psd_path = write_psd(stack, out_dir / "meteorprep.psd")
        sw("assemble: PSD written")
        if psd_path:
            outputs["psd"] = str(psd_path)
    # the PNG + script fallback duplicates the PSD's content (~0.5 GB on
    # a full night): emit it when asked for, or automatically as the
    # safety net whenever the PSD could not be written
    if cfg.emit_pngjsx or (cfg.emit_psd and psd_path is None):
        if not cfg.emit_pngjsx:
            log.warning("Photoshop file could not be written — emitting "
                        "the PNG + script fallback instead")
        outputs["jsx"] = str(write_pngjsx(stack, out_dir))
    if cfg.emit_contact_sheet and candidates:
        cs = make_contact_sheet(candidates, roi_images,
                                out_dir / "contact_sheet.png")
        if cs:
            outputs["contact_sheet"] = str(cs)

    # ready-to-view preview + one-click report: nobody should need a
    # Photoshop session just to SEE their night
    mark("assembling the layered files")
    notify(0.96, "rendering the preview")
    from meteorprep.report.preview import render_preview
    gains = (np.asarray(color_cal["gains"], np.float32)
             if color_cal else None)
    # both are already level-matched to BASE_SKY above; preview must not
    # match a second time (that made the preview and the PSD disagree)
    fg_for_preview = fg_stack if fg_stack is not None else fg_ref
    pv = render_preview(base_img, fg_for_preview, sky_fg,
                        gains, meteor_layers, out_dir / "preview.jpg",
                        flagged_layers=flagged_layers,
                        all_trails_path=out_dir / "preview_all_trails.jpg",
                        crop_xy=((crop[0], crop[1]) if crop is not None
                                 else (0, 0)))
    sw("preview: render")
    if pv:
        outputs["preview"] = str(pv["preview"])
        if pv.get("all_trails"):
            outputs["preview_all_trails"] = str(pv["all_trails"])
    if cfg.emit_startrail:
        # rendered for free inside stack pass 2 (camera-space lighten-max)
        if cache.path("startrail.tif").exists():
            # A copy, not a hardlink.  They are the same 75 MB of bytes
            # and the link was free, but the delivered file is the user's
            # to open and edit — and an editor that writes in place would
            # have been rewriting the cache, so the next resumed run
            # would deliver the edited file back as if the stack had
            # produced it.
            import shutil as _sh
            _sh.copyfile(cache.path("startrail.tif"),
                         out_dir / "startrail.tif")
        else:                     # cache from an older run: render classic
            trail = lighten_stack(
                lambda i: raw_mod.decode(frames[i].path, "final",
                                         bad_pixels,
                                         half_size=cfg.half_size)
                .astype(np.float32), n)
            _write_cache_tif(out_dir / "startrail.tif",
                             np.clip(trail, 0, 65535).astype(np.uint16))
        outputs["startrail"] = str(out_dir / "startrail.tif")
        # ready-to-share star-trail JPG next to the editable TIFF
        try:
            import tifffile as _tf
            from meteorprep.report.preview import render_startrail
            st = render_startrail(
                _tf.imread(out_dir / "startrail.tif").astype(np.float32),
                gains, out_dir / "startrail.jpg")
            if st:
                outputs["startrail_jpg"] = str(st)
        except Exception as exc:
            log.warning("star-trail JPG render failed: %s", exc)

    sidecar = write_sidecar(
        out_dir / "meteorprep.json", cfg, group.group_id, base_meta.file,
        base_wcs, pole_xy, radiant, frames, candidates,
        alignment_quality, solver_used, solve_files,
        color_calibration=color_cal,
        crop_xy=((crop[0], crop[1]) if crop is not None else None),
        site={"lat": site_lat, "lon": site_lon, "source": site_source})
    outputs["sidecar"] = str(sidecar)
    from meteorprep.report.html import (render_candidate_crops,
                                        write_report_html)
    sw("report: sidecar + capsule")
    crops = render_candidate_crops(candidates,
                                   meteor_layers + flagged_layers,
                                   roi_images, out_dir)
    mark("preview + report")
    # -------- evidence bundle (2.0 plan, Phase 1 lite) --------
    try:
        import cv2 as _cv2
        evd = out_dir / "evidence"
        evd.mkdir(exist_ok=True)

        def _gray_png(arr, path, hi=None):
            """These are 1400-pixel-wide look-at-it maps.  Everything used
            to run at the full 20 MP first — a float copy, a percentile
            over twenty million values, a clip and a cast — and only then
            shrink.  The percentile now comes from a 1-in-16 sample of the
            real data (same number to three figures) and the arithmetic
            happens after the shrink."""
            a = np.asarray(arr)
            if a.dtype not in (np.uint8, np.uint16, np.float32):
                a = a.astype(np.float32)   # what cv2.resize will take
            if not hi:          # None, or a max of zero on an empty map
                hi = max(float(np.percentile(
                    a[::4, ::4].astype(np.float32), 99.5)), 1e-6)
            hh, ww2 = a.shape[:2]
            if ww2 > 1400:
                # shrink in the map's own dtype.  Converting the whole
                # canvas to float32 up front built an 80 MB temporary per
                # map, five maps deep into the most memory-hungry minute
                # of the run, to make a 1400-pixel picture.  Box-averaging
                # an integer map rounds, so a pixel here and there lands
                # one grey level off what the float path gave; these are
                # pictures to look at, not measurements.
                a = _cv2.resize(a, (1400, int(hh * 1400 / ww2)),
                                interpolation=_cv2.INTER_AREA)
            a = np.asarray(a, np.float32)
            g8 = np.clip(a * (255.0 / hi), 0, 255).astype(np.uint8)
            _cv2.imwrite(str(path), g8)

        ev_stats = {}
        if coverage is not None:
            cov = coverage
            if crop is not None:
                cov = coverage[crop[1]:crop[3], crop[0]:crop[2]]
            _gray_png(cov, evd / "coverage.png", hi=float(cov.max()))
            ev_stats["coverage"] = (f"{int(cov.min())}–{int(cov.max())} "
                                    f"frames/px (median "
                                    f"{int(np.median(cov))})")
        if cache.path("noise_half.npy").exists():
            nm = np.load(cache.path("noise_half.npy")).astype(np.float32)
            nm = nm.mean(axis=2) if nm.ndim == 3 else nm
            _gray_png(nm, evd / "noise.png")
            ev_stats["sky noise per frame"] = (
                f"~{float(np.median(nm)):.0f} ADU (median, 16-bit)")
        rej = rejected
        if rej is not None and crop is not None:
            rej = rej[crop[1]:crop[3], crop[0]:crop[2]]
        if rej is not None and rej.shape[:2] == base_img.shape[:2]:
            _gray_png(rej, evd / "rejected.png",
                      hi=max(float(np.percentile(rej[::4, ::4], 99.9)), 1.0))
            n_any = float((rej > 0).mean())
            ev_stats["outliers removed"] = (
                f"{n_any * 100:.1f}% of pixels had at least one frame "
                f"clipped away (max {int(rej.max())} frames on one pixel)")
        if cache.path("removed_half.npy").exists():
            rem = np.load(cache.path("removed_half.npy")).astype(np.float32)
            if crop is not None:
                rem = rem[crop[1] // 2:crop[3] // 2,
                          crop[0] // 2:crop[2] // 2]
            _gray_png(rem, evd / "removed.png")
        # ---- Evidence Ledger: per-pixel lineage, one indexed image ----
        if rej is not None and coverage is not None:
            cov_c = (coverage[crop[1]:crop[3], crop[0]:crop[2]]
                     if crop is not None else coverage)
            from meteorprep.report.evidence import (evidence_ledger,
                                                     ledger_bgr)
            led, legend = evidence_ledger(cov_c, rej, sky_fg)
            # ledger_bgr, not cvtColor(ledger_rgb(...)): the palette can
            # be taken in the byte order the writer wants, and that saves
            # a second full-canvas copy at the tightest moment of the run
            _cv2.imwrite(str(evd / "ledger.png"), ledger_bgr(led))
            (evd / "ledger_legend.json").write_text(
                __import__("json").dumps(legend, indent=1))
            ev_stats["lineage"] = "; ".join(
                f"{v['label']} {v['percent']:.1f}%" for v in legend
                if v["percent"] >= 0.05)
    except Exception as exc:
        log.warning("evidence maps skipped: %s", exc)
        ev_stats = {}

    total_exp = sum(float(frames[i].exposure_s or 0) for i in ok_idx)
    n_faint = sum(1 for c in candidates
                  if c.flags.get("faint_harvest"))
    info = {"star solver": solver_used,
            # NaN is the "not measured" sentinel and NaN is truthy, so
            # a plain truth test printed "nan px RMS" at people
            "star-lock accuracy": f"{base_meta.solve_rms_px:.2f} px RMS"
            if np.isfinite(base_meta.solve_rms_px or float("nan"))
            else "n/a",
            "lens correction k1": f"{k1:+.4f}" if abs(k1) > 1e-9
            else "none needed",
            "photos stacked": f"{len(ok_idx)} of {n}",
            "integration": f"{total_exp / 60:.0f} min of exposure "
                           f"({len(ok_idx)} x "
                           f"{total_exp / max(len(ok_idx), 1):.0f}s)",
            "faint-pass meteors": (str(n_faint) if want_meteors
                                   else "the hunt was off"),
            "generated pixels": "none — every trail is measured light, "
                                "at its true sky position",
            "recipe hash": cfg.params_hash()[:23]}
    if cfg.draft:
        info["mode"] = ("draft — half-resolution picture, no layered file, "
                        "no second look for faint meteors")
    if not want_meteors:
        info["meteor hunt"] = ("off — this run built the composite; tick "
                               "'Hunt for meteors' and run the same folder "
                               "to search it (the sky work is reused)")
    if tripod_bump:
        info["camera moved"] = (
            f"the tripod was knocked at {tripod_bump['file']} "
            f"({tripod_bump['shift_px']:.0f} px) — the stars and meteors "
            f"are unaffected, but the low-noise averaged foreground was "
            f"left out; use the single-photo FOREGROUND layer")
    if site_source:
        info["observing location"] = (
            f"{site_lat:+.4f}, {site_lon:+.4f} — from {site_source}")
    else:
        info["observing location"] = (
            "not known, so no height/distance/duration estimates — type "
            "your latitude, longitude into the app (or turn the camera's "
            "GPS on) and they appear next run")
    info.update(ev_stats)
    if color_cal is not None:
        gn = color_cal["gains"]
        info["star colour calibration"] = (
            f"R x{gn[0]:.3f}  G x{gn[1]:.3f}  B x{gn[2]:.3f} "
            f"({color_cal.get('n_stars', '?')} stars)")
    for lbl, secs in timings:
        log.info("stage timing: %-32s %6.1fs", lbl, secs)
    looks = []
    if "preview" in outputs:
        looks.append(("preview.jpg", "Meteors",
                      "the clean sky with every meteor brightened"))
    if "preview_all_trails" in outputs:
        looks.append(("preview_all_trails.jpg", "Meteors + satellites",
                      "every detected trail — meteors, satellites, "
                      "planes — at its true place in the sky"))
    if "startrail_jpg" in outputs:
        looks.append(("startrail.jpg", "Star trails",
                      "the whole night in one arc: stars trail, the "
                      "ground stays frozen"))
    # the share capsule: the picture's own receipts, in a file that can
    # be pasted under a post
    capsule = {}
    try:
        import json as _json

        from meteorprep.report import capsule as _cap
        capsule = _cap.build({"n_meteors": len(meteor_cands)}, info,
                             _json.loads(Path(sidecar).read_text()))
        outputs["capsule"] = str(_cap.write(out_dir, capsule))
    except Exception as exc:
        log.warning("share capsule skipped: %s", exc)
    sw("report: candidate crops")
    outputs["report"] = str(write_report_html(
        out_dir,
        {"candidates": [c.to_dict() for c in candidates],
         "alignment_quality": alignment_quality},
        have_preview="preview" in outputs,
        have_contact="contact_sheet" in outputs,
        have_psd="psd" in outputs,
        crops=crops, timings=timings, info=info, looks=looks,
        capsule=capsule, draft=cfg.draft,
        have_pngjsx="jsx" in outputs, meteor_hunt=want_meteors))
    if cfg.cleanup_cache:
        import shutil as _shutil
        _shutil.rmtree(det_lum_dir, ignore_errors=True)
        _shutil.rmtree(diff_dir, ignore_errors=True)
        if not cfg.draft and det_dir.is_dir():
            # A draft keeps the aligned previews AND their stage marker:
            # the full run that usually follows reads exactly these
            # files, and deleting without invalidating would be no
            # better, because stage_fresh("reproject") reads only the
            # marker.  On a full run the mid-run cleanup above has
            # normally already done this — hence the is_dir() test, so
            # the log does not say the same thing twice under two names.
            # (base.tif / fg_stack.tif / coverage.npy survive cleanup, so
            # the stack itself stays valid and resumable.)
            _shutil.rmtree(det_dir, ignore_errors=True)
            cache.invalidate("reproject")
            log.info("freed the detection cache (%s)", det_dir.name)
    if skipped:
        log.info("%d stage(s) up-to-date, skipped", skipped)
    if want_meteors:
        notify(1.0, f"done: {len(meteor_cands)} meteor(s), "
                    f"{len(flagged_cands)} flagged candidate(s)")
    else:
        notify(1.0, "done: your composite is ready")
    return {"group": group.group_id, "outputs": outputs,
            "n_meteors": len(meteor_cands), "n_flagged": len(flagged_cands),
            "alignment_quality": alignment_quality,
            "timings": [(lbl, round(secs, 2)) for lbl, secs in timings],
            "candidates": [c.to_dict() for c in candidates]}


# ----------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------

# Every geometry tolerance in the gauntlet below is a distance in pixels
# ON THE OUTPUT CANVAS, and that canvas is half as wide at half size.
# The numbers were tuned against full-size runs, so they are stated
# relative to that canvas and scaled to whichever one is being built —
# without this a Quick look ran every one of these tests at twice the
# permissiveness of a Full quality run of the same night, which is
# exactly the promise the window makes and would have been breaking.
_TUNED_SCALE = 2.0


def _absorb_track_fragments(candidates, file_to_idx, frames=None,
                            scale=_TUNED_SCALE) -> None:
    """A short detection that escaped track-linking shows up as a
    single-frame "meteor" even though it is really a piece of a satellite
    or aircraft pass.  Absorb any single-frame meteor that is collinear
    with a multi-frame track and sits where that track's motion says it
    should be at the fragment's frame time: it inherits the track's label
    (so it lands in FLAGGED, not METEORS)."""
    px = float(scale) / _TUNED_SCALE       # canvas-relative tolerances
    multi = [c for c in candidates
             if c.label != "meteor" and len(set(c.frames)) >= 2]
    for c in (candidates if multi else []):
        if c.label != "meteor" or len(set(c.frames)) > 1:
            continue
        s = c.streaks[0]
        fi = file_to_idx.get(c.frames[0])
        mid = np.array([(s.x0 + s.x1) / 2.0, (s.y0 + s.y1) / 2.0])
        d_c = np.array([s.x1 - s.x0, s.y1 - s.y0], float)
        d_c /= np.linalg.norm(d_c) + 1e-9
        for t in multi:
            t_first, t_last = t.streaks[0], t.streaks[-1]
            i0 = file_to_idx.get(t.frames[0])
            i1 = file_to_idx.get(t.frames[-1])
            a = np.array([t_first.x0, t_first.y0], float)
            b = np.array([t_last.x1, t_last.y1], float)
            d_t = b - a
            span = np.linalg.norm(d_t)
            if span < 1e-6 or None in (fi, i0, i1) or i1 == i0:
                continue
            d_t /= span
            if abs(float(d_c @ d_t)) < np.cos(np.deg2rad(15.0)):
                continue
            perp = abs(float((mid - a) @ np.array([-d_t[1], d_t[0]])))
            if perp > 60.0 * px:
                continue
            # where the track's own motion puts it at the fragment's time
            along = float((mid - a) @ d_t)
            expect = span * (fi - i0) / float(i1 - i0)
            if abs(along - expect) > max(1.0 * span, 150.0 * px):
                continue
            log.info("candidate %s reclassified: fragment of a %s track",
                     c.id, t.label)
            c.label = t.label
            c.confidence = min(c.confidence, t.confidence)
            break
    # pair rule: a meteor lasts under ~2 s and cannot appear in two long
    # exposures — two collinear single-frame "meteors" in adjacent frames
    # whose connecting displacement lies along their own direction are one
    # object in steady motion: a satellite (or aircraft) the tracker
    # failed to link because only short bits of the trail were detected
    singles = [c for c in candidates
               if c.label == "meteor" and len(set(c.frames)) == 1]
    for ai in range(len(singles)):
        for bi in range(ai + 1, len(singles)):
            ca, cb = singles[ai], singles[bi]
            ia = file_to_idx.get(ca.frames[0])
            ib = file_to_idx.get(cb.frames[0])
            if ia is None or ib is None or abs(ia - ib) > 2:
                continue
            sa, sb = ca.streaks[0], cb.streaks[0]
            mid_a = np.array([(sa.x0 + sa.x1) / 2.0, (sa.y0 + sa.y1) / 2.0])
            mid_b = np.array([(sb.x0 + sb.x1) / 2.0, (sb.y0 + sb.y1) / 2.0])
            hop = mid_b - mid_a
            hop_n = np.linalg.norm(hop)
            if hop_n < 20.0 * px:
                continue
            hop = hop / hop_n
            da = np.array([sa.x1 - sa.x0, sa.y1 - sa.y0], float)
            da /= np.linalg.norm(da) + 1e-9
            db = np.array([sb.x1 - sb.x0, sb.y1 - sb.y0], float)
            db /= np.linalg.norm(db) + 1e-9
            # During a shower every meteor is radiant-aligned, so
            # "parallel and along the line" is true of ordinary pairs of
            # real meteors — this rule was quietly demoting them to
            # satellites and hiding them in FLAGGED.  A satellite is not
            # just parallel: it draws its whole exposure's worth of
            # motion, so between frames it must hop by about the length
            # it drew, once per frame gap.  A pair whose separation does
            # not match its own trail length is two objects, not one.
            la = float(np.hypot(sa.x1 - sa.x0, sa.y1 - sa.y0))
            lb = float(np.hypot(sb.x1 - sb.x0, sb.y1 - sb.y0))
            if max(la, lb) > 2.5 * max(min(la, lb), 1e-6):
                continue                  # different-length trails
            # How far a steadily moving object travels between two frames
            # is not a guess: it is the trail it drew during one exposure,
            # times the ratio of the frame interval to that exposure.  The
            # camera's own clock supplies both numbers.
            ratio = float(max(abs(ia - ib), 1))
            if frames is not None:
                try:
                    dt = abs((frames[ib].epoch_mid
                              - frames[ia].epoch_mid).total_seconds())
                    exp = float(frames[ia].exposure_s or 0.0)
                    if exp > 0 and dt > 0:
                        ratio = dt / exp
                except Exception:
                    pass
            expect = 0.5 * (la + lb) * ratio
            if not (0.6 * expect <= hop_n <= 1.7 * expect):
                continue                  # not steady motion at its own rate
            lim = np.cos(np.deg2rad(12.0))
            if (abs(float(da @ db)) >= lim and abs(float(da @ hop)) >= lim
                    and abs(float(db @ hop)) >= lim):
                for c in (ca, cb):
                    log.info("candidate %s reclassified: steady motion "
                             "across frames — satellite, not meteor", c.id)
                    c.label = "satellite"
                    c.confidence = max(ca.confidence, cb.confidence)
    _demote_regular_sequences(candidates, file_to_idx, frames,
                              scale=scale)


def _demote_regular_sequences(candidates, file_to_idx, frames=None,
                              perp_tol=70.0, min_members=3,
                              scale=_TUNED_SCALE) -> None:
    """A satellite that only glints does not draw its whole path: it
    leaves a short dash in each frame, far apart, so the steady-motion
    test above (hop must match the trail it drew) correctly refuses it.
    What gives it away instead is repetition — three or more short
    streaks on one line, evenly spaced in time.  Two are not enough: on a
    shower night two real meteors are parallel by definition and land on
    a common line often enough to matter, and demoting them hides real
    meteors in FLAGGED, which is the more expensive mistake.
    """
    px = float(scale) / _TUNED_SCALE       # canvas-relative tolerances
    singles = [c for c in candidates
               if c.label == "meteor" and len(set(c.frames)) == 1]
    if len(singles) < min_members:
        return

    def mid(c):
        s = c.streaks[0]
        return np.array([(s.x0 + s.x1) / 2.0, (s.y0 + s.y1) / 2.0])

    def when(c):
        i = file_to_idx.get(c.frames[0])
        if frames is not None and i is not None:
            try:
                return frames[i].epoch_mid.timestamp()
            except Exception:
                pass
        return float(i if i is not None else 0)

    used = set()
    for ai, ca in enumerate(singles):
        if id(ca) in used:
            continue
        a0 = mid(ca)
        sa = ca.streaks[0]
        d = np.array([sa.x1 - sa.x0, sa.y1 - sa.y0], float)
        n = np.linalg.norm(d)
        if n < 1e-6:
            continue
        d /= n
        perp = np.array([-d[1], d[0]])
        group = [ca]
        for cb in singles[ai + 1:]:
            if id(cb) in used or cb is ca:
                continue
            sb = cb.streaks[0]
            db = np.array([sb.x1 - sb.x0, sb.y1 - sb.y0], float)
            nb = np.linalg.norm(db)
            if nb < 1e-6:
                continue
            db /= nb
            if abs(float(d @ db)) < np.cos(np.deg2rad(12.0)):
                continue
            off = mid(cb) - a0
            if abs(float(off @ perp)) > perp_tol * px:
                continue
            group.append(cb)
        if len(group) < min_members:
            continue
        # evenly spaced in TIME along the line?  A satellite's speed is
        # constant; unrelated meteors on a shared line are not.
        group.sort(key=when)
        t = np.array([when(c) for c in group], float)
        along = np.array([float((mid(c) - a0) @ d) for c in group], float)
        if np.ptp(t) <= 0 or np.ptp(along) <= 0:
            continue
        A = np.vstack([t - t[0], np.ones_like(t)]).T
        coef, *_ = np.linalg.lstsq(A, along, rcond=None)
        resid = float(np.max(np.abs(A @ coef - along)))
        if resid > 0.15 * float(np.ptp(along)):
            continue
        for c in group:
            used.add(id(c))
            log.info("candidate %s reclassified: one of %d evenly spaced "
                     "streaks on a single line — a glinting satellite, "
                     "not %d separate meteors", c.id, len(group), len(group))
            c.label = "satellite"
            c.confidence = 0.6


def _measure_candidate_colors(candidates, frames, det_wcs, base_det_wcs,
                              shape_det, S, bad_pixels, k1=0.0) -> None:
    """Lazy colour measurement (§3.6): only candidate frames are re-decoded
    for RGB, against an aligned neighbour so stars cancel."""
    if base_det_wcs is None:
        return
    file_to_idx = {m.file: i for i, m in enumerate(frames)}

    def det_rgb(i):
        rgb = raw_mod.decode(frames[i].path, "detect", bad_pixels,
                             half_size=True)
        distort = (Poly3Distortion(k1, rgb.shape[:2]).distort
                   if abs(k1) > 1e-9 else None)
        arr, _ = reproject_frame(rgb, det_wcs[i], base_det_wcs, shape_det,
                                 quality=False, distort=distort)
        return arr.astype(np.float32)

    cache: dict[int, np.ndarray] = {}
    _CAP = 6                    # a developed frame here is ~60 MB

    def get(i):
        if i not in cache:
            while len(cache) >= _CAP:
                cache.pop(next(iter(cache)))
            cache[i] = det_rgb(i)
        return cache[i]

    n = len(frames)

    def _prefetch(idx):
        """Develop the frames this candidate needs, together.  Each is a
        RAW decode — a second apiece one at a time — and LibRaw releases
        the GIL, so a small pool overlaps them.  Per candidate, not for
        the whole night at once: a busy night has dozens of candidates
        and this cache is capped for a reason."""
        # Decide what this candidate gets to hold FIRST, then evict
        # everything else, then decode what is missing.  Two earlier
        # shapes of this were wrong in opposite directions: evicting only
        # the frames this candidate does not need let the batch sit on
        # top of the cap (720 MB of developed frames on the machine that
        # has 8 GB), and evicting needed frames to make room threw away
        # exactly what the batch was about to be asked for, so they came
        # back one slow decode at a time inside the measuring loop —
        # twice the RAW reads of the version with the bug.
        want = list(dict.fromkeys(idx))[:_CAP]
        for k in [k for k in cache if k not in want]:
            cache.pop(k, None)
        todo = [i for i in want if i not in cache]
        if len(todo) < 2:
            return
        try:
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=min(4, len(todo))) as tp:
                for i, arr in zip(todo, tp.map(det_rgb, todo)):
                    cache[i] = arr
        except Exception as exc:
            log.debug("parallel colour decode skipped: %s", exc)

    for c in candidates:
        need = []
        for frame_file in c.frames:
            i = file_to_idx[frame_file]
            need += [i, i - 1 if i > 0 else min(i + 1, n - 1)]
        _prefetch(need)
        rgs, bgs = [], []
        for frame_file, st in zip(c.frames, c.streaks):
            i = file_to_idx[frame_file]
            j = i - 1 if i > 0 else min(i + 1, n - 1)
            d = np.clip(get(i) - get(j), 0, None)
            p0 = (st.x0 / S, st.y0 / S)
            p1 = (st.x1 / S, st.y1 / S)
            rprof = _line_profile(d[..., 0], p0, p1)
            gprof = _line_profile(d[..., 1], p0, p1)
            bprof = _line_profile(d[..., 2], p0, p1)
            gmean = max(float(np.mean(gprof)), 1.0)
            st.color_rg = float(np.mean(rprof)) / gmean
            st.color_bg = float(np.mean(bprof)) / gmean
            rgs.append(st.color_rg)
            bgs.append(st.color_bg)
        if rgs:
            c.color_rgb = (float(np.mean(rgs)), float(np.mean(bgs)))


# below this many frames, pass 1 measures every frame; at or above it,
# every 2nd frame (the clip statistics are population estimates and
# converge long before that — the skipped frames' normalization surfaces
# are interpolated by _fill_norm_coef and they contribute fully in pass 2)
_STAT_SUBSET_MIN = 40


def _fill_norm_coef(all_coef: dict, ok_idx) -> dict:
    """Fill missing per-frame sky-surface coefficients by linear
    interpolation between the fitted temporal neighbours (constant-
    extended at the ends).  Sky surfaces drift smoothly through the
    night, so an interpolated surface is faithful for a skipped frame."""
    fitted = sorted(all_coef)
    if not fitted or len(all_coef) >= len(ok_idx):
        return all_coef
    f_arr = np.array(fitted)
    c_arr = np.array([np.asarray(all_coef[k], np.float32) for k in fitted])
    for i in ok_idx:
        if i in all_coef:
            continue
        pos = int(np.searchsorted(f_arr, i))
        if pos == 0:
            c = c_arr[0]
        elif pos >= len(f_arr):
            c = c_arr[-1]
        else:
            i0, i1 = int(f_arr[pos - 1]), int(f_arr[pos])
            t = (i - i0) / max(i1 - i0, 1)
            c = (1.0 - t) * c_arr[pos - 1] + t * c_arr[pos]
        all_coef[i] = c.tolist()
    return all_coef


def _stream_base(cfg, frames, ok_idx, det_wcs, base_wcs, base_det_wcs,
                 shape_out, S, corridor_segments, frame_weights, cache,
                 bad_pixels, notify, k1=0.0, sky_path=""):
    """Two-pass streaming sigma-clipped, noise-weighted stack at output
    resolution — the same rejection statistics as the leading stackers'
    kappa-sigma integration, with detected streaks additionally masked and
    per-frame noise weights, holding at most one frame in memory.  Pass 1
    (the clip statistics) runs at half resolution; pass 2 does the only
    full-resolution decode of each frame and also accumulates the
    unaligned "frozen ground" mean at no extra decode cost.

    Returns (base_rgb float32, foreground_rgb float32 | None,
    coverage uint16, trail, rejected uint16, removed_half float16):
    coverage counts contributing frames per pixel (it drives the
    seam-removing crop), rejected counts the samples sigma clipping threw
    away there, and removed_half is the light those samples carried.
    """
    h, w = shape_out
    if cfg.draft and len(ok_idx) > max(int(cfg.draft_stack_max), 4):
        keep = max(int(cfg.draft_stack_max), 4)
        step = len(ok_idx) / float(keep)
        ok_idx = [ok_idx[min(int(k * step), len(ok_idx) - 1)]
                  for k in range(keep)]
        # spread across the night, so twilight and the darkest hour both
        # get a say in the sky the draft shows
        ok_idx = sorted(dict.fromkeys(ok_idx))
        log.info("draft: the background sky is stacked from %d photos "
                 "spread across the night (every meteor still comes from "
                 "its own photo)", len(ok_idx))
    tmp = cache.dir("stack_tmp")
    # a crashed or interrupted earlier run leaves ~GB of stale part files
    # here — never let them eat the disk a second time
    for pattern in ("*.npy", "*.dat"):
        for stale in tmp.glob(pattern):
            stale.unlink(missing_ok=True)
    for stale in tmp.glob("prog_*.txt"):
        stale.unlink(missing_ok=True)

    shared_sets: dict = {}

    def shared_for(mode, worker_id):
        """A worker's shared accumulator block, created on first use.
        Only the full-resolution pass uses them: the statistics pass's
        parts are a fraction of the size and are left on disk."""
        if mode == "moments":
            return None
        if worker_id not in shared_sets:
            try:
                shared_sets[worker_id] = _SharedAccums((h, w), tmp,
                                                       worker_id)
            except Exception as exc:      # no /dev/shm, tiny box, sandbox
                log.info("shared memory unavailable (%s); the stack will "
                         "hand its parts over as files", exc)
                shared_sets[worker_id] = None
        st = shared_sets[worker_id]
        return None if st is None else st.spec

    def free_shared():
        for st in shared_sets.values():
            if st is not None:
                st.close()
        shared_sets.clear()

    def frame_args(mode, indices, worker_id, want_fg=False,
                   want_trail=False):
        return (mode, list(indices),
                [str(frames[i].path) for i in indices],
                [_wcs_to_str(scale_wcs(det_wcs[i],
                                       1 if cfg.half_size else 2))
                 if base_det_wcs is not None else "" for i in indices],
                _wcs_to_str(base_wcs) if base_wcs is not None else "",
                (h, w),
                {i: corridor_segments[i] for i in indices
                 if i in corridor_segments},
                {i: frame_weights.get(i, 1.0) for i in indices},
                str(tmp), worker_id, cfg.half_size, bad_pixels,
                cfg.stack_sigma, want_fg, want_trail, k1, sky_path,
                shared_for(mode, worker_id), cv_threads)

    # How many workers fit is a question about the canvas, not about the
    # machine alone: a worker's peak scales with the output resolution
    # (measured 0.76 GB on a 5 MP draft canvas and 2.05 GB on the full
    # 20 MP one), and so does what the parent holds while merging.  The
    # old fixed tiers were written for the full-resolution case and gave
    # a draft on an 8 GB laptop two workers when six would fit.
    mp_out = (h * w) / 1e6
    peak_gb = 0.30 + 0.09 * mp_out
    reserve_gb = 2.0 + 0.07 * mp_out          # the OS, and this process
    budget = max(_available_ram_gb() - reserve_gb, 1.0)
    n_workers = max(min(int(budget // peak_gb), max(cfg.jobs, 1), 4), 1)

    import os as _os
    cv_threads = max((_os.cpu_count() or 4) // max(n_workers, 1), 1)

    # ONE spawn pool serves both passes: spawn startup re-imports the
    # numeric stack in every worker (seconds each), so pass 2 reuses the
    # warm workers pass 1 already paid for
    _pool_holder: dict = {"pool": None}

    def get_pool():
        if _pool_holder["pool"] is None:
            # exclusive: these are the memory-hungry workers, and the
            # search's idle ones would be holding memory this stage is
            # about to want.  No warm-up submission — forcing the imports
            # before the first real task was measured at 0.85s of pure
            # barrier; the workers spawn as their frames reach them.
            _pool_holder["pool"] = _shared_pool(n_workers, exclusive=True)
        return _pool_holder["pool"]

    def close_pool():
        p = _pool_holder["pool"]
        _pool_holder["pool"] = None
        if p is not None:
            _drop_shared_pool(n_workers)

    def run_pass(mode, frac0, frac1, label, want_fg=False,
                 want_trail=False, indices=None, on_result=None,
                 on_reset=None, in_order=False):
        """on_result(part) merges each worker's result AS IT LANDS, so the
        parent's ~GB of part loading/adding overlaps the slowest worker
        instead of running serially after every worker is done.  If the
        pool dies mid-merge, on_reset() zeroes the accumulators and the
        pass reruns on one core (the proven fallback)."""
        idx = ok_idx if indices is None else list(indices)
        merged = 0
        # Even with a single worker the pass goes through the pool: the
        # per-photo counter, the deadline and the clean fallback all live
        # on that path, and a machine small enough to get one worker is
        # exactly the one that sits longest on this stage.  Running it in
        # the parent used to mean no progress at all for the whole stack.
        if base_wcs is not None and n_workers >= 1 and len(idx) >= n_workers:
            # one chunk per worker: each part on disk costs up to ~0.9 GB
            # at 20 MP, so more chunks than workers once filled a laptop
            # drive mid-run.  Per-photo progress comes from the counter
            # files, not from chunk granularity.
            chunk_size = -(-len(idx) // n_workers)
            chunks = [idx[k:k + chunk_size]
                      for k in range(0, len(idx), chunk_size)]
            import time as _time
            from concurrent.futures import FIRST_COMPLETED, wait
            try:
                # spawn, not fork: see the alignment pool above
                pool = get_pool()
                futures = {pool.submit(
                    _stack_pass,
                    frame_args(mode, chunk, k, want_fg, want_trail)): k
                    for k, chunk in enumerate(chunks)}
                chunk_len = {k: len(c) for k, c in enumerate(chunks)}
                pending = set(futures)
                finished_frames = 0
                last_seen = -1
                deadline = _time.time() + 600 + 300 * len(idx)
                held, next_k = {}, 0
                while pending:
                    done_set, pending = wait(pending, timeout=2,
                                             return_when=FIRST_COMPLETED)
                    for fut in done_set:
                        if in_order:
                            # merging in completion order makes the result
                            # depend on which worker happened to finish
                            # first: floating-point addition is not
                            # associative, and downstream that moved the
                            # clip bounds enough to flip the keep/reject
                            # decision on a thousand pixels.  The parts
                            # are small here, so hold them and merge by
                            # worker number — same file every time.
                            held[futures[fut]] = fut.result()
                            # merge everything that is now contiguous from
                            # the front: worker 0's part can be folded in
                            # while workers 1 and 2 are still running, and
                            # the sum still lands in worker order
                            while next_k in held:
                                on_result(held.pop(next_k))
                                next_k += 1
                        else:
                            on_result(fut.result())
                        merged += 1
                        finished_frames += chunk_len[futures[fut]]
                    in_flight = 0
                    for fut, k in futures.items():
                        if not fut.done():
                            try:
                                in_flight += int(
                                    (tmp / f"prog_{mode}_{k}.txt")
                                    .read_text() or 0)
                            except (OSError, ValueError):
                                pass
                    # max(): a counter read can race its writer and
                    # come back empty — never step backwards
                    seen = max(min(finished_frames + in_flight,
                                   len(idx)), last_seen)
                    if seen != last_seen:
                        last_seen = seen
                        notify(frac0 + (frac1 - frac0) * seen / len(idx),
                               f"{label} (photo {seen}/{len(idx)})")
                    if _time.time() > deadline:
                        raise TimeoutError(f"{label} timed out")
                for k in sorted(held):        # any stragglers
                    on_result(held[k])
            except Exception as exc:
                close_pool()
                if _disk_full(exc):
                    # a one-core retry against a full disk fails the same
                    # way half an hour later — stop with a human message
                    raise RuntimeError(_DISK_FULL_MSG) from exc
                log.warning("parallel stacking failed (%s); one core", exc)
                # Shutting the pool down cancels the tasks still QUEUED;
                # a worker already inside its chunk keeps running, and it
                # keeps adding frames into the shared block it was given.
                # Zeroing those blocks and handing block 0 straight back
                # to the retry meant the survivor's frames were counted a
                # second time — a silent brightness and coverage error in
                # the finished starfield, with nothing in the log but
                # "one core".  Free every block the parallel attempt
                # handed out (a survivor keeps its own mapping alive and
                # scribbles into a segment nothing will read again), then
                # give the retry a worker id of its own so it can never
                # inherit a block or a part-file name someone else owns.
                free_shared()
                # reset unconditionally: an exception INSIDE the first
                # on_result leaves half-merged accumulators with merged
                # still 0, and the fallback must never double-count
                if on_reset is not None:
                    on_reset()
                elif merged:
                    raise
                merged = 0
        if not merged:
            try:
                on_result(_stack_pass(
                    frame_args(mode, idx, _RETRY_WID, want_fg, want_trail)))
            except Exception as exc:
                if _disk_full(exc):
                    raise RuntimeError(_DISK_FULL_MSG) from exc
                raise

    if base_wcs is None:
        return (_rotate2d_mean(cfg, frames, ok_idx, corridor_segments,
                               shape_out, bad_pixels),
                None, None, None, None, None)

    # -------- pass 1: per-pixel moments at half resolution ---------------
    import cv2 as _cv2

    from meteorprep.stack.streaming import RunningMoments
    want_fg = bool(cfg.emit_foreground_stack)
    hs, ws = h // 2, w // 2
    stat_idx = (ok_idx if len(ok_idx) < _STAT_SUBSET_MIN else ok_idx[::2])
    total = RunningMoments((hs, ws, 3))
    all_coef = {}
    all_bgs = {}

    def _merge_moments(p):
        all_bgs.update(p.get("bg", {}))
        all_coef.update(p.get("coef", {}))
        part = RunningMoments((hs, ws, 3))
        part.count = np.load(p["count"])
        part.mean = np.load(p["mean"])
        part.m2 = np.load(p["m2"])
        total.combine(part)
        for key in ("count", "mean", "m2"):   # merged: free the disk now
            Path(p[key]).unlink(missing_ok=True)

    def _reset_moments():
        nonlocal total
        total = RunningMoments((hs, ws, 3))
        all_coef.clear()
        all_bgs.clear()

    run_pass("moments", 0.60, 0.70, "measuring the sky (pass 1 of 2)",
             indices=stat_idx, on_result=_merge_moments,
             on_reset=_reset_moments, in_order=True)
    all_coef = _fill_norm_coef(all_coef, ok_idx)
    import json as _json
    (tmp / "norm_coef.json").write_text(_json.dumps(
        {str(k): v for k, v in all_coef.items()}))
    # clip statistics stay half-size on disk (~8x less I/O between the
    # passes); each pass-2 worker upsamples them in memory
    np.save(tmp / "clip_mean.npy", total.mean.astype(np.float32))
    std_map = total.std()
    np.save(tmp / "clip_bound.npy",
            (cfg.stack_sigma * std_map).astype(np.float32))
    # evidence bundle: the per-pixel temporal noise map is a kept product
    np.save(cache.path("noise_half.npy"), std_map.astype(np.float16))
    del std_map
    # The plain mean is only read band by band in the finalise below (as
    # the fallback where clipping rejected everything, and to work out
    # what was removed).  Holding the full-size upsample cost a quarter
    # of a gigabyte in the parent at the exact moment the workers' own
    # blocks were live; each band is now upsampled from the half-size
    # statistics as it is used — the same bilinear result.
    half_mean = total.mean
    mean_exact = (half_mean.shape[0] * 2 == h and half_mean.shape[1] * 2 == w)
    mean_full = (None if mean_exact else
                 _cv2.resize(half_mean, (w, h),
                             interpolation=_cv2.INTER_LINEAR))

    def _mean_rows(r0, r1):
        """Rows [r0, r1) of the full-resolution plain mean."""
        if mean_full is not None:
            return mean_full[r0:r1]
        hh = half_mean.shape[0]
        s0 = max((r0 // 2) - 1, 0)
        s1 = min(((r1 - 1) // 2) + 2, hh)
        blk = _cv2.resize(half_mean[s0:s1], (w, (s1 - s0) * 2),
                          interpolation=_cv2.INTER_LINEAR)
        off = r0 - s0 * 2
        return blk[off:off + (r1 - r0)]

    # -------- pass 2: sigma-clipped, frame-weighted mean (+ foreground) --
    want_trail = bool(cfg.emit_startrail)
    # float32, not float64: every worker already accumulates its own
    # partial sums in float32, so the parent's only job is to add at most
    # four of them together — float64 here would double 0.5 GB of
    # accumulator to 1 GB and quadruple the cost of the finalise
    # arithmetic without recovering a single bit the workers kept.
    total_sum = np.zeros((h, w, 3), np.float32)
    total_w = np.zeros((h, w, 3), np.float32)
    coverage = np.zeros((h, w), np.uint16)
    rejected = np.zeros((h, w), np.uint16)
    p2 = {"fg_sum": None, "fg_n": 0, "trail": None}

    def _merge_clipped(p):
        all_bgs.update(p.get("bg", {}))
        st = shared_sets.get(p.get("worker_id")) if p.get("shared") else None
        # in-place adds (+= would rebind the closed-over names)
        if st is not None:
            np.add(total_sum, st.arrays["csum"], out=total_sum)
            np.add(total_w, st.arrays["cwsum"], out=total_w)
            np.add(coverage, st.arrays["fcount"], out=coverage)
            np.add(rejected, st.arrays["rcount"], out=rejected)
        else:
            np.add(total_sum, np.load(p["csum"]), out=total_sum)
            np.add(total_w, np.load(p["cwsum"]), out=total_w)
            np.add(coverage, np.load(p["fcount"]), out=coverage)
            if "rcount" in p:
                np.add(rejected, np.load(p["rcount"]), out=rejected)
        if want_fg and "fg" in p:
            part_fg = np.load(p["fg"])
            if p2["fg_sum"] is None:
                p2["fg_sum"] = part_fg
            else:
                np.add(p2["fg_sum"], part_fg, out=p2["fg_sum"])
            p2["fg_n"] += p["fg_n"]
        if want_trail and "trail" in p:
            part_t = np.load(p["trail"])
            p2["trail"] = (part_t if p2["trail"] is None
                           else np.maximum(p2["trail"], part_t,
                                           out=p2["trail"]))
        for key in ("csum", "cwsum", "fcount", "rcount", "fg", "trail"):
            if key in p and isinstance(p[key], str):
                Path(p[key]).unlink(missing_ok=True)   # merged: free it
        # This worker's shared block is now fully folded into the totals
        # and nothing will read it again.  Each one is half a gigabyte at
        # 20 MP; holding all of them until the end of the pass put three
        # of them in the parent at once for no reason.
        wid = p.get("worker_id")
        if st is not None and wid in shared_sets:
            st.close()
            shared_sets.pop(wid, None)

    def _reset_clipped():
        total_sum[:] = 0
        total_w[:] = 0
        coverage[:] = 0
        rejected[:] = 0
        # No st.zero() loop here any more.  run_pass frees every shared
        # block before it calls this, so there is nothing left to zero —
        # and zeroing a block that a worker which outlived the shutdown
        # is still writing into never helped anyway.
        p2.update(fg_sum=None, fg_n=0, trail=None)

    tick = _stopwatch()
    try:
        # in_order: the parent adds each worker's partial sums into one
        # float32 accumulator, and float addition is not associative, so
        # merging in completion order made the finished stack depend on
        # which worker happened to finish first.  (It was hidden while
        # the parent accumulated in float64 — wide enough to absorb the
        # difference before it was rounded back down.)  The merge drains
        # the contiguous prefix as it lands, so worker 0 still folds in
        # while 1 and 2 are running; only the order is pinned.
        run_pass("clipped", 0.70, 0.80,
                 "building the clean starfield (pass 2 of 2)", want_fg,
                 want_trail, on_result=_merge_clipped,
                 on_reset=_reset_clipped, in_order=True)
    finally:
        close_pool()
        tick("pass2 + merge")
        free_shared()
        tick("free shared")
    fg = ((p2["fg_sum"] / max(p2["fg_n"], 1))
          if want_fg and p2["fg_n"] else None)
    trail = p2["trail"]
    p2["fg_sum"] = None
    # frames were normalised against their own sky surface: the AVERAGE
    # surface goes back on, so the true mean sky (and its gradient)
    # survives — only the frame-to-frame differences were removed
    mean_sky = None
    if all_bgs or all_coef:
        eff = []
        for i, bgv in all_bgs.items():
            c = np.zeros((3, 6), np.float32)
            got = all_coef.get(i, all_coef.get(str(i)))
            if got is not None:
                c = np.asarray(got, np.float32)
            else:
                c[:, 0] = np.asarray(bgv, np.float32)
            eff.append(c)
        mean_sky = np.mean(eff, axis=0)

    # ---- finalise in row bands ----------------------------------------
    # The whole-array form of this (divide, np.where, a full-frame
    # difference, then a separate sky add) built six 0.5 GB temporaries
    # and took 7s of the stage; one banded pass writes each output pixel
    # once and never allocates more than a band.
    from meteorprep.stack.gradient import eval_frame_sky
    base = np.empty((h, w, 3), np.float32)
    rem_full = np.empty((h, w), np.float32)
    scratch = np.empty((_CLIP_BAND, w, 3), np.float32)
    for r0 in range(0, h, _CLIP_BAND):
        r1 = min(r0 + _CLIP_BAND, h)
        b = base[r0:r1]
        wb = total_w[r0:r1]
        mb = _mean_rows(r0, r1)
        d = scratch[:r1 - r0]
        np.maximum(wb, 1e-6, out=d)
        np.divide(total_sum[r0:r1], d, out=b)
        # pixels where clipping rejected everything fall back to the mean
        np.copyto(b, mb, where=(wb <= 0))
        # "show me what you removed": the plain mean minus the clipped
        # mean is exactly the light the rejection threw away
        np.subtract(mb, b, out=d)
        np.maximum(d, 0.0, out=d)
        np.mean(d, axis=2, out=rem_full[r0:r1])
        if mean_sky is not None:
            b += eval_frame_sky(mean_sky, h, w, r0, r1)
    del total_sum, total_w, mean_full, half_mean, scratch
    tick("banded finalise")

    # Kept at half size in float16 (~1/8 the memory of the full-res
    # float32 difference) — this is a look-at-it product, not a numeric
    # one.
    removed_half = None
    try:
        removed_half = _cv2.resize(rem_full, (w // 2, h // 2),
                                   interpolation=_cv2.INTER_AREA
                                   ).astype(np.float16)
    except Exception as exc:          # never lose a finished stack to this
        log.debug("residual map skipped: %s", exc)
    del rem_full
    import shutil as _shutil
    _shutil.rmtree(tmp, ignore_errors=True)
    tick("scratch cleanup")
    return (base, fg, coverage, trail, rejected, removed_half)


def _rotate2d_mean(cfg, frames, ok_idx, corridor_segments, shape_out,
                   bad_pixels) -> np.ndarray:
    """Degraded rotate2d path: serial masked mean."""
    from meteorprep.astrometry.reproject_frames import rotate2d_frame
    h, w = shape_out
    ssum = np.zeros((h, w, 3), np.float32)
    wsum = np.zeros((h, w), np.float32)
    base_mid = frames[ok_idx[len(ok_idx) // 2]].epoch_mid
    for i in ok_idx:
        rgb = raw_mod.decode(frames[i].path, "final", bad_pixels,
                             half_size=cfg.half_size)
        dt = (frames[i].epoch_mid - base_mid).total_seconds()
        arr, foot = rotate2d_frame(rgb, SIDEREAL_DEG_PER_SEC * dt,
                                   (w / 2.0, h / 2.0))
        ok = foot.astype(bool)
        if i in corridor_segments:
            scratch = np.zeros((h, w), np.uint8)
            _paint_segments(scratch, corridor_segments[i])
            ok &= scratch == 0
        ssum += arr.astype(np.float32) * ok[:, :, None]
        wsum += ok
    return (ssum / np.maximum(wsum, 1.0)[:, :, None]).astype(np.float32)


def _detected_for_verify(lum, undistort):
    from meteorprep.astrometry.solve import detect_stars
    stars = detect_stars(lum, max_stars=100)
    if undistort is not None and len(stars):
        stars = undistort(stars)
    return stars
