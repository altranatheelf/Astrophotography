#!/usr/bin/env node
// The font the tests bring into a game: one square, for the letter A.
//
//   node tools/make-test-font.js
//
// Writes test/fixtures/look/one-glyph.ttf, which is committed; run this only
// if the font has to change. It is not art and not for a game. It exists
// because the Look group's fonts have to be proved with a real font file — a
// browser checks every font it is handed (Chrome runs it through a sanitiser,
// OTS) and quietly drops one that is not whole — and no font in the world is
// ours to put in the repository. So this one is written byte by byte, with
// every table a TrueType font needs and nothing else: cmap, glyf, head, hhea,
// hmtx, loca, maxp, name, OS/2 and post. It maps A to a filled square and
// everything else to nothing, so text set in it shows boxes for its A's and
// the stand-in font for the rest.
//
// The same bytes come out every run (the dates are fixed), so the fixture only
// changes when this file does.
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'test', 'fixtures', 'look', 'one-glyph.ttf');
const FAMILY = 'Kit Test Glyph';
const EM = 1000;
const ADVANCE = 600;
/** The square, in font units: from x 100 to 500, from the baseline up to 500. */
const BOX = { x0: 100, y0: 0, x1: 500, y1: 500 };
const CODE = 0x41;                                   // A
const WHEN = 3786825600;                             // 2024-01-01, in seconds since 1904, for every date in the font

/** A little big-endian writer: the font format is big-endian throughout. */
function writer() {
  const bytes = [];
  const w = {
    u8(v) { bytes.push(v & 0xff); return w; },
    u16(v) { return w.u8(v >> 8).u8(v); },
    i16(v) { return w.u16(v < 0 ? v + 0x10000 : v); },
    u32(v) { return w.u16(Math.floor(v / 0x10000) & 0xffff).u16(v & 0xffff); },
    date(seconds) { return w.u32(0).u32(seconds); },
    tag(s) { for (const ch of s) w.u8(ch.charCodeAt(0)); return w; },
    bytes(list) { for (const b of list) w.u8(b); return w; },
    get length() { return bytes.length; },
    done() { return Buffer.from(bytes); },
  };
  return w;
}

/** The sum of a table's bytes as big-endian 32-bit words, padded with zeros to a whole word. */
function checksum(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 4) sum = (sum + ((buf[i] << 24) >>> 0) + ((buf[i + 1] || 0) << 16) + ((buf[i + 2] || 0) << 8) + (buf[i + 3] || 0)) >>> 0;
  return sum;
}

// ---- the tables ---------------------------------------------------------------------------

// glyf: glyph 0 (.notdef, drawn as nothing) has no outline at all; glyph 1 is the
// square, one contour of four points on the curve, going round clockwise.
const square = writer()
  .i16(1).i16(BOX.x0).i16(BOX.y0).i16(BOX.x1).i16(BOX.y1)   // one contour, and its bounds
  .u16(3)                                                   // the contour ends at point 3
  .u16(0)                                                   // no instructions
  .bytes([1, 1, 1, 1])                                      // four points, each on the curve, as 16-bit steps
  .i16(BOX.x0).i16(0).i16(BOX.x1 - BOX.x0).i16(0)           // x: left, up the left side, across, down the right side
  .i16(BOX.y0).i16(BOX.y1 - BOX.y0).i16(0).i16(BOX.y0 - BOX.y1)
  .done();
const glyf = square;
// loca, short form: each glyph's start in glyf, halved. Glyph 0 is empty, so it starts and ends at 0.
const loca = writer().u16(0).u16(0).u16(square.length / 2).done();

const head = writer()
  .u32(0x00010000).u32(0x00010000)                          // version 1.0, font revision 1.0
  .u32(0)                                                   // checkSumAdjustment, filled in at the end
  .u32(0x5F0F3CF5)                                          // the magic number
  .u16(0x000B)                                              // baseline at 0, left side bearing at 0, whole-pixel sizes
  .u16(EM)
  .date(WHEN).date(WHEN)
  .i16(BOX.x0).i16(BOX.y0).i16(BOX.x1).i16(BOX.y1)
  .u16(0)                                                   // regular
  .u16(8)                                                   // smallest readable size, in pixels
  .i16(2)                                                   // left to right, with neutrals
  .i16(0)                                                   // loca is the short form
  .i16(0)
  .done();

const hhea = writer()
  .u32(0x00010000)
  .i16(800).i16(-200).i16(0)                                // ascender, descender, line gap
  .u16(ADVANCE)
  .i16(0).i16(0).i16(BOX.x1)                                // min left and right bearings, widest extent
  .i16(1).i16(0).i16(0)                                     // an upright caret
  .i16(0).i16(0).i16(0).i16(0)
  .i16(0)
  .u16(2)                                                   // a width for each of the two glyphs
  .done();

const hmtx = writer().u16(ADVANCE).i16(0).u16(ADVANCE).i16(BOX.x0).done();

const maxp = writer()
  .u32(0x00010000)
  .u16(2)                                                   // two glyphs
  .u16(4).u16(1)                                            // at most four points, one contour
  .u16(0).u16(0)                                            // nothing composite
  .u16(2)                                                   // no twilight zone in use
  .u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0)
  .done();

// cmap: one Windows Unicode subtable, format 4, with the one letter and the
// segment every format 4 table has to end with.
const segments = [{ start: CODE, end: CODE, delta: 1 - CODE }, { start: 0xFFFF, end: 0xFFFF, delta: 1 }];
const seg2 = segments.length * 2;
const search = 2 * Math.pow(2, Math.floor(Math.log2(segments.length)));
const sub = writer().u16(4).u16(14 + seg2 * 4 + 2).u16(0)
  .u16(seg2).u16(search).u16(Math.log2(search / 2)).u16(seg2 - search);
for (const s of segments) sub.u16(s.end);
sub.u16(0);
for (const s of segments) sub.u16(s.start);
for (const s of segments) sub.i16(s.delta);
for (let i = 0; i < segments.length; i++) sub.u16(0);
const cmapSub = sub.done();
const cmap = Buffer.concat([writer().u16(0).u16(1).u16(3).u16(1).u32(12).done(), cmapSub]);

// name: the family and its style, the way a font menu would show them, in UTF-16 for Windows.
const NAMES = [[1, FAMILY], [2, 'Regular'], [3, FAMILY + ' Regular'], [4, FAMILY], [5, 'Version 1.0'], [6, 'KitTestGlyph-Regular']];
const strings = NAMES.map(([, text]) => Buffer.from(Array.from(text).flatMap(ch => [0, ch.charCodeAt(0)])));
const nameHead = writer().u16(0).u16(NAMES.length).u16(6 + 12 * NAMES.length);
let at = 0;
NAMES.forEach(([id], i) => { nameHead.u16(3).u16(1).u16(0x0409).u16(id).u16(strings[i].length).u16(at); at += strings[i].length; });
const name = Buffer.concat([nameHead.done()].concat(strings));

const os2 = writer()
  .u16(4)                                                   // version 4
  .i16(ADVANCE).u16(400).u16(5).u16(0)                      // average width, regular weight, normal width, installable
  .i16(650).i16(600).i16(0).i16(75)                         // subscript
  .i16(650).i16(600).i16(0).i16(350)                        // superscript
  .i16(50).i16(250)                                         // strikeout
  .i16(0)
  .bytes([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])                    // PANOSE: any
  .u32(1).u32(0).u32(0).u32(0)                              // Unicode ranges: Basic Latin
  .tag('NONE')
  .u16(0x0040)                                              // regular
  .u16(CODE).u16(CODE)
  .i16(800).i16(-200).i16(0)
  .u16(800).u16(200)
  .u32(1).u32(0)                                            // code page: Latin 1
  .i16(BOX.y1).i16(BOX.y1)                                  // x-height, cap height
  .u16(0).u16(0x20).u16(0)
  .done();

const post = writer().u32(0x00030000).u32(0).i16(-100).i16(50).u32(0).u32(0).u32(0).u32(0).u32(0).done();

// ---- the file -------------------------------------------------------------------------------
// The directory lists the tables in the order of their tags' bytes (capitals
// first), and each table starts on a four-byte boundary.
const tables = { 'OS/2': os2, cmap, glyf, head, hhea, hmtx, loca, maxp, name, post };
const tags = Object.keys(tables).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const n = tags.length;
const range = 16 * Math.pow(2, Math.floor(Math.log2(n)));
const dir = writer().u32(0x00010000).u16(n).u16(range).u16(Math.log2(range / 16)).u16(n * 16 - range);
let offset = 12 + 16 * n;
const bodies = [];
for (const tag of tags) {
  const t = tables[tag];
  dir.tag(tag).u32(checksum(t)).u32(offset).u32(t.length);
  const padded = Buffer.alloc(Math.ceil(t.length / 4) * 4);
  t.copy(padded);
  bodies.push(padded);
  offset += padded.length;
}
const font = Buffer.concat([dir.done()].concat(bodies));
// The whole file's checksum, put right through head's checkSumAdjustment.
const headAt = font.readUInt32BE(12 + 16 * tags.indexOf('head') + 8);
font.writeUInt32BE((0xB1B0AFBA - checksum(font)) >>> 0, headAt + 8);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, font);
console.log(`wrote ${path.relative(path.join(__dirname, '..'), OUT)} (${font.length} bytes)`);
