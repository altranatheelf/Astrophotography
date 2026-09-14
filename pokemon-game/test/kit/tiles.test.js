'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KIT = require('./_load.js');
const T = KIT.tiles;

KIT.registry('tiles').addAll([
  { id: 'grass' }, { id: 'path' }, { id: 'flower' }, { id: 'tree', solid: true }, { id: 'water', solid: true, frames: [['w'], ['w']], palette: { w: '#0000ff' } },
  { id: 'tall-grass', bush: true, encounter: true }, { id: 'ledge-down', ledge: 'down', passage: { n: false } }, { id: 'fence', passage: { n: false, s: false } },
  ...['c', 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'ine', 'inw', 'ise', 'isw'].map(k => ({ id: 'p-' + k })),
  ...['c', 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(k => ({ id: 's-' + k })),
]);

test('flags / passage / frameAt', () => {
  const g = T.flags('grass');
  assert.equal(g.exists, true); assert.equal(g.solid, false); assert.deepEqual(g.passage, { n: true, s: true, e: true, w: true }); assert.equal(g.animated, false);
  assert.equal(T.flags('water').solid, true); assert.equal(T.flags('water').animated, true);
  assert.equal(T.flags('tall-grass').bush, true); assert.equal(T.flags('tall-grass').encounter, true);
  assert.equal(T.flags('ledge-down').ledge, 'down');
  const u = T.flags('nope'); assert.equal(u.exists, false); assert.equal(u.solid, false); assert.equal(u.id, 'nope');
  assert.equal(T.flags(null).exists, false);
  assert.equal(T.passage('grass', 'n'), true); assert.equal(T.passage('water', 'n'), false);
  assert.equal(T.passage('fence', 'n'), false); assert.equal(T.passage('fence', 'e'), true); assert.equal(T.passage('fence', 'up'), false); assert.equal(T.passage('fence', 'left'), true);
  assert.equal(T.passage('ledge-down', 'n'), false); assert.equal(T.passage('ledge-down', 's'), true);
  assert.equal(T.frameAt('water', 0), 0); assert.equal(T.frameAt('water', 600), 1); assert.equal(T.frameAt('water', 1100), 0); assert.equal(T.frameAt('grass', 999), 0);
  assert.equal(T.frameAt({ id: 'x', frames: [[], [], []], animMs: 100 }, 250), 2);
});

const WIZ = { center: 'p-c', n: 'p-n', s: 'p-s', e: 'p-e', w: 'p-w', ne: 'p-ne', nw: 'p-nw', se: 'p-se', sw: 'p-sw', innerNE: 'p-ine', innerNW: 'p-inw', innerSE: 'p-ise', innerSW: 'p-isw' };

function island(extraGroups, size) {
  // size×size (default 7×7) of grass (1) with a 5×5 path (2) island at 1..5
  const w = size || 7, h = size || 7;
  const terrain = new Array(w * h).fill(1);
  for (let y = 1; y <= 5; y++) for (let x = 1; x <= 5; x++) terrain[y * w + x] = 2;
  const map = { id: 'isle', width: w, height: h, layers: { terrain, ground: new Array(w * h).fill(null), deco: new Array(w * h).fill(null) } };
  const project = { terrains: [{ id: 1, name: 'Grass', base: 'grass' }, { id: 2, name: 'Path', base: 'path' }], autotiles: { default: { source: 'terrain', groups: [T.rulesFromTemplate({ groupId: 'path', terrain: 2, tiles: WIZ })].concat(extraGroups || []) } } };
  return { map, project, at: (x, y) => y * w + x };
}

test('wizard: rulesFromTemplate paints a 5×5 island with edges, corners and centre', () => {
  const { map, project, at } = island();
  const g = project.autotiles.default.groups[0];
  assert.equal(g.rules.length, 13); assert.equal(g.rules[0].note, 'innerNE'); assert.equal(g.rules[12].note, 'center');
  assert.deepEqual(g.rules.find(r => r.note === 'n').pattern, [0, -2, 0, 0, 2, 0, 0, 0, 0]);
  const r = T.bake(map, project, { seed: 1 });
  assert.equal(r.ground[at(0, 0)], 'grass');           // terrain 1 base
  assert.equal(r.ground[at(1, 1)], 'p-nw'); assert.equal(r.ground[at(5, 1)], 'p-ne'); assert.equal(r.ground[at(1, 5)], 'p-sw'); assert.equal(r.ground[at(5, 5)], 'p-se');
  assert.equal(r.ground[at(3, 1)], 'p-n'); assert.equal(r.ground[at(3, 5)], 'p-s'); assert.equal(r.ground[at(1, 3)], 'p-w'); assert.equal(r.ground[at(5, 3)], 'p-e');
  assert.equal(r.ground[at(2, 2)], 'p-c'); assert.equal(r.ground[at(3, 3)], 'p-c'); assert.equal(r.ground[at(4, 4)], 'p-c');
  assert.equal(r.changed.length, 49);
  // inner corner: carve a grass notch at (5,5)'s neighbour → (4,4) sees its se neighbour as grass with n/e... use an L: remove (5,5)
  map.layers.terrain[at(5, 5)] = 1;
  const r2 = T.bake(map, project, { seed: 1 });
  assert.equal(r2.ground[at(4, 4)], 'p-ise');
  // map unchanged (pure)
  assert.equal(map.layers.ground[at(3, 3)], null);
});

test('bake is deterministic and local; `around` re-bake equals a full bake', () => {
  const { map, project, at } = island([{ id: 'flowers', name: 'Flowers', active: true, terrain: 1, layer: 'deco', rules: [{ size: 1, pattern: [1], tiles: ['flower', 'tall-grass'], chance: 0.4, breakOnMatch: true }] }], 12);
  const a = T.bake(map, project, { seed: 'x' });
  const b = T.bake(map, project, { seed: 'x' });
  assert.deepEqual(a, b);
  const c = T.bake(map, project, { seed: 'y' });
  assert.notDeepEqual(a.deco, c.deco);
  assert.ok(a.deco.some(d => d === 'flower') && a.deco.some(d => d === 'tall-grass') && a.deco.some(d => d === null));
  assert.ok(a.deco.every((d, i) => map.layers.terrain[i] === 1 || d === null));   // flowers only on grass
  // apply the bake, then edit one terrain cell: only cells within the rule radius (1) change
  const baked = { ...map, layers: { ...map.layers, ground: a.ground, deco: a.deco } };
  baked.layers.terrain = baked.layers.terrain.slice(); baked.layers.terrain[at(3, 3)] = 1;
  const full = T.bake(baked, project, { seed: 'x' });
  for (const i of full.changed) { const x = i % 12, y = Math.floor(i / 12); assert.ok(Math.abs(x - 3) <= 1 && Math.abs(y - 3) <= 1, `cell ${x},${y} changed`); }
  assert.ok(full.changed.includes(at(3, 3)));
  assert.equal(full.ground[at(3, 3)], 'grass'); assert.equal(full.ground[at(2, 2)], 'p-ise');
  const local = T.bake(baked, project, { seed: 'x', around: { x: 3, y: 3 }, radius: T.ruleRadius(project.autotiles.default) });
  assert.deepEqual(local, full);
  assert.equal(T.ruleRadius(project.autotiles.default), 1);
});

test('flip, outOfBounds, modulo, stamp mode and deco ownership', () => {
  // flip x: one rule for the west edge also paints the east edge with tilesX
  const { map, project, at } = island();
  project.autotiles.default.groups = [{ id: 'edges', active: true, terrain: 2, rules: [
    { size: 3, pattern: [0, 0, 0, -2, 2, 0, 0, 0, 0], tiles: ['s-w'], tilesX: ['s-e'], flip: 'x', breakOnMatch: true },
    { size: 3, pattern: [0, -2, 0, 0, 2, 0, 0, 0, 0], tiles: ['s-n'], tilesY: ['s-s'], flip: 'y', breakOnMatch: true },
  ] }];
  let r = T.bake(map, project, { seed: 1 });
  assert.equal(r.ground[at(1, 3)], 's-w'); assert.equal(r.ground[at(5, 3)], 's-e'); assert.equal(r.ground[at(3, 1)], 's-n'); assert.equal(r.ground[at(3, 5)], 's-s'); assert.equal(r.ground[at(3, 3)], 'path');
  // outOfBounds: a path column along the map border — null = rules needing the outside never fire (no edge), 1 = the outside counts as grass (edge)
  for (let y = 0; y < 7; y++) map.layers.terrain[at(0, y)] = 2;
  r = T.bake(map, project, { seed: 1 });
  assert.equal(r.ground[at(0, 3)], 'path');
  project.autotiles.default.groups[0].rules[0].outOfBounds = 1;
  r = T.bake(map, project, { seed: 1 });
  assert.equal(r.ground[at(0, 3)], 's-w');
  // modulo: only even columns
  project.autotiles.default.groups = [{ id: 'm', active: true, terrain: 2, rules: [{ size: 1, pattern: [2], tiles: ['s-c'], modulo: { x: 2, y: 1, ox: 0, oy: 0 } }] }];
  r = T.bake(map, project, { seed: 1 });
  assert.equal(r.ground[at(2, 2)], 's-c'); assert.equal(r.ground[at(3, 2)], 'path'); assert.equal(r.ground[at(4, 2)], 's-c');
  // stamp: a 3×3 block around every cell whose centre is grass surrounded by path... simpler: a 1-cell trigger paints a 3×3
  project.autotiles.default.groups = [{ id: 'st', active: true, terrain: 1, layer: 'deco', rules: [{ size: 3, pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0], mode: 'stamp', tiles: ['tree', null, 'tree', null, 'flower', null, 'tree', null, 'tree'], modulo: { x: 7, y: 7, ox: 3, oy: 0 } }] }];
  r = T.bake(map, project, { seed: 1 });   // fires at (3,0) only (grass); the block's top row falls outside the map
  assert.equal(r.deco[at(3, 0)], 'flower'); assert.equal(r.deco[at(2, 1)], 'tree'); assert.equal(r.deco[at(4, 1)], 'tree'); assert.equal(r.deco[at(3, 1)], null); assert.equal(r.deco[at(4, 0)], null);
  // deco ownership: a hand-placed tree stays, a baked flower is cleared when its cell stops being grass
  project.autotiles.default.groups = [{ id: 'fl', active: true, terrain: 1, layer: 'deco', rules: [{ size: 1, pattern: [1], tiles: ['flower'] }] }];
  const m2 = { ...map, layers: { ...map.layers } };
  m2.layers.deco = map.layers.deco.slice(); m2.layers.deco[at(0, 0)] = 'tree';
  r = T.bake(m2, project, { seed: 1 });
  assert.equal(r.deco[at(0, 0)], 'tree'); assert.equal(r.deco[at(6, 6)], 'flower');
  const m3 = { ...m2, layers: { ...m2.layers, deco: r.deco, terrain: m2.layers.terrain.slice() } };
  m3.layers.terrain[at(6, 6)] = 2;
  r = T.bake(m3, project, { seed: 1 });
  assert.equal(r.deco[at(6, 6)], null); assert.equal(r.deco[at(0, 0)], 'tree');
  // terrain 0 cells are left alone (hand-painted)
  const m4 = { ...m3, layers: { ...m3.layers, terrain: m3.layers.terrain.slice(), ground: m3.layers.ground.slice() } };
  m4.layers.terrain[at(6, 0)] = 0; m4.layers.ground[at(6, 0)] = 'water';
  r = T.bake(m4, project, { seed: 1 });
  assert.equal(r.ground[at(6, 0)], 'water');
  // inactive groups and rules are skipped; a missing set is a no-op
  project.autotiles.default.groups[0].active = false;
  assert.deepEqual(T.bake(m2, project, { seed: 1 }).deco[at(6, 6)], null);
  assert.equal(T.bake(m2, { autotiles: {} }, {}).changed.length, 0);
});

test('remapGroup swaps terrain ids and tile ids', () => {
  const g = T.rulesFromTemplate({ groupId: 'path', terrain: 2, tiles: { center: 'p-c', n: 'p-n' }, against: 1 });
  assert.deepEqual(g.rules.find(r => r.note === 'n').pattern, [0, 1, 0, 0, 2, 0, 0, 0, 0]);
  const s = T.remapGroup(g, 2, 3, { 'p-c': 's-c', 'p-n': 's-n' });
  assert.equal(s.id, 'path-3'); assert.equal(s.terrain, 3);
  assert.deepEqual(s.rules.find(r => r.note === 'n').pattern, [0, 1, 0, 0, 3, 0, 0, 0, 0]);
  assert.deepEqual(s.rules.map(r => r.tiles[0]), ['s-n', 's-c']);
  assert.equal(g.terrain, 2);   // original untouched
  const any = T.rulesFromTemplate({ groupId: 'x', terrain: 5, tiles: { w: 'p-w' } });
  assert.deepEqual(any.rules[0].pattern, [0, 0, 0, -5, 5, 0, 0, 0, 0]);
  assert.deepEqual(T.remapGroup(any, 5, 6, {}).rules[0].pattern, [0, 0, 0, -6, 6, 0, 0, 0, 0]);
});
