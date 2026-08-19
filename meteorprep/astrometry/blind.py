"""Fully automatic ("lost-in-space") plate solving — no pointing hints, no
network.

Real star-tracker geometry, correct at any field width: detected stars are
back-projected through the known plate scale into unit vectors on the
celestial sphere, so a bright image pair's *angular* separation can be
compared against catalog pair separations exactly (projection-free).  Each
matching pair hypothesis fixes the full 3D camera attitude (TRIAD), the
catalog is projected through that exact attitude, and every other detected
star votes.  A winning hypothesis is polished by re-centering the TAN fit
on its own solution.  Runs in seconds, pure numpy.

(The previous approach — 2D rotation+translation about coarse sphere-grid
tangent points — breaks on ultra-wide fields: two gnomonic projections
with tangent points even a few degrees apart differ by far more than the
vote tolerance at the field edges.  Diagnosed on real 105-degree frames.)
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

from meteorprep.astrometry.solve import (SolveResult, detect_stars,
                                         fit_tan_wcs, solve_rms_px)

log = logging.getLogger("meteorprep")

DATA_DIR = Path(__file__).parent.parent / "data"


def load_bright_catalog(mag_limit: float = 6.5) -> np.ndarray:
    """(N, 3+) ra_deg, dec_deg, vmag[, temp_K] — brightest first."""
    cat = np.load(DATA_DIR / "bright_stars.npy")
    return cat[cat[:, 2] <= mag_limit]


def _unit_vectors(radec: np.ndarray) -> np.ndarray:
    ra = np.deg2rad(radec[:, 0])
    dec = np.deg2rad(radec[:, 1])
    return np.stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra),
                     np.sin(dec)], axis=1)


def _camera_vectors(xy: np.ndarray, cx: float, cy: float,
                    tan_per_px: float) -> np.ndarray:
    """Pixel coords -> unit vectors in the camera frame (+z boresight).
    Exact inverse gnomonic: the optical axis is the *frame center*, which
    is known — unlike the pointing."""
    xt = (xy[:, 0] - cx) * tan_per_px
    yt = (xy[:, 1] - cy) * tan_per_px
    v = np.stack([xt, yt, np.ones_like(xt)], axis=1)
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def _dedupe(stars: np.ndarray, radius_px: float = 8.0) -> np.ndarray:
    """Drop near-duplicate detections (keep the earlier = brighter one)."""
    if len(stars) < 2:
        return stars
    keep = []
    for i, s in enumerate(stars):
        if all(np.hypot(*(s - stars[j])) > radius_px for j in keep):
            keep.append(i)
    return stars[keep]


def blind_solve(image: np.ndarray, pixel_scale_deg: float,
                catalog_radec: np.ndarray | None = None,
                n_image_stars: int = 42, n_pair_stars: int = 10,
                pair_mag_limit: float = 3.6,
                min_votes: int = 10, vote_tol_px: float = 12.0,
                accept_rms_px: float = 2.0,
                undistort=None, stars_xy: np.ndarray | None = None,
                progress_cb=None) -> SolveResult | None:
    """Solve with no prior pointing.

    ``catalog_radec``: (N, >=3) with ra, dec, vmag, brightest first;
    defaults to the bundled naked-eye catalog.  ``stars_xy`` skips the
    internal star detection (already-cleaned centroids, brightest first).
    """
    if catalog_radec is None:
        catalog_radec = load_bright_catalog()
    cat = np.asarray(catalog_radec, dtype=float)

    if stars_xy is None:
        # elongation gate drops satellite/plane streaks; trailed stars on a
        # fixed tripod stay below ~2, streaks are >>3
        stars = detect_stars(image, max_stars=n_image_stars,
                             max_elongation=3.0)
    else:
        stars = np.asarray(stars_xy, dtype=float)
    stars = _dedupe(stars)[:n_image_stars]
    log.info("blind solve: %d stars detected in the reference frame",
             len(stars))
    if len(stars) < min_votes:
        log.warning("blind solve: too few stars (%d < %d) — clouds, trees "
                    "or heavy light pollution in the reference frame?",
                    len(stars), min_votes)
        return None
    if undistort is not None:
        stars = undistort(stars)
    h, w = image.shape[:2]
    cx, cy = (w - 1) / 2.0, (h - 1) / 2.0
    diag = float(np.hypot(w, h))
    tan_per_px = np.tan(np.deg2rad(pixel_scale_deg))
    half_diag_rad = np.arctan(tan_per_px * diag / 2.0)

    star_tree = cKDTree(stars)
    img_vec = _camera_vectors(stars, cx, cy, tan_per_px)

    # --- catalog pair table: separations among the all-sky brightest ---
    if cat.shape[1] >= 3:
        pool = cat[cat[:, 2] <= pair_mag_limit]
        if len(pool) < 40:          # sparse custom catalogs: take brightest
            pool = cat[:60]
    else:
        pool = cat[:60]
    pool_vec = _unit_vectors(pool)
    n_pool = len(pool)
    ii, jj = np.triu_indices(n_pool, k=1)
    cos_sep = np.einsum("ij,ij->i", pool_vec[ii], pool_vec[jj])
    sep = np.arccos(np.clip(cos_sep, -1.0, 1.0))
    within = sep < 2.05 * half_diag_rad
    ii, jj, sep = ii[within], jj[within], sep[within]
    order = np.argsort(sep)
    ii, jj, sep = ii[order], jj[order], sep[order]

    cat_vec = _unit_vectors(cat[:, :2])
    bright_vec = pool_vec                     # coarse-vote subset
    cos_cap = np.cos(min(half_diag_rad * 1.05, np.deg2rad(80)))

    # 3D tree over the bright pool for the vectorized coarse vote: an image
    # star rotated into the sky must land on SOME bright catalog star
    pool_tree = cKDTree(pool_vec)
    n_coarse = min(15, len(stars))
    coarse_tol_chord = max(1.5 * vote_tol_px * tan_per_px, np.deg2rad(0.25))
    coarse_need = 5

    n_pair = min(n_pair_stars, len(stars))
    pair_idx = [(a, b) for a in range(n_pair) for b in range(a + 1, n_pair)]
    best_result = None
    best_votes = 0
    n_hyp = 0
    for hyp_no, (ia, ib) in enumerate(pair_idx):
        if progress_cb is not None:
            progress_cb(hyp_no / max(len(pair_idx), 1))
        a, b = img_vec[ia], img_vec[ib]
        d_img = float(np.arccos(np.clip(a @ b, -1.0, 1.0)))
        if d_img < 0.05 * half_diag_rad:      # too close: attitude ill-set
            continue
        # separation gate: exact angles; tolerance covers centroid error,
        # residual distortion and a modestly wrong plate-scale guess
        tol = 0.025 * d_img + np.deg2rad(0.25)
        lo = np.searchsorted(sep, d_img - tol)
        hi = np.searchsorted(sep, d_img + tol)
        if hi <= lo:
            continue
        # both assignments (p,q) and (q,p) for every candidate pair
        pi = np.concatenate([ii[lo:hi], jj[lo:hi]])
        qi = np.concatenate([jj[lo:hi], ii[lo:hi]])
        P, Q = pool_vec[pi], pool_vec[qi]
        # batch TRIAD: camera triad is fixed for this image pair
        c1 = np.cross(a, b)
        n1 = np.linalg.norm(c1)
        if n1 < 1e-8:
            continue
        t2 = c1 / n1
        t3 = np.cross(a, t2)
        C2 = np.cross(P, Q)
        n2 = np.linalg.norm(C2, axis=1)
        okc = n2 > 1e-8
        P, Q, C2, n2, pi, qi = P[okc], Q[okc], C2[okc], n2[okc], pi[okc], qi[okc]
        if not len(P):
            continue
        S2 = C2 / n2[:, None]
        S3 = np.cross(P, S2)
        # R_k = p_k a^T + s2_k t2^T + s3_k t3^T   (sky <- camera)
        R = (np.einsum("ki,j->kij", P, a)
             + np.einsum("ki,j->kij", S2, t2)
             + np.einsum("ki,j->kij", S3, t3))
        n_hyp += len(R)
        # coarse vote, fully vectorized: rotate the brightest image stars
        # into the sky and demand several land on bright catalog stars
        U = np.einsum("kij,mj->kmi", R, img_vec[:n_coarse])
        dch, _ = pool_tree.query(U.reshape(-1, 3),
                                 distance_upper_bound=coarse_tol_chord)
        score = np.isfinite(dch).reshape(len(R), n_coarse).sum(axis=1)
        cand_order = np.nonzero(score >= coarse_need)[0]
        cand_order = cand_order[np.argsort(-score[cand_order])][:50]
        for k in cand_order:
            Rk = R[k]
            # full vote with the whole catalog through the exact attitude
            vf = cat_vec @ Rk
            cap = vf[:, 2] > cos_cap
            pxf = cx + vf[cap, 0] / vf[cap, 2] / tan_per_px
            pyf = cy + vf[cap, 1] / vf[cap, 2] / tan_per_px
            inwf = ((pxf > -0.05 * w) & (pxf < 1.05 * w)
                    & (pyf > -0.05 * h) & (pyf < 1.05 * h))
            if inwf.sum() < min_votes:
                continue
            pred = np.column_stack([pxf[inwf], pyf[inwf]])
            world = cat[cap][inwf][:, :2]
            dist, nn = star_tree.query(pred,
                                       distance_upper_bound=vote_tol_px)
            sel = np.isfinite(dist)
            votes_for = nn[sel]
            uniq = len(np.unique(votes_for))
            if uniq > best_votes:
                best_votes = uniq
            if uniq < min_votes:
                continue
            # matched correspondences -> exact TAN fit about the
            # hypothesis boresight, then re-centered on its own solution
            bs = Rk @ np.array([0.0, 0.0, 1.0])
            crval = (float(np.rad2deg(np.arctan2(bs[1], bs[0]))) % 360.0,
                     float(np.rad2deg(np.arcsin(np.clip(bs[2], -1, 1)))))
            fitted = fit_tan_wcs(stars[votes_for], world[sel], crval)
            if fitted is None:
                continue
            fitted = _iterate_recenter(stars, cat, fitted, (cx, cy))
            if fitted is None:
                continue
            rms, n_tight = solve_rms_px(fitted, stars, cat[:, :2],
                                        match_tol_px=3.0)
            if n_tight >= max(min_votes, 12) and rms < accept_rms_px:
                c = fitted.pixel_to_world_values(cx, cy)
                log.info("blind solve: center RA %.1f Dec %.1f, "
                         "%d stars, rms %.2f px (%d hypotheses)",
                         float(c[0]), float(c[1]), n_tight, rms, n_hyp)
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
    # Report the number that actually decided the outcome.  Quoting the
    # coarse vote count here read as "best got 15 votes of the 10 needed"
    # followed by a failure, which is nonsense to anyone reading the log:
    # the votes only pick hypotheses, the tight star matches decide.
    if best_result is not None:
        log.warning("blind solve: the best fit matched only %d stars "
                    "tightly (%d needed, rms %.2f px) — the reference "
                    "frame may show too little clear sky",
                    best_result.n_matched, min_votes, best_result.rms_px)
    else:
        log.warning("blind solve: no attitude hypothesis reached the vote "
                    "threshold (best got %d of the %d needed) — the "
                    "reference frame may show too little clear sky",
                    best_votes, min_votes)
    return None


def _iterate_recenter(stars, catalog, wcs, center_px, rounds=3):
    """Re-center the TAN fit on its own solution: the initial fit's tangent
    point comes from the pair hypothesis and can sit a few degrees off,
    which a fixed-CRVAL affine cannot fully absorb over a very wide field."""
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
