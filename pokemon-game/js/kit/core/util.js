// Small shared helpers. Everything here is pure and JSON-oriented.
(function (root) {
  const KIT = root.KIT = root.KIT || {};

  /** Deep clone of JSON-safe data (objects, arrays, primitives). */
  KIT.deepClone = function deepClone(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(deepClone);
    const out = {};
    for (const k of Object.keys(v)) out[k] = deepClone(v[k]);
    return out;
  };

  /** Structural equality for JSON-safe data. */
  KIT.deepEqual = function deepEqual(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a !== a && b !== b; // NaN
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) return false;
    return true;
  };

  /** JSON with sorted object keys (stable, git-friendly). `indent` as in JSON.stringify. */
  KIT.stableStringify = function (value, indent) {
    const sort = (v) => {
      if (v === null || typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.map(sort);
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sort(v[k]);
      return out;
    };
    return JSON.stringify(sort(value), null, indent);
  };

  let counter = 0;
  /** Short unique id with a prefix: 'obj-k3f9a'. Deterministic when KIT.uid.seed is set (tests). */
  KIT.uid = function (prefix) {
    counter++;
    const rand = KIT.uid.seed != null ? (KIT.uid.seed + counter).toString(36) : Math.random().toString(36).slice(2, 7);
    return `${prefix || 'id'}-${rand}${counter.toString(36)}`;
  };
  KIT.uid.seed = null;

  /** 'Mom's House!' -> 'moms-house' */
  KIT.slug = function (s) {
    return String(s || '').toLowerCase().normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '').replace(/['\u2019]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
  };

  KIT.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  KIT.isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
