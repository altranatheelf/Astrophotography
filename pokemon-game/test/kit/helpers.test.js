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
const KIT = require('./_load.js');

const SHARED = ['num', 'has', 'titleCase', 'isObject', 'clamp', 'slug', 'uid', 'deepClone', 'deepEqual'];
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
  // One scan, in tools/slop.js; test/kit/slop.test.js holds the line and this
  // one just says which helper the rule is about.
  const { measure } = require('../../tools/slop.js');
  assert.deepEqual(measure().helperCopies, []);
});
