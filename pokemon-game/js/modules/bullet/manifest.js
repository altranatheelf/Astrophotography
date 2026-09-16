// A bullet-hell fight, as a module. It exists to prove (or disprove) that an
// Undertale-style battle can be written against this engine's public API.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const B = KIT.bullet = KIT.bullet || {};

  const DEF = {
    id: 'bullet',
    version: 1,
    label: 'Bullet fight',
    requires: [],
    describe: 'A real-time pattern you dodge with the d-pad, the way Undertale does it.',
    register(kit) { KIT.bullet.registerAll(kit); },
    save: {
      key: 'bullet',
      defaults: () => ({ version: 1, fights: 0, hitsTaken: 0, grazes: 0 }),
      migrate: [],
      repair: (d) => { d.fights = Number(d.fights) || 0; d.hitsTaken = Number(d.hitsTaken) || 0; d.grazes = Number(d.grazes) || 0; return d; },
    },
    content: {
      key: 'bullet',
      defaults: () => ({ soulColor: '#ff2d55', grazeSound: 'blip' }),
      fields: [
        { key: 'soulColor', type: 'color', default: '#ff2d55', label: 'Soul colour' },
        { key: 'grazeSound', type: 'ref:sound', nullable: true, default: 'blip', label: 'Graze sound' },
      ],
    },
  };
  B.MANIFEST = DEF;
  if (typeof KIT.module !== 'function') (KIT.log || console).error('[bullet] KIT.module is missing');
  else KIT.module(DEF);

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
