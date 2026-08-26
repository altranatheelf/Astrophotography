"""Built-in EXIF reader: capture times without installing anything.

Every RAW format this tool accepts except CR3 is a TIFF container, and
the dozen tags the pipeline needs (capture time, exposure, focal length,
sensor pitch, GPS) live in plain TIFF IFDs — no maker-note archaeology
required.  CR3 is ISO-BMFF, but Canon parks ordinary TIFF blocks inside
it (CMT1 = the main IFD, CMT2 = the EXIF IFD), so the same walker reads
those too.

exiftool, when installed, is still preferred: it knows thirty years of
vendor quirks.  This exists so a fresh download works on a machine with
nothing on it — the difference between "install two things, then drag
your folder in" and "drag your folder in".

Returns exiftool-style records (numeric values, EXIF date strings) so
the rest of ingest cannot tell the two sources apart.
"""

from __future__ import annotations

import struct
from pathlib import Path

# type id -> (struct letter, byte size)
_TYPES = {1: ("B", 1), 2: (None, 1), 3: ("H", 2), 4: ("L", 4),
          5: (None, 8), 6: ("b", 1), 7: ("B", 1), 8: ("h", 2),
          9: ("l", 4), 10: (None, 8), 11: ("f", 4), 12: ("d", 8)}

_IFD0_TAGS = {0x0100: "ImageWidth", 0x0101: "ImageHeight",
              0x0110: "Model", 0x0112: "Orientation"}
_EXIF_TAGS = {0x9003: "DateTimeOriginal", 0x9291: "SubSecTimeOriginal",
              0x829A: "ExposureTime", 0x8827: "ISO", 0x829D: "FNumber",
              0x920A: "FocalLength", 0xA405: "FocalLengthIn35mmFormat",
              0xA434: "LensModel", 0xA20E: "FocalPlaneXResolution",
              0xA210: "FocalPlaneResolutionUnit",
              0xA002: "ExifImageWidth", 0xA003: "ExifImageHeight"}
_EXIF_PTR = 0x8769
_GPS_PTR = 0x8825

_CANON_META_UUID = bytes.fromhex("85c0b687820f11e08111f4ce462b6a48")


class _Tiff:
    """One TIFF stream inside an open file, addressed by absolute seeks
    so a value parked megabytes away still reads without buffering the
    whole RAW."""

    def __init__(self, fh, base: int):
        self.fh = fh
        self.base = base
        fh.seek(base)
        head = fh.read(8)
        if len(head) < 8 or head[:2] not in (b"II", b"MM"):
            raise ValueError("not a TIFF stream")
        self.end = "<" if head[:2] == b"II" else ">"
        if struct.unpack(self.end + "H", head[2:4])[0] != 42:
            # Canon CR2 keeps 42 here too; anything else is not for us
            raise ValueError("unrecognised TIFF magic")
        self.ifd0 = struct.unpack(self.end + "I", head[4:8])[0]

    def _value(self, vtype, count, raw):
        letter, size = _TYPES.get(vtype, (None, None))
        if size is None:
            return None
        total = size * count
        if total > 4:
            off = struct.unpack(self.end + "I", raw)[0]
            self.fh.seek(self.base + off)
            data = self.fh.read(total)
        else:
            data = raw[:total]
        if len(data) < total:
            return None
        if vtype == 2:                              # ASCII
            return data.split(b"\0")[0].decode("ascii", "replace").strip()
        if vtype in (5, 10):                        # (S)RATIONAL
            kind = "II" if vtype == 5 else "ii"
            fmt = self.end + kind.replace("I", "I" if vtype == 5 else "i")
            vals = []
            for k in range(count):
                n, d = struct.unpack(
                    self.end + ("II" if vtype == 5 else "ii"),
                    data[8 * k:8 * k + 8])
                vals.append(n / d if d else 0.0)
            return vals[0] if count == 1 else vals
        vals = struct.unpack(self.end + letter * count, data)
        return vals[0] if count == 1 else list(vals)

    def ifd(self, offset) -> dict[int, object]:
        """All tags of one IFD as {tag: value}."""
        self.fh.seek(self.base + offset)
        raw = self.fh.read(2)
        if len(raw) < 2:
            return {}
        n = struct.unpack(self.end + "H", raw)[0]
        if n > 512:                    # a corrupt count would seek wildly
            return {}
        block = self.fh.read(12 * n)
        out = {}
        for k in range(n):
            ent = block[12 * k:12 * k + 12]
            if len(ent) < 12:
                break
            tag, vtype, count = struct.unpack(self.end + "HHI", ent[:8])
            try:
                out[tag] = self._value(vtype, count, ent[8:12])
            except (OSError, struct.error):
                continue
        return out


def _gps_from_ifd(gps: dict) -> dict:
    out = {}
    for ref_tag, val_tag, key in ((1, 2, "GPSLatitude"),
                                  (3, 4, "GPSLongitude")):
        v = gps.get(val_tag)
        if not isinstance(v, list) or len(v) != 3:
            continue
        deg = v[0] + v[1] / 60.0 + v[2] / 3600.0
        ref = str(gps.get(ref_tag, "") or "")
        if ref.upper() in ("S", "W"):
            deg = -deg
        out[key] = deg
    return out


def _named(ifd: dict, table: dict) -> dict:
    return {name: ifd[tag] for tag, name in table.items() if tag in ifd}


def _read_tiff_family(fh) -> dict | None:
    t = _Tiff(fh, 0)
    ifd0 = t.ifd(t.ifd0)
    rec = _named(ifd0, _IFD0_TAGS)
    if _EXIF_PTR in ifd0:
        rec.update(_named(t.ifd(ifd0[_EXIF_PTR]), _EXIF_TAGS))
    if _GPS_PTR in ifd0:
        rec.update(_gps_from_ifd(t.ifd(ifd0[_GPS_PTR])))
    return rec or None


def _read_cr3(fh) -> dict | None:
    """Walk the ISO-BMFF boxes to Canon's metadata UUID, then read the
    plain TIFF blocks inside it."""

    def boxes(start, end):
        pos = start
        while pos + 8 <= end:
            fh.seek(pos)
            head = fh.read(8)
            if len(head) < 8:
                return
            size = struct.unpack(">I", head[:4])[0]
            btype = head[4:8]
            hdr = 8
            if size == 1:
                big = fh.read(8)
                size = struct.unpack(">Q", big)[0]
                hdr = 16
            if size < hdr or pos + size > end + 1:
                return
            yield btype, pos + hdr, pos + size
            pos += size

    fh.seek(0, 2)
    fsize = fh.tell()
    rec: dict = {}
    for btype, body, bend in boxes(0, fsize):
        if btype != b"moov":
            continue
        for b2, body2, bend2 in boxes(body, bend):
            if b2 != b"uuid":
                continue
            fh.seek(body2)
            if fh.read(16) != _CANON_META_UUID:
                continue
            for b3, body3, bend3 in boxes(body2 + 16, bend2):
                try:
                    if b3 == b"CMT1":       # the main IFD, GPS included
                        t = _Tiff(fh, body3)
                        ifd0 = t.ifd(t.ifd0)
                        rec.update(_named(ifd0, _IFD0_TAGS))
                        if _GPS_PTR in ifd0:
                            rec.update(_gps_from_ifd(t.ifd(ifd0[_GPS_PTR])))
                    elif b3 == b"CMT2":     # the EXIF IFD as its own TIFF
                        t = _Tiff(fh, body3)
                        rec.update(_named(t.ifd(t.ifd0), _EXIF_TAGS))
                except ValueError:
                    continue
    return rec or None


def read_exif_mini(path: Path) -> dict | None:
    """The EXIF record for one RAW/TIFF file, or None if unreadable.
    Keys and value styles match ``exiftool -n -json``."""
    with open(path, "rb") as fh:
        magic = fh.read(12)
        fh.seek(0)
        if magic[:2] in (b"II", b"MM"):
            rec = _read_tiff_family(fh)
        elif magic[4:8] == b"ftyp":
            rec = _read_cr3(fh)
        else:
            return None
    if not rec:
        return None
    # ImageWidth on a RAW's first IFD is often the embedded preview; the
    # EXIF pixel dimensions describe the actual photo
    for a, b in (("ExifImageWidth", "ImageWidth"),
                 ("ExifImageHeight", "ImageHeight")):
        if rec.get(a):
            rec[b] = max(int(rec.get(b) or 0), int(rec[a]))
    return rec
