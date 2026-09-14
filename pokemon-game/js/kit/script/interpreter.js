// Interpreter (§9.6): runs command lists on threads. The MAIN thread is
// exclusive (a second main run waits its turn; input is locked by the runtime
// while one runs); BACKGROUND threads run `tick`/`parallel` scripts and may not
// use commands that need the main thread. Every random decision goes through
// ctx.rng, so a run is reproducible.
//
//   await KIT.interpreter.run(commands, ctx, { kind:'main'|'background' }) -> { status:'done'|'exit'|'cancelled', thread }
//   KIT.interpreter.fakeCtx({ answers:[1,0], vars:{…} })   a recording ctx for tests and headless play
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const CMD = KIT.commands;
  const C = KIT.conditions;
  const P = KIT.path;
  const I = KIT.interpreter = KIT.interpreter || {};

  class Cancelled extends Error { constructor() { super('cancelled'); this.name = 'Cancelled'; } }
  I.Cancelled = Cancelled;
  const threads = new Map();
  let nextId = 1;
  let mainChain = Promise.resolve();
  let mainActive = 0;

  function makeThread(kind, label) {
    const t = {
      id: nextId++, kind, label: label || '', background: kind === 'background', status: 'queued',
      cancelled: false, paused: false, stepping: false, breakpoints: new Set(), current: null, steps: 0,
      _wake: null,
      wake() { const w = t._wake; t._wake = null; if (w) w(); },
      pause() { t.paused = true; },
      resume() { t.paused = false; t.stepping = false; t.wake(); },
      step() { t.stepping = true; t.paused = false; t.wake(); },
      cancel() { t.cancelled = true; t.wake(); },
      async checkpoint(cmd, path, ctx) {
        t.current = { cmd, path };
        t.steps++;
        if (t.cancelled) throw new Cancelled();
        if (t.breakpoints.has(P.join(path)) || t.stepping) { t.paused = true; t.stepping = false; }
        if (typeof ctx.onStep === 'function') ctx.onStep(cmd, path, t);
        if (t.cancelled) throw new Cancelled();          // a cancel from the hook applies before this command runs
        while (t.paused) {
          await new Promise(res => { t._wake = res; });
          if (t.cancelled) throw new Cancelled();
        }
      },
    };
    return t;
  }

  /** The nested list `body` of `cmd` as a debugger path (by identity), e.g. [3,'then'] or [3,'options',1,'then']. */
  function blockPath(cmd, body, path) {
    for (const n of CMD.nested(cmd)) if (n.list === body) return path.concat(n.path);
    return path.concat('block');
  }

  async function execList(cmds, ctx, path, loop) {
    const labels = {};
    (cmds || []).forEach((c, i) => { if (KIT.isObject(c) && c.t === 'label' && !c.disabled && c.name) labels[c.name] = i; });
    let pc = 0;
    for (;;) {
      if (pc >= cmds.length) {
        if (loop && cmds.length) { pc = 0; continue; }
        return { kind: 'done' };
      }
      const cmd = cmds[pc];
      const p = path.concat(pc);
      await ctx.thread.checkpoint(cmd, p, ctx);
      const signal = await CMD.exec(ctx, cmd);
      if (signal && signal.kind) {
        if (signal.kind === 'block') {
          const r = await execList(signal.body || [], ctx, blockPath(cmd, signal.body, p), !!signal.loop);
          if (r.kind === 'break') { if (signal.loop) { pc++; continue; } return r; }
          if (r.kind === 'jump') { if (labels[r.label] != null) { pc = labels[r.label]; continue; } return r; }
          if (r.kind === 'exit') return r;
          pc++; continue;
        }
        if (signal.kind === 'break' || signal.kind === 'exit') return signal;
        if (signal.kind === 'jump') { if (labels[signal.label] != null) { pc = labels[signal.label]; continue; } return signal; }
        if (signal.kind === 'call') { await I.callScript(ctx, signal.script, signal.args, p); pc++; continue; }
      }
      pc++;
    }
  }

  /** callScript(ctx, id, args, path) — runs project.scripts[id].body on the SAME thread. `exit`/`break`/`jump` inside end only that script. */
  I.callScript = async function (ctx, id, args, path) {
    const script = ctx.project && ctx.project.scripts && ctx.project.scripts[id];
    if (!script) { (KIT.log || console).warn(`[interpreter] unknown script '${id}'`); return { kind: 'done' }; }
    const depth = (ctx.callDepth || 0) + 1;
    if (depth > 32) throw new Error(`interpreter: call depth exceeded at script '${id}'`);
    const merged = {};
    for (const name of script.params || []) merged[name] = args && args[name] !== undefined ? args[name] : null;
    Object.assign(merged, args || {});
    const child = Object.assign({}, ctx, { args: merged, scriptId: id, callDepth: depth });
    return execList(script.body || [], child, (path || []).concat('call:' + id));
  };

  /**
   * run(commands, ctx, { kind:'main'|'background', label, path, breakpoints:['2/then/0'] }) -> Promise<{ status, thread, signal }>
   * Main runs are serialised: a new main run starts when the previous one has ended.
   */
  I.run = function (cmds, ctx, opts) {
    opts = opts || {};
    const kind = opts.kind === 'background' ? 'background' : 'main';
    const thread = makeThread(kind, opts.label);
    for (const b of opts.breakpoints || []) thread.breakpoints.add(Array.isArray(b) ? P.join(b) : String(b));
    threads.set(thread.id, thread);
    const tctx = Object.assign({}, ctx || {}, { thread });
    const exec = async () => {
      if (thread.cancelled) { thread.status = 'cancelled'; threads.delete(thread.id); return { status: 'cancelled', thread }; }
      thread.status = 'running';
      if (kind === 'main') mainActive++;
      try {
        const r = await execList(cmds || [], tctx, opts.path || [], false);
        thread.status = 'done';
        return { status: r.kind === 'exit' ? 'exit' : 'done', thread, signal: r };
      } catch (e) {
        if (e instanceof Cancelled) { thread.status = 'cancelled'; return { status: 'cancelled', thread }; }
        thread.status = 'error';
        throw e;
      } finally {
        if (kind === 'main') mainActive--;
        thread.current = null;
        threads.delete(thread.id);
      }
    };
    if (kind === 'main') {
      const p = mainChain.then(exec, exec);
      mainChain = p.then(() => undefined, () => undefined);
      thread.promise = p;
      return p;
    }
    thread.promise = exec();
    return thread.promise;
  };
  I.threads = () => Array.from(threads.values());
  I.mainBusy = () => mainActive > 0 || Array.from(threads.values()).some(t => t.kind === 'main');
  I.cancelAll = () => { for (const t of threads.values()) t.cancel(); };
  I.cancel = (thread) => { if (thread) thread.cancel(); };

  // ---- common events -------------------------------------------------------------
  I.runScript = function (project, id, ctx, opts) {
    const script = project && project.scripts && project.scripts[id];
    if (!script) return Promise.resolve({ status: 'done', missing: true });
    const args = (opts && opts.args) || {};
    const merged = {};
    for (const name of script.params || []) merged[name] = args[name] !== undefined ? args[name] : null;
    Object.assign(merged, args);
    const kind = (opts && opts.kind) || (script.trigger === 'parallel' ? 'background' : 'main');
    return I.run(script.body || [], Object.assign({}, ctx, { project, args: merged, scriptId: id }), { kind, label: id, path: ['script', id] });
  };
  /** runAuto(project, ctx) -> Promise<string[]> ids run (in order); each waits for the previous. */
  I.runAuto = async function (project, ctx) {
    const ran = [];
    for (const id of Object.keys((project && project.scripts) || {})) {
      const s = project.scripts[id];
      if (!s || s.trigger !== 'auto') continue;
      if (!C.test(s.when, Object.assign({}, ctx, { project }))) continue;
      ran.push(id);
      await I.runScript(project, id, ctx, { kind: 'main' });
    }
    return ran;
  };
  /** runParallel(project, ctx) -> [{ id, promise, thread }] background threads for every 'parallel' script whose `when` passes. */
  I.runParallel = function (project, ctx) {
    const out = [];
    for (const id of Object.keys((project && project.scripts) || {})) {
      const s = project.scripts[id];
      if (!s || s.trigger !== 'parallel') continue;
      if (!C.test(s.when, Object.assign({}, ctx, { project }))) continue;
      const promise = I.runScript(project, id, ctx, { kind: 'background' });
      out.push({ id, promise, thread: I.threads().find(t => t.label === id) || null });
    }
    return out;
  };

  // ---- fake ctx -----------------------------------------------------------------
  /**
   * fakeCtx({ project, save, self, hero, seed, answers, names, numbers, onSay }) -> ctx
   * Every port call is appended to ctx.log as { port, name, args }. Choices are answered from `answers`
   * (indices into the visible options, or option texts); names from `names`; numbers from `numbers`.
   */
  I.fakeCtx = function (options) {
    options = options || {};
    const project = options.project || { meta: { id: 'test' }, heroes: [{ id: 'p1', name: 'Ash' }, { id: 'p2', name: 'Misty' }], items: {}, scripts: {}, vars: {}, strings: {}, maps: {} };
    const save = Object.assign({ vars: {}, inventory: {}, objects: {}, heroes: [{}, {}], timer: { running: false, secondsLeft: 0 }, meta: {} }, options.save || {});
    const events = KIT.events('fake');
    const log = [];
    const answers = (options.answers || []).slice();
    const names = (options.names || []).slice();
    const numbers = (options.numbers || []).slice();
    const rec = (port, name) => (...args) => { log.push({ port, name, args }); return Promise.resolve(); };
    const ctx = {
      project, world: { save, map: options.map || { id: 'test', objects: [] }, entities: [], events },
      self: options.self === undefined ? null : options.self, hero: options.hero || 'p1', coop: !!options.coop,
      rng: KIT.rng(options.seed == null ? 1 : options.seed),
      log, answers, names, numbers,
      emit(event, payload) { log.push({ port: 'emit', name: event, args: [payload] }); events.emit(event, payload); },
      io: {
        say(o) { log.push({ port: 'io', name: 'say', args: [o] }); if (options.onSay) options.onSay(o); return Promise.resolve(); },
        choice(o) {
          log.push({ port: 'io', name: 'choice', args: [o] });
          let a = answers.length ? answers.shift() : 0;
          if (typeof a === 'string') { const i = o.options.findIndex(x => x.text === a); a = i; }
          return Promise.resolve(a);
        },
        nameEntry(o) { log.push({ port: 'io', name: 'nameEntry', args: [o] }); return Promise.resolve(names.length ? names.shift() : 'Name'); },
        inputNumber(o) { log.push({ port: 'io', name: 'inputNumber', args: [o] }); return Promise.resolve(numbers.length ? numbers.shift() : 0); },
        toast: rec('io', 'toast'), chapter: rec('io', 'chapter'), scrollText: rec('io', 'scrollText'), wait: rec('io', 'wait'),
      },
      audio: { play: rec('audio', 'play'), music: rec('audio', 'music'), stop: rec('audio', 'stop'), save: rec('audio', 'save'), replay: rec('audio', 'replay'), jingle: rec('audio', 'jingle') },
      screen: { fadeOut: rec('screen', 'fadeOut'), fadeIn: rec('screen', 'fadeIn'), tint: rec('screen', 'tint'), flash: rec('screen', 'flash'), shake: rec('screen', 'shake'), weather: rec('screen', 'weather') },
      pictures: { show: rec('pictures', 'show'), move: rec('pictures', 'move'), erase: rec('pictures', 'erase') },
      map: { transfer: rec('map', 'transfer'), setLocation: rec('map', 'setLocation'), moveRoute: rec('map', 'moveRoute'), scrollMap: rec('map', 'scrollMap'), transparency: rec('map', 'transparency'), animation: rec('map', 'animation'), balloon: rec('map', 'balloon'), erase: rec('map', 'erase'), follow: rec('map', 'follow') },
      game: { menu: rec('game', 'menu'), save(o) { log.push({ port: 'game', name: 'save', args: [o] }); return Promise.resolve(true); }, title: rec('game', 'title'), heal: rec('game', 'heal'), debug(o) { log.push({ port: 'game', name: 'debug', args: [o] }); } },
    };
    ctx.said = () => log.filter(e => e.port === 'io' && e.name === 'say').map(e => e.args[0].text);
    ctx.calls = (port, name) => log.filter(e => e.port === port && (!name || e.name === name));
    return ctx;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
