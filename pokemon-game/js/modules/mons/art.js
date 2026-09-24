// mons/art.js — the portraits, the 16×16 overworld icons and the sprite
// entries that let a Pokémon walk around like any other character.
//
// Seven species have hand-drawn 32×32 portraits (js/sprites/*.js). The other
// twenty-five do not, and that must never be a crash or a blank: they fall back
// to KIT.pixels.silhouette in the species colour, which reads as "we know who
// this is, we have not drawn them yet".
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const M = KIT.mons = KIT.mons || {};
  const PKMN = root.PKMN = root.PKMN || {};

  const portraits = new Map();     // speciesId -> art (32×32)
  const icons = new Map();         // speciesId + '|' + size -> art

  /** rawPortrait(id) -> the hand-drawn art, or null when nobody has drawn it. */
  M.rawPortrait = function (id) {
    const table = (root.PKMN && root.PKMN.SPRITES) || PKMN.SPRITES || {};
    const art = id ? table[id] : null;
    if (!art) return null;
    return (Array.isArray(art.rows) || Array.isArray(art.frames)) ? art : null;
  };
  /** hasArt(id) -> whether this species has real art (the Pokédex says so). */
  M.hasArt = function (id) { return !!M.rawPortrait(id); };

  /**
   * placeholder(w, h, color) — KIT.pixels.silhouette in the species colour, with
   * a darker rim: two silhouettes, the smaller one laid inside the bigger one.
   * At 4× on the catch screen a flat disc reads as a bug; a rim reads as "we
   * know who this is, nobody has drawn them yet".
   */
  M.placeholder = function (w, h, color) {
    const outer = KIT.pixels.silhouette(w, h, color);
    const inset = 2;
    if (w <= inset * 2 + 4 || h <= inset * 2 + 4) return outer;
    const inner = KIT.pixels.silhouette(w - inset * 2, h - inset * 2, color);
    const rows = outer.rows.slice();
    let any = false;
    for (let y = 0; y < inner.rows.length; y++) {
      const line = (rows[y + inset] || '').split('');
      if (!line.length) continue;
      for (let x = 0; x < inner.rows[y].length; x++) {
        if (inner.rows[y][x] === '.') continue;
        line[x + inset] = 'i';
        any = true;
      }
      rows[y + inset] = line.join('');
    }
    if (!any) return outer;
    return { w, h, palette: { s: shift(color, -0.32), i: color }, rows };
  };

  /** portrait(id) -> 32×32 art. Always something; never throws. */
  M.portrait = function (id) {
    const key = String(id || '');
    if (portraits.has(key)) return portraits.get(key);
    let art = M.rawPortrait(key);
    if (!art) art = M.placeholder(32, 32, M.speciesColor(key));
    portraits.set(key, art);
    return art;
  };

  /** icon(id, size) -> a downscaled overworld icon (16×16 by default). */
  M.icon = function (id, size) {
    const s = size || 16;
    const key = String(id || '') + '|' + s;
    if (icons.has(key)) return icons.get(key);
    let art;
    try { art = KIT.pixels.downscale(M.portrait(id), s); }
    catch (e) { art = M.placeholder(s, s, M.speciesColor(id)); }
    if (!art || !art.rows || !art.rows.length) art = M.placeholder(s, s, M.speciesColor(id));
    icons.set(key, art);
    return art;
  };

  /**
   * shinyArt(art) -> the same art with a brighter, cooler palette.
   * A shiny is a colour difference, not a different drawing, so this is a
   * palette pass over whatever art we already have.
   */
  M.shinyArt = function (art) {
    if (!art || !art.palette) return art;
    const palette = {};
    for (const k of Object.keys(art.palette)) palette[k] = shift(art.palette[k]);
    return { w: art.w, h: art.h, size: art.size, palette, rows: art.rows, frames: art.frames };
  };
  /** shift(hex) -> the shiny palette; shift(hex, -k) -> the same colour k darker. */
  function shift(hex, dark) {
    if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (dark != null) {
      const k = 1 + Number(dark);
      r = Math.max(0, Math.round(r * k)); g = Math.max(0, Math.round(g * k)); b = Math.max(0, Math.round(b * k));
    } else {
      r = Math.min(255, Math.round(r * 0.82 + 40));
      g = Math.min(255, Math.round(g * 0.95 + 26));
      b = Math.min(255, Math.round(b * 1.0 + 48));
    }
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /** artFor(mon) -> the 32×32 art for a caught mon (shiny included). */
  M.artFor = function (mon) {
    const art = M.portrait(mon && mon.id);
    return mon && mon.shiny ? M.shinyArt(art) : art;
  };
  /** iconFor(mon, size) -> the overworld icon for a caught mon. */
  M.iconFor = function (mon, size) {
    const art = M.icon(mon && mon.id, size);
    return mon && mon.shiny ? M.shinyArt(art) : art;
  };

  /**
   * spriteId(speciesId, shiny) — the id in the 'sprites' registry.
   * Registering lazily means twenty-five silhouettes are never built until
   * something actually walks around.
   */
  M.spriteId = function (id, shiny) { return 'mon:' + String(id || 'unknown') + (shiny ? ':shiny' : ''); };

  /**
   * ensureSprite(speciesId, shiny) -> the sprite id, registered on first use.
   * One standing frame in every direction: a Pokémon does not have a walk cycle
   * drawn for it, and a still icon bobbing along behind you reads fine.
   */
  M.ensureSprite = function (id, shiny) {
    const spriteId = M.spriteId(id, shiny);
    const reg = KIT.registry('sprites');
    if (reg.has(spriteId)) return spriteId;
    const art = shiny ? M.shinyArt(M.icon(id, 16)) : M.icon(id, 16);
    const rows = art.rows || [];
    reg.add({
      id: spriteId, name: M.speciesName(id) + (shiny ? ' ✦' : ''), group: 'pokemon',
      w: 16, h: 16, palette: art.palette || {},
      frames: { down: [rows, rows, rows], up: [rows, rows, rows], left: [rows, rows, rows] },
      replace: true,
    });
    return spriteId;
  };

  /** spriteFor(mon) -> a registered sprite id for a caught mon. */
  M.spriteFor = function (mon) { return M.ensureSprite(mon && mon.id, mon && mon.shiny); };

  /** typeColor(type) -> the swatch behind a type chip. */
  M.TYPE_COLORS = {
    normal: '#9a9a86', fire: '#f0802f', water: '#5b8fd0', grass: '#5fa96b', electric: '#f0c420',
    ice: '#7fd0d8', fighting: '#b8443c', poison: '#9c5ab0', ground: '#d8b464', flying: '#8ea8e8',
    psychic: '#e06a94', bug: '#9cb83c', rock: '#b0a060', ghost: '#6a4c93', dragon: '#6a58d0',
    dark: '#5a4a44', steel: '#a8a8c0', fairy: '#e8a0c8',
  };
  M.typeColor = function (t) { return M.TYPE_COLORS[t] || '#7a7a8a'; };


  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
