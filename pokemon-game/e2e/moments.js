// e2e/moments.js — go back and try the other thing, and lose nothing.
//
//   NODE_PATH=$(npm root -g) node e2e/moments.js
//
// The claim is that saves form a tree and that going back to one makes a branch
// rather than an overwrite. That is exactly the kind of claim a unit test can
// prove about a data structure and cannot prove about a game, so this does it
// in a browser, through the pause menu, with the real save path:
//
//   1. play, save — a moment
//   2. play on, save again — a second moment, whose parent is the first
//   3. open the pause menu, pick the first moment, and land back in it
//   4. play differently, save — a BRANCH: the moment we left is still there
//   5. ask the engine what happened in the other branch, from a line of dialogue
//   6. reload the page and find the whole tree still there
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
/** Do something a save will notice, then save. Returns the moment's id. */
const beatAndSave = (page, label, fn) => page.evaluate(async ([label2, body]) => {
  // eslint-disable-next-line no-new-func
  new Function('KIT', body)(KIT);
  await KIT.game.save('autosave', { label: label2 });
  return KIT.timeline.head();
}, [label, fn]);

const tree = (page) => page.evaluate(() => ({
  count: KIT.timeline.count(),
  head: KIT.timeline.head(),
  rows: KIT.timeline.moments().map(r => ({ id: r.id, depth: r.depth, label: r.label, mine: r.mine, head: r.head, branches: r.branches })),
  bytes: KIT.timeline.bytes(),
}));

async function run(browser) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  beat(1, 'a save is a moment');
  await page.goto(PAGE + '?fast=1');
  check(await playing(page), 'the demo world is up');
  await page.evaluate(() => KIT.timeline.forgetAll());
  const m1 = await beatAndSave(page, 'the fork', "KIT.history.add(KIT.game.world.save, 'arrived', { what: 'here' });");
  const t1 = await tree(page);
  check(t1.count === 1 && t1.head === m1, `one moment, and we are standing in it (${m1})`);

  beat(2, 'and playing on makes another, below it');
  const m2 = await beatAndSave(page, 'straight on', "KIT.history.add(KIT.game.world.save, 'ate', { what: 'bread' });");
  const t2 = await tree(page);
  check(t2.count === 2, 'two moments');
  const row2 = t2.rows.find(r => r.id === m2);
  check(!!row2 && row2.depth === 1, `the second hangs off the first (depth ${row2 && row2.depth})`);

  beat(3, 'the pause menu offers them, and one of them is where we are');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  const paused = await page.evaluate(() => Array.from(document.querySelectorAll('#pause-menu .kit-menu-item'))
    .map(b => ({ action: b.getAttribute('data-action'), text: b.innerText.replace(/\s+/g, ' ').trim() })));
  const momentsRow = paused.find(r => r.action === 'menu:moments');
  check(!!momentsRow, `there is a Moments row in the pause menu (“${momentsRow && momentsRow.text}”)`);
  await page.click('#pause-menu [data-action="menu:moments"]');
  await page.waitForTimeout(300);
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#pause-menu .kit-menu-item'))
    .map(b => ({ action: b.getAttribute('data-action'), text: b.innerText.replace(/\s+/g, ' ').trim(), off: b.disabled })));
  check(rows.filter(r => (r.action || '').startsWith('moment:')).length === 2, 'both moments are listed');
  check(rows.some(r => r.action === 'moment:' + m2 && r.off), 'the one we are standing in is not offered as somewhere to go');
  check(rows.some(r => r.text.includes('the fork')), `a named moment is listed by its name (${rows.map(r => r.text).join(' | ')})`);
  await page.screenshot({ path: SHOTS + '/moments-list.png' });

  beat(4, 'walking back into one, and playing on, is a BRANCH');
  await page.click(`#pause-menu [data-action="moment:${m1}"]`);
  // Waiting for the HEAD to move is not enough and was the first version of this
  // check: `goto` moves the head and then rebuilds the world, so the head is
  // already there while the player is still standing in the future. `goto`
  // stamps the moment's id into the save it hands back, so the thing to wait for
  // is the WORLD carrying that stamp.
  await page.waitForFunction((id) => KIT.game.world && KIT.game.world.save.moment === id
    && KIT.game.scene() === 'map' && !KIT.interpreter.mainBusy(), m1, { timeout: 15000 });
  const backAt = await page.evaluate(() => ({
    head: KIT.timeline.head(),
    ateHere: KIT.history.count(KIT.game.world.save, { verb: 'ate', what: 'bread' }),
  }));
  check(backAt.head === m1, 'we are standing in the first moment again');
  check(backAt.ateHere === 0, 'and the bread we ate afterwards has not happened yet');

  const m3 = await beatAndSave(page, 'the other way', "KIT.history.add(KIT.game.world.save, 'killed', { what: 'dog' });");
  const t3 = await tree(page);
  check(t3.count === 3, `three moments, not two — nothing was overwritten (${t3.count})`);
  const fork = t3.rows.find(r => r.id === m1);
  check(!!fork && fork.branches === 2, `the first moment now has two futures (${fork && fork.branches})`);
  check(!!t3.rows.find(r => r.id === m2), 'the line we abandoned is still in the tree');

  beat(5, 'and a line of dialogue can ask what happened over there');
  const asked = await page.evaluate(() => {
    const C = KIT.conditions;
    const ctx = { project: KIT.game.project, world: { save: KIT.game.world.save } };
    return {
      // We are on the branch where the dog died and the bread was not eaten.
      breadElsewhere: C.test(C.parseText('elsewhere.ate/bread >= 1'), ctx),
      breadHere: C.test(C.parseText('did.ate/bread >= 1'), ctx),
      dogHere: C.test(C.parseText('did.killed/dog >= 1'), ctx),
      dogElsewhere: C.test(C.parseText('elsewhere.killed/dog >= 1'), ctx),
      line: KIT.text.substitute('You ate bread {elsewhere:ate/bread} time(s) somewhere else.',
        KIT.text.contextFrom(KIT.game.world.makeCtx(null, 'p1'))),
    };
  });
  check(asked.breadElsewhere === true, 'the bread was eaten, somewhere this playthrough went');
  check(asked.breadHere === false, 'and not here');
  check(asked.dogHere === true, 'the dog died here');
  check(asked.dogElsewhere === false, 'and nowhere else');
  check(/1 time/.test(asked.line), `and a line can say so: “${asked.line}”`);

  beat(6, 'the whole tree is still there after a reload');
  const beforeReload = await tree(page);
  await page.reload();
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted, undefined, { timeout: 30000 });
  const after = await page.evaluate(() => ({ count: KIT.timeline.count(), head: KIT.timeline.head(), bytes: KIT.timeline.bytes() }));
  check(after.count === beforeReload.count, `every moment came back (${after.count})`);
  check(after.head === m3, 'standing where we left off');
  check(after.bytes < 200 * 1024, `and the tree is small (${(after.bytes / 1024).toFixed(1)} KB)`);
  const rebuilt = await page.evaluate((id) => {
    const s = KIT.timeline.rebuild(id);
    return s ? { ok: true, ate: KIT.history.count(s, { verb: 'ate', what: 'bread' }) } : { ok: false };
  }, m2);
  check(rebuilt.ok && rebuilt.ate === 1, 'and the abandoned branch can still be rebuilt, bread and all');
  await page.screenshot({ path: SHOTS + '/moments-after-reload.png' });
  await page.evaluate(() => KIT.timeline.forgetAll());
  await page.close();

  beat(7, 'nothing broke');
  check(errors.length === 0, `no console errors or page errors${errors.length ? ': ' + errors[0] : ''}`);
  for (const e of errors) log('     ! ' + e);
}

(async () => {
  const browser = await chromium.launch();
  try { await run(browser); }
  catch (e) { failures++; log('\nUNCAUGHT: ' + (e && e.stack ? e.stack : e)); }
  await browser.close();
  log(`\nscreenshots: ${SHOTS}/moments-*.png`);
  if (failures) { log(`\n${failures} check(s) failed`); process.exit(1); }
  log('\nPASS');
})();
