"""Meteor vs aircraft / satellite / cosmic-ray discrimination (§3.6).

Unlike detect_meteors (whose aircraft hook only annotates a likelihood),
the decision here *filters* the curated meteor set — but flagged
candidates are kept, surfaced in the hidden FLAGGED PSD group and the
sidecar, so the human can always override.
"""

from __future__ import annotations

import logging

import numpy as np

from meteorprep.detect.radiant import radiant_miss_deg
from meteorprep.detect.track import Candidate

log = logging.getLogger("meteorprep")


def _is_collinear_abutting(a: Candidate, b: Candidate, gap_deg: float) -> bool:
    """Boundary-spanning meteor test (§3.8): two single-frame streaks in
    adjacent frames, collinear and nearly abutting in world coords."""
    from meteorprep.detect.radiant import _unit

    sa, sb = a.endpoints_world[-1], b.endpoints_world[0]
    ua = [np.asarray(_unit(*p)) for p in sa]
    ub = [np.asarray(_unit(*p)) for p in sb]
    # nearest pair of endpoints must abut
    gaps = [np.rad2deg(np.arccos(np.clip(x @ y, -1, 1))) for x in ua for y in ub]
    if min(gaps) > gap_deg:
        return False
    # direction vectors must be parallel (great-circle normals aligned)
    na, nb = np.cross(ua[0], ua[1]), np.cross(ub[0], ub[1])
    na /= np.linalg.norm(na) + 1e-12
    nb /= np.linalg.norm(nb) + 1e-12
    return abs(na @ nb) > np.cos(np.deg2rad(5.0))


def classify(candidates: list[Candidate], cfg, radiant_radec) -> list[Candidate]:
    """Assign labels/flags in place and merge boundary-spanning meteors."""
    # --- merge boundary-spanning meteors before labelling ---------------
    merged: list[Candidate] = []
    skip = set()
    for i, a in enumerate(candidates):
        if i in skip:
            continue
        if a.persistence == 1:
            for j in range(i + 1, len(candidates)):
                b = candidates[j]
                # a meteor can only straddle ADJACENT exposures — abutting
                # collinear streaks hours apart are a repeating satellite
                # track, not one event
                adjacent = abs(a.streaks[0].frame_index
                               - b.streaks[0].frame_index) == 1
                if (j not in skip and b.persistence == 1 and adjacent
                        and _is_collinear_abutting(a, b, cfg.boundary_gap_deg)):
                    a.streaks += b.streaks
                    a.frames += b.frames
                    a.endpoints_world += b.endpoints_world
                    a.spans_boundary = True
                    a.peak_adu = max(a.peak_adu, b.peak_adu)
                    skip.add(j)
                    break
        merged.append(a)

    for cand in merged:
        s = cand.streaks[0]
        flags = cand.flags
        multi = cand.persistence >= 2 and not cand.spans_boundary
        dashed = float(np.mean(cand.dash_pattern)) > 0.5
        colored = abs(cand.color_rgb[0] - 1.0) > 0.25 or abs(cand.color_rgb[1] - 1.0) > 0.25
        thin = cand.fwhm_px < cfg.fwhm_sat_px * 2  # binned-fwhm heuristic
        uniform = all(st.head_tail_ratio < 1.6 for st in cand.streaks)
        tiny = all(st.length_px < cfg.cosmic_max_px for st in cand.streaks)
        sharp = cand.fwhm_px <= 1.5

        if tiny and sharp:
            cand.label = "cosmic"
            flags["cosmic"] = True
            cand.confidence = 0.2
        elif multi and (dashed or colored):
            cand.label = "aircraft"
            flags["aircraft"] = True
            cand.confidence = 0.9
        elif multi and thin and uniform:
            cand.label = "satellite"
            flags["satellite"] = True
            cand.confidence = 0.85
        elif multi and not thin and s.aspect < 3.0:
            cand.label = "observatory_beam"
            flags["beam"] = True
            cand.confidence = 0.5
        elif multi:
            # persistent but neither dashed/coloured nor thin/uniform:
            # flag as satellite-like rather than curating it as a meteor
            cand.label = "satellite"
            flags["satellite"] = True
            cand.confidence = 0.6
        else:
            cand.label = "meteor"
            gradient = max(st.head_tail_ratio for st in cand.streaks)
            cand.confidence = float(np.clip(
                0.5 + 0.1 * np.log10(max(cand.streaks[0].score, 1e-3))
                + (0.15 if gradient >= 1.5 else 0.0)
                + (0.1 if cand.streaks[0].aspect >= 5 else 0.0), 0.05, 0.99))

        # radiant scoring — advisory flag only (§3.7)
        if cand.label == "meteor" and cand.endpoints_world:
            seg = cand.endpoints_world[0]
            cand.radiant_miss_deg = radiant_miss_deg(seg[0], seg[1], radiant_radec)
            flags["likely_perseid"] = cand.radiant_miss_deg < cfg.radiant_tol_deg
        if cand.spans_boundary:
            flags["boundary"] = True

    kept = [c for c in merged if c.label != "cosmic"]
    n_rej = len(merged) - len(kept)
    if n_rej:
        log.info("rejected %d cosmic-ray candidates", n_rej)
    return kept
