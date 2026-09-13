// Data-file tests (contract: docs/ARCHITECTURE.md §1-3). Run: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const T = require(path.join(__dirname, '..', 'js', 'data', 'types.js'));
const M = require(path.join(__dirname, '..', 'js', 'data', 'moves.js'));
const P = require(path.join(__dirname, '..', 'js', 'data', 'pokemon.js'));

const ROSTER_ORDER = [
  'venusaur', 'charizard', 'blastoise', 'pikachu', 'butterfree', 'ninetales', 'wigglytuff',
  'clefable', 'golduck', 'arcanine', 'alakazam', 'machamp', 'victreebel', 'gengar', 'exeggutor',
  'scyther', 'jynx', 'electabuzz', 'magmar', 'pinsir', 'gyarados', 'lapras', 'vaporeon',
  'jolteon', 'flareon', 'aerodactyl', 'snorlax', 'dragonite', 'mew', 'nidoking', 'rhydon', 'starmie',
];

const DEX = {
  venusaur: 3, charizard: 6, blastoise: 9, pikachu: 25, butterfree: 12, ninetales: 38,
  wigglytuff: 40, clefable: 36, golduck: 55, arcanine: 59, alakazam: 65, machamp: 68,
  victreebel: 71, gengar: 94, exeggutor: 103, scyther: 123, jynx: 124, electabuzz: 125,
  magmar: 126, pinsir: 127, gyarados: 130, lapras: 131, vaporeon: 134, jolteon: 135,
  flareon: 136, aerodactyl: 142, snorlax: 143, dragonite: 149, mew: 151, nidoking: 34,
  rhydon: 112, starmie: 121,
};

const REQUIRED_MOVES = [
  'giga-drain', 'sludge-bomb', 'leech-seed', 'sleep-powder', 'flamethrower', 'air-slash',
  'dragon-claw', 'roost', 'surf', 'ice-beam', 'earthquake', 'iron-defense', 'thunderbolt',
  'volt-tackle', 'quick-attack', 'thunder-wave', 'bug-buzz', 'quiver-dance', 'will-o-wisp',
  'nasty-plot', 'extrasensory', 'dazzling-gleam', 'body-slam', 'sing', 'rest', 'moonblast',
  'soft-boiled', 'calm-mind', 'hydro-pump', 'psychic', 'flare-blitz', 'extreme-speed', 'crunch',
  'close-combat', 'shadow-ball', 'recover', 'cross-chop', 'stone-edge', 'bulk-up', 'leaf-blade',
  'swords-dance', 'hypnosis', 'dream-eater', 'leaf-storm', 'x-scissor', 'aerial-ace',
  'night-slash', 'lovely-kiss', 'ice-punch', 'fire-blast', 'thunder-punch', 'confuse-ray',
  'waterfall', 'dragon-dance', 'acid-armor', 'superpower', 'iron-tail', 'rock-slide',
  'giga-impact', 'fire-punch', 'aura-sphere', 'poison-jab', 'megahorn', 'struggle',
];

const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const HEX = /^#[0-9A-Fa-f]{6}$/;

test('all three data files share one PKMN object on globalThis', () => {
  assert.strictEqual(T, M);
  assert.strictEqual(M, P);
  assert.strictEqual(P, globalThis.PKMN);
});

// ---------------------------------------------------------------- types --

test('TYPES lists the 18 modern types', () => {
  assert.strictEqual(T.TYPES.length, 18);
  assert.strictEqual(new Set(T.TYPES).size, 18);
  for (const t of ['normal', 'fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'poison',
    'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy']) {
    assert.ok(T.TYPES.includes(t), `missing type ${t}`);
  }
});

test('TYPE_CHART only references known types and only 0 / 0.5 / 2', () => {
  for (const atk of Object.keys(T.TYPE_CHART)) {
    assert.ok(T.TYPES.includes(atk), `unknown attacker ${atk}`);
    for (const [def, mult] of Object.entries(T.TYPE_CHART[atk])) {
      assert.ok(T.TYPES.includes(def), `unknown defender ${def} under ${atk}`);
      assert.ok([0, 0.5, 2].includes(mult), `${atk}->${def} = ${mult}`);
    }
  }
});

test('type chart spot checks', () => {
  const e = (a, d) => T.effectiveness(a, [d]);
  assert.strictEqual(e('fire', 'grass'), 2);
  assert.strictEqual(e('water', 'fire'), 2);
  assert.strictEqual(e('electric', 'ground'), 0);
  assert.strictEqual(e('ground', 'flying'), 0);
  assert.strictEqual(e('normal', 'ghost'), 0);
  assert.strictEqual(e('ghost', 'normal'), 0);
  assert.strictEqual(e('dragon', 'fairy'), 0);
  assert.strictEqual(e('ice', 'dragon'), 2);
  assert.strictEqual(e('fighting', 'normal'), 2);
  assert.strictEqual(e('psychic', 'dark'), 0);
  assert.strictEqual(e('poison', 'steel'), 0);
  assert.strictEqual(e('fighting', 'ghost'), 0);
  assert.strictEqual(e('fire', 'water'), 0.5);
  assert.strictEqual(e('normal', 'normal'), 1);
  assert.strictEqual(T.effectiveness('electric', ['water', 'flying']), 4);
  assert.strictEqual(T.effectiveness('grass', ['fire', 'flying']), 0.25);
  assert.strictEqual(T.effectiveness('typeless', ['ghost', 'steel']), 1);
});

test('TYPE_COLORS and TYPE_LABELS cover all 18 types', () => {
  for (const t of T.TYPES) {
    assert.match(T.TYPE_COLORS[t], HEX, `bad colour for ${t}`);
    assert.strictEqual(typeof T.TYPE_LABELS[t], 'string');
    assert.ok(T.TYPE_LABELS[t].length > 0, `empty label for ${t}`);
  }
});

// ---------------------------------------------------------------- moves --

test('every required move exists', () => {
  for (const id of REQUIRED_MOVES) assert.ok(M.MOVES[id], `missing move ${id}`);
});

test('every move has valid core fields', () => {
  for (const [key, mv] of Object.entries(M.MOVES)) {
    assert.strictEqual(mv.id, key);
    assert.match(mv.id, /^[a-z0-9-]+$/, `${key}: id must be kebab-case`);
    assert.ok(typeof mv.name === 'string' && mv.name.length > 0, `${key}: name`);
    if (mv.id === 'struggle') assert.strictEqual(mv.type, 'typeless');
    else assert.ok(T.TYPES.includes(mv.type), `${key}: bad type ${mv.type}`);
    assert.ok(['physical', 'special', 'status'].includes(mv.category), `${key}: category`);
    assert.ok(Number.isInteger(mv.power) && mv.power >= 0, `${key}: power`);
    if (mv.category === 'status') assert.strictEqual(mv.power, 0, `${key}: status move must have power 0`);
    else assert.ok(mv.power > 0, `${key}: damaging move must have power > 0`);
    assert.ok(mv.accuracy === true || (Number.isInteger(mv.accuracy) && mv.accuracy >= 1 && mv.accuracy <= 100),
      `${key}: accuracy ${mv.accuracy}`);
    assert.ok(Number.isInteger(mv.pp) && mv.pp >= 1, `${key}: pp`);
    assert.ok(Number.isInteger(mv.priority), `${key}: priority`);
    assert.ok(typeof mv.desc === 'string' && mv.desc.length > 0, `${key}: desc`);
  }
});

test('move effect fields are well-formed', () => {
  const STATUSES = ['brn', 'psn', 'par', 'slp', 'frz'];
  const STAGE_KEYS = ['atk', 'def', 'spa', 'spd', 'spe'];
  for (const mv of Object.values(M.MOVES)) {
    if (!mv.effect) continue;
    const e = mv.effect;
    if (e.status) {
      assert.ok(STATUSES.includes(e.status.kind), `${mv.id}: status kind`);
      assert.ok(e.status.chance >= 1 && e.status.chance <= 100, `${mv.id}: status chance`);
      if (mv.category === 'status') assert.strictEqual(e.status.chance, 100, `${mv.id}: status move chance`);
    }
    for (const k of ['confuse', 'flinch']) {
      if (e[k]) assert.ok(e[k].chance >= 1 && e[k].chance <= 100, `${mv.id}: ${k} chance`);
    }
    for (const k of ['targetStages', 'selfStages']) {
      if (!e[k]) continue;
      assert.ok(e[k].stages && Object.keys(e[k].stages).length > 0, `${mv.id}: ${k}.stages`);
      for (const [s, v] of Object.entries(e[k].stages)) {
        assert.ok(STAGE_KEYS.includes(s), `${mv.id}: ${k} stat ${s}`);
        assert.ok(Number.isInteger(v) && v !== 0 && Math.abs(v) <= 3, `${mv.id}: ${k} ${s}=${v}`);
      }
      if (k === 'targetStages') assert.ok(e[k].chance >= 1 && e[k].chance <= 100, `${mv.id}: targetStages chance`);
    }
    for (const k of ['drain', 'recoil', 'heal', 'struggleRecoil']) {
      if (e[k] !== undefined) assert.ok(e[k] > 0 && e[k] <= 1, `${mv.id}: ${k}`);
    }
  }
});

test('specific move values match the real games', () => {
  const mv = M.MOVES;
  assert.deepStrictEqual([mv['ice-beam'].type, mv['ice-beam'].category, mv['ice-beam'].power, mv['ice-beam'].accuracy, mv['ice-beam'].pp],
    ['ice', 'special', 90, 100, 10]);
  assert.strictEqual(mv['quick-attack'].priority, 1);
  assert.strictEqual(mv['extreme-speed'].priority, 2);
  assert.strictEqual(mv['aerial-ace'].accuracy, true);
  assert.strictEqual(mv['aura-sphere'].accuracy, true);
  assert.strictEqual(mv['sleep-powder'].accuracy, 75);
  assert.strictEqual(mv['sleep-powder'].effect.powder, true);
  assert.strictEqual(mv['sing'].accuracy, 55);
  assert.strictEqual(mv['hypnosis'].accuracy, 60);
  assert.strictEqual(mv['lovely-kiss'].accuracy, 75);
  assert.strictEqual(mv['thunder-wave'].accuracy, 90);
  assert.strictEqual(mv['will-o-wisp'].accuracy, 85);
  assert.strictEqual(mv['leech-seed'].accuracy, 90);
  assert.strictEqual(mv['leech-seed'].effect.leechSeed, true);
  assert.strictEqual(mv['confuse-ray'].accuracy, 100);
  assert.strictEqual(mv['confuse-ray'].effect.confuse.chance, 100);
  assert.deepStrictEqual(mv['swords-dance'].effect.selfStages.stages, { atk: 2 });
  assert.deepStrictEqual(mv['close-combat'].effect.selfStages.stages, { def: -1, spd: -1 });
  assert.deepStrictEqual(mv['leaf-storm'].effect.selfStages.stages, { spa: -2 });
  assert.strictEqual(mv['giga-drain'].effect.drain, 0.5);
  assert.strictEqual(mv['dream-eater'].effect.requiresSleepingTarget, true);
  assert.ok(Math.abs(mv['flare-blitz'].effect.recoil - 1 / 3) < 1e-9);
  assert.strictEqual(mv['roost'].effect.heal, 0.5);
  assert.strictEqual(mv['rest'].effect.rest, true);
  assert.strictEqual(mv['giga-impact'].effect.recharge, true);
  assert.strictEqual(mv['stone-edge'].effect.highCrit, true);
  assert.strictEqual(mv['air-slash'].effect.flinch.chance, 30);
  assert.strictEqual(mv['flamethrower'].effect.status.kind, 'brn');
});

test('struggle is typeless, physical, 50 power, never misses, pp 1, 1/4 max-HP recoil', () => {
  const s = M.MOVES.struggle;
  assert.strictEqual(s.type, 'typeless');
  assert.strictEqual(s.category, 'physical');
  assert.strictEqual(s.power, 50);
  assert.strictEqual(s.accuracy, true);
  assert.strictEqual(s.pp, 1);
  assert.strictEqual(s.effect.struggleRecoil, 0.25);
});

// -------------------------------------------------------------- pokemon --

test('ROSTER has the 32 ids in contract order', () => {
  assert.deepStrictEqual(P.ROSTER, ROSTER_ORDER);
  assert.strictEqual(Object.keys(P.POKEMON).length, 32);
});

test('each Pokémon entry is complete and valid', () => {
  for (const id of P.ROSTER) {
    const pk = P.POKEMON[id];
    assert.ok(pk, `missing ${id}`);
    assert.strictEqual(pk.id, id);
    assert.ok(typeof pk.name === 'string' && pk.name.length > 0, `${id}: name`);
    assert.strictEqual(pk.dex, DEX[id], `${id}: dex`);

    assert.ok(Array.isArray(pk.types) && pk.types.length >= 1 && pk.types.length <= 2, `${id}: types length`);
    for (const t of pk.types) assert.ok(T.TYPES.includes(t), `${id}: bad type ${t}`);
    assert.strictEqual(new Set(pk.types).size, pk.types.length, `${id}: duplicate type`);

    assert.deepStrictEqual(Object.keys(pk.base).sort(), [...STAT_KEYS].sort(), `${id}: base keys`);
    for (const k of STAT_KEYS) {
      assert.ok(Number.isInteger(pk.base[k]) && pk.base[k] > 0, `${id}: base.${k} = ${pk.base[k]}`);
    }

    assert.ok(Array.isArray(pk.moves) && pk.moves.length === 4, `${id}: must have exactly 4 moves`);
    assert.strictEqual(new Set(pk.moves).size, 4, `${id}: duplicate move`);
    for (const mid of pk.moves) assert.ok(M.MOVES[mid], `${id}: unknown move ${mid}`);

    assert.match(pk.color, HEX, `${id}: colour must be a hex string`);
    assert.ok(typeof pk.height === 'number' && pk.height > 0, `${id}: height`);
    assert.ok(typeof pk.weight === 'number' && pk.weight > 0, `${id}: weight`);
    assert.ok(typeof pk.blurb === 'string' && pk.blurb.length > 0, `${id}: blurb`);
  }
});

test('roster stats and movesets match the contract table', () => {
  const rows = {
    venusaur:   [[80, 82, 83, 100, 100, 80],   'giga-drain sludge-bomb leech-seed sleep-powder'],
    charizard:  [[78, 84, 78, 109, 85, 100],   'flamethrower air-slash dragon-claw roost'],
    blastoise:  [[79, 83, 100, 85, 105, 78],   'surf ice-beam earthquake iron-defense'],
    pikachu:    [[60, 90, 55, 90, 80, 110],    'thunderbolt volt-tackle quick-attack thunder-wave'],
    butterfree: [[60, 45, 50, 90, 80, 70],     'bug-buzz air-slash sleep-powder quiver-dance'],
    ninetales:  [[73, 76, 75, 81, 100, 100],   'flamethrower will-o-wisp nasty-plot extrasensory'],
    wigglytuff: [[140, 70, 45, 85, 50, 45],    'dazzling-gleam body-slam sing rest'],
    clefable:   [[95, 70, 73, 95, 90, 60],     'moonblast soft-boiled calm-mind flamethrower'],
    golduck:    [[80, 82, 78, 95, 80, 85],     'hydro-pump ice-beam psychic calm-mind'],
    arcanine:   [[90, 110, 80, 100, 80, 95],   'flare-blitz extreme-speed crunch close-combat'],
    alakazam:   [[55, 50, 45, 135, 95, 120],   'psychic shadow-ball calm-mind recover'],
    machamp:    [[90, 130, 80, 65, 85, 55],    'cross-chop stone-edge earthquake bulk-up'],
    victreebel: [[80, 105, 65, 100, 70, 70],   'leaf-blade sludge-bomb sleep-powder swords-dance'],
    gengar:     [[60, 65, 60, 130, 75, 110],   'shadow-ball sludge-bomb hypnosis dream-eater'],
    exeggutor:  [[95, 95, 85, 125, 75, 55],    'leaf-storm psychic sleep-powder giga-drain'],
    scyther:    [[70, 110, 80, 55, 80, 105],   'x-scissor aerial-ace swords-dance night-slash'],
    jynx:       [[65, 50, 35, 115, 95, 95],    'ice-beam psychic lovely-kiss nasty-plot'],
    electabuzz: [[65, 83, 57, 95, 85, 105],    'thunderbolt ice-punch cross-chop thunder-wave'],
    magmar:     [[65, 95, 57, 100, 85, 93],    'fire-blast thunder-punch cross-chop confuse-ray'],
    pinsir:     [[65, 125, 100, 55, 70, 85],   'x-scissor stone-edge earthquake swords-dance'],
    gyarados:   [[95, 125, 79, 60, 100, 81],   'waterfall dragon-dance crunch earthquake'],
    lapras:     [[130, 85, 80, 85, 95, 60],    'surf ice-beam thunderbolt sing'],
    vaporeon:   [[130, 65, 60, 110, 95, 65],   'surf ice-beam shadow-ball acid-armor'],
    jolteon:    [[65, 65, 60, 110, 95, 130],   'thunderbolt shadow-ball thunder-wave quick-attack'],
    flareon:    [[65, 130, 60, 95, 110, 65],   'flare-blitz superpower quick-attack iron-tail'],
    aerodactyl: [[80, 105, 65, 60, 75, 130],   'rock-slide earthquake crunch aerial-ace'],
    snorlax:    [[160, 110, 65, 65, 110, 30],  'body-slam earthquake rest giga-impact'],
    dragonite:  [[91, 134, 95, 100, 100, 80],  'dragon-claw fire-punch dragon-dance extreme-speed'],
    mew:        [[100, 100, 100, 100, 100, 100], 'psychic aura-sphere ice-beam soft-boiled'],
    nidoking:   [[81, 102, 77, 85, 75, 85],    'earthquake poison-jab ice-beam megahorn'],
    rhydon:     [[105, 130, 120, 45, 45, 40],  'earthquake stone-edge megahorn swords-dance'],
    starmie:    [[60, 75, 85, 100, 85, 115],   'surf psychic thunderbolt recover'],
  };
  const types = {
    venusaur: ['grass', 'poison'], charizard: ['fire', 'flying'], blastoise: ['water'],
    pikachu: ['electric'], butterfree: ['bug', 'flying'], ninetales: ['fire'],
    wigglytuff: ['normal', 'fairy'], clefable: ['fairy'], golduck: ['water'], arcanine: ['fire'],
    alakazam: ['psychic'], machamp: ['fighting'], victreebel: ['grass', 'poison'],
    gengar: ['ghost', 'poison'], exeggutor: ['grass', 'psychic'], scyther: ['bug', 'flying'],
    jynx: ['ice', 'psychic'], electabuzz: ['electric'], magmar: ['fire'], pinsir: ['bug'],
    gyarados: ['water', 'flying'], lapras: ['water', 'ice'], vaporeon: ['water'],
    jolteon: ['electric'], flareon: ['fire'], aerodactyl: ['rock', 'flying'], snorlax: ['normal'],
    dragonite: ['dragon', 'flying'], mew: ['psychic'], nidoking: ['poison', 'ground'],
    rhydon: ['ground', 'rock'], starmie: ['water', 'psychic'],
  };
  for (const [id, [s, mvs]] of Object.entries(rows)) {
    const pk = P.POKEMON[id];
    assert.deepStrictEqual(pk.base, { hp: s[0], atk: s[1], def: s[2], spa: s[3], spd: s[4], spe: s[5] }, `${id}: base stats`);
    assert.deepStrictEqual(pk.moves, mvs.split(' '), `${id}: moves`);
    assert.deepStrictEqual(pk.types, types[id], `${id}: types`);
  }
});
