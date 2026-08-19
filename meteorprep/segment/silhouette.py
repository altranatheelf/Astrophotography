"""Foreground silhouette from the frozen (camera-space) stack.

Where to segment matters more than how.  The alignment ground mask is
computed on SKY-ALIGNED frames, so over a long night it marks the whole
band the trees swept across, on a coarse block grid.  It is the right
tool for excluding ground from the meteor search — and the wrong thing
entirely to cut a foreground with: wherever it claims sky, compositing
the reference frame pastes that one frame's brighter sky over the stack
(the blocky pale patches seen on a real 226-frame night).

On a fixed tripod the trees are static in CAMERA coordinates, and the
frozen-ground stack is exactly that: every frame averaged unaligned, so
the ground is sharp and the sky is a smooth wash.  Segmenting there is
well posed.  Measured on real frames: ground 127 ADU vs sky 433 — a
clean 3.4x brightness separation (texture, by contrast, is *higher* in
the sky because stars stay point-sharp, so brightness is the signal).

The sky is not uniform though — vignetting and twilight glow make a
single global threshold fail on one side of the frame — so each column
is normalised by its own sky level first.
"""

from __future__ import annotations

import logging

import cv2
import numpy as np

log = logging.getLogger("meteorprep")


def foreground_sky_mask(frozen: np.ndarray, solid: float = 0.30,
                        gate: float = 0.55, top_limit: float = 0.22,
                        feather_px: float = 2.0) -> np.ndarray | None:
    """Camera-space sky alpha (1 = sky, 0 = solid foreground) from the
    frozen ground stack.  Returns None for an all-sky frame.

    Foliage is not binary: a dense canopy blocks the sky completely while
    the outer twigs only dim it, so no hard threshold can trace them (
    measured: raising the cut from 0.6 to 0.7 of sky level barely moves
    the outline).  The alpha is therefore a MATTE — how much each pixel
    darkens its own column's sky — which makes solid canopy opaque, thin
    sprigs partly transparent, and sky clear.  A gated, bottom-connected
    region keeps that matte from bleeding into darker patches of sky.
    """
    img = np.asarray(frozen, np.float32)
    lum = img.mean(axis=2) if img.ndim == 3 else img
    h, w = lum.shape
    hh, ww = max(h // 2, 32), max(w // 2, 32)
    s = cv2.resize(lum, (ww, hh), interpolation=cv2.INTER_AREA)

    # per-column sky level (sky fills most of a column), smoothed across
    # columns: removes the vignetting and twilight tilt that defeat a
    # single global threshold on one side of the frame
    skycol = np.percentile(s, 70, axis=0)
    k = max(ww // 12, 5) | 1
    skycol = np.median(np.lib.stride_tricks.sliding_window_view(
        np.pad(skycol, k // 2, mode="edge"), k), axis=1)

    ratio = s / np.maximum(skycol[None, :], 1e-6)
    alpha = np.clip((1.0 - ratio) / (1.0 - solid), 0.0, 1.0)

    hard = (alpha > gate).astype(np.uint8)
    hard[:int(top_limit * hh), :] = 0          # a dark corner is not ground
    hard = cv2.morphologyEx(hard, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    hard = cv2.morphologyEx(hard, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(hard, 8)
    keep = np.zeros(n, bool)
    for i in range(1, n):                       # real foreground reaches
        if st[i, cv2.CC_STAT_TOP] + st[i, cv2.CC_STAT_HEIGHT] >= hh - 2:
            keep[i] = True                      # the bottom of the frame
    if not keep.any():
        return None
    hard = keep[lab].astype(np.uint8)

    # let the semi-transparent fringe just outside the solid mass through
    region = cv2.GaussianBlur(
        cv2.dilate(hard, np.ones((41, 41), np.uint8)).astype(np.float32),
        (41, 41), 12)
    a = cv2.resize(np.clip(alpha * region, 0, 1), (w, h),
                   interpolation=cv2.INTER_LINEAR)
    kf = int(feather_px) * 2 + 1
    a = np.clip(cv2.GaussianBlur(a, (kf, kf), max(feather_px / 2.0, 0.1)),
                0, 1)
    log.info("foreground matte from the frozen stack: %.0f%% of the frame "
             "is foreground", 100.0 * (a > 0.5).mean())
    return 1.0 - a


def match_sky_level(fg: np.ndarray, base: np.ndarray,
                    sky_alpha: np.ndarray, band_px: int = 120):
    """Return ``fg`` shifted per channel so its sky matches ``base``'s just
    above the treeline — a seamless join instead of a bright halo."""
    fg = np.asarray(fg, np.float32)
    base = np.asarray(base, np.float32)
    sky = np.asarray(sky_alpha, np.float32)
    if fg.shape != base.shape or sky.shape[:2] != fg.shape[:2]:
        return fg
    near = (cv2.dilate((sky < 0.5).astype(np.uint8),
                       np.ones((band_px * 2 + 1, 1), np.uint8)) > 0) \
        & (sky > 0.5)
    if near.sum() < 500:
        near = sky > 0.5
    if near.sum() < 500:
        return fg
    off = np.median(base[near], axis=0) - np.median(fg[near], axis=0)
    # never crush the foreground to black: a downward shift is capped at
    # 70% of the foreground's own dark level, so a silhouette keeps its
    # detail even when the two sky levels are far apart
    solid = sky < 0.5
    if solid.sum() > 500:
        dark = np.percentile(fg[solid], 20, axis=0)
        off = np.maximum(off, -0.7 * dark)
    log.info("foreground level matched to the stack: %s ADU",
             np.round(off, 1).tolist())
    return np.maximum(fg + off[None, None, :], 0.0)
