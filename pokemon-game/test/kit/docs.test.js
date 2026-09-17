'use strict';
// THE DOCUMENTS HAVE TO BE TRUE TOO.
//
// This exists because of a specific, embarrassing failure. Two documents in
// this repo disagreed for months about what the engine IS — one opened "Not a
// Pokémon game. A world engine"; the other, the one that claims to say WHY,
// opened "an engine for a Pokémon-style story adventure." Nobody noticed,
// because nothing reads the docs and fails.
//
// Then it cost something real. Research agents were briefed from those files
// and came back reporting "KNOWN ABSENT: localization of any kind" about an
// engine that had shipped localization, and "413 unit tests" when there were
// 455. The documentation lied to the audit that was checking the documentation.
//
// A written list of contradictions — the obvious fix — is a snapshot, and
// snapshots rot in exactly the way the thing they describe rotted. So the
// contradictions are checked instead. Not all of them can be: no test can tell
// whether a paragraph is *wise*. But a test can tell whether a doc claims a
// number that is wrong, or a feature that does not exist, or a thesis the rest
// of the repo abandoned.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DOCS = path.join(ROOT, 'docs');
const names = fs.readdirSync(DOCS).filter((f) => f.endsWith('.md'));
const read = (f) => fs.readFileSync(path.join(DOCS, f), 'utf8');
const all = names.map((f) => ({ file: f, text: read(f) }));

/** The one sentence the whole repo answers to. */
const THESIS = 'An engine for places that remember, authored from anywhere, in a format that';

test('docs: the thesis is stated, in the two documents that decide scope', () => {
  const scope = read('WHAT-THIS-ENGINE-IS-FOR.md');
  const design = read('DESIGN.md');
  assert.ok(scope.includes(THESIS), 'WHAT-THIS-ENGINE-IS-FOR opens with it');
  assert.ok(design.includes(THESIS), 'and DESIGN justifies the same one');
});

test('docs: no document still describes this as an engine for a Pokémon game', () => {
  // The actual bug. `mons` is a module and may be named as one; what is banned
  // is any claim that the ENGINE is for that genre.
  const bad = /engine for a Pok|Pok[ée]mon[- ]style (story )?(adventure|engine|game)(?! with)|a Pok[ée]mon engine/i;
  const guilty = all.filter((d) => {
    const hits = d.text.split('\n').filter((l) => bad.test(l) && !/^>|not a pok|was one, for about a week/i.test(l.trim()));
    return hits.length > 0;
  }).map((d) => d.file);
  assert.deepEqual(guilty, [],
    `these still call the engine a Pokémon engine: ${guilty.join(', ')}. ` +
    'It is a module — js/modules/mons/ — and the thesis is in WHAT-THIS-ENGINE-IS-FOR.md.');
});

test('docs: every document says what it is for and what beats it', () => {
  // Precedence is the thing that makes disagreement survivable. A reader (or an
  // agent) that opens the wrong file first should be told so in the first lines.
  const ROLE = /wins|this document is|written for|for the person|how outside tools|is the standing list|is a set of|is the editor/i;
  const silent = all.filter((d) => !ROLE.test(d.text.slice(0, 900))).map((d) => d.file);
  assert.deepEqual(silent, [],
    `these do not say what they are for in their opening: ${silent.join(', ')}`);
});

test('docs: a claimed test count is the real one', () => {
  // `413 unit tests` sat in a brief for weeks after it was 455. Any doc quoting
  // a count now has to quote the true one.
  const real = countTests();
  const wrong = [];
  for (const d of all) {
    for (const m of d.text.matchAll(/(\d{3,4})\s+(?:passing tests|unit tests|tests passing|tests|passing)\b/g)) {
      const n = Number(m[1]);
      if (n >= 100 && n <= 5000 && n !== real) wrong.push(`${d.file}: says ${n}, actually ${real}`);
    }
  }
  assert.deepEqual(wrong, [], `stale test counts:\n  ${wrong.join('\n  ')}`);
});

test('every browser suite is wired into `npm run e2e`', () => {
  // The rest of this file checks that documents tell the truth. This checks the
  // same thing about the test suite itself, and it is the same failure: a suite
  // that exists and never runs is exactly as useful as a feature nobody can
  // reach. Writing e2e/whatever.js and forgetting the package.json line is one
  // keystroke away at all times.
  const suites = fs.readdirSync(path.join(ROOT, 'e2e')).filter((f) => f.endsWith('.js')).sort();
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const script = pkg.scripts.e2e || '';
  const orphans = suites.filter((f) => !script.includes('e2e/' + f));
  assert.deepEqual(orphans, [],
    `these browser suites exist but never run: ${orphans.join(', ')}. Add them to scripts.e2e.`);
  assert.ok(suites.length >= 8, `and there are real ones (${suites.length})`);
});

test('docs: files the documents name actually exist', () => {
  // Paths rot faster than prose. Every `js/...` or `e2e/...` or `test/...` path
  // mentioned in the docs is checked; a renamed file should break the sentence
  // that describes it, loudly, here.
  // Some paths a document names do not exist HERE — they exist in the game the
  // templates generate. Each one is listed with why, because "it's generated"
  // is a fine answer and "I forgot" is not, and only the list tells them apart.
  const GENERATED = {
    'tools/kit-node.js': 'written into every new game from templates/_shared/kit-node.js.tmpl',
  };
  const missing = [];
  for (const d of all) {
    for (const m of d.text.matchAll(/`((?:js|e2e|test|tools|templates|docs|css)\/[A-Za-z0-9_\-./*]+)`/g)) {
      const rel = m[1];
      if (rel.includes('*') || rel.endsWith('/')) continue;      // globs and directories
      if (GENERATED[rel]) continue;
      if (!fs.existsSync(path.join(ROOT, rel))) missing.push(`${d.file}: ${rel}`);
    }
  }
  assert.deepEqual(missing, [], `documents naming files that are not there:\n  ${missing.join('\n  ')}`);
});

test('docs: the interaction matrix is real and every pair in it is tested', () => {
  // WEFT's plan has a table of nine primitive-pair defaults and no way to know
  // whether the code agrees with it. The version here IS the tests, so the
  // table cannot drift from the behaviour; this only checks it is not empty and
  // that the names still read as pairs.
  //
  // The matrix is a NAMING RULE, not one file: a test called `a × b:` states the
  // default for that pair, and it lives beside whichever primitive it is about
  // (interactions.test.js for the older ones, rules.test.js for the rules
  // pairs). Pinning it to one path made the test lie the first time a primitive
  // arrived with its own suite.
  const pairs = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.test.js')) {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/test\('([a-z ]+) × ([a-z ]+):/g)) pairs.push(m);
      }
    }
  };
  walk(path.join(ROOT, 'test'));
  assert.ok(pairs.length >= 12, `the matrix covers real pairs (${pairs.length})`);
  const kinds = new Set(pairs.flatMap((m) => [m[1], m[2]]));
  assert.ok(kinds.size >= 6, `across at least six primitives (${Array.from(kinds).sort().join(', ')})`);
  // And the original table is still a table, not an empty file somebody moved on from.
  const src = fs.readFileSync(path.join(ROOT, 'test/kit/interactions.test.js'), 'utf8');
  assert.ok((src.match(/ × /g) || []).length >= 10, 'interactions.test.js still holds the bulk of it');
});

/** How many unit tests there actually are, counted the way `npm test` counts. */
function countTests() {
  let n = 0;
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.test.js')) {
        n += (fs.readFileSync(p, 'utf8').match(/^test\(/gm) || []).length;
      }
    }
  };
  walk(path.join(ROOT, 'test'));
  return n;
}
