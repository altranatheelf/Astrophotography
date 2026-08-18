"""Star-physics white balance — an offline take on Siril's 2024
Spectrophotometric Color Calibration (SPCC).

Every matched catalog star has a known effective temperature; Planck's law
gives its true colour through approximate camera passbands.  Comparing
predicted R/G and B/G ratios with the ratios actually measured in the
stacked base yields per-channel gains that make the *stars* physically
white-balanced — the sky is calibrated against the stars themselves, no
colour chart, no network, no guesswork.  Delivered as a hidden alternate
base layer and sidecar numbers, never baked in.
"""

from __future__ import annotations

import logging

import numpy as np

log = logging.getLogger("meteorprep")

# approximate consumer-camera passbands (nm): centre, sigma of Gaussian
BANDS = {"r": (600.0, 50.0), "g": (530.0, 45.0), "b": (465.0, 40.0)}
_WL = np.linspace(380.0, 720.0, 200)  # nm


def _planck(wl_nm: np.ndarray, temp_k: float) -> np.ndarray:
    wl = wl_nm * 1e-9
    c1, c2 = 3.7418e-16, 1.4388e-2
    return c1 / wl ** 5 / np.expm1(c2 / (wl * temp_k))


def predicted_ratios(temp_k: float) -> tuple[float, float]:
    """Expected (R/G, B/G) flux ratios for a blackbody of ``temp_k``
    through the approximate passbands, normalised so a 6500 K star is
    neutral (daylight-balanced camera)."""
    def band_flux(t, band):
        c, s = BANDS[band]
        resp = np.exp(-0.5 * ((_WL - c) / s) ** 2)
        return float(np.trapezoid(_planck(_WL, t) * resp, _WL))

    def ratios(t):
        g = band_flux(t, "g")
        return band_flux(t, "r") / g, band_flux(t, "b") / g

    rg, bg = ratios(temp_k)
    rg0, bg0 = ratios(6504.0)
    return rg / rg0, bg / bg0


def _aperture_flux(img: np.ndarray, x: float, y: float,
                   r_ap: int = 5, r_bg: int = 12) -> np.ndarray | None:
    """Background-subtracted RGB flux in a small aperture."""
    h, w = img.shape[:2]
    xi, yi = int(round(x)), int(round(y))
    if not (r_bg <= xi < w - r_bg and r_bg <= yi < h - r_bg):
        return None
    patch = img[yi - r_bg:yi + r_bg + 1, xi - r_bg:xi + r_bg + 1].astype(float)
    yy, xx = np.mgrid[-r_bg:r_bg + 1, -r_bg:r_bg + 1]
    rr = np.hypot(xx, yy)
    ann = (rr > r_ap + 1) & (rr <= r_bg)
    bg = np.median(patch[ann], axis=0)
    core = patch[rr <= r_ap] - bg
    flux = core.sum(axis=0)
    return flux if (flux > 0).all() else None


def star_white_balance(base_img: np.ndarray, wcs, catalog: np.ndarray,
                       max_stars: int = 150, min_stars: int = 20):
    """Fit per-channel gains from matched stars' physical colours.

    ``catalog``: (N, >=4) ra, dec, mag, temp_K (brightest first).
    Returns {"gains": [r, g, b], "n_stars": int} or None when there are
    too few usable stars (e.g. temperatures unavailable).
    """
    if catalog.shape[1] < 4:
        return None
    # skip the very brightest stars: their cores clip on any long exposure
    # and clipped cores lie about colour
    cat = catalog[(catalog[:, 3] > 2500.0) & (catalog[:, 2] > 2.0)][:800]
    if len(cat) < min_stars:
        return None
    px = np.column_stack(wcs.world_to_pixel_values(cat[:, 0], cat[:, 1]))
    good = np.isfinite(px).all(axis=1)
    cat, px = cat[good], px[good]

    h_img, w_img = base_img.shape[:2]

    def _snap(x, y, r_s=10):
        """Snap the WCS-predicted position onto the actual star peak —
        a few px of solve residual otherwise puts the tiny aperture on
        empty sky."""
        xi, yi = int(round(x)), int(round(y))
        if not (r_s <= xi < w_img - r_s and r_s <= yi < h_img - r_s):
            return None
        patch = base_img[yi - r_s:yi + r_s + 1, xi - r_s:xi + r_s + 1, 1]
        dy, dx = np.unravel_index(int(np.argmax(patch)), patch.shape)
        if float(patch[dy, dx]) >= 60000.0:   # clipped core: colour is lies
            return None
        return xi - r_s + dx, yi - r_s + dy

    rg_corr, bg_corr = [], []
    for (ra, dec, mag, temp), (x, y) in zip(cat, px):
        if len(rg_corr) >= max_stars:
            break
        snapped = _snap(x, y)
        if snapped is None:
            continue
        flux = _aperture_flux(base_img, snapped[0], snapped[1])
        if flux is None:
            continue
        meas_rg = flux[0] / flux[1]
        meas_bg = flux[2] / flux[1]
        pred_rg, pred_bg = predicted_ratios(float(temp))
        if 0.05 < meas_rg < 20 and 0.05 < meas_bg < 20:
            rg_corr.append(pred_rg / meas_rg)
            bg_corr.append(pred_bg / meas_bg)
    if len(rg_corr) < min_stars:
        log.info("star colour calibration: only %d usable stars; skipping",
                 len(rg_corr))
        return None
    gain_r = float(np.clip(np.median(rg_corr), 0.5, 2.0))
    gain_b = float(np.clip(np.median(bg_corr), 0.5, 2.0))
    log.info("star colour calibration from %d stars: R x%.3f  B x%.3f",
             len(rg_corr), gain_r, gain_b)
    return {"gains": [gain_r, 1.0, gain_b], "n_stars": len(rg_corr),
            "method": "blackbody_yale_bsc"}
