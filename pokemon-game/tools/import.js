#!/usr/bin/env node
// tools/import.js — bring a map, a project or a sheet of art into the game.
//
//   node tools/import.js <file|folder> [options]
//
//     --into <dir>     the content folder to merge into   (default js/content/demo)
//     --prefix <name>  namespace every id it makes        (outside -> outside:grass)
//     --overwrite      let the import replace ids that are already there
//     --dry-run        say what would happen; write nothing
//     --inline         embed images as data: URIs instead of copying files
//     --tile-size <n>  force the tile size (RPG Maker sheets are 48px by default; a PNG on its own is guessed from its size)
//     --kind <k>       what an Aseprite sheet is: sprite (default) | tiles | faces | icons — for a PNG on its own: tiles (default) | sprite
//     --margin <n> --spacing <n>        a PNG tileset's border and gaps
//     --columns <n> --rows <n> --order <dlru>   a PNG character sheet's grid and which row faces where
//     --quiet          only the summary and the problems that matter
//
//   node tools/import.js town.tmj                        a Tiled map
//   node tools/import.js outside.tsj --prefix outside    a Tiled tileset on its own
//   node tools/import.js ~/MyGame                        an RPG Maker MV/MZ project folder
//   node tools/import.js hero.json --kind sprite         an Aseprite --sheet export
//   node tools/import.js hero.aseprite                   the Aseprite document itself
//
// It is safe to run twice: ids are derived from the file, so a second run
// updates instead of duplicating, and an unchanged import writes nothing new.
//
// What this file does that the importers may not: it reads files, copies the
// images next to the content as assets/<id>.png, loads the project being merged
// into, and prints the report. The importers stay pure (docs/IMPORT-CONTRACT.md).
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');

// ---- load the kit (the same order as index.html / test/kit/_load.js) ----------
function loadKit() {
  const files = [
    'js/kit/core/util.js', 'js/kit/core/events.js', 'js/kit/core/rng.js', 'js/kit/core/registry.js',
    'js/kit/core/schema.js', 'js/kit/core/registries.js', 'js/kit/core/modules.js', 'js/kit/core/pixels.js', 'js/kit/core/assets.js',
    'js/kit/world/document.js', 'js/kit/world/project.js', 'js/kit/world/tiles.js',
    'js/kit/script/text.js', 'js/kit/script/conditions.js', 'js/kit/script/commands.js',
    'js/kit/script/screenplay.js', 'js/kit/script/interpreter.js',
    'js/kit/import/tiled.js', 'js/kit/import/rpgmaker.js', 'js/kit/import/aseprite.js', 'js/kit/import/image.js', 'js/kit/import/merge.js',
  ];
  for (const f of files) require(path.join(ROOT, f));
  // The art files register the tiles and sprites the existing content uses, so
  // the validator can tell a missing tile from one the game has always had.
  // tiles.js and chars.js define the register() aliases the others call, so they
  // go first; the rest are loaded in name order.
  global.PKMN = global.PKMN || {};
  const artDir = path.join(ROOT, 'js', 'art');
  const art = fs.existsSync(artDir) ? fs.readdirSync(artDir).filter(f => f.endsWith('.js')).sort() : [];
  const first = art.filter(f => f === 'tiles.js' || f === 'chars.js');
  for (const f of first.concat(art.filter(f => !first.includes(f)))) {
    try { require(path.join(artDir, f)); } catch (e) { console.warn(`[import] js/art/${f} did not load: ${e.message}`); }
  }
  // The modules, in the order the page loads them, so a format one of them knows
  // (Pokémon Essentials PBS) can be imported from the terminal too. index.html is
  // the one source of load order; a file that needs a browser no-ops here.
  try {
    const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const srcs = (page.match(/<script src="(js\/(?:modules|data)\/[^"]+)"/g) || []).map(m => /"([^"]+)"/.exec(m)[1]);
    for (const f of srcs) {
      try { require(path.join(ROOT, f)); } catch (e) { /* a module file that needs a browser is not needed here */ }
    }
    for (const def of (globalThis.KIT.modules && globalThis.KIT.modules.all ? globalThis.KIT.modules.all() : [])) {
      try { if (def && typeof def.register === 'function') def.register(globalThis.KIT); } catch (e) { /* the parts that need a browser are skipped */ }
    }
  } catch (e) { /* no page, no modules: the engine's own importers still work */ }
  return globalThis.KIT;
}
const KIT = loadKit();

// ---- little helpers ----------------------------------------------------------
const stem = (p) => path.basename(p).replace(/\.[A-Za-z0-9]+$/, '');
const exists = (p) => { try { return fs.existsSync(p); } catch (e) { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const readText = (p) => fs.readFileSync(p, 'utf8');
const readJson = (p) => JSON.parse(readText(p));
/** A path as short as it can be said: relative when that is shorter, else absolute. */
const rel = (p) => { const r = path.relative(process.cwd(), p); return (!r || r.startsWith('..')) ? p : r; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

/** The pixel size of a PNG/GIF, straight out of the header (no decoding). */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('latin1', 12, 16) === 'IHDR') {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'GIF') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {          // JPEG: walk the segments to SOFn
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}
const MIME = { '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bmp': 'image/bmp' };

// ---- arguments ---------------------------------------------------------------
function parseArgs(argv) {
  const o = { input: null, into: null, prefix: null, overwrite: false, dryRun: false, inline: false, tileSize: null, kind: null, quiet: false, srcBase: null };
  const flags = { '--overwrite': 'overwrite', '--dry-run': 'dryRun', '--dryrun': 'dryRun', '--inline': 'inline', '--quiet': 'quiet' };
  const values = { '--into': 'into', '--prefix': 'prefix', '--tile-size': 'tileSize', '--kind': 'kind', '--src-base': 'srcBase',
    '--margin': 'margin', '--spacing': 'spacing', '--columns': 'columns', '--rows': 'rows', '--order': 'order' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flags[a]) { o[flags[a]] = true; continue; }
    if (values[a]) { o[values[a]] = argv[++i]; continue; }
    const eq = /^(--[a-z-]+)=(.*)$/.exec(a);
    if (eq && values[eq[1]]) { o[values[eq[1]]] = eq[2]; continue; }
    if (a === '-h' || a === '--help') { o.help = true; continue; }
    if (a.startsWith('-')) throw new Error(`unknown option '${a}' (try --help)`);
    if (!o.input) o.input = a; else throw new Error(`only one file or folder at a time (got '${o.input}' and '${a}')`);
  }
  if (o.tileSize) o.tileSize = Number(o.tileSize);
  return o;
}
function usage() {
  const text = readText(__filename).split('\n');
  const lines = [];
  for (const line of text.slice(1)) { if (!line.startsWith('//')) break; lines.push(line.replace(/^\/\/ ?/, '')); }
  return lines.join('\n').trim();
}

// ---- what is this file? -------------------------------------------------------
/** detect(input) -> { tool, kind, mapsDir, label } — or throws with a readable reason. */
function detect(input) {
  if (isDir(input)) {
    for (const dir of [path.join(input, 'data'), path.join(input, 'www', 'data'), input]) {
      if (exists(path.join(dir, 'MapInfos.json'))) return { tool: 'rpgmaker', kind: 'project', dataDir: dir, root: path.dirname(dir) === input ? input : path.dirname(dir), label: 'RPG Maker project' };
    }
    throw new Error(`'${rel(input)}' is a folder with no data/MapInfos.json in it — that is what an RPG Maker MV/MZ project looks like`);
  }
  if (!exists(input)) throw new Error(`there is no file called '${rel(input)}'`);
  const ext = path.extname(input).toLowerCase();
  if (ext === '.aseprite' || ext === '.ase') return { tool: 'aseprite', kind: 'file', label: 'Aseprite document' };
  const raw = MIME[ext] ? null : readText(input);
  if (raw != null) {
    // A module's own format first (KIT.registry('importers')), then the engine's.
    if (KIT.registry && KIT.registry.exists && KIT.registry.exists('importers')) {
      const files = [{ name: path.basename(input), text: raw }];
      for (const imp of KIT.registry('importers').list().slice().sort((a, b) => (a.order || 50) - (b.order || 50))) {
        if (typeof imp.detect !== 'function') continue;
        let hit = null;
        try { hit = imp.detect(files); } catch (e) { hit = null; }
        if (hit) return Object.assign({ tool: 'registry', importer: imp.id, label: imp.label || imp.id }, hit);
      }
    }
    const tiled = KIT.import.tiled.detect(raw);
    if (tiled) return { tool: 'tiled', kind: tiled, label: `Tiled ${tiled}` };
    if (KIT.import.aseprite.detect(raw) === 'sheet') return { tool: 'aseprite', kind: 'sheet', label: 'Aseprite sheet' };
  }
  if (MIME[ext]) return { tool: 'image', kind: 'sheet', label: `image ${path.basename(input)}` };
  if (KIT.import.image && KIT.import.image.AUDIO_EXT.test(input)) return { tool: 'audio', kind: 'audio', label: `sound ${path.basename(input)}` };
  throw new Error(`'${rel(input)}' is not a Tiled map or tileset, an Aseprite sheet, or an RPG Maker folder`);
}

// ---- the asset resolver --------------------------------------------------------
/**
 * makeAssets({ bases, outDir, srcBase, prefix, inline }) -> { asset(src), copied, missing }
 * The importers hand us the path an image was named by; we find it, give it an
 * id, copy it next to the content (or inline it), and tell them where it went.
 */
function makeAssets(o) {
  const seen = new Map();          // absolute source path -> { id, src, w, h }
  const byId = new Map();          // id -> absolute source path
  const copied = [], missing = [];
  return {
    copied, missing,
    asset(src) {
      const raw = String(src == null ? '' : src);
      if (!raw) return null;
      if (/^data:/i.test(raw)) return { id: KIT.slug(o.prefix ? o.prefix + '-inline' : 'inline'), src: raw, w: 0, h: 0 };
      let file = null;
      for (const base of o.bases) {
        const p = path.resolve(base, raw);
        if (exists(p) && !isDir(p)) { file = p; break; }
      }
      if (!file) { missing.push(raw); return null; }
      if (seen.has(file)) return seen.get(file);

      let id = KIT.slug(stem(file));
      if (o.prefix) id = KIT.slug(o.prefix) + ':' + id;
      while (byId.has(id) && byId.get(id) !== file) id = id.replace(/(-(\d+))?$/, (m, g, n) => '-' + ((Number(n) || 1) + 1));
      byId.set(id, file);

      const buf = fs.readFileSync(file);
      const size = imageSize(buf) || { w: 0, h: 0 };
      const ext = path.extname(file).toLowerCase();
      let srcPath;
      if (o.inline) {
        srcPath = `data:${MIME[ext] || 'image/png'};base64,${buf.toString('base64')}`;
      } else {
        const name = id.replace(/[:/\\]/g, '-') + ext;
        const dest = path.join(o.outDir, 'assets', name);
        if (!o.dryRun) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          if (!exists(dest) || !fs.readFileSync(dest).equals(buf)) fs.writeFileSync(dest, buf);
        }
        copied.push({ from: file, to: dest });
        srcPath = path.relative(o.srcBase, dest).split(path.sep).join('/');
      }
      const out = { id, src: srcPath, w: size.w, h: size.h };
      seen.set(file, out);
      return out;
    },
  };
}

// ---- the target project --------------------------------------------------------
function loadTarget(intoDir) {
  const files = {};
  const projectFile = path.join(intoDir, 'project.js');
  if (!exists(projectFile)) {
    const id = KIT.slug(path.basename(intoDir) || 'new-adventure');
    const project = KIT.project.blank({ id, title: '', map: 'start' });
    project.meta.title = '';                    // so the import may name the game
    return { project, fresh: true, id };
  }
  files['project.js'] = readText(projectFile);
  const assetsFile = path.join(intoDir, 'assets.js');
  if (exists(assetsFile)) files['assets.js'] = readText(assetsFile);
  const mapsDir = path.join(intoDir, 'maps');
  if (isDir(mapsDir)) for (const f of fs.readdirSync(mapsDir).sort()) if (f.endsWith('.js')) files['maps/' + f] = readText(path.join(mapsDir, f));
  const project = KIT.project.importFiles(files);
  return { project, fresh: false, id: (project.meta && project.meta.id) || KIT.slug(path.basename(intoDir)) };
}

// ---- running one importer --------------------------------------------------------
function runImport(found, input, target, opts) {
  const prefix = opts.prefix || null;
  const project = target.project;
  const mapId = (name) => {
    const want = KIT.slug(stem(String(name)));
    if (project.maps && project.maps[want]) return want;                       // a map this project already has
    const namespaced = prefix ? KIT.slug(prefix) + ':' + want : want;
    if (project.maps && project.maps[namespaced]) return namespaced;
    return null;                                                               // let the importer name it
  };
  const inflate = (bytes, method) => {
    const buf = Buffer.from(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength || bytes.length);
    if (method === 'gzip') return new Uint8Array(zlib.gunzipSync(buf));
    if (method === 'zstd' && zlib.zstdDecompressSync) return new Uint8Array(zlib.zstdDecompressSync(buf));
    return new Uint8Array(zlib.inflateSync(buf));
  };

  if (found.tool === 'tiled') {
    const dir = path.dirname(input);
    const bases = [dir];
    const external = (src) => {                        // .tsj/.tsx/.tj/.tx next to the map
      const p = path.resolve(dir, src);
      if (!exists(p)) return undefined;
      if (!bases.includes(path.dirname(p))) bases.push(path.dirname(p));
      return readText(p);
    };
    const assets = makeAssets({ bases, outDir: opts.outDir, srcBase: opts.srcBase, prefix, inline: opts.inline, dryRun: opts.dryRun });
    // The tilesets are read first so their images resolve relative to their own file.
    const text = readText(input);
    const o = { asset: assets.asset, tileset: external, template: external, inflate, mapId, name: path.basename(input), prefix };
    const result = found.kind === 'tileset' ? KIT.import.tiled.tileset(text, o) : KIT.import.tiled.map(text, o);
    return { result, assets, source: `Tiled ${found.kind} ${path.basename(input)}` };
  }

  if (found.tool === 'rpgmaker') {
    const files = {};
    for (const f of fs.readdirSync(found.dataDir).sort()) if (f.endsWith('.json')) files[f] = readJson(path.join(found.dataDir, f));
    const bases = [found.root, path.join(found.root, 'www'), found.dataDir];
    const assets = makeAssets({ bases, outDir: opts.outDir, srcBase: opts.srcBase, prefix, inline: opts.inline, dryRun: opts.dryRun });
    const result = KIT.import.rpgmaker.project(files, { asset: assets.asset, prefix, tileSize: opts.tileSize || undefined });
    return { result, assets, source: `RPG Maker ${path.basename(found.root)}` };
  }

  // Aseprite
  const dir = path.dirname(input);
  const assets = makeAssets({ bases: [dir], outDir: opts.outDir, srcBase: opts.srcBase, prefix, inline: opts.inline, dryRun: opts.dryRun });
  if (found.tool === 'registry') {
    const imp = KIT.registry('importers').get(found.importer);
    const mapId = (name) => { const want = KIT.slug(String(name)); return (target.project.maps && target.project.maps[want]) ? want : null; };
    return { result: imp.run(found, { asset: assets.asset, prefix, mapId, name: path.basename(input) }), assets, source: found.label };
  }
  if (found.tool === 'audio') {
    const buf = fs.readFileSync(input);
    const ext = path.extname(input).toLowerCase().slice(1);
    const AUDIO_MIME = { ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg', webm: 'audio/webm' };
    const name = path.basename(input);
    const kind = opts.kind === 'music' || opts.kind === 'sound' ? opts.kind : KIT.import.image.guessAudio(name, buf);
    const src = `data:${AUDIO_MIME[ext] || 'audio/mpeg'};base64,${buf.toString('base64')}`;
    return { result: KIT.import.image.audio({ name, kind, src, prefix }), assets, source: `sound ${name}` };
  }
  if (found.tool === 'image') {
    // A PNG on its own: tiles unless told it is a character (--kind sprite).
    const size = imageSize(fs.readFileSync(input)) || { w: 0, h: 0 };
    const name = path.basename(input);
    const I = KIT.import.image;
    const result = opts.kind === 'sprite'
      ? I.sprite({ name, w: size.w, h: size.h, columns: opts.columns, rows: opts.rows, order: opts.order, prefix, asset: assets.asset })
      : I.tileset({ name, w: size.w, h: size.h, tile: opts.tileSize, margin: opts.margin, spacing: opts.spacing, prefix, asset: assets.asset });
    return { result, assets, source: `image ${name}` };
  }
  const o = { asset: assets.asset, prefix, name: path.basename(input), id: KIT.slug(stem(input)), kind: opts.kind || 'sprite', inflate: (bytes) => new Uint8Array(zlib.inflateSync(Buffer.from(bytes))) };
  const result = found.kind === 'file'
    ? KIT.import.aseprite.file(fs.readFileSync(input), o)
    : KIT.import.aseprite.sheet(readText(input), o);
  return { result, assets, source: `Aseprite ${path.basename(input)}` };
}

// ---- the report ------------------------------------------------------------------
const COUNT_LABELS = [['maps', 'map'], ['objects', 'object'], ['tiles', 'tile'], ['sprites', 'sprite'], ['faces', 'face'],
  ['icons', 'icon'], ['animations', 'animation'], ['assets', 'image'], ['scripts', 'script'], ['vars', 'variable'], ['items', 'item'],
  ['terrains', 'terrain'], ['autotiles', 'autotile group']];

function countLine(counts) {
  const parts = [];
  for (const [key, label] of COUNT_LABELS) if (counts[key]) parts.push(plural(counts[key], label));
  return parts.length ? parts.join(' · ') : '—';
}
function problemLines(problems, quiet) {
  const out = [];
  for (const severity of ['error', 'warn', 'info']) {
    const list = problems.filter(p => p.severity === severity);
    if (!list.length) continue;
    if (quiet && severity === 'info') { out.push(`  info   ${plural(list.length, 'note')} (run without --quiet to read them)`); continue; }
    const byCode = new Map();
    for (const p of list) { if (!byCode.has(p.code)) byCode.set(p.code, []); byCode.get(p.code).push(p); }
    for (const [code, ps] of byCode) {
      const tag = severity === 'error' ? 'ERROR' : severity === 'warn' ? 'warn ' : 'info ';
      const shown = ps.slice(0, severity === 'info' ? 2 : 4);
      for (const p of shown) out.push(`  ${tag}  ${code}: ${p.message}${where(p.where)}`);
      if (ps.length > shown.length) out.push(`  ${tag}  ${code}: ...and ${ps.length - shown.length} more like that`);
    }
  }
  return out;
}
function where(w) {
  if (!w || typeof w !== 'object') return '';
  const bits = [];
  if (w.map) bits.push('map ' + w.map);
  if (w.object) bits.push('object ' + w.object);
  if (w.script) bits.push('script ' + w.script);
  if (!bits.length && Array.isArray(w.path) && w.path.length) bits.push(w.path.join('.'));
  return bits.length ? `  [${bits.join(', ')}]` : '';
}

// ---- main ---------------------------------------------------------------------
function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) { console.error(e.message); return 2; }
  if (opts.help || !opts.input) { console.log(usage()); return opts.input ? 0 : (opts.help ? 0 : 2); }

  const input = path.resolve(process.cwd(), opts.input);
  let found;
  try { found = detect(input); } catch (e) { console.error('Nothing to import: ' + e.message); return 2; }

  const intoDir = path.resolve(process.cwd(), opts.into || path.join(ROOT, 'js', 'content', 'demo'));
  // Asset paths are written relative to the page that will load them: the game's
  // own folder when the content lives under js/content, else the content folder.
  const insideGame = !path.relative(ROOT, intoDir).startsWith('..');
  const srcBase = path.resolve(opts.srcBase || (insideGame ? ROOT : intoDir));

  let target;
  try { target = loadTarget(intoDir); } catch (e) { console.error(`Could not read the project in ${rel(intoDir)}: ${e.message}`); return 2; }

  console.log(`Kit importer — ${found.label}: ${rel(input)}`);
  console.log(`  into ${rel(intoDir)}${target.fresh ? ' (new project)' : ` (“${(target.project.meta && target.project.meta.title) || target.id}”)`}` +
    (opts.prefix ? `, as ${KIT.slug(opts.prefix)}:*` : '') + (opts.dryRun ? '   [dry run]' : ''));

  let run;
  try {
    run = runImport(found, input, target, { prefix: opts.prefix, outDir: intoDir, srcBase, inline: opts.inline, dryRun: opts.dryRun, tileSize: opts.tileSize, kind: opts.kind, margin: opts.margin, spacing: opts.spacing, columns: opts.columns, rows: opts.rows, order: opts.order });
  } catch (e) {
    console.error('The importer could not read that file: ' + (e && e.message ? e.message : e));
    return 2;
  }

  // A brand new project is a placeholder: one empty map, one terrain, no title.
  // If the import brings maps of its own, the placeholder gets out of the way so
  // the game starts where the import says.
  if (target.fresh) {
    if (Object.keys(run.result.maps || {}).length) {
      delete target.project.maps.start;
      if (target.project.world) delete target.project.world.maps.start;
      target.project.start = { map: '', x: 0, y: 0, dir: 'down' };
    }
    if (run.result.project && (run.result.project.terrains || []).length) target.project.terrains = [];
  }

  // The project's own imported art has to be in the registries before anything
  // is validated, or every tile it already imported reads as missing.
  KIT.project.registerContent(target.project);
  // A dry run merges for real — into a copy, and into this process's registries,
  // which nothing outside it can see — so the report and the validator describe
  // what WOULD happen. Only the writing at the end is skipped.
  const project = opts.dryRun ? KIT.deepClone(target.project) : target.project;
  const report = KIT.import.merge(project, run.result, { overwrite: opts.overwrite, source: run.source });

  const n = KIT.project.normalize(project);
  const problems = report.problems.slice();
  for (const m of run.assets.missing) problems.push({ severity: 'warn', code: 'image-missing', message: `the image '${m}' is not next to the file that names it, so nothing was copied`, where: {} });

  console.log('');
  console.log('  added      ' + countLine(report.added));
  console.log('  replaced   ' + countLine(report.replaced));
  if (report.skipped && countLine(report.skipped) !== '—') console.log('  kept       ' + countLine(report.skipped) + '  (already there; --overwrite replaces)');
  if (countLine(report.unchanged) !== '—') console.log('  unchanged  ' + countLine(report.unchanged));
  if (run.assets.copied.length) console.log('  images     ' + plural(run.assets.copied.length, 'file') + ' -> ' + rel(path.join(intoDir, 'assets')));
  if (opts.inline) console.log('  images     embedded as data: URIs');

  const lines = problemLines(problems, opts.quiet);
  if (lines.length) { console.log(''); console.log(`  ${plural(problems.length, 'note')} about the import:`); for (const l of lines) console.log(l); }

  // What the project's own validator thinks of the result. These never stop the
  // write: importing map 1 of 2 leaves a door pointing at a map that is not
  // there yet, and that is a to-do list, not a reason to refuse.
  const todo = problemLines(n.problems, opts.quiet);
  if (todo.length) {
    console.log('');
    console.log(`  ${plural(n.problems.length, 'thing')} to fix in the project itself:`);
    for (const l of todo) console.log(l);
  }

  const errors = problems.filter(p => p.severity === 'error');
  if (opts.dryRun) {
    console.log('');
    console.log(`  dry run: nothing was written. The project would end up with ${plural(Object.keys(n.project.maps).length, 'map')}.`);
    return errors.length ? 1 : 0;
  }
  if (errors.length) {
    console.log('');
    console.log('  nothing was written: the import itself failed above. Fix that and run it again.');
    return 1;
  }

  const files = KIT.project.exportFiles(n.project);
  let written = 0;
  for (const name of Object.keys(files)) {
    const dest = path.join(intoDir, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (exists(dest) && readText(dest) === files[name]) continue;
    fs.writeFileSync(dest, files[name]);
    written++;
  }
  console.log('');
  console.log(written ? `  wrote ${plural(written, 'file')} into ${rel(intoDir)}` : `  ${rel(intoDir)} was already up to date`);
  if (target.fresh) {
    console.log(insideGame ? '  add these to index.html (after the kit, before js/main.js):' : '  load these files in your page, in this order:');
    const base = insideGame ? path.relative(ROOT, intoDir).split(path.sep).join('/') + '/' : '';
    for (const name of Object.keys(files)) console.log(`    <script src="${base}${name}"></script>`);
  }
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { main, detect, imageSize, parseArgs };
