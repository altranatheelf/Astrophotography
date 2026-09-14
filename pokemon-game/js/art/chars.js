// Character sprite registration. The art lives in chars-heroes.js /
// chars-npcs.js which call PKMN.CHARS.register([...]) and
// PKMN.CHARS.registerRecolorable(id, {...}). Those are thin aliases over the
// kit's 'sprites' registry (§6.3): entries are { id, name, group, w, h,
// palette, frames:{ down, up, left } } with 3 frames [stand, stepA, stepB] per
// direction; right is the mirrored left. Recolourable parts live on
// KIT.registry('sprites').recolorable. Nothing here touches pixel data.
//
// Requires the kit core (registry, schema, registries) to be loaded first.
(function (root) {
  const KIT = root.KIT;
  const PKMN = root.PKMN = root.PKMN || {};
  const reg = KIT.registry('sprites');
  reg.recolorable = reg.recolorable || {};
  const C = PKMN.CHARS = PKMN.CHARS || {};
  const SP = KIT.sprites = KIT.sprites || {};

  const titleCase = (id) => id.replace(/-/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());

  /** register(chars) — forwards to KIT.registry('sprites').addAll after the legacy w/h/name/group defaults. */
  C.register = function (chars) {
    const list = [];
    for (const c of chars) {
      if (!c || !c.id) continue;
      if (c.w == null) c.w = 16;
      if (c.h == null) c.h = 24;
      if (!c.name) c.name = titleCase(c.id);
      if (!c.group) c.group = 'npc';
      if (reg.has(c.id)) c.replace = true;
      list.push(c);
    }
    reg.addAll(list);
  };
  /** registerRecolorable(id, parts) — parts: { hair:['h','H'], shirt:['s','S'], ... } palette keys per recolourable part. */
  C.registerRecolorable = function (id, parts) { reg.recolorable[id] = parts; };

  // Walk cycle: stand, stepA, stand, stepB  (frames array = [stand, stepA, stepB])
  SP.WALK_SEQUENCE = [0, 1, 0, 2];
  /** frame(sprite, dir, i) -> { rows, mirror } for a sprite facing `dir` at walk-cycle index `i` (0-3). */
  SP.frame = function (ch, dir, i) {
    const fi = SP.WALK_SEQUENCE[((i % 4) + 4) % 4];
    const d = dir === 'right' ? 'left' : dir;
    const frames = ch.frames[d] || ch.frames.down;
    return { rows: frames[Math.min(fi, frames.length - 1)], mirror: dir === 'right' };
  };
  SP.recolorable = reg.recolorable;

  // Legacy views over the registry.
  C.WALK_SEQUENCE = SP.WALK_SEQUENCE;
  C.frame = SP.frame;
  Object.defineProperty(C, 'list', { get: () => reg.list() });
  Object.defineProperty(C, 'byId', { get: () => { const o = {}; for (const c of reg.list()) o[c.id] = c; return o; } });
  Object.defineProperty(C, 'recolorable', { get: () => reg.recolorable });

  if (typeof module !== 'undefined' && module.exports) module.exports = PKMN;
})(typeof window !== 'undefined' ? window : globalThis);
