#!/usr/bin/env node
// tools/open.js — open this game in your browser.
//
//   npm start          (or: node tools/open.js)
//   node tools/open.js --edit     goes straight into Creator Mode
//
// It hands index.html to whatever opens pages on this machine. If that does not
// work (a server, a container, a locked-down laptop), it prints the address and
// you paste it in yourself.
'use strict';
const path = require('path');
const { spawn } = require('child_process');

const GAME = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const query = args.includes('--edit') ? '?edit=1' : (args.find(a => a.startsWith('?')) || '');
const url = 'file://' + path.join(GAME, 'index.html') + query;

const opener = process.platform === 'darwin' ? ['open', [url]]
  : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];

console.log(url);
try {
  const child = spawn(opener[0], opener[1], { stdio: 'ignore', detached: true });
  child.on('error', () => console.log('\nCould not open a browser here. Copy the address above into one.'));
  child.unref();
} catch (e) {
  console.log('\nCould not open a browser here. Copy the address above into one.');
}
