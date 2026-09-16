// The engine's load order, in one place and provably in step everywhere else.
//
// `templates/_shared/kit-files.js` IS the list: tools/new-game.js writes a
// game's page from it, tools/pack-kit.js packs exactly those files, and a
// generated game's tools/kit-node.js loads them in Node. This repo's own
// index.html and test/kit/_load.js repeat it, because a page is a page and a
// test loader only needs half the engine. Repeating is fine; DRIFTING is not —
// a file added to one list and forgotten in another fails here, which is the
// whole point.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const KF = require(path.join(ROOT, 'templates/_shared/kit-files.js'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** Every <script src> on a page, in order. */
const scriptsOf = (html) => Array.from(html.matchAll(/<script src="([^"]+)"/g)).map(m => m[1]);
/** Every <link href> that is a local stylesheet, in order. */
const stylesOf = (html) => Array.from(html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)).map(m => m[1]);

test('every file the list names is really there', () => {
  for (const f of [].concat(KF.CORE, KF.ART, KF.EDITOR, KF.MAIN, KF.CSS)) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' is in kit-files.js but not on disk');
  }
  assert.deepEqual(KF.NODE, KF.CORE.concat(KF.ART), 'NODE is the engine and its art');
  assert.equal(KF.MAIN[KF.MAIN.length - 1], 'js/main.js', 'the entry point is last');
});

test('no engine file is missing from the list', () => {
  const walk = (dir, base) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? walk(dir + '/' + e.name, base) : (e.name.endsWith('.js') ? [dir + '/' + e.name] : [])));
  const onDisk = walk('js/kit').concat(walk('js/art')).sort();
  const listed = new Set([].concat(KF.CORE, KF.ART, KF.EDITOR));
  const missing = onDisk.filter(f => !listed.has(f));
  assert.deepEqual(missing, [], 'these exist but nothing loads them:\n  ' + missing.join('\n  '));
});

test('index.html loads exactly the list, in the list’s order', () => {
  const html = read('index.html');
  const srcs = scriptsOf(html);
  const kit = srcs.filter(s => s.startsWith('js/kit/') || s.startsWith('js/art/') || s === 'js/main.js');

  assert.deepEqual(kit, [].concat(KF.CORE, KF.ART, KF.EDITOR, KF.MAIN),
    'index.html and kit-files.js disagree about the engine');
  assert.deepEqual(stylesOf(html).filter(h => h.startsWith('css/')), KF.CSS);

  // the modules come after the editor and before main.js, so main.js captures
  // the whole page for the single-file build
  const mods = srcs.filter(s => s.startsWith('js/modules/'));
  if (mods.length) {
    const lastEditor = srcs.indexOf(KF.EDITOR[KF.EDITOR.length - 1]);
    const firstMain = srcs.indexOf(KF.MAIN[0]);
    const at = srcs.indexOf(mods[0]);
    assert.ok(at > lastEditor, 'the modules come after Creator Mode');
    assert.ok(srcs.indexOf(mods[mods.length - 1]) < firstMain, 'and before js/main.js');
  }
});

test('index.html and tools/load-modules.js load each module the same way', () => {
  const srcs = scriptsOf(read('index.html')).filter(s => s.startsWith('js/modules/'));
  const byModule = new Map();
  for (const s of srcs) {
    const [, , id, file] = s.split('/');
    if (!byModule.has(id)) byModule.set(id, []);
    byModule.get(id).push(file.replace(/\.js$/, ''));
  }
  const FILES = require(path.join(ROOT, 'tools/load-modules.js')).FILES;
  assert.ok(FILES, 'load-modules.js publishes its file lists');
  for (const [id, onPage] of byModule) {
    assert.deepEqual(onPage, FILES[id], `the page and tools/load-modules.js disagree about ${id}`);
    assert.equal(onPage[onPage.length - 1], 'manifest', `${id}'s manifest is last`);
    for (const f of onPage) {
      assert.ok(fs.existsSync(path.join(ROOT, 'js/modules', id, f + '.js')), `js/modules/${id}/${f}.js`);
    }
  }
  // and every module folder that exists is either loaded here or listed there
  for (const id of fs.readdirSync(path.join(ROOT, 'js/modules'))) {
    assert.ok(FILES[id], `js/modules/${id} exists but tools/load-modules.js does not know its files`);
  }
});

test('the Node test loader loads a prefix of the same order', () => {
  const src = read('test/kit/_load.js');
  const files = Array.from(src.matchAll(/'(js\/kit\/[^']+)'/g)).map(m => m[1]);
  assert.ok(files.length > 8, 'it loads a real slice of the engine');
  const order = KF.CORE.indexOf.bind(KF.CORE);
  for (const f of files) assert.ok(order(f) >= 0, f + ' is loaded by the test loader but not in CORE');
  const positions = files.map(order);
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i] > positions[i - 1],
      `${files[i]} comes before ${files[i - 1]} in CORE, so the test loader has them the wrong way round`);
  }
});

test('Our-Adventure.html — the single-file build — carries the same engine', () => {
  const single = 'Our-Adventure.html';
  if (!fs.existsSync(path.join(ROOT, single))) return;          // not built yet
  const html = read(single);
  for (const f of [].concat(KF.CORE, KF.MAIN)) {
    assert.ok(html.includes('// ---- ' + f + ' ----'), f + ' is missing from the single-file build');
  }
});
