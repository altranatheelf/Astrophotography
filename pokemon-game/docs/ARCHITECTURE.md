# Kit — build contract (architecture v2)

This is the document every builder works from. `DESIGN.md` says why; this says
exactly what. When the two disagree, this one wins. Vocabulary: the engine is
**Kit** (`window.KIT`), the Pokémon parts are the **mons module**, the author's
world is **content**. Creator Mode uses RPG Maker MV's words in its UI (see §13).

## 0. Ground rules for builders

- Plain JavaScript, classic `<script>` files, runs from `file://`. No bundler,
  no ES modules, no TypeScript, no frameworks. JSDoc typedefs for the shapes in
  this document. Readable code over clever code: the author will read it.
- One global for the engine, `window.KIT`, and one for the Pokémon data pack,
  `window.PKMN` (already used by `js/data/*.js` and `js/sprites/*.js`).
- Files that tests `require()` use this shim (each returns the shared object):
  ```js
  (function (root) {
    const KIT = root.KIT = root.KIT || {};
    // ...
    if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
  })(typeof window !== 'undefined' ? window : globalThis);
  ```
- Nothing in `js/kit/` may reference `KIT.modules.*`, `PKMN`, or content. Nothing
  in `js/modules/` may reference content. A test greps for violations.
- Every extensible thing goes through a registry (§3.1). Every editable thing
  has a schema (§3.2). Every edit goes through the document (§4). No exceptions,
  no second mechanism.
- Tests: `node --test test/` from `pokemon-game/`. Browser checks: Playwright
  1.56 + Chromium are installed globally (`export NODE_PATH=$(npm root -g)`);
  open `file:///home/user/Astrophotography/pokemon-game/index.html`.

## 1. File map and load order

```
index.html                       loads everything below, in this order
css/kit.css  css/editor.css
js/kit/core/registry.js          KIT.registry, KIT.defineRegistry
js/kit/core/schema.js            KIT.schema  (field types, validate, defaults, refs, migrate helpers)
js/kit/core/events.js            KIT.events() bus factory
js/kit/core/rng.js               KIT.rng(seed), KIT.hash(...)
js/kit/core/pixels.js            KIT.pixels (exists as js/core/pixels.js — move + rename API per §6.1)
js/kit/core/input.js             KIT.input
js/kit/core/audio.js             KIT.audio
js/kit/core/storage.js           KIT.storage
js/kit/world/document.js         KIT.document(project)  (ops, undo, watch, snapshots)
js/kit/world/project.js          KIT.project  (schema v3, normalize, validate, migrate, helpers)
js/kit/world/tiles.js            tile flags, autotile baking (pure)
js/kit/world/map.js              map view (content + overlay), passability, regions, connections
js/kit/world/entities.js         entity model + movement rules (pure)
js/kit/script/text.js            templating + text codes + word wrap/pagination (pure)
js/kit/script/conditions.js      condition registry + baseline kinds
js/kit/script/commands.js        command registry + baseline commands (definitions; run() uses ctx ports)
js/kit/script/screenplay.js      Screenplay text format: parse/serialize (pure, lossless)
js/kit/script/interpreter.js     run(commands, ctx), threads, labels/loops, blocking rules
js/kit/systems/*.js              movement, behaviours, triggers, companions, clock, inventory, vars, camera
js/kit/scenes/*.js               stack, map, dialogue, choice, nameEntry, chapter, menu, transition, debug
js/kit/render/*.js               renderer, layers cache, sprites, overlays, ui widgets (DOM)
js/kit/game.js                   KIT.game: boot, loop, save/load, settings, testability API
js/kit/editor/*.js               KIT.editor: shell, document glue, tools, inspector, panels, screenplay view, play-here, io
js/art/tiles.js, tiles-*.js      tile art (exists; format §6.2)   js/art/chars.js, chars-*.js   js/art/icons.js
js/data/types.js moves.js pokemon.js   PKMN species data (exists)   js/sprites/*.js  PKMN portraits (exists)
js/modules/mons/manifest.js + *.js     the Pokémon module (§11)
js/content/demo/project.js  js/content/demo/maps/*.js     the demo world
js/content/world/project.js js/content/world/maps/*.js    the author's world (editor export target)
js/main.js                       captures pristine HTML, loads modules in manifest order, boots
tools/  test/  e2e/  docs/
```

Module manifest (`js/modules/<id>/manifest.js`):
```js
KIT.module({
  id: 'mons', version: 1, requires: [],                 // other module ids; boot sorts topologically, fails loudly (banner + console) if missing
  register(kit) { /* add to registries, subscribe to events, declare save section, content schema, editor panels */ },
  save: { key: 'mons', defaults: () => ({ party: [], box: [], dex: {} }), migrate: [ /* (data) => data, by version */ ] },
  content: { fields: [ /* schema for project.packs.mons */ ] },
});
```
`KIT.modules` lists loaded modules; `project.modules` lists which are enabled
for this world (a module not in the list registers nothing for it).

## 2. Namespaces at a glance

```
KIT.registry(name) / KIT.defineRegistry(name, opts)        §3.1
KIT.schema.{types, validate, defaults, refs, walk, migrateChain}   §3.2
KIT.events() -> { on, off, once, emit }                     §8.4
KIT.rng(seed) -> fn ; KIT.hash(a,b,c) -> uint32              deterministic
KIT.document(project) -> doc                                 §4
KIT.project.{normalize, validate, migrate, newMap, resize, blank, clone, exportFiles, importFiles}   §5
KIT.storage                                                  §4.3
KIT.text / KIT.screenplay / KIT.interpreter                  §9
KIT.game / KIT.scenes / KIT.world (runtime)                  §8
KIT.editor                                                   §10
KIT.module(def) / KIT.modules                                §1
```

## 3. Registries and schemas

### 3.1 Registry
```js
KIT.defineRegistry('commands', { fields: [ /* schema for a definition */ ], onAdd(def) {} })
const r = KIT.registry('commands')   // throws if undefined
r.add(def)      // validates against the registry's definition schema; replaces an existing id (logs a warning unless def.replace === true)
r.addAll(list) ; r.get(id) ; r.has(id) ; r.list() (stable insertion order) ; r.remove(id) ; r.on('add'|'remove', fn)
```
Kit-defined registries: `tiles sprites faces icons sounds music objectTypes behaviours
commands conditions itemKinds systems scenes menus editorPanels editorTools fieldEditors
validators presets` (quick-event presets) `migrations`. Modules define more (§11).

### 3.2 Schema
A schema is an array of fields:
```js
{ key:'radius', type:'number', label:'Wander radius', doc:'How far from home it roams', default:3, min:0, max:20,
  nullable:false, parent:'Movement', when:{ field:'kind', eq:'wander' }, display:'radius' }
```
Types (closed set; each has a form widget, a validator, a reference extractor):
`string text note number bool enum color position direction tile region route script
condition strings list group` and references `ref:map ref:tile ref:sprite ref:face
ref:item ref:object ref:script ref:var ref:sound ref:music ref:fragment ref:preset`
(modules may add `ref:<kind>` by registering a resolver: `KIT.schema.refKind('mon', { list(project), label(id) })`).
- `enum`: `options:[{ value, label }]` or `optionsFrom:'itemKinds'` (a registry).
- `list`: `of:<field>`, `array:{ min, max }`. `group`: `fields:[...]`.
- `ref:object`: `ref:{ scope:'sameMap'|'any', tag:'door', symmetrical:true }`.
- `display` hints for the map: `point` (position), `path`|`loop` (list of positions), `radius` (number), `link` (ref:object → arrow), `hidden`.
- `position` values are `{ x, y }` in tiles (plus optional `map` when `ref` across maps is allowed).
- `route` is a list of route steps (§9.3 `moveRoute`). `condition` is a Condition (§9.2). `script` is a command list.
API: `validate(fields, value, ctx) -> [{ path, message }]`, `defaults(fields) -> value`,
`refs(fields, value) -> [{ kind, id, path, access:'read'|'write' }]` (writes: `setVar`,
`setSelf`, `give`… are `write`), `walk(fields, value, fn)`.
Object types register `{ id, label, doc, tags, icon, fields (page props), defaults, maxCount, limit:'moveLast'|'prevent', toc:true, look:{ sprite|tile } }`.

## 4. Document and storage

### 4.1 Document
```js
const doc = KIT.document(project)          // project is normalized first
doc.value                                   // the live object (read-only by convention — never mutate directly)
doc.get(path)                               // path = array of keys/indices
doc.apply(ops, { label:'Paint' })           // ops: {op:'set',path,value} | {op:'del',path} | {op:'splice',path,index,remove,insert}
doc.transaction('Paint stroke', fn)         // everything applied inside is ONE undo step; nested transactions flatten
doc.undo() / doc.redo() / doc.canUndo() / doc.history (labels)   — unlimited within the session
doc.watch(prefixPath, fn)                   // fn({ ops, inverse, label, paths }) for changes under the prefix; doc.watch([], fn) for all
doc.snapshot(label) -> id / doc.snapshots() / doc.restore(id)   // labelled full copies (kept in memory + storage)
doc.dirty / doc.markClean()
```
Inverses are computed at apply time. `set` on a missing intermediate creates
objects (never arrays) — builders must create arrays explicitly. Paths into
tile layers are `['maps', id, 'layers', 'ground', index]`; painting sets one
index per op inside a transaction (the renderer invalidates only touched tiles).

### 4.2 Persistence layout (git-friendly)
`KIT.project.exportFiles(project) -> { 'project.js': text, 'maps/<id>.js': text }`:
pretty-printed, 2-space, keys sorted, tile layers written as one row per line
(strings of ids joined by `,`? no — arrays with 1 map row per text line). No
volatile fields inside content: `meta.modified`, cursor/scroll/selection live in
`KIT.storage` under editor state, never in the project. `importFiles` reverses.
The single-file build embeds `<script id="project-data" type="application/json">`.

### 4.3 Storage
Adapters tried in order: IndexedDB → localStorage → memory (with a visible
warning). Keys (all under `kit.<projectId>.`): `draft` (editor autosave, debounced
500 ms), `editorState`, `save.<slot>` (3 slots + `autosave`), `meta` (survives
New Game), `settings` (global, not per project). API:
```js
KIT.storage.ready() ; get/set/del(key) ; loadProject({ before }) -> { project, source:'draft'|'embedded'|'content'|'default', problems }
                                          before(raw) runs before normalize: modules start here
saveDraft(p) ; discardDraft() ; exportText(obj) -> string ; importText(s) -> obj
download(name, text) ; canPublish() ; publish(project) ; captureHtml()
saveGame(slot, state) ; loadGame(slot) ; listGames() ; deleteGame(slot) ; exportGame(slot) -> string ; importGame(string)
```
`publish()` regenerates the page from `KIT.PRISTINE_HTML` (captured by
`main.js` before any DOM mutation) replacing the `project-data` block, then calls
the artifact capability if present (`typeof claude !== 'undefined'`); never
serialises the live DOM. Every capability probe has a 10 s timeout → null.
Cross-tab: the draft carries `writerId`; a second tab that sees a foreign
`writerId` change goes read-only with a banner.

## 5. Project format v3

```js
{
  version: 3,
  meta: { id:'our-adventure', title, subtitle, author, pitch /* the two sentences */, created },
  modules: ['mons'],
  settings: { tileSize:16, viewport:{ w:16, h:12 }, textSpeed:'normal', zoom:'auto', coop:{ enabled:false },
              palette:{ remap:{}, tint:null, amount:0 }, encounterRate:12 /* module settings live in packs */ },
  strings: { 'got-item':'Got {count} {item}!', 'save-prompt':'Save your progress?', ... },   // Terms table; kit + modules declare keys with defaults
  heroes: [ { id:'p1', name:'Player 1', sprite:'hero-boy', recolor:{} }, { id:'p2', name:'Player 2', sprite:'hero-girl', recolor:{} } ],
  start: { map:'home', x:5, y:6, dir:'down' },
  vars: { chapter:{ type:'number', default:0, label:'Chapter', group:'Story' }, metMom:{ type:'bool', default:false } },   // declared; undeclared names are allowed and auto-collected (validator warns)
  items: { berry:{ kind:'berry', name:'Berry', icon:'berry', desc:'', note:'', props:{} } },
  scripts: { 'meet-mom': { label:'Meet Mom', trigger:'call'|'auto'|'parallel', when:null|Condition, params:[], body:[Command], note:'' } },
  fragments: [ { id, kind:'note'|'dialogue'|'audio'|'image'|'map-idea', title, body, tags:[], folder:'' } ],
  testStates: [ { id, label, map, x, y, dir, vars:{}, inventory:{}, modules:{} } ],
  autotiles: { default: { source:'terrain', groups:[ { id:'grass-path', name, active:true, terrain:2,
                 rules:[ { size:3, pattern:[0,-2,0, -2,2,-2, 0,-2,0], tiles:['path'], mode:'single', chance:1, breakOnMatch:true, flip:'none', outOfBounds:null, modulo:{x:1,y:1,ox:0,oy:0} } ] } ] } },
  terrains: [ { id:1, name:'Grass', color:'#58b848', base:'grass' }, { id:2, name:'Path', color:'#d8b878', base:'path' } ],
  world: { maps:{ town:{ x:0, y:0, folder:'Chapter 1' } }, connections:[ { a:'town', side:'s', b:'route', offset:0 } ] },
  maps: { town: Map },
  packs: { mons: { /* module content, validated by the module's content schema */ } },
}
Map = { id, name, width, height, kind:'outdoor'|'indoor'|'cave'|'garden'|string, music:null|id, note:'',
        layers: { terrain:[int], ground:[tileId], deco:[tileId|null], above:[tileId|null], regions:[int 0-255] },
        collision: [ null|0|1|'n'|'s'|'e'|'w' ],            // override: 1 solid, 0 walkable, 'n' = cannot pass northward edge (ledge/one-way)
        objects: [ Object ], props: {} }
Object = { id:'mom', name:'Mom', type:'npc', x, y, note:'', pages:[ Page ] }
Page = { when: null|Condition,
         sprite:'woman', dir:'down', layer:'same'|'below'|'above', through:false, dirFix:false, stepAnim:false, visible:true,
         behaviour: { kind:'none'|'wander'|'look'|'route'|'approach', radius:3, speed:1, frequency:2, route:[steps], repeat:true },
         on: { interact:[Command], step:[Command], touch:[Command], enter:[Command], tick:[Command], init:[Command] },   // all optional
         once:false, needsBoth:false, props:{ /* object type fields */ } }
```
Rules:
- **Page resolution: the LAST page whose `when` passes is active** (MV order).
  `when: null` passes. Pages are evaluated when vars/self/inventory change.
- Trigger semantics (must be documented in editor tooltips): `interact` = A
  while facing (or over, for `below` objects); `step` = a hero enters the tile
  (for `below`/`above` objects) or bumps it (for `same`); `touch` = the object's
  own movement collides with a hero; `enter` = when the map is entered and the
  page is active (runs every entry unless `once`); `tick` = parallel, every
  frame while active, does not block input (validator warns > 3 per map);
  `init` = once when the object first appears on this map visit. `enter` and
  `auto` scripts BLOCK input until they end; the validator warns if such a
  script never changes anything its `when` depends on (soft-lock guard).
- `once` = sugar for `self.done` on the page's interact/step/touch.
- Object state in the save: `objects['town:mom'] = { self:{}, hidden, x, y, dir }`.
  `hidden` persists (MV's Erase Event made permanent); `erase { persistent:false }` hides until map re-entry.
- Migrations: `KIT.registry('migrations')` entries `{ from:2, to:3, up(project) }`;
  `normalize` runs the chain, then fills defaults and validates.
- Validation returns `[{ severity:'error'|'warn', code, message, where:{ map, object, page, path } }]`.

## 6. Art and assets

### 6.1 Art format and `KIT.pixels`
Pixel-string art: `{ w, h, palette:{ch:'#hex'}, rows:[...] }` or `frames:[rows...]`.
Image art: `{ image:'assets/heroes.png' | dataURI, frame:{ x, y, w, h }, frames:[rects] }`.
`KIT.pixels.canvas(art, { scale, mirror, recolor, frame, tint }) ` (cached),
`draw(ctx, art, x, y, opts)`, `downscale(art, size)`, `silhouette(w, h, color)`,
`validate(art)`, `load(image) -> Promise` (for image-backed art). Missing art never throws: `silhouette` is used and a warning logged once.

### 6.2 Tiles registry entry
```js
{ id:'tall-grass', name, group:'nature', art|frames, solid:false, passage:{ n:true, s:true, e:true, w:true },
  bush:true /* hero legs hidden */, counter:false /* interact across */, ledge:null|'down', warpLook:false,
  encounter:true, terrainTag:0, probability:1, animMs:500, note:'' }
```
Existing `js/art/tiles-*.js` register via `PKMN.TILES.register` — the first
foundation task renames this to `KIT.registry('tiles').addAll` (sed in art files;
keep the art untouched) and moves the stamps into the registry `presets`? No:
stamps stay `KIT.registry('tiles').stamps` (multi-tile brushes).
Autotile baking: `KIT.tiles.bake(map, project) -> { ground, deco }` pure and
deterministic (per-cell seed `KIT.hash(seed, x, y)`), re-run within radius
(rule size) after a terrain edit. Baked tiles are stored in `ground`/`deco` so
the runtime never needs rules; the runtime overlay can call `bake` too.

### 6.2b The cast (`project.cast`, `project.facts`)
```js
cast: { mira: { id, name:'Mira', pronouns:'they/them', sprite, face, group:'The house',
                met:false, knows:['the-door'], feels:{ wren:30 }, tags:[], note:'' } }
facts: { 'the-door': { id, label:'The door in the orchard', secret:false, group, note } }
```
People, rather than sprites on maps: somebody in the cast need never appear on a
map, and an NPC on a map need not be anybody in particular. `KIT.cast` is the
whole surface (KIT-API §world/cast); `@tell` / `@spread` / `@feel` / `@meet` are
the script side, `knows` / `feels` / `met` the conditions, and the Cast panel
draws the graph both ways — per person, and per fact. A fact need not be
declared; the panel marks an undeclared one so you can write it down later.

### 6.3 Characters, faces, icons, audio
Characters: existing format (`frames:{down,up,left}` × 3, right = mirrored),
registered in `sprites`. Faces: `faces` registry (`{ id, art }`, 48×48 pixel or
image). Icons: `icons`. Audio: `sounds`/`music` entries are `{ id, kind:'synth', recipe }`
or `{ id, kind:'file', src }`; `KIT.audio.play(id)`, `startMusic(id)`, `stopMusic()`,
`playAt(id, { map, x, y })` (diegetic, distance fade). MV sheet importer is Phase 5.

## 7. Save format v2
```js
{ version:2, projectId, savedAt, playtimeMs, slotLabel,
  heroes:[ { map, x, y, dir }, { x, y, dir } ], activeHero:0,
  vars:{}, inventory:{ berry:3 }, objects:{ 'town:mom':{ self:{}, hidden:false } },
  overlays:{ home:{ tiles:{ '5,6':{ deco:'plant' } }, objects:[] } },
  modules:{ mons:{...} }, clock:{ day:1, minutes:480, lastSeenAt:ISO }, timer:{ running:false, secondsLeft:0 },
  cast:{ mira:{ met:true, knows:{ 'the-door':{ at:1920, from:'wren' } }, feels:{ wren:55 } } },
  music:{ current:'town', saved:null } }
meta (separate key, survives New Game): { runs:0, firstPlayed, endingsSeen:[], namesUsed:[], … }
  — plus whatever @remember has written. It is the game's memory of the PLAYER
  rather than of the run, which is why it lives outside every save.
```
Loading a save whose objects/maps no longer exist ignores those entries. Save
migrations are a registry chain like project migrations. Export/import as text.

## 8. Runtime

### 8.1 Game and scenes
`KIT.game.boot({ project, mount })` builds the renderer, input, audio, storage,
world, scene stack; `KIT.game.newGame({ names, testState })`, `continueGame(slot)`,
`update(dt)` fixed 60 Hz, render on rAF. Scene interface:
```js
{ id, transparent:false, enter(params), exit(), update(dt), render(ctx), input(ev), result }
await KIT.scenes.run(scene, params) -> result     // push, wait for scene.done(result), pop
KIT.scenes.top(), .stack, .replace(scene)
```
Kit scenes: `title map dialogue choice nameEntry inputNumber chapter menu transition
debug picture`. Modules add scenes (`catch`).

### 8.2 World and entities
`KIT.world` = `{ project, save, map (current MapView), entities, events, clock, rng }`.
`MapView` composes `project.maps[id]` + `save.overlays[id]`; exposes
`tileAt(layer, x, y)`, `region(x, y)`, `passable(x, y, fromDir, who)`,
`objectsAt(x, y)`, `connectionAt(x, y)`. Entities are plain objects:
`{ id, kind:'hero'|'npc'|'object'|'companion', x, y, dir, px, py (interpolated), sprite, art, layer, through, solid, mover:{...}, behaviour, page, visible }`.
Movement rules (pure, in `entities.js`): grid steps at `speed` tiles/s (default
~7), turn-in-place on short tap, `passage` flags per tile edge, `collision`
overrides, ledges (`ledge:'down'` = hop 2 tiles southward only), `bush` (draw
legs clipped), `counter` (interact reaches across), `through`, map `connections`
(walk off an edge into the neighbour at the same offset), heroes cannot enter
solid objects unless `through`.

### 8.3 Systems (registered, run in `order`)
`movement(10) behaviours(20) triggers(30) companions(40) clock(50) camera(90)` +
module systems. Each: `{ id, order, update(world, dt) }` and optional
`onMapEnter/onMapLeave`. `triggers` dispatches page slots per the semantics in §5.

### 8.4 Events (bus on `world.events`)
`step {hero,x,y,tile,region}` `interact {hero,object}` `mapEnter {map}` `mapLeave {map}`
`varChanged {name,old,value}` `selfChanged {objectKey,key}` `itemChanged {id,delta}`
`objectStateChanged {objectKey}` `clockTick {minutes}` `sessionResumed {elapsedMs,minutesAdded}`
`interactMissed {hero,x,y,dir}` (A was pressed and nothing answered)
`scriptStart/scriptEnd {id}` `sceneChange {id}` + module events. Systems and
modules listen; nothing polls except `tick` slots.

### 8.5 Renderer, input, audio, clock
Renderer: canvas; per-layer offscreen caches per map (invalidated by document
`paths`); entities sorted by `py` then layer; `above` layer; overlays (fade,
tint, flash, weather, palette remap); integer scale (tile ≈ 40 CSS px on
phones, 48 desktop, setting small/normal/large); DPR-aware;
`imageSmoothingEnabled=false`. Viewport 16×12 tiles by default (settings).
Input: players→heroes mapping; P1 arrows/Z/X/Enter/Esc, P2 WASD/F/G; on-screen
d-pad + A/B/menu per player (pointer events, `touch-action:none`, one pointer
per pad, ≥ 56 px targets); swipe on canvas; `KIT.input.state(player)`, `onPress`.
Audio: WebAudio synth (existing recipes) + file playback; silent until first
gesture; unlock on `pointerup`/`touchend`; iOS: resume context on visibility.
Clock (`KIT.clock`): two different things, both here. The RUNNING clock advances
in-game minutes with steps and time when `settings.clock.enabled`. The GAP is
measured whether or not that is on: `save.clock.lastSeenAt` is re-stamped every
`stampEverySeconds`, and `world.update` emits `sessionResumed { elapsedMs,
minutesAdded }` once, at the end of the first tick, so every system has its
listeners on. `awayMinutesPerRealMinute` (capped by `awayCapMinutes`) turns the
gap into in-game minutes. `timer` command drives `save.timer`.
`KIT.clock.of/add/stamp/gap/resume/settings`.

## 9. Script language

### 9.1 Command registry
```js
KIT.registry('commands').add({
  id:'give', label:'Change Items', group:'Party', icon:'bag', mv:'Change Items',
  fields:[ { key:'item', type:'ref:item' }, { key:'count', type:'number', default:1 }, { key:'mode', type:'enum', options:['give','take'], default:'give' } ],
  async run(ctx, cmd) { ... },                      // ctx: { world, io, rng, self, hero, thread, project }
  summary(cmd, ctx) -> 'Give 3× Berry',            // card text
  text:{ toLine(cmd) -> '@give berry 3', fromLine(line) -> cmd|null },   // optional Screenplay sugar; generic form always works
  blocking:true, editor:{ favourite:true } })
```
`ctx.io`: `say(opts)`, `choice(opts)`, `nameEntry`, `inputNumber`, `toast`,
`chapter`, `fade`, `tint`, `flash`, `shake`, `weather`, `picture`, `scrollText`,
`menu`, `wait(ms)` — all promise-returning scene calls; in tests a fake io answers them.

### 9.2 Baseline commands (id — MV label — fields; semantics)
Message: `say` (Show Text: who, face, text, position top|middle|bottom, bg window|dim|none), `choice` (Show Choices: prompt, options[{text, when?, then[]}], cancel), `inputNumber` (var, digits), `scrollText`.
Progression: `setVar` (Control Variables: name, op set|add|sub|mul|div|mod|random|copyVar, value|var|min,max), `setSelf` (Self state: key, op, value), `timer` (Control Timer: start seconds|stop).
Flow: `if` (Conditional Branch: when, then[], else[]), `loop` (body[]), `break`, `label`, `jump`, `exit` (Exit Event Processing), `call` (Common Event: script, args), `comment`, `wait` (ms), `group` (label, body[] — no runtime effect), any command may carry `disabled:true` (skipped, drawn dimmed).
Party: `give`/`take` (Change Items), `nameEntry` (hero, prompt).
Movement: `transfer` (Transfer Player: map, x, y, dir, fade), `setLocation` (Set Event Location: target, x, y | swap), `moveRoute` (Set Movement Route: target self|p1|p2|obj:id, steps[], wait, skipBlocked, repeat), `scrollMap` (dx, dy, speed), `follow` (companion on/off).
Character: `transparency`, `animation` (Show Animation: target, id), `balloon` (Show Balloon: target, kind ! ? ♥ ♪ … zzz sweat anger), `erase` (persistent).
Screen: `fadeOut`, `fadeIn`, `tint`, `flash`, `shake`, `weather` (none rain snow fog, power).
Picture: `pictureShow` (id, image, x, y, anchor, opacity), `pictureMove`, `pictureErase`.
Audio: `music` (Play BGM: id|null, fade), `sound` (Play SE), `stopSound`, `saveMusic`, `replayMusic`, `jingle` (ME).
System: `menu` (open), `save` (prompt), `title` (return), `chapter` (title card), `heal` (kit-level hook: emits `heal` event), `debug` (log).
Route steps (for `moveRoute` and `behaviour.route`): `up down left right`, `randomStep`, `towardHero`, `awayHero`, `face:<dir>`, `faceHero`, `turnRandom`, `jump:dx,dy`, `wait:ms`, `sprite:<id>`, `speed:n`, `through:on|off`, `visible:on|off`, `sound:<id>`, `dirFix:on|off`, `stepAnim:on|off`.

### 9.3 Conditions
`{ kind:'var', name, op ==,!=,<,<=,>,>=, value|var }` `{ kind:'self', key, op, value }`
`{ kind:'item', id, op, count }` `{ kind:'facing', target, dir }` `{ kind:'button', key }`
`{ kind:'timer', op, seconds }` `{ kind:'region', id, target }` `{ kind:'tile', layer, id, at }`
`{ kind:'meta', key, op, value }` `{ kind:'clock', from, to }` `{ kind:'coop' }`
`{ kind:'all'|'any', of:[...] }` `{ kind:'not', of }` + module kinds (`has`, `dexCount`, `friendship`).

### 9.4 Text
Templating: `{p1} {p2} {p} {var:name} {self:key} {item:id} {hero}` + module tags.
Codes: `{pause}` `{pause:800}` `{wait}` (wait for input mid-message) `{fast}` `{instant}`
`{color:red}…{/color}` `{icon:berry}` `{size:big}…{/size}` `{shake}`. Word wrap to the
box width in the dialogue font metrics, auto-pagination into N boxes (3 lines
each by default), `\n` forced break. `KIT.text.render(str, ctx) -> [{ pages:[[spans]] }]`, pure.

### 9.5 Screenplay (text view of a script) — lossless by construction
```
:: meet-mom [auto] when: chapter == 0            # header (scripts file); body lines follow
Mom: Good morning, {p1}! {pause} Sleep well?
Mom (face=mom-smile, at=top): The Professor was asking for you.
  Narration without a speaker is a line in quotes:
"The kettle whistles."
? Ready to go?                                  # choice prompt
- Yes
    Mom: Take these.
    @give item=berry count=3
- Not yet
    Mom: Take your time.
@if when: chapter >= 2
    Mom: Off you go.
@else
    Mom: Don't forget your bag.
@end
@set chapter = 2            # sugar for @setVar name=chapter op=set value=2 ; also += -= *=
@self opened = true          # sugar for @setSelf
@call meet-mom
@transfer map=town x=10 y=12 dir=down
@move target=self steps="up up left" wait=true
@wait 500                    # sugar for @wait ms=500
@sound sparkle  |  @music town  |  @fade out  |  @shake  |  @balloon target=self kind=!
# a comment line becomes a comment command
```
Grammar: one command per line; blocks (`then`, `else`, choice options, loop,
group) are indented by 4 spaces or a tab; `Name:` prefix = `say`; a leading
`"` = narration; `?` = choice; `-` = option; `@id key=value …` is the generic
form for every command (values: bare words, numbers, `"quoted"`, `true/false`);
a command may add sugar (`toLine/fromLine`). Unparsable lines become
`{ t:'raw', line }` (preserved verbatim, shown as a warning card) — nothing is
ever dropped. `serialize(parse(text))` equals canonical text and
`parse(serialize(cmds))` deep-equals `cmds` (tests enforce for the demo and the
author's world). Twee-like whole-project export: `:: <script-id>` sections plus
`:: <map>/<object>/<page>/<slot>` sections; import re-attaches by id.

### 9.6 Interpreter
`KIT.interpreter.run(commands, ctx) -> Promise` with `ctx.thread` = `{ id, pc stack, labels, cancelled, breakpoints }`;
`auto`/`enter`/`interact`/`step`/`touch` scripts run on the **main thread**
(input locked, at most one main script at a time; a second request queues);
`tick`/`parallel` run on **background threads** (no `say`/`choice` allowed —
validator error; interpreter throws if attempted). `call` passes `args` as
`{arg:name}` template values and local vars. `label/jump` within a body;
`loop/break`; `exit` ends the thread. Threads are observable (`KIT.interpreter.threads()`)
for the Debug panel; breakpoints pause the main thread (`thread.pause()/step()`).
Determinism: all randomness via `ctx.rng`.

## 10. Creator Mode (`KIT.editor`)

Shell: top bar (mode strip **EDITING / PLAYING** with colour, map selector with
folders + search, Undo/Redo, save status, ☰ menu: Snapshots, Export, Import,
Publish, Reset demo, Help/Vocabulary). Centre: the map canvas (pan: drag on
empty space or two fingers; zoom buttons; grid; collision/regions/terrain
overlays toggles). Side panel (bottom sheet on phones, tabs scroll):
- **Tiles**: Terrain brush (default; paints `terrain`, re-bakes within rule radius, live), Pencil, Fill, Rect, Eraser, Eyedropper, Stamp (multi-tile selection or registry stamp), Random (set + seeded), Regions mode (0-255 palette with names), layer selector (ground/deco/above), Autotile rules sub-view with the **template wizard** (edges/corners/inner corners → rule group) and remap-terrain.
- **Objects** (Events): list per map with search + Find usages; Add: NPC / Sign / Item / Door(Transfer) / Trigger / **Presets** registry (Door, Sign, Item on ground, Transfer pair, Wild Pokémon…); tap-tap placement and moves (no drag required); **Inspector** = schema-driven form over the selected thing (object → pages as tabs, page → props/behaviour/slots; last page wins is shown as "later pages override earlier ones"); inherited defaults greyed with reset; map-drawn fields (`point/path/radius/link`) drawn on the canvas and editable by tapping.
- **Script editor** for every slot/script: command cards (searchable Add with favourites/recent, multi-select, copy, paste above/below, disable, group, collapse branches, drag or ▲▼), inline fields per schema (textarea with live dialogue preview for `text`), nested blocks; a **Screenplay** toggle showing the same script as text (§9.5) with error markers; broken `ref:*` → "Create <kind> <id>" / "Create as fragment".
- **Map**: name, kind, size (anchor top-left), music, note, connections (pick side + neighbour), start-here, module props (encounters by region), test-state save.
- **World**: maps as cards on a canvas (positions from `world.maps`), warp/call arrows, folders, connections drawn edge-to-edge; tap to open.
- **Scripts** (Common Events): list, triggers, params; **Fragments**: notes/dialogue/audio/image with folders/tags; drag/assign to a slot or map.
- **Project**: title, subtitle, **pitch (two sentences, required)**, heroes (sprite + recolour), start, settings, palette dial, modules on/off, items table, **Strings** (Terms), **Variables** (declared vars with types/groups, usages with reads vs writes), test states.
- **Dialogue Review**: every `text` field in the project, searchable, editable in place (produces the same patches).
- **Problems**: validator output with jump-to. **Data**: raw JSON of the selection/project, editable with validation. **Debug** (PLAYING): running threads, breakpoints, pause-on-var-change, live vars/inventory/self editing, warp-to, give item/mon, step.
- **Play here**: cursor tile + facing; starting state picker: New game / Current save / Test state; "Back to editor here"; tap a thing while playing (with edit-tap mode) to select it in the inspector. Edits while PLAYING apply to the document immediately (the running map view re-reads); the strip says so.
Undo is universal (inspector, deletes, paint, scripts). Delete always confirms
or is undoable, never adjacent to navigation on phones. Keyboard: 1-6 tools, G
grid, C collision, R regions, [ ] layer, Ctrl+Z/Shift+Z, Ctrl+S export, F5 play.
Every panel is registered (`editorPanels`), every tool (`editorTools`), every
field widget (`fieldEditors`), so modules extend the editor without core edits.

## 11. The mons module (Phase 3; contract summary)
Registries it adds: `species` (from PKMN data), `mon` ref kind, object type
`pokemon` (wild|friendly, mon, shiny), condition kinds `has`, `dexCount`,
`friendship`, commands `givePokemon`, `encounter`, `friendship`, item kinds
`ball`, `berry`, scene `catch` (encounter **profiles** from `packs.mons.profiles`:
actions `[{ id, label, kind:'throw'|'offer'|'talk'|'wait'|'leave', effects }]`,
strings, art), systems `encounters` (on `step` by region table), `companion`
(follower), `garden` (on maps with `kind:'garden'`), save section
`{ party, box, dex, follower, seen }`, menus Pokémon / Pokédex / Bag, editor panel
"Wild Pokémon" (per-map tables by region with weights), events `monCaught`,
`friendshipChanged`. Friendship 0-255, thresholds 50/100/150/200/255, gains:
walking +1/128 steps, pet +3 (1/visit), berry +10, `sessionResumed` bonus.

## 12. Testability and test plan
`window.KIT.game` exposes `state`, `project`, `world`, `scene()`, `newGame`,
`warp(map,x,y,dir)`, `press(key, player)`, `tick(ms)`, `rngOverride`, and `?fast=1`
makes typewriter/animations instant; `?edit=1` opens Creator Mode; `?test=<id>`
starts from a test state. DOM ids: `#screen-title #game-canvas #dialogue #choice
#pause-menu #chapter #toast #editor #mode-strip`, buttons `[data-btn]`,
`[data-player]`, `[data-action]`, panels `[data-panel]`, tools `[data-tool]`.
Tests (Node): registry/schema (validate, defaults, refs incl. read/write,
display hints), document (ops, inverses, transactions, watch prefixes,
snapshots, unlimited undo), project (normalize v2→v3 migration, validate codes,
resize, export/import files round-trip with sorted keys), tiles (autotile bake
determinism + locality), map view (passage, ledges, counter, bush, connections,
overlays), entities (movement rules), text (templating, codes, wrap/paginate),
conditions, commands (each baseline command with a fake io), screenplay
(lossless both directions; raw-line preservation), interpreter (threads,
labels/loops, blocking rules, call args, breakpoints), storage (adapters
fallback, export/import), save (migrations, missing-object tolerance), layering
grep, world lint of demo + author content. Browser (Playwright): walk/talk/doors
/save/load/coop play-through; editor round-trip (paint terrain → bake → place NPC
→ write screenplay → play here → talk); phone 390×844 with touch and desktop
1280×800; no console errors; screenshots reviewed.

## 13. Vocabulary (editor labels use the MV word)
Event = object · Event Page = page · Switch/Variable = var · Self Switch = self state ·
Common Event = script · Plugin = module · Region = region · Transfer Player = transfer ·
Set Movement Route = moveRoute · Show Balloon Icon = balloon · Action Button / Player
Touch / Event Touch / Autorun / Parallel = interact / step / touch / enter(auto) / tick ·
Note = note · Terms = strings · Test Play = Play here · Database = Project panel.
Deliberately better than MV (shown on the Help page): unlimited undo everywhere;
unlimited page conditions with all/any/not; named unlimited self state; find
usages with reads vs writes; play from any tile with a chosen state; editing
inside the game; autotiles you define; word-wrapped, paginated, text-editable
dialogue; typed module fields with real forms; saves that survive content changes.

## 14. Build phases and acceptance
1. **Foundation** — core (registry, schema, events, rng, pixels move, storage), document, project v3 (+ migration from the current art/data), tiles (bake), text, conditions, commands (definitions + summaries + screenplay sugar), screenplay, interpreter with fake io. All Node-tested. *Accept:* `node --test` green; screenplay round-trip on a 40-command sample; interpreter runs a branching script with a fake io deterministically.
2. **Runtime** — world/map/entities/systems, scenes, renderer, input, audio wiring, game boot, title/pause/settings/save, demo world (home/town/lab/route/garden with terrain+autotiles, regions, connections, scripts using ≥ 25 distinct commands). *Accept:* Playwright walk/talk/doors/save/coop at both viewports, no console errors, screenshots reviewed.
3. **Creator Mode v1** — shell, document glue, tools incl. terrain brush + wizard, inspector, script editor + screenplay, pages, objects list, map/world/project/strings/variables panels, problems, data, play-here with state picker, debug panel, presets, clipboard, I/O + publish. *Accept:* the editor round-trip e2e; a map made only in the editor plays; undo across panels.
4. **mons module** — §11. *Accept:* catch/garden e2e; wild-table panel edits play.
5. **Importers & polish** — MV sheet importer, Dialogue Review, Twee export, snapshots UI, single-file build budget warnings.
Each phase ends: tests green, e2e green, pushed, single-file build produced.
