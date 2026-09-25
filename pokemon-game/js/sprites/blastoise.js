// One portrait, as pixel rows. Wrapped like every other file in the repo so it
// loads the same in a page and in Node.
(function (root) {
  const PKMN = root.PKMN = root.PKMN || {};
  PKMN.SPRITES = PKMN.SPRITES || {};
  PKMN.SPRITES.blastoise = {
    size: 32,
    palette: {
      k: '#182c58', // dark navy outline
      b: '#98c4f8', // light blue highlight
      B: '#5c90e0', // base blue
      d: '#3862b0', // shadow blue
      s: '#c88a50', // shell light brown
      S: '#9a5e30', // shell brown
      D: '#6a3c1c', // shell shadow
      c: '#f8f0c8', // cream rim / belly
      C: '#d8c488', // cream shade / plate lines
      G: '#e0e6ee', // cannon light
      g: '#a8b2c0', // cannon grey
      m: '#6a7486', // cannon shadow
      e: '#101018', // pupil / cannon bore
      w: '#ffffff', // eye highlight / claws
    },
    rows: [
      '................................', // 0
      '..kkkk..........................', // 1
      '.kmeemk..................kkkk...', // 2
      '.kgeegk.....k........k..kmeemk..', // 3
      '.kGggmk....kbk......kBk.kgeegk..', // 4
      '..kGggmk...kbBkkkkkkBdkkkGggmk..', // 5
      '..kGggmk..kbbbbbbbbbbBBdkGggmk..', // 6
      '..kGggmk..kbBkkkBBBBkkkdkGggmk..', // 7
      '...kGggmk.kbBkweBBBBkwedkGggmk..', // 8
      '...kGggmkkkBBkweBBBBkweBdkggmk..', // 9
      '.kkkGggmkSkBBBBBkBBBBBBBBdkgmk..', // 10
      '.ksSkkkkSckdBBBBBkkkkkkkBdkkkSk.', // 11
      '.ksSckkkkkckdBBBBBBBBBBBdkcSSDk.', // 12
      'ksSckbbBBdkcckkkkkkkkkkkkkkcSDk.', // 13
      'ksSckbBBBdkcccccccccccCkBdkcSDk.', // 14
      'ksSckbBBBdkCCCCCCCCCCCCkBdkcSSDk', // 15
      'ksSckBBBBdkcccccccccccCkBdkcSSDk', // 16
      'ksSSckBBBdkcccccccccccCkBdkcSSDk', // 17
      'ksSSckBBBdkCCCCCCCCCCCCkBdkcSSDk', // 18
      'ksSkbBBBBBBdkcccccccccCkBBdkSSDk', // 19
      'ksSkBBBBBBBdkcccccccccCkBBdkSSDk', // 20
      'ksSkdBBBBBddkCCCCCCCCCCkBddkSSDk', // 21
      'ksSSckwkwkwkkccccccccCkkwkwkSDk.', // 22
      '.ksSSSckbBBBdkcccccccCkBBdkcSDk.', // 23
      '..kSSSckBBBBdkCCCCCCCCkBBdkcSDk.', // 24
      '...kSSckBBBBdkkccccCkkBBBdkDDk..', // 25
      '....kkbBBBBBBdkkkkkkbBBBBdkkk...', // 26
      '.....kbBBBBBBdk....kBBBBBdk.....', // 27
      '.....kBBBBBBBdk....kBBBBBdk.....', // 28
      '....kbBBBBBBBBdk..kbBBBBBdk.....', // 29
      '....kwBwBwBBBBdk..kwBwBwBdk.....', // 30
      '....kkkkkkkkkkkk..kkkkkkkkk.....', // 31
    ]
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PKMN;
})(typeof window !== 'undefined' ? window : globalThis);
