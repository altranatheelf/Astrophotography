// e2e/languages.js — the same game, in another language.
//
//   NODE_PATH=$(npm root -g) node e2e/languages.js
//
// RPG Maker's answer to a second language is a second copy of the game. This is
// the other answer: the author opens Creator Mode, adds a language, saves one
// text file, someone translates it, and it comes back. Then the game says the
// translated line — in the dialogue box, on a phone, with the tags still working.
//
// Done in a real browser because the parts that could quietly break are the
// parts a unit test cannot see: the panel, the undo step, and whether the line
// that reaches the box is the translated one.
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html');
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
function watch(page) {
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
}

async function run(browser) {
  // A phone, because that is where this is supposed to work.
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, hasTouch: true });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(PAGE + '?edit=1');
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted, { timeout: 30000 });
  await page.evaluate(() => KIT.editor.open());
  await page.waitForTimeout(600);

  beat(1, 'the editor knows how many lines a player can read');
  const found = await page.evaluate(async () => {
    KIT.editor.set({ panel: 'project' });
    await new Promise((r) => setTimeout(r, 300));
    const box = Array.from(document.querySelectorAll('details'))
      .find((d) => /Languages/.test((d.querySelector('summary') || {}).textContent || ''));
    if (!box) return null;
    box.open = true;
    box.dispatchEvent(new Event('toggle'));
    await new Promise((r) => setTimeout(r, 200));
    const m = /(\d+) lines a player can read/.exec(box.textContent || '');
    return { has: true, count: m ? Number(m[1]) : 0 };
  });
  check(found && found.has, 'the Languages section is in the Project panel');
  check(found && found.count > 20, `it counted the lines (${found ? found.count : 0})`);

  beat(2, 'adding a language is one undo step');
  const added = await page.evaluate(async () => {
    window.prompt = (q) => (/code/i.test(q) ? 'de' : 'Deutsch');
    const box = Array.from(document.querySelectorAll('details'))
      .find((d) => /Languages/.test((d.querySelector('summary') || {}).textContent || ''));
    box.open = true;
    const sel = box.querySelector('select');
    sel.value = '';
    sel.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 400));
    const p = KIT.editor.state.project;
    return { codes: Object.keys(p.languages || {}), name: (p.languages.de || {}).name };
  });
  check(added.codes.includes('de'), 'the language is on the project');
  check(added.name === 'Deutsch', 'under the name it is called in itself');

  beat(3, 'the file it hands out is one a person could actually fill in');
  const file = await page.evaluate(() => KIT.lang.toText(KIT.editor.state.project, 'de'));
  check(/^# .* — Deutsch \(de\)$/m.test(file), 'it says what it is');
  check(/^# 0 of \d+ lines translated\.$/m.test(file), 'and how much is left');
  check(/^# .+ · .+$/m.test(file), 'every line says where it came from');
  check(/^> .+\n<$/m.test(file), 'and waits with an empty line under it');
  check(!/\{\{|\\u/.test(file), 'no escaping a translator would have to understand');

  beat(4, 'a translated file comes back, and the game says it');
  const said = await page.evaluate(async () => {
    const p = KIT.editor.state.project;
    // the first real dialogue line in the project, whatever it is
    const first = KIT.lang.extract(p).find((l) => /[.!?]$/.test(l.text) && l.text.length > 12);
    const back = [
      '# something a translator typed',
      ...first.text.split('\n').map((l) => '> ' + l),
      '< ÜBERSETZT: ' + first.text,
    ].join('\n');
    const r = KIT.lang.fromText(back);
    KIT.lang.put(p, 'de', { name: 'Deutsch', lines: r.lines });
    KIT.lang.bind(p, 'de');
    const ctx = { project: p, world: KIT.game.world || { save: { heroes: [] } } };
    return {
      problems: r.problems.length,
      source: first.text,
      rendered: KIT.text.plain(first.text, ctx),
      coverage: KIT.lang.coverage(p, 'de').translated,
    };
  });
  check(said.problems === 0, 'the file read back with no complaints');
  check(said.coverage === 1, 'and one line landed');
  check(said.rendered.startsWith('ÜBERSETZT:'), `the rendered line is the translated one (${said.rendered.slice(0, 40)}…)`);

  beat(5, 'the tags survive the round trip');
  const tags = await page.evaluate(() => {
    const p = KIT.editor.state.project;
    const lines = Object.assign({}, p.languages.de.lines, {
      '{p1} and {p2} went out.': 'VERTAUSCHT: {p2} und {p1} gingen hinaus.',
    });
    KIT.lang.put(p, 'de', { name: 'Deutsch', lines });
    KIT.lang.bind(p, 'de');
    const ctx = { heroes: [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Bo' }] };
    return KIT.text.plain('{p1} and {p2} went out.', ctx);
  });
  check(tags === 'VERTAUSCHT: Bo und Ada gingen hinaus.',
    `a translator may reorder the names (${tags})`);

  beat(6, 'an untranslated line is the original, not a blank');
  const fallback = await page.evaluate(() => {
    const ctx = { project: KIT.editor.state.project, world: { save: { heroes: [] } } };
    return KIT.text.plain('Nobody has translated this sentence.', ctx);
  });
  check(fallback === 'Nobody has translated this sentence.', 'it falls through to the source');

  beat(7, 'and the QA list knows exactly what is left');
  const missing = await page.evaluate(() => KIT.lang.missing().length);
  check(missing > 0, `${missing} line(s) were asked for and not found`);

  await page.screenshot({ path: SHOTS + '/languages-panel.png' });

  beat(8, 'nothing broke');
  check(errors.length === 0, `no console errors or page errors${errors.length ? ': ' + errors[0] : ''}`);
  for (const e of errors) log('     ! ' + e);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  try { await run(browser); }
  catch (e) { failures++; log('\nUNCAUGHT: ' + (e && e.stack ? e.stack : e)); }
  await browser.close();
  log(`\nscreenshot: ${SHOTS}/languages-panel.png`);
  if (failures) { log(`\n${failures} check(s) failed`); process.exit(1); }
  log('\nPASS');
})();
