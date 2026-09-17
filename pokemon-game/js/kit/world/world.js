// World (§8.2-§8.4): the live game — project + save + the current map view +
// entities + the event bus + the systems that run each tick. Headless: it talks
// to the outside only through the `ports` it is given (the same ports commands
// use), so a whole session can be played in Node with fake ports.
//
//   const world = KIT.world.create({ project, save, ports })
//   await world.enterMap('town', 5, 6, 'down')
//   world.update(1/60); world.interact(0)
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const E = KIT.entities;
  const I = KIT.interpreter;
  const C = KIT.conditions;
  const W = KIT.world = KIT.world || {};

  const SLOT_EVENTS = { interact: 'interact', step: 'step', touch: 'touch', enter: 'enter', tick: 'tick', init: 'init' };

  /** create({ project, save, ports, rng, events }) -> world */
  W.create = function (opts) {
    const project = opts.project;
    const save = opts.save;
    const ports = opts.ports || {};
    const events = opts.events || KIT.events('world');
    const rng = opts.rng || KIT.rng(save.seed || 1);

    // Every module that declared a save slice gets it filled and migrated here,
    // once, before anything reads it — whether this save is a new game, one
    // loaded from a slot, or one written before the module existed. A module's
    // own code can then assume `save.modules.<key>` is there and current.
    if (KIT.modules && KIT.modules.ensureSaves) KIT.modules.ensureSaves(save);
    // The cast as it was written — who has met whom, who already knows what —
    // goes into the save once, and everything that happens after is the save's.
    if (KIT.cast && KIT.cast.start) KIT.cast.start(project, save);

    const world = {
      project, save, events, rng, ports,
      map: null, entities: [], heroes: [], companion: null,
      // Things DRAWN on the map that are not IN it: a ghost of the thing you are
      // about to put down, a shaded square, a target, a footprint. Push one, and
      // take it away again when you are done. Nothing walks into a marker and
      // nothing talks to it — that is the whole point of it not being an entity.
      // See drawMarkers in render/renderer.js for the fields.
      markers: [],
      interacting: null,           // the promise of the script the last A press started
      viewport: Object.assign({ w: 16, h: 12 }, (project.settings && project.settings.viewport) || {}),   // live tiles on screen; the renderer updates it, the project is not touched
      activeEntity: null,          // the object whose script is running (ports read it to resolve target 'self')
      activeHero: 0, coop: !!(project.settings && project.settings.coop && project.settings.coop.enabled),
      busy: false,                 // a main-thread script is running: input is locked
      time: 0, systems: [],
      initDone: {},                // 'map:obj' -> true for this visit
      camera: { x: 0, y: 0 },
    };

    // ---- heroes ---------------------------------------------------------------
    // Hero 2 is solid only in co-op. On one pad they walk the leader's trail —
    // one step behind, on the square the leader has just left — so a solid hero 2
    // means the player cannot step back the way they came. KIT.game.setCoop
    // flips this when co-op is switched on; a world built without a game (a test,
    // a tool) gets the right answer from the project's own setting.
    function makeHeroes() {
      world.heroes = (project.heroes || []).map((h, i) => {
        const st = (save.heroes || [])[i] || {};
        return E.create({ id: h.id || `p${i + 1}`, kind: 'hero', x: st.x || 0, y: st.y || 0, dir: st.dir || 'down', sprite: h.sprite, speed: E.DEFAULT_SPEED, solid: i === 0 || world.coop });
      });
    }
    // The run a bare save belongs to. KIT.worldBus(save) uses this to tell a
    // thing that happened in the live world from a thing that happened to some
    // other save; KIT.game overwrites it with the same object when there is a
    // game, and a headless world is its own answer.
    W.live = world;

    makeHeroes();
    world.hero = (i) => world.heroes[i == null ? world.activeHero : i];
    world.heroById = (id) => world.heroes.find(h => h.id === id) || world.heroes[0];
    world.setActiveHero = (i) => { world.activeHero = KIT.clamp(i, 0, world.heroes.length - 1); events.emit('activeHero', { index: world.activeHero }); };

    // ---- map entry -------------------------------------------------------------
    /** Build the entity list for the current map from each object's active page. */
    function buildEntities() {
      const view = world.map;
      const list = [];
      for (const obj of view.objects) {
        if (view.isHidden(obj)) continue;
        const active = view.activePage(obj, world.ctxBase());
        if (!active) continue;
        const page = active.page;
        const pos = view.positionOf(obj);
        const e = E.create({
          id: obj.id, kind: obj.type === 'npc' ? 'npc' : 'look', objectKey: view.objectKey(obj), pageIndex: active.index,
          x: pos.x, y: pos.y, dir: pos.dir || page.dir, sprite: page.sprite, look: (page.props && page.props.look) || null,
          layer: page.layer, through: page.through, dirFix: page.dirFix, stepAnim: page.stepAnim, visible: page.visible,
          solid: page.layer === 'same' && !page.through, behaviour: page.behaviour || { kind: 'none' },
        });
        e.object = obj; e.page = page;
        list.push(e);
      }
      world.entities = list;
      refreshBlockers();
    }
    function refreshBlockers() {
      if (world.map) world.map.setBlockers(world.entities.concat(world.heroes.filter(h => h.visible)));
    }
    world.rebuildEntities = buildEntities;

    /** Re-evaluate every object's active page (after a var/self change) without losing positions. */
    function refreshPages() {
      const view = world.map;
      if (!view) return;
      let changed = false;
      const kept = [];
      for (const obj of view.objects) {
        const existing = world.entities.find(e => e.object === obj);
        if (view.isHidden(obj)) { if (existing) changed = true; continue; }
        const active = view.activePage(obj, world.ctxBase());
        if (!active) { if (existing) changed = true; continue; }
        if (existing && existing.pageIndex === active.index) { kept.push(existing); continue; }
        changed = true;
        const pos = existing ? { x: existing.x, y: existing.y, dir: existing.dir } : view.positionOf(obj);
        const page = active.page;
        const e = E.create({ id: obj.id, kind: obj.type === 'npc' ? 'npc' : 'look', objectKey: view.objectKey(obj), pageIndex: active.index,
          x: pos.x, y: pos.y, dir: pos.dir || page.dir, sprite: page.sprite, look: (page.props && page.props.look) || null,
          layer: page.layer, through: page.through, dirFix: page.dirFix, stepAnim: page.stepAnim, visible: page.visible,
          solid: page.layer === 'same' && !page.through, behaviour: page.behaviour || { kind: 'none' } });
        e.object = obj; e.page = page;
        kept.push(e);
      }
      if (changed) { world.entities = kept; refreshBlockers(); }
    }
    world.refreshPages = refreshPages;

    /** enterMap(id, x, y, dir) -> Promise: swaps the map, places the heroes, runs init/enter slots. */
    /**
     * shift(name, opts) — step into another layer of the same place (or back, with null).
     * Position and story state are kept; tiles, objects, light and music change around you.
     */
    world.shift = async function (name, opts) {
      opts = opts || {};
      const before = save.dimension || null;
      const to = name || null;
      if (to === before) return before;
      const map = project.maps[world.map ? world.map.id : null];
      if (to && !(map && map.dimensions && map.dimensions[to])) {
        (KIT.log || console).warn(`[world] this place has no layer called '${to}'`);
        return before;
      }
      save.dimension = to;
      world.map = KIT.mapView(project, save, world.map.id);
      buildEntities();
      events.emit('dimensionChanged', { map: world.map.id, from: before, to });
      if (ports.audio && world.map.music !== undefined && world.map.music !== world.currentMusic) {
        world.currentMusic = world.map.music;
        ports.audio.music(world.map.music || null, { fade: opts.ms || 400 });
      }
      if (opts.runEnter !== false) await runSlotsForMap('enter');
      return to;
    };
    world.dimension = () => save.dimension || null;

    world.enterMap = async function (mapId, x, y, dir, opts) {
      const from = world.map ? world.map.id : null;
      if (from) { for (const s of world.systems) if (s.onMapLeave) s.onMapLeave(world); events.emit('mapLeave', { map: from }); }
      world.map = KIT.mapView(project, save, mapId);
      world.initDone = {};
      const places = (opts && opts.heroes) || null;    // restoring a save may put each hero back on its own tile
      world.heroes.forEach((h, i) => {
        const at = places && places[i] ? places[i] : { x, y, dir };
        h.x = at.x; h.y = at.y; h.px = at.x; h.py = at.y; h.dir = at.dir || dir || h.dir; h.mover.moving = false;
      });
      if (world.heroes[1]) { world.heroes[1].data.trail = []; }
      if (world.companion) { world.companion.x = x; world.companion.y = y; world.companion.px = x; world.companion.py = y; world.companion.data.trail = []; }
      buildEntities();
      saveHeroPositions();
      for (const s of world.systems) if (s.onMapEnter) s.onMapEnter(world);
      events.emit('mapEnter', { map: mapId, from });
      if (ports.audio && project.maps[mapId] && project.maps[mapId].music !== undefined) {
        const track = project.maps[mapId].music;
        if (track && world.currentMusic !== track) { world.currentMusic = track; ports.audio.music(track, { fade: 300 }); }
      }
      await runSlotsForMap('init');
      await runSlotsForMap('enter');
      return world.map;
    };

    function saveHeroPositions() {
      save.heroes = world.heroes.map((h, i) => Object.assign({}, (save.heroes || [])[i] || {}, { map: world.map ? world.map.id : null, x: h.x, y: h.y, dir: h.dir }));
    }
    world.saveHeroPositions = saveHeroPositions;

    // ---- scripts ---------------------------------------------------------------
    /** The base ctx for conditions (no object bound). */
    world.ctxBase = () => ({ world, project, save, hero: world.hero() ? world.hero().id : 'p1', coop: world.coop, input: ports.input || { pressed: () => false } });
    /** makeCtx(entity, heroId) -> the RunCtx commands use (§9.1). */
    world.makeCtx = function (entity, heroId) {
      const ctx = {
        project, world, save, rng: world.rng,
        self: entity && entity.objectKey ? entity.objectKey : null,
        hero: heroId || (world.hero() ? world.hero().id : 'p1'),
        entity: entity || null,
        emit(event, payload) { events.emit(event, payload); },
      };
      for (const group of ['io', 'audio', 'screen', 'pictures', 'map', 'game']) ctx[group] = ports[group] || {};
      ctx.input = ports.input || { pressed: () => false };      // the `button` condition kind
      return ctx;
    };

    /** runSlot(entity, slot, heroId) -> Promise. Main-thread slots lock input; `tick` runs in the background. */
    world.runSlot = async function (entity, slot, heroId) {
      const page = entity && entity.page;
      if (!page || !page.on || !Array.isArray(page.on[slot]) || !page.on[slot].length) return null;
      const key = entity.objectKey;
      if (page.once && slot !== 'tick' && slot !== 'init') {
        const st = save.objects && save.objects[key];
        if (st && st.self && st.self.done) return null;
      }
      if (page.needsBoth && !bothHeroesAdjacent(entity)) {
        events.emit('needsBoth', { object: key });
        if (ports.io && ports.io.toast) await ports.io.toast({ text: KIT.strings.get(project, 'needs-both') });
        return null;
      }
      const ctx = world.makeCtx(entity, heroId);
      const background = slot === 'tick';
      const previousActive = world.activeEntity;
      if (!background) {
        if (world.busy) return null;
        world.busy = true;
        world.activeEntity = entity;          // ports resolve target 'self' through this
        if (entity.kind === 'npc' && !entity.dirFix && slot === 'interact') {
          const h = world.heroById(ctx.hero);
          entity.data.resumeDir = entity.dir;
          E.faceToward(entity, h);
        }
      }
      try {
        const r = await I.run(page.on[slot], ctx, { kind: background ? 'background' : 'main', label: `${key}:${slot}`, path: [key, slot] });
        if (page.once && slot !== 'tick' && slot !== 'init') KIT.commands.state.setSelf(ctx, 'done', true, key);
        return r;
      } finally {
        if (!background) {
          world.busy = false;
          world.activeEntity = previousActive;
          if (entity.data.resumeDir) { entity.dir = entity.data.resumeDir; entity.data.resumeDir = null; }
          refreshPages();
        }
      }
    };
    function bothHeroesAdjacent(entity) {
      if (!world.coop || world.heroes.length < 2) return true;
      return world.heroes.every(h => Math.abs(h.x - entity.x) + Math.abs(h.y - entity.y) <= 1);
    }

    async function runSlotsForMap(slot) {
      for (const e of world.entities.slice()) {
        if (slot === 'init') {
          const k = `${world.map.id}:${e.id}`;
          if (world.initDone[k]) continue;
          world.initDone[k] = true;
        }
        await world.runSlot(e, slot, world.hero() ? world.hero().id : 'p1');
      }
    }
    world.runSlotsForMap = runSlotsForMap;

    // ---- rules -----------------------------------------------------------------
    // Rules are things in the world (js/kit/world/rules.js): `when` an event
    // happens, `if` a condition holds, `do` a script. They listen on '*' and not
    // on a fixed list of events, because the events a rule may watch are simply
    // the events that exist — including any a module invents, which is the whole
    // reason a module can add one.
    //
    // Firings are QUEUED rather than run where they arrive. A rule's `do` is an
    // ordinary command list, so it can say something, and saying something takes
    // time; two footsteps in the same frame must not start two conversations. The
    // queue drains in order, one at a time, and `world.rulesSettled()` is how a
    // test waits for it.
    const ruleQueue = [];
    let draining = false;
    let settled = Promise.resolve();
    /** How many rule firings one drain may do before it calls itself a loop. */
    const RULE_BUDGET = 512;

    function drainRules() {
      if (draining) return settled;
      draining = true;
      settled = (async () => {
        try {
          let n = 0;
          while (ruleQueue.length) {
            if (++n > RULE_BUDGET) {
              // Rules that set off rules is the point; rules that set off rules
              // forever is a frozen game with nothing in the console. R.fire caps
              // the DEPTH of one chain; this caps a chain that goes round through
              // the queue instead, which the depth counter cannot see.
              // Written down BEFORE the queue is emptied, because writing it down
              // is itself an event, and a rule listening for `logged` is exactly
              // the kind of rule that got us here. Empty the queue afterwards and
              // the loop-breaker cannot re-arm the loop.
              const names = ruleQueue.map(j => j.event);
              if (KIT.history) KIT.history.add(save, 'rule:loop', { what: names[0] || null, data: { dropped: names.length } });
              ruleQueue.length = 0;
              (KIT.log || console).warn(`[rules] ${RULE_BUDGET} firings in one drain — dropped ${names.length} more (${Array.from(new Set(names)).join(', ')})`);
              break;
            }
            const job = ruleQueue.shift();
            await KIT.rules.fire(world.makeCtx(null, world.hero() ? world.hero().id : 'p1'), job.event, job.payload);
          }
        } finally { draining = false; }
      })();
      return settled;
    }
    /** rulesSettled() -> a promise for "every rule that had something to do has done it". */
    world.rulesSettled = () => settled;
    world.rulesPending = () => ruleQueue.length;

    if (KIT.rules && opts.rules !== false) {
      events.on('*', (event, payload) => {
        // Asked before queueing, so that the common case — an event no rule
        // watches — costs one lookup and no promise.
        const where = { map: world.map ? world.map.id : null, layer: save.dimension || null };
        if (!KIT.rules.matching(project, save, event, where).length) return;
        ruleQueue.push({ event, payload });
        void drainRules();
      });
    }

    /**
     * interactTargets(hero) -> [{ x, y, answer(hero) }] — things that are not map
     * objects and would still like to be talked to: a follower walking behind
     * you, somebody in a vehicle, a door a module drew itself. A system adds one
     * with `world.addInteractTarget(fn)`, where fn(hero) returns such a list.
     *
     * The map's own objects always answer first; these are asked afterwards, in
     * the order they were added, and the first one at the right square wins.
     */
    const extraTargets = [];
    world.addInteractTarget = function (fn) {
      if (typeof fn !== 'function') return () => {};
      extraTargets.push(fn);
      return () => { const i = extraTargets.indexOf(fn); if (i >= 0) extraTargets.splice(i, 1); };
    };

    /**
     * interact(heroIndex, opts) -> Promise<boolean> — the A button.
     *
     * By default this resolves when the CONVERSATION is over, which is what the
     * map scene wants. `{ wait: false }` resolves as soon as the press has landed
     * and the script has started, which is what anything driving the game from
     * outside wants — a test, a tool, a module that only needs to know somebody
     * was talked to. Awaiting the default from outside waits for the player.
     *
     * `world.interacting` is the running script's promise either way, for a
     * caller that wants both answers.
     */
    world.interact = async function (heroIndex, opts) {
      const wait = !(opts && opts.wait === false);
      if (world.busy) return false;
      const h = world.hero(heroIndex);
      if (!h || h.mover.moving) return false;
      const t = world.map.interactTarget(h.x, h.y, h.dir);
      if (!t) return false;
      const started = (p) => {
        world.interacting = Promise.resolve(p).catch((e) => { (KIT.log || console).error('[world] interact', e); });
        return wait ? world.interacting.then(() => true) : true;
      };
      const spots = [t.first].concat(t.second ? [t.second] : []);
      for (const spot of spots) {
        const hit = world.entities.find(e => e.x === spot.x && e.y === spot.y && e.page && e.page.on && e.page.on.interact);   // invisible events still react (MV transparency)
        if (hit) return started(world.runSlot(hit, 'interact', h.id));
      }
      // an object under the hero's own feet (a sign mat, an item) may also react
      const under = world.entities.find(e => e.x === h.x && e.y === h.y && e.layer === 'below' && e.page && e.page.on && e.page.on.interact);
      if (under) return started(world.runSlot(under, 'interact', h.id));

      // nothing on the map answered: ask whatever else is standing there
      for (const fn of extraTargets.slice()) {
        let list = null;
        try { list = fn(h); } catch (e) { (KIT.log || console).error('[world] interactTarget', e); }
        for (const target of list || []) {
          if (!target || !spots.some(sp => sp.x === target.x && sp.y === target.y)) continue;
          if (typeof target.answer !== 'function') continue;
          // An extra target's own answer decides whether it took the press, so
          // this one is always awaited — there is nothing else to go on.
          const answered = await target.answer(h);
          if (answered !== false) { world.interacting = Promise.resolve(); return true; }
        }
      }

      // and still nothing. A module may want to know: this is the mirror of the
      // `step` event, and it is how an object type reacts without a page.
      events.emit('interactMissed', { hero: h, x: t.first.x, y: t.first.y, dir: h.dir });
      return false;
    };

    /** move(heroIndex, dir, opts) -> Promise<result> — the d-pad. Handles step triggers, connections and warps. */
    world.move = async function (heroIndex, dir, opts) {
      if (world.busy) return { ok: false, reason: 'busy' };
      const h = world.hero(heroIndex);
      if (!h || h.mover.moving) return { ok: false, reason: 'busy' };
      const r = E.tryMove(h, dir, world.map, opts || {});
      if (r.reason === 'connection') {
        const c = r.connection;
        await world.enterMap(c.map, c.x, c.y, dir);
        return r;
      }
      if (!r.ok) {
        if (ports.audio && ports.audio.play && r.reason !== 'turn') ports.audio.play('bump');
        // "The hero tried to move and could not" — the mirror of `step`, and what
        // pushing a block, a locked door's rattle or a wall that answers back is
        // really listening for. Without it a module has to poll the input port
        // every tick to guess that a press happened, which only works for a
        // player pressing a d-pad and not for a route or a script.
        if (r.reason !== 'turn') {
          events.emit('bump', {
            hero: h, heroIndex: heroIndex == null ? world.activeHero : heroIndex,
            dir, reason: r.reason, x: h.x, y: h.y, map: world.map.id,
            // the square they were trying to reach, whether or not anything is on it
            to: r.to || { x: h.x + KIT.delta(dir).dx, y: h.y + KIT.delta(dir).dy },
          });
        }
        return r;
      }
      if (world.companion) E.noteLeaderStep(world.companion, h);
      if (world.heroes[1] && heroIndex === world.activeHero && !world.coop) E.noteLeaderStep(world.heroes[1], h);
      refreshBlockers();
      saveHeroPositions();
      save.steps = (save.steps || 0) + 1;
      const flags = world.map.flagsAt(h.x, h.y);
      events.emit('step', { hero: h.id, heroIndex: heroIndex == null ? world.activeHero : heroIndex, x: h.x, y: h.y, map: world.map.id, tile: flags, region: world.map.region(h.x, h.y) });
      await world.stepTriggers(h);
      return r;
    };

    /** Fires `step` slots for whatever the hero landed on, and the built-in behaviour of warp/item objects. */
    world.stepTriggers = async function (h) {
      const hits = world.entities.filter(e => e.x === h.x && e.y === h.y);
      for (const e of hits) {
        const type = e.object && e.object.type;
        if (type === 'warp') { if (await world.doWarp(e, h)) return; }
        else if (type === 'item') await world.doPickup(e, h);
        if (e.page && e.page.on && e.page.on.step) await world.runSlot(e, 'step', h.id);
      }
    };
    /** A `warp` object carries its destination in props.to — no script needed. */
    world.doWarp = async function (e, h) {
      const to = e.page && e.page.props && e.page.props.to;
      if (!to || !to.map || !project.maps[to.map]) return false;
      if (ports.audio && ports.audio.play && e.page.props.sound !== null) ports.audio.play(e.page.props.sound || 'door');
      if (ports.map && ports.map.transfer) await ports.map.transfer({ map: to.map, x: to.x || 0, y: to.y || 0, dir: to.dir || h.dir, fade: e.page.props.fade !== false });
      else await world.enterMap(to.map, to.x || 0, to.y || 0, to.dir || h.dir);
      return true;
    };
    /** An `item` object gives its item once and disappears for good. */
    world.doPickup = async function (e, h) {
      const props = (e.page && e.page.props) || {};
      if (!props.item) return false;
      const st = save.objects && save.objects[e.objectKey];
      if (st && st.self && st.self.done) return false;
      const ctx = world.makeCtx(e, h.id);
      const count = props.count == null ? 1 : props.count;
      KIT.commands.state.give(ctx, props.item, count);
      KIT.commands.state.setSelf(ctx, 'done', true, e.objectKey);
      if (ports.audio && ports.audio.play) ports.audio.play('item');
      if (ports.io && ports.io.toast) await ports.io.toast({ text: KIT.strings.get(project, 'got-item', { count, item: (project.items[props.item] && project.items[props.item].name) || props.item }) });
      save.objects[e.objectKey].hidden = true;
      events.emit('objectStateChanged', { objectKey: e.objectKey });
      return true;
    };

    // ---- systems ---------------------------------------------------------------
    world.systems = (KIT.registry.exists('systems') ? KIT.registry('systems').list() : []).slice().sort((a, b) => (a.order || 50) - (b.order || 50));
    world.update = function (dt) {
      world.time += dt;
      for (const s of world.systems) { try { s.update(world, dt); } catch (e) { (KIT.log || console).error(`[system ${s.id}]`, e); } }
      // How long were we away? Said once, at the end of the FIRST tick, so every
      // system has installed its listeners and no module has to guess whether it
      // is the one that should announce it. KIT.clock does the measuring.
      if (!world._resumeSaid) {
        world._resumeSaid = true;
        if (KIT.clock && KIT.clock.resume) KIT.clock.resume(world);
      }
    };

    // Keep pages fresh when the story state changes.
    events.on('varChanged', refreshPages);
    events.on('selfChanged', refreshPages);
    events.on('objectStateChanged', () => { buildEntities(); });

    return world;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
