// The pure parts of the map tools: line drawing, the rectangle cell set, the
// capped flood preview, the collision cycle — and the promise the whole tool
// file is built on: one pointer stroke is exactly one undo step.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const KIT = require('./_load.js');
const root = path.join(__dirname, '..', '..');
require(path.join(root, 'js/kit/world/map.js'));            // the tools ask the map view what is where
require(path.join(root, 'js/kit/editor/ops.js'));
require(path.join(root, 'js/kit/editor/tools.js'));

const T = KIT.editor.tools;
const tools = KIT.registry('editorTools');

// A headless stand-in for the editor shell: the same calls the tools use.
function fakeEditor(opts) {
  opts = opts || {};
  const project = KIT.project.normalize(KIT.project.blank()).project;
  if (opts.terrains) project.terrains = opts.terrains;
  const doc = KIT.document(project);
  const mapId = Object.keys(project.maps)[0];
  const ed = {
    state: {
      doc, project, mapId, map: KIT.mapView(project, null, mapId),
      mode: 'edit', tool: 'pencil', layer: opts.layer || 'ground', tile: opts.tile === undefined ? 'path' : opts.tile,
      stamp: null, selection: null, cursor: { x: 0, y: 0 }, view: { x: 0, y: 0, scale: 2 },
      show: {}, panel: 'tiles', problems: [],
    },
    ops: KIT.editor.ops,
    commit(label, fn) { return doc.transaction(label, () => fn(doc, KIT.editor.ops)); },
    set(patch) { Object.assign(ed.state, patch); },
    select(sel) { ed.state.selection = sel; },
    repaint() {},
    refresh() { ed.state.map = KIT.mapView(ed.state.project, null, ed.state.mapId); },
    toast() {},
  };
  return ed;
}
const pt = (x, y, extra) => Object.assign({ x: x + 0.5, y: y + 0.5, tx: x, ty: y, shift: false, alt: false, pointerId: 1 }, extra || {});
const tileAt = (ed, layer, x, y) => ed.state.project.maps[ed.state.mapId].layers[layer][y * ed.state.map.width + x];

test('line: a straight run of cells, both ends included', () => {
  assert.deepStrictEqual(T.line(2, 3, 2, 3), [{ x: 2, y: 3 }]);
  assert.deepStrictEqual(T.line(0, 0, 3, 0), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
  assert.deepStrictEqual(T.line(0, 0, 0, 2), [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }]);
  assert.deepStrictEqual(T.line(0, 0, 2, 2), [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]);
});

test('line: no gaps, and it runs backwards too', () => {
  const cells = T.line(7, 2, 1, 6);
  assert.deepStrictEqual(cells[0], { x: 7, y: 2 });
  assert.deepStrictEqual(cells[cells.length - 1], { x: 1, y: 6 });
  for (let i = 1; i < cells.length; i++) {
    const dx = Math.abs(cells[i].x - cells[i - 1].x), dy = Math.abs(cells[i].y - cells[i - 1].y);
    assert.ok(dx <= 1 && dy <= 1 && dx + dy > 0, `step ${i} jumped`);
  }
  assert.strictEqual(new Set(cells.map(c => `${c.x},${c.y}`)).size, cells.length, 'no cell twice');
});

test('rectCells: filled and outline', () => {
  const filled = T.rectCells(1, 1, 3, 2);
  assert.strictEqual(filled.length, 6);
  assert.deepStrictEqual(filled[0], { x: 1, y: 1 });
  assert.deepStrictEqual(filled[filled.length - 1], { x: 3, y: 2 });
  // corners given in any order describe the same rectangle
  assert.deepStrictEqual(T.rectCells(3, 2, 1, 1), filled);
  const ring = T.rectCells(0, 0, 3, 3, { outline: true });
  assert.strictEqual(ring.length, 12);                                   // 4×4 minus the 2×2 middle
  assert.ok(!ring.some(c => c.x === 1 && c.y === 1));
  assert.strictEqual(T.rectCells(5, 5, 5, 5).length, 1);
});

test('floodCells: walks matching cells only, and stops at the cap', () => {
  const grid = { width: 6, height: 4, cells: new Array(24).fill('grass'), at(x, y) { return this.cells[y * 6 + x]; } };
  for (let y = 0; y < 4; y++) grid.cells[y * 6 + 3] = 'water';           // a river down the middle
  const left = T.floodCells(grid, 0, 0, {});
  assert.strictEqual(left.cells.length, 12);
  assert.ok(!left.capped);
  assert.ok(left.cells.every(c => c.x < 3));
  assert.strictEqual(left.from, 'grass');

  const capped = T.floodCells(grid, 0, 0, { cap: 5 });
  assert.strictEqual(capped.cells.length, 5);
  assert.strictEqual(capped.capped, true);

  assert.deepStrictEqual(T.floodCells(grid, -1, 0, {}).cells, []);       // off the map is not a crash
  const empty = { width: 2, height: 1, at: () => null };
  assert.strictEqual(T.floodCells(empty, 0, 0, {}).cells.length, 2);     // null cells flood like any other value
});

test('collisionCycle: walkable, solid, the four edges, tall grass, then back to none', () => {
  assert.deepStrictEqual(T.COLLISION.map(c => c.value), [null, 0, 1, 'n', 's', 'e', 'w', 'g']);
  let v = null;
  const seen = [];
  for (let i = 0; i < 8; i++) { v = T.collisionCycle(v); seen.push(v); }
  assert.deepStrictEqual(seen, [0, 1, 'n', 's', 'e', 'w', 'g', null]);
  assert.strictEqual(T.collisionCycle(undefined), 0);                    // an unset cell counts as "none"
  // every value says what it means in words, not in codes
  for (const c of T.COLLISION) assert.ok(c.label.length > 3 && !/^[01nsewg]$/.test(c.label), c.label);
});

test('a pencil stroke of many moves is exactly one undo step', () => {
  const ed = fakeEditor({ layer: 'ground', tile: 'path' });
  const doc = ed.state.doc;
  const pencil = tools.get('pencil');
  pencil.begin(pt(2, 2), ed);
  for (let x = 3; x <= 9; x++) pencil.move(pt(x, 2), ed);
  pencil.end(pt(9, 2), ed);

  assert.strictEqual(doc.history.length, 1, `expected one undo step, got ${JSON.stringify(doc.history)}`);
  for (let x = 2; x <= 9; x++) assert.strictEqual(tileAt(ed, 'ground', x, 2), 'path');
  doc.undo();
  for (let x = 2; x <= 9; x++) assert.notStrictEqual(tileAt(ed, 'ground', x, 2), 'path');
  assert.strictEqual(doc.canUndo(), false);
});

test('a fast drag leaves no gaps (the cells between two moves are filled in)', () => {
  const ed = fakeEditor({ layer: 'ground', tile: 'path' });
  const pencil = tools.get('pencil');
  pencil.begin(pt(0, 0), ed);
  pencil.move(pt(4, 4), ed);                                             // one big jump, as a fast finger makes
  pencil.end(pt(4, 4), ed);
  for (let i = 0; i <= 4; i++) assert.strictEqual(tileAt(ed, 'ground', i, i), 'path');
  assert.strictEqual(ed.state.doc.history.length, 1);
});

test('shift-pencil draws a line from the last cell it painted', () => {
  const ed = fakeEditor({ layer: 'ground', tile: 'path' });
  const pencil = tools.get('pencil');
  pencil.begin(pt(1, 1), ed); pencil.end(pt(1, 1), ed);
  pencil.begin(pt(5, 1, { shift: true }), ed); pencil.end(pt(5, 1, { shift: true }), ed);
  for (let x = 1; x <= 5; x++) assert.strictEqual(tileAt(ed, 'ground', x, 1), 'path');
  assert.strictEqual(ed.state.doc.history.length, 2);                    // two taps, two undo steps
});

test('alt-pencil picks the tile under it instead of painting', () => {
  const ed = fakeEditor({ layer: 'ground', tile: 'path' });
  const pencil = tools.get('pencil');
  pencil.begin(pt(0, 0), ed); pencil.end(pt(0, 0), ed);                  // paint 'path' at 0,0
  ed.state.tile = 'water';
  pencil.begin(pt(0, 0, { alt: true }), ed);
  assert.strictEqual(ed.state.tile, 'path');
  assert.strictEqual(ed.state.doc.history.length, 1, 'picking is not an edit');
});

test('the rectangle tool: one drag, one undo step, the right cells', () => {
  const ed = fakeEditor({ layer: 'deco', tile: 'flower' });
  const rect = tools.get('rect');
  rect.cancel();
  rect.begin(pt(2, 2), ed);
  rect.move(pt(4, 3), ed);
  rect.end(pt(4, 3), ed);
  assert.strictEqual(ed.state.doc.history.length, 1);
  assert.strictEqual(tileAt(ed, 'deco', 2, 2), 'flower');
  assert.strictEqual(tileAt(ed, 'deco', 4, 3), 'flower');
  assert.strictEqual(tileAt(ed, 'deco', 5, 3), null);
});

test('the rectangle tool: tap a corner, tap the far corner (no dragging needed)', () => {
  const ed = fakeEditor({ layer: 'deco', tile: 'flower' });
  const rect = tools.get('rect');
  rect.cancel();
  rect.begin(pt(1, 1), ed); rect.end(pt(1, 1), ed);                      // first tap: just an anchor
  assert.strictEqual(ed.state.doc.history.length, 0);
  assert.strictEqual(tileAt(ed, 'deco', 1, 1), null);
  rect.begin(pt(3, 2), ed); rect.end(pt(3, 2), ed);                      // second tap: paint
  assert.strictEqual(ed.state.doc.history.length, 1);
  assert.strictEqual(tileAt(ed, 'deco', 1, 1), 'flower');
  assert.strictEqual(tileAt(ed, 'deco', 3, 2), 'flower');
});

test('the eraser puts the map kind\'s own ground back, and clears deco', () => {
  const ed = fakeEditor({ layer: 'ground', tile: 'path' });
  const eraser = tools.get('eraser');
  const base = tileAt(ed, 'ground', 0, 0);
  ed.state.project.maps[ed.state.mapId].layers.ground[0] = 'water';
  eraser.begin(pt(0, 0), ed); eraser.end(pt(0, 0), ed);
  assert.strictEqual(tileAt(ed, 'ground', 0, 0), base);

  ed.state.layer = 'deco';
  ed.state.project.maps[ed.state.mapId].layers.deco[0] = 'flower';
  eraser.begin(pt(0, 0), ed); eraser.end(pt(0, 0), ed);
  assert.strictEqual(tileAt(ed, 'deco', 0, 0), null);
});

test('the collision layer paints override values through one undo step', () => {
  const ed = fakeEditor({ layer: 'collision', tile: 1 });
  const pencil = tools.get('pencil');
  const map = () => ed.state.project.maps[ed.state.mapId];
  pencil.begin(pt(1, 1), ed);
  pencil.move(pt(2, 1), ed);
  pencil.move(pt(3, 1), ed);
  pencil.end(pt(3, 1), ed);
  const w = map().width;
  assert.strictEqual(ed.state.doc.history.length, 1);
  for (let x = 1; x <= 3; x++) assert.strictEqual(map().collision[1 * w + x], 1);
  // and the runtime agrees that those cells are now solid
  const view = KIT.mapView(ed.state.project, null, ed.state.mapId);
  assert.strictEqual(view.flagsAt(2, 1).solid, true);

  ed.state.tile = 'n';
  pencil.begin(pt(5, 5), ed); pencil.end(pt(5, 5), ed);
  assert.strictEqual(map().collision[5 * w + 5], 'n');
  assert.strictEqual(KIT.mapView(ed.state.project, null, ed.state.mapId).flagsAt(5, 5).passage.n, false);
});

test('the fill tool fills the puddle it was tapped in, once', () => {
  const ed = fakeEditor({ layer: 'ground', tile: 'path' });
  const fill = tools.get('fill');
  const m = ed.state.project.maps[ed.state.mapId];
  const before = m.layers.ground.filter(t => t === 'path').length;
  fill.begin(pt(3, 3), ed);
  fill.end(pt(3, 3), ed);
  assert.strictEqual(ed.state.doc.history.length, 1);
  const after = ed.state.project.maps[ed.state.mapId].layers.ground.filter(t => t === 'path').length;
  assert.strictEqual(after, m.width * m.height);
  assert.ok(after > before);
});

test('the terrain brush writes the terrain layer (and re-bakes in the same step)', () => {
  const ed = fakeEditor({ layer: 'terrain', tile: 2, terrains: [{ id: 1, name: 'Grass', color: '#58b848', base: 'grass' }, { id: 2, name: 'Path', color: '#d8b878', base: 'path' }] });
  const brush = tools.get('terrain');
  brush.begin(pt(4, 4), ed);
  brush.move(pt(5, 4), ed);
  brush.end(pt(5, 4), ed);
  const m = ed.state.project.maps[ed.state.mapId];
  assert.strictEqual(ed.state.doc.history.length, 1, 'the whole sweep is one undo step');
  assert.strictEqual(m.layers.terrain[4 * m.width + 4], 2);
  assert.strictEqual(m.layers.terrain[4 * m.width + 5], 2);
  assert.strictEqual(m.layers.ground[4 * m.width + 4], 'path', 'the terrain base was baked onto the ground');
  ed.state.doc.undo();
  const after = ed.state.project.maps[ed.state.mapId];
  assert.strictEqual(after.layers.terrain[4 * after.width + 4], 0);
  assert.notStrictEqual(after.layers.ground[4 * after.width + 4], 'path');
});

test('select/move: tap an event, tap a square, it moves — in one undo step', () => {
  const ed = fakeEditor({});
  const doc = ed.state.doc;
  const id = KIT.editor.ops.placeObject(doc, { map: ed.state.mapId, type: 'npc', x: 3, y: 3, name: 'Mom' });
  ed.refresh();
  doc.clearHistory();
  const select = tools.get('select');
  select.cancel();
  select.begin(pt(3, 3), ed); select.end(pt(3, 3), ed);
  assert.deepStrictEqual(ed.state.selection, { kind: 'object', map: ed.state.mapId, id });
  assert.strictEqual(doc.history.length, 0, 'selecting is not an edit');

  select.begin(pt(8, 6), ed); select.end(pt(8, 6), ed);
  const obj = ed.state.project.maps[ed.state.mapId].objects[0];
  assert.deepStrictEqual({ x: obj.x, y: obj.y }, { x: 8, y: 6 });
  assert.strictEqual(doc.history.length, 1);
  doc.undo();
  const back = ed.state.project.maps[ed.state.mapId].objects[0];
  assert.deepStrictEqual({ x: back.x, y: back.y }, { x: 3, y: 3 });
});

test('every tool the palette promises is registered, with a key and an order', () => {
  const ids = tools.ids();
  for (const id of ['pencil', 'fill', 'rect', 'eraser', 'eyedropper', 'stamp', 'terrain', 'select', 'hand']) {
    assert.ok(ids.includes(id), `missing tool ${id}`);
    const t = tools.get(id);
    assert.ok(t.label && t.icon, `${id} needs a label and an icon`);
    assert.ok(/^[1-9]$/.test(t.key), `${id} needs a number key`);
    assert.strictEqual(typeof t.preview, 'function', `${id} needs a ghost`);
  }
  const order = tools.list().map(t => t.order);
  assert.deepStrictEqual(order.slice().sort((a, b) => a - b), order, 'tools are registered in toolbar order');
});

test('a brush value that does not suit the layer is made to suit it', () => {
  // the shell's [ and ] keys change the layer without touching the brush
  const ed = fakeEditor({ layer: 'regions', tile: 'grass' });
  const pencil = tools.get('pencil');
  pencil.begin(pt(2, 2), ed); pencil.end(pt(2, 2), ed);
  const m = ed.state.project.maps[ed.state.mapId];
  assert.strictEqual(m.layers.regions[2 * m.width + 2], 0, 'a tile id lands on a number layer as 0, never as a string');

  ed.state.layer = 'collision';
  ed.state.tile = 'grass';
  pencil.begin(pt(3, 3), ed); pencil.end(pt(3, 3), ed);
  assert.strictEqual(m.collision[3 * m.width + 3], null);
});

test('the eraser clears a collision override', () => {
  const ed = fakeEditor({ layer: 'collision', tile: 1 });
  const pencil = tools.get('pencil'), eraser = tools.get('eraser');
  const m = () => ed.state.project.maps[ed.state.mapId];
  pencil.begin(pt(4, 4), ed); pencil.end(pt(4, 4), ed);
  assert.strictEqual(m().collision[4 * m().width + 4], 1);
  eraser.begin(pt(4, 4), ed); eraser.end(pt(4, 4), ed);
  assert.strictEqual(m().collision[4 * m().width + 4], null);
  assert.strictEqual(ed.state.doc.history.length, 2);
});

test('the tools the toolbar drives are the registry copies, with their own state', () => {
  const rect = tools.get('rect');
  assert.strictEqual(KIT.editor.tools.byId.rect, rect, 'byId must point at the copy the shell calls');
});
