// The cast: who is in the story, what they know, and how they feel about each
// other. The point of all three is that a line can change because of something
// that happened three scenes ago, without anybody counting switches by hand.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('./_load.js');
const C = KIT.cast;

function project(extra) {
  const raw = Object.assign({
    version: 3, meta: { id: 'cast-test' },
    heroes: [{ id: 'p1', name: 'You' }],
    maps: { a: {} },
    facts: {
      'the-door': { label: 'The door in the orchard' },
      'the-name': { label: 'What the house was called before', secret: true },
    },
    cast: {
      wren: { name: 'Wren', pronouns: 'she/her', knows: ['the-door'], feels: { mira: 30 }, met: true },
      mira: { name: 'Mira', pronouns: 'they/them' },
      the_aunt: { name: 'The Aunt', knows: ['the-name'] },
    },
  }, extra || {});
  const { project: p, problems } = KIT.project.normalize(raw);
  assert.deepEqual(problems.filter(x => x.severity === 'error'), [], JSON.stringify(problems, null, 1));
  return p;
}
const fresh = (p) => C.start(p, { vars: {}, clock: { day: 1, minutes: 480 } });

test('cast: the project carries people and facts, with their defaults filled in', () => {
  const p = project();
  assert.equal(p.cast.wren.name, 'Wren');
  assert.equal(p.cast.wren.pronouns, 'she/her');
  assert.deepEqual(p.cast.wren.knows, ['the-door']);
  assert.deepEqual(p.cast.wren.feels, { mira: 30 });
  assert.equal(p.cast.mira.met, false, 'not met unless the project says so');
  assert.equal(p.facts['the-name'].secret, true);
  assert.equal(p.facts['the-door'].label, 'The door in the orchard');

  // an id with no name gets a readable one rather than nothing
  const q = project({ cast: { the_boy: {} }, facts: { 'a-thing': {} } });
  assert.equal(q.cast.the_boy.name, 'The Boy');
  assert.equal(q.facts['a-thing'].label, 'A Thing');
});

test('cast: the save starts from the project and everything after is the save’s', () => {
  const p = project();
  const save = fresh(p);
  assert.deepEqual(C.known(save, 'wren'), ['the-door'], 'she starts knowing it');
  assert.equal(C.feels(save, 'wren', 'mira'), 30);
  assert.equal(C.met(save, 'wren'), true);
  assert.equal(C.met(save, 'mira'), false);
  assert.deepEqual(C.known(save, 'mira'), []);

  // starting twice does not undo what has happened since
  C.feel(save, 'wren', 'mira', -50);
  C.tell(save, 'mira', 'the-door', { from: 'wren' });
  C.start(p, save);
  assert.equal(C.feels(save, 'wren', 'mira'), -20, 'the falling-out stands');
  assert.deepEqual(C.known(save, 'mira'), ['the-door']);

  // and the project itself is never written to
  assert.deepEqual(p.cast.wren.feels, { mira: 30 });
});

test('cast: telling somebody something, and who told them', () => {
  const p = project();
  const save = fresh(p);
  save.clock = { day: 2, minutes: 600 };

  assert.equal(C.tell(save, 'mira', 'the-door', { from: 'wren' }), true, 'it is news');
  assert.equal(C.tell(save, 'mira', 'the-door', { from: 'the_aunt' }), false, 'she already knew');
  const k = C.knows(save, 'mira', 'the-door');
  assert.equal(k.from, 'wren', 'and it stays the first person who said it');
  assert.equal(k.at, 1440 + 600, 'stamped with the in-game minute');

  assert.equal(C.knows(save, 'mira', 'the-name'), null);
  assert.deepEqual(C.whoKnows(p, save, 'the-door'), ['wren', 'mira'], 'in cast order');
  assert.deepEqual(C.whoKnows(p, save, 'the-name'), ['the_aunt']);
  assert.deepEqual(C.whoKnows(p, save, 'nothing-at-all'), []);

  // forgetting
  assert.equal(C.forget(save, 'mira', 'the-door'), true);
  assert.equal(C.forget(save, 'mira', 'the-door'), false, 'they cannot forget it twice');
  assert.deepEqual(C.whoKnows(p, save, 'the-door'), ['wren']);

  // a fact nobody declared still works — you can write first and tidy later
  assert.equal(C.tell(save, 'mira', 'something-i-just-thought-of'), true);
  assert.deepEqual(C.whoKnows(p, save, 'something-i-just-thought-of'), ['mira']);
});

test('cast: word gets around, but only when the story says it did', () => {
  const p = project();
  const save = fresh(p);
  C.tell(save, 'wren', 'the-name');
  assert.deepEqual(C.known(save, 'mira'), [], 'nothing spreads by itself');

  assert.deepEqual(C.spread(save, 'wren', 'mira').sort(), ['the-door', 'the-name']);
  assert.equal(C.knows(save, 'mira', 'the-door').from, 'wren', 'and it is on the record who said it');
  assert.deepEqual(C.spread(save, 'wren', 'mira'), [], 'a second telling is not news');

  // holding something back
  const quiet = fresh(p);
  C.tell(quiet, 'wren', 'the-name');
  assert.deepEqual(C.spread(quiet, 'wren', 'mira', { not: ['the-name'] }), ['the-door']);
  assert.equal(C.knows(quiet, 'mira', 'the-name'), null, 'she kept that one to herself');

  // or telling only one thing
  const one = fresh(p);
  C.tell(one, 'wren', 'the-name');
  assert.deepEqual(C.spread(one, 'wren', 'mira', { only: ['the-name'] }), ['the-name']);
});

test('cast: feelings move, band, clamp and go both ways', () => {
  const p = project();
  const save = fresh(p);
  assert.equal(C.feels(save, 'mira', 'wren'), 0, 'nobody starts with an opinion');

  assert.equal(C.feel(save, 'mira', 'wren', 25), 25);
  assert.equal(C.band(25).id, 'warm');
  assert.equal(C.feel(save, 'mira', 'wren', 60), 85);
  assert.equal(C.band(85).id, 'close');
  assert.equal(C.feel(save, 'mira', 'wren', 900), 100, 'it does not run away');
  assert.equal(C.feel(save, 'mira', 'wren', -900), -100);
  assert.equal(C.band(-100).id, 'hostile');
  assert.equal(C.setFeeling(save, 'mira', 'wren', 0), 0);
  assert.equal(C.band(0).id, 'neutral');

  // a friendship is only as warm as its cooler half
  C.setFeeling(save, 'wren', 'mira', 80);
  C.setFeeling(save, 'mira', 'wren', 10);
  assert.deepEqual(C.mutual(save, 'wren', 'mira'), { ab: 80, ba: 10, both: 10 });
});

test('cast: the conditions a page asks', () => {
  const p = project();
  const save = fresh(p);
  const ctx = KIT.interpreter.fakeCtx({ project: p, save });
  const ask = (c) => KIT.conditions.test(c, ctx);

  assert.equal(ask({ kind: 'knows', who: 'wren', fact: 'the-door' }), true);
  assert.equal(ask({ kind: 'knows', who: 'mira', fact: 'the-door' }), false);
  C.tell(save, 'mira', 'the-door', { from: 'wren' });
  assert.equal(ask({ kind: 'knows', who: 'mira', fact: 'the-door' }), true);
  assert.equal(ask({ kind: 'knows', who: 'mira', fact: 'the-door', from: 'wren' }), true);
  assert.equal(ask({ kind: 'knows', who: 'mira', fact: 'the-door', from: 'the_aunt' }), false,
    'it matters who told her');

  assert.equal(ask({ kind: 'feels', who: 'wren', about: 'mira', op: '>=', value: 30 }), true);
  assert.equal(ask({ kind: 'feels', who: 'wren', about: 'mira', op: '>', value: 30 }), false);
  assert.equal(ask({ kind: 'feels', who: 'wren', about: 'mira', op: '>=', value: 20, mutual: true }), false,
    'mira has not said anything of the kind');
  C.setFeeling(save, 'mira', 'wren', 40);
  assert.equal(ask({ kind: 'feels', who: 'wren', about: 'mira', op: '>=', value: 20, mutual: true }), true);

  assert.equal(ask({ kind: 'met', who: 'wren' }), true);
  assert.equal(ask({ kind: 'met', who: 'mira' }), false);
  assert.equal(ask({ kind: 'met', who: 'mira', is: false }), true);

  // and they all describe themselves in words, for the editor
  assert.match(KIT.conditions.describe({ kind: 'knows', who: 'mira', fact: 'the-door', from: 'wren' }, ctx),
    /Mira knows about The door in the orchard, from Wren/);
  assert.match(KIT.conditions.describe({ kind: 'met', who: 'mira', is: false }, ctx), /we have not met Mira/);
});

test('cast: the commands a script runs', async () => {
  const p = project();
  const save = fresh(p);
  const said = [];
  const ctx = KIT.interpreter.fakeCtx({ project: p, save });
  ctx.emit = (name, payload) => said.push({ name, payload });
  const run = (cmd) => KIT.commands.exec(ctx, cmd);

  await run({ t: 'tell', who: 'mira', fact: 'the-door', from: 'wren' });
  assert.equal(C.knows(save, 'mira', 'the-door').from, 'wren');
  assert.equal(said[0].name, 'castChanged');

  await run({ t: 'meet', who: 'mira' });
  assert.equal(C.met(save, 'mira'), true);

  await run({ t: 'feel', who: 'mira', about: 'wren', op: 'by', value: 15, both: true });
  assert.equal(C.feels(save, 'mira', 'wren'), 15);
  assert.equal(C.feels(save, 'wren', 'mira'), 45, 'both ways');

  await run({ t: 'feel', who: 'mira', about: 'wren', op: 'set', value: -40 });
  assert.equal(C.feels(save, 'mira', 'wren'), -40);

  await run({ t: 'tell', who: 'the_aunt', fact: 'the-door', forget: true });
  await run({ t: 'spread', from: 'the_aunt', to: 'mira', not: [] });
  assert.equal(C.knows(save, 'mira', 'the-name').from, 'the_aunt', 'the aunt let that slip');

  await run({ t: 'tell', who: 'mira', fact: 'the-name', forget: true });
  assert.equal(C.knows(save, 'mira', 'the-name'), null);
});

test('cast: a line can say a name and the right pronoun', () => {
  const p = project();
  const ctx = KIT.interpreter.fakeCtx({ project: p, save: fresh(p) });
  const say = (s) => KIT.text.plain(s, ctx);
  assert.equal(say('{who:wren} left.'), 'Wren left.');
  assert.equal(say('{they:wren} said {their:wren} name.'), 'she said her name.');
  assert.equal(say('I saw {them:wren}.'), 'I saw her.');
  assert.equal(say('{they:mira} took {their:mira} coat.'), 'they took their coat.');
  assert.equal(say('{they:the_aunt} is here.'), 'they is here.', 'nobody said, so the neutral one');
  assert.equal(say('{who:nobody}'), 'nobody', 'an unknown id reads as itself, not as a crash');
});

test('cast: the graph, which is the point of having a cast at all', () => {
  const p = project();
  const save = fresh(p);
  C.tell(save, 'mira', 'the-door', { from: 'wren' });
  C.setFeeling(save, 'mira', 'wren', 55);
  C.setFeeling(save, 'mira', 'the_aunt', -70);

  const g = C.graph(p, save);
  assert.deepEqual(g.people.map(x => x.id), ['wren', 'mira', 'the_aunt']);

  const mira = g.people.find(x => x.id === 'mira');
  assert.deepEqual(mira.knows, [{ id: 'the-door', label: 'The door in the orchard', from: 'wren', at: 480 }]);
  assert.deepEqual(mira.feels.map(f => [f.name, f.value, f.band.id]),
    [['Wren', 55, 'warm'], ['The Aunt', -70, 'hostile']], 'warmest first');

  const door = g.facts.find(f => f.id === 'the-door');
  assert.deepEqual(door.knownBy, ['wren', 'mira']);
  assert.equal(door.secret, false);
  assert.equal(g.facts.find(f => f.id === 'the-name').secret, true);

  // a fact somebody knows that nobody declared still shows up, marked as such
  C.tell(save, 'wren', 'a-loose-end');
  const g2 = C.graph(p, save);
  const loose = g2.facts.find(f => f.id === 'a-loose-end');
  assert.equal(loose.declared, false, 'so the panel can offer to write it down properly');
  assert.deepEqual(loose.knownBy, ['wren']);
});

test('cast: everything survives being saved and read back', () => {
  const p = project();
  const save = fresh(p);
  C.tell(save, 'mira', 'the-door', { from: 'wren' });
  C.feel(save, 'mira', 'wren', 20);
  C.meet(save, 'mira');
  const back = JSON.parse(JSON.stringify(save));
  assert.deepEqual(C.graph(p, back), C.graph(p, save));
});
