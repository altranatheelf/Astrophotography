// Saves as a tree, not a row of slots.
//
// A save slot is a lie a hard disk told us in 1994. What a player actually does
// is go back to a moment and try the other thing — and every engine answers that
// by making them overwrite the moment they came from. Undertale's whole argument
// is about a save file, and the engine underneath it can only hold one.
//
// So: every save is a NODE, its parent is the save it was made from, and playing
// on from an older node makes a BRANCH. Nothing is overwritten. The shape of a
// playthrough becomes a thing you can see, and — this is the part worth having —
// a thing the GAME can ask about:
//
//   KIT.timeline.elsewhere({ verb: 'killed', what: 'dog' })
//
// "In some other branch, not this one, did they do this?" That is a question no
// variable can answer, because the variable was in the other branch.
//
// WHY A DELTA AND NOT A SAVE PER NODE
//
// Measured, before any of this was wired to anything (tools/experiments/timeline.js):
// a save of the demo world is a few KB, and 200 of them at full size would be a
// tree bigger than the project. So a node keeps only what CHANGED from its
// parent, plus a full snapshot every ANCHOR nodes so that rebuilding one is
// bounded rather than a walk to the beginning of time.
//
// The delta format is three ops and no more:
//
//   { p: path, v: value }            set
//   { p: path, x: 1 }                delete
//   { p: path, cut: n, add: [...] }  an array lost n from its front and gained these
//
// The third exists for exactly one shape and it is the shape that matters: the
// history window (ADR-0011) is a bounded list that drops its oldest as it gains
// its newest, so between two saves it is the same 399 entries shifted by one. A
// prefix/suffix diff sees that as "everything changed". This sees it as one
// entry, which is the difference between 40KB a node and 200 bytes.
//
// WHAT THIS IS NOT
//
// It is not undo. Undo is the editor's (KIT.document), it is per-edit, and it is
// in memory. This is per-save, it is on disk, it survives a reload, and it
// branches — three things undo deliberately does not do.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const T = KIT.timeline = KIT.timeline || {};
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  /**
   * When a node keeps a whole save instead of a delta.
   *
   * Not every Nth node — that was the first answer and the experiment refused
   * it: at one anchor every 12 moments, 200 moments cost 1.1MB and 17 whole
   * saves were 592KB of it, while all 183 deltas together were 119KB. The
   * anchors WERE the tree.
   *
   * So the rule is the actual economics: a chain of deltas may not cost more
   * than the save it stands in for. Cheap deltas earn a long chain; an expensive
   * one (a newly painted map) pays for an anchor immediately. It tunes itself to
   * whatever the game turns out to save, which no constant can.
   */
  /** The only hard cap, and it is about rebuild latency, not size. */
  T.MAX_CHAIN = 256;
  /** How far the head-drop probe looks. The history window drops one at a time. */
  T.CUT_PROBE = 24;
  /** Roughly how much store the whole tree may take before it prunes itself. */
  T.BUDGET = 3 * 1024 * 1024;

  // =============================================================================
  // The delta. Pure, and the only part that has to be exactly right.
  // =============================================================================

  const sizeOf = (v) => JSON.stringify(v === undefined ? null : v).length;

  /**
   * An array's change as a head-drop plus a tail-append, if it is one.
   * Returns { cut, add } or null. `cut` items left the front and `add` items
   * arrived at the back; everything between stayed put and is not stored.
   */
  function align(a, b) {
    const limit = Math.min(T.CUT_PROBE, a.length);
    for (let cut = 0; cut <= limit; cut++) {
      const kept = a.length - cut;
      if (kept > b.length) continue;
      let same = true;
      for (let i = 0; i < kept; i++) if (!KIT.deepEqual(a[cut + i], b[i])) { same = false; break; }
      if (same) return { cut, add: b.slice(kept) };
    }
    return null;
  }

  /**
   * diff(a, b) -> ops that turn a into b.
   *
   * Objects recurse. Arrays get three candidate encodings — element-by-element,
   * head-drop-plus-append, and "replace the lot" — and the smallest one wins,
   * measured in bytes rather than guessed at, because which is smaller depends
   * entirely on what the array is for.
   */
  T.diff = function (a, b, path) {
    const p = path || [];
    const out = [];
    if (KIT.deepEqual(a, b)) return out;
    if (b === undefined) { out.push({ p, x: 1 }); return out; }
    if (isObj(a) && isObj(b)) {
      for (const k of Object.keys(a)) {
        if (!(k in b)) out.push({ p: p.concat(k), x: 1 });
        else for (const op of T.diff(a[k], b[k], p.concat(k))) out.push(op);
      }
      for (const k of Object.keys(b)) if (!(k in a)) out.push({ p: p.concat(k), v: b[k] });
      return out;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      const whole = [{ p, v: b }];
      let best = whole, bestSize = sizeOf(whole);
      if (a.length === b.length) {
        const each = [];
        for (let i = 0; i < a.length; i++) for (const op of T.diff(a[i], b[i], p.concat(i))) each.push(op);
        const s = sizeOf(each);
        if (s < bestSize) { best = each; bestSize = s; }
      }
      const al = align(a, b);
      if (al) {
        const spliced = [{ p, cut: al.cut, add: al.add }];
        if (sizeOf(spliced) < bestSize) { best = spliced; bestSize = sizeOf(spliced); }
      }
      return best;
    }
    out.push({ p, v: b });
    return out;
  };

  /** patch(base, ops) -> a new value. `base` is not touched. */
  T.patch = function (base, ops) { return T.apply(KIT.deepClone(base), ops); };

  /**
   * apply(target, ops) -> target, changed in place.
   *
   * Rebuilding a node walks a chain of deltas, and cloning the whole save at
   * every step was most of the cost of doing it. The chain clones once and then
   * mutates; `patch` is that with the clone in front, for anyone who has a value
   * they care about.
   */
  T.apply = function (target, ops) {
    let out = target;
    for (const op of ops || []) {
      if (!op.p || !op.p.length) {                       // the whole thing was replaced
        if (op.x) return undefined;
        out = KIT.deepClone(op.v);
        continue;
      }
      const parent = reach(out, op.p.slice(0, -1));
      if (parent === undefined) continue;
      const k = op.p[op.p.length - 1];
      if (op.x) { if (Array.isArray(parent)) parent.splice(Number(k), 1); else delete parent[k]; continue; }
      if (op.cut !== undefined) {
        const arr = parent[k];
        if (!Array.isArray(arr)) { parent[k] = KIT.deepClone(op.add || []); continue; }
        parent[k] = arr.slice(op.cut).concat(KIT.deepClone(op.add || []));
        continue;
      }
      parent[k] = KIT.deepClone(op.v);
    }
    return out;
  };
  /** Walk to a path, making the objects on the way. Arrays are never invented. */
  function reach(root2, path) {
    let at = root2;
    for (const k of path) {
      if (at === null || typeof at !== 'object') return undefined;
      if (at[k] === null || typeof at[k] !== 'object') at[k] = {};
      at = at[k];
    }
    return at;
  }

  // =============================================================================
  // The tree
  // =============================================================================

  const blank = () => ({ v: 1, head: null, n: 0, nodes: {} });
  let tree = null;

  /** The storage key this lives under: one tree per project, beside the slots. */
  T.key = () => (KIT.storage && KIT.storage.key ? KIT.storage.key('timeline') : 'kit.timeline');

  /** load() -> the tree, read once and then held. */
  T.load = async function () {
    if (tree) return tree;
    let stored = null;
    try { stored = await KIT.storage.get(T.key()); } catch (e) { stored = null; }
    tree = isObj(stored) && isObj(stored.nodes) ? stored : blank();
    return tree;
  };
  /** now() -> the tree as it stands, without waiting. Empty until load(). */
  T.now = () => tree || (tree = blank());
  T.flush = async function () { try { return await KIT.storage.set(T.key(), T.now()); } catch (e) { return false; } };
  /** forgetAll() — throw the whole tree away. Only the player asks for this. */
  T.forgetAll = async function () { tree = blank(); built = null; return T.flush(); };
  T._setTree = (t) => { tree = t || blank(); built = null; return tree; };

  T.node = (id) => T.now().nodes[id] || null;
  T.head = () => T.now().head;
  T.count = () => Object.keys(T.now().nodes).length;

  /** The chain of ids from the root down to this node. */
  T.path = function (id) {
    const out = [];
    const seen = new Set();
    let at = id;
    while (at && T.now().nodes[at] && !seen.has(at)) { seen.add(at); out.unshift(at); at = T.now().nodes[at].p; }
    return out;
  };
  T.children = (id) => Object.keys(T.now().nodes).filter((k) => T.now().nodes[k].p === (id || null));

  /**
   * rebuild(id) -> the save as it was at that moment.
   * Walks back to the nearest node that kept a whole save, then forward.
   *
   * The last one rebuilt is held, because the commonest thing anyone does with
   * this is record a moment onto the head — which needs the head's save, which
   * is the one just built. Without the hold, every save walked the chain.
   */
  let built = null;
  T.rebuild = function (id) {
    if (built && built.id === id) return KIT.deepClone(built.save);
    const nodes = T.now().nodes;
    const chain = [];
    let at = id;
    const seen = new Set();
    while (at && nodes[at] && !seen.has(at)) {
      seen.add(at);
      chain.unshift(at);
      if (nodes[at].full) break;
      at = nodes[at].p;
    }
    if (!chain.length || !nodes[chain[0]].full) return null;   // the anchor was pruned
    let save = KIT.deepClone(nodes[chain[0]].full);
    for (let i = 1; i < chain.length; i++) save = T.apply(save, nodes[chain[i]].d || []);
    built = { id, save: KIT.deepClone(save) };
    return save;
  };
  T._forgetBuilt = () => { built = null; };

  /**
   * record(save, opts) -> nodeId. A moment.
   *
   * Its parent is wherever the player is in the tree, so saving after a rewind
   * makes a branch rather than an overwrite. That is the whole mechanic and it
   * needs no button: continuing from an old moment IS branching.
   */
  T.record = function (save, opts) {
    const o = opts || {};
    const t = T.now();
    const parentId = o.parent !== undefined ? o.parent : t.head;
    const parent = parentId ? t.nodes[parentId] : null;
    const clock = (save && save.clock) || {};
    const base = parentId ? T.rebuild(parentId) : null;
    const node = {
      p: parent ? parentId : null,
      at: ++t.n,
      label: o.label || '',
      where: o.where !== undefined ? o.where : ((KIT.game && KIT.game.world && KIT.game.world.map && KIT.game.world.map.id) || null),
      layer: (save && save.dimension) || null,
      day: Number(clock.day) || 1,
      min: Number(clock.minutes) || 0,
      // What this moment ADDED to the run's tally, not the whole tally.
      //
      // The whole tally was the first answer, so that `elsewhere` could be one
      // map lookup per branch. It was also 400KB of a 1.1MB tree — more than
      // every delta put together — because the same few hundred counts were
      // written out two hundred times. A tally only ever grows, so the
      // increments are one or two keys, and "how many times over there" is the
      // sum of the increments between the fork and the tip. Same answer, forty
      // times smaller.
      tk: tallyDelta(base, save),
    };
    const chainBytes = parent ? (Number(parent.cb) || 0) : 0;
    const chainLen = parent ? (Number(parent.cl) || 0) + 1 : 0;
    if (!base) node.full = KIT.deepClone(save);
    else {
      const d = T.diff(base, save);
      const dBytes = sizeOf(d);
      // The rule: a chain of deltas may not cost more than the save it stands in
      // for, and may not get so long that rebuilding it stops feeling instant.
      if (dBytes >= sizeOf(save) || chainBytes + dBytes >= sizeOf(save) || chainLen >= T.MAX_CHAIN) {
        node.full = KIT.deepClone(save);
      } else {
        node.d = d;
        node.cb = chainBytes + dBytes;
        node.cl = chainLen;
      }
    }
    const id = 'm' + t.n;
    t.nodes[id] = node;
    t.head = id;
    built = { id, save: KIT.deepClone(save) };
    T.prune();
    return id;
  };

  /** What `save`'s tally has that `base`'s did not. Both may be missing. */
  function tallyDelta(base, save) {
    const now = (save && save.log && save.log.tally) || {};
    const was = (base && base.log && base.log.tally) || {};
    const out = {};
    for (const k of Object.keys(now)) {
      const d = (Number(now[k]) || 0) - (Number(was[k]) || 0);
      if (d) out[k] = d;
    }
    return out;
  }

  /**
   * tallyAt(id) -> the whole tally as it stood at that moment, added up along
   * the way. For anyone who wants the ledger rather than the question.
   */
  T.tallyAt = function (id) {
    const nodes = T.now().nodes;
    const out = {};
    for (const step of T.path(id)) {
      const tk = (nodes[step] && nodes[step].tk) || {};
      for (const k of Object.keys(tk)) out[k] = (out[k] || 0) + tk[k];
    }
    return out;
  };

  /** goto(id) -> the save at that moment, and the player is now standing there. */
  T.goto = function (id) {
    const save = T.rebuild(id);
    if (!save) return null;
    T.now().head = id;
    save.moment = id;
    return save;
  };
  /**
   * headTo(id) -> bool — stand at a moment without rebuilding it, for a save
   * that is already in hand and knows which moment it is. Loading an older slot
   * comes through here, which is what makes the next save branch.
   */
  T.headTo = function (id) {
    if (!id || !T.now().nodes[id]) return false;
    T.now().head = id;
    return true;
  };

  /** label(id, text) — name a moment, so a player can find it again. */
  T.label = function (id, text) {
    const n = T.node(id);
    if (!n) return false;
    n.label = String(text || '');
    return true;
  };
  /** keep(id, on) — a moment the pruner may never take. */
  T.keep = function (id, on) {
    const n = T.node(id);
    if (!n) return false;
    if (on === false) delete n.keep; else n.keep = 1;
    return true;
  };

  T.bytes = () => sizeOf(T.now());

  /**
   * prune() — the tree is not allowed to grow forever.
   *
   * Only LEAVES are taken, because a node in the middle is what its children's
   * deltas are written against; and never a leaf on the way to where the player
   * is, never one they asked to keep, and never the root. Oldest first, so what
   * goes is always the least recent dead end.
   */
  T.prune = function (budget) {
    const cap = budget || T.BUDGET;
    const t = T.now();
    let guard = 0;
    while (T.bytes() > cap && guard++ < 4096) {
      const onPath = new Set(T.path(t.head));
      const leaves = Object.keys(t.nodes)
        .filter((id) => !T.children(id).length && !onPath.has(id) && !t.nodes[id].keep && t.nodes[id].p)
        .sort((a, b) => (t.nodes[a].at || 0) - (t.nodes[b].at || 0));
      if (!leaves.length) return false;                 // everything left is load-bearing
      if (built && built.id === leaves[0]) built = null;
      delete t.nodes[leaves[0]];
    }
    return true;
  };

  // =============================================================================
  // What the game can ask
  // =============================================================================

  /**
   * elsewhere(query) -> how many times this happened in a branch that is NOT
   * the one the player is in.
   *
   * Read from each node's copied tally, so it costs one pass over the tree and
   * no rebuilding. A tally only ever grows along a chain, so a branch's total is
   * its TIP's count minus the count at the moment the branch left ours — which
   * is the honest answer to "did they do it over there", not "did they do it
   * before the split".
   */
  T.elsewhere = function (query) {
    const k = tallyKey(query);
    if (!k) return 0;
    const t = T.now();
    const mine = new Set(T.path(t.head));
    let most = 0;
    for (const id of Object.keys(t.nodes)) {
      if (mine.has(id)) continue;
      if (T.children(id).some((c) => !mine.has(c))) continue;      // only the tips of other branches
      // Add up what happened between the fork and this tip. Nothing before the
      // fork counts: that is our own past, and it is not news from elsewhere.
      let sum = 0, at = id, guard = 0;
      while (at && !mine.has(at) && guard++ < 8192) {
        sum += ((t.nodes[at].tk || {})[k] || 0);
        at = t.nodes[at].p;
      }
      most = Math.max(most, sum);
    }
    return Math.max(0, most);
  };
  /** everywhere(query) -> the most any one line of this playthrough has done it. */
  T.everywhere = function (query) {
    const k = tallyKey(query);
    if (!k) return 0;
    const t = T.now();
    let most = 0;
    for (const id of Object.keys(t.nodes)) {
      if (T.children(id).length) continue;                         // tips only: a tip has the whole line behind it
      most = Math.max(most, T.tallyAt(id)[k] || 0);
    }
    return most;
  };
  function tallyKey(query) {
    const q = typeof query === 'string' ? { verb: query } : (query || {});
    if (!q.verb) return null;
    return q.what === undefined || q.what === null || q.what === '' ? String(q.verb) : `${q.verb}/${q.what}`;
  }

  /**
   * moments(opts) -> the tree as rows a screen can draw, deepest branch first.
   * Each row carries how far in it is and whether it is on the player's own line,
   * which is everything a list needs and nothing a list has to compute.
   */
  T.moments = function () {
    const t = T.now();
    const mine = new Set(T.path(t.head));
    const rows = [];
    const walk = (id, depth) => {
      const n = t.nodes[id];
      if (!n) return;
      rows.push({
        id, depth, label: n.label || '', where: n.where, layer: n.layer, day: n.day, min: n.min,
        at: n.at, mine: mine.has(id), head: id === t.head, kept: !!n.keep,
        branches: T.children(id).length,
      });
      for (const c of T.children(id).sort((a, b) => (t.nodes[a].at || 0) - (t.nodes[b].at || 0))) walk(c, depth + 1);
    };
    for (const r of T.children(null).sort((a, b) => (t.nodes[a].at || 0) - (t.nodes[b].at || 0))) walk(r, 0);
    return rows;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
