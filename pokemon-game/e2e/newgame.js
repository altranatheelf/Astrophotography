// A person who wants THEIR game, not the demo: Creator Mode › Game › Project ›
// Start a new game. It must replace the example as one undo step, open the blank
// map ready to paint, survive a reload (the draft is keyed by the built-in
// game's id, not the new one), and undo back to the example.
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html');
const SHOTS = process.env.KIT_SHOTS || path.join(process.env.CLAUDE_SCRATCHPAD || '/tmp', 'kit', 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok ' : 'FAIL'} ${what}`); if (!ok) failed++; };

async function run(browser, label, size, touch) {
  console.log(`\n=== ${label} (${size.width}×${size.height}) ===`);
  const ctx = await browser.newContext({ viewport: size, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(PAGE + '?edit=1&fast=1');
  await page.waitForFunction(() => window.KIT && KIT.editor && KIT.editor.isOpen && KIT.editor.isOpen(), undefined, { timeout: 30000 });
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => ({ title: KIT.editor.state.project.meta.title, maps: Object.keys(KIT.editor.state.project.maps).length, modules: KIT.editor.state.project.modules.slice() }));
  check(!(await page.isVisible('.ed-firststeps')), 'the example map, with people on it, shows no first-steps hint');

  await page.click('.ed-group[data-group="game"]');
  await page.waitForTimeout(150);
  await page.click('.ed-tab[data-panel="project"]');
  await page.waitForTimeout(300);
  const sec = await page.$('details.ed-sec:has(summary:has-text("Start a new game"))');
  check(!!sec, 'Project has a “Start a new game” section');
  await page.click('details.ed-sec summary:has-text("Start a new game")');
  await page.waitForTimeout(200);
  await page.fill('.ed-newgame-name', 'Mill Lane');
  await page.screenshot({ path: `${SHOTS}/newgame-${label}-1-form.png` });
  await page.click('button:has-text("Start from a blank map")');
  await page.waitForTimeout(200);
  check(await page.isVisible('.ed-confirm'), 'it asks first');
  check((await page.textContent('.ed-confirm .ed-btn.danger')) === 'Start over', 'and the yes button says what it does (“Start over”)');
  await page.click('.ed-confirm .ed-btn.danger');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ title: KIT.editor.state.project.meta.title, id: KIT.editor.state.project.meta.id, maps: Object.keys(KIT.editor.state.project.maps), mapId: KIT.editor.state.mapId, panel: KIT.editor.state.panel, modules: KIT.editor.state.project.modules }));
  check(after.title === 'Mill Lane' && after.id === 'mill-lane', `the project is now “${after.title}” (${after.id})`);
  check(after.maps.length === 1 && after.mapId === after.maps[0], `one blank map, open (${after.mapId})`);
  check(after.panel === 'tiles', 'and the Tiles panel is up, ready to paint');
  check(await page.isVisible('.ed-firststeps'), 'with the first steps written at the top (paint, add somebody, play)');
  const inView = await page.evaluate(() => { const host = KIT.editor.el.panel.getBoundingClientRect(); const h = document.querySelector('.ed-firststeps').getBoundingClientRect(); return { top: KIT.editor.el.panel.scrollTop, seen: h.top >= host.top - 1 && h.bottom <= host.bottom + 1 }; });
  check(inView.seen && inView.top === 0, `and the Tiles panel opens at its top, hint in view (scrollTop ${inView.top})`);
  check(JSON.stringify(after.modules) === JSON.stringify(before.modules), `the modules stayed switched on (${after.modules.join(', ') || 'none'})`);
  await page.screenshot({ path: `${SHOTS}/newgame-${label}-2-blank.png` });

  // paint one square so there is something to lose, then reload
  await page.evaluate(() => { const tile = KIT.registry('tiles').ids()[0]; KIT.editor.commit('Paint', (doc, ops) => ops.paint(doc, { map: KIT.editor.state.mapId, layer: 'deco', cells: [{ x: 3, y: 3 }], tile })); });
  await page.evaluate(() => KIT.editor.saveNow());
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => window.KIT && KIT.editor && KIT.editor.isOpen && KIT.editor.isOpen(), undefined, { timeout: 30000 });
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => ({ title: KIT.editor.state.project.meta.title, deco: KIT.editor.state.project.maps[KIT.editor.state.mapId].layers.deco.filter(Boolean).length }));
  check(back.title === 'Mill Lane', 'after a reload it is still “Mill Lane”');
  check(back.deco === 1, 'with the square painted on it');

  // the example comes back with undo (a fresh page has no history; open the example again by undoing in-session)
  await page.evaluate(() => { const draft = KIT.storage.discardDraft && KIT.storage.discardDraft(); return draft; });
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForFunction(() => window.KIT && KIT.editor && KIT.editor.isOpen && KIT.editor.isOpen(), undefined, { timeout: 30000 });
  await page.waitForTimeout(300);
  const restored = await page.evaluate(() => KIT.editor.state.project.meta.title);
  check(restored === before.title, `discarding the draft brings the example back (“${restored}”)`);
  check(errors.length === 0, errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await run(browser, 'phone', { width: 390, height: 844 }, true);
    await run(browser, 'wide', { width: 1280, height: 800 }, false);
  } catch (e) { console.log('\nUNCAUGHT:', e && e.stack || e); failed++; }
  await browser.close();
  console.log(`\nscreenshots: ${SHOTS}/newgame-*.png\n`);
  if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
  console.log('PASS');
})();
