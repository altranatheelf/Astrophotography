'use strict';
// KIT.import.tiled: the Tiled (.tmj/.tmx/.tsj/.tsx) importer.
// Fixtures: test/fixtures/tiled/ (regenerate with `node test/fixtures/tiled/make.js`).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const KIT = require('./_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));
R('js/kit/core/assets.js');
R('js/kit/import/tiled.js');

const TILED = KIT.import.tiled;
const FIX = path.join(__dirname, '..', 'fixtures', 'tiled');
const text = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');
const json = (name) => JSON.parse(text(name));

// The caller's image resolver: a path -> a project asset. Deterministic, as required.
const SIZES = { 'tiles.png': { w: 64, h: 16 }, 'sprite.png': { w: 16, h: 16 } };
function asset(src) {
  const base = String(src).split('/').pop();
  const size = SIZES[base] || { w: 0, h: 0 };
  return { id: KIT.slug(base.replace(/\.png$/, '')), src: `assets/${base}`, w: size.w, h: size.h };
}
const mapOpts = (extra) => Object.assign({ asset, id: 'town', tilesets: { 'outside.tsj': json('outside.tsj'), 'outside.tsx': text('outside.tsx') } }, extra || {});
const errorsOf = (problems) => problems.filter(p => p.severity === 'error');
const codes = (problems) => problems.map(p => p.code);
const byId = (list, id) => list.find(t => t.id === id);

// ---------------------------------------------------------------------------
test('tiled: detect knows maps, tilesets and nonsense', () => {
  assert.equal(TILED.detect(json('town.tmj')), 'map');
  assert.equal(TILED.detect(json('outside.tsj')), 'tileset');
  assert.equal(TILED.detect(text('town.tmx')), 'map');
  assert.equal(TILED.detect(text('outside.tsx')), 'tileset');
  assert.equal(TILED.detect({ hello: 'world' }), null);
  assert.equal(TILED.detect('not json at all {'), null);
  assert.equal(TILED.detect(null), null);
  assert.equal(TILED.any(json('outside.tsj'), { asset }).tiles.length, 4);
  assert.throws(() => TILED.any({ hello: 'world' }), /not a Tiled/);
  assert.throws(() => TILED.map(json('outside.tsj'), { asset }), /not a Tiled map/);
});

test('tiled: gid flip bits are read exactly as the spec describes them', () => {
  assert.deepEqual(TILED.gid(0), { id: 0, h: false, v: false, d: false, r120: false, flipped: false });
  assert.equal(TILED.gid(0x80000002 >>> 0).id, 2);
  assert.equal(TILED.gid(0x80000002 >>> 0).h, true);
  assert.equal(TILED.gid(0x40000003 >>> 0).v, true);
  assert.equal(TILED.gid(0x20000004 >>> 0).d, true);
  assert.equal(TILED.gid(0x10000005 >>> 0).r120, true);
  assert.equal(TILED.gid(0xF0000006 >>> 0).id, 6);
});

// ---------------------------------------------------------------------------
test('tiled: tileset -> image-backed tiles, Kit flags, animation, collision, leftover props', () => {
  const res = TILED.tileset(json('outside.tsj'), { asset });
  assert.deepEqual(errorsOf(res.problems), []);
  assert.deepEqual(res.tiles.map(t => t.id), ['outside:grass', 'outside:wall', 'outside:water', 'outside:water-b']);

  // the sheet became one asset, and every tile is image-backed art
  assert.deepEqual(res.assets, { tiles: { kind: 'image', src: 'assets/tiles.png', w: 64, h: 16, from: 'tiled:outside' } });
  const grass = byId(res.tiles, 'outside:grass');
  assert.deepEqual(grass.art, { image: 'tiles', frame: { x: 0, y: 0, w: 16, h: 16 } });
  assert.ok(KIT.pixels.isImageArt(KIT.pixels.artOf(grass)));

  // flags from typed custom properties; unknown ones survive verbatim on props
  assert.equal(grass.encounter, true);
  assert.equal(grass.terrainTag, 2);
  assert.deepEqual(grass.props, { footstep: 'soft', rarity: 0.25 });

  // a full-tile collision box -> solid; the tile class is kept on props
  const wall = byId(res.tiles, 'outside:wall');
  assert.equal(wall.solid, true);
  assert.equal(wall.props.class, 'wall');

  // an animation -> frames + one animMs; a thin edge strip -> per-edge passage
  const water = byId(res.tiles, 'outside:water');
  assert.deepEqual(water.art, { image: 'tiles', frames: [{ x: 32, y: 0, w: 16, h: 16 }, { x: 48, y: 0, w: 16, h: 16 }] });
  assert.equal(water.animMs, 400);
  assert.equal(KIT.pixels.frameCount(water.art), 2);
  assert.equal(water.bush, true);
  assert.equal(water.ledge, 'down');
  assert.deepEqual(water.passage, { n: false, s: true, e: true, w: true });
  assert.equal(water.solid, undefined);

  // the wang set became a terrain plus a (one-rule) autotile group
  assert.deepEqual(res.project.terrains, [{ id: 1, name: 'Grass', color: '#58b848', base: null }]);
  const group = res.project.autotiles.default.groups[0];
  assert.equal(group.terrain, 1);
  assert.deepEqual(group.rules.map(r => r.tiles[0]), ['outside:grass']);
  assert.equal(res.stats.tiles, 4);
});

test('tiled: every produced tile survives the tiles registry', () => {
  const res = TILED.tileset(json('outside.tsj'), { asset });
  const reg = KIT.registry('tiles');
  for (const def of res.tiles) reg.add(Object.assign({ replace: true }, def));
  assert.equal(reg.get('outside:water').animMs, 400);
  assert.equal(KIT.tiles.flags('outside:wall').solid, true);
  assert.deepEqual(KIT.tiles.flags('outside:water').passage, { n: false, s: true, e: true, w: true });
  assert.equal(KIT.tiles.frameAt(reg.get('outside:water'), 500), 1);
  for (const def of res.tiles) reg.remove(def.id);
});

test('tiled: a tileset with no resolver still imports, with an asset-unresolved problem', () => {
  const res = TILED.tileset(json('outside.tsj'), {});
  assert.deepEqual(errorsOf(res.problems), []);
  assert.ok(codes(res.problems).includes('asset-unresolved'));
  assert.equal(res.assets.tiles.src, 'tiles.png');
  assert.equal(res.tiles.length, 4);
});

test('tiled: opts.prefix namespaces every generated id', () => {
  const res = TILED.tileset(json('outside.tsj'), { prefix: 'outside-pack' });
  assert.deepEqual(res.tiles.map(t => t.id), ['outside-pack:outside:grass', 'outside-pack:outside:wall', 'outside-pack:outside:water', 'outside-pack:outside:water-b']);
  assert.deepEqual(Object.keys(res.assets), ['outside-pack:tiles']);
});

// ---------------------------------------------------------------------------
test('tiled: map layers land by name, tiles by gid, and flips fall back with a warn', () => {
  const res = TILED.map(json('town.tmj'), mapOpts());
  assert.deepEqual(errorsOf(res.problems), []);
  const m = res.maps.town;
  assert.equal(m.width, 6);
  assert.equal(m.height, 5);
  assert.equal(m.kind, 'outdoor');
  assert.equal(m.music, 'town');

  const at = (layer, x, y) => m.layers[layer][y * m.width + x];
  assert.equal(at('ground', 0, 0), 'outside:grass');
  assert.equal(at('ground', 2, 1), 'outside:water');
  assert.equal(at('deco', 1, 2), 'outside:wall');
  assert.equal(at('deco', 0, 0), null);
  assert.equal(m.layers.ground.length, 30);
  assert.equal(m.layers.terrain.length, 30);

  // the flipped wall keeps its tile, and says so once
  assert.equal(at('ground', 4, 1), 'outside:wall');
  const flip = res.problems.filter(p => p.code === 'flipped-tile');
  assert.equal(flip.length, 1);
  assert.equal(flip[0].severity, 'warn');
  assert.match(flip[0].message, /flipped horizontally on 1 cell \(first at 4, 1\)/);

  // ground/deco were matched by name, so nothing had to be guessed
  assert.deepEqual(res.problems.filter(p => p.code === 'layer-guess'), []);
  assert.equal(res.stats.width, 6);
  assert.equal(res.stats.objects, 3);
});

test('tiled: unnamed layers fall back to ground/deco/above in order, with layer-guess', () => {
  const src = json('town.tmj');
  src.layers[0].name = 'Base';
  src.layers[1].name = 'Trees';
  src.layers.push(Object.assign({}, src.layers[1], { id: 9, name: 'Roofs' }));
  src.layers.push(Object.assign({}, src.layers[1], { id: 10, name: 'Extra' }));
  const res = TILED.map(src, mapOpts());
  const guesses = res.problems.filter(p => p.code === 'layer-guess');
  assert.deepEqual(guesses.map(p => p.severity), ['info', 'info', 'info']);
  assert.match(guesses[0].message, /'Base' -> 'ground'/);
  assert.match(guesses[1].message, /'Trees' -> 'deco'/);
  assert.match(guesses[2].message, /'Roofs' -> 'above'/);
  const over = res.problems.filter(p => p.code === 'layer-overflow');
  assert.equal(over.length, 1);
  assert.match(over[0].message, /'Extra'/);
  const m = res.maps.town;
  assert.equal(m.layers.above[2 * 6 + 1], 'outside:wall');
});

test('tiled: objects land on the right tiles with the right types', () => {
  const res = TILED.map(json('town.tmj'), mapOpts());
  const m = res.maps.town;
  assert.deepEqual(m.objects.map(o => [o.id, o.type, o.x, o.y]), [
    ['mom', 'npc', 2, 2],      // tile object: bottom-left anchored, y = 48px -> row 2
    ['door', 'warp', 5, 4],    // rectangle: top-left anchored
    ['meadow', 'trigger', 1, 3],
  ]);

  // the npc inherited its class and sprite from the tile it uses
  const mom = m.objects[0].pages[0];
  assert.equal(mom.sprite, 'woman');
  assert.equal(mom.behaviour.kind, 'look');
  assert.equal(mom.props.mood, 'cheerful');

  // the warp read map/x/y/dir into props.to
  const door = m.objects[1].pages[0];
  assert.deepEqual(door.props.to, { map: 'home', x: 3, y: 7 });
  assert.equal(door.props.dir, 'up');
  assert.equal(door.layer, 'below');
  assert.equal(door.through, true);

  // an unclassed rectangle becomes an invisible trigger keeping its properties
  const meadow = m.objects[2].pages[0];
  assert.equal(meadow.visible, false);
  assert.equal(meadow.props.zone, 'meadow');
  assert.equal(meadow.props.steps, 4);
  assert.equal(meadow.props.secret, true);
  assert.deepEqual([meadow.props.width, meadow.props.height], [2, 2]);

  // the class-'collision' object painted the collision array instead
  assert.equal(m.collision[3 * 6 + 3], 1);
  assert.equal(m.collision[3 * 6 + 4], 1);
  assert.equal(m.collision[3 * 6 + 2], null);
});

test('tiled: a collision tile layer sets the map collision array', () => {
  const src = json('town.tmj');
  const data = new Array(30).fill(0);
  data[0] = 2;                                   // the wall tile
  data[1] = 2;
  src.layers.splice(2, 0, { data, height: 5, id: 8, name: 'collision', opacity: 1, type: 'tilelayer', visible: true, width: 6, x: 0, y: 0 });
  const res = TILED.map(src, mapOpts());
  const m = res.maps.town;
  assert.equal(m.collision[0], 1);
  assert.equal(m.collision[1], 1);
  assert.equal(m.collision[2], null);
  assert.deepEqual(res.problems.filter(p => p.code === 'layer-guess'), []);
});

test('tiled: a dialogue property becomes a runnable say script', async () => {
  const res = TILED.map(json('town.tmj'), mapOpts());
  const script = res.maps.town.objects[0].pages[0].on.interact;
  assert.deepEqual(script.map(c => c.t), ['say', 'say']);
  assert.equal(script[0].who, 'Mom');
  const ctx = KIT.interpreter.fakeCtx({ self: 'town:mom' });
  const run = await KIT.interpreter.run(script, ctx);
  assert.equal(run.status, 'done');
  assert.deepEqual(ctx.said(), ['Good morning!', 'Mind the water.']);
});

test('tiled: plain text (not screenplay) becomes a single say with the object as speaker', async () => {
  const src = json('town.tmj');
  src.layers[2].objects[0].properties[0].value = 'It is a fine morning.';
  const res = TILED.map(src, mapOpts());
  const script = res.maps.town.objects[0].pages[0].on.interact;
  assert.deepEqual(script.map(c => c.t), ['say']);
  assert.equal(script[0].who, 'Mom');
  const ctx = KIT.interpreter.fakeCtx();
  await KIT.interpreter.run(script, ctx);
  assert.deepEqual(ctx.said(), ['It is a fine morning.']);
});

// ---------------------------------------------------------------------------
test('tiled: base64 + zlib decodes to exactly what the csv map produced', () => {
  const csv = TILED.map(json('town.tmj'), mapOpts());
  const zipped = TILED.map(json('town-zlib.tmj'), mapOpts());
  assert.deepEqual(errorsOf(zipped.problems), []);
  assert.deepEqual(zipped.maps.town, csv.maps.town);
});

test('tiled: base64 without compression works, and an unknown codec is a problem, not a throw', () => {
  const src = json('town.tmj');
  const raw = Buffer.alloc(30 * 4);
  src.layers[0].data.forEach((g, i) => raw.writeUInt32LE(g >>> 0, i * 4));
  src.layers[0].encoding = 'base64';
  src.layers[0].data = raw.toString('base64');
  const plain = TILED.map(src, mapOpts());
  assert.deepEqual(errorsOf(plain.problems), []);
  assert.deepEqual(plain.maps.town.layers.ground, TILED.map(json('town.tmj'), mapOpts()).maps.town.layers.ground);

  const zstd = json('town-zlib.tmj');
  for (const l of zstd.layers) if (l.type === 'tilelayer') l.compression = 'brotli';
  const res = TILED.map(zstd, mapOpts());
  const bad = res.problems.filter(p => p.code === 'compressed-unsupported');
  assert.equal(bad.length, 1);
  assert.equal(bad[0].severity, 'error');
  assert.equal(res.maps.town.layers.ground.every(v => v === null), true);
});

test('tiled: corrupt compressed data says what the decoder said, not "pass opts.inflate"', () => {
  // The decoder ran and refused; its reason used to be swallowed and the author
  // told to supply a decoder that would have failed the same way.
  const src = json('town-zlib.tmj');
  const layer = src.layers.find(l => l.type === 'tilelayer');
  const bytes = Buffer.from(layer.data, 'base64');
  for (let i = 2; i < Math.min(bytes.length, 12); i++) bytes[i] = 0xff;      // past the zlib header: a broken stream
  layer.data = bytes.toString('base64');
  const res = TILED.map(src, mapOpts());
  const bad = res.problems.find(p => p.code === 'bad-layer-data');
  assert.ok(bad, 'reported as bad data: ' + JSON.stringify(res.problems.map(p => p.code + ' ' + p.message)));
  assert.equal(bad.severity, 'error');
  assert.doesNotMatch(bad.message, /opts\.inflate/);
  assert.equal(res.problems.some(p => p.code === 'compressed-unsupported'), false, 'and not as a missing decoder');
});

test('tiled: prepare() turns compressed data into plain gid arrays', async () => {
  const prepared = await TILED.prepare(json('town-zlib.tmj'));
  assert.equal(prepared.layers[0].compression, undefined);
  assert.equal(prepared.layers[0].encoding, undefined);
  assert.equal(Array.isArray(prepared.layers[0].data), true);
  const res = TILED.map(prepared, mapOpts());
  assert.deepEqual(res.maps.town.layers.ground, TILED.map(json('town.tmj'), mapOpts()).maps.town.layers.ground);
});

test('tiled: an infinite map is cropped to its used bounds and everything is offset', () => {
  const finite = TILED.map(json('town.tmj'), mapOpts());
  const infinite = TILED.map(json('town-infinite.tmj'), mapOpts());
  assert.deepEqual(errorsOf(infinite.problems), []);
  const bounds = infinite.problems.filter(p => p.code === 'infinite-bounds');
  assert.equal(bounds.length, 1);
  assert.match(bounds[0].message, /used area is 6x5 tiles at \(-13, -14\)/);
  assert.deepEqual(infinite.maps.town, finite.maps.town);
});

test('tiled: the TMX/TSX XML path produces the same map as the JSON path', () => {
  const fromJson = TILED.map(json('town.tmj'), mapOpts());
  const fromXml = TILED.map(text('town.tmx'), mapOpts());
  assert.deepEqual(errorsOf(fromXml.problems), []);
  assert.deepEqual(fromXml.maps.town, fromJson.maps.town);
  assert.deepEqual(fromXml.tiles, fromJson.tiles);
  assert.deepEqual(fromXml.assets, fromJson.assets);

  const tsxRes = TILED.tileset(text('outside.tsx'), { asset });
  const tsjRes = TILED.tileset(json('outside.tsj'), { asset });
  assert.deepEqual(tsxRes.tiles, tsjRes.tiles);
  assert.deepEqual(tsxRes.project.terrains, tsjRes.project.terrains);
});

test('tiled: the XML reader handles entities, CDATA, comments and multiline property bodies', () => {
  const tmx = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- a comment with <angles> -->',
    '<map version="1.10" orientation="orthogonal" width="1" height="1" tilewidth="16" tileheight="16" infinite="0">',
    ' <properties>',
    '  <property name="note">line one',
    'line two</property>',
    '  <property name="title" value="Ben &amp; Ann&apos;s &quot;place&quot;"/>',
    ' </properties>',
    ' <layer id="1" name="ground" width="1" height="1"><data encoding="csv"><![CDATA[0]]></data></layer>',
    '</map>',
  ].join('\n');
  const j = TILED.fromXml(tmx);
  assert.equal(j.type, 'map');
  assert.equal(j.properties[0].value, 'line one\nline two');
  assert.equal(j.properties[1].value, 'Ben & Ann\'s "place"');
  const res = TILED.map(tmx, { asset, id: 'tiny' });
  assert.equal(res.maps.tiny.note, 'line one\nline two');        // a 'note' property becomes the map note
  assert.equal(res.maps.tiny.props.title, 'Ben & Ann\'s "place"');
  assert.throws(() => TILED.fromXml('<nonsense/>'), /not a Tiled/);
});

test('tiled: a missing external tileset is reported, never thrown', () => {
  const res = TILED.map(json('town.tmj'), { asset, id: 'town' });
  const missing = res.problems.filter(p => p.code === 'external-tileset-missing');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].severity, 'warn');
  assert.equal(res.maps.town.layers.ground[0], 'outside:0');   // still referenced, just without art
  assert.deepEqual(errorsOf(res.problems), []);
});

// ---------------------------------------------------------------------------
test('tiled: an external tileset that was supplied but will not parse says so', () => {
  // It used to be reported as "was not supplied", which sent the author to
  // look for a file they had already given.
  const res = TILED.map(json('town.tmj'), { asset, id: 'town', tilesets: { 'outside.tsj': '{ "this is": not json', 'outside.tsx': '<tileset name="x" this is broken' } });
  const bad = res.problems.filter(p => p.code === 'external-tileset-bad');
  assert.equal(bad.length, 1, JSON.stringify(res.problems.map(p => p.code + ' ' + p.message)));
  assert.match(bad[0].message, /could not be read/);
  assert.equal(res.problems.some(p => p.code === 'external-tileset-missing'), false, 'not "was not supplied"');
});

test('tiled: ids are stable across two imports and the result replaces rather than duplicates', () => {
  const a = TILED.map(json('town.tmj'), mapOpts());
  const b = TILED.map(json('town.tmj'), mapOpts());
  assert.equal(KIT.stableStringify(a), KIT.stableStringify(b));
  assert.deepEqual(Object.keys(a.maps), Object.keys(b.maps));
  assert.deepEqual(a.tiles.map(t => t.id), b.tiles.map(t => t.id));
  assert.deepEqual(Object.keys(a.assets), Object.keys(b.assets));

  // folding the same import twice into a project leaves one map and one set of tiles
  const project = { maps: {}, assets: {} };
  for (const res of [a, b]) {
    Object.assign(project.maps, res.maps);
    Object.assign(project.assets, res.assets);
  }
  assert.deepEqual(Object.keys(project.maps), ['town']);
  assert.deepEqual(Object.keys(project.assets), ['tiles', 'sprite']);
});

function homeMap() {
  const home = KIT.project.newMap({ id: 'home', name: 'Home', width: 8, height: 8, kind: 'indoor' });
  home.layers.ground = home.layers.ground.map(() => 'outside:grass');
  return home;
}

test('tiled: the imported map normalizes with no error problems', () => {
  const res = TILED.map(json('town.tmj'), mapOpts());
  const reg = KIT.registry('tiles');
  for (const def of res.tiles) reg.add(Object.assign({ replace: true }, def));
  const raw = {
    version: 3,
    meta: { id: 'tiled-demo', title: 'Tiled Demo', pitch: 'A tiny town. The hero wants out.' },
    settings: res.project.settings,
    terrains: res.project.terrains,
    autotiles: res.project.autotiles,
    assets: res.assets,
    maps: Object.assign({ home: homeMap() }, res.maps),   // the warp's target map has to exist
    start: { map: 'town', x: 0, y: 0, dir: 'down' },
  };
  const out = KIT.project.normalize(raw);
  assert.deepEqual(errorsOf(out.problems), []);
  const m = out.project.maps.town;
  assert.equal(m.width, 6);
  assert.equal(m.objects.length, 3);
  assert.equal(m.objects[0].pages[0].props.mood, 'cheerful');       // unknown props survive normalize
  assert.deepEqual(m.objects[1].pages[0].props.to, { map: 'home', x: 3, y: 7 });
  assert.equal(out.project.settings.tileSize, 16);
  assert.equal(KIT.project.cellSolid(m, 4, 1), true);               // the (unflipped) wall tile
  assert.equal(KIT.project.cellSolid(m, 3, 3), true);               // painted by the collision object
  assert.equal(KIT.project.cellSolid(m, 0, 0), false);
  for (const def of res.tiles) reg.remove(def.id);
});

test('tiled: groups, image layers, shapes, rotation and out-of-bounds are handled or reported', () => {
  const src = json('town.tmj');
  src.layers = [
    { type: 'group', id: 20, name: 'stuff', layers: [src.layers[0], { type: 'imagelayer', id: 21, name: 'sky', image: 'sky.png' }] },
    src.layers[1], src.layers[2],
  ];
  src.layers[2].objects.push({ id: 9, name: 'Zone', type: '', x: 16, y: 16, rotation: 45, polygon: [{ x: 0, y: 0 }, { x: 16, y: 0 }], properties: [] });
  src.layers[2].objects.push({ id: 11, name: 'Ghost', type: 'npc', x: 600, y: 600, properties: [] });
  const res = TILED.map(src, mapOpts());
  assert.deepEqual(errorsOf(res.problems), []);
  for (const code of ['group-flattened', 'imagelayer-skipped', 'object-rotation', 'shape-unsupported', 'object-out-of-bounds']) {
    assert.ok(codes(res.problems).includes(code), `expected a '${code}' problem`);
  }
  const m = res.maps.town;
  assert.equal(m.layers.ground[0], 'outside:grass');            // the grouped layer still landed on ground
  assert.equal(m.objects.some(o => o.id === 'ghost'), false);   // the out-of-bounds object was skipped
  const zone = m.objects.find(o => o.id === 'zone');
  assert.equal(zone.type, 'trigger');
  assert.equal(zone.pages[0].props.shape, 'polygon');
  assert.equal(zone.pages[0].props.points.length, 2);
});

test('tiled: an object template fills in what the instance leaves out', () => {
  const template = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<template><object name="Sign" type="sign" width="16" height="16">',
    ' <properties><property name="text" value="Keep out."/><property name="look" value="post"/></properties>',
    '</object></template>',
  ].join('\n');
  const src = json('town.tmj');
  src.layers[2].objects.push({ id: 12, name: 'Notice', template: 'thing.tx', x: 0, y: 4 * 16, properties: [{ name: 'look', type: 'string', value: 'plank' }] });
  const res = TILED.map(src, mapOpts({ templates: { 'thing.tx': template } }));
  const notice = res.maps.town.objects.find(o => o.id === 'notice');
  assert.equal(notice.type, 'sign');                 // class came from the template
  assert.deepEqual([notice.x, notice.y], [0, 4]);
  assert.equal(notice.pages[0].props.look, 'plank'); // the instance overrode one property
  assert.deepEqual(notice.pages[0].on.interact.map(c => c.text), ['Keep out.']);

  const missing = TILED.map(src, mapOpts());
  assert.ok(codes(missing.problems).includes('template-unresolved'));
  assert.deepEqual(errorsOf(missing.problems), []);
});

test("tiled: the tileset's objectalignment moves its tile objects", () => {
  const aligned = json('outside.tsj');
  aligned.objectalignment = 'topleft';
  const src = json('town.tmj');
  src.layers[2].objects.push({ id: 13, name: 'Bush', type: 'sign', gid: 3, x: 0, y: 2 * 16, width: 16, height: 16, properties: [] });
  const bottom = TILED.map(src, mapOpts()).maps.town.objects.find(o => o.id === 'bush');
  const top = TILED.map(src, mapOpts({ tilesets: { 'outside.tsj': aligned } })).maps.town.objects.find(o => o.id === 'bush');
  assert.deepEqual([bottom.x, bottom.y], [0, 1]);    // unspecified = bottom-left
  assert.deepEqual([top.x, top.y], [0, 2]);          // topleft, like a rectangle
  assert.equal(top.pages[0].props.look, 'outside:water');
});
