"""Order statistics without the NaN sweep.

``np.median`` is careful: before it answers it scans the whole array for
a NaN, and it does that on top of the partition it already has to do.
On the arrays this pipeline hands it — a six-frame window at five
megapixels, ten million residuals from one difference — that check is a
second-class copy of the real work, and it is checking for something
that cannot be there: every one of these arrays comes from 16-bit
sensor data or from arithmetic on it.

These do the same partition and return the same bits (verified against
``np.median`` for odd and even lengths, float32 and float64), without
the sweep.  Anything that might genuinely hold a NaN should keep using
``np.median``.
"""

from __future__ import annotations

import numpy as np


def _float(a: np.ndarray) -> np.ndarray:
    """np.median promotes integers to float before averaging the two
    middle values; these have to as well, or an even-length uint16 stack
    either wraps around (65000 + 65100 in 16 bits is 564) or refuses to
    hold the halved result at all.  Every caller in this pipeline passes
    float32 today — this is so the next one does not have to know that."""
    a = np.asarray(a)
    return a if a.dtype.kind == "f" else a.astype(np.float64)


def median_axis0(a: np.ndarray) -> np.ndarray:
    """Median along axis 0 of a stack — same result as
    ``np.median(a, axis=0)``."""
    a = _float(a)
    n = a.shape[0]
    k = n // 2
    if n % 2:
        return np.partition(a, k, axis=0)[k]
    p = np.partition(a, (k - 1, k), axis=0)
    out = p[k - 1] + p[k]
    out *= 0.5
    return out


def median_flat(a: np.ndarray) -> float:
    """Median of a flat (or flattened) array — same result as
    ``float(np.median(a))``."""
    v = _float(a).ravel()
    n = v.size
    if n == 0:
        return float("nan")
    k = n // 2
    if n % 2:
        return float(np.partition(v, k)[k])
    p = np.partition(v, (k - 1, k))
    return float((p[k - 1] + p[k]) * 0.5)


def mad_sigma(a: np.ndarray, floor: float = 0.0) -> tuple:
    """(median, robust sigma) of a flat array: 1.4826 x the median
    absolute deviation, the estimator used all through the detector."""
    v = _float(a).ravel()
    med = median_flat(v)
    dev = np.abs(v - med)
    return med, 1.4826 * median_flat(dev) + floor
