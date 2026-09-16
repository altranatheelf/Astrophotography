// Creator Mode — the script editor: one command list, two ways to look at it.
//
//   KIT.editor.scriptEditor.open(el, { path, ed })   // mount into an element
//   KIT.editor.scriptEditor.open(ref)                // { path, selection, label } — what
//                                                    // KIT.editor.inspector.openScript hands over
//
// Cards  — one card per command (KIT.commands.summary), grouped, nested branches
//          indented and collapsible, reorder / duplicate / disable / delete, and
//          the selected card's fields in the inspector right under it.
// Text   — the Screenplay view (KIT.screenplay), monospace, parsed live, problems
//          by line. Nothing is ever lost: a line that will not parse stays a raw
//          line and is shown as one.
//
// RPG Maker MV vocabulary throughout (Event Command, Conditional Branch, Common
// Event, Move Route). Everything writes through KIT.editor.ops / ED.commit, so
// undo always works and the Text view is one undo step.
//
// The top half of this file is pure (no DOM) and is what test/kit/editor-script.test.js drives.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const ED = KIT.editor = KIT.editor || {};
  const SE = ED.scriptEditor = ED.scriptEditor || {};
  const S = KIT.schema;
  const CMD = KIT.commands;

  const titleCase = (id) => String(id || '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const clone = (v) => KIT.deepClone(v);

  // =================================================================================
  // Pure parts — no DOM, no editor state.
  // =================================================================================

  /** def(id) -> the command definition, or null. */
  SE.def = (id) => (KIT.registry.exists('commands') ? KIT.registry('commands').get(id) : null) || null;

  /** newCommand(id) -> a command of that type with every default filled in. */
  SE.newCommand = function (id) {
    const def = SE.def(id);
    if (!def) return { t: id };
    const cmd = CMD.normalize({ t: id });
    // A branch always starts with its (empty) lists present, so the cards view can show them.
    for (const key of CMD.blockFields(def)) if (cmd[key] === undefined) cmd[key] = [];
    return cmd;
  };

  /** The MV name of a command, for the picker and the cards. */
  SE.labelOf = function (idOrDef) {
    const def = typeof idOrDef === 'string' ? SE.def(idOrDef) : idOrDef;
    if (!def) return titleCase(idOrDef);
    return def.mv || def.label || titleCase(def.id);
  };

  const BRANCH_LABELS = { then: 'Then', else: 'Else', body: 'Do', options: 'Choice' };
  /**
   * branches(cmd) -> [{ key, path, label, list }] — every nested command list of a
   * command, with the name the author sees ('Then', 'Else', 'Do', an option's text).
   */
  SE.branches = function (cmd) {
    const out = [];
    for (const n of CMD.nested(cmd || {})) {
      let label = BRANCH_LABELS[n.key] || titleCase(n.key);
      if (n.key === 'options' && typeof n.path[1] === 'number') {
        const opt = (cmd.options || [])[n.path[1]] || {};
        label = opt.text ? `“${opt.text}”` : `Option ${n.path[1] + 1}`;
      }
      out.push({ key: n.key, path: n.path, label, list: n.list, option: n.key === 'options' ? n.path[1] : null });
    }
    // An `if` with no else key still gets an Else branch to drop commands into.
    if (cmd && cmd.t === 'if' && !out.some(b => b.key === 'else')) out.push({ key: 'else', path: ['else'], label: 'Else', list: [], option: null });
    return out;
  };

  const DESCRIBE = [
    { test: (t) => t === 'say' || t === 'scrollText', one: 'says a line', many: (n) => `says ${n} lines` },
    { test: (t) => t === 'choice' || t === 'inputNumber' || t === 'nameEntry', one: 'asks a question', many: (n) => `asks ${n} questions` },
    { test: (t) => t === 'if', one: 'branches once', many: (n) => `branches ${n} times` },
    { test: (t) => t === 'setVar' || t === 'setSelf', one: 'sets a variable', many: (n) => `sets ${n} variables` },
    { test: (t) => t === 'give' || t === 'take', one: 'changes the bag', many: () => 'changes the bag' },
    { test: (t) => t === 'transfer', one: 'moves the player to another map', many: (n) => `transfers the player ${n} times` },
    { test: (t) => t === 'moveRoute', one: 'walks someone about', many: () => 'walks people about' },
    { test: (t) => t === 'call', one: 'calls a Common Event', many: (n) => `calls ${n} Common Events` },
  ];
  /**
   * describe(commands) -> the one-line "what this does" at the top of the editor.
   * Counts the whole tree, nested branches included.
   */
  SE.describe = function (cmds) {
    const counts = new Map();
    let total = 0;
    CMD.walk(cmds || [], (cmd) => {
      if (!KIT.isObject(cmd) || cmd.disabled) return;
      total++;
      counts.set(cmd.t, (counts.get(cmd.t) || 0) + 1);
    });
    if (!total) return 'Nothing here yet — add the first command.';
    const parts = [];
    for (const rule of DESCRIBE) {
      let n = 0;
      for (const [t, c] of counts) if (rule.test(t)) n += c;
      if (n) parts.push(n === 1 ? rule.one : rule.many(n));
    }
    if (!parts.length) return `${total} command${total > 1 ? 's' : ''}.`;
    const head = parts.slice(0, 3);
    const text = head.length === 1 ? head[0] : `${head.slice(0, -1).join(', ')} and ${head[head.length - 1]}`;
    return `This ${text}.`;
  };

  /** The Screenplay text of a command list. */
  SE.serialize = (cmds) => KIT.screenplay.serialize(cmds || []);
  /** parse(text) -> { commands, problems } (unparsable lines survive as raw commands). */
  SE.parse = (text) => KIT.screenplay.parse(text == null ? '' : text);
  /** roundTrip(cmds) — what the text view would give back. Never drops a command. */
  SE.roundTrip = (cmds) => SE.parse(SE.serialize(cmds)).commands;

  /**
   * commitText(ed, path, text, label) -> { commands, problems, changed }
   * The Text view's one door: parse the screenplay and write the command list as
   * ONE undo step. `ed` is KIT.editor (or anything with .commit and .state.doc).
   */
  SE.commitText = function (ed, path, text, label) {
    const parsed = SE.parse(text);
    const before = ed.state && ed.state.doc ? ed.state.doc.get(path) : null;
    const changed = !KIT.deepEqual(before, parsed.commands);
    if (changed) ed.commit(label || 'Edit script (text)', (doc, O) => (O || ED.ops).setScript(doc, { path, commands: parsed.commands, label: label || 'Edit script (text)' }));
    return { commands: parsed.commands, problems: parsed.problems, changed };
  };

  /** commandsAt(project, path) -> the command list at a document path (always an array). */
  SE.commandsAt = function (project, path) {
    const v = path ? KIT.path.get(project, path) : null;
    return Array.isArray(v) ? v : [];
  };

  /**
   * pathForSelection(project, sel) -> the document path of the command list a
   * selection points at, or null. { kind:'slot' } and { kind:'script' } both work.
   */
  SE.pathForSelection = function (project, sel) {
    if (!sel || !project) return null;
    if (sel.kind === 'script' && Array.isArray(sel.path)) return sel.path.concat('body');
    if (sel.kind === 'slot') {
      const map = project.maps && project.maps[sel.map];
      if (!map) return null;
      const i = (map.objects || []).findIndex(o => o.id === sel.id);
      if (i < 0) return null;
      return ['maps', sel.map, 'objects', i, 'pages', sel.page || 0, 'on', sel.slot];
    }
    return null;
  };

  /** labelForSelection(project, sel) — "Mom · On Interact", "Common Event: Meet Mom". */
  SE.labelForSelection = function (project, sel) {
    if (!sel || !project) return 'Script';
    if (sel.kind === 'script') {
      const sc = (project.scripts || {})[sel.path && sel.path[1]] || {};
      return `Common Event: ${sc.label || (sel.path && sel.path[1]) || '?'}`;
    }
    if (sel.kind === 'slot') {
      const map = project.maps && project.maps[sel.map];
      const obj = map && (map.objects || []).find(o => o.id === sel.id);
      return `${(obj && (obj.name || obj.id)) || sel.id} · ${titleCase(sel.slot)}`;
    }
    return 'Script';
  };

  // ---- list operations (one undo step each) ---------------------------------------
  const listAt = (doc, listPath) => { const v = doc.get(listPath); return Array.isArray(v) ? v : []; };

  /** insert(doc, listPath, index, cmd) — add a command to a list. */
  SE.insert = function (doc, listPath, index, cmd, label) {
    const list = listAt(doc, listPath);
    const at = KIT.clamp(index == null ? list.length : index, 0, list.length);
    if (!doc.has(listPath)) doc.set(listPath, [], { label: label || 'Add command' });
    doc.splice(listPath, at, 0, [clone(cmd)], { label: label || `Add ${SE.labelOf(cmd.t)}` });
    return at;
  };
  /** move(doc, listPath, from, to) -> did anything move? */
  SE.move = function (doc, listPath, from, to) {
    const list = listAt(doc, listPath);
    const target = KIT.clamp(to, 0, list.length - 1);
    if (from < 0 || from >= list.length || target === from) return false;
    const cmd = clone(list[from]);
    doc.transaction('Move command', () => {
      doc.splice(listPath, from, 1, []);
      doc.splice(listPath, target, 0, [cmd]);
    });
    return true;
  };
  /** duplicate(doc, listPath, index) -> the new index. */
  SE.duplicate = function (doc, listPath, index) {
    const list = listAt(doc, listPath);
    if (index < 0 || index >= list.length) return -1;
    doc.splice(listPath, index + 1, 0, [clone(list[index])], { label: 'Duplicate command' });
    return index + 1;
  };
  /** remove(doc, listPath, index) */
  SE.remove = function (doc, listPath, index) {
    const list = listAt(doc, listPath);
    if (index < 0 || index >= list.length) return false;
    doc.splice(listPath, index, 1, [], { label: 'Delete command' });
    return true;
  };
  /** setDisabled(doc, listPath, index, on) — kept in the list, skipped when the game runs. */
  SE.setDisabled = function (doc, listPath, index, on) {
    const list = listAt(doc, listPath);
    if (index < 0 || index >= list.length) return false;
    doc.set(listPath.concat(index, 'disabled'), !!on, { label: on ? 'Turn command off' : 'Turn command on' });
    return true;
  };

  // ---- the command picker ----------------------------------------------------------
  const RECENT_KEY = 'kit.editor.recentCommands';
  let recent = null;
  function readRecent() {
    if (recent) return recent;
    recent = [];
    try {
      const raw = root.localStorage && root.localStorage.getItem(RECENT_KEY);
      if (raw) recent = JSON.parse(raw).filter(id => typeof id === 'string');
    } catch (e) { recent = []; }
    return recent;
  }
  /** recentIds() -> the command ids this author reached for last, newest first. */
  SE.recentIds = () => readRecent().slice(0, 8);
  /** noteUse(id) — remember a command the author just added. */
  SE.noteUse = function (id) {
    const list = readRecent().filter(x => x !== id);
    list.unshift(id);
    recent = list.slice(0, 12);
    try { if (root.localStorage) root.localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch (e) { /* private mode: recents are a nicety */ }
  };

  /**
   * pickerGroups({ query }) -> { favourites, recent, groups:[{ name, items }] }
   * `items` are command definitions; the search matches the MV label, the kit
   * label and the id, so "text" finds Show Text and "say" finds it too.
   */
  SE.pickerGroups = function (opts) {
    opts = opts || {};
    const q = String(opts.query || '').trim().toLowerCase();
    const all = (KIT.registry.exists('commands') ? KIT.registry('commands').list() : []).filter(d => d.id !== 'raw');
    const match = (d) => !q || `${d.id} ${d.label || ''} ${d.mv || ''} ${d.group || ''}`.toLowerCase().indexOf(q) >= 0;
    const list = all.filter(match);
    const byGroup = new Map();
    for (const d of list) {
      const g = d.group || 'Other';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(d);
    }
    const groups = Array.from(byGroup, ([name, items]) => ({ name, items }));
    const order = ['Message', 'Flow', 'Progression', 'Party', 'Movement', 'Character', 'Screen', 'Picture', 'Audio', 'System'];
    groups.sort((a, b) => {
      const ai = order.indexOf(a.name), bi = order.indexOf(b.name);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.name.localeCompare(b.name);
    });
    const favourites = all.filter(d => d.editor && d.editor.favourite);
    const recentDefs = SE.recentIds().map(id => all.find(d => d.id === id)).filter(Boolean);
    return { favourites, recent: recentDefs, groups, query: q };
  };

  // =================================================================================
  // Everything below needs a browser.
  // =================================================================================
  const make = (spec, opts) => KIT.ui.make(spec, opts);
  const clear = (el) => KIT.ui.clear(el);
  const INS = () => ED.inspector || {};
  function btn(label, title, fn, cls) {
    const b = make('button.ed-btn' + (cls ? '.' + cls : ''), { text: label });
    b.type = 'button';
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); fn(e); };
    return b;
  }
  const keyOf = (path) => (path || []).join('/');

  function commit(label, fn) {
    const r = ED.commit(label, fn);
    if (ED.inspector && ED.inspector.afterEdit) ED.inspector.afterEdit();
    return r;
  }

  // The editor instance mounted in the Script panel (there is only ever one).
  let view = 'cards';
  let selectedKey = null;
  let collapsed = {};
  let picker = null;          // { listPath, index } while the command picker is open
  let pickerQuery = '';
  let target = null;          // { path, label } — what is open

  /** target({ path, label }) — what the Script panel shows. */
  SE.setTarget = function (t) {
    const same = target && t && keyOf(target.path) === keyOf(t.path);
    target = t && t.path ? { path: t.path.slice(), label: t.label || 'Script' } : null;
    if (!same) { selectedKey = null; picker = null; }
  };
  SE.target = () => target;

  /**
   * open(el, { path, ed })  — mount the editor into an element.
   * open(ref)               — { path, selection, label }: show it in the Script panel.
   */
  SE.open = function (elOrRef, opts) {
    const isNode = elOrRef && typeof elOrRef === 'object' && elOrRef.nodeType === 1;
    if (!isNode) {
      const ref = elOrRef || {};
      if (ref.path) SE.setTarget({ path: ref.path, label: ref.label });
      if (ED.set) ED.set({ panel: 'script' });
      if (ED.refreshPanels) ED.refreshPanels();
      return true;
    }
    const o = opts || {};
    if (o.path) SE.setTarget({ path: o.path, label: o.label });
    return mountEditor(elOrRef, o.ed || ED);
  };

  // ---- the instance -----------------------------------------------------------------
  function mountEditor(host, ed) {
    const el = {};
    let forms = [];
    let sig = '';
    let textDirty = false;
    let deferred = false;

    clear(host);
    el.root = make('div.ed-script');
    // head
    el.head = make('div.ed-script-head');
    el.title = make('div.ed-script-title');
    el.head.appendChild(el.title);
    el.says = make('div.ed-script-says');
    el.head.appendChild(el.says);
    const tabs = make('div.ed-seg.ed-script-views');
    el.cardsTab = make('button', { text: 'Cards' });
    el.textTab = make('button', { text: 'Text' });
    el.cardsTab.type = el.textTab.type = 'button';
    el.cardsTab.onclick = () => setView('cards');
    el.textTab.onclick = () => setView('text');
    tabs.appendChild(el.cardsTab); tabs.appendChild(el.textTab);
    const row = make('div.ed-row.ed-script-bar');
    row.appendChild(tabs);
    row.appendChild(make('div.ed-spacer'));
    // Not `primary`: the blue button in a panel is the one that does the panel's job
    // (here, Apply). Play here is the same quiet button it is in the Events panel.
    el.playBtn = btn('▶ Play here', 'Start the game at this event', playHere);
    row.appendChild(el.playBtn);
    el.head.appendChild(row);
    el.root.appendChild(el.head);
    // bodies
    el.cards = make('div.ed-cards-view');
    el.text = make('div.ed-text-view');
    el.textarea = make('textarea.ed-screenplay');
    el.textarea.spellcheck = false;
    el.textarea.setAttribute('aria-label', 'Screenplay');
    el.textarea.oninput = () => { textDirty = true; liveParse(); };
    el.textarea.onblur = () => applyText();
    el.text.appendChild(el.textarea);
    el.textProblems = make('div.ed-text-problems');
    el.text.appendChild(el.textProblems);
    const textBar = make('div.ed-row');
    textBar.appendChild(btn('Apply', 'Read this back into the cards', () => { applyText(); render(true); }, 'primary'));
    textBar.appendChild(make('div.ed-hint', { text: 'Screenplay: “Name: line”, “? question” with “- option”, “@if when: …”. Anything it cannot read stays as a raw line.' }));
    el.text.appendChild(textBar);
    el.root.appendChild(el.cards);
    el.root.appendChild(el.text);
    el.empty = ED.emptyState ? ED.emptyState({
      icon: '✎',
      text: 'No script open',
      hint: 'Open an Event, pick one of its “What happens” slots — or write a Common Event that any Event can call.',
      actions: [
        { label: 'Events', primary: true, onTap: () => ED.set({ panel: 'objects' }) },
        { label: 'Common Events', onTap: () => ED.set({ panel: 'scripts' }) },
      ],
    }) : make('div.ed-hint.ed-script-empty', { text: 'Nothing is open.' });
    el.root.appendChild(el.empty);
    host.appendChild(el.root);

    // Rebuilding while a field has focus would steal the caret; wait for the blur.
    host.addEventListener('focusout', () => { if (deferred) setTimeout(() => { if (!hasFocus()) { deferred = false; render(true); } }, 0); });

    function hasFocus() {
      const a = document.activeElement;
      return !!(a && host.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'));
    }
    function project() { return ed.state.project; }
    function ctx() { return { project: project(), map: ed.state.map, mapId: ed.state.mapId }; }
    function commands() { return target ? SE.commandsAt(project(), target.path) : []; }

    function setView(v) {
      if (v === view) return;
      if (view === 'text') applyText();
      view = v;
      render(true);
    }

    function liveParse() {
      const parsed = SE.parse(el.textarea.value);
      clear(el.textProblems);
      for (const p of parsed.problems.slice(0, 40)) {
        const line = make('div.ed-problem.warn.ed-text-problem', { text: `line ${p.line}: ${p.message}` });
        line.appendChild(make('code.ed-raw', { text: p.raw || '' }));
        line.onclick = () => gotoLine(p.line);
        el.textProblems.appendChild(line);
      }
      const raws = parsed.commands.filter(c => c && c.t === 'raw').length;
      if (!parsed.problems.length) el.textProblems.appendChild(make('div.ed-hint.ed-ok', { text: `Reads clean · ${parsed.commands.length} command${parsed.commands.length === 1 ? '' : 's'}` }));
      else if (raws) el.textProblems.appendChild(make('div.ed-hint', { text: `${raws} line${raws === 1 ? '' : 's'} kept as raw text — nothing is lost, they just do not run yet.` }));
    }
    function gotoLine(n) {
      const lines = el.textarea.value.split('\n');
      let at = 0;
      for (let i = 0; i < n - 1 && i < lines.length; i++) at += lines[i].length + 1;
      el.textarea.focus();
      el.textarea.setSelectionRange(at, at + (lines[n - 1] || '').length);
    }
    function applyText() {
      if (!textDirty || !target) return;
      textDirty = false;
      const r = SE.commitText(ed, target.path, el.textarea.value, 'Edit script (text)');
      if (r.changed) { sig = ''; ED.toast(`Script saved · ${r.commands.length} command${r.commands.length === 1 ? '' : 's'}`); }
    }

    function playHere() {
      const at = objectPosition() || ed.state.cursor;
      if (ED.playHere) ED.playHere({ at });
    }
    function objectPosition() {
      const sel = ed.state.selection;
      if (!sel || (sel.kind !== 'slot' && sel.kind !== 'object' && sel.kind !== 'page')) return null;
      const map = project().maps[sel.map];
      const obj = map && (map.objects || []).find(o => o.id === sel.id);
      return obj ? { x: obj.x, y: obj.y } : null;
    }

    // ---- render ---------------------------------------------------------------------
    function render(force) {
      if (!target) {
        el.empty.hidden = false;
        el.cards.hidden = true; el.text.hidden = true; el.head.hidden = true;
        return;
      }
      el.empty.hidden = true;
      el.head.hidden = false;
      const cmds = commands();
      const next = JSON.stringify([target.path, view, selectedKey, collapsed, picker, pickerQuery, cmds]);
      if (!force && next === sig) return;
      if (!force && hasFocus()) { deferred = true; for (const f of forms) if (f.refreshValue) f.refreshValue(); return; }
      sig = next;
      deferred = false;
      el.title.textContent = target.label || 'Script';
      el.says.textContent = SE.describe(cmds);
      el.cardsTab.setAttribute('aria-selected', String(view === 'cards'));
      el.textTab.setAttribute('aria-selected', String(view === 'text'));
      el.cards.hidden = view !== 'cards';
      el.text.hidden = view !== 'text';
      if (view === 'text') {
        if (document.activeElement !== el.textarea) { el.textarea.value = SE.serialize(cmds); textDirty = false; }
        liveParse();
        return;
      }
      for (const f of forms) { try { f.destroy(); } catch (e) { /* ignore */ } }
      forms = [];
      clear(el.cards);
      renderList(el.cards, cmds, target.path, 0);
      // keep the card you are working on in sight (adding one scrolls to it)
      const sel = selectedKey && el.cards.querySelector(`.ed-cmd[data-key="${CSS.escape(selectedKey)}"] > .ed-cmd-head`);
      if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
    }

    /** One command list: its cards, then the Add row that appends to it. */
    function renderList(host, list, listPath, depth) {
      const wrap = make('div.ed-cmd-list');
      wrap.dataset.list = keyOf(listPath);
      host.appendChild(wrap);
      (list || []).forEach((cmd, i) => wrap.appendChild(renderCard(cmd, listPath, i, depth)));
      if (!list || !list.length) wrap.appendChild(make('div.ed-cmd-blank', { text: depth ? 'nothing here' : 'This script is empty.' }));
      host.appendChild(addRow(listPath, list ? list.length : 0, depth));
    }

    function addRow(listPath, index, depth) {
      const row = make('div.ed-cmd-add');
      const open = picker && picker.key === `${keyOf(listPath)}@${index}`;
      row.appendChild(btn(open ? '✕ Close' : '＋ Add command', 'Add an Event Command here', () => {
        picker = open ? null : { key: `${keyOf(listPath)}@${index}`, listPath, index };
        pickerQuery = '';
        render(true);
      }, open ? '' : (depth ? '' : 'wide')));
      if (open) row.appendChild(renderPicker(listPath, index));
      return row;
    }

    function renderPicker(listPath, index) {
      const box = make('div.ed-picker.ed-cmd-picker');
      const search = make('input');
      search.type = 'search';
      search.placeholder = 'Find a command… (text, choice, branch, variable)';
      search.value = pickerQuery;
      search.oninput = () => { pickerQuery = search.value; paint(); };
      box.appendChild(search);
      const body = make('div.ed-picker-grid');
      box.appendChild(body);
      setTimeout(() => search.focus(), 0);

      function chip(def, cls) {
        const c = make('button.ed-chip' + (cls ? '.' + cls : ''), { text: SE.labelOf(def) });
        c.type = 'button';
        c.title = `${def.label || def.id}${def.group ? ` · ${def.group}` : ''}`;
        c.onclick = () => add(def.id);
        return c;
      }
      function paint() {
        clear(body);
        const g = SE.pickerGroups({ query: pickerQuery });
        if (!pickerQuery) {
          if (g.favourites.length) {
            body.appendChild(make('div.ed-label', { text: '★ Favourites' }));
            const chips = make('div.ed-chips');
            for (const d of g.favourites) chips.appendChild(chip(d, 'is-preset'));
            body.appendChild(chips);
          }
          if (g.recent.length) {
            body.appendChild(make('div.ed-label', { text: '↺ Recently used' }));
            const chips = make('div.ed-chips');
            for (const d of g.recent) chips.appendChild(chip(d));
            body.appendChild(chips);
          }
        }
        let n = 0;
        for (const group of g.groups) {
          body.appendChild(make('div.ed-label', { text: group.name }));
          const chips = make('div.ed-chips');
          for (const d of group.items) { chips.appendChild(chip(d)); n++; }
          body.appendChild(chips);
        }
        if (!n) body.appendChild(make('div.ed-hint', { text: `Nothing matches “${pickerQuery}”.` }));
      }
      paint();
      function add(id) {
        const cmd = SE.newCommand(id);
        commit(`Add ${SE.labelOf(id)}`, (doc) => SE.insert(doc, listPath, index, cmd));
        SE.noteUse(id);
        picker = null;
        selectedKey = keyOf(listPath.concat(index));
        render(true);
      }
      return box;
    }

    function renderCard(cmd, listPath, i, depth) {
      const path = listPath.concat(i);
      const key = keyOf(path);
      const selected = selectedKey === key;
      const def = SE.def(cmd && cmd.t);
      const card = make('div.ed-cmd');
      card.dataset.key = key;
      if (cmd && cmd.disabled) card.classList.add('is-off');
      if (cmd && cmd.t === 'raw') card.classList.add('is-raw');
      if (selected) card.setAttribute('aria-selected', 'true');
      const branches = SE.branches(cmd);
      const isCollapsed = !!collapsed[key];

      const head = make('div.ed-cmd-head');
      const handle = make('button.ed-cmd-drag', { text: '⠿' });
      handle.type = 'button';
      handle.title = 'Drag to reorder (or use the arrows)';
      dragHandle(handle, card, listPath, i);
      head.appendChild(handle);
      if (branches.length) {
        const caret = btn(isCollapsed ? '▸' : '▾', isCollapsed ? 'Show what is inside' : 'Fold this up', () => { collapsed[key] = !isCollapsed; render(true); }, 'tiny ed-cmd-fold');
        head.appendChild(caret);
      }
      const body = make('div.ed-cmd-body');
      let text = '';
      try { text = CMD.summary(cmd, ctx()); } catch (e) { text = (cmd && cmd.t) || '?'; }
      body.appendChild(make('div.ed-cmd-sum', { text }));
      const meta = make('div.ed-cmd-meta');
      meta.appendChild(make('span.ed-badge', { text: def ? SE.labelOf(def) : (cmd && cmd.t === 'raw' ? 'Raw line' : `Unknown: ${cmd && cmd.t}`) }));
      if (def && def.group) meta.appendChild(make('span.ed-badge.ed-grp', { text: def.group }));
      if (cmd && cmd.disabled) meta.appendChild(make('span.ed-badge.warn', { text: 'off' }));
      body.appendChild(meta);
      body.onclick = () => { selectedKey = selected ? null : key; render(true); };
      head.appendChild(body);
      card.appendChild(head);

      const tools = make('div.ed-cmd-tools');
      tools.hidden = !selected;                   // a calm list: the controls belong to the card you tapped
      tools.appendChild(btn('▲', 'Move up', () => { commit('Move command', (doc) => SE.move(doc, listPath, i, i - 1)); selectedKey = keyOf(listPath.concat(Math.max(0, i - 1))); render(true); }));
      tools.appendChild(btn('▼', 'Move down', () => { commit('Move command', (doc) => SE.move(doc, listPath, i, i + 1)); selectedKey = keyOf(listPath.concat(i + 1)); render(true); }));
      tools.appendChild(btn('⧉', 'Duplicate', () => { commit('Duplicate command', (doc) => SE.duplicate(doc, listPath, i)); render(true); }));
      tools.appendChild(btn(cmd && cmd.disabled ? '◉' : '◌', cmd && cmd.disabled ? 'Turn this back on' : 'Keep it, but skip it when the game runs', () => { commit('Toggle command', (doc) => SE.setDisabled(doc, listPath, i, !(cmd && cmd.disabled))); render(true); }));
      tools.appendChild(btn('＋', 'Add a command after this one', () => {
        picker = { key: `${keyOf(listPath)}@${i + 1}`, listPath, index: i + 1 };
        pickerQuery = '';
        render(true);
      }));
      tools.appendChild(btn('✕', 'Delete', async () => {
        if (!(await ED.confirm(`Delete “${text}”?`))) return;
        commit('Delete command', (doc) => SE.remove(doc, listPath, i));
        selectedKey = null;
        render(true);
      }, 'danger'));
      card.appendChild(tools);

      if (selected) card.appendChild(renderFields(cmd, path, def));
      if (picker && picker.key === `${keyOf(listPath)}@${i + 1}`) card.appendChild(renderPicker(listPath, i + 1));

      if (branches.length && !isCollapsed) {
        const kids = make('div.ed-cmd-kids');
        for (const b of branches) {
          const bhead = make('div.ed-branch-head' + (b.option != null ? '.is-option' : ''));
          bhead.appendChild(make('span.ed-branch-label', { text: b.label }));
          if (b.option != null) {
            const optPath = path.concat('options', b.option);
            bhead.appendChild(btn('✎', 'Edit this option', () => { selectedKey = keyOf(optPath); render(true); }, 'tiny'));
            bhead.appendChild(btn('✕', 'Remove this option', () => {
              commit('Remove option', (doc) => doc.splice(path.concat('options'), b.option, 1, []));
              render(true);
            }, 'tiny'));
          }
          kids.appendChild(bhead);
          if (b.option != null && selectedKey === keyOf(path.concat('options', b.option))) kids.appendChild(renderOption(cmd, path, b.option));
          renderList(kids, b.list, path.concat(b.path), depth + 1);
        }
        if (cmd && cmd.t === 'choice') {
          kids.appendChild(btn('＋ Add option', 'Another thing the player can pick', () => {
            commit('Add option', (doc) => doc.splice(path.concat('options'), (cmd.options || []).length, 0, [{ text: 'New option', when: null, then: [] }]));
            render(true);
          }, 'tiny'));
        }
        card.appendChild(kids);
      }
      return card;
    }

    /** The selected card's fields, inline, through the inspector. */
    function renderFields(cmd, path, def) {
      const box = make('div.ed-cmd-fields');
      if (cmd && cmd.t === 'raw') {
        const f = { key: 'line', type: 'string', label: 'Raw line', doc: 'Screenplay could not read this line. Fix it here and it becomes a command again.' };
        const holder = make('div.ed-f');
        holder.appendChild(make('div.ed-f-label', { text: 'Raw line' }));
        const input = make('input');
        input.type = 'text';
        input.value = cmd.line || '';
        input.onchange = () => {
          const parsed = SE.parse(input.value);
          const one = parsed.commands[0];
          commit('Fix raw line', (doc, O) => O.setField(doc, path, one || { t: 'raw', line: input.value }));
          render(true);
        };
        holder.appendChild(input);
        holder.appendChild(make('div.ed-hint', { text: f.doc }));
        box.appendChild(holder);
        return box;
      }
      if (!def) { box.appendChild(make('div.ed-hint', { text: `No command called “${cmd && cmd.t}” is loaded, so its fields cannot be shown. It is kept exactly as it is.` })); return box; }
      const blocks = CMD.blockFields(def);
      const fields = S.fields(def.fields || []).filter(f => !blocks.includes(f.key));
      if (!fields.length) { box.appendChild(make('div.ed-hint', { text: 'This command has nothing to fill in.' })); return box; }
      const form = INS().mount(box, {
        fields,
        value: cmd,
        ctx: Object.assign({}, ctx(), { scriptPath: path, command: cmd }),
        onChange(fieldPath, v) { commit('Edit command', (doc, O) => O.setField(doc, path.concat(fieldPath), v, 'Edit command')); },
      });
      form.refreshValue = () => { try { form.refresh(KIT.path.get(project(), path)); } catch (e) { /* the card went away */ } };
      forms.push(form);
      return box;
    }

    /** A choice option: its text and its condition (its commands are the nested list). */
    function renderOption(cmd, path, index) {
      const opt = (cmd.options || [])[index] || {};
      const box = make('div.ed-cmd-fields.ed-option-fields');
      const form = INS().mount(box, {
        fields: [{ key: 'text', type: 'string', label: 'Option text', doc: 'What the player reads in the list.' }, { key: 'when', type: 'condition', label: 'Shown when', doc: 'Leave empty and the option is always there.' }],
        value: { text: opt.text || '', when: opt.when || null },
        ctx: ctx(),
        onChange(fieldPath, v) { commit('Edit option', (doc, O) => O.setField(doc, path.concat('options', index, fieldPath[0]), v, 'Edit option')); },
      });
      forms.push(form);
      return box;
    }

    // ---- drag to reorder (pointer based, so a finger works too) -----------------------
    function dragHandle(handle, card, listPath, index) {
      let drag = null;
      handle.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        const list = card.parentElement;
        if (!list) return;
        handle.setPointerCapture(ev.pointerId);
        drag = { id: ev.pointerId, list, cards: Array.from(list.querySelectorAll(':scope > .ed-cmd')), to: index };
        card.classList.add('is-dragging');
      });
      handle.addEventListener('pointermove', (ev) => {
        if (!drag || drag.id !== ev.pointerId) return;
        let to = index;
        for (let i = 0; i < drag.cards.length; i++) {
          const r = drag.cards[i].getBoundingClientRect();
          if (ev.clientY > r.top + r.height / 2) to = i;
        }
        if (to !== drag.to) {
          drag.to = to;
          for (const c of drag.cards) c.classList.remove('is-drop');
          if (drag.cards[to] && to !== index) drag.cards[to].classList.add('is-drop');
        }
      });
      const end = (ev) => {
        if (!drag || drag.id !== ev.pointerId) return;
        const to = drag.to;
        for (const c of drag.cards) c.classList.remove('is-drop');
        card.classList.remove('is-dragging');
        drag = null;
        if (to !== index) { commit('Move command', (doc) => SE.move(doc, listPath, index, to)); selectedKey = keyOf(listPath.concat(to)); render(true); }
      };
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    }

    const api = { el: el.root, refresh: () => render(false), rerender: () => render(true), destroy() { for (const f of forms) { try { f.destroy(); } catch (e) { /* ignore */ } } clear(host); } };
    render(true);
    return api;
  }

  // ---- the panel ---------------------------------------------------------------------
  let instance = null;
  KIT.registry('editorPanels').add({
    id: 'script', label: 'Script', icon: 'script', order: 25,
    mount(host, ed) {
      instance = SE.open(host, { ed });
    },
    refresh(ed) {
      // Follow the selection: picking a slot or a Common Event opens it here.
      const path = SE.pathForSelection(ed.state.project, ed.state.selection);
      if (path && (!target || keyOf(target.path) !== keyOf(path))) SE.setTarget({ path, label: SE.labelForSelection(ed.state.project, ed.state.selection) });
      if (instance) instance.refresh();
    },
    onSelect() { if (instance) instance.rerender(); },
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
