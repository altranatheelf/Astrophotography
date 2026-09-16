// The templates a new game can start from.
//
//   const templates = require('./templates');
//   templates.list()          -> [{ id, label, describe, modules, ... }]
//   templates.get('empty')    -> that one, with dir and builder resolved
//
// A template is a folder with four files:
//   template.js   the whole world as one build() function (copied into the game as story.js)
//   art.js        the pictures that game adds (copied into the game as art/<art>)
//                 — the row below names the file it lands under
//   look.css      its look (copied into the game as look.css)
//   README.md     one page: what it is and what to change first
//
// To add one: copy a folder, change these four files, and add a row below.
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = __dirname;

const TEMPLATES = [
  {
    id: 'empty',
    label: 'Empty',
    describe: 'One room and one person. Nothing else — the first thing in it should be yours.',
    art: 'world.js',
    modules: [],
  },
];

/** list() -> every template, with its folder attached. */
function list() {
  return TEMPLATES.map(t => Object.assign({}, t, { dir: path.join(DIR, t.id) }))
    .filter(t => fs.existsSync(path.join(t.dir, 'template.js')));
}

/** get(id) -> one template, or null. `builder` is its template.js module. */
function get(id) {
  const t = list().find(x => x.id === id);
  if (!t) return null;
  return Object.assign({}, t, {
    builder: require(path.join(t.dir, 'template.js')),
    files: {
      story: path.join(t.dir, 'template.js'),
      art: path.join(t.dir, 'art.js'),
      look: path.join(t.dir, 'look.css'),
      readme: path.join(t.dir, 'README.md'),
    },
  });
}

/** ids() -> just the names, for a usage line. */
function ids() { return list().map(t => t.id); }

module.exports = { list, get, ids, DIR, shared: path.join(DIR, '_shared') };
