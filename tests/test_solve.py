"""Plate-solve accuracy and lens-distortion tests (§4, §9.4)."""

import json

import numpy as np
import pytest
import tifffile

from meteorprep.astrometry.lensdistort import Poly3Distortion
from meteorprep.astrometry.solve import (build_tan_wcs, detect_stars,
                                         refine_wcs, solve_rms_px)
from meteorprep.ingest.raw import luminance


@pytest.fixture(scope="module")
def solved(synth_dir, ground_truth):
    cat = np.load(synth_dir / "catalog_radec.npy")
    img = tifffile.imread(synth_dir / ground_truth["base_file"])
    stars = detect_stars(luminance(img))
    seed = build_tan_wcs(ground_truth["tangent_radec"][0] + 0.2,
                         ground_truth["tangent_radec"][1] - 0.15,
                         ground_truth["pixel_scale_deg"],
                         tuple(ground_truth["shape"]))
    result = refine_wcs(stars, cat, seed, sip_order=3)
    return result, stars, cat


def test_solve_rms_subpixel(solved):
    """§9.4: RMS residual < 1 px on synthetic data."""
    result, stars, cat = solved
    assert result is not None
    assert result.rms_px < 1.0
    assert result.n_matched >= 100


def test_solve_center_accuracy(solved, ground_truth, base_wcs):
    """Recovered WCS center within the scaled equivalent of 30 arcsec at
    the reference rig's 84.4 arcsec/px plate scale (< 0.5 px here)."""
    result, _, _ = solved
    h, w = ground_truth["shape"]
    fit_c = result.wcs.pixel_to_world_values(w / 2, h / 2)
    true_c = base_wcs.pixel_to_world_values(w / 2, h / 2)
    dec = np.deg2rad(float(true_c[1]))
    err_deg = np.hypot((float(fit_c[0]) - float(true_c[0])) * np.cos(dec),
                       float(fit_c[1]) - float(true_c[1]))
    assert err_deg / ground_truth["pixel_scale_deg"] < 0.5


def test_detect_stars_finds_catalog(synth_dir, ground_truth):
    img = tifffile.imread(synth_dir / ground_truth["base_file"])
    stars = detect_stars(luminance(img))
    assert len(stars) >= 100


def test_poly3_roundtrip():
    dist = Poly3Distortion(-0.04, (3648, 5472))
    xy = np.array([[100.0, 200.0], [2736.0, 1824.0], [5300.0, 3500.0],
                   [0.0, 0.0]])
    back = dist.undistort(dist.distort(xy))
    assert np.abs(back - xy).max() < 0.01


def test_undistort_recovers_solve_on_distorted_field(tmp_path):
    """With ~4 % barrel distortion injected, solving distorted centroids
    directly must be worse than solving Lensfun-style pre-corrected ones."""
    from meteorprep.testdata.synth import make_synthetic_sequence

    k1 = -0.04
    gt = make_synthetic_sequence(tmp_path, n_frames=3, shape=(500, 750),
                                 focal_px=2443.0 * 750 / 5472, n_stars=220,
                                 n_meteors=0, n_aircraft=0, n_satellites=0,
                                 k1=k1, seed=7)
    cat = np.load(tmp_path / "catalog_radec.npy")
    img = tifffile.imread(tmp_path / gt["base_file"])
    stars = detect_stars(luminance(img))
    seed = build_tan_wcs(gt["tangent_radec"][0], gt["tangent_radec"][1],
                         gt["pixel_scale_deg"], tuple(gt["shape"]))
    dist = Poly3Distortion(k1, tuple(gt["shape"]))

    raw_fit = refine_wcs(stars, cat, seed, sip_order=None)
    corr_fit = refine_wcs(dist.undistort(stars), cat, seed, sip_order=None)
    assert corr_fit is not None
    assert corr_fit.rms_px < 1.0
    assert raw_fit is None or corr_fit.rms_px < raw_fit.rms_px


def test_propagation_verification(synth_dir, ground_truth, base_wcs):
    """WCS propagated across the sequence still matches detected stars to
    sub-pixel accuracy (the sparse-solve strategy of §4.4)."""
    from datetime import datetime

    from meteorprep.astrometry.solve import propagate_wcs

    cat = np.load(synth_dir / "catalog_radec.npy")
    frames = ground_truth["frames"]
    b = ground_truth["base_index"]
    t0 = datetime.fromisoformat(frames[b]["epoch_mid"])
    for i in (0, len(frames) - 1):
        dt = (datetime.fromisoformat(frames[i]["epoch_mid"]) - t0).total_seconds()
        wcs_i = propagate_wcs(base_wcs, dt)
        img = tifffile.imread(synth_dir / frames[i]["file"])
        stars = detect_stars(luminance(img))
        rms, n = solve_rms_px(wcs_i, stars, cat, match_tol_px=5.0)
        assert n >= 50
        assert rms < 1.0
