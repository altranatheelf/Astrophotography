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
for (const f of ['js/content/demo/project.js', 'js/content/demo/maps/home.js', 'js/content/demo/maps/lab.js', 'js/content/demo/maps/route.js', 'js/content/demo/maps/town.js']) R(f);

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
  assert.deepEqual(problems.filter(p => p.severity === 'warn').map(p => p.code), []);
  assert.equal(Object.keys(project.maps).length, 4);
  assert.ok(project.meta.pitch.length > 40, 'the two-sentence pitch is filled in');
  assert.ok(Object.values(project.maps).reduce((n, m) => n + m.objects.length, 0) >= 20);
});

test('demo: exporting again produces identical files (stable, git-friendly)', () => {
  const { project } = load();
  const a = KIT.project.exportFiles(project);
  const b = KIT.project.exportFiles(KIT.project.normalize(KIT.project.fromContent('demo')).project);
  assert.deepEqual(Object.keys(a).sort(), ['maps/home.js', 'maps/lab.js', 'maps/route.js', 'maps/town.js', 'project.js']);
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
