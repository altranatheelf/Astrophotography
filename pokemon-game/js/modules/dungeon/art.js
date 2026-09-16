// dungeon/art — the tiles and icons the Dungeon module ships.
//
// Pixel art in the kit's own format (16x16, '.' is transparent). Everything
// here goes straight into the kit registries, so Creator Mode's tile palette
// shows it, the importers can replace it, and a missing id is drawn as a
// silhouette rather than crashing. Nothing else in the module depends on how
// these look: swap the rows, or import your own sheet over the same ids.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const D = KIT.dungeon = KIT.dungeon || {};

  const STONE = { a: '#626880', b: '#5a6078', m: '#343a4c', h: '#737a94' };
  const WALL = { w: '#2f3445', d: '#232735', m: '#0e1018' };
  const WOOD = { o: '#1b1d26', w: '#8a5f36', d: '#6b472a', l: '#a8754a', i: '#8c93a8', k: '#15161d' };
  const IRON = { o: '#1b1d26', i: '#6b7286', l: '#8b92a6', d: '#474d60', v: '#12131a' };

  const TILES = [
    // ---- the room itself -------------------------------------------------------
    { id: 'dun-floor', name: 'Dungeon floor', group: 'cave', solid: false, palette: STONE, rows: [
      'aaaaaaambbbbbbbm', 'aaaaaaambbbbbbbm', 'aaaaaaambbbbbbbm', 'ahaaaaambbbbbhbm',
      'aaaaaaambbbbbbbm', 'aaaaaaambbbbbbbm', 'aaaaaaambbbbbbbm', 'mmmmmmmmmmmmmmmm',
      'bbbbbbbmaaaaaaam', 'bbbbbbbmaaaaaaam', 'bbbbbbbmaaaaaaam', 'bbbhbbbmaaahaaam',
      'bbbbbbbmaaaaaaam', 'bbbbbbbmaaaaaaam', 'bbbbbbbmaaaaaaam', 'mmmmmmmmmmmmmmmm',
    ] },
    { id: 'dun-wall', name: 'Dungeon wall', group: 'cave', solid: true, palette: Object.assign({ c: '#454b61' }, WALL), rows: [
      'cccccccccccccccc', 'wwwwwwwwmwwwwwww', 'wwwwwwwwmwwwwwww', 'wwwwwwwwmwwwwwww',
      'dddddddddddddddd', 'mmmmmmmmmmmmmmmm', 'wwwmwwwwwwwwwwww', 'wwwmwwwwwwwwwwww',
      'wwwmwwwwwwwwwwww', 'dddddddddddddddd', 'mmmmmmmmmmmmmmmm', 'wwwwwwwwwwwmwwww',
      'wwwwwwwwwwwmwwww', 'wwwwwwwwwwwmwwww', 'dddddddddddddddd', 'mmmmmmmmmmmmmmmm',
    ] },
    { id: 'dun-rubble', name: 'Rubble', group: 'cave', solid: true, palette: { a: STONE.a, m: STONE.m, g: '#828aa6' }, rows: [
      '................', '.....ggg........', '....gmmmg...gg..', '...gmaaamg.gmmg.',
      '..gmaaaaamggmag.', '..gmaaaaaaamaag.', '..gmaaaaaaaaaag.', '.ggmaaaaaaaaamg.',
      'gmmmaaaaaaaaamg.', 'gmaaaaaaaaaaamg.', 'gmaaaaaaaaaaaamg', '.gmaaaaaaaaaamg.',
      '.gmmaaaaaaaaamg.', '..gmmmaaaaammg..', '...ggmmmmmmgg...', '.....gggggg.....',
    ] },

    // ---- the locked door: two looks, one object --------------------------------
    { id: 'dun-door-locked', name: 'Locked door', group: 'cave', solid: true, palette: WOOD, rows: [
      'oooooooooooooooo', 'olllllllllllllwo', 'owwwwwwwwwwwwwdo', 'oiiiiiiiiiiiiiio',
      'owwwwwwwwwwwwwdo', 'owwwwwwwwwwwwwdo', 'owwwwwkkkkwwwwdo', 'owwwwkkkkkkwwwdo',
      'owwwwkkiikkwwwdo', 'owwwwwkkkkwwwwdo', 'owwwwwwkkwwwwwdo', 'oiiiiiiiiiiiiiio',
      'owwwwwwwwwwwwwdo', 'owwwwwwwwwwwwwdo', 'odddddddddddddso', 'oooooooooooooooo',
    ].map(r => r.replace(/s/g, 'd')) },
    { id: 'dun-door-open', name: 'Open door', group: 'cave', solid: false, palette: { o: WOOD.o, w: WOOD.w, d: WOOD.d, k: '#0b0c12' }, rows: [
      'oooooooooooooooo', 'okkkkkkkkkkkkkko', 'owkkkkkkkkkkkkdo', 'owkkkkkkkkkkkkdo',
      'owkkkkkkkkkkkkdo', 'owkkkkkkkkkkkkdo', 'owkkkkkkkkkkkkdo', 'owkkkkkkkkkkkkdo',
      'owkkkkkkkkkkkkdo', 'owkkkkkkkkkkkkdo', 'owkkkkkkkkkkkkdo', 'owkkkkkkkkkkkkdo',
      'owkkkkkkkkkkkkdo', 'owkkkkkkkkkkkkdo', 'odddddddddddddso', 'oooooooooooooooo',
    ].map(r => r.replace(/s/g, 'd')) },

    // ---- the gate: open while its switches are held ----------------------------
    { id: 'dun-gate-closed', name: 'Gate (closed)', group: 'cave', solid: true, palette: { o: IRON.o, i: IRON.i, l: IRON.l, v: IRON.v }, rows: [
      'oooooooooooooooo', 'illillillillilli', '.i.ii.ii.ii.ii.i', '.l.ll.ll.ll.ll.l',
      '.i.ii.ii.ii.ii.i', 'iiiiiiiiiiiiiiii', '.i.ii.ii.ii.ii.i', '.l.ll.ll.ll.ll.l',
      '.i.ii.ii.ii.ii.i', 'iiiiiiiiiiiiiiii', '.i.ii.ii.ii.ii.i', '.l.ll.ll.ll.ll.l',
      '.i.ii.ii.ii.ii.i', '.i.ii.ii.ii.ii.i', 'vvvvvvvvvvvvvvvv', 'oooooooooooooooo',
    ] },
    { id: 'dun-gate-open', name: 'Gate (open)', group: 'cave', solid: false, palette: { o: IRON.o, i: IRON.i, l: IRON.l, v: IRON.v }, rows: [
      'oooooooooooooooo', 'illillillillilli', '.i.ii.ii.ii.ii.i', 'iiiiiiiiiiiiiiii',
      '.i.ii.ii.ii.ii.i', '.l.ll.ll.ll.ll.l', 'vvvvvvvvvvvvvvvv', '................',
      '................', '................', '................', '................',
      '................', '................', '................', '................',
    ] },

    // ---- the switch plate ---------------------------------------------------------
    { id: 'dun-plate', name: 'Switch plate', group: 'cave', solid: false, palette: { o: '#1b1d26', p: '#7a8098', d: '#585e74', h: '#949ab2' }, rows: [
      '................', '...oooooooooo...', '..ohhhhhhhhhhdo.', '..ohppppppppddo.',
      '..ohpppppppppdo.', '..ohpppppppppdo.', '..ohpppppppppdo.', '..ohpppppppppdo.',
      '..ohpppppppppdo.', '..ohpppppppppdo.', '..ohpppppppppdo.', '..ohpppppppppdo.',
      '..ohdddddddddddo', '...oddddddddddo.', '....oooooooooo..', '................',
    ] },
    { id: 'dun-plate-down', name: 'Switch plate (down)', group: 'cave', solid: false, palette: { o: '#1b1d26', p: '#c8a050', d: '#8a6a30', h: '#e8c878' }, rows: [
      '................', '................', '...oooooooooo...', '..ohhhhhhhhhhdo.',
      '..ohppppppppddo.', '..ohpppppppppdo.', '..ohpppppppppdo.', '..ohpppppppppdo.',
      '..ohpppppppppdo.', '..ohpppppppppdo.', '..ohpppppppppdo.', '..ohdddddddddddo',
      '...oddddddddddo.', '....oooooooooo..', '................', '................',
    ] },

    // ---- the pushable block ---------------------------------------------------------
    { id: 'dun-block', name: 'Pushable block', group: 'cave', solid: true, palette: { o: '#14151d', l: '#868ca4', m: '#5f6580', d: '#3f4457', g: '#a0a6be' }, rows: [
      'oooooooooooooooo', 'ogllllllllllllgo', 'olmmmmmmmmmmmmdo', 'olmllllllllllmdo',
      'olmlmmmmmmmmmmdo', 'olmlmmmmmmmmmmdo', 'olmlmmmmmmmmmmdo', 'olmlmmmmmmmmmmdo',
      'olmlmmmmmmmmmmdo', 'olmlmmmmmmmmmmdo', 'olmlmmmmmmmmmmdo', 'olmlmmmmmmmmmmdo',
      'olmlmmmmmmmmmmdo', 'olmdddddddddddgo', 'odddddddddddddgo', 'oooooooooooooooo',
    ] },

    // ---- one-way ledges: drop down, never climb back --------------------------------
    { id: 'dun-ledge-down', name: 'Ledge (drop down)', group: 'cave', solid: false, ledge: 'down', palette: { o: '#0e1018', l: '#8c93ad', d: '#3a3e50' }, rows: [
      'oooooooooooooooo', 'llllllllllllllll', 'llllllllllllllll', 'dddddddddddddddd',
      'dddddddddddddddd', 'oooooooooooooooo', '................', '................',
      '................', '................', '................', '................',
      '................', '................', '................', '................',
    ] },
    { id: 'dun-ledge-left', name: 'Ledge (drop left)', group: 'cave', solid: false, ledge: 'left', palette: { o: '#0e1018', l: '#8c93ad', d: '#3a3e50' }, rows: Array.from({ length: 16 }, () => 'olldd o.........'.replace(' ', 'o')) },
    { id: 'dun-ledge-right', name: 'Ledge (drop right)', group: 'cave', solid: false, ledge: 'right', palette: { o: '#0e1018', l: '#8c93ad', d: '#3a3e50' }, rows: Array.from({ length: 16 }, () => '.........o ddllo'.replace(' ', 'o')) },

    // ---- stairs between floors ---------------------------------------------------------
    { id: 'dun-stairs-down', name: 'Stairs down', group: 'cave', solid: false, palette: { o: '#12131a', a: '#565c72', b: '#3f4457', k: '#0b0c12' }, rows: [
      'oooooooooooooooo', 'oaaaaaaaaaaaaaao', 'obbbbbbbbbbbbbbo', 'oooooooooooooooo',
      'oaaaaaaaaaaaaaao', 'obbbbbbbbbbbbbbo', 'oooooooooooooooo', 'okaaaaaaaaaaaako',
      'okbbbbbbbbbbbbko', 'okoooooooooooeko'.replace('e', 'o'), 'okkaaaaaaaaaakko', 'okkbbbbbbbbbbkko',
      'okkkoooooooookko', 'okkkkkkkkkkkkkko', 'okkkkkkkkkkkkkko', 'oooooooooooooooo',
    ] },
    { id: 'dun-stairs-up', name: 'Stairs up', group: 'cave', solid: false, palette: { o: '#12131a', a: '#6b7188', b: '#4a4f63', k: '#2b2e3b' }, rows: [
      'oooooooooooooooo', 'okkkkkkkkkkkkkko', 'okkkoooooooookko', 'okkbbbbbbbbbbkko',
      'okkaaaaaaaaaakko', 'okoooooooooooooo'.slice(0, 16), 'okbbbbbbbbbbbbko', 'okaaaaaaaaaaaako',
      'oooooooooooooooo', 'obbbbbbbbbbbbbbo', 'oaaaaaaaaaaaaaao', 'oooooooooooooooo',
      'obbbbbbbbbbbbbbo', 'oaaaaaaaaaaaaaao', 'obbbbbbbbbbbbbbo', 'oooooooooooooooo',
    ] },

    // ---- a wall torch: two frames, so it breathes ------------------------------------
    { id: 'dun-torch', name: 'Wall torch', group: 'cave', solid: true, animMs: 220,
      palette: { o: '#1b1d26', s: '#6b472a', w: '#8a5f36', f: '#ff9a3c', g: '#ffd27a', r: '#d8541e' }, frames: [
        ['................', '.......gg.......', '......gffg......', '......gffg......',
          '.....rffffr.....', '.....rffffr.....', '......rffr......', '.......rr.......',
          '......owwo......', '......oswo......', '......oswo......', '......osso......',
          '......oooo......', '................', '................', '................'],
        ['................', '................', '.......gg.......', '......gffg......',
          '......rffr......', '.....rffffr.....', '......rffr......', '.......rr.......',
          '......owwo......', '......oswo......', '......oswo......', '......osso......',
          '......oooo......', '................', '................', '................'],
      ] },
  ];

  const ICONS = [
    { id: 'dun-key', name: 'Key', group: 'dungeon', w: 16, h: 16,
      palette: { o: '#3a2a10', k: '#e8c060', h: '#fff0b0', d: '#b08830' }, rows: [
        '....oooo........', '...ohhhko.......', '..ohkddkho......', '..okd..dko......',
        '..okd..dko......', '..ohkddkho......', '...ohkkho.......', '....okko........',
        '.....okko.......', '......okko......', '.......okko.....', '........okkoo...',
        '.........okkho..', '.........okdko..', '..........okko..', '...........oo...',
      ] },
    { id: 'dun-torch-icon', name: 'Torch', group: 'dungeon', w: 16, h: 16,
      palette: { o: '#1b1d26', s: '#6b472a', f: '#ff9a3c', g: '#ffd27a' }, rows: [
        '................', '.......gg.......', '......gffg......', '......gffg......',
        '.....offffo.....', '......offo......', '.......oo.......', '.......ss.......',
        '.......ss.......', '.......ss.......', '.......ss.......', '.......ss.......',
        '.......ss.......', '.......ss.......', '......osso......', '................',
      ] },
  ];

  let done = false;
  /** registerArt() — idempotent; called by registerAll(). */
  D.registerArt = function () {
    if (done) return;
    done = true;
    const tiles = KIT.registry('tiles');
    for (const t of TILES) tiles.add(Object.assign({ w: 16, h: 16, replace: tiles.has(t.id) }, t));
    const icons = KIT.registry('icons');
    for (const i of ICONS) icons.add(Object.assign({ replace: icons.has(i.id) }, i));
    // A three-wide alcove the author can stamp straight into a wall.
    if (typeof KIT.registry('tiles').stamps !== 'undefined') {
      const all = tiles.stamps = tiles.stamps || [];
      const stamp = { id: 'dun-alcove', name: 'Torch alcove', group: 'cave', tiles: [['dun-wall', 'dun-torch', 'dun-wall']] };
      const i = all.findIndex(s => s.id === stamp.id);
      if (i >= 0) all[i] = stamp; else all.push(stamp);
    }
  };
  D.TILE_IDS = TILES.map(t => t.id);
  D.ICON_IDS = ICONS.map(i => i.id);

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
