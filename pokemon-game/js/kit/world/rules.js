// Rules that are things.
//
// Most engines put the rules of a game in the engine, where a game cannot
// reach them. Baba Is You put them on the floor as words you can push, and the
// interesting part is not the puzzle — it is that "gravity is down" became an
// object with a position, which means it can be moved, hidden, or eaten.
//
// A rule here is a thing in the world with three parts an author already knows:
//
//   when   an event that happens        ('step', 'mapEnter', 'logged', …)
//   if     a condition                   (the same conditions an event page uses)
//   do     a script                      (the same commands an event page runs)
//
// That is the whole design, and it is deliberately not a new language. An
// engine that invents a rule DSL has to invent predicates, effects, an editor
// widget for each, a validator, and a text form — all of which exist here
// already for conditions and scripts. A rule is the two of them with a trigger.
//
// WHAT MAKES IT AN ENTITY RATHER THAN A CALLBACK
//
// A rule can be turned off, rewritten, and EATEN. It can have a carrier — a
// scroll, a tablet, a tome somebody is holding — and destroying the carrier
// takes the rule out of the world. `@eat doors-need-keys` is a verb a story can
// use, and after it the doors do not need keys, because the rule that said so
// is gone.
//
// CONFLICT
//
// Two rules that fire on the same event run in a defined order, so a game does
// not depend on which was declared first: priority, then specificity (a rule
// scoped to one place beats one scoped to a layer, which beats a global), then
// most recently defined, then id. Stated, tested, and boring — which is what
// you want when the rules of reality disagree.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const R = KIT.rules = KIT.rules || {};
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  /**
   * How deep a rule may set off another rule before the engine stops it.
   * A cap rather than a ban: rules that trigger rules is the point, and rules
   * that trigger themselves forever is a hang with no error message.
   */
  R.MAX_DEPTH = 8;

  /** The save section: what has been switched off, eaten or rewritten this run. */
  R.state = function (save) {
    if (!isObj(save)) return {};
    if (!isObj(save.rules)) save.rules = {};
    return save.rules;
  };

  /** all(project) -> every rule the project declares, plus any defined at runtime. */
  R.all = function (project, save) {
    const out = [];
    for (const [id, r] of Object.entries((project && project.rules) || {})) out.push(Object.assign({ id }, r));
    const st = R.state(save);
    for (const [id, s] of Object.entries(st)) {
      if (s && s.rule && !out.some((r) => r.id === id)) out.push(Object.assign({ id }, s.rule));
    }
    return out;
  };

  /** get(project, save, id) -> the rule as it stands NOW, with any rewrite applied. */
  R.get = function (project, save, id) {
    const base = ((project && project.rules) || {})[id] || (R.state(save)[id] || {}).rule;
    if (!base) return null;
    const st = R.state(save)[id] || {};
    return Object.assign({ id }, base, st.patch || {});
  };

  /**
   * live(project, save, id) -> is this rule in force?
   * Eaten beats everything. Otherwise an explicit on/off beats the rule's own
   * `on` default.
   */
  R.live = function (project, save, id) {
    const st = R.state(save)[id];
    if (st && st.eaten) return false;
    if (st && typeof st.on === 'boolean') return st.on;
    const r = R.get(project, save, id);
    return !!r && r.on !== false;
  };

  /** define(save, rule) — a rule that did not exist when the game shipped. */
  R.define = function (save, rule) {
    if (!isObj(rule) || !rule.id) return null;
    const st = R.state(save);
    st[rule.id] = Object.assign({}, st[rule.id], { rule: Object.assign({}, rule), on: rule.on !== false, at: nextAt(st) });
    return st[rule.id].rule;
  };

  R.activate = function (save, id) { const st = R.state(save); st[id] = Object.assign({}, st[id], { on: true }); return true; };
  R.deactivate = function (save, id) { const st = R.state(save); st[id] = Object.assign({}, st[id], { on: false }); return true; };

  /**
   * eat(save, id) — take the rule out of the world. Permanent within the run,
   * and written into the history, because "the rule is gone" is a thing that
   * happened and a later line will want to ask about it.
   */
  R.eat = function (save, id) {
    const st = R.state(save);
    if (st[id] && st[id].eaten) return false;
    st[id] = Object.assign({}, st[id], { eaten: true, on: false });
    if (KIT.history) KIT.history.add(save, 'ate', { what: 'rule:' + id });
    if (KIT.worldBus) KIT.worldBus(save).emit('ruleEaten', { id });
    return true;
  };

  /** rewrite(save, id, patch) — change what a rule says, from inside the game. */
  R.rewrite = function (save, id, patch) {
    if (!isObj(patch)) return false;
    const st = R.state(save);
    st[id] = Object.assign({}, st[id], { patch: Object.assign({}, (st[id] || {}).patch, patch) });
    if (KIT.worldBus) KIT.worldBus(save).emit('ruleRewritten', { id, patch });
    return true;
  };

  /**
   * The next "defined at" stamp. Rules that shipped with the game have none and
   * so count as 0, which is what makes a rule somebody made up during the run
   * beat one that was always there — the tie-break after priority and scope.
   * Derived from what is already in the save rather than kept in a counter, so
   * it survives a save file without a field to migrate.
   */
  function nextAt(st) {
    let max = 0;
    for (const s of Object.values(st)) if (s && typeof s.at === 'number' && s.at > max) max = s.at;
    return max + 1;
  }

  /**
   * Does this rule apply where the player is standing?
   * A scope with nothing in it is global, which is the common case and should
   * not need saying.
   */
  R.inScope = function (rule, where) {
    const s = rule.scope;
    if (!isObj(s)) return true;
    if (Array.isArray(s.maps) && s.maps.length && !s.maps.includes(where.map)) return false;
    if (Array.isArray(s.layers) && s.layers.length && !s.layers.includes(where.layer)) return false;
    return true;
  };

  /** How specific a scope is: a place beats a layer beats everywhere. */
  function specificity(rule) {
    const s = rule.scope;
    if (!isObj(s)) return 0;
    let n = 0;
    if (Array.isArray(s.maps) && s.maps.length) n += 2;
    if (Array.isArray(s.layers) && s.layers.length) n += 1;
    return n;
  }

  /**
   * matching(project, save, event, where) -> the rules that would fire, in the
   * order they will fire. Pure, so the editor can show an author exactly what
   * is about to happen and in what order.
   */
  R.matching = function (project, save, event, where) {
    const at = where || {};
    const out = [];
    // The world asks this for EVERY event — each footstep, each clock tick —
    // and the common answer is "nobody is listening". So the `when` of each
    // rule is read off the declaration and its patch before anything is
    // cloned; only a rule that actually names this event pays for R.get.
    const declared = (project && project.rules) || {};
    const st = R.state(save);
    const listens = (id, base) => {
      const patch = st[id] && st[id].patch;
      const when = patch && patch.when !== undefined ? patch.when : base.when;
      return when === event;
    };
    const consider = (id, base) => {
      if (!listens(id, base)) return;
      const rule = R.get(project, save, id);
      if (!rule) return;
      if (!R.live(project, save, id)) return;
      if (!R.inScope(rule, at)) return;
      out.push(rule);
    };
    for (const id of Object.keys(declared)) consider(id, declared[id]);
    for (const id of Object.keys(st)) if (st[id] && st[id].rule && !declared[id]) consider(id, st[id].rule);
    if (!out.length) return out;
    const stateOf = (id) => R.state(save)[id] || {};
    out.sort((a, b) =>
      (b.priority || 0) - (a.priority || 0) ||
      specificity(b) - specificity(a) ||
      (stateOf(b.id).at || 0) - (stateOf(a.id).at || 0) ||
      String(a.id).localeCompare(String(b.id)));
    return out;
  };

  let depth = 0;
  /**
   * fire(ctx, event, payload) -> Promise<number> — run every rule listening for
   * this event, in order, and answer how many ran.
   *
   * `ctx` is an interpreter ctx: the rule's `do` is an ordinary command list and
   * runs through the ordinary interpreter, which is what makes a rule able to do
   * anything an event page can.
   */
  R.fire = async function (ctx, event, payload) {
    if (!ctx || !ctx.project || !ctx.world) return 0;
    const save = ctx.world.save;
    const where = {
      map: (ctx.world.map && ctx.world.map.id) || null,
      layer: (save && save.dimension) || null,
    };
    const list = R.matching(ctx.project, save, event, where);
    if (!list.length) return 0;
    if (depth >= R.MAX_DEPTH) {
      // Rejected rather than recursed. The originating verb is dropped and the
      // loop is written down, because a game that hangs tells an author nothing
      // and a game that says "rule:loop at doors-need-keys" tells them where.
      if (KIT.history) KIT.history.add(save, 'rule:loop', { what: event });
      (KIT.log || console).warn(`[rules] too deep on '${event}' — ${list.map((r) => r.id).join(', ')}`);
      return 0;
    }
    depth++;
    let ran = 0;
    try {
      for (const rule of list) {
        const sub = Object.assign({}, ctx, { payload, rule: rule.id });
        try {
          if (rule.if && KIT.conditions && !KIT.conditions.test(rule.if, sub)) continue;
          if (Array.isArray(rule.do) && rule.do.length && KIT.interpreter) {
            // A rule that speaks locks input while it speaks, exactly as the
            // event page of an object that speaks does. `busy` goes on HERE and
            // not around the whole firing, because most events match no rule or
            // fail the condition, and a world that goes busy on every footstep
            // is a world you cannot walk across.
            const w = ctx.world;
            // The lock is taken when this rule's turn actually comes — a rule fired
            // from inside a running script queues behind it on the main thread —
            // and always released. Restoring an earlier value put `busy` back to
            // true after the script that fired the rule had already let go: a
            // frozen game with nothing in the console.
            if (w && KIT.interpreter.whenIdle) await KIT.interpreter.whenIdle();
            if (w) w.busy = true;
            try {
              await KIT.interpreter.run(rule.do, sub, { label: 'rule:' + rule.id });
            } finally { if (w) w.busy = false; }
          }
          ran++;
        } catch (e) {
          // One broken rule must not stop the others, and must not be silent.
          if (KIT.game && KIT.game.fault) KIT.game.fault('rule:' + rule.id, e);
          else (KIT.log || console).error('[rule]', rule.id, e);
        }
      }
    } finally { depth--; }
    return ran;
  };

  /** depthNow() — for tests, and for a debug panel that wants to say why nothing fired. */
  R.depthNow = () => depth;

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
