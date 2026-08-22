"""The Evidence Ledger: where every pixel of the finished sky came from.

The tool's whole claim is that the picture is measured, not invented.
That claim is worth exactly as much as the receipts, so the ledger
classifies every pixel of the shipped canvas by its lineage — how many
frames built it, whether anything was thrown away there, and whether it
is sky at all — and ships it as one indexed image with a legend.
"""

from __future__ import annotations

import numpy as np

# class id -> (label, colour, what it means to a photographer)
LEDGER_CLASSES = [
    (0, "no data", (20, 20, 24),
     "outside every frame's footprint — nothing was measured here"),
    (1, "measured, full depth", (32, 96, 48),
     "built from most or all of the night, nothing rejected"),
    (2, "outliers removed", (196, 148, 40),
     "a quarter or more of this pixel's frames were clipped away — "
     "meteors, planes, satellites, cosmic rays and moving branches live "
     "in this class.  Clipping a stray sample here and there is normal "
     "and stays in the measured class; this marks where something real "
     "was actually removed"),
    (3, "thin coverage", (150, 70, 60),
     "fewer than half the frames reach this pixel; the rim of the "
     "canvas, where the sky rotated out of frame"),
    (4, "ground", (70, 80, 110),
     "below the horizon matte — foreground, not sky"),
]


REJECTION_CLASS_FRACTION = 0.25


def evidence_ledger(coverage: np.ndarray, rejected: np.ndarray,
                    sky_mask: np.ndarray | None = None,
                    reject_frac: float = REJECTION_CLASS_FRACTION):
    """Classify each canvas pixel.  Returns (uint8 class map, legend).

    Precedence runs from the most to the least limiting fact: no data
    beats ground beats thin coverage beats rejection beats a clean
    measurement, so a pixel is always described by its weakest claim.
    """
    cov = np.asarray(coverage)
    rej = np.asarray(rejected)
    led = np.ones(cov.shape[:2], np.uint8)          # 1 = measured
    # Sigma clipping trims the noise tail everywhere — on real frames that
    # touches nearly half the canvas at least once, which says nothing
    # about a pixel's honesty.  Only a pixel that lost a real share of its
    # samples earns the "outliers removed" class.
    # In row bands, in float32.  Written as one expression this promoted
    # the uint16 coverage map to float64 twice — two canvas-sized planes,
    # 320 MB at 20 MP, allocated at the very end of the run when the
    # whole layer stack is already resident.
    for y0 in range(0, cov.shape[0], 256):
        y1 = min(y0 + 256, cov.shape[0])
        thr = cov[y0:y1].astype(np.float32)
        thr *= np.float32(reject_frac)
        np.maximum(thr, np.float32(1.0), out=thr)
        led[y0:y1][rej[y0:y1] >= thr] = 2
    # the 90th percentile of a 20 MP map is the same to three decimals on
    # every 16th pixel, and cov[cov > 0] on the whole canvas is 80 MB
    sub = cov[::4, ::4]
    sub = sub[sub > 0]
    deep = float(np.percentile(sub, 90)) if sub.size else 0.0
    if deep > 0:
        led[cov < 0.5 * deep] = 3
    if sky_mask is not None and sky_mask.shape[:2] == led.shape[:2]:
        led[np.asarray(sky_mask, np.float32) < 0.5] = 4
    led[cov == 0] = 0
    total = float(led.size)
    legend = [{"id": cid, "label": label, "color": list(color),
               "meaning": meaning,
               "percent": float(np.count_nonzero(led == cid)) * 100.0 / total}
              for cid, label, color, meaning in LEDGER_CLASSES]
    return led, legend


_PALETTE_RGB = np.zeros((len(LEDGER_CLASSES), 3), np.uint8)
_PALETTE_BGR = np.zeros((len(LEDGER_CLASSES), 3), np.uint8)
for _cid, _l, (_r, _g, _b), _m in LEDGER_CLASSES:
    _PALETTE_RGB[_cid] = (_r, _g, _b)
    _PALETTE_BGR[_cid] = (_b, _g, _r)


def ledger_rgb(led: np.ndarray) -> np.ndarray:
    """Paint the class map with the legend colours (RGB uint8)."""
    return _PALETTE_RGB[led]


def ledger_bgr(led: np.ndarray) -> np.ndarray:
    """The same picture in the byte order cv2.imwrite wants, so writing
    it does not need a second full-canvas copy to swap two channels."""
    return _PALETTE_BGR[led]
