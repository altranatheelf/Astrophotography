// Schema: typed field declarations. One declaration drives the editor form,
// validation, defaults, reference tracking ("where is this used?") and
// map display hints. Types are a registry of handlers so later files
// (commands, conditions) can install richer handlers for 'script'/'condition'.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const S = KIT.schema = KIT.schema || {};
  S.types = S.types || {};
  S.refKinds = S.refKinds || {};

  const DIRS = ['up', 'down', 'left', 'right'];
  const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const err = (errors, path, message, code) => { errors.push({ path: path.slice(), message, code: code || 'invalid' }); };

  /**
   * Normalise a field declaration (fills label, nullable default, etc.).
   *
   * Memoised on the declaration object. A field list is static — it is the
   * schema — but every validate, fill, refs and walk normalised it again, per
   * command, per page, per object: two regexes and three copies to rebuild a
   * label that had not changed. Profiled at 100 maps and 1,500 events, this one
   * function was 48% of validating the project, and validation runs at boot and
   * 250ms after every edit in Creator Mode. The normalised form is treated as
   * read-only by every caller (none mutates it), which is what makes sharing it
   * safe; a declaration that is REPLACED gets a new key for free, and one that
   * is edited in place after first use would keep its old label — nothing does
   * that, and it would be the wrong way to change a schema anyway.
   */
  const normalised = new WeakMap();      // declaration -> its normalised form
  const normalisedLists = new WeakMap(); // declaration list -> the normalised list
  S.field = function (f) {
    if (!f || typeof f.key !== 'string') throw new Error('schema field needs a key');
    if (!f.type) throw new Error(`schema field '${f.key}' needs a type`);
    const hit = normalised.get(f);
    if (hit) return hit;
    const out = Object.assign({}, f);
    if (out.label == null) out.label = f.key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^\w/, c => c.toUpperCase());
    if (out.nullable == null) out.nullable = out.type.startsWith('ref:') || out.type === 'condition' || out.type === 'face' ? true : false;
    if (out.of) out.of = S.field(Object.assign({ key: 'item' }, out.of));
    if (out.fields) out.fields = S.fields(out.fields);
    normalised.set(f, out);
    normalised.set(out, out);        // normalising twice is a lookup, not a copy: the
    return out;                      // single-field entry points are handed `f.of` and friends
  };
  S.fields = (fields) => {
    if (!fields) return [];
    let list = normalisedLists.get(fields);
    if (!list) { list = fields.map(S.field); normalisedLists.set(fields, list); }
    return list;
  };

  /** Is a field visible/active given its sibling values? (`when: { field, eq|neq|in }`) */
  S.visible = function (field, siblings) {
    const w = field.when;
    if (!w) return true;
    const v = siblings ? siblings[w.field] : undefined;
    if ('eq' in w) return v === w.eq;
    if ('neq' in w) return v !== w.neq;
    if ('in' in w) return Array.isArray(w.in) && w.in.includes(v);
    if ('truthy' in w) return !!v === !!w.truthy;
    return true;
  };

  /** Register a type handler: { validate(field, v, ctx, path, errors), default(field, ctx), refs(field, v, ctx, path, out), fill(field, v, ctx) } */
  S.defineType = function (name, handler) { S.types[name] = Object.assign({}, S.types[name] || {}, handler); return S.types[name]; };
  /** Register a reference kind resolver: { has(id, ctx) -> true|false|null(unknown), list(ctx) -> [{ id, label }], label(id, ctx) } */
  S.refKind = function (kind, resolver) { S.refKinds[kind] = resolver; return resolver; };

  function handlerFor(type) {
    if (S.types[type]) return S.types[type];
    if (type.startsWith('ref:')) return S.types['ref:*'];
    return null;
  }

  function enumOptions(field, ctx) {
    let opts = field.options;
    if (!opts && field.optionsFrom) {
      // An EMPTY registry constrains nothing. It means the file that fills it has
      // not loaded yet (a headless test using half the engine, a tool), not that
      // every value is wrong — refusing them all would report a working project
      // as broken. Unknown is null, and null passes.
      if (KIT.registry.exists(field.optionsFrom)) {
        const ids = KIT.registry(field.optionsFrom).ids();
        opts = ids.length ? ids : null;
      } else if (ctx && ctx.options && ctx.options[field.optionsFrom]) opts = ctx.options[field.optionsFrom];
      else opts = null;
    }
    if (!opts) return null;
    return opts.map(o => (o !== null && typeof o === 'object') ? o.value : o);
  }

  // ---- base type handlers ------------------------------------------------
  const stringLike = {
    validate(f, v, ctx, path, errors) {
      if (typeof v !== 'string') return err(errors, path, 'must be text', 'type');
      if (f.min != null && v.length < f.min) err(errors, path, `must be at least ${f.min} characters`, 'min');
      if (f.max != null && v.length > f.max) err(errors, path, `must be at most ${f.max} characters`, 'max');
      if (f.pattern && !(new RegExp(f.pattern)).test(v)) err(errors, path, f.patternMessage || 'has the wrong format', 'pattern');
    },
    default(f) { return f.default != null ? f.default : ''; },
  };
  S.defineType('string', stringLike);
  S.defineType('text', stringLike);
  S.defineType('note', stringLike);
  // A label the player reads. Text, or a function of the context that returns
  // text — so a registry entry can take its name from the Terms table instead of
  // freezing one language into the code. Content never stores one of these; only
  // registry definitions, which are code. KIT.labelOf resolves either.
  S.defineType('label', {
    validate(f, v, ctx, path, errors) {
      if (typeof v === 'function') return;
      return stringLike.validate(f, v, ctx, path, errors);
    },
    default(f) { return f.default != null ? f.default : ''; },
  });
  S.defineType('number', {
    validate(f, v, ctx, path, errors) {
      if (!isNum(v)) return err(errors, path, 'must be a number', 'type');
      if (f.integer && !isInt(v)) err(errors, path, 'must be a whole number', 'integer');
      if (f.min != null && v < f.min) err(errors, path, `must be at least ${f.min}`, 'min');
      if (f.max != null && v > f.max) err(errors, path, `must be at most ${f.max}`, 'max');
    },
    default(f) { return f.default != null ? f.default : (f.min != null ? f.min : 0); },
  });
  S.defineType('bool', {
    validate(f, v, ctx, path, errors) { if (typeof v !== 'boolean') err(errors, path, 'must be true or false', 'type'); },
    default(f) { return f.default != null ? f.default : false; },
  });
  S.defineType('enum', {
    validate(f, v, ctx, path, errors) {
      const opts = enumOptions(f, ctx);
      if (opts && !opts.includes(v)) err(errors, path, `must be one of: ${opts.join(', ')}`, 'enum');
    },
    default(f, ctx) { if (f.default != null) return f.default; const opts = enumOptions(f, ctx); return opts && opts.length ? opts[0] : null; },
  });
  S.defineType('color', {
    validate(f, v, ctx, path, errors) { if (typeof v !== 'string' || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) err(errors, path, 'must be a colour like #ff8800', 'type'); },
    default(f) { return f.default != null ? f.default : '#000000'; },
  });
  S.defineType('position', {
    validate(f, v, ctx, path, errors) {
      if (!KIT.isObject(v) || !isInt(v.x) || !isInt(v.y)) return err(errors, path, 'must be a tile position { x, y }', 'type');
      if (v.map != null && typeof v.map !== 'string') err(errors, path, 'map must be a map id', 'type');
    },
    default(f) { return f.default != null ? KIT.deepClone(f.default) : { x: 0, y: 0 }; },
    refs(f, v, ctx, path, out) { if (KIT.isObject(v) && typeof v.map === 'string') out.push({ kind: 'map', id: v.map, path: path.concat('map'), access: 'read' }); },
  });
  S.defineType('direction', {
    validate(f, v, ctx, path, errors) { if (!DIRS.includes(v)) err(errors, path, 'must be up, down, left or right', 'enum'); },
    default(f) { return f.default != null ? f.default : 'down'; },
  });
  S.defineType('region', {
    validate(f, v, ctx, path, errors) { if (!isInt(v) || v < 0 || v > 255) err(errors, path, 'must be a region number 0-255', 'range'); },
    default(f) { return f.default != null ? f.default : 0; },
  });
  S.defineType('route', {
    validate(f, v, ctx, path, errors) {
      if (!Array.isArray(v)) return err(errors, path, 'must be a list of route steps', 'type');
      v.forEach((s, i) => { if (typeof s !== 'string' || !s.trim()) err(errors, path.concat(i), 'route step must be a word like up, wait:300, face:left', 'type'); });
    },
    default(f) { return f.default != null ? f.default.slice() : []; },
  });
  S.defineType('strings', {
    validate(f, v, ctx, path, errors) {
      if (!KIT.isObject(v)) return err(errors, path, 'must be a table of strings', 'type');
      for (const k of Object.keys(v)) if (typeof v[k] !== 'string') err(errors, path.concat(k), 'must be text', 'type');
    },
    default(f) { return f.default != null ? KIT.deepClone(f.default) : {}; },
  });
  /** A table of numbers: `feels`, and anything else that is id → how much. */
  S.defineType('numbers', {
    validate(f, v, ctx, path, errors) {
      if (!KIT.isObject(v)) return err(errors, path, 'must be a table of numbers', 'type');
      for (const k of Object.keys(v)) {
        if (!isNum(v[k])) { err(errors, path.concat(k), 'must be a number', 'type'); continue; }
        if (f.min != null && v[k] < f.min) err(errors, path.concat(k), `must be at least ${f.min}`, 'min');
        if (f.max != null && v[k] > f.max) err(errors, path.concat(k), `must be at most ${f.max}`, 'max');
      }
    },
    default(f) { return f.default != null ? KIT.deepClone(f.default) : {}; },
  });
  // script / condition: minimal handlers; commands.js / conditions.js install the real ones.
  S.defineType('script', {
    validate(f, v, ctx, path, errors) {
      if (!Array.isArray(v)) return err(errors, path, 'must be a list of commands', 'type');
      v.forEach((c, i) => { if (!KIT.isObject(c) || typeof c.t !== 'string') err(errors, path.concat(i), 'each command needs a type (t)', 'type'); });
    },
    default() { return []; },
    refs() {},
  });
  S.defineType('condition', {
    validate(f, v, ctx, path, errors) { if (v !== null && (!KIT.isObject(v) || typeof v.kind !== 'string')) err(errors, path, 'must be a condition or empty', 'type'); },
    default() { return null; },
    refs() {},
  });
  S.defineType('list', {
    validate(f, v, ctx, path, errors) {
      if (!Array.isArray(v)) return err(errors, path, 'must be a list', 'type');
      const a = f.array || {};
      if (a.min != null && v.length < a.min) err(errors, path, `needs at least ${a.min} entries`, 'min');
      if (a.max != null && v.length > a.max) err(errors, path, `allows at most ${a.max} entries`, 'max');
      if (f.of) v.forEach((item, i) => S._validateField(f.of, item, ctx, path.concat(i), errors, null));
    },
    default(f, ctx) { return f.default != null ? KIT.deepClone(f.default) : []; },
    refs(f, v, ctx, path, out) { if (Array.isArray(v) && f.of) v.forEach((item, i) => S._refsField(f.of, item, ctx, path.concat(i), out)); },
    fill(f, v, ctx) { return (Array.isArray(v) && f.of) ? v.map(item => S._fillField(f.of, item, ctx)) : v; },
  });
  S.defineType('group', {
    validate(f, v, ctx, path, errors) {
      if (!KIT.isObject(v)) return err(errors, path, 'must be a group of fields', 'type');
      S._validateFields(f.fields || [], v, ctx, path, errors);
    },
    default(f, ctx) { return S.defaults(f.fields || [], ctx); },
    refs(f, v, ctx, path, out) { if (KIT.isObject(v)) S._refsFields(f.fields || [], v, ctx, path, out); },
    fill(f, v, ctx) { return KIT.isObject(v) ? S.fill(f.fields || [], v, ctx) : v; },
  });
  S.defineType('ref:*', {
    validate(f, v, ctx, path, errors) {
      if (typeof v !== 'string' || !v) return err(errors, path, 'must be an id', 'type');
      const kind = f.type.slice(4);
      const resolver = S.refKinds[kind];
      if (!resolver || !resolver.has) return;
      const known = resolver.has(v, ctx || {}, f);
      if (known === false) err(errors, path, `${kind} '${v}' does not exist`, 'ref');
    },
    default(f) { return f.default != null ? f.default : null; },
    refs(f, v, ctx, path, out) { if (typeof v === 'string' && v) out.push({ kind: f.type.slice(4), id: v, path: path.slice(), access: f.access || 'read' }); },
  });
  // aliases
  S.defineType('tile', Object.assign({}, S.types['ref:*'], { validate(f, v, ctx, path, errors) { S.types['ref:*'].validate(Object.assign({}, f, { type: 'ref:tile' }), v, ctx, path, errors); }, refs(f, v, ctx, path, out) { S.types['ref:*'].refs(Object.assign({}, f, { type: 'ref:tile' }), v, ctx, path, out); } }));
  S.defineType('face', Object.assign({}, S.types['ref:*'], { validate(f, v, ctx, path, errors) { S.types['ref:*'].validate(Object.assign({}, f, { type: 'ref:face' }), v, ctx, path, errors); }, refs(f, v, ctx, path, out) { S.types['ref:*'].refs(Object.assign({}, f, { type: 'ref:face' }), v, ctx, path, out); } }));

  // ---- core operations -----------------------------------------------------
  S._validateField = function (field, v, ctx, path, errors, siblings) {
    const f = field.key !== undefined && field.label !== undefined ? field : S.field(field);
    if (siblings && !S.visible(f, siblings)) return;
    if (v === undefined || v === null) {
      if (f.nullable || f.optional) return;
      return err(errors, path, `${f.label} is required`, 'required');
    }
    const h = handlerFor(f.type);
    if (!h) return err(errors, path, `unknown field type '${f.type}'`, 'schema');
    h.validate(f, v, ctx, path, errors);
  };
  S._validateFields = function (fields, value, ctx, path, errors) {
    for (const f of S.fields(fields)) S._validateField(f, value[f.key], ctx, path.concat(f.key), errors, value);
  };
  /** validate(fields, value, ctx) -> [{ path, message, code }] */
  S.validate = function (fields, value, ctx) {
    const errors = [];
    if (!KIT.isObject(value)) { err(errors, [], 'must be an object', 'type'); return errors; }
    S._validateFields(fields, value, ctx || {}, [], errors);
    return errors;
  };
  /** Validate one value against one field (e.g. a single command argument). */
  S.validateValue = function (field, value, ctx) {
    const errors = [];
    S._validateField(S.field(field), value, ctx || {}, [], errors, null);
    return errors;
  };

  S.defaultFor = function (field, ctx) {
    const f = S.field(field);
    if (f.default !== undefined) return KIT.deepClone(f.default);
    if (f.nullable && f.type.startsWith('ref:')) return null;
    const h = handlerFor(f.type);
    return h && h.default ? h.default(f, ctx || {}) : null;
  };
  /** defaults(fields, ctx) -> an object with every field at its default. */
  S.defaults = function (fields, ctx) {
    const out = {};
    for (const f of S.fields(fields)) out[f.key] = S.defaultFor(f, ctx);
    return out;
  };
  S._fillField = function (field, v, ctx) {
    const f = S.field(field);
    if (v === undefined) return (f.optional && f.default === undefined) ? undefined : S.defaultFor(f, ctx);
    const h = handlerFor(f.type);
    return h && h.fill ? h.fill(f, v, ctx) : v;
  };
  /** fill(fields, value, ctx) -> a NEW object: missing keys get defaults, nested groups/lists filled, extra keys kept. */
  S.fill = function (fields, value, ctx) {
    const out = KIT.isObject(value) ? Object.assign({}, value) : {};
    for (const f of S.fields(fields)) { const v = S._fillField(f, out[f.key], ctx); if (v !== undefined) out[f.key] = v; }
    return out;
  };

  S._refsField = function (field, v, ctx, path, out) {
    const f = S.field(field);
    if (v === undefined || v === null) return;
    const h = handlerFor(f.type);
    if (h && h.refs) h.refs(f, v, ctx, path, out);
  };
  S._refsFields = function (fields, value, ctx, path, out) {
    for (const f of S.fields(fields)) { if (S.visible(f, value)) S._refsField(f, value[f.key], ctx, path.concat(f.key), out); }
  };
  /** refs(fields, value, ctx) -> [{ kind, id, path, access:'read'|'write' }] */
  S.refs = function (fields, value, ctx) {
    const out = [];
    if (KIT.isObject(value)) S._refsFields(fields, value, ctx || {}, [], out);
    return out;
  };

  /** walk(fields, value, fn(field, value, path)) — visits every field (depth-first). */
  S.walk = function (fields, value, fn, path) {
    path = path || [];
    for (const f of S.fields(fields)) {
      const v = KIT.isObject(value) ? value[f.key] : undefined;
      const p = path.concat(f.key);
      fn(f, v, p);
      if (f.type === 'group' && KIT.isObject(v)) S.walk(f.fields || [], v, fn, p);
      else if (f.type === 'list' && Array.isArray(v) && f.of) v.forEach((item, i) => { fn(f.of, item, p.concat(i)); if (f.of.type === 'group' && KIT.isObject(item)) S.walk(f.of.fields || [], item, fn, p.concat(i)); });
    }
  };

  /** Helper: a resolver backed by a registry. */
  S.registryRefKind = function (kind, registryName) {
    return S.refKind(kind, {
      has(id) { return KIT.registry.exists(registryName) ? KIT.registry(registryName).has(id) : null; },
      list() { return KIT.registry.exists(registryName) ? KIT.registry(registryName).list().map(d => ({ id: d.id, label: KIT.labelOf(d, null, d.id) })) : []; },
      label(id) { const d = KIT.registry.exists(registryName) && KIT.registry(registryName).get(id); return d ? KIT.labelOf(d, null, id) : id; },
    });
  };
  /** Helper: a resolver backed by a project table (ctx.project[table] keyed by id). */
  S.projectRefKind = function (kind, table) {
    return S.refKind(kind, {
      has(id, ctx) { const p = ctx && ctx.project; if (!p || !p[table]) return null; return Object.prototype.hasOwnProperty.call(p[table], id); },
      list(ctx) { const p = ctx && ctx.project; return p && p[table] ? Object.keys(p[table]).map(id => ({ id, label: (p[table][id] && (p[table][id].name || p[table][id].label)) || id })) : []; },
      label(id, ctx) { const p = ctx && ctx.project; const e = p && p[table] && p[table][id]; return e ? (e.name || e.label || id) : id; },
    });
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
