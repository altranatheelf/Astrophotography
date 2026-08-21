# METEORPREP

An open-source preparer that turns a folder of fixed-tripod RAW meteor-shower
frames into a **layered, geometry-corrected PSD** (plus a PNG + Photoshop-script
fallback), with a JSON provenance sidecar.

## Quick start (macOS, no terminal)

Double-click **MeteorPrep.app** (or **Start MeteorPrep.command**) in this
folder.  The first time, macOS may warn about an unidentified developer:
right-click the app, choose **Open**, then **Open** again — only needed
once.  First launch installs the components by itself if they're missing.
Then drop your photo folder into the window, pick one of the three
choices — **Quick look**, **Full quality**, or **Full quality, half
size** — and press **Find my meteors**.  All three find the same
meteors; they differ only in what they hand you and how long they take.

Every mechanical/geometric step is automated — decode, timing, plate solve,
TAN reprojection, meteor detection, aircraft/satellite rejection, alpha
extraction, sigma-clipped base stacking, assembly.  Every aesthetic decision
— which meteors, foreground choice, crop, grade — is surfaced to the human as
PSD layer toggles and never baked in.

## Why not just rotate the frames?

For a wide rectilinear field (16 mm, ~97°) with the celestial pole ~35°
off-axis, a 2D rotation about the projected pole is geometrically wrong: the
gnomonic projection maps a star's diurnal circle to a conic, and the
irreducible residual of the *best* 2D rotation reaches **~26 px/hr at 10°
from the pole, ~154 px/hr at 25°, and ~720 px/hr in the frame corner**.
METEORPREP therefore plate-solves every sequence and reprojects each frame
onto the base frame's TAN WCS (`reproject`), which is exact.  These numbers
are enforced by the test suite (`tests/test_oracle.py`) against a
first-principles gnomonic oracle.

## Install

```bash
pip install -e .                 # core (numpy, astropy, reproject, opencv, rawpy, …)
pip install -e ".[solve]"        # + twirl/astroquery (online Gaia solving)
pip install -e ".[psd]"          # + pytoshop/psd-tools (native PSD writing)
pip install -e ".[gui]"          # + PySide6 drag-and-drop GUI
pip install -e ".[dev]"          # + pytest
```

`exiftool` on the PATH is recommended for RAW metadata (a
`frames_meta.json` sidecar works as an offline fallback).  Without pytoshop
the tool still emits the full **PNG-per-layer + `assemble.jsx`** output —
run it from Photoshop's *File ▸ Scripts ▸ Browse…* to rebuild the identical
layer stack, no terminal required.

## Use

```bash
meteorprep /path/to/frames -o out \
    --seed-ra 48 --seed-dec 58        # rough pointing seed for the solver
```

or launch the GUI (`python -m meteorprep.gui`): drop the folder, pick a
mode, press **Find my meteors**.  On the command line the same choice is
`--mode quick` / `--mode full` / `--mode smaller`.

Outputs per shooting group:

- `meteorprep.psd` — 16-bit layered PSD: `BASE_SKY` (sigma-clipped point-star
  base), `FOREGROUND` group, `METEORS` group (Lighten, one layer per meteor,
  named `M007_IMG_4123.CR2_2026-08-13T02:14:07Z_+3.142deg_c0.94_perseid`),
  hidden `FLAGGED` group (aircraft / satellites / beams — inspectable, off).
- `layers/*.png` + `assemble.jsx` — the always-emitted fallback.
- `contact_sheet.png` — one-glance human verification of every candidate.
- `meteorprep.json` — full provenance: WCS, pole pixel, radiant, per-frame
  solve state, per-candidate classification, all parameters + hash.
- `skymask.png`, optional `startrail.tif`.

If no solver is possible, `--align-mode=rotate2d` still works but is
labelled **degraded** everywhere it appears — corner meteors will not
radiate correctly from the radiant.

## Test

```bash
python -m pytest tests/
```

CI needs no real data: `meteorprep/testdata/synth.py` renders synthetic
sequences through the exact TAN geometry with injected meteors, aircraft and
satellites, and the suite checks the §9.4 acceptance criteria (solve RMS
< 1 px, oracle-vs-reproject < 0.1 px, detection recall ≥ 0.9 / precision
≥ 0.95, aircraft/satellite flagging, zero meteor leak into the base, ±1 s
timing tolerance, cache idempotency).

## License

Apache-2.0 (see `LICENSE`).  GPL solvers (astrometry.net, Siril) are only
ever invoked as external processes, never linked.  See
`THIRD_PARTY_NOTICES.md`.
