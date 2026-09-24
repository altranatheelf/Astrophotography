// home/register — everything the Home module puts into the kit's registries:
// the strings, the `furniture` item kind, the `job-board` object type, four
// commands, four conditions, the per-tick system and the pause-menu entries.
//
// register.js holds no rules of its own: it is the wiring between rules.js and
// the engine. manifest.js calls KIT.home.registerAll(KIT) when the project
// lists this module.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const H = KIT.home = KIT.home || {};

  const num = KIT.num;

  // ---- strings: every line the module can say ---------------------------------
  H.STRINGS = [
    { id: 'home-menu-jobs', default: 'Jobs' },
    { id: 'home-menu-decorate', default: 'Decorate' },
    { id: 'home-board-title', default: 'Job board' },
    { id: 'home-board-empty', default: 'The board is bare today.' },
    { id: 'home-board-hint', default: 'Pick a job, then pick who goes.' },
    { id: 'home-who-title', default: 'Who should go?' },
    { id: 'home-who-empty', default: 'Nobody is free to go just now.' },
    { id: 'home-who-busy', default: '{who} is already out.' },
    { id: 'home-who-wrong', default: 'This one is meant for someone else.' },
    { id: 'home-sent', default: '{who} sets off. Back in about {time}.' },
    { id: 'home-jobs-title', default: 'Jobs' },
    { id: 'home-jobs-none', default: 'Nobody is out on a job. Find a job board.' },
    { id: 'home-jobs-out', default: 'Out' },
    { id: 'home-jobs-ready', default: 'Home and waiting' },
    { id: 'home-jobs-garden', default: 'At home' },
    { id: 'home-jobs-left', default: '{time} left' },
    { id: 'home-jobs-waiting', default: 'waiting for you' },
    { id: 'home-collect-all', default: 'Welcome everyone home' },
    { id: 'home-job-back-new', default: '{who} is back. {pause} “Here. I found {count} {item}.”' },
    { id: 'home-job-back-warm', default: '{who} comes running back. {pause} “{title} went well! Look — {count} {item} for you.”' },
    { id: 'home-job-back-close', default: '{who} is home before you even called. {pause} “I kept thinking about you the whole way. {count} {item} — all yours.”' },
    { id: 'home-job-back-empty', default: '{who} is home from {title}, tired and pleased with themselves.' },
    { id: 'home-gift-note', default: '“Left at the door, with no note but a very pleased {who}.” {pause} It is a {item}.' },
    { id: 'home-gift-toast', default: '{who} left something at the door.' },
    { id: 'home-mood-happy', default: '{who} is bouncing about.' },
    { id: 'home-mood-calm', default: '{who} is dozing in the sun.' },
    { id: 'home-mood-sleepy', default: '{who} is half asleep.' },
    { id: 'home-mood-restless', default: '{who} keeps pacing the fence.' },
    { id: 'home-mood-lonely', default: '{who} looks up every time the door goes.' },
    // The one-word version, for a list. Registered like everything else, so the
    // Terms panel can reword a mood without touching the sentence above it.
    { id: 'home-mood-name-happy', default: 'Happy' },
    { id: 'home-mood-name-calm', default: 'Calm' },
    { id: 'home-mood-name-sleepy', default: 'Sleepy' },
    { id: 'home-mood-name-restless', default: 'Restless' },
    { id: 'home-mood-name-lonely', default: 'Lonely' },
    { id: 'home-place-title', default: 'Where shall it go?' },
    { id: 'home-place-empty', default: 'Nothing in the bag to put down yet.' },
    { id: 'home-place-hint', default: 'Move it with the pad · Z puts it down · X stops' },
    { id: 'home-place-rotate', default: 'Turn' },
    { id: 'home-place-put', default: 'Put down' },
    { id: 'home-place-take', default: 'Pick up' },
    { id: 'home-place-done', default: 'Done' },
    { id: 'home-placed', default: 'Put the {item} down.' },
    { id: 'home-picked-up', default: 'Picked the {item} back up.' },
    { id: 'home-no-room', default: 'It will not fit there.' },
    { id: 'home-in-the-way', default: 'Something is already there.' },
    { id: 'home-against-wall', default: 'Not into the wall.' },
    { id: 'home-away-summary', default: 'While you were away: {minutes} minutes passed at home.' },
    { id: 'home-ready-toast', default: '{count} back from a job.' },
  ];

  // ---- mood helpers used by the scenes ----------------------------------------
  /** moodLine(project, worker, mood) -> the one-line picture of a friend at home. */
  H.moodLine = function (project, worker, mood) {
    const id = H.MOOD_IDS.includes(mood) ? mood : 'calm';
    return KIT.strings.get(project, 'home-mood-' + id, { who: (worker && worker.name) || 'They' });
  };
  /** moodLabel(project, mood) -> the one word, from the Terms table. */
  H.moodLabel = function (project, mood) {
    const id = H.MOOD_IDS.includes(mood) ? mood : 'calm';
    return KIT.strings.get(project, 'home-mood-name-' + id);
  };

  // ---- one place that knows how to run the module against a live world ---------
  /**
   * apply(world) -> a small helper bundle the scenes and the system share:
   * the project, the save, `now`, and the emitters that keep the rest of the
   * engine in step when we change the bag or the map underfoot.
   */
  H.live = function (world) {
    const project = world.project, save = world.save;
    return {
      project, save, world,
      data: H.ensure(save),
      tuning: H.tuning(project),
      now() { return H.now(save); },
      /** The bag changed behind the commands' back: say so, so menus refresh. */
      itemChanged(id, delta) {
        const count = num((save.inventory || {})[id], 0);
        if (world.events) world.events.emit('itemChanged', { id, delta, count });
      },
      /** A square of the map changed: drop the renderer's cached tiles for it. */
      repaint(mapId, x, y) {
        const r = KIT.game && KIT.game.renderer;
        if (!r) return;
        if (x == null) r.invalidate(mapId);
        else r.invalidate(mapId, x, y);
      },
      /**
       * The overlay grew an object (a present). The map view reads the overlay
       * live, so it needs no rebuilding — but the entities were built from it, so
       * they do.
       */
      rebuild() {
        if (world.rebuildEntities) world.rebuildEntities();
      },
    };
  };

  // ---- the registrations --------------------------------------------------------
  let registered = false;

  H.registerAll = function (kit) {
    if (registered) return;
    registered = true;
    const strings = KIT.registry('strings');
    for (const s of H.STRINGS) if (!strings.has(s.id)) strings.add(s);

    // The screens and the Creator Mode panel only exist in a browser; a module
    // that is loaded but not enabled registers nothing at all.
    if (typeof H.registerScenes === 'function') H.registerScenes();
    if (typeof H.registerPanel === 'function') H.registerPanel();

    // --- item kinds ---------------------------------------------------------------
    KIT.registry('itemKinds').add({
      id: 'furniture', label: 'Furniture', doc: 'Something you can carry home and put down. Using it opens the placement screen.',
      fields: H.FURNITURE_FIELDS,
      async use(ctx, item) {
        if (!KIT.scenes || !KIT.game || !KIT.game.world) return false;
        await KIT.scenes.run('home-place', { game: KIT.game, item: item && item.id });
        return true;
      },
    });

    // --- object type: job board ---------------------------------------------------
    KIT.registry('objectTypes').add({
      id: 'job-board', name: 'Job board', doc: 'A board of errands your friends can run. Fill in the list; the game does the rest.',
      tags: ['furniture'], icon: 'sign',
      fields: [
        { key: 'look', type: 'tile', nullable: true, default: 'sign', doc: 'The tile drawn where the board stands' },
        { key: 'title', type: 'string', default: 'Job board', doc: 'The heading on the screen' },
        { key: 'jobs', type: 'list', label: 'Jobs on this board', of: { type: 'group', fields: H.JOB_FIELDS }, default: [] },
      ],
      // A board placed in Creator Mode works with no scripting at all: the type's
      // default page already carries the one command that opens it.
      page: { layer: 'same', on: { interact: [{ t: 'openJobBoard' }] } },
      look: { tile: 'look' },
    });

    // --- commands ------------------------------------------------------------------
    const cmds = KIT.registry('commands');

    cmds.add({
      id: 'placeFurniture', label: 'Put Down Furniture', mv: 'Change Map Tile', group: 'Home', icon: 'tile',
      blocking: false, background: true,
      doc: 'Puts a piece of furniture on a map without asking the player. The author\'s map is not changed — it goes in the save overlay, like anything the player puts down.',
      fields: [
        { key: 'item', type: 'ref:item', nullable: false, doc: 'A bag item of kind “furniture”' },
        { key: 'map', type: 'ref:map', nullable: true, default: null, doc: 'Blank = the map you are on' },
        { key: 'x', type: 'number', integer: true, min: 0, default: 0 },
        { key: 'y', type: 'number', integer: true, min: 0, default: 0 },
        { key: 'variant', type: 'number', integer: true, min: 0, default: 0, doc: 'Which look, counting from 0' },
        { key: 'fromBag', type: 'bool', default: false, doc: 'Take one out of the bag as well' },
      ],
      run(ctx, cmd) {
        const save = ctx.save || (ctx.world && ctx.world.save);
        const project = ctx.project;
        if (!save || !project) return;
        const mapId = cmd.map || (ctx.world && ctx.world.map && ctx.world.map.id);
        const item = project.items && project.items[cmd.item];
        if (!mapId || !item) return;
        const can = H.canPlace(project, save, mapId, item, cmd.variant || 0, cmd.x || 0, cmd.y || 0);
        if (!can.ok) return;
        H.place(save, mapId, cmd.item, item, cmd.variant || 0, cmd.x || 0, cmd.y || 0);
        if (cmd.fromBag) KIT.commands.state.give(ctx, cmd.item, -1);
        const r = KIT.game && KIT.game.renderer;
        if (r) r.invalidate(mapId);
      },
      summary(cmd, ctx) { return `Put ${H.itemName(ctx && ctx.project, cmd.item)} at ${cmd.x || 0}, ${cmd.y || 0}`; },
    });

    cmds.add({
      id: 'giveJob', label: 'Send On A Job', group: 'Home', icon: 'flag', blocking: false, background: true,
      doc: 'Sends one friend off on a job from a board, without opening the board screen.',
      fields: [
        { key: 'board', type: 'string', default: '', doc: 'The id of the job-board object (blank = any board)' },
        { key: 'job', type: 'string', default: '', doc: 'The id of the job on that board' },
        { key: 'who', type: 'string', default: '', doc: 'The friend\'s id (blank = the first one free)' },
      ],
      run(ctx, cmd) {
        const save = ctx.save || (ctx.world && ctx.world.save);
        const project = ctx.project;
        if (!save || !project) return;
        const all = H.boardTemplates(project, cmd.board || null);
        const template = cmd.job ? all.find(t => t.id === cmd.job) : all[0];
        if (!template) return;
        const roster = H.roster(project, save);
        const worker = cmd.who ? roster.find(w => w.uid === cmd.who)
          : roster.find(w => !H.isOut(save, w.uid) && H.suitability(template, w) !== 'wrong');
        if (!worker) return;
        H.startJob(save, { template, who: worker.uid, worker, now: H.now(save), tuning: H.tuning(project), board: template.board });
      },
      summary(cmd) { return `Send ${cmd.who || 'someone'} on “${cmd.job || 'a job'}”`; },
    });

    cmds.add({
      id: 'collectJob', label: 'Welcome Home', group: 'Home', icon: 'bag', blocking: true, background: false,
      doc: 'Collects finished jobs: the reward goes in the bag and your friend says how it went.',
      fields: [
        { key: 'job', type: 'string', default: '', doc: 'The id of one job (blank = everything that is ready)' },
        { key: 'silent', type: 'bool', default: false, doc: 'Skip the lines and just take the rewards' },
      ],
      async run(ctx, cmd) {
        const save = ctx.save || (ctx.world && ctx.world.save);
        const project = ctx.project;
        if (!save || !project) return;
        const now = H.now(save);
        const ready = H.jobsReady(save, now).filter(j => !cmd.job || j.job === cmd.job || j.id === cmd.job);
        for (const job of ready) {
          const worker = H.worker(project, save, job.who);
          const out = H.collectJob(save, job.id, { now, worker, tuning: H.tuning(project) });
          if (!out.ok) continue;
          if (out.reward && ctx.emit) ctx.emit('itemChanged', { id: out.reward.item, delta: out.reward.count, count: (save.inventory || {})[out.reward.item] || 0 });
          if (!cmd.silent && ctx.io && ctx.io.say) await ctx.io.say({ text: H.jobLine(project, worker, out.job, out.reward) });
        }
      },
      summary(cmd) { return cmd.job ? `Welcome home: ${cmd.job}` : 'Welcome home everyone who is ready'; },
    });

    cmds.add({
      id: 'openJobBoard', label: 'Open The Job Board', group: 'Home', icon: 'sign', blocking: true, background: false,
      doc: 'Shows the board you are standing at. Every job-board object starts with this on its page, so an author never has to write it.',
      fields: [{ key: 'board', type: 'string', default: '', doc: 'The id of a board (blank = the one you are touching)' }],
      async run(ctx, cmd) {
        if (!KIT.scenes || !KIT.scenes.run) return;
        const world = ctx.world;
        const entity = (ctx.entity) || (world && world.activeEntity) || null;
        let object = entity && entity.object ? entity.object : null;
        let page = entity && entity.page ? entity.page : null;
        if (cmd.board && (!object || object.id !== cmd.board)) {
          for (const mapId of Object.keys((ctx.project && ctx.project.maps) || {})) {
            const found = (ctx.project.maps[mapId].objects || []).find(o => o.id === cmd.board);
            if (found) { object = found; page = found.pages && found.pages[found.pages.length - 1]; break; }
          }
        }
        await KIT.scenes.run('home-board', { game: KIT.game, object, page });
      },
      summary(cmd) { return cmd.board ? `Open the board “${cmd.board}”` : 'Open this job board'; },
    });

    cmds.add({
      id: 'moodSet', label: 'Set A Mood', group: 'Home', icon: 'balloon', blocking: false, background: true,
      doc: 'Puts one friend in a mood, or plays out something you did to them.',
      fields: [
        { key: 'who', type: 'string', default: '', nullable: false, doc: 'The friend\'s id' },
        { key: 'mood', type: 'enum', options: ['happy', 'calm', 'sleepy', 'restless', 'lonely', 'fed', 'petted', 'worked', 'ignored'], default: 'happy',
          doc: 'A mood, or something you did (fed, petted, worked, ignored) and they decide how they feel.' },
      ],
      run(ctx, cmd) {
        const save = ctx.save || (ctx.world && ctx.world.save);
        if (!save || !cmd.who) return;
        const now = H.now(save);
        if (H.MOOD_REACTION[cmd.mood]) H.react(save, cmd.who, cmd.mood, now);
        else H.setMood(save, cmd.who, cmd.mood, now);
      },
      summary(cmd) { return `${cmd.who || 'Someone'}: ${cmd.mood || 'happy'}`; },
    });

    // --- conditions ------------------------------------------------------------------
    const conds = KIT.registry('conditions');
    const saveOf = (ctx) => (ctx && ctx.world && ctx.world.save) || (ctx && ctx.save) || {};

    conds.add({
      id: 'jobDone', label: 'Job finished', group: 'Home', doc: 'This job from a board has been finished at least once.',
      fields: [{ key: 'job', type: 'string', default: '', doc: 'The id of the job on the board' }],
      test(c, ctx) { return H.jobDone(saveOf(ctx), c.job); },
      describe(c) { return `“${c.job || 'a job'}” is done`; },
    });

    conds.add({
      id: 'jobsReady', label: 'Friends waiting', group: 'Home', doc: 'How many friends are home from a job with something for you.',
      fields: [
        { key: 'op', type: 'enum', options: ['>=', '>', '==', '<=', '<', '!='], default: '>=' },
        { key: 'count', type: 'number', integer: true, min: 0, default: 1 },
      ],
      test(c, ctx) {
        const save = saveOf(ctx);
        return KIT.conditions.compare(H.jobsReady(save, H.now(save)).length, c.op || '>=', num(c.count, 1));
      },
      describe(c) { return `friends waiting ${c.op || '>='} ${num(c.count, 1)}`; },
    });

    conds.add({
      id: 'hasFurniture', label: 'Furniture is out', group: 'Home', doc: 'The player has put this piece down somewhere.',
      fields: [
        { key: 'item', type: 'ref:item', nullable: true, default: null, doc: 'Blank = any furniture at all' },
        { key: 'map', type: 'ref:map', nullable: true, default: null, doc: 'Blank = any map' },
        { key: 'count', type: 'number', integer: true, min: 1, default: 1 },
      ],
      test(c, ctx) { return H.countFurniture(saveOf(ctx), c.item || null, c.map || null) >= num(c.count, 1); },
      describe(c, ctx) { return `${H.itemName(ctx && ctx.project, c.item) || 'furniture'} is out`; },
    });

    conds.add({
      id: 'mood', label: 'A friend’s mood', group: 'Home', doc: 'How one friend is feeling.',
      fields: [
        { key: 'who', type: 'string', default: '', doc: 'The friend\'s id' },
        { key: 'mood', type: 'enum', options: H.MOOD_IDS.slice(), default: 'happy' },
      ],
      test(c, ctx) { return H.moodOf(saveOf(ctx), c.who).mood === (c.mood || 'happy'); },
      describe(c) { return `${c.who || 'they'} feel ${c.mood || 'happy'}`; },
    });

    // --- the system --------------------------------------------------------------------
    // Order 60: after the kit clock (50), so the minute it just added is the one
    // we time jobs against. The clock itself is not ours — we only read it.
    KIT.registry('systems').add({
      id: 'home', order: 60,
      onMapEnter(world) { listen(world); H.sweep(world, { quiet: false }); },
      update(world, dt) {
        const project = world.project, save = world.save;
        if (!project || !save) return;
        listen(world);
        world._homeCheck = (world._homeCheck || 0) + dt;
        if (world._homeCheck < 1) return;
        world._homeCheck = 0;
        H.sweep(world, { quiet: true });
      },
    });

    // --- pause-menu entries -----------------------------------------------------------
    const menus = KIT.registry('menus');
    menus.add({
      // The pause menu, in one order across every module the demo ships:
      //   10 Party · 12 Pokédex · 14 Jobs · 16 Decorate · then the kit's own
      //   Save (20), Two players (30), Settings (40)…
      id: 'home-jobs', order: 14,
      label: (game) => KIT.strings.get(game && game.project, 'home-menu-jobs'),
      value: (game) => {
        const w = game && game.world;
        if (!w) return undefined;
        const ready = H.jobsReady(w.save, H.now(w.save)).length;
        const out = H.jobsOut(w.save).length;
        if (ready) return `${ready} back`;
        return out ? `${out} out` : undefined;
      },
      async open(game) { await KIT.scenes.run('home-jobs', { game }); return null; },
    });

    menus.add({
      id: 'home-decorate', order: 16,
      label: (game) => KIT.strings.get(game && game.project, 'home-menu-decorate'),
      when: (game) => !!(game && game.project && H.furnitureItems(game.project).length),
      async open(game) { await KIT.scenes.run('home-place', { game }); return null; },
    });

    // --- one mood, wherever a friend is shown -------------------------------------
    // A module that owns creatures shows how they are feeling on its own screens.
    // We keep a mood that drifts and reacts to what you do, so we offer it; a
    // module that does not want it simply has no `provideMood`. Nothing here
    // reads that module's state, and with it absent this line does nothing.
    const owner = KIT.mons;
    if (owner && typeof owner.provideMood === 'function') {
      owner.provideMood((mon, o) => {
        const uid = mon && mon.uid;
        if (!uid) return null;
        const save = (o && o.save && o.save.modules) ? o.save : ((KIT.game && KIT.game.state) || null);
        const project = (o && o.project) || (KIT.game && KIT.game.project) || null;
        if (!save || !save.modules || !save.modules.home) return null;   // nothing decided yet
        return H.moodFor(project, save, uid);
      });
    }
  };

  /**
   * listen(world) — wire this world up once.
   * `friendCared { uid, what }` is how a module that owns creatures says one of
   * them was petted, fed or ignored. We keep the mood, so we move it. Nothing
   * here knows which module that is, and no module has to send it.
   */
  function listen(world) {
    if (!world || !world.events || world._homeListening) return;
    world._homeListening = true;
    world.events.on('friendCared', (p) => {
      try {
        if (!p || !p.uid) return;
        H.react(world.save, p.uid, p.what || 'petted', H.now(world.save));
      } catch (e) { (KIT.log || console).error('[home] friendCared', e); }
    });
    // A board the author has emptied of pages still opens. The type ships a
    // default page carrying @openJobBoard — that is the visible, editable way,
    // and it is what a board placed in Creator Mode uses. This is the safety net
    // underneath it: if nothing on the map answered the A button and the player
    // was facing a board, the board answers for itself.
    world.events.on('interactMissed', (p) => {
      try {
        if (!p || !world.map) return;
        const here = world.map.objectsAt(p.x, p.y).find(o => o.type === 'job-board' && !world.map.isHidden(o));
        if (!here) return;
        KIT.scenes.run('home-board', { game: KIT.game, world, object: here });
      } catch (e) { (KIT.log || console).error('[home] interactMissed', e); }
    });
    // The engine measured the gap between sessions and has already moved the
    // clock on by whatever Project › Clock says a gap is worth. All this module
    // does is notice — the jobs are timed against the clock, so they finished
    // while we were away without anyone having to catch them up by hand.
    world.events.on('sessionResumed', (p) => {
      try {
        H.ensure(world.save).seenAt = new Date().toISOString();
        world._homeResumed = { elapsedMs: (p && p.elapsedMs) || 0, minutesAdded: (p && p.minutesAdded) || 0 };
        H.sweep(world, { quiet: false });
      } catch (e) { (KIT.log || console).error('[home] sessionResumed', e); }
    });
  }

  /**
   * sweep(world, opts) -> { resumed, ready, drifted, gifts }
   * The housekeeping one tick and one map entry both want: catch up on time
   * away, drift the moods, roll for a present, and notice who is home.
   */
  H.sweep = function (world, opts) {
    const o = opts || {};
    const project = world.project, save = world.save;
    if (!project || !save) return null;
    H.ensure(save);
    // The gap between sessions is the engine's to measure and announce
    // (`sessionResumed`); by the time it reaches us the clock has already moved.
    const resumed = world._homeResumed || { elapsedMs: 0, minutesAdded: 0 };
    const now = H.now(save);
    const drifted = H.driftMoods(save, project, now);
    const gifts = H.rollGifts(save, project, now);
    let placed = 0;
    for (const g of gifts) if (H.placeGift(save, project, g)) placed++;
    if (placed && world.map && world.map.id) {
      const live = H.live(world);
      live.rebuild();
      if (world.ports && world.ports.io && world.ports.io.toast) {
        const first = gifts.find(g => g.map === world.map.id);
        if (first) world.ports.io.toast({ text: KIT.strings.get(project, 'home-gift-toast', { who: first.fromName || first.from }) });
      }
    }
    const ready = H.jobsReady(save, now);
    if (ready.length && !world._homeAnnounced && world.ports && world.ports.io && world.ports.io.toast && !o.quiet) {
      world._homeAnnounced = true;
      world.ports.io.toast({ text: KIT.strings.get(project, 'home-ready-toast', { count: ready.length }) });
    }
    if (!ready.length) world._homeAnnounced = false;
    return { resumed, ready, drifted, gifts };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
