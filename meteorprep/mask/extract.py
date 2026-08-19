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


def _halo_radius(diff, p0, p1, med, sigma, rmax=200, floor=0.5):
    """Perpendicular distance at which the streak's glow finally sinks
    into the noise.  A bright meteor's light spreads far past its core
    through the lens PSF wings and atmospheric scatter, and that faint
    haze is the part a too-small box slices off — leaving the straight
    edges and corners that make the edit obvious.  Measured per streak
    instead of assumed from FWHM."""
    p0 = np.asarray(p0, float)
    p1 = np.asarray(p1, float)
    ax = p1 - p0
    L = float(np.linalg.norm(ax))
    if L < 1e-6:
        return 24.0
    u = ax / L
    perp = np.array([-u[1], u[0]])
    h, w = diff.shape[:2]
    ts = np.linspace(0.05, 0.95, 48)
    rs = np.arange(0, rmax)
    # sample both sides at every perpendicular distance, vectorised
    base = p0[None, :] + ts[:, None] * ax[None, :]
    prof = np.zeros(len(rs), np.float32)
    for k, r in enumerate(rs):
        vals = []
        for sgn in (1.0, -1.0):
            q = base + sgn * r * perp[None, :]
            xi = np.clip(np.round(q[:, 0]).astype(int), 0, w - 1)
            yi = np.clip(np.round(q[:, 1]).astype(int), 0, h - 1)
            vals.append(diff[yi, xi])
        prof[k] = np.percentile(np.concatenate(vals), 90) - med
    quiet = floor * sigma
    for r in range(3, len(rs) - 5):
        if np.all(prof[r:r + 5] < quiet):
            return float(r)
    return float(rmax)


def _apodize(shape, taper):
    """Cosine taper to exactly zero at the border, so no layer can ever
    end on a hard edge no matter what the signal does."""
    h, w = shape
    def ramp(n):
        v = np.ones(n, np.float32)
        k = int(min(taper, max(n // 2 - 1, 0)))
        if k > 0:
            e = 0.5 * (1 - np.cos(np.linspace(0, np.pi, k + 2)[1:-1]))
            v[:k] = e
            v[-k:] = e[::-1]
        return v
    return ramp(h)[:, None] * ramp(w)[None, :]


def extract_meteor(diff: np.ndarray, rgb_full: np.ndarray,
                   endpoints_px, fwhm_px: float,
                   star_xy: np.ndarray | None = None,
                   star_fwhm: float = 3.0,
                   feather_px: float = 2.0,
                   base_rgb: np.ndarray | None = None) -> MeteorLayer | None:
    """Build a straight-alpha meteor layer around the streak.

    ``diff``: full-res luminance difference (reprojected, ADU).
    ``rgb_full``: full-res reprojected final-quality RGB of the source frame.
    ``star_xy``: known base-catalog star pixel positions for exclusion.
    """
    h, w = diff.shape[:2]
    med = float(np.median(diff))
    sigma = 1.4826 * float(np.median(np.abs(diff - med))) + 1e-3
    p0, p1 = _grow_along_axis(diff, endpoints_px[0], endpoints_px[1], med + sigma)

    # box sized from the measured glow, not from FWHM: + a margin so the
    # signal is already at zero well before the border
    r_halo = _halo_radius(diff, p0, p1, med, sigma)
    pad = float(np.clip(r_halo + 16.0, max(8.0 * max(fwhm_px, 2.0), 32.0),
                        240.0))
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

    # SUPPORT mask, not an intensity map.  The old code hard-thresholded
    # at 15% of the local peak and hard-clipped a corridor 3xFWHM wide,
    # which cut the halo along straight lines; blurring that by 2 px only
    # softened a cut that should never have existed.  Here the signal
    # itself defines the support: it reaches full opacity as soon as it
    # clears the noise and falls to exactly zero in clean background, so
    # the boundary follows the light instead of a rectangle.
    above = roi - (med + 1.0 * sigma)
    alpha = np.clip(above / (2.0 * sigma), 0.0, 1.0)

    # keep the streak's own neighbourhood: a wide, SOFT corridor (no hard
    # edge) that only suppresses unrelated objects far off the axis
    perp = np.array([-axis_u[1], axis_u[0]])
    dperp = np.abs((xx - q0[0]) * perp[0] + (yy - q0[1]) * perp[1])
    r_keep = max(pad - 12.0, 3.0 * max(fwhm_px, 2.0))
    soft = np.clip((r_keep + 10.0 - dperp) / 20.0, 0.0, 1.0)
    alpha = alpha * soft
    if (alpha > 0.5).sum() < 4:
        return None
    if feather_px > 0:
        alpha = cv2.GaussianBlur(alpha, (0, 0), feather_px)
    # guarantee: zero at the border, so the layer cannot end on an edge
    alpha = np.clip(alpha, 0, 1) * _apodize(alpha.shape,
                                            max(int(pad * 0.35), 8))
    # exact zero on the border: the guarantee should be absolute, not
    # "one 8-bit level"
    alpha[0, :] = alpha[-1, :] = 0.0
    alpha[:, 0] = alpha[:, -1] = 0.0

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

    # The layer carries the meteor's OWN light (this frame minus the
    # stacked sky), not the whole frame.  Composited with Screen that is
    # physically what a meteor does — it adds photons — and it makes the
    # box invisible by construction: outside the streak the layer is
    # zero, and screening zero changes nothing.  Carrying the full frame
    # under Lighten pasted this frame's brighter sky wherever alpha was
    # non-zero, which is what made the rectangle legible.
    rgb = rgb_full[y0:y1, x0:x1].astype(np.float32)
    if base_rgb is not None and base_rgb.shape[:2] == diff.shape[:2]:
        rgb = np.maximum(rgb - base_rgb[y0:y1, x0:x1].astype(np.float32), 0.0)
    return MeteorLayer(name="", bbox=(x0, y0, x1, y1), rgb=rgb, alpha=alpha)
