// mons/e2e.node.js — the browser play-through for this module.
//
// NOT part of the page: this is a Node + Playwright script, like e2e/walk.js.
// It is here rather than in e2e/ so it travels with the module.
//
//   export NODE_PATH=$(npm root -g)
//   KIT_SHOTS=/tmp/shots node js/modules/mons/e2e.node.js
//
// It starts the demo on Route 1 with a lucky rng, forces an encounter, plays the
// whole catch scene (berry, timing ring, wobbles, nickname), checks the party
// and the Pokédex, walks with the follower and talks to it, goes to the garden,
// opens a card and pets somebody, then saves, reloads and checks everything came
// back. Screenshots land in KIT_SHOTS.
'use strict';
const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const SHOTS = process.env.KIT_SHOTS || '/tmp/kit-shots';
// ?test=<id> boots straight into a test state, so the title loop is not racing us.
const URL = 'file://' + path.join(ROOT, 'index.html') + '?test=mons-grass';

const log = (...a) => console.log('·', ...a);
function ok(cond, what) { if (!cond) { throw new Error('FAILED: ' + what); } console.log('  ✓ ' + what); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 760 }, deviceScaleFactor: 2 });
  const errors = [];
  // The Google font is fetched from the network; in a sandbox that fails and the
  // only thing lost is the typeface. Nothing else may appear on the console.
  const IGNORE = /fonts\.googleapis|fonts\.gstatic|ERR_CERT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_FAILED.*fonts/i;
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });

  const shot = async (name) => { await page.screenshot({ path: path.join(SHOTS, name) }); log('shot', name); };
  const wait = (ms) => page.waitForTimeout(ms);
  const scene = () => page.evaluate(() => KIT.game.scene());
  const waitScene = (id, ms) => page.waitForFunction((want) => KIT.game.scene() === want, id, { timeout: ms || 8000 });
  const state = () => page.evaluate(() => KIT.mons.read(KIT.game.world.save));

  await page.goto(URL);
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted && KIT.game.world, null, { timeout: 15000 });
  log('booted');

  ok(await page.evaluate(() => KIT.modules.has('mons')), 'the mons module registered');
  ok(await page.evaluate(() => KIT.mons.speciesList().length) === 32, '32 species in the registry');

  // ---- 1. start the demo on the route, with a lucky rng ---------------------
  await page.evaluate(() => {
    // KIT.game.rngOverride: every random decision this run comes from here.
    const lucky = () => 0.03;
    lucky.int = (n) => 0; lucky.range = (lo) => lo; lucky.pick = (a) => a[0];
    lucky.chance = () => true; lucky.weighted = () => 0; lucky.shuffle = (a) => a.slice();
    lucky.fork = () => lucky;
    KIT.game.rngOverride = lucky;
    const st = (KIT.game.project.testStates || []).find(t => t.id === 'mons-grass');
    return KIT.game.newGame({ testState: st, silent: true });
  });
  await waitScene('map');
  await wait(500);
  ok((await page.evaluate(() => KIT.game.world.map.id)) === 'route', 'standing on Route 1');
  // the test state already says `starter = pikachu`; the module has quietly
  // turned that variable into a real partner (packs.mons.starters)
  const start = await state();
  ok(start.party.length === 1 && start.party[0].id === 'pikachu', 'the lab starter really is a Pokémon');
  await shot('01-route.png');

  // ---- 2. a step in the tall grass -----------------------------------------
  await page.evaluate(() => { KIT.game.hold('left', 1, true); });
  await waitScene('mons-catch', 10000);
  await page.evaluate(() => { KIT.game.hold('left', 1, false); });
  await wait(700);
  const met = await page.evaluate(() => KIT.scenes.top().params.species);
  log('met', met);
  ok(!!met, 'the encounter rolled somebody from the route table');
  ok(await page.$('#mons-scene .mons-portrait'), 'the wild one is on screen at 4×');
  await shot('02-catch-scene.png');

  // a berry first: it calms them and widens the band
  await page.click('[data-action="act:berry"]');
  await wait(500);
  await page.click('[data-action="continue"]');
  await wait(300);

  // then the ball: the ring shrinks, we tap in the green
  await page.click('[data-action="act:throw"]');
  await wait(900);
  ok(await page.$('#mons-scene .mons-ring'), 'the timing ring is shrinking');
  await shot('03-catch-ring.png');
  await page.evaluate(() => KIT.scenes.top()._tap(0.34));    // tap dead centre: a perfect throw
  await wait(2200);
  await shot('04-catch-wobble.png');
  // "Gotcha!" -> continue -> nickname -> joined
  for (let i = 0; i < 4 && (await scene()) === 'mons-catch'; i++) {
    const cont = await page.$('[data-action="continue"]');
    if (cont) { await cont.click(); await wait(400); }
    if ((await scene()) === 'nameEntry') {
      await page.fill('[data-role="name-entry"]', 'Buddy');
      await page.click('[data-action="ok"]');
      await wait(400);
    }
  }
  await page.waitForFunction(() => KIT.game.scene() === 'map', null, { timeout: 8000 });

  const after = await state();
  ok(after.party.length === 2, 'the new friend joined the party');
  const caught = after.party[1];
  ok(caught.id === met, `it is the ${met} we met`);
  ok(caught.nickname === 'Buddy', 'the nickname stuck');
  ok(after.dex.caught[met] && after.dex.caught[met].where === 'Route 1', 'the Pokédex remembers where');
  ok(after.follower === after.party[0].uid, 'the starter is still the one walking with us');
  const balls = await page.evaluate(() => KIT.game.world.save.inventory.pokeball);
  ok(balls === 8, `a ball was spent (${balls} left of 9)`);

  // ---- 3. the party and the Pokédex ----------------------------------------
  // Opened the way a player does, from the pause menu: opened straight from a
  // script it hid that the menu stayed painted on top of it.
  await page.keyboard.press('Escape');
  await wait(350);
  await page.click('#pause-menu [data-action="menu:mons-party"]');
  await wait(400);
  ok(await page.$('#mons-scene .mons-hearts'), 'the party list shows friendship hearts');
  const onTop = await page.evaluate(() => {
    const r = document.querySelector('#mons-scene .mons-panel').getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!(hit && hit.closest('#mons-scene'));
  });
  ok(onTop, 'the party list is drawn over the pause menu that opened it');
  await shot('05-party.png');
  await page.click('#mons-scene [data-action="close"]');
  await wait(300);
  ok(await page.isVisible('#pause-menu [data-action="menu:mons-party"]'), 'closing it goes back to the pause menu');
  await page.keyboard.press('Escape');
  await wait(300);

  await page.evaluate(() => { KIT.scenes.run('mons-dex', { game: KIT.game, project: KIT.game.project }); });
  await wait(400);
  const cells = await page.$$('#mons-scene .mons-cell');
  ok(cells.length === 32, `all 32 species are in the Pokédex (${cells.length})`);
  const counts = await page.evaluate(() => KIT.mons.dexCounts(KIT.mons.read(KIT.game.world.save)));
  const unseen = (await page.$$('#mons-scene .mons-cell.is-unseen')).length;
  ok(unseen === 32 - counts.seen, `${counts.seen} known, ${unseen} still silhouettes`);
  ok(counts.caught === counts.seen && counts.caught >= 1, `${counts.caught} befriended`);
  await shot('06-dex.png');
  await page.click('#mons-scene [data-action="close"]');
  await wait(300);

  // ---- 4. the follower walks behind ----------------------------------------
  await page.evaluate(() => KIT.game.warp('town', 12, 8, 'down'));
  await wait(500);
  await page.evaluate(() => { KIT.game.hold('down', 1, true); });
  await wait(1600);
  await page.evaluate(() => { KIT.game.hold('down', 1, false); });
  await wait(600);
  const comp = await page.evaluate(() => {
    const w = KIT.game.world, h = w.hero(), c = w.companion;
    return c ? { sprite: c.sprite, dx: c.x - h.x, dy: c.y - h.y } : null;
  });
  log('follower', JSON.stringify(comp));
  ok(comp && /^mon:/.test(comp.sprite), 'the follower is drawn from its own portrait');
  ok(comp && Math.abs(comp.dx) + Math.abs(comp.dy) <= 2, 'and it is right behind us');
  await shot('07-follower.png');

  // talking to it
  await page.evaluate(() => {
    const w = KIT.game.world, h = w.hero(), c = w.companion;
    h.dir = c.y > h.y ? 'down' : c.y < h.y ? 'up' : (c.x > h.x ? 'right' : 'left');
    w.interact(0);
  });
  await wait(600);
  await shot('08-follower-talk.png');
  const said = await page.evaluate(() => { const el = document.querySelector('#dialogue .kit-text'); return el ? el.textContent : ''; });
  log('said:', JSON.stringify(said.slice(0, 60)));
  await page.evaluate(() => KIT.scenes.clear());
  await wait(200);

  // ---- 5. the garden -------------------------------------------------------
  // one more friend, so the garden has somebody shiny in it
  await page.evaluate(() => {
    const ctx = KIT.game.world.makeCtx(null, 'p1');
    KIT.commands.exec(ctx, { t: 'givePokemon', species: 'vaporeon', shiny: true, friendship: 160, notify: false });
  });
  await page.evaluate(() => KIT.game.warp('garden', 7, 8, 'up'));
  await wait(700);
  const roamers = await page.evaluate(() => KIT.game.world.entities.filter(e => e.id.indexOf('mons-garden-') === 0).map(e => ({ id: e.id, x: e.x, y: e.y, sprite: e.sprite })));
  log('garden', JSON.stringify(roamers));
  ok(roamers.length === 2, 'everyone we own is out in the garden, bar the one walking with us');
  ok(roamers.some(r => /:shiny$/.test(r.sprite)), 'the shiny one is drawn shiny');
  await shot('09-garden.png');

  // stand next to one and say hello
  await page.evaluate(() => {
    const w = KIT.game.world;
    const e = w.entities.filter(x => x.id.indexOf('mons-garden-') === 0)[0];
    const h = w.hero();
    h.x = e.x; h.y = e.y + 1; h.px = h.x; h.py = h.y; h.dir = 'up';
    h.mover.moving = false;
    w.interact(0);
  });
  await waitScene('mons-card', 6000);
  await wait(400);
  ok(await page.$('#mons-scene .mons-hearts'), 'the card shows hearts, mood and where you met');
  await shot('10-garden-card.png');
  const petBefore = await page.evaluate(() => {
    const s = KIT.mons.read(KIT.game.world.save);
    return KIT.mons.find(s, KIT.scenes.top().params.uid).friendship;
  });
  await page.click('[data-action="do:pet"]');
  await wait(500);
  await shot('11-garden-pet.png');
  const petAfter = await page.evaluate(() => {
    const s = KIT.mons.read(KIT.game.world.save);
    const uid = KIT.scenes.top().params.uid;
    return KIT.mons.find(s, uid).friendship;
  });
  log('friendship', petBefore, '->', petAfter);
  ok(petAfter > petBefore, 'petting is worth +3 friendship');
  await page.click('[data-action="do:close"]');
  await wait(300);

  // ---- 6. save and reload --------------------------------------------------
  const before = await state();
  await page.evaluate(() => KIT.game.save('1'));
  await wait(400);
  // reload the page from scratch (?test= again only so the title loop is not
  // racing us; continueGame then loads the slot we just wrote)
  await page.goto(URL);
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted && KIT.game.world, null, { timeout: 15000 });
  await page.evaluate(() => { KIT.game.continueGame('1'); });
  await waitScene('map', 10000);
  await wait(600);
  const reloaded = await state();
  const sig = (s2) => s2.party.concat(s2.box).map(m => `${m.uid}:${m.id}:${m.nickname}:${m.friendship}:${m.shiny ? 'S' : ''}:${m.metAt}`).sort().join('|');
  ok(reloaded.party.length === before.party.length, 'the party survived the reload');
  ok(sig(reloaded) === sig(before), 'every nickname, heart and "met at" came back');
  ok(reloaded.party.some(m => m.nickname === 'Buddy'), 'including the one we nicknamed');
  ok(JSON.stringify(Object.keys(reloaded.dex.caught).sort()) === JSON.stringify(Object.keys(before.dex.caught).sort()), 'and the Pokédex');
  ok(reloaded.follower === before.follower, 'and who is walking with us');
  ok(!!(await page.evaluate(() => KIT.game.world.companion)), 'the follower is back on screen');
  await shot('12-after-reload.png');

  if (errors.length) { console.log('\nPAGE ERRORS:'); for (const e of errors) console.log('  !', e); }
  await browser.close();
  console.log(errors.length ? '\nDONE with ' + errors.length + ' page error(s)' : '\nDONE, clean');
  process.exit(errors.length ? 2 : 0);
})().catch(async (e) => { console.error('\n' + e.stack); process.exit(1); });
