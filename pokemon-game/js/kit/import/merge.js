// KIT.import.merge — folds an importer Result into a project.
//
// Contract: docs/IMPORT-CONTRACT.md ("Then KIT.import.merge(project, result,
// { prefix, overwrite }) folds a result into a project (document patches when a
// document is given) and returns the problems").
//
//   KIT.import.merge(target, result, opts) -> Report
//
//   target   a plain project object (merged in place, unless dryRun)
//            or a KIT.document (every change lands in ONE undo step labelled
//            "Import <source>")
//   result   what tiled.js / rpgmaker.js / aseprite.js returned
//   opts     { prefix, overwrite, dryRun, source, register, autotileSet }
//
// Pure in the same sense the importers are: no fs, no DOM, no network. The only
// side effects are the project it was handed and — unless `register:false` —
// the tiles/sprites/faces/icons/assets registries, which is what makes an
// import visible to the running game.
//
// WHAT GOES WHERE
//   result.assets      -> project.assets[id]        + KIT.assets.define
//   result.tiles       -> project.tiles[id]         + KIT.registry('tiles')
//   result.sprites     -> project.sprites[id]       + KIT.registry('sprites')
//   result.faces       -> project.faces[id]         + KIT.registry('faces')
//   result.icons       -> project.icons[id]         + KIT.registry('icons')
//   result.animations  -> project.animations[id]    (no registry yet — see 'animations-stored')
//   result.maps        -> project.maps[id]
//   result.packs[key]  -> project.packs[key]  (a module's own content, merged by id)
//   result.scripts     -> project.scripts[id]
//   result.vars        -> project.vars[name]
//   result.items       -> project.items[id]
//   result.fonts       -> project.fonts[id]         (the look's @font-face reads them; no registry)
//   result.project     -> meta.title, start, settings.tileSize, terrains, autotiles
//
// `project.tiles/sprites/faces/icons/animations` are content tables the engine
// reads back with KIT.project.registerContent(project) at load time, so an
// imported tileset survives export -> reload without a hand-written art file.
//
// THE COLLISION RULE (docs/IMPORT-CONTRACT.md "Ids and collisions")
//   the id is free                       -> added
//   the id is taken by the SAME value    -> unchanged, no problem (re-import)
//   the id is taken, opts.overwrite      -> replaced
//   the id is taken, no opts.overwrite   -> `duplicate-id` warn, skipped
// So importing the same file twice leaves the project byte-for-byte identical
// either way, which is what makes `tools/import.js` safe to re-run.
//
// Problem codes produced here (severity in brackets):
//   duplicate-id[warn] animations-stored[info] slices-dropped[info] objects-without-map[warn]
//   tile-size-mismatch[warn] project-field-kept[info] terrain-conflict[warn]
//   start-map-missing[warn] nothing-to-merge[info] registry-rejected[warn]
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const IMP = KIT.import = KIT.import || {};

  const isObj = KIT.isObject;
  const clone = (v) => KIT.deepClone(v);
  const same = (a, b) => KIT.deepEqual(a, b);
  // Keys the importers once wrote into every tile and no longer do, because
  // nothing read them. A project imported before they went still carries them,
  // and that is not a difference worth refusing a re-import over.
  const RETIRED = { tiles: ['probability', 'warpLook'] };
  const withoutRetired = (v, table) => {
    if (!RETIRED[table] || !isObj(v)) return v;
    const out = Object.assign({}, v);
    for (const k of RETIRED[table]) delete out[k];
    return out;
  };
  const sorted = (o) => Object.keys(o || {}).sort();

  // Tables that live directly on the project, in the order they are written.
  // `registry` is the registry an entry is also registered into (null = none).
  const TABLES = [
    { key: 'assets', kind: 'asset', registry: 'assets' },
    { key: 'tiles', kind: 'tile', registry: 'tiles' },
    { key: 'sprites', kind: 'sprite', registry: 'sprites' },
    { key: 'faces', kind: 'face', registry: 'faces' },
    { key: 'icons', kind: 'icon', registry: 'icons' },
    { key: 'animations', kind: 'animation', registry: null },
    // An import cannot bring the .ogg files, but it brings the NAMES, as silent
    // placeholders — so every command that plays one resolves, and the Sounds
    // panel is a to-do list rather than a hundred broken references.
    { key: 'sounds', kind: 'sound', registry: 'sounds' },
    { key: 'music', kind: 'music', registry: 'music' },
    { key: 'items', kind: 'item' },
    // A font is read by the look, which is compiled from the project every
    // time it is put on the page, so there is nothing to register.
    { key: 'fonts', kind: 'font', registry: null },
    { key: 'vars', kind: 'var' },
    { key: 'scripts', kind: 'script' },
    { key: 'maps', kind: 'map' },
  ];
  // A module's content slice. The kit does not know what any of it means — the
  // key names a module's pack and the value is merged into it, so an importer a
  // module brought can fill the module's own content (ADR-0005).
  const PACK_KEY = 'packs';

  // Keys whose string values are prose, never ids: the prefixer leaves them alone.
  const TEXT_KEYS = new Set(['name', 'label', 'title', 'note', 'doc', 'desc', 'text', 'who', 'group',
    'message', 'prompt', 'pitch', 'author', 'subtitle', 'from', 'src', 'tag', 'class']);

  function blankReport(label) {
    // Every table merge writes has a counter: one missing counted up to NaN,
    // and an imported sound was reported as nothing at all.
    const zero = () => ({ assets: 0, tiles: 0, sprites: 0, faces: 0, icons: 0, animations: 0, maps: 0, objects: 0, scripts: 0, vars: 0, items: 0, terrains: 0, autotiles: 0, sounds: 0, music: 0, fonts: 0 });
    return { problems: [], added: zero(), replaced: zero(), unchanged: zero(), skipped: zero(), label, ids: { added: [], replaced: [], skipped: [] }, project: null, registered: 0, dryRun: false };
  }

  /** merge(target, result, opts) -> Report. See the header. */
  IMP.merge = function merge(target, result, opts) { return mergeImpl(target, result, opts); };

  // ---- prefixing -------------------------------------------------------------
  /**
   * merge.prefix(result, name) -> a COPY of the result with every produced id
   * namespaced (`grass` -> `outside:grass`) and every reference to a renamed id
   * rewritten. Ids that already carry the prefix are left alone, so it is
   * idempotent. The importers do this themselves when given `opts.prefix`; this
   * is for callers (the browser panel) that get a result without one.
   */
  function prefixResult(result, name) {
    const p = KIT.slug(name);
    if (!p) return result;
    const out = clone(result);
    const rename = new Map();                          // old id -> new id
    const take = (id) => {
      const s = String(id);
      if (s.startsWith(p + ':')) return s;
      const next = p + ':' + s;
      rename.set(s, next);
      return next;
    };
    for (const t of TABLES) {
      const v = out[t.key];
      if (Array.isArray(v)) for (const def of v) { if (def && def.id != null) def.id = take(def.id); }
      else if (isObj(v)) {
        const next = {};
        for (const id of sorted(v)) {
          const nid = t.key === 'vars' ? String(id) : take(id);   // var names are not namespaced: scripts share them
          const def = v[id];
          if (isObj(def) && def.id != null && t.key === 'maps') def.id = nid;
          next[nid] = def;
        }
        out[t.key] = next;
      }
    }
    if (rename.size) rewrite(out, rename);
    return out;
  }

  /** Replace every id-looking string that was renamed, skipping prose keys. */
  function rewrite(node, rename, key) {
    if (Array.isArray(node)) { for (let i = 0; i < node.length; i++) node[i] = rewriteValue(node[i], rename, key); return node; }
    if (!isObj(node)) return node;
    for (const k of Object.keys(node)) node[k] = rewriteValue(node[k], rename, k);
    return node;
  }
  function rewriteValue(v, rename, key) {
    if (typeof v === 'string') {
      if (key && TEXT_KEYS.has(key)) return v;
      const hit = rename.get(v);
      return hit === undefined ? v : hit;
    }
    if (v && typeof v === 'object') return rewrite(v, rename, key);
    return v;
  }
  IMP.merge.prefix = prefixResult;

  // ---- the writer ------------------------------------------------------------
  // One little object stands in for "a project I am editing", so the plain-object
  // path and the document path share every line of the merge itself.
  function plainWriter(project) {
    return {
      project,
      get(path) { let n = project; for (const k of path) { if (!isObj(n) && !Array.isArray(n)) return undefined; n = n[k]; } return n; },
      set(path, value) {
        let n = project;
        for (let i = 0; i < path.length - 1; i++) { const k = path[i]; if (!isObj(n[k]) && !Array.isArray(n[k])) n[k] = {}; n = n[k]; }
        n[path[path.length - 1]] = value;
      },
    };
  }
  function docWriter(doc) {
    return {
      project: doc.value,
      get(path) { return doc.get(path); },
      set(path, value) { doc.set(path, value); },
    };
  }
  function dryWriter(project) {
    const w = plainWriter(project);
    return { project, get: w.get, set() {} };
  }

  const isDocument = (t) => !!t && typeof t.apply === 'function' && typeof t.transaction === 'function' && isObj(t.value);

  // ---- merge -----------------------------------------------------------------
  function mergeImpl(target, result, options) {
    const o = options || {};
    if (!target) throw new TypeError('merge: no target project (pass a project object or a KIT.document)');
    if (!isObj(result)) throw new TypeError('merge: no import result (pass what an importer returned)');
    const source = o.source || (result.stats && result.stats.tool) || 'import';
    const label = o.label || `Import ${source}`;
    const rep = blankReport(label);
    rep.dryRun = !!o.dryRun;
    const overwrite = !!o.overwrite;
    const res = o.prefix ? prefixResult(result, o.prefix) : result;

    const doc = isDocument(target);
    const project = doc ? target.value : target;
    const w = rep.dryRun ? dryWriter(project) : doc ? docWriter(target) : plainWriter(project);
    rep.project = project;
    const problem = (severity, code, message, where) => rep.problems.push({ severity, code, message, where: where || {} });
    const toRegister = [];
    let touched = 0;
    let sawPacks = false;

    // Everything a document sees lands in ONE undo step called "Import <source>".
    const body = () => {

      // 1. the tables ------------------------------------------------------------
      for (const t of TABLES) {
        const incoming = shapeTable(tableOf(res[t.key], t.key), t.key);
        // Create the table itself first, so undoing the import removes the whole
        // table again instead of leaving an empty one behind.
        if (Object.keys(incoming).length && w.get([t.key]) === undefined) w.set([t.key], {});
        for (const id of sorted(incoming)) {
          const value = clone(incoming[id]);
          const existing = w.get([t.key, id]);
          let action = 'added';
          if (existing !== undefined) {
            if (same(withoutRetired(existing, t.key), withoutRetired(value, t.key))) action = 'unchanged';
            else if (overwrite) action = 'replaced';
            else action = 'skipped';
          }
          rep[action][t.key]++;                       // added | replaced | unchanged | skipped
          if (action === 'skipped') {
            rep.ids.skipped.push(t.key + '/' + id);
            problem('warn', 'duplicate-id', `${t.kind} '${id}' is already in the project and is different — kept the one that was there (use --overwrite to replace it)`, whereOf(t.key, id));
            continue;
          }
          if (action !== 'unchanged') { rep.ids[action].push(t.key + '/' + id); w.set([t.key, id], value); touched++; }
          if (t.key === 'maps' && isObj(value)) rep[action].objects += (value.objects || []).length;
          if (t.registry) toRegister.push({ registry: t.registry, id, def: value });
        }
        if (t.key === 'animations' && Object.keys(incoming).length) {
          problem('info', 'animations-stored', `${Object.keys(incoming).length} named animation(s) were stored on project.animations; Kit has no animation registry yet, so nothing plays them`, {});
        }
      }

      // 1b. a module's content slice ----------------------------------------------
      // `result.packs[key]` goes into `project.packs[key]`. The kit does not read
      // any of it: a list of things with ids is merged by id (yours kept unless
      // asked otherwise), anything else is set when the project has nothing there.
      const packs = isObj(res[PACK_KEY]) ? res[PACK_KEY] : null;
      if (packs) {
        sawPacks = true;
        for (const key of sorted(packs)) {
          const slice = packs[key];
          if (!isObj(slice)) continue;
          if (w.get([PACK_KEY]) === undefined) w.set([PACK_KEY], {});
          if (w.get([PACK_KEY, key]) === undefined) w.set([PACK_KEY, key], {});
          for (const field of sorted(slice)) {
            const incoming = slice[field];
            const path = [PACK_KEY, key, field];
            const here = w.get(path);
            if (Array.isArray(incoming)) {
              const mineById = new Map((Array.isArray(here) ? here : []).map((x, i) => [x && x.id != null ? String(x.id) : `#${i}`, x]));
              let added = 0, replaced = 0, skipped = 0;
              for (const entry of incoming) {
                if (!isObj(entry) || entry.id == null) continue;
                const id = String(entry.id);
                if (!mineById.has(id)) { mineById.set(id, clone(entry)); added++; continue; }
                if (same(mineById.get(id), entry)) continue;
                if (overwrite) { mineById.set(id, clone(entry)); replaced++; }
                else { skipped++; problem('warn', 'duplicate-id', `${key}.${field} '${id}' is already in this game and is different — kept the one that was there`, { path }); }
              }
              if (added || replaced) { w.set(path, Array.from(mineById.values())); touched++; }
              rep.added[`${key}.${field}`] = (rep.added[`${key}.${field}`] || 0) + added;
              if (replaced) rep.replaced[`${key}.${field}`] = (rep.replaced[`${key}.${field}`] || 0) + replaced;
              if (skipped) rep.skipped[`${key}.${field}`] = (rep.skipped[`${key}.${field}`] || 0) + skipped;
            } else if (isObj(incoming)) {
              const merged = Object.assign({}, isObj(here) ? here : {});
              let added = 0, skipped = 0;
              for (const k of sorted(incoming)) {
                if (merged[k] !== undefined && !overwrite) { if (!same(merged[k], incoming[k])) skipped++; continue; }
                merged[k] = clone(incoming[k]); added++;
              }
              if (added) { w.set(path, merged); touched++; }
              rep.added[`${key}.${field}`] = (rep.added[`${key}.${field}`] || 0) + added;
              if (skipped) rep.skipped[`${key}.${field}`] = (rep.skipped[`${key}.${field}`] || 0) + skipped;
            } else if (here === undefined || overwrite) {
              if (!same(here, incoming)) { w.set(path, clone(incoming)); touched++; rep.added[`${key}.${field}`] = (rep.added[`${key}.${field}`] || 0) + 1; }
            }
          }
        }
      }

      // Aseprite slices that are neither a face nor an icon have nowhere to go.
      if (Array.isArray(res.slices) && res.slices.length) {
        problem('info', 'slices-dropped', `${res.slices.length} named slice(s) were not imported: a slice becomes a face or an icon only when its name says so (face-…, icon-…)`, {});
      }

      // Objects that belong to no map cannot be placed anywhere.
      if (Array.isArray(res.objects) && res.objects.length && !Object.keys(res.maps || {}).length) {
        problem('warn', 'objects-without-map', `${res.objects.length} object(s) came without a map to put them on and were not merged`, {});
        rep.skipped.objects += res.objects.length;
      }

      // 2. top-level project fields ----------------------------------------------
      const pr = isObj(res.project) ? res.project : null;
      if (pr) touched += mergeProjectFields(w, pr, { overwrite, problem, rep, autotileSet: o.autotileSet });

      // 3. a last sanity pass ------------------------------------------------------
      const start = w.get(['start']);
      if (isObj(start) && start.map && !w.get(['maps', start.map])) {
        problem('warn', 'start-map-missing', `the start map '${start.map}' is not in this project`, {});
      }
      if (!touched) problem('info', 'nothing-to-merge', 'nothing changed: every id in this import was already in the project', {});

    };
    if (doc && !rep.dryRun) target.transaction(label, body); else body();

    // 4. registries -------------------------------------------------------------
    if (!rep.dryRun && o.register !== false) {
      rep.registered = register(toRegister, problem);
      // A module's own content has its own registries (the mons module's species):
      // it knows where they go, the kit does not. Without this an imported roster
      // was in the project and in no picker until the next reload.
      if (sawPacks && KIT.modules && typeof KIT.modules.registerContent === 'function') {
        try { KIT.modules.registerContent(project); }
        catch (e) { problem('warn', 'registry-rejected', `a module could not take its part of the import: ${e && e.message ? e.message : e}`, {}); }
      }
    }
    rep.problems = rep.problems.concat((res.problems || []).map(p => Object.assign({ severity: 'info', code: 'import', message: '' }, p)));
    return rep;
  }

  function whereOf(key, id) {
    if (key === 'maps') return { map: id };
    if (key === 'scripts') return { script: id };
    return { path: [key, id] };
  }

  /** Arrays of defs and tables keyed by id both arrive here as { id: def }. */
  function tableOf(value, key) {
    if (Array.isArray(value)) {
      const out = {};
      for (const def of value) {
        if (!isObj(def) || def.id == null) continue;
        const copy = Object.assign({}, def);
        delete copy.replace;
        out[String(def.id)] = copy;
      }
      return out;
    }
    if (!isObj(value)) return {};
    const out = {};
    for (const id of Object.keys(value)) {
      if (!isObj(value[id])) { out[id] = value[id]; continue; }
      const copy = Object.assign({}, value[id]);
      if (key === 'assets' || key === 'items' || key === 'vars' || key === 'scripts') delete copy.id;
      out[id] = copy;
    }
    return out;
  }

  /**
   * Put the incoming values into the shape the project keeps them in, so that a
   * second import of the same file compares equal to what the first one wrote
   * (the project on disk has been through KIT.project.normalize; the importer's
   * output has not). Everything the fillers do not know about is carried over.
   */
  function shapeTable(table, key) {
    const P = KIT.project;
    const fill = P && (key === 'maps' ? P.fillMap : key === 'items' ? P.fillItem : key === 'vars' ? P.fillVar : key === 'scripts' ? P.fillScript : null);
    if (!fill) return table;
    const out = {};
    for (const id of Object.keys(table)) {
      try { out[id] = fill(table[id], id); } catch (e) { out[id] = table[id]; }
    }
    return out;
  }

  function mergeProjectFields(w, pr, ctx) {
    const { overwrite, problem, rep } = ctx;
    let touched = 0;
    // title / start: never trample what the author already wrote, unless asked.
    const meta = w.get(['meta']) || {};
    if (isObj(pr.meta) && pr.meta.title) {
      if (!meta.title || overwrite) { w.set(['meta', 'title'], pr.meta.title); touched++; }
      else if (meta.title !== pr.meta.title) problem('info', 'project-field-kept', `this project is called “${meta.title}”; the import wanted “${pr.meta.title}” (use --overwrite to take it)`, { path: ['meta', 'title'] });
    }
    if (isObj(pr.start) && pr.start.map) {
      const start = w.get(['start']) || {};
      if (!start.map || overwrite) { w.set(['start'], Object.assign({ dir: 'down' }, start, pr.start)); touched++; }
      else problem('info', 'project-field-kept', `the game still starts on '${start.map}'; the import wanted '${pr.start.map}'`, { path: ['start'] });
    }
    // tileSize: a mismatch is the one that ruins a map, so it is a warning.
    const size = isObj(pr.settings) ? pr.settings.tileSize : null;
    if (size) {
      const settings = w.get(['settings']) || {};
      const have = settings.tileSize;
      if (!have || have === size) { if (!have) { w.set(['settings', 'tileSize'], size); touched++; } }
      else if (overwrite) { w.set(['settings', 'tileSize'], size); touched++; problem('warn', 'tile-size-mismatch', `the project's tiles were ${have}px and are now ${size}px — every map already in it will be drawn at the new size`, { path: ['settings', 'tileSize'] }); }
      else problem('warn', 'tile-size-mismatch', `this import draws ${size}px tiles but the project uses ${have}px; the imported art will be scaled to ${have}px squares`, { path: ['settings', 'tileSize'] });
    }
    // terrains: merged by numeric id.
    if (Array.isArray(pr.terrains) && pr.terrains.length) {
      const have = (w.get(['terrains']) || []).slice();
      let changed = false;
      for (const t of pr.terrains) {
        if (!isObj(t)) continue;
        const i = have.findIndex(x => x && x.id === t.id);
        if (i < 0) { have.push(clone(t)); rep.added.terrains++; changed = true; continue; }
        if (same(have[i], t)) { rep.unchanged.terrains++; continue; }
        if (overwrite) { have[i] = clone(t); rep.replaced.terrains++; changed = true; }
        else {
          rep.skipped.terrains++;
          const differs = Object.keys(t).filter(k => !same(have[i][k], t[k])).join(', ');
          problem('warn', 'terrain-conflict', `terrain ${t.id} is already “${have[i].name}” in this project and the import's “${t.name}” is not quite the same (${differs || 'different'}); the one that was here was kept`, { path: ['terrains'] });
        }
      }
      if (changed) { have.sort((a, b) => (a.id || 0) - (b.id || 0)); w.set(['terrains'], have); touched++; }
    }
    // autotiles: merged group by group, into the set the import names (default).
    if (isObj(pr.autotiles)) {
      for (const setKey of Object.keys(pr.autotiles).sort()) {
        const incoming = pr.autotiles[setKey];
        if (!isObj(incoming) || !Array.isArray(incoming.groups)) continue;
        const key = ctx.autotileSet || setKey;
        const set = w.get(['autotiles', key]) || { source: incoming.source || 'terrain', groups: [] };
        const groups = (set.groups || []).slice();
        let changed = false;
        for (const raw of incoming.groups) {
          const g = isObj(raw) && KIT.project.fillAutotileGroup ? KIT.project.fillAutotileGroup(raw, 0) : raw;
          if (!isObj(g) || g.id == null) continue;
          const i = groups.findIndex(x => x && x.id === g.id);
          if (i < 0) { groups.push(clone(g)); rep.added.autotiles++; changed = true; continue; }
          if (same(groups[i], g)) { rep.unchanged.autotiles++; continue; }
          if (overwrite) { groups[i] = clone(g); rep.replaced.autotiles++; changed = true; }
          else { rep.skipped.autotiles++; problem('warn', 'duplicate-id', `autotile group '${g.id}' is already in this project and is different`, { path: ['autotiles', key] }); }
        }
        if (changed) { w.set(['autotiles', key], { source: set.source || incoming.source || 'terrain', groups }); touched++; }
      }
    }
    return touched;
  }

  /** Register what the running game needs to draw the import right now. */
  function register(list, problem) {
    let n = 0;
    for (const entry of list) {
      try {
        if (entry.registry === 'assets') {
          if (!KIT.assets || !KIT.assets.define) continue;
          KIT.assets.define(Object.assign({ id: entry.id }, entry.def));
        } else {
          if (!KIT.registry.exists(entry.registry)) continue;
          KIT.registry(entry.registry).add(Object.assign({ id: entry.id }, entry.def, { replace: true }));
        }
        n++;
      } catch (e) {
        problem('warn', 'registry-rejected', `'${entry.id}' could not be registered as a ${entry.registry.replace(/s$/, '')}: ${e && e.message ? e.message : e}`, { path: [entry.registry, entry.id] });
      }
    }
    return n;
  }

  /**
   * registerProject(project) — put a project's own content tables into the
   * registries. The engine does this at load time (KIT.project.registerContent);
   * this alias is here so a panel holding only the importer can do it too.
   */
  IMP.merge.registerProject = function (project) {
    return KIT.project.registerContent(project);
  };

  IMP.merge.TABLES = TABLES.map(t => t.key);

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
