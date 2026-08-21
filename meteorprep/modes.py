"""The three ways to run METEORPREP, in one place.

Every surface — the window, the command line, the report, the docs —
names a run the same way, because the alternative was what shipped
before this: a "Quick draft first" checkbox next to a "Fast mode:
half-resolution result" checkbox, where ticking the first one already
turned on the second one internally, and where the word "preview" meant
the mode, the other mode, and an output file.

A mode says what you GET.  Everything else about the run is identical:
the same photos are read, the same sky is solved, the same search finds
the same meteors.  A mode never changes the answer, only the picture and
the files it comes in.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Mode:
    key: str
    title: str
    blurb: str          # one line, under the title, in the window
    detail: str         # the longer explanation (tooltip / --help)
    # seconds per photo on a recent laptop, low and high; the window
    # replaces these with the machine's own measured rate after one run
    per_photo: tuple
    overhead_s: int


QUICK = Mode(
    key="quick",
    title="Quick look",
    blurb="a picture to look at now — no Photoshop file",
    detail=(
        "Reads every photo and searches every one of them exactly the "
        "way the full run does, so the meteors it reports are the real "
        "answer.\n\n"
        "What it leaves out is the expensive half: the picture comes "
        "out at half size, there is no layered Photoshop file, the "
        "second look for the very faintest meteors is skipped, and on a "
        "long night the background sky is built from a few dozen photos "
        "instead of all of them.\n\n"
        "It goes in a folder of its own called quick-look, so it can "
        "never be mixed up with the real files. Run again on Full "
        "quality afterwards and it reuses everything this worked out — "
        "the scan, the star lock and the whole search are already done."
    ),
    per_photo=(0.9, 1.8),
    overhead_s=20,
)

FULL = Mode(
    key="full",
    title="Full quality",
    blurb="the layered Photoshop file, full size",
    detail=(
        "The whole thing: every photo stacked at full resolution, each "
        "meteor cut onto its own layer, the frozen foreground, the sky "
        "tools, and the second look for the faintest meteors.\n\n"
        "This is the one that produces meteorprep.psd."
    ),
    per_photo=(2.5, 5.0),
    overhead_s=30,
)

SMALLER = Mode(
    key="smaller",
    title="Full quality, half size",
    blurb="the same layers at half size — for a tight disk or an older Mac",
    detail=(
        "Identical to Full quality — same layers, same meteors, same "
        "second look — but the canvas is half as wide and half as tall.\n\n"
        "The Photoshop file comes out around a quarter of the size and "
        "the run needs a quarter of the scratch space. Worth choosing if "
        "your disk is nearly full, or if a full-size run was more than "
        "your Mac wanted to do."
    ),
    per_photo=(1.2, 2.4),
    overhead_s=25,
)

MODES = (QUICK, FULL, SMALLER)
DEFAULT = FULL.key


def by_key(key: str) -> Mode:
    for m in MODES:
        if m.key == key:
            return m
    return FULL


def config_kwargs(key: str) -> dict:
    """The Config fields a mode sets.  Nothing else in the program should
    be deciding half_size or draft on its own."""
    if key == QUICK.key:
        return {"draft": True}
    if key == SMALLER.key:
        return {"draft": False, "half_size": True}
    return {"draft": False, "half_size": False}


def estimate(key: str, n_photos: int, measured_per_photo=None) -> str:
    """A human sentence about how long this will take, or "" when there
    is nothing worth saying.

    ``measured_per_photo``: seconds per photo from this machine's own
    last run of this mode.  A guess calibrated on someone else's laptop
    is worth exactly one run; after that the window uses the real number.
    """
    if n_photos <= 0:
        return ""
    m = by_key(key)
    if measured_per_photo:
        mid = m.overhead_s + n_photos * float(measured_per_photo)
        lo, hi = mid * 0.8, mid * 1.25
    else:
        lo = m.overhead_s + n_photos * m.per_photo[0]
        hi = m.overhead_s + n_photos * m.per_photo[1]

    def _say(sec):
        if sec < 90:
            return f"{int(round(sec / 10.0)) * 10} sec"
        return f"{sec / 60.0:.0f} min"

    if hi < 90:
        return f"about {_say(hi)}"
    lo_m, hi_m = max(int(lo // 60), 1), max(int(round(hi / 60.0)), 1)
    if lo_m >= hi_m:
        return f"about {hi_m} min"
    return f"about {lo_m}–{hi_m} min"
