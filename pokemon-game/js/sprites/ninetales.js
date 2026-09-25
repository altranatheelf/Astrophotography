// One portrait, as pixel rows. Wrapped like every other file in the repo so it
// loads the same in a page and in Node.
(function (root) {
  const PKMN = root.PKMN = root.PKMN || {};
  PKMN.SPRITES = PKMN.SPRITES || {};
  PKMN.SPRITES.ninetales = {
    size: 32,
    palette: {
      k: '#6a4818', // dark brown outline
      c: '#f6dfa0', // cream-gold base
      C: '#fff6d6', // light cream highlight
      d: '#d4b064', // gold shade
      o: '#f59a3a', // orange tail tip
      O: '#d0661e', // dark orange tip shade
      r: '#d82020', // red eye
      w: '#ffffff', // eye highlight
    },
    rows: [
      '.......k...k....................', // 0
      '...k..kok.kokk....k.............', // 1
      '.kkokkooOkoOkok..kCk.kk.....k...', // 2
      'kokOkkoooOkkooOk.kCdkCCk...kck..', // 3
      'kookkooooOkoooOkkCcdkCcck.kcdk..', // 4
      'kooOkOcccdkOOcdkkCcddkCcckccddk.', // 5
      'kOccdkCccdkCccdkkCcddcCccccddck.', // 6
      'kCccdkCccdkCccdkCCccccccccccck..', // 7
      'kCcccdkCcdkCccdkcccccccccccccck.', // 8
      '.kCccdkCcdkccddkcccccckkkcccccck', // 9
      'kkkCcdkccdkccddkccccckrrwkccccck', // 10
      'kokccddkcdkccddkcccccckrrkccckk.', // 11
      'kookcddkcdkcdddkccccccckkccck...', // 12
      'kOoOkcddkckcddkcccdddddddddk....', // 13
      '.kOcckcddcdcdkccccCCCCCccck.....', // 14
      '..kccddcdcdckccccdCCccccCcck....', // 15
      '.kokcddcddkkCccccdCCcccddkk.....', // 16
      'kooOckcdkkCccccccdCCCCcccck.....', // 17
      'kOocCcdkCCcccccccdcCCcddkk......', // 18
      '.kOccdkcCccccccccddCCcck........', // 19
      '..kkdkdcCcccdccccddCckk.........', // 20
      '.....kdccCccdkcccddkCck.........', // 21
      '.....kdccccdkdddkddkCck.........', // 22
      '......kccdkddkkkkddkCck.........', // 23
      '.......kcdkddk..kddkCck.........', // 24
      '.......kcdkddk..kddkCck.........', // 25
      '.......kcdkddk..kddkCck.........', // 26
      '.......kcdkddk..kddkCck.........', // 27
      '.......kcdkddk..kddkCck.........', // 28
      '.......kcdkddk..kddkCck.........', // 29
      '......kCcckdddkkdddkCcck........', // 30
      '......kkkkkkkkkkkkkkkkkk........', // 31
    ]
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PKMN;
})(typeof window !== 'undefined' ? window : globalThis);
