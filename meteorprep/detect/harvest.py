"""Second-pass faint-meteor harvest (METEORPREP 2.0 plan, Phase 3).

Round one differences each frame against a rolling 7-frame median — the
best reference available *before* the stack exists.  Once the clean
sigma-clipped base is built, differencing against it is far cleaner, so
a second pass can dig deeper (lower MAD multiplier) without drowning in
noise.  Precision is protected by three gates, per the plan's class-3
constraint:

* corridors of every already-found candidate are masked out, so only
  NEW streaks can be found;
* a streak must point back at the shower radiant (within the same
  tolerance used for the likely_perseid flag) — only one orientation of
  noise can fool a directional test;
* survivors run the full multi-frame plane/satellite gauntlet and must
  come out labelled meteor AND radiant-matched.

Everything found here is flagged ``faint_harvest`` so reports, layers
and the sidecar say honestly which pass produced it.
"""

from __future__ import annotations

import logging

import numpy as np

log = logging.getLogger("meteorprep")


def _mask_corridors(mask: np.ndarray, segments, scale: float) -> None:
    """Zero the corridors of known candidates (full-res segment coords,
    painted at detection scale)."""
    import cv2
    for (x0, y0, x1, y1, width) in segments:
        cv2.line(mask,
                 (int(round(x0 / scale)), int(round(y0 / scale))),
                 (int(round(x1 / scale)), int(round(y1 / scale))),
                 0, thickness=max(int(round(2.0 * width / scale)), 5))


def harvest_faint_meteors(load_lum, load_foot, base_lum_det: np.ndarray,
                          n: int, exclude: set, sky_bin,
                          known_segments: list, cfg, S: float,
                          world_endpoints, radiant, files: list,
                          mad_k: float = 6.0, progress=None) -> list:
    """Search every frame against the clean base; return NEW candidates
    that are classified as meteors and point at the radiant.

    ``load_lum(i)``/``load_foot(i)`` load the aligned detection-scale
    luminance/footprint; ``known_segments`` is a list of full-res
    (x0, y0, x1, y1, width) corridors from the first pass.
    """
    from meteorprep.detect.classify import classify
    from meteorprep.detect.hough import detect_streaks
    from meteorprep.detect.radiant import radiant_miss_deg
    from meteorprep.detect.track import build_tracks

    hd, wd = base_lum_det.shape[:2]
    keep_mask = np.ones((hd, wd), np.uint8)
    _mask_corridors(keep_mask, known_segments, S)

    streaks_new: dict[int, list] = {}
    n_raw = 0
    for i in range(n):
        if i in exclude:
            continue
        lum = np.asarray(load_lum(i), np.float32)
        d = lum - base_lum_det
        np.clip(d, 0, None, out=d)
        foot = np.asarray(load_foot(i))
        d[foot == 0] = 0
        if sky_bin is not None:
            d *= sky_bin
        d *= keep_mask
        streaks = detect_streaks(d, i, cfg, bin_factor=S, mad_k=mad_k)
        n_raw += len(streaks)
        kept = []
        for s in streaks:
            e0, e1 = world_endpoints(i, s)
            if radiant_miss_deg(e0, e1, radiant) < cfg.radiant_tol_deg:
                kept.append(s)
        if kept:
            streaks_new[i] = kept
        if progress is not None:
            progress(i)

    if not streaks_new:
        log.info("faint harvest: nothing new (%d raw detections, none "
                 "radiant-aligned)", n_raw)
        return []
    cands = build_tracks(streaks_new, world_endpoints, files)
    cands = classify(cands, cfg, radiant)
    out = []
    for c in cands:
        if c.label == "meteor" and c.flags.get("likely_perseid"):
            c.flags["faint_harvest"] = True
            c.confidence = min(float(c.confidence or 0.5), 0.75)
            out.append(c)
    log.info("faint harvest: %d raw -> %d radiant-aligned -> %d survived "
             "the gauntlet", n_raw,
             sum(len(v) for v in streaks_new.values()), len(out))
    return out
