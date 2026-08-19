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


def _seg_box(s, pad=0.0):
    return (min(s.x0, s.x1) - pad, min(s.y0, s.y1) - pad,
            max(s.x0, s.x1) + pad, max(s.y0, s.y1) + pad)


def _boxes_touch(a, b) -> bool:
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


def _seg_angle_deg(s) -> float:
    return float(np.rad2deg(np.arctan2(s.y1 - s.y0, s.x1 - s.x0)) % 180.0)


def merge_same_frame_fragments(candidates: list[Candidate],
                               world_endpoints=None,
                               pad: float = 25.0,
                               ang_tol_deg: float = 45.0) -> list[Candidate]:
    """One streak, one candidate.

    A bright meteor is not a thin line: its glow spreads far past the
    core, and the line finder answers a broad glowing smear with a
    handful of overlapping line segments.  Measured on an injected
    fireball, a single meteor came back as twelve candidates inside one
    200-pixel patch — twelve layers in the PSD for one meteor, and twelve
    rows in the report.

    Candidates from the SAME single frame whose segments overlap and run
    in roughly the same direction are therefore folded into one, keeping
    the longest as the representative and stretching its endpoints to the
    extremes of the group.  Multi-frame tracks (satellites, aircraft) are
    left alone: their identity comes from motion across frames, which
    this cannot improve on.
    """
    singles = [k for k, c in enumerate(candidates)
               if len(set(c.frames)) == 1 and len(c.streaks) == 1]
    parent = {k: k for k in singles}

    def find(k):
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    by_frame: dict[str, list[int]] = {}
    for k in singles:
        by_frame.setdefault(candidates[k].frames[0], []).append(k)
    for _f, ks in by_frame.items():
        for ii, ka in enumerate(ks):
            sa = candidates[ka].streaks[0]
            for kb in ks[ii + 1:]:
                sb = candidates[kb].streaks[0]
                if not _boxes_touch(_seg_box(sa, pad), _seg_box(sb, pad)):
                    continue
                d = abs(_seg_angle_deg(sa) - _seg_angle_deg(sb))
                if min(d, 180.0 - d) > ang_tol_deg:
                    continue
                ra, rb = find(ka), find(kb)
                if ra != rb:
                    parent[rb] = ra

    groups: dict[int, list[int]] = {}
    for k in singles:
        groups.setdefault(find(k), []).append(k)

    drop = set()
    for root, members in groups.items():
        if len(members) < 2:
            continue
        best = max(members, key=lambda k: candidates[k].length_deg)
        keep = candidates[best]
        pts = []
        for k in members:
            s = candidates[k].streaks[0]
            pts += [(s.x0, s.y0), (s.x1, s.y1)]
            if k != best:
                drop.add(k)
        # the two endpoints furthest apart describe the whole streak
        far = max(((p, q) for i, p in enumerate(pts) for q in pts[i + 1:]),
                  key=lambda pq: (pq[0][0] - pq[1][0]) ** 2
                  + (pq[0][1] - pq[1][1]) ** 2)
        s = keep.streaks[0]
        s.x0, s.y0 = float(far[0][0]), float(far[0][1])
        s.x1, s.y1 = float(far[1][0]), float(far[1][1])
        keep.endpoints_pix_base = [[s.x0, s.y0], [s.x1, s.y1]]
        keep.peak_adu = max(candidates[k].peak_adu for k in members)
        keep.confidence = max(candidates[k].confidence for k in members)
        keep.fwhm_px = max(candidates[k].fwhm_px for k in members)
        keep.flags = dict(keep.flags)
        keep.flags["merged_fragments"] = len(members)
        # the segment changed, so its sky coordinates and angular length
        # have to change with it — everything downstream (the radiant
        # test, the physics estimates) reads those, not the pixels
        if world_endpoints is not None:
            try:
                seg = world_endpoints(s.frame_index, s)
                keep.endpoints_world = [[list(seg[0]), list(seg[1])]]
                keep.length_deg = float(np.rad2deg(np.arccos(np.clip(
                    np.asarray(_unit(*seg[0])) @ np.asarray(_unit(*seg[1])),
                    -1, 1))))
            except Exception:
                pass
    if drop:
        import logging
        logging.getLogger("meteorprep").info(
            "merged %d overlapping detection(s) into %d streak(s) — a "
            "bright meteor's glow answers the line finder more than once",
            len(drop), sum(1 for g in groups.values() if len(g) > 1))
    return [c for k, c in enumerate(candidates) if k not in drop]
