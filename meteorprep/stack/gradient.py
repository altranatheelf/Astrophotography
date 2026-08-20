"""Sky-gradient model (light-pollution / moonlight falloff), delivered as
a toggleable layer rather than baked in — set the layer's blend mode to
Subtract in Photoshop and the sky flattens; hide it and nothing changed.
This is the non-destructive counterpart of Siril's background extraction.
"""

from __future__ import annotations

import logging

import numpy as np

log = logging.getLogger("meteorprep")


_NORM_TERMS = 6   # 1, u, v, u^2, uv, v^2


def fit_frame_sky(arr: np.ndarray, ok: np.ndarray,
                  sky: np.ndarray | None = None,
                  grid: int = 12) -> np.ndarray | None:
    """Per-frame low-order sky surface (PixInsight-style local
    normalization, streaming edition): coefficients of a quadratic in
    normalized coords (u, v in [-0.5, 0.5]), per channel — evaluate at any
    resolution with eval_frame_sky.  Robust sampling: coarse-cell 20th
    percentiles over covered sky pixels.  Returns (C, 6) or None when too
    little sky is usable (caller falls back to a scalar offset)."""
    h, w = arr.shape[:2]
    nch = arr.shape[2] if arr.ndim == 3 else 1
    ys = np.linspace(0, h, grid + 1, dtype=int)
    xs = np.linspace(0, w, grid + 1, dtype=int)
    pts, vals = [], []
    for gy in range(grid):
        for gx in range(grid):
            sl = (slice(ys[gy], ys[gy + 1]), slice(xs[gx], xs[gx + 1]))
            okc = ok[sl]
            if sky is not None:
                okc = okc & (sky[sl] >= 0.5)
            if okc.mean() < 0.5:
                continue
            cell = arr[sl][okc]
            pts.append(((xs[gx] + xs[gx + 1]) / (2.0 * w) - 0.5,
                        (ys[gy] + ys[gy + 1]) / (2.0 * h) - 0.5))
            vals.append(np.percentile(cell.reshape(len(cell), -1), 20,
                                      axis=0))
    if len(pts) < 20:
        return None
    pts = np.asarray(pts, np.float64)
    vals = np.asarray(vals, np.float64).reshape(len(pts), nch)
    u, v = pts[:, 0], pts[:, 1]
    A = np.column_stack([np.ones_like(u), u, v, u * u, u * v, v * v])
    coef, *_ = np.linalg.lstsq(A, vals, rcond=None)
    return coef.T.astype(np.float32)          # (C, 6)


def eval_frame_sky(coef: np.ndarray, h: int, w: int) -> np.ndarray:
    """Evaluate fit_frame_sky coefficients on an (h, w) grid -> (h, w, C)."""
    coef = np.asarray(coef, np.float32)
    u = (np.arange(w, dtype=np.float32) + 0.5) / w - 0.5
    v = (np.arange(h, dtype=np.float32) + 0.5) / h - 0.5
    # Separable evaluation: a quadratic in (u, v) regroups as
    #   (c0 + c1 u + c3 u^2) + v (c2 + c4 u) + v^2 c5
    # so each channel costs three broadcasts over the frame instead of
    # six full-size basis images and a tensordot — the old form built
    # half a gigabyte of temporaries per frame at 20 MP.
    nch = coef.shape[0]
    out = np.empty((h, w, nch), np.float32)
    v2 = v * v
    for c in range(nch):
        c0, c1, c2, c3, c4, c5 = [float(x) for x in coef[c]]
        row = c0 + c1 * u + c3 * u * u          # (w,)
        slope = c2 + c4 * u                     # (w,)
        plane = out[:, :, c]
        np.multiply(v[:, None], slope[None, :], out=plane)
        plane += row[None, :]
        plane += (c5 * v2)[:, None]
    return out


def fit_sky_gradient(rgb: np.ndarray, sky_mask: np.ndarray,
                     grid: int = 24, order: int = 2) -> np.ndarray | None:
    """Fit a low-order 2D polynomial background per channel.

    Robust sampling: the image is divided into a coarse grid; each cell
    contributes its low percentile (stars and the Milky Way sit above it),
    ground cells are excluded via ``sky_mask``.  Returns the gradient with
    its minimum removed (so Subtract flattens without darkening), or None
    when there is too little sky to fit.
    """
    h, w = rgb.shape[:2]
    ys = np.linspace(0, h, grid + 1, dtype=int)
    xs = np.linspace(0, w, grid + 1, dtype=int)
    # sample each cell on a stride that leaves ~4000 pixels to sort
    step = max(int(round(np.sqrt((h * w) / (grid * grid * 4000.0)))), 1)
    pts, vals = [], []
    for gy in range(grid):
        for gx in range(grid):
            cell_sky = sky_mask[ys[gy]:ys[gy + 1], xs[gx]:xs[gx + 1]]
            if cell_sky.mean() < 0.8:      # touches ground: skip
                continue
            # A cell of a 20 MP frame holds ~35 000 pixels per channel,
            # and sorting all of them to read one percentile off a smooth
            # background is 12 seconds of the run for a number that does
            # not move: a few thousand samples give the same answer.
            cell = rgb[ys[gy]:ys[gy + 1]:step, xs[gx]:xs[gx + 1]:step]
            if cell.size < 3:
                continue
            pts.append(((xs[gx] + xs[gx + 1]) / 2.0,
                        (ys[gy] + ys[gy + 1]) / 2.0))
            vals.append(np.percentile(cell.reshape(-1, cell.shape[-1]),
                                      20, axis=0))
    if len(pts) < 3 * (order + 1) ** 2:
        log.info("too little clear sky for a gradient fit; skipping")
        return None
    pts = np.asarray(pts, float)
    vals = np.asarray(vals, float)
    # normalised coordinates keep the design matrix well-conditioned
    u = pts[:, 0] / w - 0.5
    v = pts[:, 1] / h - 0.5
    cols = [u ** i * v ** j
            for i in range(order + 1) for j in range(order + 1 - i)]
    A = np.column_stack(cols)
    coeffs, *_ = np.linalg.lstsq(A, vals, rcond=None)

    # Evaluate separably.  The old form built two full-frame coordinate
    # grids in int64, two more in float64 and a fresh full-frame basis
    # image per term — over two gigabytes of temporaries to draw a smooth
    # surface, and eleven seconds of every run.  Grouping the polynomial
    # as sum_i u^i * g_i(v) leaves one (h,) vector per power of u and
    # three broadcasts per channel.
    uu = (np.arange(w, dtype=np.float32) / w - 0.5)
    vv = (np.arange(h, dtype=np.float32) / h - 0.5)
    nch = vals.shape[1]
    out = np.empty((h, w, nch), np.float32)
    for c in range(nch):
        g = []                       # g[i] = sum_j coeff * v^j, shape (h,)
        k = 0
        for i in range(order + 1):
            gi = np.zeros(h, np.float32)
            for j in range(order + 1 - i):
                gi += np.float32(coeffs[k, c]) * (vv ** j)
                k += 1
            g.append(gi)
        plane = out[:, :, c]
        plane[:] = g[0][:, None]
        for i in range(1, order + 1):
            plane += (uu ** i)[None, :] * g[i][:, None]
    out -= out.min(axis=(0, 1), keepdims=True)   # Subtract must not darken
    return np.clip(out, 0, 65535, out=out)
