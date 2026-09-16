// Node tests for the parts of the runtime that are pure logic: the storage
// adapters (with a fake localStorage), module ordering, and the scene stack.
// Anything that needs a canvas or a pointer is checked by e2e/walk.js instead.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('./_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));
R('js/kit/core/input.js');
R('js/kit/core/audio.js');
R('js/kit/core/storage.js');
R('js/kit/scenes/stack.js');
R('js/main.js');

const S = KIT.storage;

/** The smallest thing that behaves like localStorage. */
function fakeLocalStorage(opts) {
  const map = new Map();
  return {
    get length() { return map.size; },
    key(i) { return Array.from(map.keys())[i]; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (opts && opts.full) throw new Error('QuotaExceededError'); map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    _map: map,
  };
}

test('storage: falls back to memory when there is no store at all', async () => {
  delete globalThis.localStorage;
  S._reset();
  S.forceAdapter = null;
  const { adapter } = await S.ready();
  assert.equal(adapter, 'memory');
  assert.match(S.warning || '', /only lasts/);
  assert.equal(await S.get('nothing'), null);
  assert.equal(await S.set('a', { x: 1 }), true);
  assert.deepEqual(await S.get('a'), { x: 1 });
});

test('storage: uses localStorage when it works, with kit.<projectId>.* keys', async () => {
  globalThis.localStorage = fakeLocalStorage();
  S._reset();
  S.forceAdapter = 'localStorage';
  const { adapter } = await S.ready();
  assert.equal(adapter, 'localStorage');

  const { project, source } = await S.loadProject();
  assert.equal(source, 'default');                       // no draft, no embed, no content files
  assert.equal(S.info().projectId, project.meta.id);

  await S.saveGame('1', { version: 2, heroes: [{ map: 'home', x: 3, y: 4 }], vars: { chapter: 2 } });
  const key = `kit.${project.meta.id}.save.1`;
  assert.ok(globalThis.localStorage.getItem(key), 'the slot is stored under its kit.<project>.save.<slot> key');

  const back = await S.loadGame('1');
  assert.equal(back.heroes[0].x, 3);
  assert.ok(back.savedAt, 'the save is stamped with a time');

  const list = await S.listGames();
  assert.deepEqual(list.map(s => s.slot), ['autosave', '1', '2', '3']);
  assert.equal(list.find(s => s.slot === '1').exists, true);
  assert.equal(list.find(s => s.slot === '2').exists, false);

  const text = await S.exportGame('1');
  const reimported = await S.importGame(text, '2');
  assert.equal(reimported.heroes[0].y, 4);
  assert.equal((await S.loadGame('2')).vars.chapter, 2);

  await S.deleteGame('1');
  assert.equal(await S.loadGame('1'), null);
});

test('storage: a store that throws on write never breaks a save', async () => {
  globalThis.localStorage = fakeLocalStorage({ full: true });
  S._reset();
  S.forceAdapter = 'localStorage';
  const { adapter } = await S.ready();
  assert.equal(adapter, 'memory', 'a store that cannot even be probed is not used');
  assert.equal(await S.saveGame('1', { version: 2 }), true);
});

test('storage: settings and meta are cached and survive a reload', async () => {
  globalThis.localStorage = fakeLocalStorage();
  S._reset();
  S.forceAdapter = 'localStorage';
  await S.ready();
  await S.loadProject();                                  // meta lives under the project's own key
  assert.equal(S.settings().textSpeed, 'normal');
  await S.saveSettings({ textSpeed: 'fast', coop: true });
  assert.equal(S.settings().textSpeed, 'fast');
  await S.saveMeta({ runs: 3 });
  assert.equal(S.meta().runs, 3);

  const store = globalThis.localStorage;                  // same store, fresh session
  S._reset();
  globalThis.localStorage = store;
  S.forceAdapter = 'localStorage';
  await S.ready();
  assert.equal(S.settings().coop, true, 'settings are global and come back');
  await S.loadProject();
  assert.equal(S.meta().runs, 3, 'meta is per project and comes back');
});

test('storage: draft round-trip and discard', async () => {
  globalThis.localStorage = fakeLocalStorage();
  S._reset();
  S.forceAdapter = 'localStorage';
  await S.ready();
  const { project } = await S.loadProject();
  project.meta.title = 'Draft title';
  await S.saveDraft(project, { now: true });
  assert.equal(await S.hasDraft(), true);
  const again = await S.loadProject();
  assert.equal(again.source, 'draft');
  assert.equal(again.project.meta.title, 'Draft title');
  await S.discardDraft();
  assert.equal((await S.loadProject()).source, 'default');
});

test('storage: export/import text is stable JSON', () => {
  const text = S.exportText({ b: 1, a: { d: 2, c: 3 } });
  assert.equal(text, '{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}');
  assert.deepEqual(S.importText(text), { a: { c: 3, d: 2 }, b: 1 });
});

test('modules: requires decide the order, and a missing one is reported', () => {
  KIT.module({ id: 'mons', requires: ['core-extra'], register() { this.ran = true; } });
  KIT.module({ id: 'core-extra', requires: [], register() {} });
  KIT.module({ id: 'lonely', requires: ['nope'], register() {} });
  const { order, missing } = KIT.modules.order(['mons', 'core-extra', 'lonely']);
  const ids = order.map(d => d.id);
  assert.ok(ids.indexOf('core-extra') < ids.indexOf('mons'), 'a dependency registers first');
  assert.deepEqual(missing, [{ module: 'lonely', requires: 'nope' }]);

  const ran = [];
  KIT.module({ id: 'a1', requires: ['b1'], register() { ran.push('a1'); } });
  KIT.module({ id: 'b1', requires: [], register() { ran.push('b1'); } });
  KIT.modules.activate({ modules: ['a1', 'b1'] });
  assert.deepEqual(ran, ['b1', 'a1']);
  assert.equal(KIT.modules.has('a1'), true);
  assert.equal(KIT.modules.has('mons'), false, 'a module the project does not enable stays out');
});

test('modules: a cycle is reported, not a hang', () => {
  KIT.module({ id: 'x1', requires: ['y1'], register() {} });
  KIT.module({ id: 'y1', requires: ['x1'], register() {} });
  const { cycles, order } = KIT.modules.order(['x1', 'y1']);
  assert.equal(cycles.length >= 1, true);
  assert.equal(order.length, 2, 'both still register, once');
});

test('scenes: the stack runs, resolves and only the top scene takes input', async () => {
  const log = [];
  const scene = (id, extra) => Object.assign({
    id,
    enter() { log.push(id + ':enter'); },
    exit() { log.push(id + ':exit'); },
    update() { log.push(id + ':update'); },
    input(ev) { log.push(id + ':input:' + ev.key); },
  }, extra || {});

  const base = KIT.scenes.push(scene('map'));
  const promise = KIT.scenes.run(scene('dialogue', { transparent: true }));
  assert.deepEqual(KIT.scenes.ids(), ['map', 'dialogue']);
  assert.equal(KIT.scenes.top().id, 'dialogue');
  assert.equal(KIT.scenes.top().transparent, true);

  KIT.scenes.input({ key: 'a', player: 1 });
  assert.deepEqual(log.filter(l => l.includes(':input')), ['dialogue:input:a'], 'the scene underneath never sees input');

  log.length = 0;
  KIT.scenes.update(1 / 60);
  assert.deepEqual(log, ['map:update', 'dialogue:update'], 'every scene still ticks (move routes keep running)');

  KIT.scenes.top().finish('answered');
  assert.equal(await promise, 'answered');
  assert.deepEqual(KIT.scenes.ids(), ['map']);

  const replaced = KIT.scenes.replace(scene('title'));
  assert.deepEqual(KIT.scenes.ids(), ['title']);
  assert.equal(replaced.id, 'title');
  assert.equal(await base._promise, null, 'a replaced scene resolves with null');

  KIT.scenes.clear();
  assert.deepEqual(KIT.scenes.ids(), []);
  assert.equal(KIT.scenes.top(), null);
});

test('scenes: a scene registered by id can be run by name', async () => {
  KIT.registry('scenes').add({ id: 'test-scene', create(params) { return { id: 'test-scene', enter() { this.finish(params.answer); } }; } });
  assert.equal(await KIT.scenes.run('test-scene', { answer: 42 }), 42);
  assert.deepEqual(KIT.scenes.ids(), []);
});

test('fx: effects tween and land on their target value', async () => {
  KIT.fx.reset();
  const done = KIT.fx.fadeOut({ ms: 100, color: '#112233' });
  KIT.fx.update(0.05);
  const mid = KIT.fx.state().fade.alpha;
  assert.ok(mid > 0 && mid < 1, 'half way through the fade');
  KIT.fx.update(0.06);
  await done;
  assert.equal(KIT.fx.state().fade.alpha, 1);
  assert.equal(KIT.fx.state().fade.color, '#112233');
  await KIT.fx.weather({ kind: 'rain', power: 3 });
  assert.equal(KIT.fx.state().weather.kind, 'rain');
  KIT.fx.reset();
  assert.equal(KIT.fx.state().weather.kind, 'none');
});

test('audio: registers the standard sounds and never throws without an AudioContext', () => {
  const sounds = KIT.registry('sounds');
  for (const id of ['blip', 'select', 'back', 'bump', 'door', 'item', 'sparkle', 'heal', 'save', 'notify', 'hop']) {
    assert.ok(sounds.has(id), `sound ${id} is registered`);
  }
  const music = KIT.registry('music');
  for (const id of ['title', 'town', 'route', 'house', 'cave', 'garden']) assert.ok(music.has(id), `track ${id} is registered`);
  assert.equal(KIT.audio.init(), null, 'no AudioContext in Node');
  KIT.audio.play('blip');
  KIT.audio.music('town');
  KIT.audio.stop('all');
  assert.equal(KIT.audio.freq('a4'), 440);
  assert.ok(Math.abs(KIT.audio.freq('c5') - 523.25) < 0.5);
});

test('input: state, presses and the two keyboard layouts', () => {
  KIT.input.setPlayers(2);
  const seen = [];
  const off = KIT.input.onPress(ev => seen.push(ev));
  KIT.input.set('left', 1, true);
  assert.equal(KIT.input.state(1).left, true);
  assert.equal(KIT.input.state(2).left, false, 'player 2 has its own buttons');
  KIT.input.set('right', 1, true);
  assert.equal(KIT.input.state(1).left, false, 'opposite directions never stick together');
  KIT.input.set('right', 1, false);
  KIT.input.set('a', 2, true);
  assert.deepEqual(seen.map(e => `${e.player}:${e.key}`), ['1:left', '1:right', '2:a']);
  assert.equal(KIT.input.pressed('a', 'p2'), true);
  off();
  KIT.input.releaseAll();
  assert.equal(KIT.input.state(2).a, false);
  KIT.input.setPlayers(1);
});

test('scenes: a covered scene is suspended and let go of what it was holding', () => {
  const log = [];
  const reg = KIT.registry('scenes');
  const mk = (id) => ({
    id, create: () => ({
      id,
      enter() { log.push(id + ':enter'); },
      suspend(by) { log.push(id + ':suspend by ' + (by ? by.id : '?')); },
      resume() { log.push(id + ':resume'); },
      exit() { log.push(id + ':exit'); },
    }),
  });
  reg.add(Object.assign(mk('t-under'), { replace: true }));
  reg.add(Object.assign(mk('t-over'), { replace: true }));
  reg.add(Object.assign(mk('t-third'), { replace: true }));
  try {
    const under = KIT.scenes.push('t-under');
    assert.equal(under.suspended, undefined, 'on top, so not suspended');

    const over = KIT.scenes.push('t-over');
    assert.equal(under.suspended, true);
    assert.equal(over.suspended, undefined);

    const third = KIT.scenes.push('t-third');
    assert.equal(over.suspended, true);
    assert.equal(under.suspended, true, 'still suspended; it is not resumed twice');

    KIT.scenes.finish(third, null);
    assert.equal(over.suspended, false, 'the one it covered is on top again');
    assert.equal(under.suspended, true, 'the one below that is not');

    KIT.scenes.finish(over, null);
    assert.equal(under.suspended, false);

    assert.deepEqual(log, [
      't-under:enter',
      't-under:suspend by t-over', 't-over:enter',
      't-over:suspend by t-third', 't-third:enter',
      't-third:exit', 't-over:resume',
      't-over:exit', 't-under:resume',
    ]);

    // closing a scene from the MIDDLE of the stack resumes nobody: the top did
    // not change, so nothing that was covered has been uncovered.
    log.length = 0;
    const a = KIT.scenes.push('t-under');
    const b = KIT.scenes.push('t-over');
    log.length = 0;
    KIT.scenes.finish(a, null);
    assert.equal(b.suspended, undefined, 'the top scene was never suspended');
    assert.deepEqual(log, ['t-under:exit']);
    KIT.scenes.finish(b, null);
  } finally {
    KIT.scenes.clear();
    for (const id of ['t-under', 't-over', 't-third']) reg.remove(id);
  }
});

test('scenes: a scene with neither hook is no trouble at all', () => {
  const reg = KIT.registry('scenes');
  reg.add({ id: 't-plain', replace: true, create: () => ({ id: 't-plain' }) });
  try {
    const plain = KIT.scenes.push('t-plain');
    KIT.scenes.push('t-plain');
    assert.equal(plain.suspended, true, 'it is still marked, so anything can ask');
    KIT.scenes.pop();
    assert.equal(plain.suspended, false);
  } finally { KIT.scenes.clear(); reg.remove('t-plain'); }
});

// ---- what the game remembers about the PLAYER, not the run ---------------------
test('meta: @remember writes what survives New Game, and lines can say it back', async () => {
  delete globalThis.localStorage;
  S._reset();
  S.forceAdapter = null;
  S.projectId('remember-test');
  await S.ready();

  const cmds = KIT.commands;
  const def = KIT.registry('commands').get('remember');
  assert.ok(def, 'the engine has a way to remember something');

  const project = KIT.project.normalize({
    meta: { id: 'remember-test' }, maps: { a: {} },
    heroes: [{ id: 'p1', name: 'Wren' }],
  }).project;
  const ctx = KIT.interpreter.fakeCtx({ project, save: { vars: {}, heroes: [{ name: 'Wren' }] } });

  await cmds.exec(ctx, { t: 'remember', key: 'lastEnding', op: 'set', value: 'the door' });
  assert.equal(S.meta().lastEnding, 'the door');

  // a list, and putting the same thing in twice does not make two of it
  await cmds.exec(ctx, { t: 'remember', key: 'endings', op: 'add', value: 'the door' });
  await cmds.exec(ctx, { t: 'remember', key: 'endings', op: 'add', value: 'the window' });
  await cmds.exec(ctx, { t: 'remember', key: 'endings', op: 'add', value: 'the door' });
  assert.deepEqual(S.meta().endings, ['the door', 'the window']);

  // counting
  await cmds.exec(ctx, { t: 'remember', key: 'visits', op: 'count', by: 1 });
  await cmds.exec(ctx, { t: 'remember', key: 'visits', op: 'count', by: 2 });
  assert.equal(S.meta().visits, 3);

  // a value written through a tag is the substituted one
  await cmds.exec(ctx, { t: 'remember', key: 'calledThemselves', op: 'set', value: '{p1}' });
  assert.equal(S.meta().calledThemselves, 'Wren');

  // the condition reads it
  const cond = KIT.registry('conditions').get('meta');
  assert.equal(cond.test({ kind: 'meta', key: 'visits', op: '>=', value: 3 }, ctx), true);
  assert.equal(cond.test({ kind: 'meta', key: 'visits', op: '>', value: 3 }, ctx), false);
  assert.equal(cond.test({ kind: 'meta', key: 'neverSet', op: '>=', value: 1 }, ctx), false);

  // and a line can say it back
  assert.equal(KIT.text.plain('You have been here {meta:visits} times.', ctx), 'You have been here 3 times.');
  assert.equal(KIT.text.plain('Last time: {meta:lastEnding}.', ctx), 'Last time: the door.');
  assert.equal(KIT.text.plain('You found: {meta:endings}.', ctx), 'You found: the door, the window.');
  assert.equal(KIT.text.plain('Nothing yet: {meta:neverSet}.', ctx), 'Nothing yet: .');

  // forgetting
  await cmds.exec(ctx, { t: 'remember', key: 'lastEnding', op: 'forget' });
  assert.equal(S.meta().lastEnding, undefined);
  assert.deepEqual(S.meta().endings, ['the door', 'the window'], 'and only that one');

  // it really is written down, so it survives a reload as well as a New Game:
  // the cache is dropped and the record read back from the adapter.
  const key = 'kit.' + S.info().projectId + '.meta';
  const stored = await S.get(key);
  assert.equal(stored.visits, 3, 'under ' + key);
  assert.equal(stored.calledThemselves, 'Wren');
});

test('meta: the engine’s own four keys cannot be forgotten by accident', async () => {
  delete globalThis.localStorage;
  S._reset();
  await S.ready();
  await S.saveMeta({ runs: 3 });
  await S.saveMeta({ runs: null });
  assert.equal(S.meta().runs, null, 'runs is the engine’s, so it is set rather than deleted');
  assert.ok('endingsSeen' in S.meta());
});

// ---- moving a game between a phone and a laptop ---------------------------------
test('the portable game file: one file, both ways, and rubbish refused', async () => {
  delete globalThis.localStorage;
  S._reset();
  await S.ready();

  const { project } = KIT.project.normalize({
    version: 3, meta: { id: 'mill-lane', title: 'Mill Lane' },
    heroes: [{ id: 'p1', name: 'You' }], maps: { lane: {} },
    cast: { wren: { name: 'Wren' } },
  });

  assert.equal(S.fileName(project), 'mill-lane.kitgame.json');
  const text = S.toFile(project);

  // it says what it is, so the other end can refuse what it is not
  const raw = JSON.parse(text);
  assert.equal(raw.kind, 'kit-game');
  assert.equal(raw.version, 1);
  assert.equal(raw.title, 'Mill Lane');
  assert.ok(raw.savedAt, 'and when it left');

  const back = S.fromFile(text);
  assert.equal(back.ok, true);
  assert.equal(back.title, 'Mill Lane');
  assert.equal(KIT.stableStringify(back.project), KIT.stableStringify(project),
    'nothing changed on the way out and back');

  // a bare project — an older export, or a file somebody wrote by hand
  const bare = S.fromFile(JSON.stringify(project));
  assert.equal(bare.ok, true);
  assert.equal(bare.project.meta.title, 'Mill Lane');

  // and everything else says why, in words a person can act on
  for (const [bad, why] of [
    ['hello', /not even JSON/],
    ['{"a":1}', /not a game/],
    ['null', /empty/],
  ]) {
    const r = S.fromFile(bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.reason, why, bad);
  }

  // a file from a future version is refused rather than half-read
  const future = S.fromFile(JSON.stringify({ kind: 'kit-game', version: 99, project }));
  assert.equal(future.ok, false);
  assert.match(future.reason, /newer version/);
});

test('a hand-written project keeps its own title', () => {
  // A portable file is JSON somebody may open and edit. Guessing that a v3-shaped
  // project with no version number is an OLD one would run a migration over it and
  // silently rename their game.
  const p = KIT.project.normalize({ meta: { id: 'mill-lane', title: 'Mill Lane' }, maps: { a: {} } }).project;
  assert.equal(p.meta.title, 'Mill Lane');
  assert.equal(p.meta.id, 'mill-lane');

  // and a genuinely old, flat project still migrates
  const old = KIT.project.migrate({ title: 'The Old Way' });
  assert.deepEqual(old.applied, ['project-2-to-3']);
  assert.equal(old.project.meta.title, 'The Old Way');
});
