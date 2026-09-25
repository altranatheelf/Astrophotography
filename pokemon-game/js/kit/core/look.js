// KIT.look — how the game looks and sounds, as data.
//
// A game's look is `project.ui`: a small object of OVERRIDES on top of a look it
// starts from (`ui.base`, the built-in `kit` when there is none). This file is
// the headless half. It knows the fields (TOKENS and PARTS), resolves the chain
// of looks into one filled-in look, and compiles that into a single stylesheet.
// The DOM half — writing that stylesheet into the page — is js/kit/ui/parts.js.
//
//   KIT.look.resolve(project)   -> every field filled in, plus _chain and _problems
//   KIT.look.compile(look, env) -> CSS; '' for the kit look, so a game that never
//                                  touched its look ships exactly the stylesheet
//                                  it always had
//   KIT.look.sound('confirm')   -> plays what this look says "confirm" sounds like
//
// Why tokens and not a stylesheet an author edits: a look travels between games,
// and a stylesheet can do anything — fetch, hide the pause menu, cover the
// screen. A token can only be what its field says it is. Every value an author
// or a file supplies goes through `sanitize` before it reaches CSS, and there is
// no field for raw CSS at all; `look.css` in a game's folder stays the
// programmer's escape hatch and never travels with a look.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const S = KIT.schema;
  const isObj = KIT.isObject;
  const L = KIT.look = KIT.look || {};

  const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
  const ID = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
  /** The font words a look may use without shipping a font file. */
  const FONT_WORDS = {
    pixel: '"Press Start 2P", ui-monospace, "Courier New", monospace',
    system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, "Courier New", monospace',
    serif: 'Georgia, "Times New Roman", serif',
    rounded: 'ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif',
  };
  const TEXT_SIZES = { small: 'clamp(13px,3.2vw,15px)', large: 'clamp(17px,4.2vw,21px)', huge: 'clamp(20px,5vw,26px)' };

  // ---- the fields ---------------------------------------------------------------
  //
  // TOKENS are the look's colours, widths and fonts. Each one is a schema field
  // plus where it lands: `css` is the custom property css/kit.css reads, and
  // `fallback` is the literal css/kit.css writes after the comma —
  // `var(--kit-frame, #2b2b3a)`. test/kit/look.test.js holds the two files to
  // each other, so the defaults here and the stylesheet cannot drift apart.
  //
  // `form` says how a value becomes CSS (see tokenCss). A nullable token either
  // has `none` — what "no colour" means for it (`transparent`, `none`) — or has
  // no `none`, and then null means "follow the fallback": the eight inks that
  // default to the accent are null until somebody picks one of their own.
  const color = (key, def, css, fallback, group, doc, more) => Object.assign({ key, type: 'color', default: def, css, fallback, group, doc }, more || {});
  const ink = (key, css, doc) => color(key, null, css, 'var(--kit-accent, #3b4b8a)', 'accent', doc, { nullable: true });
  L.TOKENS = [
    color('paper', '#fdfdfb', '--paper', '#fdfdfb', 'box', 'The message box and panel background.'),
    color('ink', '#23233a', '--ink', '#23233a', 'box', 'Text in the box and panels.'),
    color('frame', '#2b2b3a', '--kit-frame', '#2b2b3a', 'box', 'The border round the box, the panels and the portrait.'),
    { key: 'frameWidth', type: 'number', integer: true, min: 0, max: 12, default: 3, css: '--kit-frame-w', fallback: '3px', form: 'px', group: 'box', doc: 'How thick that border is.' },
    { key: 'radius', type: 'number', integer: true, min: 0, max: 24, default: 10, css: '--kit-radius', fallback: '10px', form: 'px', group: 'box', doc: 'How round the corners are.' },
    color('rim', '#dfe3ef', '--kit-rim', '#dfe3ef', 'box', 'The thin line just inside the border.', { nullable: true, none: 'transparent' }),
    color('drop', '#000000', '--kit-drop', 'rgba(0, 0, 0, .35)', 'box', 'The shadow under the box and panels.', { nullable: true, none: 'transparent', form: 'rgba', alpha: 0.35 }),
    color('shadow', null, '--kit-text-shadow', 'none', 'box', 'A shadow under the letters in the box.', { nullable: true, none: 'none', form: 'textShadow' }),
    color('accent', '#3b4b8a', '--kit-accent', '#3b4b8a', 'accent', 'The one colour to change first: names, markers, the cursor and the selected row all follow it.'),
    ink('nameInk', '--kit-name-ink', 'The speaker\'s name.'),
    ink('markerInk', '--kit-marker-ink', 'The ▼ that says there is more.'),
    ink('titleInk', '--kit-title-ink', 'Panel titles.'),
    ink('cursorInk', '--kit-cursor-ink', 'The cursor beside the selected row.'),
    ink('valueInk', '--kit-value-ink', 'Values in the menus (on, off, 50%).'),
    ink('selectFrame', '--kit-sel-frame', 'The border of the selected row.'),
    ink('button', '--kit-button', 'The OK button.'),
    ink('inputFrame', '--kit-input-frame', 'The border of a name or number field.'),
    color('select', '#eaf0ff', '--kit-sel', '#eaf0ff', 'accent', 'The background of the selected row.', { nullable: true, none: 'transparent' }),
    color('selectInk', null, '--kit-sel-ink', 'var(--ink)', 'accent', 'The text of the selected row.', { nullable: true }),
    color('faceBg', '#eef1f8', '--kit-face-bg', '#eef1f8', 'box', 'Behind a portrait.'),
    color('dim', '#08090f', '--kit-dim', 'rgba(8, 9, 15, .55)', 'screen', 'What darkens the game behind a message with a dimmed background.', { form: 'rgba', alpha: 'dimAmount' }),
    { key: 'dimAmount', type: 'number', min: 0, max: 1, default: 0.55, css: null, fallback: '.55', group: 'screen', doc: 'How dark that is.' },
    { key: 'menuDimAmount', type: 'number', min: 0, max: 1, default: 0.5, css: '--kit-menu-dim', fallback: 'rgba(8, 9, 15, .5)', form: 'rgba', color: 'dim', alpha: 'menuDimAmount', group: 'screen', doc: 'How dark the game goes behind the pause menu and choices.' },
    { key: 'fontText', type: 'font', default: 'system', css: '--kit-font-text', fallback: 'var(--font-text)', form: 'font', group: 'text', doc: 'The letters of everything on the game screen.' },
    { key: 'fontUi', type: 'font', default: 'pixel', css: '--font-ui', fallback: '"Press Start 2P", ui-monospace, "Courier New", monospace', form: 'font', group: 'text', doc: 'Names, titles, values, the chapter card and the title buttons.' },
    { key: 'fontName', type: 'font', nullable: true, default: null, css: '--kit-font-name', fallback: 'var(--font-ui)', form: 'font', group: 'text', doc: 'The speaker\'s name only. Empty follows the one above.' },
    { key: 'textSize', type: 'enum', options: ['small', 'normal', 'large', 'huge'], default: 'normal', css: '--kit-text-size', fallback: 'clamp(15px, 3.6vw, 18px)', form: 'size', group: 'text', doc: 'How big a message is.' },
    { key: 'lineHeight', type: 'number', min: 1, max: 2.4, default: 1.45, css: '--kit-line', fallback: '1.45', form: 'number', group: 'text', doc: 'Space between the lines of a message.' },
    color('screenBg', '#0a0b10', '--kit-screen-bg', '#0a0b10', 'screen', 'Behind the map, where it does not reach the edge.'),
    color('screenFrame', '#2f3450', '--kit-screen-frame', '#2f3450', 'screen', 'The bezel round the game screen.'),
    color('highlight', '#ffcb3d', '--accent', '#ffcb3d', 'title', 'The game\'s name on the title, the chapter subtitle and the chosen title button.'),
    color('highlight2', '#6fd3ff', '--accent-2', '#6fd3ff', 'title', 'The subtitle on the title screen.'),
    color('titleBg', null, '--kit-title-bg', 'linear-gradient(180deg, #1a2240 0%, #101526 60%, #0a0b10 100%)', 'title', 'Behind the title screen. Empty keeps the night-sky gradient.', { nullable: true }),
    color('titleShadow', '#7a4a00', '--kit-title-shadow', '#7a4a00', 'title', 'The shadow under the game\'s name.', { nullable: true, none: 'transparent' }),
    color('titleButton', null, '--kit-title-button', 'rgba(255, 255, 255, .06)', 'title', 'The title buttons. Empty keeps them see-through.', { nullable: true }),
    color('titleButtonInk', '#ffffff', '--kit-title-button-ink', '#fff', 'title', 'Their text.'),
    color('titlePickInk', '#2a1d00', '--kit-title-pick-ink', '#2a1d00', 'title', 'The text of the chosen title button.'),
    color('toastBg', '#0c0e16', '--kit-toast-bg', 'rgba(12, 14, 22, .92)', 'toast', 'A toast ("Saved.").', { form: 'rgba', alpha: 0.92 }),
    color('toastFrame', '#3a4160', '--kit-toast-frame', '#3a4160', 'toast', 'Its border.'),
    color('toastInk', '#ffffff', '--kit-toast-ink', '#fff', 'toast', 'Its text.'),
    color('chapterBg', '#06070c', '--kit-chapter-bg', 'rgba(6, 7, 12, .82)', 'chapter', 'Behind a chapter card.', { form: 'rgba', alpha: 0.82 }),
    color('chapterInk', '#ffffff', '--kit-chapter-ink', '#fff', 'chapter', 'The chapter title.'),
    color('padFrame', '#3a4160', '--kit-pad-frame', '#3a4160', 'pad', 'The border of the on-screen buttons.'),
    color('padInk', '#cfd6f5', '--kit-pad-ink', '#cfd6f5', 'pad', 'Their arrows and labels.'),
    color('padA', '#4a6ad8', '--kit-pad-a', 'linear-gradient(180deg, #4a6ad8, #32499e)', 'pad', 'The A button.', { form: 'gradient' }),
    color('padB', '#d85a6a', '--kit-pad-b', 'linear-gradient(180deg, #d85a6a, #9e3244)', 'pad', 'The B button.', { form: 'gradient' }),
  ];

  /**
   * ROLES: what each sound in the interface is FOR, and what the kit plays for
   * it. The scenes ask for a role — `KIT.look.sound('move')` — and never name a
   * sound, so a look can make the cursor tick and the menu silent without a
   * scene knowing. null is silence: the kit has no sound for opening a menu,
   * and a look may give it one.
   */
  L.ROLES = { move: 'blip', confirm: 'select', cancel: 'back', buzzer: null, save: 'save', open: null, close: null, page: null, toast: null };

  /** PARTS: the options of each piece of the interface, as schema field lists. More arrive as they start to work. */
  L.PARTS = {
    sounds: Object.keys(L.ROLES).map((role) => ({ key: role, type: 'ref:sound', nullable: true, default: L.ROLES[role] })),
  };

  /** 'changed' { look } when a look is put in use; 'applied' { css, look } when the page has it. */
  L.events = L.events || KIT.events('look');

  // A library of looks to start from. Registered by js/kit/ui/presets.js (the
  // kit's own) and by modules; a game's own library is `project.looks`, which
  // is read where it is needed and never registered, so one game's looks
  // cannot leak into the next one opened in the same page.
  KIT.defineRegistry('looks', { fields: [
    { key: 'id', type: 'string', min: 1, pattern: ID.source, patternMessage: 'look ids are lower-case letters, digits, . _ : -' },
    { key: 'label', type: 'string', default: '' },
    { key: 'describe', type: 'string', optional: true },
    { key: 'rev', type: 'number', integer: true, min: 1, default: 1 },
    { key: 'base', type: 'string', nullable: true, default: null },
  ], doc: 'Looks to start from: { id, label, describe, rev, base, ui }. `ui` is overrides on top of `base` (the kit look when empty).' });

  // ---- sanitising ------------------------------------------------------------------

  /**
   * clean(field, value) -> { ok, value }. The whole of what a value may be.
   * Numbers are pulled into range rather than refused — a frame of 99 is a
   * thick frame, not an attack — and everything else that does not fit is
   * refused outright, because a colour that is not a colour is the one place
   * text from a file could turn into CSS.
   */
  function clean(f, v) {
    if (v === null) return { ok: !!f.nullable, value: null };
    if (v === undefined) return { ok: false };
    switch (f.type) {
      case 'color': return { ok: typeof v === 'string' && HEX.test(v), value: v };
      case 'number': {
        if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false };
        let n = f.integer ? Math.round(v) : v;
        if (f.min != null) n = Math.max(f.min, n);
        if (f.max != null) n = Math.min(f.max, n);
        return { ok: true, value: n };
      }
      case 'enum': return { ok: (f.options || []).includes(v), value: v };
      case 'bool': return { ok: typeof v === 'boolean', value: v };
      case 'font': return { ok: typeof v === 'string' && (KIT.has(FONT_WORDS, v) || ID.test(v)), value: v };
      default:
        // An id of something else — a sound, a voice. Whether it EXISTS is the
        // validator's question; here it only has to look like an id.
        if (f.type.startsWith('ref:')) return { ok: typeof v === 'string' && ID.test(v), value: v };
        return { ok: false };
    }
  }

  /** cleanFields(fields, obj, path, dropped) -> a copy holding only what passes. Unknown keys are dropped too. */
  function cleanFields(fields, obj, path, dropped) {
    const out = {};
    if (!isObj(obj)) { if (obj !== undefined) dropped.push({ path, value: obj }); return out; }
    const byKey = new Map(fields.map(f => [f.key, f]));
    for (const k of Object.keys(obj)) {
      const f = byKey.get(k);
      const r = f ? clean(f, obj[k]) : { ok: false };
      if (r.ok) out[k] = r.value;
      else dropped.push({ path: path.concat(k), value: obj[k] });
    }
    return out;
  }

  /**
   * sanitize(ui) -> { ui, dropped:[{ path, value }] }
   * Everything that is not a known field with a value it may hold is left out,
   * and said: `dropped` is what the `ui` validator reports as ui-bad-value.
   * A part is looked up as PARTS' OWN key: a file's `constructor` or
   * `__proto__` found the function every object inherits, took it for a part's
   * field list, and threw — and since every line of dialogue asks the look for
   * its voice, one bad key in a look stopped the game from booting at all.
   */
  L.sanitize = function (ui) {
    const dropped = [];
    if (ui === undefined || ui === null) return { ui: {}, dropped };
    if (!isObj(ui)) return { ui: {}, dropped: [{ path: [], value: ui }] };
    const out = {};
    for (const k of Object.keys(ui)) {
      const v = ui[k];
      if (k === 'base') { if (typeof v === 'string' && ID.test(v)) out.base = v; else dropped.push({ path: ['base'], value: v }); }
      else if (k === 'voice') { if (v === null || (typeof v === 'string' && ID.test(v))) out.voice = v; else dropped.push({ path: ['voice'], value: v }); }
      else if (k === 'tokens') out.tokens = cleanFields(L.TOKENS, v, ['tokens'], dropped);
      else if (KIT.has(L.PARTS, k)) out[k] = cleanFields(L.PARTS[k], v, [k], dropped);
      else dropped.push({ path: [k], value: v });
    }
    return { ui: out, dropped };
  };

  // ---- resolving -------------------------------------------------------------------

  /** Plain objects merge key by key; anything else (an array, null, a number) replaces. */
  function merge(into, from) {
    for (const k of Object.keys(from)) {
      const v = from[k];
      if (isObj(v) && isObj(into[k])) merge(into[k], v);
      else into[k] = KIT.deepClone(v);
    }
    return into;
  }

  /** lookDef(project, id) -> the look called `id`: the game's own library first, then the registry. */
  function lookDef(project, id) {
    const own = project && isObj(project.looks) ? project.looks[id] : null;
    if (isObj(own)) return own;
    return KIT.registry('looks').get(id) || null;
  }

  const MAX_DEPTH = 8;
  const problem = (severity, code, message, path) => ({ severity, code, message, where: { look: true, path: path || ['ui'] } });

  /**
   * chainOf(project, base, problems) -> [{ id, ui, path }] from the root down,
   * not counting `kit`. A base that is missing, a loop, or a chain deeper than
   * eight each stop the walk where they are found and say so; the look
   * underneath still works, which is the point — a game must not lose its
   * whole look because one library entry went missing.
   */
  function chainOf(project, base, problems) {
    const out = [];
    const seen = new Set();
    let id = base || 'kit';
    while (id && id !== 'kit') {
      if (seen.has(id)) { problems.push(problem('warn', 'ui-base-cycle', `The looks go round in a circle at “${id}”; the loop is cut there.`, ['ui', 'base'])); break; }
      if (out.length >= MAX_DEPTH) { problems.push(problem('warn', 'ui-base-deep', `The looks are built on each other more than ${MAX_DEPTH} deep; the rest is left out.`, ['ui', 'base'])); break; }
      const def = lookDef(project, id);
      if (!def) { problems.push(problem('warn', 'ui-base-missing', `The look “${id}” is not here, so the game uses Kit's look underneath.`, ['ui', 'base'])); break; }
      seen.add(id);
      const own = project && isObj(project.looks) && project.looks[id] === def;
      out.unshift({ id, ui: def.ui, path: own ? ['looks', id, 'ui'] : null });
      id = def.base || 'kit';
    }
    return out;
  }

  /** The kit's own defaults, once: every field at its schema default. */
  function defaults() {
    const out = { tokens: S.defaults(L.TOKENS), voice: null };
    for (const k of Object.keys(L.PARTS)) out[k] = S.defaults(L.PARTS[k]);
    return out;
  }

  /**
   * resolve(project) -> Look
   * DEFAULTS, then the kit look, then the chain from the root down, then this
   * game's own `project.ui`; every layer sanitised on the way in. The result has
   * every field filled, `_chain` (['kit', …] root first) and `_problems`.
   * There is no memo: it is cheap, and the editor changes the project in place.
   */
  L.resolve = function (project) {
    const ui = project && isObj(project.ui) ? project.ui : {};
    const problems = [];
    const say = (dropped, at) => {
      for (const d of dropped) problems.push(problem('warn', 'ui-bad-value', `${at.concat(d.path).join('.')} could not be used (${JSON.stringify(d.value)}), so it is left out.`, at.concat(d.path)));
    };
    const own = L.sanitize(ui);
    say(own.dropped, ['ui']);
    const chain = chainOf(project, own.ui.base, problems);
    const merged = defaults();
    const kit = KIT.registry('looks').get('kit');
    if (kit) merge(merged, L.sanitize(kit.ui).ui);
    for (const link of chain) {
      const s = L.sanitize(link.ui);
      if (link.path) say(s.dropped, link.path);
      delete s.ui.base;
      merge(merged, s.ui);
    }
    const layer = Object.assign({}, own.ui);
    delete layer.base;
    merge(merged, layer);
    const look = { base: own.ui.base || 'kit', tokens: S.fill(L.TOKENS, merged.tokens), voice: merged.voice == null ? null : merged.voice };
    for (const k of Object.keys(L.PARTS)) look[k] = S.fill(L.PARTS[k], merged[k]);
    look._chain = ['kit'].concat(chain.map(c => c.id));
    look._problems = problems;
    return look;
  };

  /** problems(project) -> what the `ui` validator reports: a broken chain of looks, and values that were left out. */
  L.problems = function (project) { return L.resolve(project)._problems; };

  // ---- compiling ---------------------------------------------------------------------

  function rgb(hex) {
    let h = hex.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }
  const rgba = (hex, a) => `rgba(${rgb(hex).join(',')},${Math.round(a * 1000) / 1000})`;
  /** A darker shade, for the bottom of a button's gradient. */
  const darker = (hex, by) => '#' + rgb(hex).map(c => Math.round(c * (1 - by)).toString(16).padStart(2, '0')).join('');

  /**
   * family(value, fonts) -> a CSS font-family.
   *   a word (pixel, system, mono, serif, rounded) -> its stack of fonts
   *   a key of `fonts` (the game's project.fonts)  -> "kitf-<id>", then a stack to
   *                                                   fall back on while it loads
   *   anything else                                 -> unchanged, so a family
   *                                                   somebody wrote out ("Georgia")
   *                                                   still works
   * A game's own font is only ever named by its id, which is all letters,
   * digits and `._:-`, so it cannot close the quotes it is written in.
   */
  L.family = function (v, fonts) {
    if (KIT.has(FONT_WORDS, v)) return FONT_WORDS[v];
    if (typeof v === 'string' && ID.test(v) && isObj(fonts) && KIT.has(fonts, v)) {
      const f = fonts[v];
      return `"kitf-${v}", ${isObj(f) && f.pixel ? FONT_WORDS.mono : FONT_WORDS.system}`;
    }
    return v;
  };

  /**
   * tokenCss(token, tokens, env) -> the CSS value for one token, or null for
   * "leave the fallback".
   *
   * A font token is a word or the id of one of the game's own fonts. An id the
   * game has no font for is no font at all: the kit's own is kept, rather than
   * writing the bare id as a family name nobody has installed — which also threw
   * away the fallback stack, so the text came out in the browser's default.
   */
  function tokenCss(t, tokens, env) {
    const v = tokens[t.key];
    if (v === null || v === undefined) return t.none === undefined ? null : t.none;
    const num = (k, d) => (typeof k === 'number' ? k : (typeof tokens[k] === 'number' ? tokens[k] : d));
    switch (t.form) {
      case 'px': return v + 'px';
      case 'number': return String(v);
      case 'size': return v === 'normal' ? t.fallback : TEXT_SIZES[v];
      case 'font': { const fam = L.family(v, env.fonts); return fam === v ? null : fam; }
      case 'textShadow': return `1px 1px 0 ${v}`;
      case 'gradient': return `linear-gradient(180deg,${v},${darker(v, 0.3)})`;
      case 'rgba': {
        const c = t.color ? tokens[t.color] : v;
        return HEX.test(c || '') ? rgba(c, num(t.alpha, 1)) : null;
      }
      default: return v;
    }
  }

  /**
   * compile(look, env) -> string. Pure and deterministic: the same look gives
   * the same text, and the kit look gives ''. `env` is what the look may name
   * that lives in the game rather than in the look: `{ fonts }`, the game's
   * project.fonts.
   *
   * Only what DIFFERS from the kit is written, as custom properties on #stage —
   * the element the stylesheet's `var(--kit-*, …)` fallbacks sit under — so
   * nothing here can reach Creator Mode, which lives outside it. Values are
   * cleaned again here: a look handed in by hand has not been through resolve.
   */
  L.compile = function (look, env) {
    const e = isObj(env) ? env : {};
    const given = (look && isObj(look.tokens)) ? look.tokens : {};
    const tokens = {}, kit = S.defaults(L.TOKENS);
    for (const t of L.TOKENS) {
      const r = clean(t, given[t.key]);
      tokens[t.key] = r.ok ? r.value : kit[t.key];
    }
    const decls = [];
    for (const t of L.TOKENS) {
      if (!t.css) continue;
      const v = tokenCss(t, tokens, e);
      if (v !== null && v !== tokenCss(t, kit, e)) decls.push(`${t.css}:${v}`);
    }
    return decls.length ? `#stage{${decls.join(';')}}` : '';
  };

  /** css(project) -> the stylesheet for this game's look: its look compiled against its own fonts. What apply writes into the page. */
  L.css = function (project) {
    return L.compile(L.resolve(project), { fonts: project && isObj(project.fonts) ? project.fonts : {} });
  };

  // ---- the look in use ---------------------------------------------------------------
  let now = null;
  /** use(project) -> Look. Resolve and keep it as the one the game reads (no DOM; parts.js's apply writes the page). */
  L.use = function (project) {
    now = L.resolve(project);
    L.events.emit('changed', { look: now });
    return now;
  };
  /** current() -> the look in use; the kit look before anything was used. */
  L.current = function () { return now || (now = L.resolve(null)); };
  /** get('dialogue.lines', 3) -> that value of the current look, or the fallback when it has none. */
  L.get = function (path, fallback) {
    let v = L.current();
    for (const k of String(path).split('.')) {
      if (!isObj(v) || !KIT.has(v, k)) return fallback;
      v = v[k];
    }
    return v === undefined ? fallback : v;
  };

  /**
   * sound(role, { or, overrides }) -> the id it played, or null.
   * `overrides` is a screen's own sounds, which win over the look's; `or` is the
   * role to fall back to when this one is silent — the buzzer, which is silent
   * in the kit, falls back to cancel, so B on a choice that cannot be cancelled
   * still makes the sound it always made.
   */
  L.sound = function (role, opts) {
    const o = opts || {};
    const look = L.current();
    const pick = (r) => {
      if (o.overrides && KIT.has(o.overrides, r)) return o.overrides[r];
      const s = look.sounds || {};
      if (KIT.has(s, r)) return s[r];
      return KIT.has(L.ROLES, r) ? L.ROLES[r] : null;
    };
    const id = pick(role) || (o.or ? pick(o.or) : null) || null;
    if (id && KIT.audio && KIT.audio.play) KIT.audio.play(id);
    return id;
  };

  /** voice(project) -> the voice for anyone with none of their own: the game's setting, else the look's, else none. */
  L.voice = function (project) {
    const s = (project && project.settings) || {};
    return s.voice || L.resolve(project).voice || null;
  };

  /**
   * menuOrder(entries, cfg) -> ids, in the order the pause menu lists them.
   * entries are [{ id, order }]; cfg is the look's `menu` (`order`, `hide`).
   *
   * `(order || 50)` is kept exactly as the menu always sorted, an order of 0
   * included: a module that wrote `order: 0` has been sitting at 50 all along,
   * and moving it now would reshuffle somebody's menu for no reason they chose.
   * `'*'` in `order` stands for every entry not named, in that sorted order,
   * and an order without one keeps the unnamed entries at the end — a module
   * switched on later must not vanish from a menu somebody arranged before it
   * existed. Settings can never be hidden: it is where a player turns the
   * sound down, and a game without it is a game somebody cannot play.
   */
  L.menuOrder = function (entries, cfg) {
    const c = cfg || {};
    const sorted = (entries || []).slice().sort((a, b) => ((a.order || 50) - (b.order || 50)) || 0).map(e => e.id);
    const order = Array.isArray(c.order) && c.order.length ? c.order.slice() : ['*'];
    if (!order.includes('*')) order.push('*');
    const named = new Set(order.filter(id => id !== '*'));
    const out = [];
    for (const id of order) {
      if (id === '*') { for (const r of sorted) if (!named.has(r) && !out.includes(r)) out.push(r); }
      else if (sorted.includes(id) && !out.includes(id)) out.push(id);
    }
    const hide = new Set((Array.isArray(c.hide) ? c.hide : []).filter(id => id !== 'settings'));
    return out.filter(id => !hide.has(id));
  };

  // ---- the validator ------------------------------------------------------------------
  KIT.registry('validators').add({ id: 'ui', label: 'Look', run(project) { return L.problems(project); } });

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
