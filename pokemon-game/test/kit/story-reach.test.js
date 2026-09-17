'use strict';
// CAN A STORY SAY IT, AND CAN A STORY ASK IT?
//
// `test/kit/reachable.test.js` asks whether a PLAYER can reach a feature, and
// whether an AUTHOR can edit a table. This is the third face of the same
// question, and it caught a real gap the other two could not see.
//
// `KIT.history.promote` — the one function that carries a fact across New Game,
// the whole of "you have been here before" — was called by nothing. Not a
// command, not a condition, not a screen. It had a doc comment quoting
// Undertale's True Reset, a unit test, and no way for a story to use it. That is
// the engine's headline feature half-built for a week, with a green suite.
//
// So: every function the story layer exports is classified here, and the
// classification has to be COMPLETE. A new one is a test failure until somebody
// says which of these it is — which is the uncomfortable part, and the point.
//
//   SAID       a command reaches it. A story does this.
//   ASKED      a condition or a line tag reaches it. A story reads this.
//   SHOWN      a screen uses it. A player sees this.
//   PLUMBING   the engine's own. Nobody authors it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const KIT = require('./_load.js');

const ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, 'js/kit/core/storage.js'));   // `@remember … ever` writes to the meta record
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/** Where a story is written: the commands, the conditions, and the line tags. */
const SAYS = read('js/kit/script/commands.js');
const ASKS = read('js/kit/script/conditions.js') + read('js/kit/script/text.js');
/** Where a player looks. */
const SCREENS = read('js/kit/scenes/menu.js') + read('js/kit/game.js') + read('js/kit/editor/panels-project.js');

const CLASS = {
  history: {
    add: ['SAID', '@did'],
    count: ['ASKED', 'the `did` condition and {did:…}'],
    has: ['PLUMBING', 'the `did` condition reads count(); has() is the convenience the engine and modules use'],
    everDid: ['ASKED', 'the `ever` condition and {ever:…}'],
    promote: ['SAID', '@remember <key> ever — THE ONE THAT WAS MISSING'],
    of: ['PLUMBING', 'the save section, created on demand'],
    exact: ['PLUMBING', 'tells a tool whether a question is answered for all time'],
    last: ['PLUMBING', 'for a module or a debug panel; no condition needs it yet'],
    all: ['PLUMBING', 'same'],
    since: ['PLUMBING', 'same'],
    seq: ['PLUMBING', 'ordering, used by the tree'],
  },
  rules: {
    eat: ['SAID', '@rule eat'],
    activate: ['SAID', '@rule on'],
    deactivate: ['SAID', '@rule off'],
    live: ['ASKED', 'the `rule` condition'],
    define: ['PLUMBING', 'a rule invented at runtime, from a module; no command yet on purpose — ADR-0012'],
    rewrite: ['PLUMBING', 'same: a module verb until an authored case turns up'],
    state: ['PLUMBING', 'the save section'],
    all: ['PLUMBING', 'enumeration'],
    get: ['PLUMBING', 'enumeration'],
    inScope: ['PLUMBING', 'matching'],
    matching: ['PLUMBING', 'pure, so the editor can show the firing order'],
    fire: ['PLUMBING', 'the world calls it on every event'],
    depthNow: ['PLUMBING', 'for a debug panel'],
  },
  timeline: {
    record: ['SAID', '@moment, and every save the game makes'],
    keep: ['SAID', '@moment names a moment and keeps it'],
    elsewhere: ['ASKED', 'the `elsewhere` condition and {elsewhere:…}'],
    everywhere: ['ASKED', 'the `everywhere` condition and {everywhere:…}'],
    moments: ['SHOWN', 'the Moments row in the pause menu'],
    goto: ['SHOWN', 'picking a row: KIT.game.gotoMoment'],
    headTo: ['SHOWN', 'loading a save stands at its moment'],
    count: ['SHOWN', 'the Moments row only appears when there is somewhere to go'],
    forgetAll: ['PLUMBING', 'a tool and a test; a player-facing "forget everything" is not offered'],
    label: ['PLUMBING', 'named by @moment through record(); rename is not offered yet'],
    diff: ['PLUMBING', 'the delta'],
    patch: ['PLUMBING', 'the delta'],
    apply: ['PLUMBING', 'the delta'],
    rebuild: ['PLUMBING', 'the delta'],
    tallyAt: ['PLUMBING', 'the ledger behind elsewhere()'],
    path: ['PLUMBING', 'the tree'],
    children: ['PLUMBING', 'the tree'],
    node: ['PLUMBING', 'the tree'],
    head: ['PLUMBING', 'the tree'],
    key: ['PLUMBING', 'storage'],
    load: ['PLUMBING', 'storage, at boot'],
    flush: ['PLUMBING', 'storage, on save'],
    now: ['PLUMBING', 'storage'],
    repair: ['PLUMBING', 'storage, on the way in'],
    bytes: ['PLUMBING', 'the budget'],
    size: ['PLUMBING', 'the budget'],
    prune: ['PLUMBING', 'the budget'],
  },
};

test('story layer: every function is classified, and nothing is left unsaid', () => {
  const missing = [];
  for (const ns of Object.keys(CLASS)) {
    for (const k of Object.keys(KIT[ns])) {
      if (typeof KIT[ns][k] !== 'function' || k.startsWith('_')) continue;
      if (!CLASS[ns][k]) missing.push(`KIT.${ns}.${k}`);
    }
  }
  assert.deepEqual(missing, [],
    `these are new and nobody has said whether a story can use them: ${missing.join(', ')}.\n` +
    'Add each to CLASS in this file as SAID / ASKED / SHOWN / PLUMBING, with what reaches it.');
});

test('story layer: nothing is classified that no longer exists', () => {
  const ghosts = [];
  for (const ns of Object.keys(CLASS)) {
    for (const k of Object.keys(CLASS[ns])) if (typeof (KIT[ns] || {})[k] !== 'function') ghosts.push(`KIT.${ns}.${k}`);
  }
  assert.deepEqual(ghosts, [], `classified but gone: ${ghosts.join(', ')}`);
});

test('story layer: a thing a story SAYS is really called by a command', () => {
  // The exact failure: `promote` was documented as the way to carry a fact
  // across New Game and no command called it. Grep, because the alternative is
  // running the whole command registry against a fake world to find out whether
  // any of them touch one function — and this is the check that would have
  // failed a week earlier.
  const unreachable = [];
  for (const ns of Object.keys(CLASS)) {
    for (const [k, [kind, how]] of Object.entries(CLASS[ns])) {
      if (kind !== 'SAID') continue;
      if (!SAYS.includes(`KIT.${ns}.${k}(`)) unreachable.push(`KIT.${ns}.${k} (said to be reached by ${how})`);
    }
  }
  assert.deepEqual(unreachable, [],
    `no command in js/kit/script/commands.js calls these:\n  ${unreachable.join('\n  ')}`);
});

test('story layer: a thing a story ASKS is really read by a condition or a line', () => {
  const unreachable = [];
  for (const ns of Object.keys(CLASS)) {
    for (const [k, [kind, how]] of Object.entries(CLASS[ns])) {
      if (kind !== 'ASKED') continue;
      if (!ASKS.includes(`KIT.${ns}.${k}(`)) unreachable.push(`KIT.${ns}.${k} (said to be reached by ${how})`);
    }
  }
  assert.deepEqual(unreachable, [],
    `nothing in conditions.js or text.js reads these:\n  ${unreachable.join('\n  ')}`);
});

test('story layer: a thing a player is SHOWN is really used by a screen', () => {
  const unreachable = [];
  for (const ns of Object.keys(CLASS)) {
    for (const [k, [kind, how]] of Object.entries(CLASS[ns])) {
      if (kind !== 'SHOWN') continue;
      if (!SCREENS.includes(`KIT.${ns}.${k}(`)) unreachable.push(`KIT.${ns}.${k} (said to be reached by ${how})`);
    }
  }
  assert.deepEqual(unreachable, [],
    `no screen uses these:\n  ${unreachable.join('\n  ')}`);
});

test('story layer: the five things a run can be asked about all round-trip in text', () => {
  // One family, one shape, four horizons: this run, every run, the branch beside
  // this one, and the best any branch managed. An author learns the prefix once.
  const C = KIT.conditions;
  for (const line of [
    'did.ate/bread >= 2',
    'ever.ate/bread >= 1',
    'elsewhere.killed/dog >= 1',
    'everywhere.ate/bread >= 7',
    'rule.doors-need-keys',
  ]) {
    const c = C.parseText(line);
    assert.ok(c && c.kind, `${line} parses`);
    assert.equal(C.toText(c), line, `${line} round-trips`);
    assert.ok(C.describe(c).length > 3, `${line} reads as English: ${C.describe(c)}`);
  }
});

test('story layer: and a story can carry one of them across New Game', async () => {
  // End to end through the real command and the real interpreter.
  const meta = {};
  const realMeta = KIT.storage.meta, realSave = KIT.storage.saveMeta;
  KIT.storage.meta = () => meta;
  KIT.storage.saveMeta = (patch) => { Object.assign(meta, patch); return true; };
  try {
    const ctx = KIT.interpreter.fakeCtx({});
    const save = ctx.world.save;
    KIT.history.add(save, 'ate', { what: 'bread' });
    KIT.history.add(save, 'ate', { what: 'bread' });
    const cmds = KIT.screenplay.parse('@remember ate/bread ever').commands;
    assert.equal(cmds.length, 1);
    assert.equal(cmds[0].op, 'ever', 'the line parsed as the carry-over op');
    await KIT.interpreter.run(cmds, ctx);
    assert.equal(KIT.history.everDid('ate', 'bread'), 2, 'both loaves survived the reset');
    const fresh = { world: { save: {} } };                 // a brand new run
    assert.equal(KIT.conditions.test(KIT.conditions.parseText('did.ate/bread >= 1'), fresh), false,
      'this run has eaten nothing');
    assert.equal(KIT.conditions.test(KIT.conditions.parseText('ever.ate/bread >= 2'), fresh), true,
      'and the game still knows they have');

    // And carrying over something that never happened records nothing, rather
    // than recording it as having happened once.
    const empty = KIT.interpreter.fakeCtx({});
    await KIT.interpreter.run(KIT.screenplay.parse('@remember never/at-all ever').commands, empty);
    assert.equal(KIT.history.everDid('never', 'at-all'), 0, 'nothing to carry is not a one');
  } finally { KIT.storage.meta = realMeta; KIT.storage.saveMeta = realSave; }
});
