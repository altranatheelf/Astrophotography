'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('./_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));
R('js/kit/world/map.js'); R('js/kit/editor/ops.js');
const O = KIT.editor.ops;

const tiles = KIT.registry('tiles');
for (const t of [{ id: 'grass', group: 'nature' }, { id: 'path', group: 'nature' }, { id: 'wall', group: 'town', solid: true }, { id: 'floor-wood', group: 'interior' }]) if (!tiles.has(t.id)) tiles.add(t);
if (!(tiles.stamps || []).some(s => s.id === 'hut')) (tiles.stamps = tiles.stamps || []).push({ id: 'hut', name: 'Hut', tiles: [['wall', 'wall'], ['wall', null]] });

function doc() {
  const { project } = KIT.project.normalize(KIT.project.blank());
  const id = Object.keys(project.maps)[0];
  const d = KIT.document(project);
  return { d, map: id, m: () => d.get(['maps', id]) };
}
const tileAt = (m, layer, x, y) => m.layers[layer][y * m.width + x];

test('editor ops: paint, rect, fill and erase are single undo steps', () => {
  const { d, map, m } = doc();
  assert.equal(O.paint(d, { map, layer: 'ground', cells: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }], tile: 'path' }), 2);
  assert.equal(tileAt(m(), 'ground', 1, 1), 'path');
  assert.equal(d.history.length, 1, 'one undo step for the stroke');
  d.undo();
  assert.notEqual(tileAt(m(), 'ground', 1, 1), 'path');
  O.rect(d, { map, layer: 'deco', x0: 3, y0: 3, x1: 5, y1: 5, tile: 'wall', outline: true });
  assert.equal(tileAt(m(), 'deco', 3, 3), 'wall');
  assert.equal(tileAt(m(), 'deco', 4, 4), null, 'outline leaves the middle alone');
  const painted = O.fill(d, { map, layer: 'ground', x: 0, y: 0, tile: 'path' });
  assert.equal(painted, m().width * m().height, 'flood fill covered the blank map');
  assert.equal(O.fill(d, { map, layer: 'ground', x: 0, y: 0, tile: 'path' }), 0, 'filling with the same tile does nothing');
  O.paint(d, { map, layer: 'ground', cells: [{ x: 0, y: 0 }] });        // erase → base ground
  assert.equal(tileAt(m(), 'ground', 0, 0), 'grass');
  O.paint(d, { map, layer: 'deco', cells: [{ x: 3, y: 3 }] });
  assert.equal(tileAt(m(), 'deco', 3, 3), null);
  const steps = d.history.length;
  while (d.canUndo()) d.undo();
  assert.equal(tileAt(m(), 'ground', 1, 1), 'grass');
  assert.equal(steps, 4, "rect, fill, and the two erases (the undone paint left the stack)");
});

test('editor ops: stamps place a multi-tile brush, clipped at the edges', () => {
  const { d, map, m } = doc();
  assert.equal(O.stamp(d, { map, stamp: 'hut', x: 2, y: 2 }), 3);
  assert.equal(tileAt(m(), 'deco', 2, 2), 'wall');
  assert.equal(tileAt(m(), 'deco', 3, 3), null, 'the stamp hole stays empty');
  const w = m().width;
  assert.equal(O.stamp(d, { map, stamp: 'hut', x: w - 1, y: 0 }), 2, 'clipped at the map edge');
  assert.throws(() => O.stamp(d, { map, stamp: 'nope', x: 0, y: 0 }), /unknown stamp/);
});

test('editor ops: objects — place, move, duplicate, delete, unique ids', () => {
  const { d, map, m } = doc();
  const id = O.placeObject(d, { map, type: 'npc', name: 'Mom', x: 3, y: 4 });
  assert.equal(id, 'mom');
  assert.equal(m().objects.length, 1);
  assert.equal(m().objects[0].pages.length, 1);
  const id2 = O.placeObject(d, { map, type: 'npc', name: 'Mom', x: 5, y: 4 });
  assert.notEqual(id2, id, 'ids stay unique');
  O.moveObject(d, { map, id, x: 6, y: 7 });
  assert.deepEqual([m().objects[0].x, m().objects[0].y], [6, 7]);
  d.undo();
  assert.deepEqual([m().objects[0].x, m().objects[0].y], [3, 4], 'a move is one undo step');
  const dup = O.duplicateObject(d, { map, id });
  assert.equal(m().objects.length, 3);
  assert.ok(O.deleteObject(d, { map, id: dup }));
  assert.equal(m().objects.length, 2);
  assert.ok(!O.deleteObject(d, { map, id: 'ghost' }));
  assert.throws(() => O.objectPath(d, map, 'ghost'), /no object/);
});

test('editor ops: pages — add, reorder, delete (never the last one)', () => {
  const { d, map, m } = doc();
  const id = O.placeObject(d, { map, type: 'npc', name: 'Mom', x: 1, y: 1 });
  const n = O.addPage(d, { map, id });
  assert.equal(n, 2);
  const obj = () => m().objects[0];
  assert.ok(obj().pages[1].when, 'a new page starts with a condition');
  O.setField(d, O.objectPath(d, map, id).concat('pages', 1, 'dir'), 'left');
  assert.equal(obj().pages[1].dir, 'left');
  O.movePage(d, { map, id, page: 1, to: 0 });
  assert.equal(obj().pages[0].dir, 'left');
  assert.ok(O.deletePage(d, { map, id, page: 0 }));
  assert.equal(obj().pages.length, 1);
  assert.ok(!O.deletePage(d, { map, id, page: 0 }), 'the last page stays');
});

test('editor ops: maps, scripts, vars, items, fragments', () => {
  const { d, map } = doc();
  const id = O.newMap(d, { id: 'cave', name: 'Cave', width: 10, height: 8, kind: 'cave' });
  assert.equal(id, 'cave');
  assert.equal(d.get(['maps', 'cave', 'width']), 10);
  assert.ok(d.get(['world', 'maps', 'cave']));
  O.renameMap(d, { map: 'cave', name: 'Deep Cave' });
  assert.equal(d.get(['maps', 'cave', 'name']), 'Deep Cave');
  O.paint(d, { map: 'cave', layer: 'ground', cells: [{ x: 9, y: 7 }], tile: 'path' });
  O.resizeMap(d, { map: 'cave', width: 6, height: 5 });
  assert.equal(d.get(['maps', 'cave', 'layers', 'ground']).length, 30);
  assert.ok(O.deleteMap(d, { map: 'cave' }));
  assert.equal(d.get(['maps', 'cave']), undefined);
  const s1 = O.newCommonEvent(d, { label: 'Meet Mom' });
  const s2 = O.newCommonEvent(d, { label: 'Meet Mom' });
  assert.equal(s1, 'meet-mom'); assert.equal(s2, 'meet-mom-2');
  O.setScript(d, { path: ['scripts', s1, 'body'], commands: KIT.screenplay.parse('Mom: hi').commands });
  assert.equal(d.get(['scripts', s1, 'body'])[0].text, 'hi');
  O.declareVar(d, { name: 'coins', type: 'number', label: 'Coins', group: 'Story' });
  assert.equal(d.get(['vars', 'coins']).label, 'Coins');
  const item = O.newItem(d, { name: 'Golden Berry', kind: 'berry' });
  assert.equal(item, 'golden-berry');
  const frag = O.addFragment(d, { title: 'Rain line', body: '"It is raining."', kind: 'dialogue' });
  const res = O.fragmentToScript(d, { fragment: frag, remove: true });
  assert.deepEqual(res.problems, []);
  assert.equal(d.get(['scripts', res.script, 'body'])[0].t, 'say');
  assert.equal((d.get(['fragments']) || []).length, 0);
  assert.deepEqual(O.problems(d.value).filter(p => p.severity === 'error'), []);
});
