'use strict';
// The pure half of the writing side of Creator Mode: the script editor's commit
// path, the dialogue index, the variables index and the import dispatch.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('./_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));
R('js/kit/world/map.js');
R('js/kit/import/tiled.js'); R('js/kit/import/rpgmaker.js'); R('js/kit/import/aseprite.js'); R('js/kit/import/merge.js');
R('js/kit/editor/ops.js');
R('js/kit/editor/script-editor.js');
R('js/kit/editor/panels-writing.js');
R('js/kit/editor/panels-project.js');

const SE = KIT.editor.scriptEditor;
const W = KIT.editor.writing;
const PP = KIT.editor.projectPanels;
const IMPP = KIT.editor.importPanel;

const tiles = KIT.registry('tiles');
for (const t of [{ id: 'grass', group: 'nature' }, { id: 'path', group: 'nature' }]) if (!tiles.has(t.id)) tiles.add(t);

/** A small project with one map, one event with scripts, and a common event. */
function demo() {
  const raw = KIT.project.blank();
  const mapId = Object.keys(raw.maps)[0];
  raw.maps[mapId].objects = [{
    id: 'mom', name: 'Mom', type: 'npc', x: 3, y: 4,
    pages: [{
      on: {
        interact: [
          { t: 'say', who: 'Mom', text: 'Take care out there.' },
          { t: 'if', when: { kind: 'var', name: 'chapter', op: '>=', value: 1 }, then: [{ t: 'say', text: 'And come back for dinner.' }], else: [] },
          { t: 'choice', prompt: 'Ready?', options: [{ text: 'Yes', when: null, then: [{ t: 'setVar', name: 'ready', op: 'set', value: true }] }, { text: 'Not yet', when: null, then: [] }] },
        ],
        step: [{ t: 'comment', text: 'she notices you' }],
      },
    }],
  }];
  raw.scripts = { intro: { label: 'Intro', trigger: 'auto', when: null, params: [], body: [{ t: 'say', text: 'Once upon a time.' }, { t: 'setVar', name: 'chapter', op: 'set', value: 1 }], note: '' } };
  raw.items = { berry: { kind: 'item', name: 'Berry', desc: 'Sweet and red.' } };
  raw.fragments = [{ id: 'frag-1', kind: 'dialogue', title: 'Overheard', body: 'Old man: The road is long.', tags: ['town'], folder: '' }];
  raw.vars = { chapter: { type: 'number', default: 0, label: 'Chapter', group: 'Story' } };
  const { project } = KIT.project.normalize(raw);
  return { project, mapId };
}
/** An `ed`-shaped stub: what the script editor needs to commit. */
function fakeEd(project) {
  const doc = KIT.document(project);
  return {
    state: { doc, project: doc.value },
    commit(label, fn) { return doc.transaction(label, () => fn(doc, KIT.editor.ops)); },
    doc,
  };
}

// ---- the script editor's commit path -------------------------------------------------

test('script editor: the screenplay round-trips through the commit path', () => {
  const { project, mapId } = demo();
  const ed = fakeEd(project);
  const path0 = ['maps', mapId, 'objects', 0, 'pages', 0, 'on', 'interact'];
  const before = KIT.deepClone(ed.doc.get(path0));
  const text = SE.serialize(before);
  assert.match(text, /^Mom: Take care out there\./m);
  assert.match(text, /@if when: chapter >= 1/);
  assert.match(text, /^\? Ready\?/m);
  const r = SE.commitText(ed, path0, text, 'Edit script (text)');
  assert.equal(r.problems.length, 0, 'the canonical text reads clean');
  assert.equal(SE.serialize(ed.doc.get(path0)), text, 'the text comes back the same, command for command');
  assert.deepEqual(ed.doc.get(path0).map(c => c.t), before.map(c => c.t), 'nothing is dropped or reordered');
  assert.deepEqual(ed.doc.get(path0), KIT.commands.normalizeAll(before).map(fillNested), 'the only change is that defaults are written out');
  // and it settles: a second trip through the text view writes nothing at all
  const again = SE.commitText(ed, path0, SE.serialize(ed.doc.get(path0)));
  assert.equal(again.changed, false, 'the second round-trip is a no-op');
  assert.equal(ed.doc.history.length, 1);
});

/** normalizeAll only fills the top level; nested branches are normalized by the parser too. */
function fillNested(cmd) {
  const out = KIT.deepClone(cmd);
  for (const n of KIT.commands.nested(out)) {
    const list = KIT.path.get(out, n.path).map(c => fillNested(KIT.commands.normalize(c)));
    KIT.path.get(out, n.path.slice(0, -1))[n.path[n.path.length - 1]] = list;
  }
  return out;
}

test('script editor: editing the text is one undo step, and nothing is lost', () => {
  const { project, mapId } = demo();
  const ed = fakeEd(project);
  const p = ['maps', mapId, 'objects', 0, 'pages', 0, 'on', 'interact'];
  const text = SE.serialize(ed.doc.get(p)) + '\nMom: One more thing.\nthis line is not a command';
  const r = SE.commitText(ed, p, text);
  assert.equal(r.changed, true);
  assert.equal(ed.doc.history.length, 1, 'one undo step for the whole text');
  const after = ed.doc.get(p);
  assert.equal(after.length, 5);
  assert.deepEqual(after[3], { t: 'say', who: 'Mom', text: 'One more thing.', face: null, position: 'bottom', bg: 'window', voice: null });
  assert.deepEqual(after[4], { t: 'raw', line: 'this line is not a command' }, 'an unreadable line survives as a raw line');
  assert.equal(r.problems.length, 1);
  assert.equal(r.problems[0].raw, 'this line is not a command');
  assert.equal(text.split('\n')[r.problems[0].line - 1], 'this line is not a command', 'the problem points at the right line');
  ed.doc.undo();
  assert.equal(ed.doc.get(p).length, 3, 'undo puts the script back');
});

test('script editor: a raw line round-trips through serialize/parse untouched', () => {
  const cmds = [{ t: 'raw', line: '@whatever this is' }, { t: 'say', text: 'hi', who: '' }];
  const back = SE.roundTrip(cmds);
  assert.equal(back.length, 2);
  assert.deepEqual(back[0], { t: 'raw', line: '@whatever this is' });
  assert.equal(back[1].t, 'say');
});

test('script editor: every command in the kit survives a round-trip', () => {
  const skip = new Set(['raw']);
  for (const def of KIT.commands.list()) {
    if (skip.has(def.id)) continue;
    const cmd = SE.newCommand(def.id);
    const back = SE.roundTrip([cmd]);
    assert.equal(back.length, 1, `${def.id}: one command in, one out`);
    assert.equal(back[0].t, cmd.t, `${def.id}: still itself (got ${back[0].t})`);
  }
});

test('script editor: list operations are one undo step each', () => {
  const { project, mapId } = demo();
  const ed = fakeEd(project);
  const p = ['maps', mapId, 'objects', 0, 'pages', 0, 'on', 'interact'];
  ed.commit('add', (doc) => SE.insert(doc, p, 0, SE.newCommand('wait')));
  assert.equal(ed.doc.get(p)[0].t, 'wait');
  assert.equal(ed.doc.history.length, 1);
  ed.commit('move', (doc) => SE.move(doc, p, 0, 2));
  assert.equal(ed.doc.get(p)[2].t, 'wait');
  ed.commit('dup', (doc) => SE.duplicate(doc, p, 2));
  assert.equal(ed.doc.get(p).length, 5);
  ed.commit('off', (doc) => SE.setDisabled(doc, p, 2, true));
  assert.equal(ed.doc.get(p)[2].disabled, true);
  ed.commit('del', (doc) => SE.remove(doc, p, 2));
  assert.equal(ed.doc.get(p).length, 4);
  assert.equal(ed.doc.history.length, 5, 'five edits, five undo steps');
  // a disabled command still serializes and parses back with its flag
  const cmds = [Object.assign(SE.newCommand('say'), { text: 'quiet', disabled: true })];
  assert.equal(SE.roundTrip(cmds)[0].disabled, true);
});

test('script editor: insert into a slot that does not exist yet', () => {
  const { project, mapId } = demo();
  const ed = fakeEd(project);
  const p = ['maps', mapId, 'objects', 0, 'pages', 0, 'on', 'touch'];
  ed.commit('add', (doc) => SE.insert(doc, p, 0, SE.newCommand('say')));
  assert.equal(ed.doc.get(p).length, 1);
  assert.equal(ed.doc.history.length, 1);
});

test('script editor: branches, describe and the picker', () => {
  const { project, mapId } = demo();
  const list = project.maps[mapId].objects[0].pages[0].on.interact;
  const branches = SE.branches(list[1]);
  assert.deepEqual(branches.map(b => b.label), ['Then', 'Else']);
  const choice = SE.branches(list[2]);
  assert.deepEqual(choice.map(b => b.label), ['“Yes”', '“Not yet”']);
  assert.deepEqual(choice[0].path, ['options', 0, 'then']);
  const says = SE.describe(list);
  assert.match(says, /says 2 lines/);
  assert.match(says, /asks a question/);
  assert.equal(SE.describe([]), 'Nothing here yet — add the first command.');
  const picker = SE.pickerGroups({ query: 'text' });
  assert.ok(picker.groups.length);
  assert.ok(picker.groups[0].items.some(d => d.id === 'say'), 'searching "text" finds Show Text by its MV name');
  assert.ok(SE.pickerGroups({}).favourites.some(d => d.id === 'say'));
  assert.equal(SE.labelOf('say'), 'Show Text');
});

test('script editor: a selection names the command list it opens', () => {
  const { project, mapId } = demo();
  assert.deepEqual(SE.pathForSelection(project, { kind: 'slot', map: mapId, id: 'mom', page: 0, slot: 'interact' }),
    ['maps', mapId, 'objects', 0, 'pages', 0, 'on', 'interact']);
  assert.deepEqual(SE.pathForSelection(project, { kind: 'script', path: ['scripts', 'intro'] }), ['scripts', 'intro', 'body']);
  assert.equal(SE.pathForSelection(project, { kind: 'map', id: mapId }), null);
  assert.match(SE.labelForSelection(project, { kind: 'slot', map: mapId, id: 'mom', page: 0, slot: 'interact' }), /^Mom · On Interact$/, 'what its docstring promises, and what every other panel calls the slot');
  assert.equal(SE.labelForSelection(project, { kind: 'script', path: ['scripts', 'intro'] }), 'Common Event: Intro');
});

// ---- the dialogue index ---------------------------------------------------------------

test('dialogue index: finds every piece of text, with the path the inspector would patch', () => {
  const { project, mapId } = demo();
  const rows = W.textIndex(project);
  const at = (p) => rows.find(r => r.id === p.join('/'));
  const slot = ['maps', mapId, 'objects', 0, 'pages', 0, 'on', 'interact'];

  const hello = at(slot.concat(0, 'text'));
  assert.ok(hello, 'the first Show Text is in the table');
  assert.equal(hello.text, 'Take care out there.');
  assert.equal(hello.speaker, 'Mom');
  assert.equal(hello.where.map, mapId);
  assert.equal(hello.where.object, 'mom');
  assert.equal(hello.where.page, 0);
  assert.equal(hello.where.slot, 'interact');
  assert.match(hello.label, /Mom/);

  assert.ok(at(slot.concat(1, 'then', 0, 'text')), 'text inside a conditional branch is found');
  assert.ok(at(slot.concat(2, 'prompt')), 'a choice prompt is found');
  assert.equal(at(slot.concat(2, 'options', 0, 'text')).text, 'Yes', 'and every option');
  assert.equal(at(slot.concat(2, 'options', 1, 'text')).text, 'Not yet');
  assert.equal(at(['maps', mapId, 'objects', 0, 'pages', 0, 'on', 'step', 0, 'text']).text, 'she notices you');
  assert.equal(at(['scripts', 'intro', 'body', 0, 'text']).text, 'Once upon a time.');
  assert.equal(at(['items', 'berry', 'desc']).text, 'Sweet and red.');
  assert.equal(at(['fragments', 0, 'body']).text, 'Old man: The road is long.');
  assert.ok(at(['meta', 'pitch']), 'the pitch is in there too');

  // nothing else in the project holds prose, and every path really points at its text
  for (const r of rows) assert.equal(KIT.path.get(project, r.path) == null ? '' : KIT.path.get(project, r.path), r.text, r.id);
  const setVarRow = rows.find(r => r.command === 'setVar');
  assert.equal(setVarRow, undefined, 'a command with no text field contributes nothing');
});

test('dialogue index: a row edits through the same patch as the inspector', () => {
  const { project, mapId } = demo();
  const ed = fakeEd(project);
  const row = W.textIndex(ed.state.project).find(r => r.text === 'Take care out there.');
  ed.commit('Edit text', (doc, O) => O.setField(doc, row.path, 'Mind the ledges.', 'Edit text'));
  assert.equal(ed.doc.get(['maps', mapId, 'objects', 0, 'pages', 0, 'on', 'interact', 0, 'text']), 'Mind the ledges.');
  assert.equal(ed.doc.history.length, 1);
  assert.deepEqual(W.selectionFor(row), { kind: 'slot', map: mapId, id: 'mom', page: 0, slot: 'interact' });
});

test('dialogue index: the first line is one readable line', () => {
  assert.equal(W.firstLine('Hello\nthere'), 'Hello');
  assert.equal(W.firstLine('   \n  second line '), 'second line');
  assert.equal(W.firstLine(''), '');
  assert.equal(W.firstLine('x'.repeat(80)).length, 60);
});

test('problems: every validator code has a plain-English meaning', () => {
  const { project } = demo();
  delete project.meta.pitch;
  project.maps[Object.keys(project.maps)[0]].objects[0].x = 999;
  const problems = KIT.project.validate(project);
  assert.ok(problems.length);
  for (const p of problems) {
    const text = W.explain(p.code);
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 20, `${p.code} deserves a real explanation`);
  }
  assert.match(W.explain('no-pitch'), /two sentences/i);
  assert.deepEqual(W.problemSelection({ where: { script: 'intro' } }), { kind: 'script', path: ['scripts', 'intro'] });
});

test('fragments: search, tags and dropping one into an open script', () => {
  const { project, mapId } = demo();
  const ed = fakeEd(project);
  assert.deepEqual(W.fragmentTags(ed.state.project), [{ tag: 'town', n: 1 }]);
  assert.equal(W.matchFragment(ed.state.project.fragments[0], { query: 'road' }), true);
  assert.equal(W.matchFragment(ed.state.project.fragments[0], { query: 'road', tag: 'forest' }), false);
  const p = ['maps', mapId, 'objects', 0, 'pages', 0, 'on', 'interact'];
  const r = ed.commit('Use fragment', (doc) => W.fragmentToSlot(doc, { fragment: 'frag-1', path: p }));
  assert.equal(r.added, 1);
  assert.equal(ed.doc.get(p).length, 4);
  assert.equal(ed.doc.get(p)[3].who, 'Old man');
  assert.equal(ed.doc.history.length, 1, 'one undo step');
});

// ---- the variables index ---------------------------------------------------------------

test('variables index: reads and writes are told apart', () => {
  const { project, mapId } = demo();
  const index = PP.varIndex(project);
  const byName = Object.fromEntries(index.map(v => [v.name, v]));

  assert.ok(byName.chapter.declared, 'chapter is declared');
  assert.equal(byName.chapter.reads.length, 1, 'the conditional branch reads it');
  assert.equal(byName.chapter.writes.length, 1, 'the intro writes it');
  assert.equal(byName.chapter.reads[0].map, mapId);
  assert.equal(byName.chapter.reads[0].object, 'mom');
  assert.equal(byName.chapter.writes[0].script, 'intro');

  assert.equal(byName.ready.declared, false, 'ready is used but never declared');
  assert.equal(byName.ready.writes.length, 1);
  assert.equal(byName.ready.reads.length, 0);
  assert.deepEqual(PP.undeclared(project).map(v => v.name), ['ready']);
  assert.equal(index[0].declared, true, 'declared variables come first');
  assert.match(PP.usageLabel(project, byName.chapter.writes[0]), /Intro/);
  assert.match(PP.usageLabel(project, { map: mapId, object: 'mom', slot: 'interact' }), / · On Interact$/, 'the Variables panel names a slot the way the Script editor does');
  assert.deepEqual(PP.usageSelection(byName.chapter.reads[0]), { kind: 'slot', map: mapId, id: 'mom', page: 0, slot: 'interact' });
  assert.equal(PP.guessType('introDone'), 'bool');
  assert.equal(PP.guessType('chapter'), 'number');
  assert.equal(PP.defaultFor('bool'), false);
});

test('variables: declaring one from the panel is one undo step and stops the warning', () => {
  const { project } = demo();
  const ed = fakeEd(project);
  assert.ok(KIT.project.validate(ed.state.project).some(p => p.code === 'undeclared-var'));
  ed.commit('Declare ready', (doc, O) => O.declareVar(doc, { name: 'ready', type: 'bool', default: false, label: 'Ready' }));
  assert.equal(ed.doc.history.length, 1);
  assert.equal(KIT.project.validate(ed.doc.value).some(p => p.code === 'undeclared-var'), false);
  assert.equal(PP.varIndex(ed.doc.value).find(v => v.name === 'ready').declared, true);
});

// ---- the Data panel ---------------------------------------------------------------------

test('data panel: the selection picks the path, and bad JSON never applies', () => {
  const { project, mapId } = demo();
  assert.deepEqual(PP.dataPath(project, { kind: 'object', map: mapId, id: 'mom' }).path, ['maps', mapId, 'objects', 0]);
  assert.deepEqual(PP.dataPath(project, { kind: 'slot', map: mapId, id: 'mom', page: 0, slot: 'interact' }).path,
    ['maps', mapId, 'objects', 0, 'pages', 0, 'on', 'interact']);
  assert.deepEqual(PP.dataPath(project, { kind: 'script', path: ['scripts', 'intro'] }).path, ['scripts', 'intro']);
  assert.deepEqual(PP.dataPath(project, null).path, []);
  assert.equal(PP.checkData(project, ['items', 'berry'], '{ oops').ok, false);
  assert.equal(PP.checkData(project, ['items', 'berry'], '{"name":"Berry"}').ok, true);
  const whole = PP.checkData(project, [], JSON.stringify(project));
  assert.equal(whole.ok, true);
  assert.match(whole.message, /project/i);
  assert.equal(PP.checkData(project, [], '42').ok, false, 'a number is not a project');
});

// ---- the import dispatch -----------------------------------------------------------------

test('import dispatch: the right importer by name and by content', () => {
  const tiledMap = JSON.stringify({ type: 'map', width: 2, height: 2, tilewidth: 16, tileheight: 16, layers: [], tilesets: [] });
  const tiledSet = JSON.stringify({ type: 'tileset', name: 'outside', tilewidth: 16, tileheight: 16, tilecount: 4, columns: 2, image: 'outside.png' });
  const aseSheet = JSON.stringify({ frames: [{ frame: { x: 0, y: 0, w: 16, h: 24 } }], meta: { app: 'aseprite', image: 'hero.png', size: { w: 16, h: 24 } } });

  let d = IMPP.dispatch([{ name: 'town.tmj', text: tiledMap }]);
  assert.equal(d.tool, 'tiled');
  assert.equal(d.kind, 'map');

  d = IMPP.dispatch([{ name: 'outside.tsj', text: tiledSet }, { name: 'outside.png', bytes: new Uint8Array([0x89, 0x50]) }]);
  assert.equal(d.tool, 'tiled');
  assert.equal(d.kind, 'tileset');
  assert.equal(d.images.length, 1, 'the image comes along as an asset');

  d = IMPP.dispatch([{ name: 'hero.json', text: aseSheet }, { name: 'hero.png', bytes: new Uint8Array([0x89, 0x50]) }]);
  assert.equal(d.tool, 'aseprite');
  assert.equal(d.kind, 'sheet');

  d = IMPP.dispatch([{ name: 'hero.aseprite', bytes: new Uint8Array([1, 2, 3, 4]) }]);
  assert.equal(d.tool, 'aseprite');
  assert.equal(d.kind, 'file', 'the extension decides before any content is read');

  d = IMPP.dispatch([{ name: 'data/Map001.json', text: '{"data":[]}' }, { name: 'data/MapInfos.json', text: '[]' }, { name: 'data/System.json', text: '{}' }, { name: 'img/tiles/Outside_A2.png', bytes: new Uint8Array([0x89, 0x50]) }]);
  assert.equal(d.tool, 'rpgmaker');
  assert.equal(d.kind, 'project');
  assert.equal(d.files.length, 3, 'every .json goes to the importer');
  assert.equal(d.images.length, 1);

  d = IMPP.dispatch([{ name: 'hero.png', bytes: new Uint8Array([0x89, 0x50]) }]);
  assert.equal(d.tool, 'image', 'a picture on its own goes to the slicer, not nowhere');
  assert.equal(d.main.name, 'hero.png');

  d = IMPP.dispatch([{ name: 'notes.txt', text: 'hello' }]);
  assert.equal(d.tool, null);
  assert.equal(d.problems[0].code, 'unknown-format');
});

test('import dispatch: PNG headers give the image size', () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47], 0);
  png[16] = 0; png[17] = 0; png[18] = 1; png[19] = 0x00;   // 256
  png[20] = 0; png[21] = 0; png[22] = 0; png[23] = 0x40;   // 64
  assert.deepEqual(IMPP.imageSize(png), { w: 256, h: 64 });
  assert.equal(IMPP.imageSize(new Uint8Array(2)), null);
});

test('import: a real Tiled map merges into a document as one undo step', () => {
  const { project } = demo();
  const doc = KIT.document(project);
  const json = {
    type: 'map', width: 2, height: 2, tilewidth: 16, tileheight: 16, infinite: false,
    layers: [{ type: 'tilelayer', name: 'ground', width: 2, height: 2, data: [1, 1, 1, 1] }],
    tilesets: [{ firstgid: 1, name: 'outside', tilewidth: 16, tileheight: 16, tilecount: 1, columns: 1, image: 'outside.png', imagewidth: 16, imageheight: 16 }],
  };
  const result = KIT.import.tiled.map(json, { name: 'meadow.tmj', asset: () => ({ id: 'outside', src: 'data:image/png;base64,AA==', w: 16, h: 16 }) });
  const before = Object.keys(doc.value.maps).length;
  const report = KIT.import.merge(doc, result, { source: 'Tiled map meadow.tmj' });
  assert.equal(Object.keys(doc.value.maps).length, before + 1);
  assert.equal(doc.history.length, 1, 'the whole import is one undo step');
  assert.ok(report.added.maps >= 1);
  doc.undo();
  assert.equal(Object.keys(doc.value.maps).length, before);
});
