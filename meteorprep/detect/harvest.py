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


def line_snr(diff: np.ndarray, s, samples: int = 64,
             offsets=(9, 14, 20, 27), scale: float = 1.0) -> float:
    """How much brighter the streak is than the sky beside it.

    The Hough pass answers noise with lines: at a low threshold a handful
    of unrelated bright pixels line up often enough to look like a
    meteor.  A real streak is bright ALONG its whole length compared with
    parallel lines a few pixels to either side, and that is a direct
    measurement rather than a threshold — looked at by eye, the false
    ones were blank sky and the true ones were unmistakable.

    ``scale``: detect_streaks reports its geometry on the OUTPUT canvas,
    which at full size is twice the detection image this measures on.
    Passing the wrong one does not fail loudly — every sample simply
    clamps to the right-hand edge of the frame, and the gate quietly
    measures the border instead of the streak.
    """
    p0 = np.array([s.x0, s.y0], float) / scale
    p1 = np.array([s.x1, s.y1], float) / scale
    d = p1 - p0
    n = float(np.linalg.norm(d))
    if n < 4.0:
        return 0.0
    u = d / n
    perp = np.array([-u[1], u[0]])
    h, w = diff.shape[:2]
    t = np.linspace(0.05, 0.95, samples)[:, None]
    base = p0[None, :] + t * d[None, :]

    def sample(off):
        q = base + off * perp[None, :]
        xi = np.clip(np.round(q[:, 0]).astype(int), 0, w - 1)
        yi = np.clip(np.round(q[:, 1]).astype(int), 0, h - 1)
        return diff[yi, xi].astype(np.float32)

    on = np.maximum.reduce([sample(o) for o in (-1.0, 0.0, 1.0)])
    side = np.concatenate([sample(o) for o in offsets]
                          + [sample(-o) for o in offsets])
    med = float(np.median(side))
    # The difference image is high-passed and clipped at zero, so a clean
    # patch of sky beside a streak is mostly exact zeros and its MAD is
    # exactly zero.  The floor is what the ratio is divided by in that
    # case, so at 1e-3 ADU on a 16-bit scale it made the gate meaningless
    # — one ADU of anything scored a thousand sigma.  One ADU is the
    # smallest difference the data can actually express.
    mad = 1.4826 * float(np.median(np.abs(side - med))) + 1.0
    return float((np.median(on) - med) / mad)


def harvest_faint_meteors(load_lum, load_foot, base_lum_det: np.ndarray,
                          n: int, exclude: set, sky_bin,
                          known_segments: list, cfg, S: float,
                          world_endpoints, radiant, files: list,
                          mad_k: float = 6.0, jobs: int = 1,
                          progress=None) -> list:
    """Search every frame against the clean base; return NEW candidates
    that are classified as meteors and point at the radiant.

    ``load_lum(i)``/``load_foot(i)`` load the aligned detection-scale
    luminance/footprint; ``known_segments`` is a list of full-res
    (x0, y0, x1, y1, width) corridors from the first pass;
    ``progress(done, total)`` reports per-photo progress.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    from meteorprep.detect.classify import classify
    from meteorprep.detect.hough import detect_streaks
    from meteorprep.detect.radiant import radiant_miss_deg
    from meteorprep.detect.track import build_tracks

    hd, wd = base_lum_det.shape[:2]
    keep_mask = np.ones((hd, wd), np.uint8)
    _mask_corridors(keep_mask, known_segments, S)
    sky_ok = (sky_bin > 0) if sky_bin is not None else None

    def _one(i):
        lum = np.asarray(load_lum(i), np.float32)
        foot = np.asarray(load_foot(i))
        d = lum - base_lum_det
        # the base carries the night-AVERAGE sky surface: a frame shot in
        # brighter (moonrise/twilight) or darker sky sits wholly above or
        # below it, which would flood the threshold or clip faint streaks
        # to zero — remove this frame's own median offset first
        ok = foot != 0
        if sky_ok is not None:
            ok &= sky_ok
        sub = d[::8, ::8][ok[::8, ::8]]
        if sub.size > 100:
            d -= float(np.median(sub))
        # A scalar offset is not enough near dawn: the last frames of a
        # night sit under a twilight gradient that the night-average base
        # does not have, and at this pass's low threshold that gradient
        # IS the detection — measured, it produced ten fat "meteors" with
        # 10-20 px widths in the twilight frames.  Removing everything
        # smoother than a streak leaves the streaks and nothing else.
        import cv2 as _cv2
        d -= _cv2.GaussianBlur(d, (0, 0), 40.0)
        np.clip(d, 0, None, out=d)
        d[~ok] = 0
        d *= keep_mask
        streaks = detect_streaks(d, i, cfg, bin_factor=S, mad_k=mad_k,
                                 min_thresh=cfg.faint_min_thresh)
        kept = []
        for s in streaks:
            # detect_streaks reports on the output canvas; both gates
            # below are measurements on the detection-scale difference,
            # so the geometry comes back to that scale first.  (The width
            # limit is documented in detection pixels — "stars are 2-4 px
            # here" — and was being compared against a number twice that
            # size, which threw away real meteors.)
            if s.fwhm_px / max(float(S), 1e-6) > cfg.faint_max_fwhm_px:
                continue
            if line_snr(d, s, scale=S) < cfg.faint_min_line_snr:
                continue
            e0, e1 = world_endpoints(i, s)
            if radiant_miss_deg(e0, e1, radiant) < cfg.radiant_tol_deg:
                kept.append(s)
        return len(streaks), kept

    idx = [i for i in range(n) if i not in exclude]
    streaks_new: dict[int, list] = {}
    n_raw = 0
    done = 0
    # cv2/numpy release the GIL for the heavy ops: thread the per-frame
    # searches instead of stalling the UI for a serial second pass
    with ThreadPoolExecutor(max_workers=max(min(jobs, 4), 1)) as tp:
        futs = {tp.submit(_one, i): i for i in idx}
        for fut in as_completed(futs):
            raw_n, kept = fut.result()
            n_raw += raw_n
            if kept:
                streaks_new[futs[fut]] = kept
            done += 1
            if progress is not None:
                progress(done, len(idx))

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
