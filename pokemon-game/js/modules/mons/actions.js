// mons/actions.js — the things the module *does*, shared by the commands, the
// scenes, the systems and the demo's starter hook, so there is exactly one way
// to befriend a Pokémon no matter who asked.
//
// Everything here is ctx-shaped (§9.1), so KIT.interpreter.fakeCtx drives it in
// Node with no DOM: the tests catch a Pokémon headlessly.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const M = KIT.mons = KIT.mons || {};

  const isObj = KIT.isObject;
  const num = KIT.num;

  /** saveOf(ctx) -> the save, wherever the ctx keeps it. */
  M.saveOf = function (ctx) { return (ctx && (ctx.save || (ctx.world && ctx.world.save))) || {}; };
  /** sectionOf(ctx) -> the mons save section, created on first touch. */
  M.sectionOf = function (ctx) { return M.section(M.saveOf(ctx)); };
  /** mapNameOf(project, id) -> the map's friendly name ('Route 1'). */
  M.mapNameOf = function (project, id) {
    const m = project && project.maps ? project.maps[id] : null;
    return (m && m.name) || (id == null ? '' : String(id));
  };
  /** heroNameOf(ctx) -> the name of whoever is standing there. */
  M.heroNameOf = function (ctx) {
    try { return KIT.commands.state.heroName(ctx, KIT.conditions.heroId(ctx)); }
    catch (e) { return null; }
  };
  /** currentMapId(ctx) -> the map the world is on (null headlessly). */
  M.currentMapId = function (ctx) {
    const w = ctx && ctx.world;
    return (w && w.map && w.map.id) || null;
  };
  /** notify(ctx, id, vars) -> a toast in the player's words. */
  M.notify = function (ctx, id, vars) {
    const text = M.t(ctx && ctx.project, id, vars);
    if (ctx && ctx.io && typeof ctx.io.toast === 'function') return ctx.io.toast({ text });
    return Promise.resolve();
  };
  /** changed(ctx) — the follower and garden systems rebuild on this. */
  M.changed = function (ctx, what) {
    const payload = Object.assign({ module: 'mons' }, what || {});
    if (ctx && typeof ctx.emit === 'function') ctx.emit('monsChanged', payload);
    else if (ctx && ctx.world && ctx.world.events) ctx.world.events.emit('monsChanged', payload);
    if (KIT.bus) KIT.bus.emit('monsChanged', payload);          // the bus catches and logs a listener that throws
  };

  /**
   * grant(ctx, { species, nickname, shiny, friendship, to, ask }) -> Promise<{ mon, where } | null>
   * The one door into the party. A full party sends the newcomer to the garden
   * and says so, instead of refusing.
   */
  M.grant = async function (ctx, opts) {
    const o = opts || {};
    const id = String(o.species || o.id || '');
    if (!id || !M.species(id)) {
      (KIT.log || console).warn(`[mons] grant: unknown species '${id}'`);
      return null;
    }
    const project = ctx && ctx.project;
    const section = M.sectionOf(ctx);
    const mapId = o.map === undefined ? M.currentMapId(ctx) : o.map;
    const mon = M.create({
      id, project, rng: ctx && ctx.rng,
      nickname: o.nickname || '',
      shiny: o.shiny == null ? undefined : !!o.shiny,
      friendship: num(o.friendship, 0),
      map: mapId, metAt: o.metAt || M.mapNameOf(project, mapId),
      by: o.by || M.heroNameOf(ctx),
      date: o.date || new Date().toISOString(),
    });

    if (o.ask && ctx && ctx.io && typeof ctx.io.nameEntry === 'function') {
      const name = await ctx.io.nameEntry({
        hero: (ctx && ctx.hero) || 'p1', maxLength: 10, current: M.speciesName(id),
        prompt: M.t(project, 'mons-nickname', { name: M.speciesName(id) }),
      });
      if (typeof name === 'string' && name.trim() && name.trim() !== M.speciesName(id)) mon.nickname = name.trim().slice(0, 12);
    }

    const where = M.add(section, mon, { to: o.to });
    M.markCaught(section, id, { map: mon.caughtAt.map, where: mon.metAt, date: mon.caughtAt.date });
    if (where === 'party' && !section.follower) M.setFollower(section, mon.uid);
    M.changed(ctx, { kind: 'grant', uid: mon.uid, where });
    if (o.notify !== false) await M.notify(ctx, where === 'party' ? 'mons-joined' : 'mons-joined-garden', { name: M.displayName(mon, project) });
    return { mon, where };
  };

  /**
   * startEncounter(ctx, { species, shiny, profile }) -> Promise<result>
   * With a screen this opens the catch scene; without one (Node, a headless
   * play-through) it still marks the Pokédex, so the rules stay honest.
   */
  M.startEncounter = async function (ctx, opts) {
    const o = opts || {};
    let id = o.species ? String(o.species) : '';
    let shiny = o.shiny == null ? null : !!o.shiny;
    if (!id) {
      const rolled = M.rollForCtx(ctx, o);
      if (!rolled) return { ok: false, reason: 'nothing-here' };
      id = rolled.id;
      if (shiny == null) shiny = rolled.shiny;
    }
    if (!M.species(id)) { (KIT.log || console).warn(`[mons] encounter: unknown species '${id}'`); return { ok: false, reason: 'unknown-species' }; }
    const section = M.sectionOf(ctx);
    const isNew = M.isNew(section, id);
    if (typeof M.openCatch === 'function') return await M.openCatch(ctx, { species: id, shiny: !!shiny, profile: o.profile, isNew });
    M.see(section, id);
    M.changed(ctx, { kind: 'seen', species: id });
    return { ok: true, headless: true, species: id, shiny: !!shiny, isNew };
  };

  /** rollForCtx(ctx, { map, region }) -> { id, shiny } | null — the current map's table. */
  M.rollForCtx = function (ctx, opts) {
    const o = opts || {};
    const w = ctx && ctx.world;
    const view = o.view || (w && w.map);
    const project = ctx && ctx.project;
    const table = M.encounterTable(view, project);
    if (!table) return null;
    let region = o.region;
    if (region == null && view && view.region) {
      const hero = w && w.hero ? w.hero() : null;
      region = hero ? view.region(hero.x, hero.y) : 0;
    }
    const rng = (ctx && typeof ctx.rng === 'function') ? ctx.rng : Math.random;
    const entries = M.entriesFor(table, region);
    if (!entries.length) return null;
    return M.pickWeighted(entries, rng());          // an explicit encounter always finds someone
  };

  /**
   * adjustFriendship(ctx, { who, uid, species, op, amount }) -> the mons changed.
   * `who`: follower | first | all | uid | species.
   */
  M.adjustFriendship = function (ctx, opts) {
    const o = opts || {};
    const section = M.sectionOf(ctx);
    let list = [];
    const who = o.who || 'follower';
    if (who === 'uid') { const m = M.find(section, o.uid); if (m) list = [m]; }
    else if (who === 'species') list = M.all(section).filter(m => m.id === o.species);
    else if (who === 'all') list = M.all(section);
    else if (who === 'first') { const m = (section.party || [])[0]; if (m) list = [m]; }
    else { const m = M.follower(section); if (m) list = [m]; }
    for (const mon of list) {
      if (o.op === 'set') M.setFriendship(mon, num(o.amount, 0));
      else M.addFriendship(mon, num(o.amount, 0));
    }
    if (list.length) M.changed(ctx, { kind: 'friendship', uids: list.map(m => m.uid) });
    return list;
  };

  /**
   * starterHook(world) — the demo's lab stands set a story variable; this turns
   * that variable into a real partner the moment it is set.
   *
   * It exists because a module command inside demo content would not validate
   * for anyone who has not loaded this module (see README, "the missing hook").
   * `packs.mons.starters = { var:'starter', friendship:70, ask:true }`.
   */
  M.starterHook = function (world) {
    const pack = M.pack(world && world.project);
    const cfg = pack.starters;
    if (!isObj(cfg) || !cfg.var) return () => {};
    /**
     * `justChosen` is the difference between "they picked one just now" (ask for
     * a nickname, say hello) and "this save already says they have one" (a test
     * state, an old save): catching up quietly is not a moment.
     */
    const grantIfNeeded = (justChosen) => {
      const save = world.save;
      const id = save && save.vars ? save.vars[cfg.var] : null;
      if (!id || typeof id !== 'string' || !M.species(id)) return;
      const section = M.section(save);
      if (M.owns(section, id)) return;
      const ctx = world.makeCtx ? world.makeCtx(null, world.hero() ? world.hero().id : 'p1') : { project: world.project, world, save };
      Promise.resolve(M.grant(ctx, {
        species: id, friendship: num(cfg.friendship, 70), to: 'party',
        ask: !!cfg.ask && justChosen, notify: justChosen,
      })).catch(e => (KIT.log || console).error('[mons] starter', e));
    };
    /**
     * The variable is set *inside* the script that sets it — the lab stand still
     * has lines to say afterwards. Asking for a nickname there would push a name
     * box under the script's own message box and wedge both: the box below waits
     * for an answer it can never be given. So we wait for our turn.
     *
     * `KIT.interpreter.whenIdle()` is the engine's answer to "has the script
     * finished"; the screen is a separate question, because a message box stays
     * up after the script that pushed it has ended.
     */
    const grantWhenQuiet = async (justChosen) => {
      if (KIT.interpreter) await KIT.interpreter.whenIdle();      // resolves at once when nothing is running
      const onScreen = () => (world && world.busy) ||
        (KIT.scenes && KIT.scenes.ids && KIT.scenes.ids().some(id => id === 'dialogue' || id === 'choice' || id === 'chapter'));
      for (let tries = 0; onScreen() && tries < 600; tries++) {
        await new Promise(r => setTimeout(r, 100));               // a minute, then say it anyway
        if (KIT.interpreter) await KIT.interpreter.whenIdle();
      }
      grantIfNeeded(justChosen);
    };
    const off = world.events.on('varChanged', (p) => { if (p && p.name === cfg.var) grantWhenQuiet(true); });
    grantIfNeeded(false);            // catching a save up is quiet: no prompt, no fanfare
    return off;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
