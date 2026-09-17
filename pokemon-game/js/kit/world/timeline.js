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
// a save of the demo world with its history window full is 34KB, so 200 moments
// at full size is 6.65MB — larger than a 400-map project. A node keeps only what
// CHANGED from its parent, and keeps a whole save when the chain of deltas behind
// it has cost as much as one save would, so that rebuilding is bounded rather
// than a walk back to the beginning of time. 200 moments: 409KB.
//
// "When the chain has cost as much as a save" rather than "every Nth node" is
// not a detail — the first version was every twelfth and the experiment refused
// it, because the whole saves were 592KB of a 1.1MB tree while every delta put
// together was 119KB. See ADR-0013.
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

  const blank = () => ({ v: 1, head: null, n: 0, b: 0, nodes: {} });
  let tree = null;

  /** The storage key this lives under: one tree per project, beside the slots. */
  T.key = () => (KIT.storage && KIT.storage.key ? KIT.storage.key('timeline') : 'kit.timeline');

  /** load() -> the tree, read once and then held. */
  T.load = async function () {
    if (tree) return tree;
    let stored = null;
    try { stored = await KIT.storage.get(T.key()); } catch (e) { stored = null; }
    tree = isObj(stored) && isObj(stored.nodes) ? stored : blank();
    bump();
    T.repair();
    tree.b = T.bytes();          // the one exact measurement; kept running after
    return tree;
  };

  /**
   * repair() -> how many moments were dropped as unreachable.
   *
   * A node's delta is written against its parent, so a node whose parent is not
   * there cannot be rebuilt and nothing downstream of it can either. That should
   * not happen — pruning only takes leaves — but a store is not a promise: it can
   * be evicted part-way (Safari's seven-day sweep), truncated by a quota refusal
   * mid-write, or edited by hand. Checked on the way in, because the alternative
   * is a Moments list with rows that do nothing.
   */
  T.repair = function () {
    const t = T.now();
    let dropped = 0;
    for (let pass = 0; pass < 64; pass++) {
      const gone = Object.keys(t.nodes).filter((id) => {
        const n = t.nodes[id];
        if (!isObj(n)) return true;
        if (!n.p) return !n.full;                       // a root with no whole save is no root
        return !t.nodes[n.p];
      });
      if (!gone.length) break;
      for (const id of gone) { delete t.nodes[id]; dropped++; }
      bump();
    }
    if (dropped) {
      (KIT.log || console).warn(`[timeline] dropped ${dropped} moment(s) that could no longer be rebuilt`);
      delete t.b;
    }
    if (t.head && !t.nodes[t.head]) {
      // Stand at the newest thing that is still there rather than nowhere.
      const left = Object.keys(t.nodes).sort((a, b) => (t.nodes[b].at || 0) - (t.nodes[a].at || 0));
      t.head = left[0] || null;
    }
    return dropped;
  };
  /** now() -> the tree as it stands, without waiting. Empty until load(). */
  T.now = () => tree || (tree = blank());
  T.flush = async function () { try { return await KIT.storage.set(T.key(), T.now()); } catch (e) { return false; } };
  /** forgetAll() — throw the whole tree away. Only the player asks for this. */
  T.forgetAll = async function () { tree = blank(); built = null; bump(); return T.flush(); };
  T._setTree = (t) => {
    tree = t || blank();
    built = null;
    bump();
    // Measured HERE and not lazily on the first write. Lazily was the first
    // version and it was wrong by one node: the first `noteSize` after a reset
    // found no running total, measured the tree — which by then already held the
    // node being added — and then added that node's bytes on top. One anchor
    // double-counted, which at a 34KB save is 34KB of drift that never washes
    // out. The experiment's drift threshold is what caught it.
    tree.b = T.bytes();
    return tree;
  };

  T.node = (id) => T.now().nodes[id] || null;
  T.head = () => T.now().head;
  T.count = () => Object.keys(T.now().nodes).length;

  /**
   * Who hangs off whom, built once and held until the tree changes.
   *
   * `children(id)` on its own is a scan of every node, and three things here ask
   * it for every node in turn — pruning, drawing the list, and `elsewhere`. That
   * is a square, and `elsewhere` is a CONDITION: it runs inside a frame, on every
   * event page the world evaluates. At 200 moments the square was 0.9ms and
   * invisible; at the 1,500 the storage budget allows it would have been tens of
   * milliseconds of a 16.7ms frame. A cliff at exactly the point a long game
   * arrives at it.
   */
  let index = null;
  function bump() { index = null; }
  function kids() {
    if (index) return index;
    const m = new Map();
    const nodes = T.now().nodes;
    for (const id of Object.keys(nodes)) {
      const p = nodes[id].p;
      if (!p) continue;
      if (!m.has(p)) m.set(p, []);
      m.get(p).push(id);
    }
    for (const list of m.values()) list.sort((a, b) => (nodes[a].at || 0) - (nodes[b].at || 0));
    index = m;
    return m;
  }

  /** The chain of ids from the root down to this node. */
  T.path = function (id) {
    const out = [];
    const seen = new Set();
    let at = id;
    while (at && T.now().nodes[at] && !seen.has(at)) { seen.add(at); out.unshift(at); at = T.now().nodes[at].p; }
    return out;
  };
  /** children(id) -> the moments that grow out of this one, oldest first. */
  T.children = function (id) {
    if (!id) return Object.keys(T.now().nodes).filter((k) => !T.now().nodes[k].p)
      .sort((a, b) => (T.now().nodes[a].at || 0) - (T.now().nodes[b].at || 0));
    return (kids().get(id) || []).slice();
  };

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
    T.size();                       // the total exists before the node does
    t.nodes[id] = node;
    t.head = id;
    noteSize(costOf(id, node));
    bump();
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

  /** bytes() -> what the tree would really take, measured. For tools and tests. */
  T.bytes = () => sizeOf(T.now());

  /**
   * size() -> the same number, kept running.
   *
   * `bytes()` stringifies the whole tree, and `prune()` used to call it on every
   * save to find out whether it had anything to do. At 200 moments that was
   * nothing; at the 1,500 the budget allows it was **27.5ms of a 16.7ms frame**,
   * every time the game saved — a cliff at exactly the size a long playthrough
   * arrives at. So the total is carried instead: every node adds its own bytes
   * when it is recorded and gives them back when it is pruned, and the exact
   * measurement happens once, when the tree is read from the store.
   */
  T.size = function () {
    const t = T.now();
    if (typeof t.b !== 'number') t.b = T.bytes();
    return t.b;
  };
  function noteSize(delta) {
    const t = T.now();
    // `size()` is what establishes the total when there is not one yet, and it
    // is called BEFORE the change is applied by everything that calls this.
    t.b = Math.max(0, (typeof t.b === 'number' ? t.b : 0) + delta);
  }
  /** What one node costs in the store: itself, plus its key in the map. */
  const costOf = (id, node) => sizeOf(node) + String(id).length + 4;

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
    if (T.size() <= cap) return true;                   // the usual answer, for nothing
    // Passes, not removals: taking a dead end can turn its parent into one, so
    // the round is repeated — but the tree is walked once per round rather than
    // once per node taken, and nothing is stringified at all.
    for (let pass = 0; pass < 64; pass++) {
      if (T.size() <= cap) return true;
      const child = kids();
      const onPath = new Set(T.path(t.head));
      const leaves = Object.keys(t.nodes)
        .filter((id) => !child.has(id) && !onPath.has(id) && !t.nodes[id].keep && t.nodes[id].p)
        .sort((a, b) => (t.nodes[a].at || 0) - (t.nodes[b].at || 0));
      if (!leaves.length) return false;                 // everything left is load-bearing
      for (const id of leaves) {
        if (T.size() <= cap) break;
        noteSize(-costOf(id, t.nodes[id]));
        if (built && built.id === id) built = null;
        delete t.nodes[id];
      }
      bump();
    }
    return T.size() <= cap;
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
      if ((kids().get(id) || []).some((c) => !mine.has(c))) continue;   // only the tips of other branches
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
  /**
   * everywhere(query) -> the most any one line of this playthrough has done it.
   *
   * One pass, adding up as it goes. The obvious version asked `tallyAt` for
   * every tip, and each of those walks its whole line and builds the entire
   * ledger just to read one key out of it. Measured on a 1,500-moment tree with
   * 38 branch tips and 90 tally keys: **9.4ms that way, 0.60ms this way**, same
   * answer. This is a condition — it runs inside a frame — so that is more than
   * half a frame for one question. The same square hid in `elsewhere` in a
   * different shape, which is why it was worth looking twice.
   *
   * Nodes come in the order they were recorded, and a child is always recorded
   * after its parent, so a parent's running total is always ready. And because a
   * tally only grows along a chain, the largest total anywhere in the tree IS
   * the largest at some tip — no need to work out which nodes are tips.
   */
  T.everywhere = function (query) {
    const k = tallyKey(query);
    if (!k) return 0;
    const t = T.now();
    const ids = Object.keys(t.nodes).sort((a, b) => (t.nodes[a].at || 0) - (t.nodes[b].at || 0));
    const sum = Object.create(null);
    let most = 0;
    for (const id of ids) {
      const n = t.nodes[id];
      const before = n.p && sum[n.p] !== undefined ? sum[n.p] : 0;
      sum[id] = before + ((n.tk || {})[k] || 0);
      if (sum[id] > most) most = sum[id];
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
        branches: (kids().get(id) || []).length,
      });
      for (const c of (kids().get(id) || [])) walk(c, depth + 1);
    };
    for (const r of T.children(null)) walk(r, 0);
    return rows;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
