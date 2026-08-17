"""Fully automatic (lost-in-space) solving: no hints, no network."""

import numpy as np
import pytest
import tifffile

from meteorprep.astrometry.blind import blind_solve, load_bright_catalog
from meteorprep.ingest.raw import luminance


def test_bundled_catalog_loads():
    cat = load_bright_catalog()
    # ra, dec, vmag, effective temperature (K)
    assert cat.shape[1] == 4
    assert len(cat) > 4000
    # brightest-first: Sirius leads
    assert cat[0, 2] < -1.0
    assert np.all(np.diff(cat[:, 2]) >= 0)
    # temperatures present and physical for nearly all stars
    temps = cat[:, 3]
    assert (temps > 0).mean() > 0.95
    assert 2000 < np.median(temps[temps > 0]) < 20000


def test_blind_solve_no_hints(synth_dir, ground_truth, base_wcs):
    """Solve the synthetic base frame with zero pointing knowledge."""
    cat = np.load(synth_dir / "catalog_radec.npy")
    img = tifffile.imread(synth_dir / ground_truth["base_file"])
    r = blind_solve(luminance(img), ground_truth["pixel_scale_deg"],
                    catalog_radec=cat)
    assert r is not None, "blind solve failed"
    assert r.rms_px < 2.0
    h, w = ground_truth["shape"]
    c = r.wcs.pixel_to_world_values(w / 2, h / 2)
    true_c = base_wcs.pixel_to_world_values(w / 2, h / 2)
    err = np.hypot(
        (float(c[0]) - float(true_c[0]))
        * np.cos(np.deg2rad(float(true_c[1]))),
        float(c[1]) - float(true_c[1]))
    assert err / ground_truth["pixel_scale_deg"] < 2.0  # px


def test_blind_solve_rejects_starless_image():
    rng = np.random.default_rng(0)
    noise = rng.normal(2000, 25, (300, 450)).astype(np.float32)
    assert blind_solve(noise, 0.28) is None


def test_blind_solve_wrong_scale_rescued_by_sweep(synth_dir, ground_truth):
    """A crop-sensor camera makes the assumed plate scale wrong by ~1.6x;
    the solve must fail at the wrong scale (that is the observed real-world
    failure) and succeed again once the sweep corrects it."""
    cat = np.load(synth_dir / "catalog_radec.npy")
    img = tifffile.imread(synth_dir / ground_truth["base_file"])
    lum = luminance(img)
    wrong = ground_truth["pixel_scale_deg"] * 1.6
    assert blind_solve(lum, wrong, catalog_radec=cat) is None
    r = None
    for mult in (1.6, 1 / 1.6, 1.3, 1 / 1.3, 2.0, 0.5):
        r = blind_solve(lum, wrong * mult, catalog_radec=cat)
        if r is not None:
            break
    assert r is not None and r.rms_px < 2.0
    assert abs(mult - 1 / 1.6) < 1e-9
