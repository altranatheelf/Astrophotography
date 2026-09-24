// KIT.cast (§8.7): the people in the story, what they know, and what they feel
// about each other.
//
// Switches do not scale to this. "Mira mentions the orchard, but only if she has
// heard about it, and only from someone she trusts, and not in front of Wren"
// is four switches per fact per person in RPG Maker, counted by hand, and it
// rots the first time you rename anything. Here it is three tables:
//
//   project.cast    who exists                { id, name, face, sprite, pronouns, knows[], feels{}, tags[] }
//   project.facts   what can be known         { id, label, note, secret }
//   save.cast       who knows what, now       { met, knows:{ fact: { at, from } }, feels:{ who: n } }
//
// and four questions a page can ask: do they know this, how do they feel about
// somebody, have we met, who else knows.
//
// The engine models it and gets out of the way. It has no opinion about what a
// fact means, what a feeling of 40 is, or whether knowing something is good.
//
//   KIT.cast.tell(save, 'mira', 'the-orchard', { from: 'wren' })
//   KIT.cast.knows(save, 'mira', 'the-orchard')       -> { at, from } | null
//   KIT.cast.feel(save, 'mira', 'wren', +10)          -> the new number
//   KIT.cast.whoKnows(project, save, 'the-orchard')   -> ['wren', 'mira']
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const C = KIT.cast = KIT.cast || {};
  const isObj = KIT.isObject;
  const num = KIT.num;

  /** How a feeling is scored. The middle is nothing in particular. */
  C.FEELING_MIN = -100;
  C.FEELING_MAX = 100;
  /** Named bands, so content and panels can say a word instead of a number. */
  C.BANDS = [
    { id: 'hostile', label: 'Hostile', upTo: -60 },
    { id: 'wary', label: 'Wary', upTo: -20 },
    { id: 'neutral', label: 'Neutral', upTo: 19 },
    { id: 'warm', label: 'Warm', upTo: 59 },
    { id: 'close', label: 'Close', upTo: 100 },
  ];
  /** band(n) -> { id, label } */
  C.band = function (n) {
    const v = KIT.clamp(num(n, 0), C.FEELING_MIN, C.FEELING_MAX);
    for (const b of C.BANDS) if (v <= b.upTo) return b;
    return C.BANDS[C.BANDS.length - 1];
  };

  // ---- the save side ---------------------------------------------------------
  /** section(save) -> save.cast, created if it is not there. */
  C.section = function (save) {
    if (!isObj(save)) return {};
    if (!isObj(save.cast)) save.cast = {};
    return save.cast;
  };
  /** of(save, who) -> that person's record, created if it is not there. */
  C.of = function (save, who) {
    const s = C.section(save);
    const id = String(who || '');
    if (!id) return { met: false, knows: {}, feels: {} };
    if (!isObj(s[id])) s[id] = { met: false, knows: {}, feels: {} };
    const r = s[id];
    if (!isObj(r.knows)) r.knows = {};
    if (!isObj(r.feels)) r.feels = {};
    return r;
  };

  /**
   * start(project, save) — put the starting knowledge and feelings from
   * `project.cast` into the save, without touching anything already there.
   * Called when a world is made, so a new game begins with the cast as written
   * and a loaded one keeps what has happened since.
   */
  C.start = function (project, save) {
    const people = (project && project.cast) || {};
    for (const id of Object.keys(people)) {
      const def = people[id] || {};
      const rec = C.of(save, id);
      if (rec.started) continue;
      rec.started = true;
      for (const fact of def.knows || []) {
        if (!rec.knows[fact]) rec.knows[fact] = { at: null, from: null };
      }
      for (const other of Object.keys(def.feels || {})) {
        if (rec.feels[other] === undefined) rec.feels[other] = num(def.feels[other], 0);
      }
      if (def.met) rec.met = true;
    }
    return save;
  };

  // ---- knowing ---------------------------------------------------------------
  /**
   * tell(save, who, fact, opts) -> bool — true if this is NEWS to them.
   *
   * `opts.from` is who told them (a cast id, a hero id, or left out for
   * "they worked it out"). `opts.at` is when, in the clock's absolute minutes,
   * so a line can say "you told me that yesterday".
   */
  C.tell = function (save, who, fact, opts) {
    const id = String(fact || '');
    if (!id) return false;
    const rec = C.of(save, who);
    if (rec.knows[id]) return false;
    const o = opts || {};
    rec.knows[id] = {
      at: o.at === undefined ? (save && save.clock ? ((Math.max(1, num(save.clock.day, 1)) - 1) * 1440 + num(save.clock.minutes, 0)) : null) : o.at,
      from: o.from === undefined ? null : (o.from || null),
    };
    return true;
  };
  /** forget(save, who, fact) -> bool — they no longer know it. */
  C.forget = function (save, who, fact) {
    const rec = C.of(save, who);
    const id = String(fact || '');
    if (!rec.knows[id]) return false;
    delete rec.knows[id];
    return true;
  };
  /** knows(save, who, fact) -> { at, from } | null */
  C.knows = function (save, who, fact) {
    const s = C.section(save)[String(who || '')];
    const k = s && s.knows && s.knows[String(fact || '')];
    return k || null;
  };
  /** known(save, who) -> [factId] — everything this person knows. */
  C.known = function (save, who) {
    const s = C.section(save)[String(who || '')];
    return s && s.knows ? Object.keys(s.knows) : [];
  };
  /** whoKnows(project, save, fact) -> [castId] — everybody who knows it, in cast order. */
  C.whoKnows = function (project, save, fact) {
    const id = String(fact || '');
    const order = Object.keys((project && project.cast) || {});
    const seen = C.section(save);
    const out = order.filter(who => seen[who] && seen[who].knows && seen[who].knows[id]);
    for (const who of Object.keys(seen)) {
      if (out.includes(who)) continue;
      if (seen[who] && seen[who].knows && seen[who].knows[id]) out.push(who);
    }
    return out;
  };

  /**
   * spread(save, from, to, opts) -> [factId] — everything `from` knows that `to`
   * did not. This is gossip, and it is deliberately a thing content asks for
   * rather than something that happens by itself: people tell each other things
   * when the story says they did.
   *
   * `opts.only` limits it to certain facts; `opts.not` holds some back.
   */
  C.spread = function (save, from, to, opts) {
    const o = opts || {};
    const only = o.only ? [].concat(o.only) : null;
    const not = o.not ? [].concat(o.not) : [];
    const told = [];
    for (const fact of C.known(save, from)) {
      if (only && !only.includes(fact)) continue;
      if (not.includes(fact)) continue;
      if (C.tell(save, to, fact, { from, at: o.at })) told.push(fact);
    }
    return told;
  };

  // ---- feeling ---------------------------------------------------------------
  /** feels(save, who, about) -> a number from -100 to 100. Nobody starts with an opinion. */
  C.feels = function (save, who, about) {
    const s = C.section(save)[String(who || '')];
    const v = s && s.feels ? s.feels[String(about || '')] : undefined;
    return num(v, 0);
  };
  /** feel(save, who, about, delta) -> the new number. */
  C.feel = function (save, who, about, delta) {
    const rec = C.of(save, who);
    const key = String(about || '');
    const next = KIT.clamp(num(rec.feels[key], 0) + num(delta, 0), C.FEELING_MIN, C.FEELING_MAX);
    rec.feels[key] = next;
    return next;
  };
  /** setFeeling(save, who, about, value) -> the new number. */
  C.setFeeling = function (save, who, about, value) {
    const rec = C.of(save, who);
    const next = KIT.clamp(num(value, 0), C.FEELING_MIN, C.FEELING_MAX);
    rec.feels[String(about || '')] = next;
    return next;
  };
  /**
   * mutual(save, a, b) -> { ab, ba, both } — how they feel about each other and
   * the lower of the two, because a friendship is only as warm as its cooler half.
   */
  C.mutual = function (save, a, b) {
    const ab = C.feels(save, a, b), ba = C.feels(save, b, a);
    return { ab, ba, both: Math.min(ab, ba) };
  };

  // ---- meeting ---------------------------------------------------------------
  /** meet(save, who) -> bool — true the first time. */
  C.meet = function (save, who) {
    const rec = C.of(save, who);
    if (rec.met) return false;
    rec.met = true;
    return true;
  };
  /** met(save, who) -> bool */
  C.met = function (save, who) { const s = C.section(save)[String(who || '')]; return !!(s && s.met); };

  // ---- reading the content ----------------------------------------------------
  /**
   * person(project, who) -> the cast entry, or null.
   * `who` is an id, or the NAME on screen — because a line says "Mira:" and the
   * engine should not need telling twice who that is.
   */
  C.person = function (project, who) {
    const t = (project && project.cast) || {};
    const key = String(who || '');
    if (!key) return null;
    if (t[key]) return t[key];
    for (const id of Object.keys(t)) if (t[id] && t[id].name === key) return t[id];
    return null;
  };
  /** nameOf(project, who) -> what to call them on screen. */
  C.nameOf = function (project, who) {
    const p = C.person(project, who);
    return (p && p.name) || String(who || '');
  };
  /** fact(project, id) -> the fact entry, or null. */
  C.fact = function (project, id) {
    const t = (project && project.facts) || {};
    return t[String(id || '')] || null;
  };
  /** labelOfFact(project, id) -> what to call it while writing. */
  C.labelOfFact = function (project, id) {
    const f = C.fact(project, id);
    return (f && f.label) || String(id || '');
  };

  /**
   * graph(project, save) -> what to draw while writing:
   *   people[]  { id, name, met, knows[{ id, label, from, at }], feels[{ id, name, value, band }] }
   *   facts[]   { id, label, secret, knownBy[] }
   * The point of a cast is being able to SEE it, so this is the engine's job and
   * not the panel's.
   */
  C.graph = function (project, save) {
    const cast = (project && project.cast) || {};
    const facts = (project && project.facts) || {};
    const ids = Object.keys(cast);
    const people = ids.map((id) => {
      const rec = C.section(save)[id] || { knows: {}, feels: {} };
      return {
        id,
        name: C.nameOf(project, id),
        met: !!rec.met,
        knows: Object.keys(rec.knows || {}).map(f => ({
          id: f, label: C.labelOfFact(project, f),
          from: (rec.knows[f] && rec.knows[f].from) || null,
          at: (rec.knows[f] && rec.knows[f].at) == null ? null : rec.knows[f].at,
        })),
        feels: Object.keys(rec.feels || {}).map(other => ({
          id: other, name: C.nameOf(project, other),
          value: num(rec.feels[other], 0), band: C.band(rec.feels[other]),
        })).sort((a, b) => b.value - a.value),
      };
    });
    const factIds = Array.from(new Set(Object.keys(facts).concat(
      [].concat(...people.map(p => p.knows.map(k => k.id))))));
    return {
      people,
      facts: factIds.map(id => ({
        id, label: C.labelOfFact(project, id),
        secret: !!(facts[id] && facts[id].secret),
        declared: !!facts[id],
        knownBy: C.whoKnows(project, save, id),
      })),
    };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
