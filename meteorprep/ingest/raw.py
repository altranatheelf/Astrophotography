"""RAW decoding via rawpy/LibRaw (§2.1), plus TIFF/FITS passthrough so the
synthetic pipeline and pre-converted data flow through the same code path.

Two decode modes:
  * ``detect``: fast linear demosaic, no WB, gamma (1,1), no auto-bright,
    16-bit — keeps stacking statistics valid.
  * ``final``: AHD demosaic, as-shot camera WB, sRGB, gamma (1,1), 16-bit —
    for the base and meteor RGB layers.

The embedded JPEG thumbnail is used only for contact sheets / GUI, never
for anything measured.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

log = logging.getLogger("meteorprep")

RAW_EXTS = {".cr2", ".cr3", ".nef", ".arw", ".dng", ".raf", ".orf", ".rw2"}

_DETECT_KW = dict(half_size=False, use_camera_wb=False, use_auto_wb=False,
                  user_wb=[1.0, 1.0, 1.0, 1.0], no_auto_bright=True,
                  gamma=(1, 1), output_bps=16)
_FINAL_KW = dict(use_camera_wb=True, no_auto_bright=True,
                 gamma=(1, 1), output_bps=16)


def is_raw(path: Path) -> bool:
    return Path(path).suffix.lower() in RAW_EXTS


def decode(path: Path, mode: str = "detect",
           bad_pixels: np.ndarray | None = None,
           half_size: bool = False) -> np.ndarray:
    """Decode any supported frame to a 16-bit linear RGB (H, W, 3) array.

    ``half_size=True`` decodes at half resolution (2x2 superpixel): ~4x
    less memory/scratch disk and time, for space-constrained machines.
    """
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix in (".tif", ".tiff"):
        import tifffile
        arr = tifffile.imread(path)
        if arr.ndim == 2:
            arr = np.stack([arr] * 3, axis=2)
        if half_size:
            h2, w2 = arr.shape[0] // 2 * 2, arr.shape[1] // 2 * 2
            arr = arr[:h2, :w2].astype(np.float32)
            arr = arr.reshape(h2 // 2, 2, w2 // 2, 2, -1).mean(axis=(1, 3))
        return np.clip(arr, 0, 65535).astype(np.uint16)
    if suffix in (".fits", ".fit"):
        from astropy.io import fits
        with fits.open(path) as hdul:
            arr = hdul[0].data.astype(np.float32)
        arr = np.clip(arr, 0, 65535).astype(np.uint16)
        if arr.ndim == 2:
            arr = np.stack([arr] * 3, axis=2)
        return arr
    if suffix in RAW_EXTS:
        import rawpy

        with rawpy.imread(str(path)) as raw:
            if bad_pixels is not None and len(bad_pixels):
                try:
                    import contextlib
                    import io as _io

                    from rawpy import enhance
                    with contextlib.redirect_stdout(_io.StringIO()):
                        enhance.repair_bad_pixels(raw, bad_pixels,
                                                  method="median")
                except Exception as exc:
                    log.warning("bad-pixel repair failed for %s: %s", path.name, exc)
            import rawpy as _rp
            if mode == "final":
                # PPG: measured on real frames — star FWHM equal to DHT
                # (2.67 vs 2.65 px) at 1.85x the decode speed
                algo = getattr(_rp.DemosaicAlgorithm, "PPG",
                               _rp.DemosaicAlgorithm.AHD)
                kw = dict(_FINAL_KW, demosaic_algorithm=algo,
                          output_color=_rp.ColorSpace.sRGB)
            else:
                kw = dict(_DETECT_KW,
                          demosaic_algorithm=_rp.DemosaicAlgorithm.LINEAR,
                          output_color=_rp.ColorSpace.raw)
            kw["half_size"] = half_size
            return raw.postprocess(**kw)
    raise ValueError(f"unsupported frame type: {path}")


def find_bad_pixels(paths: list[Path]) -> np.ndarray | None:
    """Hot/dead pixel map across the group (prevents hot pixels being
    flagged as cosmic-ray streaks or corrupting solver source lists)."""
    raw_paths = [str(p) for p in paths if is_raw(p)]
    if len(raw_paths) < 3:
        return None
    try:
        from rawpy import enhance
        bad = enhance.find_bad_pixels(raw_paths[:10])
    except Exception as exc:
        log.warning("find_bad_pixels failed: %s", exc)
        return None
    # long-exposure high-ISO sensors genuinely carry 100k+ warm pixels
    # (confirmed against real frames: the flagged pixels are static across
    # frames while every star drifts).  Only a truly pathological count —
    # several percent of the sensor — marks a broken scan.
    if bad is not None and len(bad) > 500000:
        log.warning("hot-pixel scan flagged %d pixels — several percent of "
                    "the sensor, so the map is distrusted and skipped",
                    len(bad))
        return None
    if bad is not None and len(bad) > 20000:
        log.info("hot-pixel map: %d warm pixels will be repaired in every "
                 "decode (normal for long exposures on older sensors)",
                 len(bad))
    return bad


def luminance(rgb: np.ndarray) -> np.ndarray:
    """Rec.601 luminance on linear data, float32."""
    rgb = rgb.astype(np.float32)
    if rgb.ndim == 2:
        return rgb
    return 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]


def extract_thumb(path: Path) -> np.ndarray | None:
    """Embedded JPEG preview (contact sheet / GUI only)."""
    if not is_raw(path):
        return None
    try:
        import io

        import rawpy
        from PIL import Image

        with rawpy.imread(str(path)) as raw:
            t = raw.extract_thumb()
        if t.format == rawpy.ThumbFormat.JPEG:
            return np.asarray(Image.open(io.BytesIO(t.data)))
        return t.data
    except Exception:
        return None
