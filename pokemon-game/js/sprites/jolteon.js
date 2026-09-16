// One portrait, as pixel rows. Wrapped like every other file in the repo so it
// loads the same in a page and in Node.
(function (root) {
  const PKMN = root.PKMN = root.PKMN || {};
  PKMN.SPRITES = PKMN.SPRITES || {};
  PKMN.SPRITES.jolteon = {
    size: 32,
    palette: { k: '#5c4410', y: '#f8d830', Y: '#fff490', d: '#d8a020', w: '#ffffff', W: '#d0d0c8', e: '#101010' },
    rows: [
      '..................k.............',
      '.................kyk......k.....',
      '.................kyyk....kyk....',
      '................kYyyk....kyyk...',
      '................kYyyyk..kyyddk..',
      '...............kYyyyyk..kyyddk..',
      '...............kYyyyyykkkyyyddk.',
      '..............kYyyyyyyyyyyyyyyk.',
      '..............kyyyyyyyyyyyyyyyyk',
      '...........k.kyyyyyyyyyyyyyyyyyk',
      '..........kykkyyyyyyyyyyyykkyyyk',
      '..........kyyyyyyyyyyyyyykewyyyk',
      '...........kyyyyyyyyyyyyykeeyyyk',
      '......k.....kyyyyyyyyyyyyykkyyyk',
      '.....kyk...kkyyyyyyyyyyyyyyyyykk',
      '....kyyykkkwwkyyyyyyyyyyyyyykkk.',
      '...kyyyyykwwwwkyyyyyyyyyyyykk...',
      '..kyyyyyykwwwwwkkyyyyyyyykkw....',
      '..kyyyyyyykWwwwwwkkkkkkkkwwwk...',
      '.kyyyyyyyyykWwwwwwwwwwwwwwwwk...',
      '.kdyyyyyyyyykWWwwwwwwwwwwwwk....',
      '.kdyyyyyyyyyykWWWwwwwwwwkwk.....',
      '.kddyyyyyyyyyyykWWWwwwkkkkk.....',
      '..kddyyyyyyyyyyykkkWkk..........',
      '..kdddyyyyyyyyyyyyykk...........',
      '...kddddyyyyyyyyyyyyk...........',
      '....kddkyyyykkyyyyyyk...........',
      '.....kk.kyyk..kyyyykk...........',
      '.......kdyk...kyykyyk...........',
      '.......kdyk...kyykdyk...........',
      '......kdyyk..kyykkdyk...........',
      '......kkkk...kkkk.kkk...........',
    ]
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PKMN;
})(typeof window !== 'undefined' ? window : globalThis);
