'use strict';
// Languages: the lookup, the walk that finds every line, and the file a
// translator actually opens.
const test = require('node:test');
const assert = require('node:assert/strict');
const KIT = require('./_load.js');
const L = KIT.lang;
const T = KIT.text;

function game(extra) {
  const { project } = KIT.project.normalize(Object.assign({
    meta: { id: 'x', title: 'The Long Way Home', subtitle: 'a small story' },
    settings: { language: 'en', languageName: 'English' },
    items: { lantern: { name: 'Lantern', desc: 'It only shows you the next step.' } },
    cast: { mira: { name: 'Mira', pronouns: 'she/her' } },
    maps: {
      pier: {
        name: 'The Pier', width: 8, height: 8,
        objects: [{
          id: 'mira', x: 1, y: 1,
          pages: [{ on: { talk: [
            { t: 'say', who: 'Mira', text: 'Hello, traveller.' },
            { t: 'choice', prompt: 'Do you remember me?', options: [
              { text: 'Of course.', then: [{ t: 'say', text: 'Good.' }] },
              { text: 'No.', then: [{ t: 'say', text: 'That is all right.' }] },
            ] },
          ] } }],
        }],
      },
    },
  }, extra || {}));
  return project;
}

test('lang: every line a player can read is found, and nothing an author writes to themselves', () => {
  const p = game();
  const found = L.extract(p);
  const texts = found.map(f => f.text);

  for (const want of ['Hello, traveller.', 'Do you remember me?', 'Of course.', 'No.', 'That is all right.',
                      'Mira', 'Lantern', 'It only shows you the next step.', 'The Pier', 'The Long Way Home']) {
    assert.ok(texts.includes(want), `missing: ${want}`);
  }
  // the speaker's name came through the `shown` flag on a plain string field
  assert.ok(texts.includes('Mira'));
  // a nested choice branch is walked like any other script
  assert.ok(texts.includes('Good.'));
});

test('lang: a note is the author talking to themselves, and is never extracted', () => {
  const p = game();
  p.maps.pier.note = 'remember to redo the railing';
  p.meta.pitch = 'A girl walks home the long way.';
  p.items.lantern.note = 'placeholder art';
  const texts = L.extract(p).map(f => f.text);
  assert.ok(!texts.includes('remember to redo the railing'), 'a map note is not dialogue');
  assert.ok(!texts.includes('placeholder art'), 'an item note is not dialogue');
  assert.ok(!texts.includes('A girl walks home the long way.'), 'the pitch is a design note');
});

test('lang: every line says where it came from, so "No." is answerable', () => {
  const found = L.extract(game());
  const no = found.find(f => f.text === 'No.');
  assert.ok(no, 'found the option');
  assert.ok(no.where.length, 'it knows where it lives');
  assert.match(no.where[0], /pier/, `expected the map, got ${no.where[0]}`);
  const lantern = found.find(f => f.text === 'Lantern');
  assert.deepEqual(lantern.where, ['item · lantern']);
});

test('lang: the same line in two places is one entry with two addresses', () => {
  const p = game();
  p.scripts = { greet: KIT.project.fillScript({ body: [{ t: 'say', text: 'Hello, traveller.' }] }, 'greet') };
  const found = L.extract(p);
  const hits = found.filter(f => f.text === 'Hello, traveller.');
  assert.equal(hits.length, 1, 'one line, not two');
  assert.equal(hits[0].where.length, 2, 'and both places listed');
});

test('lang: translating swaps the line, and leaves the braces alone', () => {
  const p = game();
  L.put(p, 'ja', { name: '日本語', lines: {
    'Hello, traveller.': 'こんにちは、旅人よ。',
    '{p1} found the {item:lantern}.': '{p1}は{item:lantern}を見つけた。',
    'Lantern': 'ランタン',                    // the name the tag resolves to is a line too
  } });
  L.bind(p, 'ja');
  try {
    assert.equal(L.current(), 'ja');
    assert.equal(L.t('Hello, traveller.'), 'こんにちは、旅人よ。');

    // The whole pipeline: translate, THEN substitute, so the tags still work —
    // and note the Japanese moved {item:lantern} in front of the verb, which is
    // exactly what keying on whole lines buys you.
    const ctx = { heroes: [{ id: 'p1', name: 'Ren' }], items: p.items };
    assert.equal(T.plain('{p1} found the {item:lantern}.', ctx), 'Renはランタンを見つけた。');
  } finally { L.bind(p, 'en'); }
});

test('lang: an untranslated line comes back in the original and is remembered', () => {
  const p = game();
  L.put(p, 'ja', { name: '日本語', lines: { 'Hello, traveller.': 'こんにちは、旅人よ。' } });
  L.bind(p, 'ja');
  try {
    assert.equal(L.t('Do you remember me?'), 'Do you remember me?', 'the original, not an empty box');
    L.t('Do you remember me?');
    const miss = L.missing();
    assert.equal(miss[0].text, 'Do you remember me?');
    assert.equal(miss[0].asked, 2, 'and it counted');
  } finally { L.bind(p, 'en'); }
});

test('lang: an empty translation means "leave it in the original"', () => {
  const p = game();
  L.put(p, 'ja', { name: '日本語', lines: { 'Hello, traveller.': '' } });
  L.bind(p, 'ja');
  try { assert.equal(L.t('Hello, traveller.'), 'Hello, traveller.'); }
  finally { L.bind(p, 'en'); }
});

test('lang: playing in the language it was written in costs one comparison and changes nothing', () => {
  const p = game();
  L.bind(p, 'en');
  assert.equal(L.translating(), false);
  assert.equal(L.t('Hello, traveller.'), 'Hello, traveller.');
  assert.deepEqual(L.missing(), [], 'nothing is "missing" in the source language');
});

test('lang: an unknown language falls back rather than throwing', () => {
  const p = game();
  L.bind(p, 'kl');
  assert.equal(L.current(), 'en');
  assert.equal(L.translating(), false);
});

test('lang: the source language is the project\'s, not English', () => {
  const p = game({ settings: { language: 'ja', languageName: '日本語' } });
  L.put(p, 'en', { name: 'English', lines: {} });
  L.bind(p);
  try {
    assert.equal(L.current(), 'ja', 'written in Japanese, so it plays in Japanese');
    assert.deepEqual(L.known(), ['ja', 'en'], 'and its own language comes first');
    assert.equal(L.nameOf('ja'), '日本語');
  } finally { L.bind(game(), 'en'); }
});

test('lang: the file round-trips, including lines with blank lines in them', () => {
  const p = game();
  const lines = {
    'Hello, traveller.': 'こんにちは、旅人よ。',
    'Two lines\nof text.': '二行の\nテキスト。',
    'A gap\n\nin the middle.': '真ん中に\n\n空白。',
    'Trailing space kept. ': '末尾の空白。 ',
  };
  L.put(p, 'ja', { name: '日本語', lines });
  const text = L.toText(p, 'ja');
  const back = L.fromText(text);
  assert.deepEqual(back.problems, [], 'a file we wrote reads back clean');
  for (const k of Object.keys(lines)) assert.equal(back.lines[k], lines[k], `round trip: ${JSON.stringify(k)}`);
});

test('lang: the file tells a translator what is left, and keeps orphans rather than losing work', () => {
  const p = game();
  L.put(p, 'ja', { name: '日本語', lines: {
    'Hello, traveller.': 'こんにちは、旅人よ。',
    'A line I reworded yesterday.': '昨日書き直した行。',
  } });
  const text = L.toText(p, 'ja');
  assert.match(text, /# .* — 日本語 \(ja\)/);
  assert.match(text, /^# \d+ of \d+ lines translated\.$/m);
  assert.match(text, /> Hello, traveller\.\n< こんにちは、旅人よ。/);
  assert.match(text, /> Do you remember me\?\n<\n/, 'an untranslated line is waiting with an empty < line');
  assert.match(text, /no longer has/, 'and the reworded line is kept below, not dropped');
  assert.match(text, /> A line I reworded yesterday\./);
});

test('lang: a mangled file loses the mangled line and nothing else', () => {
  const r = L.fromText([
    '# a note',
    '> Good morning.',
    '< おはよう。',
    '',
    'somebody typed a bare line here',
    '',
    '< an orphan translation',
    '',
    '> Good night.',
    '< おやすみ。',
  ].join('\n'));
  assert.equal(r.lines['Good morning.'], 'おはよう。');
  assert.equal(r.lines['Good night.'], 'おやすみ。', 'the file kept going after the damage');
  assert.equal(r.problems.length, 2);
  assert.equal(r.problems[0].line, 5);
  assert.match(r.problems[1].message, /no `>`/);
});

test('lang: coverage counts what is actually left to do', () => {
  const p = game();
  const before = L.coverage(p, 'ja');
  assert.equal(before.translated, 0);
  assert.ok(before.total > 5);
  assert.equal(before.missing.length, before.total);

  L.put(p, 'ja', { name: '日本語', lines: { 'Hello, traveller.': 'こんにちは、旅人よ。' } });
  const after = L.coverage(p, 'ja');
  assert.equal(after.translated, 1);
  assert.equal(after.total, before.total, 'the same lines, one of them done');
  assert.ok(!after.missing.some(m => m.text === 'Hello, traveller.'));
});

test('lang: the engine\'s own words translate too', () => {
  const p = game();
  const yes = KIT.strings.get(p, 'yes');
  L.put(p, 'ja', { name: '日本語', lines: { [yes]: 'はい' } });
  L.bind(p, 'ja');
  try { assert.equal(KIT.strings.get(p, 'yes'), 'はい', 'the Terms table goes through the same lookup'); }
  finally { L.bind(p, 'en'); }
});

test('lang: a language survives normalize, and junk in it does not', () => {
  const p = game({ languages: { ja: { name: '日本語', lines: { 'Hello, traveller.': 'こんにちは、旅人よ。', bad: 42, worse: null } }, junk: 'not an object' } });
  assert.equal(p.languages.ja.name, '日本語');
  assert.equal(p.languages.ja.lines['Hello, traveller.'], 'こんにちは、旅人よ。');
  assert.ok(!('bad' in p.languages.ja.lines), 'a non-string translation is dropped');
  assert.ok(!('worse' in p.languages.ja.lines));
  assert.deepEqual(p.languages.junk, { name: 'junk', lines: {} }, 'and a junk entry becomes an empty one rather than exploding');
});
