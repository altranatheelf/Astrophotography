// e2e/touch.js — the editor, with fingers.
//
//   NODE_PATH=$(npm root -g) node e2e/touch.js
//
// Finger count is the modifier key of touch, and the answer is already settled:
// Procreate and Nomad Sculpt arrived at two-finger-tap = undo, three-finger-tap
// = redo independently, and every tablet artist already knows it. Unlike a
// toolbar button it costs no screen space, which on a phone is the whole game.
//
// For contrast, Godot's own Android editor documentation recommends bringing a
// Bluetooth keyboard and mouse.
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html') + '?edit=1';
const IGNORE = /fonts\.googleapis|fonts\.gstatic|ERR_CERT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_FAILED.*fonts|AudioContext/i;

let failures = 0;
const log = (...a) => console.log(...a);
const beat = (n, what) => log(`\n--- ${n}. ${what} ---`);
function check(ok, what) {
  if (ok) log('  ok  ' + what);
  else { failures++; log('  FAIL ' + what); }
  return ok;
}
const errors = [];

// One synthetic multi-touch tap on the editor canvas.
const TAP = `async (opts) => {
  const c = KIT.editor.el.canvas;
  const r = c.getBoundingClientRect();
  const send = (el, type, id, i) => el.dispatchEvent(new PointerEvent(type, {
    pointerId: id, pointerType: 'touch', isPrimary: i === 0, bubbles: true, cancelable: true,
    clientX: r.x + 40 + i * 28 + (opts.drift || 0), clientY: r.y + 40,
  }));
  const ids = Array.from({ length: opts.fingers }, (_, i) => 10 + i);
  for (let i = 0; i < opts.fingers; i++) { send(c, 'pointerdown', ids[i], i); await new Promise(z => setTimeout(z, 10)); }
  if (opts.move) for (let i = 0; i < opts.fingers; i++) {
    c.dispatchEvent(new PointerEvent('pointermove', { pointerId: ids[i], pointerType: 'touch', bubbles: true,
      clientX: r.x + 40 + i * 28 + 90, clientY: r.y + 40 }));
  }
  await new Promise(z => setTimeout(z, opts.hold || 40));
  for (let i = 0; i < opts.fingers; i++) { send(window, 'pointerup', ids[i], i); await new Promise(z => setTimeout(z, 8)); }
  await new Promise(z => setTimeout(z, 150));
  return KIT.editor.state.doc.history.length;
}`;

async function run(browser) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(PAGE);
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted, { timeout: 30000 });
  await page.evaluate(() => KIT.editor.open());
  await page.waitForTimeout(800);

  const tap = (opts) => page.evaluate(`(${TAP})(${JSON.stringify(opts)})`);

  beat(1, 'three edits to undo');
  const start = await page.evaluate(() => {
    const ED = KIT.editor;
    const id = ED.state.map.id;
    for (let i = 0; i < 3; i++) ED.commit('Paint ' + i, (doc, O) => O.setField(doc, ['maps', id, 'layers', 'ground', 40 + i], 'grass'));
    return ED.state.doc.history.length;
  });
  check(start === 3, `three steps on the stack (${start})`);

  beat(2, 'two fingers undo');
  check(await tap({ fingers: 2 }) === 2, 'one step back');
  check(await tap({ fingers: 2 }) === 1, 'and another');

  beat(3, 'three fingers redo');
  check(await tap({ fingers: 3 }) === 2, 'one step forward');
  check(await tap({ fingers: 3 }) === 3, 'and another');
  check(await tap({ fingers: 3 }) === 3, 'and nothing at the end of the stack');

  beat(4, 'a gesture is a tap, not a drag or a hold');
  check(await tap({ fingers: 2, move: true }) === 3, 'two fingers that MOVE are a pan, not an undo');
  check(await tap({ fingers: 2, hold: 700 }) === 3, 'two fingers HELD are not an undo either');

  beat(5, 'one finger still draws');
  const painted = await page.evaluate(async () => {
    const ED = KIT.editor;
    const before = ED.state.doc.history.length;
    ED.set({ tool: 'pencil' });
    const c = ED.el.canvas, r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 99, pointerType: 'touch', isPrimary: true,
      bubbles: true, cancelable: true, clientX: r.x + 120, clientY: r.y + 120 }));
    await new Promise(z => setTimeout(z, 40));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 99, pointerType: 'touch', bubbles: true,
      clientX: r.x + 120, clientY: r.y + 120 }));
    await new Promise(z => setTimeout(z, 150));
    return { before, after: ED.state.doc.history.length };
  });
  check(painted.after === painted.before + 1, `one finger painted and recorded one step (${painted.before} -> ${painted.after})`);

  beat(6, 'nothing broke');
  check(errors.length === 0, `no console errors or page errors${errors.length ? ': ' + errors[0] : ''}`);
  for (const e of errors) log('     ! ' + e);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  try { await run(browser); }
  catch (e) { failures++; log('\nUNCAUGHT: ' + (e && e.stack ? e.stack : e)); }
  await browser.close();
  if (failures) { log(`\n${failures} check(s) failed`); process.exit(1); }
  log('\nPASS');
})();
