"""Per-meteor alpha extraction (§6).

The mask is built from the reprojected *difference* image (stars already
subtracted); the RGB is painted from the final-quality decode of the
original frame so the meteor keeps true colour.  The layer uses straight
(non-premultiplied) alpha — Photoshop layer transparency expects straight
alpha, and premultiplied would darken feathered edges under Lighten.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class MeteorLayer:
    name: str
    bbox: tuple            # (x0, y0, x1, y1) in base-frame full-res pixels
    rgb: np.ndarray        # (h, w, 3) float32, straight (unmultiplied)
    alpha: np.ndarray      # (h, w) float32 in [0, 1]


def _grow_along_axis(diff, p0, p1, background_sigma, max_extend_px=200):
    """Extend endpoints along the streak axis until intensity falls below
    background + 1 sigma for a run of >= 5 px (§6.1 step 4)."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    d = p1 - p0
    n = np.linalg.norm(d)
    if n < 1e-6:
        return p0, p1
    d /= n
    h, w = diff.shape[:2]

    def extend(start, direction):
        p = start.copy()
        low_run = 0
        for _ in range(max_extend_px):
            q = p + direction
            xi, yi = int(round(q[0])), int(round(q[1]))
            if not (0 <= xi < w and 0 <= yi < h):
                break
            if diff[yi, xi] < background_sigma:
                low_run += 1
                if low_run >= 5:
                    break
            else:
                low_run = 0
                p = q
        return p

    return extend(p0, -d), extend(p1, d)


def extract_meteor(diff: np.ndarray, rgb_full: np.ndarray,
                   endpoints_px, fwhm_px: float,
                   star_xy: np.ndarray | None = None,
                   star_fwhm: float = 3.0,
                   feather_px: float = 2.0) -> MeteorLayer | None:
    """Build a straight-alpha meteor layer around the streak.

    ``diff``: full-res luminance difference (reprojected, ADU).
    ``rgb_full``: full-res reprojected final-quality RGB of the source frame.
    ``star_xy``: known base-catalog star pixel positions for exclusion.
    """
    h, w = diff.shape[:2]
    med = float(np.median(diff))
    sigma = 1.4826 * float(np.median(np.abs(diff - med))) + 1e-3
    p0, p1 = _grow_along_axis(diff, endpoints_px[0], endpoints_px[1], med + sigma)

    pad = max(6.0 * max(fwhm_px, 2.0), 12.0)
    x0 = int(max(min(p0[0], p1[0]) - pad, 0))
    y0 = int(max(min(p0[1], p1[1]) - pad, 0))
    x1 = int(min(max(p0[0], p1[0]) + pad, w))
    y1 = int(min(max(p0[1], p1[1]) + pad, h))
    if x1 - x0 < 4 or y1 - y0 < 4:
        return None
    roi = diff[y0:y1, x0:x1].astype(np.float32)

    # local adaptive threshold along the line: per-station threshold follows
    # the head->tail gradient so the faint tail isn't clipped (§6.1 step 2)
    q0 = np.asarray(p0) - [x0, y0]
    q1 = np.asarray(p1) - [x0, y0]
    axis = q1 - q0
    alen = np.linalg.norm(axis) + 1e-9
    axis_u = axis / alen
    yy, xx = np.mgrid[0:roi.shape[0], 0:roi.shape[1]]
    t = ((xx - q0[0]) * axis_u[0] + (yy - q0[1]) * axis_u[1]) / alen
    t = np.clip(t, 0, 1)
    # sample intensity profile at 16 stations
    stations = np.linspace(0, 1, 16)
    prof = []
    for st in stations:
        c = q0 + st * axis
        xi = int(np.clip(round(c[0]), 0, roi.shape[1] - 1))
        yi = int(np.clip(round(c[1]), 0, roi.shape[0] - 1))
        patch = roi[max(yi - 2, 0):yi + 3, max(xi - 2, 0):xi + 3]
        prof.append(float(patch.max()) if patch.size else 0.0)
    local_peak = np.interp(t, stations, np.maximum(np.array(prof), med + 2 * sigma))
    thresh = np.maximum(0.15 * local_peak, med + 1.0 * sigma)
    core = (roi > thresh).astype(np.uint8)

    # restrict to a corridor around the line (height ~ 6 x FWHM)
    perp = np.array([-axis_u[1], axis_u[0]])
    dperp = np.abs((xx - q0[0]) * perp[0] + (yy - q0[1]) * perp[1])
    corridor = dperp <= max(3.0 * max(fwhm_px, 2.0), 6.0)
    core &= corridor.astype(np.uint8)
    if core.sum() < 4:
        return None

    # alpha = normalised intensity with a soft perpendicular feather
    alpha = np.clip(roi / (local_peak + 1e-6), 0, 1) * core
    alpha = cv2.GaussianBlur(alpha, (0, 0), feather_px)
    alpha = np.clip(alpha, 0, 1)

    # star exclusion: circular holes at known stars, alpha inpainted along
    # the streak so it stays continuous (§6.2)
    if star_xy is not None and len(star_xy):
        sx = star_xy[:, 0] - x0
        sy = star_xy[:, 1] - y0
        inside = (sx > -5) & (sx < roi.shape[1] + 5) & (sy > -5) & (sy < roi.shape[0] + 5)
        if inside.any():
            hole = np.zeros(roi.shape, np.uint8)
            r = max(int(round(1.5 * star_fwhm)), 2)
            for x, y in zip(sx[inside], sy[inside]):
                cv2.circle(hole, (int(round(x)), int(round(y))), r, 1, -1)
            if hole.any():
                filled = cv2.inpaint(
                    (alpha * 255).astype(np.uint8), hole, 3, cv2.INPAINT_TELEA)
                alpha = np.where(hole > 0, filled.astype(np.float32) / 255.0, alpha)

    rgb = rgb_full[y0:y1, x0:x1].astype(np.float32)
    return MeteorLayer(name="", bbox=(x0, y0, x1, y1), rgb=rgb, alpha=alpha)
