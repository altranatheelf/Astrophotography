// One portrait, as pixel rows. Wrapped like every other file in the repo so it
// loads the same in a page and in Node.
(function (root) {
  const PKMN = root.PKMN = root.PKMN || {};
  PKMN.SPRITES = PKMN.SPRITES || {};
  PKMN.SPRITES.machamp = {
    size: 32,
    palette: { k: '#24364f', d: '#4b6b92', B: '#6e92bd', b: '#9dbce0', n: '#1f1f2b', N: '#3a3a4d', y: '#f4c842', Y: '#a8771a', t: '#eedfa8', T: '#b89a58', r: '#e03a3a', e: '#141414', w: '#ffffff' },
    rows: [
      '............k...k...k...........',
      '...........kbk.kbk.kbk..........',
      '..kkkk.....kbbkbbbkbbk...kkkkk..',
      '.kbbbBk....kbbbbbbbBBk..kbbbbBk.',
      '.kbBkBk....kbbkkbbkkBk..kbBkBBk.',
      '.kBBBdk....kbbwrbBwrBk..kBBBBdk.',
      '..kBBdk....kbBreBBreBk...kBBBdk.',
      '..kBBdk....kbBBBtttttk...kBBBdk.',
      '..kBBdk.kk.kBBBBTTTTTk.kk.kBBBdk',
      '..kBBdkkbbk.kkkkkkkkk.kbbkkBBBdk',
      '..kBBBBBbBkkbbbbbbBBBkkBbBBBBBdk',
      '..kBBBBBBBkbbbbbbbBBBBkBBBBBBBdk',
      '..kdddddddkbbbbbbBBBBBkdddddddk.',
      '...kkkkkkkkbbbbbBBBBBBkkkkkkkk..',
      '..........kbbbBBBBBBBBk.........',
      '......kkkkkbbbBBBBBBBBkkkkk.....',
      '.....kbbBBkbbBBBBBBBBBkBBBBbk...',
      '....kbbBBBkBBBBBBBBBBBkBBBBBbk..',
      '...kbbBBBdkBBBBBBBBBBBkdBBBBBbk.',
      '..kkBBBBdkkBBBBBBBBBBBkkdBBBBkk.',
      '..kBBBBdk.kyyyyyyyyyyyyk.kdBBBk.',
      '..kBBBBk..kYYYYYYYYYwYYk..kBBBk.',
      '...kkkk...knnnnnnnnnnnnk...kkkk.',
      '..........kNNnnnnnnnnnnk........',
      '..........knnnnnnnnnnnnk........',
      '.........kdBBBkkkbbBBBBk........',
      '.........kdBBBk.kbbBBBBk........',
      '.........kdBBBk.kbbBBBBk........',
      '.........kdBBBk.kbbBBBBk........',
      '........kkdBBBk.kbbBBBBkk.......',
      '........kdBBBBk.kbbBBBBBBk......',
      '........kkkkkkk.kkkkkkkkkk......',
    ]
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PKMN;
})(typeof window !== 'undefined' ? window : globalThis);
