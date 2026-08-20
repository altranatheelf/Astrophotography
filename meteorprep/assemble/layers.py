"""Layer-stack description shared by the PSD writer and the PNG+JSX
fallback, including the exact layer naming convention (§7.1):

``M{idx:03d}_{srcfile}_{iso8601}_{rot:+.3f}deg_c{conf:.2f}_{flag}``
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class Layer:
    name: str
    rgb: np.ndarray                  # float32, full-frame or bbox
    alpha: np.ndarray | None = None  # float32 [0,1]; None = opaque
    bbox: tuple | None = None        # (x0, y0, x1, y1); None = full frame
    blend: str = "normal"            # "normal" | "lighten"
    visible: bool = True


@dataclass
class LayerGroup:
    name: str
    layers: list[Layer] = field(default_factory=list)
    visible: bool = True


@dataclass
class LayerStack:
    width: int
    height: int
    base: Layer                       # bottom BASE_SKY layer
    groups: list[LayerGroup] = field(default_factory=list)


def crop_layers_to_alpha(layers: list[Layer], alpha: np.ndarray,
                         margin: int = 4, min_saving: float = 0.15) -> None:
    """Trim layers that share an alpha channel to where that alpha is
    non-zero, in place.

    A foreground layer is transparent everywhere above the treeline, and
    a transparent pixel composites to nothing — but it is still stored,
    compressed and written.  On a real night the ground reaches less than
    half the canvas, so keeping the sky half of every foreground layer
    costs a fifth of the whole document for pixels Photoshop will never
    show.  Left alone when the saving would be small, so nothing is
    cropped for the sake of a few rows.
    """
    if not layers or alpha is None:
        return
    ys, xs = np.nonzero(np.asarray(alpha) > 0.002)
    if not len(ys):
        return
    h, w = alpha.shape[:2]
    y0 = max(int(ys.min()) - margin, 0)
    y1 = min(int(ys.max()) + 1 + margin, h)
    x0 = max(int(xs.min()) - margin, 0)
    x1 = min(int(xs.max()) + 1 + margin, w)
    if (y1 - y0) * (x1 - x0) > (1.0 - min_saving) * h * w:
        return
    for lyr in layers:
        if lyr.bbox is not None or lyr.rgb.shape[:2] != (h, w):
            continue
        lyr.rgb = lyr.rgb[y0:y1, x0:x1]
        if lyr.alpha is not None and lyr.alpha.shape[:2] == (h, w):
            lyr.alpha = lyr.alpha[y0:y1, x0:x1]
        lyr.bbox = (x0, y0, x1, y1)


def meteor_layer_name(idx: int, srcfile: str, epoch_iso: str,
                      rotation_deg: float, confidence: float, flag: str,
                      physics: dict | None = None) -> str:
    ts = epoch_iso.replace("+00:00", "Z")
    name = (f"M{idx:03d}_{srcfile}_{ts}_{rotation_deg:+.3f}deg_"
            f"c{confidence:.2f}_{flag}")
    # one caption-sized fact on the layer itself; the assumptions behind
    # it live in the sidecar, never abbreviated away
    if physics and physics.get("geometry_consistent"):
        d = physics.get("est_duration_s")
        e = physics.get("elevation_deg")
        if d is not None and e is not None:
            name += f"_~{d:.2f}s_{e:.0f}deg-up"
    return name


def candidate_flag(cand) -> str:
    if cand.flags.get("aircraft"):
        return "aircraft"
    if cand.flags.get("satellite"):
        return "satellite"
    if cand.flags.get("beam"):
        return "beam"
    if cand.spans_boundary:
        return "boundary"
    if cand.flags.get("likely_perseid"):
        return "perseid"
    return "sporadic"
