'use strict';
// SAVES AS A TREE.
//
// Two things are being pinned here and they are not the same kind of thing.
//
// The delta is ARITHMETIC: it either reproduces the save exactly or the player
// loses their game, and there is no middle. So it is tested the way arithmetic
// is tested — including with a seeded sequence of a hundred edits, because the
// cases that break a diff are the ones nobody thinks to write down.
//
// The tree is DESIGN: what a branch is, what gets thrown away when the store
// fills up, and what "somewhere else" means. Those are choices, so each test
// names the choice it is pinning.
const test = require('node:test');
const assert = require('node:assert/strict');
const KIT = require('./_load.js');
const T = KIT.timeline;

const fresh = () => T._setTree(null);
/** A save shaped like a real one: the parts that actually move. */
function save0() {
  return {
    vars: { chapter: 0, steps: 0 }, inventory: {}, objects: {}, overlays: {},
    heroes: [{ map: 'home', x: 2, y: 2, dir: 'down' }, { map: 'home', x: 2, y: 3, dir: 'down' }],
    clock: { day: 1, minutes: 480 }, log: { n: 0, entries: [], tally: {} }, dimension: null, rules: {},
  };
}
/** What one stretch of play does to a save. */
function play(s, i) {
  const out = KIT.deepClone(s);
  out.vars.steps = i;
  out.heroes[0].x = 2 + (i % 9);
  out.clock.minutes += 5;
  out.objects['home:npc' + (i % 4)] = { self: { talks: i } };
  KIT.history.add(out, 'walked', { what: 'north' });
  return out;
}

// ---- the delta: arithmetic ---------------------------------------------------

test('delta: sets, deletes and nested objects', () => {
  const a = { x: 1, keep: 'me', deep: { a: 1, b: 2 }, gone: true };
  const b = { x: 2, keep: 'me', deep: { a: 1, b: 3, c: 4 } };
  const d = T.diff(a, b);
  assert.deepEqual(T.patch(a, d), b);
  assert.ok(!JSON.stringify(d).includes('"keep"'), 'what did not change is not in the delta');
  assert.ok(JSON.stringify(d).includes('"x":1'), 'a delete is marked, not guessed at');
});

test('delta: patch does not touch what it was given', () => {
  const a = { deep: { list: [1, 2, 3] } };
  const frozen = JSON.stringify(a);
  const b = T.patch(a, T.diff(a, { deep: { list: [1, 2, 4] } }));
  assert.equal(JSON.stringify(a), frozen, 'the base is the same object it was');
  assert.deepEqual(b.deep.list, [1, 2, 4]);
});

test('delta: a bounded list that shifts costs one entry, not the whole list', () => {
  // THE REASON THE `cut` OP EXISTS. The history window (ADR-0011) drops its
  // oldest as it gains its newest, so between two saves it is the same 399
  // entries at different indices. A prefix/suffix diff calls that "everything
  // changed" and writes 40KB into every single moment.
  const a = { log: { entries: [] } };
  for (let i = 1; i <= 400; i++) a.log.entries.push({ n: i, verb: 'walked', what: 'north', where: 'home' });
  const b = KIT.deepClone(a);
  b.log.entries.shift();
  b.log.entries.push({ n: 401, verb: 'walked', what: 'north', where: 'home' });
  const d = T.diff(a, b);
  assert.deepEqual(T.patch(a, d), b, 'and it is still exactly right');
  const bytes = JSON.stringify(d).length;
  assert.ok(bytes < 200, `one entry's worth, not four hundred (${bytes} bytes)`);
  assert.equal(d.length, 1);
  assert.equal(d[0].cut, 1);
  assert.equal(d[0].add.length, 1);
});

test('delta: a fixed-size array is compared item by item when that is smaller', () => {
  // DEFAULT: three encodings are measured and the smallest wins. Which one that
  // is depends entirely on what the array is for, so it is measured rather than
  // decided in advance.
  const a = { heroes: [{ x: 1, y: 2, dir: 'down', map: 'home' }, { x: 1, y: 3, dir: 'down', map: 'home' }] };
  const b = KIT.deepClone(a);
  b.heroes[0].x = 5;
  const d = T.diff(a, b);
  assert.deepEqual(T.patch(a, d), b);
  assert.deepEqual(d, [{ p: ['heroes', 0, 'x'], v: 5 }], 'one number, not two heroes');
});

test('delta: a hundred rounds of play round-trip exactly', () => {
  // Seeded, so a failure is reproducible, and long enough to wander into the
  // shapes nobody writes a test for: a key appearing, a key going away, a list
  // filling up and then shifting, a number becoming a string.
  const rng = KIT.rng(20260917);
  let s = save0();
  for (let i = 0; i < 100; i++) {
    const next = play(s, i);
    if (rng() < 0.2) next.overlays['home'] = { tiles: { [`${i},${i}`]: { ground: 'grass' } } };
    if (rng() < 0.1) delete next.objects['home:npc0'];
    if (rng() < 0.1) next.vars.chapter = 'chapter ' + i;          // a number becomes a string
    if (rng() < 0.1) next.dimension = rng() < 0.5 ? 'dream' : null;
    if (rng() < 0.1) next.heroes.push({ map: 'home', x: 0, y: 0, dir: 'up' });
    if (rng() < 0.1 && next.heroes.length > 2) next.heroes.pop();
    const d = T.diff(s, next);
    assert.deepEqual(T.patch(s, d), next, `round ${i}`);
    s = next;
  }
});

// ---- the tree: design --------------------------------------------------------

test('moments: a moment remembers the save exactly, however deep it is', () => {
  fresh();
  let s = save0();
  const ids = [], want = [];
  for (let i = 0; i < 40; i++) { s = play(s, i); ids.push(T.record(s, {})); want.push(JSON.stringify(s)); }
  for (const i of [0, 1, 17, 38, 39]) {
    assert.equal(JSON.stringify(T.rebuild(ids[i])), want[i], `moment ${i} came back exactly`);
  }
});

test('moments: playing on from an older moment makes a branch, not an overwrite', () => {
  // THE WHOLE POINT. Every engine's answer to "go back and try the other thing"
  // is to overwrite the save you came from. Here nothing is lost.
  fresh();
  let s = save0();
  const line = [];
  for (let i = 0; i < 6; i++) { s = play(s, i); line.push(T.record(s, {})); }
  const before = T.count();

  let back = T.goto(line[2]);
  assert.ok(back, 'walked back to the third moment');
  assert.equal(T.head(), line[2]);
  back.vars.chapter = 'the other way';
  const other = T.record(back, { label: 'the other way' });

  assert.equal(T.count(), before + 1, 'nothing was taken away to make room for it');
  assert.equal(T.node(other).p, line[2], 'it grows out of the moment we went back to');
  assert.deepEqual(T.children(line[2]).sort(), [line[3], other].sort(), 'which now has two futures');
  assert.equal(JSON.stringify(T.rebuild(line[5])), JSON.stringify(s), 'and the line we left is still exactly there');
});

test('moments: goto stamps the save so the next one branches from it', () => {
  fresh();
  let s = save0();
  const a = T.record(play(s, 1), {});
  const b = T.record(play(s, 2), {});
  const back = T.goto(a);
  assert.equal(back.moment, a, 'the save knows which moment it is');
  assert.equal(T.headTo(b), true);
  assert.equal(T.head(), b, 'and headTo can stand somewhere without rebuilding it');
  assert.equal(T.headTo('nowhere'), false, 'but not somewhere that is not there');
});

test('moments: a whole save is kept only when the deltas have cost as much as one', () => {
  // DEFAULT: not every Nth moment — the experiment measured that answer and
  // refused it, because at one anchor every twelve the anchors were 592KB of a
  // 1.1MB tree. The rule is the economics: a chain of deltas may not cost more
  // than the save it stands in for.
  fresh();
  // A big save with small changes earns a long chain.
  let big = save0();
  big.overlays.home = { tiles: {} };
  for (let i = 0; i < 400; i++) big.overlays.home.tiles[`${i % 20},${Math.floor(i / 20)}`] = { ground: 'grass' };
  const ids = [];
  for (let i = 0; i < 30; i++) { big = play(big, i); ids.push(T.record(big, {})); }
  const anchors = ids.filter(id => T.node(id).full).length;
  assert.ok(anchors <= 4, `a big save with small edits keeps few whole copies (${anchors} of 30)`);
  assert.equal(JSON.stringify(T.rebuild(ids[29])), JSON.stringify(big), 'and still rebuilds exactly');

  // A save that is mostly replaced every time earns an anchor every time.
  fresh();
  let churn = save0();
  const churned = [];
  for (let i = 0; i < 10; i++) {
    churn = KIT.deepClone(churn);
    churn.overlays = { home: { tiles: {} } };
    for (let n = 0; n < 200; n++) churn.overlays.home.tiles[`${n},${i}`] = { ground: 'grass' };
    churned.push(T.record(churn, {}));
  }
  const churnAnchors = churned.filter(id => T.node(id).full).length;
  assert.ok(churnAnchors >= 5, `a save that is replaced each time stops pretending to delta (${churnAnchors} of 10)`);
});

test('moments: the tree prunes dead ends, oldest first, and nothing load-bearing', () => {
  fresh();
  let s = save0();
  const line = [];
  for (let i = 0; i < 5; i++) { s = play(s, i); line.push(T.record(s, {})); }
  // Three dead ends hanging off the second moment, oldest first.
  const ends = [];
  for (let i = 0; i < 3; i++) {
    const back = T.goto(line[1]);
    back.vars.chapter = 'end' + i;
    ends.push(T.record(back, { label: 'end' + i }));
  }
  T.keep(ends[0], true);
  T.headTo(line[4]);

  const before = T.count();
  T.prune(1);                                     // a budget nothing can fit in
  const left = new Set(Object.keys(T.now().nodes));
  assert.ok(T.count() < before, 'something went');
  assert.ok(left.has(ends[0]), 'not the one that was asked to be kept');
  for (const id of line) assert.ok(left.has(id), `not ${id}, which is on the way to where the player is`);
  assert.ok(!left.has(ends[2]) || !left.has(ends[1]), 'the dead ends are what went');
  // The invariant that matters: every surviving node can still be rebuilt.
  for (const id of left) assert.ok(T.rebuild(id), `${id} is still whole`);
});

test('moments: the whole tree survives being written out as JSON', () => {
  fresh();
  let s = save0();
  const ids = [];
  for (let i = 0; i < 20; i++) { s = play(s, i); ids.push(T.record(s, { label: i === 9 ? 'halfway' : '' })); }
  const round = JSON.parse(JSON.stringify(T.now()));
  T._setTree(round);
  assert.equal(T.count(), 20, 'every moment came back');
  assert.equal(T.node(ids[9]).label, 'halfway');
  assert.equal(JSON.stringify(T.rebuild(ids[19])), JSON.stringify(s), 'and they still rebuild');
});

test('moments: the running size stays honest, so pruning never has to measure', () => {
  // `prune()` asked `bytes()` — a stringify of the whole tree — on every save,
  // just to find out whether it had anything to do. At 1,500 moments that was
  // 27.5ms of a 16.7ms frame, every time the game saved. So the total is carried,
  // and this is the test that it is carried correctly: an estimate that drifts is
  // worse than a measurement, because it is wrong quietly.
  fresh();
  let s = save0();
  const ids = [];
  for (let i = 0; i < 60; i++) { s = play(s, i); ids.push(T.record(s, {})); }
  // The NODES are accounted for exactly. What drifts is the tree's own three
  // header fields — `head` gaining a digit as ids get longer, `n` and `b` the
  // same — and in particular the total is itself a field in the document it
  // measures, so it can never include its own digits. A handful of bytes that
  // never grows with the tree, against a three-megabyte budget. A per-NODE
  // mistake is the thing that would matter, and it would show up here as sixty
  // of them.
  const near = (what) => assert.ok(Math.abs(T.size() - T.bytes()) < 64,
    `${what}: running ${T.size()} vs real ${T.bytes()}`);
  near('after sixty moments');
  T.prune(1);
  near('after a prune took things away');
  const round = JSON.parse(JSON.stringify(T.now()));
  delete round.b;                                  // an older save, from before the field existed
  T._setTree(round);
  near('and a tree that never had a total, measured once on the way in');
});

test('moments: a moment whose parent is gone is dropped on the way in', () => {
  // This should not happen — pruning only takes leaves — but a store is not a
  // promise. Safari sweeps everything a page kept after seven days; a quota
  // refusal can truncate a write; somebody can edit the thing by hand. A node's
  // delta is written against its parent, so an orphan cannot be rebuilt and
  // nothing below it can either. The alternative to checking is a Moments list
  // with rows that do nothing when you pick them.
  fresh();
  let s = save0();
  const ids = [];
  for (let i = 0; i < 8; i++) { s = play(s, i); ids.push(T.record(s, {})); }
  const wounded = JSON.parse(JSON.stringify(T.now()));
  delete wounded.nodes[ids[3]];                    // a node in the MIDDLE, which pruning would never do
  T._setTree(wounded);
  const quiet = [];
  const realWarn = console.warn;
  console.warn = (...a) => quiet.push(a.join(' '));
  try { assert.equal(T.repair(), 4, 'the four moments below the hole went with it'); }
  finally { console.warn = realWarn; }
  for (const id of Object.keys(T.now().nodes)) assert.ok(T.rebuild(id), `${id} is whole`);
  assert.deepEqual(Object.keys(T.now().nodes).sort(), ids.slice(0, 3).sort(), 'and what is left is the part that still works');
  assert.ok(T.now().nodes[T.head()], 'the player is standing on something that exists');
  assert.ok(quiet.length && /timeline/.test(quiet[0]), `and it said so: ${quiet[0]}`);
});

test('moments: a root with no whole save is not a root', () => {
  // The other way the chain can break: the anchor itself is gone, so there is
  // nothing to start applying deltas to.
  fresh();
  let s = save0();
  const a = T.record(s, {});
  const b = T.record(play(s, 1), {});
  const wounded = JSON.parse(JSON.stringify(T.now()));
  delete wounded.nodes[a].full;
  T._setTree(wounded);
  const realWarn = console.warn;
  console.warn = () => {};
  try { T.repair(); } finally { console.warn = realWarn; }
  assert.equal(T.count(), 0, 'the whole line went, because none of it could be rebuilt');
  assert.equal(T.head(), null, 'and the player is nowhere rather than somewhere broken');
  assert.ok(!T.rebuild(b));
});

// ---- what the game can ask ---------------------------------------------------

test('moments × history: elsewhere() is what happened over there, after the fork', () => {
  // The question no variable can answer, because the variable was in the other
  // branch. What came BEFORE the fork is our own past and is not news.
  fresh();
  let s = save0();
  const line = [];
  for (let i = 0; i < 4; i++) {
    s = play(s, i);
    KIT.history.add(s, 'ate', { what: 'bread' });
    line.push(T.record(s, {}));
  }
  assert.equal(T.elsewhere({ verb: 'ate', what: 'bread' }), 0, 'a straight line has no elsewhere');

  let other = T.goto(line[1]);
  for (let i = 0; i < 3; i++) {
    other = KIT.deepClone(other);
    KIT.history.add(other, 'killed', { what: 'dog' });
    KIT.history.add(other, 'ate', { what: 'bread' });
    T.record(other, {});
  }
  T.headTo(line[3]);

  assert.equal(T.elsewhere({ verb: 'killed', what: 'dog' }), 3, 'they did it three times over there');
  assert.equal(KIT.history.count(T.rebuild(line[3]), { verb: 'killed', what: 'dog' }), 0, 'and never once here');
  assert.equal(T.elsewhere({ verb: 'ate', what: 'bread' }), 3,
    'the bread eaten before the fork is ours and is not counted again');
  assert.equal(T.elsewhere({ verb: 'never-happened' }), 0);
});

test('moments × history: everywhere() is the most any one line managed', () => {
  fresh();
  let s = save0();
  const line = [];
  for (let i = 0; i < 3; i++) { s = play(s, i); KIT.history.add(s, 'ate', { what: 'bread' }); line.push(T.record(s, {})); }
  let other = T.goto(line[0]);
  for (let i = 0; i < 6; i++) {
    other = KIT.deepClone(other);
    KIT.history.add(other, 'ate', { what: 'bread' });
    T.record(other, {});
  }
  T.headTo(line[2]);
  assert.equal(T.everywhere({ verb: 'ate', what: 'bread' }), 7, 'one loaf before the fork plus six after');
  const ledger = T.tallyAt(line[2]);
  assert.equal(ledger['ate/bread'], 3, 'and our own line adds up to three');
  assert.equal(ledger.walked, 3, 'with the rest of the ledger added up the same way');
});

test('moments × conditions: an author asks in the ordinary way', () => {
  fresh();
  let s = save0();
  const a = T.record(s, {});
  let other = T.goto(a);
  other = KIT.deepClone(other);
  KIT.history.add(other, 'killed', { what: 'dog' });
  T.record(other, {});
  const mine = T.goto(a);
  const b = T.record(play(mine, 1), {});
  T.headTo(b);

  const C = KIT.conditions;
  const ctx = { world: { save: T.rebuild(b) } };
  assert.equal(C.test(C.parseText('elsewhere.killed/dog >= 1'), ctx), true, 'over there, they did');
  assert.equal(C.test(C.parseText('did.killed/dog >= 1'), ctx), false, 'here, they did not');
  assert.equal(C.test(C.parseText('everywhere.killed/dog >= 1'), ctx), true, 'and somewhere, they did');
  assert.equal(C.toText(C.parseText('elsewhere.killed/dog >= 2')), 'elsewhere.killed/dog >= 2', 'it round-trips');
});

test('moments × layers: a moment remembers which layer of reality it was in', () => {
  fresh();
  let s = save0();
  const awake = T.record(s, {});
  s = KIT.deepClone(s);
  s.dimension = 'dream';
  const asleep = T.record(s, {});
  assert.equal(T.node(awake).layer, null);
  assert.equal(T.node(asleep).layer, 'dream');
  assert.equal(T.rebuild(awake).dimension, null, 'and going back really does wake you up');
});

test('moments × rules: a rule eaten in one branch is not eaten in the other', () => {
  fresh();
  const project = { rules: { gravity: { id: 'gravity', when: 'step', on: true } } };
  let s = save0();
  const fork = T.record(s, {});
  const brave = KIT.deepClone(T.goto(fork));
  KIT.rules.eat(brave, 'gravity');
  const ate = T.record(brave, { label: 'ate it' });
  const timid = KIT.deepClone(T.goto(fork));
  const didnt = T.record(timid, { label: 'left it alone' });

  assert.equal(KIT.rules.live(project, T.rebuild(ate), 'gravity'), false, 'gone where they ate it');
  assert.equal(KIT.rules.live(project, T.rebuild(didnt), 'gravity'), true, 'still standing where they did not');
  T.headTo(didnt);
  assert.equal(T.elsewhere({ verb: 'ate', what: 'rule:gravity' }), 1,
    'and a line here can know that somewhere else, it was eaten');
});

test('moments: the tree draws as rows, with the branch shape in them', () => {
  fresh();
  let s = save0();
  const line = [];
  for (let i = 0; i < 3; i++) { s = play(s, i); line.push(T.record(s, {})); }
  const back = T.goto(line[0]);
  const side = T.record(KIT.deepClone(back), { label: 'a side road' });
  T.headTo(line[2]);

  const rows = T.moments();
  assert.equal(rows.length, 4);
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.equal(byId[line[0]].depth, 0, 'the root is at the left');
  assert.equal(byId[line[2]].depth, 2);
  assert.equal(byId[side].depth, 1, 'and the side road hangs off the root');
  assert.equal(byId[side].label, 'a side road');
  assert.equal(byId[line[2]].head, true, 'the player is at the end of their line');
  assert.equal(byId[side].mine, false, 'and the side road is not on it');
  assert.equal(byId[line[0]].branches, 2, 'the fork says it is one');
});

test('moments: an empty tree answers everything, and a save that changed nothing is the moment you are in', () => {
  fresh();
  assert.equal(T.count(), 0);
  assert.equal(T.head(), null);
  assert.deepEqual(T.moments(), []);
  assert.equal(T.elsewhere({ verb: 'ate' }), 0, 'with no tree, nothing happened anywhere');
  assert.equal(T.rebuild('nope'), null);
  assert.equal(T.goto('nope'), null);
  const s = save0();
  const a = T.record(s, {});
  const b = T.record(KIT.deepClone(s), {});
  // The first version of this rule made a twin node "as a delta of nothing, which
  // costs nothing". It cost the player: the autosave on entering a map landed
  // right after every manual save, doubled the Moments list, and moved "you are
  // here" off the save they had just made.
  assert.equal(b, a, 'saving twice with nothing between is the same moment');
  assert.equal(T.count(), 1);
});

test('tree: a save that changed nothing makes no moment, and a name given then sticks', async () => {
  await T.forgetAll();
  const save = { heroes: [{ map: 'home', x: 1, y: 1 }], vars: { a: 1 }, log: { tally: {} }, clock: { day: 1, minutes: 0 } };
  const m1 = T.record(save, {});
  assert.equal(T.count(), 1);
  assert.equal(T.record(KIT.deepClone(save), {}), m1, 'the same save again is the same moment');
  assert.equal(T.count(), 1);
  assert.equal(T.head(), m1);
  assert.equal(T.record(KIT.deepClone(save), { label: 'the fork' }), m1, 'naming it does not fork it');
  assert.equal(T.now().nodes[m1].label, 'the fork', 'but the name sticks');
  const changed = KIT.deepClone(save); changed.vars.a = 2;
  const m2 = T.record(changed, {});
  assert.notEqual(m2, m1);
  assert.equal(T.count(), 2);
  assert.equal(T.head(), m2);
});
