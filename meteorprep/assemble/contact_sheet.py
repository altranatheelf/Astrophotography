"""Contact sheet (§7.5): a grid of every candidate's ROI crop from the
difference image, annotated with id, confidence, flags and radiant miss —
the practical substitute for labelled ground truth."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

CELL = 256
PAD = 24


def make_contact_sheet(candidates, roi_images: dict[str, np.ndarray],
                       out_path: Path) -> Path | None:
    if not candidates:
        return None
    cols = min(6, max(1, int(np.ceil(np.sqrt(len(candidates))))))
    rows = int(np.ceil(len(candidates) / cols))
    sheet = Image.new("RGB", (cols * CELL, rows * (CELL + PAD)), (16, 16, 20))
    draw = ImageDraw.Draw(sheet)

    for k, cand in enumerate(candidates):
        r, c = divmod(k, cols)
        x0, y0 = c * CELL, r * (CELL + PAD)
        roi = roi_images.get(cand.id)
        if roi is not None and roi.size:
            arr = roi.astype(np.float32)
            lo, hi = np.percentile(arr, 1), np.percentile(arr, 99.8)
            arr = np.clip((arr - lo) / max(hi - lo, 1e-3), 0, 1)
            img = Image.fromarray((arr * 255).astype(np.uint8)).convert("RGB")
            img.thumbnail((CELL - 8, CELL - 8))
            sheet.paste(img, (x0 + 4, y0 + 4))
        flag = ",".join(k_ for k_, v in cand.flags.items() if v) or cand.label
        miss = ("" if np.isnan(cand.radiant_miss_deg)
                else f" miss={cand.radiant_miss_deg:.1f}°")
        draw.text((x0 + 6, y0 + CELL - 14),
                  f"{cand.id} c={cand.confidence:.2f} {flag}{miss}",
                  fill=(240, 220, 100))
    sheet.save(out_path)
    return out_path
