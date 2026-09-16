'use strict';
// Atmosphere and camera: the pure parts — fading values, collecting lights,
// and where the camera decides to look.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('./_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));
R('js/kit/world/map.js'); R('js/kit/world/entities.js'); R('js/kit/world/world.js'); R('js/kit/systems/index.js'); R('js/kit/render/atmosphere.js');
const A = KIT.atmosphere;

const tiles = KIT.registry('tiles');
if (!tiles.has('grass')) tiles.add({ id: 'grass', group: 'nature' });

function makeWorld(w, h) {
  const n = w * h;
  const map = { id: 'hall', name: 'Hall', width: w, height: h, kind: 'indoor', music: null, note: '',
    layers: { terrain: new Array(n).fill(0), ground: new Array(n).fill('grass'), deco: new Array(n).fill(null), above: new Array(n).fill(null), regions: new Array(n).fill(0) },
    collision: new Array(n).fill(null), objects: [], props: {} };
  const project = { version: 3, meta: { id: 'x' }, settings: { viewport: { w: 16, h: 12 }, tileSize: 16 },
    heroes: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }], maps: { hall: map }, world: { maps: {}, connections: [] }, vars: {}, items: {}, scripts: {} };
  const world = KIT.world.create({ project, save: { vars: {}, inventory: {}, objects: {}, heroes: [{}, {}], overlays: {} }, ports: {}, rng: KIT.rng(1) });
  world.map = KIT.mapView(project, world.save, 'hall');
  world.viewport = { w: 16, h: 12 };
  world.camera = { x: 0, y: 0, zoom: 1 };
  return world;
}

test('atmosphere: setting, fading and resetting', () => {
  A.reset();
  assert.equal(A.state().darkness, 0);
  A.set({ darkness: 1, ambient: '#000010' });
  assert.equal(A.state().darkness, 1, 'no fade time means it happens at once');
  A.set({ darkness: 0, fog: { color: '#ffffff', amount: 0.4 } }, { ms: 1000 });
  A.update(0.25);
  const quarter = A.state();
  assert.ok(quarter.darkness > 0.6 && quarter.darkness < 0.8, `eased a quarter of the way, got ${quarter.darkness}`);
  assert.ok(quarter.fog.amount > 0 && quarter.fog.amount < 0.4);
  A.update(1);
  assert.equal(A.state().darkness, 0);
  assert.equal(A.state().fog.amount, 0.4);
  A.reset();
  assert.equal(A.state().letterbox, 0);
});

test('atmosphere: a map carries its own, and lights come from anything that has one', () => {
  A.reset();
  const world = makeWorld(20, 20);
  world.project.maps.hall.props.atmosphere = { darkness: 0.9, ambient: '#050a14', vignette: 0.3 };
  A.useMap(world.project.maps.hall);
  assert.equal(A.state().darkness, 0.9);
  assert.equal(A.state().vignette, 0.3);
  const hero = world.hero();
  hero.x = 4; hero.y = 5; hero.px = 4; hero.py = 5;
  hero.data.light = { radius: 4, color: '#ffd9a0' };
  world.entities = [
    Object.assign(KIT.entities.create({ id: 'lamp', x: 9, y: 2 }), { page: { props: { light: { radius: 3 } } } }),
    KIT.entities.create({ id: 'rock', x: 1, y: 1 }),
  ];
  const lights = A.lights(world);
  assert.equal(lights.length, 2);
  assert.deepEqual(lights.map(l => l.radius).sort(), [3, 4]);
  assert.deepEqual([lights.find(l => l.radius === 4).x, lights.find(l => l.radius === 4).y], [4.5, 5.5], 'a light sits at the middle of its tile');
  A.reset();
});

test('camera: follows the hero, holds a point, follows an object, and lets go', () => {
  const world = makeWorld(40, 40);
  const hero = world.hero();
  hero.x = hero.px = 20; hero.y = hero.py = 20;
  KIT.camera.update(world, 0);
  assert.deepEqual([world.camera.x, world.camera.y], [20.5 - 8, 20.5 - 6], 'centred on the hero');
  world.entities = [KIT.entities.create({ id: 'statue', x: 30, y: 30 })];
  KIT.camera.focus(world, { mode: 'follow', target: 'obj:statue', ms: 0 });
  KIT.camera.update(world, 0);
  assert.deepEqual([world.camera.x, world.camera.y], [30.5 - 8, 30.5 - 6], 'centred on the statue');
  KIT.camera.focus(world, { mode: 'point', x: 12, y: 14, ms: 0 });
  KIT.camera.update(world, 0);
  assert.deepEqual([world.camera.x, world.camera.y], [12.5 - 8, 14.5 - 6], 'held on a place');
  KIT.camera.focus(world, { mode: 'point', x: 1, y: 1, ms: 0 });
  KIT.camera.update(world, 0);
  assert.deepEqual([world.camera.x, world.camera.y], [0, 0], 'a place near the corner is clamped to the map');
  KIT.camera.focus(world, { mode: 'release', ms: 0 });
  KIT.camera.update(world, 0);
  assert.deepEqual([world.camera.x, world.camera.y], [20.5 - 8, 20.5 - 6], 'back on the hero');
});

test('camera: zoom changes how much is in frame, and the clamp follows', () => {
  const world = makeWorld(40, 40);
  const hero = world.hero();
  hero.x = hero.px = 1; hero.y = hero.py = 1;
  KIT.camera.focus(world, { zoom: 0.5, ms: 0 });
  KIT.camera.update(world, 0);
  assert.equal(world.camera.zoom, 0.5);
  assert.deepEqual(KIT.camera.viewport(world), { w: 32, h: 24 }, 'pulling back shows twice as much');
  assert.deepEqual([world.camera.x, world.camera.y], [0, 0], 'clamped to the corner, not past it');
  KIT.camera.focus(world, { zoom: 2, ms: 0 });
  KIT.camera.update(world, 0);
  assert.deepEqual(KIT.camera.viewport(world), { w: 8, h: 6 });
  assert.deepEqual([world.camera.x, world.camera.y], [0, 0], 'still in the corner, just closer');
  // a small map is centred rather than clamped
  const small = makeWorld(8, 6);
  KIT.camera.update(small, 0);
  assert.deepEqual([small.camera.x, small.camera.y], [(8 - 16) / 2, (6 - 12) / 2]);
});

test('camera: a move eases over its time instead of jumping', () => {
  const world = makeWorld(40, 40);
  const hero = world.hero();
  hero.x = hero.px = 20; hero.y = hero.py = 20;
  KIT.camera.update(world, 0);
  const from = world.camera.x;
  KIT.camera.focus(world, { mode: 'point', x: 30, y: 20, ms: 1000 });
  KIT.camera.update(world, 0.5);
  const mid = world.camera.x;
  assert.ok(mid > from && mid < 30.5 - 8, `half way, got ${mid}`);
  KIT.camera.update(world, 0.6);
  assert.equal(Math.round(world.camera.x * 10) / 10, Math.round((30.5 - 8) * 10) / 10);
  assert.equal(world.cameraTween, null, 'the move is over');
});
