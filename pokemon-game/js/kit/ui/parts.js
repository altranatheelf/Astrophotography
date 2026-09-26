// The DOM half of the look: putting the compiled stylesheet into the page, and
// the markup of the built-in screens, built in one place.
//
// The builders exist so that the message box, a choice, a list panel and the
// title are drawn by ONE function each, which the scenes call — and which
// anything else that needs to draw the same thing (a preview of a look, a
// module's own screen) can call too, into a host of its own, and get markup the
// look's rules already reach. They build DOM and return the pieces; the input,
// the timing and the sounds stay in the scenes — all but `nav`, which works
// out where an arrow goes among the pieces once they are laid out, so every
// screen that lays choices side by side moves between them the same way.
//
// Nothing here touches the page when the file loads: it runs headless in the
// tests, and the DOM is only reached inside the functions.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const UI = KIT.ui;
  const L = KIT.look;

  /**
   * host(id, { after, className }) -> the overlay `div#id.overlay` inside
   * #screen, made the first time it is asked for and found every time after.
   * `after` is the id of the host it goes directly behind in the page, which is
   * what decides the paint order between overlays that share a z-index.
   */
  UI.host = function (id, opts) {
    if (typeof document === 'undefined') return null;
    const have = document.getElementById(id);
    if (have) return have;
    const screen = document.getElementById('screen');
    if (!screen) return null;
    const o = opts || {};
    const el = UI.make('div.overlay' + (o.className ? '.' + o.className : ''));
    el.id = id;
    el.hidden = true;
    const prev = o.after ? document.getElementById(o.after) : null;
    if (prev && prev.parentNode === screen) screen.insertBefore(el, prev.nextSibling);
    else screen.appendChild(el);
    return el;
  };

  /**
   * nav(rects, from, dir, wrap) -> the index an arrow moves to. `rects` are
   * where the choices are on the screen (what getBoundingClientRect gives:
   * left, top, width, height), `from` is the one chosen now and `dir` is
   * up, down, left or right. Pure: it reads the numbers, never the page.
   *
   * It goes to the nearest choice whose middle lies that way, counting the
   * distance across the arrow twice. So ▼ in a grid of answers is the one
   * underneath, not the next one in reading order — that one is up and across
   * at the start of the next row, and ▼ used to jump there. With nothing that
   * way, `wrap` goes round to the far end of the same row or column, the way
   * a list goes from its last line to its first; without `wrap`, and for an
   * arrow across a single row (▼ on a Yes beside a No), it stays where it is.
   * Choices not laid out yet (all at 0×0) have nothing to measure, so they
   * move in reading order.
   */
  UI.nav = function (rects, from, dir, wrap) {
    const n = rects ? rects.length : 0;
    if (n < 2 || !(from >= 0 && from < n)) return from;
    const back = dir === 'up' || dir === 'left';
    const here = rects[from];
    if (!here || !(here.width || here.height)) {
      const to = from + (back ? -1 : 1);
      return wrap ? (to + n) % n : Math.max(0, Math.min(n - 1, to));
    }
    const along = dir === 'left' || dir === 'right' ? 'x' : 'y', across = along === 'x' ? 'y' : 'x';
    const mid = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    const c = mid(here), sign = back ? -1 : 1;
    // `ahead` is how far along the arrow a choice is: above 0 is that way,
    // below 0 is behind. Half a pixel either way is the same row.
    const nearest = (score) => {
      let best = from, bestScore = Infinity;
      rects.forEach((r, i) => {
        if (i === from) return;
        const m = mid(r);
        const s = score((m[along] - c[along]) * sign, Math.abs(m[across] - c[across]));
        if (s < bestScore) { bestScore = s; best = i; }
      });
      return best;
    };
    const ahead = nearest((d, off) => (d > 0.5 ? d + 2 * off : Infinity));
    if (ahead !== from || !wrap) return ahead;
    return nearest((d, off) => (d < -0.5 ? d + 2 * off : Infinity));
  };

  /**
   * promptBoxOf(prompt) -> a message box holding a question's own words, a
   * line for each line of it. Each one is the start of a line the author
   * wrote, so a look's mark ("* ") goes in front of it as in a message. With
   * no words, no line: answers inside the box sat under an empty one.
   */
  function promptBoxOf(prompt) {
    const box = UI.make('div.kit-box.kit-promptbox');
    const wrap = UI.make('div.kit-textwrap');
    const text = UI.make('div.kit-text');
    const words = KIT.text.strip(prompt || '');
    for (const line of words ? words.split('\n') : []) {
      const el = UI.make('div.kit-line', { text: line });
      if (line.trim()) el.classList.add('is-start');
      text.appendChild(el);
    }
    wrap.appendChild(text);
    box.appendChild(wrap);
    return box;
  }

  /**
   * copyBox(box, reflow) -> the message box as the player last saw it, to keep
   * on screen as a question's box: every letter showing, no ▼ (the answers are
   * what comes next), no shake or opening. A copied canvas comes without its
   * picture, so the portrait is drawn again from the one it copies. It keeps
   * the height it had, so the box does not shrink as the answers come up —
   * only grows, when answers inside it need the room.
   *
   * `reflow`, for a box made narrower by the answers beside it: its lines were
   * broken for the wider box, and broke again inside the narrow one, mid-
   * sentence ("…under the / mat. Will / you open…"). A line the message box
   * marked as only wrapped (data-join, see KIT.dialogueLayout.lines) goes back
   * onto the line before it, with the space the wrap took out, so the words
   * flow again at the width the box has; a line the author started stays a
   * line of its own.
   */
  function copyBox(box, reflow) {
    const copy = box.cloneNode(true);
    copy.classList.add('kit-promptbox');
    copy.classList.remove('is-shaking', 'is-opening');
    if (reflow) {
      for (const line of Array.from(copy.querySelectorAll('.kit-line[data-join]'))) {
        const before = line.previousElementSibling;
        if (!before || !before.classList.contains('kit-line')) continue;
        if (line.getAttribute('data-join')) before.appendChild(document.createTextNode(line.getAttribute('data-join')));
        while (line.firstChild) before.appendChild(line.firstChild);
        line.remove();
      }
    }
    const next = copy.querySelector('.kit-next');
    if (next) next.remove();
    const from = box.querySelectorAll('canvas');
    copy.querySelectorAll('canvas').forEach((c, i) => {
      try { c.getContext('2d').drawImage(from[i], 0, 0); }
      catch (e) { (KIT.log || console).warn('[choice] the portrait could not be copied into the question', e); }
    });
    for (const el of copy.querySelectorAll('[style*="visibility"]')) el.style.visibility = '';
    if (box.offsetHeight) copy.style.minHeight = box.offsetHeight + 'px';
    return copy;
  }

  UI.parts = {
    /**
     * dialogueBox(host) -> { host, box, face, name, text, next }
     * Built unless the host already holds a message box. It used to be built
     * only when the host was EMPTY, so anything else left in #dialogue — the
     * scrolling text's own element, a module's — meant the next message found
     * no text element and threw.
     */
    dialogueBox(host) {
      if (!host) return null;
      if (!host.querySelector('.kit-box .kit-text')) {
        UI.clear(host);
        const box = UI.make('div.kit-box');
        box.appendChild(UI.make('div.kit-facebox'));
        const wrap = UI.make('div.kit-textwrap');
        wrap.appendChild(UI.make('div.kit-name'));
        wrap.appendChild(UI.make('div.kit-text'));
        box.appendChild(wrap);
        box.appendChild(UI.make('div.kit-next', { text: '▼' }));
        host.appendChild(box);
      }
      return {
        host,
        box: host.querySelector('.kit-box'),
        face: host.querySelector('.kit-facebox'),
        name: host.querySelector('.kit-name'),
        text: host.querySelector('.kit-text'),
        next: host.querySelector('.kit-next'),
      };
    },

    /**
     * listPanel(host, title, rows, { hint }) -> { host, list }
     * The pause menu's panel, and every list that is drawn like it: rows of
     * { label, value, note, action, disabled, notice }, each a [data-action]
     * button. A `notice` row is a sentence said in the list rather than a
     * thing to pick (the save list's warning), and a look's capitals leave it
     * as written.
     */
    listPanel(host, title, rows, opts) {
      UI.clear(host);
      host.hidden = false;
      const box = UI.make('div.kit-panel.kit-pause');
      if (title) box.appendChild(UI.make('div.kit-panel-title', { text: title }));
      const list = UI.make('div.kit-menu-list');
      (rows || []).forEach((r, i) => {
        const b = UI.make('button.kit-uibtn.kit-menu-item', {});
        b.type = 'button';
        b.setAttribute('data-action', r.action || ('row-' + i));
        b.setAttribute('data-index', String(i));
        if (r.disabled) b.disabled = true;
        if (r.notice) b.classList.add('kit-menu-notice');
        b.appendChild(UI.make('span.kit-item-label', { text: r.label }));
        if (r.value != null) b.appendChild(UI.make('span.kit-item-value', { text: String(r.value) }));
        if (r.note) b.appendChild(UI.make('span.kit-item-note', { text: r.note }));
        list.appendChild(b);
      });
      box.appendChild(list);
      if (opts && opts.hint) box.appendChild(UI.make('p.kit-hint', { text: opts.hint }));
      host.appendChild(box);
      return { host, list };
    },

    /**
     * choicePanel(host, { prompt, options, place, promptClone }) -> { host, list, promptBox }
     * The text arrives already substituted — and so already translated — by
     * the command that asked, so it only has its codes taken out here.
     * Substituting again translated it twice: a line whose translation happens
     * to be another line's English came out as that other line's translation.
     *
     * `place` puts the answers by a message box that keeps the question on
     * screen (`.kit-promptbox`, a `.kit-box`, so it looks like the message box):
     *   'above-box'   the answers in a little window over the box's corner
     *   'beside-box'  in a window to its right
     *   'in-box'      inside the box, under the question
     * The box holds `prompt`, or is a copy of `promptClone` — the message box
     * as it was when the question came, portrait and all; beside the box, the
     * copy is narrower, and its words flow again at that width (copyBox).
     * Without a place, the prompt heads the panel of answers, as it always has.
     */
    choicePanel(host, o) {
      const opts = o || {};
      UI.clear(host);
      host.hidden = false;
      const list = UI.make('div.kit-list');
      (opts.options || []).forEach((opt, i) => {
        const b = UI.make('button.kit-option', { text: KIT.text.strip(opt.text) });
        b.type = 'button';
        b.setAttribute('data-index', String(i));
        b.setAttribute('data-action', 'choose');
        list.appendChild(b);
      });
      const place = opts.place || null;
      if (!place) {
        const panel = UI.make('div.kit-panel');
        if (opts.prompt) panel.appendChild(UI.make('div.kit-prompt', { text: KIT.text.strip(opts.prompt) }));
        panel.appendChild(list);
        host.appendChild(panel);
        return { host, list, promptBox: null };
      }
      let promptBox = null;
      if (opts.promptClone) promptBox = copyBox(opts.promptClone, place === 'beside-box');
      else if (opts.prompt || place === 'in-box') promptBox = promptBoxOf(opts.prompt || '');
      if (place === 'in-box') {
        promptBox.querySelector('.kit-textwrap').appendChild(list);
        host.appendChild(promptBox);
        return { host, list, promptBox };
      }
      const panel = UI.make('div.kit-panel');
      panel.appendChild(list);
      // Above the box is before it in the page (#choice is a column); beside it, after it (a row).
      if (place === 'above-box') { host.appendChild(panel); if (promptBox) host.appendChild(promptBox); }
      else { if (promptBox) host.appendChild(promptBox); host.appendChild(panel); }
      return { host, list, promptBox };
    },

    /**
     * toast(host, text) -> { host, pill } — the little note that pops up
     * ("Saved."). Only the drawing: how long it stays is KIT.toast's. The text
     * is a Term or a line a command already substituted, so it only has its
     * codes taken out.
     */
    toast(host, text) {
      UI.clear(host);
      const pill = UI.make('div.kit-toast-pill', { text: KIT.text.strip(text || '') });
      host.appendChild(pill);
      host.hidden = false;
      host.classList.add('is-in');
      return { host, pill };
    },

    /** card(host, { title, subtitle }) -> { host, card } — a chapter card, already substituted by the command that asked. */
    card(host, o) {
      const opts = o || {};
      UI.clear(host);
      host.hidden = false;
      host.classList.add('is-in');
      const card = UI.make('div.kit-card');
      card.appendChild(UI.make('div.kit-chapter-title', { text: KIT.text.strip(opts.title || '') }));
      if (opts.subtitle) card.appendChild(UI.make('div.kit-chapter-sub', { text: KIT.text.strip(opts.subtitle) }));
      host.appendChild(card);
      return { host, card };
    },

    /** titleScreen(host, { meta, items, hint }) -> { host, list }. items are { action, label, disabled }. */
    titleScreen(host, o) {
      const opts = o || {};
      const meta = opts.meta || {};
      UI.clear(host);
      host.hidden = false;
      const inner = UI.make('div.kit-title-inner');
      inner.appendChild(UI.make('h1.kit-title', { text: meta.title || 'Our Adventure' }));
      if (meta.subtitle) inner.appendChild(UI.make('p.kit-subtitle', { text: meta.subtitle }));
      const list = UI.make('div.kit-menu-list');
      (opts.items || []).forEach((it, i) => {
        const b = UI.make('button.kit-uibtn.kit-menu-item', { text: it.label });
        b.type = 'button';
        b.setAttribute('data-action', it.action);
        b.setAttribute('data-index', String(i));
        if (it.disabled) b.disabled = true;
        list.appendChild(b);
      });
      inner.appendChild(list);
      if (meta.pitch) inner.appendChild(UI.make('p.kit-pitch', { text: meta.pitch }));
      if (opts.hint) inner.appendChild(UI.make('p.kit-hint', { text: opts.hint }));
      host.appendChild(inner);
      return { host, list };
    },
  };

  // ---- the look in the page ----------------------------------------------------------
  let fonts = {};

  /**
   * syncMotion() — #stage says whether things may move. `data-kit-motion`
   * follows the player's own Reduce motion setting, which the stylesheet reads
   * to stop the ▼, the shake, the text effects, the chapter card and the toast —
   * the operating system's setting stopped them, the game's own setting did
   * not. `data-kit-fast` is ?fast=1. Both are on #stage because a preview of a
   * look has a #stage of its own, and a rule written against the page's <html>
   * could never reach inside it.
   */
  L.syncMotion = function () {
    const stage = UI.el('stage');
    if (!stage) return;
    const s = (KIT.storage && KIT.storage.settings) ? KIT.storage.settings() : {};
    const motion = s.reduceMotion ? 'reduce' : null;
    if (stage.getAttribute('data-kit-motion') !== motion) {
      if (motion) stage.setAttribute('data-kit-motion', motion); else stage.removeAttribute('data-kit-motion');
    }
    const fast = !!(KIT.fx && KIT.fx.instant);
    if (stage.hasAttribute('data-kit-fast') !== fast) {
      if (fast) stage.setAttribute('data-kit-fast', ''); else stage.removeAttribute('data-kit-fast');
    }
  };

  /**
   * fontsReady(ms) -> Promise — the game's own fonts the look uses have
   * arrived, or `ms` has passed. A message is wrapped by measuring its letters;
   * measured in a fallback font, the first page breaks in the wrong places.
   */
  L.fontsReady = function (ms) {
    const t = L.current().tokens || {};
    const used = [t.fontText, t.fontUi, t.fontName].filter((v, i, a) => v && KIT.has(fonts, v) && a.indexOf(v) === i);
    if (!used.length || typeof document === 'undefined' || !document.fonts) return Promise.resolve();
    const late = new Promise((res) => setTimeout(res, ms == null ? 1500 : ms));
    const loads = Promise.all(used.map(id => document.fonts.load('16px "kitf-' + id + '"')))
      .catch((e) => (KIT.log || console).warn('[look] a font did not load; the fallback is used', e));
    return Promise.race([loads, late]);
  };

  /** styleIn(id) -> the <style> of that id at the end of <head>, made the first time it is asked for. */
  function styleIn(id) {
    let style = document.getElementById(id);
    if (!style) {
      style = document.createElement('style');
      style.id = id;
      document.head.appendChild(style);
    }
    return style;
  }

  /**
   * apply(project) -> Promise — put this game's look in use and in the page.
   * The look is one <style id="kit-look"> at the end of <head>, made the
   * first time and rewritten only when its text changes; the game's own
   * fonts (KIT.look.fontFaces) are in a <style id="kit-look-fonts"> before
   * it, rewritten only when the fonts change. Written together, every colour
   * of a drag made the browser read every font file again, a new font each
   * time. For the kit look in a game with no fonts, both are empty, and the
   * page is exactly css/kit.css. 'applied' carries what #kit-look holds.
   */
  L.apply = function (project) {
    const look = L.use(project);
    fonts = (project && KIT.isObject(project.fonts)) ? project.fonts : {};
    const faces = L.fontFaces(fonts);
    const css = L.css(project, { faces: false });
    if (typeof document !== 'undefined' && document.head) {
      const fontStyle = styleIn('kit-look-fonts');
      const style = styleIn('kit-look');
      if (fontStyle.textContent !== faces) fontStyle.textContent = faces;
      if (style.textContent !== css) style.textContent = css;
    }
    L.syncMotion();
    L.events.emit('applied', { css, look });
    return L.fontsReady();
  };

  // A setting can change under any scene (Settings from the title, a module's
  // own screen), and every one of them ends in a scene change.
  KIT.scenes.events.on('sceneChange', () => L.syncMotion());

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
