// Creator Mode — the inspector: one form builder for every schema field list.
//
//   const form = KIT.editor.inspector.mount(el, { fields, value, onChange, ctx })
//   form.refresh(newValue)   // the document changed under us
//   form.destroy()
//
// Every widget lives in the 'fieldEditors' registry, one per field type, so a
// module can add a type and get a form for free:
//
//   KIT.registry('fieldEditors').add({ id:'stars', types:['stars'],
//     mount(el, field, value, onChange, ctx) { ...; return { set(v) {} }; } })
//
// onChange(path, value, info) — `path` is relative to the form's value
// (['props','look'], ['behaviour','route']), so a panel can turn it straight
// into a document path and hand it to KIT.editor.ops.setField.
//
// The top half of this file is pure (no DOM) and is what test/kit/editor-inspector.test.js drives.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const ED = KIT.editor = KIT.editor || {};
  const S = KIT.schema;
  const INS = ED.inspector = ED.inspector || {};

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
  const titleCase = (id) => String(id || '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  INS.titleCase = titleCase;

  // ---- widgets by type ----------------------------------------------------------
  /** editorFor(field|type) -> the fieldEditors definition that renders it ('ref:*' covers every ref kind). */
  INS.editorFor = function (field) {
    const type = typeof field === 'string' ? field : (field && field.type);
    if (!type || !KIT.registry.exists('fieldEditors')) return null;
    const list = KIT.registry('fieldEditors').list();
    for (const d of list) if ((d.types || []).indexOf(type) >= 0) return d;
    if (type.slice(0, 4) === 'ref:') for (const d of list) if ((d.types || []).indexOf('ref:*') >= 0) return d;
    return KIT.registry('fieldEditors').get('unknown') || null;
  };

  /** Every field type the schema knows about, so a test can prove each one has a widget. */
  INS.knownTypes = function () {
    const types = Object.keys((S && S.types) || {});
    return types.concat(['ref:map', 'ref:item', 'ref:var', 'ref:script', 'ref:sprite']).filter((t, i, a) => a.indexOf(t) === i);
  };

  // ---- values -------------------------------------------------------------------
  /** defaultFor(field, ctx) — the schema default, or the value inherited from a type (ctx.inherited). */
  INS.defaultFor = function (field, ctx) {
    const f = S.field(field);
    if (ctx && ctx.inherited && has(ctx.inherited, f.key)) return KIT.deepClone(ctx.inherited[f.key]);
    return S.defaultFor(f, ctx || {});
  };
  /**
   * Does this field have a default worth talking about? A declared `default:`, or
   * one inherited from the object type. Fields without one (a name, a position)
   * get no dimming and no reset control — there is nothing to go back to.
   */
  INS.hasDefault = function (field, ctx) {
    const f = S.field(field);
    if (ctx && ctx.inherited && has(ctx.inherited, f.key)) return true;
    return f.default !== undefined;
  };
  /** Is this value still the inherited/declared default? (dimmed in the form until it is overridden) */
  INS.isDefault = function (field, value, ctx) { return KIT.deepEqual(value, INS.defaultFor(field, ctx)); };

  /**
   * buildValue(fields, value, ctx) -> a complete value for a form description:
   * every declared field present (its value or its default), extra keys kept.
   * Idempotent, so the form can round-trip a partial value.
   */
  INS.buildValue = function (fields, value, ctx) {
    const out = KIT.isObject(value) ? KIT.deepClone(value) : {};
    for (const f of S.fields(fields || [])) {
      if (out[f.key] === undefined) out[f.key] = INS.defaultFor(f, ctx);
      else if (f.type === 'group') out[f.key] = INS.buildValue(f.fields || [], out[f.key], ctx);
      else if (f.type === 'list' && Array.isArray(out[f.key]) && f.of && f.of.type === 'group') out[f.key] = out[f.key].map(v => INS.buildValue(f.of.fields || [], v, ctx));
    }
    return out;
  };

  /** visibleFields(fields, value) -> the fields whose `when` passes right now. */
  INS.visibleFields = function (fields, value) { return S.fields(fields || []).filter(f => S.visible(f, value || {})); };

  /** enumOptions(field, ctx) -> [{ value, label }] */
  INS.enumOptions = function (field, ctx) {
    let opts = field.options;
    if (!opts && field.optionsFrom) {
      if (KIT.registry.exists(field.optionsFrom)) opts = KIT.registry(field.optionsFrom).list().map(d => ({ value: d.id, label: KIT.labelOf(d, ctx, d.id) }));
      else if (ctx && ctx.options && ctx.options[field.optionsFrom]) opts = ctx.options[field.optionsFrom];
      else opts = [];
    }
    return (opts || []).map(o => (o !== null && typeof o === 'object') ? { value: o.value, label: o.label || titleCase(o.value) } : { value: o, label: titleCase(o) });
  };

  // ---- references ---------------------------------------------------------------
  const refKind = (field) => (typeof field === 'string' ? field : field.type).replace(/^ref:/, '');
  INS.refKind = refKind;
  /** refList(kind, ctx) -> [{ id, label }] — the real names, for a picker. */
  INS.refList = function (kind, ctx) {
    const r = S.refKinds[kind];
    if (!r || !r.list) return [];
    let list = [];
    try { list = r.list(ctx || {}) || []; } catch (e) { list = []; }
    return list.map(o => (typeof o === 'string' ? { id: o, label: o } : { id: o.id, label: o.label || o.id }));
  };
  INS.refLabel = function (kind, id, ctx) {
    if (id == null || id === '') return '';
    const r = S.refKinds[kind];
    try { return (r && r.label) ? r.label(id, ctx || {}) : id; } catch (e) { return id; }
  };
  /** refExists(kind, id, ctx) -> true | false | null (cannot tell). */
  INS.refExists = function (kind, id, ctx) {
    if (id == null || id === '') return null;
    const r = S.refKinds[kind];
    if (!r || !r.has) return null;
    try { return r.has(id, ctx || {}); } catch (e) { return null; }
  };
  /**
   * Is this id something the author still has to make? Undeclared variables answer
   * `null` ("cannot tell") rather than false, so a missing id that is not in the
   * picker's list counts as missing too — that is what offers "Create <kind> <id>".
   */
  INS.refMissing = function (kind, id, ctx) {
    if (id == null || id === '') return false;
    const known = INS.refExists(kind, id, ctx);
    if (known === true) return false;
    if (known === false) return true;
    return INS.canCreateRef(kind) && !INS.refList(kind, ctx).some(o => o.id === id);
  };

  // "Create <kind> <id>" — the Twine move: name it now, write it later.
  const CREATORS = {
    var(id) { return ED.commit(`Declare ${id}`, (doc, O) => { O.declareVar(doc, { name: id, type: 'number', default: 0, label: titleCase(id) }); return id; }); },
    item(id) { return ED.commit(`New item ${id}`, (doc, O) => O.newItem(doc, { id, name: titleCase(id) })); },
    script(id) { return ED.commit(`New common event ${id}`, (doc, O) => O.newCommonEvent(doc, { id, label: titleCase(id) })); },
    map(id) { return ED.commit(`New map ${id}`, (doc, O) => O.newMap(doc, { id, name: titleCase(id) })); },
    fragment(id) { return ED.commit(`New note ${id}`, (doc, O) => O.addFragment(doc, { id, title: titleCase(id) })); },
  };
  INS.canCreateRef = (kind) => !!CREATORS[kind];
  /** createRef(kind, id) -> the id that now exists (ops may have made it unique), or null. */
  INS.createRef = function (kind, id) {
    if (!CREATORS[kind] || !id) return null;
    const made = CREATORS[kind](id);
    INS.afterEdit();
    return made || id;
  };

  // ---- move routes ---------------------------------------------------------------
  // The verbs KIT.entities.applyStep understands (docs/KIT-API.md → world/entities).
  INS.ROUTE_VERBS = [
    { verb: 'up', label: 'Up', say: 'step up' },
    { verb: 'down', label: 'Down', say: 'step down' },
    { verb: 'left', label: 'Left', say: 'step left' },
    { verb: 'right', label: 'Right', say: 'step right' },
    { verb: 'randomStep', label: 'Random step', say: 'step at random' },
    { verb: 'towardHero', label: 'Toward hero', say: 'step toward the hero' },
    { verb: 'awayHero', label: 'Away from hero', say: 'step away from the hero' },
    { verb: 'faceHero', label: 'Face hero', say: 'face the hero' },
    { verb: 'turnRandom', label: 'Turn at random', say: 'turn at random' },
    { verb: 'face:down', label: 'Face…', arg: 'down', say: (a) => `face ${a}` },
    { verb: 'wait:500', label: 'Wait…', arg: '500', say: (a) => `wait ${Number(a) >= 1000 ? (Number(a) / 1000) + 's' : a + 'ms'}` },
    { verb: 'jump:0,-1', label: 'Jump…', arg: '0,-1', say: (a) => `jump ${a}` },
    { verb: 'sprite:', label: 'Change sprite…', arg: '', say: (a) => `change sprite to ${a || '?'}` },
    { verb: 'speed:4', label: 'Speed…', arg: '4', say: (a) => `move at speed ${a}` },
    { verb: 'through:on', label: 'Through on', say: (a) => (a === 'off' ? 'stop walking through walls' : 'walk through walls') },
    { verb: 'visible:off', label: 'Visible off', say: (a) => (a === 'off' ? 'vanish' : 'appear') },
    { verb: 'dirFix:on', label: 'Direction fix', say: (a) => (a === 'off' ? 'unlock its facing' : 'lock its facing') },
    { verb: 'stepAnim:on', label: 'Step animation', say: (a) => (a === 'off' ? 'stop the walking animation' : 'animate while standing') },
    { verb: 'sound:', label: 'Play sound…', arg: '', say: (a) => `play ${a || '?'}` },
  ];
  const routeVerb = (step) => String(step == null ? '' : step).split(':')[0];
  const routeArg = (step) => { const s = String(step == null ? '' : step); const i = s.indexOf(':'); return i < 0 ? '' : s.slice(i + 1); };
  INS.routeVerb = routeVerb;
  INS.routeArg = routeArg;
  /** routeStepLabel('wait:500') -> 'wait 500ms' — one step in plain language. */
  INS.routeStepLabel = function (step) {
    const v = routeVerb(step), a = routeArg(step);
    const def = INS.ROUTE_VERBS.find(d => routeVerb(d.verb) === v);
    if (!def) return String(step || '');
    return typeof def.say === 'function' ? def.say(a) : def.say;
  };
  /** routeSummary(steps, { repeat }) -> 'Steps up, steps up, waits 500ms, then faces left.' */
  INS.routeSummary = function (steps, opts) {
    const list = (steps || []).filter(s => typeof s === 'string' && s.trim());
    if (!list.length) return 'No steps yet — this event stands still.';
    const said = list.map(INS.routeStepLabel);
    let text;
    if (said.length === 1) text = said[0];
    else text = said.slice(0, -1).join(', ') + ', then ' + said[said.length - 1];
    text = text.charAt(0).toUpperCase() + text.slice(1);
    return text + ((opts && opts.repeat) ? ', over and over.' : '.');
  };

  // ---- conditions -----------------------------------------------------------------
  const PRIMARY_KINDS = ['var', 'self', 'item', 'facing', 'region', 'meta'];
  /** conditionKinds() -> the condition registry, the six the author uses most first, logic last. */
  INS.conditionKinds = function () {
    if (!KIT.registry.exists('conditions')) return [];
    const list = KIT.registry('conditions').list();
    const rank = (d) => {
      const i = PRIMARY_KINDS.indexOf(d.id);
      if (i >= 0) return i;
      if (d.id === 'all' || d.id === 'any' || d.id === 'not') return 100;
      return 50;
    };
    return list.slice().sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  };
  /** newCondition('var') -> a condition of that kind with every default filled. */
  INS.newCondition = function (kind) {
    if (!kind || kind === 'always') return null;
    const def = KIT.registry('conditions').get(kind);
    if (!def) return null;
    const c = S.fill(def.fields || [], { kind });
    c.kind = kind;
    if (kind === 'all' || kind === 'any') c.of = [];
    return c;
  };
  INS.conditionText = (cond) => KIT.conditions.toText(cond);
  /** conditionFromText(str) -> { ok, cond } | { ok:false, error } */
  INS.conditionFromText = function (str) {
    try { return { ok: true, cond: KIT.conditions.parseText(str) }; }
    catch (e) { return { ok: false, error: String(e.message || e).replace(/^condition:\s*/, '') }; }
  };
  INS.conditionSays = (cond, ctx) => KIT.conditions.describe(cond, ctx || {});

  // ---- misc pure helpers -----------------------------------------------------------
  /** A stable colour per region number, so the same region always looks the same. */
  INS.regionColor = function (n) {
    const v = Number(n) | 0;
    if (!v) return '#2a3346';
    return `hsl(${Math.round((v * 137.508) % 360)} 62% 48%)`;
  };
  INS.parseScalar = function (text) {
    const s = String(text == null ? '' : text).trim();
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null' || s === '') return s === '' ? '' : null;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s;
  };
  INS.scalarText = (v) => (v === null ? 'null' : String(v));

  /**
   * afterEdit() — the shell runs validate + autosave only after a pointer stroke
   * (`afterDocument` is private), so a panel that commits calls this instead.
   */
  let validateTimer = null;
  INS.afterEdit = function () {
    if (!ED.state || !ED.state.doc) return;
    if (ED.refresh) ED.refresh();
    if (validateTimer) clearTimeout(validateTimer);
    validateTimer = setTimeout(() => {
      validateTimer = null;
      let problems = [];
      try { problems = KIT.project.validate(ED.state.project) || []; } catch (e) { problems = []; }
      if (ED.set) ED.set({ problems });
      if (ED.updateStatus) ED.updateStatus();
      if (ED.saveNow) ED.saveNow();
    }, 400);
  };

  // =================================================================================
  // Everything below needs a browser.
  // =================================================================================
  const make = (spec, opts) => KIT.ui.make(spec, opts);
  const clear = (el) => KIT.ui.clear(el);
  function btn(label, title, fn, cls) {
    const b = make('button.ed-btn' + (cls ? '.' + cls : ''), { text: label });
    b.type = 'button';
    if (title) b.title = title;
    b.onclick = (e) => { e.preventDefault(); fn(e); };
    return b;
  }
  INS.btn = btn;

  /** A sprite's standing frame, as a canvas (for the sprite picker and the page preview). */
  INS.spriteCanvas = function (id, scale) {
    const reg = KIT.registry.exists('sprites') ? KIT.registry('sprites') : null;
    const def = reg && id ? reg.get(id) : null;
    const s = scale || 2;
    if (!def) return KIT.ui.artCanvas(KIT.pixels.silhouette(16, 24, '#4a5570'), s);
    const frames = def.frames && (def.frames.down || def.frames.left || def.frames.up);
    const art = frames ? { w: def.w || 16, h: def.h || 24, palette: def.palette, rows: frames[0] } : KIT.pixels.artOf(def);
    return KIT.ui.artCanvas(art || KIT.pixels.silhouette(def.w || 16, def.h || 24, '#4a5570'), s);
  };
  /** A tile's art, as a canvas. */
  INS.tileCanvas = function (id, scale) {
    const reg = KIT.registry.exists('tiles') ? KIT.registry('tiles') : null;
    const def = reg && id ? reg.get(id) : null;
    const art = def ? (KIT.pixels.artOf(def) || KIT.pixels.silhouette(16, 16, '#3a4459')) : KIT.pixels.silhouette(16, 16, '#2a3346');
    return KIT.ui.artCanvas(art, scale || 2);
  };

  /**
   * emptyState({ icon, text, hint, actions:[{label, onTap, primary}] })
   * A list with nothing in it says what the thing is and what to do next, instead of
   * going blank. Every panel's empty list uses this one, so they all look the same.
   */
  INS.emptyState = function (opts) {
    const o = opts || {};
    const box = make('div.ed-empty');
    if (o.icon) box.appendChild(make('div.ed-empty-big', { text: o.icon }));
    if (o.text) box.appendChild(make('strong', { text: o.text }));
    if (o.hint) box.appendChild(make('div.ed-hint', { text: o.hint }));
    const acts = (o.actions || []).filter(Boolean);
    if (acts.length) {
      const row = make('div.ed-row.ed-empty-row');
      for (const a of acts) row.appendChild(btn(a.label, a.title || '', a.onTap, a.primary ? 'primary' : ''));
      box.appendChild(row);
    }
    return box;
  };
  ED.emptyState = INS.emptyState;

  // ---- pick a tile on the map (the shell has no "capture the next tap" hook) --------
  let picking = null;
  KIT.registry('editorTools').add({
    id: 'pick-position', label: 'Pick a tile', icon: '✛', order: 999, layers: [],   // layers:[] keeps it out of the toolbar
    cursor: 'crosshair',
    begin() {},
    end(pt, ed) {
      const want = picking;
      INS.stopPicking(true);
      if (want && want.onPick) want.onPick({ map: ed.state.mapId, x: pt.tx, y: pt.ty });
    },
    preview(ctx, ed, px) {
      if (!picking) return;
      const c = ed.state.cursor;
      ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3;
      ctx.strokeRect(c.x * px + 2, c.y * px + 2, px - 4, px - 4);
    },
  });
  /**
   * pickOnMap({ hint, onPick, onCancel }) -> cancel()
   * Tap-then-tap: the next tap on the map answers, Escape or a second tap on the
   * button cancels. Nothing is modal and the map stays visible the whole time.
   */
  INS.pickOnMap = function (opts) {
    INS.stopPicking(false);
    picking = Object.assign({ prevTool: ED.state.tool }, opts || {});
    ED.set({ tool: 'pick-position' });
    if (ED.el && ED.el.root) ED.el.root.classList.add('ed-is-picking');
    if (ED.toast) ED.toast(opts && opts.hint ? opts.hint : 'Tap the map to pick a tile');
    document.addEventListener('keydown', onPickKey, true);
    return () => INS.stopPicking(true);
  };
  INS.isPicking = () => !!picking;
  INS.stopPicking = function (silent) {
    if (!picking) return;
    const was = picking;
    picking = null;
    document.removeEventListener('keydown', onPickKey, true);
    if (ED.el && ED.el.root) ED.el.root.classList.remove('ed-is-picking');
    if (ED.set) ED.set({ tool: was.prevTool || 'pencil' });
    if (!silent && was.onCancel) was.onCancel();
    if (ED.refreshPanels) ED.refreshPanels();
  };
  function onPickKey(ev) {
    if (ev.key !== 'Escape') return;
    ev.preventDefault(); ev.stopPropagation();
    const was = picking;
    INS.stopPicking(true);
    if (was && was.onCancel) was.onCancel();
  }

  // =================================================================================
  // The form
  // =================================================================================
  /**
   * mount(el, { fields, value, onChange, ctx }) -> form
   * form.refresh(value) re-reads the value (widgets keep focus), form.destroy() unhooks.
   */
  INS.mount = function (host, opts) {
    opts = opts || {};
    const fields = S.fields(opts.fields || []);
    const ctx = opts.ctx || {};
    let value = INS.buildValue(fields, opts.value, ctx);
    const rows = [];
    const form = {
      el: host,
      value: () => value,
      refresh(next) {
        value = INS.buildValue(fields, next === undefined ? value : next, ctx);
        for (const r of rows) r.update(value);
      },
      destroy() { for (const r of rows) if (r.destroy) r.destroy(); rows.length = 0; clear(host); },
    };
    clear(host);
    host.classList.add('ed-form');
    for (const f of fields) {
      const row = mountRow(host, f, ctx, {
        get: () => value[f.key],
        set: (v) => {
          value[f.key] = v;
          if (opts.onChange) opts.onChange([f.key], v, { field: f, value });
          for (const r of rows) r.update(value);        // `when` conditions react live
        },
        problems: () => (opts.problems ? opts.problems(f) : []),
      });
      rows.push(row);
    }
    form.refresh(value);
    return form;
  };

  /** One labelled row: the label, the reset control, the widget, the doc line. */
  function mountRow(host, f, ctx, io) {
    const row = make('div.ed-f');
    row.dataset.key = f.key;
    const head = make('div.ed-f-head');
    const label = make('span.ed-f-label', { text: f.label || titleCase(f.key) });
    head.appendChild(label);
    const reset = btn('↺', `Back to the default (${describeDefault(f, ctx)})`, () => io.set(INS.defaultFor(f, ctx)), 'ed-f-reset');
    head.appendChild(reset);
    row.appendChild(head);
    const body = make('div.ed-f-body');
    row.appendChild(body);
    if (f.doc) row.appendChild(make('div.ed-hint', { text: f.doc }));
    const errBox = make('div.ed-f-err');
    row.appendChild(errBox);
    host.appendChild(row);

    const def = INS.editorFor(f);
    let widget = null;
    try {
      widget = def && def.mount ? def.mount(body, f, io.get(), (v) => io.set(v), ctx) : null;
    } catch (e) {
      (KIT.log || console).error(`[inspector ${f.key}]`, e);
      body.textContent = `This field could not be shown: ${e.message}`;
    }
    if (def && def.inline) { row.classList.add('is-inline'); head.appendChild(body); }
    return {
      el: row,
      update(all) {
        const visible = S.visible(f, all);
        row.hidden = !visible;
        if (!visible) return;
        const v = io.get();
        if (widget && widget.set) { try { widget.set(v); } catch (e) { /* a widget must never break the form */ } }
        const known = INS.hasDefault(f, ctx);
        const isDef = known && INS.isDefault(f, v, ctx);
        row.classList.toggle('is-inherited', isDef);
        reset.hidden = isDef || !known;
        const errs = (io.problems ? io.problems() : []) || [];
        clear(errBox);
        for (const p of errs) errBox.appendChild(make('div.ed-problem' + (p.severity === 'warn' ? '.warn' : ''), { text: p.message }));
      },
      destroy() { if (widget && widget.destroy) widget.destroy(); },
    };
  }
  function describeDefault(f, ctx) {
    const d = INS.defaultFor(f, ctx);
    if (d === null || d === undefined) return 'empty';
    if (typeof d === 'object') return Array.isArray(d) && !d.length ? 'empty' : 'the type default';
    return String(d);
  }

  /** field(el, field, value, onChange, ctx) — one widget with no label, for compact rows. */
  INS.field = function (el, field, value, onChange, ctx) {
    const f = S.field(field);
    const def = INS.editorFor(f);
    if (!def || !def.mount) return null;
    return def.mount(el, f, value, onChange, ctx || {});
  };

  // =================================================================================
  // The widgets
  // =================================================================================
  const FE = KIT.registry('fieldEditors');

  // ---- text ------------------------------------------------------------------------
  FE.add({
    // 'label' is here too: in content it is always plain text. The other kind
    // of label — a function of the game — only ever appears in a registry
    // definition, which is code, and code is not edited through a form.
    id: 'string', types: ['string', 'label'],
    mount(el, f, value, onChange) {
      const input = make('input');
      input.type = 'text';
      input.value = value == null || typeof value === 'function' ? '' : String(value);
      if (f.placeholder) input.placeholder = f.placeholder;
      const t = typed(onChange);
      input.oninput = () => t.push(input.value);
      input.onblur = () => t.flush();
      el.appendChild(input);
      return { set(v) { const s = v == null ? '' : String(v); if (document.activeElement !== input && input.value !== s) input.value = s; } };
    },
  });

  /**
   * Typing writes to the document, but one undo step per keystroke is horrible.
   * Text widgets push through this: it waits for a pause (or a blur) and then commits.
   */
  function typed(onChange, ms) {
    let timer = null, pending;
    const fire = () => { timer = null; onChange(pending); };
    return {
      push(v) { pending = v; if (timer) clearTimeout(timer); timer = setTimeout(fire, ms || 400); },
      flush() { if (timer) { clearTimeout(timer); fire(); } },
    };
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(320, Math.max(64, ta.scrollHeight + 2)) + 'px';
  }
  FE.add({
    id: 'text', types: ['text'],
    mount(el, f, value, onChange, ctx) {
      const ta = make('textarea.ed-grow');
      ta.rows = 2;
      ta.value = value == null ? '' : String(value);
      const preview = make('div.ed-preview');
      const draw = () => {
        clear(preview);
        const str = ta.value;
        if (!str.trim()) { preview.hidden = true; return; }
        preview.hidden = false;
        let pages = [[]];
        try {
          const out = KIT.text.render(str, { project: ctx && ctx.project }, { width: 28, lines: 3, measure: (s) => s.length });
          pages = (out[0] && out[0].pages) || [[]];
        } catch (e) { pages = [[[{ type: 'text', text: str }]]]; }
        pages.forEach((page, i) => {
          const box = make('div.ed-preview-box');
          for (const line of page) box.appendChild(make('div.ed-preview-line', { text: line.map(sp => (sp.type === 'text' ? sp.text : (sp.type === 'icon' ? '◆' : ''))).join('') || ' ' }));
          if (pages.length > 1) box.appendChild(make('div.ed-preview-page', { text: `▼ ${i + 1}/${pages.length}` }));
          preview.appendChild(box);
        });
      };
      const t = typed(onChange);
      ta.oninput = () => { autoGrow(ta); draw(); t.push(ta.value); };
      ta.onblur = () => t.flush();
      el.appendChild(ta);
      el.appendChild(make('div.ed-hint', { text: 'How the message box will break it:' }));
      el.appendChild(preview);
      setTimeout(() => autoGrow(ta), 0);
      draw();
      return { set(v) { const s = v == null ? '' : String(v); if (document.activeElement !== ta && ta.value !== s) { ta.value = s; autoGrow(ta); draw(); } } };
    },
  });

  FE.add({
    id: 'note', types: ['note'],
    mount(el, f, value, onChange) {
      const ta = make('textarea.ed-note');
      ta.rows = 2;
      ta.placeholder = 'Notes to yourself — never shown in the game';
      ta.value = value == null ? '' : String(value);
      const t = typed(onChange);
      ta.oninput = () => { autoGrow(ta); t.push(ta.value); };
      ta.onblur = () => t.flush();
      el.appendChild(ta);
      setTimeout(() => autoGrow(ta), 0);
      return { set(v) { const s = v == null ? '' : String(v); if (document.activeElement !== ta && ta.value !== s) { ta.value = s; autoGrow(ta); } } };
    },
  });

  // ---- number ----------------------------------------------------------------------
  FE.add({
    id: 'number', types: ['number'],
    mount(el, f, value, onChange) {
      const wrap = make('div.ed-step');
      const input = make('input');
      input.type = 'number';
      input.inputMode = f.integer ? 'numeric' : 'decimal';
      if (f.min != null) input.min = f.min;
      if (f.max != null) input.max = f.max;
      input.value = value == null ? '' : String(value);
      const clampV = (n) => {
        let v = Number(n);
        if (!Number.isFinite(v)) v = INS.defaultFor(f, {}) || 0;
        if (f.integer) v = Math.round(v);
        if (f.min != null) v = Math.max(f.min, v);
        if (f.max != null) v = Math.min(f.max, v);
        return v;
      };
      const step = (d) => { const v = clampV((Number(input.value) || 0) + d); input.value = String(v); onChange(v); };
      wrap.appendChild(btn('−', 'Less', () => step(-(f.step || 1))));
      wrap.appendChild(input);
      wrap.appendChild(btn('+', 'More', () => step(f.step || 1)));
      input.oninput = () => { const n = Number(input.value); if (input.value !== '' && Number.isFinite(n)) onChange(f.integer ? Math.round(n) : n); };
      input.onblur = () => { const v = clampV(input.value); input.value = String(v); onChange(v); };
      el.appendChild(wrap);
      if (f.min != null && f.max != null) el.appendChild(make('div.ed-sub', { text: `${f.min} to ${f.max}` }));
      return { set(v) { const s = v == null ? '' : String(v); if (document.activeElement !== input && input.value !== s) input.value = s; } };
    },
  });

  // ---- bool ------------------------------------------------------------------------
  FE.add({
    id: 'bool', types: ['bool'], inline: true,
    mount(el, f, value, onChange) {
      const b = make('button.ed-switch');
      b.type = 'button';
      let on = !!value;
      const paint = () => { b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'On' : 'Off'; };
      b.onclick = () => { on = !on; paint(); onChange(on); };
      paint();
      el.appendChild(b);
      return { set(v) { on = !!v; paint(); } };
    },
  });

  // ---- enum ------------------------------------------------------------------------
  FE.add({
    id: 'enum', types: ['enum'],
    mount(el, f, value, onChange, ctx) {
      const opts = INS.enumOptions(f, ctx);
      let cur = value;
      if (opts.length && opts.length <= 4) {
        const seg = make('div.ed-seg');
        const buttons = opts.map(o => {
          const b = make('button', { text: o.label });
          b.type = 'button';
          b.onclick = () => { cur = o.value; onChange(o.value); paint(); };
          seg.appendChild(b);
          return b;
        });
        const paint = () => buttons.forEach((b, i) => b.setAttribute('aria-selected', String(opts[i].value === cur)));
        paint();
        el.appendChild(seg);
        return { set(v) { cur = v; paint(); } };
      }
      const sel = make('select');
      for (const o of opts) { const op = make('option', { text: o.label }); op.value = o.value; sel.appendChild(op); }
      sel.value = value == null ? '' : String(value);
      sel.onchange = () => onChange(sel.value);
      el.appendChild(sel);
      return { set(v) { if (sel.value !== String(v)) sel.value = v == null ? '' : String(v); } };
    },
  });

  // ---- colour ----------------------------------------------------------------------
  FE.add({
    id: 'color', types: ['color'],
    mount(el, f, value, onChange) {
      const row = make('div.ed-row');
      const swatch = make('input.ed-color');
      swatch.type = 'color';
      swatch.value = /^#[0-9a-f]{6}$/i.test(String(value)) ? value : '#000000';
      const hex = make('input.ed-hex');
      hex.type = 'text';
      hex.value = value == null ? '' : String(value);
      swatch.oninput = () => { hex.value = swatch.value; onChange(swatch.value); };
      hex.oninput = () => { if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.value)) { swatch.value = hex.value.length === 4 ? '#' + hex.value.slice(1).split('').map(c => c + c).join('') : hex.value; onChange(hex.value); } };
      row.appendChild(swatch); row.appendChild(hex);
      el.appendChild(row);
      return { set(v) { if (document.activeElement !== hex) hex.value = v == null ? '' : String(v); if (/^#[0-9a-f]{6}$/i.test(String(v))) swatch.value = v; } };
    },
  });

  // ---- direction -------------------------------------------------------------------
  const DIR_ARROW = { up: '↑', down: '↓', left: '←', right: '→' };
  FE.add({
    id: 'direction', types: ['direction'],
    mount(el, f, value, onChange) {
      const pad = make('div.ed-dpad');
      let cur = value || 'down';
      const buttons = {};
      for (const d of ['up', 'left', 'right', 'down']) {
        const b = make('button', { text: DIR_ARROW[d] });
        b.type = 'button';
        b.title = titleCase(d);
        b.dataset.dir = d;
        b.onclick = () => { cur = d; onChange(d); paint(); };
        buttons[d] = b;
        pad.appendChild(b);
      }
      const paint = () => { for (const d of Object.keys(buttons)) buttons[d].setAttribute('aria-selected', String(d === cur)); };
      paint();
      el.appendChild(pad);
      return { set(v) { cur = v || 'down'; paint(); } };
    },
  });

  // ---- region ----------------------------------------------------------------------
  FE.add({
    id: 'region', types: ['region'],
    mount(el, f, value, onChange) {
      let cur = Number(value) | 0;
      const row = make('div.ed-row');
      const input = make('input.ed-region-n');
      input.type = 'number'; input.inputMode = 'numeric'; input.min = 0; input.max = 255;
      input.value = String(cur);
      const chip = make('span.ed-region-chip');
      const paint = () => {
        chip.style.background = INS.regionColor(cur);
        chip.textContent = cur ? String(cur) : 'none';
        for (const b of grid.querySelectorAll('.ed-swatch')) b.setAttribute('aria-selected', String(Number(b.dataset.region) === cur));
        if (document.activeElement !== input) input.value = String(cur);
      };
      input.oninput = () => { cur = KIT.clamp(Number(input.value) | 0, 0, 255); onChange(cur); paint(); };
      row.appendChild(input); row.appendChild(chip);
      el.appendChild(row);
      const grid = make('div.ed-swatches.ed-regions');
      for (let n = 0; n <= 16; n++) {
        const b = make('button.ed-swatch', { text: n ? String(n) : '·' });
        b.type = 'button';
        b.dataset.region = n;
        b.style.background = INS.regionColor(n);
        b.onclick = () => { cur = n; onChange(n); paint(); };
        grid.appendChild(b);
      }
      el.appendChild(grid);
      el.appendChild(make('div.ed-hint', { text: 'Regions 0-255. Paint them on the map with the Regions layer.' }));
      paint();
      return { set(v) { cur = Number(v) | 0; paint(); } };
    },
  });

  // ---- position --------------------------------------------------------------------
  FE.add({
    id: 'position', types: ['position'],
    mount(el, f, value, onChange, ctx) {
      let cur = KIT.isObject(value) ? Object.assign({}, value) : { x: 0, y: 0 };
      const wantsMap = f.display === 'link' || (KIT.isObject(value) && 'map' in value) || (KIT.isObject(f.default) && 'map' in f.default);
      const row = make('div.ed-row.ed-pos');
      let mapSel = null;
      if (wantsMap) {
        mapSel = make('select.ed-pos-map');
        const none = make('option', { text: '(this map)' }); none.value = '';
        mapSel.appendChild(none);
        const maps = (ctx.project && ctx.project.maps) || {};
        for (const id of Object.keys(maps)) { const o = make('option', { text: maps[id].name || id }); o.value = id; mapSel.appendChild(o); }
        mapSel.onchange = () => { cur = Object.assign({}, cur, { map: mapSel.value || null }); onChange(Object.assign({}, cur)); };
        row.appendChild(mapSel);
      }
      const nx = make('input.ed-pos-n'), ny = make('input.ed-pos-n');
      for (const [inp, key] of [[nx, 'x'], [ny, 'y']]) {
        inp.type = 'number'; inp.inputMode = 'numeric'; inp.min = 0;
        inp.title = key.toUpperCase();
        inp.oninput = () => { cur = Object.assign({}, cur, { [key]: Number(inp.value) | 0 }); onChange(Object.assign({}, cur)); };
      }
      row.appendChild(make('span.ed-sub', { text: 'x' })); row.appendChild(nx);
      row.appendChild(make('span.ed-sub', { text: 'y' })); row.appendChild(ny);
      el.appendChild(row);
      const pick = btn('✛ Pick on the map', 'Tap the map to set this position', () => {
        if (INS.isPicking()) { INS.stopPicking(false); return; }
        pick.classList.add('is-picking');
        pick.textContent = 'Tap the map… (cancel)';
        INS.pickOnMap({
          hint: `Tap the map to set ${f.label || titleCase(f.key)}`,
          onPick(p) {
            cur = Object.assign({}, cur, wantsMap ? { map: p.map, x: p.x, y: p.y } : { x: p.x, y: p.y });
            done();
            onChange(Object.assign({}, cur));
            paint();
          },
          onCancel: done,
        });
        function done() { pick.classList.remove('is-picking'); pick.textContent = '✛ Pick on the map'; }
      }, 'wide');
      el.appendChild(pick);
      const paint = () => {
        if (document.activeElement !== nx) nx.value = String(cur.x | 0);
        if (document.activeElement !== ny) ny.value = String(cur.y | 0);
        if (mapSel) mapSel.value = cur.map || '';
      };
      paint();
      return { set(v) { cur = KIT.isObject(v) ? Object.assign({}, v) : { x: 0, y: 0 }; paint(); } };
    },
  });

  // ---- references ------------------------------------------------------------------
  const ART_KINDS = { sprite: INS.spriteCanvas, tile: INS.tileCanvas };
  FE.add({
    id: 'ref', types: ['ref:*', 'tile', 'face'],
    mount(el, f, value, onChange, ctx) {
      const kind = f.type === 'tile' ? 'tile' : f.type === 'face' ? 'face' : refKind(f);
      let cur = value == null ? '' : String(value);
      const list = INS.refList(kind, ctx);
      const wrap = make('div.ed-ref');
      const art = ART_KINDS[kind];
      let grid = null, sel = null;

      if (art && list.length && list.length <= 80) {
        grid = make('div.ed-swatches');
        if (f.nullable !== false) grid.appendChild(refSwatch('', '(none)', null));
        for (const o of list) grid.appendChild(refSwatch(o.id, o.label, art));
        wrap.appendChild(grid);
      } else {
        sel = make('select');
        if (f.nullable !== false) { const o = make('option', { text: '(none)' }); o.value = ''; sel.appendChild(o); }
        for (const o of list) { const op = make('option', { text: `${o.label}` }); op.value = o.id; sel.appendChild(op); }
        sel.onchange = () => { cur = sel.value; onChange(cur || null); paint(); };
        wrap.appendChild(sel);
      }
      function refSwatch(id, label, drawer) {
        const b = make('button.ed-swatch');
        b.type = 'button';
        b.title = id ? `${label} (${id})` : label;
        b.dataset.ref = id;
        if (id && drawer) b.appendChild(drawer(id, 2));
        else b.appendChild(make('span.ed-swatch-none', { text: id ? label : '—' }));
        b.onclick = () => { cur = id; onChange(id || null); paint(); };
        return b;
      }

      // a free-typed id (the Twine move: name it now, make it later)
      const compact = !!(ctx && ctx.compact);
      const canMake = INS.canCreateRef(kind);      // art comes from files; vars/items/scripts/maps can be named now and made later
      const newRow = make('div.ed-row.ed-ref-new');
      const idInput = make('input');
      idInput.type = 'text';
      idInput.placeholder = `new ${kind} id`;
      idInput.oninput = () => paintNew();
      const useBtn = btn('Use', `Point at this ${kind}`, () => { cur = KIT.slug(idInput.value); onChange(cur || null); idInput.value = ''; newRow.hidden = compact; paint(); });
      newRow.appendChild(idInput);
      newRow.appendChild(useBtn);
      if (canMake && compact) {
        newRow.hidden = true;
        const toggle = btn('＋ New…', `Point at a ${kind} that does not exist yet`, () => { newRow.hidden = !newRow.hidden; if (!newRow.hidden) idInput.focus(); }, 'tiny');
        wrap.appendChild(toggle);
      }
      if (canMake) wrap.appendChild(newRow);

      const status = make('div.ed-ref-status');
      wrap.appendChild(status);
      el.appendChild(wrap);

      function paintNew() { useBtn.disabled = !idInput.value.trim(); }
      function paint() {
        if (sel) {
          if (cur && !Array.prototype.some.call(sel.options, o => o.value === cur)) {
            const o = make('option', { text: `${cur} (new)` });
            o.value = cur;
            sel.appendChild(o);
          }
          sel.value = cur;
        }
        if (grid) for (const b of grid.querySelectorAll('.ed-swatch')) {
          const on = (b.dataset.ref || '') === cur;
          b.setAttribute('aria-selected', String(on));
          // keep the chosen one in view without scrolling the whole panel
          if (on && grid.scrollHeight > grid.clientHeight) grid.scrollTop = Math.max(0, b.offsetTop - grid.clientHeight / 2 + b.offsetHeight / 2);
        }
        clear(status);
        if (!cur) { if (!compact) status.appendChild(make('span.ed-sub', { text: 'Nothing chosen yet.' })); paintNew(); return; }
        if (INS.refMissing(kind, cur, ctx)) {
          status.appendChild(make('span.ed-badge.warn', { text: `No ${kind} “${cur}” yet` }));
          if (INS.canCreateRef(kind)) {
            status.appendChild(btn(`＋ Create ${kind} “${cur}”`, 'Make it now and fill it in later', () => {
              const made = INS.createRef(kind, cur);
              if (made) { cur = made; onChange(cur); }
              paint();
            }, 'primary'));
          }
        } else if (!compact) {
          status.appendChild(make('span.ed-badge', { text: INS.refLabel(kind, cur, ctx) }));
          status.appendChild(make('span.ed-sub', { text: cur }));
        }
        paintNew();
      }
      paint();
      return { set(v) { cur = v == null ? '' : String(v); paint(); } };
    },
  });

  // ---- route -----------------------------------------------------------------------
  FE.add({
    id: 'route', types: ['route'],
    mount(el, f, value, onChange, ctx) {
      let steps = Array.isArray(value) ? value.slice() : [];
      const listEl = make('div.ed-list.ed-route');
      const summary = make('div.ed-hint.ed-route-say');
      const chips = make('div.ed-chips');
      const push = (verb) => { steps = steps.concat([verb]); commit(); };
      for (const v of INS.ROUTE_VERBS) {
        const c = make('button.ed-chip', { text: v.label });
        c.type = 'button';
        c.title = INS.routeStepLabel(v.verb);
        c.onclick = () => push(v.verb);
        chips.appendChild(c);
      }
      const commit = () => { onChange(steps.slice()); paint(); };
      function paint() {
        clear(listEl);
        steps.forEach((step, i) => {
          const row = make('div.ed-item.ed-route-step');
          const n = make('span.ed-sub', { text: String(i + 1) });
          const inp = make('input.ed-route-text');
          inp.type = 'text';
          inp.value = step;
          inp.title = 'The step, as the engine reads it';
          inp.oninput = () => { steps[i] = inp.value; onChange(steps.slice()); say(); };
          const up = btn('▲', 'Earlier', () => { if (i > 0) { const s = steps.splice(i, 1)[0]; steps.splice(i - 1, 0, s); commit(); } });
          const down = btn('▼', 'Later', () => { if (i < steps.length - 1) { const s = steps.splice(i, 1)[0]; steps.splice(i + 1, 0, s); commit(); } });
          const del = btn('✕', 'Remove this step', () => { steps.splice(i, 1); commit(); });
          up.disabled = i === 0; down.disabled = i === steps.length - 1;
          row.appendChild(n); row.appendChild(inp); row.appendChild(up); row.appendChild(down); row.appendChild(del);
          listEl.appendChild(row);
        });
        if (!steps.length) listEl.appendChild(make('div.ed-sub', { text: 'No steps yet — tap one below.' }));
        say();
      }
      function say() { summary.textContent = INS.routeSummary(steps, { repeat: ctx && ctx.routeRepeat }); }
      el.appendChild(listEl);
      el.appendChild(summary);
      el.appendChild(chips);
      paint();
      return { set(v) { const next = Array.isArray(v) ? v.slice() : []; if (!KIT.deepEqual(next, steps)) { steps = next; paint(); } } };
    },
  });

  // ---- condition -------------------------------------------------------------------
  FE.add({
    id: 'condition', types: ['condition'],
    mount(el, f, value, onChange, ctx) {
      let cond = value === undefined ? null : value;
      const box = make('div.ed-cond');
      const tree = make('div.ed-cond-tree');
      const textRow = make('div.ed-cond-text');
      const textIn = make('input');
      textIn.type = 'text';
      textIn.spellcheck = false;
      textIn.title = 'The same condition as text: chapter >= 2 and not item.berry >= 1';
      const err = make('div.ed-problem.warn');
      err.hidden = true;
      textIn.oninput = () => {
        const r = INS.conditionFromText(textIn.value);
        if (!r.ok) { err.hidden = false; err.textContent = r.error; return; }
        err.hidden = true;
        cond = r.cond;
        onChange(cond);
        paintTree();
      };
      textRow.appendChild(make('span.ed-sub', { text: 'as text' }));
      textRow.appendChild(textIn);
      box.appendChild(tree);
      box.appendChild(textRow);
      box.appendChild(err);
      el.appendChild(box);

      const set = (next) => { cond = next; onChange(cond); paint(); };
      function paint() { paintTree(); paintText(); }
      function paintText() { if (document.activeElement !== textIn) textIn.value = INS.conditionText(cond); err.hidden = true; }
      function paintTree() { clear(tree); tree.appendChild(condNode(cond, set, ctx, 0)); }
      paint();
      return { set(v) { const next = v === undefined ? null : v; if (!KIT.deepEqual(next, cond)) { cond = next; paint(); } } };
    },
  });

  /** One condition row (and its children for all/any/not). */
  function condNode(cond, setCond, ctx, depth) {
    const wrap = make('div.ed-cond-node');
    if (depth) wrap.classList.add('is-nested');
    if (cond == null) {
      const row = make('div.ed-row');
      row.appendChild(make('span.ed-badge', { text: 'always' }));
      row.appendChild(addButton('＋ Add a condition', (kind) => setCond(INS.newCondition(kind))));
      wrap.appendChild(row);
      return wrap;
    }
    const def = KIT.registry('conditions').get(cond.kind);
    const head = make('div.ed-row.ed-cond-head');
    const kindSel = make('select.ed-cond-kind');
    for (const d of INS.conditionKinds()) { const o = make('option', { text: KIT.labelOf(d, null, titleCase(d.id)) }); o.value = d.id; kindSel.appendChild(o); }
    kindSel.value = cond.kind;
    kindSel.onchange = () => {
      const next = INS.newCondition(kindSel.value);
      if (next && (kindSel.value === 'not') && cond) next.of = cond;
      if (next && (kindSel.value === 'all' || kindSel.value === 'any') && cond) next.of = [cond];
      setCond(next);
    };
    head.appendChild(kindSel);
    head.appendChild(btn('✕', 'Remove this condition', () => setCond(null)));
    wrap.appendChild(head);

    if (!def) { wrap.appendChild(make('div.ed-problem', { text: `Unknown condition “${cond.kind}”` })); return wrap; }

    if (cond.kind === 'all' || cond.kind === 'any') {
      const kids = make('div.ed-cond-kids');
      const of = Array.isArray(cond.of) ? cond.of : [];
      of.forEach((child, i) => {
        if (i) kids.appendChild(make('div.ed-cond-join', { text: cond.kind === 'all' ? 'and' : 'or' }));
        kids.appendChild(condNode(child, (next) => {
          const list = of.slice();
          if (next == null) list.splice(i, 1); else list[i] = next;
          setCond(Object.assign({}, cond, { of: list }));
        }, ctx, depth + 1));
      });
      kids.appendChild(addButton(cond.kind === 'all' ? '＋ and…' : '＋ or…', (kind) => setCond(Object.assign({}, cond, { of: of.concat([INS.newCondition(kind)]) }))));
      wrap.appendChild(kids);
      return wrap;
    }
    if (cond.kind === 'not') {
      const kids = make('div.ed-cond-kids');
      kids.appendChild(condNode(cond.of || null, (next) => setCond(Object.assign({}, cond, { of: next })), ctx, depth + 1));
      wrap.appendChild(kids);
      return wrap;
    }
    const fieldsRow = make('div.ed-cond-fields');
    for (const fd of S.fields(def.fields || [])) {
      const cell = make('div.ed-cond-cell');
      cell.appendChild(make('span.ed-sub', { text: fd.label || titleCase(fd.key) }));
      const body = make('div');
      cell.appendChild(body);
      const value = cond[fd.key] === undefined ? S.defaultFor(fd, ctx) : cond[fd.key];
      INS.field(body, fd, value, (v) => setCond(Object.assign({}, cond, { [fd.key]: v })), Object.assign({}, ctx, { compact: true }));
      fieldsRow.appendChild(cell);
    }
    wrap.appendChild(fieldsRow);
    wrap.appendChild(make('div.ed-sub.ed-cond-says', { text: INS.conditionSays(cond, ctx) }));
    return wrap;
  }
  function addButton(label, onPick) {
    const wrap = make('span.ed-add-cond');
    const b = btn(label, 'Add a condition', () => { menu.hidden = !menu.hidden; });
    const menu = make('div.ed-add-menu');
    menu.hidden = true;
    for (const d of INS.conditionKinds()) {
      const item = btn(KIT.labelOf(d, null, titleCase(d.id)), d.doc || '', () => { menu.hidden = true; onPick(d.id); });
      menu.appendChild(item);
    }
    wrap.appendChild(b); wrap.appendChild(menu);
    return wrap;
  }

  // ---- scalar ----------------------------------------------------------------------
  FE.add({
    id: 'scalar', types: ['scalar'],
    mount(el, f, value, onChange, ctx) {
      const input = make('input');
      input.type = 'text';
      input.value = INS.scalarText(value === undefined ? '' : value);
      input.title = 'A number, true/false, or text';
      input.oninput = () => onChange(INS.parseScalar(input.value));
      el.appendChild(input);
      if (ctx && ctx.compact) return { set(v) { const s = INS.scalarText(v === undefined ? '' : v); if (document.activeElement !== input && input.value !== s) input.value = s; } };
      const quick = make('div.ed-chips');
      for (const v of [true, false, 0, 1]) {
        const c = make('button.ed-chip', { text: String(v) });
        c.type = 'button';
        c.onclick = () => { input.value = String(v); onChange(v); };
        quick.appendChild(c);
      }
      el.appendChild(quick);
      return { set(v) { const s = INS.scalarText(v === undefined ? '' : v); if (document.activeElement !== input && input.value !== s) input.value = s; } };
    },
  });

  // ---- list ------------------------------------------------------------------------
  FE.add({
    id: 'list', types: ['list'],
    mount(el, f, value, onChange, ctx) {
      let items = Array.isArray(value) ? value.slice() : [];
      const listEl = make('div.ed-list');
      const commit = () => { onChange(items.slice()); paint(); };
      function paint() {
        clear(listEl);
        items.forEach((item, i) => {
          const row = make('div.ed-item.ed-list-row');
          const body = make('div.ed-list-body');
          row.appendChild(body);
          const of = f.of || { key: 'item', type: 'string' };
          INS.field(body, of, item, (v) => { items[i] = v; onChange(items.slice()); }, ctx);
          const up = btn('▲', 'Move up', () => { if (i > 0) { const s = items.splice(i, 1)[0]; items.splice(i - 1, 0, s); commit(); } });
          const down = btn('▼', 'Move down', () => { if (i < items.length - 1) { const s = items.splice(i, 1)[0]; items.splice(i + 1, 0, s); commit(); } });
          const del = btn('✕', 'Remove', () => { items.splice(i, 1); commit(); });
          up.disabled = i === 0; down.disabled = i === items.length - 1;
          row.appendChild(up); row.appendChild(down); row.appendChild(del);
          listEl.appendChild(row);
        });
        if (!items.length) listEl.appendChild(make('div.ed-sub', { text: 'Empty.' }));
      }
      el.appendChild(listEl);
      el.appendChild(btn('＋ Add', 'Add a row', () => { items = items.concat([S.defaultFor(f.of || { key: 'item', type: 'string' }, ctx)]); commit(); }));
      paint();
      return { set(v) { const next = Array.isArray(v) ? v.slice() : []; if (!KIT.deepEqual(next, items)) { items = next; paint(); } } };
    },
  });

  // ---- group -----------------------------------------------------------------------
  FE.add({
    id: 'group', types: ['group'],
    mount(el, f, value, onChange, ctx) {
      const set = make('fieldset.ed-fieldset');
      set.appendChild(make('legend', { text: f.label || titleCase(f.key) }));
      const body = make('div');
      set.appendChild(body);
      el.appendChild(set);
      let cur = KIT.isObject(value) ? value : {};
      const form = INS.mount(body, {
        fields: f.fields || [], value: cur, ctx,
        onChange(path, v) {
          cur = Object.assign({}, cur);
          let target = cur;
          for (let i = 0; i < path.length - 1; i++) target = target[path[i]];
          target[path[path.length - 1]] = v;
          onChange(Object.assign({}, cur));
        },
      });
      return { set(v) { cur = KIT.isObject(v) ? v : {}; form.refresh(cur); }, destroy() { form.destroy(); } };
    },
  });

  // ---- strings (key/value rows) -------------------------------------------------------
  FE.add({
    id: 'strings', types: ['strings'],
    mount(el, f, value, onChange) {
      let table = KIT.isObject(value) ? Object.assign({}, value) : {};
      const listEl = make('div.ed-list');
      const commit = () => { onChange(Object.assign({}, table)); paint(); };
      function paint() {
        clear(listEl);
        const keys = Object.keys(table);
        for (const k of keys) {
          const row = make('div.ed-item.ed-kv');
          const key = make('input.ed-kv-key');
          key.type = 'text'; key.value = k;
          key.onchange = () => {
            const nk = key.value.trim();
            if (!nk || nk === k) { key.value = k; return; }
            const next = {};
            for (const kk of Object.keys(table)) next[kk === k ? nk : kk] = table[kk];
            table = next; commit();
          };
          const val = make('input.ed-kv-val');
          val.type = 'text'; val.value = table[k] == null ? '' : String(table[k]);
          val.oninput = () => { table[k] = val.value; onChange(Object.assign({}, table)); };
          const del = btn('✕', 'Remove', () => { delete table[k]; commit(); });
          row.appendChild(key); row.appendChild(val); row.appendChild(del);
          listEl.appendChild(row);
        }
        if (!keys.length) listEl.appendChild(make('div.ed-sub', { text: 'Nothing overridden — the defaults are used.' }));
      }
      el.appendChild(listEl);
      const addRow = make('div.ed-row');
      const nk = make('input');
      nk.type = 'text'; nk.placeholder = 'key';
      addRow.appendChild(nk);
      addRow.appendChild(btn('＋ Add', 'Add a key', () => { const k = nk.value.trim(); if (!k) return; table[k] = ''; nk.value = ''; commit(); }));
      el.appendChild(addRow);
      paint();
      return { set(v) { const next = KIT.isObject(v) ? Object.assign({}, v) : {}; if (!KIT.deepEqual(next, table)) { table = next; paint(); } } };
    },
  });

  // ---- script ----------------------------------------------------------------------
  /** scriptSummary(commands) -> the first line, the way the Events panel shows a slot. */
  INS.scriptSummary = function (cmds, ctx) {
    const list = Array.isArray(cmds) ? cmds : [];
    if (!list.length) return 'empty';
    let first = '';
    try { first = KIT.commands.summary(list[0], ctx || {}); } catch (e) { first = list[0].t || '?'; }
    return list.length > 1 ? `${first}  +${list.length - 1} more` : first;
  };
  /** openScript(ref) — hands over to the script editor when it exists; the selection is the contract. */
  INS.openScript = function (ref) {
    if (ref && ref.selection && ED.select) ED.select(ref.selection);
    const SE = ED.scriptEditor;
    if (SE && typeof SE.open === 'function') { SE.open(ref); return true; }
    const panels = KIT.registry('editorPanels');
    for (const id of ['script', 'scripts', 'writing']) if (panels.get(id)) { ED.set({ panel: id }); return true; }
    if (ED.toast) ED.toast('The script editor is not loaded yet');
    return false;
  };
  FE.add({
    id: 'script', types: ['script'],
    mount(el, f, value, onChange, ctx) {
      const row = make('div.ed-row.ed-script-slot');
      const sum = make('span.ed-slot-sum');
      row.appendChild(sum);
      const open = btn('Open ✎', 'Open this in the script editor', () => INS.openScript({ path: ctx && ctx.scriptPath, selection: ctx && ctx.scriptSelection, label: f.label, commands: value }));
      row.appendChild(open);
      el.appendChild(row);
      const paint = (v) => { sum.textContent = INS.scriptSummary(v, ctx); sum.classList.toggle('is-empty', !(v || []).length); };
      paint(value);
      return { set: paint };
    },
  });

  // ---- last resort ------------------------------------------------------------------
  FE.add({
    id: 'unknown', types: [],
    mount(el, f, value, onChange) {
      const ta = make('textarea.ed-note');
      ta.rows = 2;
      ta.value = JSON.stringify(value === undefined ? null : value);
      ta.oninput = () => { try { onChange(JSON.parse(ta.value)); ta.classList.remove('is-bad'); } catch (e) { ta.classList.add('is-bad'); } };
      el.appendChild(ta);
      el.appendChild(make('div.ed-hint', { text: `No widget for “${f.type}” yet — this is the raw value.` }));
      return { set(v) { const s = JSON.stringify(v === undefined ? null : v); if (document.activeElement !== ta && ta.value !== s) ta.value = s; } };
    },
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
