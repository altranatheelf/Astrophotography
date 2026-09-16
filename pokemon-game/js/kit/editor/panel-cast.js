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
  const titleCase = (id) => String(id || '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  function btn(label, title, fn, cls) {
    const b = make('button.ed-btn' + (cls ? '.' + cls : ''), { text: label });
    b.type = 'button';
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); fn(e); };
    return b;
  }
  function section(host, title, open, build) {
    const box = make('details.ed-sec');
    box.open = open !== false;
    box.appendChild(make('summary', { text: title }));
    const body = make('div.ed-sec-body');
    box.appendChild(body);
    host.appendChild(box);
    build(body);
    return box;
  }

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

  const state = { view: 'people', query: '', open: {} };

  KIT.registry('editorPanels').add({
    id: 'cast', label: 'Cast', icon: 'npc', order: 56,
    mount(host) { this._host = host; this.refresh(ED); },
    refresh(ed) {
      const host = this._host;
      if (!host || !KIT.cast) return;
      const project = ed.state.project;
      const { save, live } = saveFor(project);
      const graph = KIT.cast.graph(project, save);

      // Redrawing on every keystroke elsewhere would fight the search box.
      const sig = JSON.stringify([state.view, state.query, live, graph]);
      if (sig === this._sig && document.activeElement && host.contains(document.activeElement)) return;
      this._sig = sig;
      clear(host);

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

      const search = make('input.ed-obj-search');
      search.type = 'search';
      search.placeholder = state.view === 'people' ? 'Find somebody' : 'Find something known';
      search.value = state.query;
      search.oninput = () => { state.query = search.value; this._sig = ''; this.refresh(ED); };
      host.appendChild(search);

      const q = state.query.trim().toLowerCase();
      if (state.view === 'people') drawPeople(host, project, graph, q, live);
      else drawFacts(host, project, graph, q);

      if (!graph.people.length) {
        host.appendChild(make('div.ed-empty', {
          text: 'Nobody yet. A person is an entry in project.cast — a name, and what they know when the story starts. Add one in the Data panel, or write @tell in a script and come back.',
        }));
      }
    },
  });

  function drawPeople(host, project, graph, q, live) {
    const people = graph.people.filter(p => !q || p.name.toLowerCase().includes(q) || p.id.includes(q));
    for (const person of people) {
      const def = (project.cast || {})[person.id] || {};
      const title = `${person.name}${person.met ? '' : ' · not met'}`;
      const box = section(host, title, state.open[person.id] === true, (body) => {
        if (def.pronouns) body.appendChild(make('div.ed-sub', { text: def.pronouns }));
        if (def.group) body.appendChild(make('div.ed-sub', { text: def.group }));
        if (def.note) body.appendChild(make('div.ed-note-text', { text: def.note }));

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
      });
      box.addEventListener('toggle', () => { state.open[person.id] = box.open; });
    }
    if (q && !people.length) host.appendChild(make('div.ed-sub', { text: 'Nobody by that name.' }));
  }

  function drawFacts(host, project, graph, q) {
    const facts = graph.facts.filter(f => !q || f.label.toLowerCase().includes(q) || f.id.includes(q));
    for (const fact of facts) {
      const row = make('div.ed-item');
      const name = make('span.ed-item-name', { text: fact.label });
      if (fact.secret) name.appendChild(make('span.ed-badge', { text: 'secret' }));
      if (!fact.declared) {
        const b = make('span.ed-badge.ed-chip-warn', { text: 'not written down' });
        b.title = 'Somebody knows this, but project.facts has no entry for it, so it has no label of its own.';
        name.appendChild(b);
      }
      row.appendChild(name);
      row.appendChild(make('span.ed-item-value', {
        text: fact.knownBy.length
          ? fact.knownBy.map(id => KIT.cast.nameOf(project, id)).join(', ')
          : 'nobody knows',
      }));
      host.appendChild(row);
    }
    if (q && !facts.length) host.appendChild(make('div.ed-sub', { text: 'Nothing by that name.' }));
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
