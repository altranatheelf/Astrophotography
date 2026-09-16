#!/usr/bin/env node
// tools/share.js — squash the whole game into ONE .html file you can send to
// somebody: AirDrop it, e-mail it, put it on a stick. They double-click it and
// it plays, with no folder and no internet.
//
//   npm run share                  -> <Your Game>.html next to index.html
//   node tools/share.js out.html   -> somewhere else
//
// It reads index.html, inlines every local stylesheet and script in order, and
// leaves the web font alone (if it cannot be fetched the fallback type is fine).
'use strict';
const fs = require('fs');
const path = require('path');

const GAME = path.resolve(__dirname, '..');
const name = require(path.join(GAME, 'package.json')).name || 'game';
const outFile = path.resolve(process.argv[2] || path.join(GAME, name + '.html'));
let html = fs.readFileSync(path.join(GAME, 'index.html'), 'utf8');

const isLocal = (src) => src && !/^(https?:)?\/\//i.test(src) && !src.startsWith('data:');
const resolve = (rel) => path.resolve(GAME, rel.split('?')[0]);

let styles = 0, scripts = 0, skipped = 0;
html = html.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, (tag) => {
  const m = tag.match(/href=["']([^"']+)["']/i);
  if (!m || !isLocal(m[1])) return tag;
  if (!fs.existsSync(resolve(m[1]))) { skipped++; return ''; }
  styles++;
  return `<style>\n/* ${m[1]} */\n${fs.readFileSync(resolve(m[1]), 'utf8')}\n</style>`;
});
html = html.replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (tag, src) => {
  if (!isLocal(src)) return tag;
  if (!fs.existsSync(resolve(src))) { skipped++; console.warn(`  (skipped ${src}: not there)`); return ''; }
  scripts++;
  const code = fs.readFileSync(resolve(src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script>\n// ---- ${src} ----\n${code}\n</script>`;
});

fs.writeFileSync(outFile, html);
const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
console.log(`${styles} stylesheet(s) and ${scripts} script(s)${skipped ? ` (${skipped} missing skipped)` : ''} -> ${path.relative(process.cwd(), outFile)} (${kb} KB)`);
console.log('Send that one file to anybody. It needs nothing else.');
