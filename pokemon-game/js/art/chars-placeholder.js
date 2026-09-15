// Placeholder characters. Real pixel art can replace any of these later by
// registering the same id from another file (the registry replaces by id).
// Each one is generated here from a few colours: a big head, a body, two legs
// that alternate, and a back view with no face — enough to read as a person and
// to animate while the real art is drawn.
(function (root) {
  const KIT = root.KIT;
  if (!KIT || !KIT.registry) return;
  const reg = KIT.registry('sprites');

  const W = 16, H = 24;
  // '.' transparent, 'o' outline, 's' skin, 'h' hair, 'b' body, 'p' legs, 'e' eye, 'w' white
  const BASE = [
    '................', '.....oooooo.....', '....ohhhhhho....', '...ohhhhhhhho...',
    '...ohhhhhhhho...', '...osssssssso...', '...osesssseso...', '...osssssssso...',
    '...osssssssso...', '....oossssoo....', '......oooo......', '....obbbbbbo....',
    '...obbbbbbbbo...', '...obbbbbbbbo...', '...obbbbbbbbo...', '...obbbbbbbbo...',
    '...osbbbbbbso...', '....obbbbbbo....', '.....oppppo.....', '.....oppppo.....',
    '.....op..po.....', '....oppo.oppo...', '....oooo.oooo...', '................',
  ];
  const clone = (rows) => rows.slice();
  const put = (rows, y, x, ch) => { const r = rows[y].split(''); r[x] = ch; rows[y] = r.join(''); };

  function frames(kind) {
    const stand = clone(BASE);
    if (kind === 'up') { for (const y of [6]) stand[y] = '...osssssssso...'; for (const y of [3, 4, 5, 6, 7, 8]) stand[y] = stand[y].replace(/s/g, 'h'); }
    if (kind === 'left') { put(stand, 6, 9, 's'); put(stand, 6, 10, 'e'); put(stand, 6, 4, 's'); put(stand, 6, 5, 's'); }
    const a = clone(stand), b = clone(stand);
    // step A: left leg forward, step B: right leg forward (and a 1px head bob)
    a[21] = '....oppo..oo....'; a[22] = '....oooo..oo....';
    b[21] = '....oo..oppo....'; b[22] = '....oo..oooo....';
    return [stand, a, b];
  }

  function character(id, name, group, colors) {
    const palette = { o: colors.outline || '#3a2a20', s: colors.skin || '#f8d0b0', h: colors.hair || '#5a3a1a', b: colors.shirt || '#e04040', p: colors.pants || '#3060c0', e: '#241a16', w: '#ffffff' };
    return { id, name, group: group || 'npc', w: W, h: H, palette, placeholder: true,
      frames: { down: frames('down'), up: frames('up'), left: frames('left') } };
  }

  const PEOPLE = [
    ['hero-boy', 'Hero (boy)', 'hero', { hair: '#5a3a1a', shirt: '#e04040', pants: '#3060c0' }],
    ['hero-girl', 'Hero (girl)', 'hero', { hair: '#7a4a28', shirt: '#68c0e8', pants: '#e06098' }],
    ['kid-boy', 'Kid (boy)', 'npc', { hair: '#241a16', shirt: '#58b848', pants: '#8a6a40' }],
    ['kid-girl', 'Kid (girl)', 'npc', { hair: '#f0d070', shirt: '#f08ab8', pants: '#f08ab8' }],
    ['woman', 'Woman', 'npc', { hair: '#6a4426', shirt: '#f8d878', pants: '#c06030' }],
    ['man', 'Man', 'npc', { hair: '#30241c', shirt: '#4878c0', pants: '#a08858' }],
    ['grandma', 'Grandma', 'npc', { hair: '#d8d8e0', shirt: '#a878c8', pants: '#786090' }],
    ['grandpa', 'Grandpa', 'npc', { hair: '#d8d8e0', shirt: '#8a6a40', pants: '#5a4a38' }],
    ['professor', 'Professor', 'npc', { hair: '#9a9a9a', shirt: '#f0f0f0', pants: '#585868' }],
    ['nurse', 'Nurse', 'npc', { hair: '#f090b0', shirt: '#ffffff', pants: '#f0a0c0' }],
    ['clerk', 'Clerk', 'npc', { hair: '#3a2a20', shirt: '#3a70b8', pants: '#2a4a78' }],
    ['trainer', 'Trainer', 'npc', { hair: '#d85030', shirt: '#303040', pants: '#487848' }],
  ];
  for (const [id, name, group, colors] of PEOPLE) if (!reg.has(id) || (reg.get(id) || {}).placeholder) reg.add(Object.assign(character(id, name, group, colors), { replace: true }));

  // A pokéball on a stand: a small round marker used for objects that are not people.
  if (!reg.has('pokeball')) reg.add({ id: 'pokeball', name: 'Poké Ball', group: 'object', w: 16, h: 24, placeholder: true,
    palette: { o: '#3a2a20', r: '#e04040', w: '#f8f8f8', k: '#585868' },
    frames: (function () {
      const empty = '................';
      const rows = [];
      for (let i = 0; i < 24; i++) rows.push(empty);
      const art = ['.....oooooo.....', '....orrrrrro....', '...orrrrrrrro...', '...orrrrrrrro...', '...ooookkoooo...', '...owwwkkwwwo...', '...owwwwwwwwo...', '....owwwwwwo....', '.....oooooo.....'];
      for (let i = 0; i < art.length; i++) rows[13 + i] = art[i];
      const one = rows.slice();
      return { down: [one, one, one], up: [one, one, one], left: [one, one, one] };
    })() });

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
