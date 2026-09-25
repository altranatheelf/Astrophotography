// One portrait, as pixel rows. Wrapped like every other file in the repo so it
// loads the same in a page and in Node.
(function (root) {
  const PKMN = root.PKMN = root.PKMN || {};
  PKMN.SPRITES = PKMN.SPRITES || {};
  PKMN.SPRITES.gengar = {
    size: 32,
    palette: {
      k: '#26143a', // dark purple outline
      P: '#6e4ea0', // base purple
      p: '#9676c8', // light purple highlight
      d: '#4a3078', // shadow purple
      R: '#e8282c', // red eye
      w: '#ffffff', // teeth / eye highlight
    },
    rows: [
      '...k........................k...', // 0
      '..kpk......................kPk..', // 1
      '..kpPkk..................kkPPk..', // 2
      '...kpPPk....kkkkkkkk....kPPdk...', // 3
      '...kpPPPk.kkppppppppkk.kPPPdk...', // 4
      '.k..kpPPPkPppppppppppPkPPPdk....', // 5
      'kPk.kppPPPPPPPPPPPPPPPPPPPdk....', // 6
      'kPdkppPPPPPPPPPPPPPPPPPPPPdk....', // 7
      'kPddpPPPPPkkPPPPPPPPPPPPkkPdk...', // 8
      '.kddpPPPPPkRkkkPPPPPPPkkRkPdk...', // 9
      'kPkdPPPPPPkwRRRkPPPPPkwRRkPPdk..', // 10
      'kPdkPPPPPPkRRRRkPPPPPkRRRkPPdk..', // 11
      'kPddPPPPPPPkkkkkPPPPPkkkkPPPdk..', // 12
      '.kddPPPPkPPPPPPPPPPPPPPPPPkPdk..', // 13
      'kPkdPPPPkkkPPPPPPPPPPPPPkkkPdk..', // 14
      'kPdkPPPPkwwkkkkkkkkkkkkkwwkPdk..', // 15
      'kPddPPPPPkkwwkwwwkwwwkwwkkPdk...', // 16
      '.kddPPPPPPPkkkkkkkkkkkkkPPPdkkk.', // 17
      '..kdPPPPPPPkwwwkwwwkwwwkPPPdPpPk', // 18
      '.kkkPPPPPPPPkkkkkkkkkkkPPPddPPPk', // 19
      'kPPkPPPPPPPPPPPPPPPPPPPPPddkPPdk', // 20
      'kdPkPPPPPPPPPPPPPPPPPPPdddkkdkdk', // 21
      '.kdkdPPPPPPPPPPPPPPPPPPdddk.k.k.', // 22
      '..k.kdPPPPPPPPPPPPPPPPdddk......', // 23
      '.....kdPPPPPPPPPPPPPPPdddk......', // 24
      '.....kdPPPPPkkkkkPPPPPPPdk......', // 25
      '.....kdPPPPk.....kPPPPPPdk......', // 26
      '.....kdPPPPk.....kPPPPPPdk......', // 27
      '....kddPPPPk.....kPPPPPPPdk.....', // 28
      '...kdPPPPPPkk...kPPPPPPPPdkk....', // 29
      '..kdPPPPPkPkPk..kdPPPPPPkPkPk...', // 30
      '..kkkkkkkkkkkk..kkkkkkkkkkkkk...', // 31
    ]
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PKMN;
})(typeof window !== 'undefined' ? window : globalThis);
