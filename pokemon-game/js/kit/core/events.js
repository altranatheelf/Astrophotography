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

  KIT.bus = KIT.bus || KIT.events('kit');

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
