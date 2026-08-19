"""The share capsule: a caption that can be checked.

Every astrophoto posted online carries an implicit claim about how much
of it is real.  This writes that claim down in a form a stranger can
audit — integration time, how many frames, what was calibrated, that no
pixel was generated, and the hash of the exact recipe that produced the
file — so the picture travels with its own receipts.
"""

from __future__ import annotations

import json
from pathlib import Path


def build(group_result: dict, info: dict, sidecar: dict) -> dict:
    """Assemble the capsule from what the run already knows."""
    meteors = [c for c in sidecar.get("candidates", [])
               if c.get("label") == "meteor"]
    flagged = [c for c in sidecar.get("candidates", [])
               if c.get("label") != "meteor"]
    with_physics = [c for c in meteors
                    if (c.get("physics") or {}).get("geometry_consistent")]
    return {
        "tool": f"METEORPREP {sidecar.get('tool_version', '')}".strip(),
        "captured": sidecar.get("frames", [{}])[0].get("epoch_mid"),
        "integration": info.get("integration"),
        "frames_stacked": info.get("photos stacked"),
        "alignment": (f"{sidecar.get('alignment', {}).get('solver', '?')} "
                      f"plate solve, "
                      f"{info.get('star-lock accuracy', 'n/a')}"),
        "calibration": ("star-physics white balance from the catalog"
                        if sidecar.get("color_calibration")
                        else "none applied"),
        "observing_site": (
            f"{sidecar['site']['lat']:+.4f}, {sidecar['site']['lon']:+.4f} "
            f"({sidecar['site']['source']})"
            if (sidecar.get("site") or {}).get("source") else None),
        "meteors_true_position": len(meteors),
        "other_trails_flagged": len(flagged),
        "physics_annotated": len(with_physics),
        "generated_pixels": "none",
        "lineage": info.get("lineage"),
        "recipe_hash": sidecar.get("params_hash"),
    }


def as_text(cap: dict) -> str:
    """The human-readable form — this is what gets pasted under a post."""
    lines = [f"{cap.get('tool', 'METEORPREP')} — how this image was made", ""]
    order = [
        ("integration", "Integration"),
        ("frames_stacked", "Frames"),
        ("alignment", "Alignment"),
        ("calibration", "Colour"),
        ("observing_site", "Observing site"),
        ("meteors_true_position", "Meteors, at their true sky positions"),
        ("other_trails_flagged", "Satellite/aircraft trails, kept separate"),
        ("physics_annotated", "Meteors with height/duration estimates"),
        ("lineage", "Pixel lineage"),
        ("generated_pixels", "Generated (AI or painted) pixels"),
        ("recipe_hash", "Recipe hash"),
    ]
    for key, label in order:
        v = cap.get(key)
        if v not in (None, "", []):
            lines.append(f"{label}: {v}")
    lines += ["",
              "Every streak above is light that fell on the sensor, placed "
              "where the sky says it was.",
              "Nothing was painted in, cloned, or generated."]
    return "\n".join(lines) + "\n"


def write(out_dir: Path, cap: dict) -> Path:
    p = Path(out_dir) / "capsule.txt"
    p.write_text(as_text(cap), encoding="utf-8")
    (Path(out_dir) / "capsule.json").write_text(json.dumps(cap, indent=1))
    return p
