"""Pipeline configuration and per-stage parameter hashing.

A stage is skipped on re-run iff its ``stage.done`` marker hash matches the
current hash for that stage.  A stage hash covers only the parameters that
actually affect it plus the hashes of its upstream stages, so changing e.g.
the Hough threshold re-runs detection but not the plate solve.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

# Sidereal rate: 360 deg / 86164.0905 s.
SIDEREAL_DEG_PER_SEC = 360.0 / 86164.0905


@dataclass
class Config:
    # --- ingest ---
    input_dir: str = "."
    output_dir: str = "meteorprep_out"
    half_size: bool = False   # half-resolution decode: ~4x less scratch disk/time
    super_sample: float = 1.0  # >1: drizzle-style finer output grid using the
                               # sky's own rotation as natural dither
    raw_extensions: tuple = (".cr2", ".cr3", ".nef", ".arw", ".dng",
                             ".raf", ".orf", ".rw2", ".tif", ".tiff", ".fits")
    site_lat: float = 44.3275
    site_lon: float = -72.1725

    # --- folder segmentation ---
    max_gap_factor: float = 5.0     # new group when gap > factor * median interval
    bump_px: float = 50.0           # tripod-bump threshold beyond sidereal prediction

    # --- light-paint detection ---
    lp_sigma: float = 4.0
    lp_window: int = 15

    # --- astrometry ---
    align_mode: str = "reproject_tan"   # or "rotate2d" (degraded fallback)
    pixel_pitch_um: float = 6.55
    catalog_file: str = ""              # local (N,2) RA/Dec .npy for offline solving
    seed_ra_deg: float = float("nan")   # rough base-frame center seed (else EXIF/alt-az)
    seed_dec_deg: float = float("nan")
    seed_rotation_deg: float = 0.0
    pointed_compass: str = ""           # "NE" etc: derive the seed from where
    pointed_elevation_deg: float = 45.0  # the camera pointed + site + time
    solve_every_k: int = 10
    solve_min_stars: int = 20
    solve_rms_max_px: float = 2.0
    sip_order: int = 3
    lens_model: str = "Canon EF 16-35mm f/2.8L III USM"
    lens_k1: float = 0.0            # poly3 barrel term; 0 = no pre-correction

    # --- detection (defaults adopted from shin3tky/detect_meteors, Apache-2.0) ---
    bin_factor: int = 2
    ref_window: int = 7
    ref_sigma: float = 3.0
    diff_threshold: float = 8.0     # ADU over reference, in 8-bit-equivalent units
    min_area: int = 10
    min_aspect_ratio: float = 3.0
    hough_threshold: int = 10
    hough_min_line_length: int = 15
    hough_max_line_gap: int = 5
    min_line_score: float = 80.0
    cosmic_max_px: int = 6
    fwhm_sat_px: float = 2.0
    boundary_gap_deg: float = 0.5

    # --- radiant (Perseids at peak; advisory only) ---
    radiant_ra_deg: float = 48.0
    radiant_dec_deg: float = 58.0
    radiant_epoch: str = "2026-08-13"
    radiant_dra_deg_per_day: float = 1.40
    radiant_ddec_deg_per_day: float = 0.20
    radiant_tol_deg: float = 5.0

    # --- stacking ---
    stack_sigma: float = 2.5
    stack_maxiters: int = 5
    stack_band_rows: int = 512
    frame_weighting: bool = True      # noise-weighted integration
    emit_foreground_stack: bool = True  # Sequator-style frozen ground
    emit_gradient_layer: bool = True    # sky-gradient layer (Subtract blend)

    # --- outputs ---
    crop_coverage_frac: float = 0.7   # crop the canvas to where at least
                                      # this fraction of frames overlap
                                      # (removes stacking seams); 0 = off
    emit_psd: bool = True
    emit_pngjsx: bool = True
    emit_startrail: bool = False
    emit_contact_sheet: bool = True

    # --- runtime ---
    jobs: int = 1               # >1 parallelises decode+reprojection
    force: bool = False
    cleanup_cache: bool = False  # delete the big reprojection cache when done

    def to_dict(self) -> dict:
        d = asdict(self)
        d["raw_extensions"] = list(d["raw_extensions"])
        return d

    # ------------------------------------------------------------------
    # Per-stage hashing
    # ------------------------------------------------------------------

    # Parameters that affect each stage (upstream stage hashes are chained in).
    STAGE_PARAMS: dict = field(default=None, repr=False)

    _STAGE_PARAMS = {
        "ingest": ["input_dir", "raw_extensions", "half_size", "super_sample"],
        "segment_folder": ["max_gap_factor", "bump_px"],
        "lightpaint": ["lp_sigma", "lp_window"],
        "solve": ["align_mode", "solve_every_k", "solve_min_stars",
                  "solve_rms_max_px", "sip_order", "lens_model", "lens_k1",
                  "site_lat", "site_lon", "pixel_pitch_um", "catalog_file",
                  "seed_ra_deg", "seed_dec_deg", "seed_rotation_deg",
                  "pointed_compass", "pointed_elevation_deg"],
        "reproject": ["align_mode"],
        "detect": ["bin_factor", "ref_window", "ref_sigma", "diff_threshold",
                   "min_area", "min_aspect_ratio", "hough_threshold",
                   "hough_min_line_length", "hough_max_line_gap",
                   "min_line_score"],
        "classify": ["cosmic_max_px", "fwhm_sat_px", "boundary_gap_deg",
                     "radiant_ra_deg", "radiant_dec_deg", "radiant_epoch",
                     "radiant_dra_deg_per_day", "radiant_ddec_deg_per_day",
                     "radiant_tol_deg"],
        "base_sky": ["stack_sigma", "stack_maxiters", "stack_band_rows",
                     "frame_weighting", "emit_foreground_stack"],
        "sky_ground": [],
        "extract": [],
        "assemble": ["emit_psd", "emit_pngjsx", "emit_startrail",
                     "emit_contact_sheet", "crop_coverage_frac"],
    }

    _STAGE_UPSTREAM = {
        "ingest": [],
        "segment_folder": ["ingest"],
        "lightpaint": ["ingest", "segment_folder"],
        "solve": ["ingest", "segment_folder"],
        "reproject": ["solve"],
        "detect": ["reproject", "lightpaint"],
        "classify": ["detect"],
        "base_sky": ["reproject", "classify", "lightpaint"],
        "sky_ground": ["base_sky"],
        "extract": ["classify", "reproject"],
        "assemble": ["base_sky", "sky_ground", "extract"],
    }

    def stage_hash(self, stage: str) -> str:
        """SHA-256 over this stage's own params + upstream stage hashes."""
        if stage not in self._STAGE_PARAMS:
            raise KeyError(f"unknown stage: {stage}")
        d = self.to_dict()
        payload = {
            "stage": stage,
            "params": {k: d[k] for k in self._STAGE_PARAMS[stage]},
            "upstream": {s: self.stage_hash(s) for s in self._STAGE_UPSTREAM[stage]},
        }
        blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return "sha256:" + hashlib.sha256(blob.encode()).hexdigest()

    def params_hash(self) -> str:
        """Hash of the whole config (for the sidecar)."""
        blob = json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"))
        return "sha256:" + hashlib.sha256(blob.encode()).hexdigest()

    @property
    def output_path(self) -> Path:
        return Path(self.output_dir)

    @property
    def cache_path(self) -> Path:
        return Path(self.output_dir) / "cache"
