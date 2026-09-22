// e2e/onetap.js — the whole of "start your own game", on a phone.
//
// The thing being proved is that a person who has never seen this before can
// open it on a phone, tap twice, and be standing in a region they own:
//
//   the title screen        -> "Start your own game" is on it
//   one tap                 -> a list of what you can start with
//   one more                -> four maps, in Creator Mode, painted
//   Play                    -> walk north, out of the town, into the route
//   a step in the tall grass-> something wild turns up
//   a reload                -> it is all still there
//
//   NODE_PATH=$(npm root -g) node e2e/onetap.js
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html');
const SHOTS = process.env.KIT_SHOTS || path.join(process.env.CLAUDE_SCRATCHPAD || '/tmp', 'kit', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok ' : 'FAIL'} ${what}`); if (!ok) failed++; };
const beat = (n, what) => console.log(`\n--- ${n}. ${what} ---`);

const scenes = (page) => page.evaluate(() => KIT.scenes.ids());
const pressA = async (page) => { await page.keyboard.press('z'); await page.waitForTimeout(180); };
/** Press A until `want` is on the stack, or the messages run out. */
async function advanceUntil(page, want, limit) {
  for (let i = 0; i < (limit || 14); i++) {
    const ids = await scenes(page);
    if (ids.includes(want)) return true;
    if (!ids.includes('dialogue') && !ids.includes('chapter')) return false;
    await pressA(page);
  }
  return (await scenes(page)).includes(want);
}
/** Clear whatever is waiting for a tap, leaving anything that wants a real answer. */
async function clearMessages(page, limit) {
  for (let i = 0; i < (limit || 20); i++) {
    const ids = await scenes(page);
    if (!ids.some(id => id === 'dialogue' || id === 'chapter')) return;
    if (ids.includes('choice') || ids.includes('nameEntry')) return;
    await pressA(page);
  }
}

async function run(browser, label, size, touch) {
  console.log(`\n=== ${label} (${size.width}×${size.height}) ===`);
  const ctx = await browser.newContext({ viewport: size, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(PAGE);
  await page.waitForFunction(() => window.KIT && KIT.scenes && KIT.scenes.top(), undefined, { timeout: 30000 });
  await page.waitForTimeout(400);

  beat(0, 'the door is on the front page');
  const doors = await page.evaluate(() => Array.from(document.querySelectorAll('#screen-title [data-action]')).map(b => b.getAttribute('data-action')));
  check(doors.includes('start-own'), `the title offers it (${doors.join(', ')})`);
  await page.screenshot({ path: `${SHOTS}/onetap-${label}-0-title.png` });

  beat(1, 'one tap: what do you want to start with');
  await page.click('#screen-title [data-action="start-own"]');
  await page.waitForFunction(() => !!document.querySelector('#screen-title [data-action^="make:"]'), undefined, { timeout: 10000 });
  const picks = await page.evaluate(() => Array.from(document.querySelectorAll('#screen-title [data-action^="make:"]')).map(b => b.getAttribute('data-action')));
  check(picks[0] === 'make:mons-region', `something to walk around in is the one you land on (${picks.join(', ')})`);
  check(picks.includes('make:blank'), 'and a blank map is still there for people who want one');
  const described = await page.evaluate(() => !!document.querySelector('#screen-title .kit-start-describe'));
  check(described, 'each one says what it is, not just what it is called');
  await page.screenshot({ path: `${SHOTS}/onetap-${label}-1-chooser.png` });

  // Changing your mind costs nothing: Back, and the title is where you left it.
  await page.click('#screen-title [data-action="back"]');
  await page.waitForFunction(() => !!document.querySelector('#screen-title [data-action="start-own"]'), undefined, { timeout: 10000 });
  const stillDemo = await page.evaluate(() => KIT.game.project.meta.id);
  check(stillDemo === 'demo', `Back leaves the game you were looking at alone (${stillDemo})`);
  await page.click('#screen-title [data-action="start-own"]');
  await page.waitForFunction(() => !!document.querySelector('#screen-title [data-action^="make:"]'), undefined, { timeout: 10000 });

  beat(2, 'one more tap: a region, in Creator Mode, already painted');
  await page.click('#screen-title [data-action="make:mons-region"]');
  await page.waitForFunction(() => window.KIT && KIT.editor && KIT.editor.isOpen && KIT.editor.isOpen(), undefined, { timeout: 30000 });
  await page.waitForTimeout(900);
  const made = await page.evaluate(() => {
    const p = KIT.editor.state.project;
    const town = p.maps[p.start.map];
    const painted = (town.layers.ground || []).filter(Boolean).length;
    return {
      title: p.meta.title, id: p.meta.id, maps: Object.keys(p.maps), mapId: KIT.editor.state.mapId,
      painted, cells: town.width * town.height,
      objects: (town.objects || []).length,
      connections: (p.world.connections || []).length,
      problems: (KIT.editor.state.problems || []).filter(x => x.severity === 'error').length,
      modules: p.modules || [],
      canUndo: !!(KIT.editor.state.doc && KIT.editor.state.doc.canUndo && KIT.editor.state.doc.canUndo()),
    };
  });
  check(made.maps.length === 4, `four maps (${made.maps.join(', ')})`);
  check(made.mapId === 'town', `open on the one you start in (${made.mapId})`);
  check(made.painted === made.cells, `every square of it is painted (${made.painted}/${made.cells})`);
  check(made.objects >= 4, `with doors and people already in it (${made.objects})`);
  check(made.connections === 1, 'and the town joined to the route');
  check(made.problems === 0, `nothing wrong with it (${made.problems} errors)`);
  check(made.modules.indexOf('mons') >= 0 && made.modules.indexOf('home') >= 0,
    `and the engine the demo had is still on (${made.modules.join(', ')})`);
  // The screen that offered this says undo brings the old game back. It has to
  // be true: Creator Mode opens on the game being replaced, and the new one
  // goes in as one commit against THAT document.
  check(made.canUndo, 'and ↶ really does bring the game it replaced back');
  const undone = await page.evaluate(() => { KIT.editor.undo(); const t = KIT.editor.state.project.meta.title; KIT.editor.redo(); return t; });
  check(undone === 'Our Adventure', `one undo step, and there it is (${undone})`);
  await page.screenshot({ path: `${SHOTS}/onetap-${label}-2-editor.png` });

  // The grass works at runtime whatever the table is keyed on, because the
  // lookup falls back. The PANEL does not: it lists one section per region the
  // map paints, so a table filed under a region nobody paints reads as empty
  // grass to the author. Check what the author would actually see.
  await page.evaluate(() => KIT.editor.openMap('route'));
  await page.waitForTimeout(300);
  await page.click('.ed-group[data-group="map"]');
  await page.waitForTimeout(200);
  const chip = await page.$('.ed-tab[data-panel="mons-encounters"]');
  check(!!chip, 'the Encounters panel is one chip away from the route');
  if (chip) {
    await chip.click();
    await page.waitForTimeout(400);
    const shown = await page.evaluate(() => {
      const body = document.querySelector('.ed-panel-body[data-panel="mons-encounters"]') || document.querySelector('[data-panel="mons-encounters"]');
      if (!body) return null;
      return {
        names: Array.from(body.querySelectorAll('.mons-row-name')).map(n => n.textContent.trim()),
        empty: /Nobody lives here yet/.test(body.textContent),
      };
    });
    check(!!shown && !shown.empty, 'it does not say the route is empty');
    check(!!shown && shown.names.length === 5, `it lists what lives there (${shown ? shown.names.join(', ') : 'nothing'})`);
    await page.screenshot({ path: `${SHOTS}/onetap-${label}-2b-encounters.png` });
  }
  await page.evaluate(() => { KIT.editor.openMap('town'); KIT.editor.set({ panel: 'tiles' }); });
  await page.waitForTimeout(300);

  beat(3, 'play it: north out of the town and into the long grass');
  // Where the game says it starts, not where the editor's cursor happens to be.
  await page.evaluate(() => { const s = KIT.editor.state.project.start; KIT.editor.playHere({ at: { x: s.x, y: s.y } }); });
  await page.waitForFunction(() => KIT.game.scene() === 'map' && KIT.game.world && !KIT.game.world.busy, undefined, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  const where = await page.evaluate(() => { const h = KIT.game.world.hero(); return { map: KIT.game.world.map.id, x: h.x, y: h.y }; });
  check(where.map === 'town' && where.y > 10, `you start on the path at the bottom of the town (${where.map} ${where.x},${where.y})`);
  await page.screenshot({ path: `${SHOTS}/onetap-${label}-3-playing.png` });

  beat(3.5, 'the lab: somebody hands you a first partner');
  await page.evaluate(() => KIT.game.warp('lab', 6, 5, 'up'));
  await page.waitForTimeout(700);
  await clearMessages(page);
  await pressA(page);
  const asked = await advanceUntil(page, 'choice');
  check(asked, 'the professor asks who comes with you');
  if (asked) {
    const offered = await page.evaluate(() => Array.from(document.querySelectorAll('#choice .kit-option')).map(b => b.textContent.trim()));
    check(offered.length === 3, `three of them, by name (${offered.join(', ')})`);
    await page.screenshot({ path: `${SHOTS}/onetap-${label}-3b-starter.png` });
    await page.click('#choice .kit-option[data-index="0"]');
    await page.waitForTimeout(600);
    await clearMessages(page);
    // packs.mons.starters watches the variable the choice sets, and asks for a
    // name once the script it was set inside has finished talking.
    if (await page.waitForFunction(() => KIT.game.scene() === 'nameEntry', undefined, { timeout: 9000 }).then(() => true).catch(() => false)) {
      await page.fill('[data-role="name-entry"]', 'Sprout');
      await page.click('[data-action="ok"]');
      await page.waitForTimeout(500);
    }
    await clearMessages(page);
    const party = await page.evaluate(() => (KIT.mons ? KIT.mons.read(KIT.game.world.save) : null));
    check(!!party && party.party.length === 1, `and it is a real partner, in your party (${party && party.party.map(m => m.id).join(', ')})`);
    check(!!party && party.party[0] && party.party[0].nickname === 'Sprout', 'called what you called them');
  }
  // Back to the path, for the walk north.
  await page.evaluate(() => { const s = KIT.game.project.start; KIT.game.warp(s.map, s.x, s.y, 'up'); });
  await page.waitForTimeout(600);
  await clearMessages(page);

  // Walk north up the path until the route takes over. The seam is a connection,
  // not a warp, so this is the same walk it would be inside one map: no door, no
  // fade, no loading anything.
  let onRoute = false;
  for (let i = 0; i < 40 && !onRoute; i++) {
    await page.evaluate(() => KIT.game.world.move(0, 'up'));
    await page.waitForTimeout(150);
    onRoute = (await page.evaluate(() => KIT.game.world.map.id)) === 'route';
  }
  check(onRoute, 'walking north off the town puts you on the route, with no door to open');
  await page.screenshot({ path: `${SHOTS}/onetap-${label}-4-route.png` });

  // Off the path and into the grass. Walked rather than teleported, and one step
  // at a time towards the nearest patch, because the point of the check is that
  // a person could do this with a thumb.
  const towardGrass = () => page.evaluate(() => {
    const w = KIT.game.world, h = w.hero(), m = w.map;
    if (m.flagsAt(h.x, h.y).encounter) return 'here';
    const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const seen = new Set([h.x + ',' + h.y]);
    const queue = [{ x: h.x, y: h.y, first: null }];
    while (queue.length) {
      const at = queue.shift();
      for (const dir of Object.keys(DIRS)) {
        const step = m.passable(at.x, at.y, dir, h);
        if (!step.ok || step.reason === 'connection') continue;
        const to = step.hop || step.to;
        const key = to.x + ',' + to.y;
        if (seen.has(key)) continue;
        seen.add(key);
        const first = at.first || dir;
        if (m.flagsAt(to.x, to.y).encounter) return first;
        queue.push({ x: to.x, y: to.y, first });
      }
    }
    return null;
  });
  for (let i = 0; i < 30; i++) {
    const dir = await towardGrass();
    if (dir === 'here' || !dir) break;
    await page.evaluate((d) => KIT.game.world.move(0, d), dir);
    await page.waitForTimeout(160);
  }
  const standing = await page.evaluate(() => { const w = KIT.game.world, h = w.hero(); return { x: h.x, y: h.y, grass: w.map.flagsAt(h.x, h.y).encounter }; });
  check(standing.grass, `a short walk off the path is tall grass (${standing.x},${standing.y})`);

  // Every step has to land on grass, or this is a coin flip: a step onto a plain
  // tile rolls nothing, and an alternating left/right walks you out of the patch
  // and back. Staying in it makes sixty steps at rate 14 a certainty rather than
  // a 1-in-10 flake.
  const stepInGrass = () => page.evaluate(() => {
    const w = KIT.game.world, h = w.hero(), m = w.map;
    const dirs = ['left', 'right', 'up', 'down'];
    const open = [];
    for (const dir of dirs) {
      const step = m.passable(h.x, h.y, dir, h);
      if (!step.ok || step.reason === 'connection') continue;
      const to = step.hop || step.to;
      open.push({ dir, grass: !!m.flagsAt(to.x, to.y).encounter });
    }
    const pick = open.filter(o => o.grass)[0] || open[0];
    if (!pick) return null;
    w.move(0, pick.dir);
    return pick.dir;
  });
  let met = null, grassSteps = 0;
  for (let i = 0; i < 60 && !met && onRoute; i++) {
    if (await stepInGrass()) grassSteps++;
    await page.waitForTimeout(140);
    const top = await page.evaluate(() => (KIT.scenes.top() || {}).id);
    if (top === 'mons-catch') met = await page.evaluate(() => KIT.scenes.top().params.species);
  }
  check(!!met, `a step in the tall grass met somebody (${met || `nobody, in ${grassSteps} steps`})`);
  await page.screenshot({ path: `${SHOTS}/onetap-${label}-5-met.png` });

  beat(4, 'and it is still there after a reload');
  await page.reload();
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.project, undefined, { timeout: 30000 });
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => ({ title: KIT.game.project.meta.title, maps: Object.keys(KIT.game.project.maps).length }));
  check(back.maps === 4, `the game survived the tab going away (${back.title}, ${back.maps} maps)`);

  beat(5, 'and now that there IS something to lose, it says so before taking it');
  await page.click('#screen-title [data-action="start-own"]');
  await page.waitForFunction(() => !!document.querySelector('#screen-title [data-action^="make:"]'), undefined, { timeout: 10000 });
  await page.click('#screen-title [data-action="make:blank"]');
  const warned = await page.waitForFunction(() => !!document.querySelector('#screen-title [data-action^="go:"]'), undefined, { timeout: 10000 })
    .then(() => true).catch(() => false);
  check(warned, 'a second tap on a device that already has a game asks first');
  if (warned) {
    const words = await page.evaluate(() => document.querySelector('#screen-title .kit-title').textContent + ' · ' + document.querySelector('#screen-title .kit-hint').textContent);
    check(/A New Region/.test(words), `and names the game it would replace (${words})`);
    check(!/Ctrl/.test(words), 'without promising a key a phone does not have');
    await page.screenshot({ path: `${SHOTS}/onetap-${label}-6-replaces.png` });
    await page.click('#screen-title [data-action="list"]');
    await page.waitForFunction(() => !!document.querySelector('#screen-title [data-action^="make:"]'), undefined, { timeout: 10000 });
    await page.click('#screen-title [data-action="back"]');
    await page.waitForFunction(() => !!document.querySelector('#screen-title [data-action="start-own"]'), undefined, { timeout: 10000 });
    const kept = await page.evaluate(() => KIT.game.project.meta.title);
    check(kept === 'A New Region', `"Keep what I have" keeps it (${kept})`);
  }

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
  console.log(`\nscreenshots: ${SHOTS}/onetap-*.png\n`);
  if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
  console.log('PASS');
})();
