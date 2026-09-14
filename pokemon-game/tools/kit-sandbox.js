// A vm sandbox with the kit core and the art registry files loaded, for the
// art tools. Art files (js/art/*.js, js/sprites/*.js) register into
// KIT.registry('tiles') / ('sprites') through the PKMN.TILES / PKMN.CHARS
// aliases, so the kit must be there before them.
//   const { createSandbox, loadInto, KIT_CORE } = require('./kit-sandbox.js');
//   const sandbox = createSandbox();          // { window, globalThis, console, KIT, PKMN }
//   loadInto(sandbox, 'js/art/tiles-nature.js');
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
/** Kit files the art depends on, in load order (see docs/ARCHITECTURE.md §1). */
const KIT_CORE = [
  'js/kit/core/util.js', 'js/kit/core/events.js', 'js/kit/core/rng.js', 'js/kit/core/registry.js', 'js/kit/core/schema.js',
  'js/kit/core/registries.js', 'js/kit/core/pixels.js', 'js/kit/world/document.js', 'js/kit/world/project.js', 'js/kit/world/tiles.js',
];
/** The art registry files (aliases over the kit registries). */
const ART_REGISTRIES = ['js/art/tiles.js', 'js/art/chars.js'];

function loadInto(sandbox, rel, optional) {
  const p = path.isAbsolute(rel) ? rel : path.join(root, rel);
  if (!fs.existsSync(p)) { if (optional) return false; throw new Error(`missing file ${rel}`); }
  vm.runInNewContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: p });
  return true;
}

function createSandbox(opts) {
  opts = opts || {};
  const sandbox = { console };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  sandbox.PKMN = {};
  for (const f of KIT_CORE) loadInto(sandbox, f);
  if (opts.art !== false) for (const f of ART_REGISTRIES) loadInto(sandbox, f);
  return sandbox;
}

module.exports = { createSandbox, loadInto, KIT_CORE, ART_REGISTRIES, root };
