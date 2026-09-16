// KIT.modules: the engine's module system.
//
// A module declares its slice of the save and its slice of the project once, in
// its manifest, and the engine fills, migrates, repairs and validates it. These
// tests use throwaway modules rather than the real ones, so what is checked here
// is the engine's promise and not one module's habits.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('./_load.js');
require(path.join(__dirname, '..', '..', 'js/kit/world/map.js'));
require(path.join(__dirname, '..', '..', 'js/kit/world/entities.js'));
require(path.join(__dirname, '..', '..', 'js/kit/world/world.js'));

/**
 * Declare some modules and switch them on, and take them away again afterwards
 * — declaration and all, so the next test starts from the same nothing.
 */
function withModules(defs, fn) {
  for (const d of defs) KIT.module(d);
  KIT.modules.activate({ modules: defs.map(d => d.id) });
  try { return fn(); }
  finally { for (const d of defs) KIT.modules.forget(d.id); }
}

test('modules: this file starts with none', () => {
  assert.deepEqual(KIT.modules.all(), []);
});

const weatherDef = () => ({
  id: 'weather', version: 1, requires: [],
  register() { /* nothing to register for these tests */ },
  save: {
    key: 'weather',
    defaults: () => ({ version: 2, sky: 'clear', rainedFor: 0, seen: [] }),
    migrate: [{ from: 1, to: 2, up: (d) => ({ version: 2, sky: d.weather || 'clear', rainedFor: 0, seen: [] }) }],
    repair: (d) => { if (!Array.isArray(d.seen)) d.seen = []; return d; },
  },
  content: {
    key: 'weather',
    at: 'tuning',
    defaults: () => ({ tuning: {}, indoorMaps: [] }),
    fields: [
      { key: 'chanceOfRain', type: 'number', min: 0, max: 1, default: 0.3 },
      { key: 'minutesPerFront', type: 'number', integer: true, min: 1, default: 45 },
    ],
  },
});

test('modules: the save slice is created, filled, migrated and repaired', () => {
  withModules([weatherDef()], () => {
    // a save that has never heard of this module
    const fresh = { modules: {} };
    const s = KIT.modules.saveSection(fresh, 'weather');
    assert.deepEqual(s, { version: 2, sky: 'clear', rainedFor: 0, seen: [] });
    assert.equal(fresh.modules.weather, s, 'written back into the save');
    assert.equal(KIT.modules.saveSection(fresh, 'weather'), s, 'and reading again gives the same object');

    // an old save goes up the migration chain
    const old = { modules: { weather: { version: 1, weather: 'storm' } } };
    assert.deepEqual(KIT.modules.saveSection(old, 'weather'), { version: 2, sky: 'storm', rainedFor: 0, seen: [] });

    // a save from before a field existed gets its default, and keeps the rest
    const partial = { modules: { weather: { version: 2, sky: 'fog' } } };
    const p = KIT.modules.saveSection(partial, 'weather');
    assert.equal(p.sky, 'fog', 'what was there is kept');
    assert.equal(p.rainedFor, 0, 'what is new gets its default');

    // and a mangled one is repaired rather than believed
    const bad = { modules: { weather: { version: 2, sky: 'clear', rainedFor: 0, seen: 'nonsense' } } };
    assert.deepEqual(KIT.modules.saveSection(bad, 'weather').seen, []);
    assert.deepEqual(KIT.modules.saveSection({ modules: { weather: 'rubbish' } }, 'weather').sky, 'clear');
  });
});

test('modules: defaults are copied, never shared between saves', () => {
  withModules([weatherDef()], () => {
    const a = KIT.modules.saveSection({ modules: {} }, 'weather');
    const b = KIT.modules.saveSection({ modules: {} }, 'weather');
    a.seen.push('rain');
    assert.deepEqual(b.seen, [], 'one save’s weather is not another save’s');
  });
});

test('modules: a world fills every switched-on module’s save slice', () => {
  withModules([weatherDef()], () => {
    const project = KIT.project.normalize(KIT.project.blank()).project;
    const save = { vars: {}, objects: {}, overlays: {}, modules: {}, heroes: [], seed: 1 };
    KIT.world.create({ project, save, ports: {} });
    assert.ok(save.modules.weather, 'the module did not have to ask');
    assert.equal(save.modules.weather.sky, 'clear');
  });
});

test('modules: normalize fills the content slice and validate checks it', () => {
  withModules([weatherDef()], () => {
    const { project, problems } = KIT.project.normalize(KIT.project.blank());
    assert.deepEqual(project.packs.weather.tuning, { chanceOfRain: 0.3, minutesPerFront: 45 },
      'an author who never opened that panel still has the numbers');
    assert.deepEqual(project.packs.weather.indoorMaps, []);
    assert.deepEqual(problems.filter(p => p.code === 'module-content'), [], 'and nothing to complain about');

    // what the author did set is kept, and what they set wrongly is reported
    const edited = KIT.project.blank();
    edited.packs = { weather: { tuning: { chanceOfRain: 0.9 } } };
    const two = KIT.project.normalize(edited);
    assert.equal(two.project.packs.weather.tuning.chanceOfRain, 0.9);
    assert.equal(two.project.packs.weather.tuning.minutesPerFront, 45);

    const wrong = KIT.project.blank();
    wrong.packs = { weather: { tuning: { chanceOfRain: 7 } } };
    const bad = KIT.project.normalize(wrong).problems.filter(p => p.code === 'module-content');
    assert.equal(bad.length, 1, JSON.stringify(bad));
    assert.match(bad[0].message, /weather: chanceOfRain/);
    assert.deepEqual(bad[0].where.path, ['packs', 'weather', 'tuning', 'chanceOfRain']);
  });
});

test('modules: a module that declares nothing costs nothing', () => {
  withModules([{ id: 'quiet', version: 1, requires: [], register() {} }], () => {
    assert.equal(KIT.modules.saveSection({ modules: {} }, 'quiet'), null);
    assert.equal(KIT.modules.pack({}, 'quiet'), null);
    const { project, problems } = KIT.project.normalize(KIT.project.blank());
    assert.deepEqual(project.packs, {});
    assert.deepEqual(problems.filter(p => p.code === 'module-content'), []);
  });
});

test('modules: the dependency sort, and what it says when it cannot', () => {
  withModules([
    { id: 'base', version: 1, requires: [], register() {} },
    { id: 'middle', version: 1, requires: ['base'], register() {} },
    { id: 'top', version: 1, requires: ['middle', 'base'], register() {} },
  ], () => {
    const { order, missing, cycles } = KIT.modules.order(['top', 'middle', 'base']);
    assert.deepEqual(order.map(d => d.id), ['base', 'middle', 'top']);
    assert.deepEqual(missing, []);
    assert.deepEqual(cycles, []);

    // asking for `top` alone reports what it needs rather than silently working
    const alone = KIT.modules.order(['top']);
    assert.deepEqual(alone.missing, [{ module: 'top', requires: 'middle' }, { module: 'top', requires: 'base' }]);
  });
});

test('modules: a module whose register throws does not take the game down', () => {
  const before = (KIT.log || console).error;
  const said = [];
  const banner = KIT.banner;
  KIT.banner = (text) => said.push(text);
  (KIT.log || console).error = () => {};
  try {
    withModules([
      { id: 'broken', version: 1, requires: [], register() { throw new Error('no'); } },
      { id: 'fine', version: 1, requires: [], register() {} },
    ], () => {
      assert.ok(KIT.modules.has('fine'), 'the other one still started');
      assert.ok(!KIT.modules.has('broken'));
      assert.ok(said.some(t => /broken/.test(t)), 'and it said so: ' + said.join(' / '));
    });
  } finally { (KIT.log || console).error = before; KIT.banner = banner; }
});
