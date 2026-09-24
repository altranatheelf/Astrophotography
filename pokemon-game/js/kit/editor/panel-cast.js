// Creator Mode — the Cast panel.
//
// A cast is only worth having if you can SEE it. This panel is that view: every
// person, what they know and who told them, how they feel about everybody else,
// and — the other way round — every fact and who has heard it.
//
// It shows the game as it is RIGHT NOW when a game is running, and as it is
// WRITTEN when one is not, and says which. That distinction is the whole use of
// it: "Mira should know by now" is a question about the run, and "Mira starts
// out knowing" is a question about the project.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const ED = KIT.editor = KIT.editor || {};
  if (!KIT.registry || !KIT.registry.exists('editorPanels')) return;

  const make = (spec, opts) => KIT.ui.make(spec, opts);
  const clear = (el) => KIT.ui.clear(el);
  const titleCase = KIT.titleCase;

  const btn = (...args) => ED.inspector.btn(...args);
  const section = (host, title, open, build) => ED.inspector.section(host, title, open, build).box;

  /**
   * The save to read. A running game's, when there is one: then the panel is a
   * window into the story as it actually stands. Otherwise an empty one seeded
   * from the project, which is the story as written.
   */
  function saveFor(project) {
    const live = KIT.game && KIT.game.world && KIT.game.world.save;
    if (live) return { save: live, live: true };
    return { save: KIT.cast.start(project, { vars: {} }), live: false };
  }

  const state = { view: 'people', query: '', open: {}, adding: false, draft: '' };
  const P = () => KIT.project;
  const INS = () => ED.inspector;
  const commit = (label, fn) => ED.commit(label, fn);
  const setAt = (path, v, label) => commit(label, (doc) => doc.set(path, v));
  /** A fresh id from a name: 'Old Mira' -> 'old-mira', and '-2' if that is taken. */
  function freshId(table, name, fallback) {
    const base = KIT.slug(name || '') || fallback;
    let id = base, n = 2;
    while (table[id]) id = `${base}-${n++}`;
    return id;
  }

  KIT.registry('editorPanels').add({
    id: 'cast', label: 'Cast', icon: 'npc', order: 56,
    mount(host) {
      this._host = host;
      host.addEventListener('focusout', () => { if (this._stale) setTimeout(() => { if (this._stale && !host.contains(document.activeElement)) this.refresh(ED); }, 0); });
      this.refresh(ED);
    },
    refresh(ed) {
      const host = this._host;
      if (!host || !KIT.cast) return;
      const project = ed.state.project;
      const { save, live } = saveFor(project);
      const graph = KIT.cast.graph(project, save);

      // Redrawing on every keystroke elsewhere would fight the search box.
      const sig = JSON.stringify([state.view, state.query, state.adding, live, graph, project.cast, project.facts]);
      if (sig === this._sig) return;
      // The caret comes first. A form's own commit changes the cast, which changes
      // the signature, which used to rebuild the panel under the person typing;
      // and the search box rebuilt itself on every letter. A form with the caret
      // waits for the blur; the search box is rebuilt and given the caret back.
      const active = document.activeElement;
      const inSearch = !!(active && host.contains(active) && active.classList.contains('ed-obj-search'));
      if (!inSearch && ED.inspector.typingIn(host)) { this._stale = true; return; }
      const caret = inSearch ? active.selectionStart : 0;
      this._sig = sig;
      this._stale = false;
      ED.inspector.destroyForms(this._forms);
      this._forms = [];
      clear(host);
      if (inSearch) setTimeout(() => { const box = host.querySelector('.ed-obj-search'); if (box) { box.focus(); try { box.setSelectionRange(caret, caret); } catch (e) { /* ignore */ } } }, 0);

      host.appendChild(make('div.ed-hint', {
        text: live
          ? 'The story as it stands in the game you are playing. Close the game to see it as written.'
          : 'The story as written: what everyone starts out knowing. Play, and this shows what has happened since.',
      }));

      const tabs = make('div.ed-chips');
      for (const [id, label] of [['people', 'People'], ['facts', 'What is known']]) {
        const c = btn((state.view === id ? '✓ ' : '') + label, null, () => { state.view = id; this._sig = ''; this.refresh(ED); }, 'ed-chip');
        c.setAttribute('aria-pressed', String(state.view === id));
        tabs.appendChild(c);
      }
      host.appendChild(tabs);

      const head = make('div.ed-row.ed-obj-head');
      const search = ED.inspector.searchBox(state.view === 'people' ? 'Find somebody' : 'Find something known');
      search.value = state.query;
      search.oninput = () => { state.query = search.value; this._sig = ''; this.refresh(ED); };
      head.appendChild(search);
      const people = state.view === 'people';
      // The cast is written here, not in the Data panel: a name is enough to start.
      if (!live) head.appendChild(btn(people ? '＋ New person' : '＋ New fact', people ? 'Add somebody to the cast' : 'Write down something a person can know', () => { state.adding = true; state.draft = ''; this._sig = ''; this.refresh(ED); }, 'primary'));
      host.appendChild(head);
      if (state.adding && !live) host.appendChild(addBox(this, project, people));

      const q = state.query.trim().toLowerCase();
      if (people) drawPeople(host, project, graph, q, live, this);
      else drawFacts(host, project, graph, q, live, this);

      if (people && !graph.people.length && !state.adding) {
        host.appendChild(ED.emptyState({ icon: '👥', text: 'Nobody in the cast yet', hint: 'A person is a name and what they know when the story starts. Add one with ＋ New person, or write @tell in a script and they appear here.' }));
      }
      if (!people && !graph.facts.length && !state.adding) {
        host.appendChild(ED.emptyState({ icon: '💡', text: 'Nothing to know yet', hint: 'A fact is something a person can know — “the gate is open”. Write one down with ＋ New fact, or @tell it to somebody in a script.' }));
      }
    },
  });

  /** The one-line form under ＋ New: a name (or a fact's label), Add, Cancel. */
  function addBox(panel, project, people) {
    const box = make('div.ed-preset-form.ed-cast-add');
    const input = make('input');
    input.type = 'text';
    input.placeholder = people ? 'Their name — Mira, Old Tomas, the Baker' : 'What is known — The gate is open';
    input.value = state.draft;
    input.oninput = () => { state.draft = input.value; };
    const done = () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      if (people) {
        const id = freshId(project.cast || {}, name, 'person');
        commit('New person', (doc) => doc.set(['cast', id], Object.assign(KIT.schema.fill(P().fields.person, { name }), { id })));
        state.open[id] = true;
      } else {
        const id = freshId(project.facts || {}, name, 'fact');
        commit('New fact', (doc) => doc.set(['facts', id], Object.assign(KIT.schema.fill(P().fields.fact, { label: name }), { id })));
        state.open['fact:' + id] = true;
      }
      state.adding = false; state.draft = '';
      input.blur();                              // the caret guard would otherwise keep the old panel until the blur
      panel._sig = ''; panel.refresh(ED);
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); done(); } if (e.key === 'Escape') { state.adding = false; input.blur(); panel._sig = ''; panel.refresh(ED); } };
    box.appendChild(input);
    const row = make('div.ed-row');
    row.appendChild(btn(people ? '＋ Add them' : '＋ Write it down', null, done, 'primary'));
    row.appendChild(btn('Cancel', null, () => { state.adding = false; state.draft = ''; input.blur(); panel._sig = ''; panel.refresh(ED); }));
    box.appendChild(row);
    setTimeout(() => input.focus(), 0);
    return box;
  }

  /** The editable side of a person or a fact: the same form the rest of the editor uses. */
  function editForm(panel, body, fields, value, path, label, onDelete) {
    const form = make('div.ed-cast-form');
    body.appendChild(form);
    panel._forms.push(INS().mount(form, {
      fields, value, ctx: { project: ED.state.project },
      onChange(p, v) { setAt(path.concat(p), v, label); },
    }));
    body.appendChild(btn('✕ Delete', 'Remove from the project', onDelete, 'danger'));
  }

  function drawPeople(host, project, graph, q, live, panel) {
    const people = graph.people.filter(p => !q || p.name.toLowerCase().includes(q) || p.id.includes(q));
    for (const person of people) {
      const def = (project.cast || {})[person.id] || null;
      const title = `${person.name}${person.met ? '' : ' · not met'}`;
      const box = section(host, title, state.open[person.id] === true, (body) => {
        if (def && live) {
          if (def.pronouns) body.appendChild(make('div.ed-sub', { text: def.pronouns }));
          if (def.group) body.appendChild(make('div.ed-sub', { text: def.group }));
          if (def.note) body.appendChild(make('div.ed-note-text', { text: def.note }));
        }
        if (!def && !live) {
          // Somebody a script @tells but the cast does not list: one tap writes them down.
          const b = btn('＋ Write them down', 'Add them to the cast so they have a name of their own', () => {
            commit('New person', (doc) => doc.set(['cast', person.id], Object.assign(KIT.schema.fill(P().fields.person, { name: person.name }), { id: person.id })));
            state.open[person.id] = true; panel._sig = ''; panel.refresh(ED);
          });
          body.appendChild(b);
        }

        body.appendChild(make('div.ed-panel-title', { text: 'Knows' }));
        if (!person.knows.length) body.appendChild(make('div.ed-sub', { text: 'Nothing yet.' }));
        for (const k of person.knows) {
          const row = make('div.ed-item');
          row.appendChild(make('span.ed-item-name', { text: k.label }));
          const from = k.from ? `from ${KIT.cast.nameOf(project, k.from)}` : 'worked it out';
          row.appendChild(make('span.ed-item-value', { text: from }));
          body.appendChild(row);
        }

        body.appendChild(make('div.ed-panel-title', { text: 'Feels' }));
        if (!person.feels.length) body.appendChild(make('div.ed-sub', { text: 'Nothing about anybody.' }));
        for (const f of person.feels) {
          const row = make('div.ed-item');
          row.appendChild(make('span.ed-item-name', { text: f.name }));
          const bar = make('span.ed-feel');
          const fill = make('span.ed-feel-fill');
          fill.style.width = Math.abs(f.value) / 2 + '%';
          fill.style.marginLeft = f.value < 0 ? (50 - Math.abs(f.value) / 2) + '%' : '50%';
          fill.classList.add(f.value < 0 ? 'is-cold' : 'is-warm');
          bar.appendChild(fill);
          row.appendChild(bar);
          row.appendChild(make('span.ed-item-value', { text: `${f.band.label} ${f.value > 0 ? '+' : ''}${f.value}` }));
          body.appendChild(row);
        }
        if (def && !live) {
          body.appendChild(make('div.ed-panel-title', { text: 'As written' }));
          editForm(panel, body, P().fields.person, def, ['cast', person.id], 'Edit person', async () => {
            if (!(await ED.confirm(`Remove “${person.name}” from the cast?`))) return;
            commit('Delete person', (doc) => doc.del(['cast', person.id]));
            delete state.open[person.id]; panel._sig = ''; panel.refresh(ED);
          });
        }
      });
      box.addEventListener('toggle', () => { state.open[person.id] = box.open; });
    }
    if (q && !people.length) host.appendChild(make('div.ed-sub', { text: 'Nobody by that name.' }));
  }

  function drawFacts(host, project, graph, q, live, panel) {
    const facts = graph.facts.filter(f => !q || f.label.toLowerCase().includes(q) || f.id.includes(q));
    for (const fact of facts) {
      const key = 'fact:' + fact.id;
      const who = fact.knownBy.length ? fact.knownBy.map(id => KIT.cast.nameOf(project, id)).join(', ') : 'nobody knows';
      const box = section(host, `${fact.label}${fact.secret ? ' · secret' : ''} — ${who}`, state.open[key] === true, (body) => {
        const def = (project.facts || {})[fact.id];
        if (!fact.declared) {
          const b = make('div.ed-sub', { text: 'Somebody knows this, but it is not written down, so it has no label of its own.' });
          body.appendChild(b);
          if (!live) body.appendChild(btn('＋ Write it down', 'Give it a label and a note', () => {
            commit('New fact', (doc) => doc.set(['facts', fact.id], Object.assign(KIT.schema.fill(P().fields.fact, { label: titleCase(fact.id) }), { id: fact.id })));
            state.open[key] = true; panel._sig = ''; panel.refresh(ED);
          }));
          return;
        }
        body.appendChild(make('div.ed-sub', { text: fact.knownBy.length ? `Known by ${who}.` : 'Nobody knows this yet.' }));
        if (def && !live) editForm(panel, body, P().fields.fact, def, ['facts', fact.id], 'Edit fact', async () => {
          if (!(await ED.confirm(`Forget “${fact.label}” everywhere?`))) return;
          commit('Delete fact', (doc) => doc.del(['facts', fact.id]));
          delete state.open[key]; panel._sig = ''; panel.refresh(ED);
        });
      });
      box.addEventListener('toggle', () => { state.open[key] = box.open; });
    }
    if (q && !facts.length) host.appendChild(make('div.ed-sub', { text: 'Nothing by that name.' }));
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
