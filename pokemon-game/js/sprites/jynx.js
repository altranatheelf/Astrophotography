// One portrait, as pixel rows. Wrapped like every other file in the repo so it
// loads the same in a page and in Node.
(function (root) {
  const PKMN = root.PKMN = root.PKMN || {};
  PKMN.SPRITES = PKMN.SPRITES || {};
  PKMN.SPRITES.jynx = {
    size: 32,
    palette: {
      h: '#7a5410', // hair outline (dark blonde)
      d: '#d0a020', // hair shade
      y: '#f8d848', // hair base blonde
      Y: '#fff8a8', // hair / gold highlight
      q: '#2c1440', // face outline (very dark purple)
      p: '#6a3c90', // face base purple
      P: '#8e5cb4', // face light purple
      W: '#f0ecff', // eye sclera
      e: '#141020', // pupil
      w: '#ffffff', // eye highlight
      m: '#b8386c', // lip outline
      n: '#e06898', // lip shade
      l: '#f890c0', // lip base pink
      L: '#ffc4dc', // lip highlight
      k: '#5c0c14', // dress outline (dark red)
      s: '#a81c24', // dress shade
      r: '#e83c3c', // dress base red
      R: '#f87070', // dress light
      G: '#a87810', // gold outline / shade
      g: '#f8c840', // gold base (chest plate, hands)
    },
    rows: [
      '................................', // 0
      '..........hhhhhhhhhh............', // 1
      '........hhyYYYYyyyyyhh..........', // 2
      '.......hyYYYYYyyyyyyyyh.........', // 3
      '......hyYYYYyyyyyyyyyyyh........', // 4
      '.....hyYYYyyyyyyyyyyyyyyh.......', // 5
      '....hyYYyyyyyyqqqqqqqyyyh.......', // 6
      '...hyyyyyyyyyqPPpppppqyyh.......', // 7
      '..hyyyyyyyyyqPpWWppWWWqydh......', // 8
      '..hyyyyyyyddqPpWeppWweqydh......', // 9
      '.hyyyyyyyyddqppWeppWeeqydh......', // 10
      '.hyyyyyyyyddqppppppppmmmmmm.....', // 11
      '.hyyyydyyyddqpppppppmLLllllm....', // 12
      '..hyyydyyyddqppppppmLlllllllm...', // 13
      '..hyyydyyyddqppppppmlmmmmmmlm...', // 14
      '.hyyyydyyyddqppppppmlllllnnnm...', // 15
      '.hyyyydyyyddqpppppppmnnnnnnm....', // 16
      '.hyyyydyyyddqppppppppmmmmmm.....', // 17
      '..hyyydyyyddhqppppppq...........', // 18
      '..hyyydyyyddhGGGGGGGGGGkkkGGG...', // 19
      '.hyyyydyyyddhGYgggggggGkRGYggG..', // 20
      '.hyyyydyyyddhGggggggggGrrGggggG.', // 21
      '.hyyyydyyyddhGGGGGGGGGGrsGggggG.', // 22
      '.hyyyyddyddhRRrrrrrrrrrkkGgggG..', // 23
      '.hyyhhyyhhdhRRRrrrrrrrrrk.GGG...', // 24
      '..hh..hhkRhRRRrrrrrrrrrrrk......', // 25
      '.......kRRrrrrrrrrrrrrrssk......', // 26
      '......kRRrrrrrrrrrrrrrssssk.....', // 27
      '.....kRRrrrrrrrrrrrrrsssssk.....', // 28
      '....kRrrrrrrrrrrrrrrsssssssk....', // 29
      '....krrrrssssssssssssssssssk....', // 30
      '....kkkkkkkkkkkkkkkkkkkkkkkk....', // 31
    ],
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PKMN;
})(typeof window !== 'undefined' ? window : globalThis);
