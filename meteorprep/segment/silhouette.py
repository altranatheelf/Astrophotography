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


def foreground_sky_mask(frozen: np.ndarray, rel: float = 0.45,
                        frac_need: float = 0.72, top_limit: float = 0.25,
                        smooth_frac: float = 0.03,
                        feather_px: float = 8.0) -> np.ndarray | None:
    """Camera-space sky alpha (1 = sky, 0 = foreground) from the frozen
    ground stack.  Returns None if the frame shows no distinguishable
    foreground (an all-sky shot)."""
    img = np.asarray(frozen, np.float32)
    lum = img.mean(axis=2) if img.ndim == 3 else img
    h, w = lum.shape
    hs, ws = max(h // 8, 32), max(w // 8, 32)
    s = cv2.resize(lum, (ws, hs), interpolation=cv2.INTER_AREA)

    # per-column sky level (sky fills most of every column), smoothed
    # across columns: removes vignetting and the twilight gradient that
    # defeat a single global threshold
    skycol = np.percentile(s, 70, axis=0)
    k = max(ws // 12, 5) | 1
    skycol = np.median(np.lib.stride_tricks.sliding_window_view(
        np.pad(skycol, k // 2, mode="edge"), k), axis=1)
    ground = (s < rel * skycol[None, :]).astype(np.float32)
    if ground.mean() < 0.005:
        return None                       # nothing dark enough: all sky

    # a horizon is where everything BELOW is mostly foreground; this also
    # rejects dark patches of sky, which have bright sky beneath them
    cnt = np.cumsum(ground[::-1], axis=0)[::-1]
    n = np.arange(hs, 0, -1, dtype=np.float32)[:, None]
    ok = (cnt / n) >= frac_need
    has = ok.any(axis=0)
    horizon = np.argmax(ok, axis=0).astype(np.float32)
    horizon[~has] = hs
    # never let the foreground climb into the top of the frame (a dark
    # vignetted corner is not a treeline)
    horizon = np.maximum(horizon, top_limit * hs)

    k2 = max(int(ws * smooth_frac), 5) | 1
    xs = np.arange(ws)
    known = horizon < hs
    if known.sum() >= 3:
        horizon = np.interp(xs, xs[known], horizon[known])
        horizon = np.median(np.lib.stride_tricks.sliding_window_view(
            np.pad(horizon, k2 // 2, mode="edge"), k2), axis=1)

    rows = np.arange(hs, dtype=np.float32)[:, None]
    sky = cv2.resize((rows < horizon[None, :]).astype(np.float32), (w, h),
                     interpolation=cv2.INTER_LINEAR)
    kf = int(feather_px) * 2 + 1
    sky = np.clip(cv2.GaussianBlur(sky, (kf, kf), feather_px / 2.0), 0, 1)
    log.info("foreground silhouette from the frozen stack: %.0f%% of the "
             "frame is foreground", 100.0 * (sky < 0.5).mean())
    return sky


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
    log.info("foreground level matched to the stack: %s ADU",
             np.round(off, 1).tolist())
    return fg + off[None, None, :]
