#!/usr/bin/env node
// Builds the demo world and writes js/content/demo/{project.js,maps/*.js}.
// Run: node tools/build-demo.js
// The demo exists to show every engine feature and to be replaced: everything
// here is ordinary content that Creator Mode can edit.
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const KIT = require(path.join(root, 'test/kit/_load.js'));
global.PKMN = global.PKMN || {};
for (const f of ['js/art/tiles.js', 'js/art/chars.js', 'js/art/tiles-nature.js', 'js/art/tiles-town.js', 'js/art/tiles-interior.js', 'js/art/chars-heroes.js', 'js/art/chars-placeholder.js']) require(path.join(root, f));
require(path.join(root, 'js/kit/world/map.js'));

const S = (lines) => { const r = KIT.screenplay.parse(lines.join('\n')); if (r.problems.length) throw new Error('screenplay: ' + JSON.stringify(r.problems)); return r.commands; };

// ---- a tiny map painter -----------------------------------------------------
function blankMap(id, name, w, h, kind, music) {
  const n = w * h;
  const ground = KIT.project.GROUND_BY_KIND[kind] || 'grass';
  return { id, name, width: w, height: h, kind, music: music || null, note: '',
    layers: { terrain: new Array(n).fill(kind === 'outdoor' || kind === 'garden' ? 1 : 0), ground: new Array(n).fill(ground), deco: new Array(n).fill(null), above: new Array(n).fill(null), regions: new Array(n).fill(0) },
    collision: new Array(n).fill(null), objects: [], props: {} };
}
const P = (m) => ({
  i: (x, y) => y * m.width + x,
  set(layer, x, y, id) { if (x >= 0 && y >= 0 && x < m.width && y < m.height) m.layers[layer][y * m.width + x] = id; return this; },
  rect(layer, x0, y0, x1, y1, id) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(layer, x, y, id); return this; },
  hline(layer, x0, x1, y, id) { for (let x = x0; x <= x1; x++) this.set(layer, x, y, id); return this; },
  vline(layer, x, y0, y1, id) { for (let y = y0; y <= y1; y++) this.set(layer, x, y, id); return this; },
  region(x0, y0, x1, y1, id) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m.layers.regions[y * m.width + x] = id; return this; },
  stamp(stampId, x0, y0, layer) {
    const st = KIT.registry('tiles').stamps.find(s => s.id === stampId);
    if (!st) throw new Error('unknown stamp ' + stampId);
    st.tiles.forEach((row, dy) => row.forEach((tid, dx) => { if (tid) this.set(layer || 'deco', x0 + dx, y0 + dy, tid); }));
    return this;
  },
  solid(x, y, v) { m.collision[y * m.width + x] = v === undefined ? 1 : v; return this; },
});
const page = (o) => Object.assign({ when: null, sprite: null, dir: 'down', layer: 'same', through: false, dirFix: false, stepAnim: false, visible: true, behaviour: { kind: 'none' }, on: {}, once: false, needsBoth: false, props: {} }, o || {});
const obj = (id, name, type, x, y, pages) => ({ id, name, type, x, y, note: '', pages });

// ---- HOME (indoor) -----------------------------------------------------------
const home = blankMap('home', 'Home', 12, 10, 'indoor', 'house');
{
  const p = P(home);
  p.rect('ground', 0, 0, 11, 9, 'floor-wood');
  p.hline('deco', 0, 11, 0, 'wall-in-top');
  p.hline('deco', 0, 11, 1, 'wall-in');
  p.set('deco', 3, 1, 'window-inner'); p.set('deco', 8, 1, 'poster');
  p.rect('ground', 6, 5, 9, 8, 'carpet-red');
  p.stamp('bed', 1, 2);
  p.set('deco', 3, 3, 'bookshelf'); p.set('deco', 4, 3, 'pc');
  p.set('deco', 9, 2, 'table'); p.set('deco', 8, 2, 'chair'); p.set('deco', 10, 2, 'tv');
  p.set('deco', 6, 2, 'plant');
  p.set('ground', 5, 9, 'exit-mat');
  home.objects = [
    obj('mom', 'Mom', 'npc', 8, 4, [
      page({ sprite: 'woman', dir: 'down', behaviour: { kind: 'wander', radius: 2, frequency: 3 }, once: true, on: { interact: S([
        'Mom: Good morning, {p1}! {pause} You and {p2} slept late again.',
        'Mom: Take these — you will want them out there.',
        '@give item=pokeball count=5 notify=true',
        '@give item=berry count=3 notify=true',
        '@balloon target=self kind=♥',
        '@set chapter = 1',
      ]) } }),
      page({ when: { kind: 'var', name: 'chapter', op: '>=', value: 1 }, sprite: 'woman', dir: 'down', behaviour: { kind: 'wander', radius: 2, frequency: 3 },
        on: { interact: S(['Mom: The Professor is waiting in the lab, you two.']) } }),
    ]),
    obj('pc', 'PC', 'sign', 4, 3, [page({ layer: 'same', on: { interact: S(['"The PC hums. Everyone you befriend rests in the Garden."']) } })]),
    obj('tv', 'TV', 'sign', 10, 2, [page({ on: { interact: S(['"A cooking show. Someone is very excited about berries."']) } })]),
    obj('door-out', 'Front door', 'warp', 5, 9, [page({ layer: 'below', through: true, visible: false, props: { to: { map: 'town', x: 12, y: 3, dir: 'down' } } })]),
    obj('intro-trigger', 'Intro', 'trigger', 5, 8, [page({ layer: 'below', through: true, visible: false, when: { kind: 'var', name: 'introDone', op: '==', value: false }, on: { enter: S(['@call intro', '@set introDone = true']) } })]),
  ];
}

// ---- TOWN (outdoor) ----------------------------------------------------------
const town = blankMap('town', 'Peachfall', 24, 18, 'outdoor', 'town');
{
  const p = P(town);
  p.rect('ground', 0, 0, 23, 17, 'grass');
  for (const [x, y] of [[3, 5], [17, 4], [9, 12], [20, 14]]) p.set('ground', x, y, 'grass-2');
  p.vline('ground', 12, 3, 17, 'path'); p.hline('ground', 4, 20, 8, 'path');
  p.vline('ground', 11, 3, 17, 'path-edge-w'); p.vline('ground', 13, 3, 17, 'path-edge-e');
  p.stamp('house-red', 10, 0); p.stamp('house-blue', 3, 4); p.stamp('lab', 15, 3);
  p.stamp('big-tree', 1, 10); p.stamp('big-tree', 20, 5); p.stamp('big-tree', 6, 14);
  p.stamp('pond', 18, 12);
  for (let x = 2; x <= 9; x++) p.set('deco', x, 11, 'fence-h');
  p.set('deco', 8, 9, 'sign'); p.set('deco', 14, 7, 'lamp-post'); p.set('deco', 5, 9, 'mailbox');
  p.set('deco', 16, 10, 'bench'); p.set('deco', 4, 12, 'flowers-red'); p.set('deco', 15, 13, 'flowers-yellow');
  town.objects = [
    obj('home-door', 'Home', 'warp', 12, 3, [page({ layer: 'below', through: true, visible: false, props: { to: { map: 'home', x: 5, y: 8, dir: 'up' } } })]),
    obj('lab-door', 'Lab', 'warp', 18, 6, [page({ layer: 'below', through: true, visible: false, props: { to: { map: 'lab', x: 7, y: 8, dir: 'up' } } })]),
    obj("town-sign", "Sign", "sign", 8, 9, [page({ on: { interact: S(["\"PEACHFALL — small town, big sky.\""]) } })]),
    obj('grandma', 'Grandma', 'npc', 16, 9, [page({ sprite: 'grandma', dir: 'down', behaviour: { kind: 'look', frequency: 2 }, on: { interact: S([
      'Grandma: Everyone is a beginner once, dear.',
      '? Sit with her a while?',
      '- Yes',
      '    Grandma: {pause} That is nice.',
      '    @set friendship += 1',
      '- Maybe later',
      '    Grandma: Off you go, then.',
    ]) } })]),
    obj('kid', 'Kid', 'npc', 5, 13, [page({ sprite: 'kid-boy', behaviour: { kind: 'wander', radius: 3, frequency: 4 }, on: { interact: S(['Kid: My Pokémon walks behind me! {pause} Yours can too.']) } })]),
    obj('chapter-card', 'Chapter card', 'trigger', 12, 4, [page({ layer: 'below', through: true, visible: false, once: true, on: { step: S(['@chapter title="Chapter One" subtitle="A New Morning"']) } })]),
  ];
}

// ---- LAB (indoor) ------------------------------------------------------------
const lab = blankMap('lab', 'Professor’s Lab', 14, 10, 'indoor', 'house');
{
  const p = P(lab);
  p.rect('ground', 0, 0, 13, 9, 'floor-tile');
  p.hline('deco', 0, 13, 0, 'wall-in-top'); p.hline('deco', 0, 13, 1, 'wall-in');
  p.set('deco', 4, 1, 'window-inner'); p.set('deco', 9, 1, 'window-inner');
  p.rect('deco', 2, 4, 3, 4, 'bookshelf');
  p.set('deco', 10, 4, 'counter'); p.set('deco', 11, 4, 'counter');
  p.set('ground', 7, 9, 'exit-mat');
  const stand = (id, x, name) => obj(id, name, 'npc', x, 6, [
    page({ sprite: 'pokeball', dir: 'down', when: { kind: 'var', name: 'starter', op: '==', value: '' }, on: { interact: S([
      `"A sleepy ${name} looks up at you."`,
      `? Choose ${name}?`,
      '- Yes',
      `    @set starter = ${id.replace('stand-', '')}`,
      '    @set hasStarter = true',
      `    Professor: ${name} it is! {pause} Take good care of them.`,
      '    @sound sparkle',
      '    @call clear-stands',
      '- Not yet',
      '    "You step back."',
    ]) } }),
  ]);
  lab.objects = [
    obj('prof', 'Professor', 'npc', 7, 4, [
      page({ sprite: 'professor', dir: 'down', once: true, on: { enter: S([
        '@move self: down down',
        '@balloon target=self kind=! wait=true',
        'Professor: {p1}! {p2}! {pause} Right on time.',
        'Professor: One of these three would like to come with you.',
      ]) } }),
      page({ when: { kind: 'var', name: 'hasStarter', op: '==', value: true }, sprite: 'professor', dir: 'down',
        on: { interact: S(['Professor: Head out to the route when you are ready. {pause} Be kind out there.']) } }),
      page({ sprite: 'professor', dir: 'down', on: { interact: S(['Professor: Go on, pick one. They have been waiting all morning.']) } }),
    ]),
    stand('stand-pikachu', 5, 'Pikachu'), stand('stand-butterfree', 7, 'Butterfree'), stand('stand-clefable', 9, 'Clefable'),
    obj('lab-out', 'Door', 'warp', 7, 9, [page({ layer: 'below', through: true, visible: false, props: { to: { map: 'town', x: 18, y: 7, dir: 'down' } } })]),
  ];
}

// ---- ROUTE (outdoor) ---------------------------------------------------------
const route = blankMap('route', 'Route 1', 20, 24, 'outdoor', 'route');
{
  const p = P(route);
  p.rect('ground', 0, 0, 19, 23, 'grass');
  p.vline('ground', 9, 0, 23, 'path'); p.vline('ground', 8, 0, 23, 'path-edge-w'); p.vline('ground', 10, 0, 23, 'path-edge-e');
  p.rect('ground', 2, 4, 6, 8, 'tall-grass'); p.region(2, 4, 6, 8, 1);
  p.rect('ground', 12, 12, 17, 17, 'tall-grass'); p.region(12, 12, 17, 17, 2);
  p.stamp('pond', 13, 3); p.stamp('big-tree', 3, 19); p.stamp('big-tree', 16, 8);
  p.hline('ground', 6, 12, 11, 'ledge-down');
  p.set('deco', 11, 20, 'rock'); p.set('deco', 5, 15, 'stump'); p.set('deco', 14, 21, 'log');
  route.objects = [
    obj('back-to-town', 'To town', 'warp', 9, 0, [page({ layer: 'below', through: true, visible: false, props: { to: { map: 'town', x: 12, y: 16, dir: 'up' } } })]),
    obj('trainer', 'Hiker', 'npc', 11, 9, [page({ sprite: 'trainer', dir: 'left', once: true, on: { interact: S([
      'Hiker: You two look new out here.',
      '? Want a few spare Poké Balls?',
      '- Yes please',
      '    @call give-balls n=3',
      '    Hiker: Go on, the tall grass is full of friends.',
      '- We are fine',
      '    Hiker: Suit yourselves!',
    ]) } })]),
    obj('golden-berry', 'Golden Berry', 'item', 5, 17, [page({ layer: 'below', props: { item: 'golden-berry', count: 1, look: 'pokeball-item' } })]),
    obj('grass-watcher', 'Grass watcher', 'trigger', 6, 6, [page({ layer: 'below', through: true, visible: false, once: true, on: { step: S([
      '"Something rustles in the tall grass."', '@balloon target=p1 kind=?',
    ]) } })]),
    obj('gate', 'Old gate', 'npc', 9, 22, [page({ sprite: 'man', dir: 'up', needsBoth: true, on: { interact: S([
      '"The gate is heavy."', '"Together, you push it open."', '@set gateOpen = true', '@sound sparkle',
    ]) } })]),
  ];
}

// ---- the project --------------------------------------------------------------
const raw = {
  version: 3,
  meta: { id: 'demo', title: 'Our Adventure', subtitle: 'for you ♥',
    pitch: 'Two friends share one phone to wander a small town and befriend the Pokémon they meet. Everything you make friends with keeps living in the garden while you are away.' },
  modules: [],
  settings: { tileSize: 16, viewport: { w: 16, h: 12 }, textSpeed: 'normal', coop: { enabled: false }, clock: { enabled: false } },
  strings: { 'got-item': 'Got {count} {item}!' },
  heroes: [{ id: 'p1', name: 'Player 1', sprite: 'hero-boy', recolor: {} }, { id: 'p2', name: 'Player 2', sprite: 'hero-girl', recolor: {} }],
  start: { map: 'home', x: 5, y: 6, dir: 'down' },
  vars: {
    chapter: { type: 'number', default: 0, label: 'Chapter', group: 'Story' },
    introDone: { type: 'bool', default: false, label: 'Intro played', group: 'Story' },
    starter: { type: 'string', default: '', label: 'Chosen partner', group: 'Story' },
    hasStarter: { type: 'bool', default: false, label: 'Has a partner', group: 'Story' },
    gateOpen: { type: 'bool', default: false, label: 'Old gate opened', group: 'Route' },
    friendship: { type: 'number', default: 0, label: 'Kindness', group: 'Story' },
  },
  items: {
    pokeball: { kind: 'ball', name: 'Poké Ball', icon: 'pokeball', desc: 'For making friends.' },
    berry: { kind: 'berry', name: 'Berry', icon: 'berry', desc: 'Sweet. Calms a nervous Pokémon.' },
    'golden-berry': { kind: 'berry', name: 'Golden Berry', icon: 'golden-berry', desc: 'Rare and very sweet.' },
  },
  scripts: {
    intro: { label: 'Intro', trigger: 'call', when: null, params: [], body: S([
      '@fade out ms=0', '@fade in ms=600',
      '@chapter title="Our Adventure" subtitle="for you ♥"',
      '"{p1} and {p2} wake up to a bright new morning."',
      '@set introDone = true',
    ]), note: 'Runs once, from the trigger by the bedroom door.' },
    'give-balls': { label: 'Give Poké Balls', trigger: 'call', when: null, params: ['n'], body: S([
      '@give item=pokeball count=3 notify=true',
      '@sound item',
    ]), note: 'Called by the hiker; n is there for the editor to show parameters.' },
    'clear-stands': { label: 'Clear the other stands', trigger: 'call', when: null, params: [], body: S([
      '@erase target=obj:stand-pikachu persistent=true',
      '@erase target=obj:stand-butterfree persistent=true',
      '@erase target=obj:stand-clefable persistent=true',
    ]), note: 'The two you did not choose go back to sleep.' },
  },
  fragments: [
    { id: 'idea-garden', kind: 'note', title: 'Garden ideas', body: 'Petting, berries, little jobs, decorating. What do they do while we are away?', tags: ['garden'], folder: 'Ideas' },
    { id: 'line-rain', kind: 'dialogue', title: 'Rain line', body: '"The rain sounds different under the trees."', tags: ['weather'], folder: 'Lines' },
  ],
  testStates: [{ id: 'after-starter', label: 'After choosing a partner', map: 'town', x: 12, y: 8, dir: 'down',
    vars: { chapter: 1, introDone: true, starter: 'pikachu', hasStarter: true }, inventory: { pokeball: 5, berry: 3 }, modules: {} }],
  autotiles: {}, terrains: [{ id: 1, name: 'Grass', color: '#78c850', base: 'grass' }, { id: 2, name: 'Path', color: '#d8b878', base: 'path' }],
  world: { maps: { home: { x: 0, y: 0, folder: 'Chapter 1' }, town: { x: 1, y: 0, folder: 'Chapter 1' }, lab: { x: 2, y: 0, folder: 'Chapter 1' }, route: { x: 1, y: 1, folder: 'Chapter 1' } },
    connections: [{ a: 'town', side: 's', b: 'route', offset: -3 }] },
  maps: { home, town, lab, route },
  packs: {},
};

const { project, problems } = KIT.project.normalize(raw);
const errors = problems.filter(p => p.severity === 'error');
for (const p of problems) console.log(`${p.severity === 'error' ? 'ERROR' : 'warn '} [${p.code}] ${p.message} ${JSON.stringify(p.where || {})}`);
if (errors.length) { console.error(`\n${errors.length} error(s) — not written.`); process.exit(1); }

const files = KIT.project.exportFiles(project);
const outDir = path.join(root, 'js/content/demo');
fs.mkdirSync(path.join(outDir, 'maps'), { recursive: true });
for (const [name, text] of Object.entries(files)) {
  const file = path.join(outDir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(`wrote js/content/demo/${name} (${(text.length / 1024).toFixed(1)} KB)`);
}
console.log(`\n${Object.keys(project.maps).length} maps, ${Object.values(project.maps).reduce((n, m) => n + m.objects.length, 0)} objects, ${Object.keys(project.scripts).length} common events.`);
