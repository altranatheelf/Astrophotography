// The map scene: the one you play in. It owns nothing — the world updates in
// the game loop and the renderer draws every frame — it only turns held
// buttons into world.move()/world.interact() calls.
//
// Walking rules (§8.5): a direction held for less than KIT.input.TAP_MS only
// turns the hero (that is how you talk to something beside you without
// stepping), anything longer walks, and holding keeps walking.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const scenes = KIT.registry('scenes');
  const DIRS = ['up', 'down', 'left', 'right'];

  scenes.add({
    id: 'map', name: 'Map',
    create(params) {
      const game = (params && params.game) || KIT.game;

      /** Which hero this player drives: in co-op each pad has its own, otherwise everyone drives the leader. */
      function heroIndexFor(world, player) {
        if (!world.coop) return world.activeHero;
        return Math.min(world.heroes.length - 1, player - 1);
      }

      /** The inactive co-op hero stays on screen: a step that would leave the view is refused. */
      function leashed(world, hero, dir) {
        if (!world.coop || hero === world.hero()) return false;
        const r = KIT.game && KIT.game.renderer ? KIT.game.renderer.viewTiles() : { w: 16, h: 12 };
        const d = KIT.delta(dir);
        const nx = hero.x + d.dx, ny = hero.y + d.dy;
        const cam = world.camera;
        return nx < cam.x || ny < cam.y || nx > cam.x + r.w - 1 || ny > cam.y + r.h - 1;
      }

      // Per player: the direction we turned to when this press started. While
      // that press is younger than TAP_MS the hero only turns — that is how you
      // face something beside you without stepping onto it.
      const turned = [null, null];

      function poll(world) {
        if (!world || !world.map || world.busy) return;
        const players = KIT.input.players();
        for (let player = 1; player <= players; player++) {
          const state = KIT.input.state(player);
          const dir = DIRS.find(d => state[d]);
          if (!dir) { turned[player - 1] = null; continue; }
          const i = heroIndexFor(world, player);
          const hero = world.hero(i);
          if (!hero || hero.mover.moving) continue;
          if (hero.dir !== dir) { KIT.entities.tryMove(hero, dir, world.map, { turnOnly: true }); turned[player - 1] = dir; }
          if (turned[player - 1] === dir && KIT.input.heldMs(dir, player) < KIT.input.TAP_MS) continue;
          if (leashed(world, hero, dir)) continue;
          Promise.resolve(world.move(i, dir)).catch(e => (KIT.log || console).error('[map] move', e));
        }
      }

      /** A tap too short for the poll to see (a touch pad tap) still turns the hero. */
      function turnOnPress(world, ev) {
        const i = heroIndexFor(world, ev.player);
        const hero = world.hero(i);
        if (!hero || hero.mover.moving) return;
        if (hero.dir !== ev.key) { KIT.entities.tryMove(hero, ev.key, world.map, { turnOnly: true }); turned[ev.player - 1] = ev.key; }
        else turned[ev.player - 1] = null;
      }

      return {
        id: 'map', transparent: false,
        enter() { const host = KIT.ui.el('game-canvas'); if (host) host.setAttribute('data-scene', 'map'); },
        update(dt, isTop) {
          const world = game && game.world;
          if (!isTop || !world) return;
          poll(world);
        },
        input(ev) {
          const world = game && game.world;
          if (!world) return true;
          if (DIRS.includes(ev.key)) { if (!world.busy) turnOnPress(world, ev); return true; }
          if (ev.key === 'a') {
            const i = world.coop ? Math.min(world.heroes.length - 1, ev.player - 1) : world.activeHero;
            Promise.resolve(world.interact(i)).catch(e => (KIT.log || console).error('[map] interact', e));
            return true;
          }
          if (ev.key === 'menu') { game.openMenu(); return true; }
          if (ev.key === 'swap') { game.swapHero(); return true; }
          return true;
        },
      };
    },
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
