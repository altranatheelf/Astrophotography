// Commands: the 'commands' registry, every baseline command (§9.2) as a
// definition { fields, run(ctx, cmd), summary, text sugar }, the rich 'script'
// schema type, the generic `@id key=value` line form shared with Screenplay,
// and the kit's default Terms (strings). run() touches the world ONLY through
// the ports on ctx (documented below); the runtime implements them, tests fake them.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const S = KIT.schema;
  const V = KIT.script.values;
  const T = KIT.text;
  const C = KIT.conditions;
  const CMD = KIT.commands = KIT.commands || {};
  const reg = KIT.registry('commands');
  // Workaround (core issue): registries.js validates every id against a lowercase-only pattern, but §9.2 names
  // commands in camelCase (setVar, inputNumber, moveRoute…). Widen the pattern on this registry's definition schema.
  for (const f of reg.opts.fields || []) if (f.key === 'id' && f.pattern) f.pattern = '^[a-zA-Z0-9][a-zA-Z0-9-_.:]*$';

  // ---- the ctx port contract -------------------------------------------------
  /**
   * @typedef {Object} RunCtx  What a command's run(ctx, cmd) may use. The interpreter builds it; the runtime (Phase 2) implements the ports.
   * @property {Object} project                 the project (read-only)
   * @property {Object} world                   { save, map, entities, events } — commands read/write `save` directly (vars, inventory, objects, timer, heroes[i].name) and emit events for every change
   * @property {string|null} self               the current object's save key ('town:mom') or null
   * @property {string} hero                    the triggering hero id ('p1' | 'p2')
   * @property {Object} [thread]                { id, background, cancelled, ... } (§9.6)
   * @property {function} rng                   KIT.rng — every random decision
   * @property {Object<string,*>} [args]        call arguments ({arg:name})
   * @property {function(string, Object)} emit  emit(event, payload) on the world bus: varChanged, selfChanged, itemChanged, objectStateChanged, timerChanged, heroRenamed, heal, debug
   * @property {RunIo} io
   * @property {RunAudio} audio
   * @property {RunScreen} screen
   * @property {RunPictures} pictures
   * @property {RunMap} map
   * @property {RunGame} game
   */
  /**
   * @typedef {Object} RunIo  main-thread scenes; all return promises
   * @property {function({who:string, face:string|null, text:string, position:string, bg:string, raw:string}):Promise} say
   * @property {function({prompt:string, options:Array<{text:string, index:number}>, cancel:string}):Promise<number>} choice  resolves the chosen option index (into the given list) or -1 on cancel
   * @property {function({hero:string, prompt:string, maxLength:number, current:string}):Promise<string|null>} nameEntry
   * @property {function({prompt:string, digits:number, current:number}):Promise<number|null>} inputNumber
   * @property {function({text:string}):Promise} toast
   * @property {function({title:string, subtitle:string, ms:number}):Promise} chapter
   * @property {function({text:string, speed:number, noFast:boolean}):Promise} scrollText
   * @property {function(number):Promise} wait   wait(ms)
   */
  /**
   * @typedef {Object} RunAudio
   * @property {function(string, {volume:number}):Promise} play        a sound effect
   * @property {function(string|null, {fade:number, volume:number}):Promise} music   start (or null = stop) the music
   * @property {function(string):Promise} stop     stop('sound' | 'music')
   * @property {function():Promise} save           remember the current music
   * @property {function():Promise} replay         resume the remembered music
   * @property {function(string):Promise} jingle   play a short piece, then resume the music
   */
  /**
   * @typedef {Object} RunScreen
   * @property {function({ms:number, color:string}):Promise} fadeOut
   * @property {function({ms:number}):Promise} fadeIn
   * @property {function({color:string, amount:number, ms:number}):Promise} tint
   * @property {function({color:string, ms:number}):Promise} flash
   * @property {function({power:number, ms:number}):Promise} shake
   * @property {function({kind:string, power:number, ms:number}):Promise} weather
   */
  /**
   * @typedef {Object} RunPictures
   * @property {function({id:string, image:string, x:number, y:number, anchor:string, opacity:number}):Promise} show
   * @property {function({id:string, x:number, y:number, opacity:number, ms:number, wait:boolean}):Promise} move
   * @property {function({id:string}):Promise} erase
   */
  /**
   * @typedef {Object} RunMap   `target` is 'self' | 'hero' | 'p1' | 'p2' | 'obj:<id>'
   * @property {function({map:string, x:number, y:number, dir:string, fade:boolean}):Promise} transfer
   * @property {function({target:string, x:number, y:number, swap:string|null}):Promise} setLocation
   * @property {function({target:string, steps:string[], wait:boolean, skipBlocked:boolean, repeat:boolean}):Promise} moveRoute
   * @property {function({dx:number, dy:number, speed:number}):Promise} scrollMap
   * @property {function({target:string, on:boolean}):Promise} transparency
   * @property {function({target:string, id:string}):Promise} animation
   * @property {function({target:string, kind:string, wait:boolean}):Promise} balloon
   * @property {function({target:string, persistent:boolean}):Promise} erase
   * @property {function({on:boolean}):Promise} follow
   */
  /**
   * @typedef {Object} RunGame
   * @property {function():Promise} menu
   * @property {function({slot:string}):Promise<boolean>} save
   * @property {function():Promise} title
   * @property {function({hero:string}):Promise} heal
   * @property {function({text:string}):void} debug
   */
  /**
   * @typedef {Object} ControlSignal  What flow commands return for the interpreter (other commands return undefined).
   *   { kind:'block', body:Command[], loop?:true }   run the nested list (again and again when loop)
   *   { kind:'break' } | { kind:'jump', label } | { kind:'exit' } | { kind:'call', script, args }
   */
  /** @typedef {Object} Command  { t, disabled?, ...fields of the command }; { t:'raw', line } is a line Screenplay could not parse. */

  // ---- helpers ---------------------------------------------------------------

  const has = (o, k) => o !== null && o !== undefined && Object.prototype.hasOwnProperty.call(o, k);
  const save = (ctx) => { const w = ctx.world || (ctx.world = {}); return w.save || (w.save = {}); };
  const emit = (ctx, event, payload) => {
    if (typeof ctx.emit === 'function') ctx.emit(event, payload);
    else if (ctx.world && ctx.world.events && typeof ctx.world.events.emit === 'function') ctx.world.events.emit(event, payload);
  };
  const port = (ctx, group, name) => {
    const g = ctx[group];
    if (!g || typeof g[name] !== 'function') throw new Error(`commands: ctx.${group}.${name} is not available`);
    return (...args) => g[name](...args);
  };
  const strings = (ctx, key, vars) => KIT.strings.get(ctx.project, key, vars);
  const itemName = (ctx, id) => { const it = ctx && ctx.project && ctx.project.items && ctx.project.items[id]; return it && it.name ? it.name : String(id); };
  const plain = (str, ctx) => T.plain(str, ctx);
  const short = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > (n || 40) ? s.slice(0, (n || 40) - 1) + '…' : s; };
  const targetField = (def) => ({ key: 'target', type: 'string', default: def, target: true, doc: 'self, hero, p1, p2 or obj:<id>' });
  const heroField = (def, opts) => ({ key: 'hero', type: 'enum', options: opts || ['hero', 'p1', 'p2'], default: def || 'hero' });
  const heroIdFor = (ctx, sel) => (!sel || sel === 'hero' ? C.heroId(ctx) : sel);

  /** State helpers (shared with the interpreter and systems): every write emits its event. */
  const STATE = CMD.state = {
    getVar: (ctx, name) => C.getVar(ctx, name),
    setVar(ctx, name, value) {
      const s = save(ctx); s.vars = s.vars || {};
      const old = s.vars[name];
      s.vars[name] = value;
      emit(ctx, 'varChanged', { name, old, value });
      return value;
    },
    getSelf: (ctx, key, objectKey) => C.getSelf(ctx, key, objectKey),
    setSelf(ctx, key, value, objectKey) {
      const k = objectKey || ctx.self;
      if (!k) throw new Error('commands: setSelf needs a current object (ctx.self)');
      const s = save(ctx); s.objects = s.objects || {};
      const o = s.objects[k] || (s.objects[k] = { self: {} });
      o.self = o.self || {};
      const old = o.self[key];
      o.self[key] = value;
      emit(ctx, 'selfChanged', { objectKey: k, key, old, value });
      return value;
    },
    count: (ctx, id) => C.count(ctx, id),
    give(ctx, id, delta) {
      const s = save(ctx); s.inventory = s.inventory || {};
      const before = Number(s.inventory[id]) || 0;
      const after = Math.max(0, before + delta);
      if (after === 0) delete s.inventory[id]; else s.inventory[id] = after;
      emit(ctx, 'itemChanged', { id, delta: after - before, count: after });
      return after;
    },
    heroName(ctx, heroId) {
      const i = C.heroIndex(ctx, heroId);
      const s = save(ctx);
      const h = (s.heroes || [])[i];
      if (h && h.name != null) return h.name;
      const p = ((ctx.project && ctx.project.heroes) || [])[i];
      return p ? p.name : heroId;
    },
    setHeroName(ctx, heroId, name) {
      const i = C.heroIndex(ctx, heroId);
      const s = save(ctx); s.heroes = s.heroes || [];
      while (s.heroes.length <= i) s.heroes.push({});
      const old = s.heroes[i].name;
      s.heroes[i].name = name;
      emit(ctx, 'heroRenamed', { hero: heroId, old, name });
      return name;
    },
  };

  // ---- default Terms -----------------------------------------------------------
  // The keys commands read. project.js registers the shared table; only missing keys are added here (no replace warnings in either load order).
  const STRINGS = KIT.registry('strings');
  for (const d of [
    { id: 'got-item', default: 'Got {count} {item}!', doc: 'give with notify' },
    { id: 'lost-item', default: 'Lost {count} {item}.', doc: 'take with notify' },
    { id: 'save-prompt', default: 'Save your progress?' },
    { id: 'saved', default: 'Saved.' },
    { id: 'save-failed', default: 'Could not save.' },
    { id: 'yes', default: 'Yes' }, { id: 'no', default: 'No' }, { id: 'ok', default: 'OK' }, { id: 'cancel', default: 'Cancel' }, { id: 'continue', default: 'Continue' },
    { id: 'name-prompt', default: 'What is your name?' },
    { id: 'number-prompt', default: 'Enter a number' },
    { id: 'timer-up', default: 'Time is up!' },
  ]) if (!STRINGS.has(d.id)) STRINGS.add(d);

  // ---- line-form helpers (sugar) ----------------------------------------------

  const ESC = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
  const UNESC = (s) => String(s).replace(/\\(.)/g, (m, c) => (c === 'n' ? '\n' : c));
  const ESCQ = (s) => ESC(s).replace(/"/g, '\\"');
  /** Non-default keys of cmd (in field order) as `key=value` text; `skip` keys are omitted. */
  function pairsOf(def, cmd, skip) {
    const keys = keysFor(def, cmd).filter(k => !skip.includes(k));
    return keys.map(k => `${k}=${V.format(cmd[k])}`).join(' ');
  }
  /** '(a=1, b=x)' style option group. */
  const parenPairs = (def, cmd, keys) => { const ks = keysFor(def, cmd).filter(k => keys.includes(k)); return ks.length ? `(${ks.map(k => `${k}=${V.format(cmd[k])}`).join(', ')})` : ''; };
  const parseParens = (s) => { const o = {}; for (const tk of V.tokenize(s || '', { separators: ',' })) if (tk.key) o[tk.key] = tk.value; return o; };

  /** positional(def, keys) -> text sugar `@id v1 v2 … key=value` for the listed keys in order (only leading ones that are set). */
  function positional(id, keys) {
    return {
      toLine(cmd) {
        const def = reg.get(cmd.t);
        const words = [];
        for (const k of keys) { if (cmd[k] === undefined || cmd[k] === null) break; words.push(V.format(cmd[k])); }
        const used = keys.slice(0, words.length);
        const rest = pairsOf(def, cmd, used);
        return `@${id}${words.length ? ' ' + words.join(' ') : ''}${rest ? ' ' + rest : ''}`;
      },
      fromLine(line) {
        const m = new RegExp(`^@${id}(?:\\s+(.*))?$`).exec(line.trim());
        if (!m) return null;
        const cmd = { t: id };
        let pos = 0;
        for (const tk of V.tokenize(m[1] || '')) {
          if (tk.key) cmd[tk.key] = tk.value;
          else { if (pos >= keys.length) return null; cmd[keys[pos++]] = tk.value; }
        }
        return cmd;
      },
    };
  }

  const SAY_LINE = /^([^\s@?#":\-\[][^:(\n]*?)\s*(?:\(([^)]*)\))?:\s?(.*)$/;
  const SAY_WHO = /^[^\s@?#":\-\[][^:(\n]*$/;
  const NARRATION_LINE = /^"((?:[^"\\]|\\.)*)"\s*(?:\(([^)]*)\))?\s*$/;
  const sayOpts = (cmd) => { const o = {}; if (cmd.face) o.face = cmd.face; if (cmd.position && cmd.position !== 'bottom') o.at = cmd.position; if (cmd.bg && cmd.bg !== 'window') o.bg = cmd.bg; return Object.keys(o).map(k => `${k}=${V.format(o[k])}`).join(', '); };
  const sayFromOpts = (cmd, opts) => { if (opts.face !== undefined) cmd.face = opts.face; if (opts.at !== undefined) cmd.position = opts.at; if (opts.bg !== undefined) cmd.bg = opts.bg; return cmd; };

  const ROUTE_STEPS = 'up down left right randomStep towardHero awayHero face:<dir> faceHero turnRandom jump:dx,dy wait:ms sprite:<id> speed:n through:on|off visible:on|off sound:<id> dirFix:on|off stepAnim:on|off';

  // ---- baseline commands -------------------------------------------------------

  const defs = [];

  // Message
  defs.push({
    id: 'say', label: 'Show Text', mv: 'Show Text', group: 'Message', icon: 'speech', background: false, blocking: true, editor: { favourite: true },
    fields: [
      { key: 'who', type: 'string', default: '', label: 'Speaker' },
      { key: 'face', type: 'ref:face' },
      { key: 'text', type: 'text', default: '' },
      { key: 'position', type: 'enum', options: ['top', 'middle', 'bottom'], default: 'bottom' },
      { key: 'bg', type: 'enum', options: ['window', 'dim', 'none'], default: 'window', label: 'Background' },
    ],
    async run(ctx, cmd) {
      await port(ctx, 'io', 'say')({ who: T.substitute(cmd.who || '', ctx), face: cmd.face || null, text: T.substitute(cmd.text || '', ctx), position: cmd.position || 'bottom', bg: cmd.bg || 'window', raw: cmd.text || '' });
    },
    summary(cmd) { return `${cmd.who ? cmd.who + ': ' : ''}${short(T.strip(cmd.text), 60)}`; },
    text: {
      toLine(cmd) {
        const opts = sayOpts(cmd);
        if (!cmd.who) return `"${ESCQ(cmd.text)}"${opts ? ` (${opts})` : ''}`;
        if (!SAY_WHO.test(cmd.who) || /\s$/.test(cmd.who)) return null;
        return `${cmd.who}${opts ? ` (${opts})` : ''}:${cmd.text ? ' ' + ESC(cmd.text) : ''}`;
      },
      fromLine(line) {
        let m = NARRATION_LINE.exec(line);
        if (m) return sayFromOpts({ t: 'say', who: '', text: UNESC(m[1]) }, parseParens(m[2]));
        m = SAY_LINE.exec(line);
        if (!m) return null;
        return sayFromOpts({ t: 'say', who: m[1], text: UNESC(m[3] || '') }, parseParens(m[2]));
      },
    },
  });
  defs.push({
    id: 'choice', label: 'Show Choices', mv: 'Show Choices', group: 'Message', icon: 'list', background: false, blocking: true, control: true, editor: { favourite: true },
    fields: [
      { key: 'prompt', type: 'text', default: '' },
      { key: 'options', type: 'list', array: { min: 1 }, default: [], of: { type: 'group', fields: [{ key: 'text', type: 'string', default: '' }, { key: 'when', type: 'condition' }, { key: 'then', type: 'script' }] } },
      { key: 'cancel', type: 'enum', options: ['none', 'last', 'skip'], default: 'none', doc: 'B button: none = cannot cancel, last = picks the last option, skip = picks nothing' },
    ],
    async run(ctx, cmd) {
      const visible = [];
      (cmd.options || []).forEach((o, index) => { if (C.test(o.when, ctx)) visible.push({ text: T.substitute(o.text || '', ctx), index }); });
      if (!visible.length) return undefined;
      let i = await port(ctx, 'io', 'choice')({ prompt: T.substitute(cmd.prompt || '', ctx), options: visible, cancel: cmd.cancel || 'none' });
      if (i == null || i < 0 || i >= visible.length) {
        if (cmd.cancel === 'last') i = visible.length - 1; else return undefined;
      }
      return { kind: 'block', body: cmd.options[visible[i].index].then || [] };
    },
    summary(cmd) { return `Choice: ${short(T.strip(cmd.prompt), 30) || '…'} [${(cmd.options || []).map(o => short(o.text, 12)).join(' / ')}]`; },
    text: {
      toLine(cmd) { const p = parenPairs(reg.get('choice'), cmd, ['cancel']); return `?${cmd.prompt ? ' ' + ESC(cmd.prompt) : ''}${p ? ' ' + p : ''}`; },
      fromLine(line) {
        const m = /^\?(?:\s(.*))?$/.exec(line);
        if (!m) return null;
        let prompt = m[1] || '';
        const cmd = { t: 'choice', prompt: '', options: [] };
        const pm = /\s*\(([^()]*)\)\s*$/.exec(prompt);
        if (pm) { const o = parseParens(pm[1]); if (has(o, 'cancel')) { cmd.cancel = o.cancel; prompt = prompt.slice(0, pm.index); } }
        cmd.prompt = UNESC(prompt);
        return cmd;
      },
    },
  });
  /** Choice option lines: `- text` | `- text [when: cond]`. Screenplay uses these for the nested `- ` lines. */
  CMD.option = {
    toLine(opt) { return `- ${ESC(opt.text)}${opt.when ? ` [when: ${C.toText(opt.when)}]` : ''}`; },
    fromLine(line) {
      const m = /^-(?: (.*)|)$/.exec(line);
      if (!m) return null;
      let text = m[1] || '', when = null;
      const wm = /\s*\[when:\s*(.*)\]\s*$/.exec(text);
      if (wm) { when = C.parseText(wm[1]); text = text.slice(0, wm.index); }
      return { text: UNESC(text), when, then: [] };
    },
  };
  defs.push({
    id: 'inputNumber', label: 'Input Number', mv: 'Input Number', group: 'Message', icon: 'keypad', background: false, blocking: true,
    fields: [{ key: 'var', type: 'ref:var', nullable: false, access: 'write', label: 'Variable' }, { key: 'digits', type: 'number', integer: true, min: 1, max: 8, default: 3 }, { key: 'prompt', type: 'text', default: '' }],
    async run(ctx, cmd) {
      const n = await port(ctx, 'io', 'inputNumber')({ prompt: T.substitute(cmd.prompt || strings(ctx, 'number-prompt'), ctx), digits: cmd.digits || 3, current: Number(STATE.getVar(ctx, cmd.var)) || 0 });
      if (typeof n === 'number' && Number.isFinite(n)) STATE.setVar(ctx, cmd.var, n);
    },
    summary(cmd) { return `Input number → ${cmd.var}`; },
  });
  defs.push({
    id: 'scrollText', label: 'Show Scrolling Text', mv: 'Show Scrolling Text', group: 'Message', icon: 'scroll', background: false, blocking: true,
    fields: [{ key: 'text', type: 'text', default: '' }, { key: 'speed', type: 'number', min: 1, max: 8, default: 2 }, { key: 'noFast', type: 'bool', default: false, label: 'No fast forward' }],
    async run(ctx, cmd) { await port(ctx, 'io', 'scrollText')({ text: T.substitute(cmd.text || '', ctx), speed: cmd.speed || 2, noFast: !!cmd.noFast }); },
    summary(cmd) { return `Scroll: ${short(T.strip(cmd.text), 50)}`; },
  });

  // Progression
  const VAR_OPS = ['set', 'add', 'sub', 'mul', 'div', 'mod', 'random', 'copyVar'];
  const OP_SYM = { set: '=', add: '+=', sub: '-=', mul: '*=', div: '/=', mod: '%=' };
  const SYM_OP = { '=': 'set', '+=': 'add', '-=': 'sub', '*=': 'mul', '/=': 'div', '%=': 'mod' };
  function applyOp(op, cur, v) {
    const n = Number(cur) || 0, m = Number(v) || 0;
    switch (op) {
      case 'add': return n + m;
      case 'sub': return n - m;
      case 'mul': return n * m;
      case 'div': return m === 0 ? n : n / m;
      case 'mod': return m === 0 ? n : n % m;
      default: return v;
    }
  }
  defs.push({
    id: 'setVar', label: 'Control Variables', mv: 'Control Variables', group: 'Progression', icon: 'var', blocking: false, editor: { favourite: true },
    fields: [
      { key: 'name', type: 'ref:var', nullable: false, access: 'write', label: 'Variable' },
      { key: 'op', type: 'enum', options: VAR_OPS, default: 'set' },
      { key: 'value', type: 'scalar', default: 0, when: { field: 'op', in: ['set', 'add', 'sub', 'mul', 'div', 'mod'] } },
      { key: 'var', type: 'ref:var', label: 'From variable', when: { field: 'op', eq: 'copyVar' } },
      { key: 'min', type: 'number', integer: true, default: 1, when: { field: 'op', eq: 'random' } },
      { key: 'max', type: 'number', integer: true, default: 6, when: { field: 'op', eq: 'random' } },
    ],
    async run(ctx, cmd) {
      const op = cmd.op || 'set';
      let v;
      if (op === 'random') { const lo = Math.min(cmd.min, cmd.max), hi = Math.max(cmd.min, cmd.max); v = ctx.rng ? ctx.rng.range(lo, hi) : lo; }
      else if (op === 'copyVar') v = STATE.getVar(ctx, cmd.var);
      else v = applyOp(op, STATE.getVar(ctx, cmd.name), cmd.value);
      STATE.setVar(ctx, cmd.name, v === undefined ? null : v);
    },
    summary(cmd) {
      const op = cmd.op || 'set';
      if (op === 'random') return `${cmd.name} = random ${cmd.min}…${cmd.max}`;
      if (op === 'copyVar') return `${cmd.name} = {var:${cmd.var}}`;
      return `${cmd.name} ${OP_SYM[op]} ${V.format(cmd.value)}`;
    },
    text: {
      toLine(cmd) {
        const op = cmd.op || 'set';
        if (!V.WORD.test(cmd.name || '')) return null;
        if (op === 'random') return `@set ${cmd.name} = random(${Number(cmd.min) || 0}, ${Number(cmd.max) || 0})`;
        if (op === 'copyVar') return `@set ${cmd.name} = var:${cmd.var}`;
        return `@set ${cmd.name} ${OP_SYM[op]} ${V.format(cmd.value, { bare: V.WORD })}`;
      },
      fromLine(line) {
        const m = /^@set\s+(\S+)\s*(=|\+=|-=|\*=|\/=|%=)\s*(.*)$/.exec(line.trim());
        if (!m) return null;
        const cmd = { t: 'setVar', name: m[1], op: SYM_OP[m[2]] };
        const rest = m[3].trim();
        const rm = /^random\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/.exec(rest);
        if (rm && cmd.op === 'set') { cmd.op = 'random'; cmd.min = Number(rm[1]); cmd.max = Number(rm[2]); return cmd; }
        const vm = /^var:(\S+)$/.exec(rest);
        if (vm && cmd.op === 'set') { cmd.op = 'copyVar'; cmd.var = vm[1]; return cmd; }
        const sc = V.scan(rest, 0, '');
        cmd.value = sc && sc.end >= rest.length ? sc.value : rest;
        return cmd;
      },
    },
  });
  defs.push({
    id: 'setSelf', label: 'Self State', mv: 'Control Self Switch', group: 'Progression', icon: 'self', blocking: false, editor: { favourite: true },
    fields: [
      { key: 'key', type: 'string', min: 1, default: 'done' },
      { key: 'op', type: 'enum', options: ['set', 'add', 'sub', 'toggle'], default: 'set' },
      { key: 'value', type: 'scalar', default: true, when: { field: 'op', in: ['set', 'add', 'sub'] } },
    ],
    async run(ctx, cmd) {
      const op = cmd.op || 'set';
      const cur = STATE.getSelf(ctx, cmd.key);
      const v = op === 'toggle' ? !cur : applyOp(op, cur, cmd.value);
      STATE.setSelf(ctx, cmd.key, v);
    },
    summary(cmd) { const op = cmd.op || 'set'; return op === 'toggle' ? `self.${cmd.key} toggle` : `self.${cmd.key} ${OP_SYM[op]} ${V.format(cmd.value)}`; },
    text: {
      toLine(cmd) {
        const op = cmd.op || 'set';
        if (!V.WORD.test(cmd.key || '')) return null;
        if (op === 'toggle') return `@self ${cmd.key} toggle`;
        return `@self ${cmd.key} ${OP_SYM[op]} ${V.format(cmd.value, { bare: V.WORD })}`;
      },
      fromLine(line) {
        let m = /^@self\s+(\S+)\s+toggle$/.exec(line.trim());
        if (m) return { t: 'setSelf', key: m[1], op: 'toggle' };
        m = /^@self\s+(\S+)\s*(=|\+=|-=)\s*(.*)$/.exec(line.trim());
        if (!m) return null;
        const rest = m[3].trim();
        const sc = V.scan(rest, 0, '');
        return { t: 'setSelf', key: m[1], op: SYM_OP[m[2]], value: sc && sc.end >= rest.length ? sc.value : rest };
      },
    },
  });
  defs.push({
    id: 'timer', label: 'Control Timer', mv: 'Control Timer', group: 'Progression', icon: 'timer', blocking: false,
    fields: [{ key: 'op', type: 'enum', options: ['start', 'stop'], default: 'start' }, { key: 'seconds', type: 'number', min: 0, default: 60, when: { field: 'op', eq: 'start' } }],
    async run(ctx, cmd) {
      const s = save(ctx);
      s.timer = cmd.op === 'stop' ? { running: false, secondsLeft: 0 } : { running: true, secondsLeft: Number(cmd.seconds) || 0 };
      emit(ctx, 'timerChanged', Object.assign({}, s.timer));
    },
    summary(cmd) { return cmd.op === 'stop' ? 'Stop timer' : `Start timer ${cmd.seconds}s`; },
  });

  // Flow
  defs.push({
    id: 'if', label: 'Conditional Branch', mv: 'Conditional Branch', group: 'Flow', icon: 'branch', blocking: false, control: true, editor: { favourite: true },
    fields: [{ key: 'when', type: 'condition' }, { key: 'then', type: 'script' }, { key: 'else', type: 'script' }],
    async run(ctx, cmd) { return { kind: 'block', body: (C.test(cmd.when, ctx) ? cmd.then : cmd.else) || [] }; },
    summary(cmd, ctx) { return `If ${C.describe(cmd.when, ctx)}`; },
    text: {
      elseLine: '@else', endLine: '@end',
      toLine(cmd) { return cmd.when ? `@if when: ${C.toText(cmd.when)}` : '@if'; },
      fromLine(line) {
        const m = /^@if(?:\s+(?:when:\s*)?(.*))?$/.exec(line.trim());
        if (!m) return null;
        return { t: 'if', when: m[1] ? C.parseText(m[1]) : null, then: [], else: [] };
      },
    },
  });
  defs.push({
    id: 'loop', label: 'Loop', mv: 'Loop', group: 'Flow', icon: 'loop', blocking: false, control: true,
    fields: [{ key: 'body', type: 'script' }],
    async run(ctx, cmd) { return { kind: 'block', body: cmd.body || [], loop: true }; },
    summary() { return 'Loop'; },
    text: { endLine: '@end' },
  });
  defs.push({ id: 'break', label: 'Break Loop', mv: 'Break Loop', group: 'Flow', icon: 'break', blocking: false, control: true, fields: [], async run() { return { kind: 'break' }; }, summary() { return 'Break loop'; } });
  defs.push({ id: 'label', label: 'Label', mv: 'Label', group: 'Flow', icon: 'label', blocking: false, fields: [{ key: 'name', type: 'string', min: 1, default: 'here' }], async run() { return undefined; }, summary(cmd) { return `Label ${cmd.name}`; }, text: positional('label', ['name']) });
  defs.push({ id: 'jump', label: 'Jump to Label', mv: 'Jump to Label', group: 'Flow', icon: 'jump', blocking: false, control: true, fields: [{ key: 'label', type: 'string', min: 1, default: 'here' }], async run(ctx, cmd) { return { kind: 'jump', label: cmd.label }; }, summary(cmd) { return `Jump to ${cmd.label}`; }, text: positional('jump', ['label']) });
  defs.push({ id: 'exit', label: 'Exit Event Processing', mv: 'Exit Event Processing', group: 'Flow', icon: 'exit', blocking: false, control: true, fields: [], async run() { return { kind: 'exit' }; }, summary() { return 'Exit'; } });
  defs.push({
    id: 'call', label: 'Common Event', mv: 'Common Event', group: 'Flow', icon: 'call', blocking: true, control: true,
    fields: [{ key: 'script', type: 'ref:script', nullable: false }, { key: 'args', type: 'list', default: [], of: { type: 'group', fields: [{ key: 'name', type: 'string', min: 1 }, { key: 'value', type: 'scalar', default: '' }] } }],
    async run(ctx, cmd) {
      const args = {};
      for (const a of cmd.args || []) if (a && a.name) args[a.name] = a.value;
      return { kind: 'call', script: cmd.script, args };
    },
    summary(cmd) { return `Call ${cmd.script}${(cmd.args || []).length ? ` (${cmd.args.map(a => `${a.name}=${V.format(a.value)}`).join(', ')})` : ''}`; },
    text: {
      toLine(cmd) {
        if (!cmd.script || !V.BARE.test(cmd.script) || V.NUMBER.test(cmd.script)) return null;
        if ((cmd.args || []).some(a => !/^[A-Za-z_][\w-]*$/.test(a.name || ''))) return null;
        const extra = pairsOf(reg.get('call'), cmd, ['script', 'args']);
        return `@call ${cmd.script}${(cmd.args || []).map(a => ` ${a.name}=${V.format(a.value)}`).join('')}${extra ? ' ' + extra : ''}`;
      },
      fromLine(line) {
        const m = /^@call\s+(\S+)(?:\s+(.*))?$/.exec(line.trim());
        if (!m || m[1].includes('=')) return null;
        const cmd = { t: 'call', script: m[1], args: [] };
        for (const tk of V.tokenize(m[2] || '')) {
          if (!tk.key) return null;
          cmd.args.push({ name: tk.key, value: tk.value });
        }
        return cmd;
      },
    },
  });
  defs.push({
    id: 'comment', label: 'Comment', mv: 'Comment', group: 'Flow', icon: 'comment', blocking: false,
    fields: [{ key: 'text', type: 'text', default: '' }],
    async run() { return undefined; },
    summary(cmd) { return `# ${short(cmd.text, 60)}`; },
    text: {
      toLine(cmd) { return `#${cmd.text ? ' ' + ESC(cmd.text) : ''}`; },
      fromLine(line) { const m = /^#(?: ?(.*))?$/.exec(line); return m ? { t: 'comment', text: UNESC(m[1] || '') } : null; },
    },
  });
  defs.push({
    id: 'wait', label: 'Wait', mv: 'Wait', group: 'Flow', icon: 'wait', blocking: true,
    fields: [{ key: 'ms', type: 'number', min: 0, default: 500 }],
    async run(ctx, cmd) { await port(ctx, 'io', 'wait')(Number(cmd.ms) || 0); },
    summary(cmd) { return `Wait ${cmd.ms} ms`; },
    text: positional('wait', ['ms']),
  });
  defs.push({
    id: 'meanwhile', label: 'At the Same Time', group: 'Flow', icon: 'tracks', blocking: true, control: true, editor: { favourite: true },
    doc: 'Runs several things at once — someone walks while someone else talks while the music fades.',
    fields: [
      { key: 'tracks', type: 'list', array: { min: 1 }, default: [], label: 'Tracks',
        of: { type: 'group', fields: [{ key: 'label', type: 'string', default: '' }, { key: 'body', type: 'script' }] } },
      { key: 'wait', type: 'bool', default: true, label: 'Wait for them to finish', doc: 'Off: the scene carries on while they run.' },
      { key: 'race', type: 'bool', default: false, label: 'Carry on after the first one', when: { field: 'wait', eq: true } },
    ],
    async run(ctx, cmd) { return { kind: 'tracks', tracks: cmd.tracks || [], wait: cmd.wait !== false, race: !!cmd.race }; },
    summary(cmd) { const n = (cmd.tracks || []).length; return `At the same time (${n} track${n === 1 ? '' : 's'})${cmd.wait === false ? ', carry on' : ''}`; },
    text: {
      endLine: '@end', listField: 'tracks', itemPrefix: '---', itemLabel: 'label', itemBody: 'body',
      toLine(cmd) {
        const bits = [];
        if (cmd.wait === false) bits.push('wait=false');
        if (cmd.race) bits.push('race=true');
        return `@meanwhile${bits.length ? ' ' + bits.join(' ') : ''}`;
      },
      fromLine(line) {
        const m = /^@meanwhile(?:\s+(.*))?$/.exec(line.trim());
        if (!m) return null;
        const cmd = { t: 'meanwhile', tracks: [] };
        for (const tk of V.tokenize(m[1] || '')) { if (!tk.key) return null; cmd[tk.key] = tk.value; }
        return cmd;
      },
    },
  });
  defs.push({
    id: 'group', label: 'Group', group: 'Flow', icon: 'folder', blocking: false, control: true,
    fields: [{ key: 'label', type: 'string', default: '' }, { key: 'body', type: 'script' }],
    async run(ctx, cmd) { return { kind: 'block', body: cmd.body || [] }; },
    summary(cmd) { return cmd.label || 'Group'; },
    text: { endLine: '@end' },
  });

  // Party
  const itemChange = (mode) => ({
    id: mode, label: mode === 'give' ? 'Change Items (give)' : 'Change Items (take)', mv: 'Change Items', group: 'Party', icon: 'bag', blocking: false, editor: { favourite: mode === 'give' },
    fields: [{ key: 'item', type: 'ref:item', nullable: false }, { key: 'count', type: 'number', integer: true, min: 1, default: 1 }, { key: 'notify', type: 'bool', default: false, doc: 'Show a "Got …" toast' }],
    async run(ctx, cmd) {
      const n = Math.max(1, Number(cmd.count) || 1);
      STATE.give(ctx, cmd.item, mode === 'give' ? n : -n);
      if (cmd.notify) await port(ctx, 'io', 'toast')({ text: strings(ctx, mode === 'give' ? 'got-item' : 'lost-item', { count: n, item: itemName(ctx, cmd.item) }) });
    },
    summary(cmd, ctx) { return `${mode === 'give' ? 'Give' : 'Take'} ${cmd.count}× ${itemName(ctx, cmd.item)}`; },
  });
  defs.push(itemChange('give'), itemChange('take'));
  defs.push({
    id: 'nameEntry', label: 'Name Input', mv: 'Name Input Processing', group: 'Party', icon: 'name', background: false, blocking: true,
    fields: [heroField('hero'), { key: 'prompt', type: 'text', default: '' }, { key: 'maxLength', type: 'number', integer: true, min: 1, max: 16, default: 8 }],
    async run(ctx, cmd) {
      const hero = heroIdFor(ctx, cmd.hero);
      const name = await port(ctx, 'io', 'nameEntry')({ hero, prompt: T.substitute(cmd.prompt || strings(ctx, 'name-prompt'), ctx), maxLength: cmd.maxLength || 8, current: STATE.heroName(ctx, hero) });
      if (typeof name === 'string' && name.trim()) STATE.setHeroName(ctx, hero, name.trim().slice(0, cmd.maxLength || 8));
    },
    summary(cmd) { return `Name entry for ${cmd.hero || 'hero'}`; },
  });

  // Movement
  defs.push({
    id: 'transfer', label: 'Transfer Player', mv: 'Transfer Player', group: 'Movement', icon: 'door', blocking: true, editor: { favourite: true },
    fields: [{ key: 'map', type: 'ref:map', nullable: false }, { key: 'x', type: 'number', integer: true, min: 0, default: 0 }, { key: 'y', type: 'number', integer: true, min: 0, default: 0 }, { key: 'dir', type: 'direction', default: 'down' }, { key: 'fade', type: 'bool', default: true }],
    async run(ctx, cmd) { await port(ctx, 'map', 'transfer')({ map: cmd.map, x: cmd.x || 0, y: cmd.y || 0, dir: cmd.dir || 'down', fade: cmd.fade !== false }); },
    summary(cmd) { return `Transfer to ${cmd.map} (${cmd.x}, ${cmd.y}) facing ${cmd.dir}`; },
    text: positional('transfer', ['map', 'x', 'y', 'dir']),
  });
  defs.push({
    id: 'setLocation', label: 'Set Event Location', mv: 'Set Event Location', group: 'Movement', icon: 'pin', blocking: false,
    fields: [targetField('self'), { key: 'x', type: 'number', integer: true, min: 0, default: 0 }, { key: 'y', type: 'number', integer: true, min: 0, default: 0 }, { key: 'swap', type: 'ref:object', doc: 'Swap places with this object instead' }],
    async run(ctx, cmd) { await port(ctx, 'map', 'setLocation')({ target: cmd.target || 'self', x: cmd.x || 0, y: cmd.y || 0, swap: cmd.swap || null }); },
    summary(cmd) { return cmd.swap ? `Swap ${C.targetLabel(cmd.target)} with ${cmd.swap}` : `Move ${C.targetLabel(cmd.target)} to (${cmd.x}, ${cmd.y})`; },
  });
  defs.push({
    id: 'moveRoute', label: 'Set Movement Route', mv: 'Set Movement Route', group: 'Movement', icon: 'route', blocking: true, editor: { favourite: true },
    fields: [targetField('self'), { key: 'steps', type: 'route', default: [], doc: ROUTE_STEPS }, { key: 'wait', type: 'bool', default: true }, { key: 'skipBlocked', type: 'bool', default: true }, { key: 'repeat', type: 'bool', default: false }],
    async run(ctx, cmd) { await port(ctx, 'map', 'moveRoute')({ target: cmd.target || 'self', steps: (cmd.steps || []).slice(), wait: cmd.wait !== false, skipBlocked: cmd.skipBlocked !== false, repeat: !!cmd.repeat }); },
    summary(cmd) { return `Move ${C.targetLabel(cmd.target)}: ${short((cmd.steps || []).join(' '), 40) || '(no steps)'}`; },
    text: {
      toLine(cmd) {
        if (!V.BARE.test(cmd.target || '') || (cmd.steps || []).some(s => !/^[^\s()"]+$/.test(s))) return null;
        const p = parenPairs(reg.get('moveRoute'), cmd, ['wait', 'skipBlocked', 'repeat']);
        return `@move ${cmd.target}${p ? ' ' + p : ''}: ${(cmd.steps || []).join(' ')}`.replace(/:\s$/, ':');
      },
      fromLine(line) {
        const m = /^@move\s+(\S+?)\s*(?:\(([^)]*)\))?:(?:\s+(.*)|)$/.exec(line.trim());   // the colon ends the target only when followed by a space or the line end
        if (!m) return null;
        const cmd = Object.assign({ t: 'moveRoute', target: m[1] }, parseParens(m[2]));
        cmd.steps = (m[3] || '').split(/\s+/).filter(Boolean);
        return cmd;
      },
    },
  });
  defs.push({
    id: 'scrollMap', label: 'Scroll Map', mv: 'Scroll Map', group: 'Movement', icon: 'camera', blocking: true,
    fields: [{ key: 'dx', type: 'number', integer: true, default: 0 }, { key: 'dy', type: 'number', integer: true, default: 0 }, { key: 'speed', type: 'number', min: 1, max: 8, default: 4 }],
    async run(ctx, cmd) { await port(ctx, 'map', 'scrollMap')({ dx: cmd.dx || 0, dy: cmd.dy || 0, speed: cmd.speed || 4 }); },
    summary(cmd) { return `Scroll map by (${cmd.dx}, ${cmd.dy})`; },
  });
  defs.push({
    id: 'follow', label: 'Companion Follow', group: 'Movement', icon: 'follow', blocking: false,
    fields: [{ key: 'on', type: 'bool', default: true }],
    async run(ctx, cmd) { await port(ctx, 'map', 'follow')({ on: cmd.on !== false }); },
    summary(cmd) { return `Companion follow ${cmd.on !== false ? 'on' : 'off'}`; },
  });

  // Character
  defs.push({
    id: 'transparency', label: 'Change Transparency', mv: 'Change Transparency', group: 'Character', icon: 'ghost', blocking: false,
    fields: [targetField('hero'), { key: 'on', type: 'bool', default: true }],
    async run(ctx, cmd) { await port(ctx, 'map', 'transparency')({ target: cmd.target || 'hero', on: cmd.on !== false }); },
    summary(cmd) { return `${C.targetLabel(cmd.target)} transparent ${cmd.on !== false ? 'on' : 'off'}`; },
  });
  defs.push({
    id: 'animation', label: 'Show Animation', mv: 'Show Animation', group: 'Character', icon: 'sparkle', blocking: true,
    fields: [targetField('self'), { key: 'id', type: 'string', min: 1, default: 'sparkle', label: 'Animation' }],
    async run(ctx, cmd) { await port(ctx, 'map', 'animation')({ target: cmd.target || 'self', id: cmd.id }); },
    summary(cmd) { return `Animation ${cmd.id} on ${C.targetLabel(cmd.target)}`; },
  });
  defs.push({
    id: 'balloon', label: 'Show Balloon Icon', mv: 'Show Balloon Icon', group: 'Character', icon: 'balloon', blocking: true,
    fields: [targetField('self'), { key: 'kind', type: 'enum', options: ['!', '?', '♥', '♪', '…', 'zzz', 'sweat', 'anger'], default: '!' }, { key: 'wait', type: 'bool', default: false }],
    async run(ctx, cmd) { await port(ctx, 'map', 'balloon')({ target: cmd.target || 'self', kind: cmd.kind || '!', wait: !!cmd.wait }); },
    summary(cmd) { return `Balloon ${cmd.kind} on ${C.targetLabel(cmd.target)}`; },
    text: positional('balloon', ['target', 'kind']),
  });
  defs.push({
    id: 'erase', label: 'Erase Event', mv: 'Erase Event', group: 'Character', icon: 'erase', blocking: false,
    fields: [targetField('self'), { key: 'persistent', type: 'bool', default: false, doc: 'Stays hidden after leaving the map (saved)' }],
    async run(ctx, cmd) {
      const target = cmd.target || 'self';
      if (cmd.persistent) {
        const t = C.target(ctx, target);
        if (t.key) {
          const s = save(ctx); s.objects = s.objects || {};
          const o = s.objects[t.key] || (s.objects[t.key] = { self: {} });
          o.hidden = true;
          emit(ctx, 'objectStateChanged', { objectKey: t.key });
        }
      }
      await port(ctx, 'map', 'erase')({ target, persistent: !!cmd.persistent });
    },
    summary(cmd) { return `Erase ${C.targetLabel(cmd.target)}${cmd.persistent ? ' (for good)' : ''}`; },
  });

  // Screen
  const screen = (id, label, fields, args, summary, text) => ({
    id, label, mv: label, group: 'Screen', icon: 'screen', blocking: true, fields,
    async run(ctx, cmd) { await port(ctx, 'screen', id)(args(cmd)); },
    summary, text,
  });
  const fadeSugar = (dir) => ({
    toLine(cmd) { const rest = pairsOf(reg.get(cmd.t), cmd, []); return `@fade ${dir}${rest ? ' ' + rest : ''}`; },
    fromLine(line) {
      const m = new RegExp(`^@fade\\s+${dir}(?:\\s+(.*))?$`).exec(line.trim());
      if (!m) return null;
      const cmd = { t: dir === 'out' ? 'fadeOut' : 'fadeIn' };
      for (const tk of V.tokenize(m[1] || '')) { if (!tk.key) return null; cmd[tk.key] = tk.value; }
      return cmd;
    },
  });
  defs.push(screen('fadeOut', 'Fadeout Screen', [{ key: 'ms', type: 'number', min: 0, default: 400 }, { key: 'color', type: 'color', default: '#000000' }], (c) => ({ ms: c.ms == null ? 400 : c.ms, color: c.color || '#000000' }), (c) => `Fade out (${c.ms} ms)`, fadeSugar('out')));
  defs.push(screen('fadeIn', 'Fadein Screen', [{ key: 'ms', type: 'number', min: 0, default: 400 }], (c) => ({ ms: c.ms == null ? 400 : c.ms }), (c) => `Fade in (${c.ms} ms)`, fadeSugar('in')));
  defs.push(screen('tint', 'Tint Screen', [{ key: 'color', type: 'color', default: '#000000' }, { key: 'amount', type: 'number', min: 0, max: 1, default: 0 }, { key: 'ms', type: 'number', min: 0, default: 400 }], (c) => ({ color: c.color || '#000000', amount: c.amount || 0, ms: c.ms == null ? 400 : c.ms }), (c) => `Tint ${c.color} ${Math.round((c.amount || 0) * 100)}%`));
  defs.push(screen('flash', 'Flash Screen', [{ key: 'color', type: 'color', default: '#ffffff' }, { key: 'ms', type: 'number', min: 0, default: 200 }], (c) => ({ color: c.color || '#ffffff', ms: c.ms == null ? 200 : c.ms }), (c) => `Flash ${c.color}`));
  defs.push(screen('shake', 'Shake Screen', [{ key: 'power', type: 'number', min: 1, max: 9, default: 3 }, { key: 'ms', type: 'number', min: 0, default: 400 }], (c) => ({ power: c.power || 3, ms: c.ms == null ? 400 : c.ms }), (c) => `Shake (${c.power})`, positional('shake', [])));
  defs.push(screen('weather', 'Set Weather Effect', [{ key: 'kind', type: 'enum', options: ['none', 'rain', 'snow', 'fog'], default: 'none' }, { key: 'power', type: 'number', min: 1, max: 9, default: 5 }, { key: 'ms', type: 'number', min: 0, default: 400 }], (c) => ({ kind: c.kind || 'none', power: c.power || 5, ms: c.ms == null ? 400 : c.ms }), (c) => `Weather: ${c.kind}`));

  // Atmosphere and camera — the look of a place, and how it is framed.
  defs.push({
    id: 'atmosphere', label: 'Atmosphere', group: 'Screen', icon: 'weather', blocking: true, editor: { favourite: true },
    doc: 'Darkness, fog, a colour wash, grain, vignette, letterbox — faded over time.',
    fields: [
      { key: 'darkness', type: 'number', min: 0, max: 1, default: 0, doc: 'How dark it is away from the lights.' },
      { key: 'ambient', type: 'color', default: '#05070d', doc: 'What colour that darkness is.' },
      { key: 'tintColor', type: 'color', default: '#ffffff', label: 'Wash colour' },
      { key: 'tintAmount', type: 'number', min: 0, max: 1, default: 0, label: 'Wash' },
      { key: 'fogColor', type: 'color', default: '#b8c6d8', label: 'Fog colour' },
      { key: 'fogAmount', type: 'number', min: 0, max: 1, default: 0, label: 'Fog' },
      { key: 'grain', type: 'number', min: 0, max: 1, default: 0 },
      { key: 'vignette', type: 'number', min: 0, max: 1, default: 0 },
      { key: 'letterbox', type: 'number', min: 0, max: 0.3, default: 0, doc: 'Black bars, as a share of the screen.' },
      { key: 'lightScale', type: 'number', min: 0, max: 4, default: 1, label: 'Light reach' },
      { key: 'ms', type: 'number', min: 0, default: 800, label: 'Fade over' },
      { key: 'wait', type: 'bool', default: false, label: 'Wait for the fade' },
    ],
    async run(ctx, cmd) {
      const A = KIT.atmosphere;
      if (!A) return;
      A.set({
        darkness: cmd.darkness, ambient: cmd.ambient, grain: cmd.grain, vignette: cmd.vignette,
        letterbox: cmd.letterbox, lightScale: cmd.lightScale,
        tint: cmd.tintAmount > 0 ? { color: cmd.tintColor, amount: cmd.tintAmount } : null,
        fog: cmd.fogAmount > 0 ? { color: cmd.fogColor, amount: cmd.fogAmount, speed: 0.02, scale: 6 } : null,
      }, { ms: cmd.ms == null ? 800 : cmd.ms });
      if (cmd.wait && ctx.io && ctx.io.wait) await ctx.io.wait(cmd.ms == null ? 800 : cmd.ms);
    },
    summary(cmd) {
      const bits = [];
      if (cmd.darkness) bits.push(`dark ${Math.round(cmd.darkness * 100)}%`);
      if (cmd.fogAmount) bits.push('fog');
      if (cmd.tintAmount) bits.push('wash');
      if (cmd.grain) bits.push('grain');
      if (cmd.vignette) bits.push('vignette');
      if (cmd.letterbox) bits.push('letterbox');
      return `Atmosphere: ${bits.join(', ') || 'clear'}`;
    },
  });
  defs.push({
    id: 'camera', label: 'Camera', group: 'Movement', icon: 'camera', blocking: true, editor: { favourite: true },
    doc: 'Frame the scene: follow someone else, pull back, hold on a place, then let go.',
    fields: [
      { key: 'mode', type: 'enum', options: ['follow', 'point', 'release'], default: 'follow',
        doc: 'follow: keep someone in frame. point: hold on a place. release: back to the hero.' },
      targetField('hero'), 
      { key: 'x', type: 'number', integer: true, min: 0, default: 0, when: { field: 'mode', eq: 'point' } },
      { key: 'y', type: 'number', integer: true, min: 0, default: 0, when: { field: 'mode', eq: 'point' } },
      { key: 'zoom', type: 'number', min: 0.25, max: 4, default: 1, doc: '1 is normal. Under 1 pulls back; over 1 pushes in.' },
      { key: 'ms', type: 'number', min: 0, default: 600, label: 'Move over' },
      { key: 'wait', type: 'bool', default: true, label: 'Wait for the move' },
    ],
    async run(ctx, cmd) {
      await port(ctx, 'map', 'camera')({ mode: cmd.mode || 'follow', target: cmd.target || 'hero', x: cmd.x || 0, y: cmd.y || 0, zoom: cmd.zoom == null ? 1 : cmd.zoom, ms: cmd.ms == null ? 600 : cmd.ms, wait: cmd.wait !== false });
    },
    summary(cmd) {
      if (cmd.mode === 'release') return 'Camera: back to the hero';
      const where = cmd.mode === 'point' ? `(${cmd.x}, ${cmd.y})` : C.targetLabel(cmd.target);
      return `Camera: ${where}${cmd.zoom && cmd.zoom !== 1 ? ` at ${cmd.zoom}×` : ''}`;
    },
  });
  defs.push({
    id: 'shift', label: 'Shift', group: 'Movement', icon: 'shift', blocking: true, editor: { favourite: true },
    doc: 'Step into another layer of this same place — or back to the ordinary one. You keep your position; the world changes around you.',
    fields: [
      { key: 'to', type: 'string', default: '', label: 'Layer', doc: 'The name of a layer this map declares. Empty means back to the ordinary one.' },
      { key: 'effect', type: 'enum', options: ['none', 'flash', 'fade', 'blink'], default: 'flash', label: 'How it happens' },
      { key: 'ms', type: 'number', min: 0, default: 300 },
    ],
    async run(ctx, cmd) {
      const ms = cmd.ms == null ? 300 : cmd.ms;
      const effect = cmd.effect || 'flash';
      if (effect === 'fade') await port(ctx, 'screen', 'fadeOut')({ ms: ms, color: '#000000' });
      else if (effect === 'flash') await port(ctx, 'screen', 'flash')({ color: '#ffffff', ms: Math.max(80, ms / 2) });
      else if (effect === 'blink') await port(ctx, 'screen', 'flash')({ color: '#000000', ms: Math.max(60, ms / 3) });
      await port(ctx, 'map', 'shift')({ to: cmd.to || null, ms });
      if (effect === 'fade') await port(ctx, 'screen', 'fadeIn')({ ms });
    },
    summary(cmd) { return cmd.to ? `Shift into “${cmd.to}”` : 'Shift back'; },
    text: {
      toLine(cmd) { const rest = pairsOf(reg.get('shift'), cmd, ['to']); return `@shift ${cmd.to ? V.format(cmd.to) : 'back'}${rest ? ' ' + rest : ''}`; },
      fromLine(line) {
        const m = /^@shift(?:\s+(.*))?$/.exec(line.trim());
        if (!m || !m[1]) return null;
        const first = V.scan(m[1], 0, '');                       // a layer name may be quoted
        if (!first || first.error) return null;
        if (/^[A-Za-z_][\w\-.]*=/.test(m[1].trim())) return null;   // '@shift key=value' is the generic form
        const cmd = { t: 'shift', to: (first.value === 'back' || first.value === 'none') ? '' : first.value };
        for (const tk of V.tokenize(m[1].slice(first.end))) { if (!tk.key) return null; cmd[tk.key] = tk.value; }
        return cmd;
      },
    },
  });
  defs.push({
    id: 'light', label: 'Light', group: 'Character', icon: 'sparkle', blocking: false,
    doc: 'Give something a light, or take it away. Works on the hero (a lantern) or any event.',
    fields: [
      targetField('self'),
      { key: 'radius', type: 'number', min: 0, max: 30, default: 4, doc: 'In tiles. 0 puts it out.' },
      { key: 'color', type: 'color', default: '#ffd9a0' },
      { key: 'flicker', type: 'number', min: 0, max: 1, default: 0 },
      { key: 'softness', type: 'number', min: 0, max: 0.95, default: 0.45 },
    ],
    async run(ctx, cmd) { await port(ctx, 'map', 'light')({ target: cmd.target || 'self', radius: cmd.radius, color: cmd.color, flicker: cmd.flicker, softness: cmd.softness }); },
    summary(cmd) { return cmd.radius > 0 ? `Light on ${C.targetLabel(cmd.target)} (${cmd.radius} tiles)` : `Put out ${C.targetLabel(cmd.target)}'s light`; },
  });

  // Pictures
  defs.push({
    id: 'pictureShow', label: 'Show Picture', mv: 'Show Picture', group: 'Picture', icon: 'picture', blocking: false,
    fields: [{ key: 'id', type: 'string', min: 1, default: 'pic1' }, { key: 'image', type: 'string', default: '' }, { key: 'x', type: 'number', default: 0 }, { key: 'y', type: 'number', default: 0 }, { key: 'anchor', type: 'enum', options: ['topLeft', 'center'], default: 'topLeft' }, { key: 'opacity', type: 'number', min: 0, max: 1, default: 1 }],
    async run(ctx, cmd) { await port(ctx, 'pictures', 'show')({ id: cmd.id, image: cmd.image || '', x: cmd.x || 0, y: cmd.y || 0, anchor: cmd.anchor || 'topLeft', opacity: cmd.opacity == null ? 1 : cmd.opacity }); },
    summary(cmd) { return `Show picture ${cmd.id} (${cmd.image})`; },
  });
  defs.push({
    id: 'pictureMove', label: 'Move Picture', mv: 'Move Picture', group: 'Picture', icon: 'picture', blocking: true,
    fields: [{ key: 'id', type: 'string', min: 1, default: 'pic1' }, { key: 'x', type: 'number', default: 0 }, { key: 'y', type: 'number', default: 0 }, { key: 'opacity', type: 'number', min: 0, max: 1, default: 1 }, { key: 'ms', type: 'number', min: 0, default: 400 }, { key: 'wait', type: 'bool', default: true }],
    async run(ctx, cmd) { await port(ctx, 'pictures', 'move')({ id: cmd.id, x: cmd.x || 0, y: cmd.y || 0, opacity: cmd.opacity == null ? 1 : cmd.opacity, ms: cmd.ms == null ? 400 : cmd.ms, wait: cmd.wait !== false }); },
    summary(cmd) { return `Move picture ${cmd.id} to (${cmd.x}, ${cmd.y})`; },
  });
  defs.push({
    id: 'pictureErase', label: 'Erase Picture', mv: 'Erase Picture', group: 'Picture', icon: 'picture', blocking: false,
    fields: [{ key: 'id', type: 'string', min: 1, default: 'pic1' }],
    async run(ctx, cmd) { await port(ctx, 'pictures', 'erase')({ id: cmd.id }); },
    summary(cmd) { return `Erase picture ${cmd.id}`; },
  });

  // Audio
  defs.push({
    id: 'music', label: 'Play BGM', mv: 'Play BGM', group: 'Audio', icon: 'music', blocking: false, editor: { favourite: true },
    fields: [{ key: 'id', type: 'ref:music', label: 'Track', doc: 'Empty = stop the music' }, { key: 'fade', type: 'number', min: 0, default: 0, label: 'Fade ms' }, { key: 'volume', type: 'number', min: 0, max: 1, default: 1 }],
    async run(ctx, cmd) { await port(ctx, 'audio', 'music')(cmd.id || null, { fade: cmd.fade || 0, volume: cmd.volume == null ? 1 : cmd.volume }); },
    summary(cmd) { return cmd.id ? `Music: ${cmd.id}` : 'Stop music'; },
    text: {
      toLine(cmd) { const rest = pairsOf(reg.get('music'), cmd, ['id']); return `@music ${cmd.id ? V.format(cmd.id) : 'none'}${rest ? ' ' + rest : ''}`; },
      fromLine(line) {
        const m = /^@music\s+(\S+)(?:\s+(.*))?$/.exec(line.trim());
        if (!m || m[1].includes('=')) return null;
        const cmd = { t: 'music', id: m[1] === 'none' || m[1] === 'null' || m[1] === 'stop' ? null : V.parseBare(m[1]) };
        for (const tk of V.tokenize(m[2] || '')) { if (!tk.key) return null; cmd[tk.key] = tk.value; }
        return cmd;
      },
    },
  });
  defs.push({
    id: 'sound', label: 'Play SE', mv: 'Play SE', group: 'Audio', icon: 'sound', blocking: false, editor: { favourite: true },
    fields: [{ key: 'id', type: 'ref:sound', nullable: false, label: 'Sound' }, { key: 'volume', type: 'number', min: 0, max: 1, default: 1 }],
    async run(ctx, cmd) { await port(ctx, 'audio', 'play')(cmd.id, { volume: cmd.volume == null ? 1 : cmd.volume }); },
    summary(cmd) { return `Sound: ${cmd.id}`; },
    text: positional('sound', ['id']),
  });
  defs.push({ id: 'stopSound', label: 'Stop SE', mv: 'Stop SE', group: 'Audio', icon: 'sound', blocking: false, fields: [], async run(ctx) { await port(ctx, 'audio', 'stop')('sound'); }, summary() { return 'Stop sounds'; } });
  defs.push({ id: 'saveMusic', label: 'Save BGM', mv: 'Save BGM', group: 'Audio', icon: 'music', blocking: false, fields: [], async run(ctx) { await port(ctx, 'audio', 'save')(); }, summary() { return 'Remember music'; } });
  defs.push({ id: 'replayMusic', label: 'Replay BGM', mv: 'Replay BGM', group: 'Audio', icon: 'music', blocking: false, fields: [], async run(ctx) { await port(ctx, 'audio', 'replay')(); }, summary() { return 'Resume remembered music'; } });
  defs.push({
    id: 'jingle', label: 'Play ME', mv: 'Play ME', group: 'Audio', icon: 'music', blocking: true,
    fields: [{ key: 'id', type: 'ref:music', nullable: false, label: 'Jingle' }],
    async run(ctx, cmd) { await port(ctx, 'audio', 'jingle')(cmd.id); },
    summary(cmd) { return `Jingle: ${cmd.id}`; },
    text: positional('jingle', ['id']),
  });

  // System
  defs.push({ id: 'menu', label: 'Open Menu Screen', mv: 'Open Menu Screen', group: 'System', icon: 'menu', background: false, blocking: true, fields: [], async run(ctx) { await port(ctx, 'game', 'menu')(); }, summary() { return 'Open menu'; } });
  defs.push({
    id: 'save', label: 'Open Save Screen', mv: 'Open Save Screen', group: 'System', icon: 'save', background: false, blocking: true,
    fields: [{ key: 'prompt', type: 'bool', default: true, doc: 'Ask first' }, { key: 'slot', type: 'string', default: 'autosave' }],
    async run(ctx, cmd) {
      if (cmd.prompt !== false) {
        const i = await port(ctx, 'io', 'choice')({ prompt: strings(ctx, 'save-prompt'), options: [{ text: strings(ctx, 'yes'), index: 0 }, { text: strings(ctx, 'no'), index: 1 }], cancel: 'last' });
        if (i !== 0) return undefined;
      }
      const ok = await port(ctx, 'game', 'save')({ slot: cmd.slot || 'autosave' });
      await port(ctx, 'io', 'toast')({ text: strings(ctx, ok === false ? 'save-failed' : 'saved') });
    },
    summary(cmd) { return cmd.prompt !== false ? 'Ask to save' : 'Save'; },
  });
  defs.push({ id: 'title', label: 'Return to Title Screen', mv: 'Return to Title Screen', group: 'System', icon: 'title', background: false, blocking: true, fields: [], async run(ctx) { await port(ctx, 'game', 'title')(); return { kind: 'exit' }; }, summary() { return 'Return to title'; } });
  defs.push({
    id: 'chapter', label: 'Chapter Card', group: 'System', icon: 'chapter', background: false, blocking: true,
    fields: [{ key: 'title', type: 'text', default: '' }, { key: 'subtitle', type: 'text', default: '' }, { key: 'ms', type: 'number', min: 0, default: 2000 }],
    async run(ctx, cmd) { await port(ctx, 'io', 'chapter')({ title: T.substitute(cmd.title || '', ctx), subtitle: T.substitute(cmd.subtitle || '', ctx), ms: cmd.ms == null ? 2000 : cmd.ms }); },
    summary(cmd) { return `Chapter: ${short(cmd.title, 40)}`; },
  });
  defs.push({
    id: 'heal', label: 'Recover All', mv: 'Recover All', group: 'System', icon: 'heart', blocking: false,
    fields: [heroField('all', ['all', 'hero', 'p1', 'p2'])],
    async run(ctx, cmd) {
      const hero = !cmd.hero || cmd.hero === 'all' ? 'all' : heroIdFor(ctx, cmd.hero);
      emit(ctx, 'heal', { hero });
      if (ctx.game && typeof ctx.game.heal === 'function') await ctx.game.heal({ hero });
    },
    summary(cmd) { return `Heal ${cmd.hero || 'all'}`; },
  });
  defs.push({
    id: 'debug', label: 'Debug Log', group: 'System', icon: 'bug', blocking: false,
    fields: [{ key: 'text', type: 'text', default: '' }],
    async run(ctx, cmd) {
      const text = plain(cmd.text, ctx);
      emit(ctx, 'debug', { text });
      if (ctx.game && typeof ctx.game.debug === 'function') ctx.game.debug({ text });
    },
    summary(cmd) { return `Debug: ${short(cmd.text, 50)}`; },
  });

  reg.addAll(defs);

  // ---- structure helpers -----------------------------------------------------

  /** blockFields(def) -> keys holding nested command lists directly ('then', 'else', 'body') or via option groups ('options'). */
  CMD.blockFields = function (def) {
    const out = [];
    for (const f of S.fields((def && def.fields) || [])) {
      if (f.type === 'script') out.push(f.key);
      else if (f.type === 'list' && f.of && f.of.type === 'group' && (f.of.fields || []).some(g => g.type === 'script')) out.push(f.key);
    }
    return out;
  };
  /** nested(cmd) -> [{ key, path, list }] every nested command list of cmd with its path relative to cmd. */
  CMD.nested = function (cmd) {
    const def = reg.get(cmd && cmd.t);
    const out = [];
    if (!def) return out;
    for (const f of S.fields(def.fields || [])) {
      if (f.type === 'script' && Array.isArray(cmd[f.key])) out.push({ key: f.key, path: [f.key], list: cmd[f.key] });
      else if (f.type === 'list' && f.of && f.of.type === 'group' && Array.isArray(cmd[f.key])) {
        const scriptKeys = (f.of.fields || []).filter(g => g.type === 'script').map(g => g.key);
        cmd[f.key].forEach((item, i) => { for (const k of scriptKeys) if (item && Array.isArray(item[k])) out.push({ key: f.key, path: [f.key, i, k], list: item[k] }); });
      }
    }
    return out;
  };
  /** walk(cmds, fn(cmd, path)) — depth-first, path = [index, 'then', index, ...]. Return false from fn to skip a command's children. */
  CMD.walk = function (cmds, fn, path) {
    path = path || [];
    (cmds || []).forEach((cmd, i) => {
      const p = path.concat(i);
      if (fn(cmd, p) === false) return;
      for (const n of CMD.nested(cmd)) CMD.walk(n.list, fn, p.concat(n.path));
    });
  };
  /** normalize(cmd) -> a copy with the command's defaults filled (nested lists too). Raw/unknown commands pass through. */
  CMD.normalize = function (cmd) {
    if (!KIT.isObject(cmd)) return cmd;
    const def = reg.get(cmd.t);
    if (!def) return cmd;
    return S.fill(def.fields || [], cmd);
  };
  CMD.normalizeAll = (cmds) => (cmds || []).map(CMD.normalize);
  /** Keys of cmd worth writing: fields (in order) whose value differs from the default, then extra keys (sorted). Never 't'. */
  function keysFor(def, cmd) {
    const out = [];
    const fields = def ? S.fields(def.fields || []) : [];
    const blocks = def ? CMD.blockFields(def) : [];
    for (const f of fields) {
      if (blocks.includes(f.key) || cmd[f.key] === undefined) continue;
      if (cmd[f.key] === null && (f.nullable || f.optional)) continue;
      if (!S.visible(f, cmd)) continue;
      if (KIT.deepEqual(cmd[f.key], S.defaultFor(f))) continue;
      out.push(f.key);
    }
    const known = fields.map(f => f.key);
    for (const k of Object.keys(cmd).sort()) if (k !== 't' && !known.includes(k) && !out.includes(k) && cmd[k] !== undefined && !(k === 'disabled' && cmd[k] === false)) out.push(k);
    return out;
  }
  CMD.keysFor = keysFor;

  // ---- line form -------------------------------------------------------------

  /** genericToLine(cmd) -> '@id key=value …' (nested block lists are left to Screenplay's indentation). */
  CMD.genericToLine = function (cmd) {
    const def = reg.get(cmd.t);
    const pairs = keysFor(def, cmd).map(k => `${k}=${V.format(cmd[k])}`);
    return `@${cmd.t}${pairs.length ? ' ' + pairs.join(' ') : ''}`;
  };
  /** genericFromLine(line) -> cmd | null. Only `key=value` pairs are accepted (positional words make it null). */
  CMD.genericFromLine = function (line) {
    const m = /^@([A-Za-z_][\w-]*)(?:\s+(.*))?$/.exec(String(line).trim());
    if (!m) return null;
    const cmd = { t: m[1] };
    for (const tk of V.tokenize(m[2] || '')) {
      if (!tk.key || tk.error) return null;
      cmd[tk.key] = tk.value;
    }
    return cmd;
  };
  /** Lines Screenplay owns (block structure); fromLine never turns them into commands. */
  CMD.reservedLines = ['@else', '@end'];
  /** toLine(cmd) -> the canonical Screenplay line: the command's sugar when it can express the command, else the generic form. A disabled command always uses the generic form (`disabled=true`). */
  CMD.toLine = function (cmd) {
    if (!KIT.isObject(cmd)) return '';
    if (cmd.t === 'raw') return String(cmd.line == null ? '' : cmd.line);
    const def = reg.get(cmd.t);
    if (!cmd.disabled && def && def.text && typeof def.text.toLine === 'function') {
      const line = def.text.toLine(cmd);
      if (typeof line === 'string') return line;
    }
    return CMD.genericToLine(cmd);
  };
  /** fromLine(line) -> normalized cmd | null. Tries every command's sugar, then the generic form. Nested lists come back empty. */
  CMD.fromLine = function (line) {
    const s = String(line == null ? '' : line);
    if (!s.trim() || CMD.reservedLines.includes(s.trim())) return null;
    for (const def of reg.list()) {
      if (!def.text || typeof def.text.fromLine !== 'function') continue;
      let cmd = null;
      try { cmd = def.text.fromLine(s); } catch (e) { cmd = null; }
      if (cmd) return CMD.normalize(cmd);
    }
    const g = CMD.genericFromLine(s);
    return g ? CMD.normalize(g) : null;
  };

  // ---- summaries, validation, refs, execution -------------------------------

  /** summary(cmd, ctx) -> one line for the command card. */
  CMD.summary = function (cmd, ctx) {
    if (!KIT.isObject(cmd)) return '';
    if (cmd.t === 'raw') return `Unparsed: ${short(cmd.line, 50)}`;
    const def = reg.get(cmd.t);
    let s;
    if (!def) s = `Unknown command '${cmd.t}'`;
    else if (typeof def.summary === 'function') { try { s = def.summary(cmd, ctx || {}); } catch (e) { s = KIT.labelOf(def, ctx, cmd.t); } }
    else s = KIT.labelOf(def, ctx, cmd.t);
    return cmd.disabled ? `(off) ${s}` : s;
  };
  /**
   * validateScript(cmds, ctx) -> [{ path, message, code }]. ctx: { project, map, background:true for tick/parallel threads }.
   */
  CMD.validateScript = function (cmds, ctx) { return S.validateValue({ key: 'script', type: 'script' }, cmds, ctx); };
  /** refs(cmds, ctx) -> [{ kind, id, path, access:'read'|'write' }] */
  CMD.refs = function (cmds, ctx) { const out = []; S._refsField({ key: 'script', type: 'script' }, cmds, ctx || {}, [], out); return out; };
  /** exec(ctx, cmd) -> Promise<ControlSignal|undefined>: skips disabled/raw/unknown commands (unknown ones warn once). */
  const warned = new Set();
  CMD.exec = async function (ctx, cmd) {
    if (!KIT.isObject(cmd) || cmd.disabled || cmd.t === 'raw') return undefined;
    const def = reg.get(cmd.t);
    if (!def || typeof def.run !== 'function') {
      if (!warned.has(cmd.t)) { warned.add(cmd.t); (KIT.log || console).warn(`[commands] unknown command '${cmd.t}' skipped`); }
      return undefined;
    }
    if (ctx && ctx.thread && ctx.thread.background && def.background === false) throw new Error(`commands: '${cmd.t}' cannot run on a background thread`);
    return def.run(ctx, cmd);
  };
  CMD.get = (id) => reg.get(id);
  CMD.list = () => reg.list();
  CMD.ids = () => reg.ids();

  // ---- schema: the rich 'script' type ---------------------------------------
  S.defineType('script', {
    validate(f, v, ctx, path, errors) {
      if (!Array.isArray(v)) return errors.push({ path: path.slice(), message: 'must be a list of commands', code: 'type' });
      v.forEach((c, i) => {
        const p = path.concat(i);
        if (!KIT.isObject(c) || typeof c.t !== 'string') return errors.push({ path: p, message: 'each command needs a type (t)', code: 'type' });
        if (c.t === 'raw') { if (typeof c.line !== 'string') errors.push({ path: p.concat('line'), message: 'a raw line needs text', code: 'type' }); return; }
        const def = reg.get(c.t);
        if (!def) return errors.push({ path: p, message: `unknown command '${c.t}'`, code: 'unknown' });
        if (ctx && ctx.background && def.background === false) errors.push({ path: p, message: `'${c.t}' cannot run on a background (tick/parallel) thread`, code: 'background' });
        if (has(c, 'disabled') && typeof c.disabled !== 'boolean') errors.push({ path: p.concat('disabled'), message: 'must be true or false', code: 'type' });
        S._validateFields(def.fields || [], C.withDefaults(def.fields, c), ctx || {}, p, errors);   // missing keys mean "the default"; only defaults of null stay required
      });
    },
    default() { return []; },
    refs(f, v, ctx, path, out) {
      if (!Array.isArray(v)) return;
      v.forEach((c, i) => {
        const def = KIT.isObject(c) && reg.get(c.t);
        if (!def) return;
        const p = path.concat(i);
        S._refsFields(def.fields || [], c, ctx || {}, p, out);
        for (const fld of S.fields(def.fields || [])) if (fld.target) C.targetRefs(c[fld.key], p.concat(fld.key), out);
      });
    },
    fill(f, v) { return Array.isArray(v) ? v.map(CMD.normalize) : v; },
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
