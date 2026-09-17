// Text: templating ({p1}, {var:coins}), text codes ({pause}, {color:red}…),
// word wrap and pagination. Pure: no DOM, no timers. The dialogue scene feeds
// the spans to the renderer; the editor uses render() for its live preview.
// Also here: KIT.strings (the Terms table) and KIT.script.values, the tiny
// value lexer shared by the condition and screenplay text formats.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const T = KIT.text = KIT.text || {};

  /**
   * @typedef {Object} TextCtx  What templating reads. Plain data; tests pass one directly,
   *   the runtime builds it from an interpreter ctx with KIT.text.contextFrom(ctx).
   * @property {Array<{id:string,name:string}>} [heroes]  ordered heroes, index 0 = p1
   * @property {string|number} [hero]   the triggering hero: id ('p1') or index; default the first hero
   * @property {Object<string,*>} [vars]   game variables by name
   * @property {Object<string,*>} [self]   the current object's self state
   * @property {Object<string,{name?:string}>} [items]  project.items (id -> { name })
   * @property {Object<string,*>} [args]   call arguments, read by {arg:name}
   */
  /**
   * @typedef {Object} TextSpan   a run of characters with one style
   * @property {'text'} type
   * @property {string} text
   * @property {string} [color]   from {color:x}
   * @property {string} [size]    from {size:big}
   * @property {string} [voice]   from {voice:x} — a voices id; the box reads font/colour/speed/blip off it
   * @property {string} [fx]      from {fx:wave} — a textEffects id
   * @property {number} [fxAmount] from {fx:wave,2}
   */
  /**
   * @typedef {{type:'pause', ms:number|null}|{type:'wait'}|{type:'speed', mode:'fast'|'instant'}|{type:'icon', id:string}|{type:'break'}|{type:'shake'}} CodeSpan
   *   pause: ms null = the scene's default pause. wait: wait for the player mid-message.
   *   speed: change the typewriter speed from here on. break: forced line break (\n). shake: shake the box.
   */
  /** @typedef {TextSpan|CodeSpan} Span */
  /**
   * @typedef {Object} TextLayout
   * @property {number} [width]      box width in the unit measure() returns (default Infinity: no wrapping)
   * @property {function(string):number} [measure]  text width; default = character count (monospace)
   * @property {number} [iconWidth]  width of an {icon}; default measure('MM')
   * @property {number} [lines]      lines per page (default 3)
   */

  const has = (o, k) => o !== null && o !== undefined && Object.prototype.hasOwnProperty.call(o, k);

  // ---- context ---------------------------------------------------------------

  function heroIndex(ctx, hero) {
    const heroes = ctx.heroes || [];
    if (typeof hero === 'number') return hero;
    if (hero && typeof hero === 'object') hero = hero.id;
    if (typeof hero === 'string') {
      const i = heroes.findIndex(h => h && h.id === hero);
      if (i >= 0) return i;
      const m = /^p(\d+)$/.exec(hero);
      if (m) return Number(m[1]) - 1;
    }
    return 0;
  }
  function heroName(ctx, hero) {
    const heroes = ctx.heroes || [];
    const i = heroIndex(ctx, hero);
    const h = heroes[i];
    if (h && h.name != null) return String(h.name);
    return i === 0 ? 'Player 1' : i === 1 ? 'Player 2' : `Player ${i + 1}`;
  }
  const isRunCtx = (ctx) => !!(ctx && (ctx.world || ctx.io));

  /** Build a TextCtx from an interpreter ctx ({ project, world:{ save }, self, hero, args }). A TextCtx passes through. */
  T.contextFrom = function (ctx) {
    if (!ctx) return {};
    if (!isRunCtx(ctx)) return ctx;
    const project = ctx.project || {};
    const save = (ctx.world && ctx.world.save) || {};
    const heroes = (project.heroes || []).map((h, i) => {
      const s = Array.isArray(save.heroes) ? save.heroes[i] : null;
      // A name the player typed is theirs and is never touched. The one the
      // writer put in the project is a line like any other, so it translates.
      return { id: h.id, name: s && s.name != null ? s.name : T.translate(h.name) };
    });
    const obj = ctx.self && save.objects ? save.objects[ctx.self] : null;
    return {
      heroes,
      hero: ctx.hero && typeof ctx.hero === 'object' ? ctx.hero.id : ctx.hero,
      vars: save.vars || {},
      self: (obj && obj.self) || {},
      items: project.items || {},
      args: ctx.args || {},
      meta: (KIT.storage && KIT.storage.meta) ? KIT.storage.meta() : (save.meta || {}),
      project,                      // the cast tags read project.cast
    };
  };

  // ---- substitution ----------------------------------------------------------

  const fmt = (v) => (v === undefined || v === null ? '' : String(v));
  /** translate(str) — the language hook. Without KIT.lang loaded this is identity. */
  T.translate = (s) => (KIT.lang && KIT.lang.t ? KIT.lang.t(s) : s);
  /** Escape braces so a substituted value never becomes a code. */
  T.escape = (s) => String(s).replace(/\{/g, '{{').replace(/\}/g, '}}');
  T.unescape = (s) => String(s).replace(/\{\{/g, '{').replace(/\}\}/g, '}');

  /**
   * Template tags: name -> fn(ctx: TextCtx, arg: string|undefined) -> string. Modules add theirs
   * (`KIT.text.tags.mon = (ctx, arg) => ...`). A {name} or {name:arg} whose name is not a tag is left as is.
   */
  T.tags = T.tags || {};
  Object.assign(T.tags, {
    p1: (ctx) => heroName(ctx, 0),
    p2: (ctx) => heroName(ctx, 1),
    p: (ctx) => heroName(ctx, ctx.hero == null ? 0 : ctx.hero),
    hero: (ctx) => heroName(ctx, ctx.hero == null ? 0 : ctx.hero),
    var: (ctx, arg) => fmt(ctx.vars && ctx.vars[arg]),
    self: (ctx, arg) => fmt(ctx.self && ctx.self[arg]),
    item: (ctx, arg) => { const it = ctx.items && ctx.items[arg]; return it && it.name != null ? T.translate(String(it.name)) : fmt(arg); },
    arg: (ctx, arg) => fmt(ctx.args && ctx.args[arg]),
    // What survives New Game: {meta:runs}, {meta:lastEnding}, anything @remember
    // has written. This is how somebody opens with “you were here before”.
    meta: (ctx, arg) => {
      const v = ctx.meta && ctx.meta[arg];
      return Array.isArray(v) ? v.join(', ') : fmt(v);
    },
    // The cast. {who:mira} is her name; {they:mira} / {them:mira} / {their:mira}
    // are her pronouns, so a line can be written once for anybody.
    who: (ctx, arg) => T.translate(KIT.cast && KIT.cast.nameOf ? KIT.cast.nameOf(ctx.project, arg) : fmt(arg)),
    they: (ctx, arg) => pronoun(ctx, arg, 0, 'they'),
    them: (ctx, arg) => pronoun(ctx, arg, 1, 'them'),
    their: (ctx, arg) => pronoun(ctx, arg, 2, 'their'),
  });

  /**
   * A person's `pronouns` field is written the way people write it — 'she/her',
   * 'they/them', 'he/him/his'. Slot 2 (the possessive) is worked out when it is
   * not given, because most people only write two.
   */
  const POSSESSIVE = { they: 'their', she: 'her', he: 'his', it: 'its', ze: 'zir', xe: 'xyr' };
  function pronoun(ctx, who, slot, fallback) {
    const p = KIT.cast && KIT.cast.person ? KIT.cast.person(ctx.project, who) : null;
    const parts = String((p && p.pronouns) || '').split('/').map(x => x.trim()).filter(Boolean);
    if (parts[slot]) return parts[slot];
    if (slot === 2 && parts[0]) return POSSESSIVE[parts[0].toLowerCase()] || (parts[1] ? parts[1] : fallback);
    return fallback;
  }

  const TAG = /\{\{|\}\}|\{([a-zA-Z_][\w-]*)(?::([^{}]*))?\}/g;
  /** substitute(str, ctx) -> str with template tags replaced. Escaped braces ({{ }}) are kept for tokenize(); codes are untouched. */
  T.substitute = function (str, ctx) {
    if (str === null || str === undefined) return '';
    const c = T.contextFrom(ctx) || {};
    // The translation happens FIRST, on the line as it was written — braces,
    // codes and all. A translator sees `{p1} found {item:lantern}.` and moves
    // the pieces around to suit their grammar, which is the whole point; if we
    // substituted first they would be handed a sentence with a name already
    // baked into the middle of it and no way to move it.
    return String(T.translate(str)).replace(TAG, (m, name, arg) => {
      if (m === '{{' || m === '}}') return m;
      const fn = T.tags[name];
      if (typeof fn !== 'function') return m;
      return T.escape(fmt(fn(c, arg)));
    });
  };

  // ---- text codes ------------------------------------------------------------

  const CODE = /\{\{|\}\}|\{(\/?[a-zA-Z_][\w-]*)(?::([^{}]*))?\}|\r?\n/g;

  /** tokenize(str) -> Span[]. Unknown codes stay literal text; {{ and }} become literal braces. */
  T.tokenize = function (str) {
    const spans = [];
    const colors = [], sizes = [], voices = [], fx = [];
    let buf = '';
    const top = (a) => (a.length ? a[a.length - 1] : null);
    const style = () => {
      const s = {};
      if (colors.length) s.color = top(colors);
      if (sizes.length) s.size = top(sizes);
      // {voice:sans} carries the whole bundle — font, colour, speed, blip — so a
      // span only has to remember whose it is and the box looks the rest up.
      if (voices.length) s.voice = top(voices);
      if (fx.length) { const f = top(fx); s.fx = f.id; if (f.amount != null) s.fxAmount = f.amount; }
      return s;
    };
    const flush = () => { if (buf) { spans.push(Object.assign({ type: 'text', text: buf }, style())); buf = ''; } };
    const s = str === null || str === undefined ? '' : String(str);
    let last = 0, m;
    CODE.lastIndex = 0;
    while ((m = CODE.exec(s))) {
      buf += s.slice(last, m.index);
      last = m.index + m[0].length;
      const tok = m[0], name = m[1], arg = m[2];
      if (tok === '{{') { buf += '{'; continue; }
      if (tok === '}}') { buf += '}'; continue; }
      if (tok === '\n' || tok === '\r\n') { flush(); spans.push({ type: 'break' }); continue; }
      switch (name) {
        case 'pause': flush(); spans.push({ type: 'pause', ms: arg != null && arg !== '' && Number.isFinite(Number(arg)) ? Number(arg) : null }); break;
        case 'wait': flush(); spans.push({ type: 'wait' }); break;
        case 'fast': case 'instant': flush(); spans.push({ type: 'speed', mode: name }); break;
        case 'icon': flush(); spans.push({ type: 'icon', id: arg || '' }); break;
        case 'shake': flush(); spans.push({ type: 'shake' }); break;
        case 'color': flush(); colors.push(arg || ''); break;
        case '/color': flush(); colors.pop(); break;
        case 'size': flush(); sizes.push(arg || ''); break;
        case '/size': flush(); sizes.pop(); break;
        case 'voice': flush(); voices.push(arg || ''); break;
        case '/voice': flush(); voices.pop(); break;
        // {fx:wave} or {fx:wave,2} — the amount is optional and the name is not.
        case 'fx': {
          flush();
          const bits = String(arg || '').split(',');
          const amount = bits.length > 1 && Number.isFinite(Number(bits[1])) ? Number(bits[1]) : null;
          fx.push({ id: (bits[0] || '').trim(), amount });
          break;
        }
        case '/fx': flush(); fx.pop(); break;
        default: buf += tok; // not a code: keep it literally
      }
    }
    buf += s.slice(last);
    flush();
    return spans;
  };

  /** strip(str) -> plain text without codes (icons dropped, breaks -> \n). Templating tags are kept. */
  T.strip = function (str) {
    return T.tokenize(str).map(sp => sp.type === 'text' ? sp.text : sp.type === 'break' ? '\n' : '').join('');
  };
  /** plain(str, ctx) -> substituted, code-free text (for summaries, toasts, logs). */
  T.plain = (str, ctx) => T.strip(T.substitute(str, ctx));

  // ---- wrapping --------------------------------------------------------------

  const sameStyle = (a, b) => (a.color || '') === (b.color || '') && (a.size || '') === (b.size || '')
    && (a.voice || '') === (b.voice || '') && (a.fx || '') === (b.fx || '') && (a.fxAmount || 0) === (b.fxAmount || 0);
  const styleOf = (sp) => {
    const s = {};
    if (sp.color) s.color = sp.color;
    if (sp.size) s.size = sp.size;
    if (sp.voice) s.voice = sp.voice;
    if (sp.fx) { s.fx = sp.fx; if (sp.fxAmount != null) s.fxAmount = sp.fxAmount; }
    return s;
  };

  /** wrap(spans, layout) -> lines (Span[][]). Breaks at spaces, splits words longer than the width, drops leading/trailing spaces per line. */
  T.wrap = function (spans, layout) {
    layout = layout || {};
    const width = layout.width == null ? Infinity : layout.width;
    const measure = layout.measure || ((s) => s.length);
    const iconWidth = layout.iconWidth != null ? layout.iconWidth : measure('MM');
    const lines = [];
    let line = [], lineWidth = 0;
    const pushText = (text, style) => {
      if (!text) return;
      const last = line[line.length - 1];
      if (last && last.type === 'text' && sameStyle(last, style)) last.text += text;
      else line.push(Object.assign({ type: 'text', text }, style));
    };
    const trimEnd = (l) => {
      for (let i = l.length - 1; i >= 0; i--) {
        const sp = l[i];
        if (sp.type !== 'text') continue;
        sp.text = sp.text.replace(/\s+$/, '');
        if (sp.text) break;
        l.splice(i, 1);
      }
    };
    const newLine = () => { trimEnd(line); lines.push(line); line = []; lineWidth = 0; };
    for (const sp of spans || []) {
      if (sp.type === 'break') { newLine(); continue; }
      if (sp.type === 'icon') {
        if (lineWidth > 0 && lineWidth + iconWidth > width) newLine();
        line.push(Object.assign({}, sp)); lineWidth += iconWidth; continue;
      }
      if (sp.type !== 'text') { line.push(Object.assign({}, sp)); continue; }
      const style = styleOf(sp);
      for (const tok of sp.text.split(/(\s+)/)) {
        if (!tok) continue;
        if (/^\s+$/.test(tok)) {
          if (lineWidth === 0) continue;               // no leading spaces
          pushText(tok, style); lineWidth += measure(tok);
          continue;
        }
        const w = measure(tok);
        if (lineWidth > 0 && lineWidth + w > width) newLine();
        if (w > width) {                                // a word longer than the box: split by character
          for (const ch of Array.from(tok)) {
            const cw = measure(ch);
            if (lineWidth > 0 && lineWidth + cw > width) newLine();
            pushText(ch, style); lineWidth += cw;
          }
        } else { pushText(tok, style); lineWidth += w; }
      }
    }
    if (line.length || !lines.length) newLine();
    return lines;
  };

  /** paginate(lines, linesPerPage) -> pages (Span[][][]). Always at least one page. */
  T.paginate = function (lines, linesPerPage) {
    const n = Math.max(1, linesPerPage || 3);
    const pages = [];
    for (let i = 0; i < (lines || []).length; i += n) pages.push(lines.slice(i, i + n));
    if (!pages.length) pages.push([]);
    return pages;
  };

  /**
   * render(str | str[], ctx, layout) -> [{ pages }] one entry per message; pages[page][line][span].
   * Pure: substitute → tokenize → wrap → paginate.
   */
  T.render = function (str, ctx, layout) {
    layout = layout || {};
    const list = Array.isArray(str) ? str : [str];
    return list.map(s => ({ pages: T.paginate(T.wrap(T.tokenize(T.substitute(s, ctx)), layout), layout.lines) }));
  };

  /**
   * layout(str | str[], layoutOpts) -> the same shape as render(), for text
   * that has ALREADY been substituted.
   *
   * This exists because substituting twice translates twice, and translating
   * twice is not harmless: if a line's translation happens to match another
   * source line, the second pass replaces it again and the player is shown a
   * sentence from somewhere else entirely. It also poisons `KIT.lang.missing()`,
   * which is supposed to be the list of lines still needing a translator —
   * every already-translated line comes back through and is counted as a miss.
   *
   * Commands substitute before they hand text to a scene (that is the `io.say`
   * contract), so scenes lay out rather than render.
   */
  T.layout = function (str, layout) {
    layout = layout || {};
    const list = Array.isArray(str) ? str : [str];
    return list.map(s => ({ pages: T.paginate(T.wrap(T.tokenize(s), layout), layout.lines) }));
  };

  // ---- KIT.strings: the Terms table ----------------------------------------
  // Kit and modules register { id, default, doc } in the 'strings' registry;
  // project.strings overrides per key. get() substitutes {name} from vars.
  const STR = KIT.strings = KIT.strings || {};
  STR.get = function (project, key, vars) {
    let tpl;
    if (project && project.strings && has(project.strings, key) && typeof project.strings[key] === 'string') tpl = project.strings[key];
    else if (KIT.registry.exists('strings') && KIT.registry('strings').has(key)) tpl = KIT.registry('strings').get(key).default;
    else tpl = key;
    return String(T.translate(tpl)).replace(/\{([a-zA-Z_][\w-]*)\}/g, (m, name) => (vars && has(vars, name) ? fmt(vars[name]) : m));
  };
  /** defaults() -> { key: defaultText } for every registered string. */
  STR.defaults = function () {
    const out = {};
    if (KIT.registry.exists('strings')) for (const d of KIT.registry('strings').list()) out[d.id] = d.default;
    return out;
  };

  // ---- KIT.script.values: the value lexer shared by condition text and screenplay lines ----
  // Values: bare words, numbers, true/false/null, "quoted strings" (JSON escapes), {json} / [json].
  const V = (KIT.script = KIT.script || {}).values = {};
  const NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
  const BARE = /^[^\s"'(),=\[\]{}#\\]+$/;   // what may be written without quotes (screenplay lines)
  const WORD = /^[A-Za-z_][\w\-.]*$/;      // the stricter bare form (condition expressions)
  V.BARE = BARE; V.WORD = WORD; V.NUMBER = NUMBER;
  const KEYWORDS = ['true', 'false', 'null', 'and', 'or', 'not', 'always', 'never'];

  /** format(v, { bare }) -> the shortest text that parse() reads back to v. */
  V.format = function (v, opts) {
    const bare = (opts && opts.bare) || BARE;
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'string') {
      if (bare.test(v) && !NUMBER.test(v) && !KEYWORDS.includes(v) && !/^[{["]/.test(v)) return v;
      return JSON.stringify(v);
    }
    return JSON.stringify(v);
  };
  /** parseBare(token) -> number | boolean | null | string */
  V.parseBare = function (tok) {
    if (NUMBER.test(tok)) return Number(tok);
    if (tok === 'true') return true;
    if (tok === 'false') return false;
    if (tok === 'null') return null;
    return tok;
  };
  /** scanString(str, i) — i at the opening quote; -> end index after the closing quote (or -1). */
  function scanString(str, i) {
    for (let j = i + 1; j < str.length; j++) {
      if (str[j] === '\\') { j++; continue; }
      if (str[j] === '"') return j + 1;
    }
    return -1;
  }
  /** scanJson(str, i) — i at { or [; -> end index after the matching close (or -1). */
  function scanJson(str, i) {
    let depth = 0;
    for (let j = i; j < str.length; j++) {
      const c = str[j];
      if (c === '"') { j = scanString(str, j) - 1; if (j < 0) return -1; continue; }
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') { depth--; if (depth === 0) return j + 1; }
    }
    return -1;
  }
  /**
   * scan(str, i, stops) -> { value, end, raw } reading one value at i (after skipping spaces).
   * `stops` = characters that end a bare token besides whitespace (default ',)').
   */
  V.scan = function (str, i, stops) {
    stops = stops == null ? ',)' : stops;
    while (i < str.length && /\s/.test(str[i])) i++;
    if (i >= str.length) return null;
    const c = str[i];
    if (c === '"') {
      const end = scanString(str, i);
      if (end < 0) return { value: str.slice(i + 1), end: str.length, raw: str.slice(i), error: 'unterminated string' };
      try { return { value: JSON.parse(str.slice(i, end)), end, raw: str.slice(i, end) }; }
      catch (e) { return { value: str.slice(i + 1, end - 1), end, raw: str.slice(i, end), error: 'bad escape' }; }
    }
    if (c === '{' || c === '[') {
      const end = scanJson(str, i);
      if (end > 0) {
        try { return { value: JSON.parse(str.slice(i, end)), end, raw: str.slice(i, end) }; }
        catch (e) { return { value: str.slice(i, end), end, raw: str.slice(i, end), error: 'bad json' }; }
      }
    }
    let j = i;
    while (j < str.length && !/\s/.test(str[j]) && !stops.includes(str[j])) j++;
    if (j === i) j = i + 1; // a lone stop character is its own token
    const raw = str.slice(i, j);
    return { value: V.parseBare(raw), end: j, raw };
  };
  /**
   * tokenize(str, { separators }) -> [{ key: string|null, value, raw }]
   * Reads `key=value` pairs and positional values separated by whitespace (and `separators`, e.g. ',' inside parens).
   */
  V.tokenize = function (str, opts) {
    const seps = (opts && opts.separators) || '';
    const out = [];
    let i = 0;
    const s = str || '';
    while (i < s.length) {
      while (i < s.length && (/\s/.test(s[i]) || seps.includes(s[i]))) i++;
      if (i >= s.length) break;
      const km = /^([A-Za-z_][\w\-.]*)\s*=(?!=)\s*/.exec(s.slice(i));
      if (km) {
        i += km[0].length;
        const v = V.scan(s, i, seps);
        if (!v) { out.push({ key: km[1], value: '', raw: '' }); break; }
        out.push({ key: km[1], value: v.value, raw: v.raw, error: v.error });
        i = v.end;
      } else {
        const v = V.scan(s, i, seps);
        if (!v) break;
        out.push({ key: null, value: v.value, raw: v.raw, error: v.error });
        i = v.end;
      }
    }
    return out;
  };
  /** pairs(obj, keys, opts) -> 'a=1 b="x y"' for the listed keys (in order); undefined values are skipped. */
  V.pairs = function (obj, keys, opts) {
    const sep = (opts && opts.separator) || ' ';
    return keys.filter(k => obj[k] !== undefined).map(k => `${k}=${V.format(obj[k], opts)}`).join(sep);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
