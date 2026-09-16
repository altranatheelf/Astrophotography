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
        return 'Paused';
      }

      function pauseRows() {
        const out = [{ label: 'Keep playing', action: 'close' }];
        for (const def of menus.list().slice().sort((a, b) => (a.order || 50) - (b.order || 50))) {
          if (typeof def.when === 'function' && !def.when(game)) continue;
          out.push({ label: KIT.labelOf(def, game), action: 'menu:' + def.id, value: typeof def.value === 'function' ? def.value(game) : undefined });
        }
        return out;
      }

      function settingRows() {
        const s = settings();
        return [
          { label: 'Text speed', value: s.textSpeed, action: 'cycle:textSpeed' },
          { label: 'Zoom', value: s.zoom, action: 'cycle:zoom' },
          { label: 'Sound', value: s.sound ? 'on' : 'off', action: 'toggle:sound' },
          { label: 'Music', value: s.music ? 'on' : 'off', action: 'toggle:music' },
          { label: 'Motion', value: s.reduceMotion ? 'reduced' : 'normal', action: 'toggle:reduceMotion' },
          { label: 'Back', action: 'back' },
        ];
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
        if (action.startsWith('menu:')) {
          const def = menus.get(action.slice(5));
          if (!def) return;
          if (def.id === 'settings') { mode = 'settings'; index = 0; build(this); return; }
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

      async function saveRows(g) {
        const list = await KIT.storage.listGames();
        return list.map(s => ({
          label: s.slot === 'autosave' ? 'Autosave' : 'Slot ' + s.slot,
          value: s.exists ? when(s.savedAt) : 'empty',
          note: s.exists && s.map ? s.map : '',
          action: 'slot:' + s.slot,
          disabled: s.slot === 'autosave',
        })).concat([{ label: 'Back', action: 'back' }]);
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
        exit() { const host = UI.el('pause-menu'); if (host) { host.hidden = true; UI.clear(host); } if (this._off) this._off(); },
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
    { id: 'coop', label: 'Two players', order: 30,
      value: (game) => (game && game.world && game.world.coop ? 'on' : 'off'),
      open(game) { game.setCoop(!(game.world && game.world.coop)); return null; } },
    { id: 'settings', label: 'Settings', order: 40, open() { return null; } },
    { id: 'debug', label: 'Debug', order: 55,
      when: (game) => !!(game && game.flags && game.flags.debug),
      async open(game) { await KIT.scenes.run('debug', { game }); return null; } },
    { id: 'creator', label: 'Creator Mode', order: 60,
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
