"""The small true things the window shows: the moon tonight, the nights you
have already run, and the tidy forms of numbers the program computed.

Nothing here invents anything.  If a figure cannot be worked out from the
photographs, the clock or a past run's own record, the window does not show it.
"""

from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

# A new moon everybody agrees on (2000 Jan 6, 18:14 UTC) and the synodic month.
_NEW_MOON = datetime(2000, 1, 6, 18, 14, tzinfo=timezone.utc)
_SYNODIC = 29.530588853


def moon_phase(when: datetime | None = None) -> tuple[float, float, bool]:
    """(age in days, illuminated fraction, waxing) for a moment in time.

    The illuminated fraction is the standard cosine of the phase angle, which
    is what "3 %" on the window means — accurate to a fraction of a percent,
    and far better than the picture needs."""
    when = when or datetime.now(timezone.utc)
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    age = ((when - _NEW_MOON).total_seconds() / 86400.0) % _SYNODIC
    illum = (1 - math.cos(2 * math.pi * age / _SYNODIC)) / 2
    return age, illum, age < _SYNODIC / 2


def moon_name(age: float) -> str:
    if age < 1.0 or age > _SYNODIC - 1.0:
        return "new moon"
    if age < 6.4:
        return "waxing crescent"
    if age < 8.4:
        return "first quarter"
    if age < 13.8:
        return "waxing gibbous"
    if age < 15.8:
        return "full moon"
    if age < 21.1:
        return "waning gibbous"
    if age < 23.1:
        return "last quarter"
    return "waning crescent"


def moon_line(when: datetime | None = None) -> tuple[str, str, float, bool]:
    age, illum, waxing = moon_phase(when)
    return f"{age:.1f} d · {illum * 100:.0f} %", moon_name(age), illum, waxing


def night_of(when: datetime) -> str:
    """The night a frame belongs to.  Anything shot before noon belongs to the
    night that started the previous evening, which is how people talk about it."""
    d = when
    if d.hour < 12:
        d = d.fromordinal(d.toordinal() - 1)
    return f"Night of {d.day} {d.strftime('%B')}"


def human_size(n: int | float | None) -> str:
    if not n:
        return ""
    n = float(n)
    for unit, step in (("GB", 1 << 30), ("MB", 1 << 20), ("KB", 1 << 10)):
        if n >= step:
            v = n / step
            return f"{v:.1f} {unit}" if v < 10 and unit == "GB" else f"{v:.0f} {unit}"
    return f"{int(n)} B"


def mmss(seconds: float | None) -> str:
    if seconds is None or seconds < 0:
        return "—"
    seconds = int(round(seconds))
    return f"{seconds // 60}:{seconds % 60:02d}"


# ------------------------------------------------------------------ recents
def _store() -> Path:
    base = os.environ.get("METEORPREP_STATE_DIR")
    if base:
        p = Path(base)
    elif os.name == "nt":
        p = Path(os.environ.get("APPDATA", Path.home())) / "MeteorPrep"
    elif os.sys.platform == "darwin":
        p = Path.home() / "Library" / "Application Support" / "MeteorPrep"
    else:
        p = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state")) / "meteorprep"
    p.mkdir(parents=True, exist_ok=True)
    return p / "recent_nights.json"


def load_recents() -> list[dict]:
    try:
        data = json.loads(_store().read_text("utf-8"))
        return [r for r in data if isinstance(r, dict)][:12]
    except Exception:
        return []


def remember_night(folder: str, photos: int, meteors: int, night: str = "",
                   out_dir: str = "", report: str = "") -> list[dict]:
    """Record a finished run.  The recents list on Home is built only from
    these — runs that actually happened, on this machine."""
    rows = [r for r in load_recents() if r.get("folder") != str(folder)]
    rows.insert(0, {
        "folder": str(folder),
        "name": Path(folder).name,
        "photos": int(photos),
        "meteors": int(meteors),
        "night": night,
        "out_dir": str(out_dir),
        "report": str(report),
        "at": datetime.now().astimezone().isoformat(timespec="seconds"),
    })
    rows = rows[:12]
    try:
        _store().write_text(json.dumps(rows, indent=1), "utf-8")
    except Exception:
        pass
    return rows


def recent_label(row: dict) -> str:
    """'15 Aug' from a stored run — the night it was shot when we know it,
    else the day it was processed."""
    night = row.get("night") or ""
    if night.startswith("Night of "):
        part = night[len("Night of "):].split()
        if len(part) >= 2:
            return f"{int(part[0]):>2d} {part[1][:3]}"
    try:
        d = datetime.fromisoformat(row.get("at", ""))
        return f"{d.day:>2d} {d.strftime('%b')}"
    except Exception:
        return ""


# ------------------------------------------------------- a finished run's own record
def read_capsule(out_dir) -> dict:
    """What the run wrote about itself: capture time, integration, alignment.
    Used for the caption under the print, so every word of it is the run's."""
    out = {}
    try:
        p = Path(out_dir) / "capsule.json"
        if p.exists():
            out.update(json.loads(p.read_text("utf-8")))
    except Exception:
        pass
    try:
        p = Path(out_dir) / "meteorprep.json"
        if p.exists():
            side = json.loads(p.read_text("utf-8"))
            out["sidecar"] = side
    except Exception:
        pass
    return out


def caption_lines(out_dir, n_photos=0, meteors=0) -> tuple[str, str]:
    """The two lines engraved under the finished picture, from the run's own
    capsule: the night, the integration, the camera; then the measurements."""
    cap = read_capsule(out_dir)
    bits1, bits2 = [], []
    captured = cap.get("captured")
    if captured:
        try:
            when = datetime.fromisoformat(str(captured).replace("Z", "+00:00"))
            bits1.append(night_of(when))
        except Exception:
            pass
    integ = cap.get("integration")
    if integ:
        bits1.append(str(integ).replace(" of exposure", ""))
    side = cap.get("sidecar") or {}
    cam = (side.get("camera") or {}).get("model") if isinstance(side.get("camera"), dict) else None
    if cam:
        bits1.append(str(cam))
    align = cap.get("alignment")
    if align:
        bits2.append(str(align))
    if meteors:
        bits2.append(f"{meteors} meteor" + ("s" if meteors != 1 else ""))
    lin = cap.get("lineage")
    if lin and "ground" in str(lin):
        ground = str(lin).split("ground")[-1].strip().strip(".;")
        if ground:
            bits2.append(f"ground {ground}")
    return " · ".join(bits1), " · ".join(bits2)


__all__ = ["moon_phase", "moon_name", "moon_line", "night_of", "human_size", "mmss",
           "load_recents", "remember_night", "recent_label", "read_capsule", "caption_lines"]
