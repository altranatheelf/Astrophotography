// The Dungeon module's rules, in Node. Everything here is a pure function over
// a save, a project or a map view — no DOM, no world loop, no timers.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const KIT = require(path.join(ROOT, 'test/kit/_load.js'));
require(path.join(ROOT, 'js/kit/world/map.js'));
require(path.join(ROOT, 'js/kit/world/entities.js'));
KIT.module = KIT.module || ((def) => def);
for (const f of ['rules', 'art', 'register', 'manifest']) require(path.join(ROOT, 'js/modules/dungeon/' + f + '.js'));
const D = KIT.dungeon;
D.registerAll(KIT);

// ---- a two-room floor to ask questions about ---------------------------------
function floor() {
  const w = 10, h = 8, n = w * h;
  const map = {
    id: 'cell', name: 'Cell', width: w, height: h, kind: 'cave', music: null, note: '',
    layers: {
      terrain: new Array(n).fill(0), ground: new Array(n).fill('dun-floor'),
      deco: new Array(n).fill(null), above: new Array(n).fill(null), regions: new Array(n).fill(0),
    },
    collision: new Array(n).fill(null),
    props: { atmosphere: { darkness: 0.9, ambient: '#05070d' } },
    objects: [
      { id: 'door', name: 'Door', type: 'dungeon-door', x: 5, y: 1, pages: [{ props: { key: 'iron-key', count: 1, consume: true } }] },
      { id: 'block', name: 'Block', type: 'dungeon-block', x: 4, y: 4, pages: [{ props: { look: 'dun-block' } }] },
      { id: 'plate', name: 'Plate', type: 'dungeon-switch', x: 7, y: 4, pages: [{ props: { name: 'gate-a', mode: 'hold' } }] },
      { id: 'gate', name: 'Gate', type: 'dungeon-gate', x: 8, y: 1, pages: [{ props: { needs: 'gate-a' } }] },
    ],
  };
  // a wall along the top row and a ledge on row 6
  for (let x = 0; x < w; x++) map.layers.deco[x] = 'dun-wall';
  for (let x = 0; x < w; x++) map.layers.deco[6 * w + x] = 'dun-ledge-down';
  const { project, problems } = KIT.project.normalize({
    version: 3, meta: { id: 'cellblock', title: 'Cellblock' }, modules: ['dungeon'],
    start: { map: 'cell', x: 4, y: 5, dir: 'up' },
    items: { 'iron-key': { kind: 'item', name: 'Iron Key', icon: 'dun-key', desc: 'Heavy.' } },
    maps: { cell: map },
    packs: { dungeon: D.contentDefaults() },
  });
  floor.problems = problems;
  return project;
}
const blankSave = () => ({ version: 2, vars: {}, inventory: {}, objects: {}, overlays: {}, modules: {} });

// ---- the save slice ------------------------------------------------------------
test('ensure fills the save section and keeps what is already there', () => {
  const save = blankSave();
  const a = D.ensure(save);
  assert.equal(a.version, D.VERSION);
  assert.deepEqual(a.torch, { lit: false, radius: 0 });
  a.switches['gate-a'] = true;
  const b = D.ensure(save);
  assert.equal(b.switches['gate-a'], true, 'a second call does not wipe it');
  assert.equal(save.modules.dungeon, b, 'it lives under save.modules.dungeon');
});

test('ensure survives rubbish', () => {
  const data = D.ensure({ modules: { dungeon: { torch: 'no', blocks: 7, switches: null, pushes: 'lots' } } });
  assert.equal(data.torch.lit, false);
  assert.deepEqual(data.blocks, {});
  assert.deepEqual(data.switches, {});
  assert.equal(data.pushes, 0);
  assert.doesNotThrow(() => D.ensure(null));
});

// ---- keys and doors --------------------------------------------------------------
test('a locked door needs its key, and stays open once it is open', () => {
  const save = blankSave();
  const props = { key: 'iron-key', count: 1, consume: true };
  let r = D.tryOpen(save, 'cell:door', props);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'locked');

  save.inventory['iron-key'] = 1;
  r = D.tryOpen(save, 'cell:door', props);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'opened');
  assert.equal(r.count, 1, 'the key is used up');

  save.objects['cell:door'] = { self: { opened: true } };
  r = D.tryOpen(save, 'cell:door', props);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'already');
  assert.equal(r.count, 0, 'opening it twice does not cost a second key');
});

test('a door with no key opens for anyone; consume:false keeps the key', () => {
  const save = blankSave();
  assert.equal(D.tryOpen(save, 'a:b', {}).ok, true);
  save.inventory['iron-key'] = 1;
  const r = D.tryOpen(save, 'a:c', { key: 'iron-key', consume: false });
  assert.equal(r.ok, true);
  assert.equal(r.count, 0);
});

test('two keys are needed when the door says so', () => {
  const save = blankSave();
  save.inventory['iron-key'] = 1;
  assert.equal(D.tryOpen(save, 'a:b', { key: 'iron-key', count: 2 }).ok, false);
  save.inventory['iron-key'] = 2;
  const r = D.tryOpen(save, 'a:b', { key: 'iron-key', count: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
});

// ---- pushing ---------------------------------------------------------------------
test('a block slides into open floor and stops at walls, edges, ledges and things', () => {
  const project = floor();
  const view = KIT.mapView(project, null, 'cell');

  assert.equal(D.canPush(view, { x: 4, y: 4 }, 'left').ok, true, 'open floor');
  assert.equal(D.canPush(view, { x: 4, y: 1 }, 'up').reason, 'tile', 'the wall row');
  assert.equal(D.canPush(view, { x: 0, y: 4 }, 'left').reason, 'edge', 'off the map');
  assert.equal(D.canPush(view, { x: 4, y: 5 }, 'down').reason, 'ledge', 'never over a ledge');
  assert.equal(D.canPush(view, { x: 4, y: 4 }, 'sideways').reason, 'direction');

  const other = { x: 3, y: 4, solid: true, through: false, visible: true };
  const me = { x: 4, y: 4, solid: true };
  assert.equal(D.canPush(view, me, 'left', { ignore: me, blockers: [me, other] }).reason, 'entity');
  assert.equal(D.canPush(view, me, 'right', { ignore: me, blockers: [me, other] }).ok, true);
});

test('where a block was left is remembered, and nothing else is', () => {
  const data = D.defaults();
  assert.deepEqual(D.blockAt(data, 'cell:block', { x: 4, y: 4 }), { x: 4, y: 4 }, 'unpushed = where it was drawn');
  D.setBlock(data, 'cell:block', 6, 4);
  assert.deepEqual(D.blockAt(data, 'cell:block', { x: 4, y: 4 }), { x: 6, y: 4 });
  assert.deepEqual(Object.keys(data.blocks), ['cell:block'], 'only blocks that moved are stored');
});

// ---- switches and gates -------------------------------------------------------------
test('a plate is down while something heavy is on it', () => {
  const cell = { x: 7, y: 4 };
  assert.equal(D.plateHeld(cell, [{ x: 7, y: 4, kind: 'hero' }]), true);
  assert.equal(D.plateHeld(cell, [{ x: 7, y: 5, kind: 'hero' }]), false);
  assert.equal(D.plateHeld(cell, [{ x: 7, y: 4, kind: 'block' }], ['hero']), false, 'holders says what counts');
  assert.equal(D.plateHeld(cell, [{ x: 7, y: 4, kind: 'block' }], ['block']), true);
});

test('setSwitch reports whether anything actually changed', () => {
  const data = D.defaults();
  assert.equal(D.setSwitch(data, 'gate-a', true), true);
  assert.equal(D.setSwitch(data, 'gate-a', true), false, 'no change, no noise');
  assert.equal(D.setSwitch(data, 'gate-a', false), true);
});

test('a gate needs every switch it lists, and invert turns it round', () => {
  const data = D.defaults();
  assert.equal(D.gateOpen(data, 'a,b'), false);
  D.setSwitch(data, 'a', true);
  assert.equal(D.gateOpen(data, 'a,b'), false, 'one of two is not enough');
  D.setSwitch(data, 'b', true);
  assert.equal(D.gateOpen(data, 'a,b'), true);
  assert.equal(D.gateOpen(data, ['a', 'b']), true, 'a list works as well as a comma string');
  assert.equal(D.gateOpen(data, 'a,b', true), false, 'inverted');
  assert.equal(D.gateOpen(data, ''), false, 'a gate that listens for nothing never opens');
});

test('switchNames reads the plate names straight off the maps', () => {
  assert.deepEqual(D.switchNames(floor()), ['gate-a']);
  assert.deepEqual(D.switchNames({}), []);
});

// ---- the lantern -----------------------------------------------------------------------
test('the lantern lights, reaches as far as the numbers say, and goes out', () => {
  const data = D.defaults();
  const tuning = D.tuning(floor());
  assert.equal(D.torchLight(data, tuning), null, 'out to begin with');
  D.lightTorch(data, 0);
  const light = D.torchLight(data, tuning);
  assert.equal(light.radius, 1, 'a radius of 0 is nudged to 1, never to nothing');
  D.lightTorch(data, tuning.torchRadius);
  assert.equal(D.torchLight(data, tuning).radius, tuning.torchRadius);
  assert.equal(D.torchLight(data, tuning).color, tuning.torchColor);
  D.putOut(data);
  assert.equal(D.torchLight(data, tuning), null);
});

test('a dark map is one that says it is dark', () => {
  const project = floor();
  assert.equal(D.isDark(project.maps.cell), true);
  assert.equal(D.isDark({ props: {} }), false);
  assert.equal(D.isDark(null), false);
});

// ---- content and validation ---------------------------------------------------------------
test('the tuning falls back to its defaults, field by field', () => {
  const defs = D.contentDefaults();
  assert.equal(D.tuning({}).darkness, defs.darkness);
  assert.equal(D.tuning({ packs: { dungeon: { darkness: 0.5 } } }).darkness, 0.5);
  assert.equal(D.tuning({ packs: { dungeon: { darkness: 0.5 } } }).torchRadius, defs.torchRadius, 'the rest still has defaults');
  assert.equal(D.tuning({ packs: { dungeon: { pushSound: null } } }).pushSound, null, 'a nulled sound stays silent');
});

test('the object types, the commands, the condition and the behaviour are all registered', () => {
  for (const id of ['dungeon-door', 'dungeon-block', 'dungeon-switch', 'dungeon-gate']) {
    assert.ok(KIT.registry('objectTypes').get(id), id + ' is an object type');
  }
  for (const id of ['openDoor', 'pushBlock', 'torch', 'setSwitch']) assert.ok(KIT.commands.get(id), id + ' is a command');
  assert.ok(KIT.registry('conditions').get('switch'), 'the switch condition');
  assert.ok(KIT.registry('conditions').get('torchLit'), 'the torchLit condition');
  assert.ok(KIT.registry('behaviours').get('pace'), 'the pace behaviour');
  assert.ok(KIT.registry('systems').get('dungeon'), 'the dungeon system');
  for (const id of D.TILE_IDS) assert.ok(KIT.registry('tiles').has(id), id + ' is a tile');
});

test('the switch condition reads the module save, not a project variable', () => {
  const def = KIT.registry('conditions').get('switch');
  const save = blankSave();
  assert.equal(def.test({ kind: 'switch', name: 'gate-a' }, { world: { save } }), false);
  D.setSwitch(D.ensure(save), 'gate-a', true);
  assert.equal(def.test({ kind: 'switch', name: 'gate-a' }, { world: { save } }), true);
  assert.equal(def.test({ kind: 'switch', name: 'gate-a', is: false }, { world: { save } }), false);
});

test('a floor built out of these object types normalizes with no errors', () => {
  floor();
  const errors = floor.problems.filter(p => p.severity === 'error');
  assert.deepEqual(errors, [], JSON.stringify(errors));
});

test('the validator notices a gate that waits for a switch nobody sets', () => {
  const def = KIT.registry('validators').get('dungeon');
  const project = floor();
  assert.deepEqual(def.run(project), [], 'the wired floor is clean');
  project.maps.cell.objects.find(o => o.id === 'gate').pages[0].props.needs = 'ghost';
  const problems = def.run(project);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].code, 'dungeon-no-switch');
  project.maps.cell.objects.find(o => o.id === 'gate').pages[0].props.needs = '';
  assert.equal(def.run(project)[0].code, 'dungeon-gate-empty');
});

test('describe counts what is on the floor and what has happened to it', () => {
  const project = floor();
  const save = blankSave();
  let r = D.describe(project, save);
  assert.deepEqual(r, { doors: 1, opened: 0, blocks: 1, moved: 0, switches: 1, held: 0, gates: 1, open: 0 });
  save.objects['cell:door'] = { self: { opened: true } };
  D.setBlock(D.ensure(save), 'cell:block', 5, 4);
  D.setSwitch(D.ensure(save), 'gate-a', true);
  r = D.describe(project, save);
  assert.deepEqual(r, { doors: 1, opened: 1, blocks: 1, moved: 1, switches: 1, held: 1, gates: 1, open: 1 });
});

test('the manifest declares a save section and a content slice', () => {
  const m = D.MANIFEST;
  assert.equal(m.id, 'dungeon');
  assert.equal(m.save.key, 'dungeon');
  assert.equal(m.content.key, 'dungeon');
  assert.deepEqual(m.save.defaults(), D.defaults());
  assert.deepEqual(m.content.defaults(), D.contentDefaults());
  assert.deepEqual(m.requires, []);
});
