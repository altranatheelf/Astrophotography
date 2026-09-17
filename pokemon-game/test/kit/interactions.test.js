'use strict';
// THE INTERACTION MATRIX.
//
// Each feature in this engine was built and tested on its own. Almost none of
// them were ever tested TOGETHER, and a game is nothing but the together part:
// you save inside a layer, an NPC remembers something from a previous run in a
// language you have since switched, a module's slice migrates under a save that
// was taken before the module existed.
//
// Every test here states a DEFAULT in its name and then verifies it. That
// wording is deliberate — a default is a decision, and a decision that is only
// in somebody's head is not a decision. Where the engine had no answer, the
// answer was chosen here first and the code made to match.
//
// The pairs are the ones that are load-bearing and plausible. Pairs that cannot
// interact (language × collision) are not here; a matrix nobody reads because it
// is exhaustive is worse than a short one that is true.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('./_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));
R('js/kit/core/storage.js'); R('js/kit/world/map.js'); R('js/kit/world/entities.js');
R('js/kit/world/cast.js'); R('js/kit/world/world.js'); R('js/kit/systems/index.js');
R('js/kit/scenes/stack.js');

const tiles = KIT.registry('tiles');
if (!tiles.has('grass')) tiles.add({ id: 'grass', group: 'nature' });
if (!tiles.has('stone')) tiles.add({ id: 'stone', group: 'nature' });

/** A project with two places, one of which has a second layer. */
function world(extra) {
  const n = 8 * 8;
  const plain = (fill) => ({
    terrain: new Array(n).fill(0), ground: new Array(n).fill(fill),
    deco: new Array(n).fill(null), above: new Array(n).fill(null), regions: new Array(n).fill(0),
  });
  const { project } = KIT.project.normalize(Object.assign({
    meta: { id: 'x', title: 'Two Places' },
    settings: { language: 'en' },
    start: { map: 'pier', x: 1, y: 1, dir: 'down' },
    cast: { mira: { name: 'Mira', pronouns: 'she/her' } },
    maps: {
      pier: {
        name: 'The Pier', width: 8, height: 8, layers: plain('grass'),
        collision: new Array(n).fill(null), objects: [],
        // The same place, otherwise. A layer overrides CELLS, not whole arrays —
        // so an author changes the three tiles that differ, not the map.
        dimensions: { hollow: { name: 'Hollow', tiles: { '0,0': { ground: 'stone' }, '1,1': { ground: 'stone' } } } },
      },
      diner: {
        name: 'The Diner', width: 8, height: 8, layers: plain('grass'),
        collision: new Array(n).fill(null), objects: [],
      },
    },
  }, extra || {}));
  return project;
}

/** A save, built the way the runtime builds one. */
function save(project, over) {
  const vars = {};
  for (const k of Object.keys(project.vars || {})) vars[k] = project.vars[k].default;
  return Object.assign({
    version: 2, projectId: 'x', savedAt: null, playtimeMs: 0,
    heroes: [{ id: 'p1', name: 'Ren', map: 'pier', x: 1, y: 1, dir: 'down' }],
    activeHero: 0, vars, inventory: {}, objects: {}, overlays: {}, modules: {},
    clock: { day: 1, minutes: 480, lastSeenAt: null },
    timer: { running: false, secondsLeft: 0 }, music: { current: null, saved: null },
    steps: 0, seed: 1,
  }, over || {});
}

// ---- LAYERS × PLACES -------------------------------------------------------

test('layers × places: a layer you are standing in does NOT follow you to a place that lacks it', () => {
  const p = world();
  const s = save(p, { dimension: 'hollow' });
  // The pier has a hollow. The diner does not.
  assert.equal(KIT.mapView(p, s, 'pier').tileAt('ground', 0, 0), 'stone', 'the pier shows its hollow');
  const diner = KIT.mapView(p, s, 'diner');
  assert.equal(diner.tileAt('ground', 0, 0), 'grass',
    'the diner has no hollow, so it shows itself — not an error, and not a blank room');
  assert.equal(diner.dimension, 'hollow',
    'and it still SAYS which layer you are in, so a script can ask and a door can care');
});

test('layers × places: the layer is remembered while you are away from it', () => {
  const p = world();
  const s = save(p, { dimension: 'hollow' });
  KIT.mapView(p, s, 'diner');                       // walk out of the layered place
  assert.equal(s.dimension, 'hollow', 'walking through an unlayered room does not clear it');
  assert.equal(KIT.mapView(p, s, 'pier').tileAt('ground', 0, 0), 'stone', 'and coming back, it is still there');
});

// ---- LAYERS × SAVES --------------------------------------------------------

test('layers × saves: the layer is part of the save, so loading puts you back in it', () => {
  const p = world();
  const s = save(p, { dimension: 'hollow' });
  const copy = JSON.parse(JSON.stringify(s));       // what a save/load round trip does
  assert.equal(copy.dimension, 'hollow', 'it survives being written and read');
  assert.equal(KIT.mapView(p, copy, 'pier').tileAt('ground', 0, 0), 'stone', 'and the world comes back changed');
});

test('layers × saves: a save from a layer that was later deleted opens in the ordinary world', () => {
  const p = world();
  const s = save(p, { dimension: 'hollow' });
  delete p.maps.pier.dimensions.hollow;             // the author cut it in year two
  const view = KIT.mapView(p, s, 'pier');
  assert.equal(view.tileAt('ground', 0, 0), 'grass', 'it falls back rather than throwing');
});

// ---- LAYERS × PEOPLE -------------------------------------------------------

test('layers × people: the LAYER decides who is in it, not the person', () => {
  const p = world();
  const p2 = world();
  p2.maps.pier.objects = [
    { id: 'always', name: 'Always', type: 'npc', x: 2, y: 2, pages: [{ on: {} }] },
    { id: 'ghost', name: 'Ghost', type: 'npc', x: 3, y: 3, pages: [{ on: {} }] },
  ];
  // A layer decides who is in it, per object, by name — not by a list on the
  // object. The layer is the thing that differs, so the layer holds the
  // difference; an object does not have to know every layer it might appear in.
  p2.maps.pier.dimensions.hollow.objects = { ghost: { hidden: false }, always: { hidden: true } };
  const here = KIT.mapView(p2, save(p2), 'pier');
  const there = KIT.mapView(p2, save(p2, { dimension: 'hollow' }), 'pier');
  assert.equal(here.isHidden(here.objects.find((o) => o.id === 'always')), false, 'ordinarily she is here');
  assert.equal(there.isHidden(there.objects.find((o) => o.id === 'always')), true, 'and in the hollow she is not');
  assert.equal(there.isHidden(there.objects.find((o) => o.id === 'ghost')), false, 'but the ghost is');
});

// ---- MEMORY × NEW GAME -----------------------------------------------------

test('memory × new game: what is remembered survives, what is saved does not', async () => {
  KIT.storage.forceAdapter = 'memory';
  await KIT.storage.ready();
  KIT.storage.projectId('x');
  await KIT.storage.saveMeta({ endingsSeen: ['quiet'], runs: 2 });
  const before = KIT.storage.meta();
  assert.deepEqual(before.endingsSeen, ['quiet']);
  // A new game builds a fresh save; it does not touch meta.
  const p = world();
  const fresh = save(p);
  assert.equal(fresh.vars.anything, undefined, 'the save starts empty');
  assert.deepEqual(KIT.storage.meta().endingsSeen, ['quiet'], 'and the memory is still there');
});

test('memory × language: a remembered value is shown as it was recorded, not translated', () => {
  const p = world();
  KIT.lang.put(p, 'fr', { name: 'Français', lines: { quiet: 'silencieux', Mira: 'Mireille' } });
  KIT.lang.bind(p, 'fr');
  try {
    const ctx = { meta: { lastEnding: 'quiet' }, project: p };
    // A meta value is DATA the game wrote, not a line an author typed. It comes
    // back exactly as recorded — translating it would make the ending you
    // reached depend on the language you are reading in.
    assert.equal(KIT.text.plain('{meta:lastEnding}', ctx), 'quiet');
    // A cast NAME is a line an author typed, so it does translate.
    assert.equal(KIT.text.plain('{who:mira}', ctx), 'Mireille');
  } finally { KIT.lang.bind(p, 'en'); }
});

// ---- MEMORY × PEOPLE -------------------------------------------------------

test('memory × people: what somebody knows is per-run; what the game remembers is per-player', () => {
  const p = world();
  const s = save(p);
  KIT.cast.tell(s, 'mira', 'the-door');
  assert.ok(KIT.cast.knows(s, 'mira', 'the-door'), 'she knows it this run');
  const nextRun = save(p);
  assert.equal(KIT.cast.knows(nextRun, 'mira', 'the-door'), null,
    'and not in the next run — knowledge lives in the save, on purpose. A person who should');
  // ...remember ACROSS runs is written to meta deliberately, which is the whole
  // difference between "she has met you" and "she has met you before".
});

test('people × the clock: knowing something records WHEN, so a line can say "yesterday"', () => {
  const p = world();
  const s = save(p, { clock: { day: 3, minutes: 600, lastSeenAt: null } });
  KIT.cast.tell(s, 'mira', 'the-door');
  const k = KIT.cast.knows(s, 'mira', 'the-door');
  assert.equal(k.at, (3 - 1) * 1440 + 600, 'stamped in in-game minutes since the first morning');
  assert.equal(k.from, null, 'and by nobody in particular unless told otherwise');
  KIT.cast.tell(s, 'mira', 'the-other-thing', { from: 'ren' });
  assert.equal(KIT.cast.knows(s, 'mira', 'the-other-thing').from, 'ren', 'or by somebody, when it matters');
});

test('people × people: telling somebody something they already know changes nothing', () => {
  const p = world();
  const s = save(p, { clock: { day: 1, minutes: 100, lastSeenAt: null } });
  assert.equal(KIT.cast.tell(s, 'mira', 'the-door'), true, 'the first time is news');
  const first = KIT.cast.knows(s, 'mira', 'the-door').at;
  s.clock.minutes = 900;
  assert.equal(KIT.cast.tell(s, 'mira', 'the-door'), false, 'the second time is not');
  assert.equal(KIT.cast.knows(s, 'mira', 'the-door').at, first,
    'and the time they LEARNED it is not overwritten by the time you said it again');
});

// ---- MODULES × SAVES -------------------------------------------------------

test('modules × saves: a save taken before a module existed gains its slice, filled', () => {
  const p = world();
  const s = save(p);
  assert.deepEqual(s.modules, {}, 'the save predates the module');
  KIT.module({
    id: 'test-later', version: 1, label: 'Later', requires: [], register() {},
    save: { key: 'later', defaults: () => ({ version: 1, seen: 0 }), migrate: [], repair: (d) => d },
  });
  KIT.modules.activate({ modules: ['test-later'] });
  KIT.modules.ensureSaves(s);
  assert.deepEqual(s.modules.later, { version: 1, seen: 0 },
    'and gets it at defaults rather than undefined');
});

test('modules × saves: a module that is switched OFF keeps its data rather than losing it', () => {
  const p = world();
  const s = save(p, { modules: { later: { version: 1, seen: 7 } } });
  KIT.modules.activate({ modules: [] });            // the author turned it off
  KIT.modules.ensureSaves(s);
  assert.equal(s.modules.later.seen, 7,
    'switching a module off must not delete the hours somebody spent in it');
});

// ---- SAVES × THE CLOCK -----------------------------------------------------

test('clock × saves: the gap since you last played is applied once, not once per load', () => {
  const p = world();
  const threeDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString();
  const s = save(p, { clock: { day: 1, minutes: 480, lastSeenAt: threeDaysAgo } });
  const first = KIT.clock.gap(s);
  assert.ok(first > 0, 'the first load sees the gap');
  KIT.clock.stamp(s);                               // the runtime stamps on load
  const second = KIT.clock.gap(s);
  assert.equal(second, 0, 'a second load of the same save sees nothing — the gap was spent');
});

test('clock × saves: a save with no stamp at all is not treated as infinitely old', () => {
  const p = world();
  const s = save(p);                                 // lastSeenAt: null
  assert.equal(KIT.clock.gap(s), 0,
    'a brand new game has not been away; it has never been here');
});

// ---- LANGUAGE × SAVES ------------------------------------------------------

test('language × saves: the language is a property of the device, not of the save', async () => {
  KIT.storage.forceAdapter = 'memory';
  await KIT.storage.ready();
  const p = world();
  KIT.lang.put(p, 'fr', { name: 'Français', lines: {} });
  await KIT.storage.saveSettings({ language: 'fr' });
  const s = save(p);
  assert.equal(s.language, undefined,
    'the save carries no language — loading somebody else\'s save must not change yours');
  assert.equal(KIT.storage.settings().language, 'fr', 'the device remembers it instead');
});

// ---- SCENES × THE WORLD ----------------------------------------------------

test('scenes × the world: a scene that owns the screen stops the world being drawn, not being', () => {
  const drawn = [];
  const fake = { save() {}, restore() {}, fillRect() {}, fillStyle: '' };
  KIT.scenes.clear();
  KIT.scenes.push({ id: 'over', opaque: true, background: '#000', draw() { drawn.push('scene'); } });
  assert.ok(KIT.scenes.opaqueTop(), 'the renderer can see that somebody owns the frame');
  KIT.scenes.draw(fake, { W: 10, H: 10 });
  assert.deepEqual(drawn, ['scene'], 'and the scene drew');
  KIT.scenes.clear();
  assert.equal(KIT.scenes.opaqueTop(), null, 'and the world is visible again when it leaves');
});

// ---- MODULES × MIGRATION ---------------------------------------------------

test('modules × migration: an old slice is carried forward by the module\'s own chain', () => {
  KIT.module({
    id: 'test-mig', version: 3, label: 'Migrating', requires: [], register() {},
    save: {
      key: 'mig',
      defaults: () => ({ version: 3, coins: 0, gems: 0 }),
      migrate: [
        { from: 1, to: 2, up: (d) => { d.gems = 0; d.version = 2; return d; } },
        { from: 2, to: 3, up: (d) => { d.coins = (d.coins || 0) * 10; d.version = 3; return d; } },
      ],
      repair: (d) => d,
    },
  });
  KIT.modules.activate({ modules: ['test-mig'] });
  const p = world();
  const s = save(p, { modules: { mig: { version: 1, coins: 4 } } });   // a save from a year ago
  KIT.modules.ensureSaves(s);
  assert.equal(s.modules.mig.version, 3, 'it arrives at the current version');
  assert.equal(s.modules.mig.coins, 40, 'through every step, in order — not just the last one');
  assert.equal(s.modules.mig.gems, 0, 'and the field added on the way exists');
});

test('modules × migration: a slice from the FUTURE is left alone rather than mangled', () => {
  const p = world();
  const s = save(p, { modules: { mig: { version: 99, coins: 1, fromTheFuture: true } } });
  KIT.modules.ensureSaves(s);
  assert.equal(s.modules.mig.fromTheFuture, true,
    'a save written by a newer build keeps its data — downgrading must not silently delete it');
});

// ---- LANGUAGE × MODULES ----------------------------------------------------

test('language × modules: a module\'s own words are extracted like everything else', () => {
  KIT.registry('strings').add({ id: 'test-mod-word', default: 'A thing only this module says.' });
  const p = world();
  const texts = KIT.lang.extract(p).map((f) => f.text);
  assert.ok(texts.includes('A thing only this module says.'),
    'a module that registers a Term gets it into the translation file on the day it is written');
});

test('language × layers: a layer\'s name is a word a player can see, so it translates', () => {
  const p = world();
  const texts = KIT.lang.extract(p).map((f) => f.text);
  assert.ok(texts.includes('Hollow'),
    'the name of a layer of reality is authored prose, not an id — it belongs in the file');
});

// ---- FAULTS × EVERYTHING ---------------------------------------------------

test('faults × layers: a script that throws mid-shift does not leave you between layers', async () => {
  const p = world();
  p.maps.pier.dimensions.hollow.objects = {};
  const s = save(p);
  // The real world object, with a real shift, and an `enter` slot that throws.
  const w = KIT.world.create({
    project: p, save: s,
    ports: { io: {}, audio: { music() { return Promise.resolve(); } }, screen: {}, map: {}, game: {} },
  });
  await w.enterMap('pier', 1, 1, 'down');
  // Shift is two steps: commit the layer, then run whatever the author wrote.
  // If the second throws, the first must still hold — being in no layer at all
  // is not a state the renderer knows how to draw.
  const boom = () => { throw new Error('a content bug in an enter slot'); };
  const realRun = w.runSlot;
  w.runSlot = boom;
  let caught = null;
  try { await w.shift('hollow'); } catch (e) { caught = e; }
  w.runSlot = realRun;
  assert.equal(s.dimension, 'hollow',
    `the layer is committed before anything authored runs${caught ? '' : ''}`);
  assert.equal(KIT.mapView(p, s, 'pier').tileAt('ground', 0, 0), 'stone',
    'so the world is coherent whether or not the author\'s script survived');
});

// ---- HISTORY × EVERYTHING --------------------------------------------------

test('history × layers: an entry records which layer of reality you were in', () => {
  const p = world();
  const s = save(p, { dimension: 'hollow' });
  KIT.history.add(s, 'saw', { what: 'the-light' });
  assert.equal(KIT.history.last(s, 'saw').layer, 'hollow',
    'so a line can be about the time you saw it in the OTHER version of the room');
  assert.equal(KIT.history.count(s, { verb: 'saw', layer: null }), 0, 'and not confuse it with the ordinary one');
});

test('history × saves: the history is part of the run and travels with it', () => {
  const p = world();
  const s = save(p);
  KIT.history.add(s, 'ate', { what: 'bread' });
  const copy = JSON.parse(JSON.stringify(s));
  assert.equal(KIT.history.count(copy, { verb: 'ate', what: 'bread' }), 1, 'it survives the round trip');
  assert.equal(KIT.history.seq(copy), 1);
});

test('history × memory: a run is forgotten; what was promoted is not', async () => {
  KIT.storage.forceAdapter = 'memory';
  await KIT.storage.ready();
  KIT.storage.projectId('mx');
  const p = world();
  const s = save(p);
  KIT.history.add(s, 'left', { what: 'the-door-open' });
  KIT.history.promote(s, 'left', 'the-door-open');
  const nextRun = save(p);
  assert.equal(KIT.history.has(nextRun, 'left'), false, 'the new run has no history');
  assert.equal(KIT.history.everDid('left', 'the-door-open'), 1, 'and the player is still remembered');
});

test('history × the clock: an entry is stamped in in-game time, not wall-clock', () => {
  const p = world();
  const s = save(p, { clock: { day: 4, minutes: 90, lastSeenAt: null } });
  const e = KIT.history.add(s, 'woke');
  assert.equal(e.at, (4 - 1) * 1440 + 90);
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(JSON.stringify(e)),
    'wall-clock time is not the same number on two devices and says when somebody played');
});

test('history × language: a verb is an id and never translates', () => {
  const p = world();
  const s = save(p);
  KIT.history.add(s, 'ate', { what: 'bread' });
  KIT.lang.put(p, 'fr', { name: 'Français', lines: { ate: 'mangé', bread: 'pain' } });
  KIT.lang.bind(p, 'fr');
  try {
    assert.equal(KIT.history.has(s, { verb: 'ate', what: 'bread' }), true,
      'switching language must not lose your history — a verb is a key, not a line');
  } finally { KIT.lang.bind(p, 'en'); }
});
