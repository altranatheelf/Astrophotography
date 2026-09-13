// Pokémon Battle Night — move data (contract: docs/ARCHITECTURE.md §2)
// Real main-series values for type / category / power / accuracy / PP / priority.
// Stat keys: hp atk def spa spd spe. `accuracy: true` = never misses.
(function (root) {
  const PKMN = root.PKMN = root.PKMN || {};

  // m(id, name, type, category, power, accuracy, pp, priority, desc, effect?)
  function m(id, name, type, category, power, accuracy, pp, priority, desc, effect) {
    const mv = { id, name, type, category, power, accuracy, pp, priority, desc };
    if (effect) mv.effect = effect;
    return mv;
  }

  const LIST = [
    // ---- Grass -------------------------------------------------------------
    m('giga-drain',   'Giga Drain',   'grass', 'special',  75, 100, 10, 0, 'Drains half the damage dealt to heal the user.', { drain: 0.5 }),
    m('leech-seed',   'Leech Seed',   'grass', 'status',    0,  90, 10, 0, 'Plants a seed that saps HP every turn. Fails on Grass types.', { leechSeed: true }),
    m('sleep-powder', 'Sleep Powder', 'grass', 'status',    0,  75, 15, 0, 'Scatters a powder that puts the target to sleep. Fails on Grass types.', { status: { kind: 'slp', chance: 100 }, powder: true }),
    m('leaf-blade',   'Leaf Blade',   'grass', 'physical', 90, 100, 15, 0, 'Slashes with a sharp leaf. High critical-hit ratio.', { highCrit: true }),
    m('leaf-storm',   'Leaf Storm',   'grass', 'special', 130,  90,  5, 0, 'A storm of leaves. Harshly lowers the user\'s Sp. Atk.', { selfStages: { stages: { spa: -2 } } }),

    // ---- Poison ------------------------------------------------------------
    m('sludge-bomb',  'Sludge Bomb',  'poison', 'special',  90, 100, 10, 0, 'Hurls filthy sludge. May poison the target.', { status: { kind: 'psn', chance: 30 } }),
    m('acid-armor',   'Acid Armor',   'poison', 'status',    0, true, 20, 0, 'Liquefies the body to sharply raise Defense.', { selfStages: { stages: { def: 2 } } }),
    m('poison-jab',   'Poison Jab',   'poison', 'physical', 80, 100, 20, 0, 'A toxic stab. May poison the target.', { status: { kind: 'psn', chance: 30 } }),

    // ---- Fire --------------------------------------------------------------
    m('flamethrower', 'Flamethrower', 'fire', 'special',   90, 100, 15, 0, 'Scorches the target with fire. May burn.', { status: { kind: 'brn', chance: 10 } }),
    m('will-o-wisp',  'Will-O-Wisp',  'fire', 'status',     0,  85, 15, 0, 'Sinister flames inflict a burn. Fails on Fire types.', { status: { kind: 'brn', chance: 100 } }),
    m('flare-blitz',  'Flare Blitz',  'fire', 'physical', 120, 100, 15, 0, 'A blazing charge. User takes 1/3 recoil. May burn.', { recoil: 1 / 3, status: { kind: 'brn', chance: 10 } }),
    m('fire-blast',   'Fire Blast',   'fire', 'special',  110,  85,  5, 0, 'An intense blast of all-consuming fire. May burn.', { status: { kind: 'brn', chance: 10 } }),
    m('fire-punch',   'Fire Punch',   'fire', 'physical',  75, 100, 15, 0, 'A fiery fist. May burn the target.', { status: { kind: 'brn', chance: 10 } }),

    // ---- Flying ------------------------------------------------------------
    m('air-slash',    'Air Slash',    'flying', 'special',  75,  95, 15, 0, 'A blade of air. May make the target flinch.', { flinch: { chance: 30 } }),
    m('roost',        'Roost',        'flying', 'status',    0, true, 5, 0, 'Lands to rest, restoring half of max HP.', { heal: 0.5 }),
    m('aerial-ace',   'Aerial Ace',   'flying', 'physical', 60, true, 20, 0, 'A swift strike that never misses.'),

    // ---- Dragon ------------------------------------------------------------
    m('dragon-claw',  'Dragon Claw',  'dragon', 'physical', 80, 100, 15, 0, 'Slashes the target with huge, sharp claws.'),
    m('dragon-dance', 'Dragon Dance', 'dragon', 'status',    0, true, 20, 0, 'A mystic dance that raises Attack and Speed.', { selfStages: { stages: { atk: 1, spe: 1 } } }),

    // ---- Water -------------------------------------------------------------
    m('surf',         'Surf',         'water', 'special',   90, 100, 15, 0, 'Swamps the target with a huge wave.'),
    m('hydro-pump',   'Hydro Pump',   'water', 'special',  110,  80,  5, 0, 'Blasts a huge volume of water at high pressure.'),
    m('waterfall',    'Waterfall',    'water', 'physical',  80, 100, 15, 0, 'Charges with a torrent of water. May cause flinching.', { flinch: { chance: 20 } }),

    // ---- Ice ---------------------------------------------------------------
    m('ice-beam',     'Ice Beam',     'ice', 'special',   90, 100, 10, 0, 'Fires an icy beam. May freeze the target.', { status: { kind: 'frz', chance: 10 } }),
    m('ice-punch',    'Ice Punch',    'ice', 'physical',  75, 100, 15, 0, 'An icy fist. May freeze the target.', { status: { kind: 'frz', chance: 10 } }),

    // ---- Ground ------------------------------------------------------------
    m('earthquake',   'Earthquake',   'ground', 'physical', 100, 100, 10, 0, 'A powerful quake. Flying types are unaffected.'),

    // ---- Steel -------------------------------------------------------------
    m('iron-defense', 'Iron Defense', 'steel', 'status',    0, true, 15, 0, 'Hardens the body to sharply raise Defense.', { selfStages: { stages: { def: 2 } } }),
    m('iron-tail',    'Iron Tail',    'steel', 'physical', 100,  75, 15, 0, 'Slams with a steel-hard tail. May lower Defense.', { targetStages: { chance: 30, stages: { def: -1 } } }),

    // ---- Electric ----------------------------------------------------------
    m('thunderbolt',  'Thunderbolt',  'electric', 'special',   90, 100, 15, 0, 'A strong electric blast. May paralyze.', { status: { kind: 'par', chance: 10 } }),
    m('volt-tackle',  'Volt Tackle',  'electric', 'physical', 120, 100, 15, 0, 'An electrified charge. User takes 1/3 recoil. May paralyze.', { recoil: 1 / 3, status: { kind: 'par', chance: 10 } }),
    m('thunder-wave', 'Thunder Wave', 'electric', 'status',     0,  90, 20, 0, 'A weak jolt that paralyzes. Fails on Electric and Ground types.', { status: { kind: 'par', chance: 100 } }),
    m('thunder-punch','Thunder Punch','electric', 'physical',  75, 100, 15, 0, 'An electrified fist. May paralyze the target.', { status: { kind: 'par', chance: 10 } }),

    // ---- Normal ------------------------------------------------------------
    m('quick-attack', 'Quick Attack', 'normal', 'physical',  40, 100, 30, 1, 'A lightning-fast lunge that always strikes first.'),
    m('body-slam',    'Body Slam',    'normal', 'physical',  85, 100, 15, 0, 'Drops the full body on the target. May paralyze.', { status: { kind: 'par', chance: 30 } }),
    m('sing',         'Sing',         'normal', 'status',     0,  55, 15, 0, 'A soothing lullaby that puts the target to sleep.', { status: { kind: 'slp', chance: 100 } }),
    m('soft-boiled',  'Soft-Boiled',  'normal', 'status',     0, true, 5, 0, 'Restores half of max HP.', { heal: 0.5 }),
    m('extreme-speed','Extreme Speed','normal', 'physical',  80, 100,  5, 2, 'A blindingly fast strike. Almost always goes first.'),
    m('recover',      'Recover',      'normal', 'status',     0, true, 5, 0, 'Restores half of max HP.', { heal: 0.5 }),
    m('swords-dance', 'Swords Dance', 'normal', 'status',     0, true, 20, 0, 'A frenetic dance that sharply raises Attack.', { selfStages: { stages: { atk: 2 } } }),
    m('lovely-kiss',  'Lovely Kiss',  'normal', 'status',     0,  75, 10, 0, 'A scary kiss that puts the target to sleep.', { status: { kind: 'slp', chance: 100 } }),
    m('giga-impact',  'Giga Impact',  'normal', 'physical', 150,  90,  5, 0, 'An all-out charge. The user must recharge next turn.', { recharge: true }),

    // ---- Bug ---------------------------------------------------------------
    m('bug-buzz',     'Bug Buzz',     'bug', 'special',   90, 100, 10, 0, 'A damaging sound wave. May lower Sp. Def.', { targetStages: { chance: 10, stages: { spd: -1 } } }),
    m('quiver-dance', 'Quiver Dance', 'bug', 'status',     0, true, 20, 0, 'A graceful dance raising Sp. Atk, Sp. Def and Speed.', { selfStages: { stages: { spa: 1, spd: 1, spe: 1 } } }),
    m('x-scissor',    'X-Scissor',    'bug', 'physical',  80, 100, 15, 0, 'Slashes the target like a pair of scissors.'),
    m('megahorn',     'Megahorn',     'bug', 'physical', 120,  85, 10, 0, 'Rams with a tremendously tough horn.'),

    // ---- Dark --------------------------------------------------------------
    m('nasty-plot',   'Nasty Plot',   'dark', 'status',     0, true, 20, 0, 'Stimulates the brain to sharply raise Sp. Atk.', { selfStages: { stages: { spa: 2 } } }),
    m('crunch',       'Crunch',       'dark', 'physical',  80, 100, 15, 0, 'Crunches with sharp fangs. May lower Defense.', { targetStages: { chance: 20, stages: { def: -1 } } }),
    m('night-slash',  'Night Slash',  'dark', 'physical',  70, 100, 15, 0, 'A slash at the first opening. High critical-hit ratio.', { highCrit: true }),

    // ---- Psychic -----------------------------------------------------------
    m('extrasensory', 'Extrasensory', 'psychic', 'special',  80, 100, 20, 0, 'An odd, unseeable power. May make the target flinch.', { flinch: { chance: 10 } }),
    m('rest',         'Rest',         'psychic', 'status',    0, true, 5, 0, 'Fully heals, then sleeps for two turns.', { rest: true }),
    m('calm-mind',    'Calm Mind',    'psychic', 'status',    0, true, 20, 0, 'Quiets the mind to raise Sp. Atk and Sp. Def.', { selfStages: { stages: { spa: 1, spd: 1 } } }),
    m('psychic',      'Psychic',      'psychic', 'special',  90, 100, 10, 0, 'A strong telekinetic force. May lower Sp. Def.', { targetStages: { chance: 10, stages: { spd: -1 } } }),
    m('hypnosis',     'Hypnosis',     'psychic', 'status',    0,  60, 20, 0, 'Hypnotic suggestion puts the target to sleep.', { status: { kind: 'slp', chance: 100 } }),
    m('dream-eater',  'Dream Eater',  'psychic', 'special', 100, 100, 15, 0, 'Eats the dreams of a sleeping target, healing half the damage.', { drain: 0.5, requiresSleepingTarget: true }),

    // ---- Fairy -------------------------------------------------------------
    m('dazzling-gleam','Dazzling Gleam','fairy', 'special', 80, 100, 10, 0, 'Damages the target with a powerful flash.'),
    m('moonblast',    'Moonblast',    'fairy', 'special',  95, 100, 15, 0, 'Borrows the power of the moon. May lower Sp. Atk.', { targetStages: { chance: 30, stages: { spa: -1 } } }),

    // ---- Fighting ----------------------------------------------------------
    m('close-combat', 'Close Combat', 'fighting', 'physical', 120, 100,  5, 0, 'A fierce all-out attack. Lowers the user\'s Defense and Sp. Def.', { selfStages: { stages: { def: -1, spd: -1 } } }),
    m('cross-chop',   'Cross Chop',   'fighting', 'physical', 100,  80,  5, 0, 'A double chop with both hands. High critical-hit ratio.', { highCrit: true }),
    m('bulk-up',      'Bulk Up',      'fighting', 'status',     0, true, 20, 0, 'Tenses the muscles to raise Attack and Defense.', { selfStages: { stages: { atk: 1, def: 1 } } }),
    m('superpower',   'Superpower',   'fighting', 'physical', 120, 100,  5, 0, 'A great burst of power. Lowers the user\'s Attack and Defense.', { selfStages: { stages: { atk: -1, def: -1 } } }),
    m('aura-sphere',  'Aura Sphere',  'fighting', 'special',   80, true, 20, 0, 'A blast of aura power that never misses.'),

    // ---- Ghost -------------------------------------------------------------
    m('shadow-ball',  'Shadow Ball',  'ghost', 'special',   80, 100, 15, 0, 'Hurls a shadowy blob. May lower Sp. Def.', { targetStages: { chance: 20, stages: { spd: -1 } } }),
    m('confuse-ray',  'Confuse Ray',  'ghost', 'status',     0, 100, 10, 0, 'A sinister ray that confuses the target.', { confuse: { chance: 100 } }),

    // ---- Rock --------------------------------------------------------------
    m('stone-edge',   'Stone Edge',   'rock', 'physical', 100,  80,  5, 0, 'Stabs with sharpened stones. High critical-hit ratio.', { highCrit: true }),
    m('rock-slide',   'Rock Slide',   'rock', 'physical',  75,  90, 10, 0, 'Hurls large boulders. May make the target flinch.', { flinch: { chance: 30 } }),

    // ---- Struggle (typeless, used automatically when all PP is 0) ---------
    m('struggle',     'Struggle',     'typeless', 'physical', 50, true, 1, 0, 'A desperate attack used only when all PP is gone. Hurts the user.', { struggleRecoil: 0.25 }),
  ];

  PKMN.MOVES = {};
  for (const mv of LIST) PKMN.MOVES[mv.id] = mv;

  if (typeof module !== 'undefined' && module.exports) module.exports = PKMN;
})(typeof window !== 'undefined' ? window : globalThis);
