"""The whole night as a short film.

The frames are already on disk in time order and the run has already
learned how to develop them — so a timelapse costs one more pass of
half-size decodes and nothing else.  One fixed stretch is measured from
a sample of the night and applied to every frame (a per-frame stretch
flickers), then each frame is nudged by a single luminance factor toward
a slow-moving target (clouds and twilight still read; shutter/ISO
steps and plane flashes stop strobing).
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

log = logging.getLogger("meteorprep")


def _open_writer(out_path: Path, size_wh, fps: float):
    """mp4 first; MJPG-in-avi as the everything-has-it fallback."""
    import cv2

    for fourcc, path in (("mp4v", out_path),
                         ("avc1", out_path),
                         ("MJPG", out_path.with_suffix(".avi"))):
        wr = cv2.VideoWriter(str(path),
                             cv2.VideoWriter_fourcc(*fourcc),
                             fps, size_wh)
        if wr.isOpened():
            return wr, path
        wr.release()
    return None, None


def write_timelapse(decode, order, out_path: Path, gains=None,
                    max_width: int = 1920, fps: float = 24.0,
                    notify=None) -> Path | None:
    """Write the night as a video.

    ``decode(i)`` returns frame ``i`` as linear uint16 RGB (half size is
    plenty); ``order`` is the frame indices in time order.  Returns the
    written path or None — a film is a bonus, never a failure.
    """
    try:
        import cv2

        from meteorprep.report.preview import _asinh_stretch

        if len(order) < 2:
            return None
        g = None
        if gains is not None:
            g = np.asarray(gains, np.float32).reshape(1, 1, 3)
            if not (np.all(np.isfinite(g))
                    and np.all((g > 0.5) & (g < 2.0))):
                g = None

        def _lin(i):
            f = decode(i).astype(np.float32)
            return f * g if g is not None else f

        # one stretch for the whole night, measured from a spread of it
        probe_idx = [order[k * (len(order) - 1) // 4] for k in range(5)]
        probe = _lin(probe_idx[len(probe_idx) // 2])
        h0, w0 = probe.shape[:2]
        s = min(1.0, max_width / w0)
        tw, th = ((max_width, int(round(h0 * s))) if s < 1.0
                  else (w0, h0))
        tw -= tw % 2
        th -= th % 2                      # codecs want even dimensions
        sub = np.concatenate(
            [_lin(i)[::4, ::4].reshape(-1, 3) for i in probe_idx])
        black = np.percentile(sub, 22.0, axis=0).astype(np.float32)
        soft = 120.0
        x = np.arcsinh(np.maximum(sub - black, 0) / soft)
        hi = max(float(np.percentile(x, 99.85)), 1e-6)
        del sub, x, probe

        wr, path = _open_writer(Path(out_path), (tw, th), fps)
        if wr is None:
            log.warning("timelapse: no video codec available; skipped")
            return None
        target = None
        try:
            for k, i in enumerate(order):
                lin = _lin(i)
                if lin.shape[:2] != (th, tw):
                    lin = cv2.resize(lin, (tw, th),
                                     interpolation=cv2.INTER_AREA)
                disp = np.arcsinh(
                    np.maximum(lin - black[None, None, :], 0) / soft) / hi
                # deflicker: one scalar per frame toward a slow target
                med = float(np.median(disp[::4, ::4]))
                if med > 1e-6:
                    if target is None:
                        target = med
                    scale = float(np.clip(target / med, 0.7, 1.4))
                    disp *= scale
                    target = 0.9 * target + 0.1 * (med * scale)
                out8 = (np.clip(disp, 0, 1) * 255).astype(np.uint8)
                wr.write(cv2.cvtColor(out8, cv2.COLOR_RGB2BGR))
                if notify is not None and (k % 5 == 0
                                           or k == len(order) - 1):
                    notify(k + 1, len(order))
        finally:
            wr.release()
        if not path.exists() or path.stat().st_size < 1000:
            log.warning("timelapse: writer produced no usable file")
            path.unlink(missing_ok=True)
            return None
        log.info("timelapse: %s (%d frames, %.0f MB)", path.name,
                 len(order), path.stat().st_size / 1e6)
        return path
    except Exception as exc:
        log.warning("timelapse skipped (%s); every other output is "
                    "unaffected", exc)
        return None
