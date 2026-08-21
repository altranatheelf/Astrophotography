"""Closed-form TAN-to-TAN reprojection maps.

Both the source and destination WCS are gnomonic (TAN) projections, so the
pixel-to-pixel mapping is exact spherical math: destination pixel ->
standard coords (affine) -> unit vector -> source standard coords ->
source pixel (affine) -> optional lens distortion.  Building the map is
pure vectorised numpy (~1 s for 20 MP) and the resample itself is a
single cv2.remap — several times faster than the generic ``reproject``
package, and it folds the lens's radial distortion into the same single
resample instead of ignoring it (uncorrected distortion blurs the stack:
each frame's stars land a few pixels apart at the field edges).
"""

from __future__ import annotations

import os
import time

import numpy as np

# Set METEORPREP_PROF to a file path to have the stack's hot paths append
# a per-step timing line to it.  Off (and free) otherwise.
_PROF_PATH = os.environ.get("METEORPREP_PROF")
_PROF: dict = {}


def _prof(key, t0):
    if _PROF_PATH:
        _PROF[key] = _PROF.get(key, 0.0) + time.perf_counter() - t0
    return time.perf_counter()


def prof_dump(tag: str = "") -> None:
    """Append what the hot paths measured, then start counting again."""
    if not (_PROF_PATH and _PROF):
        return
    line = f"TANMAP {tag} " + " ".join(f"{k}={v:.2f}"
                                       for k, v in sorted(_PROF.items()))
    try:
        with open(_PROF_PATH, "a") as fh:
            fh.write(line + "\n")
    except OSError:
        pass
    _PROF.clear()


def _wcs_frame(wcs):
    """CRVAL unit vector + east/north tangent basis + CD, CRPIX arrays."""
    ra0, dec0 = np.deg2rad(wcs.wcs.crval[0]), np.deg2rad(wcs.wcs.crval[1])
    t = np.array([np.cos(dec0) * np.cos(ra0), np.cos(dec0) * np.sin(ra0),
                  np.sin(dec0)])
    e_east = np.array([-np.sin(ra0), np.cos(ra0), 0.0])
    e_north = np.cross(t, e_east)
    cd = np.asarray(wcs.wcs.cd if wcs.wcs.has_cd() else wcs.pixel_scale_matrix,
                    dtype=float)
    crpix = np.asarray(wcs.wcs.crpix, dtype=float)   # FITS 1-based
    return t, e_east, e_north, cd, crpix


def _exact_map(xs, ys, frames, distort):
    """Exact TAN->TAN source pixel coords on the grid ys x xs -> two
    (len(ys), len(xs)) float32 arrays."""
    (t_d, e_d, n_d, cd_d, crpix_d), (t_s, e_s, n_s, cd_s, crpix_s) = frames
    cd_s_inv = np.linalg.inv(cd_s)
    yy, xx = np.meshgrid(ys, xs, indexing="ij")
    # destination pixel -> standard coords (deg) -> unit vector
    u = xx.ravel() - (crpix_d[0] - 1.0)
    v = yy.ravel() - (crpix_d[1] - 1.0)
    xi = np.deg2rad(cd_d[0, 0] * u + cd_d[0, 1] * v)
    eta = np.deg2rad(cd_d[1, 0] * u + cd_d[1, 1] * v)
    s = (t_d[None, :] + xi[:, None] * e_d[None, :]
         + eta[:, None] * n_d[None, :])
    # unit vector -> source standard coords
    d = s @ t_s
    with np.errstate(divide="ignore", invalid="ignore"):
        xi_s = np.rad2deg((s @ e_s) / d)
        eta_s = np.rad2deg((s @ n_s) / d)
    bad = d <= 1e-9
    # source standard coords -> source pixel (0-based)
    px = cd_s_inv[0, 0] * xi_s + cd_s_inv[0, 1] * eta_s + (crpix_s[0] - 1.0)
    py = cd_s_inv[1, 0] * xi_s + cd_s_inv[1, 1] * eta_s + (crpix_s[1] - 1.0)
    if distort is not None:
        pts = distort(np.column_stack([px, py]))
        px, py = pts[:, 0], pts[:, 1]
    px[bad] = -1e6
    py[bad] = -1e6
    return (px.reshape(len(ys), len(xs)).astype(np.float32),
            py.reshape(len(ys), len(xs)).astype(np.float32))


def tan_to_tan_maps(src_wcs, dst_wcs, shape_out: tuple[int, int],
                    distort=None, coarse: int = 8, out=None):
    """Pixel maps (mapx, mapy) float32 for cv2.remap: for every destination
    pixel, the source-image position of the same piece of sky.

    ``out``: an (mapx, mapy) pair of full-size float32 buffers to write
    into.  The maps are 160 MB at 20 MP and every frame of a stack needs
    the same two, so a caller in a loop hands the same pair back rather
    than making the allocator find them again.

    ``distort``: optional callable mapping *ideal* source pixel coords
    (N, 2) to *observed* ones (Poly3Distortion.distort) — applied so the
    resample reads from where the lens actually put the light.

    The mapping is a smooth field, so the exact spherical math runs on a
    ``coarse``-decimated grid and is bilinearly interpolated to full size
    (max 0.003 px against the exact map at coarse=8, and the outer frame
    the interpolation cannot reach is filled in exactly): ~60x cheaper
    per frame than solving every pixel.
    """
    import cv2

    _t = time.perf_counter()
    h, w = shape_out
    frames = (_wcs_frame(dst_wcs), _wcs_frame(src_wcs))
    c = max(int(coarse), 1)
    if c == 1:                       # exact: one node per output pixel
        mapx, mapy = _exact_map(np.arange(w, dtype=np.float64),
                                np.arange(h, dtype=np.float64),
                                frames, distort)
        _prof("map_coarse", _t)
        return mapx, mapy
    # Sample positions matched to what cv2.resize will do on the way back
    # up: resizing (hc, wc) -> (h, w) reads source coordinate
    # (j + 0.5) * wc / w - 0.5 for destination pixel j, so node i has to
    # sit at (i + 0.5) * w / wc - 0.5 for the interpolation to reproduce
    # the field it was sampled from.
    wc = -(-w // c) + 1
    hc = -(-h // c) + 1
    xs = (np.arange(wc, dtype=np.float64) + 0.5) * (w / wc) - 0.5
    ys = (np.arange(hc, dtype=np.float64) + 0.5) * (h / hc) - 0.5
    mapx_c, mapy_c = _exact_map(xs, ys, frames, distort)
    _t = _prof("map_coarse", _t)
    if out is not None and out[0].shape == (h, w):
        mapx, mapy = out
    else:
        mapx = np.empty((h, w), np.float32)
        mapy = np.empty((h, w), np.float32)
    cv2.resize(mapx_c, (w, h), dst=mapx, interpolation=cv2.INTER_LINEAR)
    cv2.resize(mapy_c, (w, h), dst=mapy, interpolation=cv2.INTER_LINEAR)
    # The first and last half-node of each axis sits inside the first and
    # last pixel, so cv2.resize clamps there instead of interpolating and
    # the outermost ring of the map drifts by up to half a node.  That
    # ring is a few thousand pixels out of twenty million: solve it
    # exactly and paste it back.
    m = c // 2 + 1
    rows = np.concatenate([np.arange(0, m), np.arange(h - m, h)])
    cols = np.concatenate([np.arange(0, m), np.arange(w - m, w)])
    allx = np.arange(w, dtype=np.float64)
    ally = np.arange(h, dtype=np.float64)
    ex, ey = _exact_map(allx, rows.astype(np.float64), frames, distort)
    mapx[rows, :] = ex
    mapy[rows, :] = ey
    ex, ey = _exact_map(cols.astype(np.float64), ally, frames, distort)
    mapx[:, cols] = ex
    mapy[:, cols] = ey
    _prof("map_upsample", _t)
    return mapx, mapy


def footprint_from_maps(mapx, mapy, src_shape, foot_buf=None):
    """0/1 uint8 mask of the destination pixels that read real source
    data, eroded by two pixels."""
    import cv2

    h_s, w_s = src_shape
    # cv2.inRange is the same test threaded and without four full-size
    # boolean temporaries
    inside = cv2.bitwise_and(cv2.inRange(mapx, 0.0, float(w_s - 1)),
                             cv2.inRange(mapy, 0.0, float(h_s - 1)))
    # erode the footprint: boundary pixels are partially blended with the
    # zero border, and that sharp edge reads as a straight streak to the
    # line detector downstream
    foot = cv2.erode(inside, np.ones((3, 3), np.uint8), iterations=2,
                     dst=foot_buf)
    # inRange answers in 0/255; the footprint is used as a multiplier and
    # as a mask, so bring it back to 0/1 in place
    np.minimum(foot, 1, out=foot)
    return foot


def remap_band(data, mapx, mapy, r0: int, r1: int, out=None):
    """Cubic-resample destination rows [r0, r1) only, straight out of the
    undeveloped source.

    The stack's inner loop works in row bands, and a band of the resampled
    frame is small enough to stay in cache all the way through the clip
    test and the accumulate.  Building the whole 20 MP frame first only to
    read it back one band at a time costs a 240 MB round trip to memory
    per frame, and the source never has to be widened to float first:
    cubic on uint16 saturates exactly where the float path is clamped to
    zero straight afterwards.
    """
    import cv2

    return cv2.remap(data, mapx[r0:r1], mapy[r0:r1], cv2.INTER_CUBIC,
                     borderMode=cv2.BORDER_CONSTANT, borderValue=0,
                     dst=out)


def remap_frame(data: np.ndarray, mapx: np.ndarray, mapy: np.ndarray,
                quality: bool = False, src_buf=None, out=None,
                foot_buf=None):
    """Resample with prebuilt maps.  Returns (float32 array, uint8 foot).

    Cubic for the quality path (stars stay round, no Lanczos ringing),
    bilinear for the fast detection pass.
    """
    import cv2

    _t = time.perf_counter()
    interp = cv2.INTER_CUBIC if quality else cv2.INTER_LINEAR
    if src_buf is not None and src_buf.shape == data.shape:
        np.copyto(src_buf, data, casting="unsafe")
        src = src_buf
    else:
        src = data.astype(np.float32, copy=False)
    _t = _prof("to_float", _t)
    out = cv2.remap(src, mapx, mapy, interp,
                    borderMode=cv2.BORDER_CONSTANT, borderValue=0,
                    dst=out)
    _t = _prof("remap", _t)
    foot = footprint_from_maps(mapx, mapy, data.shape[:2], foot_buf=foot_buf)
    _t = _prof("footprint", _t)
    # Zero outside the footprint and clamp the cubic's undershoot, in row
    # bands so the frame is walked once with everything in cache.  The
    # whole-frame form (out *= foot[:, :, None]; np.maximum(out, 0, ...))
    # reads the mask on a stride of three and makes two full passes:
    # 0.117s against 0.062s on a 20 MP frame.
    if out.ndim == 3:
        band = 64
        for r0 in range(0, out.shape[0], band):
            r1 = min(r0 + band, out.shape[0])
            blk = out[r0:r1]
            cv2.multiply(blk, cv2.merge([foot[r0:r1]] * out.shape[2]),
                         dst=blk, dtype=cv2.CV_32F)
            cv2.max(blk, 0.0, dst=blk)
        _prof("mask_clamp", _t)
        return out, foot
    out *= foot
    return np.maximum(out, 0, out=out), foot
