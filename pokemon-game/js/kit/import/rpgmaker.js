// KIT.import.rpgmaker — an importer for RPG Maker MV (and the MZ dialect of the
// same data files). Pure: it is handed already-parsed JSON and an
// `opts.asset(src)` resolver, and returns a Result (docs/IMPORT-CONTRACT.md).
// No fs, no DOM, no network.
//
//   KIT.import.rpgmaker.detect(files)             -> { ok, tool, dialect, maps, problems }
//   KIT.import.rpgmaker.project(files, opts)      -> Result
//   KIT.import.rpgmaker.commands(list, ctx)       -> { commands, vars, problems, stats }
//   KIT.import.rpgmaker.characters(name, opts)    -> { assets, sprites, problems, sheet }
//   KIT.import.rpgmaker.faces(name, opts)         -> { assets, faces, problems, sheet }
//   KIT.import.rpgmaker.tileArt(tileId, sheets, opts) -> { art, sheet, kind, shape, flattened }
//
// ---------------------------------------------------------------------------
// SOURCES (read while writing this; the engine numbers below are quoted from
// the community core script, which is the shipped MV runtime):
//   https://raw.githubusercontent.com/rpgtkoolmv/corescript/master/js/rpg_core/Tilemap.js
//       TILE_ID_* constants, getAutotileKind/Shape, _drawNormalTile,
//       _drawAutotile, FLOOR_/WALL_/WATERFALL_AUTOTILE_TABLE (copied verbatim)
//   https://raw.githubusercontent.com/rpgtkoolmv/corescript/master/js/rpg_objects/Game_Interpreter.js
//       every command1xx/2xx/3xx/4xx/6xx and its parameter order
//   https://raw.githubusercontent.com/rpgtkoolmv/corescript/master/js/rpg_objects/Game_Character.js
//       Game_Character.ROUTE_* (move route codes 0-45)
//   https://raw.githubusercontent.com/rpgtkoolmv/corescript/master/js/rpg_objects/Game_Map.js
//       data[(z*height+y)*width+x], checkPassage/isLadder/isBush/isCounter/
//       isDamageFloor/terrainTag/regionId — i.e. the real flag bits
//   https://raw.githubusercontent.com/rpgtkoolmv/corescript/master/js/rpg_objects/Game_Event.js
//       page conditions, findProperPageIndex (highest matching page wins),
//       trigger 0-4, priorityType, moveType
//   https://raw.githubusercontent.com/rpgtkoolmv/corescript/master/js/rpg_sprites/Sprite_Character.js
//       characterBlockX/Y, characterPatternX/Y, patternWidth/Height
//   https://raw.githubusercontent.com/rpgtkoolmv/corescript/master/js/rpg_managers/ImageManager.js
//       isBigCharacter ($) / isObjectCharacter (!)
//   https://raw.githubusercontent.com/rpgtkoolmv/corescript/master/js/rpg_windows/Window_Base.js
//   https://raw.githubusercontent.com/rpgtkoolmv/corescript/master/js/rpg_windows/Window_Message.js
//       convertEscapeCharacters + processEscapeCharacter (the \V \N \P \C \I
//       \. \| \! \^ \> \< \$ \G \{ \} message codes)
//   https://rpgmakerofficial.com/product/mz/rmmz_api/Tilemap.js.html  (MZ, same maths)
//   https://github.com/yxbh/tileset-format-specs/blob/main/formats/rpg-maker-mv-mz/specs/autotiles.md
//       independent write-up of the A2/A4 block geometry (4x6 quarters per kind)
//   https://katai5plate.github.io/RPGMV-CoreScript-Reference/jsdoc/RPG.MapInfo.html
//       MapInfos entry shape { id, expanded, name, order, parentId, scrollX, scrollY }
//   https://github.com/Apress/beg-rpg-maker-mv  (a real shipped MV project: the
//       exact JSON of System/Tilesets/MapInfos/Map001/CommonEvents/Items/Actors
//       was read from it rather than guessed)
//
// ---------------------------------------------------------------------------
// WHAT THE NUMBERS MEAN (the maths implemented below)
//
// Map data. `data` is a flat Int array of width*height*6 with
// `data[(z * height + y) * width + x]`. z = 0..3 are the four tile layers
// (0,1 drawn under the characters, 2,3 over them), z = 4 is the shadow bitfield
// (wall shadows, 4 bits per cell), z = 5 is the region id (0-255).
//
// Tile ids.
//   B  0..255     C 256..511    D 512..767    E 768..1023   (four plain sheets)
//   A5 1536..1791 (a plain sheet, 8 columns)
//   A1 2048  A2 2816  A3 4352  A4 5888  MAX 8192  (autotiles)
//   kind  = floor((tileId - 2048) / 48)      shape = (tileId - 2048) % 48
// A plain tile's rect inside its sheet (one tile = T px square):
//   sx = ((floor(tileId / 128) % 2) * 8 + tileId % 8) * T
//   sy = ((floor((tileId % 256) / 8)) % 16) * T
// i.e. a B-E sheet is 16 tiles wide and 16 tall, the left half holding ids
// 0..127 (8 per row) and the right half 128..255.
// An autotile's block origin, in HALF-tile ("quarter") units, from its kind
//   tx = kind % 8, ty = floor(kind / 8)
//   A1: kind 0 -> (0,0), 1 -> (0,3), 2 -> (6,0), 3 -> (6,3); otherwise
//       bx = floor(tx/4)*8 (+0 for the still water frame), by = ty*6 + (floor(tx/2)%2)*3
//       odd kinds are waterfalls: bx += 6, WATERFALL table, by += frame
//   A2: bx = tx*2, by = (ty-2)*3         A3: bx = tx*2, by = (ty-6)*2 (WALL table)
//   A4: bx = tx*2, by = floor((ty-10)*2.5 + (ty%2 ? 0.5 : 0)); odd ty uses WALL
// then the shape's four quarters come from TABLE[shape] = [TL,TR,BL,BR], each
// [qx,qy], drawn at ((bx*2 + qx) * T/2, (by*2 + qy) * T/2).
// This importer does NOT rebuild the 48 shapes (Kit bakes its own autotiles
// from terrain rules). It takes the shape's TOP-LEFT quarter as the origin and
// slices ONE WHOLE TILE from there, which for the common shapes lands on a
// clean piece of the block, and reports `autotile-flattened`.
//
// Tileset flags (`Tilesets[n].flags[tileId]`, 8192 entries) — the real MV bits,
// read out of Game_Map, NOT the order quoted in most forum posts:
//   0x0001 down blocked   0x0002 left blocked   0x0004 right blocked
//   0x0008 up blocked     (a SET bit means impassable that way)
//   0x0010 [*] no effect on passage      0x0020 ladder     0x0040 bush
//   0x0080 counter (on an A2 tile this same bit means "table")
//   0x0100 damage floor   0x0200 boat     0x0400 ship     0x0800 airship land
//   0xf000 >> 12 terrain tag (0-7)
//
// Pages. MV picks the HIGHEST-numbered page whose conditions pass
// (Game_Event.findProperPageIndex counts down); Kit picks the LAST page whose
// `when` passes. Page order is therefore preserved 1:1 — do not reorder.
//
// Message codes (MV -> Kit), see convertText():
//   \V[n] -> {var:<name>}     \N[1] -> {p1}   \N[2] -> {p2}   \N[n>2] -> the
//   actor's literal name      \P[n] -> {p1}/{p2}
//   \C[n] -> {color:<name>} … closed with {/color} at \C[0] or end of message
//   \I[n] -> {icon:icon-<n>}  \. -> {pause:250} (15 frames)
//   \| -> {pause:1000} (60 frames)     \! -> {wait}      \> -> {fast}
//   \{ -> {size:big}   \} -> {/size}   \\ -> a literal backslash
//   \< \^ \$ \G \S[n] have no Kit equivalent and are stripped (info problem).
//   A literal { or } in the MV text is escaped to {{ / }} for KIT.text.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const IMP = KIT.import = KIT.import || {};
  const RM = IMP.rpgmaker = IMP.rpgmaker || {};

  const slug = (s) => KIT.slug(s);
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : (d || 0));
  const int = (v, d) => Math.round(num(v, d));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const frames2ms = (f) => Math.round(num(f, 0) * 1000 / 60);

  RM.TOOL = 'rpgmaker-mv';

  // ---- tile id constants ----------------------------------------------------
  const TILE_ID_B = 0, TILE_ID_C = 256, TILE_ID_D = 512, TILE_ID_E = 768;
  const TILE_ID_A5 = 1536, TILE_ID_A1 = 2048, TILE_ID_A2 = 2816, TILE_ID_A3 = 4352, TILE_ID_A4 = 5888, TILE_ID_MAX = 8192;
  RM.TILE_ID = { B: TILE_ID_B, C: TILE_ID_C, D: TILE_ID_D, E: TILE_ID_E, A5: TILE_ID_A5, A1: TILE_ID_A1, A2: TILE_ID_A2, A3: TILE_ID_A3, A4: TILE_ID_A4, MAX: TILE_ID_MAX };

  // Tilesets[n].tilesetNames is [A1, A2, A3, A4, A5, B, C, D, E]; MV calls the
  // index `setNumber`. Every sheet is 16 tiles wide except A5, which is 8.
  const SHEET_NAMES = ['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C', 'D', 'E'];
  const SHEET_COLUMNS = [16, 16, 16, 16, 8, 16, 16, 16, 16];

  const FLOOR_AUTOTILE_TABLE = [
    [[2, 4], [1, 4], [2, 3], [1, 3]], [[2, 0], [1, 4], [2, 3], [1, 3]],
    [[2, 4], [3, 0], [2, 3], [1, 3]], [[2, 0], [3, 0], [2, 3], [1, 3]],
    [[2, 4], [1, 4], [2, 3], [3, 1]], [[2, 0], [1, 4], [2, 3], [3, 1]],
    [[2, 4], [3, 0], [2, 3], [3, 1]], [[2, 0], [3, 0], [2, 3], [3, 1]],
    [[2, 4], [1, 4], [2, 1], [1, 3]], [[2, 0], [1, 4], [2, 1], [1, 3]],
    [[2, 4], [3, 0], [2, 1], [1, 3]], [[2, 0], [3, 0], [2, 1], [1, 3]],
    [[2, 4], [1, 4], [2, 1], [3, 1]], [[2, 0], [1, 4], [2, 1], [3, 1]],
    [[2, 4], [3, 0], [2, 1], [3, 1]], [[2, 0], [3, 0], [2, 1], [3, 1]],
    [[0, 4], [1, 4], [0, 3], [1, 3]], [[0, 4], [3, 0], [0, 3], [1, 3]],
    [[0, 4], [1, 4], [0, 3], [3, 1]], [[0, 4], [3, 0], [0, 3], [3, 1]],
    [[2, 2], [1, 2], [2, 3], [1, 3]], [[2, 2], [1, 2], [2, 3], [3, 1]],
    [[2, 2], [1, 2], [2, 1], [1, 3]], [[2, 2], [1, 2], [2, 1], [3, 1]],
    [[2, 4], [3, 4], [2, 3], [3, 3]], [[2, 4], [3, 4], [2, 1], [3, 3]],
    [[2, 0], [3, 4], [2, 3], [3, 3]], [[2, 0], [3, 4], [2, 1], [3, 3]],
    [[2, 4], [1, 4], [2, 5], [1, 5]], [[2, 0], [1, 4], [2, 5], [1, 5]],
    [[2, 4], [3, 0], [2, 5], [1, 5]], [[2, 0], [3, 0], [2, 5], [1, 5]],
    [[0, 4], [3, 4], [0, 3], [3, 3]], [[2, 2], [1, 2], [2, 5], [1, 5]],
    [[0, 2], [1, 2], [0, 3], [1, 3]], [[0, 2], [1, 2], [0, 3], [3, 1]],
    [[2, 2], [3, 2], [2, 3], [3, 3]], [[2, 2], [3, 2], [2, 1], [3, 3]],
    [[2, 4], [3, 4], [2, 5], [3, 5]], [[2, 0], [3, 4], [2, 5], [3, 5]],
    [[0, 4], [1, 4], [0, 5], [1, 5]], [[0, 4], [3, 0], [0, 5], [1, 5]],
    [[0, 2], [3, 2], [0, 3], [3, 3]], [[0, 2], [1, 2], [0, 5], [1, 5]],
    [[0, 4], [3, 4], [0, 5], [3, 5]], [[2, 2], [3, 2], [2, 5], [3, 5]],
    [[0, 2], [3, 2], [0, 5], [3, 5]], [[0, 0], [1, 0], [0, 1], [1, 1]],
  ];
  const WALL_AUTOTILE_TABLE = [
    [[2, 2], [1, 2], [2, 1], [1, 1]], [[0, 2], [1, 2], [0, 1], [1, 1]],
    [[2, 0], [1, 0], [2, 1], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[2, 2], [3, 2], [2, 1], [3, 1]], [[0, 2], [3, 2], [0, 1], [3, 1]],
    [[2, 0], [3, 0], [2, 1], [3, 1]], [[0, 0], [3, 0], [0, 1], [3, 1]],
    [[2, 2], [1, 2], [2, 3], [1, 3]], [[0, 2], [1, 2], [0, 3], [1, 3]],
    [[2, 0], [1, 0], [2, 3], [1, 3]], [[0, 0], [1, 0], [0, 3], [1, 3]],
    [[2, 2], [3, 2], [2, 3], [3, 3]], [[0, 2], [3, 2], [0, 3], [3, 3]],
    [[2, 0], [3, 0], [2, 3], [3, 3]], [[0, 0], [3, 0], [0, 3], [3, 3]],
  ];
  const WATERFALL_AUTOTILE_TABLE = [
    [[2, 0], [1, 0], [2, 1], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[2, 0], [3, 0], [2, 1], [3, 1]], [[0, 0], [3, 0], [0, 1], [3, 1]],
  ];
  RM.FLOOR_AUTOTILE_TABLE = FLOOR_AUTOTILE_TABLE;
  RM.WALL_AUTOTILE_TABLE = WALL_AUTOTILE_TABLE;
  RM.WATERFALL_AUTOTILE_TABLE = WATERFALL_AUTOTILE_TABLE;

  RM.isAutotile = (tileId) => tileId >= TILE_ID_A1;
  RM.autotileKind = (tileId) => Math.floor((tileId - TILE_ID_A1) / 48);
  RM.autotileShape = (tileId) => (tileId - TILE_ID_A1) % 48;

  /** sheetIndexOf(tileId) -> 0..8 into tilesetNames, or -1 when the id draws nothing. */
  RM.sheetIndexOf = function (tileId) {
    const id = int(tileId, 0);
    if (id <= 0 || id >= TILE_ID_MAX) return -1;
    if (id >= TILE_ID_A4) return 3;
    if (id >= TILE_ID_A3) return 2;
    if (id >= TILE_ID_A2) return 1;
    if (id >= TILE_ID_A1) return 0;
    if (id >= TILE_ID_A5) return 4;
    if (id < 1024) return 5 + Math.floor(id / 256);
    return -1;                                  // 1024..1535 is unused in MV
  };

  // ---- direction / balloon / trigger tables ---------------------------------
  const DIR = { 2: 'down', 4: 'left', 6: 'right', 8: 'up' };
  const BALLOON = { 1: '!', 2: '?', 3: '♪', 4: '♥', 5: 'anger', 6: 'sweat', 7: '…', 8: '…', 9: '!', 10: 'zzz' };
  const BALLOON_APPROX = { 7: 'Cobweb', 9: 'Light Bulb' };
  const TRIGGER_SLOT = { 0: 'interact', 1: 'step', 2: 'touch', 3: 'enter', 4: 'tick' };
  const PRIORITY_LAYER = { 0: 'below', 1: 'same', 2: 'above' };
  const MOVE_KIND = { 0: 'none', 1: 'wander', 2: 'approach', 3: 'route' };
  const BRANCH_OPS = { 0: '==', 1: '>=', 2: '<=', 3: '>', 4: '<', 5: '!=' };
  const VAR_OPS = { 0: 'set', 1: 'add', 2: 'sub', 3: 'mul', 4: 'div', 5: 'mod' };
  const WEATHER = { none: 'none', rain: 'rain', storm: 'rain', snow: 'snow' };
  const MV_COLORS = ['normal', 'blue', 'red', 'green', 'cyan', 'purple', 'yellow', 'grey'];
  RM.DIR = DIR;

  /** MV move speed 1-6 -> tiles per second: 2^speed / 256 px-of-a-tile per frame at 60fps. */
  RM.speedToTiles = (mv) => Math.round(Math.pow(2, clamp(int(mv, 4), 1, 6)) / 256 * 60 * 100) / 100;
  /** MV move frequency 1-5 -> Kit behaviour frequency 1-9 (higher = more often in both). */
  RM.frequencyToKit = (mv) => clamp(int(mv, 3) * 2 - 1, 1, 9);

  // ---- problems -------------------------------------------------------------
  function bag() {
    const list = [];
    const add = (severity, code, message, where) => { list.push({ severity, code, message, where: where || {} }); return list[list.length - 1]; };
    return {
      list,
      error: (code, message, where) => add('error', code, message, where),
      warn: (code, message, where) => add('warn', code, message, where),
      info: (code, message, where) => add('info', code, message, where),
      /** once(key, ...) — the same code+key is only reported the first time. */
      seen: new Set(),
      once(severity, code, key, message, where) { const k = code + '|' + key; if (this.seen.has(k)) return null; this.seen.add(k); return add(severity, code, message, where); },
    };
  }

  // =========================================================================
  // Text codes
  // =========================================================================

  /**
   * convertText(raw, ctx) -> Kit text. See the mapping table at the top.
   * ctx: { varName(n), actorName(n), problems, where }
   */
  RM.convertText = function (raw, ctx) {
    const c = ctx || {};
    const P = c.problems || bag();
    const where = c.where || {};
    const s = raw === null || raw === undefined ? '' : String(raw);
    let out = '', i = 0, openColor = false;
    const drop = (code) => P.once('info', 'text-code-dropped', code, `message code '\\${code}' has no Kit equivalent and was removed`, where);
    while (i < s.length) {
      const ch = s[i];
      if (ch === '{') { out += '{{'; i++; continue; }
      if (ch === '}') { out += '}}'; i++; continue; }
      if (ch !== '\\') { out += ch; i++; continue; }
      const code = s[i + 1];
      if (code === undefined) { out += '\\'; i++; continue; }
      if (code === '\\') { out += '\\'; i += 2; continue; }
      const m = /^\[([^\]]*)\]/.exec(s.slice(i + 2));
      const arg = m ? m[1] : null;
      const n = m ? int(m[1], 0) : 0;
      let len = 2 + (m ? m[0].length : 0);
      const up = code.toUpperCase();
      if (up === 'V' && m) out += `{var:${c.varName ? c.varName(n) : 'var-' + n}}`;
      else if ((up === 'N' || up === 'P') && m) {
        if (n === 1) out += '{p1}';
        else if (n === 2) out += '{p2}';
        else {
          const name = c.actorName ? c.actorName(n) : null;
          if (name) out += String(name).replace(/\{/g, '{{').replace(/\}/g, '}}');
          else P.once('info', 'text-code-dropped', up + n, `\\${up}[${n}] names an actor this import does not know; it was removed`, where);
        }
      } else if (up === 'C' && m) {
        if (n === 0) { if (openColor) { out += '{/color}'; openColor = false; } }
        else { if (openColor) out += '{/color}'; out += `{color:${MV_COLORS[n] || 'mv' + n}}`; openColor = true; }
      } else if (up === 'I' && m) out += `{icon:icon-${n}}`;
      else if (code === '.') out += '{pause:250}';
      else if (code === '|') out += '{pause:1000}';
      else if (code === '!') out += '{wait}';
      else if (code === '>') out += '{fast}';
      else if (code === '{') out += '{size:big}';
      else if (code === '}') out += '{/size}';
      else if (code === '<' || code === '^' || code === '$' || up === 'G' || (up === 'S' && m)) { drop(code + (m ? `[${arg}]` : '')); }
      else { drop(code + (m ? `[${arg}]` : '')); if (!m) len = 2; }
      i += len;
    }
    if (openColor) out += '{/color}';
    return out;
  };

  // =========================================================================
  // Names: switches and variables become Kit var names
  // =========================================================================

  /**
   * nameTable(switches, variables) -> { switchName(n), varName(n), collisions }
   * A named switch/variable keeps its slugged name when that slug is unique
   * across BOTH lists; otherwise it falls back to `switch-<n>` / `var-<n>`, so
   * the result never depends on the order things are visited.
   */
  RM.nameTable = function (switches, variables) {
    const sw = Array.isArray(switches) ? switches : [];
    const va = Array.isArray(variables) ? variables : [];
    const counts = new Map();
    const bump = (v) => { if (v && String(v).trim()) { const k = slug(v); counts.set(k, (counts.get(k) || 0) + 1); } };
    sw.forEach(bump); va.forEach(bump);
    const collisions = [];
    for (const [k, n] of counts) if (n > 1) collisions.push(k);
    collisions.sort();
    const pick = (list, n, prefix) => {
      const raw = list[n];
      if (raw && String(raw).trim()) { const k = slug(raw); if (counts.get(k) === 1) return k; }
      return `${prefix}-${int(n, 0)}`;
    };
    return {
      switchName: (n) => pick(sw, n, 'switch'),
      varName: (n) => pick(va, n, 'var'),
      switchLabel: (n) => (sw[n] && String(sw[n]).trim()) || `Switch ${n}`,
      varLabel: (n) => (va[n] && String(va[n]).trim()) || `Variable ${n}`,
      collisions,
    };
  };

  // =========================================================================
  // Move routes (Game_Character.ROUTE_* 0-45)
  // =========================================================================

  /** routeSteps(moveRoute, ctx) -> Kit route step strings. */
  RM.routeSteps = function (moveRoute, ctx) {
    const c = ctx || {};
    const P = c.problems || bag();
    const where = c.where || {};
    const list = (isObj(moveRoute) && Array.isArray(moveRoute.list)) ? moveRoute.list : (Array.isArray(moveRoute) ? moveRoute : []);
    const steps = [];
    const dropped = (code, label) => P.once('info', 'route-step-dropped', String(code), `move route step ${code} (${label}) has no Kit equivalent and was skipped`, where);
    for (const step of list) {
      if (!isObj(step)) continue;
      const code = int(step.code, 0);
      const p = Array.isArray(step.parameters) ? step.parameters : [];
      switch (code) {
        case 0: break;                                             // ROUTE_END
        case 1: steps.push('down'); break;
        case 2: steps.push('left'); break;
        case 3: steps.push('right'); break;
        case 4: steps.push('up'); break;
        case 5: steps.push('down', 'left'); P.once('info', 'route-diagonal', '5', 'diagonal move route steps became two orthogonal steps', where); break;
        case 6: steps.push('down', 'right'); P.once('info', 'route-diagonal', '6', 'diagonal move route steps became two orthogonal steps', where); break;
        case 7: steps.push('up', 'left'); P.once('info', 'route-diagonal', '7', 'diagonal move route steps became two orthogonal steps', where); break;
        case 8: steps.push('up', 'right'); P.once('info', 'route-diagonal', '8', 'diagonal move route steps became two orthogonal steps', where); break;
        case 9: steps.push('randomStep'); break;
        case 10: steps.push('towardHero'); break;
        case 11: steps.push('awayHero'); break;
        case 12: dropped(12, 'Move Forward'); break;
        case 13: dropped(13, 'Move Backward'); break;
        case 14: steps.push(`jump:${int(p[0], 0)},${int(p[1], 0)}`); break;
        case 15: steps.push(`wait:${frames2ms(p[0])}`); break;
        case 16: steps.push('face:down'); break;
        case 17: steps.push('face:left'); break;
        case 18: steps.push('face:right'); break;
        case 19: steps.push('face:up'); break;
        case 20: dropped(20, 'Turn 90° Right'); break;
        case 21: dropped(21, 'Turn 90° Left'); break;
        case 22: dropped(22, 'Turn 180°'); break;
        case 23: dropped(23, 'Turn 90° Right or Left'); break;
        case 24: steps.push('turnRandom'); break;
        case 25: steps.push('faceHero'); break;
        case 26: dropped(26, 'Turn away from Player'); break;
        case 27: dropped(27, 'Switch ON'); break;
        case 28: dropped(28, 'Switch OFF'); break;
        case 29: steps.push(`speed:${RM.speedToTiles(p[0])}`); break;
        case 30: dropped(30, 'Change Frequency'); break;
        case 31: dropped(31, 'Walking Animation ON'); break;
        case 32: dropped(32, 'Walking Animation OFF'); break;
        case 33: steps.push('stepAnim:on'); break;
        case 34: steps.push('stepAnim:off'); break;
        case 35: steps.push('dirFix:on'); break;
        case 36: steps.push('dirFix:off'); break;
        case 37: steps.push('through:on'); break;
        case 38: steps.push('through:off'); break;
        case 39: steps.push('visible:off'); break;                 // Transparent ON = invisible
        case 40: steps.push('visible:on'); break;
        case 41: { const id = c.spriteId ? c.spriteId(p[0], p[1]) : null; if (id) steps.push(`sprite:${id}`); else dropped(41, 'Change Image'); break; }
        case 42: dropped(42, 'Change Opacity'); break;
        case 43: dropped(43, 'Change Blend Mode'); break;
        case 44: { const id = c.soundId ? c.soundId(p[0]) : (isObj(p[0]) ? slug(p[0].name) : null); if (id) steps.push(`sound:${id}`); else dropped(44, 'Play SE'); break; }
        case 45: dropped(45, 'Script'); break;
        default: dropped(code, 'unknown'); break;
      }
    }
    return steps;
  };

  // =========================================================================
  // Command translation
  // =========================================================================

  const CODE_LABELS = {
    0: 'End', 101: 'Show Text', 102: 'Show Choices', 103: 'Input Number', 104: 'Select Item', 105: 'Show Scrolling Text',
    108: 'Comment', 111: 'Conditional Branch', 112: 'Loop', 113: 'Break Loop', 115: 'Exit Event Processing',
    117: 'Common Event', 118: 'Label', 119: 'Jump to Label', 121: 'Control Switches', 122: 'Control Variables',
    123: 'Control Self Switch', 124: 'Control Timer', 125: 'Change Gold', 126: 'Change Items', 127: 'Change Weapons',
    128: 'Change Armors', 129: 'Change Party Member', 132: 'Change Battle BGM', 133: 'Change Victory ME',
    134: 'Change Save Access', 135: 'Change Menu Access', 136: 'Change Encounter', 137: 'Change Formation Access',
    138: 'Change Window Color', 139: 'Change Defeat ME', 140: 'Change Vehicle BGM',
    201: 'Transfer Player', 202: 'Set Vehicle Location', 203: 'Set Event Location', 204: 'Scroll Map',
    205: 'Set Movement Route', 206: 'Get on/off Vehicle', 211: 'Change Transparency', 212: 'Show Animation',
    213: 'Show Balloon Icon', 214: 'Erase Event', 216: 'Change Player Followers', 217: 'Gather Followers',
    221: 'Fadeout Screen', 222: 'Fadein Screen', 223: 'Tint Screen', 224: 'Flash Screen', 225: 'Shake Screen',
    230: 'Wait', 231: 'Show Picture', 232: 'Move Picture', 233: 'Rotate Picture', 234: 'Tint Picture',
    235: 'Erase Picture', 236: 'Set Weather Effect', 241: 'Play BGM', 242: 'Fadeout BGM', 243: 'Save BGM',
    244: 'Resume BGM', 245: 'Play BGS', 246: 'Fadeout BGS', 249: 'Play ME', 250: 'Play SE', 251: 'Stop SE',
    261: 'Play Movie', 281: 'Change Map Name Display', 282: 'Change Tileset', 283: 'Change Battle Back',
    284: 'Change Parallax', 285: 'Get Location Info', 301: 'Battle Processing', 302: 'Shop Processing',
    303: 'Name Input Processing', 311: 'Change HP', 312: 'Change MP', 313: 'Change State', 314: 'Recover All',
    315: 'Change EXP', 316: 'Change Level', 317: 'Change Parameter', 318: 'Change Skill', 319: 'Change Equipment',
    320: 'Change Name', 321: 'Change Class', 322: 'Change Actor Images', 323: 'Change Vehicle Image',
    324: 'Change Nickname', 325: 'Change Profile', 326: 'Change TP', 331: 'Change Enemy HP', 332: 'Change Enemy MP',
    333: 'Change Enemy State', 334: 'Enemy Recover All', 335: 'Enemy Appear', 336: 'Enemy Transform',
    337: 'Show Battle Animation', 339: 'Force Action', 340: 'Abort Battle', 342: 'Change Enemy TP',
    351: 'Open Menu Screen', 352: 'Open Save Screen', 353: 'Game Over', 354: 'Return to Title Screen',
    355: 'Script', 356: 'Plugin Command', 357: 'Plugin Command (MZ)',
    401: 'Text data', 402: 'When', 403: 'When Cancel', 404: 'End of Choices', 405: 'Scrolling text data',
    408: 'Comment data', 411: 'Else', 412: 'End of Conditional Branch', 413: 'Repeat Above', 505: 'Move Route step',
    601: 'If Win', 602: 'If Escape', 603: 'If Lose', 655: 'Script data',
  };
  RM.CODE_LABELS = CODE_LABELS;

  /** The commands the translator consumes as part of a previous command (never on their own). */
  const CONTINUATION = new Set([401, 405, 408, 505, 655]);
  /** The commands that close a block; parseBlock hands them back to its caller. */
  const CLOSERS = new Set([402, 403, 404, 411, 412, 413, 601, 602, 603]);

  /** makeCommandCtx(raw) — fills in every lookup the translator needs so it can be called on its own. */
  function makeCommandCtx(raw) {
    const c = Object.assign({}, raw || {});
    const names = c.names || RM.nameTable(c.switches, c.variables);
    c.names = names;
    c.problems = c.problems || bag();
    c.where = c.where || {};
    c.vars = c.vars || {};
    c.stats = c.stats || { total: 0, translated: 0, unsupported: 0 };
    c.prefix = c.prefix || '';
    const pre = (id) => (c.prefix ? `${c.prefix}:${id}` : id);
    c.id = pre;
    c.switchName = (n) => names.switchName(n);
    c.varName = (n) => names.varName(n);
    c.declareSwitch = (n) => { const name = names.switchName(n); if (!c.vars[name]) c.vars[name] = { type: 'bool', default: false, label: names.switchLabel(n), group: 'Switches' }; return name; };
    c.declareVar = (n) => { const name = names.varName(n); if (!c.vars[name]) c.vars[name] = { type: 'number', default: 0, label: names.varLabel(n), group: 'Variables' }; return name; };
    c.declare = (name, decl) => { if (!c.vars[name]) c.vars[name] = Object.assign({ type: 'number', default: 0, label: name, group: 'RPG Maker' }, decl || {}); return name; };
    c.itemId = c.itemId || ((n) => (c.items && c.items[n]) || pre(`item-${int(n, 0)}`));
    c.weaponId = c.weaponId || ((n) => (c.weapons && c.weapons[n]) || pre(`weapon-${int(n, 0)}`));
    c.armorId = c.armorId || ((n) => (c.armors && c.armors[n]) || pre(`armor-${int(n, 0)}`));
    c.mapId = c.mapId || ((n) => (c.maps && c.maps[n]) || null);
    c.scriptId = c.scriptId || ((n) => (c.scripts && c.scripts[n]) || pre(`common-${int(n, 0)}`));
    c.objectId = c.objectId || ((n) => (c.events && c.events[n]) || null);
    c.actorName = c.actorName || ((n) => (Array.isArray(c.actors) && c.actors[n] && c.actors[n].name) || (Array.isArray(c.actors) && typeof c.actors[n] === 'string' ? c.actors[n] : null));
    c.faceId = c.faceId || ((name, index) => (c.faces && c.faces[`${name}:${index}`]) || null);
    c.spriteId = c.spriteId || ((name, index) => (c.sprites && c.sprites[`${name}:${index}`]) || null);
    // MV keeps its audio as loose .ogg/.m4a files, not JSON, so an import can
    // only name the tracks it expects; the author adds the real sounds after.
    c.audioNames = c.audioNames || { sound: new Set(), music: new Set() };
    const audioId = (kind) => (audio) => {
      if (!isObj(audio) || !audio.name) return null;
      const id = pre(slug(audio.name));
      c.audioNames[kind].add(id);
      c.problems.once('info', 'audio-not-imported', id, `'${audio.name}' is an RPG Maker ${kind === 'music' ? 'music track' : 'sound'}; the command now names '${id}', which has to be added to the project`, c.where);
      return id;
    };
    c.soundId = c.soundId || audioId('sound');
    c.musicId = c.musicId || audioId('music');
    return c;
  }
  RM.commandCtx = makeCommandCtx;

  /** target(charId, ctx) -> a Kit target string. -1 = the player, 0 = this event, n>0 = event n. */
  function targetOf(charId, ctx) {
    const n = int(charId, 0);
    if (n < 0) return 'hero';
    if (n === 0) return 'self';
    const id = ctx.objectId(n);
    if (id) return `obj:${id}`;
    ctx.problems.once('warn', 'unknown-event-target', String(n), `a command points at event ${n}, which is not on this map`, ctx.where);
    return `obj:event-${n}`;
  }

  function rgbHex(r, g, b) {
    const h = (v) => clamp(Math.round(num(v, 0)), 0, 255).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }

  /**
   * commands(list, ctx) -> { commands, vars, problems, stats }
   * `list` is an MV event command list (flat, with `indent`). Everything with a
   * Kit equivalent is translated; everything else becomes a `comment` carrying
   * the original code and parameters, plus an `unsupported-command` problem.
   */
  RM.commands = function (list, rawCtx) {
    const ctx = makeCommandCtx(rawCtx);
    const P = ctx.problems;
    const src = Array.isArray(list) ? list.filter(isObj) : [];
    let i = 0;

    const unsupported = (cmd, why) => {
      const code = int(cmd.code, 0);
      const label = CODE_LABELS[code] || 'Unknown';
      ctx.stats.unsupported++;
      P.warn('unsupported-command', `RPG Maker ${label} (${code})${why ? ' — ' + why : ''} has no Kit equivalent; it was kept as a comment`, ctx.where);
      return { t: 'comment', text: `RPG Maker ${label} [${code}] ${JSON.stringify(cmd.parameters || [])}`, mvCode: code, mvParams: JSON.stringify(cmd.parameters || []) };
    };
    const ok = (cmd) => { ctx.stats.translated++; return cmd; };

    function textFrom(raw) { return RM.convertText(raw, { varName: ctx.varName, actorName: ctx.actorName, problems: P, where: ctx.where }); }

    /** Collect the `code`-continuation lines that follow the command at `i`. */
    function collect(code) {
      const out = [];
      while (i < src.length && int(src[i].code, 0) === code) { out.push(String((src[i].parameters || [])[0] == null ? '' : src[i].parameters[0])); i++; }
      return out;
    }

    function condition(params) {
      const p = params || [];
      switch (int(p[0], 0)) {
        case 0: return { kind: 'var', name: ctx.declareSwitch(p[1]), op: '==', value: int(p[2], 0) === 0 };
        case 1: {
          const name = ctx.declareVar(p[1]);
          const op = BRANCH_OPS[int(p[4], 0)] || '==';
          if (int(p[2], 0) === 0) return { kind: 'var', name, op, value: num(p[3], 0) };
          return { kind: 'var', name, op, var: ctx.declareVar(p[3]) };
        }
        case 2: return { kind: 'self', key: String(p[1] || 'A').toLowerCase(), op: '==', value: int(p[2], 0) === 0 };
        case 3: return { kind: 'timer', op: int(p[2], 0) === 0 ? '>=' : '<=', seconds: num(p[1], 0) };
        case 6: return { kind: 'facing', target: targetOf(p[1], ctx), dir: DIR[int(p[2], 2)] || 'down' };
        case 8: return { kind: 'item', id: ctx.itemId(p[1]), op: '>=', count: 1 };
        case 9: return { kind: 'item', id: ctx.weaponId(p[1]), op: '>=', count: 1 };
        case 10: return { kind: 'item', id: ctx.armorId(p[1]), op: '>=', count: 1 };
        case 11: return { kind: 'button', key: String(p[1] || 'ok') };
        default: return null;
      }
    }
    const CONDITION_NAMES = { 4: 'Actor', 5: 'Enemy', 7: 'Gold', 12: 'Script', 13: 'Vehicle' };

    function parseBlock(indent) {
      const out = [];
      while (i < src.length) {
        const cmd = src[i];
        const code = int(cmd.code, 0);
        const ind = int(cmd.indent, 0);
        if (ind < indent) break;
        if (CLOSERS.has(code) && ind <= indent) break;
        if (code === 0) { i++; continue; }                   // the list terminator / a blank line
        if (CONTINUATION.has(code)) { i++; continue; }        // stray continuation (already consumed)
        ctx.stats.total++;
        i++;
        const made = one(cmd, code, ind);
        if (Array.isArray(made)) out.push(...made.filter(Boolean));
        else if (made) out.push(made);
      }
      return out;
    }

    function one(cmd, code, indent) {
      const p = Array.isArray(cmd.parameters) ? cmd.parameters : [];
      switch (code) {
        // ---- messages ------------------------------------------------------
        case 101: {                                           // Show Text (+401 lines)
          const faceName = String(p[0] || ''), faceIndex = int(p[1], 0);
          const lines = collect(401);
          const face = faceName ? ctx.faceId(faceName, faceIndex) : null;
          if (faceName && !face) P.once('info', 'face-unresolved', `${faceName}:${faceIndex}`, `the face '${faceName}' (${faceIndex}) was not imported; the message keeps its text only`, ctx.where);
          return ok({ t: 'say', who: '', face: face || null, text: textFrom(lines.join('\n')),
            position: ['top', 'middle', 'bottom'][clamp(int(p[3], 2), 0, 2)], bg: ['window', 'dim', 'none'][clamp(int(p[2], 0), 0, 2)] });
        }
        case 102: {                                           // Show Choices (+402/403/404)
          const texts = Array.isArray(p[0]) ? p[0] : [];
          const cancelType = int(p[1], -1);
          const defaultType = int(p[2], 0), positionType = p.length > 3 ? int(p[3], 2) : 2, background = p.length > 4 ? int(p[4], 0) : 0;
          const options = [];
          let cancelBody = null;
          // MV writes one 404 at the end of the whole choice; be tolerant of a
          // 404 after each branch too (both encodings appear in the wild).
          while (i < src.length) {
            const h = src[i];
            const hc = int(h.code, 0);
            if (int(h.indent, 0) !== indent) break;
            if (hc === 404) { i++; continue; }
            if (hc !== 402 && hc !== 403) break;
            i++;
            const body = parseBlock(indent + 1);
            if (hc === 402) options.push({ text: textFrom((h.parameters || [])[1]), when: null, then: body });
            else cancelBody = body;
          }
          if (!options.length) for (const t of texts) options.push({ text: textFrom(t), when: null, then: [] });
          let cancel = 'none';
          if (cancelType === -2) cancel = 'skip';
          else if (cancelType >= 0) {
            if (cancelType === options.length - 1) cancel = 'last';
            else { cancel = 'skip'; P.warn('choice-cancel-index', `the B button picked choice ${cancelType + 1}; Kit can only pick the last one, so it now picks nothing`, ctx.where); }
          }
          if (defaultType !== 0 || positionType !== 2 || background !== 0) P.once('info', 'choice-style-dropped', `${defaultType}/${positionType}/${background}`, 'the choice window position, background and default selection are not imported', ctx.where);
          const out = [ok({ t: 'choice', prompt: '', options, cancel })];
          if (cancelBody && cancelBody.length) {
            P.warn('choice-cancel-branch', 'the "When Cancel" branch was kept as a disabled group: Kit choices have no cancel branch', ctx.where);
            out.push({ t: 'group', label: 'When Cancel (RPG Maker)', body: cancelBody, disabled: true });
          }
          return out;
        }
        case 103: return ok({ t: 'inputNumber', var: ctx.declareVar(p[0]), digits: clamp(int(p[1], 3), 1, 8), prompt: '' });
        case 105: { const lines = collect(405); return ok({ t: 'scrollText', text: textFrom(lines.join('\n')), speed: clamp(int(p[0], 2), 1, 8), noFast: !!p[1] }); }
        case 108: { const lines = collect(408); return ok({ t: 'comment', text: [String(p[0] == null ? '' : p[0])].concat(lines).join('\n') }); }

        // ---- flow ----------------------------------------------------------
        case 111: {                                           // Conditional Branch (+411 Else, +412 End)
          const when = condition(p);
          const lead = [];
          if (!when) {
            const sub = int(p[0], 0);
            P.warn('unsupported-condition', `Conditional Branch on ${CONDITION_NAMES[sub] || 'subtype ' + sub} has no Kit condition; the branch now always runs its "then" side`, ctx.where);
            lead.push({ t: 'comment', text: `RPG Maker Conditional Branch [111] ${JSON.stringify(p)}`, mvCode: 111, mvParams: JSON.stringify(p) });
          }
          const then = parseBlock(indent + 1);
          let els = [];
          if (i < src.length && int(src[i].code, 0) === 411 && int(src[i].indent, 0) === indent) { i++; els = parseBlock(indent + 1); }
          if (i < src.length && int(src[i].code, 0) === 412 && int(src[i].indent, 0) === indent) i++;
          if (when) ctx.stats.translated++; else ctx.stats.unsupported++;
          return lead.concat([{ t: 'if', when: when || null, then, else: els }]);
        }
        case 112: {                                           // Loop (+413 Repeat Above)
          const body = parseBlock(indent + 1);
          if (i < src.length && int(src[i].code, 0) === 413 && int(src[i].indent, 0) === indent) i++;
          return ok({ t: 'loop', body });
        }
        case 113: return ok({ t: 'break' });
        case 115: return ok({ t: 'exit' });
        case 117: return ok({ t: 'call', script: ctx.scriptId(p[0]), args: [] });
        case 118: return ok({ t: 'label', name: String(p[0] || 'here') });
        case 119: return ok({ t: 'jump', label: String(p[0] || 'here') });

        // ---- progression ---------------------------------------------------
        case 121: {                                           // Control Switches [start, end, 0 ON | 1 OFF]
          const from = int(p[0], 1), to = Math.max(from, int(p[1], from)), value = int(p[2], 0) === 0;
          const out = [];
          for (let n = from; n <= to; n++) out.push({ t: 'setVar', name: ctx.declareSwitch(n), op: 'set', value });
          if (to > from) P.once('info', 'switch-range', `${from}-${to}`, `Control Switches ${from}..${to} became ${to - from + 1} separate assignments`, ctx.where);
          ctx.stats.translated++;
          return out;
        }
        case 122: {                                           // Control Variables
          const from = int(p[0], 1), to = Math.max(from, int(p[1], from));
          const op = VAR_OPS[int(p[2], 0)] || 'set';
          const operand = int(p[3], 0);
          const make = (n) => {
            const name = ctx.declareVar(n);
            if (operand === 0) return { t: 'setVar', name, op, value: num(p[4], 0) };
            if (operand === 1 && op === 'set') return { t: 'setVar', name, op: 'copyVar', var: ctx.declareVar(p[4]) };
            if (operand === 2 && op === 'set') return { t: 'setVar', name, op: 'random', min: int(p[4], 0), max: int(p[5], 0) };
            return null;
          };
          const out = [];
          let failed = false;
          for (let n = from; n <= to; n++) { const c = make(n); if (c) out.push(c); else failed = true; }
          if (failed) { out.push(unsupported(cmd, operand === 3 ? 'game data operand' : operand === 4 ? 'script operand' : 'this operand cannot be combined with that operation')); }
          else ctx.stats.translated++;
          return out;
        }
        case 123: return ok({ t: 'setSelf', key: String(p[0] || 'A').toLowerCase(), op: 'set', value: int(p[1], 0) === 0 });
        case 124: return ok(int(p[0], 0) === 0 ? { t: 'timer', op: 'start', seconds: num(p[1], 60) } : { t: 'timer', op: 'stop' });
        case 125: {                                           // Change Gold -> a plain Kit number var
          if (int(p[1], 0) !== 0) return unsupported(cmd, 'a variable amount');
          P.once('info', 'gold-as-var', 'gold', "Kit has no money: Change Gold became the number variable 'gold'", ctx.where);
          ctx.declare('gold', { type: 'number', default: 0, label: 'Gold', group: 'RPG Maker' });
          return ok({ t: 'setVar', name: 'gold', op: int(p[0], 0) === 0 ? 'add' : 'sub', value: num(p[2], 0) });
        }
        case 126: case 127: case 128: {                       // Change Items / Weapons / Armors
          if (int(p[2], 0) !== 0) return unsupported(cmd, 'a variable amount');
          const id = code === 126 ? ctx.itemId(p[0]) : code === 127 ? ctx.weaponId(p[0]) : ctx.armorId(p[0]);
          if (code !== 126) P.once('info', 'equipment-as-item', String(code), 'Kit has no weapons or armour: they were imported as plain items', ctx.where);
          return ok({ t: int(p[1], 0) === 0 ? 'give' : 'take', item: id, count: Math.max(1, int(p[3], 1)), notify: false });
        }

        // ---- movement ------------------------------------------------------
        case 201: {                                           // Transfer Player
          if (int(p[0], 0) !== 0) return unsupported(cmd, 'the destination comes from variables');
          const map = ctx.mapId(p[1]);
          if (!map) { P.warn('unknown-map-target', `Transfer Player leads to map ${p[1]}, which was not imported`, ctx.where); }
          const d = int(p[4], 0);
          if (d === 0) P.once('info', 'transfer-retain-dir', '0', "Transfer Player kept the hero's facing; Kit needs one, so 'down' was used", ctx.where);
          return ok({ t: 'transfer', map: map || `map-${int(p[1], 0)}`, x: int(p[2], 0), y: int(p[3], 0), dir: DIR[d] || 'down', fade: int(p[5], 0) !== 2 });
        }
        case 203: {                                           // Set Event Location
          const target = targetOf(p[0], ctx);
          const mode = int(p[1], 0);
          let out;
          if (mode === 0) out = [{ t: 'setLocation', target, x: int(p[2], 0), y: int(p[3], 0), swap: null }];
          else if (mode === 2) { const other = targetOf(p[2], ctx); out = [{ t: 'setLocation', target, x: 0, y: 0, swap: other.startsWith('obj:') ? other.slice(4) : other }]; }
          else return unsupported(cmd, 'the destination comes from variables');
          const d = int(p[4], 0);
          if (d > 0) out.push({ t: 'moveRoute', target, steps: [`face:${DIR[d] || 'down'}`], wait: true, skipBlocked: true, repeat: false });
          ctx.stats.translated++;
          return out;
        }
        case 204: {                                           // Scroll Map [direction, distance, speed]
          const d = int(p[0], 2), dist = int(p[1], 1);
          const dx = d === 4 ? -dist : d === 6 ? dist : 0;
          const dy = d === 8 ? -dist : d === 2 ? dist : 0;
          return ok({ t: 'scrollMap', dx, dy, speed: clamp(int(p[2], 4), 1, 8) });
        }
        case 205: {                                           // Set Movement Route (+505 copies of each step)
          const route = isObj(p[1]) ? p[1] : {};
          const steps = RM.routeSteps(route, ctx);
          while (i < src.length && int(src[i].code, 0) === 505) i++;   // the editor repeats every step as a 505
          return ok({ t: 'moveRoute', target: targetOf(p[0], ctx), steps, wait: !!route.wait, skipBlocked: !!route.skippable, repeat: !!route.repeat });
        }
        case 211: return ok({ t: 'transparency', target: 'hero', on: int(p[0], 0) === 0 });
        case 212: return ok({ t: 'animation', target: targetOf(p[0], ctx), id: `anim-${int(p[1], 0)}` });
        case 213: {
          const b = int(p[1], 1);
          if (BALLOON_APPROX[b]) P.once('info', 'balloon-approximated', String(b), `the '${BALLOON_APPROX[b]}' balloon became '${BALLOON[b]}'`, ctx.where);
          return ok({ t: 'balloon', target: targetOf(p[0], ctx), kind: BALLOON[b] || '!', wait: !!p[2] });
        }
        case 214: return ok({ t: 'erase', target: 'self', persistent: false });
        case 216: return ok({ t: 'follow', on: int(p[0], 0) === 0 });

        // ---- screen --------------------------------------------------------
        case 221: return ok({ t: 'fadeOut', ms: 400, color: '#000000' });     // MV fades over 24 frames
        case 222: return ok({ t: 'fadeIn', ms: 400 });
        case 223: {                                           // Tint Screen [[r,g,b,gray], frames, wait]
          const t = Array.isArray(p[0]) ? p[0] : [0, 0, 0, 0];
          const amount = clamp(Math.max(Math.abs(num(t[0], 0)), Math.abs(num(t[1], 0)), Math.abs(num(t[2], 0)), Math.abs(num(t[3], 0))) / 255, 0, 1);
          const dark = num(t[0], 0) <= 0 && num(t[1], 0) <= 0 && num(t[2], 0) <= 0;
          P.once('info', 'tint-approximated', 'tint', "MV tints add or subtract colour; Kit blends one colour, so the strongest channel became the amount", ctx.where);
          return ok({ t: 'tint', color: dark ? '#000000' : rgbHex(t[0], t[1], t[2]), amount: Math.round(amount * 100) / 100, ms: frames2ms(p[1]) });
        }
        case 224: { const f = Array.isArray(p[0]) ? p[0] : [255, 255, 255, 255]; return ok({ t: 'flash', color: rgbHex(f[0], f[1], f[2]), ms: frames2ms(p[1]) }); }
        case 225: return ok({ t: 'shake', power: clamp(int(p[0], 3), 1, 9), ms: frames2ms(p[2]) });
        case 230: return ok({ t: 'wait', ms: frames2ms(p[0]) });
        case 231: {                                           // Show Picture
          if (int(p[3], 0) !== 0) return unsupported(cmd, 'the position comes from variables');
          if (int(p[6], 100) !== 100 || int(p[7], 100) !== 100 || int(p[9], 0) !== 0) P.once('info', 'picture-style-dropped', 'scale', 'picture scale and blend mode are not imported', ctx.where);
          return ok({ t: 'pictureShow', id: `pic${int(p[0], 1)}`, image: String(p[1] || ''), x: int(p[4], 0), y: int(p[5], 0), anchor: int(p[2], 0) === 0 ? 'topLeft' : 'center', opacity: clamp(num(p[8], 255) / 255, 0, 1) });
        }
        case 232: {                                           // Move Picture
          if (int(p[3], 0) !== 0) return unsupported(cmd, 'the position comes from variables');
          return ok({ t: 'pictureMove', id: `pic${int(p[0], 1)}`, x: int(p[4], 0), y: int(p[5], 0), opacity: clamp(num(p[8], 255) / 255, 0, 1), ms: frames2ms(p[10]), wait: !!p[11] });
        }
        case 235: return ok({ t: 'pictureErase', id: `pic${int(p[0], 1)}` });
        case 236: {
          const kind = WEATHER[String(p[0] || 'none')] || 'none';
          if (String(p[0]) === 'storm') P.once('info', 'weather-approximated', 'storm', "MV's 'storm' became Kit's 'rain'", ctx.where);
          return ok({ t: 'weather', kind, power: clamp(int(p[1], 5), 1, 9), ms: frames2ms(p[2]) });
        }

        // ---- audio ---------------------------------------------------------
        case 241: { const a = isObj(p[0]) ? p[0] : {}; return ok({ t: 'music', id: ctx.musicId(a), fade: 0, volume: clamp(num(a.volume, 90) / 100, 0, 1) }); }
        case 242: return ok({ t: 'music', id: null, fade: Math.round(num(p[0], 0) * 1000) });
        case 243: return ok({ t: 'saveMusic' });
        case 244: return ok({ t: 'replayMusic' });
        case 249: { const a = isObj(p[0]) ? p[0] : {}; return ok({ t: 'jingle', id: ctx.musicId(a) || 'jingle' }); }
        case 250: { const a = isObj(p[0]) ? p[0] : {}; return ok({ t: 'sound', id: ctx.soundId(a) || 'sound', volume: clamp(num(a.volume, 90) / 100, 0, 1) }); }
        case 251: return ok({ t: 'stopSound' });

        // ---- system --------------------------------------------------------
        case 303: {                                           // Name Input Processing [actorId, maxLength]
          const n = int(p[0], 1);
          return ok({ t: 'nameEntry', hero: n === 1 ? 'p1' : n === 2 ? 'p2' : 'hero', prompt: '', maxLength: clamp(int(p[1], 8), 1, 16) });
        }
        case 314: return ok({ t: 'heal', hero: 'all' });
        case 351: return ok({ t: 'menu' });
        case 352: return ok({ t: 'save', prompt: false, slot: 'autosave' });
        case 353: P.once('info', 'gameover-as-title', '353', 'Kit has no Game Over screen; Game Over returns to the title', ctx.where); return ok({ t: 'title' });
        case 354: return ok({ t: 'title' });
        case 355: { const lines = [String(p[0] == null ? '' : p[0])].concat(collect(655)); ctx.stats.unsupported++; P.warn('unsupported-command', 'RPG Maker Script (355) cannot run in Kit; it was kept as a comment', ctx.where); return { t: 'comment', text: `RPG Maker Script [355]\n${lines.join('\n')}`, mvCode: 355, mvParams: JSON.stringify(lines) }; }
        case 356: case 357: return unsupported(cmd, 'plugin commands depend on the plugin');

        default: return unsupported(cmd, null);
      }
    }

    const out = parseBlock(0);
    // Anything left over means the list closed a block it never opened.
    while (i < src.length) {
      const code = int(src[i].code, 0);
      if (!CLOSERS.has(code) && code !== 0 && !CONTINUATION.has(code)) P.once('warn', 'stray-command', String(code), `command ${code} (${CODE_LABELS[code] || 'unknown'}) sat outside any block and was skipped`, ctx.where);
      i++;
    }
    return { commands: out, vars: ctx.vars, problems: P.list, stats: ctx.stats };
  };

  // =========================================================================
  // Character sheets and faces
  // =========================================================================

  /** signOf('$!Hero') -> { sign:'$!', name:'Hero', big:true, noOffset:true } */
  RM.signOf = function (imageName) {
    const s = String(imageName || '');
    const m = /^[!$]+/.exec(s);
    const sign = m ? m[0] : '';
    return { sign, name: s.slice(sign.length), big: sign.indexOf('$') >= 0, noOffset: sign.indexOf('!') >= 0 };
  };

  /**
   * resolveAsset(src, fallbackId, opts, problems, where, from) -> { id, src, w, h, from }
   * The caller's `opts.asset(src)` names the asset (the CLI copies the file, the
   * browser panel makes a data URI). Without one the original path is kept and
   * an `asset-unresolved` problem is added — the import still succeeds.
   */
  function resolveAsset(src, fallbackId, opts, problems, where, from) {
    const o = opts || {};
    if (typeof o.asset === 'function') {
      const a = o.asset(src);
      if (a && a.id) return { id: String(a.id), src: a.src == null ? src : a.src, w: int(a.w, 0), h: int(a.h, 0), from };
    }
    problems.once('warn', 'asset-unresolved', src, `no resolver for '${src}'; the original path was kept and the image has no size yet`, where);
    return { id: fallbackId, src, w: 0, h: 0, from };
  }

  /**
   * characters(imageName, opts) -> { assets, sprites, problems, sheet }
   * MV sheets hold 8 characters in a 4x2 grid of 3x4 frames (3 walk columns x
   * 4 direction rows: down, left, right, up). A '$' prefix means one character
   * fills the sheet (3x4 frames); a '!' prefix only removes the half-tile
   * y-offset when drawing, so it changes nothing here.
   * Frames are ordered [standing, step A, step B] = MV columns 1, 0, 2, because
   * MV's resting pattern is the middle column while Kit's frame 0 is the
   * standing one (KIT.entities.frame uses the sequence [0,1,0,2]).
   *
   * Kit mirrors `left` to draw `right`, but MV sheets have a real right row, so
   * one is produced. KIT.entities.frame already honours `def.frames.right`
   * (it only mirrors when that key is missing) — nothing to change there.
   * The renderer is a different matter: js/kit/render/renderer.js artForFrame()
   * builds a pixel-string art out of `frame.rows`, which for an image-backed
   * sprite is the source RECT, so these sprites do not draw yet. See the note
   * in the import report; the fix belongs in renderer.js, not here.
   */
  RM.characters = function (imageName, opts) {
    const o = opts || {};
    const P = o.problems || bag();                              // share the caller's bag so its problems land in one list
    const where = o.where || {};
    const sign = RM.signOf(imageName);
    const prefix = o.prefix ? `${o.prefix}:` : '';
    const dir = o.imageDir === undefined ? 'img/' : o.imageDir;
    const src = `${dir}characters/${imageName}.png`;
    const a = resolveAsset(src, `${prefix}char-${slug(sign.name) || slug(imageName)}`, o, P, where, `rpgmaker-mv:img/characters/${imageName}.png`);
    const assetId = a.id;
    const assets = {};
    assets[assetId] = { kind: 'image', src: a.src, w: a.w, h: a.h, from: a.from };

    const cols = sign.big ? 3 : 12, rows = sign.big ? 4 : 8;
    const fallback = int(o.frameSize, 0) || 48;
    let fw = a.w ? a.w / cols : fallback;
    let fh = a.h ? a.h / rows : fallback * 4 / 3;              // MV frames are 48x48 by default but a sheet may be any size
    if (!Number.isInteger(fw) || !Number.isInteger(fh) || fw <= 0 || fh <= 0) {
      P.once('info', 'frame-size-guess', imageName, `'${imageName}' is ${a.w}x${a.h}, which does not divide into ${cols}x${rows} frames; ${fallback}px frames were assumed`, where);
      fw = fallback; fh = fallback;
    }

    const count = sign.big ? 1 : 8;
    const order = [1, 0, 2];                                   // standing, step A, step B
    const DIRS = ['down', 'left', 'right', 'up'];              // MV row order: (direction - 2) / 2
    const sprites = [];
    for (let index = 0; index < count; index++) {
      const blockX = sign.big ? 0 : (index % 4) * 3;
      const blockY = sign.big ? 0 : Math.floor(index / 4) * 4;
      const frames = {};
      DIRS.forEach((d, row) => {
        frames[d] = order.map((col) => ({ x: (blockX + col) * fw, y: (blockY + row) * fh, w: fw, h: fh }));
      });
      const id = `${prefix}${slug(sign.name) || slug(imageName)}${sign.big ? '' : '-' + index}`;
      sprites.push({ id, name: `${sign.name || imageName}${sign.big ? '' : ' ' + (index + 1)}`, group: 'rpgmaker',
        image: assetId, w: fw, h: fh, frames, mvCharacter: { name: imageName, index } });
    }
    return { assets, sprites, problems: P.list, sheet: { asset: assetId, big: sign.big, noOffset: sign.noOffset, cols, rows, frameW: fw, frameH: fh, count } };
  };

  /**
   * faces(imageName, opts) -> { assets, faces, problems, sheet }
   * MV face sheets are a 4x2 grid of 144x144 portraits (faceIndex 0-7).
   */
  RM.faces = function (imageName, opts) {
    const o = opts || {};
    const P = o.problems || bag();                              // share the caller's bag so its problems land in one list
    const where = o.where || {};
    const prefix = o.prefix ? `${o.prefix}:` : '';
    const dir = o.imageDir === undefined ? 'img/' : o.imageDir;
    const src = `${dir}faces/${imageName}.png`;
    const a = resolveAsset(src, `${prefix}faceset-${slug(imageName)}`, o, P, where, `rpgmaker-mv:img/faces/${imageName}.png`);
    const assetId = a.id;
    const assets = {};
    assets[assetId] = { kind: 'image', src: a.src, w: a.w, h: a.h, from: a.from };
    let fw = a.w ? a.w / 4 : 144, fh = a.h ? a.h / 2 : 144;
    if (!Number.isInteger(fw) || !Number.isInteger(fh) || fw <= 0) {
      P.once('info', 'frame-size-guess', imageName, `face sheet '${imageName}' is ${a.w}x${a.h}, which is not a 4x2 grid; 144px faces were assumed`, where);
      fw = 144; fh = 144;
    }
    const faces = [];
    for (let index = 0; index < 8; index++) {
      faces.push({ id: `${prefix}face-${slug(imageName)}-${index}`, name: `${imageName} ${index + 1}`, group: 'rpgmaker',
        art: { image: assetId, frame: { x: (index % 4) * fw, y: Math.floor(index / 4) * fh, w: fw, h: fh } },
        mvFace: { name: imageName, index } });
    }
    return { assets, faces, problems: P.list, sheet: { asset: assetId, cols: 4, rows: 2, frameW: fw, frameH: fh } };
  };

  // =========================================================================
  // Tiles
  // =========================================================================

  /**
   * tileRect(tileId, tileW, tileH) -> { x, y, w, h } for a plain (non-autotile)
   * tile, exactly as Tilemap._drawNormalTile computes it.
   */
  RM.tileRect = function (tileId, tileW, tileH) {
    const id = int(tileId, 0);
    const w = int(tileW, 48), h = int(tileH, tileW || 48);
    return { x: ((Math.floor(id / 128) % 2) * 8 + (id % 8)) * w, y: (Math.floor((id % 256) / 8) % 16) * h, w, h };
  };

  /**
   * autotileOrigin(tileId) -> { kind, shape, table, bx, by, sheet } — the block
   * origin in half-tile units and the shape table to read, following
   * Tilemap._drawAutotile with animationFrame 0 (the still water frame).
   */
  RM.autotileOrigin = function (tileId) {
    const id = int(tileId, 0);
    const kind = RM.autotileKind(id), shape = RM.autotileShape(id);
    const tx = kind % 8, ty = Math.floor(kind / 8);
    let bx = 0, by = 0, table = FLOOR_AUTOTILE_TABLE, sheet = 0;
    if (id >= TILE_ID_A1 && id < TILE_ID_A2) {
      sheet = 0;
      if (kind === 0) { bx = 0; by = 0; }
      else if (kind === 1) { bx = 0; by = 3; }
      else if (kind === 2) { bx = 6; by = 0; }
      else if (kind === 3) { bx = 6; by = 3; }
      else {
        bx = Math.floor(tx / 4) * 8;
        by = ty * 6 + (Math.floor(tx / 2) % 2) * 3;
        if (kind % 2 !== 0) { bx += 6; table = WATERFALL_AUTOTILE_TABLE; }
      }
    } else if (id >= TILE_ID_A2 && id < TILE_ID_A3) { sheet = 1; bx = tx * 2; by = (ty - 2) * 3; }
    else if (id >= TILE_ID_A3 && id < TILE_ID_A4) { sheet = 2; bx = tx * 2; by = (ty - 6) * 2; table = WALL_AUTOTILE_TABLE; }
    else if (id >= TILE_ID_A4 && id < TILE_ID_MAX) {
      sheet = 3; bx = tx * 2; by = Math.floor((ty - 10) * 2.5 + (ty % 2 === 1 ? 0.5 : 0));
      if (ty % 2 === 1) table = WALL_AUTOTILE_TABLE;
    }
    return { kind, shape, table, bx, by, sheet };
  };

  /**
   * tileArt(tileId, sheets, opts) -> { art, sheet, flattened, kind, shape } | null
   * `sheets` is { [setNumber]: { asset, tileW, tileH } }. Autotiles are
   * flattened: the shape's TOP-LEFT quarter becomes the origin of one whole
   * tile (see the note at the top of this file).
   */
  RM.tileArt = function (tileId, sheets, opts) {
    const id = int(tileId, 0);
    const setNumber = RM.sheetIndexOf(id);
    if (setNumber < 0) return null;
    const sheet = (sheets || {})[setNumber];
    if (!sheet || !sheet.asset) return null;
    const tw = int(sheet.tileW, (opts && opts.tileSize) || 48), th = int(sheet.tileH, tw);
    if (id < TILE_ID_A1) return { art: { image: sheet.asset, frame: RM.tileRect(id, tw, th) }, sheet: setNumber, flattened: false, kind: -1, shape: -1 };
    const o = RM.autotileOrigin(id);
    const quarter = (o.table[o.shape] || o.table[0])[0];
    const x = (o.bx * 2 + quarter[0]) * (tw / 2);
    const y = (o.by * 2 + quarter[1]) * (th / 2);
    return { art: { image: sheet.asset, frame: { x: Math.round(x), y: Math.round(y), w: tw, h: th } }, sheet: setNumber, flattened: true, kind: o.kind, shape: o.shape };
  };

  /**
   * tileFlags(flag) -> the Kit tile flag fields for one entry of Tilesets[n].flags.
   * The bits are listed at the top of this file. `props` keeps everything Kit
   * has no field for, so nothing is lost.
   */
  RM.tileFlags = function (flag, tileId) {
    const f = int(flag, 0);
    const star = (f & 0x10) !== 0;
    const passage = { n: star || (f & 0x08) === 0, s: star || (f & 0x01) === 0, e: star || (f & 0x04) === 0, w: star || (f & 0x02) === 0 };
    const isA2 = int(tileId, 0) >= TILE_ID_A2 && int(tileId, 0) < TILE_ID_A3;
    const counterBit = (f & 0x80) !== 0;
    const props = {};
    if (star) props.star = true;
    if ((f & 0x20) !== 0) props.ladder = true;
    if ((f & 0x100) !== 0) props.damageFloor = true;
    if ((f & 0x200) !== 0) props.noBoat = true;
    if ((f & 0x400) !== 0) props.noShip = true;
    if ((f & 0x800) !== 0) props.noAirship = true;
    if (isA2 && counterBit) props.table = true;
    props.mvFlag = f;
    return {
      solid: !star && (f & 0x0f) === 0x0f,
      passage,
      bush: (f & 0x40) !== 0,
      counter: counterBit && !isA2,
      terrainTag: (f >> 12) & 0x0f,
      props,
    };
  };

  // =========================================================================
  // detect
  // =========================================================================

  const MAP_FILE = /^(?:.*[\\/])?Map(\d{3,})\.json$/i;
  function baseName(key) { const s = String(key); const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')); return i >= 0 ? s.slice(i + 1) : s; }
  function pick(files, name) {
    if (!isObj(files)) return undefined;
    if (files[name] !== undefined) return files[name];
    for (const k of Object.keys(files)) if (baseName(k).toLowerCase() === name.toLowerCase()) return files[k];
    return undefined;
  }
  function mapFiles(files) {
    const out = [];
    if (!isObj(files)) return out;
    for (const k of Object.keys(files)) {
      const m = MAP_FILE.exec(baseName(k));
      if (m && isObj(files[k]) && Array.isArray(files[k].data)) out.push({ key: k, id: parseInt(m[1], 10), map: files[k] });
    }
    out.sort((a, b) => a.id - b.id);
    return out;
  }

  /** detect(files) -> { ok, tool, dialect, maps, reason, problems } */
  RM.detect = function (files) {
    const problems = [];
    const system = pick(files, 'System.json');
    const tilesets = pick(files, 'Tilesets.json');
    const maps = mapFiles(files);
    const hasSystem = isObj(system) && (Array.isArray(system.switches) || Array.isArray(system.variables) || system.startMapId !== undefined);
    const hasTilesets = Array.isArray(tilesets) && tilesets.some(t => isObj(t) && Array.isArray(t.tilesetNames));
    const ok = !!(hasSystem || hasTilesets || maps.length);
    let dialect = 'MV';
    if (isObj(system) && (system.advanced !== undefined || system.itemCategories !== undefined)) dialect = 'MZ';
    for (const m of maps) for (const e of (m.map.events || [])) if (isObj(e)) for (const pg of (e.pages || [])) for (const c of ((pg && pg.list) || [])) if (isObj(c) && int(c.code, 0) === 357) dialect = 'MZ';
    if (dialect === 'MZ') problems.push({ severity: 'info', code: 'mz-dialect', message: 'this looks like RPG Maker MZ; the data files are read the same way, but MZ-only commands (357 plugin command) are not translated', where: {} });
    return { ok, tool: RM.TOOL, dialect, maps: maps.map(m => m.id), reason: ok ? null : 'no System.json, Tilesets.json or MapNNN.json with a data array', problems };
  };

  // =========================================================================
  // project
  // =========================================================================

  /**
   * project(files, opts) -> Result (docs/IMPORT-CONTRACT.md).
   * files: { 'MapInfos.json', 'MapNNN.json', 'Tilesets.json', 'System.json',
   *          'CommonEvents.json', 'Items.json', 'Weapons.json', 'Armors.json', 'Actors.json' }
   * opts:  { prefix, asset(src), tileSize, imageDir }
   */
  RM.project = function (files, opts) {
    const o = opts || {};
    const det = RM.detect(files);
    if (!det.ok) throw new Error(`KIT.import.rpgmaker: this is not an RPG Maker project (${det.reason})`);
    const P = bag();
    for (const p of det.problems) P.list.push(p);

    const prefix = o.prefix ? String(o.prefix) : '';
    const pre = (id) => (prefix ? `${prefix}:${id}` : id);
    const system = isObj(pick(files, 'System.json')) ? pick(files, 'System.json') : {};
    const tilesets = Array.isArray(pick(files, 'Tilesets.json')) ? pick(files, 'Tilesets.json') : [];
    const mapInfos = Array.isArray(pick(files, 'MapInfos.json')) ? pick(files, 'MapInfos.json') : [];
    const commonEvents = Array.isArray(pick(files, 'CommonEvents.json')) ? pick(files, 'CommonEvents.json') : [];
    const itemsData = Array.isArray(pick(files, 'Items.json')) ? pick(files, 'Items.json') : [];
    const weaponsData = Array.isArray(pick(files, 'Weapons.json')) ? pick(files, 'Weapons.json') : [];
    const armorsData = Array.isArray(pick(files, 'Armors.json')) ? pick(files, 'Armors.json') : [];
    const actorsData = Array.isArray(pick(files, 'Actors.json')) ? pick(files, 'Actors.json') : [];
    const maps = mapFiles(files);
    if (!maps.length) P.warn('no-maps', 'no MapNNN.json file was given, so the import has no maps', {});

    const names = RM.nameTable(system.switches, system.variables);
    for (const k of names.collisions) P.info('name-collision', `the name '${k}' is used by more than one switch or variable; those keep their numbered names (switch-n / var-n)`, {});

    const result = {
      assets: {}, tiles: [], sprites: [], faces: [], maps: {}, objects: [],
      scripts: {}, vars: {}, items: {}, project: null, problems: P.list,
      stats: { maps: 0, events: 0, pages: 0, tiles: 0, assets: 0, sprites: 0, faces: 0, scripts: 0, vars: 0, items: 0,
        commands: { total: 0, translated: 0, unsupported: 0 }, problems: { error: 0, warn: 0, info: 0 } },
    };

    // ---- items ------------------------------------------------------------
    const itemIds = {}, weaponIds = {}, armorIds = {};
    const takeItems = (list, table, kindPrefix, kind) => {
      list.forEach((it, n) => {
        if (!isObj(it)) return;
        const id = pre(it.name && String(it.name).trim() ? slug(it.name) : `${kindPrefix}-${n}`);
        table[n] = id;
        result.items[id] = { kind, name: it.name || `${kindPrefix} ${n}`, icon: null, desc: String(it.description || ''), note: it.note ? String(it.note) : '', props: { mvId: n, mvIcon: int(it.iconIndex, 0) } };
      });
    };
    takeItems(itemsData, itemIds, 'item', 'item');
    takeItems(weaponsData, weaponIds, 'weapon', 'item');
    takeItems(armorsData, armorIds, 'armor', 'item');

    // ---- common event ids (needed before the maps, which may `call` them) --
    const scriptIdFor = {};
    {
      const used = new Set();
      commonEvents.forEach((ce, n) => {
        if (!isObj(ce)) return;
        const base = ce.name && String(ce.name).trim() ? slug(ce.name) : `common-${n}`;
        let id = pre(base), k = 2;
        while (used.has(id)) id = pre(`${base}-${k++}`);
        used.add(id);
        scriptIdFor[int(ce.id, n)] = id;
      });
    }

    // Vars declared straight from page conditions and common event triggers.
    const declareSwitch = (nn) => { const name = names.switchName(nn); if (!result.vars[name]) result.vars[name] = { type: 'bool', default: false, label: names.switchLabel(nn), group: 'Switches' }; return name; };
    const declareVariable = (nn) => { const name = names.varName(nn); if (!result.vars[name]) result.vars[name] = { type: 'number', default: 0, label: names.varLabel(nn), group: 'Variables' }; return name; };

    // ---- art: character sheets and faces ----------------------------------
    const spriteIds = {}, faceIds = {};
    const sheetOpts = { prefix, asset: o.asset, imageDir: o.imageDir, frameSize: o.tileSize, problems: P, where: {} };
    const wantedCharacters = new Set(), wantedFaces = new Set();
    const noteCharacter = (name) => { if (name) wantedCharacters.add(String(name)); };
    const noteFace = (name) => { if (name) wantedFaces.add(String(name)); };
    for (const m of maps) for (const e of (m.map.events || [])) {
      if (!isObj(e)) continue;
      for (const pg of (e.pages || [])) {
        if (!isObj(pg)) continue;
        if (isObj(pg.image)) noteCharacter(pg.image.characterName);
        for (const c of (pg.list || [])) {
          if (!isObj(c)) continue;
          if (int(c.code, 0) === 101) noteFace((c.parameters || [])[0]);
          if (int(c.code, 0) === 505 && isObj((c.parameters || [])[0]) && int(c.parameters[0].code, 0) === 41) noteCharacter((c.parameters[0].parameters || [])[0]);
        }
      }
    }
    for (const ce of commonEvents) if (isObj(ce)) for (const c of (ce.list || [])) if (isObj(c) && int(c.code, 0) === 101) noteFace((c.parameters || [])[0]);
    for (const a of actorsData) if (isObj(a)) { noteCharacter(a.characterName); noteFace(a.faceName); }

    for (const name of Array.from(wantedCharacters).sort()) {
      const r = RM.characters(name, sheetOpts);
      Object.assign(result.assets, r.assets);
      for (const sp of r.sprites) { result.sprites.push(sp); spriteIds[`${name}:${sp.mvCharacter.index}`] = sp.id; }
      if (r.sheet.big) for (let k = 0; k < 8; k++) spriteIds[`${name}:${k}`] = r.sprites[0].id;   // a $ sheet ignores the index
    }
    for (const name of Array.from(wantedFaces).sort()) {
      const r = RM.faces(name, sheetOpts);
      Object.assign(result.assets, r.assets);
      for (const f of r.faces) { result.faces.push(f); faceIds[`${name}:${f.mvFace.index}`] = f.id; }
    }

    // ---- tilesets ---------------------------------------------------------
    // One Kit tile per distinct tile id actually used by the maps, sliced from
    // the sheet the id belongs to. Tile ids are `<tilesetSlug>:<tileId>`.
    const tilesetSheets = {};          // tilesetId -> { [setNumber]: { asset, tileW, tileH } }
    const tilesetSlug = {};
    function sheetsFor(tilesetId) {
      if (tilesetSheets[tilesetId]) return tilesetSheets[tilesetId];
      const ts = tilesets[tilesetId];
      const sheets = {};
      if (!isObj(ts)) { P.warn('unknown-tileset', `map tileset ${tilesetId} is missing from Tilesets.json`, {}); tilesetSheets[tilesetId] = sheets; tilesetSlug[tilesetId] = `tileset-${tilesetId}`; return sheets; }
      tilesetSlug[tilesetId] = slug(ts.name) || `tileset-${tilesetId}`;
      const list = Array.isArray(ts.tilesetNames) ? ts.tilesetNames : [];
      list.forEach((name, setNumber) => {
        if (!name) return;
        const dir = o.imageDir === undefined ? 'img/' : o.imageDir;
        const src = `${dir}tilesets/${name}.png`;
        const a = resolveAsset(src, pre(`tileset-${slug(name)}`), o, P, {}, `rpgmaker-mv:img/tilesets/${name}.png`);
        const assetId = a.id;
        result.assets[assetId] = { kind: 'image', src: a.src, w: a.w, h: a.h, from: a.from };
        const cols = SHEET_COLUMNS[setNumber] || 16;
        let tw = o.tileSize ? int(o.tileSize, 48) : (a.w ? a.w / cols : 48);
        if (!Number.isInteger(tw) || tw <= 0) {
          P.once('info', 'tile-size-guess', name, `sheet '${name}' is ${a.w}px wide, which does not divide into ${cols} columns; ${o.tileSize || 48}px tiles were assumed`, {});
          tw = int(o.tileSize, 48);
        }
        sheets[setNumber] = { asset: assetId, tileW: tw, tileH: tw, name, sheet: SHEET_NAMES[setNumber] };
      });
      tilesetSheets[tilesetId] = sheets;
      return sheets;
    }

    const tileDefs = new Map();        // kit tile id -> def
    function tileFor(tilesetId, tileId) {
      if (!tileId) return null;
      const sheets = sheetsFor(tilesetId);
      const setNumber = RM.sheetIndexOf(tileId);
      if (setNumber < 0) { P.once('warn', 'unknown-tile-id', String(tileId), `tile id ${tileId} is outside every RPG Maker sheet range and was left empty`, {}); return null; }
      const tsSlug = tilesetSlug[tilesetId] || `tileset-${tilesetId}`;
      const id = pre(`${tsSlug}:${tileId}`);
      if (tileDefs.has(id)) return id;
      const ts = tilesets[tilesetId];
      const art = RM.tileArt(tileId, sheets, o);
      if (!art) {
        P.once('warn', 'missing-sheet', `${tilesetId}/${setNumber}`, `tileset '${tsSlug}' has no ${SHEET_NAMES[setNumber]} sheet, but its tiles are used on a map; those tiles have no art`, {});
      } else if (art.flattened) {
        P.info('autotile-flattened', `tile ${tileId} is autotile kind ${art.kind} shape ${art.shape}; Kit bakes its own autotiles, so this became the shape's top-left piece as one flat tile`, {});
      }
      const flags = RM.tileFlags(isObj(ts) && Array.isArray(ts.flags) ? ts.flags[tileId] : 0, tileId);
      const notes = [];
      if (flags.props.ladder) notes.push('Ladder in RPG Maker: Kit has no ladder flag.');
      if (flags.props.damageFloor) notes.push('Damage floor in RPG Maker: Kit has no damage floor.');
      if (flags.props.table) notes.push('Table tile in RPG Maker (the A2 counter bit).');
      if (flags.props.star) notes.push('Star [*] tile in RPG Maker: it never affects passage.');
      if (art && art.flattened) notes.push(`Autotile kind ${art.kind} shape ${art.shape}, flattened.`);
      const def = {
        id, name: `${isObj(ts) && ts.name ? ts.name : tsSlug} ${tileId}`, group: tsSlug,
        art: art ? art.art : null,
        solid: flags.solid, passage: flags.passage, bush: flags.bush, counter: flags.counter,
        ledge: null, warpLook: false, encounter: false, terrainTag: flags.terrainTag,
        probability: 1, animMs: 500, note: notes.join(' '),
        props: Object.assign({ mvTileId: tileId, mvTileset: tilesetId, mvSheet: SHEET_NAMES[setNumber] }, flags.props),
      };
      tileDefs.set(id, def);
      result.tiles.push(def);
      return id;
    }

    // ---- maps -------------------------------------------------------------
    const infoById = {};
    for (const mi of mapInfos) if (isObj(mi) && mi.id !== undefined) infoById[int(mi.id, 0)] = mi;
    const mapIdFor = {};
    const usedMapIds = new Set();
    for (const m of maps) {
      const info = infoById[m.id];
      const base = info && info.name && String(info.name).trim() ? slug(info.name) : `map-${m.id}`;
      let id = pre(base), n = 2;
      while (usedMapIds.has(id)) { id = pre(`${base}-${n++}`); P.once('info', 'duplicate-map-name', base, `more than one map is called '${base}'; the later ones were numbered`, {}); }
      usedMapIds.add(id);
      mapIdFor[m.id] = id;
    }

    const objectIdsByMap = {};         // mvMapId -> { mvEventId: kitObjectId }
    for (const m of maps) {
      const table = objectIdsByMap[m.id] = {};
      const used = new Set();
      for (const e of (m.map.events || [])) {
        if (!isObj(e)) continue;
        const base = e.name && String(e.name).trim() ? slug(e.name) : `event-${int(e.id, 0)}`;
        let id = base, n = 2;
        while (used.has(id)) id = `${base}-${n++}`;
        used.add(id);
        table[int(e.id, 0)] = id;
      }
    }

    const KIND_BY_TILESET_MODE = { 0: 'outdoor', 1: 'indoor', 2: 'outdoor' };   // Tilesets mode: 0 field, 1 area, 2 VX-style field
    /** Name a track the project will need; RPG Maker audio is not JSON, so it cannot be imported. */
    function noteAudio(kind, audio) {
      if (!isObj(audio) || !audio.name) return null;
      const id = pre(slug(audio.name));
      P.once('info', 'audio-not-imported', id, `'${audio.name}' is an RPG Maker ${kind === 'music' ? 'music track' : 'sound'}; the project now names '${id}', which has to be added`, {});
      return id;
    }

    for (const m of maps) {
      const mapId = mapIdFor[m.id];
      const src = m.map;
      const w = Math.max(1, int(src.width, 1)), h = Math.max(1, int(src.height, 1));
      const n = w * h;
      const data = Array.isArray(src.data) ? src.data : [];
      if (data.length !== n * 6) P.warn('bad-map-data', `map '${mapId}' has ${data.length} data cells, expected ${n * 6} (width x height x 6)`, { map: mapId });
      const at = (z, x, y) => int(data[(z * h + y) * w + x], 0);
      const tilesetId = int(src.tilesetId, 1);
      const layers = { terrain: new Array(n).fill(0), ground: new Array(n).fill(null), deco: new Array(n).fill(null), above: new Array(n).fill(null), regions: new Array(n).fill(0) };
      const LAYER_FOR_Z = ['ground', 'deco', 'above', 'above'];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        for (let z = 0; z < 4; z++) {
          const tileId = at(z, x, y);
          if (!tileId) continue;
          const kit = tileFor(tilesetId, tileId);
          if (!kit) continue;
          const layer = LAYER_FOR_Z[z];
          if (layers[layer][i] != null) { P.once('warn', 'layer-overflow', mapId, `map '${mapId}' stacks more tiles than Kit's three layers hold; the topmost RPG Maker layer won at some cells`, { map: mapId }); }
          layers[layer][i] = kit;
        }
        layers.regions[i] = clamp(at(5, x, y), 0, 255);
      }
      const mapKind = KIND_BY_TILESET_MODE[int((tilesets[tilesetId] || {}).mode, 0)] || 'outdoor';

      const objects = [];
      for (const e of (src.events || [])) {
        if (!isObj(e)) continue;
        result.stats.events++;
        const objId = objectIdsByMap[m.id][int(e.id, 0)];
        const where = { map: mapId, object: objId };
        const pages = [];
        const mvPages = Array.isArray(e.pages) && e.pages.length ? e.pages : [{}];
        let hasImage = false;
        mvPages.forEach((pg, pi) => {
          if (!isObj(pg)) pg = {};
          result.stats.pages++;
          const pwhere = { map: mapId, object: objId, page: pi };
          const image = isObj(pg.image) ? pg.image : {};
          if (image.characterName) hasImage = true;
          if (!image.characterName && int(image.tileId, 0) > 0) P.once('info', 'tile-event', `${mapId}:${objId}`, `'${objId}' on '${mapId}' is drawn with a map tile, which Kit objects cannot do; it has no sprite`, pwhere);

          // conditions -> Kit `when`
          const c = isObj(pg.conditions) ? pg.conditions : {};
          const conds = [];
          if (c.switch1Valid) conds.push({ kind: 'var', name: declareSwitch(int(c.switch1Id, 1)), op: '==', value: true });
          if (c.switch2Valid) conds.push({ kind: 'var', name: declareSwitch(int(c.switch2Id, 1)), op: '==', value: true });
          if (c.variableValid) conds.push({ kind: 'var', name: declareVariable(int(c.variableId, 1)), op: '>=', value: num(c.variableValue, 0) });
          if (c.selfSwitchValid) conds.push({ kind: 'self', key: String(c.selfSwitchCh || 'A').toLowerCase(), op: '==', value: true });
          if (c.itemValid) conds.push({ kind: 'item', id: itemIds[int(c.itemId, 1)] || pre(`item-${int(c.itemId, 1)}`), op: '>=', count: 1 });
          const props = {};
          if (c.actorValid) {
            P.warn('unsupported-condition', `'${objId}' page ${pi + 1} only appears when actor ${c.actorId} is in the party; Kit has no party, so that part of the condition was dropped (kept on props.mvActorCondition)`, pwhere);
            props.mvActorCondition = int(c.actorId, 0);
          }
          const when = conds.length === 0 ? null : conds.length === 1 ? conds[0] : { kind: 'all', of: conds };

          // commands
          const cmdCtx = makeCommandCtx({
            names, prefix, problems: P, where: pwhere, vars: result.vars,
            items: itemIds, weapons: weaponIds, armors: armorIds,
            maps: mapIdFor, scripts: scriptIdFor, events: objectIdsByMap[m.id],
            actors: actorsData, faces: faceIds, sprites: spriteIds,
            stats: result.stats.commands,
          });
          const translated = RM.commands(pg.list || [], cmdCtx);
          const slot = TRIGGER_SLOT[int(pg.trigger, 0)] || 'interact';
          const on = {};
          if (translated.commands.length) on[slot] = translated.commands;
          if (slot === 'tick' && translated.commands.some(cm => cm && (cm.t === 'say' || cm.t === 'choice'))) {
            P.warn('parallel-message', `'${objId}' page ${pi + 1} is a Parallel event that shows a message; Kit forbids that on a background thread`, pwhere);
          }

          const moveKind = MOVE_KIND[int(pg.moveType, 0)] || 'none';
          const behaviour = { kind: moveKind, radius: 3, speed: RM.speedToTiles(pg.moveSpeed), frequency: RM.frequencyToKit(pg.moveFrequency), route: [], repeat: true };
          if (moveKind === 'route') {
            const route = isObj(pg.moveRoute) ? pg.moveRoute : {};
            behaviour.route = RM.routeSteps(route, { problems: P, where: pwhere, spriteId: (nm, ix) => spriteIds[`${nm}:${ix}`] || null, soundId: (a) => (isObj(a) && a.name ? pre(slug(a.name)) : null) });
            behaviour.repeat = !!route.repeat;
          }
          if (pg.walkAnime === false) P.once('info', 'walk-anime-dropped', `${mapId}:${objId}`, 'Kit always animates a walking sprite; "Walking" off was not imported', pwhere);

          pages.push({
            when,
            sprite: image.characterName ? (spriteIds[`${image.characterName}:${int(image.characterIndex, 0)}`] || null) : null,
            dir: DIR[int(image.direction, 2)] || 'down',
            layer: PRIORITY_LAYER[int(pg.priorityType, 0)] || 'below',
            through: !!pg.through, dirFix: !!pg.directionFix, stepAnim: !!pg.stepAnime,
            visible: !!(image.characterName || int(image.tileId, 0) > 0),
            behaviour, on, once: false, needsBoth: false,
            props: Object.assign(props, { mvTrigger: int(pg.trigger, 0) }),
          });
        });
        objects.push({ id: objId, name: e.name ? String(e.name) : objId, type: hasImage ? 'npc' : 'trigger',
          x: int(e.x, 0), y: int(e.y, 0), note: e.note ? String(e.note) : '', pages });
      }

      result.maps[mapId] = {
        id: mapId, name: (infoById[m.id] && infoById[m.id].name) || mapId,
        width: w, height: h, kind: mapKind,
        music: noteAudio('music', src.autoplayBgm ? src.bgm : null),
        note: src.note ? String(src.note) : '',
        layers, collision: new Array(n).fill(null), objects,
        props: { mvMapId: m.id, mvTilesetId: tilesetId, mvDisplayName: src.displayName || '' },
      };
      result.stats.maps++;
    }

    // ---- common events ----------------------------------------------------
    for (const ce of commonEvents) {
      if (!isObj(ce)) continue;
      const id = scriptIdFor[int(ce.id, 0)];
      const trigger = int(ce.trigger, 0);
      const where = { script: id };
      const cmdCtx = makeCommandCtx({
        names, prefix, problems: P, where, vars: result.vars,
        items: itemIds, weapons: weaponIds, armors: armorIds,
        maps: mapIdFor, scripts: scriptIdFor, events: {},
        actors: actorsData, faces: faceIds, sprites: spriteIds,
        stats: result.stats.commands,
      });
      const translated = RM.commands(ce.list || [], cmdCtx);
      let when = null;
      if (trigger !== 0) { const name = declareSwitch(int(ce.switchId, 1)); when = { kind: 'var', name, op: '==', value: true }; }
      result.scripts[id] = {
        label: ce.name ? String(ce.name) : id,
        trigger: trigger === 1 ? 'auto' : trigger === 2 ? 'parallel' : 'call',
        when, params: [], body: translated.commands, note: '',
      };
      if (trigger === 2 && translated.commands.some(cm => cm && (cm.t === 'say' || cm.t === 'choice'))) {
        P.warn('parallel-message', `common event '${id}' is Parallel and shows a message; Kit forbids that on a background thread`, where);
      }
    }

    // ---- top-level project bits -------------------------------------------
    const startMap = mapIdFor[int(system.startMapId, 0)] || null;
    if (system.startMapId && !startMap) P.warn('unknown-map-target', `the starting map (${system.startMapId}) was not imported`, {});
    result.project = {
      meta: { title: system.gameTitle ? String(system.gameTitle) : 'Imported project' },
      start: { map: startMap, x: int(system.startX, 0), y: int(system.startY, 0), dir: 'down' },
      settings: o.tileSize ? { tileSize: int(o.tileSize, 48) } : {},
    };

    result.stats.tiles = result.tiles.length;
    result.stats.assets = Object.keys(result.assets).length;
    result.stats.sprites = result.sprites.length;
    result.stats.faces = result.faces.length;
    result.stats.scripts = Object.keys(result.scripts).length;
    result.stats.vars = Object.keys(result.vars).length;
    result.stats.items = Object.keys(result.items).length;
    for (const p of P.list) result.stats.problems[p.severity] = (result.stats.problems[p.severity] || 0) + 1;
    return result;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
