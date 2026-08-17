"""PNG-per-layer + generated ExtendScript fallback (§7.3).

Zero-PSD-library risk: the user runs ``assemble.jsx`` from Photoshop's
File > Scripts > Browse… (no terminal) to rebuild the identical layer
stack.  PNGs carry straight (non-premultiplied) alpha.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

from meteorprep.assemble.layers import Layer, LayerStack


def _write_png(layer: Layer, path: Path, width: int, height: int) -> tuple:
    """Write the layer PNG; bbox layers stay bbox-sized (the JSX moves them
    into place), so many meteor layers never balloon memory or disk.
    Returns the (x, y) placement offset."""
    rgb = layer.rgb
    alpha = layer.alpha
    x_off = y_off = 0
    if layer.bbox is not None:
        x0, y0, x1, y1 = layer.bbox
        x_off, y_off = int(x0), int(y0)
    if alpha is None:
        alpha = np.ones(rgb.shape[:2], np.float32)
    # 8-bit PNG for JSX interchange (16-bit fidelity lives in the PSD path);
    # linear -> sRGB-ish gamma for a sane Photoshop starting point
    rgb8 = np.clip((np.clip(rgb, 0, 65535) / 65535.0) ** (1 / 2.2) * 255, 0, 255).astype(np.uint8)
    a8 = np.clip(alpha * 255, 0, 255).astype(np.uint8)
    Image.fromarray(np.dstack([rgb8, a8]), "RGBA").save(path)
    return x_off, y_off


def write_pngjsx(stack: LayerStack, out_dir: Path) -> Path:
    """Emit layer PNGs + assemble.jsx; returns the .jsx path."""
    out_dir = Path(out_dir)
    layers_dir = out_dir / "layers"
    layers_dir.mkdir(parents=True, exist_ok=True)

    manifest = []  # (filename, group, blend, visible, name)

    def emit(layer: Layer, group: str | None):
        safe = "".join(c if c.isalnum() or c in "._+-" else "_" for c in layer.name)
        fname = f"{safe}.png"
        x_off, y_off = _write_png(layer, layers_dir / fname,
                                  stack.width, stack.height)
        manifest.append({"file": fname, "group": group, "blend": layer.blend,
                         "visible": layer.visible, "name": layer.name,
                         "x": x_off, "y": y_off})

    emit(stack.base, None)
    for grp in stack.groups:
        for l in grp.layers:
            emit(l, grp.name)

    group_vis = {g.name: g.visible for g in stack.groups}
    jsx = _generate_jsx(stack, manifest, group_vis)
    jsx_path = out_dir / "assemble.jsx"
    jsx_path.write_text(jsx)
    (out_dir / "layers_manifest.json").write_text(json.dumps(manifest, indent=2))
    return jsx_path


def _generate_jsx(stack: LayerStack, manifest, group_vis) -> str:
    lines = [
        "// METEORPREP layer assembly — run via File > Scripts > Browse…",
        "// Rebuilds the layered document from the PNGs in ./layers/",
        "#target photoshop",
        "app.preferences.rulerUnits = Units.PIXELS;",
        f"var doc = app.documents.add({stack.width}, {stack.height}, 72, "
        "'METEORPREP', NewDocumentMode.RGB, DocumentFill.TRANSPARENT, 1, "
        "BitsPerChannelType.SIXTEEN);",
        "var scriptFile = new File($.fileName);",
        "var baseDir = scriptFile.parent;",
        "function placeLayer(relPath, name, blend, visible, targetSet, x, y) {",
        "  var f = new File(baseDir + '/layers/' + relPath);",
        "  var placed = app.open(f);",
        "  var pw = placed.width.as('px'), ph = placed.height.as('px');",
        "  placed.selection.selectAll();",
        "  placed.selection.copy();",
        "  placed.close(SaveOptions.DONOTSAVECHANGES);",
        "  app.activeDocument = doc;",
        "  var layer = doc.paste();  // pasted centered",
        "  var b = layer.bounds;",
        "  layer.translate(x - b[0].as('px'), y - b[1].as('px'));",
        "  layer.name = name;",
        "  layer.blendMode = blend;",
        "  layer.visible = visible;",
        "  if (targetSet) layer.move(targetSet, ElementPlacement.INSIDE);",
        "  return layer;",
        "}",
        "var groups = {};",
    ]
    for gname, vis in group_vis.items():
        lines.append(f"groups[{json.dumps(gname)}] = doc.layerSets.add();")
        lines.append(f"groups[{json.dumps(gname)}].name = {json.dumps(gname)};")
        lines.append(f"groups[{json.dumps(gname)}].visible = {str(vis).lower()};")
    for m in manifest:
        blend = "BlendMode.LIGHTEN" if m["blend"] == "lighten" else "BlendMode.NORMAL"
        target = f"groups[{json.dumps(m['group'])}]" if m["group"] else "null"
        lines.append(
            f"placeLayer({json.dumps(m['file'])}, {json.dumps(m['name'])}, "
            f"{blend}, {str(m['visible']).lower()}, {target}, "
            f"{m.get('x', 0)}, {m.get('y', 0)});")
    lines += [
        "// re-assert group visibility after placement",
    ]
    for gname, vis in group_vis.items():
        lines.append(f"groups[{json.dumps(gname)}].visible = {str(vis).lower()};")
    lines.append("alert('METEORPREP stack assembled: ' + doc.layers.length + ' top-level layers');")
    return "\n".join(lines) + "\n"
