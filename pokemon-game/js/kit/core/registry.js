// Registries: the one extension mechanism. Kit, modules and content register
// definitions (tiles, commands, object types, panels, ...) by string id.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const registries = new Map();

  /**
   * defineRegistry(name, { fields, doc }) -> registry
   * `fields` is a schema (see schema.js) that every definition is validated against
   * (only when KIT.schema is loaded). Idempotent: defining twice returns the same registry.
   */
  KIT.defineRegistry = function (name, opts) {
    if (registries.has(name)) return registries.get(name);
    opts = opts || {};
    const items = new Map();
    const listeners = { add: [], remove: [] };
    const reg = {
      name, opts,
      add(def) {
        if (!def || typeof def.id !== 'string' || !def.id) throw new Error(`registry '${name}': a definition needs a string id`);
        if (opts.fields && KIT.schema) {
          def = KIT.schema.fill(opts.fields, def);
          const errs = KIT.schema.validate(opts.fields, def);
          if (errs.length) throw new Error(`registry '${name}': invalid '${def.id}': ` + errs.map(e => e.path.join('.') + ': ' + e.message).join('; '));
        }
        const existed = items.has(def.id);
        if (existed && !def.replace) (KIT.log || console).warn(`registry '${name}': replacing '${def.id}'`);
        items.set(def.id, def);
        for (const fn of listeners.add.slice()) fn(def, existed);
        return def;
      },
      addAll(list) { for (const d of list) reg.add(d); return reg; },
      get(id) { return items.get(id); },
      require(id) { const d = items.get(id); if (!d) throw new Error(`registry '${name}': unknown id '${id}'`); return d; },
      has(id) { return items.has(id); },
      list() { return Array.from(items.values()); },
      ids() { return Array.from(items.keys()); },
      size() { return items.size; },
      remove(id) {
        const d = items.get(id);
        if (!d) return false;
        items.delete(id);
        for (const fn of listeners.remove.slice()) fn(d);
        return true;
      },
      clear() { for (const id of Array.from(items.keys())) reg.remove(id); },
      on(event, fn) {
        if (!listeners[event]) throw new Error(`registry '${name}': unknown event '${event}'`);
        listeners[event].push(fn);
        return () => { const i = listeners[event].indexOf(fn); if (i >= 0) listeners[event].splice(i, 1); };
      },
      /** Grouped listing for palettes: [{ group, items }] in first-seen order of `groupKey`. */
      groups(groupKey) {
        const key = groupKey || 'group';
        const order = [], byGroup = new Map();
        for (const d of items.values()) {
          const g = d[key] == null ? 'other' : d[key];
          if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g); }
          byGroup.get(g).push(d);
        }
        return order.map(g => ({ group: g, items: byGroup.get(g) }));
      },
    };
    registries.set(name, reg);
    return reg;
  };

  /** registry(name) -> registry (throws if it was never defined). */
  KIT.registry = function (name) {
    const r = registries.get(name);
    if (!r) throw new Error(`unknown registry '${name}' (defined: ${Array.from(registries.keys()).join(', ') || 'none'})`);
    return r;
  };
  KIT.registry.exists = (name) => registries.has(name);
  KIT.registry.names = () => Array.from(registries.keys());
  KIT.reg = KIT.registry;

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
