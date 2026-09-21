// Creator Mode — the Events panel: every object on the map as a list, and the
// inspector for the selected one (identity, Event Pages, appearance, behaviour,
// flags and the script slots).
//
// RPG Maker vocabulary throughout: Event, Event Page, Priority, Through,
// Direction Fix, Stepping Animation, Move Route, Trigger.
//
// Nothing here writes to the project except through KIT.editor.ops or
// KIT.editor.commit, so every field is one undo step.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const ED = KIT.editor = KIT.editor || {};
  const S = KIT.schema;
  const P = KIT.project;
  const INS = ED.inspector = ED.inspector || {};
  const OBJ = ED.objects = ED.objects || {};

  const titleCase = (id) => String(id || '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const SLOTS = [
    { id: 'interact', label: 'On Interact', doc: 'The player presses A while facing it.' },
    { id: 'step', label: 'On Step', doc: 'The player steps onto this tile.' },
    { id: 'touch', label: 'On Touch', doc: 'The player walks into it (or it walks into the player).' },
    { id: 'enter', label: 'On Enter', doc: 'The map is entered.' },
    { id: 'tick', label: 'Every Tick', doc: 'Runs in the background, over and over.' },
    { id: 'init', label: 'On Init', doc: 'Once, when the map is built.' },
  ];

  // =================================================================================
  // Pure parts (no DOM) — test/kit/editor-inspector.test.js drives these.
  // =================================================================================

  /**
   * references(project, id) -> [{ path, form }] every place that points at an object id:
   * `ref:object` fields (page props, conditions) and command/condition targets ('obj:<id>').
   */
  OBJ.references = function (project, id) {
    const out = [];
    const seen = new Set();
    const push = (path) => {
      const key = path.join('/');
      if (seen.has(key)) return;
      seen.add(key);
      // 'obj:<id>' (a command or condition target) or the bare id (a ref:object field)
      const cur = KIT.path.get(project, path);
      out.push({ path: path.slice(), form: (typeof cur === 'string' && cur.slice(0, 4) === 'obj:') ? 'target' : 'id' });
    };
    let refs = [];
    try { refs = (P.collect(project) || {}).refs || []; } catch (e) { refs = []; }
    // collect() moves the document path onto `where`; be happy with either shape.
    for (const r of refs) {
      if (r.kind !== 'object' || r.id !== id) continue;
      const p = (r.where && r.where.path) || r.path;
      if (p) push(p);
    }
    const commands = KIT.registry.exists('commands') ? KIT.registry('commands') : null;
    if (commands) {
      P.walkCommands(project, (cmd, where) => {
        const def = commands.get(cmd && cmd.t);
        if (!def || !Array.isArray(def.fields)) return;
        for (const f of S.fields(def.fields)) {
          if (!f.target) continue;
          if (cmd[f.key] === `obj:${id}`) push(where.path.concat(f.key));
        }
      });
    }
    return out;
  };

  /**
   * rename(doc, { map, id, to }) -> { ok, id, rewritten, reason }
   * Renames an object and rewrites every reference that pointed at it, in one undo step.
   */
  OBJ.rename = function (doc, o) {
    const project = doc.value;
    const raw = String(o.to == null ? '' : o.to).trim();
    if (!/[a-z0-9]/i.test(raw)) return { ok: false, reason: 'An id needs at least one letter or number.' };
    const to = KIT.slug(raw);
    const map = project.maps && project.maps[o.map];
    if (!map) return { ok: false, reason: `No map “${o.map}”.` };
    const i = (map.objects || []).findIndex(x => x.id === o.id);
    if (i < 0) return { ok: false, reason: `No event “${o.id}” on this map.` };
    if (to === o.id) return { ok: true, id: to, rewritten: 0 };
    if ((map.objects || []).some(x => x.id === to)) return { ok: false, reason: `“${to}” is already taken on this map.` };
    const refs = OBJ.references(project, o.id);
    doc.transaction('Rename event', () => {
      doc.set(['maps', o.map, 'objects', i, 'id'], to);
      for (const r of refs) doc.set(r.path, r.form === 'target' ? `obj:${to}` : to);
    });
    return { ok: true, id: to, rewritten: refs.length };
  };

  /**
   * retype(doc, { map, id, type }) -> true — change an event's type and let the new
   * type's page defaults through.
   *
   * fillPage keeps whatever a page already says, which is right for a page the
   * author wrote and wrong for one that merely inherited the old type's defaults:
   * an NPC turned into a Door / Warp kept `layer: 'same', through: false` and so
   * stayed solid — a door the hero could never step on, and no problem said so.
   * A value that still equals the OLD type's default is inherited, not chosen, so
   * it is dropped and the new type (or the schema) decides.
   */
  OBJ.retype = function (doc, o) {
    const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj || {}, k);
    const path = ['maps', o.map, 'objects', (doc.get(['maps', o.map, 'objects']) || []).findIndex(x => x.id === o.id)];
    if (path[3] < 0) return false;
    const typeOf = (t) => (KIT.registry.exists('objectTypes') && KIT.registry('objectTypes').get(t)) || null;
    const from = ((typeOf(doc.get(path.concat('type'))) || {}).page) || {};
    const to = ((typeOf(o.type) || {}).page) || {};
    const keys = Object.keys(from).concat(Object.keys(to)).filter((k, i, a) => a.indexOf(k) === i);
    const schemaDefault = (k) => { const f = S.fields(P.fields.page).find(f => f.key === k); return f ? S.defaultFor(f) : undefined; };
    doc.transaction('Change event type', () => {
      doc.set(path.concat('type'), o.type);
      doc.set(path.concat('pages'), (doc.get(path.concat('pages')) || []).map(pg => {
        const next = Object.assign({}, pg);
        for (const k of keys) {
          const was = has(from, k) ? from[k] : schemaDefault(k);
          if (KIT.deepEqual(next[k], was)) delete next[k];
        }
        return P.fillPage(next, o.type);
      }));
    });
    return true;
  };

  /**
   * placePreset(doc, { preset, map, x, y, input }) -> [ids]
   * ops.placeObject only handles one map; a preset may build objects on two (a
   * transfer pair), so this walks KIT.project.buildPreset's [{ map, object }] itself.
   */
  OBJ.placePreset = function (doc, o) {
    const built = P.buildPreset(o.preset, { project: doc.value, map: o.map, x: o.x, y: o.y, input: o.input || {} });
    const ids = [];
    doc.transaction(`Add ${(typeof o.preset === 'string' ? o.preset : o.preset.id) || 'preset'}`, () => {
      for (const entry of built) {
        const mapId = entry.map || o.map;
        const obj = entry.object || entry;
        if (!doc.get(['maps', mapId])) continue;
        obj.id = P.uniqueObjectId(doc.get(['maps', mapId]), obj.id || KIT.slug(obj.name || obj.type || 'event'));
        doc.push(['maps', mapId, 'objects'], obj);
        ids.push({ map: mapId, id: obj.id });
      }
    });
    return ids;
  };

  /** pageOrder(project, map, obj) -> [{ index, text, active }] — last matching page wins. */
  OBJ.pageOrder = function (project, mapView, obj) {
    const ctx = { world: { save: { vars: {}, objects: {} } }, project };
    let activeIndex = -1;
    try {
      const a = mapView && mapView.activePage ? mapView.activePage(obj, ctx) : null;
      activeIndex = a ? a.index : -1;
    } catch (e) { activeIndex = -1; }
    return (obj.pages || []).map((pg, i) => ({
      index: i,
      text: KIT.conditions.toText(pg.when == null ? null : pg.when),
      says: KIT.conditions.describe(pg.when == null ? null : pg.when, ctx),
      active: i === activeIndex,
    }));
  };

  // =================================================================================
  // The panel
  // =================================================================================
  const make = (spec, opts) => KIT.ui.make(spec, opts);
  const clear = (el) => KIT.ui.clear(el);
  const btn = (label, title, fn, cls) => INS.btn(label, title, fn, cls);

  let el = {};            // the panel's DOM
  let search = '';
  let pageIndex = 0;
  let seenSel = null;     // the selection pageIndex was last read from (a page tab sets one; the page actions must not be undone by it)
  let listSig = '';
  let detailSig = '';
  let forms = [];
  let addOpen = false;
  let presetDraft = null;
  let presetForm = null;   // kept out of `forms`, which the detail view destroys on every rebuild
  let openSections = { event: true, 'when-page': true, look: true, move: true, flags: false, props: true, scripts: true };

  function project() { return ED.state.project; }
  function mapId() { return ED.state.mapId; }
  function objects() { const m = project().maps[mapId()]; return (m && m.objects) || []; }
  function selectedId() {
    const s = ED.state.selection;
    if (!s || (s.kind !== 'object' && s.kind !== 'page' && s.kind !== 'slot')) return null;
    if (s.map && s.map !== mapId()) return null;
    return s.id;
  }
  function selectedObject() { const id = selectedId(); return id ? objects().find(o => o.id === id) || null : null; }
  function objectPath(id) { const i = objects().findIndex(o => o.id === id); return i < 0 ? null : ['maps', mapId(), 'objects', i]; }
  function typeDef(type) { return KIT.registry('objectTypes').get(type) || null; }
  function problemsFor(id, page) {
    const list = ED.problemsFor({ kind: 'object', map: mapId(), id, page }) || [];
    return list;
  }
  function commit(label, fn) { const r = ED.commit(label, fn); INS.afterEdit(); return r; }
  function setAt(path, value, label) { commit(label || 'Edit', (doc, O) => O.setField(doc, path, value, label)); }

  KIT.registry('editorPanels').add({
    id: 'objects', label: 'Events', icon: 'npc', order: 20,
    tool: 'select', tools: ['select', 'hand'],     // a tap on the map picks an Event here, it never paints
    mount(host) {
      clear(host);
      el = {};
      el.root = make('div.ed-objects');
      // --- list view
      el.listView = make('div.ed-obj-listview');
      const head = make('div.ed-row.ed-obj-head');
      el.search = make('input.ed-obj-search');
      el.search.type = 'search';
      el.search.placeholder = 'Find an event…';
      el.search.oninput = () => { search = el.search.value.toLowerCase(); listSig = ''; render(); };
      head.appendChild(el.search);
      el.addBtn = btn('＋ Add', 'Add an event to this map', () => { addOpen = !addOpen; renderAdd(); }, 'primary');
      head.appendChild(el.addBtn);
      el.listView.appendChild(head);
      el.add = make('div.ed-add');
      el.listView.appendChild(el.add);
      el.presetForm = make('div.ed-preset-form');
      el.presetForm.hidden = true;
      el.listView.appendChild(el.presetForm);
      el.list = make('div.ed-list.ed-obj-list');
      el.listView.appendChild(el.list);
      el.count = make('div.ed-hint');
      el.listView.appendChild(el.count);
      el.root.appendChild(el.listView);
      // --- detail view
      el.detail = make('div.ed-obj-detail');
      el.root.appendChild(el.detail);
      host.appendChild(el.root);
      renderAdd();
      render();
    },
    refresh() { if (el.root) render(); },
    onSelect(sel) {
      if (sel && (sel.kind === 'page' || sel.kind === 'slot') && sel.page != null) pageIndex = sel.page;
      detailSig = '';
      if (el.root) render();
    },
  });

  // ---- the Add row -----------------------------------------------------------------
  function renderAdd() {
    clear(el.add);
    el.add.hidden = !addOpen;
    if (!addOpen) {
      presetDraft = null;
      renderPresetForm();
      // Closing the row is the way out of “tap the map to place it” — a phone has no
      // Escape — and a pick left running would answer a later tap with a dead form.
      if (INS.isPicking && INS.isPicking()) INS.stopPicking(false);
      return;
    }
    renderPresetForm();
    el.add.appendChild(make('div.ed-hint', { text: 'Pick one, then tap the map where it goes.' }));
    const presets = KIT.registry('presets').list().filter(p => (p.kind || 'object') === 'object');
    const chips = make('div.ed-chips');
    for (const p of presets) {
      const c = make('button.ed-chip.is-preset', { text: `＋ ${p.name || titleCase(p.id)}` });
      c.type = 'button';
      c.title = p.doc || '';
      c.onclick = () => startPlace({ preset: p });
      chips.appendChild(c);
    }
    el.add.appendChild(chips);
    el.add.appendChild(make('div.ed-sub', { text: 'or a plain event of one type:' }));
    const raw = make('div.ed-chips');
    for (const t of KIT.registry('objectTypes').list()) {
      const c = make('button.ed-chip', { text: t.name || titleCase(t.id) });
      c.type = 'button';
      c.title = t.doc || '';
      c.onclick = () => startPlace({ type: t.id });
      raw.appendChild(c);
    }
    el.add.appendChild(raw);
  }

  /** A preset that asks for something (a sign's line, a door's target) fills in a small form first. */
  function renderPresetForm() {
    if (!el.presetForm) return;
    if (presetForm) { try { presetForm.destroy(); } catch (e) { /* ignore */ } presetForm = null; }
    clear(el.presetForm);
    el.presetForm.hidden = !presetDraft;
    if (!presetDraft) return;
    const preset = presetDraft.preset;
    el.presetForm.appendChild(make('div.ed-f-label', { text: `New ${preset.name || titleCase(preset.id)}` }));
    if (preset.doc) el.presetForm.appendChild(make('div.ed-hint', { text: preset.doc }));
    const body = make('div');
    el.presetForm.appendChild(body);
    presetForm = INS.mount(body, {
      fields: preset.fields || [],
      value: presetDraft.input,
      ctx: { project: project(), map: project().maps[mapId()], mapId: mapId() },
      onChange(path, v) { presetDraft.input[path[0]] = v; },
    });
    const row = make('div.ed-row');
    row.appendChild(btn('✛ Place it on the map', 'Then tap where it goes', () => place(preset, presetDraft.input), 'primary'));
    row.appendChild(btn('Cancel', 'Forget it', () => { presetDraft = null; renderPresetForm(); }));
    el.presetForm.appendChild(row);
    // The form opens under the chips; on a short panel that is off screen, so go to it.
    setTimeout(() => { if (el.presetForm.scrollIntoView) el.presetForm.scrollIntoView({ block: 'nearest' }); }, 0);
  }

  function startPlace(what) {
    if (what.preset && (what.preset.fields || []).length) {
      presetDraft = { preset: what.preset, input: INS.buildValue(what.preset.fields, {}, { project: project() }) };
      renderPresetForm();
      return;
    }
    place(what.preset, null, what.type);
  }

  /** place(preset, input) or place(null, null, type) — then the next tap on the map says where. */
  function place(preset, input, type) {
    const name = preset ? (preset.name || preset.id) : (typeDef(type) ? typeDef(type).name : type);
    INS.pickOnMap({
      hint: `Tap the map to place ${name}`,
      onPick(pt) {
        let placed = null;
        if (preset) {
          const made = commit(`Add ${name}`, (doc) => OBJ.placePreset(doc, { preset, map: pt.map, x: pt.x, y: pt.y, input: input || {} }));
          placed = made && made.length ? made[0] : null;
        } else {
          const id = commit(`Add ${name}`, (doc, O) => O.placeObject(doc, { map: pt.map, type, x: pt.x, y: pt.y, name }));
          placed = { map: pt.map, id: Array.isArray(id) ? id[0] : id };
        }
        addOpen = false;
        presetDraft = null;
        renderAdd();
        if (placed) {
          if (placed.map !== ED.state.mapId) ED.openMap(placed.map);
          pageIndex = 0;
          detailSig = '';
          ED.select({ kind: 'object', map: placed.map, id: placed.id });
          ED.toast(`${name} placed — ${placed.id}`);
        }
      },
    });
  }

  // ---- render ----------------------------------------------------------------------
  function render() {
    if (!ED.state.project || !ED.state.project.maps[mapId()]) return;
    // the selection is read here on render — once per selection. Reading it on every render put the page back to the tab you
    // had tapped after every “Add a page” / “Later” / “Delete page”.
    const sel = ED.state.selection;
    if (sel !== seenSel) {
      seenSel = sel;
      if (sel && (sel.kind === 'page' || sel.kind === 'slot') && sel.page != null && sel.page !== pageIndex) { pageIndex = sel.page; detailSig = ''; }
    }
    renderList();
    renderDetail();
  }

  function matches(o) {
    if (!search) return true;
    return `${o.name || ''} ${o.id} ${o.type}`.toLowerCase().indexOf(search) >= 0;
  }

  function renderList() {
    const list = objects();
    const sel = selectedId();
    const shown = list.filter(matches);
    const sig = JSON.stringify([mapId(), search, sel, shown.map(o => [o.id, o.name, o.type, o.x, o.y, (o.pages || []).length, problemsFor(o.id).length])]);
    el.listView.hidden = !!sel;
    if (sig === listSig) return;
    listSig = sig;
    clear(el.list);
    for (const o of shown) {
      const item = make('div.ed-item.ed-obj-item');
      item.setAttribute('aria-selected', String(o.id === sel));
      item.tabIndex = 0;
      const art = make('span.ed-obj-art');
      const sprite = firstSprite(o), tile = sprite ? null : firstTile(o);
      if (sprite) art.appendChild(INS.spriteCanvas(sprite, 1));
      else if (tile) art.appendChild(INS.tileCanvas(tile, 1.5));
      else art.appendChild(make('span.ed-obj-glyph', { text: glyphFor(o.type) }));
      item.appendChild(art);
      const body = make('span.ed-obj-body');
      body.appendChild(make('span.ed-obj-name', { text: o.name || o.id }));
      const pages = (o.pages || []).length;
      body.appendChild(make('span.ed-sub', { text: `${typeName(o.type)} · ${o.x},${o.y}${pages > 1 ? ` · ${pages} pages` : ''}` }));
      item.appendChild(body);
      const problems = problemsFor(o.id);
      if (problems.length) {
        const dot = make('span.ed-dot' + (problems.some(p => p.severity === 'error') ? '.is-error' : '.is-warn'));
        dot.title = problems.map(p => p.message).join('\n');
        item.appendChild(dot);
      }
      const open = () => { pageIndex = 0; detailSig = ''; ED.select({ kind: 'object', map: mapId(), id: o.id }); showOnMap(o); };
      item.onclick = open;
      item.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
      el.list.appendChild(item);
    }
    if (!shown.length) {
      el.list.appendChild(list.length
        ? ED.emptyState({ icon: '🔍', text: 'Nothing matches that', hint: `No event on this map is called “${search}”.` })
        : ED.emptyState({
          icon: '🙂',
          text: 'No events on this map yet',
          hint: 'An Event is a person, a sign, a door — anything the player can bump into.',
          actions: [{ label: '＋ Add', primary: true, onTap: () => { addOpen = true; renderAdd(); } }],
        }));
    }
    el.count.textContent = `${list.length} event${list.length === 1 ? '' : 's'} on ${project().maps[mapId()].name || mapId()}`;
  }

  /** Pan the map so the chosen event is on screen (tapping a name should show you the thing). */
  function showOnMap(o) {
    const stage = ED.el && ED.el.canvas;
    if (!stage || !ED.tilePixels) return;
    const px = ED.tilePixels();
    const rect = stage.getBoundingClientRect();
    const vw = rect.width / px, vh = rect.height / px;
    const v = ED.state.view;
    if (o.x >= v.x + 1 && o.x <= v.x + vw - 2 && o.y >= v.y + 1 && o.y <= v.y + vh - 2) return;
    ED.set({ view: { x: o.x - vw / 2, y: o.y - vh / 2 } });
  }

  function firstSprite(o) { const p = (o.pages || [])[0]; return p && p.sprite ? p.sprite : null; }
  /** The tile an event draws instead of a sprite (a sign, a door, an item). */
  function firstTile(o) {
    const t = typeDef(o.type);
    const key = t && t.look && t.look.tile;
    if (!key) return null;
    const p = (o.pages || [])[0] || {};
    const id = (p.props || {})[key];
    return id && KIT.registry('tiles').has(id) ? id : null;
  }
  function typeName(type) { const t = typeDef(type); return t ? (t.name || titleCase(type)) : titleCase(type); }
  function glyphFor(type) { return ({ npc: '🙂', sign: '▮', item: '◆', warp: '🚪', trigger: '⚑' })[type] || '●'; }

  // ---- the inspector ----------------------------------------------------------------
  function renderDetail() {
    const obj = selectedObject();
    el.detail.hidden = !obj;
    if (!obj) { detailSig = ''; destroyForms(); clear(el.detail); return; }
    if (pageIndex >= (obj.pages || []).length) pageIndex = 0;
    const sig = JSON.stringify([mapId(), obj.id, obj.type, pageIndex, (obj.pages || []).length]);
    if (sig === detailSig) { refreshForms(); renderPageBar(obj); return; }
    // A different event: start at its header, not wherever the list had scrolled to
    // (placing from a preset scrolls the list to the preset form, which then cut the header off).
    const other = !detailSig || JSON.parse(detailSig)[1] !== obj.id;
    detailSig = sig;
    destroyForms();
    clear(el.detail);
    buildDetail(obj);
    if (other && ED.el && ED.el.panel) ED.el.panel.scrollTop = 0;
  }
  function destroyForms() { for (const f of forms) { try { f.destroy(); } catch (e) { /* ignore */ } } forms = []; }
  function refreshForms() {
    const obj = selectedObject();
    if (!obj) return;
    for (const f of forms) {
      try { f.refresh(f.read ? f.read(obj) : undefined); } catch (e) { /* ignore */ }
    }
    if (el.problems) renderProblems(obj);
    if (el.slots) renderSlots(obj);
  }

  function section(host, id, title, hint) {
    const sect = make('div.ed-sect');
    const head = make('button.ed-sect-head');
    head.type = 'button';
    const caret = make('span.ed-sect-caret', { text: openSections[id] ? '▾' : '▸' });
    head.appendChild(caret);
    head.appendChild(make('span', { text: title }));
    const body = make('div.ed-sect-body');
    body.hidden = !openSections[id];
    head.onclick = () => { openSections[id] = !openSections[id]; body.hidden = !openSections[id]; caret.textContent = openSections[id] ? '▾' : '▸'; };
    sect.appendChild(head);
    if (hint) body.appendChild(make('div.ed-hint', { text: hint }));
    sect.appendChild(body);
    host.appendChild(sect);
    return body;
  }

  function mountForm(host, opts) {
    if (opts.inherited) opts.ctx = Object.assign({}, opts.ctx || {}, { inherited: opts.inherited });
    const form = INS.mount(host, opts);
    form.read = opts.read;
    forms.push(form);
    return form;
  }

  function buildDetail(obj) {
    const host = el.detail;
    const path = objectPath(obj.id);
    const ctx = { project: project(), map: project().maps[mapId()], mapId: mapId() };

    // --- header: back, name, play here
    const bar = make('div.ed-row.ed-obj-bar');
    bar.appendChild(btn('‹ All events', 'Back to the list', () => { detailSig = ''; ED.select(null); }));
    bar.appendChild(make('span.ed-spacer'));
    bar.appendChild(btn('⧉', 'Duplicate this event', () => {
      const id = commit('Duplicate event', (doc, O) => O.duplicateObject(doc, { map: mapId(), id: obj.id }));
      detailSig = '';
      pageIndex = 0;
      ED.select({ kind: 'object', map: mapId(), id });
      ED.toast(`Copied — ${id}`);
    }));
    bar.appendChild(btn('🗑', 'Delete this event', () => {
      // A page tab leaves a `page` selection behind, and the shell's delete only
      // knows `object`: say which event this is before asking it.
      const s = ED.state.selection;
      if (!s || s.kind !== 'object' || s.id !== obj.id) ED.select({ kind: 'object', map: mapId(), id: obj.id });
      ED.deleteSelection();
    }, 'danger'));
    bar.appendChild(btn('▶ Play here', 'Play the game standing next to this event', () => ED.playHere({ at: { x: obj.x, y: Math.min(obj.y + 1, ED.state.map.height - 1) } })));
    host.appendChild(bar);

    const title = make('div.ed-obj-title');
    title.appendChild(make('span.ed-obj-glyph', { text: glyphFor(obj.type) }));
    title.appendChild(make('span', { text: obj.name || obj.id }));
    host.appendChild(title);

    el.problems = make('div.ed-obj-problems');
    host.appendChild(el.problems);
    renderProblems(obj);

    // --- identity
    const idBody = section(host, 'event', 'Event', null);
    mountForm(idBody, {
      fields: [
        Object.assign({}, findField(P.fields.object, 'name'), { label: 'Name', doc: 'What you call it. Shown on the map in Creator Mode.' }),
        { key: 'type', type: 'enum', label: 'Type', options: KIT.registry('objectTypes').list().map(t => ({ value: t.id, label: t.name || titleCase(t.id) })), doc: 'What kind of event this is. Changing it changes the settings below.' },
        { key: 'at', type: 'position', label: 'Position', doc: 'Where it stands on this map.' },
        Object.assign({}, findField(P.fields.object, 'note'), { label: 'Note', doc: 'Your own note. Never shown in the game.' }),
      ],
      value: { name: obj.name, type: obj.type, at: { x: obj.x, y: obj.y }, note: obj.note },
      ctx,
      read: (o) => ({ name: o.name, type: o.type, at: { x: o.x, y: o.y }, note: o.note }),
      onChange(p, v) {
        const cur = selectedObject();
        if (!cur) return;
        const base = objectPath(cur.id);
        if (p[0] === 'at') {
          commit('Move event', (doc, O) => O.moveObject(doc, { map: mapId(), id: cur.id, x: v.x | 0, y: v.y | 0 }));
        } else if (p[0] === 'type') {
          commit('Change event type', (doc) => OBJ.retype(doc, { map: mapId(), id: cur.id, type: v }));
          detailSig = '';
          render();
        } else {
          setAt(base.concat(p), v, `Edit ${p[0]}`);
        }
      },
    });
    idBody.appendChild(renameRow(obj));

    // --- pages
    const pagesWrap = make('div.ed-pages');
    host.appendChild(pagesWrap);
    el.pages = pagesWrap;
    renderPageBar(obj);

    const page = (obj.pages || [])[pageIndex] || {};
    const pagePath = path.concat('pages', pageIndex);
    const pageCtx = Object.assign({}, ctx, { object: obj, page: pageIndex });

    // --- when
    const whenBody = section(host, 'when-page', 'This page runs when…', 'Leave it empty for “always”. The LAST page whose condition passes is the one that runs.');
    mountForm(whenBody, {
      fields: [{ key: 'when', type: 'condition', label: 'Condition', doc: 'Like an Event Page’s conditions in RPG Maker.' }],
      value: { when: page.when },
      ctx: pageCtx,
      read: (o) => ({ when: (o.pages[pageIndex] || {}).when }),
      onChange(p, v) { setAt(objectPath(obj.id).concat('pages', pageIndex, 'when'), v, 'Page condition'); },
    });

    // --- appearance
    const lookBody = section(host, 'look', 'How it looks');
    mountForm(lookBody, {
      fields: [
        { key: 'sprite', type: 'ref:sprite', label: 'Image (Sprite)', default: null, doc: 'The character sheet it walks with. Empty = invisible unless the type draws a tile.' },
        { key: 'dir', type: 'direction', label: 'Direction', default: 'down' },
        { key: 'layer', type: 'enum', label: 'Priority', default: 'same', options: [{ value: 'below', label: 'Below' }, { value: 'same', label: 'Same' }, { value: 'above', label: 'Above' }], doc: 'Below / same as / above the characters.' },
        { key: 'visible', type: 'bool', label: 'Visible', default: true },
        { key: 'through', type: 'bool', label: 'Through', default: false, doc: 'The hero can walk over it.' },
        { key: 'dirFix', type: 'bool', label: 'Direction Fix', default: false, doc: 'Never turns to face anyone.' },
        { key: 'stepAnim', type: 'bool', label: 'Stepping Animation', default: false, doc: 'Keeps animating while standing still.' },
      ],
      value: page,
      ctx: pageCtx,
      inherited: (typeDef(obj.type) || {}).page || {},
      read: (o) => o.pages[pageIndex] || {},
      onChange(p, v) { setAt(objectPath(obj.id).concat('pages', pageIndex, ...p), v, `Page ${p[0]}`); },
    });
    const preview = make('div.ed-obj-preview');
    preview.appendChild(INS.spriteCanvas(page.sprite, 3));
    preview.appendChild(make('span.ed-sub', { text: page.sprite ? INS.refLabel('sprite', page.sprite, ctx) : 'No sprite — invisible on the map' }));
    lookBody.insertBefore(preview, lookBody.firstChild);

    // --- behaviour
    const moveBody = section(host, 'move', 'What it does by itself');
    mountForm(moveBody, {
      fields: S.fields(P.fields.behaviour).map(f => {
        if (f.key === 'kind') return Object.assign({}, f, { label: 'Autonomous Movement', options: [{ value: 'none', label: 'Fixed' }, { value: 'look', label: 'Look at hero' }, { value: 'wander', label: 'Random' }, { value: 'route', label: 'Custom route' }, { value: 'approach', label: 'Approach' }] });
        if (f.key === 'route') return Object.assign({}, f, { label: 'Move Route' });
        if (f.key === 'radius') return Object.assign({}, f, { label: 'Wander radius' });
        if (f.key === 'repeat') return Object.assign({}, f, { label: 'Repeat the route', when: { field: 'kind', eq: 'route' } });
        if (f.key === 'frequency') return Object.assign({}, f, { label: 'Frequency', when: { field: 'kind', neq: 'none' } });
        if (f.key === 'speed') return Object.assign({}, f, { label: 'Speed', when: { field: 'kind', neq: 'none' } });
        return f;
      }),
      value: page.behaviour || {},
      ctx: Object.assign({}, pageCtx, { routeRepeat: (page.behaviour || {}).repeat }),
      read: (o) => (o.pages[pageIndex] || {}).behaviour || {},
      onChange(p, v) { setAt(objectPath(obj.id).concat('pages', pageIndex, 'behaviour', ...p), v, 'Movement'); },
    });

    // --- type settings
    const t = typeDef(obj.type);
    if (t && t.fields && t.fields.length) {
      const propsBody = section(host, 'props', `${t.name || titleCase(t.id)} settings`, t.doc || null);
      mountForm(propsBody, {
        fields: t.fields,
        value: page.props || {},
        ctx: pageCtx,
        read: (o) => (o.pages[pageIndex] || {}).props || {},
        onChange(p, v) { setAt(objectPath(obj.id).concat('pages', pageIndex, 'props', ...p), v, 'Settings'); },
      });
    }

    // --- flags
    const flagBody = section(host, 'flags', 'Rules');
    mountForm(flagBody, {
      fields: [
        { key: 'once', type: 'bool', label: 'Once only', default: false, doc: 'After it runs, this page never runs again (self.done).' },
        { key: 'needsBoth', type: 'bool', label: 'Needs both players', default: false, doc: 'In co-op, both players must be standing there.' },
      ],
      value: { once: !!page.once, needsBoth: !!page.needsBoth },
      ctx: pageCtx,
      inherited: (typeDef(obj.type) || {}).page || {},
      read: (o) => { const pg = o.pages[pageIndex] || {}; return { once: !!pg.once, needsBoth: !!pg.needsBoth }; },
      onChange(p, v) { setAt(objectPath(obj.id).concat('pages', pageIndex, p[0]), v, 'Rule'); },
    });

    // --- scripts
    const scriptBody = section(host, 'scripts', 'What happens', 'Each slot is a little script. Tap one to write it.');
    el.slots = make('div.ed-list.ed-slots');
    scriptBody.appendChild(el.slots);
    renderSlots(obj);
  }

  function findField(fields, key) { return S.fields(fields).find(f => f.key === key) || { key, type: 'string' }; }

  function renameRow(obj) {
    const wrap = make('div.ed-f.ed-rename');
    const head = make('div.ed-f-head');
    head.appendChild(make('span.ed-f-label', { text: 'Id' }));
    wrap.appendChild(head);
    const row = make('div.ed-row');
    const input = make('input');
    input.type = 'text';
    input.value = obj.id;
    input.spellcheck = false;
    const go = btn('Rename', 'Rename it and fix everything that points at it', () => {
      const cur = selectedObject();
      if (!cur) return;
      const res = commit('Rename event', (doc) => OBJ.rename(doc, { map: mapId(), id: cur.id, to: input.value }));
      if (!res.ok) { say.textContent = res.reason; say.hidden = false; input.value = cur.id; return; }
      say.hidden = true;
      detailSig = '';
      ED.select({ kind: 'object', map: mapId(), id: res.id });
      ED.toast(res.rewritten ? `Renamed — ${res.rewritten} reference${res.rewritten === 1 ? '' : 's'} updated` : 'Renamed');
    });
    row.appendChild(input);
    row.appendChild(go);
    wrap.appendChild(row);
    const say = make('div.ed-problem');
    say.hidden = true;
    wrap.appendChild(say);
    wrap.appendChild(make('div.ed-hint', { text: 'The name scripts use. Renaming fixes every Move Route, condition and reference that points here.' }));
    return wrap;
  }

  function renderProblems(obj) {
    clear(el.problems);
    for (const p of problemsFor(obj.id)) {
      el.problems.appendChild(make('div.ed-problem' + (p.severity === 'warn' ? '.warn' : ''), { text: p.message }));
    }
  }

  // ---- Event Pages -------------------------------------------------------------------
  function renderPageBar(obj) {
    const host = el.pages;
    if (!host) return;
    clear(host);
    const order = OBJ.pageOrder(project(), ED.state.map, obj);
    const head = make('div.ed-row.ed-pages-head');
    head.appendChild(make('span.ed-f-label', { text: 'Event Pages' }));
    head.appendChild(make('span.ed-spacer'));
    head.appendChild(btn('＋', 'Add a page', () => {
      commit('Add page', (doc, O) => O.addPage(doc, { map: mapId(), id: obj.id }));
      showPage(obj.id, (selectedObject().pages || []).length - 1);
    }));
    head.appendChild(btn('⧉', 'Duplicate this page', () => {
      commit('Duplicate page', (doc, O) => O.addPage(doc, { map: mapId(), id: obj.id, copyFrom: pageIndex }));
      showPage(obj.id, (selectedObject().pages || []).length - 1);
    }));
    head.appendChild(btn('▲', 'Earlier (checked sooner)', () => movePage(obj, -1)));
    head.appendChild(btn('▼', 'Later (wins over the ones above)', () => movePage(obj, 1)));
    const del = btn('✕', 'Delete this page', async () => {
      if ((obj.pages || []).length <= 1) { ED.toast('An event needs at least one page'); return; }
      if (!(await ED.confirm(`Delete page ${pageIndex + 1} of “${obj.name || obj.id}”?`))) return;
      commit('Delete page', (doc, O) => O.deletePage(doc, { map: mapId(), id: obj.id, page: pageIndex }));
      showPage(obj.id, Math.max(0, pageIndex - 1));
    }, 'danger');
    del.disabled = (obj.pages || []).length <= 1;
    head.appendChild(del);
    host.appendChild(head);

    const tabs = make('div.ed-page-tabs');
    order.forEach((p) => {
      const b = make('button.ed-page-tab', { text: String(p.index + 1) });
      b.type = 'button';
      b.setAttribute('aria-selected', String(p.index === pageIndex));
      b.title = p.says;
      if (p.active) b.classList.add('is-active-page');
      b.onclick = () => { pageIndex = p.index; detailSig = ''; ED.select({ kind: 'page', map: mapId(), id: obj.id, page: p.index }); };
      tabs.appendChild(b);
    });
    host.appendChild(tabs);

    const orderList = make('div.ed-list.ed-page-order');
    order.forEach((p) => {
      const row = make('div.ed-item.ed-page-row');
      row.setAttribute('aria-selected', String(p.index === pageIndex));
      row.appendChild(make('span.ed-badge', { text: `Page ${p.index + 1}` }));
      row.appendChild(make('span.ed-page-when', { text: p.text === 'always' ? 'always' : p.says }));
      if (p.active) row.appendChild(make('span.ed-badge.is-active-page', { text: 'runs now' }));
      row.onclick = () => { pageIndex = p.index; detailSig = ''; ED.select({ kind: 'page', map: mapId(), id: obj.id, page: p.index }); };
      orderList.appendChild(row);
    });
    host.appendChild(orderList);
    host.appendChild(make('div.ed-hint', { text: 'Pages are checked top to bottom and the LAST one whose condition passes wins — so put the later story on the lower pages. “Runs now” is what happens at the start of a new game.' }));
  }

  function movePage(obj, delta) {
    const to = pageIndex + delta;
    if (to < 0 || to >= (obj.pages || []).length) return;
    commit('Reorder pages', (doc, O) => O.movePage(doc, { map: mapId(), id: obj.id, page: pageIndex, to }));
    showPage(obj.id, to);
  }
  /**
   * Show page `index` of the event after a page action. When a page tab had been
   * tapped the selection names a page too, so it is moved along — the script
   * editor and the problems list read it — and either way the detail is rebuilt.
   */
  function showPage(id, index) {
    pageIndex = index;
    detailSig = '';
    const s = ED.state.selection;
    if (s && (s.kind === 'page' || s.kind === 'slot') && s.id === id) ED.select({ kind: 'page', map: mapId(), id, page: index });
    else render();
  }

  // ---- script slots --------------------------------------------------------------------
  function renderSlots(obj) {
    const host = el.slots;
    if (!host) return;
    clear(host);
    const page = (obj.pages || [])[pageIndex] || {};
    const on = page.on || {};
    for (const slot of SLOTS) {
      const cmds = on[slot.id] || [];
      const row = make('div.ed-item.ed-slot');
      const left = make('span.ed-slot-body');
      left.appendChild(make('span.ed-slot-name', { text: slot.label }));
      left.appendChild(make('span.ed-slot-sum' + (cmds.length ? '' : '.is-empty'), { text: cmds.length ? INS.scriptSummary(cmds, { project: project() }) : slot.doc }));
      row.appendChild(left);
      if (cmds.length) row.appendChild(make('span.ed-badge', { text: String(cmds.length) }));
      const open = () => INS.openScript({
        path: objectPath(obj.id).concat('pages', pageIndex, 'on', slot.id),
        selection: { kind: 'slot', map: mapId(), id: obj.id, page: pageIndex, slot: slot.id },
        label: `${obj.name || obj.id} · ${slot.label}`,
        commands: cmds,
      });
      row.appendChild(btn(cmds.length ? 'Open ✎' : 'Write ✎', `Open ${slot.label} in the script editor`, open));
      row.onclick = (e) => { if (e.target.tagName !== 'BUTTON') open(); };
      host.appendChild(row);
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
