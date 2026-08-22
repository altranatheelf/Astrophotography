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
        self._s1 = None
        self._s2 = None

    def add(self, value: np.ndarray, ok: np.ndarray) -> None:
        """value (H,W,C) float32; ok (H,W) bool — masked pixels ignored.

        Written as in-place ufunc calls over two scratch buffers rather
        than the arithmetic it reads as: the expression form built seven
        frame-sized temporaries per photo, and this runs once for every
        frame of the statistics pass.  Operation order is unchanged, so
        the result is bit-for-bit what the plain form produced.
        """
        if self._s1 is None or self._s1.shape != value.shape:
            self._s1 = np.empty(value.shape, np.float32)
            self._s2 = np.empty(value.shape, np.float32)
        d, d2 = self._s1, self._s2
        okf = ok.astype(np.float32)
        self.count += okf
        cnt = np.maximum(self.count, 1.0)[:, :, None]
        okc = okf[:, :, None]
        np.subtract(value, self.mean, out=d)      # delta
        d *= okc
        np.divide(d, cnt, out=d2)
        self.mean += d2
        np.subtract(value, self.mean, out=d2)     # delta2
        d2 *= okc
        d *= d2
        self.m2 += d

    def combine(self, other: "RunningMoments") -> None:
        """Chan et al. parallel combination of two partials, in place.

        Written as in-place ufunc calls rather than the arithmetic it
        reads as: at 20 MP the expression form built a third of a
        gigabyte of temporaries per merge.  The operation order is
        unchanged, so the result is bit-for-bit what the plain form
        produced.
        """
        n = self.count + other.count
        nz = np.maximum(n, 1.0)
        delta = other.mean - self.mean
        w_other = (other.count / nz)[:, :, None]
        cross = (self.count * other.count / nz)[:, :, None]
        scratch = delta * delta
        scratch *= cross
        self.m2 += other.m2
        self.m2 += scratch
        del scratch
        delta *= w_other
        self.mean += delta
        self.count = n

    def std(self, floor: float = 2.0) -> np.ndarray:
        """Per-pixel standard deviation with a small ADU floor so pixels
        with tiny variance still accept their own samples in pass 2."""
        var = self.m2 / np.maximum(self.count - 1.0, 1.0)[:, :, None]
        return np.sqrt(np.maximum(var, floor * floor))


def frame_noise_weights(noise_sigmas: dict[int, float],
                        clip=(0.25, 4.0)) -> dict[int, float]:
    """Inverse-variance frame weights (PixInsight-style noise weighting),
    normalised to mean 1 and clipped so no frame dominates or vanishes.

    A sigma of zero, a negative one or a NaN means the search could not
    measure that frame — a photo with almost no sky in it, or one that
    would not read.  Those frames stack at mean weight and, crucially,
    are kept out of the mean: one unmeasurable frame used to become a
    1e6 weight that drove every real photo of the night down onto the
    0.25 clip floor, and one NaN made every weight NaN.
    """
    usable = {i: float(s) for i, s in noise_sigmas.items()
              if np.isfinite(s) and s > 1e-3}
    if len(usable) < 2:
        return {}
    raw = {i: 1.0 / s ** 2 for i, s in usable.items()}
    mean_w = float(np.mean(list(raw.values())))
    out = {i: float(np.clip(w / mean_w, clip[0], clip[1]))
           for i, w in raw.items()}
    for i in noise_sigmas:
        out.setdefault(i, 1.0)
    return out
