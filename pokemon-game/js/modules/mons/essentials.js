// mons/essentials — Pokémon Essentials PBS text files -> this module's content.
//
// It lives with the module, not with the engine's importers, because everything
// it reads is this module's: species and wild encounters. The engine learns the
// format through the `importers` registry (ADR-0005), which is also how the
// Import panel and tools/import.js find it.
//
// Essentials is the toolkit most Pokémon fan games are already built in, and the
// part of it that is plain text is its PBS folder. Two of those files are worth
// reading: the roster and the wild encounters. Neither needs Ruby, RGSS or a
// .rxdata reader — they are ini-ish text, and this parses both of the shapes
// Essentials has used.
//
// Pure: no fs, no DOM, no network.
//   pokemon(text, opts)     PBS/pokemon.txt   -> species (packs.mons.species)
//   encounters(text, opts)  PBS/encounters.txt -> per-map encounter tables
//   detect(text)            'pokemon' | 'encounters' | null
//
// The two shapes, both accepted:
//   v19 and earlier          v20 and later
//   [1]                      [BULBASAUR]
//   Name=Bulbasaur           Name = Bulbasaur
//   InternalName=BULBASAUR   Types = GRASS,POISON
//   Type1=GRASS              BaseStats = 45,49,49,65,65,45
//   Type2=POISON             Pokedex = A strange seed...
//   BaseStats=45,49,49,65,65,45
//
//   encounters.txt
//   v19:  [012]  /  Land,25  /  25,PIDGEY,2,4
//   v20:  [MAPID]  or  [MAPID,version]  /  Land,25  /      25,PIDGEY,2,4
//
// What is NOT read, and says so: moves (Essentials move ids are its own), evolution
// chains, abilities, items, and anything in a .rxdata. A fan game's maps come
// through Tiled or as pictures; this brings the creatures and where they live.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const M = KIT.mons = KIT.mons || {};
  const E = M.essentials = M.essentials || {};

  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : (d || 0));
  const int = (v, d) => Math.round(num(v, d));
  const titleCase = (s) => String(s || '').toLowerCase().replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const slug = (s) => (KIT.slug ? KIT.slug(String(s || '')) : String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  const withPrefix = (id, opts) => (opts && opts.prefix ? slug(opts.prefix) + ':' + id : id);
  // BaseStats is written in a different ORDER by the two generations of the format,
  // which is the one thing you cannot see by looking at the numbers:
  //   v19 and earlier  HP, Attack, Defense, Speed, SpAtk, SpDef
  //   v20 and later    HP, Attack, Defense, SpAtk, SpDef, Speed
  // Reading v20 with the v19 order gives a Bulbasaur that outruns a Jolteon.
  const STATS_V19 = ['hp', 'atk', 'def', 'spe', 'spa', 'spd'];
  const STATS_V20 = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

  // A colour per type, so an imported roster is not 800 grey silhouettes.
  const TYPE_COLOR = {
    normal: '#a8a878', fire: '#f08030', water: '#6890f0', electric: '#f8d030', grass: '#78c850', ice: '#98d8d8',
    fighting: '#c03028', poison: '#a040a0', ground: '#e0c068', flying: '#a890f0', psychic: '#f85888', bug: '#a8b820',
    rock: '#b8a038', ghost: '#705898', dragon: '#7038f8', dark: '#705848', steel: '#b8b8d0', fairy: '#ee99ac',
    qmarks: '#68a090', shadow: '#604e82',
  };

  function blank() {
    return { assets: {}, tiles: [], sprites: [], faces: [], icons: [], animations: [], maps: {}, objects: [],
      scripts: {}, vars: {}, items: {}, packs: { mons: { species: [], encounters: {} } }, project: null, problems: [], stats: {} };
  }
  const problem = (res, severity, code, message, where) => { res.problems.push({ severity, code, message, where: where || {} }); return res; };
  function once(seen, res, severity, code, key, message, where) {
    const k = code + '|' + key;
    if (seen.has(k)) return;
    seen.add(k);
    problem(res, severity, code, message, where);
  }

  /**
   * sections(text) -> [{ head, lines: [[key, value] | [null, rawLine]] }]
   * The shared shape of every PBS file: `[head]` then lines. Comments start with
   * `#`, and both `Key=Value` and `Key = Value` are the same line.
   */
  function sections(text) {
    const out = [];
    let cur = null;
    for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
      const line = raw.replace(/^﻿/, '');
      const body = line.replace(/\s+$/, '');
      if (!body.trim() || /^\s*#/.test(body)) continue;
      const head = /^\s*\[(.*)\]\s*$/.exec(body);
      if (head) { cur = { head: head[1].trim(), lines: [] }; out.push(cur); continue; }
      if (!cur) continue;                                  // matter before the first heading is not ours
      const kv = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(body);
      if (kv) cur.lines.push([kv[1], kv[2].trim()]);
      else cur.lines.push([null, body.trim()]);
    }
    return out;
  }
  const valueOf = (lines, ...keys) => {
    for (const key of keys) {
      for (const [k, v] of lines) if (k && k.toLowerCase() === key.toLowerCase()) return v;
    }
    return null;
  };
  const listOf = (v) => String(v == null ? '' : v).split(',').map(s => s.trim()).filter(Boolean);

  /** detect(text) -> which PBS file this is, or null. */
  E.detect = function (text) {
    const s = String(text == null ? '' : text);
    if (!/^\s*\[/m.test(s)) return null;
    if (/^\s*(InternalName|BaseStats|Type1|Types)\s*=/mi.test(s)) return 'pokemon';
    // encounters.txt has no Key=Value lines at all: headings, method names and rows
    if (/^\s*\[[^\]]+\]\s*$/m.test(s) && /^\s*(Land|Cave|Water|OldRod|GoodRod|SuperRod|RockSmash|HeadbuttLow|HeadbuttHigh|BugContest|LandDay|LandNight|LandMorning|Fishing)\b/mi.test(s)) return 'encounters';
    return null;
  };

  /**
   * pokemon(text, opts) -> Result with `species` filled in.
   * opts: { prefix, keepIds } — `keepIds` keeps Essentials' internal names as ids
   * (BULBASAUR -> bulbasaur is the default and is what a person types).
   */
  E.pokemon = function (text, opts) {
    const o = opts || {};
    const res = blank();
    const secs = sections(text);
    if (!secs.length) { problem(res, 'error', 'not-pbs', 'that file has no [sections] in it, so it is not a PBS file', {}); return res; }
    const seen = new Set();
    const ids = new Set();
    let unknownTypes = 0;
    // Which generation of the format this is: v19 heads its sections with the dex
    // number and carries InternalName; v20 heads them with the internal name.
    const v19 = secs.some(sec => /^\d+$/.test(sec.head)) || secs.some(sec => valueOf(sec.lines, 'InternalName'));
    const STATS = v19 ? STATS_V19 : STATS_V20;
    secs.forEach((sec, order) => {
      const lines = sec.lines;
      // v20: the heading IS the internal name. v19: the heading is a dex number.
      const headIsNumber = /^\d+$/.test(sec.head);
      const internal = valueOf(lines, 'InternalName') || (headIsNumber ? null : sec.head);
      const name = valueOf(lines, 'Name') || titleCase(internal || sec.head);
      if (!internal && !name) return;
      const id = withPrefix(slug(internal || name), o);
      if (ids.has(id)) { once(seen, res, 'warn', 'duplicate-id', id, `two entries are both called '${id}'; the later one was skipped`, {}); return; }
      ids.add(id);
      const types = (valueOf(lines, 'Types') ? listOf(valueOf(lines, 'Types')) : [valueOf(lines, 'Type1'), valueOf(lines, 'Type2')].filter(Boolean))
        .map(t => slug(t));
      for (const t of types) if (!TYPE_COLOR[t]) { unknownTypes++; once(seen, res, 'info', 'unknown-type', t, `'${t}' is not one of the types this engine knows a colour for — it is kept as a word`, {}); }
      const statList = listOf(valueOf(lines, 'BaseStats'));
      const base = {};
      if (statList.length >= 6) { STATS.forEach((k, i) => { base[k] = int(statList[i], 50); }); }
      else { for (const k of ['hp', 'atk', 'def', 'spa', 'spd', 'spe']) base[k] = 50; if (statList.length) once(seen, res, 'warn', 'bad-stats', id, `'${id}' has ${statList.length} base stats, not six; 50s were used`, {}); }
      // v20 has no dex number of its own: the file's order IS the order.
      const dexNum = headIsNumber ? int(sec.head, 0) : (int(valueOf(lines, 'Number'), 0) || order + 1);
      const color = TYPE_COLOR[types[0]] || '#8a8a9a';
      res.packs.mons.species.push({
        id, name: name || titleCase(internal), dex: dexNum, types, color, sprite: null,
        blurb: valueOf(lines, 'Pokedex', 'Dex', 'Description') || '',
        height: num(valueOf(lines, 'Height'), 0), weight: num(valueOf(lines, 'Weight'), 0),
        base, moves: [], note: `from Pokémon Essentials (${internal || sec.head})`,
      });
    });
    if (!res.packs.mons.species.length) problem(res, 'error', 'no-species', 'no species could be read out of that file', {});
    if (unknownTypes) problem(res, 'info', 'types-kept', `${unknownTypes} type name(s) this engine has no colour for were kept as written`, {});
    problem(res, 'info', 'moves-skipped', 'moves, abilities, items and evolutions were not read: Essentials names them in its own tables, and this engine befriends rather than battles', {});
    res.stats = { species: res.packs.mons.species.length, from: 'essentials', shape: v19 ? 'v19' : 'v20' };
    return res;
  };

  /**
   * encounters(text, opts) -> Result whose `encounters` is { mapKey: { rate, byRegion:{0:[{id,weight}]} } }.
   * Essentials keys its tables by RPG Maker map id; `opts.mapId(key)` turns one
   * into a map of yours when you have one, and otherwise the key is kept so the
   * table can be moved by hand.
   */
  E.encounters = function (text, opts) {
    const o = opts || {};
    const res = blank();
    const secs = sections(text);
    if (!secs.length) { problem(res, 'error', 'not-pbs', 'that file has no [sections] in it, so it is not a PBS file', {}); return res; }
    const seen = new Set();
    const METHODS = /^(Land|Cave|Water|OldRod|GoodRod|SuperRod|RockSmash|HeadbuttLow|HeadbuttHigh|BugContest|LandDay|LandNight|LandMorning|LandAfternoon|LandEvening|Fishing)([A-Za-z]*)$/i;
    let rows = 0, methodsSkipped = 0;
    for (const sec of secs) {
      const key = sec.head.split(',')[0].trim();            // v20 allows [MAPID,version]
      const mapId = (typeof o.mapId === 'function' && o.mapId(key)) || null;
      const table = { rate: 0, byRegion: { 0: [] } };
      let method = null, rate = 0, lands = 0;
      for (const [k, v] of sec.lines) {
        const line = k ? `${k}${v ? ',' + v : ''}` : v;     // a method line may parse as Key=Value ("Land = 25")
        const parts = String(line).split(',').map(s => s.trim()).filter(s => s !== '');
        const m = METHODS.exec(parts[0] || '');
        if (m) {
          method = parts[0];
          const isLand = /^land/i.test(method) || /^cave$/i.test(method) || /^bugcontest$/i.test(method);
          if (parts[1] != null && isLand) { rate = Math.max(rate, int(parts[1], 0)); }
          if (!isLand) { methodsSkipped++; once(seen, res, 'info', 'method-skipped', method, `'${method}' encounters are not a thing in this engine yet — that block was left out`, { map: key }); }
          continue;
        }
        if (!method) continue;
        // a row: weight, SPECIES, minLevel[, maxLevel]
        const isLand = /^land/i.test(method) || /^cave$/i.test(method) || /^bugcontest$/i.test(method);
        if (!isLand) continue;
        const weight = int(parts[0], 0);
        const speciesName = parts[1];
        if (!speciesName || !weight) continue;
        const id = withPrefix(slug(speciesName), o);
        const at = table.byRegion[0].find(e => e.id === id);
        if (at) at.weight += weight; else table.byRegion[0].push({ id, weight });
        rows++; lands++;
      }
      if (!lands) continue;
      // Essentials' number is "chance in 100 of a step being an encounter" for the
      // whole block; this engine's rate is the same thing, so it carries over.
      table.rate = rate || 21;
      res.packs.mons.encounters[mapId || key] = table;
      if (!mapId) once(seen, res, 'warn', 'map-unresolved', key, `map '${key}' is an RPG Maker map id; the table was kept under that name so you can move it onto one of your maps`, { map: key });
    }
    if (!Object.keys(res.packs.mons.encounters).length) problem(res, 'error', 'no-encounters', 'no land or cave encounter tables could be read out of that file', {});
    res.stats = { tables: Object.keys(res.packs.mons.encounters).length, rows, methodsSkipped, from: 'essentials' };
    return res;
  };

  /**
   * The engine asks this registry before its own guesses, so dropping a PBS file
   * on Creator Mode's Import panel works without the engine knowing what PBS is.
   */
  E.register = function () {
    if (!KIT.registry || !KIT.registry.exists || !KIT.registry.exists('importers')) return;
    KIT.registry('importers').add({
      id: 'essentials', label: 'Pokémon Essentials PBS', order: 20, replace: true,
      detect(files) {
        for (const f of (files || [])) {
          if (f.text == null) continue;
          let kind = null;
          try { kind = E.detect(f.text); } catch (e) { kind = null; }
          if (kind) return { kind, main: f, label: `Pokémon Essentials ${kind === 'pokemon' ? 'roster' : 'encounters'} (${String(f.name).split(/[\\/]/).pop()})` };
        }
        return null;
      },
      run(found, opts) {
        return found.kind === 'pokemon' ? E.pokemon(found.main.text, opts) : E.encounters(found.main.text, opts);
      },
    });
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
