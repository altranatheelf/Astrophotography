// Conditions: the 'conditions' registry, every baseline kind (§9.3), the rich
// 'condition' schema type, and the condition text format used by Screenplay
// (`chapter >= 2 and item.berry >= 1`). Pure: test() reads the ctx only.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const S = KIT.schema;
  const V = KIT.script.values;
  const C = KIT.conditions = KIT.conditions || {};
  const reg = KIT.registry('conditions');
  // Workaround (core issue): registries.js validates ids lowercase-only; §11 names module kinds in camelCase (dexCount).
  for (const f of reg.opts.fields || []) if (f.key === 'id' && f.pattern) f.pattern = '^[a-zA-Z0-9][a-zA-Z0-9-_.:]*$';

  /**
   * @typedef {Object} ConditionCtx  The minimal world view a condition reads. Tests use plain objects.
   * @property {Object} world
   * @property {Object} world.save            save data (§7): { vars, inventory, objects, timer, clock, meta, heroes }
   * @property {Object} [world.map]           current map view: { id, region(x,y), tileAt(layer,x,y) } (or a raw map with layers/width)
   * @property {Array|Object} [world.entities]  live entities by id ('p1', 'p2', object ids): { id, x, y, dir }
   * @property {Object} [world.meta]          meta record (survives New Game); save.meta is read first
   * @property {string|null} [self]           the current object's save key ('town:mom')
   * @property {string|Object} [hero]         the triggering hero: id ('p1') or entity { id }
   * @property {boolean} [coop]               co-op active (falls back to project.settings.coop.enabled)
   * @property {Object} [project]             the project (var defaults, item names, heroes)
   * @property {{pressed:function(string, string):boolean}} [input]  button state: pressed(key, heroId)
   */
  /**
   * @typedef {Object} Condition  { kind, ...fields of that kind }. null = always true.
   * Targets (facing/region/...): 'self' | 'hero' | 'p1' | 'p2' | 'obj:<objectId>'.
   */
  /** Control signal is not returned by conditions; see commands.js. */

  const has = (o, k) => o !== null && o !== undefined && Object.prototype.hasOwnProperty.call(o, k);
  const save = (ctx) => (ctx && ctx.world && ctx.world.save) || {};
  const OPS = ['==', '!=', '<', '<=', '>', '>='];
  const SYM = { '==': '=', '!=': '≠', '<': '<', '<=': '≤', '>': '>', '>=': '≥' };

  // ---- reading state ---------------------------------------------------------

  /** The triggering hero's id ('p1' by default). */
  C.heroId = function (ctx) {
    const h = ctx && ctx.hero;
    if (typeof h === 'string' && h) return h;
    if (h && typeof h === 'object' && h.id) return h.id;
    if (typeof h === 'number') { const p = ctx.project && ctx.project.heroes && ctx.project.heroes[h]; return p ? p.id : `p${h + 1}`; }
    return 'p1';
  };
  C.heroIndex = function (ctx, id) {
    const heroes = (ctx && ctx.project && ctx.project.heroes) || [];
    const i = heroes.findIndex(h => h.id === id);
    if (i >= 0) return i;
    const m = /^p(\d+)$/.exec(id || '');
    return m ? Number(m[1]) - 1 : 0;
  };
  /** A var's value, falling back to its declared default. */
  C.getVar = function (ctx, name) {
    const vars = save(ctx).vars || {};
    if (has(vars, name)) return vars[name];
    const decl = ctx && ctx.project && ctx.project.vars && ctx.project.vars[name];
    return decl && decl.default !== undefined ? decl.default : undefined;
  };
  C.getSelf = function (ctx, key, objectKey) {
    const objs = save(ctx).objects || {};
    const o = objs[objectKey || (ctx && ctx.self)];
    return o && o.self ? o.self[key] : undefined;
  };
  C.count = (ctx, id) => Number((save(ctx).inventory || {})[id]) || 0;
  C.meta = (ctx) => save(ctx).meta || (ctx && ctx.world && ctx.world.meta) || {};

  /** compare(a, op, b): tolerant of undefined (reads as 0/false/'') and numeric strings. */
  C.compare = function (a, op, b) {
    op = op || '==';
    if (a === undefined || a === null) a = typeof b === 'number' ? 0 : typeof b === 'boolean' ? false : '';
    if (b === undefined || b === null) b = typeof a === 'number' ? 0 : typeof a === 'boolean' ? false : '';
    if (typeof a !== typeof b) {
      const na = Number(a), nb = Number(b);
      if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) { a = na; b = nb; }
      else { a = String(a); b = String(b); }
    }
    switch (op) {
      case '==': return a === b;
      case '!=': return a !== b;
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '>=': return a >= b;
      default: return false;
    }
  };

  /** objectId('town:mom') -> 'mom' (the id part of a save key). */
  C.objectId = (key) => { const s = String(key || ''); const i = s.indexOf(':'); return i >= 0 ? s.slice(i + 1) : s; };
  /** objectKey(ctx, id) -> 'map:id' using the current map. */
  C.objectKey = function (ctx, id) {
    const map = ctx && ctx.world && ctx.world.map;
    const mapId = map && map.id;
    return mapId ? `${mapId}:${id}` : String(id);
  };
  function findEntity(ctx, id, key) {
    const ents = ctx && ctx.world && ctx.world.entities;
    if (!ents) return null;
    if (Array.isArray(ents)) return ents.find(e => e && (e.id === id || (key && e.key === key))) || null;
    return ents[id] || (key ? ents[key] : null) || null;
  }
  /**
   * target(ctx, target) -> { id, key, isHero, entity, x, y, dir }  resolves 'self' | 'hero' | 'p1' | 'p2' | 'obj:id'.
   * Position/direction come from the live entity when present, else from the save.
   */
  C.target = function (ctx, target) {
    let t = target == null || target === '' ? 'hero' : String(target);
    let id, key = null, isHero = false;
    if (t === 'self') { key = ctx && ctx.self ? String(ctx.self) : null; id = key ? C.objectId(key) : null; }
    else if (t === 'hero' || t === 'p') { id = C.heroId(ctx); isHero = true; }
    else if (/^p\d+$/.test(t)) { id = t; isHero = true; }
    else { id = t.startsWith('obj:') ? t.slice(4) : t; key = C.objectKey(ctx, id); }
    const entity = id ? findEntity(ctx, id, key) : null;
    let x, y, dir;
    if (entity) { x = entity.x; y = entity.y; dir = entity.dir; }
    else if (isHero) { const h = (save(ctx).heroes || [])[C.heroIndex(ctx, id)]; if (h) { x = h.x; y = h.y; dir = h.dir; } }
    else if (key) { const o = (save(ctx).objects || {})[key]; if (o) { x = o.x; y = o.y; dir = o.dir; } }
    return { id, key, isHero, entity, x, y, dir };
  };
  C.targetLabel = function (target) {
    const t = target == null || target === '' ? 'hero' : String(target);
    if (t === 'self') return 'this object';
    if (t === 'hero' || t === 'p') return 'the hero';
    if (/^p\d+$/.test(t)) return t.toUpperCase();
    return t.startsWith('obj:') ? t.slice(4) : t;
  };
  /** Reference extraction for target strings: 'obj:id' is a read of that object. Shared with commands.js. */
  C.targetRefs = function (v, path, out) {
    if (typeof v === 'string' && v.startsWith('obj:') && v.length > 4) out.push({ kind: 'object', id: v.slice(4), path: path.slice(), access: 'read' });
  };

  function regionAt(map, x, y) {
    if (!map) return undefined;
    if (typeof map.region === 'function') return map.region(x, y);
    const r = map.layers && map.layers.regions;
    if (r && map.width != null && x >= 0 && y >= 0 && x < map.width) return r[y * map.width + x];
    return undefined;
  }
  function tileAt(map, layer, x, y) {
    if (!map) return undefined;
    if (typeof map.tileAt === 'function') return map.tileAt(layer, x, y);
    const l = map.layers && map.layers[layer];
    if (l && map.width != null && x >= 0 && y >= 0 && x < map.width) return l[y * map.width + x];
    return undefined;
  }
  const itemName = (ctx, id) => { const it = ctx && ctx.project && ctx.project.items && ctx.project.items[id]; return it && it.name ? it.name : id; };
  const fmtValue = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
  const opField = (def) => ({ key: 'op', type: 'enum', options: OPS, default: def || '==', label: 'Compare' });
  const targetField = (def) => ({ key: 'target', type: 'string', default: def, target: true, doc: "self, hero, p1, p2 or obj:<id>" });

  // ---- baseline kinds ---------------------------------------------------------

  reg.addAll([
    {
      id: 'var', label: 'Variable', group: 'Progress', doc: 'Compare a game variable with a value or another variable.',
      fields: [
        { key: 'name', type: 'ref:var', nullable: false, label: 'Variable' }, opField('=='),
        { key: 'value', type: 'scalar', default: 0 },
        { key: 'var', type: 'ref:var', label: 'Or variable', doc: 'When set, compare with this variable instead of the value' },
      ],
      test(c, ctx) { return C.compare(C.getVar(ctx, c.name), c.op, c.var ? C.getVar(ctx, c.var) : c.value); },
      describe(c) { return `${c.name} ${SYM[c.op] || c.op || '='} ${c.var ? c.var : fmtValue(c.value)}`; },
    },
    {
      id: 'self', label: 'Self state', group: 'Progress', doc: "Compare one of this object's self state keys.",
      fields: [{ key: 'key', type: 'string', min: 1 }, opField('=='), { key: 'value', type: 'scalar', default: true }],
      test(c, ctx) { return C.compare(C.getSelf(ctx, c.key), c.op, c.value); },
      describe(c) { return `self.${c.key} ${SYM[c.op] || c.op || '='} ${fmtValue(c.value)}`; },
    },
    {
      id: 'item', label: 'Item', group: 'Party', doc: 'How many of an item the party holds.',
      fields: [{ key: 'id', type: 'ref:item', nullable: false, label: 'Item' }, opField('>='), { key: 'count', type: 'number', integer: true, min: 0, default: 1 }],
      test(c, ctx) { return C.compare(C.count(ctx, c.id), c.op || '>=', c.count == null ? 1 : c.count); },
      describe(c, ctx) {
        const name = itemName(ctx, c.id), op = c.op || '>=', n = c.count == null ? 1 : c.count;
        if (op === '>=' && n === 1) return `has ${name}`;
        if ((op === '<' && n === 1) || (op === '==' && n === 0)) return `no ${name}`;
        return `${name} × ${SYM[op] || op} ${n}`;
      },
    },
    {
      id: 'facing', label: 'Facing', group: 'Map', doc: 'A character faces a direction.',
      fields: [targetField('self'), { key: 'dir', type: 'direction', default: 'down' }],
      test(c, ctx) { return C.target(ctx, c.target).dir === c.dir; },
      describe(c) { return `${C.targetLabel(c.target)} faces ${c.dir}`; },
    },
    {
      id: 'button', label: 'Button', group: 'Input', doc: 'A button is held by the triggering player.',
      fields: [{ key: 'key', type: 'string', default: 'A', doc: 'A, B, up, down, left, right, menu' }],
      test(c, ctx) { return !!(ctx && ctx.input && typeof ctx.input.pressed === 'function' && ctx.input.pressed(c.key, C.heroId(ctx))); },
      describe(c) { return `${c.key} pressed`; },
    },
    {
      id: 'timer', label: 'Timer', group: 'Progress', doc: 'The timer is running and its remaining seconds compare so.',
      fields: [opField('<='), { key: 'seconds', type: 'number', min: 0, default: 0 }],
      test(c, ctx) { const t = save(ctx).timer || {}; return !!t.running && C.compare(Number(t.secondsLeft) || 0, c.op || '<=', c.seconds || 0); },
      describe(c) { return `timer ${SYM[c.op] || c.op || '≤'} ${c.seconds || 0}s`; },
    },
    {
      id: 'region', label: 'Region', group: 'Map', doc: 'A character stands in a region.',
      fields: [{ key: 'id', type: 'region', default: 1 }, targetField('hero')],
      test(c, ctx) { const t = C.target(ctx, c.target); return t.x != null && regionAt(ctx.world && ctx.world.map, t.x, t.y) === c.id; },
      describe(c) { return `${C.targetLabel(c.target)} in region ${c.id}`; },
    },
    {
      id: 'tile', label: 'Tile', group: 'Map', doc: 'The tile on a layer at a position (default: under the hero).',
      fields: [{ key: 'layer', type: 'enum', options: ['ground', 'deco', 'above'], default: 'ground' }, { key: 'id', type: 'ref:tile', nullable: false, label: 'Tile' }, { key: 'at', type: 'position', optional: true, nullable: true, display: 'point' }],
      test(c, ctx) {
        const p = c.at || C.target(ctx, 'hero');
        return p.x != null && tileAt(ctx.world && ctx.world.map, c.layer || 'ground', p.x, p.y) === c.id;
      },
      describe(c) { return `${c.layer || 'ground'} ${c.at ? `at ${c.at.x},${c.at.y}` : 'under the hero'} is ${c.id}`; },
    },
    {
      id: 'meta', label: 'Meta', group: 'Progress', doc: 'Compare a meta value (survives New Game: runs, endingsSeen…).',
      fields: [{ key: 'key', type: 'string', min: 1 }, opField('>='), { key: 'value', type: 'scalar', default: 1 }],
      test(c, ctx) { return C.compare(C.meta(ctx)[c.key], c.op, c.value); },
      describe(c) { return `meta.${c.key} ${SYM[c.op] || c.op || '='} ${fmtValue(c.value)}`; },
    },
    {
      id: 'clock', label: 'Time of day', group: 'World', doc: 'In-game minute of the day is within from..to (wraps past midnight).',
      fields: [{ key: 'from', type: 'number', integer: true, min: 0, max: 1439, default: 0 }, { key: 'to', type: 'number', integer: true, min: 0, max: 1439, default: 1439 }],
      test(c, ctx) {
        const m = ((Number((save(ctx).clock || {}).minutes) || 0) % 1440 + 1440) % 1440;
        const from = c.from || 0, to = c.to == null ? 1439 : c.to;
        return from <= to ? (m >= from && m <= to) : (m >= from || m <= to);
      },
      describe(c) { const hm = (n) => `${String(Math.floor((n || 0) / 60)).padStart(2, '0')}:${String((n || 0) % 60).padStart(2, '0')}`; return `between ${hm(c.from)} and ${hm(c.to == null ? 1439 : c.to)}`; },
    },
    {
      id: 'coop', label: 'Co-op', group: 'Input', doc: 'Two players are active.',
      fields: [],
      test(c, ctx) {
        if (ctx && ctx.coop !== undefined) return !!ctx.coop;
        const s = ctx && ctx.project && ctx.project.settings && ctx.project.settings.coop;
        return !!(s && s.enabled);
      },
      describe() { return 'co-op'; },
    },
    {
      id: 'all', label: 'All of', group: 'Logic', doc: 'Every listed condition passes.',
      fields: [{ key: 'of', type: 'list', of: { type: 'condition' }, default: [] }],
      test(c, ctx) { return (c.of || []).every(x => C.test(x, ctx)); },
      describe(c, ctx) { return (c.of || []).map(x => wrapDesc(x, ctx)).join(' and ') || 'always'; },
    },
    {
      id: 'any', label: 'Any of', group: 'Logic', doc: 'At least one listed condition passes.',
      fields: [{ key: 'of', type: 'list', of: { type: 'condition' }, default: [] }],
      test(c, ctx) { return (c.of || []).some(x => C.test(x, ctx)); },
      describe(c, ctx) { return (c.of || []).map(x => wrapDesc(x, ctx)).join(' or ') || 'never'; },
    },
    {
      id: 'not', label: 'Not', group: 'Logic', doc: 'The condition fails.',
      fields: [{ key: 'of', type: 'condition' }],
      test(c, ctx) { return !C.test(c.of, ctx); },
      describe(c, ctx) { return `not ${wrapDesc(c.of, ctx)}`; },
    },
  ]);
  const wrapDesc = (c, ctx) => (c && (c.kind === 'all' || c.kind === 'any') && (c.of || []).length > 1 ? `(${C.describe(c, ctx)})` : C.describe(c, ctx));

  // ---- API -------------------------------------------------------------------

  const warned = new Set();
  /** test(cond, ctx) -> boolean. null/undefined = true. Unknown kinds are false (warned once). */
  C.test = function (cond, ctx) {
    if (cond === null || cond === undefined) return true;
    if (!KIT.isObject(cond) || typeof cond.kind !== 'string') return false;
    const def = reg.get(cond.kind);
    if (!def || typeof def.test !== 'function') {
      if (!warned.has(cond.kind)) { warned.add(cond.kind); (KIT.log || console).warn(`[conditions] unknown kind '${cond.kind}'`); }
      return false;
    }
    return !!def.test(cond, ctx || {});
  };
  /** describe(cond, ctx) -> short human text: 'chapter ≥ 2 and has Berry'. */
  C.describe = function (cond, ctx) {
    if (cond === null || cond === undefined) return 'always';
    if (!KIT.isObject(cond) || typeof cond.kind !== 'string') return '(invalid)';
    const def = reg.get(cond.kind);
    if (!def) return `(unknown: ${cond.kind})`;
    if (typeof def.describe === 'function') return def.describe(cond, ctx || {});
    return def.label || cond.kind;
  };
  /** withDefaults(fields, value) -> a copy where missing keys take their defaults, except defaults that are null (so 'required' still reports). */
  C.withDefaults = function (fields, value) {
    const filled = S.fill(fields || [], value);
    for (const k of Object.keys(filled)) if (!has(value, k) && filled[k] === null) delete filled[k];
    return filled;
  };
  /** normalize(cond) -> a copy with the kind's defaults filled (nested too). */
  C.normalize = function (cond) {
    if (cond === null || cond === undefined) return null;
    const def = KIT.isObject(cond) && reg.get(cond.kind);
    return def ? S.fill(def.fields || [], cond) : cond;
  };
  /** validate(cond, ctx) -> [{ path, message, code }] */
  C.validate = function (cond, ctx) { return S.validateValue({ key: 'when', type: 'condition' }, cond, ctx); };
  /** refs(cond, ctx) -> [{ kind, id, path, access:'read' }] */
  C.refs = function (cond, ctx) { const out = []; S._refsField({ key: 'when', type: 'condition' }, cond, ctx || {}, [], out); return out; };

  // ---- schema: 'scalar' (string | number | bool | null) and the rich 'condition' type ----

  S.defineType('scalar', {
    validate(f, v, ctx, path, errors) {
      if (v !== null && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') errors.push({ path: path.slice(), message: 'must be text, a number or true/false', code: 'type' });
      else if (typeof v === 'number' && !Number.isFinite(v)) errors.push({ path: path.slice(), message: 'must be a finite number', code: 'type' });
    },
    default(f) { return f.default !== undefined ? f.default : null; },
  });

  S.defineType('condition', {
    validate(f, v, ctx, path, errors) {
      if (v === null || v === undefined) return;
      if (!KIT.isObject(v) || typeof v.kind !== 'string') return errors.push({ path: path.slice(), message: 'must be a condition or empty', code: 'type' });
      const def = reg.get(v.kind);
      if (!def) return errors.push({ path: path.slice(), message: `unknown condition kind '${v.kind}'`, code: 'unknown' });
      S._validateFields(def.fields || [], C.withDefaults(def.fields, v), ctx || {}, path, errors);
    },
    default() { return null; },
    refs(f, v, ctx, path, out) {
      if (!KIT.isObject(v)) return;
      const def = reg.get(v.kind);
      if (!def) return;
      S._refsFields(def.fields || [], v, ctx || {}, path, out);
      for (const fld of S.fields(def.fields || [])) if (fld.target) C.targetRefs(v[fld.key], path.concat(fld.key), out);
    },
    fill(f, v) { return C.normalize(v); },
  });

  // ---- text format (lossless; used by Screenplay) ----------------------------
  // expr := or ; or := and ('or' and)* ; and := not ('and' not)* ; not := 'not' not | primary
  // primary := '(' expr ')' | 'always' | 'never' | {json} | ident op value | kind '(' key=value, ... ')'
  // ident := name (var) | self.key | item.id | meta.key ; value := number | true | false | "text" | word | var:name

  const wrapText = (c) => (c && (c.kind === 'all' || c.kind === 'any') && (c.of || []).length > 1 ? `(${C.toText(c)})` : C.toText(c));
  const word = (s) => typeof s === 'string' && V.WORD.test(s) && !['and', 'or', 'not', 'always', 'never', 'true', 'false', 'null'].includes(s);
  const valText = (v) => V.format(v, { bare: V.WORD });

  /** toText(cond) -> string. Kinds without sugar use `kind(key=value, …)`; anything else falls back to JSON. */
  C.toText = function (cond) {
    if (cond === null || cond === undefined) return 'always';
    if (!KIT.isObject(cond) || typeof cond.kind !== 'string') return JSON.stringify(cond);
    const c = cond, k = c.kind;
    if (k === 'var' && word(c.name) && (c.var == null || word(c.var))) return `${c.name} ${c.op || '=='} ${c.var ? 'var:' + c.var : valText(c.value)}`;
    if (k === 'self' && word(c.key)) return `self.${c.key} ${c.op || '=='} ${valText(c.value)}`;
    if (k === 'item' && word(c.id)) return `item.${c.id} ${c.op || '>='} ${valText(c.count == null ? 1 : c.count)}`;
    if (k === 'meta' && word(c.key)) return `meta.${c.key} ${c.op || '=='} ${valText(c.value)}`;
    if (k === 'all' || k === 'any') {
      const parts = (c.of || []);
      if (!parts.length) return `${k}()`;
      if (parts.length === 1) return `${k}(${C.toText(parts[0])})`;
      return parts.map(wrapText).join(k === 'all' ? ' and ' : ' or ');
    }
    if (k === 'not') return `not ${wrapText(c.of)}`;
    const def = reg.get(k);
    if (def) {
      const fields = S.fields(def.fields || []);
      const simple = fields.every(f => f.type !== 'condition' && !(f.type === 'list' && f.of && f.of.type === 'condition'));
      const extra = Object.keys(c).filter(key => key !== 'kind' && !fields.some(f => f.key === key));
      if (simple && !extra.length && /^[a-z][\w-]*$/i.test(k)) {
        const args = fields.filter(f => c[f.key] !== undefined).map(f => `${f.key}=${V.format(c[f.key], { bare: V.WORD })}`);
        return `${k}(${args.join(', ')})`;
      }
    }
    return JSON.stringify(c);
  };

  function lex(str) {
    const toks = [];
    let i = 0;
    const s = String(str);
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '(' || c === ')' || c === ',') { toks.push({ t: c, i }); i++; continue; }
      const op = /^(==|!=|<=|>=|<|>|=)/.exec(s.slice(i));
      if (op) { toks.push({ t: 'op', v: op[1] === '=' ? '==' : op[1], i }); i += op[1].length; continue; }
      if (c === '"' || c === '{' || c === '[') {
        const r = V.scan(s, i, ',)');
        if (!r || r.error) throw new Error(`condition: bad value at ${i}`);
        toks.push({ t: 'value', v: r.value, i, raw: r.raw }); i = r.end; continue;
      }
      const m = /^-?\d+(\.\d+)?(?![\w.-])/.exec(s.slice(i));
      if (m) { toks.push({ t: 'value', v: Number(m[0]), i, raw: m[0] }); i += m[0].length; continue; }
      const w = /^[^\s(),=<>!"]+/.exec(s.slice(i));
      if (!w) throw new Error(`condition: unexpected '${c}' at ${i}`);
      toks.push({ t: 'word', v: w[0], i }); i += w[0].length;
    }
    return toks;
  }

  /** parseText(str) -> Condition | null ('always'). Throws Error('condition: …') on bad input. */
  C.parseText = function (str) {
    const toks = lex(str == null ? '' : str);
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const expect = (t) => { const k = next(); if (!k || k.t !== t) throw new Error(`condition: expected '${t}'${k ? ` at ${k.i}` : ' at end'}`); return k; };
    const isWord = (w) => peek() && peek().t === 'word' && peek().v === w;
    function value() {
      const k = next();
      if (!k) throw new Error('condition: expected a value at end');
      if (k.t === 'value') return { value: k.v };
      if (k.t === 'word') {
        if (k.v.startsWith('var:')) return { var: k.v.slice(4) };
        return { value: V.parseBare(k.v) };
      }
      throw new Error(`condition: expected a value at ${k.i}`);
    }
    function primary() {
      const k = next();
      if (!k) throw new Error('condition: unexpected end');
      if (k.t === '(') { const e = or(); expect(')'); return e; }
      if (k.t === 'value' && KIT.isObject(k.v)) return k.v;      // raw JSON condition
      if (k.t !== 'word') throw new Error(`condition: unexpected '${k.raw || k.v || k.t}' at ${k.i}`);
      if (k.v === 'always') return null;
      if (k.v === 'never') return { kind: 'any', of: [] };
      if (peek() && peek().t === '(') {
        next();
        if (k.v === 'all' || k.v === 'any') {                    // all(a, b) / any()
          const of = [];
          while (peek() && peek().t !== ')') { of.push(or()); if (peek() && peek().t === ',') next(); }
          expect(')');
          return { kind: k.v, of };
        }
        const c = { kind: k.v };                                  // kind(key=value, …)
        while (peek() && peek().t !== ')') {
          const key = expect('word').v;
          const eq = expect('op'); if (eq.v !== '==') throw new Error(`condition: expected '=' at ${eq.i}`);
          const v = value(); if (v.var !== undefined) throw new Error(`condition: var: is not allowed here`);
          c[key] = v.value;
          if (peek() && peek().t === ',') next();
        }
        expect(')');
        return C.normalize(c);
      }
      const opTok = expect('op');
      const v = value();
      if (k.v.startsWith('self.')) { if (v.var !== undefined) throw new Error('condition: self cannot compare to a var'); return { kind: 'self', key: k.v.slice(5), op: opTok.v, value: v.value }; }
      if (k.v.startsWith('item.')) { if (typeof v.value !== 'number') throw new Error('condition: item count must be a number'); return { kind: 'item', id: k.v.slice(5), op: opTok.v, count: v.value }; }
      if (k.v.startsWith('meta.')) { if (v.var !== undefined) throw new Error('condition: meta cannot compare to a var'); return { kind: 'meta', key: k.v.slice(5), op: opTok.v, value: v.value }; }
      const out = { kind: 'var', name: k.v, op: opTok.v, value: v.var !== undefined ? 0 : v.value, var: v.var !== undefined ? v.var : null };
      return out;
    }
    function notExpr() { if (isWord('not')) { next(); return { kind: 'not', of: notExpr() }; } return primary(); }
    function and() { const parts = [notExpr()]; while (isWord('and')) { next(); parts.push(notExpr()); } return parts.length === 1 ? parts[0] : { kind: 'all', of: parts }; }
    function or() { const parts = [and()]; while (isWord('or')) { next(); parts.push(and()); } return parts.length === 1 ? parts[0] : { kind: 'any', of: parts }; }
    if (!toks.length) return null;
    const result = or();
    if (p < toks.length) throw new Error(`condition: unexpected '${toks[p].raw || toks[p].v || toks[p].t}' at ${toks[p].i}`);
    return C.normalize(result);
  };
  /** tryParseText(str) -> Condition | null | undefined (undefined = parse error). */
  C.tryParseText = function (str) { try { return C.parseText(str); } catch (e) { return undefined; } };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
