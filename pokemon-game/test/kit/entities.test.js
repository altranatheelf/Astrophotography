'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('./_load.js');
require(path.join(__dirname, '..', '..', 'js/kit/world/map.js'));
require(path.join(__dirname, '..', '..', 'js/kit/world/entities.js'));
const E = KIT.entities;

const tiles = KIT.registry('tiles');
for (const t of [{ id: 'grass', group: 'nature' }, { id: 'wall', group: 'town', solid: true }, { id: 'ledge-down', group: 'nature', ledge: 'down' }]) if (!tiles.has(t.id)) tiles.add(t);

function view(w, h, solids, ledges) {
  const n = w * h;
  const ground = new Array(n).fill('grass');
  for (const [x, y] of solids || []) ground[y * w + x] = 'wall';
  for (const [x, y] of ledges || []) ground[y * w + x] = 'ledge-down';
  const map = { id: 'm', name: 'M', width: w, height: h, kind: 'outdoor', music: null, note: '', layers: { terrain: new Array(n).fill(1), ground, deco: new Array(n).fill(null), above: new Array(n).fill(null), regions: new Array(n).fill(0) }, collision: new Array(n).fill(null), objects: [], props: {} };
  return KIT.mapView({ version: 3, meta: { id: 'x' }, maps: { m: map }, world: { maps: {}, connections: [] } }, { vars: {}, objects: {} }, 'm');
}
const run = (e, seconds, dt) => { const step = dt || 1 / 60; for (let t = 0; t < seconds; t += step) E.update(e, step); };

test('entities: move, block, turn, interpolate, walk cycle', () => {
  const v = view(5, 5, [[2, 1]]);
  const e = E.create({ id: 'hero', kind: 'hero', x: 1, y: 1, dir: 'down', speed: 10 });
  assert.equal(E.tryMove(e, 'right', v).reason, 'tile');    // wall
  assert.equal(e.dir, 'right');                             // still turned
  assert.ok(e.blocked);
  assert.equal(E.tryMove(e, 'down', v).reason, 'step');
  assert.equal(e.x, 1); assert.equal(e.y, 2);               // logical position is immediate
  assert.ok(e.py > 1 && e.py < 2 || e.py === 1);            // px/py interpolate
  assert.equal(E.tryMove(e, 'down', v).reason, 'busy');     // one move at a time
  run(e, 0.2);
  assert.equal(e.py, 2);
  assert.ok(!e.mover.moving);
  assert.equal(e.stepCount, 1);
  assert.equal(E.tryMove(e, 'up', v, { turnOnly: true }).reason, 'turn');
  assert.equal(e.dir, 'up'); assert.equal(e.y, 2);
  const fixed = E.create({ id: 'f', x: 0, y: 0, dirFix: true, dir: 'down' });
  E.tryMove(fixed, 'right', v);
  assert.equal(fixed.dir, 'down');                          // direction fix
  assert.equal(fixed.x, 1);
});

test('entities: ledge hop arcs over two tiles', () => {
  const v = view(5, 5, [], [[1, 2]]);
  const e = E.create({ id: 'h', x: 1, y: 1, speed: 10 });
  const r = E.tryMove(e, 'down', v);
  assert.equal(r.reason, 'hop');
  assert.equal(e.y, 3);
  E.update(e, 0.1);
  assert.ok(e.py < 3 - 0.2, 'arcs upward mid-hop');
  run(e, 0.3);
  assert.equal(e.py, 3);
});

test('entities: move routes — steps, wait, skipBlocked, repeat, face, sprite', () => {
  const v = view(6, 6, [[3, 1]]);
  const e = E.create({ id: 'npc', x: 1, y: 1, speed: 20 });
  const sounds = [];
  const ports = { sound: (id) => sounds.push(id), hero: { x: 1, y: 4 } };
  E.startRoute(e, ['right', 'right', 'face:up', 'sound:blip', 'wait:100', 'down'], { skipBlocked: true });
  for (let i = 0; i < 400 && e.route; i++) { E.update(e, 1 / 60); E.updateRoute(e, 1 / 60, v, ports); }
  assert.equal(e.x, 2, 'the second right was blocked by the wall and skipped');
  assert.equal(e.y, 2);
  assert.deepEqual(sounds, ['blip']);
  assert.equal(e.route, null);
  // repeat runs forever
  const e2 = E.create({ id: 'n2', x: 1, y: 1, speed: 20 });
  E.startRoute(e2, ['down', 'up'], { repeat: true });
  for (let i = 0; i < 400; i++) { E.update(e2, 1 / 60); E.updateRoute(e2, 1 / 60, v, ports); }
  assert.ok(e2.route && !e2.route.done);
  // towardHero / faceHero / jump / speed / visible
  const e3 = E.create({ id: 'n3', x: 1, y: 1, speed: 20 });
  E.startRoute(e3, ['towardHero', 'faceHero', 'speed:9', 'visible:off', 'jump:0,-1'], {});
  for (let i = 0; i < 400 && e3.route; i++) { E.update(e3, 1 / 60); E.updateRoute(e3, 1 / 60, v, ports); }
  assert.equal(e3.speed, 9);
  assert.equal(e3.visible, false);
  assert.equal(e3.y, 1);       // stepped down toward the hero, then jumped back up
});

test('entities: companion follows the leader trail one tile behind', () => {
  const v = view(8, 8);
  const lead = E.create({ id: 'hero', x: 2, y: 2, speed: 20 });
  const comp = E.create({ id: 'comp', kind: 'companion', x: 2, y: 2, speed: 20, solid: false });
  const walk = (dir) => {
    E.tryMove(lead, dir, v);
    for (let i = 0; i < 60; i++) { if (E.update(lead, 1 / 60) === 'arrived') E.noteLeaderStep(comp, lead); E.updateCompanion(comp, lead, 1 / 60, v); E.update(comp, 1 / 60); }
  };
  walk('right'); walk('right'); walk('down');
  assert.deepEqual([lead.x, lead.y], [4, 3]);
  assert.deepEqual([comp.x, comp.y], [4, 2], 'one tile behind, on the leader path');
  // a warp teleports the companion instead of walking it across the map
  lead.x = 7; lead.y = 7; comp.data.trail = [{ x: 7, y: 7 }];
  E.updateCompanion(comp, lead, 1 / 60, v);
  assert.deepEqual([comp.x, comp.y], [7, 7]);
});
