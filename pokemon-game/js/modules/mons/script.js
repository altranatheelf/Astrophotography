// mons/script.js — the commands and conditions, so the author can write the
// Pokémon side into their own scenes.
//
// Each one carries `fields`, so Creator Mode forms it without knowing anything
// about Pokémon, and `text`, so Screenplay round-trips it:
//
//   @givePokemon species=pikachu friendship=70 ask=true
//   @encounter                        # roll this map's table
//   @friendship who=follower amount=5
//   @openParty                        @openDex
//   when: has(species=pikachu) and dexCount(which=caught, op=>=, count=5)
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const M = KIT.mons = KIT.mons || {};
  const num = (v, d) => (v == null || !Number.isFinite(Number(v)) ? d : Number(v));

  const OPS = ['==', '!=', '<', '<=', '>', '>='];
  const SYM = { '==': '=', '!=': '≠', '<': '<', '<=': '≤', '>': '>', '>=': '≥' };
  const WHO = ['follower', 'first', 'all', 'uid', 'species'];

  /** registerScript() — the five commands and the four conditions. */
  M.registerScript = function () {
    const cmds = KIT.registry('commands');
    const conds = KIT.registry('conditions');

    cmds.addAll([
      {
        id: 'givePokemon', label: 'Give a Pokémon', group: 'Pokémon', icon: 'pokeball',
        doc: 'Befriend a species outright — a gift, a starter, the end of a quest.',
        blocking: true, background: false, replace: true,
        editor: { favourite: true },
        fields: [
          { key: 'species', type: 'ref:mon', nullable: false, label: 'Species' },
          { key: 'nickname', type: 'string', default: '', doc: 'Blank uses the species name' },
          { key: 'ask', type: 'bool', default: false, doc: 'Ask the player for a nickname' },
          { key: 'friendship', type: 'number', integer: true, min: 0, max: 255, default: 0 },
          { key: 'shiny', type: 'bool', default: false },
          { key: 'to', type: 'enum', options: ['auto', 'party', 'box'], default: 'auto', label: 'Goes to' },
          { key: 'notify', type: 'bool', default: true, doc: 'Show the "joined you!" line' },
        ],
        async run(ctx, cmd) {
          await M.grant(ctx, {
            species: cmd.species, nickname: cmd.nickname, ask: !!cmd.ask,
            friendship: num(cmd.friendship, 0), shiny: !!cmd.shiny,
            to: cmd.to === 'auto' ? undefined : cmd.to, notify: cmd.notify !== false,
          });
        },
        summary(cmd) { return `Give ${M.speciesName(cmd.species)}${cmd.shiny ? ' ✦' : ''}`; },
      },
      {
        id: 'encounter', label: 'Wild encounter', group: 'Pokémon', icon: 'grass',
        doc: 'Open the catch scene. With no species, this map’s encounter table decides.',
        blocking: true, background: false, replace: true,
        fields: [
          { key: 'species', type: 'ref:mon', nullable: true, default: null, label: 'Species', doc: 'Blank rolls the map table' },
          { key: 'shiny', type: 'bool', default: false },
          { key: 'profile', type: 'string', default: '', doc: 'A catch profile id from packs.mons.profiles' },
        ],
        async run(ctx, cmd) {
          await M.startEncounter(ctx, { species: cmd.species || '', shiny: cmd.shiny ? true : null, profile: cmd.profile || '' });
        },
        summary(cmd) { return cmd.species ? `Meet ${M.speciesName(cmd.species)}` : 'Meet whoever lives here'; },
      },
      {
        id: 'friendship', label: 'Friendship', group: 'Pokémon', icon: 'heart',
        doc: 'Add to or set how close a Pokémon feels (0–255).',
        blocking: false, background: true, replace: true,
        fields: [
          { key: 'who', type: 'enum', options: WHO, default: 'follower' },
          { key: 'uid', type: 'string', default: '', when: { field: 'who', eq: 'uid' } },
          { key: 'species', type: 'ref:mon', nullable: true, default: null, when: { field: 'who', eq: 'species' } },
          { key: 'op', type: 'enum', options: ['add', 'set'], default: 'add' },
          { key: 'amount', type: 'number', integer: true, min: -255, max: 255, default: 5 },
        ],
        async run(ctx, cmd) {
          M.adjustFriendship(ctx, { who: cmd.who, uid: cmd.uid, species: cmd.species, op: cmd.op, amount: num(cmd.amount, 0) });
        },
        summary(cmd) {
          const who = cmd.who === 'species' ? M.speciesName(cmd.species) : cmd.who === 'uid' ? (cmd.uid || 'one Pokémon') : cmd.who;
          return `${cmd.op === 'set' ? 'Set' : 'Add'} ${cmd.amount} friendship (${who})`;
        },
      },
      {
        id: 'openParty', label: 'Open the party', group: 'Pokémon', icon: 'pokeball',
        blocking: true, background: false, replace: true, fields: [],
        async run(ctx) { await M.openScene('mons-party', ctx); },
        summary() { return 'Open the party'; },
      },
      {
        id: 'openDex', label: 'Open the Pokédex', group: 'Pokémon', icon: 'book',
        blocking: true, background: false, replace: true, fields: [],
        async run(ctx) { await M.openScene('mons-dex', ctx); },
        summary() { return 'Open the Pokédex'; },
      },
      {
        // Not for the palette: the garden puts this on the mons it injects.
        id: 'monCard', label: 'Pokémon card', group: 'Pokémon', icon: 'pokeball',
        doc: 'Open the garden card for one Pokémon (the garden uses this itself).',
        blocking: true, background: false, replace: true,
        fields: [{ key: 'uid', type: 'string', default: '' }],
        async run(ctx, cmd) { await M.openScene('mons-card', ctx, { uid: cmd.uid }); },
        summary(cmd) { return `Card for ${cmd.uid || 'a Pokémon'}`; },
      },
    ]);

    conds.addAll([
      {
        id: 'has', label: 'Has a Pokémon', group: 'Pokémon', doc: 'You have befriended this species.',
        replace: true,
        fields: [
          { key: 'species', type: 'ref:mon', nullable: false, label: 'Species' },
          { key: 'is', type: 'bool', default: true, label: 'Owns it' },
        ],
        test(c, ctx) { return M.owns(M.read(save(ctx)), c.species) === (c.is !== false); },
        describe(c) { return `${c.is === false ? 'does not have' : 'has'} ${M.speciesName(c.species)}`; },
      },
      {
        id: 'dexCount', label: 'Pokédex count', group: 'Pokémon', doc: 'How many species you have seen or befriended.',
        replace: true,
        fields: [
          { key: 'which', type: 'enum', options: ['seen', 'caught'], default: 'caught' },
          { key: 'op', type: 'enum', options: OPS, default: '>=' },
          { key: 'count', type: 'number', integer: true, min: 0, default: 1 },
        ],
        test(c, ctx) {
          const counts = M.dexCounts(M.read(save(ctx)));
          return KIT.conditions.compare(counts[c.which === 'seen' ? 'seen' : 'caught'], c.op || '>=', num(c.count, 1));
        },
        describe(c) { return `${c.which || 'caught'} ${SYM[c.op] || c.op || '≥'} ${c.count == null ? 1 : c.count}`; },
      },
      {
        id: 'friendship', label: 'Friendship', group: 'Pokémon', doc: 'How close a Pokémon feels (0–255).',
        replace: true,
        fields: [
          { key: 'who', type: 'enum', options: WHO.filter(w => w !== 'all'), default: 'follower' },
          { key: 'uid', type: 'string', default: '', when: { field: 'who', eq: 'uid' } },
          { key: 'species', type: 'ref:mon', nullable: true, default: null, when: { field: 'who', eq: 'species' } },
          { key: 'op', type: 'enum', options: OPS, default: '>=' },
          { key: 'value', type: 'number', integer: true, min: 0, max: 255, default: 100 },
        ],
        test(c, ctx) {
          const s = M.read(save(ctx));
          const mon = pickOne(s, c);
          return KIT.conditions.compare(mon ? mon.friendship : 0, c.op || '>=', num(c.value, 100));
        },
        describe(c) {
          const who = c.who === 'species' ? M.speciesName(c.species) : c.who === 'uid' ? (c.uid || 'a Pokémon') : (c.who || 'follower');
          return `${who} friendship ${SYM[c.op] || c.op || '≥'} ${c.value == null ? 100 : c.value}`;
        },
      },
      {
        id: 'partyFull', label: 'Party is full', group: 'Pokémon', doc: 'Six Pokémon is all you can carry.',
        replace: true,
        fields: [{ key: 'is', type: 'bool', default: true, label: 'Is full' }],
        test(c, ctx) { return M.partyFull(M.read(save(ctx))) === (c.is !== false); },
        describe(c) { return c.is === false ? 'room in the party' : 'party is full'; },
      },
    ]);
  };

  /**
   * registerItems() — the two item kinds this module understands.
   * A ball is only worth something when somebody is standing in front of you;
   * a berry is worth something any time, to whoever is walking with you.
   */
  M.registerItems = function () {
    const kinds = KIT.registry('itemKinds');
    // The engine's own default kind. `project.items[].kind` defaults to 'item'
    // and the kit registers nothing, so validation only starts checking kinds
    // once somebody registers one — and then every plain keepsake in every
    // project becomes an `unknown-item-kind` warning. Registering the default
    // (if nobody has) keeps that from being our fault. See docs/ENGINE-HOOKS.md §16.
    if (!kinds.has('item')) {
      kinds.add({
        id: 'item', label: 'Keepsake', doc: 'Something you carry. Using it does nothing on its own.',
        fields: [], use() { return false; },
      });
    }
    kinds.add({
      id: 'ball', label: 'Poké Ball', replace: true,
      doc: 'Thrown in the catch scene. `power` multiplies the chance.',
      fields: [{ key: 'power', type: 'number', min: 0.1, max: 4, default: 1, doc: 'A better ball has a higher power' }],
      async use(ctx) { await M.notify(ctx, 'mons-ball-idle'); return false; },
    });
    kinds.add({
      id: 'berry', label: 'Berry', replace: true,
      doc: 'Calms a wild Pokémon in the catch scene, and cheers up the one walking with you.',
      fields: [
        { key: 'friendship', type: 'number', integer: true, min: 0, default: 10 },
        { key: 'calm', type: 'number', integer: true, min: 0, max: 3, default: 1 },
        { key: 'golden', type: 'bool', default: false, doc: 'Guarantees the next ball' },
      ],
      async use(ctx, item) {
        const section = M.sectionOf(ctx);
        const mon = M.follower(section);
        if (!mon) { await M.notify(ctx, 'mons-berry-nobody'); return false; }
        const gained = M.giveBerry(section, mon.uid, { bonus: num((item && item.props && item.props.friendship), 10) });
        M.changed(ctx, { kind: 'berry', uid: mon.uid });
        await M.notify(ctx, 'mons-berry-given', { name: M.displayName(mon, ctx && ctx.project), n: gained });
        return true;
      },
    });
  };

  function save(ctx) { return (ctx && ctx.world && ctx.world.save) || (ctx && ctx.save) || {}; }
  function pickOne(s, c) {
    if (c.who === 'uid') return M.find(s, c.uid);
    if (c.who === 'species') return M.all(s).find(m => m.id === c.species) || null;
    if (c.who === 'first') return (s.party || [])[0] || null;
    return M.follower(s);
  }

  /** openScene(id, ctx, params) — a registered scene when there is a screen; a no-op in Node. */
  M.openScene = function (id, ctx, params) {
    if (!KIT.scenes || !KIT.registry.exists('scenes') || !KIT.registry('scenes').has(id)) return Promise.resolve(null);
    return KIT.scenes.run(id, Object.assign({ game: KIT.game, project: ctx && ctx.project, ctx }, params || {}));
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
