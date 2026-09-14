'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KIT = require('./_load.js');
const SP = KIT.screenplay, CMD = KIT.commands;

const SAMPLE = [
  { t: 'say', who: 'Mom', text: 'Good morning, {p1}! {pause}\nSleep well?' },
  { t: 'say', who: '', text: 'The kettle "whistles".' },
  { t: 'say', who: 'Mom', face: 'mom-smile', position: 'top', text: 'Faces too.' },
  { t: 'choice', prompt: 'Ready?', options: [
    { text: 'Yes', when: null, then: [{ t: 'say', who: 'Mom', text: 'Take these.' }, { t: 'give', item: 'berry', count: 3 }] },
    { text: 'Not yet', when: { kind: 'var', name: 'chapter', op: '>=', value: 2 }, then: [] } ] },
  { t: 'if', when: { kind: 'var', name: 'chapter', op: '>=', value: 2 }, then: [{ t: 'setVar', name: 'chapter', op: 'add', value: 1 }], else: [{ t: 'setSelf', key: 'opened', op: 'set', value: true }] },
  { t: 'if', when: null, then: [], else: [] },
  { t: 'loop', body: [{ t: 'wait', ms: 100 }, { t: 'if', when: { kind: 'self', key: 'n', op: '>', value: 3 }, then: [{ t: 'break' }], else: [] }] },
  { t: 'group', label: 'Cutscene', body: [{ t: 'fadeOut', ms: 300 }, { t: 'fadeIn' }] },
  { t: 'call', script: 'meet-mom', args: [{ name: 'n', value: 2 }] },
  { t: 'transfer', map: 'town', x: 10, y: 12, dir: 'down' },
  { t: 'moveRoute', target: 'self', steps: ['up', 'up', 'left'], wait: false },
  { t: 'balloon', target: 'obj:kid', kind: '?' },
  { t: 'comment', text: 'hello there' },
  { t: 'say', who: 'Mom', text: 'off', disabled: true },
  { t: 'music', id: null }, { t: 'music', id: 'town', fade: 500 }, { t: 'sound', id: 'sparkle' },
  { t: 'label', name: 'again' }, { t: 'jump', label: 'again' }, { t: 'exit' },
  { t: 'raw', line: '@@nonsense' },
];

test('screenplay: serialize is canonical and parse is lossless', () => {
  const text = SP.serialize(SAMPLE);
  const r = SP.parse(text);
  assert.deepEqual(r.problems.map(p => p.raw), ['@@nonsense']);
  assert.deepEqual(r.commands, CMD.normalizeAll(SAMPLE));
  assert.equal(SP.serialize(r.commands), text);
  assert.ok(text.includes('Mom (face=mom-smile, at=top): Faces too.'));
  assert.ok(text.includes('- Not yet [when: chapter >= 2]'));
  assert.ok(text.includes('@say who=Mom text=off disabled=true'));
});

test('screenplay: nested three deep with tabs, blank lines and CRLF', () => {
  const text = ['? Go?', '', '- Yes', '\t@if when: coins > 1', '\t\t? Sure?', '\t\t- Yep', '\t\t\tMom: ok', '\t@end', '- No', '\tMom: fine'].join('\r\n');
  const r = SP.parse(text);
  assert.equal(r.problems.length, 0);
  const c = r.commands[0];
  assert.equal(c.t, 'choice');
  assert.equal(c.options[0].then[0].t, 'if');
  assert.equal(c.options[0].then[0].then[0].options[0].then[0].text, 'ok');
  assert.equal(c.options[1].then[0].text, 'fine');
  assert.equal(SP.parse(SP.serialize(r.commands)).problems.length, 0);
});

test('screenplay: problems are reported with line numbers and nothing is dropped', () => {
  const text = ['Mom: hi', '@end', '- stray option', '      Kid: odd indent', '@if when: chapter == 1', '    Mom: yes', '@zzz what=1', 'Mom: after'].join('\n');
  const r = SP.parse(text);
  assert.deepEqual(r.problems.map(p => p.line), [4, 2, 3, 4, 5]);   // odd indentation first (pre-pass), then in order
  const kinds = r.commands.map(c => c.t);
  assert.deepEqual(kinds, ['say', 'raw', 'raw', 'raw', 'if', 'zzz', 'say']);   // @zzz is an unknown command (kept as generic); missing @end reported
  assert.ok(r.problems.some(p => /missing @end/.test(p.message)));
  assert.equal(r.commands[4].then.length, 1);
  assert.equal(r.commands[4].then[0].text, 'yes');
  // re-serialising keeps the raw lines verbatim
  assert.ok(SP.serialize(r.commands).includes('- stray option'));
});

test('screenplay: documents with headers, triggers, tags and when', () => {
  const sections = [
    { id: 'meet-mom', trigger: 'auto', tags: ['ch1'], when: { kind: 'var', name: 'chapter', op: '==', value: 0 }, commands: [{ t: 'say', who: 'Mom', text: 'hi' }] },
    { id: 'town/mom/1/interact', trigger: 'call', tags: [], when: null, commands: [{ t: 'give', item: 'berry', count: 1 }] },
    { id: 'empty', trigger: 'parallel', tags: [], when: null, commands: [] },
  ];
  const text = SP.serializeDocument(sections);
  assert.ok(text.startsWith(':: meet-mom [auto ch1] when: chapter == 0\nMom: hi\n\n:: town/mom/1/interact\n'));
  const r = SP.parseDocument(text);
  assert.equal(r.problems.length, 0);
  assert.deepEqual(r.sections.map(s => [s.id, s.trigger, s.tags, s.when && s.when.kind, s.commands.length]), [['meet-mom', 'auto', ['ch1'], 'var', 1], ['town/mom/1/interact', 'call', [], null, 1], ['empty', 'parallel', [], null, 0]]);
  assert.equal(SP.serializeDocument(r.sections), text);
  const bad = SP.parseDocument('Mom: before any header\n:: x when: chapter ==\nMom: y');
  assert.equal(bad.sections[0].id, null);
  assert.ok(bad.problems.some(p => /bad when/.test(p.message)));
});
