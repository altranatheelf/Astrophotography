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


def _repair_bad_pixels_fast(raw, coords: np.ndarray) -> None:
    """Median-repair the flagged pixels in place — bit-identical to
    rawpy.enhance.repair_bad_pixels (verified on real frames) but ~4x
    faster: instead of median-blurring the whole sensor four times per
    decode, only the flagged pixels' 3x3 same-colour neighbourhoods are
    gathered (index clipping = the blur's replicated border)."""
    if raw.raw_pattern.shape[0] != 2:
        raise NotImplementedError("non-2x2 CFA")
    img = raw.raw_image_visible
    coords = np.asarray(coords)
    for oy in (0, 1):
        for ox in (0, 1):
            m = (coords[:, 0] % 2 == oy) & (coords[:, 1] % 2 == ox)
            if not m.any():
                continue
            cs = coords[m]
            sl = img[oy::2, ox::2]
            hh, ww = sl.shape
            y, x = cs[:, 0] // 2, cs[:, 1] // 2
            neigh = np.empty((len(cs), 9), sl.dtype)
            k = 0
            for dy in (-1, 0, 1):
                yy = np.clip(y + dy, 0, hh - 1)
                for dx in (-1, 0, 1):
                    neigh[:, k] = sl[yy, np.clip(x + dx, 0, ww - 1)]
                    k += 1
            neigh.sort(axis=1)
            sl[y, x] = neigh[:, 4]


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
        if arr.ndim == 2:
            arr = np.stack([arr] * 3, axis=2)
        if half_size:                      # keep the S=2 scale contract
            h2, w2 = arr.shape[0] // 2 * 2, arr.shape[1] // 2 * 2
            arr = arr[:h2, :w2].reshape(h2 // 2, 2, w2 // 2, 2,
                                        -1).mean(axis=(1, 3))
        return np.clip(arr, 0, 65535).astype(np.uint16)
    if suffix in RAW_EXTS:
        import rawpy

        with rawpy.imread(str(path)) as raw:
            if bad_pixels is not None and len(bad_pixels):
                try:
                    _repair_bad_pixels_fast(raw, bad_pixels)
                except Exception:
                    try:
                        import contextlib
                        import io as _io

                        from rawpy import enhance
                        with contextlib.redirect_stdout(_io.StringIO()):
                            enhance.repair_bad_pixels(raw, bad_pixels,
                                                      method="median")
                    except Exception as exc:
                        log.warning("bad-pixel repair failed for %s: %s",
                                    path.name, exc)
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


def _bad_pixel_mask_one(path: str) -> np.ndarray:
    """Per-frame defect mask: pixels that read high, or that read low at
    all, against the median of their own colour's neighbours.

    This is rawpy.enhance's candidate rule stated in signed arithmetic.
    Its own version subtracts into a uint16 buffer, so every pixel merely
    darker than its neighbours wraps to a huge positive difference and is
    flagged — which sounds like a bug and is in practice a useful one: the
    surviving map (pixels that read low in nine frames out of ten) is the
    sensor's fixed-pattern noise, and replacing those with their local
    median measurably helps faint-streak detection.  Restricting it to
    genuine 6-sigma outliers was tried, produced a far better plate solve,
    and lost two real detections on a night that has only two, so the
    behaviour stays and only the speed changes.

    The speed is where the win is: the old path built a coordinate list
    per frame — 8.7 million entries each, a gigabyte across ten frames,
    then a sort to count them.  A mask summed into one count image is the
    same answer, bit for bit, eleven times faster.
    """
    import cv2
    import rawpy

    raw = rawpy.imread(path)
    try:
        if raw.raw_type != rawpy.RawType.Flat:
            raise NotImplementedError("only Bayer-type images supported")
        img = raw.raw_image_visible
        thresh = max(int(np.max(img)) // 150, 20)
        out = np.zeros(img.shape, np.uint8)
        # each Bayer colour is its own image: a green pixel's neighbours
        # are the greens two pixels away, not the reds beside it
        for oy in (0, 1):
            for ox in (0, 1):
                sl = np.require(img[oy::2, ox::2], img.dtype, "C")
                med = cv2.medianBlur(sl, 3)
                cand = (sl > med.astype(np.int32) + thresh) | (sl < med)
                out[oy::2, ox::2] = cand.astype(np.uint8)
        return out
    finally:
        raw.close()


def _find_bad_pixels_parallel(raw_paths: list[str],
                              confirm: float = 0.9) -> np.ndarray:
    """Defects confirmed across frames: a real one is bad in (almost)
    every frame, while a star or a cosmic ray moves.  Masks are summed
    into one count image — 40 MB — instead of concatenating every frame's
    candidate coordinates, which used to reach a gigabyte."""
    from concurrent.futures import ThreadPoolExecutor

    acc = None
    with ThreadPoolExecutor(max_workers=min(4, len(raw_paths))) as tp:
        for m in tp.map(_bad_pixel_mask_one, raw_paths):
            if acc is None:
                acc = np.zeros(m.shape, np.uint16)
            acc += m
    if acc is None:
        return np.zeros((0, 2), np.int64)
    if len(raw_paths) == 1:
        return np.transpose(np.nonzero(acc > 0))
    need = max(int(np.ceil(confirm * len(raw_paths))), 2)
    return np.transpose(np.nonzero(acc >= need))


def find_bad_pixels(paths: list[Path]) -> np.ndarray | None:
    """Hot/dead pixel map across the group (prevents hot pixels being
    flagged as cosmic-ray streaks or corrupting solver source lists)."""
    raw_paths = [str(p) for p in paths if is_raw(p)]
    if len(raw_paths) < 3:
        return None
    try:
        bad = _find_bad_pixels_parallel(raw_paths[:10])
    except Exception as exc:
        log.info("parallel hot-pixel scan unavailable (%s); serial", exc)
        try:
            from rawpy import enhance
            bad = enhance.find_bad_pixels(raw_paths[:10])
        except Exception as exc2:
            log.warning("find_bad_pixels failed: %s", exc2)
            return None
    # A sensor has thousands of genuine defects, not hundreds of
    # thousands.  The cap is a backstop against a scan that has gone
    # wrong (a folder of flats, a stuck sensor), not a normal outcome.
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


_LUM_W = np.array([0.299, 0.587, 0.114], np.float32)


def luminance(rgb: np.ndarray) -> np.ndarray:
    """Rec.601 luminance on linear data, float32.

    A matrix product over the channel axis instead of three scaled slices
    added together: same numbers, one pass over memory instead of five,
    and no full-size astype copy when the input is already float32
    (measured 3.7x faster on a 20 MP frame, 1.9x from uint16).
    """
    rgb = np.asarray(rgb)
    if rgb.ndim == 2:
        return np.asarray(rgb, np.float32)
    return (rgb.reshape(-1, rgb.shape[2]) @ _LUM_W).reshape(rgb.shape[:2])


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
