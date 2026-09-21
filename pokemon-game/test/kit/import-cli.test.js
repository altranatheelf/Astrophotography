'use strict';
// tools/import.js — the command line around the importers: what it recognises,
// where it puts things, and that running it twice is a no-op.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(ROOT, 'tools', 'import.js');
const FIX = path.join(ROOT, 'test', 'fixtures');
const cli = require(CLI);                      // detect / imageSize / parseArgs, and the kit it loads
const KIT = globalThis.KIT;

function run(args, opts) {
  return execFileSync(process.execPath, [CLI].concat(args), Object.assign({ cwd: ROOT, encoding: 'utf8' }, opts || {}));
}
function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-import-'));
  return dir;
}
const load = (file) => KIT.project.parseFile(fs.readFileSync(file, 'utf8')).data;

test('cli: it knows what it has been given', () => {
  assert.deepEqual(cli.detect(path.join(FIX, 'tiled', 'town.tmj')), { tool: 'tiled', kind: 'map', label: 'Tiled map' });
  assert.equal(cli.detect(path.join(FIX, 'tiled', 'town.tmx')).kind, 'map', 'the XML flavour too');
  assert.equal(cli.detect(path.join(FIX, 'tiled', 'outside.tsj')).kind, 'tileset');
  assert.equal(cli.detect(path.join(FIX, 'aseprite', 'sheet-hash.json')).tool, 'aseprite');
  assert.equal(cli.detect(path.join(FIX, 'aseprite', 'hero.aseprite')).kind, 'file');
  const mv = cli.detect(path.join(FIX, 'rpgmaker'));
  assert.equal(mv.tool, 'rpgmaker');
  assert.equal(path.basename(mv.dataDir), 'data');
  assert.throws(() => cli.detect(path.join(FIX, 'tiled')), /RPG Maker/);
  assert.throws(() => cli.detect(path.join(FIX, 'tiled', 'nope.tmj')), /no file/);
});

test('cli: it reads image sizes without decoding anything', () => {
  const png = fs.readFileSync(path.join(FIX, 'tiled', 'tiles.png'));
  assert.deepEqual(cli.imageSize(png), { w: 64, h: 16 });
  assert.equal(cli.imageSize(Buffer.from('not an image')), null);
});

test('cli: options', () => {
  const o = cli.parseArgs(['map.tmj', '--into', 'js/content/demo', '--prefix', 'outside', '--overwrite', '--dry-run']);
  assert.equal(o.input, 'map.tmj');
  assert.equal(o.into, 'js/content/demo');
  assert.equal(o.prefix, 'outside');
  assert.equal(o.overwrite, true);
  assert.equal(o.dryRun, true);
  assert.throws(() => cli.parseArgs(['a.tmj', 'b.tmj']), /one file or folder/);
  assert.throws(() => cli.parseArgs(['--wat']), /unknown option/);
});

test('cli: a Tiled map becomes content files, images and all', () => {
  const dir = tmpProject();
  const out = run(['test/fixtures/tiled/town.tmj', '--into', dir, '--prefix', 'outside']);
  assert.match(out, /added .*1 map/);
  assert.ok(fs.existsSync(path.join(dir, 'project.js')), 'a project file was written');
  assert.ok(fs.existsSync(path.join(dir, 'assets.js')), 'the image table was written');
  assert.ok(fs.existsSync(path.join(dir, 'maps', 'outside-town.js')), 'the map file has no colon in its name');
  assert.ok(fs.existsSync(path.join(dir, 'assets', 'outside-tiles.png')), 'the tileset image was copied in');

  const project = load(path.join(dir, 'project.js'));
  const assets = load(path.join(dir, 'assets.js'));           // exportFiles keeps the image table in its own file
  assert.equal(assets['outside:tiles'].src, 'assets/outside-tiles.png', 'the path is relative to the page that loads it');
  assert.equal(assets['outside:tiles'].w, 64);
  assert.equal(project.tiles['outside:outside:grass'].art.image, 'outside:tiles');
  const map = load(path.join(dir, 'maps', 'outside-town.js'));
  assert.equal(map.id, 'outside:town');
  assert.equal(map.width, 6);
  assert.equal(map.objects.length, 3);

  // Running it again changes nothing at all.
  const before = fs.readFileSync(path.join(dir, 'project.js'), 'utf8');
  const again = run(['test/fixtures/tiled/town.tmj', '--into', dir, '--prefix', 'outside']);
  assert.match(again, /already up to date/);
  assert.equal(fs.readFileSync(path.join(dir, 'project.js'), 'utf8'), before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cli: --dry-run writes nothing, --inline embeds the image', () => {
  const dir = tmpProject();
  const dry = run(['test/fixtures/tiled/town.tmj', '--into', dir, '--dry-run']);
  assert.match(dry, /dry run: nothing was written/);
  assert.deepEqual(fs.readdirSync(dir), [], 'not one file');

  run(['test/fixtures/tiled/town.tmj', '--into', dir, '--prefix', 'outside', '--inline']);
  const assets = load(path.join(dir, 'assets.js'));
  assert.match(assets['outside:tiles'].src, /^data:image\/png;base64,/);
  assert.equal(fs.existsSync(path.join(dir, 'assets')), false, 'nothing was copied');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cli: an RPG Maker folder, then a Tiled map, land in one project', () => {
  const dir = tmpProject();
  run(['test/fixtures/rpgmaker', '--into', dir, '--prefix', 'willow']);
  const out = run(['test/fixtures/tiled/town.tmj', '--into', dir, '--prefix', 'outside']);
  assert.match(out, /added .*1 map/);
  const project = load(path.join(dir, 'project.js'));
  assert.equal(project.maps, undefined, 'maps live in their own files');
  const maps = fs.readdirSync(path.join(dir, 'maps')).sort();
  assert.deepEqual(maps, ['outside-town.js', 'willow-inn.js', 'willow-willow-town.js']);
  assert.equal(project.start.map, 'willow:willow-town', 'a new project starts where the import said');
  assert.ok(project.scripts['willow:sunrise'], 'the MV common event came along');
  assert.ok(project.items['willow:honey-bun'], 'and its item');
  assert.ok(project.sprites['willow:villagers-0'] && project.faces['willow:face-people1-0'], 'and its sheets');
  assert.equal(project.meta.title, 'Willow Town', 'a new project takes the imported title');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cli: a warp that names a map the project already has points at it', () => {
  const dir = tmpProject();
  // town.tmj has a door to 'home.tmj'. With a 'home' map already in the project,
  // that is where it should lead — not to a map that does not exist.
  fs.mkdirSync(path.join(dir, 'maps'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'js/content/demo/project.js'), path.join(dir, 'project.js'));
  for (const f of fs.readdirSync(path.join(ROOT, 'js/content/demo/maps'))) {
    fs.copyFileSync(path.join(ROOT, 'js/content/demo/maps', f), path.join(dir, 'maps', f));
  }
  run(['test/fixtures/tiled/town.tmj', '--into', dir, '--prefix', 'outside']);
  const map = load(path.join(dir, 'maps', 'outside-town.js'));
  const door = map.objects.find(o => o.type === 'warp');
  assert.deepEqual(door.pages[0].props.to, { map: 'home', x: 3, y: 7 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cli: it refuses what it cannot read, and says why', () => {
  const dir = tmpProject();
  let code = 0, out = '';
  const junk = path.join(dir, 'notes.txt');
  fs.writeFileSync(junk, 'a shopping list, not a map');
  try { run([junk, '--into', dir]); }
  catch (e) { code = e.status; out = (e.stdout || '') + (e.stderr || ''); }
  assert.equal(code, 2);
  assert.match(out, /not a Tiled map or tileset/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cli: a PNG on its own is cut into tiles, or into a walking character with --kind sprite', () => {
  const { encodePng } = require(path.join(ROOT, 'tools', 'sprite-png.js'));
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-png-'));
  const w = 48, h = 32, rgba = Buffer.alloc(w * h * 4, 255);
  fs.writeFileSync(path.join(dir, 'ground.png'), encodePng(w, h, rgba));
  assert.equal(cli.detect(path.join(dir, 'ground.png')).tool, 'image', 'a picture is no longer turned away');
  const out = run([path.join(dir, 'ground.png'), '--into', path.join(dir, 'out'), '--inline', '--prefix', 'web', '--quiet']);
  assert.match(out, /wrote/);
  const project = fs.readFileSync(path.join(dir, 'out', 'project.js'), 'utf8');
  for (let i = 0; i < 6; i++) assert.ok(project.includes(`"web:ground:${i}"`), `tile web:ground:${i} is in the project`);
  assert.ok(!project.includes('"web:ground:6"'), 'a 48×32 sheet at 16px is six tiles, not more');
  fs.writeFileSync(path.join(dir, 'hero.png'), encodePng(48, 64, Buffer.alloc(48 * 64 * 4, 200)));
  const out2 = run([path.join(dir, 'hero.png'), '--kind', 'sprite', '--order', 'udlr', '--into', path.join(dir, 'out'), '--inline', '--quiet']);
  assert.match(out2, /wrote/);
  const project2 = fs.readFileSync(path.join(dir, 'out', 'project.js'), 'utf8');
  assert.ok(project2.includes('"hero"'), 'the sprite is in the project');
  assert.ok(/"up"/.test(project2) && /"down"/.test(project2), 'with its directions');
  fs.rmSync(dir, { recursive: true, force: true });
});
