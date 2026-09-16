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
  const MAX_CACHE_PX = 8192;                   // bigger maps are drawn cell by cell

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
    const caches = new Map();                    // mapId -> { canvases, animated, scale, w, h, cached }
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
      caches.clear();
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
      if (next !== scale) { scale = next; caches.clear(); }
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
    function cacheFor(view) {
      let c = caches.get(view.id);
      if (c && c.scale === scale && c.w === view.width && c.h === view.height) return c;
      c = buildCache(view);
      caches.set(view.id, c);
      return c;
    }
    function buildCache(view) {
      const wpx = view.width * tilePx, hpx = view.height * tilePx;
      const cached = wpx <= MAX_CACHE_PX && hpx <= MAX_CACHE_PX;
      const c = { scale, w: view.width, h: view.height, cached, canvases: {}, animated: [] };
      if (!cached) return c;
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

    /** invalidate(mapId, x, y) — one cell (or the whole map when x is omitted). */
    function invalidate(mapId, x, y) {
      if (mapId == null) { caches.clear(); return; }
      const c = caches.get(mapId);
      if (!c) return;
      if (x == null) { caches.delete(mapId); return; }
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

    /**
     * What to draw for an entity: its sprite frame, else the `look` tile a sign
     * or a door carries, else a silhouette when a named sprite has no art —
     * and nothing at all for an event with no look of its own (a trigger).
     */
    function lookOf(e) {
      const frame = KIT.entities.frame(e);
      if (frame) return { art: artForFrame(frame), mirror: frame.mirror, tile: false };
      if (e.look) {
        const def = tileDef(e.look);
        return { art: def ? tileArt(def) : missingArt(e.look, TILE(), TILE(), true), mirror: false, tile: true };
      }
      if (e.sprite) return { art: missingArt(e.sprite, TILE(), TILE() + 8, false), mirror: false, tile: false };
      return null;
    }

    function drawEntity(e, view, camX, camY) {
      if (e.visible === false || e.opacity === 0) return;
      const look = lookOf(e);
      if (!look) return;
      const art = look.art;
      const dims = KIT.pixels.dims(art);
      const sx = Math.round((e.px - camX) * tilePx + (tilePx - dims.w * scale) / 2);
      const sy = Math.round((e.py - camY) * tilePx + (look.tile ? 0 : tilePx - dims.h * scale));
      const bush = view.flagsAt(Math.round(e.px), Math.round(e.py)).bush;
      const alpha = e.opacity == null ? 1 : e.opacity;
      ctx.save();
      if (alpha < 1) ctx.globalAlpha = alpha;
      if (bush) {
        ctx.beginPath();
        ctx.rect(sx - scale, sy, dims.w * scale + scale * 2, Math.max(1, dims.h * scale - 5 * scale));
        ctx.clip();
      }
      KIT.pixels.draw(ctx, art, sx, sy, { scale, mirror: look.mirror, recolor });
      ctx.restore();
      if (e.data && e.data.balloon) drawBalloon(e, sx + dims.w * scale / 2, sy);
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
      if (s !== scale) { scale = s; tilePx = TILE() * scale; caches.clear(); }
    }

    function render(world) {
      lastWorld = world;
      updateRecolor();
      const W = canvas.width, H = canvas.height;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#10121a';
      ctx.fillRect(0, 0, W, H);
      const view = world && world.map;
      if (!view) { ctx.restore(); return; }

      if (view.id !== fittedMap) { fitScale(view); fittedMap = view.id; }
      const c = cacheFor(view);
      if (c.dirty && c.cached) { for (const d of c.dirty) paintCell(c, view, d.x, d.y); c.dirty = null; }

      const shake = KIT.fx && KIT.fx.state().shake;
      const camX = world.camera.x - (shake ? shake.x / tilePx : 0);
      const camY = world.camera.y - (shake ? shake.y / tilePx : 0);
      const ox = -Math.round(camX * tilePx), oy = -Math.round(camY * tilePx);
      const time = world.time != null ? world.time * 1000 : (root.performance ? performance.now() : 0);

      // tile layers (cached) — ground and deco under the characters
      blit(c, view, 'ground', ox, oy);
      blit(c, view, 'deco', ox, oy);
      drawAnimated(c, view, ox, oy, time, ['ground', 'deco']);

      // characters
      const all = world.entities.concat(world.heroes.filter(h => h.visible !== false));
      if (world.companion) all.push(world.companion);
      const below = [], same = [], above = [];
      for (const e of all) (e.layer === 'below' ? below : e.layer === 'above' ? above : same).push(e);
      const byY = (a, b) => (a.py - b.py) || (a.y - b.y);
      below.sort(byY); same.sort(byY); above.sort(byY);
      for (const e of below) drawEntity(e, view, camX, camY);
      for (const e of same) drawEntity(e, view, camX, camY);

      // the `above` tile layer covers characters (treetops, roofs, bridges)
      blit(c, view, 'above', ox, oy);
      drawAnimated(c, view, ox, oy, time, ['above']);
      for (const e of above) drawEntity(e, view, camX, camY);

      drawPictures();
      drawOverlays(world);
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
      setProject(p) { project = p; caches.clear(); },
      get scale() { return scale; },
      get tilePx() { return tilePx; },
      get dpr() { return dpr; },
      clearCaches() { caches.clear(); },
      setScale,
      get cssTileSize() { return TILE() * scale / dpr; },
    };
    resize();
    return api;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
