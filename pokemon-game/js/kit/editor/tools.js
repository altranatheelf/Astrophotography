// Creator Mode — the map tools (contract: docs/EDITOR-CONTRACT.md §Tools).
//
// Nine tools, in the order they appear in the toolbar: Pencil, Fill, Rectangle,
// Eraser, Eyedropper, Stamp, Terrain brush, Select/Move and Hand. Every one of
// them respects `ED.state.layer` (terrain/ground/deco/above/regions/collision)
// and paints `ED.state.tile` — a tile id on the tile layers, a number on
// terrain/regions, one of the collision values on collision.
//
// Two rules shape the code below:
//   * A stroke is ONE undo step. A tool collects the cells it is going to paint
//     while the finger is down and draws them as a ghost in preview(); the
//     document is written once, in end(), inside ED.commit.
//   * Nothing is drag-only. Every tool works as tap (rectangle and select are
//     tap-then-tap), so a thumb can do everything a mouse can.
//
// The pure parts (line, rectangle, flood, the collision cycle) live on
// KIT.editor.tools and are tested headless in test/kit/editor-tools.test.js.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const ED = KIT.editor = KIT.editor || {};
  const T = ED.tools = ED.tools || {};

  const TILE_LAYERS = ['ground', 'deco', 'above'];
  const NUMBER_LAYERS = ['terrain', 'regions'];

  // ---------------------------------------------------------------------------
  // Pure helpers (no DOM, no document) — tested directly.
  // ---------------------------------------------------------------------------

  /** line(x0,y0,x1,y1) -> every cell from one to the other, both ends included (Bresenham). */
  T.line = function (x0, y0, x1, y1) {
    const cells = [];
    let x = Math.round(x0), y = Math.round(y0);
    const ex = Math.round(x1), ey = Math.round(y1);
    const dx = Math.abs(ex - x), dy = Math.abs(ey - y);
    const sx = x < ex ? 1 : -1, sy = y < ey ? 1 : -1;
    let err = dx - dy;
    const guard = (dx + dy) * 2 + 4;
    for (let i = 0; i < guard; i++) {
      cells.push({ x, y });
      if (x === ex && y === ey) break;
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
    return cells;
  };

  /** rectCells(x0,y0,x1,y1,{ outline }) -> the cells of the rectangle between two corners. */
  T.rectCells = function (x0, y0, x1, y1, opts) {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1);
    const ay = Math.min(y0, y1), by = Math.max(y0, y1);
    const out = [];
    for (let y = ay; y <= by; y++) {
      for (let x = ax; x <= bx; x++) {
        if (opts && opts.outline && x !== ax && x !== bx && y !== ay && y !== by) continue;
        out.push({ x, y });
      }
    }
    return out;
  };

  /** Two cell values are "the same colour" for the fill (null and undefined both mean empty). */
  T.sameValue = function (a, b) {
    if (a == null && b == null) return true;
    return a === b;
  };

  /** How many cells a fill preview is allowed to walk before it gives up and says "lots". */
  T.FLOOD_CAP = 3000;

  /**
   * floodCells({ width, height, at(x,y) }, x, y, { cap }) -> { cells, capped, from }
   * The 4-way flood the Fill tool would paint, stopped at `cap` cells so the ghost
   * stays cheap on a big map. `capped` is true when there was more to walk.
   */
  T.floodCells = function (grid, x, y, opts) {
    const cap = Math.max(1, (opts && opts.cap) || T.FLOOD_CAP);
    const cells = [], seen = new Set();
    if (!grid || x < 0 || y < 0 || x >= grid.width || y >= grid.height) return { cells, capped: false, from: undefined };
    const from = grid.at(x, y);
    const stack = [[x, y]];
    let capped = false;
    while (stack.length) {
      if (cells.length >= cap) { capped = true; break; }
      const c = stack.pop();
      const cx = c[0], cy = c[1];
      if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) continue;
      const i = cy * grid.width + cx;
      if (seen.has(i)) continue;
      if (!T.sameValue(grid.at(cx, cy), from)) continue;
      seen.add(i);
      cells.push({ x: cx, y: cy });
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    return { cells, capped, from };
  };

  /**
   * The collision layer's values, in the order the Collision palette shows them and
   * the order Alt-tapping cycles through. `value` is what the map stores.
   */
  T.COLLISION = [
    { value: null, label: 'Leave it to the tiles', short: '·', color: 'rgba(255,255,255,0.18)', help: 'No override: grass walks, walls block.' },
    { value: 0, label: 'Walkable', short: '✓', color: 'rgba(80,200,120,0.55)', help: 'Always walkable, whatever the tile underneath says.' },
    { value: 1, label: 'Solid', short: '✕', color: 'rgba(220,60,60,0.55)', help: 'Nothing can walk here.' },
    { value: 'n', label: 'No crossing the top edge', short: '↑', color: 'rgba(240,180,60,0.6)', help: 'A fence along the top of this square: nobody steps over it either way.' },
    { value: 's', label: 'No crossing the bottom edge', short: '↓', color: 'rgba(240,180,60,0.6)', help: 'A fence along the bottom of this square.' },
    { value: 'e', label: 'No crossing the right edge', short: '→', color: 'rgba(240,180,60,0.6)', help: 'A fence down the right side of this square.' },
    { value: 'w', label: 'No crossing the left edge', short: '←', color: 'rgba(240,180,60,0.6)', help: 'A fence down the left side of this square.' },
    // Tall grass used to be a property of one tile in the kit's own art, so a
    // tileset found online could never roll an encounter. It is a square now.
    { value: 'g', label: 'Tall grass — wild encounters', short: '~', color: 'rgba(120,220,110,0.6)', help: 'Walkable, and a step here can roll this map’s encounter table (Map › Encounters) — over any tile, from any tileset.' },
  ];
  T.collisionAt = function (value) {
    for (const c of T.COLLISION) if (T.sameValue(c.value, value)) return c;
    return T.COLLISION[0];
  };
  /** collisionCycle(v) -> the next collision value round the ring (… → solid → the four edges → none → …). */
  T.collisionCycle = function (value) {
    let i = -1;
    for (let k = 0; k < T.COLLISION.length; k++) if (T.sameValue(T.COLLISION[k].value, value)) { i = k; break; }
    return T.COLLISION[(i + 1 + T.COLLISION.length) % T.COLLISION.length].value;
  };

  /** The value a layer remembers between visits, so switching layers keeps your brush. */
  T.remembered = { ground: null, deco: null, above: null, terrain: 1, regions: 1, collision: 1 };
  T.remember = function (layer, value) { T.remembered[layer] = value; return value; };
  /** A sensible brush value for a layer (used when the author switches layers). */
  T.brushFor = function (layer) {
    const v = T.remembered[layer];
    if (v !== undefined && v !== null) return v;
    if (NUMBER_LAYERS.includes(layer)) return 1;
    if (layer === 'collision') return 1;
    const first = KIT.registry.exists('tiles') ? (KIT.registry('tiles').list()[0] || null) : null;
    return first ? first.id : null;
  };

  /**
   * fitScale({ stageW, stageH, mapW, mapH, tileSize, minTile }) -> the zoom (1..8) that
   * shows a whole map without making the squares too small to hit with a thumb.
   * Pure, so the "does the map fit when it opens" rule is tested without a browser.
   */
  T.fitScale = function (o) {
    const size = (o && o.tileSize) || 16;
    const stageW = Math.max(0, (o && o.stageW) || 0), stageH = Math.max(0, (o && o.stageH) || 0);
    const mapW = Math.max(1, (o && o.mapW) || 1), mapH = Math.max(1, (o && o.mapH) || 1);
    if (!stageW || !stageH) return 1;
    const fit = Math.min(stageW / (mapW * size), stageH / (mapH * size));
    const smallest = Math.max(1, Math.ceil(((o && o.minTile) || 0) / size));
    return Math.max(smallest, Math.min(8, Math.floor(fit) || 1));
  };

  // ---------------------------------------------------------------------------
  // Writing to the document — every path goes through ED.commit / KIT.editor.ops,
  // so one stroke is one undo step and autosave/validation follow.
  // ---------------------------------------------------------------------------

  const ERASE = T.ERASE = { erase: true };

  /** The value `layer` should hold when the author paints `tile` (ERASE = "rub it out"). */
  function valueFor(ed, layer, tile) {
    if (tile !== ERASE) {
      // The layer may have been switched under us (the shell's [ and ] keys do that),
      // so make sure the value fits the layer it is about to land in.
      if (NUMBER_LAYERS.includes(layer)) return Math.max(0, Math.round(Number(tile) || 0));
      if (layer === 'collision') return T.COLLISION.some(c => T.sameValue(c.value, tile)) ? tile : null;
      return typeof tile === 'string' ? tile : null;
    }
    if (layer === 'collision') return null;
    if (NUMBER_LAYERS.includes(layer)) return 0;
    if (layer === 'ground') {
      const m = ed.state.project.maps[ed.state.mapId];
      return (KIT.project.GROUND_BY_KIND && KIT.project.GROUND_BY_KIND[m.kind]) || 'grass';
    }
    return null;
  }

  /**
   * paintCells(ed, cells, value, label) — the one door every tool paints through.
   * Terrain goes through ops.terrain (which re-bakes the autotiles around the stroke),
   * collision writes the override array, everything else is ops.paint.
   */
  T.paintCells = function (ed, cells, tile, label) {
    const st = ed.state;
    if (!cells || !cells.length) return 0;
    const layer = st.layer;
    const value = valueFor(ed, layer, tile);
    const mapId = st.mapId;
    if (layer === 'collision') {
      return ed.commit(label || 'Collision', (doc) => {
        const m = doc.get(['maps', mapId]);
        const ops = [], seen = new Set();
        for (const c of cells) {
          if (c.x < 0 || c.y < 0 || c.x >= m.width || c.y >= m.height) continue;
          const i = c.y * m.width + c.x;
          if (seen.has(i)) continue;
          seen.add(i);
          const now = m.collision[i] == null ? null : m.collision[i];
          if (T.sameValue(now, value)) continue;
          ops.push({ op: 'set', path: ['maps', mapId, 'collision', i], value });
        }
        if (ops.length) doc.apply(ops, { label: label || 'Collision' });
        return ops.length;
      });
    }
    if (layer === 'terrain') {
      const terrain = Number(value) || 0;
      return ed.commit(label || 'Terrain brush', (doc, ops) => ops.terrain(doc, { map: mapId, cells, terrain, label: label || 'Terrain brush' }));
    }
    return ed.commit(label || 'Paint', (doc, ops) => ops.paint(doc, { map: mapId, layer, cells, tile: value, label: label || 'Paint' }));
  };

  /** What is on `layer` at (x,y) right now — the eyedropper and the fill both ask this. */
  T.valueAt = function (ed, x, y, layer) {
    const st = ed.state;
    const m = st.project.maps[st.mapId];
    if (!m || x < 0 || y < 0 || x >= m.width || y >= m.height) return null;
    const i = y * m.width + x;
    if (layer === 'collision') return m.collision[i] == null ? null : m.collision[i];
    const arr = m.layers[layer];
    return arr ? (arr[i] == null ? null : arr[i]) : null;
  };
  /** The grid the flood fill walks (the current layer of the current map). */
  T.gridFor = function (ed, layer) {
    const st = ed.state;
    const m = st.project.maps[st.mapId];
    return { width: m.width, height: m.height, at: (x, y) => T.valueAt(ed, x, y, layer) };
  };

  // ---------------------------------------------------------------------------
  // Drawing the ghost (preview). The overlay context is already translated to the
  // map's top-left corner; one tile is `px` screen pixels.
  // ---------------------------------------------------------------------------

  function tileArt(id) {
    if (!id || !KIT.registry.exists('tiles')) return null;
    const def = KIT.registry('tiles').get(id);
    return def ? (KIT.pixels.artOf(def) || def) : null;
  }
  /** Draw the tile (or the terrain/region/collision colour) that a cell is about to become. */
  T.drawGhostCell = function (ctx, ed, x, y, px, tile) {
    const layer = ed.state.layer;
    const value = valueFor(ed, layer, tile);
    if (layer === 'collision') {
      const c = T.collisionAt(value);
      ctx.fillStyle = c.color;
      ctx.fillRect(x * px, y * px, px, px);
      if (px >= 18) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = `${Math.max(9, Math.floor(px * 0.5))}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(c.short, x * px + px / 2, y * px + px / 2);
      }
      return;
    }
    if (NUMBER_LAYERS.includes(layer)) {
      const n = Number(value) || 0;
      ctx.fillStyle = n ? (layer === 'terrain' ? terrainColor(ed, n) : regionColor(n)) : 'rgba(255,255,255,0.15)';
      ctx.globalAlpha = 0.65;
      ctx.fillRect(x * px, y * px, px, px);
      ctx.globalAlpha = 1;
      if (px >= 16) {
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.font = `${Math.max(8, Math.floor(px * 0.42))}px monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(n), x * px + px / 2, y * px + px / 2);
      }
      return;
    }
    const art = tileArt(value);
    if (art) {
      ctx.imageSmoothingEnabled = false;
      try { KIT.pixels.draw(ctx, art, x * px, y * px, { fit: { w: px, h: px } }); }
      catch (e) { ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(x * px, y * px, px, px); }
    } else {
      ctx.fillStyle = 'rgba(20,24,34,0.55)';                  // "nothing here" (an erase)
      ctx.fillRect(x * px, y * px, px, px);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x * px + 3, y * px + 3); ctx.lineTo(x * px + px - 3, y * px + px - 3);
      ctx.moveTo(x * px + px - 3, y * px + 3); ctx.lineTo(x * px + 3, y * px + px - 3);
      ctx.stroke();
    }
  };
  function terrainColor(ed, n) {
    const t = (ed.state.project.terrains || []).find(t => t.id === n);
    return t ? t.color : '#ffc850';
  }
  function regionColor(n) {
    const h = (n * 47) % 360;
    return `hsl(${h}, 70%, 60%)`;
  }
  T.terrainColor = terrainColor;
  T.regionColor = regionColor;

  /** Draw a line round the outside of a group of cells (the edges with no neighbour). */
  T.outlineArea = function (ctx, cells, px, color) {
    const set = new Set(cells.map(c => c.x + ',' + c.y));
    ctx.save();
    ctx.strokeStyle = color || '#6cf';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const c of cells) {
      const x = c.x * px, y = c.y * px;
      if (!set.has((c.x) + ',' + (c.y - 1))) { ctx.moveTo(x, y + 1); ctx.lineTo(x + px, y + 1); }
      if (!set.has((c.x) + ',' + (c.y + 1))) { ctx.moveTo(x, y + px - 1); ctx.lineTo(x + px, y + px - 1); }
      if (!set.has((c.x - 1) + ',' + (c.y))) { ctx.moveTo(x + 1, y); ctx.lineTo(x + 1, y + px); }
      if (!set.has((c.x + 1) + ',' + (c.y))) { ctx.moveTo(x + px - 1, y); ctx.lineTo(x + px - 1, y + px); }
    }
    ctx.stroke();
    ctx.restore();
  };

  function outline(ctx, cells, px, color) {
    ctx.strokeStyle = color || '#ffffff';
    ctx.lineWidth = 2;
    for (const c of cells) ctx.strokeRect(c.x * px + 1, c.y * px + 1, px - 2, px - 2);
  }

  // ---------------------------------------------------------------------------
  // The tools.
  // ---------------------------------------------------------------------------
  const reg = KIT.registry('editorTools');
  const inMap = (ed, x, y) => {
    const m = ed.state.map;
    return m && x >= 0 && y >= 0 && x < m.width && y < m.height;
  };
  /** Every cell between the last pointer cell and this one, so a fast drag has no gaps. */
  function trail(from, pt) {
    if (!from) return [{ x: pt.tx, y: pt.ty }];
    return T.line(from.x, from.y, pt.tx, pt.ty);
  }

  // 1 — Pencil -----------------------------------------------------------------
  const pencil = {
    id: 'pencil', label: 'Pencil', icon: '✏️', key: '1', order: 10, cursor: 'crosshair',
    cells: [], last: null, lastPainted: null, drawing: false,
    begin(pt, ed) {
      if (pt.alt) { eyedropper.begin(pt, ed); return; }              // alt picks, like every paint program
      this.drawing = true;
      this.cells = [];
      if (pt.shift && this.lastPainted) this.add(T.line(this.lastPainted.x, this.lastPainted.y, pt.tx, pt.ty), ed);
      else this.add([{ x: pt.tx, y: pt.ty }], ed);
      this.last = { x: pt.tx, y: pt.ty };
      ed.repaint();
    },
    move(pt, ed) {
      if (!this.drawing) return;
      this.add(trail(this.last, pt), ed);
      this.last = { x: pt.tx, y: pt.ty };
      ed.repaint();
    },
    end(pt, ed) {
      if (!this.drawing) return;
      this.drawing = false;
      this.lastPainted = { x: pt.tx, y: pt.ty };
      const cells = this.cells;
      this.cells = [];
      T.paintCells(ed, cells, ed.state.tile, 'Pencil');
    },
    cancel() { this.drawing = false; this.cells = []; },
    add(cells, ed) {
      for (const c of cells) {
        if (!inMap(ed, c.x, c.y)) continue;
        if (!this.cells.some(o => o.x === c.x && o.y === c.y)) this.cells.push({ x: c.x, y: c.y });
      }
    },
    preview(ctx, ed, px) {
      const st = ed.state;
      const cells = this.drawing ? this.cells : [{ x: st.cursor.x, y: st.cursor.y }];
      ctx.save();
      ctx.globalAlpha = this.drawing ? 0.95 : 0.6;
      for (const c of cells) T.drawGhostCell(ctx, ed, c.x, c.y, px, st.tile);
      ctx.globalAlpha = 1;
      if (!this.drawing && this.lastPainted) outline(ctx, [this.lastPainted], px, 'rgba(120,200,255,0.35)');   // hold Shift to draw a line from here
      ctx.restore();
    },
  };

  // 2 — Fill --------------------------------------------------------------------
  const fill = {
    id: 'fill', label: 'Fill', icon: '🪣', key: '2', order: 20, cursor: 'crosshair',
    at: null, result: null,
    begin(pt, ed) {
      if (pt.alt) { eyedropper.begin(pt, ed); return; }
      this.at = { x: pt.tx, y: pt.ty };
      this.result = T.floodCells(T.gridFor(ed, ed.state.layer), pt.tx, pt.ty, {});
      ed.repaint();
    },
    move(pt, ed) {
      if (!this.at || (this.at.x === pt.tx && this.at.y === pt.ty)) return;
      this.begin(pt, ed);                                            // slide to another puddle before you lift
    },
    end(pt, ed) {
      if (!this.at) return;
      const at = this.at;
      this.at = null; this.result = null;
      if (!inMap(ed, at.x, at.y)) return;
      const st = ed.state;
      if (st.layer === 'terrain' || st.layer === 'collision') {       // no ops.fill for these two: flood, then paint
        const flood = T.floodCells(T.gridFor(ed, st.layer), at.x, at.y, { cap: st.map.width * st.map.height });
        T.paintCells(ed, flood.cells, st.tile, 'Fill');
        return;
      }
      const value = valueFor(ed, st.layer, st.tile);
      ed.commit('Fill', (doc, ops) => ops.fill(doc, { map: st.mapId, layer: st.layer, x: at.x, y: at.y, tile: value }));
    },
    cancel() { this.at = null; this.result = null; },
    preview(ctx, ed, px) {
      const st = ed.state;
      const r = this.result || T.floodCells(T.gridFor(ed, st.layer), st.cursor.x, st.cursor.y, { cap: 900 });
      ctx.save();
      // Pressed: the real thing, solid. Merely hovering over a big puddle: a wash and a
      // bright edge round it, so the map underneath stays readable.
      const big = !this.result && r.cells.length > 40;
      ctx.globalAlpha = this.result ? 0.9 : (big ? 0.22 : 0.45);
      for (const c of r.cells) T.drawGhostCell(ctx, ed, c.x, c.y, px, st.tile);
      ctx.globalAlpha = 1;
      if (big) T.outlineArea(ctx, r.cells, px, 'rgba(120,200,255,0.9)');
      if (r.capped && r.cells.length) {
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(st.cursor.x * px, st.cursor.y * px - 18, 96, 16);
        ctx.fillStyle = '#fff';
        ctx.font = '12px system-ui, sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText('…and more', st.cursor.x * px + 6, st.cursor.y * px - 10);
      }
      ctx.restore();
    },
  };

  // 3 — Rectangle ----------------------------------------------------------------
  const rect = {
    id: 'rect', label: 'Rectangle', short: 'Rect', icon: '▭', key: '3', order: 30, cursor: 'crosshair',
    anchor: null, to: null, dragging: false, outlineOnly: false,
    begin(pt, ed) {
      if (pt.alt) { eyedropper.begin(pt, ed); return; }
      if (!this.anchor) { this.anchor = { x: pt.tx, y: pt.ty }; this.dragging = true; }
      this.to = { x: pt.tx, y: pt.ty };
      ed.repaint();
    },
    move(pt, ed) {
      if (!this.anchor) return;
      this.to = { x: pt.tx, y: pt.ty };
      ed.repaint();
    },
    end(pt, ed) {
      if (!this.anchor) return;
      const a = this.anchor, b = { x: pt.tx, y: pt.ty };
      const single = a.x === b.x && a.y === b.y;
      if (single && this.dragging) {                                  // tap once: drop a corner, tap again to finish
        this.dragging = false;
        this.to = b;
        ed.repaint();
        return;
      }
      this.anchor = null; this.to = null; this.dragging = false;
      const cells = T.rectCells(a.x, a.y, b.x, b.y, { outline: this.outlineOnly }).filter(c => inMap(ed, c.x, c.y));
      T.paintCells(ed, cells, ed.state.tile, 'Rectangle');
    },
    cancel() { this.anchor = null; this.to = null; this.dragging = false; },
    preview(ctx, ed, px) {
      const st = ed.state;
      const a = this.anchor || { x: st.cursor.x, y: st.cursor.y };
      const b = this.anchor ? (this.dragging ? { x: st.cursor.x, y: st.cursor.y } : (this.to || st.cursor)) : { x: st.cursor.x, y: st.cursor.y };
      const to = this.anchor && !this.dragging ? { x: st.cursor.x, y: st.cursor.y } : b;
      const cells = T.rectCells(a.x, a.y, to.x, to.y, { outline: this.outlineOnly });
      ctx.save();
      ctx.globalAlpha = this.anchor ? 0.9 : 0.5;
      for (const c of cells) if (inMap(ed, c.x, c.y)) T.drawGhostCell(ctx, ed, c.x, c.y, px, st.tile);
      ctx.globalAlpha = 1;
      if (this.anchor) {
        const x0 = Math.min(a.x, to.x), y0 = Math.min(a.y, to.y);
        const w = Math.abs(to.x - a.x) + 1, h = Math.abs(to.y - a.y) + 1;
        ctx.strokeStyle = '#6cf'; ctx.lineWidth = 2;
        ctx.strokeRect(x0 * px + 1, y0 * px + 1, w * px - 2, h * px - 2);
        if (px >= 12) {
          const text = `${w} × ${h}`;
          ctx.font = '12px system-ui, sans-serif';
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          const tw = ctx.measureText(text).width + 10;
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.fillRect(x0 * px, y0 * px - 19, tw, 17);
          ctx.fillStyle = '#fff';
          ctx.fillText(text, x0 * px + 5, y0 * px - 10);
        }
      }
      ctx.restore();
    },
  };

  // 4 — Eraser --------------------------------------------------------------------
  const eraser = {
    id: 'eraser', label: 'Eraser', short: 'Erase', icon: '🧽', key: '4', order: 40, cursor: 'crosshair',
    cells: [], last: null, drawing: false,
    begin(pt, ed) { this.drawing = true; this.cells = []; this.add([{ x: pt.tx, y: pt.ty }], ed); this.last = { x: pt.tx, y: pt.ty }; ed.repaint(); },
    move(pt, ed) { if (!this.drawing) return; this.add(trail(this.last, pt), ed); this.last = { x: pt.tx, y: pt.ty }; ed.repaint(); },
    end(pt, ed) {
      if (!this.drawing) return;
      this.drawing = false;
      const cells = this.cells;
      this.cells = [];
      T.paintCells(ed, cells, ERASE, 'Erase');
    },
    cancel() { this.drawing = false; this.cells = []; },
    add: pencil.add,
    preview(ctx, ed, px) {
      const st = ed.state;
      const cells = this.drawing ? this.cells : [{ x: st.cursor.x, y: st.cursor.y }];
      ctx.save();
      ctx.globalAlpha = this.drawing ? 0.9 : 0.55;
      for (const c of cells) T.drawGhostCell(ctx, ed, c.x, c.y, px, ERASE);
      ctx.restore();
    },
  };

  // 5 — Eyedropper -------------------------------------------------------------------
  const eyedropper = {
    id: 'eyedropper', label: 'Pick', icon: '💧', key: '5', order: 50, cursor: 'copy',
    begin(pt, ed) {
      if (!inMap(ed, pt.tx, pt.ty)) return;
      const layer = ed.state.layer;
      const v = T.valueAt(ed, pt.tx, pt.ty, layer);
      T.remember(layer, v);
      ed.set({ tile: v });
      const name = T.describe(ed, layer, v);
      if (ed.toast) ed.toast(`Picked ${name}`);
    },
    move() {},
    end() {},
    preview(ctx, ed, px) {
      const st = ed.state;
      ctx.save();
      ctx.strokeStyle = '#6cf'; ctx.lineWidth = 2;
      ctx.strokeRect(st.cursor.x * px + 1, st.cursor.y * px + 1, px - 2, px - 2);
      ctx.restore();
    },
  };
  /** A human name for a painted value ("Grass", "Terrain 2 (Path)", "Solid"). */
  T.describe = function (ed, layer, value) {
    if (layer === 'collision') return T.collisionAt(value).label;
    if (layer === 'regions') return `Region ${Number(value) || 0}`;
    if (layer === 'terrain') {
      const t = (ed.state.project.terrains || []).find(t => t.id === Number(value));
      return t ? t.name : (Number(value) ? `Terrain ${value}` : 'No terrain');
    }
    if (value == null) return 'nothing';
    const def = KIT.registry.exists('tiles') ? KIT.registry('tiles').get(value) : null;
    return (def && (def.name || def.id)) || String(value);
  };

  // 6 — Stamp ----------------------------------------------------------------------
  const stamp = {
    id: 'stamp', label: 'Stamp', icon: '🧱', key: '6', order: 60, cursor: 'crosshair',
    at: null,
    def(ed) {
      const stamps = (KIT.registry.exists('tiles') && KIT.registry('tiles').stamps) || [];
      return stamps.find(s => s.id === ed.state.stamp) || null;
    },
    begin(pt, ed) { this.at = { x: pt.tx, y: pt.ty }; ed.repaint(); },
    move(pt, ed) { if (!this.at) return; this.at = { x: pt.tx, y: pt.ty }; ed.repaint(); },
    end(pt, ed) {
      const at = this.at || { x: pt.tx, y: pt.ty };
      this.at = null;
      const st = ed.state;
      const def = this.def(ed);
      if (!def) { if (ed.toast) ed.toast('Pick a stamp in the Tiles panel first'); return; }
      const layer = TILE_LAYERS.includes(st.layer) ? st.layer : 'deco';
      ed.commit(`Stamp ${def.name || def.id}`, (doc, ops) => ops.stamp(doc, { map: st.mapId, stamp: def.id, x: at.x, y: at.y, layer }));
    },
    cancel() { this.at = null; },
    preview(ctx, ed, px) {
      const st = ed.state;
      const def = this.def(ed);
      const at = this.at || { x: st.cursor.x, y: st.cursor.y };
      ctx.save();
      if (!def) {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(at.x * px, at.y * px, px, px);
        ctx.restore();
        return;
      }
      ctx.globalAlpha = this.at ? 0.95 : 0.7;
      ctx.imageSmoothingEnabled = false;
      def.tiles.forEach((row, dy) => row.forEach((id, dx) => {
        if (!id) return;
        const x = at.x + dx, y = at.y + dy;
        if (!inMap(ed, x, y)) return;
        const art = tileArt(id);
        if (art) { try { KIT.pixels.draw(ctx, art, x * px, y * px, { fit: { w: px, h: px } }); } catch (e) { /* silhouette */ } }
      }));
      ctx.globalAlpha = 1;
      const w = Math.max(...def.tiles.map(r => r.length)), h = def.tiles.length;
      ctx.strokeStyle = '#6cf'; ctx.lineWidth = 2;
      ctx.strokeRect(at.x * px + 1, at.y * px + 1, w * px - 2, h * px - 2);
      ctx.restore();
    },
  };

  // 7 — Terrain brush -----------------------------------------------------------------
  const terrain = {
    id: 'terrain', label: 'Terrain brush', short: 'Terrain', icon: '🌿', key: '7', order: 70, cursor: 'crosshair',
    cells: [], last: null, drawing: false, size: 1,
    begin(pt, ed) {
      if (ed.state.layer !== 'terrain') ed.set({ layer: 'terrain', tile: T.brushFor('terrain') });
      this.drawing = true;
      this.cells = [];
      this.add(this.brush(pt.tx, pt.ty), ed);
      this.last = { x: pt.tx, y: pt.ty };
      ed.repaint();
    },
    move(pt, ed) {
      if (!this.drawing) return;
      for (const c of trail(this.last, pt)) this.add(this.brush(c.x, c.y), ed);
      this.last = { x: pt.tx, y: pt.ty };
      ed.repaint();
    },
    end(pt, ed) {
      if (!this.drawing) return;
      this.drawing = false;
      const cells = this.cells;
      this.cells = [];
      T.paintCells(ed, cells, ed.state.tile, 'Terrain brush');
    },
    cancel() { this.drawing = false; this.cells = []; },
    add: pencil.add,
    /** A square brush, so a landscape can be drawn in wide sweeps. */
    brush(x, y) {
      const r = Math.max(0, (this.size | 0) - 1);
      const out = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) out.push({ x: x + dx, y: y + dy });
      return out;
    },
    preview(ctx, ed, px) {
      const st = ed.state;
      const cells = this.drawing ? this.cells : this.brush(st.cursor.x, st.cursor.y);
      ctx.save();
      ctx.globalAlpha = this.drawing ? 0.85 : 0.5;
      for (const c of cells) if (inMap(ed, c.x, c.y)) T.drawGhostCell(ctx, ed, c.x, c.y, px, st.tile);
      ctx.globalAlpha = 1;
      ctx.restore();
    },
  };

  // 8 — Select / Move -------------------------------------------------------------------
  const select = {
    id: 'select', label: 'Select / Move', short: 'Move', icon: '✥', key: '8', order: 80, cursor: 'pointer',
    from: null, to: null, moving: null, moved: false,
    objectsAt(ed, x, y) {
      const m = ed.state.map;
      if (!m) return [];
      return m.objectsAt ? m.objectsAt(x, y) : [];
    },
    begin(pt, ed) {
      const st = ed.state;
      const hits = this.objectsAt(ed, pt.tx, pt.ty);
      const sel = st.selection;
      if (hits.length) {
        // tapping an event selects it (tap again to cycle through a stack)
        let obj = hits[0];
        if (sel && sel.kind !== 'map' && hits.length > 1) {
          const i = hits.findIndex(o => o.id === sel.id);
          if (i >= 0) obj = hits[(i + 1) % hits.length];
        }
        ed.select({ kind: 'object', map: st.mapId, id: obj.id });
        this.moving = { id: obj.id, ox: obj.x, oy: obj.y };
        this.from = { x: pt.tx, y: pt.ty };
        this.to = { x: pt.tx, y: pt.ty };
        this.moved = false;
        ed.repaint();
        return;
      }
      if (sel && (sel.kind === 'object' || sel.kind === 'page' || sel.kind === 'slot') && sel.map === st.mapId) {
        // tap-then-tap: the selected event walks to the empty square you tapped
        this.moving = { id: sel.id, ox: null, oy: null };
        this.from = null;
        this.to = { x: pt.tx, y: pt.ty };
        this.moved = true;
        ed.repaint();
        return;
      }
      ed.select(null);
    },
    move(pt, ed) {
      if (!this.moving) return;
      if (this.to && this.to.x === pt.tx && this.to.y === pt.ty) return;
      this.to = { x: pt.tx, y: pt.ty };
      if (this.from && (pt.tx !== this.from.x || pt.ty !== this.from.y)) this.moved = true;
      ed.repaint();
    },
    end(pt, ed) {
      const job = this.moving;
      const to = this.to || { x: pt.tx, y: pt.ty };
      const moved = this.moved;
      this.moving = null; this.from = null; this.to = null; this.moved = false;
      if (!job || !moved) { ed.repaint(); return; }
      if (!inMap(ed, to.x, to.y)) return;
      const st = ed.state;
      ed.commit('Move event', (doc, ops) => ops.moveObject(doc, { map: st.mapId, id: job.id, x: to.x, y: to.y }));
      ed.repaint();
    },
    cancel() { this.moving = null; this.from = null; this.to = null; this.moved = false; },
    preview(ctx, ed, px) {
      const st = ed.state;
      ctx.save();
      const sel = st.selection;
      if (sel && sel.kind && sel.map === st.mapId && sel.id) {
        const obj = (st.map.objects || []).find(o => o.id === sel.id);
        if (obj) {
          ctx.strokeStyle = '#6cf'; ctx.lineWidth = 3;
          ctx.strokeRect(obj.x * px + 2, obj.y * px + 2, px - 4, px - 4);
        }
      }
      if (this.moving && this.to) {
        ctx.fillStyle = 'rgba(108,204,255,0.25)';
        ctx.fillRect(this.to.x * px, this.to.y * px, px, px);
        ctx.strokeStyle = '#6cf'; ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(this.to.x * px + 1, this.to.y * px + 1, px - 2, px - 2);
        ctx.setLineDash([]);
      } else if (!this.moving) {
        const hits = this.objectsAt(ed, st.cursor.x, st.cursor.y);
        if (hits.length) {
          ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
          ctx.strokeRect(st.cursor.x * px + 1, st.cursor.y * px + 1, px - 2, px - 2);
        }
      }
      ctx.restore();
    },
  };

  // 9 — Hand -----------------------------------------------------------------------------
  const hand = {
    id: 'hand', label: 'Hand — drag the map', short: 'Hand', icon: '✋', key: '9', order: 90, cursor: 'grab',
    from: null,
    // pt.x/pt.y are map coordinates, so they move with the camera: remember where
    // the finger is on SCREEN (pt.x - view.x, in tiles) and keep that point still.
    begin(pt, ed) { this.from = { sx: pt.x - ed.state.view.x, sy: pt.y - ed.state.view.y, vx: ed.state.view.x, vy: ed.state.view.y }; },
    move(pt, ed) {
      if (!this.from) return;
      const sx = pt.x - ed.state.view.x, sy = pt.y - ed.state.view.y;
      ed.set({ view: { x: ed.state.view.x + (this.from.sx - sx), y: ed.state.view.y + (this.from.sy - sy) } });
    },
    end() { this.from = null; },
    cancel() { this.from = null; },
    preview(ctx, ed, px) {
      const st = ed.state;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
      ctx.strokeRect(st.cursor.x * px + 1, st.cursor.y * px + 1, px - 2, px - 2);
      ctx.restore();
    },
  };

  // The registry keeps a filled-in copy of each definition, and that copy is the one
  // the shell drives — so a tool's live state (the rectangle's anchor, the pencil's
  // cells) lives there. byId points at the copies, never at the originals.
  T.byId = {};
  for (const tool of [pencil, fill, rect, eraser, eyedropper, stamp, terrain, select, hand]) {
    tool.replace = true;
    T.byId[tool.id] = reg.add(tool) || reg.get(tool.id);
  }

  /** Zoom to a chosen scale (the shell and the renderer agree on it: tileSize * scale CSS pixels a tile). */
  T.lockScale = function (scale) { ED.set({ view: { scale: KIT.clamp(Math.round(scale) || 1, 1, 8) } }); };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
