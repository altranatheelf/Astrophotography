// Character registry. The art lives in chars-heroes.js / chars-npcs.js which
// call PKMN.CHARS.register([...]) and PKMN.CHARS.registerRecolorable(id, {...}).
(function (root) {
  const PKMN = root.PKMN = root.PKMN || {};
  const C = PKMN.CHARS = PKMN.CHARS || { list: [], byId: {}, recolorable: {} };

  C.register = function (chars) {
    for (const c of chars) {
      if (!c || !c.id) continue;
      if (c.w == null) c.w = 16;
      if (c.h == null) c.h = 24;
      if (!c.name) c.name = c.id.replace(/-/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
      if (!c.group) c.group = 'npc';
      if (C.byId[c.id]) C.list[C.list.findIndex(x => x.id === c.id)] = c; else C.list.push(c);
      C.byId[c.id] = c;
    }
  };
  C.registerRecolorable = function (id, parts) { C.recolorable[id] = parts; };

  // Walk cycle: stand, stepA, stand, stepB  (frames array = [stand, stepA, stepB])
  C.WALK_SEQUENCE = [0, 1, 0, 2];
  // Returns { rows, mirror } for a character facing `dir` at walk-cycle index `i` (0-3).
  C.frame = function (ch, dir, i) {
    const fi = C.WALK_SEQUENCE[((i % 4) + 4) % 4];
    const d = dir === 'right' ? 'left' : dir;
    const frames = ch.frames[d] || ch.frames.down;
    return { rows: frames[Math.min(fi, frames.length - 1)], mirror: dir === 'right' };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PKMN;
})(typeof window !== 'undefined' ? window : globalThis);
