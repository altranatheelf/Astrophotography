// The DOM half of the look: putting the compiled stylesheet into the page, and
// the markup of the built-in screens, built in one place.
//
// The builders exist so that the message box, a choice, a list panel and the
// title are drawn by ONE function each, which the scenes call — and which
// anything else that needs to draw the same thing (a preview of a look, a
// module's own screen) can call too, into a host of its own, and get markup the
// look's rules already reach. They build DOM and return the pieces; the input,
// the timing and the sounds stay in the scenes.
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
     * { label, value, note, action, disabled }, each a [data-action] button.
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
     * choicePanel(host, { prompt, options }) -> { host, list, promptBox }
     * The text arrives already substituted — and so already translated — by
     * the command that asked, so it only has its codes taken out here.
     * Substituting again translated it twice: a line whose translation happens
     * to be another line's English came out as that other line's translation.
     */
    choicePanel(host, o) {
      const opts = o || {};
      UI.clear(host);
      host.hidden = false;
      const panel = UI.make('div.kit-panel');
      if (opts.prompt) panel.appendChild(UI.make('div.kit-prompt', { text: KIT.text.strip(opts.prompt) }));
      const list = UI.make('div.kit-list');
      (opts.options || []).forEach((opt, i) => {
        const b = UI.make('button.kit-option', { text: KIT.text.strip(opt.text) });
        b.type = 'button';
        b.setAttribute('data-index', String(i));
        b.setAttribute('data-action', 'choose');
        list.appendChild(b);
      });
      panel.appendChild(list);
      host.appendChild(panel);
      return { host, list, promptBox: null };
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

  /**
   * apply(project) -> Promise — put this game's look in use and in the page.
   * The stylesheet is one <style id="kit-look"> at the end of <head>, made the
   * first time and rewritten only when its text changes. For the kit look it
   * is empty, and the page is exactly css/kit.css.
   */
  L.apply = function (project) {
    const look = L.use(project);
    fonts = (project && KIT.isObject(project.fonts)) ? project.fonts : {};
    const css = L.css(project);
    if (typeof document !== 'undefined' && document.head) {
      let style = document.getElementById('kit-look');
      if (!style) {
        style = document.createElement('style');
        style.id = 'kit-look';
        document.head.appendChild(style);
      }
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
