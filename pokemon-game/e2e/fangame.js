// e2e/fangame.js — the first hour of a Pokémon-style fan game, made entirely in
// Creator Mode from a blank map, with a tileset "found online" (generated here):
//
//   Start a new game → import a PNG tileset → paint a town → a second map (the
//   route) → a way through between them → tall grass and an encounter table on
//   the route → Play here, walk across the connection, meet somebody in the grass.
//
//   NODE_PATH=$(npm root -g) node e2e/fangame.js
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { encodePng } = require('../tools/sprite-png.js');
const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html');
const SHOTS = process.env.KIT_SHOTS || path.join(process.env.CLAUDE_SCRATCHPAD || '/tmp', 'kit', 'shots');
const FIX = path.join(process.env.CLAUDE_SCRATCHPAD || '/tmp', 'kit', 'fangame');
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(FIX, { recursive: true });
let failed = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok ' : 'FAIL'} ${what}`); if (!ok) failed++; };
const beat = (n, what) => console.log(`\n--- ${n}. ${what} ---`);

function makeTileset() {
  // 4×1: grass, path, tall grass (a darker green), water — 16px each
  const w = 64, h = 16, rgba = Buffer.alloc(w * h * 4);
  const colors = [[96, 190, 80], [214, 186, 120], [56, 140, 60], [70, 130, 220]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = colors[Math.floor(x / 16)]; const i = (y * w + x) * 4; const shade = ((x + y) % 4 === 0) ? 12 : 0; rgba[i] = c[0] - shade; rgba[i + 1] = c[1] - shade; rgba[i + 2] = c[2] - shade; rgba[i + 3] = 255; }
  fs.writeFileSync(path.join(FIX, 'region.png'), encodePng(w, h, rgba));
}
const openPanel = async (page, id) => {
  const g = await page.evaluate((pid) => KIT.editor.groupOf(pid), id);
  await page.click(`.ed-group[data-group="${g}"]`); await page.waitForTimeout(150);
  const chip = await page.$(`.ed-tab[data-panel="${id}"]`);
  if (chip && await chip.isVisible()) await chip.click();
  await page.waitForTimeout(300);
};
const settle = (page) => page.waitForFunction(() => KIT.game.scene() === 'map' && KIT.game.world && !KIT.game.world.busy, undefined, { timeout: 8000 }).catch(() => {});
async function stepOnce(page, dir) {
  await page.evaluate((d) => KIT.game.world.move(0, d), dir);
  await page.waitForTimeout(260);
}

async function run(browser, label, size, touch) {
  console.log(`\n=== ${label} (${size.width}×${size.height}) ===`);
  const ctx = await browser.newContext({ viewport: size, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(PAGE + '?edit=1&fast=1');
  await page.waitForFunction(() => window.KIT && KIT.editor && KIT.editor.isOpen && KIT.editor.isOpen(), undefined, { timeout: 30000 });
  await page.waitForTimeout(300);

  beat(1, 'a blank game with my title on it');
  await openPanel(page, 'project');
  await page.click('details.ed-sec summary:has-text("Start a new game")');
  await page.waitForTimeout(150);
  await page.fill('.ed-newgame-name', 'Region Aster');
  await page.click('.ed-panel-body[data-panel="project"] button:has-text("A blank map")');
  await page.waitForTimeout(200);
  await page.click('.ed-confirm .ed-btn.danger');
  await page.waitForTimeout(500);
  const fresh = await page.evaluate(() => ({ title: KIT.editor.state.project.meta.title, maps: Object.keys(KIT.editor.state.project.maps), mons: (KIT.editor.state.project.modules || []).includes('mons') }));
  check(fresh.title === 'Region Aster' && fresh.maps.length === 1, `“${fresh.title}” with one blank map (${fresh.maps.join(',')})`);
  check(fresh.mons, 'and the Pokémon-style module is still on');

  beat(2, 'a tileset found online, dropped in as a PNG');
  await openPanel(page, 'import');
  await page.setInputFiles('.ed-panel-body[data-panel="import"] input[type="file"]', path.join(FIX, 'region.png'));
  await page.waitForTimeout(500);
  await page.click('.ed-image-slice button:has-text("Cut it up")');
  await page.waitForTimeout(700);
  await page.click('.ed-import-report button:has-text("Import")');
  await page.waitForTimeout(600);
  check(await page.evaluate(() => KIT.registry('tiles').has('region:2')), 'its squares are tiles now');

  beat(3, 'the town: painted with them, with the start on it');
  const town = fresh.maps[0];
  await openPanel(page, 'tiles');
  await page.evaluate((m) => {
    const p = KIT.editor.state.project.maps[m];
    const all = []; for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) all.push({ x, y });
    KIT.editor.commit('Paint the town', (doc, ops) => {
      ops.paint(doc, { map: m, layer: 'ground', cells: all, tile: 'region:0' });
      ops.paint(doc, { map: m, layer: 'ground', cells: all.filter(c => c.y === 5), tile: 'region:1' });   // a path east
    });
  }, town);
  await page.waitForTimeout(300);
  await openPanel(page, 'map');
  await page.fill('.ed-panel-body[data-panel="map"] input[aria-label="Name"], .ed-panel-body[data-panel="map"] .ed-f[data-key="name"] input', 'Aster Town');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  check((await page.evaluate((m) => KIT.editor.state.project.maps[m].name, town)) === 'Aster Town', 'the map is named Aster Town');
  await page.screenshot({ path: `${SHOTS}/fangame-${label}-1-town.png` });

  beat(4, 'a route to the east, and a way through');
  await page.click('.ed-panel-body[data-panel="map"] button:has-text("New map")');
  await page.waitForTimeout(500);
  const route = await page.evaluate(() => KIT.editor.state.mapId);
  check(route !== town, `a second map is open (${route})`);
  await page.evaluate((m) => {
    const p = KIT.editor.state.project.maps[m];
    const all = []; for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) all.push({ x, y });
    KIT.editor.commit('Paint the route', (doc, ops) => {
      ops.paint(doc, { map: m, layer: 'ground', cells: all, tile: 'region:0' });
      ops.paint(doc, { map: m, layer: 'ground', cells: all.filter(c => c.x >= 3 && c.x <= 6 && c.y >= 3 && c.y <= 7), tile: 'region:2' });
      ops.paint(doc, { map: m, layer: 'collision', cells: all.filter(c => c.x >= 3 && c.x <= 6 && c.y >= 3 && c.y <= 7), tile: 'g' });   // tall grass over the darker squares
    });
  }, route);
  await page.waitForTimeout(300);
  // back on the town, connect its east edge to the route
  await page.evaluate((m) => KIT.editor.openMap(m), town);
  await page.waitForTimeout(300);
  await openPanel(page, 'map');
  const connSummary = await page.$('details.ed-sec summary:has-text("next door"), details.ed-sec summary:has-text("Connections"), details.ed-sec summary:has-text("way through")');
  if (connSummary && !(await page.evaluate((el) => el.parentElement.open, connSummary))) { await connSummary.click(); await page.waitForTimeout(200); }
  const addRow = await page.$('.ed-panel-body[data-panel="map"] button:has-text("Add a way through")');
  check(!!addRow, 'the Map panel offers “Add a way through”');
  if (addRow) {
    const row = await addRow.evaluateHandle(el => el.parentElement);
    await (await row.$('select')).selectOption('e');
    await (await row.$$('select'))[1].selectOption(route);
    await addRow.click();
    await page.waitForTimeout(400);
  }
  const conns = await page.evaluate(() => (KIT.editor.state.project.world.connections || []).map(c => `${c.a}-${c.side}-${c.b}`));
  check(conns.includes(`${town}-e-${route}`), `the town's east edge leads to the route (${conns.join(' ') || 'nothing'})`);

  beat(5, 'somebody lives in the tall grass');
  await page.evaluate((m) => KIT.editor.openMap(m), route);
  await page.waitForTimeout(300);
  await openPanel(page, 'mons-encounters');
  const rate = await page.$('.ed-panel-body[data-panel="mons-encounters"] input[type="range"]');
  check(!!rate, 'the Encounters panel is there for this map');
  if (rate) {
    await rate.evaluate((el) => { el.value = '60'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(300);
    const sel = await page.$('.ed-panel-body[data-panel="mons-encounters"] select');
    const first = await sel.evaluate(el => el.options[0] && el.options[0].value);
    await page.click('.ed-panel-body[data-panel="mons-encounters"] button:has-text("Add")');
    await page.waitForTimeout(300);
    const table = await page.evaluate((m) => KIT.editor.state.project.maps[m].props.encounters, route);
    check(!!table && table.rate === 60 && table.byRegion && table.byRegion[0] && table.byRegion[0][0].id === first, `the route's table has ${first} at rate ${table && table.rate}`);
  }
  await page.screenshot({ path: `${SHOTS}/fangame-${label}-2-route.png` });

  beat(6, 'play it: walk from the town into the route and into the grass');
  await page.evaluate((m) => KIT.editor.openMap(m), town);
  await page.waitForTimeout(200);
  const width = await page.evaluate((m) => KIT.editor.state.project.maps[m].width, town);
  await page.evaluate((x) => { KIT.editor.playHere({ at: { x, y: 5 } }); }, width - 1);
  await settle(page);
  await page.waitForTimeout(400);
  check((await page.evaluate(() => KIT.game.world.map.id)) === town, 'playing, standing at the town’s east edge');
  await stepOnce(page, 'right');
  await settle(page);
  await page.waitForTimeout(300);
  check((await page.evaluate(() => KIT.game.world.map.id)) === route, 'one step east and we are on the route');
  await page.screenshot({ path: `${SHOTS}/fangame-${label}-3-route-play.png` });
  // walk to the grass (x 3..6, y 3..7) and pace inside it until somebody turns up
  const hero = await page.evaluate(() => { const h = KIT.game.world.hero(); return { x: h.x, y: h.y }; });
  for (let i = 0; i < Math.abs(hero.y - 5); i++) await stepOnce(page, hero.y > 5 ? 'up' : 'down');
  for (let i = 0; i < Math.abs(hero.x - 4); i++) await stepOnce(page, hero.x > 4 ? 'left' : 'right');
  let met = null;
  for (let tries = 0; tries < 30 && !met; tries++) {
    await stepOnce(page, tries % 2 ? 'right' : 'left');
    const top = await page.evaluate(() => (KIT.scenes.top() || {}).id);
    if (top === 'mons-catch') met = await page.evaluate(() => KIT.scenes.top().params.species);
  }
  check(!!met, `a step in the painted grass met ${met || 'nobody'}`);
  await page.screenshot({ path: `${SHOTS}/fangame-${label}-4-met.png` });
  check(errors.length === 0, errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
  await ctx.close();
}

(async () => {
  makeTileset();
  const browser = await chromium.launch();
  try {
    await run(browser, 'phone', { width: 390, height: 844 }, true);
    await run(browser, 'wide', { width: 1280, height: 800 }, false);
  } catch (e) { console.log('\nUNCAUGHT:', e && e.stack || e); failed++; }
  await browser.close();
  console.log(`\nscreenshots: ${SHOTS}/fangame-*.png\n`);
  if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
  console.log('PASS');
})();
