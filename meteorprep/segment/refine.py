"""The horizon, done the way the big editors do it — and one step past.

Photoshop and Lightroom cut a sky with a machine-learned coarse mask and
then win or lose on what happens next: the boundary is snapped to the
real image edges, choked a pixel into the sky so nothing bright bleeds
under the silhouette, and feathered along the shape instead of with a
blind Gaussian.  Their weak spot is the coarse mask itself at night —
their models learned daytime skies, and a dark treeline on a dark sky
defeats a brightness classifier.

This module runs the same refinement chain, but the coarse mask comes
from physics the session already measured instead of a network's
daytime instincts: the frozen (camera-space) stack holds a SHARP ground
and star light smeared into arcs, while the star-aligned stack holds
SHARP stars and a motion-smeared ground.  The local high-frequency
energy ratio between the two says ground/sky per block with no
reference to brightness at all — black trees on a black sky separate as
cleanly as a daylight ridge.  Then a band-restricted fast guided filter
(He et al.) snaps the boundary onto the frozen image's actual treeline,
a smoothstep choke pulls the composite edge a hair into the sky (the
"Shift Edge" trick — this is what kills the bright lip), and pixels far
from the boundary are forced hard 0/1.

Everything is numpy + OpenCV box filters: the whole chain is a fraction
of a second at 20 MP on a laptop.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

log = logging.getLogger("meteorprep")

EDITS_NAME = "horizon_edits.png"


# ---------------------------------------------------------------------------
# fast guided filter (He, Sun — "Fast Guided Filter", arXiv:1505.00996)
# ---------------------------------------------------------------------------

def guided_filter(guide: np.ndarray, src: np.ndarray, radius: int,
                  eps: float, subsample: int = 4) -> np.ndarray:
    """Edge-preserving filter of ``src`` steered by ``guide`` (both float32
    2-D, guide roughly in [0, 1]).  The linear-model statistics are
    computed at 1/``subsample`` scale — visually identical for matting,
    ~subsample² faster."""
    import cv2

    h, w = guide.shape[:2]
    s = max(int(subsample), 1)
    if s > 1:
        gl = cv2.resize(guide, (max(w // s, 4), max(h // s, 4)),
                        interpolation=cv2.INTER_AREA)
        pl = cv2.resize(src, (gl.shape[1], gl.shape[0]),
                        interpolation=cv2.INTER_AREA)
        r = max(radius // s, 1)
    else:
        gl, pl, r = guide, src, max(radius, 1)
    ksize = (2 * r + 1, 2 * r + 1)

    def box(a):
        return cv2.boxFilter(a, -1, ksize, borderType=cv2.BORDER_REFLECT)

    mean_g = box(gl)
    mean_p = box(pl)
    corr_gp = box(gl * pl)
    corr_gg = box(gl * gl)
    var_g = corr_gg - mean_g * mean_g
    cov_gp = corr_gp - mean_g * mean_p
    a = cov_gp / (var_g + eps)
    b = mean_p - a * mean_g
    mean_a = box(a)
    mean_b = box(b)
    if s > 1:
        mean_a = cv2.resize(mean_a, (w, h), interpolation=cv2.INTER_LINEAR)
        mean_b = cv2.resize(mean_b, (w, h), interpolation=cv2.INTER_LINEAR)
    return mean_a * guide + mean_b


# ---------------------------------------------------------------------------
# the physics coarse mask: frozen sharp ground vs aligned sharp stars
# ---------------------------------------------------------------------------

def _grad_energy(lum: np.ndarray, blur: int) -> np.ndarray:
    import cv2
    gx = cv2.Sobel(lum, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(lum, cv2.CV_32F, 0, 1, ksize=3)
    e = gx * gx + gy * gy
    return cv2.boxFilter(e, -1, (blur, blur),
                         borderType=cv2.BORDER_REFLECT)


def sharpness_ground_score(base_img: np.ndarray, fg_img: np.ndarray,
                           agg_px: int = 15) -> np.ndarray:
    """log(structure in the frozen view / structure in the aligned view),
    upsampled back to the input size.

    Positive = ground (sharp when frozen, smeared when star-aligned).
    Negative = sky (arcs when frozen, point stars when aligned).
    Brightness never enters — only where the detail lives.

    Measured at HALF resolution: point stars are 2-4 px, and a deeper
    downsample averages them away, leaving the frozen view's longer star
    arcs as the only sky structure — which flips the verdict.  Each
    view's own median energy is treated as its noise floor, so the two
    stacks' different noise levels cancel instead of voting.
    """
    import cv2

    h, w = base_img.shape[:2]
    tw, th = max(w // 2, 16), max(h // 2, 16)

    def _energy(img):
        a = np.asarray(img, np.float32)
        if a.ndim == 3:
            a = a.mean(axis=2)
        a = cv2.resize(a, (tw, th), interpolation=cv2.INTER_AREA)
        # normalize each view by its own spread so exposure and level
        # differences between the two stacks cancel
        lo, hi = np.percentile(a[::4, ::4], (2.0, 99.5))
        a = ((a - lo) / max(hi - lo, 1e-3)).astype(np.float32)
        e = _grad_energy(a, blur=3)
        # the median of a starscape's energy map is noise, not structure.
        # NO window aggregation here — the vote below aggregates; energy
        # smeared over the window first turns every thin star arc into a
        # window-wide band of fake ground
        e -= 2.0 * float(np.median(e))
        np.maximum(e, 0.0, out=e)
        return e

    eb = _energy(base_img)
    ef = _energy(fg_img)
    # Every pixel votes, and only frozen-view structure votes ground:
    # ground texture is sharp in the frozen stack and gone in the
    # aligned one, while open sky is structureless in the frozen stack
    # (arcs are dilute) — so "no frozen structure" IS the sky vote.  A
    # mean of energies instead of votes drags the boundary half a
    # window into the sky, because ground energy is orders of magnitude
    # louder; the vote fraction crosses 0.5 exactly ON the boundary.
    # the confidence floor scales from the FROZEN view's own structure
    # only: mixing in the aligned view (whose positive energies are its
    # stars, orders of magnitude brighter than tree texture) once set
    # the bar above half the real ground
    conf = 1e-6 + 0.25 * float(np.median(ef[ef > 0])
                               if (ef > 0).any() else 0.0)
    v_ground = ef > np.maximum(eb, conf)
    # aligned-view structure that the frozen view lacks = point stars =
    # definite sky.  Pitch-black featureless ground votes "no frozen
    # structure" exactly like open sky does; the stars are what tell
    # those two apart, so the caller's sky veto is gated on this map.
    v_star = (eb > 0) & (eb > 4.0 * ef)
    k = max(agg_px | 1, 3)
    frac = cv2.boxFilter(v_ground.astype(np.float32), -1, (k, k),
                         borderType=cv2.BORDER_REFLECT)
    stars = cv2.boxFilter(v_star.astype(np.float32), -1, (k, k),
                          borderType=cv2.BORDER_REFLECT)
    score = frac - 0.5
    return (cv2.resize(score.astype(np.float32), (w, h),
                       interpolation=cv2.INTER_LINEAR),
            cv2.resize(stars.astype(np.float32), (w, h),
                       interpolation=cv2.INTER_LINEAR))


# ---------------------------------------------------------------------------
# putting it together
# ---------------------------------------------------------------------------

def _smoothstep(a: np.ndarray, lo: float, hi: float) -> np.ndarray:
    t = np.clip((a - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _luma_guide(img: np.ndarray) -> np.ndarray:
    """Guide image for the snap: normalized luminance of the FROZEN view
    with point stars and thin star arcs opened away, so the matte snaps
    to the treeline and never halos around a star sitting next to it."""
    import cv2

    a = np.asarray(img, np.float32)
    if a.ndim == 3:
        a = 0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]
    lo, hi = np.percentile(a[::4, ::4], (1.0, 99.5))
    a = np.clip((a - lo) / max(hi - lo, 1e-3), 0.0, 1.0).astype(np.float32)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    # NOTE: a texture (local variance) channel was tried here for the
    # trees-as-bright-as-the-sky night; the variance map peaks ON the
    # boundary itself, which shifted the snap a few pixels into the
    # ground and re-opened the lip on ordinary nights.  Luminance only.
    return cv2.morphologyEx(a, cv2.MORPH_OPEN, kernel)


def snap_sky_alpha(coarse_sky: np.ndarray, guide_img: np.ndarray,
                   radius: int | None = None, eps: float = 3e-4,
                   choke: tuple = (0.35, 0.95)) -> np.ndarray:
    """Snap a binary-ish sky mask onto the image's real edges.

    Band-restricted fast guided filtering: only the rows around the
    boundary are matted (the rest is already decided), then the alpha is
    choked a hair toward the sky — the transition finishes on the ground
    side of the edge, so the bright aligned sky can never show through a
    half-transparent silhouette.  Far from the boundary the mask is
    forced hard 0/1.
    """
    import cv2

    h, w = coarse_sky.shape[:2]
    if radius is None:
        radius = int(np.clip(round(0.010 * h), 8, 80))
    binary = (np.asarray(coarse_sky, np.float32) > 0.5).astype(np.float32)
    grad = cv2.morphologyEx(binary, cv2.MORPH_GRADIENT,
                            np.ones((3, 3), np.uint8))
    ys = np.nonzero(grad.any(axis=1))[0]
    if ys.size == 0:
        return binary                      # all sky or all ground
    pad = 2 * radius + 8
    y0, y1 = max(int(ys[0]) - pad, 0), min(int(ys[-1]) + pad + 1, h)

    # the guide is built for the band only: on a boundary spanning most
    # of the canvas a full-frame guide plus band copies added ~0.9 GB at
    # 20 MP for rows the matting never touches
    guide = _luma_guide(guide_img[y0:y1])
    alpha = binary.copy()
    # two cascaded passes (the production pattern): a WIDE pass whose
    # radius covers the coarse mask's own smoothing error pulls the
    # boundary onto the image edge, then a tight pass re-crisps it —
    # one wide pass alone leaves the transition soft, one tight pass
    # alone cannot reach a boundary that starts a window away
    r1 = max(radius, 24)
    band = guided_filter(guide, binary[y0:y1], r1, eps, subsample=4)
    band = (band > 0.5).astype(np.float32)
    r2 = max(radius // 3, 6)
    band = guided_filter(guide, band, r2, eps, subsample=2)
    del guide
    band = _smoothstep(np.clip(band, 0.0, 1.0), choke[0], choke[1])
    # far from the boundary the coarse verdict stands — matting is a
    # boundary tool, not a second opinion on the middle of the sky.
    # The distance question is binary ("farther than 1.5 r?"), so it is
    # answered at quarter scale — 16x less memory than two full float
    # distance maps for the same yes/no.
    inside = binary[y0:y1]
    bh, bw = inside.shape
    qw, qh = max(bw // 4, 4), max(bh // 4, 4)
    small = cv2.resize(inside, (qw, qh),
                       interpolation=cv2.INTER_NEAREST)
    d_sky = cv2.distanceTransform((small > 0.5).astype(np.uint8),
                                  cv2.DIST_L2, 3)
    d_gnd = cv2.distanceTransform((small <= 0.5).astype(np.uint8),
                                  cv2.DIST_L2, 3)
    far_thresh = 1.5 * radius / 4.0
    far_sky = cv2.resize((d_sky > far_thresh).astype(np.uint8), (bw, bh),
                         interpolation=cv2.INTER_NEAREST).astype(bool)
    far_gnd = cv2.resize((d_gnd > far_thresh).astype(np.uint8), (bw, bh),
                         interpolation=cv2.INTER_NEAREST).astype(bool)
    band[far_sky] = 1.0
    band[far_gnd] = 0.0
    alpha[y0:y1] = band
    return alpha


def load_horizon_edits(out_dir, shape_hw) -> tuple | None:
    """The paint screen's strokes: red = "this is ground", blue = "this
    is sky", saved as horizon_edits.png next to the results.  Returns
    (ground_bool, sky_bool) at ``shape_hw`` or None."""
    try:
        import cv2

        p = Path(out_dir) / EDITS_NAME
        if not p.exists():
            return None
        img = cv2.imread(str(p), cv2.IMREAD_UNCHANGED)
        if img is None or img.ndim != 3:
            return None
        h, w = shape_hw
        if img.shape[:2] != (h, w):
            img = cv2.resize(img, (w, h), interpolation=cv2.INTER_NEAREST)
        b, g, r = img[:, :, 0], img[:, :, 1], img[:, :, 2]
        if img.shape[2] == 4:
            on = img[:, :, 3] > 127
        else:
            on = (r.astype(np.int32) + b) > 64
        ground = on & (r > b)
        sky = on & (b >= r) & ~ground
        if not (ground.any() or sky.any()):
            return None
        return ground, sky
    except Exception as exc:
        log.warning("horizon edits could not be read (%s); ignored", exc)
        return None


def build_sky_alpha(base_img: np.ndarray,
                    fg_stack_fit: np.ndarray | None,
                    guide_img: np.ndarray,
                    silhouette_sky: np.ndarray | None = None,
                    sky_prior: np.ndarray | None = None,
                    edits: tuple | None = None,
                    top_limit: float = 0.05) -> np.ndarray | None:
    """The whole chain: physics coarse mask -> user paint -> conditioning
    -> guided-filter snap -> choke.  Returns the sky alpha (1 = sky) at
    canvas resolution, or None when there is no ground to cut (all-sky
    night) so the caller can keep its existing no-foreground path.
    """
    import cv2

    h, w = base_img.shape[:2]
    votes_ground = None
    if fg_stack_fit is not None \
            and fg_stack_fit.shape[:2] == base_img.shape[:2]:
        score, stars = sharpness_ground_score(base_img, fg_stack_fit)
        # Asymmetric trust.  Frozen-view structure is a physical ground
        # signature, so the sharpness vote may claim ground on its own
        # (dark trees on a dark sky, where a brightness matte is blind).
        # But it may only OVERRULE the brightness matte's ground where
        # it is emphatically sky — structureless ground (fog, a smooth
        # hill) must not be stolen by a weak sky vote.
        # interior thresholds on purpose: the vote window smooths the
        # boundary across neighbouring tree crowns, so near the edge the
        # score is unreliable by half a window — the silhouette owns the
        # boundary, the sharpness vote owns the interiors
        sharp_ground = score > 0.35
        sharp_sky_strong = (score < -0.35) & (stars > 0.02)
        # ...the sky veto is additionally gated on the aligned view
        # actually showing STARS there: pitch-black featureless trees
        # have no frozen structure either, and without the star gate
        # they read as "emphatically sky" and get stolen from the
        # silhouette
        if silhouette_sky is not None:
            votes_ground = (sharp_ground
                            | ((silhouette_sky < 0.5) & ~sharp_sky_strong))
        else:
            votes_ground = sharp_ground
    elif silhouette_sky is not None:
        votes_ground = silhouette_sky < 0.5
    painted = (edits is not None
               and edits[0].shape[:2] == (h, w))
    if votes_ground is None:
        if not painted:
            return None
        # no physics, no silhouette — but the person painted: their
        # strokes ARE the coarse mask
        votes_ground = np.zeros((h, w), bool)

    # the alignment-physics mask over-marks ground (the whole band the
    # trees swept through), so only its SKY verdict is trustworthy —
    # use it as a veto against ground false positives, never the reverse
    if sky_prior is not None and sky_prior.shape[:2] == (h, w):
        votes_ground &= ~(sky_prior > 0.98)

    coarse = votes_ground.astype(np.uint8)
    # condition at 1/4 scale: bridge tree crowns, drop speckle
    small = cv2.resize(coarse, (max(w // 4, 8), max(h // 4, 8)),
                       interpolation=cv2.INTER_AREA)
    small = (small > 0.4).astype(np.uint8)
    # a small close only: it exists to heal pinholes in the vote, not to
    # bridge real gaps — a big kernel here fills the valleys of a jagged
    # treeline and turns the mask into the treetop envelope
    small = cv2.morphologyEx(
        small, cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    n_lab, labels, stats, _c = cv2.connectedComponentsWithStats(small)
    hs = small.shape[0]
    keep = np.zeros_like(small)
    for k in range(1, n_lab):
        area = stats[k, cv2.CC_STAT_AREA]
        touches_bottom = (stats[k, cv2.CC_STAT_TOP]
                          + stats[k, cv2.CC_STAT_HEIGHT]) >= hs - 2
        if area >= 40 or touches_bottom:
            keep[labels == k] = 1
    # a "ground" region floating in the top of the frame is a cloud or a
    # plane trail, not a mountain
    top = int(top_limit * hs)
    if top > 0:
        rows = np.zeros(hs, bool)
        rows[:top] = True
        col_ground = keep.astype(bool)
        floaters = col_ground[:top].sum()
        if floaters and floaters < 0.02 * top * small.shape[1]:
            keep[:top] = 0
    coarse = cv2.resize(keep, (w, h),
                        interpolation=cv2.INTER_NEAREST).astype(bool)

    if painted:
        paint_ground, paint_sky = edits
        coarse |= paint_ground
        coarse &= ~paint_sky

    # sanity bails apply to the AUTOMATIC verdicts only.  When a person
    # painted, their strokes win outright: painting away every last bit
    # of ground means "there is no foreground here" (an all-sky alpha),
    # and painting most of the frame as ground is their call to make.
    if not coarse.any():
        if painted:
            log.info("horizon: your strokes removed all ground — "
                     "compositing the whole frame as sky")
            return np.ones((h, w), np.float32)
        log.info("edge-snapped horizon: no ground found on this canvas")
        return None                        # all-sky night
    if coarse.mean() > 0.95 and not painted:
        log.info("edge-snapped horizon: coarse mask claims %.0f%% ground "
                 "— refusing to trust it", 100 * coarse.mean())
        return None                        # something is wrong; bail out

    coarse_sky = (~coarse).astype(np.float32)
    return snap_sky_alpha(coarse_sky, guide_img)
