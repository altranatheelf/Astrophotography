"""Stacking-quality machinery: streaming sigma-clip statistics, noise
weighting, gradient fitting — the pieces that put the output on par with
(or ahead of) the leading stackers' integration."""

import numpy as np
import pytest

from meteorprep.stack.gradient import fit_sky_gradient
from meteorprep.stack.streaming import RunningMoments, frame_noise_weights


def test_running_moments_match_numpy():
    rng = np.random.default_rng(0)
    data = rng.normal(1000, 50, (30, 8, 6, 3)).astype(np.float32)
    masks = rng.random((30, 8, 6)) > 0.2

    mom = RunningMoments((8, 6, 3))
    for k in range(30):
        mom.add(data[k], masks[k])

    for y in range(8):
        for x in range(6):
            vals = data[masks[:, y, x], y, x, :]
            if len(vals) < 2:
                continue
            assert mom.count[y, x] == len(vals)
            np.testing.assert_allclose(mom.mean[y, x], vals.mean(axis=0),
                                       rtol=1e-4)
            np.testing.assert_allclose(
                mom.m2[y, x] / (len(vals) - 1), vals.var(axis=0, ddof=1),
                rtol=1e-3)


def test_running_moments_parallel_combine():
    """Chan's combination of two partials equals one sequential pass."""
    rng = np.random.default_rng(1)
    data = rng.normal(500, 20, (40, 5, 4, 3)).astype(np.float32)
    ok = np.ones((5, 4), bool)

    whole = RunningMoments((5, 4, 3))
    for k in range(40):
        whole.add(data[k], ok)

    a = RunningMoments((5, 4, 3))
    b = RunningMoments((5, 4, 3))
    for k in range(17):
        a.add(data[k], ok)
    for k in range(17, 40):
        b.add(data[k], ok)
    a.combine(b)

    np.testing.assert_allclose(a.count, whole.count)
    np.testing.assert_allclose(a.mean, whole.mean, rtol=1e-4)
    np.testing.assert_allclose(a.m2, whole.m2, rtol=1e-3)


def test_sigma_clip_rejects_transient():
    """A bright transient in 2 of 40 frames must not survive clipping —
    the exact failure mode of a plain mean (ghost satellite trails)."""
    rng = np.random.default_rng(2)
    frames = rng.normal(2000, 30, (40, 6, 6, 3)).astype(np.float32)
    frames[5, 3, 3, :] += 20000.0
    frames[6, 3, 3, :] += 20000.0
    ok = np.ones((6, 6), bool)

    mom = RunningMoments((6, 6, 3))
    for f in frames:
        mom.add(f, ok)
    bound = 2.5 * mom.std()

    ssum = np.zeros((6, 6, 3))
    wsum = np.zeros((6, 6, 3))
    for f in frames:
        keep = np.abs(f - mom.mean) <= bound
        ssum += f * keep
        wsum += keep
    clipped = ssum / np.maximum(wsum, 1)

    plain = frames.mean(axis=0)
    assert plain[3, 3, 0] > 2600            # plain mean carries a ghost
    assert abs(clipped[3, 3, 0] - 2000) < 40  # clipped mean does not


def test_frame_noise_weights():
    w = frame_noise_weights({0: 10.0, 1: 10.0, 2: 40.0})  # hazier frame 2
    assert w[0] == w[1] > w[2]
    assert w[2] >= 0.25                      # clipped, never vanishes
    assert abs(np.mean([w[0], w[1], w[2]]) - 1.0) < 0.7


def test_gradient_fit_recovers_linear_ramp():
    h, w = 120, 180
    yy, xx = np.mgrid[0:h, 0:w]
    ramp = (1000 + 8 * xx + 3 * yy).astype(np.float32)
    rgb = np.stack([ramp] * 3, axis=2)
    rng = np.random.default_rng(3)
    rgb += rng.normal(0, 5, rgb.shape).astype(np.float32)
    # sprinkle "stars" the robust fit must ignore
    for _ in range(200):
        y, x = rng.integers(0, h), rng.integers(0, w)
        rgb[y, x] += 30000
    sky = np.ones((h, w), np.float32)

    grad = fit_sky_gradient(rgb, sky)
    assert grad is not None
    # flattening: base - gradient has far less spread than the base
    flat = rgb[:, :, 0] - grad[:, :, 0]
    assert np.percentile(flat, 90) - np.percentile(flat, 10) < 0.15 * (
        np.percentile(rgb[:, :, 0], 90) - np.percentile(rgb[:, :, 0], 10))
    assert grad.min() >= 0                   # Subtract must not darken


def test_gradient_fit_needs_sky():
    rgb = np.full((60, 60, 3), 2000, np.float32)
    no_sky = np.zeros((60, 60), np.float32)
    assert fit_sky_gradient(rgb, no_sky) is None


def test_quality_layers_in_output(pipeline_result, synth_config):
    """The frozen-ground stack and the sky-gradient layer ship in the
    layer manifest (hidden by default — the human decides)."""
    import json
    from pathlib import Path
    manifest = json.loads(
        (Path(synth_config.output_dir) / "g01" / "layers_manifest.json")
        .read_text())
    names = {m["name"] for m in manifest}
    assert any("FG_stacked" in n for n in names)
    assert any("SKY_GRADIENT" in n for n in names)
    grad = [m for m in manifest if "SKY_GRADIENT" in m["name"]][0]
    assert grad["blend"] == "subtract"
    assert not grad["visible"]


def test_background_normalization_beats_drift():
    """Sky brightness drifting across the session (moonrise/dawn) must not
    corrupt rejection: with per-frame normalisation the clipped stack still
    rejects a transient AND lands on the mean sky level."""
    rng = np.random.default_rng(4)
    n = 40
    drift = np.linspace(0, 3000, n)          # sky brightens over the night
    frames = (rng.normal(2000, 30, (n, 6, 6, 3))
              + drift[:, None, None, None]).astype(np.float32)
    frames[8, 2, 2, :] += 20000.0            # one transient
    ok = np.ones((6, 6), bool)

    # normalised path (what the pipeline does)
    bgs = np.percentile(frames.reshape(n, -1, 3), 20, axis=1)
    normed = frames - bgs[:, None, None, :]
    mom = RunningMoments((6, 6, 3))
    for f in normed:
        mom.add(f, ok)
    bound = 2.5 * mom.std()
    ssum = np.zeros((6, 6, 3))
    wsum = np.zeros((6, 6, 3))
    for f in normed:
        keep = np.abs(f - mom.mean) <= bound
        ssum += f * keep
        wsum += keep
    clipped = ssum / np.maximum(wsum, 1) + bgs.mean(axis=0)
    assert abs(clipped[2, 2, 0] - (2000 + drift.mean())) < 60

    # at a clean pixel, un-normalised sigma bounds are inflated by the
    # drift itself (rejection blinded); normalisation removes that
    mom2 = RunningMoments((6, 6, 3))
    for f in frames:
        mom2.add(f, ok)
    assert mom2.std()[0, 0, 0] > 3 * mom.std()[0, 0, 0]


def test_supersampled_pipeline(tmp_path):
    """Drizzle-style output: the sky's own rotation is the dither. The
    pipeline runs on a finer grid and still finds its meteors."""
    import json
    from meteorprep.config import Config
    from meteorprep.pipeline import run
    from meteorprep.testdata.synth import make_synthetic_sequence

    src = tmp_path / "seq"
    gt = make_synthetic_sequence(src, n_frames=8, shape=(300, 450),
                                 focal_px=2443.0 * 450 / 5472, n_stars=220,
                                 n_meteors=1, n_aircraft=0, n_satellites=0,
                                 seed=11)
    json.dump({"super_sample": 1.5, "solve_every_k": 4,
               "catalog_file": str(src / "catalog_radec.npy"),
               "pixel_pitch_um": 16000.0 / gt["focal_px"],
               "emit_psd": False, "emit_gradient_layer": False},
              open(src / "meteorprep_config.json", "w"))
    res = run(Config(input_dir=str(src), output_dir=str(tmp_path / "out")))
    g = res["groups"][0]
    assert g["n_meteors"] >= 1
    import tifffile
    base = tifffile.imread(tmp_path / "out" / "cache" / "g01" / "base.tif")
    assert base.shape[0] == 450 and base.shape[1] == 675   # 1.5x grid
