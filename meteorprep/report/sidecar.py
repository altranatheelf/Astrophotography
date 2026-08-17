"""JSON provenance sidecar (§7.4) — makes the composite honestly
disclosable and fully reproducible."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from meteorprep import __version__


def _sanitize(obj):
    """Replace NaN/Inf with None so the sidecar is strict JSON."""
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, float) and (obj != obj or obj in (float("inf"), float("-inf"))):
        return None
    return obj


def write_sidecar(out_path: Path, cfg, group_id: str, base_frame: str,
                  base_wcs, pole_xy, radiant_radec, frames, candidates,
                  alignment_quality: str, solver: str,
                  solve_frames: list[str]) -> Path:
    doc = {
        "tool_version": __version__,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "input_dir": str(cfg.input_dir),
        "group_id": group_id,
        "site": {"lat": cfg.site_lat, "lon": cfg.site_lon},
        "base_frame": base_frame,
        "base_wcs_fits_header": (base_wcs.to_header(relax=True).tostring(sep="\n")
                                 if base_wcs is not None else None),
        "pole_pixel_xy": list(pole_xy) if pole_xy is not None else None,
        "radiant": {"ra_deg": radiant_radec[0], "dec_deg": radiant_radec[1],
                    "epoch": cfg.radiant_epoch},
        "alignment": {
            "mode": cfg.align_mode,
            "solver": solver,
            "solve_frames": solve_frames,
            "sip_order": cfg.sip_order,
            "lensfun_model": cfg.lens_model,
            "quality": alignment_quality,
        },
        "frames": [m.to_dict() for m in frames],
        "candidates": [c.to_dict() for c in candidates],
        "params": cfg.to_dict(),
        "params_hash": cfg.params_hash(),
    }
    out_path = Path(out_path)
    out_path.write_text(json.dumps(_sanitize(doc), indent=2, allow_nan=False,
                                   default=lambda o: None))
    return out_path
