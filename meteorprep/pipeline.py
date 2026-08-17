"""Deterministic, resumable pipeline orchestrator (§1.2).

Every mechanical/geometric step is automated; every aesthetic decision is
surfaced as a PSD layer toggle and never baked in (§8).
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
from meteorprep.detect.hough import bin2x, detect_streaks
from meteorprep.detect.radiant import radiant_at_epoch
from meteorprep.detect.reference import RunningReference, reference_model
from meteorprep.detect.track import build_tracks
from meteorprep.ingest import raw as raw_mod
from meteorprep.ingest.exif import read_metadata, scan_input_dir
from meteorprep.ingest.lightpaint import flag_lightpainted, ground_luminance
from meteorprep.ingest.segment_folder import segment_folder
from meteorprep.mask.extract import extract_meteor
from meteorprep.report.sidecar import write_sidecar
from meteorprep.segment.sky_ground import segment_sky
from meteorprep.stack.base_sky import stack_frames
from meteorprep.stack.startrail import lighten_stack

log = logging.getLogger("meteorprep")


def run(cfg: Config, progress=None) -> dict:
    """Run the pipeline; returns a summary dict with output paths."""
    logging.basicConfig(level=logging.INFO,
                        format="%(levelname)s %(message)s")
    notify = progress or (lambda frac, msg: log.info("[%3d%%] %s",
                                                     int(frac * 100), msg))
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

    results = {"groups": []}
    for group in groups:
        res = _run_group(cfg, group, bad_pixels, notify)
        results["groups"].append(res)
    return results


def _run_group(cfg: Config, group, bad_pixels, notify) -> dict:
    frames = group.frames
    n = len(frames)
    out_dir = cfg.output_path / group.group_id
    out_dir.mkdir(parents=True, exist_ok=True)
    cache = CacheStore(cfg.cache_path / group.group_id)
    skipped = 0

    def stage_fresh(stage):
        nonlocal skipped
        h = cfg.stage_hash(stage)
        if not cfg.force and cache.is_done(stage, h):
            skipped += 1
            return False
        return True

    def decode_lum(i):
        rgb = raw_mod.decode(frames[i].path, "detect", bad_pixels)
        return raw_mod.luminance(rgb)

    # ---------------- light-paint flags ----------------
    if stage_fresh("lightpaint"):
        notify(0.06, "flagging light-painted frames")
        gmed = np.array([ground_luminance(decode_lum(i), None) for i in range(n)])
        lp = flag_lightpainted(gmed, cfg.lp_window, cfg.lp_sigma)
        cache.write_json("lightpaint.json", lp.tolist())
        cache.mark_done("lightpaint", cfg.stage_hash("lightpaint"))
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
    base_rgb_final = raw_mod.decode(base_meta.path, "final", bad_pixels)
    h, w = base_rgb_final.shape[:2]

    # ---------------- plate solving ----------------
    notify(0.12, "plate solving (sparse subset)")
    pixel_scale_deg = float(np.rad2deg(np.arctan(
        cfg.pixel_pitch_um * 1e-3 / max(frames[base_i].focal_mm, 1e-3))))
    catalog = (np.load(cfg.catalog_file) if cfg.catalog_file else None)

    k1 = cfg.lens_k1
    if abs(k1) < 1e-12:
        found = lookup_lensfun_k1(cfg.lens_model, base_meta.focal_mm)
        if found is not None:
            k1 = found
            log.info("Lensfun k1=%.5f for %s", k1, cfg.lens_model)
    dist = Poly3Distortion(k1, (h, w))
    undistort = None if dist.identity() else dist.undistort

    wcs_per_frame: list = [None] * n
    solver_used = "none"
    alignment_quality = "nominal"
    solve_files: list[str] = []

    if cfg.align_mode == "reproject_tan":
        seed = None
        if np.isfinite(cfg.seed_ra_deg) and np.isfinite(cfg.seed_dec_deg):
            seed = build_tan_wcs(cfg.seed_ra_deg, cfg.seed_dec_deg,
                                 pixel_scale_deg, (h, w),
                                 rotation_deg=cfg.seed_rotation_deg)
        base_lum = decode_lum(base_i)
        result = solve_frame(base_lum, seed, catalog, cfg,
                             image_path=base_meta.path, undistort=undistort)
        if result is None:
            raise RuntimeError(
                "I couldn't match the stars in your photos to a star map "
                "(this is how the tool learns where the camera was pointed). "
                "Two easy fixes, either works:\n"
                "  1. Install the star-matching add-on and make sure you're "
                "online:  pip install twirl astroquery\n"
                "  2. Or install the astrometry.net solver "
                "(Mac: brew install astrometry-net, plus its index files).\n"
                "If clouds/trees hide most of the sky in the middle frame, "
                "try again — the tool picks a different reference frame if "
                "you delete the worst frames from the folder.")
        base_wcs = result.wcs
        solver_used = result.source
        base_meta.wcs_source = "solved"
        base_meta.solve_rms_px = result.rms_px
        wcs_per_frame[base_i] = base_wcs
        solve_files.append(base_meta.file)
        log.info("base solve via %s: rms=%.2f px (%d stars)",
                 result.source, result.rms_px, result.n_matched)

        # sparse subset: every K-th frame; others propagated + verified
        base_mid = base_meta.epoch_mid
        solve_targets = {i for i in range(0, n, max(cfg.solve_every_k, 1))}
        solve_targets.add(base_i)
        solved = {base_i: base_wcs}
        for i in sorted(solve_targets):
            if i == base_i or lp[i]:
                continue
            dt = (frames[i].epoch_mid - base_mid).total_seconds()
            seed_i = propagate_wcs(base_wcs, dt)
            res_i = solve_frame(decode_lum(i), seed_i, catalog, cfg,
                                image_path=frames[i].path, undistort=undistort)
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
                wcs_per_frame[i] = solved[i]
                continue
            nearest = min(solved, key=lambda j: abs(
                (frames[i].epoch_mid - frames[j].epoch_mid).total_seconds()))
            dt = (frames[i].epoch_mid - frames[nearest].epoch_mid).total_seconds()
            wcs_per_frame[i] = propagate_wcs(solved[nearest], dt)
            frames[i].wcs_source = "propagated"
            if catalog is not None and not lp[i]:
                rms, nm = solve_rms_px(wcs_per_frame[i],
                                       _detected_for_verify(decode_lum(i), undistort),
                                       catalog)
                frames[i].solve_rms_px = rms
                if rms > cfg.solve_rms_max_px and nm >= cfg.solve_min_stars:
                    res_i = solve_frame(decode_lum(i), wcs_per_frame[i],
                                        catalog, cfg, undistort=undistort)
                    if res_i is not None:
                        wcs_per_frame[i] = res_i.wcs
                        frames[i].wcs_source = "solved"
                        frames[i].solve_rms_px = res_i.rms_px
                        solve_files.append(frames[i].file)
        pole_xy = pole_pixel_xy(base_wcs)
    else:
        # --align-mode=rotate2d: explicitly degraded (§4.7)
        alignment_quality = "degraded"
        solver_used = "rotate2d"
        base_wcs = None
        pole_xy = None
        log.warning("ALIGNMENT DEGRADED: rotate2d mode — corner stars "
                    "mis-register by up to ~720 px/hr and meteors will not "
                    "radiate correctly from the true radiant")

    # ---------------- reprojection ----------------
    reproj_dir = cache.dir("reproj")
    if stage_fresh("reproject"):
        notify(0.3, "reprojecting frames onto base WCS")
        for i in range(n):
            rgb = raw_mod.decode(frames[i].path, "final", bad_pixels)
            if cfg.align_mode == "reproject_tan":
                arr, foot = reproject_frame(rgb, wcs_per_frame[i], base_wcs,
                                            (h, w), quality=True)
            else:
                from meteorprep.astrometry.reproject_frames import rotate2d_frame
                dt = (frames[i].epoch_mid - base_meta.epoch_mid).total_seconds()
                angle = SIDEREAL_DEG_PER_SEC * dt
                center = (w / 2.0, h / 2.0)
                arr, foot = rotate2d_frame(rgb, angle, center)
            np.save(reproj_dir / f"rgb_{i:04d}.npy",
                    np.clip(arr, 0, 65535).astype(np.uint16))
            np.save(reproj_dir / f"foot_{i:04d}.npy", foot.astype(np.uint8))
        cache.mark_done("reproject", cfg.stage_hash("reproject"))

    def load_rgb(i):
        return np.load(reproj_dir / f"rgb_{i:04d}.npy", mmap_mode="r")

    def load_foot(i):
        return np.load(reproj_dir / f"foot_{i:04d}.npy", mmap_mode="r")

    # ---------------- detection ----------------
    notify(0.5, "detecting meteors")
    binf = cfg.bin_factor
    lum_binned = [bin2x(raw_mod.luminance(np.asarray(load_rgb(i))), binf)
                  for i in range(n)]
    foot_binned = [(bin2x(np.asarray(load_foot(i)).astype(np.float32), binf) > 0.99)
                   .astype(np.uint8) for i in range(n)]
    ref = RunningReference(lum_binned, cfg.ref_window, cfg.ref_sigma,
                           exclude=set(np.nonzero(lp)[0]),
                           footprints=foot_binned)
    streaks_per_frame = {}
    for i in range(n):
        if lp[i]:
            continue
        d = difference(lum_binned[i], ref.for_frame(i), foot_binned[i])
        # colour ratios from an aligned neighbour difference (stars cancel)
        rgb_b = bin2x(np.asarray(load_rgb(i)), binf)
        j = i - 1 if i > 0 else i + 1
        rgb_d = np.clip(rgb_b - bin2x(np.asarray(load_rgb(j)), binf), 0, None)
        s = detect_streaks(d, i, cfg, rgb_diff=rgb_d, bin_factor=binf)
        if s:
            streaks_per_frame[i] = s

    # ---------------- tracking + classification ----------------
    notify(0.62, "classifying candidates")
    if base_wcs is not None:
        def world_endpoints(fi, s):
            r0 = base_wcs.pixel_to_world_values(s.x0, s.y0)
            r1 = base_wcs.pixel_to_world_values(s.x1, s.y1)
            return ((float(r0[0]), float(r0[1])), (float(r1[0]), float(r1[1])))
    else:
        # degraded mode: use a nominal pixel->pseudo-world scaling
        def world_endpoints(fi, s):
            return ((s.x0 * pixel_scale_deg, s.y0 * pixel_scale_deg),
                    (s.x1 * pixel_scale_deg, s.y1 * pixel_scale_deg))

    candidates = build_tracks(streaks_per_frame, world_endpoints,
                              [m.file for m in frames])
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

    # ---------------- extraction ----------------
    notify(0.7, "extracting meteor layers")
    meteor_cands = [c for c in candidates if c.label == "meteor"]
    flagged_cands = [c for c in candidates if c.label != "meteor"]
    meteor_cands.sort(key=lambda c: file_to_idx[c.frames[0]])

    from meteorprep.astrometry.solve import detect_stars
    base_stack_lum = None  # full-res reference for extraction frames

    def fullres_diff(i):
        half = max(cfg.ref_window // 2, 1)
        idx = [j for j in range(max(0, i - half), min(n, i + half + 1))
               if j != i and not lp[j]]
        win = np.stack([raw_mod.luminance(np.asarray(load_rgb(j))) for j in idx])
        refl = reference_model(win, sigma=cfg.ref_sigma)
        return difference(raw_mod.luminance(np.asarray(load_rgb(i))), refl,
                          np.asarray(load_foot(i)))

    meteor_layers, flagged_layers = [], []
    roi_images = {}
    exclusion_masks = {i: None for i in range(n)}
    star_cat_xy = None

    for group_list, out_list in ((meteor_cands, meteor_layers),
                                 (flagged_cands, flagged_layers)):
        for c in group_list:
            for si, (frame_file, seg_streak) in enumerate(
                    zip(c.frames, c.streaks)):
                i = file_to_idx[frame_file]
                d_full = fullres_diff(i)
                if star_cat_xy is None:
                    star_cat_xy = detect_stars(
                        np.asarray(load_rgb(base_i)).astype(np.float32),
                        max_stars=500)
                layer = extract_meteor(
                    d_full, np.asarray(load_rgb(i)).astype(np.float32),
                    ((seg_streak.x0, seg_streak.y0),
                     (seg_streak.x1, seg_streak.y1)),
                    seg_streak.fwhm_px, star_xy=star_cat_xy)
                if layer is None:
                    continue
                x0, y0, x1, y1 = layer.bbox
                roi_images.setdefault(c.id, d_full[y0:y1, x0:x1].copy())
                mask = exclusion_masks.get(i)
                if mask is None:
                    mask = np.zeros((h, w), bool)
                mask[y0:y1, x0:x1] |= layer.alpha > 0.02
                exclusion_masks[i] = mask
                out_list.append((c, layer, i, si))

    # ---------------- base sky stack ----------------
    if stage_fresh("base_sky"):
        notify(0.8, "stacking point-star base (meteors excluded)")
        stack_idx = ok_idx

        def frame_loader(k):
            return np.asarray(load_rgb(stack_idx[k])).astype(np.float32)

        def mask_loader(k):
            i = stack_idx[k]
            m = exclusion_masks.get(i)
            foot = np.asarray(load_foot(i)) == 0
            return foot if m is None else (m | foot)

        base = stack_frames(frame_loader, len(stack_idx), (h, w, 3),
                            sigma=cfg.stack_sigma, maxiters=cfg.stack_maxiters,
                            band_rows=cfg.stack_band_rows,
                            mask_loader=mask_loader)
        import tifffile
        tifffile.imwrite(cache.path("base.tif"),
                         np.clip(base, 0, 65535).astype(np.uint16),
                         compression="lzw")
        cache.mark_done("base_sky", cfg.stage_hash("base_sky"))
    import tifffile
    base_img = tifffile.imread(cache.path("base.tif")).astype(np.float32)

    # ---------------- sky/ground segmentation ----------------
    notify(0.85, "segmenting sky/ground")
    sky_mask = segment_sky(base_rgb_final)
    from PIL import Image
    Image.fromarray((sky_mask * 255).astype(np.uint8)).save(out_dir / "skymask.png")

    # ---------------- assembly ----------------
    notify(0.9, "assembling layers")
    fg_layers = [Layer(name="FG_base_time",
                       rgb=base_rgb_final.astype(np.float32),
                       alpha=(1.0 - sky_mask), blend="normal", visible=True)]
    for i in np.nonzero(lp)[0]:
        rgb_lp = raw_mod.decode(frames[i].path, "final", bad_pixels)
        fg_layers.append(Layer(name=f"FG_lightpaint_{frames[i].file}",
                               rgb=rgb_lp.astype(np.float32),
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

    stack = LayerStack(
        width=w, height=h,
        base=Layer(name="BASE_SKY", rgb=base_img, blend="normal", visible=True),
        groups=[
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
            lambda i: raw_mod.decode(frames[i].path, "final", bad_pixels)
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
    if skipped:
        log.info("%d stage(s) up-to-date, skipped", skipped)
    notify(1.0, f"done: {len(meteor_cands)} meteor(s), "
                f"{len(flagged_cands)} flagged candidate(s)")
    return {"group": group.group_id, "outputs": outputs,
            "n_meteors": len(meteor_cands), "n_flagged": len(flagged_cands),
            "alignment_quality": alignment_quality,
            "candidates": [c.to_dict() for c in candidates]}


def _detected_for_verify(lum, undistort):
    from meteorprep.astrometry.solve import detect_stars
    stars = detect_stars(lum, max_stars=100)
    if undistort is not None and len(stars):
        stars = undistort(stars)
    return stars
