'use strict';
// The hard lines, read off the one instrument (tools/slop.js).
//
// These are the patterns the research on AI-assisted code says arrive first and
// cost most, held at zero: a helper copied instead of called, an error swallowed
// without a word, API written for a caller that never came, and the leftovers of
// a session (console.log, TODO). The measurements that are judgment calls —
// function length, files that share six-line windows — are reported by
// `npm run slop` and not gated here, because a 400-line UI builder can be one
// coherent thing and a threshold cannot tell.
const test = require('node:test');
const assert = require('node:assert/strict');
const { measure } = require('../../tools/slop.js');

const M = measure();

test('no helper is copied where it could be called', () => {
  assert.deepEqual(M.helperCopies, [], 'util.js is the one place; alias it (`const num = KIT.num`):\n  ' + M.helperCopies.join('\n  '));
});

test('no error is swallowed without a word', () => {
  // An empty catch may be right — a feature probe, an optional API — but it has
  // to say so. A bare one is a bug report that was never filed.
  assert.deepEqual(M.emptyCatches.bare, [], 'these catch and say nothing:\n  ' + M.emptyCatches.bare.join('\n  '));
});

test('no API is defined for a caller that never came', () => {
  // Referenced from nowhere — not the engine, not a module, not a test, a tool,
  // a doc or a page. Document it or it is dead.
  assert.deepEqual(M.deadApi, [], 'nothing anywhere calls these:\n  ' + M.deadApi.join('\n  '));
});

test('nothing was left behind after a session', () => {
  const logs = M.consoleLog.filter(x => !x.startsWith('js/modules/mons/e2e.node.js'));   // a node harness that prints on purpose
  assert.deepEqual(logs, [], 'console.log in engine code:\n  ' + logs.join('\n  '));
  assert.deepEqual(M.todo, [], 'TODO/FIXME/XXX/HACK: file an issue or do it:\n  ' + M.todo.join('\n  '));
});
