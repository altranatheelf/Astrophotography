"""Unit tests: config hashing, cache, folder segmentation, light-paint,
radiant geometry, boundary merge, PNG+JSX writer."""

from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from meteorprep.cache.store import CacheStore
from meteorprep.config import SIDEREAL_DEG_PER_SEC, Config


def test_sidereal_constant():
    assert SIDEREAL_DEG_PER_SEC * 86164.0905 == 360.0


def test_stage_hash_isolation():
    """Changing the Hough threshold re-runs detection but not the solve."""
    a, b = Config(), Config(hough_threshold=11)
    assert a.stage_hash("solve") == b.stage_hash("solve")
    assert a.stage_hash("reproject") == b.stage_hash("reproject")
    assert a.stage_hash("detect") != b.stage_hash("detect")
    assert a.stage_hash("classify") != b.stage_hash("classify")   # downstream
    assert a.stage_hash("assemble") != b.stage_hash("assemble")   # downstream
    c = Config(sip_order=4)
    assert a.stage_hash("solve") != c.stage_hash("solve")
    assert a.stage_hash("detect") != c.stage_hash("detect")       # via reproject


def test_cache_store(tmp_path):
    cs = CacheStore(tmp_path / "cache")
    assert not cs.is_done("detect", "sha256:x")
    cs.mark_done("detect", "sha256:x")
    assert cs.is_done("detect", "sha256:x")
    assert not cs.is_done("detect", "sha256:y")  # changed params re-run
    cs.invalidate("detect")
    assert not cs.is_done("detect", "sha256:x")


def test_scan_input_dir_recursive_case_insensitive(tmp_path):
    """§2.5: recursive traversal, case-insensitive extensions."""
    from meteorprep.ingest.exif import scan_input_dir
    (tmp_path / "sub").mkdir()
    for name in ["a.CR2", "b.cr2", "sub/c.TIF", "d.txt", "sub/e.NEF"]:
        (tmp_path / name).write_bytes(b"x")
    found = scan_input_dir(tmp_path, (".cr2", ".tif", ".nef"))
    assert {p.name for p in found} == {"a.CR2", "b.cr2", "c.TIF", "e.NEF"}


def test_segment_folder_splits_on_gap_and_lens():
    from meteorprep.ingest.exif import FrameMeta
    from meteorprep.ingest.segment_folder import segment_folder

    t0 = datetime(2026, 8, 13, 2, 0, 0, tzinfo=timezone.utc)

    def fm(i, offset_s, lens="L1", focal=16.0):
        return FrameMeta(path=Path(f"f{i}.cr2"), file=f"f{i}.cr2",
                         datetime_original=t0 + timedelta(seconds=offset_s),
                         exposure_s=20.0, focal_mm=focal, lens_model=lens)

    metas = ([fm(i, i * 22) for i in range(10)]
             + [fm(i + 10, 4000 + i * 22) for i in range(5)]        # time gap
             + [fm(i + 15, 4200 + i * 22, lens="L2") for i in range(3)])
    groups = segment_folder(metas)
    assert [len(g.frames) for g in groups] == [10, 5, 3]
    assert groups[0].frames[0].group_id == "g01"


def test_lightpaint_flags_spike_not_noise():
    from meteorprep.ingest.lightpaint import flag_lightpainted
    rng = np.random.default_rng(0)
    med = 1000 + rng.normal(0, 1, 30)
    med[12] = 2500  # a Lume Cube panel fires
    med[20] = 1004  # noise wiggle must NOT flag
    flags = flag_lightpainted(med)
    assert flags[12]
    assert not flags[20]
    assert flags.sum() == 1


def test_radiant_miss_geometry():
    from meteorprep.detect.radiant import radiant_miss_deg
    radiant = (48.0, 58.0)
    # streak pointing straight away from the radiant: tiny miss
    assert radiant_miss_deg((50.0, 57.0), (53.0, 55.5), radiant) < 1.0
    # streak perpendicular to the radiant direction: large miss
    assert radiant_miss_deg((60.0, 58.0), (60.0, 62.0), radiant) > 5.0


def test_radiant_daily_motion():
    import pytest
    from meteorprep.detect.radiant import radiant_at_epoch
    cfg = Config()
    t = datetime.fromisoformat(cfg.radiant_epoch).replace(tzinfo=timezone.utc)
    ra0, dec0 = radiant_at_epoch(cfg, t)
    ra2, dec2 = radiant_at_epoch(cfg, t + timedelta(days=2))
    assert ra2 - ra0 == pytest.approx(2 * 1.40, abs=1e-6)
    assert dec2 - dec0 == pytest.approx(2 * 0.20, abs=1e-6)


def test_boundary_spanning_merge():
    """§3.8: two collinear, abutting single-frame streaks in adjacent
    frames merge into one meteor flagged spans_boundary."""
    from meteorprep.detect.classify import classify
    from meteorprep.detect.hough import Streak
    from meteorprep.detect.track import Candidate

    def streak(fi):
        return Streak(frame_index=fi, x0=0, y0=0, x1=10, y1=10,
                      length_px=100, mean_intensity=5000, peak_intensity=20000,
                      fwhm_px=6.0, aspect=10.0, area_px=400, score=50.0,
                      straightness_rms=0.5, head_tail_ratio=3.0)

    a = Candidate(id="A", streaks=[streak(3)], frames=["f3"],
                  endpoints_world=[[[50.0, 57.0], [51.0, 56.5]]],
                  persistence=1, dash_pattern=[0.0])
    b = Candidate(id="B", streaks=[streak(4)], frames=["f4"],
                  endpoints_world=[[[51.05, 56.47], [52.0, 56.0]]],
                  persistence=1, dash_pattern=[0.0])
    out = classify([a, b], Config(), (48.0, 58.0))
    assert len(out) == 1
    assert out[0].spans_boundary
    assert out[0].label == "meteor"
    assert out[0].flags.get("boundary")


def test_pngjsx_writer(tmp_path):
    from meteorprep.assemble.layers import Layer, LayerGroup, LayerStack
    from meteorprep.assemble.pngjsx import write_pngjsx

    base = Layer("BASE_SKY", rgb=np.full((40, 60, 3), 20000, np.float32))
    met = Layer("M001_f.tif_2026-08-13T02:00:00Z_+1.000deg_c0.90_perseid",
                rgb=np.full((5, 8, 3), 60000, np.float32),
                alpha=np.ones((5, 8), np.float32), bbox=(10, 20, 18, 25),
                blend="lighten")
    stack = LayerStack(width=60, height=40, base=base,
                       groups=[LayerGroup("METEORS", [met])])
    jsx = write_pngjsx(stack, tmp_path)
    assert jsx.exists()
    text = jsx.read_text()
    assert "BlendMode.LIGHTEN" in text
    assert "METEORS" in text
    assert "layer.translate" in text   # bbox layers are moved into place
    pngs = list((tmp_path / "layers").glob("*.png"))
    assert len(pngs) == 2
    from PIL import Image
    base_png = Image.open([p for p in pngs if "BASE_SKY" in p.name][0])
    assert base_png.size == (60, 40)
    met_png = Image.open([p for p in pngs if "M001" in p.name][0])
    assert met_png.mode == "RGBA"
    assert met_png.size == (8, 5)      # bbox-sized, not full canvas
    import json as _json
    manifest = _json.loads((tmp_path / "layers_manifest.json").read_text())
    m = [r for r in manifest if "M001" in r["name"]][0]
    assert (m["x"], m["y"]) == (10, 20)


def test_gnomonic_streak_is_great_circle(base_wcs, ground_truth):
    """A straight line in the TAN plane through the projected radiant is a
    great circle through the radiant — the synth injection premise."""
    from meteorprep.detect.radiant import radiant_miss_deg
    for m in ground_truth["meteors"]:
        miss = radiant_miss_deg(tuple(m["head_world"]), tuple(m["tail_world"]),
                                tuple(ground_truth["radiant_radec"]))
        assert miss < 0.5


def test_pixel_pitch_from_exif():
    """Sensor pitch: FocalPlaneXResolution primary, 35mm-ratio fallback,
    implausible values distrusted (-> 0 = 'the file doesn't say')."""
    from meteorprep.ingest.exif import _pixel_pitch_um
    # Canon style: pixels per inch (unit 2)
    p = _pixel_pitch_um({"FocalPlaneXResolution": 5728.18,
                         "FocalPlaneResolutionUnit": 2})
    assert abs(p - 4.434) < 0.01
    # pixels per cm (unit 3)
    p = _pixel_pitch_um({"FocalPlaneXResolution": 2255.0,
                         "FocalPlaneResolutionUnit": 3})
    assert abs(p - 4.434) < 0.01
    # fallback: crop factor from the 35mm-equivalent focal length
    p = _pixel_pitch_um({"FocalLength": 18.0,
                         "FocalLengthIn35mmFormat": 29.0,
                         "ImageWidth": 6000})
    assert abs(p - 3.724) < 0.01
    # nothing usable
    assert _pixel_pitch_um({}) == 0.0
    assert _pixel_pitch_um({"FocalPlaneXResolution": "junk"}) == 0.0
    # implausible (would mean a 100um pitch): distrusted
    assert _pixel_pitch_um({"FocalPlaneXResolution": 254.0,
                            "FocalPlaneResolutionUnit": 2}) == 0.0
