// e2e/rules.js — eat a rule, and the world plays differently.
//
//   NODE_PATH=$(npm root -g) node e2e/rules.js
//
// Rules as entities is the primitive that is easy to claim and hard to prove.
// A unit test can show that a function returns false after another function was
// called; it cannot show that the GAME changed. So this does it the long way
// round, in a browser, on the demo world:
//
//   1. put a rule in the world:  on every step, the floor makes a note
//   2. walk — the note is made
//   3. run `@rule eat floor-remembers` from an ordinary script
//   4. walk — no note is made, and the eating is in the run's history
//   5. reload — the rule is still eaten, because it was in the save and not in
//      a closure somewhere
//   6. open Creator Mode and make a rule with the ＋ New button, because a
//      primitive an author cannot author is not a primitive (ADR-0010)
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
const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

function watch(page) {
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
}

/** Boot, start a game, and stand on the map with nothing talking. */
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

/** One step in whichever direction the hero can actually move. */
async function stepAnywhere(page) {
  const before = await page.evaluate(() => { const h = KIT.game.world.hero(); return [h.x, h.y]; });
  for (const dir of ['right', 'left', 'down', 'up']) {
    await page.keyboard.down(KEY[dir]);
    try {
      await page.waitForFunction(([bx, by]) => {
        const w = KIT.game.world;
        if (!w || !w.map) return true;
        const h = w.hero();
        return h.x !== bx || h.y !== by;
      }, before, { timeout: 1200 });
      return true;
    } catch (e) { /* that way is a wall; try the next */ }
    finally { await page.keyboard.up(KEY[dir]); }
  }
  return false;
}

/** How many times the floor has made a note, and whether the rule still stands. */
const noted = (page) => page.evaluate(() => {
  const save = KIT.game.world.save;
  return {
    notes: KIT.history.count(save, { verb: 'noticed', what: 'a-step' }),
    live: KIT.rules.live(KIT.game.project, save, 'floor-remembers'),
    ate: KIT.history.has(save, { verb: 'ate', what: 'rule:floor-remembers' }),
  };
});

async function run(browser) {
  beat(1, 'a rule goes into the world');
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  watch(page);
  await page.goto(PAGE + '?fast=1');
  check(await playing(page), 'the demo world is up and walkable');

  const put = await page.evaluate(() => {
    // Authored exactly as a project file would author it: a trigger, a
    // condition (none here), and an ordinary command list.
    const cmds = KIT.screenplay.parse('@did noticed what=a-step').commands;
    KIT.game.project.rules['floor-remembers'] = KIT.project.fillRule({
      name: 'The floor remembers', when: 'step', do: cmds,
    }, 'floor-remembers');
    return { when: KIT.game.project.rules['floor-remembers'].when, does: cmds.length };
  });
  check(put.when === 'step' && put.does === 1, `the rule listens for a step and does one thing (${JSON.stringify(put)})`);
  check((await noted(page)).live === true, 'and it is in force');

  beat(2, 'walking makes the note');
  check(await stepAnywhere(page), 'the hero took a step');
  await page.evaluate(() => KIT.game.world.rulesSettled());
  const after = await noted(page);
  check(after.notes >= 1, `the floor noticed (${after.notes})`);

  beat(3, 'a story eats the rule');
  await page.evaluate(async () => {
    const cmds = KIT.screenplay.parse('@rule eat floor-remembers').commands;
    await KIT.interpreter.run(cmds, KIT.game.world.makeCtx(null, 'p1'));
  });
  const eaten = await noted(page);
  check(eaten.live === false, 'the rule is no longer in force');
  check(eaten.ate === true, 'and the eating is in the history, where a later line can ask');

  beat(4, 'and now the world plays differently');
  const before = eaten.notes;
  check(await stepAnywhere(page), 'the hero took another step');
  await page.evaluate(() => KIT.game.world.rulesSettled());
  const quiet = await noted(page);
  check(quiet.notes === before, `the floor no longer notices (still ${quiet.notes})`);
  check(await page.evaluate(() => KIT.game.project.rules['floor-remembers'].on === true),
    'and the project still says what it always said — the change is in the save');
  await page.screenshot({ path: SHOTS + '/rules-eaten.png' });

  beat(5, 'it is eaten after a reload, because it was written down');
  await page.evaluate(() => KIT.game.save());
  await page.reload();
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted, undefined, { timeout: 30000 });
  const cont = await page.$('[data-action="continue"]');
  if (cont && !(await cont.isDisabled())) await cont.click();
  await page.waitForFunction(() => KIT.game.scene() === 'map' && !!KIT.game.world, undefined, { timeout: 15000 }).catch(() => {});
  const reloaded = await page.evaluate(() => {
    const save = KIT.game.world && KIT.game.world.save;
    if (!save) return null;
    // The rule is not in the reloaded project (it was injected into the live one),
    // so what is being checked is the SAVE: it still knows the rule was eaten.
    return { rules: save.rules || {}, ate: KIT.history.has(save, { verb: 'ate', what: 'rule:floor-remembers' }) };
  });
  if (reloaded) {
    check(!!(reloaded.rules['floor-remembers'] && reloaded.rules['floor-remembers'].eaten),
      `the save still says it was eaten (${JSON.stringify(reloaded.rules['floor-remembers'] || null)})`);
    check(reloaded.ate === true, 'and the history came back with it');
  } else check(false, 'the save reloaded');
  await page.close();

  beat(6, 'an author can make one with a button');
  const ed = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  watch(ed);
  await ed.goto(PAGE + '?edit=1&fast=1');
  await ed.waitForFunction(() => window.KIT && KIT.editor && KIT.editor.isOpen && KIT.editor.isOpen(), undefined, { timeout: 30000 });
  await ed.waitForTimeout(500);
  const hasTab = await ed.isVisible('.ed-tab[data-panel="rules"]');
  check(hasTab, 'there is a Rules tab in Creator Mode');
  if (hasTab) {
    const before2 = await ed.evaluate(() => Object.keys(KIT.editor.state.project.rules || {}).length);
    await ed.click('.ed-tab[data-panel="rules"]');
    await ed.waitForTimeout(300);
    await ed.click('.ed-panel-body[data-panel="rules"] button.ed-btn.primary');
    await ed.waitForTimeout(400);
    const made = await ed.evaluate(() => {
      const p = KIT.editor.state.project;
      const ids = Object.keys(p.rules || {});
      const id = ids[ids.length - 1];
      return { n: ids.length, id, rule: id ? p.rules[id] : null, sel: KIT.editor.state.selection, undo: KIT.editor.state.doc.canUndo() };
    });
    check(made.n === before2 + 1, `＋ New made a rule (${before2} → ${made.n})`);
    check(!!made.rule && made.rule.when === 'step', `it starts as something real: on ${made.rule && made.rule.when}`);
    check(made.sel && made.sel.kind === 'rule', 'and it is selected, so the form is open on it');
    check(made.undo === true, 'and it is one undo step, like every other edit');
    const form = await ed.evaluate(() => {
      const body = document.querySelector('.ed-panel-body[data-panel="rules"]');
      return { labels: Array.from(body.querySelectorAll('.ed-f-label')).map(e => e.textContent.trim()).filter(Boolean).slice(0, 14) };
    });
    // The point of reusing the condition and script types: the form for a rule
    // is not hand-built, so if it renders at all it renders the real widgets.
    check(form.labels.length >= 4, `the form came up with real fields (${form.labels.join(' · ')})`);
    await ed.screenshot({ path: SHOTS + '/rules-editor.png' });
  }
  await ed.close();

  beat(7, 'nothing broke');
  check(errors.length === 0, `no console errors or page errors${errors.length ? ': ' + errors[0] : ''}`);
  for (const e of errors) log('     ! ' + e);
}

(async () => {
  const browser = await chromium.launch();
  try { await run(browser); }
  catch (e) { failures++; log('\nUNCAUGHT: ' + (e && e.stack ? e.stack : e)); }
  await browser.close();
  log(`\nscreenshots: ${SHOTS}/rules-*.png`);
  if (failures) { log(`\n${failures} check(s) failed`); process.exit(1); }
  log('\nPASS');
})();
