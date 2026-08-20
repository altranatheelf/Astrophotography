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
    """Compression 2 (ZIP without prediction): big-endian u16, zlib.
    Level 1: ~4x faster than the default for ~15% larger files — assembly
    time matters more than a few hundred spare MB of scratch."""
    if plane.dtype == ">u2" and plane.flags["C_CONTIGUOUS"]:
        # already in wire format: hand zlib the buffer directly rather
        # than copying 40 MB into a bytes object first
        return zlib.compress(memoryview(plane), 1)
    return zlib.compress(plane.astype(">u2").tobytes(), 1)


def _layer_planes(sp) -> list:
    """The layer's channels in wire format, prepared in ONE pass.

    Doing this per channel meant three strided reads of the same layer,
    three clips and three casts, all of them holding the GIL while the
    compression threads waited.  One clip-and-cast for the whole layer
    and a contiguous split is ~8x cheaper and leaves the threads free."""
    out = []
    if sp.alpha is not None:
        a = np.clip(np.asarray(sp.alpha, np.float32) * 65535.0, 0, 65535)
        out.append(np.ascontiguousarray(a.astype(">u2")))
    rgb = np.clip(np.asarray(sp.rgb, np.float32), 0, 65535).astype(">u2")
    out += [np.ascontiguousarray(rgb[:, :, c]) for c in range(3)]
    return out


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

    # compress every channel of every layer in ONE pool: zlib releases the
    # GIL and the conversion to big-endian u16 happens inside each task, so
    # nothing full-size is duplicated up front and all cores stay busy for
    # the whole write instead of per-layer bursts
    import os
    from concurrent.futures import ThreadPoolExecutor

    futs = {}
    # measured: zlib scales to one thread per core here and no further
    # (110 MB/s at four, 100 at eight), and every extra thread is another
    # 40 MB buffer live at once
    with ThreadPoolExecutor(max_workers=max(os.cpu_count() or 4, 2)) as tp:
        for si, sp in enumerate(specs):
            if sp.lsct is not None:
                continue
            cids = ([-1] if sp.alpha is not None else []) + [0, 1, 2]
            planes = _layer_planes(sp)
            futs[si] = [(cid, tp.submit(_zip16, pl))
                        for cid, pl in zip(cids, planes)]
        records, channel_blobs = [], []
        for si, sp in enumerate(specs):
            if sp.lsct is not None:                   # group marker layer
                top = left = bottom = right = 0
                empty = struct.pack(">H", 2) + _zip16(
                    np.zeros((0, 0), np.uint16))
                chans = [(cid, empty) for cid in (0, 1, 2)]
                blend_key = b"norm"
                extra = _unicode_name(sp.name) + _lsct(sp.lsct,
                                                       sp.group_blend)
            else:
                if sp.bbox is not None:
                    left, top = int(sp.bbox[0]), int(sp.bbox[1])
                    right, bottom = int(sp.bbox[2]), int(sp.bbox[3])
                else:
                    left = top = 0
                    bottom, right = sp.rgb.shape[0], sp.rgb.shape[1]
                chans = [(cid, struct.pack(">H", 2) + fut.result())
                         for cid, fut in futs[si]]
                blend_key = _BLEND_KEYS.get(sp.blend, b"norm")
                extra = _unicode_name(sp.name)

            rec = struct.pack(">iiii", top, left, bottom, right)
            rec += struct.pack(">H", len(chans))
            for cid, blob in chans:
                rec += struct.pack(">hI", cid, len(blob))
            rec += b"8BIM" + blend_key
            flags = 0 if sp.visible else 2            # bit 1 set = hidden
            rec += struct.pack(">BBBB", 255, 0, flags, 0)
            name_p = _pascal(sp.name)
            extra_block = struct.pack(">I", 0)        # no layer mask
            extra_block += struct.pack(">I", 0)       # no blending ranges
            extra_block += name_p + extra
            rec += struct.pack(">I", len(extra_block)) + extra_block
            records.append(rec)
            channel_blobs.append(b"".join(blob for _, blob in chans))

    # The layer section is assembled as a list of parts and their total
    # length, never as one joined bytes object: joining it made a second
    # copy of every compressed channel — half a gigabyte of peak memory
    # on a 20 MP night, for the sake of one write() call.
    layer_parts = [struct.pack(">h", len(specs))] + records + channel_blobs
    layer_len = sum(len(b) for b in layer_parts)
    if layer_len % 2:
        layer_parts.append(b"\0")
        layer_len += 1
    lm_parts = ([struct.pack(">I", layer_len)] + layer_parts
                + [struct.pack(">I", 0)])             # global mask info
    lm_len = sum(len(b) for b in lm_parts)

    # composite (flattened) image: the base, raw 16-bit — maximum
    # compatibility for the one part every reader touches first.  Built
    # and written one channel at a time; the old form held the whole
    # 121 MB composite twice over before a single byte reached the disk.
    base = np.clip(np.asarray(stack.base.rgb, np.float32), 0, 65535)
    bh, bw = min(base.shape[0], h), min(base.shape[1], w)

    with open(path, "wb") as f:
        f.write(b"8BPS" + struct.pack(">HxxxxxxHIIHH",
                                      1, 3, h, w, 16, 3))
        f.write(struct.pack(">I", 0))                 # color mode data
        f.write(struct.pack(">I", 0))                 # image resources
        f.write(struct.pack(">I", lm_len))
        for part in lm_parts:
            f.write(part)
        f.write(struct.pack(">H", 0))                 # composite: raw
        for c in range(3):
            plane = np.zeros((h, w), ">u2")
            plane[:bh, :bw] = base[:bh, :bw, c].astype(np.uint16)
            f.write(memoryview(plane))
    log.info("PSD written natively: %s (%.0f MB)", path.name,
             path.stat().st_size / 1e6)
    return path
