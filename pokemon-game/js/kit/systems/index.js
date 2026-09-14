// The standard systems (§8.3): they run every tick in `order`. Each is a
// registry entry so a module can add its own (encounters, weather, jobs...).
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const E = KIT.entities;
  const reg = KIT.registry('systems');

  // --- 10 movement: interpolation, arrivals, hero touch checks -------------------
  reg.add({ id: 'movement', order: 10, update(world, dt) {
    for (const h of world.heroes) E.update(h, dt);
    if (world.companion) E.update(world.companion, dt);
    for (const e of world.entities) {
      const arrived = E.update(e, dt);
      if (arrived && e.kind === 'npc') {
        const hit = world.heroes.find(h => h.x === e.x && h.y === e.y);
        if (hit && e.page && e.page.on && e.page.on.touch && !world.busy) world.runSlot(e, 'touch', hit.id);
      }
    }
  } });

  // --- 20 behaviours: autonomous movement ---------------------------------------
  const bhv = KIT.registry('behaviours');
  bhv.add({ id: 'none', label: 'Stay put', fields: [], update() {} });
  bhv.add({ id: 'look', label: 'Look around', fields: [{ key: 'frequency', type: 'number', min: 1, max: 9, default: 3 }],
    update(e, world, dt) {
      e.data.timer = (e.data.timer || 0) - dt;
      if (e.data.timer > 0) return;
      e.data.timer = 1 + world.rng() * (10 - (e.behaviour.frequency || 3));
      if (!e.dirFix) e.dir = ['up', 'down', 'left', 'right'][world.rng.int(4)];
    } });
  bhv.add({ id: 'wander', label: 'Wander', fields: [{ key: 'radius', type: 'number', min: 1, max: 12, default: 3 }, { key: 'frequency', type: 'number', min: 1, max: 9, default: 3 }],
    update(e, world, dt) {
      if (e.mover.moving) return;
      e.data.timer = (e.data.timer || 0) - dt;
      if (e.data.timer > 0) return;
      e.data.timer = 0.8 + world.rng() * (10 - (e.behaviour.frequency || 3)) * 0.3;
      const radius = e.behaviour.radius == null ? 3 : e.behaviour.radius;
      const dir = ['up', 'down', 'left', 'right'][world.rng.int(4)];
      const d = KIT.delta(dir);
      if (Math.abs(e.home.x - (e.x + d.dx)) > radius || Math.abs(e.home.y - (e.y + d.dy)) > radius) { if (!e.dirFix) e.dir = dir; return; }
      E.tryMove(e, dir, world.map, { ignoreBlocked: true });
    } });
  bhv.add({ id: 'route', label: 'Follow a route', fields: [{ key: 'route', type: 'route', default: [] }, { key: 'repeat', type: 'bool', default: true }],
    update(e, world, dt) {
      if (!e.route && !e.data.routeDone) E.startRoute(e, e.behaviour.route || [], { repeat: e.behaviour.repeat !== false, skipBlocked: true });
      if (e.route && E.updateRoute(e, dt, world.map, { hero: world.hero(), rng: world.rng, sound: (id) => world.ports.audio && world.ports.audio.play && world.ports.audio.play(id) })) e.data.routeDone = true;
    } });
  bhv.add({ id: 'approach', label: 'Approach the player', fields: [{ key: 'frequency', type: 'number', min: 1, max: 9, default: 5 }],
    update(e, world, dt) {
      if (e.mover.moving) return;
      e.data.timer = (e.data.timer || 0) - dt;
      if (e.data.timer > 0) return;
      e.data.timer = 0.5 + world.rng() * 0.5;
      const h = world.hero();
      if (!h) return;
      E.tryMove(e, E.dirToward(e, h), world.map, { ignoreBlocked: true });
    } });
  reg.add({ id: 'behaviours', order: 20, update(world, dt) {
    if (world.busy) return;
    for (const e of world.entities) {
      const kind = (e.behaviour && e.behaviour.kind) || 'none';
      const def = bhv.get(kind);
      if (def && def.update) { try { def.update(e, world, dt); } catch (err) { (KIT.log || console).error(`[behaviour ${kind}]`, err); } }
    }
  } });

  // --- 30 triggers: tick slots (background threads), throttled per object ---------
  reg.add({ id: 'triggers', order: 30, update(world) {
    for (const e of world.entities) {
      if (!e.page || !e.page.on || !Array.isArray(e.page.on.tick) || !e.page.on.tick.length) continue;
      if (e.data.tickRunning) continue;
      e.data.tickRunning = true;
      Promise.resolve(world.runSlot(e, 'tick', world.hero() ? world.hero().id : 'p1'))
        .catch(err => (KIT.log || console).error('[tick]', err))
        .then(() => { e.data.tickRunning = false; });
    }
  } });

  // --- 40 companions -------------------------------------------------------------
  reg.add({ id: 'companions', order: 40, update(world, dt) {
    const lead = world.hero();
    if (world.companion && lead) E.updateCompanion(world.companion, lead, dt, world.map);
    if (!world.coop && world.heroes[1] && lead && world.heroes[1] !== lead) E.updateCompanion(world.heroes[1], lead, dt, world.map);
  } });

  // --- 50 clock -------------------------------------------------------------------
  reg.add({ id: 'clock', order: 50, update(world, dt) {
    const s = (world.project.settings && world.project.settings.clock) || {};
    if (!s.enabled) return;
    const save = world.save;
    save.clock = save.clock || { day: 1, minutes: 480, lastSeenAt: null };
    const perSecond = s.minutesPerSecond || 0;
    if (!perSecond) return;
    world._clockAcc = (world._clockAcc || 0) + dt * perSecond;
    if (world._clockAcc >= 1) {
      const add = Math.floor(world._clockAcc);
      world._clockAcc -= add;
      save.clock.minutes += add;
      while (save.clock.minutes >= 1440) { save.clock.minutes -= 1440; save.clock.day++; }
      world.events.emit('clockTick', { minutes: save.clock.minutes, day: save.clock.day });
    }
  } });

  // --- 90 camera -------------------------------------------------------------------
  KIT.camera = {
    /** Centre on an entity, clamped to the map; smaller maps are centred. */
    update(world) {
      const view = world.map;
      if (!view) return world.camera;
      const vp = (world.project.settings && world.project.settings.viewport) || { w: 16, h: 12 };
      const h = world.hero();
      let cx = (h ? h.px : 0) + 0.5 - vp.w / 2;
      let cy = (h ? h.py : 0) + 0.5 - vp.h / 2;
      cx = view.width <= vp.w ? (view.width - vp.w) / 2 : KIT.clamp(cx, 0, view.width - vp.w);
      cy = view.height <= vp.h ? (view.height - vp.h) / 2 : KIT.clamp(cy, 0, view.height - vp.h);
      world.camera.x = cx; world.camera.y = cy;
      return world.camera;
    },
  };
  reg.add({ id: 'camera', order: 90, update(world) { KIT.camera.update(world); } });

  KIT.registry('strings').add({ id: 'needs-both', default: 'This needs both of you!' });

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
