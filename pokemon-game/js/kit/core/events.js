// Event bus. One per world (and one global KIT.bus for editor/game plumbing).
// Listeners are isolated: one throwing never stops the others.
(function (root) {
  const KIT = root.KIT = root.KIT || {};

  KIT.events = function events(name) {
    const listeners = new Map(); // event -> [{ fn, once }]
    const bus = {
      name: name || 'bus',
      on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, []);
        const entry = { fn, once: false };
        listeners.get(event).push(entry);
        return () => bus.off(event, fn);
      },
      once(event, fn) {
        const off = bus.on(event, (...args) => { off(); fn(...args); });
        return off;
      },
      off(event, fn) {
        const list = listeners.get(event);
        if (!list) return;
        const i = list.findIndex(e => e.fn === fn);
        if (i >= 0) list.splice(i, 1);
      },
      /** emit(event, payload) -> number of listeners called. '*' listeners get (event, payload). */
      emit(event, payload) {
        let n = 0;
        const run = (list, args) => {
          for (const entry of list.slice()) {
            try { entry.fn(...args); n++; }
            catch (err) { (KIT.log || console).error(`[events:${bus.name}] listener for '${event}' threw`, err); }
          }
        };
        if (listeners.has(event)) run(listeners.get(event), [payload]);
        if (listeners.has('*')) run(listeners.get('*'), [event, payload]);
        return n;
      },
      count(event) { return (listeners.get(event) || []).length; },
      clear() { listeners.clear(); },
    };
    return bus;
  };

  /**
   * The one global bus. NOTE THE DIFFERENCE, because it has bitten this repo:
   * `KIT.events(name)` MAKES a bus — a fresh one, every call, with no listeners
   * on it — and `KIT.bus` IS the shared one. Six call sites once read
   * `KIT.events('kit').emit(...)`, which builds an empty bus, emits into it, and
   * throws it away; every one of those events went nowhere and nothing said so.
   * `test/kit/events.test.js` now fails if that spelling comes back.
   */
  KIT.bus = KIT.bus || KIT.events('kit');

  /**
   * worldBus(save) -> the bus a thing that happened IN THE WORLD belongs on.
   *
   * A footstep, a line of history, a rule being eaten: those are events of one
   * run, and a run has its own bus, so a second world — a test, the editor's
   * preview, a save being inspected in a tool — does not hear the first one's.
   *
   * Pass the save it happened to and the answer is exact: the live world's bus
   * only if it is the live world's save. Something that happened to a save
   * nobody is playing goes to the global bus, where a tool can watch it and a
   * world cannot mistake it for its own.
   */
  KIT.worldBus = function (save) {
    const w = (KIT.game && KIT.game.world) || (KIT.world && KIT.world.live) || null;
    if (!w || !w.events) return KIT.bus;
    if (save !== undefined && w.save !== save) return KIT.bus;
    return w.events;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
