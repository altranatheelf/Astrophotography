"""Turn a noisy ground mask into a usable foreground silhouette (§5.2).

The alignment-physics ground mask is built from per-block statistics and
from the union of where the ground swept during the night, so its edge is
blocky and it can claim isolated patches of real sky.  That is fine for
EXCLUDING ground from the meteor search (its only original job), but it
is wrong as an alpha channel: wherever it claims sky, compositing the
reference frame there pastes that one frame's brighter sky over the
stack — the blocky pale patches seen on a real 226-frame night.

Two repairs, both cheap and both verifiable by eye:

* ``clean_silhouette`` reduces the mask to one smooth treeline per column
  (topmost sustained ground run, median-smoothed across columns, filled
  below, feathered) — no blocks, no islands in the sky.
* ``match_sky_level`` shifts the foreground so its sky level equals the
  stack's just above that treeline, so any residual disagreement blends
  instead of glowing.
"""

from __future__ import annotations

import logging

import cv2
import numpy as np

log = logging.getLogger("meteorprep")


def clean_silhouette(sky_mask: np.ndarray, image: np.ndarray | None = None,
                     min_run_frac: float = 0.015,
                     smooth_frac: float = 0.06, keep_pct: float = 65.0,
                     dark_frac: float = 0.62,
                     feather_px: float = 6.0) -> np.ndarray:
    """sky alpha (1 = sky) -> cleaned sky alpha with a smooth horizon.

    When ``image`` (the foreground frame this alpha will cut) is given,
    the mask is checked against it: foreground is markedly darker than
    sky, so a 'ground' claim sitting on bright sky is provably wrong and
    is dropped.  This is what removes the blocky patches a swept mask
    puts in mid-sky on a long night.
    """
    m = np.asarray(sky_mask, np.float32)
    h, w = m.shape[:2]
    ground = (m < 0.5).astype(np.uint8)
    if ground.sum() < 16:
        return m

    if image is not None and image.shape[:2] == (h, w):
        img = np.asarray(image, np.float32)
        lum = img.mean(axis=2) if img.ndim == 3 else img
        sky_px = lum[m >= 0.5]
        if sky_px.size > 1000:
            sky_level = float(np.median(sky_px))
            ground &= (lum < dark_frac * sky_level).astype(np.uint8)
            if ground.sum() < 16:      # nothing survives: trust the mask
                ground = (m < 0.5).astype(np.uint8)

    # real foreground reaches the bottom of the frame; a patch floating in
    # the sky does not.  Keep only ground components that touch the bottom
    # edge — this is what removes the blocks the swept/blocky mask claims
    # in mid-sky.
    n_lab, lab, stats, _ = cv2.connectedComponentsWithStats(ground, 8)
    keep = np.zeros(n_lab, bool)
    for i in range(1, n_lab):
        top = stats[i, cv2.CC_STAT_TOP]
        bottom = top + stats[i, cv2.CC_STAT_HEIGHT]
        keep[i] = bottom >= h - 2
    if keep.any():
        ground = keep[lab].astype(np.uint8)

    # a column is "ground from here down" only where a sustained vertical
    # run of ground begins: kills blocks, speckle and thin swept fringes
    run = max(int(h * min_run_frac), 9)
    run += 1 - (run % 2)                      # odd, so the anchor centres
    sustained = cv2.erode(ground, np.ones((run, 1), np.uint8))
    has = sustained.max(axis=0) > 0
    horizon = np.argmax(sustained, axis=0).astype(np.float32) - run // 2
    horizon[~has] = h                          # no ground in this column

    # smooth the treeline across columns (a horizon is continuous; blocky
    # jumps and isolated columns are artefacts)
    k = max(int(w * smooth_frac), 5)
    k += 1 - (k % 2)
    known = horizon < h
    if known.sum() >= 3:
        xs = np.arange(w)
        horizon = np.interp(xs, xs[known], horizon[known])   # bridge gaps
        pad = k // 2
        padded = np.pad(horizon, pad, mode="edge")
        win = np.lib.stride_tricks.sliding_window_view(padded, k)
        # an upper percentile, not the median: mask errors push the
        # treeline UP (swept fringes, blocks fused to the canopy) and
        # never down, so biasing low keeps the true silhouette
        horizon = np.percentile(win, keep_pct, axis=1).astype(np.float32)
    horizon = np.clip(horizon, 0, h)

    rows = np.arange(h, dtype=np.float32)[:, None]
    out = (rows < horizon[None, :]).astype(np.float32)        # 1 = sky
    if feather_px > 0:
        kf = int(feather_px) * 2 + 1
        out = cv2.GaussianBlur(out, (kf, kf), feather_px / 2.0)
    return np.clip(out, 0.0, 1.0)


def match_sky_level(fg: np.ndarray, base: np.ndarray,
                    sky_alpha: np.ndarray, band_px: int = 120):
    """Return ``fg`` shifted per channel so its sky matches ``base``'s just
    above the treeline — a seamless join instead of a bright halo."""
    fg = np.asarray(fg, np.float32)
    base = np.asarray(base, np.float32)
    sky = np.asarray(sky_alpha, np.float32)
    if fg.shape != base.shape or sky.shape[:2] != fg.shape[:2]:
        return fg
    # sample the sky band immediately above the horizon: both images are
    # sky there, so any difference is the level offset we must remove
    near = (cv2.dilate((sky < 0.5).astype(np.uint8),
                       np.ones((band_px * 2 + 1, 1), np.uint8)) > 0) & (sky > 0.5)
    if near.sum() < 500:
        near = sky > 0.5
    if near.sum() < 500:
        return fg
    step = max(int(np.sqrt(near.sum() / 20000.0)), 1)
    sel = near[::step, ::step]
    if sel.sum() < 200:
        sel = near[::1, ::1]
        sub_f, sub_b = fg[sel], base[sel]
    else:
        sub_f, sub_b = fg[::step, ::step][sel], base[::step, ::step][sel]
    off = np.median(sub_b, axis=0) - np.median(sub_f, axis=0)
    log.info("foreground level matched to the stack: %s ADU",
             np.round(off, 1).tolist())
    return fg + off[None, None, :]
