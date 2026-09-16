// mons — the Pokémon side of the game: befriending instead of fighting.
//
// Load order (index.html): rules, strings, art, actions, script, systems,
// scenes, panel, manifest. Everything above defines; this file registers.
//
// What it owns:
//   save   save.modules.mons = { version, party, box, dex:{seen,caught}, follower, steps, lastSeenAt, petted }
//   content project.packs.mons = { ball, berry, difficulty, followers, profiles, rarity, starters, ... }
//   maps   map.props.encounters = { byRegion:{ '1':[{id,weight}] }, rate }
//          map.props.garden     = { region:n } | { x0,y0,x1,y1 }   (or map.kind = 'garden')
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const M = KIT.mons = KIT.mons || {};

  const DEF = {
    id: 'mons',
    version: 1,
    label: 'Pokémon',
    requires: [],
    describe: 'Befriending, the Pokédex, the garden and a follower who walks behind you.',

    register(kit) {
      const PKMN = root.PKMN || {};
      M.registerSpecies(PKMN.POKEMON || {});
      M.registerStrings();
      M.registerScript();
      M.registerItems();
      M.registerSystems();
      M.registerEditor();
      if (typeof M.registerScenes === 'function') M.registerScenes();
    },

    save: {
      key: 'mons',
      defaults: () => M.saveDefaults(),
      migrate: [{ from: 1, to: 2, up: (data) => M.migrateSave(data) }],
    },

    content: {
      key: 'mons',
      defaults: () => M.contentDefaults(),
      fields: [
        { key: 'ball', type: 'ref:item', nullable: false, default: 'pokeball', label: 'Ball item' },
        { key: 'berry', type: 'ref:item', nullable: false, default: 'berry', label: 'Berry item' },
        { key: 'goldenBerry', type: 'ref:item', nullable: true, default: 'golden-berry', label: 'Golden berry' },
        { key: 'difficulty', type: 'enum', options: ['gentle', 'normal', 'hard'], default: 'normal' },
        { key: 'followers', type: 'bool', default: true, doc: 'The first party Pokémon walks behind you' },
        { key: 'shinyChance', type: 'number', min: 0, max: 1, default: 0.012 },
        { key: 'stepsPerFriendship', type: 'number', integer: true, min: 1, default: 128 },
        { key: 'petBonus', type: 'number', integer: true, min: 0, default: 3 },
        { key: 'berryBonus', type: 'number', integer: true, min: 0, default: 10 },
        { key: 'awayHours', type: 'number', min: 1, default: 20, doc: 'A day away is worth a little something' },
        { key: 'awayBonus', type: 'number', integer: true, min: 0, default: 4 },
        { key: 'defaultProfile', type: 'string', default: 'friendly', doc: 'Which catch profile the scene uses' },
      ],
    },
  };

  // main.js says a manifest may load before or after it, but KIT.module only
  // exists once main.js has run — and index.html loads the modules *before*
  // main.js so that main.js still captures the whole page as KIT.PRISTINE_HTML.
  // So: announce ourselves now if we can, and otherwise on DOMContentLoaded,
  // whose listener we registered first and which therefore runs before boot.
  // (See README, "the missing hook".)
  M.MANIFEST = DEF;
  function announce(loud) {
    if (typeof KIT.module !== 'function') {
      if (loud) (KIT.log || console).error('[mons] KIT.module is still not defined — is js/main.js in the page?');
      return false;
    }
    KIT.module(DEF);
    return true;
  }
  if (!announce(false) && typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', () => announce(true));
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
