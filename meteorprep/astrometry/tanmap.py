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

import numpy as np


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


def tan_to_tan_maps(src_wcs, dst_wcs, shape_out: tuple[int, int],
                    distort=None, coarse: int = 4):
    """Pixel maps (mapx, mapy) float32 for cv2.remap: for every destination
    pixel, the source-image position of the same piece of sky.

    ``distort``: optional callable mapping *ideal* source pixel coords
    (N, 2) to *observed* ones (Poly3Distortion.distort) — applied so the
    resample reads from where the lens actually put the light.

    The mapping is a smooth field, so the exact spherical math runs on a
    ``coarse``-decimated grid and is bilinearly interpolated to full size
    (validated < 0.05 px against the exact map): ~16x cheaper per frame.
    """
    import cv2

    h, w = shape_out
    t_d, e_d, n_d, cd_d, crpix_d = _wcs_frame(dst_wcs)
    t_s, e_s, n_s, cd_s, crpix_s = _wcs_frame(src_wcs)
    cd_s_inv = np.linalg.inv(cd_s)

    c = max(int(coarse), 1)
    # coarse sample positions matching cv2.resize's pixel-center mapping:
    # coarse pixel i covers fine pixels [i*c, (i+1)*c) with center at
    # i*c + (c-1)/2
    wc, hc = -(-w // c), -(-h // c)
    xs = (np.arange(wc, dtype=np.float64) * c + (c - 1) / 2.0)
    ys = (np.arange(hc, dtype=np.float64) * c + (c - 1) / 2.0)
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
    mapx_c = px.reshape(hc, wc).astype(np.float32)
    mapy_c = py.reshape(hc, wc).astype(np.float32)
    if c == 1:
        return mapx_c[:h, :w], mapy_c[:h, :w]
    mapx = cv2.resize(mapx_c, (wc * c, hc * c),
                      interpolation=cv2.INTER_LINEAR)[:h, :w]
    mapy = cv2.resize(mapy_c, (wc * c, hc * c),
                      interpolation=cv2.INTER_LINEAR)[:h, :w]
    return mapx, mapy


def remap_frame(data: np.ndarray, mapx: np.ndarray, mapy: np.ndarray,
                quality: bool = False):
    """Resample with prebuilt maps.  Returns (float32 array, uint8 foot).

    Cubic for the quality path (stars stay round, no Lanczos ringing),
    bilinear for the fast detection pass.
    """
    import cv2

    interp = cv2.INTER_CUBIC if quality else cv2.INTER_LINEAR
    src = data.astype(np.float32, copy=False)
    out = cv2.remap(src, mapx, mapy, interp,
                    borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    h_s, w_s = data.shape[:2]
    inside = ((mapx >= 0) & (mapx <= w_s - 1)
              & (mapy >= 0) & (mapy <= h_s - 1))
    # erode the footprint: boundary pixels are partially blended with the
    # zero border, and that sharp edge reads as a straight streak to the
    # line detector downstream
    foot = cv2.erode(inside.astype(np.uint8),
                     np.ones((3, 3), np.uint8), iterations=2)
    if out.ndim == 3:
        out *= foot[:, :, None]
    else:
        out *= foot
    return np.maximum(out, 0, out=out), foot
