// Tile art registration. The art lives in tiles-nature.js / tiles-town.js /
// tiles-interior.js, which call PKMN.TILES.register([...]) with entries of the
// form { id, name, group, solid, palette, rows | frames, ... } (§6.2). Those
// calls are thin aliases that forward to the kit's 'tiles' registry — the
// registry fills the flag defaults, and a tile definition is its own art
// (KIT.pixels.artOf(def) returns it). Stamps (multi-tile brushes) are kept on
// KIT.registry('tiles').stamps. Nothing here touches pixel data.
//
// Requires the kit core (registry, schema, registries, pixels, world/tiles) to
// be loaded first.
(function (root) {
  const KIT = root.KIT;
  const PKMN = root.PKMN = root.PKMN || {};
  const reg = KIT.registry('tiles');
  const T = PKMN.TILES = PKMN.TILES || {};

  const titleCase = (id) => id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  /** register(tiles) — forwards to KIT.registry('tiles').addAll after the legacy w/h/name/group defaults. */
  T.register = function (tiles) {
    const list = [];
    for (const t of tiles) {
      if (!t || !t.id) continue;
      if (t.w == null) t.w = 16;
      if (t.h == null) t.h = 16;
      if (t.group == null) t.group = 'nature';
      if (!t.name) t.name = titleCase(t.id);
      if (reg.has(t.id)) t.replace = true;   // art files may be re-run (tools); replacing the same id is not a warning
      list.push(t);
    }
    reg.addAll(list);
  };

  /** registerStamps(stamps) — upserts into KIT.registry('tiles').stamps ({ id, name, group, tiles:[[ids]] }). */
  T.registerStamps = function (stamps) { reg.addStamps(stamps); };

  // Legacy views over the registry (the art tools read these).
  Object.defineProperty(T, 'list', { get: () => reg.list() });
  Object.defineProperty(T, 'byId', { get: () => { const o = {}; for (const t of reg.list()) o[t.id] = t; return o; } });
  Object.defineProperty(T, 'stamps', { get: () => reg.stamps });
  T.groups = ['nature', 'town', 'interior', 'cave'];
  /** Frame to draw for an animated tile at time t (ms) — KIT.tiles.frameAt. */
  T.frameAt = (tile, t) => KIT.tiles.frameAt(tile, t);

  // The pixel helpers moved to KIT.pixels; keep the old name for the art tools.
  PKMN.Pixels = KIT.pixels;

  const house = (roof) => [
    [roof, roof, roof, roof, roof],
    [roof + '-eave', roof + '-eave', roof + '-eave', roof + '-eave', roof + '-eave'],
    ['wall', 'wall-window', 'wall', 'wall-window', 'wall'],
    ['wall', 'wall', 'door', 'wall', 'wall'],
  ];
  T.registerStamps([
    { id: 'big-tree', name: 'Big tree', group: 'nature', tiles: [['tree-tl', 'tree-tr'], ['tree-bl', 'tree-br']] },
    { id: 'house-red', name: 'Red house', group: 'town', tiles: house('roof-red') },
    { id: 'house-blue', name: 'Blue house', group: 'town', tiles: house('roof-blue') },
    { id: 'house-green', name: 'Green house', group: 'town', tiles: house('roof-green') },
    { id: 'lab', name: 'Lab', group: 'town', tiles: [
      ['roof-blue', 'roof-blue', 'roof-blue', 'roof-blue', 'roof-blue', 'roof-blue', 'roof-blue'],
      ['roof-blue-eave', 'roof-blue-eave', 'roof-blue-eave', 'roof-blue-eave', 'roof-blue-eave', 'roof-blue-eave', 'roof-blue-eave'],
      ['lab-wall', 'lab-window', 'lab-wall', 'lab-window', 'lab-wall', 'lab-window', 'lab-wall'],
      ['lab-wall', 'lab-wall', 'lab-wall', 'lab-door', 'lab-wall', 'lab-wall', 'lab-wall'],
    ] },
    { id: 'bed', name: 'Bed', group: 'interior', tiles: [['bed-top'], ['bed-bottom']] },
    { id: 'pond', name: 'Pond (3×3)', group: 'nature', tiles: [['water', 'water', 'water'], ['water', 'water-lily', 'water'], ['water', 'water', 'water']] },
  ]);

  if (typeof module !== 'undefined' && module.exports) module.exports = PKMN;
})(typeof window !== 'undefined' ? window : globalThis);
