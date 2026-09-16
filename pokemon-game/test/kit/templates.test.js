// The foundation kit: templates, new-game, new-module and pack-kit.
//
// These tests run the real tools as real commands and look at what they wrote,
// because that is the only thing that proves the promise — "one command and you
// have a game you can open". Everything is written into a temporary folder and
// thrown away afterwards; nothing here touches the repo.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const KIT = require(path.join(ROOT, 'test/kit/_load.js'));
require(path.join(ROOT, 'js/kit/world/map.js'));
require(path.join(ROOT, 'js/kit/world/entities.js'));
require(path.join(ROOT, 'js/main.js'));                // KIT.module / KIT.modules; headless, it boots nothing

const templates = require(path.join(ROOT, 'templates'));
const packKit = require(path.join(ROOT, 'tools/pack-kit.js'));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-templates-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* it was a temp folder */ } });

/**
 * A clean environment for a child node: the test runner marks its own children
 * with NODE_TEST_CONTEXT, which makes a nested `node --test` report to its
 * parent instead of to stdout — and then there is nothing to read.
 */
function cleanEnv() {
  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  return env;
}

/** Run one of the tools and give back { code, out }. Never throws on a non-zero exit. */
function run(tool, args, opts) {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'tools', tool)].concat(args), {
      cwd: (opts && opts.cwd) || ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv(),
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}
const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);

// ==================================================================================
// 1. Every template builds a world the engine is happy with.
// ==================================================================================
/**
 * Building a template needs the art it refers to and the modules it turns on —
 * exactly what the game's own page loads. One process, so this is done once and
 * every template shares the registries (ids do not collide).
 */
let loaded = false;
function loadArtAndModules() {
  if (loaded) return;
  loaded = true;
  for (const f of ['js/art/tiles.js', 'js/art/chars.js', 'js/art/tiles-nature.js', 'js/art/tiles-town.js',
    'js/art/tiles-interior.js', 'js/art/chars-heroes.js', 'js/art/chars-placeholder.js']) require(path.join(ROOT, f));
  const modules = Array.from(new Set([].concat(...templates.list().map(t => t.modules || []))));
  for (const id of modules) {
    const dir = path.join(ROOT, 'js', 'modules', id);
    for (const f of ['rules.js', 'art.js', 'register.js', 'panel.js', 'manifest.js']) {
      if (fs.existsSync(path.join(dir, f))) require(path.join(dir, f));
    }
  }
  if (modules.length) KIT.modules.activate({ modules });
  for (const t of templates.list()) require(path.join(t.dir, 'art.js'));
}

test('the kit ships one template, and it is an empty room', () => {
  const list = templates.list();
  assert.deepEqual(templates.ids(), ['empty'],
    'the kit ships no sample games — the first thing in a new game should be the author’s');
  for (const t of list) {
    assert.ok(t.label && t.describe, t.id + ' says what it is');
    for (const f of ['template.js', 'art.js', 'look.css', 'README.md']) {
      assert.ok(exists(path.join(t.dir, f)), `${t.id}/${f} is there`);
    }
  }
});

for (const meta of templates.list()) {
  test(`the ${meta.id} template normalizes with no errors`, () => {
    loadArtAndModules();
    const t = templates.get(meta.id);
    const raw = t.builder.build({ KIT, id: meta.id + '-test', name: 'Test ' + meta.label });
    const { project, problems } = KIT.project.normalize(raw);
    const errors = problems.filter(p => p.severity === 'error');
    assert.deepEqual(errors, [], JSON.stringify(errors, null, 1));
    assert.ok(Object.keys(project.maps).length >= 1, 'somewhere to be');
    assert.ok(project.maps[project.start.map], 'you start somewhere that exists');
    assert.ok(project.heroes.length >= 1, 'and somebody to be there');
    assert.deepEqual(project.modules, meta.modules, 'it turns on the modules it says it does');
  });

  test(`every reference in the ${meta.id} template resolves`, () => {
    loadArtAndModules();
    const t = templates.get(meta.id);
    const { project } = KIT.project.normalize(t.builder.build({ KIT, id: meta.id + '-test', name: 'Test' }));
    const { refs } = KIT.project.collect(project);
    assert.ok(refs.length > 0, 'there is something to check (' + refs.length + ' references)');
    const missing = refs.filter(r => KIT.project.known(r.kind, r.id, project) === false);
    assert.deepEqual(missing, [], JSON.stringify(missing, null, 1));
  });

  test(`the ${meta.id} template writes content files that read back the same`, () => {
    loadArtAndModules();
    const t = templates.get(meta.id);
    const { project } = KIT.project.normalize(t.builder.build({ KIT, id: meta.id + '-test', name: 'Test' }));
    const files = KIT.project.exportFiles(project);
    assert.ok(files['project.js'], 'a project file');
    assert.equal(Object.keys(files).filter(f => f.startsWith('maps/')).length, Object.keys(project.maps).length, 'one file per map');
    const back = KIT.project.normalize(KIT.project.importFiles(files)).project;
    assert.deepEqual(Object.keys(back.maps).sort(), Object.keys(project.maps).sort());
    assert.equal(KIT.stableStringify(back), KIT.stableStringify(project), 'nothing changed on the way out and back');
  });
}

// ==================================================================================
// 2. new-game turns a template into a folder you can open.
// ==================================================================================
const GAMES = path.join(TMP, 'games');

for (const meta of templates.list()) {
  test(`new-game writes a complete ${meta.id} game`, () => {
    const r = run('new-game.js', [`Test ${meta.label}`, '--template', meta.id, '--into', GAMES, '--quiet']);
    assert.equal(r.code, 0, r.out);

    // the slug comes from the name, so find the folder rather than spell it
    const game = fs.readdirSync(GAMES).map(d => path.join(GAMES, d))
      .find(d => read(path.join(d, 'package.json')).includes(`"template": "${meta.id}"`));
    assert.ok(game, 'the game folder is there, and says which template it came from');

    for (const f of ['index.html', 'story.js', 'look.css', 'README.md', 'package.json',
      'content/project.js', 'content/assets.js', 'tools/build-content.js']) {
      assert.ok(exists(path.join(game, f)), f + ' is there');
    }
    assert.ok(fs.readdirSync(path.join(game, 'content', 'maps')).length >= 1, 'and at least one map file');

    // every <script> the page names resolves from the game folder — this is the
    // whole promise: open index.html and it plays, with no build step.
    const html = read(path.join(game, 'index.html'));
    const srcs = Array.from(html.matchAll(/<script src="([^"]+)"/g)).map(m => m[1]);
    assert.ok(srcs.length > 20, 'the page loads the engine (' + srcs.length + ' scripts)');
    for (const src of srcs) assert.ok(exists(path.join(game, src)), src + ' resolves from the game folder');
    const hrefs = Array.from(html.matchAll(/<link[^>]+href="([^"]+)"/g)).map(m => m[1]);
    for (const href of hrefs.filter(h => !/^https?:/.test(h))) {
      assert.ok(exists(path.join(game, href)), href + ' resolves from the game folder');
    }
    // The page may ASK for a webfont, but it may not need one: a game opened
    // from a folder with no internet still has to look right.
    for (const href of hrefs.filter(h => /^https?:/.test(h))) {
      const tag = new RegExp('<link[^>]+href="' + href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>').exec(html)[0];
      assert.ok(/rel="preconnect"/.test(tag) || /media="print"/.test(tag),
        href + ' is loaded without blocking the page');
    }

    // and `npm run build` rebuilds the content it was given, in place
    let out = '';
    try {
      out = execFileSync(process.execPath, ['tools/build-content.js'], { cwd: game, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv() });
    } catch (e) {
      assert.fail('the new game could not rebuild its own content:\n' + (e.stdout || '') + (e.stderr || ''));
    }
    assert.match(out, /maps,/, out.trim().split('\n').pop());
  });
}

test('the content a new game is given loads back into a project with no errors', () => {
  const game = fs.readdirSync(GAMES).map(d => path.join(GAMES, d))
    .find(d => read(path.join(d, 'package.json')).includes('"template": "empty"'));
  const dir = path.join(game, 'content');
  const files = {};
  files['project.js'] = read(path.join(dir, 'project.js'));
  files['assets.js'] = read(path.join(dir, 'assets.js'));
  for (const m of fs.readdirSync(path.join(dir, 'maps'))) files['maps/' + m] = read(path.join(dir, 'maps', m));
  loadArtAndModules();
  const { project, problems } = KIT.project.normalize(KIT.project.importFiles(files));
  assert.deepEqual(problems.filter(p => p.severity === 'error'), []);
  assert.ok(project.meta.title.length > 0);
  assert.deepEqual(project.assets, {}, 'the empty assets file reads back as an empty table');
});

test('new-game refuses to write over a game that is already there', () => {
  const first = run('new-game.js', ['Keepsake', '--into', GAMES, '--quiet']);
  assert.equal(first.code, 0, first.out);
  const before = read(path.join(GAMES, 'keepsake', 'story.js'));
  fs.writeFileSync(path.join(GAMES, 'keepsake', 'story.js'), before + '\n// a whole afternoon of work\n');

  const second = run('new-game.js', ['Keepsake', '--into', GAMES]);
  assert.notEqual(second.code, 0, 'it fails');
  assert.match(second.out, /already/i, 'and says why: ' + second.out.split('\n')[0]);
  assert.match(second.out, /Keepsake 2/, 'and says what to do instead');
  assert.ok(read(path.join(GAMES, 'keepsake', 'story.js')).includes('a whole afternoon of work'),
    'the afternoon of work is still there');
});

test('new-game says so when the template does not exist', () => {
  const r = run('new-game.js', ['Nope', '--template', 'roguelike', '--into', GAMES]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /empty/, 'and lists the ones that do');
});

// ==================================================================================
// 3. new-module scaffolds a module that works and sorts.
// ==================================================================================
test('new-module scaffolds a module whose own test passes', () => {
  const game = fs.readdirSync(GAMES).map(d => path.join(GAMES, d))
    .find(d => read(path.join(d, 'package.json')).includes('"template": "empty"'));
  assert.ok(game, 'a game to put it in');

  const r = run('new-module.js', ['errands', '--label', 'Errands', '--describe', 'Little jobs', '--into', game, '--quiet']);
  assert.equal(r.code, 0, r.out);
  const dir = path.join(game, 'modules', 'errands');
  for (const f of ['rules.js', 'register.js', 'panel.js', 'manifest.js', 'README.md']) {
    assert.ok(exists(path.join(dir, f)), f + ' is there');
  }
  assert.ok(exists(path.join(game, 'test', 'errands.test.js')), 'and a test beside it');

  // the test it shipped with passes, as a real test run
  let out = '';
  try {
    out = execFileSync(process.execPath, ['--test', 'test/errands.test.js'], { cwd: game, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv() });
  } catch (e) {
    assert.fail('the scaffolded module’s test failed:\n' + (e.stdout || '') + (e.stderr || ''));
  }
  assert.match(out, /# fail 0/, out.split('\n').filter(l => l.startsWith('# ')).join(' '));
  assert.match(out, /# pass (\d+)/);
  assert.ok(Number(/# pass (\d+)/.exec(out)[1]) >= 8, 'and it is a real test, not one assertion');
});

test('the scaffolded module declares a save section, a content slice, and sorts', () => {
  const game = fs.readdirSync(GAMES).map(d => path.join(GAMES, d))
    .find(d => read(path.join(d, 'package.json')).includes('"template": "empty"'));
  const dir = path.join(game, 'modules', 'errands');
  for (const f of ['rules.js', 'register.js', 'panel.js', 'manifest.js']) require(path.join(dir, f));
  const M = KIT.errands;
  assert.ok(M && M.MANIFEST, 'the manifest declared itself');
  assert.equal(M.MANIFEST.save.key, 'errands');
  assert.equal(M.MANIFEST.content.key, 'errands');
  assert.deepEqual(M.MANIFEST.requires, []);
  assert.ok(Array.isArray(M.TUNING) && M.TUNING.length, 'a content slice with fields in it');

  // the sort main.js does at boot
  const { order, missing, cycles } = KIT.modules.order();
  assert.deepEqual(missing, [], 'nothing needs a module that is not there');
  assert.deepEqual(cycles, [], 'no module needs itself');
  const ids = order.map(d => d.id);
  assert.ok(ids.includes('errands'), 'the new module is in the boot order');
  for (const def of order) {
    for (const need of def.requires || []) {
      assert.ok(ids.indexOf(need) < ids.indexOf(def.id), `${need} comes before ${def.id}`);
    }
  }
});

test('new-module refuses to write over a module that is already there', () => {
  const game = fs.readdirSync(GAMES).map(d => path.join(GAMES, d))
    .find(d => read(path.join(d, 'package.json')).includes('"template": "empty"'));
  const r = run('new-module.js', ['errands', '--into', game]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /already/i);
});

// ==================================================================================
// 4. pack-kit gives a library, with no game in it.
// ==================================================================================
const PACKED = path.join(TMP, 'kit');

test('pack-kit writes a self-contained kit with a version stamp and a manifest', () => {
  const r = run('pack-kit.js', ['--out', PACKED, '--version', '0.0.0-test', '--quiet']);
  assert.equal(r.code, 0, r.out);

  const manifest = JSON.parse(read(path.join(PACKED, 'KIT-VERSION.json')));
  assert.equal(manifest.version, '0.0.0-test');
  assert.ok(manifest.packedAt, 'stamped with when');
  assert.equal(manifest.moduleDir, 'modules');
  assert.ok(manifest.counts.engine > 30, 'the engine is in it (' + manifest.counts.engine + ' files)');
  assert.ok(manifest.counts.art > 3, 'so is the art');
  assert.deepEqual(manifest.templates.map(t => t.id), templates.ids(), 'and the templates');
  assert.ok(manifest.contains.includes('js/main.js'), 'the manifest lists every file');
  assert.equal(manifest.contains.length, manifest.counts.files);
  for (const f of manifest.contains) assert.ok(exists(path.join(PACKED, f)), f + ' is really there');

  // the engine, the art, the styles, the tools, the templates, the docs
  for (const f of ['js/kit/core/util.js', 'js/kit/game.js', 'js/art/tiles.js', 'css/kit.css', 'js/main.js',
    'tools/new-game.js', 'tools/new-module.js', 'tools/pack-kit.js',
    'templates/index.js', 'templates/_shared/kit-files.js', 'README.md', 'docs/KIT-API.md']) {
    assert.ok(exists(path.join(PACKED, f)), f + ' was packed');
  }
  // and the engine's own modules, in the packed layout
  assert.ok(exists(path.join(PACKED, 'modules', 'dungeon', 'manifest.js')), 'the dungeon module came along');
  assert.deepEqual(manifest.modules, packKit.KIT_MODULES, 'the manifest says which');
  assert.ok(!exists(path.join(PACKED, 'js', 'modules')), 'but not under a game’s folder');
});

test('the packed kit has no reference to a game’s content or modules folder', () => {
  const bad = packKit.check(PACKED);
  assert.deepEqual(bad, [], bad.map(b => `${b.file}:${b.line}  ${b.text}`).join('\n'));
});

test('the packed kit carries no game content of its own', () => {
  const files = packKit.walk(PACKED, PACKED);
  assert.ok(!files.some(f => f.startsWith('content/')), 'no content folder');
  assert.ok(!files.some(f => /^js\/(data|sprites)\//.test(f)), 'no Pokémon data or portraits');
  assert.ok(!files.some(f => f === 'index.html'), 'no game page — a game writes its own');
  // the demo world, and this repo's own modules, stayed behind
  assert.ok(!files.some(f => /demo/.test(f)), 'the demo did not come with it');
  for (const m of ['home', 'mons']) assert.ok(!files.some(f => f.startsWith('modules/' + m + '/')), m + ' stayed behind');
});

test('a game made with the packed kit is complete and points at it', () => {
  const into = path.join(TMP, 'packed-games');
  const r = run('new-game.js', ['Packed Test', '--template', 'empty', '--modules', 'dungeon',
    '--kit', PACKED, '--into', into, '--quiet']);
  assert.equal(r.code, 0, r.out);
  const game = path.join(into, 'packed-test');
  const html = read(path.join(game, 'index.html'));
  const srcs = Array.from(html.matchAll(/<script src="([^"]+)"/g)).map(m => m[1]);
  for (const s of srcs) assert.ok(exists(path.join(game, s)), s + ' resolves from the game folder');
  assert.ok(srcs.some(s => s.includes('kit/js/kit/game.js') || s.endsWith('js/kit/game.js')), 'the engine comes from the packed kit');
  assert.ok(exists(path.join(game, 'modules', 'dungeon', 'rules.js')), 'and the module it asked for came with it');

  // and its own build script runs against the packed kit
  let out = '';
  try {
    out = execFileSync(process.execPath, ['tools/build-content.js'], { cwd: game, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv() });
  } catch (e) {
    assert.fail('the game could not rebuild its content:\n' + (e.stdout || '') + (e.stderr || ''));
  }
  assert.match(out, /maps,/, out.trim().split('\n').pop());
});

test('pack-kit refuses to write over a kit that is already there', () => {
  const r = run('pack-kit.js', ['--out', PACKED]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /already/i);
  const forced = run('pack-kit.js', ['--out', PACKED, '--force', '--version', '0.0.1-test', '--quiet']);
  assert.equal(forced.code, 0, forced.out);
  assert.equal(JSON.parse(read(path.join(PACKED, 'KIT-VERSION.json'))).version, '0.0.1-test');
});
