// Creator Mode — the panels a writer lives in:
//
//   Scripts          the Common Events (call / auto / parallel), with their conditions
//   Fragments        the notebook: notes, snippets, ideas — and "use this"
//   Dialogue Review  every line of text in the whole game, in one editable table
//   Problems         the validator, grouped, with a plain-English "what this means"
//
// Everything writes through KIT.editor.ops / ED.commit, so every edit is one
// undo step and the same patch the inspector would make.
//
// The indexes at the top are pure and are what test/kit/editor-script.test.js drives.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const ED = KIT.editor = KIT.editor || {};
  const W = ED.writing = ED.writing || {};
  const P = KIT.project;
  const S = KIT.schema;

  const titleCase = KIT.titleCase;

  // =================================================================================
  // Pure: the dialogue index
  // =================================================================================

  /** The first line of a piece of text, short enough for a table row. */
  W.firstLine = function (text, n) {
    const raw = String(text == null ? '' : text);
    const line = ((KIT.text && KIT.text.strip ? KIT.text.strip(raw) : raw).split(/\r?\n/).find(l => l.trim()) || '').trim();
    const max = n || 60;
    return line.length > max ? line.slice(0, max - 1) + '…' : line;
  };

  /**
   * textIndex(project) -> [{ id, path, text, kind, field, label, where, speaker }]
   *
   * Every `text`-typed field in the project: every command's text fields (say,
   * comment, choice prompt, chapter card, scrolling text…), every choice option's
   * text, item descriptions, fragment bodies and the pitch. `path` is the document
   * path, so writing a row is exactly the patch the inspector would make.
   */
  W.textIndex = function (project) {
    const out = [];
    if (!project) return out;
    const commands = KIT.registry.exists('commands') ? KIT.registry('commands') : null;
    const push = (e) => { e.id = e.path.join('/'); e.first = W.firstLine(e.text); out.push(e); };

    const whereLabel = (where) => {
      if (where.script) {
        const sc = (project.scripts || {})[where.script] || {};
        return `Common Event · ${sc.label || where.script}`;
      }
      const map = (project.maps || {})[where.map] || {};
      const obj = (map.objects || []).find(o => o.id === where.object) || {};
      const bits = [map.name || where.map, obj.name || where.object];
      if (where.page != null) bits.push(`page ${where.page + 1}`);
      if (where.slot) bits.push(KIT.project.slotLabel(where.slot));
      return bits.filter(Boolean).join(' · ');
    };

    if (commands) {
      P.walkCommands(project, (cmd, where) => {
        if (!KIT.isObject(cmd)) return;
        const def = commands.get(cmd.t);
        if (!def) return;
        const label = whereLabel(where);
        for (const f of S.fields(def.fields || [])) {
          if (f.type !== 'text') continue;
          push({ path: where.path.concat(f.key), text: cmd[f.key] == null ? '' : String(cmd[f.key]), kind: 'command',
            command: cmd.t, field: f.key, label, fieldLabel: `${KIT.labelOf(def, null, cmd.t)}${f.key === 'text' ? '' : ' · ' + (f.label || titleCase(f.key))}`,
            speaker: cmd.t === 'say' ? (cmd.who || '') : '', where: Object.assign({}, where) });
        }
        if (cmd.t === 'choice' && Array.isArray(cmd.options)) {
          cmd.options.forEach((opt, i) => {
            push({ path: where.path.concat('options', i, 'text'), text: (opt && opt.text) || '', kind: 'option', command: 'choice',
              field: 'text', label, fieldLabel: `Option ${i + 1}`, speaker: '', where: Object.assign({}, where) });
          });
        }
      });
    }
    for (const id of Object.keys(project.items || {})) {
      const it = project.items[id] || {};
      push({ path: ['items', id, 'desc'], text: it.desc == null ? '' : String(it.desc), kind: 'item', field: 'desc',
        label: `Item · ${it.name || id}`, fieldLabel: 'Description', speaker: '', where: { item: id } });
    }
    (project.fragments || []).forEach((f, i) => {
      push({ path: ['fragments', i, 'body'], text: f.body == null ? '' : String(f.body), kind: 'fragment', field: 'body',
        label: `Fragment · ${f.title || f.id}`, fieldLabel: titleCase(f.kind || 'note'), speaker: '', where: { fragment: f.id } });
    });
    push({ path: ['meta', 'pitch'], text: (project.meta && project.meta.pitch) || '', kind: 'project', field: 'pitch',
      label: 'Project · Pitch', fieldLabel: 'Two sentences', speaker: '', where: {} });
    return out;
  };

  /** selectionFor(entry) -> what ED.select() should be given to jump to a row. */
  W.selectionFor = (entry) => ED.ops.whereSelection(entry && entry.where);

  // =================================================================================
  // Pure: what a problem code means
  // =================================================================================
  const MEANINGS = {
    'no-pitch': 'Two sentences about who the hero is and what they want. It keeps the rest of the game honest.',
    'no-maps': 'A game needs at least one map. Make one in the Map panel.',
    'no-heroes': 'Nobody to play as. Add a hero in the Project panel.',
    'bad-start': 'The game starts on a map that is not there any more. Pick a start map in the Project panel.',
    'target-out-of-bounds': 'Something points at a square outside its map — a transfer, a start position or a test state.',
    'target-solid': 'It lands on a square the player cannot stand on. They would be stuck.',
    'object-out-of-bounds': 'This Event sits outside the map. Drag it back in.',
    'duplicate-object': 'Two Events on one map share an id, so scripts that name it would pick the wrong one.',
    'unknown-object-type': 'This Event has a type the kit does not know (a module may be switched off).',
    'no-pages': 'Every Event needs at least one Event Page.',
    'unknown-slot': 'A script is filed under a trigger the engine does not run.',
    'unknown-command': 'A command in this script is not one the kit knows. It is kept, but it will be skipped.',
    'bad-command': 'A command is missing its type. Open it in the script editor and fix the line.',
    'blocking-in-background': 'Parallel and Every Tick scripts run in the background; they may not show text or wait.',
    'empty-text': 'A message with no words shows an empty box to the player.',
    'undeclared-var': 'A Switch/Variable is used but never declared. Declare it in Variables so it has a type and a default.',
    'unknown-tile': 'A square uses a tile that no longer exists — often after an import was removed.',
    'unknown-terrain': 'A terrain number is painted that has no entry in the terrain list.',
    'bad-layer': 'A map layer has the wrong number of squares. Resizing again usually fixes it.',
    'bad-region': 'Region numbers run from 0 to 255.',
    'soft-lock': 'This runs whenever its condition passes but never changes it, so it fires again every time.',
    'too-many-ticks': 'Every Tick scripts run every frame. More than a few and the game crawls.',
    'connection-blocked': 'Two maps are joined but nothing walkable leads across the seam.',
    'connection-mismatch': 'The edges of two joined maps disagree about where you can walk.',
    'unknown-map': 'Something points at a map that is not in the project.',
    'unknown-item-kind': 'This item has a kind no module defines.',
    'duplicate-terrain': 'Two terrains claim the same number.',
    'max-count': 'More of this kind of Event than its type allows.',
    'schema': 'A field holds the wrong sort of value (a number where text is expected, and so on).',
    'bad-target': 'A transfer or a Move Route points at nothing.',
    'bad-pattern': 'An autotile rule does not have the right number of cells for its size.',
    'bad-connection': 'Two maps are joined in a way that does not line up.',
    'bad-map-id': 'A map is filed under one id but calls itself another.',
    'newer-version': 'This project was saved by a newer kit than this one.',
    'no-migration': 'This project is too old to be upgraded automatically.',
    'validator-threw': 'A module’s own validator failed. The project is probably fine; the module is not.',
    'not-an-object': 'The project file could not be read at all.',
    'ui-base-missing': 'The look this game starts from is not here any more, so the game uses Kit’s look underneath its own changes.',
    'ui-base-cycle': 'Two looks are each built on the other. The circle is cut where it was found.',
    'ui-base-deep': 'Looks are built on looks more than eight deep; the ones past eight are left out.',
    'ui-bad-value': 'A value in the look is not one the engine can use — not a colour, or not one of the choices — so it is left out and the look underneath shows.',
    'ui-contrast': 'Two colours in the look are too close to read one on the other. Look › Colours: make one lighter or the other darker.',
    'ui-lines': 'The message box would cover a lot of the game on a phone. Look › Message box: fewer lines, or a smaller portrait.',
    'ui-ref': 'The look names a sound or a voice this game does not have, so it stays quiet or sounds ordinary. Look › Sounds: pick one it has.',
  };
  /** explain(code) -> the "what does this mean" line under a problem. */
  W.explain = function (code) {
    if (MEANINGS[code]) return MEANINGS[code];
    if (/^unknown-/.test(code)) return `Something points at a ${code.replace('unknown-', '')} that does not exist.`;
    return 'The validator flagged this. It never stops you saving or playing.';
  };

  /** Turn a validator problem into a selection to jump to. */
  W.problemSelection = (p) => ED.ops.whereSelection(p && p.where);

  // =================================================================================
  // Pure: fragments
  // =================================================================================
  /** fragmentTags(project) -> every tag in use, with a count. */
  W.fragmentTags = function (project) {
    const counts = new Map();
    for (const f of (project && project.fragments) || []) for (const t of f.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
    return Array.from(counts, ([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
  };
  /** matchFragment(f, { query, tag, folder }) */
  W.matchFragment = function (f, q) {
    q = q || {};
    if (q.tag && !(f.tags || []).includes(q.tag)) return false;
    if (q.folder != null && q.folder !== '' && (f.folder || '') !== q.folder) return false;
    const s = String(q.query || '').trim().toLowerCase();
    if (!s) return true;
    return `${f.title || ''} ${f.body || ''} ${(f.tags || []).join(' ')} ${f.folder || ''}`.toLowerCase().indexOf(s) >= 0;
  };
  /**
   * fragmentToSlot(doc, { fragment, path, remove }) -> { added, problems }
   * Drops a fragment's body into an open command list, parsed as Screenplay.
   */
  W.fragmentToSlot = function (doc, o) {
    const frags = doc.get(['fragments']) || [];
    const i = frags.findIndex(f => f.id === o.fragment);
    if (i < 0 || !o.path) return { added: 0, problems: [] };
    const parsed = KIT.screenplay.parse(frags[i].body || '');
    const current = doc.get(o.path);
    const list = Array.isArray(current) ? current : [];
    doc.transaction('Use fragment', () => {
      if (!Array.isArray(current)) doc.set(o.path, []);
      doc.splice(o.path, list.length, 0, parsed.commands);
      if (o.remove) doc.splice(['fragments'], i, 1, []);
    });
    return { added: parsed.commands.length, problems: parsed.problems };
  };

  // =================================================================================
  // The panels (browser only below here)
  // =================================================================================
  const make = (spec, opts) => KIT.ui.make(spec, opts);
  const clear = (el) => KIT.ui.clear(el);
  const INS = () => ED.inspector;
  const btn = (...args) => ED.inspector.btn(...args);
  const commit = (label, fn) => ED.commit(label, fn);
  const project = () => ED.state.project;
  function setAt(path, value, label) { commit(label || 'Edit', (doc, O) => O.setField(doc, path, value, label || 'Edit')); }
  /** A textarea that grows with its text and only writes after a pause. */
  function growArea(value, onChange, rows) {
    const ta = make('textarea.ed-grow');
    ta.rows = rows || 2;
    ta.value = value == null ? '' : String(value);
    let timer = null;
    const fire = () => { timer = null; onChange(ta.value); };
    ta.oninput = () => { if (timer) clearTimeout(timer); timer = setTimeout(fire, 500); grow(ta); };
    ta.onblur = () => { if (timer) { clearTimeout(timer); fire(); } };
    setTimeout(() => grow(ta), 0);
    return ta;
  }
  function grow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(260, Math.max(44, ta.scrollHeight + 2)) + 'px'; }
  /**
   * Is the author typing inside this panel? Writing to the document re-renders
   * everything, and rebuilding a field under a caret is horrible — so a panel
   * that holds text waits until the field is left alone.
   */
  const typingIn = (el) => ED.inspector.typingIn(el);

  // ---------------------------------------------------------------- Scripts ----------
  KIT.registry('editorPanels').add({
    id: 'scripts', label: 'Common Events', icon: 'script', order: 30,
    mount(host) {
      clear(host);
      const el = this._el = {};
      const head = make('div.ed-row');
      el.search = ED.inspector.searchBox('Find a Common Event…');
      el.search.oninput = () => { this._sig = ''; this.refresh(ED); };
      head.appendChild(el.search);
      head.appendChild(btn('＋ New', 'A new Common Event', () => {
        const id = commit('New Common Event', (doc, O) => O.newCommonEvent(doc, { label: 'New script' }));
        ED.select({ kind: 'script', path: ['scripts', id] });
      }, 'primary'));
      host.appendChild(head);
      host.appendChild(make('div.ed-hint', { text: 'Common Events are scripts any Event can call: an intro, a shop, a cutscene. “Auto” runs when its condition passes; “Parallel” runs in the background.' }));
      el.list = make('div.ed-list');
      host.appendChild(el.list);
      el.detail = make('div.ed-script-detail');
      host.appendChild(el.detail);
      this._form = null;
      this.refresh(ED);
    },
    refresh(ed) {
      const el = this._el;
      if (!el) return;
      const p = ed.state.project;
      const sel = ed.state.selection;
      const selId = sel && sel.kind === 'script' ? sel.path[1] : null;
      const q = (el.search.value || '').toLowerCase();
      const ids = Object.keys(p.scripts || {}).filter(id => !q || `${id} ${(p.scripts[id].label || '')}`.toLowerCase().indexOf(q) >= 0);
      const sig = JSON.stringify([ids.map(id => [id, p.scripts[id].label, p.scripts[id].trigger, (p.scripts[id].body || []).length]), selId, q]);
      if (sig !== this._sig) {
        this._sig = sig;
        clear(el.list);
        for (const id of ids) {
          const sc = p.scripts[id];
          const item = make('div.ed-item');
          item.setAttribute('aria-selected', String(id === selId));
          const body = make('div.ed-item-text');
          body.appendChild(make('span.ed-slot-name', { text: sc.label || id }));
          const bits = [];
          bits.push(sc.trigger === 'auto' ? 'Auto' : sc.trigger === 'parallel' ? 'Parallel' : 'Call');
          if (sc.when) bits.push(KIT.conditions.toText(sc.when));
          bits.push(`${(sc.body || []).length} command${(sc.body || []).length === 1 ? '' : 's'}`);
          body.appendChild(make('span.ed-hint', { text: bits.join(' · ') }));
          item.appendChild(body);
          item.appendChild(make('span.ed-badge', { text: id }));
          item.onclick = () => ED.select({ kind: 'script', path: ['scripts', id] });
          el.list.appendChild(item);
        }
        if (!ids.length) {
          el.list.appendChild(q
            ? ED.emptyState({ icon: '🔍', text: 'Nothing by that name' })
            : ED.emptyState({ icon: '📜', text: 'No Common Events yet', hint: 'A Common Event is a script kept in one place so several Events can call it — a shop, a cut-scene, the bit you keep repeating.' }));
        }
        this._detailSig = '';
      }
      renderScriptDetail(this, selId);
    },
    onSelect() { this._detailSig = ''; if (this._el) this.refresh(ED); },
  });

  function renderScriptDetail(panel, id) {
    const el = panel._el;
    const p = project();
    const sc = id ? (p.scripts || {})[id] : null;
    const sig = JSON.stringify([id, sc && sc.label, sc && sc.trigger, sc && sc.when, sc && (sc.params || []), sc && (sc.body || []).length]);
    if (sig === panel._detailSig) return;
    // The label field's own commit changes this signature; rebuilding then would
    // take the box away mid-word. A form with the caret keeps it until the blur.
    if (typingIn(el.detail)) return;
    panel._detailSig = sig;
    if (panel._form) { panel._form.destroy(); panel._form = null; }
    clear(el.detail);
    if (!sc) return;
    const head = make('div.ed-row');
    head.appendChild(make('h3.ed-obj-title', { text: sc.label || id }));
    el.detail.appendChild(head);
    const bar = make('div.ed-row');
    bar.appendChild(btn('✎ Open in the script editor', 'Write this script', () => {
      ED.select({ kind: 'script', path: ['scripts', id] });
      ED.scriptEditor.open({ path: ['scripts', id, 'body'], label: `Common Event: ${sc.label || id}`, selection: { kind: 'script', path: ['scripts', id] } });
    }, 'primary'));
    bar.appendChild(btn('⧉ Duplicate', 'Copy this Common Event', () => {
      const newId = commit('Duplicate Common Event', (doc, O) => O.newCommonEvent(doc, { id: `${id}-copy`, label: `${sc.label || id} (copy)`, trigger: sc.trigger, params: (sc.params || []).slice(), body: KIT.deepClone(sc.body || []) }));
      ED.select({ kind: 'script', path: ['scripts', newId] });
    }));
    bar.appendChild(btn('✕ Delete', 'Delete this Common Event', async () => {
      if (!(await ED.confirm(`Delete the Common Event “${sc.label || id}”?`))) return;
      commit('Delete Common Event', (doc) => doc.del(['scripts', id]));
      ED.select(null);
    }, 'danger'));
    el.detail.appendChild(bar);
    const form = make('div');
    el.detail.appendChild(form);
    panel._form = INS().mount(form, {
      fields: (P.fields.script || []).filter(f => f.key !== 'body'),
      value: sc,
      ctx: { project: p },
      onChange(path, v) { setAt(['scripts', id].concat(path), v, 'Edit Common Event'); },
    });
    el.detail.appendChild(make('div.ed-hint', { text: 'Parameters arrive in the script as {arg:name}. “Call” scripts wait for a Common Event command; “Auto” runs by itself the moment its condition passes.' }));
  }

  // -------------------------------------------------------------- Fragments ----------
  const fragState = { query: '', tag: '', folder: '', open: {} };
  KIT.registry('editorPanels').add({
    id: 'fragments', label: 'Fragments', icon: 'note', order: 35,
    mount(host) {
      clear(host);
      const el = this._el = {};
      const head = make('div.ed-row');
      el.search = ED.inspector.searchBox('Search your notes…');
      el.search.value = fragState.query;
      el.search.oninput = () => { fragState.query = el.search.value; this._sig = ''; this.refresh(ED); };
      head.appendChild(el.search);
      head.appendChild(btn('＋ Note', 'Write something down', () => {
        const id = commit('New fragment', (doc, O) => O.addFragment(doc, { title: 'Untitled', kind: 'note', body: '' }));
        fragState.open[id] = true;
        this._sig = '';
        this.refresh(ED);
      }, 'primary'));
      host.appendChild(head);
      el.tags = make('div.ed-chips');
      host.appendChild(el.tags);
      el.list = make('div.ed-frags');
      host.appendChild(el.list);
      host.appendChild(make('div.ed-hint', { text: 'Fragments are the back of the envelope: a line you overheard, a scene you cannot place yet. When one is ready, “Use this” turns it into a Common Event or drops it into the script you have open.' }));
      this.refresh(ED);
    },
    refresh(ed) {
      const el = this._el;
      if (!el) return;
      const p = ed.state.project;
      const frags = p.fragments || [];
      const openPath = ED.scriptEditor && ED.scriptEditor.target ? ED.scriptEditor.target() : null;
      const sig = JSON.stringify([frags, fragState, openPath && openPath.path]);
      if (sig === this._sig || typingIn(el.list)) return;
      this._sig = sig;
      // tag filter
      clear(el.tags);
      const all = btn(`All (${frags.length})`, 'Every fragment', () => { fragState.tag = ''; this._sig = ''; this.refresh(ed); }, 'ed-chip');
      all.className = 'ed-chip';
      all.setAttribute('aria-pressed', String(!fragState.tag));
      el.tags.appendChild(all);
      for (const t of W.fragmentTags(p)) {
        const c = make('button.ed-chip', { text: `#${t.tag} ${t.n}` });
        c.type = 'button';
        c.setAttribute('aria-pressed', String(fragState.tag === t.tag));
        c.onclick = () => { fragState.tag = fragState.tag === t.tag ? '' : t.tag; this._sig = ''; this.refresh(ed); };
        el.tags.appendChild(c);
      }
      // list, grouped by folder
      clear(el.list);
      const shown = frags.map((f, i) => ({ f, i })).filter(({ f }) => W.matchFragment(f, fragState));
      const folders = new Map();
      for (const entry of shown) {
        const key = entry.f.folder || '';
        if (!folders.has(key)) folders.set(key, []);
        folders.get(key).push(entry);
      }
      if (!shown.length) {
        el.list.appendChild(frags.length
          ? ED.emptyState({ icon: '🔍', text: 'Nothing matches that' })
          : ED.emptyState({ icon: '📓', text: 'The notebook is empty', hint: 'Write the first line of dialogue you hear in your head. It can become an Event later.' }));
      }
      for (const [folder, entries] of Array.from(folders).sort((a, b) => a[0].localeCompare(b[0]))) {
        if (folder) el.list.appendChild(make('div.ed-h4', { text: `📁 ${folder}` }));
        for (const { f, i } of entries) el.list.appendChild(fragCard(f, i, openPath, this));
      }
    },
  });

  function fragCard(f, index, openPath, panel) {
    const card = make('div.ed-frag');
    const open = !!fragState.open[f.id];
    const head = make('div.ed-frag-head');
    const title = make('button.ed-frag-title', { text: f.title || 'Untitled' });
    title.type = 'button';
    title.onclick = () => { fragState.open[f.id] = !open; panel._sig = ''; panel.refresh(ED); };
    head.appendChild(title);
    head.appendChild(make('span.ed-badge', { text: titleCase(f.kind || 'note') }));
    card.appendChild(head);
    if (!open) {
      const peek = W.firstLine(f.body, 80);
      card.appendChild(make('div.ed-frag-peek', { text: peek || 'empty' }));
      if ((f.tags || []).length) {
        const tags = make('div.ed-frag-tags');
        for (const t of f.tags) tags.appendChild(make('span.ed-badge', { text: `#${t}` }));
        card.appendChild(tags);
      }
      return card;
    }
    const path = ['fragments', index];
    const t = make('input.ed-frag-title-input');
    t.type = 'text';
    t.value = f.title || '';
    t.placeholder = 'Title';
    t.onchange = () => setAt(path.concat('title'), t.value, 'Rename fragment');
    card.appendChild(t);
    card.appendChild(growArea(f.body, (v) => setAt(path.concat('body'), v, 'Edit fragment'), 4));
    card.appendChild(make('div.ed-sub', { text: 'Kind · folder · tags' }));
    const row = make('div.ed-row');
    const kind = make('select');
    for (const k of ['note', 'dialogue', 'audio', 'image', 'map-idea']) {
      const o = make('option', { text: titleCase(k) });
      o.value = k;
      kind.appendChild(o);
    }
    kind.value = f.kind || 'note';
    kind.onchange = () => setAt(path.concat('kind'), kind.value, 'Fragment kind');
    row.appendChild(kind);
    const folder = make('input.ed-half');
    folder.type = 'text';
    folder.placeholder = 'Folder';
    folder.value = f.folder || '';
    folder.onchange = () => setAt(path.concat('folder'), folder.value, 'File fragment');
    row.appendChild(folder);
    const tags = make('input.ed-half');
    tags.type = 'text';
    tags.placeholder = 'tags, comma, separated';
    tags.value = (f.tags || []).join(', ');
    tags.onchange = () => setAt(path.concat('tags'), tags.value.split(',').map(s => s.trim()).filter(Boolean), 'Tag fragment');
    row.appendChild(tags);
    card.appendChild(row);
    const use = make('div.ed-row.ed-frag-use');
    use.appendChild(btn('▶ Make a Common Event', 'Read this as Screenplay and file it under Scripts', () => {
      const r = commit('Fragment → Common Event', (doc, O) => O.fragmentToScript(doc, { fragment: f.id }));
      if (!r) return ED.toast('That fragment could not be read');
      ED.select({ kind: 'script', path: ['scripts', r.script] });
      ED.toast(r.problems.length ? `Made “${r.script}” — ${r.problems.length} line(s) kept as raw text` : `Made the Common Event “${r.script}”`);
    }, 'primary'));
    if (openPath && openPath.path) {
      use.appendChild(btn(`↳ Add to ${openPath.label || 'the open script'}`, 'Drop these lines at the end of the script the editor has open', () => {
        const r = commit('Use fragment', (doc) => W.fragmentToSlot(doc, { fragment: f.id, path: openPath.path }));
        ED.toast(`${r.added} command${r.added === 1 ? '' : 's'} added${r.problems.length ? ` · ${r.problems.length} raw line(s)` : ''}`);
      }));
    }
    use.appendChild(btn('✕', 'Delete this fragment', async () => {
      if (!(await ED.confirm(`Delete “${f.title || f.id}”?`))) return;
      commit('Delete fragment', (doc) => doc.splice(['fragments'], index, 1, []));
    }, 'danger'));
    card.appendChild(use);
    return card;
  }

  // ------------------------------------------------------- Dialogue Review ----------
  const dlgState = { query: '', only: 'all' };
  KIT.registry('editorPanels').add({
    id: 'dialogue', label: 'Dialogue', icon: 'speech', order: 40,
    mount(host) {
      clear(host);
      const el = this._el = {};
      const head = make('div.ed-row');
      el.search = ED.inspector.searchBox('Search every line in the game…');
      el.search.value = dlgState.query;
      el.search.oninput = () => { dlgState.query = el.search.value; this._sig = ''; this.refresh(ED); };
      head.appendChild(el.search);
      host.appendChild(head);
      const filters = make('div.ed-seg');
      for (const f of [{ id: 'all', label: 'All' }, { id: 'say', label: 'Dialogue' }, { id: 'empty', label: 'Empty' }]) {
        const b = make('button', { text: f.label });
        b.type = 'button';
        b.dataset.only = f.id;
        b.onclick = () => { dlgState.only = f.id; this._sig = ''; this.refresh(ED); };
        filters.appendChild(b);
      }
      el.filters = filters;
      host.appendChild(filters);
      el.count = make('div.ed-hint');
      host.appendChild(el.count);
      el.list = make('div.ed-dlg-list');
      host.appendChild(el.list);
      this.refresh(ED);
    },
    refresh(ed) {
      const el = this._el;
      if (!el) return;
      // Typing in a row must never redraw the rows out from under the cursor —
      // checked FIRST, before any work. And textIndex() visits every piece of
      // text in the game (48,000 lines at OMORI scale) while this refresh runs
      // after every commit anywhere in the editor; the document's change counter
      // says whether anything could have changed for a fraction of that.
      if (typingIn(el.list)) return;
      const version = (ed.state.doc ? ed.state.doc.seq : -1) + '|' + JSON.stringify(dlgState);
      if (version === this._version && this._sig) return;
      const rows = W.textIndex(ed.state.project);
      const q = dlgState.query.trim().toLowerCase();
      const shown = rows.filter(r => {
        if (dlgState.only === 'say' && !(r.command === 'say' || r.kind === 'option')) return false;
        if (dlgState.only === 'empty' && String(r.text).trim()) return false;
        if (!q) return true;
        return `${r.text} ${r.label} ${r.speaker}`.toLowerCase().indexOf(q) >= 0;
      });
      const sig = JSON.stringify([shown.map(r => [r.id, r.text, r.label]), dlgState]);
      this._version = version;
      if (sig === this._sig) return;
      this._sig = sig;
      for (const b of el.filters.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.only === dlgState.only));
      const words = rows.reduce((n, r) => n + (String(r.text).trim() ? String(r.text).trim().split(/\s+/).length : 0), 0);
      el.count.textContent = `${shown.length} of ${rows.length} pieces of text · about ${words} words in the whole game`;
      clear(el.list);
      for (const r of shown.slice(0, 400)) el.list.appendChild(dialogueRow(r));
      if (shown.length > 400) el.list.appendChild(make('div.ed-hint', { text: `…and ${shown.length - 400} more. Search to narrow it down.` }));
      if (!shown.length) el.list.appendChild(ED.emptyState({ icon: '💬', text: 'No words yet', hint: 'Every Show Text, choice, item description and note in the game lands in this table.' }));
    },
  });

  function dialogueRow(r) {
    const row = make('div.ed-dlg');
    const head = make('div.ed-dlg-head');
    head.appendChild(make('span.ed-dlg-where', { text: r.label }));
    const tags = make('div.ed-dlg-tags');
    tags.appendChild(make('span.ed-badge', { text: r.fieldLabel }));
    if (r.speaker) tags.appendChild(make('span.ed-badge.ed-speaker', { text: r.speaker }));
    head.appendChild(btn('→', 'Go to it', () => {
      const sel = W.selectionFor(r);
      // The third hand-written "jump to a thing", and the only one that forgot
      // this: a selection on another map is invisible until that map is open.
      if (sel.map && ED.state.mapId !== sel.map && ED.state.project.maps[sel.map]) ED.openMap(sel.map);
      ED.select(sel);
      if (sel.kind === 'slot' || sel.kind === 'script') ED.scriptEditor.open({ path: KIT.editor.scriptEditor.pathForSelection(project(), sel), label: KIT.editor.scriptEditor.labelForSelection(project(), sel), selection: sel });
      else if (sel.kind === 'object') ED.set({ panel: 'objects' });
      else if (sel.kind === 'item') ED.set({ panel: 'items' });
      else if (sel.kind === 'fragment') ED.set({ panel: 'fragments' });
      else ED.set({ panel: 'project' });
    }, 'tiny'));
    row.appendChild(head);
    row.appendChild(tags);
    const ta = growArea(r.text, (v) => setAt(r.path, v, 'Edit text'), 1);
    if (!String(r.text).trim()) ta.classList.add('is-empty');
    ta.placeholder = 'empty — the player would see a blank box';
    row.appendChild(ta);
    return row;
  }

  // --------------------------------------------------------------- Problems ----------
  KIT.registry('editorPanels').add({
    id: 'problems', label: 'Problems', icon: 'warn', order: 62,
    mount(host) {
      clear(host);
      const el = this._el = {};
      el.head = make('div.ed-row');
      host.appendChild(el.head);
      el.body = make('div.ed-problems');
      host.appendChild(el.body);
      this.refresh(ED);
    },
    refresh(ed) {
      const el = this._el;
      if (!el) return;
      const problems = ed.state.problems || [];
      const sig = JSON.stringify(problems);
      if (sig === this._sig) return;
      this._sig = sig;
      clear(el.head);
      clear(el.body);
      const errs = problems.filter(p => p.severity === 'error');
      const warns = problems.filter(p => p.severity === 'warn');
      const infos = problems.filter(p => p.severity !== 'error' && p.severity !== 'warn');
      el.head.appendChild(make('span.ed-badge' + (errs.length ? '.warn' : ''), { text: `${errs.length} error${errs.length === 1 ? '' : 's'}` }));
      el.head.appendChild(make('span.ed-badge', { text: `${warns.length} warning${warns.length === 1 ? '' : 's'}` }));
      el.head.appendChild(btn('↻ Check again', 'Run the validator now', () => {
        ED.set({ problems: P.validate(ed.state.project) || [] });
        this._sig = '';
        this.refresh(ED);
      }, 'tiny'));
      if (!problems.length) {
        el.body.appendChild(ED.emptyState({ icon: '✓', text: 'Nothing to fix', hint: 'The validator never stops you playing anyway — it is a to-do list, not a gate.' }));
        return;
      }
      for (const [label, list, cls] of [['Errors', errs, ''], ['Warnings', warns, 'warn'], ['Notes', infos, 'info']]) {
        if (!list.length) continue;
        el.body.appendChild(make('div.ed-h4', { text: `${label} (${list.length})` }));
        const byCode = new Map();
        for (const p of list) { if (!byCode.has(p.code)) byCode.set(p.code, []); byCode.get(p.code).push(p); }
        for (const [code, ps] of byCode) {
          const group = make('div.ed-prob-group');
          const head = make('div.ed-row.ed-prob-code');
          head.appendChild(make('span.ed-badge', { text: code }));
          head.appendChild(make('span.ed-badge', { text: String(ps.length) }));
          group.appendChild(head);
          group.appendChild(make('div.ed-hint.ed-prob-mean', { text: W.explain(code) }));
          for (const p of ps.slice(0, 30)) {
            const item = make('div.ed-problem' + (cls ? '.' + cls : ''));
            item.appendChild(make('div.ed-prob-msg', { text: p.message }));
            const w = p.where || {};
            const bits = [];
            if (w.map) bits.push(`map ${w.map}`);
            if (w.object) bits.push(`event ${w.object}`);
            if (w.page != null) bits.push(`page ${w.page + 1}`);
            if (w.slot) bits.push(KIT.project.slotLabel(w.slot));
            if (w.script) bits.push(`script ${w.script}`);
            if (!bits.length && Array.isArray(w.path) && w.path.length) bits.push(w.path.join('.'));
            if (bits.length) item.appendChild(make('div.ed-sub', { text: bits.join(' · ') }));
            item.onclick = () => jumpTo(p);
            group.appendChild(item);
          }
          if (ps.length > 30) group.appendChild(make('div.ed-hint', { text: `…and ${ps.length - 30} more of these.` }));
          el.body.appendChild(group);
        }
      }
    },
  });

  function jumpTo(p) {
    const sel = W.problemSelection(p);
    const w = p.where || {};
    if (w.map && ED.state.mapId !== w.map && ED.state.project.maps[w.map]) ED.openMap(w.map);
    ED.select(sel);
    if (sel.kind === 'object' || sel.kind === 'slot') ED.set({ panel: 'objects' });
    else if (sel.kind === 'script') ED.set({ panel: 'scripts' });
    else if (sel.kind === 'map') ED.set({ panel: 'map' });
    else if (sel.kind === 'look') ED.set({ panel: 'look' });
    else ED.set({ panel: 'project' });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
