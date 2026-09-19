// e2e/walk.js — the play-through check (§14 phase 2 acceptance).
//
//   NODE_PATH=$(npm root -g) node e2e/walk.js
//
// Runs the demo world twice — a phone (390×844, touch) and a desktop
// (1280×800) — through: title → New Game → the intro → walk → talk to Mom →
// out of the door → a new map → a chapter card → talk to Grandma (with a
// choice) → pause → save → reload → Continue in the same spot → co-op moving
// both heroes. It fails on any console error or page error, and drops
// screenshots in SHOTS for a human to look at.
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

let failures = 0;
const log = (...a) => console.log(...a);
function check(ok, what) {
  if (ok) log('  ok  ' + what);
  else { failures++; log('  FAIL ' + what); }
  return ok;
}
async function expect(page, fn, what, timeout) {
  try { await page.waitForFunction(fn, undefined, { timeout: timeout || 6000 }); return check(true, what); }
  catch (e) { return check(false, what + '  (timed out)'); }
}

// ---- in-page helpers ---------------------------------------------------------
const hero = (page) => page.evaluate(() => {
  const w = KIT.game.world;
  if (!w || !w.map) return null;
  const h = w.hero();
  return { map: w.map.id, x: h.x, y: h.y, dir: h.dir, moving: h.mover.moving, busy: w.busy };
});
const scenes = (page) => page.evaluate(() => KIT.scenes.ids());

/** A route to a tile, computed with the real passability rules (BFS in the page). */
function routeTo(page, tx, ty) {
  return page.evaluate(([tx2, ty2]) => {
    const w = KIT.game.world, view = w.map, h = w.hero();
    const key = (x, y) => x + ',' + y;
    const from = new Map([[key(h.x, h.y), null]]);
    let frontier = [{ x: h.x, y: h.y }];
    const dirs = ['up', 'down', 'left', 'right'];
    for (let depth = 0; depth < 400 && frontier.length; depth++) {
      const next = [];
      for (const cell of frontier) {
        if (cell.x === tx2 && cell.y === ty2) {
          const steps = [];
          let at = key(cell.x, cell.y);
          while (from.get(at)) { const e = from.get(at); steps.unshift(e.dir); at = e.from; }
          return steps;
        }
        for (const dir of dirs) {
          const r = view.passable(cell.x, cell.y, dir, h);
          if (!r.ok || r.reason === 'connection') continue;
          const to = r.hop || r.to;
          const k = key(to.x, to.y);
          if (from.has(k)) continue;
          from.set(k, { dir, from: key(cell.x, cell.y) });
          next.push(to);
        }
      }
      frontier = next;
    }
    return null;
  }, [tx, ty]);
}

const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

/** Hold a direction until the hero actually stands on the next tile. */
async function stepOnce(page, dir) {
  const before = await hero(page);
  await page.keyboard.down(KEY[dir]);
  try {
    await page.waitForFunction(([bx, by]) => {
      const w = KIT.game.world;
      if (!w || !w.map) return true;                       // the map changed under us (a warp)
      const h = w.hero();
      return h.x !== bx || h.y !== by;
    }, [before.x, before.y], { timeout: 2500 });
  } catch (e) {
    // Blocked — a wandering NPC stepped into the way. Not a failure on its own:
    // the caller looks at where the hero ended up and walks round.
  } finally {
    await page.keyboard.up(KEY[dir]);
  }
  await page.waitForFunction(() => {
    const w = KIT.game.world;
    return !w || !w.map || !w.hero().mover.moving;
  }, undefined, { timeout: 2500 }).catch(() => {});
}

async function walkTo(page, x, y, label, quiet) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const at0 = await hero(page);
    if (at0 && at0.x === x && at0.y === y) break;
    const steps = await routeTo(page, x, y);
    if (!steps) break;
    for (const dir of steps) {
      await stepOnce(page, dir);
      const now = await hero(page);
      if (!now || (now.x === x && now.y === y)) break;
    }
  }
  const at = await hero(page);
  const ok = !!(at && at.x === x && at.y === y);
  if (!quiet) check(ok, `walked to ${x},${y} ${label || ''} (now ${at ? at.x + ',' + at.y : 'nowhere'})`);
  return ok;
}

/** Where an object is right now (NPCs wander, so nothing may be assumed). */
const entityAt = (page, id) => page.evaluate((objId) => {
  const e = KIT.game.world.entities.find(x => x.id === objId);
  return e ? { x: e.x, y: e.y } : null;
}, id);

/** A free tile beside the object, with the direction to face from there. */
const spotBeside = (page, pos) => page.evaluate(([px, py]) => {
  const w = KIT.game.world, view = w.map, h = w.hero();
  const cand = [{ x: px, y: py + 1, dir: 'up' }, { x: px - 1, y: py, dir: 'right' }, { x: px + 1, y: py, dir: 'left' }, { x: px, y: py - 1, dir: 'down' }];
  for (const c of cand) {
    if (!view.inBounds(c.x, c.y)) continue;
    if (c.x === h.x && c.y === h.y) return c;
    if (view.flagsAt(c.x, c.y).solid) continue;
    if (w.entities.some(e => e.solid && e.visible !== false && e.x === c.x && e.y === c.y)) continue;
    return c;
  }
  return null;
}, [pos.x, pos.y]);

/** Walk up to an object (wherever it has wandered to) and press A until it answers. */
async function talkTo(page, id, label) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const pos = await entityAt(page, id);
    if (!pos) return check(false, `${label || id} is on the map`);
    const spot = await spotBeside(page, pos);
    if (!spot) continue;
    await walkTo(page, spot.x, spot.y, '', true);
    // She may take another step while we are getting there, so aim again from
    // where she is now — a few times before walking round once more.
    for (let aim = 0; aim < 3; aim++) {
      const now = await entityAt(page, id);
      const at = await hero(page);
      if (!now || !at) break;
      const dx = now.x - at.x, dy = now.y - at.y;
      if (Math.abs(dx) + Math.abs(dy) !== 1) break;                // out of reach: go round again
      await face(page, dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up');
      await pressA(page);
      await page.waitForTimeout(250);
      if ((await scenes(page)).includes('dialogue')) return check(true, `talked to ${label || id}`);
    }
  }
  return check(false, `talked to ${label || id}`);
}

/** Press A (completing the typewriter as needed) until `want` shows up, or the messages end. */
async function advanceUntil(page, want, limit) {
  for (let i = 0; i < (limit || 10); i++) {
    const ids = await scenes(page);
    if (ids.includes(want)) return true;
    if (!ids.includes('dialogue') && !ids.includes('chapter')) return false;
    await pressA(page);
    await page.waitForTimeout(200);
  }
  return (await scenes(page)).includes(want);
}

/** Tap a direction briefly: that turns the hero without stepping. */
async function face(page, dir) {
  await page.keyboard.down(KEY[dir]);
  await page.waitForTimeout(40);
  await page.keyboard.up(KEY[dir]);
  await page.waitForTimeout(80);
}

const pressA = async (page) => { await page.keyboard.press('z'); await page.waitForTimeout(140); };

/** The script has finished: no message on screen and no main thread running. */
async function waitQuiet(page, timeout) {
  try {
    await page.waitForFunction(() => {
      const busy = KIT.game.world && KIT.game.world.busy;
      const talking = KIT.scenes.ids().some(id => id === 'dialogue' || id === 'chapter' || id === 'choice');
      return !busy && !talking && !KIT.interpreter.mainBusy();
    }, undefined, { timeout: timeout || 5000 });
    return true;
  } catch (e) { return false; }
}

/** Advance through messages until the dialogue closes and the script behind it ends. */
async function clearMessages(page, limit) {
  for (let i = 0; i < (limit || 14); i++) {
    const ids = await scenes(page);
    if (!ids.some(id => id === 'dialogue' || id === 'chapter')) break;
    await pressA(page);
    await page.waitForTimeout(220);
  }
  await waitQuiet(page);
  return !(await scenes(page)).some(id => id === 'dialogue' || id === 'chapter');
}

// ---- the run ------------------------------------------------------------------
async function run(browser, label, size, opts) {
  log(`\n=== ${label} (${size.width}×${size.height}) ===`);
  const context = await browser.newContext({
    viewport: size,
    hasTouch: !!opts.touch,
    isMobile: !!opts.touch,
    deviceScaleFactor: opts.dpr || 1,
  });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (IGNORE.test(m.text())) return;
    problems.push('console: ' + m.text());
  });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));

  const url = PAGE + (opts.query || '');
  await page.goto(url);
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted, undefined, { timeout: 10000 });

  // --- title ---------------------------------------------------------------
  await expect(page, () => KIT.game.scene() === 'title', 'title screen is up');
  check(await page.isVisible('#screen-title'), '#screen-title is visible');
  check(await page.isVisible('[data-action="new-game"]'), 'New Game button is there');
  await page.screenshot({ path: `${SHOTS}/${label}-1-title.png` });

  // Creator Mode is on the front page: it opens on the start map with no game running, and closing it comes back here.
  check(await page.isVisible('[data-action="creator"]'), 'Creator Mode is on the title screen');
  await page.click('[data-action="creator"]');
  await expect(page, () => KIT.editor && KIT.editor.isOpen() && KIT.editor.state.mapId === KIT.game.project.start.map, 'Creator Mode opened on the start map, with no game running');
  await page.evaluate(() => KIT.editor.close());
  await expect(page, () => KIT.game.scene() === 'title' && !(KIT.editor && KIT.editor.isOpen()), 'closing it comes back to the title');
  await page.waitForTimeout(300);

  await page.click('[data-action="new-game"]');

  // --- the intro plays on entering the house --------------------------------
  await expect(page, () => KIT.scenes.ids().includes('chapter') || KIT.scenes.ids().includes('dialogue'), 'the intro starts by itself');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/${label}-2-intro.png` });
  check(await clearMessages(page), 'the intro finishes');
  let at = await hero(page);
  check(at && at.map === 'home' && at.x === 5 && at.y === 6, `new game starts in home at 5,6 (got ${at && at.map} ${at && at.x},${at && at.y})`);

  // --- talk to Mom (she wanders around the kitchen, so we find her) ----------
  await talkTo(page, 'mom', 'Mom');
  const said = await page.textContent('#dialogue .kit-text');
  check(/\w/.test(said || ''), `the dialogue has text ("${(said || '').trim().slice(0, 40)}…")`);
  await page.screenshot({ path: `${SHOTS}/${label}-3-dialogue.png` });
  await clearMessages(page);
  const bag = await page.evaluate(() => KIT.game.state.inventory);
  check(bag && bag.pokeball === 5 && bag.berry === 3, `Mom's gift landed in the bag (${JSON.stringify(bag)})`);

  // --- out of the door: the map changes --------------------------------------
  await walkTo(page, 5, 8, '(by the door)');
  await stepOnce(page, 'down');                       // the warp tile
  await expect(page, () => KIT.game.world && KIT.game.world.map && KIT.game.world.map.id === 'town', 'the door leads to town');
  await page.waitForTimeout(400);
  await clearMessages(page);                          // the chapter card fires on the first step in town
  at = await hero(page);
  check(at && at.map === 'town', `now on the map "${at && at.map}"`);
  await page.screenshot({ path: `${SHOTS}/${label}-4-town.png` });

  const autos = await page.evaluate(() => KIT.storage.listGames().then(l => l.find(s => s.slot === 'autosave')));
  check(!!(autos && autos.exists && autos.map === 'town'), `the map change autosaved (${autos && autos.map})`);

  if (opts.touch) {
    // The on-screen pad is the real control on a phone: hold ◀ and walk.
    const posBefore = await hero(page);
    const open = await page.evaluate(() => {
      const w = KIT.game.world, h = w.hero();
      return ['left', 'right', 'up', 'down'].find(d => { const r = w.map.passable(h.x, h.y, d, h); return r.ok && r.reason === 'step'; }) || 'left';
    });
    const pad = await (await page.$(`[data-btn="${open}"][data-player="1"]`)).boundingBox();
    await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(450);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const posAfter = await hero(page);
    check(posAfter.x !== posBefore.x || posAfter.y !== posBefore.y,
      `the on-screen d-pad walks ${open} (${posBefore.x},${posBefore.y} → ${posAfter.x},${posAfter.y})`);

    // A swipe across the map is the other way to take a step.
    const cv = await (await page.$('#game-canvas')).boundingBox();
    const cx = cv.x + cv.width / 2, cy = cv.y + cv.height / 2;
    const beforeSwipe = await hero(page);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + 60, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(450);
    const afterSwipe = await hero(page);
    check(afterSwipe.y > beforeSwipe.y || afterSwipe.dir === 'down', `a swipe moves the hero (${beforeSwipe.y} → ${afterSwipe.y}, facing ${afterSwipe.dir})`);
  }

  // --- a choice ---------------------------------------------------------------
  await talkTo(page, 'grandma', 'Grandma');
  check(await advanceUntil(page, 'choice'), 'a choice opens');
  const options = await page.$$eval('#choice .kit-option', els => els.map(e => e.textContent.trim()));
  check(options.length >= 2, `the choice has ${options.length} options (${options.join(' / ')})`);
  await page.screenshot({ path: `${SHOTS}/${label}-5-choice.png` });
  await page.click('#choice .kit-option[data-index="0"]');
  await page.waitForTimeout(250);
  await clearMessages(page);
  const friendship = await page.evaluate(() => KIT.game.state.vars.friendship);
  check(friendship === 1, `choosing "yes" changed the story (friendship = ${friendship})`);

  // --- pause menu and save -----------------------------------------------------
  await page.keyboard.press('Escape');
  await expect(page, () => KIT.game.scene() === 'menu', 'the pause menu opens');
  check(await page.isVisible('#pause-menu'), '#pause-menu is visible');
  await page.screenshot({ path: `${SHOTS}/${label}-6-pause.png` });
  // Settings live in the same menu and stick.
  await page.click('[data-action="menu:settings"]');
  await expect(page, () => !!document.querySelector('[data-action="cycle:textSpeed"]'), 'settings are listed');
  const speedBefore = await page.evaluate(() => KIT.storage.settings().textSpeed);
  await page.click('[data-action="cycle:textSpeed"]');
  await page.waitForTimeout(200);
  const speedAfter = await page.evaluate(() => KIT.storage.settings().textSpeed);
  check(speedBefore !== speedAfter, `text speed changes (${speedBefore} → ${speedAfter})`);
  await page.click('[data-action="back"]');
  await page.waitForTimeout(150);

  await page.click('[data-action="menu:save"]');
  await expect(page, () => !!document.querySelector('[data-action="slot:1"]'), 'the save slots are listed');
  const before = await hero(page);
  await page.click('[data-action="slot:1"]');
  await expect(page, () => KIT.scenes.ids().includes('menu'), 'the menu is still there after saving');
  await page.waitForTimeout(700);
  const saved = await page.evaluate(() => KIT.storage.loadGame('1').then(s => s && { map: s.heroes[0].map, x: s.heroes[0].x, y: s.heroes[0].y }));
  check(saved && saved.map === before.map && saved.x === before.x && saved.y === before.y,
    `slot 1 holds where we stood (${JSON.stringify(saved)})`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // --- reload and continue -------------------------------------------------------
  await page.reload();
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted, undefined, { timeout: 10000 });
  await expect(page, () => {
    const b = document.querySelector('[data-action="continue"]');
    return b && !b.disabled;
  }, 'Continue is offered after a reload');
  await page.click('[data-action="continue"]');
  await expect(page, () => KIT.game.world && KIT.game.world.map, 'the save loads');
  await page.waitForTimeout(400);
  at = await hero(page);
  check(at && at.map === before.map && at.x === before.x && at.y === before.y,
    `we continue where we stood (${at && at.map} ${at && at.x},${at && at.y} vs ${before.map} ${before.x},${before.y})`);
  await page.screenshot({ path: `${SHOTS}/${label}-7-continued.png` });

  // --- co-op: two heroes, two pads --------------------------------------------------
  await page.keyboard.press('Escape');
  await expect(page, () => KIT.game.scene() === 'menu', 'the menu opens again');
  await page.click('[data-action="menu:coop"]');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await expect(page, () => KIT.game.world && KIT.game.world.coop === true, 'co-op is on');
  check((await page.$$('#controls .kit-pad')).length === 2, 'there are two on-screen pads');
  // Each hero needs somewhere to go: ask the map which way is open for each.
  const plan = await page.evaluate(() => {
    const w = KIT.game.world;
    const dirs = ['left', 'right', 'up', 'down'];
    const pick = (h) => dirs.find(d => { const r = w.map.passable(h.x, h.y, d, h); return r.ok && r.reason === 'step'; }) || null;
    return { p1: pick(w.heroes[0]), p2: pick(w.heroes[1]), start: w.heroes.map(h => [h.x, h.y]) };
  });
  const P2KEY = { up: 'w', down: 's', left: 'a', right: 'd' };
  check(!!(plan.p1 && plan.p2), `both heroes have room to walk (${plan.p1} / ${plan.p2})`);
  await page.keyboard.down(KEY[plan.p1]);
  await page.keyboard.down(P2KEY[plan.p2]);
  await page.waitForTimeout(600);
  await page.keyboard.up(KEY[plan.p1]);
  await page.keyboard.up(P2KEY[plan.p2]);
  await page.waitForTimeout(400);
  const endPos = await page.evaluate(() => KIT.game.world.heroes.map(h => [h.x, h.y]));
  const moved = (a, b) => a[0] !== b[0] || a[1] !== b[1];
  check(moved(plan.start[0], endPos[0]) && moved(plan.start[1], endPos[1]),
    `both heroes walked (${JSON.stringify(plan.start)} → ${JSON.stringify(endPos)})`);
  await page.screenshot({ path: `${SHOTS}/${label}-8-coop.png` });

  // --- a content bug does not end the game ---------------------------------------------
  // Renaming or deleting a map is an ordinary week in year two of a long
  // project, and every save made before it points at a place that is gone. That
  // used to throw inside enterMap, reject continueGame, and be awaited by
  // nothing — AFTER the title had been torn down and the scene stack cleared.
  // The player got a black screen and no reason for it.
  // This section causes failures ON PURPOSE, and the boundary's whole job is to
  // log them — so the errors it produces are the pass condition, not noise.
  // Counted out here rather than pattern-matched, so a DIFFERENT error appearing
  // during the same window still fails the run.
  const quietBefore = problems.length;
  const fault = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const g = KIT.game;
    const start = g.project.start.map;
    const other = Object.keys(g.project.maps).find((id) => id !== start);
    await g.world.enterMap(other, 2, 2, 'down'); await wait(150);
    await g.save('2'); await wait(150);
    delete g.project.maps[other];                       // exactly what a rename leaves behind
    g.toTitle(); await wait(300);
    const before = g.faults().length;
    const ok = await g.continueGame('2');
    await wait(400);
    return { deleted: other, continued: ok, scene: g.scene(),
             standingIn: g.world && g.world.map && g.world.map.id, start,
             recorded: g.faults().length > before,
             blank: g.scene() === 'map' && !g.world };
  });
  check(fault.continued === true, `a save pointing at a deleted map still continues (deleted '${fault.deleted}')`);
  check(fault.standingIn === fault.start, `and lands somewhere that exists (${fault.standingIn})`);
  check(!fault.blank, 'never a map scene with no world under it — that is the black screen');
  check(fault.recorded, 'and the real error is recorded for the author rather than swallowed');

  const boundary = await page.evaluate(() => ({
    hasFault: typeof KIT.game.fault === 'function',
    hasGuard: typeof KIT.game.guard === 'function',
    guarded: KIT.game.guard(Promise.reject(new Error('boom')), 'test', { tell: false }),
  }));
  check(boundary.hasFault && boundary.hasGuard, 'there is a boundary to route content failures through');
  check(await page.evaluate(() => KIT.game.guard(() => { throw new Error('sync'); }, 'test', { tell: false }).then((v) => v === false)),
    'and it catches a synchronous throw as well as a rejection');
  const expected = problems.slice(quietBefore);
  const onlyOurs = expected.every((t) => /unknown map|\[continue|\[test|boom|sync/.test(t));
  check(onlyOurs, `the boundary logged only the failures we caused (${expected.length})`);
  problems.length = quietBefore;      // and they do not count against the quiet check below


  // --- the baked tile layers are bounded ----------------------------------------------
  // Each map bakes its tile layers to one canvas per layer, which is what makes
  // walking a big map free. The bill is that those canvases are huge — on a
  // dpr-3 phone the renderer picks tilePx 128, so one 24x18 room is three
  // canvases of 3072x2304, about 85MB — and they used to be kept forever. Five
  // rooms measured 258MB, and a game with four hundred of them is not a game.
  const mem = await page.evaluate(async () => {
    const r = KIT.game.renderer;
    const ids = Object.keys(KIT.game.project.maps);
    const before = KIT.renderer.cacheBudget;
    KIT.renderer.cacheBudget = 24 * 1024 * 1024;      // deliberately tight, so eviction must run
    r.clearCaches();
    let peakMaps = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const id of ids) {
        try { await KIT.game.world.enterMap(id, 2, 2, 'down'); } catch (e) { continue; }
        KIT.game.tick(32);
        peakMaps = Math.max(peakMaps, r.cacheStats().maps);
      }
    }
    const held = r.cacheStats();
    KIT.renderer.cacheBudget = before;
    r.clearCaches();
    const after = r.cacheStats();
    return { mapCount: ids.length, peakMaps, heldMaps: held.maps, heldMB: +(held.bytes / 1e6).toFixed(1),
             clearedBytes: after.bytes, clearedMaps: after.maps };
  });
  check(mem.peakMaps < mem.mapCount,
    `a tight budget really evicts: held at most ${mem.peakMaps} of ${mem.mapCount} maps`);
  check(mem.heldMaps >= 1, 'but never the map being drawn — that would rebuild it every frame');
  check(mem.clearedBytes === 0 && mem.clearedMaps === 0,
    'and clearing gives every byte back, so the accounting is not drifting');

  // --- the page stayed quiet ----------------------------------------------------------
  check(problems.length === 0, 'no console errors or page errors' + (problems.length ? ':\n     ' + problems.slice(0, 6).join('\n     ') : ''));

  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await run(browser, 'phone', { width: 390, height: 844 }, { touch: true, dpr: 2 });
    await run(browser, 'desktop', { width: 1280, height: 800 }, { touch: false, query: '?fast=1' });
  } catch (e) {
    failures++;
    console.log('\nUNCAUGHT: ' + (e && e.stack ? e.stack : e));
  } finally {
    await browser.close();
  }
  if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
  console.log('\nPASS');
})();
