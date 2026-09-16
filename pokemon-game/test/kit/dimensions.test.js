'use strict';
// Layers of reality: the same place, otherwise. Swapping keeps your position and
// your story state and changes the world around you.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('./_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));
R('js/kit/world/map.js'); R('js/kit/world/entities.js'); R('js/kit/world/world.js'); R('js/kit/systems/index.js');

const tiles = KIT.registry('tiles');
for (const t of [{ id: 'floor-wood', group: 'interior' }, { id: 'water', group: 'nature', solid: true }, { id: 'grass', group: 'nature' }]) if (!tiles.has(t.id)) tiles.add(t);

function project() {
  const w = 6, h = 5, n = w * h;
  const page = (o) => Object.assign({ when: null, sprite: null, dir: 'down', layer: 'same', through: false, dirFix: false, stepAnim: false, visible: true, behaviour: { kind: 'none' }, on: {}, once: false, needsBoth: false, props: {} }, o || {});
  const raw = {
    version: 3, meta: { id: 'x', title: 'X' },
    heroes: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }],
    start: { map: 'hall', x: 1, y: 1, dir: 'down' },
    maps: { hall: {
      id: 'hall', name: 'The hall', width: w, height: h, kind: 'indoor', music: 'house',
      layers: { terrain: new Array(n).fill(0), ground: new Array(n).fill('floor-wood'), deco: new Array(n).fill(null), above: new Array(n).fill(null), regions: new Array(n).fill(0) },
      collision: new Array(n).fill(null),
      objects: [
        { id: 'mom', name: 'Mom', type: 'npc', x: 2, y: 2, pages: [page({ on: { interact: [{ t: 'say', who: 'Mom', text: 'Tea?' }] } })] },
        { id: 'ghost', name: 'The other one', type: 'npc', x: 4, y: 2, pages: [page({ on: { interact: [{ t: 'say', who: '', text: 'It does not look up.' }] } })] },
      ],
      dimensions: {
        flooded: {
          name: 'Flooded',
          tiles: { '3,2': { ground: 'water' }, '3,3': { ground: 'water', collision: 1 } },
          objects: { mom: { hidden: true }, ghost: { hidden: false } },
          music: 'cave',
          atmosphere: { darkness: 0.7, ambient: '#06131c' },
        },
      },
    } },
    world: { maps: {}, connections: [] }, vars: {}, items: {}, scripts: {},
  };
  // the ghost is not there in the ordinary world
  raw.maps.hall.objects[1].pages[0].when = { kind: 'dimension', is: 'flooded' };
  const { project: p, problems } = KIT.project.normalize(raw);
  assert.deepEqual(problems.filter(x => x.severity === 'error'), []);
  return p;
}

test('a dimension changes tiles, collision, music and light without touching the map', () => {
  const p = project();
  const plain = KIT.mapView(p, { vars: {}, objects: {} }, 'hall');
  assert.equal(plain.tileAt('ground', 3, 2), 'floor-wood');
  assert.equal(plain.music, 'house');
  assert.equal(plain.dimension, null);
  assert.deepEqual(plain.dimensions, ['flooded']);
  const flooded = KIT.mapView(p, { vars: {}, objects: {}, dimension: 'flooded' }, 'hall');
  assert.equal(flooded.tileAt('ground', 3, 2), 'water');
  assert.ok(flooded.flagsAt(3, 2).solid, 'the water is solid there');
  assert.equal(flooded.collisionAt(3, 3), 1);
  assert.equal(flooded.music, 'cave');
  assert.equal(flooded.atmosphere.darkness, 0.7);
  assert.equal(flooded.tileAt('ground', 0, 0), 'floor-wood', 'everything else is shared');
  assert.equal(p.maps.hall.layers.ground[2 * 6 + 3], 'floor-wood', 'the authored map is untouched');
});

test('a dimension hides and reveals people', () => {
  const p = project();
  const save = { vars: {}, objects: {} };
  const plain = KIT.mapView(p, save, 'hall');
  assert.ok(!plain.isHidden(plain.objects.find(o => o.id === 'mom')));
  save.dimension = 'flooded';
  const flooded = KIT.mapView(p, save, 'hall');
  assert.ok(flooded.isHidden(flooded.objects.find(o => o.id === 'mom')), 'Mom is not in the flooded hall');
  assert.ok(!flooded.isHidden(flooded.objects.find(o => o.id === 'ghost')));
});

test('shifting keeps where you stand and what you have done', async () => {
  const p = project();
  const fake = KIT.interpreter.fakeCtx({ project: p });
  const save = { vars: { met: true }, inventory: { key: 1 }, objects: { 'hall:mom': { self: { done: true } } }, heroes: [{}, {}], overlays: {} };
  const world = KIT.world.create({ project: p, save, rng: KIT.rng(1),
    ports: { io: fake.io, audio: fake.audio, screen: fake.screen, pictures: fake.pictures, game: fake.game, map: fake.map } });
  await world.enterMap('hall', 1, 1, 'down');
  await world.move(0, 'right');
  const where = { x: world.hero().x, y: world.hero().y };
  assert.deepEqual(world.entities.map(e => e.id), ['mom'], 'only Mom is here');
  const changes = [];
  world.events.on('dimensionChanged', (e) => changes.push(e));
  await world.shift('flooded');
  assert.deepEqual({ x: world.hero().x, y: world.hero().y }, where, 'you are standing where you were');
  assert.equal(world.save.vars.met, true);
  assert.equal(world.save.objects['hall:mom'].self.done, true, 'what you did is still done');
  assert.deepEqual(world.entities.map(e => e.id), ['ghost'], 'the other one is here instead');
  assert.equal(world.dimension(), 'flooded');
  assert.deepEqual(changes, [{ map: 'hall', from: null, to: 'flooded' }]);
  assert.ok(fake.calls('audio', 'music').some(c => c.args[0] === 'cave'), 'the music changed with the place');
  await world.shift(null);
  assert.deepEqual(world.entities.map(e => e.id), ['mom']);
  assert.equal(world.dimension(), null);
  await world.shift('nowhere');                       // a layer that does not exist
  assert.equal(world.dimension(), null, 'refused, and said so in the console');
});

test('the dimension condition and the shift command', async () => {
  const p = project();
  const cmds = KIT.screenplay.parse(['@if when: dimension(is=flooded)', '    "The water is up to the sills."', '@else', '    "The hall is dry."', '@end'].join('\n'));
  assert.deepEqual(cmds.problems, []);
  const ctx = KIT.interpreter.fakeCtx({ project: p });
  ctx.world.save.dimension = 'flooded';
  await KIT.interpreter.run(cmds.commands, ctx);
  assert.deepEqual(ctx.said(), ['The water is up to the sills.']);
  const round = KIT.screenplay.parse('@shift flooded effect=fade ms=500');
  assert.deepEqual(round.problems, []);
  assert.deepEqual(round.commands[0], KIT.commands.normalize({ t: 'shift', to: 'flooded', effect: 'fade', ms: 500 }));
  assert.equal(KIT.screenplay.serialize(round.commands), '@shift flooded effect=fade ms=500');
  assert.equal(KIT.screenplay.serialize([KIT.commands.normalize({ t: 'shift', to: '' })]), '@shift back');
});
