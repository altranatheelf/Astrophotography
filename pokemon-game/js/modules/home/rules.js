// home/rules — the pure half of the Home module: what there is to DO once the
// catching is over. Decorating, jobs, moods and little gifts, all as plain
// functions over `save` and `project` so Node can test them without a page.
//
//   const now = KIT.home.now(save)                       // absolute in-game minute
//   const job = KIT.home.startJob(save, { template, who, now })
//   KIT.home.jobsReady(save, KIT.home.now(save))         // who is waiting at the gate
//   KIT.home.place(save, 'home', 'lamp', item, 0, 4, 5)  // writes save.overlays only
//
// Nothing in this file touches the DOM, the world, the renderer or the
// project's maps. The scenes, the system and the editor panel are the thin
// layer on top (register.js, scenes.js, panel.js).
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const H = KIT.home = KIT.home || {};

  const has = KIT.has;
  const num = KIT.num;
  const clamp = KIT.clamp;

  H.SAVE_VERSION = 1;
  H.DAY = 1440;

  // ---- the save section (§ "Save section home") -------------------------------
  /** defaults() -> a fresh `save.modules.home`. */
  H.defaults = function () {
    return { version: H.SAVE_VERSION, jobs: [], gifts: [], moods: {}, placed: 0, furniture: [], seenAt: null, log: [] };
  };

  /**
   * Save migrations, oldest first. Each `up(data)` takes the section at `from`
   * and returns it at `to`. Old saves keep loading; new keys get their default.
   */
  H.migrations = [
    // { from: 1, to: 2, up(data) { ...; return data; } },
  ];

  /**
   * repair(data) -> the section with its shape put right. The engine calls this
   * after filling and migrating, so an edited or truncated save cannot hand the
   * module a string where it expects a list.
   */
  H.repair = function (data) {
    if (!Array.isArray(data.jobs)) data.jobs = [];
    if (!Array.isArray(data.gifts)) data.gifts = [];
    if (!Array.isArray(data.furniture)) data.furniture = [];
    if (!Array.isArray(data.log)) data.log = [];
    if (!data.moods || typeof data.moods !== 'object') data.moods = {};
    data.placed = data.furniture.length;
    data.version = H.SAVE_VERSION;
    return data;
  };

  /**
   * ensure(save) -> the module's save section.
   *
   * The engine fills, migrates and repairs it when the world is made (see
   * `save` in manifest.js), so normally this just reads it. It still does the
   * whole job when handed a bare save — a headless test, a tool — because a
   * module has to work without a world around it.
   */
  H.ensure = function (save) {
    if (!save || typeof save !== 'object') return H.repair(H.defaults());
    if (KIT.modules && KIT.modules.get && KIT.modules.get('home')) {
      const section = KIT.modules.saveSection(save, 'home');
      if (section) return section;
    }
    save.modules = save.modules || {};
    let data = save.modules.home;
    if (!data || typeof data !== 'object') data = H.defaults();
    if (!Number.isFinite(data.version)) data.version = 1;
    for (const m of H.migrations) {
      if (data.version !== m.from) continue;
      try { data = m.up(data) || data; } catch (e) { (KIT.log || console).error('[home] migration ' + m.from + '→' + m.to, e); }
      data.version = m.to;
    }
    const d = H.defaults();
    for (const k of Object.keys(d)) if (!has(data, k)) data[k] = d[k];
    save.modules.home = H.repair(data);
    return save.modules.home;
  };

  // ---- content (project.packs.home) ------------------------------------------
  /** The numbers the author tunes. Every one of them lives in content, none in code. */
  H.TUNING = [
    // How fast the clock runs, and what a gap between sessions is worth, are the
    // GAME's settings, not this module's: Project › Clock. Jobs are timed against
    // whatever that clock says.

    { key: 'moodDriftMinutes', type: 'number', min: 10, default: 120, label: 'Minutes between mood drifts' },
    { key: 'suitedSpeed', type: 'number', min: 0.1, max: 2, default: 0.75, label: 'Speed when the job suits them', doc: 'A job that suits a friend takes this much of the time.' },
    { key: 'jobFriendship', type: 'number', min: 0, default: 8, label: 'Friendship for finishing a job' },
    // Petting and feeding are not ours. Whoever owns the friends owns those
    // numbers (the mons module keeps them in `packs.mons.petBonus` /
    // `berryBonus`), so there is one friendship number and one place it moves.
    { key: 'giftFriendship', type: 'number', min: 0, default: 60, label: 'Friendship before gifts start' },
    { key: 'giftChance', type: 'number', min: 0, max: 1, default: 0.15, label: 'Chance of a gift, per friend per day' },
    { key: 'maxGifts', type: 'number', min: 0, max: 20, default: 3, label: 'Most gifts waiting at once' },
  ];

  H.contentDefaults = function () {
    return { tuning: H.tuningDefaults(), giftItems: ['berry'], giftSpot: null, workers: 'auto' };
  };
  H.tuningDefaults = () => KIT.schema.defaults(H.TUNING);
  /**
   * pack(project) -> packs.home with every default filled in (never mutates the
   * project). normalize() has usually written this already; this still fills it
   * for a project that never went through normalize.
   */
  H.pack = function (project) {
    if (KIT.modules && KIT.modules.get && KIT.modules.get('home')) {
      const p = KIT.modules.pack(project, 'home');
      if (p) return p;
    }
    const raw = (project && project.packs && project.packs.home) || {};
    const out = Object.assign(H.contentDefaults(), raw);
    out.tuning = Object.assign(H.tuningDefaults(), raw.tuning || {});
    return out;
  };
  /** tuning(project) -> just the numbers. */
  H.tuning = function (project) { return H.pack(project).tuning; };

  // ---- the clock --------------------------------------------------------------
  /** now(save) -> the absolute in-game minute (day 1 at 00:00 is 0). Jobs are timed against this. */
  H.now = function (save) {
    const c = (save && save.clock) || {};
    const day = Math.max(1, num(c.day, 1));
    return (day - 1) * H.DAY + Math.max(0, num(c.minutes, 0));
  };
  /**
   * addMinutes(save, n) -> the new absolute minute.
   * The engine owns the clock (KIT.clock); this is the module's name for it, so
   * a caller reading about jobs does not have to change vocabulary.
   */
  H.addMinutes = function (save, n) {
    KIT.clock.add(save, Math.max(0, Math.round(num(n, 0))));
    return H.now(save);
  };
  /** clockText(save) -> 'Day 2 · 08:30'. */
  H.clockText = function (save) {
    const c = (save && save.clock) || {};
    const m = Math.max(0, num(c.minutes, 0)) % H.DAY;
    return `Day ${Math.max(1, num(c.day, 1))} · ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  /** durationText(minutes) -> '2h 30m'. */
  H.durationText = function (minutes) {
    const m = Math.max(0, Math.round(num(minutes, 0)));
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  };

  // The clock — running it, stamping it, measuring the gap between sessions — is
  // the engine's: `settings.clock`, `KIT.clock` and the `sessionResumed` event.
  // This module listens for that event and catches its jobs up; it does not keep
  // a second clock of its own, and neither should anything else.

  // ---- who can work -----------------------------------------------------------
  // The module is happy either way: with the mons module the workers are the
  // friends you caught, without it they are the heroes. A module that owns its
  // own creatures calls KIT.home.provideRoster() and takes over completely.
  H.rosterProvider = null;
  /** provideRoster(fn) — fn(project, save) -> [{ uid, name, kind, type, friendship, sprite }]. */
  H.provideRoster = function (fn) { H.rosterProvider = typeof fn === 'function' ? fn : null; };

  /**
   * The mons module's friends, if that module is here. Its own API is used when
   * it is loaded (names and species types come out right); the raw save shape is
   * the fallback, so a save made by a future version still reads.
   */
  function monRoster(project, save) {
    const section = save && save.modules && save.modules.mons;
    if (!section || typeof section !== 'object') return null;
    const M = KIT.mons;
    let list = null;
    if (M && typeof M.all === 'function') { try { list = M.all(section); } catch (e) { list = null; } }
    if (!Array.isArray(list)) {
      list = (Array.isArray(section.party) ? section.party : []).concat(Array.isArray(section.box) ? section.box : []);
    }
    const out = [];
    list.forEach((m, i) => {
      if (!m || typeof m !== 'object') return;
      const uid = String(m.uid || m.id || `mon-${i}`);
      if (out.some(w => w.uid === uid)) return;
      let types = Array.isArray(m.types) ? m.types : (m.type ? [m.type] : []);
      if (!types.length && M && typeof M.species === 'function') {
        const sp = M.species(m.id || m.species);
        if (sp && Array.isArray(sp.types)) types = sp.types;
      }
      let name = '';
      if (M && typeof M.displayName === 'function') { try { name = M.displayName(m, project); } catch (e) { name = ''; } }
      if (!name) name = String(m.nickname || m.name || m.species || m.id || uid);
      out.push({
        uid, kind: 'mon', name,
        type: String(types[0] || ''), types: types.map(String),
        friendship: num(m.friendship, 0), sprite: monSprite(M, m),
      });
    });
    return out.length ? out : null;
  }
  /**
   * The id of a *registered* sprite for this friend, so the screens that show a
   * face look it up in the `sprites` registry like any other picture — no second
   * copy of the portrait code lives here.
   */
  function monSprite(M, m) {
    if (M && typeof M.spriteFor === 'function') {
      try { const id = M.spriteFor(m); if (id) return id; } catch (e) { /* fall through */ }
    }
    return m.sprite || null;
  }

  function heroRoster(project, save) {
    const heroes = (project && project.heroes) || [];
    return heroes.map((h, i) => {
      const st = ((save && save.heroes) || [])[i] || {};
      return {
        uid: String(h.id || `p${i + 1}`), kind: 'hero',
        name: String(st.name || h.name || h.id || `Player ${i + 1}`),
        type: 'friend', types: ['friend'],
        friendship: num(((save && save.vars) || {}).friendship, 0),
        sprite: h.sprite || null,
      };
    });
  }
  /** roster(project, save) -> everyone who could take a job, mons module or not. */
  H.roster = function (project, save) {
    if (H.rosterProvider) {
      try {
        const list = H.rosterProvider(project, save);
        if (Array.isArray(list) && list.length) return list;
      } catch (e) { (KIT.log || console).error('[home] roster provider threw', e); }
    }
    return monRoster(project, save) || heroRoster(project, save);
  };
  /** worker(project, save, uid) -> one roster entry, or a stub so a deleted friend never crashes a job. */
  H.worker = function (project, save, uid) {
    const found = H.roster(project, save).find(w => w.uid === uid);
    return found || { uid: String(uid || ''), kind: 'gone', name: String(uid || 'Someone'), type: '', types: [], friendship: 0, sprite: null };
  };
  /**
   * awardFriendship(ctx, uid, amount) -> true when somebody took it.
   * Friendship is not this module's number. When a module that owns creatures is
   * loaded it registers a `friendship` command, and that command is the only
   * thing that writes it; with no such module there is nothing to write to and
   * this quietly does nothing. Nothing here knows what mons is.
   */
  H.awardFriendship = function (ctx, uid, amount) {
    const n = Math.round(num(amount, 0));
    if (!ctx || !uid || !n) return false;
    try {
      if (!KIT.registry.exists('commands') || !KIT.registry('commands').has('friendship')) return false;
      KIT.commands.exec(ctx, { t: 'friendship', who: 'uid', uid: String(uid), op: 'add', amount: n });
      return true;
    } catch (e) { (KIT.log || console).error('[home] friendship', e); return false; }
  };

  /**
   * Whoever owns the friends may own their mood too. `H.moodOf` stays the
   * answer: this is how another module asks for it (see register.js, which
   * offers it to the mons module's garden card).
   */
  H.moodFor = function (project, save, uid) {
    const rec = H.moodOf(save, uid);
    return { id: rec.mood, label: H.moodLabel(project, rec.mood) };
  };

  /** friendshipBand(n) -> 'new' | 'warm' | 'close'. The line you get back depends on it. */
  H.friendshipBand = function (n) {
    const v = num(n, 0);
    if (v >= 150) return 'close';
    if (v >= 50) return 'warm';
    return 'new';
  };

  // ---- jobs -------------------------------------------------------------------
  /** The fields one job on a board carries. The editor forms itself from this. */
  H.JOB_FIELDS = [
    { key: 'id', type: 'string', default: '', label: 'Id', doc: 'A short name for this job, so conditions can ask about it.' },
    { key: 'title', type: 'string', default: 'An errand', label: 'Title' },
    { key: 'desc', type: 'text', default: '', label: 'What it is' },
    { key: 'needs', type: 'string', default: '', label: 'The friend it needs', doc: 'Leave blank for anyone. Otherwise the id of one friend.' },
    { key: 'suits', type: 'string', default: '', label: 'The type it suits', doc: 'A type or tag; a friend who matches finishes sooner.' },
    { key: 'minutes', type: 'number', integer: true, min: 1, default: 60, label: 'How long, in in-game minutes' },
    { key: 'reward', type: 'ref:item', nullable: true, default: null, label: 'Reward' },
    { key: 'count', type: 'number', integer: true, min: 1, default: 1, label: 'How many' },
    { key: 'flag', type: 'ref:var', nullable: true, default: null, label: 'Switch to set when done' },
    { key: 'repeatable', type: 'bool', default: true, label: 'Can be taken again' },
  ];

  /** jobTemplate(raw) -> one board job with every field filled in. */
  H.jobTemplate = function (raw, i) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    const out = {};
    for (const f of H.JOB_FIELDS) out[f.key] = has(src, f.key) && src[f.key] !== undefined ? src[f.key] : f.default;
    if (!out.id) out.id = KIT.slug(String(out.title || `job-${(i || 0) + 1}`)) || `job-${(i || 0) + 1}`;
    out.minutes = Math.max(1, Math.round(num(out.minutes, 60)));
    out.count = Math.max(1, Math.round(num(out.count, 1)));
    return out;
  };
  /** templatesOf(page) -> the filled job list on a job-board page. */
  H.templatesOf = function (page) {
    const list = (page && page.props && Array.isArray(page.props.jobs)) ? page.props.jobs : [];
    return list.map(H.jobTemplate);
  };
  /** boardTemplates(project, boardId) -> every job template with that board id, anywhere in the world. */
  H.boardTemplates = function (project, boardId) {
    const out = [];
    for (const mapId of Object.keys((project && project.maps) || {})) {
      for (const obj of project.maps[mapId].objects || []) {
        if (obj.type !== 'job-board') continue;
        if (boardId && obj.id !== boardId) continue;
        for (const page of obj.pages || []) for (const t of H.templatesOf(page)) out.push(Object.assign({ board: obj.id, map: mapId }, t));
      }
    }
    return out;
  };

  /** suitability(template, worker) -> 'needed' | 'suits' | 'any' | 'wrong' (wrong = cannot be sent). */
  H.suitability = function (template, worker) {
    const t = template || {}, w = worker || {};
    const needs = String(t.needs || '').trim();
    if (needs) return needs === w.uid ? 'needed' : 'wrong';
    const suits = String(t.suits || '').trim().toLowerCase();
    if (!suits) return 'any';
    const types = (w.types && w.types.length ? w.types : [w.type]).map(s => String(s || '').toLowerCase());
    return types.includes(suits) ? 'suits' : 'any';
  };
  /** jobMinutes(template, worker, tuning) -> how long it really takes for this friend. */
  H.jobMinutes = function (template, worker, tuning) {
    const t = Object.assign(H.tuningDefaults(), tuning || {});
    const base = Math.max(1, Math.round(num(template && template.minutes, 60)));
    const fit = H.suitability(template, worker);
    if (fit === 'suits' || fit === 'needed') return Math.max(1, Math.round(base * clamp(num(t.suitedSpeed, 0.75), 0.1, 2)));
    return base;
  };

  /** isOut(save, uid) -> that friend is already away on a job. */
  H.isOut = function (save, uid) {
    const data = H.ensure(save);
    return data.jobs.some(j => !j.done && j.who === uid);
  };
  /** jobsOut(save) -> jobs nobody has collected yet. */
  H.jobsOut = function (save) { return H.ensure(save).jobs.filter(j => !j.done); };
  /** readyAt(job) -> the absolute minute it is finished. */
  H.readyAt = function (job) { return num(job && job.startedAt, 0) + Math.max(0, num(job && job.minutes, 0)); };
  /** isReady(job, now) -> the clock has passed. */
  H.isReady = function (job, now) { return !job.done && num(now, 0) >= H.readyAt(job); };
  /** remaining(job, now) -> in-game minutes left (0 when it is waiting for you). */
  H.remaining = function (job, now) { return Math.max(0, H.readyAt(job) - num(now, 0)); };
  /** jobsReady(save, now) -> the ones standing at the gate with something for you. */
  H.jobsReady = function (save, now) { return H.jobsOut(save).filter(j => H.isReady(j, now)); };
  /** jobDone(save, templateId) -> this board job has been finished at least once. */
  H.jobDone = function (save, templateId) {
    const data = H.ensure(save);
    return data.jobs.some(j => j.done && j.job === templateId) || data.log.some(l => l.job === templateId);
  };

  /**
   * startJob(save, { template, who, now, worker, tuning, board }) -> { ok, job, reason }
   * The friend leaves the garden. Nothing else changes until you collect them.
   */
  H.startJob = function (save, opts) {
    const o = opts || {};
    const data = H.ensure(save);
    const template = H.jobTemplate(o.template || {});
    const who = String(o.who || '');
    if (!who) return { ok: false, reason: 'nobody' };
    if (H.isOut(save, who)) return { ok: false, reason: 'busy' };
    const worker = o.worker || { uid: who, name: who, type: '', types: [], friendship: 0 };
    if (H.suitability(template, worker) === 'wrong') return { ok: false, reason: 'wrong' };
    const now = num(o.now, H.now(save));
    const job = {
      id: KIT.uid('job'),
      job: template.id, board: o.board || template.board || null,
      title: template.title, desc: template.desc || '',
      who, whoName: worker.name,
      startedAt: now, minutes: H.jobMinutes(template, worker, o.tuning),
      reward: template.reward || null, count: template.count || 1,
      flag: template.flag || null, done: false, collectedAt: null,
      fit: H.suitability(template, worker),
    };
    data.jobs.push(job);
    return { ok: true, job };
  };

  /**
   * collectJob(save, jobId, { now, worker, tuning }) -> { ok, job, reward, reason }
   * They come home: the reward lands in the bag, the flag goes up, and the
   * caller says the line (jobLine) that suits how well you know them.
   */
  H.collectJob = function (save, jobId, opts) {
    const o = opts || {};
    const data = H.ensure(save);
    const job = data.jobs.find(j => j.id === jobId);
    if (!job) return { ok: false, reason: 'unknown' };
    if (job.done) return { ok: false, reason: 'collected', job };
    const now = num(o.now, H.now(save));
    if (!H.isReady(job, now)) return { ok: false, reason: 'early', job, remaining: H.remaining(job, now) };
    job.done = true;
    job.collectedAt = now;
    let reward = null;
    if (job.reward) {
      save.inventory = save.inventory || {};
      const count = Math.max(1, Math.round(num(job.count, 1)));
      save.inventory[job.reward] = (num(save.inventory[job.reward], 0)) + count;
      reward = { item: job.reward, count };
    }
    if (job.flag) {
      save.vars = save.vars || {};
      save.vars[job.flag] = true;
    }
    data.log.push({ job: job.job, who: job.who, at: now });
    if (data.log.length > 200) data.log.splice(0, data.log.length - 200);
    data.jobs = data.jobs.filter(j => j !== job);
    H.setMood(save, job.who, 'happy', now);
    return { ok: true, job, reward, friendship: Math.max(0, num((o.tuning || {}).jobFriendship, H.tuningDefaults().jobFriendship)) };
  };

  /** jobLine(project, worker, job, reward) -> the line they say, warmer the better they know you. */
  H.jobLine = function (project, worker, job, reward) {
    const band = H.friendshipBand(worker && worker.friendship);
    const item = reward && reward.item ? itemName(project, reward.item) : '';
    const vars = { who: (worker && worker.name) || 'They', title: (job && job.title) || 'the job', item, count: (reward && reward.count) || 0 };
    const key = reward ? `home-job-back-${band}` : `home-job-back-empty`;
    return KIT.strings.get(project, key, vars);
  };
  function itemName(project, id) {
    const it = project && project.items && project.items[id];
    return (it && it.name) || String(id || '');
  }
  H.itemName = itemName;

  // ---- moods ------------------------------------------------------------------
  H.MOODS = [
    { id: 'happy', label: 'Happy', face: '♪' },
    { id: 'calm', label: 'Calm', face: '·' },
    { id: 'sleepy', label: 'Sleepy', face: 'z' },
    { id: 'restless', label: 'Restless', face: '!' },
    { id: 'lonely', label: 'Lonely', face: '…' },
  ];
  H.MOOD_IDS = H.MOODS.map(m => m.id);
  /** Where a mood can drift on its own, and how likely each way is. Gentle: staying put is the common case. */
  H.MOOD_DRIFT = {
    happy: [['happy', 5], ['calm', 3], ['sleepy', 1], ['restless', 1]],
    calm: [['calm', 5], ['happy', 2], ['sleepy', 2], ['lonely', 1]],
    sleepy: [['sleepy', 4], ['calm', 4], ['happy', 1], ['restless', 1]],
    restless: [['restless', 3], ['calm', 3], ['happy', 2], ['lonely', 1]],
    lonely: [['lonely', 4], ['calm', 3], ['restless', 2], ['happy', 1]],
  };
  /** What a friend makes of what you did. */
  H.MOOD_REACTION = {
    fed: { happy: 'happy', calm: 'happy', sleepy: 'happy', restless: 'calm', lonely: 'happy' },
    petted: { happy: 'happy', calm: 'happy', sleepy: 'calm', restless: 'calm', lonely: 'happy' },
    worked: { happy: 'happy', calm: 'calm', sleepy: 'sleepy', restless: 'calm', lonely: 'calm' },
    ignored: { happy: 'calm', calm: 'lonely', sleepy: 'restless', restless: 'lonely', lonely: 'lonely' },
  };

  /** moodOf(save, uid) -> { mood, changedAt }, defaulting to calm. */
  H.moodOf = function (save, uid) {
    const data = H.ensure(save);
    const m = data.moods[uid];
    if (m && typeof m === 'object' && H.MOOD_IDS.includes(m.mood)) return m;
    return { mood: 'calm', changedAt: 0 };
  };
  /**
   * setMood(save, uid, mood, now) -> the record.
   * `changedAt` is also when we last settled this friend's mood, so setting one
   * by hand (a treat, a job well done) restarts their drift from that minute.
   */
  H.setMood = function (save, uid, mood, now) {
    const data = H.ensure(save);
    const id = H.MOOD_IDS.includes(mood) ? mood : 'calm';
    data.moods[uid] = { mood: id, changedAt: num(now, H.now(save)) };
    return data.moods[uid];
  };
  /** react(save, uid, event, now) -> the new mood after `fed`/`petted`/`worked`/`ignored`. */
  H.react = function (save, uid, event, now) {
    const table = H.MOOD_REACTION[event];
    const current = H.moodOf(save, uid).mood;
    if (!table) return current;
    return H.setMood(save, uid, table[current] || current, now).mood;
  };

  /**
   * nextMood(mood, uid, bucket, seed) -> the mood after one drift.
   * Pure and seeded: the same save, replayed, drifts exactly the same way.
   */
  H.nextMood = function (mood, uid, bucket, seed) {
    const from = H.MOOD_IDS.includes(mood) ? mood : 'calm';
    const table = H.MOOD_DRIFT[from];
    const rng = KIT.rng(KIT.hash('home-mood', String(seed == null ? 0 : seed), String(uid), String(bucket)));
    const total = table.reduce((n, row) => n + row[1], 0);
    let pick = rng() * total;
    for (const [to, weight] of table) { pick -= weight; if (pick <= 0) return to; }
    return from;
  };

  /**
   * driftMoods(save, project, now) -> [{ uid, from, to }]
   * Everybody still at home nudges along one step per `moodDriftMinutes`. A
   * long gap catches up at most a day's worth, so coming back is not a storm.
   */
  H.driftMoods = function (save, project, now) {
    const data = H.ensure(save);
    const t = H.tuning(project);
    const seed = num(save && save.seed, 0);
    const per = Math.max(10, num(t.moodDriftMinutes, 120));
    const minute = num(now, H.now(save));
    const bucket = Math.floor(minute / per);
    const out = [];
    for (const w of H.roster(project, save)) {
      if (H.isOut(save, w.uid)) continue;
      const rec = data.moods[w.uid];
      if (!rec) { data.moods[w.uid] = { mood: 'calm', changedAt: minute }; continue; }
      const from = Math.floor(num(rec.changedAt, 0) / per);
      if (bucket <= from) continue;
      const steps = Math.min(12, bucket - from);
      let mood = rec.mood;
      for (let i = 1; i <= steps; i++) mood = H.nextMood(mood, w.uid, from + i, seed);
      if (mood !== rec.mood) out.push({ uid: w.uid, from: rec.mood, to: mood, name: w.name });
      data.moods[w.uid] = { mood, changedAt: minute };
    }
    return out;
  };

  // ---- gifts ------------------------------------------------------------------
  /** giftSpot(project) -> where a gift is left: the content setting, else the start tile. */
  H.giftSpot = function (project) {
    const spot = H.pack(project).giftSpot;
    if (spot && spot.map) return { map: spot.map, x: num(spot.x, 0), y: num(spot.y, 0) };
    const start = (project && project.start) || {};
    if (!start.map) return null;
    return { map: start.map, x: num(start.x, 0), y: num(start.y, 0) };
  };

  /**
   * rollGifts(save, project, now) -> [gift]
   * Once a day at most, and only from a friend who likes you and is in a good
   * mood. Seeded by the save, the day and the friend, so it never re-rolls.
   */
  H.rollGifts = function (save, project, now) {
    const data = H.ensure(save);
    const pack = H.pack(project);
    const t = pack.tuning;
    const spot = H.giftSpot(project);
    if (!spot) return [];
    const items = (Array.isArray(pack.giftItems) ? pack.giftItems : []).filter(id => !project || !project.items || project.items[id]);
    if (!items.length) return [];
    const minute = num(now, H.now(save));
    const day = Math.floor(minute / H.DAY);
    const seed = num(save && save.seed, 0);
    const waiting = data.gifts.filter(g => !g.taken).length;
    const out = [];
    for (const w of H.roster(project, save)) {
      if (waiting + out.length >= Math.max(0, num(t.maxGifts, 3))) break;
      if (H.isOut(save, w.uid)) continue;
      if (num(w.friendship, 0) < num(t.giftFriendship, 60)) continue;
      const mood = H.moodOf(save, w.uid).mood;
      if (mood !== 'happy' && mood !== 'calm') continue;
      if (data.gifts.some(g => g.from === w.uid && g.day === day)) continue;
      const rng = KIT.rng(KIT.hash('home-gift', String(seed), String(w.uid), String(day)));
      if (!rng.chance(clamp(num(t.giftChance, 0.15), 0, 1))) {
        data.gifts.push({ id: KIT.uid('gift'), from: w.uid, day, item: null, count: 0, map: null, x: 0, y: 0, note: '', taken: true, skipped: true });
        continue;
      }
      const item = rng.pick(items);
      const gift = {
        id: KIT.uid('gift'), from: w.uid, fromName: w.name, day,
        item, count: 1, map: spot.map, x: spot.x, y: spot.y,
        note: KIT.strings.get(project, 'home-gift-note', { who: w.name, item: itemName(project, item) }),
        taken: false,
      };
      data.gifts.push(gift);
      out.push(gift);
    }
    if (data.gifts.length > 60) data.gifts.splice(0, data.gifts.length - 60);
    return out;
  };

  /**
   * giftObject(project, gift) -> a map object for save.overlays[map].objects.
   * It is an ordinary `item` object, so the engine's own pickup gives it to you
   * and the step script reads out the note.
   */
  H.giftObject = function (project, gift) {
    const raw = {
      id: 'home-gift-' + gift.id, name: 'A present', type: 'item', x: gift.x, y: gift.y, note: '',
      // `once` stays off: the engine's own item pickup already marks the object
      // done and hides it, and `once` would swallow the note with it.
      pages: [{
        layer: 'below', through: true, visible: true, once: false,
        props: { item: gift.item, count: gift.count || 1, look: null },
        on: { step: [{ t: 'say', text: gift.note || '' }] },
      }],
    };
    return KIT.project.fillObject ? KIT.project.fillObject(raw, 0) : raw;
  };
  /** placeGift(save, project, gift) -> true when the present is now lying at the door. */
  H.placeGift = function (save, project, gift) {
    if (!gift || !gift.map || !gift.item) return false;
    save.overlays = save.overlays || {};
    const ov = save.overlays[gift.map] = save.overlays[gift.map] || { tiles: {}, objects: [] };
    ov.objects = Array.isArray(ov.objects) ? ov.objects : [];
    const id = 'home-gift-' + gift.id;
    if (ov.objects.some(o => o.id === id)) return false;
    if (ov.objects.some(o => o.x === gift.x && o.y === gift.y)) return false;   // one present per doormat
    ov.objects.push(H.giftObject(project, gift));
    return true;
  };
  /** giftsWaiting(save) -> presents the player has not picked up yet. */
  H.giftsWaiting = function (save) { return H.ensure(save).gifts.filter(g => !g.taken && !g.skipped); };
  /** takeGift(save, id) — the player picked it up; the overlay object goes with it. */
  H.takeGift = function (save, id) {
    const data = H.ensure(save);
    const gift = data.gifts.find(g => g.id === id);
    if (!gift) return false;
    gift.taken = true;
    const ov = save.overlays && save.overlays[gift.map];
    if (ov && Array.isArray(ov.objects)) {
      const key = 'home-gift-' + gift.id;
      ov.objects = ov.objects.filter(o => o.id !== key);
    }
    return true;
  };

  // ---- furniture ---------------------------------------------------------------
  /** The props an item of kind `furniture` carries. */
  H.FURNITURE_FIELDS = [
    { key: 'variants', type: 'list', label: 'Looks', doc: 'One entry per way it can sit. The placement screen rotates through them.',
      of: { type: 'group', fields: [
        { key: 'label', type: 'string', default: '', label: 'Name' },
        { key: 'tile', type: 'tile', nullable: false, default: 'plant', label: 'Tile' },
        { key: 'tile2', type: 'tile', nullable: true, default: null, label: 'Second tile', doc: 'For something two squares big (a bed, a sofa).' },
        { key: 'dir', type: 'enum', options: ['down', 'right'], default: 'down', label: 'Where the second tile goes' },
      ] },
      default: [] },
    { key: 'layer', type: 'enum', options: ['ground', 'deco', 'above'], default: 'deco', label: 'Layer it is painted on' },
    { key: 'solid', type: 'bool', default: true, label: 'You cannot walk through it' },
  ];

  /** isFurniture(project, itemId) -> true when the bag entry is something you can put down. */
  H.isFurniture = function (project, itemId) {
    const it = project && project.items && project.items[itemId];
    return !!(it && it.kind === 'furniture');
  };
  /** furnitureItems(project) -> [{ id, item }] — the catalogue the editor panel shows. */
  H.furnitureItems = function (project) {
    const items = (project && project.items) || {};
    return Object.keys(items).filter(id => items[id].kind === 'furniture').map(id => ({ id, item: items[id] }));
  };
  /** variants(item) -> always at least one look, even for an item with none authored. */
  H.variants = function (item) {
    const list = (item && item.props && Array.isArray(item.props.variants)) ? item.props.variants : [];
    const out = list.filter(v => v && v.tile).map((v, i) => ({
      label: v.label || `Look ${i + 1}`, tile: v.tile, tile2: v.tile2 || null, dir: v.dir === 'right' ? 'right' : 'down',
    }));
    if (out.length) return out;
    return [{ label: 'Plain', tile: (item && item.props && item.props.tile) || 'plant', tile2: null, dir: 'down' }];
  };
  /** cellsFor(item, variantIndex, x, y) -> the squares this piece covers and what goes on each. */
  H.cellsFor = function (item, variantIndex, x, y) {
    const vs = H.variants(item);
    const v = vs[((variantIndex % vs.length) + vs.length) % vs.length];
    const layer = (item && item.props && item.props.layer) || 'deco';
    const cells = [{ x, y, layer, tile: v.tile }];
    if (v.tile2) cells.push({ x: x + (v.dir === 'right' ? 1 : 0), y: y + (v.dir === 'right' ? 0 : 1), layer, tile: v.tile2 });
    return cells;
  };

  /** placedAt(save, mapId, x, y) -> the piece standing on that square, or null. */
  H.placedAt = function (save, mapId, x, y) {
    const data = H.ensure(save);
    return data.furniture.find(f => f.map === mapId && f.cells.some(c => c.x === x && c.y === y)) || null;
  };
  /** placedOn(save, mapId) -> every piece the player has put down on one map. */
  H.placedOn = function (save, mapId) { return H.ensure(save).furniture.filter(f => f.map === mapId); };
  /** hasFurniture(save, itemId, mapId) -> how many of that piece are out. */
  H.countFurniture = function (save, itemId, mapId) {
    return H.ensure(save).furniture.filter(f => (!itemId || f.item === itemId) && (!mapId || f.map === mapId)).length;
  };

  /**
   * canPlace(project, save, mapId, item, variantIndex, x, y) -> { ok, reason }
   * Reasons: `map` `bounds` `occupied` `wall` — all of them something the
   * placement screen can say out loud.
   */
  H.canPlace = function (project, save, mapId, item, variantIndex, x, y) {
    const map = project && project.maps && project.maps[mapId];
    if (!map) return { ok: false, reason: 'map' };
    const cells = H.cellsFor(item, variantIndex, x, y);
    for (const c of cells) {
      if (c.x < 0 || c.y < 0 || c.x >= map.width || c.y >= map.height) return { ok: false, reason: 'bounds' };
      if (H.placedAt(save, mapId, c.x, c.y)) return { ok: false, reason: 'occupied' };
      if (KIT.project.cellSolid && KIT.project.cellSolid(map, c.x, c.y)) return { ok: false, reason: 'wall' };
      if ((map.objects || []).some(o => o.x === c.x && o.y === c.y)) return { ok: false, reason: 'occupied' };
    }
    return { ok: true, reason: 'ok' };
  };

  /**
   * place(save, mapId, itemId, item, variantIndex, x, y) -> record
   * Writes save.overlays[mapId].tiles only: the author's map is never touched,
   * and what was underneath is remembered so picking it up puts it all back.
   */
  H.place = function (save, mapId, itemId, item, variantIndex, x, y) {
    const data = H.ensure(save);
    const solid = !!(item && item.props && item.props.solid);
    save.overlays = save.overlays || {};
    const ov = save.overlays[mapId] = save.overlays[mapId] || { tiles: {}, objects: [] };
    ov.tiles = ov.tiles || {};
    const vs = H.variants(item);
    const variant = ((num(variantIndex, 0) % vs.length) + vs.length) % vs.length;
    const rec = { id: KIT.uid('furn'), map: mapId, item: itemId, variant, x, y, solid, cells: [] };
    for (const c of H.cellsFor(item, variant, x, y)) {
      const key = `${c.x},${c.y}`;
      const cell = ov.tiles[key] = ov.tiles[key] || {};
      const prev = {};
      if (has(cell, c.layer)) prev[c.layer] = cell[c.layer];
      if (has(cell, 'collision')) prev.collision = cell.collision;
      cell[c.layer] = c.tile;
      if (solid) cell.collision = 1;
      rec.cells.push({ x: c.x, y: c.y, layer: c.layer, tile: c.tile, prev });
    }
    data.furniture.push(rec);
    data.placed = data.furniture.length;
    return rec;
  };

  /**
   * pickUp(save, record) -> the item id to hand back to the bag.
   * The overlay goes back exactly as it was; an overlay left with nothing in it
   * is deleted, so a room stripped bare compares equal to a room never touched.
   */
  H.pickUp = function (save, record) {
    const data = H.ensure(save);
    const rec = typeof record === 'string' ? data.furniture.find(f => f.id === record) : record;
    if (!rec) return null;
    const ov = save.overlays && save.overlays[rec.map];
    if (ov && ov.tiles) {
      for (const c of rec.cells) {
        const key = `${c.x},${c.y}`;
        const cell = ov.tiles[key];
        if (!cell) continue;
        const prev = c.prev || {};
        if (has(prev, c.layer)) cell[c.layer] = prev[c.layer]; else delete cell[c.layer];
        if (has(prev, 'collision')) cell.collision = prev.collision; else delete cell.collision;
        if (!Object.keys(cell).length) delete ov.tiles[key];
      }
      if (!Object.keys(ov.tiles).length && !(ov.objects || []).length) delete save.overlays[rec.map];
    }
    data.furniture = data.furniture.filter(f => f !== rec);
    data.placed = data.furniture.length;
    return rec.item;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
