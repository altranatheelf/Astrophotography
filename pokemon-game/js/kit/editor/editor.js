// Creator Mode — the shell (contract: docs/EDITOR-CONTRACT.md).
//
// Everything visible is a registered panel or tool; this file only owns the
// state, the document, the canvas surface and the wiring between them. It has
// no knowledge of tiles, objects or scripts beyond passing them along.
//
//   KIT.editor.open({ game })   // from the pause menu or ?edit=1
//   KIT.editor.close()
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const ED = KIT.editor = KIT.editor || {};
  const UI = KIT.ui;

  const LAYERS = ['terrain', 'ground', 'deco', 'above', 'regions', 'collision'];
  const MIN_SCALE = 1, MAX_SCALE = 8;

  const listeners = { change: [], document: [], selection: [], problems: [], mode: [] };
  let open = false, game = null, renderer = null, saveTimer = null, strokeDepth = 0;
  let unwatch = null, raf = 0;

  const state = ED.state = {
    doc: null, project: null, mapId: null, map: null,
    mode: 'edit', tool: 'pencil', layer: 'ground', tile: null, stamp: null,
    selection: null, cursor: { x: 0, y: 0 }, view: { x: 0, y: 0, scale: 2 },
    show: { grid: true, collision: false, regions: false, terrain: false, objects: true, labels: true },
    panel: 'tiles', problems: [], dirty: false, saving: false, lastSaved: null,
    sheet: 'auto',        // phone only: how tall the panel sheet is — auto (tall off the Map group) | short | tall
  };

  // ---- events -------------------------------------------------------------------
  ED.on = function (event, fn) {
    if (!listeners[event]) throw new Error(`editor: unknown event '${event}'`);
    listeners[event].push(fn);
    return () => { const i = listeners[event].indexOf(fn); if (i >= 0) listeners[event].splice(i, 1); };
  };
  function emit(event, payload) {
    for (const fn of (listeners[event] || []).slice()) {
      try { fn(payload, state); } catch (e) { (KIT.log || console).error(`[editor:${event}]`, e); }
    }
  }

  // ---- state --------------------------------------------------------------------
  /** set({ tool:'fill', layer:'deco' }) — shallow merge, then repaint and tell the panels. */
  ED.set = function (patch) {
    let panelChanged = false;
    for (const k of Object.keys(patch || {})) {
      if (k === 'show') Object.assign(state.show, patch.show);
      else if (k === 'view') Object.assign(state.view, patch.view);
      else {
        if (k === 'panel' && state.panel !== patch[k]) panelChanged = true;
        if (k === 'tool' && state.tool !== patch[k]) cancelTool();     // a half-drawn rectangle does not belong to the next tool
        state[k] = patch[k];
      }
    }
    if (state.view.scale < MIN_SCALE) state.view.scale = MIN_SCALE;
    if (state.view.scale > MAX_SCALE) state.view.scale = MAX_SCALE;
    // Every camera write stays on the map: the Hand tool (a phone's only pan) used
    // to be able to drag the whole map off screen with nothing left to grab.
    if (patch && patch.view && ED.el && ED.el.canvas) clampView();
    if (panelChanged) showPanel(state.panel);
    emit('change', patch);
    updateStatus();
    refreshPanels();
    ED.repaint();
  };
  ED.select = function (sel) {
    state.selection = sel || null;
    for (const rec of mounted.values()) {
      if (rec.def.onSelect) { try { rec.def.onSelect(state.selection, ED); } catch (e) { (KIT.log || console).error(`[panel ${rec.def.id}]`, e); } }
    }
    emit('selection', state.selection);
    emit('change', { selection: state.selection });
    ED.repaint();
    refreshPanels();
  };
  ED.openMap = function (id) {
    if (!state.project.maps[id]) return false;
    cancelTool();                       // a corner tapped on the old map must not finish a rectangle on the new one
    state.mapId = id;
    state.map = KIT.mapView(state.project, null, id);
    state.view.x = 0; state.view.y = 0;
    ED.select(null);
    emit('change', { mapId: id });
    ED.repaint();
    refreshPanels();
    return true;
  };
  /**
   * What the last document changes did to the baked map layers, gathered by
   * the document watcher and spent by refresh().
   *
   * refresh() used to drop the renderer's whole tile cache on every commit —
   * renaming an NPC re-baked every layer of the map, and a paint stroke on a
   * 100×80 map re-drew 24,000 cells to change one. The document already says
   * exactly which paths changed, and the renderer already knows how to repaint
   * one cell, so the two are joined here: a cell op invalidates a cell, a
   * whole-layer or whole-map op drops that map, anything that changes what
   * tiles LOOK like drops everything, and an edit to a variable touches nothing.
   */
  const pending = { drop: false, maps: new Set(), cells: [] };
  function noteChange(change) {
    for (const path of change.paths || []) {
      if (!path.length) { pending.drop = true; return; }
      const head = path[0];
      if (head === 'assets' || head === 'autotiles' || head === 'terrains') { pending.drop = true; return; }
      if (head !== 'maps') continue;
      if (path.length < 2) { pending.drop = true; return; }
      const id = path[1];
      if (path.length === 2 || path[2] === 'layers' && path.length <= 4) { pending.maps.add(id); continue; }
      if (path[2] === 'layers' && path.length >= 5) { pending.cells.push({ id, i: path[4] }); continue; }
      // objects, name, kind, music, props, collision: none of it is baked.
    }
  }
  function spendChanges() {
    if (!renderer) { pending.drop = false; pending.maps.clear(); pending.cells.length = 0; return; }
    if (pending.drop) renderer.clearCaches();
    else {
      for (const id of pending.maps) renderer.invalidate(id);
      for (const c of pending.cells) {
        if (pending.maps.has(c.id)) continue;
        const m = state.project && state.project.maps[c.id];
        const w = m && m.width > 0 ? m.width : 0;
        if (!w || typeof c.i !== 'number') { renderer.invalidate(c.id); continue; }
        renderer.invalidate(c.id, c.i % w, Math.floor(c.i / w));
      }
    }
    pending.drop = false; pending.maps.clear(); pending.cells.length = 0;
  }

  /** refresh({ drop }) — `drop` throws the whole tile cache away, for a project that was replaced. */
  ED.refresh = function (opts) {
    if (state.project && state.mapId && state.project.maps[state.mapId]) state.map = KIT.mapView(state.project, null, state.mapId);
    else if (state.project) { const first = Object.keys(state.project.maps)[0]; if (first) { state.mapId = first; state.map = KIT.mapView(state.project, null, first); } }
    if (opts && opts.drop) pending.drop = true;
    spendChanges();
    ED.repaint();
    refreshPanels();
  };

  // ---- the document -------------------------------------------------------------
  /** commit(label, fn) — one undo step, then refresh, validate and autosave. */
  ED.commit = function (label, fn) {
    const result = state.doc.transaction(label, () => fn(state.doc, ED.ops));
    afterDocument('edit');
    return result;
  };
  /** A panel that edited the document some other way says so with this. */
  ED.afterEdit = function () { afterDocument('edit'); };
  /** A pointer stroke is one undo step: beginStroke/endStroke wrap many ops. */
  // One pointer stroke is one undo step: the document holds a transaction open for it,
  // so a tool may apply an op per cell as the finger moves and still undo in one go.
  ED.beginStroke = function (label) {
    if (strokeDepth++ > 0) return;
    if (state.doc.begin) state.doc.begin(label || 'Edit');
  };
  ED.endStroke = function () {
    if (--strokeDepth > 0) return;
    strokeDepth = 0;
    if (state.doc.end) state.doc.end();
  };
  /**
   * abortStroke() — end the stroke in progress and take back whatever it drew.
   *
   * A second finger landing means the person meant a gesture, not a mark. But
   * fingers do not land at the same millisecond, so the first one has usually
   * already painted something. This undoes exactly that and nothing else: the
   * document only records a step if the stroke actually changed something, so
   * an empty stroke costs nothing and a real one is reverted without touching
   * the undo the gesture is about to ask for.
   */
  ED.abortStroke = function () {
    if (strokeDepth === 0) return false;
    const before = state.doc.history.length;
    strokeDepth = 1;
    ED.endStroke();
    if (state.doc.history.length > before) { state.doc.undo(); afterDocument('undo'); return true; }
    return false;
  };
  ED.undo = function () { if (state.doc.undo()) afterDocument('undo'); };
  ED.redo = function () { if (state.doc.redo()) afterDocument('redo'); };

  function afterDocument(kind) {
    state.project = state.doc.value;
    state.dirty = state.doc.dirty;
    ED.refresh();
    scheduleValidate();
    scheduleSave();
    emit('document', { kind });
  }

  let validateTimer = null;
  function scheduleValidate() {
    if (validateTimer) clearTimeout(validateTimer);
    validateTimer = setTimeout(() => {
      validateTimer = null;
      try { state.problems = KIT.project.validate(state.project) || []; }
      catch (e) { state.problems = [{ severity: 'error', code: 'validator', message: String(e.message || e), where: {} }]; }
      emit('problems', state.problems);
      refreshPanels();
      updateStatus();
    }, 250);
  }
  function scheduleSave() {
    if (!KIT.storage || !KIT.storage.saveDraft) return;
    if (saveTimer) clearTimeout(saveTimer);
    state.saving = true;
    updateStatus();
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      // saveDraft RETURNS false when the write failed; it does not throw. This
      // used to be a bare try/catch, so a full or blocked store marked the work
      // clean, stamped the time, and put "saved" on the status bar — the author
      // told their work was safe at the exact moment it stopped being.
      let ok = false;
      try { ok = await KIT.storage.saveDraft(state.project) !== false; }
      catch (e) { (KIT.log || console).warn('[editor] draft not saved', e); ok = false; }
      if (ok) { state.lastSaved = Date.now(); state.dirty = false; state.saveFailed = null; }
      else {
        state.saveFailed = (KIT.storage && KIT.storage.warning) || 'Could not save.';
        (KIT.log || console).error('[editor] ' + state.saveFailed);
      }
      state.saving = false;
      updateStatus();
    }, 600);
  }
  ED.saveNow = async function () {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (KIT.storage && KIT.storage.saveDraft) {
      const ok = await KIT.storage.saveDraft(state.project) !== false;
      if (ok) { state.lastSaved = Date.now(); state.dirty = false; state.saveFailed = null; }
      else state.saveFailed = (KIT.storage && KIT.storage.warning) || 'Could not save.';
    }
    updateStatus();
  };

  /** problemsFor(selection) — the problems that belong to one thing. */
  ED.problemsFor = function (sel) {
    const s = sel || state.selection;
    if (!s) return [];
    return (state.problems || []).filter(p => {
      const w = p.where || {};
      if (s.kind === 'object' || s.kind === 'page' || s.kind === 'slot') return w.map === s.map && w.object === s.id && (s.page == null || w.page == null || w.page === s.page);
      if (s.kind === 'map') return w.map === s.id && !w.object;
      if (s.kind === 'script') return w.script === s.path[1];
      return false;
    });
  };

  // ---- the canvas ---------------------------------------------------------------
  /** A world-shaped object the renderer can draw: the map plus its objects as entities. */
  ED.previewWorld = function () {
    const map = state.map;
    const entities = [];
    if (map && state.show.objects) {
      for (const obj of map.objects) {
        const active = map.activePage(obj, { world: { save: { vars: {}, objects: {} } }, project: state.project }) || { page: (obj.pages || [])[0], index: 0 };
        const page = active.page || {};
        const e = KIT.entities.create({ id: obj.id, kind: obj.type === 'npc' ? 'npc' : 'look', x: obj.x, y: obj.y, dir: page.dir || 'down',
          sprite: page.sprite, layer: page.layer, visible: page.visible !== false, look: (page.props && page.props.look) || null });
        e.object = obj; e.page = page; e.px = obj.x; e.py = obj.y;
        entities.push(e);
      }
    }
    return { project: state.project, map, entities, heroes: [], companion: null, camera: state.view, time: performance.now ? performance.now() : Date.now() };
  };

  ED.repaint = function () {
    if (!open || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; paint(); });
  };
  function paint() {
    if (!renderer || !state.map) return;
    if (renderer.setScale) renderer.setScale(state.view.scale);     // one tile = tileSize * view.scale CSS pixels
    renderer.setProject(state.project);
    renderer.render(ED.previewWorld());
    paintOverlay();
  }
  /** Grid, collision, regions, terrain, object labels, the tool ghost and the cursor. */
  function paintOverlay() {
    const cv = ED.el.overlay;
    if (!cv) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const rect = ED.el.canvas.getBoundingClientRect();
    if (cv.width !== Math.round(rect.width * dpr) || cv.height !== Math.round(rect.height * dpr)) {
      cv.width = Math.round(rect.width * dpr); cv.height = Math.round(rect.height * dpr);
      cv.style.width = rect.width + 'px'; cv.style.height = rect.height + 'px';
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const px = tilePixels();
    const ox = -state.view.x * px, oy = -state.view.y * px;
    const map = state.map;
    ctx.save();
    ctx.translate(ox, oy);
    if (state.show.grid && px >= 8) {
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= map.width; x++) { ctx.moveTo(x * px + 0.5, 0); ctx.lineTo(x * px + 0.5, map.height * px); }
      for (let y = 0; y <= map.height; y++) { ctx.moveTo(0, y * px + 0.5); ctx.lineTo(map.width * px, y * px + 0.5); }
      ctx.stroke();
    }
    if (state.show.collision) {
      for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
        const f = map.flagsAt(x, y);
        if (f.solid) { ctx.fillStyle = 'rgba(220,60,60,0.38)'; ctx.fillRect(x * px, y * px, px, px); }
        else if (f.ledge) { ctx.fillStyle = 'rgba(240,180,60,0.35)'; ctx.fillRect(x * px, y * px, px, px); }
        else if (f.bush || f.counter) { ctx.fillStyle = 'rgba(80,200,120,0.25)'; ctx.fillRect(x * px, y * px, px, px); }
      }
    }
    if (state.show.regions || state.show.terrain) {
      ctx.font = `${Math.max(8, Math.floor(px * 0.4))}px monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
        const v = state.show.regions ? map.region(x, y) : map.terrainAt(x, y);
        if (!v) continue;
        ctx.fillStyle = state.show.regions ? 'rgba(80,140,255,0.30)' : 'rgba(255,200,80,0.28)';
        ctx.fillRect(x * px, y * px, px, px);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        if (px >= 16) ctx.fillText(String(v), x * px + px / 2, y * px + px / 2);
      }
    }
    if (state.show.objects && state.show.labels && px >= 14) {
      ctx.font = `${Math.max(8, Math.floor(px * 0.32))}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const obj of map.objects) {
        const sel = state.selection && state.selection.kind !== 'map' && state.selection.id === obj.id;
        ctx.fillStyle = sel ? 'rgba(120,200,255,0.95)' : 'rgba(255,255,255,0.75)';
        ctx.fillText(obj.name || obj.id, obj.x * px + px / 2, obj.y * px + px + 2);
        ctx.strokeStyle = sel ? '#6cf' : 'rgba(255,255,255,0.35)';
        ctx.lineWidth = sel ? 2 : 1;
        ctx.strokeRect(obj.x * px + 1, obj.y * px + 1, px - 2, px - 2);
      }
    }
    const tool = KIT.registry('editorTools').get(state.tool);
    if (tool && tool.preview) { try { tool.preview(ctx, ED, px); } catch (e) { /* a tool must never break the paint */ } }
    // the cursor
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.strokeRect(state.cursor.x * px + 1, state.cursor.y * px + 1, px - 2, px - 2);
    ctx.restore();
  }
  /** Screen pixels per tile at the current zoom. */
  function tilePixels() {
    const size = (state.project.settings && state.project.settings.tileSize) || 16;
    return size * state.view.scale;
  }
  ED.tilePixels = tilePixels;
  ED.pointFromEvent = function (ev) {
    const rect = ED.el.canvas.getBoundingClientRect();
    const px = tilePixels();
    const x = (ev.clientX - rect.left) / px + state.view.x;
    const y = (ev.clientY - rect.top) / px + state.view.y;
    return { x, y, tx: Math.floor(x), ty: Math.floor(y), shift: !!ev.shiftKey, alt: !!ev.altKey, pointerId: ev.pointerId, button: ev.button };
  };

  // ---- pointer ------------------------------------------------------------------
  let drawing = false, panning = null, pinch = null;

  // Finger count is the modifier key of touch, and the answer is already
  // settled: Procreate and Nomad Sculpt arrived at two-finger-tap = undo,
  // three-finger-tap = redo independently, and every tablet artist already knows
  // it. Deviating would cost something and buy nothing — and unlike a toolbar
  // button, this takes no screen space at all, which on a phone is the whole
  // game. Godot's own Android editor documentation tells you to bring a
  // Bluetooth keyboard and mouse instead.
  const GESTURE_MS = 450;          // longer than this and it was a hold, not a tap
  const GESTURE_SLOP = 26;         // moved further than this and it was a pan
  const touches = new Map();       // pointerId -> { x, y }
  let gesture = null;              // { fingers, start, moved }

  function gestureDown(ev) {
    touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (touches.size < 2) return false;
    if (drawing) { drawing = false; ED.abortStroke(); }
    cancelTool();                       // the first finger of a two-finger tap is not a corner
    if (!gesture) gesture = { fingers: 0, start: nowMs(), moved: false };
    gesture.fingers = Math.max(gesture.fingers, touches.size);
    return true;
  }
  function gestureMove(ev) {
    const t = touches.get(ev.pointerId);
    if (!t || !gesture) return;
    if (Math.abs(ev.clientX - t.x) > GESTURE_SLOP || Math.abs(ev.clientY - t.y) > GESTURE_SLOP) gesture.moved = true;
  }
  function gestureUp(ev) {
    if (!touches.has(ev.pointerId)) return false;
    touches.delete(ev.pointerId);
    if (!gesture) return false;
    if (touches.size > 0) return true;              // still lifting fingers
    const g = gesture;
    gesture = null;
    if (g.moved || nowMs() - g.start > GESTURE_MS) return true;
    if (g.fingers === 2) { ED.undo(); ED.toast('Undo'); }
    else if (g.fingers >= 3) { ED.redo(); ED.toast('Redo'); }
    return true;
  }
  const nowMs = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());
  // Capturing a pointer throws if the browser has already forgotten it — which
  // happens when a finger is lifted between the event firing and this running,
  // and on any synthetic event. Unguarded, the throw aborts the handler and
  // leaves `drawing` true with no stroke ever ended, so the next tap paints into
  // a transaction that is never closed. Capture is an optimisation; losing it is
  // survivable, and losing the stroke is not.
  function capture(el, id) { try { el.setPointerCapture(id); } catch (e) { /* it is already gone */ } }

  function onPointerDown(ev) {
    if (state.mode !== 'edit') return;
    const el = ED.el.canvas;
    const pt = ED.pointFromEvent(ev);
    if (ev.pointerType === 'touch' && gestureDown(ev)) { ev.preventDefault(); return; }
    if (ev.pointerType === 'touch' && pinchCandidate(ev)) return;
    // middle button, space, or a second finger pans
    if (ev.button === 1 || ev.button === 2 || ED.spaceHeld) { panning = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, vx: state.view.x, vy: state.view.y }; capture(el, ev.pointerId); ev.preventDefault(); return; }
    const tool = KIT.registry('editorTools').get(state.tool);
    if (!tool) return;
    drawing = true;
    capture(el, ev.pointerId);
    ED.beginStroke(KIT.labelOf(tool, ED, tool.id));
    try { if (tool.begin) tool.begin(pt, ED); } catch (e) { (KIT.log || console).error('[tool]', e); }
    state.cursor = { x: pt.tx, y: pt.ty };
    ED.repaint();
    ev.preventDefault();
  }
  function onPointerMove(ev) {
    if (ev.pointerType === 'touch') gestureMove(ev);
    const pt = ED.pointFromEvent(ev);
    if (panning && panning.id === ev.pointerId) {
      const px = tilePixels();
      state.view.x = panning.vx - (ev.clientX - panning.x) / px;
      state.view.y = panning.vy - (ev.clientY - panning.y) / px;
      clampView();
      ED.repaint();
      return;
    }
    if (state.cursor.x !== pt.tx || state.cursor.y !== pt.ty) { state.cursor = { x: pt.tx, y: pt.ty }; updateStatus(); ED.repaint(); }
    if (!drawing) return;
    const tool = KIT.registry('editorTools').get(state.tool);
    if (tool && tool.move) { try { tool.move(pt, ED); } catch (e) { (KIT.log || console).error('[tool]', e); } }
  }
  function onPointerUp(ev) {
    if (ev.pointerType === 'touch' && gestureUp(ev)) return;
    if (panning && panning.id === ev.pointerId) { panning = null; return; }
    if (!drawing) return;
    drawing = false;
    const tool = KIT.registry('editorTools').get(state.tool);
    const pt = ED.pointFromEvent(ev);
    if (tool && tool.end) { try { tool.end(pt, ED); } catch (e) { (KIT.log || console).error('[tool]', e); } }
    ED.endStroke();
    afterDocument('edit');
  }
  function pinchCandidate() { return false; }      // two-finger zoom is handled by the wheel/buttons for now
  /** The active tool forgets any half-made gesture (a rectangle's first corner, a pencil's ghost). */
  function cancelTool() {
    const t = KIT.registry('editorTools').get(state.tool);
    if (t && t.cancel) { try { t.cancel(); } catch (e) { (KIT.log || console).error('[tool]', e); } }
  }
  ED.cancelTool = cancelTool;
  function clampView() {
    const map = state.map;
    if (!map) return;
    const rect = ED.el.canvas.getBoundingClientRect();
    const px = tilePixels();
    const visW = rect.width / px, visH = rect.height / px;
    state.view.x = KIT.clamp(state.view.x, -2, Math.max(-2, map.width - visW + 2));
    state.view.y = KIT.clamp(state.view.y, -2, Math.max(-2, map.height - visH + 2));
  }
  ED.zoom = function (delta, at) {
    const before = tilePixels();
    state.view.scale = KIT.clamp(state.view.scale + delta, MIN_SCALE, MAX_SCALE);
    const after = tilePixels();
    if (at) {   // keep the tile under the pointer put
      state.view.x = at.x - (at.x - state.view.x) * (before / after);
      state.view.y = at.y - (at.y - state.view.y) * (before / after);
    }
    clampView();
    ED.set({});
  };

  // ---- keyboard -----------------------------------------------------------------
  function onKey(ev) {
    if (!open) return;
    if (state.mode === 'play') {          // Play here: Escape comes back to editing
      if (ev.key === 'Escape') { ev.preventDefault(); ED.backToEdit(); }
      return;
    }
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = ev.key;
    if (k === ' ') { ED.spaceHeld = true; return; }
    if ((ev.ctrlKey || ev.metaKey) && (k === 'z' || k === 'Z')) { ev.preventDefault(); return (ev.shiftKey ? ED.redo() : ED.undo()); }
    if ((ev.ctrlKey || ev.metaKey) && k === 'y') { ev.preventDefault(); return ED.redo(); }
    if ((ev.ctrlKey || ev.metaKey) && k === 's') { ev.preventDefault(); return ED.saveNow(); }
    for (const tool of KIT.registry('editorTools').list()) if (tool.key && tool.key === k) { ED.set({ tool: tool.id }); return; }
    if (k === 'g') ED.set({ show: { grid: !state.show.grid } });
    else if (k === 'c') ED.set({ show: { collision: !state.show.collision } });
    else if (k === 'r') ED.set({ show: { regions: !state.show.regions } });
    else if (k === 't') ED.set({ show: { terrain: !state.show.terrain } });
    else if (k === '[' || k === ']') {
      const i = LAYERS.indexOf(state.layer);
      ED.set({ layer: LAYERS[KIT.clamp(i + (k === ']' ? 1 : -1), 0, LAYERS.length - 1)] });
    } else if (k === 'Escape') ED.select(null);
    else if (k === 'Delete' || k === 'Backspace') ED.deleteSelection();
    else if (k === 'F5' || (k === 'p' && ev.shiftKey)) { ev.preventDefault(); ED.playHere(); }
  }
  function onKeyUp(ev) { if (ev.key === ' ') ED.spaceHeld = false; }

  ED.deleteSelection = async function () {
    const s = state.selection;
    if (!s) return;
    if (s.kind === 'object') {
      const obj = (state.project.maps[s.map].objects || []).find(o => o.id === s.id);
      if (!obj) return;
      if (!(await ED.confirm(`Delete “${obj.name || obj.id}”?`))) return;
      ED.ops.deleteObject(state.doc, { map: s.map, id: s.id });
      ED.select(null);
      afterDocument('edit');
    }
  };

  // ---- panels -------------------------------------------------------------------
  const mounted = new Map();
  function panelList() {
    return KIT.registry('editorPanels').list()
      .filter(p => !p.visible || p.visible(ED))
      .sort((a, b) => (a.order || 50) - (b.order || 50));
  }

  /**
   * The panels, in four groups.
   *
   * Nineteen panels as one flat strip was the thing that made Creator Mode feel
   * impossible: a four-row wall of equal-weight tabs on a laptop, and on a phone
   * one endless row you scrolled blind through to find “Rules”. Nobody thinks
   * “I want the Terms tab”; they think “I am working on this map”, “I am
   * writing”, or “this is about the whole game”. So those are the tabs, and the
   * panels of the one you are in are a short second row.
   *
   * A panel says which group it belongs to with `section` — not `group`, which
   * the Tiles panel already uses for the tile group it is showing, and which put
   * Tiles under Game on the first try. A module's panel that says nothing lands
   * in Game, which is where a thing about the whole game belongs. Problems is
   * its own group so the count is always on screen.
   */
  const GROUPS = [
    { id: 'map', label: 'Map', hint: 'This map: paint it, place things on it, connect it' },
    { id: 'story', label: 'Story', hint: 'What is said and what happens' },
    { id: 'game', label: 'Game', hint: 'The whole game: settings, variables, items, words' },
    { id: 'problems', label: 'Problems', hint: 'What the validator found' },
  ];
  // The kit's own panels only. A module's panel says `section` for itself —
  // the first version of this table named two module panels here, and the
  // purity test refused it (ADR-0005).
  const DEFAULT_GROUP = {
    tiles: 'map', objects: 'map', map: 'map',
    script: 'story', scripts: 'story', fragments: 'story', dialogue: 'story', cast: 'story', rules: 'story',
    project: 'game', vars: 'game', items: 'game', strings: 'game', data: 'game', import: 'game',
    problems: 'problems',
  };
  function groupOf(def) {
    const d = typeof def === 'string' ? KIT.registry('editorPanels').get(def) : def;
    if (!d) return 'game';
    const g = d.section || DEFAULT_GROUP[d.id] || 'game';
    return GROUPS.some(x => x.id === g) ? g : 'game';
  }
  ED.groups = () => GROUPS.map(g => ({ id: g.id, label: g.label }));
  ED.groupOf = groupOf;
  ED.panelsOf = (group) => panelList().filter(p => groupOf(p) === group).map(p => p.id);

  function buildTabs() {
    const groups = ED.el.groups, bar = ED.el.tabs;
    if (!groups || !bar) return;
    const active = groupOf(state.panel);
    UI.clear(groups);
    const errs = (state.problems || []).filter(p => p.severity === 'error').length;
    const warns = (state.problems || []).filter(p => p.severity === 'warn').length;
    for (const g of GROUPS) {
      const b = UI.make('button.ed-group', { text: g.label });
      b.type = 'button';
      b.dataset.group = g.id;
      b.title = g.hint;
      b.setAttribute('aria-selected', String(g.id === active));
      if (g.id === 'problems') {
        const n = errs + warns;
        if (n) {
          const badge = UI.make('span.ed-group-badge' + (errs ? '.is-error' : ''), { text: String(n) });
          b.appendChild(badge);
        }
      }
      b.onclick = () => {
        const first = ED.panelsOf(g.id)[0];
        if (first) ED.set({ panel: groupOf(state.panel) === g.id ? state.panel : first });
      };
      groups.appendChild(b);
    }
    // On a phone the sheet is short under Map (the map is what you tap) and tall
    // everywhere else (a script or a form is what you read); the grip flips it.
    const grip = UI.make('button.ed-sheet-grip');
    grip.type = 'button';
    grip.onclick = () => { state.sheet = sheetTall() ? 'short' : 'tall'; syncSheet(); };
    groups.appendChild(grip);
    syncSheet();
    UI.clear(bar);
    const inGroup = panelList().filter(p => groupOf(p) === active);
    bar.classList.toggle('is-single', inGroup.length < 2);   // one panel needs no chip under the group
    for (const p of inGroup) {
      const b = UI.make('button.ed-tab', { text: KIT.labelOf(p, ED, p.id) });
      b.type = 'button';
      b.dataset.panel = p.id;
      b.setAttribute('aria-selected', String(p.id === state.panel));
      b.onclick = () => ED.set({ panel: p.id });
      bar.appendChild(b);
    }
  }
  ED.buildTabs = buildTabs;
  function sheetTall() { return state.sheet === 'tall' || (state.sheet === 'auto' && groupOf(state.panel) !== 'map'); }
  function syncSheet() {
    if (!ED.el || !ED.el.root) return;
    const tall = sheetTall();
    const was = ED.el.root.classList.contains('is-sheet-tall');
    ED.el.root.classList.toggle('is-sheet-tall', tall);
    const grip = ED.el.groups && ED.el.groups.querySelector('.ed-sheet-grip');
    if (grip) { grip.textContent = tall ? '▾' : '▴'; grip.title = tall ? 'More map' : 'More panel'; grip.setAttribute('aria-label', grip.title); }
    if (was !== tall) requestAnimationFrame(() => { if (renderer && renderer.resize) renderer.resize(); ED.repaint(); });
  }
  ED.sheetTall = sheetTall;
  function showPanel(id) {
    const host = ED.el.panel;
    if (!host) return;
    // The strip shows one group's panels; a panel from another group means a
    // different strip, so it is rebuilt rather than merely re-highlighted.
    if (!ED.el.tabs.querySelector(`.ed-tab[data-panel="${id}"]`)) buildTabs();
    for (const b of ED.el.tabs.querySelectorAll('.ed-tab')) b.setAttribute('aria-selected', String(b.dataset.panel === id));
    for (const b of (ED.el.groups ? ED.el.groups.querySelectorAll('.ed-group') : [])) b.setAttribute('aria-selected', String(b.dataset.group === groupOf(id)));
    syncSheet();
    for (const [pid, rec] of mounted) rec.el.hidden = pid !== id;
    if (!mounted.has(id)) {
      const def = KIT.registry('editorPanels').get(id);
      if (!def) return;
      const el = UI.make('div.ed-panel-body');
      el.dataset.panel = id;
      host.appendChild(el);
      mounted.set(id, { def, el });
      try { def.mount(el, ED); } catch (e) { (KIT.log || console).error(`[panel ${id}]`, e); el.textContent = `This panel failed to open: ${e.message}`; }
    }
    const rec = mounted.get(id);
    if (rec) { rec.el.hidden = false; refreshPanel(rec); }
    // A panel can be *for* a tool: Events is for picking and moving Events, Tiles
    // for painting. Opening one hands the pointer to its tool unless the active
    // tool is one the panel uses — otherwise a tap meant to select Mom paints
    // grass under her. The toolbar is refreshed by the ED.set that got us here.
    const want = rec && rec.def.tool;
    if (want && !(rec.def.tools || [want]).includes(state.tool) && KIT.registry('editorTools').has(want)) state.tool = want;
  }
  function refreshPanel(rec) {
    if (!rec || rec.el.hidden) return;
    try { if (rec.def.refresh) rec.def.refresh(ED); } catch (e) { (KIT.log || console).error(`[panel ${rec.def.id}]`, e); }
  }
  function refreshPanels() {
    for (const rec of mounted.values()) refreshPanel(rec);
    if (ED.el && ED.el.tabs && ED.el.tabs.children.length !== panelList().length) buildTabs();
  }
  ED.refreshPanels = refreshPanels;

  // ---- toolbar and status --------------------------------------------------------
  function buildToolbar() {
    const bar = ED.el.toolbar;
    UI.clear(bar);
    const mapSelect = UI.make('select.ed-maps');
    mapSelect.onchange = () => ED.openMap(mapSelect.value);
    bar.appendChild(mapSelect);
    ED.el.mapSelect = mapSelect;

    const tools = UI.make('div.ed-tools');
    bar.appendChild(tools);
    ED.el.tools = tools;

    const spacer = UI.make('div.ed-spacer');
    bar.appendChild(spacer);

    const mk = (label, title, fn, cls) => { const b = UI.make('button.ed-btn' + (cls ? '.' + cls : ''), { text: label }); b.title = title; b.onclick = fn; bar.appendChild(b); return b; };
    ED.el.undoBtn = mk('↶', 'Undo (Ctrl+Z)', () => ED.undo());
    ED.el.redoBtn = mk('↷', 'Redo (Ctrl+Shift+Z)', () => ED.redo());
    mk('−', 'Zoom out', () => ED.zoom(-1));
    mk('+', 'Zoom in', () => ED.zoom(1));
    ED.el.playBtn = mk('▶ Play', 'Play from the cursor (F5)', () => ED.playHere(), 'primary');
    ED.el.playBtn.appendChild(UI.make('span.ed-play-more', { text: ' here' }));   // dropped on a phone, where the row is full
    mk('✕', 'Close Creator Mode', () => ED.close());
    refreshToolbar();
  }
  function refreshToolbar() {
    const sel = ED.el.mapSelect;
    if (sel) {
      const ids = Object.keys(state.project.maps);
      if (sel.children.length !== ids.length || sel.value !== state.mapId) {
        UI.clear(sel);
        for (const id of ids) {
          const o = UI.make('option', { text: state.project.maps[id].name || id });
          o.value = id;
          sel.appendChild(o);
        }
        sel.value = state.mapId;
      }
    }
    const tools = ED.el.tools;
    if (tools) {
      const defs = KIT.registry('editorTools').list().filter(t => !t.layers || t.layers.includes(state.layer)).sort((a, b) => (a.order || 50) - (b.order || 50));
      if (tools.children.length !== defs.length) {
        UI.clear(tools);
        for (const t of defs) {
          // An icon on its own was nine emoji in a row — what is the sponge, the
          // droplet, the leaf? — so every tool carries its word.
          const b = UI.make('button.ed-tool');
          b.appendChild(UI.make('span.ed-tool-icon', { text: t.icon || '·' }));
          b.appendChild(UI.make('span.ed-tool-label', { text: t.short || KIT.labelOf(t, ED, t.id) }));
          b.dataset.tool = t.id;
          b.title = `${KIT.labelOf(t, ED, t.id)}${t.key ? ` (${t.key})` : ''}`;
          b.onclick = () => ED.set({ tool: t.id });
          tools.appendChild(b);
        }
      }
      for (const b of tools.querySelectorAll('.ed-tool')) b.setAttribute('aria-selected', String(b.dataset.tool === state.tool));
    }
    if (ED.el.undoBtn) ED.el.undoBtn.disabled = !state.doc.canUndo();
    if (ED.el.redoBtn) ED.el.redoBtn.disabled = !state.doc.canRedo();
  }
  function updateStatus() {
    const s = ED.el.status;
    if (!s) return;
    const errs = state.problems.filter(p => p.severity === 'error').length;
    const warns = state.problems.filter(p => p.severity === 'warn').length;
    const bits = [
      `${state.cursor.x}, ${state.cursor.y}`,
      `${state.layer}`,
      state.saving ? 'saving…' : (state.saveFailed ? '⚠ NOT SAVED' : (state.lastSaved ? 'saved' : '')),
      errs ? `${errs} error${errs > 1 ? 's' : ''}` : '',
      warns ? `${warns} warning${warns > 1 ? 's' : ''}` : '',
    ].filter(Boolean);
    s.textContent = bits.join('   ·   ');
    s.classList.toggle('has-errors', errs > 0 || !!state.saveFailed);
    // The Problems group carries the count, so it is on screen whichever panel is open.
    const pb = ED.el.groups && ED.el.groups.querySelector('.ed-group[data-group="problems"]');
    if (pb) {
      const n = errs + warns;
      let badge = pb.querySelector('.ed-group-badge');
      if (!n && badge) badge.remove();
      else if (n) {
        if (!badge) { badge = UI.make('span.ed-group-badge'); pb.appendChild(badge); }
        badge.textContent = String(n);
        badge.classList.toggle('is-error', errs > 0);
      }
    }
    s.title = state.saveFailed ? state.saveFailed + ' Use Project › “Save a copy” to get your work out.' : '';
    refreshToolbar();
  }
  ED.updateStatus = updateStatus;

  ED.toast = function (text) { if (KIT.toast) KIT.toast(text); else (KIT.log || console).log('[editor]', text); };
  /** confirm(text, { yes }) — a two-button question; the yes button says what it does ('Delete' unless told otherwise). */
  ED.confirm = function (text, opts) {
    return new Promise((resolve) => {
      const wrap = UI.make('div.ed-confirm');
      wrap.appendChild(UI.make('p', { text }));
      const row = UI.make('div.ed-confirm-row');
      const no = UI.make('button.ed-btn', { text: 'Cancel' });
      const yes = UI.make('button.ed-btn.danger', { text: (opts && opts.yes) || 'Delete' });
      no.onclick = () => { wrap.remove(); resolve(false); };
      yes.onclick = () => { wrap.remove(); resolve(true); };
      row.appendChild(no); row.appendChild(yes);
      wrap.appendChild(row);
      ED.el.root.appendChild(wrap);
      yes.focus();
    });
  };

  // ---- play here -----------------------------------------------------------------
  ED.playHere = async function (opts) {
    if (!game || !game.loadProject) { ED.toast('The game is not running'); return; }
    await ED.saveNow();
    state.mode = 'play';
    emit('mode', 'play');
    ED.el.root.classList.add('playing');
    game.loadProject(KIT.deepClone(state.project));
    const at = (opts && opts.at) || state.cursor;
    await game.newGame({ testState: (opts && opts.testState) || null, silent: true });
    if (game.warp) await game.warp(state.mapId, at.x, at.y, 'down');
    ED.toast('Playing — press Escape to come back');
  };
  ED.backToEdit = function () {
    state.mode = 'edit';
    emit('mode', 'edit');
    ED.el.root.classList.remove('playing');
    ED.refresh({ drop: true });                    // the game may have baked other maps into the same renderer
  };

  // ---- open / close ----------------------------------------------------------------
  ED.isOpen = () => open;
  ED.open = function (opts) {
    opts = opts || {};
    if (open) return ED;
    game = opts.game || KIT.game || null;
    const raw = opts.project || (game && game.project) || (KIT.storage && KIT.storage.loadProject ? null : null) || KIT.project.blank();
    const n = KIT.project.normalize(KIT.deepClone(raw));
    state.doc = KIT.document(n.project);
    state.project = state.doc.value;
    state.problems = n.problems || [];
    state.mapId = opts.mapId || (game && game.world && game.world.map ? game.world.map.id : null) || state.project.start.map || Object.keys(state.project.maps)[0];
    state.map = KIT.mapView(state.project, null, state.mapId);
    if (!state.tile) { const t = KIT.registry('tiles').list()[0]; state.tile = t ? t.id : null; }
    buildDom();
    open = true;
    unwatch = state.doc.watch([], (change) => { state.project = state.doc.value; state.dirty = true; noteChange(change); });
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKeyUp);
    buildToolbar();
    buildTabs();
    showPanel(state.panel);
    ED.refresh({ drop: true });
    scheduleValidate();
    emit('change', { open: true });
    return ED;
  };
  ED.close = async function () {
    if (!open) return;
    await ED.saveNow();
    open = false;
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('keyup', onKeyUp);
    if (unwatch) { unwatch(); unwatch = null; }
    if (ED.el && ED.el.root) ED.el.root.hidden = true;
    emit('change', { open: false });
    if (game && game.loadProject) { game.loadProject(KIT.deepClone(state.project)); if (game.toTitle) game.toTitle(); }
  };

  function buildDom() {
    const host = UI.el('editor') || document.body;
    UI.clear(host);
    host.hidden = false;
    const root = UI.make('div.ed-root');
    const toolbar = UI.make('div.ed-toolbar');
    const main = UI.make('div.ed-main');
    const stage = UI.make('div.ed-stage');
    const canvas = UI.make('canvas.ed-canvas');
    const overlay = UI.make('canvas.ed-overlay');
    const side = UI.make('div.ed-side');
    const groups = UI.make('div.ed-groups');
    const tabs = UI.make('div.ed-tabs');
    const panel = UI.make('div.ed-panel');
    const status = UI.make('div.ed-status');
    stage.appendChild(canvas); stage.appendChild(overlay);
    side.appendChild(groups); side.appendChild(tabs); side.appendChild(panel);
    main.appendChild(stage); main.appendChild(side);
    root.appendChild(toolbar); root.appendChild(main); root.appendChild(status);
    host.appendChild(root);
    ED.el = { host, root, toolbar, main, stage, canvas, overlay, side, groups, tabs, panel, status };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    overlay.addEventListener('pointerdown', onPointerDown);
    overlay.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    overlay.addEventListener('contextmenu', (e) => e.preventDefault());
    // A mouse wheel sends one notch (~100px) per click; a trackpad sends dozens of
    // 1–5px events per flick. One zoom step per ~40px of travel treats both alike.
    let wheelAcc = 0;
    overlay.addEventListener('wheel', (e) => {
      e.preventDefault();
      wheelAcc += e.deltaMode === 1 ? e.deltaY * 40 : (e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY);
      if (Math.abs(wheelAcc) < 40) return;
      const d = wheelAcc < 0 ? 1 : -1;
      wheelAcc = 0;
      ED.zoom(d, ED.pointFromEvent(e));
    }, { passive: false });
    window.addEventListener('resize', () => { if (renderer) renderer.resize(); ED.repaint(); });

    renderer = KIT.renderer.create({ canvas, project: state.project, editor: true });
    if (renderer.resize) renderer.resize();
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
