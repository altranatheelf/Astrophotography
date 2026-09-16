'use strict';
// The mons module: the rules, headless.
//
// Everything the Pokémon side decides lives in pure functions (js/modules/mons/
// rules.js), so a whole catch — quality, wobbles, fleeing, the party, the dex,
// the save — can be played out in Node with no screen. The scenes on top are a
// renderer over exactly this.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('../kit/_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));

R('js/kit/world/map.js'); R('js/kit/world/entities.js'); R('js/kit/world/world.js'); R('js/kit/systems/index.js');
global.PKMN = global.PKMN || {};
for (const f of ['js/art/tiles.js', 'js/art/chars.js', 'js/art/tiles-nature.js', 'js/art/tiles-town.js', 'js/art/tiles-interior.js', 'js/art/chars-heroes.js', 'js/art/chars-placeholder.js']) R(f);
for (const f of ['js/data/types.js', 'js/data/moves.js', 'js/data/pokemon.js']) R(f);
// js/sprites/*.js assign to `window` directly instead of using the window/globalThis
// shim every other file has, so Node needs one for the length of the require.
global.window = global;
for (const f of ['charizard', 'venusaur', 'machamp', 'jynx', 'electabuzz', 'jolteon', 'vaporeon']) R('js/sprites/' + f + '.js');
delete global.window;
R('js/main.js');                                  // KIT.module / KIT.modules
for (const f of ['rules', 'strings', 'art', 'actions', 'script', 'systems', 'panel', 'manifest']) R('js/modules/mons/' + f + '.js');

const loaded = KIT.modules.activate({ modules: ['mons'] });
const M = KIT.mons;

// A project the module is happy with: the demo's own content pack, minus the maps.
function project(extra) {
  return Object.assign({
    meta: { id: 'test' }, modules: ['mons'],
    heroes: [{ id: 'p1', name: 'Ash' }, { id: 'p2', name: 'Misty' }],
    items: { pokeball: { kind: 'ball', name: 'Poké Ball' }, berry: { kind: 'berry', name: 'Berry' }, 'golden-berry': { kind: 'berry', name: 'Golden Berry' } },
    vars: {}, scripts: {}, strings: {}, maps: {},
    packs: { mons: { difficulty: 'normal' } },
  }, extra || {});
}
function blankSave() { return { vars: {}, inventory: {}, objects: {}, heroes: [{}, {}], modules: {}, overlays: {}, clock: { day: 1 } }; }

// ---------------------------------------------------------------- species & rarity
test('mons: the module registers itself and every species', () => {
  assert.deepEqual(loaded.map(d => d.id), ['mons']);
  assert.equal(M.speciesList().length, 32, 'all 32 species are in the registry');
  const pika = M.species('pikachu');
  assert.equal(pika.name, 'Pikachu');
  assert.equal(pika.dex, 25);
  assert.deepEqual(pika.types, ['electric']);
  assert.equal(pika.bst, 485);
  assert.equal(M.species('nobody'), null, 'an unknown id is null, not a throw');
  assert.equal(M.speciesName('nobody'), 'nobody');
});

test('mons: rarity buckets come from the base-stat total, and the project may override', () => {
  assert.equal(M.rarityForBst(399), 'common');
  assert.equal(M.rarityForBst(400), 'uncommon');
  assert.equal(M.rarityForBst(469), 'uncommon');
  assert.equal(M.rarityForBst(470), 'rare');
  assert.equal(M.rarityForBst(519), 'rare');
  assert.equal(M.rarityForBst(520), 'special');
  assert.equal(M.rarityForBst(569), 'special');
  assert.equal(M.rarityForBst(570), 'legendary');

  // the whole table lands in a bucket, and the buckets follow the totals
  const seen = {};
  for (const sp of M.speciesList()) {
    assert.ok(M.RARITIES.includes(sp.rarity), `${sp.id} has a real rarity`);
    assert.equal(sp.rarity, M.rarityForBst(sp.bst));
    seen[sp.rarity] = (seen[sp.rarity] || 0) + 1;
  }
  assert.ok(Object.keys(seen).length >= 4, 'the roster spreads across the buckets');
  assert.equal(M.rarity('butterfree'), 'common');
  assert.equal(M.rarity('pikachu'), 'rare');
  assert.equal(M.rarity('mew'), 'legendary');

  const p = project({ packs: { mons: { rarity: { mew: 'common' } } } });
  assert.equal(M.rarity('mew', p), 'common', 'the project wins');
  assert.equal(M.rarity('mew', project({ packs: { mons: { rarity: { mew: 'nonsense' } } } })), 'legendary', 'nonsense is ignored');
});

// ---------------------------------------------------------------- catch chance
test('mons: catch chance across the whole table, with clamps and the berry bonus', () => {
  // the base chance falls as the rarity rises, for every species
  for (const sp of M.speciesList()) {
    const c = M.catchChance({ species: sp.id });
    assert.ok(c >= M.CHANCE_MIN && c <= M.CHANCE_MAX, `${sp.id}: ${c} is inside the clamps`);
    assert.equal(c, M.BASE_CHANCE[sp.rarity], `${sp.id}: an ok throw is the base chance`);
  }
  const rank = M.RARITIES.map(r => M.catchChance({ rarity: r }));
  for (let i = 1; i < rank.length; i++) assert.ok(rank[i] < rank[i - 1], 'rarer is harder');

  // throw quality multiplies
  const base = M.catchChance({ species: 'pikachu' });
  assert.ok(M.catchChance({ species: 'pikachu', quality: 'perfect' }) > M.catchChance({ species: 'pikachu', quality: 'great' }));
  assert.ok(M.catchChance({ species: 'pikachu', quality: 'great' }) > base);
  assert.ok(M.catchChance({ species: 'pikachu', quality: 'miss' }) < base);

  // berries add a flat bonus, and stop adding at maxCalm
  const calm0 = M.catchChance({ species: 'gengar', calm: 0 });
  const calm1 = M.catchChance({ species: 'gengar', calm: 1 });
  const calm3 = M.catchChance({ species: 'gengar', calm: 3 });
  assert.ok(Math.abs((calm1 - calm0) - 0.12) < 1e-9, 'one berry is +0.12');
  assert.ok(Math.abs((calm3 - calm0) - 0.36) < 1e-9, 'three berries is +0.36');
  assert.equal(M.catchChance({ species: 'gengar', calm: 99 }), calm3, 'calm is capped');

  // talk
  assert.ok(M.catchChance({ species: 'gengar', curious: true }) > calm0);

  // difficulty
  assert.ok(M.catchChance({ species: 'mew', difficulty: 'gentle' }) > M.catchChance({ species: 'mew', difficulty: 'normal' }));
  assert.ok(M.catchChance({ species: 'mew', difficulty: 'hard' }) < M.catchChance({ species: 'mew', difficulty: 'normal' }));

  // clamps: nothing is ever hopeless, and nothing is ever certain
  assert.equal(M.catchChance({ rarity: 'legendary', quality: 'miss', difficulty: 'hard', ballPower: 0.5 }), M.CHANCE_MIN);
  assert.ok(M.catchChance({ rarity: 'legendary', quality: 'miss', difficulty: 'hard' }) > M.CHANCE_MIN);
  assert.equal(M.catchChance({ rarity: 'common', quality: 'perfect', calm: 3, curious: true, difficulty: 'gentle' }), M.CHANCE_MAX);
  // ...except a golden berry, which is a promise
  assert.equal(M.catchChance({ rarity: 'legendary', quality: 'miss', golden: true }), 1);
});

test('mons: the timing ring turns a tap into a throw quality, and a berry widens the band', () => {
  const band = M.ringBand(M.DEFAULT_PROFILE.art, 0);
  assert.equal(M.ringQuality(band.center, band), 'perfect');
  assert.equal(M.ringQuality(band.center + band.width * 0.5, band), 'great');
  assert.equal(M.ringQuality(band.center + band.width * 0.9, band), 'ok');
  assert.equal(M.ringQuality(band.center + band.width * 1.2, band), 'miss');
  assert.equal(M.ringQuality(1, band), 'miss', 'tapping the moment it opens is a miss');

  const wide = M.ringBand(M.DEFAULT_PROFILE.art, 2);
  assert.ok(wide.width > band.width, 'two berries widen the green band');
  const justOutside = band.center + band.width * 1.2;
  assert.equal(M.ringQuality(justOutside, band), 'miss');
  assert.equal(M.ringQuality(justOutside, wide), 'ok', 'the same tap now counts');
});

test('mons: wobbles, and the ball only clicks when the roll lands', () => {
  assert.deepEqual(pick(M.resolveThrow({ chance: 0.5, roll: 0.2 })), { caught: true, wobbles: 3 });
  assert.deepEqual(pick(M.resolveThrow({ chance: 0.5, roll: 0.499 })), { caught: true, wobbles: 3 });
  assert.deepEqual(pick(M.resolveThrow({ chance: 0.5, roll: 0.6 })), { caught: false, wobbles: 2 }, 'a near miss wobbles twice');
  assert.deepEqual(pick(M.resolveThrow({ chance: 0.5, roll: 0.95 })), { caught: false, wobbles: 1 }, 'a clear miss wobbles once');
  assert.deepEqual(pick(M.resolveThrow({ chance: 0, roll: 0 })), { caught: false, wobbles: 1 });
  for (let i = 0; i <= 20; i++) {
    const r = M.resolveThrow({ chance: 0.4, roll: i / 20 });
    assert.ok(r.wobbles >= 1 && r.wobbles <= 3, 'always one to three wobbles');
  }
  function pick(r) { return { caught: r.caught, wobbles: r.wobbles }; }
});

test('mons: it may flee, but only after three failed throws', () => {
  assert.equal(M.shouldFlee({ fails: 1, roll: 0 }), false);
  assert.equal(M.shouldFlee({ fails: 2, roll: 0 }), false);
  assert.equal(M.shouldFlee({ fails: 3, roll: 0 }), true);
  assert.equal(M.shouldFlee({ fails: 3, roll: 0.9 }), false, 'it is a chance, not a rule');
  assert.equal(M.shouldFlee({ fails: 9, roll: 0, fleeAfter: 10 }), false, 'content sets the patience');
});

// ---------------------------------------------------------------- the catch scene, headless
test('mons: a whole catch played through the pure functions', () => {
  const p = project();
  const state = M.newCatchState({ species: 'pikachu', project: p });
  const items = { pokeball: 3, berry: 1, 'golden-berry': 1 };
  const act = (id) => (state.profile.actions.find(a => a.id === id));

  // out of balls says so kindly, and changes nothing
  const empty = M.applyAction(state, act('throw'), { items: { pokeball: 0 }, quality: 'ok', rng: () => 0 });
  assert.deepEqual(empty, { kind: 'blocked', reason: 'no-balls', item: 'pokeball' });
  assert.equal(state.throws, 0);

  // a berry calms it
  const calm = M.applyAction(state, act('berry'), { items, rng: () => 0 });
  assert.equal(calm.kind, 'calm');
  assert.equal(state.calm, 1);

  // talking: the rng decides whether it becomes curious
  assert.equal(M.applyAction(state, act('talk'), { items, rng: () => 0.99 }).became, false);
  assert.equal(M.applyAction(state, act('talk'), { items, rng: () => 0.01 }).became, true);
  assert.equal(state.curious, true);

  // a throw that misses
  const miss = M.applyAction(state, act('throw'), { items, quality: 'miss', rng: () => 0.99 });
  assert.equal(miss.caught, false);
  assert.equal(state.fails, 1);
  assert.equal(state.done, null);

  // the golden berry guarantees the next one
  const golden = M.applyAction(state, act('golden'), { items, rng: () => 0.5 });
  assert.equal(golden.guarantee, true);
  assert.equal(state.guarantee, true);
  const gotcha = M.applyAction(state, act('throw'), { items, quality: 'miss', rng: () => 0.999 });
  assert.equal(gotcha.caught, true, 'a golden berry catches even on a bad throw');
  assert.equal(gotcha.chance, 1);
  assert.equal(state.done, 'caught');
  assert.equal(state.guarantee, false, 'and it is used up');

  // leaving
  const bye = M.newCatchState({ species: 'mew', project: p });
  assert.equal(M.applyAction(bye, act('leave'), { items }).kind, 'leave');
  assert.equal(bye.done, 'left');
});

test('mons: three failed throws and it is gone', () => {
  const state = M.newCatchState({ species: 'mew', project: project() });
  const throwAct = state.profile.actions.find(a => a.id === 'throw');
  const items = { pokeball: 9 };
  // each failed throw asks the rng twice: once for the ball, once for "does it go?"
  const scripted = (seq) => { let i = 0; return () => seq[i++ % seq.length]; };
  let last = null;
  for (let i = 0; i < 3; i++) last = M.applyAction(state, throwAct, { items, quality: 'miss', rng: scripted([0.999, 0.01]) });
  assert.equal(state.fails, 3);
  assert.equal(last.fled, true);
  assert.equal(state.done, 'fled');

  // with a patient profile it stays put
  const patient = M.newCatchState({ species: 'mew', project: project() });
  patient.profile = Object.assign({}, patient.profile, { rules: Object.assign({}, patient.profile.rules, { fleeChance: 0 }) });
  for (let i = 0; i < 6; i++) M.applyAction(patient, throwAct, { items, quality: 'miss', rng: () => 0.999 });
  assert.equal(patient.done, null);
  assert.equal(patient.fails, 6);
});

// ---------------------------------------------------------------- encounters
test('mons: the encounter table is read from the map, and the roll is deterministic for a seed', () => {
  const map = {
    id: 'route', width: 4, height: 4,
    props: { encounters: { rate: 50, byRegion: { 1: [{ id: 'pikachu', weight: 6 }, { id: 'butterfree', weight: 2 }], 2: [{ id: 'mew', weight: 1 }] } } },
  };
  const table = M.encounterTable(map, project());
  assert.equal(table.rate, 50);
  assert.deepEqual(table.byRegion['1'].map(e => e.id), ['pikachu', 'butterfree']);

  // weights, exactly: pikachu owns the first 75% of the range
  assert.equal(M.pickWeighted(table.byRegion['1'], 0).id, 'pikachu');
  assert.equal(M.pickWeighted(table.byRegion['1'], 0.74).id, 'pikachu');
  assert.equal(M.pickWeighted(table.byRegion['1'], 0.76).id, 'butterfree');
  assert.equal(M.pickWeighted(table.byRegion['1'], 1).id, 'butterfree');
  assert.equal(M.pickWeighted([], 0.5), null);
  assert.equal(M.pickWeighted([{ id: 'x', weight: 0 }], 0.5), null, 'a zero weight is "not here"');

  // the same seed walks the same walk
  const runA = [], runB = [];
  const rngA = KIT.rng(7), rngB = KIT.rng(7);
  for (let i = 0; i < 60; i++) { runA.push(M.rollEncounter(table, 1, rngA)); runB.push(M.rollEncounter(table, 1, rngB)); }
  assert.deepEqual(runA.map(x => x && x.id), runB.map(x => x && x.id));
  const hits = runA.filter(Boolean).length;
  assert.ok(hits > 15 && hits < 45, `rate 50 over 60 steps gave ${hits} meetings`);
  assert.deepEqual(Array.from(new Set(runA.filter(Boolean).map(x => x.id))).sort(), ['butterfree', 'pikachu']);

  // a different region is a different crowd; an unpainted one is nobody
  assert.equal(M.rollEncounter(table, 2, KIT.rng(1)) === null || M.rollEncounter(table, 2, KIT.rng(3)).id === 'mew', true);
  assert.deepEqual(M.entriesFor(table, 9), []);
  assert.equal(M.rollEncounter(table, 9, KIT.rng(1)), null);
  assert.equal(M.encounterTable({ id: 'nowhere', props: {} }, project()), null);

  // rate 0 never meets anybody
  const quiet = M.encounterTable({ id: 'q', props: { encounters: { rate: 0, byRegion: { 0: [{ id: 'mew', weight: 1 }] } } } }, project());
  for (let i = 0; i < 50; i++) assert.equal(M.rollEncounter(quiet, 0, KIT.rng(i)), null);
});

test('mons: the demo route really has a table, and the garden really is a garden', () => {
  for (const f of ['js/content/demo/project.js', 'js/content/demo/maps/route.js', 'js/content/demo/maps/town.js']) R(f);
  const raw = KIT.project.fromContent('demo');
  assert.ok(raw.modules.includes('mons'), 'the demo turns the module on');
  const table = M.encounterTable(raw.maps.route, raw);
  assert.ok(table && table.rate > 0);
  for (const region of ['1', '2']) {
    assert.ok(table.byRegion[region].length >= 4, `region ${region} has a crowd`);
    for (const e of table.byRegion[region]) assert.ok(M.species(e.id), `${e.id} is a real species`);
  }
  assert.ok(M.gardenArea(raw.maps.town), 'the town has a fenced garden corner');
  assert.deepEqual(M.gardenArea({ kind: 'garden', props: {} }), { all: true });
  assert.equal(M.gardenArea({ kind: 'outdoor', props: {} }), null);

  // the catch profile ships in content, not in code
  const profile = M.profile(raw);
  assert.equal(profile.id, 'friendly');
  assert.deepEqual(profile.actions.map(a => a.kind), ['throw', 'offer', 'offer', 'talk', 'leave']);
  assert.equal(M.line(raw, profile, 'gotcha', { name: 'Pikachu' }), 'Gotcha! Pikachu wants to come with you.');
});

// ---------------------------------------------------------------- party, box, dex
test('mons: a full party overflows into the garden', () => {
  const s = M.saveDefaults();
  const made = [];
  for (let i = 0; i < 8; i++) {
    const mon = M.create({ uid: 'u' + i, id: 'pikachu', map: 'route', metAt: 'Route 1' });
    made.push(mon);
    assert.equal(M.add(s, mon), i < 6 ? 'party' : 'box');
  }
  assert.equal(s.party.length, 6);
  assert.equal(s.box.length, 2);
  assert.equal(M.partyFull(s), true);
  assert.equal(M.all(s).length, 8);
  assert.equal(M.find(s, 'u7').uid, 'u7');
  assert.equal(M.owns(s, 'pikachu'), true);
  assert.equal(M.owns(s, 'mew'), false);

  // 'box' is asked for explicitly even with room
  const s2 = M.saveDefaults();
  assert.equal(M.add(s2, M.create({ uid: 'x', id: 'mew' }), { to: 'box' }), 'box');
  assert.equal(s2.party.length, 0);

  // moving between the two, and the party cap holds
  assert.equal(M.move(s, 'u7', 'party'), null, 'no room');
  assert.equal(M.move(s, 'u0', 'box'), 'box');
  assert.equal(M.move(s, 'u7', 'party'), 'party');
  assert.equal(s.party.length, 6);

  // reordering
  const order = () => s.party.map(m => m.uid);
  const first = order()[0];
  assert.equal(M.reorder(s, first, 2), 2);
  assert.equal(order()[2], first);
  assert.equal(M.reorder(s, first, -99), 0, 'clamped, not wrapped');
  assert.equal(M.reorder(s, 'nobody', 1), -1);
});

test('mons: the follower is the first party mon unless you say otherwise', () => {
  const s = M.saveDefaults();
  assert.equal(M.follower(s), null);
  const a = M.create({ uid: 'a', id: 'pikachu' });
  const b = M.create({ uid: 'b', id: 'jolteon' });
  M.add(s, a); M.add(s, b);
  assert.equal(M.follower(s).uid, 'a');
  M.setFollower(s, 'b');
  assert.equal(M.follower(s).uid, 'b');
  M.move(s, 'b', 'box');
  assert.equal(s.follower, null, 'somebody in the garden does not walk with you');
  assert.equal(M.follower(s).uid, 'a');
  M.setFollower(s, 'nobody-at-all');
  assert.equal(s.follower, null);
});

test('mons: friendship clamps, and the tiers land on 50/100/150/200/255', () => {
  const mon = M.create({ uid: 'f', id: 'pikachu', friendship: 0 });
  assert.equal(M.friendshipTier(0).id, 'new');
  assert.equal(M.friendshipTier(49).id, 'new');
  assert.equal(M.friendshipTier(50).id, 'warm');
  assert.equal(M.friendshipTier(99).id, 'warm');
  assert.equal(M.friendshipTier(100).id, 'close');
  assert.equal(M.friendshipTier(150).id, 'dear');
  assert.equal(M.friendshipTier(200).id, 'devoted');
  assert.equal(M.friendshipTier(255).id, 'bonded');
  assert.equal(M.friendshipTier(255).hearts, 5);
  assert.equal(M.friendshipTier(0).hearts, 0);
  assert.equal(M.friendshipTier(-100).id, 'new', 'below zero reads as zero');
  assert.equal(M.friendshipTier(9999).id, 'bonded');

  assert.equal(M.addFriendship(mon, 30), 30);
  assert.equal(M.addFriendship(mon, -100), 0, 'never below zero');
  assert.equal(M.addFriendship(mon, 9999), 255, 'never above 255');
  assert.equal(M.setFriendship(mon, 120), 120);
  assert.equal(M.setFriendship(mon, -5), 0);

  // +1 per 128 steps while following
  const s = M.saveDefaults();
  M.add(s, mon);
  M.setFriendship(mon, 0);
  M.walkFriendship(s, 127, { per: 128 });
  assert.equal(mon.friendship, 0);
  M.walkFriendship(s, 1, { per: 128 });
  assert.equal(mon.friendship, 1);
  M.walkFriendship(s, 256, { per: 128 });
  assert.equal(mon.friendship, 3);

  // petting is once per visit; a berry is worth more, a favourite berry more again
  mon.favouriteBerry = 'berry';
  assert.equal(M.pet(s, 'f', { bonus: 3 }), 3);
  assert.equal(M.pet(s, 'f', { bonus: 3 }), 0, 'plenty of fuss for now');
  M.newVisit(s);
  assert.equal(M.pet(s, 'f', { bonus: 3 }), 3);
  assert.equal(M.giveBerry(s, 'f', { bonus: 10, favourite: 5, item: 'golden-berry' }), 10);
  assert.equal(M.giveBerry(s, 'f', { bonus: 10, favourite: 5, item: 'berry' }), 15);

  // a real day away is worth something to everyone
  const day = 24 * 3600 * 1000;
  assert.deepEqual(M.resumeBonus(s, 3600 * 1000, { hours: 20, bonus: 4 }), []);
  const before = mon.friendship;
  assert.equal(M.resumeBonus(s, day, { hours: 20, bonus: 4 }).length, 1);
  assert.equal(mon.friendship, before + 4);
});

test('mons: the mood is a personality, not noise', () => {
  const shy = M.create({ uid: 'shy', id: 'pikachu', friendship: 10 });
  const close = M.create({ uid: 'close', id: 'pikachu', friendship: 240 });
  assert.equal(M.moodFor(shy, { day: 1 }).id, M.moodFor(shy, { day: 1 }).id, 'the same day is the same mood');
  assert.ok(['shy', 'curious', 'sleepy'].includes(M.moodFor(shy, { day: 1 }).id), 'strangers are shy');
  assert.ok(['happy', 'playful', 'proud', 'calm'].includes(M.moodFor(close, { day: 1 }).id), 'old friends are bright');
  const days = new Set();
  for (let d = 0; d < 30; d++) days.add(M.moodFor(close, { day: d }).id);
  assert.ok(days.size > 1, 'and the days are not all the same');
  assert.equal(M.mood('nonsense').id, 'happy', 'an unknown mood never throws');
});

test('mons: the Pokédex counts seen and befriended separately', () => {
  const s = M.saveDefaults();
  assert.deepEqual(pickCounts(M.dexCounts(s)), { seen: 0, caught: 0 });
  assert.equal(M.isNew(s, 'pikachu'), true);
  assert.equal(M.see(s, 'pikachu'), true);
  assert.equal(M.see(s, 'pikachu'), false, 'only new the first time');
  assert.equal(M.isNew(s, 'pikachu'), false);
  M.see(s, 'gengar');
  assert.deepEqual(pickCounts(M.dexCounts(s)), { seen: 2, caught: 0 });

  const entry = M.markCaught(s, 'pikachu', { map: 'route', where: 'Route 1', date: '2026-01-02T10:00:00.000Z' });
  assert.equal(entry.count, 1);
  assert.equal(entry.where, 'Route 1');
  assert.deepEqual(pickCounts(M.dexCounts(s)), { seen: 2, caught: 1 });
  const again = M.markCaught(s, 'pikachu', {});
  assert.equal(again.count, 2, 'meeting a second one counts');
  assert.equal(again.where, 'Route 1', 'but where you first met it is remembered');
  assert.deepEqual(pickCounts(M.dexCounts(s)), { seen: 2, caught: 1 });

  M.markCaught(s, 'mew', { map: 'route', where: 'Route 1' });
  assert.deepEqual(pickCounts(M.dexCounts(s)), { seen: 3, caught: 2 }, 'catching one you never saw still marks it seen');
  assert.equal(M.dexCounts(s).total, 32);
  function pickCounts(c) { return { seen: c.seen, caught: c.caught }; }
});

// ---------------------------------------------------------------- the save section
test('mons: an older save still loads, through the migration', () => {
  // v1: the flat Pokémon game, before any of this existed
  const old = {
    pokemon: [
      { species: 'pikachu', name: 'Sparky', friendship: 140, where: 'Route 1' },
      { species: 'gengar', friendship: 10 },
      { species: 'mew', friendship: 255, shiny: true },
      { species: 'jolteon' }, { species: 'vaporeon' }, { species: 'flareon' }, { species: 'snorlax' },
    ],
    dex: ['pikachu', 'gengar', 'mew', 'jolteon', 'vaporeon', 'flareon', 'snorlax', 'lapras'],
    follower: 0,
  };
  const save = { modules: { mons: old } };
  const s = M.section(save);

  assert.equal(s.version, M.SAVE_VERSION);
  assert.equal(s.party.length, 6, 'six come with you');
  assert.equal(s.box.length, 1, 'the seventh waits in the garden');
  assert.equal(s.party[0].nickname, 'Sparky');
  assert.equal(M.displayName(s.party[0]), 'Sparky');
  assert.equal(M.displayName(s.party[1]), 'Gengar', 'no nickname reads as the species');
  assert.equal(s.party[0].friendship, 140);
  assert.equal(M.friendshipTier(s.party[0].friendship).id, 'close');
  assert.equal(s.party[2].shiny, true);
  assert.equal(s.follower, s.party[0].uid, 'the old index became a uid');
  assert.deepEqual(Object.keys(s.dex.seen).sort(), ['flareon', 'gengar', 'jolteon', 'lapras', 'mew', 'pikachu', 'snorlax', 'vaporeon']);
  assert.equal(M.dexCounts(s).caught, 7, 'the seven you had count as befriended');
  assert.equal(M.dexCounts(s).seen, 8, 'and the eighth is still only seen');
  for (const mon of M.all(s)) {
    assert.ok(mon.uid, 'everyone has a uid');
    assert.ok(mon.caughtAt && 'map' in mon.caughtAt, 'everyone has a caughtAt');
  }

  // and the migrated section is stable: loading it again changes nothing
  const again = M.section(save);
  assert.deepEqual(again, s);
  assert.equal(save.modules.mons, s, 'it is written back into the save');

  // rubbish never throws
  assert.equal(M.section({}).party.length, 0);
  assert.equal(M.section({ modules: { mons: null } }).party.length, 0);
  assert.equal(M.section({ modules: { mons: 'nonsense' } }).version, M.SAVE_VERSION);
  assert.equal(M.migrateSave(undefined).party.length, 0);
  // reading never writes
  const untouched = { modules: {} };
  assert.equal(M.read(untouched).party.length, 0);
  assert.equal(untouched.modules.mons, undefined);
});

// ---------------------------------------------------------------- commands & conditions
test('mons: givePokemon through a fake ctx', async () => {
  const p = project();
  const ctx = KIT.interpreter.fakeCtx({ project: p, save: blankSave(), names: ['Sparky'] });
  await KIT.commands.exec(ctx, { t: 'givePokemon', species: 'pikachu', friendship: 70, ask: true });
  const s = M.read(ctx.world.save);
  assert.equal(s.party.length, 1);
  assert.equal(s.party[0].id, 'pikachu');
  assert.equal(s.party[0].nickname, 'Sparky', 'the nickname prompt was asked and answered');
  assert.equal(s.party[0].friendship, 70);
  assert.equal(s.follower, s.party[0].uid, 'the first one you get walks with you');
  assert.equal(M.dexCounts(s).caught, 1);
  assert.match(ctx.calls('io', 'toast')[0].args[0].text, /joined you/);

  // no prompt, a fixed nickname, straight to the garden
  await KIT.commands.exec(ctx, { t: 'givePokemon', species: 'mew', nickname: 'Wisp', to: 'box', shiny: true, notify: false });
  const s2 = M.read(ctx.world.save);
  assert.equal(s2.box.length, 1);
  assert.equal(s2.box[0].nickname, 'Wisp');
  assert.equal(s2.box[0].shiny, true);

  // an unknown species is a warning, not a crash
  await KIT.commands.exec(ctx, { t: 'givePokemon', species: 'squirtle-ish' });
  assert.equal(M.read(ctx.world.save).party.length, 1);

  // the summary is what the editor shows
  assert.equal(KIT.commands.summary({ t: 'givePokemon', species: 'pikachu' }, ctx), 'Give Pikachu');
});

test('mons: encounter, friendship, openParty and openDex all run headlessly', async () => {
  const p = project();
  const ctx = KIT.interpreter.fakeCtx({ project: p, save: blankSave() });
  // with no screen the encounter still marks the Pokédex
  await KIT.commands.exec(ctx, { t: 'encounter', species: 'butterfree' });
  assert.equal(M.read(ctx.world.save).dex.seen.butterfree, true);

  await KIT.commands.exec(ctx, { t: 'givePokemon', species: 'pikachu', notify: false });
  await KIT.commands.exec(ctx, { t: 'friendship', who: 'follower', op: 'add', amount: 40 });
  assert.equal(M.read(ctx.world.save).party[0].friendship, 40);
  await KIT.commands.exec(ctx, { t: 'friendship', who: 'species', species: 'pikachu', op: 'set', amount: 255 });
  assert.equal(M.read(ctx.world.save).party[0].friendship, 255);
  await KIT.commands.exec(ctx, { t: 'friendship', who: 'all', op: 'add', amount: -300 });
  assert.equal(M.read(ctx.world.save).party[0].friendship, 0, 'clamped on the way down too');

  // the two openers are a no-op without a screen, and do not throw
  await KIT.commands.exec(ctx, { t: 'openParty' });
  await KIT.commands.exec(ctx, { t: 'openDex' });
});

test('mons: the conditions read the save the way the script layer will', async () => {
  const p = project();
  const ctx = KIT.interpreter.fakeCtx({ project: p, save: blankSave() });
  const test1 = (c) => KIT.conditions.test(c, ctx);

  assert.equal(test1({ kind: 'has', species: 'pikachu' }), false);
  assert.equal(test1({ kind: 'has', species: 'pikachu', is: false }), true);
  assert.equal(test1({ kind: 'partyFull' }), false);
  assert.equal(test1({ kind: 'partyFull', is: false }), true);
  assert.equal(test1({ kind: 'dexCount', which: 'caught', op: '>=', count: 1 }), false);
  assert.equal(test1({ kind: 'friendship', who: 'follower', op: '>=', value: 1 }), false);

  await KIT.commands.exec(ctx, { t: 'givePokemon', species: 'pikachu', friendship: 120, notify: false });
  assert.equal(test1({ kind: 'has', species: 'pikachu' }), true);
  assert.equal(test1({ kind: 'dexCount', which: 'caught', op: '>=', count: 1 }), true);
  assert.equal(test1({ kind: 'dexCount', which: 'seen', op: '==', count: 1 }), true);
  assert.equal(test1({ kind: 'friendship', who: 'follower', op: '>=', value: 100 }), true);
  assert.equal(test1({ kind: 'friendship', who: 'follower', op: '>=', value: 200 }), false);
  assert.equal(test1({ kind: 'friendship', who: 'species', species: 'pikachu', op: '>', value: 119 }), true);
  assert.equal(test1({ kind: 'friendship', who: 'uid', uid: 'nobody', op: '>=', value: 1 }), false);

  for (let i = 0; i < 5; i++) await KIT.commands.exec(ctx, { t: 'givePokemon', species: 'mew', notify: false });
  assert.equal(test1({ kind: 'partyFull' }), true);

  // they describe themselves for the editor and Screenplay
  assert.equal(KIT.conditions.describe({ kind: 'has', species: 'pikachu' }, ctx), 'has Pikachu');
  assert.equal(KIT.conditions.describe({ kind: 'partyFull' }, ctx), 'party is full');
  assert.ok(/caught/.test(KIT.conditions.describe({ kind: 'dexCount', which: 'caught', op: '>=', count: 5 }, ctx)));
});

test('mons: everything is registered with fields, so Creator Mode can form itself', () => {
  for (const id of ['givePokemon', 'encounter', 'friendship', 'openDex', 'openParty', 'monCard']) {
    const def = KIT.registry('commands').get(id);
    assert.ok(def, `command ${id}`);
    assert.ok(Array.isArray(def.fields), `${id} has fields`);
    assert.equal(typeof def.run, 'function');
    for (const f of def.fields) assert.doesNotThrow(() => KIT.schema.field(f), `${id}.${f.key}`);
  }
  for (const id of ['has', 'dexCount', 'friendship', 'partyFull']) {
    const def = KIT.registry('conditions').get(id);
    assert.ok(def, `condition ${id}`);
    assert.equal(typeof def.test, 'function');
    for (const f of def.fields) assert.doesNotThrow(() => KIT.schema.field(f));
  }
  for (const id of ['ball', 'berry']) assert.ok(KIT.registry('itemKinds').get(id), `item kind ${id}`);
  for (const id of ['mons-encounters', 'mons-follower', 'mons-garden']) assert.ok(KIT.registry('systems').list().some(s => s.id === id), `system ${id}`);

  // ref:mon resolves, so the picker and the validator both work
  assert.equal(KIT.schema.refKinds.mon.has('pikachu'), true);
  assert.equal(KIT.schema.refKinds.mon.has('nobody'), false);
  assert.equal(KIT.schema.refKinds.mon.label('pikachu'), 'Pikachu');
  assert.equal(KIT.schema.refKinds.mon.list().length, 32);
  assert.deepEqual(KIT.schema.validateValue({ key: 'species', type: 'ref:mon' }, 'pikachu'), []);
  assert.equal(KIT.schema.validateValue({ key: 'species', type: 'ref:mon' }, 'nobody').length, 1);

  // every line the module shows is a Terms entry
  for (const d of M.STRINGS) assert.ok(KIT.registry('strings').has(d.id), `string ${d.id}`);
  assert.equal(KIT.strings.get({ strings: { 'mons-gotcha': 'Yes!! {name}!' } }, 'mons-gotcha', { name: 'Mew' }), 'Yes!! Mew!');
});

test('mons: the encounter validator catches a table nobody can honour', () => {
  const v = KIT.registry('validators').get('mons-encounters');
  assert.ok(v);
  const bad = { maps: { route: { id: 'route', props: { encounters: { rate: 10, byRegion: { 1: [{ id: 'pikablu', weight: 3 }] } } } } } };
  const problems = v.run(bad);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].code, 'unknown-species');
  const empty = { maps: { route: { id: 'route', props: { encounters: { rate: 10, byRegion: {} } } } } };
  assert.equal(v.run(empty)[0].code, 'empty-encounters');
  assert.deepEqual(v.run({ maps: { town: { id: 'town', props: {} } } }), []);
});

// ---------------------------------------------------------------- art
test('mons: missing art falls back to a silhouette in the species colour, never a crash', () => {
  assert.equal(M.hasArt('charizard'), true, 'seven are drawn');
  assert.equal(M.hasArt('snorlax'), false, 'the rest are not, yet');
  const drawn = M.portrait('charizard');
  assert.deepEqual(KIT.pixels.validate(drawn), []);
  const fallback = M.portrait('snorlax');
  assert.deepEqual(KIT.pixels.validate(fallback), []);
  assert.ok(Object.values(fallback.palette).includes(M.speciesColor('snorlax')), 'in the species colour');
  assert.deepEqual(KIT.pixels.dims(fallback), { w: 32, h: 32 });
  // even a species that does not exist
  assert.deepEqual(KIT.pixels.validate(M.portrait('not-a-pokemon')), []);

  // the overworld icon is a 16×16 downscale of whatever we have
  for (const id of ['charizard', 'snorlax', 'not-a-pokemon']) {
    const icon = M.icon(id, 16);
    assert.deepEqual(KIT.pixels.dims(icon), { w: 16, h: 16 });
    assert.deepEqual(KIT.pixels.validate(icon), []);
  }
  // a shiny is the same drawing in different colours
  const shiny = M.shinyArt(drawn);
  assert.deepEqual(shiny.rows, drawn.rows);
  assert.notDeepEqual(shiny.palette, drawn.palette);
  assert.deepEqual(KIT.pixels.validate(shiny), []);

  // and a mon gets a real sprite entry so it can walk around
  const id = M.ensureSprite('snorlax', false);
  assert.equal(id, 'mon:snorlax');
  const def = KIT.registry('sprites').get(id);
  assert.equal(def.w, 16);
  assert.deepEqual(Object.keys(def.frames).sort(), ['down', 'left', 'up']);
  assert.equal(M.ensureSprite('snorlax', true), 'mon:snorlax:shiny');
});

// ---------------------------------------------------------------- the world
test('mons: walking in the tall grass meets somebody, and the garden fills up', async () => {
  for (const f of ['js/content/demo/project.js', 'js/content/demo/maps/home.js', 'js/content/demo/maps/lab.js', 'js/content/demo/maps/route.js', 'js/content/demo/maps/town.js', 'js/content/demo/maps/garden.js']) R(f);
  const { project: p } = KIT.project.normalize(KIT.project.fromContent('demo'));
  const fake = KIT.interpreter.fakeCtx({ project: p });
  const save = blankSave();
  for (const [k, v] of Object.entries(p.vars || {})) save.vars[k] = v.default;
  save.inventory = { pokeball: 9, berry: 3 };
  const world = KIT.world.create({
    project: p, save, rng: KIT.rng(5),
    ports: { io: fake.io, audio: fake.audio, screen: fake.screen, pictures: fake.pictures, game: fake.game, map: fake.map },
  });

  await world.enterMap('route', 3, 5, 'down');
  world.update(1 / 60);
  // A move only starts the step; the movement system finishes it. The walk is a
  // small circuit inside the near grass patch, so hero 2 (who trails behind and
  // is solid) is never standing where we want to go next.
  const walk = async (dir) => { await world.move(0, dir); for (let k = 0; k < 60 && world.hero().mover.moving; k++) world.update(1 / 60); await null; };
  const circuit = ['right', 'right', 'down', 'down', 'left', 'left', 'up', 'up'];
  const met = () => Object.keys(M.section(save).dex.seen || {}).length;
  for (let i = 0; i < 64 && !met(); i++) await walk(circuit[i % circuit.length]);
  const seen = Object.keys(M.section(save).dex.seen || {});
  assert.ok(seen.length >= 1, `met somebody in the grass: ${seen.join(', ')}`);
  for (const id of seen) assert.ok(M.encounterTable(world.map, p).byRegion['1'].some(e => e.id === id), `${id} is on region 1's table`);

  // the starter hook: the lab stands only set a variable, and that is enough
  KIT.commands.state.setVar(world.makeCtx(null, 'p1'), 'starter', 'pikachu');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(M.owns(M.section(save), 'pikachu'), true, 'choosing a starter really gives you one');
  assert.equal(M.section(save).party[0].friendship, 70);

  // ...and only once
  KIT.commands.state.setVar(world.makeCtx(null, 'p1'), 'starter', 'pikachu');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(M.section(save).party.filter(m => m.id === 'pikachu').length, 1);

  // the follower is a real entity behind the hero
  world.update(1 / 60);
  assert.ok(world.companion, 'somebody is walking behind you');
  assert.equal(world.companion.sprite, 'mon:pikachu');
  const before = { x: world.companion.x, y: world.companion.y };
  for (let i = 0; i < 4; i++) await walk('up');
  assert.notDeepEqual({ x: world.companion.x, y: world.companion.y }, before, 'and it follows');

  // the garden fills with everyone you own
  M.add(M.section(save), M.create({ uid: 'g1', id: 'mew', shiny: true, map: 'route', metAt: 'Route 1' }));
  await world.enterMap('garden', 7, 8, 'up');
  const garden = world.entities.filter(e => e.id.indexOf('mons-garden-') === 0);
  assert.equal(garden.length, 1, 'the one not already walking behind you is out there');
  assert.ok(garden.every(e => e.behaviour.kind === 'wander'), 'roaming, not standing');
  assert.ok(garden.every(e => e.page.on.interact[0].t === 'monCard'), 'and you can talk to them');
  assert.equal(garden[0].sprite, 'mon:mew:shiny', 'and the shiny one is drawn shiny');
  assert.ok(world.companion && world.companion.data.monUid !== garden[0].id.replace('mons-garden-', ''), 'the follower is not out there twice');

  // the project is never written to: the mons live in the map *view*
  assert.equal(p.maps.garden.objects.some(o => o.mons), false, 'the garden map itself is untouched');

  // the town's fenced corner is a garden too, without being a map of its own
  await world.enterMap('town', 12, 8, 'down');
  assert.equal(p.maps.town.objects.some(o => o.mons), false);
  const corner = world.entities.filter(e => e.id.indexOf('mons-garden-') === 0);
  assert.equal(corner.length, 1, 'out in the town garden as well');
  for (const e of corner) assert.equal(world.map.region(e.x, e.y), 3, 'inside the fence');

  // and a map that is not a garden has none of them
  await world.enterMap('lab', 7, 8, 'up');
  assert.equal(world.entities.filter(e => e.id.indexOf('mons-garden-') === 0).length, 0);
});

test('mons: a session gap gives everyone a little something, once', () => {
  const p = project();
  const save = blankSave();
  const s = M.section(save);
  M.add(s, M.create({ uid: 'a', id: 'pikachu', friendship: 100 }));
  s.lastSeenAt = new Date(Date.now() - 30 * 3600 * 1000).toISOString();

  const world = KIT.world.create({ project: Object.assign({}, p, { maps: {} }), save, rng: KIT.rng(1), ports: {} });
  let heard = null;
  world.events.on('sessionResumed', (e) => { heard = e; });
  M._install(world);
  assert.equal(heard, null, 'install waits: a module that owns the clock announces the gap first');
  M._settleAway(world);
  assert.ok(heard && heard.elapsedMs > 24 * 3600 * 1000, 'nobody did, so the world hears about it from us');
  assert.equal(M.read(save).party[0].friendship, 104);
  assert.ok(s.lastSeenAt, 'and the clock is reset, so it does not pay twice');
  assert.ok(M.elapsedSince(s, Date.now()) < 5000);
  M._settleAway(world);
  assert.equal(M.read(save).party[0].friendship, 104, 'and it is paid exactly once');
});

test('mons: when another module owns the clock, the gap is announced once, by them', () => {
  const p = project();
  const save = blankSave();
  const s = M.section(save);
  M.add(s, M.create({ uid: 'a', id: 'pikachu', friendship: 100 }));
  save.clock = { day: 1, minutes: 480, lastSeenAt: new Date(Date.now() - 30 * 3600 * 1000).toISOString() };

  const world = KIT.world.create({ project: Object.assign({}, p, { maps: {} }), save, rng: KIT.rng(1), ports: {} });
  const heard = [];
  world.events.on('sessionResumed', (e) => heard.push(e));
  M._install(world);
  // Somebody else (the home module, in the demo) owns the clock and says so.
  world._sessionResumed = true;
  world.events.emit('sessionResumed', { elapsedMs: 30 * 3600 * 1000, minutesAdded: 1800 });
  M._settleAway(world);
  assert.equal(heard.length, 1, 'said once, by the module that owns the clock');
  assert.equal(M.read(save).party[0].friendship, 104, 'and we still pay the away bonus');
});
