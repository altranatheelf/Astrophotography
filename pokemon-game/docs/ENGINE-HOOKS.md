# Engine hooks the modules had to work around

Three modules were built against this engine without touching `js/kit/**` or
`js/main.js` — `mons`, `home` and `dungeon` — plus the template and packaging
tools. This is the punch list they produced: every place a module needed
something the engine does not offer, what it did instead, and the fix that
would serve every module rather than one.

Nothing here is broken today. Every item has a working workaround in module
code. What each one costs is that the workaround is invisible to the next
person: they will hit the same wall and invent a different way round it.

Ordered by how much a fix would buy. **Fixed** means the engine does it now and
the workaround has been deleted from the modules — the entry stays because it
says why the engine is shaped the way it is.

| | | |
|---|---|---|
| 1 | `sessionResumed` never emitted | **fixed** |
| 2 | a module cannot own a piece of the save or the project | **fixed** |
| 3 | the project is validated before the modules register | **fixed** |
| 4 | `menus` will not take a function `label` | **fixed** |
| 5 | no interact target that is not a map object | **fixed** |
| 6 | `mapView` captures the overlay at construction | **fixed** |
| 7–8 | see below | open |
| 9 | `KIT.module` did not exist when a manifest loaded | **fixed** |
| 10–17 | see below | open |

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

**Fixed.** There is one clock now and it is the engine's: `KIT.clock`, in
`js/kit/systems/index.js`, with the settings under `settings.clock`.

* `KIT.clock.gap(save)` measures how long ago somebody last said “we are still
  here”; the clock system re-stamps every `stampEverySeconds` (20 by default), so
  a session that ends in a crash still leaves an honest mark behind.
* `world.update` calls `KIT.clock.resume(world)` at the end of its **first** tick
  — after every system has installed its listeners, so no module has to guess
  whether it is the one that should announce it. It emits `sessionResumed
  { elapsedMs, minutesAdded }` exactly once, and not at all for a new game that
  was never away.
* `awayMinutesPerRealMinute` turns the gap into in-game minutes, capped by
  `awayCapMinutes` (three days), so a month away does not skip the whole story. A
  game that wants the gap and not the minutes leaves that setting at 0 and reads
  `elapsedMs` itself.

Both modules deleted their halves. home no longer drives a clock at all — its
`driveClock`, `minutesPerSecond`, `awayMinutesPerRealMinute` and `awayCapMinutes`
tuning moved to `settings.clock`, where they were always the game's business
rather than one module's — and mons lost its stamp, its gap measurement and its
fallback announcement. Both now do one thing: listen.

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

**Fixed.** The module system moved out of `js/main.js` and into the engine, as
`js/kit/core/modules.js` (which also fixes hook 9, below). It acts on both
declarations:

* **`save`** — `KIT.world.create` calls `KIT.modules.ensureSaves(save)` for every
  loaded module, so `save.modules[key]` is filled, migrated and repaired before
  anything reads it, on a new game and on a loaded slot alike. The declaration
  grew a `repair(data)`, which the modules needed and were each doing by hand;
  it works in place, because everything holding a section holds that object.
* **`content`** — `KIT.project.normalize` calls `ensurePacks(project)` and
  `validate` calls `problems(project)`, so `packs.<key>` always has the shape the
  module declared and a bad number is reported in the project's own problem list.
  `at: 'tuning'` says which object inside the pack the `fields` describe.

The three modules keep their `ensure(save)` / `pack(project)` helpers — they are
called in eighteen places and they read well — but the bodies now delegate to
the engine, falling back to doing it themselves only for a bare save with no
world around it. `tools/new-module.js` scaffolds the declarations, and the test
it writes proves the engine acts on them.

`test/kit/modules.test.js` checks this against throwaway modules rather than the
real ones, so what is held down is the engine's promise and not one module's habits.

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

**Fixed.** `KIT.storage.loadProject({ before })` takes a function and runs it
once the project has been found and before anything is registered from it or
validated against it; `js/main.js` passes `KIT.modules.activate`. The order is
now: find the project → start its modules → register its own art → normalize and
validate. A boot of the demo prints one line and nothing else.

Anything that registers what content may refer to belongs in `before`.

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

**Fixed.** There is a schema type `label`: text, or a function of the context
that returns text. Every registry's `label` field is that type now, and
everything that shows one reads it through `KIT.labelOf(def, ctx, fallback)`
rather than `def.label` — the pause menu, the editor's tabs, tools and pickers,
command and condition summaries, and every registry-backed dropdown. A module
registers the entry it means:

```js
menus.add({ id: 'home-jobs', order: 14, label: (game) => KIT.strings.get(game.project, 'home-menu-jobs'), … });
```

Content never holds a function label — only registry definitions do, and those
are code. In a form the type behaves as plain text.

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

**Fixed.** Both, because they answer different questions.

`world.addInteractTarget(fn)` registers something that is not a map object and
would still like to be talked to; `fn(hero)` returns `[{ x, y, answer(hero) }]`.
The map's own objects always answer first, then these, in the order they were
added. It returns a function that removes it again. mons' follower is four lines
now, and nothing wraps `world.interact`:

```js
world.addInteractTarget(() => {
  const comp = world.companion;
  if (!comp || !comp.data || !comp.data.monUid) return [];
  return [{ x: comp.x, y: comp.y, answer: (hero) => talkToFollower(world, hero) }];
});
```

And when nothing at all answered, the world emits `interactMissed { hero, x, y,
dir }` — the mirror of the `step` event. home listens for it so a job board whose
pages the author deleted still opens: the type's default page carrying
`@openJobBoard` is still the visible, editable way in, and this is the safety net
underneath it.

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

**Fixed.** A map view captures nothing the save owns. The overlay, the object
state and the dimension are all read when they are asked for, so a rug appears
as it is put down, a door opens as it is unlocked, and a shift to another layer
of reality shows without a new view. `save.dimension` is followed live; passing
`opts.dimension` explicitly (what the editor does to preview the authored map)
pins it instead.

The object list is still a copy, and still the *same* copy from one frame to the
next, because a system may add somebody to a map for the length of a visit —
mons puts the creatures you own into the garden — and the authored map must not
learn about it. `test/kit/map.test.js` holds all of this down.

`KIT.home.live(world).rebuild()` survives, doing only what it still has to:
rebuilding the *entities* that were made from the overlay.

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

**Fixed.** `KIT.module` / `KIT.modules` live in `js/kit/core/modules.js`, loaded
with the kit core, so they exist long before any manifest. A manifest calls
`KIT.module(DEF)` at load time, as the docs always said. `js/main.js` is now only
what its name says — the page's entry point: the pristine capture, the banner,
and load-and-boot.

Four paragraphs of apology came out of three manifests and the scaffolder.

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
