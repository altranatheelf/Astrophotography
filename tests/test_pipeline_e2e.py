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
    assert "BlendMode.LIGHTEN" in jsx
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
    """§9.4 PSD round-trip — runs only when pytoshop is available."""
    import pytest
    pytest.importorskip("pytoshop")
    from psd_tools import PSDImage

    psd_path = Path(synth_config.output_dir) / "g01" / "meteorprep.psd"
    assert psd_path.exists()
    psd = PSDImage.open(psd_path)
    names = {l.name for l in psd}
    assert "BASE_SKY" in names
    assert {"FOREGROUND", "METEORS", "FLAGGED"} <= names
