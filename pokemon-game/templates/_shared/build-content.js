#!/usr/bin/env node
// tools/build-content.js — turns story.js into the files the game loads.
//
//   npm run build            (or: node tools/build-content.js)
//
// story.js describes the whole world in one readable file. This script loads
// the Kit, asks story.js for the world, checks it, and writes
// content/project.js and content/maps/*.js. Nothing else writes those files, so
// they cannot drift out of shape.
//
// You do NOT have to use this. Creator Mode edits the same world in the browser
// and saves a draft; "Export" writes the same files back. Use whichever you
// like — but if you edit story.js, run this, and if you edit in Creator Mode,
// export before you run this again or you will write over your afternoon.
'use strict';
const fs = require('fs');
const path = require('path');

const KIT = require('./kit-node.js');
const GAME = path.resolve(__dirname, '..');
const story = require(path.join(GAME, 'story.js'));

const raw = story.build({ KIT, id: story.id, name: story.name || story.id });
const { project, problems } = KIT.project.normalize(raw);

let errors = 0;
for (const p of problems) {
  const where = p.where ? ' ' + JSON.stringify(p.where) : '';
  console.log(`${p.severity === 'error' ? 'ERROR' : 'warn '} [${p.code}] ${p.message}${where}`);
  if (p.severity === 'error') errors++;
}
if (errors) {
  console.error(`\n${errors} error(s) — nothing written. Fix story.js and run again.`);
  process.exit(1);
}

const files = KIT.project.exportFiles(project);
const outDir = path.join(GAME, 'content');
fs.mkdirSync(path.join(outDir, 'maps'), { recursive: true });
// Maps that no longer exist should not linger.
for (const old of fs.existsSync(path.join(outDir, 'maps')) ? fs.readdirSync(path.join(outDir, 'maps')) : []) {
  if (old.endsWith('.js') && !files['maps/' + old]) fs.unlinkSync(path.join(outDir, 'maps', old));
}
for (const [name, text] of Object.entries(files)) {
  const file = path.join(outDir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(`wrote content/${name} (${(text.length / 1024).toFixed(1)} KB)`);
}
const objects = Object.values(project.maps).reduce((n, m) => n + m.objects.length, 0);
console.log(`\n${Object.keys(project.maps).length} maps, ${objects} events, ${Object.keys(project.scripts).length} common events. Open index.html to play it.`);
