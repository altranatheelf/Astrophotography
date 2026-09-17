'use strict';
// Text on the canvas: the pure parts — effect offsets and the writer's clock.
// Layout and drawing need a real 2D context, so those are checked in
// e2e/battle.js against a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('./_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));
R('js/kit/render/text-canvas.js');
const TC = KIT.textCanvas;

test('canvas text: effects are a function of time, so the same frame draws twice the same', () => {
  const a = TC.offsetFor('wave', 2, 3, 1000);
  const b = TC.offsetFor('wave', 2, 3, 1000);
  assert.deepEqual(a, b, 'deterministic — a screenshot test can rely on it');
  const later = TC.offsetFor('wave', 2, 3, 1400);
  assert.notDeepEqual(a, later, 'and it does move');
});

test('canvas text: a wave travels along the word rather than lifting it', () => {
  const t = 800;
  const first = TC.offsetFor('wave', 1, 0, t).dy;
  const third = TC.offsetFor('wave', 1, 2, t).dy;
  assert.notEqual(first, third, 'neighbouring letters are at different heights');
  assert.equal(TC.offsetFor('wave', 1, 0, t).dx, 0, 'a wave is vertical');
});

test('canvas text: amount scales the effect', () => {
  const small = Math.abs(TC.offsetFor('wave', 1, 1, 500).dy);
  const big = Math.abs(TC.offsetFor('wave', 3, 1, 500).dy);
  assert.ok(big > small * 2.5, `3x should be about 3x (${small.toFixed(2)} -> ${big.toFixed(2)})`);
});

test('canvas text: shiver jitters both ways and repeats exactly', () => {
  const a = TC.offsetFor('shiver', 1, 5, 300);
  assert.deepEqual(a, TC.offsetFor('shiver', 1, 5, 300), 'same letter, same moment, same jitter');
  let sawX = false, sawY = false;
  for (let t = 0; t < 2000; t += 45) {
    const o = TC.offsetFor('shiver', 1, 5, t);
    if (o.dx !== 0) sawX = true;
    if (o.dy !== 0) sawY = true;
  }
  assert.ok(sawX && sawY, 'it moves on both axes');
});

test('canvas text: throb changes alpha and rainbow changes colour, neither moves', () => {
  const th = TC.offsetFor('throb', 1, 0, 400);
  assert.equal(th.dx, 0); assert.equal(th.dy, 0);
  assert.ok(th.alpha > 0 && th.alpha <= 1, `alpha in range (${th.alpha})`);
  const rb = TC.offsetFor('rainbow', 1, 0, 400);
  assert.match(rb.color, /^hsl\(/);
  assert.notEqual(rb.color, TC.offsetFor('rainbow', 1, 4, 400).color, 'and it runs along the word');
});

test('canvas text: an unknown effect is still zero, not a crash', () => {
  assert.deepEqual(TC.offsetFor('nonsense', 1, 0, 0), { dx: 0, dy: 0 });
  assert.deepEqual(TC.offsetFor(null, 1, 0, 0), { dx: 0, dy: 0 });
});

test('canvas text: the writer counts its own progress but not its own clock', () => {
  const w = TC.writer({ speed: 10 });
  w.say('hello');
  assert.equal(w.revealed(), 0);
  assert.equal(w.done(), true, 'nothing laid out yet, so nothing to wait for');
  assert.equal(w.time(), 0);
  w.update(0.5);
  assert.ok(w.time() > 0, 'the clock only moves when it is told to');
});

test('canvas text: size and width invalidate the layout so a resize is honoured', () => {
  const w = TC.writer({ size: 12, width: 100 });
  assert.equal(w.lineHeight(), Math.round(12 * 1.45));
  w.size(24);
  assert.equal(w.lineHeight(), Math.round(24 * 1.45), 'a bigger size means taller lines');
  assert.equal(w.size(24), w, 'and it chains');
});

test('canvas text: the short names are on KIT where a scene would reach for them', () => {
  assert.equal(typeof KIT.drawText, 'function');
  assert.equal(typeof KIT.textWriter, 'function');
  assert.equal(KIT.drawText, TC.draw);
});
