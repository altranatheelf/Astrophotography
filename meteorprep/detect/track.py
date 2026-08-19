"""Multi-frame candidate tracking (§3.5) in world coordinates, so sky
rotation never masquerades as object motion.  Aircraft and satellites move
progressively across frames; meteors do not persist."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from meteorprep.detect.hough import Streak
from meteorprep.detect.radiant import _unit


@dataclass
class Candidate:
    id: str
    streaks: list[Streak]
    frames: list[str]                      # frame filenames
    endpoints_world: list[tuple]           # ((ra0,dec0),(ra1,dec1)) per streak
    endpoints_pix_base: tuple = None       # merged endpoints, base-frame px
    length_deg: float = 0.0
    peak_adu: float = 0.0
    fwhm_px: float = 0.0
    color_rgb: tuple = (1.0, 1.0)
    dash_pattern: list = field(default_factory=list)
    persistence: int = 1
    radiant_miss_deg: float = float("nan")
    confidence: float = 0.0
    label: str = "unclassified"
    flags: dict = field(default_factory=dict)
    spans_boundary: bool = False
    rotation_deg: float = 0.0              # sky rotation vs base frame
    physics: dict = field(default_factory=dict)   # estimates + assumptions

    def to_dict(self) -> dict:
        return {
            "id": self.id, "frames": self.frames,
            "confidence": round(self.confidence, 3),
            "label": self.label,
            "flags": self.flags,
            "likely_perseid": self.flags.get("likely_perseid", False),
            "radiant_miss_deg": None if np.isnan(self.radiant_miss_deg)
            else round(self.radiant_miss_deg, 2),
            "endpoints_base_px": self.endpoints_pix_base,
            "endpoints_world": self.endpoints_world,
            "length_deg": round(self.length_deg, 3),
            "peak_adu": round(self.peak_adu, 1),
            "fwhm_px": round(self.fwhm_px, 2),
            "persistence": self.persistence,
            "spans_boundary": self.spans_boundary,
            "rotation_deg": round(self.rotation_deg, 4),
            "physics": self.physics,
        }


def _seg_min_sep_deg(seg_a, seg_b) -> float:
    """Approximate minimum angular separation between two world segments,
    sampled along both."""
    pa = [np.asarray(_unit(*p)) for p in seg_a]
    pb = [np.asarray(_unit(*p)) for p in seg_b]
    best = np.pi
    for t in np.linspace(0, 1, 8):
        a = pa[0] + t * (pa[1] - pa[0])
        a /= np.linalg.norm(a)
        for s_ in np.linspace(0, 1, 8):
            b = pb[0] + s_ * (pb[1] - pb[0])
            b /= np.linalg.norm(b)
            best = min(best, np.arccos(np.clip(a @ b, -1, 1)))
    return float(np.rad2deg(best))


def build_tracks(streaks_per_frame: dict[int, list[Streak]],
                 world_endpoints,  # fn(frame_index, streak) -> ((ra,dec),(ra,dec))
                 frame_files: list[str],
                 match_deg: float = 2.5) -> list[Candidate]:
    """Chain streaks across temporally adjacent frames when their world
    positions abut or continue a consistent motion."""
    entries = []  # (frame_index, streak, world_seg)
    for fi in sorted(streaks_per_frame):
        for s in streaks_per_frame[fi]:
            entries.append((fi, s, world_endpoints(fi, s)))

    used = [False] * len(entries)
    tracks: list[list[int]] = []
    for i, (fi, s, seg) in enumerate(entries):
        if used[i]:
            continue
        chain = [i]
        used[i] = True
        cur_fi, cur_seg = fi, seg
        extended = True
        while extended:
            extended = False
            for j, (fj, sj, segj) in enumerate(entries):
                if used[j] or fj <= cur_fi or fj > cur_fi + 2:
                    continue
                if _seg_min_sep_deg(cur_seg, segj) <= match_deg:
                    chain.append(j)
                    used[j] = True
                    cur_fi, cur_seg = fj, segj
                    extended = True
                    break
        tracks.append(chain)

    out = []
    for k, chain in enumerate(tracks):
        streaks = [entries[i][1] for i in chain]
        segs = [entries[i][2] for i in chain]
        fis = [entries[i][0] for i in chain]
        length = max(
            np.rad2deg(np.arccos(np.clip(
                np.asarray(_unit(*seg[0])) @ np.asarray(_unit(*seg[1])), -1, 1)))
            for seg in segs)
        out.append(Candidate(
            id=f"C{k:03d}",
            streaks=streaks,
            frames=[frame_files[fi] for fi in fis],
            endpoints_world=[[list(seg[0]), list(seg[1])] for seg in segs],
            length_deg=float(length),
            peak_adu=float(max(s.peak_intensity for s in streaks)),
            fwhm_px=float(np.median([s.fwhm_px for s in streaks])),
            color_rgb=(float(np.mean([s.color_rg for s in streaks])),
                       float(np.mean([s.color_bg for s in streaks]))),
            dash_pattern=[s.dash_score for s in streaks],
            persistence=len(set(fis)),
        ))
    return out
