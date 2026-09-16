// e2e/vision.js — the whole vision, once, in a real browser.
//
//   export NODE_PATH=$(npm root -g)
//   node e2e/vision.js            # prints PASS, exits non-zero on any failure
//
// This is the one play-through that crosses every part of the engine and both
// modules the demo enables:
//
//   new game → the intro → Mom's parcel → the lab starter → Route 1 →
//   somebody in the tall grass → they follow you home → the garden →
//   pet them, feed them → the job board in town → send them out →
//   the clock runs on → welcome them home with the reward →
//   put furniture down in the house → save → reload →
//   the friend, the job history and the furniture are all still there.
//
// It finishes with a coda: the same demo with **both modules switched off**
// still boots and still plays, because a module is an add-on, not the engine.
//
// Screenshots land in KIT_SHOTS as vision-*.png — they are the point as much as
// the assertions are. A console error or a page error fails the run.
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
const beat = (n, what) => log(`\n--- ${n}. ${what} ---`);
function check(ok, what) {
  if (ok) log('  ok  ' + what);
  else { failures++; log('  FAIL ' + what); }
  return ok;
}

// ---- the small vocabulary this script speaks ---------------------------------
const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const wait = (page, ms) => page.waitForTimeout(ms);
const scene = (page) => page.evaluate(() => KIT.game.scene());
const scenes = (page) => page.evaluate(() => KIT.scenes.ids());
const hero = (page) => page.evaluate(() => {
  const w = KIT.game.world;
  if (!w || !w.map) return null;
  const h = w.hero();
  return { map: w.map.id, x: h.x, y: h.y, dir: h.dir };
});
const mons = (page) => page.evaluate(() => (window.KIT.mons ? KIT.mons.read(KIT.game.world.save) : null));
const homeSave = (page) => page.evaluate(() => (window.KIT.home ? KIT.home.ensure(KIT.game.world.save) : null));
const bag = (page) => page.evaluate(() => KIT.game.world.save.inventory || {});

async function waitScene(page, id, ms) {
  try {
    await page.waitForFunction((want) => KIT.game.scene() === want, id, { timeout: ms || 8000 });
    return true;
  } catch (e) { return false; }
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, `vision-${name}.png`) });
  log(`  📷 vision-${name}.png`);
}
const pressA = async (page) => { await page.keyboard.press('z'); await wait(page, 160); };

/** Press A until `want` is on the stack, or the messages run out. */
async function advanceUntil(page, want, limit) {
  for (let i = 0; i < (limit || 12); i++) {
    const ids = await scenes(page);
    if (ids.includes(want)) return true;
    if (!ids.includes('dialogue') && !ids.includes('chapter')) return false;
    await pressA(page);
    await wait(page, 220);
  }
  return (await scenes(page)).includes(want);
}

/**
 * Advance through messages until nothing is waiting for us and no script is
 * running. A script can go quiet for a moment in the middle — a `notify` gift
 * shows a toast with no dialogue behind it — so this goes round again if
 * another message turns up while we are waiting for the thread to finish.
 */
async function clearMessages(page, limit) {
  for (let round = 0; round < 3; round++) {
    await clearOnce(page, limit);
    const ids = await scenes(page);
    if (!ids.some(id => id === 'dialogue' || id === 'chapter')) break;
  }
}
async function clearOnce(page, limit) {
  for (let i = 0; i < (limit || 20); i++) {
    const ids = await scenes(page);
    if (!ids.some(id => id === 'dialogue' || id === 'chapter')) break;
    // Something else is on top and wants a real answer (a choice, a name): the
    // caller deals with that, and pressing A at it would answer for them.
    const top = await scene(page);
    if (top !== 'dialogue' && top !== 'chapter') break;
    await pressA(page);
    await wait(page, 200);
  }
  try {
    await page.waitForFunction(() => {
      const busy = KIT.game.world && KIT.game.world.busy;
      const talking = KIT.scenes.ids().some(id => id === 'dialogue' || id === 'chapter' || id === 'choice');
      return !busy && !talking && !KIT.interpreter.mainBusy();
    }, undefined, { timeout: 6000 });
  } catch (e) { /* the caller checks what it wanted */ }
}

/** Answer a name-entry box if one is (or is about to be) open. */
async function nameIfAsked(page, name, ms) {
  if (!(await waitScene(page, 'nameEntry', ms || 4000))) return false;
  await page.fill('[data-role="name-entry"]', name);
  await page.click('[data-action="ok"]');
  await wait(page, 500);
  return true;
}

/** Hold a direction until the hero stands somewhere new (or a scene takes over). */
async function stepOnce(page, dir) {
  const before = await hero(page);
  if (!before) return;
  await page.keyboard.down(KEY[dir]);
  try {
    await page.waitForFunction(([bx, by]) => {
      const w = KIT.game.world;
      if (!w || !w.map) return true;
      if (KIT.game.scene() !== 'map') return true;              // an encounter interrupted us
      const h = w.hero();
      return h.x !== bx || h.y !== by;
    }, [before.x, before.y], { timeout: 2500 });
  } catch (e) { /* blocked; the caller looks at where we ended up */ }
  finally { await page.keyboard.up(KEY[dir]); }
  await page.waitForFunction(() => {
    const w = KIT.game.world;
    return !w || !w.map || KIT.game.scene() !== 'map' || !w.hero().mover.moving;
  }, undefined, { timeout: 2500 }).catch(() => {});
}

/** A route to a tile, worked out with the engine's own passability rules. */
function routeTo(page, tx, ty) {
  return page.evaluate(([tx2, ty2]) => {
    const w = KIT.game.world, view = w.map, h = w.hero();
    const key = (x, y) => x + ',' + y;
    const from = new Map([[key(h.x, h.y), null]]);
    let frontier = [{ x: h.x, y: h.y }];
    for (let depth = 0; depth < 400 && frontier.length; depth++) {
      const next = [];
      for (const cell of frontier) {
        if (cell.x === tx2 && cell.y === ty2) {
          const steps = [];
          let at = key(cell.x, cell.y);
          while (from.get(at)) { const e = from.get(at); steps.unshift(e.dir); at = e.from; }
          return steps;
        }
        for (const dir of ['up', 'down', 'left', 'right']) {
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

async function walkTo(page, x, y) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const at0 = await hero(page);
    if (!at0 || (at0.x === x && at0.y === y)) break;
    const steps = await routeTo(page, x, y);
    if (!steps) break;
    for (const dir of steps) {
      await stepOnce(page, dir);
      const now = await hero(page);
      if (!now || (now.x === x && now.y === y)) break;
      if ((await scene(page)) !== 'map') break;
    }
  }
  const at = await hero(page);
  return !!(at && at.x === x && at.y === y);
}

/** Stand beside something on the map and press A until it answers. */
/**
 * Wait until the game is actually ready to be talked to: the map is what is on
 * screen, no script thread is still running, and the hero is standing still.
 * Without this a check races the tail of the intro and presses A at a dialogue
 * that is closing, which reads as “nobody answered”.
 */
async function settle(page, ms) {
  try {
    await page.waitForFunction(() => {
      if (!KIT.game || !KIT.game.world || KIT.game.scene() !== 'map') return false;
      if (KIT.interpreter.mainBusy() || KIT.game.world.busy) return false;
      const h = KIT.game.world.hero();
      return !!h && !h.mover.moving;
    }, undefined, { timeout: ms || 8000 });
    return true;
  } catch (e) { return false; }
}

async function talkTo(page, id) {
  await settle(page);
  // Somebody who wanders can step out of reach between aiming and pressing A,
  // so this goes round a few times before giving up.
  for (let attempt = 0; attempt < 8; attempt++) {
    const pos = await page.evaluate((objId) => {
      const e = KIT.game.world.entities.find(x => x.id === objId);
      return e ? { x: e.x, y: e.y } : null;
    }, id);
    if (!pos) return false;
    const spot = await page.evaluate(([px, py]) => {
      const w = KIT.game.world, view = w.map, h = w.hero();
      const cand = [{ x: px, y: py + 1, dir: 'up' }, { x: px - 1, y: py, dir: 'right' },
        { x: px + 1, y: py, dir: 'left' }, { x: px, y: py - 1, dir: 'down' }];
      for (const c of cand) {
        if (!view.inBounds(c.x, c.y)) continue;
        if (c.x === h.x && c.y === h.y) return c;
        if (view.flagsAt(c.x, c.y).solid) continue;
        if (w.entities.some(e => e.solid && e.visible !== false && e.x === c.x && e.y === c.y)) continue;
        return c;
      }
      return null;
    }, [pos.x, pos.y]);
    if (!spot) continue;
    await walkTo(page, spot.x, spot.y);
    for (let aim = 0; aim < 3; aim++) {
      const now = await page.evaluate((objId) => {
        const e = KIT.game.world.entities.find(x => x.id === objId);
        return e ? { x: e.x, y: e.y } : null;
      }, id);
      const at = await hero(page);
      if (!now || !at) break;
      const dx = now.x - at.x, dy = now.y - at.y;
      if (Math.abs(dx) + Math.abs(dy) !== 1) break;
      const dir = dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up';
      await page.keyboard.down(KEY[dir]); await wait(page, 40); await page.keyboard.up(KEY[dir]);
      await wait(page, 100);
      await pressA(page);
      await wait(page, 300);
      const ids = await scenes(page);
      if (ids.includes('dialogue') || ids.includes('choice') || (await scene(page)) !== 'map') return true;
    }
  }
  return false;
}

/** Back out of whatever is on screen until the map is all that is left. */
async function backToMap(page, limit) {
  for (let i = 0; i < (limit || 8) && (await scene(page)) !== 'map'; i++) {
    await page.keyboard.press('x');
    await wait(page, 400);
  }
  if ((await scene(page)) !== 'map') { await page.evaluate(() => KIT.scenes.clear()); await wait(page, 350); }
  return (await scene(page)) === 'map';
}

/** Open the pause menu and click the entry with this id. (Escape is the menu
 *  key; Enter is confirm — see js/kit/core/input.js.) */
async function menuOpen(page, id) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => KIT.game.scene() === 'menu', undefined, { timeout: 4000 }).catch(() => {});
  await wait(page, 350);
  const el = await page.$(`#pause-menu [data-action="menu:${id}"]`);
  if (!el) return false;
  await el.click();
  await wait(page, 600);
  return true;
}

// =============================================================================
async function play(browser) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 780 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  // ---- 1. a new game -------------------------------------------------------
  beat(1, 'a new game');
  await page.goto(PAGE);
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted, undefined, { timeout: 15000 });
  const loaded = await page.evaluate(() => KIT.modules.loaded().map(d => d.id));
  check(loaded.includes('mons') && loaded.includes('home'), `both modules registered (${loaded.join(', ')})`);
  check(await page.isVisible('[data-action="new-game"]'), 'the title screen offers a new game');
  await shot(page, '01-title');

  // Every random decision this run comes from one lucky stream, so the catch
  // plays out the same way every time. (KIT.game.rngOverride, game.js.)
  await page.evaluate(() => {
    const lucky = () => 0.03;
    lucky.int = () => 0; lucky.range = (lo) => lo; lucky.pick = (a) => a[0];
    lucky.chance = () => true; lucky.weighted = () => 0; lucky.shuffle = (a) => a.slice();
    lucky.fork = () => lucky;
    KIT.game.rngOverride = lucky;
  });
  await page.click('[data-action="new-game"]');

  // ---- 2. the intro --------------------------------------------------------
  beat(2, 'the intro plays by itself');
  check(await page.waitForFunction(() => KIT.scenes.ids().some(id => id === 'chapter' || id === 'dialogue'),
    undefined, { timeout: 8000 }).then(() => true).catch(() => false), 'the intro starts on its own');
  await wait(page, 700);
  await shot(page, '02-intro');
  await clearMessages(page);
  let at = await hero(page);
  check(!!at && at.map === 'home' && at.x === 5 && at.y === 6, `it leaves us at home (${at && at.map} ${at && at.x},${at && at.y})`);

  // ---- 3. Mom's parcel -----------------------------------------------------
  beat(3, 'Mom hands over the balls and the berries');
  check(await talkTo(page, 'mom'), 'we found Mom and said good morning');
  await shot(page, '03-mom');
  await clearMessages(page);
  let inv = await bag(page);
  check(inv.pokeball === 5 && inv.berry === 3, `five balls and three berries are in the bag (${JSON.stringify(inv)})`);

  // ---- 4. the lab starter --------------------------------------------------
  beat(4, 'the lab: somebody chooses you back');
  await page.evaluate(() => KIT.game.warp('lab', 7, 8, 'up'));
  await wait(page, 700);
  await clearMessages(page);                              // the Professor's welcome
  check(await talkTo(page, 'stand-pikachu'), 'the sleepy Pikachu on the middle stand looks up');
  await shot(page, '04-lab');
  // "Choose Pikachu?" → Yes
  check(await advanceUntil(page, 'choice'), 'and asks whether we want them');
  await page.click('#choice .kit-option[data-index="0"]');
  await wait(page, 600);
  await clearMessages(page);                    // "Pikachu it is! Take good care of them."
  // packs.mons.starters watches the `starter` variable: choosing at the stand is
  // what turns it into a real Pokémon — once the Professor has finished talking.
  check(await nameIfAsked(page, 'Spark', 8000), 'and asks what we would like to call them');
  await clearMessages(page);
  let party = await mons(page);
  check(!!party && party.party.length === 1 && party.party[0].id === 'pikachu',
    `the variable the stand set really is a Pokémon (${party && party.party.map(m => m.id).join(',')})`);
  check(!!party && party.party[0].nickname === 'Spark', 'and we named them Spark');
  check(!!party && party.follower === party.party[0].uid, 'they are already the one walking with us');
  await shot(page, '05-starter');

  // ---- 5. Route 1 ----------------------------------------------------------
  beat(5, 'out to Route 1');
  await page.evaluate(() => KIT.game.warp('route', 9, 2, 'down'));
  await wait(page, 800);
  at = await hero(page);
  check(!!at && at.map === 'route', `standing on ${at && at.map}`);
  await shot(page, '06-route');

  // ---- 6. somebody in the tall grass ---------------------------------------
  beat(6, 'a step in the tall grass meets somebody');
  await walkTo(page, 6, 4);                                  // the edge of the near patch
  let met = null;
  for (let tries = 0; tries < 14 && !met; tries++) {
    await stepOnce(page, tries % 2 ? 'right' : 'left');
    if ((await scene(page)) === 'mons-catch') met = await page.evaluate(() => KIT.scenes.top().params.species);
  }
  check(!!met, `the route's own encounter table rolled ${met || 'nobody'}`);
  await wait(page, 700);
  check(!!(await page.$('#mons-scene .mons-portrait')), 'they are on screen, four times life size');
  await shot(page, '07-met');

  // a berry first — it calms them and widens the band on the ring
  await page.click('[data-action="act:berry"]');
  await wait(page, 500);
  await page.click('[data-action="continue"]');
  await wait(page, 350);
  // then the ball
  await page.click('[data-action="act:throw"]');
  await wait(page, 900);
  check(!!(await page.$('#mons-scene .mons-ring')), 'the timing ring is shrinking');
  await shot(page, '08-ring');
  await page.evaluate(() => KIT.scenes.top()._tap(0.34));     // dead centre: a perfect throw
  await wait(page, 2200);
  await shot(page, '09-wobble');
  for (let i = 0; i < 5 && (await scene(page)) === 'mons-catch'; i++) {
    const cont = await page.$('[data-action="continue"]');
    if (cont) { await cont.click(); await wait(page, 400); }
    if ((await scene(page)) === 'nameEntry') await nameIfAsked(page, 'Pip', 1000);
  }
  await page.waitForFunction(() => KIT.game.scene() === 'map', undefined, { timeout: 10000 }).catch(() => {});
  await clearMessages(page);
  party = await mons(page);
  check(!!party && party.party.length === 2, `they came with us (party of ${party && party.party.length})`);
  const caught = party && party.party[1];
  check(!!caught && caught.id === met, `it is the ${met} we met`);
  check(!!caught && caught.nickname === 'Pip', 'the nickname we typed stuck');
  check(!!party && !!party.dex.caught[met] && party.dex.caught[met].where === 'Route 1',
    'the Pokédex wrote down where we met');
  inv = await bag(page);
  check(inv.pokeball === 4 && inv.berry === 2, `a ball and a berry were spent (${inv.pokeball} balls, ${inv.berry} berries)`);
  await shot(page, '10-caught');

  // ---- 7. and one of them walks behind us ----------------------------------
  beat(7, 'somebody is walking behind us');
  await page.evaluate(() => KIT.game.warp('town', 12, 8, 'down'));
  await wait(page, 700);
  await clearMessages(page);
  for (let i = 0; i < 4; i++) await stepOnce(page, 'down');
  const comp = await page.evaluate(() => {
    const w = KIT.game.world, h = w.hero(), c = w.companion;
    return c ? { sprite: c.sprite, near: Math.abs(c.x - h.x) + Math.abs(c.y - h.y) } : null;
  });
  check(!!comp && /^mon:/.test(comp.sprite), `the follower is drawn from their own portrait (${comp && comp.sprite})`);
  check(!!comp && comp.near <= 2, 'and they are right behind us');
  await shot(page, '11-follower');

  // ---- 8. the garden -------------------------------------------------------
  beat(8, 'the garden: where everyone is while you are out');
  await page.evaluate(() => KIT.game.warp('garden', 7, 8, 'up'));
  await wait(page, 900);
  await clearMessages(page);
  const roamers = await page.evaluate(() => KIT.game.world.entities
    .filter(e => e.id.indexOf('mons-garden-') === 0).map(e => ({ id: e.id, x: e.x, y: e.y })));
  check(roamers.length >= 1, `${roamers.length} friend(s) are out in the garden`);
  await shot(page, '12-garden');

  // ---- 9. pet them, feed them ----------------------------------------------
  beat(9, 'pet them, and give them a berry');
  await page.evaluate(() => {
    const w = KIT.game.world;
    const e = w.entities.filter(x => x.id.indexOf('mons-garden-') === 0)[0];
    const h = w.hero();
    h.x = e.x; h.y = e.y + 1; h.px = h.x; h.py = h.y; h.dir = 'up'; h.mover.moving = false;
    // Never return the promise: interact() only settles when the card closes,
    // and page.evaluate waits for whatever it is given.
    w.interact(0);
  });
  check(await waitScene(page, 'mons-card', 6000), 'their card opens');
  await wait(page, 400);
  await shot(page, '13-card');
  const cardUid = await page.evaluate(() => KIT.scenes.top().params.uid);
  const friendshipOf = (uid) => page.evaluate((u) => {
    const m = KIT.mons.find(KIT.mons.read(KIT.game.world.save), u);
    return m ? m.friendship : null;
  }, uid);
  const f0 = await friendshipOf(cardUid);
  await page.click('[data-action="do:pet"]');
  await wait(page, 500);
  const f1 = await friendshipOf(cardUid);
  check(f1 > f0, `petting is worth something (${f0} → ${f1})`);
  await shot(page, '14-petted');
  const berriesBefore = (await bag(page)).berry || 0;
  await page.click('[data-action="do:berry"]');
  await wait(page, 500);
  const f2 = await friendshipOf(cardUid);
  const berriesAfter = (await bag(page)).berry || 0;
  check(f2 > f1, `so is a berry (${f1} → ${f2})`);
  check(berriesAfter === berriesBefore - 1, `and the berry left the bag (${berriesBefore} → ${berriesAfter})`);
  // One friendship number, one mood: the home module heard `friendCared` and moved it.
  const moodAfter = await page.evaluate((u) => KIT.home.moodOf(KIT.game.world.save, u).mood, cardUid);
  check(moodAfter === 'happy', `and the mood the Jobs screen shows moved with it (${moodAfter})`);
  await shot(page, '15-fed');
  await page.click('[data-action="do:close"]');
  await wait(page, 400);

  // ---- 10. the job board ---------------------------------------------------
  beat(10, 'the job board in town: send a friend out');
  await page.evaluate(() => KIT.game.warp('town', 14, 10, 'up'));
  await wait(page, 800);
  await clearMessages(page);
  check(await talkTo(page, 'job-board'), 'the board on the square answers');
  check(await waitScene(page, 'home-board', 6000), 'the board of odd jobs opens');
  await wait(page, 400);
  await shot(page, '16-board');
  await page.click('#pause-menu [data-index="0"]');            // the first job
  await wait(page, 500);
  await shot(page, '17-who-goes');
  const whoRow = await page.$('#pause-menu .kit-menu-item:not([disabled])');
  check(!!whoRow, 'somebody is free to go');
  if (whoRow) await whoRow.click();
  await wait(page, 700);
  check(await backToMap(page, 4), 'and the board closes behind us');
  await clearMessages(page);
  let hs = await homeSave(page);
  const out = (hs.jobs || []).filter(j => !j.done);
  check(out.length === 1, `one job is out (${out.map(j => j.title).join(', ') || 'none'})`);
  check(!!out[0] && !!out[0].whoName, `and we know who went (${out[0] && out[0].whoName})`);
  await shot(page, '18-sent');

  // ---- 11. the clock runs on -----------------------------------------------
  beat(11, 'the clock runs on');
  const clock0 = await page.evaluate(() => KIT.home.clockText(KIT.game.world.save));
  await wait(page, 1600);                                      // the home system drives it while we play
  const clock1 = await page.evaluate(() => KIT.home.clockText(KIT.game.world.save));
  check(clock0 !== clock1, `time passes while we stand here (${clock0} → ${clock1})`);
  // The job takes in-game hours; standing about for them would make this script
  // take hours too, so we hand the clock the minutes the job needs.
  await page.evaluate(() => {
    const save = KIT.game.world.save;
    const job = (KIT.home.ensure(save).jobs || []).find(j => !j.done);
    KIT.home.addMinutes(save, (job ? job.minutes : 60) + 5);
  });
  await wait(page, 1400);                                      // the home system notices on its next sweep
  const clock2 = await page.evaluate(() => KIT.home.clockText(KIT.game.world.save));
  hs = await homeSave(page);
  const ready = await page.evaluate(() => KIT.home.jobsReady(KIT.game.world.save, KIT.home.now(KIT.game.world.save)).length);
  check(ready === 1, `the job is finished and waiting (${clock2}, ${ready} ready)`);
  await shot(page, '19-clock');

  // ---- 12. welcome them home -----------------------------------------------
  beat(12, 'welcome them home and take the reward');
  const beforeReward = await bag(page);
  // Who went, and what they were promised — a collected job moves out of
  // `jobs` and into `log`, so this has to be read before we welcome them.
  const sent = await page.evaluate(() => {
    const j = (KIT.home.ensure(KIT.game.world.save).jobs || []).find(x => !x.done);
    return j ? { id: j.id, job: j.job, title: j.title, who: j.who, whoName: j.whoName, reward: j.reward, count: j.count } : null;
  });
  check(!!sent, `we know what we are waiting for (${sent && sent.title})`);
  const fBefore = await friendshipOf(sent ? sent.who : cardUid);
  check(await menuOpen(page, 'home-jobs'), 'the pause menu has a Jobs entry');
  check(await waitScene(page, 'home-jobs', 6000), 'the Jobs screen opens');
  await wait(page, 400);
  await shot(page, '20-jobs');
  const collect = await page.$('#pause-menu [data-action^="collect:"]');
  check(!!collect, 'there is somebody to welcome home');
  if (collect) await collect.click();
  await wait(page, 900);
  await shot(page, '21-welcome');
  await clearMessages(page);
  const afterReward = await bag(page);
  hs = await homeSave(page);
  const history = (hs.log || []).filter(e => e && e.job === (sent && sent.job));
  check(history.length === 1, `the job is in the history (${(hs.log || []).length} entry/entries)`);
  check(!!history[0] && history[0].who === (sent && sent.who), `and it remembers who did it (${history[0] && history[0].who})`);
  check((hs.jobs || []).every(j => j.id !== (sent && sent.id)), 'and nobody is still out on it');
  const rewardId = sent && sent.reward;
  check(!!rewardId && (afterReward[rewardId] || 0) > (beforeReward[rewardId] || 0),
    `the reward landed in the bag (${rewardId}: ${beforeReward[rewardId] || 0} → ${afterReward[rewardId] || 0})`);
  const fAfter = await friendshipOf(sent ? sent.who : cardUid);
  check(fAfter !== null && fAfter > fBefore,
    `and the friend who went is closer for it (${fBefore} → ${fAfter})`);
  await backToMap(page);

  // ---- 13. decorate a room -------------------------------------------------
  beat(13, 'decorate a room in the house');
  await page.evaluate(() => KIT.game.warp('home', 5, 7, 'up'));
  await wait(page, 800);
  await clearMessages(page);
  check(await talkTo(page, 'moving-box'), 'the moving box by the bedroom door opens');
  await clearMessages(page);
  inv = await bag(page);
  check((inv.rug || 0) >= 1 && (inv['pot-plant'] || 0) >= 1, `there is furniture in the bag (${JSON.stringify({ rug: inv.rug, plant: inv['pot-plant'] })})`);
  await shot(page, '22-box');
  check(await menuOpen(page, 'home-decorate'), 'the pause menu has a Decorate entry');
  check(await waitScene(page, 'home-place', 6000), 'the placement screen opens');
  await wait(page, 500);
  await shot(page, '23-decorate-pick');
  const pickRug = await page.$('#pause-menu [data-action="pick:rug"]');
  check(!!pickRug, 'the rug is one of the things we can put down');
  if (pickRug) await pickRug.click();
  await wait(page, 600);
  check(!!(await page.$('#pause-menu [data-action="put"]')), 'there is a Put down button');
  // The ghost starts on the square we are facing, which may be the box we just
  // opened. Nudge it about until it is somewhere a rug can actually go.
  let canPut = false;
  for (let i = 0; i < 14 && !canPut; i++) {
    canPut = await page.evaluate(() => {
      const b = document.querySelector('#pause-menu [data-action="put"]');
      return !!b && !b.disabled;
    });
    if (!canPut) { await page.keyboard.press(i % 3 === 2 ? 'ArrowDown' : 'ArrowRight'); await wait(page, 260); }
  }
  check(canPut, 'and a square the rug will go on');
  await shot(page, '24-decorate-ghost');
  await page.click('#pause-menu [data-action="put"]');
  await wait(page, 700);
  hs = await homeSave(page);
  check((hs.furniture || []).length === 1, `the rug is down (${(hs.furniture || []).length} piece(s) placed)`);
  const overlaid = await page.evaluate(() => Object.keys(((KIT.game.world.save.overlays || {}).home || {}).tiles || {}).length);
  check(overlaid >= 1, `and it is written into the save's overlay, never the map (${overlaid} cell(s))`);
  await backToMap(page);
  await shot(page, '25-decorated');

  // ---- 14. save, reload, and find it all still there ------------------------
  beat(14, 'save, reload, and find everything still there');
  const before = {
    mons: await mons(page),
    home: await homeSave(page),
    bag: await bag(page),
    overlay: await page.evaluate(() => KIT.deepClone(((KIT.game.world.save.overlays || {}).home || {}).tiles || {})),
  };
  await page.evaluate(() => KIT.game.save('1'));
  await wait(page, 600);

  await page.goto(PAGE);
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted, undefined, { timeout: 15000 });
  check(await page.isVisible('[data-action="continue"]'), 'the title offers to continue');
  const slot = await page.evaluate(async () => {
    const s = await KIT.storage.loadGame('1');
    return s ? { mods: Object.keys(s.modules || {}), party: ((s.modules && s.modules.mons && s.modules.mons.party) || []).length,
      furniture: ((s.modules && s.modules.home && s.modules.home.furniture) || []).length } : null;
  });
  log(`     slot 1 holds: ${JSON.stringify(slot)}`);
  check(!!slot && slot.party === 2 && slot.furniture === 1, 'the slot on disk has both modules’ state in it');
  // Press Continue, the way a player would. (Calling KIT.game.continueGame()
  // from outside clears the scene stack under the title loop, which then starts
  // a NEW game over the top of the one it just loaded.)
  await page.click('[data-action="continue"]');
  check(await waitScene(page, 'map', 12000), 'the save loads');
  await wait(page, 900);
  await clearMessages(page);
  await shot(page, '26-reloaded');

  const after = {
    mons: await mons(page),
    home: await homeSave(page),
    bag: await bag(page),
    overlay: await page.evaluate(() => KIT.deepClone(((KIT.game.world.save.overlays || {}).home || {}).tiles || {})),
  };
  const sig = (s) => ((s && s.party) || []).concat((s && s.box) || [])
    .map(m => `${m.uid}:${m.id}:${m.nickname}:${m.friendship}`).sort().join('|');
  check(sig(after.mons) === sig(before.mons), `every friend, nickname and heart came back (${sig(after.mons)})`);
  check(after.mons.party.some(m => m.nickname === 'Pip'), 'including the one we met in the grass');
  check(after.mons.follower === before.mons.follower, 'and who is walking with us');
  check(!!(await page.evaluate(() => KIT.game.world.companion)), 'the follower is back on screen');
  check((after.home.log || []).length >= 1 &&
        JSON.stringify(after.home.log) === JSON.stringify(before.home.log), 'the job history is intact');
  check((after.home.furniture || []).length === (before.home.furniture || []).length, 'the furniture record is intact');
  check(JSON.stringify(after.overlay) === JSON.stringify(before.overlay), 'and the rug is still on the floor');
  const drawn = await page.evaluate(() => {
    const rec = KIT.home.ensure(KIT.game.world.save).furniture[0];
    if (!rec) return null;
    KIT.game.warp('home', 5, 7, 'down');
    return rec;
  });
  await wait(page, 800);
  const onScreen = await page.evaluate((rec) => {
    if (!rec) return false;
    const v = KIT.game.world.map;
    return ['ground', 'deco', 'above'].some(l => v.tileAt(l, rec.x, rec.y) === (rec.cells[0] && rec.cells[0].tile));
  }, drawn);
  check(onScreen, 'the room really is decorated when you walk back into it');
  await shot(page, '27-still-there');

  check(errors.length === 0, `no console errors or page errors${errors.length ? ': ' + errors[0] : ''}`);
  for (const e of errors) log('     ! ' + e);
  await context.close();
}

// =============================================================================
// The coda: a module is an add-on, not the engine.
async function withoutModules(browser) {
  beat(15, 'the coda: both modules switched off, and the game still plays');
  const context = await browser.newContext({ viewport: { width: 1100, height: 780 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(PAGE);
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted, undefined, { timeout: 15000 });
  // The Project panel writes exactly this list; a draft is what Creator Mode saves.
  await page.evaluate(async () => {
    const proj = KIT.deepClone(KIT.game.project);
    proj.modules = [];
    await KIT.storage.saveDraft(proj, { now: true });
  });
  await page.reload();
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted, undefined, { timeout: 15000 });
  const state = await page.evaluate(() => ({
    modules: KIT.game.project.modules,
    loaded: KIT.modules.loaded().map(d => d.id),
    menus: KIT.registry('menus').ids(),
  }));
  check(state.modules.length === 0 && state.loaded.length === 0, 'the project enables no modules and none registered');
  check(!state.menus.some(id => /^(mons|home)-/.test(id)), `the pause menu is the engine's own again (${state.menus.join(', ')})`);

  await page.click('[data-action="new-game"]');
  await page.waitForFunction(() => KIT.scenes.ids().some(id => id === 'chapter' || id === 'dialogue'),
    undefined, { timeout: 8000 }).catch(() => {});
  await clearMessages(page);
  await waitScene(page, 'map', 8000);
  await wait(page, 400);
  check(await talkTo(page, 'mom'), 'Mom still says good morning');
  await clearMessages(page);
  const inv = await bag(page);
  check(inv.pokeball === 5, 'the parcel still arrives (the items are ordinary items)');
  check(await walkTo(page, 5, 8), 'we can still walk to the front door');
  await stepOnce(page, 'down');
  await wait(page, 700);
  await clearMessages(page);
  const at = await hero(page);
  check(!!at && at.map === 'town', `and the door still leads outside (${at && at.map})`);
  await shot(page, '28-modules-off');

  // The job board is still an object; its page carries a command nobody owns now.
  await page.evaluate(() => KIT.game.warp('town', 14, 10, 'up'));
  await wait(page, 700);
  await clearMessages(page);
  await talkTo(page, 'job-board');
  await wait(page, 600);
  await clearMessages(page);
  const alive = await page.evaluate(() => !!(KIT.game.world && KIT.game.world.map));
  check(alive, 'a board whose command no module owns does not take the game down');
  await shot(page, '29-modules-off-board');

  await page.evaluate(() => KIT.storage.discardDraft());
  check(errors.length === 0, `no console errors or page errors${errors.length ? ': ' + errors[0] : ''}`);
  for (const e of errors) log('     ! ' + e);
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await play(browser);
    await withoutModules(browser);
  } catch (e) {
    failures++;
    log('\nUNCAUGHT: ' + (e && e.stack ? e.stack : e));
  }
  await browser.close();
  log(`\nscreenshots: ${SHOTS}/vision-*.png`);
  if (failures) { log(`\n${failures} check(s) failed`); process.exit(1); }
  log('\nPASS');
})();
