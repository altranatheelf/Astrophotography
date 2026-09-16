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
      repair: (data) => KIT.dungeon.repair(data),
    },

    // The slice of the project this module owns: project.packs.dungeon.
    content: {
      key: 'dungeon',
      fields: KIT.dungeon.TUNING,
      defaults: () => KIT.dungeon.contentDefaults(),
    },
  };
  KIT.dungeon.MANIFEST = DEF;

  // The module system is the engine's (js/kit/core/modules.js), so KIT.module
  // exists as soon as the kit is on the page — long before this file. Declaring
  // is one line.
  if (typeof KIT.module !== 'function') {
    (KIT.log || console).error('[dungeon] KIT.module is missing: the engine is not on the page, so this module cannot be enabled');
  } else {
    KIT.module(DEF);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
