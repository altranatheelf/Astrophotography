'use strict';
// Writing the look: KIT.editor.ops.look, on a real document.
//
// `project.ui` holds only what a game changes on top of the look it starts
// from. These are the writes that keep it that way — and the undo that has to
// leave a project exactly as it found it, with no empty `ui: {}` behind to say
// somebody once opened the Look panel.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('./_load.js');
require(path.join(__dirname, '..', '..', 'js/kit/editor/ops.js'));

const O = KIT.editor.ops;
const blank = () => KIT.project.normalize(KIT.project.blank()).project;
/** One undo step, the way ED.commit makes one. */
const step = (doc, fn) => doc.transaction('Look', () => fn(doc));

test('look ops: one change and one undo leave the project exactly as it was, with no ui key', () => {
  const doc = KIT.document(blank());
  const before = KIT.deepClone(doc.value);
  assert.ok(!('ui' in doc.value), 'a new game has no look of its own');
  step(doc, (d) => O.look.set(d, ['dialogue', 'lines'], 2));
  assert.deepEqual(doc.value.ui, { dialogue: { lines: 2 } });
  assert.equal(doc.history.length, 1, 'one step');
  doc.undo();
  assert.deepEqual(doc.value, before);
  assert.ok(!('ui' in doc.value), 'and nothing left behind');
  doc.redo();
  assert.deepEqual(doc.value.ui, { dialogue: { lines: 2 } }, 'redo puts it back');
});

test('look ops: a value equal to the one underneath is no change, and takes its parents with it', () => {
  const doc = KIT.document(blank());
  step(doc, (d) => O.look.set(d, ['tokens', 'paper'], '#000000'));
  step(doc, (d) => O.look.set(d, ['dialogue', 'lines'], 4));
  step(doc, (d) => O.look.set(d, ['tokens', 'paper'], '#fdfdfb'));
  assert.deepEqual(doc.value.ui, { dialogue: { lines: 4 } }, 'the kit\'s own paper is not stored, and tokens went with it');
  step(doc, (d) => O.look.set(d, ['dialogue', 'lines'], 3));
  assert.ok(!('ui' in doc.value), 'the last change undone by hand takes ui away too');
  assert.equal(O.look.set(doc, ['dialogue', 'lines'], 3), false, 'setting what is already there changes nothing');
  assert.equal(O.look.set(doc, ['dialogue', 'lines'], undefined), false);
});

test('look ops: starting from Soul, Soul\'s own values are not changes', () => {
  const doc = KIT.document(blank());
  step(doc, (d) => O.look.useBase(d, 'soul'));
  assert.deepEqual(doc.value.ui, { base: 'soul' });
  step(doc, (d) => O.look.set(d, ['tokens', 'paper'], '#000000'));
  assert.deepEqual(doc.value.ui, { base: 'soul' }, 'black paper is what Soul has: nothing stored');
  step(doc, (d) => O.look.set(d, ['tokens', 'paper'], '#101010'));
  assert.deepEqual(doc.value.ui, { base: 'soul', tokens: { paper: '#101010' } });
  // Changes kept on top of a new base; the ones the new base shares drop away.
  step(doc, (d) => O.look.set(d, ['dialogue', 'lines'], 2));
  step(doc, (d) => O.look.useBase(d, 'handheld'));
  assert.deepEqual(doc.value.ui, { base: 'handheld', tokens: { paper: '#101010' } }, 'Handheld has two lines already');
  step(doc, (d) => O.look.useBase(d, 'kit'));
  assert.deepEqual(doc.value.ui, { tokens: { paper: '#101010' } }, 'the kit is no base at all');
  step(doc, (d) => O.look.useBase(d, 'dream', { clean: true }));
  assert.deepEqual(doc.value.ui, { base: 'dream' }, 'starting clean drops every change');
  step(doc, (d) => O.look.useBase(d, 'kit'));
  assert.ok(!('ui' in doc.value), 'and back to the kit is back to nothing');
  // Every one of those was one step, and undoing them all is where we began.
  while (doc.canUndo()) doc.undo();
  assert.ok(!('ui' in doc.value));
});

test('look ops: what is stored is what the game uses', () => {
  const doc = KIT.document(blank());
  step(doc, (d) => O.look.set(d, ['dialogue', 'prefix'], 'abcdefgh'));
  assert.deepEqual(doc.value.ui, { dialogue: { prefix: 'abcd' } }, 'a prefix holds four letters, and four are kept');
  step(doc, (d) => O.look.reset(d, ['dialogue', 'prefix']));
  step(doc, (d) => O.look.set(d, ['tokens', 'toastInk'], '#FFFFFF'));
  step(doc, (d) => O.look.set(d, ['tokens', 'titleButtonInk'], '#fff'));
  assert.ok(!('ui' in doc.value), 'the same white spelled another way is no change');
  assert.equal(O.look.set(doc, ['tokens', 'paper'], 'pink'), false, 'a value the look cannot hold is not written');
  assert.equal(O.look.set(doc, ['nowhere'], 3), false, 'nor one with no field to go in');
  assert.ok(!('ui' in doc.value));
  step(doc, (d) => O.look.set(d, ['tokens', 'paper'], '#ABCDEF'));
  assert.deepEqual(doc.value.ui, { tokens: { paper: '#abcdef' } });
  assert.deepEqual(O.look.overrides(doc.value), [['tokens', 'paper']], 'and "Keep my changes" counts only real ones');
});

test('look ops: reset takes the empty parents away', () => {
  const doc = KIT.document(blank());
  step(doc, (d) => { O.look.set(d, ['dialogue', 'lines'], 5); O.look.set(d, ['cursor', 'glyph'], '♥'); });
  step(doc, (d) => O.look.reset(d, ['dialogue', 'lines']));
  assert.deepEqual(doc.value.ui, { cursor: { glyph: '♥' } });
  step(doc, (d) => O.look.reset(d, ['cursor', 'glyph']));
  assert.ok(!('ui' in doc.value));
  assert.equal(O.look.reset(doc, ['cursor', 'glyph']), false, 'resetting nothing changes nothing');
});

test('look ops: overrides lists what the game changed, for "keep my changes"', () => {
  const p = { ui: { base: 'soul', tokens: { paper: '#101010', ink: '#eeeeee' }, dialogue: { lines: 2 }, voice: 'low' } };
  assert.deepEqual(O.look.overrides(p), [['tokens', 'paper'], ['tokens', 'ink'], ['dialogue', 'lines'], ['voice']]);
  assert.deepEqual(O.look.overrides({}), []);
});

test('look ops: a font brought in is one step, and undo leaves no fonts table behind', () => {
  const doc = KIT.document(blank());
  const before = KIT.deepClone(doc.value);
  const font = { id: 'dot', name: 'Dot', src: 'data:font/ttf;base64,AAEAAA==', pixel: false };
  let id = null;
  step(doc, (d) => { id = O.look.addFont(d, font); O.look.set(d, ['tokens', 'fontText'], id); });
  assert.equal(id, 'dot');
  assert.deepEqual(doc.value.fonts, { dot: { name: 'Dot', src: font.src, pixel: false } });
  assert.equal(doc.value.ui.tokens.fontText, 'dot');
  assert.equal(O.look.addFont(doc, Object.assign({}, font, { id: 'again' })), 'dot', 'the same file twice is the one font');
  assert.equal(O.look.addFont(doc, Object.assign({}, font, { src: 'data:font/ttf;base64,AAEAAB==' })), 'dot-2', 'another file wanting the name gets the next');
  doc.undo();
  assert.equal(Object.keys(doc.value.fonts).length, 1, 'that was a step of its own');
  step(doc, (d) => O.look.editFont(d, 'dot', { pixel: true, px: 8 }));
  assert.deepEqual(doc.value.fonts.dot, { name: 'Dot', src: font.src, pixel: true, px: 8 });
  // Taken out, it takes its uses with it: the letters go back to the look's own.
  step(doc, (d) => O.look.editFont(d, 'dot', null));
  assert.ok(!('fonts' in doc.value) && !('ui' in doc.value), 'no fonts, and no look naming one');
  for (let i = 0; i < 3; i++) doc.undo();
  assert.deepEqual(doc.value, before, 'and every step undoes to the game as it was');
});

test('look ops: a font with a long name is kept under an id the look can still name', () => {
  const doc = KIT.document(blank());
  const long = 'a'.repeat(63);
  const src = (n) => 'data:font/ttf;base64,AAEAA' + 'ABCD'[n] + '==';
  const ids = [];
  step(doc, (d) => { for (let n = 0; n < 3; n++) ids.push(O.look.addFont(d, { id: long, name: 'Long', src: src(n) })); });
  assert.equal(new Set(ids).size, 3, 'three files, three fonts');
  for (const id of ids) {
    assert.ok(id.length <= 64, `${id.length} letters`);
    assert.notEqual(KIT.look.family(id, doc.value.fonts), id, `${id} is a font the look can use`);
  }
});

// ---- the Look panel and its preview, their pure halves -----------------------------------
require(path.join(__dirname, '..', '..', 'js/kit/editor/look-preview.js'));
require(path.join(__dirname, '..', '..', 'js/kit/editor/panel-look.js'));

test('look preview: the sample line is the game\'s own, a face preferred', () => {
  const sample = KIT.editor.lookPreview.sample;
  const say = (who, text, face) => Object.assign({ t: 'say', who, text }, face ? { face } : {});
  const p = {
    scripts: { intro: { body: [say('', 'Narration nobody says.'), say('Mom', 'Up you get.')] } },
    maps: { town: { objects: [{ pages: [{ on: { interact: [{ t: 'if', then: [say('Pip', 'Hi!', 'pip-face')] }] } }] }] } },
  };
  assert.deepEqual(sample(p), { who: 'Pip', face: 'pip-face', text: 'Hi!' }, 'the first with a portrait, however deep it is');
  delete p.maps;
  assert.deepEqual(sample(p), { who: 'Mom', face: null, text: 'Up you get.' }, 'else the first said by somebody');
  const none = sample({ cast: { mira: { name: 'Mira Vale' } } });
  assert.equal(none.who, 'Mira Vale', 'with nobody talking yet, the first of the cast says the kit\'s line');
  assert.match(none.text, /\{fx:wave\}/, 'which shows an effect, a colour and a pause');
  assert.equal(sample({}).who, 'Mira');
  // A page that scrolls shows it on the next page: the line goes on for a
  // page more, so Try's tap scrolls rather than closing a one-page line.
  const look = (pageTurn, lines) => ({ dialogue: { pageTurn, lines } });
  assert.deepEqual(sample(p, look('clear', 3)), { who: 'Mom', face: null, text: 'Up you get.' }, 'a page that clears: the line as it is');
  for (const lines of [2, 3, 6]) {
    const scrolled = sample(p, look('scroll', lines)).text.split('\n');
    assert.equal(scrolled[0], 'Up you get.', 'the game\'s own line first');
    assert.ok(scrolled.length >= lines + 1, `${lines} to a page: at least ${lines + 1} lines (${scrolled.length})`);
  }
  assert.equal(sample(p).text, 'Up you get.', 'and the project\'s own line is left as it was');
});

test('look panel: a path in the look opens the section it is set in', () => {
  const sectionOf = KIT.editor.lookPanel.sectionOf;
  assert.equal(sectionOf(['tokens', 'ink']), 'colours');
  assert.equal(sectionOf(['tokens', 'toastInk']), 'toast', 'a toast\'s colours are with the toast');
  assert.equal(sectionOf(['tokens', 'padA']), 'pad');
  assert.equal(sectionOf(['dialogue', 'lines']), 'box');
  assert.equal(sectionOf(['cursor', 'glyph']), 'cursor');
  assert.equal(sectionOf(['sounds', 'move']), 'sounds');
  assert.equal(sectionOf(['voice']), 'sounds');
  assert.equal(sectionOf(['base']), 'start');
  assert.equal(sectionOf([]), 'start');
  assert.equal(sectionOf(['tokens', 'fontText']), 'fonts', 'the fonts and text size are with the fonts');
  assert.equal(sectionOf(['tokens', 'lineHeight']), 'fonts');
  assert.equal(sectionOf(['dialogue', 'speeds', 'slow']), 'typing', 'how the words arrive has a section of its own');
  assert.equal(sectionOf(['dialogue', 'pageTurn']), 'typing');
  assert.equal(sectionOf(['dialogue', 'at']), 'box', 'where the box goes is the box\'s');
  const sectionFor = KIT.editor.lookPanel.sectionFor;
  assert.deepEqual(sectionFor(['fonts', 'dot']), ['fonts', 'dot'], 'a problem with a font file opens Fonts at that font');
  assert.deepEqual(sectionFor(['ui', 'tokens', 'ink']), ['colours', 'ink']);
  assert.ok(KIT.registry('editorPanels').get('look').section === 'look', 'the panel is in the Look group');
});
