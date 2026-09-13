#!/usr/bin/env node
// Render the art registered by one art file to a PNG contact sheet, so you can
// LOOK at it. Works for tile groups, character sheets and icons.
//   node tools/art-png.js js/art/tiles-nature.js out.png [scale=6]
//   node tools/art-png.js js/art/chars-heroes.js out.png 6
//   node tools/art-png.js js/art/icons.js out.png 8
//   node tools/art-png.js js/art/tiles-nature.js out.png 6 --repeat grass   (a 3×3 repetition of one tile, to check seams)
// Prints the sheet layout (row/col → id) to stdout and validation errors to stderr (exit 1).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { encodePng, hexToRgb } = require('./sprite-png.js');

const [file, out, scaleArg, ...rest] = process.argv.slice(2);
if (!file || !out) { console.error('usage: node tools/art-png.js <art-file.js> out.png [scale] [--repeat <tileId>]'); process.exit(2); }
const scale = parseInt(scaleArg || '6', 10);
const repeatIdx = rest.indexOf('--repeat');
const repeatId = repeatIdx >= 0 ? rest[repeatIdx + 1] : null;

const root = path.join(__dirname, '..');
const sandbox = { console }; sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.PKMN = {};
function load(rel) { const p = path.join(root, rel); if (fs.existsSync(p)) vm.runInNewContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: p }); }
load('js/art/tiles.js'); load('js/art/chars.js');
const P = sandbox.PKMN;
const beforeTiles = new Set((P.TILES.list || []).map(t => t.id));
const beforeChars = new Set((P.CHARS.list || []).map(c => c.id));
vm.runInNewContext(fs.readFileSync(path.resolve(file), 'utf8'), sandbox, { filename: file });

const errors = [];
function validateArt(label, art, w, h) {
  if (!art) { errors.push(`${label}: missing art`); return; }
  const rowsList = art.frames ? art.frames : [art.rows];
  if (!art.palette) errors.push(`${label}: no palette`);
  const used = new Set();
  rowsList.forEach((rows, fi) => {
    if (!Array.isArray(rows)) { errors.push(`${label} frame ${fi}: rows is not an array`); return; }
    if (rows.length !== h) errors.push(`${label} frame ${fi}: ${rows.length} rows, expected ${h}`);
    rows.forEach((r, i) => {
      if (typeof r !== 'string') { errors.push(`${label} frame ${fi} row ${i}: not a string`); return; }
      if (r.length !== w) errors.push(`${label} frame ${fi} row ${i}: ${r.length} chars, expected ${w}`);
      for (const ch of r) { if (ch !== '.') { used.add(ch); if (!art.palette || !art.palette[ch]) errors.push(`${label} frame ${fi} row ${i}: char '${ch}' not in palette`); } }
    });
  });
  for (const k of Object.keys(art.palette || {})) if (!used.has(k)) errors.push(`${label}: palette entry '${k}' unused`);
}

// Collect cells: { id, label, art(rows/palette), w, h, mirror }
const cells = [];
const newTiles = (P.TILES.list || []).filter(t => !beforeTiles.has(t.id));
const newChars = (P.CHARS.list || []).filter(c => !beforeChars.has(c.id));
const icons = P.ICONS && P.ICONS.byId ? P.ICONS.byId : null;

if (repeatId) {
  const t = P.TILES.byId[repeatId]; if (!t) { console.error(`no tile ${repeatId}`); process.exit(2); }
  const art = t.frames ? { palette: t.palette || t.art && t.art.palette, rows: t.frames[0] } : (t.art || t);
  for (let i = 0; i < 9; i++) cells.push({ id: repeatId, label: `${repeatId}`, rows: art.rows, palette: art.palette, w: 16, h: 16 });
} else if (newTiles.length) {
  for (const t of newTiles) {
    const art = t.art || t;
    const pal = art.palette;
    validateArt(t.id, art.frames ? { palette: pal, frames: art.frames } : { palette: pal, rows: art.rows }, t.w, t.h);
    const frames = art.frames || [art.rows];
    frames.forEach((rows, fi) => cells.push({ id: t.id, label: frames.length > 1 ? `${t.id}#${fi}` : t.id, rows, palette: pal, w: t.w, h: t.h }));
  }
} else if (newChars.length) {
  for (const c of newChars) {
    for (const dir of ['down', 'up', 'left']) {
      const frames = (c.frames || {})[dir];
      if (!frames) { errors.push(`${c.id}: missing frames.${dir}`); continue; }
      if (frames.length !== 3) errors.push(`${c.id}.${dir}: expected 3 frames [stand, stepA, stepB], got ${frames.length}`);
      frames.forEach((rows, fi) => { validateArt(`${c.id}.${dir}[${fi}]`, { palette: c.palette, rows }, c.w, c.h); cells.push({ id: c.id, label: `${c.id} ${dir}${fi}`, rows, palette: c.palette, w: c.w, h: c.h }); });
    }
    const left = (c.frames || {}).left; if (left) cells.push({ id: c.id, label: `${c.id} right0 (mirrored)`, rows: left[0], palette: c.palette, w: c.w, h: c.h, mirror: true });
  }
} else if (icons) {
  for (const [id, art] of Object.entries(icons)) { validateArt(id, art, art.w, art.h); cells.push({ id, label: id, rows: art.rows, palette: art.palette, w: art.w, h: art.h }); }
} else {
  console.error('nothing registered by that file (expected PKMN.TILES.register, PKMN.CHARS.register or PKMN.ICONS.byId)'); process.exit(2);
}

const cols = repeatId ? 3 : Math.min(cells.length, newChars.length ? 10 : 8);
const cellW = Math.max(...cells.map(c => c.w)), cellH = Math.max(...cells.map(c => c.h));
const pad = repeatId ? 0 : 2;
const rowsN = Math.ceil(cells.length / cols);
const W = cols * (cellW + pad) * scale, H = rowsN * (cellH + pad) * scale;
const rgba = Buffer.alloc(W * H * 4);
const bg = hexToRgb('#e8e0d0');
for (let i = 0; i < W * H; i++) { rgba[i * 4] = bg[0]; rgba[i * 4 + 1] = bg[1]; rgba[i * 4 + 2] = bg[2]; rgba[i * 4 + 3] = 255; }
cells.forEach((c, i) => {
  const ox = (i % cols) * (cellW + pad) * scale, oy = Math.floor(i / cols) * (cellH + pad) * scale;
  for (let y = 0; y < c.h; y++) {
    const row = (c.rows && c.rows[y]) || '';
    for (let x = 0; x < c.w; x++) {
      const ch = row[c.mirror ? c.w - 1 - x : x];
      if (!ch || ch === '.' || !c.palette || !c.palette[ch]) continue;
      const px = hexToRgb(c.palette[ch]);
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const o = ((oy + y * scale + dy) * W + (ox + x * scale + dx)) * 4;
        rgba[o] = px[0]; rgba[o + 1] = px[1]; rgba[o + 2] = px[2]; rgba[o + 3] = 255;
      }
    }
  }
  if (!repeatId) console.log(`row ${Math.floor(i / cols) + 1} col ${(i % cols) + 1}: ${c.label}`);
});
fs.writeFileSync(out, encodePng(W, H, rgba));
console.log(`wrote ${out} (${W}x${H}), ${cells.length} cells`);
if (errors.length) { console.error('ERRORS:\n  - ' + errors.join('\n  - ')); process.exit(1); }
