#!/usr/bin/env node
// The numbers that say whether this codebase was assembled or built.
//
//   npm run slop            -> the report
//   node tools/slop.js --json
//
// These are the measurements the research on AI-assisted code (GitClear
// 2025/2026, and the code-smell lists that followed it) says move first:
// copies instead of calls, errors swallowed instead of handled, functions
// glued together from fragments, and API written for a caller that never came.
// docs/SLOP.md is the reasoning; test/kit/slop.test.js and
// test/kit/helpers.test.js are the hard lines. This file is the instrument —
// it counts, it does not judge, and it is meant to be run again in a year.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SKIP = ['js/art/', 'js/data/', 'js/sprites/', 'js/content/'];

function walk(dir, out) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (e.name.endsWith('.js') && !SKIP.some(s => rel.startsWith(s))) out.push(rel);
  }
  return out;
}
/**
 * stripComments(source) -> the source with its line and block comments blanked out,
 * strings left alone. A comment naming a function is not a use of it: the
 * doc comment above a dead function used to count as its caller.
 */
function stripComments(s) {
  let out = '', i = 0, q = null;
  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (q) {
      out += c;
      if (c === '\\') { out += d || ''; i += 2; continue; }
      if (c === q) q = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && d === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const j = s.indexOf('*/', i + 2); const gap = s.slice(i, j < 0 ? s.length : j + 2); out += gap.replace(/[^\n]/g, ' '); i = j < 0 ? s.length : j + 2; continue; }
    out += c; i++;
  }
  return out;
}

const CODE = walk('js', []).sort();
const src = Object.fromEntries(CODE.map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
const lineOf = (s, idx) => s.slice(0, idx).split('\n').length;

/**
 * Everything a definition may legitimately be referenced from: the engine, its
 * tests, tools, docs and pages — code with its comments taken out. Two
 * documents are left out because they are history: docs/SLOP.md and the
 * decision records name dead functions precisely to say they were dead.
 */
const HISTORY = [path.join('docs', 'SLOP.md'), path.join('docs', 'decisions') + path.sep];
function everything() {
  let text = Object.values(src).map(stripComments).join('\n');
  for (const dir of ['test', 'tools', 'e2e', 'docs', 'templates']) {
    if (!fs.existsSync(path.join(ROOT, dir))) continue;
    for (const f of walkAll(dir, [])) {
      if (HISTORY.some(h => f === h || f.startsWith(h))) continue;
      try {
        const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
        text += '\n' + (f.endsWith('.js') ? stripComments(t) : t);
      } catch (e) { /* unreadable: not a reference */ }
    }
  }
  text += '\n' + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return text;
}
function walkAll(dir, out) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walkAll(rel, out);
    else if (/\.(js|md|html|tmpl|css)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const M = {};

// ---- size ------------------------------------------------------------------------
M.files = CODE.length;
M.lines = CODE.reduce((n, f) => n + src[f].split('\n').length, 0);
M.largest = CODE.map(f => ({ file: f, lines: src[f].split('\n').length })).sort((a, b) => b.lines - a.lines).slice(0, 10);

// ---- comments ----------------------------------------------------------------------
let nonBlank = 0, comment = 0;
for (const f of CODE) for (const raw of src[f].split('\n')) {
  const t = raw.trim();
  if (!t) continue;
  nonBlank++;
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) comment++;
}
M.commentPct = Math.round((100 * comment) / nonBlank);

// ---- copies instead of calls ------------------------------------------------------
// A helper defined with a body in a file that is not util.js. An alias
// (`const num = KIT.num`) is a call, and is what the guard test allows.
const HELPERS = ['num', 'has', 'titleCase', 'isObj', 'isObject', 'clamp', 'slug', 'uid', 'deepClone', 'deepEqual'];
const defn = new RegExp('^[ \\t]*(?:const|let|var|function)\\s+(' + HELPERS.join('|') + ')\\b\\s*(?:=\\s*(?:\\(|function)|\\()', 'm');
M.helperCopies = [];
for (const f of CODE) {
  if (f === 'js/kit/core/util.js') continue;
  const re = new RegExp(defn.source, 'gm');
  let m;
  while ((m = re.exec(src[f]))) {
    const line = src[f].slice(m.index, src[f].indexOf('\n', m.index));
    // An alias of, or a wrapper over, the shared one — but not a copy behind a
    // guard on it (`KIT.slug ? KIT.slug(s) : <its own body>`), which is still a copy.
    if (/KIT\.[\w.]+/.test(line) && !/KIT\.\w+\s*\?/.test(line)) continue;
    if (/=\s*\((?:label|k|key)\b/.test(line)) continue;        // same name, different thing: a field builder, a schema lookup
    M.helperCopies.push(`${f}:${lineOf(src[f], m.index)}  ${m[1]}`);
  }
}

// ---- swallowed errors ----------------------------------------------------------------
// Both forms: `catch (e) {}` and a promise's `.catch(() => {})`.
M.emptyCatches = { commented: 0, bare: [] };
for (const f of CODE) {
  const forms = [
    /catch\s*\((\w+)\)\s*\{\s*(\/\*[^*]*\*\/)?\s*\}/g,
    /\.catch\(\s*(?:\(\s*\w*\s*\)|\w+|function\s*\(\s*\w*\s*\))\s*(?:=>)?\s*\{\s*(\/\*[^*]*\*\/)?\s*\}\s*\)()/g,
  ];
  for (const re of forms) {
    let m;
    while ((m = re.exec(src[f]))) {
      if (m[1] && m[1].startsWith('/*') || m[2]) M.emptyCatches.commented++;
      else M.emptyCatches.bare.push(`${f}:${lineOf(src[f], m.index)}`);
    }
  }
}

// ---- leftovers ------------------------------------------------------------------------
M.consoleLog = []; M.todo = [];
for (const f of CODE) src[f].split('\n').forEach((line, i) => {
  if (/\bconsole\.log\(/.test(line) && !line.trim().startsWith('//')) M.consoleLog.push(`${f}:${i + 1}`);
  if (/\b(TODO|FIXME|XXX|HACK)\b/.test(line)) M.todo.push(`${f}:${i + 1}`);
});

// ---- functions glued from fragments --------------------------------------------------
const head = /^(\s*)(?:(?:async\s+)?function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>\s*\{)|(\w+)\s*\([^)]*\)\s*\{|(\w+)\s*:\s*(?:async\s*)?function\b|(\w+)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{)/;
M.longest = [];
for (const f of CODE) {
  const lines = src[f].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = head.exec(lines[i]);
    if (!m) continue;
    const name = m[2] || m[3] || m[4] || m[5] || m[6];
    if (['if', 'for', 'while', 'switch', 'catch', 'function'].includes(name)) continue;
    let depth = 0, started = false, end = -1;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) { if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--; }
      if (started && depth <= 0) { end = j; break; }
    }
    if (end >= 0 && end - i >= 120) M.longest.push({ file: f, line: i + 1, name, lines: end - i + 1 });
  }
}
M.longest.sort((a, b) => b.lines - a.lines);
M.longest = M.longest.slice(0, 12);

// ---- clones across files -------------------------------------------------------------
const windows = new Map();
for (const f of CODE) {
  const ls = src[f].split('\n').map(l => l.trim().replace(/\s+/g, ' ')).filter(l => l && !l.startsWith('//') && l.length > 12);
  for (let i = 0; i + 6 <= ls.length; i++) {
    const h = crypto.createHash('md5').update(ls.slice(i, i + 6).join('\n')).digest('hex');
    if (!windows.has(h)) windows.set(h, new Set());
    windows.get(h).add(f);
  }
}
const pairs = new Map();
for (const files of windows.values()) {
  if (files.size < 2) continue;
  const arr = [...files].sort();
  for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) {
    const k = arr[a] + '  <->  ' + arr[b];
    pairs.set(k, (pairs.get(k) || 0) + 1);
  }
}
M.clones = [...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => ({ pair: k, windows: n }));

// ---- API nothing calls -------------------------------------------------------------------
const ALL = everything();
M.deadApi = [];
for (const f of CODE) {
  const re = /^[ \t]*([A-Z][A-Za-z]*|KIT)\.(\w{4,})\s*=\s*(?:async\s*)?(?:function|\()/gm;
  let m;
  while ((m = re.exec(src[f]))) {
    const name = m[2];
    const uses = (ALL.match(new RegExp('\\b' + name + '\\b', 'g')) || []).length;
    if (uses <= 1) M.deadApi.push(`${f}:${lineOf(src[f], m.index)}  ${m[1]}.${name}`);
  }
}

module.exports = { measure: () => M, CODE, stripComments };
if (require.main !== module) return;

// ---- report -------------------------------------------------------------------------------
if (process.argv.includes('--json')) { console.log(JSON.stringify(M, null, 2)); process.exit(0); }
const h = (t) => console.log('\n' + t);
console.log(`${M.files} files, ${M.lines} lines of engine and module code (art, data and content excluded); ${M.commentPct}% comment lines`);
h('largest files');
for (const x of M.largest) console.log(`  ${String(x.lines).padStart(6)}  ${x.file}`);
h(`helpers copied instead of called: ${M.helperCopies.length}`);
for (const x of M.helperCopies) console.log('  ' + x);
h(`empty catch blocks: ${M.emptyCatches.commented} with a comment, ${M.emptyCatches.bare.length} bare`);
for (const x of M.emptyCatches.bare) console.log('  bare: ' + x);
h(`console.log left in: ${M.consoleLog.length}    TODO/FIXME/XXX/HACK: ${M.todo.length}`);
for (const x of M.consoleLog.concat(M.todo)) console.log('  ' + x);
h('longest functions (120 lines and up)');
for (const x of M.longest) console.log(`  ${String(x.lines).padStart(5)} lines  ${x.file}:${x.line}  ${x.name}`);
h('six-line windows shared between files');
for (const x of M.clones) console.log(`  ${String(x.windows).padStart(3)}  ${x.pair}`);
h(`API defined and referenced nowhere else (js, tests, tools, docs, pages): ${M.deadApi.length}`);
for (const x of M.deadApi) console.log('  ' + x);
console.log('');
