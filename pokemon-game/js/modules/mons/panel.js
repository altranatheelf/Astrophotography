// mons/panel.js — Creator Mode's half of the module:
//
//   · an "Encounters" side panel that edits map.props.encounters per region,
//     with portraits and weights and a live "1 in N steps" reading;
//   · a field widget for ref:mon, so any field of that type gets a picker with
//     portraits instead of a dropdown of ids;
//   · a validator, so an encounter table that names a species nobody has heard
//     of shows up in Problems instead of failing quietly at play time.
//
// Every edit goes through KIT.editor.commit + KIT.editor.afterEdit, so undo
// covers it like anything else (docs/EDITOR-CONTRACT.md).
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const M = KIT.mons = KIT.mons || {};
  const UI = KIT.ui;
  const num = (v, d) => (v == null || !Number.isFinite(Number(v)) ? d : Number(v));
  const hasDom = () => typeof document !== 'undefined' && !!document.createElement;

  function make(spec, opts) { return UI.make(spec, opts); }
  /** The editor's own button look, not the runtime's (this panel lives in the dark shell). */
  function edBtn(label, title, onTap, cls) {
    const b = make('button.ed-btn' + (cls ? '.' + cls : ''), { text: label });
    b.type = 'button';
    if (title) b.title = title;
    b.onclick = onTap;
    return b;
  }
  function monCanvas(id, scale) {
    const cv = UI.artCanvas(M.portrait(id), scale || 2, M.speciesColor(id));
    cv.className = 'mons-portrait';
    return cv;
  }

  // ---- the ref:mon widget ---------------------------------------------------
  function registerFieldEditor() {
    if (!KIT.registry.exists('fieldEditors')) return;
    KIT.registry('fieldEditors').add({
      id: 'mons-ref', types: ['ref:mon'], replace: true,
      mount(el, f, value, onChange) {
        let cur = value == null ? '' : String(value);
        const wrap = make('div.ed-ref.mons-picker');
        const grid = make('div.ed-swatches');
        const swatches = [];
        if (f.nullable !== false) grid.appendChild(swatch('', '(none)'));
        for (const sp of M.speciesList()) grid.appendChild(swatch(sp.id, sp.name));
        wrap.appendChild(grid);
        const status = make('div.ed-ref-status');
        wrap.appendChild(status);
        el.appendChild(wrap);
        paint();

        function swatch(id, label) {
          const b = make('button.ed-swatch');
          b.type = 'button';
          b.title = id ? `${label} (${id})` : label;
          b.dataset.ref = id;
          if (id) b.appendChild(monCanvas(id, 1));
          else b.appendChild(make('span.ed-swatch-none', { text: '—' }));
          b.onclick = () => { cur = id; onChange(id || null); paint(); };
          swatches.push(b);
          return b;
        }
        function paint() {
          for (const b of swatches) b.setAttribute('aria-selected', String((b.dataset.ref || '') === cur));
          const sp = M.species(cur);
          status.textContent = sp ? `${sp.name} · ${M.rarityLabel(null, sp.id)} · ${(sp.types || []).join('/')}` : (cur ? `${cur} — no such species` : '');
        }
        return { set(v) { cur = v == null ? '' : String(v); paint(); } };
      },
    });
    KIT.schema.refKind('mon', {
      has(id) { return M.species(id) ? true : false; },
      list() { return M.speciesList().map(s => ({ id: s.id, label: s.name })); },
      label(id) { const s = M.species(id); return s ? s.name : String(id); },
    });
  }

  // ---- the Encounters panel ---------------------------------------------------
  function registerPanel() {
    if (!KIT.registry.exists('editorPanels')) return;
    KIT.registry('editorPanels').add({
      id: 'mons-encounters', label: 'Encounters', icon: 'grass', order: 45, replace: true,
      mount(el, ed) { this._el = el; this.refresh(ed); },
      refresh(ed) { paintPanel(this._el, ed); },
      onSelect(sel, ed) { paintPanel(this._el, ed); },
    });
  }

  /** The table as the panel edits it — always a full { byRegion, rate } object. */
  function tableOf(project, mapId) {
    const map = project && project.maps ? project.maps[mapId] : null;
    const props = (map && map.props) || {};
    const t = props.encounters;
    const out = { byRegion: {}, rate: 12 };
    if (t && typeof t === 'object') {
      out.rate = num(t.rate, 12);
      const by = t.byRegion || {};
      for (const k of Object.keys(by)) out.byRegion[k] = (by[k] || []).map(e => ({ id: e.id, weight: num(e.weight, 1) }));
    }
    return out;
  }
  /** Which regions this map actually paints (0 is "anywhere on the map"). */
  function regionsOf(map) {
    const out = new Set(['0']);
    for (const v of (map && map.layers && map.layers.regions) || []) if (v) out.add(String(v));
    return Array.from(out).sort((a, b) => Number(a) - Number(b));
  }

  const PANEL_CSS = `
.mons-panel-head h3 { font-family: var(--font-ui); font-size: 11px; margin: 0 0 4px; }
.mons-region { border-top: 1px solid rgba(255,255,255,.08); padding: 8px 0 4px; }
.mons-region h4 { font-family: var(--font-ui); font-size: 9px; margin: 0 0 6px; opacity: .8; }
.mons-entry { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
.mons-entry .mons-row-body { flex: 1 1 auto; min-width: 0; }
.mons-entry .mons-row-name { font-size: 13px; }
.mons-entry .mons-row-sub { font-size: 11px; opacity: .65; }
.mons-entry input[type=number] { width: 56px; }
.mons-picker .ed-swatches { max-height: 220px; overflow: auto; }
.mons-rate { display: flex; align-items: center; gap: 8px; }
.mons-rate input[type=range] { flex: 1 1 auto; }
`;
  function injectPanelStyle() {
    if (!hasDom() || document.getElementById('mons-editor-style')) return;
    const el = document.createElement('style');
    el.id = 'mons-editor-style';
    el.textContent = PANEL_CSS;
    document.head.appendChild(el);
  }

  function paintPanel(el, ed) {
    if (!el || !ed || !ed.state) return;
    injectPanelStyle();
    UI.clear(el);
    const project = ed.state.project;
    const mapId = ed.state.mapId;
    const map = project.maps[mapId];
    if (!map) return;
    const table = tableOf(project, mapId);

    const head = make('div.mons-panel-head');
    head.appendChild(make('h3', { text: M.t(project, 'mons-panel-encounters') + ' · ' + (map.name || mapId) }));
    head.appendChild(make('p.ed-hint', { text: M.t(project, 'mons-panel-hint') }));
    el.appendChild(head);

    // rate
    const rateRow = make('div.ed-row.mons-rate');
    rateRow.appendChild(make('label', { text: 'Rate' }));
    const rate = document.createElement('input');
    rate.type = 'range'; rate.min = '0'; rate.max = '60'; rate.step = '1';
    rate.value = String(table.rate);
    const rateOut = make('span.ed-ref-status', { text: rateText(table.rate) });
    rate.oninput = () => { rateOut.textContent = rateText(Number(rate.value)); };
    rate.onchange = () => { write(ed, mapId, (t) => { t.rate = Number(rate.value); }); };
    rateRow.appendChild(rate);
    rateRow.appendChild(rateOut);
    el.appendChild(rateRow);

    // one block per region
    for (const region of regionsOf(map)) {
      const block = make('div.mons-region');
      const title = make('h4', { text: region === '0' ? 'Anywhere' : 'Region ' + region });
      block.appendChild(title);
      const list = table.byRegion[region] || [];
      if (!list.length) block.appendChild(make('p.ed-hint', { text: 'Nobody lives here yet.' }));
      const total = list.reduce((n, e) => n + num(e.weight, 1), 0) || 1;
      for (const entry of list) {
        const row = make('div.ed-row.mons-entry');
        row.appendChild(monCanvas(entry.id, 2));
        const label = make('div.mons-row-body');
        label.appendChild(make('div.mons-row-name', { text: M.speciesName(entry.id) }));
        label.appendChild(make('div.mons-row-sub', { text: Math.round(num(entry.weight, 1) / total * 100) + '% · ' + M.rarityLabel(project, entry.id) }));
        row.appendChild(label);
        const w = document.createElement('input');
        w.type = 'number'; w.min = '0'; w.max = '99'; w.value = String(num(entry.weight, 1));
        w.className = 'ed-small-input';
        w.onchange = () => write(ed, mapId, (t) => {
          const l = t.byRegion[region] || (t.byRegion[region] = []);
          const e = l.find(x => x.id === entry.id);
          if (e) e.weight = Math.max(0, Number(w.value) || 0);
        });
        row.appendChild(w);
        row.appendChild(edBtn('✕', 'Take ' + M.speciesName(entry.id) + ' out of this table', () => write(ed, mapId, (t) => {
          t.byRegion[region] = (t.byRegion[region] || []).filter(x => x.id !== entry.id);
          if (!t.byRegion[region].length) delete t.byRegion[region];
        })));
        block.appendChild(row);
      }
      const add = make('div.ed-row');
      const sel = document.createElement('select');
      for (const sp of M.speciesList()) {
        const o = document.createElement('option');
        o.value = sp.id;
        o.textContent = `${sp.name} · ${M.rarityLabel(project, sp.id)}`;
        sel.appendChild(o);
      }
      add.appendChild(sel);
      add.appendChild(edBtn('＋ Add', 'Put this one in the table', () => write(ed, mapId, (t) => {
        const l = t.byRegion[region] || (t.byRegion[region] = []);
        if (!l.some(e => e.id === sel.value)) l.push({ id: sel.value, weight: 5 });
      })));
      block.appendChild(add);
      el.appendChild(block);
    }
  }
  function rateText(n) { return n <= 0 ? 'never' : `about 1 in ${Math.max(1, Math.round(100 / n))} steps`; }

  /** Every write is one undo step, and tells the editor to revalidate. */
  function write(ed, mapId, fn) {
    const table = tableOf(ed.state.project, mapId);
    fn(table);
    ed.commit('Encounters', (doc, O) => O.setField(doc, ['maps', mapId, 'props', 'encounters'], table, 'Encounters'));
    if (typeof ed.afterEdit === 'function') ed.afterEdit();
    if (typeof ed.refresh === 'function') ed.refresh();
  }

  // ---- the validator ---------------------------------------------------------
  function registerValidator() {
    if (!KIT.registry.exists('validators')) return;
    KIT.registry('validators').add({
      id: 'mons-encounters', name: 'Encounter tables', replace: true,
      run(project) {
        const out = [];
        for (const mapId of Object.keys((project && project.maps) || {})) {
          const map = project.maps[mapId];
          const table = M.encounterTable(map, project);
          if (!table) continue;
          const where = { map: mapId, path: ['maps', mapId, 'props', 'encounters'] };
          let any = false;
          for (const region of Object.keys(table.byRegion)) {
            for (const e of table.byRegion[region]) {
              if (e.weight > 0) any = true;
              if (!M.species(e.id)) out.push({ severity: 'error', code: 'unknown-species', message: `map ${mapId}: encounter table names '${e.id}', which is not a species`, where });
            }
          }
          if (table.rate > 0 && !any) out.push({ severity: 'warn', code: 'empty-encounters', message: `map ${mapId}: the encounter rate is ${table.rate} but nobody is in the table`, where });
        }
        return out;
      },
    });
  }

  // ---- the legacy table, on the map panel ------------------------------------
  // A v2 project's encounters were migrated to `packs.mons.encounters[mapId]`
  // and the runtime still reads them (rules.js) as the fallback for a project
  // that has not been re-authored. The KIT used to draw this editor itself,
  // inside js/kit/editor/panels-map.js, reading this module's pack shape — the
  // engine's editor knowing one module's content, which ADR-0005 records as a
  // crack in its own decision. The kit offers a registry now and this is the
  // module's own code sitting in it.
  /**
   * legacyEncounters(project, mapId) -> the old-format table, or null.
   * On the module rather than inside the section, so it can be checked without
   * a browser — the section itself is DOM and cannot be.
   */
  M.legacyEncounters = function (project, mapId) {
    const p = project || {};
    const t = ((p.packs && p.packs.mons && p.packs.mons.encounters) || {})[mapId];
    return t && Array.isArray(t.table) && t.table.length ? t : null;
  };
  const legacyTable = (project, mapId) => M.legacyEncounters(project, mapId);
  function registerMapSection() {
    if (!KIT.registry.exists('mapSections')) return;
    KIT.registry('mapSections').add({
      id: 'mons-legacy-encounters', label: 'Wild encounters (from the old format)', order: 20, replace: true,
      when(project, mapId) { return !!legacyTable(project, mapId); },
      render(body, ctx) {
        const t = legacyTable(ctx.project, ctx.mapId);
        if (!t) return;
        const list = make('div.ed-list');
        t.table.forEach((row, i) => {
          const item = make('div.ed-item');
          item.appendChild(make('strong', { text: String(row.mon || row.id || '?') }));
          item.appendChild(cell('text', row.level == null ? '' : String(row.level), 'Level',
            (v) => set(ctx, i, 'level', v)));
          item.appendChild(cell('number', row.weight == null ? 1 : row.weight, 'How often, next to the others',
            (v) => set(ctx, i, 'weight', Number(v) || 0)));
          list.appendChild(item);
        });
        body.appendChild(list);
        body.appendChild(make('p.ed-hint', {
          text: 'These came from an older project file and the game still reads them. The Encounters panel is where new ones go.',
        }));
      },
    });
  }
  function cell(type, value, title, onChange) {
    const el = make('input.ed-small-input');
    el.type = type;
    el.value = value == null ? '' : String(value);
    el.title = title;
    el.onchange = () => onChange(el.value);
    return el;
  }
  function set(ctx, i, key, value) {
    ctx.ed.commit(`Encounter ${key}`, (doc, O) => O.setField(doc, ['packs', 'mons', 'encounters', ctx.mapId, 'table', i, key], value, `Encounter ${key}`));
    if (KIT.editor.afterEdit) KIT.editor.afterEdit();
  }

  /** registerEditor() — the panel, the widget and the validator, when there is a page. */
  M.registerEditor = function () {
    registerFieldEditor();
    registerValidator();
    if (!hasDom()) return;
    registerPanel();
    registerMapSection();
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
