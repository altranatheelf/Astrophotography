#!/usr/bin/env node
// tools/new-game.js — start a new game.
//
//   node tools/new-game.js "Mill Lane"
//   node tools/new-game.js "The Deep" --modules dungeon --into ~/games
//   node tools/new-game.js "My Game" --kit ../kit-1.0.0        (a packed kit)
//
// It writes a whole game folder: its own index.html, its content files, its art
// folder, the modules it uses, a README and three little scripts. Open the
// index.html and it plays — no server, no build step, no dependencies.
//
// It will not write over a game that is already there. That is on purpose.
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const DEFAULT_KIT = path.resolve(HERE, '..');

// ---- arguments ---------------------------------------------------------------
function parseArgs(argv) {
  const o = { name: null, template: 'empty', into: null, modules: null, kit: null, copyKit: false, quiet: false, help: false };
  const takes = { '--template': 'template', '-t': 'template', '--into': 'into', '--modules': 'modules', '--kit': 'kit' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a === '--quiet' || a === '-q') { o.quiet = true; continue; }
    if (a === '--copy-kit') { o.copyKit = true; continue; }
    if (takes[a]) { o[takes[a]] = argv[++i]; continue; }
    if (a.startsWith('--')) { o.unknown = a; continue; }
    if (o.name == null) o.name = a;
  }
  return o;
}

function usage(templates) {
  const rows = templates.list().map(t => `    ${t.id.padEnd(9)} ${t.describe}`).join('\n');
  return [
    'Start a new game: one room, one person to be, and the engine.',
    '',
    '  node tools/new-game.js <name> [options]',
    '',
    '    --template <id>   which shape to start from (default: empty)',
    '    --into <dir>      where to put it            (default: ./games)',
    '    --modules a,b     extra modules to switch on',
    '    --kit <dir>       use a packed kit instead of this repo',
    '    --copy-kit        copy the kit into the game, so the folder is self-contained',
    '',
    '  Start from:',
    rows,
    '',
    '  node tools/new-game.js "Mill Lane"',
    '  node tools/new-game.js "The Deep" --modules dungeon --into ~/games',
  ].join('\n');
}

// ---- small helpers ------------------------------------------------------------
const read = (p) => fs.readFileSync(p, 'utf8');
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}
function fill(text, vars) {
  return String(text).replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  let n = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name), b = path.join(to, entry.name);
    if (entry.isDirectory()) n += copyDir(a, b);
    else { fs.copyFileSync(a, b); n++; }
  }
  return n;
}
/** A relative path that always uses forward slashes, for html and require(). */
const rel = (from, to) => (path.relative(from, to) || '.').split(path.sep).join('/');
/** The shortest way to say where something is: relative when that is shorter, else absolute. */
const show = (p2) => { const r = rel(process.cwd(), p2); return r.startsWith('..') ? p2 : r; };

/** titleCase-ish id from a name: "Mill Lane" -> "mill-lane". */
function slugOf(name) {
  return String(name).trim().toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'new-game';
}

// ---- the kit ------------------------------------------------------------------
/** Where the kit is, and how it is laid out (a repo and a packed kit differ in one folder). */
function findKit(dir) {
  const root = path.resolve(dir);
  if (!fs.existsSync(path.join(root, 'js/kit/core/util.js'))) return null;
  const repoModules = path.join('js', 'modules');           // spelt in pieces: a packed kit rewrites that path
  const moduleDir = fs.existsSync(path.join(root, repoModules)) ? repoModules
    : fs.existsSync(path.join(root, 'modules')) ? 'modules' : null;
  let version = null;
  try { version = JSON.parse(read(path.join(root, 'KIT-VERSION.json'))); } catch (e) { version = null; }
  return { root, moduleDir, version, packed: !!version };
}

/**
 * Data a module needs from outside its own folder, so `--modules <id>` gives a
 * game everything that module reads. Copied into `modules/<id>/data/` and put on
 * the page just before the module's own files.
 */
const MODULE_DATA = { mons: ['js/data', 'js/sprites'] };
/** Within that data, types and moves come before the roster that references them. */
function dataOrder(a, b) {
  const rank = (f) => (f === 'types.js' ? 0 : f === 'moves.js' ? 1 : f === 'pokemon.js' ? 2 : 3);
  return rank(a) - rank(b) || a.localeCompare(b);
}

/** Load the engine into this process, plus a game's own art and modules. */
function loadKit(kit, opts) {
  const { NODE } = require(path.join(kit.root, 'templates/_shared/kit-files.js'));
  for (const f of NODE) require(path.join(kit.root, f));
  require(path.join(kit.root, 'js/main.js'));            // KIT.module / KIT.modules; boots nothing headless
  const KIT = globalThis.KIT;
  // Some art files assign to `window` directly rather than using the
  // window/globalThis shim (docs/ENGINE-HOOKS.md, "two smaller ones"), so Node
  // needs one for the length of the requires.
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  if (!hadWindow) globalThis.window = globalThis;
  try { for (const f of opts.extraFiles || []) require(f); }
  finally { if (!hadWindow) delete globalThis.window; }
  if ((opts.modules || []).length) KIT.modules.activate({ modules: opts.modules });
  return KIT;
}

// ---- the page ------------------------------------------------------------------
function buildIndexHtml(sharedDir, o) {
  const script = (src) => `<script src="${src}"></script>`;
  const lines = [];
  const push = (comment, srcs) => {
    if (!srcs.length) return;
    lines.push('', `<!-- ${comment} -->`, ...srcs.map(script));
  };
  push('The engine. Load order: docs/KIT-API.md.', o.core);
  push('The art the Kit ships: tiles, people, the placeholder silhouette.', o.art);
  push('Your own art (art/README.md says how to add to it).', o.gameArt);
  push('Your world. `npm run build` writes these from story.js.', o.content);
  push('Creator Mode: the editor that lives inside the game.', o.editor);
  push('Modules — extra systems this game uses (docs/MODULES.md). They load\n     BEFORE main.js so the whole page is captured for `npm run share`.', o.modules);
  push('The entry point. Always last.', o.main);
  const styles = o.css.map(h => `<link rel="stylesheet" href="${h}">`).join('\n');
  return fill(read(path.join(sharedDir, 'index.html')), {
    TITLE: o.title, STYLES: styles, SCRIPTS: lines.join('\n').trim(),
  });
}

// ---- the run -------------------------------------------------------------------
function main(argv) {
  const opts = parseArgs(argv);
  const kit = findKit(opts.kit || DEFAULT_KIT);
  if (!kit) {
    console.error(`No Kit at ${path.resolve(opts.kit || DEFAULT_KIT)} — there is no js/kit/core/util.js in it.`);
    return 2;
  }
  const templates = require(path.join(kit.root, 'templates'));
  const say = (...a) => { if (!opts.quiet) console.log(...a); };

  if (opts.help || !opts.name) {
    console.log(usage(templates));
    return opts.name ? 0 : (opts.help ? 0 : 2);
  }
  if (opts.unknown) { console.error(`I do not know the option ${opts.unknown}.\n`); console.log(usage(templates)); return 2; }

  const template = templates.get(opts.template);
  if (!template) {
    console.error(`There is no template called “${opts.template}”. There is: ${templates.ids().join(', ')}.`);
    return 2;
  }

  const title = String(opts.name).trim();
  const id = slugOf(title);
  const intoDir = path.resolve(process.cwd(), opts.into || 'games');
  const gameDir = path.join(intoDir, id);

  // --- refuse, politely ---------------------------------------------------------
  if (fs.existsSync(gameDir)) {
    const what = fs.existsSync(path.join(gameDir, 'index.html')) ? 'a game' : 'something';
    console.error([
      `There is already ${what} at ${show(gameDir)}, so I have not touched it.`,
      '',
      'If you want a second one, give it another name:',
      `  node tools/new-game.js "${title} 2" --template ${template.id}`,
      'If you want to start that one again, move it out of the way first:',
      `  mv ${show(gameDir)} ${show(gameDir)}.old`,
    ].join('\n'));
    return 1;
  }

  const modules = Array.from(new Set(
    (template.modules || []).concat(String(opts.modules || '').split(',').map(s => s.trim()).filter(Boolean)),
  ));
  if (modules.length && !kit.moduleDir) {
    console.error(`This game wants the modules ${modules.join(', ')}, but ${kit.root} has no modules folder.`);
    return 2;
  }

  say(`Kit:      ${kit.root}${kit.version ? ` (packed ${kit.version.version})` : ''}`);
  say(`Template: ${template.id} — ${template.label}`);
  say(`Game:     ${show(gameDir)}`);

  // --- the files -----------------------------------------------------------------
  const shared = templates.shared;
  const vars = {
    TITLE: title, ID: id, NAME: title,
    RUN: 'npm start', BUILD: 'npm run build', SHARE: 'npm run share',
  };

  fs.mkdirSync(gameDir, { recursive: true });
  write(path.join(gameDir, 'story.js'), fill(read(template.files.story), vars));
  write(path.join(gameDir, 'look.css'), read(template.files.look));
  write(path.join(gameDir, 'art', template.art), read(template.files.art));
  write(path.join(gameDir, 'art', 'README.md'), read(path.join(shared, 'art-README.md')));
  write(path.join(gameDir, 'tools', 'build-content.js'), read(path.join(shared, 'build-content.js')));
  write(path.join(gameDir, 'tools', 'share.js'), read(path.join(shared, 'share.js')));
  write(path.join(gameDir, 'tools', 'open.js'), read(path.join(shared, 'open.js')));

  // The modules this game uses become the game's own copy: it is your module now.
  const moduleFiles = [];
  for (const m of modules) {
    const from = path.join(kit.root, kit.moduleDir, m);
    if (!fs.existsSync(from)) {
      console.error(`The module “${m}” is not in ${path.join(kit.root, kit.moduleDir)}.`);
      return 2;
    }
    copyDir(from, path.join(gameDir, 'modules', m));

    // Data a module needs that does not live in its own folder (mons ships the
    // Pokémon pack and the portraits) travels with it, so the game is whole.
    for (const dir of MODULE_DATA[m] || []) {
      const src = path.join(kit.root, dir);
      if (!fs.existsSync(src)) continue;
      const into = path.join(gameDir, 'modules', m, 'data');
      copyDir(src, into);
      for (const f of fs.readdirSync(src).filter(x => x.endsWith('.js')).sort(dataOrder)) {
        moduleFiles.push(`modules/${m}/data/${f}`);
      }
    }

    const order = ['rules.js', 'art.js', 'register.js', 'strings.js', 'actions.js', 'script.js', 'systems.js', 'scenes.js', 'panel.js', 'manifest.js'];
    // `*.node.js` is a Node script that travels with the module (its own
    // play-through, say). It is not part of the page and must not be required
    // here: it may want Playwright, or a path that only makes sense in the repo.
    const have = fs.readdirSync(from).filter(f => f.endsWith('.js') && !f.endsWith('.node.js'));
    const sorted = order.filter(f => have.includes(f)).concat(have.filter(f => !order.includes(f)).sort());
    for (const f of sorted) moduleFiles.push(`modules/${m}/${f}`);
  }

  // The kit, if it is to travel with the game. A repo is PACKED into the game
  // (the engine and nothing else); a kit that is already packed is copied.
  let kitRoot = kit.root;
  if (opts.copyKit) {
    kitRoot = path.join(gameDir, 'kit');
    if (kit.packed) copyDir(kit.root, kitRoot);
    else {
      const packKit = require(path.join(kit.root, 'tools', 'pack-kit.js'));
      const code = packKit.main(['--out', kitRoot, '--quiet']);
      if (code !== 0) { console.error('Could not pack the kit into the game.'); return code; }
    }
    say(`Packed the kit into ${show(kitRoot)} — this folder needs nothing else.`);
  }
  const kitRel = rel(gameDir, kitRoot);

  // tools/kit-node.js: the Node half, pointed at wherever the kit ended up.
  const artFiles = [`art/${template.art}`];
  write(path.join(gameDir, 'tools', 'kit-node.js'), fill(read(path.join(shared, 'kit-node.js.tmpl')), {
    KIT_REL: rel(path.join(gameDir, 'tools'), kitRoot),
    ART_FILES: JSON.stringify(artFiles),
    MODULE_FILES: JSON.stringify(moduleFiles),
    MODULE_IDS: JSON.stringify(modules),
  }));

  write(path.join(gameDir, 'package.json'), JSON.stringify({
    name: id, private: true, version: '0.1.0',
    description: `${title} — a game made with Kit (template: ${template.id}).`,
    scripts: {
      build: 'node tools/build-content.js',
      start: 'node tools/open.js',
      edit: 'node tools/open.js --edit',
      share: 'node tools/share.js',
    },
    kit: { template: template.id, kitRel, modules },
  }, null, 2) + '\n');

  // --- build the world -------------------------------------------------------------
  const KIT = loadKit({ root: kitRoot }, {
    modules,
    extraFiles: artFiles.map(f => path.join(gameDir, f)).concat(moduleFiles.map(f => path.join(gameDir, f))),
  });
  const story = require(path.join(gameDir, 'story.js'));
  let raw;
  try { raw = story.build({ KIT, id, name: title }); }
  catch (e) {
    console.error(`\nstory.js could not build the world: ${e.message}`);
    console.error(`The folder is at ${show(gameDir)} if you want to look.`);
    return 1;
  }
  // `--modules a,b` copies the folders and loads them; this is what actually
  // switches them on for the game. `project.modules` is the list boot reads, and
  // the Project panel in Creator Mode edits the same line.
  raw.modules = Array.from(new Set((raw.modules || []).concat(modules)));

  const { project, problems } = KIT.project.normalize(raw);
  const errors = problems.filter(p => p.severity === 'error');
  for (const p of problems) say(`  ${p.severity === 'error' ? 'ERROR' : 'warn '} [${p.code}] ${p.message}`);
  if (errors.length) {
    console.error(`\n${errors.length} error(s) in the template — the folder is at ${show(gameDir)}, but it will not play yet.`);
    return 1;
  }

  const contentFiles = KIT.project.exportFiles(project);
  // A game always has an assets.js, even when it is empty: the page lists it,
  // and the importer fills it in the first time a picture is brought in. Without
  // it the page would have to grow a new <script> line after every import.
  if (!contentFiles['assets.js']) contentFiles['assets.js'] = emptyAssetsFile(id, title);
  for (const [name, text] of Object.entries(contentFiles)) write(path.join(gameDir, 'content', name), text);

  // --- the page ---------------------------------------------------------------------
  const { CORE, ART, EDITOR, MAIN, CSS } = require(path.join(kitRoot, 'templates/_shared/kit-files.js'));
  const k = (f) => (kitRel === '.' ? f : `${kitRel}/${f}`);
  write(path.join(gameDir, 'index.html'), buildIndexHtml(shared, {
    title,
    css: CSS.map(k),
    core: CORE.map(k),
    art: ART.map(k),
    gameArt: artFiles,
    content: Object.keys(contentFiles).map(f => `content/${f}`),
    editor: EDITOR.map(k),
    modules: moduleFiles,
    main: MAIN.map(k),
  }));

  // --- the README ---------------------------------------------------------------------
  // In a README, say where the kit is the short way round.
  const kitShown = kitRel.length <= kitRoot.length ? kitRel : kitRoot;
  const docsRel = `${kitShown}/docs`;
  const readme = fill(read(template.files.readme), vars).replace(/\n## The folders\n\nSee the bottom of this file\.\n?/, '\n')
    + fill(read(path.join(shared, 'README-folders.md')), Object.assign({}, vars, {
      KIT_REL: kitRel,
      KIT_SHOWN: kitShown,
      KIT_WHERE: kitShown === kitRel
        ? `The \`<script src>\` lines in \`index.html\` load the Kit from \`${kitRel}\`, beside this folder.`
        : `The Kit lives at **${kitShown}**; \`index.html\` spells that as \`${kitRel}\`, relative to the page.`,
      KIT_DOCS: `The Kit's own guide is **${docsRel}/STARTING-A-GAME.md**, and everything it can do is in **${docsRel}/KIT-API.md**.`,
    }));
  write(path.join(gameDir, 'README.md'), readme);

  // --- the smoke test --------------------------------------------------------------------
  const check = smokeTest(KIT, gameDir, contentFiles);
  if (!check.ok) {
    console.error(`\nThe game was written but did not pass its own check: ${check.why}`);
    return 1;
  }

  say('');
  say(`Wrote ${countFiles(gameDir)} files. ${Object.keys(project.maps).length} maps, ` +
    `${Object.values(project.maps).reduce((n, m) => n + m.objects.length, 0)} events, ` +
    `${Object.keys(project.scripts).length} common events.`);
  say('');
  say('Next:');
  say(`  cd ${show(gameDir)}`);
  say('  npm start              open it and play');
  say('  npm run edit           open it in Creator Mode');
  say('  (then read README.md — it says what to change first)');
  return 0;
}

/**
 * An assets.js with nothing in it yet, in exactly the shape
 * KIT.project.exportFiles writes and KIT.project.parseFile reads back.
 */
function emptyAssetsFile(projectId, title) {
  const q = (v) => JSON.stringify(String(v));
  return [
    `// ${title} — Kit content file, generated by node tools/new-game.js (the importer rewrites it).`,
    `// kind: assets  id: ${projectId}`,
    '// Imported images live here, as data: URIs or as paths into content/assets/.',
    '// Empty is fine: the page loads it either way.',
    '(function (root, data) {',
    '  var KIT = root.KIT = root.KIT || {};',
    '  var content = KIT.content = KIT.content || {};',
    `  (content.assets = content.assets || {})[${q(projectId)}] = data;`,
    "})(typeof window !== 'undefined' ? window : globalThis,",
    '{',
    '}',
    ');',
    '',
  ].join('\n');
}

/** The game has to be readable back the way the page will read it, with nothing broken. */
function smokeTest(KIT, gameDir, contentFiles) {
  try {
    const texts = {};
    for (const name of Object.keys(contentFiles)) texts[name] = fs.readFileSync(path.join(gameDir, 'content', name), 'utf8');
    const back = KIT.project.importFiles(texts);
    const { project, problems } = KIT.project.normalize(back);
    const errors = problems.filter(p => p.severity === 'error');
    if (errors.length) return { ok: false, why: `${errors.length} error(s): ${errors[0].code} ${errors[0].message}` };
    if (!project.maps[project.start.map]) return { ok: false, why: 'the start map is not there' };
    const html = fs.readFileSync(path.join(gameDir, 'index.html'), 'utf8');
    const srcs = Array.from(html.matchAll(/<script src="([^"]+)"/g)).map(m => m[1]);
    const missing = srcs.filter(s => !fs.existsSync(path.join(gameDir, s)));
    if (missing.length) return { ok: false, why: `index.html asks for files that are not there: ${missing.join(', ')}` };
    if (!srcs.length) return { ok: false, why: 'index.html loads nothing' };
    return { ok: true, scripts: srcs.length };
  } catch (e) {
    return { ok: false, why: e.message };
  }
}

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else n++;
  }
  return n;
}

module.exports = { main, parseArgs, slugOf, findKit, smokeTest };
if (require.main === module) process.exit(main(process.argv.slice(2)));
