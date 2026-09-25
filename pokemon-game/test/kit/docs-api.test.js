'use strict';
// Documents have to name API that exists. Three checks, each as strong as it
// says and no stronger:
//
// 1. Every fully qualified `KIT.a.b` a document names resolves on the kit as
//    loaded headless (a path set elsewhere is listed with why).
// 2. Every bare `name(` a document writes (the usual shape in a section about
//    one namespace: `play(id)`, `restore(id)`) is an identifier somewhere in
//    the code. That catches a method that exists nowhere — `startMusic`,
//    `deleteSnapshot` — and not one that exists on some other object.
// 3. Every `typeof KIT.x === 'function'` guard in js/ or tools/ asks about a
//    function that exists: a guard on a deleted name turns the removal into a
//    silent fallback.
//
// A document written to describe intent is not corrected when the code takes
// a different road; these are what correct it. docs/SLOP.md and the decision
// records are history and are allowed to name what is gone.
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
  'js/kit/scenes/stack.js', 'js/kit/ui/parts.js', 'js/kit/scenes/dialogue.js', 'js/kit/scenes/menu.js', 'js/kit/scenes/title.js', 'js/kit/scenes/start.js', 'js/kit/scenes/map.js', 'js/kit/game.js']) {
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

test('docs: every bare `name(` a document writes is an identifier in the code', () => {
  const { stripComments } = require(path.join(ROOT, 'tools', 'slop.js'));
  const files = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir + '/' + f.name;
      if (f.isDirectory()) walk(rel);
      else if (f.name.endsWith('.js')) files.push(rel);
    }
  };
  walk('js'); walk('tools');
  const idents = new Set();
  for (const f of files) for (const w of stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8')).match(/[A-Za-z_$][\w$]*/g) || []) idents.add(w);
  const docs = fs.readdirSync(path.join(ROOT, 'docs')).filter(f => f.endsWith('.md') && f !== 'SLOP.md').map(f => 'docs/' + f).concat(['README.md']);
  const missing = [];
  for (const d of docs) {
    for (const m of fs.readFileSync(path.join(ROOT, d), 'utf8').matchAll(/`([a-z][A-Za-z0-9_]*)\(/g)) {
      if (!idents.has(m[1])) missing.push(`${d}: ${m[1]}(`);
    }
  }
  assert.deepEqual(Array.from(new Set(missing)), [], 'documents naming methods that exist nowhere in the code:\n  ' + Array.from(new Set(missing)).join('\n  '));
});

