// home/panel — the "Home" panel in Creator Mode: the furniture catalogue, the
// jobs on the board you have selected, and the numbers that tune the whole
// module. Contract: docs/EDITOR-CONTRACT.md.
//
// Nothing here writes to the project directly: every change goes through
// KIT.editor.panelEdit (commit + refresh + autosave), so undo covers all of it.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const H = KIT.home = KIT.home || {};
  const ED = KIT.editor = KIT.editor || {};
  const UI = KIT.ui;
  if (!UI || typeof document === 'undefined') return;                 // headless: nothing to mount

  const make = UI.make;
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

  function edit(label, fn) {
    if (typeof ED.panelEdit === 'function') return ED.panelEdit(label, fn);
    const out = ED.commit(label, fn);
    if (ED.afterEdit) ED.afterEdit();
    return out;
  }
  function button(label, onTap, cls) {
    const b = make('button.ed-btn' + (cls ? '.' + cls : ''), { text: label });
    b.type = 'button';
    b.onclick = (e) => { e.preventDefault(); onTap(e); };
    return b;
  }
  function field(label, input, hint) {
    const wrap = make('label.ed-field');
    wrap.appendChild(make('span', { text: label }));
    wrap.appendChild(input);
    if (hint) wrap.appendChild(make('span.ed-hint', { text: hint }));
    return wrap;
  }
  function input(type, value, onChange) {
    const el = make('input');
    el.type = type;
    el.value = value == null ? '' : String(value);
    el.onchange = () => onChange(el.value);
    return el;
  }
  function checkbox(value, onChange) {
    const el = make('input');
    el.type = 'checkbox';
    el.checked = !!value;
    el.onchange = () => onChange(el.checked);
    return el;
  }
  function select(options, value, onChange) {
    const el = make('select');
    for (const o of options) {
      const opt = make('option', { text: o.label });
      opt.value = o.value;
      if (String(o.value) === String(value)) opt.selected = true;
      el.appendChild(opt);
    }
    el.onchange = () => onChange(el.value);
    return el;
  }
  function section(title, hint) {
    const box = make('div.ed-sec');
    box.appendChild(make('h4.ed-h4', { text: title }));
    if (hint) box.appendChild(make('p.ed-hint', { text: hint }));
    const body = make('div.ed-sec-body');
    box.appendChild(body);
    box.body = body;
    return box;
  }

  const panel = {
    id: 'home', label: 'Home', icon: 'house', order: 46,

    mount(el, ed) {
      UI.clear(el);
      this.root = make('div.ed-panel-body');
      this.jobsSec = section('Jobs on this board', 'Select a job board on the map to fill in its list.');
      this.furnSec = section('Furniture', 'Bag items your player can carry home and put down.');
      this.tuneSec = section('The numbers', 'Every dial the Home module turns. They live in the project, not the code.');
      this.giftSec = section('Presents', 'Where a friend leaves a present, and what it might be.');
      this.root.appendChild(this.jobsSec);
      this.root.appendChild(this.furnSec);
      this.root.appendChild(this.giftSec);
      this.root.appendChild(this.tuneSec);
      el.appendChild(this.root);
      this.refresh(ed);
    },

    onSelect(sel, ed) { this.refresh(ed); },

    refresh(ed) {
      if (!this.root) return;
      const st = (ed && ed.state) || ED.state;
      if (!st || !st.project) return;
      this.renderJobs(st);
      this.renderFurniture(st);
      this.renderGifts(st);
      this.renderTuning(st);
    },

    // ---- the selected board ---------------------------------------------------
    selectedBoard(st) {
      const sel = st.selection;
      if (!sel || (sel.kind !== 'object' && sel.kind !== 'page')) return null;
      const map = st.project.maps[sel.map];
      if (!map) return null;
      const i = (map.objects || []).findIndex(o => o.id === sel.id);
      if (i < 0 || map.objects[i].type !== 'job-board') return null;
      const pageIndex = sel.kind === 'page' ? sel.page : Math.max(0, map.objects[i].pages.length - 1);
      return { map: sel.map, id: sel.id, index: i, pageIndex, object: map.objects[i], page: map.objects[i].pages[pageIndex] };
    },

    renderJobs(st) {
      const body = this.jobsSec.body;
      UI.clear(body);
      const board = this.selectedBoard(st);
      if (!board) {
        const boards = [];
        for (const mapId of Object.keys(st.project.maps)) {
          for (const o of st.project.maps[mapId].objects || []) if (o.type === 'job-board') boards.push({ mapId, o });
        }
        if (!boards.length) {
          body.appendChild(make('p.ed-hint', { text: 'No job board anywhere yet. Add one from the Events panel (“Job board”) and the jobs list appears here.' }));
          return;
        }
        body.appendChild(make('p.ed-hint', { text: 'Pick a board to edit its jobs:' }));
        const list = make('div.ed-list');
        for (const b of boards) {
          list.appendChild(button(`${b.o.name || b.o.id} · ${b.mapId}`, () => {
            if (b.mapId !== st.mapId) ED.openMap(b.mapId);
            ED.select({ kind: 'object', map: b.mapId, id: b.o.id });
          }));
        }
        body.appendChild(list);
        return;
      }

      const path = ['maps', board.map, 'objects', board.index, 'pages', board.pageIndex, 'props', 'jobs'];
      const jobs = (board.page.props && Array.isArray(board.page.props.jobs)) ? board.page.props.jobs : [];
      body.appendChild(make('p.ed-hint', { text: `${board.object.name || board.object.id} · page ${board.pageIndex + 1}` }));

      jobs.forEach((raw, i) => {
        const job = H.jobTemplate(raw, i);
        const card = make('div.ed-card');
        const head = make('div.ed-obj-head');
        head.appendChild(make('strong', { text: job.title || job.id }));
        head.appendChild(button('Remove', () => {
          edit('Remove job', (doc) => doc.splice(path, i, 1, []));
        }, 'ed-danger'));
        card.appendChild(head);
        const set = (key, value) => edit('Edit job', (doc) => doc.set(path.concat(i, key), value));
        card.appendChild(field('Title', input('text', job.title, (v) => set('title', v))));
        card.appendChild(field('Id', input('text', job.id, (v) => set('id', KIT.slug(v) || v)), 'Conditions ask about this.'));
        card.appendChild(field('What it is', input('text', job.desc, (v) => set('desc', v))));
        card.appendChild(field('Minutes', input('number', job.minutes, (v) => set('minutes', Math.max(1, num(v, 60)))), 'In-game minutes.'));
        card.appendChild(field('The friend it needs', input('text', job.needs, (v) => set('needs', v)), 'Blank = anyone.'));
        card.appendChild(field('The type it suits', input('text', job.suits, (v) => set('suits', v)), 'A matching friend is quicker.'));
        card.appendChild(field('Reward', select(
          [{ value: '', label: '— nothing —' }].concat(Object.keys(st.project.items || {}).map(id => ({ value: id, label: st.project.items[id].name || id }))),
          job.reward || '', (v) => set('reward', v || null))));
        card.appendChild(field('How many', input('number', job.count, (v) => set('count', Math.max(1, num(v, 1))))));
        card.appendChild(field('Switch when done', select(
          [{ value: '', label: '— none —' }].concat(Object.keys(st.project.vars || {}).map(n => ({ value: n, label: (st.project.vars[n].label || n) }))),
          job.flag || '', (v) => set('flag', v || null))));
        card.appendChild(field('Can be taken again', checkbox(job.repeatable, (v) => set('repeatable', v))));
        body.appendChild(card);
      });

      body.appendChild(button('Add a job', () => {
        const next = H.jobTemplate({ id: '', title: 'A new errand' }, jobs.length);
        edit('Add job', (doc) => {
          if (!Array.isArray(doc.get(path))) doc.set(path, []);
          doc.push(path, next);
        });
      }, 'ed-primary'));
    },

    // ---- the furniture catalogue -------------------------------------------------
    renderFurniture(st) {
      const body = this.furnSec.body;
      UI.clear(body);
      const items = st.project.items || {};
      const furniture = H.furnitureItems(st.project);
      if (!furniture.length) body.appendChild(make('p.ed-hint', { text: 'No furniture yet. Turn a bag item into furniture below and give it a tile.' }));

      for (const f of furniture) {
        const card = make('div.ed-card');
        const head = make('div.ed-obj-head');
        head.appendChild(make('strong', { text: f.item.name || f.id }));
        head.appendChild(make('span.ed-hint', { text: f.id }));
        card.appendChild(head);
        const base = ['items', f.id, 'props'];
        const props = f.item.props || {};
        card.appendChild(field('Layer', select(
          [{ value: 'ground', label: 'Ground' }, { value: 'deco', label: 'Deco' }, { value: 'above', label: 'Above' }],
          props.layer || 'deco', (v) => edit('Furniture layer', (doc) => doc.set(base.concat('layer'), v)))));
        card.appendChild(field('Solid', checkbox(props.solid !== false, (v) => edit('Furniture solid', (doc) => doc.set(base.concat('solid'), v)))));

        const variants = H.variants(f.item);
        const vList = make('div.ed-list');
        variants.forEach((v, i) => {
          const row = make('div.ed-list-row');
          row.appendChild(make('span.ed-hint', { text: `${i + 1}.` }));
          row.appendChild(input('text', v.tile, (val) => edit('Furniture tile', (doc) => doc.set(base.concat('variants', i, 'tile'), val))));
          row.appendChild(input('text', v.tile2 || '', (val) => edit('Furniture tile', (doc) => doc.set(base.concat('variants', i, 'tile2'), val || null))));
          row.appendChild(select([{ value: 'down', label: '↓' }, { value: 'right', label: '→' }], v.dir, (val) => edit('Furniture shape', (doc) => doc.set(base.concat('variants', i, 'dir'), val))));
          if ((props.variants || []).length > 1) row.appendChild(button('×', () => edit('Remove look', (doc) => doc.splice(base.concat('variants'), i, 1, []))));
          vList.appendChild(row);
        });
        card.appendChild(make('p.ed-hint', { text: 'Each row is one look: the tile, an optional second tile, and where that second tile sits.' }));
        card.appendChild(vList);
        card.appendChild(button('Add a look', () => edit('Add look', (doc) => {
          const list = doc.get(base.concat('variants'));
          if (!Array.isArray(list)) doc.set(base.concat('variants'), []);
          doc.push(base.concat('variants'), { label: '', tile: variants[0].tile, tile2: null, dir: 'down' });
        })));
        body.appendChild(card);
      }

      const others = Object.keys(items).filter(id => items[id].kind !== 'furniture');
      if (others.length) {
        const row = make('div.ed-list-row');
        const pick = select([{ value: '', label: '— pick an item —' }].concat(others.map(id => ({ value: id, label: items[id].name || id }))), '', () => {});
        row.appendChild(pick);
        row.appendChild(button('Make it furniture', () => {
          const id = pick.value;
          if (!id) return;
          edit('Make furniture', (doc) => {
            doc.set(['items', id, 'kind'], 'furniture');
            doc.set(['items', id, 'props'], { variants: [{ label: '', tile: 'plant', tile2: null, dir: 'down' }], layer: 'deco', solid: true });
          });
        }));
        body.appendChild(row);
      }
    },

    // ---- presents -----------------------------------------------------------------
    renderGifts(st) {
      const body = this.giftSec.body;
      UI.clear(body);
      const pack = H.pack(st.project);
      const spot = pack.giftSpot || {};
      const maps = Object.keys(st.project.maps || {});
      body.appendChild(field('Map', select([{ value: '', label: '— where the story starts —' }].concat(maps.map(m => ({ value: m, label: m }))), spot.map || '',
        (v) => edit('Gift spot', (doc) => doc.set(['packs', 'home', 'giftSpot'], v ? { map: v, x: num(spot.x, 0), y: num(spot.y, 0) } : null)))));
      if (spot.map) {
        body.appendChild(field('X', input('number', num(spot.x, 0), (v) => edit('Gift spot', (doc) => doc.set(['packs', 'home', 'giftSpot', 'x'], num(v, 0))))));
        body.appendChild(field('Y', input('number', num(spot.y, 0), (v) => edit('Gift spot', (doc) => doc.set(['packs', 'home', 'giftSpot', 'y'], num(v, 0))))));
      }
      body.appendChild(field('What they might leave', input('text', (pack.giftItems || []).join(', '),
        (v) => edit('Gift items', (doc) => doc.set(['packs', 'home', 'giftItems'], v.split(',').map(s => s.trim()).filter(Boolean)))), 'Item ids, separated by commas.'));
    },

    // ---- the tuning numbers ----------------------------------------------------------
    renderTuning(st) {
      const body = this.tuneSec.body;
      UI.clear(body);
      const tuning = H.tuning(st.project);
      for (const f of H.TUNING) {
        const path = ['packs', 'home', 'tuning', f.key];
        const value = tuning[f.key];
        const widget = f.type === 'bool'
          ? checkbox(value, (v) => edit('Tune Home', (doc) => doc.set(path, v)))
          : input('number', value, (v) => edit('Tune Home', (doc) => doc.set(path, num(v, f.default))));
        body.appendChild(field(f.label || f.key, widget, f.doc));
      }
      body.appendChild(button('Back to the defaults', () => edit('Reset Home numbers', (doc) => doc.set(['packs', 'home', 'tuning'], H.tuningDefaults()))));
    },
  };

  /** registerPanel() — called by register.js when the project enables this module. */
  H.registerPanel = function () { KIT.registry('editorPanels').add(Object.assign({ replace: true }, panel)); };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
