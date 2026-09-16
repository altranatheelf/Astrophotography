// mons/scenes.js — the four screens: the catch scene, the party, the Pokédex
// and the garden card.
//
// Every one of them is a registered scene (KIT.registry('scenes')), so the
// pause menu, a script command and the encounter system all open them the same
// way, and every word on them comes from the Terms table.
//
// The catch scene owns no rules: it renders KIT.mons.newCatchState and asks
// KIT.mons.applyAction what happened, which is why the test can play a whole
// catch in Node without a screen.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const M = KIT.mons = KIT.mons || {};
  const UI = KIT.ui;
  const num = (v, d) => (v == null || !Number.isFinite(Number(v)) ? d : Number(v));
  const hasDom = () => typeof document !== 'undefined' && !!document.createElement;

  // ---- the host element -------------------------------------------------------
  /**
   * One overlay element for all four screens, added under the kit's own
   * overlays: a dialogue box, a toast or a name prompt opened *on top of* the
   * catch scene has to paint above it, and DOM order is what decides.
   */
  function host() {
    let el = document.getElementById('mons-scene');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mons-scene';
      el.className = 'overlay';
      el.hidden = true;
      const screen = document.getElementById('screen') || document.body;
      const canvas = document.getElementById('game-canvas');
      if (canvas && canvas.parentNode === screen) screen.insertBefore(el, canvas.nextSibling);
      else screen.appendChild(el);
    }
    return el;
  }
  /** While somebody else's scene is on top, this overlay must not eat its taps. */
  function watchTop() {
    if (watchTop.done || !KIT.scenes || !KIT.scenes.events) return;
    watchTop.done = true;
    KIT.scenes.events.on('sceneChange', (e) => {
      const el = document.getElementById('mons-scene');
      if (!el) return;
      el.style.pointerEvents = (e && typeof e.id === 'string' && e.id.indexOf('mons-') === 0) ? 'auto' : 'none';
    });
  }
  function open(cls) {
    watchTop();
    const el = host();
    UI.clear(el);
    el.hidden = false;
    el.setAttribute('data-kind', cls || '');
    return el;
  }
  function close() { const el = document.getElementById('mons-scene'); if (el) { el.hidden = true; UI.clear(el); } }

  const make = (spec, opts) => UI.make(spec, opts);
  function hearts(n) { const h = Math.max(0, Math.min(5, n | 0)); return '♥'.repeat(h) + '♡'.repeat(5 - h); }
  function whenText(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString(); } catch (e) { return String(iso).slice(0, 10); }
  }
  /** A species portrait as a canvas; missing art is a silhouette, never a gap. */
  function portraitEl(idOrMon, scale, opts) {
    const o = opts || {};
    const mon = typeof idOrMon === 'string' ? null : idOrMon;
    const id = mon ? mon.id : idOrMon;
    let art = mon ? M.artFor(mon) : M.portrait(id);
    if (o.silhouette) art = KIT.pixels.silhouette(32, 32, '#2b3350');
    const cv = UI.artCanvas(art, scale || 2, M.speciesColor(id));
    cv.className = 'mons-portrait' + (o.class ? ' ' + o.class : '');
    return cv;
  }
  function typeChips(id) {
    const wrap = make('div.mons-types');
    for (const t of ((M.species(id) || {}).types || [])) {
      const chip = make('span.mons-type', { text: t });
      chip.style.background = M.typeColor(t);
      wrap.appendChild(chip);
    }
    return wrap;
  }
  const t = (project, id, vars) => M.t(project, id, vars);
  /**
   * A profile's action label is a Terms id when one is registered (so it can be
   * reworded), and literal text otherwise (so a re-themed profile can just say
   * what it means).
   */
  function labelText(project, value, fallback) {
    if (!value) return fallback || '';
    const registered = KIT.registry.exists('strings') && KIT.registry('strings').has(value);
    const overridden = !!(project && project.strings && typeof project.strings[value] === 'string');
    return (registered || overridden) ? M.t(project, value) : String(value);
  }

  // ---- styles -----------------------------------------------------------------
  const CSS = `
#mons-scene { display: flex; align-items: center; justify-content: center; padding: 10px; pointer-events: auto; background: rgba(6,7,12,.62); }
#mons-scene[hidden] { display: none; }
#mons-scene[data-kind="catch"] { background: rgba(6,7,12,.72); flex-direction: column; justify-content: space-between; padding: 8px; }
.mons-portrait { image-rendering: pixelated; display: block; }
.mons-types { display: flex; gap: 4px; flex-wrap: wrap; padding: 2px 0; }
.mons-catch-top .mons-types { justify-content: center; }
.mons-type { font-family: var(--font-ui); font-size: 8px; color: #fff; padding: 3px 6px; border-radius: 999px; text-shadow: 0 1px 0 rgba(0,0,0,.4); }
.mons-catch-top { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 6px; padding-top: 6px; }
.mons-catch-name { font-family: var(--font-ui); font-size: clamp(10px,3vw,14px); color: #ffe9a8; text-shadow: 0 2px 0 #5a3c00; }
.mons-new { font-family: var(--font-ui); font-size: 8px; background: var(--accent, #f8c83c); color: #2a1d00; padding: 3px 6px; border-radius: 999px; margin-left: 6px; }
.mons-stage { position: relative; flex: 1 1 auto; width: 100%; display: flex; align-items: center; justify-content: center; }
.mons-bob { animation: mons-bob 1.4s ease-in-out infinite; }
@keyframes mons-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
.mons-ball { position: absolute; width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(#e8503c 0 48%, #2b2b3a 48% 54%, #f4f4f8 54% 100%); border: 2px solid #2b2b3a; bottom: 6px; left: 50%; transform: translateX(-50%); }
.mons-ball.is-thrown { transition: transform .45s ease-out, bottom .45s ease-out; }
.mons-ball.is-wobble { animation: mons-wobble .42s ease-in-out; }
@keyframes mons-wobble { 0%,100% { transform: translateX(-50%) rotate(0); } 30% { transform: translateX(-50%) rotate(-22deg); } 70% { transform: translateX(-50%) rotate(22deg); } }
.mons-ring { position: absolute; border: 3px solid #ffffff; border-radius: 50%; opacity: .9; pointer-events: none; }
.mons-band { position: absolute; border: 3px solid rgba(126, 224, 138, .35); border-radius: 50%; box-sizing: content-box; pointer-events: none; }
.mons-catch-bottom { width: 100%; display: flex; flex-direction: column; gap: 6px; }
.mons-msg { background: rgba(10,11,16,.85); color: #fff; border-radius: 8px; padding: 8px 10px; font-size: 14px; min-height: 1.4em; text-align: center; }
.mons-acts { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.mons-acts .kit-uibtn { background: var(--paper, #f4f6fc); justify-content: center; min-height: 44px; }
.mons-acts .kit-uibtn.is-selected { background: #eaf0ff; border-color: #3b4b8a; }
.mons-acts .kit-uibtn.is-empty { opacity: .5; }
.mons-acts .kit-uibtn.mons-tap { grid-column: 1 / -1; min-height: 56px; background: #2f7d45; color: #fff; border-color: #7ee08a; }
.mons-panel { background: var(--paper, #f4f6fc); color: var(--ink, #23243a); border: 3px solid #2b2b3a; border-radius: 10px; box-shadow: inset 0 0 0 2px #dfe3ef, 0 6px 0 rgba(0,0,0,.35); padding: 10px; width: min(460px, 96%); max-height: 94%; display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
/* The panel is a column: everything keeps its size, the one scrolling part
   takes whatever height is left, so the detail and the buttons never move. */
.mons-panel > * { flex: 0 0 auto; }
.mons-panel > .mons-scroll { flex: 1 1 auto; overflow: auto; min-height: 112px; }
.mons-scroll > * { flex: 0 0 auto; }
.mons-row-btn { width: 100%; align-items: center; padding: 6px 8px; }
.mons-row-btn.is-selected { background: #eaf0ff; border-color: #3b4b8a; }
.mons-head { display: flex; align-items: center; gap: 8px; padding-bottom: 8px; }
.mons-head .mons-title { font-family: var(--font-ui); font-size: 11px; color: #3b4b8a; flex: 1 1 auto; }
.mons-count { font-family: var(--font-ui); font-size: 9px; color: #3b4b8a; opacity: .8; }
.mons-row { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; }
.mons-row .mons-portrait { border: 2px solid #2b2b3a; border-radius: 6px; background: #e9edf8; }
.mons-row-body { flex: 1 1 auto; min-width: 0; }
.mons-row-name { font-size: 15px; }
.mons-row-sub { font-size: 12px; opacity: .7; }
.mons-hearts { color: #d8465c; letter-spacing: 1px; font-size: 13px; }
.mons-section { font-family: var(--font-ui); font-size: 9px; color: #3b4b8a; padding: 10px 4px 4px; }
.mons-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(62px, 1fr)); gap: 6px; }
.mons-tier { font-family: var(--font-ui); font-size: 9px; color: #3b4b8a; }
.mons-mood { font-size: 12px; opacity: .7; }
.mons-cell { border: 2px solid transparent; border-radius: 8px; padding: 4px; background: #e9edf8; display: flex; flex-direction: column; align-items: center; gap: 2px; cursor: pointer; }
.mons-cell.is-selected { border-color: #3b4b8a; background: #dfe8ff; }
.mons-cell-num { font-family: var(--font-ui); font-size: 7px; opacity: .6; }
.mons-cell-name { font-size: 10px; text-align: center; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.mons-cell.is-unseen { opacity: .45; }
.mons-detail { display: flex; gap: 10px; align-items: flex-start; padding: 6px 2px; }
.mons-detail .mons-portrait { border: 2px solid #2b2b3a; border-radius: 8px; background: #e9edf8; }
.mons-blurb { font-size: 13px; line-height: 1.45; }
.mons-meta { font-size: 12px; opacity: .75; padding-top: 4px; }
.mons-actions { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; padding-top: 8px; }
.mons-actions .kit-uibtn { justify-content: center; border: 2px solid #c9d2ea; }
.mons-actions .kit-uibtn.is-selected { border-color: #3b4b8a; background: #eaf0ff; }
.mons-heart-float { position: absolute; font-size: 22px; color: #d8465c; animation: mons-float 1s ease-out forwards; pointer-events: none; }
@keyframes mons-float { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-46px); opacity: 0; } }
.mons-shiny { color: #c88a2a; font-family: var(--font-ui); font-size: 8px; }
@media (max-width: 420px) { .mons-acts { grid-template-columns: 1fr 1fr; } }
`;
  function injectStyle() {
    if (!hasDom() || document.getElementById('mons-style')) return;
    const el = document.createElement('style');
    el.id = 'mons-style';
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  // ---- a tiny keyboard list helper ---------------------------------------------
  function listNav(items, index, key, columns) {
    const n = items.length;
    if (!n) return index;
    const cols = columns || 1;
    if (key === 'up') return (index - cols + n * 2) % n;
    if (key === 'down') return (index + cols) % n;
    if (key === 'left') return (index - 1 + n) % n;
    if (key === 'right') return (index + 1) % n;
    return index;
  }
  function markSelected(nodes, index) { nodes.forEach((el, i) => el.classList.toggle('is-selected', i === index)); const s = nodes[index]; if (s && s.scrollIntoView) s.scrollIntoView({ block: 'nearest' }); }

  // ---- the catch scene -----------------------------------------------------------
  function catchScene() {
    let el = null, game = null, project = null, ctx = null;
    let state = null, phase = 'intro', acts = [], actIndex = 0;
    let ringT = 0, ringLoops = 0, band = null, tapped = null;
    let nodes = { msg: null, actions: null, stage: null, ring: null, ball: null, portrait: null, balls: null };
    let scene = null;
    let waiting = null;                          // resolve for a "press to continue"

    const instant = () => !!KIT.fx.instant;
    const sleep = (ms) => new Promise(res => setTimeout(res, instant() ? Math.min(12, ms) : ms));

    function itemCount(id) { const inv = (M.saveOf(ctx).inventory) || {}; return num(inv[id], 0); }
    function spend(id, n) { try { KIT.commands.state.give(ctx, id, -(n || 1)); } catch (e) { /* no ctx: nothing to spend */ } }

    function say(text) { if (nodes.msg) nodes.msg.textContent = text; }
    function actionLabel(a) { return labelText(project, a && a.label, a && a.id); }
    /** The profile decides the words; M.line falls back to the registered default. */
    function pline(key, vars) { return M.line(project, state.profile, key, vars); }

    function build() {
      el = open('catch');
      const sp = M.species(state.species) || { name: state.species, types: [] };
      const top = make('div.mons-catch-top');
      const nameRow = make('div.mons-catch-name', { text: sp.name + (state.shiny ? ' ✦' : '') });
      if (scene.params && scene.params.isNew) nameRow.appendChild(make('span.mons-new', { text: t(project, 'mons-new-mark') }));
      top.appendChild(nameRow);
      top.appendChild(typeChips(state.species));
      el.appendChild(top);

      const stage = make('div.mons-stage');
      const art = state.shiny ? M.shinyArt(M.portrait(state.species)) : M.portrait(state.species);
      const cv = UI.artCanvas(art, num(state.profile.art.scale, 4), M.speciesColor(state.species));
      cv.className = 'mons-portrait mons-bob';
      stage.appendChild(cv);
      nodes.portrait = cv;
      nodes.stage = stage;
      el.appendChild(stage);

      const bottom = make('div.mons-catch-bottom');
      nodes.msg = make('div.mons-msg', { text: '' });
      bottom.appendChild(nodes.msg);
      nodes.actions = make('div.mons-acts');
      bottom.appendChild(nodes.actions);
      el.appendChild(bottom);

      scene._off = UI.onAction(el, (action) => {
        if (action === 'ring-tap') { doTap(); return; }
        if (action === 'continue') { const w = waiting; waiting = null; if (w) w(); return; }
        if (action.slice(0, 4) === 'act:') { actIndex = acts.findIndex(a => a.id === action.slice(4)); runAction(acts[actIndex]); }
      });
    }

    function paintActions() {
      UI.clear(nodes.actions);
      acts = (state.profile.actions || []).filter(a => a && a.kind !== 'hidden');
      acts.forEach((a, i) => {
        const b = UI.button('act:' + a.id, actionLabel(a));
        if (a.item) {
          const n = itemCount(a.item);
          b.appendChild(make('span.kit-item-value', { text: '×' + n }));
          if (n < 1) b.classList.add('is-empty');
        }
        nodes.actions.appendChild(b);
      });
      markSelected(Array.from(nodes.actions.children), actIndex);
    }

    function showRing() {
      phase = 'ring';
      ringT = 1; ringLoops = 0; tapped = null;
      band = M.ringBand(state.profile.art, state.calm);
      UI.clear(nodes.actions);
      const b = UI.button('ring-tap', t(project, 'mons-tap-ring'), 'mons-tap');
      nodes.actions.appendChild(b);
      // The green band is drawn as a thick ring, so "in the green" is literal:
      // its inner edge is (centre - width), its outer edge is (centre + width).
      const size = Math.min(nodes.stage.clientWidth || 200, nodes.stage.clientHeight || 160);
      const bandEl = make('div.mons-band');
      const inner = Math.max(6, size * Math.max(0, band.center - band.width));
      const thick = Math.max(3, size * band.width);
      bandEl.style.width = inner + 'px'; bandEl.style.height = inner + 'px';
      bandEl.style.borderWidth = thick + 'px';
      const ring = make('div.mons-ring');
      nodes.stage.appendChild(bandEl);
      nodes.stage.appendChild(ring);
      nodes.ring = ring;
      nodes.bandEl = bandEl;
      paintRing(size);
      if (instant()) doTap();
    }
    function paintRing(size) {
      if (!nodes.ring) return;
      const s = size || Math.min(nodes.stage.clientWidth || 200, nodes.stage.clientHeight || 160);
      const d = Math.max(8, s * ringT);
      nodes.ring.style.width = d + 'px';
      nodes.ring.style.height = d + 'px';
      const q = M.ringQuality(ringT, band);
      nodes.ring.style.borderColor = q === 'miss' ? '#ffffff' : q === 'ok' ? '#cfe8a0' : '#7ee08a';
    }
    function clearRing() {
      if (nodes.ring && nodes.ring.parentNode) nodes.ring.parentNode.removeChild(nodes.ring);
      if (nodes.bandEl && nodes.bandEl.parentNode) nodes.bandEl.parentNode.removeChild(nodes.bandEl);
      nodes.ring = null; nodes.bandEl = null;
    }

    function doTap() {
      if (phase !== 'ring' || tapped) return;
      tapped = M.ringQuality(ringT, band);
      clearRing();
      phase = 'anim';
      throwBall(tapped).catch(e => (KIT.log || console).error('[mons] throw', e));
    }

    async function throwBall(quality) {
      const act = acts.find(a => a.kind === 'throw') || { kind: 'throw', item: M.pack(project).ball };
      say(pline(quality));
      KIT.audio.play(quality === 'perfect' ? 'sparkle' : 'select');
      const ball = make('div.mons-ball');
      nodes.stage.appendChild(ball);
      await sleep(40);
      ball.classList.add('is-thrown');
      ball.style.bottom = '46%';
      await sleep(num(state.profile.art.throwMs, 520));
      if (nodes.portrait) nodes.portrait.style.opacity = '0.15';

      const event = M.applyAction(state, act, {
        rng: (ctx && ctx.rng) || Math.random,
        quality,
        items: (M.saveOf(ctx).inventory) || {},
      });
      if (event.kind === 'blocked') {
        ball.remove();
        if (nodes.portrait) nodes.portrait.style.opacity = '1';
        await message(pline(event.reason === 'no-balls' ? 'noBalls' : 'noItem'));
        phase = 'menu'; paintActions();
        return;
      }
      spend(act.item, 1);

      for (let i = 0; i < event.wobbles; i++) {
        ball.classList.remove('is-wobble');
        void ball.offsetWidth;
        ball.classList.add('is-wobble');
        KIT.audio.play('blip');
        say(pline('wobble'));
        await sleep(num(state.profile.art.wobbleMs, 460));
      }

      if (event.caught) {
        KIT.audio.play('sparkle');
        await finishCaught();
        return;
      }
      ball.remove();
      if (nodes.portrait) nodes.portrait.style.opacity = '1';
      await message(pline('broke'));
      if (event.fled) { await fleeAway(); return; }
      phase = 'menu';
      paintActions();
    }

    async function finishCaught() {
      const section = M.sectionOf(ctx);
      const name = M.speciesName(state.species);
      await message(pline('gotcha', { name }));
      const r = await M.grant(ctx, {
        species: state.species, shiny: state.shiny, friendship: 20,
        ask: true, notify: false,
      });
      state.mon = r ? r.mon : null;
      if (r) {
        await message(t(project, r.where === 'party' ? 'mons-joined' : 'mons-joined-garden', { name: M.displayName(r.mon, project) }));
      }
      scene.finish({ caught: true, mon: r ? r.mon : null, species: state.species });
    }

    async function fleeAway() {
      await message(pline('fled', { name: M.speciesName(state.species) }));
      scene.finish({ caught: false, fled: true, species: state.species });
    }

    /** message(text) — show it and wait for the player (or a beat, when instant). */
    function message(text) {
      say(text);
      phase = 'message';
      UI.clear(nodes.actions);
      nodes.actions.appendChild(UI.button('continue', t(project, 'continue'), 'mons-tap'));
      if (instant()) return sleep(10);
      return new Promise(res => { waiting = res; });
    }

    async function runAction(a) {
      if (!a || phase !== 'menu') return;
      if (a.kind === 'throw') {
        if (itemCount(a.item) < 1) { await message(pline('noBalls')); phase = 'menu'; paintActions(); return; }
        showRing();
        return;
      }
      const event = M.applyAction(state, a, { rng: (ctx && ctx.rng) || Math.random, items: (M.saveOf(ctx).inventory) || {} });
      if (event.kind === 'blocked') { await message(pline('noItem')); phase = 'menu'; paintActions(); return; }
      if (event.kind === 'leave') { scene.finish({ caught: false, left: true, species: state.species }); return; }
      if (event.kind === 'calm') {
        spend(a.item, 1);
        KIT.audio.play('item');
        await message(pline(event.guarantee ? 'golden' : 'calmed', { name: M.speciesName(state.species) }));
      } else if (event.kind === 'talk') {
        KIT.audio.play('blip');
        await message(pline(event.became ? 'curious' : 'talk', { name: M.speciesName(state.species) }));
      }
      phase = 'menu';
      paintActions();
    }

    scene = {
      id: 'mons-catch', transparent: true, pausesWorld: true,
      enter(params) {
        injectStyle();
        game = (params && params.game) || KIT.game;
        ctx = (params && params.ctx) || null;
        project = (params && params.project) || (ctx && ctx.project) || (game && game.project) || null;
        state = M.newCatchState({ species: params.species, shiny: params.shiny, project, profile: M.profile(project, params.profile) });
        const section = M.sectionOf(ctx || { world: game && game.world, project });
        M.see(section, state.species);
        build();
        phase = 'menu';
        say(pline(params.isNew ? 'appearedNew' : 'appeared', { name: M.speciesName(state.species) }));
        paintActions();
      },
      exit() { clearRing(); close(); if (scene._off) scene._off(); },
      update(dt) {
        if (phase !== 'ring') return;
        ringT -= dt * num(band.speed, 0.62);
        if (ringT <= 0.02) {
          ringT = 1;
          ringLoops++;
          if (ringLoops >= 3) { doTap(); return; }
        }
        paintRing();
      },
      input(ev) {
        if (phase === 'ring') { if (ev.key === 'a' || ev.key === 'b') doTap(); return true; }
        if (phase === 'message') { if (ev.key === 'a' || ev.key === 'b') { const w = waiting; waiting = null; if (w) w(); } return true; }
        if (phase !== 'menu') return true;
        if (['up', 'down', 'left', 'right'].includes(ev.key)) {
          actIndex = listNav(acts, actIndex, ev.key, 2);
          markSelected(Array.from(nodes.actions.children), actIndex);
          KIT.audio.play('blip');
          return true;
        }
        if (ev.key === 'a') { runAction(acts[actIndex]); return true; }
        if (ev.key === 'b' || ev.key === 'menu') {
          const leave = acts.find(a => a.kind === 'leave');
          if (leave) runAction(leave); else scene.finish({ caught: false, left: true });
          return true;
        }
        return true;
      },
      // the test hooks: drive the scene without a pointer
      _state: () => state,
      _tap: (position) => { if (phase === 'ring') { ringT = position == null ? ringT : position; doTap(); } },
    };
    return scene;
  }

  /** openCatch(ctx, opts) — actions.js calls this when there is a screen. */
  M.openCatch = function (ctx, opts) {
    if (!hasDom() || !KIT.scenes) return Promise.resolve({ ok: false, reason: 'no-screen' });
    return KIT.scenes.run('mons-catch', {
      species: opts.species, shiny: opts.shiny, profile: opts.profile, isNew: opts.isNew,
      ctx, project: ctx && ctx.project, game: KIT.game,
    });
  };

  // ---- the party -------------------------------------------------------------------
  function partyScene() {
    let el = null, game = null, project = null, index = 0, rows = [], scene = null, detail = null;

    function section() { return M.section((game && game.world && game.world.save) || {}); }

    function build() {
      el = open('party');
      const s = section();
      const panel = make('div.mons-panel');
      const head = make('div.mons-head');
      head.appendChild(make('div.mons-title', { text: t(project, 'mons-party-title') }));
      const counts = M.dexCounts(s);
      head.appendChild(make('div.mons-count', { text: t(project, 'mons-dex-count', counts) }));
      panel.appendChild(head);

      rows = [];
      const list = make('div.kit-list.mons-scroll');
      const party = s.party || [];
      const box = s.box || [];
      if (!party.length && !box.length) {
        panel.appendChild(make('p.kit-hint', { text: t(project, 'mons-party-empty') }));
      }
      if (party.length) list.appendChild(make('div.mons-section', { text: t(project, 'mons-in-party') }));
      party.forEach(mon => list.appendChild(row(mon, 'party')));
      if (box.length) list.appendChild(make('div.mons-section', { text: t(project, 'mons-in-garden') }));
      box.forEach(mon => list.appendChild(row(mon, 'box')));
      panel.appendChild(list);

      detail = make('div.mons-detail-host');
      panel.appendChild(detail);

      const foot = make('div.kit-row');
      foot.appendChild(UI.button('close', t(project, 'mons-close'), 'is-primary'));
      panel.appendChild(foot);
      panel.appendChild(make('p.kit-hint', { text: t(project, 'mons-party-hint') }));
      el.appendChild(panel);

      markSelected(rows.map(r => r.el), index);
      paintDetail();

      if (scene._off) scene._off();
      scene._off = UI.onAction(el, (action, node) => {
        if (action === 'close') { scene.finish(null); return; }
        if (action.slice(0, 4) === 'row:') {
          index = rows.findIndex(r => r.mon.uid === action.slice(4));
          markSelected(rows.map(r => r.el), index);
          paintDetail();
          return;
        }
        if (action.slice(0, 4) === 'do:') handle(action.slice(4));
      });
    }

    function row(mon, where) {
      const s = section();
      const b = make('button.kit-uibtn.mons-row-btn');
      b.type = 'button';
      b.setAttribute('data-action', 'row:' + mon.uid);
      b.setAttribute('data-index', String(rows.length));
      const inner = make('div.mons-row');
      inner.appendChild(portraitEl(mon, 2));
      const body = make('div.mons-row-body');
      const nameLine = make('div.mons-row-name', { text: M.displayName(mon, project) });
      if (mon.shiny) nameLine.appendChild(make('span.mons-shiny', { text: ' ' + t(project, 'mons-shiny') }));
      body.appendChild(nameLine);
      body.appendChild(make('div.mons-hearts', { text: hearts(M.friendshipTier(mon.friendship).hearts) }));
      const day = ((game && game.world && game.world.save && game.world.save.clock) || {}).day || 1;
      body.appendChild(make('div.mons-row-sub', {
        text: M.speciesName(mon.id) + ' · ' + M.moodLabel(project, mon, { day, project, save: (game && game.world && game.world.save) || null }) +
          (s.follower === mon.uid ? ' · ' + t(project, 'mons-following') : ''),
      }));
      inner.appendChild(body);
      b.appendChild(inner);
      rows.push({ el: b, mon, where });
      return b;
    }

    function paintDetail() {
      UI.clear(detail);
      const r = rows[index];
      if (!r) return;
      const mon = r.mon;
      const sp = M.species(mon.id) || {};
      const box = make('div.mons-detail');
      box.appendChild(portraitEl(mon, 2));
      const body = make('div');
      body.appendChild(typeChips(mon.id));
      body.appendChild(make('div.mons-blurb', { text: sp.blurb || '' }));
      body.appendChild(make('div.mons-meta', {
        text: t(project, 'mons-met-at', { where: mon.metAt || t(project, 'mons-met-unknown'), when: whenText(mon.caughtAt && mon.caughtAt.date) }) +
          ' · ' + t(project, M.friendshipTier(mon.friendship).label) + ' (' + mon.friendship + '/255)',
      }));
      box.appendChild(body);
      detail.appendChild(box);

      const acts = make('div.mons-actions');
      const s = section();
      if (r.where === 'party') {
        acts.appendChild(UI.button('do:up', t(project, 'mons-move-up')));
        acts.appendChild(UI.button('do:down', t(project, 'mons-move-down')));
        acts.appendChild(UI.button('do:follow', t(project, s.follower === mon.uid ? 'mons-following' : 'mons-follow')));
        acts.appendChild(UI.button('do:garden', t(project, 'mons-send-garden')));
      } else {
        acts.appendChild(UI.button('do:take', t(project, 'mons-take-along')));
      }
      detail.appendChild(acts);
    }

    function handle(what) {
      const r = rows[index];
      if (!r) return;
      const s = section();
      const mon = r.mon;
      if (what === 'up') M.reorder(s, mon.uid, -1);
      else if (what === 'down') M.reorder(s, mon.uid, 1);
      else if (what === 'follow') M.setFollower(s, mon.uid);
      else if (what === 'garden') { M.move(s, mon.uid, 'box'); KIT.toast(t(project, 'mons-sent-garden', { name: M.displayName(mon, project) })); }
      else if (what === 'take') {
        if (M.partyFull(s)) { KIT.toast(t(project, 'mons-party-full')); return; }
        M.move(s, mon.uid, 'party');
        KIT.toast(t(project, 'mons-taken-along', { name: M.displayName(mon, project) }));
      }
      KIT.audio.play('select');
      M.changed({ world: game && game.world, project }, { kind: 'party' });
      const uid = mon.uid;
      build();
      const i = rows.findIndex(x => x.mon.uid === uid);
      if (i >= 0) { index = i; markSelected(rows.map(x => x.el), index); paintDetail(); }
    }

    scene = {
      id: 'mons-party', transparent: true, pausesWorld: true,
      enter(params) {
        injectStyle();
        game = (params && params.game) || KIT.game;
        project = (params && params.project) || (game && game.project) || null;
        index = 0;
        build();
      },
      exit() { close(); if (scene._off) scene._off(); },
      input(ev) {
        if (ev.key === 'up' || ev.key === 'down') {
          if (!rows.length) return true;
          index = listNav(rows, index, ev.key, 1);
          markSelected(rows.map(r => r.el), index);
          paintDetail();
          KIT.audio.play('blip');
          return true;
        }
        if (ev.key === 'b' || ev.key === 'menu') { scene.finish(null); return true; }
        return true;
      },
    };
    return scene;
  }

  // ---- the Pokédex ---------------------------------------------------------------
  function dexScene() {
    let el = null, game = null, project = null, index = 0, cells = [], scene = null, detail = null, all = [];

    function section() { return M.section((game && game.world && game.world.save) || {}); }

    function build() {
      el = open('dex');
      const s = section();
      all = M.speciesList();
      const panel = make('div.mons-panel');
      const head = make('div.mons-head');
      head.appendChild(make('div.mons-title', { text: t(project, 'mons-dex-title') }));
      head.appendChild(make('div.mons-count', { text: t(project, 'mons-dex-count', M.dexCounts(s)) }));
      panel.appendChild(head);

      detail = make('div.mons-detail-host');
      panel.appendChild(detail);

      const grid = make('div.mons-grid.mons-scroll');
      cells = [];
      all.forEach(sp => {
        const seen = !!(s.dex && s.dex.seen && s.dex.seen[sp.id]);
        const caught = !!(s.dex && s.dex.caught && s.dex.caught[sp.id]);
        const cell = make('div.mons-cell' + (seen ? '' : '.is-unseen'));
        cell.setAttribute('data-action', 'cell:' + sp.id);
        cell.setAttribute('data-index', String(cells.length));
        cell.appendChild(portraitEl(sp.id, 1, { silhouette: !caught }));
        cell.appendChild(make('div.mons-cell-num', { text: '#' + String(sp.dex).padStart(3, '0') }));
        cell.appendChild(make('div.mons-cell-name', { text: seen ? sp.name : '???' }));
        grid.appendChild(cell);
        cells.push({ el: cell, sp, seen, caught });
      });
      panel.appendChild(grid);

      const foot = make('div.kit-row');
      foot.appendChild(UI.button('close', t(project, 'mons-close'), 'is-primary'));
      panel.appendChild(foot);
      el.appendChild(panel);

      markSelected(cells.map(c => c.el), index);
      paintDetail();
      if (scene._off) scene._off();
      scene._off = UI.onAction(el, (action) => {
        if (action === 'close') { scene.finish(null); return; }
        if (action.slice(0, 5) === 'cell:') {
          index = cells.findIndex(c => c.sp.id === action.slice(5));
          markSelected(cells.map(c => c.el), index);
          paintDetail();
        }
      });
    }

    function paintDetail() {
      UI.clear(detail);
      const c = cells[index];
      if (!c) return;
      const s = section();
      const box = make('div.mons-detail');
      box.appendChild(portraitEl(c.sp.id, 3, { silhouette: !c.caught }));
      const body = make('div');
      // an unmet species does not give away how rare it is
      body.appendChild(make('div.mons-row-name', { text: c.seen ? (c.sp.name + ' · ' + M.rarityLabel(project, c.sp.id)) : '???' }));
      if (c.seen) body.appendChild(typeChips(c.sp.id));
      body.appendChild(make('div.mons-blurb', { text: c.seen ? (c.sp.blurb || '') : t(project, 'mons-dex-unseen') }));
      const entry = s.dex && s.dex.caught ? s.dex.caught[c.sp.id] : null;
      if (entry) {
        body.appendChild(make('div.mons-meta', {
          text: t(project, 'mons-met-at', { where: entry.where || t(project, 'mons-met-unknown'), when: whenText(entry.date) }) + ' · ×' + (entry.count || 1),
        }));
      }
      box.appendChild(body);
      detail.appendChild(box);
    }

    scene = {
      id: 'mons-dex', transparent: true, pausesWorld: true,
      enter(params) {
        injectStyle();
        game = (params && params.game) || KIT.game;
        project = (params && params.project) || (game && game.project) || null;
        index = 0;
        build();
      },
      exit() { close(); if (scene._off) scene._off(); },
      input(ev) {
        if (['up', 'down', 'left', 'right'].includes(ev.key)) {
          index = listNav(cells, index, ev.key, 5);
          markSelected(cells.map(c => c.el), index);
          paintDetail();
          return true;
        }
        if (ev.key === 'b' || ev.key === 'menu') { scene.finish(null); return true; }
        return true;
      },
    };
    return scene;
  }

  // ---- the garden card ------------------------------------------------------------
  function cardScene() {
    let el = null, game = null, project = null, uid = null, scene = null, acts = [], index = 0, msg = null;

    function section() { return M.section((game && game.world && game.world.save) || {}); }
    function mon() { return M.find(section(), uid); }

    function build() {
      el = open('card');
      const m = mon();
      if (!m) { scene.finish(null); return; }
      const s = section();
      const panel = make('div.mons-panel');
      const head = make('div.mons-head');
      head.appendChild(make('div.mons-title', { text: M.displayName(m, project) + (m.shiny ? ' ✦' : '') }));
      panel.appendChild(head);

      const box = make('div.mons-detail');
      box.appendChild(portraitEl(m, 3));
      const body = make('div');
      body.appendChild(make('div.mons-row-name', { text: M.speciesName(m.id) }));
      body.appendChild(typeChips(m.id));
      const tier = M.friendshipTier(m.friendship);
      const heartRow = make('div.mons-row');
      heartRow.appendChild(make('span.mons-hearts', { text: hearts(tier.hearts) }));
      heartRow.appendChild(make('span.mons-tier', { text: t(project, tier.label) }));
      body.appendChild(heartRow);
      const day = ((game && game.world && game.world.save && game.world.save.clock) || {}).day || 1;
      body.appendChild(make('div.mons-mood', { text: M.moodLabel(project, m, { day, project, save: (game && game.world && game.world.save) || null }) }));
      body.appendChild(make('div.mons-meta', {
        text: t(project, 'mons-met-at', { where: m.metAt || t(project, 'mons-met-unknown'), when: whenText(m.caughtAt && m.caughtAt.date) }),
      }));
      box.appendChild(body);
      panel.appendChild(box);

      msg = make('div.mons-meta', { text: '' });
      panel.appendChild(msg);

      const inParty = (s.party || []).some(x => x.uid === uid);
      acts = [
        { id: 'pet', label: t(project, 'mons-pet') },
        { id: 'berry', label: t(project, 'mons-give-berry') },
        inParty ? { id: 'leave', label: t(project, 'mons-leave-here') } : { id: 'take', label: t(project, 'mons-take-along') },
        { id: 'close', label: t(project, 'mons-close') },
      ];
      const row = make('div.mons-actions');
      acts.forEach(a => row.appendChild(UI.button('do:' + a.id, a.label)));
      panel.appendChild(row);
      el.appendChild(panel);
      markSelected(Array.from(row.children), index);
      scene._acts = row;

      if (scene._off) scene._off();
      scene._off = UI.onAction(el, (action) => { if (action.slice(0, 3) === 'do:') handle(action.slice(3)); });
    }

    /**
     * Say out loud that somebody was looked after. A module that keeps how a
     * friend is feeling (the home module does) listens for this; nothing here
     * knows or cares whether anybody is.
     */
    function cared(who, what) {
      const world = game && game.world;
      if (!world || !world.events) return;
      world.events.emit('friendCared', { uid: who, what, at: Date.now() });
    }

    function floatHeart() {
      const h = make('div.mons-heart-float', { text: '♥' });
      h.style.left = '46%';
      h.style.top = '30%';
      el.appendChild(h);
      setTimeout(() => { if (h.parentNode) h.parentNode.removeChild(h); }, 1100);
    }

    function handle(what) {
      const s = section();
      const m = mon();
      if (!m) { scene.finish(null); return; }
      const pack = M.pack(project);
      if (what === 'close') { scene.finish(null); return; }
      if (what === 'pet') {
        const gained = M.pet(s, uid, { bonus: num(pack.petBonus, 3) });
        if (gained > 0) { floatHeart(); KIT.audio.play('sparkle'); msg.textContent = t(project, 'mons-pet-done', { name: M.displayName(m, project) }); cared(uid, 'petted'); }
        else msg.textContent = t(project, 'mons-pet-again', { name: M.displayName(m, project) });
      } else if (what === 'berry') {
        const save = (game && game.world && game.world.save) || {};
        const inv = save.inventory || {};
        const berry = (m.favouriteBerry && num(inv[m.favouriteBerry], 0) > 0) ? m.favouriteBerry
          : (num(inv[pack.berry], 0) > 0 ? pack.berry : null);
        if (!berry) { msg.textContent = t(project, 'mons-no-berries'); return; }
        const ctx = (game && game.world) ? game.world.makeCtx(null, game.world.hero() ? game.world.hero().id : 'p1') : { world: { save }, project };
        KIT.commands.state.give(ctx, berry, -1);
        const gained = M.giveBerry(s, uid, { bonus: num(pack.berryBonus, 10), favourite: num(pack.favouriteBerryBonus, 5), item: berry });
        floatHeart();
        KIT.audio.play('item');
        msg.textContent = t(project, berry === m.favouriteBerry ? 'mons-berry-favourite' : 'mons-berry-given', { name: M.displayName(m, project), n: gained });
        cared(uid, 'fed');
      } else if (what === 'take') {
        if (M.partyFull(s)) { msg.textContent = t(project, 'mons-party-full'); return; }
        M.move(s, uid, 'party');
        msg.textContent = t(project, 'mons-taken-along', { name: M.displayName(m, project) });
      } else if (what === 'leave') {
        M.move(s, uid, 'box');
        msg.textContent = t(project, 'mons-sent-garden', { name: M.displayName(m, project) });
      }
      M.changed({ world: game && game.world, project }, { kind: 'card', uid });
      const keep = index;
      const text = msg.textContent;
      build();
      index = Math.min(keep, acts.length - 1);
      markSelected(Array.from(scene._acts.children), index);
      msg.textContent = text;
    }

    scene = {
      id: 'mons-card', transparent: true, pausesWorld: true,
      enter(params) {
        injectStyle();
        game = (params && params.game) || KIT.game;
        project = (params && params.project) || (game && game.project) || null;
        uid = params && params.uid;
        index = 0;
        build();
      },
      exit() { close(); if (scene._off) scene._off(); },
      input(ev) {
        if (['up', 'down', 'left', 'right'].includes(ev.key)) {
          index = listNav(acts, index, ev.key, 2);
          markSelected(Array.from(scene._acts.children), index);
          return true;
        }
        if (ev.key === 'a') { handle(acts[index].id); return true; }
        if (ev.key === 'b' || ev.key === 'menu') { scene.finish(null); return true; }
        return true;
      },
    };
    return scene;
  }

  /** registerScenes() — the four screens and the two pause-menu entries. */
  M.registerScenes = function () {
    if (!KIT.registry.exists('scenes')) return;
    const scenes = KIT.registry('scenes');
    scenes.add({ id: 'mons-catch', name: 'Catching', replace: true, create: catchScene });
    scenes.add({ id: 'mons-party', name: 'Pokémon', replace: true, create: partyScene });
    scenes.add({ id: 'mons-dex', name: 'Pokédex', replace: true, create: dexScene });
    scenes.add({ id: 'mons-card', name: 'Pokémon card', replace: true, create: cardScene });

    // A menu label is a function of the game, so the Terms table can reword it
    // without a reload and a translation is a project edit rather than a code one.
    const menus = KIT.registry('menus');
    // The pause menu, in one order across every module the demo ships:
    //   10 Party · 12 Pokédex · 14 Jobs · 16 Decorate · then the kit's own
    //   Save (20), Two players (30), Settings (40)…
    menus.add({
      id: 'mons-party', order: 10, replace: true,
      label: (game) => M.t(game && game.project, 'mons-menu-party'),
      value: (game) => { const s = M.read((game && game.world && game.world.save) || {}); const n = (s.party || []).length; return n ? String(n) : ''; },
      async open(game) { await KIT.scenes.run('mons-party', { game, project: game && game.project }); return null; },
    });
    menus.add({
      id: 'mons-dex', order: 12, replace: true,
      label: (game) => M.t(game && game.project, 'mons-menu-dex'),
      value: (game) => { const s = M.read((game && game.world && game.world.save) || {}); return String(M.dexCounts(s).caught); },
      async open(game) { await KIT.scenes.run('mons-dex', { game, project: game && game.project }); return null; },
    });
    injectStyle();
  };

  M._portraitEl = portraitEl;
  M._hearts = hearts;

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
