'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KIT = require('./_load.js');

test('deepClone / deepEqual / stableStringify', () => {
  const a = { x: [1, { y: 2 }], z: 'q' };
  const b = KIT.deepClone(a);
  assert.deepEqual(a, b); assert.notEqual(a.x, b.x);
  assert.ok(KIT.deepEqual(a, b)); assert.ok(!KIT.deepEqual(a, { x: [1, { y: 3 }], z: 'q' }));
  assert.equal(KIT.stableStringify({ b: 1, a: { d: 1, c: 2 } }), '{"a":{"c":2,"d":1},"b":1}');
  assert.equal(KIT.slug("Mom's House!"), 'moms-house');
});

test('events: on/once/off/emit isolate throwing listeners', () => {
  const bus = KIT.events('t');
  const seen = [];
  bus.on('a', () => { throw new Error('boom'); });
  bus.on('a', (p) => seen.push(p));
  bus.once('a', (p) => seen.push('once:' + p));
  const origError = console.error; console.error = () => {};
  try { assert.equal(bus.emit('a', 1), 2); assert.equal(bus.emit('a', 2), 1); } finally { console.error = origError; }
  assert.deepEqual(seen, [1, 'once:1', 2]);
  bus.on('*', (e, p) => seen.push(e + p)); bus.emit('b', 'x');
  assert.deepEqual(seen.slice(-1), ['bx']);
});

test('rng is deterministic and helpers behave', () => {
  const r1 = KIT.rng('seed'), r2 = KIT.rng('seed');
  assert.equal(r1(), r2());
  assert.equal(KIT.rng(7).int(10), KIT.rng(7).int(10));
  assert.equal(KIT.hash('a', 1), KIT.hash('a', 1)); assert.notEqual(KIT.hash('a', 1), KIT.hash('a', 2));
  const r = KIT.rng(3);
  for (let i = 0; i < 100; i++) { const v = r.range(2, 4); assert.ok(v >= 2 && v <= 4); }
  const w = KIT.rng(5);
  const counts = [0, 0, 0];
  for (let i = 0; i < 3000; i++) counts[w.weighted([{ weight: 1 }, { weight: 0 }, { weight: 2 }])]++;
  assert.equal(counts[1], 0); assert.ok(counts[2] > counts[0]);
  assert.equal(KIT.rng(1).weighted([{ weight: 0 }]), -1);
});

test('registry: define/add/get/remove/listeners/groups + schema validation', () => {
  const r = KIT.defineRegistry('test-things', { fields: [{ key: 'id', type: 'string' }, { key: 'group', type: 'string', optional: true }, { key: 'n', type: 'number', default: 1 }] });
  assert.equal(KIT.defineRegistry('test-things'), r);
  const added = [];
  r.on('add', (d) => added.push(d.id));
  r.add({ id: 'a', group: 'g1', n: 2 }); r.addAll([{ id: 'b', group: 'g2', n: 1 }, { id: 'c', group: 'g1', n: 1 }]);
  assert.throws(() => r.add({ id: 'bad', n: 'x' }), /invalid 'bad'/);
  assert.throws(() => r.add({ n: 1 }), /needs a string id/);
  assert.deepEqual(added, ['a', 'b', 'c']);
  assert.deepEqual(r.ids(), ['a', 'b', 'c']);
  assert.deepEqual(r.groups().map(g => g.group + ':' + g.items.length), ['g1:2', 'g2:1']);
  assert.ok(r.remove('b')); assert.ok(!r.has('b')); assert.equal(r.size(), 2);
  assert.throws(() => KIT.registry('nope'), /unknown registry/);
  assert.throws(() => r.require('zzz'), /unknown id/);
});

test('schema: defaults, validate, when, refs (read/write), fill, walk, ref kinds', () => {
  const S = KIT.schema;
  S.refKind('thing', { has: (id) => id === 'ok' });
  const fields = [
    { key: 'name', type: 'string', min: 1 },
    { key: 'kind', type: 'enum', options: [{ value: 'none', label: 'None' }, { value: 'wander', label: 'Wander' }] },
    { key: 'radius', type: 'number', integer: true, min: 0, max: 9, default: 3, when: { field: 'kind', eq: 'wander' } },
    { key: 'dir', type: 'direction' },
    { key: 'target', type: 'ref:thing' },
    { key: 'v', type: 'ref:var', access: 'write' },
    { key: 'pos', type: 'position', display: 'point' },
    { key: 'items', type: 'list', of: { type: 'group', fields: [{ key: 'id', type: 'ref:thing' }, { key: 'n', type: 'number', default: 1 }] }, array: { max: 2 } },
    { key: 'meta', type: 'group', fields: [{ key: 'note', type: 'note' }, { key: 'color', type: 'color', default: '#ff0000' }] },
  ];
  const d = S.defaults(fields);
  assert.deepEqual(d, { name: '', kind: 'none', radius: 3, dir: 'down', target: null, v: null, pos: { x: 0, y: 0 }, items: [], meta: { note: '', color: '#ff0000' } });
  assert.deepEqual(S.validate(fields, Object.assign({}, d, { name: 'ok' })), []);
  const errs = S.validate(fields, { name: '', kind: 'wander', radius: 2.5, dir: 'north', target: 'nope', v: 'coins', pos: { x: 1 }, items: [{ id: 'ok' }, { id: 'ok', n: 1 }, { id: 'ok', n: 1 }], meta: { note: 1, color: 'red' } });
  const codes = errs.map(e => e.path.join('.') + ':' + e.code).sort();
  assert.deepEqual(codes, ['dir:enum', 'items.0.n:required', 'items:max', 'meta.color:type', 'meta.note:type', 'name:min', 'pos:type', 'radius:integer', 'target:ref'].sort());
  // `when` hides radius when kind != wander
  assert.deepEqual(S.validate(fields, Object.assign({}, d, { name: 'x', radius: 99 })), []);
  const refs = S.refs(fields, { name: 'a', kind: 'none', dir: 'up', target: 'ok', v: 'coins', pos: { x: 0, y: 0, map: 'town' }, items: [{ id: 'ok', n: 1 }], meta: { note: '', color: '#000' } });
  assert.deepEqual(refs.map(r => `${r.kind}:${r.id}:${r.access}@${r.path.join('.')}`), ['thing:ok:read@target', 'var:coins:write@v', 'map:town:read@pos.map', 'thing:ok:read@items.0.id']);
  const filled = S.fill(fields, { name: 'n', items: [{ id: 'ok' }], extra: true });
  assert.equal(filled.items[0].n, 1); assert.equal(filled.meta.color, '#ff0000'); assert.equal(filled.extra, true);
  const visited = [];
  S.walk(fields, filled, (f, v, p) => visited.push(p.join('.')));
  assert.ok(visited.includes('items.0') && visited.includes('meta.color'));
  assert.equal(S.validateValue({ key: 'x', type: 'region' }, 300)[0].code, 'range');
});

test('document: ops, inverses, undo/redo, transactions, watch, snapshots', () => {
  const doc = KIT.document({ maps: { town: { name: 'T', tiles: [1, 2, 3], objects: [] } }, n: 1 });
  const seen = [];
  const off = doc.watch(['maps', 'town'], (c) => seen.push(c.kind + ':' + c.label));
  doc.watch(['maps', 'town', 'name'], (c) => seen.push('name!'));
  doc.set(['maps', 'town', 'name'], 'Town', { label: 'Rename' });
  assert.equal(doc.get(['maps', 'town', 'name']), 'Town');
  assert.deepEqual(seen, ['apply:Rename', 'name!']);
  seen.length = 0;
  doc.set(['n'], 2);                       // unrelated path: town watcher not called
  assert.deepEqual(seen, []);
  doc.transaction('Paint', () => { doc.set(['maps', 'town', 'tiles', 0], 9); doc.set(['maps', 'town', 'tiles', 2], 8); doc.transaction('nested', () => doc.set(['maps', 'town', 'extra'], true)); });
  assert.deepEqual(doc.get(['maps', 'town', 'tiles']), [9, 2, 8]);
  assert.deepEqual(doc.history, ['Rename', 'Edit', 'Paint']);
  assert.ok(doc.undo());
  assert.deepEqual(doc.get(['maps', 'town', 'tiles']), [1, 2, 3]);
  assert.equal(doc.get(['maps', 'town', 'extra']), undefined);     // del inverse of a set-that-created
  assert.ok(!('extra' in doc.get(['maps', 'town'])));
  assert.ok(doc.redo());
  assert.deepEqual(doc.get(['maps', 'town', 'tiles']), [9, 2, 8]);
  assert.equal(doc.get(['maps', 'town', 'extra']), true);
  doc.push(['maps', 'town', 'objects'], { id: 'a' }); doc.push(['maps', 'town', 'objects'], { id: 'b' });
  doc.del(['maps', 'town', 'objects', 0]);
  assert.deepEqual(doc.get(['maps', 'town', 'objects']).map(o => o.id), ['b']);
  doc.undo();
  assert.deepEqual(doc.get(['maps', 'town', 'objects']).map(o => o.id), ['a', 'b']);
  doc.splice(['maps', 'town', 'objects'], 1, 1, [{ id: 'c' }, { id: 'd' }]);
  assert.deepEqual(doc.get(['maps', 'town', 'objects']).map(o => o.id), ['a', 'c', 'd']);
  doc.undo();
  assert.deepEqual(doc.get(['maps', 'town', 'objects']).map(o => o.id), ['a', 'b']);
  const snap = doc.snapshot('before');
  doc.set(['maps', 'town', 'name'], 'Changed');
  assert.ok(doc.restore(snap));
  assert.equal(doc.get(['maps', 'town', 'name']), 'Town');
  doc.undo();
  assert.equal(doc.get(['maps', 'town', 'name']), 'Changed');
  assert.ok(doc.dirty); doc.markClean(); assert.ok(!doc.dirty);
  off();
  assert.throws(() => doc.apply([{ op: 'splice', path: ['n'], index: 0, remove: 0, insert: [] }]), /not an array/);
  assert.throws(() => doc.transaction('x', () => doc.undo()), /inside a transaction/);
  // set creates intermediate objects; inverse removes them cleanly
  doc.set(['deep', 'a', 'b'], 1);
  assert.deepEqual(doc.get(['deep']), { a: { b: 1 } });
  doc.undo();
  assert.deepEqual(doc.get(['deep']), { a: {} });
  assert.deepEqual(KIT.path.parse('maps/town/objects/0/x'), ['maps', 'town', 'objects', 0, 'x']);
});

test('standard registries exist with ref kinds wired', () => {
  for (const n of ['tiles', 'sprites', 'commands', 'conditions', 'objectTypes', 'systems', 'editorPanels', 'migrations', 'strings']) assert.ok(KIT.registry.exists(n), n);
  KIT.registry('tiles').add({ id: 'grass', name: 'Grass', group: 'nature' });
  assert.equal(KIT.schema.refKinds.tile.has('grass'), true);
  assert.equal(KIT.schema.refKinds.tile.has('nope'), false);
  assert.equal(KIT.schema.refKinds.map.has('town', { project: { maps: { town: {} } } }), true);
  assert.equal(KIT.schema.refKinds.var.has('x', { project: { vars: {} } }), null);
  assert.throws(() => KIT.registry('tiles').add({ id: 'Bad Id' }), /ids are letters/);
});
