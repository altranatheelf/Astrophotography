// KIT.scenes — the scene stack (§8.1), plus the two small things every scene
// needs: KIT.ui (DOM helpers over the overlay elements from §12) and KIT.fx
// (screen effects and pictures, read by the renderer every frame).
//
//   const answer = await KIT.scenes.run('choice', { options })   // push, wait, pop
//   KIT.scenes.push('map'); KIT.scenes.top().id
//
// A scene is `{ id, transparent, enter(params), exit(), update(dt), input(ev) }`
// and finishes by calling `this.finish(result)`. Only the top scene is given
// input; a `transparent` scene leaves the one below it on screen.
(function (root) {
  const KIT = root.KIT = root.KIT || {};

  // ---- DOM helpers --------------------------------------------------------------
  const UI = KIT.ui = {
    el(id) { return typeof document === 'undefined' ? null : document.getElementById(id); },
    show(el, on) { if (el) el.hidden = on === false; },
    hide(el) { if (el) el.hidden = true; },
    clear(el) { if (el) el.innerHTML = ''; return el; },
    /** make('div.box', { text, html, attrs }) -> element */
    make(spec, opts) {
      const [tag, ...classes] = String(spec).split('.');
      const el = document.createElement(tag || 'div');
      if (classes.length) el.className = classes.join(' ');
      opts = opts || {};
      if (opts.text != null) el.textContent = opts.text;
      if (opts.html != null) el.innerHTML = opts.html;
      for (const k of Object.keys(opts.attrs || {})) el.setAttribute(k, opts.attrs[k]);
      return el;
    },
    /** A [data-action] button (the e2e tests and the touch UI both use these). */
    button(action, label, cls) {
      const b = UI.make('button.kit-uibtn' + (cls ? '.' + cls : ''), { text: label });
      b.type = 'button';
      b.setAttribute('data-action', action);
      return b;
    },
    /** onAction(root, fn) -> off. Delegated clicks on anything with [data-action]. */
    onAction(el, fn) {
      const handler = (e) => {
        const t = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
        if (!t || !el.contains(t)) return;
        e.preventDefault();
        fn(t.getAttribute('data-action'), t, e);
      };
      el.addEventListener('click', handler);
      return () => el.removeEventListener('click', handler);
    },
    /** A keyboard-style list: marks [data-index] items and scrolls the selected one into view. */
    select(listEl, index) {
      const items = Array.from(listEl.querySelectorAll('[data-index]'));
      items.forEach((it, i) => it.classList.toggle('is-selected', i === index));
      const sel = items[index];
      if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
      return sel;
    },
    /** Draw a pixel-art definition into a canvas element (faces, icons, item art). */
    artCanvas(art, scale, fallbackColor) {
      const cv = document.createElement('canvas');
      const dims = KIT.pixels.dims(art || {});
      const w = dims.w || 16, h = dims.h || 16;
      const s = Math.max(1, scale || 3);
      cv.width = w * s; cv.height = h * s;
      cv.style.width = (w * s) + 'px';
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      KIT.pixels.draw(g, art || KIT.pixels.silhouette(w, h, fallbackColor || '#8a8a9a'), 0, 0, { scale: s });
      return cv;
    },
  };

  // ---- KIT.fx: screen effects and pictures -----------------------------------------
  const fxState = {
    fade: { color: '#000000', alpha: 0 },
    tint: { color: '#000000', amount: 0 },
    flash: { color: '#ffffff', alpha: 0 },
    shake: { x: 0, y: 0, power: 0, left: 0 },
    weather: { kind: 'none', power: 0 },
  };
  let tweens = [];
  const pics = [];

  function reduceMotion() {
    const s = (KIT.storage && KIT.storage.settings) ? KIT.storage.settings() : {};
    if (s.reduceMotion) return true;
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function instant() { return !!KIT.fx.instant; }

  function tween(get, set, to, ms) {
    return new Promise((resolve) => {
      const from = get();
      const total = instant() ? 0 : Math.max(0, ms || 0);
      if (total <= 0) { set(to); resolve(); return; }
      tweens.push({ t: 0, ms: total, step(dt) { this.t += dt * 1000; const k = Math.min(1, this.t / this.ms); set(from + (to - from) * k); return k >= 1; }, done: resolve });
    });
  }

  const FX = KIT.fx = {
    instant: false,
    state() { return fxState; },
    reset() {
      tweens = [];
      fxState.fade.alpha = 0; fxState.tint.amount = 0; fxState.flash.alpha = 0;
      fxState.shake.left = 0; fxState.shake.x = 0; fxState.shake.y = 0;
      fxState.weather.kind = 'none'; fxState.weather.power = 0;
      pics.length = 0;
    },
    update(dt) {
      for (const tw of tweens.slice()) {
        if (tw.step(dt)) { tweens.splice(tweens.indexOf(tw), 1); if (tw.done) tw.done(); }
      }
      const sh = fxState.shake;
      if (sh.left > 0) {
        sh.left -= dt * 1000;
        const p = sh.power * 2;
        sh.x = (Math.random() * 2 - 1) * p;
        sh.y = (Math.random() * 2 - 1) * p;
        if (sh.left <= 0) { sh.x = 0; sh.y = 0; }
      }
      for (const p of pics.slice()) {
        if (!p.move) continue;
        p.move.t += dt * 1000;
        const k = Math.min(1, p.move.ms ? p.move.t / p.move.ms : 1);
        p.x = p.move.fromX + (p.move.toX - p.move.fromX) * k;
        p.y = p.move.fromY + (p.move.toY - p.move.fromY) * k;
        p.opacity = p.move.fromO + (p.move.toO - p.move.fromO) * k;
        if (k >= 1) { const done = p.move.done; p.move = null; if (done) done(); }
      }
    },

    fadeOut(o) { o = o || {}; fxState.fade.color = o.color || '#000000'; return tween(() => fxState.fade.alpha, (v) => { fxState.fade.alpha = v; }, 1, o.ms == null ? 400 : o.ms); },
    fadeIn(o) { o = o || {}; return tween(() => fxState.fade.alpha, (v) => { fxState.fade.alpha = v; }, 0, o.ms == null ? 400 : o.ms); },
    tint(o) { o = o || {}; fxState.tint.color = o.color || '#000000'; return tween(() => fxState.tint.amount, (v) => { fxState.tint.amount = v; }, o.amount == null ? 0 : o.amount, o.ms == null ? 400 : o.ms); },
    flash(o) {
      o = o || {};
      fxState.flash.color = o.color || '#ffffff';
      fxState.flash.alpha = reduceMotion() ? 0.35 : 0.85;
      return tween(() => fxState.flash.alpha, (v) => { fxState.flash.alpha = v; }, 0, o.ms == null ? 200 : o.ms);
    },
    shake(o) {
      o = o || {};
      const ms = o.ms == null ? 400 : o.ms;
      if (reduceMotion() || instant()) return Promise.resolve();
      fxState.shake.power = o.power || 3;
      fxState.shake.left = ms;
      return new Promise(res => setTimeout(res, ms));
    },
    weather(o) {
      o = o || {};
      fxState.weather.kind = reduceMotion() ? 'none' : (o.kind || 'none');
      fxState.weather.power = o.power == null ? 5 : o.power;
      return Promise.resolve();
    },

    // pictures (the pictureShow/Move/Erase commands)
    pictures() { return pics; },
    show(o) {
      o = o || {};
      FX.erase({ id: o.id });
      const p = { id: o.id, image: o.image, x: o.x || 0, y: o.y || 0, anchor: o.anchor || 'topLeft', opacity: o.opacity == null ? 1 : o.opacity, zoom: o.zoom || 2, move: null };
      if (typeof o.image === 'string' && /^(data:|https?:|\.\/|\/)/.test(o.image) && typeof Image !== 'undefined') {
        const img = new Image();
        img.onload = () => { p.imageEl = img; };
        img.src = o.image;
      }
      pics.push(p);
      return Promise.resolve(p);
    },
    move(o) {
      o = o || {};
      const p = pics.find(q => q.id === o.id);
      if (!p) return Promise.resolve();
      const ms = instant() ? 0 : (o.ms == null ? 400 : o.ms);
      return new Promise((resolve) => {
        p.move = { t: 0, ms, fromX: p.x, fromY: p.y, toX: o.x == null ? p.x : o.x, toY: o.y == null ? p.y : o.y,
          fromO: p.opacity, toO: o.opacity == null ? p.opacity : o.opacity, done: resolve };
        if (!ms) { p.x = p.move.toX; p.y = p.move.toY; p.opacity = p.move.toO; p.move = null; resolve(); }
        else if (o.wait === false) resolve();
      });
    },
    erase(o) {
      const id = o && o.id;
      for (let i = pics.length - 1; i >= 0; i--) if (!id || pics[i].id === id) pics.splice(i, 1);
      return Promise.resolve();
    },
  };

  // ---- the stack --------------------------------------------------------------------
  const stack = [];
  const bus = KIT.events('scenes');

  function make(sceneOrId, params) {
    if (sceneOrId && typeof sceneOrId === 'object') return sceneOrId;
    const def = KIT.registry('scenes').get(String(sceneOrId));
    if (!def || typeof def.create !== 'function') throw new Error(`scenes: unknown scene '${sceneOrId}'`);
    const s = def.create(params || {});
    s.id = s.id || def.id;
    return s;
  }

  /**
   * suspend / resume (§8.6): the mirror of enter/exit for being COVERED rather
   * than closed.
   *
   *   enter   → you exist and you are on top
   *   suspend → something opened over you; you still exist and still update
   *   resume  → it closed; you are on top again
   *   exit    → you are gone
   *
   * A scene that has nothing shared to give up needs neither. One that renders
   * into a shared host (`#pause-menu`, say) or listens on the document must drop
   * that listener in `suspend` and take it back in `resume` — otherwise one tap
   * on the screen above it also reaches the stale rows underneath, which is a
   * real bug and a silent one. `scene.suspended` says which it is.
   */
  function suspend(scene, by) {
    if (!scene || scene.suspended) return;
    scene.suspended = true;
    try { if (scene.suspend) scene.suspend(by || null); }
    catch (e) { (KIT.log || console).error(`[scene ${scene.id}] suspend threw`, e); }
  }
  function resume(scene) {
    if (!scene || !scene.suspended) return;
    scene.suspended = false;
    try { if (scene.resume) scene.resume(); }
    catch (e) { (KIT.log || console).error(`[scene ${scene.id}] resume threw`, e); }
  }

  const SCENES = KIT.scenes = {
    events: bus,
    get stack() { return stack; },
    /** top() -> the scene that owns the input right now. */
    top() { return stack[stack.length - 1] || null; },
    /** ids() -> ['map','dialogue'] bottom to top (handy in tests). */
    ids() { return stack.map(s => s.id); },

    /** push(scene|id, params) -> scene */
    push(sceneOrId, params) {
      const covered = SCENES.top();
      const scene = make(sceneOrId, params);
      scene.params = params || {};
      scene._promise = scene._promise || new Promise((resolve) => { scene._resolve = resolve; });
      scene.finish = (result) => SCENES.finish(scene, result);
      stack.push(scene);
      // The scene that was on top is now underneath. A scene that listens to
      // anything shared — a DOM host, a key handler, the world bus — has to be
      // told, or it goes on answering clicks meant for whatever is over it.
      suspend(covered, scene);
      try { if (scene.enter) scene.enter(params || {}); }
      catch (e) { (KIT.log || console).error(`[scene ${scene.id}] enter threw`, e); }
      bus.emit('sceneChange', { id: scene.id, ids: SCENES.ids() });
      return scene;
    },
    /** run(scene|id, params) -> Promise<result> */
    run(sceneOrId, params) { return SCENES.push(sceneOrId, params)._promise; },
    /** pop(result) — close the top scene. */
    pop(result) {
      const scene = stack[stack.length - 1];
      if (!scene) return null;
      return SCENES.finish(scene, result);
    },
    /** finish(scene, result) — close this scene wherever it is in the stack. */
    finish(scene, result) {
      const i = stack.indexOf(scene);
      if (i < 0) return scene;
      const wasTop = i === stack.length - 1;
      stack.splice(i, 1);
      try { if (scene.exit) scene.exit(result); }
      catch (e) { (KIT.log || console).error(`[scene ${scene.id}] exit threw`, e); }
      scene.result = result;
      if (scene._resolve) scene._resolve(result);
      if (wasTop) resume(SCENES.top());
      bus.emit('sceneChange', { id: SCENES.top() ? SCENES.top().id : null, ids: SCENES.ids() });
      return scene;
    },
    /** replace(scene|id, params) — swap the top scene (the old one resolves with null). */
    replace(sceneOrId, params) {
      const old = SCENES.top();
      if (old) SCENES.finish(old, null);
      return SCENES.push(sceneOrId, params);
    },
    clear() { while (stack.length) SCENES.finish(stack[stack.length - 1], null); },

    /** update(dt) — every scene ticks (so a map keeps animating under a message), fx last. */
    update(dt) {
      for (const s of stack.slice()) {
        if (typeof s.update !== 'function') continue;
        try { s.update(dt, s === SCENES.top()); } catch (e) { (KIT.log || console).error(`[scene ${s.id}] update threw`, e); }
      }
      FX.update(dt);
    },
    /** input(ev) — only the top scene sees it. ev = { player, key }. */
    input(ev) {
      const s = SCENES.top();
      if (!s || typeof s.input !== 'function') return false;
      try { return s.input(ev) !== false; } catch (e) { (KIT.log || console).error(`[scene ${s.id}] input threw`, e); return false; }
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
