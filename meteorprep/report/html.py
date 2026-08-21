"""One-double-click run report: preview, meteor lineup with a crop of
every candidate, stage timings, and a plain explanation of every file."""

from __future__ import annotations

import html
import logging
from pathlib import Path

log = logging.getLogger("meteorprep")


def render_candidate_crops(candidates, layer_pairs, roi_images,
                           out_dir: Path, max_px: int = 360) -> dict:
    """One auto-brightened JPG crop per candidate so every detection can
    be vetted from the report without opening Photoshop.  Prefers the
    extracted RGB layer; falls back to the detection-space difference
    crop.  Returns {candidate_id: relative path}."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return {}
    media = Path(out_dir) / "report_media"
    media.mkdir(parents=True, exist_ok=True)
    best_layer = {}
    for (c, layer, _i, _si) in layer_pairs:
        best_layer.setdefault(c.id, layer)
    crops = {}
    for c in candidates:
        try:
            def _small(a_):
                """Down to thumbnail size before the arithmetic: these
                are a few hundred pixels wide, and a bright meteor's
                layer can be several megapixels."""
                hgt_, wdt_ = a_.shape[:2]
                s_ = min(1.0, max_px / max(hgt_, wdt_, 1))
                if s_ >= 1.0:
                    return a_
                return cv2.resize(a_, (max(int(wdt_ * s_), 1),
                                       max(int(hgt_ * s_), 1)),
                                  interpolation=cv2.INTER_AREA)

            lyr = best_layer.get(c.id)
            if lyr is not None:
                rgb = np.asarray(lyr.rgb, np.float32)
                a = (np.asarray(lyr.alpha, np.float32)
                     if lyr.alpha is not None
                     else np.ones(rgb.shape[:2], np.float32))
                # the brightening gain is read off the full-size layer,
                # so the thumbnail is stretched exactly as the layer is
                peak = float((rgb.max(axis=2) * a).max())
                gain = min(0.9 * 65535.0 / max(peak, 1.0), 60.0)
                rgb, a = _small(rgb), _small(a)
                lin = np.clip(rgb * gain, 0, 65535) / 65535.0
                disp = np.sqrt(lin) * a[:, :, None]
            else:
                roi = roi_images.get(c.id)
                if roi is None:
                    continue
                roi = np.asarray(roi, np.float32)
                hi = max(float(np.percentile(roi, 99.9)), 1.0)
                mono = np.sqrt(np.clip(_small(roi) / hi, 0, 1))
                disp = np.dstack([mono] * 3)
            out8 = (np.clip(disp, 0, 1) * 255).astype(np.uint8)
            fname = f"cand_{c.id}.jpg"
            cv2.imwrite(str(media / fname),
                        cv2.cvtColor(out8, cv2.COLOR_RGB2BGR),
                        [cv2.IMWRITE_JPEG_QUALITY, 88])
            crops[c.id] = f"report_media/{fname}"
        except Exception as exc:
            log.debug("crop render failed for %s: %s", c.id, exc)
    return crops


def _physics_cell(ph: dict) -> str:
    """Short human summary of one candidate's physics estimates."""
    if not ph or ph.get("est_duration_s") is None:
        el = ph.get("elevation_deg") if ph else None
        return f"{el:.0f}&deg; up" if el is not None else "-"
    if ph.get("geometry_consistent") is False:
        return (f"{ph['elevation_deg']:.0f}&deg; up &middot; too slow for "
                "a meteor")
    return (f"~{ph['est_duration_s']:.2f}s &middot; "
            f"~{ph['assumed_ablation_km']:.0f} km up &middot; "
            f"~{ph['est_range_km']:.0f} km away")


def write_report_html(out_dir: Path, group_result: dict,
                      have_preview: bool, have_contact: bool,
                      have_psd: bool, crops: dict | None = None,
                      timings: list | None = None,
                      info: dict | None = None,
                      looks: list | None = None,
                      capsule: dict | None = None,
                      draft: bool = False) -> Path:
    g = group_result
    cands = g.get("candidates", [])
    meteors = [c for c in cands if c.get("label") == "meteor"]
    flagged = [c for c in cands if c.get("label") != "meteor"]
    crops = crops or {}

    any_physics = any((c.get("physics") or {}).get("est_duration_s")
                      for c in cands)
    phys_head = "<th>estimated</th>" if any_physics else ""

    rows = []
    for c in cands:
        cid = str(c.get("id", "?"))
        crop_rel = crops.get(cid) or crops.get(c.get("id"))
        thumb = (f'<a href="{crop_rel}"><img src="{crop_rel}" '
                 f'style="height:72px;border-radius:4px"></a>'
                 if crop_rel else "&mdash;")
        rows.append(
            "<tr><td>{thumb}</td><td>{id}</td><td>{label}</td>"
            "<td>{frames}</td><td>{conf:.0%}</td><td>{miss}</td>"
            "{phys}</tr>"
            .format(
                phys=(f"<td>{_physics_cell(c.get('physics') or {})}</td>"
                      if any_physics else ""),
                thumb=thumb,
                id=html.escape(cid),
                label=html.escape(str(c.get("label", "?"))),
                frames=html.escape(", ".join(c.get("frames", []))),
                conf=float(c.get("confidence", 0) or 0),
                miss=(f"{c['radiant_miss_deg']:.0f}&deg;"
                      if c.get("radiant_miss_deg") is not None else "-")))

    physics_note = (
        "<p>Estimated column: how high it burned, how far away it was and "
        "how long it lasted. A single camera measures direction, not "
        "distance &mdash; these follow from the measured sky position "
        "plus two stated assumptions (meteors of this shower burn near "
        "95&nbsp;km up and arrive at about 59&nbsp;km/s), and both "
        "assumptions travel with the numbers in meteorprep.json. The "
        "camera's clock is read as UTC, so a camera set to local time "
        "shifts these three numbers &mdash; the sky positions and "
        "verdicts do not depend on the clock.</p>"
        if any_physics else "")

    capsule_html = ""
    if capsule:
        from meteorprep.report.capsule import as_text
        capsule_html = (
            "<h2>How this image was made</h2>"
            "<p>Paste this under the photo &mdash; it is also saved as "
            "<b>capsule.txt</b>.</p>"
            f"<pre class=\"capsule\">{html.escape(as_text(capsule))}</pre>")

    timing_html = ""
    if timings:
        total = sum(t for _, t in timings)
        trows = "".join(
            f"<tr><td>{html.escape(lbl)}</td><td>{t:.1f}s</td>"
            f"<td>{100 * t / max(total, 1e-9):.0f}%</td></tr>"
            for lbl, t in timings)
        timing_html = (f"<h2>Where the time went</h2><table>"
                       f"<tr><th>stage</th><th>time</th><th>share</th></tr>"
                       f"{trows}<tr><th>total</th>"
                       f"<th>{total / 60:.1f} min</th><th></th></tr></table>")

    info_html = ""
    if info:
        items = "".join(
            f"<li><b>{html.escape(str(k))}</b>: {html.escape(str(v))}</li>"
            for k, v in info.items())
        info_html = f"<h2>Technical detail</h2><ul>{items}</ul>"

    looks_html = ""
    if looks and len(looks) > 1:
        cards = "".join(
            f'<div class="look"><a href="{fn}"><img src="{fn}"></a>'
            f'<h3>{html.escape(title)}</h3>'
            f'<p>{html.escape(caption)}</p></div>'
            for fn, title, caption in looks)
        looks_html = (
            "<h2>Pick your look</h2>"
            "<p>Three finished versions of the same night — every one is "
            "share-ready as-is, and the layered Photoshop file lets you "
            "build any of them (and more) yourself.</p>"
            f'<div class="looks">{cards}</div>')

    draft_banner = ""
    if draft:
        draft_banner = (
            '<div class="card" style="background:#3a2c12;'
            'border:1px solid #7a5c20">'
            '<b>This is the quick look.</b> A half-size picture, no '
            'layered Photoshop file, and the slower second pass for the '
            'faintest meteors was skipped. Everything that decides '
            '<i>what</i> is in the picture — which photos, where the sky '
            'is, which streaks are meteors — is exactly what Full quality '
            'does, so the verdicts below are the real ones. Run the same '
            'folder again on <b>Full quality</b> for the layered file: the '
            'scan, the star lock and the whole meteor search are already '
            'done and will be reused, so it starts most of the way in.'
            '</div>')

    open_line = (
        "<b>meteorprep.psd</b> — the layered Photoshop file (drag it in)"
        if have_psd else
        "<b>assemble.jsx</b> — in Photoshop: File &gt; Scripts &gt; "
        "Browse&hellip; and pick this file; it builds the layered document")
    if draft:
        open_line = ("<b>preview.jpg</b> — the whole point of a quick "
                     "look: open it, then decide whether the night is "
                     "worth the full run")

    body = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>METEORPREP run report</title>
<style>
 body {{ font: 15px/1.5 -apple-system, system-ui, sans-serif;
        margin: 2em auto; max-width: 900px; color: #ddd; background:#161a20 }}
 h1,h2 {{ color: #fff }} a {{ color: #7ab7ff }}
 img {{ max-width: 100%; border-radius: 6px }}
 table {{ border-collapse: collapse; width: 100% }}
 td, th {{ border-bottom: 1px solid #333; padding: 6px 10px; text-align: left }}
 .big {{ font-size: 42px; font-weight: 700 }}
 .card {{ background:#1e242d; border-radius:8px; padding:1em 1.4em; margin:1em 0 }}
 .looks {{ display:flex; gap:12px; flex-wrap:wrap }}
 .look {{ flex:1 1 260px; background:#1e242d; border-radius:8px; padding:10px }}
 .look h3 {{ margin:8px 0 4px; font-size:15px }}
 pre.capsule {{ background:#12161c; border:1px solid #2a323d; border-radius:8px;
        padding:1em 1.2em; white-space:pre-wrap; font-size:13px;
        color:#c8d3df; user-select:all }}
 .look p {{ margin:0; color:#9aa7b5; font-size:13px }}
</style></head><body>
<h1>{"Your night, a quick look" if draft else "Your night, processed"}</h1>
{draft_banner}
<div class="card"><span class="big">{len(meteors)}</span> meteor(s)
 &nbsp;&middot;&nbsp; {len(flagged)} plane/satellite trail(s) flagged
 &nbsp;&middot;&nbsp; alignment {html.escape(str(g.get('alignment_quality', '?')))}</div>
{'<h2>Preview</h2><p>Auto-processed for viewing only — your layered file stays untouched and fully adjustable.</p><a href="preview.jpg"><img src="preview.jpg"></a>' if have_preview else ''}
{looks_html}
{'<h2>Candidate lineup</h2><a href="contact_sheet.png"><img src="contact_sheet.png"></a>' if have_contact else ''}
<h2>Every candidate</h2>
<p>Each crop is auto-brightened for inspection — click to enlarge.</p>
<table><tr><th></th><th>id</th><th>verdict</th><th>frame(s)</th>
<th>confidence</th><th>radiant miss</th>{phys_head}</tr>{''.join(rows)}</table>
{physics_note}
{capsule_html}
{timing_html}
{info_html}
<h2>What the files are</h2>
<ul>
<li>{open_line}</li>
{'' if draft else "<li><b>preview.jpg</b> — this page's picture: stretched, gradient-flattened, meteors brightened; share it as-is or use it as a reference</li>"}
{'' if draft else '<li><b>layers/</b> — every layer as PNG (base sky, foreground, each meteor)</li>'}
<li><b>meteorprep.json</b> — all measurements (positions, times, sky
coordinates) for every candidate</li>
<li><b>skymask.png</b> — what the tool considered ground (black); should
look like your treeline's silhouette</li>
<li><b>capsule.txt</b> — the caption that proves itself: integration
time, what was calibrated, and that no pixel was generated</li>
<li><b>evidence/</b> — the stack's own measurements: coverage.png (how
many photos built each pixel), noise.png (per-pixel sky noise),
rejected.png (where outliers were thrown away), removed.png (the light
that was thrown away — meteors, planes, satellites, cosmic rays) and
ledger.png (every pixel colour-coded by where it came from, with
ledger_legend.json) — the honest-image receipts</li>
<li><b>run_log.txt</b> — the full diary; send it when something looks wrong</li>
{'<li><i>Not in a quick look:</i> the layered Photoshop file, the per-layer PNGs, the star-trail photo and the contact sheet. Run the folder again on Full quality and they are built from the search this run already did.</li>' if draft else ''}
</ul>
</body></html>"""
    p = out_dir / "report.html"
    p.write_text(body, encoding="utf-8")
    return p
