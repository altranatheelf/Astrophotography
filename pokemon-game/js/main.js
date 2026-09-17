// The entry point. Three jobs, in this order:
//
//  1. capture the page exactly as it was authored (KIT.PRISTINE_HTML) — publish
//     rebuilds from this, never from the live DOM;
//  2. put up a banner nobody can miss when something fails to start;
//  3. load the project and boot.
//
// The module system itself is the engine's (js/kit/core/modules.js), not this
// file's: KIT.module exists as soon as the engine is on the page, so a manifest
// may be loaded before or after this file, and boot waits for DOMContentLoaded
// either way.
(function (root) {
  const KIT = root.KIT = root.KIT || {};

  // ---- 1. the pristine page ---------------------------------------------------
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      KIT.PRISTINE_HTML = '<!doctype html>\n' + document.documentElement.outerHTML;
    }
  } catch (e) { KIT.PRISTINE_HTML = null; }

  // ---- 2. the banner -----------------------------------------------------------
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
      // Not validated here. Checking every command of every page of every object
      // is the expensive half of loading a project — 2.3 seconds of a 2.8 second
      // boot on a 400-map game — and it tells an AUTHOR things, never a player.
      // So the game starts, and the checking happens below, once nobody is
      // waiting for it.
      const { project, source, problems } = await KIT.storage.loadProject({
        validate: false,
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
      checkLater(project);
    } catch (e) {
      (KIT.log || console).error('[kit] boot failed', e);
      banner('The game could not start: ' + (e && e.message ? e.message : e));
    }
  }

  /**
   * The validation pass, after the game is already playing. An author still
   * hears about a broken tile id or an unknown command; a player waits for
   * nothing. `KIT.problems` holds the answer, and `problemsReady` says it is in,
   * so Creator Mode can show them without running the pass again.
   */
  function checkLater(project) {
    const run = () => {
      try {
        const t0 = (root.performance ? performance.now() : 0);
        const problems = KIT.project.validate(project, {});
        KIT.problems = problems;
        const errors = problems.filter(p => p.severity === 'error');
        if (errors.length) {
          (KIT.log || console).warn(`[project] ${errors.length} problem(s) an author should look at:`);
          for (const p of errors.slice(0, 10)) (KIT.log || console).warn('  ', p.code, p.message, p.where);
          if (errors.length > 10) (KIT.log || console).warn(`   …and ${errors.length - 10} more (Creator Mode › Problems)`);
        }
        if (KIT.bus) KIT.bus.emit('problemsReady', { problems });
      } catch (e) { (KIT.log || console).error('[project] the check itself failed', e); }
    };
    if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(run, { timeout: 4000 });
    else setTimeout(run, 1200);
  }

  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof window !== 'undefined' ? window : globalThis);
