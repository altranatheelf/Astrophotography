// e2e/editor.js — the Creator Mode play-through.
//
//   NODE_PATH=$(npm root -g) node e2e/editor.js
//
// Runs Creator Mode twice — a laptop (1280×800) and a phone (390×844, touch) —
// through the whole loop the author lives in: open ?edit=1 → paint a few
// squares with the Pencil → Fill an area → Undo twice and check the map is
// exactly as it was → place an NPC from a preset → give it a line in the script
// editor's Text view → switch to Cards and back → Play here → talk to the NPC
// and read the line → back to Creator Mode → the line is still there → reload
// the page and the draft is still there.
//
// It fails on any console error or page error, screenshots every panel into
// SHOTS for a human to look at, and prints PASS when everything held.
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html');
const SHOTS = process.env.KIT_SHOTS ||
  '/tmp/claude-0/-home-user-Astrophotography/19812bb4-4e6f-5d04-84c2-78d4b1a8e91f/scratchpad/kit/shots';

// The Google font is fetched from the network; in a sandbox that fails and the
// only thing lost is the typeface. Nothing else may appear on the console.
const IGNORE = /fonts\.googleapis|fonts\.gstatic|ERR_CERT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_FAILED.*fonts/i;

const CARDS_TAB = '.ed-script-views button:nth-child(1)';
const TEXT_TAB = '.ed-script-views button:nth-child(2)';
// The panels the kit itself ships. Modules add their own (the demo enables mons
// and home, which bring one each), so the check is "every kit panel is there",
// not "there are exactly this many tabs".
const PANELS = ['tiles', 'objects', 'script', 'scripts', 'fragments', 'dialogue', 'map',
  'project', 'vars', 'rules', 'items', 'strings', 'problems', 'data', 'import'];

let failures = 0;
const log = (...a) => console.log(...a);
function check(ok, what) {
  if (ok) log('  ok  ' + what);
  else { failures++; log('  FAIL ' + what); }
  return ok;
}
async function expect(page, fn, what, arg, timeout) {
  try { await page.waitForFunction(fn, arg, { timeout: timeout || 6000 }); return check(true, what); }
  catch (e) { return check(false, what + '  (timed out)'); }
}

// ---- in-page helpers ------------------------------------------------------------
const state = (page) => page.evaluate(() => {
  const st = KIT.editor.state;
  return { mapId: st.mapId, panel: st.panel, tool: st.tool, layer: st.layer, tile: st.tile, mode: st.mode, scale: st.view.scale };
});
/** The whole ground layer of a map, to compare before and after an undo. */
const ground = (page, mapId) => page.evaluate((id) => {
  const m = KIT.editor.state.project.maps[id || KIT.editor.state.mapId];
  return m.layers.ground.slice();
}, mapId);
const objects = (page) => page.evaluate(() => {
  const st = KIT.editor.state;
  return (st.project.maps[st.mapId].objects || []).map(o => ({ id: o.id, name: o.name, type: o.type, x: o.x, y: o.y }));
});

/** Where a map square is on screen right now (the overlay's own maths, in reverse). */
const screenOf = (page, tx, ty) => page.evaluate(([x, y]) => {
  const ed = KIT.editor;
  const r = ed.el.canvas.getBoundingClientRect();
  const px = ed.tilePixels();
  return { x: r.left + (x - ed.state.view.x + 0.5) * px, y: r.top + (y - ed.state.view.y + 0.5) * px };
}, [tx, ty]);

/**
 * The colour drawn at the centre of a map square, off the editor's own canvas.
 * The editor used to throw away every baked tile layer on every commit, so
 * anything it drew was fresh by accident. Now a commit repaints exactly the
 * cells the document says changed — which is only right if the cell index
 * turns back into the right x,y. A pixel is the only witness to that.
 */
const tilePixel = (page, tx, ty) => page.evaluate(([x, y]) => {
  const ed = KIT.editor;
  const cv = ed.el.canvas;
  const px = ed.tilePixels() * (window.devicePixelRatio || 1);
  const cx = Math.floor((x - ed.state.view.x + 0.5) * px), cy = Math.floor((y - ed.state.view.y + 0.5) * px);
  const d = cv.getContext('2d').getImageData(cx, cy, 1, 1).data;
  return [d[0], d[1], d[2]];
}, [tx, ty]);
const differs = (a, b) => !!a && !!b && (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) > 24;

/** Tap one square on the map, the way a finger does. */
async function tapTile(page, tx, ty) {
  const p = await screenOf(page, tx, ty);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(90);
}
/** Drag across several squares in one stroke (one undo step). */
async function strokeTiles(page, cells) {
  const first = await screenOf(page, cells[0][0], cells[0][1]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const [x, y] of cells.slice(1)) {
    const p = await screenOf(page, x, y);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/** Press A until the messages on screen are done (the map's On Enter scene, say). */
async function clearMessages(page, limit) {
  for (let i = 0; i < (limit || 12); i++) {
    const ids = await page.evaluate(() => KIT.scenes.ids());
    if (!ids.some(id => id === 'dialogue' || id === 'chapter' || id === 'choice')) break;
    await page.keyboard.press('z');
    await page.waitForTimeout(220);
  }
  await page.waitForFunction(() => !(KIT.game.world && KIT.game.world.busy), undefined, { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(150);
}

/** Open a panel the way a person does: its group first, then the chip. */
const openPanel = async (page, id) => {
  const group = await page.evaluate((pid) => KIT.editor.groupOf(pid), id);
  await page.click(`.ed-group[data-group="${group}"]`);
  await page.waitForTimeout(120);
  // a one-panel group hides its chip row and opens the panel itself
  const chip = await page.$(`.ed-tab[data-panel="${id}"]`);
  if (chip && await chip.isVisible()) await chip.click();
  await page.waitForTimeout(250);
};
/** Every panel tab, across all four groups, in order. */
const allTabs = async (page) => {
  const out = [];
  for (const g of await page.evaluate(() => KIT.editor.groups().map(x => x.id))) {
    await page.click(`.ed-group[data-group="${g}"]`);
    await page.waitForTimeout(80);
    // a one-panel group hides its chip row; the panel is still there
    const ids = await page.$$eval('.ed-tabs > .ed-tab', els => els.map(e => e.dataset.panel));
    out.push(...(ids.length ? ids : await page.evaluate((gg) => KIT.editor.panelsOf(gg), g)));
  }
  return out;
};
const shot = (page, label, name) => page.screenshot({ path: `${SHOTS}/editor-${label}-${name}.png` });

/** A free square: nothing solid, no event, and the square below it free too (to stand on). */
const freeSpot = (page) => page.evaluate(() => {
  const st = KIT.editor.state, m = st.map;
  const taken = (x, y) => (m.objects || []).some(o => o.x === x && o.y === y);
  for (let y = 2; y < m.height - 2; y++) {
    for (let x = 1; x < m.width - 1; x++) {
      if (taken(x, y) || taken(x, y + 1)) continue;
      if (m.flagsAt(x, y).solid || m.flagsAt(x, y + 1).solid) continue;
      return { x, y };
    }
  }
  return null;
});

// ---- the run ---------------------------------------------------------------------
async function run(browser, label, size, opts) {
  log(`\n=== ${label} (${size.width}×${size.height}) ===`);
  const context = await browser.newContext({
    viewport: size, hasTouch: !!opts.touch, isMobile: !!opts.touch, deviceScaleFactor: opts.dpr || 1,
  });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));

  // --- 1. ?edit=1 opens Creator Mode on the current map -------------------------
  await page.goto(PAGE + '?edit=1&fast=1');
  await page.waitForFunction(() => window.KIT && KIT.editor && KIT.editor.isOpen && KIT.editor.isOpen(), undefined, { timeout: 15000 });
  await page.waitForTimeout(600);
  const st0 = await state(page);
  check(!!st0.mapId, `Creator Mode opened on “${st0.mapId}”`);
  check(await page.isVisible('.ed-toolbar'), 'the toolbar is there');
  check(await page.isVisible('.ed-groups'), 'the four groups are there');
  const groupIds = await page.$$eval('.ed-groups > .ed-group', els => els.map(e => e.dataset.group));
  check(groupIds.join(',') === 'map,story,game,problems', `Map · Story · Game · Problems (${groupIds.join(', ')})`);
  const tabIds = await allTabs(page);
  const missingTabs = PANELS.filter(id => !tabIds.includes(id));
  const extraTabs = tabIds.filter(id => !PANELS.includes(id));
  check(missingTabs.length === 0,
    `all ${PANELS.length} kit panels are listed${missingTabs.length ? ' (missing ' + missingTabs.join(', ') + ')' : ''}` +
    (extraTabs.length ? ` · plus the module panel(s) ${extraTabs.join(', ')}` : ''));
  const startMap = await page.evaluate(() => KIT.game.project.start.map);
  check(st0.mapId === startMap, `it opened the map the game starts on (${startMap})`);
  await shot(page, label, '01-open');

  // --- 2. paint a few squares with the Pencil -----------------------------------
  const before = await ground(page);
  await openPanel(page, 'tiles');
  // Pick a tile from the palette that is not already under the brush.
  const picked = await page.evaluate(() => {
    const swatches = Array.from(document.querySelectorAll('.ed-palette .ed-swatch[data-tile]'));
    const want = swatches.find(b => b.dataset.tile && b.dataset.tile !== KIT.editor.state.tile);
    if (want) want.click();
    return KIT.editor.state.tile;
  });
  check(!!picked, `picked “${picked}” in the Tiles palette`);
  await page.click('.ed-tool[data-tool="pencil"]');
  await page.waitForTimeout(120);
  const spot = await freeSpot(page);
  check(!!spot, `found somewhere to paint (${spot && spot.x},${spot && spot.y})`);
  // Three squares in a row with nothing drawn over them, so a change to the
  // ground is a change to the picture. The first version painted row 1, which in
  // this house is furniture on floor: the document changed, the pixels could
  // not, and the witness said the repaint was broken when the stroke was merely
  // hidden. Rows 0–2 are avoided so the Fill step below starts where it always did.
  const { cells, control } = await page.evaluate(() => {
    const v = KIT.editor.state.map;
    const open = (x, y) => v.tileAt('deco', x, y) == null && v.tileAt('above', x, y) == null;
    for (let y = 3; y < v.height; y++) for (let x = 1; x + 4 < v.width; x++) {
      if (open(x, y) && open(x + 1, y) && open(x + 2, y) && open(x + 4, y)) return { cells: [[x, y], [x + 1, y], [x + 2, y]], control: [x + 4, y] };
    }
    return { cells: [[1, 1], [2, 1], [3, 1]], control: [6, 1] };
  });
  const pixelsBefore = { cells: [], control: await tilePixel(page, control[0], control[1]) };
  for (const [x, y] of cells) pixelsBefore.cells.push(await tilePixel(page, x, y));
  await strokeTiles(page, cells);
  await page.waitForTimeout(120);                            // the repaint is a frame away
  const afterPaint = await ground(page);
  const w = await page.evaluate(() => KIT.editor.state.map.width);
  const painted = cells.filter(([x, y]) => afterPaint[y * w + x] === picked).length;
  check(painted === cells.length, `the Pencil painted ${painted}/${cells.length} squares with “${picked}”`);
  // The document changed AND the picture changed, in the right places: the
  // baked layer was repainted for the cells the stroke touched and left alone
  // for the one it did not.
  let repainted = 0;
  for (let i = 0; i < cells.length; i++) if (differs(pixelsBefore.cells[i], await tilePixel(page, cells[i][0], cells[i][1]))) repainted++;
  check(repainted === cells.length, `the canvas shows the stroke (${repainted}/${cells.length} squares look different)`);
  check(!differs(pixelsBefore.control, await tilePixel(page, control[0], control[1])), 'and a square the stroke never touched looks the same');
  check(await page.evaluate(() => KIT.editor.state.doc.canUndo()), 'the stroke can be undone');
  await shot(page, label, '02-painted');

  // --- 3. fill an area ------------------------------------------------------------
  await page.click('.ed-tool[data-tool="fill"]');
  await page.waitForTimeout(120);
  const fillAt = { x: 1, y: 2 };
  const wasThere = await page.evaluate(([x, y]) => {
    const m = KIT.editor.state.project.maps[KIT.editor.state.mapId];
    return m.layers.ground[y * m.width + x];
  }, [fillAt.x, fillAt.y]);
  await tapTile(page, fillAt.x, fillAt.y);
  await page.waitForTimeout(250);
  const afterFill = await ground(page);
  const grew = afterFill.filter(t => t === picked).length - afterPaint.filter(t => t === picked).length;
  check(grew > 0, `Fill turned ${grew} more square(s) from “${wasThere}” into “${picked}”`);
  await shot(page, label, '03-filled');

  // --- 4. undo twice: the map is exactly as it was --------------------------------
  await page.click('[title^="Undo"]');
  await page.waitForTimeout(200);
  await page.click('[title^="Undo"]');
  await page.waitForTimeout(300);
  const afterUndo = await ground(page);
  check(JSON.stringify(afterUndo) === JSON.stringify(before), 'two undos put every square back the way it was');
  await shot(page, label, '04-undone');

  // --- 5. place an NPC from a preset ------------------------------------------------
  await openPanel(page, 'objects');
  check((await state(page)).tool === 'select', 'opening Events hands the pointer to Move, so a tap picks an event instead of painting');
  const eventsBefore = (await objects(page)).length;
  await page.click('.ed-obj-head .ed-btn.primary');            // ＋ Add
  await page.waitForTimeout(200);
  await shot(page, label, '05-add');
  const npcChip = await page.$('.ed-chip.is-preset:has-text("NPC")');
  check(!!npcChip, 'the NPC preset is offered');
  await npcChip.click();
  await page.waitForTimeout(250);
  // The preset asks for a name and a line before it is placed.
  await page.fill('.ed-preset-form input[type="text"]', 'Rosie');
  await page.waitForTimeout(500);
  await shot(page, label, '06-preset-form');
  await page.click('.ed-preset-form .ed-btn.primary');         // ✛ Place it on the map
  await page.waitForTimeout(200);
  // the cue for the next tap is on screen: the editor's own pill, and a standing line in the status bar
  check(await page.isVisible('.ed-toast'), `“${(await page.textContent('.ed-toast').catch(() => '')).trim()}” is shown as a pill over the editor`);
  check(/Tap the map/.test(await page.textContent('.ed-status')), 'and the status bar says to tap the map until you do');
  await tapTile(page, spot.x, spot.y);
  await page.waitForTimeout(400);
  const events = await objects(page);
  const rosie = events.find(o => o.name === 'Rosie');
  check(!!rosie, `the NPC “Rosie” is on the map at ${rosie && rosie.x},${rosie && rosie.y} (${eventsBefore} → ${events.length} events)`);
  check(await page.isVisible('.ed-obj-detail'), 'the new event opened in the inspector');
  await shot(page, label, '07-npc');

  // --- 6. a line of dialogue, written in the script editor's Text view ----------------
  const LINE = 'Welcome to the festival!';
  const slot = await page.$('.ed-slot:has-text("On Interact") .ed-btn');
  check(!!slot, 'the event has an On Interact slot to open');
  await slot.click();
  await page.waitForTimeout(400);
  check((await state(page)).panel === 'script', 'Open ✎ switched to the Script panel');
  // the Add row opens ONE picker (the last card's "＋ after this one" shares its index)
  await page.click(CARDS_TAB);
  await page.waitForTimeout(200);
  await page.click('.ed-cmd-add .ed-btn');
  await page.waitForTimeout(250);
  const pickers = await page.$$eval('.ed-cmd-picker', els => els.length);
  check(pickers === 1, `＋ Add command opens one command picker (${pickers})`);
  await page.click('.ed-cmd-add .ed-btn');                     // ✕ Close
  await page.waitForTimeout(200);
  await page.click(TEXT_TAB);
  await page.waitForTimeout(250);
  await page.fill('.ed-screenplay', `Rosie: ${LINE}`);
  await page.waitForTimeout(150);
  await page.click('[title="Read this back into the cards"]');  // Apply
  await page.waitForTimeout(400);
  const said = await page.evaluate(() => {
    const st = KIT.editor.state;
    const obj = (st.project.maps[st.mapId].objects || []).find(o => o.name === 'Rosie');
    const cmds = (((obj || {}).pages || [])[0] || {}).on || {};
    return (cmds.interact || []).map(c => `${c.t}:${c.text || ''}`);
  });
  check(said.some(s => s === `say:${LINE}`), `the script now says “${LINE}” (${said.join(' / ')})`);
  await shot(page, label, '08-script-text');

  // cards and back
  await page.click(CARDS_TAB);
  await page.waitForTimeout(300);
  const cardText = await page.textContent('.ed-cmd-sum').catch(() => '');
  check(/festival/i.test(cardText || ''), `the Cards view shows the same line (“${(cardText || '').slice(0, 40)}”)`);
  await shot(page, label, '09-script-cards');
  await page.click(TEXT_TAB);
  await page.waitForTimeout(300);
  const backText = await page.inputValue('.ed-screenplay');
  check(/festival/i.test(backText), 'switching back to Text shows the screenplay again');
  await page.click(CARDS_TAB);
  await page.waitForTimeout(200);
  check((await state(page)).mode === 'edit', 'writing the line never left Creator Mode');

  // --- 7. Play here: talk to the NPC and read the line ---------------------------------
  await page.evaluate(([x, y]) => KIT.editor.set({ cursor: { x, y: y + 1 } }), [rosie.x, rosie.y]);
  await page.click('[title^="Play from the cursor"]');
  await expect(page, () => KIT.editor.state.mode === 'play' && !!(KIT.game.world && KIT.game.world.map), 'Play here starts the game');
  await page.waitForTimeout(700);
  await shot(page, label, '10-playing');
  await clearMessages(page);                                    // the map's own On Enter scene
  const standing = await page.evaluate(() => { const h = KIT.game.world.hero(); return { x: h.x, y: h.y }; });
  check(standing.x === rosie.x && standing.y === rosie.y + 1, `the game started at the cursor, next to the NPC (${standing.x},${standing.y})`);
  await page.keyboard.down('ArrowUp');                          // face the NPC
  await page.waitForTimeout(120);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(250);
  await page.keyboard.press('z');
  await expect(page, () => KIT.scenes.ids().includes('dialogue'), 'talking to the NPC opens a message');
  const shown = await page.textContent('#dialogue .kit-text').catch(() => '');
  check(/festival/i.test(shown || ''), `the NPC says the line we wrote (“${(shown || '').trim().slice(0, 40)}”)`);
  await shot(page, label, '11-talking');

  // --- 8. back to Creator Mode, with the edit still there --------------------------------
  await page.keyboard.press('Escape');
  await expect(page, () => KIT.editor.state.mode === 'edit', 'Escape comes back to Creator Mode');
  await page.waitForTimeout(400);
  const stillThere = await page.evaluate(() => {
    const st = KIT.editor.state;
    const obj = (st.project.maps[st.mapId].objects || []).find(o => o.name === 'Rosie');
    return obj ? ((((obj.pages || [])[0] || {}).on || {}).interact || []).map(c => c.text).join('') : '';
  });
  check(/festival/i.test(stillThere), 'the line survived the test run');
  check(await page.isVisible('.ed-tabs'), 'the panels are back');
  await shot(page, label, '12-back');

  // --- 9. every panel, for a human to look at ----------------------------------------
  const everyPanel = await allTabs(page);
  for (const id of everyPanel) {
    await openPanel(page, id);
    const body = await page.$(`.ed-panel-body[data-panel="${id}"]`);
    const visible = body ? await body.isVisible() : false;
    if (!visible) check(false, `the ${id} panel opens`);
    await shot(page, label, 'panel-' + id);
  }
  check(true, `all ${everyPanel.length} panels opened and were photographed`);

  // --- 8b. the camera and the tools cannot be left in a broken state --------------------
  await openPanel(page, 'tiles');
  await page.keyboard.press('9');                                  // Hand
  const far = await page.evaluate(() => { KIT.editor.set({ view: { x: -300, y: -200 } }); return { x: KIT.editor.state.view.x, y: KIT.editor.state.view.y }; });
  check(far.x >= -2 && far.y >= -2, `a pan cannot drag the map off screen (view ${far.x}, ${far.y})`);
  const scale0 = await page.evaluate(() => { KIT.editor.set({ view: { scale: 3 } }); return KIT.editor.state.view.scale; });
  const canvasBox = await page.$eval('.ed-overlay', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(canvasBox.x, canvasBox.y);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -3); await page.waitForTimeout(16); }
  await page.waitForTimeout(150);
  const scale1 = await page.evaluate(() => KIT.editor.state.view.scale);
  check(scale1 <= scale0 + 1, `a trackpad flick zooms one step, not to the ceiling (${scale0} → ${scale1})`);
  await page.evaluate(() => KIT.editor.set({ view: { scale: 2, x: 0, y: 0 } }));
  await page.keyboard.press('3');                                  // Rectangle
  await page.waitForTimeout(100);
  await tapTile(page, 1, 1);                                       // first corner…
  await page.waitForTimeout(150);
  const other = await page.evaluate(() => Object.keys(KIT.editor.state.project.maps).find(id => id !== KIT.editor.state.mapId));
  const histBefore = await page.evaluate(() => KIT.editor.state.doc.history.length);
  await page.evaluate((id) => KIT.editor.openMap(id), other);
  await page.waitForTimeout(200);
  await tapTile(page, 6, 6);                                       // …must not be finished on another map
  await page.waitForTimeout(300);
  const histAfter = await page.evaluate(() => KIT.editor.state.doc.history.length);
  const lastLabel = await page.evaluate(() => { const h = KIT.editor.state.doc.history; return h.length ? h[h.length - 1].label : null; });
  check(lastLabel !== 'Rectangle' || histAfter === histBefore, `a corner tapped on one map does not draw a rectangle on the next (${histBefore} → ${histAfter}, last: ${lastLabel})`);
  for (let i = histBefore; i < histAfter; i++) { await page.click('[title^="Undo"]'); await page.waitForTimeout(150); }
  await page.evaluate((id) => KIT.editor.openMap(id), await page.evaluate(() => KIT.game.project.start.map));
  await page.keyboard.press('1');                                  // Pencil again
  await page.waitForTimeout(100);

  // --- 8c. a card dragged to the top of the list lands there ----------------------------
  await openPanel(page, 'scripts');
  await page.evaluate(() => KIT.editor.select({ kind: 'script', path: ['scripts', 'intro'] }));
  await page.waitForTimeout(300);
  const openBtn = await page.$('button:has-text("Open in the script editor")');
  if (openBtn) { await openBtn.click(); await page.waitForTimeout(400); }
  await page.click(CARDS_TAB);
  await page.waitForTimeout(200);
  const order0 = await page.evaluate(() => KIT.editor.state.project.scripts.intro.body.map(c => c.t + ':' + (c.text || c.who || '').slice(0, 12)));
  const handles = await page.$$('.ed-cmd-list > .ed-cmd .ed-cmd-drag');
  check(handles.length === order0.length && handles.length >= 3, `the intro has ${order0.length} cards with drag handles`);
  if (handles.length >= 3) {
    const last = handles[handles.length - 1];
    const firstBox = await (await page.$('.ed-cmd-list > .ed-cmd')).boundingBox();
    const hb = await last.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2, firstBox.y + 2, { steps: 8 });
    await page.waitForTimeout(100);
    await page.mouse.move(firstBox.x + 10, firstBox.y + 2, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const order1 = await page.evaluate(() => KIT.editor.state.project.scripts.intro.body.map(c => c.t + ':' + (c.text || c.who || '').slice(0, 12)));
    check(order1[0] === order0[order0.length - 1] && order1.length === order0.length, `dragging the last card above the first puts it first (${order1[0]})`);
    await page.click('[title^="Undo"]');
    await page.waitForTimeout(200);
  }

  // --- 8d. a pick-on-map does not follow the author to another panel ---------------------
  await openPanel(page, 'objects');
  await page.click('.ed-obj-head .ed-btn.primary');            // ＋ Add
  await page.waitForTimeout(200);
  const doorChip = await page.$('.ed-chip.is-preset:has-text("Door")');
  if (doorChip) {
    await doorChip.click();
    await page.waitForTimeout(250);
    const pickBtn = await page.$('.ed-preset-form button:has-text("Pick")');
    check(!!pickBtn, 'the Door preset offers Pick on the map');
    if (pickBtn) {
      await pickBtn.click();
      await page.waitForTimeout(150);
      check(await page.evaluate(() => KIT.editor.inspector.isPicking()), 'and the pick is armed');
      await openPanel(page, 'tiles');                          // wander off mid-pick
      const armed = await page.evaluate(() => ({ picking: KIT.editor.inspector.isPicking(), tool: KIT.editor.state.tool, cls: document.querySelector('.ed-root').classList.contains('ed-is-picking') }));
      check(!armed.picking && !armed.cls && armed.tool === 'pencil', `opening Tiles ends the pick and hands over the Pencil (picking=${armed.picking}, tool=${armed.tool})`);
      const hist0 = await page.evaluate(() => KIT.editor.state.doc.history.length);
      await tapTile(page, spot.x, spot.y);
      await page.waitForTimeout(250);
      const hist1 = await page.evaluate(() => KIT.editor.state.doc.history.length);
      const lastLbl = await page.evaluate(() => { const h = KIT.editor.state.doc.history; return h.length ? h[h.length - 1].label : null; });
      check(hist1 === hist0 + 1 && lastLbl !== 'Place event', `the next tap paints instead of answering a dead form (${lastLbl})`);
      await page.click('[title^="Undo"]');
      await page.waitForTimeout(200);
    }
    await openPanel(page, 'objects');
    if (await page.isVisible('.ed-obj-head .ed-btn.primary:has-text("Close")')) { await page.click('.ed-obj-head .ed-btn.primary'); await page.waitForTimeout(150); }
  }

  // --- 8f. a selection reaches each mounted panel's onSelect exactly once -------------
  await openPanel(page, 'script');
  const onSelectCalls = await page.evaluate(() => {
    const def = KIT.registry('editorPanels').get('script');
    let n = 0; const orig = def.onSelect;
    def.onSelect = function () { n++; return orig.apply(this, arguments); };
    KIT.editor.select({ kind: 'object', map: KIT.editor.state.mapId, id: 'mom' });
    def.onSelect = orig;
    return n;
  });
  check(onSelectCalls === 1, `selecting an event calls the Script panel's onSelect once (${onSelectCalls})`);

  // --- 9a. typing into a page condition keeps the keyboard and every keystroke ----------
  await openPanel(page, 'objects');
  await page.evaluate(() => KIT.editor.select({ kind: 'object', map: KIT.editor.state.mapId, id: 'mom' }));
  await page.waitForTimeout(300);
  for (const b of await page.$$('.ed-obj-detail .ed-page-tab')) { if ((await b.textContent()).trim() === '2') { await b.click(); break; } }
  await page.waitForTimeout(300);
  let box = null;
  for (const i of await page.$$('.ed-cond-fields input')) { if (await i.isVisible() && (await i.inputValue()) === '1') box = i; }
  check(!!box, 'Mom’s page 2 condition (chapter ≥ 1) shows its value box');
  if (box) {
    await box.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('12');
    await page.waitForTimeout(400);
    const typed = await page.evaluate(() => ({ tag: document.activeElement && document.activeElement.tagName, value: document.activeElement && document.activeElement.value }));
    const stored = await page.evaluate(() => KIT.editor.state.project.maps[KIT.editor.state.mapId].objects.find(o => o.id === 'mom').pages[1].when.value);
    check(typed.tag === 'INPUT' && typed.value === '12', `typing “12” into the condition keeps the box and the keyboard (${typed.value})`);
    check(stored === 12, `and the page condition reads chapter ≥ 12 (${stored})`);
    await page.click('[title^="Undo"]');
    await page.waitForTimeout(200);
  }

  // --- 9b. the cast is written in the Cast panel, not in raw JSON -------------------
  await openPanel(page, 'cast');
  const castBefore = await page.evaluate(() => Object.keys(KIT.editor.state.project.cast || {}).length);
  await page.click('.ed-panel-body[data-panel="cast"] .ed-btn.primary');   // ＋ New person
  await page.waitForTimeout(200);
  await page.fill('.ed-cast-add input', 'Old Tomas');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const tomas = await page.evaluate(() => (KIT.editor.state.project.cast || {})['old-tomas']);
  check(!!tomas && tomas.name === 'Old Tomas', `＋ New person put “Old Tomas” in the cast (${castBefore} → ${castBefore + 1})`);
  check(await page.isVisible('.ed-cast-form'), 'and opened their form to fill in');
  const idRow = await page.evaluate(() => { const row = document.querySelector('.ed-cast-form .ed-f[data-key="id"]'); return row ? { readonly: !!row.querySelector('.ed-readonly'), input: !!row.querySelector('input'), text: row.querySelector('.ed-readonly') && row.querySelector('.ed-readonly').textContent } : null; });
  check(!!idRow && idRow.readonly && !idRow.input && idRow.text === 'old-tomas', 'their Id is shown as text in the full form, with no box to type in');
  await shot(page, label, '09b-cast');
  // the search box keeps the caret while the panel redraws under it
  await page.click('.ed-panel-body[data-panel="cast"] .ed-obj-search');
  await page.keyboard.type('old', { delay: 60 });
  await page.waitForTimeout(300);
  const castSearch = await page.evaluate(() => ({ tag: document.activeElement && document.activeElement.tagName, cls: document.activeElement && document.activeElement.className, value: document.activeElement && document.activeElement.value }));
  check(castSearch.tag === 'INPUT' && castSearch.value === 'old', `typing in the Cast search keeps the box and every letter (“${castSearch.value}”)`);
  await page.fill('.ed-panel-body[data-panel="cast"] .ed-obj-search', '');
  await page.waitForTimeout(200);
  // Nothing may be wider than the panel: a phone must not scroll sideways.
  const overflow = await page.evaluate(() => {
    const host = KIT.editor.el.panel;
    return Math.max(0, host.scrollWidth - host.clientWidth);
  });
  check(overflow <= 2, `nothing sticks out of the side panel (${overflow}px)`);

  // --- 10. reload: the draft is still there --------------------------------------------
  await page.evaluate(() => KIT.editor.saveNow());
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => window.KIT && KIT.editor && KIT.editor.isOpen && KIT.editor.isOpen(), undefined, { timeout: 15000 });
  await page.waitForTimeout(500);
  const afterReload = await page.evaluate(() => {
    const st = KIT.editor.state;
    const obj = (st.project.maps[st.mapId].objects || []).find(o => o.name === 'Rosie');
    return obj ? ((((obj.pages || [])[0] || {}).on || {}).interact || []).map(c => c.text).join('') : null;
  });
  check(afterReload !== null, 'after a reload the new event is still on the map');
  check(/festival/i.test(afterReload || ''), 'after a reload the line is still there');
  await shot(page, label, '13-reloaded');

  // --- 11. closing goes back to the game ------------------------------------------------
  await page.evaluate(() => KIT.editor.close());
  await page.waitForTimeout(1200);
  check(await page.evaluate(() => document.getElementById('editor').hidden), 'closing hides Creator Mode');
  check(await page.evaluate(() => KIT.game.scene() === 'title' || KIT.game.scene() === 'map'), 'the game is on screen again');
  await shot(page, label, '14-closed');

  // --- 12. the second time round, Play here still has a way back (a phone has no Escape) ---
  await page.evaluate(() => KIT.game.openEditor());
  await page.waitForTimeout(400);
  check(await page.evaluate(() => KIT.editor.isOpen()), 'Creator Mode opens a second time');
  await page.evaluate(() => { KIT.editor.playHere(); });   // not awaited: playHere resolves when the run ends
  await page.waitForFunction(() => KIT.editor.state.mode === 'play', undefined, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  check(await page.isVisible('.ed-playbar'), 'and Play here shows ‹ Back to Creator Mode again');
  await page.click('.ed-playbar .ed-btn');
  await page.waitForTimeout(400);
  check((await state(page)).mode === 'edit', 'which comes back to editing');
  await page.evaluate(() => KIT.editor.close());
  await page.waitForTimeout(300);

  check(problems.length === 0, 'no console errors or page errors' + (problems.length ? ':\n     ' + problems.slice(0, 6).join('\n     ') : ''));
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await run(browser, 'wide', { width: 1280, height: 800 }, { touch: false });
    await run(browser, 'phone', { width: 390, height: 844 }, { touch: true, dpr: 2 });
  } catch (e) {
    failures++;
    console.log('\nUNCAUGHT: ' + (e && e.stack ? e.stack : e));
  } finally {
    await browser.close();
  }
  log(`\nscreenshots: ${SHOTS}/editor-*.png`);
  if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
  console.log('\nPASS');
})();
