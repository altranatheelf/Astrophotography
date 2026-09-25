// "Start your own game" — the door on the front page.
//
// It is one screen with one big button per blueprint, because the thing it
// replaces was five taps and a keyboard: Creator Mode, the Game group, the
// Project panel, a folded-up section, a text field, a button. On a phone that
// is enough friction to end the idea. Here the name is optional — it is filled
// in for you — so the shortest path through this screen is a single tap.
//
// The one exception is a device that already has a game saved on it. Then the
// tap repaints this screen as "this replaces that one", because the person most
// likely to press a button labelled "start your own game" out of curiosity is
// the person who already started one. Somebody opening this for the first time
// never sees it, and for them it stays one tap.
//
// It resolves with { blueprint, title } or null for "changed my mind".
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const UI = KIT.ui;
  const scenes = KIT.registry('scenes');

  scenes.add({
    id: 'start', name: 'Start your own game',
    create() {
      let host = null, items = [], index = 0, nameEl = null, typed = '';
      let project = {}, hasWork = false, asking = null;

      const T = (key, vars) => KIT.strings.get(project, key, vars);
      const refresh = () => UI.select(host.querySelector('.kit-menu-list'), index);
      const titleFor = (id) => typed || (KIT.blueprints ? KIT.blueprints.titleFor(id) : '');

      /** The list of things you can start with. */
      function paintList() {
        UI.clear(host);
        const inner = UI.make('div.kit-title-inner.kit-start');
        inner.appendChild(UI.make('h1.kit-title', { text: T('start-own') }));
        inner.appendChild(UI.make('p.kit-hint', { text: T('start-own-hint') }));

        // The name box comes first so it is obvious it is there, and is left
        // alone so it is obvious it is optional: blank means the blueprint's own
        // name, which is a real name, not "Untitled". Not focused on purpose —
        // a phone keyboard sliding up over the buttons is the opposite of one tap.
        nameEl = UI.make('input.kit-start-name');
        nameEl.type = 'text';
        nameEl.setAttribute('aria-label', T('start-own-title'));
        nameEl.placeholder = T('start-own-title');
        nameEl.value = typed;
        nameEl.oninput = () => { typed = String(nameEl.value || '').trim(); };
        inner.appendChild(nameEl);

        const list = UI.make('div.kit-menu-list');
        const defs = (KIT.blueprints && KIT.blueprints.list()) || [];
        items = defs.map(b => ({ action: 'make:' + b.id, label: KIT.labelOf(b, null, b.id), describe: b.describe || '' }));
        items.push({ action: 'back', label: T('back'), describe: '' });
        mount(list, items);
        inner.appendChild(list);
        host.appendChild(inner);
        index = 0;
        refresh();
      }

      /** The second screen, and only when there is something to lose. */
      function paintAsk(id) {
        const was = (project.meta && project.meta.title) || '';
        const title = titleFor(id);
        UI.clear(host);
        nameEl = null;
        const inner = UI.make('div.kit-title-inner.kit-start');
        inner.appendChild(UI.make('h1.kit-title', { text: T('start-own-replaces', { was }) }));
        inner.appendChild(UI.make('p.kit-hint', { text: T('start-own-undo', { was }) }));
        const list = UI.make('div.kit-menu-list');
        items = [
          { action: 'go:' + id, label: T('start-own-go', { title }), describe: '' },
          { action: 'list', label: T('start-own-keep'), describe: '' },
        ];
        mount(list, items);
        inner.appendChild(list);
        host.appendChild(inner);
        index = 1;                          // the safe one is the one you land on
        refresh();
      }

      function mount(list, rows) {
        rows.forEach((it, i) => {
          const b = UI.make('button.kit-uibtn.kit-menu-item.kit-start-item');
          b.type = 'button';
          b.setAttribute('data-action', it.action);
          b.setAttribute('data-index', String(i));
          b.appendChild(UI.make('span.kit-start-name-line', { text: it.label }));
          if (it.describe) b.appendChild(UI.make('span.kit-start-describe', { text: it.describe }));
          list.appendChild(b);
        });
      }

      return {
        id: 'start', transparent: false,
        enter(params) {
          project = (params && params.project) || (KIT.game && KIT.game.project) || {};
          host = UI.el('screen-title');
          if (!host || !KIT.blueprints || !KIT.blueprints.list().length) { this.finish(null); return; }
          host.hidden = false;
          typed = ''; asking = null; hasWork = false;
          paintList();

          // Is there anything of theirs to lose? The answer arrives after the
          // screen does, which is fine: it is only needed when something is
          // tapped, and a tap takes longer than a storage read.
          Promise.resolve(KIT.storage && KIT.storage.hasDraft ? KIT.storage.hasDraft() : false)
            .then((yes) => { hasWork = !!yes; }).catch(() => { hasWork = false; });

          this._off = UI.onAction(host, (action, el) => {
            if (el.disabled) return;
            index = Number(el.getAttribute('data-index')) || 0;
            this.choose(action);
          });
        },
        exit() { if (host) { host.hidden = true; UI.clear(host); } if (this._off) this._off(); },
        choose(action) {
          KIT.look.sound('confirm');
          if (action === 'back') { this.finish(null); return; }
          if (action === 'list') { asking = null; paintList(); return; }
          if (action.indexOf('make:') === 0) {
            const id = action.slice(5);
            if (hasWork && asking !== id) { asking = id; paintAsk(id); return; }
            this.finish({ blueprint: id, title: titleFor(id) });
            return;
          }
          if (action.indexOf('go:') === 0) {
            const id = action.slice(3);
            this.finish({ blueprint: id, title: titleFor(id) });
          }
        },
        input(ev) {
          const step = (d) => { index = (index + d + items.length) % items.length; KIT.look.sound('move'); refresh(); };
          if (ev.key === 'up' || ev.key === 'left') step(-1);
          else if (ev.key === 'down' || ev.key === 'right') step(1);
          else if (ev.key === 'a') this.choose(items[index].action);
          else if (ev.key === 'b' || ev.key === 'menu') { if (asking) { asking = null; paintList(); } else this.finish(null); }
          return true;
        },
      };
    },
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
