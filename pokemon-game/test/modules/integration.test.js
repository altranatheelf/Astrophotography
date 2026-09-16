'use strict';
// Where the modules meet.
//
// mons and home overlap in four places — the clock, the friendship number, a
// friend's name and face, and how they are feeling. Neither module reaches into
// the other: everything here goes through the engine (the `commands` registry,
// the `sprites` registry, the world's event bus) or through a published
// provider hook. These tests are what stops that quietly rotting, and they run
// both modules together the way the demo does.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('../kit/_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));

R('js/kit/world/map.js'); R('js/kit/world/entities.js'); R('js/kit/world/world.js'); R('js/kit/systems/index.js');
global.PKMN = global.PKMN || {};
for (const f of ['js/art/tiles.js', 'js/art/chars.js', 'js/art/tiles-nature.js', 'js/art/tiles-town.js',
  'js/art/tiles-interior.js', 'js/art/chars-heroes.js', 'js/art/chars-placeholder.js']) R(f);

// Both modules, loaded and activated exactly as boot does.
const loaded = R('tools/load-modules.js').load(KIT, ['mons', 'home']);
const M = KIT.mons;
const H = KIT.home;

function project(extra) {
  return Object.assign({
    meta: { id: 'test' }, modules: ['mons', 'home'],
    heroes: [{ id: 'p1', name: 'Ash' }, { id: 'p2', name: 'Misty' }],
    items: { pokeball: { kind: 'ball', name: 'Poké Ball' }, berry: { kind: 'berry', name: 'Berry' } },
    vars: {}, scripts: {}, strings: {}, maps: {},
    packs: { mons: { difficulty: 'normal' }, home: {} },
  }, extra || {});
}
function blankSave() {
  return { vars: {}, inventory: {}, objects: {}, heroes: [{}, {}], modules: {}, overlays: {},
    clock: { day: 1, minutes: 480, lastSeenAt: null } };
}
function world(p, save) {
  return KIT.world.create({ project: p, save, rng: KIT.rng(7), ports: {} });
}

test('integration: both modules load together, in dependency order', () => {
  assert.deepEqual(loaded.map(d => d.id), ['mons', 'home']);
  assert.ok(KIT.modules.has('mons') && KIT.modules.has('home'));
});

test('integration: one clock — the engine clock wins, and home only drives it when nothing else does', () => {
  const save = blankSave();
  // The kit's own clock system is off by default (settings.clock.enabled), so
  // home drives it; with the engine clock on, home keeps its hands off.
  const off = project();
  const on = project({ settings: { clock: { enabled: true, minutesPerSecond: 6 } } });
  const sys = KIT.registry('systems').get('home');

  const w1 = world(off, save);
  sys.update(w1, 1);
  assert.ok(H.now(save) > 480, 'with no engine clock, home moves the minutes on');

  const save2 = blankSave();
  const w2 = world(on, save2);
  sys.update(w2, 1);
  assert.equal(H.now(save2), 480, 'with the engine clock on, home adds nothing of its own');
});

test('integration: one session gap — said once, by whoever owns the clock', () => {
  const p = project();
  const save = blankSave();
  M.add(M.section(save), M.create({ uid: 'a', id: 'pikachu', friendship: 100 }));
  // Both modules read the same stamp: the kit's own save.clock.lastSeenAt.
  save.clock.lastSeenAt = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
  H.ensure(save).seenAt = save.clock.lastSeenAt;

  const w = world(p, save);
  const heard = [];
  w.events.on('sessionResumed', (e) => heard.push(e));
  M._install(w);                                  // mons notices the gap but waits
  H.sweep(w, { quiet: true });                    // home owns the clock and announces it
  M._settleAway(w);                               // mons sees the latch and says nothing more

  assert.equal(heard.length, 1, 'exactly one sessionResumed');
  assert.ok(heard[0].minutesAdded > 0, 'and it carries the minutes home turned the gap into');
  assert.equal(M.read(save).party[0].friendship, 104, 'mons still paid its away bonus, once');
  assert.ok(H.now(save) > 480, 'and the in-game clock moved on while we were away');
});

test('integration: one friendship number — home hands job friendship to the friends’ owner', () => {
  const p = project();
  const save = blankSave();
  const mon = M.create({ uid: 'u1', id: 'pikachu', friendship: 50 });
  M.add(M.section(save), mon);
  const w = world(p, save);
  const ctx = w.makeCtx(null, 'p1');

  assert.ok(KIT.registry('commands').has('friendship'), 'the owner registered a friendship command');
  const took = H.awardFriendship(ctx, 'u1', 8);
  assert.equal(took, true, 'home found somebody to give it to');
  assert.equal(M.find(M.section(save), 'u1').friendship, 58, 'and it landed on the one mons record');
  // home keeps no friendship of its own anywhere in its save slice.
  assert.equal(JSON.stringify(H.ensure(save)).includes('friendship'), false);
});

test('integration: with no module owning the friends, awarding friendship is a quiet no-op', () => {
  const cmds = KIT.registry('commands');
  const def = cmds.get('friendship');
  cmds.remove('friendship');
  try {
    const save = blankSave();
    const w = world(project(), save);
    assert.equal(H.awardFriendship(w.makeCtx(null, 'p1'), 'nobody', 8), false);
  } finally { cmds.add(Object.assign({}, def, { replace: true })); }
});

test('integration: one name and one face — the roster comes from mons, through the registries', () => {
  const p = project();
  const save = blankSave();
  M.add(M.section(save), M.create({ uid: 'u1', id: 'pikachu', nickname: 'Spark', friendship: 90 }));
  const roster = H.roster(p, save);
  assert.equal(roster.length, 1);
  assert.equal(roster[0].name, M.displayName(M.find(M.section(save), 'u1'), p), 'the name has one source');
  assert.equal(roster[0].name, 'Spark');
  assert.deepEqual(roster[0].types, M.species('pikachu').types, 'and so do the types');
  // The face is a *registered sprite id*, not a copy of anybody's art.
  assert.equal(roster[0].sprite, M.spriteId('pikachu', false));
  assert.ok(KIT.registry('sprites').has(roster[0].sprite), 'and the sprites registry knows it');
});

test('integration: with mons absent the roster falls back to the heroes', () => {
  const p = project();
  const save = blankSave();                       // no save.modules.mons at all
  const roster = H.roster(p, save);
  assert.equal(roster.length, 2);
  assert.equal(roster[0].kind, 'hero');
});

test('integration: one mood — mons shows the mood home keeps, and moves it when you are kind', () => {
  const p = project();
  const save = blankSave();
  const mon = M.create({ uid: 'u1', id: 'pikachu', friendship: 120 });
  M.add(M.section(save), mon);
  H.ensure(save);
  H.setMood(save, 'u1', 'lonely', H.now(save));

  const w = world(p, save);
  // The garden card asks mons; mons asks whoever owns the mood.
  const shown = M.moodFor(mon, { project: p, save, day: 1 });
  assert.equal(shown.id, 'lonely', 'mons shows home’s mood, not a second one of its own');
  assert.equal(shown.label, H.moodLabel(p, 'lonely'));

  // Petting is a mons action; the mood is home's. The join is one world event.
  KIT.registry('systems').get('home').onMapEnter(w);
  w.events.emit('friendCared', { uid: 'u1', what: 'petted' });
  assert.equal(H.moodOf(save, 'u1').mood, 'happy', 'being petted cheered them up');
  assert.equal(M.moodFor(mon, { project: p, save, day: 1 }).id, 'happy', 'and mons shows that');
});

test('integration: the pause menu is in one order across both modules', () => {
  // Scenes (and therefore the menu entries) only register in a browser, so the
  // orders are read from the module sources rather than the registry here.
  const fs = require('fs');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
  const orderOf = (src, id) => {
    const m = src.match(new RegExp("id: '" + id + "', order: (\\d+)"));
    return m ? Number(m[1]) : null;
  };
  const monsSrc = read('js/modules/mons/scenes.js');
  const homeSrc = read('js/modules/home/register.js');
  const order = {
    'mons-party': orderOf(monsSrc, 'mons-party'),
    'mons-dex': orderOf(monsSrc, 'mons-dex'),
    'home-jobs': orderOf(homeSrc, 'home-jobs'),
    'home-decorate': orderOf(homeSrc, 'home-decorate'),
  };
  assert.deepEqual(order, { 'mons-party': 10, 'mons-dex': 12, 'home-jobs': 14, 'home-decorate': 16 });
  // …and all of them above the kit's own first entry, Save at 20
  // (js/kit/scenes/menu.js, which only loads in a browser).
  assert.ok(Math.max(...Object.values(order)) < 20);
});

test('integration: every string either module shows is registered, in one style', () => {
  const reg = KIT.registry('strings');
  const ids = reg.ids().filter(id => /^(mons|home)-/.test(id));
  assert.ok(ids.length > 100, `${ids.length} module strings are in the Terms table`);
  for (const id of ids) {
    assert.match(id, /^(mons|home)-[a-z0-9-]+$/, `${id} follows the kit's own kebab-case naming`);
    assert.equal(typeof reg.get(id).default, 'string');
    assert.ok(reg.get(id).default.length > 0, `${id} says something`);
  }
});

test('integration: neither module writes a string the other owns', () => {
  const fs = require('fs');
  const read = (dir) => fs.readdirSync(path.join(__dirname, '..', '..', 'js/modules', dir))
    .filter(f => f.endsWith('.js'))
    .map(f => fs.readFileSync(path.join(__dirname, '..', '..', 'js/modules', dir, f), 'utf8')).join('\n');
  assert.equal(/'home-[a-z0-9-]+'/.test(read('mons')), false, 'mons never names a home string');
  assert.equal(/'mons-[a-z0-9-]+'/.test(read('home')), false, 'home never names a mons string');
});

test('integration: the demo content carries no module strings — the modules own their words', () => {
  const raw = KIT.project.fromContent('demo');
  const reg = KIT.registry('strings');
  const baked = Object.keys((raw && raw.strings) || {}).filter(k => /^(mons|home)-/.test(k));
  assert.deepEqual(baked, [], 'nothing module-shaped is frozen into project.strings');
  // And the Terms table still answers for them, from the registry.
  assert.equal(KIT.strings.get(raw, 'home-jobs-title'), reg.get('home-jobs-title').default);
  assert.equal(KIT.strings.get(raw, 'mons-menu-party'), reg.get('mons-menu-party').default);
});
