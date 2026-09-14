'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KIT = require('./_load.js');
const X = KIT.pixels;

test('pixels: validate, dims, rowsOf, downscale, silhouette, paletteWith, artOf (pure parts)', () => {
  const art = { w: 4, h: 2, palette: { a: '#ff0000', b: '#00ff00' }, rows: ['aabb', '.ab.'] };
  assert.deepEqual(X.validate(art), []);
  assert.deepEqual(X.dims(art), { w: 4, h: 2 });
  assert.equal(X.rowsOf(art, 0), art.rows);
  assert.ok(X.validate({ palette: { a: '#ff0000' }, rows: ['ab'] }).some(e => /not in the palette/.test(e)));
  assert.ok(X.validate({ palette: { a: '#ff0000', z: '#000000' }, rows: ['aa'] }).some(e => /never used/.test(e)));
  assert.ok(X.validate(null).length);
  const frames = { w: 2, h: 1, palette: { a: '#ff0000' }, frames: [['aa'], ['a.']] };
  assert.deepEqual(X.validate(frames), []); assert.equal(X.frameCount(frames), 2); assert.deepEqual(X.rowsOf(frames, 3), ['a.']);
  const big = { size: 4, palette: { a: '#ff0000', b: '#0000ff' }, rows: ['aabb', 'aabb', 'bbaa', 'bbaa'] };
  assert.deepEqual(X.downscale(big, 2), { w: 2, h: 2, palette: { a: '#ff0000', b: '#0000ff' }, rows: ['ab', 'ba'] });
  const s = X.silhouette(6, 4, '#123456');
  assert.equal(s.w, 6); assert.equal(s.h, 4); assert.equal(s.rows.length, 4); assert.deepEqual(X.validate(s), []);
  assert.deepEqual(X.paletteWith(art, { a: '#111111' }), { a: '#111111', b: '#00ff00' });
  assert.deepEqual(X.paletteWith(art, { from: '#00ff00', to: '#222222' }), { a: '#ff0000', b: '#222222' });
  assert.equal(X.artOf({ id: 't', art }), art); assert.equal(X.artOf(Object.assign({ id: 't' }, art)).rows, art.rows); assert.equal(X.artOf({ id: 'no-art' }), null);
  assert.throws(() => X.canvas(art), /browser/);
});
