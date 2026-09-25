// dungeon/rules — the pure part of the Dungeon module.
//
// Nothing in this file touches the DOM, the registries or a live world. It is
// all "given this save and this map, what happens?", so Node can test it
// (test/modules/dungeon.test.js). register.js turns these answers into
// commands, conditions, object types and a system; scenes and panels sit on top.
//
// What the module owns:
//   save.modules.dungeon  { version, torch:{lit,radius}, blocks:{}, switches:{}, pushes }
//   project.packs.dungeon { darkness, ambient, torchRadius, ... }  (TUNING below)
//
// Everything else — whether a door has been opened, which page an object shows —
// stays in the engine's own state (save.objects[key].self), so the editor's
// `self.opened == true` conditions keep working without this module loaded.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const D = KIT.dungeon = KIT.dungeon || {};

  const isObj = KIT.isObject;
  const num = KIT.num;
  D.VERSION = 1;

  // ---- the save slice ----------------------------------------------------------
  /** defaults() -> a fresh dungeon save section. */
  D.defaults = function () {
    return { version: D.VERSION, torch: { lit: false, radius: 0 }, blocks: {}, switches: {}, pushes: 0 };
  };
  /** Save migrations, in the shape the manifest declares. Nothing to migrate yet. */
  D.migrations = [];

  /**
   * repair(data) -> the same object, with its shape put right. In place: whoever
   * is holding the section keeps holding the right one. The engine calls this
   * after filling and migrating (see `save` in manifest.js).
   */
  D.repair = function (data) {
    const base = D.defaults();
    data.version = D.VERSION;
    data.torch = isObj(data.torch) ? { lit: !!data.torch.lit, radius: num(data.torch.radius, 0) } : base.torch;
    data.blocks = isObj(data.blocks) ? data.blocks : {};
    data.switches = isObj(data.switches) ? data.switches : {};
    data.pushes = num(data.pushes, 0);
    return data;
  };

  /**
   * ensure(save) -> the module's own section of the save.
   * KIT.modules fills, migrates and repairs it from the declaration in
   * manifest.js, on a bare save too, so the module works with no world around
   * it. Never throws, never loses what is there.
   */
  D.ensure = function (save) {
    if (!isObj(save)) return D.repair(D.defaults());
    return KIT.modules.saveSection(save, 'dungeon');
  };

  // ---- the content slice (project.packs.dungeon) --------------------------------
  /** Every number the module turns, as schema fields — the Project panel forms itself from these. */
  D.TUNING = [
    { key: 'darkness', type: 'number', min: 0, max: 1, default: 0.88, label: 'Dark',
      doc: 'How dark a dungeon map is away from the lights. 0 is broad daylight.' },
    { key: 'ambient', type: 'color', default: '#05070d', label: 'Colour of the dark' },
    { key: 'torchRadius', type: 'number', min: 1, max: 20, default: 4, label: 'Torch reach',
      doc: 'How many tiles the lantern lights when it is lit.' },
    { key: 'torchColor', type: 'color', default: '#ffc887', label: 'Torch colour' },
    { key: 'torchFlicker', type: 'number', min: 0, max: 1, default: 0.35, label: 'Torch flicker' },
    { key: 'torchSoftness', type: 'number', min: 0, max: 0.95, default: 0.5, label: 'Torch edge' },
    { key: 'lightOnEnter', type: 'bool', default: true, label: 'Light it automatically',
      doc: 'Light the lantern the moment you walk into a dark map.' },
    { key: 'pushBlocks', type: 'bool', default: true, label: 'Push by walking',
      doc: 'Walk into a block to push it. Off means you have to press A while facing it.' },
    { key: 'pushSound', type: 'ref:sound', nullable: true, default: 'bump' },
    { key: 'lockedSound', type: 'ref:sound', nullable: true, default: 'bump' },
    { key: 'unlockSound', type: 'ref:sound', nullable: true, default: 'item' },
    { key: 'switchSound', type: 'ref:sound', nullable: true, default: 'select' },
    { key: 'gateSound', type: 'ref:sound', nullable: true, default: 'door' },
  ];
  /** contentDefaults() -> project.packs.dungeon when the author has not touched it. */
  D.contentDefaults = () => KIT.schema.defaults(D.TUNING);
  /** tuning(project) -> the pack, with every default filled in. */
  D.tuning = (project) => KIT.modules.pack(project, 'dungeon');

  // ---- keys and doors -------------------------------------------------------------
  /** hasKey(save, itemId, count) — is the key in the bag? A door with no key needs none. */
  D.hasKey = function (save, itemId, count) {
    if (!itemId) return true;
    const have = num((save && save.inventory && save.inventory[itemId]) || 0, 0);
    return have >= Math.max(1, num(count, 1));
  };
  /** isOpen(save, objectKey) — has this door already been opened? (engine `self` state) */
  D.isOpen = function (save, objectKey) {
    const st = save && save.objects && save.objects[objectKey];
    return !!(st && st.self && st.self.opened);
  };
  /**
   * tryOpen(save, objectKey, props) -> { ok, reason, key, count }
   * reason: 'already' | 'opened' | 'locked'. Pure — it decides, it does not write.
   */
  D.tryOpen = function (save, objectKey, props) {
    const p = isObj(props) ? props : {};
    if (D.isOpen(save, objectKey)) return { ok: true, reason: 'already', key: p.key || null, count: 0 };
    const need = Math.max(1, num(p.count, 1));
    if (!D.hasKey(save, p.key, need)) return { ok: false, reason: 'locked', key: p.key || null, count: need };
    return { ok: true, reason: 'opened', key: p.key || null, count: p.consume === false ? 0 : (p.key ? need : 0) };
  };

  // ---- pushable blocks --------------------------------------------------------------
  /** Where a block is right now: the pushed position if it has one, else where it was drawn. */
  D.blockAt = function (data, objectKey, home) {
    const at = data && data.blocks && data.blocks[objectKey];
    if (isObj(at) && Number.isFinite(at.x) && Number.isFinite(at.y)) return { x: at.x, y: at.y };
    return { x: num(home && home.x, 0), y: num(home && home.y, 0) };
  };
  D.setBlock = function (data, objectKey, x, y) {
    data.blocks = isObj(data.blocks) ? data.blocks : {};
    data.blocks[objectKey] = { x: num(x, 0), y: num(y, 0) };
    return data.blocks[objectKey];
  };
  /**
   * canPush(view, from, dir, opts) -> { ok, reason, to }
   * A block slides one tile if the tile behind it is in bounds, not solid, has no
   * ledge and nothing solid standing on it. `opts.ignore` is the block itself.
   * reason: 'ok' | 'direction' | 'edge' | 'tile' | 'ledge' | 'entity'.
   */
  D.canPush = function (view, from, dir, opts) {
    opts = opts || {};
    const known = KIT.DIRS || ['up', 'down', 'left', 'right'];
    const names = Array.isArray(known) ? known : Object.keys(known);
    if (!names.includes(dir)) return { ok: false, reason: 'direction', to: null };
    const d = KIT.delta(dir);
    const to = { x: num(from.x, 0) + d.dx, y: num(from.y, 0) + d.dy };
    if (!view.inBounds(to.x, to.y)) return { ok: false, reason: 'edge', to };
    const flags = view.flagsAt(to.x, to.y);
    if (flags.solid) return { ok: false, reason: 'tile', to };
    if (flags.ledge) return { ok: false, reason: 'ledge', to };
    for (const e of opts.blockers || []) {
      if (e === opts.ignore || !e.solid || e.through || e.visible === false) continue;
      if (e.x === to.x && e.y === to.y) return { ok: false, reason: 'entity', to };
    }
    return { ok: true, reason: 'ok', to };
  };

  // ---- switches and gates ------------------------------------------------------------
  /** switchOn(data, name) — is the named plate held down? */
  D.switchOn = function (data, name) { return !!(data && data.switches && data.switches[String(name || '')]); };
  D.setSwitch = function (data, name, on) {
    data.switches = isObj(data.switches) ? data.switches : {};
    const key = String(name || '');
    const before = !!data.switches[key];
    data.switches[key] = !!on;
    return before !== !!on;
  };
  /**
   * plateHeld(cell, standing) — a plate is down while something is standing on it.
   * `standing` is every entity and hero position; `holders` says what counts.
   */
  D.plateHeld = function (cell, standing, holders) {
    const want = holders || ['hero', 'block'];
    for (const s of standing || []) {
      if (s.x !== cell.x || s.y !== cell.y) continue;
      if (want.includes(s.kind)) return true;
    }
    return false;
  };
  /** gateOpen(data, needs, invert) — open when every named switch is on (or none are named). */
  D.gateOpen = function (data, needs, invert) {
    const list = Array.isArray(needs) ? needs.filter(Boolean)
      : (typeof needs === 'string' && needs.trim() ? needs.split(',').map(s => s.trim()).filter(Boolean) : []);
    const all = list.length === 0 ? false : list.every(n => D.switchOn(data, n));
    return invert ? !all : all;
  };
  /** switchNames(project) -> every switch name any map mentions, sorted (the panel and the validator use it). */
  D.switchNames = function (project) {
    const out = new Set();
    for (const map of Object.values((project && project.maps) || {})) {
      for (const obj of map.objects || []) {
        if (obj.type !== 'dungeon-switch') continue;
        for (const page of obj.pages || []) {
          const n = page.props && page.props.name;
          if (n) out.add(String(n));
        }
      }
    }
    return Array.from(out).sort();
  };

  // ---- the torch ----------------------------------------------------------------------
  /** torchLight(data, tuning) -> the light to hang on the hero, or null when it is out. */
  D.torchLight = function (data, tuning) {
    if (!data || !data.torch || !data.torch.lit) return null;
    const radius = num(data.torch.radius, 0) || num(tuning && tuning.torchRadius, 4);
    if (!(radius > 0)) return null;
    return {
      radius,
      color: (tuning && tuning.torchColor) || '#ffc887',
      flicker: num(tuning && tuning.torchFlicker, 0.35),
      softness: num(tuning && tuning.torchSoftness, 0.5),
    };
  };
  /** lightTorch(data, radius) / putOut(data) — the two things that can happen to a lantern. */
  D.lightTorch = function (data, radius) { data.torch = { lit: true, radius: Math.max(1, num(radius, 4)) }; return data.torch; };
  D.putOut = function (data) { data.torch = { lit: false, radius: 0 }; return data.torch; };
  /** isDark(map) — does this map carry a darkness of its own? */
  D.isDark = function (map) {
    const a = map && ((map.props && map.props.atmosphere) || map.atmosphere);
    return !!(a && num(a.darkness, 0) > 0.25);
  };

  // ---- a small report the panel and the tests read ---------------------------------------
  /** describe(project, save) -> { doors, blocks, switches, gates, open, held } — a count of the place. */
  D.describe = function (project, save) {
    const data = D.ensure(save || {});
    const out = { doors: 0, opened: 0, blocks: 0, moved: 0, switches: 0, held: 0, gates: 0, open: 0 };
    for (const map of Object.values((project && project.maps) || {})) {
      for (const obj of map.objects || []) {
        const key = map.id + ':' + obj.id;
        const props = (obj.pages && obj.pages[0] && obj.pages[0].props) || {};
        if (obj.type === 'dungeon-door') { out.doors++; if (D.isOpen(save, key)) out.opened++; }
        else if (obj.type === 'dungeon-block') { out.blocks++; if (data.blocks[key]) out.moved++; }
        else if (obj.type === 'dungeon-switch') { out.switches++; if (D.switchOn(data, props.name)) out.held++; }
        else if (obj.type === 'dungeon-gate') { out.gates++; if (D.gateOpen(data, props.needs, props.invert)) out.open++; }
      }
    }
    return out;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
