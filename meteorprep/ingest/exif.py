"""EXIF extraction and exposure timing (§2.2).

Primary source is ``exiftool`` (subprocess, JSON mode).  Fallbacks: a
``frames_meta.json`` sidecar in the input folder (synthetic/test data and
pre-scraped folders), then PIL EXIF for TIFFs.

Timing model: ``DateTimeOriginal`` has 1-second granularity, which is
provably sufficient (0.2 px worst-case corner effect); Canon
``SubSecTimeOriginal`` is recorded but never used for geometry.  All
rotation math uses the mid-exposure epoch ``DateTimeOriginal + Exposure/2``.
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

log = logging.getLogger("meteorprep")

EXIF_TAGS = ["DateTimeOriginal", "SubSecTimeOriginal", "ExposureTime", "ISO",
             "FNumber", "FocalLength", "FocalLengthIn35mmFormat", "Model",
             "LensModel", "Orientation", "ImageWidth", "ImageHeight"]


@dataclass
class FrameMeta:
    path: Path
    file: str
    datetime_original: datetime
    exposure_s: float = 20.0
    iso: int = 0
    fnumber: float = 0.0
    focal_mm: float = 16.0
    model: str = ""
    lens_model: str = ""
    width: int = 0
    height: int = 0
    subsec: str = ""            # recorded, never used for geometry
    lightpainted: bool = False
    group_id: str = ""
    wcs_source: str = ""        # "solved" | "propagated" | ""
    solve_rms_px: float = float("nan")
    extra: dict = field(default_factory=dict)

    @property
    def epoch_mid(self) -> datetime:
        return self.datetime_original + timedelta(seconds=self.exposure_s / 2.0)

    def to_dict(self) -> dict:
        return {
            "file": self.file, "epoch_mid": self.epoch_mid.isoformat(),
            "exposure_s": self.exposure_s, "iso": self.iso,
            "focal_mm": self.focal_mm, "lightpainted": self.lightpainted,
            "wcs_source": self.wcs_source or None,
            "solve_rms_px": None if self.solve_rms_px != self.solve_rms_px
            else round(self.solve_rms_px, 3),
        }


def _parse_dt(value: str) -> datetime:
    value = value.strip()
    # EXIF style "2026:08:13 02:14:07" or ISO
    for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(value, fmt)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return datetime.fromisoformat(value)


EXIFTOOL_FALLBACK_PATHS = [
    "/usr/local/bin/exiftool",       # exiftool.org installer / Intel Homebrew
    "/opt/homebrew/bin/exiftool",    # Apple Silicon Homebrew
    "/usr/bin/exiftool",
]


def find_exiftool() -> str | None:
    """Locate exiftool even when the app inherits a minimal PATH (a common
    macOS situation for GUI-launched processes)."""
    exe = shutil.which("exiftool")
    if exe:
        return exe
    for p in EXIFTOOL_FALLBACK_PATHS:
        if Path(p).is_file():
            return p
    return None


class ExiftoolError(RuntimeError):
    """exiftool exists but running it failed — not an install problem."""


def _from_exiftool(paths: list[Path]) -> list[FrameMeta] | None:
    exe = find_exiftool()
    if exe is None:
        return None
    cmd = [exe, "-j", "-n"] + [f"-{t}" for t in EXIF_TAGS] + [str(p) for p in paths]
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=600)
        # exiftool exits non-zero if ANY file has minor issues but still
        # emits JSON for the rest — use the output when there is one
        if not out.stdout.strip():
            raise ExiftoolError(
                "exiftool is installed but couldn't read these files.\n"
                f"Its message was: {out.stderr.decode(errors='replace')[:500]}")
        records = json.loads(out.stdout)
    except ExiftoolError:
        raise
    except (subprocess.SubprocessError, json.JSONDecodeError, OSError) as exc:
        raise ExiftoolError(
            f"exiftool is installed at {exe} but failed to run: {exc}") from exc
    metas = []
    for rec in records:
        p = Path(rec["SourceFile"])
        metas.append(FrameMeta(
            path=p, file=p.name,
            datetime_original=_parse_dt(str(rec.get("DateTimeOriginal", "1970:01:01 00:00:00"))),
            exposure_s=float(rec.get("ExposureTime", 20.0)),
            iso=int(rec.get("ISO", 0) or 0),
            fnumber=float(rec.get("FNumber", 0) or 0),
            focal_mm=float(rec.get("FocalLength", 16.0) or 16.0),
            model=str(rec.get("Model", "")),
            lens_model=str(rec.get("LensModel", "")),
            width=int(rec.get("ImageWidth", 0) or 0),
            height=int(rec.get("ImageHeight", 0) or 0),
            subsec=str(rec.get("SubSecTimeOriginal", "")),
        ))
    return metas


def _from_sidecar(paths: list[Path]) -> list[FrameMeta] | None:
    """frames_meta.json in the folder (synthetic data / pre-scraped)."""
    if not paths:
        return None
    sidecars = {p.parent / "frames_meta.json" for p in paths}
    table = {}
    for sc in sidecars:
        if sc.exists():
            for rec in json.loads(sc.read_text()):
                table[sc.parent / rec["file"]] = rec
    if not table:
        return None
    metas = []
    for p in paths:
        rec = table.get(p)
        if rec is None:
            return None  # incomplete sidecar: fall through to other sources
        metas.append(FrameMeta(
            path=p, file=p.name,
            datetime_original=_parse_dt(rec["DateTimeOriginal"]),
            exposure_s=float(rec.get("ExposureTime", 20.0)),
            iso=int(rec.get("ISO", 0)),
            fnumber=float(rec.get("FNumber", 0)),
            focal_mm=float(rec.get("FocalLength", 16.0)),
            model=str(rec.get("Model", "")),
            lens_model=str(rec.get("LensModel", "")),
            width=int(rec.get("ImageWidth", 0)),
            height=int(rec.get("ImageHeight", 0)),
        ))
    return metas


def read_metadata(paths: list[Path]) -> list[FrameMeta]:
    """Extract metadata for all frames, sorted by DateTimeOriginal."""
    metas = _from_sidecar(paths)
    if metas is None:
        try:
            metas = _from_exiftool(paths)
        except ExiftoolError as exc:
            raise RuntimeError(str(exc)) from exc
    if metas is None:
        raise RuntimeError(
            "I couldn't find the free helper program 'exiftool', which reads "
            "the capture times from your photos. Install it from "
            "https://exiftool.org (Mac: download the installer package, "
            "double-click it, done), then run METEORPREP again. If you HAVE "
            "installed it, open Terminal, run:  which exiftool  — and report "
            "what it prints.")
    metas.sort(key=lambda m: m.datetime_original)
    return metas


def scan_input_dir(input_dir: Path, extensions) -> list[Path]:
    """Recursive, case-insensitive frame discovery (§2.5)."""
    exts = {e.lower() for e in extensions}
    out = [p for p in sorted(Path(input_dir).rglob("*"))
           if p.is_file() and p.suffix.lower() in exts
           and p.name != "frames_meta.json"]
    return out
