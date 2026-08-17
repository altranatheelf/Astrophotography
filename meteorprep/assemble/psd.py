"""Layered 16-bit PSD writer via pytoshop (§7.1-§7.2).

pytoshop is the primary writer but is lightly maintained (known raster-mask
and ``nested_layers_to_psd`` quirks) and may be unavailable on modern
toolchains — the PNG+JSX fallback (§7.3) is therefore always emitted
alongside, and every written PSD is validated by re-opening with psd-tools
when that package is present.  Auto-switches to PSB near the 2 GB limit.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from meteorprep.assemble.layers import Layer, LayerStack

log = logging.getLogger("meteorprep")

PSD_SIZE_LIMIT = 2 * 1024 ** 3


def pytoshop_available() -> bool:
    try:
        import pytoshop  # noqa: F401
        return True
    except ImportError:
        return False


def _to_u16(arr: np.ndarray) -> np.ndarray:
    return np.clip(arr, 0, 65535).astype(np.uint16)


def _layer_channels(layer: Layer, width: int, height: int):
    """16-bit channels + straight alpha + (top, left) for one layer.

    Bbox layers stay bbox-sized (PSD layers carry their own offsets), so a
    night with many meteor/satellite layers never balloons memory."""
    rgb = layer.rgb
    if layer.bbox is not None:
        x0, y0, x1, y1 = layer.bbox
        a = (layer.alpha if layer.alpha is not None
             else np.ones(rgb.shape[:2], np.float32))
        return _to_u16(rgb), _to_u16(a * 65535.0), y0, x0
    a = (layer.alpha if layer.alpha is not None
         else np.ones((height, width), np.float32))
    return _to_u16(rgb), _to_u16(a * 65535.0), 0, 0


def write_psd(stack: LayerStack, out_path: Path) -> Path | None:
    """Write the layer stack as PSD (or PSB when size demands); returns the
    written path or None when pytoshop is unavailable/fails."""
    try:
        import pytoshop
        from pytoshop import enums
        from pytoshop.user import nested_layers
    except ImportError:
        log.warning("pytoshop not installed — skipping PSD; use the PNG+JSX "
                    "fallback (File > Scripts > Browse in Photoshop)")
        return None

    w, h = stack.width, stack.height

    def make_image(layer: Layer):
        rgb, alpha, top, left = _layer_channels(layer, w, h)
        channels = {0: rgb[:, :, 0], 1: rgb[:, :, 1], 2: rgb[:, :, 2], -1: alpha}
        blend = (enums.BlendMode.lighten if layer.blend == "lighten"
                 else enums.BlendMode.normal)
        return nested_layers.Image(
            name=layer.name, channels=channels, visible=layer.visible,
            blend_mode=blend, top=top, left=left)

    root = [make_image(stack.base)]
    for grp in stack.groups:
        imgs = [make_image(l) for l in grp.layers]
        root.append(nested_layers.Group(name=grp.name, layers=imgs,
                                        visible=grp.visible, closed=True))
    root.reverse()  # pytoshop lists top-most first

    # estimate size: full-frame layers dominate
    n_layers = 1 + sum(len(g.layers) for g in stack.groups)
    est = n_layers * w * h * 2 * 4
    version = (enums.Version.psb if est > PSD_SIZE_LIMIT * 0.8
               else enums.Version.psd)
    if version == enums.Version.psb:
        out_path = out_path.with_suffix(".psb")
        log.warning("estimated size near the 2 GB PSD limit: writing PSB "
                    "(not all downstream tools read PSB)")

    try:
        psd = nested_layers.nested_layers_to_psd(
            root, color_mode=enums.ColorMode.rgb, depth=enums.ColorDepth.depth16,
            size=(h, w), compression=enums.Compression.rle, version=version)
        with open(out_path, "wb") as fh:
            psd.write(fh)
    except Exception as exc:
        log.error("pytoshop PSD write failed (%s) — rely on PNG+JSX fallback", exc)
        return None

    validate_psd(out_path, stack)
    return out_path


def validate_psd(path: Path, stack: LayerStack) -> bool:
    """Post-write check: re-open with psd-tools and verify layer count and
    names round-trip."""
    try:
        from psd_tools import PSDImage
    except ImportError:
        log.info("psd-tools not installed — skipping PSD validation")
        return True
    try:
        psd = PSDImage.open(path)
        names = set()

        def walk(layers):
            for l in layers:
                names.add(l.name)
                if l.is_group():
                    walk(l)
        walk(psd)
        expected = {stack.base.name} | {g.name for g in stack.groups} | {
            l.name for g in stack.groups for l in g.layers}
        missing = expected - names
        if missing:
            log.error("PSD validation: missing layers %s", missing)
            return False
        return True
    except Exception as exc:
        log.error("PSD validation failed: %s", exc)
        return False
