'use strict';
// KIT.import.merge — folding an importer Result into a project (docs/IMPORT-CONTRACT.md).
// The fixtures are the real ones the three importers ship, so this test also
// proves the three of them land in one project together.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const KIT = require('./_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));
R('js/kit/core/assets.js');
R('js/kit/import/tiled.js'); R('js/kit/import/rpgmaker.js'); R('js/kit/import/aseprite.js'); R('js/kit/import/merge.js');

const FIX = path.join(__dirname, '..', 'fixtures');
const read = (p) => fs.readFileSync(path.join(FIX, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const SIZES = { 'tiles.png': { w: 64, h: 16 }, 'sprite.png': { w: 16, h: 16 }, 'sheet.png': { w: 96, h: 16 },
  'Villagers.png': { w: 96, h: 96 }, 'People1.png': { w: 64, h: 32 }, 'Willow_A2.png': { w: 128, h: 96 }, 'Willow_B.png': { w: 128, h: 128 } };
function asset(src) {
  const file = String(src).split(/[\\/]/).pop();
  const size = SIZES[file] || { w: 0, h: 0 };
  return { id: KIT.slug(file.replace(/\.[a-z]+$/i, '')), src: 'assets/' + file, w: size.w, h: size.h };
}

// `home.tmj` is another Tiled file that is not part of this import; the CLI
// points such a warp at a map the project already has, so the test does too.
const mapId = (name) => (/^home/.test(name) ? 'start' : null);
const tiledResult = (opts) => KIT.import.tiled.map(json('tiled/town.tmj'),
  Object.assign({ asset, mapId, tilesets: { 'outside.tsj': json('tiled/outside.tsj') } }, opts));
function mvFiles() {
  const dir = path.join(FIX, 'rpgmaker', 'data');
  const out = {};
  for (const f of fs.readdirSync(dir)) out[f] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  return out;
}
const mvResult = (opts) => KIT.import.rpgmaker.project(mvFiles(), Object.assign({ asset }, opts));
const aseResult = (opts) => KIT.import.aseprite.sheet(json('aseprite/sheet-hash.json'), Object.assign({ asset }, opts));

// Art normally comes from js/art/*.js, which these tests do not load: the blank
// project paints its map with 'grass' and gives its heroes the two hero sprites,
// so those three have to exist before the validator is asked anything.
if (!KIT.registry('tiles').has('grass')) KIT.registry('tiles').add({ id: 'grass', name: 'Grass', group: 'nature' });
// 'woman' is the sprite the Tiled fixture's NPC asks for by name, the way an
// author points at art the game already has.
for (const id of ['hero-boy', 'hero-girl', 'woman']) if (!KIT.registry('sprites').has(id)) KIT.registry('sprites').add({ id, name: id });
const blank = () => KIT.project.blank({ id: 'merge-test', title: '' });
const errorsOf = (problems) => problems.filter(p => p.severity === 'error');

test('merge: a Tiled map lands in the project and in the registries', () => {
  const p = blank();
  const res = tiledResult({ prefix: 'outside' });
  const rep = KIT.import.merge(p, res, { source: 'tiled' });

  assert.equal(rep.added.maps, 1);
  assert.equal(rep.added.tiles, res.tiles.length);
  assert.equal(rep.added.assets, Object.keys(res.assets).length);
  assert.equal(rep.added.objects, 3, 'the map brought its three objects with it');
  assert.ok(p.maps['outside:map'], 'the map is on the project');
  assert.ok(p.tiles['outside:outside:grass'], 'the tiles are a content table on the project');
  assert.equal(p.assets.tiles.src, 'assets/tiles.png');
  assert.equal(KIT.registry('tiles').get('outside:outside:grass').art.image, 'tiles');
  assert.ok(KIT.assets.has('tiles'), 'the image is in the assets registry');
  assert.equal(rep.label, 'Import tiled');
  assert.deepEqual(errorsOf(rep.problems), []);
});

test('merge: the project still normalizes with no errors (contract §4.3)', () => {
  const p = blank();
  KIT.import.merge(p, tiledResult({ prefix: 'outside' }), { source: 'tiled' });
  const n = KIT.project.normalize(p);
  assert.deepEqual(errorsOf(n.problems).map(x => x.code + ': ' + x.message), []);
  assert.equal(n.project.maps['outside:map'].width, 6);
  assert.ok(n.project.tiles, 'the content table survives normalize');
  assert.ok(n.project.world.maps['outside:map'], 'the world index gained the map');
});

test('merge: re-importing the same file changes nothing at all', () => {
  const p = blank();
  p.terrains = [];                       // the blank project's own Grass terrain is not what is being tested here
  KIT.import.merge(p, tiledResult({ prefix: 'outside' }), { source: 'tiled' });
  const after = KIT.deepClone(p);
  const rep = KIT.import.merge(p, tiledResult({ prefix: 'outside' }), { source: 'tiled' });
  assert.deepEqual(p, after, 'the second import left the project identical');
  assert.equal(rep.added.maps + rep.added.tiles + rep.replaced.maps + rep.replaced.tiles, 0);
  assert.ok(rep.unchanged.tiles > 0);
  assert.deepEqual(rep.problems.filter(x => x.code === 'duplicate-id'), [], 'the same value is not a collision');
  assert.ok(rep.problems.some(x => x.code === 'nothing-to-merge'));

  // ...and so does re-importing with --overwrite.
  const rep2 = KIT.import.merge(p, tiledResult({ prefix: 'outside' }), { source: 'tiled', overwrite: true });
  assert.deepEqual(p, after);
  assert.equal(rep2.replaced.tiles, 0);
});

test('merge: a real collision is kept, unless overwrite says otherwise', () => {
  const p = blank();
  KIT.import.merge(p, tiledResult({ prefix: 'outside' }), { source: 'tiled' });
  p.tiles['outside:outside:grass'].name = 'hand-edited';

  const rep = KIT.import.merge(p, tiledResult({ prefix: 'outside' }), { source: 'tiled' });
  assert.equal(p.tiles['outside:outside:grass'].name, 'hand-edited', 'the edit survived');
  assert.equal(rep.skipped.tiles, 1);
  const dup = rep.problems.find(x => x.code === 'duplicate-id');
  assert.ok(dup && /outside:outside:grass/.test(dup.message) && /overwrite/.test(dup.message));

  const rep2 = KIT.import.merge(p, tiledResult({ prefix: 'outside' }), { source: 'tiled', overwrite: true });
  assert.equal(p.tiles['outside:outside:grass'].name, 'grass', 'overwrite took the imported one');
  assert.equal(rep2.replaced.tiles, 1);
  assert.deepEqual(rep2.problems.filter(x => x.code === 'duplicate-id'), []);
});

test('merge: dryRun touches nothing but still counts', () => {
  const p = blank();
  const before = KIT.deepClone(p);
  const rep = KIT.import.merge(p, tiledResult({ prefix: 'dry' }), { source: 'tiled', dryRun: true });
  assert.deepEqual(p, before, 'a dry run is not a merge');
  assert.equal(rep.added.maps, 1);
  assert.ok(rep.added.tiles > 0);
  assert.equal(rep.registered, 0, 'and it registers nothing');
  assert.equal(KIT.registry('tiles').has('dry:outside:grass'), false);
});

test('merge: a document gets one undo step called "Import <source>"', () => {
  const doc = KIT.document(blank());
  const before = KIT.deepClone(doc.value);
  const rep = KIT.import.merge(doc, tiledResult({ prefix: 'doc' }), { source: 'tiled map' });
  assert.equal(rep.label, 'Import tiled map');
  assert.deepEqual(doc.history, ['Import tiled map'], 'exactly one step');
  assert.ok(doc.value.maps['doc:map']);
  assert.equal(doc.canUndo(), true);
  doc.undo();
  assert.deepEqual(doc.value, before, 'one undo puts the project back');
});

test('merge: the prefix option namespaces ids and rewrites what points at them', () => {
  const p = blank();
  const plain = tiledResult({});                       // no prefix from the importer
  const rep = KIT.import.merge(p, plain, { prefix: 'Town Square', source: 'tiled' });
  assert.deepEqual(errorsOf(rep.problems), []);
  const map = p.maps['town-square:map'];
  assert.ok(map, 'the map id is namespaced: ' + Object.keys(p.maps).join(', '));
  assert.ok(p.tiles['town-square:outside:grass'], 'and so are the tiles');
  assert.equal(map.layers.ground[0], 'town-square:outside:grass', 'the map cells point at the new ids');
  assert.equal(map.objects.find(o => o.type === 'npc').name, 'Mom', 'names are prose, not ids');
  const groups = p.autotiles.default.groups;
  assert.equal(groups[0].rules[0].tiles[0], 'town-square:outside:grass', 'autotile rules follow too');

  // Prefixing twice is the same as prefixing once.
  const again = KIT.import.merge.prefix(KIT.import.merge.prefix(plain, 'Town Square'), 'Town Square');
  assert.deepEqual(Object.keys(again.maps), ['town-square:map']);
});

test('merge: RPG Maker brings scripts, vars, items, sprites and faces', () => {
  const p = blank();
  const res = mvResult({ prefix: 'mv' });
  const rep = KIT.import.merge(p, res, { source: 'rpgmaker' });
  assert.equal(rep.added.maps, 2);
  assert.equal(rep.added.scripts, Object.keys(res.scripts).length);
  assert.equal(rep.added.vars, 3);
  assert.equal(rep.added.items, 1);
  assert.ok(rep.added.sprites >= 8 && rep.added.faces >= 8);
  assert.equal(p.vars.chapter.type, 'number');
  assert.ok(KIT.registry('sprites').has(res.sprites[0].id));
  assert.ok(KIT.registry('faces').has(res.faces[0].id));
  // The MV project wanted to start on its own map; ours already has a start.
  assert.ok(rep.problems.some(x => x.code === 'project-field-kept'));
  assert.equal(p.start.map, 'start');

  const n = KIT.project.normalize(p);
  assert.deepEqual(errorsOf(n.problems).map(x => x.code + ': ' + x.message), []);
});

test('merge: a blank project takes the title and start of what it imports', () => {
  const p = blank();
  p.meta.title = '';
  delete p.start.map;
  KIT.import.merge(p, mvResult({ prefix: 'mv' }), { source: 'rpgmaker' });
  assert.equal(p.meta.title, 'Willow Town');
  assert.equal(p.start.map, 'mv:willow-town');
});

test('merge: a different tile size is a warning, not a silent mess', () => {
  const p = blank();
  p.settings.tileSize = 16;
  const res = mvResult({ prefix: 'mv', tileSize: 48 });
  const rep = KIT.import.merge(p, res, { source: 'rpgmaker' });
  const warn = rep.problems.find(x => x.code === 'tile-size-mismatch');
  assert.ok(warn && warn.severity === 'warn' && /48/.test(warn.message) && /16/.test(warn.message));
  assert.equal(p.settings.tileSize, 16, 'the project keeps its own size');
  const rep2 = KIT.import.merge(p, res, { source: 'rpgmaker', overwrite: true });
  assert.equal(p.settings.tileSize, 48);
  assert.ok(rep2.problems.some(x => x.code === 'tile-size-mismatch'));
});

test('merge: Aseprite sprites, and animations are stored with a note that nothing plays them', () => {
  const p = blank();
  const res = aseResult({ prefix: 'hero' });
  const rep = KIT.import.merge(p, res, { source: 'aseprite' });
  assert.equal(rep.added.sprites, 1);
  assert.equal(rep.added.animations, 1);
  assert.ok(p.animations['hero:sheet-blink'], 'the animation is kept, not dropped');
  assert.ok(rep.problems.some(x => x.code === 'animations-stored'));
  assert.equal(KIT.registry('sprites').get('hero:sheet').image, 'sheet');
});

test('merge: all three importers into one project, then registerContent brings it back', () => {
  const p = blank();
  KIT.import.merge(p, tiledResult({ prefix: 'outside' }), { source: 'tiled' });
  KIT.import.merge(p, mvResult({ prefix: 'mv' }), { source: 'rpgmaker' });
  KIT.import.merge(p, aseResult({ prefix: 'hero' }), { source: 'aseprite' });
  const n = KIT.project.normalize(p);
  assert.deepEqual(errorsOf(n.problems).map(x => x.code + ': ' + x.message), []);
  assert.equal(Object.keys(n.project.maps).length, 4, 'one Tiled map, two MV maps and the blank one');

  // Everything the project carries can be registered again from the project alone.
  KIT.registry('tiles').clear(); KIT.registry('sprites').clear(); KIT.assets.clear();
  const counts = KIT.project.registerContent(n.project);
  KIT.registry('tiles').add({ id: 'grass', name: 'Grass', group: 'nature' });
  for (const id of ['hero-boy', 'hero-girl', 'woman']) KIT.registry('sprites').add({ id, name: id });
  assert.equal(counts.tiles, Object.keys(n.project.tiles).length);
  assert.ok(counts.assets >= 6 && counts.sprites >= 9);
  assert.ok(KIT.registry('tiles').has('outside:outside:grass'));

  // And it survives a round trip through the content files.
  const files = KIT.project.exportFiles(n.project);
  const back = KIT.project.importFiles(files);
  assert.deepEqual(back.tiles, n.project.tiles);
  assert.deepEqual(back.maps['outside:map'], n.project.maps['outside:map']);
  assert.deepEqual(back.assets, n.project.assets);
});

test('merge: objects with no map of their own are reported, not dropped silently', () => {
  const p = blank();
  const rep = KIT.import.merge(p, { objects: [{ id: 'a' }, { id: 'b' }], problems: [] }, { source: 'test' });
  const prob = rep.problems.find(x => x.code === 'objects-without-map');
  assert.ok(prob && prob.severity === 'warn');
  assert.equal(rep.skipped.objects, 2);
});

test('merge: bad input is a throw, everything else is data', () => {
  assert.throws(() => KIT.import.merge(null, {}), TypeError);
  assert.throws(() => KIT.import.merge(blank(), 'nope'), TypeError);
});
