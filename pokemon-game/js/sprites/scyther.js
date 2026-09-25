// One portrait, as pixel rows. Wrapped like every other file in the repo so it
// loads the same in a page and in Node.
(function (root) {
  const PKMN = root.PKMN = root.PKMN || {};
  PKMN.SPRITES = PKMN.SPRITES || {};
  PKMN.SPRITES.scyther = {
    size: 32,
    palette: {
      k: '#1f4a24', // dark green outline
      G: '#6cc04a', // base green
      g: '#a6e070', // light green highlight
      d: '#3e8a38', // shadow green (far limbs, back)
      c: '#f6eab8', // cream belly plates
      C: '#cfb880', // cream segment lines
      s: '#f2f2de', // scythe blade
      S: '#b4b8a0', // scythe shade / far blade
      W: '#e6f6f2', // pale wing
      V: '#a8d0c8', // wing shade
      e: '#101010', // pupil
      w: '#ffffff', // eye white / claws
    },
    rows: [
      'kk.......kkkkk..........kk......', // 0
      'ksk......kggggkkk........kkkk...', // 1
      'kSsk......kdGGgggkkkkk....kssk..', // 2
      '.kSsk......kkdGGGggggGkk..kssk..', // 3
      '.kSSsk.......kkkGGGGGGGGk.ksssk.', // 4
      '.kSSSsk........kGGGkkkkkGkkSsssk', // 5
      '..kSSSsk.......kdGGkwweeGkkSsssk', // 6
      '..kkSSSSkk.....kdGGGkweeGkkSsssk', // 7
      '....kkSSSskk....kdGGGkkkGkkSsssk', // 8
      '......kkSSSkk....kddGGGGk.kSsssk', // 9
      '........kkkkdk..kGGkkkkk..kSsssk', // 10
      '.kkk.......kddk.kGGGk.....kSsssk', // 11
      'kWWWkkkk....kdkkGgGGGkkk.kSsssk.', // 12
      'kVWWWWWWkkkk.kGGgGGGGkGGkkSssk..', // 13
      '.kVVVWWWWWWWkkGgGGGGkGgGGkSsk...', // 14
      '..kkkkVVVWWWWkGgGGGGkGGGGdkk....', // 15
      '......kkkkkkkkkGGGGGkkGddk......', // 16
      '........kkkWk.kdGGGGddkkk.......', // 17
      '.....kkkWWWWkkddcccccck.........', // 18
      '...kkWWWWWVkkddcccccccCk........', // 19
      '..kWWWWWVVkkddCCCCCCCCCk........', // 20
      '.kWWVVkkkk.kddccccccccCk........', // 21
      '.kkkkk.....kddCCCCCCCCk.........', // 22
      '............kdccccckGGGk........', // 23
      '.............kdcccCkGGGGk.......', // 24
      '............kddkkkkkkGGGGk......', // 25
      '...........kddk......kGGGGk.....', // 26
      '...........kddk......kGGdk......', // 27
      '...........kdk.......kGGdk......', // 28
      '..........kddk......kGGdkk......', // 29
      '.........kdddwk....kGGGGGwk.....', // 30
      '.........kkkkkk....kkkkkkkk.....', // 31
    ]
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PKMN;
})(typeof window !== 'undefined' ? window : globalThis);
