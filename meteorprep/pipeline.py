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
from meteorprep.astrometry.solve import (build_tan_wcs, propagate_wcs,
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
    out = wcs.deepcopy()
    out.wcs.cd = np.asarray(wcs.wcs.cd) / s
    out.wcs.crpix = [s * (wcs.wcs.crpix[0] - 0.5) + 0.5,
                     s * (wcs.wcs.crpix[1] - 0.5) + 0.5]
    if getattr(out, "sip", None) is not None:
        out.sip = None
        out.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    return out


# ----------------------------------------------------------------------
# process-pool workers (top-level: picklable, spawn-safe)
# ----------------------------------------------------------------------

def _detect_reproject_one(args) -> int:
    """Decode one frame at detection size and cache its aligned binned
    luminance + footprint (small: ~12 MB per 20 MP frame)."""
    (i, path, src_wcs_str, det_wcs_str, shape_hw, det_dir_str,
     bad_pixels) = args
    import numpy as _np
    from meteorprep.astrometry.reproject_frames import reproject_frame as _rp
    from meteorprep.ingest import raw as _raw

    det_dir = Path(det_dir_str)
    rgb = _raw.decode(Path(path), "detect", bad_pixels, half_size=True)
    lum = _raw.luminance(rgb)
    arr, foot = _rp(lum, _wcs_from_str(src_wcs_str),
                    _wcs_from_str(det_wcs_str), tuple(shape_hw),
                    quality=False)
    _np.save(det_dir / f"lum_{i:04d}.npy",
             _np.clip(arr, 0, 65535).astype(_np.uint16))
    _np.save(det_dir / f"foot_{i:04d}.npy", foot.astype(_np.uint8))
    return i


def _paint_segments(mask: np.ndarray, segments) -> None:
    """Paint streak corridors (tiny endpoint lists, not stored bitmaps)."""
    import cv2
    for (x0, y0, x1, y1, half_width) in segments:
        cv2.line(mask, (int(round(x0)), int(round(y0))),
                 (int(round(x1)), int(round(y1))), 1,
                 thickness=max(int(2 * half_width), 3))


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
     bad_pixels, sigma, want_fg) = args
    import numpy as _np
    from meteorprep.astrometry.reproject_frames import reproject_frame as _rp
    from meteorprep.ingest import raw as _raw
    from meteorprep.stack.streaming import RunningMoments

    h, w = shape_hw
    tmp = Path(tmp_dir_str)
    base_wcs = _wcs_from_str(base_wcs_str)
    scratch = _np.zeros((h, w), _np.uint8)
    if mode == "moments":
        mom = RunningMoments((h, w, 3))
        fg_sum = _np.zeros((h, w, 3), _np.float32) if want_fg else None
        fg_n = 0
    else:
        clip_mean = _np.load(tmp / "clip_mean.npy", mmap_mode="r")
        clip_bound = _np.load(tmp / "clip_bound.npy", mmap_mode="r")
        ssum = _np.zeros((h, w, 3), _np.float32)
        wsum = _np.zeros((h, w, 3), _np.float32)

    for i, path, wstr in zip(indices, paths, wcs_strs):
        try:
            rgb = _raw.decode(Path(path), "final", bad_pixels,
                              half_size=half_size)
        except Exception as exc:
            log.warning("skipping unreadable frame %s in the stack: %s",
                        Path(path).name, exc)
            continue
        if mode == "moments" and fg_sum is not None:
            fg_sum += rgb.astype(_np.float32)
            fg_n += 1
        arr, foot = _rp(rgb, _wcs_from_str(wstr), base_wcs, (h, w),
                        quality=True)
        del rgb
        ok = foot.astype(bool)
        segs = segments_per_frame.get(i)
        if segs:
            scratch[:] = 0
            _paint_segments(scratch, segs)
            ok &= scratch == 0
        if mode == "moments":
            mom.add(arr, ok)
        else:
            wgt = float(frame_weights.get(i, 1.0))
            okf = ok.astype(_np.float32)
            for c in range(3):
                keep = okf * (
                    _np.abs(arr[:, :, c] - clip_mean[:, :, c])
                    <= clip_bound[:, :, c])
                ssum[:, :, c] += arr[:, :, c] * keep * wgt
                wsum[:, :, c] += keep * wgt
        del arr, foot, ok
    out = {}
    if mode == "moments":
        for name, a in (("count", mom.count), ("mean", mom.mean),
                        ("m2", mom.m2)):
            p = tmp / f"{name}_{worker_id}.npy"
            _np.save(p, a)
            out[name] = str(p)
        if fg_sum is not None:
            p = tmp / f"fg_{worker_id}.npy"
            _np.save(p, fg_sum)
            out["fg"] = str(p)
            out["fg_n"] = fg_n
    else:
        for name, a in (("csum", ssum), ("cwsum", wsum)):
            p = tmp / f"{name}_{worker_id}.npy"
            _np.save(p, a)
            out[name] = str(p)
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
    logging.basicConfig(level=logging.INFO,
                        format="%(levelname)s %(message)s")
    notify = progress or (lambda frac, msg: log.info("[%3d%%] %s",
                                                     int(frac * 100), msg))
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
    notify(0.02, "scanning input folder")
    paths = scan_input_dir(Path(cfg.input_dir), cfg.raw_extensions)
    if not paths:
        raise FileNotFoundError(f"no frames found under {cfg.input_dir}")
    metas = read_metadata(paths)
    bad_pixels = raw_mod.find_bad_pixels([m.path for m in metas])

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
    for group in real_groups:
        try:
            res = _run_group(cfg, group, bad_pixels, notify)
            results["groups"].append(res)
        except Exception:
            if len(real_groups) == 1:
                raise
            log.exception("group %s failed; continuing with the others",
                          group.group_id)
            errors.append(group.group_id)
    if errors and not results["groups"]:
        raise RuntimeError(f"every group failed: {errors}")
    return results


def _run_group(cfg: Config, group, bad_pixels, notify) -> dict:
    frames = group.frames
    n = len(frames)
    out_dir = cfg.output_path / group.group_id
    out_dir.mkdir(parents=True, exist_ok=True)
    cache = CacheStore(cfg.cache_path / group.group_id)
    skipped = 0
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
    # Output space: full resolution, or half when the user chose half_size.
    S = 1 if cfg.half_size else 2   # detection -> output scale factor

    def decode_det_lum(i):
        rgb = raw_mod.decode(frames[i].path, "detect", bad_pixels,
                             half_size=True)
        return raw_mod.luminance(rgb)

    # ---------------- light-paint flags ----------------
    if stage_fresh("lightpaint"):
        notify(0.06, "flagging light-painted frames")
        gmed = np.array([ground_luminance(decode_det_lum(i), None)
                         for i in range(n)])
        lp = flag_lightpainted(gmed, cfg.lp_window, cfg.lp_sigma)
        cache.write_json("lightpaint.json", lp.tolist())
        stage_done("lightpaint")
    else:
        lp = np.array(cache.read_json("lightpaint.json"), dtype=bool)
    for m, f in zip(frames, lp):
        m.lightpainted = bool(f)
    ok_idx = [i for i in range(n) if not lp[i]]
    if not ok_idx:
        raise RuntimeError("every frame is flagged light-painted")

    # base frame: median-time non-light-painted frame
    base_i = ok_idx[len(ok_idx) // 2]
    base_meta = frames[base_i]
    base_rgb_final = raw_mod.decode(base_meta.path, "final", bad_pixels,
                                    half_size=cfg.half_size)
    h, w = base_rgb_final.shape[:2]
    base_det_lum = decode_det_lum(base_i)
    hd, wd = base_det_lum.shape[:2]

    # ---------------- plate solving (at detection scale) ----------------
    notify(0.12, "matching your stars to the star map")
    det_pitch_um = cfg.pixel_pitch_um * 2.0   # half-size decode
    det_scale_deg = float(np.rad2deg(np.arctan(
        det_pitch_um * 1e-3 / max(base_meta.focal_mm, 1e-3))))
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
            raise RuntimeError(
                "I couldn't match the stars in your photos to the star map. "
                "This usually means the reference frame shows too few stars "
                "(clouds, trees, or heavy light pollution). Try removing the "
                "worst frames from the folder and running again — the tool "
                "will pick a different reference frame.")
        base_det_wcs = result.wcs
        solver_used = result.source
        base_meta.wcs_source = "solved"
        base_meta.solve_rms_px = result.rms_px
        det_wcs[base_i] = base_det_wcs
        solve_files.append(base_meta.file)
        log.info("base solve via %s: rms=%.2f px (%d stars)",
                 result.source, result.rms_px, result.n_matched)

        # sparse subset: every K-th frame; others propagated + verified
        base_mid = base_meta.epoch_mid
        solve_targets = {i for i in range(0, n, max(cfg.solve_every_k, 1))}
        solve_targets.add(base_i)
        solved = {base_i: base_det_wcs}
        for i in sorted(solve_targets):
            if i == base_i or lp[i]:
                continue
            dt = (frames[i].epoch_mid - base_mid).total_seconds()
            seed_i = propagate_wcs(base_det_wcs, dt)
            res_i = solve_frame(decode_det_lum(i), seed_i, catalog, cfg,
                                undistort=undistort)
            if res_i is not None and res_i.rms_px <= cfg.solve_rms_max_px:
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
            if catalog is not None and not lp[i]:
                rms, nm = solve_rms_px(det_wcs[i],
                                       _detected_for_verify(decode_det_lum(i),
                                                            undistort),
                                       catalog)
                frames[i].solve_rms_px = rms
                if rms > cfg.solve_rms_max_px and nm >= cfg.solve_min_stars:
                    res_i = solve_frame(decode_det_lum(i), det_wcs[i],
                                        catalog, cfg, undistort=undistort)
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

    # ------- detection-space alignment cache (small: ~12 MB/frame) -------
    det_dir = cache.dir("detect_aligned")
    if stage_fresh("reproject"):
        notify(0.25, "aligning small previews to search for meteors")
        if cfg.align_mode == "reproject_tan":
            det_str = _wcs_to_str(base_det_wcs)
            work = [(i, str(frames[i].path), _wcs_to_str(det_wcs[i]),
                     det_str, (hd, wd), str(det_dir), bad_pixels)
                    for i in range(n)]
            jobs_eff = (min(cfg.jobs, 3) if _available_ram_gb() < 12
                        else cfg.jobs)
            failed: list = []
            if jobs_eff > 1:
                from concurrent.futures import ProcessPoolExecutor, as_completed
                try:
                    with ProcessPoolExecutor(max_workers=jobs_eff) as pool:
                        futs = {pool.submit(_detect_reproject_one, a): a
                                for a in work}
                        done = 0
                        for fut in as_completed(futs):
                            done += 1
                            try:
                                fut.result()
                            except Exception as exc:
                                failed.append((futs[fut], exc))
                            notify(0.25 + 0.15 * done / n,
                                   f"searching preparation ({done}/{n})")
                except Exception as exc:
                    log.warning("parallel alignment failed (%s); using one "
                                "core", exc)
                    failed = [(a, None) for a in work]
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

    def load_det_lum(i):
        return np.load(det_dir / f"lum_{i:04d}.npy", mmap_mode="r")

    def load_det_foot(i):
        return np.load(det_dir / f"foot_{i:04d}.npy", mmap_mode="r")

    # ---------------- detection ----------------
    # Lazy views keep RAM flat (~7 frames in memory), never all 226.
    notify(0.45, "searching every frame for meteors")

    class _Lazy:
        def __init__(self, loader, count):
            self._loader, self._count = loader, count

        def __getitem__(self, i):
            return np.asarray(self._loader(i)).astype(np.float32)

        def __len__(self):
            return self._count

    lum_det = _Lazy(load_det_lum, n)
    foot_det = _Lazy(load_det_foot, n)
    ref = RunningReference(lum_det, cfg.ref_window, cfg.ref_sigma,
                           exclude=set(np.nonzero(lp)[0]),
                           footprints=foot_det)
    streaks_per_frame = {}
    diffs_det = {}
    noise_sigmas = {}
    for i in range(n):
        if lp[i]:
            continue
        d = difference(lum_det[i], ref.for_frame(i), foot_det[i])
        # per-frame residual noise (haze/cloud raises it -> lower weight)
        med = float(np.median(d))
        noise_sigmas[i] = 1.4826 * float(np.median(np.abs(d - med))) + 1e-3
        s = detect_streaks(d, i, cfg, rgb_diff=None, bin_factor=S)
        if s:
            streaks_per_frame[i] = s
            diffs_det[i] = np.clip(d, 0, 65535).astype(np.uint16)
        if (i + 1) % 5 == 0 or i == n - 1:
            notify(0.45 + 0.08 * (i + 1) / n,
                   f"searching every frame for meteors ({i + 1}/{n})")

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
                              (hd, wd), S, bad_pixels)
    radiant = radiant_at_epoch(cfg, base_meta.epoch_mid)
    candidates = classify(candidates, cfg, radiant)
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
        notify(0.60, "building the clean starfield from every frame")
        base_img, fg_stack = _stream_base(
            cfg, frames, ok_idx, det_wcs, base_wcs, base_det_wcs, (h, w), S,
            corridor_segments, weights, cache, bad_pixels, notify)
        import tifffile
        tifffile.imwrite(cache.path("base.tif"),
                         np.clip(base_img, 0, 65535).astype(np.uint16),
                         compression="lzw")
        if fg_stack is not None:
            tifffile.imwrite(cache.path("fg_stack.tif"),
                             np.clip(fg_stack, 0, 65535).astype(np.uint16),
                             compression="lzw")
        stage_done("base_sky")
    import tifffile
    base_img = tifffile.imread(cache.path("base.tif")).astype(np.float32)
    fg_stack = (tifffile.imread(cache.path("fg_stack.tif")).astype(np.float32)
                if cache.path("fg_stack.tif").exists() else None)
    base_lum = raw_mod.luminance(base_img)

    # ---------------- extraction (full quality, meteor frames only) -----
    notify(0.82, "cutting each meteor onto its own layer")
    from meteorprep.astrometry.solve import detect_stars
    star_cat_xy = detect_stars(base_img, max_stars=500)

    _full_cache: dict[int, tuple] = {}

    def full_aligned(i):
        if i not in _full_cache:
            if len(_full_cache) > 2:
                _full_cache.pop(next(iter(_full_cache)))
            rgb = raw_mod.decode(frames[i].path, "final", bad_pixels,
                                 half_size=cfg.half_size)
            if cfg.align_mode == "reproject_tan":
                arr, foot = reproject_frame(
                    rgb, scale_wcs(det_wcs[i], S), base_wcs, (h, w),
                    quality=True)
            else:
                from meteorprep.astrometry.reproject_frames import rotate2d_frame
                dt = (frames[i].epoch_mid - base_meta.epoch_mid).total_seconds()
                arr, foot = rotate2d_frame(rgb, SIDEREAL_DEG_PER_SEC * dt,
                                           (w / 2.0, h / 2.0))
            _full_cache[i] = (arr.astype(np.float32), foot)
        return _full_cache[i]

    meteor_layers, flagged_layers = [], []
    roi_images = {}
    for group_list, out_list in ((meteor_cands, meteor_layers),
                                 (flagged_cands, flagged_layers)):
        for c in group_list:
            for si, (frame_file, seg_streak) in enumerate(
                    zip(c.frames, c.streaks)):
                i = file_to_idx[frame_file]
                arr, foot = full_aligned(i)
                d_full = difference(raw_mod.luminance(arr), base_lum, foot)
                layer = extract_meteor(
                    d_full, arr,
                    ((seg_streak.x0, seg_streak.y0),
                     (seg_streak.x1, seg_streak.y1)),
                    seg_streak.fwhm_px, star_xy=star_cat_xy)
                if layer is None:
                    continue
                x0, y0, x1, y1 = layer.bbox
                roi_images.setdefault(c.id, d_full[y0:y1, x0:x1].copy())
                out_list.append((c, layer, i, si))
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
    sky_mask = segment_sky(base_rgb_final)
    from PIL import Image
    Image.fromarray((sky_mask * 255).astype(np.uint8)).save(out_dir / "skymask.png")

    # ---------------- assembly ----------------
    notify(0.92, "assembling layers")
    fg_layers = [Layer(name="FG_base_time", rgb=base_rgb_final,
                       alpha=(1.0 - sky_mask), blend="normal", visible=True)]
    if fg_stack is not None:
        # frozen-ground stack: all frames averaged in camera space — far
        # lower noise than any single frame's foreground
        fg_layers.insert(0, Layer(name="FG_stacked_low_noise", rgb=fg_stack,
                                  alpha=(1.0 - sky_mask), blend="normal",
                                  visible=False))
    for i in np.nonzero(lp)[0]:
        rgb_lp = raw_mod.decode(frames[i].path, "final", bad_pixels,
                                half_size=cfg.half_size)
        fg_layers.append(Layer(name=f"FG_lightpaint_{frames[i].file}",
                               rgb=rgb_lp,
                               alpha=(1.0 - sky_mask), blend="normal",
                               visible=False))

    def to_layers(pairs, visible):
        out = []
        for k, (c, layer, i, si) in enumerate(pairs):
            flag = candidate_flag(c)
            name = meteor_layer_name(
                k + 1, c.frames[min(si, len(c.frames) - 1)],
                frames[i].epoch_mid.astimezone(timezone.utc).isoformat(),
                c.rotation_deg, c.confidence, flag)
            out.append(Layer(name=name, rgb=layer.rgb, alpha=layer.alpha,
                             bbox=layer.bbox, blend="lighten", visible=visible))
        return out

    extra_layers = []
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
    if cfg.emit_pngjsx:
        outputs["jsx"] = str(write_pngjsx(stack, out_dir))
    if cfg.emit_psd:
        psd_path = write_psd(stack, out_dir / "meteorprep.psd")
        if psd_path:
            outputs["psd"] = str(psd_path)
    if cfg.emit_contact_sheet and candidates:
        cs = make_contact_sheet(candidates, roi_images,
                                out_dir / "contact_sheet.png")
        if cs:
            outputs["contact_sheet"] = str(cs)
    if cfg.emit_startrail:
        trail = lighten_stack(
            lambda i: raw_mod.decode(frames[i].path, "final", bad_pixels,
                                     half_size=cfg.half_size)
            .astype(np.float32), n)
        tifffile.imwrite(out_dir / "startrail.tif",
                         np.clip(trail, 0, 65535).astype(np.uint16),
                         compression="lzw")
        outputs["startrail"] = str(out_dir / "startrail.tif")

    sidecar = write_sidecar(
        out_dir / "meteorprep.json", cfg, group.group_id, base_meta.file,
        base_wcs, pole_xy, radiant, frames, candidates,
        alignment_quality, solver_used, solve_files)
    outputs["sidecar"] = str(sidecar)
    if cfg.cleanup_cache:
        import shutil as _shutil
        _shutil.rmtree(det_dir, ignore_errors=True)
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

def _measure_candidate_colors(candidates, frames, det_wcs, base_det_wcs,
                              shape_det, S, bad_pixels) -> None:
    """Lazy colour measurement (§3.6): only candidate frames are re-decoded
    for RGB, against an aligned neighbour so stars cancel."""
    if base_det_wcs is None:
        return
    file_to_idx = {m.file: i for i, m in enumerate(frames)}

    def det_rgb(i):
        rgb = raw_mod.decode(frames[i].path, "detect", bad_pixels,
                             half_size=True)
        arr, _ = reproject_frame(rgb, det_wcs[i], base_det_wcs, shape_det,
                                 quality=False)
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


def _stream_base(cfg, frames, ok_idx, det_wcs, base_wcs, base_det_wcs,
                 shape_out, S, corridor_segments, frame_weights, cache,
                 bad_pixels, notify):
    """Two-pass streaming sigma-clipped, noise-weighted stack at output
    resolution — the same rejection statistics as the leading stackers'
    kappa-sigma integration, with detected streaks additionally masked and
    per-frame noise weights, holding at most one frame in memory.

    Returns (base_rgb float32, foreground_rgb float32 | None): the
    foreground (unaligned, "frozen ground") mean is accumulated inside
    pass 1 at no extra decode cost.
    """
    h, w = shape_out
    tmp = cache.dir("stack_tmp")

    def frame_args(mode, indices, worker_id, want_fg=False):
        return (mode, list(indices),
                [str(frames[i].path) for i in indices],
                [_wcs_to_str(scale_wcs(det_wcs[i], S))
                 if base_det_wcs is not None else "" for i in indices],
                _wcs_to_str(base_wcs) if base_wcs is not None else "",
                (h, w),
                {i: corridor_segments[i] for i in indices
                 if i in corridor_segments},
                {i: frame_weights.get(i, 1.0) for i in indices},
                str(tmp), worker_id, cfg.half_size, bad_pixels,
                cfg.stack_sigma, want_fg)

    # each worker holds ~1 GB at full 20 MP resolution: keep laptops with
    # little memory on one worker, others on at most two
    n_workers = 1 if _available_ram_gb() < 12 else max(min(cfg.jobs, 2), 1)

    def run_pass(mode, frac0, frac1, label, want_fg=False):
        results = []
        if base_wcs is not None and n_workers > 1 and len(ok_idx) >= n_workers:
            chunk_size = max(len(ok_idx) // (n_workers * 4), 4)
            chunks = [ok_idx[k:k + chunk_size]
                      for k in range(0, len(ok_idx), chunk_size)]
            from concurrent.futures import ProcessPoolExecutor, as_completed
            try:
                with ProcessPoolExecutor(max_workers=n_workers) as pool:
                    futures = {pool.submit(
                        _stack_pass, frame_args(mode, chunk, k, want_fg)): k
                        for k, chunk in enumerate(chunks)}
                    done = 0
                    for fut in as_completed(futures):
                        results.append(fut.result())
                        done += 1
                        notify(frac0 + (frac1 - frac0) * done / len(chunks),
                               f"{label} ({done}/{len(chunks)} parts)")
            except Exception as exc:
                log.warning("parallel stacking failed (%s); one core", exc)
                results = []
        if not results:
            results = [_stack_pass(frame_args(mode, ok_idx, 0, want_fg))]
        return results

    if base_wcs is None:
        return (_rotate2d_mean(cfg, frames, ok_idx, corridor_segments,
                               shape_out, bad_pixels),
                None)

    # -------- pass 1: per-pixel moments (+ folded-in foreground sum) -----
    from meteorprep.stack.streaming import RunningMoments
    want_fg = bool(cfg.emit_foreground_stack)
    parts = run_pass("moments", 0.60, 0.70,
                     "measuring the sky (pass 1 of 2)", want_fg)
    total = RunningMoments((h, w, 3))
    fg_sum = np.zeros((h, w, 3), np.float32) if want_fg else None
    fg_n = 0
    for p in parts:
        part = RunningMoments((h, w, 3))
        part.count = np.load(p["count"])
        part.mean = np.load(p["mean"])
        part.m2 = np.load(p["m2"])
        total.combine(part)
        if want_fg and "fg" in p:
            fg_sum += np.load(p["fg"])
            fg_n += p["fg_n"]
    np.save(tmp / "clip_mean.npy", total.mean)
    np.save(tmp / "clip_bound.npy",
            (cfg.stack_sigma * total.std()).astype(np.float32))
    fg = (fg_sum / max(fg_n, 1)) if want_fg and fg_n else None
    del fg_sum

    # -------- pass 2: sigma-clipped, frame-weighted mean -----------------
    parts = run_pass("clipped", 0.70, 0.80,
                     "building the clean starfield (pass 2 of 2)")
    total_sum = np.zeros((h, w, 3), np.float64)
    total_w = np.zeros((h, w, 3), np.float64)
    for p in parts:
        total_sum += np.load(p["csum"])
        total_w += np.load(p["cwsum"])
    # pixels where clipping rejected everything fall back to the plain mean
    base = np.where(total_w > 0, total_sum / np.maximum(total_w, 1e-6),
                    total.mean)
    import shutil as _shutil
    _shutil.rmtree(tmp, ignore_errors=True)
    return base.astype(np.float32), fg


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
