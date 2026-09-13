// Tile registry. The art lives in tiles-nature.js / tiles-town.js /
// tiles-interior.js, which call PKMN.TILES.register([...]). Stamps (multi-tile
// brushes) are defined here because they only reference tile ids.
(function (root) {
  const PKMN = root.PKMN = root.PKMN || {};
  const T = PKMN.TILES = PKMN.TILES || { list: [], byId: {}, stamps: [], groups: ['nature', 'town', 'interior', 'cave'] };

  T.register = function (tiles) {
    for (const t of tiles) {
      if (!t || !t.id) continue;
      if (t.w == null) t.w = 16;
      if (t.h == null) t.h = 16;
      if (t.solid == null) t.solid = false;
      if (t.encounter == null) t.encounter = false;
      if (t.group == null) t.group = 'nature';
      if (!t.name) t.name = t.id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      if (T.byId[t.id]) T.list[T.list.findIndex(x => x.id === t.id)] = t; else T.list.push(t);
      T.byId[t.id] = t;
    }
  };

  T.registerStamps = function (stamps) {
    for (const s of stamps) {
      const i = T.stamps.findIndex(x => x.id === s.id);
      if (i >= 0) T.stamps[i] = s; else T.stamps.push(s);
    }
  };

  // Frame to draw for an animated tile at time t (ms). 500 ms per frame.
  T.frameAt = function (tile, t) {
    if (!tile || !tile.frames || tile.frames.length < 2) return 0;
    return Math.floor(t / 500) % tile.frames.length;
  };

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
