#!/usr/bin/env node
// Bundle the whole game into ONE html file so it can be sent as a single
// attachment (AirDrop / iMessage / email) and opened on any phone or laptop.
//   node tools/build.js            -> writes Our-Adventure.html next to index.html
//   node tools/build.js out.html   -> custom output path
// It reads index.html, inlines every local <link rel="stylesheet"> and
// <script src="..."> in order, and leaves external URLs (fonts) untouched.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outFile = path.resolve(process.argv[2] || path.join(root, 'Our-Adventure.html'));
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const isLocal = (src) => src && !/^(https?:)?\/\//i.test(src) && !src.startsWith('data:');
const read = (rel) => fs.readFileSync(path.join(root, rel.split('?')[0]), 'utf8');
const missing = (rel) => !fs.existsSync(path.join(root, rel.split('?')[0]));

let styles = 0, scripts = 0, skipped = 0;
html = html.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, (tag) => {
  const m = tag.match(/href=["']([^"']+)["']/i);
  if (!m || !isLocal(m[1])) return tag;
  // index.html lists content files that need not exist yet (the demo's assets.js
  // appears the first time something is imported); a missing one is dropped.
  if (missing(m[1])) { skipped++; console.warn(`  (skipped ${m[1]}: not there)`); return ''; }
  styles++;
  return `<style>\n/* ${m[1]} */\n${read(m[1])}\n</style>`;
});
html = html.replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (tag, src) => {
  if (!isLocal(src)) return tag;
  if (missing(src)) { skipped++; console.warn(`  (skipped ${src}: not there)`); return ''; }
  scripts++;
  const code = read(src).replace(/<\/script/gi, '<\\/script');
  return `<script>\n// ---- ${src} ----\n${code}\n</script>`;
});

// Head links to files that do not travel with a single attachment: the web app
// manifest and the home-screen icons live beside index.html, and this file is
// meant to be opened from wherever somebody saved it. Left in, every open is
// three 404s for nothing — the manifest only ever does anything on a served
// copy, which is what `npm run phone` is for.
html = html.replace(/[ \t]*<link\b[^>]*\brel=["'](?:manifest|apple-touch-icon|icon)["'][^>]*>\n?/gi, '');
fs.writeFileSync(outFile, html);
const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
console.log(`bundled ${styles} stylesheet(s) and ${scripts} script(s)${skipped ? ` (${skipped} missing file(s) skipped)` : ''} -> ${path.relative(process.cwd(), outFile)} (${kb} KB)`);
