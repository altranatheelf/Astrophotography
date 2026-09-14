// Deterministic randomness. Every random decision in the kit goes through one
// of these so tests and autotile bakes are reproducible.
(function (root) {
  const KIT = root.KIT = root.KIT || {};

  /** 32-bit mixing hash of any number of numbers/strings -> uint32. */
  KIT.hash = function hash() {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < arguments.length; i++) {
      const a = arguments[i];
      const s = typeof a === 'string' ? a : String(a);
      for (let j = 0; j < s.length; j++) {
        h ^= s.charCodeAt(j);
        h = Math.imul(h, 16777619) >>> 0;
      }
      h ^= 0x9e3779b9; h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
    }
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
    return h >>> 0;
  };

  /**
   * KIT.rng(seed) -> fn() in [0,1) with helpers:
   *   r.int(n) 0..n-1 | r.range(a,b) a..b inclusive | r.pick(arr) | r.chance(p) | r.weighted([{weight}]) -> index | r.shuffle(arr) (copy)
   * mulberry32; `seed` may be a number or string.
   */
  KIT.rng = function rng(seed) {
    let a = (typeof seed === 'number' ? seed : KIT.hash(seed == null ? 'seed' : seed)) >>> 0;
    const r = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.seed = seed;
    r.int = (n) => Math.floor(r() * n);
    r.range = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    r.chance = (p) => r() < p;
    r.weighted = (items, key) => {
      const k = key || 'weight';
      let total = 0;
      for (const it of items) total += Math.max(0, Number(it[k]) || 0);
      if (total <= 0) return -1;
      let x = r() * total;
      for (let i = 0; i < items.length; i++) { x -= Math.max(0, Number(items[i][k]) || 0); if (x < 0) return i; }
      return items.length - 1;
    };
    r.shuffle = (arr) => { const c = arr.slice(); for (let i = c.length - 1; i > 0; i--) { const j = r.int(i + 1); [c[i], c[j]] = [c[j], c[i]]; } return c; };
    r.fork = (label) => rng(KIT.hash(String(seed), a, label || ''));
    return r;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
