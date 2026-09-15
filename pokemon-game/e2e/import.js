// e2e/import.js — the import chain, end to end, in a real browser.
//
//   NODE_PATH=$(npm root -g) node e2e/import.js
//
// It copies the demo project somewhere scratch, runs `tools/import.js` on the
// Tiled fixture and on the RPG Maker fixture, builds a page that loads that
// copy, and then plays it: the imported map has to draw with its imported
// tileset image (real colours, not silhouettes), the imported NPC has to talk,
// and the imported warp has to move the hero to another map.
//
// Exits non-zero on any failure and prints PASS when everything held.
// Screenshots land in SHOTS for a human to look at.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SCRATCH = process.env.KIT_IMPORT_DIR ||
  '/tmp/claude-0/-home-user-Astrophotography/19812bb4-4e6f-5d04-84c2-78d4b1a8e91f/scratchpad/kit/import/demo-import';
const SHOTS = process.env.KIT_SHOTS ||
  '/tmp/claude-0/-home-user-Astrophotography/19812bb4-4e6f-5d04-84c2-78d4b1a8e91f/scratchpad/kit/kit/shots';
const IGNORE = /fonts\.googleapis|fonts\.gstatic|ERR_CERT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_FAILED.*fonts/i;

// The two fixtures, and the colours their generators painted into the PNGs —
// if these turn up on the canvas, the imported image really was drawn.
const GRASS = [88, 184, 72];            // test/fixtures/tiled/make.js
const WALL = [120, 104, 88];
const WATER = [[64, 120, 208], [88, 144, 232]];
const SILHOUETTE = [138, 138, 154];     // KIT.pixels: what "no art" looks like

let failures = 0;
const log = (...a) => console.log(...a);
function check(ok, what, extra) {
  if (ok) log('  ok  ' + what);
  else { failures++; log('  FAIL ' + what + (extra ? '  ' + extra : '')); }
  return ok;
}

// ---- 1. import into a copy of the demo -------------------------------------------
function run(args) {
  try {
    return execFileSync(process.execPath, [path.join(ROOT, 'tools', 'import.js')].concat(args), { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    log((e.stdout || '') + (e.stderr || ''));
    throw new Error('tools/import.js failed: ' + args.join(' '));
  }
}
function prepare() {
  log('=== importing into ' + SCRATCH + ' ===');
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(path.join(SCRATCH, 'maps'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'js/content/demo/project.js'), path.join(SCRATCH, 'project.js'));
  for (const f of fs.readdirSync(path.join(ROOT, 'js/content/demo/maps'))) {
    fs.copyFileSync(path.join(ROOT, 'js/content/demo/maps', f), path.join(SCRATCH, 'maps', f));
  }
  const tiled = run(['test/fixtures/tiled/town.tmj', '--into', SCRATCH, '--prefix', 'outside', '--quiet']);
  check(/added .*1 map/.test(tiled), 'the Tiled map imported', tiled.split('\n').find(l => l.includes('added')));
  const mv = run(['test/fixtures/rpgmaker', '--into', SCRATCH, '--prefix', 'willow', '--quiet']);
  check(/added .*2 maps/.test(mv), 'the RPG Maker project imported', mv.split('\n').find(l => l.includes('added')));

  const again = run(['test/fixtures/tiled/town.tmj', '--into', SCRATCH, '--prefix', 'outside', '--quiet']);
  check(/already up to date/.test(again), 're-running the same import writes nothing');
  check(fs.existsSync(path.join(SCRATCH, 'assets', 'outside-tiles.png')), 'the tileset image was copied next to the content');
  return { tiled, mv };
}

/** A page that loads the imported copy instead of js/content/demo. */
function makePage() {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const maps = fs.readdirSync(path.join(SCRATCH, 'maps')).filter(f => f.endsWith('.js')).sort();
  const local = ['project.js'].concat(fs.existsSync(path.join(SCRATCH, 'assets.js')) ? ['assets.js'] : [])
    .concat(maps.map(m => 'maps/' + m));
  html = html.replace(/[ \t]*<script src="js\/content\/demo\/[^"]*"><\/script>\n/g, '');
  html = html.replace('<script src="js/main.js"></script>',
    local.map(f => `<script src="${f}"></script>`).join('\n') + '\n<script src="js/main.js"></script>');
  html = html.replace(/(src|href)="(js|css)\//g, `$1="file://${ROOT}/$2/`);
  const file = path.join(SCRATCH, 'index.html');
  fs.writeFileSync(file, html);
  return 'file://' + file;
}

// ---- in-page helpers ---------------------------------------------------------------
const scenes = (page) => page.evaluate(() => KIT.scenes.ids());
const hero = (page) => page.evaluate(() => {
  const w = KIT.game.world;
  if (!w || !w.map) return null;
  const h = w.hero();
  return { map: w.map.id, x: h.x, y: h.y, dir: h.dir, busy: w.busy };
});
const pressA = async (page) => { await page.keyboard.press('z'); await page.waitForTimeout(160); };
const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

async function face(page, dir) {
  await page.keyboard.down(KEY[dir]);
  await page.waitForTimeout(40);
  await page.keyboard.up(KEY[dir]);
  await page.waitForTimeout(90);
}
async function stepOnce(page, dir) {
  const before = await hero(page);
  await page.keyboard.down(KEY[dir]);
  try {
    await page.waitForFunction(([bx, by]) => {
      const w = KIT.game.world;
      if (!w || !w.map) return true;
      const h = w.hero();
      return h.x !== bx || h.y !== by;
    }, [before.x, before.y], { timeout: 3000 });
  } catch (e) { /* the caller checks where we ended up */ }
  await page.keyboard.up(KEY[dir]);
  await page.waitForTimeout(250);
}
async function clearMessages(page, limit) {
  for (let i = 0; i < (limit || 16); i++) {
    const ids = await scenes(page);
    if (!ids.some(id => id === 'dialogue' || id === 'chapter' || id === 'choice')) break;
    await pressA(page);
  }
  await page.waitForFunction(() => !KIT.game.world || (!KIT.game.world.busy && !KIT.interpreter.mainBusy()),
    undefined, { timeout: 5000 }).catch(() => {});
}
/** Warp straight to a map (the imported maps are not joined to the demo world). */
async function warpTo(page, map, x, y, dir) {
  await page.evaluate(([m, x2, y2, d]) => KIT.game.warp(m, x2, y2, d), [map, x, y, dir || 'down']);
  await page.waitForTimeout(400);
  await clearMessages(page);
}

/** Where an object is right now (an imported MV event may be wandering). */
const entityAt = (page, id) => page.evaluate((objId) => {
  const e = KIT.game.world.entities.find(x => x.id === objId);
  return e ? { x: e.x, y: e.y } : null;
}, id);

/**
 * Stand next to an object, face it and press A until it answers. The hero is
 * put in place with a warp rather than walked: this test is about the import,
 * not about pathfinding (e2e/walk.js already walks).
 */
async function talkTo(page, map, id, label) {
  let last = '';
  for (let attempt = 0; attempt < 6; attempt++) {
    const pos = await entityAt(page, id);
    if (!pos) { await warpTo(page, map, 1, 1, 'down'); continue; }
    const spot = await page.evaluate(([px, py]) => {
      const w = KIT.game.world, view = w.map;
      const round = [{ x: px, y: py + 1, dir: 'up' }, { x: px - 1, y: py, dir: 'right' }, { x: px + 1, y: py, dir: 'left' }, { x: px, y: py - 1, dir: 'down' }];
      for (const c of round) {
        if (!view.inBounds(c.x, c.y) || view.flagsAt(c.x, c.y).solid) continue;
        if (w.entities.some(e => e.solid && e.visible !== false && e.x === c.x && e.y === c.y)) continue;
        return c;
      }
      return null;
    }, [pos.x, pos.y]);
    if (!spot) continue;
    await warpTo(page, map, spot.x, spot.y, spot.dir);
    // An imported MV event may be wandering, so aim again each time.
    for (let i = 0; i < 3; i++) {
      const now = await entityAt(page, id);
      const at = await hero(page);
      last = `${label} at ${now ? now.x + ',' + now.y : '?'}, hero at ${at ? at.x + ',' + at.y : '?'}`;
      if (!now || !at) break;
      const dx = now.x - at.x, dy = now.y - at.y;
      if (Math.abs(dx) + Math.abs(dy) !== 1) break;
      await face(page, dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up');
      await pressA(page);
      await page.waitForTimeout(280);
      if ((await scenes(page)).includes('dialogue')) return check(true, `${label} opened a message box`);
    }
  }
  return check(false, `${label} opened a message box`, last);
}

/** Every colour on the canvas, counted — the honest answer to "did it draw?". */
const colours = (page) => page.evaluate(() => {
  const c = document.getElementById('game-canvas');
  const g = c.getContext('2d', { willReadFrequently: true });
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const counts = {};
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const k = d[i] + ',' + d[i + 1] + ',' + d[i + 2];
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
});
const has = (counts, rgb, least) => (counts[rgb.join(',')] || 0) >= (least || 200);

// ---- the run -------------------------------------------------------------------------
async function play(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));

  await page.goto(url);
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted, undefined, { timeout: 15000 });

  // --- the project knows about the import --------------------------------------
  const known = await page.evaluate(() => ({
    maps: Object.keys(KIT.game.project.maps),
    tile: KIT.registry('tiles').has('outside:outside:grass'),
    tileArt: KIT.registry('tiles').get('outside:outside:grass') && KIT.registry('tiles').get('outside:outside:grass').art,
    mvTile: KIT.registry('tiles').has('willow:willow:1'),
    asset: KIT.assets.has('outside:tiles') && KIT.assets.get('outside:tiles').src,
  }));
  check(known.maps.includes('outside:town'), 'the imported Tiled map is in the project', JSON.stringify(known.maps));
  check(known.maps.includes('willow:willow-town'), 'the imported RPG Maker map is in the project');
  check(known.tile && !!known.tileArt && known.tileArt.image === 'outside:tiles', 'the imported tiles registered themselves, backed by the image');
  check(known.mvTile, 'the RPG Maker tiles registered too');
  check(known.asset === 'assets/outside-tiles.png', 'the tileset image is an asset of the project', String(known.asset));

  await page.click('[data-action="new-game"]');
  await page.waitForTimeout(500);
  await clearMessages(page);

  // --- the images decode ----------------------------------------------------------
  const ready = await page.waitForFunction(() => KIT.assets.state('outside:tiles') === 'ready' && KIT.assets.state('willow:willow-b') === 'ready',
    undefined, { timeout: 8000 }).then(() => true).catch(() => false);
  check(ready, 'the copied PNGs decoded in the browser');

  // --- the Tiled map draws with its own tileset -------------------------------------
  await warpTo(page, 'outside:town', 3, 4, 'up');
  const at = await hero(page);
  check(at && at.map === 'outside:town', 'the hero is standing on the imported map', JSON.stringify(at));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, 'import-1-tiled-map.png') });
  const c1 = await colours(page);
  check(has(c1, GRASS, 2000), 'the imported grass tiles are on screen', 'grass px: ' + (c1[GRASS.join(',')] || 0));
  check(has(c1, WALL, 200), 'the imported wall tile is on screen', 'wall px: ' + (c1[WALL.join(',')] || 0));
  check(WATER.some(w => has(c1, w, 100)), 'the animated water tile is on screen');
  check(!has(c1, SILHOUETTE, 64), 'nothing is standing in as a silhouette', 'silhouette px: ' + (c1[SILHOUETTE.join(',')] || 0));

  // --- the imported NPC talks ---------------------------------------------------------
  await talkTo(page, 'outside:town', 'mom', 'the imported NPC');
  const said = await page.evaluate(() => (document.getElementById('dialogue') || {}).textContent || '');
  check(/Good morning/i.test(said), 'the NPC says what Tiled said it says', JSON.stringify(said));
  await page.screenshot({ path: path.join(SHOTS, 'import-2-npc-talks.png') });
  await clearMessages(page);

  // --- the imported warp works ----------------------------------------------------------
  await warpTo(page, 'outside:town', 5, 3, 'down');
  await stepOnce(page, 'down');
  await page.waitForTimeout(900);
  await clearMessages(page);
  const after = await hero(page);
  check(after && after.map === 'home', 'the imported warp moved the hero to the map it names', JSON.stringify(after));
  check(after && after.x === 3 && after.y === 7, 'and it landed on the tile Tiled asked for', JSON.stringify(after));
  await page.screenshot({ path: path.join(SHOTS, 'import-3-after-warp.png') });

  // --- the RPG Maker map --------------------------------------------------------------
  await warpTo(page, 'willow:willow-town', 1, 3, 'down');
  await page.waitForTimeout(500);
  const mvAt = await hero(page);
  check(mvAt && mvAt.map === 'willow:willow-town', 'the hero is standing on the imported MV map', JSON.stringify(mvAt));
  await page.screenshot({ path: path.join(SHOTS, 'import-4-rpgmaker-map.png') });
  const c2 = await colours(page);
  check(!has(c2, SILHOUETTE, 64), 'the MV map draws its own tiles too', 'silhouette px: ' + (c2[SILHOUETTE.join(',')] || 0));
  const distinct = Object.keys(c2).length;
  check(distinct > 8, 'the MV tileset put real colours on the screen', distinct + ' distinct colours');

  // --- the MV NPC talks, and the MV door warps -----------------------------------------
  await talkTo(page, 'willow:willow-town', 'old-bran', 'the imported MV event');
  const mvSaid = await page.evaluate(() => (document.getElementById('dialogue') || {}).textContent || '');
  check(/Morning/i.test(mvSaid), 'the MV event says its Show Text line', JSON.stringify(mvSaid.slice(0, 80)));
  await page.screenshot({ path: path.join(SHOTS, 'import-5-mv-npc.png') });
  await clearMessages(page);

  await warpTo(page, 'willow:willow-town', 5, 3, 'down');
  await stepOnce(page, 'down');
  await page.waitForTimeout(900);
  await clearMessages(page);
  const mvWarped = await hero(page);
  check(mvWarped && mvWarped.map === 'willow:inn', 'the MV door transferred the hero to the inn', JSON.stringify(mvWarped));

  for (const p of problems) check(false, p);
  await context.close();
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  try {
    prepare();
  } catch (e) {
    log('  FAIL ' + e.message);
    process.exit(1);
  }
  const url = makePage();
  log('\n=== playing ' + url + ' ===');
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  try {
    await play(browser, url);
  } catch (e) {
    failures++;
    log('  FAIL the run threw: ' + (e && e.stack ? e.stack : e));
  } finally {
    await browser.close();
  }
  log('');
  log('screenshots: ' + SHOTS + '/import-*.png');
  if (failures) { log(`FAILED — ${failures} check${failures === 1 ? '' : 's'}`); process.exit(1); }
  log('PASS');
})();
