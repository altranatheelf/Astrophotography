// KIT.import.image — a picture (or a sound) on its own -> Kit content.
//
// The most common thing a person finds online is not a Tiled map or an Aseprite
// export: it is a PNG. A tileset sheet, or a character's walk cycle in a grid.
// Neither carries a data file, so before this the importer turned them away.
//
// Pure: no fs, no DOM, no network. The caller hands over the picture's name and
// size plus the same `asset(src)` resolver the other importers take:
//   tileset({ name, w, h, tile, margin, spacing, skip, prefix, id, asset })
//   sprite({ name, w, h, columns, rows, order, fps, prefix, id, asset })
//   guessTile(w, h, prefer) / guessGrid(w, h)   what a sheet of that size probably is
//   audio({ name, kind, src, loop, prefix, id })  a dropped .ogg/.mp3/.wav as a sound or a track
//   guessAudio(name, bytes)                      'music' or 'sound' (long things loop)
//   fontsFrom(files)                             .ttf/.otf/.woff/.woff2 files as the game's own fonts
//   base64(bytes)                                the bytes as base64, for a data: URI
//
// A tileset goes through the Tiled importer as a synthetic tileset, so it gets
// exactly what a .tsx gets (ids, the sheet asset, a palette group). A character
// sheet becomes one sprite in the shape the Aseprite importer makes: an image
// plus frame rectangles per direction.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const IMP = KIT.import = KIT.import || {};
  const I = IMP.image = IMP.image || {};

  const int = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : (d || 0));
  const baseName = (p) => String(p == null ? '' : p).split(/[\\/]/).pop();
  const stem = (p) => baseName(p).replace(/\.[A-Za-z0-9]+$/, '');
  const titleCase = KIT.titleCase;
  const withPrefix = (id, prefix) => (prefix ? KIT.slug(prefix) + ':' + id : id);
  const DIR = { d: 'down', u: 'up', l: 'left', r: 'right' };

  function blank() {
    return { assets: {}, tiles: [], sprites: [], faces: [], icons: [], animations: [], maps: {}, objects: [], scripts: {}, vars: {}, items: {}, sounds: {}, music: {}, project: null, problems: [], stats: {} };
  }

  /** guessTile(w, h, prefer) -> the tile size a sheet of w×h most likely uses. */
  I.guessTile = function (w, h, prefer) {
    const tries = [int(prefer, 0), 16, 32, 48, 24, 8, 64, 12, 20].filter((n, i, a) => n > 0 && a.indexOf(n) === i);
    for (const n of tries) if (w % n === 0 && h % n === 0) return n;
    return int(prefer, 0) || 16;
  };
  /** guessGrid(w, h) -> { columns, rows, order } for a character sheet: 3×4 (RPG Maker, most walk cycles), 4×4, else one row. */
  I.guessGrid = function (w, h) {
    if (w % 3 === 0 && h % 4 === 0 && (w / 3) <= (h / 4) * 1.5) return { columns: 3, rows: 4, order: 'dlru' };
    if (w % 4 === 0 && h % 4 === 0 && (w / 4) <= (h / 4) * 1.5) return { columns: 4, rows: 4, order: 'dlru' };
    return { columns: Math.max(1, Math.round(w / Math.max(1, h))), rows: 1, order: 'd' };
  };
  /** 'dlru' -> ['down','left','right','up']; any permutation of d/u/l/r. */
  I.dirsOf = function (order) {
    const out = [];
    for (const ch of String(order || 'dlru').toLowerCase()) if (DIR[ch] && !out.includes(DIR[ch])) out.push(DIR[ch]);
    return out.length ? out : ['down', 'left', 'right', 'up'];
  };

  /** tileset(o) -> Result — every cell of the sheet as a tile, `<sheet>:<n>`, in one palette group. */
  I.tileset = function (o) {
    if (!o || typeof o.asset !== 'function') throw new TypeError('image.tileset: an asset(src) resolver is required');
    if (!IMP.tiled || !IMP.tiled.tileset) throw new Error('image.tileset: the Tiled importer is not loaded');
    const w = int(o.w, 0), h = int(o.h, 0);
    if (!w || !h) throw new TypeError('image.tileset: the picture has no size (w, h)');
    const tile = int(o.tile, 0) || I.guessTile(w, h, o.prefer);
    const margin = Math.max(0, int(o.margin, 0)), spacing = Math.max(0, int(o.spacing, 0));
    const columns = Math.max(1, Math.floor((w - margin + spacing) / (tile + spacing)));
    const rows = Math.max(1, Math.floor((h - margin + spacing) / (tile + spacing)));
    const id = KIT.slug(o.id || stem(o.name) || 'sheet');
    const tsj = {
      type: 'tileset', name: id, tilewidth: tile, tileheight: tile, image: o.name || `${id}.png`, imagewidth: w, imageheight: h,
      columns, tilecount: columns * rows, margin, spacing,
    };
    const res = IMP.tiled.tileset(tsj, { asset: o.asset, name: o.name, id, prefix: o.prefix || null });
    const skip = new Set((o.skip || []).map(n => int(n, -1)));
    if (skip.size) {
      const tsId = withPrefix(id, o.prefix);
      const before = res.tiles.length;
      res.tiles = res.tiles.filter(t => !(t.id && t.id.startsWith(tsId + ':') && skip.has(int(t.id.slice(tsId.length + 1), -1))));
      res.stats.skipped = before - res.tiles.length;
    }
    if ((w - margin + spacing) % (tile + spacing) || (h - margin + spacing) % (tile + spacing)) {
      res.problems.push({ severity: 'info', code: 'grid-uneven', message: `the sheet is ${w}×${h}; at ${tile}px tiles with margin ${margin} and spacing ${spacing} the last column or row is cut off`, where: { tileset: id } });
    }
    Object.assign(res.stats, { tile, columns, rows, margin, spacing, from: 'image' });
    return res;
  };

  /** sprite(o) -> Result — one walking sprite: rows are directions (order), columns are frames. */
  I.sprite = function (o) {
    if (!o || typeof o.asset !== 'function') throw new TypeError('image.sprite: an asset(src) resolver is required');
    const w = int(o.w, 0), h = int(o.h, 0);
    if (!w || !h) throw new TypeError('image.sprite: the picture has no size (w, h)');
    const res = blank();
    const a = o.asset(o.name);
    if (!a) { res.problems.push({ severity: 'error', code: 'asset-unresolved', message: `the picture “${o.name}” was not handed over with its name`, where: {} }); return res; }
    const guess = I.guessGrid(w, h);
    const columns = Math.max(1, int(o.columns, 0) || guess.columns), rows = Math.max(1, int(o.rows, 0) || guess.rows);
    const fw = Math.floor(w / columns), fh = Math.floor(h / rows);
    const dirs = rows === 1 ? ['down'] : I.dirsOf(o.order || guess.order);
    const base = KIT.slug(o.id || stem(o.name) || 'sprite');
    const id = withPrefix(base, o.prefix);
    const ms = Math.max(30, Math.round(1000 / (Number(o.fps) > 0 ? Number(o.fps) : 8)));
    const def = { id, name: titleCase(stem(o.name) || base), group: 'imported', image: a.id, frames: {}, durations: {}, w: fw, h: fh, from: 'image' };
    for (let r = 0; r < rows; r++) {
      const dir = dirs[r];
      if (!dir) { res.problems.push({ severity: 'info', code: 'rows-extra', message: `row ${r + 1} of “${o.name}” has no direction in the order “${o.order || guess.order}” and was left out`, where: { sprite: id } }); continue; }
      def.frames[dir] = []; def.durations[dir] = [];
      for (let c = 0; c < columns; c++) { def.frames[dir].push({ x: c * fw, y: r * fh, w: fw, h: fh }); def.durations[dir].push(ms); }
    }
    if (w % columns || h % rows) res.problems.push({ severity: 'warn', code: 'grid-uneven', message: `${w}×${h} does not divide into ${columns}×${rows} frames; the last pixels of each frame are dropped`, where: { sprite: id } });
    res.assets[a.id] = { kind: 'image', src: a.src, w: a.w || w, h: a.h || h, from: `image:${o.name || base}` };
    res.sprites.push(def);
    res.stats = { sprites: 1, columns, rows, w: fw, h: fh, dirs: Object.keys(def.frames), from: 'image' };
    return res;
  };

  // ---- audio ------------------------------------------------------------------
  // A game needs music, and a page opened from a file cannot fetch the .ogg next
  // to it — so an imported track is embedded like every imported picture.
  I.AUDIO_EXT = /\.(ogg|mp3|wav|m4a|aac|flac|opus|webm)$/i;
  /** guessAudio(name, bytes) -> 'music' | 'sound': long things loop, short things are effects. */
  I.guessAudio = function (name, bytes) {
    const n = String(name || '').toLowerCase();
    if (/\b(bgm|music|theme|track|song|loop)\b|^bgm|^music/.test(n)) return 'music';
    if (/\b(se|sfx|sound|effect|cry|hit|step|beep)\b|^se[-_]|^sfx/.test(n)) return 'sound';
    // Nothing in the name: a file over about half a megabyte is a piece of music.
    return (bytes && bytes.length > 512 * 1024) ? 'music' : 'sound';
  };
  /**
   * audio(o) -> Result — one dropped track or effect.
   * o: { name, kind:'music'|'sound', src (a data: URI), loop, loopStart, loopEnd, prefix, id }
   */
  I.audio = function (o) {
    const res = blank();
    const src = String((o && o.src) || '');
    if (!src) { res.problems.push({ severity: 'error', code: 'no-audio', message: 'that sound came with no data to play', where: {} }); return res; }
    const base = KIT.slug(o.id || stem(o.name) || 'track');
    const id = withPrefix(base, o.prefix);
    const kind = o.kind === 'music' ? 'music' : 'sound';
    const name = titleCase(stem(o.name) || base);
    if (kind === 'music') {
      res.music = { [id]: { id, name, kind: 'file', src, loop: o.loop !== false,
        loopStart: o.loopStart == null ? null : Number(o.loopStart), loopEnd: o.loopEnd == null ? null : Number(o.loopEnd) } };
    } else {
      res.sounds = { [id]: { id, name, kind: 'file', src } };
    }
    if (!/^data:/i.test(src)) res.problems.push({ severity: 'warn', code: 'audio-not-embedded', message: `“${o.name}” is a path, not embedded — a page opened from a file cannot read it`, where: {} });
    res.stats = { audio: 1, kind, from: 'image' };
    return res;
  };

  /**
   * base64(bytes) -> the bytes written as base64. `btoa` takes a string of
   * byte-sized letters and is in every browser and in Node, so the bytes go in
   * a slice at a time — a whole font as one call's arguments is more than a
   * phone's browser will take.
   */
  I.base64 = function (bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  };

  // ---- fonts ------------------------------------------------------------------
  I.FONT_EXT = /\.(ttf|otf|woff2?)$/i;
  /**
   * fontKind(bytes) -> 'ttf' | 'otf' | 'woff' | 'woff2' | null. A font file
   * says what it is in its first four bytes, and only those are believed. A
   * phone's file picker often hands a font over with no type, or as
   * "application/octet-stream", so the browser's word for it is never asked;
   * and the name's ending is not enough either: a download that failed, or
   * another file renamed, keeps its .ttf, and taken as a font it sat in every
   * font row, drawing nothing, with no word of why.
   */
  function fontKind(bytes) {
    const b = bytes || [];
    const head = String.fromCharCode(b[0] || 0, b[1] || 0, b[2] || 0, b[3] || 0);
    if (head === 'wOF2') return 'woff2';
    if (head === 'wOFF') return 'woff';
    if (head === 'OTTO') return 'otf';
    if (head === '\x00\x01\x00\x00' || head === 'true') return 'ttf';
    return null;
  }
  // A font's id is kept short enough to take a "-2" and still be an id a look
  // can name (at most 64 letters): a long file name made one it could not,
  // and the font was listed as not a font at all.
  const FONT_ID_MAX = 56;
  // The words a look uses for fonts it does not carry. A game's font of the
  // same name would hide the word, so it is called something else.
  const FONT_WORDS = ['pixel', 'mono', 'system', 'serif', 'rounded'];

  /**
   * fontsFrom(files) -> Result with `fonts: { id: { name, src, pixel } }` —
   * each dropped font as one of the game's own. `files` are `{ name, bytes }`.
   * The id is the file's name (`one-glyph.ttf` -> `one-glyph`) and the font
   * is inside the game as a data: URI rebuilt from its bytes, so it works
   * offline and travels with the game. Whether it is a pixel font, and the
   * size it was drawn for, is the author's to say afterwards (Look › Fonts).
   */
  I.fontsFrom = function (files) {
    const res = Object.assign(blank(), { fonts: {} });
    for (const f of files || []) {
      const name = baseName(f && f.name);
      const kind = f && f.bytes && f.bytes.length ? fontKind(f.bytes) : null;
      if (!kind) {
        const why = I.FONT_EXT.test(name) ? ': it is named like one, but what is inside is not (a download that did not finish, or another file renamed)' : '';
        res.problems.push({ severity: 'warn', code: 'not-a-font', message: `“${name}” is not a TTF, OTF, WOFF or WOFF2 font${why}`, where: {} });
        continue;
      }
      let id = KIT.slug(stem(name) || 'font').slice(0, FONT_ID_MAX).replace(/[-._:]+$/, '') || 'font';
      if (FONT_WORDS.includes(id)) id += '-font';
      res.fonts[id] = { name: titleCase(stem(name)) || id, src: `data:font/${kind};base64,${I.base64(f.bytes)}`, pixel: false };
      if (f.bytes.length > 300 * 1024) res.problems.push({ severity: 'warn', code: 'ui-big', message: `“${name}” is ${Math.round(f.bytes.length / 1024)} KB; fonts over 300 KB make a big game, and a WOFF2 of the same font is much smaller`, where: { path: ['fonts', id] } });
    }
    res.stats = { fonts: Object.keys(res.fonts).length, from: 'font' };
    return res;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
