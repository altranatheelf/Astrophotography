// e2e/keys.js — change a key, and walk with it.
//
//   NODE_PATH=$(npm root -g) node e2e/keys.js
//
// The engine had the whole remapping API for weeks with no screen, so the check
// that matters is not "does bind() work" — a unit test says that — but whether a
// player can get to it and whether the game then listens to the new key. So:
//
//   1. pause → Settings → Controls
//   2. pick "Up", press Q
//   3. close everything and walk with Q
//   4. reload, and Q still walks
//   5. put the keys back, and Q does nothing again
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

async function playing(page) {
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted, undefined, { timeout: 30000 });
  if (await page.isVisible('[data-action="new-game"]')) await page.click('[data-action="new-game"]');
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => KIT.game.scene() === 'map' && !!KIT.game.world && !KIT.game.world.busy && !KIT.interpreter.mainBusy())) return true;
    await page.keyboard.press('z');
    await page.waitForTimeout(160);
  }
  return false;
}
const rowsOf = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#pause-menu .kit-menu-item'))
  .map(b => ({ action: b.getAttribute('data-action'), text: b.innerText.replace(/\s+/g, ' ').trim(), off: b.disabled })));
const at = (page) => page.evaluate(() => { const h = KIT.game.world.hero(); return { x: h.x, y: h.y }; });

/** Hold a key and see whether the hero moves at all. */
async function walksWith(page, key) {
  const before = await at(page);
  await page.keyboard.down(key);
  let moved = false;
  try {
    await page.waitForFunction(([bx, by]) => {
      const h = KIT.game.world.hero();
      return h.x !== bx || h.y !== by || h.mover.moving;
    }, [before.x, before.y], { timeout: 1200 });
    moved = true;
  } catch (e) { moved = false; }
  await page.keyboard.up(key);
  await page.waitForTimeout(250);
  return moved;
}

async function run(browser) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  beat(1, 'a player can find the Controls screen');
  await page.goto(PAGE + '?fast=1');
  check(await playing(page), 'the demo world is up');
  // Face a direction with room in it, so "did it move" is about the key and not
  // about a wall.
  const dir = await page.evaluate(() => {
    const w = KIT.game.world, h = w.hero();
    for (const d of ['up', 'down', 'left', 'right']) {
      const r = w.map.passable(h.x, h.y, d, h);
      if (r && r.ok) return d;
    }
    return null;
  });
  check(!!dir, `there is somewhere to walk (${dir})`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  await page.click('#pause-menu [data-action="menu:settings"]');
  await page.waitForTimeout(300);
  const settings = await rowsOf(page);
  const row = settings.find(r => r.action === 'keys');
  check(!!row, `Settings offers Controls (“${row && row.text}”)`);
  check(!!row && /default/.test(row.text), 'and says the keys are still the defaults');
  await page.click('#pause-menu [data-action="keys"]');
  await page.waitForTimeout(300);
  const keys = await rowsOf(page);
  check(keys.filter(r => (r.action || '').startsWith('bind:')).length >= 7,
    `every button is listed (${keys.filter(r => (r.action || '').startsWith('bind:')).length})`);
  check(!!keys.find(r => r.action === 'keys-reset' && r.off), 'and “put the keys back” is greyed, because nothing has changed');
  await page.screenshot({ path: SHOTS + '/keys-screen.png' });

  beat(2, 'and change one');
  check(await walksWith(page, 'q') === false, 'Q does nothing yet', true);
  await page.click(`#pause-menu [data-action="bind:0:${dir}"]`);
  await page.waitForTimeout(250);
  const waiting = await rowsOf(page);
  const asked = waiting.find(r => r.action === `bind:0:${dir}`);
  check(!!asked && /press a key/.test(asked.text), `the row asks for a key (“${asked && asked.text}”)`);
  await page.screenshot({ path: SHOTS + '/keys-waiting.png' });
  await page.keyboard.press('q');
  await page.waitForTimeout(300);
  const bound = await page.evaluate((d) => ({
    map: KIT.input.keymap(0).KeyQ,
    shown: (Array.from(document.querySelectorAll('#pause-menu .kit-menu-item'))
      .find(b => b.getAttribute('data-action') === 'bind:0:' + d) || {}).innerText || '',
    saved: (KIT.storage.settings().keys || [])[0] || null,
    resetOff: (Array.from(document.querySelectorAll('#pause-menu .kit-menu-item'))
      .find(b => b.getAttribute('data-action') === 'keys-reset') || {}).disabled,
  }), dir);
  check(bound.map === dir, `Q now means ${dir} (${bound.map})`);
  check(/Q/.test(bound.shown.replace(/\s+/g, ' ')), `and the row shows it (“${bound.shown.replace(/\s+/g, ' ').trim()}”)`);
  check(!!bound.saved && bound.saved.KeyQ === dir, 'and it went into the saved settings, not just into memory');
  check(bound.resetOff === false, 'and “put the keys back” is offered now');

  beat(3, 'the game listens to it');
  await page.keyboard.press('Escape');            // out of Controls
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');            // out of Settings
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');            // out of the pause menu
  await page.waitForFunction(() => KIT.game.scene() === 'map' && !KIT.game.world.busy, undefined, { timeout: 8000 }).catch(() => {});
  check(await walksWith(page, 'q'), 'pressing Q walks');

  beat(4, 'and still does after a reload');
  await page.reload();
  check(await playing(page), 'the game came back');
  const after = await page.evaluate(() => ({ q: KIT.input.keymap(0).KeyQ, saved: !!KIT.storage.settings().keys }));
  check(!!after.q, `Q is still bound (${after.q})`);
  check(after.saved, 'because the setting outlives the page, like language does');
  check(await walksWith(page, 'q'), 'and it really walks');

  beat(5, 'putting them back puts them back');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  await page.click('#pause-menu [data-action="menu:settings"]');
  await page.waitForTimeout(250);
  await page.click('#pause-menu [data-action="keys"]');
  await page.waitForTimeout(250);
  await page.click('#pause-menu [data-action="keys-reset"]');
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => ({ q: KIT.input.keymap(0).KeyQ || null, saved: KIT.storage.settings().keys, up: KIT.input.keymap(0).ArrowUp }));
  check(back.q === null || back.q === undefined, 'Q means nothing again');
  check(!back.saved, 'and the setting is cleared rather than left saying "changed"');
  check(back.up === 'up', 'while the engine’s own keys are where they always were');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => KIT.game.scene() === 'map', undefined, { timeout: 8000 }).catch(() => {});
  check(await walksWith(page, 'q') === false, 'and the game no longer answers it', true);
  check(await walksWith(page, 'ArrowUp') || await walksWith(page, 'ArrowDown'), 'while the arrows still work');

  beat(5.5, 'a mistap on a second row does not leave a key listener behind');
  // Two rows tapped in a row (easy with a thumb) used to leave the first row's raw
  // listener installed for good: every key swallowed, and a ghost Controls panel
  // over the map. Only a reload recovered.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  await page.click('#pause-menu [data-action="menu:settings"]');
  await page.waitForTimeout(300);
  await page.click('#pause-menu [data-action="keys"]');
  await page.waitForTimeout(300);
  await page.click('#pause-menu [data-action="bind:0:up"]');
  await page.waitForTimeout(200);
  await page.click('#pause-menu [data-action="bind:0:down"]');
  await page.waitForTimeout(200);
  await page.keyboard.press('m');                 // binds the row that is actually waiting
  await page.waitForTimeout(250);
  await page.click('#pause-menu [data-action="keys-reset"]').catch(() => {});
  await page.waitForTimeout(200);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  await page.waitForFunction(() => KIT.game.scene() === 'map', undefined, { timeout: 8000 }).catch(() => {});
  const before = await page.evaluate(() => ({ dir: KIT.game.world.hero().dir }));
  await page.keyboard.press(before.dir === 'left' ? 'ArrowRight' : 'ArrowLeft');
  await page.waitForTimeout(300);
  const afterKey = await page.evaluate(() => ({ scene: KIT.game.scene(), ids: KIT.scenes.ids(), pauseHidden: document.getElementById('pause-menu').hidden, dir: KIT.game.world.hero().dir }));
  check(afterKey.scene === 'map' && afterKey.pauseHidden, `back on the map, no ghost Controls panel (${afterKey.ids.join(',')})`);
  check(afterKey.dir !== before.dir, `and the arrows reach the hero again (${before.dir} → ${afterKey.dir})`);
  await page.close();

  beat(6, 'nothing broke');
  check(errors.length === 0, `no console errors or page errors${errors.length ? ': ' + errors[0] : ''}`);
  for (const e of errors) log('     ! ' + e);
}

(async () => {
  const browser = await chromium.launch();
  try { await run(browser); }
  catch (e) { failures++; log('\nUNCAUGHT: ' + (e && e.stack ? e.stack : e)); }
  await browser.close();
  log(`\nscreenshots: ${SHOTS}/keys-*.png`);
  if (failures) { log(`\n${failures} check(s) failed`); process.exit(1); }
  log('\nPASS');
})();
