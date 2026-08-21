"""TAN reprojection of every frame onto the base-frame WCS (§4.5), plus the
explicitly-degraded 2D-rotation fallback (§4.7).

Kernel policy: ``reproject_adaptive`` with a Gaussian kernel for the star
base and meteor layers (anti-aliased, no ringing on point sources);
``reproject_interp`` (bilinear) for the fast detection-time pass.  Never
high-order splines on stars.
"""

from __future__ import annotations

import numpy as np


def _plain_tan(wcs) -> bool:
    try:
        return (list(wcs.wcs.ctype) == ["RA---TAN", "DEC--TAN"]
                and wcs.sip is None)
    except AttributeError:
        return False


def plain_tan_pair(src_wcs, dst_wcs) -> bool:
    """True when both ends are plain TAN, so the closed-form pixel map
    applies and a caller may drive the resample itself."""
    return _plain_tan(src_wcs) and _plain_tan(dst_wcs)


def reproject_frame(data: np.ndarray, src_wcs, dst_wcs,
                    shape_out: tuple[int, int], quality: bool = False,
                    distort=None, src_buf=None, out=None, foot_buf=None,
                    maps=None):
    """Reproject (H, W) or (H, W, C) data from src_wcs onto dst_wcs.

    Returns (array, footprint); pixels with no source coverage have
    footprint 0 and value 0, and are excluded from stacking statistics.

    Plain TAN pairs (the pipeline's normal case) go through the exact
    closed-form pixel map + cv2.remap — several times faster than the
    ``reproject`` package and able to fold the lens's radial distortion
    (``distort``: ideal->observed coords, Poly3Distortion.distort) into
    the same single resample.
    """
    if plain_tan_pair(src_wcs, dst_wcs):
        from meteorprep.astrometry.tanmap import remap_frame, tan_to_tan_maps
        mapx, mapy = tan_to_tan_maps(src_wcs, dst_wcs, shape_out,
                                     distort=distort, out=maps)
        return remap_frame(data, mapx, mapy, quality=quality,
                           src_buf=src_buf, out=out, foot_buf=foot_buf)

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
        arr = np.nan_to_num(arr.astype(np.float32, copy=False), nan=0.0)
        return arr, (foot > 0).astype(np.uint8)

    # float32 per channel, assembled in place — never a float64 full stack
    h, w = shape_out
    out = np.empty((h, w, data.shape[2]), np.float32)
    foot_all = None
    for c in range(data.shape[2]):
        arr, foot = _one(data[:, :, c].astype(np.float32))
        out[:, :, c] = np.nan_to_num(arr.astype(np.float32, copy=False),
                                     nan=0.0)
        f = foot > 0
        foot_all = f if foot_all is None else (foot_all & f)
    return out, foot_all.astype(np.uint8)


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
