#!/usr/bin/env node
// tools/pack-kit.js — copy the engine out of this repo as a kit of its own.
//
//   node tools/pack-kit.js                    -> ./kit/
//   node tools/pack-kit.js --out ~/kit-1.0.0
//   node tools/new-game.js "My Game" --kit ~/kit-1.0.0
//
// This is the proof that the Kit is a library and not a game: what comes out is
// the engine, its art, its stylesheets, the tools a game needs, the templates
// and the modules those templates use — and not one line of anybody's story.
// A packed kit is checked for exactly that before it is written: if any file in
// it still reaches into js/content or js/modules, the pack is refused.
//
// The layout inside a packed kit is the same as in the repo (js/kit, js/art,
// css) except for one thing: the modules move from js/modules to modules,
// because a packed kit has no js/ folder of game code to live in.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const KIT_FILES = require(path.join(ROOT, 'templates/_shared/kit-files.js'));

// ---- what goes in ----------------------------------------------------------------
/** The tools a game (or the person making one) actually needs. */
const TOOLS = [
  'new-game.js', 'new-module.js', 'pack-kit.js',
  'import.js', 'kit-sandbox.js', 'art-png.js', 'sprite-png.js', 'sprite-sheet.js',
];
/** The documents that describe the engine rather than this repo's own game. */
const DOCS = [
  'STARTING-A-GAME.md', 'KIT-API.md', 'MODULES.md', 'EDITOR-CONTRACT.md',
  'CREATOR-MODE.md', 'IMPORTING.md', 'IMPORT-CONTRACT.md', 'ARCHITECTURE.md',
  'DESIGN.md', 'WHAT-THIS-ENGINE-IS-FOR.md',
];
/** Folders copied whole. */
const TREES = ['js/kit', 'js/art', 'css', 'templates'];
/**
 * The modules the engine itself ships with: general systems any game might
 * switch on, not one game's idea. A template may ask for more; these travel
 * whether a template asks or not, because they are part of what the kit IS.
 * A module belongs here only if it names no story of its own.
 */
const KIT_MODULES = ['dungeon'];

// This file is the one that has to TALK about the two folders a packed kit does
// not have, so it spells their names in pieces — otherwise it would rewrite
// itself on the way out, and the packed copy would no longer know what to look
// for. Every other file may say them in full; they get rewritten.
const GAME_CONTENT = 'js' + '/' + 'content';
const GAME_MODULES = 'js' + '/' + 'modules';

/**
 * A packed kit has no game content and no game modules folder, so the few
 * places that name those paths are rewritten to the packed layout as they are
 * copied. Each rewrite is printed, and the check afterwards proves none were
 * missed.
 */
const REWRITES = [
  { from: new RegExp(GAME_CONTENT + '/demo', 'g'), to: 'content' },
  { from: new RegExp(GAME_CONTENT, 'g'), to: 'content' },
  { from: new RegExp(GAME_MODULES, 'g'), to: 'modules' },
];
/** Extensions the "no game in here" check reads. Everything text-shaped. */
const CHECKED = ['.js', '.html', '.css', '.json', '.md'];

// ---- arguments ---------------------------------------------------------------------
function parseArgs(argv) {
  const o = { out: null, version: null, force: false, quiet: false, help: false };
  const takes = { '--out': 'out', '-o': 'out', '--version': 'version' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a === '--quiet' || a === '-q') { o.quiet = true; continue; }
    if (a === '--force' || a === '-f') { o.force = true; continue; }
    if (takes[a]) { o[takes[a]] = argv[++i]; continue; }
    if (a.startsWith('--')) { o.unknown = a; continue; }
    if (!o.out) o.out = a;
  }
  return o;
}
const USAGE = [
  'Copy the engine out of this repo as a kit of its own.',
  '',
  '  node tools/pack-kit.js [--out <dir>] [--version <v>] [--force]',
  '',
  '    --out <dir>       where to write it            (default: ./kit)',
  '    --version <v>     the version stamp            (default: today’s date)',
  '    --force           write over a kit that is already there',
  '',
  '  node tools/pack-kit.js --out ~/kit-2026-09',
  '  node tools/new-game.js "My Game" --kit ~/kit-2026-09 --into ~/games',
].join('\n');

// ---- copying ---------------------------------------------------------------------------
const isText = (f) => CHECKED.includes(path.extname(f));
/** The shortest way to say where something is: relative when that is shorter, else absolute. */
const show = (p2) => { const r = path.relative(process.cwd(), p2); return (!r || r.startsWith('..')) ? p2 : r; };

function rewrite(text) {
  let out = text, n = 0;
  for (const r of REWRITES) {
    out = out.replace(r.from, (m) => { n++; return r.to; });
  }
  return { text: out, changed: n };
}

function copyFile(from, to, report) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (!isText(from)) { fs.copyFileSync(from, to); report.files.push(to); return; }
  const src = fs.readFileSync(from, 'utf8');
  const r = rewrite(src);
  fs.writeFileSync(to, r.text);
  report.files.push(to);
  if (r.changed) report.rewritten.push({ file: to, count: r.changed });
}

function copyTree(from, to, report, skip) {
  if (!fs.existsSync(from)) return;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const a = path.join(from, entry.name), b = path.join(to, entry.name);
    if (skip && skip(a)) continue;
    if (entry.isDirectory()) copyTree(a, b, report, skip);
    else copyFile(a, b, report);
  }
}

/** Every file in the packed kit, relative to it. */
function walk(dir, base) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/**
 * check(dir) -> [{ file, line, text }] — every place a packed file still names
 * a game's content or module folder. This is the promise the pack makes.
 */
const FORBIDDEN = new RegExp(GAME_CONTENT + '|' + GAME_MODULES);
function check(dir) {
  const bad = [];
  for (const rel of walk(dir, dir)) {
    if (!isText(rel)) continue;
    const text = fs.readFileSync(path.join(dir, rel), 'utf8');
    text.split('\n').forEach((line, i) => {
      if (FORBIDDEN.test(line)) bad.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
    });
  }
  return bad;
}
const stamp = () => new Date().toISOString().slice(0, 10);

// ---- the run --------------------------------------------------------------------------
function main(argv) {
  const opts = parseArgs(argv);
  const say = (...a) => { if (!opts.quiet) console.log(...a); };
  if (opts.help) { console.log(USAGE); return 0; }
  if (opts.unknown) { console.error(`I do not know the option ${opts.unknown}.\n`); console.log(USAGE); return 2; }

  const out = path.resolve(process.cwd(), opts.out || 'kit');
  if (fs.existsSync(out) && !opts.force) {
    const inside = fs.readdirSync(out);
    if (inside.length) {
      console.error([
        `There is already something at ${show(out)}, so I have not touched it.`,
        'Pass --force to write over it, or --out <somewhere else>.',
      ].join('\n'));
      return 1;
    }
  }

  const report = { files: [], rewritten: [] };
  fs.mkdirSync(out, { recursive: true });

  // 1. the engine, the art, the stylesheets, the templates
  for (const tree of TREES) copyTree(path.join(ROOT, tree), path.join(out, tree), report);
  copyFile(path.join(ROOT, 'js/main.js'), path.join(out, 'js/main.js'), report);

  // 2. the tools a game needs
  for (const t of TOOLS) {
    const from = path.join(ROOT, 'tools', t);
    if (fs.existsSync(from)) copyFile(from, path.join(out, 'tools', t), report);
  }

  // 3. the engine's own modules, plus any a packed template asks for — as
  //    `modules/`, not `js/modules/`
  const templates = require(path.join(ROOT, 'templates'));
  const wanted = Array.from(new Set(
    KIT_MODULES.concat([].concat(...templates.list().map(t => t.modules || [])))));
  const modules = [];
  for (const id of wanted) {
    const from = path.join(ROOT, 'js', 'modules', id);
    if (!fs.existsSync(from)) { console.error(`The kit wants the module “${id}”, which is not in ${path.join('js', 'modules')}.`); return 2; }
    copyTree(from, path.join(out, 'modules', id), report);
    modules.push(id);
  }

  // 4. the docs that are about the engine
  for (const d of DOCS) {
    const from = path.join(ROOT, 'docs', d);
    if (fs.existsSync(from)) copyFile(from, path.join(out, 'docs', d), report);
  }

  // 5. the version stamp and the manifest of what is in here
  const version = opts.version || stamp();
  const files = walk(out, out).sort();
  const manifest = {
    name: 'kit',
    version,
    packedAt: new Date().toISOString(),
    packedFrom: path.basename(ROOT),
    layout: { engine: 'js/kit', art: 'js/art', styles: 'css', entry: 'js/main.js', modules: 'modules', templates: 'templates', tools: 'tools', docs: 'docs' },
    moduleDir: 'modules',
    modules,
    templates: templates.list().map(t => ({ id: t.id, label: t.label, modules: t.modules })),
    load: { core: KIT_FILES.CORE, art: KIT_FILES.ART, editor: KIT_FILES.EDITOR, main: KIT_FILES.MAIN, css: KIT_FILES.CSS },
    counts: {
      files: files.length,
      engine: files.filter(f => f.startsWith('js/kit/')).length,
      art: files.filter(f => f.startsWith('js/art/')).length,
      templates: files.filter(f => f.startsWith('templates/')).length,
      modules: files.filter(f => f.startsWith('modules/')).length,
      docs: files.filter(f => f.startsWith('docs/')).length,
    },
    contains: files,
  };
  fs.writeFileSync(path.join(out, 'KIT-VERSION.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'README.md'), readme(version, manifest));

  // 6. the promise: no game in here
  const bad = check(out);
  if (bad.length) {
    console.error(`\nThis kit still reaches into a game's own folders, in ${bad.length} place(s):`);
    for (const b of bad.slice(0, 12)) console.error(`  ${b.file}:${b.line}  ${b.text}`);
    console.error('\nNothing was removed — the folder is there to look at — but this is not a library yet.');
    return 1;
  }

  say(`Packed kit ${version} -> ${show(out)}`);
  say(`  ${manifest.counts.engine} engine files, ${manifest.counts.art} art files, ` +
    `${manifest.counts.templates} template files, ${manifest.counts.modules} module files, ${manifest.counts.docs} docs`);
  if (report.rewritten.length) {
    say(`  ${report.rewritten.length} file(s) had js/content or js/modules paths rewritten for the packed layout:`);
    for (const r of report.rewritten.slice(0, 8)) say(`    ${path.relative(out, r.file)} (${r.count})`);
  }
  say(`  no reference to ${GAME_CONTENT} or ${GAME_MODULES} anywhere in it`);
  say('');
  say('Use it:');
  say(`  node ${show(path.join(out, 'tools/new-game.js'))} "My Game" --kit ${show(out)} --into ./games`);
  return 0;
}

function readme(version, manifest) {
  return `# Kit ${version}

The engine, on its own. No game in here — that is the point.

\`\`\`
js/kit/       the engine
js/art/       the tiles and people it ships with
js/main.js    the entry point (module loading and boot)
css/          the runtime and editor stylesheets
templates/    the shapes a new game can start from
modules/      the systems a game can switch on
tools/        new-game, new-module, pack-kit, the importer, the art tools
docs/         how all of it works
KIT-VERSION.json   what is in here, file by file
\`\`\`

## Start a game with it

\`\`\`
node tools/new-game.js "My Game" --kit . --into ../games
cd ../games/my-game
npm start
\`\`\`

The game keeps its own \`content/\`, \`art/\` and \`modules/\` and loads the engine
from wherever this folder is. \`--copy-kit\` puts a copy of this folder inside the
game instead, so the game folder needs nothing else at all.

## What is different from the repo it came out of

One thing: a module folder lives under \`modules/\` here, because a packed kit has
no game code to nest it inside. Everything else is in the same place, so the load
order in \`docs/KIT-API.md\` still reads true.

## Templates in this kit

${manifest.templates.map(t => `- **${t.id}** — ${t.label}${t.modules.length ? ` (uses: ${t.modules.join(', ')})` : ''}`).join('\n')}

## Modules in this kit

Switch one on with \`--modules <id>\` when you make a game, or add its id to
\`project.modules\` later. \`tools/new-module.js\` writes a new one.

${manifest.modules.map(id => `- **${id}**`).join('\n') || '- (none)'}

Start with \`docs/STARTING-A-GAME.md\`.
`;
}

module.exports = { main, check, walk, TOOLS, DOCS, TREES, KIT_MODULES, REWRITES };
if (require.main === module) process.exit(main(process.argv.slice(2)));
