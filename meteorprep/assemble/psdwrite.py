"""Native PSD writer — pure Python + numpy, no compiled dependencies.

pytoshop (the previous PSD backend) needs a C compiler at install time
and failed to build on the machines that matter, silently downgrading
the product's centrepiece to the JSX fallback.  This writes the format
directly: 16-bit RGB, layer groups, per-layer blend modes and
visibility, bbox-sized layers with offsets, ZIP-compressed channels.
Validated against psd-tools' independent parser in the test suite.

Format reference: Adobe Photoshop File Format Specification.
"""

from __future__ import annotations

import logging
import struct
import zlib
from pathlib import Path

import numpy as np

log = logging.getLogger("meteorprep")

_BLEND_KEYS = {
    "normal": b"norm",
    "lighten": b"lite",
    "subtract": b"fsub",
    "screen": b"scrn",
}


def _pascal(name: str, pad_to: int = 4) -> bytes:
    raw = name.encode("macroman", errors="replace")[:255]
    s = bytes([len(raw)]) + raw
    if len(s) % pad_to:
        s += b"\0" * (pad_to - len(s) % pad_to)
    return s


def _unicode_name(name: str) -> bytes:
    u = name.encode("utf-16-be")
    data = struct.pack(">I", len(name)) + u
    if len(data) % 4:
        data += b"\0" * (4 - len(data) % 4)
    return b"8BIM" + b"luni" + struct.pack(">I", len(data)) + data


def _lsct(kind: int, blend: bytes = b"pass") -> bytes:
    # 1 = open folder, 2 = closed folder, 3 = bounding divider
    data = struct.pack(">I", kind)
    if kind in (1, 2):
        data += b"8BIM" + blend
    return b"8BIM" + b"lsct" + struct.pack(">I", len(data)) + data


def _zip16(plane: np.ndarray) -> bytes:
    """Compression 2 (ZIP without prediction): big-endian u16, zlib."""
    return zlib.compress(plane.astype(">u2").tobytes(), 6)


class _LayerSpec:
    def __init__(self, name, rgb=None, alpha=None, bbox=None,
                 blend="normal", visible=True, lsct=None, group_blend=b"pass"):
        self.name, self.rgb, self.alpha = name, rgb, alpha
        self.bbox, self.blend, self.visible = bbox, blend, visible
        self.lsct, self.group_blend = lsct, group_blend


def _flatten_specs(stack) -> list:
    """LayerStack -> flat bottom-to-top layer list with group markers."""
    specs = [_LayerSpec(stack.base.name, stack.base.rgb,
                        getattr(stack.base, "alpha", None),
                        getattr(stack.base, "bbox", None),
                        stack.base.blend, stack.base.visible)]
    for grp in stack.groups:
        specs.append(_LayerSpec("</Layer group>", lsct=3))
        for lyr in grp.layers:
            specs.append(_LayerSpec(lyr.name, lyr.rgb, lyr.alpha, lyr.bbox,
                                    lyr.blend, lyr.visible))
        specs.append(_LayerSpec(grp.name, lsct=1, visible=grp.visible))
    return specs


def write_psd_native(stack, path: Path) -> Path:
    h, w = stack.height, stack.width
    if max(h, w) > 30000:
        raise ValueError("canvas exceeds PSD limits (PSB not implemented)")
    specs = _flatten_specs(stack)

    records, channel_blobs = [], []
    for sp in specs:
        if sp.lsct is not None:                       # group marker layer
            top = left = bottom = right = 0
            empty = struct.pack(">H", 2) + _zip16(np.zeros((0, 0), np.uint16))
            chans = [(cid, empty) for cid in (0, 1, 2)]
            blend_key = b"norm"
            extra = _unicode_name(sp.name) + _lsct(sp.lsct, sp.group_blend)
        else:
            rgb = np.clip(np.asarray(sp.rgb, np.float32), 0, 65535)
            if sp.bbox is not None:
                left, top = int(sp.bbox[0]), int(sp.bbox[1])
                right, bottom = int(sp.bbox[2]), int(sp.bbox[3])
            else:
                left = top = 0
                bottom, right = rgb.shape[0], rgb.shape[1]
            chans = []
            if sp.alpha is not None:
                a16 = np.clip(np.asarray(sp.alpha, np.float32) * 65535.0,
                              0, 65535).astype(np.uint16)
                chans.append((-1, struct.pack(">H", 2) + _zip16(a16)))
            for cid in (0, 1, 2):
                plane = rgb[:, :, cid].astype(np.uint16)
                chans.append((cid, struct.pack(">H", 2) + _zip16(plane)))
            blend_key = _BLEND_KEYS.get(sp.blend, b"norm")
            extra = _unicode_name(sp.name)

        rec = struct.pack(">iiii", top, left, bottom, right)
        rec += struct.pack(">H", len(chans))
        for cid, blob in chans:
            rec += struct.pack(">hI", cid, len(blob))
        rec += b"8BIM" + blend_key
        flags = 0 if sp.visible else 2                # bit 1 set = hidden
        rec += struct.pack(">BBBB", 255, 0, flags, 0)  # opacity, clip, flags
        name_p = _pascal(sp.name)
        extra_block = struct.pack(">I", 0)            # no layer mask
        extra_block += struct.pack(">I", 0)           # no blending ranges
        extra_block += name_p + extra
        rec += struct.pack(">I", len(extra_block)) + extra_block
        records.append(rec)
        channel_blobs.append(b"".join(blob for _, blob in chans))

    layer_info = struct.pack(">h", len(specs))
    layer_info += b"".join(records) + b"".join(channel_blobs)
    if len(layer_info) % 2:
        layer_info += b"\0"
    lm_section = struct.pack(">I", len(layer_info)) + layer_info
    lm_section += struct.pack(">I", 0)                # global mask info
    lm_block = struct.pack(">I", len(lm_section)) + lm_section

    # composite (flattened) image: the base, raw 16-bit — maximum
    # compatibility for the one part every reader touches first
    base = np.clip(np.asarray(stack.base.rgb, np.float32), 0, 65535)
    comp = np.zeros((h, w, 3), np.uint16)
    bh, bw = base.shape[:2]
    comp[:min(bh, h), :min(bw, w)] = \
        base[:min(bh, h), :min(bw, w)].astype(np.uint16)
    composite = struct.pack(">H", 0) + b"".join(
        comp[:, :, c].astype(">u2").tobytes() for c in range(3))

    with open(path, "wb") as f:
        f.write(b"8BPS" + struct.pack(">HxxxxxxHIIHH",
                                      1, 3, h, w, 16, 3))
        f.write(struct.pack(">I", 0))                 # color mode data
        f.write(struct.pack(">I", 0))                 # image resources
        f.write(lm_block)
        f.write(composite)
    log.info("PSD written natively: %s (%.0f MB)", path.name,
             path.stat().st_size / 1e6)
    return path
