// The pause menu, the settings list, the save-slot list and the debug panel.
//
// The pause menu is built from the `menus` registry, so a module (or the
// author) adds an entry with `KIT.registry('menus').add({ id, label, order,
// open(game) })` and it appears in the right place with no core edits.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const UI = KIT.ui;
  const scenes = KIT.registry('scenes');
  const menus = KIT.registry('menus');

  const TEXT_SPEEDS = ['slow', 'normal', 'fast', 'instant'];
  const ZOOMS = ['auto', 'small', 'normal', 'large'];

  function settings() { return KIT.storage.settings(); }
  function save(patch) { return KIT.storage.saveSettings(patch); }

  /** A list panel inside #pause-menu: rows of { label, value, action, disabled }. */
  function panel(title, rows, opts) {
    const host = UI.el('pause-menu');
    UI.clear(host);
    host.hidden = false;
    const box = UI.make('div.kit-panel.kit-pause');
    if (title) box.appendChild(UI.make('div.kit-panel-title', { text: title }));
    const list = UI.make('div.kit-menu-list');
    rows.forEach((r, i) => {
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
  }

  /** One scene drives every list: pause, settings and save just supply rows. */
  scenes.add({
    id: 'menu', name: 'Menu',
    create() {
      let mode = 'pause', rows = [], index = 0, ui = null, game = null;

      const build = function (self) {
        if (mode === 'settings') rows = settingRows();
        else if (mode === 'save') rows = self._saveRows || [{ label: 'Loading…', disabled: true }];
        else if (mode === 'moments') rows = momentRows();
        else rows = pauseRows();
        ui = panel(titleFor(), rows, { hint: KIT.input.isTouch() ? 'Tap a line · ☰ closes' : 'Arrows · Z chooses · X closes' });
        index = Math.min(index, Math.max(0, rows.length - 1));
        UI.select(ui.list, index);
        if (self._off) self._off();
        self._off = UI.onAction(ui.host, (action, el) => {
          index = Number(el.getAttribute('data-index')) || 0;
          activate.call(self);
        });
      };

      function titleFor() {
        if (mode === 'settings') return KIT.strings.get(game && game.project, 'settings');
        if (mode === 'save') return KIT.strings.get(game && game.project, 'save');
        if (mode === 'moments') return KIT.strings.get(game && game.project, 'moments');
        return 'Paused';
      }

      function pauseRows() {
        const out = [{ label: t('keep-playing'), action: 'close' }];
        for (const def of menus.list().slice().sort((a, b) => (a.order || 50) - (b.order || 50))) {
          if (typeof def.when === 'function' && !def.when(game)) continue;
          out.push({ label: KIT.labelOf(def, game), action: 'menu:' + def.id, value: typeof def.value === 'function' ? def.value(game) : undefined });
        }
        return out;
      }

      /** The engine's own words, through the Terms table so they translate. */
      const t = (id, vars) => KIT.strings.get(game && game.project, id, vars);
      const pct = (v, d) => Math.round((v == null ? d : v) * 100) + '%';

      function settingRows() {
        const s = settings();
        // Shown only when there is a choice to make. A game in one language
        // should not have a row that does nothing.
        const langs = KIT.lang ? KIT.lang.known() : [];
        const language = langs.length > 1
          ? [{ label: t('language'), value: KIT.lang.nameOf(KIT.lang.current()), action: 'cycle:language' }]
          : [];
        return language.concat([
          { label: t('text-speed'), value: t('speed-' + s.textSpeed), action: 'cycle:textSpeed' },
          { label: t('zoom'), value: s.zoom, action: 'cycle:zoom' },
          { label: t('sound'), value: t(s.sound ? 'on' : 'off'), action: 'toggle:sound' },
          // The Accessibility Guidelines' Basic tier asks for SEPARATE volumes
          // for effects and music, not just mutes. The audio API had setVolume
          // and the settings had the numbers; nothing ever let a player touch
          // them. Shown only when that kind of sound is on at all.
          ...(s.sound ? [{ label: t('sound-volume'), value: pct(s.soundVolume, 0.9), action: 'cycle:soundVolume' }] : []),
          { label: t('music'), value: t(s.music ? 'on' : 'off'), action: 'toggle:music' },
          ...(s.music ? [{ label: t('music-volume'), value: pct(s.musicVolume, 0.5), action: 'cycle:musicVolume' }] : []),
          { label: t('motion'), value: t(s.reduceMotion ? 'motion-reduced' : 'motion-normal'), action: 'toggle:reduceMotion' },
          { label: t('back'), action: 'back' },
        ]);
      }

      function nudge(action, dir) {
        const s = settings();
        if (action === 'cycle:textSpeed') {
          const i = (TEXT_SPEEDS.indexOf(s.textSpeed) + (dir || 1) + TEXT_SPEEDS.length) % TEXT_SPEEDS.length;
          save({ textSpeed: TEXT_SPEEDS[i] });
        } else if (action === 'cycle:zoom') {
          const i = (ZOOMS.indexOf(s.zoom) + (dir || 1) + ZOOMS.length) % ZOOMS.length;
          save({ zoom: ZOOMS[i] });
          if (KIT.game && KIT.game.resize) KIT.game.resize();
        } else if (action === 'cycle:language') {
          const langs = KIT.lang.known();
          const i = (langs.indexOf(KIT.lang.current()) + (dir || 1) + langs.length) % langs.length;
          KIT.lang.use(langs[i]);
          save({ language: langs[i] });
        } else if (action === 'cycle:soundVolume' || action === 'cycle:musicVolume') {
          const kind = action === 'cycle:soundVolume' ? 'sound' : 'music';
          const key = kind + 'Volume';
          const now = s[key] == null ? (kind === 'sound' ? 0.9 : 0.5) : s[key];
          // Steps of a tenth, wrapping round through zero, so a single button
          // reaches every level — the same shape as the text-speed and zoom
          // rows, and the only shape that works with one confirm key.
          let next = Math.round((now + 0.1 * (dir || 1)) * 10) / 10;
          if (next > 1) next = 0;
          if (next < 0) next = 1;
          save({ [key]: next });
          KIT.audio.setVolume(kind, next);
          if (kind === 'sound') KIT.audio.play('select');
        } else if (action === 'toggle:sound') { save({ sound: !s.sound }); KIT.audio.setEnabled(!s.sound); }
        else if (action === 'toggle:music') { save({ music: !s.music }); KIT.audio.setMusic(!s.music); if (!s.music && KIT.game && KIT.game.world) KIT.audio.music(KIT.game.world.currentMusic || null); }
        else if (action === 'toggle:reduceMotion') save({ reduceMotion: !s.reduceMotion });
        else return false;
        return true;
      }

      async function activate() {
        const row = rows[index];
        if (!row || row.disabled) return;
        const action = row.action || '';
        KIT.audio.play('select');
        if (action === 'close') { this.finish('close'); return; }
        if (action === 'back') { mode = 'pause'; index = 0; build(this); return; }
        if (action.startsWith('cycle:') || action.startsWith('toggle:')) { nudge(action, 1); build(this); return; }
        if (action.startsWith('slot:')) {
          const slot = action.slice(5);
          const ok = await game.save(slot);
          await KIT.toast(KIT.strings.get(game.project, ok ? 'saved' : 'save-failed'));
          if (ok) KIT.audio.play('save');
          mode = 'pause'; index = 0; build(this);
          return;
        }
        if (action.startsWith('moment:')) {
          const id = action.slice(7);
          const row = (KIT.timeline ? KIT.timeline.node(id) : null);
          const name = (row && row.label) || (row && row.where) || t('this-moment');
          this.finish('close');
          const ok = await KIT.game.gotoMoment(id);
          if (ok) await KIT.toast(t('went-back', { label: name }));
          return;
        }
        if (action.startsWith('menu:')) {
          const def = menus.get(action.slice(5));
          if (!def) return;
          if (def.id === 'settings') { mode = 'settings'; index = 0; build(this); return; }
          if (def.id === 'moments') { mode = 'moments'; index = 0; build(this); return; }
          if (def.id === 'save') {
            this._saveRows = await saveRows(game);
            mode = 'save'; index = 0; build(this);
            return;
          }
          const result = await def.open(game, this);
          if (result === 'close') { this.finish('close'); return; }
          build(this);
        }
      }

      /**
       * The tree of moments, as a list a player can walk into (ADR-0013).
       *
       * A list and not a drawing: the tree is a shape, but the thing a player
       * wants is "take me back to when I was in the graveyard", and indentation
       * says branch well enough for that. A drawn graph is a nicer screen and a
       * worse answer to the question, and it can come later without changing
       * anything underneath.
       */
      function momentRows() {
        const T = KIT.timeline;
        const all = T ? T.moments() : [];
        if (!all.length) return [{ label: t('no-moments'), disabled: true }, { label: t('back'), action: 'back' }];
        // Newest first: what a player wants is almost always recent, and the
        // root of a long game is a hundred rows away from anything useful.
        const rows = all.slice().sort((a, b) => b.at - a.at).map((m) => ({
          label: ('· '.repeat(Math.min(m.depth, 6))) + (m.label || labelFor(m)),
          value: m.head ? t('you-are-here') : (m.mine ? '' : t('another-way')),
          note: t('day-time', { day: m.day, time: clockText(m.min) }) + (m.where ? ' · ' + m.where : ''),
          action: 'moment:' + m.id,
          disabled: m.head,
        }));
        return rows.concat([{ label: t('back'), action: 'back' }]);
      }
      /** What to call a moment nobody named: where it happened. */
      function labelFor(m) { return m.where || t('this-moment'); }
      function clockText(min) {
        const h = Math.floor((Number(min) || 0) / 60) % 24, mm = (Number(min) || 0) % 60;
        return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      }

      async function saveRows(g) {
        const list = await KIT.storage.listGames();
        const rows = list.map(s => ({
          label: s.slot === 'autosave' ? t('autosave') : t('slot', { n: s.slot }),
          value: s.exists ? when(s.savedAt) : t('empty-slot'),
          note: s.exists && s.map ? s.map : '',
          action: 'slot:' + s.slot,
          disabled: s.slot === 'autosave',
        }));
        // Said out loud, on the screen where it matters, only when it is true.
        // Safari throws away everything a page stored after seven days without a
        // visit — silently, with no event to catch — so a player who takes a
        // fortnight off loses the lot. If the browser has not promised to keep
        // this game, they deserve to know before they rely on it.
        const d = KIT.storage.durability ? KIT.storage.durability() : null;
        if (d && !d.safe) rows.push({ label: '⚠ ' + d.note, disabled: true });
        return rows.concat([{ label: t('back'), action: 'back' }]);
      }
      function when(iso) {
        if (!iso) return '';
        try { const d = new Date(iso); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
        catch (e) { return iso.slice(0, 16).replace('T', ' '); }
      }

      return {
        id: 'menu', transparent: true, pausesWorld: true,
        enter(params) {
          game = (params && params.game) || KIT.game;
          mode = (params && params.mode) || 'pause';
          index = 0;
          this._saveRows = null;
          build(this);
        },
        exit() { const host = UI.el('pause-menu'); if (host) { host.hidden = true; UI.clear(host); } if (this._off) this._off(); this._off = null; },
        /**
         * Something opened over us — very likely a module's own screen, drawn
         * into this same `#pause-menu` host, because that is the one overlay the
         * kit offers for a list over the map. Our delegated click listener is
         * still on that host, so one tap on their row would fire ours too, read
         * `data-index` off THEIR row and act on whatever our stale rows array has
         * at that number. Let go until we are on top again.
         */
        suspend() { if (this._off) { this._off(); this._off = null; } },
        resume() { const host = UI.el('pause-menu'); if (host) { host.hidden = false; } build(this); },
        input(ev) {
          if (ev.key === 'up') { index = (index - 1 + rows.length) % rows.length; UI.select(ui.list, index); KIT.audio.play('blip'); return true; }
          if (ev.key === 'down') { index = (index + 1) % rows.length; UI.select(ui.list, index); KIT.audio.play('blip'); return true; }
          if (ev.key === 'left' || ev.key === 'right') {
            const row = rows[index];
            if (row && nudge(row.action, ev.key === 'left' ? -1 : 1)) build(this);
            return true;
          }
          if (ev.key === 'a') { activate.call(this); return true; }
          if (ev.key === 'b' || ev.key === 'menu') {
            KIT.audio.play('back');
            if (mode !== 'pause') { mode = 'pause'; index = 0; build(this); return true; }
            this.finish('close');
            return true;
          }
          return true;
        },
      };
    },
  });

  // ---- the standard pause-menu entries -------------------------------------------
  menus.addAll([
    { id: 'save', label: 'Save', order: 20, open() { return null; } },
    { id: 'coop', label: () => KIT.strings.get(KIT.game && KIT.game.project, 'two-players'), order: 30,
      value: (game) => (game && game.world && game.world.coop ? 'on' : 'off'),
      open(game) { game.setCoop(!(game.world && game.world.coop)); return null; } },
    // Going back is not "load": nothing is overwritten, so it sits beside Save
    // rather than inside it, and it only appears once there is somewhere to go.
    { id: 'moments', label: () => KIT.strings.get(KIT.game && KIT.game.project, 'moments'), order: 25,
      when: () => !!(KIT.timeline && KIT.timeline.count() > 1),
      value: () => (KIT.timeline ? String(KIT.timeline.count()) : ''),
      open() { return null; } },
    { id: 'settings', label: 'Settings', order: 40, open() { return null; } },
    { id: 'debug', label: 'Debug', order: 55,
      when: (game) => !!(game && game.flags && game.flags.debug),
      async open(game) { await KIT.scenes.run('debug', { game }); return null; } },
    { id: 'creator', label: () => KIT.strings.get(KIT.game && KIT.game.project, 'creator-mode'), order: 60,
      async open(game) {
        if (game && game.openEditor && game.openEditor()) return 'close';
        await KIT.toast('Creator Mode is not in this build yet.');
        return null;
      } },
    { id: 'quit', label: 'Quit to title', order: 80,
      async open(game) {
        const i = await KIT.scenes.run('choice', {
          prompt: 'Quit to the title screen?',
          options: [{ text: KIT.strings.get(game.project, 'yes'), index: 0 }, { text: KIT.strings.get(game.project, 'no'), index: 1 }],
          cancel: 'last',
        });
        if (i === 0) { game.toTitle(); return 'close'; }
        return null;
      } },
  ]);

  // ---- debug panel -------------------------------------------------------------------
  scenes.add({
    id: 'debug', name: 'Debug',
    create() {
      let host = null, timer = 0;
      function body(game) {
        const w = game && game.world;
        const lines = [];
        if (w) {
          const h = w.hero();
          lines.push(`map ${w.map ? w.map.id : '—'}  hero ${h ? `${h.x},${h.y} ${h.dir}` : '—'}  busy ${w.busy}`);
          lines.push(`scenes ${KIT.scenes.ids().join(' › ')}`);
          lines.push(`threads ${KIT.interpreter.threads().map(t => `${t.label || t.id}:${t.status}`).join(', ') || 'none'}`);
          const vars = (w.save && w.save.vars) || {};
          lines.push('vars ' + (Object.keys(vars).map(k => `${k}=${JSON.stringify(vars[k])}`).join('  ') || 'none'));
          const inv = (w.save && w.save.inventory) || {};
          lines.push('bag ' + (Object.keys(inv).map(k => `${k}×${inv[k]}`).join('  ') || 'empty'));
        }
        lines.push(`storage ${JSON.stringify(KIT.storage.info())}`);
        return lines.join('\n');
      }
      return {
        id: 'debug', transparent: true, pausesWorld: false,
        enter(params) {
          const game = (params && params.game) || KIT.game;
          host = UI.el('pause-menu');
          UI.clear(host);
          host.hidden = false;
          const box = UI.make('div.kit-panel.kit-debug');
          box.appendChild(UI.make('div.kit-panel-title', { text: 'Debug' }));
          const pre = UI.make('pre.kit-debug-body', { text: body(game) });
          box.appendChild(pre);
          const row = UI.make('div.kit-row');
          row.appendChild(UI.button('close', 'Close', 'is-primary'));
          box.appendChild(row);
          host.appendChild(box);
          this._pre = pre; this._game = game;
          this._off = UI.onAction(host, () => this.finish(true));
        },
        exit() { if (host) { host.hidden = true; UI.clear(host); } if (this._off) this._off(); },
        update(dt) { timer += dt; if (timer > 0.25) { timer = 0; if (this._pre) this._pre.textContent = body(this._game); } },
        input(ev) { if (ev.key === 'b' || ev.key === 'menu' || ev.key === 'a') this.finish(true); return true; },
      };
    },
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
