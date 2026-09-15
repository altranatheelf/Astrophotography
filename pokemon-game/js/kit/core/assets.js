// KIT.assets — images that came from outside: Tiled tilesets, RPG Maker sheets,
// Aseprite exports, photos. Pixel-string art stays the default for art drawn
// here; an asset is for art drawn somewhere else.
//
// An asset is { id, kind:'image', src, w, h, note }. `src` is either a path
// relative to the page ('assets/outside.png') or a data: URI (what the
// single-file build and the browser importers produce). Art then points at it:
//   { image: 'outside', frame: { x: 0, y: 0, w: 16, h: 16 } }
//   { image: 'hero', frames: [ {x,y,w,h}, ... ] }        (animation frames)
//
// In Node there is no decoding: image() returns null and sizes come from the
// stored w/h, so importers and tests run headless. In a browser, load() decodes
// everything once and the renderer starts drawing it.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const A = KIT.assets = KIT.assets || {};

  const reg = KIT.defineRegistry('assets', {
    fields: [
      { key: 'id', type: 'string', min: 1 },
      { key: 'kind', type: 'enum', options: ['image'], default: 'image' },
      { key: 'src', type: 'string', min: 1 },
      { key: 'w', type: 'number', integer: true, min: 0, default: 0 },
      { key: 'h', type: 'number', integer: true, min: 0, default: 0 },
      { key: 'note', type: 'note', optional: true },
      { key: 'from', type: 'string', optional: true, doc: 'Where it was imported from (tool + file)' },
    ],
    doc: 'Images imported from outside the engine. See KIT.assets.',
  });
  KIT.schema.registryRefKind('asset', 'assets');

  const images = new Map();     // id -> { el, state:'idle'|'loading'|'ready'|'error' }
  const waiting = new Map();    // id -> Promise

  A.registry = reg;
  /** define({ id, src, w, h }) — registers one asset (replacing any earlier one with that id). */
  A.define = function (def) {
    const entry = Object.assign({ kind: 'image' }, def, { replace: true });
    reg.add(entry);
    images.delete(entry.id);
    waiting.delete(entry.id);
    return reg.get(entry.id);
  };
  A.get = (id) => reg.get(id);
  A.has = (id) => reg.has(id);
  A.ids = () => reg.ids();
  A.clear = () => { reg.clear(); images.clear(); waiting.clear(); };

  /** Register every asset in a project (project.assets is a table keyed by id). */
  A.fromProject = function (project) {
    const table = (project && project.assets) || {};
    for (const id of Object.keys(table)) A.define(Object.assign({ id }, table[id]));
    return reg.size();
  };

  const hasDocument = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

  /** load(id) -> Promise<HTMLImageElement|null>. Resolves null when there is no browser or the file is missing. */
  A.load = function (id) {
    if (waiting.has(id)) return waiting.get(id);
    const def = reg.get(id);
    if (!def || !hasDocument()) return Promise.resolve(null);
    const p = new Promise((resolve) => {
      const el = new Image();
      images.set(id, { el, state: 'loading' });
      el.onload = () => {
        const rec = images.get(id);
        if (rec) rec.state = 'ready';
        if (!def.w) def.w = el.naturalWidth;
        if (!def.h) def.h = el.naturalHeight;
        if (KIT.pixels && KIT.pixels.invalidateImage) KIT.pixels.invalidateImage(id);
        resolve(el);
      };
      el.onerror = () => {
        const rec = images.get(id);
        if (rec) rec.state = 'error';
        (KIT.log || console).warn(`[assets] could not load '${id}' (${def.src})`);
        resolve(null);
      };
      el.src = def.src;
    });
    waiting.set(id, p);
    return p;
  };
  /** loadAll() -> Promise<{ ready, failed }> for every registered asset. */
  A.loadAll = async function () {
    const ids = reg.ids();
    const results = await Promise.all(ids.map(id => A.load(id)));
    return { ready: results.filter(Boolean).length, failed: results.filter(r => !r).length, ids };
  };
  /** image(id) -> the decoded element, or null while it is loading / in Node. */
  A.image = function (id) {
    const rec = images.get(id);
    if (rec && rec.state === 'ready') return rec.el;
    if (!rec && reg.has(id) && hasDocument()) A.load(id);       // first ask starts the load
    return null;
  };
  A.state = (id) => (images.get(id) || { state: reg.has(id) ? 'idle' : 'missing' }).state;

  /** The natural size of an asset, from the registry (works in Node). */
  A.size = function (id) {
    const def = reg.get(id);
    if (!def) return { w: 0, h: 0 };
    const el = A.image(id);
    return { w: def.w || (el ? el.naturalWidth : 0), h: def.h || (el ? el.naturalHeight : 0) };
  };

  /** Slice a sheet into frame rects: grid(assetId, { tileW, tileH, margin, spacing, columns, count, firstIndex }). */
  A.grid = function (id, o) {
    const opts = o || {};
    const tw = opts.tileW || opts.w || 16, th = opts.tileH || opts.h || tw;
    const margin = opts.margin || 0, spacing = opts.spacing || 0;
    const size = A.size(id);
    const cols = opts.columns || Math.max(1, Math.floor((size.w - margin + spacing) / (tw + spacing)));
    const rows = opts.rows || (size.h ? Math.max(1, Math.floor((size.h - margin + spacing) / (th + spacing))) : 1);
    const count = opts.count == null ? cols * rows : opts.count;
    const out = [];
    for (let i = 0; i < count; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      out.push({ x: margin + c * (tw + spacing), y: margin + r * (th + spacing), w: tw, h: th });
    }
    return out;
  };
  /** Art for one cell of a sheet: KIT.assets.tileArt('outside', rect) */
  A.tileArt = (id, rect) => ({ image: id, frame: { x: rect.x | 0, y: rect.y | 0, w: rect.w | 0, h: rect.h | 0 } });
  /** Art for a run of frames: KIT.assets.animArt('hero', rects) */
  A.animArt = (id, rects) => ({ image: id, frames: rects.map(r => ({ x: r.x | 0, y: r.y | 0, w: r.w | 0, h: r.h | 0 })) });

  /** Is this art backed by an image asset? */
  A.isImageArt = (art) => !!(art && typeof art === 'object' && typeof art.image === 'string');

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
