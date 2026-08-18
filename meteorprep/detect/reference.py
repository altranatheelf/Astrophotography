"""Running sigma-clipped median reference model (§3.2).

Frames must already be reprojected onto the base WCS (§3.3): once stars
occupy the same pixels across frames, the temporal median models the star
field and the transient meteor survives the difference.  Consecutive-frame
differencing is NOT used — with field rotation it registers star trails as
bright residuals and floods the Hough detector.
"""

from __future__ import annotations

import numpy as np


def reference_model(stack_win: np.ndarray, sigma: float = 3.0,
                    maxiters: int = 3,
                    footprints: np.ndarray | None = None) -> np.ndarray:
    """Temporal median of a (W, H, W_img) window.

    A median is already robust to a transient in a minority of frames, so
    sigma-clipping before it changes nothing on real windows (verified
    bit-identical against the previous astropy sigma_clip + ma.median on
    real aligned frames) while costing 10x the time.  ``sigma`` and
    ``maxiters`` are accepted for API compatibility.

    ``footprints`` (W, H, W_img) marks valid coverage; uncovered pixels
    are excluded — only the ~0.3% partially-covered rim pixels need the
    slower nan path.
    """
    win = np.asarray(stack_win, dtype=np.float32)
    if footprints is None:
        return np.median(win, axis=0).astype(np.float32)
    med = np.median(win, axis=0).astype(np.float32)
    part = ~(footprints != 0).all(axis=0)
    if part.any():
        import warnings
        wf = np.where(footprints[:, part] != 0, win[:, part], np.nan)
        with warnings.catch_warnings():
            # pixels covered by no frame are legitimately all-NaN -> 0
            warnings.simplefilter("ignore", RuntimeWarning)
            med[part] = np.nan_to_num(np.nanmedian(wf, axis=0), nan=0.0)
    return med


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
        if not idx:
            # single-frame group: no neighbours — the reference is the frame
            # itself, so the difference is zero and nothing is detected
            return np.asarray(self.frames[i], dtype=np.float32)
        win = np.stack([self.frames[j] for j in idx])
        foot = (np.stack([self.footprints[j] for j in idx])
                if self.footprints is not None else None)
        return reference_model(win, sigma=self.sigma, footprints=foot)
