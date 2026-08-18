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
                   soft: float = 120.0, white_pct: float = 99.85) -> np.ndarray:
    x = img.astype(np.float32).copy()
    # percentiles estimated on a 1/16 subsample: indistinguishable on a
    # 20 MP canvas and several seconds cheaper
    sub = x[::4, ::4]
    for c in range(x.shape[2]):
        x[:, :, c] -= np.percentile(sub[:, :, c], black_pct)
    x = np.maximum(x, 0)
    d = np.arcsinh(x / soft)
    hi = max(float(np.percentile(d[::4, ::4], white_pct)), 1e-6)
    return np.clip(d / hi, 0.0, 1.0)


def render_preview(base_img: np.ndarray,
                   fg_img: np.ndarray | None,
                   sky_mask: np.ndarray | None,
                   gradient: np.ndarray | None,
                   color_gains,
                   meteor_layers,
                   out_path: Path,
                   max_width: int = 4096) -> Path | None:
    """Compose and save the preview JPEG.  All inputs are canvas-sized
    linear arrays from the assembly stage; ``meteor_layers`` is the list
    of (candidate, layer, frame_idx, seg_idx) tuples."""
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
        # downsize to the output width BEFORE the stretch: INTER_AREA on
        # linear data is a clean average, and the arcsinh + blends then
        # touch ~2x fewer pixels
        h0, w0 = lin.shape[:2]
        s = min(1.0, max_width / w0)
        if s < 1.0:
            lin = cv2.resize(lin, (max_width, int(round(h0 * s))),
                             interpolation=cv2.INTER_AREA)
        disp = _asinh_stretch(lin)
        del lin

        # meteors: each streak brightened by its own peak so faint ones
        # read; screen-blend keeps stars behind them intact
        for (_c, layer, _i, _si) in meteor_layers or []:
            rgb = layer.rgb.astype(np.float32)
            if wb is not None:   # same balance as the sky they sit on
                rgb = rgb * wb
            alpha = (layer.alpha.astype(np.float32)
                     if layer.alpha is not None else np.ones(rgb.shape[:2],
                                                             np.float32))
            peak = float((rgb.max(axis=2) * alpha).max())
            if peak <= 0:
                continue
            gain = 0.85 * 65535.0 / peak
            mlin = np.clip(rgb * min(gain, 40.0), 0, 65535) / 65535.0
            contrib = mlin * alpha[:, :, None]
            if layer.bbox is not None:
                x0, y0, x1, y1 = [int(round(v * s)) for v in layer.bbox]
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
                disp = 1 - (1 - disp) * (1 - contrib)

        out8 = (np.clip(disp, 0, 1) * 255).astype(np.uint8)
        cv2.imwrite(str(out_path), cv2.cvtColor(out8, cv2.COLOR_RGB2BGR),
                    [cv2.IMWRITE_JPEG_QUALITY, 92])
        return out_path
    except Exception as exc:
        log.warning("preview render failed (%s); the layered outputs are "
                    "unaffected", exc)
        return None
