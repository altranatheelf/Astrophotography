'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('./_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));
R('js/kit/world/map.js'); R('js/kit/world/entities.js'); R('js/kit/world/world.js'); R('js/kit/systems/index.js');
const P = KIT.project, SP = KIT.screenplay, E = KIT.entities;

const tiles = KIT.registry('tiles');
for (const t of [{ id: 'grass', group: 'nature' }, { id: 'wall', group: 'town', solid: true }, { id: 'floor-wood', group: 'interior' }]) if (!tiles.has(t.id)) tiles.add(t);
const body = (text) => { const r = SP.parse(text.join('\n')); assert.equal(r.problems.length, 0, JSON.stringify(r.problems)); return r.commands; };

function page(extra) {
  return Object.assign({ when: null, sprite: 'woman', dir: 'down', layer: 'same', through: false, dirFix: false, stepAnim: false, visible: true,
    behaviour: { kind: 'none' }, on: {}, once: false, needsBoth: false, props: {} }, extra || {});
}
function makeProject() {
  const raw = {
    version: 3, meta: { id: 'demo', title: 'Demo' },
    heroes: [{ id: 'p1', name: 'Ash', sprite: 'hero-boy' }, { id: 'p2', name: 'Misty', sprite: 'hero-girl' }],
    start: { map: 'home', x: 2, y: 2, dir: 'down' },
    vars: { chapter: { type: 'number', default: 0 }, steps: { type: 'number', default: 0 } },
    items: { berry: { kind: 'berry', name: 'Berry' } },
    scripts: { welcome: { trigger: 'call', when: null, params: [], body: body(['Narrator: Welcome.']) } },
    world: { maps: { home: { x: 0, y: 0 }, town: { x: 1, y: 0 } }, connections: [{ a: 'home', side: 'e', b: 'town', offset: 0 }] },
    maps: {
      home: { id: 'home', name: 'Home', width: 8, height: 6, kind: 'indoor', objects: [
        { id: 'mom', name: 'Mom', type: 'npc', x: 3, y: 2, pages: [
          page({ on: { interact: body(['Mom: Good morning, {p1}!', '@give item=berry count=2', '@set chapter = 1']) }, once: true }),
          page({ when: { kind: 'var', name: 'chapter', op: '>=', value: 1 }, dir: 'up', on: { interact: body(['Mom: Off you go.']) } }),
        ] },
        { id: 'mat', name: 'Mat', type: 'trigger', x: 5, y: 2, pages: [page({ layer: 'below', through: true, visible: false, on: { step: body(['@transfer town 1 2 right']) } })] },
        { id: 'kid', name: 'Kid', type: 'npc', x: 1, y: 4, pages: [page({ behaviour: { kind: 'wander', radius: 2, frequency: 9 }, on: { interact: body(['Kid: hi']) } })] },
        { id: 'gate', name: 'Gate', type: 'npc', x: 6, y: 4, pages: [page({ needsBoth: true, on: { interact: body(['Gate: it opens.']) } })] },
        { id: 'ticker', name: 'Ticker', type: 'trigger', x: 7, y: 5, pages: [page({ visible: false, on: { tick: body(['@set steps += 1']) } })] },
        { id: 'greeter', name: 'Greeter', type: 'trigger', x: 0, y: 0, pages: [page({ visible: false, on: { enter: body(['Narrator: You are home.']), init: body(['@set chapter += 0']) } })] },
      ] },
      town: { id: 'town', name: 'Town', width: 8, height: 6, kind: 'outdoor', objects: [] },
    },
  };
  const { project, problems } = P.normalize(raw);
  assert.deepEqual(problems.filter(p => p.severity === 'error'), []);
  return project;
}
function makeWorld(project, opts) {
  const fake = KIT.interpreter.fakeCtx({ project });
  const save = { vars: {}, inventory: {}, objects: {}, heroes: [{}, {}], overlays: {}, meta: {} };
  for (const [k, v] of Object.entries(project.vars || {})) save.vars[k] = v.default;
  const ports = { io: fake.io, audio: fake.audio, screen: fake.screen, pictures: fake.pictures, game: fake.game,
    map: Object.assign({}, fake.map, { transfer: (o) => { fake.log.push({ port: 'map', name: 'transfer', args: [o] }); return world.enterMap(o.map, o.x, o.y, o.dir); } }) };
  const world = KIT.world.create(Object.assign({ project, save, ports, rng: KIT.rng(5) }, opts || {}));
  world.fake = fake;
  world.said = () => fake.log.filter(e => e.port === 'io' && e.name === 'say').map(e => e.args[0].text);
  return world;
}

test('world: enterMap builds entities from active pages and runs enter/init', async () => {
  const world = makeWorld(makeProject());
  await world.enterMap('home', 2, 2, 'down');
  assert.equal(world.map.id, 'home');
  assert.deepEqual(world.said(), ['You are home.']);
  const ids = world.entities.map(e => e.id).sort();
  assert.deepEqual(ids, ['gate', 'greeter', 'kid', 'mat', 'mom', 'ticker']);
  const mom = world.entities.find(e => e.id === 'mom');
  assert.equal(mom.pageIndex, 0);
  assert.equal(world.hero().x, 2);
  assert.equal(world.save.heroes[0].map, 'home');
});

test('world: interact runs the slot, once locks it, and the later page takes over', async () => {
  const world = makeWorld(makeProject());
  await world.enterMap('home', 2, 2, 'right');
  assert.ok(await world.interact(0));
  assert.deepEqual(world.said().slice(-1), ['Good morning, Ash!']);
  assert.equal(world.save.inventory.berry, 2);
  assert.equal(world.save.vars.chapter, 1);
  assert.equal(world.save.objects['home:mom'].self.done, true);
  const mom = world.entities.find(e => e.id === 'mom');
  assert.equal(mom.pageIndex, 1, 'the chapter>=1 page is now active');
  assert.ok(await world.interact(0));
  assert.deepEqual(world.said().slice(-1), ['Off you go.']);
  assert.ok(await world.interact(0));
  assert.deepEqual(world.said().slice(-1), ['Off you go.'], 'page 2 has no once lock');
});

test('world: stepping fires step slots; a transfer changes map', async () => {
  const world = makeWorld(makeProject());
  await world.enterMap('home', 4, 2, 'right');
  await world.move(0, 'right');
  assert.equal(world.map.id, 'town');
  assert.equal(world.hero().x, 1);
  assert.ok(world.fake.log.some(e => e.name === 'transfer'));
});

test('world: walking off an edge with a connection enters the neighbour map', async () => {
  const world = makeWorld(makeProject());
  await world.enterMap('home', 7, 3, 'right');
  const r = await world.move(0, 'right');
  assert.equal(r.reason, 'connection');
  assert.equal(world.map.id, 'town');
  assert.equal(world.hero().x, 0);
  assert.equal(world.hero().y, 3);
});

test('world: needsBoth blocks unless both heroes are adjacent (co-op)', async () => {
  const project = makeProject();
  project.settings.coop.enabled = true;
  const world = makeWorld(project);
  await world.enterMap('home', 6, 3, 'up');
  const gate = world.entities.find(e => e.id === 'gate');
  world.heroes[1].x = 0; world.heroes[1].y = 0;
  await world.runSlot(gate, 'interact', 'p1');
  assert.ok(!world.said().includes('it opens.'));
  world.heroes[1].x = 6; world.heroes[1].y = 5;
  await world.runSlot(gate, 'interact', 'p1');
  assert.deepEqual(world.said().slice(-1), ['it opens.']);
});

test('world: systems — wander moves the kid, tick slots run in the background, camera clamps', async () => {
  const world = makeWorld(makeProject());
  await world.enterMap('home', 2, 2, 'down');
  const kid = world.entities.find(e => e.id === 'kid');
  const start = `${kid.x},${kid.y}`;
  for (let i = 0; i < 600; i++) world.update(1 / 60);
  assert.notEqual(`${kid.x},${kid.y}`, start, 'the kid wandered');
  assert.ok(Math.abs(kid.x - kid.home.x) <= 2 && Math.abs(kid.y - kid.home.y) <= 2, 'stayed within its radius');
  await new Promise(r => setTimeout(r, 10));
  assert.ok(world.save.vars.steps > 0, 'the tick slot ran');
  world.project.settings.viewport = { w: 16, h: 12 };
  KIT.camera.update(world);
  assert.equal(world.camera.x, (8 - 16) / 2);      // the map is smaller than the viewport: centred
  assert.equal(world.camera.y, (6 - 12) / 2);
});

test('world: a main-thread script locks input while it runs', async () => {
  const world = makeWorld(makeProject());
  await world.enterMap('home', 2, 2, 'right');
  const mom = world.entities.find(e => e.id === 'mom');
  const p = world.runSlot(mom, 'interact', 'p1');
  assert.ok(world.busy);
  assert.equal((await world.move(0, 'left')).reason, 'busy');
  await p;
  assert.ok(!world.busy);
  assert.equal((await world.move(0, 'left')).reason, 'step');
});
