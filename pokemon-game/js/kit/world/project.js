// KIT.project — the project (world) format v3: schema, normalize (migrate +
// fill defaults), validate, helpers, export/import of content files.
// Contract: docs/ARCHITECTURE.md §5 (format), §4.2 (persistence), §3.2 (schema).
//
// Shapes (see the contract for the full picture):
// @typedef {{ version:3, meta:Meta, modules:string[], settings:Object, strings:Object<string,string>, heroes:Hero[], start:Start,
//             vars:Object<string,VarDecl>, items:Object<string,Item>, scripts:Object<string,Script>, fragments:Fragment[],
//             testStates:TestState[], autotiles:Object<string,AutotileSet>, terrains:Terrain[], world:World, maps:Object<string,Map>, packs:Object }} Project
// @typedef {{ id:string, title:string, subtitle:string, author:string, pitch:string, created:string }} Meta
// @typedef {{ id:string, name:string, sprite:string|null, recolor:Object }} Hero
// @typedef {{ map:string|null, x:number, y:number, dir:string }} Start
// @typedef {{ type:'number'|'bool'|'string', default:*, label:string, group:string }} VarDecl
// @typedef {{ kind:string, name:string, icon:string|null, desc:string, note:string, props:Object }} Item
// @typedef {{ label:string, trigger:'call'|'auto'|'parallel', when:Object|null, params:string[], body:Object[], note:string }} Script
// @typedef {{ id:string, name:string, width:number, height:number, kind:string, music:string|null, note:string,
//             layers:{ terrain:number[], ground:(string|null)[], deco:(string|null)[], above:(string|null)[], regions:number[] },
//             collision:(null|0|1|'n'|'s'|'e'|'w')[], objects:MapObject[], props:Object }} Map
// @typedef {{ id:string, name:string, type:string, x:number, y:number, note:string, pages:Page[] }} MapObject
// @typedef {{ when:Object|null, sprite:string|null, dir:string, layer:'same'|'below'|'above', through:boolean, dirFix:boolean, stepAnim:boolean,
//             visible:boolean, behaviour:Object, on:Object<string,Object[]>, once:boolean, needsBoth:boolean, props:Object }} Page
// @typedef {{ severity:'error'|'warn', code:string, message:string, where:{ map?:string, object?:string, page?:number, slot?:string, script?:string, path?:Array } }} Problem
// @typedef {{ map?:string, object?:string, page?:number, slot?:string, script?:string, path:Array }} Where
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const S = KIT.schema;
  const P = KIT.project = KIT.project || {};

  P.VERSION = 3;
  P.SLOTS = ['interact', 'step', 'touch', 'enter', 'tick', 'init'];
  P.LAYERS = ['terrain', 'ground', 'deco', 'above', 'regions'];
  P.GROUND_BY_KIND = { outdoor: 'grass', garden: 'grass', indoor: 'floor-wood', cave: 'cave-floor' };
  P.MAP_KINDS = ['outdoor', 'indoor', 'cave', 'garden'];
  const ID_PATTERN = '^[a-z0-9][a-z0-9-_.:]*$';
  const idField = (key) => ({ key: key || 'id', type: 'string', min: 1, pattern: ID_PATTERN, patternMessage: 'ids are lowercase letters, digits, - _ . :' });
  const titleCase = (s) => String(s || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // ---- field schemas (§5) --------------------------------------------------
  // Maps, objects, pages and slots are validated by dedicated code below (they
  // are big); everything else is a plain KIT.schema field list.
  const F = P.fields = {
    meta: [
      idField('id'), { key: 'title', type: 'string', default: 'Our Adventure', shown: true }, { key: 'subtitle', type: 'string', shown: true }, { key: 'author', type: 'string' },
      { key: 'pitch', type: 'text', translate: false, doc: 'Two sentences: who the hero is and what they want.' }, { key: 'created', type: 'string', optional: true },
    ],
    settings: [
      { key: 'tileSize', type: 'number', integer: true, min: 8, max: 64, default: 16 },
      { key: 'viewport', type: 'group', fields: [{ key: 'w', type: 'number', integer: true, min: 4, default: 16 }, { key: 'h', type: 'number', integer: true, min: 4, default: 12 }] },
      { key: 'textSpeed', type: 'enum', options: ['slow', 'normal', 'fast', 'instant'], default: 'normal' },
      { key: 'language', type: 'string', default: 'en', label: 'Written in',
        doc: 'The language the lines in this project are actually typed in. Translations sit beside it, keyed on these lines.' },
      { key: 'languageName', type: 'string', default: 'English', label: 'Called', doc: 'What to call that language in the menu.' },
      { key: 'voice', type: 'ref:voice', nullable: true, default: null, label: 'Everybody sounds like',
        doc: 'The voice for anyone with none of their own. Empty is the engine default.' },
      { key: 'zoom', type: 'enum', options: ['auto', 'small', 'normal', 'large'], default: 'auto' },
      { key: 'coop', type: 'group', fields: [{ key: 'enabled', type: 'bool', default: false }] },
      { key: 'palette', type: 'group', fields: [{ key: 'remap', type: 'strings' }, { key: 'tint', type: 'color', nullable: true, default: null }, { key: 'amount', type: 'number', min: 0, max: 1, default: 0 }] },
      { key: 'clock', type: 'group', fields: [
        { key: 'enabled', type: 'bool', default: false, label: 'Show time passing', doc: 'The running clock: in-game minutes while you play.' },
        { key: 'minutesPerStep', type: 'number', min: 0, default: 1, label: 'Minutes per step' },
        { key: 'minutesPerSecond', type: 'number', min: 0, default: 0, label: 'Minutes per second' },
        { key: 'awayMinutesPerRealMinute', type: 'number', min: 0, max: 1440, default: 0, label: 'Minutes gained per real minute away',
          doc: 'Time that passes between sessions. 0 means the world waits for you. The gap is reported either way (sessionResumed).' },
        { key: 'awayCapMinutes', type: 'number', min: 0, default: 4320, label: 'Most minutes a gap can add',
          doc: 'Three days by default: a month away does not skip the whole story.' },
        { key: 'stampEverySeconds', type: 'number', min: 1, max: 600, default: 20, label: 'Seconds between “still here” stamps',
          doc: 'How often the save records that you are playing, so the next gap is measured from the truth even after a crash.' },
      ] },
      { key: 'encounterRate', type: 'number', min: 0, max: 100, default: 12 },
    ],
    hero: [idField('id'), { key: 'name', type: 'string', default: 'Player', shown: true }, { key: 'sprite', type: 'ref:sprite' }, { key: 'recolor', type: 'strings' }],
    start: [{ key: 'map', type: 'ref:map' }, { key: 'x', type: 'number', integer: true, min: 0 }, { key: 'y', type: 'number', integer: true, min: 0 }, { key: 'dir', type: 'direction' }],
    var: [{ key: 'type', type: 'enum', options: ['number', 'bool', 'string'], default: 'number' }, { key: 'label', type: 'string' }, { key: 'group', type: 'string' }],
    // The cast: who is in this story, as people rather than as sprites on maps.
    // An NPC on a map may BE one of these (`object.props.who`), or may not be
    // anybody in particular; somebody in the cast need never appear on a map.
    person: [
      idField('id'), { key: 'name', type: 'string', default: '', shown: true },
      { key: 'pronouns', type: 'string', default: '', doc: 'they/them — for the {they:who} tags' },
      { key: 'sprite', type: 'ref:sprite' }, { key: 'face', type: 'ref:face' },
      { key: 'voice', type: 'ref:voice', nullable: true, default: null, doc: 'What they sound like while their words appear' },
      { key: 'group', type: 'string', doc: 'Family, the village, the other place…' },
      { key: 'met', type: 'bool', default: false, doc: 'Do we know them before the game starts?' },
      { key: 'knows', type: 'list', of: { type: 'ref:fact' }, default: [], label: 'Knows from the start' },
      { key: 'feels', type: 'numbers', default: {}, label: 'Feels about', doc: 'castId → −100..100' },
      { key: 'tags', type: 'list', of: { type: 'string' }, default: [] },
      { key: 'note', type: 'note' },
    ],
    // A fact is a thing that can be KNOWN. Declaring one is optional — telling
    // somebody an undeclared fact works — but a declared one has a label the
    // editor can show you, which is the difference between a cast and a pile of
    // switches.
    fact: [
      idField('id'), { key: 'label', type: 'string', default: '' },
      { key: 'secret', type: 'bool', default: false, doc: 'Hide the label in panels that a player might see' },
      { key: 'group', type: 'string' }, { key: 'note', type: 'note' },
    ],
    asset: [
      { key: 'kind', type: 'enum', options: ['image'], default: 'image' },
      { key: 'src', type: 'string', default: '', doc: 'A path next to the page, or a data: URI' },
      { key: 'w', type: 'number', integer: true, min: 0, default: 0 }, { key: 'h', type: 'number', integer: true, min: 0, default: 0 },
      { key: 'from', type: 'string', optional: true, doc: 'The tool and file it came from' }, { key: 'note', type: 'note', optional: true },
    ],
    // A rule of the world, as a thing rather than as engine code. `when` is an
    // event, `if` is the same condition an event page uses, `do` is the same
    // command list — so an author who can write a page can write a rule.
    rule: [
      idField('id'), { key: 'name', type: 'string', default: '', shown: true },
      { key: 'when', type: 'string', min: 1, default: 'step', label: 'Happens on',
        doc: 'An event: step, mapEnter, mapLeave, bump, interactMissed, dimensionChanged, logged, clockTick…' },
      { key: 'if', type: 'condition', label: 'Only when' },
      { key: 'do', type: 'script', default: [], label: 'Then' },
      { key: 'on', type: 'bool', default: true, label: 'In force' },
      { key: 'priority', type: 'number', integer: true, default: 0,
        doc: 'Higher goes first when two rules answer the same event.' },
      { key: 'edible', type: 'bool', default: true, label: 'Can be eaten',
        doc: 'Whether the story is allowed to take this rule out of the world.' },
      { key: 'carrier', type: 'string', default: '', label: 'Carried by',
        doc: 'An object id. Destroying it takes the rule with it.' },
      { key: 'scope', type: 'group', fields: [
        { key: 'maps', type: 'list', of: { type: 'ref:map' }, default: [] },
        { key: 'layers', type: 'list', of: { type: 'string' }, default: [] },
      ] },
      { key: 'note', type: 'note' },
    ],
    item: [{ key: 'kind', type: 'string', default: 'item' }, { key: 'name', type: 'string', shown: true }, { key: 'icon', type: 'ref:icon' }, { key: 'desc', type: 'text' }, { key: 'note', type: 'note' }],
    script: [
      { key: 'label', type: 'string' }, { key: 'trigger', type: 'enum', options: ['call', 'auto', 'parallel'], default: 'call' }, { key: 'when', type: 'condition' },
      { key: 'params', type: 'list', of: { type: 'string' } }, { key: 'body', type: 'script' }, { key: 'note', type: 'note' },
    ],
    fragment: [idField('id'), { key: 'kind', type: 'enum', options: ['note', 'dialogue', 'audio', 'image', 'map-idea'], default: 'note' }, { key: 'title', type: 'string' }, { key: 'body', type: 'text' }, { key: 'tags', type: 'list', of: { type: 'string' } }, { key: 'folder', type: 'string' }],
    testState: [idField('id'), { key: 'label', type: 'string' }, { key: 'map', type: 'ref:map' }, { key: 'x', type: 'number', integer: true, min: 0 }, { key: 'y', type: 'number', integer: true, min: 0 }, { key: 'dir', type: 'direction' }],
    terrain: [{ key: 'id', type: 'number', integer: true, min: 1 }, { key: 'name', type: 'string' }, { key: 'color', type: 'color', default: '#58b848' }, { key: 'base', type: 'tile', nullable: true, default: null }],
    worldMap: [{ key: 'x', type: 'number', default: 0 }, { key: 'y', type: 'number', default: 0 }, { key: 'folder', type: 'string' }],
    connection: [{ key: 'a', type: 'ref:map', nullable: false }, { key: 'side', type: 'enum', options: ['n', 's', 'e', 'w'], default: 's' }, { key: 'b', type: 'ref:map', nullable: false }, { key: 'offset', type: 'number', integer: true, default: 0 }],
    map: [
      idField('id'), { key: 'name', type: 'string', shown: true }, { key: 'width', type: 'number', integer: true, min: 1, max: 512, default: 20 }, { key: 'height', type: 'number', integer: true, min: 1, max: 512, default: 15 },
      { key: 'kind', type: 'string', default: 'outdoor' }, { key: 'music', type: 'ref:music' }, { key: 'note', type: 'note' },
    ],
    object: [idField('id'), { key: 'name', type: 'string' }, { key: 'type', type: 'string', default: 'npc' }, { key: 'x', type: 'number', integer: true, min: 0 }, { key: 'y', type: 'number', integer: true, min: 0 }, { key: 'note', type: 'note' }],
    page: [
      { key: 'when', type: 'condition', doc: 'The LAST page whose condition passes is the active one.' }, { key: 'sprite', type: 'ref:sprite' }, { key: 'dir', type: 'direction' },
      { key: 'layer', type: 'enum', options: ['same', 'below', 'above'], default: 'same' }, { key: 'through', type: 'bool' }, { key: 'dirFix', type: 'bool' }, { key: 'stepAnim', type: 'bool' },
      { key: 'visible', type: 'bool', default: true }, { key: 'once', type: 'bool', doc: 'Sugar for self.done on interact/step/touch.' }, { key: 'needsBoth', type: 'bool' },
    ],
    behaviour: [
      // From the registry, not a list written here: the `behaviours` system looks
      // each kind up there, so a module that registers `pace` can put
      // `behaviour: { kind: 'pace' }` on a page and have it validate and appear
      // in the dropdown. The kit's own five are registered in systems/index.js.
      { key: 'kind', type: 'enum', optionsFrom: 'behaviours', default: 'none' }, { key: 'radius', type: 'number', integer: true, min: 0, max: 50, default: 3, display: 'radius', when: { field: 'kind', eq: 'wander' } },
      { key: 'speed', type: 'number', min: 0.1, max: 20, default: 1 }, { key: 'frequency', type: 'number', min: 0, max: 10, default: 2 }, { key: 'route', type: 'route', when: { field: 'kind', eq: 'route' } }, { key: 'repeat', type: 'bool', default: true },
    ],
    autotileGroup: [idField('id'), { key: 'name', type: 'string' }, { key: 'active', type: 'bool', default: true }, { key: 'terrain', type: 'number', integer: true, default: 0 }, { key: 'layer', type: 'enum', options: ['ground', 'deco'], default: 'ground' }],
    autotileRule: [
      { key: 'size', type: 'number', integer: true, min: 1, max: 7, default: 3 }, { key: 'pattern', type: 'list', of: { type: 'number', integer: true } }, { key: 'tiles', type: 'list', of: { type: 'tile' } },
      { key: 'tilesX', type: 'list', of: { type: 'tile' }, optional: true }, { key: 'tilesY', type: 'list', of: { type: 'tile' }, optional: true }, { key: 'tilesXY', type: 'list', of: { type: 'tile' }, optional: true },
      { key: 'mode', type: 'enum', options: ['single', 'stamp'], default: 'single' }, { key: 'chance', type: 'number', min: 0, max: 1, default: 1 }, { key: 'breakOnMatch', type: 'bool', default: true },
      { key: 'flip', type: 'enum', options: ['none', 'x', 'y', 'xy'], default: 'none' }, { key: 'outOfBounds', type: 'number', integer: true, nullable: true, default: null },
      { key: 'modulo', type: 'group', fields: [{ key: 'x', type: 'number', integer: true, min: 1, default: 1 }, { key: 'y', type: 'number', integer: true, min: 1, default: 1 }, { key: 'ox', type: 'number', integer: true, default: 0 }, { key: 'oy', type: 'number', integer: true, default: 0 }] },
      { key: 'layer', type: 'enum', options: ['ground', 'deco'], optional: true }, { key: 'active', type: 'bool', default: true }, { key: 'note', type: 'note' },
    ],
  };

  // ---- kit strings (Terms) ---------------------------------------------------
  KIT.registry('strings').addAll([
    { id: 'got-item', default: 'Got {count} {item}!' }, { id: 'lost-item', default: 'Lost {count} {item}.' },
    { id: 'save-prompt', default: 'Save your progress?' }, { id: 'saved', default: 'Saved.' },
    { id: 'new-game', default: 'New Game' }, { id: 'continue', default: 'Continue' }, { id: 'settings', default: 'Settings' },
    { id: 'yes', default: 'Yes' }, { id: 'no', default: 'No' }, { id: 'cancel', default: 'Cancel' }, { id: 'ok', default: 'OK' },
    { id: 'name-prompt', default: 'What is your name?' }, { id: 'bag', default: 'Bag' }, { id: 'save', default: 'Save' }, { id: 'quit', default: 'Quit to title' },
    { id: 'empty-bag', default: 'Your bag is empty.' }, { id: 'the-end', default: 'The End' },
    // The engine's own words. These were English literals sitting in menu.js,
    // which meant a fully translated game still had an English pause menu —
    // extraction is Terms-driven, so a literal is a line nobody can ever reach.
    { id: 'language', default: 'Language' }, { id: 'text-speed', default: 'Text speed' },
    { id: 'zoom', default: 'Zoom' }, { id: 'sound', default: 'Sound' }, { id: 'music', default: 'Music' },
    { id: 'motion', default: 'Motion' }, { id: 'back', default: 'Back' },
    { id: 'keep-playing', default: 'Keep playing' }, { id: 'two-players', default: 'Two players' },
    { id: 'creator-mode', default: 'Creator Mode' }, { id: 'autosave', default: 'Autosave' },
    { id: 'slot', default: 'Slot {n}' }, { id: 'empty-slot', default: 'empty' },
    { id: 'on', default: 'on' }, { id: 'off', default: 'off' },
    { id: 'speed-slow', default: 'slow' }, { id: 'speed-normal', default: 'normal' },
    { id: 'speed-fast', default: 'fast' }, { id: 'speed-instant', default: 'instant' },
    { id: 'motion-reduced', default: 'reduced' }, { id: 'motion-normal', default: 'normal' },
    { id: 'save-failed', default: 'Could not save.' },
    { id: 'sound-volume', default: 'Sound volume' }, { id: 'music-volume', default: 'Music volume' },
    { id: 'went-wrong', default: 'Something went wrong there.' },
    { id: 'save-moved', default: 'That place is gone. Starting you somewhere else.' },
  ]);

  // ---- basic object types (§5) ----------------------------------------------
  // `fields` = page props schema, `page` = page defaults for the type, `look` = what the editor draws.
  KIT.registry('objectTypes').addAll([
    { id: 'npc', name: 'NPC', doc: 'A character with a sprite that talks or moves.', tags: ['character'], icon: 'npc', toc: true, fields: [], page: {}, look: { sprite: true } },
    { id: 'sign', name: 'Sign', doc: 'A tile you can read (interact while facing it).', tags: ['furniture'], icon: 'sign', fields: [
      { key: 'look', type: 'tile', default: 'sign', doc: 'The tile drawn at the sign' },
    ], page: { layer: 'same' }, look: { tile: 'look' } },
    { id: 'item', name: 'Item on ground', doc: 'Step on it to pick it up (once).', tags: ['pickup'], icon: 'bag', fields: [
      { key: 'item', type: 'ref:item', nullable: false }, { key: 'count', type: 'number', integer: true, min: 1, default: 1 },
      { key: 'look', type: 'tile', nullable: true, default: null, doc: 'The tile drawn where the item lies (blank = the item icon)' },
    ], page: { layer: 'below', through: true, once: true }, look: { tile: 'look' } },
    { id: 'warp', name: 'Door / Warp', doc: 'Stepping here transfers the hero.', tags: ['door'], icon: 'door', fields: [
      { key: 'to', type: 'position', display: 'link', default: { map: null, x: 0, y: 0 }, doc: 'Where it leads (a tile on any map)' },
      { key: 'dir', type: 'direction', default: 'down', doc: 'Facing after arriving' },
      { key: 'look', type: 'tile', nullable: true, default: null, doc: 'Optional tile drawn here (door, mat, stairs)' },
      { key: 'sound', type: 'ref:sound', default: null }, { key: 'fade', type: 'bool', default: true },
    ], page: { layer: 'below', through: true }, look: { tile: 'look' } },
    { id: 'trigger', name: 'Trigger', doc: 'Invisible; runs its script on step or enter.', tags: ['logic'], icon: 'flag', fields: [], page: { layer: 'below', through: true, visible: false }, look: {} },
  ]);

  // ---- presets (quick-create) -----------------------------------------------
  // Data-only templates interpreted by KIT.project.buildPreset(preset, ctx):
  //   fields   what the author is asked for (a schema)
  //   objects  templates; `at:'here'` places at the cursor, `at:'<field>'` at a position field;
  //            string values '$<field>' are replaced by the input, '$here' by { map, x, y } of the cursor.
  KIT.registry('presets').addAll([
    { id: 'door', name: 'Door', kind: 'object', group: 'Objects', icon: 'door', doc: 'A warp on a door tile, with a door sound.',
      fields: [{ key: 'to', type: 'position', display: 'link' }, { key: 'look', type: 'tile', default: 'door' }, { key: 'sound', type: 'ref:sound', default: 'door' }],
      objects: [{ at: 'here', type: 'warp', name: 'Door', pages: [{ props: { to: '$to', look: '$look', sound: '$sound' } }] }] },
    { id: 'sign', name: 'Sign', kind: 'object', group: 'Objects', icon: 'sign', doc: 'A readable sign.',
      fields: [{ key: 'text', type: 'text', default: '' }, { key: 'look', type: 'tile', default: 'sign' }],
      objects: [{ at: 'here', type: 'sign', name: 'Sign', pages: [{ props: { look: '$look' }, on: { interact: [{ t: 'say', text: '$text' }] } }] }] },
    { id: 'item', name: 'Item on ground', kind: 'object', group: 'Objects', icon: 'bag', doc: 'An item to pick up once.',
      fields: [{ key: 'item', type: 'ref:item', nullable: false }, { key: 'count', type: 'number', integer: true, min: 1, default: 1 }, { key: 'look', type: 'tile', nullable: true, default: null }],
      objects: [{ at: 'here', type: 'item', name: 'Item', pages: [{ props: { item: '$item', count: '$count', look: '$look' } }] }] },
    { id: 'transfer-pair', name: 'Transfer pair', kind: 'object', group: 'Objects', icon: 'door', doc: 'Two warps that lead to each other (here and there).',
      fields: [{ key: 'to', type: 'position', display: 'link' }, { key: 'sound', type: 'ref:sound', default: null }],
      objects: [
        { at: 'here', type: 'warp', name: 'Warp', pages: [{ props: { to: '$to', sound: '$sound' } }] },
        { at: 'to', type: 'warp', name: 'Warp', pages: [{ props: { to: '$here', sound: '$sound' } }] },
      ] },
    { id: 'npc', name: 'NPC', kind: 'object', group: 'Objects', icon: 'npc', doc: 'A character who says one line.',
      fields: [{ key: 'name', type: 'string', default: 'Someone' }, { key: 'sprite', type: 'ref:sprite' }, { key: 'text', type: 'text', default: 'Hello!' }],
      objects: [{ at: 'here', type: 'npc', name: '$name', pages: [{ sprite: '$sprite', behaviour: { kind: 'look' }, on: { interact: [{ t: 'say', who: '$name', text: '$text' }] } }] }] },
  ]);

  // ---- migration: the older flat shape (v1/v2) -> v3 --------------------------
  // Old shape (previous contract §5): { version:1|2, title, subtitle, author, heroes, start, intro:[cmds], items, settings:{ encounterRate,
  //   catchDifficulty, followers, coop, textSpeed }, garden, mapOrder, maps:{ id:{ ..., layers:{ ground, deco, above }, collision, encounters, objects } } }
  // Old object: { id, type, x, y, sprite, dir, move, path, name, trigger, once, needsBoth, condition, hiddenByFlag, event, look, item, count, to, sound, mon, wild }
  const OLD_OPS = { set: 'set', add: 'add' };
  function oldCondition(c) {
    if (!c || typeof c !== 'object') return null;
    if (c.kind) return c;
    if ('flag' in c) return { kind: 'var', name: c.flag, op: '==', value: c.is !== false };
    if ('var' in c) return { kind: 'var', name: c.var, op: c.op || '==', value: c.value };
    if ('item' in c) return { kind: 'item', id: c.item, op: '>=', count: c.count == null ? 1 : c.count };
    if ('has' in c) return { kind: 'has', id: c.has };
    if ('dexCount' in c) return { kind: 'dexCount', op: c.op || '>=', value: c.dexCount };
    if ('self' in c) return { kind: 'self', key: c.self, op: '==', value: c.is !== false };
    return null;
  }
  function oldCommands(list) {
    if (!Array.isArray(list)) return [];
    return list.map(oldCommand).filter(Boolean);
  }
  function oldCommand(c) {
    if (!c || typeof c !== 'object' || typeof c.t !== 'string') return c;
    const rest = (keys) => { const o = {}; for (const k of Object.keys(c)) if (!keys.includes(k) && k !== 't') o[k] = c[k]; return o; };
    switch (c.t) {
      case 'set': return { t: 'setVar', name: c.flag, op: 'set', value: c.value !== false };
      case 'var': return { t: 'setVar', name: c.name, op: OLD_OPS[c.op] || c.op || 'set', value: c.value };
      case 'if': return { t: 'if', when: oldCondition(rest(['then', 'else'])), then: oldCommands(c.then), else: oldCommands(c.else) };
      case 'choice': return { t: 'choice', prompt: c.prompt || '', options: (c.options || []).map(o => ({ text: o.text || '', then: oldCommands(o.then) })) };
      case 'warp': return { t: 'transfer', map: c.map, x: c.x, y: c.y, dir: c.dir || 'down', fade: c.fade !== false };
      case 'move': return { t: 'moveRoute', target: c.target || 'self', steps: (c.path || []).slice(), wait: c.wait !== false };
      case 'face': return { t: 'moveRoute', target: c.target || 'self', steps: [c.dir === 'player' ? 'faceHero' : `face:${c.dir || 'down'}`], wait: true };
      case 'sound': return { t: 'sound', id: c.name };
      case 'music': return { t: 'music', id: c.name == null ? null : c.name };
      case 'fade': return { t: c.to === 'in' ? 'fadeIn' : 'fadeOut' };
      case 'hide': return { t: 'erase', target: c.target, persistent: true };
      case 'end': return { t: 'exit' };
      default: return c;
    }
  }
  const OLD_MOVE = { none: 'none', wander: 'wander', look: 'look', path: 'route' };
  const OLD_TRIGGER = { interact: 'interact', step: 'step', auto: 'enter', touch: 'touch' };
  function oldObject(o) {
    if (o && Array.isArray(o.pages)) return o;   // already v3-shaped
    const type = o.type || 'npc';
    const conds = [];
    const c = oldCondition(o.condition); if (c) conds.push(c);
    if (o.hiddenByFlag) conds.push({ kind: 'var', name: o.hiddenByFlag, op: '==', value: false });
    const when = conds.length === 0 ? null : conds.length === 1 ? conds[0] : { kind: 'all', of: conds };
    const props = {};
    if (type === 'sign') props.look = o.look || 'sign';
    else if (type === 'item') { props.item = o.item || null; props.count = o.count == null ? 1 : o.count; props.look = o.look || null; }
    else if (type === 'warp') { props.to = o.to ? { map: o.to.map, x: o.to.x | 0, y: o.to.y | 0 } : { map: null, x: 0, y: 0 }; props.dir = (o.to && o.to.dir) || 'down'; props.look = o.look || null; props.sound = o.sound || null; }
    else if (type === 'pokemon') { props.mon = o.mon || null; props.wild = o.wild !== false; props.shiny = !!o.shiny; }
    const on = {};
    const body = oldCommands(o.event);
    const slot = OLD_TRIGGER[o.trigger] || (type === 'warp' || type === 'item' || type === 'trigger' ? 'step' : 'interact');
    if (body.length) on[slot] = body;
    const page = { when, sprite: o.sprite || null, dir: o.dir || 'down', behaviour: { kind: OLD_MOVE[o.move] || 'none', route: Array.isArray(o.path) ? o.path.slice() : [] }, on, once: !!o.once, needsBoth: !!o.needsBoth, props };
    return { id: o.id, name: o.name || '', type, x: o.x | 0, y: o.y | 0, note: '', pages: [page] };
  }
  function migrate2to3(old) {
    const p = KIT.deepClone(old || {});
    const out = {
      version: 3,
      // A v2 project is flat, but a file that has been through somebody's hands may
      // carry a `meta` as well; prefer whatever is actually there.
      meta: (() => {
        const m = isObj(p.meta) ? p.meta : {};
        const title = m.title || p.title || 'Our Adventure';
        return {
          id: m.id || p.id || KIT.slug(title), title,
          subtitle: m.subtitle || p.subtitle || '', author: m.author || p.author || '', pitch: m.pitch || p.pitch || '',
        };
      })(),
      modules: [], settings: {}, strings: p.strings || {}, heroes: [], start: p.start || {}, vars: p.vars || {}, items: {}, scripts: {},
      fragments: [], testStates: [], autotiles: {}, terrains: [], world: { maps: {}, connections: [] }, maps: {}, packs: {}, rules: {},
    };
    const s = p.settings || {};
    out.settings = { textSpeed: s.textSpeed || 'normal', coop: { enabled: !!s.coop }, encounterRate: s.encounterRate == null ? 12 : s.encounterRate };
    out.heroes = (p.heroes || []).map((h, i) => ({ id: h.id || `p${i + 1}`, name: h.name || `Player ${i + 1}`, sprite: h.sprite || null, recolor: h.recolor || {} }));
    for (const id of Object.keys(p.items || {})) { const it = p.items[id]; out.items[id] = { kind: it.kind || 'item', name: it.name || titleCase(id), icon: it.icon || null, desc: it.desc || '', note: '', props: {} }; }
    if (Array.isArray(p.intro) && p.intro.length) {
      out.vars.introDone = { type: 'bool', default: false, label: 'Intro done', group: 'Story' };
      out.scripts.intro = { label: 'Intro', trigger: 'auto', when: { kind: 'var', name: 'introDone', op: '==', value: false }, params: [], body: oldCommands(p.intro).concat([{ t: 'setVar', name: 'introDone', op: 'set', value: true }]), note: 'Migrated from the old intro list.' };
    }
    let mons = !!p.garden;
    const encounters = {};
    const order = Array.isArray(p.mapOrder) && p.mapOrder.length ? p.mapOrder.filter(id => p.maps && p.maps[id]) : Object.keys(p.maps || {});
    for (const id of Object.keys(p.maps || {})) if (!order.includes(id)) order.push(id);
    let wx = 0;
    for (const id of order) {
      const m = p.maps[id];
      const layers = m.layers || {};
      const map = { id, name: m.name || titleCase(id), width: m.width | 0, height: m.height | 0, kind: m.kind || 'outdoor', music: m.music || null, note: '',
        layers: { terrain: [], ground: layers.ground || [], deco: layers.deco || [], above: layers.above || [], regions: [] }, collision: m.collision || [], objects: (m.objects || []).map(oldObject), props: {} };
      if (m.encounters && Array.isArray(m.encounters.table) && m.encounters.table.length) { encounters[id] = m.encounters; mons = true; }
      if (map.objects.some(o => o.type === 'pokemon')) mons = true;
      out.maps[id] = map;
      out.world.maps[id] = { x: wx, y: 0, folder: '' };
      wx += (m.width | 0) + 4;
    }
    if (mons) {
      out.modules.push('mons');
      out.packs.mons = { garden: p.garden || null, catchDifficulty: s.catchDifficulty || 'normal', followers: s.followers !== false, encounters };
    }
    return out;
  }
  KIT.registry('migrations').add({ id: 'project-2-to-3', target: 'project', from: 2, to: 3, doc: 'Flat v1/v2 project (objects with event/trigger/condition) -> v3 pages/slots/terrain.', up: migrate2to3 });

  /** migrate(project) -> { project, applied:[migration ids], problems }. Runs the 'migrations' chain up to P.VERSION. */
  P.migrate = function (project) {
    let p = project || {};
    const problems = [], applied = [];
    let v = Number(p.version);
    // No version number: guess from the shape. v2 was flat (`title`, `id` at the
    // top); v3 put them in `meta`. A hand-written or hand-edited file is common
    // enough — it is what the portable game file looks like — that guessing wrong
    // and quietly running a migration over it would lose the author's title.
    if (!Number.isFinite(v)) v = isObj(p.meta) ? P.VERSION : 2;
    if (v < 2) v = 2;
    const reg = KIT.registry('migrations');
    let guard = 0;
    while (v < P.VERSION && guard++ < 50) {
      const m = reg.list().find(m => (m.target || 'project') === 'project' && m.from === v);
      if (!m) { problems.push({ severity: 'error', code: 'no-migration', message: `no migration from project version ${v}`, where: { path: ['version'] } }); break; }
      p = m.up(p) || p; v = m.to; p.version = v; applied.push(m.id);
    }
    if (v > P.VERSION) problems.push({ severity: 'warn', code: 'newer-version', message: `project version ${v} is newer than this kit (${P.VERSION})`, where: { path: ['version'] } });
    if (v === P.VERSION) p.version = v;
    return { project: p, applied, problems };
  };

  // ---- normalize: fill defaults everywhere ------------------------------------
  const isObj = KIT.isObject;
  const int = (v, d) => (Number.isInteger(v) ? v : (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d));
  function fillLayer(arr, n, fill) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = (Array.isArray(arr) && arr[i] !== undefined) ? arr[i] : fill;
    return out;
  }
  function objectType(type) { return KIT.registry('objectTypes').get(type) || null; }
  function itemKind(kind) { return KIT.registry.exists('itemKinds') ? (KIT.registry('itemKinds').get(kind) || null) : null; }

  P.fillPage = function (raw, type) {
    const t = objectType(type);
    const src = Object.assign({}, t && t.page ? t.page : {}, isObj(raw) ? raw : {});
    const page = S.fill(F.page, src);
    page.behaviour = S.fill(F.behaviour, isObj(src.behaviour) ? src.behaviour : {});
    const on = {};
    if (isObj(src.on)) for (const k of Object.keys(src.on)) if (Array.isArray(src.on[k])) on[k] = src.on[k];
    page.on = on;
    page.props = t && t.fields ? S.fill(t.fields, isObj(src.props) ? src.props : {}) : (isObj(src.props) ? src.props : {});
    return page;
  };
  P.fillObject = function (raw, index) {
    const src = isObj(raw) ? raw : {};
    const o = S.fill(F.object, src);
    if (!o.id) o.id = src.name ? KIT.slug(src.name) : `obj-${index == null ? 0 : index + 1}`;
    o.type = typeof src.type === 'string' && src.type ? src.type : 'npc';
    o.x = int(o.x, 0); o.y = int(o.y, 0);
    const pages = Array.isArray(src.pages) && src.pages.length ? src.pages : [{}];
    o.pages = pages.map(p => P.fillPage(p, o.type));
    return o;
  };
  P.fillMap = function (raw, id) {
    const src = isObj(raw) ? raw : {};
    const m = S.fill(F.map, src);
    if (id) m.id = id;
    if (!m.name) m.name = titleCase(m.id);
    m.width = Math.max(1, int(m.width, 20)); m.height = Math.max(1, int(m.height, 15));
    const n = m.width * m.height;
    const L = isObj(src.layers) ? src.layers : {};
    const ground = P.GROUND_BY_KIND[m.kind] || 'grass';
    m.layers = { terrain: fillLayer(L.terrain, n, 0), ground: fillLayer(L.ground, n, ground), deco: fillLayer(L.deco, n, null), above: fillLayer(L.above, n, null), regions: fillLayer(L.regions, n, 0) };
    m.collision = fillLayer(src.collision, n, null);
    m.objects = (Array.isArray(src.objects) ? src.objects : []).map(P.fillObject);
    m.props = isObj(src.props) ? src.props : {};
    // Layers of reality: the same place, otherwise. Sparse by design — only what differs.
    m.dimensions = {};
    if (isObj(src.dimensions)) {
      for (const k of Object.keys(src.dimensions)) {
        const d = isObj(src.dimensions[k]) ? src.dimensions[k] : {};
        m.dimensions[k] = {
          name: typeof d.name === 'string' && d.name ? d.name : titleCase(k),
          tiles: isObj(d.tiles) ? d.tiles : {},
          objects: isObj(d.objects) ? d.objects : {},
          music: d.music === undefined ? null : d.music,
          atmosphere: isObj(d.atmosphere) ? d.atmosphere : null,
          note: typeof d.note === 'string' ? d.note : '',
        };
      }
    }
    return m;
  };
  P.fillItem = function (raw, id) {
    const src = isObj(raw) ? raw : {};
    const it = S.fill(F.item, src);
    if (!src.kind) { const ks = KIT.registry.exists('itemKinds') ? KIT.registry('itemKinds').ids() : []; it.kind = ks[0] || 'item'; }
    if (!it.name) it.name = titleCase(id);
    const k = itemKind(it.kind);
    it.props = k && k.fields ? S.fill(k.fields, isObj(src.props) ? src.props : {}) : (isObj(src.props) ? src.props : {});
    return it;
  };
  /** fillAutotileGroup(group, index) -> the group with every default filled in (and its rules). */
  P.fillAutotileGroup = function (g, i) {
    const go = S.fill(F.autotileGroup, isObj(g) ? g : {});
    if (!go.id) go.id = `group-${(i || 0) + 1}`;
    if (!go.name) go.name = titleCase(go.id);
    go.rules = (Array.isArray(g && g.rules) ? g.rules : []).map(r => {
      const ro = S.fill(F.autotileRule, isObj(r) ? r : {});
      if (ro.layer === undefined) delete ro.layer;
      for (const key of ['tilesX', 'tilesY', 'tilesXY']) if (ro[key] === undefined) delete ro[key];
      return ro;
    });
    return go;
  };
  /** fillScript(script, id) -> the script with every default filled in. */
  P.fillScript = function (raw, id) {
    const sc = S.fill(F.script, isObj(raw) ? raw : {});
    if (!sc.label) sc.label = titleCase(id || '');
    return sc;
  };
  /**
   * A rule of the world: `when` an event happens, `if` a condition holds, `do` a
   * script. Filled here rather than inline so the editor's ＋ New makes exactly
   * the same object a loaded file does.
   */
  P.fillRule = function (raw, id) {
    const r = S.fill(F.rule, isObj(raw) ? raw : {});
    r.id = id || r.id || '';
    if (!r.name) r.name = titleCase(r.id);
    return r;
  };
  const VAR_DEFAULT = { number: 0, bool: false, string: '' };
  P.fillVar = function (raw, name) {
    if (!isObj(raw)) { const t = typeof raw === 'boolean' ? 'bool' : typeof raw === 'string' ? 'string' : 'number'; raw = { type: t, default: raw == null ? VAR_DEFAULT[t] : raw }; }
    const v = S.fill(F.var, raw);
    if (!['number', 'bool', 'string'].includes(v.type)) v.type = 'number';
    if (v.default === undefined || v.default === null) v.default = VAR_DEFAULT[v.type];
    if (!v.label) v.label = titleCase(name);
    return v;
  };

  /**
   * The art a project carries itself (imported from Tiled/RPG Maker/Aseprite, or drawn in
   * Creator Mode) as opposed to the art built into the kit under js/art/. Loading a project
   * registers it, which is what makes an imported tileset work after a reload.
   */
  // A project's own content, registered before it is validated so its references
  // resolve. Sounds and music are in here too: an import brings the NAME of every
  // track it could not bring the file for, and without registering those names
  // every command that plays one reads as a broken reference.
  P.ART_TABLES = [['tiles', 'tiles'], ['sprites', 'sprites'], ['faces', 'faces'], ['icons', 'icons'],
    ['animations', 'animations'], ['sounds', 'sounds'], ['music', 'music']];
  /** registerArt(project) -> how many definitions were registered. Safe to call repeatedly. */
  P.registerArt = function (project) {
    let n = 0;
    for (const [table, regName] of P.ART_TABLES) {
      const t = project && project[table];
      if (!isObj(t) || !KIT.registry.exists(regName)) continue;
      for (const id of Object.keys(t)) {
        if (!isObj(t[id])) continue;
        try { KIT.registry(regName).add(Object.assign({}, t[id], { id, replace: true })); n++; }
        catch (e) { (KIT.log || console).warn(`[project] ${table}['${id}'] could not be registered: ${e.message}`); }
      }
    }
    if (KIT.assets && isObj(project && project.assets)) KIT.assets.fromProject(project);
    return n;
  };

  /** normalize(project, ctx) -> { project, problems }: migrate, fill every default, then validate. Never mutates the input. */
  P.normalize = function (project, ctx) {
    const mig = P.migrate(KIT.deepClone(project || {}));
    const src = mig.project;
    const p = { version: P.VERSION };
    p.meta = S.fill(F.meta, isObj(src.meta) ? src.meta : {});
    if (!p.meta.id) p.meta.id = KIT.slug(p.meta.title || 'our-adventure');
    if (p.meta.created === undefined) delete p.meta.created;
    p.modules = Array.isArray(src.modules) ? src.modules.filter(m => typeof m === 'string') : [];
    p.settings = S.fill(F.settings, isObj(src.settings) ? src.settings : {});
    // Only the OVERRIDES. `KIT.strings.get` falls back to the registry and the
    // Terms panel lists from it, so copying every registered default in here
    // would freeze a snapshot into the content — one that silently wins over the
    // engine or a module the day somebody rewords a default, and dead weight in a
    // project that later switches that module off. A key stays when it differs
    // from its registered default, or when nothing registers it at all.
    p.strings = {};
    if (isObj(src.strings)) {
      const reg = KIT.registry('strings');
      for (const k of Object.keys(src.strings)) {
        const v = src.strings[k];
        if (typeof v !== 'string') continue;
        const def = reg.get(k);
        if (def && def.default === v) continue;
        p.strings[k] = v;
      }
    }
    const heroes = Array.isArray(src.heroes) && src.heroes.length ? src.heroes : [{ id: 'p1', name: 'Player 1', sprite: 'hero-boy' }, { id: 'p2', name: 'Player 2', sprite: 'hero-girl' }];
    p.heroes = heroes.map((h, i) => { const o = S.fill(F.hero, isObj(h) ? h : {}); if (!o.id) o.id = `p${i + 1}`; if (!o.name) o.name = `Player ${i + 1}`; return o; });
    p.start = S.fill(F.start, isObj(src.start) ? src.start : {});
    p.vars = {}; if (isObj(src.vars)) for (const k of Object.keys(src.vars)) p.vars[k] = P.fillVar(src.vars[k], k);
    p.items = {}; if (isObj(src.items)) for (const k of Object.keys(src.items)) p.items[k] = P.fillItem(src.items[k], k);
    p.rules = {}; if (isObj(src.rules)) for (const k of Object.keys(src.rules)) p.rules[k] = P.fillRule(src.rules[k], k);
    p.facts = {}; if (isObj(src.facts)) for (const k of Object.keys(src.facts)) { const f = S.fill(F.fact, isObj(src.facts[k]) ? src.facts[k] : {}); f.id = k; if (!f.label) f.label = titleCase(k); p.facts[k] = f; }
    p.cast = {}; if (isObj(src.cast)) for (const k of Object.keys(src.cast)) { const c = S.fill(F.person, isObj(src.cast[k]) ? src.cast[k] : {}); c.id = k; if (!c.name) c.name = titleCase(k); p.cast[k] = c; }
    // Languages are deliberately not schema-shaped: the keys ARE the authored
    // lines, so any pattern a field could impose would be a lie. Validated by
    // hand instead — a table of strings to strings, and nothing else.
    p.languages = {};
    if (isObj(src.languages)) for (const k of Object.keys(src.languages)) {
      const d = isObj(src.languages[k]) ? src.languages[k] : {};
      const lines = {};
      if (isObj(d.lines)) for (const key of Object.keys(d.lines)) if (typeof d.lines[key] === 'string') lines[key] = d.lines[key];
      p.languages[k] = { name: typeof d.name === 'string' && d.name ? d.name : k, lines };
    }
    p.assets = {}; if (isObj(src.assets)) for (const k of Object.keys(src.assets)) p.assets[k] = S.fill(F.asset, isObj(src.assets[k]) ? src.assets[k] : {});
    p.scripts = {}; if (isObj(src.scripts)) for (const k of Object.keys(src.scripts)) p.scripts[k] = P.fillScript(src.scripts[k], k);
    p.fragments = (Array.isArray(src.fragments) ? src.fragments : []).map((f, i) => { const o = S.fill(F.fragment, isObj(f) ? f : {}); if (!o.id) o.id = `fragment-${i + 1}`; return o; });
    p.testStates = (Array.isArray(src.testStates) ? src.testStates : []).map((t, i) => { const o = S.fill(F.testState, isObj(t) ? t : {}); if (!o.id) o.id = `test-${i + 1}`; o.vars = isObj(t && t.vars) ? t.vars : {}; o.inventory = isObj(t && t.inventory) ? t.inventory : {}; o.modules = isObj(t && t.modules) ? t.modules : {}; return o; });
    p.autotiles = {};
    const sets = isObj(src.autotiles) && Object.keys(src.autotiles).length ? src.autotiles : { default: { source: 'terrain', groups: [] } };
    for (const k of Object.keys(sets)) {
      const set = isObj(sets[k]) ? sets[k] : {};
      p.autotiles[k] = { source: set.source || 'terrain', groups: (Array.isArray(set.groups) ? set.groups : []).map((g, i) => P.fillAutotileGroup(g, i)) };
    }
    p.terrains = (Array.isArray(src.terrains) ? src.terrains : []).map((t, i) => { const o = S.fill(F.terrain, isObj(t) ? t : {}); if (!Number.isInteger(o.id) || o.id < 1) o.id = i + 1; if (!o.name) o.name = `Terrain ${o.id}`; return o; });
    p.maps = {};
    const rawMaps = isObj(src.maps) ? src.maps : {};
    for (const id of Object.keys(rawMaps)) p.maps[id] = P.fillMap(rawMaps[id], id);
    const w = isObj(src.world) ? src.world : {};
    p.world = { maps: {}, connections: (Array.isArray(w.connections) ? w.connections : []).map(c => S.fill(F.connection, isObj(c) ? c : {})) };
    Object.keys(p.maps).forEach((id, i) => { const e = isObj(w.maps) && isObj(w.maps[id]) ? w.maps[id] : { x: i * 24, y: 0 }; p.world.maps[id] = S.fill(F.worldMap, e); });
    p.packs = isObj(src.packs) ? src.packs : {};
    // Every module that declared a content slice gets its defaults filled in, so
    // `packs.<key>` always has the shape the module said it would — an author who
    // never opened that panel still has the numbers, and the generic inspector can
    // edit them because their fields are declared.
    if (KIT.modules && KIT.modules.ensurePacks) KIT.modules.ensurePacks(p);
    if (!p.start.map && Object.keys(p.maps).length) p.start.map = Object.keys(p.maps)[0];
    for (const k of Object.keys(src)) if (!(k in p) && k !== 'version') p[k] = src[k];   // keep unknown top-level keys (modules' data)
    if (!(ctx && ctx.skipRegisterArt)) P.registerArt(p);        // the project's own art has to exist before anything references it
    // Validating is the expensive half and a PLAYER never needs it: it reads
    // every command of every page of every object looking for things an author
    // should fix. Measured on a 400-map, 48,000-line project: filling 0.5s,
    // validating 2.3s. `ctx.validate === false` boots the game and leaves the
    // checking to whoever asked for it — Creator Mode, or an idle callback a
    // moment later (js/main.js does the latter).
    const problems = (ctx && ctx.validate === false) ? mig.problems : mig.problems.concat(P.validate(p, ctx));
    return { project: p, problems };
  };

  // ---- walking scripts and collecting references -------------------------------
  function commandDef(cmd) {
    if (!cmd || typeof cmd.t !== 'string' || !KIT.registry.exists('commands')) return null;
    return KIT.registry('commands').get(cmd.t) || null;
  }
  const isCmdList = (v) => Array.isArray(v) && v.every(c => isObj(c) && typeof c.t === 'string');
  /** Nested command lists of one command: [{ path:[relative keys], list }] — from the command's field schema, else by shape. */
  P.subScripts = function (cmd) {
    const out = [];
    const def = commandDef(cmd);
    if (def && Array.isArray(def.fields)) {
      S.walk(def.fields, cmd, (f, v, path) => { if (f.type === 'script' && Array.isArray(v)) out.push({ path, list: v }); });
      return out;
    }
    for (const k of Object.keys(cmd)) {
      if (k === 't') continue;
      const v = cmd[k];
      if (!Array.isArray(v) || !v.length) continue;
      if (isCmdList(v)) out.push({ path: [k], list: v });
      else v.forEach((item, i) => { if (isObj(item)) for (const kk of Object.keys(item)) if (isCmdList(item[kk]) && item[kk].length) out.push({ path: [k, i, kk], list: item[kk] }); });
    }
    return out;
  };
  function walkList(list, where, fn) {
    fn(list, where);
    list.forEach((cmd, i) => {
      if (!isObj(cmd)) return;
      for (const sub of P.subScripts(cmd)) walkList(sub.list, Object.assign({}, where, { path: where.path.concat(i, sub.path) }), fn);
    });
  }
  /** walkScripts(project, fn(commands, where)) — every slot, script body, choice branch and if-branch (nested lists get their own call). */
  P.walkScripts = function (project, fn) {
    const maps = project.maps || {};
    for (const mapId of Object.keys(maps)) {
      (maps[mapId].objects || []).forEach((o, oi) => (o.pages || []).forEach((pg, pi) => {
        const on = pg.on || {};
        for (const slot of Object.keys(on)) if (Array.isArray(on[slot])) walkList(on[slot], { map: mapId, object: o.id, page: pi, slot, path: ['maps', mapId, 'objects', oi, 'pages', pi, 'on', slot] }, fn);
      }));
    }
    const scripts = project.scripts || {};
    for (const id of Object.keys(scripts)) if (Array.isArray(scripts[id].body)) walkList(scripts[id].body, { script: id, path: ['scripts', id, 'body'] }, fn);
  };
  /** walkCommands(project, fn(cmd, where, index)) — every command anywhere; where.path points at the command. */
  P.walkCommands = function (project, fn) {
    P.walkScripts(project, (list, where) => list.forEach((cmd, i) => fn(cmd, Object.assign({}, where, { path: where.path.concat(i) }), i)));
  };

  /** Baseline condition refs (§9.3 shapes) — used when the conditions registry / schema handler yields nothing. */
  function conditionRefs(cond, path, out) {
    if (!isObj(cond)) return;
    const viaSchema = [];
    if (S.types.condition && S.types.condition.refs) S.types.condition.refs({ key: 'when', type: 'condition' }, cond, {}, path, viaSchema);
    if (viaSchema.length) { out.push(...viaSchema); return; }
    const def = KIT.registry.exists('conditions') ? KIT.registry('conditions').get(cond.kind) : null;
    if (def && Array.isArray(def.fields)) {
      const refs = S.refs(def.fields, cond, {});
      for (const r of refs) out.push(Object.assign({}, r, { path: path.concat(r.path) }));
      S.walk(def.fields, cond, (f, v, p) => { if (f.type === 'condition' && v) conditionRefs(v, path.concat(p), out); });
      return;
    }
    switch (cond.kind) {
      case 'var': if (typeof cond.name === 'string') out.push({ kind: 'var', id: cond.name, path: path.concat('name'), access: 'read' }); if (typeof cond.var === 'string') out.push({ kind: 'var', id: cond.var, path: path.concat('var'), access: 'read' }); break;
      case 'self': if (typeof cond.key === 'string') out.push({ kind: 'self', id: cond.key, path: path.concat('key'), access: 'read' }); break;
      case 'item': if (typeof cond.id === 'string') out.push({ kind: 'item', id: cond.id, path: path.concat('id'), access: 'read' }); break;
      case 'all': case 'any': (Array.isArray(cond.of) ? cond.of : []).forEach((c, i) => conditionRefs(c, path.concat('of', i), out)); break;
      case 'not': conditionRefs(cond.of, path.concat('of'), out); break;
      default: break;
    }
  }
  P.conditionRefs = function (cond, path) { const out = []; conditionRefs(cond, path || [], out); return out; };

  /** A field list without its script-typed fields at any depth (nested command lists are walked by walkScripts, never by the schema). */
  function withoutScripts(fields) {
    const out = [];
    for (const f of fields || []) {
      if (f.type === 'script') continue;
      const c = Object.assign({}, f);
      if (c.type === 'group') c.fields = withoutScripts(c.fields);
      if (c.type === 'list' && c.of) { if (c.of.type === 'script') continue; c.of = c.of.type === 'group' ? Object.assign({}, c.of, { fields: withoutScripts(c.of.fields) }) : c.of; }
      out.push(c);
    }
    return out;
  }
  P.withoutScripts = withoutScripts;
  /** Refs of one value against a field list: schema refs, plus the baseline condition walk wherever the schema's condition handler yields nothing. */
  function fieldRefs(fields, value, path, out) {
    if (!Array.isArray(fields) || !isObj(value)) return;
    for (const r of S.refs(fields, value, {})) out.push(Object.assign({}, r, { path: path.concat(r.path) }));
    S.walk(fields, value, (f, v, p) => {
      if (f.type !== 'condition' || !v) return;
      const probe = [];
      if (S.types.condition && S.types.condition.refs) S.types.condition.refs(f, v, {}, [], probe);
      if (!probe.length) conditionRefs(v, path.concat(p), out);
    });
  }
  const withWhere = (refs, where) => refs.map(r => ({ kind: r.kind, id: r.id, access: r.access || 'read', where: Object.assign({}, where, { path: r.path }) }));

  /**
   * collect(project) -> { vars:{ name:{ reads:[where], writes:[where], declared } }, refs:[{ kind, id, access, where }] }
   * Command refs come from the command's registered field schema (nothing is guessed for unregistered commands);
   * condition refs from the conditions registry / schema handler, falling back to the baseline §9.3 shapes.
   */
  P.collect = function (project) {
    const refs = [];
    const push = (list, where) => refs.push(...withWhere(list, where));
    // heroes, start, test states, terrains, items
    (project.heroes || []).forEach((h, i) => { const o = []; fieldRefs(F.hero, h, ['heroes', i], o); push(o, {}); });
    { const o = []; fieldRefs(F.start, project.start, ['start'], o); push(o, {}); }
    (project.testStates || []).forEach((t, i) => { const o = []; fieldRefs(F.testState, t, ['testStates', i], o); push(o, {}); });
    (project.terrains || []).forEach((t, i) => { const o = []; fieldRefs(F.terrain, t, ['terrains', i], o); push(o, {}); });
    for (const id of Object.keys(project.items || {})) { const it = project.items[id], o = []; fieldRefs(F.item, it, ['items', id], o); const k = itemKind(it.kind); if (k && k.fields) fieldRefs(k.fields, it.props, ['items', id, 'props'], o); push(o, {}); }
    // autotile tiles
    for (const setId of Object.keys(project.autotiles || {})) ((project.autotiles[setId] || {}).groups || []).forEach((g, gi) => (g.rules || []).forEach((r, ri) => { const o = []; fieldRefs(F.autotileRule, r, ['autotiles', setId, 'groups', gi, 'rules', ri], o); push(o, {}); }));
    // maps: music, pages (sprite, when, props), layers are checked by validate (too big for refs)
    const maps = project.maps || {};
    for (const mapId of Object.keys(maps)) {
      const m = maps[mapId];
      { const o = []; fieldRefs(F.map, m, ['maps', mapId], o); push(o, { map: mapId }); }
      (m.objects || []).forEach((obj, oi) => (obj.pages || []).forEach((pg, pi) => {
        const base = ['maps', mapId, 'objects', oi, 'pages', pi];
        const where = { map: mapId, object: obj.id, page: pi };
        const o = [];
        fieldRefs(F.page, pg, base, o);
        const t = objectType(obj.type);
        if (t && t.fields) fieldRefs(t.fields, pg.props, base.concat('props'), o);
        push(o, where);
      }));
    }
    // scripts: when + params
    for (const id of Object.keys(project.scripts || {})) { const o = []; fieldRefs(F.script.filter(f => f.key !== 'body'), project.scripts[id], ['scripts', id], o); push(o, { script: id }); }
    // commands
    P.walkCommands(project, (cmd, where) => {
      const def = commandDef(cmd);
      if (!def || !Array.isArray(def.fields)) return;
      const o = [];
      fieldRefs(withoutScripts(def.fields), cmd, where.path, o);
      push(o, where);
    });
    const vars = {};
    for (const name of Object.keys(project.vars || {})) vars[name] = { reads: [], writes: [], declared: true };
    for (const r of refs) {
      if (r.kind !== 'var') continue;
      if (!vars[r.id]) vars[r.id] = { reads: [], writes: [], declared: false };
      (r.access === 'write' ? vars[r.id].writes : vars[r.id].reads).push(r.where);
    }
    return { vars, refs };
  };

  // ---- validate -----------------------------------------------------------------
  const REGISTRY_KINDS = { tile: 'tiles', sprite: 'sprites', face: 'faces', icon: 'icons', sound: 'sounds', music: 'music', preset: 'presets' };
  /** Is `id` a known thing of `kind`? true | false | null (cannot tell: empty registry / undeclared var / no resolver). */
  P.known = function (kind, id, project) {
    if (REGISTRY_KINDS[kind]) { const rn = REGISTRY_KINDS[kind]; if (!KIT.registry.exists(rn) || KIT.registry(rn).size() === 0) return null; return KIT.registry(rn).has(id); }
    const res = S.refKinds[kind];
    if (!res || !res.has) return null;
    return res.has(id, { project });
  };
  function tileFlags(id) { return KIT.tiles && KIT.tiles.flags ? KIT.tiles.flags(id) : { solid: false, exists: false }; }
  const tilesKnown = () => KIT.registry.exists('tiles') && KIT.registry('tiles').size() > 0;
  /** Is the cell solid for a hero? collision override first, then ground/deco tile flags. */
  P.cellSolid = function (map, x, y) {
    if (!map || x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
    const i = y * map.width + x;
    const c = map.collision && map.collision[i];
    if (c === 1) return true;
    if (c === 0) return false;
    const L = map.layers || {};
    if (!tilesKnown()) return false;
    return !!((L.ground && L.ground[i] != null && tileFlags(L.ground[i]).solid) || (L.deco && L.deco[i] != null && tileFlags(L.deco[i]).solid));
  };
  /** Transfer targets in a value: position fields carrying a map, or (map ref + x + y) field triples. -> [{ map, x, y, path }] */
  function targetsOf(fields, value, path) {
    const out = [];
    if (!Array.isArray(fields) || !isObj(value)) return out;
    const fs = S.fields(fields);
    const has = (k, type) => fs.find(f => f.key === k && (!type || f.type === type));
    if (has('map', 'ref:map') && has('x') && has('y') && typeof value.map === 'string') out.push({ map: value.map, x: value.x, y: value.y, path: path.slice() });
    S.walk(fields, value, (f, v, p) => { if (f.type === 'position' && isObj(v) && 'map' in v) out.push({ map: v.map, x: v.x, y: v.y, path: path.concat(p) }); });
    return out;
  }
  function stripRefErrors(errs) { return errs.filter(e => e.code !== 'ref'); }

  /**
   * validate(project, ctx) -> Problem[]  (ctx is optional: { strict })
   * Reference checks against art registries only run when that registry has entries.
   */
  P.validate = function (project, ctx) {
    ctx = ctx || {};
    const problems = [];
    const prob = (severity, code, message, where) => { problems.push({ severity, code, message, where: where || {} }); };
    const errors = (code, errs, where, label) => { for (const e of errs) prob('error', code, `${label ? label + ': ' : ''}${e.path.length ? e.path.join('.') + ' ' : ''}${e.message}`, Object.assign({}, where, { path: (where && where.path ? where.path : []).concat(e.path) })); };
    if (!isObj(project)) { prob('error', 'not-an-object', 'the project is not an object', { path: [] }); return problems; }
    const maps = isObj(project.maps) ? project.maps : {};
    const mapIds = Object.keys(maps);

    // top-level schema checks
    errors('schema', stripRefErrors(S.validate(F.meta, project.meta || {})), { path: ['meta'] }, 'meta');
    if (!project.meta || !String(project.meta.pitch || '').trim()) prob('warn', 'no-pitch', 'The pitch is missing: two sentences about who the hero is and what they want.', { path: ['meta', 'pitch'] });
    errors('schema', stripRefErrors(S.validate(F.settings, project.settings || {})), { path: ['settings'] }, 'settings');
    (project.heroes || []).forEach((h, i) => errors('schema', stripRefErrors(S.validate(F.hero, h)), { path: ['heroes', i] }, `hero ${i + 1}`));
    if (!Array.isArray(project.heroes) || !project.heroes.length) prob('error', 'no-heroes', 'the project needs at least one hero', { path: ['heroes'] });
    errors('schema', stripRefErrors(S.validate(F.start, project.start || {})), { path: ['start'] }, 'start');
    // A module's content is checked against the fields the module declared, the
    // same way everything else here is. A number an author typed into a module's
    // panel is reported in the same list as a broken tile id.
    if (KIT.modules && KIT.modules.problems) for (const m of KIT.modules.problems(project)) problems.push(m);
    for (const name of Object.keys(project.vars || {})) {
      const v = project.vars[name];
      errors('schema', S.validate(F.var, v), { path: ['vars', name] }, `var ${name}`);
      const t = v && v.type; const d = v && v.default;
      if (t === 'number' && typeof d !== 'number') prob('error', 'schema', `var ${name}: default must be a number`, { path: ['vars', name, 'default'] });
      if (t === 'bool' && typeof d !== 'boolean') prob('error', 'schema', `var ${name}: default must be true or false`, { path: ['vars', name, 'default'] });
      if (t === 'string' && typeof d !== 'string') prob('error', 'schema', `var ${name}: default must be text`, { path: ['vars', name, 'default'] });
    }
    for (const id of Object.keys(project.items || {})) {
      const it = project.items[id];
      errors('schema', stripRefErrors(S.validate(F.item, it)), { path: ['items', id] }, `item ${id}`);
      const k = itemKind(it && it.kind);
      if (KIT.registry.exists('itemKinds') && KIT.registry('itemKinds').size() && !k) prob('warn', 'unknown-item-kind', `item ${id}: unknown item kind '${it && it.kind}'`, { path: ['items', id, 'kind'] });
      if (k && k.fields) errors('schema', stripRefErrors(S.validate(k.fields, (it && it.props) || {})), { path: ['items', id, 'props'] }, `item ${id}`);
    }
    for (const id of Object.keys(project.scripts || {})) errors('schema', stripRefErrors(S.validate(F.script, project.scripts[id])), { script: id, path: ['scripts', id] }, `script ${id}`);
    (project.fragments || []).forEach((f, i) => errors('schema', S.validate(F.fragment, f), { path: ['fragments', i] }, 'fragment'));
    (project.testStates || []).forEach((t, i) => {
      errors('schema', stripRefErrors(S.validate(F.testState, t)), { path: ['testStates', i] }, `test state ${t && t.id}`);
      if (t && t.map && maps[t.map] && (t.x >= maps[t.map].width || t.y >= maps[t.map].height)) prob('error', 'target-out-of-bounds', `test state ${t.id}: (${t.x}, ${t.y}) is outside map '${t.map}'`, { path: ['testStates', i] });
    });
    const terrainIds = new Set();
    (project.terrains || []).forEach((t, i) => { errors('schema', stripRefErrors(S.validate(F.terrain, t)), { path: ['terrains', i] }, 'terrain'); if (t && terrainIds.has(t.id)) prob('error', 'duplicate-terrain', `terrain id ${t.id} is used twice`, { path: ['terrains', i, 'id'] }); if (t) terrainIds.add(t.id); });
    for (const setId of Object.keys(project.autotiles || {})) ((project.autotiles[setId] || {}).groups || []).forEach((g, gi) => {
      errors('schema', S.validate(F.autotileGroup, g), { path: ['autotiles', setId, 'groups', gi] }, `autotile group ${g && g.id}`);
      if (g && g.terrain && !terrainIds.has(g.terrain)) prob('warn', 'unknown-terrain', `autotile group ${g.id}: terrain ${g.terrain} is not defined`, { path: ['autotiles', setId, 'groups', gi, 'terrain'] });
      (g && g.rules || []).forEach((r, ri) => {
        const where = { path: ['autotiles', setId, 'groups', gi, 'rules', ri] };
        errors('schema', stripRefErrors(S.validate(F.autotileRule, r)), where, `autotile rule ${g.id}/${ri + 1}`);
        if (r && Array.isArray(r.pattern) && r.pattern.length !== (r.size || 3) * (r.size || 3)) prob('error', 'bad-pattern', `autotile rule ${g.id}/${ri + 1}: pattern needs ${(r.size || 3) * (r.size || 3)} cells`, { path: where.path.concat('pattern') });
      });
    });

    // world
    const world = isObj(project.world) ? project.world : { maps: {}, connections: [] };
    if (!mapIds.length) prob('error', 'no-maps', 'the project has no maps', { path: ['maps'] });
    if (!project.start || !project.start.map || !maps[project.start.map]) prob('error', 'bad-start', `start map '${project.start && project.start.map}' does not exist`, { path: ['start', 'map'] });
    else {
      const m = maps[project.start.map];
      if (project.start.x >= m.width || project.start.y >= m.height || project.start.x < 0 || project.start.y < 0) prob('error', 'target-out-of-bounds', `start position (${project.start.x}, ${project.start.y}) is outside '${m.id}'`, { map: m.id, path: ['start'] });
      else if (P.cellSolid(m, project.start.x, project.start.y)) prob('warn', 'target-solid', `start position (${project.start.x}, ${project.start.y}) on '${m.id}' is solid`, { map: m.id, path: ['start'] });
    }
    for (const id of Object.keys(world.maps || {})) if (!maps[id]) prob('warn', 'unknown-map', `world layout mentions missing map '${id}'`, { path: ['world', 'maps', id] });
    (world.connections || []).forEach((c, i) => {
      const where = { path: ['world', 'connections', i] };
      errors('schema', stripRefErrors(S.validate(F.connection, c)), where, 'connection');
      const a = maps[c && c.a], b = maps[c && c.b];
      if (!a || !b) { prob('error', 'bad-connection', `connection ${i + 1}: map '${!a ? c && c.a : c && c.b}' does not exist`, where); return; }
      const side = c.side, off = c.offset | 0;
      if (!['n', 's', 'e', 'w'].includes(side)) return;
      const vertical = side === 'n' || side === 's';
      const lenA = vertical ? a.width : a.height, lenB = vertical ? b.width : b.height;
      let mismatch = 0, open = 0, pairs = 0;
      for (let k = 0; k < lenA; k++) {
        const kb = k - off;
        if (kb < 0 || kb >= lenB) continue;
        pairs++;
        const ca = vertical ? [k, side === 's' ? a.height - 1 : 0] : [side === 'e' ? a.width - 1 : 0, k];
        const cb = vertical ? [kb, side === 's' ? 0 : b.height - 1] : [side === 'e' ? 0 : b.width - 1, kb];
        const sa = P.cellSolid(a, ca[0], ca[1]), sb = P.cellSolid(b, cb[0], cb[1]);
        if (sa !== sb) mismatch++;
        if (!sa && !sb) open++;
      }
      if (!pairs) prob('error', 'bad-connection', `connection ${a.id} ${side} ${b.id}: the edges do not touch (offset ${off})`, where);
      else if (!open) prob('warn', 'connection-blocked', `connection ${a.id} ${side} ${b.id}: no walkable tile leads across`, where);
      else if (mismatch) prob('warn', 'connection-mismatch', `connection ${a.id} ${side} ${b.id}: ${mismatch} edge tile(s) are walkable on one side and solid on the other`, where);
    });

    // maps, objects, pages
    const allRefs = P.collect(project).refs;
    const checkTiles = tilesKnown();
    const seenUnknownTile = new Set();
    for (const mapId of mapIds) {
      const m = maps[mapId];
      const mwhere = { map: mapId, path: ['maps', mapId] };
      errors('schema', stripRefErrors(S.validate(F.map, m)), mwhere, `map ${mapId}`);
      if (m.id !== mapId) prob('error', 'bad-map-id', `map '${mapId}' has id '${m.id}'`, { map: mapId, path: ['maps', mapId, 'id'] });
      const n = (m.width | 0) * (m.height | 0);
      const L = isObj(m.layers) ? m.layers : {};
      for (const layer of P.LAYERS) {
        const arr = L[layer];
        if (!Array.isArray(arr) || arr.length !== n) { prob('error', 'bad-layer', `map ${mapId}: layer '${layer}' must have ${n} cells`, { map: mapId, path: ['maps', mapId, 'layers', layer] }); continue; }
        if (layer === 'terrain') { const seen = new Set(); arr.forEach((v, i) => { if (v && !terrainIds.has(v) && !seen.has(v)) { seen.add(v); prob('warn', 'unknown-terrain', `map ${mapId}: terrain ${v} at cell ${i} is not defined`, { map: mapId, path: ['maps', mapId, 'layers', 'terrain', i] }); } }); }
        else if (layer === 'regions') { const bad = arr.findIndex(v => !Number.isInteger(v) || v < 0 || v > 255); if (bad >= 0) prob('error', 'bad-region', `map ${mapId}: region at cell ${bad} must be 0-255`, { map: mapId, path: ['maps', mapId, 'layers', 'regions', bad] }); }
        else if (checkTiles) {
          const counts = new Map();
          arr.forEach((id, i) => { if (id != null && !KIT.registry('tiles').has(id)) { if (!counts.has(id)) counts.set(id, { first: i, n: 0 }); counts.get(id).n++; } });
          for (const [id, c] of counts) { prob('error', 'unknown-tile', `map ${mapId}: unknown tile '${id}' on ${layer} (${c.n} cell${c.n > 1 ? 's' : ''}, first at ${c.first % m.width}, ${Math.floor(c.first / m.width)})`, { map: mapId, path: ['maps', mapId, 'layers', layer, c.first] }); seenUnknownTile.add(id); }
        }
      }
      if (!Array.isArray(m.collision) || m.collision.length !== n) prob('error', 'bad-layer', `map ${mapId}: collision must have ${n} cells`, { map: mapId, path: ['maps', mapId, 'collision'] });
      const ids = new Map();
      let ticks = 0;
      const typeCounts = new Map();
      (m.objects || []).forEach((o, oi) => {
        const owhere = { map: mapId, object: o && o.id, path: ['maps', mapId, 'objects', oi] };
        errors('schema', stripRefErrors(S.validate(F.object, o || {})), owhere, `object ${o && o.id}`);
        if (!o) return;
        if (ids.has(o.id)) prob('error', 'duplicate-object', `map ${mapId}: object id '${o.id}' is used twice`, owhere); else ids.set(o.id, oi);
        if (o.x < 0 || o.y < 0 || o.x >= m.width || o.y >= m.height) prob('error', 'object-out-of-bounds', `map ${mapId}: '${o.id}' at (${o.x}, ${o.y}) is outside the map`, owhere);
        const t = objectType(o.type);
        if (!t) prob('error', 'unknown-object-type', `map ${mapId}: '${o.id}' has unknown type '${o.type}'`, { map: mapId, object: o.id, path: owhere.path.concat('type') });
        else typeCounts.set(o.type, (typeCounts.get(o.type) || 0) + 1);
        if (!Array.isArray(o.pages) || !o.pages.length) { prob('error', 'no-pages', `map ${mapId}: '${o.id}' has no pages`, owhere); return; }
        o.pages.forEach((pg, pi) => {
          const pwhere = { map: mapId, object: o.id, page: pi, path: owhere.path.concat('pages', pi) };
          errors('schema', stripRefErrors(S.validate(F.page, pg || {})), pwhere, `${o.id} page ${pi + 1}`);
          if (!pg) return;
          errors('schema', S.validate(F.behaviour, pg.behaviour || {}), { map: mapId, object: o.id, page: pi, path: pwhere.path.concat('behaviour') }, `${o.id} page ${pi + 1} behaviour`);
          if (t && t.fields) errors('schema', stripRefErrors(S.validate(t.fields, pg.props || {})), { map: mapId, object: o.id, page: pi, path: pwhere.path.concat('props') }, `${o.id} page ${pi + 1}`);
          const on = pg.on || {};
          for (const slot of Object.keys(on)) if (!P.SLOTS.includes(slot)) prob('warn', 'unknown-slot', `${o.id} page ${pi + 1}: unknown slot '${slot}'`, { map: mapId, object: o.id, page: pi, slot, path: pwhere.path.concat('on', slot) });
          if (Array.isArray(on.tick) && on.tick.length) ticks++;
          // warp / transfer targets in page props
          if (t && t.fields) for (const tg of targetsOf(t.fields, pg.props || {}, pwhere.path.concat('props'))) checkTarget(tg, { map: mapId, object: o.id, page: pi, path: tg.path }, `${o.id} page ${pi + 1}`);
          // soft-lock guard: an enter slot whose page condition it never changes
          if (Array.isArray(on.enter) && on.enter.length && pg.when) softLock(pg.when, { map: mapId, object: o.id, page: pi, slot: 'enter' }, `${o.id} page ${pi + 1} 'enter'`, pwhere.path.concat('on', 'enter'));
        });
      });
      if (ticks > 3) prob('warn', 'too-many-ticks', `map ${mapId}: ${ticks} objects run every frame ('tick'); keep it to 3`, mwhere);
      for (const [type, count] of typeCounts) { const t = objectType(type); if (t && t.maxCount != null && count > t.maxCount) prob('warn', 'max-count', `map ${mapId}: ${count} '${type}' objects (max ${t.maxCount})`, mwhere); }
    }
    function checkTarget(tg, where, label) {
      const m = maps[tg.map];
      if (!m) { prob('error', 'bad-target', tg.map == null ? `${label}: leads nowhere (no map chosen)` : `${label}: leads to missing map '${tg.map}'`, where); return; }
      if (!Number.isInteger(tg.x) || !Number.isInteger(tg.y) || tg.x < 0 || tg.y < 0 || tg.x >= m.width || tg.y >= m.height) { prob('error', 'target-out-of-bounds', `${label}: (${tg.x}, ${tg.y}) is outside map '${tg.map}'`, where); return; }
      if (P.cellSolid(m, tg.x, tg.y)) prob('warn', 'target-solid', `${label}: lands on a solid tile at (${tg.x}, ${tg.y}) on '${tg.map}'`, where);
    }
    function softLock(when, where, label, bodyPath) {
      const reads = new Set(P.conditionRefs(when, []).filter(r => r.kind === 'var' || r.kind === 'self').map(r => r.kind + ':' + r.id));
      if (!reads.size) return;
      const writes = allRefs.filter(r => r.access === 'write' && (r.kind === 'var' || r.kind === 'self') && KIT.path.isPrefix(bodyPath, r.where.path)).map(r => r.kind + ':' + r.id);
      if (!writes.some(w => reads.has(w))) prob('warn', 'soft-lock', `${label} runs while ${Array.from(reads).join(', ')} but never changes it — it will run on every entry`, Object.assign({}, where, { path: bodyPath }));
    }
    for (const id of Object.keys(project.scripts || {})) {
      const sc = project.scripts[id];
      if (sc && sc.trigger === 'auto' && sc.when) softLock(sc.when, { script: id }, `script ${id} (auto)`, ['scripts', id, 'body']);
    }

    // references
    const undeclared = new Set();
    for (const r of allRefs) {
      if (r.kind === 'var') { if (!(project.vars && Object.prototype.hasOwnProperty.call(project.vars, r.id)) && !undeclared.has(r.id)) { undeclared.add(r.id); prob('warn', 'undeclared-var', `var '${r.id}' is used but not declared in Variables`, r.where); } continue; }
      if (r.kind === 'self') continue;
      const k = P.known(r.kind, r.id, project);
      if (k === false) prob('error', `unknown-${r.kind}`, `${r.kind} '${r.id}' does not exist`, r.where);
    }

    // commands
    const cmdReg = KIT.registry.exists('commands') ? KIT.registry('commands') : null;
    const cmdsKnown = !!(cmdReg && cmdReg.size());
    P.walkCommands(project, (cmd, where) => {
      if (!isObj(cmd) || typeof cmd.t !== 'string') { prob('error', 'bad-command', 'each command needs a type (t)', where); return; }
      if (cmd.disabled) return;
      const def = cmdReg && cmdReg.get(cmd.t);
      if (!def) { if (cmdsKnown && cmd.t !== 'raw') prob('error', 'unknown-command', `unknown command '${cmd.t}'`, where); if (cmd.t === 'say' && !String(cmd.text || '').trim()) prob('warn', 'empty-text', 'this message has no text', where); return; }
      if (Array.isArray(def.fields)) {
        // commands are validated as the editor sees them: missing keys at their defaults (nested lists are walked separately)
        const plain = withoutScripts(def.fields);
        const filled = S.fill(plain, cmd);
        errors('schema', stripRefErrors(S.validate(plain, filled)), where, def.label || cmd.t);
        // An empty text field is usually a mistake — except where the games themselves leave it
        // blank: choices often follow a message and carry no prompt of their own.
        const textOptional = { choice: ['prompt'], chapter: ['subtitle'], comment: ['text'], debug: ['text'] };
        for (const f of S.fields(plain)) {
          if (f.type !== 'text' || f.optional || f.nullable || !S.visible(f, filled)) continue;
          if ((textOptional[cmd.t] || []).includes(f.key)) continue;
          if (!String(filled[f.key] == null ? '' : filled[f.key]).trim()) prob('warn', 'empty-text', `${def.label || cmd.t}: '${f.key}' is empty`, Object.assign({}, where, { path: where.path.concat(f.key) }));
        }
        for (const tg of targetsOf(plain, filled, where.path)) checkTarget(tg, Object.assign({}, where, { path: tg.path }), def.label || cmd.t);
      }
      const background = where.slot === 'tick' || (where.script && project.scripts[where.script] && project.scripts[where.script].trigger === 'parallel');
      if (background && def.background === false) prob('error', 'blocking-in-background', `'${cmd.t}' cannot run in a ${where.slot === 'tick' ? "'tick' slot" : 'parallel script'} (it would block)`, where);
    });

    // registered validators (modules, content lint)
    if (KIT.registry.exists('validators')) for (const v of KIT.registry('validators').list()) {
      try { const more = v.run(project, Object.assign({}, ctx, { project })); if (Array.isArray(more)) for (const m of more) problems.push(Object.assign({ severity: 'error', code: v.id, message: '', where: {} }, m)); }
      catch (e) { prob('error', 'validator-threw', `validator '${v.id}' failed: ${e && e.message}`, {}); }
    }
    return problems;
  };

  // ---- helpers ------------------------------------------------------------------
  P.newMap = function (opts) {
    opts = opts || {};
    const id = opts.id || KIT.slug(opts.name || 'map');
    return P.fillMap({ id, name: opts.name || titleCase(id), width: opts.width || 20, height: opts.height || 15, kind: opts.kind || 'outdoor', music: opts.music || null }, id);
  };
  /** newObject({ type, id, name, x, y, props, page }) -> a normalized object with one page (props at their type defaults). */
  P.newObject = function (opts) {
    opts = opts || {};
    const type = opts.type || 'npc';
    const page = Object.assign({}, opts.page || {}, { props: Object.assign({}, (opts.page && opts.page.props) || {}, opts.props || {}) });
    return P.fillObject({ id: opts.id, name: opts.name || (objectType(type) ? objectType(type).name : titleCase(type)), type, x: opts.x | 0, y: opts.y | 0, note: opts.note || '', pages: [page] }, 0);
  };
  /** resize(map, w, h) -> a new map (anchor top-left; cells outside are dropped, new cells get defaults). Objects are kept (the validator flags any outside). */
  P.resize = function (map, w, h) {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    const out = KIT.deepClone(map);
    const ground = P.GROUND_BY_KIND[map.kind] || 'grass';
    const fills = { terrain: 0, ground, deco: null, above: null, regions: 0 };
    const regrid = (arr, fill) => { const o = new Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[y * w + x] = (x < map.width && y < map.height && Array.isArray(arr) && arr[y * map.width + x] !== undefined) ? arr[y * map.width + x] : fill; return o; };
    out.layers = {};
    for (const layer of P.LAYERS) out.layers[layer] = regrid((map.layers || {})[layer], fills[layer]);
    out.collision = regrid(map.collision, null);
    out.width = w; out.height = h;
    return out;
  };
  /**
   * registerContent(project) -> { assets, tiles, sprites, faces, icons }
   * A project may carry content of its own — the tables an import writes
   * (KIT.import.merge): `assets`, `tiles`, `sprites`, `faces`, `icons`, each a
   * table keyed by id. Art drawn here lives in `js/art/*.js` and registers
   * itself at load time; imported art has no such file, so the project IS the
   * file and this puts it into the registries. Called before the project is
   * normalized (storage.loadProject) so the validator sees the tiles too.
   * Safe to call twice: every definition replaces its own id.
   */
  // Everything a project can carry that lives in a REGISTRY rather than in the
  // project itself. Sounds and music are in here because an import brings the
  // names of tracks whose files it could not bring, and those names have to be
  // known or every command that plays one is a broken reference.
  const CONTENT_TABLES = ['tiles', 'sprites', 'faces', 'icons', 'sounds', 'music'];
  P.registerContent = function (project) {
    const counts = { assets: 0, tiles: 0, sprites: 0, faces: 0, icons: 0, sounds: 0, music: 0 };
    if (!isObj(project)) return counts;
    if (KIT.assets && KIT.assets.define && isObj(project.assets)) {
      for (const id of Object.keys(project.assets).sort()) {
        try { KIT.assets.define(Object.assign({ id }, project.assets[id])); counts.assets++; }
        catch (e) { (KIT.log || console).warn(`[project] asset '${id}' was not registered: ${e.message}`); }
      }
    }
    for (const name of CONTENT_TABLES) {
      const table = project[name];
      if (!isObj(table) || !KIT.registry.exists(name)) continue;
      const reg = KIT.registry(name);
      for (const id of Object.keys(table).sort()) {
        if (!isObj(table[id])) continue;
        try { reg.add(Object.assign({ id }, table[id], { replace: true })); counts[name]++; }
        catch (e) { (KIT.log || console).warn(`[project] ${name.replace(/s$/, '')} '${id}' was not registered: ${e.message}`); }
      }
    }
    return counts;
  };

  /** blank() -> a small valid project with one map. */
  P.blank = function (opts) {
    opts = opts || {};
    const mapId = opts.map || 'start';
    return P.normalize({
      version: P.VERSION,
      meta: { id: opts.id || 'new-adventure', title: opts.title || 'New Adventure', subtitle: '', author: '', pitch: opts.pitch || '' },
      start: { map: mapId, x: 5, y: 5, dir: 'down' },
      terrains: [{ id: 1, name: 'Grass', color: '#58b848', base: 'grass' }],
      maps: { [mapId]: { id: mapId, name: 'Start', width: 12, height: 10, kind: 'outdoor' } },
    }).project;
  };
  P.clone = (p) => KIT.deepClone(p);

  /** unique object id on a map: base, base-2, base-3 ... */
  P.uniqueObjectId = function (map, base) {
    const taken = new Set((map && map.objects || []).map(o => o.id));
    base = KIT.slug(base || 'object');
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  };
  /**
   * buildPreset(presetOrId, ctx) -> [{ map, object }]  ctx: { project, map, x, y, input:{ field values } }
   * Interprets a preset's `objects` templates: '$<field>' -> input value (or the field default), '$here' -> { map, x, y }.
   */
  P.buildPreset = function (presetOrId, ctx) {
    const preset = typeof presetOrId === 'string' ? KIT.registry('presets').require(presetOrId) : presetOrId;
    ctx = ctx || {};
    const input = S.fill(preset.fields || [], ctx.input || {});
    const here = { map: ctx.map, x: ctx.x | 0, y: ctx.y | 0 };
    const sub = (v) => {
      if (typeof v === 'string' && v[0] === '$') { const k = v.slice(1); return k === 'here' ? KIT.deepClone(here) : (k in input ? KIT.deepClone(input[k]) : v); }
      if (Array.isArray(v)) return v.map(sub);
      if (isObj(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = sub(v[k]); return o; }
      return v;
    };
    const out = [];
    for (const tpl of preset.objects || []) {
      const at = tpl.at || 'here';
      const pos = at === 'here' ? here : (isObj(input[at]) ? { map: input[at].map || here.map, x: input[at].x | 0, y: input[at].y | 0 } : here);
      const spec = sub(Object.assign({}, tpl));
      delete spec.at;
      const targetMap = ctx.project && ctx.project.maps ? ctx.project.maps[pos.map] : null;
      const obj = P.fillObject(Object.assign({}, spec, { id: spec.id || P.uniqueObjectId(targetMap, `${spec.name || spec.type}-${pos.x}-${pos.y}`), x: pos.x, y: pos.y }), 0);
      out.push({ map: pos.map, object: obj });
    }
    // two objects on the same map from one preset must not share an id
    const seen = new Map();
    for (const pl of out) { const key = pl.map + ':' + pl.object.id; if (seen.has(key)) pl.object.id = pl.object.id + '-' + (seen.get(key) + 1); seen.set(key, (seen.get(key) || 0) + 1); }
    return out;
  };

  // ---- content files (§4.2) -------------------------------------------------------
  // Scheme (documented in each file's header):
  //   project.js      registers everything but the maps as   KIT.content.projects[<projectId>]
  //   maps/<id>.js    registers one map as                   KIT.content.maps[<projectId>][<mapId>]
  //   KIT.project.fromContent(projectId) puts them back together; importFiles(files) parses the texts.
  // Every file is an IIFE whose last argument is the JSON payload, so the payload can be parsed
  // back without evaluating any code (it starts at the first line that is exactly "{" and ends at the
  // last line that is exactly "}" before the closing ");").
  const q = (s) => JSON.stringify(String(s));
  function rowWidth(key, parent, ancestors) {
    if (P.LAYERS.includes(key)) { const m = ancestors[ancestors.length - 2]; return m && Number.isInteger(m.width) ? m.width : 0; }
    if (key === 'collision' && parent && Number.isInteger(parent.width)) return parent.width;
    if (key === 'pattern' && parent && Number.isInteger(parent.size)) return parent.size;
    return 0;
  }
  /** stringify(value) -> pretty 2-space JSON, keys sorted, tile layers one map row per line, short primitive lists on one line. */
  P.stringify = function (value, opts) {
    const rw = (opts && opts.rowWidth) || rowWidth;
    const prim = (v) => (v === undefined ? 'null' : JSON.stringify(v));
    function fmt(v, indent, key, parent, ancestors) {
      if (v === null || typeof v !== 'object') return prim(v);
      const pad = '  '.repeat(indent + 1), end = '  '.repeat(indent);
      if (Array.isArray(v)) {
        if (!v.length) return '[]';
        const allPrim = v.every(x => x === null || typeof x !== 'object');
        const w = allPrim ? rw(key, parent, ancestors) : 0;
        if (w > 0) {
          const rows = [];
          for (let i = 0; i < v.length; i += w) rows.push(pad + v.slice(i, i + w).map(prim).join(', '));
          return '[\n' + rows.join(',\n') + '\n' + end + ']';
        }
        if (allPrim) { const line = v.map(prim).join(', '); if (line.length <= 72) return '[' + line + ']'; }
        return '[\n' + v.map(x => pad + fmt(x, indent + 1, null, v, ancestors.concat([v]))).join(',\n') + '\n' + end + ']';
      }
      const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
      if (!keys.length) return '{}';
      return '{\n' + keys.map(k => pad + JSON.stringify(k) + ': ' + fmt(v[k], indent + 1, k, v, ancestors.concat([v]))).join(',\n') + '\n' + end + '}';
    }
    return fmt(value, 0, null, null, []);
  };
  function fileHeader(kind, projectId, id, title) {
    return [
      `// ${title} — Kit content file, generated by KIT.project.exportFiles (hand edits are fine; keep it valid JSON inside).`,
      kind === 'project' || kind === 'assets' ? `// kind: ${kind}  id: ${projectId}` : `// kind: map  project: ${projectId}  id: ${id}`,
      `// project.js registers KIT.content.projects[${q(projectId)}]; each maps/<id>.js registers KIT.content.maps[${q(projectId)}][<id>].`,
      `// KIT.project.fromContent(${q(projectId)}) assembles the project again; KIT.project.importFiles({ path: text }) parses the texts.`,
    ].join('\n');
  }
  P.exportFiles = function (project) {
    const p = KIT.deepClone(project);
    const pid = (p.meta && p.meta.id) || 'project';
    const maps = p.maps || {};
    delete p.maps;
    const assets = p.assets && Object.keys(p.assets).length ? p.assets : null;
    if (assets) delete p.assets;
    if (p.meta) delete p.meta.modified;
    const files = {};
    files['project.js'] = [
      fileHeader('project', pid, pid, (p.meta && p.meta.title) || pid),
      '(function (root, data) {',
      '  var KIT = root.KIT = root.KIT || {};',
      '  var content = KIT.content = KIT.content || {};',
      `  (content.projects = content.projects || {})[${q(pid)}] = data;`,
      "})(typeof window !== 'undefined' ? window : globalThis,",
      P.stringify(p),
      ');',
      '',
    ].join('\n');
    if (assets) {
      files['assets.js'] = [
        fileHeader('assets', pid, pid, 'imported images'),
        '(function (root, data) {',
        '  var KIT = root.KIT = root.KIT || {};',
        '  var content = KIT.content = KIT.content || {};',
        `  (content.assets = content.assets || {})[${q(pid)}] = data;`,
        "})(typeof window !== 'undefined' ? window : globalThis,",
        P.stringify(assets),
        ');',
        '',
      ].join('\n');
    }
    // An imported map id can carry a namespace ('outside:town'); ':' is legal in
    // an id but not in a filename on every system, so the FILE name is tamed
    // while the id inside the file (and its header) stays exactly as it is.
    const fileName = (id) => id.replace(/[^A-Za-z0-9._-]+/g, '-');
    for (const id of Object.keys(maps).sort()) {
      files[`maps/${fileName(id)}.js`] = [
        fileHeader('map', pid, id, (maps[id].name || id) + ' (map)'),
        '(function (root, data) {',
        '  var KIT = root.KIT = root.KIT || {};',
        '  var content = KIT.content = KIT.content || {};',
        '  var maps = content.maps = content.maps || {};',
        `  (maps[${q(pid)}] = maps[${q(pid)}] || {})[${q(id)}] = data;`,
        "})(typeof window !== 'undefined' ? window : globalThis,",
        P.stringify(maps[id]),
        ');',
        '',
      ].join('\n');
    }
    return files;
  };
  /** parseFile(text) -> { kind:'project'|'map', projectId, id, data } or null when the text is not a Kit content file. */
  P.parseFile = function (text) {
    const m = /^\/\/ kind: (project|map|assets)(?:  project: (\S+))?  id: (\S+)$/m.exec(text);
    if (!m) return null;
    const start = text.indexOf('\n{\n');
    const stop = text.lastIndexOf('\n}\n);');
    if (start < 0 || stop < 0) return null;
    const data = JSON.parse(text.slice(start + 1, stop + 2));
    return { kind: m[1], projectId: m[1] === 'project' || m[1] === 'assets' ? m[3] : m[2], id: m[3], data };
  };
  /** importFiles({ 'project.js': text, 'maps/<id>.js': text, ... }) -> project (not normalized; maps re-attached by id). */
  P.importFiles = function (files) {
    let project = null, assets = null;
    const maps = {};
    for (const name of Object.keys(files || {})) {
      const parsed = P.parseFile(files[name]);
      if (!parsed) continue;
      if (parsed.kind === 'project') project = parsed.data;
      else if (parsed.kind === 'assets') assets = parsed.data;
      else maps[parsed.data.id || parsed.id] = parsed.data;
    }
    if (!project) throw new Error('importFiles: no project.js among the files');
    project.maps = Object.assign({}, project.maps || {}, maps);
    if (assets) project.assets = Object.assign({}, project.assets || {}, assets);
    return project;
  };
  /** fromContent(projectId?) -> project assembled from loaded content files (KIT.content), or null. Without an id, the only loaded project. */
  P.fromContent = function (projectId) {
    const c = KIT.content;
    if (!c || !c.projects) return null;
    const id = projectId || (Object.keys(c.projects).length === 1 ? Object.keys(c.projects)[0] : null);
    if (!id || !c.projects[id]) return null;
    const p = KIT.deepClone(c.projects[id]);
    p.maps = Object.assign({}, p.maps || {}, KIT.deepClone((c.maps && c.maps[id]) || {}));
    if (c.assets && c.assets[id]) p.assets = Object.assign({}, p.assets || {}, KIT.deepClone(c.assets[id]));
    return p;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
