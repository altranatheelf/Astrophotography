#!/usr/bin/env node
// Render every sprite in js/sprites/ onto one contact sheet PNG (8 per row).
//   node tools/sprite-sheet.js out.png [scale=4]
'use strict';
const fs = require('fs');
const path = require('path');
const { loadSprite, validate, renderSprite, encodePng, hexToRgb } = require('./sprite-png.js');

const [out, scaleArg] = process.argv.slice(2);
if (!out) { console.error('usage: node tools/sprite-sheet.js out.png [scale]'); process.exit(2); }
const scale = parseInt(scaleArg || '4', 10);
const dir = path.join(__dirname, '..', 'js', 'sprites');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
const cols = 8, cell = 32 * scale + 8;
const rows = Math.ceil(files.length / cols);
const W = cols * cell, H = Math.max(1, rows) * cell;
const rgba = Buffer.alloc(W * H * 4);
const bg = hexToRgb('#8fd18f');
for (let i = 0; i < W * H; i++) { rgba[i * 4] = bg[0]; rgba[i * 4 + 1] = bg[1]; rgba[i * 4 + 2] = bg[2]; rgba[i * 4 + 3] = 255; }
let bad = 0;
files.forEach((f, i) => {
  let id, sprite;
  try { ({ id, sprite } = loadSprite(path.join(dir, f))); } catch (e) { console.error(`${f}: ${e.message}`); bad++; return; }
  const errors = validate(id, sprite);
  if (errors.length) { bad++; console.error(`${id}: ` + errors.join('; ')); }
  const img = renderSprite(sprite, scale, null, false);
  const ox = (i % cols) * cell + 4, oy = Math.floor(i / cols) * cell + 4;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const s = (y * img.width + x) * 4; if (img.rgba[s + 3] === 0) continue;
    const d = ((oy + y) * W + (ox + x)) * 4;
    rgba[d] = img.rgba[s]; rgba[d + 1] = img.rgba[s + 1]; rgba[d + 2] = img.rgba[s + 2]; rgba[d + 3] = 255;
  }
  console.log(`${String(i + 1).padStart(2)} ${id}${errors.length ? '  (INVALID)' : ''}`);
});
fs.writeFileSync(out, encodePng(W, H, rgba));
console.log(`wrote ${out} (${W}x${H}), ${files.length} sprites, ${bad} invalid`);
