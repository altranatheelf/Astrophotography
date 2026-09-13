#!/usr/bin/env node
// Bundle the whole game into ONE html file so it can be sent as a single
// attachment (AirDrop / iMessage / email) and opened on any phone or laptop.
//   node tools/build.js            -> writes Pokemon-Battle-Night.html next to index.html
//   node tools/build.js out.html   -> custom output path
// It reads index.html, inlines every local <link rel="stylesheet"> and
// <script src="..."> in order, and leaves external URLs (fonts) untouched.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outFile = path.resolve(process.argv[2] || path.join(root, 'Pokemon-Battle-Night.html'));
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const isLocal = (src) => src && !/^(https?:)?\/\//i.test(src) && !src.startsWith('data:');
const read = (rel) => fs.readFileSync(path.join(root, rel.split('?')[0]), 'utf8');

let styles = 0, scripts = 0;
html = html.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, (tag) => {
  const m = tag.match(/href=["']([^"']+)["']/i);
  if (!m || !isLocal(m[1])) return tag;
  styles++;
  return `<style>\n/* ${m[1]} */\n${read(m[1])}\n</style>`;
});
html = html.replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (tag, src) => {
  if (!isLocal(src)) return tag;
  scripts++;
  const code = read(src).replace(/<\/script/gi, '<\\/script');
  return `<script>\n// ---- ${src} ----\n${code}\n</script>`;
});

fs.writeFileSync(outFile, html);
const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
console.log(`bundled ${styles} stylesheet(s) and ${scripts} script(s) -> ${path.relative(process.cwd(), outFile)} (${kb} KB)`);
