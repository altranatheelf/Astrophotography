// Loads the kit core in order for tests. require() returns the shared KIT.
//
// The order is CORE's, from templates/_shared/kit-files.js — this is a PREFIX of
// the engine, not a different engine, and test/kit/load-order.test.js proves it.
// Add a file here by taking it from that list, never by guessing where it goes.
'use strict';
const path = require('path');
const root = path.join(__dirname, '..', '..');

const files = [
  'js/kit/core/util.js',
  'js/kit/core/events.js',
  'js/kit/core/rng.js',
  'js/kit/core/registry.js',
  'js/kit/core/schema.js',
  'js/kit/core/registries.js',
  'js/kit/core/modules.js',
  'js/kit/core/pixels.js',
  'js/kit/core/input.js',
  'js/kit/core/audio.js',
  'js/kit/core/lang.js',
  'js/kit/world/document.js',
  'js/kit/world/project.js',
  'js/kit/world/tiles.js',
  'js/kit/world/cast.js',
  'js/kit/world/log.js',
  'js/kit/script/text.js',
  'js/kit/script/conditions.js',
  'js/kit/script/commands.js',
  'js/kit/script/screenplay.js',
  'js/kit/script/interpreter.js',
];
for (const f of files) require(path.join(root, f));
module.exports = globalThis.KIT;
