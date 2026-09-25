'use strict';
// The region blueprint: the game you get from one tap.
//
// The point of these tests is that the region is WALKABLE. A generated map that
// validates but has the lab behind a tree, or a route you cannot reach, is the
// same dead end as a blank grid — so the checks here are a flood fill from where
// the player starts, and every door, sign and patch of tall grass has to be in it.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('../kit/_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));

R('js/kit/world/map.js'); R('js/kit/world/entities.js'); R('js/kit/world/world.js'); R('js/kit/systems/index.js');
global.PKMN = global.PKMN || {};
// Solidity lives in the tile art, so the art has to be here or every wall is a
// doorway and the flood fill below proves nothing.
for (const f of ['js/art/tiles.js', 'js/art/chars.js', 'js/art/tiles-nature.js', 'js/art/tiles-town.js', 'js/art/tiles-interior.js', 'js/art/chars-heroes.js', 'js/art/chars-placeholder.js']) R(f);
for (const f of ['js/data/types.js', 'js/data/moves.js', 'js/data/pokemon.js']) R(f);
for (const f of R('tools/load-modules.js').SPRITES()) R(f);
for (const f of ['rules', 'strings', 'art', 'actions', 'script', 'systems', 'essentials', 'region', 'panel', 'manifest']) R('js/modules/mons/' + f + '.js');

KIT.modules.activate({ modules: ['mons'] });
const M = KIT.mons;
const REG = M.region;

const built = KIT.blueprints.build('mons-region', { title: 'Test Region' });
const project = built.project;

/** Every cell you can stand on, starting from one, walking only where the engine lets you. */
function reach(view, from) {
  const seen = new Set([from.x + ',' + from.y]);
  const queue = [from];
  const exits = [];
  while (queue.length) {
    const at = queue.shift();
    for (const dir of ['up', 'down', 'left', 'right']) {
      const step = view.passable(at.x, at.y, dir);
      if (!step.ok) continue;
      if (step.reason === 'connection') { exits.push(step.connection); continue; }
      const to = step.hop || step.to;
      const key = to.x + ',' + to.y;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ x: to.x, y: to.y });
    }
  }
  return { cells: seen, exits, has: (x, y) => seen.has(x + ',' + y) };
}

test('painting: a sketch becomes layers, and a typo is an error rather than a hole', () => {
  const out = REG.paint(['..', '..']);
  assert.equal(out.width, 2);
  assert.equal(out.height, 2);
  assert.deepEqual(out.layers.ground, ['grass', 'grass', 'grass', 'grass']);
  assert.deepEqual(out.layers.terrain, [1, 1, 1, 1]);
  assert.throws(() => REG.paint(['...', '..']), /row 1 is 2 wide/);
  assert.throws(() => REG.paint(['?']), /not in the legend/);
  assert.throws(() => REG.paint([]), /needs rows/);
});

test('painting: a mass of trees becomes 2×2 trees, a line of them becomes small ones', () => {
  const quad = REG.paint(['TT', 'TT']);
  assert.deepEqual(quad.layers.deco, ['tree-tl', 'tree-tr', 'tree-bl', 'tree-br']);
  const line = REG.paint(['TTT']);
  assert.deepEqual(line.layers.deco, ['tree-small', 'tree-small', 'tree-small']);
});

test('the blueprint is registered, and takes the title it is given', () => {
  const ids = KIT.blueprints.list().map(b => b.id);
  assert.ok(ids.includes('mons-region'), 'mons registers its region: ' + ids.join(', '));
  assert.ok(ids.includes('blank'), 'the engine still ships the blank one');
  const named = KIT.blueprints.build('mons-region', { title: 'Hollow Vale' }).project;
  assert.equal(named.meta.title, 'Hollow Vale');
  assert.equal(named.meta.id, 'hollow-vale');
  assert.equal(KIT.blueprints.titleFor('mons-region'), 'A New Region');
  assert.throws(() => KIT.blueprints.build('nothing-like-this', {}), /no blueprint/);
});

test('the region a new game gets has nothing wrong with it', () => {
  const problems = KIT.project.validate(project, {});
  const errors = problems.filter(p => p.severity === 'error');
  const warns = problems.filter(p => p.severity === 'warn');
  assert.deepEqual(errors.map(p => p.code + ' ' + p.message), [], 'errors');
  assert.deepEqual(warns.map(p => p.code + ' ' + p.message), [], 'warnings');
  assert.deepEqual(Object.keys(project.maps).sort(), ['home', 'lab', 'route', 'town']);
  assert.deepEqual(project.modules, ['mons']);
});

test('starting a new game does not switch the engine off under you', () => {
  // Whatever the game being replaced had loaded stays loaded; the blueprint adds
  // what it needs on top. Both doors call the same build(), so they cannot drift.
  const kept = KIT.blueprints.build('mons-region', { title: 'Kept', keepModules: ['home', 'mons'] }).project;
  assert.deepEqual(kept.modules, ['home', 'mons']);
  const blank = KIT.blueprints.build('blank', { title: 'Blank', keepModules: ['mons'] }).project;
  assert.deepEqual(blank.modules, ['mons'], 'a blank map keeps the engine it was started from');
  const alone = KIT.blueprints.build('mons-region', { title: 'Alone' }).project;
  assert.deepEqual(alone.modules, ['mons'], 'and asks for its own when nothing is passed');
});

test('you can walk from where you start to both doors, the sign, and out of town', () => {
  const town = KIT.mapView(project, null, 'town');
  const walk = reach(town, { x: project.start.x, y: project.start.y });
  assert.equal(project.start.map, 'town');
  assert.ok(walk.has(5, 6), 'the tile below your own front door');
  assert.ok(walk.has(5, 5), 'the front door itself, which is where the warp is');
  assert.ok(walk.has(15, 16), 'the tile below the lab door');
  assert.ok(walk.has(15, 15), 'the lab door itself');
  assert.ok(walk.has(3, 12) || walk.has(4, 11), 'somewhere you can read the town sign from');
  assert.ok(walk.has(10, 0) || walk.has(9, 0), 'the top of the path');
  const north = walk.exits.filter(e => e.map === 'route');
  assert.ok(north.length, 'walking north off the town leads to the route');
  assert.equal(north[0].y, project.maps.route.height - 1, 'and arrives at the bottom of it');
});

test('the route is a route: tall grass you can walk into, and a way back', () => {
  const route = KIT.mapView(project, null, 'route');
  const walk = reach(route, { x: 10, y: route.height - 1 });
  let grass = 0, reachableGrass = 0;
  for (let y = 0; y < route.height; y++) {
    for (let x = 0; x < route.width; x++) {
      if (!route.flagsAt(x, y).encounter) continue;
      grass++;
      if (walk.has(x, y)) reachableGrass++;
    }
  }
  assert.ok(grass >= 60, 'the route has tall grass in it: ' + grass);
  assert.equal(reachableGrass, grass, 'and every patch of it can be walked into');
  assert.ok(walk.has(10, 2), 'the path reaches the sign at the north end');
  assert.ok(walk.exits.some(e => e.map === 'town'), 'and walking south comes back to town');
});

test('the town has no tall grass in it, so nothing jumps out at home', () => {
  const town = KIT.mapView(project, null, 'town');
  let n = 0;
  for (let y = 0; y < town.height; y++) for (let x = 0; x < town.width; x++) if (town.flagsAt(x, y).encounter) n++;
  assert.equal(n, 0);
});

test('both interiors let you in, let you out, and have somebody in them', () => {
  for (const [id, mat, back] of [['home', { x: 5, y: 8 }, 'town'], ['lab', { x: 6, y: 9 }, 'town']]) {
    const view = KIT.mapView(project, null, id);
    const walk = reach(view, { x: mat.x, y: mat.y - 1 });
    assert.ok(walk.has(mat.x, mat.y), id + ': you can reach the way out');
    const out = (project.maps[id].objects || []).filter(o => o.type === 'warp');
    assert.equal(out.length, 1, id + ': one way out');
    assert.equal(out[0].pages[0].props.to.map, back, id + ': it goes back to ' + back);
    const dest = out[0].pages[0].props.to;
    const there = KIT.mapView(project, null, dest.map);
    assert.equal(there.flagsAt(dest.x, dest.y).solid, false, id + ': and you do not arrive inside a wall');
  }
  const talkers = (project.maps.lab.objects || []).filter(o => o.type === 'npc');
  assert.ok(talkers.some(o => o.id === 'prof'), 'the professor is in the lab');
});

test('every warp lands somewhere you can stand', () => {
  for (const mapId of Object.keys(project.maps)) {
    for (const obj of project.maps[mapId].objects || []) {
      if (obj.type !== 'warp') continue;
      const to = obj.pages[0].props.to;
      assert.ok(project.maps[to.map], `${mapId}/${obj.id} goes to a map that exists`);
      const view = KIT.mapView(project, null, to.map);
      assert.ok(to.x >= 0 && to.x < view.width && to.y >= 0 && to.y < view.height, `${mapId}/${obj.id} lands inside ${to.map}`);
      assert.equal(view.flagsAt(to.x, to.y).solid, false, `${mapId}/${obj.id} lands somewhere you can stand`);
    }
  }
});

test('the professor offers a partner, and stops offering once you have one', () => {
  const prof = project.maps.lab.objects.find(o => o.id === 'prof');
  assert.equal(prof.pages.length, 2);
  const choice = prof.pages[0].on.interact.find(c => c.t === 'choice');
  assert.ok(choice, 'the first page asks');
  assert.deepEqual(choice.options.map(o => o.then[0].value), REG.STARTERS);
  for (const opt of choice.options) {
    assert.ok(M.species(opt.then[0].value), opt.then[0].value + ' is a species that exists');
    assert.equal(opt.then[1].name, 'hasStarter');
  }
  assert.deepEqual(prof.pages[1].when, { kind: 'var', name: 'hasStarter', op: '==', value: true, var: null });
  assert.equal(project.packs.mons.starters.var, 'starter');
  assert.ok(project.vars.starter, 'the variable the hook reads is declared');
  assert.ok(project.vars.hasStarter, 'and so is the one the second page reads');
});

test('the tall grass has something in it, and everything in it exists', () => {
  const table = M.encounterTable(project.maps.route, project);
  assert.ok(table, 'the route has an encounter table');
  assert.equal(table.rate, 14);
  // Keyed on the regions the map actually paints, which is how Map › Encounters
  // decides what to show. '*' works at runtime and shows nothing in the editor.
  const painted = new Set(['0'].concat(((project.maps.route.layers.regions) || []).filter(Boolean).map(String)));
  for (const key of Object.keys(table.byRegion)) {
    assert.ok(painted.has(key), `the table is keyed on region “${key}”, which the map never paints — the Encounters panel would not show it`);
  }
  const entries = M.entriesFor(table, 0);
  assert.equal(entries.length, REG.WILD.length);
  for (const e of entries) assert.ok(M.species(e.id), e.id + ' is a species that exists');
  // Same seed, same walk, same friends: every one of them can actually turn up.
  const rng = KIT.rng ? KIT.rng(7) : null;
  let seed = 7;
  const roll = rng && typeof rng.next === 'function' ? () => rng.next() : () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const seen = new Set();
  for (let i = 0; i < 5000; i++) { const got = M.rollEncounter(table, 0, roll); if (got) seen.add(got.id); }
  assert.equal(seen.size, entries.length, 'every one of them turns up eventually: ' + [...seen].join(', '));
});

test('the maps are joined both ways, and the seam is walkable from both sides', () => {
  assert.deepEqual(project.world.connections, [{ a: 'town', side: 'n', b: 'route', offset: 0 }]);
  const town = KIT.mapView(project, null, 'town');
  const route = KIT.mapView(project, null, 'route');
  const up = town.connectionAt(10, 0, 'up');
  assert.equal(up && up.map, 'route');
  assert.equal(up.y, route.height - 1);
  const down = route.connectionAt(10, route.height - 1, 'down');
  assert.equal(down && down.map, 'town');
  assert.equal(down.y, 0);
});

test('nothing in it came from a file: every tile and sprite it names is built in', () => {
  const tiles = KIT.registry('tiles');
  const sprites = KIT.registry('sprites');
  for (const mapId of Object.keys(project.maps)) {
    const map = project.maps[mapId];
    for (const layer of ['ground', 'deco', 'above']) {
      for (const id of new Set((map.layers[layer] || []).filter(Boolean))) {
        assert.ok(tiles.has(id), `${mapId}.${layer} uses “${id}”, which no tile file registers`);
      }
    }
    for (const obj of map.objects || []) {
      for (const page of obj.pages || []) {
        if (page.sprite) assert.ok(sprites.has(page.sprite), `${mapId}/${obj.id} uses the sprite “${page.sprite}”`);
      }
    }
  }
  for (const hero of project.heroes) assert.ok(sprites.has(hero.sprite), `the hero sprite “${hero.sprite}”`);
});
