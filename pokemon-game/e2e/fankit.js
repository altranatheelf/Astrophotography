// e2e/fankit.js — the things a Pokémon fan game is made of, brought in from the
// programs a person already has, and then used:
//
//   a Pokémon Essentials PBS roster  -> species you can pick
//   a PBS encounters.txt             -> a table on a map
//   a .wav / .ogg                    -> music that actually plays
//   Creator Mode's Species panel     -> a creature of your own, met in the grass
//
//   NODE_PATH=$(npm root -g) node e2e/fankit.js
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html');
const SHOTS = process.env.KIT_SHOTS || path.join(process.env.CLAUDE_SCRATCHPAD || '/tmp', 'kit', 'shots');
const FIX = path.join(process.env.CLAUDE_SCRATCHPAD || '/tmp', 'kit', 'fankit');
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(FIX, { recursive: true });
let failed = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok ' : 'FAIL'} ${what}`); if (!ok) failed++; };
const beat = (n, what) => console.log(`\n--- ${n}. ${what} ---`);

function makeFixtures() {
  // A PBS roster in the shape Essentials v20+ writes. One real name, one of the
  // author's own, with a type this engine has never heard of.
  fs.writeFileSync(path.join(FIX, 'pokemon.txt'), [
    '[BULBASAUR]', 'Name = Bulbasaur', 'Types = GRASS,POISON', 'BaseStats = 45,49,49,65,65,45',
    'Pokedex = A strange seed was planted on its back at birth.', '',
    '[MOSSLING]', 'Name = Mossling', 'Types = GRASS,SPIRIT', 'BaseStats = 60,60,60,60,60,60',
    'Pokedex = It hums when the wind moves.', '',
  ].join('\n'));
  fs.writeFileSync(path.join(FIX, 'encounters.txt'), [
    '[012]', 'Land,25', '    25,MOSSLING,2,4', '    20,BULBASAUR,2,4', 'Water,8', '    60,MAGIKARP,5,10', '',
  ].join('\n'));
  // A short real .wav, so the browser has something it can truly decode.
  const rate = 8000, n = Math.floor(rate * 0.2);
  const hdr = Buffer.alloc(44), data = Buffer.alloc(n * 2);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8);
  hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(rate, 24); hdr.writeUInt32LE(rate * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(2500 * Math.sin(i / 14)), i * 2);
  fs.writeFileSync(path.join(FIX, 'bgm_route.wav'), Buffer.concat([hdr, data]));
}
const openPanel = async (page, id) => {
  const g = await page.evaluate((pid) => KIT.editor.groupOf(pid), id);
  await page.click(`.ed-group[data-group="${g}"]`); await page.waitForTimeout(150);
  const chip = await page.$(`.ed-tab[data-panel="${id}"]`);
  if (chip && await chip.isVisible()) await chip.click();
  await page.waitForTimeout(300);
};
const importFile = async (page, file) => {
  await openPanel(page, 'import');
  await page.setInputFiles('.ed-panel-body[data-panel="import"] input[type="file"]', file);
  await page.waitForTimeout(700);
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

  beat(0, 'a game of my own to put it all in');
  await openPanel(page, 'project');
  await page.click('details.ed-sec summary:has-text("Start a new game")');
  await page.waitForTimeout(150);
  await page.fill('.ed-newgame-name', 'Region Aster');
  await page.click('button:has-text("Start from a blank map")');
  await page.waitForTimeout(200);
  await page.click('.ed-confirm .ed-btn.danger');
  await page.waitForTimeout(600);
  check((await page.evaluate(() => KIT.editor.state.project.meta.title)) === 'Region Aster', 'a blank game called Region Aster');

  beat(1, 'a roster out of Pokémon Essentials');
  await importFile(page, path.join(FIX, 'pokemon.txt'));
  const report = (await page.textContent('.ed-import-report')).replace(/\s+/g, ' ');
  check(/Essentials/.test(report), `the panel knew what a PBS file is (“${report.slice(0, 48)}…”)`);
  check(/spirit/.test(report), 'and said which type it had never heard of rather than dropping it');
  await page.screenshot({ path: `${SHOTS}/fankit-${label}-1-pbs.png` });
  await page.click('.ed-import-report button:has-text("Import")');
  await page.waitForTimeout(700);
  const roster = await page.evaluate(() => ({
    pack: (KIT.editor.state.project.packs.mons.species || []).map(s => s.id),
    reg: !!KIT.registry('monSpecies').get('mossling'),
    stats: (KIT.registry('monSpecies').get('bulbasaur') || {}).base,
    types: (KIT.registry('monSpecies').get('mossling') || {}).types,
  }));
  check(roster.pack.join(',') === 'bulbasaur,mossling', `both are in the game (${roster.pack.join(', ')})`);
  check(roster.reg, 'and in the registry every picker reads, without a reload');
  check(roster.stats && roster.stats.spe === 45 && roster.stats.spa === 65, `with Essentials’ own stat order read right (spe ${roster.stats && roster.stats.spe}, spa ${roster.stats && roster.stats.spa})`);
  check(Array.isArray(roster.types) && roster.types.includes('spirit'), 'and a type of the author’s own kept as written');

  beat(2, 'and the wild encounters that went with it');
  await importFile(page, path.join(FIX, 'encounters.txt'));
  await page.click('.ed-import-report button:has-text("Import")');
  await page.waitForTimeout(700);
  const tables = await page.evaluate(() => KIT.editor.state.project.packs.mons.encounters);
  check(!!(tables && tables['012']), `the table came across under its RPG Maker map id (${Object.keys(tables || {}).join(', ')})`);
  check(tables['012'].rate === 25 && tables['012'].byRegion[0].some(e => e.id === 'mossling'), 'with its rate and its residents');

  beat(3, 'music, from a file, that really plays');
  await importFile(page, path.join(FIX, 'bgm_route.wav'));
  check(await page.isVisible('.ed-audio-form'), 'a dropped sound asks what it is');
  await page.screenshot({ path: `${SHOTS}/fankit-${label}-2-audio.png` });
  await page.click('.ed-audio-form button:has-text("Bring it in")');
  await page.waitForTimeout(500);
  await page.click('.ed-import-report button:has-text("Import")');
  await page.waitForTimeout(700);
  check(await page.evaluate(() => KIT.registry('music').ids().includes('bgm-route')), 'it is a track the Map panel can pick');
  const playing = await page.evaluate(async () => {
    try { await KIT.audio.unlock(); KIT.audio.music('bgm-route'); await new Promise(r => setTimeout(r, 800)); return KIT.audio.current(); }
    catch (e) { return 'threw: ' + e.message; }
  });
  check(playing === 'bgm-route', `and it plays from a page opened off the disk (${playing})`);

  beat(4, 'a creature of your own, written here, met in the grass');
  await openPanel(page, 'mons-species');
  check(await page.isVisible('.ed-panel-body[data-panel="mons-species"]'), 'the Species panel is there');
  await page.click('.ed-panel-body[data-panel="mons-species"] .ed-btn.primary');
  await page.waitForTimeout(250);
  await page.fill('.ed-panel-body[data-panel="mons-species"] .ed-newgame-name', 'Emberling');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  const mine = await page.evaluate(() => ({
    pack: (KIT.editor.state.project.packs.mons.species || []).map(s => s.id),
    reg: !!KIT.registry('monSpecies').get('emberling'),
    form: !!document.querySelector('.ed-species-form'),
  }));
  check(mine.pack.includes('emberling') && mine.reg, `“Emberling” exists and is pickable (${mine.pack.join(', ')})`);
  check(mine.form, 'with its form open to fill in');
  await page.screenshot({ path: `${SHOTS}/fankit-${label}-3-species.png` });

  // put it in the grass of this map and meet it
  await page.evaluate(() => {
    const m = KIT.editor.state.mapId;
    const p = KIT.editor.state.project.maps[m];
    const all = []; for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) all.push({ x, y });
    KIT.editor.commit('Grass everywhere', (doc, ops) => ops.paint(doc, { map: m, layer: 'collision', cells: all, tile: 'g' }));
    KIT.editor.commit('Only Emberling', (doc, O) => O.setField(doc, ['maps', m, 'props', 'encounters'], { rate: 100, byRegion: { 0: [{ id: 'emberling', weight: 1 }] } }, 'Encounters'));
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => { KIT.editor.playHere({ at: { x: 2, y: 2 } }); });   // not awaited: it resolves when the run ends
  await page.waitForFunction(() => KIT.game.scene() === 'map' && KIT.game.world && !KIT.game.world.busy, undefined, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  let met = null;
  for (let i = 0; i < 20 && !met; i++) {
    await page.evaluate((d) => KIT.game.world.move(0, d), i % 2 ? 'right' : 'left');
    await page.waitForTimeout(260);
    if ((await page.evaluate(() => (KIT.scenes.top() || {}).id)) === 'mons-catch') met = await page.evaluate(() => KIT.scenes.top().params.species);
  }
  check(met === 'emberling', `a step in the grass met the one you invented (${met || 'nobody'})`);
  await page.screenshot({ path: `${SHOTS}/fankit-${label}-4-met.png` });
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
  console.log(`\nscreenshots: ${SHOTS}/fankit-*.png\n`);
  if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
  console.log('PASS');
})();
