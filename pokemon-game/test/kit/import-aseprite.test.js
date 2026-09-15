'use strict';
// KIT.import.aseprite: the Aseprite sheet-export (--data) and binary (.aseprite) importer.
// Fixtures: test/fixtures/aseprite/ (regenerate with `node test/fixtures/aseprite/make.js`).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const KIT = require('./_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));
R('js/kit/core/assets.js');
R('js/kit/world/map.js');
R('js/kit/world/entities.js');
R('js/kit/import/aseprite.js');

const ASE = KIT.import.aseprite;
const FIX = path.join(__dirname, '..', 'fixtures', 'aseprite');
const text = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');
const json = (name) => JSON.parse(text(name));
const bin = (name) => new Uint8Array(fs.readFileSync(path.join(FIX, name)));

// The caller's image resolver, exactly as the CLI and the browser panel supply one.
function asset(src) {
  const base = String(src).split('/').pop();
  return { id: KIT.slug(base.replace(/\.png$/, '')), src: `assets/${base}`, w: 96, h: 16 };
}
const errorsOf = (problems) => problems.filter(p => p.severity === 'error');
const codes = (problems) => problems.map(p => p.code);
const byId = (list, id) => list.find(x => x.id === id);

// ---------------------------------------------------------------------------
test('aseprite: detect knows sheet data, .aseprite bytes and nonsense', () => {
  assert.equal(ASE.detect(json('sheet-hash.json')), 'sheet');
  assert.equal(ASE.detect(json('sheet-array.json')), 'sheet');
  assert.equal(ASE.detect(text('sheet-hash.json')), 'sheet');        // JSON text is fine too
  assert.equal(ASE.detect(json('slices.json')), 'sheet');
  assert.equal(ASE.detect(bin('hero.aseprite')), 'file');
  assert.equal(ASE.detect(bin('blob.aseprite')), 'file');
  assert.equal(ASE.detect(bin('sheet.png')), null);                  // a PNG is neither
  assert.equal(ASE.detect({ hello: 'world' }), null);
  assert.equal(ASE.detect('not json at all {'), null);
  assert.equal(ASE.detect(null), null);
  assert.equal(ASE.any(json('sheet-hash.json'), { asset, id: 'hero' }).sprites.length, 1);
  assert.equal(ASE.any(bin('hero.aseprite'), { id: 'hero' }).sprites.length, 1);
  // Only input that is not the format at all throws; everything else is a problem.
  assert.throws(() => ASE.any({ hello: 'world' }), /neither a sheet export nor/);
  assert.throws(() => ASE.sheet({ hello: 'world' }), /not an Aseprite sheet export/);
  assert.throws(() => ASE.file(bin('sheet.png')), /not an \.aseprite file/);
});

test('aseprite: the tag-name reader finds a direction in every spelling Aseprite users write', () => {
  assert.equal(ASE.direction('walk-down'), 'down');
  assert.equal(ASE.direction('walk_left'), 'left');
  assert.equal(ASE.direction('walkUp'), 'up');
  assert.equal(ASE.direction('Walk Right'), 'right');
  assert.equal(ASE.direction('idle-north'), 'up');
  assert.equal(ASE.direction('run west'), 'left');
  assert.equal(ASE.direction('attack'), null);
  assert.equal(ASE.direction(''), null);
  // The motion word does not name the sprite; anything else does.
  assert.deepEqual(ASE.split('walk-down'), { dir: 'down', action: '', motion: true });
  assert.deepEqual(ASE.split('idle-down'), { dir: 'down', action: 'idle', motion: false });
  // Aseprite's four loop directions (src/doc/anidir.cpp).
  assert.deepEqual(ASE.tagFrames(0, 3, 'forward'), [0, 1, 2, 3]);
  assert.deepEqual(ASE.tagFrames(0, 3, 'reverse'), [3, 2, 1, 0]);
  assert.deepEqual(ASE.tagFrames(0, 3, 'pingpong'), [0, 1, 2, 3, 2, 1]);
  assert.deepEqual(ASE.tagFrames(0, 3, 'pingpong_reverse'), [3, 2, 1, 0, 1, 2]);
  assert.deepEqual(ASE.tagFrames(2, 2, 'forward'), [2]);
});

// ---------------------------------------------------------------------------
test('aseprite: json-hash and json-array exports of one sprite produce identical results', () => {
  const hash = ASE.sheet(json('sheet-hash.json'), { asset, id: 'hero' });
  const array = ASE.sheet(json('sheet-array.json'), { asset, id: 'hero' });
  assert.equal(hash.stats.format, 'json-hash');
  assert.equal(array.stats.format, 'json-array');
  delete hash.stats.format; delete array.stats.format;               // the only thing that may differ
  assert.equal(KIT.stableStringify(hash), KIT.stableStringify(array));
  // ... and re-importing is byte-for-byte the same, so a second import replaces rather than duplicates.
  const again = ASE.sheet(json('sheet-hash.json'), { asset, id: 'hero' });
  delete again.stats.format;
  assert.deepEqual(again, hash);
});

test('aseprite: sheet tags become direction frame lists, and the rest become animations', () => {
  const res = ASE.sheet(json('sheet-hash.json'), { asset, id: 'hero' });
  assert.deepEqual(errorsOf(res.problems), []);

  // The sheet image is the one asset, recorded through the caller's resolver.
  assert.deepEqual(Object.keys(res.assets), ['sheet']);
  assert.deepEqual(res.assets.sheet, { kind: 'image', src: 'assets/sheet.png', w: 96, h: 16, from: 'aseprite:sheet.png' });

  // walk-down / walk_left / up all name the same sprite: 'walk' is a motion word, not a name.
  assert.deepEqual(res.sprites.map(s => s.id), ['hero']);
  const hero = res.sprites[0];
  assert.equal(hero.image, 'sheet');
  assert.equal(hero.w, 16);
  assert.equal(hero.h, 16);
  assert.deepEqual(Object.keys(hero.frames).sort(), ['down', 'left', 'up']);
  assert.deepEqual(hero.frames.down, [{ x: 0, y: 0, w: 16, h: 16 }, { x: 16, y: 0, w: 16, h: 16 }]);
  assert.deepEqual(hero.frames.left, [{ x: 32, y: 0, w: 16, h: 16 }]);
  assert.deepEqual(hero.durations.down, [100, 150]);                 // per-frame durations survive

  // 'blink' names no direction, so it is a stand-alone animation — and pingpong is expanded.
  assert.ok(codes(res.problems).includes('tag-direction'));
  assert.deepEqual(res.animations.map(a => a.id), ['hero-blink']);
  const blink = res.animations[0];
  assert.equal(blink.direction, 'pingpong');
  assert.equal(blink.repeat, 2);                                     // the exporter writes this as a string
  assert.deepEqual(blink.frames, [{ x: 64, y: 0, w: 16, h: 16 }, { x: 80, y: 0, w: 16, h: 16 }]);
  assert.equal(res.stats.tags, 4);
  assert.equal(res.stats.frames, 6);
});

test('aseprite: a trimmed frame keeps its spriteSourceSize so the sprite does not jitter', () => {
  const res = ASE.sheet(json('sheet-hash.json'), { asset, id: 'hero' });
  const up = res.sprites[0].frames.up[0];
  // The rectangle is the trimmed body in the sheet ...
  assert.equal(up.w, 12);
  assert.equal(up.h, 14);
  assert.equal(up.x, 3 * 16 + 2);
  assert.equal(up.y, 1);
  // ... and ox/oy/sw/sh say where it sits inside the untrimmed 16x16 frame.
  assert.deepEqual({ ox: up.ox, oy: up.oy, sw: up.sw, sh: up.sh }, { ox: 2, oy: 1, sw: 16, sh: 16 });
  assert.equal(res.sprites[0].h, 16);                                // the sprite is still 16 tall
  // Untrimmed frames stay plain rectangles, so nothing changes for the common case.
  assert.deepEqual(Object.keys(res.sprites[0].frames.down[0]), ['x', 'y', 'w', 'h']);
  const trimmed = res.problems.filter(p => p.code === 'trimmed-offset');
  assert.equal(trimmed.length, 1);                                   // reported once, not per frame
  assert.equal(trimmed[0].severity, 'info');
});

test('aseprite: a rotated frame warns and is dropped without renumbering its neighbours', () => {
  const res = ASE.sheet(json('sheet-rotated.json'), { asset, id: 'hero' });
  assert.deepEqual(errorsOf(res.problems), []);
  const rotated = res.problems.filter(p => p.code === 'rotated-frame');
  assert.equal(rotated.length, 1);
  assert.equal(rotated[0].severity, 'warn');
  assert.match(rotated[0].message, /Kit draws sheet rectangles upright/);

  const hero = res.sprites[0];
  assert.deepEqual(Object.keys(hero.frames).sort(), ['down', 'up']);  // 'left' was the rotated frame
  // Frame 3 is still frame 3: the hole does not shift the tags that follow it.
  assert.deepEqual(hero.frames.up, [{ x: 50, y: 1, w: 12, h: 14, ox: 2, oy: 1, sw: 16, sh: 16 }]);
  assert.deepEqual(res.animations[0].frames, [{ x: 64, y: 0, w: 16, h: 16 }, { x: 80, y: 0, w: 16, h: 16 }]);
  assert.ok(!codes(res.problems).includes('tag-range'));
});

test('aseprite: slices become faces, icons or plain named rectangles', () => {
  const res = ASE.sheet(json('slices.json'), { asset, id: 'atlas' });
  assert.deepEqual(errorsOf(res.problems), []);
  assert.deepEqual(res.faces.map(f => f.id), ['atlas-hero-face']);
  assert.deepEqual(res.icons.map(f => f.id), ['atlas-berry-icon']);
  assert.deepEqual(res.slices.map(f => f.id), ['atlas-panel', 'atlas-spark']);

  const face = res.faces[0];
  assert.deepEqual(face.art, { image: 'sheet', frame: { x: 0, y: 0, w: 16, h: 16 } });
  assert.equal(face.name, 'Hero Face');
  assert.equal(face.slice, 'hero face');
  assert.equal(face.color, '#0000ffff');

  const icon = res.icons[0];
  assert.deepEqual(icon.pivot, { x: 4, y: 4 });
  assert.equal(icon.note, 'a berry');                                // slice user data

  assert.deepEqual(byId(res.slices, 'atlas-panel').center, { x: 4, y: 4, w: 8, h: 8 });   // 9-patch
  // A slice with several keys moves across the animation; every key becomes a frame.
  assert.deepEqual(byId(res.slices, 'atlas-spark').art.frames.length, 2);
  assert.ok(codes(res.problems).includes('slice-animated'));

  // opts.kind steers slices that do not say what they are.
  const asFaces = ASE.sheet(json('slices.json'), { asset, id: 'atlas', kind: 'faces' });
  assert.deepEqual(asFaces.faces.map(f => f.id), ['atlas-hero-face', 'atlas-panel', 'atlas-spark']);
});

test('aseprite: opts.kind "tiles" slices a tagless grid into tiles, and opts.prefix namespaces ids', () => {
  const res = ASE.sheet(json('sheet-hash.json'), { asset, id: 'hero', kind: 'tiles' });
  assert.deepEqual(res.tiles.map(t => t.id), ['hero:0', 'hero:1', 'hero:2', 'hero:3', 'hero:4', 'hero:5']);
  assert.deepEqual(res.tiles[0].art, { image: 'sheet', frame: { x: 0, y: 0, w: 16, h: 16 } });
  assert.equal(res.project.settings.tileSize, 16);
  assert.equal(res.sprites.length, 0);
  assert.ok(codes(res.problems).includes('grid-uneven'));            // frame 3 is trimmed to 12x14

  const prefixed = ASE.sheet(json('sheet-hash.json'), { asset, id: 'hero', prefix: 'outside' });
  assert.deepEqual(prefixed.sprites.map(s => s.id), ['outside:hero']);
  assert.deepEqual(prefixed.animations.map(a => a.id), ['outside:hero-blink']);
});

test('aseprite: a sheet with no tags becomes one sprite, and a missing resolver is a problem not a crash', () => {
  const src = json('sheet-hash.json');
  src.meta.frameTags = [];
  const res = ASE.sheet(src, { id: 'hero' });                        // no opts.asset on purpose
  assert.deepEqual(errorsOf(res.problems), []);
  assert.ok(codes(res.problems).includes('asset-unresolved'));
  assert.equal(res.assets.sheet.src, 'sheet.png');                   // the original path is kept
  assert.equal(res.assets.sheet.w, 96);                              // ... sized from meta.size
  assert.deepEqual(res.sprites.map(s => s.id), ['hero']);
  assert.equal(res.sprites[0].frames.down.length, 6);                // every frame, under `down`
  assert.equal(res.sprites[0].frames.left, undefined);

  // The multiply-blended layer in meta.layers is recorded, not silently dropped.
  const blend = res.problems.find(p => p.code === 'blend-mode');
  assert.equal(blend.severity, 'info');
  assert.match(blend.message, /multiply/);
});

// ---------------------------------------------------------------------------
test('aseprite: the built-in inflate matches zlib (it is the browser path, where zlib is absent)', () => {
  for (const level of [0, 1, 6, 9]) {
    const data = Buffer.from('the quick brown fox jumps over the lazy dog'.repeat(40) + ' ÿ');
    const out = Buffer.from(ASE.zinflate(new Uint8Array(zlib.deflateSync(data, { level }))));
    assert.ok(out.equals(data), `level ${level}`);
  }
  assert.throws(() => ASE.zinflate(new Uint8Array([1, 2, 3, 4])), /deflate/);
});

test('aseprite: the binary parser reads the header, layers, tags, palette and slices', () => {
  const doc = ASE.parse(bin('hero.aseprite'));
  assert.equal(doc.header.width, 8);
  assert.equal(doc.header.height, 8);
  assert.equal(doc.header.frames, 2);
  assert.equal(doc.header.depth, 32);
  assert.equal(doc.header.mode, 'rgba');
  assert.equal(doc.colorProfile, 'srgb');
  assert.deepEqual(doc.layers.map(l => l.name), ['body', 'shade', 'hidden']);
  assert.deepEqual(doc.layers.map(l => l.opacity), [255, 128, 255]);
  assert.deepEqual(doc.layers.map(l => l.shown), [true, true, false]);
  assert.deepEqual(doc.layers.map(l => l.blend), ['normal', 'normal', 'normal']);
  assert.deepEqual(doc.frames.map(f => f.duration), [100, 150]);
  assert.deepEqual(doc.tags, [{ name: 'walk-down', from: 0, to: 1, direction: 'forward', repeat: 0, color: '#000000', data: null }]);
  assert.deepEqual(doc.palette[0], [216, 80, 80, 255]);
  assert.equal(doc.slices[0].name, 'head');
  // Both cel encodings are present in the fixture, and a linked cel in frame 1.
  assert.deepEqual(doc.frames[0].cels.map(c => c.type), [0, 2, 2]);
  assert.deepEqual(doc.frames[1].cels.map(c => c.type), [1, 2, 2]);
  assert.equal(doc.frames[1].cels[0].link, 0);
});

test('aseprite: the binary importer composites to native pixel-string art, pixel for pixel', () => {
  const res = ASE.file(bin('hero.aseprite'), { id: 'hero' });
  assert.deepEqual(errorsOf(res.problems), []);
  assert.equal(res.stats.native, true);
  assert.equal(Object.keys(res.assets).length, 0);                   // no PNG anywhere: this is the point

  const hero = res.sprites[0];
  assert.equal(hero.id, 'hero');
  assert.equal(hero.w, 8);
  assert.equal(hero.h, 8);
  assert.equal(hero.tag, 'walk-down');
  assert.deepEqual(Object.keys(hero.frames), ['down']);
  assert.deepEqual(hero.durations.down, [100, 150]);

  // Palette characters are handed out in first-appearance order, so the art is stable.
  assert.deepEqual(hero.palette, {
    a: '#d85050',       // the body layer's red
    b: '#7c4888',       // red under the 50%-opaque blue shade
    c: '#2040c0',       // the shade where it hangs off the body
    d: '#40c040',       // frame 1's green patch over nothing
    e: '#8c8848',       // ... and over the red body
  });
  // Frame 0: a 6x6 red block at (1,1) with a 4x4 blue patch at (5,5) at layer opacity 128.
  assert.deepEqual(hero.frames.down[0], [
    '........',
    '.aaaaaa.',
    '.aaaaaa.',
    '.aaaaaa.',
    '.aaaaaa.',
    '.aaaabbc',
    '.aaaabbc',
    '.....ccc',
  ]);
  // Frame 1: the body cel is LINKED to frame 0, so the block is unchanged; the shade
  // moved to a 2x2 green patch at (0,0).
  assert.deepEqual(hero.frames.down[1], [
    'dd......',
    'deaaaaa.',
    '.aaaaaa.',
    '.aaaaaa.',
    '.aaaaaa.',
    '.aaaaaa.',
    '.aaaaaa.',
    '........',
  ]);
  // The invisible 'hidden' layer is full magenta; if visibility were ignored, everything
  // above would be one colour.
  assert.ok(!Object.values(hero.palette).includes('#ff00ff'));
  assert.ok(codes(res.problems).includes('alpha-flattened'));

  // The art it produces is art KIT.pixels accepts, per direction and as a whole.
  assert.deepEqual(KIT.pixels.validate(ASE.artOf(hero, 'down')), []);
  assert.deepEqual(KIT.pixels.dims(ASE.artOf(hero, 'down')), { w: 8, h: 8 });
  assert.equal(KIT.pixels.frameCount(ASE.artOf(hero, 'down')), 2);

  // Slices come across as named rectangles in sprite space.
  assert.deepEqual(res.slices[0].rect, { x: 1, y: 1, w: 6, h: 3 });
  // Deterministic: the same bytes give the same result, so a re-import replaces.
  assert.deepEqual(ASE.file(bin('hero.aseprite'), { id: 'hero' }), res);
});

test('aseprite: indexed colour resolves through the palette, and index 0 is transparent', () => {
  const res = ASE.file(bin('blob.aseprite'), { id: 'blob' });
  assert.deepEqual(errorsOf(res.problems), []);
  assert.equal(res.stats.mode, 'indexed');
  const blob = res.sprites[0];
  assert.deepEqual(blob.palette, { a: '#f8f8f8', b: '#282848' });
  assert.deepEqual(blob.frames.down[0], ['.aa.', 'abba', 'abba', '.aa.']);
  assert.deepEqual(KIT.pixels.validate(ASE.artOf(blob, 'down')), []);
});

test('aseprite: a zlib cel that cannot be decompressed is an error problem, not a throw', () => {
  const res = ASE.file(bin('broken.aseprite'), { id: 'broken' });
  const bad = res.problems.find(p => p.code === 'compressed-unsupported');
  assert.equal(bad.severity, 'error');
  assert.match(bad.message, /opts\.inflate/);
  assert.ok(codes(res.problems).includes('empty-frame'));
  assert.equal(res.sprites.length, 1);                               // the import still produces something

  // The caller's hook is tried first, so a host with its own decoder can rescue the file.
  const rescued = ASE.file(bin('broken.aseprite'), {
    id: 'broken',
    inflate: () => new Uint8Array(4 * 4 * 4).fill(255),
  });
  assert.deepEqual(errorsOf(rescued.problems), []);
  assert.deepEqual(rescued.sprites[0].frames.down[0], ['aaaa', 'aaaa', 'aaaa', 'aaaa']);
  assert.deepEqual(rescued.sprites[0].palette, { a: '#ffffff' });
});

test('aseprite: art that is too big or too colourful falls back to an image asset', () => {
  const big = ASE.file(bin('hero.aseprite'), { id: 'hero', maxPixels: 16 });
  const note = big.problems.find(p => p.code === 'art-too-big');
  assert.equal(note.severity, 'info');
  assert.match(note.message, /opts\.maxPixels/);
  assert.equal(big.stats.native, false);
  // The frames became one strip image, and the sprite points at rectangles in it.
  const assetId = Object.keys(big.assets)[0];
  assert.equal(assetId, 'hero');
  assert.match(big.assets.hero.src, /^data:image\/png;base64,/);
  assert.deepEqual({ w: big.assets.hero.w, h: big.assets.hero.h }, { w: 16, h: 8 });
  assert.equal(big.sprites[0].image, 'hero');
  assert.equal(big.sprites[0].palette, undefined);
  assert.deepEqual(big.sprites[0].frames.down, [{ x: 0, y: 0, w: 8, h: 8 }, { x: 8, y: 0, w: 8, h: 8 }]);

  // Too many colours for one-character palette keys takes the same road.
  const many = ASE.file(bin('hero.aseprite'), { id: 'hero', maxColors: 2 });
  assert.match(many.problems.find(p => p.code === 'art-too-big').message, /more than 2 colours/);
  assert.equal(many.stats.native, false);
  assert.equal(Object.keys(many.assets).length, 1);

  // opts.encodePng wins over the built-in encoders, which is how the browser panel plugs in.
  let seen = null;
  const hooked = ASE.file(bin('hero.aseprite'), {
    id: 'hero', maxPixels: 16,
    encodePng: (w, h, rgba) => { seen = { w, h, bytes: rgba.length }; return 'data:image/png;base64,ZZZ'; },
  });
  assert.deepEqual(seen, { w: 16, h: 8, bytes: 16 * 8 * 4 });
  assert.equal(hooked.assets.hero.src, 'data:image/png;base64,ZZZ');
});

// ---------------------------------------------------------------------------
test('aseprite: an imported sprite registers and KIT.entities.frame finds its frames', () => {
  const res = ASE.file(bin('hero.aseprite'), { id: 'hero', prefix: 'ase' });
  const reg = KIT.registry('sprites');
  for (const def of res.sprites) reg.add(Object.assign({ replace: true }, def));
  assert.ok(reg.has('ase:hero'));

  const e = KIT.entities.create({ sprite: 'ase:hero', x: 0, y: 0, dir: 'down' });
  const f0 = KIT.entities.frame(e);
  assert.equal(f0.w, 8);
  assert.equal(f0.h, 8);
  assert.equal(f0.mirror, false);
  assert.deepEqual(f0.rows, res.sprites[0].frames.down[0]);
  assert.equal(f0.palette.a, '#d85050');

  // The walk cycle is [0,1,0,2]; with two frames Kit clamps to the last one.
  e.walkFrame = 1;
  assert.deepEqual(KIT.entities.frame(e).rows, res.sprites[0].frames.down[1]);
  e.walkFrame = 2;
  assert.deepEqual(KIT.entities.frame(e).rows, res.sprites[0].frames.down[0]);

  // There is no `right` list, so Kit mirrors `left` — and with no `left` either it falls back to `down`.
  e.walkFrame = 0; e.dir = 'right';
  const r = KIT.entities.frame(e);
  assert.equal(r.mirror, true);
  assert.deepEqual(r.rows, res.sprites[0].frames.down[0]);
  reg.remove('ase:hero');
});

test('aseprite: imported assets round-trip through KIT.project.normalize with no errors', () => {
  const sheet = ASE.sheet(json('sheet-hash.json'), { asset, id: 'hero' });
  const reg = KIT.registry('sprites');
  for (const def of sheet.sprites) reg.add(Object.assign({ replace: true }, def));
  const raw = {
    version: 3,
    meta: { id: 'ase-demo', title: 'Aseprite Demo', pitch: 'A hero drawn elsewhere. They walk in.' },
    assets: sheet.assets,
    heroes: [{ id: 'p1', name: 'Player 1', sprite: 'hero' }],
    maps: { home: KIT.project.newMap({ id: 'home', name: 'Home', width: 6, height: 5 }) },
    start: { map: 'home', x: 1, y: 1, dir: 'down' },
  };
  const out = KIT.project.normalize(raw);
  assert.deepEqual(errorsOf(out.problems), []);
  assert.deepEqual(out.project.assets.sheet, { kind: 'image', src: 'assets/sheet.png', w: 96, h: 16, from: 'aseprite:sheet.png' });

  // KIT.assets can slice the registered sheet exactly where the importer pointed.
  KIT.assets.fromProject(out.project);
  assert.deepEqual(KIT.assets.size('sheet'), { w: 96, h: 16 });
  assert.deepEqual(KIT.pixels.imageRect(KIT.assets.animArt('sheet', sheet.sprites[0].frames.down), 1), { x: 16, y: 0, w: 16, h: 16 });
  reg.remove('hero');
});
