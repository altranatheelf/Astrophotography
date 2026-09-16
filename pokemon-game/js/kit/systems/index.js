// The standard systems (§8.3): they run every tick in `order`. Each is a
// registry entry so a module can add its own (encounters, weather, jobs...).
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const E = KIT.entities;
  const reg = KIT.registry('systems');
  const num = (v, d) => (Number.isFinite(v) ? v : d);

  // --- 10 movement: interpolation, arrivals, hero touch checks -------------------
  const routePorts = (world) => ({ hero: world.hero(), rng: world.rng, sound: (id) => world.ports.audio && world.ports.audio.play && world.ports.audio.play(id) });
  reg.add({ id: 'movement', order: 10, update(world, dt) {
    for (const h of world.heroes) { E.update(h, dt); if (h.route) E.updateRoute(h, dt, world.map, routePorts(world)); }
    if (world.companion) E.update(world.companion, dt);
    for (const e of world.entities) {
      const arrived = E.update(e, dt);
      if (e.route) E.updateRoute(e, dt, world.map, routePorts(world));   // routes started by the moveRoute command or a behaviour
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
      // the movement system steps it
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
  // Two different clocks live here and should not be confused:
  //
  //   the RUNNING clock  in-game minutes while you play (settings.clock.enabled)
  //   the GAP            how long the player was away, between sessions
  //
  // The gap is measured whether or not the running clock is switched on, because
  // “what happened while I was gone” is a thing a game may want without the
  // time of day ever being shown.
  const DEFAULT_CLOCK = () => ({ day: 1, minutes: 480, lastSeenAt: null });

  KIT.clock = {
    /** settings(project) -> the clock settings, with every default in place. */
    settings(project) {
      const s = (project && project.settings && project.settings.clock) || {};
      return {
        enabled: !!s.enabled,
        minutesPerStep: num(s.minutesPerStep, 1),
        minutesPerSecond: num(s.minutesPerSecond, 0),
        awayMinutesPerRealMinute: num(s.awayMinutesPerRealMinute, 0),
        awayCapMinutes: num(s.awayCapMinutes, 4320),
        stampEverySeconds: num(s.stampEverySeconds, 20),
      };
    },
    /** of(save) -> save.clock, created if it is not there. */
    of(save) {
      if (!save) return DEFAULT_CLOCK();
      save.clock = save.clock || DEFAULT_CLOCK();
      return save.clock;
    },
    /**
     * add(save, minutes) -> the clock. Days roll over; nothing else moves.
     * `clockTick` is the running clock's event, so this does not emit it — the
     * caller decides whether what it just did counts as time passing on screen.
     */
    add(save, minutes) {
      const c = KIT.clock.of(save);
      const n = Math.floor(num(minutes, 0));
      if (!n) return c;
      c.minutes += n;
      while (c.minutes >= 1440) { c.minutes -= 1440; c.day++; }
      while (c.minutes < 0) { c.minutes += 1440; c.day = Math.max(1, c.day - 1); }
      return c;
    },
    /** stamp(save) -> the ISO string written to save.clock.lastSeenAt. */
    stamp(save) {
      const c = KIT.clock.of(save);
      c.lastSeenAt = new Date().toISOString();
      return c.lastSeenAt;
    },
    /** gap(save) -> milliseconds since lastSeenAt, or 0 when there is no stamp. */
    gap(save) {
      const at = KIT.clock.of(save).lastSeenAt;
      if (!at) return 0;
      const then = Date.parse(at);
      if (!Number.isFinite(then)) return 0;
      return Math.max(0, Date.now() - then);
    },
    /**
     * resume(world) -> { elapsedMs, minutesAdded } | null
     *
     * Said once per world, at the end of its first tick (see world.update), so
     * every system has its listeners on. `awayMinutesPerRealMinute` turns the
     * gap into in-game minutes, capped by `awayCapMinutes` — a month away does
     * not skip the whole story. A game that wants the gap and not the minutes
     * leaves that setting at 0 and reads `elapsedMs` itself.
     */
    resume(world) {
      if (!world || !world.save) return null;
      const elapsedMs = KIT.clock.gap(world.save);
      const s = KIT.clock.settings(world.project);
      let minutesAdded = 0;
      if (elapsedMs > 0 && s.awayMinutesPerRealMinute > 0) {
        minutesAdded = Math.min(s.awayCapMinutes, Math.floor((elapsedMs / 60000) * s.awayMinutesPerRealMinute));
        if (minutesAdded > 0) KIT.clock.add(world.save, minutesAdded);
      }
      KIT.clock.stamp(world.save);
      if (elapsedMs <= 0) return null;                       // a new game was never away
      const payload = { elapsedMs, minutesAdded };
      if (world.events) world.events.emit('sessionResumed', payload);
      return payload;
    },
  };

  reg.add({ id: 'clock', order: 50, update(world, dt) {
    const s = KIT.clock.settings(world.project);
    const save = world.save;
    KIT.clock.of(save);

    // Keep the stamp fresh, whatever else is switched on: it is what the NEXT
    // session measures its gap against, and a session that ends in a crash still
    // has to leave an honest one behind.
    world._stampAcc = (world._stampAcc || 0) + dt;
    if (world._resumeSaid && world._stampAcc >= s.stampEverySeconds) {
      world._stampAcc = 0;
      KIT.clock.stamp(save);
    }

    if (!s.enabled || !s.minutesPerSecond) return;
    world._clockAcc = (world._clockAcc || 0) + dt * s.minutesPerSecond;
    if (world._clockAcc >= 1) {
      const add = Math.floor(world._clockAcc);
      world._clockAcc -= add;
      KIT.clock.add(save, add);
      world.events.emit('clockTick', { minutes: save.clock.minutes, day: save.clock.day });
    }
  } });

  // --- 90 camera ------------------------------------------------------------------
  // The camera usually keeps the active hero in frame. A scene can take it away:
  // follow someone else, hold on a place, pull back — then let it go again.
  KIT.camera = {
    /** focus(world, { mode:'follow'|'point'|'release', target, x, y, zoom, ms }) */
    focus(world, o) {
      o = o || {};
      const now = KIT.camera.centre(world);
      const mode = o.mode || 'follow';
      world.cameraFocus = mode === 'release' ? null : { mode, target: o.target || 'hero', x: o.x || 0, y: o.y || 0 };
      const zoom = o.zoom == null ? (world.camera.zoom || 1) : o.zoom;
      world.cameraTween = { fromX: now.x, fromY: now.y, fromZoom: world.camera.zoom || 1, toZoom: zoom, t: 0, ms: o.ms == null ? 600 : o.ms };
      return world.cameraFocus;
    },
    /** Where the camera is looking right now, in tiles (the centre of the view). */
    centre(world) {
      const vp = KIT.camera.viewport(world);
      return { x: world.camera.x + vp.w / 2, y: world.camera.y + vp.h / 2 };
    },
    /** The visible size in tiles, which a zoom changes. */
    viewport(world) {
      const vp = world.viewport || (world.project.settings && world.project.settings.viewport) || { w: 16, h: 12 };
      const zoom = world.camera && world.camera.zoom > 0 ? world.camera.zoom : 1;
      return { w: vp.w / zoom, h: vp.h / zoom };
    },
    /** What the camera wants to be centred on. */
    wanted(world) {
      const f = world.cameraFocus;
      if (f && f.mode === 'point') return { x: f.x + 0.5, y: f.y + 0.5 };
      let e = world.hero();
      if (f && f.mode === 'follow' && f.target && f.target !== 'hero') {
        const t = String(f.target);
        if (t === 'p1' || t === 'p2') e = world.heroById(t);
        else {
          const id = t.startsWith('obj:') ? t.slice(4) : t;
          e = (world.entities || []).find(x => x.id === id) || e;
        }
      }
      return { x: (e ? (e.px != null ? e.px : e.x) : 0) + 0.5, y: (e ? (e.py != null ? e.py : e.y) : 0) + 0.5 };
    },
    /** Centre on what is wanted, easing any move, clamped to the map. */
    update(world, dt) {
      const view = world.map;
      if (!view) return world.camera;
      const tw = world.cameraTween;
      if (tw && !(tw.ms > 0)) {                    // no time asked for: it happens at once
        world.camera.zoom = tw.toZoom;
        world.cameraTween = null;
        world.cameraEase = 1;
      } else if (tw && tw.ms > 0) {
        tw.t = Math.min(tw.ms, tw.t + (dt || 0) * 1000);
        const k = tw.t / tw.ms;
        const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;      // ease in and out
        world.camera.zoom = tw.fromZoom + (tw.toZoom - tw.fromZoom) * ease;
        world.cameraEase = ease;
        if (tw.t >= tw.ms) { world.camera.zoom = tw.toZoom; world.cameraTween = null; world.cameraEase = 1; }
      } else if (world.camera.zoom == null) world.camera.zoom = 1;
      const vp = KIT.camera.viewport(world);
      const want = KIT.camera.wanted(world);
      let cx = want.x - vp.w / 2, cy = want.y - vp.h / 2;
      if (tw && tw.ms > 0 && world.cameraEase < 1) {
        const ease = world.cameraEase || 0;
        cx = (tw.fromX - vp.w / 2) + (cx - (tw.fromX - vp.w / 2)) * ease;
        cy = (tw.fromY - vp.h / 2) + (cy - (tw.fromY - vp.h / 2)) * ease;
      }
      world.camera.x = view.width <= vp.w ? (view.width - vp.w) / 2 : KIT.clamp(cx, 0, view.width - vp.w);
      world.camera.y = view.height <= vp.h ? (view.height - vp.h) / 2 : KIT.clamp(cy, 0, view.height - vp.h);
      return world.camera;
    },
  };
  reg.add({ id: 'camera', order: 90, update(world, dt) { KIT.camera.update(world, dt); if (KIT.atmosphere) KIT.atmosphere.update(dt); } });

  KIT.registry('strings').add({ id: 'needs-both', default: 'This needs both of you!' });

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
