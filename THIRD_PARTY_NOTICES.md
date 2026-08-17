# Third-party notices

METEORPREP is licensed Apache-2.0.  It builds on the following projects:

| Project | License | Use |
|---|---|---|
| numpy, scipy, pandas, pyarrow | BSD | numerics / tables |
| astropy, reproject | BSD-3-Clause | WCS, sigma clipping, TAN reprojection |
| OpenCV (opencv-python-headless) | Apache-2.0 | detection, morphology, Hough |
| rawpy / LibRaw | MIT / LGPL-2.1 (LibRaw CDDL/LGPL dual) | RAW decoding |
| tifffile, imagecodecs | BSD | TIFF I/O |
| Pillow | MIT-CMU | PNG / contact sheet |
| shin3tky/detect_meteors | Apache-2.0 | detection constants & NPF auto-tuning heritage (derived with attribution) |
| twirl (optional) | MIT | plate solving via Gaia asterisms |
| astroquery (optional) | BSD | Gaia queries for twirl |
| pytoshop (optional) | BSD | PSD writing |
| psd-tools (optional) | MIT | PSD validation |
| PySide6 (optional) | LGPL-3.0 | GUI (dynamically linked, unmodified) |
| lensfunpy / Lensfun DB (optional) | MIT / LGPL-3.0 + CC-BY-SA (database) | lens distortion parameters |

Invoked strictly as **external processes** (never linked), when present on
the system:

- astrometry.net `solve-field` — GPL-3.0
- Siril — GPL-3.0
- exiftool — Artistic/GPL dual

Any pretrained sky-segmentation model plugged into
`meteorprep.segment.sky_ground.segment_sky(ml_model=…)` must have its
license recorded in the run's JSON sidecar.
