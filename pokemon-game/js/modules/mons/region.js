// A region to start from.
//
// `KIT.blueprints` asks a module for a whole game. This is the mons module's
// answer: a town you can walk around, a house and a lab you can walk into, a
// professor who gives you a first partner, and a route north with tall grass
// that has something living in it. Four maps, joined the two ways this engine
// joins maps — a seamless edge between the town and the route, a warp through
// each door.
//
// Why it exists: "start your own game" used to mean a blank grid, and a blank
// grid on a phone is a dead end — you cannot paint your way to a region with
// one thumb before you lose interest. This is the same thing every one of those
// steps would have produced, done in one tap, and every tile of it is ordinary
// project data: repaint it, rename it, delete the half you don't want.
//
// Nothing here is drawn from a file. The tiles are the built-in art
// (js/art/tiles-*.js) and the people are the placeholder sprites, so it works
// offline, on a phone, in a single-file build, with nothing imported.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const M = KIT.mons = KIT.mons || {};
  const R = M.region = M.region || {};

  // ---- the legend ---------------------------------------------------------------
  // One character, one cell: `g` goes on the ground layer, `d` stands on it, `t`
  // is the terrain id — so "Re-bake this map" in Creator Mode puts back what was
  // there instead of flattening the paths into grass.
  //
  // Solidity is never written down. It belongs to the tile (js/art/tiles-*.js):
  // a wall is solid because `wall` is solid, and a wild friend turns up in tall
  // grass because `tall-grass` carries `encounter: true`. So the author can
  // paint more tall grass anywhere and it simply works.
  const GRASS = 1, PATH = 2, TALL = 3, WATER = 4;
  const LEGEND = {
    // outdoors
    '.': { g: 'grass', t: GRASS },
    ',': { g: 'grass-2', t: GRASS },
    '-': { g: 'path', t: PATH },
    '~': { g: 'tall-grass', t: TALL },
    'w': { g: 'water', t: WATER },
    'T': { g: 'grass', t: GRASS, tree: true },
    'b': { g: 'grass', t: GRASS, d: 'bush' },
    'k': { g: 'grass', t: GRASS, d: 'rock' },
    'f': { g: 'grass', t: GRASS, d: 'flowers-red' },
    'y': { g: 'grass', t: GRASS, d: 'flowers-yellow' },
    's': { g: 'grass', t: GRASS, d: 'sign' },
    'm': { g: 'grass', t: GRASS, d: 'mailbox' },
    'h': { g: 'grass', t: GRASS, d: 'bench' },
    'l': { g: 'grass', t: GRASS, d: 'ledge-down' },
    'R': { g: 'grass', t: GRASS, d: 'roof-red' },
    'r': { g: 'grass', t: GRASS, d: 'roof-red-eave' },
    'B': { g: 'grass', t: GRASS, d: 'roof-blue' },
    'e': { g: 'grass', t: GRASS, d: 'roof-blue-eave' },
    'W': { g: 'grass', t: GRASS, d: 'wall' },
    'N': { g: 'grass', t: GRASS, d: 'wall-window' },
    'D': { g: 'grass', t: GRASS, d: 'door' },
    'L': { g: 'grass', t: GRASS, d: 'lab-wall' },
    'M': { g: 'grass', t: GRASS, d: 'lab-window' },
    'A': { g: 'grass', t: GRASS, d: 'lab-door' },
    // indoors — no terrain at all, the way the demo's interiors are built
    '#': { g: 'floor-wood', d: 'wall-in-top' },
    '%': { g: 'floor-wood', d: 'wall-in' },
    'i': { g: 'floor-wood', d: 'window-inner' },
    '_': { g: 'floor-wood' },
    ':': { g: 'floor-tile' },
    'X': { g: 'exit-mat' },
    '[': { g: 'floor-wood', d: 'bed-top' },
    ']': { g: 'floor-wood', d: 'bed-bottom' },
    '+': { g: 'floor-wood', d: 'table' },
    '<': { g: 'floor-wood', d: 'chair' },
    'V': { g: 'floor-wood', d: 'tv' },
    'H': { g: 'floor-tile', d: 'bookshelf' },
    'C': { g: 'floor-tile', d: 'counter' },
    'E': { g: 'floor-tile', d: 'pc' },
    'Y': { g: 'floor-wood', d: 'plant' },
    'U': { g: 'rug' },
  };
  R.LEGEND = LEGEND;

  // ---- the sketches -------------------------------------------------------------
  // Read them. That is the point: the map you get is the map you can see here,
  // and a person who wants a wider route widens these rows.
  //
  // The town's top edge and the route's bottom edge are the same width and both
  // have the path at x=9,10 — that is what makes the seam between them walkable
  // (KIT.mapView.connectionAt checks exactly this, and the project validator
  // says "no walkable tile leads across" when it is not true).
  const TOWN = [
    'TTTTTTTTT--TTTTTTTTT',
    'T.......,--,.......T',
    'T..RRRRR.--........T',
    'T..rrrrr.--........T',
    'T..WNWNW.--....b...T',
    'T..WWDWW.--...b.b..T',
    'T...m....--....b...T',
    'T------------------T',
    'T...,....--..wwww..T',
    'T..f.....--..wwww..T',
    'T........--..wwww..T',
    'T..s.....--........T',
    'T........--..BBBBB.T',
    'T........--..eeeee.T',
    'T..f.y...--..LMLML.T',
    'T...h....--..LLALL.T',
    'T........--........T',
    'TTTTTTTTTTTTTTTTTTTT',
  ];
  const ROUTE = [
    'TTTTTTTTTTTTTTTTTTTT',
    'T........s.........T',
    'T........--........T',
    'T..~~~~..--..~~~~..T',
    'T..~~~~..--..~~~~..T',
    'T..~~~~..--..~~~~..T',
    'T...~~...--...~~...T',
    'T........--........T',
    'T..k.....--.....k..T',
    'T...lll..--..lll...T',
    'T........--........T',
    'T..~~~~~.--.~~~~~..T',
    'T..~~~~~.--.~~~~~..T',
    'T..~~~~~.--.~~~~~..T',
    'T...~~~..--..~~~...T',
    'T........--........T',
    'T..b...b.--.b...b..T',
    'T........--........T',
    'T..~~~~..--..~~~~..T',
    'T..~~~~..--..~~~~..T',
    'T........--........T',
    // The bottom row is the town's top row: the seam only works when both sides
    // agree about what is walkable, and the validator says so when they do not.
    'TTTTTTTTT--TTTTTTTTT',
  ];
  const HOME = [
    '############',
    '%%i%%%%%i%%%',
    '__[_______Y_',
    '__]_____+___',
    '________<___',
    '_H________V_',
    '____UU______',
    '____UU______',
    '_____X______',
  ];
  const LAB = [
    '##############',
    '%%%i%%%%i%%%%%',
    '::::::::::::::',
    '::HH::::::CC::',
    '::::::::::::::',
    '::::::::::::::',
    '::::E:::::E:::',
    '::::::::::::::',
    '::::::::::::::',
    '::::::X:::::::',
  ];
  R.SKETCHES = { town: TOWN, route: ROUTE, home: HOME, lab: LAB };

  // ---- painting -----------------------------------------------------------------
  /**
   * paint(rows) -> { width, height, layers:{ terrain, ground, deco, above, regions }, collision }
   * Pure. Every row must be the same length, and every character must be in the
   * legend — a typo in a sketch is a thrown error at build time, not a hole in
   * somebody's map.
   */
  R.paint = function (rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('a sketch needs rows');
    const height = rows.length;
    const width = String(rows[0]).length;
    for (let y = 0; y < height; y++) {
      if (String(rows[y]).length !== width) throw new Error(`sketch row ${y} is ${String(rows[y]).length} wide, not ${width}`);
    }
    const n = width * height;
    const terrain = new Array(n).fill(0);
    const ground = new Array(n).fill(null);
    const deco = new Array(n).fill(null);
    const above = new Array(n).fill(null);
    const regions = new Array(n).fill(0);
    const collision = new Array(n).fill(null);
    const tree = new Array(n).fill(false);
    for (let y = 0; y < height; y++) {
      const row = String(rows[y]);
      for (let x = 0; x < width; x++) {
        const ch = row[x];
        const cell = LEGEND[ch];
        if (!cell) throw new Error(`sketch character “${ch}” at ${x},${y} is not in the legend`);
        const i = y * width + x;
        terrain[i] = cell.t || 0;
        ground[i] = cell.g || null;
        if (cell.d) deco[i] = cell.d;
        if (cell.tree) tree[i] = true;
      }
    }
    // Trees are 2×2 (tree-tl/tr/bl/br) and a one-cell-wide line of them is not,
    // so a mass of `T` is laid out greedily: a quad wherever four unclaimed tree
    // cells meet, `tree-small` for whatever is left over. A one-thick border
    // comes out as small trees, which is what it should look like.
    const taken = new Array(n).fill(false);
    const isTree = (x, y) => x >= 0 && y >= 0 && x < width && y < height && tree[y * width + x] && !taken[y * width + x];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!tree[i] || taken[i]) continue;
        if (isTree(x + 1, y) && isTree(x, y + 1) && isTree(x + 1, y + 1)) {
          deco[i] = 'tree-tl'; deco[i + 1] = 'tree-tr';
          deco[i + width] = 'tree-bl'; deco[i + width + 1] = 'tree-br';
          taken[i] = taken[i + 1] = taken[i + width] = taken[i + width + 1] = true;
        } else {
          deco[i] = 'tree-small';
          taken[i] = true;
        }
      }
    }
    return { width, height, layers: { terrain, ground, deco, above, regions }, collision };
  };

  // ---- the people ----------------------------------------------------------------
  const say = (text, who) => ({ t: 'say', text, who: who || '', bg: 'window', face: null, position: 'bottom' });
  const warp = (id, name, x, y, to) => ({
    id, name, type: 'warp', x, y,
    pages: [{ through: true, visible: false, layer: 'below', props: { to, dir: to.dir || 'down', fade: true, look: null, sound: null } }],
  });
  const person = (id, name, sprite, x, y, dir, lines) => ({
    id, name, type: 'npc', x, y,
    pages: [{ sprite, dir, dirFix: false, layer: 'same', on: { interact: lines } }],
  });
  /** A thing you read, not a person: the sign tile is already drawn, so this is invisible. */
  const readable = (id, name, x, y, lines) => ({
    id, name, type: 'npc', x, y,
    pages: [{ sprite: null, visible: false, dirFix: true, layer: 'same', on: { interact: lines } }],
  });

  // The three the professor offers. They are built-in species, so a brand new
  // game has a working first partner before the author has drawn anything — and
  // Creator Mode › Species is where they become somebody else's.
  R.STARTERS = ['venusaur', 'charizard', 'blastoise'];
  // What lives in the tall grass on the first route. Weights, not percentages:
  // the common ones are common because their number is bigger.
  R.WILD = [
    { id: 'pikachu', weight: 8 },
    { id: 'butterfree', weight: 7 },
    { id: 'clefable', weight: 4 },
    { id: 'ninetales', weight: 2 },
    { id: 'scyther', weight: 1 },
  ];

  function professorPage() {
    const options = R.STARTERS.map((id) => ({
      text: M.speciesName ? M.speciesName(id) : id,
      when: null,
      then: [
        { t: 'setVar', name: 'starter', op: 'set', value: id, var: null, min: 1, max: 6 },
        { t: 'setVar', name: 'hasStarter', op: 'set', value: true, var: null, min: 1, max: 6 },
        // Without these the catch screen offers a ball you do not have, and the
        // first creature in the grass can only be talked to or run from.
        { t: 'give', item: 'pokeball', count: 5, notify: true },
        { t: 'give', item: 'berry', count: 3, notify: true },
        say('Take these too. {pause} A berry calms a nervous one; a ball asks it to come along.', 'Professor'),
        say('Then off you go. {pause} The tall grass north of town is full of them.', 'Professor'),
      ],
    }));
    return [
      say('There you are. {pause} Everything out there is waiting to meet you.', 'Professor'),
      { t: 'choice', prompt: 'Who comes with you?', cancel: 'none', options },
    ];
  }

  // ---- the game ------------------------------------------------------------------
  /**
   * build({ title, id }) -> a project, ready for KIT.project.normalize.
   * Everything is computed here rather than stored as a file so that the single
   * page build carries it for free.
   */
  R.build = function (opts) {
    opts = opts || {};
    const title = String(opts.title || 'A New Region').trim() || 'A New Region';
    const id = KIT.slug(opts.id || title) || 'a-new-region';

    const town = Object.assign({ id: 'town', name: 'Town', kind: 'outdoor', music: 'town' }, R.paint(TOWN));
    const route = Object.assign({ id: 'route', name: 'Route 1', kind: 'outdoor', music: 'route' }, R.paint(ROUTE));
    const home = Object.assign({ id: 'home', name: 'Your house', kind: 'indoor', music: 'house' }, R.paint(HOME));
    const lab = Object.assign({ id: 'lab', name: 'The lab', kind: 'indoor', music: 'house' }, R.paint(LAB));

    town.objects = [
      warp('front-door', 'Your front door', 5, 5, { map: 'home', x: 5, y: 7, dir: 'up' }),
      warp('lab-door', 'The lab door', 15, 15, { map: 'lab', x: 6, y: 8, dir: 'up' }),
      readable('town-sign', 'Town sign', 3, 11, [
        say(`${title}. {pause} Population: you, so far.`),
        say('Everything you can see is yours to move. Creator Mode is the ✦ on the title screen.'),
      ]),
      person('neighbour', 'Neighbour', 'woman', 12, 8, 'left', [
        say('The professor is in the lab, down by the water.'),
        say('She has been waiting to give somebody a partner all morning.'),
      ]),
    ];
    home.objects = [
      warp('way-out', 'Out', 5, 8, { map: 'town', x: 5, y: 6, dir: 'down' }),
      readable('table-note', 'A note', 8, 3, [
        say('A note on the table, in your own handwriting:'),
        say('“Everything in this game can be changed. Press ✕ in Creator Mode to play it.”'),
      ]),
    ];
    // Two pages, and the LAST one whose condition passes is the one you get: so
    // the professor offers a partner until you have one, and afterwards has
    // something else to say instead of offering a second.
    lab.objects = [
      warp('lab-out', 'Out', 6, 9, { map: 'town', x: 15, y: 16, dir: 'down' }),
      {
        id: 'prof', name: 'Professor', type: 'npc', x: 6, y: 4,
        pages: [
          {
            sprite: 'professor', dir: 'down', dirFix: false, layer: 'same',
            when: null,
            on: { interact: professorPage() },
          },
          {
            sprite: 'professor', dir: 'down', dirFix: false, layer: 'same',
            when: { kind: 'var', name: 'hasStarter', op: '==', value: true, var: null },
            on: { interact: [say('Go on then. {pause} The grass north of town is the place to start.', 'Professor')] },
          },
        ],
      },
    ];
    route.objects = [
      readable('route-sign', 'Route sign', 9, 1, [
        say('ROUTE 1 — north: everything you have not built yet.'),
        say('Open Creator Mode and keep going. A new map is one tap in the map list.'),
      ]),
      person('hiker', 'Hiker', 'man', 13, 10, 'left', [
        say('Careful in the long grass. {pause} Things live in it.'),
        say('That is what makes it long grass and not a lawn.'),
      ]),
    ];

    // The one thing that makes the route a route: something to meet in it. The
    // table is on the map, so copying the map to a new one copies its wildlife.
    //
    // The key is '0', not '*'. Both work at runtime — M.entriesFor falls back
    // through '*' — but Map › Encounters lists one section per region the map
    // paints, and a map with no regions layer paints only 0. Under '*' the
    // panel would have said "Nobody lives here yet" over grass that was full of
    // them, which is the editor lying about the game.
    route.props = { encounters: { byRegion: { 0: R.WILD.map(e => ({ id: e.id, weight: e.weight })) }, rate: 14 } };

    return {
      version: KIT.project.VERSION,
      meta: {
        id, title,
        subtitle: 'A region of your own',
        author: '',
        pitch: 'A town, a lab and one route north. Everything past that is yours to build.',
      },
      start: { map: 'town', x: 10, y: 16, dir: 'up' },
      modules: ['mons'],
      // No `settings`: normalize fills them, and an encounterRate here would be
      // a number that looks like it decides something. The route's own table
      // carries the rate that is actually rolled.
      heroes: [
        { id: 'p1', name: 'You', sprite: 'hero-boy', recolor: {} },
        { id: 'p2', name: 'Your friend', sprite: 'hero-girl', recolor: {} },
      ],
      vars: {
        starter: { type: 'string', default: '', group: 'Story', label: 'Your first partner' },
        hasStarter: { type: 'bool', default: false, group: 'Story', label: 'Has a partner' },
      },
      terrains: [
        { id: GRASS, name: 'Grass', color: '#78c850', base: 'grass' },
        { id: PATH, name: 'Path', color: '#d8b878', base: 'path' },
        { id: TALL, name: 'Tall grass', color: '#4ca050', base: 'tall-grass' },
        { id: WATER, name: 'Water', color: '#5890f8', base: 'water' },
      ],
      world: {
        maps: {
          route: { x: 1, y: 0, folder: 'The region' },
          town: { x: 1, y: 1, folder: 'The region' },
          home: { x: 0, y: 1, folder: 'The region' },
          lab: { x: 2, y: 1, folder: 'The region' },
        },
        connections: [{ a: 'town', side: 'n', b: 'route', offset: 0 }],
      },
      maps: { town, route, home, lab },
      // What the catch screen's buttons use. A region with no items had a Throw
      // Ball button for a ball that did not exist.
      items: {
        pokeball: { kind: 'ball', name: 'Poké Ball', icon: 'pokeball', desc: 'For making friends.', note: '', props: { power: 1 } },
        berry: { kind: 'berry', name: 'Berry', icon: 'berry', desc: 'Sweet. Calms a nervous one.', note: '', props: { calm: 1, friendship: 10, golden: false } },
        'golden-berry': { kind: 'berry', name: 'Golden Berry', icon: 'golden-berry', desc: 'Rare and very sweet. The next ball you throw will surely work.', note: '', props: { calm: 1, friendship: 20, golden: true } },
      },
      packs: { mons: { starters: { var: 'starter', friendship: 70, ask: true } } },
    };
  };

  /** register() — adds the blueprint. Called from the module's manifest. */
  R.register = function () {
    if (!KIT.registry || !KIT.blueprints) return false;
    KIT.registry('blueprints').add({
      id: 'mons-region', label: 'A region to explore', order: 20,
      defaultTitle: 'A New Region',
      describe: 'A town, a house and a lab you can walk into, and a route north with tall grass that has something living in it.',
      build: (o) => R.build(o),
      replace: true,
    });
    return true;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
