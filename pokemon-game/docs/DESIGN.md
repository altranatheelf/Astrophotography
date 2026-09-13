# Design: the Adventure Kit

*A small, deliberate engine for a Pokémon-style story adventure with a built-in
creator mode. This document is the "why and how" — read it before touching the
code. `ARCHITECTURE.md` is the detailed contract that follows from it.*

---

## 0. What we are optimising for

The person making this game wants to **decide the direction, iterate for a long
time, and keep adding ideas** (jobs for caught Pokémon, decorating, mini-games,
co-op moments, a personal story). So the engine is judged by one question:

> When a new idea shows up six months from now, how many existing files have to
> change, and can the old saves and the old maps survive it?

The answer should be "one new module, zero core edits, saves keep working."
Everything below serves that. The three enemies are: logic tangled with
rendering, content tangled with code, and editors hand-built per feature.

## 1. Principles (the rules every piece follows)

1. **Layers only point down.** `content → modules → kit`. The kit (engine) knows
   nothing about Pokémon. The Pokémon module knows nothing about *this* story.
   The story is data.
2. **Everything extensible is a registry with a schema.** Tiles, sprites, object
   types, script commands, conditions, NPC behaviours, item kinds, systems,
   scenes, menus, editor panels, editor tools, validators, save sections,
   migrations. Registering a thing declares its *fields* (a schema), and the
   editor forms, the validator, "find usages", the docs page and the save format
   are all derived from that one declaration. This is the single biggest lever
   for iteration: a new command is one registration, and it gets an editor UI
   for free.
3. **Simulation is headless.** Movement rules, the script interpreter, systems,
   catching maths — all run on plain objects with injected ports (`rng`,
   `clock`, `io`) and are tested in Node without a browser. Canvas, DOM, audio,
   touch are adapters at the edge.
4. **The world is a document; edits are patches.** The editor never mutates the
   project directly. Every change is an operation with an inverse, applied
   through one door. Undo/redo, dirty tracking, autosave, validation, live
   re-render and (later) collaboration come from that door, for every panel
   that will ever exist.
5. **Saves hold state, never content.** Stable string ids everywhere; a save is
   `{ where you are, what you've done, what you own }`. Change the map, rename
   an NPC, add a chapter — old saves still load. Structural changes get numbered
   migrations, for saves *and* projects.
6. **Scenes are a stack and return values.** Dialogue, choices, menus, the catch
   mini-game, the editor, future mini-games: all scenes. A script `await`s a
   scene and gets its result. Adding a mini-game never touches the interpreter.
7. **Plain, readable JavaScript.** No bundler, no framework, no TypeScript
   (JSDoc for the important shapes). Classic scripts that run from `file://`.
   The author will read this code with Claude; clarity beats cleverness.
8. **YAGNI guardrails.** No generic ECS framework, no networking, no plugin
   loader from URLs. Registries + schemas + patches + scenes are the whole
   extension story; we do not add a second mechanism for the same job.

## 2. Layering and module map

```
js/kit/                       the engine — generic top-down tile RPG toolkit
  core/    registry.js schema.js events.js rng.js clock.js pixels.js input.js audio.js storage.js
  world/   document.js (project doc + patches + undo)  project.js (schema, normalize, migrate)
           map.js (tiles/layers/collision/overlays)  objects.js (object types, pages, conditions)
           entities.js (runtime entities on a map)   camera.js
  script/  commands.js (registry) conditions.js (registry) interpreter.js text.js
  systems/ movement.js behaviours.js warps.js triggers.js companions.js inventory.js vars.js
  scenes/  stack.js map-scene.js dialogue.js choice.js name-entry.js chapter.js menu.js transition.js
  render/  renderer.js layers.js sprites.js overlays.js ui/ (dialogue box, list menu, toast — DOM widgets)
  editor/  editor.js (shell, scene) tools/ (pencil fill rect erase pick select place) inspector.js (schema → form)
           panels/ (tiles objects map project scripts problems) fields/ (custom field editors) validate.js io.js
  game.js  boot, scene stack owner, save/load, settings, testability API
js/modules/
  mons/    species.js mon.js party.js dex.js  catch/ (encounter system, catch scene, ring mini-game)
           garden.js companion.js commands.js conditions.js menus.js save.js
  (future) jobs/ decor/ cooking/ weather/ ...
js/content/
  demo/    the demo world (kept as a living example)
  world/   the author's world (what the editor exports; committed to git)
js/art/  js/sprites/  js/data/      pixel art and species data (already exist)
css/  index.html  main.js  tools/  test/  e2e/  docs/
```

Dependency rule, enforced by a test that greps `require`/`PKMN.` usage:
`kit` never references `modules` or `content`; `modules` never reference
`content`. A module may depend on another module only through the registries
(events, commands, conditions) — never by importing its internals.

## 3. Data model

### 3.1 Project (content)

```js
{
  version: 2,                                  // project schema version (migrations below)
  meta:     { title, subtitle, author, created, modified },
  settings: { textSpeed, encounterRate, catchDifficulty, coop: { enabled, mode }, zoom, ... },
  heroes:   [ { id:'p1', name, sprite, recolor:{} }, { id:'p2', ... } ],
  start:    { map, x, y, dir },
  items:    { berry: { kind:'berry', name, icon, desc, props:{...} }, ... },   // kinds are a registry
  scripts:  { 'give-balls': [ ...commands ] },                                   // reusable "common events", called by name
  maps:     { town: Map, ... },  mapOrder: [ 'home', 'town', ... ],
  vars:     { chapter: { type:'number', default:0, label:'Chapter' } },          // declared variables (optional; undeclared ones are allowed and auto-collected)
  modules:  { mons: { rarity overrides... }, ... }                                // per-module content, validated by that module's schema
}
Map = { id, name, width, height, kind:'outdoor'|'indoor'|'garden'|..., music, tileset:'default',
        layers: { ground:[ids], deco:[ids|null], above:[ids|null] }, collision:[null|0|1],
        objects: [ Object ], props: { encounters:{...}, ... /* module-owned, by schema */ } }
Object = { id:'mom', name:'Mom', type:'npc', x, y,
           pages: [ Page ] }                       // conditional variants; first page whose `when` passes is active
Page   = { when: Condition|null, sprite, dir, behaviour:{ kind:'wander', radius:3 }, trigger:'interact'|'step'|'auto'|'parallel',
           once:false, needsBoth:false, script:[ Command ], props:{...} }       // props are the object type's schema fields
Condition = { kind:'var', name:'chapter', op:'>=', value:2 } | { kind:'item', id:'berry', min:1 } | { kind:'all', of:[...] } | { kind:'any', of:[...] } | { kind:'not', of: c } | module-registered kinds
Command   = { t:'say', who:'Mom', text:'...' }  // fields per the command's schema; branches are arrays of commands
```

Why **pages** (borrowed from RPG Maker): "Mom says something different after
chapter 2 and is now in the kitchen" is a second page with `when: chapter>=2`
— no scripting gymnastics, no hidden state. Simple objects have one page.

Why **one `vars` map with typed values** instead of separate flags/switches/
variables: fewer concepts for the author, one editor panel, one condition kind.
`{kind:'var', name:'metMom', op:'==', value:true}` is a flag.

Why **`props` bags validated by schema** on items/pages/maps: modules add
fields (a wild-encounter table on maps, rarity on species, `jobs` on a job
board) without the kit knowing them, and the editor still renders them.

### 3.2 Save (state)

```js
{ version: 2, projectId, savedAt, playtimeMs,
  heroes: [ { map, x, y, dir }, { x, y, dir } ], activeHero: 0,
  vars: { chapter: 1, metMom: true, coins: 4 },
  inventory: { berry: 3, pokeball: 5 },
  objects: { 'town:mom': { done:true, hidden:false, x:7, y:4 } },  // per-object state keyed by stable id; missing = defaults
  overlays: { home: { tiles: { '5,6': { deco:'plant' } }, objects: [...] } },   // player-made changes to maps (decorating) — never touches content
  modules: { mons: { party:[...], box:[...], dex:{...}, follower }, garden: {...} },   // each module owns its section (defaults + migrate registered)
  clock: { day: 3, minutes: 540 } }
```

The **overlay** section is the deliberate hook for "decorate your home" and any
future player-driven world change: the renderer composes `content map +
overlay`, and the runtime placement UI reuses the editor's tools on the overlay
instead of the document.

### 3.3 Registries and schemas (the extension mechanism)

```js
PKMN.registry('commands').add({
  id: 'give', label: 'Give item', group: 'Inventory', icon: 'bag',
  schema: [ { key:'item', type:'ref:item', label:'Item' }, { key:'count', type:'number', default:1, min:1 } ],
  run: async (ctx, cmd) => { ctx.inventory.add(cmd.item, cmd.count); await ctx.io.toast(`Got ${cmd.count} ${ctx.itemName(cmd.item)}!`); },
  summary: (cmd, ctx) => `Give ${cmd.count}× ${ctx.itemName(cmd.item)}`,     // one-line card text in the editor
});
```

Schema field types (closed set, each with a form widget, a validator and a
"references" extractor): `string text number bool enum position direction
color list group script condition` and reference types `ref:map ref:tile
ref:sprite ref:item ref:object ref:script ref:var ref:mon ref:sound ref:music`.
Because references are typed, the kit can: validate every reference in the
project, list "where is this item used?", refactor-rename an id everywhere,
and warn before deleting something that is referenced.

Registries (all the same shape: `add`, `get`, `list`, `has`, `on('add')`):
`tiles sprites icons objectTypes behaviours commands conditions itemKinds
systems scenes menus editorPanels editorTools fieldEditors validators
saveSections migrations sounds music`.

## 4. Runtime

### 4.1 Game loop and scenes
`Game` owns the scene stack. Fixed 60 Hz logic step (`update(dt)`), render on
`requestAnimationFrame`. Only the top scene receives input; scenes flagged
`transparent` let the one below render (dialogue over the map). `await
stack.run(scene, params)` resolves with the scene's result — this is what makes
scripts and mini-games composable: `const idx = await io.choice(...)` is a
scene underneath.

### 4.2 World, entities, systems
A `World` runtime = `{ project (frozen), save (mutable), map (current map view
= content + overlay), entities[] }`. Entities are plain objects
(`{ id, kind, x, y, dir, sprite, mover, behaviour, solid, ... }`); systems are
functions over the entity list that run each tick in a declared order
(`movement → behaviours → triggers → companions → module systems`). No class
hierarchies; a new feature registers a system with `{ id, order, update(world,
dt) }` and subscribes to events.

### 4.3 Event bus
`world.events.emit('step', { hero, x, y, tile })`, `interact`, `mapEnter`,
`mapLeave`, `varChanged`, `itemChanged`, `objectStateChanged`, `clockTick`,
plus module events (`monCaught`, `friendshipChanged`, ...). Systems and modules
listen; nothing polls. Encounters are a listener on `step`; the follower is a
listener on `step`; a future day/night system is a listener on `clockTick`.

### 4.4 Script interpreter
Runs a command list with a `ctx` (`world`, `io`, `rng`, `self` object, `hero`
who triggered). Commands are looked up in the registry; unknown ones warn and
skip. Branching commands (`if`, `choice`) contain nested lists. `call` runs a
named script from `project.scripts`. Text templating (`{p1}`, `{p2}`, `{p}`,
`{var:coins}`, `{mon}`) lives in `text.js` and is reused by dialogue, signs
and the editor preview. The interpreter is pure: given a fake `io` that answers
choices, a whole story branch is a Node test.

### 4.5 Rendering and input
Canvas for the world: per-layer offscreen caches per map (invalidated by patch
paths), entities sorted by y, `above` layer, overlays (fade/flash/tint). Integer
tile scale, DPR-aware, `imageSmoothingEnabled=false`. DOM for text UI (dialogue,
menus, editor) — accessible, easy to style, native text input on phones. Input
maps *players* to *heroes*; systems ask "which hero" and conditions can require
both. Co-op is therefore an input/camera concern, not a systems rewrite.

## 5. Editor (Creator Mode)

- **Document + patches.** `doc.apply([{ op:'set', path:[...], value }, { op:'splice', path, index, remove, insert }])`
  records inverses; `doc.begin('Paint')/commit()` batches a stroke into one undo
  step; listeners get the changed paths (renderer cache invalidation, panel
  refresh). Undo/redo is universal.
- **Schema-driven inspector.** Select anything (object, page, command, map,
  item, project) → the inspector renders its schema. Custom field editors for
  `position` (tap on the map), `ref:tile`/`ref:sprite` (visual pickers), `script`
  (the command-card list with nested branches), `condition` (a small builder).
  A module that registers a new object type never writes editor code.
- **Tools** are small state machines over pointer events with a preview layer:
  pencil, fill, rect, erase, eyedropper, select/move, place-object, stamp.
  Runtime decorating reuses `place` and `erase` on the save overlay.
- **Panels** are registered: Tiles, Objects, Map, Project, Scripts, Problems,
  Variables, plus module panels (the Pokémon module adds "Wild Pokémon").
- **Validation** = registered validators producing `{ severity, message,
  location }`; the Problems panel jumps to the location. Runs on every commit
  (debounced) and before export.
- **I/O**: draft autosave (localStorage) → Export JSON / Import → Publish (when
  the page can republish itself) → committed to `js/content/world/` by Claude.
  Project files carry `version`; `migrations` upgrade old ones on load.
- **Play here** swaps to the map scene from the cursor without reloading.

## 6. Art pipeline
Pixel-string art (`palette` + `rows`) in JS files, one registry per kind,
validated and rendered by `tools/art-png.js` / `sprite-png.js`. Characters
support palette recolouring (make an NPC look like a real person). Pokémon
overworld icons are derived (32→16 nearest) and can be overridden by hand-drawn
ones later. An in-game pixel editor is a natural later addition because the
format is trivial and already has validation.

## 7. Testing strategy
- **Unit (Node):** registry/schema, document patches + undo, project normalize
  + migrations, conditions, interpreter with fake io, movement/ledge/warp rules
  on a headless world, catch maths, save migrations.
- **World lint:** every project (demo + author's) passes validation with zero
  problems; every reference resolves; every warp is walkable.
- **Layering test:** kit never references modules/content.
- **Browser (Playwright):** scripted play-throughs (walk, talk, doors, save/
  load, catch, garden, editor paint/place/undo/export/import) at phone and
  desktop sizes, no console errors, screenshots reviewed.
- **Determinism:** seeded RNG so a play-through script is reproducible.

## 8. How future ideas plug in (no core edits)

| Idea | What gets added |
|---|---|
| Jobs / errands for caught Pokémon | `modules/jobs`: object type `job-board` (schema: jobs list), system on `clockTick`, commands `assignJob`/`collectJob`, condition `jobDone`, save section, menu entry |
| Decorate the home | `modules/decor`: item kind `furniture`, a runtime placement scene that reuses editor tools on the save **overlay** |
| Cooking / crafting | item kind `recipe`, a `CraftScene`, inventory already generic |
| Friendship growth / evolution | rule in `modules/mons` listening to `friendshipChanged`; species data already has stages |
| Dates / hangouts with a Pokémon | `companions` system already generic (any entity can follow); scripts + a `HangoutScene` |
| Day/night, weather, seasons | `clock` system + renderer overlay tint + condition kind `time` |
| Two-player puzzles | object types `plate`/`lever`, condition `bothOn`, `needsBoth` already exists |
| Photo mode / postcards | renderer snapshot → `downloads`; pure adapter |
| Letters / mailbox surprises | object type `letter`, a `mail` save section |
| Mini-games | new scenes; scripts call them with `await` |
| New areas / chapters | content only |

## 9. Roadmap (each phase ends green, pushed, playable)
1. **Kit core** — registries/schemas, document, project + migrations, map,
   entities, systems (movement, behaviours, warps, triggers, companions,
   inventory, vars), interpreter, scenes (map, dialogue, choice, name entry,
   chapter, menu, transition), renderer, input, audio, storage, game boot,
   settings, save/load, testability API. Demo world with talk/doors/chapters.
2. **Editor v1** — document/undo, tools, inspector, panels, validation, I/O,
   play-here. Round-trip: build a map in the editor → export → play it.
3. **Pokémon module** — species, catch scene + mini-game, dex, party/box,
   garden, follower, menus, wild-table panel.
4. **The author's world** — built together from their ideas, in the editor and
   by describing scenes.
5. **Modules from the idea list** — one at a time, each a folder.

## 10. Decisions the author should weigh in on
- Pages on objects (RPG Maker style) vs scripting all variation — **pages** proposed.
- One typed `vars` map vs separate flags/variables — **one map** proposed.
- DOM for text UI, canvas for the world — proposed (readability, phone inputs).
- Hot-seat + optional co-op with two on-screen d-pads on one device — proposed.
- Pixel-art GBA look (FireRed/LeafGreen scale: 16 px tiles, 16×24 characters) — proposed.
