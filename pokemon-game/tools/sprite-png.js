#!/usr/bin/env node
// Render one sprite file (js/sprites/<id>.js) to a PNG, scaled up, with a
// checkerboard-free neutral background so you can judge it.
//   node tools/sprite-png.js js/sprites/charizard.js out.png [scale=8] [bg=#78c850]
// Pure Node (zlib), no dependencies.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function loadSprite(file) {
  // The kit core loads first so a sprite file may also register kit things.
  const { createSandbox, loadInto } = require('./kit-sandbox.js');
  const sandbox = createSandbox();
  loadInto(sandbox, path.resolve(file));
  const sprites = sandbox.PKMN.SPRITES || (sandbox.window.PKMN && sandbox.window.PKMN.SPRITES) || {};
  const ids = Object.keys(sprites);
  if (!ids.length) throw new Error(`${file}: no PKMN.SPRITES.<id> defined`);
  return { id: ids[0], sprite: sprites[ids[0]] };
}

function validate(id, s) {
  const errors = [];
  const size = s.size || 32;
  if (!Array.isArray(s.rows)) { errors.push('rows is not an array'); return errors; }
  if (s.rows.length !== size) errors.push(`expected ${size} rows, got ${s.rows.length}`);
  s.rows.forEach((r, i) => {
    if (typeof r !== 'string') { errors.push(`row ${i} is not a string`); return; }
    if (r.length !== size) errors.push(`row ${i} has ${r.length} chars, expected ${size}`);
    for (const ch of r) if (ch !== '.' && !(s.palette && s.palette[ch])) errors.push(`row ${i}: char '${ch}' not in palette`);
  });
  const used = new Set(s.rows.join('').replace(/\./g, ''));
  for (const k of Object.keys(s.palette || {})) if (!used.has(k)) errors.push(`palette entry '${k}' is unused`);
  let filled = 0; for (const r of s.rows) for (const ch of r) if (ch !== '.') filled++;
  if (filled < size * size * 0.18) errors.push(`sprite is small: only ${filled} of ${size*size} pixels filled (aim for 30%+)`);
  return errors;
}

function hexToRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function renderSprite(s, scale, bg, mirror) {
  const size = s.size || 32;
  const W = size * scale, H = size * scale;
  const rgba = Buffer.alloc(W * H * 4);
  const bgc = bg ? hexToRgb(bg) : null;
  for (let y = 0; y < size; y++) {
    const row = s.rows[y] || '';
    for (let x = 0; x < size; x++) {
      const sx = mirror ? size - 1 - x : x;
      const ch = row[sx] || '.';
      let px;
      if (ch === '.' || !s.palette[ch]) px = bgc ? [...bgc, 255] : [0, 0, 0, 0];
      else px = [...hexToRgb(s.palette[ch]), 255];
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const o = ((y * scale + dy) * W + (x * scale + dx)) * 4;
        rgba[o] = px[0]; rgba[o + 1] = px[1]; rgba[o + 2] = px[2]; rgba[o + 3] = px[3];
      }
    }
  }
  return { width: W, height: H, rgba };
}

module.exports = { loadSprite, validate, renderSprite, encodePng, hexToRgb };

if (require.main === module) {
  const [file, out, scaleArg, bgArg] = process.argv.slice(2);
  if (!file || !out) { console.error('usage: node tools/sprite-png.js js/sprites/<id>.js out.png [scale] [bg]'); process.exit(2); }
  const { id, sprite } = loadSprite(path.resolve(file));
  const errors = validate(id, sprite);
  if (errors.length) { console.error(`INVALID sprite '${id}':\n  - ` + errors.join('\n  - ')); }
  const img = renderSprite(sprite, parseInt(scaleArg || '8', 10), bgArg === undefined ? '#8fd18f' : (bgArg === 'none' ? null : bgArg), false);
  fs.writeFileSync(out, encodePng(img.width, img.height, img.rgba));
  console.log(`${errors.length ? 'wrote (with errors)' : 'ok'} ${id} -> ${out} (${img.width}x${img.height})`);
  process.exit(errors.length ? 1 : 0);
}
