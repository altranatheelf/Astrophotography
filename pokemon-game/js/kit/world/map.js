// MapView (§8.2): the map as the runtime sees it — the authored map composed
// with the save's overlay (player-made changes), plus every spatial question
// the systems ask: what is here, can I walk there, which page of this object is
// active. Pure: no DOM, no canvas. The renderer and the systems read it.
//
//   const view = KIT.mapView(project, save, 'town')
//   view.passable(4, 5, 'down', hero) -> { ok, reason, hop:{x,y}, connection }
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const T = KIT.tiles;

  const DIRS = { up: { dx: 0, dy: -1, edge: 'n' }, down: { dx: 0, dy: 1, edge: 's' }, left: { dx: -1, dy: 0, edge: 'w' }, right: { dx: 1, dy: 0, edge: 'e' } };
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const EDGE_OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' };
  const SIDE_OF = { up: 'n', down: 's', left: 'w', right: 'e' };
  KIT.DIRS = DIRS; KIT.OPPOSITE = OPPOSITE;
  /** delta(dir) -> { dx, dy } */
  KIT.delta = (dir) => DIRS[dir] || { dx: 0, dy: 0 };

  const isObj = KIT.isObject;
  const LAYERS = ['ground', 'deco', 'above'];
  const EMPTY = Object.freeze({});      // stood in for a missing overlay or object table
  const EMPTY_LIST = Object.freeze([]);

  /**
   * mapView(project, save, mapId) -> view
   * `save` may be null (editor preview): then there is no overlay and no object state.
   */
  /**
   * mapView(project, save, mapId, opts) — the map as the runtime sees it.
   * opts.dimension names a layer of reality declared on the map (map.dimensions):
   * the same place, otherwise. A dimension changes tiles, hides or reveals objects,
   * and can bring its own light and music; everything else about the map is shared,
   * so the two never drift apart.
   */
  KIT.mapView = function mapView(project, save, mapId, opts) {
    const map = project && project.maps ? project.maps[mapId] : null;
    if (!map) throw new Error(`mapView: unknown map '${mapId}'`);
    // Everything the SAVE says about this map is read when it is asked for, never
    // captured here. The player is standing in the map they are changing — put a
    // rug down, open a door, shift to another layer of reality — and a view that
    // had closed over the old save would go on showing the room they left. Read
    // live and that trap cannot be stepped in.
    const pinned = (opts && opts.dimension !== undefined) ? { name: opts.dimension || null } : null;
    const dimNameNow = () => (pinned ? pinned.name : ((save && save.dimension) || null));
    const dimNow = () => { const n = dimNameNow(); return (n && map.dimensions && map.dimensions[n]) || null; };
    const dimTilesNow = () => { const d = dimNow(); return (d && d.tiles) || null; };
    const dimObjectsNow = () => { const d = dimNow(); return (d && d.objects) || null; };
    const overlayNow = () => (save && save.overlays && save.overlays[mapId]) || null;
    const objectStateNow = () => (save && save.objects) || EMPTY;
    const width = map.width, height = map.height;

    const index = (x, y) => y * width + x;
    const inBounds = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
    const overlayCell = (x, y) => { const o = overlayNow(); return o && o.tiles ? o.tiles[`${x},${y}`] : null; };

    /** The tile id on a layer, overlay first. `null` = nothing on that layer. */
    function tileAt(layer, x, y) {
      if (!inBounds(x, y)) return null;
      const o = overlayCell(x, y);
      if (o && Object.prototype.hasOwnProperty.call(o, layer)) return o[layer];
      const dimTiles = dimTilesNow();
      if (dimTiles) {
        const d = dimTiles[`${x},${y}`];
        if (d && Object.prototype.hasOwnProperty.call(d, layer)) return d[layer];
      }
      const arr = map.layers && map.layers[layer];
      return arr ? (arr[index(x, y)] == null ? null : arr[index(x, y)]) : null;
    }
    function terrainAt(x, y) { return inBounds(x, y) ? ((map.layers.terrain && map.layers.terrain[index(x, y)]) || 0) : 0; }
    function region(x, y) { return inBounds(x, y) ? ((map.layers.regions && map.layers.regions[index(x, y)]) || 0) : 0; }
    function collisionAt(x, y) {
      if (!inBounds(x, y)) return null;
      const o = overlayCell(x, y);
      if (o && Object.prototype.hasOwnProperty.call(o, 'collision')) return o.collision;
      const dimTiles = dimTilesNow();
      if (dimTiles) {
        const d = dimTiles[`${x},${y}`];
        if (d && Object.prototype.hasOwnProperty.call(d, 'collision')) return d.collision;
      }
      return map.collision ? (map.collision[index(x, y)] == null ? null : map.collision[index(x, y)]) : null;
    }

    /**
     * bushAt(x, y) -> is any layer of this cell a bush?
     *
     * The narrow question the renderer asks for every character on every frame.
     * It used to ask `flagsAt`, which builds the whole merged answer — an object,
     * a passage object, a tiles array, and three `T.flags` calls that each do
     * two Object.assigns — to read one boolean out of it. At 1,600 characters
     * that was on the order of twenty thousand allocations a frame for nothing.
     * This walks the layers and reads the flag off the definition.
     */
    function bushAt(x, y) {
      if (!inBounds(x, y)) return false;
      for (const layer of LAYERS) {
        const id = tileAt(layer, x, y);
        if (id == null) continue;
        const d = T.def(id);
        if (d && d.bush) return true;
      }
      return false;
    }

    /** Merged tile flags for a cell: any solid layer makes it solid; passage closes if any layer closes it; bush/counter/encounter/ledge from any layer. */
    function flagsAt(x, y) {
      const out = { solid: false, bush: false, counter: false, encounter: false, ledge: null, warpLook: false, terrainTag: 0, passage: { n: true, s: true, e: true, w: true }, tiles: [] };
      if (!inBounds(x, y)) { out.solid = true; return out; }
      for (const layer of LAYERS) {
        const id = tileAt(layer, x, y);
        if (id == null) continue;
        const f = T.flags(id);
        out.tiles.push(id);
        if (f.solid) out.solid = true;
        if (f.bush) out.bush = true;
        if (f.counter) out.counter = true;
        if (f.encounter) out.encounter = true;
        if (f.ledge) out.ledge = f.ledge;
        if (f.warpLook) out.warpLook = true;
        if (f.terrainTag) out.terrainTag = f.terrainTag;
        for (const e of ['n', 's', 'e', 'w']) if (f.passage && f.passage[e] === false) out.passage[e] = false;
      }
      const c = collisionAt(x, y);
      if (c === 1) out.solid = true;
      else if (c === 0) { out.solid = false; out.passage = { n: true, s: true, e: true, w: true }; }
      else if (typeof c === 'string' && out.passage[c] !== undefined) out.passage[c] = false;
      return out;
    }

    /** A map connection leaving this cell in `dir`, or null. -> { map, x, y, dir } */
    function connectionAt(x, y, dir) {
      const conns = (project.world && project.world.connections) || [];
      const side = SIDE_OF[dir];
      if (!side) return null;
      const atEdge = (side === 'n' && y === 0) || (side === 's' && y === height - 1) || (side === 'w' && x === 0) || (side === 'e' && x === width - 1);
      if (!atEdge) return null;
      for (const c of conns) {
        let other = null, otherSide = null, offset = c.offset || 0;
        if (c.a === mapId && c.side === side) { other = c.b; otherSide = EDGE_OPPOSITE[side]; }
        else if (c.b === mapId && EDGE_OPPOSITE[c.side] === side) { other = c.a; otherSide = c.side; offset = -offset; }
        if (!other) continue;
        const om = project.maps[other];
        if (!om) continue;
        // The same offset along the shared edge; `offset` shifts the neighbour.
        let nx, ny;
        if (side === 'n' || side === 's') { nx = x - offset; ny = otherSide === 'n' ? 0 : om.height - 1; }
        else { ny = y - offset; nx = otherSide === 'w' ? 0 : om.width - 1; }
        if (nx < 0 || ny < 0 || nx >= om.width || ny >= om.height) continue;
        return { map: other, x: nx, y: ny, dir };
      }
      return null;
    }

    // ---- objects -------------------------------------------------------------
    // The authored objects plus any the save has added. Always a copy — a system
    // may put something on the map for the length of a visit (mons puts the
    // creatures you own into the garden), and the authored map must not learn
    // about it. Recomputed only when one of the two lists is replaced, so it is
    // the same array from one frame to the next and those additions survive.
    let objectsMemo = null, memoFrom = null, memoLen = -1;
    function objectsNow() {
      const extra = (overlayNow() || EMPTY).objects || null;
      const authored = map.objects || EMPTY_LIST;
      if (objectsMemo && extra === memoFrom && authored.length === memoLen) return objectsMemo;
      memoFrom = extra; memoLen = authored.length;
      objectsMemo = extra && extra.length ? authored.concat(extra) : authored.slice();
      return objectsMemo;
    }
    const key = (objOrId) => `${mapId}:${typeof objOrId === 'string' ? objOrId : objOrId.id}`;
    const stateOf = (objOrId) => objectStateNow()[key(objOrId)] || null;
    const isHidden = (obj) => {
      const dimObjects = dimObjectsNow();
      const d = dimObjects && dimObjects[obj.id];
      if (d && d.hidden !== undefined) return !!d.hidden;      // this layer of reality decides
      const s = stateOf(obj);
      return !!(s && s.hidden);
    };
    /** Where the object is right now (a moved object remembers its place in the save). */
    function positionOf(obj) {
      const s = stateOf(obj);
      return { x: s && s.x != null ? s.x : obj.x, y: s && s.y != null ? s.y : obj.y, dir: (s && s.dir) || null };
    }
    /** The LAST page whose `when` passes (RPG Maker order), or null when none does. */
    function activePage(obj, ctx) {
      const pages = obj.pages || [];
      const c = Object.assign({}, ctx || {}, { self: key(obj), world: (ctx && ctx.world) || { save: save || {} } });
      for (let i = pages.length - 1; i >= 0; i--) {
        if (KIT.conditions.test(pages[i].when, c)) return { page: pages[i], index: i };
      }
      return null;
    }
    function objectsAt(x, y) {
      const out = [];
      for (const o of objectsNow()) { const p = positionOf(o); if (p.x === x && p.y === y) out.push(o); }
      return out;
    }

    // ---- passability ---------------------------------------------------------
    /**
     * passable(x, y, dir, who) -> { ok, reason, to:{x,y}, hop, connection }
     * Asks "may `who` step from (x, y) in `dir`?" — the answer includes a ledge hop
     * or a map connection when that is what happens instead of a plain step.
     */
    function passable(x, y, dir, who) {
      const d = DIRS[dir];
      if (!d) return { ok: false, reason: 'direction' };
      const nx = x + d.dx, ny = y + d.dy;
      const through = !!(who && who.through);
      if (!inBounds(nx, ny)) {
        const conn = connectionAt(x, y, dir);
        if (conn) return { ok: true, reason: 'connection', to: { x: nx, y: ny }, connection: conn };
        return { ok: false, reason: 'edge' };
      }
      if (through) return { ok: true, reason: 'through', to: { x: nx, y: ny } };
      const here = flagsAt(x, y), there = flagsAt(nx, ny);
      if (here.passage[d.edge] === false) return { ok: false, reason: 'edge-out' };
      if (there.passage[EDGE_OPPOSITE[d.edge]] === false) return { ok: false, reason: 'edge-in' };
      // Ledges: a 'down' ledge may only be entered from the north, and then you hop over it.
      if (there.ledge) {
        if (there.ledge !== dir) return { ok: false, reason: 'ledge' };
        const hx = nx + d.dx, hy = ny + d.dy;
        if (!inBounds(hx, hy) || flagsAt(hx, hy).solid) return { ok: false, reason: 'ledge-blocked' };
        if (blockedByEntity(hx, hy, who)) return { ok: false, reason: 'entity' };
        return { ok: true, reason: 'hop', to: { x: nx, y: ny }, hop: { x: hx, y: hy } };
      }
      if (there.solid) return { ok: false, reason: 'tile' };
      if (blockedByEntity(nx, ny, who)) return { ok: false, reason: 'entity' };
      return { ok: true, reason: 'step', to: { x: nx, y: ny } };
    }
    /** Solid entities (set by the world each tick) block movement. */
    let blockers = [];
    function blockedByEntity(x, y, who) {
      for (const e of blockers) {
        if (e === who || !e.solid || e.through || e.visible === false) continue;
        if (e.x === x && e.y === y) return true;
        if (e.mover && e.mover.moving && e.mover.toX === x && e.mover.toY === y) return true;   // reserve the tile being walked into
      }
      return false;
    }
    function hopTarget(x, y, dir) { const r = passable(x, y, dir, null); return r.hop || null; }

    /** The tile a hero facing `dir` at (x,y) interacts with — one step ahead, or two across a counter. */
    function interactTarget(x, y, dir) {
      const d = DIRS[dir];
      if (!d) return null;
      const first = { x: x + d.dx, y: y + d.dy };
      if (!inBounds(first.x, first.y)) return null;
      if (flagsAt(first.x, first.y).counter) {
        const second = { x: first.x + d.dx, y: first.y + d.dy };
        if (inBounds(second.x, second.y)) return { first, second, across: true };
      }
      return { first, second: null, across: false };
    }

    return {
      id: mapId, map, project, save, width, height, kind: map.kind,
      get dimension() { return dimNameNow(); },
      dimensions: map.dimensions ? Object.keys(map.dimensions) : [],
      get music() { const d = dimNow(); return (d && d.music) || map.music; },
      get atmosphere() { const d = dimNow(); return (d && d.atmosphere) || (map.props && map.props.atmosphere) || null; },
      index, inBounds, tileAt, terrainAt, region, collisionAt, flagsAt, bushAt, passable, hopTarget, connectionAt, interactTarget,
      get objects() { return objectsNow(); },
      objectsAt, objectKey: key, objectState: stateOf, isHidden, activePage, positionOf,
      setBlockers(list) { blockers = list || []; },
      get blockers() { return blockers; },
      /** Cells whose drawn tiles changed since the map was authored (for the renderer's cache). */
      overlayCells() { const o = overlayNow(); return o && o.tiles ? Object.keys(o.tiles).map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; }) : []; },
    };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
