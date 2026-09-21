// KIT.renderer (§8.5): one canvas, drawn from the world every frame.
//
// The map is slow-moving, so each map keeps offscreen canvases — one per tile
// layer — drawn once at an integer pixel scale and blitted each frame;
// animated tiles are left out of them and painted per frame. Entities are
// sorted by their interpolated `py` so a character lower on the screen covers
// one higher up, the `above` tile layer goes over everybody, and KIT.fx paints
// fade / tint / flash / shake / weather on top.
//
//   const r = KIT.renderer.create({ canvas, project })
//   r.resize(); r.render(world)
//   r.invalidate('town', 4, 7)     // one cell changed (paint, overlay, editor)
//
// Missing art is normal: a tile or sprite with no registered art is drawn as a
// KIT.pixels.silhouette in a colour derived from its id, never as an error.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const R = KIT.renderer = KIT.renderer || {};

  const LAYERS = ['ground', 'deco', 'above'];
  const ZOOM = { small: 0.8, normal: 1, large: 1.25, auto: 1 };
  // Bigger than this on a side is drawn cell by cell. 4096 is what every browser
  // and every GPU of the last decade handles; 8192 is where Safari starts quietly
  // handing back blank canvases instead of raising anything.
  const MAX_CACHE_PX = 4096;
  /**
   * How much backing store the baked tile layers may hold, across all maps.
   * 192MB sounds enormous and is about two rooms on a dpr-3 phone — the point
   * is not to be small, it is to be FINITE, because the old answer was "all of
   * it, forever". A game may raise or lower it: KIT.renderer.cacheBudget.
   */
  R.cacheBudget = 192 * 1024 * 1024;

  /**
   * Where the frame went. Off by default.
   *
   * Every frame-rate figure this engine has quoted was measured once by hand
   * with a harness that was then thrown away, and each one is a single number
   * you cannot act on: "1600 characters at 60fps" does not say whether the cost
   * is tiles, characters, markers or light. Set `KIT.renderer.profile = {}` and
   * the renderer adds milliseconds into it by phase;
   * `tools/experiments/frame.js` reads it and asserts thresholds per phase.
   *
   * It costs one property read per PHASE — seven per frame, not seven per
   * entity — so it is not worth a build flag to remove.
   */
  R.profile = null;
  function at() { return R.profile ? performance.now() : 0; }
  function phase(name, t0) {
    const p = R.profile;
    if (p) p[name] = (p[name] || 0) + (performance.now() - t0);
  }

  const spriteArts = new WeakMap();            // frame.rows -> art object (stable identity = cached canvases)
  const missingArts = new Map();               // id -> silhouette art

  /** A stable colour for a thing with no art, so the same id always looks the same. */
  function colorFor(id, alt) {
    const h = KIT.hash(String(id || 'x')) % 360;
    return hsl(h, alt ? 35 : 55, alt ? 40 : 58);
  }
  function hsl(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const to = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
  }
  function missingArt(id, w, h, alt) {
    const key = `${id}|${w}x${h}|${alt ? 1 : 0}`;
    let a = missingArts.get(key);
    if (!a) { a = KIT.pixels.silhouette(w, h, colorFor(id, alt)); missingArts.set(key, a); }
    return a;
  }

  /** create({ canvas, project }) -> renderer */
  R.create = function (opts) {
    const canvas = opts.canvas;
    const ctx = canvas.getContext('2d');
    let project = opts.project;
    const TILE = () => ((project.settings && project.settings.tileSize) || 16);

    let dpr = 1, scale = 2, tilePx = 32;        // device pixels per art pixel / per tile
    let cacheBytes = 0;                         // what the tile caches are costing, in bytes
    // mapId -> { canvases, animated, scale, w, h, cached, bytes, used }
    //
    // Baking each tile layer to one canvas per map is what makes walking a
    // 64x48 map cost nothing. The bill is that those canvases are enormous and
    // they were never given back: a 24x18 map at tilePx 128 — which is what a
    // 390x844 phone at dpr 3 actually picks — is three canvases of 3072x2304,
    // 85MB, and every map you walked through kept its own. Five rooms was a
    // quarter of a gigabyte; a game with four hundred of them is not a game.
    //
    // So the cache is accounted in bytes and evicted least-recently-used. The
    // budget is generous enough that a normal few rooms never evict anything,
    // and finite enough that a long game cannot walk off the end of memory.
    const caches = new Map();
    let recolor = null, recolorKey = '';
    const weatherBits = [];

    const settings = () => (KIT.storage && KIT.storage.settings ? KIT.storage.settings() : {});

    function tileDef(id) { return id == null ? null : (KIT.registry.exists('tiles') ? KIT.registry('tiles').get(id) : null); }
    function tileArt(def) { return KIT.pixels.artOf(def) || def; }
    function tileFrames(def) {
      const a = tileArt(def);
      return a && Array.isArray(a.frames) ? a.frames.length : 1;
    }

    /** The palette remap from settings.palette.remap ({ '#from': '#to' }), rebuilt when it changes. */
    function updateRecolor() {
      const p = (project.settings && project.settings.palette) || {};
      const map = p.remap || {};
      const k = JSON.stringify(map);
      if (k === recolorKey) return;
      recolorKey = k;
      const list = Object.keys(map).map(from => ({ from, to: map[from] }));
      recolor = list.length ? list : null;
      dropCaches();
    }

    // ---- sizing ----------------------------------------------------------------
    let forcedScale = 0;
    /** setScale(cssScale) — draw one art pixel as `cssScale` CSS pixels (0 = choose automatically). */
    function setScale(cssScale) {
      const next = cssScale > 0 ? Math.round(cssScale) : 0;
      if (next === forcedScale) return scale;
      forcedScale = next;
      resize();
      return scale;
    }

    /** resize() — match the canvas to its CSS box and choose an integer tile scale. */
    function resize() {
      dpr = Math.max(1, Math.min(3, (root.devicePixelRatio || 1)));
      const cssW = Math.max(64, canvas.clientWidth || canvas.parentNode && canvas.parentNode.clientWidth || 320);
      const cssH = Math.max(64, canvas.clientHeight || 240);
      const zoomName = (settings().zoom && settings().zoom !== 'auto') ? settings().zoom : ((project.settings && project.settings.zoom) || 'auto');
      const zoom = ZOOM[zoomName] || 1;
      const wantCss = (cssW < 600 ? 40 : 48) * zoom;
      // forcedScale (set by Creator Mode) is in CSS pixels per art pixel: one tile is
      // TILE() * forcedScale CSS pixels, whatever the screen density.
      const next = forcedScale
        ? Math.max(1, Math.min(16, Math.round(forcedScale * dpr)))
        : Math.max(1, Math.min(8, Math.round(wantCss * dpr / TILE())));
      baseScale = next;
      if (next !== scale) { scale = next; dropCaches(); }
      fittedMap = null;                       // re-fit small maps after a resize
      tilePx = TILE() * scale;
      const w = Math.max(1, Math.floor(cssW * dpr));
      const h = Math.max(1, Math.floor(cssH * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.imageSmoothingEnabled = false;
      return { w, h, scale, tilePx, dpr };
    }

    /** viewTiles() -> how many whole tiles fit on screen right now. */
    function viewTiles() {
      return { w: Math.max(1, Math.ceil(canvas.width / tilePx)), h: Math.max(1, Math.ceil(canvas.height / tilePx)) };
    }

    // ---- per-map layer caches ---------------------------------------------------
    let cacheTick = 0;
    function cacheFor(view) {
      let c = caches.get(view.id);
      if (c && c.scale === scale && c.w === view.width && c.h === view.height) { c.used = ++cacheTick; return c; }
      if (c) { cacheBytes -= c.bytes || 0; caches.delete(view.id); }
      c = buildCache(view);
      c.used = ++cacheTick;
      caches.set(view.id, c);
      cacheBytes += c.bytes || 0;
      evict(view.id);
      return c;
    }
    /**
     * Drop the least recently drawn maps until we are inside the budget. The
     * map being drawn right now is never a candidate, however big it is — a
     * budget that evicts what you are looking at would rebuild it every frame.
     */
    function evict(keepId) {
      if (cacheBytes <= R.cacheBudget) return;
      const order = Array.from(caches.entries())
        .filter(([id]) => id !== keepId)
        .sort((a, b) => (a[1].used || 0) - (b[1].used || 0));
      for (const [id, c] of order) {
        if (cacheBytes <= R.cacheBudget) break;
        // Let the backing store go NOW rather than whenever the collector
        // notices: a detached canvas keeps its pixels until it is collected,
        // and 0x0 is the one portable way to say "give them back".
        for (const k of Object.keys(c.canvases || {})) { const cv = c.canvases[k]; if (cv) { cv.width = 0; cv.height = 0; } }
        cacheBytes -= c.bytes || 0;
        caches.delete(id);
      }
    }
    function buildCache(view) {
      const wpx = view.width * tilePx, hpx = view.height * tilePx;
      const bytes = wpx * hpx * 4 * LAYERS.length;
      // The budget is checked BEFORE the pixels are asked for, not after. Asking
      // first was most of a gigabyte on a big map at a big zoom, and WebKit does
      // not throw when it refuses a canvas that size — it hands back a blank one,
      // so the ground simply stopped being drawn.
      const cached = wpx <= MAX_CACHE_PX && hpx <= MAX_CACHE_PX && bytes <= R.cacheBudget;
      const c = { scale, w: view.width, h: view.height, cached, canvases: {}, animated: [], bytes: 0 };
      if (!cached) return c;
      c.bytes = bytes;
      for (const layer of LAYERS) {
        const cv = document.createElement('canvas');
        cv.width = wpx; cv.height = hpx;
        const g = cv.getContext('2d');
        g.imageSmoothingEnabled = false;
        c.canvases[layer] = cv;
      }
      for (let y = 0; y < view.height; y++) for (let x = 0; x < view.width; x++) paintCell(c, view, x, y);
      return c;
    }
    /** Paint one cell into the cached layer canvases (and remember animated cells). */
    function paintCell(c, view, x, y) {
      if (c.animated.length) c.animated = c.animated.filter(a => !(a.x === x && a.y === y));
      for (const layer of LAYERS) {
        const g = c.canvases[layer].getContext('2d');
        g.clearRect(x * tilePx, y * tilePx, tilePx, tilePx);
        const id = view.tileAt(layer, x, y);
        if (id == null) continue;
        const def = tileDef(id);
        if (def && tileFrames(def) > 1) { c.animated.push({ x, y, layer, id }); continue; }
        drawTileTo(g, id, def, x * tilePx, y * tilePx, 0);
      }
    }
    // A tile always fills its cell: art imported from a tool with a different
    // tile size (an 8px or a 48px tileset in a 16px game) is scaled to fit
    // rather than leaving gaps or spilling over its neighbours.
    function drawTileTo(g, id, def, dx, dy, frame) {
      if (!def) { KIT.pixels.draw(g, missingArt(id, TILE(), TILE(), true), dx, dy, { scale }); return; }
      const art = tileArt(def);
      const size = KIT.pixels.dims(art);
      const opts = { scale, frame: frame || 0, recolor };
      if (size.w > 0 && size.h > 0 && (size.w !== TILE() || size.h !== TILE())) opts.fit = { w: tilePx, h: tilePx };
      KIT.pixels.draw(g, art, dx, dy, opts);
    }

    /** dropCaches() — let every baked layer go, and reset the bill. */
    function dropCaches() {
      for (const c of caches.values()) {
        for (const k of Object.keys(c.canvases || {})) { const cv = c.canvases[k]; if (cv) { cv.width = 0; cv.height = 0; } }
      }
      caches.clear();
      cacheBytes = 0;
    }

    /** invalidate(mapId, x, y) — one cell (or the whole map when x is omitted). */
    function invalidate(mapId, x, y) {
      if (mapId == null) { dropCaches(); return; }
      const c = caches.get(mapId);
      if (!c) return;
      if (x == null) { cacheBytes -= (c.bytes || 0); caches.delete(mapId); return; }
      c.dirty = c.dirty || [];
      c.dirty.push({ x, y });
    }

    // ---- entities ---------------------------------------------------------------
    // `frame.rows` is either the row strings of pixel art or — for a sprite
    // backed by an imported image (a Tiled tile object, an RPG Maker character
    // sheet, an Aseprite export) — the source rectangle inside that image.
    function artForFrame(frame) {
      let a = spriteArts.get(frame.rows);
      if (!a) {
        const image = frame.art && typeof frame.art.image === 'string' ? frame.art.image : null;
        a = image
          ? { image, frame: frame.rows, w: frame.w || 16, h: frame.h || 24 }
          : { w: frame.w || 16, h: frame.h || 24, palette: frame.palette || {}, rows: frame.rows };
        spriteArts.set(frame.rows, a);
      }
      return a;
    }

    // The draw order, rebuilt each frame into the same three arrays. The old
    // code did entities.concat(heroes.filter(...)) and then made three more
    // arrays — five allocations of up to 1,600 slots, 60 times a second.
    const below = [], same = [], above = [];
    const byY = (a, b) => (a.py - b.py) || (a.y - b.y);
    const CULL_MARGIN = 3;                      // tiles: a tall sprite plus its balloon
    const cull = { x0: 0, y0: 0, x1: 0, y1: 0 };
    function bucket1(e) {
      if (e.visible === false) return;
      if (e.px < cull.x0 || e.px > cull.x1 || e.py < cull.y0 || e.py > cull.y1) return;
      (e.layer === 'below' ? below : e.layer === 'above' ? above : same).push(e);
    }
    function bucket(list) { for (let i = 0; i < list.length; i++) bucket1(list[i]); }

    // One options object for every sprite drawn, refilled per call. Nothing
    // downstream keeps it — KIT.pixels reads it synchronously to build a cache
    // key — so allocating a fresh one per character per frame bought nothing.
    const spriteOpts = { scale: 1, mirror: false, recolor: null };

    function drawEntity(e, view, camX, camY) {
      if (e.visible === false || e.opacity === 0) return;
      // What to draw: the sprite frame, else the `look` tile a sign or a door
      // carries, else a silhouette for a named sprite with no art — and nothing
      // at all for an event with no look of its own (a trigger). Inlined from
      // what used to be lookOf(), which returned a fresh {art, mirror, tile}
      // for every character on every frame.
      let art, mirror = false, isTile = false;
      const frame = KIT.entities.frame(e);
      if (frame) { art = artForFrame(frame); mirror = !!frame.mirror; }
      else if (e.look) { const def = tileDef(e.look); art = def ? tileArt(def) : missingArt(e.look, TILE(), TILE(), true); isTile = true; }
      else if (e.sprite) art = missingArt(e.sprite, TILE(), TILE() + 8, false);
      else return;
      const dims = KIT.pixels.dims(art);
      const sx = Math.round((e.px - camX) * tilePx + (tilePx - dims.w * scale) / 2);
      const sy = Math.round((e.py - camY) * tilePx + (isTile ? 0 : tilePx - dims.h * scale));
      const bush = view.bushAt(Math.round(e.px), Math.round(e.py));
      const alpha = e.opacity == null ? 1 : e.opacity;
      // save/restore snapshots the whole canvas state; for the common character
      // — fully opaque, not in a bush — there is nothing to restore.
      const needsState = alpha < 1 || bush;
      if (needsState) {
        ctx.save();
        if (alpha < 1) ctx.globalAlpha = alpha;
        if (bush) {
          ctx.beginPath();
          ctx.rect(sx - scale, sy, dims.w * scale + scale * 2, Math.max(1, dims.h * scale - 5 * scale));
          ctx.clip();
        }
      }
      spriteOpts.scale = scale; spriteOpts.mirror = mirror; spriteOpts.recolor = recolor;
      KIT.pixels.draw(ctx, art, sx, sy, spriteOpts);
      if (needsState) ctx.restore();
      if (e.data && e.data.balloon) drawBalloon(e, sx + dims.w * scale / 2, sy);
    }

    /**
     * Markers (§8.4): things drawn on the map that are not IN the world.
     *
     *   world.markers.push({ x, y, tile:'rug', opacity: 0.6, pulse: 400, tint: '#7fd' })
     *
     * A ghost while you decide where to put something down, a square shaded
     * because you may move there, a footprint, a target. They are NOT entities:
     * nothing walks into them, nothing talks to them, and nothing iterating
     * world.entities has to learn to skip them. `world.markers` is a plain array
     * a system or a scene fills and empties.
     *
     *   x, y      in tiles; fractions are fine
     *   tile      a tile id, OR `art` for pixel art (a sprite frame, an image)
     *   layer     'below' | 'same' (default) | 'above' — the same three the
     *             entities use, so a marker can sit under or over a character
     *   opacity   0..1, default 0.75
     *   pulse     ms for one breath in and out; 0 or absent is steady
     *   tint      a colour washed over it
     *   outline   a colour drawn round the tile's square
     */
    // The markers on screen this frame, by layer. Filled once per frame by
    // bucketMarkers and drawn three times; the old drawMarkers scanned the whole
    // list once PER LAYER, which at 3,000 markers was 9,000 tests a frame to draw
    // the ones in view.
    const markerBuckets = { below: [], same: [], above: [] };
    function bucketMarkers(world, cull) {
      markerBuckets.below.length = 0; markerBuckets.same.length = 0; markerBuckets.above.length = 0;
      const list = world.markers;
      if (!Array.isArray(list) || !list.length) return;
      for (const m of list) {
        if (!m) continue;
        const x = Number.isFinite(m.x) ? m.x : 0, y = Number.isFinite(m.y) ? m.y : 0;
        if (x < cull.x0 || x > cull.x1 || y < cull.y0 || y > cull.y1) continue;
        (markerBuckets[m.layer] || markerBuckets.same).push(m);
      }
    }
    const markerOpts = { scale: 1, recolor: null };
    function drawMarkers(layer, camX, camY, time) {
      const list = markerBuckets[layer];
      if (!list.length) return;
      for (const m of list) {
        const def = m.tile ? tileDef(m.tile) : null;
        const art = m.art || (m.tile ? (def ? tileArt(def) : missingArt(m.tile, TILE(), TILE(), true)) : null);
        const sx = Math.round(((Number.isFinite(m.x) ? m.x : 0) - camX) * tilePx);
        const sy = Math.round(((Number.isFinite(m.y) ? m.y : 0) - camY) * tilePx);
        let alpha = m.opacity == null ? 0.75 : m.opacity;
        if (m.pulse) alpha *= 0.65 + 0.35 * (0.5 + 0.5 * Math.sin((time / m.pulse) * Math.PI * 2));
        if (alpha <= 0) continue;
        // Everything this touches is put back by hand below, which is cheaper
        // than save/restore snapshotting the whole state per marker.
        ctx.globalAlpha = Math.min(1, alpha);
        if (art) {
          const dims = KIT.pixels.dims(art);
          markerOpts.scale = scale; markerOpts.recolor = recolor;
          KIT.pixels.draw(ctx, art, sx + Math.round((tilePx - dims.w * scale) / 2),
            sy + Math.round(m.tile ? 0 : tilePx - dims.h * scale), markerOpts);
        }
        if (m.tint) {
          ctx.globalCompositeOperation = art ? 'source-atop' : 'source-over';
          ctx.fillStyle = m.tint;
          ctx.fillRect(sx, sy, tilePx, tilePx);
          ctx.globalCompositeOperation = 'source-over';
        }
        if (m.outline) {
          ctx.globalAlpha = Math.min(1, alpha + 0.2);
          ctx.strokeStyle = m.outline;
          ctx.lineWidth = Math.max(1, scale);
          ctx.strokeRect(sx + scale / 2, sy + scale / 2, tilePx - scale, tilePx - scale);
        }
      }
      ctx.globalAlpha = 1;
    }

    const BALLOON_MS = 1200;
    function drawBalloon(e, cx, topY) {
      const b = e.data.balloon;
      const t = (root.performance ? performance.now() : Date.now()) - (b.start || 0);
      if (t > (b.ms || BALLOON_MS)) { e.data.balloon = null; return; }
      const w = tilePx * 0.9, h = tilePx * 0.75;
      const x = Math.round(cx - w / 2), y = Math.round(topY - h - scale * 2);
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#2b2b3a';
      ctx.lineWidth = Math.max(1, scale);
      ctx.beginPath();
      const r = Math.max(2, scale * 2);
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2b2b3a';
      ctx.font = `${Math.round(h * 0.62)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(b.kind || '!'), x + w / 2, y + h / 2 + scale * 0.5);
      ctx.restore();
    }

    // ---- pictures and screen effects ---------------------------------------------
    function drawPictures() {
      const fx = KIT.fx;
      if (!fx || !fx.pictures) return;
      for (const p of fx.pictures()) {
        const art = pictureArt(p);
        if (!art) continue;
        const dims = KIT.pixels.dims(art);
        const w = dims.w * scale * (p.zoom || 2), h = dims.h * scale * (p.zoom || 2);
        let x = (p.x || 0) * scale, y = (p.y || 0) * scale;
        if (p.anchor === 'center') { x -= w / 2; y -= h / 2; }
        ctx.save();
        ctx.globalAlpha = p.opacity == null ? 1 : p.opacity;
        if (p.imageEl) ctx.drawImage(p.imageEl, x, y, w, h);
        else KIT.pixels.draw(ctx, art, Math.round(x), Math.round(y), { scale: Math.max(1, Math.round(scale * (p.zoom || 2))) });
        ctx.restore();
      }
    }
    function pictureArt(p) {
      if (p.imageEl) return { w: p.imageEl.width, h: p.imageEl.height };
      for (const regName of ['faces', 'icons', 'sprites', 'tiles']) {
        if (!KIT.registry.exists(regName)) continue;
        const def = KIT.registry(regName).get(p.image);
        if (def) { const a = KIT.pixels.artOf(def); if (a) return a; }
      }
      return missingArt(p.image || p.id, 32, 32, false);
    }

    function drawOverlays(world) {
      const fx = KIT.fx ? KIT.fx.state() : null;
      if (!fx) return;
      const W = canvas.width, H = canvas.height;
      const p = (project.settings && project.settings.palette) || {};
      if (p.tint && p.amount) fill(p.tint, p.amount, 'multiply');
      if (fx.weather && fx.weather.kind && fx.weather.kind !== 'none') drawWeather(fx.weather);
      if (fx.tint && fx.tint.amount > 0) fill(fx.tint.color, fx.tint.amount, 'multiply');
      if (fx.flash && fx.flash.alpha > 0) fill(fx.flash.color, fx.flash.alpha);
      if (fx.fade && fx.fade.alpha > 0) fill(fx.fade.color, fx.fade.alpha);
      function fill(color, alpha, mode) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        if (mode) ctx.globalCompositeOperation = mode;
        ctx.fillStyle = color || '#000000';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    }

    function drawWeather(w) {
      const count = Math.round((w.power || 5) * 12);
      const t = (root.performance ? performance.now() : Date.now()) / 1000;
      while (weatherBits.length < count) weatherBits.push({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random() });
      ctx.save();
      if (w.kind === 'fog') {
        ctx.globalAlpha = 0.28 + 0.05 * Math.sin(t / 2);
        ctx.fillStyle = '#dfe6ee';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        ctx.strokeStyle = w.kind === 'snow' ? '#ffffff' : '#a8c8ff';
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = Math.max(1, scale);
        for (let i = 0; i < count; i++) {
          const b = weatherBits[i];
          const speed = w.kind === 'snow' ? 0.08 : 0.5;
          const y = ((b.y + t * speed * b.s) % 1) * canvas.height;
          const x = ((b.x + (w.kind === 'snow' ? Math.sin(t + i) * 0.01 : 0)) % 1) * canvas.width;
          if (w.kind === 'snow') { ctx.beginPath(); ctx.arc(x, y, scale, 0, Math.PI * 2); ctx.fill(); }
          else { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - scale * 2, y + scale * 8); ctx.stroke(); }
        }
      }
      ctx.restore();
    }

    // ---- the frame ----------------------------------------------------------------
    let lastWorld = null, fittedMap = null, baseScale = 2;
    /**
     * A small indoor map should not float in a sea of black: zoom in (by whole
     * pixels, never more than 2× the base) until the view fits inside the map.
     */
    function fitScale(view) {
      if (forcedScale) return;        // Creator Mode sets the zoom; never fight it
      let s = baseScale;
      while (s < baseScale * 2 && s < 8) {
        const vw = canvas.width / (TILE() * s), vh = canvas.height / (TILE() * s);
        if (vw <= view.width && vh <= view.height) break;
        s++;
      }
      if (s !== scale) { scale = s; tilePx = TILE() * scale; dropCaches(); }
    }

    function render(world) {
      lastWorld = world;
      updateRecolor();
      const W = canvas.width, H = canvas.height;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#10121a';
      ctx.fillRect(0, 0, W, H);
      // A scene may own the screen outright (a battle, a title card, a minigame).
      // Then the world is not drawn at all and the scene gets the whole frame.
      const owner = KIT.scenes && KIT.scenes.opaqueTop ? KIT.scenes.opaqueTop() : null;
      if (owner) {
        ctx.fillStyle = owner.background || '#000000';
        ctx.fillRect(0, 0, W, H);
        const t = world && world.time != null ? world.time * 1000 : (root.performance ? performance.now() : 0);
        KIT.scenes.draw(ctx, { W, H, tilePx, camX: 0, camY: 0, time: t, world: world || null, scale, owned: true });
        drawPictures();
        drawOverlays(world);
        ctx.restore();
        return;
      }

      const view = world && world.map;
      if (!view) { ctx.restore(); return; }

      if (view.id !== fittedMap) { fitScale(view); fittedMap = view.id; }
      const c = cacheFor(view);
      if (c.dirty && c.cached) { for (const d of c.dirty) paintCell(c, view, d.x, d.y); c.dirty = null; }

      const shake = KIT.fx && KIT.fx.state().shake;
      const camX = world.camera.x - (shake ? shake.x / tilePx : 0);
      const camY = world.camera.y - (shake ? shake.y / tilePx : 0);
      const ox = -Math.round(camX * tilePx), oy = -Math.round(camY * tilePx);
      // A cinematic zoom simply scales the drawing units, so the camera keeps
      // meaning "the top-left tile in frame" and pulling back shows MORE map.
      // Pixels stay hard (no smoothing); a whole-number zoom stays perfectly crisp.
      const zoom = world.camera && world.camera.zoom > 0 ? world.camera.zoom : 1;
      if (zoom !== 1) ctx.scale(zoom, zoom);
      const time = world.time != null ? world.time * 1000 : (root.performance ? performance.now() : 0);

      // tile layers (cached) — ground and deco under the characters
      const tTiles = at();
      blit(c, view, 'ground', ox, oy);
      blit(c, view, 'deco', ox, oy);
      drawAnimated(c, view, ox, oy, time, ['ground', 'deco']);
      phase('tiles', tTiles);

      // What is on screen, in tiles, with room for a sprite that stands taller
      // than its cell and a balloon over its head. Anything outside is not
      // sorted and not drawn: a map with 1,600 characters on it shows a few
      // dozen, and the rest cost nothing now.
      cull.x0 = camX - CULL_MARGIN; cull.y0 = camY - CULL_MARGIN;
      cull.x1 = camX + W / (tilePx * zoom) + CULL_MARGIN; cull.y1 = camY + H / (tilePx * zoom) + CULL_MARGIN;

      // characters
      const tSort = at();
      below.length = 0; same.length = 0; above.length = 0;
      bucket(world.entities);
      bucket(world.heroes);
      if (world.companion) bucket1(world.companion);
      below.sort(byY); same.sort(byY); above.sort(byY);
      bucketMarkers(world, cull);
      phase('sort', tSort);
      let tM = at();
      drawMarkers('below', camX, camY, time);
      phase('markers', tM);
      const tEnt = at();
      for (const e of below) drawEntity(e, view, camX, camY);
      for (const e of same) drawEntity(e, view, camX, camY);
      phase('entities', tEnt);
      tM = at();
      drawMarkers('same', camX, camY, time);
      phase('markers', tM);

      // the `above` tile layer covers characters (treetops, roofs, bridges)
      const tAbove = at();
      blit(c, view, 'above', ox, oy);
      drawAnimated(c, view, ox, oy, time, ['above']);
      phase('tiles', tAbove);
      const tEnt2 = at();
      for (const e of above) drawEntity(e, view, camX, camY);
      phase('entities', tEnt2);
      tM = at();
      drawMarkers('above', camX, camY, time);
      phase('markers', tM);

      // atmosphere sits over the world but under the pictures and the UI overlays
      const tAtmos = at();
      if (KIT.atmosphere && KIT.atmosphere.draw) {
        try {
          if (zoom !== 1) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false; }
          KIT.atmosphere.draw(ctx, world, { W, H, tilePx: tilePx * zoom, camX, camY, time });
        } catch (e) { (KIT.log || console).error('[atmosphere]', e); }
      }
      phase('atmosphere', tAtmos);
      // A scene's own canvas: over the world and the atmosphere, under the
      // pictures and the DOM. This is where a minigame, an overlay HUD or a
      // battle arena draws itself.
      const tScenes = at();
      if (KIT.scenes && KIT.scenes.draw) {
        if (zoom !== 1) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false; }
        KIT.scenes.draw(ctx, { W, H, tilePx: tilePx * zoom, camX, camY, time, world, scale, owned: false });
      }
      phase('scenes', tScenes);
      const tOver = at();
      drawPictures();
      drawOverlays(world);
      phase('overlays', tOver);
      ctx.restore();
    }

    function blit(c, view, layer, ox, oy) {
      if (c.cached) { ctx.drawImage(c.canvases[layer], ox, oy); return; }
      // Uncached (very large map): draw only the visible cells.
      const vt = viewTiles();
      const x0 = Math.max(0, Math.floor(-ox / tilePx)), y0 = Math.max(0, Math.floor(-oy / tilePx));
      for (let y = y0; y < Math.min(view.height, y0 + vt.h + 1); y++) {
        for (let x = x0; x < Math.min(view.width, x0 + vt.w + 1); x++) {
          const id = view.tileAt(layer, x, y);
          if (id == null) continue;
          drawTileTo(ctx, id, tileDef(id), ox + x * tilePx, oy + y * tilePx, 0);
        }
      }
    }
    function drawAnimated(c, view, ox, oy, time, layers) {
      if (!c.cached) return;
      for (const a of c.animated) {
        if (!layers.includes(a.layer)) continue;
        const def = tileDef(a.id);
        drawTileTo(ctx, a.id, def, ox + a.x * tilePx, oy + a.y * tilePx, KIT.tiles.frameAt(a.id, time));
      }
    }

    // ---- coordinates ---------------------------------------------------------------
    /** screenToTile(px, py) — CSS pixels inside the canvas -> map tile (may be off the map). */
    function screenToTile(px, py, world) {
      const x = px * dpr, y = py * dpr;
      const cam = ((world || lastWorld) && (world || lastWorld).camera) || { x: 0, y: 0 };
      return { x: Math.floor(cam.x + x / tilePx), y: Math.floor(cam.y + y / tilePx) };
    }
    /** tileToScreen(x, y) -> CSS pixels inside the canvas. */
    function tileToScreen(x, y, world) {
      const cam = ((world || lastWorld) && (world || lastWorld).camera) || { x: 0, y: 0 };
      return { x: (x - cam.x) * tilePx / dpr, y: (y - cam.y) * tilePx / dpr };
    }

    const api = {
      canvas, render, resize, invalidate, screenToTile, tileToScreen, viewTiles,
      setProject(p) { project = p; dropCaches(); },
      get scale() { return scale; },
      get tilePx() { return tilePx; },
      get dpr() { return dpr; },
      clearCaches() { dropCaches(); },
      /** cacheStats() -> { maps, bytes, budget } — what the baked layers are costing. */
      cacheStats() { return { maps: caches.size, bytes: cacheBytes, budget: R.cacheBudget }; },
      setScale,
      get cssTileSize() { return TILE() * scale / dpr; },
    };
    resize();
    return api;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
