// One portrait, as pixel rows. Wrapped like every other file in the repo so it
// loads the same in a page and in Node.
(function (root) {
  const PKMN = root.PKMN = root.PKMN || {};
  PKMN.SPRITES = PKMN.SPRITES || {};
  PKMN.SPRITES.clefable = {
    size: 32,
    palette: {
      k: '#6b2d45', // dark plum outline
      P: '#f7b5c6', // base pink
      p: '#fde0e8', // light pink highlight
      d: '#dc8aa3', // shadow pink
      n: '#7a4a2a', // brown ear tips
      v: '#fff0f5', // pale wing
      V: '#f0bccd', // wing fold
      e: '#3a1f2a', // eye
      w: '#ffffff', // eye highlight
      r: '#e0506c', // open mouth
    },
    rows: [
      '.....k....................k.....', // 0
      '....knk.......kkk........knk....', // 1
      '....knnk.....kpPPk......knnk....', // 2
      '....knnnk...kPkkPk.....knnnk....', // 3
      '....knnnnk..kk.kPk....knnnnk....', // 4
      '.....knnPPk....kPk...kPPnnk.....', // 5
      '.....kpPPPPkkkkkPkkkkPPPPdk.....', // 6
      '......kppPPPPPPPPPPPPPPPPdk.....', // 7
      '......kpPPPPPPPPPPPPPPPPPPdk....', // 8
      '......kpPPPPPPPPPPPPPPPPPPdk....', // 9
      '......kpPPPPPPPPewPPPPewPPdk....', // 10
      '..kk..kpPPPPPPPPeePPPPeePPdk....', // 11
      '.kvvk.kPPPPPPPPPeePPPPeePPdk....', // 12
      'kvvvvvkPPPPPPPPPPPPPPPPPPPdk....', // 13
      'kvVvvvkPPPPPPPPPPPPkrrkPPdk.....', // 14
      'kvvVvvkdPPPPPPPPPPPPkkPPdk......', // 15
      '.kkvVvkdPPPPPPPPPddddddk........', // 16
      '.kvvvVkPPPPPPPPPPPPPPPkkkk......', // 17
      '..kkvVkppPPPPPPPPPPPPPPPPPk.....', // 18
      '...kkkpppPPPPPPPPPPPPkPPddk.....', // 19
      '..kpPPppPPPPPPPPPPPPPPkkkk......', // 20
      '.kpPPkpPPPPPPPPPPPPPPdddddk.....', // 21
      '.kPdkPPPPPPPPPPPPPPPPPPPdddk....', // 22
      '..kkkPPPPPPPPPPPPPPPPPPPdddk....', // 23
      '...kdPPPPPPPPPPPPPPPPPPPdddk....', // 24
      '...kdPPPPPPPPPPPPPPPPPPddddk....', // 25
      '....kddPPPPPPPPPPPPPPPPdddk.....', // 26
      '.....kddPPPPPPPPPPPPPPdddk......', // 27
      '.....kdPPPPdkkkPPPPPPPddk.......', // 28
      '....kdPPPPPPdk.kPPPPPPPPddk.....', // 29
      '....kdPPPPPPPdkkdPPPPPPPddk.....', // 30
      '.....kkkkkkkkk..kkkkkkkkkk......', // 31
    ]
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PKMN;
})(typeof window !== 'undefined' ? window : globalThis);
