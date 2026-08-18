"""Lens barrel-distortion pre-correction of star *coordinates* (§4.2).

We undistort detected star centroids analytically (cheap, keeps stars
sharp) before plate solving; the full-image undistort is folded into the
single TAN reprojection resample.  Model: poly3 radial ``r_d = r_u (1 + k1 r_u^2)``
with radii normalised by the half-diagonal.  The k1 value comes from the
Lensfun database when ``lensfunpy`` is installed and the lens is found,
else from config (``lens_k1``), else bootstrapped from first-pass solve
residuals.  The EF 16-35 at 16 mm has ~3.6-4.26 % barrel distortion, far
too large to leave uncorrected before a TAN solve.
"""

from __future__ import annotations

import logging

import numpy as np

log = logging.getLogger("meteorprep")


def lookup_lensfun_k1(lens_model: str, focal_mm: float) -> float | None:
    """Best-effort k1 from the Lensfun DB; None when unavailable."""
    try:
        import lensfunpy
    except ImportError:
        return None
    try:
        db = lensfunpy.Database()
        lenses = db.find_lenses(None, None, lens_model, loose_search=True)
        if not lenses:
            return None
        calib = lenses[0].interpolate_distortion(focal_mm)
        if calib and calib.model == lensfunpy.DistortionModel.POLY3:
            return float(calib.terms[0])
    except Exception as exc:  # DB formats vary across versions
        log.warning("Lensfun lookup failed: %s", exc)
    return None


def estimate_k1(star_xy: np.ndarray, world_radec: np.ndarray,
                crval, shape_hw: tuple[int, int]) -> tuple[float, float, float]:
    """Self-calibrate the poly3 barrel term from matched stars: pick the k1
    whose undistortion lets a pure TAN fit the matches best.  Returns
    (k1, rms_before_px, rms_after_px).  No lens database needed — the sky
    itself is the calibration target."""
    from meteorprep.astrometry.solve import fit_tan_wcs

    def rms_for(k1: float) -> float:
        pts = (Poly3Distortion(k1, shape_hw).undistort(star_xy)
               if abs(k1) > 1e-9 else star_xy)
        wcs = fit_tan_wcs(pts, world_radec, crval)
        if wcs is None:
            return float("inf")
        pred = np.column_stack(wcs.world_to_pixel_values(world_radec[:, 0],
                                                         world_radec[:, 1]))
        ok = np.isfinite(pred).all(axis=1)
        if ok.sum() < 8:
            return float("inf")
        return float(np.sqrt(np.mean((pred[ok] - pts[ok]) ** 2)))

    grid = np.linspace(-0.20, 0.10, 31)
    r = np.array([rms_for(k) for k in grid])
    i = int(np.argmin(r))
    # parabolic refinement around the grid minimum
    fine = np.linspace(grid[max(i - 1, 0)], grid[min(i + 1, len(grid) - 1)], 21)
    rf = np.array([rms_for(k) for k in fine])
    j = int(np.argmin(rf))
    return float(fine[j]), float(rms_for(0.0)), float(rf[j])


class Poly3Distortion:
    """r_distorted = r_undistorted * (1 + k1 * r_undistorted^2), r in units
    of the half-diagonal.  k1 < 0 is barrel."""

    def __init__(self, k1: float, shape_hw: tuple[int, int],
                 center_xy: tuple[float, float] | None = None):
        self.k1 = float(k1)
        h, w = shape_hw
        self.cx, self.cy = center_xy if center_xy else ((w - 1) / 2.0, (h - 1) / 2.0)
        self.rnorm = float(np.hypot(w / 2.0, h / 2.0))

    def distort(self, xy: np.ndarray) -> np.ndarray:
        """Ideal (undistorted) -> observed (distorted) coordinates."""
        xy = np.atleast_2d(np.asarray(xy, dtype=float))
        d = xy - [self.cx, self.cy]
        r = np.linalg.norm(d, axis=1, keepdims=True) / self.rnorm
        return np.array([self.cx, self.cy]) + d * (1.0 + self.k1 * r ** 2)

    def undistort(self, xy: np.ndarray) -> np.ndarray:
        """Observed (distorted) -> ideal coordinates, by Newton iteration."""
        xy = np.atleast_2d(np.asarray(xy, dtype=float))
        d = xy - [self.cx, self.cy]
        rd = np.linalg.norm(d, axis=1, keepdims=True) / self.rnorm
        ru = rd.copy()
        for _ in range(8):
            f = ru * (1.0 + self.k1 * ru ** 2) - rd
            fp = 1.0 + 3.0 * self.k1 * ru ** 2
            ru = ru - f / fp
        scale = np.divide(ru, rd, out=np.ones_like(rd), where=rd > 1e-12)
        return np.array([self.cx, self.cy]) + d * scale

    def identity(self) -> bool:
        return abs(self.k1) < 1e-9
