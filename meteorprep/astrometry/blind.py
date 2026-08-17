"""Fully automatic ("lost-in-space") plate solving — no pointing hints, no
network.

Star-tracker approach, adapted for a very wide field: the plate scale is
known from the lens, so a single correspondence between one bright *pair*
of detected stars and one catalog pair of the same projected separation
fixes rotation, translation and parity at once.  For each coarse pointing
on a sphere grid we project the bundled naked-eye catalog (Yale Bright
Star Catalog, ~9k stars, 106 KB), enumerate pair hypotheses among the
brightest stars, and let every other star vote.  A winning hypothesis is
polished by iteratively re-centering the TAN fit on its own solution.
Runs in seconds, pure numpy.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

from meteorprep.astrometry.solve import (SolveResult, _standard_coords_deg,
                                         detect_stars, fit_tan_wcs,
                                         solve_rms_px)

log = logging.getLogger("meteorprep")

DATA_DIR = Path(__file__).parent.parent / "data"


def load_bright_catalog(mag_limit: float = 6.5) -> np.ndarray:
    """(N, 3) ra_deg, dec_deg, vmag — brightest first."""
    cat = np.load(DATA_DIR / "bright_stars.npy")
    return cat[cat[:, 2] <= mag_limit]


def _fibonacci_sphere(n: int) -> np.ndarray:
    k = np.arange(n, dtype=float)
    golden = (1 + 5 ** 0.5) / 2
    ra = (360.0 * k / golden) % 360.0
    dec = np.rad2deg(np.arcsin(2 * (k + 0.5) / n - 1))
    return np.column_stack([ra, dec])


def _iterate_recenter(stars, catalog, wcs, center_px, rounds=3):
    """Re-center the TAN fit on its own solution: the pair hypothesis was
    fit about a grid point up to ~20 deg from the true tangent point, which
    a fixed-CRVAL affine cannot fully absorb over a 97-deg field."""
    best = wcs
    for tol in (15.0, 6.0, 3.0)[:rounds]:
        c = best.pixel_to_world_values(center_px[0], center_px[1])
        crval = (float(c[0]), float(c[1]))
        pred = np.column_stack(best.world_to_pixel_values(catalog[:, 0],
                                                          catalog[:, 1]))
        good = np.isfinite(pred).all(axis=1)
        idx = np.nonzero(good)[0]
        if len(idx) < 8:
            return None
        tree = cKDTree(pred[good])
        dist, nn = tree.query(stars, distance_upper_bound=tol)
        sel = np.isfinite(dist)
        if sel.sum() < 8:
            return None
        fitted = fit_tan_wcs(stars[sel], catalog[idx[nn[sel]], :2], crval)
        if fitted is None:
            return None
        best = fitted
    return best


def blind_solve(image: np.ndarray, pixel_scale_deg: float,
                catalog_radec: np.ndarray | None = None,
                n_centers: int = 100, n_image_stars: int = 42,
                n_pair_stars: int = 9, n_cat_pair: int = 16,
                min_votes: int = 10, vote_tol_px: float = 10.0,
                accept_rms_px: float = 2.0,
                undistort=None) -> SolveResult | None:
    """Solve with no prior pointing.

    ``catalog_radec``: (N, 2) or (N, 3 with magnitude/brightness rank,
    brightest first); defaults to the bundled naked-eye catalog.
    """
    if catalog_radec is None:
        catalog_radec = load_bright_catalog()
    cat = np.asarray(catalog_radec, dtype=float)

    stars = detect_stars(image, max_stars=n_image_stars)
    if len(stars) < min_votes:
        return None
    if undistort is not None:
        stars = undistort(stars)
    h, w = image.shape[:2]
    cx, cy = (w - 1) / 2.0, (h - 1) / 2.0
    diag = float(np.hypot(w, h))
    half_diag_deg = np.rad2deg(np.arctan(
        np.tan(np.deg2rad(pixel_scale_deg)) * diag / 2.0))

    star_tree = cKDTree(stars)
    pair_stars = stars[:n_pair_stars]
    pair_idx = [(a, b) for a in range(len(pair_stars))
                for b in range(a + 1, len(pair_stars))]
    pair_d = {p: float(np.linalg.norm(pair_stars[p[0]] - pair_stars[p[1]]))
              for p in pair_idx}

    cat_unit = np.stack(
        [np.cos(np.deg2rad(cat[:, 1])) * np.cos(np.deg2rad(cat[:, 0])),
         np.cos(np.deg2rad(cat[:, 1])) * np.sin(np.deg2rad(cat[:, 0])),
         np.sin(np.deg2rad(cat[:, 1]))], axis=1)

    best_result = None
    for center in _fibonacci_sphere(n_centers):
        ra0, dec0 = float(center[0]), float(center[1])
        t = np.array([np.cos(np.deg2rad(dec0)) * np.cos(np.deg2rad(ra0)),
                      np.cos(np.deg2rad(dec0)) * np.sin(np.deg2rad(ra0)),
                      np.sin(np.deg2rad(dec0))])
        near = cat_unit @ t > np.cos(np.deg2rad(min(half_diag_deg * 1.1, 80)))
        if near.sum() < min_votes:
            continue
        sub = cat[near][:, :2]
        std = _standard_coords_deg(sub, (ra0, dec0))
        ok = np.isfinite(std).all(axis=1)
        sub, std = sub[ok], std[ok]
        proj = std / pixel_scale_deg          # catalog in pixel units
        inframe = ((np.abs(proj[:, 0]) < 0.75 * diag)
                   & (np.abs(proj[:, 1]) < 0.75 * diag))
        sub, proj = sub[inframe], proj[inframe]
        if len(sub) < min_votes:
            continue
        # brightest catalog stars for pair hypotheses (input is
        # brightest-first, preserved by boolean masking)
        cp = proj[:n_cat_pair]
        cat_pairs = [(a, b) for a in range(len(cp))
                     for b in range(a + 1, len(cp))]
        cat_pair_d = np.array([np.linalg.norm(cp[a] - cp[b])
                               for a, b in cat_pairs])

        for (ia, ib) in pair_idx:
            d_img = pair_d[(ia, ib)]
            close = np.abs(cat_pair_d - d_img) < 0.04 * d_img + 3.0
            if not close.any():
                continue
            A, B = pair_stars[ia], pair_stars[ib]
            v_img = B - A
            for k in np.nonzero(close)[0]:
                ca, cb = cat_pairs[k]
                for (c1, c2) in ((ca, cb), (cb, ca)):
                    for parity in (1.0, -1.0):
                        p1 = cp[c1] * [1.0, parity]
                        p2 = cp[c2] * [1.0, parity]
                        v_cat = p2 - p1
                        ang = (np.arctan2(v_img[1], v_img[0])
                               - np.arctan2(v_cat[1], v_cat[0]))
                        rot = np.array([[np.cos(ang), -np.sin(ang)],
                                        [np.sin(ang), np.cos(ang)]])
                        pred = (proj * [1.0, parity]) @ rot.T
                        pred += A - rot @ p1
                        infr = ((pred[:, 0] > -0.05 * w) & (pred[:, 0] < 1.05 * w)
                                & (pred[:, 1] > -0.05 * h) & (pred[:, 1] < 1.05 * h))
                        if infr.sum() < min_votes:
                            continue
                        dist, nn = star_tree.query(
                            pred[infr], distance_upper_bound=vote_tol_px)
                        sel = np.isfinite(dist)
                        if sel.sum() < min_votes:
                            continue
                        # one image star may not vote for two catalog stars
                        votes_for = nn[sel]
                        if len(np.unique(votes_for)) < min_votes:
                            continue
                        m_img = stars[votes_for]
                        m_world = sub[infr][sel]
                        fitted = fit_tan_wcs(m_img, m_world, (ra0, dec0))
                        if fitted is None:
                            continue
                        fitted = _iterate_recenter(stars, cat, fitted,
                                                   (cx, cy))
                        if fitted is None:
                            continue
                        rms, n_tight = solve_rms_px(fitted, stars,
                                                    cat[:, :2],
                                                    match_tol_px=3.0)
                        if (n_tight >= max(min_votes, 12)
                                and rms < accept_rms_px):
                            c = fitted.pixel_to_world_values(cx, cy)
                            log.info("blind solve: center RA %.1f Dec %.1f, "
                                     "%d stars, rms %.2f px",
                                     float(c[0]), float(c[1]), n_tight, rms)
                            return SolveResult(wcs=fitted, rms_px=rms,
                                               n_matched=int(n_tight),
                                               source="blind")
                        if (best_result is None
                                or n_tight > best_result.n_matched):
                            best_result = SolveResult(
                                wcs=fitted, rms_px=rms,
                                n_matched=int(n_tight), source="blind")
    if best_result is not None and best_result.n_matched >= min_votes:
        log.info("blind solve (best effort): %d stars, rms %.2f px",
                 best_result.n_matched, best_result.rms_px)
        return best_result
    return None
