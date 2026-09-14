'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KIT = require('./_load.js');
const C = KIT.conditions;

function makeCtx(over) {
  const map = {
    id: 'town', width: 4, height: 3,
    layers: { ground: ['grass', 'grass', 'path', 'path', 'grass', 'water', 'path', 'path', 'grass', 'grass', 'grass', 'grass'], deco: new Array(12).fill(null), regions: [0, 0, 3, 3, 0, 0, 3, 3, 0, 0, 0, 0] },
  };
  return Object.assign({
    project: {
      heroes: [{ id: 'p1', name: 'Ava' }, { id: 'p2', name: 'Ben' }],
      vars: { chapter: { type: 'number', default: 0 }, metMom: { type: 'bool', default: false } },
      items: { berry: { name: 'Berry' } }, settings: { coop: { enabled: false } },
    },
    world: {
      save: {
        vars: { chapter: 2, name: 'x' }, inventory: { berry: 3 }, heroes: [{ x: 2, y: 0, dir: 'up' }, { x: 0, y: 0, dir: 'down' }],
        objects: { 'town:mom': { self: { opened: true, count: 2 }, x: 1, y: 1, dir: 'left' } },
        timer: { running: true, secondsLeft: 30 }, clock: { day: 1, minutes: 1300 }, meta: { runs: 2 },
      },
      map, entities: [{ id: 'p1', x: 2, y: 0, dir: 'up' }, { id: 'door', key: 'town:door', x: 3, y: 1, dir: 'down' }],
    },
    self: 'town:mom', hero: 'p1', input: { pressed: (key, hero) => key === 'A' && hero === 'p1' },
  }, over || {});
}

test('every baseline condition kind is registered with fields and test()', () => {
  const kinds = ['var', 'self', 'item', 'facing', 'button', 'timer', 'region', 'tile', 'meta', 'clock', 'coop', 'all', 'any', 'not'];
  for (const k of kinds) {
    const def = KIT.registry('conditions').get(k);
    assert.ok(def, k); assert.ok(Array.isArray(def.fields), k); assert.equal(typeof def.test, 'function', k); assert.equal(typeof def.describe, 'function', k);
  }
  assert.equal(C.test(null, makeCtx()), true);
  assert.equal(C.test(undefined, makeCtx()), true);
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(C.test({ kind: 'nope' }, makeCtx()), false); assert.equal(C.test('junk', makeCtx()), false); } finally { console.warn = warn; }
});

test('var: ops, declared defaults, var-to-var, tolerant compare', () => {
  const ctx = makeCtx();
  assert.equal(C.test({ kind: 'var', name: 'chapter', op: '>=', value: 2 }, ctx), true);
  assert.equal(C.test({ kind: 'var', name: 'chapter', op: '>', value: 2 }, ctx), false);
  assert.equal(C.test({ kind: 'var', name: 'chapter', op: '==', value: '2' }, ctx), true);   // numeric string tolerated
  assert.equal(C.test({ kind: 'var', name: 'chapter', op: '!=', value: 3 }, ctx), true);
  assert.equal(C.test({ kind: 'var', name: 'chapter', op: '<', value: 3 }, ctx), true);
  assert.equal(C.test({ kind: 'var', name: 'chapter', op: '<=', value: 1 }, ctx), false);
  assert.equal(C.test({ kind: 'var', name: 'metMom', op: '==', value: false }, ctx), true);   // declared default
  assert.equal(C.test({ kind: 'var', name: 'unknown', op: '==', value: 0 }, ctx), true);      // undefined reads as 0
  assert.equal(C.test({ kind: 'var', name: 'unknown', op: '==', value: '' }, ctx), true);
  assert.equal(C.test({ kind: 'var', name: 'name', op: '==', value: 'x' }, ctx), true);
  ctx.world.save.vars.other = 2;
  assert.equal(C.test({ kind: 'var', name: 'chapter', op: '==', value: 99, var: 'other' }, ctx), true);
  assert.equal(C.test({ kind: 'var', name: 'chapter' }, ctx), false);                          // op defaults to ==, value undefined -> 0
});

test('self, item, meta, timer, clock, coop, button', () => {
  const ctx = makeCtx();
  assert.equal(C.test({ kind: 'self', key: 'opened', op: '==', value: true }, ctx), true);
  assert.equal(C.test({ kind: 'self', key: 'count', op: '>=', value: 2 }, ctx), true);
  assert.equal(C.test({ kind: 'self', key: 'missing', op: '==', value: false }, ctx), true);
  assert.equal(C.test({ kind: 'self', key: 'opened', value: true }, Object.assign(makeCtx(), { self: null })), false);
  assert.equal(C.test({ kind: 'item', id: 'berry' }, ctx), true);                       // defaults: >= 1
  assert.equal(C.test({ kind: 'item', id: 'berry', op: '>=', count: 4 }, ctx), false);
  assert.equal(C.test({ kind: 'item', id: 'key', op: '==', count: 0 }, ctx), true);
  assert.equal(C.test({ kind: 'meta', key: 'runs', op: '>=', value: 2 }, ctx), true);
  assert.equal(C.test({ kind: 'meta', key: 'runs', op: '>=', value: 3 }, ctx), false);
  assert.equal(C.test({ kind: 'timer', op: '<=', seconds: 30 }, ctx), true);
  assert.equal(C.test({ kind: 'timer', op: '<', seconds: 30 }, ctx), false);
  ctx.world.save.timer.running = false;
  assert.equal(C.test({ kind: 'timer', op: '<=', seconds: 30 }, ctx), false);          // only while running
  assert.equal(C.test({ kind: 'clock', from: 1200, to: 1439 }, ctx), true);
  assert.equal(C.test({ kind: 'clock', from: 0, to: 600 }, ctx), false);
  assert.equal(C.test({ kind: 'clock', from: 1200, to: 300 }, ctx), true);              // wraps midnight
  ctx.world.save.clock.minutes = 1440 + 100;
  assert.equal(C.test({ kind: 'clock', from: 1200, to: 300 }, ctx), true);
  assert.equal(C.test({ kind: 'coop' }, ctx), false);
  assert.equal(C.test({ kind: 'coop' }, Object.assign(makeCtx(), { coop: true })), true);
  const c2 = makeCtx(); c2.project.settings.coop.enabled = true;
  assert.equal(C.test({ kind: 'coop' }, c2), true);
  assert.equal(C.test({ kind: 'button', key: 'A' }, ctx), true);
  assert.equal(C.test({ kind: 'button', key: 'B' }, ctx), false);
  assert.equal(C.test({ kind: 'button', key: 'A' }, Object.assign(makeCtx(), { hero: 'p2' })), false);
  assert.equal(C.test({ kind: 'button', key: 'A' }, Object.assign(makeCtx(), { input: null })), false);
});

test('facing, region, tile: target resolution through entities and the save', () => {
  const ctx = makeCtx();
  assert.equal(C.test({ kind: 'facing', target: 'self', dir: 'left' }, ctx), true);     // from save.objects (no entity)
  assert.equal(C.test({ kind: 'facing', target: 'hero', dir: 'up' }, ctx), true);       // from entity
  assert.equal(C.test({ kind: 'facing', target: 'p2', dir: 'down' }, ctx), true);       // from save.heroes
  assert.equal(C.test({ kind: 'facing', target: 'obj:door', dir: 'down' }, ctx), true); // entity by id
  assert.equal(C.test({ kind: 'facing', target: 'obj:ghost', dir: 'down' }, ctx), false);
  assert.equal(C.test({ kind: 'region', id: 3, target: 'hero' }, ctx), true);           // hero at 2,0 -> region 3
  assert.equal(C.test({ kind: 'region', id: 3, target: 'self' }, ctx), false);          // mom at 1,1 -> 0
  assert.equal(C.test({ kind: 'region', id: 0, target: 'p2' }, ctx), true);
  assert.equal(C.test({ kind: 'tile', layer: 'ground', id: 'path' }, ctx), true);       // under the hero
  assert.equal(C.test({ kind: 'tile', layer: 'ground', id: 'water', at: { x: 1, y: 1 } }, ctx), true);
  assert.equal(C.test({ kind: 'tile', layer: 'deco', id: 'water', at: { x: 1, y: 1 } }, ctx), false);
  // a MapView with methods is preferred
  const c2 = makeCtx({ world: Object.assign(makeCtx().world, { map: { id: 'town', region: () => 7, tileAt: (l, x, y) => `${l}@${x},${y}` } }) });
  assert.equal(C.test({ kind: 'region', id: 7 }, c2), true);
  assert.equal(C.test({ kind: 'tile', layer: 'above', id: 'above@2,0' }, c2), true);
  const t = C.target(ctx, 'self');
  assert.deepEqual([t.id, t.key, t.isHero, t.x, t.y], ['mom', 'town:mom', false, 1, 1]);
  assert.equal(C.target(ctx, 'obj:door').key, 'town:door');
  assert.equal(C.target(Object.assign(makeCtx(), { world: { save: {}, entities: { p1: { id: 'p1', dir: 'left' } } } }), 'hero').dir, 'left');
});

test('all / any / not compose; describe() reads well', () => {
  const ctx = makeCtx();
  const a = { kind: 'var', name: 'chapter', op: '>=', value: 2 }, b = { kind: 'item', id: 'berry' }, c = { kind: 'coop' };
  assert.equal(C.test({ kind: 'all', of: [a, b] }, ctx), true);
  assert.equal(C.test({ kind: 'all', of: [a, b, c] }, ctx), false);
  assert.equal(C.test({ kind: 'any', of: [c, b] }, ctx), true);
  assert.equal(C.test({ kind: 'any', of: [] }, ctx), false);
  assert.equal(C.test({ kind: 'all', of: [] }, ctx), true);
  assert.equal(C.test({ kind: 'not', of: c }, ctx), true);
  assert.equal(C.test({ kind: 'not', of: null }, ctx), false);
  assert.equal(C.test({ kind: 'not', of: { kind: 'any', of: [a, c] } }, ctx), false);
  assert.equal(C.describe({ kind: 'all', of: [a, b] }, ctx), 'chapter ≥ 2 and has Berry');
  assert.equal(C.describe({ kind: 'any', of: [{ kind: 'not', of: c }, { kind: 'all', of: [a, { kind: 'item', id: 'berry', op: '>=', count: 3 }] }] }, ctx), 'not co-op or (chapter ≥ 2 and Berry × ≥ 3)');
  assert.equal(C.describe({ kind: 'self', key: 'opened', op: '==', value: true }), 'self.opened = true');
  assert.equal(C.describe({ kind: 'var', name: 'name', op: '!=', value: 'x' }), 'name ≠ "x"');
  assert.equal(C.describe({ kind: 'var', name: 'a', op: '==', value: 0, var: 'b' }), 'a = b');
  assert.equal(C.describe({ kind: 'item', id: 'berry', op: '==', count: 0 }, ctx), 'no Berry');
  assert.equal(C.describe({ kind: 'facing', target: 'self', dir: 'up' }), 'this object faces up');
  assert.equal(C.describe({ kind: 'facing', target: 'obj:door', dir: 'up' }), 'door faces up');
  assert.equal(C.describe({ kind: 'button', key: 'A' }), 'A pressed');
  assert.equal(C.describe({ kind: 'timer', op: '<=', seconds: 10 }), 'timer ≤ 10s');
  assert.equal(C.describe({ kind: 'region', id: 3, target: 'hero' }), 'the hero in region 3');
  assert.equal(C.describe({ kind: 'tile', layer: 'ground', id: 'grass', at: { x: 1, y: 2 } }), 'ground at 1,2 is grass');
  assert.equal(C.describe({ kind: 'tile', layer: 'ground', id: 'grass' }), 'ground under the hero is grass');
  assert.equal(C.describe({ kind: 'meta', key: 'runs', op: '>=', value: 2 }), 'meta.runs ≥ 2');
  assert.equal(C.describe({ kind: 'clock', from: 1200, to: 360 }), 'between 20:00 and 06:00');
  assert.equal(C.describe(null), 'always');
  assert.equal(C.describe({ kind: 'zzz' }), '(unknown: zzz)');
});

test("schema 'condition' type: unknown kind, field validation, recursion, refs (read), fill", () => {
  const S = KIT.schema;
  if (!KIT.registry('tiles').has('grass')) KIT.registry('tiles').add({ id: 'grass', name: 'Grass' });
  const field = { key: 'when', type: 'condition' };
  assert.deepEqual(S.validateValue(field, null), []);
  assert.equal(S.validateValue(field, { kind: 'nope' })[0].code, 'unknown');
  assert.equal(S.validateValue(field, 'x')[0].code, 'type');
  assert.deepEqual(S.validateValue(field, { kind: 'var', name: 'chapter', op: '>=', value: 2 }, { project: { vars: {} } }), []);
  const errs = S.validateValue(field, { kind: 'all', of: [{ kind: 'var', op: '~', value: 2 }, { kind: 'not', of: { kind: 'item', id: 'x', op: '>=', count: 1 } }, { kind: 'tile', layer: 'sky', id: 'grass' }] }, { project: { items: {} } });
  const codes = errs.map(e => e.path.join('.') + ':' + e.code).sort();
  assert.deepEqual(codes, ['of.0.name:required', 'of.0.op:enum', 'of.1.of.id:ref', 'of.2.layer:enum']);
  assert.equal(S.validateValue(field, { kind: 'var', name: 'x', op: '==', value: { no: 1 } })[0].code, 'type'); // scalar
  const refs = C.refs({ kind: 'any', of: [{ kind: 'var', name: 'chapter', op: '==', value: 0, var: 'other' }, { kind: 'item', id: 'berry' }, { kind: 'not', of: { kind: 'facing', target: 'obj:door', dir: 'up' } }, { kind: 'tile', layer: 'ground', id: 'grass', at: { x: 0, y: 0, map: 'town' } }] });
  assert.deepEqual(refs.map(r => `${r.kind}:${r.id}:${r.access}@${r.path.join('.')}`), ['var:chapter:read@of.0.name', 'var:other:read@of.0.var', 'item:berry:read@of.1.id', 'object:door:read@of.2.of.target', 'tile:grass:read@of.3.id', 'map:town:read@of.3.at.map']);
  assert.ok(refs.every(r => r.access === 'read'));
  const filled = S.fill([field], { when: { kind: 'all', of: [{ kind: 'item', id: 'berry' }, { kind: 'not', of: { kind: 'var', name: 'a' } }] } }).when;
  assert.deepEqual(filled, { kind: 'all', of: [{ kind: 'item', id: 'berry', op: '>=', count: 1 }, { kind: 'not', of: { kind: 'var', name: 'a', op: '==', value: 0, var: null } }] });
  assert.equal(S.defaults([field]).when, null);
  // scalar type
  assert.deepEqual(S.validateValue({ key: 'v', type: 'scalar' }, 'x'), []);
  assert.deepEqual(S.validateValue({ key: 'v', type: 'scalar' }, 3), []);
  assert.equal(S.validateValue({ key: 'v', type: 'scalar' }, [1])[0].code, 'type');
});

test('condition text: toText/parseText are lossless for normalized conditions; errors throw', () => {
  const n = C.normalize;
  const samples = [
    n({ kind: 'var', name: 'chapter', op: '>=', value: 2 }),
    n({ kind: 'var', name: 'name', op: '==', value: 'two words' }),
    n({ kind: 'var', name: 'name', op: '==', value: '12' }),
    n({ kind: 'var', name: 'name', op: '==', value: 'true' }),
    n({ kind: 'var', name: 'metMom', op: '==', value: true }),
    n({ kind: 'var', name: 'a', op: '!=', value: 0, var: 'b' }),
    n({ kind: 'self', key: 'opened', op: '==', value: true }),
    n({ kind: 'item', id: 'berry', op: '>=', count: 3 }),
    n({ kind: 'meta', key: 'runs', op: '>', value: 1 }),
    n({ kind: 'facing', target: 'obj:door', dir: 'up' }),
    n({ kind: 'button', key: 'A' }),
    n({ kind: 'timer', op: '<=', seconds: 10 }),
    n({ kind: 'region', id: 3, target: 'hero' }),
    n({ kind: 'tile', layer: 'ground', id: 'grass', at: { x: 1, y: 2 } }),
    n({ kind: 'tile', layer: 'ground', id: 'grass' }),
    n({ kind: 'clock', from: 1200, to: 300 }),
    n({ kind: 'coop' }),
    n({ kind: 'all', of: [] }), n({ kind: 'any', of: [] }),
    n({ kind: 'all', of: [{ kind: 'coop' }] }),
    n({ kind: 'all', of: [{ kind: 'var', name: 'chapter', op: '>=', value: 2 }, { kind: 'item', id: 'berry' }] }),
    n({ kind: 'any', of: [{ kind: 'all', of: [{ kind: 'coop' }, { kind: 'not', of: { kind: 'self', key: 'done' } }] }, { kind: 'var', name: 'x', op: '<', value: -1 }] }),
    n({ kind: 'not', of: { kind: 'any', of: [{ kind: 'coop' }, { kind: 'coop' }] } }),
    n({ kind: 'not', of: null }),
    n({ kind: 'all', of: [{ kind: 'all', of: [{ kind: 'coop' }, { kind: 'coop' }] }, { kind: 'coop' }] }),
    { kind: 'strange-kind', nested: { a: 1 } },
  ];
  for (const s of samples) {
    const txt = C.toText(s);
    assert.deepEqual(C.parseText(txt), s, txt);
    assert.equal(C.toText(C.parseText(txt)), txt, txt);
  }
  assert.equal(C.toText({ kind: 'all', of: [{ kind: 'var', name: 'chapter', op: '>=', value: 2 }, { kind: 'item', id: 'berry', op: '>=', count: 1 }] }), 'chapter >= 2 and item.berry >= 1');
  assert.equal(C.toText({ kind: 'facing', target: 'self', dir: 'up' }), 'facing(target=self, dir=up)');
  assert.equal(C.toText(null), 'always');
  assert.equal(C.parseText('always'), null);
  assert.equal(C.parseText(''), null);
  assert.deepEqual(C.parseText('never'), { kind: 'any', of: [] });
  assert.deepEqual(C.parseText('chapter = 2'), n({ kind: 'var', name: 'chapter', op: '==', value: 2 }));
  assert.deepEqual(C.parseText('a == 1 and b == 2 or not c == 3'), n({ kind: 'any', of: [{ kind: 'all', of: [{ kind: 'var', name: 'a', op: '==', value: 1 }, { kind: 'var', name: 'b', op: '==', value: 2 }] }, { kind: 'not', of: { kind: 'var', name: 'c', op: '==', value: 3 } }] }));
  assert.deepEqual(C.parseText('{"kind":"coop"}'), { kind: 'coop' });
  assert.deepEqual(C.parseText('chapter == var:other'), n({ kind: 'var', name: 'chapter', op: '==', value: 0, var: 'other' }));
  assert.throws(() => C.parseText('chapter >='), /condition/);
  assert.throws(() => C.parseText('chapter'), /condition/);
  assert.throws(() => C.parseText('(a == 1'), /condition/);
  assert.throws(() => C.parseText('a == 1 b == 2'), /condition/);
  assert.throws(() => C.parseText('item.berry >= many'), /condition/);
  assert.equal(C.tryParseText('a =='), undefined);
  assert.equal(C.tryParseText('always'), null);
});
