'use strict';
// KIT.mons.essentials: Pokémon Essentials PBS text -> species and encounter tables.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('../kit/_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));
R('js/modules/mons/essentials.js');
const E = KIT.mons.essentials;

const V19 = [
  '# PBS/pokemon.txt — Essentials v19',
  '[1]',
  'Name=Bulbasaur',
  'InternalName=BULBASAUR',
  'Type1=GRASS',
  'Type2=POISON',
  'BaseStats=45,49,49,45,65,65',
  'Pokedex=A strange seed was planted on its back at birth.',
  'Height=0.7',
  'Weight=6.9',
  'Moves=1,TACKLE,3,GROWL',
  '',
  '[4]',
  'Name=Charmander',
  'InternalName=CHARMANDER',
  'Type1=FIRE',
  'BaseStats=39,52,43,65,60,50',
].join('\n');

const V20 = [
  '[BULBASAUR]',
  'Name = Bulbasaur',
  'Types = GRASS,POISON',
  'BaseStats = 45,49,49,65,65,45',
  'Pokedex = A strange seed was planted on its back at birth.',
  'Height = 0.7',
  'Weight = 6.9',
  '',
  '[MOSSLING]',
  'Name = Mossling',
  'Types = GRASS,SPIRIT',
  'BaseStats = 60,60,60,60,60,60',
].join('\n');

const ENC = [
  '[012]',
  'Land,25',
  '    25,PIDGEY,2,4',
  '    20,RATTATA,2,4',
  '    10,PIDGEY,4,6',
  'Water,8',
  '    60,MAGIKARP,5,10',
  '',
  '[MAP015,1]',
  'Cave,12',
  '    30,ZUBAT,5,7',
].join('\n');

test('essentials: it knows a roster from an encounter list from nonsense', () => {
  assert.equal(E.detect(V19), 'pokemon');
  assert.equal(E.detect(V20), 'pokemon');
  assert.equal(E.detect(ENC), 'encounters');
  assert.equal(E.detect('hello, this is a shopping list'), null);
  assert.equal(E.detect(''), null);
  assert.equal(E.detect('{"frames":[]}'), null);
});

test('essentials: a v19 roster reads, with Essentials’ own stat order', () => {
  const res = E.pokemon(V19);
  assert.equal(res.stats.shape, 'v19');
  assert.equal(res.packs.mons.species.length, 2);
  const bulb = res.packs.mons.species[0];
  assert.equal(bulb.id, 'bulbasaur');
  assert.equal(bulb.name, 'Bulbasaur');
  assert.equal(bulb.dex, 1, 'the heading is the dex number in this shape');
  assert.deepEqual(bulb.types, ['grass', 'poison']);
  // v19 writes HP, ATK, DEF, SPEED, SPATK, SPDEF
  assert.deepEqual(bulb.base, { hp: 45, atk: 49, def: 49, spe: 45, spa: 65, spd: 65 });
  assert.equal(bulb.color, '#78c850', 'the first type gives it a colour, so it is not a grey blob');
  assert.match(bulb.blurb, /strange seed/);
  assert.equal(bulb.height, 0.7);
  assert.deepEqual(bulb.moves, [], 'moves are Essentials’ own ids, so they are left out');
  assert.ok(res.problems.some(p => p.code === 'moves-skipped'), 'and it says so rather than pretending');
  assert.equal(res.packs.mons.species[1].dex, 4);
});

test('essentials: a v20 roster reads, with the other stat order, and keeps unknown types as words', () => {
  const res = E.pokemon(V20);
  assert.equal(res.stats.shape, 'v20');
  const bulb = res.packs.mons.species[0];
  // v20 writes HP, ATK, DEF, SPATK, SPDEF, SPEED — the same Bulbasaur
  assert.deepEqual(bulb.base, { hp: 45, atk: 49, def: 49, spa: 65, spd: 65, spe: 45 });
  assert.equal(bulb.dex, 1, 'no number in the file: the order in it is the order');
  assert.equal(res.packs.mons.species[1].dex, 2);
  const moss = res.packs.mons.species[1];
  assert.equal(moss.id, 'mossling', 'a species of the author’s own comes through');
  assert.deepEqual(moss.types, ['grass', 'spirit'], 'including a type this engine has never heard of');
  assert.ok(res.problems.some(p => p.code === 'unknown-type'), 'which is mentioned, not dropped');
  assert.equal(moss.color, '#78c850', 'the type it does know decides the colour');
});

test('essentials: the same Bulbasaur either way, and a prefix keeps a roster apart', () => {
  const a = E.pokemon(V19).packs.mons.species[0].base;
  const b = E.pokemon(V20).packs.mons.species[0].base;
  for (const k of ['hp', 'atk', 'def', 'spa', 'spd', 'spe']) assert.equal(a[k], b[k], `${k} is the same read either way`);
  const pre = E.pokemon(V20, { prefix: 'aster' });
  assert.equal(pre.packs.mons.species[0].id, 'aster:bulbasaur');
});

test('essentials: land and cave encounters become tables; water and rods say they were left out', () => {
  const res = E.encounters(ENC);
  assert.deepEqual(Object.keys(res.packs.mons.encounters).sort(), ['012', 'MAP015']);
  const first = res.packs.mons.encounters['012'];
  assert.equal(first.rate, 25, 'Essentials’ own number is a chance in 100, which is this engine’s rate');
  assert.deepEqual(first.byRegion[0], [{ id: 'pidgey', weight: 35 }, { id: 'rattata', weight: 20 }],
    'two rows for the same species are one entry with their weights added');
  assert.deepEqual(res.packs.mons.encounters.MAP015.byRegion[0], [{ id: 'zubat', weight: 30 }]);
  assert.equal(res.packs.mons.encounters.MAP015.rate, 12, 'a cave block counts too');
  assert.ok(res.problems.some(p => p.code === 'method-skipped' && /Water/.test(p.message)));
  assert.ok(res.problems.some(p => p.code === 'map-unresolved'), 'and an RPG Maker map id is kept, with a word about it');
  assert.equal(res.stats.rows, 4);
});

test('essentials: a table lands on one of your maps when you can say which', () => {
  const res = E.encounters(ENC, { mapId: (key) => (key === '012' ? 'route-one' : null) });
  assert.ok(res.packs.mons.encounters['route-one'], 'the one it could place is placed');
  assert.ok(res.packs.mons.encounters.MAP015, 'the one it could not is still there under its own name');
  assert.equal(res.problems.filter(p => p.code === 'map-unresolved').length, 1);
});

test('essentials: files that are not PBS say so instead of producing an empty game', () => {
  assert.ok(E.pokemon('hello').problems.some(p => p.severity === 'error' && p.code === 'not-pbs'));
  assert.ok(E.encounters('').problems.some(p => p.severity === 'error'));
  assert.ok(E.pokemon('[1]\nWhatever=1\n').problems.some(p => p.code === 'bad-stats' || p.severity === 'info'),
    'a section with no stats still reads, with 50s and a word about it');
});
