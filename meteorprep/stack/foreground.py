"""Foreground candidate layers (§5.3): the base-time non-light-painted
frame's ground region, each light-painted frame's ground, and an optional
sigma-clipped foreground-only stack.  All are emitted as toggleable PSD
layers; the human chooses."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from meteorprep.stack.base_sky import stack_band


@dataclass
class ForegroundLayer:
    name: str
    image: np.ndarray       # (H, W, 3) float32
    alpha: np.ndarray       # (H, W) float32 in [0, 1] — ground region
    default_visible: bool = False


def make_foreground_layers(base_frame_rgb: np.ndarray,
                           lightpainted_rgbs: dict[str, np.ndarray],
                           stack_rgbs: list[np.ndarray] | None,
                           sky_mask: np.ndarray) -> list[ForegroundLayer]:
    ground_alpha = 1.0 - sky_mask.astype(np.float32)
    layers = [ForegroundLayer("FG_base_time", base_frame_rgb.astype(np.float32),
                              ground_alpha, default_visible=True)]
    for name, rgb in lightpainted_rgbs.items():
        layers.append(ForegroundLayer(f"FG_lightpaint_{name}",
                                      rgb.astype(np.float32), ground_alpha))
    if stack_rgbs:
        stacked = stack_band(np.stack(stack_rgbs))
        layers.append(ForegroundLayer("FG_stacked", stacked, ground_alpha))
    return layers
