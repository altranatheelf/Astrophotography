'use strict';
// What happened: the history of one run.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('./_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));
R('js/kit/core/storage.js'); R('js/kit/world/log.js');
const H = KIT.history;

const save = () => ({ clock: { day: 1, minutes: 480 }, dimension: null });

test('history: a thing that happened can be asked about afterwards', () => {
  const s = save();
  assert.equal(H.has(s, 'ate'), false, 'nothing has happened yet');
  H.add(s, 'ate', { what: 'bread' });
  assert.equal(H.has(s, 'ate'), true, 'and then it has');
  assert.equal(H.has(s, { verb: 'ate', what: 'bread' }), true, 'narrowed to the thing');
  assert.equal(H.has(s, { verb: 'ate', what: 'pie' }), false, 'and not to a different thing');
});

test('history: counting is exact, and says so', () => {
  const s = save();
  for (let i = 0; i < 5; i++) H.add(s, 'knocked', { what: 'door' });
  assert.equal(H.count(s, 'knocked'), 5);
  assert.equal(H.count(s, { verb: 'knocked', what: 'door' }), 5);
  assert.equal(H.exact({ verb: 'knocked' }), true, 'a verb question is exact forever');
  assert.equal(H.exact({ verb: 'knocked', where: 'diner' }), false,
    'a question about WHERE is only exact within the window, and admits it');
});

test('history: the count stays true after the window has thrown the entries away', () => {
  const s = save();
  const many = H.WINDOW + 50;
  for (let i = 0; i < many; i++) H.add(s, 'stepped');
  assert.equal(H.count(s, 'stepped'), many, 'every one is counted');
  assert.equal(H.of(s).entries.length, H.WINDOW, 'but only the window is kept');
  assert.equal(H.seq(s), many, 'and the sequence knows how many there really were');
  // This is the whole design: a save is JSON, so the list is bounded and the
  // tally is not. `has`/`count` are true for the life of the game; `last`/`all`
  // see the recent past.
  assert.equal(H.all(s, 'stepped').length, H.WINDOW);
});

test('history: an entry records where and when, not just what', () => {
  const s = { clock: { day: 3, minutes: 600 }, dimension: 'hollow' };
  const e = H.add(s, 'listened', { what: 'the-radio', where: 'pier' });
  assert.equal(e.where, 'pier');
  assert.equal(e.layer, 'hollow', 'including which layer of reality you were in');
  assert.equal(e.at, (3 - 1) * 1440 + 600, 'in in-game minutes, which is the clock an author thinks in');
  assert.equal(e.n, 1, 'and in order');
});

test('history: no wall-clock time is stored', () => {
  const s = save();
  const e = H.add(s, 'did');
  const text = JSON.stringify(e);
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(text),
    'a real-world timestamp is not the same number on two devices, and leaks when somebody played');
});

test('history: last() answers "when did you, and where"', () => {
  const s = save();
  H.add(s, 'slept', { where: 'home' });
  s.clock.day = 2;
  H.add(s, 'slept', { where: 'diner' });
  const l = H.last(s, 'slept');
  assert.equal(l.where, 'diner', 'the most recent one');
  assert.equal(H.last(s, 'flown'), null, 'and nothing for something that never happened');
});

test('history: queries narrow on who, where and which layer', () => {
  const s = save();
  H.add(s, 'saw', { what: 'the-light', where: 'pier', who: 'p1', layer: null });
  H.add(s, 'saw', { what: 'the-light', where: 'pier', who: 'p1', layer: 'hollow' });
  assert.equal(H.count(s, { verb: 'saw', layer: 'hollow' }), 1, 'only the one in the hollow');
  assert.equal(H.count(s, { verb: 'saw', where: 'pier' }), 2, 'both were on the pier');
  assert.equal(H.count(s, { verb: 'saw', where: 'diner' }), 0);
});

test('history: a garbled section repairs itself rather than throwing', () => {
  const s = Object.assign(save(), { log: { n: 'nonsense', entries: 'not an array', tally: 7 } });
  H.add(s, 'did');
  assert.equal(H.count(s, 'did'), 1, 'a save mangled by a bad migration still works');
  assert.ok(Array.isArray(H.of(s).entries));
});

test('history: an empty verb records nothing', () => {
  const s = save();
  assert.equal(H.add(s, ''), null);
  assert.equal(H.add(s, null), null);
  assert.equal(H.seq(s), 0);
});

test('history: across runs is opt-in, one fact at a time', async () => {
  KIT.storage.forceAdapter = 'memory';
  await KIT.storage.ready();
  KIT.storage.projectId('hist');
  const s = save();
  H.add(s, 'sold', { what: 'the-soul' });
  assert.equal(H.everDid('sold', 'the-soul'), 0, 'the run does not leak into the player by itself');
  H.promote(s, 'sold', 'the-soul');
  assert.equal(H.everDid('sold', 'the-soul'), 1,
    'it is carried over deliberately — what survives a reset is authored, not a side effect');
  const nextRun = save();
  assert.equal(H.has(nextRun, 'sold'), false, 'and the new run starts clean');
  assert.equal(H.everDid('sold', 'the-soul'), 1, 'while the player is still remembered');
});

test('history: the text tags read the count out of the run and out of the player', async () => {
  KIT.storage.forceAdapter = 'memory';
  await KIT.storage.ready();
  KIT.storage.projectId('hist2');
  const s = save();
  for (let i = 0; i < 3; i++) H.add(s, 'asked', { what: 'again' });
  H.promote(s, 'asked', 'again');
  const ctx = { save: s };
  assert.equal(KIT.text.plain('{did:asked}', ctx), '3');
  assert.equal(KIT.text.plain('{did:asked/again}', ctx), '3');
  assert.equal(KIT.text.plain('{did:never}', ctx), '0', 'and something that never happened is zero, not blank');
  assert.equal(KIT.text.plain('{ever:asked/again}', ctx), '3');
});
