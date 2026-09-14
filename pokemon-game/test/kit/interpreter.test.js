'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KIT = require('./_load.js');
const I = KIT.interpreter, SP = KIT.screenplay;

const script = (text) => { if (Array.isArray(text)) text = text.join('\n'); const r = SP.parse(text); assert.equal(r.problems.length, 0, JSON.stringify(r.problems)); return r.commands; };

test('interpreter: branching story with choices, vars, self, items', async () => {
  const cmds = script([
    'Mom: Good morning, {p1}!',
    '? Ready?',
    '- Yes',
    '    @set chapter = 1',
    '    @give item=berry count=3 notify=true',
    '- No',
    '    Mom: Take your time.',
    '@if when: chapter >= 1 and item.berry >= 3',
    '    Mom: Off you go, {p1}.',
    '    @self talked = true',
    '@else',
    '    Mom: Hmm.',
    '@end',
  ].join('\n'));
  const ctx = I.fakeCtx({ answers: ['Yes'], self: 'home:mom' });
  const r = await I.run(cmds, ctx);
  assert.equal(r.status, 'done');
  assert.deepEqual(ctx.said(), ['Good morning, Ash!', 'Off you go, Ash.']);
  assert.equal(ctx.world.save.vars.chapter, 1);
  assert.equal(ctx.world.save.inventory.berry, 3);
  assert.equal(ctx.world.save.objects['home:mom'].self.talked, true);
  assert.ok(ctx.calls('io', 'toast').length === 1);
  const ctx2 = I.fakeCtx({ answers: [1] });
  await I.run(cmds, ctx2);
  assert.deepEqual(ctx2.said(), ['Good morning, Ash!', 'Take your time.', 'Hmm.']);
});

test('interpreter: loops, break, labels, jump, exit', async () => {
  const cmds = script(['@set n = 0', '@loop', '    @set n += 1', '    @if when: n >= 3', '        @break', '    @end', '@end', '@label again', '@set m += 1', '@if when: m < 2', '    @jump again', '@end', '@if when: m == 2', '    @exit', '@end', 'Mom: never'].join('\n'));
  const ctx = I.fakeCtx();
  const r = await I.run(cmds, ctx);
  assert.equal(r.status, 'exit');
  assert.equal(ctx.world.save.vars.n, 3);
  assert.equal(ctx.world.save.vars.m, 2);
  assert.deepEqual(ctx.said(), []);
});

test('interpreter: call with args and params; exit inside a called script ends only that script', async () => {
  const project = { heroes: [{ id: 'p1', name: 'Ash' }, { id: 'p2', name: 'Misty' }], items: { berry: { name: 'Berry' } }, scripts: {
    'give-balls': { trigger: 'call', when: null, params: ['n', 'who'], body: script(['@give item=berry count=2', 'Prof: Here are {arg:n} for {arg:who}.', '@exit', 'Prof: unreachable']) },
    'intro': { trigger: 'auto', when: { kind: 'var', name: 'introDone', op: '==', value: false }, params: [], body: script(['Narrator: Once upon a time.', '@set introDone = true']) },
    'never': { trigger: 'auto', when: { kind: 'var', name: 'x', op: '==', value: 1 }, params: [], body: script(['Narrator: no']) },
    'bg': { trigger: 'parallel', when: null, params: [], body: script(['@set ticks += 1']) },
  } };
  const ctx = I.fakeCtx({ project, save: { vars: { introDone: false } } });
  await I.run(script(['@call give-balls n=5 who=you', 'Mom: after']), ctx);
  assert.deepEqual(ctx.said(), ['Here are 5 for you.', 'after']);
  assert.equal(ctx.world.save.inventory.berry, 2);
  assert.deepEqual(await I.runAuto(project, ctx), ['intro']);
  assert.deepEqual(ctx.said().slice(-1), ['Once upon a time.']);
  assert.deepEqual(await I.runAuto(project, ctx), []);   // introDone is now true
  const bg = I.runParallel(project, ctx);
  await Promise.all(bg.map(b => b.promise));
  assert.equal(ctx.world.save.vars.ticks, 1);
});

test('interpreter: background threads refuse main-thread commands; main runs are exclusive and ordered', async () => {
  const ctx = I.fakeCtx();
  await assert.rejects(I.run(script(['Mom: hi']), ctx, { kind: 'background' }), /cannot run on a background thread/);
  const order = [];
  const slow = I.fakeCtx({ onSay: (o) => order.push(o.text) });
  const a = I.run(script(['A: 1', '@wait 1', 'A: 2']), slow);
  assert.ok(I.mainBusy());
  const b = I.run(script(['B: 1']), slow);
  await Promise.all([a, b]);
  assert.deepEqual(order, ['1', '2', '1']);
  assert.deepEqual(slow.said(), ['1', '2', '1']);
  assert.ok(!I.mainBusy());
});

test('interpreter: cancel, breakpoints, pause/step, onStep paths', async () => {
  const cmds = script(['Mom: one', 'Mom: two', '@if when: always', '    Mom: three', '@end', 'Mom: four']);
  const steps = [];
  const ctx = I.fakeCtx();
  ctx.onStep = (cmd, path, thread) => { steps.push(path.join('/')); if (path.join('/') === '1') thread.cancel(); };
  const r = await I.run(cmds, ctx);
  assert.equal(r.status, 'cancelled');
  assert.deepEqual(ctx.said(), ['one']);
  assert.deepEqual(steps, ['0', '1']);
  // breakpoints
  const ctx2 = I.fakeCtx();
  let thread = null;
  ctx2.onStep = (cmd, path, t) => { thread = t; };
  const p = I.run(cmds, ctx2);
  await new Promise(r => setTimeout(r, 0));
  assert.ok(thread);
  thread.pause();
  await new Promise(r => setTimeout(r, 5));
  const saidWhenPaused = ctx2.said().length;
  assert.ok(saidWhenPaused < 4);
  thread.step();
  await new Promise(r => setTimeout(r, 5));
  assert.equal(ctx2.said().length, saidWhenPaused + 1);
  assert.ok(thread.paused);
  thread.resume();
  const r2 = await p;
  assert.equal(r2.status, 'done');
  assert.deepEqual(ctx2.said(), ['one', 'two', 'three', 'four']);
  const ctx3 = I.fakeCtx();
  const p3 = I.run(cmds, ctx3);
  await new Promise(r => setTimeout(r, 0));
  const t3 = I.threads()[0];
  assert.ok(t3, 'thread visible while running');
  t3.breakpoints.add('2/then/0');
  await new Promise(r => setTimeout(r, 5));
  if (t3.paused) { assert.deepEqual(ctx3.said(), ['one', 'two']); t3.resume(); }
  await p3;
  assert.deepEqual(ctx3.said(), ['one', 'two', 'three', 'four']);
});

test('interpreter: determinism — same seed and answers give identical logs', async () => {
  const cmds = script(['@set r = random(1, 100)', '@set s = random(1, 100)', 'Mom: {var:r} {var:s}', '? pick', '- a', '    Mom: A', '- b', '    Mom: B']);
  const run = async () => { const ctx = I.fakeCtx({ seed: 42, answers: [1] }); await I.run(cmds, ctx); return JSON.stringify(ctx.log); };
  assert.equal(await run(), await run());
  const other = I.fakeCtx({ seed: 7, answers: [1] }); await I.run(cmds, other);
  assert.notEqual(JSON.stringify(other.log), await run());
});
