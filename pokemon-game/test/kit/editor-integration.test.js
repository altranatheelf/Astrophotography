// The pure part of Creator Mode's joins (js/kit/editor/integration.js and the
// hook it borrows from tools.js): the zoom a map opens at.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const KIT = require('./_load.js');
const root = path.join(__dirname, '..', '..');
require(path.join(root, 'js/kit/world/map.js'));
require(path.join(root, 'js/kit/editor/ops.js'));
require(path.join(root, 'js/kit/editor/tools.js'));

const fit = KIT.editor.tools.fitScale;

test('editor: a map opens at a zoom that shows all of it', () => {
  // 12 × 10 squares of 16px in a 940 × 740 stage: 4 fits (768 × 640), 5 would not.
  assert.equal(fit({ stageW: 940, stageH: 740, mapW: 12, mapH: 10 }), 4);
  // A big map is shown as much as possible, never below 1.
  assert.equal(fit({ stageW: 940, stageH: 740, mapW: 200, mapH: 200 }), 1);
  // A tiny map does not blow up past the editor's own limit.
  assert.equal(fit({ stageW: 1600, stageH: 1200, mapW: 2, mapH: 2 }), 8);
});

test('editor: on a phone the squares stay big enough for a thumb', () => {
  // The whole map would fit at 1 (16px squares); that is too small to tap, so 2.
  assert.equal(fit({ stageW: 390, stageH: 300, mapW: 12, mapH: 10, minTile: 32 }), 2);
  // With no thumb to worry about, the same stage fits the map at 1.
  assert.equal(fit({ stageW: 390, stageH: 300, mapW: 12, mapH: 10 }), 1);
});

test('editor: an unmeasured stage falls back to 1 rather than dividing by zero', () => {
  assert.equal(fit({ stageW: 0, stageH: 0, mapW: 12, mapH: 10 }), 1);
  assert.equal(fit({}), 1);
});

test('editor: the project tile size is respected', () => {
  assert.equal(fit({ stageW: 640, stageH: 640, mapW: 10, mapH: 10, tileSize: 32 }), 2);
});
