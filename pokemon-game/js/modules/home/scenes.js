// home/scenes — the three screens: putting furniture down, the job board, and
// the Jobs list. They are thin: every decision is a call into rules.js.
//
//   KIT.scenes.run('home-place', { game })            // the placement screen
//   KIT.scenes.run('home-board', { game, object })    // one job board
//   KIT.scenes.run('home-jobs',  { game })            // what is out, what is home
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const H = KIT.home = KIT.home || {};
  const UI = KIT.ui;
  const scenes = KIT.registry('scenes');
  if (typeof document === 'undefined' || !UI) return;                 // headless: no screens to build

  const S = (project, key, vars) => KIT.strings.get(project, key, vars);
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const defs = [];                       // registered by H.registerScenes(), not at load

  // ---- a little style of our own, so the placement panel does not hide the room ----
  function style() {
    if (document.getElementById('home-style')) return;
    const el = document.createElement('style');
    el.id = 'home-style';
    el.textContent = [
      '#pause-menu.home-placing { background: none; align-items: flex-end; padding-bottom: 12px; pointer-events: none; }',
      '#pause-menu.home-placing .kit-panel { pointer-events: auto; padding: 8px; min-width: min(320px, 92vw); }',
      '#pause-menu.home-placing .kit-panel-title { padding-bottom: 6px; }',
      '#pause-menu.home-placing .kit-hint { margin-top: 6px; }',
      '.kit-home-row { display: flex; gap: 6px; }',
      '.kit-home-row .kit-uibtn { flex: 1 1 auto; justify-content: center; min-height: 44px; }',
      '.kit-home-sec { font-family: var(--font-ui); font-size: 10px; color: #3b4b8a; padding: 10px 6px 4px; }',
      '.kit-home-art { image-rendering: pixelated; width: 24px; height: 24px; flex: 0 0 auto; }',
    ].join('\n');
    document.head.appendChild(el);
  }

  /**
   * onlyAction(el, fn) — UI.onAction, and the click stops here.
   *
   * These screens draw into the same host as the pause menu (#pause-menu), which
   * is the one overlay the kit offers for a list over the map. The menu now lets
   * go of that host while it is covered (KIT.scenes suspend/resume), so this is
   * belt and braces rather than the fix it used to be — kept because a click
   * meant for our row has no business reaching anything underneath us, whatever
   * happens to be listening there.
   */
  function onlyAction(el, fn) {
    const handler = (e) => {
      const t = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
      if (!t || !el.contains(t)) return;
      e.preventDefault();
      e.stopPropagation();
      fn(t.getAttribute('data-action'), t, e);
    };
    el.addEventListener('click', handler, true);
    return () => el.removeEventListener('click', handler, true);
  }

  /** panel(title, rows, opts) — the same list shape the pause menu uses. */
  function panel(title, rows, opts) {
    const host = UI.el('pause-menu');
    UI.clear(host);
    host.hidden = false;
    host.classList.toggle('home-placing', !!(opts && opts.overMap));
    const box = UI.make('div.kit-panel' + (opts && opts.cls ? '.' + opts.cls : ''));
    if (title) box.appendChild(UI.make('div.kit-panel-title', { text: title }));
    const list = UI.make('div.kit-menu-list');
    let index = 0;
    for (const r of rows) {
      if (r.section) { list.appendChild(UI.make('div.kit-home-sec', { text: r.section })); continue; }
      const b = UI.make('button.kit-uibtn.kit-menu-item', {});
      b.type = 'button';
      b.setAttribute('data-action', r.action || 'none');
      b.setAttribute('data-index', String(index++));
      if (r.disabled) b.disabled = true;
      if (r.art) b.appendChild(r.art);
      b.appendChild(UI.make('span.kit-item-label', { text: r.label }));
      if (r.value != null) b.appendChild(UI.make('span.kit-item-value', { text: String(r.value) }));
      list.appendChild(b);
    }
    box.appendChild(list);
    if (opts && opts.buttons) {
      const row = UI.make('div.kit-home-row');
      for (const b of opts.buttons) {
        const btn = UI.button(b.action, b.label, b.primary ? 'is-primary' : '');
        if (b.disabled) btn.disabled = true;
        row.appendChild(btn);
      }
      box.appendChild(row);
    }
    if (opts && opts.hint) box.appendChild(UI.make('p.kit-hint', { text: opts.hint }));
    host.appendChild(box);
    return { host, list, rows: rows.filter(r => !r.section) };
  }
  function closePanel() {
    const host = UI.el('pause-menu');
    if (!host) return;
    host.hidden = true;
    host.classList.remove('home-placing');
    UI.clear(host);
  }
  /**
   * A tiny canvas of a friend's face. `w.sprite` is a *registered sprite id* —
   * whoever owns the friends put it in the `sprites` registry — so this is the
   * kit's own art path and there is no second copy of anybody's portrait code
   * in this module.
   */
  function faceArt(spriteId) {
    if (!spriteId) return null;
    try {
      const def = KIT.registry('sprites').get(spriteId);
      if (!def) return null;
      const cv = UI.artCanvas(standingFrame(def), 2, '#8a8a9a');
      cv.className = 'kit-home-art';
      return cv;
    } catch (e) { return null; }
  }

  /**
   * One still picture out of a sprite definition, whatever shape it is: a plain
   * art, a frame list, or the kit's four-direction walk cycle (`frames.down`).
   * Facing the reader is what a row in a list wants.
   */
  function standingFrame(def) {
    const frames = def && def.frames;
    if (frames && !Array.isArray(frames)) {
      const rows = frames.down || frames.up || frames.left || frames.right;
      const first = Array.isArray(rows) ? rows[0] : null;
      if (first) return { w: def.w || 16, h: def.h || 16, palette: def.palette || {}, rows: first };
    }
    return KIT.pixels.artOf ? KIT.pixels.artOf(def) : (def.art || def);
  }

  /** A tiny canvas of a tile, so a row of furniture looks like the thing itself. */
  function tileArt(tileId) {
    try {
      const def = KIT.registry('tiles').get(tileId);
      const art = def && KIT.pixels.artOf ? KIT.pixels.artOf(def) : (def && (def.art || def));
      const cv = UI.artCanvas(art, 2, '#8a8a9a');
      cv.className = 'kit-home-art';
      return cv;
    } catch (e) { return null; }
  }

  // =============================================================================
  // The placement screen
  // =============================================================================
  defs.push({
    id: 'home-place', name: 'Decorate',
    create() {
      let game = null, world = null, ui = null, off = null, onCanvas = null;
      let mode = 'choose';            // choose | place | take
      let rows = [], index = 0;
      let itemId = null, variant = 0;
      let cx = 0, cy = 0;
      let ghosts = [];
      let pulse = 0;

      const project = () => game.project;
      const save = () => world.save;
      const mapId = () => (world.map ? world.map.id : null);
      const itemDef = () => (itemId ? project().items[itemId] : null);
      const bagCount = (id) => num((save().inventory || {})[id], 0);

      function bagFurniture() {
        const inv = save().inventory || {};
        return Object.keys(inv).filter(id => inv[id] > 0 && H.isFurniture(project(), id))
          .map(id => ({ id, item: project().items[id], count: inv[id] }));
      }

      // ---- the ghost -------------------------------------------------------------
      // Markers, not entities: the thing you are about to put down is not in the
      // world yet, so nothing should be able to walk into it or talk to it, and
      // nothing iterating world.entities should have to learn to skip it.
      function clearGhosts() {
        if (!world || !Array.isArray(world.markers)) { ghosts = []; return; }
        for (const g of ghosts) {
          const i = world.markers.indexOf(g);
          if (i >= 0) world.markers.splice(i, 1);
        }
        ghosts = [];
      }
      function buildGhosts() {
        clearGhosts();
        if (!world || !world.map) return;
        let cells = [];
        if (mode === 'place' && itemDef()) cells = H.cellsFor(itemDef(), variant, cx, cy);
        else if (mode === 'take') {
          const rec = H.placedAt(save(), mapId(), cx, cy);
          cells = rec ? rec.cells.map(c => ({ x: c.x, y: c.y, tile: c.tile })) : [{ x: cx, y: cy, tile: null }];
        }
        const ok = mode !== 'place' || !itemDef() || H.canPlace(project(), save(), mapId(), itemDef(), variant, cx, cy).ok;
        for (const c of cells) {
          const g = { x: c.x, y: c.y, tile: c.tile || null, layer: 'same', opacity: 0.65,
            outline: ok ? '#9fe6b0' : '#e69f9f' };
          ghosts.push(g);
          world.markers.push(g);
        }
      }
      /** Keep the cursor on screen without moving the hero. */
      function follow() {
        if (!world || !world.map) return;
        const vp = world.viewport || { w: 16, h: 12 };
        const view = world.map;
        let x = cx + 0.5 - vp.w / 2, y = cy + 0.5 - vp.h / 2;
        x = view.width <= vp.w ? (view.width - vp.w) / 2 : KIT.clamp(x, 0, view.width - vp.w);
        y = view.height <= vp.h ? (view.height - vp.h) / 2 : KIT.clamp(y, 0, view.height - vp.h);
        world.camera.x = x; world.camera.y = y;
      }
      function moveCursor(dx, dy) {
        if (!world.map) return;
        cx = KIT.clamp(cx + dx, 0, world.map.width - 1);
        cy = KIT.clamp(cy + dy, 0, world.map.height - 1);
        buildGhosts();
        follow();
        build();
      }
      /** The overlay changed: rebuild the entities it made and repaint. */
      function syncWorld() {
        if (!world || !world.map) return;
        const id = world.map.id;
        if (world.rebuildEntities) world.rebuildEntities();
        const r = KIT.game && KIT.game.renderer;
        if (r) r.invalidate(id);
        buildGhosts();
      }

      // ---- the three panels --------------------------------------------------------
      function chooserRows() {
        const list = bagFurniture();
        const out = [];
        for (const f of list) {
          const v = H.variants(f.item)[0];
          out.push({ label: f.item.name || f.id, value: '×' + f.count, action: 'pick:' + f.id, art: tileArt(v.tile) });
        }
        if (!list.length) out.push({ label: S(project(), 'home-place-empty'), disabled: true, action: 'none' });
        if (H.placedOn(save(), mapId()).length) out.push({ label: S(project(), 'home-place-take'), action: 'take' });
        out.push({ label: S(project(), 'home-place-done'), action: 'back' });
        return out;
      }

      function build() {
        const p = project();
        if (mode === 'choose') {
          rows = chooserRows();
          ui = panel(S(p, 'home-menu-decorate'), rows, { hint: KIT.input.isTouch() ? 'Tap a line' : 'Arrows · Z chooses · X closes' });
          index = Math.min(index, Math.max(0, rows.length - 1));
          UI.select(ui.list, index);
        } else if (mode === 'place') {
          const item = itemDef();
          const vs = H.variants(item);
          const can = H.canPlace(p, save(), mapId(), item, variant, cx, cy);
          const title = `${S(p, 'home-place-title')} · ${(item && item.name) || itemId} (${vs[variant % vs.length].label})`;
          rows = [];
          ui = panel(title, rows, {
            overMap: true,
            hint: S(p, 'home-place-hint'),
            buttons: [
              { action: 'rotate', label: S(p, 'home-place-rotate'), disabled: vs.length < 2 },
              { action: 'put', label: S(p, 'home-place-put'), primary: true, disabled: !can.ok },
              { action: 'back', label: S(p, 'home-place-done') },
            ],
          });
        } else {
          const rec = H.placedAt(save(), mapId(), cx, cy);
          const name = rec ? (H.itemName(p, rec.item) || rec.item) : '—';
          rows = [];
          ui = panel(`${S(p, 'home-place-take')} · ${name}`, rows, {
            overMap: true,
            hint: S(p, 'home-place-hint'),
            buttons: [
              { action: 'put', label: S(p, 'home-place-take'), primary: true, disabled: !rec },
              { action: 'back', label: S(p, 'home-place-done') },
            ],
          });
        }
        if (off) off();
        off = onlyAction(ui.host, (action, el) => {
          if (el.hasAttribute('data-index')) index = Number(el.getAttribute('data-index')) || 0;
          act(action);
        });
      }

      // ---- what the buttons do -------------------------------------------------------
      function startPlacing(id) {
        itemId = id;
        variant = 0;
        mode = 'place';
        const hero = world.hero();
        const facing = hero ? KIT.entities.facingTile(hero) : { x: 0, y: 0 };
        cx = KIT.clamp(facing.x, 0, world.map.width - 1);
        cy = KIT.clamp(facing.y, 0, world.map.height - 1);
        buildGhosts();
        follow();
        build();
      }

      function putDown() {
        const p = project();
        const item = itemDef();
        if (!item) return;
        const can = H.canPlace(p, save(), mapId(), item, variant, cx, cy);
        if (!can.ok) {
          KIT.audio.play('bump');
          const key = can.reason === 'occupied' ? 'home-in-the-way' : can.reason === 'wall' ? 'home-against-wall' : 'home-no-room';
          KIT.toast(S(p, key));
          return;
        }
        H.place(save(), mapId(), itemId, item, variant, cx, cy);
        KIT.commands.state.give({ world, project: p }, itemId, -1);
        KIT.audio.play('item');
        KIT.toast(S(p, 'home-placed', { item: item.name || itemId }));
        syncWorld();
        if (bagCount(itemId) <= 0) { mode = 'choose'; clearGhosts(); index = 0; }
        build();
        if (KIT.game && KIT.game.save) KIT.game.save('autosave');
      }

      function pickUp() {
        const p = project();
        const rec = H.placedAt(save(), mapId(), cx, cy);
        if (!rec) { KIT.audio.play('bump'); return; }
        const id = H.pickUp(save(), rec);
        if (!id) return;
        KIT.commands.state.give({ world, project: p }, id, 1);
        KIT.audio.play('select');
        KIT.toast(S(p, 'home-picked-up', { item: H.itemName(p, id) || id }));
        syncWorld();
        build();
        if (KIT.game && KIT.game.save) KIT.game.save('autosave');
      }

      function act(action) {
        if (!action || action === 'none') return;
        if (action.startsWith('pick:')) { KIT.audio.play('select'); startPlacing(action.slice(5)); return; }
        if (action === 'take') { KIT.audio.play('select'); mode = 'take'; const h = world.hero(); cx = h ? h.x : 0; cy = h ? h.y : 0; buildGhosts(); follow(); build(); return; }
        if (action === 'rotate') { const vs = H.variants(itemDef()); variant = (variant + 1) % vs.length; KIT.audio.play('blip'); buildGhosts(); build(); return; }
        if (action === 'put') { if (mode === 'place') putDown(); else if (mode === 'take') pickUp(); return; }
        if (action === 'back') {
          KIT.audio.play('back');
          if (mode === 'choose') { this_finish(); return; }
          mode = 'choose'; clearGhosts(); index = 0; build();
          return;
        }
      }
      let this_finish = () => {};

      return {
        id: 'home-place', transparent: true, pausesWorld: true,
        enter(params) {
          game = (params && params.game) || KIT.game;
          world = game.world;
          this_finish = () => this.finish('close');
          if (!world || !world.map) { this.finish('close'); return; }
          H.ensure(save());
          mode = 'choose'; index = 0; itemId = null; variant = 0;
          if (params && params.item && bagCount(params.item) > 0 && H.isFurniture(project(), params.item)) startPlacing(params.item);
          else build();
          // Tap the room itself to move the piece there.
          const canvas = UI.el('game-canvas');
          if (canvas) {
            onCanvas = (ev) => {
              if (mode === 'choose') return;
              const r = KIT.game.renderer;
              if (!r) return;
              const rect = canvas.getBoundingClientRect();
              const pt = r.screenToTile(ev.clientX - rect.left, ev.clientY - rect.top, world);
              if (!world.map || pt.x < 0 || pt.y < 0 || pt.x >= world.map.width || pt.y >= world.map.height) return;
              cx = pt.x; cy = pt.y;
              buildGhosts(); follow(); build();
            };
            canvas.addEventListener('pointerdown', onCanvas);
          }
        },
        exit() {
          clearGhosts();
          closePanel();
          if (off) off();
          const canvas = UI.el('game-canvas');
          if (canvas && onCanvas) canvas.removeEventListener('pointerdown', onCanvas);
          onCanvas = null;
          if (world && world.map) {
            world.map = KIT.mapView(project(), save(), world.map.id);
            if (world.rebuildEntities) world.rebuildEntities();
          }
        },
        update(dt) {
          pulse += dt;
          const a = 0.45 + 0.25 * (1 + Math.sin(pulse * 5)) / 2;
          for (const g of ghosts) g.opacity = a;
        },
        input(ev) {
          if (mode === 'choose') {
            if (ev.key === 'up') { index = (index - 1 + rows.length) % rows.length; UI.select(ui.list, index); KIT.audio.play('blip'); return true; }
            if (ev.key === 'down') { index = (index + 1) % rows.length; UI.select(ui.list, index); KIT.audio.play('blip'); return true; }
            if (ev.key === 'a') { const r = rows[index]; if (r && !r.disabled) act.call(this, r.action); return true; }
            if (ev.key === 'b' || ev.key === 'menu') { this.finish('close'); return true; }
            return true;
          }
          if (ev.key === 'up') { moveCursor(0, -1); return true; }
          if (ev.key === 'down') { moveCursor(0, 1); return true; }
          if (ev.key === 'left') { moveCursor(-1, 0); return true; }
          if (ev.key === 'right') { moveCursor(1, 0); return true; }
          if (ev.key === 'swap') { act.call(this, 'rotate'); return true; }
          if (ev.key === 'a') { act.call(this, 'put'); return true; }
          if (ev.key === 'b' || ev.key === 'menu') { act.call(this, 'back'); return true; }
          return true;
        },
      };
    },
  });

  // =============================================================================
  // The job board
  // =============================================================================
  defs.push({
    id: 'home-board', name: 'Job board',
    create() {
      let game = null, world = null, ui = null, off = null;
      let step = 'jobs';                 // jobs | who
      let rows = [], index = 0;
      let templates = [], chosen = null, boardTitle = '';

      const project = () => game.project;
      const save = () => world.save;

      function build() {
        const p = project();
        if (step === 'jobs') {
          rows = templates.map(t => {
            const done = H.jobDone(save(), t.id);
            const taken = H.jobsOut(save()).some(j => j.job === t.id);
            const closed = taken || (done && !t.repeatable);
            return {
              label: t.title, value: taken ? 'out' : (done && !t.repeatable ? 'done' : H.durationText(t.minutes)),
              action: 'job:' + t.id, disabled: closed,
            };
          });
          if (!templates.length) rows.push({ label: S(p, 'home-board-empty'), disabled: true, action: 'none' });
          rows.push({ label: S(p, 'ok'), action: 'back' });
          ui = panel(boardTitle || S(p, 'home-board-title'), rows, { hint: S(p, 'home-board-hint') });
        } else {
          const roster = H.roster(p, save());
          rows = [];
          for (const w of roster) {
            const fit = H.suitability(chosen, w);
            const out = H.isOut(save(), w.uid);
            rows.push({
              label: w.name, art: faceArt(w.sprite),
              value: out ? 'out' : fit === 'wrong' ? '—' : H.durationText(H.jobMinutes(chosen, w, H.tuning(p))) + (fit === 'suits' || fit === 'needed' ? ' ·  suits them' : ''),
              action: 'who:' + w.uid, disabled: out || fit === 'wrong',
            });
          }
          if (!rows.some(r => !r.disabled)) rows.push({ label: S(p, 'home-who-empty'), disabled: true, action: 'none' });
          rows.push({ label: S(p, 'cancel'), action: 'back' });
          ui = panel(`${chosen.title} — ${S(p, 'home-who-title')}`, rows, { hint: chosen.desc || '' });
        }
        index = Math.min(index, Math.max(0, rows.length - 1));
        UI.select(ui.list, index);
        if (off) off();
        off = onlyAction(ui.host, (action, el) => {
          if (el.hasAttribute('data-index')) index = Number(el.getAttribute('data-index')) || 0;
          act.call(this_scene, action);
        });
      }
      let this_scene = null;

      function act(action) {
        const p = project();
        if (!action || action === 'none') return;
        if (action === 'back') {
          KIT.audio.play('back');
          if (step === 'who') { step = 'jobs'; index = 0; build(); return; }
          this.finish('close');
          return;
        }
        if (action.startsWith('job:')) {
          chosen = templates.find(t => t.id === action.slice(4));
          if (!chosen) return;
          KIT.audio.play('select');
          step = 'who'; index = 0; build();
          return;
        }
        if (action.startsWith('who:')) {
          const uid = action.slice(4);
          const worker = H.worker(p, save(), uid);
          const out = H.startJob(save(), { template: chosen, who: uid, worker, now: H.now(save()), tuning: H.tuning(p), board: chosen.board });
          if (!out.ok) {
            KIT.audio.play('bump');
            KIT.toast(S(p, out.reason === 'busy' ? 'home-who-busy' : 'home-who-wrong', { who: worker.name }));
            return;
          }
          H.react(save(), uid, 'worked', H.now(save()));
          KIT.audio.play('sparkle');
          KIT.toast(S(p, 'home-sent', { who: worker.name, time: H.durationText(out.job.minutes) }));
          if (KIT.game && KIT.game.save) KIT.game.save('autosave');
          step = 'jobs'; index = 0; build();
        }
      }

      return {
        id: 'home-board', transparent: true, pausesWorld: true,
        enter(params) {
          this_scene = this;
          game = (params && params.game) || KIT.game;
          world = game.world;
          if (!world) { this.finish('close'); return; }
          H.ensure(save());
          const obj = params && params.object;
          const page = params && params.page;
          boardTitle = (page && page.props && page.props.title) || (obj && obj.name) || '';
          templates = page ? H.templatesOf(page).map(t => Object.assign({ board: obj ? obj.id : null }, t))
            : H.boardTemplates(project(), obj ? obj.id : null);
          step = 'jobs'; index = 0; chosen = null;
          build();
        },
        exit() { closePanel(); if (off) off(); },
        input(ev) {
          if (ev.key === 'up') { index = (index - 1 + rows.length) % rows.length; UI.select(ui.list, index); KIT.audio.play('blip'); return true; }
          if (ev.key === 'down') { index = (index + 1) % rows.length; UI.select(ui.list, index); KIT.audio.play('blip'); return true; }
          if (ev.key === 'a') { const r = rows[index]; if (r && !r.disabled) act.call(this, r.action); return true; }
          if (ev.key === 'b' || ev.key === 'menu') { act.call(this, 'back'); return true; }
          return true;
        },
      };
    },
  });

  // =============================================================================
  // The Jobs list
  // =============================================================================
  defs.push({
    id: 'home-jobs', name: 'Jobs',
    create() {
      let game = null, world = null, ui = null, off = null;
      let rows = [], index = 0, busy = false;

      const project = () => game.project;
      const save = () => world.save;

      function build() {
        const p = project();
        const now = H.now(save());
        const ready = H.jobsReady(save(), now);
        const out = H.jobsOut(save()).filter(j => !H.isReady(j, now));
        rows = [];
        if (ready.length) {
          rows.push({ section: S(p, 'home-jobs-ready') });
          for (const j of ready) rows.push({ label: `${j.whoName || j.who} — ${j.title}`, value: S(p, 'home-jobs-waiting'), action: 'collect:' + j.id });
          if (ready.length > 1) rows.push({ label: S(p, 'home-collect-all'), action: 'collect-all' });
        }
        if (out.length) {
          rows.push({ section: S(p, 'home-jobs-out') });
          for (const j of out) rows.push({ label: `${j.whoName || j.who} — ${j.title}`, value: S(p, 'home-jobs-left', { time: H.durationText(H.remaining(j, now)) }), action: 'none', disabled: true });
        }
        const home = H.roster(p, save()).filter(w => !H.isOut(save(), w.uid));
        if (home.length) {
          rows.push({ section: S(p, 'home-jobs-garden') });
          for (const w of home) rows.push({ label: w.name, value: H.moodLabel(p, H.moodOf(save(), w.uid).mood), action: 'mood:' + w.uid, art: faceArt(w.sprite) });
        }
        if (!ready.length && !out.length) rows.push({ label: S(p, 'home-jobs-none'), disabled: true, action: 'none' });
        rows.push({ label: S(p, 'ok'), action: 'back' });
        ui = panel(`${S(p, 'home-jobs-title')} · ${H.clockText(save())}`, rows, {});
        index = Math.min(index, Math.max(0, ui.rows.length - 1));
        UI.select(ui.list, index);
        if (off) off();
        off = onlyAction(ui.host, (action, el) => {
          if (el.hasAttribute('data-index')) index = Number(el.getAttribute('data-index')) || 0;
          act.call(this_scene, action);
        });
      }
      let this_scene = null;

      async function collect(job) {
        const p = project();
        const worker = H.worker(p, save(), job.who);
        const r = H.collectJob(save(), job.id, { now: H.now(save()), worker, tuning: H.tuning(p) });
        if (!r.ok) return;
        if (r.reward && world.events) world.events.emit('itemChanged', { id: r.reward.item, delta: r.reward.count, count: (save().inventory || {})[r.reward.item] || 0 });
        // Friendship is not ours to keep: hand it to the module that owns this
        // friend, through the command it registered. With no such module the
        // job still pays its reward and nothing else happens.
        if (r.friendship) H.awardFriendship(world.makeCtx(null, (world.hero() || {}).id || 'p1'), job.who, r.friendship);
        KIT.audio.play('item');
        await KIT.scenes.run('dialogue', { text: H.jobLine(p, worker, r.job, r.reward) });
        if (KIT.game && KIT.game.save) KIT.game.save('autosave');
      }

      async function act(action) {
        const p = project();
        if (!action || action === 'none' || busy) return;
        if (action === 'back') { KIT.audio.play('back'); this.finish('close'); return; }
        if (action.startsWith('mood:')) {
          const w = H.worker(p, save(), action.slice(5));
          KIT.audio.play('blip');
          busy = true;
          await KIT.scenes.run('dialogue', { text: H.moodLine(p, w, H.moodOf(save(), w.uid).mood) });
          busy = false;
          build();
          return;
        }
        if (action === 'collect-all' || action.startsWith('collect:')) {
          busy = true;
          const now = H.now(save());
          const list = action === 'collect-all' ? H.jobsReady(save(), now) : H.jobsReady(save(), now).filter(j => j.id === action.slice(8));
          for (const job of list) await collect(job);
          busy = false;
          index = 0;
          build();
        }
      }

      return {
        id: 'home-jobs', transparent: true, pausesWorld: true,
        enter(params) {
          this_scene = this;
          game = (params && params.game) || KIT.game;
          world = game.world;
          if (!world) { this.finish('close'); return; }
          H.ensure(save());
          index = 0; busy = false;
          build();
        },
        exit() { closePanel(); if (off) off(); },
        input(ev) {
          if (busy) return true;
          const n = ui && ui.rows ? ui.rows.length : 0;
          if (!n) return true;
          if (ev.key === 'up') { index = (index - 1 + n) % n; UI.select(ui.list, index); KIT.audio.play('blip'); return true; }
          if (ev.key === 'down') { index = (index + 1) % n; UI.select(ui.list, index); KIT.audio.play('blip'); return true; }
          if (ev.key === 'a') { const r = ui.rows[index]; if (r && !r.disabled) act.call(this, r.action); return true; }
          if (ev.key === 'b' || ev.key === 'menu') { act.call(this, 'back'); return true; }
          return true;
        },
      };
    },
  });

  /** registerScenes() — called by register.js when the project enables this module. */
  H.registerScenes = function () {
    style();
    for (const d of defs) if (!scenes.has(d.id)) scenes.add(d);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
