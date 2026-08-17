"""Sky/ground segmentation (§5.2).

Classical method (default): model sky vs ground as two color/brightness
Gaussians seeded from the top and bottom of the frame (Ettinger-style),
refine with gradients and morphological closing, and enforce a
column-monotonic horizon (sky above, ground below).  An optional
ML fallback hook is provided for the hard tree-line case; when a model is
plugged in, its license must be recorded in the sidecar.  The boundary is
feathered (~3 px Gaussian) so branch gaps keep real sky.
"""

from __future__ import annotations

import logging

import cv2
import numpy as np

log = logging.getLogger("meteorprep")


def segment_sky_classical(rgb: np.ndarray, feather_px: float = 3.0) -> np.ndarray:
    """Return float32 (H, W) alpha in [0, 1]; 1 = sky."""
    img = rgb.astype(np.float32)
    lum = img.mean(axis=2) if img.ndim == 3 else img
    h, w = lum.shape

    # seed statistics from top and bottom bands
    top = lum[: h // 6, :]
    bot = lum[-h // 6:, :]
    mu_s, sd_s = float(top.mean()), float(top.std()) + 1e-3
    mu_g, sd_g = float(bot.mean()), float(bot.std()) + 1e-3

    if abs(mu_s - mu_g) < 0.25 * (sd_s + sd_g):
        # no distinguishable ground (all-sky frame): everything is sky
        return np.ones((h, w), np.float32)

    # per-pixel Gaussian likelihood ratio
    z_s = ((lum - mu_s) / sd_s) ** 2
    z_g = ((lum - mu_g) / sd_g) ** 2
    sky = (z_s < z_g).astype(np.uint8)

    # morphological cleanup then enforce a per-column horizon: sky is the
    # contiguous region from the top
    sky = cv2.morphologyEx(sky, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    sky = cv2.morphologyEx(sky, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    horizon = np.full(w, h, dtype=int)
    for c in range(w):
        col = sky[:, c]
        nz = np.nonzero(col == 0)[0]
        # first sustained ground run from the top
        run = 0
        for y in nz:
            if run and y == run_y + 1:
                run += 1
            else:
                run = 1
            run_y = y
            if run >= max(h // 50, 5):
                horizon[c] = y - run + 1
                break
    smooth = cv2.GaussianBlur(horizon.astype(np.float32).reshape(1, -1),
                              (0, 0), sigmaX=max(w / 200.0, 3)).ravel()
    mask = (np.arange(h)[:, None] < smooth[None, :]).astype(np.float32)
    # keep genuine sky holes (through branches) that the Gaussian model found
    mask = np.maximum(mask, sky.astype(np.float32) * (mask > 0).any() )
    mask = np.clip(mask, 0, 1)
    if feather_px > 0:
        mask = cv2.GaussianBlur(mask, (0, 0), feather_px)
    return mask.astype(np.float32)


def segment_sky(rgb: np.ndarray, ml_model=None, feather_px: float = 3.0) -> np.ndarray:
    """Dispatch: classical first; ``ml_model(rgb) -> (H, W) sky prob`` hook
    for the hard tree-through-branches case."""
    if ml_model is not None:
        try:
            prob = ml_model(rgb)
            mask = np.clip(prob.astype(np.float32), 0, 1)
            if feather_px > 0:
                mask = cv2.GaussianBlur(mask, (0, 0), feather_px)
            return mask
        except Exception as exc:
            log.warning("ML sky segmentation failed (%s); using classical", exc)
    return segment_sky_classical(rgb, feather_px=feather_px)
