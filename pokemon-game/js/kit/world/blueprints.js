// Blueprints — a whole game to start from.
//
// `presets` makes one object. A blueprint makes the entire project: the maps,
// the connections between them, the people standing in them, whatever the
// modules need in `packs`. It exists for one reason: on a phone, "start your
// own game" has to be one tap, and one tap has to leave you somewhere you can
// already walk around. A blank grid is not that.
//
//   KIT.blueprints.list()                 -> [{ id, label, describe, ... }] in order
//   KIT.blueprints.build('blank', opts)   -> { project, problems }
//   KIT.blueprints.titleFor(id)           -> what to call it when nobody said
//
// The engine ships exactly one, `blank`, because a blank map is the only game
// the engine can describe without knowing what kind of game it is. Everything
// else — a region with tall grass in it, a dungeon, a bullet hell — belongs to
// the module that knows the words (docs/decisions/0005).
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const B = KIT.blueprints = KIT.blueprints || {};
  const REG = () => KIT.registry('blueprints');

  /** list() -> every blueprint, lowest `order` first, then by label. */
  B.list = function () {
    const all = REG().list().slice();
    all.sort((a, b) => (a.order || 50) - (b.order || 50) || String(a.label || a.id).localeCompare(String(b.label || b.id)));
    return all;
  };
  /** get(id) -> the definition, or null. Never throws on a name nobody registered. */
  B.get = function (id) { try { return REG().get(String(id)) || null; } catch (e) { return null; } };
  /** titleFor(id) -> the title to use when the author has not typed one. */
  B.titleFor = function (id) { const d = B.get(id); return (d && d.defaultTitle) || 'New Adventure'; };

  /**
   * build(id, opts) -> { project, problems }
   * opts: { title, id, keepModules } — all optional; the blueprint's own
   * defaults fill in. The result is normalized, so it is a project the editor
   * and the game can both take as they are. A blueprint that throws is the
   * blueprint's bug, and it says so rather than leaving a half-made game behind.
   *
   * `keepModules` is the list the game being replaced had switched on. Starting
   * a new game is not the same as turning the engine off under somebody's feet:
   * whatever was loaded stays loaded, and the blueprint adds what it needs on
   * top. It lives here rather than at each door so the two doors cannot drift.
   */
  B.build = function (id, opts) {
    opts = opts || {};
    const def = B.get(id);
    if (!def || typeof def.build !== 'function') throw new Error(`no blueprint “${id}”`);
    const title = String(opts.title || def.defaultTitle || 'New Adventure').trim() || 'New Adventure';
    const slug = KIT.slug(opts.id || title) || 'new-adventure';
    const raw = def.build({ title, id: slug });
    if (!raw || typeof raw !== 'object') throw new Error(`blueprint “${id}” built nothing`);
    const keep = Array.isArray(opts.keepModules) ? opts.keepModules : [];
    const mine = Array.isArray(raw.modules) ? raw.modules : [];
    const all = [];
    for (const m of keep.concat(mine)) if (typeof m === 'string' && m && all.indexOf(m) < 0) all.push(m);
    raw.modules = all;
    return KIT.project.normalize(raw);
  };

  // ---- the one the engine ships ----------------------------------------------
  // Last on the list on purpose. The first item is the one a person lands on,
  // and "here is an empty grid, good luck" is the answer that sent them back to
  // RPG Maker; whatever a module offers has somewhere to walk in it.
  REG().add({
    id: 'blank', label: 'A blank map', order: 90,
    defaultTitle: 'New Adventure',
    describe: 'One empty map with your title on it. Everything else is yours to paint.',
    build: (o) => KIT.project.blank({ title: o.title, id: o.id }),
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
