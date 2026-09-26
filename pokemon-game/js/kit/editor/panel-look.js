// Creator Mode — the Look panel: how the game looks and sounds.
//
// Its own group, beside Map, Story and Game (ADR-0017). The top half of the
// phone is a live preview of the game screen (js/kit/editor/look-preview.js),
// the sheet under it is this: a row of looks to start from, then the parts of
// the interface one at a time — colours, fonts, the message box, how the words
// type, the answers to a question, the cursor, the pause menu, the toast, the
// on-screen buttons and the sounds. Every section is a form drawn from the
// look's own field lists (KIT.look.TOKENS and KIT.look.PARTS), so an option
// added there is an option here, with the words it was given there.
//
// Every change is seen at once and written once. A control's value goes into
// a draft; the draft is put on the page (KIT.look.apply) on the next frame,
// which is what the preview shows; and it is written to the document as ONE
// undo step when the controls have been still for 300 ms (KIT.editor.pending).
// A colour dragged across the picker is one step, and so are three quick taps
// on a stepper. Writes go through KIT.editor.ops.look, which keeps project.ui
// to what the game changes: pick a value the look underneath already has and
// nothing is stored.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const ED = KIT.editor = KIT.editor || {};
  const L = KIT.look;

  /**
   * The sections, in the order they are listed. `tab` is what the preview
   * shows while the section is open, so opening "Message box" shows somebody
   * talking; `part` is the KIT.look.PARTS list the section's form is drawn
   * from (`only` and `skip` share one list between two sections); `tokens`
   * are the colours, or the fonts, that belong with it. The message box's
   * options about how the words arrive, not about the box, are Typing's.
   */
  const TYPING = ['speeds', 'pageTurn'];
  const FONT_TOKENS = ['fontText', 'fontUi', 'fontName', 'textSize', 'lineHeight'];
  const SECTIONS = [
    { id: 'start', label: 'Start from', tab: 'talk' },
    { id: 'colours', label: 'Colours' },
    { id: 'fonts', label: 'Fonts', tab: 'talk', tokens: FONT_TOKENS },
    { id: 'box', label: 'Message box', tab: 'talk', part: 'dialogue', skip: TYPING, hint: 'The box people talk in.' },
    { id: 'typing', label: 'Typing', tab: 'talk', part: 'dialogue', only: TYPING },
    { id: 'choice', label: 'Choices', tab: 'choice', part: 'choice', hint: 'The answers when the game asks a question, like Yes and No.' },
    { id: 'cursor', label: 'Cursor', tab: 'menu', part: 'cursor', hint: 'The mark beside the chosen line, in a question or a menu.' },
    { id: 'menu', label: 'Pause menu', tab: 'menu', part: 'menu', hint: 'The menu ☰ opens during the game.' },
    { id: 'toast', label: 'Toast', tab: 'toast', part: 'toast', hint: 'A toast is the little note that pops up, like “Saved.”', tokens: ['toastBg', 'toastFrame', 'toastInk'] },
    { id: 'pad', label: 'On-screen buttons', tab: 'pad', part: 'pad', tokens: ['padFrame', 'padInk', 'padA', 'padB'] },
    { id: 'sounds', label: 'Sounds', tab: 'talk' },
  ];
  // The colours an author reaches for first, then the rest behind "More colours".
  const MAIN_COLOURS = ['paper', 'ink', 'frame', 'accent', 'select', 'selectInk', 'dim', 'frameWidth', 'radius'];
  /**
   * Where each colour can be seen: the preview tabs that draw it, the first
   * being the one to turn to. Changing "Chosen line" while somebody talks
   * changed nothing on the screen, and a control that changes nothing looks
   * broken; so a colour the current tab does not draw turns the preview to
   * one that does. A colour missing here is on every tab (the screen round
   * the game) or drawn wherever the box is.
   */
  const BOXES = ['talk', 'choice', 'menu', 'name', 'pad', 'dim'];
  const LISTS = ['menu', 'choice'];
  const TITLE = ['title'];
  // The letters of what is said (fontText) are on every tab; the rest of the
  // Fonts section is drawn where somebody talks, or where names and headings are.
  const TALK = ['talk', 'pad', 'dim'];
  const SHOWN_IN = {
    fontUi: ['talk', 'menu', 'title', 'toast', 'pad', 'dim'], fontName: TALK, textSize: TALK, lineHeight: TALK,
    paper: BOXES, ink: BOXES, frame: BOXES, frameWidth: BOXES, radius: BOXES, rim: BOXES, drop: BOXES, shadow: BOXES,
    accent: ['talk', 'choice', 'menu', 'pad', 'dim'], nameInk: ['talk', 'pad', 'dim'], markerInk: ['talk', 'pad', 'dim'], faceBg: ['talk', 'dim'],
    titleInk: ['menu'], valueInk: ['menu'], cursorInk: LISTS, selectFrame: LISTS, select: LISTS, selectInk: LISTS, menuDimAmount: LISTS,
    dim: ['dim'], dimAmount: ['dim'],
    button: ['name'], buttonInk: ['name'], inputFrame: ['name'], inputBg: ['name'],
    highlight: ['title', 'toast'], highlight2: TITLE, titleBg: TITLE, titleShadow: TITLE, titleButton: TITLE, titleButtonInk: TITLE, titlePickInk: TITLE,
    toastBg: ['toast'], toastFrame: ['toast'], toastInk: ['toast'], chapterBg: ['toast'], chapterInk: ['toast'],
    padFrame: ['pad'], padInk: ['pad'], padA: ['pad'], padB: ['pad'],
  };
  /**
   * Turn the preview to a tab that shows this colour, unless it already does.
   * The chosen line's box and its border are not drawn at all while the look
   * has no box round the chosen line (Soul, Handheld): there, say so, and
   * where to turn it on, rather than change a colour nobody can see.
   */
  function showColour(key) {
    let tabs = SHOWN_IN[key];
    // Names and menus shows on Talk only in the speaker's name, and in the
    // menu only in its heading. A look that hides them (Handheld, Soul) shows
    // it on the title — the game's name and buttons — and the chapter card.
    if (key === 'fontUi') {
      const look = L.current();
      tabs = tabs.filter(t => !(look.dialogue.name === 'none' && TALK.includes(t)) && !(t === 'menu' && look.menu.title === false));
    }
    if (preview && tabs && !tabs.includes(preview.tab())) preview.show(tabs[0]);
    if ((key === 'select' || key === 'selectFrame') && L.current().cursor.highlight === false) {
      ED.toast('This look has no box round the chosen line, so this colour does not show. Cursor › Box round the chosen line turns it on.');
    }
    // The same for the speaker's name, in a look that hides it (Handheld, Soul).
    if ((key === 'fontName' || key === 'nameInk') && L.current().dialogue.name === 'none') {
      ED.toast('This look hides the speaker\'s name, so this does not show. Message box › Speaker\'s name shows it.');
    }
  }
  /** Which section a path inside `ui` is set in, for a problem to open and for a tap on the preview. */
  function sectionOf(path) {
    const [k, key] = path || [];
    if (!k || k === 'base') return 'start';
    if (k === 'tokens') return (SECTIONS.find(s => (s.tokens || []).includes(key)) || { id: 'colours' }).id;
    if (k === 'sounds' || k === 'voice') return 'sounds';
    return (SECTIONS.find(s => s.part === k && (!s.only || s.only.includes(key)) && !(s.skip || []).includes(key)) || { id: 'start' }).id;
  }
  /**
   * sectionFor(path) -> [section, field] for a problem's path in the project:
   * ['ui', …] is the look, ['fonts', id] one of the game's font files, which
   * Fonts lists.
   */
  function sectionFor(path) {
    const p = path || [];
    if (p[0] === 'fonts') return ['fonts', p[1] || null];
    return [sectionOf(p.slice(1)), p[2] || null];
  }

  // Kept outside the panel, so leaving it and coming back finds it as it was.
  // `field` is one to scroll to and flash the next time the panel is drawn.
  const state = { open: 'start', field: null };
  const moreColours = { open: false };

  // =================================================================================
  // The draft: what the controls say, not yet written
  // =================================================================================
  const draft = new Map();            // 'dialogue.lines' -> { path, value }
  let draftLabel = '';
  let applyRaf = 0;

  /** The document's project with the draft on top: what the preview and the forms show. */
  function draftProject() {
    const p = ED.state.project;
    if (!draft.size) return p;
    const ui = KIT.deepClone(KIT.isObject(p.ui) ? p.ui : {});
    for (const { path, value } of draft.values()) {
      let at = ui;
      for (const k of path.slice(0, -1)) { if (!KIT.isObject(at[k])) at[k] = {}; at = at[k]; }
      at[path[path.length - 1]] = KIT.deepClone(value);
    }
    return Object.assign({}, p, { ui });
  }
  /** Put the draft on the page on the next frame: at most once a frame, however fast the picker sends. */
  function showDraft() {
    if (applyRaf) return;
    applyRaf = requestAnimationFrame(() => { applyRaf = 0; L.apply(draftProject()); });
  }
  /**
   * followDocument() — the page shows the document's look (and the draft on
   * top), whichever panel is open. An undo can change the look from anywhere:
   * a change made here, then Map, then ↶ took `ui` out of the game while the
   * page kept the look — and KIT.look.get went on answering with it — until
   * the author came back to Look. So every change to the document is checked
   * against what was last put on the page, not only the ones Look sees.
   */
  let applied = '';
  function followDocument() {
    const p = ED.state && ED.state.project;
    if (!p) return;
    const now = JSON.stringify([p.ui || null, fontsKey(p), Array.from(draft.values())]);
    if (now !== applied) { applied = now; showDraft(); }
  }
  /**
   * fontsKey(project) -> the game's fonts, short: an import from Game ›
   * Import changes them without touching the look, and the page needs their
   * @font-face all the same. Each file is known by its length, not its
   * hundreds of kilobytes, since this is asked at every change to the game.
   */
  function fontsKey(p) {
    const fonts = KIT.isObject(p.fonts) ? p.fonts : {};
    return Object.keys(fonts).sort().map(id => { const f = fonts[id] || {}; return [id, f.name, String(f.src || '').length, f.pixel, f.px]; });
  }
  let following = false;
  function follow() {
    if (following || typeof ED.on !== 'function') return;
    following = true;
    ED.on('document', followDocument);
  }
  function writeDraft() {
    if (!draft.size) return;
    const entries = Array.from(draft.values());
    draft.clear();
    ED.commit('Look: ' + draftLabel, (doc, O) => { for (const e of entries) O.look.set(doc, e.path, e.value); });
  }
  /** What `path` is in the game as the panel now shows it: the document, the draft on top, the looks under it. */
  function effective(path) {
    let at = L.resolve(draftProject());
    for (const k of path) { if (!KIT.isObject(at)) return undefined; at = at[k]; }
    return at;
  }
  /**
   * change(path, value, label) — one control moved. Seen now; written when
   * the controls are still. A value the game already has is not a change, and
   * writing it would leave an undo step that undoes nothing (a colour box
   * reports its value again when it loses the caret, say).
   */
  function change(path, value, label) {
    if (KIT.deepEqual(effective(path), value)) return;
    draft.set(path.join('.'), { path, value });
    draftLabel = label;
    if (path[0] === 'tokens') showColour(path[1]);
    showDraft();
    ED.pending('look', writeDraft, 300);
  }

  // =================================================================================
  // The panel
  // =================================================================================
  const make = (spec, o) => KIT.ui.make(spec, o);
  const clear = (el) => KIT.ui.clear(el);
  const btn = (...args) => ED.inspector.btn(...args);
  const INS = () => ED.inspector;

  let preview = null;                 // the stage's preview, while it is up
  let panel = null;                   // { host, forms:[{ form, get }], sig, now }

  /** Every look there is to start from: the kit's, then the game's own. */
  function looks(project) {
    const out = KIT.registry('looks').list().map(d => ({ id: d.id, label: d.label || d.id, describe: d.describe || '' }));
    const own = KIT.isObject(project.looks) ? project.looks : {};
    for (const id of Object.keys(own)) if (!out.some(l => l.id === id)) out.push({ id, label: (own[id] && own[id].label) || id, describe: (own[id] && own[id].describe) || '' });
    return out;
  }

  /**
   * swatch(look) -> a tiny message box in that look: its paper, border,
   * corners and letters, a line of talk (with the mark, when it starts lines
   * with one) and an answer with the look's cursor. Enough to tell four looks
   * apart at a glance before tapping any of them.
   */
  function swatch(look) {
    const t = look.tokens, d = look.dialogue, c = look.cursor;
    const box = make('div.ed-look-swatch');
    box.setAttribute('aria-hidden', 'true');
    // A portrait above the box changes its whole outline (Dream's framed face
    // over the right-hand corner), so it is drawn: a square in the portrait's
    // colours, at its corner. The tab moves out of its way as it does in the game.
    const above = d.face === 'above-left' || d.face === 'above-right';
    if (above) {
      const face = make('span.ed-look-swatch-face');
      Object.assign(face.style, { background: t.faceBg, borderColor: d.faceFrame ? t.frame : 'transparent' });
      face.style[d.face === 'above-left' ? 'left' : 'right'] = '4px';
      box.appendChild(face);
      box.classList.add('has-face-above');
    }
    Object.assign(box.style, {
      background: t.paper, color: t.ink, borderColor: t.frame,
      borderWidth: Math.max(1, Math.round(t.frameWidth * 0.7)) + 'px', borderRadius: Math.round(t.radius * 0.6) + 'px',
      fontFamily: L.family(t.fontText) || '', textShadow: t.shadow ? `1px 1px 0 ${t.shadow}` : 'none',
    });
    if (d.name === 'tab') {
      const tab = make('span.ed-look-swatch-tab', { text: d.nameCase === 'upper' ? 'MIRA' : 'Mira' });
      Object.assign(tab.style, { background: t.paper, borderColor: t.frame, color: t.nameInk || t.accent, borderWidth: Math.max(1, Math.round(t.frameWidth * 0.7)) + 'px' });
      if (d.face === 'above-left') Object.assign(tab.style, { left: 'auto', right: '6px' });
      box.appendChild(tab);
    } else if (d.name === 'inside') {
      const name = make('span.ed-look-swatch-name', { text: d.nameCase === 'upper' ? 'MIRA' : 'Mira' });
      name.style.color = t.nameInk || t.accent;
      box.appendChild(name);
    }
    box.appendChild(make('span.ed-look-swatch-line', { text: (d.prefix || '') + 'Hello there!' }));
    const answer = make('span.ed-look-swatch-line');
    const mark = make('span', { text: c.glyph ? c.glyph + ' ' : '' });
    mark.style.color = c.color || t.cursorInk || t.accent;
    answer.appendChild(mark);
    answer.appendChild(make('span', { text: 'Yes' }));
    if (c.highlight && t.select) { answer.style.background = t.select; answer.style.color = t.selectInk || t.ink; }
    else if (t.selectInk) answer.style.color = t.selectInk;
    box.appendChild(answer);
    return box;
  }

  function startSection(body, p, look) {
    const cards = make('div.ed-look-cards');
    const all = looks(p);
    const inUse = look.base || 'kit';
    for (const l of all) {
      const card = make('button.ed-look-card');
      card.type = 'button';
      card.dataset.look = l.id;
      card.setAttribute('aria-pressed', String(l.id === inUse));
      card.appendChild(swatch(L.resolve(Object.assign({}, p, { ui: { base: l.id } }))));
      card.appendChild(make('span.ed-look-card-name', { text: l.label + (l.id === inUse ? '  ✓' : '') }));
      card.title = l.describe;
      card.onclick = () => chooseBase(l, body);
      cards.appendChild(card);
    }
    body.appendChild(cards);
    const current = all.find(l => l.id === inUse);
    if (current) body.appendChild(make('p.ed-hint.ed-look-describe', { text: `${current.label}: ${current.describe}` }));
    body.appendChild(make('p.ed-hint', { text: 'Starting from a look keeps nothing hidden: every part below can still be changed, and ↶ puts back the look you had.' }));
  }

  /**
   * chooseBase(look) — start from another look. With no changes of the
   * author's own there is nothing to ask. With some, the sheet asks whether
   * they go on top of the new look or are dropped; either way it is one undo
   * step.
   */
  function chooseBase(l, body) {
    ED.flushPending();
    const p = ED.state.project;
    const base = (KIT.isObject(p.ui) && p.ui.base) || 'kit';
    if (l.id === base) { ED.toast(`${l.label} is the look in use`); return; }
    const use = (clean) => ED.commit(`Look: start from ${l.label}`, (doc, O) => O.look.useBase(doc, l.id, { clean }));
    const n = ED.ops.look.overrides(p).length;
    if (!n) { use(false); return; }
    const old = body.querySelector('.ed-look-sheet');
    if (old) old.remove();
    const sheet = make('div.ed-look-sheet');
    sheet.appendChild(make('p', { text: `You have changed ${n} thing${n === 1 ? '' : 's'} yourself. Keep ${n === 1 ? 'it' : 'them'} on top of ${l.label}?` }));
    const row = make('div.ed-look-sheet-row');
    row.appendChild(btn(`Keep my changes (${n})`, `Start from ${l.label} and keep your own changes on top`, () => { sheet.remove(); use(false); }, 'primary'));
    row.appendChild(btn('Start clean', `Start from ${l.label} as it is, without your changes`, () => { sheet.remove(); use(true); }));
    row.appendChild(btn('Cancel', 'Leave the look as it is', () => sheet.remove()));
    sheet.appendChild(row);
    body.insertBefore(sheet, body.firstChild);
  }

  /** A field list as the panel offers it: options held for later left out, and choices held back taken off. */
  function offered(fields) {
    return fields.filter(f => f.later !== true).map(f => (Array.isArray(f.later)
      ? Object.assign({}, f, { options: f.options.filter(o => !f.later.includes(o.value)) })
      : f));
  }

  /**
   * shownColour(field) -> the colour an empty colour is drawn in: the token it
   * follows ("Same as accent" is the accent, the cursor is the cursor's ink,
   * which is the accent until it has one of its own), or the colour it shows
   * for a picture. null for one that is simply none ("None" has no colour).
   */
  function shownColour(field) {
    const tokens = (panel && panel.now ? panel.now : lookNow()).tokens;
    let f = field;
    for (let i = 0; f && i < 4; i++) {
      if (f.shows) return f.shows;
      const next = f.follows && L.TOKENS.find(t => t.key === f.follows);
      if (!next) return null;
      if (tokens[next.key] != null) return tokens[next.key];
      f = next;
    }
    return null;
  }

  /**
   * form(body, at, fields, get, inherited) — one form over `ui[at]` (a part,
   * the tokens, or a path inside one: ['dialogue', 'speeds']); `get(look)` is
   * that part of a resolved look. The inherited values are what ↺ goes back to
   * and what is shown dimmed; putting one back is a delete, not a copy. A font
   * field can bring a font in from where it is wanted (addFontFor).
   */
  function form(body, at, fields, get, inherited) {
    const host = make('div');
    body.appendChild(host);
    const f = INS().mount(host, {
      fields, value: get(panel.now), ctx: { inherited, project: ED.state.project, noneColour: shownColour, addFont: addFontFor },
      onChange: (path, v, info) => change([].concat(at, path), v, (info && info.field && info.field.label) || path.join(' ')),
    });
    panel.forms.push({ form: f, get });
  }

  function tokensForm(body, keys, look, inherited) {
    const fields = keys.map(k => L.TOKENS.find(t => t.key === k)).filter(Boolean);
    form(body, 'tokens', fields, (now) => now.tokens, inherited.tokens);
  }

  function coloursSection(body, look, inherited) {
    body.appendChild(make('p.ed-hint', { text: 'Tap a colour to pick one, or type it as #rrggbb. Accent is the one to try first: names, the cursor and the chosen line follow it until they have colours of their own.' }));
    tokensForm(body, MAIN_COLOURS, look, inherited);
    const owned = new Set(MAIN_COLOURS.concat(...SECTIONS.map(s => s.tokens || [])));
    const more = L.TOKENS.filter(t => !owned.has(t.key)).map(t => t.key);
    INS().section(body, 'More colours', moreColours.open, (inner) => {
      inner.appendChild(make('p.ed-hint', { text: 'The finer parts: the speaker\'s name, the “more” mark, the box that asks for a name, the title screen, the chapter card and the screen round the game.' }));
      tokensForm(inner, more, look, inherited);
    }, moreColours);
  }

  function partSection(body, sec, look, inherited) {
    if (sec.hint) body.appendChild(make('p.ed-hint', { text: sec.hint }));
    const fields = offered(L.PARTS[sec.part]).filter(f => (!sec.only || sec.only.includes(f.key)) && !(sec.skip || []).includes(f.key));
    form(body, sec.part, fields, (now) => now[sec.part], inherited[sec.part]);
    // A look may hold a choice the game cannot act on yet (an enum whose
    // `later` holds some of its choices back). No chip is lit for it, so say
    // why, and what it does now.
    for (const f of L.PARTS[sec.part]) {
      if (!Array.isArray(f.later) || !f.later.includes(look[sec.part][f.key])) continue;
      const name = (v) => (f.options.find(o => o.value === v) || { label: v }).label;
      body.appendChild(make('p.ed-hint.ed-look-later', { text: `${f.label}: this look asks for “${name(look[sec.part][f.key])}”, which the game cannot do yet, so for now it is “${name(f.default)}”. Pick one above to choose for yourself.` }));
    }
    if (sec.tokens) tokensForm(body, sec.tokens, look, inherited);
  }

  /** A select of ids, with a first "none" choice. Sounds and voices are lists too long for chips. */
  function picker(list, value, noneLabel, onPick) {
    const sel = make('select.ed-look-select');
    const none = make('option', { text: noneLabel });
    none.value = '';
    sel.appendChild(none);
    for (const o of list) { const op = make('option', { text: o.label }); op.value = o.id; sel.appendChild(op); }
    if (value && !list.some(o => o.id === value)) { const op = make('option', { text: `${value} (not in this game)` }); op.value = value; sel.appendChild(op); }
    sel.value = value || '';
    sel.onchange = () => onPick(sel.value || null);
    return sel;
  }

  function soundsSection(body, look, inherited) {
    const sounds = KIT.registry('sounds').list().map(d => ({ id: d.id, label: KIT.labelOf(d, null, d.id) }));
    body.appendChild(make('p.ed-hint', { text: 'What each thing the player does sounds like. ▶ plays it.' }));
    const rows = [];
    for (const f of L.PARTS.sounds.filter(x => !x.later)) {
      const row = make('div.ed-look-sound');
      const head = make('div.ed-look-sound-head');
      head.appendChild(make('span.ed-f-label', { text: f.label }));
      row.appendChild(head);
      const line = make('div.ed-row');
      const sel = picker(sounds, look.sounds[f.key], 'Silent', (v) => change(['sounds', f.key], v, f.label));
      sel.setAttribute('aria-label', f.label);
      line.appendChild(sel);
      line.appendChild(btn('▶', `Hear “${f.label}”`, () => { if (KIT.audio.unlock) KIT.audio.unlock(); if (sel.value) KIT.audio.play(sel.value); }));
      const reset = btn('↺', 'Back to the look\'s own sound', () => { sel.value = inherited.sounds[f.key] || ''; change(['sounds', f.key], inherited.sounds[f.key], f.label); });
      line.appendChild(reset);
      row.appendChild(line);
      if (f.doc) row.appendChild(make('div.ed-hint', { text: f.doc }));
      body.appendChild(row);
      rows.push({ row, sel, reset, key: f.key });
    }
    const voices = KIT.registry('voices').list().map(d => ({ id: d.id, label: d.name || d.id }));
    // Dimmed like the sounds above while it is the look's own voice.
    const vrow = make('div.ed-look-sound');
    vrow.appendChild(make('span.ed-f-label', { text: 'Typing sound (this look)' }));
    const vline = make('div.ed-row');
    const vsel = picker(voices, look.voice, 'The ordinary voice', (v) => change(['voice'], v, 'Typing sound'));
    vsel.setAttribute('aria-label', 'Typing sound (this look)');
    vline.appendChild(vsel);
    vline.appendChild(btn('▶', 'Hear it in the preview', () => { if (KIT.audio.unlock) KIT.audio.unlock(); if (preview) preview.show('talk', true); }));
    const vreset = btn('↺', 'Back to the look\'s own voice', () => { vsel.value = inherited.voice || ''; change(['voice'], inherited.voice, 'Typing sound'); });
    vline.appendChild(vreset);
    vrow.appendChild(vline);
    vrow.appendChild(make('div.ed-hint', { text: 'How letters sound as they appear, for anyone without a voice of their own. A person in the Cast with a voice keeps it, and Game › Project › “Everybody sounds like” wins over this.' }));
    body.appendChild(vrow);
    // The same refresh a form gets: the values follow the document, and ↺ shows only on a change.
    panel.forms.push({
      form: { refresh(now) {
        for (const r of rows) {
          if (document.activeElement !== r.sel) r.sel.value = now.sounds[r.key] || '';
          const own = now.sounds[r.key] !== inherited.sounds[r.key];
          r.reset.hidden = !own;
          r.row.classList.toggle('is-inherited', !own);
        }
        if (document.activeElement !== vsel) vsel.value = now.voice || '';
        vreset.hidden = now.voice === inherited.voice;
        vrow.classList.toggle('is-inherited', now.voice === inherited.voice);
      } },
      get: (now) => now,
    });
  }

  // ---- fonts ---------------------------------------------------------------------
  // The game's own font files (project.fonts), kept inside the game as data,
  // then the look's choice of font for what is said and for names and menus.
  // A font is brought in with the section's file picker, or from a font chip
  // ("Add a font…"), which then uses it where it was tapped.
  let fontInput = null;
  let fontFor = null;                 // the font field that asked for a file, if one did

  /** addFontFor(field) — the font field's "Add a font…": pick a file, and use it there. */
  function addFontFor(field) {
    if (!fontInput) return;
    fontFor = field ? field.key : null;
    fontInput.click();
  }

  /**
   * addFonts(files, field) — read the picked files, bring the fonts in as ONE
   * undo step, and use the first where it was asked for. What is not a font
   * is said, not dropped in silence.
   */
  async function addFonts(list, field) {
    const files = [];
    for (const f of list) {
      try { files.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }); }
      catch (e) { ED.toast(`“${f.name}” could not be read`); }
    }
    const res = KIT.import.image.fontsFrom(files);
    const found = Object.keys(res.fonts);
    if (res.problems.length) ED.toast(res.problems.map(q => q.message).join('. '));
    if (!found.length) return;
    ED.flushPending();
    ED.commit(`Look: add font ${res.fonts[found[0]].name}`, (doc, O) => {
      const got = found.map(id => O.look.addFont(doc, Object.assign({ id }, res.fonts[id])));
      if (field) O.look.set(doc, ['tokens', field], got[0]);
    });
    const name = res.fonts[found[0]].name + (found.length > 1 ? ` and ${found.length - 1} more` : '');
    const where = field && L.TOKENS.find(t => t.key === field);
    ED.toast(where ? `${name} is in the game, for ${where.label.toLowerCase()}.` : `${name} is in the game. Tap it under Message text, or Names and menus, to use it.`);
  }

  /** One of the game's fonts: its name in itself, its size, pixel or not, and a way to take it out. */
  function fontRow(id, f, fonts) {
    const row = make('div.ed-f.ed-look-font');
    row.dataset.key = id;
    const head = make('div.ed-look-font-head');
    const name = make('span.ed-look-font-name', { text: (f && f.name) || id });
    const usable = L.family(id, fonts) !== id;
    if (usable) name.style.fontFamily = L.family(id, fonts);
    head.appendChild(name);
    const bytes = f && typeof f.src === 'string' ? Math.round((f.src.length - f.src.indexOf(',') - 1) * 3 / 4) : 0;
    head.appendChild(make('span.ed-sub', { text: `${Math.max(1, Math.round(bytes / 1024))} KB` }));
    row.appendChild(head);
    // Its file, or its name: either can be what stops it, and Problems says which.
    if (!usable) row.appendChild(make('div.ed-problem.warn', { text: 'The game cannot use this font, so nothing is written in it. Problems says why.' }));
    const line = make('div.ed-row.ed-look-font-row');
    const pixel = btn('Pixel font', 'A font drawn in squares, meant for one size', () => editFont(id, f && f.pixel ? { pixel: false } : { pixel: true, px: (f && f.px) || 8 }, 'pixel font'), 'ed-chip');
    pixel.setAttribute('aria-pressed', String(!!(f && f.pixel)));
    line.appendChild(pixel);
    line.appendChild(btn('Remove', `Take ${(f && f.name) || id} out of the game (↶ brings it back)`, () => editFont(id, null, 'remove font')));
    row.appendChild(line);
    if (f && f.pixel) {
      const size = make('div.ed-look-font-size');
      size.appendChild(make('span.ed-f-label', { text: 'Drawn at' }));
      // Taps on − and + are one undo step, like every other control here.
      let px = f.px || 8;
      INS().field(size, { key: 'px', label: 'Drawn at', type: 'number', integer: true, min: 4, max: 64, default: 8 }, px, (v) => {
        px = v;
        ED.pending('look-font', () => editFont(id, { px }, 'pixel size'), 300);
      });
      row.appendChild(size);
      row.appendChild(make('div.ed-hint', { text: 'The size in pixels its letters were drawn at, usually 8 or 16. The text sizes below round to whole times it, so every square stays sharp.' }));
    }
    return row;
  }
  function editFont(id, patch, what) {
    ED.flushPending();
    ED.commit(`Look: ${what}`, (doc, O) => O.look.editFont(doc, id, patch));
  }

  function fontsSection(body, look, inherited) {
    const p = ED.state.project;
    const fonts = KIT.isObject(p.fonts) ? p.fonts : {};
    body.appendChild(make('p.ed-hint', { text: 'Bring in a font file — TTF, OTF, WOFF or WOFF2 — and it is kept inside your game, so it works offline and goes wherever the game goes. Then pick where it is used, below.' }));
    fontInput = make('input.ed-look-font-file');
    fontInput.type = 'file';
    fontInput.multiple = true;
    fontInput.accept = '.ttf,.otf,.woff,.woff2';
    fontInput.hidden = true;
    fontInput.setAttribute('aria-label', 'Font files');
    const input = fontInput;
    input.onchange = () => {
      const list = Array.from(input.files || []);
      const field = fontFor;
      fontFor = null;
      input.value = '';
      if (list.length) addFonts(list, field);
    };
    body.appendChild(input);
    const add = make('div.ed-row');
    add.appendChild(btn('＋ Add a font…', 'Bring a font file into the game', () => addFontFor(null), 'primary'));
    body.appendChild(add);
    for (const id of Object.keys(fonts).sort()) body.appendChild(fontRow(id, fonts[id], fonts));
    tokensForm(body, FONT_TOKENS, look, inherited);
  }

  function typingSection(body, inherited) {
    body.appendChild(make('p.ed-hint', { text: 'How the words arrive. A player picks Slow, Normal or Fast in Settings; these are how many letters a second each one types in your look — about 30 is an easy read, 60 is quick.' }));
    const speeds = L.PARTS.dialogue.find(f => f.key === 'speeds');
    form(body, ['dialogue', 'speeds'], speeds.fields, (now) => now.dialogue.speeds, inherited.dialogue.speeds);
    form(body, 'dialogue', L.PARTS.dialogue.filter(f => f.key === 'pageTurn'), (now) => now.dialogue, inherited.dialogue);
  }

  const lookNow = () => L.resolve(draftProject());

  function build(host) {
    const p = ED.state.project;
    const look = lookNow();
    const inherited = L.inherited(p, []);
    INS().destroyForms(panel.forms.map(x => x.form).filter(f => f.destroy));
    panel.forms = [];
    panel.now = look;
    clear(host);
    host.appendChild(make('p.ed-hint.ed-look-intro', { text: 'How your game looks and sounds. Pick a look to start from, then change anything below. The picture above shows it as you go: tap a part of it to jump to its settings, or ▶ Try to play it.' }));
    for (const sec of SECTIONS) {
      const head = make('button.ed-look-section');
      head.type = 'button';
      head.dataset.section = sec.id;
      const open = state.open === sec.id;
      head.setAttribute('aria-expanded', String(open));
      head.appendChild(make('span.ed-look-caret', { text: open ? '▾' : '▸' }));
      head.appendChild(make('span', { text: sec.label }));
      head.onclick = () => openSection(open ? null : sec.id);
      host.appendChild(head);
      if (!open) continue;
      const body = make('div.ed-look-body');
      body.dataset.section = sec.id;
      host.appendChild(body);
      if (sec.id === 'start') startSection(body, p, look);
      else if (sec.id === 'colours') coloursSection(body, look, inherited);
      else if (sec.id === 'fonts') fontsSection(body, look, inherited);
      else if (sec.id === 'typing') typingSection(body, inherited);
      else if (sec.id === 'sounds') soundsSection(body, look, inherited);
      else partSection(body, sec, look, inherited);
    }
    refreshForms(look);
    showField(host);
  }
  /** Every form re-read from one resolved look, the one an empty colour's square is read from too. */
  function refreshForms(now) {
    panel.now = now;
    for (const x of panel.forms) x.form.refresh(x.get(now));
  }

  /**
   * Scroll to the section that was asked for — to one field of it, flashed,
   * when one was named — on the next frame. The panel is drawn while Creator
   * Mode is still switching to it, and the switch ends by putting the sheet
   * back where this panel was last scrolled to. Scrolled at once, that undid
   * it: a problem tapped in Problems opened Colours and flashed the colour it
   * named out of sight, below the Box and Text the author then changed instead.
   */
  function showField(host) {
    if (!state.scroll) return;
    const open = state.open, field = state.field;
    state.scroll = false;
    state.field = null;
    requestAnimationFrame(() => {
      if (!host.isConnected || host.hidden) return;             // gone somewhere else meanwhile
      const head = host.querySelector(`.ed-look-section[data-section="${open}"]`);
      const row = field ? host.querySelector(`.ed-look-body .ed-f[data-key="${field}"]`) : null;
      const target = row || head;
      if (target && target.scrollIntoView) target.scrollIntoView({ block: row ? 'center' : 'start' });
      if (row) { row.classList.add('is-flash'); setTimeout(() => row.classList.remove('is-flash'), 900); }
    });
  }

  /**
   * openSection(id, field) — one section open at a time, so a phone never
   * scrolls past three forms to find a fourth. The preview follows: opening
   * Message box shows somebody talking. `field` scrolls to one field of it
   * (a tap on the portrait opens Message box at Portrait).
   */
  function openSection(id, field) {
    // A tap on a header does not always take the caret out of the text box it
    // was in (a button on an iPhone takes no focus), and a panel with the caret
    // in it is never redrawn under the typing — so the section asked for did
    // not open, and then opened by surprise when the typing was written. The
    // author asked to go somewhere else: the typing is finished first.
    const a = document.activeElement;
    if (panel && panel.host && a && panel.host.contains(a) && typeof a.blur === 'function') a.blur();
    ED.flushPending();
    ask(id, field);
    const sec = SECTIONS.find(s => s.id === id);
    if (sec && sec.tab && preview) preview.show(sec.tab);
    if (!panel) return;
    panel.sig = '';
    ED.refreshPanels();
  }
  /** ask(id, field) — the section (and field) the next drawing opens and scrolls to. */
  function ask(id, field) {
    state.open = id;
    state.field = field || null;
    state.scroll = true;
    if (id === 'colours' && field && !MAIN_COLOURS.includes(field)) moreColours.open = true;
  }

  KIT.registry('editorPanels').add({
    id: 'look', label: 'Look', icon: 'look', order: 10, section: 'look',
    mount(host) {
      panel = { host, forms: [], sig: '' };
      follow();
      // Problems selects before it opens the panel, and a panel not yet
      // mounted hears no onSelect: the first time, the selection is read here.
      const sel = ED.state.selection;
      if (sel && sel.kind === 'look') ask(...sectionFor(sel.path));
      host.classList.add('ed-look');
      this.refresh(ED);
    },
    refresh() {
      if (!panel || !panel.host) return;
      const p = ED.state.project;
      followDocument();
      const sig = JSON.stringify([state.open, (KIT.isObject(p.ui) && p.ui.base) || 'kit', Object.keys(KIT.isObject(p.looks) ? p.looks : {}), fontsKey(p)]);
      if (sig === panel.sig) { refreshForms(lookNow()); showField(panel.host); return; }
      if (INS().typingIn(panel.host)) return;
      panel.sig = sig;
      build(panel.host);
    },
    onSelect(sel) {
      // A problem in the look, picked in Problems, opens the section it is in.
      if (sel && sel.kind === 'look') openSection(...sectionFor(sel.path));
    },
    stage(el) {
      preview = ED.lookPreview.mount(el, {
        project: draftProject,
        onPick: (section, field) => openSection(section, field),
      });
      const sec = SECTIONS.find(s => s.id === state.open);
      preview.show((sec && sec.tab) || 'talk');
      return { destroy() { if (preview) { preview.destroy(); preview = null; } } };
    },
  });

  ED.lookPanel = { sectionOf, sectionFor };
  follow();

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
