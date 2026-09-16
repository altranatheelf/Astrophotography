# mons — befriending instead of fighting

Nobody faints. You meet somebody in the tall grass, you can offer them a berry
or say something kind, and then you throw a ball and they either come with you
or they do not. If they do not, you can say hello again tomorrow. Everyone you
befriend keeps living in the garden while you are away, one of them walks behind
you, and the Pokédex remembers where and when you met each one.

## The files

| | |
|---|---|
| `rules.js` | **Every rule, as pure functions.** Species, rarity, catch chance, the timing ring, wobbles, fleeing, the encounter roll, the party/box/dex, friendship. No DOM, no world — Node requires this file directly. |
| `strings.js` | Every line the module can show, as Terms entries. |
| `art.js` | Portraits, the 16×16 overworld icons, shiny palettes, and the `sprites` entries that let a Pokémon walk around. |
| `actions.js` | What the module *does* (`grant`, `startEncounter`, `adjustFriendship`), ctx-shaped so `KIT.interpreter.fakeCtx` drives it headlessly. |
| `script.js` | The commands, the conditions and the two item kinds. |
| `systems.js` | Encounters, the follower, the garden. |
| `scenes.js` | The catch scene, the party, the Pokédex, the garden card, and the two pause-menu entries. |
| `panel.js` | Creator Mode: the Encounters panel, the `ref:mon` picker, the encounter-table validator. |
| `manifest.js` | `KIT.module({...})` — the save slice, the content slice, and `register()`. |

Load order is exactly that list; `index.html` loads them **before** `js/main.js`
(see "the missing hooks" below).

## What it registers

| Registry | ids |
|---|---|
| `monSpecies` (new) | the 32 species from `js/data/pokemon.js` |
| `commands` | `givePokemon` `encounter` `friendship` `openParty` `openDex` (+ `monCard`, used by the garden) |
| `conditions` | `has` `dexCount` `friendship` `partyFull` |
| `itemKinds` | `ball` `berry` |
| `systems` | `mons-encounters` (35) `mons-follower` (38) `mons-garden` (39) |
| `scenes` | `mons-catch` `mons-party` `mons-dex` `mons-card` |
| `menus` | `mons-party` (12) `mons-dex` (14) |
| `editorPanels` | `mons-encounters` |
| `fieldEditors` | `mons-ref` (for `ref:mon`) |
| `validators` | `mons-encounters` |
| `sprites` | `mon:<species>` and `mon:<species>:shiny`, built on first use |
| `strings` | ~70 `mons-*` keys — every word the player reads |
| ref kind | `KIT.schema.refKind('mon', …)`, so any `ref:mon` field gets a picker with portraits |

## What it owns

**The save** — `save.modules.mons`:

```js
{
  version: 2,
  party: [mon],            // up to 6
  box: [mon],              // the garden
  dex: { seen: { pikachu: true }, caught: { pikachu: { map, where, date, count } } },
  follower: uid | null,
  steps: 0,                // toward the next +1 of friendship
  lastSeenAt: '2026-09-16T…',
  petted: [uid],           // reset on every map entry
}
```

A mon is `{ uid, id, nickname, friendship, mood, shiny, caughtAt:{map,date,by}, metAt, favouriteBerry }`.
`version: 1` — the flat pre-kit shape, `{ pokemon:[{species,name,friendship}], dex:[ids], follower:<index> }` —
migrates through `KIT.mons.migrateSave`, which `KIT.mons.section(save)` applies
on first touch. Old saves keep loading.

**The content** — `project.packs.mons`: items, difficulty, the tuning numbers,
`rarity` overrides, `starters`, and `profiles` (see below). Everything has a
default in `KIT.mons.contentDefaults()`, so a project that says nothing still works.

**Map props** — `map.props.encounters = { rate, byRegion: { "1": [{ id, weight }] } }`
and `map.props.garden = { region: n } | { x0,y0,x1,y1 }` (a map of `kind: 'garden'`
is all garden). Both are ordinary map props, so Creator Mode saves and exports them.

## The catch profile

The whole catch scene comes out of content, so it can be re-themed without code:

```js
project.packs.mons.profiles = [{
  id: 'friendly',
  actions: [
    { id: 'throw',  kind: 'throw', item: 'pokeball', label: 'mons-act-throw' },
    { id: 'berry',  kind: 'offer', item: 'berry',    effects: { calm: 1 } },
    { id: 'golden', kind: 'offer', item: 'golden-berry', effects: { guarantee: true } },
    { id: 'talk',   kind: 'talk',  effects: { curious: 0.34 } },
    { id: 'leave',  kind: 'leave' },
  ],
  strings: { gotcha: 'mons-gotcha', broke: 'mons-broke', … },   // Terms ids, or literal text
  art:     { ring: { center, width, speed, calmWidth }, wobbleMs, throwMs, scale },
  rules:   { fleeAfter: 3, fleeChance: 0.45, calmBonus: 0.12, curiousBonus: 0.08, maxCalm: 3 },
}]
```

`kind` is what the scene does; everything else is words and numbers. A string
value is looked up in the Terms table when it is a registered key and used
literally otherwise, so a re-themed profile can just say what it means.

The rules underneath, all pure and all tested:

* **rarity** from the base-stat total (`<400` common … `≥570` legendary), unless
  `packs.mons.rarity` overrides the species.
* **catch chance** = base(rarity) × quality × difficulty × ball power, `+0.12`
  per berry (up to three), `+0.08` if talking made it curious, clamped to
  0.02–0.98. A golden berry returns 1.
* **the ring** shrinks from 1 to 0; where you tap it relative to the green band
  is perfect / great / ok / miss. A berry widens the band.
* **wobbles**: caught is three and a click, a near miss is two, a clear miss is one.
* **fleeing**: only after three failed throws, and then only on a roll.

## Friendship

0–255, tiers at 50 / 100 / 150 / 200 / 255 (`new, warm, close, dear, devoted, bonded`,
drawn as five hearts). `+1` per 128 steps walked while following, `+3` for a pet
(once per visit), `+10` for a berry (`+5` more for their favourite), `+1` for
talking to your follower, and a small bonus for everyone when you come back after
a real-world day away.

## The demo

`tools/build-demo.js` adds: a real encounter table on Route 1 (two regions — the
near patch is gentle, the far patch past the ledge is not), a garden corner of
Peachfall behind the fence, the whole `friendly` profile in `packs.mons`, item
props for the balls and berries, and `packs.mons.starters`, which is how the lab
stands hand you a real Pokémon.

**Why the starter goes through a variable and not `@givePokemon`:**
`test/kit/demo.test.js` validates the demo project with the kit alone, so any
module command inside demo content is an `unknown-command` **error** for anyone
who has not loaded this module — and the lab stands are covered by that test, so
their scripts must stay as they are. `packs.mons.starters = { var: 'starter',
friendship: 70, ask: true }` makes the module watch that variable instead: the
moment the stands set it, you get the Pokémon (and a nickname prompt). Loading a
save that already has it set catches up quietly, without the prompt.

## The missing hooks

Five things the kit does not have yet. Each is worked around in this module only;
none of them touches `js/kit/**` or `js/main.js`.

1. **`sessionResumed` is documented but never emitted.**
   `docs/ARCHITECTURE.md` §10 lists `sessionResumed { elapsedMs }` among the
   world's events and §"saves" says `lastSeenAt` drives it, but nothing in
   `js/kit/world/world.js` emits it.
   *Worked around:* `systems.js` keeps its own `lastSeenAt` in the save section,
   works out the gap when it first sees a world, and emits `sessionResumed` on
   `world.events` itself so other modules can listen either way.

2. **A module cannot add an interact target that is not a map object.**
   `world.interact()` only searches `world.entities`, and the follower is
   `world.companion`, so talking to it is impossible from outside the kit.
   *Worked around:* `systems.js` wraps `world.interact` **on the world instance**
   (never the kit file) and falls through to the follower when nothing else
   answered. A `world.events.emit('interactMissed', {hero})`, or letting a system
   declare extra interact targets, would replace this cleanly.

3. **`KIT.module` does not exist until `js/main.js` has run**, although main.js's
   own comment says a manifest may load before or after it. Loading the modules
   *after* main.js would work, but then `KIT.PRISTINE_HTML` — captured while
   main.js runs, and the only thing `KIT.storage.publish` rebuilds from — would
   not contain the module `<script>` tags, so published games would lose the
   module.
   *Worked around:* `index.html` loads the modules before main.js and
   `manifest.js` registers on `DOMContentLoaded`, whose listener it adds first
   and which therefore runs before boot. Defining `KIT.module` in its own tiny
   file (or having main.js drain a queue) would fix it properly.

4. **The `menus` registry types `label` as text**, but `js/kit/scenes/menu.js`
   calls `def.label(game)` when it is a function — so a menu entry whose label
   comes from the Terms table is rejected by its own registry's schema.
   *Worked around:* `scenes.js` adds the entry with the plain default string and
   assigns the function to the stored definition afterwards.

5. **The project is validated before modules are registered.**
   `js/main.js` calls `KIT.storage.loadProject()` (which normalizes and
   validates) and only then `KIT.modules.activate(project)`, so every module
   command and object type in the content is reported as unknown in the console
   at boot, even though it works a moment later. Activating the modules named in
   the loaded project *before* validating it would silence that.
   *Not worked around* — it is console noise only, and this module's demo content
   deliberately uses no module commands (see above).

Two smaller notes, both outside this module's files:

* `js/sprites/*.js` assign to `window` directly instead of using the
  `window/globalThis` shim every other file has, so they cannot be `require`d in
  Node without a shim. `test/modules/mons.test.js` sets one for the length of the
  require and removes it again.
* In a world built without `KIT.game`, hero 2 stays `solid`, so the player cannot
  step back onto the tile they just came from. `KIT.game.setCoop(false)` clears
  it; a bare `KIT.world.create` does not.

## Tests

`test/modules/mons.test.js` — 24 tests: rarity buckets across the whole roster,
catch chance with clamps and berries, the ring, wobbles, fleeing, a whole catch
driven through `applyAction`, the weighted encounter roll's determinism, party
overflow, friendship clamps and tiers, the dex, the v1 save migration, the
commands and conditions through `KIT.interpreter.fakeCtx`, the art fallbacks, and
a live world walking in the grass and filling the garden.
