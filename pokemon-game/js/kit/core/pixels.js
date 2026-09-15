// KIT.pixels — pixel-string art → canvas (contract: docs/ARCHITECTURE.md §6.1)
//
// Art format: { w, h, palette: { char: '#hex' }, rows: ['....', ...] } or
// { frames: [rows, rows, ...] } for multi-frame art. Pokémon portraits use
// `size: 32` instead of w/h. '.' is transparent.
//
// canvas() / draw() need a browser (document.createElement('canvas')).
// validate() / downscale() / silhouette() / rowsOf() / dims() are pure and
// also work in Node, so tests can require() this file.
//
// This file used to live at js/core/pixels.js under the Pokémon namespace; the
// art registry files (js/art/tiles.js) keep that old name as an alias so the
// art tools keep working. Nothing here depends on any art file (icons.js may
// not exist yet) and nothing here references content or modules.
(function (root) {
  const KIT = root.KIT = root.KIT || {};

  const HEX = /^#[0-9a-fA-F]{6}$/;
  // WeakMap<art, Map<optionKey, canvas>> — the art object is the identity, so
  // an art object that is edited in place (Creator Mode) should call
  // KIT.pixels.invalidate(art) to drop its cached canvases.
  const cache = new WeakMap();

  function hasDocument() {
    return typeof document !== 'undefined' && typeof document.createElement === 'function';
  }

  // Width/height of an art object (handles `size`, `w/h`, or infers from rows).
  function dims(art) {
    if (!art) return { w: 0, h: 0 };
    if (isImageArt(art)) {
      const r = imageRect(art, 0);
      if (r) return { w: (r.sw || r.w) | 0, h: (r.sh || r.h) | 0 };      // sw/sh = the untrimmed box
      const size = KIT.assets ? KIT.assets.size(art.image) : { w: 0, h: 0 };
      return { w: (art.w != null ? art.w : size.w) | 0, h: (art.h != null ? art.h : size.h) | 0 };
    }
    const rows = rowsOf(art, 0);
    let w = art.w != null ? art.w : art.size;
    let h = art.h != null ? art.h : art.size;
    if (w == null) w = rows && rows[0] ? rows[0].length : 0;
    if (h == null) h = rows ? rows.length : 0;
    return { w: w | 0, h: h | 0 };
  }

  /** Art backed by an imported image: { image:'assetId', frame:{x,y,w,h} } or { image, frames:[rects] }. */
  function isImageArt(art) { return !!(art && typeof art === 'object' && typeof art.image === 'string'); }
  /** The source rectangle for one frame of image art (null when the art has none). */
  function imageRect(art, frame) {
    if (!isImageArt(art)) return null;
    if (Array.isArray(art.frames) && art.frames.length) {
      const i = ((frame | 0) % art.frames.length + art.frames.length) % art.frames.length;
      const r = art.frames[i];
      return r && r.w ? r : null;
    }
    return art.frame && art.frame.w ? art.frame : null;
  }

  // The row strings for frame `frame` (0-based). Returns null when missing.
  function rowsOf(art, frame) {
    if (!art) return null;
    if (Array.isArray(art.frames) && art.frames.length) {
      const f = ((frame | 0) % art.frames.length + art.frames.length) % art.frames.length;
      const rows = art.frames[f];
      return Array.isArray(rows) ? rows : null;
    }
    return Array.isArray(art.rows) ? art.rows : null;
  }

  function frameCount(art) {
    if (!art) return 0;
    if (Array.isArray(art.frames)) return art.frames.length;
    if (isImageArt(art)) return 1;
    return Array.isArray(art.rows) ? 1 : 0;
  }

  // Returns a list of readable problems; [] means the art is valid.
  function validate(art) {
    const errors = [];
    if (!art || typeof art !== 'object') return ['art is not an object'];
    const palette = art.palette;
    if (!palette || typeof palette !== 'object') errors.push('missing palette');
    const frames = Array.isArray(art.frames) ? art.frames : (Array.isArray(art.rows) ? [art.rows] : null);
    if (!frames || !frames.length) { errors.push('missing rows/frames'); return errors; }
    const { w, h } = dims(art);
    if (!(w > 0) || !(h > 0)) errors.push('width/height must be positive (w/h or size)');
    if (palette && typeof palette === 'object') {
      for (const key of Object.keys(palette)) {
        if (key.length !== 1) errors.push('palette key "' + key + '" must be a single character');
        if (key === '.') errors.push('palette must not define "." (transparent)');
        if (typeof palette[key] !== 'string' || !HEX.test(palette[key])) errors.push('palette["' + key + '"] is not a #rrggbb colour');
      }
    }
    const used = new Set();
    frames.forEach((rows, fi) => {
      const where = frames.length > 1 ? 'frame ' + fi + ' ' : '';
      if (!Array.isArray(rows)) { errors.push(where + 'rows is not an array'); return; }
      if (h > 0 && rows.length !== h) errors.push(where + 'has ' + rows.length + ' rows, expected ' + h);
      rows.forEach((row, ri) => {
        if (typeof row !== 'string') { errors.push(where + 'row ' + ri + ' is not a string'); return; }
        if (w > 0 && row.length !== w) errors.push(where + 'row ' + ri + ' has ' + row.length + ' chars, expected ' + w);
        for (const ch of row) {
          if (ch === '.') continue;
          used.add(ch);
          if (palette && !Object.prototype.hasOwnProperty.call(palette, ch)) {
            errors.push(where + 'row ' + ri + ' uses "' + ch + '" which is not in the palette');
          }
        }
      });
    });
    if (palette && typeof palette === 'object') {
      for (const key of Object.keys(palette)) if (!used.has(key)) errors.push('palette key "' + key + '" is never used');
    }
    // De-duplicate identical messages (a bad char repeats per row).
    return Array.from(new Set(errors));
  }

  // Nearest-neighbour downscale (e.g. 32×32 portrait → 16×16 overworld icon).
  // Keeps the palette (dropping keys that are no longer used) and never
  // returns '.' where the source block had any opaque pixel: the most common
  // opaque colour in each block wins, so thin outlines survive.
  function downscale(art, size) {
    const target = size | 0 || 16;
    const src = dims(art);
    const rows = rowsOf(art, 0);
    if (!rows || !src.w || !src.h) return silhouette(target, target, '#888888');
    const fx = src.w / target, fy = src.h / target;
    const out = [];
    const used = new Set();
    for (let y = 0; y < target; y++) {
      let line = '';
      const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
      for (let x = 0; x < target; x++) {
        const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
        const counts = {};
        let best = '.', bestN = 0;
        for (let yy = y0; yy < y1; yy++) {
          const r = rows[yy] || '';
          for (let xx = x0; xx < x1; xx++) {
            const ch = r[xx];
            if (!ch || ch === '.') continue;
            counts[ch] = (counts[ch] || 0) + 1;
            if (counts[ch] > bestN) { bestN = counts[ch]; best = ch; }
          }
        }
        if (best !== '.') used.add(best);
        line += best;
      }
      out.push(line);
    }
    const palette = {};
    const srcPal = art.palette || {};
    for (const k of Object.keys(srcPal)) if (used.has(k)) palette[k] = srcPal[k];
    for (const k of used) if (!palette[k]) palette[k] = '#888888';
    return { w: target, h: target, palette, rows: out };
  }

  // A rounded blob placeholder so missing art is visible but never a crash.
  function silhouette(w, h, color) {
    w = Math.max(1, w | 0 || 16); h = Math.max(1, h | 0 || 16);
    const c = (typeof color === 'string' && HEX.test(color)) ? color : '#8a8a9a';
    const rows = [];
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    const rx = w / 2 - 0.5, ry = h / 2 - 0.5;
    for (let y = 0; y < h; y++) {
      let line = '';
      for (let x = 0; x < w; x++) {
        const dx = (x - cx) / Math.max(rx, 0.5), dy = (y - cy) / Math.max(ry, 0.5);
        line += (dx * dx + dy * dy <= 1.05) ? 's' : '.';
      }
      rows.push(line);
    }
    // Always at least one opaque pixel so the palette key is used.
    if (!rows.some(r => r.indexOf('s') >= 0)) rows[Math.floor(h / 2)] = 's'.padEnd(w, '.');
    return { w, h, palette: { s: c }, rows };
  }

  function normalizeHex(hex) {
    return (typeof hex === 'string' ? hex : '').toLowerCase();
  }

  // Build a { char: colour } lookup with recolouring applied.
  //  recolor: { from:'#hex', to:'#hex' }  → every pixel of colour `from` becomes `to`
  //  recolor: { key:'#hex' }              → palette key `key` becomes that colour  (any number of keys)
  //  recolor may also be an array of the above.
  function paletteWith(art, recolor) {
    const out = Object.assign({}, art.palette || {});
    if (!recolor) return out;
    const list = Array.isArray(recolor) ? recolor : [recolor];
    for (const rc of list) {
      if (!rc || typeof rc !== 'object') continue;
      if (rc.from && rc.to) {
        const from = normalizeHex(rc.from);
        for (const k of Object.keys(out)) if (normalizeHex(out[k]) === from) out[k] = rc.to;
      }
      for (const k of Object.keys(rc)) {
        if (k === 'from' || k === 'to') continue;
        if (k.length === 1 && typeof rc[k] === 'string' && Object.prototype.hasOwnProperty.call(out, k)) out[k] = rc[k];
      }
    }
    return out;
  }

  function optionKey(opts) {
    const o = opts || {};
    let rc = '';
    if (o.recolor) { try { rc = JSON.stringify(o.recolor); } catch (e) { rc = String(o.recolor); } }
    return [o.scale || 1, o.mirror ? 1 : 0, o.frame | 0, rc].join('|');
  }

  // Paint art onto a fresh canvas (no caching). Used by canvas().
  function render(art, opts) {
    const o = opts || {};
    const scale = Math.max(1, o.scale | 0 || 1);
    if (isImageArt(art)) return renderImage(art, o, scale);
    const { w, h } = dims(art);
    const rows = rowsOf(art, o.frame | 0) || [];
    const pal = paletteWith(art, o.recolor);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, w * scale);
    cv.height = Math.max(1, h * scale);
    const ctx = cv.getContext('2d');
    if (!ctx) return cv;
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < h; y++) {
      const row = rows[y] || '';
      for (let x = 0; x < w; x++) {
        const ch = row[x];
        if (!ch || ch === '.') continue;
        const col = pal[ch];
        if (!col) continue;
        ctx.fillStyle = col;
        const px = o.mirror ? (w - 1 - x) : x;
        ctx.fillRect(px * scale, y * scale, scale, scale);
      }
    }
    return cv;
  }

  /**
   * Draw a slice of a decoded asset image (mirrored and scaled as asked).
   * A trimmed frame (Aseprite's --trim) carries the box it was cut out of —
   * `sw`/`sh` — and where it sits in it — `ox`/`oy`; the canvas is that whole
   * box, so a trimmed walk cycle does not jitter.
   */
  function renderImage(art, o, scale) {
    const el = KIT.assets ? KIT.assets.image(art.image) : null;
    const rect = imageRect(art, o.frame | 0) || { x: 0, y: 0, w: dims(art).w, h: dims(art).h };
    const w = Math.max(1, rect.w | 0), h = Math.max(1, rect.h | 0);
    const boxW = Math.max(w, rect.sw | 0), boxH = Math.max(h, rect.sh | 0);
    const ox = rect.ox | 0, oy = rect.oy | 0;
    const cv = document.createElement('canvas');
    cv.width = boxW * scale; cv.height = boxH * scale;
    const ctx = cv.getContext('2d');
    if (!ctx) return cv;
    ctx.imageSmoothingEnabled = false;
    if (!el) {                                   // not decoded yet: a silhouette stands in
      ctx.fillStyle = art.color || '#8a8a9a';
      ctx.fillRect(0, 0, cv.width, cv.height);
      cv.__pending = true;
      return cv;
    }
    if (o.mirror) { ctx.translate(cv.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(el, rect.x | 0, rect.y | 0, w, h, ox * scale, oy * scale, w * scale, h * scale);
    return cv;
  }

  // Memoised canvas for `art` with the given options. Missing/invalid art
  // falls back to a silhouette so callers never crash.
  function canvas(art, opts) {
    if (!hasDocument()) throw new Error('KIT.pixels.canvas needs a browser document');
    let a = art;
    if (!a || typeof a !== 'object' || (!rowsOf(a, 0) && !isImageArt(a))) {
      const d = dims(a);
      a = silhouette(d.w || 16, d.h || 16, '#8a8a9a');
    }
    let perArt = cache.get(a);
    if (!perArt) { perArt = new Map(); cache.set(a, perArt); }
    const key = optionKey(opts);
    let cv = perArt.get(key);
    if (cv && cv.__pending) { perArt.delete(key); cv = null; }      // the image finished loading since
    if (!cv) { cv = render(a, opts); perArt.set(key, cv); }
    return cv;
  }

  // Draw the cached canvas at integer coordinates. `opts.fit = { w, h }` squeezes
  // it into that many device pixels instead — how art drawn for another tile size
  // (an imported 8px or 48px tileset in a 16px game) is made to fit its cell.
  function draw(ctx, art, x, y, opts) {
    if (!ctx) return;
    const cv = canvas(art, opts);
    const fit = opts && opts.fit;
    if (fit && fit.w > 0 && fit.h > 0 && (cv.width !== fit.w || cv.height !== fit.h)) {
      ctx.drawImage(cv, Math.round(x), Math.round(y), Math.round(fit.w), Math.round(fit.h));
    } else {
      ctx.drawImage(cv, Math.round(x), Math.round(y));
    }
    return cv;
  }

  // Drop cached canvases for an art object (after editing it in place).
  function invalidate(art) {
    if (art) cache.delete(art);
  }
  // An asset finished decoding: drop the placeholder canvases drawn for it.
  const imageWatchers = [];
  function invalidateImage(assetId) { for (const fn of imageWatchers) { try { fn(assetId); } catch (e) { /* ignore */ } } }
  /** onImageLoaded(fn) — the renderer uses this to clear its tile caches. */
  function onImageLoaded(fn) { imageWatchers.push(fn); return () => { const i = imageWatchers.indexOf(fn); if (i >= 0) imageWatchers.splice(i, 1); }; }

  /** The art object of a registry entry: tiles/sprites carry rows/palette on the definition itself or under `art`. */
  function artOf(def) {
    if (!def || typeof def !== 'object') return null;
    if (def.art && typeof def.art === 'object') return def.art;
    if (typeof def.image === 'string') return def;
    return (Array.isArray(def.rows) || Array.isArray(def.frames)) ? def : null;
  }

  KIT.pixels = {
    canvas, draw, downscale, silhouette, validate,
    dims, rowsOf, frameCount, paletteWith, invalidate, artOf,
    isImageArt, imageRect, invalidateImage, onImageLoaded,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
