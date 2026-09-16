// The fight, simulated. The point of keeping rules.js pure is that a battle can
// be balanced without playing it — so these run a whole fight in a loop.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const KIT = require(path.join(ROOT, 'test/kit/_load.js'));
for (const f of ['map', 'entities', 'world']) require(path.join(ROOT, 'js/kit/world', f + '.js'));
require(path.join(ROOT, 'js/art/tiles.js'));
for (const f of ['rules', 'register', 'manifest']) require(path.join(ROOT, 'js/modules/bullet/' + f + '.js'));
const B = KIT.bullet;
KIT.modules.activate({ modules: ['bullet'] });

/** Play a whole fight with a scripted dodge, and say what happened. */
function play(f, pattern, steer, maxSteps) {
  let steps = 0;
  while (!B.patternDone(f, pattern) && !f.over && steps < (maxSteps || 3000)) {
    B.runPattern(f, pattern, 1 / 60);
    B.step(f, 1 / 60, steer(steps));
    steps++;
  }
  return steps;
}

test('bullet: the soul stays in the box, whatever you press', () => {
  const f = B.create({ x: 5, y: 5, w: 7, h: 5 });
  for (let i = 0; i < 400; i++) B.steer(f, { x: 1, y: 1 }, 1 / 60);
  assert.ok(f.soul.x <= 5 + 7 - f.soul.r + 1e-9, 'not out the right side: ' + f.soul.x);
  assert.ok(f.soul.y <= 5 + 5 - f.soul.r + 1e-9, 'not out the bottom: ' + f.soul.y);
  for (let i = 0; i < 400; i++) B.steer(f, { x: -1, y: -1 }, 1 / 60);
  assert.ok(f.soul.x >= 5 + f.soul.r - 1e-9);
  assert.ok(f.soul.y >= 5 + f.soul.r - 1e-9);

  // diagonal is not faster than straight — the classic bug
  const a = B.create({ x: 0, y: 0, w: 100, h: 100, speed: 6 });
  const b = B.create({ x: 0, y: 0, w: 100, h: 100, speed: 6 });
  for (let i = 0; i < 60; i++) { B.steer(a, { x: 1, y: 0 }, 1 / 60); B.steer(b, { x: 1, y: 1 }, 1 / 60); }
  const da = a.soul.x - 50, db = Math.hypot(b.soul.x - 50, b.soul.y - 50);
  assert.ok(Math.abs(da - db) < 0.01, `straight ${da.toFixed(2)} vs diagonal ${db.toFixed(2)}`);
});

test('bullet: a hit costs heart once, then you are briefly safe', () => {
  const f = B.create({ hp: 20 });
  f.soul.x = 8; f.soul.y = 7;
  B.spawn(f, { x: 8, y: 7, vx: 0, vy: 0, damage: 5, life: 99 });
  const first = B.step(f, 1 / 60, null);
  assert.equal(first.hit, 5);
  assert.equal(f.hp, 15);
  assert.ok(f.soul.invuln > 0, 'and a moment of grace');

  // sitting inside it does not drain you instantly
  for (let i = 0; i < 30; i++) B.step(f, 1 / 60, null);
  assert.equal(f.hp, 15, 'still 15 half a second later');
  for (let i = 0; i < 60; i++) B.step(f, 1 / 60, null);
  assert.equal(f.hp, 10, 'and exactly one more hit when the grace runs out');
});

test('bullet: grazing counts once per bullet, and is not a hit', () => {
  const f = B.create({ hp: 20 });
  f.soul.x = 8; f.soul.y = 7;
  B.spawn(f, { x: 8.55, y: 7, vx: 0, vy: 0, r: 0.15, damage: 5, life: 99 });
  let grazes = 0;
  for (let i = 0; i < 120; i++) grazes += B.step(f, 1 / 60, null).grazed;
  assert.equal(grazes, 1, 'once, not every frame');
  assert.equal(f.grazed, 1);
  assert.equal(f.hp, 20, 'and it never touched us');
});

test('bullet: a pattern fires on time and finishes', () => {
  const f = B.create({ hp: 999 });
  const p = B.pattern([
    { at: 0, spawn: { x: 1, y: 1, vy: 1, life: 0.5 } },
    { at: 0.5, spawn: [{ x: 2, y: 1, vy: 1, life: 0.5 }, { x: 3, y: 1, vy: 1, life: 0.5 }] },
    { at: 1.0, spawn: { x: 4, y: 1, vy: 1, life: 0.5 } },
  ])
  assert.equal(B.runPattern(f, p, 0.01), 1, 'the first one is immediate');
  assert.equal(B.runPattern(f, p, 0.4), 0, 'nothing due yet');
  assert.equal(B.runPattern(f, p, 0.2), 2, 'a volley of two');
  assert.equal(B.patternDone(f, p), false, 'one still to come');
  B.runPattern(f, p, 0.5);
  assert.equal(p.fired, 3, 'everything fired');
  assert.equal(B.patternDone(f, p), false, 'but the bullets are still on screen');
  for (let i = 0; i < 120; i++) B.step(f, 1 / 60, null);
  assert.equal(B.patternDone(f, p), true, 'and now it is over');
});

test('bullet: every mover moves, and homing homes', () => {
  for (const kind of Object.keys(B.movers)) {
    const f = B.create({ hp: 999 });
    const b = B.spawn(f, { x: 8, y: 2, vx: 1, vy: 1, move: kind, life: 99, data: { radius: 2 } });
    const was = { x: b.x, y: b.y };
    for (let i = 0; i < 60; i++) B.step(f, 1 / 60, null);
    assert.notDeepEqual({ x: b.x, y: b.y }, was, kind + ' went nowhere');
  }
  // a homing bullet ends up closer than it started
  const f = B.create({ hp: 999 });
  f.soul.x = 10; f.soul.y = 8;
  const b = B.spawn(f, { x: 2, y: 2, vx: 0, vy: 0, move: 'homing', life: 99, data: { turn: 3, speed: 4 } });
  const before = Math.hypot(b.x - f.soul.x, b.y - f.soul.y);
  for (let i = 0; i < 30; i++) B.step(f, 1 / 60, null);
  assert.ok(Math.hypot(b.x - f.soul.x, b.y - f.soul.y) < before, 'it came for us');
});

test('bullet: a whole fight can be played without a browser', () => {
  // standing still in the rain is survivable; that is the point of the pattern
  const easy = B.create({ hp: 20 });
  const steps = play(easy, B.PATTERNS.rain(easy, 18), () => ({ x: 1, y: 0 }));
  assert.ok(steps > 200 && steps < 3000, 'it ran to the end: ' + steps);
  assert.equal(easy.over, null, 'and was survivable');

  // standing perfectly still in a homing pattern is not
  const doomed = B.create({ hp: 6 });
  play(doomed, B.PATTERNS.hunt(doomed, 8), () => ({ x: 0, y: 0 }));
  assert.equal(doomed.over, 'lost', 'you cannot stand still against those');
  assert.equal(doomed.hp, 0);
});

test('bullet: the command round-trips through Screenplay, like every other command', () => {
  const def = KIT.registry('commands').get('fight');
  assert.ok(def, 'the module registered it');
  for (const line of ['@fight rain 24', '@fight hunt 6', '@fight ring 12']) {
    const cmd = def.text.fromLine(line);
    assert.ok(cmd, line);
    assert.equal(def.text.toLine(cmd), line);
  }
});

test('bullet: the manifest declares its slices and the engine fills them', () => {
  const project = KIT.project.normalize({
    version: 3, meta: { id: 'bullet-test' }, modules: ['bullet'], maps: { a: {} },
  }).project;
  assert.equal(project.packs.bullet.soulColor, '#ff2d55', 'content filled');
  const save = { vars: {}, objects: {}, overlays: {}, modules: {}, heroes: [], seed: 1 };
  KIT.world.create({ project, save, ports: {} });
  assert.equal(save.modules.bullet.fights, 0, 'save filled, without the module asking');
});
