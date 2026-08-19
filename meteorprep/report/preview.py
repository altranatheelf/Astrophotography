"""Ready-to-view preview render.

The layered outputs stay linear and untouched (the whole point of the
tool), but nobody should need a Photoshop session just to SEE their
night: this renders one JPEG the way a person would build it by hand —
gradient wash subtracted, star-calibrated colour, sharp foreground over
the smeared one, each meteor auto-brightened to a visible level — and
writes it next to the layered files as a preview, never a replacement.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

log = logging.getLogger("meteorprep")


def _asinh_stretch(img: np.ndarray, black_pct: float = 22.0,
                   soft: float = 120.0, white_pct: float = 99.85,
                   sky: np.ndarray | None = None) -> np.ndarray:
    """Stretch for viewing.  ``sky`` (1 = sky) restricts the black-point
    measurement to the sky: with a dark foreground in frame the whole-
    image percentile lands ON the foreground and crushes it to featureless
    black, which is exactly what the layered file is not supposed to be."""
    x = img.astype(np.float32).copy()
    # percentiles estimated on a 1/16 subsample: indistinguishable on a
    # 20 MP canvas and several seconds cheaper
    sub = x[::4, ::4]
    sel = None
    if sky is not None and sky.shape[:2] == x.shape[:2]:
        m = sky[::4, ::4] > 0.5
        if m.sum() > 1000:
            sel = m
    for c in range(x.shape[2]):
        s_c = sub[:, :, c][sel] if sel is not None else sub[:, :, c]
        x[:, :, c] -= np.percentile(s_c, black_pct)
    x = np.maximum(x, 0)
    d = np.arcsinh(x / soft)
    dsub = d[::4, ::4]
    hi = max(float(np.percentile(dsub[sel] if sel is not None else dsub,
                                 white_pct)), 1e-6)
    return np.clip(d / hi, 0.0, 1.0)


def _blend_streaks(disp: np.ndarray, layer_pairs, s: float,
                   wb: np.ndarray | None, gain_cap: float = 40.0,
                   crop_xy=(0, 0)) -> None:
    """Screen-blend each candidate layer onto the stretched canvas in
    place — each streak brightened by its own peak so faint ones read;
    ``s`` is the canvas downscale factor for bbox coordinates and
    ``crop_xy`` the seam-crop origin (layer bboxes are in UNCROPPED
    canvas coordinates)."""
    import cv2

    cx, cy = crop_xy
    for (_c, layer, _i, _si) in layer_pairs or []:
        rgb = layer.rgb.astype(np.float32)
        if wb is not None:       # same balance as the sky they sit on
            rgb = rgb * wb
        alpha = (layer.alpha.astype(np.float32)
                 if layer.alpha is not None else np.ones(rgb.shape[:2],
                                                         np.float32))
        peak = float((rgb.max(axis=2) * alpha).max())
        if peak <= 0:
            continue
        gain = 0.85 * 65535.0 / peak
        mlin = np.clip(rgb * min(gain, gain_cap), 0, 65535) / 65535.0
        contrib = mlin * alpha[:, :, None]
        if layer.bbox is not None:
            bx0, by0, bx1, by1 = layer.bbox
            x0, y0, x1, y1 = [int(round(v * s)) for v in
                              (bx0 - cx, by0 - cy, bx1 - cx, by1 - cy)]
            if x1 <= x0 or y1 <= y0:
                continue
            if s < 1.0:
                contrib = cv2.resize(contrib, (x1 - x0, y1 - y0),
                                     interpolation=cv2.INTER_AREA)
            x0c, y0c = max(x0, 0), max(y0, 0)
            x1c = min(x1, disp.shape[1])
            y1c = min(y1, disp.shape[0])
            if x1c <= x0c or y1c <= y0c:
                continue
            sub = contrib[y0c - y0:y1c - y0, x0c - x0:x1c - x0]
            region = disp[y0c:y1c, x0c:x1c]
            disp[y0c:y1c, x0c:x1c] = 1 - (1 - region) * (1 - sub)
        else:
            if contrib.shape[:2] != disp.shape[:2]:
                contrib = cv2.resize(contrib,
                                     (disp.shape[1], disp.shape[0]),
                                     interpolation=cv2.INTER_AREA)
            disp[:] = 1 - (1 - disp) * (1 - contrib)


def _save_jpg(disp: np.ndarray, out_path: Path) -> Path:
    import cv2
    out8 = (np.clip(disp, 0, 1) * 255).astype(np.uint8)
    cv2.imwrite(str(out_path), cv2.cvtColor(out8, cv2.COLOR_RGB2BGR),
                [cv2.IMWRITE_JPEG_QUALITY, 92])
    return Path(out_path)


def render_startrail(trail_img: np.ndarray, color_gains,
                     out_path: Path, max_width: int = 4096) -> Path | None:
    """Ready-to-share star-trail render: the camera-space lighten-max
    stack (trails arc, ground stays frozen), white-balanced and
    stretched the same way as the preview."""
    try:
        import cv2

        lin = trail_img.astype(np.float32)
        if color_gains is not None:
            g = np.asarray(color_gains, np.float32).reshape(1, 1, 3)
            if np.all(np.isfinite(g)) and np.all((g > 0.5) & (g < 2.0)):
                lin = lin * g
        h0, w0 = lin.shape[:2]
        s = min(1.0, max_width / w0)
        if s < 1.0:
            lin = cv2.resize(lin, (max_width, int(round(h0 * s))),
                             interpolation=cv2.INTER_AREA)
        return _save_jpg(_asinh_stretch(lin), out_path)
    except Exception as exc:
        log.warning("star-trail render failed (%s)", exc)
        return None


def render_preview(base_img: np.ndarray,
                   fg_img: np.ndarray | None,
                   sky_mask: np.ndarray | None,
                   gradient: np.ndarray | None,
                   color_gains,
                   meteor_layers,
                   out_path: Path,
                   max_width: int = 4096,
                   flagged_layers=None,
                   all_trails_path: Path | None = None,
                   crop_xy=(0, 0)) -> dict | None:
    """Compose and save the ready-to-view JPEGs.  All inputs are
    canvas-sized linear arrays from the assembly stage; layer lists hold
    (candidate, layer, frame_idx, seg_idx) tuples.

    Returns {"preview": path, "all_trails": path | None}: the classic
    meteors-on-sky look, and — when flagged candidates exist and
    ``all_trails_path`` is given — the same sky with every satellite and
    plane trail composited coherently at its true sky position."""
    try:
        import cv2

        # deliberately simple: star-calibrated white balance (global
        # per-channel gains from catalog star colours — safe) followed by
        # a plain per-channel asinh stretch, verified good-looking on real
        # nights.  Gradient subtraction and foreground compositing are
        # left to the layered file — composited blindly here they produced
        # a maroon sky and daylight-bright ground blocks (seen, not
        # theorized).
        lin = base_img.astype(np.float32)
        wb = None
        if color_gains is not None:
            g = np.asarray(color_gains, np.float32).reshape(1, 1, 3)
            if np.all(np.isfinite(g)) and np.all((g > 0.5) & (g < 2.0)):
                lin = lin * g
                wb = g
        # sharp frozen foreground over the (sweep-suppressed) sky, blended
        # in LINEAR light through the feathered horizon mask — verified by
        # eye on real frames; the same composite a person would build from
        # the layers
        if (fg_img is not None and sky_mask is not None
                and fg_img.shape[:2] == lin.shape[:2]
                and sky_mask.shape[:2] == lin.shape[:2]):
            # NOTE: the caller matches the foreground's sky level to the
            # stack before handing it over.  Matching again here made the
            # preview and the PSD disagree by 3.3x on canopy brightness.
            fgl = np.asarray(fg_img, np.float32)
            if wb is not None:
                fgl = fgl * wb
            a = (1.0 - np.clip(sky_mask.astype(np.float32), 0, 1))[..., None]
            lin = lin * (1.0 - a) + fgl * a
        # downsize to the output width BEFORE the stretch: INTER_AREA on
        # linear data is a clean average, and the arcsinh + blends then
        # touch ~2x fewer pixels
        h0, w0 = lin.shape[:2]
        s = min(1.0, max_width / w0)
        if s < 1.0:
            lin = cv2.resize(lin, (max_width, int(round(h0 * s))),
                             interpolation=cv2.INTER_AREA)
        sky_s = None
        if sky_mask is not None:
            sky_s = (cv2.resize(np.asarray(sky_mask, np.float32),
                                (lin.shape[1], lin.shape[0]),
                                interpolation=cv2.INTER_LINEAR)
                     if sky_mask.shape[:2] != lin.shape[:2] else
                     np.asarray(sky_mask, np.float32))
        disp = _asinh_stretch(lin, sky=sky_s)
        del lin

        want_all = bool(flagged_layers) and all_trails_path is not None
        _blend_streaks(disp, meteor_layers, s, wb, crop_xy=crop_xy)
        out = {"preview": _save_jpg(disp, out_path), "all_trails": None}
        if want_all:
            # same sky, now with every satellite/plane trail composited
            # at its true (sky-aligned) position; slightly lower gain cap
            # so long faint trails don't amplify into noise streaks
            _blend_streaks(disp, flagged_layers, s, wb, gain_cap=25.0,
                           crop_xy=crop_xy)
            out["all_trails"] = _save_jpg(disp, all_trails_path)
        return out
    except Exception as exc:
        log.warning("preview render failed (%s); the layered outputs are "
                    "unaffected", exc)
        return None
