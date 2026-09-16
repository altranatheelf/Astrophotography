// The Home module: what there is to DO once the catching is over.
//
//   Decorating  — take furniture out of the bag and put it down, anywhere,
//                 without ever touching the author's map (save overlays only).
//   Jobs        — a board of errands; send a friend, wait out the clock (real
//                 time between sessions counts), welcome them home.
//   Moods       — the friends still at home drift, react to what you did, and
//                 now and then leave a present at the door.
//
// It works with or without the mons module: with it, the workers are the
// friends you caught; without it, they are the heroes.
//
// See js/modules/home/README.md. Rules: rules.js (pure, tested in Node).
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  if (!KIT.home || typeof KIT.home.registerAll !== 'function') {
    (KIT.log || console).error('[home] load js/modules/home/rules.js and register.js before the manifest');
    return;
  }

  const DEF = {
    id: 'home',
    version: 1,
    label: 'Home',
    requires: [],
    describe: 'Decorating, jobs for your friends, moods and little presents — the loop after catching.',

    register(kit) {
      KIT.home.registerAll(kit);
    },

    // The slice of the save this module owns. The engine does not read these
    // declarations yet (see README, "What the engine still owes us"), so
    // KIT.home.ensure(save) fills and migrates the section itself on first use.
    save: {
      key: 'home',
      defaults: () => KIT.home.defaults(),
      migrate: KIT.home.migrations,
    },

    // The slice of the project this module owns: project.packs.home.
    content: {
      key: 'home',
      fields: KIT.home.TUNING,
      defaults: () => KIT.home.contentDefaults(),
    },
  };
  KIT.home.MANIFEST = DEF;

  // index.html loads the modules before main.js, so the whole page is captured
  // as KIT.PRISTINE_HTML — which means KIT.module does not exist yet. Our
  // DOMContentLoaded listener is added before main.js adds its own, so we
  // declare the module before boot reads project.modules.
  function declare() {
    if (typeof KIT.module === 'function') return KIT.module(DEF);
    (KIT.log || console).error('[home] KIT.module is missing: js/main.js never loaded, so the module cannot be enabled');
    return null;
  }
  if (typeof KIT.module === 'function') declare();
  else if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', declare);
  else declare();

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
