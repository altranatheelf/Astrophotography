'use strict';
// The pure half of the placing tools: the field-widget registry, form values,
// ref pickers, the condition text round-trip, move-route language, and renaming
// an object (which has to rewrite everything that pointed at it).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('./_load.js');
const R = (f) => require(path.join(__dirname, '..', '..', f));
R('js/kit/world/map.js');
R('js/kit/editor/ops.js');
R('js/kit/editor/inspector.js');
R('js/kit/editor/panels-objects.js');

const INS = KIT.editor.inspector;
const OBJ = KIT.editor.objects;
const S = KIT.schema;

const tiles = KIT.registry('tiles');
for (const t of [{ id: 'grass', group: 'nature' }, { id: 'path', group: 'nature' }, { id: 'sign', group: 'town' }]) if (!tiles.has(t.id)) tiles.add(t);
const sprites = KIT.registry('sprites');
for (const s of [{ id: 'hero-boy', name: 'Boy' }, { id: 'mom', name: 'Mom' }]) if (!sprites.has(s.id)) sprites.add(s);

function blank() {
  const { project } = KIT.project.normalize(KIT.project.blank());
  return project;
}
function docOf(project) { return KIT.document(project); }

// ---- the widget registry ----------------------------------------------------------
test('inspector: every schema field type resolves to a widget', () => {
  const missing = [];
  for (const type of INS.knownTypes()) {
    const def = INS.editorFor(type);
    if (!def || def.id === 'unknown') missing.push(type);
  }
  assert.deepEqual(missing, [], 'every schema type needs a field editor');
});

test('inspector: ref kinds all fall through to the ref widget, unknown types to the raw one', () => {
  assert.equal(INS.editorFor({ key: 'x', type: 'ref:item' }).id, 'ref');
  assert.equal(INS.editorFor({ key: 'x', type: 'ref:module-thing' }).id, 'ref');
  assert.equal(INS.editorFor({ key: 'x', type: 'tile' }).id, 'ref');
  assert.equal(INS.editorFor({ key: 'x', type: 'sparkles' }).id, 'unknown');
  assert.equal(INS.editorFor({ key: 'x', type: 'bool' }).id, 'bool');
  assert.equal(INS.editorFor({ key: 'x', type: 'enum' }).id, 'enum');
});

test('inspector: a module can register a widget for its own type', () => {
  KIT.schema.defineType('stars', { validate() {}, default() { return 0; } });
  KIT.registry('fieldEditors').add({ id: 'stars', types: ['stars'], mount() { return { set() {} }; } });
  assert.equal(INS.editorFor({ key: 'rating', type: 'stars' }).id, 'stars');
});

// ---- building values ---------------------------------------------------------------
test('inspector: buildValue fills a form description and round-trips', () => {
  const fields = [
    { key: 'name', type: 'string', default: 'Someone' },
    { key: 'count', type: 'number', integer: true, min: 1, default: 2 },
    { key: 'talks', type: 'bool', default: true },
    { key: 'sprite', type: 'ref:sprite' },
    { key: 'when', type: 'condition' },
    { key: 'route', type: 'route' },
    { key: 'home', type: 'position' },
    { key: 'behaviour', type: 'group', fields: [{ key: 'kind', type: 'enum', options: ['none', 'wander'] }, { key: 'radius', type: 'number', default: 3 }] },
  ];
  const once = INS.buildValue(fields, { name: 'Mom' });
  assert.equal(once.name, 'Mom');
  assert.equal(once.count, 2);
  assert.equal(once.talks, true);
  assert.equal(once.sprite, null);
  assert.equal(once.when, null);
  assert.deepEqual(once.route, []);
  assert.deepEqual(once.home, { x: 0, y: 0 });
  assert.deepEqual(once.behaviour, { kind: 'none', radius: 3 });
  assert.deepEqual(INS.buildValue(fields, once), once, 'building it again changes nothing');
  assert.deepEqual(S.validate(fields, once, {}), [], 'a built value passes its own schema');
  // extra keys survive (page props a module added)
  assert.equal(INS.buildValue(fields, { extra: 7 }).extra, 7);
});

test('inspector: defaults are marked as inherited until they are overridden', () => {
  const f = { key: 'through', type: 'bool', default: false };
  assert.equal(INS.isDefault(f, false), true);
  assert.equal(INS.isDefault(f, true), false);
  // an object type's page defaults win over the schema default
  const ctx = { inherited: { through: true } };
  assert.equal(INS.defaultFor(f, ctx), true);
  assert.equal(INS.isDefault(f, true, ctx), true);
  assert.equal(INS.isDefault(f, false, ctx), false);
});

test('inspector: `when` decides which fields the form shows', () => {
  const fields = KIT.project.fields.behaviour;
  const shown = (v) => INS.visibleFields(fields, v).map(f => f.key);
  assert.ok(!shown({ kind: 'none' }).includes('route'));
  assert.ok(shown({ kind: 'route' }).includes('route'));
  assert.ok(shown({ kind: 'wander' }).includes('radius'));
  assert.ok(!shown({ kind: 'route' }).includes('radius'));
});

// ---- ref pickers --------------------------------------------------------------------
test('inspector: a ref picker lists the real ids of a project', () => {
  const project = blank();
  project.items.berry = KIT.project.fillItem({ name: 'Berry' }, 'berry');
  project.items.rod = KIT.project.fillItem({ name: 'Old Rod' }, 'rod');
  project.vars.chapter = KIT.project.fillVar({ type: 'number', default: 0, label: 'Chapter' }, 'chapter');
  project.scripts.intro = { label: 'Intro', trigger: 'call', when: null, params: [], body: [], note: '' };
  const ctx = { project };

  assert.deepEqual(INS.refList('item', ctx), [{ id: 'berry', label: 'Berry' }, { id: 'rod', label: 'Old Rod' }]);
  assert.deepEqual(INS.refList('var', ctx), [{ id: 'chapter', label: 'Chapter' }]);
  assert.deepEqual(INS.refList('script', ctx).map(o => o.id), ['intro']);
  assert.deepEqual(INS.refList('map', ctx).map(o => o.id), Object.keys(project.maps));
  assert.ok(INS.refList('sprite', ctx).some(o => o.id === 'hero-boy'));

  assert.equal(INS.refExists('item', 'berry', ctx), true);
  assert.equal(INS.refExists('item', 'nope', ctx), false);
  assert.equal(INS.refLabel('item', 'berry', ctx), 'Berry');
  // "Create <kind> <id>" is offered for the things the editor can make
  assert.equal(INS.canCreateRef('item'), true);
  assert.equal(INS.canCreateRef('var'), true);
  assert.equal(INS.canCreateRef('script'), true);
  assert.equal(INS.canCreateRef('sprite'), false, 'art comes from files, not from a button');
});

test('inspector: the object ref picker lists the objects of the map in context', () => {
  const project = blank();
  const mapId = Object.keys(project.maps)[0];
  project.maps[mapId].objects = [KIT.project.fillObject({ id: 'mom', name: 'Mom', type: 'npc', x: 1, y: 1 })];
  const ctx = { project, map: project.maps[mapId] };
  assert.deepEqual(INS.refList('object', ctx), [{ id: 'mom', label: 'Mom' }]);
  assert.equal(INS.refExists('object', 'mom', ctx), true);
  assert.equal(INS.refExists('object', 'dad', ctx), false);
});

// ---- conditions -----------------------------------------------------------------------
test('inspector: the condition builder round-trips every kind through text', () => {
  const cases = [
    null,
    { kind: 'var', name: 'chapter', op: '>=', value: 2, var: null },
    { kind: 'self', key: 'opened', op: '==', value: true },
    { kind: 'item', id: 'berry', op: '>=', count: 1 },
    { kind: 'facing', target: 'self', dir: 'left' },
    { kind: 'region', id: 3, target: 'hero' },
    { kind: 'meta', key: 'runs', op: '>', value: 0 },
    { kind: 'not', of: { kind: 'item', id: 'berry', op: '>=', count: 1 } },
    { kind: 'all', of: [{ kind: 'var', name: 'chapter', op: '>=', value: 2, var: null }, { kind: 'self', key: 'done', op: '==', value: false }] },
    { kind: 'any', of: [{ kind: 'var', name: 'a', op: '==', value: 1, var: null }, { kind: 'var', name: 'b', op: '==', value: 1, var: null }] },
  ];
  for (const cond of cases) {
    const text = INS.conditionText(cond);
    const back = INS.conditionFromText(text);
    assert.equal(back.ok, true, `parsing back '${text}'`);
    assert.deepEqual(back.cond, cond === null ? null : KIT.conditions.normalize(cond), `round-trip of ${text}`);
  }
  assert.equal(INS.conditionText(null), 'always');
  // nesting survives
  const nested = { kind: 'all', of: [{ kind: 'var', name: 'chapter', op: '>=', value: 2, var: null }, { kind: 'not', of: { kind: 'item', id: 'berry', op: '>=', count: 1 } }] };
  assert.equal(INS.conditionText(nested), 'chapter >= 2 and not item.berry >= 1');
  assert.deepEqual(INS.conditionFromText('chapter >= 2 and not item.berry >= 1').cond, nested);
});

test('inspector: bad condition text is reported, never thrown', () => {
  const bad = INS.conditionFromText('chapter >=');
  assert.equal(bad.ok, false);
  assert.ok(bad.error && !/^condition:/.test(bad.error));
  assert.equal(INS.conditionFromText('always').cond, null);
});

test('inspector: newCondition fills a kind with its defaults', () => {
  const c = INS.newCondition('var');
  assert.equal(c.kind, 'var');
  assert.equal(c.op, '==');
  const all = INS.newCondition('all');
  assert.deepEqual(all.of, []);
  assert.equal(INS.newCondition('always'), null);
  const kinds = INS.conditionKinds().map(k => k.id);
  assert.deepEqual(kinds.slice(0, 6), ['var', 'self', 'item', 'facing', 'region', 'meta'], 'the six the author reaches for come first');
  assert.deepEqual(kinds.slice(-3), ['all', 'any', 'not'], 'the nesting kinds come last');
});

// ---- move routes ------------------------------------------------------------------------
test('inspector: a move route reads as plain language', () => {
  assert.equal(INS.routeStepLabel('up'), 'step up');
  assert.equal(INS.routeStepLabel('wait:500'), 'wait 500ms');
  assert.equal(INS.routeStepLabel('wait:1000'), 'wait 1s');
  assert.equal(INS.routeStepLabel('face:left'), 'face left');
  assert.equal(INS.routeStepLabel('visible:off'), 'vanish');
  assert.equal(INS.routeStepLabel('nonsense'), 'nonsense');
  assert.equal(INS.routeSummary([]), 'No steps yet — this event stands still.');
  assert.equal(INS.routeSummary(['up']), 'Step up.');
  assert.equal(INS.routeSummary(['up', 'up', 'face:left']), 'Step up, step up, then face left.');
  assert.equal(INS.routeSummary(['up', 'down'], { repeat: true }), 'Step up, then step down, over and over.');
  // every verb the builder offers has a label
  for (const v of INS.ROUTE_VERBS) assert.ok(INS.routeStepLabel(v.verb).length, `${v.verb} needs words`);
});

// ---- renaming ---------------------------------------------------------------------------
function projectWithReferences() {
  const project = blank();
  const mapId = Object.keys(project.maps)[0];
  const map = project.maps[mapId];
  map.objects = [
    KIT.project.fillObject({ id: 'mom', name: 'Mom', type: 'npc', x: 3, y: 4 }),
    KIT.project.fillObject({
      id: 'clock', name: 'Clock', type: 'sign', x: 5, y: 5,
      pages: [{
        when: { kind: 'facing', target: 'obj:mom', dir: 'down' },
        on: {
          interact: [
            { t: 'moveRoute', target: 'obj:mom', steps: ['up'], wait: true },
            { t: 'if', when: { kind: 'facing', target: 'obj:mom', dir: 'left' }, then: [{ t: 'balloon', target: 'obj:mom', kind: 'exclamation', wait: true }], else: [] },
          ],
        },
      }],
    }),
  ];
  project.scripts.greet = { label: 'Greet', trigger: 'call', when: null, params: [], body: [{ t: 'moveRoute', target: 'obj:mom', steps: ['down'], wait: true }], note: '' };
  return { project: KIT.project.normalize(project).project, mapId };
}

test('objects: references() finds every place an object id is used', () => {
  const { project } = projectWithReferences();
  const refs = OBJ.references(project, 'mom');
  const paths = refs.map(r => r.path.join('/'));
  assert.ok(paths.some(p => /pages\/0\/when\/target$/.test(p)), 'a page condition target');
  assert.ok(paths.some(p => /on\/interact\/0\/target$/.test(p)), 'a Move Route target');
  assert.ok(paths.some(p => /on\/interact\/1\/when\/target$/.test(p)), 'the condition of an If');
  assert.ok(paths.some(p => /on\/interact\/1\/then\/0\/target$/.test(p)), 'a target inside an If');
  assert.ok(paths.some(p => /^scripts\/greet\/body\/0\/target$/.test(p)), 'a common event');
  assert.equal(OBJ.references(project, 'nobody').length, 0);
});

test('objects: renaming an id rewrites every reference, in one undo step', () => {
  const { project, mapId } = projectWithReferences();
  const doc = docOf(project);
  const before = doc.history.length;
  const res = OBJ.rename(doc, { map: mapId, id: 'mom', to: 'Mother Dearest' });
  assert.equal(res.ok, true);
  assert.equal(res.id, 'mother-dearest', 'ids are slugged');
  assert.equal(res.rewritten, 5);
  assert.equal(doc.history.length, before + 1, 'one undo step');

  const map = doc.get(['maps', mapId]);
  assert.equal(map.objects[0].id, 'mother-dearest');
  const page = map.objects[1].pages[0];
  assert.equal(page.when.target, 'obj:mother-dearest');
  assert.equal(page.on.interact[0].target, 'obj:mother-dearest');
  assert.equal(page.on.interact[1].then[0].target, 'obj:mother-dearest');
  assert.equal(doc.value.scripts.greet.body[0].target, 'obj:mother-dearest');

  doc.undo();
  assert.equal(doc.get(['maps', mapId]).objects[0].id, 'mom');
  assert.equal(doc.get(['maps', mapId]).objects[1].pages[0].on.interact[0].target, 'obj:mom');
});

test('objects: a rename that cannot work is refused with a reason', () => {
  const { project, mapId } = projectWithReferences();
  const doc = docOf(project);
  assert.equal(OBJ.rename(doc, { map: mapId, id: 'mom', to: 'clock' }).ok, false, 'the id is taken');
  assert.equal(OBJ.rename(doc, { map: mapId, id: 'mom', to: '  ' }).ok, false, 'an empty id');
  assert.equal(OBJ.rename(doc, { map: mapId, id: 'ghost', to: 'x' }).ok, false, 'no such event');
  assert.equal(OBJ.rename(doc, { map: mapId, id: 'mom', to: 'mom' }).rewritten, 0, 'the same id is a no-op');
  assert.equal(doc.history.length, 0, 'nothing was written');
});

test('objects: changing the type lets the new type\'s page defaults through, but keeps what the author chose', () => {
  const { project, mapId } = projectWithReferences();
  const doc = docOf(project);
  const mom = () => doc.get(['maps', mapId, 'objects', 0]);
  assert.deepEqual([mom().pages[0].layer, mom().pages[0].through, mom().pages[0].visible], ['same', false, true], 'an NPC starts solid and visible');
  const before = doc.history.length;
  assert.equal(OBJ.retype(doc, { map: mapId, id: 'mom', type: 'warp' }), true);
  assert.equal(doc.history.length, before + 1, 'one undo step');
  assert.equal(mom().type, 'warp');
  // fillPage alone kept `same`/false, which is a warp the hero can never step on (world.js: solid = same && !through)
  assert.equal(mom().pages[0].layer, 'below', 'the warp type says below');
  assert.equal(mom().pages[0].through, true, 'and through');
  assert.deepEqual(mom().pages[0].props.to, { map: null, x: 0, y: 0 }, 'the warp props are filled in');
  assert.equal(OBJ.retype(doc, { map: mapId, id: 'mom', type: 'trigger' }), true);
  assert.equal(mom().pages[0].visible, false, 'a trigger is invisible');
  // a value the author set stays: a visible trigger turned back into an NPC is still visible
  doc.set(['maps', mapId, 'objects', 0, 'pages', 0, 'visible'], true);
  doc.set(['maps', mapId, 'objects', 0, 'pages', 0, 'dir'], 'left');
  OBJ.retype(doc, { map: mapId, id: 'mom', type: 'npc' });
  assert.equal(mom().pages[0].visible, true, 'visible was chosen, so it is kept');
  assert.equal(mom().pages[0].dir, 'left', 'a field no type talks about is untouched');
  assert.equal(mom().pages[0].through, false, 'through goes back to the schema default');
  assert.equal(OBJ.retype(doc, { map: mapId, id: 'ghost', type: 'npc' }), false, 'no such event');
});

// ---- pages -------------------------------------------------------------------------------
test('objects: the page list shows which page wins under the current conditions', () => {
  const project = blank();
  const mapId = Object.keys(project.maps)[0];
  project.vars.chapter = KIT.project.fillVar({ type: 'number', default: 1 }, 'chapter');
  project.maps[mapId].objects = [KIT.project.fillObject({
    id: 'mom', name: 'Mom', type: 'npc', x: 1, y: 1,
    pages: [
      { when: null },
      { when: { kind: 'var', name: 'chapter', op: '>=', value: 1 } },
      { when: { kind: 'var', name: 'chapter', op: '>=', value: 5 } },
    ],
  })];
  const p = KIT.project.normalize(project).project;
  const view = KIT.mapView(p, null, mapId);
  const order = OBJ.pageOrder(p, view, p.maps[mapId].objects[0]);
  assert.deepEqual(order.map(o => o.text), ['always', 'chapter >= 1', 'chapter >= 5']);
  assert.deepEqual(order.map(o => o.active), [false, true, false], 'the LAST passing page wins');
});

test('objects: a preset that builds two events places both (transfer pair)', () => {
  const project = blank();
  const mapId = Object.keys(project.maps)[0];
  const second = KIT.project.newMap({ id: 'cave', name: 'Cave', width: 10, height: 10 });
  project.maps.cave = KIT.project.fillMap(second, 'cave');
  const doc = docOf(project);
  const placed = OBJ.placePreset(doc, { preset: 'transfer-pair', map: mapId, x: 2, y: 3, input: { to: { map: 'cave', x: 4, y: 5 } } });
  assert.equal(placed.length, 2);
  assert.deepEqual(placed.map(p => p.map).sort(), [mapId, 'cave'].sort());
  assert.equal(doc.history.length, 1, 'one undo step for the pair');
  const here = doc.get(['maps', mapId, 'objects']);
  assert.equal(here.length, 1);
  assert.deepEqual(here[0].pages[0].props.to, { map: 'cave', x: 4, y: 5 });
  const there = doc.get(['maps', 'cave', 'objects']);
  assert.equal(there[0].pages[0].props.to.map, mapId, 'the far side leads back');
});

// ---- small helpers ---------------------------------------------------------------------
test('inspector: scalars and region colours', () => {
  assert.equal(INS.parseScalar('12'), 12);
  assert.equal(INS.parseScalar('true'), true);
  assert.equal(INS.parseScalar('false'), false);
  assert.equal(INS.parseScalar('Mom'), 'Mom');
  assert.equal(INS.scalarText(true), 'true');
  assert.equal(INS.regionColor(0), '#2a3346');
  assert.equal(INS.regionColor(4), INS.regionColor(4), 'the same region is always the same colour');
  assert.notEqual(INS.regionColor(1), INS.regionColor(2));
});

test('inspector: a script slot summarises its first line', () => {
  assert.equal(INS.scriptSummary([]), 'empty');
  const one = INS.scriptSummary([{ t: 'say', text: 'Hello!', who: 'Mom' }], {});
  assert.match(one, /Mom: Hello!/);
  const many = INS.scriptSummary([{ t: 'say', text: 'Hello!' }, { t: 'wait', ms: 100 }], {});
  assert.match(many, /\+1 more$/);
});

// ---- widgets, in a stand-in document -------------------------------------------------
// The widgets build DOM, and these tests run without a browser. This is the
// least of a document the chip widgets touch — elements with children,
// attributes and a click handler — and no more, so a test cannot pass by
// leaning on something a real page would not do.
R('js/kit/scenes/stack.js');
function withDocument(fn) {
  class El {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.dataset = {}; this.style = {}; this.className = ''; this.textContent = ''; this.value = '';
      const names = new Set();
      this.classList = { toggle: (c, on) => { if (on === undefined ? !names.has(c) : on) names.add(c); else names.delete(c); }, contains: (c) => names.has(c) };
    }
    appendChild(c) { this.children.push(c); return c; }
    set innerHTML(v) { if (v === '') this.children = []; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
    all(tag) { return this.children.flatMap(c => (c.tagName === tag ? [c] : []).concat(c.all(tag))); }
  }
  const had = Object.prototype.hasOwnProperty.call(global, 'document');
  global.document = { createElement: (t) => new El(t), activeElement: null };
  try { return fn(() => new El('div')); } finally { if (!had) delete global.document; }
}
const click = (b) => b.onclick({ preventDefault() {} });

test('inspector: an enum shown as chips is one button per choice, however many there are', () => withDocument((div) => {
  const host = div();
  const picked = [];
  const field = { key: 'face', type: 'enum', display: 'chips', default: 'left',
    options: [{ value: 'left', label: 'Left' }, 'right', 'above-left', 'above-right', { value: 'none', label: 'Hidden' }] };
  const w = INS.field(host, field, 'left', (v) => picked.push(v));
  const buttons = host.all('BUTTON');
  assert.equal(buttons.length, 5, 'five choices, five buttons — a segmented control stops at four');
  assert.deepEqual(buttons.map(b => b.textContent), ['Left', 'Right', 'Above Left', 'Above Right', 'Hidden']);
  assert.deepEqual(buttons.map(b => b.getAttribute('aria-pressed')), ['true', 'false', 'false', 'false', 'false']);
  click(buttons[4]);
  assert.deepEqual(picked, ['none']);
  assert.equal(buttons[4].getAttribute('aria-pressed'), 'true');
  assert.equal(buttons[0].getAttribute('aria-pressed'), 'false');
  w.set('right');
  assert.equal(buttons[1].getAttribute('aria-pressed'), 'true', 'and it follows the document');
}));

test('inspector: a short text with chips offers them, and a box for anything else', () => withDocument((div) => {
  const host = div();
  const picked = [];
  INS.field(host, { key: 'glyph', type: 'string', display: 'chips', options: [{ value: '▶', label: '▶' }, { value: '', label: 'None' }] }, '▶', (v) => picked.push(v));
  const buttons = host.all('BUTTON');
  const box = host.all('INPUT')[0];
  assert.equal(buttons.length, 2);
  assert.ok(box, 'the box for a mark of your own');
  click(buttons[1]);
  assert.deepEqual(picked, [''], '"None" is the empty mark');
  assert.equal(box.value, '');
}));

test('inspector: a colour that may be empty says what empty means', () => withDocument((div) => {
  const host = div();
  const picked = [];
  const w = INS.field(host, { key: 'nameInk', type: 'color', nullable: true, noneLabel: 'Same as accent' }, '#ff0000', (v) => picked.push(v));
  const none = host.all('BUTTON')[0];
  assert.equal(none.textContent, 'Same as accent');
  assert.equal(none.getAttribute('aria-pressed'), 'false');
  const swatch = host.all('INPUT').find(i => i.className.includes('ed-color'));
  assert.ok(!swatch.classList.contains('is-none'));
  click(none);
  assert.deepEqual(picked, [null]);
  assert.equal(none.getAttribute('aria-pressed'), 'true');
  assert.ok(swatch.classList.contains('is-none'), 'and the swatch fades: black there would be a lie');
  w.set('#00ff00');
  assert.equal(none.getAttribute('aria-pressed'), 'false');
  const plain = div();
  INS.field(plain, { key: 'paper', type: 'color' }, '#ffffff', () => {});
  assert.equal(plain.all('BUTTON').length, 0, 'a colour that must be a colour has no such button');
}));

test('inspector: a font is a chip for each of the game\'s fonts and each font word, written in itself', () => withDocument((div) => {
  const host = div();
  const picked = [], asked = [];
  const project = { fonts: { dot: { name: 'Dot Gothic', src: 'data:font/ttf;base64,AAEAAA==', pixel: true }, gone: { name: 'Linked', src: 'https://x/y.ttf' } } };
  const field = { key: 'fontName', label: 'Speaker\'s name', type: 'font', nullable: true, noneLabel: 'Same as names and menus' };
  const w = INS.field(host, field, null, (v) => picked.push(v), { project, addFont: (f) => asked.push(f.key) });
  const buttons = host.all('BUTTON');
  assert.deepEqual(buttons.map(b => b.textContent), ['Dot Gothic', 'Plain', 'Pixel', 'Typewriter', 'Book', 'Rounded', 'Same as names and menus', 'Add a font…'],
    'the game\'s own usable fonts first, then the five words, none, and a way to bring one in');
  assert.ok(/^"kitf-dot", /.test(buttons[0].style.fontFamily), 'each chip in its own letters');
  assert.equal(buttons[6].getAttribute('aria-pressed'), 'true', 'empty is "Same as names and menus"');
  click(buttons[0]);
  assert.deepEqual(picked, ['dot']);
  click(buttons[7]);
  assert.deepEqual(asked, ['fontName'], '"Add a font…" asks the form for a file, for this field');
  w.set('mono');
  assert.equal(buttons[3].getAttribute('aria-pressed'), 'true');
  // A font the game no longer has keeps a chip, so what is chosen can be seen.
  const lost = div();
  INS.field(lost, { key: 'fontText', type: 'font' }, 'gone', () => {}, { project });
  assert.equal(lost.all('BUTTON')[0].textContent, 'gone (not in this game)');
  assert.equal(lost.all('BUTTON')[0].getAttribute('aria-pressed'), 'true');
}));

test('inspector: what a message says shows the pages the look\'s box will make of it', () => withDocument((div) => {
  R('js/kit/ui/parts.js'); R('js/kit/scenes/dialogue.js');                    // the message box's own line breaking
  try {
    KIT.look.use({ ui: { dialogue: { lines: 2, prefix: '* ' } } });
    const pages = INS.messagePages('One two three four five six seven eight nine ten eleven twelve thirteen.\nNext', {});
    assert.ok(pages.every(p => p.length <= 2), 'two lines to a page, as the look says');
    assert.ok(pages[0][0].startsWith('* One'), `the look's mark starts the line (${pages[0][0]})`);
    assert.ok(pages[0][1].startsWith('  '), 'and a wrapped line lines up after it');
    assert.ok(pages.flat().some(l => l === '* Next'), 'a new line of the author\'s starts with the mark again');
  } finally { KIT.look.use(null); }
  // Only a message's own text: a description or a note never goes in the box, so it shows no pages.
  const say = div(), desc = div();
  INS.field(say, { key: 'text', type: 'text', display: 'message' }, 'Hello', () => {}, {});
  INS.field(desc, { key: 'desc', type: 'text' }, 'Hello', () => {}, {});
  const boxes = (el) => el.all('DIV').filter(d => d.className === 'ed-preview-box').length;
  assert.equal(boxes(say), 1);
  assert.equal(boxes(desc), 0);
  assert.equal(KIT.registry('commands').get('say').fields.find(f => f.key === 'text').display, 'message', 'Show Text\'s words are a message');
}));

test('inspector: a look whose page scrolls shows each press of A, and a look changed later is drawn again', () => withDocument((div) => {
  R('js/kit/ui/parts.js'); R('js/kit/scenes/dialogue.js');                    // the message box's own paging
  const text = 'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen.';
  try {
    KIT.look.use({ ui: { dialogue: { lines: 2, pageTurn: 'scroll' } } });
    const scroll = INS.messagePages(text, {});
    KIT.look.use({ ui: { dialogue: { lines: 2 } } });
    const clear = INS.messagePages(text, {});
    const rows = clear.flat();
    assert.ok(rows.length >= 4, `${rows.length} lines`);
    assert.equal(scroll.length, rows.length - 1, 'a press for each line after the first two, as the game has it');
    for (let i = 1; i < scroll.length; i++) assert.equal(scroll[i][0], scroll[i - 1][1], 'each press keeps the line before it at the top');
    // The Show Text form follows the look: drawn with Handheld's two lines
    // that scroll, it is drawn again when the look changes to three that clear.
    KIT.look.use({ ui: { dialogue: { lines: 2, pageTurn: 'scroll' } } });
    const say = div();
    INS.field(say, { key: 'text', type: 'text', display: 'message' }, text, () => {}, {});
    const boxes = () => say.all('DIV').filter(d => d.className === 'ed-preview-box');
    assert.equal(boxes().length, scroll.length);
    assert.ok(say.all('DIV').some(d => d.className === 'ed-hint' && /a press of A at a time/.test(d.textContent)), 'and says each is a press of A');
    KIT.look.use(null);
    KIT.look.events.emit('applied', { css: '', look: KIT.look.current() });
    assert.equal(boxes().length, KIT.text.paginate(INS.messagePages(text, {}).flat(), 3).length, 'the kit\'s three lines that clear, once the look is applied');
    assert.ok(boxes().every(b => b.children.filter(c => c.className === 'ed-preview-line').length <= 3));
  } finally { KIT.look.use(null); }
}));

test('inspector: an empty colour that follows another shows that colour in its square, not black', () => withDocument((div) => {
  const host = div();
  let accent = '#3b4b8a';
  const field = { key: 'nameInk', type: 'color', nullable: true, noneLabel: 'Same as accent', follows: 'accent' };
  const w = INS.field(host, field, null, () => {}, { noneColour: (f) => (f.follows === 'accent' ? accent : null) });
  const swatch = host.all('INPUT').find(i => i.className.includes('ed-color'));
  const hex = host.all('INPUT').find(i => i.className.includes('ed-hex'));
  assert.equal(swatch.value, '#3b4b8a', 'the square is the accent the name is drawn in');
  assert.ok(swatch.classList.contains('is-none'), 'faded, as it has no colour of its own');
  assert.equal(hex.value, '', 'and the hex box stays empty: nothing is stored');
  w.set('#00ff00');
  assert.equal(swatch.value, '#00ff00');
  accent = '#fff';
  w.set(null);
  assert.equal(swatch.value, '#ffffff', 'back to following, it shows the accent as it is now, #rgb written out');
  const none = div();
  INS.field(none, { key: 'rim', type: 'color', nullable: true, noneLabel: 'None' }, null, () => {}, { noneColour: () => null });
  assert.equal(none.all('INPUT').find(i => i.className.includes('ed-color')).value, '#000000', 'a colour that is simply none has nothing to show');
}));
