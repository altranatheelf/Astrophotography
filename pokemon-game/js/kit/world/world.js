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

    const world = {
      project, save, events, rng, ports,
      map: null, entities: [], heroes: [], companion: null,
      activeHero: 0, coop: !!(project.settings && project.settings.coop && project.settings.coop.enabled),
      busy: false,                 // a main-thread script is running: input is locked
      time: 0, systems: [],
      initDone: {},                // 'map:obj' -> true for this visit
      camera: { x: 0, y: 0 },
    };

    // ---- heroes ---------------------------------------------------------------
    function makeHeroes() {
      world.heroes = (project.heroes || []).map((h, i) => {
        const st = (save.heroes || [])[i] || {};
        return E.create({ id: h.id || `p${i + 1}`, kind: 'hero', x: st.x || 0, y: st.y || 0, dir: st.dir || 'down', sprite: h.sprite, speed: E.DEFAULT_SPEED, solid: true });
      });
    }
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
    world.enterMap = async function (mapId, x, y, dir) {
      const from = world.map ? world.map.id : null;
      if (from) { for (const s of world.systems) if (s.onMapLeave) s.onMapLeave(world); events.emit('mapLeave', { map: from }); }
      world.map = KIT.mapView(project, save, mapId);
      world.initDone = {};
      const lead = world.hero();
      for (const h of world.heroes) { h.x = x; h.y = y; h.px = x; h.py = y; h.dir = dir || h.dir; h.mover.moving = false; }
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
    world.ctxBase = () => ({ world, project, save, hero: world.hero() ? world.hero().id : 'p1', coop: world.coop });
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
      if (!background) {
        if (world.busy) return null;
        world.busy = true;
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

    /** interact(heroIndex) -> Promise<boolean> — the A button. */
    world.interact = async function (heroIndex) {
      if (world.busy) return false;
      const h = world.hero(heroIndex);
      if (!h || h.mover.moving) return false;
      const t = world.map.interactTarget(h.x, h.y, h.dir);
      if (!t) return false;
      const spots = [t.first].concat(t.second ? [t.second] : []);
      for (const spot of spots) {
        const hit = world.entities.find(e => e.x === spot.x && e.y === spot.y && e.page && e.page.on && e.page.on.interact);   // invisible events still react (MV transparency)
        if (hit) { await world.runSlot(hit, 'interact', h.id); return true; }
      }
      // an object under the hero's own feet (a sign mat, an item) may also react
      const under = world.entities.find(e => e.x === h.x && e.y === h.y && e.layer === 'below' && e.page && e.page.on && e.page.on.interact);
      if (under) { await world.runSlot(under, 'interact', h.id); return true; }
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
      if (!r.ok) { if (ports.audio && ports.audio.play && r.reason !== 'turn') ports.audio.play('bump'); return r; }
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
    };

    // Keep pages fresh when the story state changes.
    events.on('varChanged', refreshPages);
    events.on('selfChanged', refreshPages);
    events.on('objectStateChanged', () => { buildEntities(); });

    return world;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
