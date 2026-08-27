"""Finish the picture without leaving the app.

The layered outputs stay linear and untouched — that contract does not
move.  But the tools this one is measured against end the night by
handing over a flat TIFF and an apology: every adjustment happens in
someone else's software.  This module is the missing last step.  The
assembly saves a small *finishing bundle* — the composite's actual
ingredients (linear sky, frozen foreground, horizon mask, star-measured
colour gains, sky gradient, the meteors' own screen layer) at share
resolution — and the window's Adjust screen re-renders the finished
picture from it live: brightness, warmth, saturation, foreground light,
light-pollution removal, meteor strength.  Export writes a full-quality
JPEG (and a 16-bit TIFF for printing) from the same math.

Everything here renders in the same order as report/preview.py — the
default slider positions reproduce preview.jpg — so what the person saw
at the end of the run is exactly where their editing starts.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import numpy as np

log = logging.getLogger("meteorprep")

BUNDLE_NAME = "finish_bundle.npz"

#: slider defaults — the identity render (== preview.jpg)
DEFAULTS = {
    "brightness": 1.0,     # 0.4 … 2.5, scales the stretch
    "warmth": 0.0,         # -1 … 1, red/blue tilt on top of the star WB
    "saturation": 1.0,     # 0 … 2
    "foreground": 1.0,     # 0.25 … 3, linear gain on the frozen ground
    "depollute": 0.0,      # 0 … 1, fraction of the sky gradient removed
    "boost": 1.0,          # 0 … 2.5, meteor-layer strength
    "show_flagged": False,  # satellites/planes too
}


def _downsize(a, tw, th, interp=None):
    import cv2
    a = np.asarray(a)
    if a.shape[:2] == (th, tw):
        return a
    return cv2.resize(a, (tw, th),
                      interpolation=interp or cv2.INTER_AREA)


def save_finish_bundle(out_dir: Path, base_img, fg_img, sky_mask, gains,
                       meteor_layers, flagged_layers=None, crop_xy=(0, 0),
                       grad_sky_mask=None, max_width: int = 4096):
    """Write the finishing bundle next to the other outputs.

    All inputs are the exact arrays render_preview received (canvas-sized
    linear float, uncropped-coordinate layer bboxes, ``crop_xy`` naming
    the seam-crop origin).  Returns the bundle path, or None — a failed
    bundle costs a feature, never the run.
    """
    try:
        from meteorprep.report.preview import _blend_streaks

        h0, w0 = base_img.shape[:2]
        s = min(1.0, max_width / w0)
        tw, th = ((max_width, int(round(h0 * s))) if s < 1.0
                  else (w0, h0))

        arrs: dict = {"ver": np.int32(1),
                      "gains": (np.asarray(gains, np.float32)
                                if gains is not None
                                else np.ones(3, np.float32))}
        arrs["sky"] = np.clip(_downsize(base_img, tw, th),
                              0, 65535).astype(np.uint16)
        if fg_img is not None and fg_img.shape[:2] == (h0, w0):
            arrs["fg"] = np.clip(_downsize(fg_img, tw, th),
                                 0, 65535).astype(np.uint16)
        if sky_mask is not None:
            import cv2
            arrs["skymask"] = np.clip(
                _downsize(sky_mask, tw, th, cv2.INTER_LINEAR) * 255.0,
                0, 255).astype(np.uint8)
        # the sky gradient, for the light-pollution slider: fitted on the
        # bundle-sized sky (the fit is a smooth low-order surface, so the
        # small canvas gives the same answer for a fraction of the work)
        # and stored at 1/8 scale — it has no detail to lose
        try:
            from meteorprep.stack.gradient import fit_sky_gradient
            gmask = (arrs.get("skymask", None))
            gmask = (gmask.astype(np.float32) / 255.0
                     if gmask is not None else
                     (_downsize(grad_sky_mask, tw, th)
                      if grad_sky_mask is not None else
                      np.ones((th, tw), np.float32)))
            grad = fit_sky_gradient(arrs["sky"].astype(np.float32), gmask)
            if grad is not None:
                arrs["grad"] = np.clip(
                    _downsize(grad, max(tw // 8, 1), max(th // 8, 1)),
                    0, 65535).astype(np.uint16)
        except Exception as exc:
            log.info("finish bundle: no gradient surface (%s)", exc)
        # the meteors' combined screen contribution, captured at the same
        # auto-gain the preview uses; the boost slider scales it
        wb = arrs["gains"].reshape(1, 1, 3)
        for key, layers in (("met", meteor_layers),
                            ("flg", flagged_layers)):
            if not layers:
                continue
            canvas = np.zeros((th, tw, 3), np.float32)
            _blend_streaks(canvas, layers, s, wb,
                           gain_cap=(40.0 if key == "met" else 25.0),
                           crop_xy=crop_xy)
            if float(canvas.max()) > 0:
                arrs[key] = np.clip(canvas * 255.0, 0,
                                    255).astype(np.uint8)
        dest = Path(out_dir) / BUNDLE_NAME
        tmp = dest.with_suffix(f".tmp{os.getpid()}.npz")
        with open(tmp, "wb") as fh:
            np.savez_compressed(fh, **arrs)
        os.replace(tmp, dest)
        log.info("finish bundle: %s (%.0f MB) — the window's Adjust "
                 "screen edits from this", dest.name,
                 dest.stat().st_size / 1e6)
        return dest
    except Exception as exc:
        log.warning("finish bundle skipped (%s); every other output is "
                    "unaffected", exc)
        return None


def load_finish_bundle(path, max_width: int | None = None) -> dict:
    """Load a bundle into render-ready float arrays, optionally downsized
    to ``max_width`` (the Adjust screen's live renders use ~1100)."""
    import cv2

    with np.load(path) as z:
        d = {k: z[k] for k in z.files}
    sky = d["sky"].astype(np.float32)
    h0, w0 = sky.shape[:2]
    s = 1.0
    if max_width and w0 > max_width:
        s = max_width / w0
        tw, th = max_width, int(round(h0 * s))
    else:
        tw, th = w0, h0
    out = {"gains": d.get("gains", np.ones(3, np.float32))
           .astype(np.float32),
           "sky": _downsize(sky, tw, th)}
    if "fg" in d:
        out["fg"] = _downsize(d["fg"].astype(np.float32), tw, th)
    if "skymask" in d:
        out["skymask"] = _downsize(d["skymask"].astype(np.float32) / 255.0,
                                   tw, th, cv2.INTER_LINEAR)
    if "grad" in d:
        out["grad"] = _downsize(d["grad"].astype(np.float32), tw, th,
                                cv2.INTER_LINEAR)
    for k in ("met", "flg"):
        if k in d:
            out[k] = _downsize(d[k].astype(np.float32) / 255.0, tw, th,
                               cv2.INTER_LINEAR)
    return out


def render_finish(b: dict, params: dict | None = None) -> np.ndarray:
    """Render the finished picture from a loaded bundle: float RGB in
    [0, 1].  Default params reproduce preview.jpg."""
    from meteorprep.report.preview import _asinh_stretch

    p = dict(DEFAULTS)
    p.update(params or {})
    gains = b["gains"].reshape(1, 1, 3)
    warm = np.array([1.0 + 0.25 * p["warmth"], 1.0,
                     1.0 - 0.25 * p["warmth"]], np.float32).reshape(1, 1, 3)
    lin = b["sky"] * (gains * warm)
    if p["depollute"] > 0 and "grad" in b:
        # remove a chosen fraction of the fitted sky surface, then put
        # its median back so the overall level (and the stretch's black
        # point) stays put — only the tilt goes away
        g = b["grad"] * (gains * warm)
        lin = lin - p["depollute"] * (g - np.median(g, axis=(0, 1),
                                                    keepdims=True))
        np.maximum(lin, 0.0, out=lin)
    skym = b.get("skymask")
    if "fg" in b and skym is not None:
        fgl = b["fg"] * (gains * warm) * float(p["foreground"])
        a = (1.0 - np.clip(skym, 0, 1))[..., None]
        lin += a * (fgl - lin)
    disp = _asinh_stretch(
        lin, soft=120.0 / max(float(p["brightness"]), 0.05), sky=skym)
    if p["saturation"] != 1.0:
        luma = (disp @ np.array([0.2126, 0.7152, 0.0722],
                                np.float32))[..., None]
        disp = np.clip(luma + float(p["saturation"]) * (disp - luma),
                       0.0, 1.0)
    for key, on in (("met", True), ("flg", bool(p["show_flagged"]))):
        if on and key in b and p["boost"] > 0:
            c = np.clip(b[key] * float(p["boost"]), 0.0, 1.0)
            disp = 1.0 - (1.0 - disp) * (1.0 - c)
    return np.clip(disp, 0.0, 1.0)


def export_finish(bundle_path, params: dict | None, out_dir,
                  want_tiff: bool = False) -> dict:
    """Render at full bundle resolution and write the finished files.

    Returns {"jpg": path, "tif": path | None}."""
    import cv2

    b = load_finish_bundle(bundle_path)
    disp = render_finish(b, params)
    out_dir = Path(out_dir)
    jpg = out_dir / "meteorprep_finished.jpg"
    out8 = (disp * 255.0 + 0.5).astype(np.uint8)
    if not cv2.imwrite(str(jpg), cv2.cvtColor(out8, cv2.COLOR_RGB2BGR),
                       [cv2.IMWRITE_JPEG_QUALITY, 95]):
        raise OSError(f"could not write {jpg}")
    tif = None
    if want_tiff:
        import tifffile
        tif = out_dir / "meteorprep_finished.tif"
        tifffile.imwrite(tif, (disp * 65535.0 + 0.5).astype(np.uint16),
                         photometric="rgb")
    return {"jpg": jpg, "tif": tif}
