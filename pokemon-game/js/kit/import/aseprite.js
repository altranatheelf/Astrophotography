// KIT.import.aseprite — Aseprite sheet exports (.json) and .aseprite/.ase files -> Kit content.
//
// Contract: docs/IMPORT-CONTRACT.md (the Result shape, ids, images, problems).
// Target data model: ARCHITECTURE §5 (project), §6.1 (pixel-string art), §6.2/§6.3 (tiles, sprites, faces).
//
// Pure: no fs, no DOM, no network. The caller hands over already-read data
// (a parsed object, JSON text, an ArrayBuffer/Uint8Array) plus resolvers:
//   opts.asset(src) -> { id, src, w, h }   a sheet image path -> a project asset
//   opts.inflate(bytes) -> Uint8Array      optional zlib hook (Node's zlib is used when present,
//                                          and a small built-in inflate is the last resort)
//   opts.encodePng(w, h, rgba) -> bytes|dataURI   optional, for the art-too-big fallback
//   opts.prefix   id prefix ('hero' -> 'hero:walk')
//   opts.id / opts.name   the source file name, used for the produced ids
//   opts.kind     'sprite' (default) | 'tiles' | 'faces' | 'icons'
//   opts.maxPixels / opts.maxColors / opts.alphaThreshold   pixel-art limits (see file())
//
// Two doors:
//   sheet(json, opts)  — a `--sheet ... --data ...` export: image-backed tiles/sprites/faces.
//   file(buffer, opts) — the binary document, decoded into NATIVE Kit pixel-string art
//                        ({ w, h, palette, rows }) so a 16x24 character drawn in Aseprite
//                        becomes engine-native art with no PNG anywhere.
//
// Sources read while writing this (fetched 2026-09):
//   https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
//       (the official binary spec: 128-byte header, 16-byte frame headers, chunk types
//        0x0004/0x0011 old palette, 0x2004 layer, 0x2005 cel, 0x2006 cel extra, 0x2007 color
//        profile, 0x2008 external files, 0x2018 tags, 0x2019 palette, 0x2020 user data,
//        0x2022 slice, 0x2023 tileset; PIXEL sizes per colour depth; NOTE.1 child level,
//        NOTE.2 layer index, NOTE.3 zlib cels, NOTE.5 z-index order, NOTE.6 opacity flags)
//   https://raw.githubusercontent.com/aseprite/aseprite/main/src/app/doc_exporter.cpp
//       (DocExporter::createDataFile — the exact JSON the CLI writes for --format json-hash and
//        json-array: frames{frame,rotated,trimmed,spriteSourceSize,sourceSize,duration},
//        meta{app,version,image,format,size,scale,frameTags,layers,slices}; note `repeat` is
//        written as a STRING, `rotated` is always false, and userData adds "color"/"data")
//   https://raw.githubusercontent.com/aseprite/aseprite/main/src/app/filename_formatter.cpp
//       (get_default_filename_format_for_sheet: the json-hash key is '{title} {frame}.{extension}')
//   https://raw.githubusercontent.com/aseprite/aseprite/main/src/doc/anidir.cpp
//       (tag direction strings: forward | reverse | pingpong | pingpong_reverse)
//   https://raw.githubusercontent.com/aseprite/aseprite/main/src/doc/blend_mode.cpp
//       (blend mode strings: normal, multiply, ..., hsl_hue, hsl_saturation, hsl_color, hsl_luminosity)
//   https://www.aseprite.org/docs/cli/
//       (--sheet --data --format json-hash|json-array --list-tags --list-layers --list-slices
//        --trim --inner-padding --extrude --filename-format --sheet-type --split-layers)
//   https://www.ietf.org/rfc/rfc1950  https://www.ietf.org/rfc/rfc1951
//       (the zlib wrapper and DEFLATE, for the built-in inflate used when Node's zlib is absent)
//
// Problem codes produced here (severity in brackets):
//   alpha-flattened[info] art-too-big[info] asset-unresolved[warn] bad-frame[warn]
//   blend-mode[info] colour-profile[info] compressed-unsupported[error] duplicate-id[warn]
//   empty-frame[info] grayscale[info] grid-uneven[info] indexed-no-palette[warn]
//   linked-cel-missing[warn] no-frames[error] png-unavailable[warn] rotated-frame[warn]
//   slice-animated[info] tag-direction[info] tag-range[warn] tilemap-cel[warn]
//   tileset-skipped[info] trimmed-offset[info] unknown-chunk[info]
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const IMP = KIT.import = KIT.import || {};
  const A = IMP.aseprite = IMP.aseprite || {};

  // ---- small helpers ---------------------------------------------------------
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : (d || 0));
  const int = (v, d) => Math.round(num(v, d));
  const baseName = (p) => String(p == null ? '' : p).split(/[\\/]/).pop();
  const stem = (p) => baseName(p).replace(/\.[A-Za-z0-9]+$/, '');
  const titleCase = (s) => String(s || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase());
  const slug = (s) => KIT.slug(s);
  const withPrefix = (id, opts) => (opts && opts.prefix ? slug(opts.prefix) + ':' + id : id);

  function blank() {
    return {
      assets: {}, tiles: [], sprites: [], faces: [], icons: [], animations: [], slices: [],
      maps: {}, objects: [], scripts: {}, vars: {}, items: {},
      project: null, problems: [], stats: {},
    };
  }
  function problem(res, severity, code, message, where) {
    res.problems.push({ severity, code, message, where: where || {} });
    return res;
  }
  function newState(opts) {
    const o = opts || {};
    return { opts: o, res: blank(), said: new Set(), where: o.where || {}, ids: new Set() };
  }
  /** One problem per (code, key) — the same trouble repeats across thousands of pixels. */
  function once(st, severity, code, key, message) {
    const k = code + '|' + key;
    if (st.said.has(k)) return;
    st.said.add(k);
    problem(st.res, severity, code, message, st.where);
  }
  /** Claim an id; a second claim is reported and refused, so a Result never carries two of the same. */
  function claim(st, id) {
    if (st.ids.has(id)) {
      problem(st.res, 'warn', 'duplicate-id', `'${id}' is produced twice — the later one was skipped`, st.where);
      return false;
    }
    st.ids.add(id);
    return true;
  }
  function finish(st, extra) {
    const res = st.res;
    res.stats = Object.assign({
      assets: Object.keys(res.assets).length,
      tiles: res.tiles.length,
      sprites: res.sprites.length,
      faces: res.faces.length,
      icons: res.icons.length,
      animations: res.animations.length,
      slices: res.slices.length,
    }, extra || {}, {
      problems: res.problems.length,
      errors: res.problems.filter(p => p.severity === 'error').length,
      warnings: res.problems.filter(p => p.severity === 'warn').length,
    });
    return res;
  }

  // ---- bytes -----------------------------------------------------------------
  function asBytes(v) {
    if (!v) return null;
    if (v instanceof Uint8Array) return v;
    if (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer) return new Uint8Array(v);
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    if (Array.isArray(v)) return Uint8Array.from(v);
    return null;
  }
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
      out += B64[a >> 2];
      out += B64[((a & 3) << 4) | ((b === undefined ? 0 : b) >> 4)];
      out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c === undefined ? 0 : c) >> 6)];
      out += c === undefined ? '=' : B64[c & 63];
    }
    return out;
  }

  // ---- inflate (RFC 1950 zlib wrapper + RFC 1951 DEFLATE) ---------------------
  // Aseprite cel pixels are zlib streams (spec NOTE.3). Node's zlib is used when
  // it is there; this decoder is the fallback so the browser importer stays
  // synchronous (DecompressionStream is not).
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function huffman(lengths) {
    const count = new Array(16).fill(0);
    for (let i = 0; i < lengths.length; i++) if (lengths[i]) count[lengths[i]]++;
    const offs = new Array(17).fill(0);
    for (let l = 1; l <= 15; l++) offs[l + 1] = offs[l] + count[l];
    const symbols = new Array(lengths.length).fill(0);
    for (let s = 0; s < lengths.length; s++) if (lengths[s]) symbols[offs[lengths[s]]++] = s;
    return { count, symbols };
  }
  const FIXED_LIT = huffman((() => {
    const l = new Array(288);
    for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
    return l;
  })());
  const FIXED_DIST = huffman(new Array(30).fill(5));

  /** inflateRaw(bytes) -> Uint8Array. Throws on a malformed stream. */
  function inflateRaw(src) {
    let pos = 0, bit = 0, out = new Uint8Array(Math.max(256, src.length * 4)), len = 0;
    const room = (n) => {
      if (len + n <= out.length) return;
      let size = out.length;
      while (size < len + n) size *= 2;
      const next = new Uint8Array(size);
      next.set(out.subarray(0, len));
      out = next;
    };
    const bits = (n) => {
      let v = 0;
      for (let i = 0; i < n; i++) {
        if (pos >= src.length) throw new Error('aseprite: the deflate stream ends early');
        v |= ((src[pos] >> bit) & 1) << i;
        if (++bit === 8) { bit = 0; pos++; }
      }
      return v;
    };
    const decode = (h) => {
      let code = 0, first = 0, index = 0;
      for (let l = 1; l <= 15; l++) {
        code |= bits(1);
        const cnt = h.count[l];
        if (code - first < cnt) return h.symbols[index + (code - first)];
        index += cnt;
        first = (first + cnt) << 1;
        code <<= 1;
      }
      throw new Error('aseprite: a Huffman code in the deflate stream is invalid');
    };
    for (;;) {
      const last = bits(1), type = bits(2);
      if (type === 0) {                                  // stored
        if (bit) { bit = 0; pos++; }
        if (pos + 4 > src.length) throw new Error('aseprite: a stored deflate block is truncated');
        const n = src[pos] | (src[pos + 1] << 8);
        pos += 4;
        if (pos + n > src.length) throw new Error('aseprite: a stored deflate block runs past the end');
        room(n);
        out.set(src.subarray(pos, pos + n), len);
        len += n; pos += n;
      } else if (type === 1 || type === 2) {
        let lit = FIXED_LIT, dist = FIXED_DIST;
        if (type === 2) {
          const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
          const cl = new Array(19).fill(0);
          for (let i = 0; i < hclen; i++) cl[CLEN_ORDER[i]] = bits(3);
          const clh = huffman(cl);
          const lengths = [];
          while (lengths.length < hlit + hdist) {
            const sym = decode(clh);
            if (sym < 16) lengths.push(sym);
            else if (sym === 16) {
              const prev = lengths[lengths.length - 1];
              if (prev === undefined) throw new Error('aseprite: a deflate code-length repeat has nothing to repeat');
              let n = 3 + bits(2); while (n--) lengths.push(prev);
            } else if (sym === 17) { let n = 3 + bits(3); while (n--) lengths.push(0); }
            else { let n = 11 + bits(7); while (n--) lengths.push(0); }
          }
          lit = huffman(lengths.slice(0, hlit));
          dist = huffman(lengths.slice(hlit, hlit + hdist));
        }
        for (;;) {
          const sym = decode(lit);
          if (sym < 256) { room(1); out[len++] = sym; continue; }
          if (sym === 256) break;
          const li = sym - 257;
          if (li >= LBASE.length) throw new Error('aseprite: an invalid length code appears in the deflate stream');
          const n = LBASE[li] + bits(LEXT[li]);
          const di = decode(dist);
          if (di >= DBASE.length) throw new Error('aseprite: an invalid distance code appears in the deflate stream');
          const d = DBASE[di] + bits(DEXT[di]);
          if (d > len) throw new Error('aseprite: a deflate back-reference points before the start of the output');
          room(n);
          for (let i = 0; i < n; i++) { out[len] = out[len - d]; len++; }
        }
      } else {
        throw new Error('aseprite: reserved deflate block type 3');
      }
      if (last) break;
    }
    return out.subarray(0, len);
  }

  /** zinflate(bytes) -> Uint8Array — a zlib stream (the 2-byte header is stripped when present). */
  function zinflate(input) {
    const bytes = asBytes(input);
    if (!bytes) throw new TypeError('aseprite: zinflate needs bytes');
    let src = bytes;
    if (src.length >= 2 && (src[0] & 0x0f) === 8 && (((src[0] << 8) | src[1]) % 31) === 0) {
      src = src.subarray((src[1] & 0x20) ? 6 : 2);      // skip CMF/FLG (+ DICTID when FDICT is set)
    }
    return inflateRaw(src);
  }

  /** The caller's hook, then Node's zlib, then the built-in decoder. Returns null when all fail. */
  function inflate(bytes, opts) {
    if (opts && typeof opts.inflate === 'function') {
      try { const out = asBytes(opts.inflate(bytes)); if (out) return out; } catch (e) { /* fall through */ }
    }
    if (typeof require === 'function') {
      try {
        const zlib = require('zlib');
        if (zlib && zlib.inflateSync) {
          const buf = typeof Buffer !== 'undefined' ? Buffer.from(bytes) : bytes;
          return asBytes(zlib.inflateSync(buf));
        }
      } catch (e) { /* fall through */ }
    }
    try { return zinflate(bytes); } catch (e) { return null; }
  }

  // ---- directions and tag names ----------------------------------------------
  const DIR_WORDS = {
    down: 'down', south: 'down', s: null, front: 'down', forward: null,
    up: 'up', north: 'up', back: 'up', behind: 'up', rear: 'up',
    left: 'left', west: 'left',
    right: 'right', east: 'right',
  };
  // Motion words that only say "this is the walk cycle" — they do not name the sprite.
  const MOTION_WORDS = new Set(['walk', 'walking', 'walks', 'move', 'moving', 'step', 'steps', 'run', 'running']);

  /** 'walk-down' / 'walkDown' / 'Walk Down' -> ['walk','down'] */
  function tokens(name) {
    return String(name || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map(t => t.toLowerCase());
  }
  /**
   * split(tagName) -> { dir, action, motion }
   *   dir    'down'|'up'|'left'|'right'|null
   *   action the remaining words ('idle', '' for a bare walk cycle)
   */
  function split(name) {
    const parts = tokens(name);
    let dir = null, motion = false;
    const rest = [];
    for (const t of parts) {
      const d = Object.prototype.hasOwnProperty.call(DIR_WORDS, t) ? DIR_WORDS[t] : undefined;
      if (d && !dir) { dir = d; continue; }
      if (MOTION_WORDS.has(t)) { motion = true; continue; }
      rest.push(t);
    }
    return { dir, action: rest.join('-'), motion };
  }
  /** direction(name) -> the Kit direction a tag name asks for, or null. */
  A.direction = (name) => split(name).dir;
  A.DIRS = ['down', 'left', 'right', 'up'];

  /** The frame indices a tag plays, honouring `direction` (forward/reverse/pingpong/pingpong_reverse). */
  function tagFrames(from, to, direction) {
    const lo = Math.min(from, to), hi = Math.max(from, to);
    const fwd = [];
    for (let i = lo; i <= hi; i++) fwd.push(i);
    const dir = String(direction || 'forward').toLowerCase();
    if (dir === 'reverse') return fwd.slice().reverse();
    if (dir === 'pingpong') return fwd.concat(fwd.slice(1, -1).reverse());
    if (dir === 'pingpong_reverse') {
      const rev = fwd.slice().reverse();
      return rev.concat(rev.slice(1, -1).reverse());
    }
    return fwd;
  }
  A.tagFrames = tagFrames;

  // ---- 1. the sheet export (--sheet + --data) ---------------------------------
  function toJson(input) {
    if (typeof input === 'string') { try { return JSON.parse(input); } catch (e) { return null; } }
    const bytes = asBytes(input);
    if (bytes) {
      try {
        const text = typeof TextDecoder !== 'undefined' ? new TextDecoder().decode(bytes) : String.fromCharCode.apply(null, bytes);
        return JSON.parse(text);
      } catch (e) { return null; }
    }
    return isObj(input) ? input : null;
  }

  /**
   * Both export shapes become the same list.
   *   json-hash : frames is an object keyed by the filename format ('{title} {frame}.{extension}')
   *   json-array: frames is an array whose entries carry `filename`
   * The frame number in the key/filename orders the list when every entry has one, so the two
   * exports of one sprite produce byte-identical results.
   */
  function frameList(json, st) {
    const res = st.res;
    const src = json.frames;
    const raw = [];
    if (Array.isArray(src)) {
      src.forEach((f, i) => { if (isObj(f)) raw.push({ key: String(f.filename == null ? i : f.filename), entry: f, at: i }); });
    } else if (isObj(src)) {
      Object.keys(src).forEach((k, i) => { if (isObj(src[k])) raw.push({ key: k, entry: src[k], at: i }); });
    }
    if (!raw.length) { problem(res, 'error', 'no-frames', 'the sheet data has no frames', st.where); return []; }

    // '{title} {frame}.{extension}' — the trailing number is the frame index.
    const numbered = raw.map(r => { const m = /(\d+)\s*(?:\.[A-Za-z0-9]+)?$/.exec(r.key); return m ? parseInt(m[1], 10) : null; });
    const ordered = numbered.every(n => n !== null) && new Set(numbered).size === numbered.length;
    const list = raw.map((r, i) => Object.assign({}, r, { n: ordered ? numbered[i] : r.at }));
    list.sort((a, b) => (a.n - b.n) || (a.at - b.at));

    // A dropped frame leaves a hole rather than shifting its neighbours: tags address
    // frames by number, so renumbering would silently point them at the wrong art.
    const out = new Array(list.length).fill(null);
    list.forEach((r, index) => {
      const f = r.entry;
      const rect = isObj(f.frame) ? f.frame : null;
      if (!rect || !(num(rect.w, 0) > 0) || !(num(rect.h, 0) > 0)) {
        problem(res, 'warn', 'bad-frame', `frame '${r.key}' has no usable rectangle and was skipped`, st.where);
        return;
      }
      if (f.rotated === true) {
        problem(res, 'warn', 'rotated-frame', `frame '${r.key}' is stored rotated; Kit draws sheet rectangles upright, so the frame was skipped (re-export without rotation)`, st.where);
        return;
      }
      const source = isObj(f.sourceSize) ? f.sourceSize : { w: rect.w, h: rect.h };
      const sss = isObj(f.spriteSourceSize) ? f.spriteSourceSize : { x: 0, y: 0, w: rect.w, h: rect.h };
      const ox = int(sss.x, 0), oy = int(sss.y, 0);
      const sw = int(source.w, rect.w), sh = int(source.h, rect.h);
      const trimmed = f.trimmed === true || ox !== 0 || oy !== 0 || int(rect.w, 0) !== sw || int(rect.h, 0) !== sh;
      const r2 = { x: int(rect.x, 0), y: int(rect.y, 0), w: int(rect.w, 0), h: int(rect.h, 0) };
      if (trimmed) {
        // Kit's image art is a plain sheet rectangle, so the offset travels with it:
        // draw the w×h slice at (ox, oy) inside an sw×sh box and the sprite never jitters.
        r2.ox = ox; r2.oy = oy; r2.sw = sw; r2.sh = sh;
        once(st, 'info', 'trimmed-offset', 'sheet',
          `some frames were exported with --trim; each keeps its spriteSourceSize as ox/oy inside a ${sw}x${sh} box so the art stays put between frames`);
      }
      out[index] = { key: r.key, index, rect: r2, w: sw, h: sh, trimmed, duration: int(f.duration, 100) };
    });
    return out;
  }

  function sheetAsset(json, st) {
    const res = st.res, o = st.opts, meta = isObj(json.meta) ? json.meta : {};
    const size = isObj(meta.size) ? meta.size : {};
    const src = o.image || meta.image || (o.name ? stem(o.name) + '.png' : null);
    const fallbackId = withPrefix(slug(stem(src || o.id || o.name || 'aseprite')), o);
    let def;
    if (typeof o.asset === 'function' && src) {
      const a = o.asset(src) || {};
      def = { id: String(a.id || fallbackId), src: String(a.src == null ? src : a.src), w: int(a.w, int(size.w, 0)), h: int(a.h, int(size.h, 0)) };
    } else {
      if (!src) problem(res, 'warn', 'asset-unresolved', 'the sheet data names no image (meta.image is missing) — pass opts.image', st.where);
      else problem(res, 'warn', 'asset-unresolved', `no opts.asset resolver: the sheet image was recorded as '${src}' and must be added to the project by hand`, st.where);
      def = { id: fallbackId, src: src || '', w: int(size.w, 0), h: int(size.h, 0) };
    }
    res.assets[def.id] = { kind: 'image', src: def.src, w: def.w, h: def.h, from: `aseprite:${src || def.id}` };
    return def;
  }

  function readTags(json, st, frameCount) {
    const meta = isObj(json.meta) ? json.meta : {};
    const list = Array.isArray(meta.frameTags) ? meta.frameTags : (Array.isArray(meta.tags) ? meta.tags : []);
    const out = [];
    for (const t of list) {
      if (!isObj(t)) continue;
      const name = String(t.name == null ? '' : t.name);
      let from = int(t.from, 0), to = int(t.to, 0);
      if (from > to) { const s = from; from = to; to = s; }
      if (frameCount > 0 && (from < 0 || to >= frameCount)) {
        problem(st.res, 'warn', 'tag-range', `tag '${name}' covers frames ${from}-${to} but the sheet has ${frameCount}; it was clamped`, st.where);
        from = Math.max(0, Math.min(from, frameCount - 1));
        to = Math.max(0, Math.min(to, frameCount - 1));
      }
      out.push({
        name,
        from, to,
        direction: String(t.direction || 'forward'),
        repeat: t.repeat == null ? 0 : int(t.repeat, 0),   // the exporter writes this as a string
        color: typeof t.color === 'string' ? t.color : null,
        data: typeof t.data === 'string' ? t.data : null,
      });
    }
    return out;
  }

  /** Tags -> { dirs: Map<spriteKey, {action, dirs:{down:[i],..}, tags:{}}>, others: [tag] } */
  function groupTags(tags, st) {
    const sprites = new Map();
    const others = [];
    for (const tag of tags) {
      const s = split(tag.name);
      if (!s.dir) {
        problem(st.res, 'info', 'tag-direction', `tag '${tag.name}' does not name a direction, so it became a stand-alone animation`, st.where);
        others.push(tag);
        continue;
      }
      const key = s.action;                               // '' for a bare walk cycle
      let group = sprites.get(key);
      if (!group) { group = { action: key, dirs: {}, tags: {} }; sprites.set(key, group); }
      if (group.dirs[s.dir]) {
        problem(st.res, 'warn', 'duplicate-id', `two tags claim the '${s.dir}' frames of '${key || 'the walk cycle'}' ('${group.tags[s.dir].name}' and '${tag.name}') — the first one was kept`, st.where);
        continue;
      }
      group.dirs[s.dir] = tagFrames(tag.from, tag.to, tag.direction);
      group.tags[s.dir] = tag;
    }
    return { sprites, others };
  }

  function baseId(st) {
    const o = st.opts;
    const meta = st.meta || {};
    return slug(o.id || stem(o.name || '') || stem(meta.image || '') || 'aseprite');
  }

  function sliceBucket(name, st) {
    const t = tokens(name);
    if (t.some(w => ['face', 'faces', 'portrait', 'bust', 'mug', 'headshot'].includes(w))) return 'faces';
    if (t.some(w => ['icon', 'icons', 'badge', 'pip', 'symbol'].includes(w))) return 'icons';
    const kind = String((st.opts && st.opts.kind) || '').toLowerCase();
    if (kind === 'face' || kind === 'faces') return 'faces';
    if (kind === 'icon' || kind === 'icons') return 'icons';
    return null;
  }

  function importSlices(json, st, assetId) {
    const meta = isObj(json.meta) ? json.meta : {};
    const list = Array.isArray(meta.slices) ? meta.slices : [];
    const base = baseId(st);
    for (const s of list) {
      if (!isObj(s)) continue;
      const name = String(s.name == null ? '' : s.name);
      const keys = Array.isArray(s.keys) ? s.keys.filter(k => isObj(k) && isObj(k.bounds)) : [];
      if (!keys.length) { problem(st.res, 'info', 'slice-animated', `slice '${name}' has no keys and was skipped`, st.where); continue; }
      const rects = keys.map(k => ({ x: int(k.bounds.x, 0), y: int(k.bounds.y, 0), w: int(k.bounds.w, 0), h: int(k.bounds.h, 0) })).filter(r => r.w > 0 && r.h > 0);
      if (!rects.length) { problem(st.res, 'info', 'slice-animated', `slice '${name}' is hidden in every key (zero size) and was skipped`, st.where); continue; }
      if (rects.length > 1) problem(st.res, 'info', 'slice-animated', `slice '${name}' moves across ${rects.length} keys; all of them became animation frames`, st.where);
      const id = withPrefix(`${base}-${slug(name)}`, st.opts);
      if (!claim(st, id)) continue;
      const art = rects.length > 1 ? { image: assetId, frames: rects } : { image: assetId, frame: rects[0] };
      const def = { id, name: titleCase(name) || id, group: base, art, w: rects[0].w, h: rects[0].h, from: 'aseprite' };
      const k0 = keys[0];
      if (isObj(k0.center)) def.center = { x: int(k0.center.x, 0), y: int(k0.center.y, 0), w: int(k0.center.w, 0), h: int(k0.center.h, 0) };
      if (isObj(k0.pivot)) def.pivot = { x: int(k0.pivot.x, 0), y: int(k0.pivot.y, 0) };
      if (typeof s.color === 'string') def.color = s.color;
      if (typeof s.data === 'string') def.note = s.data;
      def.slice = name;
      const bucket = sliceBucket(name, st);
      if (bucket === 'faces') st.res.faces.push(def);
      else if (bucket === 'icons') st.res.icons.push(def);
      else st.res.slices.push(def);
    }
  }

  function importLayerMeta(json, st) {
    const meta = isObj(json.meta) ? json.meta : {};
    const layers = Array.isArray(meta.layers) ? meta.layers : [];
    const out = [];
    for (const l of layers) {
      if (!isObj(l)) continue;
      const mode = String(l.blendMode || 'normal');
      if (mode !== 'normal') {
        problem(st.res, 'info', 'blend-mode', `layer '${l.name}' uses the '${mode}' blend mode; the sheet is already flattened, so this is recorded for reference only`, st.where);
      }
      out.push({ name: String(l.name == null ? '' : l.name), opacity: l.opacity == null ? 255 : int(l.opacity, 255), blendMode: mode, group: l.group == null ? null : String(l.group) });
    }
    return out;
  }

  /**
   * sheet(json, opts) -> Result
   * An Aseprite `--sheet sheet.png --data sheet.json` export becomes image-backed Kit content:
   * one asset for the sheet plus sprites (from direction tags), animations (from every other tag),
   * tiles (opts.kind === 'tiles'), and faces/icons/slices from meta.slices.
   */
  A.sheet = function (json, opts) {
    const st = newState(opts);
    const j = toJson(json);
    if (!j || A.detect(j) !== 'sheet') {
      throw new TypeError('aseprite: this is not an Aseprite sheet export (expected the JSON written by --data, with "frames" and "meta")');
    }
    st.meta = isObj(j.meta) ? j.meta : {};
    const res = st.res;
    const asset = sheetAsset(j, st);
    const frames = frameList(j, st);
    const base = baseId(st);
    const layers = importLayerMeta(j, st);
    const tags = readTags(j, st, frames.length);
    const kind = String(st.opts.kind || 'sprite').toLowerCase();

    importSlices(j, st, asset.id);

    if (frames.some(Boolean)) {
      if (kind === 'tiles') {
        buildTiles(frames, st, asset.id, base);
      } else {
        const { sprites, others } = groupTags(tags, st);
        for (const [action, group] of sprites) buildSheetSprite(group, action, frames, st, asset.id, base);
        for (const tag of others) buildSheetAnimation(tag, frames, st, asset.id, base);
        if (!sprites.size && !others.length && kind !== 'faces' && kind !== 'icons') buildSheetSprite(null, '', frames, st, asset.id, base);
      }
    }

    const scale = st.meta.scale == null ? 1 : num(st.meta.scale, 1);
    if (scale !== 1) problem(res, 'info', 'grid-uneven', `the sheet was exported at scale ${scale}; its rectangles are in exported pixels, not sprite pixels`, st.where);
    return finish(st, { frames: frames.length, tags: tags.length, layers: layers.length, format: Array.isArray(j.frames) ? 'json-array' : 'json-hash' });
  };

  function rectsOf(frames, indices, st) {
    const out = [], durations = [];
    for (const i of indices) {
      const f = frames[i];
      if (!f) continue;                                   // a rotated/broken frame was dropped earlier
      out.push(f.rect);
      durations.push(f.duration);
    }
    return { rects: out, durations };
  }

  function buildSheetSprite(group, action, frames, st, assetId, base) {
    const id = withPrefix(action ? `${base}-${action}` : base, st.opts);
    if (!claim(st, id)) return;
    const def = { id, name: titleCase(action ? `${base} ${action}` : base), group: 'aseprite', image: assetId, frames: {}, durations: {}, from: 'aseprite' };
    let w = 0, h = 0;
    if (group) {
      for (const dir of A.DIRS) {
        const idx = group.dirs[dir];
        if (!idx) continue;
        const { rects, durations } = rectsOf(frames, idx, st);
        if (!rects.length) continue;
        def.frames[dir] = rects;
        def.durations[dir] = durations;
        const src = frames[idx.find(i => frames[i])];
        if (src) { w = Math.max(w, src.w); h = Math.max(h, src.h); }
      }
      const tag = group.tags.down || group.tags.left || group.tags.up || group.tags.right;
      if (tag) { def.tag = tag.name; if (tag.repeat) def.repeat = tag.repeat; }
    } else {
      // No tags at all: one sprite whose every frame is the `down` list. KIT.entities.frame
      // falls back to frames.down for any direction, so the sprite still draws.
      const dense = frames.filter(Boolean);
      def.frames.down = dense.map(f => f.rect);
      def.durations.down = dense.map(f => f.duration);
      w = dense[0].w; h = dense[0].h;
      problem(st.res, 'info', 'tag-direction', `the sheet has no direction tags, so its ${dense.length} frame(s) became the single sprite '${id}'`, st.where);
    }
    if (!Object.keys(def.frames).length) return;
    def.w = w; def.h = h;
    st.res.sprites.push(def);
  }

  function buildSheetAnimation(tag, frames, st, assetId, base) {
    const id = withPrefix(`${base}-${slug(tag.name)}`, st.opts);
    if (!claim(st, id)) return;
    const { rects, durations } = rectsOf(frames, tagFrames(tag.from, tag.to, tag.direction), st);
    if (!rects.length) return;
    const first = frames[Math.min(tag.from, tag.to)] || frames.find(Boolean);
    st.res.animations.push({
      id, name: titleCase(tag.name) || id, group: base, image: assetId,
      w: first.w, h: first.h, frames: rects, durations,
      tag: tag.name, direction: tag.direction, repeat: tag.repeat, from: 'aseprite',
    });
  }

  function buildTiles(frames, st, assetId, base) {
    const dense = frames.filter(Boolean);
    const w = dense[0].rect.w, h = dense[0].rect.h;
    if (dense.some(f => f.rect.w !== w || f.rect.h !== h)) {
      problem(st.res, 'info', 'grid-uneven', 'the sheet is not a regular grid (some rectangles differ in size, which --trim does), so each tile kept its own rectangle', st.where);
    }
    frames.forEach((f, i) => {
      if (!f) return;
      const id = withPrefix(`${base}:${i}`, st.opts);
      if (!claim(st, id)) return;
      st.res.tiles.push({ id, name: titleCase(`${base} ${i}`), group: base, art: { image: assetId, frame: f.rect }, from: 'aseprite' });
    });
    if (w === h && w > 0) {
      st.res.project = st.res.project || {};
      st.res.project.settings = Object.assign({}, st.res.project.settings, { tileSize: w });
    }
  }

  // ---- 2. the binary document (.aseprite / .ase) ------------------------------
  const MAGIC = 0xA5E0, FRAME_MAGIC = 0xF1FA;
  const CHUNK = {
    OLD_PALETTE_4: 0x0004, OLD_PALETTE_11: 0x0011, LAYER: 0x2004, CEL: 0x2005, CEL_EXTRA: 0x2006,
    COLOR_PROFILE: 0x2007, EXTERNAL_FILES: 0x2008, MASK: 0x2016, PATH: 0x2017, TAGS: 0x2018,
    PALETTE: 0x2019, USER_DATA: 0x2020, SLICE: 0x2022, TILESET: 0x2023,
  };
  const BLEND_NAMES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color_dodge',
    'color_burn', 'hard_light', 'soft_light', 'difference', 'exclusion', 'hsl_hue', 'hsl_saturation',
    'hsl_color', 'hsl_luminosity', 'addition', 'subtract', 'divide'];
  const ANIDIR_NAMES = ['forward', 'reverse', 'pingpong', 'pingpong_reverse'];

  function reader(bytes) {
    let p = 0;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const r = {
      get pos() { return p; },
      set pos(v) { p = v; },
      get length() { return bytes.length; },
      u8() { return dv.getUint8(p++); },
      u16() { const v = dv.getUint16(p, true); p += 2; return v; },
      i16() { const v = dv.getInt16(p, true); p += 2; return v; },
      u32() { const v = dv.getUint32(p, true); p += 4; return v; },
      i32() { const v = dv.getInt32(p, true); p += 4; return v; },
      skip(n) { p += n; },
      bytes(n) { const v = bytes.subarray(p, p + n); p += n; return v; },
      str() {
        const n = dv.getUint16(p, true); p += 2;
        const raw = bytes.subarray(p, p + n); p += n;
        if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(raw);
        let s = ''; for (let i = 0; i < raw.length; i++) s += String.fromCharCode(raw[i]);
        return s;
      },
    };
    return r;
  }

  /**
   * parse(buffer, opts) -> { header, layers, frames, tags, slices, palette, problems }
   * The raw document, one level below file(): every chunk this importer understands, decoded
   * but not composited. Exposed because Creator Mode wants the layer list before importing.
   */
  A.parse = function (buffer, opts) {
    const bytes = asBytes(buffer);
    if (!bytes || bytes.length < 128) throw new TypeError('aseprite: this is not an .aseprite file (too short for the 128-byte header)');
    const st = newState(opts);
    const r = reader(bytes);
    const fileSize = r.u32();
    const magic = r.u16();
    if (magic !== MAGIC) throw new TypeError(`aseprite: this is not an .aseprite file (magic 0x${magic.toString(16)}, expected 0xa5e0)`);
    const header = {
      fileSize,
      frames: r.u16(), width: r.u16(), height: r.u16(), depth: r.u16(),
      flags: r.u32(), speed: r.u16(),
    };
    r.u32(); r.u32();
    header.transparentIndex = r.u8();
    r.skip(3);
    header.colors = r.u16();
    header.pixelW = r.u8(); header.pixelH = r.u8();
    header.gridX = r.i16(); header.gridY = r.i16();
    header.gridW = r.u16(); header.gridH = r.u16();
    r.pos = 128;
    if (header.colors === 0) header.colors = 256;                    // 0 means 256 on old sprites
    if (![8, 16, 32].includes(header.depth)) throw new TypeError(`aseprite: unknown colour depth ${header.depth} (expected 8, 16 or 32)`);
    header.mode = header.depth === 32 ? 'rgba' : header.depth === 16 ? 'grayscale' : 'indexed';
    if (header.mode === 'grayscale') problem(st.res, 'info', 'grayscale', 'the sprite is greyscale; each value became an equal r/g/b', st.where);

    const doc = {
      header, layers: [], frames: [], tags: [], slices: [], tilesets: [],
      palette: new Array(256).fill(null), problems: st.res.problems,
    };
    const stack = [];                                                // layer groups by child level

    for (let f = 0; f < header.frames; f++) {
      if (r.pos + 16 > bytes.length) { problem(st.res, 'warn', 'bad-frame', `frame ${f} is missing: the file ends after ${doc.frames.length} frame(s)`, st.where); break; }
      const frameStart = r.pos;
      const frameBytes = r.u32();
      const fmagic = r.u16();
      if (fmagic !== FRAME_MAGIC) { problem(st.res, 'warn', 'bad-frame', `frame ${f} has magic 0x${fmagic.toString(16)} instead of 0xf1fa; reading stopped`, st.where); break; }
      const oldChunks = r.u16();
      const duration = r.u16();
      r.skip(2);
      const newChunks = r.u32();
      const chunks = newChunks || oldChunks;
      const frame = { index: f, duration: duration || header.speed || 100, cels: [] };
      const frameEnd = Math.min(bytes.length, frameStart + (frameBytes || (bytes.length - frameStart)));
      let last = null;                                               // for user-data chunks
      let tagUserData = 0;

      for (let c = 0; c < chunks; c++) {
        if (r.pos + 6 > frameEnd) break;
        const chunkStart = r.pos;
        let size = r.u32();
        const type = r.u16();
        if (size < 6) size = 6;
        const end = Math.min(frameEnd, chunkStart + size);
        try {
          switch (type) {
            case CHUNK.LAYER: last = readLayer(r, doc, stack, header, st); break;
            case CHUNK.CEL: last = readCel(r, end, doc, frame, header, st); break;
            case CHUNK.TAGS: readTagChunk(r, doc, st); tagUserData = 0; last = { kind: 'tags' }; break;
            case CHUNK.PALETTE: readPalette(r, doc); last = { kind: 'palette' }; break;
            case CHUNK.OLD_PALETTE_4: readOldPalette(r, doc, 1); last = { kind: 'palette' }; break;
            case CHUNK.OLD_PALETTE_11: readOldPalette(r, doc, 255 / 63); last = { kind: 'palette' }; break;
            case CHUNK.SLICE: last = readSlice(r, doc, st); break;
            case CHUNK.COLOR_PROFILE: readColorProfile(r, doc, st); break;
            case CHUNK.TILESET: readTileset(r, end, doc, st); last = { kind: 'tileset' }; break;
            case CHUNK.USER_DATA: {
              const ud = readUserData(r, end);
              if (last && last.kind === 'tags') { const t = doc.tags[tagUserData++]; if (t) applyUserData(t, ud); }
              else if (last && last.obj) applyUserData(last.obj, ud);
              break;
            }
            case CHUNK.CEL_EXTRA: case CHUNK.EXTERNAL_FILES: case CHUNK.MASK: case CHUNK.PATH: break;
            default:
              once(st, 'info', 'unknown-chunk', String(type), `chunk type 0x${type.toString(16)} is not read by this importer and was skipped`);
          }
        } catch (e) {
          problem(st.res, 'warn', 'bad-frame', `chunk 0x${type.toString(16)} in frame ${f} could not be read (${e.message}); it was skipped`, st.where);
        }
        r.pos = end;
      }
      doc.frames.push(frame);
      r.pos = frameEnd;
    }
    // Every layer's effective visibility, once the whole tree is known (NOTE.1).
    for (const l of doc.layers) {
      let v = l.visible, p = l.parent;
      while (p) { if (!p.visible) v = false; p = p.parent; }
      l.shown = v;
    }
    return doc;
  };

  function readLayer(r, doc, stack, header, st) {
    const flags = r.u16();
    const type = r.u16();
    const level = r.u16();
    r.u16(); r.u16();
    const blend = r.u16();
    const opacity = r.u8();
    r.skip(3);
    const name = r.str();
    const layer = {
      index: doc.layers.length, name, level, type,
      visible: (flags & 1) !== 0, background: (flags & 8) !== 0, reference: (flags & 64) !== 0,
      blend: BLEND_NAMES[blend] || `mode-${blend}`,
      opacity: (header.flags & 1) ? opacity : 255,
      parent: null,
    };
    if (type === 2) layer.tileset = r.u32();
    stack.length = level;
    layer.parent = level > 0 ? (stack[level - 1] || null) : null;
    stack[level] = layer;
    doc.layers.push(layer);
    if (type === 0 && layer.blend !== 'normal') {
      once(st, 'info', 'blend-mode', layer.blend, `layer '${name}' uses the '${layer.blend}' blend mode; Kit composites normal only, so it was blended as normal`);
    }
    return { kind: 'layer', obj: layer };
  }

  function readCel(r, end, doc, frame, header, st) {
    const layerIndex = r.u16();
    const x = r.i16(), y = r.i16();
    const opacity = r.u8();
    const type = r.u16();
    const z = r.i16();
    r.skip(5);
    const cel = { layer: layerIndex, x, y, opacity, type, z, w: 0, h: 0, pixels: null, link: null };
    if (type === 0 || type === 2) {
      cel.w = r.u16(); cel.h = r.u16();
      const need = cel.w * cel.h * (header.depth / 8);
      if (type === 0) {
        cel.pixels = r.bytes(need);
      } else {
        const raw = r.bytes(end - r.pos);
        const out = inflate(raw, st.opts);
        if (!out) {
          problem(st.res, 'error', 'compressed-unsupported', `the zlib cel on layer ${layerIndex} of frame ${frame.index} could not be decompressed here — pass opts.inflate(bytes) -> Uint8Array`, st.where);
        } else if (out.length < need) {
          problem(st.res, 'warn', 'bad-frame', `the cel on layer ${layerIndex} of frame ${frame.index} decompressed to ${out.length} bytes, ${need} were expected; it was skipped`, st.where);
        } else {
          cel.pixels = out.subarray(0, need);
        }
      }
    } else if (type === 1) {
      cel.link = r.u16();
    } else if (type === 3) {
      once(st, 'warn', 'tilemap-cel', String(layerIndex), `layer ${layerIndex} is a tilemap; Kit has no tilemap layers, so its cels were skipped (export the sprite as a sheet instead)`);
    }
    frame.cels.push(cel);
    return { kind: 'cel', obj: cel };
  }

  function readTagChunk(r, doc, st) {
    const n = r.u16();
    r.skip(8);
    for (let i = 0; i < n; i++) {
      const from = r.u16(), to = r.u16();
      const aniDir = r.u8();
      const repeat = r.u16();
      r.skip(6);
      const rgb = [r.u8(), r.u8(), r.u8()];
      r.u8();
      const name = r.str();
      doc.tags.push({ name, from, to, direction: ANIDIR_NAMES[aniDir] || 'forward', repeat, color: `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`, data: null });
    }
  }

  function readPalette(r, doc) {
    const size = r.u32();
    const first = r.u32(), last = r.u32();
    r.skip(8);
    if (doc.palette.length < size) doc.palette.length = size;
    for (let i = first; i <= last; i++) {
      const flags = r.u16();
      const c = [r.u8(), r.u8(), r.u8(), r.u8()];
      if (flags & 1) r.str();
      doc.palette[i] = c;
    }
  }
  function readOldPalette(r, doc, scale) {
    const packets = r.u16();
    let index = 0;
    for (let p = 0; p < packets; p++) {
      index += r.u8();
      let n = r.u8(); if (n === 0) n = 256;
      for (let i = 0; i < n; i++) {
        const c = [Math.round(r.u8() * scale), Math.round(r.u8() * scale), Math.round(r.u8() * scale), 255];
        if (!doc.palette[index]) doc.palette[index] = c;              // 0x2019 wins when both exist
        index++;
      }
    }
  }
  function readColorProfile(r, doc, st) {
    const type = r.u16();
    doc.colorProfile = type === 0 ? 'none' : type === 1 ? 'srgb' : 'icc';
    if (type === 2) problem(st.res, 'info', 'colour-profile', 'the file embeds an ICC profile; its colours were read as plain sRGB values', st.where);
  }
  function readSlice(r, doc, st) {
    const n = r.u32();
    const flags = r.u32();
    r.u32();
    const name = r.str();
    const keys = [];
    for (let i = 0; i < n; i++) {
      const key = { frame: r.u32(), bounds: { x: r.i32(), y: r.i32(), w: r.u32(), h: r.u32() } };
      if (flags & 1) key.center = { x: r.i32(), y: r.i32(), w: r.u32(), h: r.u32() };
      if (flags & 2) key.pivot = { x: r.i32(), y: r.i32() };
      keys.push(key);
    }
    const slice = { name, keys, ninePatch: (flags & 1) !== 0, color: null, data: null };
    doc.slices.push(slice);
    return { kind: 'slice', obj: slice };
  }
  function readTileset(r, end, doc, st) {
    const id = r.u32(); const flags = r.u32(); const count = r.u32();
    const w = r.u16(), h = r.u16();
    r.i16(); r.skip(14);
    const name = r.str();
    doc.tilesets.push({ id, name, count, w, h, flags });
    once(st, 'info', 'tileset-skipped', String(id), `tileset '${name || id}' was listed but its tiles were not imported (Kit tiles come from a sheet export or a Tiled tileset)`);
  }
  function readUserData(r, end) {
    const flags = r.u32();
    const out = { text: null, color: null };
    if (flags & 1) out.text = r.str();
    if (flags & 2) { const c = [r.u8(), r.u8(), r.u8(), r.u8()]; out.color = `#${c.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('')}`; }
    return out;                                                       // properties (flag 4) are skipped: r.pos jumps to `end`
  }
  function applyUserData(obj, ud) {
    if (ud.text != null) obj.data = ud.text;
    if (ud.color != null) obj.color = ud.color;
  }

  // ---- compositing -----------------------------------------------------------
  /** One cel's pixel at (i) as [r,g,b,a], whatever the colour depth. */
  function celPixel(cel, i, header, doc, layer, out) {
    const px = cel.pixels;
    if (header.mode === 'rgba') {
      const o = i * 4;
      out[0] = px[o]; out[1] = px[o + 1]; out[2] = px[o + 2]; out[3] = px[o + 3];
    } else if (header.mode === 'grayscale') {
      const o = i * 2;
      out[0] = out[1] = out[2] = px[o]; out[3] = px[o + 1];
    } else {
      const idx = px[i];
      const c = doc.palette[idx];
      if (idx === header.transparentIndex && !layer.background) { out[3] = 0; return out; }
      if (!c) { out[0] = out[1] = out[2] = 0; out[3] = 0; return out; }
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = c[3];
    }
    return out;
  }

  /**
   * composite(doc, frameIndex, st) -> Uint8ClampedArray of w*h*4 RGBA.
   * Visible, normal-blended layers in z order (NOTE.5), each cel scaled by
   * layerOpacity * celOpacity, source-over.
   */
  function composite(doc, frameIndex, st) {
    const header = doc.header;
    const W = header.width, H = header.height;
    const buf = new Uint8ClampedArray(W * H * 4);
    const frame = doc.frames[frameIndex];
    if (!frame) return buf;
    const plan = frame.cels
      .map(cel => ({ cel, layer: doc.layers[cel.layer] }))
      .filter(e => e.layer && e.layer.type !== 1 && e.layer.shown)
      .map(e => Object.assign(e, { order: e.layer.index + (e.cel.z || 0) }))
      .sort((a, b) => (a.order - b.order) || ((a.cel.z || 0) - (b.cel.z || 0)) || (a.layer.index - b.layer.index));

    const px = [0, 0, 0, 0];
    for (const { cel, layer } of plan) {
      let src = cel;
      if (cel.type === 1) {                                           // linked cel: the same layer, another frame
        const donor = doc.frames[cel.link];
        src = donor ? donor.cels.find(c => c.layer === cel.layer && c.type !== 1) : null;
        if (!src || !src.pixels) {
          problem(st.res, 'warn', 'linked-cel-missing', `the cel on layer ${cel.layer} of frame ${frameIndex} links to frame ${cel.link}, which has no image there`, st.where);
          continue;
        }
      }
      if (!src.pixels) continue;
      const alphaScale = (layer.opacity / 255) * (cel.opacity / 255);
      for (let cy = 0; cy < src.h; cy++) {
        const y = cel.y + cy;
        if (y < 0 || y >= H) continue;
        for (let cx = 0; cx < src.w; cx++) {
          const x = cel.x + cx;
          if (x < 0 || x >= W) continue;
          celPixel(src, cy * src.w + cx, header, doc, layer, px);
          const sa = (px[3] / 255) * alphaScale;
          if (sa <= 0) continue;
          const o = (y * W + x) * 4;
          const da = buf[o + 3] / 255;
          const oa = sa + da * (1 - sa);
          if (oa <= 0) continue;
          buf[o] = Math.round((px[0] * sa + buf[o] * da * (1 - sa)) / oa);
          buf[o + 1] = Math.round((px[1] * sa + buf[o + 1] * da * (1 - sa)) / oa);
          buf[o + 2] = Math.round((px[2] * sa + buf[o + 2] * da * (1 - sa)) / oa);
          buf[o + 3] = Math.round(oa * 255);
        }
      }
    }
    return buf;
  }

  // ---- RGBA -> Kit pixel strings ---------------------------------------------
  const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';  // 62; '.' is transparent
  const hex2 = (v) => (v < 16 ? '0' : '') + v.toString(16);

  /**
   * quantise(buffers, w, h, opts) -> { palette, frames } | { tooMany: n }
   * Every distinct opaque colour across the frames becomes one palette character, in the order
   * the colours first appear (top-left to bottom-right, frame 0 first), so the result is stable.
   */
  function quantise(buffers, w, h, maxColors, alphaThreshold) {
    const palette = {};
    const map = new Map();
    const frames = [];
    let next = 0, partial = false;
    for (const buf of buffers) {
      const rows = [];
      for (let y = 0; y < h; y++) {
        let line = '';
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          const a = buf[o + 3];
          if (a < alphaThreshold) { line += '.'; continue; }
          if (a < 255) partial = true;
          const hex = '#' + hex2(buf[o]) + hex2(buf[o + 1]) + hex2(buf[o + 2]);
          let ch = map.get(hex);
          if (ch === undefined) {
            if (next >= maxColors || next >= CHARS.length) return { tooMany: map.size + 1 };
            ch = CHARS[next++];
            map.set(hex, ch);
            palette[ch] = hex;
          }
          line += ch;
        }
        rows.push(line);
      }
      frames.push(rows);
    }
    return { palette, frames, partial };
  }
  A.quantise = (buffers, w, h, opts) => quantise(buffers, w, h, (opts && opts.maxColors) || 60, (opts && opts.alphaThreshold) || 128);

  /** A PNG data: URI for the frames laid out in one row. Node first, then a canvas, then null. */
  function sheetPng(buffers, w, h, st) {
    const W = w * buffers.length, H = h;
    const rgba = new Uint8Array(W * H * 4);
    buffers.forEach((buf, i) => {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const s = (y * w + x) * 4, d = (y * W + (i * w + x)) * 4;
          rgba[d] = buf[s]; rgba[d + 1] = buf[s + 1]; rgba[d + 2] = buf[s + 2]; rgba[d + 3] = buf[s + 3];
        }
      }
    });
    const o = st.opts;
    if (typeof o.encodePng === 'function') {
      try {
        const out = o.encodePng(W, H, rgba);
        if (typeof out === 'string') return { src: out, w: W, h: H };
        const bytes = asBytes(out);
        if (bytes) return { src: 'data:image/png;base64,' + base64(bytes), w: W, h: H };
      } catch (e) { /* fall through */ }
    }
    if (typeof require === 'function') {
      try {
        const png = require('../../../tools/sprite-png.js');
        const bytes = asBytes(png.encodePng(W, H, typeof Buffer !== 'undefined' ? Buffer.from(rgba) : rgba));
        if (bytes) return { src: 'data:image/png;base64,' + base64(bytes), w: W, h: H };
      } catch (e) { /* fall through */ }
    }
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      try {
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d');
        const img = ctx.createImageData(W, H);
        img.data.set(rgba);
        ctx.putImageData(img, 0, 0);
        return { src: cv.toDataURL('image/png'), w: W, h: H };
      } catch (e) { /* fall through */ }
    }
    problem(st.res, 'warn', 'png-unavailable', 'the art is too big for pixel strings and no PNG encoder is available here — pass opts.encodePng(w, h, rgba)', st.where);
    return null;
  }

  /**
   * file(buffer, opts) -> Result
   * The .aseprite document itself, composited into NATIVE Kit pixel-string art.
   *   opts.maxPixels      w*h above which the art falls back to an image asset (default 4096 = 64x64)
   *   opts.maxColors      distinct colours above which it falls back (default 60)
   *   opts.alphaThreshold a composited alpha below this is transparent (default 128)
   *   opts.kind           'sprite' (default) | 'faces' | 'icons'
   */
  A.file = function (buffer, opts) {
    const st = newState(opts);
    const doc = A.parse(buffer, Object.assign({}, st.opts, { where: st.where }));
    for (const p of doc.problems) st.res.problems.push(p);            // parse() collected into its own bag
    const header = doc.header;
    const res = st.res;
    const base = slug(st.opts.id || stem(st.opts.name || '') || 'aseprite');
    const W = header.width, H = header.height;

    if (header.mode === 'indexed' && !doc.palette.some(Boolean)) {
      problem(res, 'warn', 'indexed-no-palette', 'the sprite is indexed but carries no palette chunk; every pixel became transparent', st.where);
    }

    const buffers = doc.frames.map((f, i) => composite(doc, i, st));
    const durations = doc.frames.map(f => f.duration);
    const empty = buffers.filter(b => !b.some((v, i) => i % 4 === 3 && v > 0)).length;
    if (empty) problem(res, 'info', 'empty-frame', `${empty} of ${buffers.length} frame(s) composited to nothing (hidden layers, or no cels)`, st.where);

    const maxPixels = st.opts.maxPixels == null ? 64 * 64 : int(st.opts.maxPixels, 64 * 64);
    const maxColors = st.opts.maxColors == null ? 60 : int(st.opts.maxColors, 60);
    const alphaThreshold = st.opts.alphaThreshold == null ? 128 : int(st.opts.alphaThreshold, 128);

    let art = null, fallback = null;
    if (W * H > maxPixels) {
      problem(res, 'info', 'art-too-big', `${W}x${H} is more than opts.maxPixels (${maxPixels}) — the frames became an image asset instead of pixel strings`, st.where);
    } else {
      const q = quantise(buffers, W, H, maxColors, alphaThreshold);
      if (q.tooMany) {
        problem(res, 'info', 'art-too-big', `the frames need more than ${maxColors} colours (Kit palettes are one character per colour) — they became an image asset instead of pixel strings`, st.where);
      } else {
        art = q;
        if (q.partial) problem(res, 'info', 'alpha-flattened', `some pixels are partly transparent; anything at alpha >= ${alphaThreshold} became opaque and the rest transparent (Kit palettes have no alpha)`, st.where);
      }
    }
    if (!art) {
      const png = sheetPng(buffers, W, H, st);
      if (png) {
        const assetId = withPrefix(base, st.opts);
        res.assets[assetId] = { kind: 'image', src: png.src, w: png.w, h: png.h, from: `aseprite:${st.opts.name || base}` };
        fallback = { asset: assetId, rects: buffers.map((b, i) => ({ x: i * W, y: 0, w: W, h: H })) };
      }
    }

    const tags = doc.tags.map(t => Object.assign({}, t, { repeat: int(t.repeat, 0) }));
    for (const t of tags) {
      if (t.from < 0 || t.to >= doc.frames.length) {
        problem(res, 'warn', 'tag-range', `tag '${t.name}' covers frames ${t.from}-${t.to} but the file has ${doc.frames.length}; it was clamped`, st.where);
        t.from = Math.max(0, Math.min(t.from, doc.frames.length - 1));
        t.to = Math.max(0, Math.min(t.to, doc.frames.length - 1));
      }
    }
    const { sprites, others } = groupTags(tags, st);

    const pick = (indices) => indices.map(i => (art ? art.frames[i] : (fallback ? fallback.rects[i] : null))).filter(Boolean);
    const shell = () => (art
      ? { w: W, h: H, palette: art.palette }
      : (fallback ? { w: W, h: H, image: fallback.asset } : { w: W, h: H }));

    for (const [action, group] of sprites) {
      const id = withPrefix(action ? `${base}-${action}` : base, st.opts);
      if (!claim(st, id)) continue;
      const def = Object.assign({ id, name: titleCase(action ? `${base} ${action}` : base), group: 'aseprite' }, shell(), { frames: {}, durations: {}, from: 'aseprite' });
      for (const dir of A.DIRS) {
        const idx = group.dirs[dir];
        if (!idx) continue;
        const list = pick(idx);
        if (!list.length) continue;
        def.frames[dir] = list;
        def.durations[dir] = idx.map(i => durations[i]).filter(v => v != null);
      }
      if (!Object.keys(def.frames).length) continue;
      const tag = group.tags.down || group.tags.left || group.tags.up || group.tags.right;
      if (tag) { def.tag = tag.name; if (tag.repeat) def.repeat = tag.repeat; }
      target(res, st).push(def);
    }
    for (const t of others) {
      const id = withPrefix(`${base}-${slug(t.name)}`, st.opts);
      if (!claim(st, id)) continue;
      const list = pick(tagFrames(t.from, t.to, t.direction));
      if (!list.length) continue;
      res.animations.push(Object.assign({ id, name: titleCase(t.name) || id, group: base }, shell(), {
        frames: list, durations: tagFrames(t.from, t.to, t.direction).map(i => durations[i]),
        tag: t.name, direction: t.direction, repeat: t.repeat, from: 'aseprite',
      }));
    }
    if (!sprites.size) {
      // No direction tags: one sprite whose frames all sit under `down` (KIT.entities.frame
      // falls back to frames.down for every direction).
      const id = withPrefix(base, st.opts);
      if (claim(st, id)) {
        const list = pick(doc.frames.map((f, i) => i));
        if (list.length) {
          const def = Object.assign({ id, name: titleCase(base), group: 'aseprite' }, shell(), {
            frames: { down: list }, durations: { down: durations.slice() }, from: 'aseprite',
          });
          target(res, st).push(def);
        }
      }
    }

    for (const s of doc.slices) {
      const rects = s.keys.map(k => k.bounds).filter(b => b.w > 0 && b.h > 0);
      if (!rects.length) continue;
      res.slices.push({
        id: withPrefix(`${base}-${slug(s.name)}`, st.opts), name: titleCase(s.name) || s.name, group: base,
        rect: rects[0], rects, ninePatch: s.ninePatch,
        center: s.keys[0].center || null, pivot: s.keys[0].pivot || null,
        color: s.color || null, note: s.data || null, slice: s.name, from: 'aseprite',
      });
    }

    return finish(st, {
      layers: doc.layers.length,
      visibleLayers: doc.layers.filter(l => l.shown && l.type === 0).length,
      frames: doc.frames.length, tags: tags.length, w: W, h: H,
      mode: header.mode, native: !!art, colors: art ? Object.keys(art.palette).length : 0,
      version: header.depth,
    });
  };

  function target(res, st) {
    const kind = String((st.opts && st.opts.kind) || '').toLowerCase();
    if (kind === 'face' || kind === 'faces') return res.faces;
    if (kind === 'icon' || kind === 'icons') return res.icons;
    return res.sprites;
  }

  /** artOf(spriteDef, dir) -> { w, h, palette, frames } — a KIT.pixels art object for one direction. */
  A.artOf = function (def, dir) {
    if (!def || !def.frames) return null;
    const frames = def.frames[dir || 'down'] || def.frames.down;
    if (!Array.isArray(frames) || !frames.length) return null;
    if (typeof def.image === 'string') return { image: def.image, frames };
    return { w: def.w, h: def.h, palette: def.palette, frames };
  };

  // ---- 3. detect / any --------------------------------------------------------
  /** detect(input) -> 'sheet' | 'file' | null. Accepts objects, JSON text, ArrayBuffer/Uint8Array. */
  A.detect = function (input) {
    const bytes = asBytes(input);
    if (bytes && bytes.length >= 6) {
      const magic = bytes[4] | (bytes[5] << 8);
      if (magic === MAGIC) return 'file';
    }
    const j = toJson(input);
    if (!isObj(j)) return null;
    const hasFrames = Array.isArray(j.frames) ? j.frames.some(isObj) : (isObj(j.frames) && Object.keys(j.frames).length > 0);
    if (!hasFrames) return null;
    const meta = isObj(j.meta) ? j.meta : null;
    if (meta && (meta.app != null || meta.size != null || meta.image != null || meta.frameTags != null)) return 'sheet';
    // meta is optional in hand-written data files; the frame shape is the real tell.
    const first = Array.isArray(j.frames) ? j.frames.find(isObj) : j.frames[Object.keys(j.frames)[0]];
    if (isObj(first) && isObj(first.frame) && first.frame.w != null) return 'sheet';
    return null;
  };

  /** any(input, opts) -> Result. Throws when the input is neither shape. */
  A.any = function (input, opts) {
    const kind = A.detect(input);
    if (kind === 'sheet') return A.sheet(input, opts);
    if (kind === 'file') return A.file(input, opts);
    throw new TypeError('aseprite: the input is neither a sheet export nor an .aseprite file');
  };

  A.blank = blank;
  A.zinflate = zinflate;
  A.inflateRaw = inflateRaw;
  A.split = split;

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
