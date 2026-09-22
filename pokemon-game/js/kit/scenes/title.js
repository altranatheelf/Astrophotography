// The title scene: the project's own title and pitch, New Game / Continue /
// Settings. Continue only lights up when there is a save for this world.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const UI = KIT.ui;
  const scenes = KIT.registry('scenes');

  scenes.add({
    id: 'title', name: 'Title',
    create() {
      let host = null, items = [], index = 0;

      function refresh() { UI.select(host.querySelector('.kit-menu-list'), index); }

      return {
        id: 'title', transparent: false,
        enter(params) {
          const project = (params && params.project) || (KIT.game && KIT.game.project) || {};
          const meta = project.meta || {};
          host = UI.el('screen-title');
          if (!host) { this.finish('new-game'); return; }
          UI.clear(host);
          host.hidden = false;

          const inner = UI.make('div.kit-title-inner');
          inner.appendChild(UI.make('h1.kit-title', { text: meta.title || 'Our Adventure' }));
          if (meta.subtitle) inner.appendChild(UI.make('p.kit-subtitle', { text: meta.subtitle }));

          const list = UI.make('div.kit-menu-list');
          items = [
            { action: 'new-game', label: KIT.strings.get(project, 'new-game') },
            { action: 'continue', label: KIT.strings.get(project, 'continue'), disabled: true },
            { action: 'settings', label: KIT.strings.get(project, 'settings') },
          ];
          // The author's doors are on the front page, not behind a game and a
          // pause menu. "Start your own game" comes first of the two because it
          // is the one a person who has just opened this on a phone wants: the
          // other one edits THIS game, and they are here to make theirs.
          if (KIT.editor && typeof KIT.editor.open === 'function') {
            // The door only appears when the room behind it does: a build without
            // blueprints, or without the scene that lists them, simply has no door.
            const canStart = KIT.blueprints && KIT.blueprints.list().length && KIT.registry.exists('scenes') && KIT.registry('scenes').has('start');
            if (canStart) items.push({ action: 'start-own', label: KIT.strings.get(project, 'start-own') });
            items.push({ action: 'creator', label: KIT.strings.get(project, 'creator-mode') });
          }
          items.forEach((it, i) => {
            const b = UI.make('button.kit-uibtn.kit-menu-item', { text: it.label });
            b.type = 'button';
            b.setAttribute('data-action', it.action);
            b.setAttribute('data-index', String(i));
            if (it.disabled) b.disabled = true;
            list.appendChild(b);
          });
          inner.appendChild(list);
          if (meta.pitch) inner.appendChild(UI.make('p.kit-pitch', { text: meta.pitch }));
          inner.appendChild(UI.make('p.kit-hint', { text: KIT.input.isTouch() ? 'Tap to choose' : 'Arrows to choose · Z to confirm' }));
          host.appendChild(inner);
          index = 0;
          refresh();

          // Light up Continue when a save turns up.
          Promise.resolve(KIT.storage.listGames()).then((saves) => {
            const any = (saves || []).some(s => s.exists);
            const btn = list.querySelector('[data-action="continue"]');
            if (btn && any) { btn.disabled = false; items[1].disabled = false; index = 1; refresh(); }
          }).catch(() => {});

          this._off = UI.onAction(host, (action, el) => {
            if (el.disabled) return;
            index = Number(el.getAttribute('data-index')) || 0;
            this.choose(action);
          });
          KIT.audio.music('title', { fade: 400 });
        },
        exit() { if (host) { host.hidden = true; UI.clear(host); } if (this._off) this._off(); },
        choose(action) {
          KIT.audio.play('select');
          if (action === 'settings') { KIT.scenes.run('menu', { mode: 'settings' }); return; }
          this.finish(action);
        },
        input(ev) {
          const step = (d) => {
            for (let n = 0; n < items.length; n++) {
              index = (index + d + items.length) % items.length;
              if (!items[index].disabled) break;
            }
            KIT.audio.play('blip');
            refresh();
          };
          if (ev.key === 'up' || ev.key === 'left') step(-1);
          else if (ev.key === 'down' || ev.key === 'right') step(1);
          else if (ev.key === 'a' || ev.key === 'menu') this.choose(items[index].action);
          return true;
        },
      };
    },
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
