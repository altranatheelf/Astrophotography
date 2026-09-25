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

  const SPEEDS = { slow: 22, normal: 48, fast: 96, instant: 0 };
  const LINES_PER_PAGE = 3;

  function settings() { return (KIT.storage && KIT.storage.settings) ? KIT.storage.settings() : {}; }
  function instant() { return !!(KIT.fx && KIT.fx.instant) || settings().textSpeed === 'instant'; }
  function charsPerSecond() {
    if (instant()) return 0;
    return SPEEDS[settings().textSpeed] == null ? SPEEDS.normal : SPEEDS[settings().textSpeed];
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
    if (voice.font) el.style.fontFamily = voice.font;
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
  scenes.add({
    id: 'dialogue', name: 'Message',
    create() {
      let ui = null, units = [], unitIndex = 0, charIndex = 0, acc = 0, pages = [], pageIndex = 0;
      let waiting = false, complete = false, speed = 1, pauseLeft = 0;
      let voice = null, sinceBlip = 0, spoken = 0;

      function layoutFor(textEl) {
        return { width: Math.max(80, textEl.clientWidth - 2), measure: measurerFor(textEl), lines: LINES_PER_PAGE };
      }

      function buildPage(page) {
        const t = ui.text;
        t.innerHTML = '';
        units = []; unitIndex = 0; charIndex = 0; acc = 0; complete = false; waiting = false; speed = 1; pauseLeft = 0;
        for (const line of page) {
          const lineEl = UI.make('div.kit-line');
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
        ui.next.textContent = '▼';
      }

      return {
        id: 'dialogue', transparent: true,
        enter(params) {
          ui = UI.parts.dialogueBox(UI.el('dialogue'));
          if (!ui) { this.finish(); return; }
          const p = params || {};
          ui.host.hidden = false;
          ui.host.setAttribute('data-position', p.position || 'bottom');
          ui.host.setAttribute('data-bg', p.bg || 'window');
          ui.name.textContent = p.who || '';
          ui.name.hidden = !p.who;
          ui.name.removeAttribute('style');
          ui.name.classList.remove('is-big', 'is-small');
          ui.face.innerHTML = '';
          ui.face.hidden = !p.face;
          if (p.face) ui.face.appendChild(UI.artCanvas(faceArt(p.face), 3));
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
          const lay = layoutFor(ui.text);
          const rendered = p.ctx ? KIT.text.render(body, p.ctx, lay) : KIT.text.layout(body, lay);
          pages = rendered[0].pages;
          pageIndex = 0;
          buildPage(pages[0] || []);
          this._tap = () => { this.input({ key: 'a', player: 1 }); };
          ui.host.addEventListener('click', this._tap);
          // Get the music out from under the voice. Counted, so a run of lines
          // ducks once and comes back up once at the end rather than pumping
          // between every box.
          if (KIT.audio && KIT.audio.duck) { this._ducked = true; KIT.audio.duck(null, 160); }
        },
        exit() {
          if (this._ducked && KIT.audio && KIT.audio.unduck) { this._ducked = false; KIT.audio.unduck(360); }
          if (ui) {
            ui.host.hidden = true;
            if (this._tap) ui.host.removeEventListener('click', this._tap);
          }
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
            if (pageIndex < pages.length - 1) { pageIndex++; buildPage(pages[pageIndex]); return true; }
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
  scenes.add({
    id: 'choice', name: 'Choices',
    create() {
      let host = null, index = 0, options = [];
      return {
        id: 'choice', transparent: true,
        enter(params) {
          const p = params || {};
          options = p.options || [];
          index = 0;
          host = UI.el('choice');
          if (!host) { this.finish(-1); return; }
          const list = UI.parts.choicePanel(host, { prompt: p.prompt, options }).list;
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
        exit() { if (host) { host.hidden = true; UI.clear(host); } if (this._off) this._off(); },
        input(ev) {
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
          UI.clear(host);
          host.hidden = false;
          host.classList.add('is-in');
          const card = UI.make('div.kit-card');
          card.appendChild(UI.make('div.kit-chapter-title', { text: KIT.text.strip(p.title || '') }));
          if (p.subtitle) card.appendChild(UI.make('div.kit-chapter-sub', { text: KIT.text.strip(p.subtitle) }));
          host.appendChild(card);
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
  // and the element fades away on its own. Its text is a Term or a line a
  // command already substituted, so it is not translated a second time here.
  let toastTimer = null;
  KIT.toast = function (text, ms) {
    const host = UI.el('toast');
    if (!host) return Promise.resolve();
    UI.clear(host);
    host.appendChild(UI.make('div.kit-toast-pill', { text: KIT.text.strip(text || '') }));
    host.hidden = false;
    host.classList.add('is-in');
    KIT.look.sound('toast');
    if (toastTimer) clearTimeout(toastTimer);
    const life = (KIT.fx && KIT.fx.instant) ? 200 : (ms || 1600);
    toastTimer = setTimeout(() => { host.classList.remove('is-in'); host.hidden = true; }, life);
    return new Promise(res => setTimeout(res, Math.min(life, (KIT.fx && KIT.fx.instant) ? 10 : 550)));
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
