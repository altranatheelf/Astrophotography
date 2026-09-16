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

    // The slice of the save this module owns. The engine fills it, migrates it
    // and calls `repair` whenever a world is made, so KIT.home.ensure(save) is
    // only a named way of reading what is already there.
    save: {
      key: 'home',
      defaults: () => KIT.home.defaults(),
      migrate: KIT.home.migrations,
      repair: (data) => KIT.home.repair(data),
    },

    // The slice of the project this module owns: project.packs.home, whose
    // `tuning` is the declared shape — so the engine fills every number and
    // Creator Mode's generic inspector can edit them.
    content: {
      key: 'home',
      fields: KIT.home.TUNING,
      at: 'tuning',
      defaults: () => KIT.home.contentDefaults(),
    },
  };
  KIT.home.MANIFEST = DEF;

  // The module system is the engine's (js/kit/core/modules.js), so KIT.module
  // exists as soon as the kit is on the page — long before this file. Declaring
  // is one line.
  if (typeof KIT.module !== 'function') {
    (KIT.log || console).error('[home] KIT.module is missing: the engine is not on the page, so this module cannot be enabled');
  } else {
    KIT.module(DEF);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
