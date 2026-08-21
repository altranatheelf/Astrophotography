"""Plate solving and timestamp propagation (§4.3-§4.4).

Given a seed WCS — which every frame after the first has, because the
previous solve propagated by the sidereal rotation is one — the chain is:

1. **Seeded refinement against the bundled catalogue**: match detected
   stars to the local star map and least-squares fit a fresh TAN(+SIP)
   WCS with ``astropy.wcs.utils.fit_wcs_from_points``.  Offline, fast,
   and empirically the strongest on the ultra-wide fields this tool is
   for, so it goes first rather than last.
2. **twirl** (MIT, pure Python, Gaia asterisms), seeded from that same
   centre and field of view.  Needs the network.
3. **local astrometry.net** ``solve-field`` (GPL — invoked as a
   subprocess, never linked), scale-bracketed around the known plate
   scale, and only when the caller passed a file to hand it.

With no seed at all — the first frame of a folder — the blind search in
``blind.py`` establishes one from the bundled bright-star catalogue,
and the chain above takes over from there.

**Propagation** (``propagate_wcs``) copies a solved WCS and advances
CRVAL1 by the sidereal rate times the time difference, which is exact for
a fixed tripod; those frames are marked ``wcs_source="propagated"``.

Only a sparse subset (every K-th frame) is fully solved.  The rest are
propagated from the nearest solved frame and then verified against a
star-residual check, and any frame that fails the check is solved
properly after all.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from astropy.wcs import WCS
from astropy.wcs.utils import fit_wcs_from_points
from astropy.coordinates import SkyCoord
import astropy.units as u
from scipy.spatial import cKDTree

from meteorprep.config import SIDEREAL_DEG_PER_SEC

log = logging.getLogger("meteorprep")


@dataclass
class SolveResult:
    wcs: WCS
    rms_px: float
    n_matched: int
    source: str  # "twirl" | "astrometry.net" | "refine" | "propagated"
    ok: bool = True
    notes: dict = field(default_factory=dict)


# ----------------------------------------------------------------------
# Star detection (for solving and for residual verification)
# ----------------------------------------------------------------------

def detect_stars(image: np.ndarray, max_stars: int = 200,
                 threshold_sigma: float = 5.0, sky_mask: np.ndarray | None = None,
                 min_area: int = 2,
                 max_elongation: float | None = None) -> np.ndarray:
    """Centroid bright point sources; returns (N, 2) array of (x, y),
    brightest first.  ``sky_mask`` (bool, True = sky) restricts detection to
    the sky region so trees/obelisks don't produce false sources.
    ``max_elongation`` drops elongated sources (satellite/plane streaks:
    >>3; sidereally-trailed stars stay below ~2)."""
    import cv2

    img = np.asarray(image, np.float32)
    if img.ndim == 3:
        img = img.mean(axis=2)
    bg = cv2.medianBlur(img, 5)
    resid = img - bg
    # The noise level is one number.  Measuring it across all twenty
    # million pixels of a full-size canvas cost 2.2s of two medians; a
    # 1-in-16 sample of the same residual gives 24.71003 where the whole
    # frame gives 24.710007, for 0.04s.  Kept exact on small images,
    # where the sample would be thin and the saving would be nothing.
    stat = resid[::4, ::4] if resid.size > 1_000_000 else resid
    sigma = 1.4826 * np.median(np.abs(stat - np.median(stat))) + 1e-9
    mask = (resid > threshold_sigma * sigma).astype(np.uint8)
    if sky_mask is not None:
        mask &= sky_mask.astype(np.uint8)
    n, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, 8)
    if n <= 1:
        return np.empty((0, 2), dtype=float)
    # single-pass weighted moments per component (bincount, O(masked px));
    # a per-component `labels == i` scan is O(components x image) and takes
    # minutes on a real high-ISO frame with tens of thousands of components
    ys, xs = np.nonzero(mask)
    labs = labels[ys, xs]
    fl = resid[ys, xs].astype(np.float64)
    flux = np.bincount(labs, weights=fl, minlength=n)
    sx = np.bincount(labs, weights=xs * fl, minlength=n)
    sy = np.bincount(labs, weights=ys * fl, minlength=n)
    with np.errstate(divide="ignore", invalid="ignore"):
        cxs = sx / flux
        cys = sy / flux
    keep = (stats[:, cv2.CC_STAT_AREA] >= min_area) & (flux > 0)
    keep[0] = False                    # background label
    if max_elongation is not None:
        sxx = np.bincount(labs, weights=xs * xs * fl, minlength=n)
        syy = np.bincount(labs, weights=ys * ys * fl, minlength=n)
        sxy = np.bincount(labs, weights=xs * ys * fl, minlength=n)
        with np.errstate(divide="ignore", invalid="ignore"):
            vxx = sxx / flux - cxs ** 2
            vyy = syy / flux - cys ** 2
            vxy = sxy / flux - cxs * cys
        tr = vxx + vyy
        det = vxx * vyy - vxy * vxy
        disc = np.sqrt(np.maximum(tr * tr / 4.0 - det, 0.0))
        l1 = np.maximum(tr / 2.0 + disc, 1e-6)
        l2 = np.maximum(tr / 2.0 - disc, 1e-6)
        keep &= np.sqrt(l1 / l2) <= max_elongation
    idx = np.nonzero(keep)[0]
    idx = idx[np.argsort(-flux[idx])][:max_stars]
    return np.column_stack([cxs[idx], cys[idx]]).astype(float).reshape(-1, 2)


def star_fwhm_px(image: np.ndarray, xy: np.ndarray, box: int = 7) -> float:
    """Median FWHM of point sources (moment-based), for sharpness ranking."""
    img = image.astype(np.float32)
    if img.ndim == 3:
        img = img.mean(axis=2)
    h, w = img.shape
    fwhms = []
    r = box // 2
    for x, y in np.atleast_2d(xy)[:50]:
        xi, yi = int(round(x)), int(round(y))
        if not (r <= xi < w - r and r <= yi < h - r):
            continue
        patch = img[yi - r:yi + r + 1, xi - r:xi + r + 1].astype(float)
        patch = patch - patch.min()
        tot = patch.sum()
        if tot <= 0:
            continue
        yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
        var = ((xx ** 2 + yy ** 2) * patch).sum() / tot / 2.0
        fwhms.append(2.3548 * np.sqrt(max(var, 1e-6)))
    return float(np.median(fwhms)) if fwhms else float("nan")


# ----------------------------------------------------------------------
# WCS helpers
# ----------------------------------------------------------------------

def build_tan_wcs(center_ra_deg: float, center_dec_deg: float,
                  pixel_scale_deg: float, shape_hw: tuple[int, int],
                  rotation_deg: float = 0.0, flip_x: bool = False) -> WCS:
    h, w = shape_hw
    wcs = WCS(naxis=2)
    wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    wcs.wcs.crval = [center_ra_deg, center_dec_deg]
    wcs.wcs.crpix = [(w + 1) / 2.0, (h + 1) / 2.0]  # FITS 1-based center
    a = np.deg2rad(rotation_deg)
    sx = -pixel_scale_deg if flip_x else pixel_scale_deg
    wcs.wcs.cd = np.array([[sx * np.cos(a), -pixel_scale_deg * np.sin(a)],
                           [sx * np.sin(a), pixel_scale_deg * np.cos(a)]])
    return wcs


def propagate_wcs(wcs: WCS, dt_seconds: float) -> WCS:
    """Advance a solved WCS by the sidereal rotation about the pole.

    For a fixed tripod the sky configuration relative to the camera is
    congruent under rotation about the celestial pole, so the propagated
    WCS is the solved WCS with CRVAL1 advanced by the sidereal rate; the
    CD matrix (orientation relative to local north at CRVAL) is unchanged.
    """
    out = wcs.deepcopy()
    out.wcs.crval = [
        (wcs.wcs.crval[0] + SIDEREAL_DEG_PER_SEC * dt_seconds) % 360.0,
        wcs.wcs.crval[1],
    ]
    return out


def solve_rms_px(wcs: WCS, star_xy: np.ndarray, catalog_radec: np.ndarray,
                 match_tol_px: float = 10.0) -> tuple[float, int]:
    """RMS pixel residual between detected stars and catalog through wcs."""
    if len(star_xy) == 0 or len(catalog_radec) == 0:
        return float("inf"), 0
    pred = np.column_stack(wcs.world_to_pixel_values(catalog_radec[:, 0],
                                                     catalog_radec[:, 1]))
    good = np.isfinite(pred).all(axis=1)
    pred = pred[good]
    if len(pred) == 0:
        return float("inf"), 0
    tree = cKDTree(pred)
    dist, _ = tree.query(star_xy, distance_upper_bound=match_tol_px)
    matched = dist[np.isfinite(dist)]
    if len(matched) == 0:
        return float("inf"), 0
    return float(np.sqrt(np.mean(matched ** 2))), int(len(matched))


# ----------------------------------------------------------------------
# Solvers
# ----------------------------------------------------------------------

def _standard_coords_deg(radec: np.ndarray, crval) -> np.ndarray:
    """Exact gnomonic standard coordinates (xi, eta) in degrees about the
    tangent point ``crval`` — same mapping as the §4.1 oracle."""
    ra = np.deg2rad(radec[:, 0])
    dec = np.deg2rad(radec[:, 1])
    ra0, dec0 = np.deg2rad(crval[0]), np.deg2rad(crval[1])
    s = np.stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra),
                  np.sin(dec)], axis=1)
    t = np.array([np.cos(dec0) * np.cos(ra0), np.cos(dec0) * np.sin(ra0),
                  np.sin(dec0)])
    e_east = np.array([-np.sin(ra0), np.cos(ra0), 0.0])
    e_north = np.cross(t, e_east)
    d = s @ t
    with np.errstate(divide="ignore", invalid="ignore"):
        xi = np.rad2deg((s @ e_east) / d)
        eta = np.rad2deg((s @ e_north) / d)
    xi[d <= 1e-9] = np.nan
    eta[d <= 1e-9] = np.nan
    return np.column_stack([xi, eta])


def fit_tan_wcs(star_xy: np.ndarray, world_radec: np.ndarray, crval) -> WCS | None:
    """Closed-form TAN fit: with a fixed tangent point (CRVAL), the mapping
    pixel -> standard coordinates is *exactly* affine, so a single linear
    least squares recovers CD and CRPIX — no iterative solver to blow up on
    a 97-degree field (astropy's ``fit_wcs_from_points`` does)."""
    std = _standard_coords_deg(world_radec, crval)
    ok = np.isfinite(std).all(axis=1)
    if ok.sum() < 4:
        return None
    A = np.column_stack([star_xy[ok], np.ones(ok.sum())])       # (N, 3)
    M, *_ = np.linalg.lstsq(A, std[ok], rcond=None)             # (3, 2)
    cd = M[:2].T                                                # (2, 2)
    try:
        # xi = 0 at pixel crpix - 1 (FITS 1-based):  cd @ p0 + M[2] = 0
        p0 = np.linalg.solve(cd, -M[2])
    except np.linalg.LinAlgError:
        return None
    wcs = WCS(naxis=2)
    wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    wcs.wcs.crval = [float(crval[0]), float(crval[1])]
    wcs.wcs.crpix = [float(p0[0]) + 1.0, float(p0[1]) + 1.0]
    wcs.wcs.cd = cd
    return wcs


def refine_wcs(star_xy: np.ndarray, catalog_radec: np.ndarray, seed_wcs: WCS,
               sip_order: int | None = None, match_tol_px: float = 25.0,
               min_matches: int = 8) -> SolveResult | None:
    """Seed-matched star/catalog pairs -> exact TAN fit (+ optional SIP
    refinement, kept only when it actually improves the residual)."""
    pred = np.column_stack(seed_wcs.world_to_pixel_values(catalog_radec[:, 0],
                                                          catalog_radec[:, 1]))
    good = np.isfinite(pred).all(axis=1)
    idx_good = np.nonzero(good)[0]
    if len(idx_good) < min_matches or len(star_xy) == 0:
        return None
    tree = cKDTree(pred[good])
    dist, nn = tree.query(star_xy, distance_upper_bound=match_tol_px)
    sel = np.isfinite(dist)
    if sel.sum() < min_matches:
        return None
    mx = star_xy[sel]
    mw = catalog_radec[idx_good[nn[sel]]]

    crval = (float(seed_wcs.wcs.crval[0]), float(seed_wcs.wcs.crval[1]))
    fitted = fit_tan_wcs(mx, mw, crval)
    if fitted is None:
        return None
    # second pass: re-match through the fitted WCS with a tight tolerance
    result = SolveResult(wcs=fitted, rms_px=float("inf"), n_matched=0,
                         source="refine")
    pred2 = np.column_stack(fitted.world_to_pixel_values(catalog_radec[:, 0],
                                                         catalog_radec[:, 1]))
    good2 = np.isfinite(pred2).all(axis=1)
    tree2 = cKDTree(pred2[good2])
    dist2, nn2 = tree2.query(star_xy, distance_upper_bound=5.0)
    sel2 = np.isfinite(dist2)
    if sel2.sum() >= min_matches:
        mx2 = star_xy[sel2]
        mw2 = catalog_radec[np.nonzero(good2)[0][nn2[sel2]]]
        refit = fit_tan_wcs(mx2, mw2, crval)
        if refit is not None:
            fitted = refit
            result.wcs = fitted
            mx, mw = mx2, mw2
    result.rms_px, result.n_matched = solve_rms_px(fitted, star_xy,
                                                   catalog_radec)

    # optional SIP refinement for real lenses; astropy's fitter is fragile
    # over very wide fields, so keep it only when it helps
    if sip_order:
        try:
            world = SkyCoord(ra=mw[:, 0] * u.deg, dec=mw[:, 1] * u.deg)
            sip = fit_wcs_from_points((mx[:, 0], mx[:, 1]), world,
                                      projection="TAN", sip_degree=sip_order)
            rms_sip, n_sip = solve_rms_px(sip, star_xy, catalog_radec)
            if np.isfinite(rms_sip) and rms_sip < result.rms_px:
                result = SolveResult(wcs=sip, rms_px=rms_sip, n_matched=n_sip,
                                     source="refine")
        except Exception as exc:
            log.debug("SIP refinement skipped: %s", exc)
    return result


def try_twirl(star_xy: np.ndarray, center_radec: tuple[float, float],
              fov_deg: float, shape_hw: tuple[int, int]) -> SolveResult | None:
    """Primary solver: twirl (MIT) with Gaia asterism matching.  Requires
    network access for the Gaia query; returns None when unavailable."""
    try:
        import twirl
    except ImportError:
        return None
    try:
        center = SkyCoord(ra=center_radec[0] * u.deg, dec=center_radec[1] * u.deg)
        gaia = twirl.gaia_radecs(center, 1.2 * fov_deg * u.deg, limit=200)
        gaia = twirl.geometry.sparsify(gaia, 0.01)
        wcs = twirl.compute_wcs(star_xy, gaia[:30], tolerance=10)
        rms, n = solve_rms_px(wcs, star_xy, gaia)
        return SolveResult(wcs=wcs, rms_px=rms, n_matched=n, source="twirl")
    except Exception as exc:
        log.warning("twirl solve failed: %s", exc)
        return None


def try_astrometry_net(image_path: Path, pixel_scale_arcsec: float,
                       timeout_s: int = 300) -> SolveResult | None:
    """Fallback: local astrometry.net ``solve-field`` as a subprocess (GPL —
    never linked).  Scale-bracketed around the known plate scale, downsample
    2; for very wide fields astrometry.net guidance is to solve a center
    crop where TAN error is small."""
    exe = shutil.which("solve-field")
    if exe is None:
        return None
    with tempfile.TemporaryDirectory() as td:
        cmd = [exe, str(image_path), "--overwrite", "--no-plots",
               "--downsample", "2",
               "--scale-units", "arcsecperpix",
               "--scale-low", f"{pixel_scale_arcsec * 0.8:.2f}",
               "--scale-high", f"{pixel_scale_arcsec * 1.2:.2f}",
               "--dir", td, "--new-fits", "none", "--wcs", "solved.wcs"]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=timeout_s)
            from astropy.io import fits
            with fits.open(Path(td) / "solved.wcs") as hdul:
                wcs = WCS(hdul[0].header)
            return SolveResult(wcs=wcs, rms_px=float("nan"), n_matched=0,
                               source="astrometry.net")
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired,
                FileNotFoundError, OSError) as exc:
            log.warning("solve-field failed: %s", exc)
            return None


def solve_frame(image: np.ndarray, seed_wcs: WCS | None,
                catalog_radec: np.ndarray | None, cfg,
                image_path: Path | None = None,
                sky_mask: np.ndarray | None = None,
                undistort=None) -> SolveResult | None:
    """Full solver chain for one frame.  ``undistort`` is an optional
    callable mapping observed centroid coords to ideal coords (§4.2)."""
    stars = detect_stars(image, sky_mask=sky_mask)
    if len(stars) < cfg.solve_min_stars:
        log.info("only %d stars detected (< %d): deferring to propagation",
                 len(stars), cfg.solve_min_stars)
        return None
    if undistort is not None:
        stars = undistort(stars)

    h, w = image.shape[:2]
    pixel_scale_deg = None
    if seed_wcs is not None:
        pixel_scale_deg = float(np.sqrt(abs(np.linalg.det(
            seed_wcs.pixel_scale_matrix))))
        # local catalog refinement first: offline, fast, and empirically
        # the strongest on ultra-wide fields; twirl (network Gaia query)
        # only as a fallback
        if catalog_radec is not None:
            result = refine_wcs(stars, catalog_radec, seed_wcs,
                                sip_order=cfg.sip_order)
            if result and result.rms_px <= cfg.solve_rms_max_px:
                return result
        fov_deg = max(h, w) * pixel_scale_deg
        center = seed_wcs.pixel_to_world(w / 2.0, h / 2.0)
        result = try_twirl(stars, (center.ra.deg, center.dec.deg), fov_deg, (h, w))
        if result and result.rms_px <= cfg.solve_rms_max_px:
            return result
    if image_path is not None:
        scale_arcsec = (pixel_scale_deg or 84.4 / 3600.0) * 3600.0
        result = try_astrometry_net(image_path, scale_arcsec)
        if result:
            if catalog_radec is not None:
                result.rms_px, result.n_matched = solve_rms_px(
                    result.wcs, stars, catalog_radec)
            return result
    return None
