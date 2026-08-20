"""Streak detection on an aligned difference frame (§3.4).

threshold -> morphological open -> connected components (area + elongation
filter) -> probabilistic Hough on the component mask -> line score.
Defaults adopted from shin3tky/detect_meteors (Apache-2.0).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np


@dataclass
class Streak:
    frame_index: int
    # endpoints in FULL-RES pixel coords of the reprojected (base) frame
    x0: float
    y0: float
    x1: float
    y1: float
    length_px: float
    mean_intensity: float
    peak_intensity: float
    fwhm_px: float
    aspect: float
    area_px: int
    score: float
    straightness_rms: float
    dash_score: float = 0.0     # 0 = continuous, 1 = strongly dashed
    color_rg: float = 1.0       # mean R/G along the line
    color_bg: float = 1.0
    head_tail_ratio: float = 1.0  # bright-end / faint-end mean
    extra: dict = field(default_factory=dict)

    @property
    def endpoints(self):
        return (self.x0, self.y0), (self.x1, self.y1)


def _line_profile(img: np.ndarray, p0, p1, n: int | None = None) -> np.ndarray:
    """Intensity along the segment, max-pooled over a +-1 px perpendicular
    window so a 1-px-wide trail doesn't read as dashed when the sampled
    line lands between pixel centres."""
    length = int(np.hypot(p1[0] - p0[0], p1[1] - p0[1]))
    n = n or max(length, 2)
    xs = np.linspace(p0[0], p1[0], n)
    ys = np.linspace(p0[1], p1[1], n)
    d = np.array([p1[0] - p0[0], p1[1] - p0[1]], float)
    d /= np.linalg.norm(d) + 1e-9
    px, py = -d[1], d[0]
    out = np.full(n, -np.inf, dtype=float)
    for off in (-1.0, 0.0, 1.0):
        xi = np.clip(np.round(xs + off * px).astype(int), 0, img.shape[1] - 1)
        yi = np.clip(np.round(ys + off * py).astype(int), 0, img.shape[0] - 1)
        out = np.maximum(out, img[yi, xi].astype(float))
    return out


def _perpendicular_fwhm(diff: np.ndarray, p0, p1) -> float:
    """Median FWHM across the streak, sampled at 5 stations."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    d = p1 - p0
    norm = np.linalg.norm(d)
    if norm < 1e-6:
        return 0.0
    perp = np.array([-d[1], d[0]]) / norm
    widths = []
    for t in (0.15, 0.3, 0.5, 0.7, 0.85):
        c = p0 + t * d
        offsets = np.arange(-6, 7)
        pts = c[None, :] + offsets[:, None] * perp[None, :]
        xi = np.clip(np.round(pts[:, 0]).astype(int), 0, diff.shape[1] - 1)
        yi = np.clip(np.round(pts[:, 1]).astype(int), 0, diff.shape[0] - 1)
        prof = diff[yi, xi].astype(float)
        prof -= prof.min()
        if prof.max() <= 0:
            continue
        above = prof >= 0.5 * prof.max()
        widths.append(float(above.sum()))
    return float(np.median(widths)) if widths else 0.0


def detect_streaks(diff: np.ndarray, frame_index: int, cfg,
                   rgb_diff: np.ndarray | None = None,
                   bin_factor: int = 1, mad_k: float = 10.0,
                   min_thresh: float = 3.0 * 256.0) -> list[Streak]:
    """Detect streaks in a (binned) luminance difference image.

    ``diff`` is `current_reprojected - reference`, negatives clipped, in
    16-bit ADU.  Thresholds are specified in 8-bit-equivalent units
    (detect_meteors heritage) and scaled to the 16-bit range here.
    ``bin_factor`` maps endpoints back to full resolution.
    """
    scale = 256.0  # 8-bit-equivalent -> 16-bit ADU
    # adaptive: the configured threshold is a CEILING, but on a clean sky
    # the frame's own residual noise sets the floor — a satellite or faint
    # meteor at 6-8 sigma is real even when it is far below the fixed
    # threshold (observed: a real satellite trail at ~7 ADU-8bit missed by
    # the fixed 8).  Ground junk that used to force a high threshold is
    # excluded upstream by the alignment mask.
    finite = diff[diff > 0]
    if len(finite) > 1000:
        med = float(np.median(finite))
        mad = 1.4826 * float(np.median(np.abs(finite - med))) + 1e-3
        # ``min_thresh`` is a guard against a degenerate MAD (a diff that
        # is almost all zeros would otherwise threshold at nothing), not a
        # sensitivity setting.  Against the rolling reference of the first
        # pass it stays at 3 ADU-8bit; the second pass, which works
        # against the clean stacked base and is gated on the radiant, is
        # allowed much lower — measured, that floor alone was the whole
        # detection limit: an injected meteor peaking at 713 ADU was
        # missed and one at 1034 found, with the floor sitting at 768.
        thresh = min(cfg.diff_threshold * scale,
                     max(med + mad_k * mad, min_thresh))
    else:
        thresh = cfg.diff_threshold * scale
    mask = (diff > thresh).astype(np.uint8)

    # component-level cleanup instead of a morphological open (an open
    # erases 1-px-wide satellite trails): drop tiny specks (hot pixels /
    # noise) and huge low-aspect blobs (clouds) before the Hough pass
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    keep = np.zeros(n, dtype=bool)
    for i in range(1, n):
        area = int(stats[i, cv2.CC_STAT_AREA])
        if area < max(cfg.min_area // 2, 3):
            continue
        wbb = int(stats[i, cv2.CC_STAT_WIDTH])
        hbb = int(stats[i, cv2.CC_STAT_HEIGHT])
        extent = max(wbb, hbb)
        if area > 0.05 * diff.size and extent < 3.0 * np.sqrt(area):
            continue  # cloud-like: huge and not line-like
        keep[i] = True
    mask = keep[labels].astype(np.uint8)
    if not mask.any():
        return []

    # two whole-mask Hough passes: the configured one for continuous
    # streaks, and a dash-bridging pass (4x gap) for aircraft strobes
    all_lines = []
    for gap in (cfg.hough_max_line_gap, cfg.hough_max_line_gap * 4):
        lines = cv2.HoughLinesP(mask, 1, np.pi / 180,
                                threshold=cfg.hough_threshold,
                                minLineLength=cfg.hough_min_line_length,
                                maxLineGap=gap)
        if lines is not None:
            all_lines.append(lines.reshape(-1, 4))
    if not all_lines:
        return []
    lines = np.vstack(all_lines).astype(float)
    lens = np.hypot(lines[:, 2] - lines[:, 0], lines[:, 3] - lines[:, 1])
    order = np.argsort(-lens)

    def _pt_seg_dist(p, a, b):
        ab = b - a
        t = np.clip(np.dot(p - a, ab) / (np.dot(ab, ab) + 1e-9), 0, 1)
        return float(np.linalg.norm(p - (a + t * ab)))

    kept: list[np.ndarray] = []
    for idx in order:
        seg = lines[idx]
        a, b_ = seg[:2], seg[2:]
        dup = any(_pt_seg_dist(a, k[:2], k[2:]) < 8 and
                  _pt_seg_dist(b_, k[:2], k[2:]) < 8 for k in kept)
        if not dup:
            kept.append(seg)

    streaks: list[Streak] = []
    yy_all, xx_all = np.nonzero(mask)
    pts_all = np.column_stack([xx_all, yy_all]).astype(np.float32)
    kept_support: list[np.ndarray] = []
    for seg in kept:
        x0, y0, x1, y1 = seg
        length = float(np.hypot(x1 - x0, y1 - y0))
        d = np.array([x1 - x0, y1 - y0], float)
        d /= (np.linalg.norm(d) + 1e-9)
        perp = np.array([-d[1], d[0]])
        # supporting mask pixels: within 3 px of the segment
        rel = pts_all - [x0, y0]
        along = rel @ d
        across = np.abs(rel @ perp)
        sup = (along >= -3) & (along <= length + 3) & (across <= 3.0)
        area = int(sup.sum())
        if area < cfg.min_area:
            continue
        # two lines explained by the same pixels are one object: a shorter
        # Hough line grazing a bright meteor head duplicates the meteor
        sup_idx = np.nonzero(sup)[0]
        if any(np.isin(sup_idx, prev, assume_unique=True).mean() > 0.35
               for prev in kept_support):
            continue
        straightness = float(np.sqrt(np.mean(across[sup] ** 2)))
        aspect = float(length / max(2.0 * straightness, 1.0))
        if aspect < cfg.min_aspect_ratio:
            continue
        # a real streak (even a dashed aircraft) deposits far more support
        # per unit length than a chain of point residuals (undersampled or
        # mis-registered stars strung together by the dash-bridging pass)
        if area < 0.8 * length:
            continue

        prof = _line_profile(diff, (x0, y0), (x1, y1)).astype(float)
        mean_i = float(prof.mean())
        peak_i = float(prof.max())
        # min_line_score is in detect_meteors' units; normalised so the
        # config default (80) maps to score >= 1.0
        score = (length / 15.0) * (mean_i / scale) / (1.0 + straightness)
        if score < cfg.min_line_score / 80.0:
            continue

        # dash structure: deep-off fraction gated by on/off transitions —
        # a fading meteor tail is monotonic (1 transition) and scores 0
        robust_peak = float(np.percentile(prof, 90))
        off = prof < 0.25 * robust_peak
        on = ~off
        transitions = int(np.abs(np.diff(on.astype(int))).sum())
        off_frac = float(off.mean())
        dash_score = min(off_frac * 2.5, 1.0) if transitions >= 3 else 0.0

        rg = bg = 1.0
        if rgb_diff is not None:
            rprof = _line_profile(rgb_diff[..., 0], (x0, y0), (x1, y1)).astype(float)
            gprof = _line_profile(rgb_diff[..., 1], (x0, y0), (x1, y1)).astype(float)
            bprof = _line_profile(rgb_diff[..., 2], (x0, y0), (x1, y1)).astype(float)
            gmean = max(gprof.mean(), 1.0)
            rg, bg = float(rprof.mean() / gmean), float(bprof.mean() / gmean)

        k = max(len(prof) // 4, 1)
        e0, e1 = prof[:k].mean(), prof[-k:].mean()
        head_tail = float(max(e0, e1) / max(min(e0, e1), 1.0))

        fwhm = _perpendicular_fwhm(diff, (x0, y0), (x1, y1))
        b = float(bin_factor)
        streaks.append(Streak(
            frame_index=frame_index,
            x0=float(x0) * b, y0=float(y0) * b,
            x1=float(x1) * b, y1=float(y1) * b,
            length_px=length * b, mean_intensity=mean_i, peak_intensity=peak_i,
            fwhm_px=fwhm * b, aspect=aspect, area_px=area * int(b * b),
            score=float(score), straightness_rms=straightness,
            dash_score=float(dash_score), color_rg=rg, color_bg=bg,
            head_tail_ratio=head_tail))
        kept_support.append(sup_idx)
    return _merge_same_frame(streaks)


def _merge_same_frame(streaks: list[Streak], tol_px: float = 20.0,
                      angle_tol_deg: float = 12.0) -> list[Streak]:
    """Suppress duplicate/partial Hough lines of the same physical streak:
    keep the highest-scoring line of each nearly-collinear, overlapping
    cluster (endpoints already in full-res coords)."""
    if len(streaks) <= 1:
        return streaks

    def _dir(s):
        d = np.array([s.x1 - s.x0, s.y1 - s.y0])
        return d / (np.linalg.norm(d) + 1e-9)

    def _pt_seg(p, s):
        a = np.array([s.x0, s.y0])
        b = np.array([s.x1, s.y1])
        ab = b - a
        t = np.clip(np.dot(p - a, ab) / (np.dot(ab, ab) + 1e-9), 0, 1)
        return float(np.linalg.norm(p - (a + t * ab)))

    kept: list[Streak] = []
    for s in sorted(streaks, key=lambda x: -x.score):
        mid = np.array([(s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2])
        dup = False
        for k in kept:
            ang = np.rad2deg(np.arccos(np.clip(abs(_dir(s) @ _dir(k)), 0, 1)))
            if ang <= angle_tol_deg and _pt_seg(mid, k) <= tol_px:
                dup = True
                break
        if not dup:
            kept.append(s)
    return kept


def bin2x(img: np.ndarray, factor: int = 2) -> np.ndarray:
    """Mean-bin by an integer factor (4x speed, 2x SNR for faint streaks)."""
    if factor == 1:
        return img.astype(np.float32)
    h, w = img.shape[:2]
    h2, w2 = h // factor * factor, w // factor * factor
    img = img[:h2, :w2].astype(np.float32)
    if img.ndim == 2:
        return img.reshape(h2 // factor, factor, w2 // factor, factor).mean(axis=(1, 3))
    return img.reshape(h2 // factor, factor, w2 // factor, factor, -1).mean(axis=(1, 3))
