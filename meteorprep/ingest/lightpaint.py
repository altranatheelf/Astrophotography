"""Light-painted frame detection (§2.4).

Uses the median luminance of the *ground* region only: a light-painted
panel spikes the foreground while the sky is unchanged.  Robust z-score
against a rolling window of neighbours.
"""

from __future__ import annotations

import numpy as np


def ground_luminance(lum: np.ndarray, sky_mask: np.ndarray | None) -> float:
    """Median luminance below the sky mask (whole frame when no mask yet)."""
    if sky_mask is None:
        # bottom third as a ground proxy until the real mask exists
        h = lum.shape[0]
        region = lum[int(2 * h / 3):, :]
    else:
        ground = ~sky_mask.astype(bool)
        if ground.sum() < 100:
            return float(np.median(lum))
        region = lum[ground]
    return float(np.median(region))


def flag_lightpainted(ground_medians: np.ndarray, window: int = 15,
                      lp_sigma: float = 4.0,
                      min_rel_increase: float = 0.2) -> np.ndarray:
    """Boolean flags: robust z-score vs rolling median of neighbours.

    ``min_rel_increase`` additionally requires a >= 20 % jump in ground
    luminance: light-painting is a dramatic effect, and without an absolute
    floor the z-score is hyper-sensitive when neighbouring medians are
    nearly identical (MAD -> 0)."""
    x = np.asarray(ground_medians, dtype=float)
    n = len(x)
    flags = np.zeros(n, dtype=bool)
    half = max(window // 2, 1)
    for i in range(n):
        lo, hi = max(0, i - half), min(n, i + half + 1)
        neigh = np.delete(x[lo:hi], i - lo)
        if len(neigh) < 3:
            continue
        med = np.median(neigh)
        mad = 1.4826 * np.median(np.abs(neigh - med)) + 1e-9
        flags[i] = ((x[i] - med) / mad > lp_sigma
                    and x[i] - med > min_rel_increase * max(med, 1e-9))
    return flags
