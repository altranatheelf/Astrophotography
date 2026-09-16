# Writing a module

A module is a folder that adds a system to the engine without editing it. The
Pokémon side of this game is a module; so is anything you add later. If you can
describe a feature as "things, rules, screens and saved state", it is a module.

## The shape

```
js/modules/<id>/
  manifest.js      KIT.module({...})   — the only file the page has to load first
  <anything>.js    whatever the module needs
  README.md        what it does, in a paragraph
```

```js
KIT.module({
  id: 'mons',
  version: 1,
  label: 'Pokémon',                       // shown in the Project panel
  requires: [],                           // other module ids; boot sorts and fails loudly
  describe: 'Catching, the Pokédex, the garden and a follower.',

  register(KIT) {
    // Everything the module adds goes in here. It runs once, after the kit and
    // before the game boots, only when the project enables this module.
  },

  // Optional: a slice of the save file this module owns, at save.modules.mons.
  save: {
    key: 'mons',
    defaults: () => ({ version: 2, party: [], box: [], dex: {} }),
    migrate: [ { from: 1, to: 2, up(data) { return data; } } ],
    repair(data) { if (!Array.isArray(data.party)) data.party = []; return data; },
  },

  // Optional: a slice of the project this module owns, at project.packs.mons.
  content: {
    key: 'mons',
    at: 'tuning',                         // which object inside the pack `fields` describes
    fields: [ { key: 'startingBalls', type: 'number', default: 5 } ],
    defaults: () => ({ tuning: {}, species: {}, encounters: {} }),
  },
})
```

## The two slices

These are declarations, not requests: the engine acts on them, and a module
does not write an `ensure(save)` or a `pack(project)` of its own.

**`save`** — whenever a world is made, from a new game or a loaded slot, the
engine takes `save.modules[key]`, runs the `migrate` chain over it (oldest
first; each `{ from, to, up(data) }` takes the section at `from` and returns it
at `to`), fills in any key that `defaults()` has and the section does not, and
calls `repair(data)` last. So a save written before this module existed, or by
an older version of it, loads; adding a field to a module is safe; and a save
that arrives edited or truncated is put right rather than believed.

`repair` must work **in place** and return the same object: everything that
holds a section holds that object, and reading twice has to give the same one
back.

**`content`** — `KIT.project.normalize` fills `project.packs[key]` from
`defaults()` and the declared `fields`, and `validate` checks it, so a number
an author typed into a module's panel is reported in the same list as a broken
tile id. Because the fields are declared, Creator Mode's generic inspector can
edit them: a module's own panel is a convenience, not the only way in.

Set `at` when the fields describe an object **inside** the pack (most packs are
`{ tuning: {…}, …data… }`); leave it out and they describe the pack itself.

Read either slice with the module's own helper if it has one, or directly:

```js
KIT.modules.saveSection(save, 'mons')   // fill + migrate + repair, and write back
KIT.modules.pack(project, 'mons')       // the filled content slice, without mutating
```

## What `register` may add

Everything is a registry, so a module adds the same way the kit does:

| To add | Registry | Notes |
|---|---|---|
| tiles, sprites, faces, icons | `tiles` `sprites` `faces` `icons` | art the module ships |
| object types | `objectTypes` | with `fields` (their page props) — the editor forms itself |
| behaviours | `behaviours` | autonomous movement kinds |
| script commands | `commands` | `{ fields, run(ctx, cmd), summary, text }` — the editor and Screenplay pick them up |
| conditions | `conditions` | `{ fields, test(cond, ctx) }` |
| item kinds | `itemKinds` | `{ fields, use(ctx, item) }` |
| systems | `systems` | `{ order, update(world, dt), onMapEnter }` |
| scenes | `scenes` | menus, minigames, anything full-screen |
| pause-menu entries | `menus` | `{ label, icon, order, open(game) }` — `label` may be `(game) => …` so Terms can reword it |
| editor panels and tools | `editorPanels` `editorTools` | Creator Mode extends itself |
| field widgets | `fieldEditors` | new schema types |
| validators | `validators` | project problems |
| strings | `strings` | every line of text the module shows |
| reference kinds | `KIT.schema.refKind('mon', …)` | so `ref:mon` fields get a picker |

## Rules

1. **Never edit the kit.** If you need a hook it does not have, say so; a hook
   added to the kit serves every module, a patched kit serves none.
2. **Own your state.** Runtime state lives in the save section you declared.
   Content lives in `project.packs.<key>`. Nothing else is yours.
3. **Every string is registered**, so it can be reworded in the Terms panel.
4. **Fail soft.** A module that cannot do its job disables its own affordances
   and says why once; it never throws during boot or a turn.
5. **Headless first.** Rules go in pure functions that Node can test. Scenes and
   panels are the thin layer on top.
6. **Ship a test.** `test/modules/<id>.test.js`, loaded like the kit tests.
7. **Version your save.** If the shape changes, add a migration; old saves must
   keep loading.

## The modules that ship with the engine

Three, none of which the engine knows anything about. Each one is `js/modules/<id>/`
with its own README, its own test in `test/modules/<id>.test.js`, and nothing at
all in `js/kit/`. Where they meet each other is tested in
`test/modules/integration.test.js`.

| | what it adds | owns | registers | enabled by |
|---|---|---|---|---|
| **`mons`**<br>*Pokémon* | Befriending instead of fighting: an encounter in the tall grass, a timing-ring catch you can talk or feed your way through, the Pokédex, a garden everyone lives in, a follower who walks behind you, and friendship that grows as you walk together. | `save.modules.mons` · `project.packs.mons` · `map.props.encounters` · `map.props.garden` | registry `monSpecies` · ref kind `ref:mon` · commands `givePokemon` `encounter` `friendship` `openParty` `openDex` `monCard` · conditions `has` `dexCount` `friendship` `partyFull` · item kinds `ball` `berry` · systems `mons-encounters` (35) `mons-follower` (38) `mons-garden` (39) · scenes `mons-catch` `mons-party` `mons-dex` `mons-card` · menus `mons-party` (10) `mons-dex` (12) · sprites `mon:<species>[:shiny]` · panel `mons-encounters` · field editor `mons-ref` · validator `mons-encounters` · 87 `mons-*` strings | the demo |
| **`home`**<br>*What there is to do afterwards* | A room you decorate yourself, a board of odd jobs your friends go out on while the clock runs (real time between sessions counts), the moods of the ones who stayed, and the odd present left at the door. Works with or without `mons`. | `save.modules.home` · `project.packs.home` · `save.overlays[map]` (furniture) · the in-game clock, when the engine's own is off | item kind `furniture` · object type `job-board` · commands `placeFurniture` `giveJob` `collectJob` `moodSet` `openJobBoard` · conditions `jobDone` `jobsReady` `hasFurniture` `mood` · system `home` (60) · scenes `home-place` `home-board` `home-jobs` · menus `home-jobs` (14) `home-decorate` (16) · panel `home` · 48 `home-*` strings | the demo |
| **`dungeon`**<br>*Room to room in the dark* | A whole genre as an add-on: a key and a locked door, blocks you shove about, plates and gates, one-way ledges, and a lantern you carry into the dark. | `save.modules.dungeon` · `project.packs.dungeon` · `map.props.atmosphere` | object types `dungeon-door` `dungeon-block` `dungeon-switch` `dungeon-gate` `dungeon-guard` · commands `openDoor` `pushBlock` `torch` `setSwitch` · conditions `switch` `torchLit` · behaviour `pace` · system `dungeon` (35) · menu `dungeon-lantern` · presets `locked-door` `switch-and-gate` · 16 `dun-*` tiles · icons `dun-key` `dun-torch-icon` · panel `dungeon` · validator `dungeon` · 14 `dungeon-*` strings | the `dungeon` template |

**The pause menu, in one order.** Module entries sit above the engine's own
(Save is 20): `10` Party · `12` Pokédex · `14` Jobs · `16` Decorate · `18` free.
Pick a number in that run, leave a gap, and the menu stays readable when two
modules are on at once.

**Strings are namespaced and kebab-cased**, like the kit's own (`got-item`,
`save-prompt`): `mons-menu-party`, `home-jobs-title`. A module never names
another module's string. Content does not carry them either —
`tools/build-demo.js` strips module defaults out of `project.strings` after
normalizing, so the module stays the one place its words live and the Terms
panel still lists them all.

**Where two modules overlap, one of them owns it and the other asks.**
Friendship is one number, kept by whoever owns the creatures; `home` hands job
friendship over through the `friendship` command in the `commands` registry, and
does nothing at all when no module registered one. A friend's name and face come
from one place: `home`'s roster carries a **registered sprite id**, so both
modules draw the same portrait through `KIT.registry('sprites')`. The mood is
`home`'s, and `mons` asks for it through `KIT.mons.provideMood(fn)`. Petting and
feeding are `mons`'s, and it says so with `world.events.emit('friendCared', …)`,
which `home` listens for. Every one of those joins goes through the engine or a
published provider hook — never through the other module's files or save shape —
and every one of them works when the other module is absent.

## Turning it on

`project.modules` lists the modules a game uses. The Project panel in Creator
Mode toggles them; `node tools/new-game.js` asks which to include. A module that
is loaded but not listed registers nothing.

## Scaffolding

```
node tools/new-module.js jobs --label "Jobs" --describe "Errands your friends can run"
```
writes `js/modules/jobs/` with a manifest, a save section, a command, a system,
a panel, a test and a README — all working, all obviously replaceable.
`--into games/mill-lane` puts it in a game instead of in this repo.

## Loading one

The page loads a module's files with ordinary `<script>` tags, **before**
`js/main.js` (see `docs/ENGINE-HOOKS.md` §9 for why), and the manifest is last:

```html
<script src="js/modules/home/rules.js"></script>
<script src="js/modules/home/register.js"></script>
<script src="js/modules/home/scenes.js"></script>
<script src="js/modules/home/panel.js"></script>
<script src="js/modules/home/manifest.js"></script>
```

In Node — the demo builder, the tests — `tools/load-modules.js` does the same
thing from one list, so what the demo is built against is what the page runs:

```js
require('./tools/load-modules.js').load(KIT, ['mons', 'home']);
```

## What the engine still owes a module

`docs/ENGINE-HOOKS.md` is the punch list: seventeen places where a module had to
work around something the engine does not offer, with the workaround it used and
the fix that would serve every module. Read it before inventing an eighteenth.
