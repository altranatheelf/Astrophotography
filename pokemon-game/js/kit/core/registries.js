// The kit's standard registries and the definition schema each one validates
// against. Modules add more with KIT.defineRegistry.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const S = KIT.schema;
  const base = [
    { key: 'id', type: 'string', min: 1, pattern: '^[a-z0-9][a-z0-9-_.:]*$', patternMessage: 'ids are lowercase letters, digits, - _ . :' },
  ];
  // `label` is type 'label', not 'string': a registry entry may compute its own
  // name from the Terms table — `(game) => KIT.strings.get(game.project, 'x')` —
  // so a module does not freeze one language into its code. Read one with
  // KIT.labelOf(def, ctx), never def.label.
  const named = base.concat([{ key: 'name', type: 'string', optional: true }, { key: 'label', type: 'label', optional: true }, { key: 'doc', type: 'text', optional: true }, { key: 'group', type: 'string', optional: true }]);

  KIT.defineRegistry('tiles', { fields: named.concat([
    { key: 'solid', type: 'bool', default: false }, { key: 'encounter', type: 'bool', default: false }, { key: 'bush', type: 'bool', default: false },
    { key: 'counter', type: 'bool', default: false }, { key: 'warpLook', type: 'bool', default: false }, { key: 'terrainTag', type: 'number', integer: true, default: 0 },
    { key: 'probability', type: 'number', min: 0, default: 1 }, { key: 'animMs', type: 'number', min: 50, default: 500 },
  ]), doc: 'Map tiles (16×16 by default). See ARCHITECTURE §6.2.' });
  KIT.registry('tiles').stamps = [];               // multi-tile brushes: { id, name, group, tiles:[[ids]] }
  KIT.defineRegistry('sprites', { fields: named, doc: 'Walking character sprites (frames down/up/left × 3).' });
  KIT.defineRegistry('faces', { fields: named, doc: 'Dialogue faces.' });
  KIT.defineRegistry('icons', { fields: named, doc: 'Small UI icons.' });
  KIT.defineRegistry('sounds', { fields: named.concat([{ key: 'kind', type: 'enum', options: ['synth', 'file'], default: 'synth' }]) });
  KIT.defineRegistry('music', { fields: named.concat([{ key: 'kind', type: 'enum', options: ['synth', 'file'], default: 'synth' }, { key: 'loop', type: 'bool', default: true }]) });
  KIT.defineRegistry('objectTypes', { fields: named.concat([
    { key: 'tags', type: 'list', of: { type: 'string' }, default: [] },
    { key: 'maxCount', type: 'number', integer: true, optional: true }, { key: 'limit', type: 'enum', options: ['moveLast', 'prevent'], default: 'prevent' },
    { key: 'toc', type: 'bool', default: false },
  ]), doc: 'Kinds of things placed on maps (npc, sign, item, warp, trigger, ...). `fields` is the page-props schema.' });
  KIT.defineRegistry('behaviours', { fields: named, doc: 'Autonomous movement kinds: { id, fields, update(entity, world, dt) }.' });
  KIT.defineRegistry('commands', { fields: named.concat([
    { key: 'mv', type: 'string', optional: true }, { key: 'blocking', type: 'bool', default: true }, { key: 'background', type: 'bool', default: true /* allowed on tick threads */ },
  ]), doc: 'Script commands: { id, label, group, fields, run(ctx, cmd), summary(cmd, ctx), text:{ toLine, fromLine } }.' });
  KIT.defineRegistry('conditions', { fields: named, doc: 'Condition kinds: { id, label, fields, test(cond, ctx) }.' });
  KIT.defineRegistry('itemKinds', { fields: named, doc: 'Item kinds: { id, label, fields (extra item props), use(ctx, item) }.' });
  // The default kind, registered beside the schema default that names it
  // (`project.items[].kind` is 'item'). Without this the kind check is silently
  // skipped while the registry is empty, and then the first module to register a
  // kind turns every plain keepsake in every project into a warning.
  KIT.registry('itemKinds').add({
    id: 'item', label: 'Keepsake', doc: 'Something you carry. Using it does nothing on its own.',
    fields: [], use() { return false; },
  });
  KIT.defineRegistry('systems', { fields: named.concat([{ key: 'order', type: 'number', default: 50 }]), doc: 'Per-tick systems: { id, order, update(world, dt), onMapEnter, onMapLeave }.' });
  KIT.defineRegistry('scenes', { fields: named, doc: 'Scene factories: { id, create(params) -> scene }.' });
  // What somebody SOUNDS like while their words appear. Undertale, OMORI, Animal
  // Crossing and Deltarune all do this and it is most of what gives a character a
  // voice without recording one. A speaker's is `cast[who].voice`; the say
  // command can override it; a project default covers everyone else.
  KIT.defineRegistry('voices', { fields: named.concat([
    { key: 'sound', type: 'ref:sound', nullable: true, default: 'blip', doc: 'The sound played as the letters appear. Empty is a silent speaker.' },
    { key: 'pitch', type: 'number', min: 0.2, max: 4, default: 1, doc: 'Lower is bigger and slower' },
    { key: 'jitter', type: 'number', min: 0, max: 1, default: 0.06, doc: 'How much the pitch wanders, so it is not a machine' },
    { key: 'everyChars', type: 'number', integer: true, min: 1, max: 12, default: 2, doc: 'One blip per this many letters' },
    { key: 'volume', type: 'number', min: 0, max: 1, default: 0.5 },
    { key: 'rate', type: 'number', min: 0.25, max: 4, default: 1, doc: 'How fast each blip plays' },
    { key: 'skipPunctuation', type: 'bool', default: true, doc: 'Spaces and commas stay silent' },
  ]), doc: 'A speaking voice: { id, sound, pitch, jitter, everyChars, volume, rate }.' });
  KIT.registry('voices').addAll([
    { id: 'default', name: 'Voice', sound: 'blip', pitch: 1, everyChars: 2 },
    { id: 'low', name: 'Low voice', sound: 'blip', pitch: 0.62, everyChars: 3, rate: 0.85 },
    { id: 'high', name: 'High voice', sound: 'blip', pitch: 1.7, everyChars: 2, rate: 1.15 },
    { id: 'soft', name: 'Soft voice', sound: 'blip', pitch: 1.15, everyChars: 3, volume: 0.3, jitter: 0.12 },
    { id: 'flat', name: 'Flat voice', sound: 'blip', pitch: 1, everyChars: 2, jitter: 0, volume: 0.4 },
    { id: 'none', name: 'Silent', sound: null, pitch: 1, everyChars: 12, volume: 0 },
  ]);
  KIT.defineRegistry('menus', { fields: named.concat([{ key: 'order', type: 'number', default: 50 }]), doc: 'Pause-menu entries: { id, label, icon, order, open(game) }.' });
  KIT.defineRegistry('editorPanels', { fields: named.concat([{ key: 'order', type: 'number', default: 50 }]), doc: 'Creator Mode side panels: { id, label, icon, order, mount(el, editor) }.' });
  KIT.defineRegistry('editorTools', { fields: named.concat([{ key: 'order', type: 'number', default: 50 }, { key: 'key', type: 'string', optional: true }]), doc: 'Map tools: { id, label, icon, key, begin/move/end(pointer, editor), preview(ctx, editor) }.' });
  KIT.defineRegistry('fieldEditors', { fields: base.concat([{ key: 'types', type: 'list', of: { type: 'string' }, default: [] }]), doc: 'Form widgets by field type: { id, types, mount(el, field, value, onChange, ctx) }.' });
  KIT.defineRegistry('validators', { fields: named, doc: 'Project validators: { id, run(project, ctx) -> problems[] }.' });
  KIT.defineRegistry('presets', { fields: named.concat([{ key: 'kind', type: 'enum', options: ['object', 'script', 'map'], default: 'object' }]), doc: 'Quick-create presets (Door, Sign, Item, Transfer pair, ...).' });
  KIT.defineRegistry('migrations', { fields: base.concat([{ key: 'target', type: 'enum', options: ['project', 'save'], default: 'project' }, { key: 'from', type: 'number', integer: true }, { key: 'to', type: 'number', integer: true }]), doc: '{ id, target, from, to, up(data) -> data }' });
  KIT.defineRegistry('strings', { fields: base.concat([{ key: 'default', type: 'string' }, { key: 'doc', type: 'text', optional: true }]), doc: 'System strings (Terms) with defaults; the project may override each.' });

  // Reference kinds backed by registries / project tables.
  S.registryRefKind('tile', 'tiles');
  S.registryRefKind('sprite', 'sprites');
  S.registryRefKind('face', 'faces');
  S.registryRefKind('icon', 'icons');
  S.registryRefKind('sound', 'sounds');
  S.registryRefKind('voice', 'voices');
  S.registryRefKind('music', 'music');
  S.registryRefKind('preset', 'presets');
  S.projectRefKind('map', 'maps');
  S.projectRefKind('item', 'items');
  S.projectRefKind('cast', 'cast');        // a person in the story
  S.projectRefKind('fact', 'facts');       // a thing that can be known
  S.projectRefKind('script', 'scripts');
  S.refKind('var', {  // undeclared vars are allowed (null = unknown); the validator warns separately
    has(id, ctx) { const p = ctx && ctx.project; if (!p || !p.vars) return null; return Object.prototype.hasOwnProperty.call(p.vars, id) ? true : null; },
    list(ctx) { const p = ctx && ctx.project; return p && p.vars ? Object.keys(p.vars).map(id => ({ id, label: p.vars[id].label || id })) : []; },
    label(id) { return id; },
  });
  S.refKind('fragment', {
    has(id, ctx) { const p = ctx && ctx.project; if (!p || !p.fragments) return null; return p.fragments.some(f => f.id === id); },
    list(ctx) { const p = ctx && ctx.project; return p && p.fragments ? p.fragments.map(f => ({ id: f.id, label: f.title || f.id })) : []; },
    label(id, ctx) { const p = ctx && ctx.project; const f = p && p.fragments && p.fragments.find(x => x.id === id); return f ? (f.title || id) : id; },
  });
  S.refKind('object', {  // ctx.map (current map) or ctx.project for any map
    has(id, ctx) {
      const p = ctx && ctx.project; const m = ctx && ctx.map;
      if (m && m.objects) return m.objects.some(o => o.id === id) ? true : (p ? Object.values(p.maps || {}).some(mm => (mm.objects || []).some(o => o.id === id)) : null);
      if (p) return Object.values(p.maps || {}).some(mm => (mm.objects || []).some(o => o.id === id));
      return null;
    },
    list(ctx) { const m = ctx && ctx.map; return m && m.objects ? m.objects.map(o => ({ id: o.id, label: o.name || o.id })) : []; },
    label(id, ctx) { const m = ctx && ctx.map; const o = m && m.objects && m.objects.find(x => x.id === id); return o ? (o.name || id) : id; },
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
