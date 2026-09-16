// dungeon/panel — the "Dungeon" panel in Creator Mode: what is in this floor,
// which switches the gates are listening for, and every number the module
// turns. Contract: docs/EDITOR-CONTRACT.md.
//
// Nothing here writes to the project directly: every change goes through
// KIT.editor.commit (+ afterEdit), so undo covers all of it.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const D = KIT.dungeon = KIT.dungeon || {};
  const ED = KIT.editor = KIT.editor || {};
  const UI = KIT.ui;
  if (!UI || typeof document === 'undefined') return;              // headless: nothing to mount

  const make = UI.make;

  function edit(label, fn) {
    if (typeof ED.panelEdit === 'function') return ED.panelEdit(label, fn);
    const out = ED.commit(label, fn);
    if (ED.afterEdit) ED.afterEdit();
    return out;
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
  function button(label, onTap) {
    const b = make('button.ed-btn', { text: label });
    b.type = 'button';
    b.onclick = (e) => { e.preventDefault(); onTap(e); };
    return b;
  }

  const panel = {
    id: 'dungeon', label: 'Dungeon', icon: 'door', order: 47,

    mount(el, ed) {
      UI.clear(el);
      this.root = make('div.ed-panel-body');
      this.floorSec = section('This floor', 'Everything the Dungeon module has put on the maps of this game.');
      this.switchSec = section('Switches and gates', 'Every plate name in the game, and the gates waiting for it.');
      this.tuneSec = section('The numbers', 'The dark, the lantern and the sounds. They live in the project, not in the code.');
      this.root.appendChild(this.floorSec);
      this.root.appendChild(this.switchSec);
      this.root.appendChild(this.tuneSec);
      el.appendChild(this.root);
      this.refresh(ed);
    },

    onSelect(sel, ed) { this.refresh(ed); },

    refresh(ed) {
      if (!this.root) return;
      const st = (ed && ed.state) || ED.state;
      if (!st || !st.project) return;
      this.renderFloor(st);
      this.renderSwitches(st);
      this.renderTuning(st);
    },

    // ---- what is on the maps ------------------------------------------------------
    renderFloor(st) {
      const body = UI.clear(this.floorSec.body);
      const counts = D.describe(st.project, {});
      if (!counts.doors && !counts.blocks && !counts.switches && !counts.gates) {
        body.appendChild(make('p.ed-hint', { text: 'Nothing yet. Add a “Locked door”, a “Pushable block”, a “Switch plate” or a “Gate” from the Events panel — or use the “Switch and gate” quick-create.' }));
        return;
      }
      const row = (label, n) => { const r = make('div.ed-row'); r.appendChild(make('span', { text: label })); r.appendChild(make('span.ed-hint', { text: String(n) })); body.appendChild(r); };
      row('Locked doors', counts.doors);
      row('Pushable blocks', counts.blocks);
      row('Switch plates', counts.switches);
      row('Gates', counts.gates);
    },

    // ---- the wiring ----------------------------------------------------------------
    renderSwitches(st) {
      const body = UI.clear(this.switchSec.body);
      const names = D.switchNames(st.project);
      const gates = [];
      for (const map of Object.values(st.project.maps || {})) {
        for (const obj of map.objects || []) {
          if (obj.type !== 'dungeon-gate') continue;
          const needs = String(((obj.pages || [])[0] || {}).props && obj.pages[0].props.needs || '').split(',').map(s => s.trim()).filter(Boolean);
          gates.push({ map: map.id, obj, needs });
        }
      }
      if (!names.length && !gates.length) {
        body.appendChild(make('p.ed-hint', { text: 'No plates and no gates yet.' }));
        return;
      }
      for (const name of names) {
        const listeners = gates.filter(g => g.needs.includes(name));
        const row = make('div.ed-row');
        row.appendChild(make('strong', { text: name }));
        row.appendChild(make('span.ed-hint', { text: listeners.length ? `${listeners.length} gate${listeners.length > 1 ? 's' : ''}` : 'nothing listens' }));
        body.appendChild(row);
      }
      for (const g of gates) {
        const orphan = g.needs.filter(n => !names.includes(n));
        if (!orphan.length) continue;
        body.appendChild(button(`⚠ ${g.obj.name || g.obj.id} waits for “${orphan.join(', ')}” — show it`, () => {
          if (g.map !== st.mapId) ED.openMap(g.map);
          ED.select({ kind: 'object', map: g.map, id: g.obj.id });
        }));
      }
    },

    // ---- the numbers, straight from the schema ---------------------------------------
    renderTuning(st) {
      const body = UI.clear(this.tuneSec.body);
      const insp = ED.inspector;
      const value = (st.project.packs && st.project.packs.dungeon) || D.contentDefaults();
      if (!insp || typeof insp.mount !== 'function') {
        body.appendChild(make('p.ed-hint', { text: 'The inspector is not loaded, so the numbers cannot be shown here. They live in project.packs.dungeon.' }));
        return;
      }
      insp.mount(body, {
        fields: D.TUNING,
        value,
        ctx: { project: st.project },
        onChange: (next) => edit('Dungeon numbers', (doc) => doc.set(['packs', 'dungeon'], next)),
      });
    },
  };

  let done = false;
  D.registerPanel = function () {
    if (done) return;
    done = true;
    KIT.registry('editorPanels').add(panel);
  };
  D.PANEL = panel;

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
