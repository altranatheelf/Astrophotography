'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KIT = require('./_load.js');
const T = KIT.text;

const ctx = {
  heroes: [{ id: 'p1', name: 'Ava' }, { id: 'p2', name: 'Ben' }], hero: 'p2',
  vars: { coins: 12, metMom: true }, self: { opened: false, count: 3 }, items: { berry: { name: 'Berry' } }, args: { who: 'Mom' },
};
const mono = { width: 10, measure: (s) => s.length };

test('text.substitute: every built-in tag, unknown tags kept, escaping, module tags', () => {
  assert.equal(T.substitute('Hi {p1} and {p2}; {p} is {hero}.', ctx), 'Hi Ava and Ben; Ben is Ben.');
  assert.equal(T.substitute('{var:coins} coins, met={var:metMom}, none={var:nope}', ctx), '12 coins, met=true, none=');
  assert.equal(T.substitute('{self:count} {self:opened} {item:berry} {item:unknown} {arg:who}', ctx), '3 false Berry unknown Mom');
  assert.equal(T.substitute('{pause} {color:red}x{/color} {nope:1}', ctx), '{pause} {color:red}x{/color} {nope:1}');
  assert.equal(T.substitute('{{p1}} is literal', ctx), '{{p1}} is literal');
  assert.equal(T.plain('{{p1}} is literal', ctx), '{p1} is literal');
  // substituted values never become codes
  assert.equal(T.plain('{var:tricky}', { vars: { tricky: '{pause}' } }), '{pause}');
  KIT.text.tags.mon = (c, arg) => `Mon#${arg}`;
  assert.equal(T.substitute('{mon:25}', ctx), 'Mon#25');
  delete KIT.text.tags.mon;
  assert.equal(T.substitute('{p} {p1}', {}), 'Player 1 Player 1');
  assert.equal(T.substitute(null, ctx), '');
});

test('text.contextFrom builds a TextCtx from an interpreter ctx (save names win)', () => {
  const run = {
    project: { heroes: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }], items: { berry: { name: 'Berry' } } },
    world: { save: { heroes: [{ name: 'Ava' }, {}], vars: { coins: 5 }, objects: { 'town:mom': { self: { done: true } } } } },
    self: 'town:mom', hero: 'p2', args: { n: 1 }, io: {},
  };
  assert.equal(T.substitute('{p1}/{p2}/{p}/{var:coins}/{self:done}/{item:berry}/{arg:n}', run), 'Ava/Player 2/Player 2/5/true/Berry/1');
  const tc = T.contextFrom(ctx);
  assert.equal(tc, ctx); // a TextCtx passes through
});

test('text.tokenize: codes, styles, breaks, escapes, unknown codes literal', () => {
  const spans = T.tokenize('Hi{pause} there{pause:800}{wait}{fast}{instant}\n{color:red}red {size:big}big{/size}{/color} {icon:berry}{shake}{{x}} {zzz}');
  assert.deepEqual(spans, [
    { type: 'text', text: 'Hi' }, { type: 'pause', ms: null }, { type: 'text', text: ' there' }, { type: 'pause', ms: 800 }, { type: 'wait' },
    { type: 'speed', mode: 'fast' }, { type: 'speed', mode: 'instant' }, { type: 'break' },
    { type: 'text', text: 'red ', color: 'red' }, { type: 'text', text: 'big', color: 'red', size: 'big' }, { type: 'text', text: ' ' },
    { type: 'icon', id: 'berry' }, { type: 'shake' }, { type: 'text', text: '{x} {zzz}' },
  ]);
  assert.deepEqual(T.tokenize(''), []);
  assert.equal(T.strip('a{pause}b{icon:x}\nc{color:red}d{/color}'), 'ab\ncd');
});

test('text.wrap: monospace wrapping, forced breaks, long words, style-preserving, zero-width codes', () => {
  const lines = T.wrap(T.tokenize('The quick brown fox jumps'), mono);
  assert.deepEqual(lines.map(l => l.map(s => s.text).join('')), ['The quick', 'brown fox', 'jumps']);
  const forced = T.wrap(T.tokenize('a\nb\n\nc'), mono);
  assert.deepEqual(forced.map(l => l.map(s => s.text).join('')), ['a', 'b', '', 'c']);
  const long = T.wrap(T.tokenize('abcdefghijklmnop end'), mono);
  assert.deepEqual(long.map(l => l.map(s => s.text).join('')), ['abcdefghij', 'klmnop end']);
  const styled = T.wrap(T.tokenize('{color:red}red words{/color} plain{pause} more here'), mono);
  assert.deepEqual(styled, [
    [{ type: 'text', text: 'red words', color: 'red' }],
    [{ type: 'text', text: 'plain' }, { type: 'pause', ms: null }, { type: 'text', text: ' more' }],
    [{ type: 'text', text: 'here' }],
  ]);
  const icon = T.wrap(T.tokenize('12345678 {icon:b}x'), Object.assign({}, mono, { iconWidth: 2 }));
  assert.deepEqual(icon.map(l => l.map(s => s.type === 'icon' ? '[i]' : s.text).join('')), ['12345678', '[i]x']);
  assert.deepEqual(T.wrap([], mono), [[]]);
  assert.deepEqual(T.wrap(T.tokenize('no wrap at all without width')).length, 1);
  // measure in pixels
  const px = T.wrap(T.tokenize('aa bb cc'), { width: 50, measure: (s) => s.length * 10 });
  assert.deepEqual(px.map(l => l.map(s => s.text).join('')), ['aa bb', 'cc']);
});

test('text.paginate and render', () => {
  const pages = T.paginate([[1], [2], [3], [4], [5], [6], [7]], 3);
  assert.deepEqual(pages, [[[1], [2], [3]], [[4], [5], [6]], [[7]]]);
  assert.deepEqual(T.paginate([], 3), [[]]);
  const r = T.render('Hello {p1}! Have a {item:berry} and go.', ctx, Object.assign({ lines: 2 }, mono));
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].pages.map(p => p.map(l => l.map(s => s.text).join(''))), [['Hello Ava!', 'Have a'], ['Berry and', 'go.']]);
  const many = T.render(['a', 'b'], ctx, mono);
  assert.equal(many.length, 2);
  assert.deepEqual(T.render('', ctx, mono), [{ pages: [[[]]] }]);
});

test('KIT.strings.get: project override, registry default, {vars}', () => {
  assert.equal(KIT.strings.get({}, 'got-item', { count: 3, item: 'Berry' }), 'Got 3 Berry!');
  assert.equal(KIT.strings.get({ strings: { 'got-item': 'You found {count} {item}.' } }, 'got-item', { count: 1, item: 'Key' }), 'You found 1 Key.');
  assert.equal(KIT.strings.get(null, 'yes'), 'Yes');
  assert.equal(KIT.strings.get(null, 'not-a-key'), 'not-a-key');
  assert.equal(KIT.strings.get({}, 'got-item', {}), 'Got {count} {item}!');
  assert.ok(KIT.strings.defaults()['save-prompt']);
});

test('KIT.script.values: format/parse/tokenize round trips', () => {
  const V = KIT.script.values;
  const cases = [1, -2.5, 0, true, false, null, 'word', 'two words', 'a"q', 'x=y', '{brace', '12', 'true', 'obj:mom', '!', 'a\nb', { a: [1, 'x'] }, [1, 2]];
  for (const v of cases) {
    const txt = V.format(v);
    const back = V.tokenize(`k=${txt}`);
    assert.equal(back.length, 1, txt);
    assert.deepEqual(back[0].value, v, txt);
  }
  const toks = V.tokenize('@x a=1 b="hi there" c=true pos {"x":1,"y":2} d=[1,"two"] e=obj:mom');
  assert.deepEqual(toks, [
    { key: null, value: '@x', raw: '@x' }, { key: 'a', value: 1, raw: '1' }, { key: 'b', value: 'hi there', raw: '"hi there"' }, { key: 'c', value: true, raw: 'true' },
    { key: null, value: 'pos', raw: 'pos' }, { key: null, value: { x: 1, y: 2 }, raw: '{"x":1,"y":2}' }, { key: 'd', value: [1, 'two'], raw: '[1,"two"]' }, { key: 'e', value: 'obj:mom', raw: 'obj:mom' },
  ].map(t => Object.assign({ error: undefined }, t)));
  assert.deepEqual(V.tokenize('face=mom, at=top', { separators: ',' }).map(t => [t.key, t.value]), [['face', 'mom'], ['at', 'top']]);
  assert.equal(V.tokenize('s="unterminated')[0].error, 'unterminated string');
  assert.equal(V.format('word', { bare: V.WORD }), 'word');
  assert.equal(V.format('obj:mom', { bare: V.WORD }), '"obj:mom"');
});

// ---- voices and effects: the Undertale bundle ------------------------------
// Undertale's "character voice" is a numbered preset carrying font, colour,
// speed, shake and blip together, and switching one mid-line is what gives Sans
// and Papyrus their voices. There are 114 of them in a 310-line if-chain. Here
// it is one asset and one code.

test('text: {voice:x} marks a run without disturbing anything around it', () => {
  const spans = KIT.text.tokenize('hi {voice:sans}there{/voice} you');
  assert.deepEqual(spans, [
    { type: 'text', text: 'hi ' },
    { type: 'text', text: 'there', voice: 'sans' },
    { type: 'text', text: ' you' },
  ]);
});

test('text: voices nest and pop back to the one outside', () => {
  const spans = KIT.text.tokenize('{voice:a}one{voice:b}two{/voice}three{/voice}');
  assert.deepEqual(spans.map(s => [s.text, s.voice]), [['one', 'a'], ['two', 'b'], ['three', 'a']]);
});

test('text: {fx:name} and {fx:name,amount} both read', () => {
  const plain = KIT.text.tokenize('{fx:wave}up{/fx}');
  assert.deepEqual(plain, [{ type: 'text', text: 'up', fx: 'wave' }]);
  const loud = KIT.text.tokenize('{fx:shiver,3}brr{/fx}');
  assert.deepEqual(loud, [{ type: 'text', text: 'brr', fx: 'shiver', fxAmount: 3 }]);
});

test('text: an effect and a voice stack independently', () => {
  const spans = KIT.text.tokenize('{voice:sans}a{fx:wave}b{/fx}c{/voice}');
  assert.deepEqual(spans.map(s => [s.text, s.voice, s.fx]), [
    ['a', 'sans', undefined], ['b', 'sans', 'wave'], ['c', 'sans', undefined],
  ]);
});

test('text: a voice or an effect survives wrapping, and never merges with a run that lacks it', () => {
  const spans = KIT.text.tokenize('aaa {voice:sans}bbb{/voice} ccc');
  const lines = KIT.text.wrap(spans, { width: 100 });
  const runs = lines[0].filter(s => s.type === 'text');
  assert.equal(runs.length, 3, 'three runs, not one merged blob');
  assert.equal(runs[1].voice, 'sans');
  assert.equal(runs[0].voice, undefined);
});

test('text: wrapping a long effected run keeps the effect on every piece of it', () => {
  const spans = KIT.text.tokenize('{fx:wave}one two three four five six{/fx}');
  const lines = KIT.text.wrap(spans, { width: 12 });
  assert.ok(lines.length > 1, 'it really did wrap');
  for (const line of lines) for (const sp of line) if (sp.type === 'text') assert.equal(sp.fx, 'wave');
});

test('text: strip and plain ignore voices and effects, so a summary is still words', () => {
  assert.equal(KIT.text.strip('{voice:sans}hello {fx:wave,2}there{/fx}{/voice}'), 'hello there');
  assert.equal(KIT.text.plain('{voice:sans}hi {p1}{/voice}', { heroes: [{ id: 'p1', name: 'Ren' }] }), 'hi Ren');
});

test('text: an unknown code is still left alone, voices and all', () => {
  assert.deepEqual(KIT.text.tokenize('{voiceover:x}hm'), [{ type: 'text', text: '{voiceover:x}hm' }]);
});

test('text: a stray {/voice} or {/fx} does not throw or corrupt the run', () => {
  assert.deepEqual(KIT.text.tokenize('{/voice}{/fx}plain'), [{ type: 'text', text: 'plain' }]);
});

test('voices: a voice carries the whole bundle, and every look field may be empty', () => {
  const reg = KIT.registry('voices');
  const d = reg.get('default');
  for (const k of ['sound', 'pitch', 'jitter', 'everyChars', 'volume', 'rate', 'skipPunctuation',
                   'font', 'color', 'size', 'speed', 'fx', 'fxAmount']) {
    assert.ok(Object.prototype.hasOwnProperty.call(d, k), `a voice declares ${k}`);
  }
  assert.equal(d.font, null, 'and a plain voice leaves the box alone');
  assert.equal(d.color, null);
  assert.equal(d.speed, null, 'no speed means the player\'s own text-speed setting wins');
});

test('voices: a full speaker style validates', () => {
  const reg = KIT.registry('voices');
  reg.add({ id: 'test-sans', name: 'Sans', sound: 'blip', pitch: 0.55, everyChars: 2,
            font: '"Comic Sans MS", cursive', color: '#dfe7f5', size: 'normal', speed: 18, fx: 'drift', fxAmount: 1 });
  const v = reg.get('test-sans');
  assert.equal(v.font, '"Comic Sans MS", cursive');
  assert.equal(v.speed, 18);
  assert.equal(v.fx, 'drift');
});

test('textEffects: the shipped effects are named, not magic numbers', () => {
  const reg = KIT.registry('textEffects');
  for (const id of ['wave', 'shiver', 'drift', 'throb', 'rainbow']) {
    assert.ok(reg.has(id), `ships ${id}`);
    assert.ok(reg.get(id).css, `${id} has a class`);
  }
  assert.equal(reg.get('wave').perChar, true, 'a wave travels along the word');
  assert.equal(reg.get('drift').perChar, false, 'a drift moves the whole run as one');
});
