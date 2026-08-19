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


def foreground_sky_mask(frozen: np.ndarray, gate: float = 0.55,
                        top_limit: float = 0.05,
                        feather_px: float = 2.0) -> np.ndarray | None:
    """Camera-space sky alpha (1 = sky, 0 = solid foreground) from the
    frozen ground stack.  Returns None for an all-sky frame.

    Foliage is not binary: a dense canopy blocks the sky completely while
    its outer twigs only dim it, so no hard threshold traces them
    (measured: moving the cut from 0.6 to 0.7 of sky level barely moved
    the outline).  The alpha is therefore a MATTE — how much each pixel
    darkens its own column's sky — with the fully-opaque level measured
    from the foreground itself, so a bright moonlit ridge is as solid as
    a black treeline.
    """
    img = np.asarray(frozen, np.float32)
    lum = img.mean(axis=2) if img.ndim == 3 else img
    h, w = lum.shape
    hh, ww = max(h // 2, 32), max(w // 2, 32)
    s = cv2.resize(lum, (ww, hh), interpolation=cv2.INTER_AREA)

    # Sky level per column (removes vignetting and the twilight tilt that
    # defeat one global threshold).  Take an UPPER envelope across
    # columns, not a median: a column that is mostly foreground — a tall
    # tree, a mast — would otherwise report the foreground as its own sky
    # and erase itself from the matte.
    raw = np.percentile(s, 70, axis=0)
    k = max(ww // 6, 9) | 1
    win = np.lib.stride_tricks.sliding_window_view(
        np.pad(raw, k // 2, mode="edge"), k)
    skycol = np.percentile(win, 90, axis=1).astype(np.float32)
    ratio = s / np.maximum(skycol[None, :], 1e-6)

    # locate the foreground with a conservative opacity, then measure how
    # dark this night's foreground actually is
    hard = (np.clip((1.0 - ratio) / 0.70, 0, 1) > gate).astype(np.uint8)
    if top_limit > 0:
        hard[:int(top_limit * hh), :] = 0
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

    solid = float(np.clip(np.percentile(ratio[hard > 0], 60), 0.05, 0.75))
    alpha = np.clip((1.0 - ratio) / max(1.0 - solid, 1e-3), 0.0, 1.0)

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
             "is foreground (opaque below %.2f of sky level)",
             100.0 * (a > 0.5).mean(), solid)
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
    # apply the offset in FULL — throttling it (an earlier attempt capped
    # it against the silhouette's own near-black level) leaves exactly the
    # brightness step this exists to remove.  Detail is protected by a
    # soft floor instead of a clip, so a silhouette keeps its texture
    # without holding the sky hostage.
    out = fg + off[None, None, :]
    log.info("foreground level matched to the stack: %s ADU",
             np.round(off, 1).tolist())
    return np.maximum(out, 0.05 * fg)
