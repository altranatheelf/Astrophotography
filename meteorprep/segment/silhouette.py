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
    h, w = img.shape[:2]
    hh, ww = max(h // 2, 32), max(w // 2, 32)
    # box-average down first, then take the channel mean: INTER_AREA is a
    # linear operation, so this is the same numbers as averaging twenty
    # million pixels' channels and then shrinking, for a quarter of the
    # work
    s = cv2.resize(img, (ww, hh), interpolation=cv2.INTER_AREA)
    if s.ndim == 3:
        s = s.mean(axis=2)

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
    # in place from here: the whole-frame form allocated another three
    # 80 MB arrays to blur, clip and invert one matte
    cv2.GaussianBlur(a, (kf, kf), max(feather_px / 2.0, 0.1), dst=a)
    np.clip(a, 0, 1, out=a)
    log.info("foreground matte from the frozen stack: %.0f%% of the frame "
             "is foreground (opaque below %.2f of sky level)",
             100.0 * (a > 0.5).mean(), solid)
    return np.subtract(1.0, a, out=a)


def match_sky_level(fg: np.ndarray, base: np.ndarray,
                    sky_alpha: np.ndarray, band_px: int = 120, ctx=None):
    """Return ``fg`` shifted per channel so its sky matches ``base``'s just
    above the treeline — a seamless join instead of a bright halo.

    ``ctx``: a dict the caller keeps between calls.  Every foreground
    layer is matched against the same base and the same sky mask, so the
    band above the treeline and the base's own level inside it are worked
    out once and reused.
    """
    fg = np.asarray(fg, np.float32)
    base = np.asarray(base, np.float32)
    sky = np.asarray(sky_alpha, np.float32)
    if fg.shape != base.shape or sky.shape[:2] != fg.shape[:2]:
        return fg
    # keyed on the base and the mask it was measured from, not just on
    # the shape: two foreground layers of the same size against a
    # different base would otherwise silently reuse the first one's
    # numbers
    key = (fg.shape, id(base), id(sky))
    cached = ctx.get("band") if isinstance(ctx, dict) else None
    if cached is not None and cached[0] == key:
        _, (rows, cols), med_base = cached
    else:
        near = (cv2.dilate((sky < 0.5).astype(np.uint8),
                           np.ones((band_px * 2 + 1, 1), np.uint8)) > 0) \
            & (sky > 0.5)
        if near.sum() < 500:
            near = sky > 0.5
        if near.sum() < 500:
            return fg
        # The offset is one number per channel, read off the middle of a
        # distribution.  Taking it from all ten million pixels in the
        # band meant a ten-million-row gather and a median over it —
        # 4.5s at 20 MP, twice, once per foreground layer.  An evenly
        # strided sample of a couple of hundred thousand pins the same
        # median to well under a tenth of an ADU, and the stride is
        # fixed, so two runs still agree exactly.
        idx = np.flatnonzero(near.ravel())
        if idx.size > 200_000:
            idx = idx[::idx.size // 200_000]
        # Gather with 2-D indices rather than .reshape(-1, C)[idx].  By
        # the time this runs the canvas has been seam-cropped, so base
        # and fg are non-contiguous VIEWS: the flattened form cannot be a
        # view of one, so numpy quietly copies the entire 240 MB canvas
        # to pick 200k rows out of it — the whole-frame temporary this
        # sampling was written to avoid, twice over, at the point in the
        # run where the most is already resident.
        rows, cols = np.divmod(idx, base.shape[1])
        med_base = np.median(base[rows, cols], axis=0)
        if isinstance(ctx, dict):
            ctx["band"] = (key, (rows, cols), med_base)
            ctx["_keep"] = (base, sky)     # ids stay valid while cached
    off = med_base - np.median(fg[rows, cols], axis=0)
    # apply the offset in FULL — throttling it (an earlier attempt capped
    # it against the silhouette's own near-black level) leaves exactly the
    # brightness step this exists to remove.  Detail is protected by a
    # soft floor instead of a clip, so a silhouette keeps its texture
    # without holding the sky hostage.
    log.info("foreground level matched to the stack: %s ADU",
             np.round(off, 1).tolist())
    # in row bands: the whole-frame form built two 240 MB temporaries to
    # add a constant and take a maximum
    out = np.empty_like(fg)
    off32 = off.astype(np.float32)
    band = 256
    floor = np.empty((band,) + fg.shape[1:], np.float32)
    for r0 in range(0, fg.shape[0], band):
        r1 = min(r0 + band, fg.shape[0])
        src, dst = fg[r0:r1], out[r0:r1]
        np.add(src, off32, out=dst)
        fl = floor[:r1 - r0]
        np.multiply(src, 0.05, out=fl)
        np.maximum(dst, fl, out=dst)
    return out
