// The entry point. Three jobs, in this order:
//
//  1. capture the page exactly as it was authored (KIT.PRISTINE_HTML) — publish
//     rebuilds from this, never from the live DOM;
//  2. provide KIT.module() / KIT.modules so module manifests can register
//     themselves, sorted by their `requires` (a missing one is a loud banner);
//  3. load the project (draft → embedded → content files → blank) and boot.
//
// Module manifests may be loaded before or after this file: KIT.module() is
// defined as soon as this script runs, and boot waits for DOMContentLoaded.
(function (root) {
  const KIT = root.KIT = root.KIT || {};

  // ---- 1. the pristine page ---------------------------------------------------
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      KIT.PRISTINE_HTML = '<!doctype html>\n' + document.documentElement.outerHTML;
    }
  } catch (e) { KIT.PRISTINE_HTML = null; }

  // ---- 2. modules -------------------------------------------------------------
  const defs = [];
  const loaded = [];

  /** KIT.module({ id, version, requires, register, save, content }) — called by a manifest at load time. */
  KIT.module = function (def) {
    if (!def || !def.id) throw new Error('KIT.module: a module needs an id');
    const i = defs.findIndex(d => d.id === def.id);
    if (i >= 0) defs[i] = def; else defs.push(def);
    return def;
  };

  KIT.modules = {
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
      const { order, missing, cycles } = KIT.modules.order(enabled);
      for (const m of missing) banner(`The module “${m.module}” needs “${m.requires}”, which is not loaded.`);
      for (const c of cycles) banner(`The modules ${c} require each other in a circle.`);
      for (const def of order) {
        try {
          if (typeof def.register === 'function') def.register(KIT);
          loaded.push(def);
        } catch (e) {
          (KIT.log || console).error(`[module ${def.id}] register threw`, e);
          banner(`The module “${def.id}” failed to start: ${e.message}`);
        }
      }
      return loaded.slice();
    },
  };

  /** A banner nobody can miss: modules and boot failures must not fail silently. */
  function banner(text) {
    (KIT.log || console).error('[kit] ' + text);
    try {
      if (typeof document === 'undefined' || !document.body) return;
      let el = document.getElementById('kit-banner');
      if (!el) {
        el = document.createElement('div');
        el.id = 'kit-banner';
        el.setAttribute('role', 'alert');
        document.body.insertBefore(el, document.body.firstChild);
      }
      const line = document.createElement('div');
      line.textContent = text;
      el.appendChild(line);
    } catch (e) { /* the console warning already happened */ }
  }
  KIT.banner = banner;

  // ---- 3. load and boot --------------------------------------------------------
  async function start() {
    try {
      // The modules start BEFORE the project is validated, not after. A module
      // brings object types, commands and item kinds with it, and the content
      // that uses them is checked against whatever is registered at the moment
      // it is checked — so activating afterwards means every page that says
      // @openJobBoard is reported as unknown, in the console, at every boot, on
      // a game that works perfectly.
      const { project, source, problems } = await KIT.storage.loadProject({
        before: (raw) => { KIT.modules.activate(raw); },
      });
      (KIT.log || console).info(`[kit] project “${(project.meta && project.meta.title) || '?'}” from ${source}` +
        (KIT.storage.info().adapter ? ` · storage: ${KIT.storage.info().adapter}` : '') +
        (KIT.modules.loaded().length ? ` · modules: ${KIT.modules.loaded().map(m => m.id).join(', ')}` : ''));
      for (const p of (problems || []).filter(p2 => p2.severity === 'error').slice(0, 3)) {
        (KIT.log || console).warn('[project]', p.code, p.message, p.where);
      }
      if (KIT.storage.warning) banner(KIT.storage.warning);
      await KIT.game.boot({ mount: document.getElementById('app') || document.body, project });
    } catch (e) {
      (KIT.log || console).error('[kit] boot failed', e);
      banner('The game could not start: ' + (e && e.message ? e.message : e));
    }
  }

  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof window !== 'undefined' ? window : globalThis);
