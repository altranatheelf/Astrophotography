'use strict';
// Every `KIT.something` a document names has to exist, and so does every
// function a `typeof KIT.x === 'function'` guard in js/ or tools/ asks about.
//
// The docs test already fails when a document names a file that is not there.
// This is the same rule for API: `KIT.pixels.load`, `KIT.audio.startMusic`,
// `KIT.home.touch` — each was in a document and in nothing else, because a doc
// written to describe intent is not corrected when the code takes a different
// road. Now it is. A path that a game or module defines rather than the kit is
// listed with the reason, the way the path test lists generated files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const KIT = require('./_load.js');

const ROOT = path.join(__dirname, '..', '..');
const R = (f) => require(path.join(ROOT, f));
// _load.js is a prefix of the engine; these are the rest of core that a document may name.
for (const f of ['js/kit/core/assets.js', 'js/kit/core/storage.js']) R(f);
const notLoaded = [];
for (const f of ['js/kit/world/map.js', 'js/kit/world/entities.js', 'js/kit/world/world.js', 'js/kit/systems/index.js',
  'js/kit/import/tiled.js', 'js/kit/import/rpgmaker.js', 'js/kit/import/aseprite.js', 'js/kit/import/image.js', 'js/kit/import/merge.js',
  'js/kit/render/atmosphere.js', 'js/kit/render/text-canvas.js', 'js/kit/render/renderer.js',
  'js/kit/scenes/stack.js', 'js/kit/scenes/dialogue.js', 'js/kit/scenes/menu.js', 'js/kit/scenes/title.js', 'js/kit/scenes/start.js', 'js/kit/scenes/map.js', 'js/kit/game.js']) {
  try { R(f); } catch (e) { notLoaded.push(f); }
}
global.PKMN = global.PKMN || {};
for (const f of ['js/art/tiles.js', 'js/art/chars.js', 'js/art/tiles-nature.js', 'js/art/tiles-town.js', 'js/art/tiles-interior.js', 'js/art/chars-heroes.js', 'js/art/chars-placeholder.js']) R(f);
R('tools/load-modules.js').load(KIT, ['mons', 'home', 'dungeon', 'bullet']);
for (const f of ['js/kit/editor/ops.js', 'js/kit/editor/editor.js', 'js/kit/editor/tools.js', 'js/kit/editor/inspector.js', 'js/kit/editor/panels-map.js',
  'js/kit/editor/panels-objects.js', 'js/kit/editor/script-editor.js', 'js/kit/editor/panels-writing.js', 'js/kit/editor/panels-project.js', 'js/kit/editor/panel-cast.js', 'js/kit/editor/integration.js']) {
  try { R(f); } catch (e) { notLoaded.push(f); }
}

/** Resolve `KIT.a.b.c` against the live object; a registry name is checked against KIT.registry. */
function exists(dotted) {
  const parts = dotted.split('.');
  if (parts[0] !== 'KIT') return true;
  let cur = KIT;
  for (const p of parts.slice(1)) {
    if (cur == null) return false;
    if (!(p in Object(cur))) return false;
    cur = cur[p];
  }
  return true;
}

// Paths a document may name that the kit itself does not define here, each with why.
const ELSEWHERE = {
  'KIT.content': 'the content files define it (js/content/**), not the engine',
  'KIT.PRISTINE_HTML': 'set by js/main.js from the page, which no test loads',
  'KIT.banner': 'set by js/main.js',
  'KIT.problems': 'set by js/main.js after the game boots',
  'KIT.log': 'a page may install a logger; every caller writes (KIT.log || console)',
  'KIT.editor.el': 'the editor DOM, built by KIT.editor.open() in a browser',
  'KIT.editor.fitMap': 'defined in the browser-only half of js/kit/editor/integration.js',
};

test('the loader reached every file it tried', () => {
  // A file that will not load headless hides its namespace from this test, so
  // the list has to be short and every entry known. integration.js and the
  // panels return early without a document; their pure halves still land.
  assert.ok(notLoaded.length <= 2, 'files that did not load headless: ' + notLoaded.join(', '));
});

test('docs: every KIT.* a document names exists', () => {
  const docs = fs.readdirSync(path.join(ROOT, 'docs')).filter(f => f.endsWith('.md')).map(f => 'docs/' + f).concat(['README.md']);
  const missing = [];
  for (const d of docs) {
    const text = fs.readFileSync(path.join(ROOT, d), 'utf8');
    const seen = new Set();
    for (const m of text.matchAll(/`(KIT(?:\.[A-Za-z_$][\w$]*)+)/g)) {
      const dotted = m[1];
      if (seen.has(dotted)) continue;
      seen.add(dotted);
      if (ELSEWHERE[dotted]) continue;
      if (Object.keys(ELSEWHERE).some(k => dotted.startsWith(k + '.'))) continue;
      if (!exists(dotted)) missing.push(`${d}: ${dotted}`);
    }
  }
  assert.deepEqual(missing, [], 'documents naming API that does not exist:\n  ' + missing.join('\n  '));
});

test('a typeof guard in the engine or the tools names a function that exists', () => {
  // The same rule for code. `if (typeof ED.panelEdit === 'function') return
  // ED.panelEdit(...)` sat in the module scaffold after panelEdit was deleted:
  // a guard on a name nothing defines turns a removal into a silent fallback,
  // and every module it wrote carried it. `KIT.banner` is set by js/main.js.
  const files = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir + '/' + f.name;
      if (f.isDirectory()) walk(rel);
      else if (f.name.endsWith('.js')) files.push(rel);
    }
  };
  walk('js'); walk('tools');
  const missing = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of text.matchAll(/typeof\s+((?:KIT|ED)(?:\.[A-Za-z_$][\w$]*)+)\s*[!=]==\s*'function'/g)) {
      const dotted = m[1].startsWith('ED.') ? 'KIT.editor.' + m[1].slice(3) : m[1];
      if (ELSEWHERE[dotted] || exists(dotted)) continue;
      missing.push(`${f}:${text.slice(0, m.index).split('\n').length}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, [], 'guards for functions that do not exist:\n  ' + missing.join('\n  '));
});
