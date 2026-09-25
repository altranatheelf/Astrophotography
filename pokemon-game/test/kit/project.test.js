'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KIT = require('./_load.js');
const P = KIT.project;

// A few tiles / sprites / sounds so reference checks are exercised (registries are per test process).
KIT.registry('tiles').addAll([
  { id: 'grass', group: 'nature' }, { id: 'path', group: 'nature' }, { id: 'floor-wood', group: 'interior' }, { id: 'cave-floor', group: 'cave' },
  { id: 'wall', solid: true }, { id: 'door' }, { id: 'sign', solid: true }, { id: 'water', solid: true },
]);
KIT.registry('sprites').addAll([{ id: 'hero-boy' }, { id: 'hero-girl' }, { id: 'woman' }]);
KIT.registry('sounds').add({ id: 'door' });
// Stub command definitions (the real commands.js is built by another job): collect() and validate() only know shapes via the registry.
KIT.registry('commands').addAll([   // replace:true — the real commands.js may already be loaded; the stubs win in this process
  { id: 'say', label: 'Show Text', background: false, fields: [{ key: 'who', type: 'string', optional: true }, { key: 'text', type: 'text' }, { key: 'face', type: 'face' }] },
  { id: 'setVar', label: 'Control Variables', fields: [{ key: 'name', type: 'ref:var', access: 'write', nullable: false }, { key: 'op', type: 'enum', options: ['set', 'add'], default: 'set' }, { key: 'value', type: 'number' }] },
  { id: 'setSelf', label: 'Self state', fields: [{ key: 'key', type: 'ref:self', access: 'write', nullable: false }, { key: 'value', type: 'bool' }] },
  { id: 'give', label: 'Change Items', fields: [{ key: 'item', type: 'ref:item', nullable: false }, { key: 'count', type: 'number', default: 1 }] },
  { id: 'if', label: 'Conditional Branch', fields: [{ key: 'when', type: 'condition' }, { key: 'then', type: 'script' }, { key: 'else', type: 'script' }] },
  { id: 'choice', label: 'Show Choices', fields: [{ key: 'prompt', type: 'text', optional: true }, { key: 'options', type: 'list', of: { type: 'group', fields: [{ key: 'text', type: 'string' }, { key: 'when', type: 'condition' }, { key: 'then', type: 'script' }] } }] },
  { id: 'transfer', label: 'Transfer Player', fields: [{ key: 'map', type: 'ref:map', nullable: false }, { key: 'x', type: 'number', integer: true }, { key: 'y', type: 'number', integer: true }, { key: 'dir', type: 'direction' }] },
  { id: 'call', label: 'Common Event', fields: [{ key: 'script', type: 'ref:script', nullable: false }] },
  { id: 'erase', label: 'Erase Event', fields: [{ key: 'target', type: 'ref:object', nullable: false }] },
].map(d => Object.assign(d, { replace: true })));

function sample() {
  return {
    version: 3,
    meta: { id: 'demo', title: 'Demo', pitch: 'A kid. A berry.' },
    heroes: [{ id: 'p1', name: 'Ann', sprite: 'hero-boy' }],
    start: { map: 'home', x: 2, y: 2, dir: 'down' },
    vars: { chapter: { type: 'number', default: 0 }, metMom: false },
    items: { berry: { name: 'Berry' } },
    scripts: { 'meet-mom': { body: [{ t: 'say', who: 'Mom', text: 'Hi {p1}' }, { t: 'setVar', name: 'chapter', op: 'set', value: 1 }] } },
    terrains: [{ id: 1, name: 'Grass', base: 'grass' }],
    maps: {
      home: { name: 'Home', width: 6, height: 5, kind: 'indoor', objects: [
        { id: 'mom', name: 'Mom', type: 'npc', x: 3, y: 2, pages: [
          { sprite: 'woman', on: { interact: [{ t: 'if', when: { kind: 'var', name: 'metMom', op: '==', value: true }, then: [{ t: 'say', text: 'Again?' }], else: [{ t: 'call', script: 'meet-mom' }, { t: 'setVar', name: 'metMom', op: 'set', value: 1 }] }] } },
          { when: { kind: 'var', name: 'chapter', op: '>=', value: 2 }, sprite: 'woman', on: { interact: [{ t: 'choice', prompt: 'Berry?', options: [{ text: 'Yes', then: [{ t: 'give', item: 'berry' }] }, { text: 'No', then: [] }] }] } },
        ] },
        { id: 'exit', type: 'warp', x: 2, y: 4, pages: [{ props: { to: { map: 'town', x: 1, y: 0 }, sound: 'door' } }] },
      ] },
      town: { name: 'Town', width: 8, height: 6, kind: 'outdoor' },
    },
    world: { connections: [{ a: 'town', side: 's', b: 'route', offset: 0 }] },
  };
}

test('normalize fills defaults everywhere (maps, layers, pages, props, strings, heroes)', () => {
  const { project: p, problems } = P.normalize(sample());
  assert.equal(p.version, 3);
  assert.equal(p.settings.tileSize, 16); assert.deepEqual(p.settings.viewport, { w: 16, h: 12 });
  assert.equal(KIT.strings.get(p, 'got-item'), 'Got {count} {item}!');
  assert.equal(p.heroes.length, 1); assert.deepEqual(p.heroes[0].recolor, {});
  assert.equal(p.vars.metMom.type, 'bool'); assert.equal(p.vars.metMom.default, false); assert.equal(p.vars.chapter.label, 'Chapter');
  assert.equal(p.items.berry.kind, 'item'); assert.deepEqual(p.items.berry.props, {});
  assert.equal(p.scripts['meet-mom'].trigger, 'call'); assert.equal(p.scripts['meet-mom'].label, 'Meet Mom');
  const home = p.maps.home;
  assert.equal(home.layers.ground.length, 30); assert.equal(home.layers.ground[0], 'floor-wood'); assert.equal(p.maps.town.layers.ground[0], 'grass');
  assert.equal(home.layers.terrain[7], 0); assert.equal(home.layers.deco[7], null); assert.equal(home.layers.regions[7], 0); assert.equal(home.collision.length, 30); assert.equal(home.collision[0], null);
  const mom = home.objects[0];
  assert.equal(mom.pages[0].when, null); assert.equal(mom.pages[0].layer, 'same'); assert.equal(mom.pages[0].behaviour.kind, 'none'); assert.equal(mom.pages[0].behaviour.radius, 3);
  assert.deepEqual(Object.keys(mom.pages[0].on), ['interact']);
  const exit = home.objects[1];
  assert.equal(exit.pages[0].layer, 'below'); assert.equal(exit.pages[0].through, true); assert.equal(exit.pages[0].props.fade, true); assert.equal(exit.pages[0].props.dir, 'down');
  assert.deepEqual(p.world.maps.home, { x: 0, y: 0, folder: '' });
  assert.ok(p.autotiles.default && Array.isArray(p.autotiles.default.groups));
  // problems: the route map in the connection is missing; nothing else
  assert.deepEqual(problems.map(x => x.code), ['bad-connection']);
  assert.equal(problems[0].where.path.join('.'), 'world.connections.0');
  // normalize is idempotent and does not mutate its input
  const again = P.normalize(p).project;
  assert.deepEqual(again, p);
  const raw = sample(); P.normalize(raw); assert.equal(raw.maps.home.layers, undefined);
});

test('blank() is valid, newMap/resize/clone/newObject', () => {
  const b = P.blank();
  assert.deepEqual(P.validate(b).filter(x => x.severity === 'error'), []);
  assert.equal(Object.keys(b.maps).length, 1);
  const m = P.newMap({ id: 'cave-1', name: 'Cave', width: 4, height: 3, kind: 'cave' });
  assert.equal(m.layers.ground[0], 'cave-floor'); assert.equal(m.layers.ground.length, 12);
  m.layers.ground[5] = 'wall'; m.layers.terrain[11] = 1; m.collision[0] = 1;
  const big = P.resize(m, 5, 4);
  assert.equal(big.width, 5); assert.equal(big.layers.ground.length, 20);
  assert.equal(big.layers.ground[6], 'wall');      // (1,1) stays (1,1)
  assert.equal(big.layers.terrain[3 * 5 + 3], 0); assert.equal(big.layers.terrain[2 * 5 + 3], 1);   // (3,2) stays
  assert.equal(big.layers.ground[4], 'cave-floor'); assert.equal(big.collision[0], 1); assert.equal(big.collision[19], null);
  const small = P.resize(m, 2, 2);
  assert.deepEqual(small.layers.ground, ['cave-floor', 'cave-floor', 'cave-floor', 'wall']);
  assert.equal(m.width, 4);                       // pure
  const c = P.clone(b); assert.deepEqual(c, b); assert.notEqual(c.maps, b.maps);
  const o = P.newObject({ type: 'sign', name: 'Town sign', x: 1, y: 2 });
  assert.equal(o.id, 'town-sign'); assert.equal(o.pages[0].props.look, 'sign'); assert.equal(o.pages[0].layer, 'same');
});

test('validate reports every documented code with a where', () => {
  const s = sample();
  s.meta.pitch = '';
  s.heroes[0].sprite = 'ghost';
  s.maps.home.objects.push({ id: 'mom', type: 'npc', x: 1, y: 1 });                        // duplicate id
  s.maps.home.objects.push({ id: 'far', type: 'trigger', x: 99, y: 1 });                    // out of bounds
  s.maps.home.objects.push({ id: 'odd', type: 'ufo', x: 1, y: 1 });                         // unknown type
  s.maps.home.objects.push({ id: 'ghost-npc', type: 'npc', x: 2, y: 2, pages: [{}] });         // a person with no sprite: invisible
  s.maps.home.layers = { ground: [null, 'lava'] };                                          // unknown tile (rest filled)
  for (let i = 0; i < 4; i++) s.maps.town.objects = (s.maps.town.objects || []).concat([{ id: 't' + i, type: 'trigger', x: i, y: 0, pages: [{ on: { tick: [{ t: 'say', text: 'hi' }] } }] }]);
  s.maps.town.objects.push({ id: 'lock', type: 'trigger', x: 5, y: 5, pages: [{ when: { kind: 'var', name: 'chapter', op: '==', value: 0 }, on: { enter: [{ t: 'say', text: '' }] } }] });
  s.maps.town.objects.push({ id: 'w1', type: 'warp', x: 6, y: 5, pages: [{ props: { to: { map: 'nowhere', x: 0, y: 0 } } }] });
  s.maps.town.objects.push({ id: 'w2', type: 'warp', x: 7, y: 5, pages: [{ props: { to: { map: 'home', x: 50, y: 0 } } }] });
  s.maps.town.objects.push({ id: 'w3', type: 'warp', x: 7, y: 4, pages: [{ props: { to: { map: 'home', x: 0, y: 0 } } }] });
  s.maps.home.layers.ground[0] = 'wall';                                                     // w3 lands on a wall
  s.scripts.bad = { trigger: 'parallel', body: [{ t: 'say', text: 'x' }, { t: 'give', item: 'gold' }, { t: 'call', script: 'nope' }, { t: 'erase', target: 'ghost' }, { t: 'setVar', name: 'coins', value: 1 }, { t: 'transfer', map: 'home', x: 1, y: 1 }, { t: 'zap' }] };
  s.scripts.auto = { trigger: 'auto', when: { kind: 'var', name: 'chapter', op: '==', value: 0 }, body: [{ t: 'say', text: 'stuck' }] };
  s.maps.route = { width: 8, height: 4, layers: { ground: new Array(32).fill('water') } };  // connection into water
  s.maps.route.layers.ground[0] = 'grass';
  KIT.registry('validators').add({ id: 'my-lint', run: (project) => [{ severity: 'warn', code: 'my-lint', message: 'custom', where: { path: ['meta'] } }] });
  const { project: p } = P.normalize(s);
  const problems = P.validate(p);
  KIT.registry('validators').remove('my-lint');
  const codes = new Set(problems.map(x => x.code));
  for (const c of ['no-pitch', 'unknown-sprite', 'duplicate-object', 'object-out-of-bounds', 'unknown-object-type', 'unknown-tile', 'too-many-ticks', 'soft-lock', 'empty-text',
    'bad-target', 'target-out-of-bounds', 'target-solid', 'unknown-item', 'unknown-script', 'unknown-object', 'undeclared-var', 'blocking-in-background', 'unknown-command', 'connection-mismatch', 'invisible-object', 'my-lint']) {
    assert.ok(codes.has(c), `expected code ${c} in ${Array.from(codes).join(',')}`);
  }
  const tick = problems.find(x => x.code === 'blocking-in-background' && x.where.slot === 'tick');
  assert.ok(tick && tick.where.map === 'town' && tick.where.object === 't0');
  const par = problems.find(x => x.code === 'blocking-in-background' && x.where.script === 'bad'); assert.ok(par);
  assert.equal(problems.filter(x => x.code === 'soft-lock').length, 2);
  const ut = problems.find(x => x.code === 'unknown-tile'); assert.equal(ut.where.map, 'home'); assert.deepEqual(ut.where.path, ['maps', 'home', 'layers', 'ground', 1]);
  assert.deepEqual(problems.find(x => x.code === 'undeclared-var').where.path, ['scripts', 'bad', 'body', 4, 'name']);
  const dup = problems.find(x => x.code === 'duplicate-object'); assert.equal(dup.severity, 'error'); assert.equal(dup.where.object, 'mom');
  assert.equal(problems.find(x => x.code === 'too-many-ticks').severity, 'warn');
  const ghost = problems.find(x => x.code === 'invisible-object' && x.where.object === 'ghost-npc'); assert.equal(ghost.severity, 'warn'); assert.deepEqual(ghost.where.path, ['maps', 'home', 'objects', 5, 'pages', 0, 'sprite']);
  // every problem has severity/code/message/where
  for (const x of problems) { assert.ok(['error', 'warn'].includes(x.severity)); assert.ok(x.code && x.message && x.where); }
});

test('walkScripts visits slots, scripts and nested branches; collect finds vars and refs', () => {
  const { project: p } = P.normalize(sample());
  const lists = [];
  P.walkScripts(p, (cmds, where) => lists.push(where));
  const paths = lists.map(w => w.path.join('.'));
  assert.ok(paths.includes('maps.home.objects.0.pages.0.on.interact'));
  assert.ok(paths.includes('maps.home.objects.0.pages.0.on.interact.0.then'));
  assert.ok(paths.includes('maps.home.objects.0.pages.0.on.interact.0.else'));
  assert.ok(paths.includes('maps.home.objects.0.pages.1.on.interact.0.options.0.then'));
  assert.ok(paths.includes('maps.home.objects.0.pages.1.on.interact.0.options.1.then'));
  assert.ok(paths.includes('scripts.meet-mom.body'));
  assert.equal(lists.find(w => w.slot === 'interact').object, 'mom');
  const c = P.collect(p);
  assert.deepEqual(Object.keys(c.vars).sort(), ['chapter', 'metMom']);
  assert.equal(c.vars.chapter.declared, true);
  assert.equal(c.vars.chapter.reads.length, 1);          // page 2 `when`
  assert.equal(c.vars.chapter.reads[0].page, 1);
  assert.equal(c.vars.chapter.writes.length, 1); assert.equal(c.vars.chapter.writes[0].script, 'meet-mom');
  assert.equal(c.vars.metMom.reads.length, 1); assert.equal(c.vars.metMom.writes.length, 1);
  assert.deepEqual(c.vars.metMom.writes[0].path, ['maps', 'home', 'objects', 0, 'pages', 0, 'on', 'interact', 0, 'else', 1, 'name']);
  const kinds = (k) => c.refs.filter(r => r.kind === k).map(r => r.id);
  assert.deepEqual(kinds('item'), ['berry']); assert.deepEqual(kinds('script'), ['meet-mom']); assert.ok(kinds('map').includes('town') && kinds('map').includes('home'));
  assert.ok(kinds('sprite').includes('woman') && kinds('sprite').includes('hero-boy')); assert.deepEqual(kinds('sound'), ['door']); assert.ok(kinds('tile').includes('grass'));
  // an unregistered command contributes nothing but its branches are still walked by shape
  const q = P.normalize(sample()).project;
  q.scripts.x = { body: [{ t: 'mystery', then: [{ t: 'setVar', name: 'z', op: 'set', value: 1 }], options: [{ then: [{ t: 'say', text: 'deep' }] }] }] };
  const seen = []; P.walkCommands(q, (cmd, where) => seen.push(cmd.t + '@' + where.path.join('.')));
  assert.ok(seen.includes('setVar@scripts.x.body.0.then.0') && seen.includes('say@scripts.x.body.0.options.0.then.0'));
  assert.equal(P.collect(q).vars.z.writes.length, 1);
});

test('migration project-2-to-3 converts the flat shape', () => {
  const old = {
    version: 1, title: "Mom's Adventure", subtitle: 'for you', author: 'me',
    heroes: [{ name: 'Player 1', sprite: 'hero-boy', recolor: {} }], start: { map: 'home', x: 1, y: 1, dir: 'down' },
    intro: [{ t: 'say', who: 'Mom', text: 'Morning' }, { t: 'set', flag: 'awake', value: true }],
    items: { berry: { name: 'Berry', icon: 'berry', kind: 'berry', desc: 'yum' } },
    settings: { encounterRate: 20, catchDifficulty: 'easy', followers: true, coop: true, textSpeed: 'fast' },
    garden: 'garden', mapOrder: ['town', 'home'],
    maps: {
      home: { id: 'home', name: 'Home', width: 3, height: 2, kind: 'indoor', layers: { ground: ['floor-wood', 'floor-wood', 'floor-wood', 'floor-wood', 'floor-wood', 'floor-wood'], deco: [null, null, null, null, null, null], above: [null, null, null, null, null, null] }, collision: [null, 1, null, null, null, null],
        objects: [
          { id: 'mom', type: 'npc', x: 1, y: 1, sprite: 'woman', dir: 'down', move: 'look', name: 'Mom', trigger: 'interact', once: false, condition: { flag: 'awake', is: true }, hiddenByFlag: 'gone',
            event: [{ t: 'say', who: 'Mom', text: 'Hi' }, { t: 'if', var: 'coins', op: '>=', value: 3, then: [{ t: 'give', item: 'berry', count: 1 }, { t: 'var', name: 'coins', op: 'add', value: -3 }], else: [{ t: 'face', target: 'self', dir: 'player' }] }, { t: 'warp', map: 'town', x: 2, y: 2, dir: 'up' }, { t: 'sound', name: 'door' }, { t: 'fade', to: 'out' }, { t: 'hide', target: 'mom' }, { t: 'end' }] },
          { id: 'sign1', type: 'sign', x: 0, y: 0, look: 'sign', event: [{ t: 'say', text: 'Home' }] },
          { id: 'ball', type: 'item', x: 2, y: 0, item: 'berry', count: 2, once: true, look: 'pokeball-item' },
          { id: 'door', type: 'warp', x: 1, y: 0, to: { map: 'town', x: 4, y: 4, dir: 'down' }, sound: 'door' },
          { id: 'eevee', type: 'pokemon', x: 2, y: 1, mon: 'eevee', wild: false, event: [] },
        ] },
      town: { id: 'town', name: 'Town', width: 5, height: 5, kind: 'outdoor', layers: { ground: new Array(25).fill('grass'), deco: new Array(25).fill(null), above: new Array(25).fill(null) }, encounters: { rate: null, table: [{ id: 'pikachu', weight: 5 }] }, objects: [] },
    },
  };
  const { project: p, problems } = P.normalize(old);
  assert.equal(p.version, 3);
  assert.equal(p.meta.title, "Mom's Adventure"); assert.equal(p.meta.id, 'moms-adventure');
  assert.equal(p.settings.textSpeed, 'fast'); assert.equal(p.settings.coop.enabled, true);
  assert.deepEqual(p.modules, ['mons']); assert.equal(p.packs.mons.garden, 'garden'); assert.deepEqual(Object.keys(p.packs.mons.encounters), ['town']);
  assert.deepEqual(Object.keys(p.world.maps), ['town', 'home']);                              // mapOrder
  assert.ok(p.world.maps.home.x > p.world.maps.town.x);
  assert.equal(p.scripts.intro.trigger, 'auto'); assert.equal(p.scripts.intro.body.length, 3); assert.deepEqual(p.scripts.intro.body[1], { t: 'setVar', name: 'awake', op: 'set', value: true });
  assert.equal(p.vars.introDone.type, 'bool');
  const home = p.maps.home;
  assert.equal(home.layers.terrain.length, 6); assert.deepEqual(home.layers.regions, [0, 0, 0, 0, 0, 0]); assert.equal(home.collision[1], 1);
  const mom = home.objects[0];
  assert.equal(mom.pages.length, 1);
  const pg = mom.pages[0];
  // (the conditions schema may fill extra default keys, so compare the fields the migration sets)
  const pick = (c) => ({ kind: c.kind, name: c.name, op: c.op, value: c.value });
  assert.equal(pg.when.kind, 'all');
  assert.deepEqual(pg.when.of.map(pick), [{ kind: 'var', name: 'awake', op: '==', value: true }, { kind: 'var', name: 'gone', op: '==', value: false }]);
  assert.equal(pg.sprite, 'woman'); assert.equal(pg.behaviour.kind, 'look');
  const body = pg.on.interact;
  assert.equal(body[0].t, 'say');
  assert.deepEqual(pick(body[1].when), { kind: 'var', name: 'coins', op: '>=', value: 3 });
  assert.deepEqual(body[1].then[1], { t: 'setVar', name: 'coins', op: 'add', value: -3 });
  assert.deepEqual(body[1].else[0], { t: 'moveRoute', target: 'self', steps: ['faceHero'], wait: true });
  assert.deepEqual(body[2], { t: 'transfer', map: 'town', x: 2, y: 2, dir: 'up', fade: true });
  assert.deepEqual(body[3], { t: 'sound', id: 'door' }); assert.equal(body[4].t, 'fadeOut'); assert.deepEqual(body[5], { t: 'erase', target: 'mom', persistent: true }); assert.equal(body[6].t, 'exit');
  assert.equal(home.objects[1].pages[0].props.look, 'sign'); assert.deepEqual(Object.keys(home.objects[1].pages[0].on), ['interact']);
  const ball = home.objects[2].pages[0]; assert.equal(ball.props.item, 'berry'); assert.equal(ball.props.count, 2); assert.equal(ball.once, true); assert.equal(ball.layer, 'below');
  const door = home.objects[3].pages[0]; assert.deepEqual(door.props.to, { map: 'town', x: 4, y: 4 }); assert.equal(door.props.dir, 'down'); assert.equal(door.props.sound, 'door');
  assert.equal(home.objects[4].type, 'pokemon'); assert.equal(home.objects[4].pages[0].props.mon, 'eevee');
  assert.ok(problems.some(x => x.code === 'unknown-object-type'));   // 'pokemon' comes from the mons module (not loaded here)
  assert.ok(!problems.some(x => x.code === 'no-migration'));
  assert.ok(P.migrate({ version: 3, meta: {}, world: {} }).applied.length === 0);
  assert.deepEqual(P.migrate({ title: 'x' }).applied, ['project-2-to-3']);
});

test('exportFiles / importFiles round-trip, sorted keys, one map row per line, fromContent', () => {
  const { project: p } = P.normalize(sample());
  p.maps.home.layers.ground[1] = 'wall';
  p.autotiles.default.groups.push({ id: 'g', name: 'G', active: true, terrain: 1, layer: 'ground', rules: [{ size: 3, pattern: [0, -1, 0, -1, 1, -1, 0, -1, 0], tiles: ['path'], mode: 'single', chance: 1, breakOnMatch: true, flip: 'none', outOfBounds: null, modulo: { x: 1, y: 1, ox: 0, oy: 0 }, active: true, note: '' }] });
  const files = P.exportFiles(p);
  assert.deepEqual(Object.keys(files).sort(), ['maps/home.js', 'maps/town.js', 'project.js']);
  const home = files['maps/home.js'];
  assert.ok(home.startsWith('// '));
  assert.ok(home.includes('// kind: map  project: demo  id: home'));
  // ground: 5 rows of 6 ids, each row on one line
  const groundBlock = home.slice(home.indexOf('"ground": ['), home.indexOf(']', home.indexOf('"ground": [')));
  assert.equal(groundBlock.split('\n').slice(1).filter(l => l.trim()).length, 5);
  assert.ok(groundBlock.includes('"floor-wood", "wall", "floor-wood", "floor-wood", "floor-wood", "floor-wood"'));
  // keys sorted
  const keys = home.match(/^  "([a-zA-Z]+)":/gm).map(k => k.trim().replace(/[":]/g, ''));
  assert.deepEqual(keys, keys.slice().sort());
  assert.ok(/^  "meta": \{/m.test(files['project.js']) && !/^  "maps":/m.test(files['project.js']));   // maps live in their own files
  assert.ok(/"pattern": \[\n\s+0, -1, 0,\n\s+-1, 1, -1,\n\s+0, -1, 0\n/.test(files['project.js']));
  // import reverses
  const back = P.importFiles(files);
  assert.deepEqual(P.normalize(back).project, p);
  assert.deepEqual(P.exportFiles(P.normalize(back).project), files);
  // the files are plain scripts that register into KIT.content; fromContent assembles the project
  for (const name of Object.keys(files)) new Function(files[name])();   // eslint-disable-line no-new-func
  assert.ok(KIT.content.projects.demo && KIT.content.maps.demo.town);
  assert.deepEqual(P.normalize(P.fromContent('demo')).project, p);
  assert.deepEqual(P.normalize(P.fromContent()).project, p);
  assert.equal(P.fromContent('nope'), null);
  assert.throws(() => P.importFiles({ 'x.js': 'nothing' }), /no project\.js/);
});

test('object types and presets: buildPreset places objects (transfer pair on two maps)', () => {
  const types = KIT.registry('objectTypes');
  for (const id of ['npc', 'sign', 'item', 'warp', 'trigger']) assert.ok(types.has(id), id);
  assert.equal(types.get('warp').fields.find(f => f.key === 'to').type, 'position');
  assert.equal(types.get('item').fields.find(f => f.key === 'item').type, 'ref:item');
  const presets = KIT.registry('presets');
  for (const id of ['door', 'sign', 'item', 'transfer-pair', 'npc']) assert.ok(presets.has(id), id);
  const { project: p } = P.normalize(sample());
  const pair = P.buildPreset('transfer-pair', { project: p, map: 'home', x: 1, y: 2, input: { to: { map: 'town', x: 3, y: 4 }, sound: 'door' } });
  assert.equal(pair.length, 2);
  assert.equal(pair[0].map, 'home'); assert.equal(pair[0].object.x, 1); assert.deepEqual(pair[0].object.pages[0].props.to, { map: 'town', x: 3, y: 4 });
  assert.equal(pair[1].map, 'town'); assert.equal(pair[1].object.y, 4); assert.deepEqual(pair[1].object.pages[0].props.to, { map: 'home', x: 1, y: 2 });
  assert.equal(pair[1].object.pages[0].props.sound, 'door'); assert.equal(pair[1].object.pages[0].layer, 'below');
  const door = P.buildPreset(presets.get('door'), { project: p, map: 'home', x: 0, y: 0, input: { to: { map: 'town', x: 1, y: 1 } } });
  assert.equal(door[0].object.type, 'warp'); assert.equal(door[0].object.pages[0].props.look, 'door'); assert.equal(door[0].object.pages[0].props.sound, 'door');
  const npc = P.buildPreset('npc', { project: p, map: 'home', x: 0, y: 0, input: { name: 'Bob', sprite: 'woman', text: 'Yo' } });
  assert.equal(npc[0].object.name, 'Bob'); assert.deepEqual(npc[0].object.pages[0].on.interact, [{ t: 'say', who: 'Bob', text: 'Yo' }]); assert.equal(npc[0].object.pages[0].sprite, 'woman');
  // placing on a map that already has that id picks a fresh one
  p.maps.home.objects.push(door[0].object);
  const again = P.buildPreset('door', { project: p, map: 'home', x: 0, y: 0, input: { to: { map: 'town', x: 1, y: 1 } } });
  assert.notEqual(again[0].object.id, door[0].object.id);
  // the built objects validate cleanly inside the project
  p.maps.town.objects.push(pair[1].object); p.maps.home.objects.push(pair[0].object);
  assert.deepEqual(P.validate(p).filter(x => x.severity === 'error' && x.code !== 'bad-connection'), []);
});

test('strings registry drives project.strings; project schema fields are exposed', () => {
  KIT.registry('strings').add({ id: 'test-term', default: 'Hello' });
  const { project: p } = P.normalize({
    strings: { 'test-term': 'Custom', 'got-item': 'Yay {item}', 'save-prompt': 'Save your progress?' },
    maps: { a: {} },
  });
  // Content carries the OVERRIDES, not a frozen copy of every registered default.
  assert.deepEqual(p.strings, { 'test-term': 'Custom', 'got-item': 'Yay {item}' },
    'save-prompt equalled its default, so it is not content');
  // and every term still answers, through the registry
  assert.equal(KIT.strings.get(p, 'test-term'), 'Custom');
  assert.equal(KIT.strings.get(p, 'got-item'), 'Yay {item}');
  assert.equal(KIT.strings.get(p, 'save-prompt'), 'Save your progress?');

  // a term nobody registered is kept whatever it says — it is the author's own
  const own = P.normalize({ strings: { 'my-own-term': 'Mine' }, maps: { a: {} } }).project;
  assert.equal(own.strings['my-own-term'], 'Mine');
  assert.equal(KIT.strings.get(own, 'my-own-term'), 'Mine');

  // and a reworded default reaches a project that never overrode it
  const plain = P.normalize({ maps: { a: {} } }).project;
  KIT.registry('strings').add({ id: 'test-term', default: 'Hello again', replace: true });
  assert.equal(KIT.strings.get(plain, 'test-term'), 'Hello again', 'nothing was frozen into the content');
  KIT.registry('strings').remove('test-term');
  assert.ok(P.fields.meta.some(f => f.key === 'pitch') && P.fields.page.some(f => f.key === 'when') && P.fields.autotileRule.some(f => f.key === 'pattern'));
  assert.deepEqual(P.SLOTS, ['interact', 'step', 'touch', 'enter', 'tick', 'init']);
});

test('validate looks inside rules: a broken command, a bad transfer and an undeclared variable are reported', () => {
  const s = sample();
  s.rules = { odd: { name: 'Odd', when: 'step', if: { kind: 'var', name: 'nosuchvar', op: '==', value: 1 },
    do: [{ t: 'nonsense' }, { t: 'transfer', map: 'nowhere', x: 99, y: 99, dir: 'down' }, { t: 'say', who: '', text: '' }] } };
  const { project: p } = P.normalize(s);
  const problems = P.validate(p);
  const inRule = problems.filter(x => x.where && x.where.rule === 'odd');
  const codes = new Set(inRule.map(x => x.code));
  for (const c of ['unknown-command', 'bad-target', 'empty-text', 'undeclared-var']) assert.ok(codes.has(c), `expected ${c} on the rule, got ${Array.from(codes).join(',')}`);
  // and a rule's lines are walked like every other script's
  const seen = [];
  P.walkCommands(p, (cmd, where) => { if (where.rule) seen.push(cmd.t); });
  assert.deepEqual(seen, ['nonsense', 'transfer', 'say']);
});
