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

test('world: something that is not a map object can answer the A button', async () => {
  const world = makeWorld(makeProject());
  await world.enterMap('home', 2, 3, 'down');          // an empty square, facing an empty square

  // nothing is there, so the world says so rather than swallowing the press
  const missed = [];
  world.events.on('interactMissed', (p) => missed.push(p));
  assert.equal(await world.interact(0), false);
  assert.equal(missed.length, 1);
  assert.deepEqual({ x: missed[0].x, y: missed[0].y, dir: missed[0].dir }, { x: 2, y: 4, dir: 'down' });

  // a system puts something there that the map has never heard of
  const talked = [];
  const off = world.addInteractTarget((hero) => {
    assert.equal(hero.id, 'p1', 'it is told which hero pressed');
    return [{ x: 2, y: 4, answer: () => { talked.push('ghost'); return true; } }];
  });
  assert.equal(await world.interact(0), true, 'the ghost answered');
  assert.deepEqual(talked, ['ghost']);
  assert.equal(missed.length, 1, 'and nothing was missed');

  // one that is not where you are looking does not answer
  world.hero().dir = 'up';
  assert.equal(await world.interact(0), false);
  assert.deepEqual(talked, ['ghost']);
  assert.equal(missed.length, 2);

  // a target that declines lets the press fall through to the miss
  world.hero().dir = 'down';
  off();
  world.addInteractTarget(() => [{ x: 2, y: 4, answer: () => false }]);
  assert.equal(await world.interact(0), false);
  assert.equal(missed.length, 3, 'a declined answer is still a miss');

  // and a map object always answers before any of them: Mom is at 3,2
  world.addInteractTarget(() => [{ x: 3, y: 2, answer: () => { talked.push('ghost2'); return true; } }]);
  world.hero().x = 2; world.hero().y = 2; world.hero().dir = 'right';
  assert.equal(await world.interact(0), true);
  assert.deepEqual(world.said().slice(-1), ['Good morning, Ash!']);
  assert.deepEqual(talked, ['ghost'], 'Mom spoke, not the ghost standing on her');
});

test('world: an interact target that throws does not eat the button', async () => {
  const world = makeWorld(makeProject());
  await world.enterMap('home', 2, 3, 'down');
  const before = (KIT.log || console).error;
  (KIT.log || console).error = () => {};
  try {
    world.addInteractTarget(() => { throw new Error('no'); });
    world.addInteractTarget(() => [{ x: 2, y: 4, answer: () => true }]);
    assert.equal(await world.interact(0), true, 'the next one still got its turn');
  } finally { (KIT.log || console).error = before; }
});

test('world: interact can be awaited for the press rather than the conversation', async () => {
  const world = makeWorld(makeProject());
  await world.enterMap('home', 2, 2, 'right');        // facing Mom

  // { wait: false } comes back as soon as the script has started, so anything
  // driving the game from outside is not left waiting for the player.
  const pressed = await world.interact(0, { wait: false });
  assert.equal(pressed, true);
  assert.ok(world.interacting && typeof world.interacting.then === 'function', 'the script is still running');
  await world.interacting;
  assert.deepEqual(world.said().slice(-1), ['Good morning, Ash!'], 'and it finished when we waited for it');

  // the default still waits for the whole thing
  assert.equal(await world.interact(0), true);
  assert.deepEqual(world.said().slice(-1), ['Off you go.']);

  // a press that lands on nothing sets no promise and answers false either way
  world.hero().dir = 'down';
  assert.equal(await world.interact(0, { wait: false }), false);
});

test('world: a map entered by a script’s @transfer still plays its arrival scene, once the script lets go', async () => {
  // The door NPC transfers from inside its own interact slot, so the world is busy
  // when the new map is entered. Its enter/init slots used to be dropped on the
  // floor (and init marked done for the visit); now they wait for the lock.
  const project = makeProject();
  project.maps.home.objects.push({ id: 'door', name: 'Door', type: 'npc', x: 2, y: 3, pages: [page({ on: { interact: body(['@transfer town 1 2 right']) } })] });
  project.maps.town.objects.push({ id: 'welcome', name: 'Welcome', type: 'trigger', x: 0, y: 0, pages: [page({ visible: false, on: { enter: body(['Narrator: Welcome to town.']), init: body(['@set chapter += 10']) } })] });
  const world = makeWorld(project);
  await world.enterMap('home', 2, 2, 'down');
  await world.interact(0);
  await KIT.interpreter.whenIdle();
  await world.drainSlots();
  assert.equal(world.map.id, 'town');
  assert.ok(world.said().includes('Welcome to town.'), `the arrival scene played: ${JSON.stringify(world.said())}`);
  assert.equal(world.save.vars.chapter, 10, 'and init ran, once');
  assert.equal(world.busy, false);
  // arriving the ordinary way (a warp object) behaves the same
  const w2 = makeWorld(project);
  await w2.enterMap('home', 4, 2, 'right');
  await w2.move(0, 'right');
  await KIT.interpreter.whenIdle();
  await w2.drainSlots();
  assert.ok(w2.said().includes('Welcome to town.'));
});

test('world: picking up an item does not send every NPC home', async () => {
  const project = makeProject();
  project.maps.home.objects.push({ id: 'floor-berry', name: 'Berry', type: 'item', x: 3, y: 4, pages: [page({ layer: 'below', through: true, props: { item: 'berry', count: 1, look: null } })] });
  const world = makeWorld(project);
  await world.enterMap('home', 2, 4, 'right');
  const kid = world.entities.find(e => e.id === 'kid');
  kid.x = 4; kid.y = 4; kid.px = 4; kid.py = 4;                 // the wanderer has wandered
  kid.route = [{ dir: 'up' }];                                  // and is mid-route
  const before = world.entities.length;
  await world.move(0, 'right');                                 // onto the berry
  await KIT.interpreter.whenIdle();
  assert.equal(world.save.inventory.berry, 1, 'the berry is in the bag');
  const after = world.entities.find(e => e.id === 'kid');
  assert.equal(after, kid, 'the kid is the same entity');
  assert.deepEqual([after.x, after.y], [4, 4], 'standing where it was, not back at its authored square');
  assert.deepEqual(after.route, [{ dir: 'up' }], 'with its route intact');
  assert.equal(world.entities.length, before - 1, 'and the berry is gone from the map');
});


test('world: an object that answers emits `interact`, the half of interactMissed the docs promised', async () => {
  const world = makeWorld(makeProject());
  await world.enterMap('home', 2, 2, 'right');
  const seen = [];
  world.events.on('interact', (p) => seen.push(p));
  const kid = world.entities.find(e => e.id === 'kid');
  await world.runSlot(kid, 'interact', 'p1');
  assert.equal(seen.length, 1, 'one answer, one event');
  assert.equal(seen[0].hero, 'p1', 'naming the hero who pressed');
  assert.ok(seen[0].object, 'and the object that answered');
  await world.runSlot(kid, 'step', 'p1');
  assert.equal(seen.length, 1, 'other slots are not interactions');
});

test('world × rules: a door that moves you is judged by the map you pressed A on', async () => {
  // `interact` is emitted after its script, so a rule's lines do not talk over
  // the conversation. But a door's script transfers you, and the rule scoped to
  // the map with the door used to be checked on the far side and never fire.
  const raw = {
    version: 3, meta: { id: 'doors', title: 'Doors' },
    heroes: [{ id: 'p1', name: 'Ash', sprite: 'hero-boy' }],
    start: { map: 'home', x: 2, y: 2, dir: 'right' },
    vars: { knocked: { type: 'number', default: 0 }, anywhere: { type: 'number', default: 0 } },
    rules: {
      knock: { when: 'interact', scope: { maps: ['home'] }, do: body(['@set knocked += 1']) },
      any: { when: 'interact', do: body(['@set anywhere += 1']) },
    },
    maps: {
      home: { id: 'home', name: 'Home', width: 8, height: 6, kind: 'indoor', objects: [
        { id: 'door', name: 'Door', type: 'npc', x: 3, y: 2, pages: [page({ on: { interact: body(['@transfer town 1 2 right']) } })] },
      ] },
      town: { id: 'town', name: 'Town', width: 8, height: 6, kind: 'outdoor', objects: [] },
    },
  };
  const { project, problems } = P.normalize(raw);
  assert.deepEqual(problems.filter(p => p.severity === 'error'), []);
  const world = makeWorld(project);
  await world.enterMap('home', 2, 2, 'right');
  const door = world.entities.find(e => e.id === 'door');
  await world.runSlot(door, 'interact', 'p1');
  await world.rulesSettled();
  assert.equal(world.map.id, 'town', 'the door moved the hero');
  assert.equal(world.save.vars.anywhere, 1, 'the unscoped rule fired');
  assert.equal(world.save.vars.knocked, 1, 'and so did the one scoped to the map the door is on');
});

