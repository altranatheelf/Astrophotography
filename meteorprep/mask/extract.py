"""Per-meteor alpha extraction (§6).

The mask is built from the reprojected *difference* image (stars already
subtracted); the RGB is painted from the final-quality decode of the
original frame so the meteor keeps true colour.  The layer uses straight
(non-premultiplied) alpha — Photoshop layer transparency expects straight
alpha, and premultiplied would darken feathered edges under Lighten.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

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
        """Walk outward, remembering the last bright pixel, and stop only
        after five dim ones in a row.

        The walk has to keep moving through the dim pixels or it cannot
        count them: stepping from the last ACCEPTED point re-tested the
        same pixel five times and stopped there, which made the run
        length a no-op and cut the endpoint at the first dim pixel.  A
        meteor tail fades — and flickers — so that is exactly where the
        interesting part starts.
        """
        p = np.array(start, float)
        best = np.array(start, float)
        low_run = 0
        for _ in range(max_extend_px):
            p = p + direction
            xi, yi = int(round(p[0])), int(round(p[1]))
            if not (0 <= xi < w and 0 <= yi < h):
                break
            if diff[yi, xi] < background_sigma:
                low_run += 1
                if low_run >= 5:
                    break
            else:
                low_run = 0
                best = p.copy()
        return best

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


def _flat_background(img: np.ndarray, offmask: np.ndarray) -> np.ndarray:
    """The smooth frame-minus-stack sky residual across a cutout box.

    Airglow and thin haze move between one frame and the average of the
    whole night, so the box around a meteor carries a gentle wash of
    sky difference that has nothing to do with the meteor.  It is
    COHERENT, so no amount of smoothing-then-thresholding removes it —
    it lit entire cutout boxes edge to edge the moment a person boosted
    a layer.  Estimated as a coarse grid of medians over the pixels AWAY
    from the streak (so the meteor cannot pollute its own background),
    interpolated smoothly back to full size.
    """
    H, W = img.shape[:2]
    gy, gx = max(H // 48, 2), max(W // 48, 2)
    grid = np.full((gy, gx), np.nan, np.float32)
    ys = np.linspace(0, H, gy + 1).astype(int)
    xs = np.linspace(0, W, gx + 1).astype(int)
    for j in range(gy):
        for i in range(gx):
            tile = img[ys[j]:ys[j + 1], xs[i]:xs[i + 1]]
            keep = offmask[ys[j]:ys[j + 1], xs[i]:xs[i + 1]]
            vals = tile[keep]
            if vals.size >= 32:
                grid[j, i] = float(np.median(vals))
    if np.isnan(grid).all():
        return np.zeros((H, W), np.float32)
    grid = np.where(np.isnan(grid), float(np.nanmedian(grid)), grid)
    bg = cv2.resize(grid, (W, H), interpolation=cv2.INTER_CUBIC)
    return cv2.GaussianBlur(bg, (0, 0), 24.0)


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
    perp = np.array([-axis_u[1], axis_u[0]])
    dperp = np.abs((xx - q0[0]) * perp[0] + (yy - q0[1]) * perp[1])
    # the reference shell: outside the measured halo, inside the box —
    # far enough out that the meteor's own glow cannot pollute it
    r_off = min(max(r_halo + 4.0, 3.0 * max(fwhm_px, 2.0) + 8.0),
                float(pad) - 6.0)
    off_corridor = dperp > r_off
    if off_corridor.sum() < 500:
        off_corridor = dperp > np.percentile(dperp, 75)

    # flatten the box's own sky residual before anything is measured
    roi = roi - _flat_background(roi, off_corridor)

    # SUPPORT mask, not an intensity map — and the gate is EMPIRICAL,
    # measured on the box's own non-meteor pixels, not on a noise model.
    # Two models failed here on real nights before this.  Thresholding
    # raw pixels against the noise let one pixel in six through by
    # chance: a haze of speckle opacity, invisible normally, a rectangle
    # of colored confetti the moment someone boosts the layer +4 stops
    # in Photoshop — the very thing the layers exist for.  Gating a
    # smoothed map against modelled noise then failed differently: in a
    # rich star field, frame-minus-stack is not sparse noise at all but
    # a dense positive carpet of star residuals and clip bias, sitting
    # tens of ADU high EVERYWHERE, so the whole box cleared any model's
    # threshold honestly.  What actually separates the meteor from that
    # carpet is only that it is BRIGHTER than the carpet: so the shell
    # outside the halo says what the carpet looks like here (level and
    # spread, from percentiles — a third of these pixels sit at exactly
    # zero, which collapses a median-of-absolutes), and opacity goes to
    # what beats it.
    sm = cv2.GaussianBlur(roi, (0, 0), 2.0)
    so = sm[off_corridor]
    lvl = float(np.median(so))
    spread = max(float(np.percentile(so, 84) - np.percentile(so, 16)) / 2.0,
                 0.05 * sigma, 1e-3)
    # onset and ramp both at 4 spreads: the carpet's own excursions
    # essentially never reach 8, so nothing but the meteor gets opacity
    # worth boosting
    above = sm - (lvl + 4.0 * spread)
    alpha = np.clip(above / (4.0 * spread), 0.0, 1.0)

    # keep the streak's own neighbourhood: a wide, SOFT corridor (no hard
    # edge) that only suppresses unrelated objects far off the axis
    r_keep = max(pad - 12.0, 3.0 * max(fwhm_px, 2.0))
    soft = np.clip((r_keep + 10.0 - dperp) / 20.0, 0.0, 1.0)
    alpha = alpha * soft
    # a meteor is ONE elongated object: pieces of support that neither
    # touch the streak's core corridor nor have real size are the star
    # residuals that beat the gate — drop them whole, instead of leaving
    # a sprinkle of bright dots for a boost to amplify
    # everything real is one object: the halo is continuous with the
    # core, and a dashed satellite trail lies along the axis — so any
    # piece of support that never touches the streak's own corridor is
    # somebody else's light, however large it managed to grow
    on_axis = dperp <= (2.0 * max(fwhm_px, 2.0) + 4.0)
    n_lbl, lbl = cv2.connectedComponents(
        (alpha > 0.05).astype(np.uint8), connectivity=8)
    if n_lbl > 1:
        keep = np.zeros(n_lbl, bool)
        keep[np.unique(lbl[on_axis & (alpha > 0.05)])] = True
        keep[0] = False
        alpha = np.where(keep[lbl], alpha, 0.0).astype(np.float32)

    # the faintest second-look meteors peak near the carpet, so their
    # core alpha is honest-but-low; the old > 0.5 bar was only ever
    # cleared by the speckle this gate now removes
    if (alpha > 0.15).sum() < 4:
        return None
    if feather_px > 0:
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
                    np.clip(alpha * 255 + 0.5, 0, 255).astype(np.uint8),
                    hole, 3, cv2.INPAINT_TELEA)
                alpha = np.where(hole > 0, filled.astype(np.float32) / 255.0, alpha)

    # Border guarantee, applied LAST.  It used to run before the star
    # holes were inpainted, and a star sitting on the rim let the inpaint
    # write alpha back onto the border row — measured at 3/255 on a real
    # layer, which is exactly the faint straight edge this is meant to
    # rule out.  Nothing may touch alpha after this point.
    alpha = np.clip(alpha, 0, 1) * _apodize(alpha.shape,
                                            max(int(pad * 0.35), 8))
    alpha[0, :] = alpha[-1, :] = 0.0
    alpha[:, 0] = alpha[:, -1] = 0.0

    import os as _os
    if _os.environ.get("METEORPREP_DEBUG_EXTRACT"):
        _d = Path(_os.environ["METEORPREP_DEBUG_EXTRACT"])
        _d.mkdir(parents=True, exist_ok=True)
        _n = len(list(_d.glob("roi_*.npz")))
        np.savez_compressed(
            _d / f"roi_{_n}.npz", roi=roi, sm=sm, alpha=alpha,
            sigma=np.float32(sigma), off=off_corridor)

    # The layer carries the meteor's OWN light (this frame minus the
    # stacked sky), not the whole frame.  Composited with Screen that is
    # physically what a meteor does — it adds photons — and it makes the
    # box invisible by construction: outside the streak the layer is
    # zero, and screening zero changes nothing.  Carrying the full frame
    # under Lighten pasted this frame's brighter sky wherever alpha was
    # non-zero, which is what made the rectangle legible.
    rgb = rgb_full[y0:y1, x0:x1].astype(np.float32)
    if base_rgb is not None and base_rgb.shape[:2] == diff.shape[:2]:
        rgb = rgb - base_rgb[y0:y1, x0:x1].astype(np.float32)
        # the same airglow wash sits in the colour difference: take it
        # out per channel so what the layer carries — and what a boost
        # amplifies — is the meteor's light and nothing else
        for c in range(rgb.shape[2]):
            rgb[:, :, c] -= _flat_background(rgb[:, :, c], off_corridor)
        np.clip(rgb, 0.0, None, out=rgb)
    return MeteorLayer(name="", bbox=(x0, y0, x1, y1), rgb=rgb, alpha=alpha)
