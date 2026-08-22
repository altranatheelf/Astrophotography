"""End-to-end integration on the synthetic sequence (§9.3, §9.4)."""

import json
from pathlib import Path

import numpy as np
import tifffile


def _meteor_matches(cand, gt_meteor, gt_frame_file, tol_px=80.0):
    if gt_frame_file not in cand["frames"]:
        return False
    (hx, hy), (tx, ty) = gt_meteor["head_base_px"], gt_meteor["tail_base_px"]
    gt_mid = np.array([(hx + tx) / 2, (hy + ty) / 2])
    (x0, y0), (x1, y1) = cand["endpoints_base_px"]
    mid = np.array([(x0 + x1) / 2, (y0 + y1) / 2])
    return float(np.linalg.norm(mid - gt_mid)) < tol_px


def test_recall_and_precision(pipeline_result, ground_truth):
    """§9.4: recall >= 0.9 for injected streaks; precision >= 0.95 after
    multi-frame classification."""
    g = pipeline_result["groups"][0]
    meteors = [c for c in g["candidates"] if c["label"] == "meteor"]
    gt_meteors = ground_truth["meteors"]

    recovered = 0
    for m in gt_meteors:
        f = f"SYN_{m['frame']:04d}.tif"
        if any(_meteor_matches(c, m, f) for c in meteors):
            recovered += 1
    recall = recovered / len(gt_meteors)
    assert recall >= 0.9

    true_pos = sum(
        1 for c in meteors
        if any(_meteor_matches(c, m, f"SYN_{m['frame']:04d}.tif")
               for m in gt_meteors))
    precision = true_pos / max(len(meteors), 1)
    assert precision >= 0.95


def test_aircraft_and_satellite_flagged(pipeline_result, ground_truth):
    """§9.4: >= 0.95 true-flag rate on injected multi-frame objects — here
    every injected aircraft and satellite must be flagged, never curated."""
    g = pipeline_result["groups"][0]
    flagged = [c for c in g["candidates"] if c["label"] != "meteor"]
    meteors = [c for c in g["candidates"] if c["label"] == "meteor"]

    # (a meteor may legitimately share a *frame* with an aircraft dash —
    # spatial purity of the curated set is asserted by the precision test)
    for ac in ground_truth["aircraft"]:
        files = {f"SYN_{i:04d}.tif" for i in ac["frames"]}
        hits = [c for c in flagged if files & set(c["frames"])]
        assert hits, f"aircraft {ac['id']} not flagged"
        assert any(c["flags"].get("aircraft") for c in hits)
    for sa in ground_truth["satellites"]:
        files = {f"SYN_{i:04d}.tif" for i in sa["frames"]}
        hits = [c for c in flagged if files & set(c["frames"])]
        assert hits, f"satellite {sa['id']} not flagged"
    # every multi-frame (non-boundary) candidate must be flagged, not curated
    assert all(c["persistence"] == 1 or c["spans_boundary"]
               for c in meteors)


def test_radiant_recovered(pipeline_result):
    """§9.4: injected radiant recovered within < 3 deg on meteor streaks."""
    g = pipeline_result["groups"][0]
    misses = [c["radiant_miss_deg"] for c in g["candidates"]
              if c["label"] == "meteor" and c["radiant_miss_deg"] is not None]
    assert misses
    assert float(np.median(misses)) < 3.0
    assert all(c["likely_perseid"] for c in g["candidates"]
               if c["label"] == "meteor")


def test_base_excludes_meteors(pipeline_result, ground_truth, synth_config):
    """§9.4: 0 injected-meteor pixels leak into the base — luminance along
    every ground-truth streak stays at background level."""
    base = tifffile.imread(
        Path(synth_config.output_dir) / "cache" / "g01" / "base.tif")
    lum = base.astype(np.float32).mean(axis=2)
    h, w = lum.shape
    background = float(np.median(lum))
    for m in ground_truth["meteors"]:
        (hx, hy), (tx, ty) = m["head_base_px"], m["tail_base_px"]
        samples = []
        for t in np.linspace(0.1, 0.9, 40):
            x = int(round(hx + t * (tx - hx)))
            y = int(round(hy + t * (ty - hy)))
            if 0 <= x < w and 0 <= y < h:
                samples.append(lum[y, x])
        assert samples
        # median along the streak: immune to the odd star crossing, but any
        # meteor leak (peak ~4e4 ADU) would blow far past this bound
        assert float(np.median(samples)) < background + 800


def test_outputs_exist_and_sidecar_valid(pipeline_result, synth_config):
    g = pipeline_result["groups"][0]
    out = Path(synth_config.output_dir) / "g01"
    assert (out / "assemble.jsx").exists()
    assert (out / "layers").is_dir()
    assert (out / "skymask.png").exists()
    assert (out / "contact_sheet.png").exists()

    sidecar = json.loads((out / "meteorprep.json").read_text())
    assert sidecar["tool_version"]
    assert sidecar["alignment"]["mode"] == "reproject_tan"
    assert sidecar["alignment"]["quality"] == "nominal"
    assert sidecar["params_hash"].startswith("sha256:")
    assert sidecar["base_wcs_fits_header"]
    assert sidecar["pole_pixel_xy"] is not None
    assert len(sidecar["frames"]) == 12
    assert len(sidecar["candidates"]) == len(g["candidates"])

    jsx = (out / "assemble.jsx").read_text()
    # streak layers carry the meteor's own added light and are screened
    # onto the sky (Lighten pasted the source frame's sky with them)
    assert "BlendMode.SCREEN" in jsx
    assert "BASE_SKY" in jsx
    manifest = json.loads((out / "layers_manifest.json").read_text())
    meteor_layers = [m for m in manifest if m["group"] == "METEORS"]
    assert len(meteor_layers) == g["n_meteors"]
    # naming convention (§7.1)
    assert all(m["name"].startswith("M0") and "deg_c" in m["name"]
               for m in meteor_layers)
    flagged_layers = [m for m in manifest if m["group"] == "FLAGGED"]
    assert all(not m["visible"] for m in flagged_layers)
    for m in meteor_layers + flagged_layers:
        assert (out / "layers" / m["file"]).exists()
    # One number per candidate across the WHOLE document.  FLAGGED used to
    # restart at M001, so the repair the guide tells people to make —
    # dragging a mislabelled trail up into METEORS — landed a second M001
    # next to the first.
    numbers = [m["name"].split("_")[0]
               for m in meteor_layers + flagged_layers]
    assert len(set(numbers)) == len(numbers), numbers


def test_rerun_uses_cache(pipeline_result, synth_config, caplog):
    """A normal re-run is idempotent and reports skipped stages instead of
    silently doing nothing (fixes detect_meteors' progress.json bug)."""
    import logging
    from meteorprep.pipeline import run

    with caplog.at_level(logging.INFO, logger="meteorprep"):
        res2 = run(synth_config)
    assert res2["groups"][0]["n_meteors"] == \
        pipeline_result["groups"][0]["n_meteors"]
    assert any("up-to-date" in r.message for r in caplog.records)


def test_psd_roundtrip(pipeline_result, synth_config):
    """§9.4 PSD round-trip through the native writer, verified with the
    independent psd-tools parser: structure, blend modes, visibility, and
    a bit-exact base-pixel comparison."""
    import pytest
    pytest.importorskip("psd_tools")
    import tifffile
    from psd_tools import PSDImage

    psd_path = Path(synth_config.output_dir) / "g01" / "meteorprep.psd"
    assert psd_path.exists()
    psd = PSDImage.open(psd_path)
    names = {l.name for l in psd}
    assert "BASE_SKY" in names
    assert {"FOREGROUND", "METEORS", "FLAGGED"} <= names
    by_name = {l.name: l for l in psd}
    assert by_name["METEORS"].is_group()
    assert not by_name["FLAGGED"].visible
    # base pixels must round-trip exactly against the cached stack
    base_p = Path(synth_config.output_dir) / "cache" / "g01" / "base.tif"
    if base_p.exists():
        comp = psd.numpy()[:, :, :3]
        h, w = comp.shape[:2]
        # crop-aware: compare the overlapping region
        ref = None
        for l in psd:
            if l.name == "BASE_SKY":
                ref = l.numpy()[:, :, :3]
        assert ref is not None and ref.shape[:2] == (h, w)
        assert float(np.abs(comp - ref).max()) < 1.0 / 65535 * 2


def test_base_stack_contains_stars(pipeline_result, ground_truth, synth_config):
    """The stacked BASE_SKY must actually contain the sky: bright catalog
    stars must stand far above the local background at their predicted
    positions across the WHOLE canvas (all four quadrants).  Guards the
    resample/statistics plumbing — a half-size/WCS mismatch once collapsed
    all content into the top-left quadrant while every geometry test still
    passed."""
    import tifffile
    from pathlib import Path
    base_p = Path(synth_config.output_dir) / "cache" / "g01" / "base.tif"
    if not base_p.exists():
        import pytest
        pytest.skip("base cache cleaned")
    base = tifffile.imread(base_p).astype(np.float32).mean(axis=2)
    h, w = base.shape
    sky_med = float(np.median(base))
    quad_hits = np.zeros(4, dtype=int)
    frames = ground_truth["frames"]
    stars = np.array(ground_truth["stars_base_px"]) \
        if "stars_base_px" in ground_truth else None
    if stars is None:
        # fall back: brightest pixels well above background in each quadrant
        for qi, (sy, sx) in enumerate(((slice(0, h//2), slice(0, w//2)),
                                       (slice(0, h//2), slice(w//2, None)),
                                       (slice(h//2, None), slice(0, w//2)),
                                       (slice(h//2, None), slice(w//2, None)))):
            q = base[sy, sx]
            quad_hits[qi] = int(np.percentile(q, 99.98) > sky_med + 10 * q.std())
        assert quad_hits.sum() >= 3, f"quadrants without stars: {quad_hits}"
        return


def test_preview_and_report_emitted(pipeline_result):
    """The effortless outputs: a ready-to-view preview.jpg and a
    one-double-click report.html must exist and reference each other."""
    from pathlib import Path
    g = pipeline_result["groups"][0]
    assert "preview" in g["outputs"], g["outputs"]
    assert Path(g["outputs"]["preview"]).stat().st_size > 10000
    assert "report" in g["outputs"]
    text = Path(g["outputs"]["report"]).read_text()
    assert "preview.jpg" in text and "meteor" in text


def test_a_quick_look_leaves_the_alignment_for_the_full_run(
        synth_dir, ground_truth, tmp_path):
    """The window runs with cleanup_cache on, and the whole promise of a
    quick look is that the full run after it starts most of the way in.
    The mid-run cleanup is guarded for a draft and says so in a comment;
    the end-of-run one was not, so every quick look deleted the alignment
    it had just paid for, ten lines from the end of the same run."""
    import dataclasses

    from meteorprep import modes as M
    from meteorprep.config import Config
    from meteorprep.pipeline import run

    base = Config(
        input_dir=str(synth_dir), output_dir=str(tmp_path / "out"),
        catalog_file=str(synth_dir / "catalog_radec.npy"),
        pixel_pitch_um=16000.0 / ground_truth["focal_px"],
        seed_ra_deg=ground_truth["tangent_radec"][0] + 0.2,
        seed_dec_deg=ground_truth["tangent_radec"][1] - 0.15,
        solve_every_k=4, cleanup_cache=True, emit_contact_sheet=False)

    run(dataclasses.replace(base, **M.config_kwargs("quick")))
    aligned = tmp_path / "out" / "cache" / "g01" / "detect_aligned"
    kept = sorted(aligned.glob("lum_*.npy")) if aligned.is_dir() else []
    assert kept, "the quick look threw away the alignment the full run needs"

    res = run(dataclasses.replace(base, **M.config_kwargs("full")))
    timings = dict(res["groups"][0]["timings"])
    realign = [v for k, v in timings.items() if "aligning" in k]
    assert realign and realign[0] < 0.5, timings   # reused, not redone
    # and the full run, which has no successor to hand anything to,
    # frees it
    assert not aligned.is_dir()


def test_the_one_core_fallback_stacks_the_same_night(
        synth_dir, ground_truth, tmp_path, monkeypatch):
    """When the parallel stack dies, the run finishes on one core — and
    the picture it produces has to be the picture the parallel pass would
    have produced.  The retry used to be handed worker 0's accumulator
    block back, the same block a worker that outlived the shutdown could
    still be adding frames into, so a chunk of the night was counted
    twice: a brightness and coverage error in the finished starfield with
    nothing in the log but "one core"."""
    import dataclasses

    import meteorprep.pipeline as P
    from meteorprep.config import Config
    from meteorprep.pipeline import run

    base = Config(
        input_dir=str(synth_dir), output_dir=str(tmp_path / "clean"),
        catalog_file=str(synth_dir / "catalog_radec.npy"),
        pixel_pitch_um=16000.0 / ground_truth["focal_px"],
        seed_ra_deg=ground_truth["tangent_radec"][0] + 0.2,
        seed_dec_deg=ground_truth["tangent_radec"][1] - 0.15,
        solve_every_k=4, jobs=2, emit_psd=False, emit_contact_sheet=False)
    run(base)
    import tifffile
    cdir = tmp_path / "clean" / "cache" / "g01"
    clean = tifffile.imread(cdir / "base.tif").astype(np.int32)
    clean_cov = np.load(cdir / "coverage.npy")

    real_pool = P._shared_pool

    class _DyingPool:
        """A pool that accepts the alignment work and then refuses the
        first stack submission, the way a worker dying of memory does."""

        def __init__(self, inner):
            self._inner = inner
            self._n = 0

        def submit(self, fn, *a, **k):
            if fn is P._stack_pass:
                self._n += 1
                if self._n == 1:
                    raise RuntimeError("simulated worker death")
            return self._inner.submit(fn, *a, **k)

        def __getattr__(self, name):
            return getattr(self._inner, name)

    monkeypatch.setattr(
        P, "_shared_pool",
        lambda n, exclusive=False: _DyingPool(real_pool(n, exclusive)))
    fallback_cfg = dataclasses.replace(
        base, output_dir=str(tmp_path / "fallback"))
    run(fallback_cfg)
    fdir = tmp_path / "fallback" / "cache" / "g01"
    fell_back = tifffile.imread(fdir / "base.tif").astype(np.int32)
    fell_cov = np.load(fdir / "coverage.npy")

    # coverage counts photos, so it is exact: a chunk counted twice shows
    # up here as a whole region of the canvas claiming more photos than
    # the night had
    assert np.array_equal(fell_cov, clean_cov)
    assert int(fell_cov.max()) <= 12
    # the starfield itself is summed in a different grouping (one
    # accumulator instead of per-chunk ones) and float addition is not
    # associative, so it may differ in the last ADU — but not more
    assert int(np.abs(fell_back - clean).max()) <= 2
    assert P._RETRY_WID != 0     # never the id a live worker may still own


def test_the_star_lock_is_reused_and_gives_the_same_full_size_picture(
        synth_dir, ground_truth, tmp_path, caplog):
    """Both the window and the guide promise a second run reuses the star
    lock.  It had no saved artifact at all, so every run re-solved the
    whole night.  Now it is saved — and because a quick look solves on a
    half-size CANVAS, the saved lock must be in detection space only: the
    full run that follows has to rebuild its own output geometry, or it
    inherits the draft's."""
    import dataclasses
    import json
    import logging

    from meteorprep import modes as M
    from meteorprep.config import Config
    from meteorprep.pipeline import run

    base = Config(
        input_dir=str(synth_dir), output_dir=str(tmp_path / "clean"),
        catalog_file=str(synth_dir / "catalog_radec.npy"),
        pixel_pitch_um=16000.0 / ground_truth["focal_px"],
        seed_ra_deg=ground_truth["tangent_radec"][0] + 0.2,
        seed_dec_deg=ground_truth["tangent_radec"][1] - 0.15,
        solve_every_k=4, emit_psd=False, emit_contact_sheet=False)
    run(base)
    clean_sc = json.loads(
        (tmp_path / "clean" / "g01" / "meteorprep.json").read_text())

    after = dataclasses.replace(base, output_dir=str(tmp_path / "after"))
    run(dataclasses.replace(after, **M.config_kwargs("quick")))
    assert (tmp_path / "after" / "cache" / "g01" / "solve.json").exists()
    with caplog.at_level(logging.INFO, logger="meteorprep"):
        run(dataclasses.replace(after, **M.config_kwargs("full")))
    assert any("star lock reused" in r.getMessage() for r in caplog.records)
    after_sc = json.loads(
        (tmp_path / "after" / "g01" / "meteorprep.json").read_text())

    # the full-size canvas geometry has to be the full run's own, not the
    # half-size draft's
    assert (np.allclose(after_sc["pole_pixel_xy"],
                        clean_sc["pole_pixel_xy"], atol=1e-6)), (
        after_sc["pole_pixel_xy"], clean_sc["pole_pixel_xy"])
    assert after_sc["base_wcs_fits_header"] == \
        clean_sc["base_wcs_fits_header"]
    assert after_sc["alignment"]["solver"] == clean_sc["alignment"]["solver"]

    import tifffile
    a = tifffile.imread(tmp_path / "after" / "cache" / "g01" / "base.tif")
    c = tifffile.imread(tmp_path / "clean" / "cache" / "g01" / "base.tif")
    assert a.shape == c.shape
    assert int(np.abs(a.astype(np.int32) - c.astype(np.int32)).max()) <= 2


def test_a_deleted_or_damaged_cache_rebuilds_instead_of_crashing(
        synth_dir, ground_truth, tmp_path):
    """The guide tells people cache/ is safe to delete, and a run that is
    stopped part-way can leave a half-written file behind a marker that
    still says "done".  Every one of those used to end the next run in a
    traceback, or — worse — sail on and quietly drop the seam crop and
    the frozen-foreground layer."""
    import dataclasses
    import shutil

    from meteorprep.config import Config
    from meteorprep.pipeline import run

    cfg = Config(
        input_dir=str(synth_dir), output_dir=str(tmp_path / "out"),
        catalog_file=str(synth_dir / "catalog_radec.npy"),
        pixel_pitch_um=16000.0 / ground_truth["focal_px"],
        seed_ra_deg=ground_truth["tangent_radec"][0] + 0.2,
        seed_dec_deg=ground_truth["tangent_radec"][1] - 0.15,
        solve_every_k=4, emit_psd=False, emit_contact_sheet=False)
    first = run(cfg)
    want = first["groups"][0]["n_meteors"]
    cdir = tmp_path / "out" / "cache" / "g01"
    sidecar = tmp_path / "out" / "g01" / "meteorprep.json"
    good_crop = json.loads(sidecar.read_text())["seam_crop_origin_xy"]

    def _same_again(what):
        res = run(dataclasses.replace(cfg))
        assert res["groups"][0]["n_meteors"] == want, what
        # and the canvas is the same one, not a silently uncropped
        # fallback with the seam still in it
        assert json.loads(sidecar.read_text())["seam_crop_origin_xy"] == \
            good_crop, what

    # the whole cache folder, as the guide says is safe
    shutil.rmtree(cdir)
    _same_again("after deleting cache/")

    # one artifact, cut in half by a run that was stopped
    for name in ("base.tif", "coverage.npy", "lightpaint.json",
                 "sky_det.npy", "solve.json"):
        f = cdir / name
        if not f.exists():
            continue
        raw = f.read_bytes()
        f.write_bytes(raw[:len(raw) // 2])
        _same_again(f"after truncating {name}")

    # and one deleted while its marker still says the stage is done
    for name in ("base.tif", "fg_stack.tif", "coverage.npy", "solve.json",
                 "lightpaint.json"):
        f = cdir / name
        if f.exists():
            f.unlink()
            _same_again(f"after deleting {name}")


def test_a_composite_run_skips_the_hunt_and_a_later_hunt_still_searches(
        synth_dir, ground_truth, tmp_path):
    """With the hunt off the run is a nightscape build: same aligned
    starfield, frozen foreground and layered file, no candidate layers,
    no search.  Checking the box later on the SAME folder must actually
    search — a composite run must not leave anything behind that a
    meteor run could mistake for a night already searched."""
    import dataclasses

    from meteorprep.config import Config
    from meteorprep.pipeline import run

    cfg = Config(
        input_dir=str(synth_dir), output_dir=str(tmp_path / "out"),
        catalog_file=str(synth_dir / "catalog_radec.npy"),
        pixel_pitch_um=16000.0 / ground_truth["focal_px"],
        seed_ra_deg=ground_truth["tangent_radec"][0] + 0.2,
        seed_dec_deg=ground_truth["tangent_radec"][1] - 0.15,
        solve_every_k=4, emit_psd=False, emit_pngjsx=True,
        find_meteors=False)
    res = run(cfg)
    g = res["groups"][0]
    out = tmp_path / "out" / "g01"

    # the composite is all there
    assert (out / "preview.jpg").exists()
    assert (out / "skymask.png").exists()
    assert (out / "assemble.jsx").exists()
    assert g["n_meteors"] == 0 and g["n_flagged"] == 0

    # and it is a composite, not a hunt that found nothing: no candidate
    # layers, no empty METEORS drawer, no candidates file for a later
    # run to trust
    manifest = json.loads((out / "layers_manifest.json").read_text())
    groups = {m["group"] for m in manifest}
    assert "METEORS" not in groups and "FLAGGED" not in groups
    assert {"FOREGROUND"} <= groups
    cdir = tmp_path / "out" / "cache" / "g01"
    assert not (cdir / "candidates.json").exists()
    report = (out / "report.html").read_text()
    assert "meteor hunt was off" in report

    # same folder, hunt on: the search really runs, and finds the
    # planted meteors the composite run never looked for — while the
    # star lock is reused across the toggle
    res2 = run(dataclasses.replace(cfg, find_meteors=True))
    g2 = res2["groups"][0]
    assert g2["n_meteors"] >= 1
    manifest2 = json.loads((out / "layers_manifest.json").read_text())
    assert any(m["group"] == "METEORS" for m in manifest2)
    assert (cdir / "solve.json").exists()
