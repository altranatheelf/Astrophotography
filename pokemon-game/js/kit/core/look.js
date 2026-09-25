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
  // `follows` names the token such a one is drawn in meanwhile, and `shows` is
  // the colour it is drawn in when that is a picture rather than a token (the
  // title's night sky), so the Look panel can show that colour in its square
  // instead of black. `label` is what the Look panel calls a token, in the
  // words of somebody making a game rather than somebody writing CSS;
  // `noneLabel` is what "no colour" means for a nullable one, said the same way.
  const color = (key, label, def, css, fallback, group, doc, more) => Object.assign({ key, label, type: 'color', default: def, css, fallback, group, doc }, more || {});
  const ink = (key, label, css, doc) => color(key, label, null, css, 'var(--kit-accent, #3b4b8a)', 'accent', doc, { nullable: true, noneLabel: 'Same as accent', follows: 'accent' });
  L.TOKENS = [
    color('paper', 'Box', '#fdfdfb', '--paper', '#fdfdfb', 'box', 'The message box and panel background.'),
    color('ink', 'Text', '#23233a', '--ink', '#23233a', 'box', 'Text in the box and panels.'),
    color('frame', 'Border', '#2b2b3a', '--kit-frame', '#2b2b3a', 'box', 'The border round the box, the panels and the portrait.'),
    { key: 'frameWidth', label: 'Border thickness', type: 'number', integer: true, min: 0, max: 12, default: 3, css: '--kit-frame-w', fallback: '3px', form: 'px', group: 'box', doc: 'How thick that border is.' },
    { key: 'radius', label: 'Rounded corners', type: 'number', integer: true, min: 0, max: 24, default: 10, css: '--kit-radius', fallback: '10px', form: 'px', group: 'box', doc: 'How round the corners are. 0 is square.' },
    color('rim', 'Inner line', '#dfe3ef', '--kit-rim', '#dfe3ef', 'box', 'The thin line just inside the border.', { nullable: true, none: 'transparent', noneLabel: 'None' }),
    color('drop', 'Shadow under the box', '#000000', '--kit-drop', 'rgba(0, 0, 0, .35)', 'box', 'The shadow under the box and panels.', { nullable: true, none: 'transparent', form: 'rgba', alpha: 0.35, noneLabel: 'None' }),
    color('shadow', 'Shadow under the letters', null, '--kit-text-shadow', 'none', 'box', 'A shadow under the letters in the box.', { nullable: true, none: 'none', form: 'textShadow', noneLabel: 'None' }),
    color('accent', 'Accent', '#3b4b8a', '--kit-accent', '#3b4b8a', 'accent', 'The one colour to change first: names, markers, the cursor and the selected row all follow it.'),
    ink('nameInk', 'Speaker\'s name', '--kit-name-ink', 'The speaker\'s name.'),
    ink('markerInk', '“More” mark', '--kit-marker-ink', 'The ▼ that says there is more.'),
    ink('titleInk', 'Panel titles', '--kit-title-ink', 'Panel titles.'),
    ink('cursorInk', 'Cursor', '--kit-cursor-ink', 'The cursor beside the selected row.'),
    ink('valueInk', 'Menu values', '--kit-value-ink', 'Values in the menus (on, off, 50%).'),
    ink('selectFrame', 'Border of the chosen line', '--kit-sel-frame', 'The border of the selected row.'),
    ink('button', 'OK button', '--kit-button', 'The OK button.'),
    // The OK button's word and the inside of the name box were white whatever
    // the look, so a look with a white accent and white text (Soul, Dream) had
    // a blank OK and a name typed white on white. They are colours of their own.
    color('buttonInk', 'OK button text', '#ffffff', '--kit-button-ink', '#fff', 'accent', 'The word on the OK button.'),
    ink('inputFrame', 'Border of a name box', '--kit-input-frame', 'The border of a name or number field.'),
    color('inputBg', 'Inside a name box', '#ffffff', '--kit-input-bg', '#fff', 'accent', 'Behind the name or number the player types, which is in the text colour.'),
    color('select', 'Chosen line', '#eaf0ff', '--kit-sel', '#eaf0ff', 'accent', 'The background of the selected row.', { nullable: true, none: 'transparent', noneLabel: 'None' }),
    color('selectInk', 'Chosen line\'s text', null, '--kit-sel-ink', 'var(--ink)', 'accent', 'The text of the selected row.', { nullable: true, noneLabel: 'Same as text', follows: 'ink' }),
    color('faceBg', 'Behind a portrait', '#eef1f8', '--kit-face-bg', '#eef1f8', 'box', 'Behind a portrait.'),
    color('dim', 'Dimmed background', '#08090f', '--kit-dim', 'rgba(8, 9, 15, .55)', 'screen', 'What darkens the game behind a message with a dimmed background.', { form: 'rgba', alpha: 'dimAmount' }),
    { key: 'dimAmount', label: 'How dark, behind a message', type: 'number', min: 0, max: 1, step: 0.05, default: 0.55, css: null, fallback: '.55', group: 'screen', doc: 'How dark that is: 0 is not at all, 1 is black.' },
    { key: 'menuDimAmount', label: 'How dark, behind the menu', type: 'number', min: 0, max: 1, step: 0.05, default: 0.5, css: '--kit-menu-dim', fallback: 'rgba(8, 9, 15, .5)', form: 'rgba', color: 'dim', alpha: 'menuDimAmount', group: 'screen', doc: 'How dark the game goes behind the pause menu and choices.' },
    { key: 'fontText', label: 'Letters', type: 'font', default: 'system', css: '--kit-font-text', fallback: 'var(--font-text)', form: 'font', group: 'text', doc: 'The letters of everything on the game screen.' },
    { key: 'fontUi', label: 'Letters of names and menus', type: 'font', default: 'pixel', css: '--font-ui', fallback: '"Press Start 2P", ui-monospace, "Courier New", monospace', form: 'font', group: 'text', doc: 'Names, titles, values, the chapter card and the title buttons.' },
    { key: 'fontName', label: 'Letters of the speaker\'s name', type: 'font', nullable: true, default: null, css: '--kit-font-name', fallback: 'var(--font-ui)', form: 'font', group: 'text', doc: 'The speaker\'s name only. Empty follows the one above.' },
    { key: 'textSize', label: 'Text size', type: 'enum', options: ['small', 'normal', 'large', 'huge'], default: 'normal', css: '--kit-text-size', fallback: 'clamp(15px, 3.6vw, 18px)', form: 'size', group: 'text', doc: 'How big a message is.' },
    { key: 'lineHeight', label: 'Line spacing', type: 'number', min: 1, max: 2.4, step: 0.05, default: 1.45, css: '--kit-line', fallback: '1.45', form: 'number', group: 'text', doc: 'Space between the lines of a message.' },
    color('screenBg', 'Behind the map', '#0a0b10', '--kit-screen-bg', '#0a0b10', 'screen', 'Behind the map, where it does not reach the edge.'),
    color('screenFrame', 'Screen border', '#2f3450', '--kit-screen-frame', '#2f3450', 'screen', 'The bezel round the game screen.'),
    color('highlight', 'Game name', '#ffcb3d', '--accent', '#ffcb3d', 'title', 'The game\'s name on the title, the chapter subtitle and the chosen title button.'),
    color('highlight2', 'Subtitle', '#6fd3ff', '--accent-2', '#6fd3ff', 'title', 'The subtitle on the title screen.'),
    color('titleBg', 'Title background', null, '--kit-title-bg', 'linear-gradient(180deg, #1a2240 0%, #101526 60%, #0a0b10 100%)', 'title', 'Behind the title screen.', { nullable: true, noneLabel: 'Night sky', shows: '#1a2240' }),
    color('titleShadow', 'Shadow under the game name', '#7a4a00', '--kit-title-shadow', '#7a4a00', 'title', 'The shadow under the game\'s name.', { nullable: true, none: 'transparent', noneLabel: 'None' }),
    color('titleButton', 'Title buttons', null, '--kit-title-button', 'rgba(255, 255, 255, .06)', 'title', 'The buttons on the title screen.', { nullable: true, noneLabel: 'See-through', follows: 'titleBg' }),
    color('titleButtonInk', 'Title button text', '#ffffff', '--kit-title-button-ink', '#fff', 'title', 'Their text.'),
    color('titlePickInk', 'Chosen title button text', '#2a1d00', '--kit-title-pick-ink', '#2a1d00', 'title', 'The text of the chosen title button.'),
    color('toastBg', 'Toast background', '#0c0e16', '--kit-toast-bg', 'rgba(12, 14, 22, .92)', 'toast', 'Behind the note.', { form: 'rgba', alpha: 0.92 }),
    color('toastFrame', 'Toast border', '#3a4160', '--kit-toast-frame', '#3a4160', 'toast', 'Its border.'),
    color('toastInk', 'Toast text', '#ffffff', '--kit-toast-ink', '#fff', 'toast', 'Its text.'),
    color('chapterBg', 'Chapter card', '#06070c', '--kit-chapter-bg', 'rgba(6, 7, 12, .82)', 'chapter', 'Behind a chapter card.', { form: 'rgba', alpha: 0.82 }),
    color('chapterInk', 'Chapter title', '#ffffff', '--kit-chapter-ink', '#fff', 'chapter', 'The chapter title.'),
    color('padFrame', 'Button borders', '#3a4160', '--kit-pad-frame', '#3a4160', 'pad', 'The border of the on-screen buttons.'),
    color('padInk', 'Arrows and labels', '#cfd6f5', '--kit-pad-ink', '#cfd6f5', 'pad', 'The arrows and the ☰ on the on-screen buttons.'),
    color('padA', 'A button', '#4a6ad8', '--kit-pad-a', 'linear-gradient(180deg, #4a6ad8, #32499e)', 'pad', 'The A button.', { form: 'gradient' }),
    color('padB', 'B button', '#d85a6a', '--kit-pad-b', 'linear-gradient(180deg, #d85a6a, #9e3244)', 'pad', 'The B button.', { form: 'gradient' }),
  ];

  /**
   * ROLES: what each sound in the interface is FOR, and what the kit plays for
   * it. The scenes ask for a role — `KIT.look.sound('move')` — and never name a
   * sound, so a look can make the cursor tick and the menu silent without a
   * scene knowing. null is silence: the kit has no sound for opening a menu,
   * and a look may give it one.
   */
  L.ROLES = { move: 'blip', confirm: 'select', cancel: 'back', buzzer: null, save: 'save', open: null, close: null, page: null, toast: null };

  // Field builders for the parts below. `label` and `doc` are what the Look
  // panel shows, so they are written for somebody making a game on a phone.
  const pick = (key, label, options, def, doc, more) => Object.assign({
    key, label, type: 'enum', display: 'chips', default: def, doc: doc || '',
    options: options.map(([value, text]) => ({ value, label: text })),
  }, more || {});
  const whole = (key, label, min, max, def, doc, more) => Object.assign({ key, label, type: 'number', integer: true, min, max, default: def, doc: doc || '' }, more || {});
  const flag = (key, label, def, doc) => ({ key, label, type: 'bool', default: def, doc: doc || '' });
  /** A short mark (a cursor, a prefix): a few letters of the author's own, or one of the offered ones. */
  const mark = (key, label, max, def, options, doc) => ({
    key, label, type: 'string', max, default: def, display: 'chips', doc,
    options: options.map(([value, text]) => ({ value, label: text || value })),
  });

  const SOUND_WORDS = {
    move: ['Moving the cursor', 'A tick as the cursor steps from one line to the next.'],
    confirm: ['Choosing', 'A line in a menu, or an answer, is picked.'],
    cancel: ['Going back', 'B, or backing out of a list.'],
    buzzer: ['“Not now”', 'A press that cannot do anything yet, like B on a question with no way out. Silent plays the going-back sound instead.'],
    save: ['Saved', 'The game has been saved.'],
    open: ['Opening the menu', ''],
    close: ['Closing the menu', ''],
    page: ['Turning a page', 'A message moving on to its next page.'],
    toast: ['A note popping up', 'A toast, like “Saved.”'],
  };

  /**
   * PARTS: the options of each piece of the interface, as schema field lists.
   * Every value is optional in a look and every one has the kit's own as its
   * default, which compiles to nothing.
   *
   * `later` marks an option a look may already hold — the built-in looks do —
   * that the Look panel does not offer yet, because the game does not act on
   * it yet (how the box opens, the page turn, a box that moves out of the way,
   * typing speeds), or because it wants an editor of its own (the pause menu's
   * order). On an enum it can be a list of the choices held back instead: the
   * answers can sit in the corner or the middle now, and by the box later.
   * A look carrying one is still a clean look, and it takes effect when the
   * game learns it, with nothing to convert.
   */
  L.PARTS = {
    dialogue: [
      whole('lines', 'Lines in the box', 2, 6, 3, 'How many lines of a message show at once. Fewer lines, more pages.'),
      whole('width', 'Width', 50, 100, 100, 'How much of the screen\'s width the box takes, in %.', { step: 2 }),
      whole('margin', 'Gap round the box', 0, 40, 10, 'Space between the box and the edge of the screen, in pixels.'),
      pick('face', 'Portrait', [['left', 'Left'], ['right', 'Right'], ['above-left', 'Above left'], ['above-right', 'Above right'], ['none', 'Hidden']], 'left',
        'Where the speaker\'s face goes, on a line that has one.'),
      whole('faceScale', 'Portrait size', 1, 6, 3, 'How many times bigger than the picture itself.'),
      flag('faceFrame', 'Frame round the portrait', true),
      pick('name', 'Speaker\'s name', [['inside', 'In the box'], ['tab', 'On a tab'], ['none', 'Hidden']], 'inside'),
      pick('nameCase', 'Letters of the name', [['as-written', 'As written'], ['upper', 'CAPITALS'], ['lower', 'lower case']], 'as-written'),
      mark('prefix', 'Start each line with', 4, '', [['* '], ['- '], ['> '], ['', 'Nothing']],
        'Put in front of every line you begin on its own. A line too long for the box carries on lined up after the mark, not under it.'),
      mark('marker', '“More” mark', 2, '▼', [['▼'], ['▶'], ['✦'], ['', 'None']],
        'Shown in the corner when a page has finished and there is more to read. Type your own, or pick one.'),
      pick('markerMotion', 'The mark', [['bob', 'Bobs'], ['blink', 'Blinks'], ['still', 'Stays still']], 'bob'),
      pick('open', 'Opening', [['none', 'Appears'], ['pop', 'Pops'], ['slide', 'Slides up']], 'none', '', { later: true }),
      pick('pageTurn', 'Next page', [['clear', 'Clears the box'], ['scroll', 'Scrolls up a line']], 'clear', '', { later: true }),
      pick('at', 'Where the box goes', [['bottom', 'Bottom'], ['avoid-hero', 'Out of the hero\'s way']], 'bottom', '', { later: true }),
      { key: 'speeds', label: 'Typing speeds', type: 'group', later: true, doc: 'Letters a second for each text speed a player can pick.',
        fields: [whole('slow', 'Slow', 1, 120, 22), whole('normal', 'Normal', 1, 120, 48), whole('fast', 'Fast', 1, 120, 96)] },
    ],
    choice: [
      pick('place', 'Where the answers go', [['corner', 'Corner'], ['center', 'Middle'], ['above-box', 'Above the box'], ['in-box', 'In the box'], ['beside-box', 'Beside the box']], 'corner',
        '', { later: ['above-box', 'in-box', 'beside-box'] }),
      pick('layout', 'Answers in a', [['column', 'Column'], ['row', 'Row'], ['grid', 'Grid']], 'column'),
      whole('columns', 'Columns', 2, 4, 2, 'How many answers across, in a grid.', { when: { field: 'layout', eq: 'grid' } }),
    ],
    menu: [
      pick('at', 'Where', [['center', 'Middle'], ['left', 'Left'], ['right', 'Right'], ['top-left', 'Top left'], ['top', 'Top']], 'center',
        'Where the pause menu sits on the screen.'),
      flag('title', '“Paused” at the top', true),
      flag('hint', 'Help line at the bottom', true, 'The line saying how to use the pause menu. Settings and Save keep theirs, so a player can always see how to get back out.'),
      flag('caps', 'CAPITAL letters', false),
      { key: 'order', label: 'Order', type: 'list', of: { type: 'string' }, default: ['*'], later: true },
      { key: 'hide', label: 'Hidden', type: 'list', of: { type: 'string' }, default: [], later: true },
    ],
    toast: [
      pick('at', 'Where', [['top', 'Top'], ['bottom', 'Bottom'], ['center', 'Middle']], 'top', 'Where on the screen it pops up.'),
      pick('shape', 'Shape', [['pill', 'Pill'], ['box', 'Box']], 'pill', 'A box has the same corners as the message box.'),
      whole('ms', 'How long it stays', 600, 6000, 1600, 'In thousandths of a second: 1000 is one second.', { step: 200 }),
    ],
    pad: [
      pick('shape', 'A and B buttons', [['round', 'Round'], ['square', 'Square']], 'round', 'The on-screen buttons a phone plays with.'),
    ],
    cursor: [
      mark('glyph', 'Cursor', 2, '▶', [['▶'], ['♥'], ['☞'], ['►'], ['•'], ['', 'None']],
        'Pick one, or type your own: one or two letters.'),
      { key: 'color', label: 'Cursor colour', type: 'color', nullable: true, default: null, noneLabel: 'Same as accent', follows: 'cursorInk' },
      whole('size', 'Cursor size', 8, 32, 11, 'In pixels.'),
      flag('highlight', 'Box round the chosen line', true, 'Off leaves only the cursor to say which line is chosen.'),
    ],
    sounds: Object.keys(L.ROLES).map((role) => Object.assign(
      { key: role, label: SOUND_WORDS[role][0], doc: SOUND_WORDS[role][1], type: 'ref:sound', nullable: true, default: L.ROLES[role] },
      // The page-turn sound belongs with the page turn, which a look cannot change yet.
      role === 'page' ? { later: true } : {})),
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
      // One spelling per colour, lower case and six digits: '#FFF' and '#ffffff'
      // are the same white, and a look that stored one against the other kept a
      // "change" that changed nothing.
      case 'color': {
        if (typeof v !== 'string' || !HEX.test(v)) return { ok: false };
        const h = v.toLowerCase();
        return { ok: true, value: h.length === 4 ? '#' + h.slice(1).split('').map(c => c + c).join('') : h };
      }
      case 'number': {
        if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false };
        let n = f.integer ? Math.round(v) : v;
        if (f.min != null) n = Math.max(f.min, n);
        if (f.max != null) n = Math.min(f.max, n);
        return { ok: true, value: n };
      }
      case 'enum': return { ok: (S.enumOptions(f) || []).includes(v), value: v };
      case 'bool': return { ok: typeof v === 'boolean', value: v };
      // A mark is cut to its length in letters as a person counts them (code
      // points, so ♥ and an emoji are one each), the way a number is pulled
      // into range. It reaches CSS only through cssString, which escapes it.
      case 'string': return typeof v === 'string' ? { ok: true, value: Array.from(v).slice(0, f.max == null ? undefined : f.max).join('') } : { ok: false };
      case 'list': return { ok: Array.isArray(v) && v.every((x) => typeof x === 'string' && (x === '*' || ID.test(x))), value: Array.isArray(v) ? v.slice() : v };
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
      // A group (the typing speeds) is cleaned field by field, like a part.
      if (f && f.type === 'group' && isObj(obj[k])) { out[k] = cleanFields(f.fields, obj[k], path.concat(k), dropped); continue; }
      const r = f && f.type !== 'group' ? clean(f, obj[k]) : { ok: false };
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

  /**
   * cleanAt(path, value) -> { ok, value } — one value of a look, cleaned as the
   * field at `path` (inside `ui`: ['tokens', 'paper'], ['dialogue', 'prefix'],
   * ['voice']) says, the way `sanitize` would clean it inside a whole look. It
   * is what the editor stores: a prefix typed eight letters long is the four
   * the game uses, so the game's look and the stored one never disagree about
   * what was changed. A path that is no field is not ok.
   */
  L.cleanAt = function (path, value) {
    const [k, ...rest] = path || [];
    if (k === 'voice' && !rest.length) return { ok: value === null || (typeof value === 'string' && ID.test(value)), value };
    let fields = k === 'tokens' ? L.TOKENS : (KIT.has(L.PARTS, k) ? L.PARTS[k] : null);
    let f = null;
    for (let i = 0; i < rest.length; i++) {
      f = fields ? fields.find(x => x.key === rest[i]) : null;
      if (!f) return { ok: false };
      fields = f.type === 'group' ? f.fields : null;
    }
    if (!f) return { ok: false };
    if (f.type !== 'group') return clean(f, value);
    const dropped = [];
    const out = cleanFields(f.fields, value, [], dropped);
    return dropped.length ? { ok: false } : { ok: true, value: out };
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

  /**
   * inherited(project, path) -> what `path` (['dialogue', 'lines'], ['tokens'])
   * comes to from the look this game starts from, without the game's own
   * changes on top. It is the answer to "is this change a change at all?": a
   * value equal to it is not stored (project.ui holds overrides only), and ↺ in
   * the Look panel puts it back.
   */
  L.inherited = function (project, path) {
    const ui = project && isObj(project.ui) ? project.ui : {};
    let v = L.resolve(Object.assign({}, project || {}, { ui: typeof ui.base === 'string' ? { base: ui.base } : {} }));
    for (const k of path || []) {
      if (!isObj(v) || !KIT.has(v, k)) return undefined;
      v = v[k];
    }
    return v;
  };

  function rgb(hex) {
    let h = hex.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }

  // ---- what the validator says about a look ----------------------------------------

  /** contrast(a, b) -> the WCAG contrast ratio of two hex colours, 1 to 21. */
  function contrast(a, b) {
    const lum = (hex) => {
      const [r, g, bl] = rgb(hex).map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  /** Each text size's clamp() in css/kit.css, worked out for a phone 390 pixels wide. */
  const TEXT_PX = { small: 13, normal: 15, large: 17, huge: 20 };
  /**
   * How tall the game screen is on a 390×844 phone, in pixels: the page less
   * the on-screen buttons under it (three rows of 56-pixel buttons) and the
   * gaps round them. The box is measured against what the player can see.
   */
  const GAME_H = 630;

  /**
   * boxHeight(look) -> about how tall the message box is on a 390-pixel phone, in
   * pixels. An estimate from the numbers the stylesheet uses — the text, the
   * name above it, the padding and the border, a portrait of the usual 24
   * pixels — good enough to say "this covers half the game" before anybody
   * has played it, which is all it is for.
   */
  function boxHeight(look) {
    const d = look.dialogue, t = look.tokens;
    const chrome = 22 + 2 * t.frameWidth;
    let h = d.lines * t.lineHeight * (TEXT_PX[t.textSize] || 15) + chrome + (d.name === 'inside' ? 18 : 0);
    const face = 24 * d.faceScale + 8;
    if (d.face === 'left' || d.face === 'right') h = Math.max(h, face + chrome);
    else if (d.face === 'above-left' || d.face === 'above-right') h += face + 6;
    return h + d.margin;
  }

  /**
   * checks(look, project) -> the problems a look can have that are not about
   * reading it: words hard to read against their background (below 3:1, the
   * least that still reads on a phone outdoors), a message box that would
   * cover half the game, and a sound or voice this game does not have. All
   * warnings: the game plays either way.
   */
  function checks(look, project) {
    const out = [];
    const t = look.tokens;
    // The chosen line has a background of its own only with the box round it
    // on; with it off, the line is read against the box like any other.
    const chosenBg = look.cursor.highlight && t.select ? t.select : t.paper;
    const chosenInk = t.selectInk || t.ink;
    const cursorInk = look.cursor.color || t.cursorInk || t.accent;
    const pairs = [
      [['tokens', 'ink'], t.ink, t.paper, 'The text in the message box'],
      [['tokens', 'selectInk'], chosenInk, chosenBg, 'The chosen line of a menu'],
      // A value on the chosen line (a volume, a save's date). One that takes the
      // line's own colour (valueOnChosen) is read with the line, above.
      [['tokens', 'valueInk'], valueOnChosen(t, S.defaults(L.TOKENS)) ? null : (t.valueInk || t.accent), chosenBg, 'A value on the chosen line of a menu (a volume, a save\'s date)'],
      [look.cursor.color ? ['cursor', 'color'] : ['tokens', 'cursorInk'], look.cursor.glyph ? cursorInk : null, chosenBg, 'The cursor'],
      [['tokens', 'toastInk'], t.toastInk, t.toastBg, 'The text of a toast'],
      // The box that asks for a name: what is typed is in the text colour, on
      // a background of its own; and OK's word is on the OK button.
      [['tokens', 'inputBg'], t.ink, t.inputBg, 'A name the player types'],
      [['tokens', 'buttonInk'], t.buttonInk, t.button || t.accent, 'The word on the OK button'],
    ];
    for (const [path, fg, bg, what] of pairs) {
      if (!HEX.test(fg || '') || !HEX.test(bg || '')) continue;
      const r = contrast(fg, bg);
      if (r < 3) out.push(problem('warn', 'ui-contrast', `${what} is hard to read: its colours are only ${r.toFixed(1)} to 1 apart, and 3 to 1 is the least that reads on a phone.`, ['ui'].concat(path)));
    }
    const h = boxHeight(look);
    if (h > 0.45 * GAME_H) {
      out.push(problem('warn', 'ui-lines', `The message box would be about ${Math.round(h)} pixels tall on a phone, ${Math.round((100 * h) / GAME_H)}% of the game screen. Fewer lines, smaller text or a smaller portrait keeps the game in sight.`, ['ui', 'dialogue', 'lines']));
    }
    // Only a definite "not here" counts: a registry nothing has filled yet
    // (a tool that loaded half the engine) cannot tell, and is not a problem.
    const missing = (kind, id) => { const r = S.refKinds[kind]; return !!(id && r && r.has && r.has(id, { project }) === false); };
    for (const f of L.PARTS.sounds) {
      const id = look.sounds[f.key];
      if (missing('sound', id)) out.push(problem('warn', 'ui-ref', `There is no sound “${id}” in this game, so ${f.label.toLowerCase()} makes no sound.`, ['ui', 'sounds', f.key]));
    }
    if (missing('voice', look.voice)) out.push(problem('warn', 'ui-ref', `There is no voice “${look.voice}” in this game, so talking sounds like the ordinary voice.`, ['ui', 'voice']));
    return out;
  }

  /**
   * problems(project) -> what the `ui` validator reports: a broken chain of
   * looks, values that were left out, and what checks() finds.
   */
  L.problems = function (project) {
    const look = L.resolve(project);
    return look._problems.concat(checks(look, project));
  };

  // ---- compiling ---------------------------------------------------------------------
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
   * cssString(text) -> a CSS string, quotes included. Letters, digits, a space
   * and `* . _ , ! ? -` stand as they are; everything else is written as its
   * code point (`\2665 `), so nothing an author types — a quote, a brace, a
   * semicolon — can close the string it sits in.
   */
  const cssString = (s) => '"' + Array.from(String(s)).map((ch) => (/[A-Za-z0-9 *._,!?-]/.test(ch) ? ch : '\\' + ch.codePointAt(0).toString(16) + ' ')).join('') + '"';

  /** part(look, name) -> that part of a look, every field cleaned or the kit's own. */
  function part(look, name) {
    const given = look && isObj(look[name]) ? look[name] : {};
    const out = {};
    for (const f of L.PARTS[name]) {
      const r = f.type === 'group' ? { ok: false } : clean(f, given[f.key]);
      out[f.key] = r.ok ? r.value : S.defaultFor(f);
    }
    return out;
  }

  // Where the cursor and the chosen line are drawn by the look: a question, the
  // pause menu and its lists, and the author's own screens. Never the title or
  // the start screen, which have a chosen button of their own and would look
  // broken with a heart beside it.
  const CURSOR_HOSTS = ['#screen #choice', '#screen #pause-menu', '#screen .kit-ui-screen'];
  const CURSOR_ROWS = ['#screen #choice .kit-option', '#screen #pause-menu .kit-menu-item', '#screen .kit-ui-screen .kit-uibtn'];
  /** Animations a look adds only play here: not under the player's Reduce motion, not under ?fast=1. */
  const MOVING = '#stage:not([data-kit-motion=reduce]):not([data-kit-fast])';
  const MENU_AT = { left: ['center', 'flex-start'], right: ['center', 'flex-end'], 'top-left': ['flex-start', 'flex-start'], top: ['flex-start', 'center'] };

  /**
   * valueOnChosen(tokens, kit) -> whether a value on the chosen line (a volume,
   * a save's date) is written in the chosen line's own text colour. Values
   * follow the accent, and so does nothing else on that line: a look that
   * paints the chosen line — Dream's white bar — with a white accent wrote
   * "Zoom" on the bar and its value in white on white. So when a look gives
   * the chosen line colours of its own and gives values none, the value goes
   * with the line. A look that picks a value colour keeps it, and the
   * validator says if it cannot be read.
   */
  function valueOnChosen(tokens, kit) {
    return tokens.valueInk == null && (tokens.select !== kit.select || tokens.selectInk !== kit.selectInk);
  }

  /**
   * partRules(look, tokens, vars, kit) -> the rules for the parts' options, each
   * only when it is not the kit's own, in a fixed order. A custom property a
   * part sets goes into `vars` (a Map), to join the tokens on #stage. `kit` is
   * the kit's own tokens.
   *
   * Every selector starts at #screen (or #stage), one id more than the rule it
   * overrides in css/kit.css, so a look wins over the kit and over a module's
   * own stylesheet loaded later, and cannot reach #editor.
   */
  function partRules(look, tokens, vars, kit) {
    const d = part(look, 'dialogue'), c = part(look, 'choice'), m = part(look, 'menu');
    const t = part(look, 'toast'), pad = part(look, 'pad'), cur = part(look, 'cursor');
    const out = [];
    const rule = (sel, body) => out.push(`${sel}{${body}}`);

    if (d.width !== 100) rule('#screen #dialogue .kit-box', `width:${d.width}%;margin-left:auto;margin-right:auto`);
    if (d.margin !== 10) rule('#screen #dialogue', `padding:${d.margin}px`);
    if (d.lines !== 3) rule('#screen #dialogue .kit-text', `min-height:calc(var(--kit-line,1.45) * ${d.lines} * 1em)`);
    if (d.face === 'right') rule('#screen #dialogue .kit-box', 'flex-direction:row-reverse');
    else if (d.face === 'above-left' || d.face === 'above-right') {
      // Above the box, against the box's own corner; a box at the top of the
      // screen has no room above it, so there the portrait hangs below.
      rule('#screen #dialogue .kit-facebox', `position:absolute;bottom:calc(100% + 6px);${d.face === 'above-left' ? 'left' : 'right'}:0`);
      rule('#screen #dialogue[data-position=top] .kit-facebox', 'bottom:auto;top:calc(100% + 6px)');
    } else if (d.face === 'none') rule('#screen #dialogue .kit-facebox', 'display:none!important');
    if (!d.faceFrame) rule('#screen #dialogue .kit-facebox', 'border:0;background:none;padding:0');
    if (d.name === 'tab') {
      rule('#screen #dialogue .kit-name', 'position:absolute;left:12px;bottom:calc(100% - var(--kit-frame-w,3px));margin:0;padding:4px 10px;background:var(--paper);'
        + 'border:var(--kit-frame-w,3px) solid var(--kit-frame,#2b2b3a);border-bottom:0;border-radius:var(--kit-radius,10px) var(--kit-radius,10px) 0 0');
      rule('#screen #dialogue', `padding-top:calc(${d.margin}px + 2.4em)`);          // room for the tab over a box at the top
      // A portrait above the box's left corner sits exactly where the tab does,
      // and the tab covered the bottom of the face. The tab moves to the other
      // corner, the way Dream has it the other way round.
      if (d.face === 'above-left') rule('#screen #dialogue .kit-name', 'left:auto;right:12px');
    } else if (d.name === 'none') rule('#screen #dialogue .kit-name', 'display:none!important');
    if (d.nameCase !== 'as-written') rule('#screen #dialogue .kit-name', `text-transform:${d.nameCase === 'upper' ? 'uppercase' : 'lowercase'}`);
    if (d.prefix) {
      // A margin, not a padding: the scene measures the text's clientWidth to
      // wrap it, and a margin keeps that the true width of the words.
      rule('#screen #dialogue .kit-text', 'margin-left:var(--kit-prefix-w,2ch)');
      rule('#screen #dialogue .kit-line.is-start::before', `content:${cssString(d.prefix)};display:inline-block;white-space:pre;width:var(--kit-prefix-w,2ch);margin-left:calc(-1 * var(--kit-prefix-w,2ch))`);
    }
    if (d.marker === '') rule('#screen #dialogue .kit-next', 'display:none');
    if (d.markerMotion !== 'bob') {
      rule('#screen #dialogue .kit-next.is-ready', 'animation:none');
      if (d.markerMotion === 'blink') {
        out.push('@keyframes kit-look-blink{50%{opacity:0}}');
        rule(MOVING + ' #screen #dialogue .kit-next.is-ready', 'animation:kit-look-blink 1s steps(1,end) infinite');
      }
    }

    if (c.place === 'center') rule('#screen #choice', 'align-items:center;justify-content:center;padding-bottom:14px');
    if (c.layout === 'row') rule('#screen #choice .kit-list', 'flex-direction:row;flex-wrap:wrap;justify-content:space-around');
    else if (c.layout === 'grid') rule('#screen #choice .kit-list', `display:grid;grid-template-columns:repeat(${c.columns},1fr)`);

    // The kit's own lists only (a .kit-pause panel): a module's screen drawn
    // in the same host places itself, and a look moving it would put a fight's
    // health bar in the corner.
    if (MENU_AT[m.at]) rule('#screen #pause-menu:has(> .kit-pause)', `align-items:${MENU_AT[m.at][0]};justify-content:${MENU_AT[m.at][1]}`);
    // Capitals are for the menu's words. A notice in the list — the save
    // list's warning that the browser may clear this game — is sentences, and
    // six lines of sentences in capitals are hard to read.
    if (m.caps) rule('#screen #pause-menu .kit-menu-item:not(.kit-menu-notice) .kit-item-label', 'text-transform:uppercase');

    if (t.at === 'bottom') rule('#screen #toast', 'align-items:flex-end;padding:0 0 14px');
    else if (t.at === 'center') rule('#screen #toast', 'align-items:center;padding:0');
    if (t.shape === 'box') vars.set('--kit-toast-radius', tokens.radius + 'px');
    if (pad.shape === 'square') vars.set('--kit-pad-ab-radius', '12px');

    if (cur.glyph !== '▶') rule(CURSOR_ROWS.map(s => s + '::before').join(','), cur.glyph === '' ? 'display:none' : `content:${cssString(cur.glyph)}`);
    const own = [];
    if (cur.size !== 11) own.push(`--kit-cursor-size:${cur.size}px`);
    if (cur.color) own.push(`--kit-cursor-ink:${cur.color}`);
    if (own.length) rule(CURSOR_HOSTS.join(','), own.join(';'));
    if (!cur.highlight) rule(CURSOR_ROWS.map(s => s + '.is-selected').join(','), 'background:transparent;border-color:transparent');
    if (valueOnChosen(tokens, kit)) rule(CURSOR_ROWS.map(s => s + '.is-selected .kit-item-value').join(','), 'color:var(--kit-sel-ink,var(--ink))');
    return out;
  }

  /**
   * compile(look, env) -> string. Pure and deterministic: the same look gives
   * the same text, and the kit look gives ''. `env` is what the look may name
   * that lives in the game rather than in the look: `{ fonts }`, the game's
   * project.fonts.
   *
   * Only what DIFFERS from the kit is written: the tokens as custom properties
   * on #stage — the element the stylesheet's `var(--kit-*, …)` fallbacks sit
   * under — and then a rule for each part's option that is not the kit's
   * (partRules). Nothing here can reach Creator Mode, which lives outside
   * #stage. Values are cleaned again here: a look handed in by hand has not
   * been through resolve.
   */
  L.compile = function (look, env) {
    const e = isObj(env) ? env : {};
    const given = (look && isObj(look.tokens)) ? look.tokens : {};
    const tokens = {}, kit = S.defaults(L.TOKENS);
    for (const t of L.TOKENS) {
      const r = clean(t, given[t.key]);
      tokens[t.key] = r.ok ? r.value : kit[t.key];
    }
    const vars = new Map();
    for (const t of L.TOKENS) {
      if (!t.css) continue;
      const v = tokenCss(t, tokens, e);
      if (v !== null && v !== tokenCss(t, kit, e)) vars.set(t.css, v);
    }
    const rules = partRules(look, tokens, vars, kit);
    if (vars.size) rules.unshift(`#stage{${Array.from(vars, ([k, v]) => `${k}:${v}`).join(';')}}`);
    return rules.join('\n');
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
