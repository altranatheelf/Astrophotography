"""One-double-click run report: preview, meteor lineup, and a plain
explanation of every file in the folder."""

from __future__ import annotations

import html
from pathlib import Path


def write_report_html(out_dir: Path, group_result: dict,
                      have_preview: bool, have_contact: bool,
                      have_psd: bool) -> Path:
    g = group_result
    cands = g.get("candidates", [])
    meteors = [c for c in cands if c.get("label") == "meteor"]
    flagged = [c for c in cands if c.get("label") != "meteor"]

    rows = []
    for c in cands:
        rows.append(
            "<tr><td>{id}</td><td>{label}</td><td>{frames}</td>"
            "<td>{conf:.0%}</td><td>{miss}</td></tr>".format(
                id=html.escape(str(c.get("id", "?"))),
                label=html.escape(str(c.get("label", "?"))),
                frames=html.escape(", ".join(c.get("frames", []))),
                conf=float(c.get("confidence", 0) or 0),
                miss=(f"{c['radiant_miss_deg']:.0f}&deg;"
                      if c.get("radiant_miss_deg") is not None else "-")))

    open_line = (
        "<b>meteorprep.psd</b> — the layered Photoshop file (drag it in)"
        if have_psd else
        "<b>assemble.jsx</b> — in Photoshop: File &gt; Scripts &gt; "
        "Browse&hellip; and pick this file; it builds the layered document")

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
</style></head><body>
<h1>Your night, processed</h1>
<div class="card"><span class="big">{len(meteors)}</span> meteor(s)
 &nbsp;&middot;&nbsp; {len(flagged)} plane/satellite trail(s) flagged
 &nbsp;&middot;&nbsp; alignment {html.escape(str(g.get('alignment_quality', '?')))}</div>
{'<h2>Preview</h2><p>Auto-processed for viewing only — your layered file stays untouched and fully adjustable.</p><a href="preview.jpg"><img src="preview.jpg"></a>' if have_preview else ''}
{'<h2>Candidate lineup</h2><a href="contact_sheet.png"><img src="contact_sheet.png"></a>' if have_contact else ''}
<h2>Every candidate</h2>
<table><tr><th>id</th><th>verdict</th><th>frame(s)</th><th>confidence</th>
<th>radiant miss</th></tr>{''.join(rows)}</table>
<h2>What the files are</h2>
<ul>
<li>{open_line}</li>
<li><b>preview.jpg</b> — this page's picture: stretched, gradient-flattened,
meteors brightened; share it as-is or use it as a reference</li>
<li><b>layers/</b> — every layer as PNG (base sky, foreground, each meteor)</li>
<li><b>meteorprep.json</b> — all measurements (positions, times, sky
coordinates) for every candidate</li>
<li><b>skymask.png</b> — what the tool considered ground (black); should
look like your treeline's silhouette</li>
<li><b>run_log.txt</b> — the full diary; send it when something looks wrong</li>
</ul>
</body></html>"""
    p = out_dir / "report.html"
    p.write_text(body, encoding="utf-8")
    return p
