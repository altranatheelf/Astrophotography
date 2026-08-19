"""Deterministic, resumable pipeline orchestrator (§1.2).

Every mechanical/geometric step is automated; every aesthetic decision is
surfaced as a PSD layer toggle and never baked in (§8).

Disk strategy: the *search* for meteors runs on half-size decodes and only
caches small binned luminance images (~3 GB for a 226-frame night); the
clean starfield is a *streaming* masked mean at full resolution that never
touches the disk; only the handful of frames containing meteors are ever
reprojected at full quality, on demand.
"""

from __future__ import annotations

import logging
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
    _np.save(det_dir / f"lum_{i:04d}.npy",
             _np.clip(arr, 0, 65535).astype(_np.uint16))
    _np.save(det_dir / f"foot_{i:04d}.npy", foot.astype(_np.uint8))
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
    from meteorprep.detect.diff import difference

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
        d = difference(lums[i], ref.for_frame(i), foots[i])
        d_stat = d[sky_bin] if sky_bin is not None else d
        med = float(_np.median(d_stat))
        noise = 1.4826 * float(_np.median(_np.abs(d_stat - med))) + 1e-3
        if sky_bin is not None:
            d = d * sky_bin
        streaks = detect_streaks(d, i, cfg, rgb_diff=None, bin_factor=S)
        diff_path = ""
        if streaks:
            diff_path = str(diff_dir / f"diff_{i:04d}.npy")
            _np.save(diff_path, _np.clip(d, 0, 65535).astype(_np.uint16))
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
    "folders), then press Prepare again with 'Force re-run' UNCHECKED — "
    "it will resume from where it stopped instead of starting over.")


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


def _stack_pass(args) -> dict:
    """One streaming pass over a subset of frames.

    mode "moments": accumulate Welford per-pixel moments (mean/M2/count) for
    the sigma-clip bounds, and optionally an *unaligned* foreground sum (the
    ground is static on a fixed tripod, so the frozen-ground stack costs no
    extra decodes).  mode "clipped": accumulate the frame-weighted mean of
    samples within sigma of the pass-1 mean.  Returns saved .npy paths.
    Memory-conscious (float32, in-place); unreadable frames are skipped.
    """
    (mode, indices, paths, wcs_strs, base_wcs_str, shape_hw,
     segments_per_frame, frame_weights, tmp_dir_str, worker_id, half_size,
     bad_pixels, sigma, want_fg, want_trail, k1, sky_path) = args
    import json as _json

    import cv2 as _cv2
    import numpy as _np
    from meteorprep.astrometry.lensdistort import Poly3Distortion as _P3
    from meteorprep.astrometry.reproject_frames import reproject_frame as _rp
    from meteorprep.ingest import raw as _raw
    from meteorprep.stack.gradient import eval_frame_sky, fit_frame_sky
    from meteorprep.stack.streaming import RunningMoments

    h, w = shape_hw
    tmp = Path(tmp_dir_str)
    base_wcs = _wcs_from_str(base_wcs_str)
    bgs = {}
    sky_half = None
    if sky_path:
        sky_full = _np.load(sky_path)         # detection-scale sky mask
        sky_half = sky_full
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
        if clip_mean.shape[:2] != (h, w):     # stored half-size: upsample
            clip_mean = _cv2.resize(clip_mean, (w, h),
                                    interpolation=_cv2.INTER_LINEAR)
            clip_bound = _cv2.resize(clip_bound, (w, h),
                                     interpolation=_cv2.INTER_LINEAR)
        try:
            norm_coef = {int(k): _np.asarray(v, _np.float32) for k, v in
                         _json.loads((tmp / "norm_coef.json")
                                     .read_text()).items()}
        except (OSError, ValueError):
            norm_coef = {}
        ssum = _np.zeros((h, w, 3), _np.float32)
        wsum = _np.zeros((h, w, 3), _np.float32)
        fcount = _np.zeros((h, w), _np.uint16)   # coverage for the crop
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
    _q: Queue = Queue(maxsize=1)

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
    while True:
        item = _q.get()
        if item is None:
            break
        i, wstr, rgb = item
        try:                                # live per-photo progress
            (tmp / f"prog_{mode}_{worker_id}.txt").write_text(str(n_done))
        except OSError:
            pass
        n_done += 1
        if mode != "moments" and want_fg:
            if fg_sum is None:
                fg_sum = _np.zeros(rgb.shape, _np.float32)
            fg_sum += rgb.astype(_np.float32)
            fg_n += 1
        if mode != "moments" and want_trail:
            if trail_max is None:
                trail_max = _np.zeros(rgb.shape, _np.uint16)
            _np.maximum(trail_max, rgb, out=trail_max)
        distort = (_P3(k1, rgb.shape[:2]).distort if abs(k1) > 1e-9
                   else None)
        src_wcs = _wcs_from_str(wstr)
        if stats_extra_half:
            # frames were decoded at half size for the stats pass, but the
            # supplied WCS describes the full-size frame — rescale it or
            # the resample reads only the top-left quarter of the data
            src_wcs = scale_wcs(src_wcs, 0.5)
        arr, foot = _rp(rgb, src_wcs, stat_wcs, (hs, ws),
                        quality=True, distort=distort)
        del rgb
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
        if coef is not None:
            arr -= eval_frame_sky(coef, hs, ws)
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
            okf = ok.astype(_np.float32)
            for c in range(3):
                keep = okf * (
                    _np.abs(arr[:, :, c] - clip_mean[:, :, c])
                    <= clip_bound[:, :, c])
                ssum[:, :, c] += arr[:, :, c] * keep * wgt
                wsum[:, :, c] += keep * wgt
        del arr, foot, ok
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
        for name, a in (("csum", ssum), ("cwsum", wsum),
                        ("fcount", fcount)):
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
    _fh = logging.FileHandler(cfg.output_path / "run_log.txt",
                              mode="w", encoding="utf-8")
    _fh.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)s %(message)s"))
    logging.getLogger("meteorprep").addHandler(_fh)
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
        import json as _json
        try:
            for k, v in _json.loads(override.read_text()).items():
                if hasattr(cfg, k):
                    setattr(cfg, k, v)
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
    if (not cfg.force and bp_npy.exists() and bp_keyf.exists()
            and bp_keyf.read_text() == bp_key):
        bad_pixels = np.load(bp_npy)
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
            np.save(bp_npy, bad_pixels if bad_pixels is not None
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
        logging.getLogger("meteorprep").removeHandler(_fh)
        _fh.close()
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


def _run_group(cfg: Config, group, bad_pixels, notify,
               pre_timings=None) -> dict:
    frames = group.frames
    n = len(frames)
    out_dir = cfg.output_path / group.group_id
    out_dir.mkdir(parents=True, exist_ok=True)
    cache = CacheStore(cfg.cache_path / group.group_id)
    skipped = 0
    # per-stage wall clock for the run report ("where the time went")
    import time as _time
    timings: list = list(pre_timings or [])
    _t_last = [_time.time()]

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

    def stage_fresh(stage):
        nonlocal skipped
        h_ = cfg.stage_hash(stage) + ":" + frames_fp
        if not cfg.force and cache.is_done(stage, h_):
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

    missing = [i for i in range(n) if not det_lum_file(i).exists()]
    if missing:
        notify(0.05, "reading every photo once (small size)")
        dl_work = [(str(frames[i].path), str(det_lum_file(i)), bad_pixels)
                   for i in missing]
        done_dl = 0
        if cfg.jobs > 1 and len(dl_work) > 3:
            import multiprocessing as _mp
            from concurrent.futures import ProcessPoolExecutor, as_completed
            try:
                with ProcessPoolExecutor(
                        max_workers=max(min(cfg.jobs, 6), 1),
                        mp_context=_mp.get_context("spawn")) as pool:
                    futs = [pool.submit(_det_lum_one, a) for a in dl_work]
                    for fut in as_completed(futs,
                                            timeout=120 + 30 * len(dl_work)):
                        fut.result()
                        done_dl += 1
                        notify(0.05 + 0.04 * done_dl / len(dl_work),
                               f"reading every photo once "
                               f"({done_dl}/{len(dl_work)})")
            except Exception as exc:
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
        rec = cache.read_json("lightpaint.json")
        if isinstance(rec, dict):
            lp = np.array(rec["lp"], dtype=bool)
            sharp = rec.get("sharp", [0.0] * n)
        else:                      # older cache format
            lp = np.array(rec, dtype=bool)
            sharp = [0.0] * n
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
        free_mb = _sh.disk_usage(str(out_dir)).free / 1e6
        if free_mb < need_mb:
            raise RuntimeError(
                f"Not enough free disk space: this night needs roughly "
                f"{need_mb / 1000:.0f} GB of working room and the drive "
                f"holding {out_dir.name} has only {free_mb / 1000:.1f} GB "
                f"free. Free up space (empty the Trash, delete old "
                f"*_meteorprep folders), then press Prepare again — or "
                f"tick 'Fast mode: half-resolution result', which needs "
                f"about a quarter of the room.")
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
    solver_used = "none"
    alignment_quality = "nominal"
    solve_files: list[str] = []

    if cfg.align_mode == "reproject_tan":
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
        if result is None:
            # fully automatic: search every plausible pointing against the
            # bundled naked-eye catalog — no hints, no network
            notify(0.14, "working out where the camera pointed")
            result = blind_solve(base_det_lum, det_scale_deg,
                                 catalog_radec=blind_catalog,
                                 undistort=undistort)
        if result is None:
            # the pair-distance gate is only as good as the assumed plate
            # scale; sweep plausible crop/zoom factors before giving up
            for mult in (1.6, 1 / 1.6, 1.3, 1 / 1.3, 2.0, 0.5):
                notify(0.14, "working out where the camera pointed "
                             f"(trying a different lens guess: {mult:.2f}x)")
                log.info("blind solve retry at %.2fx assumed field of view",
                         mult)
                result = blind_solve(base_det_lum, det_scale_deg * mult,
                                     catalog_radec=blind_catalog,
                                     undistort=undistort)
                if result is not None:
                    det_scale_deg *= mult
                    log.info("star match locked at %.2fx the assumed field "
                             "of view — the lens/sensor guess was off; "
                             "solved scale is now trusted instead", mult)
                    break
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

    mark("star lock (solve + verify)")
    # ------- detection-space alignment cache (small: ~12 MB/frame) -------
    det_dir = cache.dir("detect_aligned")
    if stage_fresh("reproject"):
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
                import multiprocessing as _mp
                from concurrent.futures import ProcessPoolExecutor, as_completed
                pending: dict = {}
                try:
                    # spawn (not fork): forking a process that already ran
                    # threaded numeric code can deadlock the children on
                    # Linux; macOS spawns by default.  The timeout turns a
                    # silent hang into a clean single-core fallback.
                    with ProcessPoolExecutor(
                            max_workers=jobs_eff,
                            mp_context=_mp.get_context("spawn")) as pool:
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
                    np.save(det_dir / f"lum_{i_bad:04d}.npy",
                            np.zeros((hd, wd), np.uint16))
                    np.save(det_dir / f"foot_{i_bad:04d}.npy",
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
    notify(0.45, "searching every frame for meteors")

    # ground mask from alignment physics: static ground and flickering
    # lights deviate from the aligned-sky consensus in most frames, so
    # they are excluded BEFORE streak detection — a porch light cannot
    # become an "aircraft"
    from meteorprep.segment.sky_ground import ground_from_alignment
    sky_det = None
    if base_wcs is not None:
        sky_det = ground_from_alignment(load_det_lum, load_det_foot, n,
                                        exclude=set(np.nonzero(lp)[0]))
        if sky_det is not None:
            log.info("ground found from alignment physics: %.0f%% of the "
                     "frame masked out of the meteor search",
                     100.0 * (sky_det < 0.5).mean())
    sky_path = ""
    if sky_det is not None:
        sky_path = str(cache.path("sky_det.npy"))
        np.save(sky_path, sky_det.astype(np.float32))
    diff_dir = cache.dir("diffs")
    exclude_lp = [int(v) for v in np.nonzero(lp)[0]]
    search_idx = [i for i in range(n) if not lp[i]]
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
        import multiprocessing as _mp
        from concurrent.futures import (FIRST_COMPLETED, ProcessPoolExecutor,
                                        wait)
        prog_paths = [cache.path(f"prog_sr_{k}.txt")
                      for k in range(len(sr_chunks))]
        try:
            with ProcessPoolExecutor(
                    max_workers=len(sr_chunks),
                    mp_context=_mp.get_context("spawn")) as pool:
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

    candidates = build_tracks(streaks_per_frame, world_endpoints,
                              [m.file for m in frames])
    _measure_candidate_colors(candidates, frames, det_wcs, base_det_wcs,
                              (hd, wd), S, bad_pixels, k1)
    radiant = radiant_at_epoch(cfg, base_meta.epoch_mid)
    candidates = classify(candidates, cfg, radiant)
    _absorb_track_fragments(candidates,
                            {m.file: i for i, m in enumerate(frames)})
    base_mid = base_meta.epoch_mid
    file_to_idx = {m.file: i for i, m in enumerate(frames)}
    for c in candidates:
        i0 = file_to_idx[c.frames[0]]
        c.rotation_deg = SIDEREAL_DEG_PER_SEC * (
            frames[i0].epoch_mid - base_mid).total_seconds()
        s = c.streaks[0]
        c.endpoints_pix_base = [[s.x0, s.y0], [s.x1, s.y1]]

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
    if stage_fresh("base_sky"):
        mark("meteor search + classification")
        notify(0.60, "building the clean starfield from every frame")
        base_img, fg_stack, coverage, trail_img = _stream_base(
            cfg, frames, ok_idx, det_wcs, base_wcs, base_det_wcs, (h, w), S,
            corridor_segments, weights, cache, bad_pixels, notify, k1,
            sky_path)
        import tifffile
        tifffile.imwrite(cache.path("base.tif"),
                         np.clip(base_img, 0, 65535).astype(np.uint16),
                         compression="zlib")
        if fg_stack is not None:
            tifffile.imwrite(cache.path("fg_stack.tif"),
                             np.clip(fg_stack, 0, 65535).astype(np.uint16),
                             compression="zlib")
        if coverage is not None:
            np.save(cache.path("coverage.npy"), coverage)
        if trail_img is not None:
            tifffile.imwrite(cache.path("startrail.tif"),
                             np.clip(trail_img, 0, 65535).astype(np.uint16),
                             compression="zlib")
        stage_done("base_sky")
    import tifffile
    base_img = tifffile.imread(cache.path("base.tif")).astype(np.float32)
    fg_stack = (tifffile.imread(cache.path("fg_stack.tif")).astype(np.float32)
                if cache.path("fg_stack.tif").exists() else None)
    coverage = (np.load(cache.path("coverage.npy"))
                if cache.path("coverage.npy").exists() else None)
    base_lum = raw_mod.luminance(base_img)

    # ------- second-pass faint-meteor harvest vs the clean base ---------
    if (cfg.faint_harvest and base_wcs is not None
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
                _absorb_track_fragments(candidates, file_to_idx)
                meteor_cands = [c for c in candidates
                                if c.label == "meteor"]
                flagged_cands = [c for c in candidates
                                 if c.label != "meteor"]
                meteor_cands.sort(key=lambda c: file_to_idx[c.frames[0]])
                n_kept = sum(1 for c in new_cands if c.label == "meteor")
                log.info("faint harvest added %d meteor(s) "
                         "(%d demoted by the track gauntlet)",
                         n_kept, len(new_cands) - n_kept)
        except Exception as exc:
            log.warning("faint harvest skipped (%s); first-pass results "
                        "are unaffected", exc)

    if cfg.cleanup_cache:
        # the aligned-luminance cache is now truly done (first pass AND
        # harvest): free its GBs before assembly.  Invalidate the
        # alignment stage so a later resume rebuilds rather than trusting
        # missing files.
        import shutil as _shutil
        _shutil.rmtree(det_dir, ignore_errors=True)
        cache.invalidate("reproject")
        log.info("freed the alignment cache (%s)", det_dir.name)

    # ---------------- extraction (full quality, meteor frames only) -----
    mark("building the clean starfield")
    notify(0.82, "cutting each meteor onto its own layer")
    star_cat_xy = detect_stars(base_img, max_stars=500)

    _full_cache: dict[int, tuple] = {}

    def full_aligned(i):
        if i not in _full_cache:
            if len(_full_cache) > 2:
                _full_cache.pop(next(iter(_full_cache)))
            rgb = raw_mod.decode(frames[i].path, "final", bad_pixels,
                                 half_size=cfg.half_size)
            if cfg.align_mode == "reproject_tan":
                distort_full = (Poly3Distortion(k1, rgb.shape[:2]).distort
                                if abs(k1) > 1e-9 else None)
                arr, foot = reproject_frame(
                    rgb, scale_wcs(det_wcs[i], 1 if cfg.half_size else 2),
                    base_wcs, (h, w),
                    quality=True, distort=distort_full)
            else:
                from meteorprep.astrometry.reproject_frames import rotate2d_frame
                dt = (frames[i].epoch_mid - base_meta.epoch_mid).total_seconds()
                arr, foot = rotate2d_frame(rgb, SIDEREAL_DEG_PER_SEC * dt,
                                           (w / 2.0, h / 2.0))
            _full_cache[i] = (arr.astype(np.float32), foot)
        return _full_cache[i]

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
            arr, foot = full_aligned(i)
            d_full = difference(raw_mod.luminance(arr), base_lum, foot)
            cur_i = i
            done_ex += 1
            notify(0.82 + 0.06 * done_ex / max(n_extract, 1),
                   f"cutting candidate layers (photo {done_ex}/{n_extract})")
        layer = extract_meteor(
            d_full, arr,
            ((seg_streak.x0, seg_streak.y0),
             (seg_streak.x1, seg_streak.y1)),
            seg_streak.fwhm_px, star_xy=star_cat_xy)
        if layer is None:
            continue
        x0, y0, x1, y1 = layer.bbox
        roi_images.setdefault(c.id, d_full[y0:y1, x0:x1].copy())
        (meteor_layers if kind == "m" else flagged_layers).append(
            (c, layer, i, si))
    _full_cache.clear()

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

    # written AFTER the seam crop so it overlays the shipped canvas 1:1
    from PIL import Image
    Image.fromarray((sky_mask * 255).astype(np.uint8)).save(
        out_dir / "skymask.png")

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
    sky_cam = foreground_sky_mask(fg_stack if fg_stack is not None
                                  else base_rgb_final)
    sky_fg = _fit_output(sky_cam) if sky_cam is not None else sky_mask
    sky_fg = np.clip(sky_fg, 0.0, 1.0)
    fg_alpha = 1.0 - sky_fg
    # match the foreground's sky level to the stack IN THE LAYERS too, not
    # only in the preview: a foreground that drops in at a different
    # brightness or colour than the sky it sits against is the single
    # most jarring thing to open in Photoshop
    from meteorprep.segment.silhouette import match_sky_level
    fg_ref = match_sky_level(fg_ref, base_img, sky_fg)
    fg_layers = [Layer(name="FG_base_time", rgb=fg_ref,
                       alpha=fg_alpha, blend="normal", visible=True)]
    if fg_stack is not None:
        fg_stack = match_sky_level(_fit_output(fg_stack), base_img, sky_fg)
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

    def to_layers(pairs, visible):
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
                k + 1, c.frames[min(si, len(c.frames) - 1)],
                frames[i].epoch_mid.astimezone(timezone.utc).isoformat(),
                c.rotation_deg, c.confidence, flag)
            out.append(Layer(name=name, rgb=rgb_l, alpha=alpha_l,
                             bbox=bbox_l, blend="lighten", visible=visible))
        return out

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
        if color_cal is not None:
            g_ = np.asarray(color_cal["gains"], np.float32)
            extra_layers.append(Layer(
                name="BASE_SKY_star_calibrated_colors",
                rgb=np.clip(base_img * g_[None, None, :], 0, 65535),
                blend="normal", visible=False))
    if cfg.emit_gradient_layer:
        from meteorprep.stack.gradient import fit_sky_gradient
        grad = fit_sky_gradient(base_img, sky_mask)
        if grad is not None:
            extra_layers.append(Layer(
                name="SKY_GRADIENT_set_to_Subtract_to_flatten",
                rgb=grad, blend="subtract", visible=False))
    stack = LayerStack(
        width=w, height=h,
        base=Layer(name="BASE_SKY", rgb=base_img, blend="normal", visible=True),
        groups=[
            LayerGroup("SKY_TOOLS", extra_layers, visible=False)
            if extra_layers else LayerGroup("SKY_TOOLS", [], visible=False),
            LayerGroup("FOREGROUND", fg_layers, visible=True),
            LayerGroup("METEORS", to_layers(meteor_layers, True), visible=True),
            LayerGroup("FLAGGED", to_layers(flagged_layers, False), visible=False),
        ])

    outputs = {}
    psd_path = None
    if cfg.emit_psd:
        psd_path = write_psd(stack, out_dir / "meteorprep.psd")
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
    grad_arr = None
    for lyr in extra_layers:
        if lyr.blend == "subtract":
            grad_arr = lyr.rgb
    gains = (np.asarray(color_cal["gains"], np.float32)
             if color_cal else None)
    fg_for_preview = fg_stack if fg_stack is not None \
        else _fit_output(base_rgb_final)
    pv = render_preview(base_img, fg_for_preview, sky_fg, grad_arr,
                        gains, meteor_layers, out_dir / "preview.jpg",
                        flagged_layers=flagged_layers,
                        all_trails_path=out_dir / "preview_all_trails.jpg",
                        crop_xy=((crop[0], crop[1]) if crop is not None
                                 else (0, 0)))
    if pv:
        outputs["preview"] = str(pv["preview"])
        if pv.get("all_trails"):
            outputs["preview_all_trails"] = str(pv["all_trails"])
    if cfg.emit_startrail:
        # rendered for free inside stack pass 2 (camera-space lighten-max)
        if cache.path("startrail.tif").exists():
            import shutil as _sh
            _sh.copyfile(cache.path("startrail.tif"),
                         out_dir / "startrail.tif")
        else:                     # cache from an older run: render classic
            trail = lighten_stack(
                lambda i: raw_mod.decode(frames[i].path, "final",
                                         bad_pixels,
                                         half_size=cfg.half_size)
                .astype(np.float32), n)
            tifffile.imwrite(out_dir / "startrail.tif",
                             np.clip(trail, 0, 65535).astype(np.uint16),
                             compression="zlib")
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
        crop_xy=((crop[0], crop[1]) if crop is not None else None))
    outputs["sidecar"] = str(sidecar)
    from meteorprep.report.html import (render_candidate_crops,
                                        write_report_html)
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
            a = arr.astype(np.float32)
            hi = hi or max(float(np.percentile(a, 99.5)), 1e-6)
            g8 = (np.clip(a / hi, 0, 1) * 255).astype(np.uint8)
            hh, ww2 = g8.shape[:2]
            if ww2 > 1400:
                g8 = _cv2.resize(g8, (1400, int(hh * 1400 / ww2)),
                                 interpolation=_cv2.INTER_AREA)
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
    except Exception as exc:
        log.warning("evidence maps skipped: %s", exc)
        ev_stats = {}

    total_exp = sum(float(frames[i].exposure_s or 0) for i in ok_idx)
    n_faint = sum(1 for c in candidates
                  if c.flags.get("faint_harvest"))
    info = {"star solver": solver_used,
            "star-lock accuracy": f"{base_meta.solve_rms_px:.2f} px RMS"
            if base_meta.solve_rms_px else "n/a",
            "lens correction k1": f"{k1:+.4f}" if abs(k1) > 1e-9
            else "none needed",
            "photos stacked": f"{len(ok_idx)} of {n}",
            "integration": f"{total_exp / 60:.0f} min of exposure "
                           f"({len(ok_idx)} x "
                           f"{total_exp / max(len(ok_idx), 1):.0f}s)",
            "faint-pass meteors": str(n_faint),
            "generated pixels": "none — every trail is measured light, "
                                "at its true sky position",
            "recipe hash": cfg.params_hash()[:23]}
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
    outputs["report"] = str(write_report_html(
        out_dir,
        {"candidates": [c.to_dict() for c in candidates],
         "alignment_quality": alignment_quality},
        have_preview="preview" in outputs,
        have_contact="contact_sheet" in outputs,
        have_psd="psd" in outputs,
        crops=crops, timings=timings, info=info, looks=looks))
    if cfg.cleanup_cache:
        import shutil as _shutil
        _shutil.rmtree(det_dir, ignore_errors=True)
        _shutil.rmtree(det_lum_dir, ignore_errors=True)
        _shutil.rmtree(diff_dir, ignore_errors=True)
        cache.invalidate("reproject")   # a future re-run knows to rebuild
        cache.invalidate("base_sky")
        log.info("freed the detection cache (%s)", det_dir)
    if skipped:
        log.info("%d stage(s) up-to-date, skipped", skipped)
    notify(1.0, f"done: {len(meteor_cands)} meteor(s), "
                f"{len(flagged_cands)} flagged candidate(s)")
    return {"group": group.group_id, "outputs": outputs,
            "n_meteors": len(meteor_cands), "n_flagged": len(flagged_cands),
            "alignment_quality": alignment_quality,
            "candidates": [c.to_dict() for c in candidates]}


# ----------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------

def _absorb_track_fragments(candidates, file_to_idx) -> None:
    """A short detection that escaped track-linking shows up as a
    single-frame "meteor" even though it is really a piece of a satellite
    or aircraft pass.  Absorb any single-frame meteor that is collinear
    with a multi-frame track and sits where that track's motion says it
    should be at the fragment's frame time: it inherits the track's label
    (so it lands in FLAGGED, not METEORS)."""
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
            if perp > 60.0:
                continue
            # where the track's own motion puts it at the fragment's time
            along = float((mid - a) @ d_t)
            expect = span * (fi - i0) / float(i1 - i0)
            if abs(along - expect) > max(1.0 * span, 150.0):
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
            if hop_n < 20.0:
                continue
            hop = hop / hop_n
            da = np.array([sa.x1 - sa.x0, sa.y1 - sa.y0], float)
            da /= np.linalg.norm(da) + 1e-9
            db = np.array([sb.x1 - sb.x0, sb.y1 - sb.y0], float)
            db /= np.linalg.norm(db) + 1e-9
            lim = np.cos(np.deg2rad(12.0))
            if (abs(float(da @ db)) >= lim and abs(float(da @ hop)) >= lim
                    and abs(float(db @ hop)) >= lim):
                for c in (ca, cb):
                    log.info("candidate %s reclassified: steady motion "
                             "across frames — satellite, not meteor", c.id)
                    c.label = "satellite"
                    c.confidence = max(ca.confidence, cb.confidence)


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

    def get(i):
        if i not in cache:
            if len(cache) > 3:
                cache.pop(next(iter(cache)))
            cache[i] = det_rgb(i)
        return cache[i]

    n = len(frames)
    for c in candidates:
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
    coverage uint16): coverage counts contributing frames per pixel, for
    the seam-removing crop.
    """
    h, w = shape_out
    tmp = cache.dir("stack_tmp")
    # a crashed or interrupted earlier run leaves ~GB of stale part files
    # here — never let them eat the disk a second time
    for stale in tmp.glob("*.npy"):
        stale.unlink(missing_ok=True)
    for stale in tmp.glob("prog_*.txt"):
        stale.unlink(missing_ok=True)

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
                cfg.stack_sigma, want_fg, want_trail, k1, sky_path)

    # each pass-2 worker peaks around ~1.5 GB at full 20 MP resolution
    ram = _available_ram_gb()
    n_workers = (1 if ram < 7.5 else
                 2 if ram < 14 else max(min(cfg.jobs, 4), 1))

    # ONE spawn pool serves both passes: spawn startup re-imports the
    # numeric stack in every worker (seconds each), so pass 2 reuses the
    # warm workers pass 1 already paid for
    _pool_holder: dict = {"pool": None}

    def get_pool():
        if _pool_holder["pool"] is None:
            import multiprocessing as _mp
            from concurrent.futures import ProcessPoolExecutor
            _pool_holder["pool"] = ProcessPoolExecutor(
                max_workers=n_workers,
                mp_context=_mp.get_context("spawn"))
        return _pool_holder["pool"]

    def close_pool():
        p = _pool_holder["pool"]
        _pool_holder["pool"] = None
        if p is not None:
            try:
                p.shutdown(wait=False, cancel_futures=True)
            except Exception:
                pass

    def run_pass(mode, frac0, frac1, label, want_fg=False,
                 want_trail=False, indices=None, on_result=None,
                 on_reset=None):
        """on_result(part) merges each worker's result AS IT LANDS, so the
        parent's ~GB of part loading/adding overlaps the slowest worker
        instead of running serially after every worker is done.  If the
        pool dies mid-merge, on_reset() zeroes the accumulators and the
        pass reruns on one core (the proven fallback)."""
        idx = ok_idx if indices is None else list(indices)
        merged = 0
        if base_wcs is not None and n_workers > 1 and len(idx) >= n_workers:
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
                while pending:
                    done_set, pending = wait(pending, timeout=2,
                                             return_when=FIRST_COMPLETED)
                    for fut in done_set:
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
            except Exception as exc:
                close_pool()
                if _disk_full(exc):
                    # a one-core retry against a full disk fails the same
                    # way half an hour later — stop with a human message
                    raise RuntimeError(_DISK_FULL_MSG) from exc
                log.warning("parallel stacking failed (%s); one core", exc)
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
                    frame_args(mode, idx, 0, want_fg, want_trail)))
            except Exception as exc:
                if _disk_full(exc):
                    raise RuntimeError(_DISK_FULL_MSG) from exc
                raise

    if base_wcs is None:
        return (_rotate2d_mean(cfg, frames, ok_idx, corridor_segments,
                               shape_out, bad_pixels),
                None, None, None)

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
             on_reset=_reset_moments)
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
    mean_full = _cv2.resize(total.mean, (w, h),
                            interpolation=_cv2.INTER_LINEAR)

    # -------- pass 2: sigma-clipped, frame-weighted mean (+ foreground) --
    want_trail = bool(cfg.emit_startrail)
    total_sum = np.zeros((h, w, 3), np.float64)
    total_w = np.zeros((h, w, 3), np.float64)
    coverage = np.zeros((h, w), np.uint16)
    p2 = {"fg_sum": None, "fg_n": 0, "trail": None}

    def _merge_clipped(p):
        all_bgs.update(p.get("bg", {}))
        # in-place adds (+= would rebind the closed-over names)
        np.add(total_sum, np.load(p["csum"]), out=total_sum)
        np.add(total_w, np.load(p["cwsum"]), out=total_w)
        np.add(coverage, np.load(p["fcount"]), out=coverage)
        if want_fg and "fg" in p:
            part_fg = np.load(p["fg"])
            p2["fg_sum"] = (part_fg if p2["fg_sum"] is None
                            else p2["fg_sum"] + part_fg)
            p2["fg_n"] += p["fg_n"]
        if want_trail and "trail" in p:
            part_t = np.load(p["trail"])
            p2["trail"] = (part_t if p2["trail"] is None
                           else np.maximum(p2["trail"], part_t))
        for key in ("csum", "cwsum", "fcount", "fg", "trail"):
            if key in p:                      # merged: free the disk now
                Path(p[key]).unlink(missing_ok=True)

    def _reset_clipped():
        total_sum[:] = 0
        total_w[:] = 0
        coverage[:] = 0
        p2.update(fg_sum=None, fg_n=0, trail=None)

    run_pass("clipped", 0.70, 0.80,
             "building the clean starfield (pass 2 of 2)", want_fg,
             want_trail, on_result=_merge_clipped, on_reset=_reset_clipped)
    close_pool()
    fg = ((p2["fg_sum"] / max(p2["fg_n"], 1))
          if want_fg and p2["fg_n"] else None)
    trail = p2["trail"]
    p2["fg_sum"] = None
    # pixels where clipping rejected everything fall back to the plain mean
    base = np.where(total_w > 0, total_sum / np.maximum(total_w, 1e-6),
                    mean_full)
    # frames were normalised against their own sky surface: restore the
    # AVERAGE surface, so the true mean sky (and its gradient) survives —
    # only the frame-to-frame differences were removed
    if all_bgs or all_coef:
        from meteorprep.stack.gradient import eval_frame_sky
        eff = []
        for i, bgv in all_bgs.items():
            c = np.zeros((3, 6), np.float32)
            got = all_coef.get(i, all_coef.get(str(i)))
            if got is not None:
                c = np.asarray(got, np.float32)
            else:
                c[:, 0] = np.asarray(bgv, np.float32)
            eff.append(c)
        base = base + eval_frame_sky(np.mean(eff, axis=0), h, w)
    import shutil as _shutil
    _shutil.rmtree(tmp, ignore_errors=True)
    return base.astype(np.float32), fg, coverage, trail


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
