#!/usr/bin/env node
// Generates the Aseprite fixtures used by test/kit/import-aseprite.test.js.
//   node test/fixtures/aseprite/make.js
//
// Everything here follows the tool's own conventions, taken from the source that
// writes these files rather than from memory:
//   sheet JSON  https://raw.githubusercontent.com/aseprite/aseprite/main/src/app/doc_exporter.cpp
//               (DocExporter::createDataFile — field names and order, `rotated` always false,
//                `repeat` written as a STRING, meta.scale written as a STRING, meta.app/version)
//   hash keys   https://raw.githubusercontent.com/aseprite/aseprite/main/src/app/filename_formatter.cpp
//               (get_default_filename_format_for_sheet -> '{title} {frame}.{extension}')
//   tag dirs    https://raw.githubusercontent.com/aseprite/aseprite/main/src/doc/anidir.cpp
//   blend names https://raw.githubusercontent.com/aseprite/aseprite/main/src/doc/blend_mode.cpp
//   binary      https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
//               (128-byte header, 16-byte frame headers, chunks 0x2004 layer, 0x2005 cel,
//                0x2007 color profile, 0x2018 tags, 0x2019 palette, 0x2022 slice)
//
// Aseprite itself never writes "rotated": true (createDataFile hard-codes false), so the
// rotated frame lives in its own hand-edited file — the importer has to cope with sheets
// packed by other tools, and with people editing these by hand.
//
// Everything stays tiny on purpose: a 96x16 sheet of six 16px frames and an 8x8 two-frame
// .aseprite file, all committed next to this script.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { encodePng } = require('../../../tools/sprite-png.js');

const OUT = __dirname;
const write = (name, buf) => { fs.writeFileSync(path.join(OUT, name), buf); console.log('wrote', name, buf.length + 'b'); };
const writeJson = (name, value) => write(name, Buffer.from(JSON.stringify(value, null, 1) + '\n'));

const APP = 'https://www.aseprite.org/';
const VERSION = '1.3.7';
const CELL = 16, FRAMES = 6;

// ---- the sheet image -------------------------------------------------------
// One 16px cell per frame: two walk-down frames, one left, one up, two blink frames.
const CELL_COLORS = [
  [216, 80, 80], [184, 64, 64],          // down 0, down 1
  [96, 152, 216],                         // left
  [120, 200, 120],                        // up   (this one is exported trimmed)
  [232, 216, 96], [200, 184, 72],         // blink 0, blink 1
];
function makeSheetPng() {
  const width = CELL * FRAMES, height = CELL;
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < FRAMES; i++) {
    const c = CELL_COLORS[i];
    // The `up` cell is drawn inset by (2,1) with a 12x14 body, which is exactly what
    // --trim would have cropped to, so the trimmed rectangle below is honest.
    const inset = i === 3 ? { x: 2, y: 1, w: 12, h: 14 } : { x: 0, y: 0, w: CELL, h: CELL };
    for (let y = inset.y; y < inset.y + inset.h; y++) {
      for (let x = inset.x; x < inset.x + inset.w; x++) {
        const o = (y * width + (i * CELL + x)) * 4;
        rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
      }
    }
  }
  write('sheet.png', encodePng(width, height, rgba));
  return { w: width, h: height };
}

// ---- the sheet data (--data) -----------------------------------------------
// Frame 3 is trimmed: its rectangle in the sheet is the 12x14 body, and spriteSourceSize
// says where that body sits inside the untrimmed 16x16 frame.
function frameEntry(i) {
  const trimmed = i === 3;
  const sss = trimmed ? { x: 2, y: 1, w: 12, h: 14 } : { x: 0, y: 0, w: CELL, h: CELL };
  return {
    frame: { x: i * CELL + sss.x, y: sss.y, w: sss.w, h: sss.h },
    rotated: false,
    trimmed,
    spriteSourceSize: sss,
    sourceSize: { w: CELL, h: CELL },
    duration: i === 1 ? 150 : 100,
  };
}
function meta(size) {
  return {
    app: APP,
    version: VERSION,
    image: 'sheet.png',
    format: 'RGBA8888',
    size: { w: size.w, h: size.h },
    scale: '1',
    frameTags: [
      // three spellings on purpose: hyphen, underscore, and the bare direction
      { name: 'walk-down', from: 0, to: 1, direction: 'forward' },
      { name: 'walk_left', from: 2, to: 2, direction: 'forward' },
      { name: 'up', from: 3, to: 3, direction: 'forward' },
      { name: 'blink', from: 4, to: 5, direction: 'pingpong', repeat: '2' },
    ],
    layers: [
      { name: 'body', opacity: 255, blendMode: 'normal' },
      { name: 'shade', opacity: 128, blendMode: 'multiply' },
    ],
  };
}
function makeSheetJson(size) {
  const m = meta(size);
  // json-hash: the default filename format is '{title} {frame}.{extension}'.
  const hash = {};
  for (let i = 0; i < FRAMES; i++) hash[`hero ${i}.aseprite`] = frameEntry(i);
  writeJson('sheet-hash.json', { frames: hash, meta: m });

  // json-array: the same samples in order, each carrying its filename.
  const array = [];
  for (let i = 0; i < FRAMES; i++) array.push(Object.assign({ filename: `hero ${i}.aseprite` }, frameEntry(i)));
  writeJson('sheet-array.json', { frames: array, meta: m });

  // Hand-edited: one frame marked rotated, the way a TexturePacker-style packer would.
  const rotated = {};
  for (let i = 0; i < FRAMES; i++) {
    const e = frameEntry(i);
    if (i === 2) { e.rotated = true; e.frame = { x: e.frame.x, y: e.frame.y, w: e.frame.h, h: e.frame.w }; }
    rotated[`hero ${i}.aseprite`] = e;
  }
  writeJson('sheet-rotated.json', { frames: rotated, meta: m });
}

// ---- a sheet with slices (--list-slices) -----------------------------------
function makeSlicesJson(size) {
  const frames = {};
  for (let i = 0; i < 2; i++) frames[`atlas ${i}.aseprite`] = frameEntry(i);
  writeJson('slices.json', {
    frames,
    meta: {
      app: APP, version: VERSION, image: 'sheet.png', format: 'RGBA8888',
      size: { w: size.w, h: size.h }, scale: '1',
      frameTags: [],
      slices: [
        { name: 'hero face', color: '#0000ffff', keys: [{ frame: 0, bounds: { x: 0, y: 0, w: 16, h: 16 } }] },
        { name: 'berry icon', data: 'a berry', keys: [{ frame: 0, bounds: { x: 16, y: 0, w: 8, h: 8 }, pivot: { x: 4, y: 4 } }] },
        { name: 'panel', keys: [{ frame: 0, bounds: { x: 32, y: 0, w: 16, h: 16 }, center: { x: 4, y: 4, w: 8, h: 8 } }] },
        { name: 'spark', keys: [{ frame: 0, bounds: { x: 48, y: 0, w: 8, h: 8 } }, { frame: 1, bounds: { x: 56, y: 0, w: 8, h: 8 } }] },
      ],
    },
  });
}

// ---- the binary .aseprite file ---------------------------------------------
// A little writer for the spec's primitive types (everything is little-endian).
function Writer() {
  this.parts = [];
  this.size = 0;
}
Writer.prototype.push = function (buf) { this.parts.push(buf); this.size += buf.length; return this; };
Writer.prototype.u8 = function (v) { const b = Buffer.alloc(1); b.writeUInt8(v & 255); return this.push(b); };
Writer.prototype.u16 = function (v) { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff); return this.push(b); };
Writer.prototype.i16 = function (v) { const b = Buffer.alloc(2); b.writeInt16LE(v); return this.push(b); };
Writer.prototype.u32 = function (v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return this.push(b); };
Writer.prototype.i32 = function (v) { const b = Buffer.alloc(4); b.writeInt32LE(v); return this.push(b); };
Writer.prototype.zero = function (n) { return this.push(Buffer.alloc(n)); };
Writer.prototype.str = function (s) { const b = Buffer.from(String(s), 'utf8'); this.u16(b.length); return this.push(b); };
Writer.prototype.buf = function () { return Buffer.concat(this.parts, this.size); };

/** DWORD size (including these 6 bytes) + WORD type + data. */
function chunk(type, body) {
  const head = Buffer.alloc(6);
  head.writeUInt32LE(body.length + 6, 0);
  head.writeUInt16LE(type, 4);
  return Buffer.concat([head, body]);
}
function layerChunk({ name, visible = true, type = 0, level = 0, blend = 0, opacity = 255 }) {
  const w = new Writer();
  w.u16((visible ? 1 : 0) | 2);          // visible | editable
  w.u16(type);
  w.u16(level);
  w.u16(0); w.u16(0);                    // default width/height (ignored)
  w.u16(blend);
  w.u8(opacity);
  w.zero(3);
  w.str(name);
  return chunk(0x2004, w.buf());
}
function celChunk({ layer, x, y, opacity = 255, celType, w: cw, h: ch, pixels, link, z = 0 }) {
  const w = new Writer();
  w.u16(layer); w.i16(x); w.i16(y); w.u8(opacity); w.u16(celType); w.i16(z); w.zero(5);
  if (celType === 0) { w.u16(cw); w.u16(ch); w.push(pixels); }
  else if (celType === 1) { w.u16(link); }
  else if (celType === 2) { w.u16(cw); w.u16(ch); w.push(zlib.deflateSync(pixels)); }
  return chunk(0x2005, w.buf());
}
function tagsChunk(tags) {
  const w = new Writer();
  w.u16(tags.length); w.zero(8);
  for (const t of tags) {
    w.u16(t.from); w.u16(t.to);
    w.u8(t.aniDir || 0);
    w.u16(t.repeat || 0);
    w.zero(6);
    w.u8(t.rgb ? t.rgb[0] : 0); w.u8(t.rgb ? t.rgb[1] : 0); w.u8(t.rgb ? t.rgb[2] : 0);
    w.u8(0);
    w.str(t.name);
  }
  return chunk(0x2018, w.buf());
}
function paletteChunk(colors) {
  const w = new Writer();
  w.u32(colors.length); w.u32(0); w.u32(colors.length - 1); w.zero(8);
  for (const c of colors) { w.u16(0); w.u8(c[0]); w.u8(c[1]); w.u8(c[2]); w.u8(c.length > 3 ? c[3] : 255); }
  return chunk(0x2019, w.buf());
}
function colorProfileChunk() {
  const w = new Writer();
  w.u16(1); w.u16(0); w.u32(0); w.zero(8);   // sRGB, no fixed gamma
  return chunk(0x2007, w.buf());
}
function sliceChunk({ name, keys, ninePatch = false, pivot = false }) {
  const w = new Writer();
  w.u32(keys.length);
  w.u32((ninePatch ? 1 : 0) | (pivot ? 2 : 0));
  w.u32(0);
  w.str(name);
  for (const k of keys) {
    w.u32(k.frame); w.i32(k.bounds.x); w.i32(k.bounds.y); w.u32(k.bounds.w); w.u32(k.bounds.h);
    if (ninePatch) { w.i32(k.center.x); w.i32(k.center.y); w.u32(k.center.w); w.u32(k.center.h); }
    if (pivot) { w.i32(k.pivot.x); w.i32(k.pivot.y); }
  }
  return chunk(0x2022, w.buf());
}
function frame(durationMs, chunks) {
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(16);
  head.writeUInt32LE(body.length + 16, 0);
  head.writeUInt16LE(0xF1FA, 4);
  head.writeUInt16LE(chunks.length > 0xFFFF ? 0xFFFF : chunks.length, 6);   // old chunk count
  head.writeUInt16LE(durationMs, 8);
  head.writeUInt16LE(0, 10);                                                // BYTE[2] reserved
  head.writeUInt32LE(chunks.length, 12);                                    // new chunk count
  return Buffer.concat([head, body]);
}
function header({ frames, width, height, depth, flags, speed, colors }) {
  const w = new Writer();
  w.u32(0);                 // file size, patched below
  w.u16(0xA5E0);
  w.u16(frames); w.u16(width); w.u16(height); w.u16(depth);
  w.u32(flags); w.u16(speed);
  w.u32(0); w.u32(0);
  w.u8(0);                  // transparent palette index
  w.zero(3);
  w.u16(colors);
  w.u8(1); w.u8(1);         // pixel ratio 1:1
  w.i16(0); w.i16(0); w.u16(16); w.u16(16);   // grid
  w.zero(84);
  const buf = w.buf();
  if (buf.length !== 128) throw new Error(`header is ${buf.length} bytes, must be 128`);
  return buf;
}

/** An 8x8 RGBA cel body: fn(x, y) -> [r,g,b,a]. */
function rgbaCel(w, h, fn) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y) || [0, 0, 0, 0];
      const o = (y * w + x) * 4;
      buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = c[3];
    }
  }
  return buf;
}

const RED = [216, 80, 80, 255];
const BLUE = [32, 64, 192, 255];
const GREEN = [64, 192, 64, 255];
const MAGENTA = [255, 0, 255, 255];

function makeAseprite() {
  // Layer 0 'body'   : a 6x6 red block at (1,1), stored as a RAW cel in frame 0 and LINKED in frame 1.
  // Layer 1 'shade'  : opacity 128, ZLIB cels — a 4x4 blue patch at (5,5) in frame 0 (which spills
  //                    past the red block, so the importer meets both "over art" and "over nothing"),
  //                    and a 2x2 green patch at (0,0) in frame 1.
  // Layer 2 'hidden' : invisible, a full magenta ZLIB cel in both frames. If visibility is ignored
  //                    the whole sprite turns magenta, which is exactly what the test looks for.
  const body = rgbaCel(6, 6, () => RED);
  const shade0 = rgbaCel(4, 4, () => BLUE);
  const shade1 = rgbaCel(2, 2, () => GREEN);
  const hidden = rgbaCel(8, 8, () => MAGENTA);

  const f0 = frame(100, [
    colorProfileChunk(),
    layerChunk({ name: 'body' }),
    layerChunk({ name: 'shade', opacity: 128 }),
    layerChunk({ name: 'hidden', visible: false }),
    paletteChunk([RED, BLUE, GREEN, MAGENTA]),
    tagsChunk([{ name: 'walk-down', from: 0, to: 1, aniDir: 0, repeat: 0, rgb: [0, 0, 0] }]),
    sliceChunk({ name: 'head', keys: [{ frame: 0, bounds: { x: 1, y: 1, w: 6, h: 3 } }] }),
    celChunk({ layer: 0, x: 1, y: 1, celType: 0, w: 6, h: 6, pixels: body }),
    celChunk({ layer: 1, x: 5, y: 5, celType: 2, w: 4, h: 4, pixels: shade0 }),
    celChunk({ layer: 2, x: 0, y: 0, celType: 2, w: 8, h: 8, pixels: hidden }),
  ]);
  const f1 = frame(150, [
    celChunk({ layer: 0, x: 1, y: 1, celType: 1, link: 0 }),
    celChunk({ layer: 1, x: 0, y: 0, celType: 2, w: 2, h: 2, pixels: shade1 }),
    celChunk({ layer: 2, x: 0, y: 0, celType: 2, w: 8, h: 8, pixels: hidden }),
  ]);
  const head = header({ frames: 2, width: 8, height: 8, depth: 32, flags: 1, speed: 100, colors: 4 });
  const file = Buffer.concat([head, f0, f1]);
  file.writeUInt32LE(file.length, 0);
  write('hero.aseprite', file);
}

// An indexed 4x4 sprite: one frame, one raw cel, palette index 0 transparent.
// Small on purpose — it only has to prove the indexed path and old-palette fallback work.
function makeIndexed() {
  const pal = [[0, 0, 0, 0], [248, 248, 248, 255], [40, 40, 72, 255]];
  const pixels = Buffer.from([
    0, 1, 1, 0,
    1, 2, 2, 1,
    1, 2, 2, 1,
    0, 1, 1, 0,
  ]);
  const f0 = frame(120, [
    layerChunk({ name: 'art' }),
    paletteChunk(pal),
    celChunk({ layer: 0, x: 0, y: 0, celType: 0, w: 4, h: 4, pixels }),
  ]);
  const head = header({ frames: 1, width: 4, height: 4, depth: 8, flags: 1, speed: 120, colors: pal.length });
  const file = Buffer.concat([head, f0]);
  file.writeUInt32LE(file.length, 0);
  write('blob.aseprite', file);
}

// A 4x4 file whose single cel claims to be zlib-compressed but carries junk, so the
// importer's "I cannot decompress this" path has real bytes to fail on.
function makeBroken() {
  const cel = (() => {
    const c = new Writer();
    c.u16(0); c.i16(0); c.i16(0); c.u8(255); c.u16(2); c.i16(0); c.zero(5);
    c.u16(4); c.u16(4);
    c.push(Buffer.from([0x78, 0x9c, 0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]));   // not a valid deflate stream
    return chunk(0x2005, c.buf());
  })();
  const f0 = frame(100, [layerChunk({ name: 'art' }), cel]);
  const head = header({ frames: 1, width: 4, height: 4, depth: 32, flags: 1, speed: 100, colors: 0 });
  const file = Buffer.concat([head, f0]);
  file.writeUInt32LE(file.length, 0);
  write('broken.aseprite', file);
}

const size = makeSheetPng();
makeSheetJson(size);
makeSlicesJson(size);
makeAseprite();
makeIndexed();
makeBroken();
