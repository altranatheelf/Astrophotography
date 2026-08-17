"""TAN reprojection of every frame onto the base-frame WCS (§4.5), plus the
explicitly-degraded 2D-rotation fallback (§4.7).

Kernel policy: ``reproject_adaptive`` with a Gaussian kernel for the star
base and meteor layers (anti-aliased, no ringing on point sources);
``reproject_interp`` (bilinear) for the fast detection-time pass.  Never
high-order splines on stars.
"""

from __future__ import annotations

import numpy as np


def reproject_frame(data: np.ndarray, src_wcs, dst_wcs,
                    shape_out: tuple[int, int], quality: bool = False):
    """Reproject (H, W) or (H, W, C) data from src_wcs onto dst_wcs.

    Returns (array, footprint); pixels with no source coverage have
    footprint 0 and value 0, and are excluded from stacking statistics.
    """
    from reproject import reproject_adaptive, reproject_interp

    def _one(chan):
        if quality:
            return reproject_adaptive(
                (chan, src_wcs), dst_wcs, shape_out=shape_out,
                kernel="gaussian", conserve_flux=False,
                boundary_mode="ignore", return_footprint=True)
        return reproject_interp(
            (chan, src_wcs), dst_wcs, shape_out=shape_out,
            order="bilinear", return_footprint=True)

    if data.ndim == 2:
        arr, foot = _one(data.astype(np.float32))
        arr = np.nan_to_num(arr, nan=0.0)
        return arr, (foot > 0).astype(np.uint8)

    chans, foots = [], []
    for c in range(data.shape[2]):
        arr, foot = _one(data[:, :, c].astype(np.float32))
        chans.append(np.nan_to_num(arr, nan=0.0))
        foots.append(foot > 0)
    return np.stack(chans, axis=2), np.all(foots, axis=0).astype(np.uint8)


def rotate2d_frame(data: np.ndarray, angle_deg: float,
                   center_xy: tuple[float, float]):
    """Degraded fallback (--align-mode=rotate2d): rigid rotation about an
    approximate (Polaris-derived) pole.  Corner stars mis-register by up to
    ~720 px/hr and the pivot itself is ~28 px off the true pole; callers
    must mark alignment_quality="degraded"."""
    import cv2

    h, w = data.shape[:2]
    m = cv2.getRotationMatrix2D(center_xy, -angle_deg, 1.0)
    arr = cv2.warpAffine(data.astype(np.float32), m, (w, h),
                         flags=cv2.INTER_LINEAR,
                         borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    foot = cv2.warpAffine(np.ones((h, w), np.float32), m, (w, h),
                          flags=cv2.INTER_NEAREST,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return arr, foot.astype(np.uint8)
