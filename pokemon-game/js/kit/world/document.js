// The document: the project is edited ONLY through here. Every change is an
// operation with an inverse, so undo/redo, dirty tracking, autosave, live
// re-render and validation all hang off one door.
//
//   const doc = KIT.document(project)
//   doc.apply([{ op:'set', path:['maps','town','name'], value:'Town' }], { label:'Rename' })
//   doc.transaction('Paint', () => { doc.apply(...); doc.apply(...); })   // one undo step
//   doc.undo(); doc.redo(); doc.watch(['maps','town'], fn)
(function (root) {
  const KIT = root.KIT = root.KIT || {};

  const P = KIT.path = KIT.path || {};
  P.get = function (obj, path) {
    let cur = obj;
    for (const k of path) { if (cur === null || cur === undefined) return undefined; cur = cur[k]; }
    return cur;
  };
  P.has = function (obj, path) {
    if (!path.length) return true;
    const parent = P.get(obj, path.slice(0, -1));
    const k = path[path.length - 1];
    return parent !== null && parent !== undefined && typeof parent === 'object' && (Array.isArray(parent) ? k < parent.length : Object.prototype.hasOwnProperty.call(parent, k));
  };
  P.join = (path) => path.map(k => String(k)).join('/');
  P.parse = (s) => (s === '' ? [] : String(s).split('/').map(k => (/^\d+$/.test(k) ? Number(k) : k)));
  P.isPrefix = (prefix, path) => { if (prefix.length > path.length) return false; for (let i = 0; i < prefix.length; i++) if (prefix[i] !== path[i]) return false; return true; };
  P.related = (a, b) => P.isPrefix(a, b) || P.isPrefix(b, a);

  function ensureParent(rootObj, path) {
    // Creates missing intermediate OBJECTS (never arrays). Returns the parent container.
    let cur = rootObj;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      if (cur[k] === null || cur[k] === undefined || typeof cur[k] !== 'object') cur[k] = {};
      cur = cur[k];
    }
    return cur;
  }

  KIT.document = function document(initial) {
    let value = initial;
    const undoStack = [], redoStack = [];
    const watchers = [];
    let txDepth = 0, txOps = null, txInverse = null, txLabel = null;
    let dirty = false;
    let seq = 0;

    function applyOne(op) {
      // returns the inverse op
      const path = op.path;
      if (op.op === 'set') {
        if (path.length === 0) { const prev = value; value = op.value; return { op: 'set', path: [], value: prev }; }
        const parent = ensureParent(value, path);
        const k = path[path.length - 1];
        const existed = Array.isArray(parent) ? k < parent.length : Object.prototype.hasOwnProperty.call(parent, k);
        const prev = parent[k];
        parent[k] = op.value;
        return existed ? { op: 'set', path, value: prev } : { op: 'del', path };
      }
      if (op.op === 'del') {
        if (path.length === 0) throw new Error('document: cannot delete the root');
        const parent = P.get(value, path.slice(0, -1));
        const k = path[path.length - 1];
        if (parent === null || parent === undefined || typeof parent !== 'object') return null;
        if (Array.isArray(parent)) {
          if (k >= parent.length) return null;
          const removed = parent.splice(k, 1);
          return { op: 'splice', path: path.slice(0, -1), index: k, remove: 0, insert: removed };
        }
        if (!Object.prototype.hasOwnProperty.call(parent, k)) return null;
        const prev = parent[k];
        delete parent[k];
        return { op: 'set', path, value: prev };
      }
      if (op.op === 'splice') {
        const arr = P.get(value, path);
        if (!Array.isArray(arr)) throw new Error(`document: splice target is not an array at ${P.join(path)}`);
        const insert = op.insert || [];
        const removed = arr.splice(op.index, op.remove || 0, ...insert);
        return { op: 'splice', path, index: op.index, remove: insert.length, insert: removed };
      }
      throw new Error(`document: unknown op '${op.op}'`);
    }

    function notify(ops, inverse, label, kind) {
      if (!ops.length) return;
      const paths = ops.map(o => o.path);
      const change = { ops, inverse, label, kind, seq: ++seq, paths };
      for (const w of watchers.slice()) {
        if (w.prefix.length === 0 || paths.some(p => P.related(w.prefix, p))) {
          try { w.fn(change); } catch (e) { (KIT.log || console).error('[document] watcher threw', e); }
        }
      }
    }

    const doc = {
      get value() { return value; },
      get(path) { return P.get(value, path || []); },
      has(path) { return P.has(value, path); },
      get dirty() { return dirty; },
      /**
       * seq: how many changes this document has had, undo and redo included.
       * A panel that would otherwise rebuild an index over the whole project to
       * find out whether anything changed can compare this number instead.
       */
      get seq() { return seq; },
      markClean() { dirty = false; },
      get history() { return undoStack.map(e => e.label); },
      canUndo() { return undoStack.length > 0; },
      canRedo() { return redoStack.length > 0; },

      /** apply(ops, { label }) — ops are applied in order; returns the inverse ops (in reverse order). */
      apply(ops, o) {
        o = o || {};
        if (!Array.isArray(ops)) ops = [ops];
        const inverse = [];
        for (const op of ops) {
          if (!op || !Array.isArray(op.path)) throw new Error('document: op needs a path array');
          const inv = applyOne(op);
          if (inv) inverse.unshift(inv);
        }
        if (!inverse.length) return inverse;
        dirty = true;
        if (txDepth > 0) { txOps.push(...ops); txInverse.unshift(...inverse); }
        else { undoStack.push({ label: o.label || 'Edit', ops: ops.slice(), inverse: inverse.slice() }); redoStack.length = 0; }
        notify(ops, inverse, o.label || txLabel || 'Edit', 'apply');
        return inverse;
      },
      set(path, v, o) { return doc.apply([{ op: 'set', path, value: v }], o); },
      del(path, o) { return doc.apply([{ op: 'del', path }], o); },
      splice(path, index, remove, insert, o) { return doc.apply([{ op: 'splice', path, index, remove, insert: insert || [] }], o); },
      push(path, item, o) { const arr = P.get(value, path); return doc.splice(path, Array.isArray(arr) ? arr.length : 0, 0, [item], o); },

      /**
       * begin(label) / end() — an open transaction for work that spans events (a
       * pointer stroke painting tile by tile). Everything between them is ONE undo
       * step. Nested begins flatten into the outermost, like transaction().
       */
      begin(label) {
        if (txDepth === 0) { txOps = []; txInverse = []; txLabel = label || 'Edit'; }
        txDepth++;
        return doc;
      },
      end() {
        if (txDepth === 0) return doc;
        txDepth--;
        if (txDepth === 0) {
          if (txOps.length) { undoStack.push({ label: txLabel || 'Edit', ops: txOps, inverse: txInverse }); redoStack.length = 0; }
          txOps = txInverse = null; txLabel = null;
        }
        return doc;
      },

      /** Everything applied inside fn is ONE undo step. Nested transactions flatten into the outermost. Returns fn's result. */
      transaction(label, fn) {
        if (txDepth === 0) { txOps = []; txInverse = []; txLabel = label; }
        txDepth++;
        let result;
        try { result = fn(doc); }
        finally {
          txDepth--;
          if (txDepth === 0) {
            if (txOps.length) { undoStack.push({ label: txLabel || 'Edit', ops: txOps, inverse: txInverse }); redoStack.length = 0; }
            txOps = txInverse = null; txLabel = null;
          }
        }
        return result;
      },
      undo() {
        if (txDepth > 0) throw new Error('document: cannot undo inside a transaction');
        const entry = undoStack.pop();
        if (!entry) return false;
        const inv = [];
        for (const op of entry.inverse) { const i = applyOne(op); if (i) inv.unshift(i); }
        redoStack.push({ label: entry.label, ops: entry.inverse, inverse: inv });
        dirty = true;
        notify(entry.inverse, inv, entry.label, 'undo');
        return true;
      },
      redo() {
        if (txDepth > 0) throw new Error('document: cannot redo inside a transaction');
        const entry = redoStack.pop();
        if (!entry) return false;
        const inv = [];
        for (const op of entry.inverse) { const i = applyOne(op); if (i) inv.unshift(i); }
        undoStack.push({ label: entry.label, ops: entry.inverse, inverse: inv });
        dirty = true;
        notify(entry.inverse, inv, entry.label, 'redo');
        return true;
      },
      /** watch(prefixPath, fn) — fn({ ops, inverse, label, kind, seq, paths }) when anything at/under/above the prefix changes. Returns unsubscribe. */
      watch(prefix, fn) {
        const w = { prefix: prefix || [], fn };
        watchers.push(w);
        return () => { const i = watchers.indexOf(w); if (i >= 0) watchers.splice(i, 1); };
      },
      /** Replace the whole document (one undo step). */
      replace(next, o) { return doc.apply([{ op: 'set', path: [], value: next }], Object.assign({ label: 'Replace' }, o || {})); },
      clearHistory() { undoStack.length = 0; redoStack.length = 0; },
    };
    return doc;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
