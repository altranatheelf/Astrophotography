'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('./_load.js');
require(path.join(__dirname, '..', '..', 'js/kit/world/map.js'));

const tiles = KIT.registry('tiles');
for (const t of [
  { id: 'grass', group: 'nature' },
  { id: 'wall', group: 'town', solid: true },
  { id: 'tall-grass', group: 'nature', encounter: true, bush: true },
  { id: 'counter', group: 'interior', solid: true, counter: true },
  { id: 'ledge-down', group: 'nature', ledge: 'down' },
  { id: 'one-way-n', group: 'nature', passage: { n: false, s: true, e: true, w: true } },
  { id: 'plant', group: 'interior', solid: true },
]) if (!tiles.has(t.id)) tiles.add(t);

function makeProject() {
  const w = 6, h = 5, n = w * h;
  const ground = new Array(n).fill('grass');
  const map = { id: 'town', name: 'Town', width: w, height: h, kind: 'outdoor', music: null, note: '',
    layers: { terrain: new Array(n).fill(1), ground, deco: new Array(n).fill(null), above: new Array(n).fill(null), regions: new Array(n).fill(0) },
    collision: new Array(n).fill(null), objects: [], props: {} };
  const at = (x, y) => y * w + x;
  map.layers.deco[at(2, 2)] = 'wall';
  map.layers.ground[at(3, 1)] = 'tall-grass';
  map.layers.deco[at(4, 2)] = 'counter';
  map.layers.ground[at(1, 3)] = 'ledge-down';
  map.layers.ground[at(5, 1)] = 'one-way-n';
  map.layers.regions[at(3, 1)] = 7;
  map.collision[at(0, 4)] = 1;
  map.collision[at(2, 2)] = 0;          // override: the wall cell is walkable after all
  map.collision[at(5, 3)] = 'w';        // closed west edge
  map.objects = [
    { id: 'mom', name: 'Mom', type: 'npc', x: 1, y: 1, note: '', pages: [
      { when: null, sprite: 'woman', dir: 'down', layer: 'same', through: false, dirFix: false, stepAnim: false, visible: true, behaviour: { kind: 'none' }, on: { interact: [{ t: 'say', who: 'Mom', text: 'one' }] }, once: false, needsBoth: false, props: {} },
      { when: { kind: 'var', name: 'chapter', op: '>=', value: 2 }, sprite: 'woman', dir: 'up', layer: 'same', through: false, dirFix: false, stepAnim: false, visible: true, behaviour: { kind: 'none' }, on: { interact: [{ t: 'say', who: 'Mom', text: 'two' }] }, once: false, needsBoth: false, props: {} },
    ] },
  ];
  const route = Object.assign({}, map, { id: 'route', name: 'Route', objects: [], layers: { terrain: new Array(n).fill(1), ground: new Array(n).fill('grass'), deco: new Array(n).fill(null), above: new Array(n).fill(null), regions: new Array(n).fill(0) }, collision: new Array(n).fill(null) });
  return { version: 3, meta: { id: 'demo' }, maps: { town: map, route }, world: { maps: {}, connections: [{ a: 'town', side: 's', b: 'route', offset: 0 }] }, vars: {}, items: {}, scripts: {}, heroes: [{ id: 'p1', name: 'Ash' }] };
}

test('mapView: tiles, flags, regions, overlays', () => {
  const project = makeProject();
  const save = { vars: {}, objects: {}, overlays: { town: { tiles: { '0,0': { deco: 'plant' } } } } };
  const v = KIT.mapView(project, save, 'town');
  assert.equal(v.tileAt('ground', 0, 0), 'grass');
  assert.equal(v.tileAt('deco', 0, 0), 'plant');            // overlay wins
  assert.ok(v.flagsAt(0, 0).solid);                          // the overlay plant is solid
  assert.ok(v.flagsAt(3, 1).encounter && v.flagsAt(3, 1).bush);
  assert.equal(v.region(3, 1), 7);
  assert.equal(v.region(0, 0), 0);
  assert.ok(v.flagsAt(-1, 0).solid);
  assert.deepEqual(v.overlayCells(), [{ x: 0, y: 0 }]);
});

test('mapView: passability — tiles, collision overrides, edges, ledges, entities', () => {
  const project = makeProject();
  const v = KIT.mapView(project, { vars: {}, objects: {} }, 'town');
  assert.equal(v.passable(1, 1, 'right', null).reason, 'step');
  assert.equal(v.passable(2, 1, 'down', null).reason, 'step');      // (2,2) wall but collision override 0
  assert.equal(v.passable(1, 4, 'left', null).reason, 'tile');      // (0,4) collision 1
  assert.equal(v.passable(0, 0, 'up', null).reason, 'edge');        // off the map, no connection north
  assert.equal(v.passable(3, 2, 'right', null).reason, 'tile');     // (4,2) counter is solid
  // one-way tile: cannot enter (5,1) from the north, can from the south
  assert.equal(v.passable(5, 0, 'down', null).reason, 'edge-in');
  assert.equal(v.passable(5, 2, 'up', null).reason, 'step');
  // collision 'w' on (5,3): cannot cross that edge either way
  assert.equal(v.passable(4, 3, 'right', null).reason, 'edge-in');
  assert.equal(v.passable(5, 3, 'left', null).reason, 'edge-out');
  // ledge at (1,3): only from the north, and it hops to (1,4)
  const hop = v.passable(1, 2, 'down', null);
  assert.equal(hop.reason, 'hop');
  assert.deepEqual(hop.hop, { x: 1, y: 4 });
  assert.deepEqual(v.hopTarget(1, 2, 'down'), { x: 1, y: 4 });
  assert.equal(v.passable(1, 4, 'up', null).reason, 'ledge');
  assert.equal(v.passable(0, 3, 'right', null).reason, 'ledge');
  // entities block, `through` walks anywhere
  v.setBlockers([{ x: 3, y: 3, solid: true }]);
  assert.equal(v.passable(2, 3, 'right', null).reason, 'entity');
  assert.equal(v.passable(2, 3, 'right', { through: true }).reason, 'through');
  assert.equal(v.passable(0, 0, 'up', { through: true }).reason, 'edge');   // `through` still cannot leave the map
  v.setBlockers([{ x: 4, y: 4, solid: true, mover: { moving: true, toX: 3, toY: 4 } }]);
  assert.equal(v.passable(2, 4, 'right', null).reason, 'entity');   // the tile being walked into is reserved
});

test('mapView: connections walk into the neighbour map', () => {
  const project = makeProject();
  const v = KIT.mapView(project, { vars: {}, objects: {} }, 'town');
  const r = v.passable(3, 4, 'down', null);
  assert.equal(r.reason, 'connection');
  assert.deepEqual(r.connection, { map: 'route', x: 3, y: 0, dir: 'down' });
  const back = KIT.mapView(project, { vars: {}, objects: {} }, 'route');
  assert.deepEqual(back.passable(3, 0, 'up', null).connection, { map: 'town', x: 3, y: 4, dir: 'up' });
  assert.equal(v.connectionAt(3, 2, 'down'), null);                 // not at the edge
});

test('mapView: objects — last active page wins, state, hidden, interact across a counter', () => {
  const project = makeProject();
  const save = { vars: { chapter: 0 }, objects: {} };
  const v = KIT.mapView(project, save, 'town');
  const mom = v.objectsAt(1, 1)[0];
  assert.equal(v.objectKey(mom), 'town:mom');
  assert.equal(v.activePage(mom, { world: { save } }).index, 0);
  save.vars.chapter = 2;
  assert.equal(v.activePage(mom, { world: { save } }).index, 1);    // the later page wins
  assert.equal(v.activePage(mom, { world: { save } }).page.on.interact[0].text, 'two');
  save.objects['town:mom'] = { self: {}, hidden: true, x: 4, y: 4 };
  assert.ok(v.isHidden(mom));
  assert.deepEqual(v.positionOf(mom), { x: 4, y: 4, dir: null });
  assert.equal(v.objectsAt(1, 1).length, 0);
  assert.equal(v.objectsAt(4, 4)[0].id, 'mom');
  const t = v.interactTarget(3, 2, 'right');
  assert.deepEqual(t.first, { x: 4, y: 2 });
  assert.deepEqual(t.second, { x: 5, y: 2 });                        // reaches across the counter
  assert.ok(t.across);
  assert.equal(v.interactTarget(0, 0, 'up'), null);
});
