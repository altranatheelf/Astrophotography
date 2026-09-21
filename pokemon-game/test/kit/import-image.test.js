'use strict';
// KIT.import.image: a PNG on its own becomes a tileset or a walking sprite.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('./_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));
R('js/kit/core/assets.js');
R('js/kit/import/tiled.js');
R('js/kit/import/image.js');
const I = KIT.import.image;

const SIZES = { 'forest.png': { w: 64, h: 32 }, 'spaced.png': { w: 69, h: 16 }, 'hero.png': { w: 48, h: 64 }, 'strip.png': { w: 96, h: 24 } };
function asset(src) {
  const base = String(src).split('/').pop();
  const size = SIZES[base] || { w: 0, h: 0 };
  return { id: KIT.slug(base.replace(/\.png$/, '')), src: `data:image/png;base64,AAAA`, w: size.w, h: size.h };
}

test('image: guesses the tile size and the walk-cycle grid from the picture alone', () => {
  assert.equal(I.guessTile(64, 32), 16);
  assert.equal(I.guessTile(96, 96, 32), 32, 'the project’s size wins when it fits');
  assert.equal(I.guessTile(144, 96), 16);
  assert.equal(I.guessTile(90, 60), 16, 'nothing fits: the kit’s own size');
  assert.deepEqual(I.guessGrid(48, 64), { columns: 3, rows: 4, order: 'dlru' });
  assert.deepEqual(I.guessGrid(128, 128), { columns: 4, rows: 4, order: 'dlru' });
  assert.deepEqual(I.guessGrid(96, 24), { columns: 4, rows: 1, order: 'd' });
  assert.deepEqual(I.dirsOf('udlr'), ['up', 'down', 'left', 'right']);
  assert.deepEqual(I.dirsOf('xyz'), ['down', 'left', 'right', 'up'], 'nonsense falls back to the common order');
});

test('image: a 64×32 sheet at 16px is eight tiles in one group, each a rectangle of the sheet', () => {
  const res = I.tileset({ name: 'forest.png', w: 64, h: 32, asset });
  assert.equal(res.tiles.length, 8);
  assert.deepEqual(res.stats, Object.assign(res.stats, { tile: 16, columns: 4, rows: 2 }));
  const ids = res.tiles.map(t => t.id);
  assert.deepEqual(ids.slice(0, 4), ['forest:0', 'forest:1', 'forest:2', 'forest:3']);
  const t5 = res.tiles.find(t => t.id === 'forest:5');
  assert.ok(t5 && t5.art && t5.art.image === 'forest', `a tile draws from the sheet asset (${JSON.stringify(t5)})`);
  assert.deepEqual([t5.art.frame.x, t5.art.frame.y, t5.art.frame.w, t5.art.frame.h], [16, 16, 16, 16]);
  assert.equal(t5.group, 'forest', 'and sits in a palette group named after the sheet');
  assert.ok(res.assets.forest, 'the sheet itself is an asset');
  assert.equal(res.problems.filter(p => p.severity === 'error').length, 0);
});

test('image: margin, spacing, a prefix and skipped (empty) cells', () => {
  // 69 wide: 1 margin + 4 tiles × 16 + 3 spacings of 1 = 68, and a trailing margin the grid does not use
  const res = I.tileset({ name: 'spaced.png', w: 69, h: 16, tile: 16, margin: 1, spacing: 1, prefix: 'town', skip: [1, 3], asset });
  assert.equal(res.stats.columns, 4);
  assert.deepEqual(res.tiles.map(t => t.id), ['town:spaced:0', 'town:spaced:2']);
  assert.equal(res.stats.skipped, 2);
  const t2 = res.tiles.find(t => t.id === 'town:spaced:2');
  assert.equal(t2.art.frame.x, 1 + 2 * 17, 'margin and spacing shift the rectangles');
  assert.ok(res.problems.some(p => p.code === 'grid-uneven'), 'the spare pixel is mentioned, not hidden');
});

test('image: a 3×4 character sheet becomes one sprite with four directions of three frames', () => {
  const res = I.sprite({ name: 'hero.png', w: 48, h: 64, asset });
  assert.equal(res.sprites.length, 1);
  const s = res.sprites[0];
  assert.equal(s.id, 'hero');
  assert.equal(s.image, 'hero');
  assert.deepEqual([s.w, s.h], [16, 16]);
  assert.deepEqual(Object.keys(s.frames), ['down', 'left', 'right', 'up']);
  assert.equal(s.frames.left.length, 3);
  assert.deepEqual(s.frames.right[1], { x: 16, y: 32, w: 16, h: 16 });
  assert.equal(s.durations.up.length, 3);
  assert.ok(res.assets.hero);
  const custom = I.sprite({ name: 'hero.png', w: 48, h: 64, order: 'udlr', prefix: 'npc', asset });
  assert.equal(custom.sprites[0].id, 'npc:hero');
  assert.deepEqual(custom.sprites[0].frames.up[0], { x: 0, y: 0, w: 16, h: 16 }, 'the order says which row is which');
});

test('image: a one-row strip is a sprite that only faces down, and an uneven grid says so', () => {
  const strip = I.sprite({ name: 'strip.png', w: 96, h: 24, asset });
  assert.deepEqual(Object.keys(strip.sprites[0].frames), ['down']);
  assert.equal(strip.sprites[0].frames.down.length, 4);
  const uneven = I.sprite({ name: 'hero.png', w: 48, h: 64, columns: 5, rows: 4, asset });
  assert.ok(uneven.problems.some(p => p.code === 'grid-uneven'));
  assert.throws(() => I.tileset({ name: 'x.png', w: 0, h: 0, asset }), /no size/);
});
