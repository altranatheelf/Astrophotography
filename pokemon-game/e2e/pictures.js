// e2e/pictures.js — a PNG found online, on its own, becomes tiles you can paint
// with and a character you can put on the map, from Creator Mode's Import panel.
//
//   NODE_PATH=$(npm root -g) node e2e/pictures.js
//
// The pictures are generated here (nothing third-party is committed): a 4×2
// tileset sheet whose last square is empty, and a 3×4 walk cycle.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { encodePng } = require('../tools/sprite-png.js');
const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html');
const SHOTS = process.env.KIT_SHOTS || path.join(process.env.CLAUDE_SCRATCHPAD || '/tmp', 'kit', 'shots');
const FIX = path.join(process.env.CLAUDE_SCRATCHPAD || '/tmp', 'kit', 'pictures');
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(FIX, { recursive: true });
let failed = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok ' : 'FAIL'} ${what}`); if (!ok) failed++; };

function makeFixtures() {
  const w = 64, h = 32, rgba = Buffer.alloc(w * h * 4);
  const colors = [[88, 184, 72], [200, 160, 80], [60, 120, 220], [160, 160, 160], [220, 80, 80], [240, 200, 60], [120, 60, 200], null];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = colors[Math.floor(y / 16) * 4 + Math.floor(x / 16)]; const i = (y * w + x) * 4; if (c) { rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255; } }
  fs.writeFileSync(path.join(FIX, 'meadow.png'), encodePng(w, h, rgba));
  const sw = 48, sh = 64, s = Buffer.alloc(sw * sh * 4);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const r = Math.floor(y / 16), c = Math.floor(x / 16); const lx = x % 16, ly = y % 16; const inside = lx > 3 && lx < 12 && ly > 2 && ly < 14; const i = (y * sw + x) * 4; if (inside) { s[i] = 60 + r * 40; s[i + 1] = 120 + c * 30; s[i + 2] = 200 - r * 30; s[i + 3] = 255; } }
  fs.writeFileSync(path.join(FIX, 'walker.png'), encodePng(sw, sh, s));
}

const openPanel = async (page, id) => {
  const g = await page.evaluate((pid) => KIT.editor.groupOf(pid), id);
  await page.click(`.ed-group[data-group="${g}"]`); await page.waitForTimeout(150);
  const chip = await page.$(`.ed-tab[data-panel="${id}"]`);
  if (chip && await chip.isVisible()) await chip.click();
  await page.waitForTimeout(300);
};

async function run(browser, label, size, touch) {
  console.log(`\n=== ${label} (${size.width}×${size.height}) ===`);
  const ctx = await browser.newContext({ viewport: size, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(PAGE + '?edit=1&fast=1');
  await page.waitForFunction(() => window.KIT && KIT.editor && KIT.editor.isOpen && KIT.editor.isOpen(), undefined, { timeout: 30000 });
  await page.waitForTimeout(300);

  // --- 1. a tileset sheet on its own -----------------------------------------------
  await openPanel(page, 'import');
  const tilesBefore = await page.evaluate(() => KIT.registry('tiles').ids().length);
  await page.setInputFiles('.ed-panel-body[data-panel="import"] input[type="file"]', path.join(FIX, 'meadow.png'));
  await page.waitForTimeout(500);
  check(await page.isVisible('.ed-image-slice'), 'dropping a PNG on its own opens the slice form instead of turning it away');
  const guess = await page.evaluate(() => ({ kind: document.querySelector('.ed-image-slice .ed-chip[aria-pressed="true"]').dataset.kind, tile: document.querySelector('.ed-image-slice input[aria-label="Tile size"]').value }));
  check(guess.kind === 'tiles' && guess.tile === '16', `it guessed a tileset of 16px squares (${guess.kind}, ${guess.tile})`);
  await page.screenshot({ path: `${SHOTS}/pictures-${label}-1-slice.png` });
  await page.click('.ed-image-slice button:has-text("Cut it up")');
  await page.waitForTimeout(800);
  const reportText = await page.textContent('.ed-import-report');
  check(/7 tiles/.test(reportText), `the report counts seven tiles (the empty square was left out): “${reportText.replace(/\s+/g, ' ').slice(0, 90)}”`);
  await page.click('.ed-import-report button:has-text("Import")');
  await page.waitForTimeout(600);
  const tilesAfter = await page.evaluate(() => ({ n: KIT.registry('tiles').ids().length, has: KIT.registry('tiles').has('meadow:5'), groups: KIT.registry('tiles').groups().map(g => g.group) }));
  check(tilesAfter.n === tilesBefore + 7 && tilesAfter.has, `seven tiles joined the palette (${tilesBefore} → ${tilesAfter.n})`);
  check(tilesAfter.groups.includes('meadow'), `in their own palette group “meadow” (${tilesAfter.groups.join(', ')})`);

  // --- 2. paint with one and play on it -----------------------------------------------
  await openPanel(page, 'tiles');
  await page.click('.ed-panel-body[data-panel="tiles"] .ed-subtabs .ed-tab:has-text("meadow")');
  await page.waitForTimeout(250);
  const swatch = await page.$('.ed-palette [data-tile="meadow:5"]');
  check(!!swatch, 'the imported tiles are in the palette');
  // a square with nothing drawn over it, so the ground IS the picture
  const spot = await page.evaluate(() => {
    const m = KIT.editor.state.map, p = KIT.editor.state.project.maps[KIT.editor.state.mapId];
    const at = (layer, x, y) => p.layers[layer][y * p.width + x];
    for (let y = 3; y < p.height - 1; y++) for (let x = 1; x < p.width - 1; x++) {
      if (at('deco', x, y) || at('above', x, y)) continue;
      if ((m.objects || []).some(o => o.x === x && o.y === y)) continue;
      return { x, y };
    }
    return null;
  });
  check(!!spot, `found a bare square to paint (${spot && spot.x},${spot && spot.y})`);
  await page.evaluate((s) => { KIT.editor.set({ layer: 'ground', tile: 'meadow:5', tool: 'pencil' }); KIT.editor.commit('Paint', (doc, ops) => ops.paint(doc, { map: KIT.editor.state.mapId, layer: 'ground', cells: [s], tile: 'meadow:5' })); }, spot);
  await page.waitForTimeout(300);
  const painted = await page.evaluate((s) => KIT.editor.state.project.maps[KIT.editor.state.mapId].layers.ground[s.y * KIT.editor.state.project.maps[KIT.editor.state.mapId].width + s.x], spot);
  check(painted === 'meadow:5', `a square painted with it reads ${painted}`);
  const pixel = await page.evaluate((s) => { const px = KIT.editor.tilePixels(); const v = KIT.editor.state.view; const cv = KIT.editor.el.canvas; const c = cv.getContext('2d'); const x = Math.round((s.x - v.x) * px + px / 2), y = Math.round((s.y - v.y) * px + px / 2); const d = c.getImageData(x * (cv.width / cv.clientWidth), y * (cv.height / cv.clientHeight), 1, 1).data; return Array.from(d); }, spot);
  check(pixel[0] > 200 && pixel[1] > 150 && pixel[2] < 120, `and it draws in the sheet's real colours on the map (rgb ${pixel.slice(0, 3).join(',')})`);
  await page.screenshot({ path: `${SHOTS}/pictures-${label}-2-painted.png` });

  // --- 3. a character sheet on its own --------------------------------------------------
  await openPanel(page, 'import');
  await page.setInputFiles('.ed-panel-body[data-panel="import"] input[type="file"]', path.join(FIX, 'walker.png'));
  await page.waitForTimeout(500);
  const g2 = await page.evaluate(() => ({ kind: document.querySelector('.ed-image-slice .ed-chip[aria-pressed="true"]').dataset.kind, cols: document.querySelector('.ed-image-slice input[aria-label="Columns"]').value, rows: document.querySelector('.ed-image-slice input[aria-label="Rows"]').value }));
  check(g2.kind === 'sprite' && g2.cols === '3' && g2.rows === '4', `a 48×64 sheet is guessed to be a character, 3 frames × 4 directions (${g2.kind} ${g2.cols}×${g2.rows})`);
  await page.click('.ed-image-slice button:has-text("Cut it up")');
  await page.waitForTimeout(600);
  await page.click('.ed-import-report button:has-text("Import")');
  await page.waitForTimeout(600);
  const sprite = await page.evaluate(() => { const s = KIT.registry('sprites').get('walker'); return s ? { dirs: Object.keys(s.frames || {}), w: s.w, h: s.h } : null; });
  check(!!sprite && sprite.dirs.length === 4 && sprite.w === 16, `“walker” is a sprite with four directions (${sprite && sprite.dirs.join(',')})`);
  await page.evaluate(() => KIT.editor.commit('Place walker', (doc, ops) => {
    const m = KIT.editor.state.mapId;
    const id = [].concat(ops.placeObject(doc, { map: m, type: 'npc', name: 'Walker', x: 4, y: 4 }))[0];
    const i = doc.get(['maps', m, 'objects']).findIndex(o => o.id === id);
    doc.set(['maps', m, 'objects', i, 'pages', 0, 'sprite'], 'walker');           // the sprite that came from the PNG
  }));
  await page.waitForTimeout(300);
  await page.evaluate(() => { KIT.editor.playHere({ at: { x: 4, y: 5 } }); });   // not awaited: it resolves when the run ends
  await page.waitForFunction(() => KIT.game.scene() === 'map' && !KIT.game.world.busy, undefined, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const drawn = await page.evaluate(() => { const w = KIT.game.world; const e = w.entities.find(x => x.id && /walker/.test(x.id)); return e ? { sprite: e.sprite, visible: e.visible } : null; });
  check(!!drawn && drawn.sprite === 'walker' && drawn.visible, 'the walker stands on the map in play, drawn from the imported sheet');
  await page.screenshot({ path: `${SHOTS}/pictures-${label}-3-walker.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(errors.length === 0, errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
  await ctx.close();
}

(async () => {
  makeFixtures();
  const browser = await chromium.launch();
  try {
    await run(browser, 'phone', { width: 390, height: 844 }, true);
    await run(browser, 'wide', { width: 1280, height: 800 }, false);
  } catch (e) { console.log('\nUNCAUGHT:', e && e.stack || e); failed++; }
  await browser.close();
  console.log(`\nscreenshots: ${SHOTS}/pictures-*.png\n`);
  if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
  console.log('PASS');
})();
