// One portrait, as pixel rows. Wrapped like every other file in the repo so it
// loads the same in a page and in Node.
(function (root) {
  const PKMN = root.PKMN = root.PKMN || {};
  PKMN.SPRITES = PKMN.SPRITES || {};
  PKMN.SPRITES.wigglytuff = {
    size: 32,
    palette: {
      k: '#5a2440', // dark plum outline
      p: '#f4a0bc', // base pink
      P: '#fcd0de', // light pink highlight
      d: '#d06890', // shadow pink
      n: '#3c2030', // inner ear dark
      w: '#ffffff', // tuft / belly / eye highlight
      W: '#d8d0dc', // white shade
      b: '#48b0c8', // blue-green iris
      B: '#206888', // dark iris
      r: '#e04868', // mouth
    },
    rows: [
      '...kk......................kk...', // 0
      '..kPpk....................kppk..', // 1
      '..kPnpk.......kkkk.......kpnpk..', // 2
      '..kPnnpk....kkwwwwkk....kpnnpk..', // 3
      '...kPnnpk..kwwwwwwwwk..kpnnpk...', // 4
      '...kPnnpk.kwwwwwwwwwwk.kpnnpk...', // 5
      '....kPnnpkwwwwwwWWWwwwkpnnpk....', // 6
      '....kPnnpkwwwwwWwwwWwwkpnnpk....', // 7
      '.....kPnnpkwwwwWwWwWWkpnnpk.....', // 8
      '.......kPpkWwwwWwWWWWkppk.......', // 9
      '......kPPppkWWkWWWkWWkppdk......', // 10
      '.....kPpppppkkpkkkpkkppppdk.....', // 11
      '.....kPpppkkkkpppppppkkkpdk.....', // 12
      '....kPpppkwwBBkpppppkwwBkpdk....', // 13
      '....kPpppkwwBBkpppppkwBBkpdk....', // 14
      '....kppppkBBBbkpppppkBBbkpdk....', // 15
      '...kPppppkbbbbkpppppkbbbkppdk...', // 16
      '...kpppppkbbbwkpppppkbbwkpddk...', // 17
      '.kkkppppppkkkkpppppppkkkpppdkkk.', // 18
      '.kPpppppppppppppkkkppppppppdddk.', // 19
      '.kppppppppppppppkrkppppppppdddk.', // 20
      '..kkkppppppppppppkppppppppdkkk..', // 21
      '...kpppppppppwwwwwwwwwpppdddk...', // 22
      '...kpppppppwwwwwwwwwwwwwpdddk...', // 23
      '...kppppppwwwwwwwwwwwwwwWdddk...', // 24
      '....kdppppwwwwwwwwwwwwWWWddk....', // 25
      '....kddppppwwwwwwwwwwWWWdddk....', // 26
      '.....kddppppwwwwwwWWWWWdddk.....', // 27
      '......kddpppppWWWWWWWpdddk......', // 28
      '.....kppppppkkkkkkkkppppddk.....', // 29
      '.....kdppppdk......kppppddk.....', // 30
      '......kkkkkk........kkkkkk......', // 31
    ]
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PKMN;
})(typeof window !== 'undefined' ? window : globalThis);
