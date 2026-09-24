// What happened. The history of one run.
//
// (Named `history`, not `log`: KIT.log is the engine's logger and always was.
// The unit suite caught the collision on the first run, which is the argument
// for a test that loads every file together.)
//
// Every game that "remembers you" is built on a list of things you did. The
// usual way to get one is a pile of boolean variables — Undertale's is a flat
// array of 512 integer flags written and read in a bare loop, of which only 351
// indices are ever used, and one of them (`FL_FinalTorielChoice`, index 512)
// sits outside the loop that persists them and so silently does not save. That
// is what hand-counting state looks like at the end of a long project.
//
// So: one list, appended to, queryable.
//
//   KIT.history.add(save, 'ate', { what: 'bread', where: 'diner' })
//   KIT.history.has(save, { verb: 'ate', what: 'bread' })     // ever?
//   KIT.history.count(save, { verb: 'ate' })                  // how many times?
//   KIT.history.last(save, { verb: 'ate' })                   // when, and where?
//
// THE HARD PART IS THAT A SAVE IS JSON.
//
// An engine with a database can keep every entry forever and answer any
// question about any of them. This one puts the save in browser storage as one
// document, so an unbounded list is a save that grows until it stops fitting —
// and the measured write cost at 1,000 maps is already 75ms.
//
// The answer is to split the two things a log is asked for. Questions of the
// form "did this ever happen" and "how many times" are answered from a TALLY,
// which is a small map of counts that is never trimmed and stays exact forever.
// Questions of the form "when, where, and in what order" are answered from a
// WINDOW of recent entries, which is bounded and drops its oldest.
//
// That trade is stated rather than hidden: `has` and `count` are exact for the
// life of the save; `last`, `all` and `since` see the last `KIT.history.WINDOW`
// entries. A game that needs "the third time you did X" beyond the window
// should count it itself — and `count` is how.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const L = KIT.history = KIT.history || {};
  const isObj = KIT.isObject;

  /** How many entries are kept in full. Roughly 40KB of save at the default. */
  L.WINDOW = 400;

  /** The section of a save this lives in, created on demand. */
  L.of = function (save) {
    if (!isObj(save)) return { n: 0, entries: [], tally: {} };
    if (!isObj(save.log)) save.log = { n: 0, entries: [], tally: {} };
    const l = save.log;
    if (!Array.isArray(l.entries)) l.entries = [];
    if (!isObj(l.tally)) l.tally = {};
    if (typeof l.n !== 'number') l.n = 0;
    return l;
  };

  /** The tally key for a verb and its object. `ate/bread`, or `ate` on its own. */
  function tallyKey(verb, what) {
    return what === undefined || what === null || what === '' ? String(verb) : `${verb}/${what}`;
  }

  /**
   * add(save, verb, opts) -> the entry.
   *
   * opts: { what, who, where, layer, at, data }
   *
   * `where` and `layer` default to wherever the world currently is, because the
   * commonest question after "did they" is "where were they when they did".
   * Both tiers are written: the tally always, the window if there is room and
   * the oldest entry makes way if there is not.
   */
  L.add = function (save, verb, opts) {
    const v = String(verb || '').trim();
    if (!v) return null;
    const o = opts || {};
    const l = L.of(save);
    const world = KIT.game && KIT.game.world;
    const clock = (save && save.clock) || {};
    const entry = {
      n: ++l.n,
      verb: v,
      what: o.what === undefined ? null : o.what,
      who: o.who === undefined ? null : o.who,
      where: o.where === undefined ? ((world && world.map && world.map.id) || null) : o.where,
      layer: o.layer === undefined ? ((save && save.dimension) || null) : o.layer,
      // In-game minutes since the first morning, which is the clock an author
      // thinks in. Wall-clock time is deliberately NOT here: it is not the same
      // number on two devices and it makes a save leak when somebody played.
      at: o.at === undefined ? (Math.max(1, Number(clock.day) || 1) - 1) * 1440 + (Number(clock.minutes) || 0) : o.at,
    };
    if (o.data !== undefined) entry.data = o.data;

    // The tally is exact forever. Both keys, so `ate` and `ate/bread` are each
    // answerable without scanning anything.
    l.tally[tallyKey(v)] = (l.tally[tallyKey(v)] || 0) + 1;
    if (entry.what !== null) {
      const k = tallyKey(v, entry.what);
      l.tally[k] = (l.tally[k] || 0) + 1;
    }

    l.entries.push(entry);
    if (l.entries.length > L.WINDOW) l.entries.splice(0, l.entries.length - L.WINDOW);
    if (KIT.worldBus) KIT.worldBus(save).emit('logged', entry);
    return entry;
  };

  /** Does an entry match? A query field that is absent means "any". */
  function matches(e, q) {
    if (!q) return true;
    if (q.verb !== undefined && e.verb !== q.verb) return false;
    if (q.what !== undefined && e.what !== q.what) return false;
    if (q.who !== undefined && e.who !== q.who) return false;
    if (q.where !== undefined && e.where !== q.where) return false;
    if (q.layer !== undefined && e.layer !== q.layer) return false;
    return true;
  }

  /**
   * count(save, query) -> how many times, EXACTLY, for the life of the save.
   *
   * Answered from the tally when the query is one the tally covers (a verb, or
   * a verb and its object). Any other shape — "how many times in the diner" —
   * falls back to the window and is therefore only exact within it, which is
   * why `windowed` says so.
   */
  L.count = function (save, query) {
    const l = L.of(save);
    const q = typeof query === 'string' ? { verb: query } : (query || {});
    const onlyVerbish = Object.keys(q).every((k) => k === 'verb' || k === 'what');
    if (onlyVerbish && q.verb !== undefined) return l.tally[tallyKey(q.verb, q.what)] || 0;
    let n = 0;
    for (const e of l.entries) if (matches(e, q)) n++;
    return n;
  };

  /** has(save, query) -> did this ever happen. Exact whenever count() is. */
  L.has = function (save, query) { return L.count(save, query) > 0; };

  /**
   * exact(query) -> can count()/has() answer this for all time, or only within
   * the window? An author asking a question the engine can only half-answer
   * should be able to find that out without reading this file.
   */
  L.exact = function (query) {
    const q = typeof query === 'string' ? { verb: query } : (query || {});
    return q.verb !== undefined && Object.keys(q).every((k) => k === 'verb' || k === 'what');
  };

  /** last(save, query) -> the most recent matching entry within the window, or null. */
  L.last = function (save, query) {
    const l = L.of(save);
    const q = typeof query === 'string' ? { verb: query } : (query || {});
    for (let i = l.entries.length - 1; i >= 0; i--) if (matches(l.entries[i], q)) return l.entries[i];
    return null;
  };

  /** all(save, query) -> every matching entry still in the window, oldest first. */
  L.all = function (save, query) {
    const q = typeof query === 'string' ? { verb: query } : (query || {});
    return L.of(save).entries.filter((e) => matches(e, q));
  };

  /** since(save, n, query) -> matching entries after sequence number n. */
  L.since = function (save, n, query) {
    const from = Number(n) || 0;
    return L.all(save, query).filter((e) => e.n > from);
  };

  /** seq(save) -> how many things have EVER been logged, window or not. */
  L.seq = function (save) { return L.of(save).n; };

  /**
   * promote(save, verb, what) — carry one fact across New Game.
   *
   * The log is per-run, like everything else in a save. A thing that should
   * outlive the run goes to `meta`, deliberately and one at a time, because
   * "what survives a reset" is authored content and not a side effect. Undertale
   * makes the same choice: its True Reset rewrites exactly six values out of
   * twenty-two sections, hand-picked.
   */
  L.promote = function (save, verb, what) {
    if (!KIT.storage || !KIT.storage.meta) return false;
    const n = L.count(save, what === undefined || what === null || what === '' ? { verb } : { verb, what });
    // Nothing to carry is not an error and is not a 1. This used to read
    // `Math.max(1, n)`, which meant carrying over something that never happened
    // wrote it down as having happened once — and a story asking `ever.x` would
    // then be told yes, forever, because of a line that ran on the wrong branch
    // of an `@if`. `count` is exact from the tally for this shape of question
    // (ADR-0011), so there was never anything for the max to protect against.
    if (!n) return false;
    const k = tallyKey(verb, what);
    const meta = KIT.storage.meta();
    const ever = Object.assign({}, meta.everDid || {});
    ever[k] = (ever[k] || 0) + n;
    KIT.storage.saveMeta({ everDid: ever });
    return true;
  };

  /** everDid(verb, what) -> how many times across every run this player has had. */
  L.everDid = function (verb, what) {
    if (!KIT.storage || !KIT.storage.meta) return 0;
    const ever = KIT.storage.meta().everDid || {};
    return ever[tallyKey(verb, what)] || 0;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
