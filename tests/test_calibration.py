"""Calibration frames: the folders, the masters, and the arithmetic.

Everything here runs against tiny synthetic Bayer DNGs rather than the
real twenty-megapixel CR2s, so the suite stays fast while still going
through LibRaw exactly as a photograph does.
"""

from __future__ import annotations

import numpy as np
import pytest

from meteorprep.config import Config
from meteorprep.ingest import masters as M
from meteorprep.ingest.exif import scan_input_dir

rawpy = pytest.importorskip("rawpy")
tifffile = pytest.importorskip("tifffile")

BLACK, WHITE = 512, 16383
_TAGS = [
    (50706, 'B', 4, (1, 4, 0, 0), True),          # DNGVersion
    (50707, 'B', 4, (1, 1, 0, 0), True),
    (50708, 's', 0, "MeteorPrep TestCam", True),  # UniqueCameraModel
    (33421, 'H', 2, (2, 2), True),                # CFARepeatPatternDim
    (33422, 'B', 4, (0, 1, 1, 2), True),          # CFAPattern, RGGB
    (50714, 'H', 1, (BLACK,), True),              # BlackLevel
    (50717, 'I', 1, (WHITE,), True),              # WhiteLevel
    (50721, '2i', 9, (10000, 10000, -3000, 10000, -1000, 10000,
                      -2000, 10000, 9000, 10000, 1000, 10000,
                      -500, 10000, 1500, 10000, 6000, 10000), True),
    (50778, 'H', 1, (17,), True),                 # D65
]


def _dng(path, plane):
    tifffile.imwrite(path, np.clip(plane, 0, WHITE).astype(np.uint16),
                     photometric=32803, planarconfig=None, extratags=_TAGS)


def _vignette(h, w, corner=0.5):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rr = np.hypot((yy - h / 2) / (h / 2), (xx - w / 2) / (w / 2))
    k = np.tan(np.arccos(corner ** 0.25)) / np.hypot(1.0, 1.0)
    return np.cos(np.arctan(rr * k)) ** 4


@pytest.fixture
def night(tmp_path):
    """A folder of photographs with a flats/ folder beside them."""
    h, w = 48, 64
    vig = _vignette(h, w)
    rng = np.random.default_rng(3)
    (tmp_path / "flats").mkdir()
    for i in range(12):
        _dng(tmp_path / "flats" / f"FLAT_{i}.dng",
             BLACK + 4000 * vig + rng.normal(0, 8, (h, w)))
    for i in range(6):
        sky = BLACK + 300 * vig + rng.normal(0, 4, (h, w))
        _dng(tmp_path / f"IMG_{i}.dng", sky)
    return tmp_path, vig, (h, w)


# ------------------------------------------------------------- the folders
def test_calibration_folders_are_not_mistaken_for_photographs(night):
    root, _, _ = night
    found = scan_input_dir(root, [".dng"])
    assert len(found) == 6
    assert not any("flats" in p.parts for p in found)
    assert set(M.find_calibration_dirs(root)) == {"flat"}
    assert M.is_calibration_path(root / "flats" / "FLAT_0.dng", root)
    assert not M.is_calibration_path(root / "IMG_0.dng", root)


def test_every_spelling_of_a_calibration_folder_is_caught():
    for name in ("darks", "Flats", "BIAS", "dark", "offset"):
        assert name.lower() in M.CAL_DIRS


# ------------------------------------------------------------- the masters
def test_the_master_flat_recovers_the_shading_it_was_shot_through(night):
    root, vig, shape = night
    paths = sorted((root / "flats").glob("*.dng"))
    _, black, colors, _ = M._open_geometry(paths[0])
    flat = M.build_flat(paths, shape, black, colors)
    # normalised to the brightest part, so it only ever lifts
    assert flat.max() == pytest.approx(1.0, abs=0.02)
    assert flat.min() < 0.7
    truth = vig / vig.max()
    assert np.median(np.abs(flat / truth - 1.0)) < 0.02


def test_a_flat_that_is_too_dark_to_divide_by_is_refused(tmp_path):
    h, w = 32, 32
    for i in range(6):
        _dng(tmp_path / f"f{i}.dng", np.full((h, w), BLACK, np.uint16))
    paths = sorted(tmp_path.glob("*.dng"))
    _, black, colors, _ = M._open_geometry(paths[0])
    with pytest.raises(ValueError, match="too dark"):
        M.build_flat(paths, (h, w), black, colors)


def test_the_master_dark_keeps_its_pedestal(tmp_path):
    h, w = 32, 32
    rng = np.random.default_rng(5)
    for i in range(8):
        _dng(tmp_path / f"d{i}.dng", BLACK + 40 + rng.normal(0, 3, (h, w)))
    dark = M.build_dark(sorted(tmp_path.glob("*.dng")), (h, w))
    # a dark that had its black level taken off would subtract it twice
    assert 545 < float(np.median(dark)) < 559


# ------------------------------------------------------ mismatch and warning
class _Meta:
    def __init__(self, **kw):
        for k in ("iso", "exposure_s", "fnumber", "focal_mm", "model",
                  "lens_model"):
            setattr(self, k, kw.get(k))


def test_darks_from_the_wrong_settings_are_refused_not_applied():
    lights = [_Meta(iso=1600, exposure_s=20.0, model="Canon EOS 6D")]
    ok, _ = M.check_darks([_Meta(iso=1600, exposure_s=20.0,
                                 model="Canon EOS 6D")], lights)
    assert ok == []
    bad, _ = M.check_darks([_Meta(iso=3200, exposure_s=20.0,
                                  model="Canon EOS 6D")], lights)
    assert bad and "ISO" in bad[0]
    bad, _ = M.check_darks([_Meta(iso=1600, exposure_s=30.0,
                                  model="Canon EOS 6D")], lights)
    assert bad and "s but" in bad[0]


def test_flats_from_another_aperture_are_refused_and_another_lens_warned():
    lights = [_Meta(fnumber=2.8, focal_mm=20.0, lens_model="EF20mm")]
    bad, warn = M.check_flats([_Meta(fnumber=4.0, focal_mm=20.0,
                                     lens_model="EF20mm")], lights)
    assert bad and "aperture" in bad[0] and not warn
    bad, warn = M.check_flats([_Meta(fnumber=2.8, focal_mm=20.0,
                                     lens_model="EF35mm")], lights)
    assert not bad and warn and "lens" in warn[0]


def test_a_dark_with_a_light_leak_says_so():
    dark = np.full((256, 256), 560.0, np.float32)
    assert M.check_master_dark(dark, np.full((256, 256), 512.0)) == []
    dark[:64] += 200.0                       # glow along one edge
    assert M.check_master_dark(dark, np.full((256, 256), 512.0))


# --------------------------------------------------------------- the Calib
def test_a_calib_survives_being_sent_to_a_worker(tmp_path):
    import pickle
    p = tmp_path / "flat.npy"
    np.save(p, np.ones((4, 4), np.float32))
    c = M.Calib(np.array([[1, 2]]), None, p, 14184.0)
    back = pickle.loads(pickle.dumps(c))
    assert back.ref_max == 14184.0 and back.flat_path == str(p)
    assert back.calibrates and back._plane("flat").shape == (4, 4)
    # a bare hot-pixel map still works exactly as it always did
    plain = M.as_calib(np.array([[3, 4]]))
    assert not plain.calibrates and plain.bad_pixels.tolist() == [[3, 4]]
    assert M.as_calib(None).bad_pixels is None


def test_a_master_of_the_wrong_size_is_ignored_rather_than_crashing(night, caplog):
    root, _, _ = night
    bad = root / "wrong.npy"
    np.save(bad, np.ones((3, 3), np.float32))
    cal = M.Calib(None, None, bad)
    with rawpy.imread(str(root / "IMG_0.dng")) as raw:
        before = raw.raw_image_visible.copy()
        cal.apply(raw)
        assert np.array_equal(raw.raw_image_visible, before)


# --------------------------------------------------------- end to end, tiny
def test_flattening_a_frame_evens_out_its_corners(night):
    root, vig, shape = night
    paths = sorted((root / "flats").glob("*.dng"))
    _, black, colors, _ = M._open_geometry(paths[0])
    flat = M.build_flat(paths, shape, black, colors)
    np.save(root / "master_flat.npy", flat)
    cal = M.Calib(None, None, root / "master_flat.npy")

    light = root / "IMG_0.dng"
    with rawpy.imread(str(light)) as raw:
        raw_before = raw.raw_image_visible.astype(float) - BLACK
    with rawpy.imread(str(light)) as raw:
        cal.apply(raw)
        raw_after = raw.raw_image_visible.astype(float) - BLACK
    h, w = shape
    def ratio(a):
        return a[2:8, 2:8].mean() / a[h//2-3:h//2+3, w//2-3:w//2+3].mean()
    assert ratio(raw_before) < 0.65            # corner was dark
    assert 0.9 < ratio(raw_after) < 1.12       # and is not any more


def test_the_search_still_sees_an_uncalibrated_frame(night):
    """The masters go on the pictures, not on the meteor search."""
    from meteorprep.ingest import raw as R
    root, _, shape = night
    paths = sorted((root / "flats").glob("*.dng"))
    _, black, colors, _ = M._open_geometry(paths[0])
    np.save(root / "mf.npy", M.build_flat(paths, shape, black, colors))
    cal = M.Calib(None, None, root / "mf.npy", 15000.0)
    light = root / "IMG_0.dng"
    assert np.array_equal(R.decode(light, "detect", cal),
                          R.decode(light, "detect", None))
    assert not np.array_equal(R.decode(light, "final", cal),
                              R.decode(light, "final", None))


def test_turning_calibration_off_changes_what_the_cache_believes():
    a = Config(input_dir="/x", output_dir="/y")
    b = Config(input_dir="/x", output_dir="/y", calibrate=False)
    assert a.calibrate and not b.calibrate
    assert a.stage_hash("ingest") != b.stage_hash("ingest")


def test_prepare_does_nothing_when_nobody_shot_any(tmp_path):
    cfg = Config(input_dir=str(tmp_path), output_dir=str(tmp_path / "out"))
    cal = M.prepare(cfg, [], None)
    assert not cal.calibrates
