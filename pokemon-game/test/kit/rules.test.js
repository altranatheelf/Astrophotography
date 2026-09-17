'use strict';
// RULES ARE THINGS.
//
// The point of this file is not that a callback runs. It is that the rules of
// the world are objects a story can reach: turned off, rewritten, and eaten —
// and that after they are eaten the world plays differently, from the save,
// with the project untouched.
//
// Each test names the DEFAULT it is pinning, in the same way the interaction
// matrix does, because "what happens when two of these meet" is the part that
// rots silently.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('./_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));
R('js/kit/world/map.js'); R('js/kit/world/entities.js'); R('js/kit/world/world.js'); R('js/kit/systems/index.js');
const P = KIT.project, SP = KIT.screenplay, C = KIT.conditions, RU = KIT.rules;

const tiles = KIT.registry('tiles');
for (const t of [{ id: 'grass', group: 'nature' }, { id: 'wall', group: 'town', solid: true }, { id: 'floor-wood', group: 'interior' }]) if (!tiles.has(t.id)) tiles.add(t);
const body = (lines) => { const r = SP.parse(lines.join('\n')); assert.deepEqual(r.problems, [], JSON.stringify(r.problems)); return r.commands; };

function makeProject(rules) {
  const raw = {
    version: 3, meta: { id: 'rules-demo', title: 'Rules' },
    heroes: [{ id: 'p1', name: 'Ash', sprite: 'hero-boy' }],
    start: { map: 'home', x: 2, y: 2, dir: 'down' },
    vars: { steps: { type: 'number', default: 0 }, mood: { type: 'number', default: 0 } },
    rules: rules || {},
    maps: {
      home: { id: 'home', name: 'Home', width: 8, height: 6, kind: 'indoor', objects: [] },
      town: { id: 'town', name: 'Town', width: 8, height: 6, kind: 'outdoor', objects: [] },
    },
  };
  const { project, problems } = P.normalize(raw);
  assert.deepEqual(problems.filter(p => p.severity === 'error'), []);
  return project;
}
function makeWorld(project) {
  const fake = KIT.interpreter.fakeCtx({ project });
  const save = { vars: {}, inventory: {}, objects: {}, heroes: [{}], overlays: {}, meta: {} };
  for (const [k, v] of Object.entries(project.vars || {})) save.vars[k] = v.default;
  const world = KIT.world.create({ project, save, rng: KIT.rng(5),
    ports: { io: fake.io, audio: fake.audio, screen: fake.screen, pictures: fake.pictures, game: fake.game, map: fake.map } });
  world.fake = fake;
  world.said = () => fake.log.filter(e => e.port === 'io' && e.name === 'say').map(e => e.args[0].text);
  return world;
}
/**
 * Catch what the engine says while a test deliberately breaks something. Both
 * KIT.log and console are covered, because a headless test loads neither the
 * logger nor KIT.game and the engine falls back to console on purpose.
 */
function hush(level, onto) {
  const targets = [console].concat(KIT.log ? [KIT.log] : []);
  const olds = targets.map(t => t[level]);
  for (const t of targets) t[level] = onto || (() => {});
  return () => targets.forEach((t, i) => { t[level] = olds[i]; });
}
/** Walk one square and let every rule the step woke up finish. */
async function step(world, dx, dy) {
  const h = world.hero();
  h.x += dx; h.y += dy;
  world.events.emit('step', { hero: h.id, x: h.x, y: h.y, map: world.map.id });
  await world.rulesSettled();
}

// ---- the shape of a rule ----------------------------------------------------

test('rules: a rule is a trigger, a condition and a script — and nothing new to learn', () => {
  // DEFAULT: `if` is an ordinary condition and `do` is an ordinary command list,
  // so everything that already works on them — the editor widget, the validator,
  // the text form, the reference index, translation extraction — works here for
  // free. A rule DSL would have had to reinvent every one of those.
  const project = makeProject({
    'doors-need-keys': { when: 'bump', if: { kind: 'var', name: 'mood', op: '>=', value: 1 }, do: body(['Narrator: It is locked.']) },
  });
  const r = project.rules['doors-need-keys'];
  assert.equal(r.id, 'doors-need-keys');
  assert.equal(r.name, 'Doors Need Keys', 'an unnamed rule is named after its id');
  assert.equal(r.when, 'bump');
  assert.equal(r.on, true, 'a rule is in force unless it says otherwise');
  assert.equal(r.edible, true, 'and can be eaten unless it says otherwise');
  assert.equal(C.toText(r.if), 'mood >= 1', 'the condition is the same condition');
  assert.equal(r.do[0].t, 'say', 'and the script is the same script');
});

test('rules: `rule.<id>` reads and writes as one bare word', () => {
  // DEFAULT: asking whether a rule stands is not a comparison against anything,
  // so it has no operator. `not rule.x` is how you ask whether it has been eaten.
  for (const [text, shape] of [
    ['rule.doors-need-keys', { kind: 'rule', id: 'doors-need-keys' }],
    ['not rule.gravity', { kind: 'not', of: { kind: 'rule', id: 'gravity' } }],
  ]) {
    const c = C.parseText(text);
    assert.deepEqual(c, shape, text);
    assert.equal(C.toText(c), text, `${text} round-trips`);
  }
  const both = C.parseText('rule.a and mood >= 2');
  assert.equal(C.toText(both), 'rule.a and mood >= 2', 'and mixes with everything else');
});

// ---- firing -----------------------------------------------------------------

test('rules: a rule fires on the event it names, and on no other', async () => {
  // DEFAULT: `when` is an event name, matched exactly. Nothing is implicit.
  const world = makeWorld(makeProject({
    counter: { when: 'step', do: body(['@set steps += 1']) },
    elsewhere: { when: 'mapEnter', do: body(['@set mood += 1']) },
  }));
  await world.enterMap('home', 2, 2, 'down');
  await world.rulesSettled();
  assert.equal(world.save.vars.mood, 1, 'entering fired the mapEnter rule');
  assert.equal(world.save.vars.steps, 0, 'and not the step one');
  await step(world, 1, 0);
  await step(world, 1, 0);
  assert.equal(world.save.vars.steps, 2);
  assert.equal(world.save.vars.mood, 1, 'walking did not fire mapEnter again');
});

test('rules: the condition decides, and it is the condition an event page uses', async () => {
  const world = makeWorld(makeProject({
    grumpy: { when: 'step', if: { kind: 'var', name: 'mood', op: '>=', value: 1 }, do: body(['@set steps += 1']) },
  }));
  await world.enterMap('home', 2, 2, 'down');
  await step(world, 1, 0);
  assert.equal(world.save.vars.steps, 0, 'the condition was false, so nothing happened');
  world.save.vars.mood = 1;
  await step(world, 1, 0);
  assert.equal(world.save.vars.steps, 1, 'and true, so it did');
});

test('rules: a rule scoped to a place does not follow you out of it', async () => {
  // DEFAULT: a scope with nothing in it is global. That is the common case and
  // should not have to be said.
  const world = makeWorld(makeProject({
    athome: { when: 'step', scope: { maps: ['home'] }, do: body(['@set steps += 1']) },
    anywhere: { when: 'step', do: body(['@set mood += 1']) },
  }));
  await world.enterMap('home', 2, 2, 'down');
  await step(world, 1, 0);
  assert.equal(world.save.vars.steps, 1);
  await world.enterMap('town', 2, 2, 'down');
  await step(world, 1, 0);
  assert.equal(world.save.vars.steps, 1, 'the home rule stayed at home');
  assert.equal(world.save.vars.mood, 2, 'the global one came along');
});

test('rules: order is priority, then specificity, then recency, then id', () => {
  // DEFAULT: stated and tested, so a game never depends on which rule happened
  // to be written first in the file.
  const project = makeProject({
    zebra: { when: 'step' },
    apple: { when: 'step' },
    here: { when: 'step', scope: { maps: ['home'] } },
    loud: { when: 'step', priority: 5 },
  });
  const save = {};
  const order = RU.matching(project, save, 'step', { map: 'home' }).map(r => r.id);
  assert.deepEqual(order, ['loud', 'here', 'apple', 'zebra'],
    'priority first, then the one that named this place, then alphabetical');
  RU.define(save, { id: 'late', when: 'step' });
  const withLate = RU.matching(project, save, 'step', { map: 'home' }).map(r => r.id);
  assert.equal(withLate[2], 'late', 'a rule defined later in the run beats the ones that shipped');
});

// ---- eating -----------------------------------------------------------------

test('rules: eating a rule takes it out of the world, and the world plays differently', async () => {
  // THE WHOLE POINT. The project is not edited; the save says the rule is gone.
  const world = makeWorld(makeProject({
    'doors-need-keys': { when: 'step', do: body(['@set steps += 1']) },
  }));
  await world.enterMap('home', 2, 2, 'down');
  await step(world, 1, 0);
  assert.equal(world.save.vars.steps, 1);

  await KIT.interpreter.run(body(['@rule eat doors-need-keys']), world.makeCtx(null, 'p1'));
  await step(world, 1, 0);
  assert.equal(world.save.vars.steps, 1, 'the rule no longer applies');
  assert.equal(world.project.rules['doors-need-keys'].on, true, 'and the project was never touched');
  assert.equal(RU.live(world.project, world.save, 'doors-need-keys'), false);
});

test('rules: an eaten rule is written into the history, and a later line can ask', async () => {
  const world = makeWorld(makeProject({ gravity: { when: 'step' } }));
  await world.enterMap('home', 2, 2, 'down');
  RU.eat(world.save, 'gravity');
  assert.equal(KIT.history.has(world.save, { verb: 'ate', what: 'rule:gravity' }), true);
  const ctx = { project: world.project, world };
  assert.equal(C.test(C.parseText('not rule.gravity'), ctx), true, 'and the condition agrees');
  assert.equal(C.test(C.parseText('did.ate/rule:gravity >= 1'), ctx), true, 'as does the history');
});

test('rules: eating is permanent, and beats being switched back on', () => {
  // DEFAULT: off is a mood; eaten is a fact. `@rule on` cannot undo an eating,
  // because a story that can put the tome back together should say so itself.
  const project = makeProject({ gravity: { when: 'step' } });
  const save = {};
  RU.deactivate(save, 'gravity');
  assert.equal(RU.live(project, save, 'gravity'), false);
  RU.activate(save, 'gravity');
  assert.equal(RU.live(project, save, 'gravity'), true, 'off and on again is back where it started');
  RU.eat(save, 'gravity');
  RU.activate(save, 'gravity');
  assert.equal(RU.live(project, save, 'gravity'), false, 'eaten stays eaten');
  assert.equal(RU.eat(save, 'gravity'), false, 'and eating it twice is not a second meal');
});

test('rules: a rule an author marked inedible refuses, out loud', async () => {
  const world = makeWorld(makeProject({ breathing: { when: 'step', edible: false } }));
  await world.enterMap('home', 2, 2, 'down');
  const warned = [];
  const quiet = hush('warn', (...a) => warned.push(a.join(' ')));
  try { await KIT.interpreter.run(body(['@rule eat breathing']), world.makeCtx(null, 'p1')); }
  finally { quiet(); }
  assert.equal(RU.live(world.project, world.save, 'breathing'), true, 'still standing');
  assert.ok(warned.some(w => w.includes('breathing')), `and said so: ${JSON.stringify(warned)}`);
});

// ---- rewriting and defining -------------------------------------------------

test('rules: a rule can be rewritten from inside the game', async () => {
  const world = makeWorld(makeProject({
    tax: { when: 'step', do: body(['@set mood += 1']) },
  }));
  await world.enterMap('home', 2, 2, 'down');
  await step(world, 1, 0);
  assert.equal(world.save.vars.mood, 1);
  RU.rewrite(world.save, 'tax', { when: 'mapEnter' });
  await step(world, 1, 0);
  assert.equal(world.save.vars.mood, 1, 'it no longer listens for a step');
  await world.enterMap('town', 2, 2, 'down');
  await world.rulesSettled();
  assert.equal(world.save.vars.mood, 2, 'it listens for an arrival instead');
  assert.equal(world.project.rules.tax.when, 'step', 'and the project still says what it always said');
});

test('rules: a rule that did not exist when the game shipped is still a rule', async () => {
  const world = makeWorld(makeProject({}));
  await world.enterMap('home', 2, 2, 'down');
  RU.define(world.save, { id: 'invented', when: 'step', do: body(['@set steps += 1']) });
  await step(world, 1, 0);
  assert.equal(world.save.vars.steps, 1);
  assert.ok(RU.all(world.project, world.save).some(r => r.id === 'invented'));
  RU.eat(world.save, 'invented');
  await step(world, 1, 0);
  assert.equal(world.save.vars.steps, 1, 'and it can be eaten like any other');
});

// ---- what happens when it goes wrong ---------------------------------------

test('rules: one broken rule does not stop the rules after it', async () => {
  const world = makeWorld(makeProject({
    'a-bad': { when: 'step', do: [{ t: 'raw', line: '@nonsense' }] },
    'b-good': { when: 'step', do: body(['@set steps += 1']) },
  }));
  await world.enterMap('home', 2, 2, 'down');
  const quiet = hush('error');
  try { await step(world, 1, 0); } finally { quiet(); }
  assert.equal(world.save.vars.steps, 1, 'the good rule still ran');
});

test('rules: a rule that sets off itself is capped, and says where', async () => {
  // DEFAULT: rules that trigger rules is the point; a hang with nothing in the
  // console is not. The chain is cut and the loop is written into the history.
  // Writing something down is an event, and this rule answers it by writing
  // something down. Nothing here is contrived: it is two ordinary pieces used in
  // the obvious wrong order, which is how real loops get written.
  const world = makeWorld(makeProject({
    ouroboros: { when: 'logged', do: body(['@did noticed']) },
  }));
  await world.enterMap('home', 2, 2, 'down');
  const quiet = hush('warn');
  try { KIT.history.add(world.save, 'started', {}); await world.rulesSettled(); } finally { quiet(); }
  assert.equal(world.rulesPending(), 0, 'the queue was emptied rather than left spinning');
  assert.ok(KIT.history.has(world.save, { verb: 'rule:loop' }), 'and the loop is on the record');
});

// ---- rules meet the rest of the engine --------------------------------------

test('rules × saves: what a run did to its rules is in its save, and only there', async () => {
  const world = makeWorld(makeProject({ gravity: { when: 'step' }, tax: { when: 'step' } }));
  await world.enterMap('home', 2, 2, 'down');
  RU.eat(world.save, 'gravity');
  RU.deactivate(world.save, 'tax');
  const reloaded = JSON.parse(JSON.stringify(world.save));
  assert.equal(RU.live(world.project, reloaded, 'gravity'), false, 'eaten survives the save file');
  assert.equal(RU.live(world.project, reloaded, 'tax'), false, 'and so does switched off');
  const freshRun = {};
  assert.equal(RU.live(world.project, freshRun, 'gravity'), true, 'a new game gets the world back');
});

test('rules × layers: a rule can belong to one layer of reality', async () => {
  const world = makeWorld(makeProject({
    dreamlogic: { when: 'step', scope: { layers: ['dream'] }, do: body(['@set mood += 1']) },
  }));
  await world.enterMap('home', 2, 2, 'down');
  await step(world, 1, 0);
  assert.equal(world.save.vars.mood, 0, 'awake, it does not apply');
  world.save.dimension = 'dream';
  await step(world, 1, 0);
  assert.equal(world.save.vars.mood, 1, 'asleep, it does');
});

test('rules × speech: a rule that talks locks input while it talks, and not after', async () => {
  const world = makeWorld(makeProject({
    greeter: { when: 'step', do: body(['Narrator: Something watches.']) },
  }));
  await world.enterMap('home', 2, 2, 'down');
  await step(world, 1, 0);
  assert.deepEqual(world.said(), ['Something watches.']);
  assert.equal(world.busy, false, 'and the world is walkable again afterwards');
});

test('rules × history: a rule can listen for a thing that was written down', async () => {
  // `logged` is an event like any other, which is what makes "the third time you
  // do X" authorable without a counter variable.
  const world = makeWorld(makeProject({
    thrice: { when: 'logged', if: { kind: 'did', verb: 'ate', what: 'bread', op: '>=', times: 3 }, do: body(['@set mood += 1']) },
  }));
  await world.enterMap('home', 2, 2, 'down');
  for (let i = 0; i < 3; i++) { KIT.history.add(world.save, 'ate', { what: 'bread' }); await world.rulesSettled(); }
  assert.equal(world.save.vars.mood, 1, 'it fired on the third loaf and not before');
});

test('rules × sessions: a rule can hang off coming back after a while', async () => {
  // The plan's LOOM pitch — "NPCs keep living between sessions" — needed module
  // code in every game that wanted it: listen for `sessionResumed`, work out
  // what to pay, pay it. With rules as entities it is a row an author writes,
  // and the clock was already measuring the gap. This test is the claim.
  const project = makeProject({
    'the-garden-grew': {
      when: 'sessionResumed',
      if: { kind: 'var', name: 'mood', op: '>=', value: 0 },
      do: body(['@set steps += 1', '@did returned what=after-a-while']),
    },
  });
  const world = makeWorld(project);
  await world.enterMap('home', 2, 2, 'down');
  // Away for two hours, as far as the save is concerned.
  world.save.clock = { day: 1, minutes: 480, lastSeenAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString() };
  const payload = KIT.clock.resume(world);
  await world.rulesSettled();
  assert.ok(payload && payload.elapsedMs > 0, 'the engine noticed the gap');
  assert.equal(world.save.vars.steps, 1, 'and the rule ran, with no module and no code');
  assert.equal(KIT.history.has(world.save, { verb: 'returned', what: 'after-a-while' }), true,
    'and wrote it down, so a line can open with it');
});

test('rules: two events in one frame do not start two conversations at once', async () => {
  const world = makeWorld(makeProject({
    slow: { when: 'step', do: body(['Narrator: one', 'Narrator: two']) },
  }));
  await world.enterMap('home', 2, 2, 'down');
  world.events.emit('step', { hero: 'p1' });
  world.events.emit('step', { hero: 'p1' });
  await world.rulesSettled();
  assert.deepEqual(world.said(), ['one', 'two', 'one', 'two'], 'in order, one firing after the other');
});
