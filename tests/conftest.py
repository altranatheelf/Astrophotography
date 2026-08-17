import json
from pathlib import Path

import numpy as np
import pytest

from meteorprep.config import Config
from meteorprep.testdata.synth import make_synthetic_sequence

SHAPE = (600, 900)
FOCAL_PX = 2443.0 * SHAPE[1] / 5472.0  # same 97-deg field at reduced scale


@pytest.fixture(scope="session")
def synth_dir(tmp_path_factory) -> Path:
    d = tmp_path_factory.mktemp("synthseq")
    make_synthetic_sequence(d, n_frames=12, shape=SHAPE, focal_px=FOCAL_PX,
                            n_stars=250, n_meteors=4, n_aircraft=1,
                            n_satellites=1, seed=3)
    return d


@pytest.fixture(scope="session")
def ground_truth(synth_dir) -> dict:
    return json.loads((synth_dir / "ground_truth.json").read_text())


@pytest.fixture(scope="session")
def synth_config(synth_dir, ground_truth, tmp_path_factory) -> Config:
    out = tmp_path_factory.mktemp("synthout")
    return Config(
        input_dir=str(synth_dir), output_dir=str(out),
        catalog_file=str(synth_dir / "catalog_radec.npy"),
        pixel_pitch_um=16000.0 / ground_truth["focal_px"],
        seed_ra_deg=ground_truth["tangent_radec"][0] + 0.2,
        seed_dec_deg=ground_truth["tangent_radec"][1] - 0.15,
        solve_every_k=4,
    )


@pytest.fixture(scope="session")
def pipeline_result(synth_config) -> dict:
    from meteorprep.pipeline import run
    return run(synth_config)


@pytest.fixture(scope="session")
def base_wcs(ground_truth):
    from astropy.io import fits
    from astropy.wcs import WCS
    hdr = fits.Header.fromstring(
        ground_truth["frames"][ground_truth["base_index"]]["wcs_header"],
        sep="\n")
    return WCS(hdr)


def centroid(img: np.ndarray, x: float, y: float, r: int = 6):
    """Flux-weighted centroid in a window around (x, y)."""
    h, w = img.shape
    xi, yi = int(round(x)), int(round(y))
    x0, x1 = max(xi - r, 0), min(xi + r + 1, w)
    y0, y1 = max(yi - r, 0), min(yi + r + 1, h)
    patch = img[y0:y1, x0:x1].astype(float)
    patch = patch - np.median(patch)
    patch[patch < 0] = 0
    tot = patch.sum()
    if tot <= 0:
        return np.nan, np.nan
    yy, xx = np.mgrid[y0:y1, x0:x1]
    return float((xx * patch).sum() / tot), float((yy * patch).sum() / tot)
