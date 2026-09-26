// Editor operations: every change Creator Mode can make to a project, as
// document transactions. Pure and headless — the panels and tools in the UI
// call these, and so do the tests. Because everything goes through the
// document, undo/redo, autosave, validation and live re-render come for free.
//
//   KIT.editor.ops.paint(doc, { map:'town', layer:'ground', cells:[{x,y}], tile:'path' })
//   KIT.editor.ops.placeObject(doc, { map:'town', type:'npc', x:4, y:5 })
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const ED = KIT.editor = KIT.editor || {};
  const O = ED.ops = ED.ops || {};
  const P = KIT.project;

  const mapPath = (map) => ['maps', map];
  // The five tile layers live under map.layers; `collision` is its own array beside them.
  const layerPath = (map, layer) => (layer === 'collision' ? ['maps', map, 'collision'] : ['maps', map, 'layers', layer]);
  const layerArray = (m, layer) => (layer === 'collision' ? m.collision : m.layers[layer]);
  const idx = (m, x, y) => y * m.width + x;
  const inMap = (m, x, y) => x >= 0 && y >= 0 && x < m.width && y < m.height;
  const getMap = (doc, map) => { const m = doc.get(mapPath(map)); if (!m) throw new Error(`editor: unknown map '${map}'`); return m; };

  /**
   * whereSelection(where) -> the editor selection a `where` record points at.
   * `where` is what KIT.project.collect and the validator hand out: { script }
   * or { map, object, page, slot } or { map } or { item } or { fragment }, or
   * { look, path } for something in the game's look (the Look panel opens the
   * section that path is in).
   * Three panels had their own copy of this and two had drifted: one dropped
   * slot 0 because it tested truthiness, one could not point at an item.
   */
  O.whereSelection = function (where) {
    const w = where || {};
    if (w.script) return { kind: 'script', path: ['scripts', w.script] };
    if (w.map && w.object && w.slot != null) return { kind: 'slot', map: w.map, id: w.object, page: w.page || 0, slot: w.slot };
    if (w.map && w.object) return { kind: 'object', map: w.map, id: w.object };
    if (w.map) return { kind: 'map', id: w.map };
    if (w.item) return { kind: 'item', id: w.item };
    if (w.fragment) return { kind: 'fragment', id: w.fragment };
    if (w.look) return { kind: 'look', path: Array.isArray(w.path) ? w.path.slice() : ['ui'] };
    return { kind: 'project' };
  };

  /** The tile an eraser leaves behind: nothing on deco/above, the map's base ground on ground. */
  O.eraseValue = function (m, layer) {
    if (layer === 'ground') return P.GROUND_BY_KIND[m.kind] || 'grass';
    if (layer === 'terrain' || layer === 'regions') return 0;
    return null;                      // deco, above and collision clear to nothing
  };

  /** paint(doc, { map, layer, cells:[{x,y}], tile, label }) — one undo step for the whole stroke. */
  O.paint = function (doc, o) {
    const m = getMap(doc, o.map);
    const layer = o.layer || 'ground';
    const path = layerPath(o.map, layer);
    const value = o.tile === undefined ? O.eraseValue(m, layer) : o.tile;
    const ops = [];
    const seen = new Set();
    for (const c of o.cells || []) {
      if (!inMap(m, c.x, c.y)) continue;
      const i = idx(m, c.x, c.y);
      if (seen.has(i)) continue;
      seen.add(i);
      if (layerArray(m, layer)[i] === value) continue;
      ops.push({ op: 'set', path: path.concat(i), value });
    }
    if (!ops.length) return 0;
    doc.apply(ops, { label: o.label || `Paint ${layer}` });
    return ops.length;
  };

  /** rect(doc, { map, layer, x0, y0, x1, y1, tile, outline }) */
  O.rect = function (doc, o) {
    const x0 = Math.min(o.x0, o.x1), x1 = Math.max(o.x0, o.x1);
    const y0 = Math.min(o.y0, o.y1), y1 = Math.max(o.y0, o.y1);
    const cells = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (o.outline && x !== x0 && x !== x1 && y !== y0 && y !== y1) continue;
      cells.push({ x, y });
    }
    return O.paint(doc, Object.assign({}, o, { cells, label: o.label || 'Rectangle' }));
  };

  /** fill(doc, { map, layer, x, y, tile }) — flood fill over cells matching the one you clicked (4-way). */
  O.fill = function (doc, o) {
    const m = getMap(doc, o.map);
    const layer = o.layer || 'ground';
    if (!inMap(m, o.x, o.y)) return 0;
    const from = layerArray(m, layer)[idx(m, o.x, o.y)];
    const to = o.tile === undefined ? O.eraseValue(m, layer) : o.tile;
    if (from === to) return 0;
    const cells = [], seen = new Set();
    const stack = [[o.x, o.y]];
    const limit = m.width * m.height;
    while (stack.length && cells.length <= limit) {
      const [x, y] = stack.pop();
      if (!inMap(m, x, y)) continue;
      const i = idx(m, x, y);
      if (seen.has(i) || layerArray(m, layer)[i] !== from) continue;
      seen.add(i);
      cells.push({ x, y });
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return O.paint(doc, { map: o.map, layer, cells, tile: to, label: o.label || 'Fill' });
  };

  /** stamp(doc, { map, stamp:'house-red', x, y, layer }) — a multi-tile brush from the tiles registry. */
  O.stamp = function (doc, o) {
    const stamps = KIT.registry('tiles').stamps || [];
    const st = typeof o.stamp === 'string' ? stamps.find(s => s.id === o.stamp) : o.stamp;
    if (!st) throw new Error(`editor: unknown stamp '${o.stamp}'`);
    const m = getMap(doc, o.map);
    const layer = o.layer || 'deco';
    const path = layerPath(o.map, layer);
    const ops = [];
    st.tiles.forEach((row, dy) => row.forEach((tile, dx) => {
      if (!tile) return;
      const x = o.x + dx, y = o.y + dy;
      if (!inMap(m, x, y)) return;
      const i = idx(m, x, y);
      if (layerArray(m, layer)[i] === tile) return;
      ops.push({ op: 'set', path: path.concat(i), value: tile });
    }));
    if (!ops.length) return 0;
    doc.apply(ops, { label: `Stamp ${st.name || st.id}` });
    return ops.length;
  };

  /**
   * terrain(doc, { map, cells, terrain, seed }) — paints the terrain layer and re-bakes the
   * autotiled ground/deco around the stroke, so edges and corners fix themselves.
   */
  O.terrain = function (doc, o) {
    const m = getMap(doc, o.map);
    const project = doc.value;
    const cells = (o.cells || []).filter(c => inMap(m, c.x, c.y));
    if (!cells.length) return 0;
    return doc.transaction(o.label || 'Terrain brush', () => {
      const tPath = layerPath(o.map, 'terrain');
      const ops = [];
      for (const c of cells) { const i = idx(m, c.x, c.y); if (m.layers.terrain[i] !== o.terrain) ops.push({ op: 'set', path: tPath.concat(i), value: o.terrain }); }
      if (ops.length) doc.apply(ops, { label: 'Terrain' });
      if (!KIT.tiles || !KIT.tiles.bake) return ops.length;
      const after = doc.get(mapPath(o.map));
      let changed = 0;
      for (const c of cells) {
        const baked = KIT.tiles.bake(after, project, { around: c, seed: o.seed == null ? 1 : o.seed });
        if (!baked) continue;
        for (const layer of ['ground', 'deco']) {
          if (!baked[layer]) continue;
          const path = layerPath(o.map, layer);
          const next = [];
          for (const i of baked.changed || []) if (after.layers[layer][i] !== baked[layer][i]) next.push({ op: 'set', path: path.concat(i), value: baked[layer][i] });
          if (next.length) { doc.apply(next, { label: 'Autotile' }); changed += next.length; }
        }
      }
      return ops.length + changed;
    });
  };

  // ---- objects -----------------------------------------------------------------
  /** placeObject(doc, { map, type, x, y, name, preset }) -> the new object's id. */
  O.placeObject = function (doc, o) {
    const m = getMap(doc, o.map);
    let objects;
    if (o.preset) {
      const built = P.buildPreset(o.preset, { project: doc.value, map: m, x: o.x, y: o.y });
      objects = Array.isArray(built) ? built : [built];
    } else {
      objects = [P.fillObject({ id: o.id, name: o.name, type: o.type || 'npc', x: o.x, y: o.y })];
    }
    const ids = [];
    doc.transaction(`Add ${o.preset || o.type || 'object'}`, () => {
      for (const obj of objects) {
        obj.id = P.uniqueObjectId(doc.get(mapPath(o.map)), obj.id || KIT.slug(obj.name || obj.type || 'object'));
        if (obj.x == null) obj.x = o.x; if (obj.y == null) obj.y = o.y;
        doc.push(mapPath(o.map).concat('objects'), obj);
        ids.push(obj.id);
      }
    });
    return ids.length === 1 ? ids[0] : ids;
  };
  const objectIndex = (doc, map, id) => (doc.get(mapPath(map).concat('objects')) || []).findIndex(o => o.id === id);
  O.objectPath = function (doc, map, id) {
    const i = objectIndex(doc, map, id);
    if (i < 0) throw new Error(`editor: no object '${id}' on '${map}'`);
    return mapPath(map).concat('objects', i);
  };
  O.moveObject = function (doc, o) {
    const path = O.objectPath(doc, o.map, o.id);
    doc.transaction('Move object', () => { doc.set(path.concat('x'), o.x); doc.set(path.concat('y'), o.y); });
  };
  O.deleteObject = function (doc, o) {
    const i = objectIndex(doc, o.map, o.id);
    if (i < 0) return false;
    doc.splice(mapPath(o.map).concat('objects'), i, 1, [], { label: 'Delete object' });
    return true;
  };
  O.duplicateObject = function (doc, o) {
    const src = doc.get(O.objectPath(doc, o.map, o.id));
    const copy = KIT.deepClone(src);
    copy.id = P.uniqueObjectId(doc.get(mapPath(o.map)), src.id);
    copy.x = o.x == null ? src.x + 1 : o.x; copy.y = o.y == null ? src.y : o.y;
    doc.push(mapPath(o.map).concat('objects'), copy, { label: 'Duplicate object' });
    return copy.id;
  };
  /** setField(doc, path, value, label) — the inspector's single door for every edit. */
  O.setField = function (doc, path, value, label) { doc.set(path, value, { label: label || 'Edit' }); };

  // ---- pages --------------------------------------------------------------------
  O.addPage = function (doc, o) {
    const path = O.objectPath(doc, o.map, o.id);
    const obj = doc.get(path);
    const page = P.fillPage(o.copyFrom != null ? KIT.deepClone(obj.pages[o.copyFrom]) : {}, obj.type);
    if (o.copyFrom == null) page.when = { kind: 'var', name: 'chapter', op: '>=', value: 1 };   // a sensible starting condition
    doc.push(path.concat('pages'), page, { label: 'Add page' });
    return obj.pages.length;
  };
  O.deletePage = function (doc, o) {
    const path = O.objectPath(doc, o.map, o.id);
    const pages = doc.get(path.concat('pages'));
    if (!pages || pages.length <= 1) return false;
    doc.splice(path.concat('pages'), o.page, 1, [], { label: 'Delete page' });
    return true;
  };
  O.movePage = function (doc, o) {
    const path = O.objectPath(doc, o.map, o.id).concat('pages');
    const pages = doc.get(path);
    const to = KIT.clamp(o.to, 0, pages.length - 1);
    if (o.page === to) return false;
    doc.transaction('Reorder pages', () => {
      const page = KIT.deepClone(pages[o.page]);
      doc.splice(path, o.page, 1, []);
      doc.splice(path, to, 0, [page]);
    });
    return true;
  };

  // ---- maps ----------------------------------------------------------------------
  O.newMap = function (doc, o) {
    const m = P.newMap(o);
    doc.transaction('New map', () => {
      doc.set(mapPath(m.id), m);
      doc.set(['world', 'maps', m.id], { x: o.wx || 0, y: o.wy || 0, folder: o.folder || '' });
    });
    return m.id;
  };
  O.deleteMap = function (doc, o) {
    if (!doc.get(mapPath(o.map))) return false;
    doc.transaction('Delete map', () => { doc.del(mapPath(o.map)); doc.del(['world', 'maps', o.map]); });
    return true;
  };
  O.resizeMap = function (doc, o) {
    const m = doc.get(mapPath(o.map));
    const resized = P.resize(KIT.deepClone(m), o.width, o.height);
    doc.set(mapPath(o.map), resized, { label: 'Resize map' });
    return resized;
  };
  O.renameMap = function (doc, o) { doc.set(mapPath(o.map).concat('name'), o.name, { label: 'Rename map' }); };

  // ---- scripts, vars, items, fragments ---------------------------------------------
  O.setScript = function (doc, o) {
    // o.path is the document path of the command list (a page slot or a common event body)
    doc.set(o.path, o.commands, { label: o.label || 'Edit script' });
  };
  O.newCommonEvent = function (doc, o) {
    const id = o.id || KIT.slug(o.label || 'new-script');
    const scripts = doc.get(['scripts']) || {};
    const unique = uniqueKey(scripts, id);
    doc.set(['scripts', unique], { label: o.label || 'New script', trigger: o.trigger || 'call', when: null, params: o.params || [], body: o.body || [], note: '' }, { label: 'New common event' });
    return unique;
  };
  O.declareVar = function (doc, o) {
    doc.set(['vars', o.name], P.fillVar({ type: o.type || 'number', default: o.default, label: o.label, group: o.group }, o.name), { label: `Declare ${o.name}` });
  };
  /**
   * A new rule of the world. Rules live in the project beside the variables and
   * the items — they are content, not code — so making one is one document set
   * and one undo step, like everything else.
   */
  /** The first free key: id, id-2, id-3 … so ＋ New twice makes two things, not one twice. */
  const uniqueKey = (table, id) => { let u = id, n = 2; while (table && table[u]) u = `${id}-${n++}`; return u; };
  O.uniqueKey = uniqueKey;
  O.newRule = function (doc, o) {
    const id = uniqueKey(doc.get(['rules']), o.id || KIT.slug(o.name || 'rule'));
    doc.set(['rules', id], P.fillRule({ name: o.name || '', when: o.when || 'step', do: o.do || [] }, id), { label: 'New rule' });
    return id;
  };
  O.deleteRule = function (doc, o) { doc.del(['rules', o.id], { label: 'Delete rule' }); };
  O.newItem = function (doc, o) {
    const id = uniqueKey(doc.get(['items']), o.id || KIT.slug(o.name || 'item'));
    doc.set(['items', id], P.fillItem({ kind: o.kind, name: o.name, icon: o.icon, desc: o.desc }, id), { label: 'New item' });
    return id;
  };
  O.addFragment = function (doc, o) {
    const f = { id: o.id || KIT.uid('frag'), kind: o.kind || 'note', title: o.title || 'Note', body: o.body || '', tags: o.tags || [], folder: o.folder || '' };
    doc.push(['fragments'], f, { label: 'New fragment' });
    return f.id;
  };
  /** Turn a fragment into a script (Twine's "write it later" flow). */
  O.fragmentToScript = function (doc, o) {
    const frags = doc.get(['fragments']) || [];
    const i = frags.findIndex(f => f.id === o.fragment);
    if (i < 0) return null;
    const parsed = KIT.screenplay.parse(frags[i].body || '');
    const id = O.newCommonEvent(doc, { id: KIT.slug(frags[i].title || frags[i].id), label: frags[i].title, body: parsed.commands });
    if (o.remove) doc.splice(['fragments'], i, 1, [], { label: 'Fragment used' });
    return { script: id, problems: parsed.problems };
  };

  /** problems(project) -> the validator output, for the Problems panel. */
  O.problems = function (project) { return P.validate(project); };

  // ---- the look -------------------------------------------------------------------
  /**
   * KIT.editor.ops.look — every write to `project.ui`. Paths are inside `ui`:
   * ['tokens', 'paper'], ['dialogue', 'lines'], ['voice'].
   *
   * `project.ui` holds only what the game changes on top of the look it
   * starts from, and these keep it that way. A value equal to the one
   * underneath is not a change, so it is not stored. A parent the write
   * needs is made by a write of its own, so undo takes it away again: the
   * document records a set on a missing key as "delete it" on the way back,
   * but a parent it made in passing has no record at all, and one undo after
   * the first change left an empty `ui: { dialogue: {} }` behind in a project
   * that had never had a look. And a part left empty is taken away, up to
   * `ui` itself.
   */
  const LOOK = O.look = O.look || {};
  const uiPath = (path) => ['ui'].concat(path);

  /**
   * set(doc, path, value) -> whether anything changed. A value equal to the
   * inherited one resets instead. What is compared and stored is the value as
   * the game will use it (KIT.look.cleanAt): a prefix typed eight letters long
   * is the four the game shows, '#FFFFFF' is the '#ffffff' underneath and so
   * no change, and a value the look cannot hold at all is not written.
   */
  LOOK.set = function (doc, path, value) {
    if (value === undefined) return LOOK.reset(doc, path);
    const c = KIT.look.cleanAt(path, value);
    if (!c.ok) return false;
    if (KIT.deepEqual(c.value, KIT.look.inherited(doc.value, path))) return LOOK.reset(doc, path);
    const full = uiPath(path);
    if (KIT.deepEqual(doc.get(full), c.value)) return false;
    for (let i = 1; i < full.length; i++) {
      const at = full.slice(0, i);
      if (!KIT.isObject(doc.get(at))) doc.set(at, {}, { label: 'Look' });
    }
    doc.set(full, KIT.deepClone(c.value), { label: 'Look' });
    return true;
  };

  /** reset(doc, path) -> whether anything changed. Back to the look underneath; empty parents go too. */
  LOOK.reset = function (doc, path) {
    const full = uiPath(path);
    let changed = false;
    if (doc.has(full)) { doc.del(full, { label: 'Look' }); changed = true; }
    for (let i = full.length - 1; i >= 1; i--) {
      const at = full.slice(0, i);
      const v = doc.get(at);
      if (!KIT.isObject(v) || Object.keys(v).length) break;
      doc.del(at, { label: 'Look' });
      changed = true;
    }
    return changed;
  };

  /** Every override the game's look holds, as paths inside `ui`: a token, a part's option, the voice. */
  function overrides(ui) {
    const out = [];
    if (!KIT.isObject(ui)) return out;
    for (const k of Object.keys(ui)) {
      if (k === 'base' || k === 'screens') continue;
      if (KIT.isObject(ui[k])) for (const key of Object.keys(ui[k])) out.push([k, key]);
      else out.push([k]);
    }
    return out;
  }
  LOOK.overrides = (project) => overrides(project && project.ui);

  /**
   * useBase(doc, id, { clean }) — start from another look. `kit` is no base at
   * all. The game's own changes stay on top unless `clean`, and any that now
   * equal what the new look says are dropped: they are no longer changes. A
   * change the author made against the old look that the new one happens to
   * share is not lost — it is exactly what they see.
   */
  LOOK.useBase = function (doc, id, opts) {
    const base = id && id !== 'kit' ? id : null;
    if (opts && opts.clean) for (const path of overrides(doc.get(['ui']))) LOOK.reset(doc, path);
    if (base) {
      if (!KIT.isObject(doc.get(['ui']))) doc.set(['ui'], {}, { label: 'Look' });
      if (doc.get(['ui', 'base']) !== base) doc.set(['ui', 'base'], base, { label: 'Look' });
    } else LOOK.reset(doc, ['base']);
    for (const path of overrides(doc.get(['ui']))) {
      if (KIT.deepEqual(doc.get(uiPath(path)), KIT.look.inherited(doc.value, path))) LOOK.reset(doc, path);
    }
  };

  // ---- the game's own fonts (project.fonts) ----------------------------------------
  // A font is a file brought into the game (KIT.import.image.fontsFrom), kept
  // as a data: URI so the game works offline; the look names it by its id.
  // The table is made by a write of its own, like a look's parents, so undoing
  // the first font leaves no empty `fonts: {}` behind.

  /**
   * addFont(doc, { id, name, src, pixel, px }) -> the id it is kept under.
   * The same file twice is the one font, not two; a different file wanting a
   * name already used gets the next free one (one-glyph-2), and the name is
   * cut first so that one is still an id a look can name (64 letters at most).
   */
  LOOK.addFont = function (doc, font) {
    const have = doc.get(['fonts']);
    if (KIT.isObject(have)) {
      const same = Object.keys(have).find(id => KIT.isObject(have[id]) && have[id].src === font.src);
      if (same) return same;
    } else doc.set(['fonts'], {}, { label: 'Look' });
    const id = O.uniqueKey(doc.get(['fonts']), String(font.id || 'font').slice(0, 60).replace(/[-._:]+$/, '') || 'font');
    const value = { name: font.name || id, src: font.src, pixel: !!font.pixel };
    if (typeof font.px === 'number') value.px = font.px;
    doc.set(['fonts', id], value, { label: 'Look' });
    return id;
  };

  /**
   * editFont(doc, id, patch) — change what is said about one of the game's
   * fonts (`{ pixel: true, px: 8 }`), or with `null`, take it out of the game.
   * A font taken out takes its uses in the look with it: the letters it drew
   * go back to the look's own, rather than naming a font that is not there.
   */
  LOOK.editFont = function (doc, id, patch) {
    if (!KIT.isObject(doc.get(['fonts', id]))) return;
    if (patch !== null) {
      for (const k of Object.keys(patch)) {
        if (patch[k] === undefined) { if (doc.has(['fonts', id, k])) doc.del(['fonts', id, k], { label: 'Look' }); }
        else if (!KIT.deepEqual(doc.get(['fonts', id, k]), patch[k])) doc.set(['fonts', id, k], patch[k], { label: 'Look' });
      }
      return;
    }
    for (const f of KIT.look.TOKENS) if (f.type === 'font' && doc.get(uiPath(['tokens', f.key])) === id) LOOK.reset(doc, ['tokens', f.key]);
    doc.del(['fonts', id], { label: 'Look' });
    if (!Object.keys(doc.get(['fonts']) || {}).length) doc.del(['fonts'], { label: 'Look' });
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
