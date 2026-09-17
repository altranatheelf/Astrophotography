'use strict';
// THE BUS THAT WASN'T THERE.
//
// `KIT.events(name)` MAKES a bus. `KIT.bus` IS the shared one. Six call sites
// across this repo were written `KIT.events('kit').emit(...)`, which builds a
// brand-new bus with no listeners on it, emits into it, and drops it on the
// floor. Faults, language changes, editor problems, every line of history and
// every rule that got eaten: all of them announced themselves to nobody, and
// nothing anywhere said so, because emitting into an empty bus is legal and
// returns 0.
//
// That is the same failure this repo keeps finding — a thing that exists and
// cannot be reached — so it gets the same answer: a test that fails.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const KIT = require('./_load.js');
require(path.join(__dirname, '..', '..', 'js/kit/world/map.js'));
require(path.join(__dirname, '..', '..', 'js/kit/world/entities.js'));
require(path.join(__dirname, '..', '..', 'js/kit/world/world.js'));

const ROOT = path.join(__dirname, '..', '..');
/** Prose about the mistake is not the mistake, so comments are taken out first. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('events: a fresh bus every call is the trap, so the global one has a name', () => {
  const a = KIT.events('same-name');
  const b = KIT.events('same-name');
  assert.notEqual(a, b, 'two calls give two buses — that is the point of the function');
  let heard = 0;
  a.on('x', () => heard++);
  b.emit('x');
  assert.equal(heard, 0, 'and they do not hear each other');
  assert.equal(KIT.bus, KIT.bus, 'while KIT.bus is one object');
});

test('events: nothing in the engine emits into a bus it just made', () => {
  const guilty = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) { if (f.name !== 'node_modules') walk(p); continue; }
      if (!f.name.endsWith('.js') && !f.name.endsWith('.html')) continue;
      const src = code(fs.readFileSync(p, 'utf8'));
      for (const m of src.matchAll(/KIT\.events\((['"`][^'"`]*['"`])\)\s*\.\s*(emit|on|once)\b/g)) {
        guilty.push(`${path.relative(ROOT, p)}: KIT.events(${m[1]}).${m[2]}`);
      }
    }
  };
  for (const d of ['js', 'tools', 'e2e', 'templates']) walk(path.join(ROOT, d));
  assert.deepEqual(guilty, [],
    'these build a bus, use it once and throw it away — they want KIT.bus (global) ' +
    `or KIT.worldBus(save) (an event of one run):\n  ${guilty.join('\n  ')}`);
});

test('events: worldBus tells a thing that happened in the live run from one that did not', () => {
  const mine = { vars: {} };
  const someoneElses = { vars: {} };
  const fake = { save: mine, events: KIT.events('pretend-world') };
  const realLive = KIT.world.live;
  KIT.world.live = fake;
  try {
    assert.equal(KIT.worldBus(mine), fake.events, "the live run's own save goes to the live run's bus");
    assert.equal(KIT.worldBus(someoneElses), KIT.bus, 'another save is not this world, so it goes global');
    assert.equal(KIT.worldBus(), fake.events, 'no save named means the live run');
  } finally { KIT.world.live = realLive; }
  KIT.world.live = null;
  try { assert.equal(KIT.worldBus(mine), KIT.bus, 'with nothing playing, it is the global bus and never nowhere'); }
  finally { KIT.world.live = realLive; }
});

test('events: a listener that throws does not silence the ones after it', () => {
  const bus = KIT.events('rowdy');
  const heard = [];
  const realError = console.error;
  console.error = () => {};
  try {
    bus.on('x', () => { throw new Error('nope'); });
    bus.on('x', () => heard.push('second'));
    assert.equal(bus.emit('x'), 1, 'one listener finished');
  } finally { console.error = realError; }
  assert.deepEqual(heard, ['second']);
});
