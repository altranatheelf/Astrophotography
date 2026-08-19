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


def test_ground_mask_covers_long_session_sweep():
    """Over a multi-hour session the aligned ground sweeps a wide arc; a
    whole-night deviation-frequency mask misses it (each spot is 'tree' in
    too few frames) — a real night produced hundreds of leaf 'aircraft'.
    The windowed union must cover the full swept band without eating sky,
    and must not mask the transient meteor."""
    import cv2  # noqa: F401  (dependency of the segmenter)
    from meteorprep.segment.sky_ground import ground_from_alignment
    rng = np.random.default_rng(7)
    H, W, N = 400, 600, 60
    frames, foots = [], []
    for t in range(N):
        a = rng.normal(500, 25, (H, W)).astype(np.float32)
        x_off = 4 * t
        yy, xx = np.mgrid[0:H, 0:W]
        tree = (yy > 300 + 12 * np.sin((xx - x_off) / 25.0)) & (yy < 400)
        a[tree] *= 0.2
        rim = tree & (yy < 305 + 12 * np.sin((xx - x_off) / 25.0) + 8)
        a[rim] += rng.normal(900, 300, (H, W))[rim].clip(0)
        if t == 30:
            for k in range(120):
                a[60 + k // 3, 200 + k] += 6000
        # dawn twilight: fast, spatially smooth brightening near the end —
        # must NOT read as ground (it once walled off a column of sky)
        if t > 45:
            ramp = (t - 45) * 120.0
            a += ramp * np.exp(-((xx - 450) ** 2 + (yy - 200) ** 2) / (2 * 120.0 ** 2))
        # slow aircraft: nearly-collinear bright trail in 5 consecutive
        # frames of one window — may mark its own line, must not fill below
        if 12 <= t < 17:
            for k in range(150):
                a[100 + k // 5, 150 + k + 8 * (t - 12)] += 5000
        frames.append(np.clip(a, 0, 65535).astype(np.uint16))
        foots.append(np.ones((H, W), np.uint8))
    m = ground_from_alignment(lambda i: frames[i], lambda i: foots[i], N)
    assert m is not None
    ground = m < 0.5
    assert ground[315:, :].mean() > 0.9          # swept trees covered
    assert ground[:250, :].mean() < 0.02         # sky, meteor, twilight kept
    # the twilight patch region specifically must stay sky
    assert ground[120:250, 350:550].mean() < 0.05


def test_fill_norm_coef_interpolates_skipped_frames():
    """Pass-1 statistics may sample every 2nd frame; the skipped frames'
    sky-surface coefficients must be linearly interpolated between fitted
    temporal neighbours and constant-extended at the ends."""
    from meteorprep.pipeline import _fill_norm_coef
    ok_idx = list(range(9))
    fitted = {0: np.full((3, 6), 10.0).tolist(),
              2: np.full((3, 6), 20.0).tolist(),
              4: np.full((3, 6), 40.0).tolist(),
              6: np.full((3, 6), 30.0).tolist()}
    out = _fill_norm_coef(dict(fitted), ok_idx)
    assert set(out) == set(ok_idx)
    for k, v in fitted.items():                  # fitted frames untouched
        assert np.allclose(out[k], v)
    assert np.allclose(out[1], 15.0)             # midpoint 0..2
    assert np.allclose(out[3], 30.0)             # midpoint 2..4
    assert np.allclose(out[5], 35.0)             # midpoint 4..6
    assert np.allclose(out[7], 30.0)             # constant-extended tail
    assert np.allclose(out[8], 30.0)
    # complete dict passes through unchanged
    full = {i: np.zeros((3, 6)).tolist() for i in ok_idx}
    assert _fill_norm_coef(dict(full), ok_idx) == full
    # empty dict (fit failed everywhere) stays empty
    assert _fill_norm_coef({}, ok_idx) == {}


def test_disk_full_detection():
    """ENOSPC must be recognised from errno, from numpy's errno-less
    'requested and written' OSError, and through an exception chain —
    and must not fire on unrelated failures."""
    import errno
    from meteorprep.pipeline import _disk_full
    assert _disk_full(OSError(errno.ENOSPC, "No space left on device"))
    assert _disk_full(OSError("5042580 requested and 0 written"))
    wrapper = RuntimeError("worker died")
    wrapper.__cause__ = OSError("12345 requested and 100 written")
    assert _disk_full(wrapper)
    assert not _disk_full(ValueError("boom"))
    assert not _disk_full(OSError(errno.EPIPE, "broken pipe"))


def test_targeted_bad_pixel_repair_matches_full_blur():
    """The targeted 3x3-gather repair must reproduce rawpy's full
    median-blur repair exactly, including clustered bad pixels and
    sensor edges/corners."""
    import numpy as np
    import cv2
    from meteorprep.ingest.raw import _repair_bad_pixels_fast

    rng = np.random.default_rng(3)
    H, W = 64, 80
    img = rng.integers(0, 60000, (H, W), dtype=np.uint16)

    class FakeRaw:
        raw_pattern = np.zeros((2, 2), np.uint8)
        raw_image_visible = img

    coords = np.array([[0, 0], [0, W - 1], [H - 1, 0], [H - 1, W - 1],
                       [10, 10], [10, 12], [12, 10],      # cluster, one color
                       [33, 47], [2, 5], [63, 40]])
    # reference: rawpy's approach — 3x3 median blur per color slice,
    # then scatter at the flagged coords
    ref = img.copy()
    for oy in (0, 1):
        for ox in (0, 1):
            sl = np.require(img[oy::2, ox::2], img.dtype, "C")
            sm = cv2.medianBlur(sl, 3)
            m = (coords[:, 0] % 2 == oy) & (coords[:, 1] % 2 == ox)
            cs = coords[m]
            ref[cs[:, 0], cs[:, 1]] = sm[cs[:, 0] // 2, cs[:, 1] // 2]

    _repair_bad_pixels_fast(FakeRaw(), coords)
    assert np.array_equal(FakeRaw.raw_image_visible, ref)


def test_preview_downscaled_bbox_blend_and_all_trails(tmp_path):
    """Large canvases are downsized before the stretch, so bbox layers
    must land at SCALED coordinates — and the all-trails render must add
    flagged trails that the meteors-only render omits."""
    import cv2
    from meteorprep.assemble.layers import Layer
    from meteorprep.report.preview import render_preview

    H, W = 1400, 2000
    base = np.full((H, W, 3), 500.0, np.float32)
    m = Layer(name="m", rgb=np.full((40, 200, 3), 20000.0, np.float32),
              alpha=np.ones((40, 200), np.float32),
              bbox=(1200, 600, 1400, 640), blend="lighten", visible=True)
    f = Layer(name="f", rgb=np.full((40, 400, 3), 15000.0, np.float32),
              alpha=np.ones((40, 400), np.float32),
              bbox=(300, 900, 700, 940), blend="lighten", visible=True)
    out = render_preview(base, None, None, None, [0.9, 1.0, 1.1],
                         [(None, m, 0, 0)], tmp_path / "p.jpg",
                         max_width=1000,
                         flagged_layers=[(None, f, 0, 0)],
                         all_trails_path=tmp_path / "a.jpg")
    assert out and out["preview"].exists() and out["all_trails"].exists()
    p = cv2.imread(str(tmp_path / "p.jpg")).mean(axis=2)
    a = cv2.imread(str(tmp_path / "a.jpg")).mean(axis=2)
    assert p.shape[1] == 1000                      # downsized canvas
    bg = float(np.median(p))
    # meteor at scaled (x=650, y=310) in both renders
    assert p[305:315, 640:660].mean() > bg + 40
    assert a[305:315, 640:660].mean() > bg + 40
    # flagged trail at scaled (x=250, y=460): only in the all-trails look
    assert a[455:465, 200:300].mean() > bg + 40
    assert p[455:465, 200:300].mean() < bg + 10

    # seam crop: bboxes are uncropped-canvas coords, so with a crop
    # origin of (100, 60) the meteor must shift by exactly that much
    out_c = render_preview(base[60:, 100:], None, None, None, None,
                           [(None, m, 0, 0)], tmp_path / "pc.jpg",
                           max_width=950, crop_xy=(100, 60))
    pc = cv2.imread(str(tmp_path / "pc.jpg")).mean(axis=2)
    sc2 = 950 / (2000 - 100)
    # meteor midpoint (1300, 620) uncropped -> (1200, 560) cropped
    yy, xx = int(560 * sc2), int(1200 * sc2)
    assert pc[yy - 5:yy + 5, xx - 10:xx + 10].mean() > \
        float(np.median(pc)) + 40


def test_faint_harvest_recovers_radiant_aligned_only():
    """Phase-3 gates: a faint radiant-aligned streak IS recovered from
    the clean-base diff; the same streak pointing away from the radiant
    is rejected; corridors of known candidates are not re-found; pure
    noise frames yield zero false meteors."""
    import cv2
    from meteorprep.config import Config
    from meteorprep.detect.harvest import harvest_faint_meteors

    rng = np.random.default_rng(11)
    H, W, N = 600, 800, 6
    sc = 0.05                                   # deg per pixel (fake TAN)
    base = np.full((H, W), 500.0, np.float32)
    noise = 300.0                               # realistic 16-bit sky noise
    frames = [base + rng.normal(0, noise, (H, W)).astype(np.float32)
              for _ in range(N)]

    def draw(img, p0, p1, amp):
        s = np.zeros((H, W), np.float32)
        cv2.line(s, p0, p1, float(amp), thickness=2)
        img += cv2.GaussianBlur(s, (5, 5), 1.2)

    # peak ~0.7*amp after the blur: between the mad_k=6 harvest threshold
    # (~1270 ADU) and round one's mad_k=10 (~1980 ADU) — genuinely faint
    amp = 1900.0
    draw(frames[2], (200, 150), (320, 240), amp)   # collinear with (0,0)
    draw(frames[3], (500, 100), (500, 260), amp)   # perpendicular ray
    draw(frames[4], (100, 400), (250, 400), amp)   # inside a KNOWN corridor
    def world_endpoints(fi, s):
        return ((s.x0 * sc, s.y0 * sc), (s.x1 * sc, s.y1 * sc))

    cfg = Config(input_dir=".", output_dir=".")
    # round one (mad_k=10) must NOT see it — that's what makes it faint
    from meteorprep.detect.hough import detect_streaks
    d2 = np.clip(frames[2] - base, 0, None)
    assert detect_streaks(d2, 2, cfg, bin_factor=1, mad_k=10.0) == []

    # drifting sky: the streak frame is 1500 ADU brighter than the base
    # (moonrise/twilight) and frame 5 is 3000 ADU of pure brighter sky —
    # the harvest must still find the streak and must find NOTHING in 5
    frames[2] += 1500.0
    frames[5] += 3000.0
    out = harvest_faint_meteors(
        lambda i: frames[i], lambda i: np.ones((H, W), np.uint8),
        base, N, exclude=set(), sky_bin=None,
        known_segments=[(100, 400, 250, 400, 12.0)], cfg=cfg, S=1,
        world_endpoints=world_endpoints, radiant=(0.0, 0.0),
        files=[f"F{i}.tif" for i in range(N)], mad_k=6.0)
    assert len(out) == 1, [(c.frames, c.label) for c in out]
    c = out[0]
    assert c.frames == ["F2.tif"] and c.flags.get("faint_harvest")
    assert c.label == "meteor"

    # meteor-free night: all noise -> nothing at all
    quiet = [base + rng.normal(0, noise, (H, W)).astype(np.float32)
             for _ in range(N)]
    out2 = harvest_faint_meteors(
        lambda i: quiet[i], lambda i: np.ones((H, W), np.uint8),
        base, N, exclude=set(), sky_bin=None, known_segments=[],
        cfg=cfg, S=1, world_endpoints=world_endpoints,
        radiant=(0.0, 0.0), files=[f"F{i}.tif" for i in range(N)],
        mad_k=6.0)
    assert out2 == []


def test_foreground_mask_from_frozen_stack():
    """The foreground alpha is a MATTE segmented in CAMERA space on the
    frozen stack: trees are dark, the sky is a smooth wash with vignetting
    and a twilight gradient.  It must follow the treeline across the whole
    frame despite that gradient, make a solid canopy opaque while leaving
    a semi-transparent fringe, refuse to climb into the top of the frame,
    and the level match must remove the brightness step."""
    from meteorprep.segment.silhouette import (foreground_sky_mask,
                                               match_sky_level)

    h, w = 480, 800
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # sky: bright bottom-right glow, dark upper-left (the case a single
    # global threshold gets wrong)
    sky_lvl = 300 + 500 * (xx / w) + 400 * (yy / h)
    img = sky_lvl.copy()
    tree_top = 330 + (30 * np.sin(xx[0] / 60.0)).astype(int)
    for x in range(w):
        img[tree_top[x]:, x] = 60                      # dark canopy
    frozen = np.dstack([img] * 3)
    sky = foreground_sky_mask(frozen)
    assert sky is not None
    got = (sky < 0.5).argmax(axis=0)
    # the found horizon tracks the real treeline on BOTH sides (the
    # failure this replaces put it at the top of the frame on one side)
    for x in (40, 400, 760):
        assert abs(int(got[x]) - int(tree_top[x])) < 0.14 * h, (x, got[x])
    # and follows its shape, not just its average height
    assert np.corrcoef(got[20:-20].astype(float),
                       tree_top[20:-20].astype(float))[0, 1] > 0.8
    assert sky[:100, :].min() > 0.9                     # top stays sky
    assert sky[430:, :].max() < 0.1                     # canopy opaque

    # a half-shaded canopy edge is PARTLY transparent, not binary
    edge = np.dstack([np.where(np.arange(w)[None, :] < 0, 0, 0)] * 3)
    dim = img.copy()
    dim[tree_top.max() + 20:, :] = 60
    dim[300:tree_top.max() + 20, :] = 0.62 * sky_lvl[300:tree_top.max() + 20, :]
    part = foreground_sky_mask(np.dstack([dim] * 3))
    assert part is not None
    mid = 1.0 - part[310:tree_top.max() + 10, :]
    assert 0.15 < float(mid.mean()) < 0.85, float(mid.mean())

    # an all-sky frame yields no foreground at all
    assert foreground_sky_mask(np.dstack([sky_lvl] * 3)) is None

    base = np.full((h, w, 3), 800.0, np.float32)
    fg = np.full((h, w, 3), 2600.0, np.float32)
    matched = match_sky_level(fg, base, sky)
    assert abs(float(np.median(matched)) - 800.0) < 5.0


def test_foreground_matte_hard_cases():
    """Cases an earlier matte got wrong, each verified numerically:
    a tall object filling most of its own columns must not erase itself
    from the matte; an object reaching high in the frame must not be
    sliced along a horizontal line; and a bright (moonlit) foreground
    must still come out solid, not half-transparent."""
    from meteorprep.segment.silhouette import foreground_sky_mask

    h, w = 800, 1200
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    sky = 300 + 500 * (xx / w) + 300 * (yy / h)      # vignette + glow

    img = sky.copy()
    img[560:, :] = 60
    img[80:, 300:440] = 60                            # tall, wide tree
    a = 1.0 - foreground_sky_mask(np.dstack([img] * 3))
    assert a[300:500, 320:420].mean() > 0.85          # not erased
    assert a[:60, 600:1100].max() < 0.1               # sky still clear

    img2 = sky.copy()
    img2[560:, :] = 60
    img2[40:, 900:930] = 60                           # thin mast to row 40
    a2 = 1.0 - foreground_sky_mask(np.dstack([img2] * 3))
    assert a2[60, 900:930].mean() > 0.8               # top not sliced off

    img3 = sky.copy()
    img3[560:, :] = 0.45 * sky[560:, :]               # bright moonlit ridge
    a3 = 1.0 - foreground_sky_mask(np.dstack([img3] * 3))
    assert a3[650:780, 200:1000].mean() > 0.9         # solid, not 0.79


def test_candidate_cache_roundtrip(tmp_path):
    """A re-run must resume from the saved detection instead of repeating
    the search, so candidates have to survive a JSON round-trip intact —
    including their streak geometry and flags."""
    from meteorprep.cache.store import CacheStore
    from meteorprep.detect.hough import Streak
    from meteorprep.detect.track import Candidate
    from meteorprep.pipeline import _load_candidates, _save_candidates

    st = Streak(frame_index=7, x0=10.5, y0=20.5, x1=110.5, y1=90.5,
                length_px=134.0, mean_intensity=np.float32(5000.0),
                peak_intensity=20000.0, fwhm_px=4.5, aspect=12.0,
                area_px=np.int64(400), score=51.0, straightness_rms=0.4,
                head_tail_ratio=2.1)
    c = Candidate(id="C007", streaks=[st], frames=["IMG_1.CR2"],
                  endpoints_world=[[[50.0, 57.0], [51.0, 56.5]]],
                  persistence=1, dash_pattern=[0.0])
    c.label = "meteor"
    c.confidence = 0.83
    c.flags = {"faint_harvest": True, "likely_perseid": True}
    c.radiant_miss_deg = 2.5

    cache = CacheStore(tmp_path / "cache")
    _save_candidates(cache, [c])
    got = _load_candidates(cache)
    assert len(got) == 1
    g = got[0]
    assert g.id == "C007" and g.label == "meteor"
    assert g.flags.get("faint_harvest") and g.flags.get("likely_perseid")
    assert abs(g.confidence - 0.83) < 1e-6
    assert abs(g.radiant_miss_deg - 2.5) < 1e-6
    assert g.frames == ["IMG_1.CR2"]
    assert len(g.streaks) == 1
    s = g.streaks[0]
    assert (s.x0, s.y0, s.x1, s.y1) == (10.5, 20.5, 110.5, 90.5)
    assert s.frame_index == 7 and abs(s.fwhm_px - 4.5) < 1e-6


def test_meteor_layer_has_no_hard_edges():
    """A streak's halo must fade out inside its own box: the layer has to
    reach zero at every border, or the composite shows the rectangle —
    straight edges and corners over the haze, which is exactly what a
    too-small box with a hard corridor produced."""
    import cv2
    from meteorprep.mask.extract import extract_meteor

    rng = np.random.default_rng(5)
    h, w = 700, 900
    sky = 800.0
    base = np.full((h, w, 3), sky, np.float32)
    # a streak with a broad glow, like a real bright meteor
    core = np.zeros((h, w), np.float32)
    cv2.line(core, (250, 300), (650, 420), 1.0, thickness=3)
    glow = cv2.GaussianBlur(core, (0, 0), 18.0) * 9000.0     # wide haze
    sharp = cv2.GaussianBlur(core, (0, 0), 1.6) * 45000.0    # bright core
    streak = glow + sharp
    frame = base + streak[:, :, None] + rng.normal(0, 40, (h, w, 3)).astype(np.float32)
    diff = streak + rng.normal(0, 40, (h, w)).astype(np.float32)

    layer = extract_meteor(diff, frame, ((250, 300), (650, 420)), 4.0,
                           base_rgb=base)
    assert layer is not None
    a = layer.alpha
    x0, y0, x1, y1 = layer.bbox

    # 1) the box is far bigger than the old 6xFWHM=24 px pad
    assert (x1 - x0) > (650 - 250) + 120, (x1 - x0)

    # 2) alpha is zero on every border -> no edge can show
    for edge in (a[0, :], a[-1, :], a[:, 0], a[:, -1]):
        assert float(edge.max()) < 0.01, float(edge.max())

    # 3) the halo is KEPT, not clipped: well off-axis but inside the box
    #    there is still real signal carried by the layer
    assert float(a[a > 0.05].size) > float((a > 0.9).sum()) * 2

    # 4) the layer holds the streak's own light, not the sky, so screening
    #    it where there is no streak changes nothing
    corner = layer.rgb[:20, :20]
    assert float(np.median(corner)) < 0.15 * sky


def test_meteor_layer_border_stays_zero_with_stars_on_the_rim():
    """Star holes are inpainted so the streak stays continuous where a
    star sat on it.  That inpaint used to run AFTER the border was pinned
    to zero, so a star near the box rim wrote alpha back onto the border
    row (3/255, measured on a real layer) — a faint straight edge in the
    composite.  The pin has to be the last thing that touches alpha."""
    import cv2
    from meteorprep.mask.extract import extract_meteor

    rng = np.random.default_rng(11)
    h, w = 700, 900
    base = np.full((h, w, 3), 800.0, np.float32)
    core = np.zeros((h, w), np.float32)
    cv2.line(core, (250, 300), (650, 420), 1.0, thickness=3)
    streak = (cv2.GaussianBlur(core, (0, 0), 18.0) * 9000.0
              + cv2.GaussianBlur(core, (0, 0), 1.6) * 45000.0)
    frame = base + streak[:, :, None] + rng.normal(0, 40, (h, w, 3)).astype(np.float32)
    diff = streak + rng.normal(0, 40, (h, w)).astype(np.float32)

    probe = extract_meteor(diff, frame, ((250, 300), (650, 420)), 4.0,
                           base_rgb=base)
    assert probe is not None
    x0, y0, x1, y1 = probe.bbox
    a0 = probe.alpha
    # a star on the rim only writes alpha back onto the border when the
    # pixels around the hole still carry haze — put the holes where the
    # near-border signal is strongest, which is what a real frame does
    stars = np.array([
        [x0 + int(a0[6, :].argmax()), y0],
        [x0 + int(a0[-7, :].argmax()), y1 - 1],
        [x0, y0 + int(a0[:, 6].argmax())],
        [x1 - 1, y0 + int(a0[:, -7].argmax())],
    ], float)
    layer = extract_meteor(diff, frame, ((250, 300), (650, 420)), 4.0,
                           star_xy=stars, star_fwhm=6.0, base_rgb=base)
    assert layer is not None
    a = layer.alpha
    for edge in (a[0, :], a[-1, :], a[:, 0], a[:, -1]):
        assert float(edge.max()) == 0.0, float(edge.max())
