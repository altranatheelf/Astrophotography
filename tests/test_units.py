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
    out = render_preview(base, None, None, [0.9, 1.0, 1.1],
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
    out_c = render_preview(base[60:, 100:], None, None, None,
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


def test_altaz_matches_a_known_geometry():
    """Polaris sits at (very nearly) the observer's latitude, due north,
    at every hour of every night — the cheapest possible check that the
    sidereal-time and precession maths is not subtly wrong."""
    from datetime import datetime, timezone

    from meteorprep.detect.physics import altaz_from_radec

    for hour in (2, 8, 14, 20):
        alt, az = altaz_from_radec(37.9529, 89.2641, 44.3275, -72.1725,
                                   datetime(2026, 8, 16, hour,
                                            tzinfo=timezone.utc))
        assert abs(alt - 44.3275) < 1.0, (hour, alt)
        assert min(az, 360 - az) < 2.0, (hour, az)


def test_slant_range_stays_physical_near_the_horizon():
    """h / sin(alt) runs away to thousands of km at low elevation, which
    is exactly where meteors are most often photographed.  The spherical
    form has to stay bounded and monotone."""
    from meteorprep.detect.physics import slant_range_km

    assert abs(slant_range_km(90, 95) - 95) < 0.5
    r20, r5, r0 = (slant_range_km(a, 95) for a in (20, 5, 0))
    assert r20 < r5 < r0 < 1200
    assert slant_range_km(20, 95) > slant_range_km(45, 95)


def test_physics_refuses_impossible_meteor_geometry():
    """A satellite crosses far more slowly than a meteor at meteor speed
    and height.  When the assumed geometry would need the streak to last
    longer than the frame it appeared in, the annotation must say so
    instead of printing a confident wrong duration."""
    from datetime import datetime, timezone
    from types import SimpleNamespace

    from meteorprep.detect.physics import annotate

    when = datetime(2026, 8, 16, 5, 0, tzinfo=timezone.utc)
    # a short streak high overhead: fine for a 20 s frame
    fast = SimpleNamespace(endpoints_world=[((90.0, 60.0), (91.0, 60.5))],
                           length_deg=0.8)
    ok = annotate(fast, 44.3275, -72.1725, when, 20.0)
    assert ok["geometry_consistent"] is True
    assert 0.0 < ok["est_duration_s"] <= 20.0
    assert ok["est_range_km"] >= 95
    # a satellite: correctly identified upstream, so the shower numbers
    # must NOT be applied to it — direction only
    sat = annotate(fast, 44.3275, -72.1725, when, 20.0,
                   meteor_assumptions=False)
    assert "est_duration_s" not in sat
    assert sat["elevation_deg"] == ok["elevation_deg"]
    assert "not a meteor" in sat["note"]
    # a trail so long and so low that the assumed speed would need more
    # time than the frame lasted: impossible, and it has to say so
    huge = SimpleNamespace(
        endpoints_world=[((90.0, 60.0), (91.0, 60.5))], length_deg=140.0)
    bad = annotate(huge, 44.3275, -72.1725, when, 2.0)
    assert bad["geometry_consistent"] is False
    assert "exposure" in bad["note"]


def test_evidence_ledger_classifies_by_the_weakest_claim():
    from meteorprep.report.evidence import evidence_ledger, ledger_rgb

    cov = np.full((40, 40), 100, np.uint16)
    cov[:5, :] = 0                      # outside every footprint
    cov[5:10, :] = 10                   # thin rim
    rej = np.zeros((40, 40), np.uint16)
    rej[20:24, 20:24] = 60              # a meteor was clipped out here
    rej[6, 6] = 6                       # rejection inside the thin rim
    rej[30, 30] = 3                     # noise-tail trimming: not a class
    sky = np.ones((40, 40), np.float32)
    sky[35:, :] = 0.0                   # treeline

    led, legend = evidence_ledger(cov, rej, sky)
    assert led[0, 0] == 0               # no data wins over everything
    assert led[7, 7] == 3               # thin coverage beats rejection
    assert led[22, 22] == 2             # outliers removed
    assert led[38, 5] == 4              # ground
    assert led[15, 15] == 1             # measured, full depth
    assert led[30, 30] == 1             # a few clipped samples is normal
    pct = {v["id"]: v["percent"] for v in legend}
    assert abs(sum(pct.values()) - 100.0) < 1e-6
    assert ledger_rgb(led).shape == (40, 40, 3)


def test_capsule_text_carries_the_honesty_claims():
    from meteorprep.report.capsule import as_text, build

    sidecar = {"tool_version": "9.9.9", "params_hash": "sha256:abc",
               "frames": [{"epoch_mid": "2026-08-16T04:55:54+00:00"}],
               "alignment": {"solver": "blind"},
               "color_calibration": {"gains": [1, 1, 1]},
               "candidates": [
                   {"label": "meteor", "physics": {"geometry_consistent": True,
                                                   "est_duration_s": 0.4}},
                   {"label": "meteor", "physics": {}},
                   {"label": "satellite", "physics": {}}]}
    cap = build({}, {"integration": "75 min of exposure",
                     "photos stacked": "226 of 226",
                     "star-lock accuracy": "0.9 px RMS"}, sidecar)
    assert cap["meteors_true_position"] == 2
    assert cap["other_trails_flagged"] == 1
    assert cap["physics_annotated"] == 1
    assert cap["generated_pixels"] == "none"
    txt = as_text(cap)
    assert "75 min of exposure" in txt
    assert "sha256:abc" in txt
    assert "Nothing was painted in" in txt


def test_gps_parsing_and_site_resolution():
    """Height and distance hang off the observing site.  A default from
    the config file is fine as a solver seed and completely wrong as a
    place to say a meteor burned over — so the site is only 'known' when
    the camera recorded it or a person typed it."""
    from types import SimpleNamespace

    from meteorprep.config import Config
    from meteorprep.ingest.exif import _gps_deg
    from meteorprep.pipeline import _observing_site

    assert _gps_deg(None) is None and _gps_deg("") is None
    assert abs(_gps_deg(-72.1725) + 72.1725) < 1e-9
    assert abs(_gps_deg("44 deg 19' 39.00\" N") - 44.3275) < 1e-3
    assert abs(_gps_deg("72 deg 10' 21.00\" W") + 72.1725) < 1e-3

    no_gps = [SimpleNamespace(gps_lat=None, gps_lon=None) for _ in range(3)]
    lat, lon, src = _observing_site(Config(input_dir="."), no_gps)
    assert (lat, lon, src) == (None, None, None)

    lat, lon, src = _observing_site(
        Config(input_dir=".", site_lat=59.9, site_lon=10.7,
               site_explicit=True), no_gps)
    assert (round(lat, 1), round(lon, 1)) == (59.9, 10.7)
    assert "entered" in src

    # photo GPS wins over anything typed: it is where the camera was
    with_gps = [SimpleNamespace(gps_lat=60.1, gps_lon=11.2),
                SimpleNamespace(gps_lat=60.3, gps_lon=11.4),
                SimpleNamespace(gps_lat=None, gps_lon=None)]
    lat, lon, src = _observing_site(
        Config(input_dir=".", site_lat=59.9, site_lon=10.7,
               site_explicit=True), with_gps)
    assert (round(lat, 1), round(lon, 1)) == (60.2, 11.3)
    assert "GPS" in src


def test_below_horizon_solves_are_rejected_without_needing_the_clock():
    """A mirrored star match fits its own wrong stars tightly, so no RMS
    gate can catch it — but it lands on sky that never rises from the
    photographer's latitude, and that test needs no timezone."""
    from meteorprep.pipeline import _reject_below_horizon

    class R:
        def __init__(self, name):
            self.wcs = name

    seen = {}

    def possible(w):
        seen[w] = True
        return (w != "mirrored"), (-67.4 if w == "mirrored" else 67.3)

    good = R("true")
    assert _reject_below_horizon(good, possible, "blind") is good
    # a set-aside match is kept, so a mistyped latitude costs the user a
    # warning and a "degraded" label — never their whole night
    stash = {"result": None, "dec": None}
    bad = R("mirrored")
    assert _reject_below_horizon(bad, possible, "blind", stash) is None
    assert stash["result"] is bad and round(stash["dec"]) == -67
    assert _reject_below_horizon(None, possible, "blind") is None


def test_the_scale_retry_ladder_starts_fine_and_leans_wide():
    """Measured on real frames: the star matcher tolerates an assumed
    field up to ~8% too WIDE but fails once it is ~2% too NARROW, and a
    camera reporting its pixel pitch 2% off is enough to lose the whole
    run.  The retry ladder therefore has to step in a few percent, and
    reach for a wider field before a narrower one."""
    import inspect
    import re

    from meteorprep import pipeline

    src = inspect.getsource(pipeline._run_group)
    m = re.search(r"for mult in \(([^)]*)\):", src, re.S)
    assert m, "the field-of-view retry ladder moved"
    ladder = [eval(x.strip()) for x in m.group(1).split(",") if x.strip()]
    assert min(abs(v - 1.0) for v in ladder) <= 0.05, ladder
    # the first rung is a small step, and upward
    assert 1.0 < ladder[0] <= 1.05, ladder[0]
    # steps never jump more than ~1.35x between neighbours below 1.6x, so
    # nothing in the plausible range is skipped
    up = sorted(v for v in ladder if v >= 1.0)
    for a, b in zip(up, up[1:]):
        if a < 1.6:
            assert b / a < 1.35, (a, b)


def test_one_bright_meteor_becomes_one_candidate():
    """A bright meteor's glow is wide, and the line finder answers a wide
    glow with several overlapping segments — an injected fireball came
    back as twelve candidates in one 200-pixel patch, which would mean
    twelve layers in the PSD for one meteor."""
    from meteorprep.detect.hough import Streak
    from meteorprep.detect.track import Candidate, merge_same_frame_fragments

    def cand(cid, x0, y0, x1, y1, frame="A.CR2", length=1.0):
        s = Streak(frame_index=0, x0=x0, y0=y0, x1=x1, y1=y1,
                   length_px=float(((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5),
                   mean_intensity=500.0, peak_intensity=1000.0,
                   fwhm_px=3.0, aspect=10.0, area_px=300, score=1.0,
                   straightness_rms=0.4)
        return Candidate(id=cid, streaks=[s], frames=[frame],
                         endpoints_world=[((0.0, 0.0), (1.0, 1.0))],
                         endpoints_pix_base=[[x0, y0], [x1, y1]],
                         length_deg=length)

    frags = [cand("C000", 1146, 1760, 1252, 1604, length=3.2),
             cand("C001", 1200, 1750, 1294, 1588, length=3.2),
             cand("C002", 1254, 1714, 1306, 1590, length=2.3),
             cand("C003", 1264, 1598, 1280, 1696, length=1.7)]
    far = cand("C004", 4200, 700, 4300, 800, length=1.5)      # elsewhere
    other = cand("C005", 1150, 1700, 1250, 1650, frame="B.CR2", length=1.0)

    out = merge_same_frame_fragments(frags + [far, other])
    ids = {c.id for c in out}
    assert len(ids & {"C000", "C001", "C002", "C003"}) == 1, ids
    assert "C004" in ids and "C005" in ids       # untouched
    merged = next(c for c in out if c.id in {"C000", "C001", "C002", "C003"})
    assert merged.flags.get("merged_fragments") == 4
    # the surviving segment spans the whole group
    s = merged.streaks[0]
    span = ((s.x1 - s.x0) ** 2 + (s.y1 - s.y0) ** 2) ** 0.5
    assert span > 190, span


def test_two_real_meteors_are_not_demoted_to_one_satellite():
    """Every meteor in a shower points away from the same radiant, so
    'parallel, and lying along their own direction' describes ordinary
    pairs of real meteors — the pair rule was demoting them to satellite
    and hiding them in FLAGGED.  A satellite has to hop by roughly the
    length it draws, once per frame; two meteors far apart do not."""
    from meteorprep.detect.hough import Streak
    from meteorprep.detect.track import Candidate
    from meteorprep.pipeline import _absorb_track_fragments

    def cand(cid, x0, y0, x1, y1, frame):
        s = Streak(frame_index=0, x0=x0, y0=y0, x1=x1, y1=y1,
                   length_px=float(((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5),
                   mean_intensity=500.0, peak_intensity=1000.0, fwhm_px=3.0,
                   aspect=10.0, area_px=300, score=1.0, straightness_rms=0.4)
        return Candidate(id=cid, streaks=[s], frames=[frame],
                         endpoints_world=[((0.0, 0.0), (1.0, 1.0))],
                         endpoints_pix_base=[[x0, y0], [x1, y1]],
                         length_deg=1.0, label="meteor", confidence=0.8)

    idx = {"A.CR2": 0, "B.CR2": 1}
    # two 100 px radiant-parallel meteors 900 px apart in adjacent frames
    far = [cand("C0", 100, 100, 180, 180, "A.CR2"),
           cand("C1", 1000, 1000, 1080, 1080, "B.CR2")]
    _absorb_track_fragments(far, idx)
    assert [c.label for c in far] == ["meteor", "meteor"]

    # the same geometry at a satellite's own rate: it hops by about the
    # length it drew, so these two ARE one object
    sat = [cand("C0", 100, 100, 180, 180, "A.CR2"),
           cand("C1", 200, 200, 280, 280, "B.CR2")]
    _absorb_track_fragments(sat, idx)
    assert [c.label for c in sat] == ["satellite", "satellite"]


def test_three_evenly_spaced_dashes_are_one_glinting_satellite():
    """A satellite that only glints leaves a short dash per frame, far
    apart — the steady-motion test rightly refuses that pair, so what
    identifies it is repetition: three or more dashes on one line, evenly
    spaced in time.  Two parallel meteors must survive; three regular
    dashes must not."""
    from datetime import datetime, timedelta, timezone
    from types import SimpleNamespace

    from meteorprep.detect.hough import Streak
    from meteorprep.detect.track import Candidate
    from meteorprep.pipeline import _demote_regular_sequences

    t0 = datetime(2026, 8, 16, 4, 0, tzinfo=timezone.utc)

    def cand(cid, x, y, frame):
        s = Streak(frame_index=0, x0=x, y0=y, x1=x, y1=y + 34,
                   length_px=34.0, mean_intensity=500.0,
                   peak_intensity=1000.0, fwhm_px=3.0, aspect=10.0,
                   area_px=100, score=1.0, straightness_rms=0.4)
        return Candidate(id=cid, streaks=[s], frames=[frame],
                         endpoints_world=[((0.0, 0.0), (1.0, 1.0))],
                         endpoints_pix_base=[[x, y], [x, y + 34]],
                         length_deg=0.6, label="meteor", confidence=0.7)

    files = [f"F{i}.CR2" for i in range(4)]
    idx = {f: i for i, f in enumerate(files)}
    frames = [SimpleNamespace(epoch_mid=t0 + timedelta(seconds=26 * i),
                              exposure_s=20.0) for i in range(4)]

    # three dashes, same line, 400 px apart per frame: one glinting satellite
    sat = [cand("C0", 4500, 1300, files[0]),
           cand("C1", 4500, 1700, files[1]),
           cand("C2", 4500, 2100, files[2])]
    _demote_regular_sequences(sat, idx, frames)
    assert [c.label for c in sat] == ["satellite"] * 3

    # two parallel meteors on a shared line: not enough evidence, kept
    pair = [cand("C0", 4500, 1300, files[0]),
            cand("C1", 4500, 1700, files[1])]
    _demote_regular_sequences(pair, idx, frames)
    assert [c.label for c in pair] == ["meteor", "meteor"]

    # three on a line but NOT evenly spaced in time: unrelated meteors
    ragged = [cand("C0", 4500, 1300, files[0]),
              cand("C1", 4500, 1360, files[1]),
              cand("C2", 4500, 2600, files[2])]
    _demote_regular_sequences(ragged, idx, frames)
    assert [c.label for c in ragged] == ["meteor"] * 3


def test_line_snr_separates_a_real_streak_from_a_lucky_line():
    """At a low threshold the Hough pass answers noise with lines: five
    of them on a real night, whose crops were blank sky.  A real streak
    is brighter along its whole length than the sky a few pixels beside
    it, which is a measurement, not a threshold."""
    import cv2

    from meteorprep.detect.harvest import line_snr

    class S:
        def __init__(s_, x0, y0, x1, y1):
            s_.x0, s_.y0, s_.x1, s_.y1 = x0, y0, x1, y1

    rng = np.random.default_rng(7)
    sky = np.abs(rng.normal(0, 30, (600, 600))).astype(np.float32)

    real = sky.copy()
    cv2.line(real, (100, 100), (480, 430), 900.0, thickness=2,
             lineType=cv2.LINE_AA)
    real = cv2.GaussianBlur(real, (0, 0), 1.2)
    assert line_snr(real, S(100, 100, 480, 430)) > 8.0

    # the same line drawn nowhere: pure sky along the same path
    assert line_snr(sky, S(100, 100, 480, 430)) < 3.0


def test_hot_pixel_mask_matches_the_reference_rule():
    """The fast scan must be the same answer as rawpy's candidate rule,
    not merely a similar one: a pixel is a candidate when it reads high
    by more than the threshold, or reads low at all, against the median
    of its own Bayer colour.  (rawpy expresses the second half by uint16
    wraparound; this states it directly.)"""
    import cv2

    rng = np.random.default_rng(4)
    img = (rng.normal(2000, 40, (64, 96))).astype(np.uint16)
    img[10, 20] = 9000            # hot
    img[30, 40] = 200             # dead
    thresh = max(int(np.max(img)) // 150, 20)

    got = np.zeros(img.shape, np.uint8)
    for oy in (0, 1):
        for ox in (0, 1):
            sl = np.require(img[oy::2, ox::2], img.dtype, "C")
            med = cv2.medianBlur(sl, 3)
            got[oy::2, ox::2] = ((sl > med.astype(np.int32) + thresh)
                                 | (sl < med)).astype(np.uint8)

    # the uint16-wraparound form rawpy actually evaluates
    want = np.zeros(img.shape, np.uint8)
    for oy in (0, 1):
        for ox in (0, 1):
            sl = np.require(img[oy::2, ox::2], img.dtype, "C")
            med = cv2.medianBlur(sl, 3).copy()
            np.subtract(sl, med, out=med)      # uint16, wraps
            np.abs(med, out=med)
            want[oy::2, ox::2] = (med > thresh).astype(np.uint8)

    assert np.array_equal(got, want)
    assert got[10, 20] == 1 and got[30, 40] == 1


def test_clip_band_upsample_matches_the_whole_frame_one():
    """The stack compares each frame against half-resolution statistics.
    Blowing those up to the full canvas and holding them there cost half
    a gigabyte per worker; building each band as it is used has to give
    exactly the same numbers, or the sigma clip would reject different
    samples near band edges."""
    import cv2

    rng = np.random.default_rng(9)
    hh, ww = 231, 349
    half = (rng.random((hh, ww, 3), np.float32) * 1000)
    h, w = hh * 2, ww * 2
    full = cv2.resize(half, (w, h), interpolation=cv2.INTER_LINEAR)

    def clip_rows(arr_half, r0, r1):
        s0 = max((r0 // 2) - 1, 0)
        s1 = min(((r1 - 1) // 2) + 2, arr_half.shape[0])
        blk = cv2.resize(arr_half[s0:s1], (w, (s1 - s0) * 2),
                         interpolation=cv2.INTER_LINEAR)
        off = r0 - s0 * 2
        return blk[off:off + (r1 - r0)]

    for band in (64, 128, 512):
        rebuilt = np.concatenate([clip_rows(half, r, min(r + band, h))
                                  for r in range(0, h, band)])
        assert rebuilt.shape == full.shape
        assert np.array_equal(rebuilt, full), band


def test_foreground_layers_are_trimmed_to_the_ground():
    """A foreground layer is transparent above the treeline, and a
    transparent pixel composites to nothing — but it is still stored,
    compressed and written.  Trimming to where the alpha lives has to
    keep every visible pixel exactly where it was."""
    from meteorprep.assemble.layers import Layer, crop_layers_to_alpha

    h, w = 400, 600
    alpha = np.zeros((h, w), np.float32)
    alpha[300:, 50:550] = 1.0                    # ground band
    rgb = (np.arange(h * w * 3, dtype=np.float32).reshape(h, w, 3))
    layers = [Layer(name="FG_a", rgb=rgb.copy(), alpha=alpha.copy()),
              Layer(name="FG_b", rgb=rgb.copy(), alpha=alpha.copy())]
    crop_layers_to_alpha(layers, alpha)

    for lyr in layers:
        x0, y0, x1, y1 = lyr.bbox
        assert (y0, y1) == (296, 400) and (x0, x1) == (46, 554)
        assert lyr.rgb.shape[:2] == (y1 - y0, x1 - x0)
        # the pixels that survived are the same pixels, in place
        assert np.array_equal(lyr.rgb, rgb[y0:y1, x0:x1])
        assert np.array_equal(lyr.alpha, alpha[y0:y1, x0:x1])

    # an alpha that covers nearly everything is left alone
    full = np.ones((h, w), np.float32)
    keep = [Layer(name="FG", rgb=rgb.copy(), alpha=full.copy())]
    crop_layers_to_alpha(keep, full)
    assert keep[0].bbox is None and keep[0].rgb.shape[:2] == (h, w)


def test_sky_gradient_surface_matches_the_direct_evaluation():
    """The gradient layer is evaluated separably now — one vector per
    power instead of a full-frame basis image per term.  It has to be the
    same surface: this layer is set to Subtract in Photoshop, so an error
    in it is an error in the user's sky."""
    from meteorprep.stack.gradient import fit_sky_gradient

    h, w = 240, 360
    yy, xx = np.mgrid[0:h, 0:w]
    u, v = xx / w - 0.5, yy / h - 0.5
    truth = (800 + 300 * u + 200 * v - 150 * u * u + 90 * u * v
             + 40 * v * v).astype(np.float32)
    rgb = np.dstack([truth, truth * 0.9, truth * 1.1]).astype(np.float32)
    rgb += np.random.default_rng(2).normal(0, 3, rgb.shape).astype(np.float32)
    sky = np.ones((h, w), np.float32)

    got = fit_sky_gradient(rgb, sky)
    assert got is not None and got.shape == rgb.shape
    # the fit reproduces the planted surface up to its own offset removal
    for c, scale in enumerate((1.0, 0.9, 1.1)):
        ref = truth * scale
        ref = ref - ref.min()
        assert np.abs(got[:, :, c] - ref).max() < 6.0, c


def test_saved_detection_moves_between_canvas_sizes(tmp_path):
    """A quick look measures on a half-size canvas and the full run on a
    full-size one, and the two share the saved search.  The file has to
    say which canvas its numbers are in, or the handoff silently puts
    every meteor at half its true position — which is exactly what
    happened: the corridors masked the wrong sky, the layer windows cut
    blank sky, and the report still counted the right number of meteors,
    so nothing looked wrong."""
    from meteorprep.cache.store import CacheStore
    from meteorprep.detect.hough import Streak
    from meteorprep.detect.track import Candidate
    from meteorprep.pipeline import (_candidates_scale, _load_candidates,
                                     _save_candidates)

    st = Streak(frame_index=3, x0=100.0, y0=200.0, x1=140.0, y1=260.0,
                length_px=72.1, mean_intensity=900.0, peak_intensity=4000.0,
                fwhm_px=3.5, aspect=9.0, area_px=250, score=140.0,
                straightness_rms=0.4)
    cand = Candidate(id="C000", streaks=[st], frames=["IMG_1.CR2"],
                     endpoints_world=[(10.0, 20.0), (10.1, 20.1)],
                     dash_pattern=[], flags={}, physics={},
                     label="meteor", confidence=0.9)
    cache = CacheStore(tmp_path)

    _save_candidates(cache, [cand], scale=1.0)          # a quick look
    assert _candidates_scale(cache) == 1.0
    back = _load_candidates(cache, scale=2.0)           # read by a full run
    g = back[0].streaks[0]
    assert (g.x0, g.y0, g.x1, g.y1) == (200.0, 400.0, 280.0, 520.0)
    assert abs(g.length_px - 144.2) < 1e-6
    assert abs(g.fwhm_px - 7.0) < 1e-6
    assert g.area_px == 1000                            # area goes as S^2
    assert g.frame_index == 3 and g.aspect == 9.0       # untouched

    same = _load_candidates(cache, scale=1.0)           # same canvas
    assert same[0].streaks[0].x0 == 100.0

    # a file that does not say which canvas it is in must not be reused
    import json
    doc = json.loads((tmp_path / "candidates.json").read_text())
    doc.pop("coord_scale")
    (tmp_path / "candidates.json").write_text(json.dumps(doc))
    assert _candidates_scale(cache) is None


def test_the_gauntlet_judges_the_same_at_either_canvas_size():
    """Every run mode is promised to find the same meteors — the window
    says so, the docs say so, the report says so.  The fragment gauntlet
    measures in pixels ON THE OUTPUT CANVAS, and that canvas is half as
    wide at half size, so fixed tolerances made a Quick look twice as
    permissive as a Full quality run of the same night.  The same
    geometry, expressed on either canvas, has to get the same verdict."""
    from meteorprep.detect.hough import Streak
    from meteorprep.detect.track import Candidate
    from meteorprep.pipeline import _absorb_track_fragments

    def scene(sc):
        """One satellite track over two frames, plus a fragment sitting
        just off its line — far enough out to be a separate thing."""
        def st(fi, x0, y0, x1, y1):
            return Streak(frame_index=fi, x0=x0 * sc, y0=y0 * sc,
                          x1=x1 * sc, y1=y1 * sc,
                          length_px=100.0 * sc, mean_intensity=800.0,
                          peak_intensity=3000.0, fwhm_px=2.5 * sc,
                          aspect=30.0, area_px=int(300 * sc * sc),
                          score=200.0, straightness_rms=0.3)

        def cand(cid, streaks, frames, label):
            return Candidate(id=cid, streaks=streaks, frames=frames,
                             endpoints_world=[[(0.0, 0.0), (0.1, 0.1)]],
                             dash_pattern=[0.0], flags={}, physics={},
                             label=label, confidence=0.5)

        track = cand("C000", [st(0, 100, 100, 200, 200),
                              st(2, 500, 500, 600, 600)],
                     ["a.CR2", "c.CR2"], "satellite")
        # collinear with the track and where it should be at frame 1,
        # but 45 detection-pixels off to the side
        frag = cand("C001", [st(1, 300 + 45, 300, 400 + 45, 400)],
                    ["b.CR2"], "meteor")
        return [track, frag]

    idx = {"a.CR2": 0, "b.CR2": 1, "c.CR2": 2}
    labels = {}
    for sc in (1.0, 2.0):
        cands = scene(sc)
        _absorb_track_fragments(cands, idx, None, scale=sc)
        labels[sc] = [c.label for c in cands]
    assert labels[1.0] == labels[2.0], (
        f"half size said {labels[1.0]}, full size said {labels[2.0]}")


def test_streak_endpoints_walk_through_a_gap_in_the_tail():
    """The endpoint walk is documented to stop after five dim pixels in a
    row.  Stepping from the last ACCEPTED point instead of the current
    one re-tested the same pixel five times and stopped at the FIRST dim
    one — so the run length never happened and a meteor tail was cut at
    its first flicker, which is where the interesting part of a tail
    starts."""
    from meteorprep.mask.extract import _grow_along_axis

    diff = np.zeros((60, 200), np.float32)
    diff[30, 40:120] = 500.0          # the streak
    diff[30, 100] = 0.0               # one dim pixel partway along it
    diff[30, 121:126] = 0.0           # the real end: five in a row

    p0, p1 = _grow_along_axis(diff, (60.0, 30.0), (90.0, 30.0), 100.0)
    assert p1[0] >= 119, f"tail cut short at {p1[0]}"
    assert p0[0] <= 40, f"head cut short at {p0[0]}"

    # and a clean streak still ends where it ends
    clean = np.zeros((60, 200), np.float32)
    clean[30, 40:120] = 500.0
    q0, q1 = _grow_along_axis(clean, (60.0, 30.0), (90.0, 30.0), 100.0)
    assert (q0[0], q1[0]) == (40.0, 119.0)


def test_line_snr_needs_the_scale_its_streak_was_measured_on():
    """detect_streaks reports geometry on the output canvas; the faint
    pass measures on the detection-scale difference.  Handing it the
    wrong one does not raise — every sample clamps to the frame edge and
    the gate measures the border instead of the streak, which is how a
    gate meant to reject noise ended up rejecting everything."""
    import cv2

    from meteorprep.detect.harvest import line_snr
    from meteorprep.detect.hough import Streak

    hd, wd = 400, 600
    diff = np.random.default_rng(4).normal(0, 3, (hd, wd)).astype(np.float32)
    np.clip(diff, 0, None, out=diff)
    cv2.line(diff, (120, 90), (330, 250), 600.0, 2)     # detection scale

    def streak(sc):                       # as detect_streaks would report
        return Streak(frame_index=0, x0=120.0 * sc, y0=90.0 * sc,
                      x1=330.0 * sc, y1=250.0 * sc, length_px=265.0 * sc,
                      mean_intensity=600.0, peak_intensity=600.0,
                      fwhm_px=2.0 * sc, aspect=80.0, area_px=500,
                      score=300.0, straightness_rms=0.2)

    good = line_snr(diff, streak(2.0), scale=2.0)
    wrong = line_snr(diff, streak(2.0))                 # scale left at 1
    assert good > 20.0, good
    assert wrong < 4.0, wrong                           # the old behaviour
    assert line_snr(diff, streak(1.0)) > 20.0           # unscaled still fine


def test_resume_keeps_the_per_photo_noise_weights():
    """The search measures each photo's noise and the stack weights by
    it.  A resumed run does not search, so unless the numbers were
    written down it re-stacks the night with every photo weighted the
    same — a different picture from the one the same folder produced the
    first time, with nothing to show why."""
    import inspect

    from meteorprep import pipeline as pl

    src = inspect.getsource(pl._run_group)
    assert 'cache.write_json("frame_noise.json"' in src
    assert 'cache.read_json("frame_noise.json")' in src
    # and it has to be read before the weights are worked out
    assert (src.index('read_json("frame_noise.json")')
            < src.index("frame_noise_weights(noise_sigmas)"))


def test_second_look_marker_is_only_written_when_it_actually_ran():
    """The faint pass is allowed to fail — it is a bonus, and the
    first-pass results stand without it.  What it must not do is leave a
    marker saying it is done, because then it never runs again for that
    folder and nothing says why."""
    import inspect

    from meteorprep import pipeline as pl

    src = inspect.getsource(pl._run_group)
    assert "faint_ran = False" in src
    assert "if want_faint and faint_ran:" in src, (
        "the second-look marker must be gated on the pass having run")
    # the flag is set inside the try, after the work, not beside it
    tail = src[src.index("faint_ran = True"):]
    assert tail.lstrip().startswith("faint_ran = True")
    assert "except Exception" in tail[:400], (
        "faint_ran must be set on the last line of the try block")


def test_resumed_run_reapplies_the_verdicts():
    """A resumed run reloads measurements, not judgements: the labels
    have to be decided again from the current settings, or changing the
    radiant tolerance re-stacks the whole night and then reports exactly
    what it reported before."""
    import inspect

    from meteorprep import pipeline as pl

    src = inspect.getsource(pl._run_group)
    block = src[src.index("if detect_cached:"):]
    block = block[:block.index("base_mid = base_meta.epoch_mid")]
    assert "_load_candidates(" in block
    assert "classify(candidates, cfg, radiant)" in block, (
        "loaded candidates must be re-classified with this run's settings")


def test_draft_mode_keeps_the_verdicts_and_drops_only_the_expensive_half():
    """A draft has to be worth trusting: it must search exactly what the
    full run searches, so the meteors it reports are the real answer.
    What it is allowed to drop is the picture's resolution and the file
    formats.  This pins both halves of that promise, including the cache
    sharing that lets the full run reuse a draft's search."""
    from meteorprep.config import Config

    full, draft = Config(), Config(draft=True)

    # the expensive half is gone
    assert draft.half_size and draft.super_sample == 1.0
    assert not (draft.emit_psd or draft.emit_pngjsx
                or draft.emit_startrail or draft.emit_contact_sheet)
    assert not draft.faint_harvest

    # ...but nothing that decides WHAT is found has moved
    for k in ("diff_threshold", "detect_min_thresh", "min_area",
              "min_aspect_ratio", "hough_threshold", "min_line_score",
              "bin_factor", "ref_window", "ref_sigma", "stack_sigma",
              "radiant_tol_deg", "cosmic_max_px"):
        assert getattr(draft, k) == getattr(full, k), k

    # the folder scan, the plate solve and the search describe the same
    # work in both modes, so a full run after a draft reuses them
    for stage in ("ingest", "segment_folder", "solve", "reproject",
                  "detect", "classify"):
        assert draft.stage_hash(stage) == full.stage_hash(stage), stage
    # the picture itself does not
    for stage in ("base_sky", "extract", "assemble"):
        assert draft.stage_hash(stage) != full.stage_hash(stage), stage


def test_draft_stack_subset_spans_the_night():
    """The draft stacks a few dozen photos rather than all of them.  They
    have to be spread across the run — a draft built from the first forty
    frames of a night that ends in dawn twilight would show a sky the
    night never had."""
    import meteorprep.pipeline as pl

    src = pl.__file__
    assert src                      # the logic itself, on a synthetic set
    n, keep = 226, 40
    ok = list(range(n))
    step = n / float(keep)
    picked = sorted(dict.fromkeys(
        ok[min(int(k * step), n - 1)] for k in range(keep)))
    assert len(picked) == keep
    assert picked[0] == 0 and picked[-1] >= n - int(step) - 1
    gaps = np.diff(picked)
    assert gaps.max() - gaps.min() <= 1     # evenly spread


def test_clipped_partials_are_merged_in_worker_order():
    """The second pass adds each worker's partial sums into one float32
    accumulator.  Float addition is not associative, so completion order
    would decide the last bit of every pixel — invisible, but enough to
    make two runs of the same folder produce different files.  (It was
    masked while the parent accumulated in float64, and reappeared the
    day that became float32.)  This pins both halves: that the order
    matters, and that the pass asks for it to be fixed."""
    import inspect

    from meteorprep import pipeline as pl

    rng = np.random.default_rng(5)
    parts = [rng.random((6, 6, 3), np.float32) * 4000 for _ in range(4)]

    def summed(order):
        acc = np.zeros((6, 6, 3), np.float32)
        for k in order:
            np.add(acc, parts[k], out=acc)
        return acc

    assert not np.array_equal(summed([0, 1, 2, 3]), summed([3, 1, 0, 2])), (
        "if float32 accumulation ever becomes exact the ordering could "
        "be relaxed")

    src = inspect.getsource(pl._stream_base)
    call = src[src.index('run_pass("clipped"'):]
    call = call[:call.index(")\n")]
    assert "in_order=True" in call, (
        "the full-resolution pass must merge its partials in worker "
        "order or the finished stack stops being reproducible")


def test_moment_merging_is_order_sensitive_which_is_why_it_is_ordered():
    """Combining the statistics partials is floating-point addition, so
    the answer depends on the order they arrive in — and downstream that
    order moved the clip bounds enough to flip the keep/reject decision
    on a thousand pixels, making two runs of the same folder produce
    different files.  The pass merges by worker number for that reason;
    this pins the reason itself."""
    from meteorprep.stack.streaming import RunningMoments

    rng = np.random.default_rng(12)
    parts = []
    for _ in range(4):
        m = RunningMoments((8, 8, 3))
        for _ in range(5):
            m.add((rng.random((8, 8, 3), np.float32) * 3000
                   + 1e5).astype(np.float32),
                  np.ones((8, 8), bool))
        parts.append(m)

    def combined(order):
        total = RunningMoments((8, 8, 3))
        for k in order:
            p = parts[k]
            clone = RunningMoments((8, 8, 3))
            clone.count, clone.mean, clone.m2 = (p.count.copy(),
                                                 p.mean.copy(),
                                                 p.m2.copy())
            total.combine(clone)
        return total.std()

    a = combined([0, 1, 2, 3])
    b = combined([3, 1, 0, 2])
    assert not np.array_equal(a, b), (
        "if this ever becomes exact the ordering could be relaxed")
    assert np.allclose(a, b, rtol=1e-4)      # tiny, but not nothing


def _bump_wcs(crval_ra: float, crval_dec: float, rot_shift_px: float = 0.0):
    """A plain TAN WCS; ``rot_shift_px`` slides CRPIX to fake the camera
    itself having been nudged."""
    from astropy.wcs import WCS
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crpix = [1000.0 + rot_shift_px, 700.0]
    w.wcs.crval = [crval_ra, crval_dec]
    w.wcs.cdelt = [-0.005, 0.005]
    return w


def _bump_frames(n: int):
    from datetime import datetime, timedelta, timezone

    class _F:
        def __init__(self, i):
            self.file = f"IMG_{i:03d}.CR2"
            self.epoch_mid = (datetime(2026, 8, 12, 2, 0, tzinfo=timezone.utc)
                              + timedelta(seconds=30 * i))
    return [_F(i) for i in range(n)]


def test_a_still_tripod_is_never_reported_as_bumped():
    """Every frame's WCS is its predecessor's advanced by the sidereal
    rate — which is exactly what a tripod that did not move looks like."""
    from meteorprep.astrometry.solve import SIDEREAL_DEG_PER_SEC
    from meteorprep.pipeline import _detect_tripod_bump

    frames = _bump_frames(20)
    ra0 = 45.0
    wcs = [_bump_wcs(ra0 + SIDEREAL_DEG_PER_SEC * 30 * i, 40.0)
           for i in range(20)]
    assert _detect_tripod_bump(wcs, frames, 50.0) is None


def test_a_knocked_tripod_is_found_at_the_photo_it_happened():
    from meteorprep.astrometry.solve import SIDEREAL_DEG_PER_SEC
    from meteorprep.pipeline import _detect_tripod_bump

    frames = _bump_frames(20)
    ra0 = 45.0
    # the camera is shoved 120 px sideways at frame 12 and stays there
    wcs = [_bump_wcs(ra0 + SIDEREAL_DEG_PER_SEC * 30 * i, 40.0,
                     rot_shift_px=(120.0 if i >= 12 else 0.0))
           for i in range(20)]
    hit = _detect_tripod_bump(wcs, frames, 50.0)
    assert hit is not None
    assert hit["index"] == 12 and hit["file"] == "IMG_012.CR2"
    assert 110 < hit["shift_px"] < 130
    assert hit["n_after"] == 8
    # a threshold above the shove sees a tripod that never moved
    assert _detect_tripod_bump(wcs, frames, 200.0) is None


def test_one_bad_solve_is_not_mistaken_for_a_bump():
    """A single frame whose WCS is wrong jumps away and straight back;
    that is a bad solve, and splitting the night on it would be wrong."""
    from meteorprep.astrometry.solve import SIDEREAL_DEG_PER_SEC
    from meteorprep.pipeline import _detect_tripod_bump

    frames = _bump_frames(20)
    ra0 = 45.0
    wcs = [_bump_wcs(ra0 + SIDEREAL_DEG_PER_SEC * 30 * i, 40.0,
                     rot_shift_px=(300.0 if i == 9 else 0.0))
           for i in range(20)]
    assert _detect_tripod_bump(wcs, frames, 50.0) is None
