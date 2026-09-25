// One portrait, as pixel rows. Wrapped like every other file in the repo so it
// loads the same in a page and in Node.
(function (root) {
  const PKMN = root.PKMN = root.PKMN || {};
  PKMN.SPRITES = PKMN.SPRITES || {};
  PKMN.SPRITES.butterfree = {
    size: 32,
    palette: {
      k: '#221a3a', // near-black purple outline and wing veins
      B: '#7c74d8', // base purple-blue body
      b: '#b4acf8', // light purple highlight
      d: '#4c44a0', // shadow purple
      w: '#ffffff', // wing white, eye glint, fang
      W: '#d4d0ec', // wing shade (cell edges, far-side wings)
      r: '#e02838', // red compound eye
      R: '#ff8a8a', // eye light
      q: '#8c1428', // eye dark facets
      c: '#8cd0f0', // light blue hands and feet
    },
    rows: [
      '...............k................', // 0
      '...kkkkkkk......kk.....kk.kkkkk.', // 1
      '.kkwwwwwwwkk......k....k.kwwWWWk', // 2
      'kwwkwwwwwwwWk......k..k..kwwWkWk', // 3
      'kwwwkwwwwwwwWk.....kkkkkkkwWkWWk', // 4
      'kwwwwkwwwwwwWk...kkbbbbbbkkkWWWk', // 5
      'kwwwwwkwwwwwwWk.kbbbbBBBBBBkWWWk', // 6
      'kwwwwwwkwwwwwWkkbkkkkBBBBkkkkWWk', // 7
      'kwwwwwwwkwwwwWkBkwwRrkBBkwRrrkWk', // 8
      'kWWwwwwwwkwwWkkBkwRrrkBBkRrqrkk.', // 9
      'kkkWWWwwwwkwWkkBkRrqrkBBkrqrqk..', // 10
      'kwwkkkWWWwwkWkkBkrqrqkBBkrrqqk..', // 11
      'kwwwwwkkkWWWkkkdkqrqqkBBkqrqk...', // 12
      '.kwwwwwwwkkkWkkddkkkkBBBBkkkk...', // 13
      '..kwwwwWWWWWkkkkdBBBBBkwkBBk....', // 14
      '...kkWWWWWWWWkkkkdddddddddk.....', // 15
      '.....kkkkkkkkkkdBkkkkkkkkk......', // 16
      '..kkkwwwwwwwwwwkBbbbbBBkkk......', // 17
      '.kwwwwwwwwwwwwkBbbbBBBBdcckkkk..', // 18
      '.kwwwwwwwwwwwkkBbbBBBBBdcckwwwk.', // 19
      '.kwwwwwwwwwwkWkBbBBBBBdkkkwwwwwk', // 20
      '.kwwwwwwwwwkwwkBBBBBBBddcckkwwwk', // 21
      '.kwwwwwwwwkwwkWkdBBBBdddcckwkWWk', // 22
      '.kwwwwwwwkwwwkWWkdddddkkkkwwwkWk', // 23
      '..kwwwwwkwwwkWWkkcckcckwwwwWWkk.', // 24
      '..kwwwwkwwwwkWWk.kk.kkkwwwwWWWk.', // 25
      '...kwwkwwwwkWWk.......kwwwWWWk..', // 26
      '...kwkwwwwwkWWk........kwWWWk...', // 27
      '....kwwwwwkwWWk.........kkkk....', // 28
      '.....kwwwwkWWk..................', // 29
      '......kkwkWWWk..................', // 30
      '........kkkkk...................', // 31
    ]
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PKMN;
})(typeof window !== 'undefined' ? window : globalThis);
