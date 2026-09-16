// e2e/devices.js — the same game, on two devices.
//
//   NODE_PATH=$(npm root -g) node e2e/devices.js
//
// "Make it so I can build it using my phone or computer" is two things. Creator
// Mode already runs on both. This is the other one: getting the work from one to
// the other, with no server, no account and nothing installed.
//
// Two browser contexts that share nothing — separate storage, separate drafts,
// one of them a phone with a thumb. An edit is made on the laptop, the game is
// saved as one file, and that file is opened on the phone. The edit is there.
// Then Undo, and the phone has its own game back.
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html') + '?edit=1';
const SHOTS = process.env.KIT_SHOTS ||
  '/tmp/claude-0/-home-user-Astrophotography/19812bb4-4e6f-5d04-84c2-78d4b1a8e91f/scratchpad/kit/shots';
const IGNORE = /fonts\.googleapis|fonts\.gstatic|ERR_CERT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_FAILED.*fonts/i;

let failures = 0;
const log = (...a) => console.log(...a);
const beat = (n, what) => log(`\n--- ${n}. ${what} ---`);
function check(ok, what) {
  if (ok) log('  ok  ' + what);
  else { failures++; log('  FAIL ' + what); }
  return ok;
}

const errors = [];
function watch(page, where) {
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(`${where} console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${where} pageerror: ${e.message}`));
}
async function editor(context, where) {
  const page = await context.newPage();
  watch(page, where);
  await page.goto(PAGE);
  await page.waitForFunction(() => window.KIT && KIT.editor && KIT.editor.isOpen && KIT.editor.isOpen(), undefined, { timeout: 20000 });
  return page;
}
/** Open a section of the Project panel by the words in its heading. */
async function openSection(page, words) {
  await page.evaluate((w) => {
    for (const d of document.querySelectorAll('#editor details.ed-sec')) {
      const sum = d.querySelector('summary');
      if (sum && sum.textContent.includes(w)) { d.open = true; d.scrollIntoView({ block: 'center' }); }
      else if (sum) d.open = false;
    }
  }, words);
  await page.waitForTimeout(250);
}

async function run(browser) {
  // ---- 1. the laptop -------------------------------------------------------
  beat(1, 'the laptop: make something');
  const laptop = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const big = await editor(laptop, 'laptop');

  const saved = await big.evaluate(() => {
    const ed = KIT.editor;
    ed.commit('Rename', (doc) => doc.set(['meta', 'title'], 'Written On The Laptop', { label: 'Rename' }));
    ed.commit('A person', (doc) => doc.set(['cast'], {
      wren: { id: 'wren', name: 'Wren', pronouns: 'she/her', knows: [], feels: {}, met: true,
        tags: [], group: '', note: '', sprite: null, face: null },
    }, { label: 'A person' }));
    return { name: KIT.storage.fileName(ed.state.project), text: KIT.storage.toFile(ed.state.project) };
  });
  check(/\.kitgame\.json$/.test(saved.name), `the whole game is one file (${saved.name}, ${(saved.text.length / 1024).toFixed(0)} KB)`);
  check(saved.text.includes('Written On The Laptop'), 'with the edit in it');

  // it reads back as a game, and says when it left
  const readable = await big.evaluate((t) => {
    const r = KIT.storage.fromFile(t);
    return { ok: r.ok, title: r.title, savedAt: !!r.savedAt };
  }, saved.text);
  check(readable.ok && readable.savedAt, 'stamped with what it is and when it left');

  await openSection(big, 'on your other device');
  await big.screenshot({ path: path.join(SHOTS, 'devices-1-laptop.png') });
  log('  📷 devices-1-laptop.png');

  // and rubbish is refused rather than half-loaded
  const refused = await big.evaluate(() => [
    KIT.storage.fromFile('hello'),
    KIT.storage.fromFile('{"a":1}'),
  ].map(r => ({ ok: r.ok, reason: r.reason })));
  check(refused.every(r => !r.ok && /not/.test(r.reason)), `a file that is not a game says so (${refused[0].reason})`);

  // ---- 2. the phone --------------------------------------------------------
  beat(2, 'the phone: a browser that has never seen it');
  const phone = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const small = await editor(phone, 'phone');
  const before = await small.evaluate(() => KIT.editor.state.project.meta.title);
  check(before !== 'Written On The Laptop', `it has its own game (“${before}”) and knows nothing of the laptop’s`);

  await small.evaluate(() => KIT.editor.set({ panel: 'project' }));
  await small.waitForTimeout(300);
  await openSection(small, 'on your other device');
  const reachable = await small.evaluate(() => {
    const has = (re) => Array.from(document.querySelectorAll('#editor button, #editor input'))
      .some(el => re.test(el.textContent || '') || re.test(el.type || ''));
    return { save: has(/Save a copy/), copy: has(/^Copy$/), file: has(/^file$/), paste: !!document.querySelector('#editor textarea.ed-paste') };
  });
  check(reachable.save && reachable.copy && reachable.file && reachable.paste,
    'every way in is on screen and thumb-sized: save, copy, choose a file, paste');

  // paste the laptop's game in, the way a thumb would
  await small.evaluate((text) => {
    const ta = document.querySelector('#editor textarea.ed-paste');
    ta.value = text;
    Array.from(document.querySelectorAll('#editor button')).find(b => /Open what is pasted/.test(b.textContent)).click();
  }, saved.text);
  await small.waitForTimeout(700);

  const after = await small.evaluate(() => ({
    title: KIT.editor.state.project.meta.title,
    cast: Object.keys(KIT.editor.state.project.cast || {}),
    said: (Array.from(document.querySelectorAll('#editor .ed-hint')).map(e => e.textContent).find(t => /Opened/.test(t)) || ''),
  }));
  check(after.title === 'Written On The Laptop', `the phone is editing the laptop’s game (“${after.title}”)`);
  check(after.cast.includes('wren'), 'with everything that was in it, down to the cast');
  check(/Opened/.test(after.said), `and it said so: ${after.said.slice(0, 80)}`);

  await openSection(small, 'on your other device');
  await small.screenshot({ path: path.join(SHOTS, 'devices-2-phone.png') });
  log('  📷 devices-2-phone.png');

  // ---- 3. and it is one undo step -----------------------------------------
  beat(3, 'and opening a game is one undo step, like everything else');
  await small.evaluate(() => KIT.editor.undo());
  await small.waitForTimeout(400);
  const undone = await small.evaluate(() => KIT.editor.state.project.meta.title);
  check(undone === before, `Ctrl+Z puts the phone’s own game back (“${undone}”)`);

  // ---- 4. the draft on each device is its own ------------------------------
  beat(4, 'each device keeps its own draft');
  await small.evaluate(() => KIT.editor.redo());
  await small.waitForTimeout(400);
  await small.evaluate(() => KIT.storage.saveDraft(KIT.editor.state.project, { now: true }));
  await small.reload();
  await small.waitForFunction(() => window.KIT && KIT.editor && KIT.editor.isOpen && KIT.editor.isOpen(), undefined, { timeout: 20000 });
  const phoneKept = await small.evaluate(() => KIT.editor.state.project.meta.title);
  const laptopKept = await big.evaluate(() => KIT.editor.state.project.meta.title);
  check(phoneKept === 'Written On The Laptop', 'the phone still has it after a reload');
  check(laptopKept === 'Written On The Laptop', 'and the laptop still has its own');

  await small.evaluate(() => KIT.storage.discardDraft());
  await big.evaluate(() => KIT.storage.discardDraft());
  check(errors.length === 0, `no console errors or page errors${errors.length ? ': ' + errors[0] : ''}`);
  for (const e of errors) log('     ! ' + e);
  await laptop.close();
  await phone.close();
}

(async () => {
  const browser = await chromium.launch();
  try { await run(browser); }
  catch (e) { failures++; log('\nUNCAUGHT: ' + (e && e.stack ? e.stack : e)); }
  await browser.close();
  log(`\nscreenshots: ${SHOTS}/devices-*.png`);
  if (failures) { log(`\n${failures} check(s) failed`); process.exit(1); }
  log('\nPASS');
})();
