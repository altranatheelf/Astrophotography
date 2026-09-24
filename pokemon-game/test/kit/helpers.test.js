'use strict';
// One helper, one definition.
//
// `num`, `isObj`, `titleCase`, `has` and `clamp` were each written out again in
// file after file — twenty-one copies of `num` at the worst — and the copies
// drifted: num(null, 5) was 0 in js/kit and 5 in js/modules. That is the
// signature of code assembled a file at a time, and the published research on
// AI-assisted codebases names it first (copy/paste up, cross-file calls down).
// util.js is the one place now; a file may alias (`const num = KIT.num`) and
// may not redefine.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const KIT = require('./_load.js');

const ROOT = path.join(__dirname, '..', '..');
const SHARED = ['num', 'has', 'titleCase', 'isObject', 'clamp', 'slug', 'uid', 'deepClone', 'deepEqual'];
const LOCAL_NAMES = ['num', 'has', 'titleCase', 'isObj', 'isObject', 'clamp', 'slug', 'uid', 'deepClone', 'deepEqual'];

function codeFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...codeFiles(rel));
    else if (entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

test('util.js provides every shared helper', () => {
  for (const name of SHARED) assert.equal(typeof KIT[name], 'function', 'KIT.' + name);
});

test('num: one contract — coerce, and null means "not given"', () => {
  assert.equal(KIT.num('3', 0), 3);
  assert.equal(KIT.num(3.5, 0), 3.5);
  assert.equal(KIT.num(0, 9), 0, 'zero is a number, not an absence');
  assert.equal(KIT.num(null, 5), 5, 'null takes the fallback (it used to become 0 in half the engine)');
  assert.equal(KIT.num(undefined, 5), 5);
  assert.equal(KIT.num('abc', 7), 7);
  assert.equal(KIT.num(NaN, 7), 7);
  assert.equal(KIT.num(Infinity, 7), 7);
  assert.equal(KIT.num(undefined), 0, 'and the fallback itself defaults to 0, as the importers relied on');
  assert.equal(KIT.num(null, null), null, 'but an explicit fallback is kept as given');
});

test('has / titleCase: the shapes the copies agreed on', () => {
  assert.equal(KIT.has({ a: 1 }, 'a'), true);
  assert.equal(KIT.has({ a: 1 }, 'toString'), false, 'own properties only');
  assert.equal(KIT.has(null, 'a'), false);
  assert.equal(KIT.has(undefined, 'a'), false);
  assert.equal(KIT.titleCase('big-tree'), 'Big Tree');
  assert.equal(KIT.titleCase('roof_red_eave'), 'Roof Red Eave');
  assert.equal(KIT.titleCase('a--b__c'), 'A B C', 'runs collapse to one space');
  assert.equal(KIT.titleCase('  padded  '), 'Padded');
  assert.equal(KIT.titleCase(''), '');
  assert.equal(KIT.titleCase(null), '');
});

test('no engine or module file defines its own copy of a shared helper', () => {
  // A definition with a BODY is the smell. `const num = KIT.num;` is an alias
  // and fine; so is a one-liner that calls the shared one (essentials lowercases
  // first because PBS writes names in capitals).
  const defn = new RegExp('^\\s*(?:const|let|var|function)\\s+(' + LOCAL_NAMES.join('|') + ')\\b\\s*(?:=|\\()');
  const guilty = [];
  for (const rel of codeFiles('js/kit').concat(codeFiles('js/modules'))) {
    const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = defn.exec(line);
      if (!m) return;
      if (/=\s*KIT\.\w+\s*;?\s*(\/\/.*)?$/.test(line)) return;        // an alias
      if (/KIT\.(num|has|titleCase|isObject|clamp|slug|uid|deepClone|deepEqual)\(/.test(line)) return;  // a wrapper over the shared one
      if (rel === 'js/kit/core/util.js') return;                        // the one place
      // Same name, different thing: a field builder called num, a schema lookup called has.
      if (/=\s*\((?:label|k|key)\b/.test(line)) return;
      if (/=\s*\/\^/.test(line)) return;                                 // a regex match result
      if (/=\s*KIT\.[\w.]+\(/.test(line)) return;                        // a value, not a helper
      if (/=\s*(?:mon|o|m|action|String\()/.test(line) && m[1] === 'uid') return;   // a local variable called uid
      guilty.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(guilty, [], 'these redefine a helper util.js already provides:\n  ' + guilty.join('\n  '));
});
