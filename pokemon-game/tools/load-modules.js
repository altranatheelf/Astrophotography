// One place that knows how to load the modules the demo enables, in the order
// index.html loads them. `tools/build-demo.js` and `test/kit/demo.test.js` both
// use it, so the demo can never be built against one set of modules and checked
// against another.
//
//   const KIT = require('../test/kit/_load.js');
//   require('./load-modules.js').load(KIT, ['mons', 'home']);
//
// It is a Node helper, not part of the engine: the page loads the same files
// with <script> tags (see the module block at the bottom of index.html).
'use strict';
const path = require('path');
const root = path.join(__dirname, '..');
const R = (f) => require(path.join(root, f));

/** The files each module needs, in load order. `manifest` must come last. */
const FILES = {
  mons: ['rules', 'strings', 'art', 'actions', 'script', 'systems', 'scenes', 'essentials', 'region', 'panel', 'manifest'],
  home: ['rules', 'register', 'scenes', 'panel', 'manifest'],
  dungeon: ['rules', 'art', 'register', 'panel', 'manifest'],
  bullet: ['rules', 'register', 'manifest'],
};

/**
 * SPRITES() -> every portrait file, read from the folder. It used to be a list
 * written out here and in two tests, and a new portrait had to be added to all
 * three or it silently was not there. index.html is held to the folder by
 * test/kit/load-order.test.js.
 */
function SPRITES() {
  const dir = path.join(root, 'js', 'sprites');
  return require('fs').readdirSync(dir).filter(f => f.endsWith('.js')).sort().map(f => 'js/sprites/' + f);
}

/** What a module needs from outside its own folder before it will load. */
function prerequisites(id) {
  if (id !== 'mons') return;
  for (const f of ['js/data/types.js', 'js/data/moves.js', 'js/data/pokemon.js']) R(f);
  for (const f of SPRITES()) R(f);
}

/**
 * load(KIT, ids) -> the manifests that registered, in dependency order.
 * Requires each module's files, then lets the engine activate them exactly as
 * boot does — so what the demo is built against is what the page runs.
 */
function load(KIT, ids) {
  const wanted = (ids && ids.length ? ids : Object.keys(FILES));
  R('js/kit/core/modules.js');                       // KIT.module / KIT.modules
  for (const id of wanted) {
    const files = FILES[id];
    if (!files) throw new Error(`load-modules: no such module “${id}”`);
    prerequisites(id);
    for (const f of files) R(`js/modules/${id}/${f}.js`);
  }
  // The manifests register themselves the moment they load (KIT.module exists
  // in Node), so this is the same call boot makes.
  return KIT.modules.activate({ modules: wanted });
}

module.exports = { load, FILES, SPRITES };
