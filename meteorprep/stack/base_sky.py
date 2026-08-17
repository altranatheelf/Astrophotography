"""Sigma-clipped point-star base construction (§5.1).

Combines reprojected, non-light-painted frames with sigma clipping, in
row bands to bound memory (§9.1).  Meteors are single-frame outliers so
clipping already rejects them, but every detected meteor's pixels are
additionally masked per contributing frame — belt and suspenders, so a
faint tail never leaks into the base.
"""

from __future__ import annotations

import numpy as np
from astropy.stats import sigma_clip


def stack_band(band: np.ndarray, sigma: float = 2.5, maxiters: int = 5,
               masks: np.ndarray | None = None) -> np.ndarray:
    """Sigma-clipped mean over axis 0 of (N, rows, W[, C]).
    ``masks`` (N, rows, W) True = exclude (meteor pixels / no coverage)."""
    data = np.ma.masked_invalid(band.astype(np.float32))
    if masks is not None:
        m = masks.astype(bool)
        if band.ndim == 4:
            m = m[..., None] | np.zeros(band.shape, dtype=bool)
        data = np.ma.masked_array(data, mask=data.mask | m)
    clipped = sigma_clip(data, sigma=sigma, maxiters=maxiters, axis=0)
    mean = clipped.mean(axis=0)
    return np.ma.filled(mean, 0.0).astype(np.float32)


def stack_frames(frame_loader, n_frames: int, shape, sigma: float = 2.5,
                 maxiters: int = 5, band_rows: int = 512,
                 mask_loader=None) -> np.ndarray:
    """Banded sigma-clipped stack.

    ``frame_loader(i)`` returns the i-th reprojected frame (H, W[, C]);
    ``mask_loader(i)`` returns an (H, W) bool exclusion mask or None.
    Frames are re-read per band; callers should memory-map (§9.1).
    """
    h = shape[0]
    out = None
    for r0 in range(0, h, band_rows):
        r1 = min(r0 + band_rows, h)
        band = np.stack([frame_loader(i)[r0:r1] for i in range(n_frames)])
        masks = None
        if mask_loader is not None:
            ms = [mask_loader(i) for i in range(n_frames)]
            if any(m is not None for m in ms):
                masks = np.stack([
                    (m[r0:r1] if m is not None
                     else np.zeros((r1 - r0, band.shape[2]), bool))
                    for m in ms])
        result = stack_band(band, sigma=sigma, maxiters=maxiters, masks=masks)
        if out is None:
            out = np.empty(shape, dtype=np.float32)
        out[r0:r1] = result
    return out
