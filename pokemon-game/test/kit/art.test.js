'use strict';
// Loads every js/art/*.js file on top of the kit and checks the registries.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const KIT = require('./_load.js');

const artDir = path.join(__dirname, '..', '..', 'js', 'art');

test('every js/art/*.js registers through the kit registries without errors', () => {
  const files = fs.readdirSync(artDir).filter(f => f.endsWith('.js')).sort();
  // registry files first (they define the PKMN.TILES / PKMN.CHARS aliases), then the art
  const order = ['tiles.js', 'chars.js'].filter(f => files.includes(f)).concat(files.filter(f => f !== 'tiles.js' && f !== 'chars.js'));
  const warnings = [];
  const origWarn = console.warn; console.warn = (...a) => warnings.push(a.join(' '));
  try { for (const f of order) require(path.join(artDir, f)); }
  finally { console.warn = origWarn; }
  assert.deepEqual(warnings.filter(w => /registry/.test(w)), []);
  const tiles = KIT.registry('tiles'), sprites = KIT.registry('sprites');
  assert.ok(tiles.size() >= 70, `tiles: ${tiles.size()}`);
  assert.ok(sprites.size() >= 1, `sprites: ${sprites.size()}`);
  // legacy views forward to the registries
  const PKMN = globalThis.PKMN;
  assert.equal(PKMN.TILES.list.length, tiles.size()); assert.equal(PKMN.TILES.byId.grass, tiles.get('grass'));
  assert.equal(PKMN.CHARS.list.length, sprites.size()); assert.ok(PKMN.CHARS.byId.man);
  assert.equal(PKMN.Pixels, KIT.pixels);
  assert.ok(tiles.stamps.length >= 5 && PKMN.TILES.stamps === tiles.stamps);
  // registry defaults were filled without touching the pixel data
  const grass = tiles.get('grass');
  assert.equal(grass.solid, false); assert.equal(grass.encounter, false); assert.equal(grass.animMs, 500); assert.equal(grass.probability, 1);
  assert.equal(grass.rows.length, 16); assert.equal(grass.rows[0].length, 16); assert.equal(grass.w, 16);
  assert.equal(tiles.get('water').solid, true);
  // every tile's art validates; tiles with frames are animated
  let animated = 0;
  for (const t of tiles.list()) {
    assert.deepEqual(KIT.pixels.validate(KIT.pixels.artOf(t)), [], t.id);
    if (t.frames) { animated++; assert.equal(KIT.tiles.flags(t.id).animated, true, t.id); assert.ok(t.frames.length > 1); assert.equal(KIT.tiles.frameAt(t.id, 500), 1); }
    else assert.equal(KIT.tiles.flags(t.id).animated, false, t.id);
  }
  assert.ok(animated >= 1);
  assert.equal(KIT.schema.refKinds.tile.has('grass'), true);
  // sprites: 3 frames per direction, KIT.sprites.frame helper + recolorable map
  const man = sprites.get('man');
  for (const d of ['down', 'up', 'left']) assert.equal(man.frames[d].length, 3);
  assert.deepEqual(KIT.sprites.WALK_SEQUENCE, [0, 1, 0, 2]);
  assert.equal(KIT.sprites.frame(man, 'right', 1).mirror, true);
  assert.equal(KIT.sprites.frame(man, 'down', 3).rows, man.frames.down[2]);
  assert.equal(PKMN.CHARS.frame, KIT.sprites.frame);
  PKMN.CHARS.registerRecolorable('man', { hair: ['h', 'H'] });
  assert.deepEqual(sprites.recolorable.man, { hair: ['h', 'H'] }); assert.equal(PKMN.CHARS.recolorable, sprites.recolorable); assert.equal(KIT.sprites.recolorable, sprites.recolorable);
  // re-registering the same tile (tools re-run art files) replaces silently
  const w2 = [];
  console.warn = (...a) => w2.push(a.join(' '));
  try { PKMN.TILES.register([Object.assign({}, grass)]); } finally { console.warn = origWarn; }
  assert.deepEqual(w2, []); assert.equal(tiles.size() >= 70, true);
});

test('js/kit never references PKMN, modules or content', () => {
  const kitDir = path.join(__dirname, '..', '..', 'js', 'kit');
  const walk = (dir) => fs.readdirSync(dir).flatMap(f => { const p = path.join(dir, f); return fs.statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const f of walk(kitDir).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(!/\bPKMN\b/.test(src), `${f} references PKMN`);
    assert.ok(!/KIT\.modules\./.test(src), `${f} references KIT.modules.*`);
    assert.ok(!/js\/content\//.test(src), `${f} references js/content`);
  }
});
