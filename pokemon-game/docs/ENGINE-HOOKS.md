# Engine hooks the modules had to work around

Three modules were built against this engine without touching `js/kit/**` or
`js/main.js` — `mons`, `home` and `dungeon` — plus the template and packaging
tools. This is the punch list they produced: every place a module needed
something the engine does not offer, what it did instead, and the fix that
would serve every module rather than one.

Nothing here is broken today. Every item has a working workaround in module
code. What each one costs is that the workaround is invisible to the next
person: they will hit the same wall and invent a different way round it.

Ordered by how much a fix would buy.

---

## 1. `sessionResumed` is documented but never emitted

| | |
|---|---|
| **Where** | `js/kit/world/world.js` (nothing emits it) · `js/kit/systems/index.js` (the `clock` system) |
| **Documented in** | `docs/ARCHITECTURE.md` line 310 (`sessionResumed {elapsedMs}` is listed among the world's events) and line 326 (“`lastSeenAt` → `sessionResumed`”) · `docs/DESIGN.md` line 328 |
| **Reported by** | mons, home |

**What was needed.** Both modules care how long the player was away: mons gives
everybody a small friendship bonus after a day, home turns the gap into in-game
minutes so a job left overnight is finished in the morning. The save shape has
`save.clock.lastSeenAt` and the docs say the world emits `sessionResumed`, but
nothing writes the stamp and nothing emits the event.

**What they did instead.** `save.clock.lastSeenAt` is treated as the one stamp,
and whichever module notices the gap first announces it:

* `js/modules/home/register.js` (`H.sweep`) measures the gap, adds the minutes,
  emits `sessionResumed { elapsedMs, minutesAdded }` on the world bus and sets
  `world._sessionResumed` as a latch;
* `js/modules/mons/systems.js` listens for the event, and only falls back to
  measuring and emitting it itself — on the first `update`, one tick after
  install, so the module that owns the clock gets first refusal — when nothing
  else did. It re-stamps every 20 seconds so a long session is never mistaken
  for a long absence.

`test/modules/integration.test.js` (“one session gap — said once, by whoever
owns the clock”) is what stops that drifting.

**The fix.** The `clock` system stamps `save.clock.lastSeenAt` on every autosave
and on `world.update`, measures the gap when a world is created, and emits
`sessionResumed { elapsedMs }` once. Then both modules delete their halves and
just listen. A `minutesAdded` in the payload (or a project setting for
“minutes gained per real minute away”) would let home delete its clock too.

---

## 2. A module cannot own a piece of the save or the project

| | |
|---|---|
| **Where** | `js/main.js` `KIT.modules.activate` · `js/kit/game.js` (new-game and load paths) |
| **Documented in** | `docs/MODULES.md` — `KIT.module({ save: { key, defaults, migrate }, content: { key, fields, defaults } })` |
| **Reported by** | home (mons and dungeon do the same by hand) |

**What was needed.** `docs/MODULES.md` promises that a module declares its save
slice and its content slice and the engine fills the defaults, runs the migrate
chain and validates `project.packs.<key>` against the declared fields. Nothing
reads those declarations: `activate()` calls `register()` and pushes the
manifest onto a list.

**What they did instead.** Every module carries the same three functions and
calls them at the top of every entry point: `KIT.home.ensure(save)` /
`KIT.home.pack(project)`, `KIT.mons.section(save)` / `KIT.mons.pack(project)`,
`KIT.dungeon` likewise. Migrations live in `KIT.home.migrations` /
`KIT.mons.migrateSave` and are applied on first touch rather than on load.

**The fix.** In `activate()`: for each module with a `save` declaration, fill
`save.modules[key]` from `defaults()` and run the `migrate` chain on load; for
each `content` declaration, fill and validate `project.packs[key]` against
`fields` inside `KIT.project.normalize`. Then `packs.<key>` becomes editable by
the generic inspector like everything else, and a module panel is a convenience
rather than the only way in.

---

## 3. The project is validated before the modules are registered

| | |
|---|---|
| **Where** | `js/main.js` `start()` — `await KIT.storage.loadProject()` (which normalizes **and validates**) runs before `KIT.modules.activate(project)` |
| **Reported by** | mons; confirmed here in every browser run |

**What was needed.** Content that uses a module's command, object type or item
kind should validate cleanly once that module is enabled.

**What happens.** Booting the demo prints, every time:

```
[project] unknown-object-type map town: 'job-board' has unknown type 'job-board'
[project] unknown-command unknown command 'collectJob'
[project] unknown-command unknown command 'openJobBoard'
```

They are warnings, and a moment later the modules register and everything works
— but they are the first thing an author sees in the console, and they say the
game is broken when it is not.

**What was done instead.** Nothing, in the modules. Two things were done in the
demo: `packs.mons.starters` watches a plain story variable instead of putting
`@givePokemon` in a page (see hook 10), and `tools/load-modules.js` gives the
build and the tests one place that registers the same modules the page does, so
the offline checks do not see these warnings at all.

**The fix.** In `main.js`, read `project.modules` from the loaded-but-not-yet-
normalized project, `activate()` those modules, and normalize and validate
afterwards. `KIT.storage.loadProject({ validate: false })` plus an explicit
`KIT.project.normalize` after activation would do it without changing storage.

---

## 4. The `menus` registry will not take a function `label`

| | |
|---|---|
| **Where** | `js/kit/core/registries.js` (the `menus` fields type `label` as text) vs `js/kit/scenes/menu.js` line 73, which calls `def.label(game)` when it is a function |
| **Reported by** | mons, home |

**What was needed.** Every string the player reads is supposed to come from the
Terms table, so a pause-menu label wants to be `(game) => KIT.strings.get(game.project, 'home-menu-jobs')`.
The scene already supports exactly that. The registry rejects it:
`registry 'menus': invalid 'home-jobs': label: must be text`.

**What they did instead.** Both modules add the entry with a plain English
label and then assign the function onto the definition `add()` returned:

```js
const jobsMenu = menus.add({ id: 'home-jobs', order: 14, label: 'Jobs', … });
jobsMenu.label = (game) => KIT.strings.get(game && game.project, 'home-menu-jobs');
```

**The fix.** Widen that one field to `scalar` (or add a `label` type that
accepts a string or a function). One character of schema, and four lines of
apology disappear from two modules.

---

## 5. A module cannot add an interact target that is not a map object

| | |
|---|---|
| **Where** | `js/kit/world/world.js` line 237 — `world.interact` searches `world.entities` only |
| **Reported by** | mons (the follower) · home (an object type that wants to react without a visible script) |

**What was needed.** Two different things, both “A was pressed and nothing on
the map answered”:

* mons' follower is `world.companion`, not an entity, so pressing A at it can
  never reach it;
* home's `job-board` object type would like to open its screen itself rather
  than rely on a page the author can delete.

**What they did instead.** mons wraps `world.interact` **on the world instance**
(`js/modules/mons/systems.js`, never the kit file) and falls through to the
follower when the original returned false. home gives its object type a default
first page carrying `@openJobBoard` — which is honest and visible, but means the
behaviour lives in content rather than in the type.

**The fix.** Either of:

* `world.events.emit('interactMissed', { hero, x, y, dir })` when nothing
  answered — three lines, and both cases become an ordinary listener; or
* let a system declare extra interact targets (`system.interactTargets(world)`),
  which also covers followers, vehicles and anything else off-map.

An `interact` event on the bus (the mirror of the `step` event, which does
exist) would additionally let an object type react without a page.

---

## 6. `KIT.mapView` reads `save.overlays[mapId]` once, at construction

| | |
|---|---|
| **Where** | `js/kit/world/map.js` line 41 — `const overlay = (save && save.overlays && save.overlays[mapId]) \|\| null;` |
| **Reported by** | home |

**What was needed.** Putting furniture down writes `save.overlays.home.tiles`.
If the player is *standing in* that map — which they always are — the view they
are looking at captured the overlay when they walked in, so the rug does not
appear until they leave and come back.

**What was done instead.** Anything that writes an overlay rebuilds the view:
`KIT.home.live(world).rebuild()` and the placement screen's `syncWorld()`.

**The fix.** Read `save.overlays[mapId]` lazily inside `tileAt` /
`collisionAt` / `overlayCells` instead of closing over it. The trap then cannot
be stepped in.

---

## 7. The renderer cannot draw a marker

| | |
|---|---|
| **Where** | `js/kit/render/renderer.js` — everything drawn on the map is an entity |
| **Reported by** | home |

**What was needed.** The placement screen needs a ghost: one tile, translucent,
pulsing, under the player's control, colliding with nothing.

**What was done instead.** A `through`, non-solid, invisible-to-everything
entity whose `look` is the tile and whose `opacity` pulses. It works and it is
only a few lines, but it is an entity in `world.entities` that is not a thing in
the world — anything iterating entities has to know to skip it.

**The fix.** A `world.markers` list the renderer draws after the entity layer:
`{ x, y, art|tile, opacity, tint, outline, layer }`. Creator Mode's tools
already have `preview(ctx, ed)` for exactly this at edit time; this is the same
idea at play time. It would also serve range indicators, targeting, footprints
and “you can put it here” shading.

---

## 8. A module's `behaviours` are rejected by the page schema

| | |
|---|---|
| **Where** | `js/kit/world/project.js` line 85 — `{ key: 'kind', type: 'enum', options: ['none','wander','look','route','approach'] }` |
| **Reported by** | dungeon (the `pace` behaviour) |

**What was needed.** `KIT.registry('behaviours')` exists and the `behaviours`
system (order 20) looks entries up in it, so a module registering `pace` should
be able to put `behaviour: { kind: 'pace' }` on a page. Validation says no: the
enum is a fixed list in the schema.

**What was done instead.** The dungeon module reaches its behaviour through its
own `dungeon-guard` object type instead, which sets the behaviour in code.

**The fix.** `optionsFrom: 'behaviours'` (the schema already supports
`optionsFrom`, and the same pattern is used for other registry-backed enums).

---

## 9. Modules must load before `main.js`, but `KIT.module` only exists after it

| | |
|---|---|
| **Where** | `js/main.js` — defines `KIT.module` when it runs, and captures `KIT.PRISTINE_HTML` at the same moment |
| **Reported by** | mons, home |

**What was needed.** `main.js`'s own comment says “Module manifests may be
loaded before or after this file”. They cannot be loaded before: `KIT.module` is
not defined yet. They cannot be loaded after either, in practice: `main.js`
captures the page as `KIT.PRISTINE_HTML` the instant it runs, and
`KIT.storage.publish` rebuilds the published game from that — so a module whose
`<script>` tag comes after `main.js` is silently missing from every published
build.

**What they did instead.** `index.html` loads the modules **before** `main.js`,
and every `manifest.js` registers on `DOMContentLoaded` — a listener it adds
before `main.js` adds its own, and which therefore runs before boot. It works,
but it is four modules all carrying the same paragraph of explanation.

**The fix.** Either define `KIT.module` / `KIT.modules` in their own tiny file
loaded with the kit core (the natural home is `js/kit/core/registries.js`), or
have `main.js` drain a `KIT._moduleQueue` that a two-line shim fills. Then a
manifest can simply call `KIT.module(...)` at load time, as the docs say.

---

## 10. Content cannot mention a module's commands without failing the kit's own tests

| | |
|---|---|
| **Where** | `KIT.project.validate` — `unknown-command` is an **error**, not a warning, and `test/kit/demo.test.js` asserts the demo has no errors |
| **Reported by** | mons |

**What was needed.** The lab stands in the demo should be able to say
`@givePokemon species=pikachu`.

**What was done instead.** `packs.mons.starters = { var: 'starter', … }` — the
module watches an ordinary story variable that the stands already set, and turns
it into a real Pokémon when it changes. `givePokemon` is implemented and tested;
it is simply not used in the demo. (This integration pass then had to load both
modules in `test/kit/demo.test.js`, through the shared `tools/load-modules.js`,
which is the better answer for a project whose `modules` list names them.)

**The fix.** Validate a command against `project.modules` as well as the
registry: if a project enables a module and the module is not loaded,
`unknown-command` should be one “module not loaded” warning for the whole
project, not an error per call site. That also fixes hook 3's console noise for
anyone loading the project without its modules.

---

## 11. Nothing tells a module when the main script thread goes quiet

| | |
|---|---|
| **Where** | `js/kit/script/interpreter.js` — `KIT.interpreter.mainBusy()` exists, but there is no event when it becomes false |
| **Found** | during this integration pass — it was a real deadlock, not a tidiness point |

**What was needed.** The mons starter hook listens for `varChanged` and grants
the Pokémon when the lab stand sets `starter`. That listener fires **inside** the
stand's own script, which still has lines to say. `M.grant` then opens a name
box — which lands *underneath* the message box the script pushes next. The one
below waits for an answer it can never be given, the one on top will not close,
and the game is wedged. (Reproduced in a browser; `[map, nameEntry, dialogue]`.)

**What was done instead.** `js/modules/mons/actions.js` polls every 100 ms until
`KIT.interpreter.mainBusy()` is false, `world.busy` is false and no dialogue,
choice or chapter card is on the scene stack, and only then grants — with a
one-minute cap so a stuck script cannot make it poll forever.

**The fix.** Emit `mainIdle` on the world bus when the last main-thread run
finishes (or give the interpreter `KIT.interpreter.whenIdle() -> Promise`).
Any module that wants to say something after the player's current conversation
— a level-up, a gift, an achievement — needs this, and every one of them will
otherwise invent this same poll.

---

## 12. The Project panel guesses which modules exist

| | |
|---|---|
| **Where** | `js/kit/editor/panels-project.js` line 356 — `const known = new Set((p.modules \|\| []).concat(Object.keys(p.packs \|\| {})).concat(['mons']));` |
| **Found** | during this integration pass |

**What was needed.** The Modules section of the Project panel should list every
module the page has loaded, so one can be switched **on** as well as off.

**What happens.** It lists the modules the project already enables, plus
whatever has a `packs.<key>`, plus the literal string `'mons'`. So a module that
is loaded but not yet enabled — exactly the one you want to turn on — does not
appear, and the engine has one module's name written into it.

**What was done instead.** Nothing: both demo modules are enabled, so both
appear. `e2e/vision.js` switches them off through `project.modules` directly,
which is what the panel writes.

**The fix.** `const known = new Set(KIT.modules.all().map(d => d.id).concat(p.modules || []))`,
and show `def.label` and `def.describe` rather than a title-cased id. Delete the
`'mons'`.

---

## 13. `KIT.project.normalize` freezes every registered string into the content

| | |
|---|---|
| **Where** | `js/kit/world/project.js` lines 406–408 — `p.strings = {}; for (const s of KIT.registry('strings').list()) p.strings[s.id] = s.default;` |
| **Found** | during this integration pass |

**What was needed.** `KIT.strings.get` already falls back to the registry, and
the Terms panel already lists from the registry and treats `project.strings` as
an override. So content only needs to carry the strings somebody has actually
*changed*.

**What happens.** Normalizing copies all of them in, module strings included.
The demo was carrying 135 module strings as content — a frozen snapshot that
would silently win over the module the day somebody reworded a default, and dead
weight in a project that later switches the module off. (It also produced an
asymmetry: home's strings were baked in and mons' were not, purely because of
which modules the demo builder happened to register.)

**What was done instead.** `tools/build-demo.js` deletes, after normalize, every
`project.strings` key that (a) is not one of the engine's own and (b) still
equals its registered default. `test/modules/integration.test.js` asserts the
demo content carries no module strings and that the Terms table still answers
for them.

**The fix.** Write only the overrides: keep a key in `project.strings` when it
differs from the registered default, or when it has no registration at all.

---

## 14. The engine's load order is written down in four places

| | |
|---|---|
| **Where** | `index.html` · `test/kit/_load.js` · `templates/_shared/kit-files.js` · `docs/KIT-API.md` · and now `tools/load-modules.js` for the module half |
| **Reported by** | foundations; extended here |

**What was needed.** One machine-readable list of the engine's files, in order,
that the page, the Node test loader, `tools/new-game.js`, `tools/pack-kit.js`
and every generated game's `tools/kit-node.js` can all read.

**What was done instead.** `templates/_shared/kit-files.js` is that list for the
tools, and `index.html` and `test/kit/_load.js` repeat it by hand. This pass
added `tools/load-modules.js` so that `tools/build-demo.js` and
`test/kit/demo.test.js` at least agree with each other about the *modules*; the
page's module block still repeats it a third time.

**The fix.** Ship `js/kit/manifest.js` — a plain array of the engine's files in
load order, plus the module file lists — and have `index.html` build its
`<script>` tags from it (or have a build step that writes them). Then adding a
kit file is one edit, not four.

---

## 15. The pause menu keeps its click listener while another scene is on top of it

| | |
|---|---|
| **Where** | `js/kit/scenes/menu.js` line 57 — `UI.onAction(ui.host, …)` on `#pause-menu`, removed only in `exit()` |
| **Found** | during this integration pass — another real bug, not tidiness |

**What was needed.** A module's list screen (`home-jobs`, `home-board`,
`home-place`) is opened *from* the pause menu, and `#pause-menu` is the only
overlay host the kit offers for a list over the map. So the module clears the
host and draws its own panel into it — and the menu scene, still on the stack
underneath, still has a delegated `click` listener on that host.

**What happens.** One tap on “welcome them home” fires twice: once on the
module's handler and once on the menu's, which reads `data-index` off the module's
row, looks it up in *its* stale `rows` array and acts on whatever it finds there.
In the browser, collecting a finished job silently closed every panel and paid
nothing.

**What was done instead.** `js/modules/home/scenes.js` uses its own
`onlyAction(el, fn)`: the same delegation, registered in the **capture** phase
and calling `stopPropagation()`, so the click never reaches the listener below.

**The fix.** A scene that is not on top should not be listening. Either
`KIT.scenes` tells a scene when it is covered (`suspend()` / `resume()`, the
mirror of `enter`/`exit`) so `menu.js` can drop its listener, or the menu scene
gets its own container inside `#pause-menu` and delegates from that instead of
from the shared host. The first is worth more: every scene that renders into a
shared host has this problem, not just this one.

---

## 16. The kit never registers its own default item kind

| | |
|---|---|
| **Where** | `js/kit/world/project.js` line 64 (`kind` defaults to `'item'`) and line 653 (`if (… itemKinds.size() && !k) warn 'unknown-item-kind'`) — and nothing anywhere registers `item` |
| **Found** | during this integration pass |

**What was needed.** A plain keepsake — a ribbon, a loaf of bread, the cozy
template's whole inventory — should be valid content.

**What happens.** The check is skipped while the `itemKinds` registry is empty,
so a project with no modules never notices. The moment **any** module registers
**any** item kind, the registry is no longer empty and every plain item in the
project becomes `unknown-item-kind: item ribbon: unknown item kind 'item'`. So
switching a module on makes unrelated, untouched content start warning —
`node tools/new-game.js "…" --modules mons` printed exactly that, and
`test/kit/demo.test.js` used to carry an explicit exemption for it.

**What was done instead.** `mons` and `home` each register the engine's own
default kind if nobody has (`if (!kinds.has('item')) kinds.add({ id:'item', … })`),
a keepsake whose `use()` does nothing — which is what a plain item already does.
The guard means they never fight over it, and either works alone.

**The fix.** Register `item` in the kit, beside the schema default that names
it. One entry, and two modules stop apologising for the engine.

---

## 17. Two runtime promises settle only when a scene closes, and one of them has no safe caller

| | |
|---|---|
| **Where** | `js/kit/world/world.js` `world.interact` · `js/kit/game.js` `G.continueGame` and the title loop |
| **Found** | during this integration pass, both while writing `e2e/vision.js` |

**What was needed.** Two things a play-through (or a script, or a module) wants
to do from outside: press A at something, and continue a save.

**What happens.**

* `world.interact(0)` returns a promise that settles only when whatever it
  opened has closed. Handing that promise to anything that awaits it — Playwright's
  `page.evaluate`, a module that wants to know the interaction happened — waits
  for the *player*, not for the interaction.
* `G.continueGame(slot)` is worse: it calls `KIT.scenes.clear()`, which finishes
  the title scene the title loop is awaiting. The loop then reads that as "the
  player chose nothing" and falls through to `G.newGame({})` — so calling
  `continueGame` from outside the title screen loads a save and immediately
  starts a new game over the top of it. In `e2e/vision.js` this looked exactly
  like the modules failing to save: the slot on disk was perfect, the world was
  blank.

**What was done instead.** `e2e/vision.js` never returns the `interact` promise
out of `page.evaluate`, and clicks the real Continue button instead of calling
`continueGame`. Both are commented where they happen.

**The fix.** Have `continueGame` and `newGame` stop the title loop explicitly
(a flag the loop checks after its `await`, or `titleLoop` awaiting a promise
that `continueGame` resolves) so they are safe to call from anywhere — that is
what a “testability API” means. For `interact`, resolving as soon as the slot
has *started* (and giving the scene's own promise its own name) would let a
caller await the press without awaiting the conversation.

---

## Two smaller ones

**`js/sprites/*.js` assign to `window` directly** instead of using the
`window/globalThis` shim every other file in the repo has, so they cannot be
`require`d in Node. `test/modules/mons.test.js` and `tools/load-modules.js` both
set `global.window = global` for the length of the require and remove it again.
One line per file fixes it: `})(typeof window !== 'undefined' ? window : globalThis);`

**A world built with a bare `KIT.world.create` leaves hero 2 `solid`,** so the
player cannot step back onto the tile they just left. `KIT.game.setCoop(false)`
clears it; a headless world has no `KIT.game`. Either default `coop` to off in
`world.create` or make hero 2 non-solid until co-op is switched on.
