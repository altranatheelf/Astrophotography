"""Star-trail accumulation (§5.4) and its two style upgrades.

The classic trail is a lighten-max of the *un-reprojected* frames — a
free byproduct of stack pass 2.  On top of that:

``comet_gains``
    Comet-fade styling: each frame's contribution is scaled by where it
    sits in the night, so the newest light is full strength and the tail
    fades away behind it — the look StarStaX calls comet mode.

``plan_fill`` / ``fill_trail_gaps``
    Gap filling.  An intervalometer night has a dead second or five
    between exposures, and at trail scale that prints every arc as a
    dashed line.  Other tools bridge the dashes by blending neighbouring
    frames blindly; this one knows exactly how the sky moved — the plate
    solve gives the rotation between any two frames, measured, not
    guessed — so each frame's stars are re-drawn at the sky positions
    they actually passed through during the gap.  The ground never
    moves: only high-pass star light above the frame's own noise takes
    part, so a branch or a roofline stays where it was shot.
"""

from __future__ import annotations

import numpy as np


def lighten_stack(frame_loader, n_frames: int) -> np.ndarray:
    out = None
    for i in range(n_frames):
        f = frame_loader(i)
        out = f if out is None else np.maximum(out, f)
    return out


def comet_gains(order) -> dict:
    """Per-frame trail gain for the comet-fade style.

    ``order`` is the frame indices in chronological order.  The newest
    frame keeps full strength; the oldest fades to a faint memory (a
    quadratic ramp reads better than linear — the tail thins the way a
    real comet's does)."""
    n = len(order)
    if n < 2:
        return {}
    return {i: 0.12 + 0.88 * (pos / (n - 1)) ** 2
            for pos, i in enumerate(order)}


def plan_fill(wcs_a, wcs_b, dt_pair_s: float, exposure_s: float,
              interval_s: float, decode_shape_hw, det_to_decode: float):
    """Measure the sky's pixel-space rotation between two solved frames
    and turn it into the bridge angles for the inter-exposure gap.

    Returns ``(px, py, th0, th1, n_steps)`` — pivot pixel and the angle
    range to fill, all in DECODE-scale coordinates — or ``None`` when
    there is no visible gap to fill (continuous shooting, tiny arc, or
    anything about the measurement that fails).  The rotation is taken
    from the solves themselves, so hemisphere, camera roll and mirror
    parity are all automatically right.
    """
    try:
        if dt_pair_s <= 0 or interval_s <= exposure_s + 0.5 \
                or interval_s > 600:
            return None
        # The sky's frame-to-frame motion is a rotation about the
        # visible celestial pole's projection.  Take the pivot from the
        # solve, and the angle from where one probe point (the frame
        # centre, in that frame's own pixels) lands in the next frame —
        # both measured, so hemisphere, roll and parity come out right.
        from astropy.coordinates import SkyCoord
        import astropy.units as u
        pole_dec = 90.0 if float(wcs_a.wcs.crval[1]) >= 0 else -90.0
        pole = SkyCoord(ra=0 * u.deg, dec=pole_dec * u.deg, frame="icrs")
        pxa, pya = (float(v) for v in wcs_a.world_to_pixel(pole))
        h, w = decode_shape_hw
        wd, hd = w / det_to_decode, h / det_to_decode  # det-scale frame
        # least-squares rotation angle about the pole, fitted on a grid
        # across the whole frame (radius-weighted): a single probe point
        # inherits that point's share of the gnomonic distortion; the
        # fit spreads it
        gx, gy = np.meshgrid(np.linspace(wd * 0.1, wd * 0.9, 6),
                             np.linspace(hd * 0.1, hd * 0.9, 4))
        gx, gy = gx.ravel(), gy.ravel()
        sky = wcs_a.pixel_to_world(gx, gy)
        tx, ty = wcs_b.world_to_pixel(sky)
        tx, ty = np.asarray(tx, np.float64), np.asarray(ty, np.float64)
        if not (np.isfinite(pxa) and np.isfinite(pya)
                and np.all(np.isfinite(tx)) and np.all(np.isfinite(ty))):
            return None
        a0 = np.arctan2(gy - pya, gx - pxa)
        a1 = np.arctan2(ty - pya, tx - pxa)
        dth = np.arctan2(np.sin(a1 - a0), np.cos(a1 - a0))
        r2 = (gx - pxa) ** 2 + (gy - pya) ** 2
        theta_pair = float(np.sum(dth * r2) / max(np.sum(r2), 1e-9))
        if abs(theta_pair) < 1e-7:
            return None
        px, py = pxa * det_to_decode, pya * det_to_decode
        theta_per_s = theta_pair / dt_pair_s
        th0 = theta_per_s * exposure_s      # where this exposure's arc ends
        th1 = theta_per_s * interval_s      # where the next one begins
        h, w = decode_shape_hw
        corners = np.array([[0, 0], [w, 0], [0, h], [w, h]], np.float64)
        r = float(np.max(np.hypot(corners[:, 0] - px, corners[:, 1] - py)))
        arc_px = abs(th1 - th0) * r
        if arc_px < 1.5:
            return None                     # the gap is under a star width
        n_steps = int(min(np.ceil(arc_px / 2.0), 8))
        return (px, py, th0, th1, n_steps)
    except Exception:
        return None


def fill_trail_gaps(trail_max: np.ndarray, rgb: np.ndarray, fill,
                    gain: float = 1.0, thr_sigma: float = 5.0) -> None:
    """Bridge one frame's stars across the inter-exposure gap, in place.

    ``trail_max`` is the running uint16 lighten-max; ``rgb`` the frame's
    camera-space uint16 decode; ``fill`` the plan from :func:`plan_fill`.
    Only star light takes part: the frame minus its own smooth background
    (a 1/8-scale box blur), kept where it clears the noise floor by
    ``thr_sigma`` sigma — so the ground, the airglow and the sky gradient
    all stay exactly where the exposure put them.
    """
    import cv2

    px, py, th0, th1, n_steps = fill
    h, w = rgb.shape[:2]
    small = cv2.resize(rgb, (max(w // 8, 1), max(h // 8, 1)),
                       interpolation=cv2.INTER_AREA)
    bgup = cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)
    star = cv2.subtract(rgb, bgup)          # uint16, saturates at zero
    sub = star[::8, ::8].astype(np.float32)
    med = float(np.median(sub))
    sigma = 1.4826 * float(np.median(np.abs(sub - med)))
    thr = med + thr_sigma * max(sigma, 1.0)
    star[star < thr] = 0
    if gain != 1.0:
        star = np.clip(star.astype(np.float32) * gain,
                       0, 65535).astype(np.uint16)
    # the trail image carries the sky's own level; the star image had it
    # subtracted, so it goes back on as a flat per-channel floor — the
    # bridges then land at the brightness the star actually had
    lvl = np.percentile(rgb[::16, ::16].reshape(-1, rgb.shape[2]),
                        20, axis=0)
    floor = tuple(float(v) for v in lvl) + (0.0,)
    for j in range(1, n_steps + 1):
        ang = th0 + (th1 - th0) * j / (n_steps + 1)
        c_, s_ = float(np.cos(ang)), float(np.sin(ang))
        M = np.array([[c_, -s_, px - c_ * px + s_ * py],
                      [s_, c_, py - s_ * px - c_ * py]], np.float32)
        warped = cv2.warpAffine(star, M, (w, h),
                                flags=cv2.INTER_LINEAR,
                                borderMode=cv2.BORDER_CONSTANT,
                                borderValue=0)
        warped = cv2.add(warped, floor)     # saturating uint16 add
        cv2.max(trail_max, warped, dst=trail_max)
