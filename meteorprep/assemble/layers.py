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


def meteor_layer_name(idx: int, srcfile: str, epoch_iso: str,
                      rotation_deg: float, confidence: float, flag: str) -> str:
    ts = epoch_iso.replace("+00:00", "Z")
    return (f"M{idx:03d}_{srcfile}_{ts}_{rotation_deg:+.3f}deg_"
            f"c{confidence:.2f}_{flag}")


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
