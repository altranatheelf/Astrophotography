"""Sky/ground segmentation (§5.2).

Classical method (default): model sky vs ground as two color/brightness
Gaussians seeded from the top and bottom of the frame (Ettinger-style),
refine with gradients and morphological closing, and enforce a
column-monotonic horizon (sky above, ground below).  An optional
ML fallback hook is provided for the hard tree-line case; when a model is
plugged in, its license must be recorded in the sidecar.  The boundary is
feathered (~3 px Gaussian) so branch gaps keep real sky.
"""

from __future__ import annotations

import logging

import cv2
import numpy as np

log = logging.getLogger("meteorprep")


def segment_sky_classical(rgb: np.ndarray, feather_px: float = 3.0) -> np.ndarray:
    """Return float32 (H, W) alpha in [0, 1]; 1 = sky."""
    img = rgb.astype(np.float32)
    lum = img.mean(axis=2) if img.ndim == 3 else img
    h, w = lum.shape

    # seed statistics from top and bottom bands
    top = lum[: h // 6, :]
    bot = lum[-h // 6:, :]
    mu_s, sd_s = float(top.mean()), float(top.std()) + 1e-3
    mu_g, sd_g = float(bot.mean()), float(bot.std()) + 1e-3

    if abs(mu_s - mu_g) < 0.25 * (sd_s + sd_g):
        # no distinguishable ground (all-sky frame): everything is sky
        return np.ones((h, w), np.float32)

    # per-pixel Gaussian likelihood ratio
    z_s = ((lum - mu_s) / sd_s) ** 2
    z_g = ((lum - mu_g) / sd_g) ** 2
    sky = (z_s < z_g).astype(np.uint8)

    # morphological cleanup then enforce a per-column horizon: sky is the
    # contiguous region from the top
    sky = cv2.morphologyEx(sky, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    sky = cv2.morphologyEx(sky, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    horizon = np.full(w, h, dtype=int)
    for c in range(w):
        col = sky[:, c]
        nz = np.nonzero(col == 0)[0]
        # first sustained ground run from the top
        run = 0
        for y in nz:
            if run and y == run_y + 1:
                run += 1
            else:
                run = 1
            run_y = y
            if run >= max(h // 50, 5):
                horizon[c] = y - run + 1
                break
    smooth = cv2.GaussianBlur(horizon.astype(np.float32).reshape(1, -1),
                              (0, 0), sigmaX=max(w / 200.0, 3)).ravel()
    mask = (np.arange(h)[:, None] < smooth[None, :]).astype(np.float32)
    # keep genuine sky holes (through branches) that the Gaussian model found
    mask = np.maximum(mask, sky.astype(np.float32) * (mask > 0).any() )
    mask = np.clip(mask, 0, 1)
    if feather_px > 0:
        mask = cv2.GaussianBlur(mask, (0, 0), feather_px)
    return mask.astype(np.float32)


def ground_from_alignment(lum_loader, foot_loader, n: int,
                          exclude=frozenset()) -> np.ndarray | None:
    """Sky mask from alignment physics — the cue no single photo has.

    After sky-alignment, sky pixels agree frame to frame while the static
    ground is dragged and flickering lights churn, so per-pixel deviation
    *frequency* across the aligned frames separates them: ground deviates
    in most frames, a passing meteor/plane in only one or two.  Brightness
    plays no role, so a black tree line against a black sky — where the
    classical Gaussian split fails — is found cleanly.

    Returns float32 (H, W) alpha (1 = sky), or None when there is no
    evidence of ground (all-sky frame or too few frames).
    """
    idx = [i for i in range(n) if i not in exclude]
    if len(idx) < 5:
        return None
    probe = np.asarray(lum_loader(idx[0]))
    h, w = probe.shape
    # chunked over rows so 226 frames never sit in memory at once
    med = np.empty((h, w), np.float32)
    count = np.zeros((h, w), np.float32)
    chunk = max(int(2e8 / (len(idx) * w * 4)), 32)
    for y0 in range(0, h, chunk):
        y1 = min(y0 + chunk, h)
        block = np.stack([np.asarray(lum_loader(i)[y0:y1]).astype(np.float32)
                          for i in idx])
        med[y0:y1] = np.median(block, axis=0)
        del block
    for i in idx:
        count += (np.asarray(foot_loader(i)) > 0)
    used = count >= max(3.0, 0.6 * float(count.max()))
    # deviation threshold: noise floor + a slice of the local gradient —
    # sub-pixel registration jitter deviates in proportion to the local
    # slope (star edges), while dragged ground deviates by full contrast
    # against a smeared (low-gradient) median
    gx = cv2.Sobel(med, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(med, cv2.CV_32F, 0, 1, ksize=3)
    grad = np.hypot(gx, gy) * 0.25          # Sobel gain ~4 at ksize 3
    dev = np.zeros((h, w), np.float32)
    resid_scale = None
    for i in idx:
        a = np.asarray(lum_loader(i)).astype(np.float32)
        f = (np.asarray(foot_loader(i)) > 0)
        r = np.abs(a - med)
        if resid_scale is None:
            samp = r[used & f][:: max((used & f).sum() // 100000, 1)]
            resid_scale = 1.4826 * float(np.median(samp)) + 1e-3
        dev += ((r > 5.0 * resid_scale + 0.8 * grad) & f).astype(np.float32)
    freq = dev / np.maximum(count, 1.0)
    evidence = ((freq > 0.28) & used).astype(np.uint8)
    # drop pointlike star-registration jitter, keep blobby ground churn
    evidence = cv2.morphologyEx(evidence, cv2.MORPH_OPEN,
                                np.ones((3, 3), np.uint8))
    if evidence.mean() < 0.0005:
        return None                     # no ground in frame
    # per-column: ground extends from its first sustained evidence down;
    # a running minimum across columns bridges the gaps between evidence
    # columns along the same treeline
    h, w = evidence.shape
    # bridge dotty evidence (sparse lit patches in a tree crown) into
    # vertical chains so the run detector can see them
    evidence = cv2.morphologyEx(
        evidence, cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (5, 25)))
    run_need = max(h // 120, 6)
    kernel = np.ones((run_need, 1), np.float32)
    runs = cv2.filter2D(evidence.astype(np.float32), -1, kernel,
                        anchor=(0, 0), borderType=cv2.BORDER_CONSTANT)
    sustained = runs >= run_need - 0.5
    first = np.where(sustained.any(axis=0), sustained.argmax(axis=0),
                     h).astype(np.float32)
    from scipy.ndimage import minimum_filter1d
    first = minimum_filter1d(first, size=max(w // 40, 31))
    ground = (np.arange(h)[:, None] >= first[None, :]).astype(np.uint8)
    ground = np.maximum(ground, cv2.dilate(evidence,
                                           np.ones((15, 15), np.uint8)))
    # keep only plausible ground bodies: big, or sitting low in the frame
    # (drops the isolated flicker of saturated star cores in open sky)
    n_lab, labels, stats, cents = cv2.connectedComponentsWithStats(ground, 8)
    keep = np.zeros(n_lab, bool)
    for i in range(1, n_lab):
        big = stats[i, cv2.CC_STAT_AREA] > 0.003 * h * w
        low = cents[i][1] > 0.6 * h
        keep[i] = big or low
    ground = keep[labels].astype(np.float32)
    if ground.mean() < 0.001:
        return None
    sky = 1.0 - np.clip(ground, 0, 1)
    return cv2.GaussianBlur(sky.astype(np.float32), (0, 0), 3.0)


def segment_sky(rgb: np.ndarray, ml_model=None, feather_px: float = 3.0) -> np.ndarray:
    """Dispatch: classical first; ``ml_model(rgb) -> (H, W) sky prob`` hook
    for the hard tree-through-branches case."""
    if ml_model is not None:
        try:
            prob = ml_model(rgb)
            mask = np.clip(prob.astype(np.float32), 0, 1)
            if feather_px > 0:
                mask = cv2.GaussianBlur(mask, (0, 0), feather_px)
            return mask
        except Exception as exc:
            log.warning("ML sky segmentation failed (%s); using classical", exc)
    return segment_sky_classical(rgb, feather_px=feather_px)
