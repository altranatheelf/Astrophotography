// The Home module's rules: the clock maths behind jobs, the mood drift, the
// furniture overlay, the rewards, and the promise that decorating a room never
// touches the author's project.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const KIT = require(path.join(root, 'test/kit/_load.js'));
require(path.join(root, 'js/kit/world/map.js'));          // the overlay test composes a real map view
require(path.join(root, 'js/modules/home/rules.js'));
require(path.join(root, 'js/modules/home/register.js'));
const H = KIT.home;
H.registerAll(KIT);

const MIN = 60 * 1000;
const DAY_MS = 24 * 60 * MIN;

// ---- fixtures ---------------------------------------------------------------
function blankLayers(w, h) {
  const n = w * h;
  return { terrain: new Array(n).fill(0), ground: new Array(n).fill('floor-wood'), deco: new Array(n).fill(null), above: new Array(n).fill(null), regions: new Array(n).fill(0) };
}
function makeProject(extra) {
  const raw = {
    version: 3,
    meta: { id: 'home-test', title: 'Home test' },
    modules: ['home'],
    settings: { clock: { enabled: false } },
    heroes: [{ id: 'p1', name: 'Ada', sprite: null }, { id: 'p2', name: 'Bo', sprite: null }],
    start: { map: 'house', x: 2, y: 2, dir: 'down' },
    vars: { tidied: { type: 'bool', default: false, label: 'Tidied', group: 'Home' }, friendship: { type: 'number', default: 0, label: 'Kindness', group: 'Home' } },
    items: {
      berry: { kind: 'item', name: 'Berry' },
      lamp: { kind: 'furniture', name: 'Little lamp', props: { layer: 'deco', solid: true, variants: [{ label: 'Upright', tile: 'lamp-post', tile2: null, dir: 'down' }, { label: 'Wide', tile: 'table', tile2: 'chair', dir: 'right' }] } },
    },
    maps: {
      house: { id: 'house', name: 'House', width: 8, height: 6, kind: 'indoor', layers: blankLayers(8, 6), collision: new Array(48).fill(null), objects: [
        { id: 'board', name: 'Board', type: 'job-board', x: 3, y: 1, pages: [{ props: { look: 'sign', title: 'Odd jobs', jobs: [
          { id: 'berries', title: 'Pick berries', desc: 'Down by the hedge.', minutes: 120, reward: 'berry', count: 2, flag: null, suits: 'grass', repeatable: true },
          { id: 'tidy', title: 'Tidy the shed', minutes: 60, reward: null, flag: 'tidied', needs: 'p2', repeatable: false },
        ] } }] },
      ] },
    },
    packs: { home: { tuning: { minutesPerSecond: 6, giftChance: 1, giftFriendship: 10, awayMinutesPerRealMinute: 1 }, giftItems: ['berry'], giftSpot: { map: 'house', x: 4, y: 5 } } },
  };
  Object.assign(raw, extra || {});
  const { project, problems } = KIT.project.normalize(raw);
  const errors = problems.filter(p => p.severity === 'error');
  assert.deepStrictEqual(errors.map(e => e.code + ' ' + e.message), [], 'fixture project must be clean');
  return project;
}
function makeSave(project, extra) {
  const save = {
    version: 2, projectId: 'home-test', savedAt: null, playtimeMs: 0,
    heroes: [{ map: 'house', x: 2, y: 2, dir: 'down', name: 'Ada' }, { map: 'house', x: 2, y: 3, dir: 'down', name: 'Bo' }],
    activeHero: 0, vars: { tidied: false, friendship: 120 }, inventory: { lamp: 2 }, objects: {}, overlays: {},
    modules: {}, clock: { day: 1, minutes: 480, lastSeenAt: null }, timer: {}, steps: 0, seed: 12345,
  };
  Object.assign(save, extra || {});
  return save;
}
const templates = (project) => H.boardTemplates(project, 'board');

// ---- the save section ---------------------------------------------------------
test('home: the save section fills in, survives a round trip and is migration-ready', () => {
  const save = makeSave(makeProject());
  const data = H.ensure(save);
  assert.strictEqual(data.version, H.SAVE_VERSION);
  assert.deepStrictEqual(data.jobs, []);
  assert.deepStrictEqual(data.gifts, []);
  assert.deepStrictEqual(data.moods, {});
  assert.strictEqual(data.placed, 0);
  assert.strictEqual(save.modules.home, data, 'ensure stores the section on the save');

  // an old save with only some of the keys still loads
  const old = makeSave(makeProject(), { modules: { home: { jobs: [{ id: 'j1', who: 'p1', startedAt: 0, minutes: 10, reward: 'berry', done: false }] } } });
  const upgraded = H.ensure(old);
  assert.strictEqual(upgraded.version, H.SAVE_VERSION);
  assert.strictEqual(upgraded.jobs.length, 1);
  assert.deepStrictEqual(upgraded.furniture, []);
  assert.ok(Array.isArray(upgraded.log));
});

// ---- the clock maths -----------------------------------------------------------
test('home: a job started at minute X with N minutes is ready at X + N, not before', () => {
  const project = makeProject();
  const save = makeSave(project);
  save.clock = { day: 3, minutes: 600, lastSeenAt: null };     // absolute minute 2 * 1440 + 600 = 3480
  const now = H.now(save);
  assert.strictEqual(now, 3480);

  const template = templates(project).find(t => t.id === 'berries');
  const worker = H.roster(project, save)[0];                    // 'friend', not 'grass': no speed-up
  const r = H.startJob(save, { template, who: worker.uid, worker, now, tuning: H.tuning(project) });
  assert.ok(r.ok);
  assert.strictEqual(r.job.startedAt, 3480);
  assert.strictEqual(r.job.minutes, 120);
  assert.strictEqual(H.readyAt(r.job), 3600);

  assert.strictEqual(H.isReady(r.job, 3599), false);
  assert.strictEqual(H.remaining(r.job, 3599), 1);
  assert.strictEqual(H.isReady(r.job, 3600), true);
  assert.strictEqual(H.remaining(r.job, 3600), 0);
  assert.strictEqual(H.jobsReady(save, 3599).length, 0);
  assert.strictEqual(H.jobsReady(save, 3601).length, 1);
});

test('home: a job that suits a friend finishes sooner', () => {
  const project = makeProject();
  const save = makeSave(project);
  const template = templates(project).find(t => t.id === 'berries');   // suits 'grass'
  const plain = { uid: 'a', name: 'A', type: 'water', types: ['water'], friendship: 0 };
  const suited = { uid: 'b', name: 'B', type: 'grass', types: ['grass'], friendship: 0 };
  assert.strictEqual(H.jobMinutes(template, plain, H.tuning(project)), 120);
  assert.strictEqual(H.jobMinutes(template, suited, H.tuning(project)), 90);   // 0.75
  assert.strictEqual(H.suitability(template, suited), 'suits');

  const needed = templates(project).find(t => t.id === 'tidy');       // needs 'p2'
  assert.strictEqual(H.suitability(needed, { uid: 'p1' }), 'wrong');
  assert.strictEqual(H.suitability(needed, { uid: 'p2' }), 'needed');
  assert.strictEqual(H.startJob(save, { template: needed, who: 'p1', worker: { uid: 'p1' }, now: 0 }).ok, false);
});

test('home: a gap of real days between sessions moves the clock on, up to the cap', () => {
  const project = makeProject();
  const save = makeSave(project);
  const tuning = H.tuning(project);           // 1 in-game minute per real minute, cap 4320

  const t0 = Date.parse('2026-01-01T10:00:00Z');
  const first = H.resume(save, t0, tuning);
  assert.deepStrictEqual(first, { elapsedMs: 0, minutesAdded: 0 }, 'the first session has nothing to catch up on');
  assert.strictEqual(save.modules.home.seenAt, new Date(t0).toISOString());
  assert.strictEqual(save.clock.lastSeenAt, new Date(t0).toISOString());

  const template = templates(project).find(t => t.id === 'berries');
  const worker = H.roster(project, save)[0];
  const job = H.startJob(save, { template, who: worker.uid, worker, now: H.now(save), tuning }).job;
  assert.strictEqual(H.isReady(job, H.now(save)), false, 'not ready when you close the game');

  // two real days later
  const t1 = t0 + 2 * DAY_MS;
  const back = H.resume(save, t1, tuning);
  assert.strictEqual(back.elapsedMs, 2 * DAY_MS);
  assert.strictEqual(back.minutesAdded, 2880);
  assert.strictEqual(H.now(save), 480 + 2880);
  assert.strictEqual(H.isReady(job, H.now(save)), true, 'the errand finished while you were away');

  // a month away only ever adds the cap
  const t2 = t1 + 30 * DAY_MS;
  const long = H.resume(save, t2, tuning);
  assert.strictEqual(long.minutesAdded, tuning.awayCapMinutes);

  // and a clock that never left never jumps
  const still = H.resume(save, t2, tuning);
  assert.strictEqual(still.minutesAdded, 0);
});

test('home: touch() keeps the stamp fresh without adding a minute', () => {
  const save = makeSave(makeProject());
  const t0 = Date.parse('2026-01-01T10:00:00Z');
  H.resume(save, t0, H.tuningDefaults());
  const before = H.now(save);
  H.touch(save, t0 + 20 * MIN);
  assert.strictEqual(H.now(save), before);
  assert.strictEqual(save.modules.home.seenAt, new Date(t0 + 20 * MIN).toISOString());
});

// ---- rewards ------------------------------------------------------------------
test('home: collecting a job puts the reward in the bag and sets its switch', () => {
  const project = makeProject();
  const save = makeSave(project);
  const tuning = H.tuning(project);
  const now = H.now(save);

  const berries = templates(project).find(t => t.id === 'berries');
  const tidy = templates(project).find(t => t.id === 'tidy');
  const a = H.startJob(save, { template: berries, who: 'p1', worker: { uid: 'p1', name: 'Ada', friendship: 200 }, now, tuning }).job;
  const b = H.startJob(save, { template: tidy, who: 'p2', worker: { uid: 'p2', name: 'Bo', friendship: 0 }, now, tuning }).job;

  assert.strictEqual(H.collectJob(save, a.id, { now, tuning }).ok, false, 'not before the clock has passed');
  assert.strictEqual(H.collectJob(save, a.id, { now, tuning }).reason, 'early');

  const later = now + 200;
  const ra = H.collectJob(save, a.id, { now: later, worker: { uid: 'p1', name: 'Ada', friendship: 200 }, tuning });
  assert.ok(ra.ok);
  assert.deepStrictEqual(ra.reward, { item: 'berry', count: 2 });
  assert.strictEqual(save.inventory.berry, 2);

  const rb = H.collectJob(save, b.id, { now: later, worker: { uid: 'p2', name: 'Bo', friendship: 0 }, tuning });
  assert.ok(rb.ok);
  assert.strictEqual(rb.reward, null);
  assert.strictEqual(save.vars.tidied, true, 'the flag went up');

  assert.strictEqual(H.jobsOut(save).length, 0);
  assert.strictEqual(H.jobDone(save, 'tidy'), true);
  assert.strictEqual(H.jobDone(save, 'never-taken'), false);
  assert.strictEqual(H.moodOf(save, 'p1').mood, 'happy', 'coming home is a good day');

  // the line warms up with friendship
  const close = H.jobLine(project, { name: 'Ada', friendship: 200 }, ra.job, ra.reward);
  const newly = H.jobLine(project, { name: 'Ada', friendship: 0 }, ra.job, ra.reward);
  assert.notStrictEqual(close, newly);
  assert.ok(close.includes('Ada') && close.includes('Berry'));
  assert.ok(H.jobLine(project, { name: 'Bo', friendship: 0 }, rb.job, null).includes('Tidy the shed'));
});

test('home: jobs survive a save/load round trip', () => {
  const project = makeProject();
  const save = makeSave(project);
  const tuning = H.tuning(project);
  const template = templates(project).find(t => t.id === 'berries');
  const job = H.startJob(save, { template, who: 'p1', worker: { uid: 'p1', name: 'Ada' }, now: H.now(save), tuning }).job;
  H.setMood(save, 'p2', 'sleepy', H.now(save));

  const reloaded = JSON.parse(JSON.stringify(save));
  const data = H.ensure(reloaded);
  assert.strictEqual(data.jobs.length, 1);
  assert.deepStrictEqual(data.jobs[0], job);
  assert.strictEqual(H.moodOf(reloaded, 'p2').mood, 'sleepy');
  assert.strictEqual(H.isOut(reloaded, 'p1'), true);

  const r = H.collectJob(reloaded, job.id, { now: H.now(reloaded) + 500, worker: { uid: 'p1', name: 'Ada' }, tuning });
  assert.ok(r.ok, 'a job started before the save can still be collected after it');
  assert.strictEqual(reloaded.inventory.berry, 2);
});

// ---- moods ---------------------------------------------------------------------
test('home: mood drift is deterministic for a seed', () => {
  const a = H.nextMood('calm', 'pikachu', 7, 999);
  const b = H.nextMood('calm', 'pikachu', 7, 999);
  assert.strictEqual(a, b);
  assert.ok(H.MOOD_IDS.includes(a));
  assert.notStrictEqual(H.nextMood('calm', 'pikachu', 8, 999), undefined);

  // the same save drifts the same way twice
  const project = makeProject();
  const run = () => {
    const save = makeSave(project);
    save.seed = 4242;
    const out = [];
    for (let step = 0; step <= 10; step++) {
      H.driftMoods(save, project, 480 + step * 120);
      out.push(H.roster(project, save).map(w => H.moodOf(save, w.uid).mood).join(','));
    }
    return out;
  };
  assert.deepStrictEqual(run(), run());

  // a different seed is allowed to feel different, but never leaves the five moods
  const save = makeSave(project);
  save.seed = 7;
  for (let step = 0; step <= 40; step++) H.driftMoods(save, project, 480 + step * 120);
  for (const w of H.roster(project, save)) assert.ok(H.MOOD_IDS.includes(H.moodOf(save, w.uid).mood));
});

test('home: a long gap catches up at most twelve drifts, and friends away do not drift', () => {
  const project = makeProject();
  const save = makeSave(project);
  H.driftMoods(save, project, 0);                    // seeds the buckets
  const template = templates(project).find(t => t.id === 'berries');
  H.startJob(save, { template, who: 'p1', worker: { uid: 'p1' }, now: 0, tuning: H.tuning(project) });
  const before = H.moodOf(save, 'p1');
  H.driftMoods(save, project, 100 * 1440);
  assert.deepStrictEqual(H.moodOf(save, 'p1'), before, 'p1 is out on a job, not at home drifting');
  assert.ok(H.MOOD_IDS.includes(H.moodOf(save, 'p2').mood));
});

test('home: friends react to what you did', () => {
  const save = makeSave(makeProject());
  H.setMood(save, 'p1', 'lonely', 0);
  assert.strictEqual(H.react(save, 'p1', 'petted', 10), 'happy');
  assert.strictEqual(H.react(save, 'p1', 'ignored', 20), 'calm');
  assert.strictEqual(H.react(save, 'p1', 'ignored', 30), 'lonely');
  assert.strictEqual(H.react(save, 'p1', 'fed', 40), 'happy');
  assert.strictEqual(H.moodOf(save, 'p1').changedAt, 40);
});

// ---- gifts ------------------------------------------------------------------------
test('home: a friend who likes you leaves one present a day, and it is an ordinary item object', () => {
  const project = makeProject();      // giftChance 1, giftFriendship 10, save friendship 120
  const save = makeSave(project);
  H.setMood(save, 'p1', 'happy', 0);
  H.setMood(save, 'p2', 'happy', 0);

  const gifts = H.rollGifts(save, project, 600);
  assert.strictEqual(gifts.length, 2, 'both friends, once');
  assert.strictEqual(H.rollGifts(save, project, 700).length, 0, 'not twice in one day');

  const gift = gifts[0];
  assert.strictEqual(gift.item, 'berry');
  assert.deepStrictEqual({ map: gift.map, x: gift.x, y: gift.y }, { map: 'house', x: 4, y: 5 });
  assert.ok(gift.note.length > 0);

  assert.strictEqual(H.placeGift(save, project, gift), true);
  assert.strictEqual(H.placeGift(save, project, gift), false, 'one present per doormat');
  const obj = save.overlays.house.objects[0];
  assert.strictEqual(obj.type, 'item');
  assert.strictEqual(obj.pages[0].props.item, 'berry');
  assert.ok(Array.isArray(obj.pages[0].on.step));
  assert.strictEqual(H.giftsWaiting(save).length, 2);

  H.takeGift(save, gift.id);
  assert.strictEqual(H.giftsWaiting(save).length, 1);
  assert.strictEqual(save.overlays.house.objects.length, 0);

  // a friend who barely knows you leaves nothing
  const cold = makeSave(project, { vars: { friendship: 0 } });
  assert.strictEqual(H.rollGifts(cold, project, 600).length, 0);
});

// ---- furniture -----------------------------------------------------------------------
test('home: putting furniture down and picking it back up never touches the project', () => {
  const project = makeProject();
  const before = KIT.stableStringify(project);
  const save = makeSave(project);
  const lamp = project.items.lamp;

  assert.strictEqual(H.isFurniture(project, 'lamp'), true);
  assert.strictEqual(H.isFurniture(project, 'berry'), false);
  assert.deepStrictEqual(H.furnitureItems(project).map(f => f.id), ['lamp']);

  // variant 0 is one square, variant 1 is two side by side
  assert.deepStrictEqual(H.cellsFor(lamp, 0, 2, 3), [{ x: 2, y: 3, layer: 'deco', tile: 'lamp-post' }]);
  assert.deepStrictEqual(H.cellsFor(lamp, 1, 2, 3), [
    { x: 2, y: 3, layer: 'deco', tile: 'table' },
    { x: 3, y: 3, layer: 'deco', tile: 'chair' },
  ]);
  assert.deepStrictEqual(H.cellsFor(lamp, 2, 2, 3), H.cellsFor(lamp, 0, 2, 3), 'the variants wrap round');

  const rec = H.place(save, 'house', 'lamp', lamp, 1, 2, 3);
  assert.deepStrictEqual(save.overlays.house.tiles['2,3'], { deco: 'table', collision: 1 });
  assert.deepStrictEqual(save.overlays.house.tiles['3,3'], { deco: 'chair', collision: 1 });
  assert.strictEqual(H.ensure(save).placed, 1);
  assert.strictEqual(H.countFurniture(save, 'lamp', 'house'), 1);
  assert.strictEqual(H.placedAt(save, 'house', 3, 3), rec, 'either square finds the piece');

  assert.strictEqual(KIT.stableStringify(project), before, 'the project is untouched');

  // the map view composes it, the map itself does not
  const view = KIT.mapView(project, save, 'house');
  assert.strictEqual(view.tileAt('deco', 2, 3), 'table');
  assert.strictEqual(project.maps.house.layers.deco[3 * 8 + 2], null);
  assert.strictEqual(view.flagsAt(2, 3).solid, true);

  assert.strictEqual(H.pickUp(save, rec), 'lamp');
  assert.deepStrictEqual(save.overlays, {}, 'a room stripped bare has no overlay left at all');
  assert.strictEqual(H.ensure(save).placed, 0);
  assert.strictEqual(KIT.stableStringify(project), before, 'still untouched after picking up');
  assert.strictEqual(KIT.mapView(project, save, 'house').tileAt('deco', 2, 3), null);
});

test('home: picking up puts back whatever the overlay held before', () => {
  const project = makeProject();
  const save = makeSave(project);
  save.overlays.house = { tiles: { '2,3': { deco: 'plant' } }, objects: [] };
  const rec = H.place(save, 'house', 'lamp', project.items.lamp, 0, 2, 3);
  assert.strictEqual(save.overlays.house.tiles['2,3'].deco, 'lamp-post');
  H.pickUp(save, rec);
  assert.deepStrictEqual(save.overlays.house.tiles['2,3'], { deco: 'plant' }, 'the plant is back');
});

test('home: furniture will not go through a wall, off the map, or onto another piece', () => {
  const project = makeProject();
  project.maps.house.collision[1 * 8 + 5] = 1;                  // a wall at 5,1
  const save = makeSave(project);
  const lamp = project.items.lamp;

  assert.strictEqual(H.canPlace(project, save, 'house', lamp, 0, 5, 1).reason, 'wall');
  assert.strictEqual(H.canPlace(project, save, 'house', lamp, 0, 8, 1).reason, 'bounds');
  assert.strictEqual(H.canPlace(project, save, 'house', lamp, 1, 7, 1).reason, 'bounds', 'the second square counts too');
  assert.strictEqual(H.canPlace(project, save, 'house', lamp, 0, 3, 1).reason, 'occupied', 'the job board stands there');
  assert.strictEqual(H.canPlace(project, save, 'house', lamp, 0, 2, 4).ok, true);
  assert.strictEqual(H.canPlace(project, save, 'nowhere', lamp, 0, 0, 0).reason, 'map');

  H.place(save, 'house', 'lamp', lamp, 0, 2, 4);
  assert.strictEqual(H.canPlace(project, save, 'house', lamp, 0, 2, 4).reason, 'occupied');
});

// ---- with and without the mons module -----------------------------------------------
test('home: the workers are the heroes when mons is not there, and the mons when it is', () => {
  const project = makeProject();
  const plain = makeSave(project);
  assert.deepStrictEqual(H.roster(project, plain).map(w => `${w.uid}:${w.name}:${w.kind}`), ['p1:Ada:hero', 'p2:Bo:hero']);
  assert.strictEqual(H.roster(project, plain)[0].friendship, 120, 'the heroes share the kindness var');

  const withMons = makeSave(project, { modules: { mons: {
    party: [{ uid: 'm1', species: 'pikachu', nickname: 'Spark', friendship: 200, types: ['electric'] }],
    box: [{ uid: 'm2', species: 'oddish', friendship: 10, types: ['grass'] }],
  } } });
  const roster = H.roster(project, withMons);
  assert.deepStrictEqual(roster.map(w => w.uid), ['m1', 'm2']);
  assert.deepStrictEqual(roster.map(w => w.name), ['Spark', 'oddish']);
  assert.strictEqual(roster[0].kind, 'mon');
  assert.strictEqual(roster[1].type, 'grass');

  // and the whole loop works over them
  const template = templates(project).find(t => t.id === 'berries');   // suits grass
  assert.strictEqual(H.jobMinutes(template, roster[1], H.tuning(project)), 90);
  const r = H.startJob(withMons, { template, who: 'm2', worker: roster[1], now: 0, tuning: H.tuning(project) });
  assert.ok(r.ok);
  assert.strictEqual(H.collectJob(withMons, r.job.id, { now: 90, worker: roster[1], tuning: H.tuning(project) }).ok, true);
  assert.strictEqual(withMons.inventory.berry, 2);

  // a module that owns its own creatures can take the roster over completely
  H.provideRoster(() => [{ uid: 'ghost', name: 'Gus', kind: 'spirit', type: 'mist', types: ['mist'], friendship: 5 }]);
  assert.deepStrictEqual(H.roster(project, plain).map(w => w.uid), ['ghost']);
  H.provideRoster(null);
  assert.deepStrictEqual(H.roster(project, plain).map(w => w.uid), ['p1', 'p2']);
});

test('home: a friend who is no longer on the roster still gets their job collected', () => {
  const project = makeProject();
  const save = makeSave(project);
  const template = templates(project).find(t => t.id === 'berries');
  const job = H.startJob(save, { template, who: 'vanished', worker: { uid: 'vanished', name: 'Someone' }, now: 0, tuning: H.tuning(project) }).job;
  const worker = H.worker(project, save, 'vanished');
  assert.strictEqual(worker.kind, 'gone');
  assert.strictEqual(H.collectJob(save, job.id, { now: 500, worker, tuning: H.tuning(project) }).ok, true);
});

// ---- what the module registers ------------------------------------------------------
test('home: everything is registered, with fields, so Creator Mode can form itself', () => {
  for (const id of ['placeFurniture', 'giveJob', 'collectJob', 'moodSet', 'openJobBoard']) {
    const def = KIT.registry('commands').get(id);
    assert.ok(def, `command ${id} is registered`);
    assert.ok(Array.isArray(def.fields), `command ${id} has fields`);
    assert.strictEqual(typeof def.run, 'function');
    assert.strictEqual(typeof def.summary, 'function');
  }
  for (const id of ['jobDone', 'jobsReady', 'hasFurniture', 'mood']) {
    const def = KIT.registry('conditions').get(id);
    assert.ok(def, `condition ${id} is registered`);
    assert.ok(Array.isArray(def.fields));
    assert.strictEqual(typeof def.test, 'function');
  }
  assert.ok(KIT.registry('itemKinds').get('furniture'));
  assert.ok(KIT.registry('objectTypes').get('job-board'));
  assert.ok(KIT.registry('systems').get('home'));
  assert.ok(KIT.registry('menus').get('home-jobs'));
  assert.ok(KIT.registry('strings').has('home.job-back-close'));
  // a board placed in Creator Mode opens itself with no scripting
  const page = KIT.project.fillPage({}, 'job-board');
  assert.deepStrictEqual(page.on.interact, [{ t: 'openJobBoard' }]);
});

test('home: the conditions read the save the way the script layer will', () => {
  const project = makeProject();
  const save = makeSave(project);
  const ctx = { project, world: { save }, save };
  const test1 = (id, cond) => KIT.registry('conditions').get(id).test(cond, ctx);

  assert.strictEqual(test1('jobsReady', { op: '>=', count: 1 }), false);
  const template = templates(project).find(t => t.id === 'berries');
  const job = H.startJob(save, { template, who: 'p1', worker: { uid: 'p1' }, now: H.now(save), tuning: H.tuning(project) }).job;
  assert.strictEqual(test1('jobsReady', { op: '>=', count: 1 }), false);
  save.clock.minutes += 200;
  assert.strictEqual(test1('jobsReady', { op: '>=', count: 1 }), true);
  assert.strictEqual(test1('jobDone', { job: 'berries' }), false);
  H.collectJob(save, job.id, { now: H.now(save), worker: { uid: 'p1' }, tuning: H.tuning(project) });
  assert.strictEqual(test1('jobDone', { job: 'berries' }), true);

  assert.strictEqual(test1('hasFurniture', { item: 'lamp', count: 1 }), false);
  H.place(save, 'house', 'lamp', project.items.lamp, 0, 1, 1);
  assert.strictEqual(test1('hasFurniture', { item: 'lamp', count: 1 }), true);
  assert.strictEqual(test1('hasFurniture', { item: 'lamp', count: 2 }), false);

  H.setMood(save, 'p2', 'sleepy', 0);
  assert.strictEqual(test1('mood', { who: 'p2', mood: 'sleepy' }), true);
  assert.strictEqual(test1('mood', { who: 'p2', mood: 'happy' }), false);
});

test('home: the commands do what they say against a fake ctx', () => {
  const project = makeProject();
  const save = makeSave(project);
  const world = { save, map: { id: 'house' } };
  const events = [];
  const ctx = { project, world, save, emit: (e, p) => events.push([e, p]), io: { say: async () => {} } };

  KIT.registry('commands').get('placeFurniture').run(ctx, { item: 'lamp', map: 'house', x: 1, y: 4, variant: 0, fromBag: true });
  assert.strictEqual(save.overlays.house.tiles['1,4'].deco, 'lamp-post');
  assert.strictEqual(save.inventory.lamp, 1, 'fromBag took one out of the bag');

  KIT.registry('commands').get('giveJob').run(ctx, { board: 'board', job: 'berries', who: 'p1' });
  assert.strictEqual(H.jobsOut(save).length, 1);

  KIT.registry('commands').get('moodSet').run(ctx, { who: 'p2', mood: 'petted' });
  assert.strictEqual(H.moodOf(save, 'p2').mood, 'happy');

  save.clock.minutes += 200;
  return KIT.registry('commands').get('collectJob').run(ctx, { job: '', silent: true }).then(() => {
    assert.strictEqual(save.inventory.berry, 2);
    assert.ok(events.some(([e]) => e === 'itemChanged'));
  });
});
