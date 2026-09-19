'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KIT = require('./_load.js');
const CMD = KIT.commands;
const reg = KIT.registry('commands');

for (const [r, id] of [['tiles', 'grass'], ['faces', 'mom-smile'], ['sounds', 'sparkle'], ['music', 'town'], ['music', 'fanfare']]) if (!KIT.registry(r).has(id)) KIT.registry(r).add({ id, name: id });

const ALL = ['say', 'choice', 'inputNumber', 'scrollText', 'setVar', 'setSelf', 'timer', 'if', 'loop', 'break', 'label', 'jump', 'exit', 'call', 'comment', 'wait', 'group',
  'give', 'take', 'nameEntry', 'transfer', 'setLocation', 'moveRoute', 'scrollMap', 'follow', 'transparency', 'animation', 'balloon', 'erase',
  'fadeOut', 'fadeIn', 'tint', 'flash', 'shake', 'weather', 'pictureShow', 'pictureMove', 'pictureErase',
  'music', 'sound', 'stopSound', 'saveMusic', 'replayMusic', 'jingle', 'menu', 'save', 'title', 'chapter', 'heal', 'debug'];

/** A recording fake ctx: every port call is pushed to ctx.calls as [port, ...args]; `answers` script the promise results. */
function fakeCtx(answers, over) {
  answers = answers || {};
  const calls = [], events = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); const a = answers[name]; return Promise.resolve(typeof a === 'function' ? a(...args) : a); };
  const ports = (group, names) => { const o = {}; for (const n of names) o[n] = rec(`${group}.${n}`); return o; };
  const ctx = {
    project: {
      heroes: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }],
      vars: { chapter: { type: 'number', default: 0 } }, items: { berry: { name: 'Berry' }, key: { name: 'Old Key' } },
      scripts: { 'meet-mom': { body: [] } }, maps: { town: { objects: [{ id: 'mom' }, { id: 'door' }] } }, strings: {},
    },
    world: { save: { vars: { chapter: 1 }, inventory: { berry: 2 }, objects: { 'town:mom': { self: { opened: false }, x: 1, y: 1 } }, heroes: [{ x: 0, y: 0, dir: 'down' }, { x: 1, y: 0, dir: 'down' }], timer: { running: false, secondsLeft: 0 } }, map: { id: 'town' }, entities: [] },
    self: 'town:mom', hero: 'p1', rng: KIT.rng(1), thread: { id: 't1', background: false }, args: {},
    emit: (event, payload) => { events.push([event, payload]); },
    io: ports('io', ['say', 'choice', 'nameEntry', 'inputNumber', 'toast', 'chapter', 'scrollText', 'wait']),
    audio: ports('audio', ['play', 'music', 'stop', 'save', 'replay', 'jingle', 'layer']),
    screen: ports('screen', ['fadeOut', 'fadeIn', 'tint', 'flash', 'shake', 'weather']),
    pictures: ports('pictures', ['show', 'move', 'erase']),
    map: ports('map', ['transfer', 'setLocation', 'moveRoute', 'scrollMap', 'transparency', 'animation', 'balloon', 'erase', 'follow']),
    game: ports('game', ['menu', 'save', 'title', 'heal', 'debug']),
    calls, events,
  };
  return Object.assign(ctx, over || {});
}
const run = (ctx, cmd) => CMD.exec(ctx, CMD.normalize(cmd));
const N = CMD.normalize;

test('every baseline command is registered with fields/run/summary and the right flags', () => {
  for (const id of ALL) {
    const d = reg.get(id);
    assert.ok(d, id); assert.ok(Array.isArray(d.fields), id); assert.equal(typeof d.run, 'function', id); assert.equal(typeof d.summary, 'function', id);
    assert.ok(d.group && d.label, id);
  }
  for (const id of ['say', 'choice', 'nameEntry', 'inputNumber', 'scrollText', 'menu', 'save', 'title', 'chapter']) assert.equal(reg.get(id).background, false, id);
  for (const id of ['setVar', 'give', 'transfer', 'music', 'if']) assert.equal(reg.get(id).background, true, id);
  assert.equal(reg.get('say').blocking, true); assert.equal(reg.get('setVar').blocking, false);
  assert.deepEqual(CMD.ids().slice(0, 4), ['say', 'choice', 'inputNumber', 'scrollText']);
  // strings the commands read exist
  for (const k of ['got-item', 'lost-item', 'save-prompt', 'saved', 'yes', 'no', 'name-prompt', 'number-prompt']) assert.ok(KIT.registry('strings').has(k), k);
});

test('message commands: say, choice (visible options, cancel), inputNumber, scrollText', async () => {
  const ctx = fakeCtx({ 'io.choice': 1, 'io.inputNumber': 42 });
  ctx.world.save.heroes[0].name = 'Ava';
  await run(ctx, { t: 'say', who: 'Mom', face: 'mom-smile', text: 'Hi {p1}, {var:chapter}!', position: 'top' });
  assert.deepEqual(ctx.calls[0], ['io.say', { who: 'Mom', face: 'mom-smile', text: 'Hi Ava, 1!', position: 'top', bg: 'window', raw: 'Hi {p1}, {var:chapter}!' }]);
  const choice = { t: 'choice', prompt: 'Ready?', options: [{ text: 'Yes', then: [{ t: 'comment', text: 'a' }] }, { text: 'Hidden', when: { kind: 'coop' }, then: [] }, { text: 'No {p1}', then: [{ t: 'comment', text: 'c' }] }] };
  const sig = await run(ctx, choice);
  assert.deepEqual(ctx.calls[1], ['io.choice', { prompt: 'Ready?', options: [{ text: 'Yes', index: 0 }, { text: 'No Ava', index: 2 }], cancel: 'none' }]);
  assert.deepEqual(sig, { kind: 'block', body: [N({ t: 'comment', text: 'c' })] });
  const cancelled = fakeCtx({ 'io.choice': -1 });
  assert.equal(await run(cancelled, choice), undefined);
  assert.deepEqual((await run(cancelled, Object.assign({}, choice, { cancel: 'last' }))).body, [N({ t: 'comment', text: 'c' })]);
  assert.equal(await run(fakeCtx(), { t: 'choice', prompt: 'x', options: [{ text: 'h', when: { kind: 'coop' }, then: [] }] }), undefined);
  await run(ctx, { t: 'inputNumber', var: 'answer', digits: 2 });
  assert.deepEqual(ctx.calls[2], ['io.inputNumber', { prompt: 'Enter a number', digits: 2, current: 0 }]);
  assert.equal(ctx.world.save.vars.answer, 42);
  assert.deepEqual(ctx.events.at(-1), ['varChanged', { name: 'answer', old: undefined, value: 42 }]);
  await run(ctx, { t: 'scrollText', text: 'The end, {p1}.', speed: 3 });
  assert.deepEqual(ctx.calls[3], ['io.scrollText', { text: 'The end, Ava.', speed: 3, noFast: false }]);
});

test('progression: setVar ops (incl. random via ctx.rng, copyVar), setSelf ops, timer', async () => {
  const ctx = fakeCtx();
  await run(ctx, { t: 'setVar', name: 'chapter', op: 'set', value: 5 }); assert.equal(ctx.world.save.vars.chapter, 5);
  await run(ctx, { t: 'setVar', name: 'chapter', op: 'add', value: 2 }); assert.equal(ctx.world.save.vars.chapter, 7);
  await run(ctx, { t: 'setVar', name: 'chapter', op: 'sub', value: 1 }); assert.equal(ctx.world.save.vars.chapter, 6);
  await run(ctx, { t: 'setVar', name: 'chapter', op: 'mul', value: 3 }); assert.equal(ctx.world.save.vars.chapter, 18);
  await run(ctx, { t: 'setVar', name: 'chapter', op: 'div', value: 4 }); assert.equal(ctx.world.save.vars.chapter, 4.5);
  await run(ctx, { t: 'setVar', name: 'chapter', op: 'mod', value: 4 }); assert.equal(ctx.world.save.vars.chapter, 0.5);
  await run(ctx, { t: 'setVar', name: 'chapter', op: 'div', value: 0 }); assert.equal(ctx.world.save.vars.chapter, 0.5);
  await run(ctx, { t: 'setVar', name: 'flag', op: 'set', value: true }); assert.equal(ctx.world.save.vars.flag, true);
  await run(ctx, { t: 'setVar', name: 'fresh', op: 'add', value: 2 }); assert.equal(ctx.world.save.vars.fresh, 2);
  await run(ctx, { t: 'setVar', name: 'copy', op: 'copyVar', var: 'flag' }); assert.equal(ctx.world.save.vars.copy, true);
  const expected = KIT.rng(1).range(1, 6);
  await run(ctx, { t: 'setVar', name: 'dice', op: 'random', min: 1, max: 6 });
  assert.equal(ctx.world.save.vars.dice, expected);
  assert.ok(ctx.world.save.vars.dice >= 1 && ctx.world.save.vars.dice <= 6);
  assert.deepEqual(ctx.events[0], ['varChanged', { name: 'chapter', old: 1, value: 5 }]);
  assert.equal(ctx.calls.length, 0);
  await run(ctx, { t: 'setSelf', key: 'opened', op: 'set', value: true });
  assert.equal(ctx.world.save.objects['town:mom'].self.opened, true);
  assert.deepEqual(ctx.events.at(-1), ['selfChanged', { objectKey: 'town:mom', key: 'opened', old: false, value: true }]);
  await run(ctx, { t: 'setSelf', key: 'opened', op: 'toggle' }); assert.equal(ctx.world.save.objects['town:mom'].self.opened, false);
  await run(ctx, { t: 'setSelf', key: 'visits', op: 'add', value: 1 }); await run(ctx, { t: 'setSelf', key: 'visits', op: 'add', value: 1 });
  assert.equal(ctx.world.save.objects['town:mom'].self.visits, 2);
  await run(ctx, { t: 'setSelf', key: 'visits', op: 'sub', value: 3 }); assert.equal(ctx.world.save.objects['town:mom'].self.visits, -1);
  const noSelf = fakeCtx({}, { self: null });
  await assert.rejects(() => run(noSelf, { t: 'setSelf', key: 'x', value: 1 }), /ctx.self/);
  const fresh = fakeCtx({}, { self: 'town:new' });
  await run(fresh, { t: 'setSelf', key: 'done', value: true });
  assert.deepEqual(fresh.world.save.objects['town:new'], { self: { done: true } });
  await run(ctx, { t: 'timer', op: 'start', seconds: 90 });
  assert.deepEqual(ctx.world.save.timer, { running: true, secondsLeft: 90 });
  assert.deepEqual(ctx.events.at(-1), ['timerChanged', { running: true, secondsLeft: 90 }]);
  await run(ctx, { t: 'timer', op: 'stop' });
  assert.deepEqual(ctx.world.save.timer, { running: false, secondsLeft: 0 });
});

test('flow commands return control signals; wait uses io.wait; disabled/raw/unknown are skipped', async () => {
  const ctx = fakeCtx();
  const thenList = [{ t: 'comment', text: 'yes' }], elseList = [{ t: 'comment', text: 'no' }];
  assert.deepEqual(await run(ctx, { t: 'if', when: { kind: 'var', name: 'chapter', op: '>=', value: 1 }, then: thenList, else: elseList }), { kind: 'block', body: [N(thenList[0])] });
  assert.deepEqual(await run(ctx, { t: 'if', when: { kind: 'coop' }, then: thenList, else: elseList }), { kind: 'block', body: [N(elseList[0])] });
  assert.deepEqual(await run(ctx, { t: 'if', when: null, then: thenList }), { kind: 'block', body: [N(thenList[0])] });
  assert.deepEqual(await run(ctx, { t: 'loop', body: thenList }), { kind: 'block', body: [N(thenList[0])], loop: true });
  assert.deepEqual(await run(ctx, { t: 'group', label: 'Intro', body: thenList }), { kind: 'block', body: [N(thenList[0])] });
  assert.deepEqual(await run(ctx, { t: 'break' }), { kind: 'break' });
  assert.deepEqual(await run(ctx, { t: 'jump', label: 'top' }), { kind: 'jump', label: 'top' });
  assert.deepEqual(await run(ctx, { t: 'exit' }), { kind: 'exit' });
  assert.equal(await run(ctx, { t: 'label', name: 'top' }), undefined);
  assert.equal(await run(ctx, { t: 'comment', text: 'note' }), undefined);
  assert.deepEqual(await run(ctx, { t: 'call', script: 'meet-mom', args: [{ name: 'count', value: 3 }, { name: 'who', value: 'mom' }] }), { kind: 'call', script: 'meet-mom', args: { count: 3, who: 'mom' } });
  await run(ctx, { t: 'wait', ms: 250 });
  assert.deepEqual(ctx.calls, [['io.wait', 250]]);
  assert.equal(await CMD.exec(ctx, { t: 'say', text: 'x', disabled: true }), undefined);
  assert.equal(await CMD.exec(ctx, { t: 'raw', line: '???' }), undefined);
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(await CMD.exec(ctx, { t: 'nope' }), undefined); } finally { console.warn = warn; }
  assert.equal(ctx.calls.length, 1);
  const bg = fakeCtx({}, { thread: { id: 'bg', background: true } });
  await assert.rejects(() => run(bg, { t: 'say', text: 'x' }), /background thread/);
  await run(bg, { t: 'setVar', name: 'ok', value: 1 });
  assert.equal(bg.world.save.vars.ok, 1);
});

test('party: give/take change the inventory and emit; notify uses Terms; nameEntry renames the hero', async () => {
  const ctx = fakeCtx({ 'io.nameEntry': '  Zoë  ' });
  await run(ctx, { t: 'give', item: 'berry', count: 3 });
  assert.equal(ctx.world.save.inventory.berry, 5);
  assert.deepEqual(ctx.events.at(-1), ['itemChanged', { id: 'berry', delta: 3, count: 5 }]);
  await run(ctx, { t: 'take', item: 'berry', count: 10, notify: true });
  assert.equal(ctx.world.save.inventory.berry, undefined);
  assert.deepEqual(ctx.events.at(-1), ['itemChanged', { id: 'berry', delta: -5, count: 0 }]);
  assert.deepEqual(ctx.calls.at(-1), ['io.toast', { text: 'Lost 10 Berry.' }]);
  ctx.project.strings['got-item'] = 'You get {count} {item}';
  await run(ctx, { t: 'give', item: 'key', notify: true });
  assert.equal(ctx.world.save.inventory.key, 1);
  assert.deepEqual(ctx.calls.at(-1), ['io.toast', { text: 'You get 1 Old Key' }]);
  await run(ctx, { t: 'nameEntry', hero: 'hero', prompt: 'Name?', maxLength: 3 });
  assert.deepEqual(ctx.calls.at(-1), ['io.nameEntry', { hero: 'p1', prompt: 'Name?', maxLength: 3, current: 'Player 1' }]);
  assert.equal(ctx.world.save.heroes[0].name, 'Zoë');
  assert.deepEqual(ctx.events.at(-1), ['heroRenamed', { hero: 'p1', old: undefined, name: 'Zoë' }]);
  const cancelled = fakeCtx({ 'io.nameEntry': null });
  await run(cancelled, { t: 'nameEntry', hero: 'p2' });
  assert.deepEqual(cancelled.calls.at(-1), ['io.nameEntry', { hero: 'p2', prompt: 'What is your name?', maxLength: 8, current: 'Player 2' }]);
  assert.equal(cancelled.world.save.heroes[1].name, undefined);
});

test('movement, character, screen, picture, audio, system commands call their ports with normalized args', async () => {
  const ctx = fakeCtx({ 'io.choice': 0, 'game.save': true });
  const expect = async (cmd, call) => { ctx.calls.length = 0; await run(ctx, cmd); assert.deepEqual(ctx.calls[0], call, cmd.t); };
  await expect({ t: 'transfer', map: 'town', x: 3, y: 4, dir: 'left' }, ['map.transfer', { map: 'town', x: 3, y: 4, dir: 'left', fade: true }]);
  await expect({ t: 'transfer', map: 'town', fade: false }, ['map.transfer', { map: 'town', x: 0, y: 0, dir: 'down', fade: false }]);
  await expect({ t: 'setLocation', target: 'obj:door', x: 2, y: 2 }, ['map.setLocation', { target: 'obj:door', x: 2, y: 2, swap: null }]);
  await expect({ t: 'setLocation', swap: 'door' }, ['map.setLocation', { target: 'self', x: 0, y: 0, swap: 'door' }]);
  await expect({ t: 'moveRoute', target: 'p1', steps: ['up', 'face:left'], wait: false, repeat: true }, ['map.moveRoute', { target: 'p1', steps: ['up', 'face:left'], wait: false, skipBlocked: true, repeat: true }]);
  await expect({ t: 'scrollMap', dx: -2, dy: 3 }, ['map.scrollMap', { dx: -2, dy: 3, speed: 4 }]);
  await expect({ t: 'follow', on: false }, ['map.follow', { on: false }]);
  await expect({ t: 'transparency', on: true }, ['map.transparency', { target: 'hero', on: true }]);
  await expect({ t: 'animation', target: 'self', id: 'sparkle' }, ['map.animation', { target: 'self', id: 'sparkle' }]);
  await expect({ t: 'balloon', kind: '♥', wait: true }, ['map.balloon', { target: 'self', kind: '♥', wait: true }]);
  await expect({ t: 'erase' }, ['map.erase', { target: 'self', persistent: false }]);
  assert.equal(ctx.world.save.objects['town:mom'].hidden, undefined);
  await expect({ t: 'erase', target: 'obj:door', persistent: true }, ['map.erase', { target: 'obj:door', persistent: true }]);
  assert.equal(ctx.world.save.objects['town:door'].hidden, true);
  assert.deepEqual(ctx.events.at(-1), ['objectStateChanged', { objectKey: 'town:door' }]);
  await expect({ t: 'fadeOut', ms: 800 }, ['screen.fadeOut', { ms: 800, color: '#000000' }]);
  await expect({ t: 'fadeIn' }, ['screen.fadeIn', { ms: 400 }]);
  await expect({ t: 'tint', color: '#ff0000', amount: 0.5 }, ['screen.tint', { color: '#ff0000', amount: 0.5, ms: 400 }]);
  await expect({ t: 'flash' }, ['screen.flash', { color: '#ffffff', ms: 200 }]);
  await expect({ t: 'shake', power: 5, ms: 100 }, ['screen.shake', { power: 5, ms: 100 }]);
  await expect({ t: 'weather', kind: 'rain', power: 7 }, ['screen.weather', { kind: 'rain', power: 7, ms: 400 }]);
  await expect({ t: 'pictureShow', id: 'p', image: 'assets/x.png', x: 10, y: 20, anchor: 'center', opacity: 0.5 }, ['pictures.show', { id: 'p', image: 'assets/x.png', x: 10, y: 20, anchor: 'center', opacity: 0.5 }]);
  await expect({ t: 'pictureMove', id: 'p', x: 1, y: 2, ms: 100, wait: false }, ['pictures.move', { id: 'p', x: 1, y: 2, opacity: 1, ms: 100, wait: false }]);
  await expect({ t: 'pictureErase', id: 'p' }, ['pictures.erase', { id: 'p' }]);
  await expect({ t: 'music', id: 'town', fade: 500 }, ['audio.music', 'town', { fade: 500, volume: 1 }]);
  await expect({ t: 'music', id: null }, ['audio.music', null, { fade: 0, volume: 1 }]);
  await expect({ t: 'sound', id: 'sparkle', volume: 0.5 }, ['audio.play', 'sparkle', { volume: 0.5 }]);
  await expect({ t: 'layer', name: 'rain', on: true, ms: 1200 }, ['audio.layer', 'rain', true, 1200]);
  await expect({ t: 'layer', name: 'danger', on: false }, ['audio.layer', 'danger', false, 600]);
  await expect({ t: 'stopSound' }, ['audio.stop', 'sound']);
  await expect({ t: 'saveMusic' }, ['audio.save']);
  await expect({ t: 'replayMusic' }, ['audio.replay']);
  await expect({ t: 'jingle', id: 'fanfare' }, ['audio.jingle', 'fanfare']);
  await expect({ t: 'menu' }, ['game.menu']);
  await expect({ t: 'save' }, ['io.choice', { prompt: 'Save your progress?', options: [{ text: 'Yes', index: 0 }, { text: 'No', index: 1 }], cancel: 'last' }]);
  assert.deepEqual(ctx.calls.slice(1), [['game.save', { slot: 'autosave' }], ['io.toast', { text: 'Saved.' }]]);
  await expect({ t: 'save', prompt: false, slot: '1' }, ['game.save', { slot: '1' }]);
  const declined = fakeCtx({ 'io.choice': 1 });
  await run(declined, { t: 'save' });
  assert.equal(declined.calls.length, 1);
  const failed = fakeCtx({ 'game.save': false });
  await run(failed, { t: 'save', prompt: false });
  assert.deepEqual(failed.calls.at(-1), ['io.toast', { text: 'Could not save.' }]);
  ctx.calls.length = 0;
  assert.deepEqual(await run(ctx, { t: 'title' }), { kind: 'exit' });
  assert.deepEqual(ctx.calls, [['game.title']]);
  await expect({ t: 'chapter', title: 'Chapter {var:chapter}', subtitle: 'Home' }, ['io.chapter', { title: 'Chapter 1', subtitle: 'Home', ms: 2000 }]);
  await expect({ t: 'heal', hero: 'p2' }, ['game.heal', { hero: 'p2' }]);
  assert.deepEqual(ctx.events.at(-1), ['heal', { hero: 'p2' }]);
  await expect({ t: 'heal' }, ['game.heal', { hero: 'all' }]);
  await expect({ t: 'debug', text: 'chapter={var:chapter}' }, ['game.debug', { text: 'chapter=1' }]);
  assert.deepEqual(ctx.events.at(-1), ['debug', { text: 'chapter=1' }]);
  // a missing port is a clear error, never a silent no-op
  const broken = fakeCtx(); delete broken.audio.play;
  await assert.rejects(() => run(broken, { t: 'sound', id: 'sparkle' }), /ctx.audio.play/);
});

test('summaries: one line per command, disabled marked', () => {
  const ctx = fakeCtx();
  const s = (cmd) => CMD.summary(N(cmd), ctx);
  assert.equal(s({ t: 'say', who: 'Mom', text: 'Hi {p1}{pause}!\nBye' }), 'Mom: Hi {p1}! Bye');
  assert.equal(s({ t: 'say', text: 'x' }), 'x');
  assert.equal(s({ t: 'choice', prompt: 'Go?', options: [{ text: 'Yes' }, { text: 'No' }] }), 'Choice: Go? [Yes / No]');
  assert.equal(s({ t: 'give', item: 'berry', count: 3 }), 'Give 3× Berry');
  assert.equal(s({ t: 'take', item: 'key' }), 'Take 1× Old Key');
  assert.equal(s({ t: 'setVar', name: 'chapter', op: 'add', value: 1 }), 'chapter += 1');
  assert.equal(s({ t: 'setVar', name: 'd', op: 'random', min: 1, max: 6 }), 'd = random 1…6');
  assert.equal(s({ t: 'setSelf', key: 'done' }), 'self.done = true');
  assert.equal(s({ t: 'if', when: { kind: 'var', name: 'chapter', op: '>=', value: 2 } }), 'If chapter ≥ 2');
  assert.equal(s({ t: 'if' }), 'If always');
  assert.equal(s({ t: 'transfer', map: 'town', x: 1, y: 2, dir: 'up' }), 'Transfer to town (1, 2) facing up');
  assert.equal(s({ t: 'moveRoute', target: 'self', steps: ['up', 'left'] }), 'Move this object: up left');
  assert.equal(s({ t: 'call', script: 'meet-mom', args: [{ name: 'n', value: 1 }] }), 'Call meet-mom (n=1)');
  assert.equal(s({ t: 'music', id: null }), 'Stop music');
  assert.equal(s({ t: 'wait', ms: 500, disabled: true }), '(off) Wait 500 ms');
  assert.equal(CMD.summary({ t: 'raw', line: '???' }), 'Unparsed: ???');
  assert.equal(CMD.summary({ t: 'zzz' }), "Unknown command 'zzz'");
  for (const id of ALL) assert.equal(typeof s(Object.assign({ t: id }, id === 'call' ? { script: 'meet-mom' } : {}, id === 'transfer' ? { map: 'town' } : {})), 'string', id);
});

test('generic line form: genericToLine omits defaults and blocks, genericFromLine reads quoted/escaped/JSON values', () => {
  const cmd = N({ t: 'pictureShow', id: 'pic 1', image: 'a "b" c\nd', x: 3, y: 0, opacity: 0.5 });
  const line = CMD.genericToLine(cmd);
  assert.equal(line, '@pictureShow id="pic 1" image="a \\"b\\" c\\nd" x=3 opacity=0.5');
  assert.deepEqual(N(CMD.genericFromLine(line)), cmd);
  assert.equal(CMD.genericToLine(N({ t: 'if', when: { kind: 'coop' }, then: [{ t: 'exit' }] })), '@if when={"kind":"coop"}');    // blocks are not on the line
  assert.equal(CMD.genericToLine(N({ t: 'loop', body: [{ t: 'exit' }] })), '@loop');
  assert.equal(CMD.genericToLine(N({ t: 'give', item: 'berry', count: 1 })), '@give item=berry');
  assert.equal(CMD.genericToLine(N({ t: 'give', item: 'berry', count: 2, disabled: true })), '@give item=berry count=2 disabled=true');
  assert.equal(CMD.genericToLine({ t: 'custom', z: [1, 'a'], a: { b: true }, m: null }), '@custom a={"b":true} m=null z=[1,"a"]');
  assert.deepEqual(CMD.genericFromLine('@custom a={"b":true} m=null z=[1,"a"] s="x y" n=-2 t=true w=obj:mom'), { t: 'custom', a: { b: true }, m: null, z: [1, 'a'], s: 'x y', n: -2, t: true, w: 'obj:mom' });
  assert.equal(CMD.genericFromLine('@give berry'), null);        // positional words are not generic
  assert.equal(CMD.genericFromLine('give item=x'), null);
  assert.equal(CMD.genericFromLine('@x s="unterminated'), null);
  assert.deepEqual(CMD.genericFromLine('@exit'), { t: 'exit' });
});

test('sugar: toLine/fromLine round trips for say/choice/if/setVar/setSelf/call/transfer/moveRoute/wait/sound/music/fade/shake/balloon/comment + fallbacks', () => {
  const cases = [
    [{ t: 'say', who: 'Mom', text: 'Good morning, {p1}! {pause} Sleep well?' }, 'Mom: Good morning, {p1}! {pause} Sleep well?'],
    [{ t: 'say', who: 'Mom', face: 'mom-smile', text: 'The Professor was asking.', position: 'top' }, 'Mom (face=mom-smile, at=top): The Professor was asking.'],
    [{ t: 'say', who: 'Mom', text: 'line one\nline two \\ slash', bg: 'dim' }, 'Mom (bg=dim): line one\\nline two \\\\ slash'],
    [{ t: 'say', who: '', text: 'The kettle whistles.' }, '"The kettle whistles."'],
    [{ t: 'say', who: '', text: 'She said "hi"\nthen left', position: 'middle' }, '"She said \\"hi\\"\\nthen left" (at=middle)'],
    [{ t: 'say', who: 'Mom', text: '' }, 'Mom:'],
    [{ t: 'say', who: 'Dr. Oak-Smith 2', text: '@not a command? - no' }, 'Dr. Oak-Smith 2: @not a command? - no'],
    [{ t: 'say', who: 'Mom (elder)', text: 'x' }, '@say who="Mom (elder)" text=x'],
    [{ t: 'say', who: 'Mom', text: 'x', disabled: true }, '@say who=Mom text=x disabled=true'],
    [{ t: 'choice', prompt: 'Ready to go?', options: [] }, '? Ready to go?'],
    [{ t: 'choice', prompt: 'Ready (now)?', options: [], cancel: 'last' }, '? Ready (now)? (cancel=last)'],
    [{ t: 'choice', prompt: '', options: [] }, '?'],
    [{ t: 'if', when: { kind: 'var', name: 'chapter', op: '>=', value: 2 } }, '@if when: chapter >= 2'],
    [{ t: 'if', when: { kind: 'all', of: [{ kind: 'item', id: 'berry' }, { kind: 'not', of: { kind: 'self', key: 'done', value: true } }] } }, '@if when: item.berry >= 1 and not self.done == true'],
    [{ t: 'if' }, '@if'],
    [{ t: 'setVar', name: 'chapter', op: 'set', value: 2 }, '@set chapter = 2'],
    [{ t: 'setVar', name: 'chapter', op: 'add', value: 1 }, '@set chapter += 1'],
    [{ t: 'setVar', name: 'x', op: 'sub', value: 1 }, '@set x -= 1'],
    [{ t: 'setVar', name: 'x', op: 'mul', value: 2 }, '@set x *= 2'],
    [{ t: 'setVar', name: 'x', op: 'div', value: 2 }, '@set x /= 2'],
    [{ t: 'setVar', name: 'x', op: 'mod', value: 2 }, '@set x %= 2'],
    [{ t: 'setVar', name: 'name', op: 'set', value: 'two words' }, '@set name = "two words"'],
    [{ t: 'setVar', name: 'name', op: 'set', value: '12' }, '@set name = "12"'],
    [{ t: 'setVar', name: 'flag', op: 'set', value: true }, '@set flag = true'],
    [{ t: 'setVar', name: 'dice', op: 'random', min: 1, max: 6 }, '@set dice = random(1, 6)'],
    [{ t: 'setVar', name: 'copy', op: 'copyVar', var: 'other' }, '@set copy = var:other'],
    [{ t: 'setSelf', key: 'opened', op: 'set', value: true }, '@self opened = true'],
    [{ t: 'setSelf', key: 'visits', op: 'add', value: 1 }, '@self visits += 1'],
    [{ t: 'setSelf', key: 'opened', op: 'toggle' }, '@self opened toggle'],
    [{ t: 'call', script: 'meet-mom' }, '@call meet-mom'],
    [{ t: 'call', script: 'meet-mom', args: [{ name: 'count', value: 3 }, { name: 'who', value: 'the mom' }] }, '@call meet-mom count=3 who="the mom"'],
    [{ t: 'transfer', map: 'town', x: 10, y: 12, dir: 'down' }, '@transfer town 10 12 down'],
    [{ t: 'transfer', map: 'town', x: 1, y: 2, dir: 'up', fade: false }, '@transfer town 1 2 up fade=false'],
    [{ t: 'moveRoute', target: 'self', steps: ['up', 'up', 'left'] }, '@move self: up up left'],
    [{ t: 'moveRoute', target: 'obj:door', steps: ['jump:1,2', 'wait:300'], wait: false, repeat: true }, '@move obj:door (wait=false, repeat=true): jump:1,2 wait:300'],
    [{ t: 'moveRoute', target: 'p1', steps: [] }, '@move p1:'],
    [{ t: 'wait', ms: 500 }, '@wait 500'],
    [{ t: 'wait', ms: 0 }, '@wait 0'],
    [{ t: 'sound', id: 'sparkle' }, '@sound sparkle'],
    [{ t: 'sound', id: 'sparkle', volume: 0.5 }, '@sound sparkle volume=0.5'],
    [{ t: 'music', id: 'town' }, '@music town'],
    [{ t: 'music', id: 'town', fade: 800 }, '@music town fade=800'],
    [{ t: 'music', id: null }, '@music none'],
    [{ t: 'jingle', id: 'fanfare' }, '@jingle fanfare'],
    [{ t: 'fadeOut' }, '@fade out'],
    [{ t: 'fadeOut', ms: 800, color: '#ffffff' }, '@fade out ms=800 color="#ffffff"'],
    [{ t: 'fadeIn', ms: 100 }, '@fade in ms=100'],
    [{ t: 'shake' }, '@shake'],
    [{ t: 'shake', power: 6 }, '@shake power=6'],
    [{ t: 'balloon', target: 'self', kind: '!' }, '@balloon self !'],
    [{ t: 'balloon', target: 'obj:mom', kind: '…', wait: true }, '@balloon obj:mom … wait=true'],
    [{ t: 'comment', text: 'a comment line' }, '# a comment line'],
    [{ t: 'comment', text: '' }, '#'],
    [{ t: 'label', name: 'top' }, '@label top'],
    [{ t: 'jump', label: 'top' }, '@jump top'],
    [{ t: 'loop' }, '@loop'],
    [{ t: 'group', label: 'Intro scene' }, '@group label="Intro scene"'],
    [{ t: 'give', item: 'berry', count: 3 }, '@give item=berry count=3'],
    [{ t: 'exit' }, '@exit'],
    [{ t: 'tint', color: '#102030', amount: 1 }, '@tint color="#102030" amount=1'],
  ];
  for (const [cmd, line] of cases) {
    const n = N(cmd);
    assert.equal(CMD.toLine(n), line);
    assert.deepEqual(CMD.fromLine(line), n, line);
  }
  // lenient parsing of hand-written variants
  assert.deepEqual(CMD.fromLine('@wait ms=500'), N({ t: 'wait', ms: 500 }));
  assert.deepEqual(CMD.fromLine('@if chapter >= 2'), N({ t: 'if', when: { kind: 'var', name: 'chapter', op: '>=', value: 2 } }));
  assert.deepEqual(CMD.fromLine('@set name = hello world'), N({ t: 'setVar', name: 'name', op: 'set', value: 'hello world' }));
  assert.deepEqual(CMD.fromLine('@music stop'), N({ t: 'music', id: null }));
  assert.deepEqual(CMD.fromLine('@transfer map=town x=10 y=12 dir=down'), N({ t: 'transfer', map: 'town', x: 10, y: 12, dir: 'down' }));
  assert.deepEqual(CMD.fromLine('@moveRoute target=self steps=["up","left"] wait=true'), N({ t: 'moveRoute', target: 'self', steps: ['up', 'left'] }));
  assert.deepEqual(CMD.fromLine('Mom:Hi'), N({ t: 'say', who: 'Mom', text: 'Hi' }));
  assert.deepEqual(CMD.fromLine('@setVar name=chapter op=add value=1'), N({ t: 'setVar', name: 'chapter', op: 'add', value: 1 }));
  // structural / unparsable lines
  assert.equal(CMD.fromLine('@else'), null);
  assert.equal(CMD.fromLine('@end'), null);
  assert.equal(CMD.fromLine(''), null);
  assert.equal(CMD.fromLine(':: header when: x == 1'), null);
  assert.equal(CMD.fromLine('@if when: chapter >='), null);
  assert.equal(CMD.fromLine('@transfer town 1 2 down extra'), null);
  assert.equal(CMD.fromLine('just some words'), null);
  assert.deepEqual(CMD.fromLine('@unknownCmd a=1'), { t: 'unknownCmd', a: 1 });
  assert.equal(CMD.toLine({ t: 'raw', line: 'keep me' }), 'keep me');
  assert.equal(reg.get('if').text.elseLine, '@else'); assert.equal(reg.get('loop').text.endLine, '@end');
  // choice option lines
  assert.equal(CMD.option.toLine({ text: 'Yes', when: null, then: [] }), '- Yes');
  assert.equal(CMD.option.toLine({ text: 'Not yet', when: { kind: 'coop' }, then: [] }), '- Not yet [when: coop()]');
  assert.deepEqual(CMD.option.fromLine('- Not yet [when: coop()]'), { text: 'Not yet', when: { kind: 'coop' }, then: [] });
  assert.deepEqual(CMD.option.fromLine('-'), { text: '', when: null, then: [] });
  assert.equal(CMD.option.fromLine('x'), null);
});

test('script schema: validateScript (unknown t, raw ok, bad fields, nested, background), refs (read/write), walk, normalize', () => {
  const S = KIT.schema;
  const ctx = { project: fakeCtx().project };
  const script = [
    { t: 'say', who: 'Mom', text: 'Hi' },
    { t: 'raw', line: '???' },
    { t: 'nope', x: 1 },
    { t: 'give', item: 'ghost', count: 0 },
    { t: 'if', when: { kind: 'zzz' }, then: [{ t: 'setVar', name: 'chapter', op: 'wrong', value: 1 }], else: [{ t: 'transfer', map: 'nowhere', x: -1 }] },
    { t: 'choice', prompt: 'p', options: [{ text: 'a', then: [{ t: 'balloon', kind: 'nope' }] }] },
    { t: 'wait', ms: 'soon' },
    { t: 'raw' },
    'not a command',
  ];
  const errs = CMD.validateScript(script, ctx);
  const codes = errs.map(e => e.path.join('.') + ':' + e.code).sort();
  assert.deepEqual(codes, ['2:unknown', '3.count:min', '3.item:ref', '4.else.0.map:ref', '4.else.0.x:min', '4.then.0.op:enum', '4.when:unknown', '5.options.0.then.0.kind:enum', '6.ms:type', '7.line:type', '8:type'].sort());
  assert.ok(errs.find(e => e.path.join('.') === '2').message.includes("unknown command 'nope'"));
  assert.deepEqual(CMD.validateScript([{ t: 'say', text: 'x' }, { t: 'setVar', name: 'a', value: 1 }, { t: 'if', then: [{ t: 'choice', prompt: '', options: [{ text: 'x', then: [] }] }] }], { background: true }).map(e => e.path.join('.') + ':' + e.code), ['0:background', '2.then.0:background']);
  assert.deepEqual(CMD.validateScript([]), []);
  assert.equal(CMD.validateScript({}, ctx)[0].code, 'type');
  const good = CMD.normalizeAll([{ t: 'say', who: 'Mom', text: 'Hi' }, { t: 'give', item: 'berry' }, { t: 'if', when: { kind: 'var', name: 'chapter', op: '>=', value: 1 }, then: [{ t: 'call', script: 'meet-mom' }] }]);
  assert.deepEqual(CMD.validateScript(good, ctx), []);
  // refs with access
  const refs = CMD.refs([
    { t: 'setVar', name: 'chapter', op: 'copyVar', var: 'other' },
    { t: 'setSelf', key: 'x' },
    { t: 'give', item: 'berry' },
    { t: 'inputNumber', var: 'answer' },
    { t: 'if', when: { kind: 'item', id: 'key' }, then: [{ t: 'call', script: 'meet-mom' }, { t: 'transfer', map: 'town' }], else: [{ t: 'moveRoute', target: 'obj:door', steps: [] }] },
    { t: 'choice', options: [{ text: 'a', when: { kind: 'var', name: 'seen' }, then: [{ t: 'sound', id: 'sparkle' }, { t: 'setLocation', swap: 'mom' }] }] },
    { t: 'say', face: 'mom-smile', text: 'x' },
    { t: 'music', id: null },
  ], ctx);
  assert.deepEqual(refs.map(r => `${r.kind}:${r.id}:${r.access}@${r.path.join('.')}`), [
    'var:chapter:write@0.name', 'var:other:read@0.var', 'item:berry:read@2.item', 'var:answer:write@3.var',
    'item:key:read@4.when.id', 'script:meet-mom:read@4.then.0.script', 'map:town:read@4.then.1.map', 'object:door:read@4.else.0.target',
    'var:seen:read@5.options.0.when.name', 'sound:sparkle:read@5.options.0.then.0.id', 'object:mom:read@5.options.0.then.1.swap', 'face:mom-smile:read@6.face',
  ]);
  // the same through the schema type inside a page-like object
  const pageFields = [{ key: 'on', type: 'group', fields: [{ key: 'interact', type: 'script' }] }];
  assert.deepEqual(S.refs(pageFields, { on: { interact: [{ t: 'give', item: 'berry' }] } }).map(r => r.path.join('.')), ['on.interact.0.item']);
  assert.deepEqual(S.defaults(pageFields), { on: { interact: [] } });
  // walk with paths
  const seen = [];
  CMD.walk(good, (cmd, path) => seen.push(cmd.t + '@' + path.join('.')));
  assert.deepEqual(seen, ['say@0', 'give@1', 'if@2', 'call@2.then.0']);
  const seen2 = [];
  CMD.walk([{ t: 'choice', options: [{ text: 'a', then: [{ t: 'loop', body: [{ t: 'break' }] }] }] }, { t: 'group', body: [{ t: 'exit' }] }], (c, p) => { seen2.push(p.join('.')); return c.t !== 'group'; });
  assert.deepEqual(seen2, ['0', '0.options.0.then.0', '0.options.0.then.0.body.0', '1']);
  assert.deepEqual(CMD.blockFields(reg.get('if')), ['then', 'else']);
  assert.deepEqual(CMD.blockFields(reg.get('choice')), ['options']);
  assert.deepEqual(CMD.nested(N({ t: 'choice', options: [{ text: 'a' }, { text: 'b' }] })).map(n => n.path.join('.')), ['options.0.then', 'options.1.then']);
  // normalize fills defaults deeply and keeps extras
  assert.deepEqual(N({ t: 'if', then: [{ t: 'say', text: 'x' }], extra: 1 }), { t: 'if', when: null, then: [{ t: 'say', who: '', face: null, text: 'x', position: 'bottom', bg: 'window', voice: null }], else: [], extra: 1 });
  assert.deepEqual(N({ t: 'raw', line: 'x' }), { t: 'raw', line: 'x' });
});

// ---- voices: what somebody sounds like while their words appear ------------------
test('voices: a speaker sounds like themselves, and a line can say otherwise', async () => {
  const voices = KIT.registry('voices');
  assert.ok(voices.get('default'), 'the engine ships a default voice');
  for (const id of ['low', 'high', 'soft', 'flat', 'none']) assert.ok(voices.get(id), id);

  const project = KIT.project.normalize({
    version: 3, meta: { id: 'voice-test' }, maps: { a: {} },
    heroes: [{ id: 'p1', name: 'You' }],
    cast: {
      mira: { name: 'Mira', voice: 'low' },
      wren: { name: 'Wren' },
    },
  }).project;
  assert.equal(project.cast.mira.voice, 'low', 'a person carries their voice');
  assert.equal(project.cast.wren.voice, null, 'and not having one is fine');

  const ctx = fakeCtx({}, { project });
  const saidVoice = (i) => ctx.calls[i][1].voice;

  // the cast member's own voice, found by the NAME on screen
  await run(ctx, { t: 'say', who: 'Mira', text: 'Hello.' });
  assert.equal(saidVoice(0), 'low', 'Mira sounds like Mira without being told twice');

  // somebody with no voice of their own carries none, and the box uses the default
  await run(ctx, { t: 'say', who: 'Wren', text: 'Hello.' });
  assert.equal(saidVoice(1), undefined, 'nothing to say about it');

  // a line can whisper
  await run(ctx, { t: 'say', who: 'Mira', text: 'Quietly.', voice: 'soft' });
  assert.equal(saidVoice(2), 'soft', 'this line overrides her usual one');

  // and a game can set one for everybody
  const hushed = KIT.project.normalize({
    version: 3, meta: { id: 'v2' }, maps: { a: {} }, settings: { voice: 'flat' },
  }).project;
  const ctx2 = fakeCtx({}, { project: hushed });
  await run(ctx2, { t: 'say', who: 'Anybody', text: 'Hm.' });
  assert.equal(ctx2.calls[0][1].voice, 'flat', 'the project default reaches a stranger');
});

test('voices: the say line carries it, losslessly', () => {
  const def = KIT.registry('commands').get('say');
  for (const line of ['Mira (voice=soft): Quietly.', 'Mira (face=mom-smile, voice=low): Hello.', 'Mira: Plain.']) {
    const cmd = def.text.fromLine(line);
    assert.ok(cmd, line);
    assert.equal(def.text.toLine(cmd), line, line);
  }
});

test('voices: pitch and rate are what make one blip into a cast', () => {
  // One sound, six speakers. This is the Animal Crossing trick and it is why a
  // voice is three numbers rather than a recording.
  const v = (id) => KIT.registry('voices').get(id);
  assert.ok(v('low').pitch < v('default').pitch, 'low is lower');
  assert.ok(v('high').pitch > v('default').pitch, 'high is higher');
  assert.equal(v('none').volume, 0, 'and one of them says nothing at all');
  for (const id of KIT.registry('voices').ids()) {
    const d = v(id);
    assert.ok(d.everyChars >= 1, id + ' blips at a sane rate');
    assert.ok(d.pitch > 0, id + ' has a pitch');
  }
  // they all name a sound that exists, or none
  for (const id of KIT.registry('voices').ids()) {
    const d = v(id);
    if (d.sound) assert.ok(KIT.registry('sounds').has(d.sound), id + ' -> ' + d.sound);
  }
});

test('commands: a switched-off command survives the Text view, whatever its sugar', () => {
  // `@if disabled=true` used to come back as "if the variable `disabled` is true".
  const CMD = KIT.commands, reg = KIT.registry('commands');
  let checked = 0;
  for (const def of reg.list()) {
    if (!def.text || typeof def.text.toLine !== 'function') continue;
    const cmd = Object.assign({ t: def.id }, (def.fields || []).reduce((o, f) => { if (f.default !== undefined) o[f.key] = f.default; return o; }, {}), { disabled: true });
    const line = CMD.toLine(cmd);
    const back = CMD.fromLine(line);
    assert.ok(back && back.t === def.id && back.disabled === true, `${def.id}: ${JSON.stringify(line)} -> ${JSON.stringify(back)}`);
    checked++;
  }
  assert.ok(checked > 10, `checked ${checked} sugars`);
  assert.deepEqual(CMD.fromLine('@if disabled=true').when, null);
  assert.equal(CMD.fromLine('@if when: chapter >= 2').when.kind, 'var', 'a real condition still reads as one');
  assert.equal(CMD.fromLine('@meet mira').who, 'mira');
});
