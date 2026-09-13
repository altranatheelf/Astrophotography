// Pokémon Battle Night — roster data (contract: docs/ARCHITECTURE.md §3)
// Stat keys: hp atk def spa spd spe. `moves` = exactly 4 ids from PKMN.MOVES.
(function (root) {
  const PKMN = root.PKMN = root.PKMN || {};

  // p(id, name, dex, types, [hp,atk,def,spa,spd,spe], moves, color, height, weight, blurb)
  function p(id, name, dex, types, s, moves, color, height, weight, blurb) {
    return {
      id, name, dex, types,
      base: { hp: s[0], atk: s[1], def: s[2], spa: s[3], spd: s[4], spe: s[5] },
      moves, color, height, weight, blurb,
    };
  }

  const LIST = [
    p('venusaur',   'Venusaur',   3,   ['grass', 'poison'],   [80, 82, 83, 100, 100, 80],   ['giga-drain', 'sludge-bomb', 'leech-seed', 'sleep-powder'],     '#5FA96B', 2.0, 100.0,
      'The flower on its back soaks up sunshine and fills the air with a sweet, soothing scent.'),
    p('charizard',  'Charizard',  6,   ['fire', 'flying'],    [78, 84, 78, 109, 85, 100],   ['flamethrower', 'air-slash', 'dragon-claw', 'roost'],           '#F08030', 1.7, 90.5,
      'Its fiery breath can melt boulders, and the flame on its tail burns hotter with every battle.'),
    p('blastoise',  'Blastoise',  9,   ['water'],             [79, 83, 100, 85, 105, 78],   ['surf', 'ice-beam', 'earthquake', 'iron-defense'],              '#5B8FD0', 1.6, 85.5,
      'The water cannons on its shell fire jets so precise they can punch through thick steel.'),
    p('pikachu',    'Pikachu',    25,  ['electric'],          [60, 90, 55, 90, 80, 110],    ['thunderbolt', 'volt-tackle', 'quick-attack', 'thunder-wave'],  '#F8D030', 0.4, 6.0,
      'Clutching a Light Ball, this cheeky mouse hits far above its size - sparks fly from its cheeks.'),
    p('butterfree', 'Butterfree', 12,  ['bug', 'flying'],     [60, 45, 50, 90, 80, 70],     ['bug-buzz', 'air-slash', 'sleep-powder', 'quiver-dance'],       '#B48CE0', 1.1, 32.0,
      'Its wings shed a shimmering powder that sends anyone who breathes it into a peaceful nap.'),
    p('ninetales',  'Ninetales',  38,  ['fire'],              [73, 76, 75, 81, 100, 100],   ['flamethrower', 'will-o-wisp', 'nasty-plot', 'extrasensory'],   '#F2C46C', 1.1, 19.9,
      'Each of its nine tails holds a mystical power, and it is said to live for a thousand years.'),
    p('wigglytuff', 'Wigglytuff', 40,  ['normal', 'fairy'],   [140, 70, 45, 85, 50, 45],    ['dazzling-gleam', 'body-slam', 'sing', 'rest'],                '#F7A8C8', 1.0, 12.0,
      'Its fine, silky fur is a delight to touch - but it puffs up enormously when it gets angry.'),
    p('clefable',   'Clefable',   36,  ['fairy'],             [95, 70, 73, 95, 90, 60],     ['moonblast', 'soft-boiled', 'calm-mind', 'flamethrower'],       '#F4B8D0', 1.3, 40.0,
      'A shy fairy that dances under the full moon and can hear a pin drop a kilometre away.'),
    p('golduck',    'Golduck',    55,  ['water'],             [80, 82, 78, 95, 80, 85],     ['hydro-pump', 'ice-beam', 'psychic', 'calm-mind'],              '#4AA5D8', 1.7, 76.6,
      'A graceful swimmer whose glowing forehead gem is rumoured to grant psychic powers.'),
    p('arcanine',   'Arcanine',   59,  ['fire'],              [90, 110, 80, 100, 80, 95],   ['flare-blitz', 'extreme-speed', 'crunch', 'close-combat'],      '#E8843C', 1.9, 155.0,
      'A legendary hound admired since ancient times; it can run 10,000 km in a single day.'),
    p('alakazam',   'Alakazam',   65,  ['psychic'],           [55, 50, 45, 135, 95, 120],   ['psychic', 'shadow-ball', 'calm-mind', 'recover'],              '#D8A848', 1.5, 48.0,
      'With an IQ of 5,000 it remembers everything - its twin spoons amplify its mighty psychic power.'),
    p('machamp',    'Machamp',    68,  ['fighting'],          [90, 130, 80, 65, 85, 55],    ['cross-chop', 'stone-edge', 'earthquake', 'bulk-up'],           '#7A9CC8', 1.6, 130.0,
      'Four arms throw a thousand punches in two seconds; it can hurl a mountain of a foe with ease.'),
    p('victreebel', 'Victreebel', 71,  ['grass', 'poison'],   [80, 105, 65, 100, 70, 70],   ['leaf-blade', 'sludge-bomb', 'sleep-powder', 'swords-dance'],   '#C8D85C', 1.7, 15.5,
      'Lures prey with a sweet honey scent, then dissolves whatever falls into its pitcher.'),
    p('gengar',     'Gengar',     94,  ['ghost', 'poison'],   [60, 65, 60, 130, 75, 110],   ['shadow-ball', 'sludge-bomb', 'hypnosis', 'dream-eater'],       '#6A4C93', 1.5, 40.5,
      'A mischievous shadow that hides in the dark and steals warmth from the room with a grin.'),
    p('exeggutor',  'Exeggutor',  103, ['grass', 'psychic'],  [95, 95, 85, 125, 75, 55],    ['leaf-storm', 'psychic', 'sleep-powder', 'giga-drain'],         '#B8C858', 2.0, 120.0,
      'Called the Walking Jungle, its three heads think independently and chatter all day long.'),
    p('scyther',    'Scyther',    123, ['bug', 'flying'],     [70, 110, 80, 55, 80, 105],   ['x-scissor', 'aerial-ace', 'swords-dance', 'night-slash'],      '#8CC85C', 1.5, 56.0,
      'A ninja-like mantis whose scythes move so fast it seems to vanish in mid-strike.'),
    p('jynx',       'Jynx',       124, ['ice', 'psychic'],    [65, 50, 35, 115, 95, 95],    ['ice-beam', 'psychic', 'lovely-kiss', 'nasty-plot'],            '#C85C9C', 1.4, 40.6,
      'Sways its hips in a rhythmic dance so hypnotic that onlookers cannot help but join in.'),
    p('electabuzz', 'Electabuzz', 125, ['electric'],          [65, 83, 57, 95, 85, 105],    ['thunderbolt', 'ice-punch', 'cross-chop', 'thunder-wave'],      '#F8D858', 1.1, 30.0,
      'Crackles with static; it loves to feed on lightning and turns up whenever a storm rolls in.'),
    p('magmar',     'Magmar',     126, ['fire'],              [65, 95, 57, 100, 85, 93],    ['fire-blast', 'thunder-punch', 'cross-chop', 'confuse-ray'],    '#E85C38', 1.3, 44.5,
      'Born in a volcano, its body glows like molten lava and it bathes happily in magma.'),
    p('pinsir',     'Pinsir',     127, ['bug'],               [65, 125, 100, 55, 70, 85],   ['x-scissor', 'stone-edge', 'earthquake', 'swords-dance'],       '#A88858', 1.5, 55.0,
      'Grips foes in its giant pincers and does not let go until they are torn in half.'),
    p('gyarados',   'Gyarados',   130, ['water', 'flying'],   [95, 125, 79, 60, 100, 81],   ['waterfall', 'dragon-dance', 'crunch', 'earthquake'],           '#4878C8', 6.5, 235.0,
      'Once a helpless Magikarp, now a raging sea serpent whose fury can level whole towns.'),
    p('lapras',     'Lapras',     131, ['water', 'ice'],      [130, 85, 80, 85, 95, 60],    ['surf', 'ice-beam', 'thunderbolt', 'sing'],                    '#6CA8D8', 2.5, 220.0,
      'A gentle giant that ferries people across the sea, singing softly as it glides along.'),
    p('vaporeon',   'Vaporeon',   134, ['water'],             [130, 65, 60, 110, 95, 65],   ['surf', 'ice-beam', 'shadow-ball', 'acid-armor'],               '#5CB8D8', 1.0, 29.0,
      'Its cells are so like water molecules that it can melt away and vanish into a stream.'),
    p('jolteon',    'Jolteon',    135, ['electric'],          [65, 65, 60, 110, 95, 130],   ['thunderbolt', 'shadow-ball', 'thunder-wave', 'quick-attack'],  '#F8D848', 0.8, 24.5,
      'Every hair stands on end like a needle when it is startled, firing 10,000-volt bolts.'),
    p('flareon',    'Flareon',    136, ['fire'],              [65, 130, 60, 95, 110, 65],   ['flare-blitz', 'superpower', 'quick-attack', 'iron-tail'],      '#F09048', 0.9, 25.0,
      'Stores flames in an inner fire sac; its fluffy fur releases heat to keep it from overheating.'),
    p('aerodactyl', 'Aerodactyl', 142, ['rock', 'flying'],    [80, 105, 65, 60, 75, 130],   ['rock-slide', 'earthquake', 'crunch', 'aerial-ace'],            '#9C8CB8', 1.8, 59.0,
      'Revived from ancient amber, this prehistoric terror of the skies has saw-like fangs.'),
    p('snorlax',    'Snorlax',    143, ['normal'],            [160, 110, 65, 65, 110, 30],  ['body-slam', 'earthquake', 'rest', 'giga-impact'],              '#3C6488', 2.1, 460.0,
      'Eats 400 kg a day and then dozes off; children love to bounce on its enormous belly.'),
    p('dragonite',  'Dragonite',  149, ['dragon', 'flying'],  [91, 134, 95, 100, 100, 80],  ['dragon-claw', 'fire-punch', 'dragon-dance', 'extreme-speed'],  '#F0A860', 2.2, 210.0,
      'A kind-hearted dragon that can circle the globe in 16 hours and guides lost ships to shore.'),
    p('mew',        'Mew',        151, ['psychic'],           [100, 100, 100, 100, 100, 100], ['psychic', 'aura-sphere', 'ice-beam', 'soft-boiled'],          '#F8C8D8', 0.4, 4.0,
      'A playful little myth said to hold the genes of every Pokémon; it only appears to the pure of heart.'),
    p('nidoking',   'Nidoking',   34,  ['poison', 'ground'],  [81, 102, 77, 85, 75, 85],    ['earthquake', 'poison-jab', 'ice-beam', 'megahorn'],            '#9C6CB8', 1.4, 62.0,
      'One swing of its mighty tail can snap a telephone pole like a twig - a true king of the wild.'),
    p('rhydon',     'Rhydon',     112, ['ground', 'rock'],    [105, 130, 120, 45, 45, 40],  ['earthquake', 'stone-edge', 'megahorn', 'swords-dance'],        '#A8A090', 1.9, 120.0,
      'Its armour-like hide shrugs off lava, and its drill horn bores straight through solid rock.'),
    p('starmie',    'Starmie',    121, ['water', 'psychic'],  [60, 75, 85, 100, 85, 115],   ['surf', 'psychic', 'thunderbolt', 'recover'],                   '#8C78C8', 1.1, 80.0,
      'The jewel at its core glows in seven colours; some say it sends signals to the stars.'),
  ];

  PKMN.POKEMON = {};
  PKMN.ROSTER = [];
  for (const pk of LIST) {
    PKMN.POKEMON[pk.id] = pk;
    PKMN.ROSTER.push(pk.id);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = PKMN;
})(typeof window !== 'undefined' ? window : globalThis);
