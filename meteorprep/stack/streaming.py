"""Streaming statistics for the two-pass sigma-clipped stack.

Pass 1 accumulates per-pixel running moments (Welford) per worker and
combines partials with Chan's parallel algorithm; pass 2 re-streams the
frames, keeps only samples within ``sigma`` standard deviations of the
pass-1 mean, and accumulates a (optionally frame-weighted) mean of the
survivors.  This gives the same rejection quality as the kappa-sigma /
winsorized stacking in DeepSkyStacker and Siril while never holding more
than one frame in memory.
"""

from __future__ import annotations

import numpy as np


class RunningMoments:
    """Per-pixel Welford accumulator: count, mean, M2 (all image-shaped)."""

    def __init__(self, shape):
        self.count = np.zeros(shape[:2], np.float32)
        self.mean = np.zeros(shape, np.float32)
        self.m2 = np.zeros(shape, np.float32)

    def add(self, value: np.ndarray, ok: np.ndarray) -> None:
        """value (H,W,C) float32; ok (H,W) bool — masked pixels ignored."""
        okf = ok.astype(np.float32)
        self.count += okf
        cnt = np.maximum(self.count, 1.0)[:, :, None]
        okc = okf[:, :, None]
        delta = (value - self.mean) * okc
        self.mean += delta / cnt
        delta2 = (value - self.mean) * okc
        self.m2 += delta * delta2

    def combine(self, other: "RunningMoments") -> None:
        """Chan et al. parallel combination of two partials, in place."""
        n = self.count + other.count
        nz = np.maximum(n, 1.0)
        delta = other.mean - self.mean
        w_other = (other.count / nz)[:, :, None]
        mean = self.mean + delta * w_other
        cross = (self.count * other.count / nz)[:, :, None]
        self.m2 = self.m2 + other.m2 + delta * delta * cross
        self.mean = mean
        self.count = n

    def std(self, floor: float = 2.0) -> np.ndarray:
        """Per-pixel standard deviation with a small ADU floor so pixels
        with tiny variance still accept their own samples in pass 2."""
        var = self.m2 / np.maximum(self.count - 1.0, 1.0)[:, :, None]
        return np.sqrt(np.maximum(var, floor * floor))


def frame_noise_weights(noise_sigmas: dict[int, float],
                        clip=(0.25, 4.0)) -> dict[int, float]:
    """Inverse-variance frame weights (PixInsight-style noise weighting),
    normalised to mean 1 and clipped so no frame dominates or vanishes."""
    if not noise_sigmas:
        return {}
    raw = {i: 1.0 / max(s, 1e-3) ** 2 for i, s in noise_sigmas.items()}
    mean_w = float(np.mean(list(raw.values())))
    return {i: float(np.clip(w / mean_w, clip[0], clip[1]))
            for i, w in raw.items()}
