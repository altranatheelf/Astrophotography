"""Acceptance tests for the gnomonic geometry core (§4.1, §9.4)."""

import numpy as np
import pytest

from meteorprep.astrometry.oracle import GnomonicOracle, SIDEREAL_DEG_PER_HOUR
from meteorprep.astrometry.solve import build_tan_wcs, propagate_wcs


@pytest.fixture(scope="module")
def oracle():
    return GnomonicOracle()


@pytest.fixture(scope="module")
def rig_wcs(oracle):
    # tangent point at ra=0, dec=55 matches the oracle frame (pole 35 deg off-axis)
    scale = np.rad2deg(np.arctan(1.0 / oracle.f))
    return build_tan_wcs(0.0, 55.0, scale, (3648, 5472))


def test_sidereal_rate():
    assert SIDEREAL_DEG_PER_HOUR == pytest.approx(15.041, abs=0.001)


def test_plate_scale():
    o = GnomonicOracle()
    assert o.f == pytest.approx(2442.7, abs=0.1)
    arcsec_per_px = np.rad2deg(np.arctan(1 / o.f)) * 3600
    assert arcsec_per_px == pytest.approx(84.4, abs=0.1)


def test_residual_table_reproduces_spec(oracle):
    """The 26/154/720 px/hr table (Key Finding #3) within +-15 %."""
    t = oracle.residual_table()
    naive10, best10 = t["pole10"]
    naive25, best25 = t["pole25"]
    naive_c, best_c = t["corner"]
    naive_ax, best_ax = t["near_axis45"]
    assert best10 == pytest.approx(26.0, rel=0.15)
    assert best25 == pytest.approx(154.0, rel=0.15)
    assert best_c == pytest.approx(720.0, rel=0.15)
    assert naive10 == pytest.approx(39.0, rel=0.15)
    assert naive_c == pytest.approx(745.0, rel=0.15)
    # the controlling variable is field angle, not pole distance: a star
    # 45 deg from the pole but near the axis has tiny irreducible error
    assert naive_ax == pytest.approx(99.0, rel=0.15)
    assert best_ax < 10.0


def test_oracle_matches_astropy_tan(oracle, rig_wcs):
    """Static projection agreement (< 1e-3 px)."""
    cx = rig_wcs.wcs.crpix[0] - 1
    cy = rig_wcs.wcs.crpix[1] - 1
    for rho, psi in [(10, 90), (25, 45), (45, 0), (40, 120), (5, 300)]:
        X, Y = oracle.project(oracle.star(rho, psi))
        px, py = rig_wcs.world_to_pixel_values(psi % 360, 90 - rho)
        assert np.hypot(px - cx - X, py - cy - Y) < 1e-3


def test_wcs_propagation_congruence(oracle, rig_wcs):
    """propagate_wcs (CRVAL1 advance) is exact for a fixed tripod: it must
    agree with the oracle's rigid sky rotation to < 1e-3 px after 1 h."""
    cx = rig_wcs.wcs.crpix[0] - 1
    cy = rig_wcs.wcs.crpix[1] - 1
    dth = SIDEREAL_DEG_PER_HOUR
    w1 = propagate_wcs(rig_wcs, 3600.0)
    for rho, psi in [(10, 90), (45, 20), (30, 200), (25, 130)]:
        # fixed catalog star; in the camera frame stars drift toward -RA
        px, py = w1.world_to_pixel_values(psi % 360, 90 - rho)
        X, Y = oracle.project(oracle.rotate_sky(oracle.star(rho, psi), -dth))
        assert np.hypot(px - cx - X, py - cy - Y) < 1e-3


def test_timing_tolerance_one_second(rig_wcs):
    """+-1 s timestamp jitter must move even a corner star < 0.5 px (§2.2)."""
    w1 = propagate_wcs(rig_wcs, 1.0)
    for px_probe in [(0.5, 0.5), (5471.5, 3647.5), (5471.5, 0.5)]:
        world = rig_wcs.pixel_to_world_values(*px_probe)
        moved = w1.world_to_pixel_values(*world)
        shift = np.hypot(moved[0] - px_probe[0], moved[1] - px_probe[1])
        assert shift < 0.5


def test_reproject_matches_oracle_subpixel(oracle):
    """§9.4: gnomonic oracle vs `reproject` agree to < 0.1 px RMS on
    injected stars, and point-source FWHM growth stays < 0.3 px."""
    from meteorprep.astrometry.reproject_frames import reproject_frame
    from meteorprep.astrometry.solve import star_fwhm_px
    from tests.conftest import centroid

    shape = (500, 700)
    f = 2443.0 * shape[1] / 5472.0
    scale = np.rad2deg(np.arctan(1.0 / f))
    base = build_tan_wcs(0.0, 55.0, scale, shape)
    src = propagate_wcs(base, 600.0)  # 10 minutes later

    rng = np.random.default_rng(1)
    stars_px_src = np.column_stack([rng.uniform(60, shape[1] - 60, 25),
                                    rng.uniform(60, shape[0] - 60, 25)])
    img = np.zeros(shape, np.float32)
    sig = 1.5
    for x, y in stars_px_src:
        yy, xx = np.mgrid[int(y) - 8:int(y) + 9, int(x) - 8:int(x) + 9]
        img[yy, xx] += 30000 * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * sig ** 2))

    arr, foot = reproject_frame(img, src, base, shape, quality=True)

    errs, fwhms = [], []
    for x, y in stars_px_src:
        world = src.pixel_to_world_values(x, y)
        bx, by = base.world_to_pixel_values(*world)
        if not (20 < bx < shape[1] - 20 and 20 < by < shape[0] - 20):
            continue
        cxm, cym = centroid(arr, float(bx), float(by))
        errs.append(np.hypot(cxm - bx, cym - by))
        fwhms.append(star_fwhm_px(arr, np.array([[cxm, cym]])))
    assert len(errs) >= 10
    rms = float(np.sqrt(np.mean(np.square(errs))))
    assert rms < 0.1
    fwhm_in = 2.3548 * sig
    assert np.nanmedian(fwhms) - fwhm_in < 0.3
