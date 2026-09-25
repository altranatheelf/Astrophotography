// One portrait, as pixel rows. Wrapped like every other file in the repo so it
// loads the same in a page and in Node.
(function (root) {
  const PKMN = root.PKMN = root.PKMN || {};
  PKMN.SPRITES = PKMN.SPRITES || {};
  PKMN.SPRITES.pikachu = {
    size: 32,
    palette: {
      k: '#4a3212', // dark brown outline
      y: '#f8d030', // base yellow
      Y: '#fff28a', // light yellow highlight
      d: '#d8a018', // shadow yellow
      b: '#8c5a1c', // brown back stripes / tail base
      r: '#e8402c', // red cheeks
      e: '#141414', // eyes / ear tips
      w: '#ffffff', // eye highlight
    },
    rows: [
      '...........kk................kk.', // 0
      '...........kek..............kek.', // 1
      '...........keek............keek.', // 2
      '...........keeek..........keeek.', // 3
      '.kkkkk......kYydk........kyydk..', // 4
      'kYYYydk.....kYyydk......kyyydk..', // 5
      'kYYyyydk.....kYyydk....kyyydk...', // 6
      '.kYyyyydk....kYyyyykkkkyyyyyk...', // 7
      '..kyyyyydk...kYYYyyyyyyyyyyyyk..', // 8
      '...kyyyyydk.kYYyyyyyyyyyyyyyyyk.', // 9
      'kkkkkyyydk.kYyyyyyyyyyyyyyyyyyk.', // 10
      'kYyyyyydk..kyyyyyyweyyyyyweyyyk.', // 11
      '.kyyydkkk..kyyyyyyeeyyyyyeeyyyk.', // 12
      '..kyyydk...kyyyyyyeeyyyyyeeyyyk.', // 13
      '...kyyydk..kyrrryyyyyyyyyyyrrrk.', // 14
      '.kkkkyyydk.kyrrrryyykykykyyrrrk.', // 15
      '.kyyyyyydk.kyrrrryyyykykyyyrrrk.', // 16
      '.kyyydkkkk..kyrryyyyyyyyyyyrrk..', // 17
      '..kyydk......kyyyyyyyyydddddk...', // 18
      '...kyydk......kkkddddddddkkk....', // 19
      '....kyydk.....kYYyyyyyyyyyyk....', // 20
      '.....kyydkkkkkYyyyyyyydddykkk...', // 21
      '......kyyybbbkyyyyyyyykYyykYyk..', // 22
      '.......kybbbbkyyyyyyyykyydkydk..', // 23
      '........kkkkkkyyyyyyyyykkkykk...', // 24
      '.............kbbbyyyyyyyyyydk...', // 25
      '.............kyyyyyyyyyyyyydk...', // 26
      '.............kbbbyyyyyyyyyydk...', // 27
      '.............kddyyyyyyyyyyydk...', // 28
      '..............kdddyykkyyyydk....', // 29
      '.............kyyyyydkkyyyyydk...', // 30
      '..............kkkkkk..kkkkkk....', // 31
    ]
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PKMN;
})(typeof window !== 'undefined' ? window : globalThis);
