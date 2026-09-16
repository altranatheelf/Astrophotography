// KIT.game — boot, the loop, saves, and the ctx ports.
//
// Everything the script language can ask for (§9.1 "The ctx ports") is
// implemented here in terms of the scenes, KIT.fx, KIT.audio and the world:
// `io` opens scenes, `screen` drives KIT.fx, `map` moves characters and
// transfers between maps, `game` opens the menu and saves. The world itself
// stays headless — swap these ports for fakes and the same story runs in Node.
//
//   await KIT.game.boot({ mount: document.body, project })
//   KIT.game.warp('town', 12, 4, 'down'); KIT.game.press('a'); KIT.game.tick(300)
//
// Test hooks (§12): state project world scene() newGame warp press tick
// rngOverride loadProject — plus the URL flags ?fast=1 ?edit=1 ?test=<id>.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const E = KIT.entities;
  const STEP = 1 / 60;

  const G = KIT.game = {
    project: null, world: null, renderer: null, ports: null,
    flags: { fast: false, edit: false, test: null, debug: false },
    rngOverride: null,
    booted: false,
  };

  let canvas = null, controls = null;
  let raf = null, last = 0, acc = 0, playtimeMs = 0;
  let cameraScroll = null;                 // { x, y } added after the camera system runs
  const commandRoutes = [];                // entities moving on a moveRoute (with their resolvers)
  let autosaveQueued = false;

  const settings = () => KIT.storage.settings();
  const wait = (ms) => new Promise(res => setTimeout(res, KIT.fx.instant ? Math.min(16, ms) : ms));

  // ---- URL flags ------------------------------------------------------------------
  function readFlags() {
    let q = {};
    try {
      const s = new URLSearchParams((root.location && root.location.search) || '');
      q = { fast: s.get('fast') === '1', edit: s.get('edit') === '1', test: s.get('test'), debug: s.get('debug') === '1' };
    } catch (e) { q = { fast: false, edit: false, test: null, debug: false }; }
    G.flags = q;
    KIT.fx.instant = !!q.fast;
    return q;
  }

  // ---- the ports (§9.1) -------------------------------------------------------------
  function buildPorts() {
    const io = {
      say: (o) => KIT.scenes.run('dialogue', o),
      choice: (o) => KIT.scenes.run('choice', o),
      nameEntry: async (o) => {
        const name = await KIT.scenes.run('nameEntry', o);
        if (name) {
          const used = (KIT.storage.meta().namesUsed || []).concat([name]).slice(-12);
          KIT.storage.saveMeta({ namesUsed: used });
        }
        return name;
      },
      inputNumber: (o) => KIT.scenes.run('inputNumber', o),
      toast: (o) => KIT.toast(o && o.text),
      chapter: (o) => KIT.scenes.run('chapter', o),
      scrollText: (o) => KIT.scenes.run('scrollText', o),
      wait: (ms) => wait(Number(ms) || 0),
    };

    const audio = {
      play: (id, o) => { KIT.audio.play(id, o); return Promise.resolve(); },
      music: (id, o) => KIT.audio.music(id, o),
      stop: (what) => KIT.audio.stop(what),
      save: () => KIT.audio.save(),
      replay: () => KIT.audio.replay(),
      jingle: (id) => KIT.audio.jingle(id),
    };

    const screen = {
      fadeOut: (o) => KIT.fx.fadeOut(o),
      fadeIn: (o) => KIT.fx.fadeIn(o),
      tint: (o) => KIT.fx.tint(o),
      flash: (o) => KIT.fx.flash(o),
      shake: (o) => KIT.fx.shake(o),
      weather: (o) => KIT.fx.weather(o),
    };

    const pictures = {
      show: (o) => KIT.fx.show(o),
      move: (o) => KIT.fx.move(o),
      erase: (o) => KIT.fx.erase(o),
    };

    /** target -> entity: self | hero | p1 | p2 | obj:<id> */
    function resolve(target, ctxEntity) {
      const w = G.world;
      if (!w) return null;
      const t = String(target || 'self');
      if (t === 'self') return ctxEntity || null;
      if (t === 'hero') return w.hero();
      if (t === 'p1') return w.heroes[0];
      if (t === 'p2') return w.heroes[1] || w.heroes[0];
      if (t.startsWith('obj:')) {
        const id = t.slice(4);
        return w.entities.find(e => e.id === id) || null;
      }
      return w.entities.find(e => e.id === t) || null;
    }
    // `self` needs the entity whose script is running. The world tracks that as
    // `world.activeEntity` for main-thread scripts; `_bindEntity` covers background
    // (tick) scripts, which the world does not mark because several can overlap.
    let boundEntity = null;
    G._bindEntity = (e) => { boundEntity = e; };
    const currentEntity = () => (G.world && G.world.activeEntity) || boundEntity;

    const map = {
      async transfer(o) {
        const w = G.world;
        if (!w) return;
        const fade = o.fade !== false;
        if (fade) await KIT.fx.fadeOut({ ms: 220 });
        await w.enterMap(o.map, o.x || 0, o.y || 0, o.dir || 'down');
        queueAutosave();
        if (fade) await KIT.fx.fadeIn({ ms: 220 });
      },
      async setLocation(o) {
        const w = G.world;
        const e = resolve(o.target, currentEntity());
        if (!e || !w) return;
        if (o.swap) {
          const other = resolve(o.swap, currentEntity());
          if (other) { const x = e.x, y = e.y; place(e, other.x, other.y); place(other, x, y); }
          return;
        }
        place(e, o.x || 0, o.y || 0);
      },
      moveRoute(o) {
        const e = resolve(o.target, currentEntity());
        if (!e) return Promise.resolve();
        E.startRoute(e, o.steps || [], { repeat: !!o.repeat, skipBlocked: o.skipBlocked !== false });
        e.data.commandRoute = true;
        if (o.wait === false || o.repeat) return Promise.resolve();
        return new Promise((resolve2) => { commandRoutes.push({ e, resolve: resolve2 }); });
      },
      scrollMap(o) {
        const dx = o.dx || 0, dy = o.dy || 0;
        const speed = Math.max(1, o.speed || 4);
        const ms = (Math.abs(dx) + Math.abs(dy)) / speed * 1000;
        cameraScroll = cameraScroll || { x: 0, y: 0 };
        const from = { x: cameraScroll.x, y: cameraScroll.y };
        const to = { x: from.x + dx, y: from.y + dy };
        return new Promise((resolve2) => {
          const t0 = nowMs();
          const tickScroll = () => {
            const k = KIT.fx.instant ? 1 : Math.min(1, (nowMs() - t0) / Math.max(1, ms));
            cameraScroll = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
            if (k >= 1) resolve2(); else setTimeout(tickScroll, 16);
          };
          tickScroll();
        });
      },
      transparency(o) { const e = resolve(o.target || 'hero', currentEntity()); if (e) e.opacity = o.on !== false ? 0 : 1; return Promise.resolve(); },
      async animation(o) {
        // No animation system yet: a sparkle and a beat is the honest placeholder.
        const e = resolve(o.target, currentEntity());
        KIT.audio.play('sparkle');
        if (e) e.data.balloon = { kind: '✦', start: nowMs(), ms: 500 };
        await wait(320);
      },
      async balloon(o) {
        const e = resolve(o.target, currentEntity());
        if (e) e.data.balloon = { kind: o.kind || '!', start: nowMs(), ms: 1100 };
        if (o.wait) await wait(1100);
      },
      erase(o) {
        const e = resolve(o.target, currentEntity());
        if (e) { e.visible = false; e.solid = false; }
        return Promise.resolve();
      },
      camera(o) {
        const w = G.world;
        if (!w || !KIT.camera) return Promise.resolve();
        const target = o.mode === 'follow' && o.target && o.target !== 'hero' ? o.target : (o.target || 'hero');
        KIT.camera.focus(w, { mode: o.mode || 'follow', target, x: o.x, y: o.y, zoom: o.zoom, ms: o.ms });
        if (o.wait === false || !(o.ms > 0)) return Promise.resolve();
        return new Promise((res) => setTimeout(res, o.ms));
      },
      async shift(o) {
        const w = G.world;
        if (!w || !w.shift) return;
        await w.shift(o.to || null, { ms: o.ms });
        if (KIT.atmosphere && w.map && w.map.atmosphere) KIT.atmosphere.set(w.map.atmosphere, { ms: o.ms == null ? 300 : o.ms });
        queueAutosave();
      },
      light(o) {
        const e = resolve(o.target || 'self', currentEntity());
        if (!e) return Promise.resolve();
        e.data = e.data || {};
        e.data.light = o.radius > 0 ? { radius: o.radius, color: o.color, flicker: o.flicker, softness: o.softness } : null;
        return Promise.resolve();
      },
      follow(o) {
        const w = G.world;
        if (!w) return Promise.resolve();
        const second = w.heroes[1];
        if (!second) return Promise.resolve();
        if (o.on === false) { second.visible = false; second.solid = false; second.data.trail = []; }
        else { const lead = w.hero(); second.visible = true; second.solid = !w.coop ? false : true; place(second, lead.x, lead.y); }
        return Promise.resolve();
      },
    };

    const game = {
      menu: () => KIT.scenes.run('menu', { game: G }),
      save: (o) => G.save((o && o.slot) || 'autosave'),
      title: () => { G.toTitle(); return Promise.resolve(); },
      heal: async (o) => { KIT.audio.play('heal'); await wait(200); return true; },
      debug: (o) => {
        const text = (o && o.text) || '';
        (KIT.log || console).log('[debug]', text);
        if (G.flags.debug) KIT.toast('debug: ' + text);
        return Promise.resolve();
      },
    };

    const input = { pressed: (key, hero) => KIT.input.pressed(key, hero === 'p2' ? 2 : 1) };
    return { io, audio, screen, pictures, map, game, input };
  }

  function nowMs() { return root.performance ? performance.now() : Date.now(); }
  function place(e, x, y) { e.x = x; e.y = y; e.px = x; e.py = y; e.mover.moving = false; }

  // ---- the world --------------------------------------------------------------------
  function heroDefaults(project) {
    const start = project.start || {};
    return (project.heroes || []).map(h => ({ map: start.map, x: start.x || 0, y: start.y || 0, dir: start.dir || 'down', name: h.name }));
  }

  /** A fresh save from the project's defaults (§7), optionally seeded by a test state. */
  function blankSave(project, testState) {
    const vars = {};
    for (const name of Object.keys(project.vars || {})) vars[name] = project.vars[name].default;
    const start = project.start || {};
    const save = {
      version: 2, projectId: (project.meta && project.meta.id) || 'kit', savedAt: null, playtimeMs: 0, slotLabel: null,
      heroes: heroDefaults(project), activeHero: 0,
      vars, inventory: {}, objects: {}, overlays: {}, modules: {},
      clock: { day: 1, minutes: 480, lastSeenAt: null },
      timer: { running: false, secondsLeft: 0 },
      music: { current: null, saved: null },
      steps: 0,
      seed: Math.floor(Math.random() * 1e9),
    };
    if (testState) {
      Object.assign(save.vars, testState.vars || {});
      Object.assign(save.inventory, testState.inventory || {});
      Object.assign(save.modules, testState.modules || {});
      for (const h of save.heroes) { h.map = testState.map || h.map; h.x = testState.x || 0; h.y = testState.y || 0; h.dir = testState.dir || 'down'; }
    }
    return save;
  }

  /** Build the live world for a save and wire the runtime-only hooks onto it. */
  function buildWorld(save) {
    const project = G.project;
    const rng = typeof G.rngOverride === 'function' ? G.rngOverride
      : (G.rngOverride != null ? KIT.rng(G.rngOverride) : KIT.rng(save.seed || 1));
    const world = KIT.world.create({ project, save, ports: G.ports, rng, events: KIT.events('world') });

    // `ctx.input` comes from the world's own ports; the entity binding only has to
    // cover background (tick) scripts, which the world does not mark as active.
    const baseMakeCtx = world.makeCtx;
    world.makeCtx = function (entity, heroId) {
      const ctx = baseMakeCtx(entity, heroId);
      if (entity) G._bindEntity(entity);
      return ctx;
    };

    world.coop = !!settings().coop || !!(project.settings.coop && project.settings.coop.enabled);
    world.activeHero = Math.min(save.activeHero || 0, world.heroes.length - 1);
    world.events.on('mapEnter', (e) => { queueAutosave(); useAtmosphere(e && e.map); });
    world.events.on('heal', () => KIT.audio.play('heal'));

    G.world = world;
    KIT.input.setPlayers(world.coop ? 2 : 1);
    return world;
  }

  // ---- saving ------------------------------------------------------------------------
  function snapshot() {
    const w = G.world;
    if (!w) return null;
    w.saveHeroPositions();
    w.save.activeHero = w.activeHero;
    w.save.playtimeMs = Math.round(playtimeMs);
    w.save.music = { current: KIT.audio.current(), saved: w.save.music ? w.save.music.saved : null };
    return w.save;
  }
  G.save = async function (slot) {
    const s = snapshot();
    if (!s) return false;
    return await KIT.storage.saveGame(slot || 'autosave', s);
  };
  function queueAutosave() {
    if (autosaveQueued) return;
    autosaveQueued = true;
    setTimeout(() => { autosaveQueued = false; G.save('autosave'); }, 50);
  }

  // ---- the loop -------------------------------------------------------------------------
  /** The camera clamps to what really fits on screen — `world.viewport`, never the saved project. */
  function syncViewport() {
    if (!G.renderer || !G.world) return;
    const vt = G.renderer.viewTiles();
    const vp = G.world.viewport || (G.world.viewport = { w: vt.w, h: vt.h });
    if (vp.w !== vt.w || vp.h !== vt.h) { vp.w = vt.w; vp.h = vt.h; }
  }

  function step(dt) {
    KIT.scenes.update(dt);
    const w = G.world;
    const top = KIT.scenes.top();
    syncViewport();
    if (w && w.map && !(top && top.pausesWorld)) {
      w.update(dt);
      playtimeMs += dt * 1000;
      updateCommandRoutes(dt);
      if (cameraScroll) { w.camera.x += cameraScroll.x; w.camera.y += cameraScroll.y; }
      const h = w.hero();
      if (h) KIT.audio.setListener({ map: w.map.id, x: h.x, y: h.y });
    }
  }
  function updateCommandRoutes(dt) {
    const w = G.world;
    const all = w.entities.concat(w.heroes, w.companion ? [w.companion] : []);
    for (const e of all) {
      if (!e.data.commandRoute) continue;
      if (e.route && !e.route.done) continue;      // the movement system steps it
      {
        e.data.commandRoute = false;
        for (let i = commandRoutes.length - 1; i >= 0; i--) {
          if (commandRoutes[i].e === e) { commandRoutes[i].resolve(); commandRoutes.splice(i, 1); }
        }
      }
    }
  }
  function render() {
    if (!G.renderer) return;
    if (G.world && G.world.map) G.renderer.render(G.world);
  }
  function frame(t) {
    raf = root.requestAnimationFrame(frame);
    const dt = Math.min(0.25, (t - last) / 1000 || 0);
    last = t;
    acc += dt;
    let guard = 0;
    while (acc >= STEP && guard++ < 6) { step(STEP); acc -= STEP; }
    render();
  }
  function startLoop() {
    if (raf) return;
    last = nowMs();
    raf = root.requestAnimationFrame(frame);
  }

  // ---- boot -----------------------------------------------------------------------------
  G.resize = function () {
    if (!G.renderer) return;
    G.renderer.resize();
    syncViewport();
    render();
  };

  /** boot({ mount, project }) -> Promise<KIT.game> */
  G.boot = async function (opts) {
    opts = opts || {};
    readFlags();
    await KIT.storage.ready();

    G.project = opts.project || KIT.project.blank();
    useAssets(G.project);
    KIT.storage.projectId((G.project.meta && G.project.meta.id) || 'kit');

    canvas = KIT.ui.el('game-canvas');
    controls = KIT.ui.el('controls');
    if (!canvas) throw new Error('KIT.game.boot: no #game-canvas in the page');

    const s = settings();
    KIT.audio.setEnabled(s.sound !== false);
    KIT.audio.setMusic(s.music !== false);
    KIT.audio.setVolume('sound', s.soundVolume == null ? 0.9 : s.soundVolume);
    KIT.audio.setVolume('music', s.musicVolume == null ? 0.5 : s.musicVolume);

    G.ports = buildPorts();
    G.renderer = KIT.renderer.create({ canvas, project: G.project });
    G.resize();

    KIT.input.attach(canvas);
    KIT.input.mount(controls, { players: s.coop ? 2 : 1 });
    KIT.input.onPress((ev) => {
      KIT.audio.unlock();
      KIT.scenes.input(ev);
    });
    root.addEventListener('resize', () => G.resize());
    if (typeof ResizeObserver === 'function') {          // the layout settles after the first frames
      const ro = new ResizeObserver(() => G.resize());
      ro.observe(canvas.parentNode || canvas);
    }
    root.addEventListener('orientationchange', () => setTimeout(() => G.resize(), 120));
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) KIT.audio.unlock(); });
    }
    startLoop();
    G.booted = true;

    if (G.flags.edit && G.openEditor()) return G;                    // ?edit=1 — straight into Creator Mode
    if (G.flags.test) {
      const st = (G.project.testStates || []).find(t => t.id === G.flags.test);
      await G.newGame({ testState: st || null });
      return G;
    }
    titleLoop();
    return G;
  };

  /**
   * The title runs in a loop: New Game or Continue leaves it, Settings comes back.
   *
   * `titleRun` is what stops it fighting anything that starts a game from
   * OUTSIDE the title — a test, a tool, Creator Mode's Play here. Those call
   * newGame or continueGame, which clear the scene stack, which finishes the
   * title scene this loop is awaiting; without the check the loop would read
   * that as “the player chose nothing” and start a new game over the top of the
   * one just loaded. Every run gets its own token, so a loop that has been
   * superseded stops rather than acting on a stale answer.
   */
  let titleRun = null;
  async function titleLoop() {
    const mine = titleRun = {};
    for (;;) {
      const action = await KIT.scenes.run('title', { project: G.project, game: G });
      if (titleRun !== mine) return;             // somebody started a game without us
      if (action === 'continue') {
        const ok = await G.continueGame();
        if (ok || titleRun !== mine) return;
        await KIT.toast('No save to continue from yet.');
        continue;
      }
      await G.newGame({});
      return;
    }
  }
  /** Called by anything that starts a game: the title loop is not in charge any more. */
  function leaveTitle() { titleRun = null; }

  G.toTitle = function () {
    KIT.scenes.clear();
    KIT.fx.reset();
    G.world = null;
    KIT.audio.music(null, { fade: 200 });
    titleLoop();
  };

  // ---- new game / continue ----------------------------------------------------------------
  G.newGame = async function (opts) {
    opts = opts || {};
    const project = G.project;
    const testState = opts.testState || null;
    const save = blankSave(project, testState);
    if (opts.names) (opts.names || []).forEach((n, i) => { if (save.heroes[i] && n) save.heroes[i].name = n; });
    playtimeMs = 0;

    const meta = KIT.storage.meta();
    await KIT.storage.saveMeta({ runs: (meta.runs || 0) + 1, firstPlayed: meta.firstPlayed || new Date().toISOString() });

    const world = buildWorld(save);
    leaveTitle();
    KIT.scenes.clear();
    KIT.fx.reset();
    KIT.scenes.push('map', { game: G });
    const at = save.heroes[0];
    await world.enterMap(at.map || project.start.map, at.x, at.y, at.dir);
    await G.save('autosave');
    // `silent` is Creator Mode's "Play here": drop us in without the chapter cards
    // and autorun scripts that belong to the beginning of the story.
    if (!opts.silent) await KIT.interpreter.runAuto(project, world.makeCtx(null, world.hero().id));
    return world;
  };

  /** continueGame(slot) — a named slot, or (with no slot) the most recent save of any kind. */
  G.continueGame = async function (slot) {
    let save = null;
    if (slot) save = await KIT.storage.loadGame(slot);
    else {
      const list = (await KIT.storage.listGames()).filter(s => s.exists);
      list.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
      if (list[0]) save = await KIT.storage.loadGame(list[0].slot);
    }
    if (!save) return false;
    playtimeMs = save.playtimeMs || 0;
    const world = buildWorld(save);
    leaveTitle();
    KIT.scenes.clear();
    KIT.fx.reset();
    KIT.scenes.push('map', { game: G });
    const at = (save.heroes && save.heroes[0]) || {};
    await world.enterMap(at.map || G.project.start.map, at.x || 0, at.y || 0, at.dir || 'down');
    if (save.music && save.music.current) KIT.audio.music(save.music.current, { fade: 300 });
    return true;
  };

  // ---- Creator Mode ---------------------------------------------------------------------------
  /**
   * openEditor({ mapId }) — the pause menu and ?edit=1 both come through here.
   * Where the player is standing is remembered, so closing Creator Mode puts them
   * back on the same tile with the edits in place.
   */
  G.openEditor = function (opts) {
    if (!KIT.editor || typeof KIT.editor.open !== 'function') return false;
    const w = G.world;
    G._editorReturn = w && w.map ? { save: KIT.deepClone(snapshot()), map: w.map.id } : null;
    KIT.editor.open({
      game: G,
      project: G.project,
      mapId: (opts && opts.mapId) || (w && w.map ? w.map.id : null) || (G.project.start && G.project.start.map),
    });
    return true;
  };

  /** resumeFromEditor(project) — Creator Mode closed: take its project and put the player back. */
  G.resumeFromEditor = async function (project) {
    if (project) G.loadProject(project);
    const back = G._editorReturn;
    G._editorReturn = null;
    if (!back || !back.save) { G.toTitle(); return false; }
    const save = back.save;
    const at = (save.heroes && save.heroes[save.activeHero || 0]) || {};
    let map = at.map || back.map;
    if (!G.project.maps[map]) map = (G.project.start && G.project.start.map) || Object.keys(G.project.maps)[0];
    const width = G.project.maps[map].width, height = G.project.maps[map].height;
    const x = KIT.clamp(at.x || 0, 0, width - 1), y = KIT.clamp(at.y || 0, 0, height - 1);
    playtimeMs = save.playtimeMs || 0;
    const world = buildWorld(save);
    KIT.scenes.clear();
    KIT.fx.reset();
    KIT.scenes.push('map', { game: G });
    await world.enterMap(map, x, y, at.dir || 'down');
    G.resize();
    return true;
  };

  // ---- runtime controls ----------------------------------------------------------------------
  G.openMenu = function () { return KIT.scenes.run('menu', { game: G }); };
  G.openDebug = function () { return KIT.scenes.run('debug', { game: G }); };
  G.swapHero = function () {
    const w = G.world;
    if (!w || w.heroes.length < 2) return;
    w.setActiveHero((w.activeHero + 1) % w.heroes.length);
    KIT.audio.play('blip');
  };
  /** setCoop(on) — two heroes on screen, one pad each; off puts hero 2 back on the trail. */
  G.setCoop = function (on) {
    const w = G.world;
    KIT.storage.saveSettings({ coop: !!on });
    KIT.input.setPlayers(on ? 2 : 1);
    if (!w) return;
    w.coop = !!on;
    const second = w.heroes[1];
    if (second) {
      second.visible = true;
      second.solid = !!on;
      if (on) {
        const lead = w.hero(0);
        if (second.x === lead.x && second.y === lead.y) {
          for (const dir of ['left', 'right', 'down', 'up']) {
            const r = w.map.passable(lead.x, lead.y, dir, second);
            if (r.ok && r.to) { place(second, r.to.x, r.to.y); break; }
          }
        }
        w.setActiveHero(0);
      } else {
        second.data.trail = [];
      }
    }
    w.rebuildEntities();
  };

  // ---- the testability API (§12) ----------------------------------------------------------------
  Object.defineProperty(G, 'state', { get() { return G.world ? G.world.save : null; } });
  G.scene = function () { const t = KIT.scenes.top(); return t ? t.id : null; };
  G.warp = function (map, x, y, dir) { return G.ports.map.transfer({ map, x, y, dir: dir || 'down', fade: false }); };
  G.press = function (key, player, ms) { KIT.input.press(key, player || 1, ms); return G; };
  G.hold = function (key, player, down) { KIT.input.set(key, player || 1, down !== false); return G; };
  /** tick(ms) — advance the fixed-step loop by hand (tests; the rAF loop keeps running too). */
  G.tick = function (ms) {
    let left = (ms == null ? 16 : ms) / 1000;
    let guard = 0;
    while (left > 0 && guard++ < 600) { step(Math.min(STEP, left)); left -= STEP; }
    render();
    return G;
  };
  /** A map may carry its own light and weather; entering it fades to that. */
  function useAtmosphere(mapId, ms) {
    if (!KIT.atmosphere || !G.project) return;
    const map = G.project.maps && G.project.maps[mapId];
    KIT.atmosphere.useMap(map, { ms: ms == null ? 300 : ms });
  }
  G.useAtmosphere = useAtmosphere;

  /** Register the project's imported images and start decoding them; redraw as they arrive. */
  function useAssets(project) {
    if (!KIT.assets) return;
    KIT.project.registerContent(project);          // imported tiles/sprites/faces/icons + assets
    KIT.assets.fromProject(project);
    if (!useAssets.watching && KIT.pixels.onImageLoaded) {
      useAssets.watching = KIT.pixels.onImageLoaded(() => { if (G.renderer) G.renderer.clearCaches(); });
    }
    KIT.assets.loadAll().then((r) => { if (r.ready && G.renderer) G.renderer.clearCaches(); });
  }
  G.useAssets = useAssets;

  /** loadProject(project) — swap the whole world (tests, the editor, an import). */
  G.loadProject = function (project) {
    const n = KIT.project.normalize(project);
    G.project = n.project;
    useAssets(G.project);
    KIT.storage.projectId((G.project.meta && G.project.meta.id) || 'kit');
    if (G.renderer) { G.renderer.setProject(G.project); G.resize(); }
    const top = KIT.scenes.top();
    if (top && top.id === 'title') {           // redraw the title for the new project without ending the title loop
      if (top.exit) top.exit();
      if (top.enter) top.enter({ project: G.project, game: G });
    }
    return n.problems;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
