'use strict';
// The demo world is ordinary content: it must normalize clean, its scripts must
// run headlessly, and its warps, items and connections must actually work.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('./_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));
R('js/kit/world/map.js'); R('js/kit/world/entities.js'); R('js/kit/world/world.js'); R('js/kit/systems/index.js');
global.PKMN = global.PKMN || {};
for (const f of ['js/art/tiles.js', 'js/art/chars.js', 'js/art/tiles-nature.js', 'js/art/tiles-town.js', 'js/art/tiles-interior.js', 'js/art/chars-heroes.js', 'js/art/chars-placeholder.js']) R(f);
// The demo enables the `home` module (project.modules), so its item kind, object
// type and commands have to be registered before the demo can be validated —
// exactly as index.html does before boot.
R('js/modules/home/rules.js'); R('js/modules/home/register.js'); KIT.home.registerAll(KIT);
for (const f of ['js/content/demo/project.js', 'js/content/demo/maps/home.js', 'js/content/demo/maps/garden.js', 'js/content/demo/maps/lab.js', 'js/content/demo/maps/route.js', 'js/content/demo/maps/town.js']) R(f);

function load() {
  const raw = KIT.project.fromContent('demo');
  assert.ok(raw, 'the demo content files loaded');
  const { project, problems } = KIT.project.normalize(raw);
  return { project, problems };
}
function makeWorld(project) {
  const fake = KIT.interpreter.fakeCtx({ project });
  const save = { vars: {}, inventory: {}, objects: {}, heroes: [{}, {}], overlays: {}, meta: {} };
  for (const [k, v] of Object.entries(project.vars || {})) save.vars[k] = v.default;
  const world = KIT.world.create({ project, save, rng: KIT.rng(3),
    ports: { io: fake.io, audio: fake.audio, screen: fake.screen, pictures: fake.pictures, game: fake.game,
      map: Object.assign({}, fake.map, { transfer: (o) => world.enterMap(o.map, o.x, o.y, o.dir) }) } });
  world.said = () => fake.log.filter(e => e.port === 'io' && e.name === 'say').map(e => e.args[0].text);
  world.fake = fake;
  return world;
}

test('demo: normalizes with no errors and validates clean', () => {
  const { project, problems } = load();
  const errors = problems.filter(p => p.severity === 'error');
  assert.deepEqual(errors, []);
  // 'ball' and 'berry' are item kinds the mons module owns; with only `home`
  // loaded the itemKinds registry is not empty, so validate says it has not
  // heard of them. Every other warning would be a real problem.
  const warns = problems.filter(p => p.severity === 'warn');
  assert.deepEqual(warns.filter(p => p.code !== 'unknown-item-kind').map(p => p.code), []);
  assert.ok(Object.keys(project.maps).length >= 4, 'every demo map loaded');
  assert.ok(project.meta.pitch.length > 40, 'the two-sentence pitch is filled in');
  assert.ok(Object.values(project.maps).reduce((n, m) => n + m.objects.length, 0) >= 20);
});

test('demo: exporting again produces identical files (stable, git-friendly)', () => {
  const { project } = load();
  const a = KIT.project.exportFiles(project);
  const b = KIT.project.exportFiles(KIT.project.normalize(KIT.project.fromContent('demo')).project);
  assert.deepEqual(Object.keys(a).sort(), ['maps/garden.js', 'maps/home.js', 'maps/lab.js', 'maps/route.js', 'project.js'].concat(['maps/town.js']).sort());
  for (const k of Object.keys(a)) assert.equal(a[k], b[k], k);
});

test('demo: the intro plays once and Mom hands over the starting items', async () => {
  const { project } = load();
  const world = makeWorld(project);
  await world.enterMap('home', 5, 8, 'up');
  assert.ok(world.said().some(t => /wake up to a bright new morning/.test(t)), 'the intro ran on entry');
  assert.equal(world.save.vars.introDone, true);
  const before = world.said().length;
  await world.runSlotsForMap('enter');
  assert.equal(world.said().length, before, 'it does not run again');
  const mom = world.entities.find(e => e.id === 'mom');
  await world.runSlot(mom, 'interact', 'p1');
  assert.equal(world.save.inventory.pokeball, 5);
  assert.equal(world.save.inventory.berry, 3);
  assert.equal(world.save.vars.chapter, 1);
  world.refreshPages();
  await world.runSlot(world.entities.find(e => e.id === 'mom'), 'interact', 'p1');
  assert.match(world.said().slice(-1)[0], /Professor is waiting/);
});

test('demo: warps carry you between maps and the item is picked up once', async () => {
  const { project } = load();
  const world = makeWorld(project);
  await world.enterMap('home', 5, 8, 'down');
  await world.move(0, 'down');                       // onto the front door
  assert.equal(world.map.id, 'town');
  assert.equal(world.hero().x, 12);
  await world.enterMap('route', 5, 16, 'down');
  await world.move(0, 'down');                       // onto the golden berry
  assert.equal(world.save.inventory['golden-berry'], 1);
  assert.equal(world.save.objects['route:golden-berry'].hidden, true);
  await world.enterMap('route', 5, 16, 'down');
  await world.move(0, 'down');
  assert.equal(world.save.inventory['golden-berry'], 1, 'it is gone for good');
});

test('demo: the starter choice hides the other two stands for good', async () => {
  const { project } = load();
  const world = makeWorld(project);
  await world.enterMap('lab', 7, 8, 'up');
  world.fake.answers.push(0);                        // "Yes"
  const stand = world.entities.find(e => e.id === 'stand-pikachu');
  await world.runSlot(stand, 'interact', 'p1');
  assert.equal(world.save.vars.starter, 'pikachu');
  assert.equal(world.save.vars.hasStarter, true);
  assert.equal(world.save.objects['lab:stand-butterfree'].hidden, true);
  assert.equal(world.save.objects['lab:stand-clefable'].hidden, true);
  await world.enterMap('lab', 7, 8, 'up');
  assert.equal(world.entities.filter(e => e.id.startsWith('stand-')).length, 0);
});

test('demo: town and route are joined by a walk-through connection', async () => {
  const { project } = load();
  const world = makeWorld(project);
  await world.enterMap('town', 12, 17, 'down');
  const r = await world.move(0, 'down');
  assert.equal(r.reason, 'connection');
  assert.equal(world.map.id, 'route');
});

test('a project carries its own art: imported tiles and sprites survive a reload', () => {
  const R = (f) => require(path.join(__dirname, '..', '..', f));
  R('js/kit/core/assets.js');
  const base = KIT.project.blank();
  base.assets = { sheet: { kind: 'image', src: 'assets/sheet.png', w: 64, h: 16 } };
  base.tiles = { 'outside:stone': { id: 'outside:stone', name: 'Stone', group: 'outside', solid: true, art: { image: 'sheet', frame: { x: 16, y: 0, w: 16, h: 16 } } } };
  base.sprites = { 'outside:hero': { id: 'outside:hero', w: 16, h: 24, frames: { down: [[], [], []] }, art: { image: 'sheet' } } };
  const mapId = Object.keys(base.maps)[0];
  base.maps[mapId].layers.ground[0] = 'outside:stone';
  const { project, problems } = KIT.project.normalize(base);
  assert.deepEqual(problems.filter(p => p.severity === 'error'), [], 'the project knows its own tiles');
  assert.ok(KIT.registry('tiles').has('outside:stone'), 'loading a project registers its art');
  assert.ok(KIT.registry('sprites').has('outside:hero'));
  assert.ok(KIT.assets.has('sheet'), 'and its images');
  assert.equal(KIT.tiles.flags('outside:stone').solid, true);
  // and it all survives the content-file round trip
  const back = KIT.project.importFiles(KIT.project.exportFiles(project));
  assert.deepEqual(Object.keys(back.tiles), ['outside:stone']);
  assert.deepEqual(Object.keys(back.assets), ['sheet']);
});
