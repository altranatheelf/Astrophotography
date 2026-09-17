// e2e/battle.js — a battle screen, with words on it.
//
//   NODE_PATH=$(npm root -g) node e2e/battle.js
//
// The bullet module was built to find out whether an Undertale-scope fight can
// be written against the public API. It found two things: a scene could not
// draw at all (fixed), and then that a scene could not draw TEXT — which is
// most of what an Undertale battle is. `* Smells like a trash can.` sits inside
// the arena; the enemy's name is above it; the hearts are below it. None of it
// is a DOM overlay.
//
// So this checks the whole screen, in a browser, at two sizes — because the bug
// that actually happened was the third line of a long sentence landing on top
// of the arena on a short window.
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html');
const SHOTS = process.env.KIT_SHOTS ||
  '/tmp/claude-0/-home-user-Astrophotography/19812bb4-4e6f-5d04-84c2-78d4b1a8e91f/scratchpad/kit/shots';
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

const SAYS = "* it's a beautiful day outside.\n* {fx:wave,2}birds are singing{/fx}, {fx:shiver,2}flowers are blooming{/fx}...";

async function open(browser, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(PAGE);
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted, { timeout: 30000 });
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => KIT.game.scene() === 'map' && !!KIT.game.world && !KIT.interpreter.mainBusy())) break;
    await page.keyboard.press('z');
    await page.waitForTimeout(140);
  }
  await page.evaluate((says) => {
    KIT.bullet.registerAll(KIT);
    KIT.registry('voices').add({ id: 'e2e-sans', name: 'Sans', sound: 'blip', pitch: 0.55, everyChars: 2,
      font: '"Comic Sans MS", cursive', color: '#dfe7f5' });
    KIT.scenes.push('bullet-fight', {
      game: KIT.game, pattern: 'ring', count: 24, hp: 20,
      who: '{voice:e2e-sans}SANS{/voice}', says,
    });
  }, says());
  return page;
}
function says() { return SAYS; }

async function run(browser) {
  beat(1, 'a canvas can draw text at all');
  const page = await open(browser, 640, 520);
  const api = await page.evaluate(() => {
    const cv = document.createElement('canvas'); cv.width = 300; cv.height = 80;
    const c = cv.getContext('2d');
    const m = KIT.drawText(c, 'Hello {color:#ff0000}there{/color}', 4, 4, { size: 16, width: 280 });
    const wide = KIT.drawText(c, 'a much much much longer sentence than that one', 4, 4, { size: 16, width: 120 });
    return { hasDraw: typeof KIT.drawText === 'function', width: m.width, chars: m.chars,
             lines: m.lines.length, wrapped: wide.lines.length, height: m.height };
  });
  check(api.hasDraw, 'KIT.drawText exists');
  check(api.width > 30, `it measures (${Math.round(api.width)}px)`);
  check(api.chars === 'Hello there'.length, `and counts drawable characters, not codes (${api.chars})`);
  check(api.lines === 1 && api.wrapped > 1, `and wraps to the width it is given (${api.lines} vs ${api.wrapped})`);

  beat(2, 'the battle screen puts its bands in order and they do not overlap');
  const layout = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 3200));
    const cv = document.querySelector('canvas');
    const c = cv.getContext('2d');
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    // find rows that have any non-black pixel — the bands show up as gaps
    const rows = [];
    for (let y = 0; y < cv.height; y++) {
      let lit = 0;
      for (let x = 0; x < cv.width; x += 3) {
        const i = (y * cv.width + x) * 4;
        if (d[i] + d[i + 1] + d[i + 2] > 90) lit++;
      }
      rows.push(lit);
    }
    const bands = [];
    let start = -1;
    rows.forEach((n, y) => {
      if (n > 0 && start < 0) start = y;
      else if (n === 0 && start >= 0) { bands.push([start, y]); start = -1; }
    });
    if (start >= 0) bands.push([start, rows.length]);
    return { bands: bands.filter(([a, b]) => b - a > 2), h: cv.height };
  });
  check(layout.bands.length >= 3, `at least three separated bands of content (${layout.bands.length}) — name, line, arena, hearts`);
  check(layout.bands.every(([a, b]) => b > a), 'and every one of them is a real band');

  beat(3, 'the words are actually on the canvas, not in the DOM');
  const dom = await page.evaluate(() => ({
    domText: document.body.innerText.includes('beautiful day'),
    hudPanels: document.querySelectorAll('.bullet-hud').length,
    scene: KIT.game.scene(),
    opaque: !!KIT.scenes.opaqueTop(),
  }));
  check(dom.scene === 'bullet-fight', 'the fight is the scene');
  check(dom.opaque, 'and it owns the screen');
  check(!dom.domText, 'the line is NOT in the DOM — it is drawn');
  check(dom.hudPanels === 0, 'and the old DOM HUD is gone, not doubled up');
  await page.screenshot({ path: SHOTS + '/battle-wide.png' });
  await page.close();

  beat(4, 'and it still fits on a phone, which is where it broke');
  const phone = await open(browser, 390, 780);
  await phone.waitForTimeout(3200);
  const fits = await phone.evaluate(() => {
    const cv = document.querySelector('canvas');
    const c = cv.getContext('2d');
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    // The arena's top edge is a long horizontal run of white. Find it, then
    // check no text pixel sits within a few rows above it.
    let boxTop = -1;
    for (let y = 0; y < cv.height && boxTop < 0; y++) {
      let run = 0, best = 0;
      for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) { run++; best = Math.max(best, run); } else run = 0;
      }
      if (best > cv.width * 0.5) boxTop = y;
    }
    let touching = 0;
    for (let y = Math.max(0, boxTop - 3); y < boxTop; y++) {
      for (let x = 0; x < cv.width; x += 2) {
        const i = (y * cv.width + x) * 4;
        if (d[i] + d[i + 1] + d[i + 2] > 240) touching++;
      }
    }
    return { boxTop, touching, h: cv.height };
  });
  check(fits.boxTop > 0, `found the arena's top edge (row ${fits.boxTop} of ${fits.h})`);
  check(fits.touching === 0, `and nothing is written on top of it (${fits.touching} stray pixels)`);
  await phone.screenshot({ path: SHOTS + '/battle-phone.png' });
  await phone.close();

  beat(5, 'nothing broke');
  check(errors.length === 0, `no console errors or page errors${errors.length ? ': ' + errors[0] : ''}`);
  for (const e of errors) log('     ! ' + e);
}

(async () => {
  const browser = await chromium.launch();
  try { await run(browser); }
  catch (e) { failures++; log('\nUNCAUGHT: ' + (e && e.stack ? e.stack : e)); }
  await browser.close();
  log(`\nscreenshots: ${SHOTS}/battle-*.png`);
  if (failures) { log(`\n${failures} check(s) failed`); process.exit(1); }
  log('\nPASS');
})();
