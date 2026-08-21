"""Setup self-test: prove the whole install works on a tiny synthetic
night in ~2 minutes, *before* spending 15+ on real frames.

Checks the dependency chain (including the pieces only real RAW files
exercise, like exiftool and the RAW decoder), then runs the full pipeline
end to end on generated frames and verifies it found what was planted.
Everything is reported in plain language with a single verdict.
"""

from __future__ import annotations

import shutil
import tempfile
import traceback
from pathlib import Path


def run_self_test(progress=None) -> dict:
    """Returns {"ok": bool, "checks": [(name, ok, detail)], "verdict": str}."""
    notify = progress or (lambda m: None)
    checks: list[tuple[str, bool, str]] = []

    def check(name, fn):
        try:
            detail = fn() or "OK"
            checks.append((name, True, str(detail)))
            return True
        except Exception as exc:
            checks.append((name, False, f"{type(exc).__name__}: {exc}"))
            return False

    notify("Checking the toolbox…")
    check("Python numerics (numpy/scipy)",
          lambda: __import__("numpy").__version__)
    check("Astronomy math (astropy/reproject)",
          lambda: (__import__("astropy").__version__,
                   __import__("reproject") and "OK")[1])
    check("Image engine (OpenCV)", lambda: __import__("cv2").__version__)
    check("RAW decoder (rawpy/LibRaw)",
          lambda: __import__("rawpy").__version__)

    def _exiftool():
        from meteorprep.ingest.exif import find_exiftool
        exe = find_exiftool()
        if exe is None:
            raise RuntimeError(
                "not found — install from exiftool.org before running on "
                "RAW files (synthetic frames still work)")
        return exe
    exif_ok = check("Photo-info reader (exiftool)", _exiftool)

    def _catalog():
        from meteorprep.astrometry.blind import load_bright_catalog
        cat = load_bright_catalog()
        return f"{len(cat)} stars"
    check("Built-in star map", _catalog)

    notify("Generating a tiny synthetic night…")
    tmp = Path(tempfile.mkdtemp(prefix="meteorprep_selftest_"))
    pipeline_ok = False
    try:
        import json

        from meteorprep.config import Config
        from meteorprep.pipeline import run
        from meteorprep.testdata.synth import make_synthetic_sequence

        src = tmp / "frames"
        gt = make_synthetic_sequence(src, n_frames=10, shape=(600, 900),
                                     focal_px=2443.0 * 900 / 5472,
                                     n_stars=250, n_meteors=2,
                                     n_aircraft=1, n_satellites=0, seed=3)
        json.dump({"catalog_file": str(src / "catalog_radec.npy"),
                   "pixel_pitch_um": 16000.0 / gt["focal_px"],
                   "solve_every_k": 4, "emit_psd": False,
                   "emit_gradient_layer": False,
                   "emit_contact_sheet": False},
                  open(src / "meteorprep_config.json", "w"))
        notify("Running the full pipeline on it (takes a few minutes)…")
        res = run(Config(input_dir=str(src), output_dir=str(tmp / "out"),
                         cleanup_cache=True))
        g = res["groups"][0]
        found = g["n_meteors"]
        planted = len(gt["meteors"])
        pipeline_ok = (planted <= found <= planted + 1
                       and g["n_flagged"] >= 1
                       and g["alignment_quality"] == "nominal")
        checks.append(("Full pipeline on synthetic night", pipeline_ok,
                       f"found {found}/{planted} planted meteor(s), "
                       f"{g['n_flagged']} plane(s) flagged, "
                       f"alignment {g['alignment_quality']}"))
    except Exception:
        checks.append(("Full pipeline on synthetic night", False,
                       traceback.format_exc(limit=2)))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    hard_fail = [c for c in checks if not c[1]
                 and c[0] != "Photo-info reader (exiftool)"]
    ok = not hard_fail
    if ok and exif_ok:
        verdict = ("Everything works. You're ready for real photos: drag "
                   "your folder in and press Find my meteors.")
    elif ok:
        verdict = ("The engine works, but exiftool is missing — install it "
                   "from exiftool.org before running on RAW files.")
    else:
        verdict = ("Something needs fixing before a real run — send the "
                   "lines above to your assistant and it will be sorted.")
    return {"ok": ok and exif_ok, "checks": checks, "verdict": verdict}


def format_report(result: dict) -> str:
    from meteorprep import __version__
    lines = [f"METEORPREP {__version__} setup self-test", "=" * 30]
    for name, ok, detail in result["checks"]:
        lines.append(f"  {'✓' if ok else '✗'} {name}: {detail}")
    lines += ["-" * 30, result["verdict"]]
    return "\n".join(lines)


def main() -> int:
    result = run_self_test(progress=lambda m: print(m))
    print(format_report(result))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
