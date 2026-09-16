// The Dungeon module: room-to-room crawling.
//
//   Locked doors   — a door, a key, and a lock that stays open once it is open.
//   Pushable blocks— shove them about; where you leave them is in the save, not
//                    in the map, so the author's floor plan is never changed.
//   Switch plates  — stand on one, or leave a block on one.
//   Gates          — open while the plates they listen for are down.
//   One-way ledges — tiles you can drop off and not climb back up.
//   A lantern      — the map is dark; you carry the only light in it.
//
// It needs no other module, and the kit knows nothing about it: everything here
// is an object type, a command, a condition, a behaviour and one system.
//
// See js/modules/dungeon/README.md. Rules: rules.js (pure, tested in Node).
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  if (!KIT.dungeon || typeof KIT.dungeon.registerAll !== 'function') {
    (KIT.log || console).error('[dungeon] load js/modules/dungeon/rules.js, art.js and register.js before the manifest');
    return;
  }

  const DEF = {
    id: 'dungeon',
    version: 1,
    label: 'Dungeon',
    requires: [],
    describe: 'Keys and locked doors, pushable blocks, switch-and-gate puzzles, one-way ledges and a lantern in the dark.',

    register(kit) {
      KIT.dungeon.registerAll(kit);
    },

    // The slice of the save this module owns. KIT.dungeon.ensure(save) fills and
    // migrates it on first use, so an old save keeps loading either way.
    save: {
      key: 'dungeon',
      defaults: () => KIT.dungeon.defaults(),
      migrate: KIT.dungeon.migrations,
    },

    // The slice of the project this module owns: project.packs.dungeon.
    content: {
      key: 'dungeon',
      fields: KIT.dungeon.TUNING,
      defaults: () => KIT.dungeon.contentDefaults(),
    },
  };
  KIT.dungeon.MANIFEST = DEF;

  // A page may load the modules before main.js (so main.js can capture the whole
  // page as KIT.PRISTINE_HTML). KIT.module does not exist yet at that point, so
  // declare on DOMContentLoaded — that listener is added before main.js adds its
  // own, and therefore runs before boot reads project.modules.
  function declare() {
    if (typeof KIT.module === 'function') return KIT.module(DEF);
    (KIT.log || console).error('[dungeon] KIT.module is missing: js/main.js never loaded, so the module cannot be enabled');
    return null;
  }
  if (typeof KIT.module === 'function') declare();
  else if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', declare);
  else declare();

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
