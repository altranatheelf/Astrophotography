"""Synthetic star-field sequence generator with ground truth (§9.3).

Renders a fixed-tripod sequence: the camera WCS is constant in alt-az, so
frame *i*'s WCS equals the base WCS with CRVAL1 advanced by the sidereal
rate times the epoch offset.  Stars are rendered through the exact TAN WCS
(the same gnomonic mapping as the §4.1 oracle); meteors are single-frame
streaks radiating from a chosen radiant; aircraft are multi-frame, dashed
and coloured; satellites are multi-frame, thin and constant.

Outputs 16-bit RGB TIFF frames plus ``frames_meta.json`` (EXIF surrogate)
and ``ground_truth.json`` (true WCS per frame, star catalog, meteor
endpoints and labels) so CI can measure solve accuracy, reprojection
residual, recall/precision and classifier quality with no real labels.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import tifffile

from meteorprep.config import SIDEREAL_DEG_PER_SEC
from meteorprep.astrometry.solve import build_tan_wcs, propagate_wcs
from meteorprep.astrometry.lensdistort import Poly3Distortion

BACKGROUND_ADU = 2000.0
READ_NOISE_ADU = 25.0
STAR_SIGMA_PX = 1.3


def _add_gaussian(img: np.ndarray, x: float, y: float, flux: float,
                  sigma: float, color=(1.0, 1.0, 1.0)) -> None:
    h, w = img.shape[:2]
    r = int(np.ceil(4 * sigma))
    xi, yi = int(round(x)), int(round(y))
    if xi < -r or xi >= w + r or yi < -r or yi >= h + r:
        return
    x0, x1 = max(xi - r, 0), min(xi + r + 1, w)
    y0, y1 = max(yi - r, 0), min(yi + r + 1, h)
    if x0 >= x1 or y0 >= y1:
        return
    yy, xx = np.mgrid[y0:y1, x0:x1]
    g = flux * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * sigma ** 2))
    for c in range(3):
        img[y0:y1, x0:x1, c] += g * color[c]


def _add_streak(img: np.ndarray, p0, p1, peak_flux: float, sigma: float,
                head_tail: bool = True, dashed: bool = False,
                color=(1.0, 1.0, 1.0), n_step_per_px: float = 1.0) -> None:
    """Streak from p0 (head) to p1 (tail) as summed Gaussian footprints."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    length = np.linalg.norm(p1 - p0)
    n = max(int(length * n_step_per_px), 2)
    for i, t in enumerate(np.linspace(0.0, 1.0, n)):
        if dashed and (i // 12) % 2 == 1:
            continue
        amp = peak_flux * (1.0 - 0.85 * t) if head_tail else peak_flux
        p = p0 + t * (p1 - p0)
        _add_gaussian(img, p[0], p[1], amp / n_step_per_px, sigma, color)


def _cap_catalog(rng, tangent, theta_max_deg, n_stars):
    """Random stars uniformly on the spherical cap around the tangent point
    — valid RA/Dec at any field width (no flat-sky approximation)."""
    ra0, dec0 = np.deg2rad(tangent[0]), np.deg2rad(tangent[1])
    t = np.array([np.cos(dec0) * np.cos(ra0), np.cos(dec0) * np.sin(ra0),
                  np.sin(dec0)])
    # orthonormal basis of the tangent plane
    e1 = np.array([-np.sin(ra0), np.cos(ra0), 0.0])
    e2 = np.cross(t, e1)
    cos_sig = rng.uniform(np.cos(np.deg2rad(theta_max_deg)), 1.0, n_stars)
    sig = np.arccos(cos_sig)
    phi = rng.uniform(0, 2 * np.pi, n_stars)
    v = (t[None, :] * np.cos(sig)[:, None]
         + (np.outer(np.cos(phi), e1) + np.outer(np.sin(phi), e2))
         * np.sin(sig)[:, None])
    ra = np.rad2deg(np.arctan2(v[:, 1], v[:, 0])) % 360.0
    dec = np.rad2deg(np.arcsin(np.clip(v[:, 2], -1, 1)))
    return ra, dec


def _radiant_streak_px(rng, base_wcs, radiant, shape, length_px, margin=160):
    margin = min(margin, shape[0] // 3, shape[1] // 3)
    """Streak endpoints radiating from the radiant, built in the base TAN
    plane (gnomonic maps great circles to straight lines, so a straight line
    through the projected radiant IS a great circle through the radiant).
    Returns (head_world, tail_world) with both endpoints in-frame."""
    h, w = shape
    rx, ry = base_wcs.world_to_pixel_values(*radiant)
    for _ in range(100):
        head = np.array([rng.uniform(margin, w - margin),
                         rng.uniform(margin, h - margin)])
        d = head - np.array([float(rx), float(ry)])
        n = np.linalg.norm(d)
        if n < 1e-6:
            continue
        tail = head + d / n * length_px
        if margin / 2 <= tail[0] < w - margin / 2 and margin / 2 <= tail[1] < h - margin / 2:
            hw = base_wcs.pixel_to_world_values(head[0], head[1])
            tw = base_wcs.pixel_to_world_values(tail[0], tail[1])
            return (np.array([float(hw[0]), float(hw[1])]),
                    np.array([float(tw[0]), float(tw[1])]))
    raise RuntimeError("could not place meteor inside the frame")


def make_synthetic_sequence(out_dir, n_frames: int = 30, exp_s: float = 20.0,
                            gap_s: float = 2.0,
                            site=(44.3275, -72.1725),
                            focal_px: float = 2443.0,
                            shape=(3648, 5472),
                            pole_offaxis_deg: float = 35.0,
                            n_stars: int = 400,
                            n_meteors: int = 5, n_aircraft: int = 1,
                            n_satellites: int = 1,
                            k1: float = 0.0,
                            radiant=(48.0, 58.0),
                            t0: str = "2026-08-13T02:00:00+00:00",
                            seed: int = 0) -> dict:
    """Generate the sequence; returns the ground-truth dict (also written
    to ``ground_truth.json``)."""
    rng = np.random.default_rng(seed)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    h, w = shape
    pixel_scale_deg = np.rad2deg(np.arctan(1.0 / focal_px))
    fov_deg = w * pixel_scale_deg

    tangent = (80.0, 90.0 - pole_offaxis_deg)  # RA arbitrary; pole 35 deg off-axis
    base_idx = n_frames // 2
    t_start = datetime.fromisoformat(t0)

    def epoch_mid(i):
        return t_start + timedelta(seconds=i * (exp_s + gap_s) + exp_s / 2.0)

    base_mid = epoch_mid(base_idx)
    wcs0 = build_tan_wcs(tangent[0], tangent[1], pixel_scale_deg, (h, w))
    frame_wcs = []
    for i in range(n_frames):
        dt = (epoch_mid(i) - base_mid).total_seconds()
        frame_wcs.append(propagate_wcs(wcs0, dt))

    dist = Poly3Distortion(k1, (h, w)) if abs(k1) > 1e-12 else None

    # --- star catalog: uniform on the spherical cap covering the field ---
    theta_max = np.rad2deg(np.arctan(np.hypot(w, h) / 2.0 / focal_px)) * 1.08
    star_ra, star_dec = _cap_catalog(rng, tangent, theta_max, n_stars)
    star_flux = 10 ** rng.uniform(3.2, 5.2, n_stars)

    base_wcs = frame_wcs[base_idx]

    def _track_world(vel_px_per_frame, seg_px, span):
        """A moving object's per-frame world segments, built in base pixels."""
        margin = 100
        p = np.array([rng.uniform(margin, w - margin),
                      rng.uniform(margin, h - margin)])
        v = rng.uniform(-1, 1, 2)
        v = v / np.linalg.norm(v) * vel_px_per_frame
        # keep the whole track inside the frame
        end = p + v * span
        if not (margin / 2 <= end[0] < w - margin / 2
                and margin / 2 <= end[1] < h - margin / 2):
            v = -v
        segs = []
        for k in range(span):
            a = p + k * v
            b = a + v * (seg_px / max(np.linalg.norm(v), 1e-6))
            aw = base_wcs.pixel_to_world_values(a[0], a[1])
            bw = base_wcs.pixel_to_world_values(b[0], b[1])
            segs.append(([float(aw[0]), float(aw[1])],
                         [float(bw[0]), float(bw[1])]))
        return segs

    # --- meteors (single-frame; lengths specified in pixels so the same
    # generator works at any synthetic plate scale) -----------------------
    meteors = []
    for m in range(n_meteors):
        fi = int(rng.integers(1, n_frames - 1))
        head, tail = _radiant_streak_px(
            rng, base_wcs, radiant, (h, w), rng.uniform(90, 220))
        meteors.append({"id": f"GT{m:03d}", "frame": fi,
                        "head_world": list(head), "tail_world": list(tail),
                        "peak_flux": float(10 ** rng.uniform(4.6, 5.3))})

    # --- aircraft (multi-frame, dashed, coloured, progressive) -----------
    aircraft = []
    for a in range(n_aircraft):
        fi0 = int(rng.integers(1, max(2, n_frames - 5)))
        span = int(rng.integers(3, 5))
        segs = _track_world(vel_px_per_frame=70.0, seg_px=55.0, span=span)
        aircraft.append({"id": f"AC{a:03d}", "frames": list(range(fi0, fi0 + span)),
                         "segments_world": segs})

    # --- satellites (multi-frame, thin, constant) ------------------------
    satellites = []
    for s in range(n_satellites):
        fi0 = int(rng.integers(1, max(2, n_frames - 5)))
        span = int(rng.integers(3, 5))
        segs = _track_world(vel_px_per_frame=75.0, seg_px=65.0, span=span)
        satellites.append({"id": f"SA{s:03d}", "frames": list(range(fi0, fi0 + span)),
                           "segments_world": segs})

    def world_to_obs_pix(wcs, ra, dec):
        x, y = wcs.world_to_pixel_values(ra, dec)
        if dist is not None:
            x, y = dist.distort(np.array([[float(x), float(y)]]))[0]
        return float(x), float(y)

    frames_meta, gt_frames = [], []
    for i in range(n_frames):
        img = np.zeros((h, w, 3), dtype=np.float64)
        wcs_i = frame_wcs[i]
        xs, ys = wcs_i.world_to_pixel_values(star_ra, star_dec)
        if dist is not None:
            xy = dist.distort(np.column_stack([xs, ys]))
            xs, ys = xy[:, 0], xy[:, 1]
        for x, y, fl in zip(xs, ys, star_flux):
            if -10 <= x <= w + 10 and -10 <= y <= h + 10:
                _add_gaussian(img, x, y, fl, STAR_SIGMA_PX)

        for m in meteors:
            if m["frame"] != i:
                continue
            p0 = world_to_obs_pix(wcs_i, *m["head_world"])
            p1 = world_to_obs_pix(wcs_i, *m["tail_world"])
            _add_streak(img, p0, p1, m["peak_flux"], 1.8, head_tail=True)

        for ac in aircraft:
            if i in ac["frames"]:
                seg = ac["segments_world"][ac["frames"].index(i)]
                p0 = world_to_obs_pix(wcs_i, *seg[0])
                p1 = world_to_obs_pix(wcs_i, *seg[1])
                _add_streak(img, p0, p1, 3.0e4, 1.6, head_tail=False,
                            dashed=True, color=(1.0, 0.45, 0.4))

        for sa in satellites:
            if i in sa["frames"]:
                seg = sa["segments_world"][sa["frames"].index(i)]
                p0 = world_to_obs_pix(wcs_i, *seg[0])
                p1 = world_to_obs_pix(wcs_i, *seg[1])
                _add_streak(img, p0, p1, 1.2e4, 0.9, head_tail=False)

        img += BACKGROUND_ADU
        img += rng.normal(0, READ_NOISE_ADU, img.shape)
        img += rng.normal(0, 1, img.shape) * np.sqrt(np.maximum(img, 0)) * 0.5
        img = np.clip(img, 0, 65535).astype(np.uint16)

        fname = f"SYN_{i:04d}.tif"
        tifffile.imwrite(out / fname, img, compression="lzw")

        dto = (t_start + timedelta(seconds=i * (exp_s + gap_s)))
        frames_meta.append({
            "file": fname,
            "DateTimeOriginal": dto.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
            "ExposureTime": exp_s, "ISO": 6400, "FNumber": 2.8,
            "FocalLength": 16.0, "Model": "SyntheticCam",
            "LensModel": "Canon EF 16-35mm f/2.8L III USM",
            "ImageWidth": w, "ImageHeight": h,
        })
        gt_frames.append({"file": fname,
                          "wcs_header": wcs_i.to_header().tostring(sep="\n"),
                          "epoch_mid": epoch_mid(i).isoformat()})

    base_wcs = frame_wcs[base_idx]
    gt = {
        "shape": [h, w], "focal_px": focal_px,
        "pixel_scale_deg": pixel_scale_deg,
        "pole_offaxis_deg": pole_offaxis_deg,
        "tangent_radec": list(tangent),
        "base_index": base_idx, "base_file": f"SYN_{base_idx:04d}.tif",
        "site": list(site), "k1": k1,
        "radiant_radec": list(radiant),
        "sidereal_deg_per_sec": SIDEREAL_DEG_PER_SEC,
        "frames": gt_frames,
        "stars": [{"ra": float(r), "dec": float(d), "flux": float(f)}
                  for r, d, f in zip(star_ra, star_dec, star_flux)],
        "meteors": [dict(m, head_base_px=list(map(float, base_wcs.world_to_pixel_values(*m["head_world"]))),
                         tail_base_px=list(map(float, base_wcs.world_to_pixel_values(*m["tail_world"]))))
                    for m in meteors],
        "aircraft": aircraft,
        "satellites": satellites,
    }
    (out / "frames_meta.json").write_text(json.dumps(frames_meta, indent=2))
    (out / "ground_truth.json").write_text(json.dumps(gt, indent=2))
    # (ra, dec, pseudo-magnitude) sorted brightest-first, like the bundled
    # naked-eye catalog — consumers of only positions slice [:, :2]
    catalog = np.array([[s["ra"], s["dec"], -2.5 * np.log10(s["flux"])]
                        for s in gt["stars"]])
    catalog = catalog[np.argsort(catalog[:, 2])]
    np.save(out / "catalog_radec.npy", catalog)
    return gt
