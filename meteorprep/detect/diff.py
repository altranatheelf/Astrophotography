"""Aligned differencing (§3.3): current reprojected frame minus the running
reference; negatives clipped; uncovered pixels zeroed."""

from __future__ import annotations

import numpy as np


def difference(current: np.ndarray, reference: np.ndarray,
               footprint: np.ndarray | None = None) -> np.ndarray:
    diff = current.astype(np.float32) - reference.astype(np.float32)
    np.clip(diff, 0, None, out=diff)
    if footprint is not None:
        diff[footprint == 0] = 0.0
    return diff
