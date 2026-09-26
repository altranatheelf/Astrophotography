// The message scenes: dialogue (Show Text), choice, nameEntry, inputNumber,
// scrollText, chapter and toast. They are DOM overlays over the canvas (§12),
// so text is real text — selectable, scalable, and readable on a phone.
//
// Everything a message can contain comes from KIT.text: the wrap/paginate pass
// uses the real font metrics of the box, and the typewriter walks the spans so
// {pause}, {wait}, {fast}, {color:…}, {icon:…}, {shake}, {voice:…} and {fx:…}
// all work.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const UI = KIT.ui;
  const scenes = KIT.registry('scenes');

  /** Letters a second at each text speed a player can pick: the kit's, when the look has none (it always has). */
  const SPEEDS = { slow: 22, normal: 48, fast: 96 };
  /** How many lines a page holds: the look's, three in the kit's. */
  const lines = () => KIT.look.get('dialogue.lines', 3);
  /** Where the answers go when they go by the message box, and the question stays on screen. */
  const BOX_PLACES = new Set(['above-box', 'in-box', 'beside-box']);
  const byTheBox = () => BOX_PLACES.has(KIT.look.get('choice.place', 'corner'));

  /**
   * Message boxes that were on screen during this turn of the game: one a line
   * has just closed, or one a question by the box has just answered. A line
   * said straight after (a script goes from one command to the next without
   * waiting for a frame) takes the box over rather than opening it again, so a
   * conversation opens once — the look's pop or slide plays when the box comes
   * up after being away, not for the next line, nor for the answer to a
   * question whose box stood where it stands.
   */
  const upThisTurn = new WeakSet();
  function wasUp(host) {
    if (!host) return;
    upThisTurn.add(host);
    setTimeout(() => upThisTurn.delete(host), 0);
  }

  function settings() { return (KIT.storage && KIT.storage.settings) ? KIT.storage.settings() : {}; }
  function instant() { return !!(KIT.fx && KIT.fx.instant) || settings().textSpeed === 'instant'; }
  /**
   * The player picks Slow, Normal or Fast; the look says how fast each one is.
   * A handheld types at a handheld's pace and a look for quick readers can
   * make all three quicker, while the choice between them stays the player's.
   */
  function charsPerSecond() {
    if (instant()) return 0;
    const speeds = KIT.look.get('dialogue.speeds', SPEEDS);
    const s = settings().textSpeed;
    return speeds[s] == null ? speeds.normal : speeds[s];
  }

  /**
   * heroFraction() -> how far down the game screen the hero stands, from 0 at
   * the top to 1 at the bottom; null when there is no hero on a map to look
   * at (the title, a preview). Read off the renderer, which knows where the
   * camera is.
   */
  function heroFraction() {
    const G = KIT.game;
    const world = G && G.world, r = G && G.renderer;
    const hero = world && world.map && typeof world.hero === 'function' ? world.hero() : null;
    const h = r && r.canvas ? r.canvas.clientHeight : 0;
    if (!hero || !h || typeof r.tileToScreen !== 'function') return null;
    return r.tileToScreen(0, (hero.py != null ? hero.py : hero.y) + 0.5, world).y / h;
  }

  /**
   * voiceFor(id) -> the voice to speak in, falling back to `default`.
   * WHICH voice is the say command's business (it has the project and the cast);
   * this only has to look it up.
   */
  function voiceFor(id) {
    const reg = KIT.registry.exists('voices') ? KIT.registry('voices') : null;
    if (!reg) return null;
    return (id && reg.get(id)) || reg.get('default') || null;
  }
  const SILENT = /[\s.,;:!?'"\-—–()\[\]]/;

  /**
   * KIT.dialogueLayout — the message box's own line breaking, pure, for when
   * the look starts each line with a mark ("* ").
   *
   *   lines(spans, layout) -> { lines, starts, joins }
   *
   * The spans are split at every line break the author wrote, each piece is
   * wrapped on its own, and `starts` is the set of line numbers where a piece
   * begins: those lines get the mark, and the lines a long piece wraps onto
   * line up after it. A piece with nothing to read in it (a blank line
   * between two) gets no mark. The lines are the same ones KIT.text.wrap would
   * make; only the marking is new, so a look without a mark or a question by
   * the box never comes here.
   *
   * `joins` maps each line that only wrapped — the rest of a piece, not a line
   * the author started — to what the wrap took out before it: ' ' where it
   * broke at a space, '' inside a word too long for the box. With it, a copy
   * of the page can put the words back together and let a narrower box wrap
   * them again (a question's box beside its answers).
   */
  const DL = KIT.dialogueLayout = KIT.dialogueLayout || {};
  /** The letters of some spans, an icon as one character: what a wrap walks along. */
  const lettersOf = (spans) => spans.map((sp) => (sp.type === 'text' ? sp.text : sp.type === 'icon' ? '\uFFFC' : '')).join('');
  DL.lines = function (spans, layout) {
    const pieces = [[]];
    for (const sp of spans || []) {
      if (sp.type === 'break') pieces.push([]);
      else pieces[pieces.length - 1].push(sp);
    }
    // A break at the very end closes the last line; it does not open another.
    if (pieces.length > 1 && !pieces[pieces.length - 1].length) pieces.pop();
    const out = [], starts = new Set(), joins = new Map();
    for (const piece of pieces) {
      const readable = piece.some((sp) => sp.type === 'icon' || (sp.type === 'text' && sp.text.trim()));
      if (readable) starts.add(out.length);
      // KIT.text.wrap drops the spaces at either end of a line and keeps the
      // letters in between as they were, so walking the piece's letters line
      // by line finds whether a space was dropped where each line begins.
      const letters = lettersOf(piece);
      let at = 0;
      KIT.text.wrap(piece, layout).forEach((line, i) => {
        const was = at;
        while (at < letters.length && /\s/.test(letters[at])) at++;
        if (i) joins.set(out.length, at > was ? ' ' : '');
        at += lettersOf(line).length;
        out.push(line);
      });
    }
    return { lines: out, starts, joins };
  };

  /**
   * pages(lines, n, turn) -> [{ lines, keep, from }] — what each press of A
   * shows. `from` is the number of the page's first line; `keep` how many of
   * its lines were on the page before.
   *
   *   'clear'   n lines at a time, each page starting empty: exactly what
   *             KIT.text.paginate has always made.
   *   'scroll'  the handheld way: after the first page, each press moves the
   *             lines up one and brings in one more, so ['a','b','c','d'] two
   *             at a time is ab, bc, cd — the kept line is already read, and
   *             only the new one types.
   */
  DL.pages = function (lines, n, turn) {
    const per = Math.max(1, n || 3);
    const all = lines || [];
    if (turn !== 'scroll') return KIT.text.paginate(all, per).map((page, i) => ({ lines: page, keep: 0, from: i * per }));
    const out = [];
    for (let k = 0; k <= Math.max(0, all.length - per); k++) out.push({ lines: all.slice(k, k + per), keep: k ? per - 1 : 0, from: k });
    return out;
  };

  /**
   * place(position, heroFraction, mode) -> where the box goes. With the look's
   * box out of the hero's way ('avoid-hero'), a box meant for the bottom goes
   * to the top while the hero stands in the bottom half of the screen; a line
   * the author told to go at the top or in the middle stays where it was told.
   */
  DL.place = function (position, heroFraction, mode) {
    const at = position || 'bottom';
    return mode === 'avoid-hero' && at === 'bottom' && typeof heroFraction === 'number' && heroFraction > 0.5 ? 'top' : at;
  };

  /** effectFor(id) -> the textEffects definition, or null. */
  function effectFor(id) {
    const reg = KIT.registry.exists('textEffects') ? KIT.registry('textEffects') : null;
    return (reg && id && reg.get(id)) || null;
  }

  /**
   * dress(el, voice) — put a voice's LOOK on an element.
   *
   * Every field is nullable and null means "leave the box alone", so a voice
   * that only changes the blip changes only the blip. This is the half of
   * Undertale's typer preset that is not sound: the font and colour are what
   * make Sans look like Sans before he has said anything.
   */
  function dress(el, voice) {
    if (!el || !voice) return;
    // A voice's font is a family written out as CSS writes one, one of the
    // look's words (pixel, mono…), or one of the game's own fonts by its id:
    // KIT.look.family says which, and passes a written-out family through.
    if (voice.font) el.style.fontFamily = KIT.look.family(voice.font, ((KIT.game && KIT.game.project) || {}).fonts);
    if (voice.color) el.style.color = voice.color;
    if (voice.size === 'big') el.classList.add('is-big');
    else if (voice.size === 'small') el.classList.add('is-small');
  }

  /**
   * effected(text, fxId, amount) -> an element holding `text`, animated.
   *
   * A per-letter effect needs one element per letter, each starting a little
   * later than the last — that stagger is the whole difference between a wave
   * and a twitch. The letters all exist from the first frame and are revealed
   * by `visibility`, so the wave does not shift as the line types itself.
   */
  function effected(text, fxId, amount) {
    const def = effectFor(fxId);
    const host = UI.make('span');
    if (!def || !def.css) { host.textContent = ''; return { el: host, chars: null }; }
    host.style.setProperty('--kit-fx', amount == null ? 1 : amount);
    if (def.perChar === false) { host.classList.add(def.css); return { el: host, chars: null }; }
    const chars = [];
    const stagger = def.stagger == null ? 60 : def.stagger;
    Array.from(text).forEach((ch, i) => {
      const c = UI.make('span.kit-char');
      c.classList.add(def.css);
      c.textContent = ch;
      c.style.animationDelay = (i * stagger) + 'ms';
      c.style.visibility = 'hidden';
      host.appendChild(c);
      chars.push(c);
    });
    return { el: host, chars };
  }

  /** A measuring context that uses the element's real font, so wrapping matches what you see. */
  let measureCtx = null;
  function measurerFor(el) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    const cs = getComputedStyle(el);
    measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const letter = parseFloat(cs.letterSpacing) || 0;
    return (s) => measureCtx.measureText(s).width + letter * s.length;
  }

  /** The little side-to-side shake (`.is-shaking` in css/kit.css), started over if it is already running. */
  function shake(el) {
    if (!el) return;
    el.classList.remove('is-shaking');
    void el.offsetWidth;
    el.classList.add('is-shaking');
  }

  function faceArt(id) {
    if (!id) return null;
    for (const regName of ['faces', 'sprites', 'icons']) {
      if (!KIT.registry.exists(regName)) continue;
      const def = KIT.registry(regName).get(id);
      if (!def) continue;
      const art = KIT.pixels.artOf(def);
      if (art) return art;
      if (def.frames && def.frames.down) return { w: def.w || 16, h: def.h || 24, palette: def.palette, rows: def.frames.down[0] };
    }
    return KIT.pixels.silhouette(24, 24, '#9aa7c7');      // missing face: a friendly blob, never an error
  }

  // ---- dialogue ------------------------------------------------------------------
  // `previewable`: this scene can be driven off the stack into a host of
  // somebody else's — the Look panel's live preview — with `root` (where its
  // host is) and `preview` (leave the game's music alone). A module that
  // replaces the scene says so for its own, or the preview draws still markup.
  scenes.add({
    id: 'dialogue', name: 'Message', previewable: true,
    create() {
      let ui = null, units = [], unitIndex = 0, charIndex = 0, acc = 0, pages = [], pageIndex = 0;
      let waiting = false, complete = false, speed = 1, pauseLeft = 0;
      let voice = null, sinceBlip = 0, spoken = 0, starts = null, joins = null;

      function layoutFor(textEl) {
        return { width: Math.max(80, textEl.clientWidth - 2), measure: measurerFor(textEl), lines: lines() };
      }

      /**
       * paged(body, ctx, layout, prefix, turn) -> pages (DL.pages). With no
       * mark to start the lines with, pages that clear and no question by the
       * box, exactly the render or layout call it always was; otherwise the
       * same lines, broken by KIT.dialogueLayout — which also says which of
       * them start a piece the author wrote, and which only wrapped — and
       * paged the look's way. A question by the box may keep the page on
       * screen as its question, and beside the box its box is narrower: the
       * lines that only wrapped say so (data-join), for the copy to join them
       * and let them wrap again at that width (KIT.ui.parts.choicePanel).
       */
      function paged(body, ctx, lay, prefix, turn) {
        starts = null; joins = null;
        const asked = byTheBox();
        if (!prefix && turn !== 'scroll' && !asked) {
          return (ctx ? KIT.text.render(body, ctx, lay) : KIT.text.layout(body, lay))[0].pages.map((page, i) => ({ lines: page, keep: 0, from: i * lay.lines }));
        }
        const r = DL.lines(KIT.text.tokenize(ctx ? KIT.text.substitute(body, ctx) : body), lay);
        if (prefix) starts = r.starts;
        if (asked) joins = r.joins;
        return DL.pages(r.lines, lay.lines, turn);
      }

      function buildPage(at) {
        const page = pages[at] || { lines: [], keep: 0, from: 0 };
        const t = ui.text;
        t.innerHTML = '';
        units = []; unitIndex = 0; charIndex = 0; acc = 0; complete = false; waiting = false; speed = 1; pauseLeft = 0;
        let kept = 0;
        page.lines.forEach((line, n) => {
          const lineEl = UI.make('div.kit-line');
          if (starts && starts.has(page.from + n)) lineEl.classList.add('is-start');
          if (joins && joins.has(page.from + n)) lineEl.setAttribute('data-join', joins.get(page.from + n));
          for (const span of line) {
            if (span.type === 'text') {
              // The span's own voice wins over the line's, so `{voice:sans}`
              // inside a sentence changes font, colour, pace and blip at once —
              // which is the whole trick behind a character having a voice.
              const spanVoice = span.voice ? voiceFor(span.voice) : voice;
              const fx = span.fx || (spanVoice && spanVoice.fx) || null;
              const amount = span.fxAmount != null ? span.fxAmount : (spanVoice && spanVoice.fxAmount);
              let el, chars = null;
              if (fx) { const made = effected(span.text, fx, amount); el = made.el; chars = made.chars; }
              else el = UI.make('span');
              dress(el, spanVoice);
              if (span.color) el.style.color = span.color;          // an explicit {color:} beats the voice
              if (span.size === 'big') el.classList.add('is-big');
              lineEl.appendChild(el);
              units.push({ type: 'text', el, chars, text: span.text, voice: spanVoice });
            } else if (span.type === 'icon') {
              const art = faceArt(span.id);
              const el = UI.make('span.kit-icon');
              el.appendChild(UI.artCanvas(art, 2));
              el.style.visibility = 'hidden';
              lineEl.appendChild(el);
              units.push({ type: 'icon', el });
            } else if (span.type === 'pause') units.push({ type: 'pause', ms: span.ms == null ? 350 : span.ms });
            else if (span.type === 'wait') units.push({ type: 'wait' });
            else if (span.type === 'speed') units.push({ type: 'speed', mode: span.mode });
            else if (span.type === 'shake') units.push({ type: 'shake' });
          }
          t.appendChild(lineEl);
          if (n === page.keep - 1) kept = units.length;
        });
        // A page that scrolled up: the lines it kept were read on the page
        // before, so they are there at once — no blips, their pauses and
        // shakes long over — and the text slides up a line (a look's
        // animation, off when things may not move). Only the new line types.
        t.classList.remove('is-scrolled');
        if (page.keep) {
          for (let i = 0; i < kept; i++) {
            const u = units[i];
            if (u.type === 'text') reveal(u, u.text.length);
            else if (u.type === 'icon') u.el.style.visibility = 'visible';
            else if (u.type === 'speed') speed = u.mode === 'instant' ? 999 : 2.5;
          }
          unitIndex = kept;
          void t.offsetWidth;
          t.classList.add('is-scrolled');
        }
        if (instant()) revealAll();
        updatePrompt();
      }

      /**
       * reveal(unit, n) — show the first n letters. A plain run grows its
       * textContent; a run with a per-letter effect already holds every letter
       * and just stops hiding them, so the animation does not jump as the line
       * types itself.
       */
      function reveal(u, n) {
        if (u.chars) {
          // Only the letters whose state changed. A run with an effect holds a
          // span per letter, every one of them built hidden (see effected()),
          // and this runs every frame while the line types — so touching all
          // two hundred of them to show two more was two hundred style writes a
          // frame for nothing. `shown` is how many are visible right now.
          const was = u.shown || 0;
          const end = Math.min(n, u.chars.length);
          if (end > was) for (let i = was; i < end; i++) u.chars[i].style.visibility = 'visible';
          else if (end < was) for (let i = end; i < was; i++) u.chars[i].style.visibility = 'hidden';
          u.shown = end;
        } else u.el.textContent = u.text.slice(0, n);
      }

      /**
       * The sound of somebody talking: one blip every few letters, at a pitch
       * that wanders a little so it is a person and not a printer. Punctuation
       * and spaces stay silent, which is what stops it sounding like Morse.
       */
      function speak(chars, v) {
        const voice = v;
        if (!voice || !voice.sound || !chars) return;
        const every = Math.max(1, voice.everyChars || 2);
        for (const ch of chars) {
          if (voice.skipPunctuation !== false && SILENT.test(ch)) continue;
          if (sinceBlip++ % every) continue;
          const jitter = voice.jitter == null ? 0.06 : voice.jitter;
          // Deterministic wander: the same line sounds the same twice, which
          // matters for a game somebody records or speedruns.
          const wobble = jitter ? 1 + (((KIT.hash(spoken++) % 200) / 100) - 1) * jitter : 1;
          KIT.audio.play(voice.sound, {
            pitch: (voice.pitch || 1) * wobble,
            rate: voice.rate || 1,
            volume: voice.volume == null ? 0.5 : voice.volume,
          });
        }
      }

      function revealAll() {
        for (let i = unitIndex; i < units.length; i++) {
          const u = units[i];
          if (u.type === 'text') reveal(u, u.text.length);
          if (u.type === 'icon') u.el.style.visibility = 'visible';
          if (u.type === 'shake' && ui.box) shakeBox();
        }
        unitIndex = units.length; charIndex = 0; complete = true; waiting = false; pauseLeft = 0;
        updatePrompt();
      }
      function shakeBox() { shake(ui.box); }
      function updatePrompt() {
        if (!ui.next) return;
        ui.next.classList.toggle('is-ready', complete || waiting);
        ui.next.textContent = KIT.look.get('dialogue.marker', '▼');
      }

      return {
        id: 'dialogue', transparent: true,
        enter(params) {
          const p = params || {};
          ui = UI.parts.dialogueBox(UI.el('dialogue', p.root));
          if (!ui) { this.finish(); return; }
          // This line takes the box over from any line before it that was
          // waiting for a question (see exit), and a shake that line had is
          // over: kept, it played again the next time the box was shown.
          // The box opens (`.is-opening`, the look's pop or slide) only when it
          // comes up after being away (upThisTurn); the class is taken off for
          // every other line, or a shake giving way let the opening play again
          // in the middle of a conversation. The preview draws each tab afresh,
          // and there it always opens. A look with no opening (the kit's) never
          // has the class, so its box is the one it always was.
          const opens = KIT.look.get('dialogue.open', 'none') !== 'none' && ui.host.hidden && (!!p.preview || !upThisTurn.has(ui.host));
          ui.host.removeAttribute('data-linger');
          if (ui.box) ui.box.classList.remove('is-shaking', 'is-opening');
          ui.host.hidden = false;
          if (opens && ui.box) { void ui.box.offsetWidth; ui.box.classList.add('is-opening'); }
          ui.host.setAttribute('data-position', DL.place(p.position, p.preview ? null : heroFraction(), KIT.look.get('dialogue.at', 'bottom')));
          ui.host.setAttribute('data-bg', p.bg || 'window');
          ui.name.textContent = p.who || '';
          ui.name.hidden = !p.who;
          ui.name.removeAttribute('style');
          ui.name.classList.remove('is-big', 'is-small');
          ui.face.innerHTML = '';
          ui.face.hidden = !p.face;
          if (p.face) ui.face.appendChild(UI.artCanvas(faceArt(p.face), KIT.look.get('dialogue.faceScale', 3)));
          // Who is talking decides what they sound like: their own voice if they
          // are in the cast, else whatever this line asked for, else the game's.
          voice = voiceFor(p.voice);
          sinceBlip = 0;
          if (p.voice) dress(ui.name, voice);      // so the name looks like the person saying it
          // The say command already substituted (and therefore translated) this
          // text — doing it again can swap a translated line for a different
          // one entirely. A `ctx` on the payload is the explicit opt-in for raw
          // text that still needs templating.
          const body = p.text == null ? '' : p.text;
          // A mark at the start of each line sits in the text's left margin,
          // as wide as the mark itself, so the width measured for wrapping is
          // what is left for the words.
          const prefix = KIT.look.get('dialogue.prefix', '');
          if (prefix) ui.text.style.setProperty('--kit-prefix-w', Math.ceil(measurerFor(ui.text)(prefix)) + 'px');
          else ui.text.style.removeProperty('--kit-prefix-w');
          pages = paged(body, p.ctx, layoutFor(ui.text), prefix, KIT.look.get('dialogue.pageTurn', 'clear'));
          pageIndex = 0;
          buildPage(0);
          this._tap = () => { this.input({ key: 'a', player: 1 }); };
          ui.host.addEventListener('click', this._tap);
          // Get the music out from under the voice. Counted, so a run of lines
          // ducks once and comes back up once at the end rather than pumping
          // between every box.
          if (!p.preview && KIT.audio && KIT.audio.duck) { this._ducked = true; KIT.audio.duck(null, 160); }
        },
        exit() {
          if (this._ducked && KIT.audio && KIT.audio.unduck) { this._ducked = false; KIT.audio.unduck(360); }
          if (!ui) return;
          if (this._tap) ui.host.removeEventListener('click', this._tap);
          // With the answers by the box, a question asked straight after this
          // line shows it as its question: the box stays up for the rest of
          // this turn, and the choice scene takes it (it runs before the timer
          // does — a script goes from one command to the next without waiting
          // for one). Anything else finds it gone; a next line takes it back.
          if (!byTheBox()) { ui.host.hidden = true; wasUp(ui.host); return; }
          const host = ui.host;
          host.setAttribute('data-linger', '');
          setTimeout(() => { if (host.hasAttribute('data-linger')) { host.removeAttribute('data-linger'); host.hidden = true; } }, 0);
        },
        update(dt) {
          if (complete || waiting || !units.length) return;
          if (pauseLeft > 0) { pauseLeft -= dt * 1000; return; }
          // The run being typed sets the pace, if its voice asks to. A voice
          // with no speed of its own follows the player's setting, which is the
          // kind default — somebody who needs text slow should get it slow.
          const here = units[unitIndex];
          const own = here && here.voice && here.voice.speed;
          const base = own ? Number(here.voice.speed) : charsPerSecond();
          const cps = (instant() ? 0 : base) * speed;
          if (cps <= 0) { revealAll(); return; }
          acc += dt * cps;
          let budget = Math.floor(acc);
          if (budget <= 0) return;
          acc -= budget;
          while (budget > 0 && unitIndex < units.length) {
            const u = units[unitIndex];
            if (u.type === 'text') {
              const left = u.text.length - charIndex;
              const take = Math.min(left, budget);
              const from = charIndex;
              charIndex += take; budget -= take;
              reveal(u, charIndex);
              speak(u.text.slice(from, charIndex), u.voice);
              if (charIndex >= u.text.length) { unitIndex++; charIndex = 0; }
            } else if (u.type === 'icon') { u.el.style.visibility = 'visible'; unitIndex++; }
            else if (u.type === 'pause') { pauseLeft = u.ms; unitIndex++; break; }
            else if (u.type === 'wait') { waiting = true; unitIndex++; break; }
            else if (u.type === 'speed') { speed = u.mode === 'instant' ? 999 : 2.5; unitIndex++; }
            else if (u.type === 'shake') { shakeBox(); unitIndex++; }
          }
          if (unitIndex >= units.length) { complete = true; }
          updatePrompt();
        },
        input(ev) {
          if (ev.key === 'a' || ev.key === 'menu') {
            if (waiting) { waiting = false; updatePrompt(); return true; }
            if (!complete) { revealAll(); return true; }
            // The press that turns the page, or closes the box, has a sound of
            // its own in a look that wants one (silent in the kit's).
            KIT.look.sound('page');
            if (pageIndex < pages.length - 1) { pageIndex++; buildPage(pageIndex); return true; }
            this.finish(true);
            return true;
          }
          if (ev.key === 'b') { if (!complete || waiting) { waiting = false; revealAll(); } return true; }
          return true;
        },
      };
    },
  });

  // ---- choice ---------------------------------------------------------------------

  /** Where `el` is on screen, or null when it is not drawn. */
  const shownRect = (el) => (el && el.getClientRects().length ? el.getBoundingClientRect() : null);
  /** The room left between a portrait, or a window, and what it keeps clear of: a portrait hangs 6px off its box. */
  const FACE_GAP = 6;

  /**
   * besideOrOver(host, box, panel): the answers' window beside the question's
   * box, or over the box's right end. Beside it the box is narrower, and its
   * words flow again at that width — a long question next to a wide window (a
   * grid of two) came out one or two words to a line, the box three times the
   * height of the line it carries on, jumping up the screen as the question
   * came. So the box is measured both ways: when beside the window it is more
   * than a line taller than at its own width, or the window does not fit
   * beside it at all, the window goes over the box's right end instead
   * (data-over, css/kit.css) and the box keeps its width.
   */
  function besideOrOver(host, box, panel) {
    if (!box || !panel) return;
    host.setAttribute('data-over', '');
    const whole = box.getBoundingClientRect().height;
    host.removeAttribute('data-over');
    const b = box.getBoundingClientRect(), w = panel.getBoundingClientRect(), h = host.getBoundingClientRect();
    const text = box.querySelector('.kit-text');
    const line = (text && parseFloat(getComputedStyle(text).lineHeight)) || 24;
    const beside = w.left >= b.right - 1 && w.right <= h.right + 1 && w.top < b.bottom && w.bottom > b.top;
    if (!beside || b.height > whole + line * 1.5) host.setAttribute('data-over', '');
  }

  /**
   * clearOfTab(box, panel): a name on a tab over the box's corner stays in
   * sight. An answers' window over the box stands by its right end, and a
   * wide one (four answers in a row, a grid of three) reached the tab at the
   * left and covered the name of whoever was asking; it stands just clear
   * of the tab instead.
   */
  function clearOfTab(box, panel) {
    const name = box && panel ? box.querySelector('.kit-name') : null;
    const tab = shownRect(name);
    if (!tab || getComputedStyle(name).position !== 'absolute') return;
    const w = panel.getBoundingClientRect();
    if (w.left >= tab.right || w.right <= tab.left || w.top >= tab.bottom || w.bottom <= tab.top || w.bottom > tab.bottom) return;
    panel.style.marginBottom = `${(parseFloat(getComputedStyle(panel).marginBottom) || 0) + w.bottom - tab.top + FACE_GAP}px`;
  }

  /**
   * keepFace(was, box, panel, host): a portrait hung over (or under) the
   * message box stays where the player saw it while the question is asked.
   * It hangs off the box's corner, and beside its answers the question's box
   * is narrower: a portrait over the right corner jumped a hundred pixels to
   * the left as Yes and No came up, on every question. So it goes back where
   * it was — and where the answers' window stands there, or the box grown to
   * hold its answers, it moves up (down, hanging under a box at the top) just
   * clear of them rather than be painted over. `was` is where it stood in the
   * line's box; `panel`, the answers' window, if they have one.
   */
  function keepFace(was, box, panel, host) {
    const face = box && box.querySelector('.kit-facebox');
    const now = shownRect(face);
    if (!was || !now || getComputedStyle(face).position !== 'absolute') return;
    const inBox = box.getBoundingClientRect();
    const under = now.top >= inBox.bottom - 1;
    const blocks = [shownRect(panel), inBox].filter(Boolean);
    let top = was.top;
    // Twice round: clear of the window can be onto a box grown taller than it.
    for (let round = 0; round < 2; round++) {
      for (const r of blocks) {
        if (was.left < r.right && was.right > r.left && top < r.bottom && top + was.height > r.top) top = under ? r.bottom + FACE_GAP : r.top - FACE_GAP - was.height;
      }
    }
    // Off the screen it could not be seen at all: then it stays where it was, the window over part of it.
    const h = host.getBoundingClientRect();
    if (top < h.top || top + was.height > h.bottom) top = was.top;
    const dx = was.left - now.left, dy = top - now.top;
    if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) face.style.transform = `translate(${dx}px,${dy}px)`;
  }

  scenes.add({
    id: 'choice', name: 'Choices', previewable: true,
    create() {
      let host = null, index = 0, options = [], talk = null;
      return {
        id: 'choice', transparent: true,
        enter(params) {
          const p = params || {};
          options = p.options || [];
          index = 0;
          host = UI.el('choice', p.root);
          if (!host) { this.finish(-1); return; }
          // Answers by the message box keep the question on screen, in a box
          // like the message box: the question's own words, or — when it has
          // none — the line said just before it, still up (see dialogue's exit).
          const place = byTheBox() ? KIT.look.get('choice.place', 'corner') : null;
          talk = place ? UI.el('dialogue', p.root) : null;
          const said = talk && talk.hasAttribute('data-linger') && !talk.hidden ? talk : null;
          const copied = said && !p.prompt ? said : null;
          const faceWas = copied ? shownRect(copied.querySelector('.kit-facebox')) : null;
          const built = UI.parts.choicePanel(host, {
            prompt: p.prompt, options, place,
            promptClone: copied ? copied.querySelector('.kit-box') : null,
          });
          const list = built.list;
          if (place) {
            host.setAttribute('data-place', place);
            // Where that line was, or where a line would go now.
            host.setAttribute('data-position', (said && said.getAttribute('data-position')) || DL.place('bottom', p.preview ? null : heroFraction(), KIT.look.get('dialogue.at', 'bottom')));
          }
          // The line's own background comes with its box: no window, or the
          // game dimmed behind it, stays so while the question is asked.
          const bg = copied && copied.getAttribute('data-bg');
          if (bg && bg !== 'window') host.setAttribute('data-bg', bg);
          if (place === 'beside-box') besideOrOver(host, built.promptBox, list.parentElement);
          if (place && place !== 'in-box') clearOfTab(built.promptBox, list.parentElement);
          if (faceWas) keepFace(faceWas, built.promptBox, place === 'in-box' ? null : list.parentElement, host);
          if (said) { said.removeAttribute('data-linger'); said.hidden = true; }
          UI.select(list, index);
          this._list = list;
          this._off = UI.onAction(host, (action, el) => {
            if (action !== 'choose') return;
            index = Number(el.getAttribute('data-index')) || 0;
            pick.call(this);
          });
          const pick = function () { KIT.look.sound('confirm'); this.finish(index); };
          this._pick = pick;
          this._cancel = p.cancel || 'none';
        },
        exit() {
          if (host) {
            host.hidden = true;
            UI.clear(host);
            for (const a of ['data-place', 'data-position', 'data-bg', 'data-over']) host.removeAttribute(a);
          }
          // The question's box stood where the message box stands: an answer
          // said straight after carries the conversation on, it does not open
          // the box again.
          if (talk) { wasUp(talk); talk = null; }
          if (this._off) this._off();
        },
        input(ev) {
          const arrow = ev.key === 'up' || ev.key === 'down' || ev.key === 'left' || ev.key === 'right';
          // Answers side by side — a row, a grid, Yes and No inside the box —
          // move the way the arrow points: in reading order, ▼ in a grid of two
          // went to the next answer, up and across, rather than the one
          // underneath it. Answers in one column step up and down the list as
          // they always have, with ◀ and ▶ too. Which it is, is read off where
          // the answers are, not off the look alone: a row too narrow for its
          // answers wraps them into a column.
          const rects = arrow ? Array.from(this._list.children, (b) => b.getBoundingClientRect()) : [];
          if (arrow && rects.some(r => Math.abs(r.left - rects[0].left) >= 1)) {
            let next = UI.nav(rects, index, ev.key, true);
            // ◀ and ▶ always move. In a row wrapped one answer to a line (long
            // answers in a narrow box) there is nothing beside the chosen one,
            // and they step along the answers as they do in a column.
            if (next === index && (ev.key === 'left' || ev.key === 'right')) next = (index + (ev.key === 'left' ? -1 : 1) + options.length) % options.length;
            if (next !== index) { index = next; UI.select(this._list, index); KIT.look.sound('move'); }
            return true;
          }
          if (ev.key === 'up' || ev.key === 'left') { index = (index - 1 + options.length) % options.length; UI.select(this._list, index); KIT.look.sound('move'); return true; }
          if (ev.key === 'down' || ev.key === 'right') { index = (index + 1) % options.length; UI.select(this._list, index); KIT.look.sound('move'); return true; }
          if (ev.key === 'a') { this._pick.call(this); return true; }
          if (ev.key === 'b' || ev.key === 'menu') {
            // A choice that cannot be cancelled says no with the buzzer, which
            // the kit leaves silent — so it falls back to the cancel sound it
            // always made, and a look that has a buzzer gets its own.
            if (this._cancel === 'none') { KIT.look.sound('buzzer', { or: 'cancel' }); return true; }
            KIT.look.sound('cancel');
            this.finish(-1);
            return true;
          }
          return true;
        },
      };
    },
  });

  // ---- a small modal panel shared by nameEntry and inputNumber ----------------------
  //
  // OK and Cancel are the author's Terms, like every other word the engine says.
  // And A is OK and B is Cancel: on a phone the pad is the controller, and a
  // name that only a tap on OK could confirm left a player with a gamepad, or
  // one who reached for A out of habit, pressing a button that did nothing.
  // ☰ is Cancel too. It is "back" everywhere else in the game (a choice, the
  // pause menu), and on a keyboard it is Escape, which inside the field has
  // always cancelled — as OK, the same key confirmed or cancelled depending on
  // where the caret happened to be.
  // Keys typed INTO the field never arrive here (js/kit/core/input.js ignores a
  // keydown inside a text field), so typing a Z is still a Z. The field's own
  // Enter and Escape are read by the field.
  //
  // A, ☰ and Enter wait for the box to settle. The field is filled in already
  // (the hero's name as it is), and the box mostly opens straight after a line
  // of dialogue, which all three of them page through — so a player going
  // through the talk met the box mid-rhythm, and their next press took the name
  // as it stood, or threw the box away, before they could type one: the one
  // chance to name the hero, or a catch, gone without a sign. Until the player
  // types, then, those three count only once the box has been up for SETTLE
  // seconds with none of them pressed. One that comes sooner starts the wait
  // again, so mashing never gets through; and it says so, with the buzzer and a
  // shake of the button it would have pressed. Timing alone cannot tell a press
  // meant for the last line from an impatient one meant for the box, so the
  // shake is how a player learns which it was taken for, rather than finding a
  // button that does nothing. Once they have typed, the box is plainly what
  // they are answering, and nothing waits. Nor do a tap on OK or Cancel, B, or
  // Escape in the field.
  const SETTLE = 0.8;
  const term = (id) => KIT.strings.get(KIT.game && KIT.game.project, id);
  function modalPanel(title) {
    const host = UI.el('choice');
    UI.clear(host);
    host.hidden = false;
    const panel = UI.make('div.kit-panel.kit-modal');
    if (title) panel.appendChild(UI.make('div.kit-prompt', { text: title }));
    host.appendChild(panel);
    return { host, panel };
  }

  /**
   * The field, Cancel and OK under the prompt, and every way to answer them.
   * `done(ok)` finishes the scene with the field's answer, or with null.
   */
  function modalField(scene, m, input, done) {
    m.panel.appendChild(input);
    const row = UI.make('div.kit-row');
    const cancel = row.appendChild(UI.button('cancel', term('cancel')));
    const ok = row.appendChild(UI.button('ok', term('ok'), 'is-primary'));
    m.panel.appendChild(row);
    scene._host = m.host;
    scene._buttons = { ok, cancel };
    scene._done = done;
    scene._calm = 0;
    scene._typed = false;
    scene._off = UI.onAction(m.host, (a) => done(a === 'ok'));
    input.addEventListener('input', () => { scene._typed = true; });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      // A held Enter repeats; only the press itself is a press.
      if (e.key === 'Enter' && !e.repeat && counts(scene, ok)) done(true);
      if (e.key === 'Escape') done(false);
    });
    setTimeout(() => { try { input.focus(); input.select(); } catch (e) { /* ignore */ } }, 0);
  }

  /** Whether this A, ☰ or Enter counts yet (see above). One that does not shakes `button`. */
  function counts(scene, button) {
    if (scene._typed) return true;
    const settled = scene._calm >= SETTLE;
    scene._calm = 0;
    if (!settled) { KIT.look.sound('buzzer', { or: 'cancel' }); shake(button); }
    return settled;
  }

  /** The pad's buttons for a modal's OK and Cancel: A is OK and ☰ is Cancel once the box has settled; B is Cancel at once. */
  function modalInput(scene, ev) {
    if (ev.key === 'a') { if (counts(scene, scene._buttons.ok)) scene._done(true); }
    else if (ev.key === 'menu') { if (counts(scene, scene._buttons.cancel)) scene._done(false); }
    else if (ev.key === 'b') scene._done(false);
    return true;
  }

  scenes.add({
    id: 'nameEntry', name: 'Name entry',
    create() {
      return {
        id: 'nameEntry', transparent: true,
        enter(params) {
          const p = params || {};
          const m = modalPanel(p.prompt || term('name-prompt'));
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'kit-input';
          input.maxLength = p.maxLength || 8;
          input.value = p.current || '';
          input.setAttribute('data-role', 'name-entry');
          input.setAttribute('aria-label', p.prompt || term('name-prompt'));
          modalField(this, m, input, (ok) => this.finish(ok ? (input.value.trim() || p.current || null) : null));
        },
        exit() { if (this._host) { this._host.hidden = true; UI.clear(this._host); } if (this._off) this._off(); },
        update(dt) { this._calm += dt; },
        input(ev) { return modalInput(this, ev); },
      };
    },
  });

  scenes.add({
    id: 'inputNumber', name: 'Input number',
    create() {
      return {
        id: 'inputNumber', transparent: true,
        enter(params) {
          const p = params || {};
          const max = Math.pow(10, p.digits || 3) - 1;
          const m = modalPanel(p.prompt || term('number-prompt'));
          const input = document.createElement('input');
          input.type = 'number';
          input.className = 'kit-input';
          input.min = '0'; input.max = String(max);
          input.value = String(Math.min(max, p.current || 0));
          input.setAttribute('data-role', 'number-entry');
          // A field with no name is read out as "spin button, 0" and nothing else.
          input.setAttribute('aria-label', p.prompt || term('number-prompt'));
          modalField(this, m, input, (ok) => this.finish(ok ? Math.max(0, Math.min(max, Number(input.value) || 0)) : null));
        },
        exit() { if (this._host) { this._host.hidden = true; UI.clear(this._host); } if (this._off) this._off(); },
        update(dt) { this._calm += dt; },
        input(ev) { return modalInput(this, ev); },
      };
    },
  });

  // ---- scrolling text ---------------------------------------------------------------
  scenes.add({
    id: 'scrollText', name: 'Scrolling text',
    create() {
      let y = 0, speed = 1, host = null, inner = null, fast = false;
      return {
        id: 'scrollText', transparent: true,
        enter(params) {
          const p = params || {};
          host = UI.el('dialogue');
          host.removeAttribute('data-linger');           // the host is this scene's now, not a line's waiting for a question
          host.hidden = false;
          host.setAttribute('data-bg', 'dim');
          host.classList.add('is-scroll');
          UI.clear(host);
          inner = UI.make('div.kit-scroll');
          // Already substituted by the command that asked; only the codes come out.
          inner.textContent = KIT.text.strip(p.text || '');
          host.appendChild(inner);
          y = host.clientHeight;
          speed = (p.speed || 2) * 18;
          fast = false;
          this._noFast = !!p.noFast;
          inner.style.transform = `translateY(${y}px)`;
        },
        exit() { if (host) { host.hidden = true; host.classList.remove('is-scroll'); UI.clear(host); host.removeAttribute('data-bg'); } },
        update(dt) {
          if (!inner) return;
          y -= dt * speed * (fast ? 3 : 1) * (KIT.fx.instant ? 8 : 1);
          inner.style.transform = `translateY(${y}px)`;
          if (y < -inner.offsetHeight - 8) this.finish(true);
        },
        input(ev) { if ((ev.key === 'a' || ev.key === 'b') && !this._noFast) fast = true; return true; },
      };
    },
  });

  // ---- chapter card --------------------------------------------------------------------
  scenes.add({
    id: 'chapter', name: 'Chapter card',
    create() {
      let left = 0, host = null;
      return {
        id: 'chapter', transparent: true,
        enter(params) {
          const p = params || {};
          host = UI.el('chapter');
          if (!host) { this.finish(); return; }
          UI.parts.card(host, { title: p.title, subtitle: p.subtitle });
          left = (KIT.fx && KIT.fx.instant) ? 80 : (p.ms == null ? 2000 : p.ms);
        },
        exit() { if (host) { host.hidden = true; host.classList.remove('is-in'); UI.clear(host); } },
        update(dt) { left -= dt * 1000; if (left <= 0) this.finish(true); },
        input(ev) { if (ev.key === 'a' || ev.key === 'b') this.finish(true); return true; },
      };
    },
  });

  // ---- toast ------------------------------------------------------------------------
  // A toast does not take input: it shows, the script carries on after a beat,
  // and the element fades away on its own. How long it stays is the caller's
  // to say, else the look's: a look for slow readers can keep "Saved." up
  // longer, and there was no way to before.
  let toastTimer = null;
  KIT.toast = function (text, ms) {
    const host = UI.el('toast');
    if (!host) return Promise.resolve();
    UI.parts.toast(host, text);
    KIT.look.sound('toast');
    if (toastTimer) clearTimeout(toastTimer);
    const life = (KIT.fx && KIT.fx.instant) ? 200 : (ms || KIT.look.get('toast.ms', 1600));
    toastTimer = setTimeout(() => { host.classList.remove('is-in'); host.hidden = true; }, life);
    return new Promise(res => setTimeout(res, Math.min(life, (KIT.fx && KIT.fx.instant) ? 10 : 550)));
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
