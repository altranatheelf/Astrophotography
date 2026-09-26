// Creator Mode — the Look panel's live preview.
//
//   const pv = KIT.editor.lookPreview.mount(el, { project, onPick })
//   pv.show('talk' | 'choice' | 'menu' | 'title' | 'toast' | 'pad', again)
//   pv.mode('edit' | 'try')
//   pv.destroy()
//
// A little copy of the game screen, in the top half of the phone, that shows
// the look being made. It is not a picture of the look: the message box is the
// game's own dialogue scene, typing the line with its blips and its ▼, and a
// question is the game's own choice scene, driven off the scene stack into a
// host of the preview's instead of the game's. A look is about feel as much as
// colour, and feel is only judged by watching it type.
//
// It lives in a shadow root, so the game's stylesheet and the compiled look
// reach it exactly as they reach the game (they are cloned in), and nothing in
// it can collide with the game's own #dialogue or #choice, which have the same
// ids. `project` is a function returning the project to show — the Look panel
// hands in its draft, so a colour is seen while the finger is still on it.
//
// Two modes. **Edit** (the default): a tap on a part of the preview opens that
// part's settings (`onPick(section, field)`) and outlines it. **Try**: taps go
// to the scenes — turn the page, pick an answer, walk the list — the way a
// player's would.
//
// Nothing here runs unless a panel mounts it: the file only defines functions,
// so it loads headless with the rest of Creator Mode.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const ED = KIT.editor = KIT.editor || {};

  const TABS = [
    { id: 'talk', label: 'Talk' }, { id: 'choice', label: 'Choice' }, { id: 'menu', label: 'Menu' },
    { id: 'title', label: 'Title' }, { id: 'toast', label: 'Toast' }, { id: 'pad', label: 'Pad' },
  ];
  // The game's six overlay hosts, the same ids in the same order as index.html.
  const HOSTS = ['chapter', 'dialogue', 'choice', 'pause-menu', 'toast', 'screen-title'];
  // Which settings a tap on each host opens. A tap is taken to the part it
  // landed on (the nearest kit- element), and the host it is in says which.
  const SECTION_OF_HOST = { dialogue: 'box', choice: 'choice', 'pause-menu': 'menu', toast: 'toast', chapter: 'colours', 'screen-title': 'colours', controls: 'pad' };
  // Some parts are one field of their section, and go straight to it. `_` is
  // the host itself, and where a tap on any other part of it goes: the chapter
  // card's padding, or the title's blurb, is that screen's background — not
  // the top of Colours, with the colours of the thing tapped a long scroll away.
  const FIELD_OF_PART = {
    dialogue: { 'kit-facebox': 'face', 'kit-name': 'name', 'kit-next': 'marker' },
    'screen-title': { _: 'titleBg', 'kit-title': 'highlight', 'kit-subtitle': 'highlight2', 'kit-menu-item': 'titleButton' },
    chapter: { _: 'chapterBg', 'kit-chapter-title': 'chapterInk', 'kit-chapter-sub': 'highlight' },
  };

  const SAMPLE = 'Hello! This is how talking looks.\nA {color:#e04848}coloured{/color} word, a {fx:wave}wavy{/fx} one, and a {pause:300}pause.';
  // Short lines, one to a line of the box, for as many lines as a page can hold (six at most).
  const SCROLLING = ['Tap, and the next line', 'comes up from under the box', 'while the one above it', 'moves up out of the way.', 'Only the new line types.', 'That is the scroll.'];

  /**
   * sample(project, look) -> { who, face, text } — the line the preview types:
   * the first line in the game said by somebody, preferring one with a
   * portrait, so an author sees their own people talking in the look; when
   * there is none, a line that shows a colour, an effect and a pause, said by
   * the first of the cast (or Mira).
   *
   * A page that scrolls up a line shows it only when the next page comes, and
   * a game's first line is often one page: Try's tap on it closed the box, and
   * Scrolls up a line seemed to do nothing. So with a `look` that scrolls, the
   * line goes on for a page's worth of lines more, and a tap scrolls.
   */
  function sample(project, look) {
    const line = firstLine(project);
    const d = look && look.dialogue;
    if (d && d.pageTurn === 'scroll') line.text += '\n' + SCROLLING.slice(0, d.lines || 3).join('\n');
    return line;
  }
  function firstLine(project) {
    const p = project || {};
    let best = null;
    const visit = (v, depth) => {
      if ((best && best.face) || !v || typeof v !== 'object' || depth > 14) return;
      if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
      if (v.t === 'say' && typeof v.who === 'string' && v.who.trim() && typeof v.text === 'string' && v.text.trim()) {
        if (!best || (!best.face && v.face)) best = v;
        return;
      }
      for (const k of Object.keys(v)) visit(v[k], depth + 1);
    };
    visit(p.scripts, 0);
    for (const id of Object.keys(p.maps || {})) visit((p.maps[id] || {}).objects, 0);
    if (best) return { who: best.who, face: best.face || null, text: best.text };
    const castId = p.cast && Object.keys(p.cast)[0];
    return { who: castId ? ((p.cast[castId] && p.cast[castId].name) || castId) : 'Mira', face: null, text: SAMPLE };
  }

  /**
   * standIn() -> a face for the sample line when no line in the game has one,
   * so the portrait's settings (where it goes, its size, its frame, the colour
   * behind it) have something to show: the game's first portrait, else an id
   * nothing has, which the dialogue scene draws as its stand-in shape. No
   * picture is made for it.
   */
  function standIn() {
    const faces = KIT.registry.exists('faces') ? KIT.registry('faces').ids() : [];
    return faces[0] || 'sample';
  }

  // The preview's own stylesheet, last in its shadow root. The page's #stage
  // rules size it for a whole window (on a laptop, #screen is 70vw × 82vh);
  // here #stage fills the preview, and `#stage #screen` is two ids, so it wins
  // over that media rule without an !important.
  const SHEET = [
    ':host{display:block;position:relative;overflow:hidden;border-radius:10px;background:#0b0c12}',
    '#stage{position:absolute;inset:0;flex-direction:column;padding:8px;gap:8px;justify-content:stretch;align-items:stretch}',
    '#stage #screen{width:100%;height:auto;flex:1 1 auto;min-height:0;background-size:cover;background-position:center;image-rendering:pixelated}',
    // The pad is a picture here, not the thing a thumb presses: a little smaller, so it fits beside itself.
    '#stage #controls{flex:0 0 auto;width:100%;flex-direction:row;justify-content:center;zoom:.86}',
    '#stage #controls .kit-pad{width:100%;max-width:460px;grid-template-columns:auto 1fr auto;justify-items:normal}',
    '#stage #controls .kit-extra{flex-direction:column}',
    // The preview's screen is about half the height of a phone's game screen,
    // and a title with a pitch and five buttons is taller than that: shrunk to
    // fit (fitAll), and never pushed up out of sight.
    '#stage #screen-title{align-items:safe center}',
    // The pause menu is drawn whole and then shrunk to fit too, rather than
    // scrolled inside its panel: rows cut off at the bottom are the ones an
    // author was trying to see.
    '#stage #pause-menu .kit-panel{max-height:none;overflow:visible}',
    // The Toast tab draws a chapter card behind the toast, which a game never
    // does at once: with the toast in the middle, the card's words go to the top.
    '#stage #chapter[data-apart]{align-items:flex-start}',
    '#stage #chapter[data-apart] .kit-card{padding-top:6px;padding-bottom:4px}',
    // The toast and the chapter card let taps through to the game under them.
    // Here there is no game under them, and a tap is how their settings open.
    '#stage[data-kit-preview] #toast .kit-toast-pill,#stage[data-kit-preview] #chapter{pointer-events:auto}',
    '.ed-look-picked{outline:3px solid #4f8bf0 !important;outline-offset:2px}',
  ].join('\n');

  /**
   * mount(el, { project, onPick }) -> { show(tab, again), mode(m), tab(), destroy() }
   * `project()` is the project to show; `onPick(section, field)` hears an Edit
   * tap. The tab chips and the Try toggle are built here, above the preview.
   */
  function mount(el, opts) {
    const o = opts || {};
    const UI = KIT.ui;
    const project = typeof o.project === 'function' ? o.project : () => (ED.state && ED.state.project) || {};
    const state = { tab: 'talk', mode: 'edit', size: 'phone' };
    let alive = true, scene = null, restart = 0, raf = 0, last = 0, picked = null, sig = '', drawn = null;

    const wrap = UI.make('div.ed-look-stage');
    const bar = UI.make('div.ed-look-chips');
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'What the preview shows');
    const frame = UI.make('div.ed-look-frame');
    const host = UI.make('div.ed-look-preview');
    frame.appendChild(host);
    wrap.appendChild(bar);
    wrap.appendChild(frame);
    el.appendChild(wrap);

    const chips = TABS.map((t) => {
      const b = UI.make('button.ed-look-chip', { text: t.label });
      b.type = 'button';
      b.dataset.preview = t.id;
      b.setAttribute('role', 'tab');
      b.onclick = () => show(t.id, true);      // the tab already up plays again
      bar.appendChild(b);
      return b;
    });
    const tryBtn = UI.make('button.ed-look-chip.ed-look-mode');
    tryBtn.type = 'button';
    tryBtn.onclick = () => mode(state.mode === 'edit' ? 'try' : 'edit');
    bar.appendChild(tryBtn);
    // On a laptop the preview can be the width of a phone, or fill the stage.
    const sizeBtn = UI.make('button.ed-look-chip.ed-look-size');
    sizeBtn.type = 'button';
    // Drawn again at the new width: a line wrapped for a phone keeps its phone line breaks otherwise.
    sizeBtn.onclick = () => { state.size = state.size === 'phone' ? 'fill' : 'phone'; paintChips(); draw(); };
    bar.appendChild(sizeBtn);

    // ---- the shadow root: the game's stylesheets, then the preview's, then the stage
    const shadow = host.attachShadow({ mode: 'open' });
    const loads = [];
    let lookStyle = null;
    for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
      // A web font's stylesheet is the page's to fetch, once; the fonts it
      // declares reach the shadow root by name.
      if (node.tagName === 'LINK' && /^(https?:)?\/\//i.test(node.getAttribute('href') || '')) continue;
      // The game's own fonts too: declared in the page, they reach the shadow
      // root by name, and a copy here is every font file read twice.
      if (node.id === 'kit-look-fonts') continue;
      const copy = node.cloneNode(true);
      if (copy.tagName === 'LINK') loads.push(new Promise((res) => { copy.onload = res; copy.onerror = res; setTimeout(res, 1500); }));
      if (node.id === 'kit-look') lookStyle = copy;
      shadow.appendChild(copy);
    }
    if (!lookStyle) { lookStyle = document.createElement('style'); lookStyle.id = 'kit-look'; shadow.appendChild(lookStyle); }
    const sheet = document.createElement('style');
    sheet.textContent = SHEET;
    shadow.appendChild(sheet);

    const stage = UI.make('div');
    stage.id = 'stage';
    stage.setAttribute('data-kit-preview', '');
    const screen = UI.make('div');
    screen.id = 'screen';
    for (const id of HOSTS) { const h = UI.make('div.overlay'); h.id = id; h.hidden = true; screen.appendChild(h); }
    stage.appendChild(screen);
    // The pad is a copy of the real one: the same buttons, none of its listeners.
    const realPad = UI.el('controls');
    const pad = realPad ? realPad.cloneNode(true) : UI.make('div.kit-controls');
    pad.id = 'controls';
    pad.hidden = true;
    stage.appendChild(pad);
    shadow.appendChild(stage);
    // The map the author was looking at, behind the preview's boxes: a look is
    // judged against the game, not against black. A canvas that has drawn a
    // picture from another file cannot be read back; then it is the screen's colour.
    //
    // Copied two frames from now, not at once. Coming from Story or Game, the
    // canvas is still the strip their tall sheet squashed it to; the editor
    // resizes it on the next frame and draws the map again on the one after.
    // A copy taken at once was that strip, stretched into a blurred close-up.
    function backdrop() {
      try { if (ED.el && ED.el.canvas) screen.style.backgroundImage = `url("${ED.el.canvas.toDataURL()}")`; }
      catch (e) { (KIT.log || console).warn('[look preview] the map could not be copied behind the preview', e); }
    }
    let snapRaf = requestAnimationFrame(() => { snapRaf = requestAnimationFrame(() => { snapRaf = 0; if (alive) backdrop(); }); });
    const ready = Promise.all(loads);

    const hostEl = (id) => shadow.getElementById(id);

    /** #stage here follows the game's: the player's Reduce motion, and ?fast=1. */
    function syncFlags() {
      const real = UI.el('stage');
      for (const a of ['data-kit-motion', 'data-kit-fast']) {
        if (real && real.hasAttribute(a)) stage.setAttribute(a, real.getAttribute(a));
        else stage.removeAttribute(a);
      }
    }
    syncFlags();

    // ---- what each tab shows -------------------------------------------------------
    function stopScene() {
      if (restart) { clearTimeout(restart); restart = 0; }
      if (scene) { const s = scene; scene = null; try { if (s.exit) s.exit(); } catch (e) { (KIT.log || console).error('[look preview] exit', e); } }
    }
    function clearAll() {
      stopScene();
      for (const id of HOSTS) { const h = hostEl(id); h.hidden = true; h.classList.remove('is-in'); UI.clear(h); }
      pad.hidden = true;
      // A host outlined by a tap (the chapter card's backdrop) is emptied, not
      // thrown away, and came back outlined the next time its tab was up.
      if (picked) picked.classList.remove('ed-look-picked');
      picked = null;
    }
    /**
     * drive(id, params) — run a scene into the preview, off the stack. It ends
     * the way a scene ends (finish), and the preview starts it again a moment
     * later, so Try mode can go round as often as the author likes. Only a
     * scene that says `previewable` is driven; a module that replaced it gets
     * still markup instead.
     */
    function drive(id, params) {
      const def = KIT.registry('scenes').get(id);
      if (!def || !def.previewable) return false;
      const s = def.create(params);
      s.id = s.id || id;
      s.finish = () => {
        if (scene !== s) return;
        stopScene();
        restart = setTimeout(() => { restart = 0; if (alive && state.tab === (id === 'dialogue' ? 'talk' : 'choice')) draw(); }, 600);
      };
      scene = s;
      try { s.enter(Object.assign({ root: shadow, preview: true }, params)); }
      catch (e) { (KIT.log || console).error(`[look preview] ${id}`, e); scene = null; return false; }
      return true;
    }
    /**
     * talk(short) — somebody talking. `short` is the Pad tab's strip of a
     * screen, where a portrait above the box hangs out of the top: there the
     * line is said without one.
     */
    function talk(short, bg) {
      const p = project();
      // The Pad tab's strip of a screen has no room for a second page.
      const line = sample(p, short ? null : KIT.look.current());
      const ctx = KIT.interpreter && KIT.interpreter.fakeCtx ? KIT.interpreter.fakeCtx({ project: p }) : null;
      const who = ctx ? KIT.text.substitute(line.who, ctx) : line.who;
      const said = KIT.cast && KIT.cast.speaker ? KIT.cast.speaker(p, { who, text: line.text }) : { who, text: line.text };
      const above = /^above/.test(KIT.look.get('dialogue.face', 'left'));
      const face = short && above ? null : (line.face || standIn());
      if (drive('dialogue', { who, face, voice: said.voice || null, text: line.text, ctx, bg: bg || 'window' })) return;
      const ui = UI.parts.dialogueBox(hostEl('dialogue'));
      ui.host.hidden = false;
      ui.host.setAttribute('data-bg', bg || 'window');
      ui.name.textContent = who;
      ui.name.hidden = !who;
      UI.clear(ui.text);
      for (const text of KIT.text.strip(line.text).split('\n')) ui.text.appendChild(UI.make('div.kit-line', { text }));
      ui.next.textContent = KIT.look.get('dialogue.marker', '▼');
      ui.next.classList.add('is-ready');
    }
    function choice() {
      const p = project();
      const options = [{ text: KIT.strings.get(p, 'yes'), index: 0 }, { text: KIT.strings.get(p, 'no'), index: 1 }];
      if (drive('choice', { prompt: 'Ready?', options })) return;
      UI.select(UI.parts.choicePanel(hostEl('choice'), { prompt: 'Ready?', options }).list, 0);
    }
    /**
     * nameBox() — the box that asks for a name, standing still. It has four
     * colours of its own (the field, its border, OK and OK's letters), and no
     * tab: without it those four changed and nothing on the preview did, which
     * reads as a broken control. A colour of the name box asks for this.
     */
    function nameBox() {
      const p = project();
      const host = hostEl('choice');
      UI.clear(host);
      host.hidden = false;
      const panel = UI.make('div.kit-panel.kit-modal');
      panel.appendChild(UI.make('div.kit-prompt', { text: KIT.strings.get(p, 'name-prompt') }));
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'kit-input';
      input.value = 'Mira';
      input.readOnly = true;
      input.tabIndex = -1;
      panel.appendChild(input);
      const row = UI.make('div.kit-row');
      row.appendChild(UI.button('cancel', KIT.strings.get(p, 'cancel')));
      row.appendChild(UI.button('ok', KIT.strings.get(p, 'ok'), 'is-primary'));
      panel.appendChild(row);
      host.appendChild(panel);
    }
    function menu() {
      const P = KIT.pauseScreen;
      const rows = P ? P.rows(KIT.game || null, project()) : [];
      UI.select(UI.parts.listPanel(hostEl('pause-menu'), P ? P.title() : 'Paused', rows, { hint: P ? P.hint() : null }).list, 0);
      fitAll();
    }
    /**
     * fit(hostId, selector) — that part shrunk until the whole of it is inside
     * the preview's screen. With a few modules on, the pause menu has a dozen
     * rows, twice the height of the preview: in the game's own panel the rest
     * scroll, and here that hid every row after the fifth and the help line
     * under them — the very things the Menu tab is opened to judge. The title
     * is the same on a phone with its browser's bars showing, where its blurb
     * was cut in half and its help line gone.
     */
    function fit(hostId, selector) {
      const h = hostEl(hostId);
      const box = h && !h.hidden ? h.querySelector(selector) : null;
      if (!box) return;
      box.style.zoom = '';
      const cs = getComputedStyle(h);
      const room = h.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const need = box.offsetHeight;
      if (room > 0 && need > room) box.style.zoom = String(Math.floor((room / need) * 100) / 100);
    }
    function fitAll() {
      if (state.tab === 'menu') fit('pause-menu', '.kit-panel');
      else if (state.tab === 'title') fit('screen-title', '.kit-title-inner');
    }
    // The screen changes size with the phone turned, or Phone | Fill: fit again.
    const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (alive) fitAll(); }) : null;
    if (resized) resized.observe(screen);
    function title() {
      const p = project();
      const items = ['new-game', 'continue', 'settings'].map((action) => ({ action, label: KIT.strings.get(p, action), disabled: action === 'continue' }));
      UI.select(UI.parts.titleScreen(hostEl('screen-title'), { meta: p.meta || {}, items, hint: 'Tap to choose' }).list, 0);
      fitAll();
    }
    function toast() {
      const p = project();
      const meta = p.meta || {};
      const chapter = hostEl('chapter');
      const { card } = UI.parts.card(chapter, { title: meta.title || 'Chapter One', subtitle: meta.subtitle || '' });
      const { pill } = UI.parts.toast(hostEl('toast'), KIT.strings.get(p, 'saved'));
      // A toast in the middle sat on the card's words, and neither could be
      // read. The card goes to the top; on a screen too short for the two, its
      // words give way and its colour stays. Both hosts fill the screen, so
      // their offsets (which a fading-in transform does not move) compare.
      const middle = KIT.look.get('toast.at', 'top') === 'center';
      chapter.toggleAttribute('data-apart', middle);
      if (middle && card.offsetTop + card.offsetHeight > pill.offsetTop) card.hidden = true;
    }
    // `name` and `dim` have no chip: they are what a colour that only shows
    // there asks for (the name box's, and the darkness behind a dimmed line).
    const DRAW = { talk, choice, menu, title, toast, pad() { pad.hidden = false; talk(true); }, name: nameBox, dim() { talk(false, 'dim'); } };

    /**
     * What a tab draws depends on; when the look changes any of it, the tab is
     * drawn again. Talk is wrapped by measuring its letters, so a new font, a
     * new size or a pixel font's own size is a new talk, not the old line
     * breaks in new letters.
     */
    function signature() {
      const look = KIT.look.current(), t = look.tokens;
      const fonts = project().fonts;
      const words = [look.dialogue, look.voice, t.fontText, t.textSize, t.lineHeight, KIT.look.family(t.fontText, fonts), fonts && fonts[t.fontText] ? [fonts[t.fontText].pixel, fonts[t.fontText].px] : null];
      const parts = { talk: words, pad: words, dim: words, choice: [look.choice, look.dialogue.at], menu: [look.menu], title: [], toast: [look.toast], name: [] };
      return JSON.stringify([state.tab, parts[state.tab]]);
    }

    /**
     * show(tab, again) — put that tab up. One that is already up is left as
     * it is, so opening a section of the panel (which asks for its tab) does
     * not start the talk over or lose the part a tap outlined; `again` plays
     * it from the start.
     */
    function show(tab, again) {
      if (!alive || !DRAW[tab]) return;
      if (!again && tab === state.tab && drawn === tab) return;
      state.tab = tab;
      paintChips();
      draw();
    }
    /** draw() — the tab drawn afresh: when it is first shown, and when the look changes what it shows. */
    function draw() {
      const tab = state.tab;
      drawn = tab;
      ready.then(() => {
        if (!alive || state.tab !== tab) return;
        clearAll();
        sig = signature();
        try { DRAW[tab](); } catch (e) { (KIT.log || console).error(`[look preview] ${tab}`, e); }
      });
    }
    function mode(m) {
      state.mode = m === 'try' ? 'try' : 'edit';
      if (picked) { picked.classList.remove('ed-look-picked'); picked = null; }
      paintChips();
    }
    function paintChips() {
      chips.forEach((b, i) => b.setAttribute('aria-selected', String(TABS[i].id === state.tab)));
      const trying = state.mode === 'try';
      tryBtn.dataset.previewMode = state.mode;
      tryBtn.setAttribute('aria-pressed', String(trying));
      tryBtn.textContent = trying ? '✎ Edit' : '▶ Try';
      tryBtn.title = trying ? 'Back to editing: a tap on the preview opens its settings' : 'Play with the preview: turn the pages, pick an answer';
      sizeBtn.dataset.previewSize = state.size;
      sizeBtn.textContent = state.size === 'phone' ? 'Phone' : 'Fill';
      sizeBtn.title = state.size === 'phone' ? 'As wide as a phone. Tap to fill the space' : 'Filling the space. Tap for a phone\'s width';
      frame.classList.toggle('is-phone', state.size === 'phone');
    }

    // ---- taps -----------------------------------------------------------------------
    /** pick(target) — the part a tap landed on, outlined, and its settings opened. */
    function pick(target) {
      let part = null, at = target;
      while (at && at !== shadow && at.nodeType === 1) {
        if (!part && Array.from(at.classList || []).some(c => c.startsWith('kit-'))) part = at;
        const section = SECTION_OF_HOST[at.id];
        if (section) {
          if (picked) picked.classList.remove('ed-look-picked');
          picked = part || at;
          picked.classList.add('ed-look-picked');
          const fields = FIELD_OF_PART[at.id] || {};
          const cls = part ? Object.keys(fields).find(c => part.classList.contains(c)) : null;
          if (o.onPick) o.onPick(section, (cls && fields[cls]) || fields._ || null);
          return;
        }
        at = at.parentNode;
      }
    }
    /** In Try mode a menu or a title is walked by tapping its lines; talk and choice have their own taps. */
    function walk(target) {
      if (state.tab !== 'menu' && state.tab !== 'title') return;
      const row = target && target.closest ? target.closest('[data-index]') : null;
      if (!row || row.disabled) return;
      const list = row.parentNode;
      UI.select(list, Number(row.getAttribute('data-index')) || 0);
      KIT.look.sound('move');
    }
    host.addEventListener('pointerdown', () => { if (KIT.audio && KIT.audio.unlock) KIT.audio.unlock(); }, true);
    host.addEventListener('click', (e) => {
      const target = e.composedPath ? e.composedPath()[0] : e.target;
      if (state.mode === 'try') {
        if (state.tab === 'toast') { draw(); return; }
        walk(target);
        return;
      }
      // Edit: the tap is the author's, not the player's — the scenes never hear it.
      e.preventDefault();
      e.stopPropagation();
      pick(target);
    }, true);

    // ---- keeping up with the look -----------------------------------------------------
    const offApplied = KIT.look.events.on('applied', (ev) => {
      if (!alive) return;
      // Written only when it changed, like the page's own (the fonts are the
      // page's, in #kit-look-fonts).
      if (lookStyle.textContent !== ev.css) lookStyle.textContent = ev.css;
      syncFlags();
      // A font the look has just started using is waited for before the talk
      // is measured again (fontsReady gives up after a moment and it is drawn
      // in the stand-in).
      KIT.look.fontsReady().then(() => { if (alive && signature() !== sig) draw(); });
    });
    lookStyle.textContent = KIT.look.css(project(), { faces: false });

    function frameStep(t) {
      raf = 0;
      if (!alive) return;
      const dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
      last = t;
      if (scene && scene.update) { try { scene.update(dt, true); } catch (e) { (KIT.log || console).error('[look preview] update', e); stopScene(); } }
      raf = requestAnimationFrame(frameStep);
    }
    raf = requestAnimationFrame(frameStep);

    paintChips();
    return {
      show, mode,
      tab: () => state.tab,
      destroy() {
        alive = false;
        if (raf) cancelAnimationFrame(raf);
        if (snapRaf) cancelAnimationFrame(snapRaf);
        if (resized) resized.disconnect();
        offApplied();
        stopScene();
        wrap.remove();
      },
    };
  }

  ED.lookPreview = { mount, sample };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
