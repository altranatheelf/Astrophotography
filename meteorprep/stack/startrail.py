"""Optional star-trail render (§5.4): lighten-stack of the *un-reprojected*
frames.  Free byproduct; off by default."""

from __future__ import annotations

import numpy as np


def lighten_stack(frame_loader, n_frames: int) -> np.ndarray:
    out = None
    for i in range(n_frames):
        f = frame_loader(i)
        out = f if out is None else np.maximum(out, f)
    return out
