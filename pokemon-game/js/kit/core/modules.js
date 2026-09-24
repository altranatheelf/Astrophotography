// KIT.modules: the module system (docs/MODULES.md).
//
// A module is a folder of ordinary kit code that declares itself once:
//
//   KIT.module({
//     id: 'home', version: 1, requires: [],
//     register(KIT) { … },                                  // add to the registries
//     save:    { key: 'home', defaults: () => …, migrate: [ { from, to, up } ], repair(d) { … } },
//     content: { key: 'home', fields: […], at: 'tuning', defaults: () => … },
//   })
//
// `register` is the module's own business. The two declarations below it are the
// engine's: it fills and migrates `save.modules.<key>` whenever a save is made or
// loaded, and it fills and validates `project.packs.<key>` in normalize. A module
// therefore does not need a hand-written `ensure(save)` / `pack(project)` pair,
// and — because packs.<key> has a declared shape — the generic inspector can edit
// its content like anything else.
//
//   KIT.modules.activate(project)      switch on what this project enables
//   KIT.modules.ensureSaves(save)      fill + migrate every loaded module's slice
//   KIT.modules.ensurePacks(project)   fill every loaded module's content slice
//   KIT.modules.order(ids)             the dependency sort, pure and testable
//
// This file is the engine's; js/main.js is only the page's entry point.
(function (root) {
  const KIT = root.KIT = root.KIT || {};

  const defs = [];
  const loaded = [];

  /** Say it loudly. The page defines KIT.banner; headless, the console will do. */
  const complain = (text) => {
    if (typeof KIT.banner === 'function') KIT.banner(text);
    else (KIT.log || console).error('[kit] ' + text);
  };

  /** KIT.module({ id, version, requires, register, save, content }) — called by a manifest at load time. */
  KIT.module = function (def) {
    if (!def || !def.id) throw new Error('KIT.module: a module needs an id');
    const i = defs.findIndex(d => d.id === def.id);
    if (i >= 0) defs[i] = def; else defs.push(def);
    return def;
  };

  const M = KIT.modules = {
    /** all() -> every manifest seen, in load order. */
    all() { return defs.slice(); },
    /** loaded() -> the ones whose register() ran, in dependency order. */
    loaded() { return loaded.slice(); },
    get(id) { return defs.find(d => d.id === id) || null; },
    has(id) { return loaded.some(d => d.id === id); },

    /**
     * order(ids) -> { order, missing, cycles } — a topological sort of the manifests.
     * Pure, so the module test can check it without a page.
     */
    order(ids) {
      const wanted = ids ? defs.filter(d => ids.includes(d.id)) : defs.slice();
      const byId = new Map(wanted.map(d => [d.id, d]));
      const order = [], missing = [], cycles = [];
      const state = new Map();                 // id -> 'visiting' | 'done'
      const visit = (def, trail) => {
        if (state.get(def.id) === 'done') return;
        if (state.get(def.id) === 'visiting') { cycles.push(trail.concat(def.id).join(' → ')); return; }
        state.set(def.id, 'visiting');
        for (const req of def.requires || []) {
          const dep = byId.get(req);
          if (!dep) { missing.push({ module: def.id, requires: req }); continue; }
          visit(dep, trail.concat(def.id));
        }
        state.set(def.id, 'done');
        order.push(def);
      };
      for (const d of wanted) visit(d, []);
      return { order, missing, cycles };
    },

    /** activate(project) — register the modules this project enables, in dependency order. */
    activate(project) {
      const enabled = project && Array.isArray(project.modules) ? project.modules : defs.map(d => d.id);
      const { order, missing, cycles } = M.order(enabled);
      for (const m of missing) complain(`The module “${m.module}” needs “${m.requires}”, which is not loaded.`);
      for (const c of cycles) complain(`The modules ${c} require each other in a circle.`);
      for (const def of order) {
        if (loaded.some(d => d.id === def.id)) continue;
        try {
          if (typeof def.register === 'function') def.register(KIT);
          loaded.push(def);
        } catch (e) {
          (KIT.log || console).error(`[module ${def.id}] register threw`, e);
          complain(`The module “${def.id}” failed to start: ${e.message}`);
        }
      }
      return loaded.slice();
    },

    /**
     * forget(id) — unsay KIT.module(id) entirely: it is neither loaded nor
     * declared afterwards. Nothing in a game does this; a test that declares a
     * throwaway module does, so the next test does not inherit it.
     */
    forget(id) {
      for (const list of [loaded, defs]) {
        const i = list.findIndex(d => d.id === id);
        if (i >= 0) list.splice(i, 1);
      }
    },

    // ---- the save slice ----------------------------------------------------------
    /**
     * saveSection(save, id) -> save.modules[key], created, migrated and filled.
     *
     * Migrations run oldest first: each `{ from, to, up(data) }` takes the section
     * at `from` and returns it at `to`, so a save written before this module
     * existed, or by an older version of it, still loads. Missing keys then take
     * their default, which is what makes adding a field to a module safe.
     */
    saveSection(save, id) {
      const def = M.get(id);
      const decl = def && def.save;
      if (!decl || !decl.key) return null;
      if (!save || typeof save !== 'object') return defaultsOf(decl);
      save.modules = save.modules || {};
      let data = save.modules[decl.key];
      if (!data || typeof data !== 'object' || Array.isArray(data)) data = defaultsOf(decl);
      const chain = decl.migrate || [];
      if (chain.length && !Number.isFinite(data.version)) data.version = 1;
      for (const m of chain) {
        if (!m || data.version !== m.from) continue;
        try { data = m.up(data) || data; }
        catch (e) { (KIT.log || console).error(`[module ${id}] migration ${m.from}→${m.to}`, e); }
        data.version = m.to;
      }
      const d = defaultsOf(decl);
      for (const k of Object.keys(d)) {
        if (!Object.prototype.hasOwnProperty.call(data, k) || data[k] === undefined) data[k] = KIT.deepClone(d[k]);
      }
      // A save can arrive edited, truncated or written by a version that spelt a
      // field differently. `repair` is the module's last word on its own shape.
      if (typeof decl.repair === 'function') {
        try { data = decl.repair(data) || data; }
        catch (e) { (KIT.log || console).error(`[module ${id}] repair threw`, e); }
      }
      save.modules[decl.key] = data;
      return data;
    },

    /** ensureSaves(save) -> save — every loaded module's slice, in dependency order. */
    ensureSaves(save) {
      for (const def of loaded) M.saveSection(save, def.id);
      return save;
    },

    // ---- the content slice -------------------------------------------------------
    /**
     * pack(project, id) -> project.packs[key] with every declared field filled in.
     * Never mutates the project: this is the reading view. ensurePacks() writes.
     */
    pack(project, id) {
      const def = M.get(id);
      const decl = def && def.content;
      if (!decl || !decl.key) return null;
      const raw = (project && project.packs && project.packs[decl.key]) || {};
      const out = Object.assign({}, defaultsOf(decl), raw);
      if (decl.fields && KIT.schema) {
        // Declared fields are filled inside whichever object they were declared
        // against — a pack is usually { tuning: {…}, … }, and `fields` describes
        // the tuning. `at` names that object; the default is the pack itself.
        const at = decl.at || null;
        const target = at ? Object.assign({}, defaultsOf(decl)[at], raw[at] || {}) : out;
        const filled = KIT.schema.fill(decl.fields, target);
        if (at) out[at] = filled; else Object.assign(out, filled);
      }
      return out;
    },

    /**
     * registerContent(project) -> the ids each module registered.
     * A module's content slice may carry things that belong in a registry — the
     * mons module's species, say. The kit knows nothing about what they are: it
     * calls the hook at load time (KIT.project.registerContent) and after an
     * edit, and the module puts its own content where it belongs.
     */
    registerContent(project) {
      const out = {};
      for (const def of loaded) {
        const decl = def.content;
        if (!decl || typeof decl.register !== 'function') continue;
        try { out[def.id] = decl.register(M.pack(project, def.id), project) || []; }
        catch (e) { (KIT.log || console).warn(`[modules] ${def.id} could not register its content`, e); }
      }
      return out;
    },

    /** ensurePacks(project) -> project — writes each loaded module's filled pack back. */
    ensurePacks(project) {
      if (!project) return project;
      for (const def of loaded) {
        if (!def.content || !def.content.key) continue;
        project.packs = project.packs || {};
        project.packs[def.content.key] = M.pack(project, def.id);
      }
      return project;
    },

    /**
     * problems(project) -> [{ severity, code, message, where }] — each loaded
     * module's content validated against the fields it declared. KIT.project's
     * validator calls this, so a module's numbers are checked like everything else.
     */
    problems(project) {
      const out = [];
      if (!project || !KIT.schema) return out;
      for (const def of loaded) {
        const decl = def.content;
        if (!decl || !decl.key || !decl.fields) continue;
        const pack = (project.packs && project.packs[decl.key]) || {};
        const value = decl.at ? (pack[decl.at] || {}) : pack;
        const path = ['packs', decl.key].concat(decl.at ? [decl.at] : []);
        for (const e of KIT.schema.validate(decl.fields, KIT.schema.fill(decl.fields, value))) {
          out.push({
            severity: 'error', code: 'module-content',
            message: `${def.id}: ${e.path.join('.')} ${e.message}`,
            where: { path: path.concat(e.path) },
          });
        }
      }
      return out;
    },
  };

  function defaultsOf(decl) {
    try {
      const d = typeof decl.defaults === 'function' ? decl.defaults() : decl.defaults;
      return (d && typeof d === 'object') ? d : {};
    } catch (e) { (KIT.log || console).error(`[module ${decl && decl.key ? decl.key : '?'}] defaults() threw; using {}`, e); return {}; }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
