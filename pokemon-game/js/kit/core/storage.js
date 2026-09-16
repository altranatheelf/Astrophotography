// KIT.storage (§4.3): everything that outlives a page load — the editor draft,
// save slots, settings, the meta record that survives New Game — plus the
// export / download / publish plumbing.
//
// Adapters are tried in order: IndexedDB → localStorage → memory. Every access
// is wrapped: a blocked or full store never breaks the game, it just falls back
// (and `KIT.storage.warning` says so, for the UI to show).
//
// Keys are `kit.<projectId>.<what>`: draft, editorState, save.<slot>, meta.
// Settings are global (`kit.settings`), not per project.
//
//   await KIT.storage.ready()
//   const { project, source } = await KIT.storage.loadProject()
//   await KIT.storage.saveGame('autosave', world.save)
//   KIT.storage.settings().textSpeed        // cached, synchronous
(function (root) {
  const KIT = root.KIT = root.KIT || {};

  const DEFAULT_SETTINGS = {
    textSpeed: 'normal', zoom: 'auto', sound: true, music: true,
    soundVolume: 0.9, musicVolume: 0.5, coop: false, reduceMotion: false,
  };
  const DEFAULT_META = { runs: 0, firstPlayed: null, endingsSeen: [], namesUsed: [] };
  const SLOTS = ['autosave', '1', '2', '3'];
  const DB_NAME = 'kit-store';
  const DB_STORE = 'kv';
  const CAP_TIMEOUT = 10000;

  // ---- adapters ----------------------------------------------------------------
  function memoryAdapter() {
    const m = new Map();
    return {
      name: 'memory',
      async ready() { return true; },
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async set(k, v) { m.set(k, v); return true; },
      async del(k) { m.delete(k); return true; },
      async keys() { return Array.from(m.keys()); },
    };
  }

  function localAdapter(store) {
    const ls = store || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!ls) return null;
    return {
      name: 'localStorage',
      async ready() {
        const probe = 'kit.__probe';
        ls.setItem(probe, '1');
        ls.removeItem(probe);
        return true;
      },
      async get(k) { const s = ls.getItem(k); return s == null ? null : JSON.parse(s); },
      async set(k, v) { ls.setItem(k, JSON.stringify(v)); return true; },
      async del(k) { ls.removeItem(k); return true; },
      async keys() { const out = []; for (let i = 0; i < ls.length; i++) out.push(ls.key(i)); return out; },
    };
  }

  function idbAdapter(factory) {
    const idb = factory || (typeof indexedDB !== 'undefined' ? indexedDB : null);
    if (!idb) return null;
    let db = null;
    const open = () => new Promise((resolve, reject) => {
      let req;
      try { req = idb.open(DB_NAME, 1); } catch (e) { return reject(e); }
      req.onupgradeneeded = () => { try { req.result.createObjectStore(DB_STORE); } catch (e) { /* exists */ } };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
      req.onblocked = () => reject(new Error('indexedDB blocked'));
      setTimeout(() => reject(new Error('indexedDB timeout')), 4000);
    });
    const tx = (mode, fn) => new Promise((resolve, reject) => {
      let t;
      try { t = db.transaction(DB_STORE, mode); } catch (e) { return reject(e); }
      const req = fn(t.objectStore(DB_STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexedDB request failed'));
    });
    return {
      name: 'indexedDB',
      async ready() { db = await open(); return true; },
      async get(k) { const v = await tx('readonly', (s) => s.get(k)); return v === undefined ? null : v; },
      async set(k, v) { await tx('readwrite', (s) => s.put(v, k)); return true; },
      async del(k) { await tx('readwrite', (s) => s.delete(k)); return true; },
      async keys() { return (await tx('readonly', (s) => s.getAllKeys())) || []; },
    };
  }

  // ---- state -------------------------------------------------------------------
  let adapter = null;
  let readyPromise = null;
  let projectId = 'kit';
  let settingsCache = null;
  let metaCache = null;
  let draftTimer = null;
  let draftPending = null;

  const S = KIT.storage = {
    SLOTS,
    warning: null,          // a human sentence when we had to fall back
    adapters: { memory: memoryAdapter, local: localAdapter, idb: idbAdapter },
    /** onDownload(name, text) — last-resort hook when neither the artifact capability nor a Blob link works. */
    onDownload: null,
  };

  const key = (what) => `kit.${projectId}.${what}`;

  async function pickAdapter() {
    const tries = [];
    if (!S.forceAdapter || S.forceAdapter === 'indexedDB') tries.push(idbAdapter());
    if (!S.forceAdapter || S.forceAdapter === 'localStorage') tries.push(localAdapter());
    for (const a of tries) {
      if (!a) continue;
      try { await a.ready(); return a; } catch (e) { /* try the next one */ }
    }
    S.warning = 'Saving only lasts while this page is open (your browser blocked storage).';
    const m = memoryAdapter();
    await m.ready();
    return m;
  }

  /** ready() -> { adapter } — picks the adapter once and warms the settings/meta caches. */
  S.ready = function () {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      adapter = await pickAdapter();
      settingsCache = Object.assign({}, DEFAULT_SETTINGS, (await S.get('kit.settings')) || {});
      metaCache = Object.assign({}, DEFAULT_META, (await S.get(key('meta'))) || {});
      return { adapter: adapter.name };
    })();
    return readyPromise;
  };
  /** _reset() — tests only: forget the adapter and the caches. */
  S._reset = function () { adapter = null; readyPromise = null; settingsCache = null; metaCache = null; projectId = 'kit'; S.warning = null; return S; };
  S.info = () => ({ adapter: adapter ? adapter.name : null, projectId, warning: S.warning });
  S.projectId = (id) => { if (id) projectId = id; return projectId; };

  // ---- raw access (every call is safe) -----------------------------------------
  S.get = async function (k) {
    try { if (!adapter) await S.ready(); return await adapter.get(k); } catch (e) { return null; }
  };
  S.set = async function (k, v) {
    try { if (!adapter) await S.ready(); return await adapter.set(k, v); } catch (e) { S.warning = 'Could not save (storage is full or blocked).'; return false; }
  };
  S.del = async function (k) {
    try { if (!adapter) await S.ready(); return await adapter.del(k); } catch (e) { return false; }
  };
  S.keys = async function () {
    try { if (!adapter) await S.ready(); return await adapter.keys(); } catch (e) { return []; }
  };

  // ---- settings and meta (cached, read synchronously) --------------------------
  /** settings() -> the live settings object (defaults filled). Change it through saveSettings(). */
  S.settings = function () { return settingsCache || (settingsCache = Object.assign({}, DEFAULT_SETTINGS)); };
  S.saveSettings = function (patch) {
    settingsCache = Object.assign({}, S.settings(), patch || {});
    return S.set('kit.settings', settingsCache).then(() => settingsCache);
  };
  /** meta() -> { runs, firstPlayed, endingsSeen, namesUsed } — survives New Game. */
  S.meta = function () { return metaCache || (metaCache = Object.assign({}, DEFAULT_META)); };
  S.saveMeta = function (patch) {
    metaCache = Object.assign({}, S.meta(), patch || {});
    // null forgets a key rather than remembering the word "null" — the `forget`
    // half of the @remember command.
    for (const k of Object.keys(patch || {})) if (patch[k] === null && !(k in DEFAULT_META)) delete metaCache[k];
    return S.set(key('meta'), metaCache).then(() => metaCache);
  };

  // ---- the project -------------------------------------------------------------
  /** The `<script id="project-data">` block, or null. */
  function embeddedProject() {
    try {
      if (typeof document === 'undefined') return null;
      const el = document.getElementById('project-data');
      if (!el || !el.textContent.trim()) return null;
      return JSON.parse(el.textContent);
    } catch (e) { (KIT.log || console).warn('[storage] the embedded project-data is not valid JSON', e); return null; }
  }

  /**
   * loadProject(opts) -> { project, source, problems }
   * draft → embedded `project-data` → content files (KIT.project.fromContent) → KIT.project.blank().
   *
   *   opts.draft      false to ignore a saved Creator Mode draft
   *   opts.projectId  which content project to read
   *   opts.before     before(rawProject) — run once the project is found and
   *                   before it is normalized or validated, so anything it
   *                   registers counts. This is where modules start.
   *   opts.validate   false to skip the validation pass. It is the expensive
   *                   half (2.3s of a 2.8s boot on a 400-map project) and only
   *                   an author needs it, so the game boots without it and
   *                   checks a moment later, when nobody is waiting.
   */
  S.loadProject = async function (opts) {
    opts = opts || {};
    await S.ready();
    let base = null, source = 'default';
    const embedded = embeddedProject();
    if (embedded) { base = embedded; source = 'embedded'; }
    if (!base) {
      try { const c = KIT.project.fromContent(opts.projectId); if (c) { base = c; source = 'content'; } } catch (e) { /* no content */ }
    }
    if (!base) { base = KIT.project.blank(); source = 'default'; }
    projectId = (base.meta && base.meta.id) || 'kit';
    metaCache = Object.assign({}, DEFAULT_META, (await S.get(key('meta'))) || {});

    if (opts.draft !== false) {
      const draft = await S.get(key('draft'));
      if (draft && draft.project) { base = draft.project; source = 'draft'; }
    }
    let project = base, problems = [];
    // Last chance to teach the registries what this project is made of, while it
    // is still the raw thing that came off disk. Everything validated below —
    // every tile id, every object type, every command in every page — is checked
    // against what is registered NOW, so whatever registers late is reported as
    // unknown. `opts.before(base)` is where the modules the project enables get
    // switched on (js/main.js); it may be async.
    if (typeof opts.before === 'function') {
      try { await opts.before(base); }
      catch (e) { (KIT.log || console).error('[storage] the project’s modules did not start', e); }
    }
    // Imported art (tiles/sprites/faces/icons/assets the project carries) has no
    // js/art file to register it, so the project registers its own — before
    // normalize, which validates every tile id a map uses.
    try { KIT.project.registerContent(base); } catch (e) { (KIT.log || console).warn('[storage] the project content did not register', e); }
    try {
      const n = KIT.project.normalize(base, opts.validate === false ? { validate: false } : undefined);
      project = n.project; problems = n.problems;
    }
    catch (e) { (KIT.log || console).error('[storage] the project did not normalize; starting blank', e); project = KIT.project.blank(); source = 'default'; }
    projectId = (project.meta && project.meta.id) || projectId;
    return { project, source, problems };
  };

  /** saveDraft(project) — debounced 500 ms (the editor calls it on every edit). */
  S.saveDraft = function (project, opts) {
    draftPending = project;
    if (draftTimer) clearTimeout(draftTimer);
    const flush = () => {
      draftTimer = null;
      const p = draftPending;
      draftPending = null;
      if (!p) return Promise.resolve(false);
      return S.set(key('draft'), { savedAt: new Date().toISOString(), writerId: S.writerId(), project: p });
    };
    if (opts && opts.now) return flush();
    return new Promise((resolve) => { draftTimer = setTimeout(() => resolve(flush()), 500); });
  };
  S.discardDraft = function () { if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; } draftPending = null; return S.del(key('draft')); };
  S.hasDraft = async function () { return !!(await S.get(key('draft'))); };
  let writerId = null;
  S.writerId = function () { return writerId || (writerId = KIT.uid('tab')); };

  // ---- text in and out ----------------------------------------------------------
  S.exportText = function (obj) { return KIT.stableStringify(obj, 2); };
  S.importText = function (text) { return JSON.parse(String(text)); };

  /** The artifact host's capability, if this page is running inside one. Always guarded. */
  function capability(name) {
    try {
      if (typeof claude === 'undefined' || !claude) return null;
      const c = claude;
      if (typeof c[name] === 'function') return c[name].bind(c);
      if (c.capabilities && typeof c.capabilities[name] === 'function') return c.capabilities[name].bind(c.capabilities);
      if (c.artifacts && typeof c.artifacts[name] === 'function') return c.artifacts[name].bind(c.artifacts);
      return null;
    } catch (e) { return null; }
  }
  function withTimeout(promise, ms) {
    return Promise.race([
      Promise.resolve(promise).catch(() => null),
      new Promise((res) => setTimeout(() => res(null), ms || CAP_TIMEOUT)),
    ]);
  }

  /** download(name, text) -> true when the file left the page one way or another. */
  S.download = async function (name, text) {
    const cap = capability('downloadFile') || capability('download');
    if (cap) {
      const r = await withTimeout(cap({ filename: name, content: text }));
      if (r !== null) return true;
    }
    try {
      if (typeof document !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
        return true;
      }
    } catch (e) { /* sandboxed: fall through */ }
    if (typeof S.onDownload === 'function') { try { S.onDownload(name, text); return true; } catch (e) { /* ignore */ } }
    return false;
  };

  // ---- moving a game between a phone and a laptop --------------------------------
  // There is no server, no account and nothing to install, so the bridge is a
  // file. One file, holding the whole project: download it on the laptop, send it
  // to yourself however you already send things, open it on the phone. Both ways.
  // The draft each device autosaves is its own; this is how you hand the work over.
  const FILE_KIND = 'kit-game';
  const FILE_VERSION = 1;

  /** fileName(project) -> 'mill-lane.kitgame.json' */
  S.fileName = function (project) {
    const id = (project && project.meta && project.meta.id) || 'game';
    return `${id}.kitgame.json`;
  };

  /**
   * toFile(project, extra) -> the text of one portable file.
   * It carries a stamp saying what it is and when it left, so the other end can
   * refuse a file that is not one of these rather than half-loading it.
   */
  S.toFile = function (project, extra) {
    return S.exportText(Object.assign({
      kind: FILE_KIND,
      version: FILE_VERSION,
      savedAt: new Date().toISOString(),
      title: (project && project.meta && project.meta.title) || '',
      project,
    }, extra || {}));
  };

  /**
   * fromFile(text) -> { ok, project, savedAt, title, reason }
   * Tolerant on purpose: a bare project (what an older export, or a hand-written
   * file, looks like) is accepted too. Anything else says why, in words.
   */
  S.fromFile = function (text) {
    let data;
    try { data = S.importText(text); }
    catch (e) { return { ok: false, reason: 'That is not a game file — it is not even JSON.' }; }
    if (!data || typeof data !== 'object') return { ok: false, reason: 'That file is empty.' };
    if (data.kind === FILE_KIND && data.project) {
      if (Number(data.version) > FILE_VERSION) {
        return { ok: false, reason: 'That file was saved by a newer version of the engine than this one.' };
      }
      return { ok: true, project: data.project, savedAt: data.savedAt || null, title: data.title || '' };
    }
    // a bare project: it has maps, or it says which version it is
    if (data.maps || data.version === 3) {
      return { ok: true, project: data, savedAt: null, title: (data.meta && data.meta.title) || '' };
    }
    return { ok: false, reason: 'That is a JSON file, but it is not a game: no maps in it.' };
  };

  /** saveToFile(project) -> bool — hand the whole game to the device as one file. */
  S.saveToFile = function (project) { return S.download(S.fileName(project), S.toFile(project)); };

  /**
   * copyToClipboard(text) -> bool. On a phone, downloading a file and finding it
   * again is a lot of taps; pasting into a message to yourself is two.
   */
  S.copyToClipboard = async function (text) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* not allowed here; fall through */ }
    try {
      if (typeof document === 'undefined') return false;
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (e) { return false; }
  };

  /** captureHtml() -> the page as it was before any script touched the DOM (main.js records it). */
  S.captureHtml = function () {
    if (KIT.PRISTINE_HTML) return KIT.PRISTINE_HTML;
    return null;
  };
  S.canPublish = function () { return !!(capability('publish') || capability('publishArtifact') || capability('updateArtifact')); };

  /**
   * publish(project) — rebuild the page from the pristine HTML with this project
   * embedded, and hand it to the artifact host. Never serialises the live DOM.
   */
  S.publish = async function (project) {
    const html = S.captureHtml();
    if (!html) return { ok: false, reason: 'no pristine html captured' };
    const json = KIT.stableStringify(project, 2);
    const block = `<script id="project-data" type="application/json">\n${json}\n</` + 'script>';
    let out;
    if (/<script id="project-data"[\s\S]*?<\/script>/i.test(html)) {
      out = html.replace(/<script id="project-data"[\s\S]*?<\/script>/i, block);
    } else if (/<\/body>/i.test(html)) {
      out = html.replace(/<\/body>/i, `${block}\n</body>`);
    } else {
      out = html + '\n' + block;
    }
    const cap = capability('publish') || capability('publishArtifact') || capability('updateArtifact');
    if (!cap) return { ok: false, html: out, reason: 'no publish capability here' };
    const r = await withTimeout(cap({ html: out, content: out }));
    return { ok: r !== null, result: r, html: out };
  };

  // ---- save slots ---------------------------------------------------------------
  const slotKey = (slot) => key('save.' + String(slot || 'autosave'));

  /** saveGame(slot, state) -> bool. The save is stamped with the time and where you were. */
  S.saveGame = async function (slot, state, extra) {
    if (!state) return false;
    const record = Object.assign({}, state, {
      version: state.version || 2,
      projectId,
      savedAt: new Date().toISOString(),
      slotLabel: (extra && extra.label) || state.slotLabel || null,
    });
    return await S.set(slotKey(slot), record);
  };
  S.loadGame = async function (slot) {
    const s = await S.get(slotKey(slot));
    if (!s) return null;
    if (s.projectId && s.projectId !== projectId) return null;      // a save from another world
    return s;
  };
  /** listGames() -> [{ slot, exists, savedAt, map, playtimeMs, label }] for autosave + 3 slots. */
  S.listGames = async function () {
    const out = [];
    for (const slot of SLOTS) {
      const s = await S.get(slotKey(slot));
      out.push({
        slot, exists: !!s,
        savedAt: s ? s.savedAt : null,
        map: s && s.heroes && s.heroes[0] ? s.heroes[0].map : null,
        playtimeMs: s ? (s.playtimeMs || 0) : 0,
        label: s ? s.slotLabel : null,
      });
    }
    return out;
  };
  S.deleteGame = (slot) => S.del(slotKey(slot));
  S.exportGame = async function (slot) { const s = await S.loadGame(slot); return s ? S.exportText(s) : null; };
  S.importGame = async function (text, slot) {
    const save = S.importText(text);
    if (!save || typeof save !== 'object') throw new Error('importGame: not a save');
    await S.saveGame(slot || '1', save);
    return save;
  };

  // ---- editor state -------------------------------------------------------------
  S.editorState = () => S.get(key('editorState'));
  S.saveEditorState = (v) => S.set(key('editorState'), v);

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
