"""Running sigma-clipped median reference model (§3.2).

Frames must already be reprojected onto the base WCS (§3.3): once stars
occupy the same pixels across frames, the temporal median models the star
field and the transient meteor survives the difference.  Consecutive-frame
differencing is NOT used — with field rotation it registers star trails as
bright residuals and floods the Hough detector.
"""

from __future__ import annotations

import numpy as np
from astropy.stats import sigma_clip


def reference_model(stack_win: np.ndarray, sigma: float = 3.0,
                    maxiters: int = 3,
                    footprints: np.ndarray | None = None) -> np.ndarray:
    """Sigma-clipped temporal median of a (W, H, W_img) window.

    ``footprints`` (W, H, W_img) marks valid coverage; uncovered pixels are
    excluded from the statistics.
    """
    data = np.ma.masked_invalid(np.asarray(stack_win, dtype=np.float32))
    if footprints is not None:
        data = np.ma.masked_array(data, mask=data.mask | (footprints == 0))
    clipped = sigma_clip(data, sigma=sigma, maxiters=maxiters, axis=0)
    med = np.ma.median(clipped, axis=0)
    return np.ma.filled(med, 0.0).astype(np.float32)


class RunningReference:
    """Sliding-window reference over a sequence, excluding the current frame
    and any light-painted frames."""

    def __init__(self, frames: list[np.ndarray], window: int = 7,
                 sigma: float = 3.0, exclude: set[int] | None = None,
                 footprints: list[np.ndarray] | None = None):
        self.frames = frames
        self.window = window
        self.sigma = sigma
        self.exclude = exclude or set()
        self.footprints = footprints

    def for_frame(self, i: int) -> np.ndarray:
        n = len(self.frames)
        half = max(self.window // 2, 1)
        idx = [j for j in range(max(0, i - half), min(n, i + half + 1))
               if j != i and j not in self.exclude]
        if not idx:
            idx = [j for j in range(n) if j != i][:self.window]
        win = np.stack([self.frames[j] for j in idx])
        foot = (np.stack([self.footprints[j] for j in idx])
                if self.footprints is not None else None)
        return reference_model(win, sigma=self.sigma, footprints=foot)
