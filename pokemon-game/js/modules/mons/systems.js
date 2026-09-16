// mons/systems.js — the three things that run while you walk around:
//
//   mons-encounters  a step on an encounter tile rolls this map's table
//   mons-follower    the first party Pokémon walks behind the active hero
//   mons-garden      on a garden map (or a fenced corner of one), everyone you
//                    own roams as a 16×16 icon you can talk to
//
// All three read the world and the save section; none of them touch the kit.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const M = KIT.mons = KIT.mons || {};
  const E = KIT.entities;
  const num = (v, d) => (v == null || !Number.isFinite(Number(v)) ? d : Number(v));

  const HOUR = 3600 * 1000;

  /**
   * install(world) — wire this world up once. Everything is per-world state on
   * `world._mons`, so two worlds (Creator Mode's preview and the game) never
   * tread on each other.
   */
  function install(world) {
    if (!world || world._mons) return world && world._mons;
    const state = world._mons = { offs: [], gardenIds: [], followerUid: null, sparkle: 0, awayDone: false };
    const section = M.section(world.save);

    // --- the session gap ------------------------------------------------------
    // The engine measures it, keeps the stamp fresh and says `sessionResumed`
    // once, at the end of the world's first tick. All we do is listen, and mirror
    // the stamp into our own section so the module still knows when it was last
    // here if it is ever read without a world around it.
    state.offs.push(world.events.on('sessionResumed', (p) => {
      awayBonus(world, p && p.elapsedMs);
    }));
    M.section(world.save).lastSeenAt = (world.save.clock && world.save.clock.lastSeenAt) || null;

    // --- steps: encounters, and friendship for walking together --------------
    state.offs.push(world.events.on('step', (p) => {
      try { onStep(world, p); } catch (e) { (KIT.log || console).error('[mons] step', e); }
    }));
    state.offs.push(world.events.on('monsChanged', () => { state.followerUid = null; syncFollower(world); }));
    state.offs.push(M.starterHook(world));

    // --- talking to the follower ----------------------------------------------
    // The follower is world.companion, not a map object, so it is an extra
    // interact target: the map's own objects answer first, and if none did and
    // you were facing the friend walking behind you, they answer.
    state.offs.push(world.addInteractTarget(() => {
      const comp = world.companion;
      if (!comp || !comp.data || !comp.data.monUid) return [];
      return [{ x: comp.x, y: comp.y, answer: (hero) => talkToFollower(world, hero) }];
    }));
    return state;
  }

  /** Everyone you have befriended gets a little something for a long gap — once. */
  function awayBonus(world, elapsedMs) {
    const state = world._mons;
    if (!state || state.awayDone) return;
    state.awayDone = true;
    state.awayPending = 0;
    const section = M.section(world.save);
    const pack = M.pack(world.project);
    const gained = M.resumeBonus(section, num(elapsedMs, 0), { hours: num(pack.awayHours, 20), bonus: num(pack.awayBonus, 4) });
    if (gained.length && world.ports && world.ports.io && world.ports.io.toast) {
      Promise.resolve(world.ports.io.toast({ text: M.t(world.project, 'mons-welcome-back') })).catch(() => {});
    }
    return gained;
  }

  function uninstall(world) {
    const s = world && world._mons;
    if (!s) return;
    for (const off of s.offs) { try { off(); } catch (e) { /* already gone */ } }
    s.offs = [];
  }

  // ---- encounters -------------------------------------------------------------
  function onStep(world, p) {
    const section = M.section(world.save);
    const pack = M.pack(world.project);

    // friendship for walking together
    const gained = M.walkFriendship(section, 1, { per: num(pack.stepsPerFriendship, 128), bonus: num(pack.followStepBonus, 1) });
    if (gained.length && world.ports && world.ports.io && world.ports.io.toast) {
      Promise.resolve(world.ports.io.toast({ text: M.t(world.project, 'mons-friendship-up', { name: M.displayName(gained[0], world.project) }) })).catch(() => {});
    }

    if (!p || !p.tile || !p.tile.encounter) return;
    if (world.busy) return;
    if (KIT.scenes && KIT.scenes.top() && KIT.scenes.top().id !== 'map') return;
    const table = M.encounterTable(world.map, world.project);
    if (!table) return;
    const hit = M.rollEncounter(table, p.region, world.rng);
    if (!hit) return;
    const ctx = world.makeCtx(null, p.hero || (world.hero() ? world.hero().id : 'p1'));
    Promise.resolve(M.startEncounter(ctx, { species: hit.id, shiny: hit.shiny }))
      .catch(e => (KIT.log || console).error('[mons] encounter', e));
  }

  // ---- the follower --------------------------------------------------------------
  function syncFollower(world) {
    const state = world._mons;
    if (!state) return;
    const pack = M.pack(world.project);
    const section = M.section(world.save);
    const mon = pack.followers === false ? null : M.follower(section);
    if (!mon) { world.companion = null; state.followerUid = null; return; }
    if (state.followerUid === mon.uid && world.companion) {
      world.companion.data.mon = mon;
      return;
    }
    const lead = world.hero();
    const sprite = M.spriteFor(mon);
    const comp = E.create({
      id: 'mons-follower', kind: 'npc', sprite,
      x: lead ? lead.x : 0, y: lead ? lead.y : 0, dir: lead ? lead.dir : 'down',
      solid: false, through: true, layer: 'same', speed: E.DEFAULT_SPEED,
    });
    comp.data.trail = [];
    comp.data.mon = mon;
    comp.data.monUid = mon.uid;
    world.companion = comp;
    state.followerUid = mon.uid;
  }

  async function talkToFollower(world, hero) {
    const comp = world.companion;
    if (!comp || !comp.data || !comp.data.monUid) return false;
    const h = typeof hero === 'number' ? world.hero(hero) : hero;
    if (!h) return false;
    const section = M.section(world.save);
    const mon = M.find(section, comp.data.monUid);
    if (!mon) return false;
    E.faceToward(comp, h);
    const pack = M.pack(world.project);
    const day = (world.save.clock && world.save.clock.day) || 1;
    const moodText = M.moodLabel(world.project, mon, { day, project: world.project, save: world.save });
    M.addFriendship(mon, 1);
    comp.data.balloon = { kind: '♥', start: (root.performance ? performance.now() : Date.now()), ms: 900 };
    if (world.ports && world.ports.io && world.ports.io.say) {
      await world.ports.io.say({
        who: M.displayName(mon, world.project),
        text: M.t(world.project, 'mons-follower-line', { name: M.displayName(mon, world.project), mood: moodText }),
      });
    }
    return true;
  }

  // ---- the garden -------------------------------------------------------------------
  /**
   * Garden mons are injected into the map view as ordinary objects before the
   * world builds its entities, so wandering, drawing, collision and talking all
   * come from the engine — this module only decides who is standing where.
   */
  function fillGarden(world) {
    const state = world._mons;
    if (!state || !world.map) return;
    const view = world.map;
    // `view.objects` is the view's own copy of the map's objects (map.js line
    // 105 concats), so pushing into it never writes to the project.
    clearGarden(view);
    state.gardenIds = [];
    const area = M.gardenArea(view);
    if (!area) return;
    const section = M.section(world.save);
    // Everyone you own is out here — except whoever is already walking behind
    // you, who is standing right there.
    const following = world.companion && world.companion.data ? world.companion.data.monUid : null;
    const list = M.all(section).filter(m => m && m.uid !== following);
    if (!list.length) return;
    const seed = KIT.hash(view.id, list.length, 'garden');
    const rng = KIT.rng(seed);
    const hero = world.hero();
    const spots = M.gardenSpots(area, view, list.length, rng, hero ? { x: hero.x, y: hero.y } : null);
    const objects = [];
    list.forEach((mon, i) => {
      const at = spots[i];
      if (!at) return;
      const id = 'mons-garden-' + mon.uid;
      objects.push({
        id, name: M.displayName(mon, world.project), type: 'npc', x: at.x, y: at.y, note: '', mons: true,
        pages: [{
          when: null, sprite: M.spriteFor(mon), dir: 'down', layer: 'same', through: false,
          dirFix: false, stepAnim: false, visible: true,
          behaviour: { kind: 'wander', radius: 2, frequency: 3, route: [] },
          on: { interact: [{ t: 'monCard', uid: mon.uid }] },
          once: false, needsBoth: false, props: {},
        }],
      });
      state.gardenIds.push(id);
    });
    for (const o of objects) view.objects.push(o);
    world.rebuildEntities();
    for (const e of world.entities) {
      if (!state.gardenIds.includes(e.id)) continue;
      const mon = M.find(section, e.id.replace('mons-garden-', ''));
      if (mon) { e.data.mon = mon; e.home = { x: e.x, y: e.y }; }
    }
  }

  function clearGarden(view) {
    if (!view || !Array.isArray(view.objects)) return;
    for (let i = view.objects.length - 1; i >= 0; i--) if (view.objects[i] && view.objects[i].mons) view.objects.splice(i, 1);
  }

  /** sparkle — shiny mons in the garden twinkle now and then. */
  function sparkleGarden(world, dt) {
    const state = world._mons;
    if (!state || !state.gardenIds.length) return;
    state.sparkle -= dt;
    if (state.sparkle > 0) return;
    state.sparkle = 5;
    for (const e of world.entities) {
      const mon = e.data && e.data.mon;
      if (!mon || !mon.shiny) continue;
      e.data.balloon = { kind: '✦', start: (root.performance ? performance.now() : Date.now()), ms: 900 };
    }
  }

  /** registerSystems() — three entries in the systems registry, nothing else. */
  M.registerSystems = function () {
    const reg = KIT.registry('systems');
    reg.add({
      id: 'mons-encounters', name: 'Pokémon encounters', order: 35, replace: true,
      update(world, dt) {
        install(world);
      },
      onMapEnter(world) { install(world); },
      onMapLeave(world) { /* the listeners live as long as the world does */ },
    });
    reg.add({
      id: 'mons-follower', name: 'Pokémon follower', order: 38, replace: true,
      update(world) { install(world); syncFollower(world); },
      onMapEnter(world) { install(world); syncFollower(world); },
    });
    reg.add({
      id: 'mons-garden', name: 'The garden', order: 39, replace: true,
      update(world, dt) { sparkleGarden(world, dt); },
      onMapEnter(world) {
        install(world);
        M.newVisit(M.section(world.save));
        try { fillGarden(world); } catch (e) { (KIT.log || console).error('[mons] garden', e); }
      },
      onMapLeave(world) {
        clearGarden(world && world.map);
        if (world && world._mons) world._mons.gardenIds = [];
      },
    });
  };

  M._install = install;
  M._uninstall = uninstall;
  M._syncFollower = syncFollower;
  M._fillGarden = fillGarden;

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
