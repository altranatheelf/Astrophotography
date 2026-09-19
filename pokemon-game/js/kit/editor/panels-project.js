// Creator Mode — the panels about the game itself:
//
//   Project    title, pitch, heroes, where the game starts, settings, modules
//   Variables  the declared Switches/Variables, the ones the scripts use without
//              asking, and every read and write with a way to jump to it
//   Items      the item table
//   Strings    the Terms table (every word the engine says on its own)
//   Data       the raw JSON of the selection (or the whole project), checked before it applies
//   Import     drop a Tiled map, an RPG Maker MV folder or an Aseprite file in here
//
// Every edit goes through KIT.editor.ops / ED.commit, and an import is one undo step.
// The indexes and the import dispatch at the top are pure (test/kit/editor-script.test.js).
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const ED = KIT.editor = KIT.editor || {};
  const PP = ED.projectPanels = ED.projectPanels || {};
  const IMPP = ED.importPanel = ED.importPanel || {};
  const P = KIT.project;

  const titleCase = (id) => String(id || '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // =================================================================================
  // Pure: the variable index
  // =================================================================================
  /**
   * varIndex(project) -> [{ name, declared, decl, reads, writes, uses }]
   * Declared variables first (by group, then name), then the ones the scripts use
   * but nobody declared. `reads` and `writes` are the `where` records from
   * KIT.project.collect, so each one can be jumped to.
   */
  PP.varIndex = function (project) {
    let vars = {};
    try { vars = (P.collect(project) || {}).vars || {}; } catch (e) { vars = {}; }
    const decls = (project && project.vars) || {};
    const out = Object.keys(vars).map((name) => {
      const v = vars[name];
      return {
        name,
        declared: !!v.declared,
        decl: decls[name] || null,
        group: (decls[name] && decls[name].group) || '',
        reads: (v.reads || []).slice(),
        writes: (v.writes || []).slice(),
        uses: (v.reads || []).length + (v.writes || []).length,
      };
    });
    out.sort((a, b) => {
      if (a.declared !== b.declared) return a.declared ? -1 : 1;
      return (a.group || '').localeCompare(b.group || '') || a.name.localeCompare(b.name);
    });
    return out;
  };
  /** undeclared(project) -> the names to offer a "Declare" button for. */
  PP.undeclared = (project) => PP.varIndex(project).filter(v => !v.declared);
  /**
   * guessType(name) -> the type a "Declare" button starts with. Names that read
   * like a Switch ("hasKey", "introDone") come out as bool; everything else is a
   * number, which is what RPG Maker's Variables are.
   */
  PP.guessType = function (name) {
    const n = String(name || '');
    if (/^(is|has|did|can|should)[A-Z_]/.test(n) || /(Done|Flag|Open|Unlocked|Seen|Met)$/i.test(n)) return 'bool';
    return 'number';
  };
  /** The starting value for a declared type. */
  PP.defaultFor = (type) => (type === 'bool' ? false : type === 'string' ? '' : 0);

  /** Where a usage points, as a selection. */
  PP.usageSelection = function (where) {
    const w = where || {};
    if (w.script) return { kind: 'script', path: ['scripts', w.script] };
    if (w.map && w.object && w.slot) return { kind: 'slot', map: w.map, id: w.object, page: w.page || 0, slot: w.slot };
    if (w.map && w.object) return { kind: 'object', map: w.map, id: w.object };
    if (w.map) return { kind: 'map', id: w.map };
    return { kind: 'project' };
  };
  /** A short "where is this used" line. */
  PP.usageLabel = function (project, where) {
    const w = where || {};
    if (w.script) { const sc = (project.scripts || {})[w.script] || {}; return `Common Event · ${sc.label || w.script}`; }
    if (w.map) {
      const m = (project.maps || {})[w.map] || {};
      const bits = [m.name || w.map];
      if (w.object) {
        const o = (m.objects || []).find(x => x.id === w.object);
        bits.push((o && (o.name || o.id)) || w.object);
      }
      if (w.slot) bits.push(titleCase(w.slot));
      return bits.join(' · ');
    }
    if (Array.isArray(w.path) && w.path.length) return w.path.join('.');
    return 'the project';
  };

  // =================================================================================
  // Pure: the Data panel's path for a selection
  // =================================================================================
  /** dataPath(project, selection) -> { path, label } — what the Data panel edits. */
  PP.dataPath = function (project, sel) {
    if (!sel) return { path: [], label: 'the whole project' };
    if (sel.kind === 'project') return { path: [], label: 'the whole project' };
    if (sel.kind === 'map') return { path: ['maps', sel.id], label: `map ${sel.id}` };
    if (sel.kind === 'script') return { path: sel.path.slice(), label: `Common Event ${sel.path[1]}` };
    if (sel.kind === 'item') return { path: ['items', sel.id], label: `item ${sel.id}` };
    if (sel.kind === 'var') return { path: ['vars', sel.name], label: `variable ${sel.name}` };
    if (sel.kind === 'fragment') {
      const i = ((project && project.fragments) || []).findIndex(f => f.id === sel.id);
      return i < 0 ? { path: [], label: 'the whole project' } : { path: ['fragments', i], label: `fragment ${sel.id}` };
    }
    if (sel.kind === 'object' || sel.kind === 'page' || sel.kind === 'slot') {
      const map = project && project.maps && project.maps[sel.map];
      const i = map ? (map.objects || []).findIndex(o => o.id === sel.id) : -1;
      if (i < 0) return { path: [], label: 'the whole project' };
      const base = ['maps', sel.map, 'objects', i];
      if (sel.kind === 'object') return { path: base, label: `event ${sel.id}` };
      if (sel.kind === 'page') return { path: base.concat('pages', sel.page || 0), label: `${sel.id} page ${(sel.page || 0) + 1}` };
      return { path: base.concat('pages', sel.page || 0, 'on', sel.slot), label: `${sel.id} · ${titleCase(sel.slot)}` };
    }
    return { path: [], label: 'the whole project' };
  };

  /**
   * checkData(project, path, text) -> { ok, value, message }
   * Parses the JSON and, for the whole project, runs it past the normalizer so a
   * broken paste is caught before it is applied.
   */
  PP.checkData = function (project, path, text) {
    let value;
    try { value = JSON.parse(text); }
    catch (e) { return { ok: false, message: `That is not valid JSON: ${e.message}` }; }
    if (!path || !path.length) {
      if (!KIT.isObject(value)) return { ok: false, message: 'A project is an object with maps, meta and the rest — this is not one.' };
      try {
        const n = P.normalize(value, { skipRegisterArt: true });
        const errs = (n.problems || []).filter(p => p.severity === 'error');
        return { ok: true, value, message: errs.length ? `Reads as a project, with ${errs.length} error(s) the Problems panel will list.` : 'Reads as a project.' };
      } catch (e) { return { ok: false, message: `That is JSON, but not a project: ${e.message}` }; }
    }
    return { ok: true, value, message: 'Valid JSON.' };
  };

  // =================================================================================
  // Pure: which importer a dropped file belongs to
  // =================================================================================
  const IMAGE_EXT = /\.(png|gif|jpe?g|webp|bmp)$/i;
  const RM_FILE = /^(MapInfos|System|Tilesets|CommonEvents|Actors|Items|Map\d+)\.json$/i;
  const base = (name) => String(name || '').split(/[\\/]/).pop();
  const ext = (name) => { const m = /\.([A-Za-z0-9]+)$/.exec(base(name)); return m ? m[1].toLowerCase() : ''; };

  /**
   * dispatch(files) -> { tool, kind, label, main, files, images, problems }
   * `files` are `{ name, text?, bytes? }`. The name decides first (an RPG Maker
   * data folder, an .aseprite document), then the content (Tiled's JSON says what
   * it is; an Aseprite sheet is known by its frames).
   */
  IMPP.dispatch = function (files) {
    const list = (files || []).filter(Boolean);
    const problems = [];
    const images = list.filter(f => IMAGE_EXT.test(base(f.name)));
    const rm = list.filter(f => RM_FILE.test(base(f.name)));
    if (rm.length) {
      const data = list.filter(f => ext(f.name) === 'json');
      return { tool: 'rpgmaker', kind: 'project', label: `RPG Maker data (${data.length} file${data.length === 1 ? '' : 's'})`, main: rm[0], files: data, images, problems };
    }
    for (const f of list) {
      const e = ext(f.name);
      if (e === 'aseprite' || e === 'ase') return { tool: 'aseprite', kind: 'file', label: `Aseprite document ${base(f.name)}`, main: f, files: [f], images, problems };
    }
    for (const f of list) {
      if (f.text == null) continue;
      let kind = null;
      try { kind = KIT.import.tiled.detect(f.text); } catch (e) { kind = null; }
      if (kind) return { tool: 'tiled', kind, label: `Tiled ${kind} ${base(f.name)}`, main: f, files: list, images, problems };
    }
    for (const f of list) {
      if (f.text == null) continue;
      let kind = null;
      try { kind = KIT.import.aseprite.detect(f.text); } catch (e) { kind = null; }
      if (kind === 'sheet') return { tool: 'aseprite', kind: 'sheet', label: `Aseprite sheet ${base(f.name)}`, main: f, files: [f], images, problems };
    }
    if (images.length && list.length === images.length) {
      problems.push({ severity: 'warn', code: 'image-only', message: 'That is an image on its own. Export the data file next to it (Aseprite: File ▸ Export Sprite Sheet, with JSON Data) and drop both in together.', where: {} });
    } else {
      problems.push({ severity: 'warn', code: 'unknown-format', message: 'That is not a Tiled map or tileset, an Aseprite sheet or document, or an RPG Maker MV/MZ data folder.', where: {} });
    }
    return { tool: null, kind: null, label: 'Nothing recognised', main: null, files: list, images, problems };
  };

  /** The pixel size of a PNG/GIF/JPEG straight out of its header (no decoding). */
  IMPP.imageSize = function (bytes) {
    const b = bytes;
    if (!b || b.length < 10) return null;
    const be32 = (i) => (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
    if (b[0] === 0x89 && b[1] === 0x50) return { w: be32(16), h: be32(20) };
    if (b[0] === 0x47 && b[1] === 0x49) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        const len = (b[i + 2] << 8) | b[i + 3];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
        i += 2 + len;
      }
    }
    return null;
  };

  // =================================================================================
  // The panels (browser only below here)
  // =================================================================================
  const make = (spec, opts) => KIT.ui.make(spec, opts);
  const clear = (el) => KIT.ui.clear(el);
  const INS = () => ED.inspector;
  function btn(label, title, fn, cls) {
    const b = make('button.ed-btn' + (cls ? '.' + cls : ''), { text: label });
    b.type = 'button';
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); fn(e); };
    return b;
  }
  function commit(label, fn) {
    const r = ED.commit(label, fn);
    if (ED.inspector && ED.inspector.afterEdit) ED.inspector.afterEdit();
    return r;
  }
  const project = () => ED.state.project;
  function setAt(path, value, label) { commit(label || 'Edit', (doc, O) => O.setField(doc, path, value, label || 'Edit')); }
  function section(host, title, openByDefault, build) {
    const box = make('details.ed-sec');
    box.open = openByDefault !== false;
    const sum = make('summary', { text: title });
    box.appendChild(sum);
    const body = make('div.ed-sec-body');
    box.appendChild(body);
    host.appendChild(box);
    build(body);
    return body;
  }

  // What the “Start a new game” box holds, kept across redraws like moveState.
  const newState = { open: false, name: '' };
  // The last thing the “other device” section said. It outlives the panel, because
  // the act it reports on — opening a game — rebuilds the panel.
  const moveState = { said: null, open: false };

  // Same for the languages section: importing a translation redraws the panel.
  const langState = { said: null, open: false, code: '' };

  // ---------------------------------------------------------------- Project ----------
  // The author's order, not the schema's: the two sentences matter more than the id.
  function metaFields() {
    const byKey = {};
    for (const f of P.fields.meta || []) byKey[f.key] = f;
    const pick = (key, over) => Object.assign({}, byKey[key] || { key, type: 'string' }, over || {});
    return [
      pick('title', { label: 'Title' }),
      pick('subtitle', { label: 'Subtitle' }),
      // a note, not a `text` field: the pitch is never shown in a message box, so the preview is noise
      pick('pitch', { type: 'note', label: 'Pitch (two sentences)', doc: 'Who the hero is, and what they want. The validator asks for this because everything else follows it.' }),
      pick('author', { label: 'Author' }),
      pick('id', { label: 'Id', doc: 'The folder and the save-file name. Changing it starts a fresh save.' }),
    ];
  }

  KIT.registry('editorPanels').add({
    id: 'project', label: 'Project', icon: 'book', order: 50,
    mount(host) {
      clear(host);
      this._host = host;
      this._forms = [];
      this._sig = '';
      this.refresh(ED);
    },
    refresh(ed) {
      const host = this._host;
      if (!host) return;
      const p = ed.state.project;
      const sig = JSON.stringify([p.meta, p.heroes, p.start, p.settings, p.modules, Object.keys(p.maps)]);
      if (sig === this._sig) return;
      const active = document.activeElement;
      if (active && host.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
      this._sig = sig;
      for (const f of this._forms) { try { f.destroy(); } catch (e) { /* ignore */ } }
      this._forms = [];
      clear(host);
      const forms = this._forms;

      section(host, 'The game', true, (body) => {
        const box = make('div');
        body.appendChild(box);
        forms.push(INS().mount(box, {
          fields: metaFields(),
          value: p.meta,
          ctx: { project: p },
          onChange(path, v) { setAt(['meta'].concat(path), v, 'Edit project'); },
        }));
        if (!String((p.meta && p.meta.pitch) || '').trim()) body.appendChild(make('div.ed-hint.ed-warn', { text: 'The pitch is the two sentences you will read back in six months: who the hero is, and what they want. Everything else follows it.' }));
      });

      section(host, 'Heroes', true, (body) => {
        (p.heroes || []).forEach((h, i) => {
          const card = make('div.ed-card');
          const row = make('div.ed-row');
          const name = make('input.ed-half');
          name.type = 'text';
          name.value = h.name || '';
          name.placeholder = 'Name';
          name.onchange = () => setAt(['heroes', i, 'name'], name.value, 'Rename hero');
          row.appendChild(name);
          row.appendChild(make('span.ed-badge', { text: h.id }));
          if ((p.heroes || []).length > 1) {
            row.appendChild(btn('✕', 'Remove this hero', async () => {
              if (!(await ED.confirm(`Remove ${h.name || h.id}?`))) return;
              commit('Remove hero', (doc) => doc.splice(['heroes'], i, 1, []));
            }, 'danger'));
          }
          card.appendChild(row);
          const sprite = make('div');
          card.appendChild(make('div.ed-label', { text: 'Sprite' }));
          card.appendChild(sprite);
          INS().field(sprite, { key: 'sprite', type: 'ref:sprite' }, h.sprite, (v) => setAt(['heroes', i, 'sprite'], v, 'Hero sprite'), { project: p });
          card.appendChild(make('div.ed-label', { text: 'Recolour (palette letter → colour)' }));
          const recolor = make('div');
          card.appendChild(recolor);
          INS().field(recolor, { key: 'recolor', type: 'strings' }, h.recolor || {}, (v) => setAt(['heroes', i, 'recolor'], v, 'Recolour hero'), { project: p });
          body.appendChild(card);
        });
        body.appendChild(btn('＋ Add a hero', 'Another playable character (co-op uses the second one)', () => {
          const n = (p.heroes || []).length + 1;
          commit('Add hero', (doc) => doc.push(['heroes'], { id: `p${n}`, name: `Player ${n}`, sprite: null, recolor: {} }));
        }, 'wide'));
      });

      section(host, 'Where the game starts', true, (body) => {
        const box = make('div');
        body.appendChild(box);
        forms.push(INS().mount(box, {
          fields: P.fields.start || [],
          value: p.start,
          ctx: { project: p },
          onChange(path, v) { setAt(['start'].concat(path), v, 'Start position'); },
        }));
        body.appendChild(btn('✛ Pick the start on the map', 'Tap a square on the map', () => {
          INS().pickOnMap({
            hint: 'Tap where the game should start',
            onPick(pt) { commit('Start position', (doc, O) => { O.setField(doc, ['start', 'map'], pt.map); O.setField(doc, ['start', 'x'], pt.x); O.setField(doc, ['start', 'y'], pt.y); }); },
          });
        }, 'wide'));
      });

      section(host, 'Settings', false, (body) => {
        const box = make('div');
        body.appendChild(box);
        forms.push(INS().mount(box, {
          fields: P.fields.settings || [],
          value: p.settings,
          ctx: { project: p },
          onChange(path, v) { setAt(['settings'].concat(path), v, 'Setting'); },
        }));
      });

      // ---- moving the game between devices -----------------------------------
      // The one thing the editor could not do: get a game OUT. Creator Mode runs
      // on a phone and on a laptop, and each one keeps its own draft in its own
      // browser — so without this, work done on the phone stays on the phone.
      // There is no server and no account: the bridge is a file you send to
      // yourself however you already send things.
      const moveBody = section(host, 'This game, on your other device', moveState.open === true, (body) => {
        body.appendChild(make('div.ed-hint', {
          text: 'Everything — maps, people, scripts, art — as one file. Save it here, send it to yourself, and open it there. It works the same both ways round, and nothing goes through anybody else’s computer.',
        }));
        const S = KIT.storage;
        // Opening a game rebuilds this whole panel (the project changed), which
        // would throw the answer away the moment it is given. So the last thing
        // said lives outside the panel and is put back when it redraws.
        const status = make('div.ed-hint');
        const say = (text, ok) => {
          moveState.said = text ? { text, ok } : null;
          status.textContent = text || '';
          status.className = 'ed-hint ' + (ok === false ? 'ed-warn' : ok ? 'ed-ok' : '');
        };
        if (moveState.said) say(moveState.said.text, moveState.said.ok);

        const out = make('div.ed-row');
        out.appendChild(btn('↓ Save a copy', 'Download the whole game as one file', async () => {
          const name = S.fileName(p);
          const done = await S.saveToFile(p);
          say(done ? `Saved as ${name}. Send it to your other device and open it there.`
            : 'This browser would not save a file. Try Copy instead — it puts the same thing on the clipboard.', done);
        }, 'primary'));
        out.appendChild(btn('Copy', 'Put the whole game on the clipboard (easier on a phone)', async () => {
          const done = await S.copyToClipboard(S.toFile(p));
          say(done ? 'Copied. Paste it into a message to yourself, then use Paste on the other device.'
            : 'The clipboard is not available here. Use Save a copy instead.', done);
        }));
        body.appendChild(out);

        // The version-control way out.
        //
        // The project format is already mergeable by construction — one file per
        // map, sorted keys, one short line per row, no minified blobs — which is
        // the single clearest thing this engine has over RPG Maker, where a map
        // is one line of JSON that git cannot merge even when two people edit
        // different corners of it.
        //
        // And until now there was NO WAY TO PRODUCE IT from the editor.
        // `KIT.project.exportFiles` had zero callers outside the build script,
        // so the differentiator existed and nobody could reach it.
        const gitRow = make('div.ed-row');
        const canFolder = typeof root.showDirectoryPicker === 'function';
        gitRow.appendChild(btn(canFolder ? '↓ Save as files (for git)' : '↓ Save as files',
          'One file per map, the way version control wants it', async () => {
            const files = KIT.project.exportFiles(p);
            const names = Object.keys(files);
            if (canFolder) {
              try {
                const dir = await root.showDirectoryPicker({ mode: 'readwrite' });
                for (const name of names) {
                  const parts = name.split('/');
                  let here = dir;
                  for (let i = 0; i < parts.length - 1; i++) here = await here.getDirectoryHandle(parts[i], { create: true });
                  const fh = await here.getFileHandle(parts[parts.length - 1], { create: true });
                  const w = await fh.createWritable();
                  await w.write(files[name]);
                  await w.close();
                }
                say(`Wrote ${names.length} file${names.length === 1 ? '' : 's'}. That folder is a git repository waiting to happen.`, true);
              } catch (e) {
                say(e && e.name === 'AbortError' ? 'Nothing written.' : 'That folder could not be written to.', e && e.name !== 'AbortError' ? false : undefined);
              }
              return;
            }
            // No directory picker (every browser on a phone, and Safari): one
            // file at a time is unusable at 400 maps, so it says so rather than
            // starting four hundred downloads.
            if (names.length > 12) {
              say(`This browser cannot save a folder, and this game is ${names.length} files. Open Creator Mode on a computer in Chrome or Edge to save it for git — or use “Save a copy” above, which is one file and works everywhere.`, false);
              return;
            }
            let wrote = 0;
            for (const name of names) if (await KIT.storage.download(name.replace(/\//g, '-'), files[name])) wrote++;
            say(wrote ? `Saved ${wrote} file${wrote === 1 ? '' : 's'}.` : 'This browser would not save the files.', !!wrote);
          }));
        body.appendChild(gitRow);
        body.appendChild(make('div.ed-sub', {
          text: canFolder
            ? 'One file per map, sorted and readable, so git can merge two people editing different rooms. RPG Maker writes each map as a single minified line, which it cannot.'
            : 'Saving a folder needs Chrome or Edge on a computer. On a phone, “Save a copy” above is the one that works.',
        }));

        const inRow = make('div.ed-row');
        const file = make('input');
        file.type = 'file';
        file.accept = '.json,.kitgame.json,application/json';
        file.className = 'ed-file';
        file.onchange = () => {
          const f = file.files && file.files[0];
          if (!f) return;
          const r = new FileReader();
          r.onload = () => openGame(String(r.result || ''), f.name, say);
          r.onerror = () => say('That file could not be read.', false);
          r.readAsText(f);
        };
        inRow.appendChild(file);
        body.appendChild(inRow);

        const pasteRow = make('div.ed-row');
        const paste = make('textarea.ed-json.ed-paste');
        paste.placeholder = 'or paste a game here';
        paste.spellcheck = false;
        paste.rows = 3;
        pasteRow.appendChild(paste);
        body.appendChild(pasteRow);
        body.appendChild(btn('Open what is pasted', 'Replace this game with the pasted one', () => {
          if (!paste.value.trim()) { say('Nothing pasted yet.', false); return; }
          openGame(paste.value, 'the pasted game', say);
        }));
        body.appendChild(status);
        body.appendChild(make('div.ed-sub', {
          text: 'Opening a game REPLACES the one you are editing. Ctrl+Z puts it back, and the one you replaced is still in the file you saved.',
        }));
      });
      const moveBox = moveBody.parentNode;      // section() hands back the body; the <details> is its parent
      if (moveBox) moveBox.addEventListener('toggle', () => { moveState.open = moveBox.open; });

      // ---- languages ---------------------------------------------------------
      // RPG Maker's answer to this is "ship a second copy of your game", which is
      // why so few of its games exist in more than one language. Here a
      // translation is one text file beside the project, keyed on the lines
      // themselves, and the editor's whole job is to hand that file out and take
      // it back.
      // ---- starting over ----------------------------------------------------------
      // The demo is a worked example, not a cage. A person who wants THEIR game
      // needs a blank map with their title on it, from the phone, without a CLI.
      section(host, 'Start a new game', newState.open === true, (body) => {
        body.appendChild(make('div.ed-hint', { text: 'A blank map with your title on it, in place of this game. Ctrl+Z brings this one back, and “Save a copy” above keeps it for good.' }));
        const name = make('input.ed-newgame-name');
        name.type = 'text';
        name.placeholder = 'What is it called?';
        name.value = newState.name || '';
        name.setAttribute('aria-label', 'The new game’s title');
        name.oninput = () => { newState.name = name.value; };
        body.appendChild(name);
        const row = make('div.ed-row');
        row.appendChild(btn('✦ Start from a blank map', 'Replace this game with a blank one (one undo step)', async () => {
          const title = (name.value || '').trim() || 'New Adventure';
          const was = (p.meta && p.meta.title) || 'this game';
          if (!(await ED.confirm(`Replace “${was}” with a blank game called “${title}”? Ctrl+Z brings “${was}” back.`, { yes: 'Start over' }))) return;
          // The modules stay as they are: a blank game with the same engine, not a different one.
          const fresh = P.normalize(Object.assign(P.blank({ title, id: KIT.slug(title) || 'new-adventure' }), { modules: (p.modules || []).slice() })).project;
          newState.open = false; newState.name = '';
          commit('New game', (doc) => doc.replace(fresh, { label: 'New game' }));
          ED.select(null);
          ED.refresh({ drop: true });
          ED.openMap(fresh.start.map);
          ED.set({ panel: 'tiles' });
          ED.toast(`“${title}” — a blank map. Paint something.`);
        }, 'primary'));
        body.appendChild(row);
      });

      const langBody = section(host, 'Languages', langState.open === true, (body) => {
        const L = KIT.lang;
        if (!L) { body.appendChild(make('div.ed-hint', { text: 'Languages are not loaded in this build.' })); return; }

        const status = make('div.ed-hint');
        const say = (text, ok) => {
          langState.said = text ? { text, ok } : null;
          status.textContent = text || '';
          status.className = 'ed-hint ' + (ok === false ? 'ed-warn' : ok ? 'ed-ok' : '');
        };

        const src = (p.settings && p.settings.language) || 'en';
        const others = Object.keys(p.languages || {}).filter((c) => c !== src).sort();
        if (!langState.code) langState.code = others[0] || '';

        body.appendChild(make('div.ed-hint', {
          text: `This game is written in ${(p.settings && p.settings.languageName) || src}. A translation is one file: every line the game can say, with room underneath for your version. Lines are matched on the words themselves, so moving a scene around keeps its translation, and rewording a line correctly asks for it again.`,
        }));

        const total = L.extract(p).length;
        body.appendChild(make('div.ed-sub', { text: `${total} line${total === 1 ? '' : 's'} a player can read.` }));

        // which language this row is about
        const pick = make('div.ed-row');
        const sel = make('select');
        for (const c of others) sel.appendChild(make('option', { text: `${(p.languages[c] && p.languages[c].name) || c} (${c})`, attrs: { value: c } }));
        sel.appendChild(make('option', { text: others.length ? '+ another language…' : '+ add a language…', attrs: { value: '' } }));
        sel.value = langState.code;
        sel.onchange = () => {
          if (!sel.value) {
            const code = (root.prompt && root.prompt('Language code — two letters, the way a browser writes it: ja, fr, pt-BR')) || '';
            const clean = String(code).trim();
            if (!clean || clean === src) { sel.value = langState.code; return; }
            const name = (root.prompt && root.prompt(`What is ${clean} called, in ${clean}?`, clean)) || clean;
            langState.code = clean;
            langState.said = { text: `Added ${name}. Save the file below, translate it, and bring it back.`, ok: true };
            commit('Add a language', (doc) => doc.set(['languages', clean], { name: String(name).trim() || clean, lines: {} }, { label: 'Add a language' }));
            return;
          }
          langState.code = sel.value;
          ED.refresh();
        };
        pick.appendChild(sel);
        body.appendChild(pick);

        const code = langState.code;
        if (code && p.languages && p.languages[code]) {
          const cov = L.coverage(p, code);
          const pct = cov.total ? Math.round((cov.translated / cov.total) * 100) : 100;
          body.appendChild(make('div.ed-sub', { text: `${cov.translated} of ${cov.total} translated (${pct}%).` }));

          const row = make('div.ed-row');
          row.appendChild(btn('↓ Save the file', 'Every line, with your translations already in it', async () => {
            const name = `${(p.meta && p.meta.id) || 'game'}.${code}.txt`;
            const done = await KIT.storage.download(name, L.toText(p, code));
            say(done ? `Saved as ${name}.` : 'This browser would not save a file — use Copy instead.', done);
          }, 'primary'));
          row.appendChild(btn('Copy', 'Put the file on the clipboard (easier on a phone)', async () => {
            const done = await KIT.storage.copyToClipboard(L.toText(p, code));
            say(done ? 'Copied. Paste it wherever you translate.' : 'The clipboard is not available here.', done);
          }));
          body.appendChild(row);

          const take = (text, whence) => {
            const r = L.fromText(text);
            const n = Object.keys(r.lines).filter((k) => r.lines[k]).length;
            if (!n && !r.problems.length) { say(`${whence} had no translations in it.`, false); return; }
            const total = L.extract(p).length;
            const bad = r.problems.length ? ` ${r.problems.length} line(s) could not be read (first at line ${r.problems[0].line}).` : '';
            langState.said = { text: `${n} of ${total} lines translated.${bad}`, ok: !r.problems.length };
            commit('Take a translation', (doc) => doc.set(['languages', code, 'lines'], r.lines, { label: 'Take a translation' }));
          };

          const inRow = make('div.ed-row');
          const file = make('input');
          file.type = 'file';
          file.accept = '.txt,text/plain';
          file.className = 'ed-file';
          file.onchange = () => {
            const f = file.files && file.files[0];
            if (!f) return;
            const rd = new FileReader();
            rd.onload = () => take(String(rd.result || ''), f.name);
            rd.onerror = () => say('That file could not be read.', false);
            rd.readAsText(f);
          };
          inRow.appendChild(file);
          body.appendChild(inRow);

          const pasteRow = make('div.ed-row');
          const paste = make('textarea.ed-json.ed-paste');
          paste.placeholder = 'or paste a translated file here';
          paste.spellcheck = false;
          paste.rows = 3;
          pasteRow.appendChild(paste);
          body.appendChild(pasteRow);
          body.appendChild(btn('Take what is pasted', 'Read the translations out of it', () => {
            if (!paste.value.trim()) { say('Nothing pasted yet.', false); return; }
            take(paste.value, 'What you pasted');
          }));

          if (cov.missing.length) {
            const det = make('details.ed-sub');
            det.appendChild(make('summary', { text: `${cov.missing.length} still in ${src}` }));
            for (const m of cov.missing.slice(0, 40)) det.appendChild(make('div.ed-sub', { text: '· ' + m.text.replace(/\n/g, ' ').slice(0, 80) }));
            if (cov.missing.length > 40) det.appendChild(make('div.ed-sub', { text: `…and ${cov.missing.length - 40} more` }));
            body.appendChild(det);
          }

          body.appendChild(btn('Remove this language', 'Deletes its translations from the project', () => {
            if (root.confirm && !root.confirm(`Delete the ${p.languages[code].name} translation? Ctrl+Z puts it back.`)) return;
            langState.code = '';
            langState.said = { text: 'Removed.', ok: true };
            commit('Remove a language', (doc) => doc.del(['languages', code]));
          }));
        }
        if (langState.said) say(langState.said.text, langState.said.ok);
        body.appendChild(status);
      });
      const langBox = langBody.parentNode;
      if (langBox) langBox.addEventListener('toggle', () => { langState.open = langBox.open; });

      section(host, 'Modules', false, (body) => {
        body.appendChild(make('div.ed-hint', { text: 'Modules add commands, object types and panels of their own. Switching one off leaves its data in the project, so you can switch it back on. Switching one on takes effect when the game reloads.' }));
        // Every module the page has LOADED, so one can be switched on as well as
        // off — plus any this project names that did not load, which is worth
        // seeing rather than hiding. The engine knows no module's name.
        const loaded = (KIT.modules && KIT.modules.all) ? KIT.modules.all() : [];
        const byId = new Map(loaded.map(d => [d.id, d]));
        const known = Array.from(new Set(loaded.map(d => d.id).concat(p.modules || []))).sort();
        const chips = make('div.ed-chips');
        for (const id of known) {
          const def = byId.get(id) || null;
          const on = (p.modules || []).includes(id);
          const c = make('button.ed-chip', { text: `${on ? '✓ ' : ''}${KIT.labelOf(def, ED, titleCase(id))}` });
          c.type = 'button';
          c.setAttribute('aria-pressed', String(on));
          if (!def) { c.classList.add('ed-chip-warn'); c.title = `This project asks for “${id}”, but it is not on the page.`; }
          else if (def.describe) c.title = def.describe;
          c.onclick = () => {
            const list = (p.modules || []).slice();
            const i = list.indexOf(id);
            if (i >= 0) list.splice(i, 1); else list.push(id);
            setAt(['modules'], list, on ? 'Switch module off' : 'Switch module on');
          };
          chips.appendChild(c);
        }
        if (!known.length) body.appendChild(make('div.ed-hint', { text: 'No modules are loaded. tools/new-module.js writes one.' }));
        body.appendChild(chips);
      });
    },
  });

  // -------------------------------------------------------------- Variables ----------
  const varState = { query: '', open: {} };
  KIT.registry('editorPanels').add({
    id: 'vars', label: 'Variables', icon: 'var', order: 55,
    mount(host) {
      clear(host);
      const el = this._el = {};
      const head = make('div.ed-row');
      el.search = make('input.ed-obj-search');
      el.search.type = 'search';
      el.search.placeholder = 'Find a Switch/Variable…';
      el.search.value = varState.query;
      el.search.oninput = () => { varState.query = el.search.value; this._sig = ''; this._version = ''; this.refresh(ED); };
      head.appendChild(el.search);
      head.appendChild(btn('＋ New', 'Declare a new variable', () => {
        const name = `var${Object.keys(project().vars || {}).length + 1}`;
        commit('Declare variable', (doc, O) => O.declareVar(doc, { name, type: 'number', default: 0, label: titleCase(name) }));
        varState.open[name] = true;
        this._sig = ''; this._version = '';
        this.refresh(ED);
      }, 'primary'));
      host.appendChild(head);
      host.appendChild(make('div.ed-hint', { text: 'A Switch is a variable of type “bool”. Declaring one gives it a type, a starting value and a name you will recognise later.' }));
      el.list = make('div.ed-var-list');
      host.appendChild(el.list);
      this.refresh(ED);
    },
    refresh(ed) {
      const el = this._el;
      if (!el) return;
      const active = document.activeElement;
      if (active && el.list.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;
      // Cheap gate first. varIndex() walks every command in the project
      // (P.collect), and this refresh runs after EVERY commit anywhere in the
      // editor — so a keystroke in a dialogue line used to re-index the whole
      // game before this panel discovered it had nothing to redraw. The
      // document's change counter says so without the walk.
      const version = (ed.state.doc ? ed.state.doc.seq : -1) + '|' + JSON.stringify(varState);
      if (version === this._version && this._sig) return;
      const p = ed.state.project;
      const index = PP.varIndex(p);
      const q = varState.query.trim().toLowerCase();
      const shown = index.filter(v => !q || v.name.toLowerCase().indexOf(q) >= 0 || String((v.decl && v.decl.label) || '').toLowerCase().indexOf(q) >= 0);
      const sig = JSON.stringify([shown.map(v => [v.name, v.declared, v.decl, v.reads.length, v.writes.length]), varState]);
      this._version = version;
      if (sig === this._sig) return;
      this._sig = sig;
      clear(el.list);
      const declared = shown.filter(v => v.declared);
      const loose = shown.filter(v => !v.declared);
      if (loose.length) {
        el.list.appendChild(make('div.ed-h4', { text: `Used but not declared (${loose.length})` }));
        el.list.appendChild(make('div.ed-hint', { text: 'These work — the engine treats a missing variable as 0/false — but nothing says what they are for.' }));
        for (const v of loose) el.list.appendChild(varRow(v, this));
      }
      el.list.appendChild(make('div.ed-h4', { text: `Declared (${declared.length})` }));
      if (!declared.length) el.list.appendChild(make('div.ed-hint', { text: 'None yet.' }));
      let group = null;
      for (const v of declared) {
        if ((v.group || '') !== group) { group = v.group || ''; if (group) el.list.appendChild(make('div.ed-label', { text: group })); }
        el.list.appendChild(varRow(v, this));
      }
    },
  });

  function varRow(v, panel) {
    const p = project();
    const card = make('div.ed-var' + (v.declared ? '' : '.is-loose'));
    const head = make('div.ed-row.ed-var-head');
    const name = make('button.ed-var-name', { text: v.name });
    name.type = 'button';
    name.onclick = () => { varState.open[v.name] = !varState.open[v.name]; panel._sig = ''; panel._version = ''; panel.refresh(ED); };
    head.appendChild(name);
    if (v.decl && v.decl.label && v.decl.label !== titleCase(v.name)) head.appendChild(make('span.ed-sub', { text: v.decl.label }));
    if (v.decl) head.appendChild(make('span.ed-badge.ed-vartype', { text: `${v.decl.type === 'bool' ? 'Switch' : v.decl.type} = ${String(v.decl.default)}` }));
    head.appendChild(make('div.ed-spacer'));
    head.appendChild(make('span.ed-badge', { text: `${v.reads.length} read${v.reads.length === 1 ? '' : 's'}` }));
    head.appendChild(make('span.ed-badge' + (v.writes.length ? '' : '.warn'), { text: `${v.writes.length} write${v.writes.length === 1 ? '' : 's'}` }));
    if (!v.declared) {
      head.appendChild(btn('＋ Declare', 'Give it a type and a default', () => {
        const type = PP.guessType(v.name);
        commit(`Declare ${v.name}`, (doc, O) => O.declareVar(doc, { name: v.name, type, default: PP.defaultFor(type), label: titleCase(v.name) }));
        varState.open[v.name] = true;
        panel._sig = ''; panel._version = '';
        panel.refresh(ED);
      }, 'primary'));
    }
    card.appendChild(head);
    if (!varState.open[v.name]) return card;

    if (v.declared) {
      const d = v.decl || {};
      const row = make('div.ed-row');
      const type = make('select');
      for (const t of ['number', 'bool', 'string']) {
        const o = make('option', { text: t === 'bool' ? 'bool (Switch)' : t });
        o.value = t;
        type.appendChild(o);
      }
      type.value = d.type || 'number';
      type.onchange = () => commit('Variable type', (doc, O) => {
        O.setField(doc, ['vars', v.name, 'type'], type.value);
        O.setField(doc, ['vars', v.name, 'default'], PP.defaultFor(type.value));
      });
      row.appendChild(type);
      const def = make('input.ed-small-input');
      def.type = 'text';
      def.value = String(d.default == null ? '' : d.default);
      def.title = 'Starting value';
      def.onchange = () => {
        const t = d.type || 'number';
        const v2 = t === 'number' ? (Number(def.value) || 0) : t === 'bool' ? /^(true|1|yes|on)$/i.test(def.value.trim()) : def.value;
        setAt(['vars', v.name, 'default'], v2, 'Variable default');
      };
      row.appendChild(def);
      card.appendChild(row);
      const row2 = make('div.ed-row');
      const label = make('input.ed-half');
      label.type = 'text';
      label.placeholder = 'Label';
      label.value = d.label || '';
      label.onchange = () => setAt(['vars', v.name, 'label'], label.value, 'Variable label');
      row2.appendChild(label);
      const grp = make('input.ed-half');
      grp.type = 'text';
      grp.placeholder = 'Group';
      grp.value = d.group || '';
      grp.onchange = () => setAt(['vars', v.name, 'group'], grp.value, 'Variable group');
      row2.appendChild(grp);
      row2.appendChild(btn('✕', 'Undeclare (the scripts keep using it)', async () => {
        if (!(await ED.confirm(`Remove the declaration of “${v.name}”?`))) return;
        commit('Undeclare variable', (doc) => doc.del(['vars', v.name]));
        panel._sig = '';
        panel.refresh(ED);
      }, 'danger'));
      card.appendChild(row2);
    }
    const uses = make('div.ed-var-uses');
    const add = (list, kind) => {
      for (const w of list.slice(0, 12)) {
        const item = make('div.ed-item.ed-use');
        item.appendChild(make('span.ed-badge' + (kind === 'write' ? '.ed-write' : ''), { text: kind === 'write' ? 'writes' : 'reads' }));
        item.appendChild(make('span.ed-item-text', { text: PP.usageLabel(p, w) }));
        item.onclick = () => {
          const sel = PP.usageSelection(w);
          if (w.map && ED.state.mapId !== w.map && p.maps[w.map]) ED.openMap(w.map);
          ED.select(sel);
          if (sel.kind === 'slot' || sel.kind === 'script') ED.set({ panel: 'script' });
          else ED.set({ panel: 'objects' });
        };
        uses.appendChild(item);
      }
      if (list.length > 12) uses.appendChild(make('div.ed-hint', { text: `…and ${list.length - 12} more.` }));
    };
    add(v.writes, 'write');
    add(v.reads, 'read');
    if (!v.uses) uses.appendChild(make('div.ed-hint', { text: 'Nothing uses this yet.' }));
    card.appendChild(uses);
    return card;
  }

  // ------------------------------------------------------------------ Rules ----------
  // A rule of the world is content, so it is edited where content is edited, and
  // it is made of two things the author already knows: a condition and a script.
  // The panel adds nothing of its own except the one sentence that says what the
  // rule DOES — `when` … `if` … `do` — because a list of rules you cannot read at
  // a glance is a list you will not keep.
  /** A rule in one line of English, for the list. */
  PP.ruleLine = function (r) {
    const when = `on ${r.when || 'step'}`;
    const when2 = r.if && KIT.conditions ? `, if ${KIT.conditions.describe(r.if)}` : '';
    const n = Array.isArray(r.do) ? r.do.length : 0;
    const does = n ? `, do ${n} thing${n === 1 ? '' : 's'}` : ', do nothing yet';
    const where = r.scope && ((r.scope.maps || []).length || (r.scope.layers || []).length)
      ? ` · only in ${[].concat(r.scope.maps || [], r.scope.layers || []).join(', ')}` : '';
    return when + when2 + does + where;
  };
  KIT.registry('editorPanels').add({
    id: 'rules', label: 'Rules', icon: 'label', order: 56,
    mount(host) {
      clear(host);
      const el = this._el = {};
      const head = make('div.ed-row');
      el.search = make('input.ed-obj-search');
      el.search.type = 'search';
      el.search.placeholder = 'Find a rule…';
      el.search.oninput = () => { this._sig = ''; this.refresh(ED); };
      head.appendChild(el.search);
      head.appendChild(btn('＋ New', 'Add a rule of the world', () => {
        const id = commit('New rule', (doc, O) => O.newRule(doc, { name: 'New rule', when: 'step' }));
        ED.select({ kind: 'rule', id });
      }, 'primary'));
      host.appendChild(head);
      host.appendChild(make('div.ed-hint', { text: 'A rule is something that is true about the world until it stops being true. It can be switched off, rewritten, or eaten — “@rule eat doors-need-keys” — and after that the game plays differently.' }));
      el.list = make('div.ed-list');
      host.appendChild(el.list);
      el.detail = make('div');
      host.appendChild(el.detail);
      this._form = null;
      this.refresh(ED);
    },
    refresh(ed) {
      const el = this._el;
      if (!el) return;
      const p = ed.state.project;
      const sel = ed.state.selection;
      const selId = sel && sel.kind === 'rule' ? sel.id : null;
      const q = (el.search.value || '').toLowerCase();
      const ids = Object.keys(p.rules || {}).filter(id => !q || `${id} ${p.rules[id].name || ''}`.toLowerCase().indexOf(q) >= 0);
      const sig = JSON.stringify([ids.map(id => [id, p.rules[id]]), selId]);
      if (sig === this._sig) return;
      this._sig = sig;
      clear(el.list);
      for (const id of ids) {
        const r = p.rules[id];
        const item = make('div.ed-item');
        item.setAttribute('aria-selected', String(id === selId));
        const text = make('div.ed-item-text');
        text.appendChild(make('span.ed-slot-name', { text: r.name || id }));
        text.appendChild(make('span.ed-hint', { text: PP.ruleLine(r) }));
        item.appendChild(text);
        if (r.on === false) item.appendChild(make('span.ed-badge.warn', { text: 'off' }));
        if (r.edible === false) item.appendChild(make('span.ed-badge', { text: 'cannot be eaten' }));
        item.appendChild(make('span.ed-badge', { text: id }));
        item.onclick = () => ED.select({ kind: 'rule', id });
        el.list.appendChild(item);
      }
      if (!ids.length) el.list.appendChild(ED.emptyState({ icon: '📜', text: 'No rules yet', hint: 'Try one: on bump, if the door is locked, say “it needs a key”. Then let the player eat it.' }));
      if (this._form) { try { this._form.destroy(); } catch (e) { /* ignore */ } this._form = null; }
      clear(el.detail);
      if (!selId || !p.rules[selId]) return;
      const r = p.rules[selId];
      el.detail.appendChild(make('h3.ed-obj-title', { text: r.name || selId }));
      el.detail.appendChild(make('div.ed-hint', { text: PP.ruleLine(r) }));
      const form = make('div');
      el.detail.appendChild(form);
      this._form = INS().mount(form, {
        fields: P.fields.rule || [],
        value: r,
        ctx: { project: p },
        onChange(path, v) { setAt(['rules', selId].concat(path), v, 'Edit rule'); },
      });
      el.detail.appendChild(btn('✕ Delete this rule', 'Remove it from the project', async () => {
        if (!(await ED.confirm(`Delete “${r.name || selId}”?`))) return;
        commit('Delete rule', (doc, O) => O.deleteRule(doc, { id: selId }));
        ED.select(null);
      }, 'danger'));
    },
  });

  // ------------------------------------------------------------------ Items ----------
  KIT.registry('editorPanels').add({
    id: 'items', label: 'Items', icon: 'bag', order: 57,
    mount(host) {
      clear(host);
      const el = this._el = {};
      const head = make('div.ed-row');
      el.search = make('input.ed-obj-search');
      el.search.type = 'search';
      el.search.placeholder = 'Find an item…';
      el.search.oninput = () => { this._sig = ''; this.refresh(ED); };
      head.appendChild(el.search);
      head.appendChild(btn('＋ New', 'Add an item', () => {
        const id = commit('New item', (doc, O) => O.newItem(doc, { name: 'New item' }));
        ED.select({ kind: 'item', id });
      }, 'primary'));
      host.appendChild(head);
      el.list = make('div.ed-list');
      host.appendChild(el.list);
      el.detail = make('div');
      host.appendChild(el.detail);
      this._form = null;
      this.refresh(ED);
    },
    refresh(ed) {
      const el = this._el;
      if (!el) return;
      const p = ed.state.project;
      const sel = ed.state.selection;
      const selId = sel && sel.kind === 'item' ? sel.id : null;
      const q = (el.search.value || '').toLowerCase();
      const ids = Object.keys(p.items || {}).filter(id => !q || `${id} ${p.items[id].name || ''}`.toLowerCase().indexOf(q) >= 0);
      const sig = JSON.stringify([ids.map(id => [id, p.items[id]]), selId]);
      if (sig === this._sig) return;
      this._sig = sig;
      clear(el.list);
      for (const id of ids) {
        const it = p.items[id];
        const item = make('div.ed-item');
        item.setAttribute('aria-selected', String(id === selId));
        const text = make('div.ed-item-text');
        text.appendChild(make('span.ed-slot-name', { text: it.name || id }));
        text.appendChild(make('span.ed-hint', { text: `${it.kind || 'item'} · ${it.desc || 'no description'}` }));
        item.appendChild(text);
        item.appendChild(make('span.ed-badge', { text: id }));
        item.onclick = () => ED.select({ kind: 'item', id });
        el.list.appendChild(item);
      }
      if (!ids.length) el.list.appendChild(ED.emptyState({ icon: '🎒', text: 'No items yet', hint: 'Items are what an “Item on ground” Event gives, and what conditions ask about.' }));
      if (this._form) { try { this._form.destroy(); } catch (e) { /* ignore */ } this._form = null; }
      clear(el.detail);
      if (!selId || !p.items[selId]) return;
      const it = p.items[selId];
      el.detail.appendChild(make('h3.ed-obj-title', { text: it.name || selId }));
      const form = make('div');
      el.detail.appendChild(form);
      this._form = INS().mount(form, {
        fields: P.fields.item || [],
        value: it,
        ctx: { project: p },
        onChange(path, v) { setAt(['items', selId].concat(path), v, 'Edit item'); },
      });
      el.detail.appendChild(btn('✕ Delete this item', 'Remove it from the project', async () => {
        if (!(await ED.confirm(`Delete “${it.name || selId}”?`))) return;
        commit('Delete item', (doc) => doc.del(['items', selId]));
        ED.select(null);
      }, 'danger'));
    },
  });

  // ---------------------------------------------------------------- Strings ----------
  KIT.registry('editorPanels').add({
    id: 'strings', label: 'Terms', icon: 'text', order: 59,
    mount(host) {
      clear(host);
      const el = this._el = {};
      host.appendChild(make('div.ed-hint', { text: 'Terms are the words the engine says on its own: “Got {count} {item}!”, “New Game”, “Save”. Change one and every message that uses it changes.' }));
      el.search = make('input.ed-obj-search');
      el.search.type = 'search';
      el.search.placeholder = 'Find a term…';
      el.search.oninput = () => { this._sig = ''; this.refresh(ED); };
      host.appendChild(el.search);
      el.list = make('div.ed-terms');
      host.appendChild(el.list);
      this.refresh(ED);
    },
    refresh(ed) {
      const el = this._el;
      if (!el) return;
      const p = ed.state.project;
      const defs = KIT.registry('strings').list();
      const q = (el.search.value || '').toLowerCase();
      const rows = defs.filter(d => !q || `${d.id} ${d.default} ${(p.strings || {})[d.id] || ''}`.toLowerCase().indexOf(q) >= 0);
      const sig = JSON.stringify([rows.map(d => [d.id, (p.strings || {})[d.id]]), q]);
      if (sig === this._sig) return;
      const active = document.activeElement;
      if (active && el.list.contains(active)) return;
      this._sig = sig;
      clear(el.list);
      for (const d of rows) {
        const cur = (p.strings || {})[d.id];
        const row = make('div.ed-term');
        const head = make('div.ed-row.ed-term-head');
        head.appendChild(make('span.ed-badge', { text: d.id }));
        const changed = cur != null && cur !== d.default;
        if (changed) {
          head.appendChild(make('span.ed-badge.warn', { text: 'changed' }));
          head.appendChild(btn('↺', `Back to “${d.default}”`, () => setAt(['strings', d.id], d.default, 'Reset term'), 'tiny'));
        }
        row.appendChild(head);
        const input = make('input');
        input.type = 'text';
        input.value = cur == null ? d.default : cur;
        input.onchange = () => setAt(['strings', d.id], input.value, 'Edit term');
        row.appendChild(input);
        el.list.appendChild(row);
      }
      if (!rows.length) el.list.appendChild(make('div.ed-hint', { text: 'Nothing by that name.' }));
    },
  });

  // ------------------------------------------------------------------- Data ----------
  KIT.registry('editorPanels').add({
    id: 'data', label: 'Data', icon: 'json', order: 70,
    mount(host) {
      clear(host);
      const el = this._el = {};
      host.appendChild(make('div.ed-hint', { text: 'The escape hatch: the raw JSON of whatever is selected. Nothing is applied until it reads cleanly, and applying it is one undo step.' }));
      const head = make('div.ed-row');
      el.what = make('span.ed-badge');
      head.appendChild(el.what);
      el.whole = make('button.ed-chip', { text: 'Whole project' });
      el.whole.type = 'button';
      el.whole.onclick = () => { this._whole = !this._whole; this._sig = ''; this.refresh(ED); };
      head.appendChild(el.whole);
      host.appendChild(head);
      el.ta = make('textarea.ed-json');
      el.ta.spellcheck = false;
      el.ta.oninput = () => { el.status.textContent = 'edited — press Check'; };
      host.appendChild(el.ta);
      el.status = make('div.ed-hint');
      host.appendChild(el.status);
      const bar = make('div.ed-row');
      bar.appendChild(btn('Check', 'Read it without applying it', () => check(this, false)));
      bar.appendChild(btn('Apply', 'Write it into the project (one undo step)', () => check(this, true), 'primary'));
      bar.appendChild(btn('↺ Reload', 'Throw away these edits', () => { this._sig = ''; this.refresh(ED); }));
      host.appendChild(bar);
      this.refresh(ED);
    },
    refresh(ed) {
      const el = this._el;
      if (!el) return;
      const p = ed.state.project;
      const where = this._whole ? { path: [], label: 'the whole project' } : PP.dataPath(p, ed.state.selection);
      this._where = where;
      const value = where.path.length ? KIT.path.get(p, where.path) : p;
      const sig = JSON.stringify([where.path, value]);
      if (sig === this._sig) return;
      if (document.activeElement === el.ta) return;
      this._sig = sig;
      // "Showing: Mom on Home" and a chip to widen to the whole project; with nothing
      // selected there is nothing to widen, so the chip stays out of the way.
      const selected = PP.dataPath(p, ed.state.selection);
      el.what.textContent = where.path.length ? `Showing ${where.label}` : 'Showing the whole project';
      el.whole.hidden = !selected.path.length;
      el.whole.textContent = this._whole ? `Back to ${selected.label}` : 'Whole project';
      el.whole.setAttribute('aria-pressed', String(!!this._whole));
      el.ta.value = JSON.stringify(value === undefined ? null : value, null, 2);
      el.status.textContent = `${el.ta.value.length} characters`;
    },
  });

  /**
   * openGame(text, what, say) — read a game file and put it in place of this one,
   * as ONE undo step. It is checked before anything is replaced: a file that is
   * not a game says so and changes nothing, and a game with problems in it is
   * opened anyway with the problems reported, because half a game you can fix is
   * better than a refusal.
   */
  function openGame(text, what, say) {
    const read = KIT.storage.fromFile(text);
    if (!read.ok) { say(read.reason, false); return; }
    let normalized, problems;
    try {
      const n = P.normalize(read.project);
      normalized = n.project;
      problems = n.problems.filter(x => x.severity === 'error');
    } catch (e) { say(`That game could not be read: ${e.message}`, false); return; }

    const title = (normalized.meta && normalized.meta.title) || what;
    const when = read.savedAt ? ` (saved ${String(read.savedAt).slice(0, 16).replace('T', ' ')})` : '';
    // Said BEFORE the refresh, because the refresh rebuilds this panel — saying
    // it afterwards would write into the element the rebuild has just discarded.
    moveState.said = {
      text: problems.length
        ? `Opened “${title}”${when} — with ${problems.length} thing(s) to fix; the Problems panel lists them.`
        : `Opened “${title}”${when}. Ctrl+Z puts the old one back.`,
      ok: !problems.length,
    };
    moveState.open = true;                       // and leave the section open, so the answer is on screen
    commit('Open a game', (doc) => doc.replace(normalized, { label: 'Open a game' }));
    ED.refresh();
    ED.toast(`Opened “${title}”`);
  }

  function check(panel, apply) {
    const el = panel._el;
    const where = panel._where || { path: [] };
    const r = PP.checkData(project(), where.path, el.ta.value);
    el.status.textContent = r.message;
    el.status.className = 'ed-hint ' + (r.ok ? 'ed-ok' : 'ed-warn');
    if (!r.ok || !apply) return;
    commit('Edit data', (doc, O) => {
      if (where.path.length) O.setField(doc, where.path, r.value, 'Edit data');
      else doc.replace(r.value, { label: 'Edit data' });
    });
    ED.refresh();
    panel._sig = '';
    ED.toast('Applied — Ctrl+Z puts it back');
  }

  // ----------------------------------------------------------------- Import ----------
  // the last thing dropped, so the report and the Import button agree about what they are looking at
  const importState = { report: null, result: null, found: null };
  KIT.registry('editorPanels').add({
    id: 'import', label: 'Import', icon: 'import', order: 75,
    mount(host) {
      clear(host);
      const el = this._el = {};
      host.appendChild(make('div.ed-hint', { text: 'Bring in a Tiled map (.tmj/.tmx + its tilesets), an RPG Maker MV/MZ data folder (the .json files), or Aseprite art (.aseprite, or a sheet .json next to its .png). Images are embedded, so nothing depends on where the file lived.' }));
      el.drop = make('div.ed-drop');
      el.drop.appendChild(make('div.ed-drop-big', { text: '⤓' }));
      el.drop.appendChild(make('div', { text: 'Drop files here' }));
      const pick = make('button.ed-btn.primary', { text: 'Choose files…' });
      pick.type = 'button';
      el.file = make('input');
      el.file.type = 'file';
      el.file.multiple = true;
      el.file.style.display = 'none';
      el.file.onchange = () => { if (el.file.files && el.file.files.length) read(this, Array.from(el.file.files)); };
      pick.onclick = () => el.file.click();
      el.drop.appendChild(pick);
      el.drop.appendChild(el.file);
      el.drop.addEventListener('dragover', (e) => { e.preventDefault(); el.drop.classList.add('is-over'); });
      el.drop.addEventListener('dragleave', () => el.drop.classList.remove('is-over'));
      el.drop.addEventListener('drop', (e) => {
        e.preventDefault();
        el.drop.classList.remove('is-over');
        const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
        if (files.length) read(this, files);
      });
      host.appendChild(el.drop);
      host.appendChild(make('div.ed-label', { text: 'Before you import' }));
      const opts = make('div.ed-row');
      el.prefix = make('input.ed-half');
      el.prefix.type = 'text';
      el.prefix.placeholder = 'Name everything “prefix:…”';
      el.prefix.title = 'A prefix keeps imported ids apart from yours: outside → outside:grass';
      opts.appendChild(el.prefix);
      el.overwrite = make('button.ed-chip', { text: 'Replace what is there' });
      el.overwrite.title = 'Off: anything with the same id is kept as it is.';
      el.overwrite.type = 'button';
      el.overwrite.setAttribute('aria-pressed', 'false');
      el.overwrite.onclick = () => { const on = el.overwrite.getAttribute('aria-pressed') === 'true'; el.overwrite.setAttribute('aria-pressed', String(!on)); };
      opts.appendChild(el.overwrite);
      host.appendChild(opts);
      host.appendChild(make('div.ed-hint', { text: 'A prefix keeps imported ids apart from your own (outside → outside:grass). “Replace what is there” is off unless you turn it on, and an import is one undo step either way.' }));
      el.report = make('div.ed-import-report');
      host.appendChild(el.report);
    },
    refresh() { /* the report is only rebuilt when something is imported */ },
  });

  /** Read the dropped files (text for data, bytes for art), then run the importer. */
  async function read(panel, fileList) {
    const el = panel._el;
    clear(el.report);
    el.report.appendChild(make('div.ed-hint', { text: `Reading ${fileList.length} file${fileList.length === 1 ? '' : 's'}…` }));
    const files = [];
    for (const f of fileList) {
      const name = f.webkitRelativePath || f.name;
      const bytes = new Uint8Array(await f.arrayBuffer());
      const isImage = IMAGE_EXT.test(name);
      const isBinary = isImage || /\.(aseprite|ase)$/i.test(name);
      let text = null;
      if (!isBinary) { try { text = new TextDecoder().decode(bytes); } catch (e) { text = null; } }
      files.push({ name, bytes, text, type: f.type });
    }
    runImport(panel, files);
  }

  function assetResolver(files, prefix) {
    const byName = new Map();
    for (const f of files) if (IMAGE_EXT.test(f.name)) byName.set(base(f.name).toLowerCase(), f);
    const seen = new Map();
    const missing = [];
    return {
      missing,
      asset(src) {
        const raw = String(src == null ? '' : src);
        if (!raw) return null;
        if (/^data:/i.test(raw)) return { id: KIT.slug(prefix ? prefix + '-inline' : 'inline'), src: raw, w: 0, h: 0 };
        const key = base(raw).toLowerCase();
        const f = byName.get(key) || byName.get(key.replace(/\.[a-z0-9]+$/, '.png'));
        if (!f) { if (!missing.includes(raw)) missing.push(raw); return null; }
        if (seen.has(f.name)) return seen.get(f.name);
        let id = KIT.slug(base(f.name).replace(/\.[A-Za-z0-9]+$/, ''));
        if (prefix) id = KIT.slug(prefix) + ':' + id;
        const size = IMPP.imageSize(f.bytes) || { w: 0, h: 0 };
        const mime = f.type || (/\.gif$/i.test(f.name) ? 'image/gif' : /\.jpe?g$/i.test(f.name) ? 'image/jpeg' : 'image/png');
        const out = { id, src: `data:${mime};base64,${bytesToBase64(f.bytes)}`, w: size.w, h: size.h };
        seen.set(f.name, out);
        return out;
      },
    };
  }
  function bytesToBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  /** Synchronous inflate in the browser: the Aseprite importer carries its own. */
  function inflate(bytes, method) {
    const A = KIT.import.aseprite;
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (method === 'gzip') {
      let i = 10;
      const flg = b[3];
      if (flg & 4) i += 2 + (b[i] | (b[i + 1] << 8));
      if (flg & 8) { while (b[i]) i++; i++; }
      if (flg & 16) { while (b[i]) i++; i++; }
      if (flg & 2) i += 2;
      return A.inflateRaw(b.subarray(i));
    }
    return A.zinflate(b);
  }
  /** A PNG encoder for the Aseprite importer's "too big for pixel strings" fallback. */
  function encodePng(w, h, rgba) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(w, h);
    img.data.set(rgba);
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  function runImport(panel, files) {
    const el = panel._el;
    const prefix = (el.prefix.value || '').trim() || null;
    const found = IMPP.dispatch(files);
    importState.found = found;
    clear(el.report);
    if (!found.tool) {
      for (const p of found.problems) el.report.appendChild(make('div.ed-problem.warn', { text: p.message }));
      return;
    }
    const assets = assetResolver(files, prefix);
    const p = project();
    const mapId = (name) => {
      const want = KIT.slug(String(name).replace(/\.[A-Za-z0-9]+$/, '').split(/[\\/]/).pop());
      if (p.maps && p.maps[want]) return want;
      const ns = prefix ? `${KIT.slug(prefix)}:${want}` : want;
      return p.maps && p.maps[ns] ? ns : null;
    };
    let result = null;
    try {
      if (found.tool === 'tiled') {
        const byName = new Map();
        for (const f of files) if (f.text != null) byName.set(base(f.name).toLowerCase(), f.text);
        const external = (src) => byName.get(base(src).toLowerCase());
        const o = { asset: assets.asset, tileset: external, template: external, inflate, mapId, name: base(found.main.name), prefix };
        result = found.kind === 'tileset' ? KIT.import.tiled.tileset(found.main.text, o) : KIT.import.tiled.map(found.main.text, o);
      } else if (found.tool === 'rpgmaker') {
        const data = {};
        for (const f of found.files) { try { data[base(f.name)] = JSON.parse(f.text); } catch (e) { /* not a data file */ } }
        result = KIT.import.rpgmaker.project(data, { asset: assets.asset, prefix });
      } else {
        const o = { asset: assets.asset, prefix, name: base(found.main.name), id: KIT.slug(base(found.main.name).replace(/\.[A-Za-z0-9]+$/, '')), kind: 'sprite', inflate, encodePng };
        result = found.kind === 'file' ? KIT.import.aseprite.file(found.main.bytes, o) : KIT.import.aseprite.sheet(found.main.text, o);
      }
    } catch (e) {
      el.report.appendChild(make('div.ed-problem', { text: `The importer could not read that: ${e && e.message ? e.message : e}` }));
      return;
    }
    importState.result = result;
    const dry = KIT.import.merge(KIT.deepClone(p), result, { dryRun: true, overwrite: el.overwrite.getAttribute('aria-pressed') === 'true', prefix: null, source: found.label });
    for (const m of assets.missing) dry.problems.push({ severity: 'warn', code: 'image-missing', message: `the image “${m}” was not dropped in with it, so nothing was embedded`, where: {} });
    importState.report = dry;
    renderReport(panel, found, dry, result);
  }

  const COUNTS = [['maps', 'map'], ['objects', 'event'], ['tiles', 'tile'], ['sprites', 'sprite'], ['faces', 'face'], ['icons', 'icon'],
    ['animations', 'animation'], ['assets', 'image'], ['scripts', 'script'], ['vars', 'variable'], ['items', 'item'], ['terrains', 'terrain'], ['autotiles', 'autotile group']];
  function countLine(counts) {
    const parts = [];
    for (const [key, label] of COUNTS) if (counts[key]) parts.push(`${counts[key]} ${label}${counts[key] === 1 ? '' : 's'}`);
    return parts.length ? parts.join(' · ') : '—';
  }

  function renderReport(panel, found, report, result) {
    const el = panel._el;
    clear(el.report);
    el.report.appendChild(make('div.ed-h4', { text: found.label }));
    const table = make('div.ed-import-counts');
    for (const [label, counts] of [['Adds', report.added], ['Replaces', report.replaced], ['Already there', report.skipped], ['Unchanged', report.unchanged]]) {
      const line = countLine(counts);
      if (line === '—' && label !== 'Adds') continue;
      const row = make('div.ed-row');
      row.appendChild(make('span.ed-badge', { text: label }));
      row.appendChild(make('span.ed-item-text', { text: line }));
      table.appendChild(row);
    }
    el.report.appendChild(table);
    const errs = report.problems.filter(p => p.severity === 'error');
    for (const p of report.problems.slice(0, 20)) el.report.appendChild(make('div.ed-problem' + (p.severity === 'warn' ? '.warn' : p.severity === 'info' ? '.info' : ''), { text: `${p.code}: ${p.message}` }));
    if (report.problems.length > 20) el.report.appendChild(make('div.ed-hint', { text: `…and ${report.problems.length - 20} more notes.` }));
    const bar = make('div.ed-row');
    const apply = btn(errs.length ? 'Import anyway' : '✓ Import it', 'Merge this into the project as one undo step', () => {
      const rep = KIT.import.merge(ED.state.doc, result, { overwrite: el.overwrite.getAttribute('aria-pressed') === 'true', source: found.label });
      if (ED.inspector && ED.inspector.afterEdit) ED.inspector.afterEdit();
      ED.refresh();
      ED.toast(`Imported · ${countLine(rep.added)}`);
      clear(el.report);
      el.report.appendChild(make('div.ed-hint.ed-ok', { text: `Imported: ${countLine(rep.added)}. Ctrl+Z undoes the whole thing.` }));
      const first = Object.keys(result.maps || {})[0];
      if (first && ED.state.project.maps[first]) el.report.appendChild(btn(`Open the map “${first}”`, 'Go and look at it', () => ED.openMap(first), 'wide'));
    }, errs.length ? '' : 'primary');
    bar.appendChild(apply);
    bar.appendChild(btn('Cancel', 'Forget this import', () => clear(el.report)));
    el.report.appendChild(bar);
    if (errs.length) el.report.appendChild(make('div.ed-hint.ed-warn', { text: 'There are errors above. Importing anyway is allowed — the project will just have things to fix.' }));
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
