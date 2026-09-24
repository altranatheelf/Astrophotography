// KIT.import.tiled — Tiled (mapeditor.org) maps and tilesets -> Kit content.
//
// Contract: docs/IMPORT-CONTRACT.md (the Result shape, ids, images, tile flags).
// Target data model: ARCHITECTURE §5 (project/map/object/page), §6 (art), §9 (script).
//
// Pure: no fs, no DOM, no network. The caller hands over already-read data
// (a parsed object, a JSON/TMX/TSX string, or an ArrayBuffer) plus resolvers:
//   opts.asset(src) -> { id, src, w, h }     images (path -> copied file / data URI)
//   opts.tilesets    { '<source>': tsj|tsx } external tilesets a map refers to
//   opts.templates   { '<source>': tj|tx }   object templates
//   opts.inflate(bytes, 'gzip'|'zlib'|'zstd') -> Uint8Array  (optional; Node's zlib is used when present)
//   opts.prefix      id prefix ('outside' -> 'outside:grass')
//   opts.id/opts.name  the source file name, used for the map / tileset id
//   opts.mapId(name) -> id                   a warp's target map name -> a Kit map id
//
// Sources read while writing this (fetched 2026-09):
//   https://doc.mapeditor.org/en/stable/reference/json-map-format/   (.tmj/.tsj: Map, Layer, Chunk, Object, Tileset, Tile, Frame, WangSet, Property)
//   https://doc.mapeditor.org/en/stable/reference/tmx-map-format/    (.tmx/.tsx XML: elements, attributes, <data> encodings, <chunk>, <wangtile wangid>)
//   https://doc.mapeditor.org/en/stable/reference/global-tile-ids/   (GID flags 0x80000000 / 0x40000000 / 0x20000000 / 0x10000000, firstgid lookup)
//   https://doc.mapeditor.org/en/stable/manual/custom-properties/    (typed properties; Custom Types: enums + classes; tile -> tile-object inheritance)
//   https://doc.mapeditor.org/en/stable/manual/objects/              (rectangles have their origin top-left; tile objects are bottom-left aligned unless objectalignment says otherwise)
//   https://doc.mapeditor.org/en/stable/manual/using-infinite-maps/  (infinite maps; their chunk storage is in the two format references above)
//   https://doc.mapeditor.org/en/stable/manual/terrain/              (wang sets / terrain sets: corner, edge, mixed)
//
// Problem codes produced here (severity in brackets):
//   anim-multi-image[warn] anim-uneven[info] asset-unresolved[warn] bad-encoding[error]
//   collision-approx[info] compressed-unsupported[error] custom-type[info] duplicate-id[warn]
//   external-tileset-missing[warn] flipped-tile[warn] group-flattened[info] imagelayer-skipped[info]
//   infinite-bounds[info] item-without-item[warn] layer-guess[info] layer-overflow[warn]
//   object-alignment[warn] object-out-of-bounds[warn] object-rotation[warn] orientation[warn]
//   region-range[warn] screenplay-partial[info] shape-unsupported[info] template-unresolved[warn]
//   text-object-skipped[info] tile-without-image[warn] unknown-gid[warn] wangset-partial[info]
//   warp-target-unresolved[warn] xml-embedded-image[warn]
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const IMP = KIT.import = KIT.import || {};
  const T = IMP.tiled = IMP.tiled || {};

  // ---- small helpers ---------------------------------------------------------
  const isObj = KIT.isObject;
  const num = KIT.num;
  const int = (v, d) => Math.round(num(v, d));
  const baseName = (p) => String(p == null ? '' : p).split(/[\\/]/).pop();
  const stem = (p) => baseName(p).replace(/\.[A-Za-z0-9]+$/, '');
  const titleCase = KIT.titleCase;
  const withPrefix = (id, opts) => (opts && opts.prefix ? KIT.slug(opts.prefix) + ':' + id : id);

  function blank() {
    return {
      assets: {}, tiles: [], sprites: [], faces: [], maps: {}, objects: [],
      scripts: {}, vars: {}, items: {}, project: null, problems: [], stats: {},
    };
  }
  function problem(res, severity, code, message, where) {
    res.problems.push({ severity, code, message, where: where || {} });
    return res;
  }
  /** One problem per (code, key): an importer meets the same trouble on thousands of cells. */
  function once(st, code, key, severity, message, where) {
    const k = code + '|' + key;
    if (st.said.has(k)) return;
    st.said.add(k);
    problem(st.res, severity, code, message, where);
  }
  function ensureProject(res) {
    if (!res.project) res.project = {};
    return res.project;
  }

  // ---- 1. input: JSON, TMX/TSX XML, ArrayBuffer -------------------------------
  const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  function decodeEntities(s) {
    return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
      if (e[0] === '#') {
        const code = (e[1] === 'x' || e[1] === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return NAMED_ENTITIES[e] !== undefined ? NAMED_ENTITIES[e] : m;
    });
  }
  function findTagEnd(src, from) {                  // the '>' that is not inside a quoted attribute
    let quote = null;
    for (let i = from + 1; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '>') return i;
    }
    return -1;
  }
  function parseAttrs(s) {
    const out = {};
    const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(s))) out[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4]);
    return out;
  }
  /** A small tag reader: elements, attributes, text, CDATA, comments — enough for TMX/TSX. */
  function parseXml(text) {
    const src = String(text);
    const doc = { name: '#doc', attrs: {}, children: [], text: '' };
    const stack = [doc];
    const top = () => stack[stack.length - 1];
    let i = 0;
    while (i < src.length) {
      const lt = src.indexOf('<', i);
      if (lt < 0) { top().text += decodeEntities(src.slice(i)); break; }
      if (lt > i) top().text += decodeEntities(src.slice(i, lt));
      if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt); i = e < 0 ? src.length : e + 3; continue; }
      if (src.startsWith('<![CDATA[', lt)) {
        const e = src.indexOf(']]>', lt);
        top().text += src.slice(lt + 9, e < 0 ? src.length : e);
        i = e < 0 ? src.length : e + 3;
        continue;
      }
      if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt); i = e < 0 ? src.length : e + 2; continue; }
      if (src.startsWith('<!', lt)) { const e = src.indexOf('>', lt); i = e < 0 ? src.length : e + 1; continue; }
      const gt = findTagEnd(src, lt);
      if (gt < 0) throw new TypeError('tiled: malformed XML (a tag is never closed)');
      const raw = src.slice(lt + 1, gt);
      i = gt + 1;
      if (raw[0] === '/') { if (stack.length > 1) stack.pop(); continue; }
      const selfClose = /\/\s*$/.test(raw);
      const body = selfClose ? raw.replace(/\/\s*$/, '') : raw;
      const m = /^([^\s/>]+)([\s\S]*)$/.exec(body);
      if (!m) continue;
      const node = { name: m[1], attrs: parseAttrs(m[2]), children: [], text: '' };
      top().children.push(node);
      if (!selfClose) stack.push(node);
    }
    const el = doc.children.find(c => c.name && c.name[0] !== '#');
    if (!el) throw new TypeError('tiled: the XML has no root element');
    return el;
  }
  const kids = (node, name) => (node && node.children ? node.children.filter(c => c.name === name) : []);
  const kid = (node, name) => kids(node, name)[0] || null;

  // Attributes that always stay strings (a name of "1" is still a name; version "1.10" is not 1.1).
  const STRING_ATTRS = new Set(['name', 'class', 'type', 'source', 'image', 'value', 'propertytype', 'points',
    'encoding', 'compression', 'orientation', 'renderorder', 'version', 'tiledversion', 'staggeraxis',
    'staggerindex', 'backgroundcolor', 'tintcolor', 'transparentcolor', 'trans', 'color', 'draworder',
    'objectalignment', 'tilerendersize', 'fillmode', 'halign', 'valign', 'fontfamily', 'template', 'format', 'mode']);
  const BOOL_ATTRS = new Set(['visible', 'infinite', 'locked', 'repeatx', 'repeaty', 'wrap', 'bold', 'italic',
    'underline', 'strikeout', 'kerning', 'hflip', 'vflip', 'rotate', 'preferuntransformed']);
  function attrs(node) {
    const out = {};
    const a = (node && node.attrs) || {};
    for (const k of Object.keys(a)) {
      const v = a[k];
      if (BOOL_ATTRS.has(k)) out[k] = !(v === '0' || v === 'false' || v === '');
      else if (!STRING_ATTRS.has(k) && v.trim() !== '' && Number.isFinite(Number(v))) out[k] = Number(v);
      else out[k] = v;
    }
    return out;
  }
  function xmlProperties(node) {                     // <properties> -> the JSON `properties` array
    const holder = kid(node, 'properties');
    if (!holder) return undefined;
    const out = [];
    for (const p of kids(holder, 'property')) {
      const a = p.attrs;
      const type = a.type || 'string';
      const entry = { name: a.name, type };
      // A class property nests <properties>; a multiline string lives in the element body.
      if (type === 'class') entry.value = xmlProperties(p) || [];
      else entry.value = a.value !== undefined ? decodeEntities(a.value) : p.text;
      if (a.propertytype) entry.propertytype = a.propertytype;
      out.push(entry);
    }
    return out;
  }
  function xmlImage(node, res) {
    const im = kid(node, 'image');
    if (!im) return null;
    if (kid(im, 'data')) problem(res, 'warn', 'xml-embedded-image', 'an <image> with embedded <data> was skipped — Kit needs a file path or a data: URI', {});
    const a = attrs(im);
    return { source: a.source || '', width: a.width, height: a.height, trans: a.trans };
  }
  function xmlObject(node) {
    const o = attrs(node);
    if (kid(node, 'ellipse')) o.ellipse = true;
    if (kid(node, 'point')) o.point = true;
    if (kid(node, 'capsule')) o.capsule = true;
    for (const shape of ['polygon', 'polyline']) {
      const s = kid(node, shape);
      if (!s) continue;
      o[shape] = String(s.attrs.points || '').trim().split(/\s+/).filter(Boolean).map((pt) => {
        const parts = pt.split(',');
        return { x: num(parts[0], 0), y: num(parts[1], 0) };
      });
    }
    const txt = kid(node, 'text');
    if (txt) o.text = Object.assign({ text: txt.text }, attrs(txt));
    const props = xmlProperties(node);
    if (props) o.properties = props;
    return o;
  }
  function xmlObjectGroup(node) {
    const g = attrs(node);
    g.type = 'objectgroup';
    g.objects = kids(node, 'object').map(xmlObject);
    const props = xmlProperties(node);
    if (props) g.properties = props;
    return g;
  }
  function xmlTileset(node, res) {
    const ts = attrs(node);
    ts.type = 'tileset';
    const img = xmlImage(node, res);
    if (img) {
      ts.image = img.source;
      if (img.width) ts.imagewidth = img.width;
      if (img.height) ts.imageheight = img.height;
      if (img.trans) ts.transparentcolor = img.trans;
    }
    const off = kid(node, 'tileoffset');
    if (off) ts.tileoffset = attrs(off);
    const grid = kid(node, 'grid');
    if (grid) ts.grid = attrs(grid);
    const tr = kid(node, 'transformations');
    if (tr) ts.transformations = attrs(tr);
    const props = xmlProperties(node);
    if (props) ts.properties = props;
    const tiles = [];
    for (const t of kids(node, 'tile')) {
      const tile = attrs(t);
      const ti = xmlImage(t, res);
      if (ti) {
        tile.image = ti.source;
        if (ti.width) tile.imagewidth = ti.width;
        if (ti.height) tile.imageheight = ti.height;
      }
      const og = kid(t, 'objectgroup');
      if (og) tile.objectgroup = xmlObjectGroup(og);
      const anim = kid(t, 'animation');
      if (anim) tile.animation = kids(anim, 'frame').map(f => attrs(f));
      const tp = xmlProperties(t);
      if (tp) tile.properties = tp;
      tiles.push(tile);
    }
    if (tiles.length) ts.tiles = tiles;
    const wangsets = kid(node, 'wangsets');
    if (wangsets) {
      ts.wangsets = kids(wangsets, 'wangset').map((w) => {
        const ws = attrs(w);
        ws.colors = kids(w, 'wangcolor').map(c => attrs(c));
        ws.wangtiles = kids(w, 'wangtile').map((t) => {
          const wt = attrs(t);
          wt.wangid = String(t.attrs.wangid || '').split(',').map(v => int(v, 0));
          return wt;
        });
        return ws;
      });
    }
    const terrainTypes = kid(node, 'terraintypes');
    if (terrainTypes) ts.terrains = kids(terrainTypes, 'terrain').map(t => attrs(t));
    return ts;
  }
  function xmlLayer(node, res) {
    if (node.name === 'objectgroup') return xmlObjectGroup(node);
    if (node.name === 'imagelayer') {
      const l = attrs(node);
      l.type = 'imagelayer';
      const img = xmlImage(node, res);
      if (img) {
        l.image = img.source;
        if (img.width) l.imagewidth = img.width;
        if (img.height) l.imageheight = img.height;
      }
      return l;
    }
    if (node.name === 'group') {
      const l = attrs(node);
      l.type = 'group';
      l.layers = node.children.filter(c => LAYER_TAGS.includes(c.name)).map(c => xmlLayer(c, res));
      return l;
    }
    const l = attrs(node);
    l.type = 'tilelayer';
    const props = xmlProperties(node);
    if (props) l.properties = props;
    const data = kid(node, 'data');
    if (data) {
      const a = attrs(data);
      if (a.encoding) l.encoding = a.encoding;
      if (a.compression) l.compression = a.compression;
      const read = (holder) => {
        const tiles = kids(holder, 'tile');
        if (tiles.length) return tiles.map(t => int(t.attrs.gid, 0));   // the deprecated plain-XML form
        return holder.text;
      };
      const chunks = kids(data, 'chunk');
      if (chunks.length) l.chunks = chunks.map(c => Object.assign(attrs(c), { data: read(c) }));
      else l.data = read(data);
    }
    return l;
  }
  const LAYER_TAGS = ['layer', 'objectgroup', 'imagelayer', 'group'];
  function xmlMap(node, res) {
    const m = attrs(node);
    m.type = 'map';
    const props = xmlProperties(node);
    if (props) m.properties = props;
    m.tilesets = kids(node, 'tileset').map(t => (t.attrs.source ? attrs(t) : xmlTileset(t, res)));
    m.layers = node.children.filter(c => LAYER_TAGS.includes(c.name)).map(c => xmlLayer(c, res));
    return m;
  }
  /** TMX / TSX / TX text -> the JSON shape of the same file. */
  function fromXml(text, res) {
    const el = parseXml(text);
    if (el.name === 'map') return xmlMap(el, res);
    if (el.name === 'tileset') return xmlTileset(el, res);
    if (el.name === 'template') {
      const out = { type: 'template', object: xmlObject(kid(el, 'object') || { attrs: {}, children: [], text: '' }) };
      const ts = kid(el, 'tileset');
      if (ts) out.tileset = ts.attrs.source ? attrs(ts) : xmlTileset(ts, res);
      return out;
    }
    throw new TypeError(`tiled: <${el.name}> is not a Tiled map, tileset or template`);
  }
  /** fromXml(text) -> the JSON shape (exposed so a caller can inspect what the XML became). */
  T.fromXml = text => fromXml(text, blank());

  function textOf(input) {
    if (typeof input === 'string') return input;
    const bytes = (typeof Uint8Array !== 'undefined' && input instanceof Uint8Array) ? input : new Uint8Array(input);
    if (typeof TextDecoder === 'function') return new TextDecoder('utf-8').decode(bytes);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
  /** Anything the caller may hold -> a parsed Tiled JSON object. Throws when it is not Tiled at all. */
  function toJson(input, res) {
    if (isObj(input)) return input;
    const isBytes = (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer)
      || (typeof Uint8Array !== 'undefined' && input instanceof Uint8Array);
    if (typeof input === 'string' || isBytes) {
      const text = textOf(input).replace(/^﻿/, '').trim();
      if (!text) throw new TypeError('tiled: the input is empty');
      if (text[0] === '<') return fromXml(text, res || blank());
      try { return JSON.parse(text); } catch (e) { throw new TypeError(`tiled: the input is neither JSON nor XML (${e.message})`); }
    }
    throw new TypeError('tiled: expected a parsed object, a JSON/TMX string or an ArrayBuffer');
  }

  // ---- 2. layer data: csv, base64, gzip/zlib/zstd -----------------------------
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64Bytes(str) {
    const s = String(str).replace(/[^A-Za-z0-9+/=]/g, '');
    if (typeof Buffer !== 'undefined' && Buffer.from) return new Uint8Array(Buffer.from(s, 'base64'));
    if (typeof atob === 'function') {
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    const clean = s.replace(/=+$/, '');
    const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
    let acc = 0, bits = 0, o = 0;
    for (let i = 0; i < clean.length; i++) {
      acc = (acc << 6) | B64.indexOf(clean[i]);
      bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
    }
    return out.subarray(0, o);
  }
  const asBytes = v => (v instanceof Uint8Array ? v : new Uint8Array(v));
  /** Synchronous inflate: the caller's hook first, then Node's zlib. null = not possible here. */
  function inflate(bytes, method, opts) {
    if (opts && typeof opts.inflate === 'function') {
      const out = opts.inflate(bytes, method);
      return out ? asBytes(out) : null;
    }
    if (typeof require !== 'function') return null;
    try {
      const zlib = require('zlib');
      const buf = typeof Buffer !== 'undefined' ? Buffer.from(bytes) : bytes;
      if (method === 'gzip' && zlib.gunzipSync) return asBytes(zlib.gunzipSync(buf));
      if (method === 'zlib' && zlib.inflateSync) return asBytes(zlib.inflateSync(buf));
      if (method === 'zstd' && zlib.zstdDecompressSync) return asBytes(zlib.zstdDecompressSync(buf));
    } catch (e) { return null; }
    return null;
  }
  function gidsFromBytes(bytes) {                    // unsigned 32-bit little-endian
    const n = bytes.length >> 2;
    const out = new Array(n);
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      out[i] = (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
    }
    return out;
  }
  /** decodeData(...) -> gid[] | null (null = reported as a problem and skipped). */
  function decodeData(data, encoding, compression, st, where, label) {
    if (Array.isArray(data)) return data.map(v => num(v, 0) >>> 0);
    if (typeof data !== 'string') { problem(st.res, 'error', 'bad-encoding', `${label}: no tile data`, where); return null; }
    const enc = encoding || 'csv';
    if (enc === 'csv') return data.split(',').map(v => num(v.trim(), 0) >>> 0);
    if (enc !== 'base64') { problem(st.res, 'error', 'bad-encoding', `${label}: unknown layer encoding '${enc}'`, where); return null; }
    let bytes = base64Bytes(data);
    if (compression) {
      const out = inflate(bytes, compression, st.opts);
      if (!out) {
        once(st, 'compressed-unsupported', compression, 'error',
          `${label}: '${compression}' compressed layer data cannot be decoded here — call KIT.import.tiled.prepare(json) first, or pass opts.inflate(bytes, method)`, where);
        return null;
      }
      bytes = out;
    }
    return gidsFromBytes(bytes);
  }

  /**
   * prepare(json, opts) -> Promise<json> — a copy whose compressed base64 layer data has
   * become plain gid arrays. For browsers, where DecompressionStream is async while the
   * importer is not; Node decodes synchronously through zlib and never needs this.
   */
  T.prepare = async function (json, opts) {
    const src = toJson(json, blank());
    const out = KIT.deepClone(src);
    const jobs = [];
    const visit = (layers) => {
      for (const l of layers || []) {
        if (!isObj(l)) continue;
        if (l.type === 'group') { visit(l.layers); continue; }
        if (l.encoding !== 'base64' || !l.compression) continue;
        const holders = Array.isArray(l.chunks) ? l.chunks : [l];
        for (const h of holders) if (typeof h.data === 'string') jobs.push({ layer: l, holder: h });
      }
    };
    visit(out.layers);
    for (const job of jobs) {
      const bytes = base64Bytes(job.holder.data);
      let plain = inflate(bytes, job.layer.compression, opts);
      if (!plain && typeof DecompressionStream === 'function' && (job.layer.compression === 'gzip' || job.layer.compression === 'zlib')) {
        const format = job.layer.compression === 'gzip' ? 'gzip' : 'deflate';
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
        plain = new Uint8Array(await new Response(stream).arrayBuffer());
      }
      if (!plain) continue;
      job.holder.data = gidsFromBytes(plain);
      job.layer.decoded = true;
    }
    for (const job of jobs) {
      if (!job.layer.decoded) continue;
      delete job.layer.decoded;
      delete job.layer.encoding;
      delete job.layer.compression;
    }
    return out;
  };

  // ---- 3. global tile ids ------------------------------------------------------
  const FLIP_H = 0x80000000, FLIP_V = 0x40000000, FLIP_D = 0x20000000, ROT_HEX_120 = 0x10000000;
  const GID_MASK = 0x0FFFFFFF;
  /** gid(n) -> { id, h, v, d, r120, flipped } — the tile index plus Tiled's four high flag bits. */
  T.gid = function gidParts(gid) {
    const g = (gid || 0) >>> 0;
    return {
      id: g & GID_MASK,
      h: !!(g & FLIP_H), v: !!(g & FLIP_V), d: !!(g & FLIP_D), r120: !!(g & ROT_HEX_120),
      flipped: !!(g & (FLIP_H | FLIP_V | FLIP_D | ROT_HEX_120)),
    };
  };
  const gidParts = T.gid;

  // ---- 4. custom properties ----------------------------------------------------
  function propValue(p, st) {
    const t = (p && p.type) || 'string';
    const v = p ? p.value : undefined;
    if (st && p && p.propertytype) st.customTypes.add(String(p.propertytype));
    if (t === 'int' || t === 'float' || t === 'object') return typeof v === 'number' ? v : (v === '' || v == null ? 0 : num(v, 0));
    if (t === 'bool') return typeof v === 'boolean' ? v : (v === 'true' || v === '1' || v === 1);
    if (t === 'class') return Array.isArray(v) ? readProps(v, st) : (isObj(v) ? v : {});
    return v == null ? '' : String(v);
  }
  /** The Tiled property array -> a plain object. Class properties nest; enums arrive as their string/int. */
  function readProps(list, st) {
    const out = {};
    for (const p of (list || [])) if (p && p.name != null) out[String(p.name)] = propValue(p, st);
    return out;
  }
  const normKey = k => String(k).toLowerCase().replace(/^kit[.:_-]/, '').replace(/[^a-z0-9]/g, '');
  function pickKey(props, names) {
    const wanted = names.map(normKey);
    for (const k of Object.keys(props)) if (wanted.includes(normKey(k))) return k;
    return null;
  }
  function pick(props, names) {
    const k = pickKey(props, names);
    return k === null ? undefined : props[k];
  }
  const truthy = v => v === true || v === 1 || v === '1' || (typeof v === 'string' && /^(true|yes|on)$/i.test(v));
  const DIR_WORDS = {
    n: 'up', north: 'up', up: 'up', u: 'up', s: 'down', south: 'down', down: 'down', d: 'down',
    w: 'left', west: 'left', left: 'left', l: 'left', e: 'right', east: 'right', right: 'right', r: 'right',
  };
  const toDir = v => DIR_WORDS[String(v == null ? '' : v).trim().toLowerCase()] || null;
  const EDGE_WORDS = { n: 'n', north: 'n', up: 'n', s: 's', south: 's', down: 's', e: 'e', east: 'e', right: 'e', w: 'w', west: 'w', left: 'w' };
  function edgeList(v) {                             // 'ns' / 'n,s' / 'north south' -> ['n','s']
    const words = String(v == null ? '' : v).toLowerCase().split(/[^a-z]+/).filter(Boolean);
    const out = [];
    for (const word of words) {
      if (EDGE_WORDS[word]) { out.push(EDGE_WORDS[word]); continue; }
      for (const ch of word) if (EDGE_WORDS[ch]) out.push(EDGE_WORDS[ch]);
    }
    return out;
  }

  // ---- 5. tilesets -------------------------------------------------------------
  // The Kit flags a Tiled custom property may set. Everything else survives on tile.props.
  const FLAG_ALIASES = {
    solid: 'solid', collide: 'solid', blocked: 'solid', impassable: 'solid',
    bush: 'bush', tallgrass: 'bush', counter: 'counter', ledge: 'ledge',
    warplook: 'warpLook', encounter: 'encounter', encounters: 'encounter',
    terraintag: 'terrainTag', tag: 'terrainTag',
    animms: 'animMs', probability: 'probability',
    passage: 'passage', block: 'block', blockededges: 'block',
    passagen: 'passage.n', passages: 'passage.s', passagee: 'passage.e', passagew: 'passage.w',
    name: 'name', group: 'group', note: 'note',
  };
  const FLAG_NAMES = ['solid', 'bush', 'counter', 'encounter', 'warpLook'];
  const fullPassage = () => ({ n: true, s: true, e: true, w: true });

  /** Tile collision (an objectgroup on the tile) -> a full-tile box, or per-edge passage. */
  function collisionFromShapes(og, tw, th) {
    const out = { solid: false, edges: [], approx: false };
    const tol = Math.max(1, Math.round(tw * 0.06));
    for (const o of ((og && og.objects) || [])) {
      if (o.polygon || o.polyline || o.ellipse || o.point || o.capsule) { out.approx = true; out.solid = true; continue; }
      const x = num(o.x, 0), y = num(o.y, 0), w = num(o.width, 0), h = num(o.height, 0);
      if (w <= 0 || h <= 0) { out.approx = true; out.solid = true; continue; }
      if (x <= tol && y <= tol && w >= tw - tol && h >= th - tol) { out.solid = true; continue; }
      if (w >= tw - tol && h <= th / 2 + tol && y <= tol) { out.edges.push('n'); continue; }
      if (w >= tw - tol && h <= th / 2 + tol && y + h >= th - tol) { out.edges.push('s'); continue; }
      if (h >= th - tol && w <= tw / 2 + tol && x <= tol) { out.edges.push('w'); continue; }
      if (h >= th - tol && w <= tw / 2 + tol && x + w >= tw - tol) { out.edges.push('e'); continue; }
      out.approx = true; out.solid = true;
    }
    return out;
  }

  function resolveAsset(src, st, from, hint) {
    const key = String(src);
    if (st.assets.has(key)) return st.assets.get(key);
    let out = null;
    if (typeof st.opts.asset === 'function') {
      const a = st.opts.asset(key);
      if (a && a.id) out = { id: String(a.id), src: a.src == null ? key : String(a.src), w: int(a.w, (hint && hint.w) || 0), h: int(a.h, (hint && hint.h) || 0) };
    }
    if (!out) {
      out = { id: withPrefix(KIT.slug(stem(key)), st.opts), src: key, w: (hint && hint.w) || 0, h: (hint && hint.h) || 0 };
      once(st, 'asset-unresolved', key, 'warn', `no opts.asset resolver for '${key}' — the original path was kept`, {});
    }
    st.res.assets[out.id] = { kind: 'image', src: out.src, w: out.w, h: out.h, from };
    st.assets.set(key, out);
    return out;
  }

  function addTerrain(st, key, name, color) {
    if (st.terrainByKey.has(key)) return st.terrainByKey.get(key);
    const id = ++st.terrainSeq;
    st.terrainByKey.set(key, id);
    const p = ensureProject(st.res);
    p.terrains = p.terrains || [];
    p.terrains.push({ id, name, color: color || '#58b848', base: null });
    return id;
  }

  // wangid order (TMX reference): [top, topright, right, bottomright, bottom, bottomleft, left, topleft]
  function importWangset(ws, tsId, tileIds, st) {
    const where = { tileset: tsId, wangset: ws && ws.name };
    const colors = (ws && ws.colors) || [];
    if (!colors.length) { problem(st.res, 'info', 'wangset-partial', `tileset '${tsId}': wang set '${ws && ws.name}' has no colours`, where); return; }
    for (let ci = 0; ci < colors.length; ci++) {
      const color = colors[ci] || {};
      const index = ci + 1;                          // wangid values are 1-based colour indexes (0 = unset)
      const name = String(color.name || `Terrain ${index}`);
      const terrainId = addTerrain(st, `${tsId}/${ws.name}/${index}`, name, typeof color.color === 'string' ? color.color.slice(0, 7) : null);
      const tiles = {};
      for (const wt of (ws.wangtiles || [])) {
        const id = tileIds.get(int(wt.tileid, -1));
        const wid = wt.wangid || [];
        if (!id || wid.length < 8) continue;
        if ([wid[1], wid[3], wid[5], wid[7]].some(v => v && v !== index)) continue;
        const edges = { n: wid[0], e: wid[2], s: wid[4], w: wid[6] };
        if (['n', 'e', 's', 'w'].some(k => edges[k] && edges[k] !== index)) continue;
        const missing = ['n', 'e', 's', 'w'].filter(k => edges[k] !== index);
        if (missing.length === 4) continue;
        let role = null;
        if (!missing.length) role = 'center';
        else if (missing.length === 1) role = missing[0];
        else if (missing.length === 2) role = { en: 'ne', nw: 'nw', es: 'se', sw: 'sw' }[missing.slice().sort().join('')] || null;
        if (role && tiles[role] == null) tiles[role] = id;
      }
      if (tiles.center && KIT.tiles && typeof KIT.tiles.rulesFromTemplate === 'function') {
        const group = KIT.tiles.rulesFromTemplate({ groupId: `${tsId}-${KIT.slug(name)}`, name, terrain: terrainId, tiles });
        const p = ensureProject(st.res);
        p.autotiles = p.autotiles || { default: { source: 'terrain', groups: [] } };
        p.autotiles.default.groups.push(group);
      } else {
        problem(st.res, 'info', 'wangset-partial',
          `tileset '${tsId}': wang set '${ws.name}' colour '${name}' has no centre/edge tiles to build rules from (type '${ws.type || 'mixed'}') — only the terrain was imported`, where);
      }
    }
  }

  /**
   * importTileset(ts, st, o) -> { id, name, firstgid, tileIds:Map(local -> tileId), tilecount, objectalignment }
   * `ts` is one tileset: an external .tsj/.tsx, or the object embedded in a map.
   */
  function importTileset(ts, st, o) {
    const res = st.res;
    o = o || {};
    const tsId = withPrefix(KIT.slug(o.base || ts.name || stem(ts.source) || st.opts.id || stem(st.opts.name) || 'tileset'), st.opts);
    const tw = int(ts.tilewidth, 16) || 16, th = int(ts.tileheight, 16) || 16;
    const margin = int(ts.margin, 0), spacing = int(ts.spacing, 0);
    const where = { tileset: tsId };
    const tileMeta = new Map();
    for (const t of (ts.tiles || [])) if (t && t.id != null) tileMeta.set(int(t.id, 0), t);

    const sheet = ts.image ? resolveAsset(ts.image, st, `tiled:${tsId}`, { w: int(ts.imagewidth, 0), h: int(ts.imageheight, 0) }) : null;
    const imgW = int(ts.imagewidth, sheet ? sheet.w : 0);
    const imgH = int(ts.imageheight, sheet ? sheet.h : 0);
    let columns = int(ts.columns, 0);
    if (!columns && sheet && imgW) columns = Math.max(1, Math.floor((imgW - margin + spacing) / (tw + spacing)));
    const rows = (sheet && imgH) ? Math.max(1, Math.floor((imgH - margin + spacing) / (th + spacing))) : 0;
    let tilecount = int(ts.tilecount, 0);
    if (!tilecount) tilecount = sheet ? columns * rows : tileMeta.size;

    const rectOf = (local) => {
      if (!columns) return { x: 0, y: 0, w: tw, h: th };
      const c = local % columns, r = Math.floor(local / columns);
      return { x: margin + c * (tw + spacing), y: margin + r * (th + spacing), w: tw, h: th };
    };
    const assetOfLocal = new Map();                  // image-collection tiles each carry their own asset
    const frameOfLocal = new Map();
    const locals = [];
    if (sheet) { for (let i = 0; i < tilecount; i++) locals.push(i); }
    else { for (const k of Array.from(tileMeta.keys()).sort((a, b) => a - b)) locals.push(k); }

    for (const local of locals) {
      const meta = tileMeta.get(local) || {};
      if (sheet && !meta.image) { assetOfLocal.set(local, sheet); frameOfLocal.set(local, rectOf(local)); continue; }
      if (!meta.image) { once(st, 'tile-without-image', tsId, 'warn', `tileset '${tsId}': tile ${local} has no image of its own and the tileset has no sheet`, where); continue; }
      assetOfLocal.set(local, resolveAsset(meta.image, st, `tiled:${tsId}`, { w: int(meta.imagewidth, 0), h: int(meta.imageheight, 0) }));
      frameOfLocal.set(local, {
        x: int(meta.x, 0), y: int(meta.y, 0),
        w: int(meta.width, int(meta.imagewidth, tw)), h: int(meta.height, int(meta.imageheight, th)),
      });
    }

    const tileIds = new Map();
    for (const local of locals) {
      const asset = assetOfLocal.get(local);
      if (!asset) continue;
      const meta = tileMeta.get(local) || {};
      const rawProps = readProps(meta.properties, st);
      const nameProp = pick(rawProps, ['name']) || pick(rawProps, ['id']);
      const id = `${tsId}:${nameProp ? KIT.slug(nameProp) : local}`;
      if (st.tileIdsSeen.has(id)) { problem(res, 'warn', 'duplicate-id', `tile id '${id}' is produced twice — the later one was skipped`, where); continue; }
      st.tileIdsSeen.add(id);

      const def = { id, group: tsId, name: String(nameProp || pick(rawProps, ['label']) || titleCase(`${ts.name || tsId} ${local}`)) };
      const groupProp = pick(rawProps, ['group']);
      if (groupProp) def.group = KIT.slug(groupProp);
      const noteProp = pick(rawProps, ['note']);
      if (noteProp) def.note = String(noteProp);

      // art: one frame, or the animation's frames when they all live on the same image
      let art = { image: asset.id, frame: frameOfLocal.get(local) };
      if (Array.isArray(meta.animation) && meta.animation.length) {
        const frames = [], durations = [];
        let mixed = false;
        for (const f of meta.animation) {
          const fl = int(f.tileid, -1);
          const fa = assetOfLocal.get(fl);
          if (!fa || fa.id !== asset.id) { mixed = true; continue; }
          frames.push(frameOfLocal.get(fl));
          durations.push(int(f.duration, 100));
        }
        if (mixed) problem(res, 'warn', 'anim-multi-image', `tile '${id}': some animation frames come from another image — only the frames on '${asset.id}' were kept`, where);
        if (frames.length > 1) {
          art = { image: asset.id, frames };
          def.animMs = durations[0];
          const uniq = Array.from(new Set(durations));
          if (uniq.length > 1) problem(res, 'info', 'anim-uneven', `tile '${id}': per-frame durations ${uniq.join('/')}ms became one animMs of ${durations[0]}ms (Kit animates at a single rate)`, where);
        }
      }
      def.art = art;

      if (meta.probability != null) def.probability = num(meta.probability, 1);
      const cls = meta.type || meta.class;
      if (cls && FLAG_NAMES.includes(FLAG_ALIASES[normKey(cls)])) def[FLAG_ALIASES[normKey(cls)]] = true;

      let passage = null;
      const props = {};
      if (cls) props.class = String(cls);
      for (const key of Object.keys(rawProps)) {
        const canon = FLAG_ALIASES[normKey(key)];
        const value = rawProps[key];
        if (!canon) { props[key] = value; continue; }
        if (canon === 'name' || canon === 'group' || canon === 'note') continue;
        if (canon === 'passage') {
          passage = passage || fullPassage();
          const open = edgeList(value);
          if (open.length) for (const d of ['n', 's', 'e', 'w']) passage[d] = open.includes(d);
          else if (value === false || value === 'false') passage = { n: false, s: false, e: false, w: false };
        } else if (canon === 'block') {
          passage = passage || fullPassage();
          for (const d of edgeList(value)) passage[d] = false;
        } else if (canon.indexOf('passage.') === 0) {
          passage = passage || fullPassage();
          passage[canon.slice(8)] = truthy(value);
        } else if (canon === 'ledge') {
          def.ledge = toDir(value) || (truthy(value) ? 'down' : null);
        } else if (canon === 'terrainTag' || canon === 'animMs') {
          def[canon] = int(value, 0);
        } else if (canon === 'probability') {
          def.probability = num(value, 1);
        } else {
          def[canon] = truthy(value);
        }
      }

      if (meta.objectgroup) {
        const c = collisionFromShapes(meta.objectgroup, tw, th);
        if (c.solid) def.solid = true;
        if (c.approx) problem(res, 'info', 'collision-approx', `tile '${id}': its collision shape is neither a full tile nor a clean edge, so the tile was made solid`, where);
        if (!c.solid && c.edges.length) {
          passage = passage || fullPassage();
          for (const d of c.edges) passage[d] = false;
        }
      }
      if (passage) def.passage = passage;
      if (Object.keys(props).length) def.props = props;

      res.tiles.push(def);
      st.defsById.set(id, def);
      tileIds.set(local, id);
    }

    for (const ws of (ts.wangsets || [])) importWangset(ws, tsId, tileIds, st);
    if (Array.isArray(ts.terrains) && ts.terrains.length) {
      problem(res, 'info', 'wangset-partial', `tileset '${tsId}': the pre-1.1 terrain block was read as terrain names only (no autotile rules)`, where);
      for (const t of ts.terrains) addTerrain(st, `${tsId}/legacy/${t && t.name}`, String((t && t.name) || 'terrain'), null);
    }

    st.stats.tilesets = (st.stats.tilesets || 0) + 1;
    return {
      id: tsId, name: ts.name || tsId, firstgid: int(ts.firstgid, int(o.firstgid, 1)) || 1,
      tileIds, tilecount, objectalignment: ts.objectalignment || '',
    };
  }

  // ---- 6. maps -----------------------------------------------------------------
  const KIT_LAYERS = ['ground', 'deco', 'above', 'terrain', 'regions', 'collision'];
  const ORDER_LAYERS = ['ground', 'deco', 'above'];
  function layerTarget(layer) {
    for (const source of [layer.class, layer.name]) {
      const words = String(source == null ? '' : source).toLowerCase().split(/[^a-z]+/).filter(Boolean);
      const all = words.concat(words.map(w => w.replace(/layer$/, '')).filter(Boolean));
      for (const t of KIT_LAYERS) if (all.includes(t)) return t;
    }
    return null;
  }
  function flattenLayers(list, out, st) {
    for (const l of list || []) {
      if (!isObj(l)) continue;
      if (l.type === 'group') {
        once(st, 'group-flattened', 'x', 'info', 'group layers were flattened — Kit has no layer groups', {});
        flattenLayers(l.layers, out, st);
        continue;
      }
      out.push(l);
    }
    return out;
  }
  /** Every non-empty cell of a tile layer as { x, y, gid } in absolute tile coordinates. */
  function layerCells(layer, st) {
    const label = `layer '${layer.name || layer.id || '?'}'`;
    const where = { layer: layer.name };
    const out = [];
    const holders = (Array.isArray(layer.chunks) && layer.chunks.length)
      ? layer.chunks
      : [{ x: int(layer.startx, 0) + int(layer.x, 0), y: int(layer.starty, 0) + int(layer.y, 0), width: int(layer.width, 0), height: int(layer.height, 0), data: layer.data }];
    for (const h of holders) {
      const gids = decodeData(h.data, layer.encoding, layer.compression, st, where, label);
      if (!gids) return null;
      const w = int(h.width, 0) || int(layer.width, 0);
      if (!w) continue;
      const ox = int(h.x, 0), oy = int(h.y, 0);
      for (let i = 0; i < gids.length; i++) {
        if (!gids[i]) continue;
        out.push({ x: ox + (i % w), y: oy + Math.floor(i / w), gid: gids[i] });
      }
    }
    return out;
  }

  function intFromTile(def, names, fallback) {
    if (def && def.props) {
      const v = pick(def.props, names);
      if (v != null && v !== '' && Number.isFinite(Number(v))) return int(v, fallback);
    }
    if (def && names.indexOf('terraintag') >= 0 && def.terrainTag) return def.terrainTag;
    return fallback;
  }

  /** map(json, opts) -> Result with one Kit map (plus the tiles and images its tilesets bring). */
  T.map = function (json, opts) {
    const st = newState(opts);
    const res = st.res;
    const m = toJson(json, res);
    if (T.detect(m) !== 'map') throw new TypeError('tiled: this is not a Tiled map (expected a .tmj/.tmx with layers and tilewidth)');

    const tw = int(m.tilewidth, 16) || 16, th = int(m.tileheight, 16) || 16;
    if (m.orientation && m.orientation !== 'orthogonal') {
      problem(res, 'warn', 'orientation', `the map is '${m.orientation}' — Kit is a square grid, so tile positions were read as if it were orthogonal`, {});
    }

    // --- tilesets (embedded and external) --------------------------------------
    const sets = [];
    for (const entry of (m.tilesets || [])) {
      if (!isObj(entry)) continue;
      const firstgid = int(entry.firstgid, 1) || 1;
      if (entry.source) {
        const external = externalFile(entry.source, st, 'tilesets', 'tileset');
        if (!external) {
          const id = withPrefix(KIT.slug(stem(entry.source)), st.opts);
          problem(res, 'warn', 'external-tileset-missing', `external tileset '${entry.source}' was not supplied (opts.tilesets) — its tiles are referenced as '${id}:<n>' with no art or flags`, {});
          sets.push({ id, name: stem(entry.source), firstgid, tileIds: new Map(), tilecount: 0, objectalignment: '', stub: true });
          continue;
        }
        sets.push(importTileset(Object.assign({}, external, { firstgid }), st, { base: external.name || stem(entry.source), firstgid }));
      } else {
        sets.push(importTileset(entry, st, { base: entry.name || `${st.opts.id || stem(st.opts.name) || 'map'}-tiles`, firstgid }));
      }
    }
    sets.sort((a, b) => a.firstgid - b.firstgid);

    const flipped = new Map();
    function tileOf(gid, x, y) {
      const p = gidParts(gid);
      if (!p.id) return null;
      let set = null;
      for (const s of sets) if (s.firstgid <= p.id && (!set || s.firstgid >= set.firstgid)) set = s;
      if (!set) { once(st, 'unknown-gid', String(p.id), 'warn', `gid ${p.id} belongs to no tileset in this map`, {}); return null; }
      const local = p.id - set.firstgid;
      let id = set.tileIds.get(local);
      if (!id) {
        id = `${set.id}:${local}`;
        if (!set.stub) once(st, 'unknown-gid', id, 'warn', `gid ${p.id} is past the end of tileset '${set.id}' (${set.tilecount} tiles) — referenced as '${id}'`, {});
      }
      if (p.flipped && !flipped.has(p.id)) flipped.set(p.id, { n: 0, first: { x, y }, id, h: p.h, v: p.v, d: p.d });
      if (p.flipped) flipped.get(p.id).n++;
      return { id, local, set, flipped: p.flipped };
    }

    // --- layers -----------------------------------------------------------------
    const layers = flattenLayers(m.layers, [], st);
    const tileLayers = layers.filter(l => l.type === 'tilelayer' || (l.type === undefined && (l.data !== undefined || l.chunks !== undefined)));
    const objectLayers = layers.filter(l => l.type === 'objectgroup');
    for (const l of layers) {
      if (l.type === 'imagelayer') problem(res, 'info', 'imagelayer-skipped', `image layer '${l.name}' was skipped — Kit maps have no image layers`, { layer: l.name });
    }

    const cellsFor = new Map();
    for (const l of tileLayers) {
      const cells = layerCells(l, st);
      if (cells) cellsFor.set(l, cells);
    }

    // --- bounds (an infinite map's chunks sit anywhere on the plane) -------------
    let minX = 0, minY = 0, W = int(m.width, 0), H = int(m.height, 0);
    if (m.infinite) {
      let lo = null, hi = null;
      for (const cells of cellsFor.values()) {
        for (const c of cells) {
          if (!lo) { lo = { x: c.x, y: c.y }; hi = { x: c.x, y: c.y }; continue; }
          if (c.x < lo.x) lo.x = c.x;
          if (c.y < lo.y) lo.y = c.y;
          if (c.x > hi.x) hi.x = c.x;
          if (c.y > hi.y) hi.y = c.y;
        }
      }
      if (!lo) {
        problem(res, 'info', 'infinite-bounds', 'the infinite map has no tiles — an empty map was produced', {});
      } else {
        minX = lo.x; minY = lo.y;
        W = hi.x - lo.x + 1; H = hi.y - lo.y + 1;
        problem(res, 'info', 'infinite-bounds', `infinite map: the used area is ${W}x${H} tiles at (${minX}, ${minY}); everything was offset to (0, 0)`, {});
      }
    }
    W = Math.max(1, W); H = Math.max(1, H);
    const n = W * H;

    const kitLayers = {
      terrain: new Array(n).fill(0), ground: new Array(n).fill(null), deco: new Array(n).fill(null),
      above: new Array(n).fill(null), regions: new Array(n).fill(0),
    };
    const collision = new Array(n).fill(null);

    // Layer names win; anything left over goes ground -> deco -> above, in order.
    const taken = new Set();
    const assigned = [];
    for (const l of tileLayers) {
      const t = layerTarget(l);
      if (t && !taken.has(t)) { taken.add(t); assigned.push({ layer: l, target: t }); continue; }
      if (t) {
        problem(res, 'warn', 'layer-overflow', `tile layer '${l.name}' also names Kit's '${t}' layer, which is already taken — it was skipped`, { layer: l.name });
        assigned.push({ layer: l, target: null, skip: true });
        continue;
      }
      assigned.push({ layer: l, target: null });
    }
    for (const a of assigned) {
      if (a.target || a.skip) continue;
      const free = ORDER_LAYERS.find(t => !taken.has(t));
      if (!free) {
        problem(res, 'warn', 'layer-overflow', `tile layer '${a.layer.name}' has no Kit layer left (ground, deco and above are taken) — it was skipped`, { layer: a.layer.name });
        continue;
      }
      taken.add(free);
      a.target = free;
      problem(res, 'info', 'layer-guess', `tile layer '${a.layer.name || '(unnamed)'}' -> '${free}' (by order; name a layer ground/deco/above/terrain/regions/collision to choose)`, { layer: a.layer.name });
    }

    for (const a of assigned) {
      if (!a.target) continue;
      const cells = cellsFor.get(a.layer);
      if (!cells) continue;
      for (const c of cells) {
        const x = c.x - minX, y = c.y - minY;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const t = tileOf(c.gid, x, y);
        if (!t) continue;
        const i = y * W + x;
        const def = st.defsById.get(t.id) || null;
        if (a.target === 'ground' || a.target === 'deco' || a.target === 'above') kitLayers[a.target][i] = t.id;
        else if (a.target === 'terrain') kitLayers.terrain[i] = intFromTile(def, ['terrain', 'terraintag'], t.local + 1);
        else if (a.target === 'regions') {
          const v = intFromTile(def, ['region', 'regionid'], t.local + 1);
          if (v < 0 || v > 255) once(st, 'region-range', String(v), 'warn', `region ${v} is outside 0-255 and was clamped`, { layer: a.layer.name });
          kitLayers.regions[i] = KIT.clamp(v, 0, 255);
        } else if (a.target === 'collision') {
          const raw = def && def.props ? pick(def.props, ['collision', 'collide', 'pass']) : undefined;
          const edges = raw === undefined ? [] : edgeList(raw);
          collision[i] = edges.length === 1 ? edges[0] : ((raw === 0 || raw === '0' || raw === false) ? 0 : 1);
        }
      }
    }

    for (const rec of flipped.values()) {
      const how = [rec.h ? 'horizontally' : null, rec.v ? 'vertically' : null, rec.d ? 'diagonally' : null].filter(Boolean).join(' + ') || 'rotated';
      problem(res, 'warn', 'flipped-tile', `'${rec.id}' is flipped ${how} on ${rec.n} cell${rec.n > 1 ? 's' : ''} (first at ${rec.first.x}, ${rec.first.y}) — Kit has no per-cell flip, so the unflipped tile was used`, {});
    }

    // --- the map itself ----------------------------------------------------------
    const mapProps = readProps(m.properties, st);
    const mapId = withPrefix(KIT.slug(st.opts.id || stem(st.opts.name) || pick(mapProps, ['id']) || m.class || 'map'), st.opts);
    const kitMap = {
      id: mapId,
      name: String(pick(mapProps, ['name']) || st.opts.title || titleCase(mapId.split(':').pop())),
      width: W, height: H,
      kind: String(pick(mapProps, ['kind']) || m.class || 'outdoor'),
      music: pick(mapProps, ['music']) ? KIT.slug(pick(mapProps, ['music'])) : null,
      note: String(pick(mapProps, ['note']) || ''),
      layers: kitLayers,
      collision,
      objects: [],
      props: {},
    };
    for (const k of Object.keys(mapProps)) {
      if (['id', 'name', 'kind', 'music', 'note'].indexOf(normKey(k)) < 0) kitMap.props[k] = mapProps[k];
    }

    // --- objects ------------------------------------------------------------------
    const raws = [];
    for (const l of objectLayers) {
      const layerIsCollision = layerTarget(l) === 'collision';
      for (const o of (l.objects || [])) {
        if (!isObj(o)) continue;
        raws.push(readObject(o, l, layerIsCollision, st, { tw, th, minX, minY, tileOf }));
      }
    }
    const byTiledId = new Map();
    for (const r of raws) if (r.tiledId != null) byTiledId.set(int(r.tiledId, -1), r);

    const usedIds = new Map();
    raws.forEach((r, index) => {
      if (r.collision) {
        for (let y = r.ty; y < r.ty + r.th; y++) {
          for (let x = r.tx; x < r.tx + r.tw; x++) {
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            collision[y * W + x] = 1;
          }
        }
        return;
      }
      if (r.tx < 0 || r.ty < 0 || r.tx >= W || r.ty >= H) {
        problem(res, 'warn', 'object-out-of-bounds', `object '${r.name || r.tiledId}' lands on tile (${r.tx}, ${r.ty}), outside the ${W}x${H} map — it was skipped`, { map: mapId });
        return;
      }
      const base = r.name ? KIT.slug(r.name) : `obj-${r.tiledId == null ? index + 1 : r.tiledId}`;
      const seen = usedIds.get(base) || 0;
      usedIds.set(base, seen + 1);
      kitMap.objects.push(buildObject(seen ? `${base}-${seen + 1}` : base, r, st, { mapId, byTiledId }));
    });

    res.maps[mapId] = kitMap;
    const p = ensureProject(res);
    p.settings = Object.assign({ tileSize: tw }, p.settings || {});
    if (tw !== th) problem(res, 'warn', 'orientation', `the map's tiles are ${tw}x${th}; Kit uses square tiles, so tileSize ${tw} was used`, {});
    st.stats.maps = 1;
    st.stats.objects = kitMap.objects.length;
    st.stats.width = W;
    st.stats.height = H;
    st.stats.layers = tileLayers.length + objectLayers.length;
    return finish(st);
  };

  function mergeTemplate(base, over) {
    const out = Object.assign({}, base);
    for (const k of Object.keys(over)) {
      const v = over[k];
      if (v === undefined) continue;
      if (v === '' && ['name', 'type', 'class'].indexOf(k) >= 0) continue;   // '' = "not overridden"
      if (k === 'properties') continue;
      out[k] = v;
    }
    const props = [];
    const seen = new Set();
    for (const p of (over.properties || [])) if (p && p.name != null) { seen.add(String(p.name)); props.push(p); }
    for (const p of (base.properties || [])) if (p && p.name != null && !seen.has(String(p.name))) props.push(p);
    if (props.length) out.properties = props;
    return out;
  }

  /** One Tiled object -> the facts Kit needs, before it becomes a Kit object. */
  function readObject(o, layer, layerIsCollision, st, geo) {
    const res = st.res;
    let src = o;
    if (o.template) {
      const tpl = externalFile(o.template, st, 'templates', 'template');
      // A template instance only stores what it overrides: merge field by field,
      // and merge the property lists by property name rather than replacing them.
      if (tpl && tpl.object) src = mergeTemplate(tpl.object, o);
      else problem(res, 'warn', 'template-unresolved', `object template '${o.template}' was not supplied (opts.templates) — only the fields stored on the object itself were read`, {});
    }
    const gid = src.gid ? gidParts(src.gid) : null;
    const tile = (gid && gid.id) ? geo.tileOf(src.gid, 0, 0) : null;
    const tileDef = tile ? st.defsById.get(tile.id) : null;

    // Property inheritance: a tile object starts from its tile's class and properties.
    const tileProps = (tileDef && tileDef.props) ? tileDef.props : {};
    const props = Object.assign({}, tileProps, readProps(src.properties, st));
    const cls = String(src.type || src.class || (tileProps.class || '') || '').trim();

    const x = num(src.x, 0), y = num(src.y, 0);
    const w = num(src.width, 0), h = num(src.height, 0);

    // Alignment: shapes are top-left; tile objects are bottom-left unless the tileset says otherwise.
    let align = 'topleft';
    if (gid && gid.id) {
      const a = String((tile && tile.set && tile.set.objectalignment) || '').toLowerCase();
      align = (a && a !== 'unspecified') ? a : 'bottomleft';
      if (['topleft', 'bottomleft', 'left', 'center', 'bottom', 'top'].indexOf(align) < 0) {
        once(st, 'object-alignment', align, 'warn', `object alignment '${align}' is not supported — the object was placed from its top-left corner`, {});
        align = 'topleft';
      }
    }
    let px = x, py = y;
    if (align === 'bottomleft' || align === 'bottom') py = y - (h || geo.th);
    else if (align === 'center') { px = x - (w || geo.tw) / 2; py = y - (h || geo.th) / 2; }
    else if (align === 'left') py = y - (h || geo.th) / 2;
    if (align === 'bottom' || align === 'top') px = x - (w || geo.tw) / 2;

    const label = src.name || src.id;
    if (num(src.rotation, 0)) problem(res, 'warn', 'object-rotation', `object '${label}' is rotated ${src.rotation} degrees — Kit objects sit on the grid, so the rotation was dropped`, {});
    if (src.text) problem(res, 'info', 'text-object-skipped', `object '${label}' is a text object — the text was kept on props.text, but Kit does not draw text on maps`, {});
    if (src.polygon || src.polyline) problem(res, 'info', 'shape-unsupported', `object '${label}' is a ${src.polygon ? 'polygon' : 'polyline'} — its points were kept on props.points and it was placed at its origin`, {});
    else if (src.ellipse) problem(res, 'info', 'shape-unsupported', `object '${label}' is an ellipse — Kit has no ellipse regions, so its bounding box was used`, {});

    return {
      tiledId: src.id,
      name: src.name ? String(src.name) : '',
      cls, props,
      tile: tile ? tile.id : null,
      tx: Math.floor(px / geo.tw) - geo.minX,
      ty: Math.floor(py / geo.th) - geo.minY,
      tw: Math.max(1, Math.round((w || geo.tw) / geo.tw)),
      th: Math.max(1, Math.round((h || geo.th) / geo.th)),
      visible: src.visible !== false,
      collision: layerIsCollision || normKey(cls) === 'collision',
      shape: src.point ? 'point' : src.ellipse ? 'ellipse' : src.polygon ? 'polygon' : src.polyline ? 'polyline' : 'rect',
      points: src.polygon || src.polyline || null,
      text: src.text || null,
    };
  }

  const KIT_TYPES = ['npc', 'sign', 'item', 'warp', 'trigger'];
  const TEXT_KEYS = ['text', 'dialogue', 'say', 'message', 'lines', 'script'];
  const SLOTS = ['interact', 'step', 'touch', 'enter', 'tick', 'init'];
  const BEHAVIOURS = ['none', 'wander', 'look', 'route', 'approach'];

  const looksLikeScreenplay = text => /^\s*(@\w|\?\s|-\s|")/m.test(text) || /^[^\n:]{1,32}:\s/m.test(text);
  /** A dialogue property -> a runnable command list (screenplay when it looks like one, else one say). */
  function sayScript(text, who, st, where) {
    const raw = String(text);
    if (looksLikeScreenplay(raw) && KIT.screenplay && typeof KIT.screenplay.parse === 'function') {
      const parsed = KIT.screenplay.parse(raw);
      const cmds = parsed.commands || [];
      const usable = cmds.filter(c => c && c.t !== 'raw');
      if (usable.length && usable.length === cmds.length) return cmds;
      if (usable.length) {
        problem(st.res, 'info', 'screenplay-partial', `${where}: ${parsed.problems.length} line(s) of the screenplay text did not parse and were kept verbatim`, {});
        return cmds;
      }
    }
    const cmd = { t: 'say', who: who || '', text: raw };
    return [(KIT.commands && KIT.commands.normalize) ? KIT.commands.normalize(cmd) : cmd];
  }

  function warpTarget(props, known, st, ctx, id) {
    const keyOf = (names) => { const k = pickKey(props, names); if (k) known.add(k); return k; };
    const mapKey = keyOf(['map', 'tomap', 'destination', 'target', 'to']);
    const xKey = keyOf(['x', 'tox', 'targetx', 'destx']);
    const yKey = keyOf(['y', 'toy', 'targety', 'desty']);
    const dirKey = keyOf(['dir', 'direction', 'facing']);
    const objKey = keyOf(['object', 'toobject', 'targetobject', 'ref']);

    let mapId = null, x = 0, y = 0;
    if (mapKey !== null) {
      const raw = props[mapKey];
      if (isObj(raw)) {                              // a class-typed property { map, x, y }
        if (raw.map != null && raw.map !== '') mapId = resolveMapId(raw.map, st);
        if (raw.x != null) x = int(raw.x, 0);
        if (raw.y != null) y = int(raw.y, 0);
      } else if (raw != null && raw !== '') {
        mapId = resolveMapId(raw, st);
      }
    }
    if (xKey !== null) x = int(props[xKey], 0);
    if (yKey !== null) y = int(props[yKey], 0);
    if (objKey !== null) {
      const target = ctx.byTiledId.get(int(props[objKey], -1));
      if (target) { mapId = mapId || ctx.mapId; x = target.tx; y = target.ty; }
      else problem(st.res, 'warn', 'warp-target-unresolved', `warp '${id}': object reference ${props[objKey]} points at no object on this map`, { map: ctx.mapId, object: id });
    }
    return { to: { map: mapId, x, y }, dir: dirKey !== null ? (toDir(props[dirKey]) || 'down') : 'down' };
  }
  function resolveMapId(raw, st) {
    const name = String(raw);
    if (typeof st.opts.mapId === 'function') {
      const out = st.opts.mapId(name);
      if (out) return String(out);
    }
    return withPrefix(KIT.slug(stem(name)), st.opts);
  }

  function buildObject(id, r, st, ctx) {
    const res = st.res;
    const props = r.props;
    let type = KIT_TYPES.indexOf(normKey(r.cls)) >= 0 ? normKey(r.cls) : null;
    const known = new Set();
    const take = (names) => { const k = pickKey(props, names); if (k) known.add(k); return k === null ? undefined : props[k]; };
    if (!type) {
      const hinted = take(['type', 'kind', 'objecttype']);
      if (hinted !== undefined && KIT_TYPES.indexOf(normKey(hinted)) >= 0) type = normKey(hinted);
      else if (hinted !== undefined) known.delete(pickKey(props, ['type', 'kind', 'objecttype']));
    }
    if (r.props.class !== undefined && normKey(r.cls) === normKey(r.props.class)) known.add('class');

    const page = {
      when: null, sprite: null, dir: 'down', layer: 'same', through: false, dirFix: false, stepAnim: false,
      visible: r.visible, behaviour: { kind: 'none' }, on: {}, once: false, needsBoth: false, props: {},
    };

    const dirProp = take(['dir', 'direction', 'facing']);
    if (dirProp !== undefined) page.dir = toDir(dirProp) || 'down';
    const spriteProp = take(['sprite', 'character', 'charset']);
    if (spriteProp !== undefined && spriteProp !== '') page.sprite = KIT.slug(spriteProp);
    const behaviourProp = take(['behaviour', 'behavior', 'move', 'movement']);
    if (behaviourProp !== undefined && behaviourProp !== '') {
      const kind = String(behaviourProp).toLowerCase();
      page.behaviour = { kind: BEHAVIOURS.indexOf(kind) >= 0 ? kind : 'none' };
      if (page.behaviour.kind === 'none') problem(res, 'info', 'shape-unsupported', `object '${id}': behaviour '${behaviourProp}' is not one of ${BEHAVIOURS.join(', ')}`, { map: ctx.mapId, object: id });
    }
    const radius = take(['radius']);
    if (radius !== undefined) page.behaviour.radius = int(radius, 3);
    const onceProp = take(['once']);
    if (onceProp !== undefined) page.once = truthy(onceProp);
    const bothProp = take(['needsboth', 'coop']);
    if (bothProp !== undefined) page.needsBoth = truthy(bothProp);

    if (!type) type = 'trigger';

    if (type === 'sign') {
      const look = take(['look', 'tile']);
      page.props.look = (look === undefined || look === '') ? (r.tile || 'sign') : KIT.slug(look);
    } else if (type === 'item') {
      const item = take(['item']);
      const count = take(['count', 'amount', 'qty']);
      const look = take(['look', 'tile']);
      if (item === undefined || item === '') {
        problem(res, 'warn', 'item-without-item', `object '${id}' has class 'item' but no 'item' property — it became a trigger instead`, { map: ctx.mapId, object: id });
        type = 'trigger';
      } else {
        page.props.item = KIT.slug(item);
        page.props.count = count === undefined ? 1 : Math.max(1, int(count, 1));
        page.props.look = (look === undefined || look === '') ? null : KIT.slug(look);
        page.layer = 'below'; page.through = true; page.once = true;
      }
    } else if (type === 'warp') {
      const target = warpTarget(props, known, st, ctx, id);
      page.props.to = target.to;
      page.props.dir = target.dir;
      const look = take(['look', 'tile']);
      page.props.look = (look === undefined || look === '') ? null : KIT.slug(look);
      const sound = take(['sound', 'se']);
      page.props.sound = (sound === undefined || sound === '') ? null : KIT.slug(sound);
      const fade = take(['fade']);
      page.props.fade = fade === undefined ? true : truthy(fade);
      page.layer = 'below'; page.through = true;
      if (!target.to.map) problem(res, 'warn', 'warp-target-unresolved', `warp '${id}' has no target map (expected properties map/x/y, or an object reference) — props.to.map is empty`, { map: ctx.mapId, object: id });
    }
    if (type === 'trigger') { page.layer = 'below'; page.through = true; page.visible = false; }

    const textKey = pickKey(props, TEXT_KEYS);
    if (textKey !== null) {
      known.add(textKey);
      const slotProp = take(['slot', 'on']);
      const slot = (slotProp !== undefined && SLOTS.indexOf(String(slotProp).toLowerCase()) >= 0) ? String(slotProp).toLowerCase() : 'interact';
      page.on[slot] = sayScript(props[textKey], r.name || '', st, `object '${id}'`);
    }

    const extra = {};
    for (const k of Object.keys(props)) if (!known.has(k)) extra[k] = props[k];
    if (r.points) extra.points = r.points;
    if (r.text && r.text.text != null) extra.text = String(r.text.text);
    if (r.shape !== 'rect' && r.shape !== 'point') extra.shape = r.shape;
    if (r.tw > 1 || r.th > 1) { extra.width = r.tw; extra.height = r.th; }
    if (r.cls && KIT_TYPES.indexOf(normKey(r.cls)) < 0) extra.class = r.cls;
    if (r.tile && extra.tile === undefined) extra.tile = r.tile;
    page.props = Object.assign(extra, page.props);   // Kit's own fields win over leftovers

    return { id, name: r.name || titleCase(id.split(':').pop()), type, x: r.tx, y: r.ty, note: '', pages: [page] };
  }

  // ---- 7. entry points -----------------------------------------------------------
  function newState(opts) {
    return {
      res: blank(), opts: opts || {}, said: new Set(), assets: new Map(), tileIdsSeen: new Set(),
      defsById: new Map(), terrainByKey: new Map(), terrainSeq: 0, customTypes: new Set(), stats: {},
    };
  }
  function finish(st) {
    const res = st.res;
    if (st.customTypes.size) {
      problem(res, 'info', 'custom-type', `custom property types were read as plain values (their names are not kept): ${Array.from(st.customTypes).sort().join(', ')}`, {});
    }
    res.stats = Object.assign({ tilesets: 0, maps: 0, objects: 0 }, st.stats, {
      tiles: res.tiles.length,
      assets: Object.keys(res.assets).length,
      terrains: res.project && res.project.terrains ? res.project.terrains.length : 0,
      problems: res.problems.length,
      errors: res.problems.filter(p => p.severity === 'error').length,
      warnings: res.problems.filter(p => p.severity === 'warn').length,
    });
    return res;
  }
  function externalFile(source, st, tableKey, fnKey) {
    const table = st.opts[tableKey] || {};
    let raw = table[source];
    if (raw === undefined) raw = table[baseName(source)];
    if (raw === undefined && typeof st.opts[fnKey] === 'function') raw = st.opts[fnKey](source);
    if (raw === undefined || raw === null) return null;
    try { return toJson(raw, st.res); } catch (e) { return null; }
  }

  /** tileset(json, opts) -> Result with the tileset's image(s), tile definitions and terrains. */
  T.tileset = function (json, opts) {
    const st = newState(opts);
    const ts = toJson(json, st.res);
    if (T.detect(ts) !== 'tileset') throw new TypeError('tiled: this is not a Tiled tileset (expected a .tsj/.tsx with tilewidth and an image or tiles)');
    const info = importTileset(ts, st, { base: (st.opts.id || stem(st.opts.name)) || null });
    st.stats.tilecount = info.tilecount;
    return finish(st);
  };

  /** detect(json) -> 'map' | 'tileset' | null. Accepts objects, JSON text and TMX/TSX text. */
  T.detect = function (input) {
    let j;
    try { j = toJson(input, blank()); } catch (e) { return null; }
    if (!isObj(j)) return null;
    if (j.type === 'map') return 'map';
    if (j.type === 'tileset') return 'tileset';
    if (Array.isArray(j.layers) && j.tilewidth != null) return 'map';
    if (j.tilewidth != null && (j.image != null || Array.isArray(j.tiles) || j.tilecount != null || j.columns != null)) return 'tileset';
    return null;
  };

  /** any(json, opts) -> Result — dispatches on detect(). Throws when the input is not Tiled. */
  T.any = function (json, opts) {
    const kind = T.detect(json);
    if (kind === 'map') return T.map(json, opts);
    if (kind === 'tileset') return T.tileset(json, opts);
    throw new TypeError('tiled: the input is not a Tiled map or tileset');
  };

  T.blank = blank;

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
