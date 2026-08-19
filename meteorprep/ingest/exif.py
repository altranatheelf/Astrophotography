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
             "LensModel", "Orientation", "ImageWidth", "ImageHeight",
             "FocalPlaneXResolution", "FocalPlaneResolutionUnit",
             "GPSLatitude", "GPSLongitude"]


@dataclass
class FrameMeta:
    path: Path
    file: str
    datetime_original: datetime
    exposure_s: float = 20.0
    iso: int = 0
    fnumber: float = 0.0
    focal_mm: float = 16.0
    pixel_pitch_um: float = 0.0   # 0 = the file doesn't say
    model: str = ""
    lens_model: str = ""
    width: int = 0
    height: int = 0
    subsec: str = ""            # recorded, never used for geometry
    lightpainted: bool = False
    group_id: str = ""
    wcs_source: str = ""        # "solved" | "propagated" | ""
    solve_rms_px: float = float("nan")
    gps_lat: float | None = None   # None = the camera didn't record it
    gps_lon: float | None = None
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


def _gps_deg(value) -> float | None:
    """exiftool -n gives a signed decimal degree; without -n it gives
    "44 deg 19' 39.00\" N".  Accept either, and treat anything else as
    "the camera did not record a position" rather than guessing."""
    if value in (None, "", 0):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        pass
    import re
    txt = str(value)
    nums = [float(x) for x in re.findall(r"[-+]?\d+(?:\.\d+)?", txt)]
    if not nums:
        return None
    deg = nums[0] + (nums[1] / 60.0 if len(nums) > 1 else 0.0) \
        + (nums[2] / 3600.0 if len(nums) > 2 else 0.0)
    if re.search(r"[SW]\s*$", txt.strip(), re.I):
        deg = -deg
    return deg


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


def _pixel_pitch_um(rec: dict) -> float:
    """Sensor pixel spacing in microns, from EXIF; 0.0 when unknowable.

    Primary: FocalPlaneXResolution (pixels per inch/cm/mm on the sensor).
    Fallback: FocalLengthIn35mmFormat / FocalLength gives the crop factor,
    hence the sensor width, divided by the recorded pixel width.
    Values outside the range of real camera sensors are distrusted.
    """
    pitch = 0.0
    try:
        fpxr = float(rec.get("FocalPlaneXResolution", 0) or 0)
        if fpxr > 0:
            unit = int(rec.get("FocalPlaneResolutionUnit", 2) or 2)
            unit_um = {2: 25400.0, 3: 10000.0, 4: 1000.0}.get(unit, 25400.0)
            pitch = unit_um / fpxr
        else:
            f = float(rec.get("FocalLength", 0) or 0)
            f35 = float(rec.get("FocalLengthIn35mmFormat", 0) or 0)
            w = float(rec.get("ImageWidth", 0) or 0)
            if f > 0 and f35 > 0 and w > 0:
                pitch = 36000.0 * f / (f35 * w)
    except (TypeError, ValueError):
        return 0.0
    return pitch if 1.0 <= pitch <= 12.0 else 0.0


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


EXIFTOOL_BATCH = 40
EXIFTOOL_BATCH_TIMEOUT_S = 240


def _from_exiftool(paths: list[Path]) -> list[FrameMeta] | None:
    exe = find_exiftool()
    if exe is None:
        return None

    def _read_batch(batch):
        cmd = ([exe, "-j", "-n", "-fast2"] + [f"-{t}" for t in EXIF_TAGS]
               + [str(p) for p in batch])
        try:
            out = subprocess.run(cmd, capture_output=True,
                                 timeout=EXIFTOOL_BATCH_TIMEOUT_S)
            # exiftool exits non-zero if ANY file has minor issues but
            # still emits JSON for the rest — use the output when present
            if not out.stdout.strip():
                raise ExiftoolError(
                    "exiftool is installed but couldn't read these files.\n"
                    f"Its message was: {out.stderr.decode(errors='replace')[:500]}")
            return json.loads(out.stdout)
        except subprocess.TimeoutExpired as exc:
            raise ExiftoolError(
                "Reading the photos is taking far too long — this almost "
                "always means the files aren't actually ON this Mac yet "
                "(iCloud keeps Desktop/Documents files in the cloud and only "
                "downloads them on demand).\nFix: open the photo folder in "
                "Finder, select all the files (Cmd-A), right-click and "
                "choose 'Download Now', wait for the little cloud icons to "
                "disappear, then press Prepare again. Or move the folder "
                "somewhere not synced to iCloud, like your Pictures folder."
            ) from exc
        except ExiftoolError:
            raise
        except (subprocess.SubprocessError, json.JSONDecodeError, OSError) as exc:
            raise ExiftoolError(
                f"exiftool is installed at {exe} but failed to run: {exc}") from exc

    batches = [paths[s:s + EXIFTOOL_BATCH]
               for s in range(0, len(paths), EXIFTOOL_BATCH)]
    records = []
    # batches are independent exiftool processes: run a few side by side
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=min(4, len(batches))) as tp:
        for k, recs in enumerate(tp.map(_read_batch, batches)):
            records.extend(recs)
            log.info("reading photo info (%d/%d)…",
                     min((k + 1) * EXIFTOOL_BATCH, len(paths)), len(paths))
    metas = []
    for rec in records:
        p = Path(rec["SourceFile"])
        if not rec.get("DateTimeOriginal"):
            log.warning("skipping %s — no capture time in its metadata "
                        "(not a camera frame?)", p.name)
            continue
        try:
            dt = _parse_dt(str(rec["DateTimeOriginal"]))
        except ValueError:
            log.warning("skipping %s — unreadable capture time %r (camera "
                        "clock was never set?)", p.name,
                        rec["DateTimeOriginal"])
            continue
        metas.append(FrameMeta(
            path=p, file=p.name,
            datetime_original=dt,
            exposure_s=float(rec.get("ExposureTime", 20.0)),
            iso=int(rec.get("ISO", 0) or 0),
            fnumber=float(rec.get("FNumber", 0) or 0),
            focal_mm=float(rec.get("FocalLength", 16.0) or 16.0),
            pixel_pitch_um=_pixel_pitch_um(rec),
            model=str(rec.get("Model", "")),
            lens_model=str(rec.get("LensModel", "")),
            width=int(rec.get("ImageWidth", 0) or 0),
            height=int(rec.get("ImageHeight", 0) or 0),
            subsec=str(rec.get("SubSecTimeOriginal", "")),
            gps_lat=_gps_deg(rec.get("GPSLatitude")),
            gps_lon=_gps_deg(rec.get("GPSLongitude")),
        ))
    if not metas:
        raise ExiftoolError(
            "None of the files in that folder carry a capture time — are "
            "these the original RAW files from the camera?")
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
            pixel_pitch_um=_pixel_pitch_um(rec),
            model=str(rec.get("Model", "")),
            lens_model=str(rec.get("LensModel", "")),
            width=int(rec.get("ImageWidth", 0)),
            height=int(rec.get("ImageHeight", 0)),
            gps_lat=_gps_deg(rec.get("GPSLatitude")),
            gps_lon=_gps_deg(rec.get("GPSLongitude")),
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
    # recursive scans can collect duplicate basenames (two memory cards,
    # both with IMG_0001.CR2): everything downstream keys on m.file, so
    # disambiguate colliding names with their parent folder
    from collections import Counter
    dupes = {name for name, cnt in
             Counter(m.file for m in metas).items() if cnt > 1}
    for m in metas:
        if m.file in dupes:
            m.file = f"{m.path.parent.name}_{m.path.name}"
    return metas


def scan_input_dir(input_dir: Path, extensions) -> list[Path]:
    """Recursive, case-insensitive frame discovery (§2.5)."""
    exts = {e.lower() for e in extensions}
    out = [p for p in sorted(Path(input_dir).rglob("*"))
           if p.is_file() and p.suffix.lower() in exts
           and p.name != "frames_meta.json"]
    return out
