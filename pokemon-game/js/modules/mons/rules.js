// mons/rules.js — every rule the Pokémon side runs on, as pure functions.
//
// Nothing here touches the DOM, a registry entry's behaviour, or the world.
// Node can require this file directly (test/modules/mons.test.js does), so the
// scenes, the systems and the editor panel on top of it are a thin layer.
//
//   KIT.mons.rarity('pikachu')            -> 'rare'
//   KIT.mons.catchChance({ species:'pikachu', quality:'perfect', calm:2 })
//   KIT.mons.rollEncounter(table, 1, rng) -> 'pikachu' | null
//
// Every number in here has a content override (project.packs.mons), so the
// author can retune the whole game without opening a file.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const M = KIT.mons = KIT.mons || {};

  const clamp = KIT.clamp;
  const num = KIT.num;
  const isObj = KIT.isObject;

  // ---- the species registry ------------------------------------------------
  // One entry per species: the data file (js/data/pokemon.js) is the source,
  // the registry is what the rest of the kit (ref:mon pickers, the editor) reads.
  KIT.defineRegistry('monSpecies', {
    fields: [
      { key: 'id', type: 'string', min: 1, pattern: '^[a-z0-9][a-z0-9-_.:]*$' },
      { key: 'name', type: 'string', optional: true },
      { key: 'dex', type: 'number', integer: true, default: 0 },
      { key: 'types', type: 'list', of: { type: 'string' }, default: [] },
      { key: 'color', type: 'color', default: '#8a8a9a' },
      { key: 'blurb', type: 'text', optional: true },
      { key: 'bst', type: 'number', integer: true, default: 0 },
      { key: 'rarity', type: 'string', optional: true },
      { key: 'group', type: 'string', optional: true },
    ],
    doc: 'Pokémon species: { id, name, dex, types, base:{hp..}, color, blurb, bst, rarity }.',
  });
  const SPECIES = () => KIT.registry('monSpecies');

  M.PARTY_MAX = 6;
  M.RARITIES = ['common', 'uncommon', 'rare', 'special', 'legendary'];
  /** Base-stat-total cut-offs; the first bucket a total fits into wins. */
  M.RARITY_BANDS = [
    { id: 'common', below: 400 },
    { id: 'uncommon', below: 470 },
    { id: 'rare', below: 520 },
    { id: 'special', below: 570 },
    { id: 'legendary', below: Infinity },
  ];

  /** bst(species|baseStats) -> the base-stat total (0 when there are none). */
  M.bst = function (src) {
    const base = (src && src.base) || src || {};
    let n = 0;
    for (const k of ['hp', 'atk', 'def', 'spa', 'spd', 'spe']) n += num(base[k], 0);
    return Math.round(n);
  };

  /** rarityForBst(total) -> a rarity id. */
  M.rarityForBst = function (total) {
    const n = num(total, 0);
    for (const band of M.RARITY_BANDS) if (n < band.below) return band.id;
    return M.RARITIES[M.RARITIES.length - 1];
  };

  /**
   * registerSpecies(list) — `list` is PKMN.POKEMON (or any { id, name, dex,
   * types, base, color, blurb } table). Missing art is not an error: the icon
   * falls back to a silhouette in the species colour.
   */
  M.registerSpecies = function (list) {
    const table = Array.isArray(list) ? list : Object.values(list || {});
    const reg = SPECIES();
    const out = [];
    for (const raw of table) {
      if (!raw || !raw.id) continue;
      const bst = M.bst(raw);
      const def = {
        id: raw.id,
        name: raw.name || raw.id,
        dex: num(raw.dex, 0),
        types: Array.isArray(raw.types) ? raw.types.slice() : [],
        base: isObj(raw.base) ? Object.assign({}, raw.base) : {},
        color: typeof raw.color === 'string' ? raw.color : '#8a8a9a',
        blurb: raw.blurb || '',
        height: num(raw.height, 0), weight: num(raw.weight, 0),
        moves: Array.isArray(raw.moves) ? raw.moves.slice() : [],
        bst,
        rarity: raw.rarity || M.rarityForBst(bst),
        group: raw.group || 'pokemon',
        replace: true,
      };
      reg.add(def);
      out.push(def);
    }
    return out;
  };

  /**
   * The shape of a species a person writes in Creator Mode. The built-in roster
   * (js/data/pokemon.js) has the same shape; a project's own entry with the same
   * id replaces it, which is how a fan game keeps the names and changes the stats.
   */
  M.SPECIES_FIELDS = [
    { key: 'id', type: 'string', display: 'readonly', doc: 'What scripts and encounter tables call it' },
    { key: 'name', type: 'string', default: '', shown: true, doc: 'What the game says' },
    { key: 'dex', type: 'number', integer: true, min: 0, max: 9999, default: 0, label: 'Dex number' },
    { key: 'types', type: 'list', of: { type: 'string' }, default: [], doc: 'grass, fire, water… your own words are fine' },
    { key: 'color', type: 'color', default: '#8a8a9a', label: 'Colour', doc: 'The silhouette, and the card, until there is art' },
    { key: 'sprite', type: 'ref:sprite', nullable: true, default: null, doc: 'Art of your own, imported or drawn' },
    { key: 'blurb', type: 'text', default: '', doc: 'The Pokédex line' },
    { key: 'height', type: 'number', min: 0, default: 0, doc: 'Metres' },
    { key: 'weight', type: 'number', min: 0, default: 0, doc: 'Kilograms' },
    { key: 'base', type: 'numbers', default: {}, label: 'Base stats', doc: 'hp atk def spa spd spe' },
    { key: 'moves', type: 'list', of: { type: 'string' }, default: [], doc: 'Up to four move ids' },
    { key: 'note', type: 'note' },
  ];
  M.STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  /** newSpecies(id, name) -> a filled species, ready to edit. */
  M.newSpecies = function (id, name) {
    const base = {};
    for (const k of M.STATS) base[k] = 50;
    return { id: KIT.slug(id || name || 'new-one'), name: name || 'New one', dex: 0, types: [], color: '#8a8a9a',
      sprite: null, blurb: '', height: 0, weight: 0, base, moves: [], note: '' };
  };
  /** projectSpecies(project) -> the project's own list (never the registry's). */
  M.projectSpecies = function (project) {
    const list = M.pack(project).species;
    return Array.isArray(list) ? list : [];
  };

  /** species(id) -> the registry entry, or null. Never throws on a bad id. */
  M.species = function (id) {
    if (!id) return null;
    try { return SPECIES().get(String(id)) || null; } catch (e) { return null; }
  };
  /** speciesList() -> every species, in Pokédex order. */
  M.speciesList = function () {
    try { return SPECIES().list().slice().sort((a, b) => (a.dex || 0) - (b.dex || 0)); } catch (e) { return []; }
  };
  M.speciesName = function (id) { const s = M.species(id); return s ? s.name : String(id || '?'); };
  M.speciesColor = function (id) { const s = M.species(id); return (s && s.color) || '#8a8a9a'; };

  /**
   * rarity(speciesId, project) -> rarity id.
   * The project may override any species: packs.mons.rarity = { pikachu:'common' }.
   */
  M.rarity = function (id, project) {
    const over = M.pack(project).rarity;
    const key = typeof id === 'string' ? id : (id && id.id);
    if (over && typeof over[key] === 'string' && M.RARITIES.indexOf(over[key]) >= 0) return over[key];
    const s = typeof id === 'string' ? M.species(id) : id;
    if (s && s.rarity) return s.rarity;
    return 'common';
  };

  // ---- content: project.packs.mons ------------------------------------------
  /** The content defaults. Everything the module reads has a value here. */
  M.contentDefaults = function () {
    return {
      ball: 'pokeball',
      berry: 'berry',
      goldenBerry: 'golden-berry',
      berries: ['berry'],
      difficulty: 'normal',
      followers: true,
      shinyChance: 0.012,
      stepsPerFriendship: 128,
      awayBonus: 4,
      awayHours: 20,
      petBonus: 3,
      berryBonus: 10,
      favouriteBerryBonus: 5,
      followStepBonus: 1,
      species: [],             // the game's own roster, on top of the built-in one
      rarity: {},
      encounters: {},
      starters: null,          // { var:'starter', friendship:70, ask:true }
      defaultProfile: 'friendly',
      profiles: [],
      garden: null,            // { map:'garden' } — maps of kind 'garden' are found anyway
    };
  };

  /** pack(project) -> packs.mons with every default filled in (never mutates the project). */
  M.pack = function (project) {
    if (KIT.modules && KIT.modules.get && KIT.modules.get('mons')) {
      const p = KIT.modules.pack(project, 'mons');
      if (p) return p;
    }
    const raw = (project && project.packs && isObj(project.packs.mons)) ? project.packs.mons : {};
    return Object.assign(M.contentDefaults(), raw);
  };

  // ---- the catch profile -----------------------------------------------------
  // The whole catch scene is driven by this, so re-theming it is content work.
  M.DEFAULT_PROFILE = {
    id: 'friendly',
    label: 'Making friends',
    actions: [
      { id: 'throw', label: 'mons-act-throw', kind: 'throw', item: 'pokeball', effects: {} },
      { id: 'berry', label: 'mons-act-berry', kind: 'offer', item: 'berry', effects: { calm: 1, band: 0.05, chance: 0.12 } },
      { id: 'golden', label: 'mons-act-golden', kind: 'offer', item: 'golden-berry', effects: { guarantee: true, calm: 1 } },
      { id: 'talk', label: 'mons-act-talk', kind: 'talk', effects: { curious: 0.34 } },
      { id: 'leave', label: 'mons-act-leave', kind: 'leave', effects: {} },
    ],
    strings: {
      appeared: 'mons-appeared', appearedNew: 'mons-appeared-new', gotcha: 'mons-gotcha', broke: 'mons-broke', fled: 'mons-fled',
      ranAway: 'mons-ran', noBalls: 'mons-no-balls', noItem: 'mons-no-item', calmed: 'mons-calmed',
      golden: 'mons-golden', talk: 'mons-talk', curious: 'mons-curious', nickname: 'mons-nickname',
      perfect: 'mons-perfect', great: 'mons-great', ok: 'mons-ok', miss: 'mons-miss', wobble: 'mons-wobble',
    },
    art: {
      ring: { center: 0.34, width: 0.16, speed: 0.62, calmWidth: 0.05 },
      wobbleMs: 460, throwMs: 520, bobMs: 1400, scale: 4,
    },
    rules: { fleeAfter: 3, fleeChance: 0.45, curiousBonus: 0.08, calmBonus: 0.12, maxCalm: 3 },
  };

  /** profile(project, id) -> a profile with the default filled in behind it. */
  M.profile = function (project, id) {
    const pack = M.pack(project);
    const list = Array.isArray(pack.profiles) ? pack.profiles : [];
    const want = id || pack.defaultProfile || M.DEFAULT_PROFILE.id;
    const found = list.find(p => p && p.id === want) || list[0] || null;
    const base = M.DEFAULT_PROFILE;
    if (!found) return KIT.deepClone(base);
    const out = Object.assign({}, base, found);
    out.actions = Array.isArray(found.actions) && found.actions.length ? found.actions : base.actions;
    out.strings = Object.assign({}, base.strings, found.strings || {});
    out.art = Object.assign({}, base.art, found.art || {});
    out.art.ring = Object.assign({}, base.art.ring, (found.art && found.art.ring) || {});
    out.rules = Object.assign({}, base.rules, found.rules || {});
    return out;
  };

  /**
   * line(project, profile, key, vars) -> the text to show.
   * A profile's string value is a Terms id when one is registered (so the words
   * live in the Terms panel), and literal text otherwise.
   */
  M.line = function (project, profile, key, vars) {
    const raw = profile && profile.strings ? profile.strings[key] : null;
    const id = typeof raw === 'string' && raw ? raw : ('mons-' + key);
    const registered = KIT.registry.exists('strings') && KIT.registry('strings').has(id);
    const overridden = !!(project && project.strings && typeof project.strings[id] === 'string');
    if (registered || overridden) return KIT.strings.get(project, id, vars);
    return String(raw == null ? id : raw).replace(/\{([a-zA-Z_][\w-]*)\}/g, (m, name) =>
      (vars && Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m));
  };

  // ---- a caught mon -----------------------------------------------------------
  M.MOODS = [
    { id: 'happy', label: 'mons-mood-happy' },
    { id: 'sleepy', label: 'mons-mood-sleepy' },
    { id: 'curious', label: 'mons-mood-curious' },
    { id: 'playful', label: 'mons-mood-playful' },
    { id: 'hungry', label: 'mons-mood-hungry' },
    { id: 'shy', label: 'mons-mood-shy' },
    { id: 'proud', label: 'mons-mood-proud' },
    { id: 'calm', label: 'mons-mood-calm' },
  ];
  M.mood = function (id) { return M.MOODS.find(m => m.id === id) || M.MOODS[0]; };

  M.TIERS = [
    { id: 'new', label: 'mons-tier-new', min: 0 },
    { id: 'warm', label: 'mons-tier-warm', min: 50 },
    { id: 'close', label: 'mons-tier-close', min: 100 },
    { id: 'dear', label: 'mons-tier-dear', min: 150 },
    { id: 'devoted', label: 'mons-tier-devoted', min: 200 },
    { id: 'bonded', label: 'mons-tier-bonded', min: 255 },
  ];
  M.FRIENDSHIP_MAX = 255;

  /** friendshipTier(n) -> { index, id, label, hearts, next } — hearts is 0..5 of 5. */
  M.friendshipTier = function (n) {
    const v = clamp(Math.round(num(n, 0)), 0, M.FRIENDSHIP_MAX);
    let i = 0;
    for (let k = 0; k < M.TIERS.length; k++) if (v >= M.TIERS[k].min) i = k;
    const t = M.TIERS[i];
    return { index: i, id: t.id, label: t.label, hearts: i, of: M.TIERS.length - 1, next: M.TIERS[i + 1] ? M.TIERS[i + 1].min : null };
  };

  /** addFriendship(mon, delta) -> the new value, clamped to 0..255. Mutates the mon. */
  M.addFriendship = function (mon, delta) {
    if (!mon) return 0;
    mon.friendship = clamp(Math.round(num(mon.friendship, 0) + num(delta, 0)), 0, M.FRIENDSHIP_MAX);
    return mon.friendship;
  };
  /** setFriendship(mon, value) -> the new value, clamped. */
  M.setFriendship = function (mon, value) {
    if (!mon) return 0;
    mon.friendship = clamp(Math.round(num(value, 0)), 0, M.FRIENDSHIP_MAX);
    return mon.friendship;
  };

  let seq = 0;
  /**
   * create({ id, nickname, friendship, shiny, map, mapName, date, by, rng, uid, project })
   * -> { uid, id, nickname, friendship, mood, shiny, caughtAt:{map,date,by}, metAt, favouriteBerry }
   */
  M.create = function (opts) {
    const o = opts || {};
    const rng = typeof o.rng === 'function' ? o.rng : null;
    const pick = () => (rng ? rng() : Math.random());
    const uid = o.uid || ('mon-' + (++seq).toString(36) + '-' + Math.floor(pick() * 0xffffff).toString(36));
    const pack = M.pack(o.project);
    const berries = (Array.isArray(pack.berries) && pack.berries.length) ? pack.berries : [pack.berry];
    const mon = {
      uid,
      id: String(o.id || ''),
      nickname: o.nickname == null ? '' : String(o.nickname),
      friendship: clamp(Math.round(num(o.friendship, 0)), 0, M.FRIENDSHIP_MAX),
      mood: o.mood || 'curious',
      shiny: o.shiny == null ? (rng ? pick() < num(pack.shinyChance, 0.012) : false) : !!o.shiny,
      caughtAt: { map: o.map == null ? null : String(o.map), date: o.date || new Date().toISOString(), by: o.by == null ? null : String(o.by) },
      metAt: o.metAt == null ? (o.mapName == null ? (o.map == null ? '' : String(o.map)) : String(o.mapName)) : String(o.metAt),
      favouriteBerry: o.favouriteBerry || berries[KIT.hash(uid, 'berry') % berries.length] || null,
    };
    mon.mood = (o.mood || M.moodFor(mon, { day: 0, derived: true }).id);
    return mon;
  };

  /** displayName(mon, project) -> the nickname, or the species name. */
  M.displayName = function (mon, project) {
    if (!mon) return '';
    if (mon.nickname) return mon.nickname;
    const s = M.species(mon.id);
    return s ? s.name : String(mon.id || '?');
  };

  /**
   * moodFor(mon, { day, salt }) -> { id, label }.
   * Deterministic: the same mon on the same day is in the same mood, so it reads
   * as a personality and not as noise. Shy while you are strangers, bright once
   * you are not.
   */
  /**
   * provideMood(fn) — another module may own how a friend is feeling (the home
   * module keeps a mood that drifts and reacts to what you do). It hands us
   * `fn(mon, { project, save, day }) -> { id, label } | null`, where `label` is
   * already the words to show. Nothing here knows who that module is, and with
   * nobody offering, the derived mood below is the answer.
   */
  M.moodProvider = null;
  M.provideMood = function (fn) { M.moodProvider = typeof fn === 'function' ? fn : null; };

  M.moodFor = function (mon, opts) {
    const o = opts || {};
    if (M.moodProvider && !o.derived) {
      try {
        const given = M.moodProvider(mon, o);
        if (given && given.id) return { id: given.id, label: given.label || given.id, given: true };
      } catch (e) { (KIT.log || console).error('[mons] mood provider threw', e); }
    }
    const tier = M.friendshipTier(mon && mon.friendship);
    let pool;
    if (o.pool && o.pool.length) pool = o.pool.slice();
    else if (tier.index === 0) pool = ['shy', 'curious', 'sleepy'];
    else if (tier.index >= 4) pool = ['happy', 'playful', 'proud', 'calm'];
    else pool = M.MOODS.map(m => m.id);
    const h = KIT.hash(String((mon && mon.uid) || ''), String(num(o.day, 0)), String(o.salt || ''));
    return M.mood(pool[h % pool.length]);
  };

  // ---- catching ----------------------------------------------------------------
  M.BASE_CHANCE = { common: 0.66, uncommon: 0.52, rare: 0.38, special: 0.26, legendary: 0.14 };
  M.QUALITY = { perfect: 1.6, great: 1.25, ok: 1, miss: 0.25 };
  M.DIFFICULTY = { gentle: 1.35, normal: 1, hard: 0.7 };
  M.CHANCE_MIN = 0.02;
  M.CHANCE_MAX = 0.98;

  /** ringBand(profileArt, calm) -> { center, width, speed } — berries widen the green band. */
  M.ringBand = function (art, calm) {
    const r = Object.assign({}, M.DEFAULT_PROFILE.art.ring, (art && art.ring) || art || {});
    const grow = num(r.calmWidth, 0.05) * clamp(num(calm, 0), 0, 6);
    return { center: clamp(num(r.center, 0.34), 0.05, 0.95), width: clamp(num(r.width, 0.16) + grow, 0.02, 0.9), speed: num(r.speed, 0.62) };
  };

  /**
   * ringQuality(position, band) -> 'perfect' | 'great' | 'ok' | 'miss'
   * `position` is where the shrinking ring was when you tapped (1 = wide open, 0 = closed).
   */
  M.ringQuality = function (position, band) {
    const b = band && band.width != null ? band : M.ringBand(band);
    const d = Math.abs(num(position, 1) - b.center);
    if (d <= b.width * 0.25) return 'perfect';
    if (d <= b.width * 0.6) return 'great';
    if (d <= b.width) return 'ok';
    return 'miss';
  };

  /**
   * catchChance({ species|rarity, quality, calm, curious, golden, ballPower,
   *               difficulty, project, ...tuning }) -> 0..1
   * A golden berry guarantees the next throw (1). Everything else is clamped
   * into CHANCE_MIN..CHANCE_MAX so nothing is ever hopeless or certain.
   */
  M.catchChance = function (opts) {
    const o = opts || {};
    if (o.golden) return 1;
    const pack = M.pack(o.project);
    const rarity = o.rarity || M.rarity(o.species, o.project);
    const base = num((o.baseChance || M.BASE_CHANCE)[rarity], 0.4);
    const qual = num((o.qualityMul || M.QUALITY)[o.quality == null ? 'ok' : o.quality], 1);
    const diff = num((o.difficultyMul || M.DIFFICULTY)[o.difficulty || pack.difficulty || 'normal'], 1);
    const ball = num(o.ballPower, 1);
    const maxCalm = num(o.maxCalm, 3);
    const calm = clamp(num(o.calm, 0), 0, maxCalm);
    let c = base * qual * diff * ball;
    c += calm * num(o.calmBonus, 0.12);
    if (o.curious) c += num(o.curiousBonus, 0.08);
    return clamp(c, num(o.min, M.CHANCE_MIN), num(o.max, M.CHANCE_MAX));
  };

  /**
   * resolveThrow(opts, rng) -> { caught, chance, roll, wobbles }
   * Caught is three wobbles and a click; a near miss wobbles twice, a clear miss once.
   */
  M.resolveThrow = function (opts, rng) {
    const o = opts || {};
    const chance = o.chance == null ? M.catchChance(o) : clamp(num(o.chance, 0), 0, 1);
    const roll = o.roll == null ? (typeof rng === 'function' ? rng() : 0) : clamp(num(o.roll, 0), 0, 1);
    const caught = roll < chance;
    const ratio = chance > 0 ? roll / chance : Infinity;
    return { caught, chance, roll, wobbles: caught ? 3 : (ratio < 1.6 ? 2 : 1) };
  };

  /** shouldFlee({ fails, fleeAfter, fleeChance, roll }, rng) -> bool. */
  M.shouldFlee = function (opts, rng) {
    const o = opts || {};
    const after = num(o.fleeAfter, 3);
    if (num(o.fails, 0) < after) return false;
    const roll = o.roll == null ? (typeof rng === 'function' ? rng() : 0) : num(o.roll, 0);
    return roll < num(o.fleeChance, 0.45);
  };

  /**
   * newCatchState({ species, profile, project, difficulty }) — the whole catch
   * scene's state, so the scene is a renderer over it and the test drives it
   * headlessly.
   */
  M.newCatchState = function (opts) {
    const o = opts || {};
    const profile = o.profile || M.profile(o.project);
    return {
      species: String(o.species || ''),
      shiny: !!o.shiny,
      profile,
      project: o.project || null,
      rarity: o.rarity || M.rarity(o.species, o.project),
      difficulty: o.difficulty || M.pack(o.project).difficulty,
      calm: 0, curious: false, guarantee: false,
      fails: 0, throws: 0, talks: 0,
      done: null,               // 'caught' | 'fled' | 'left' | 'out-of-balls'
      lastQuality: null, lastWobbles: 0, lastChance: 0,
    };
  };

  /**
   * applyAction(state, action, { rng, balls, items }) -> { state, event }
   * The one place the catch scene's rules live. `event` is what the scene shows:
   *   { kind:'throw', caught, wobbles, quality, chance }
   *   { kind:'calm', guarantee } | { kind:'talk', curious } | { kind:'leave' }
   *   { kind:'blocked', reason:'no-balls'|'no-item', item }
   */
  M.applyAction = function (state, action, opts) {
    const s = state;
    const o = opts || {};
    const rng = typeof o.rng === 'function' ? o.rng : null;
    const roll = () => (rng ? rng() : 0);
    const act = action || {};
    const fx = act.effects || {};
    const rules = (s.profile && s.profile.rules) || M.DEFAULT_PROFILE.rules;
    const have = (id) => (id ? num((o.items || {})[id], 0) : Infinity);

    if (act.kind === 'leave') { s.done = 'left'; return { kind: 'leave' }; }

    if (act.kind === 'offer') {
      if (have(act.item) < 1) return { kind: 'blocked', reason: 'no-item', item: act.item };
      if (fx.guarantee) { s.guarantee = true; s.calm = clamp(s.calm + num(fx.calm, 0), 0, num(rules.maxCalm, 3)); return { kind: 'calm', guarantee: true, item: act.item }; }
      s.calm = clamp(s.calm + num(fx.calm, 1), 0, num(rules.maxCalm, 3));
      return { kind: 'calm', guarantee: false, item: act.item };
    }

    if (act.kind === 'talk') {
      s.talks++;
      const p = num(fx.curious, 0.34);
      const became = !s.curious && roll() < p;
      if (became) s.curious = true;
      return { kind: 'talk', curious: s.curious, became };
    }

    if (act.kind === 'wait') { s.calm = clamp(s.calm + num(fx.calm, 1), 0, num(rules.maxCalm, 3)); return { kind: 'calm', guarantee: false, item: null }; }

    if (act.kind === 'throw') {
      if (have(act.item) < 1) return { kind: 'blocked', reason: 'no-balls', item: act.item };
      const quality = o.quality || 'ok';
      const golden = s.guarantee;
      const chance = M.catchChance({
        species: s.species, rarity: s.rarity, project: s.project, quality, calm: s.calm,
        curious: s.curious, golden, difficulty: s.difficulty,
        ballPower: num(act.power, 1), calmBonus: num(rules.calmBonus, 0.12),
        curiousBonus: num(rules.curiousBonus, 0.08), maxCalm: num(rules.maxCalm, 3),
      });
      const r = M.resolveThrow({ chance }, rng);
      s.throws++;
      s.guarantee = false;
      s.lastQuality = quality; s.lastWobbles = r.wobbles; s.lastChance = chance;
      if (r.caught) { s.done = 'caught'; return { kind: 'throw', caught: true, wobbles: r.wobbles, quality, chance }; }
      s.fails++;
      const fled = M.shouldFlee({ fails: s.fails, fleeAfter: num(rules.fleeAfter, 3), fleeChance: num(rules.fleeChance, 0.45) }, rng);
      if (fled) s.done = 'fled';
      return { kind: 'throw', caught: false, wobbles: r.wobbles, quality, chance, fled };
    }

    return { kind: 'none' };
  };

  // ---- encounters ----------------------------------------------------------------
  /**
   * encounterTable(map, project) -> { byRegion:{ '1':[{id,weight}] }, rate } | null
   * Authored on the map (map.props.encounters); packs.mons.encounters[mapId] is
   * the older place the v2 project migration writes to, and still works.
   */
  M.encounterTable = function (map, project) {
    const raw = map && (map.map || map);
    const mapId = raw && raw.id;
    let t = raw && isObj(raw.props) ? raw.props.encounters : null;
    if (!isObj(t)) {
      const packTables = M.pack(project).encounters;
      t = isObj(packTables) ? packTables[mapId] : null;
    }
    if (!isObj(t)) return null;
    const byRegion = {};
    if (isObj(t.byRegion)) {
      for (const key of Object.keys(t.byRegion)) {
        const list = Array.isArray(t.byRegion[key]) ? t.byRegion[key] : [];
        byRegion[String(key)] = list
          .filter(e => e && e.id)
          .map(e => ({ id: String(e.id), weight: Math.max(0, num(e.weight, 1)), shiny: e.shiny == null ? null : !!e.shiny }));
      }
    } else if (Array.isArray(t.table)) {          // the flat v2 shape: one table for the whole map
      byRegion['0'] = t.table.filter(e => e && (e.id || e.mon)).map(e => ({ id: String(e.id || e.mon), weight: Math.max(0, num(e.weight, 1)), shiny: null }));
    }
    return { byRegion, rate: clamp(num(t.rate, 12), 0, 100) };
  };

  /** entriesFor(table, region) -> the weighted list for a region (falling back to region 0 / '*'). */
  M.entriesFor = function (table, region) {
    if (!table || !table.byRegion) return [];
    const by = table.byRegion;
    const keys = [String(region == null ? 0 : region), '*', '0'];
    for (const k of keys) if (Array.isArray(by[k]) && by[k].length) return by[k];
    return [];
  };

  /**
   * rollEncounter(table, region, rng) -> { id, shiny } | null
   * Two rolls: does anything happen (rate out of 100), and which one. Same seed,
   * same walk, same friends — so a bug is reproducible.
   */
  M.rollEncounter = function (table, region, rng) {
    const r = typeof rng === 'function' ? rng : () => 0;
    if (!table) return null;
    const entries = M.entriesFor(table, region);
    if (!entries.length) return null;
    if (r() * 100 >= num(table.rate, 12)) return null;
    return M.pickWeighted(entries, r());
  };

  /** pickWeighted(entries, roll) -> the entry a 0..1 roll lands on (pure; no rng). */
  M.pickWeighted = function (entries, roll) {
    const list = (entries || []).filter(e => e && e.id && num(e.weight, 1) > 0);
    if (!list.length) return null;
    let total = 0;
    for (const e of list) total += num(e.weight, 1);
    let x = clamp(num(roll, 0), 0, 0.9999999) * total;
    for (const e of list) { x -= num(e.weight, 1); if (x < 0) return { id: e.id, shiny: e.shiny }; }
    const last = list[list.length - 1];
    return { id: last.id, shiny: last.shiny };
  };

  // ---- the save section ----------------------------------------------------------
  M.SAVE_VERSION = 2;
  M.saveDefaults = function () {
    return { version: M.SAVE_VERSION, party: [], box: [], dex: { seen: {}, caught: {} }, follower: null, steps: 0, lastSeenAt: null, petted: [] };
  };

  /**
   * repair(data) -> the same object, with its shape put right.
   *
   * In place, deliberately: everything that holds a section holds this object,
   * and reading twice has to give the same one back. A section that is the wrong
   * version is not this function's business — the migrate chain does that, and
   * the engine runs it first.
   */
  M.repair = function (data) {
    if (!isObj(data)) return M.migrateSave(data);
    if (num(data.version, 0) !== M.SAVE_VERSION) return M.migrateSave(data);
    data.party = (Array.isArray(data.party) ? data.party : []).map(fillMon).filter(Boolean);
    data.box = (Array.isArray(data.box) ? data.box : []).map(fillMon).filter(Boolean);
    if (!isObj(data.dex)) data.dex = { seen: {}, caught: {} };
    if (!isObj(data.dex.seen)) data.dex.seen = {};
    if (!isObj(data.dex.caught)) data.dex.caught = {};
    if (typeof data.follower !== 'string') data.follower = null;
    data.steps = num(data.steps, 0);
    if (!Array.isArray(data.petted)) data.petted = [];
    if (data.lastSeenAt === undefined) data.lastSeenAt = null;
    // The party cannot be longer than the party: the rest wait in the garden.
    if (data.party.length > M.PARTY_MAX) data.box = data.party.splice(M.PARTY_MAX).concat(data.box);
    return data;
  };

  /**
   * migrateSave(data) -> the current shape.
   * v1 (the flat Pokémon game before the kit): { pokemon:[{species,name,friendship}],
   * dex:['pikachu'], follower:<index> }. Old saves must keep loading.
   */
  M.migrateSave = function (data) {
    const out = M.saveDefaults();
    if (!isObj(data)) return out;
    const version = num(data.version, isObj(data) && Array.isArray(data.party) ? M.SAVE_VERSION : 1);
    if (version >= M.SAVE_VERSION) {
      out.version = M.SAVE_VERSION;
      out.party = (Array.isArray(data.party) ? data.party : []).map(fillMon).filter(Boolean);
      out.box = (Array.isArray(data.box) ? data.box : []).map(fillMon).filter(Boolean);
      out.dex = { seen: isObj(data.dex && data.dex.seen) ? Object.assign({}, data.dex.seen) : {}, caught: isObj(data.dex && data.dex.caught) ? Object.assign({}, data.dex.caught) : {} };
      out.follower = typeof data.follower === 'string' ? data.follower : null;
      out.steps = num(data.steps, 0);
      out.lastSeenAt = data.lastSeenAt || null;
      out.petted = Array.isArray(data.petted) ? data.petted.slice() : [];
    } else {
      const old = Array.isArray(data.pokemon) ? data.pokemon : (Array.isArray(data.party) ? data.party : []);
      old.forEach((p, i) => {
        if (!p) return;
        const mon = M.create({
          uid: p.uid || ('mon-old-' + i), id: p.id || p.species || '', nickname: p.nickname || p.name || '',
          friendship: num(p.friendship, 0), shiny: !!p.shiny, map: p.map || (p.caughtAt && p.caughtAt.map) || null,
          metAt: p.metAt || p.where || '', date: (p.caughtAt && p.caughtAt.date) || p.date || null, by: p.by || null,
        });
        if (out.party.length < M.PARTY_MAX) out.party.push(mon); else out.box.push(mon);
      });
      const seen = {};
      const caught = {};
      const dexOld = data.dex;
      if (Array.isArray(dexOld)) for (const id of dexOld) { seen[id] = true; }
      else if (isObj(dexOld)) for (const id of Object.keys(dexOld)) { if (dexOld[id]) seen[id] = true; }
      for (const mon of out.party.concat(out.box)) { seen[mon.id] = true; caught[mon.id] = { map: mon.caughtAt.map, date: mon.caughtAt.date, where: mon.metAt, count: (caught[mon.id] ? caught[mon.id].count : 0) + 1 }; }
      out.dex = { seen, caught };
      const f = data.follower;
      if (typeof f === 'number' && out.party[f]) out.follower = out.party[f].uid;
      else if (typeof f === 'string') out.follower = f;
    }
    if (out.follower && !out.party.some(m => m.uid === out.follower)) out.follower = null;
    return out;
  };

  function fillMon(p) {
    if (!isObj(p) || !p.uid) return null;
    return {
      uid: String(p.uid), id: String(p.id || ''), nickname: p.nickname == null ? '' : String(p.nickname),
      friendship: clamp(Math.round(num(p.friendship, 0)), 0, M.FRIENDSHIP_MAX),
      mood: p.mood || 'calm', shiny: !!p.shiny,
      caughtAt: isObj(p.caughtAt) ? { map: p.caughtAt.map == null ? null : String(p.caughtAt.map), date: p.caughtAt.date || null, by: p.caughtAt.by == null ? null : String(p.caughtAt.by) } : { map: null, date: null, by: null },
      metAt: p.metAt == null ? '' : String(p.metAt),
      favouriteBerry: p.favouriteBerry || null,
    };
  }
  M.fillMon = fillMon;

  /**
   * section(save) -> save.modules.mons, created and migrated on first touch.
   * Nothing else in the save belongs to this module.
   */
  M.section = function (save) {
    if (!isObj(save)) return M.saveDefaults();
    // The engine fills, migrates and repairs the section when the world is made
    // (see `save` in manifest.js). This reads it — and still does the whole job
    // for a bare save, because a module has to work without a world around it.
    if (KIT.modules && KIT.modules.get && KIT.modules.get('mons')) {
      const section = KIT.modules.saveSection(save, 'mons');
      if (section) return section;
    }
    save.modules = isObj(save.modules) ? save.modules : {};
    const cur = save.modules.mons;
    if (!isObj(cur) || num(cur.version, 0) !== M.SAVE_VERSION || !Array.isArray(cur.party)) {
      save.modules.mons = M.migrateSave(cur);
    }
    return save.modules.mons;
  };

  /** read(save) -> the section without writing to the save (conditions and panels). */
  M.read = function (save) {
    const cur = save && save.modules ? save.modules.mons : null;
    if (isObj(cur) && Array.isArray(cur.party) && num(cur.version, 0) === M.SAVE_VERSION) return cur;
    return M.migrateSave(cur);
  };

  // ---- party, box, dex --------------------------------------------------------------
  /** all(section) -> every mon you own, party first. */
  M.all = function (s) { return (s ? (s.party || []).concat(s.box || []) : []); };
  /** find(section, uid) -> the mon, or null. */
  M.find = function (s, uid) { return M.all(s).find(m => m && m.uid === uid) || null; };
  /** owns(section, speciesId) -> bool. */
  M.owns = function (s, id) { return M.all(s).some(m => m && m.id === id); };
  /** partyFull(section) -> bool. */
  M.partyFull = function (s) { return ((s && s.party) || []).length >= M.PARTY_MAX; };

  /** add(section, mon, { to }) -> 'party' | 'box'. A full party overflows to the garden. */
  M.add = function (s, mon, opts) {
    if (!s || !mon) return null;
    s.party = Array.isArray(s.party) ? s.party : [];
    s.box = Array.isArray(s.box) ? s.box : [];
    const to = (opts && opts.to) || 'auto';
    if (to !== 'box' && s.party.length < M.PARTY_MAX) { s.party.push(mon); return 'party'; }
    s.box.push(mon);
    return 'box';
  };

  /** move(section, uid, where) -> 'party'|'box'|null — take along / send to the garden. */
  M.move = function (s, uid, where) {
    if (!s) return null;
    const from = (s.party || []).findIndex(m => m.uid === uid) >= 0 ? 'party' : ((s.box || []).findIndex(m => m.uid === uid) >= 0 ? 'box' : null);
    if (!from || from === where) return from;
    const list = from === 'party' ? s.party : s.box;
    const i = list.findIndex(m => m.uid === uid);
    if (i < 0) return null;
    if (where === 'party' && M.partyFull(s)) return null;
    const [mon] = list.splice(i, 1);
    (where === 'party' ? s.party : s.box).push(mon);
    if (where === 'box' && s.follower === uid) s.follower = null;
    return where;
  };

  /** reorder(section, uid, delta) -> the new index in the party. */
  M.reorder = function (s, uid, delta) {
    const list = (s && s.party) || [];
    const i = list.findIndex(m => m.uid === uid);
    if (i < 0) return -1;
    const j = clamp(i + num(delta, 0), 0, list.length - 1);
    if (i === j) return i;
    const [mon] = list.splice(i, 1);
    list.splice(j, 0, mon);
    return j;
  };

  /** setFollower(section, uid|null) -> the follower uid. Only a party mon may follow. */
  M.setFollower = function (s, uid) {
    if (!s) return null;
    if (uid && (s.party || []).some(m => m.uid === uid)) s.follower = uid;
    else s.follower = null;
    return s.follower;
  };
  /** follower(section) -> the mon walking behind you, or the first party mon. */
  M.follower = function (s) {
    if (!s) return null;
    const party = s.party || [];
    if (s.follower) { const m = party.find(x => x.uid === s.follower); if (m) return m; }
    return party[0] || null;
  };

  /** see(section, speciesId) -> bool (true when it was new). */
  M.see = function (s, id) {
    if (!s || !id) return false;
    s.dex = isObj(s.dex) ? s.dex : { seen: {}, caught: {} };
    s.dex.seen = isObj(s.dex.seen) ? s.dex.seen : {};
    if (s.dex.seen[id]) return false;
    s.dex.seen[id] = true;
    return true;
  };
  /** caught(section, speciesId, { map, where, date }) -> the dex entry. */
  M.markCaught = function (s, id, at) {
    if (!s || !id) return null;
    M.see(s, id);
    s.dex.caught = isObj(s.dex.caught) ? s.dex.caught : {};
    const prev = s.dex.caught[id];
    const entry = {
      map: (at && at.map) || (prev && prev.map) || null,
      where: (at && at.where) || (prev && prev.where) || '',
      date: (at && at.date) || (prev && prev.date) || null,
      count: num(prev && prev.count, 0) + 1,
    };
    s.dex.caught[id] = entry;
    return entry;
  };
  /** isNew(section, speciesId) -> true when the dex has never seen it (the "new!" mark). */
  M.isNew = function (s, id) { return !(s && s.dex && s.dex.seen && s.dex.seen[id]); };

  /** dexCounts(section) -> { seen, caught, total }. */
  M.dexCounts = function (s) {
    const seen = (s && s.dex && s.dex.seen) || {};
    const caught = (s && s.dex && s.dex.caught) || {};
    return {
      seen: Object.keys(seen).filter(k => seen[k]).length,
      caught: Object.keys(caught).filter(k => caught[k]).length,
      total: M.speciesList().length,
    };
  };

  // ---- friendship over time -------------------------------------------------------
  /**
   * walkFriendship(section, steps, { per, bonus }) -> the mons that gained a point.
   * +1 per 128 steps walked while following.
   */
  M.walkFriendship = function (s, steps, opts) {
    if (!s) return [];
    const o = opts || {};
    const per = Math.max(1, num(o.per, 128));
    s.steps = num(s.steps, 0) + Math.max(0, num(steps, 0));
    const gained = [];
    while (s.steps >= per) {
      s.steps -= per;
      const mon = M.follower(s);
      if (mon) { M.addFriendship(mon, num(o.bonus, 1)); gained.push(mon); }
    }
    return gained;
  };

  /**
   * resumeBonus(section, elapsedMs, { hours, bonus }) -> the mons that gained.
   * Coming back after a real-world day away is worth a little something to
   * everyone you have ever befriended.
   */
  M.resumeBonus = function (s, elapsedMs, opts) {
    const o = opts || {};
    const hours = num(o.hours, 20);
    if (!s || num(elapsedMs, 0) < hours * 3600 * 1000) return [];
    const bonus = num(o.bonus, 4);
    const list = M.all(s);
    for (const mon of list) M.addFriendship(mon, bonus);
    return list;
  };

  /** pet(section, uid, { bonus }) -> the friendship gained (0 when already petted this visit). */
  M.pet = function (s, uid, opts) {
    if (!s) return 0;
    s.petted = Array.isArray(s.petted) ? s.petted : [];
    if (s.petted.indexOf(uid) >= 0) return 0;
    const mon = M.find(s, uid);
    if (!mon) return 0;
    const bonus = num(opts && opts.bonus, 3);
    const before = mon.friendship;
    M.addFriendship(mon, bonus);
    s.petted.push(uid);
    return mon.friendship - before;
  };
  /** newVisit(section) — forget who has been petted (called on every map entry). */
  M.newVisit = function (s) { if (s) s.petted = []; return s; };

  /** giveBerry(section, uid, { bonus, favourite, item }) -> friendship gained. */
  M.giveBerry = function (s, uid, opts) {
    const o = opts || {};
    const mon = M.find(s, uid);
    if (!mon) return 0;
    const before = mon.friendship;
    let bonus = num(o.bonus, 10);
    if (o.item && mon.favouriteBerry && o.item === mon.favouriteBerry) bonus += num(o.favourite, 5);
    M.addFriendship(mon, bonus);
    return mon.friendship - before;
  };

  // ---- the garden --------------------------------------------------------------------
  /**
   * gardenArea(map) -> null | { all:true } | { region:n } | { x0,y0,x1,y1 }
   * A map of kind 'garden' is all garden; any map may fence off a corner with
   * `props.garden = { region: 3 }` or `{ x0, y0, x1, y1 }`.
   */
  M.gardenArea = function (map) {
    const raw = map && (map.map || map);
    if (!raw) return null;
    const props = isObj(raw.props) ? raw.props : {};
    const g = props.garden;
    if (isObj(g)) {
      if (g.region != null) return { region: num(g.region, 0) };
      if (g.x0 != null) return { x0: num(g.x0, 0), y0: num(g.y0, 0), x1: num(g.x1, 0), y1: num(g.y1, 0) };
      if (g.all) return { all: true };
    }
    if ((map.kind || raw.kind) === 'garden') return { all: true };
    return null;
  };

  /** inGarden(area, view, x, y) -> bool. */
  M.inGarden = function (area, view, x, y) {
    if (!area) return false;
    if (area.all) return true;
    if (area.region != null) return view && view.region ? view.region(x, y) === area.region : false;
    return x >= area.x0 && x <= area.x1 && y >= area.y0 && y <= area.y1;
  };

  /**
   * gardenSpots(area, view, count, rng, near) -> [{x,y}] — where the mons stand.
   *
   * Deterministic for a seed, so the garden looks the same when you walk back
   * in. Spots are drawn from the cells nearest `near` (the door you came in by,
   * or the middle of the garden): a phone shows eight tiles across, and a friend
   * you have to go looking for reads as a friend who is not there.
   */
  M.gardenSpots = function (area, view, count, rng, near) {
    const r = typeof rng === 'function' ? rng : () => 0.5;
    const cells = [];
    const w = (view && view.width) || 0, h = (view && view.height) || 0;
    let sx = 0, sy = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!M.inGarden(area, view, x, y)) continue;
        if (view.flagsAt && view.flagsAt(x, y).solid) continue;
        if (view.collisionAt && view.collisionAt(x, y) === 1) continue;
        cells.push({ x, y });
        sx += x; sy += y;
      }
    }
    if (!cells.length) return [];
    const cx = near && near.x != null ? near.x : sx / cells.length;
    const cy = near && near.y != null ? near.y : sy / cells.length;
    cells.sort((a2, b2) => {
      const da = (a2.x - cx) * (a2.x - cx) + (a2.y - cy) * (a2.y - cy);
      const db = (b2.x - cx) * (b2.x - cx) + (b2.y - cy) * (b2.y - cy);
      return da - db || a2.y - b2.y || a2.x - b2.x;
    });
    const n = Math.max(1, Math.min(cells.length, Math.max(count * 3, 10)));
    const out = [];
    const used = new Set();
    for (let i = 0; i < count; i++) {
      let pick = -1;
      for (let tries = 0; tries < 24; tries++) {
        const k = Math.floor(r() * n) % n;
        if (!used.has(k)) { pick = k; break; }
      }
      if (pick < 0) { pick = cells.findIndex((c, k) => !used.has(k)); if (pick < 0) break; }
      used.add(pick);
      out.push(cells[pick]);
    }
    return out;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
