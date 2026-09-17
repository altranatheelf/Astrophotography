'use strict';
// DOES THE ENGINE KNOW ABOUT ITS MODULES?
//
// ADR-0005 says extensions are manifests with declared slices, not
// monkey-patches — and then says, about itself:
//
//   "the extensibility audit found the purity test is currently blind to five
//    sites where js/kit names the mons module. That is a real crack in this
//    decision."
//
// It was worse than blind. There was no purity test. The decision named its own
// guard and the guard did not exist, which is how a repo ends up with the
// engine's map editor drawing a table out of one module's content pack.
//
// So: every place `js/kit` names a module has to be listed here with what kind
// of naming it is. The list has to be COMPLETE, so a new one fails until
// somebody says which it is — and only one kind is allowed to be code.
//
//   HISTORY   the kit knows its own PAST format. Frozen, and not about the
//             module as it is now.
//   PROSE     a comment or a doc example. Not a dependency.
//   CODE      the engine reaching into a module. NOT ALLOWED.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MODULES = fs.readdirSync(path.join(ROOT, 'js/modules'), { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name);

/**
 * What counts as naming a module: THE WORD, anywhere in the code.
 *
 * The first version of this was cleverer — it looked for `'mons'`, `KIT.mons`
 * and `packs.mons`, the three shapes a dependency "actually takes" — so that a
 * module called `home` would not trip over an entity's home square. Then the
 * negative check put `(st.project.packs || {}).mons` back into the map panel and
 * the test passed, because that is `.mons` after a bracket and not `packs.mons`.
 *
 * Which is precisely the blindness ADR-0005 recorded, reproduced by the test
 * written to catch it. So: the word, and the innocent uses are listed below by
 * name and by COUNT, so that a new naming inside an excused file changes the
 * count and fails.
 */
function namings(src, id) {
  const word = new RegExp(`\\b${id}\\b`);
  const hits = [];
  src.split('\n').forEach((line, i) => { if (word.test(line)) hits.push(i + 1); });
  return hits;
}
/** Prose about a module is not a dependency on it. */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"\\])\/\/.*$/gm, (m, p1) => p1 + ' '.repeat(Math.max(0, m.length - p1.length)));

const KNOWN = {
  'js/kit/world/project.js': ['HISTORY', 6,
    'migrate2to3: the v2 format of THIS project was a Pokémon game for about a week, and a '
    + 'converter for a format that no longer changes is the kit knowing its own past, not the '
    + "module's present. It reads `garden`, objects of type `pokemon` and a per-map `encounters` "
    + 'table — all v2 spellings — and switches the module on. Frozen with the format.'],
  'js/kit/world/entities.js': ['INNOCENT', 1,
    "`e.home` is the square an entity wanders around. The module called `home` is what there is "
    + 'to do after the story; they share a word and nothing else.'],
  'js/kit/systems/index.js': ['INNOCENT', 1,
    '`e.home` again, in the wander behaviour that keeps an NPC near it.'],
};

test('purity: js/kit names a module only where this file says it may', () => {
  const found = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) { walk(p); continue; }
      if (!f.name.endsWith('.js')) continue;
      const rel = path.relative(ROOT, p);
      const code = stripComments(fs.readFileSync(p, 'utf8'));
      for (const id of MODULES) {
        const lines = namings(code, id);
        if (lines.length) found.push({ rel, id, lines });
      }
    }
  };
  walk(path.join(ROOT, 'js/kit'));

  const unlisted = found.filter((h) => !KNOWN[h.rel]);
  assert.deepEqual(unlisted.map((h) => `${h.rel}:${h.lines.join(',')} names '${h.id}'`), [],
    'the engine reaches into a module here. Give the module a registry to sit in — ' +
    '`mapSections`, `editorPanels`, `fieldEditors`, `menus`, `systems` — or add the file to ' +
    'KNOWN in this test with what kind of naming it is and how many lines of it there are.');

  const bad = found.filter((h) => KNOWN[h.rel] && KNOWN[h.rel][0] === 'CODE');
  assert.deepEqual(bad, [], 'CODE is not an allowed classification; it is the thing being checked for');

  // An excuse is for the lines that are there NOW. A new naming in an excused
  // file moves the count, which is the only thing standing between "this file is
  // allowed to mention mons" and "this file is allowed to do anything".
  const drifted = [];
  for (const h of found) {
    const want = KNOWN[h.rel][1];
    if (h.lines.length !== want) drifted.push(`${h.rel}: ${h.lines.length} line(s) name '${h.id}' (${h.lines.join(', ')}), the excuse covers ${want}`);
  }
  assert.deepEqual(drifted, [],
    `an excused file names a module on more lines than its excuse covers:\n  ${drifted.join('\n  ')}\n` +
    'Read the new line. If it is the same kind of naming, raise the count and say so; if it is the ' +
    'engine reaching into a module, it does not belong there at all.');
});

test('purity: nothing is excused that is no longer there', () => {
  const ghosts = Object.keys(KNOWN).filter((rel) => {
    if (!fs.existsSync(path.join(ROOT, rel))) return true;
    const code = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    return !MODULES.some((id) => namings(code, id).length);
  });
  assert.deepEqual(ghosts, [],
    `these are excused in KNOWN and no longer name a module — delete the excuse: ${ghosts.join(', ')}`);
});

test('purity: the map panel offers a registry instead of knowing one module', () => {
  // The crack ADR-0005 recorded, and the shape of the fix. The kit's map panel
  // used to render `project.packs.mons.encounters` itself.
  const panel = fs.readFileSync(path.join(ROOT, 'js/kit/editor/panels-map.js'), 'utf8');
  assert.ok(/registry\('mapSections'\)/.test(panel), 'the kit asks a registry what to draw');
  assert.ok(/function mapSections/.test(panel), 'and sorts and filters the sections itself');
  const mons = fs.readFileSync(path.join(ROOT, 'js/modules/mons/panel.js'), 'utf8');
  assert.ok(/registry\('mapSections'\)\.add/.test(mons), 'and the module puts its own section in it');
  assert.ok(/packs', 'mons'/.test(mons) || /packs\.mons/.test(mons),
    'with the pack-reading code now living in the module that owns the pack');
});

test('purity: a module section that throws does not take the panel with it', () => {
  // A module's renderer is somebody else's code running inside the kit's screen.
  const panel = fs.readFileSync(path.join(ROOT, 'js/kit/editor/panels-map.js'), 'utf8');
  // The DEFINITION, with its brace — `indexOf('renderProps(ed)')` finds the call
  // site a few lines above it and slices twenty-eight characters of nothing,
  // which is how a test passes while checking no code at all.
  const from = panel.indexOf('renderProps(ed) {');
  const to = panel.indexOf('renderConnections(ed) {');
  assert.ok(from > 0 && to > from, `found the body of renderProps (${from}..${to})`);
  assert.ok(to - from > 400, `and it is a real slice of code (${to - from} chars)`);
  const body = panel.slice(from, to);
  assert.ok(/try \{[\s\S]*def\.render\(/.test(body), 'the call is guarded');
  assert.ok(/catch \(e\)/.test(body), 'and the failure is caught');
  assert.ok(/console\)\.error|KIT\.log/.test(body), 'and said out loud rather than swallowed');
});
