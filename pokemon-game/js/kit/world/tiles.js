// KIT.tiles — tile flags, edge passage and autotile baking (all pure).
// Contract: docs/ARCHITECTURE.md §5 (autotiles/terrains), §6.2 (tile entry).
//
// Autotiles follow LDtk's auto-layer semantics, adapted to named tile ids:
//   * `map.layers.terrain` is the IntGrid: 0 = "no terrain" (hand-painted cell),
//     any other int is a terrain id from `project.terrains`.
//   * A rule group is evaluated top-down per cell; a matching rule paints its
//     tile and, when `breakOnMatch` is true, stops the group for that cell.
//   * Pattern cells (size×size, row-major, centred on the cell):
//       0            ignore
//       +v           the neighbour must BE terrain v
//       -v           the neighbour must NOT be terrain v
//       1000001      any terrain (not 0)      -1000001   empty (terrain 0)
//   * `flip:'x'|'y'|'xy'` also tries the pattern mirrored horizontally /
//     vertically / both. A mirrored match paints `tilesX` / `tilesY` /
//     `tilesXY` when the rule provides them, otherwise `tiles` (named tiles
//     cannot be flipped as pixels, so the author names the mirrored tile).
//   * `modulo:{ x, y, ox, oy }` — the rule only applies where
//     ((cx - ox) mod x) == 0 and ((cy - oy) mod y) == 0.
//   * `outOfBounds:null` — a pattern cell that falls outside the map never
//     matches, so edge/corner rules do not fire along the map border and a path
//     continues seamlessly into the neighbouring map; `outOfBounds:v` — cells
//     outside the map count as terrain v (set it to the surrounding terrain to
//     get edges along the border).
//   * `chance` (0..1) and `mode:'single'` picks (random by per-cell rng);
//     `mode:'stamp'` treats `tiles` as a size×size block painted around the cell.
//   * `terrains[].base` is painted on the ground layer when no rule paints it.
//   * Deco results: a deco cell is only rewritten when a rule paints it or when
//     the tile currently there is one some deco rule can paint ("owned" by the
//     autotiles); hand-placed deco (trees, signs) survives a re-bake.
//   Per-cell randomness: KIT.rng(KIT.hash(seed, groupId, x, y)) — so bakes are
//   deterministic and local (a cell's result depends only on its neighbourhood).
//
// @typedef {{ id:string, name?:string, active?:boolean, terrain?:number, layer?:'ground'|'deco', rules:AutoRule[] }} AutoGroup
// @typedef {{ size:number, pattern:number[], tiles:(string|null)[], tilesX?:string[], tilesY?:string[], tilesXY?:string[],
//             mode?:'single'|'stamp', chance?:number, breakOnMatch?:boolean, flip?:'none'|'x'|'y'|'xy',
//             outOfBounds?:number|null, modulo?:{x:number,y:number,ox:number,oy:number}, layer?:'ground'|'deco', active?:boolean }} AutoRule
// @typedef {{ id:number, name:string, color:string, base:string|null }} Terrain
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const T = KIT.tiles = KIT.tiles || {};

  const ANY = 1000001, EMPTY = -1000001;
  T.ANY = ANY; T.EMPTY = EMPTY;

  const DIR_KEY = { n: 'n', s: 's', e: 'e', w: 'w', up: 'n', down: 's', right: 'e', left: 'w', north: 'n', south: 's', east: 'e', west: 'w' };

  /** Defaults every tile has (a missing/unknown tile is walkable ground). */
  T.DEFAULTS = Object.freeze({ solid: false, passage: Object.freeze({ n: true, s: true, e: true, w: true }), bush: false, counter: false, ledge: null, encounter: false, terrainTag: 0, animMs: 500 });

  function registry() { return KIT.registry.exists('tiles') ? KIT.registry('tiles') : null; }
  T.def = function (tileOrId) {
    if (tileOrId && typeof tileOrId === 'object') return tileOrId;
    const r = registry();
    return r && typeof tileOrId === 'string' ? (r.get(tileOrId) || null) : null;
  };

  /**
   * flags(tileOrId) -> { id, exists, solid, passage:{n,s,e,w}, bush, counter, ledge, encounter, terrainTag, animMs, animated }
   * Registry flags merged over the defaults. Unknown ids are walkable with exists:false.
   */
  T.flags = function (tileOrId) {
    const d = T.def(tileOrId);
    const out = Object.assign({ id: d ? d.id : (typeof tileOrId === 'string' ? tileOrId : null), exists: !!d }, T.DEFAULTS);
    if (d) {
      for (const k of Object.keys(T.DEFAULTS)) if (d[k] != null && k !== 'passage') out[k] = d[k];
      out.passage = Object.assign({}, T.DEFAULTS.passage, d.passage || {});
      out.animated = Array.isArray(d.frames) ? d.frames.length > 1 : Array.isArray(d.art && d.art.frames) && d.art.frames.length > 1;
    } else out.animated = false;
    return out;
  };

  /** passage(tileOrId, dir) -> can an entity cross this tile's `dir` edge? dir: n|s|e|w or up|down|left|right. Solid tiles never pass. */
  T.passage = function (tileOrId, dir) {
    const f = T.flags(tileOrId);
    if (f.solid) return false;
    const k = DIR_KEY[dir];
    if (!k) return true;
    return f.passage[k] !== false;
  };

  /** frameAt(tileOrId, tMs) -> index of the animation frame to draw at time t (animMs per frame). */
  T.frameAt = function (tileOrId, t) {
    const d = T.def(tileOrId);
    const frames = d && (Array.isArray(d.frames) ? d.frames : (d.art && d.art.frames));
    if (!frames || frames.length < 2) return 0;
    const ms = Math.max(50, Number(d.animMs) || 500);
    return Math.floor((t || 0) / ms) % frames.length;
  };

  // ---- autotiles ----------------------------------------------------------

  const mod = (a, n) => ((a % n) + n) % n;

  /** Largest neighbourhood radius (floor(size/2)) over the active rules of an autotile set; 0 when there are none. */
  T.ruleRadius = function (set) {
    let r = 0;
    for (const g of (set && set.groups) || []) {
      if (g.active === false) continue;
      for (const rule of g.rules || []) if (rule.active !== false) r = Math.max(r, Math.floor((rule.size || 1) / 2));
    }
    return r;
  };

  /** Every tile id some rule of `set` can paint on `layer`. */
  T.ownedTiles = function (set, layer) {
    const out = new Set();
    for (const g of (set && set.groups) || []) {
      const gl = g.layer || 'ground';
      for (const rule of g.rules || []) {
        if ((rule.layer || gl) !== layer) continue;
        for (const list of [rule.tiles, rule.tilesX, rule.tilesY, rule.tilesXY]) for (const id of list || []) if (typeof id === 'string') out.add(id);
      }
    }
    return out;
  };

  function mirrorPattern(pattern, size, fx, fy) {
    const out = new Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const sx = fx ? size - 1 - x : x, sy = fy ? size - 1 - y : y;
      out[y * size + x] = pattern[sy * size + sx];
    }
    return out;
  }

  /** Does `pattern` (size×size) match the terrain around (cx, cy)? */
  function matches(pattern, size, terrain, width, height, cx, cy, outOfBounds) {
    const half = Math.floor(size / 2);
    for (let i = 0; i < size * size; i++) {
      const p = pattern[i];
      if (!p) continue;
      const x = cx + (i % size) - half, y = cy + Math.floor(i / size) - half;
      let v;
      if (x < 0 || y < 0 || x >= width || y >= height) {
        if (outOfBounds == null) return false;
        v = outOfBounds;
      } else v = terrain[y * width + x] || 0;
      if (p === ANY) { if (v === 0) return false; }
      else if (p === EMPTY) { if (v !== 0) return false; }
      else if (p > 0) { if (v !== p) return false; }
      else if (v === -p) return false;
    }
    return true;
  }

  /** The variants of a rule to try, in order: base, then mirrored per `flip`. Computed once per rule per bake. */
  function variants(rule) {
    const size = rule.size || 1;
    const pattern = rule.pattern || [];
    const list = [{ pattern, tiles: rule.tiles || [] }];
    const flip = rule.flip || 'none';
    if (flip === 'x' || flip === 'xy') list.push({ pattern: mirrorPattern(pattern, size, true, false), tiles: rule.tilesX || rule.tiles || [] });
    if (flip === 'y' || flip === 'xy') list.push({ pattern: mirrorPattern(pattern, size, false, true), tiles: rule.tilesY || rule.tiles || [] });
    if (flip === 'xy') list.push({ pattern: mirrorPattern(pattern, size, true, true), tiles: rule.tilesXY || rule.tiles || [] });
    return list;
  }

  /**
   * bake(map, project, { around:{x,y}, radius, seed, set }) -> { ground, deco, changed:[index] }
   * Pure: returns NEW ground/deco arrays for `map`; `changed` lists the indexes that differ from the
   * map's current layers. With `around` + `radius` only that square is re-evaluated (the rest is copied).
   * `set` names the autotile set in project.autotiles (default 'default'); `seed` defaults to the map id.
   */
  T.bake = function (map, project, opts) {
    opts = opts || {};
    const width = map.width | 0, height = map.height | 0, n = width * height;
    const layers = map.layers || {};
    const terrain = layers.terrain || [];
    const ground = (layers.ground || []).slice(0, n);
    const deco = (layers.deco || []).slice(0, n);
    while (ground.length < n) ground.push(null);
    while (deco.length < n) deco.push(null);
    const changed = [];
    const setId = opts.set || (map.props && map.props.autotiles) || 'default';
    const set = project && project.autotiles && project.autotiles[setId];
    if (!set) return { ground, deco, changed };
    const seed = opts.seed != null ? opts.seed : (map.id || 'map');
    const terrains = new Map();
    for (const t of (project.terrains || [])) terrains.set(t.id, t);
    const groups = (set.groups || []).filter(g => g.active !== false).map(g => ({
      id: g.id, layer: g.layer || 'ground',
      rules: (g.rules || []).filter(r => r.active !== false).map(r => ({ rule: r, variants: variants(r) })),
    }));
    const ownedDeco = T.ownedTiles(set, 'deco');

    let x0 = 0, y0 = 0, x1 = width - 1, y1 = height - 1;
    if (opts.around) {
      const r = opts.radius != null ? opts.radius : T.ruleRadius(set);
      x0 = Math.max(0, opts.around.x - r); y0 = Math.max(0, opts.around.y - r);
      x1 = Math.min(width - 1, opts.around.x + r); y1 = Math.min(height - 1, opts.around.y + r);
    }

    const stampGround = [], stampDeco = [];   // [{ index, id }] from stamp rules: applied after the pass (they win over neighbours' results)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * width + x;
      const tv = terrain[i] || 0;
      let paintedGround = null, paintedDeco = null;   // { id } once a rule painted (id may be null = clear)
      for (const g of groups) {
        const rng = KIT.rng(KIT.hash(seed, g.id, x, y));
        for (const { rule, variants: vs } of g.rules) {
          const layer = rule.layer || g.layer;
          const m = rule.modulo;
          if (m && ((m.x > 1 && mod(x - (m.ox || 0), m.x) !== 0) || (m.y > 1 && mod(y - (m.oy || 0), m.y) !== 0))) continue;
          const size = rule.size || 1;
          let hit = null;
          for (const v of vs) { if (matches(v.pattern, size, terrain, width, height, x, y, rule.outOfBounds == null ? null : rule.outOfBounds)) { hit = v; break; } }
          if (!hit) continue;
          const chance = rule.chance == null ? 1 : rule.chance;
          if (chance < 1 && !(rng() < chance)) continue;
          if ((rule.mode || 'single') === 'stamp') {
            const half = Math.floor(size / 2);
            const target = layer === 'deco' ? stampDeco : stampGround;
            hit.tiles.forEach((id, k) => {
              if (id === undefined) return;
              const sx = x + (k % size) - half, sy = y + Math.floor(k / size) - half;
              if (sx < 0 || sy < 0 || sx >= width || sy >= height) return;
              target.push({ index: sy * width + sx, id });
            });
          } else {
            let id = null;
            if (hit.tiles.length === 1) id = hit.tiles[0];
            else if (hit.tiles.length > 1) id = hit.tiles[rng.int(hit.tiles.length)];
            if (layer === 'deco') { if (!paintedDeco) paintedDeco = { id }; }
            else if (!paintedGround) paintedGround = { id };
          }
          if (rule.breakOnMatch !== false) break;
        }
      }
      // ground: rule result, else the terrain base (only on terrain cells), else untouched
      if (paintedGround) ground[i] = paintedGround.id;
      else if (tv !== 0) { const t = terrains.get(tv); if (t && t.base) ground[i] = t.base; }
      // deco: rule result, else clear only tiles the autotiles own
      if (paintedDeco) deco[i] = paintedDeco.id;
      else if (deco[i] != null && ownedDeco.has(deco[i])) deco[i] = null;
    }
    for (const s of stampGround) ground[s.index] = s.id;
    for (const s of stampDeco) deco[s.index] = s.id;
    const og = layers.ground || [], od = layers.deco || [];
    for (let i = 0; i < n; i++) {
      const g0 = og[i] === undefined ? null : og[i], d0 = od[i] === undefined ? null : od[i];
      if (g0 !== ground[i] || d0 !== deco[i]) changed.push(i);
    }
    return { ground, deco, changed };
  };

  /**
   * rulesFromTemplate({ groupId, terrain, tiles:{ center, n, s, e, w, ne, nw, se, sw, innerNE, innerNW, innerSE, innerSW }, against, layer })
   * -> AutoGroup. The "wizard": one rule per provided tile, most specific first (inner corners,
   * corners, edges, centre). `against` = a terrain id the edges face (default 'any' = any other terrain).
   */
  T.rulesFromTemplate = function (opts) {
    const t = opts.terrain;
    const tiles = opts.tiles || {};
    const OUT = (opts.against == null || opts.against === 'any') ? -t : opts.against;
    // pattern index: 0 nw 1 n 2 ne 3 w 4 c 5 e 6 sw 7 s 8 se
    const P = (spec) => { const p = [0, 0, 0, 0, t, 0, 0, 0, 0]; for (const k of Object.keys(spec)) p[k] = spec[k]; return p; };
    const order = [
      ['innerNE', P({ 1: t, 5: t, 2: OUT })], ['innerNW', P({ 1: t, 3: t, 0: OUT })],
      ['innerSE', P({ 7: t, 5: t, 8: OUT })], ['innerSW', P({ 7: t, 3: t, 6: OUT })],
      ['ne', P({ 1: OUT, 5: OUT })], ['nw', P({ 1: OUT, 3: OUT })], ['se', P({ 7: OUT, 5: OUT })], ['sw', P({ 7: OUT, 3: OUT })],
      ['n', P({ 1: OUT })], ['s', P({ 7: OUT })], ['e', P({ 5: OUT })], ['w', P({ 3: OUT })],
      ['center', P({})],
    ];
    const rules = [];
    for (const [key, pattern] of order) {
      if (tiles[key] == null) continue;
      rules.push({ size: 3, pattern, tiles: [tiles[key]], mode: 'single', chance: 1, breakOnMatch: true, flip: 'none', outOfBounds: null, modulo: { x: 1, y: 1, ox: 0, oy: 0 }, note: key });
    }
    return { id: opts.groupId || `terrain-${t}`, name: opts.name || `Terrain ${t}`, active: true, terrain: t, layer: opts.layer || 'ground', rules };
  };

  /**
   * remapGroup(group, fromTerrain, toTerrain, tileMap, newId?) -> a new group for another terrain:
   * pattern values ±fromTerrain become ±toTerrain and tile ids are looked up in tileMap (missing ids are kept).
   */
  T.remapGroup = function (group, fromTerrain, toTerrain, tileMap, newId) {
    const g = KIT.deepClone(group);
    g.id = newId || `${group.id}-${toTerrain}`;
    if (g.terrain === fromTerrain) g.terrain = toTerrain;
    if (g.name) g.name = `${g.name} (${toTerrain})`;
    const map = tileMap || {};
    const remapTiles = (list) => list ? list.map(id => (typeof id === 'string' && map[id] != null ? map[id] : id)) : list;
    for (const r of g.rules || []) {
      r.pattern = (r.pattern || []).map(v => (v === fromTerrain ? toTerrain : v === -fromTerrain ? -toTerrain : v));
      if (r.outOfBounds === fromTerrain) r.outOfBounds = toTerrain;
      r.tiles = remapTiles(r.tiles); r.tilesX = remapTiles(r.tilesX); r.tilesY = remapTiles(r.tilesY); r.tilesXY = remapTiles(r.tilesXY);
      for (const k of ['tilesX', 'tilesY', 'tilesXY']) if (r[k] === undefined) delete r[k];
    }
    return g;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
