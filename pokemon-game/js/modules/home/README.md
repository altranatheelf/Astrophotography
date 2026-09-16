# Home — what there is to do after catching

Catching something should not end with it sitting in a box. This module is the
loop that comes after: a room you decorate yourself, errands your friends can
run while you are away, and the small daily life of the ones who stayed behind.

It works **with or without the mons module**. When mons is loaded the workers
are the friends you caught; when it is not, they are the heroes. A module that
owns its own creatures can take over completely with one call:

```js
KIT.home.provideRoster((project, save) => [
  { uid, name, kind:'mon', type:'grass', types:['grass'], friendship: 120, sprite:'bulbasaur' },
]);
```

## Files

| | |
|---|---|
| `rules.js` | Every rule, as pure functions on `save` and `project`. No DOM, no world, no renderer. This is what `test/modules/home.test.js` tests. |
| `register.js` | The wiring: strings, the `furniture` item kind, the `job-board` object type, five commands, four conditions, the `home` system and two pause-menu entries. |
| `scenes.js` | The three screens (`home-place`, `home-board`, `home-jobs`). |
| `panel.js` | The **Home** panel in Creator Mode. |
| `manifest.js` | `KIT.module({ id:'home' })`. Loads **after** `rules.js`. |

Load order in the page: `rules.js · register.js · scenes.js · panel.js · manifest.js`.

## Decorating

An item of kind `furniture` carries `props`:

```js
{ variants: [ { label, tile, tile2, dir:'down'|'right' } ], layer:'deco', solid:true }
```

Using it from the bag (or the **Decorate** entry in the pause menu) opens the
placement screen: a ghost you move with the pad or a finger, `Turn` to rotate
through the variants, `Put down` to place it, `Pick up` to take it back.

Placing writes **only** `save.overlays[mapId].tiles`, remembering what was on
that square before. Picking up restores exactly that and deletes the cell — a
room stripped bare compares equal to a room never touched, and the project is
never written to at all.

## Jobs

Place a **Job board** object and fill in its list in the Home panel: a title,
what it is, the friend it needs or the type it suits, how long it takes in
in-game minutes, the reward, and an optional switch to set when it is done.
Its first page already carries `@openJobBoard`, so a board works with no
scripting.

Send a friend and they leave; when the clock has passed they are home, with the
reward and a line that is warmer the better they know you. The clock counts
**real time between sessions** too (`awayMinutesPerRealMinute`, capped by
`awayCapMinutes`), so a job left overnight is waiting in the morning.

## Moods and presents

Friends still at home drift between `happy · calm · sleepy · restless · lonely`
one step per `moodDriftMinutes` since `changedAt`, seeded by the save, so a
replay drifts exactly the same way — and anything that sets a mood by hand
restarts that clock. They react to what you do (`fed`, `petted`, `worked`, `ignored`).
A friend who likes you enough and is in a good mood may, at most once a day,
leave a present at the door — an ordinary `item` object in the house overlay
with a note on it.

Every number is in `project.packs.home.tuning`, editable in the Home panel —
except the ones for petting and feeding, which belong to whoever owns the
friends (see below).

## What it owns

* Save: `save.modules.home` —
  `{ version, jobs:[{ id, job, board, title, who, whoName, startedAt, minutes, reward, count, flag, done, collectedAt }], gifts:[], moods:{ uid:{ mood, changedAt } }, placed, furniture:[], seenAt, log:[] }`
  `furniture` is the record needed to pick a piece back up; `placed` is how many
  are out. Migrations go in `KIT.home.migrations` and run in `KIT.home.ensure`.
* Content: `project.packs.home` — `{ tuning:{…}, giftItems:[], giftSpot, workers }`.
* Registered ids: item kinds `item` (the engine's own default — see
  `docs/ENGINE-HOOKS.md` §16) and `furniture`; object type `job-board`; commands
  `placeFurniture giveJob collectJob moodSet openJobBoard`; conditions
  `jobDone jobsReady hasFurniture mood`; system `home` (order 60); scenes
  `home-place home-board home-jobs`; menus `home-jobs` (order 14)
  `home-decorate` (16); editor panel `home`; 48 strings, all `home-*`
  (kebab-case, like the kit's own — never `home.something`).

## Where this module meets another one

It never reaches into another module's files or save shape. Four joins, all
through the engine or a published hook, all fine when the other side is absent:

| | |
|---|---|
| **Who the friends are** | `H.roster` asks `KIT.mons` when it is loaded (names, types, and a **registered sprite id** for the face), the heroes when it is not, and `H.provideRoster(fn)` beats both. |
| **Friendship** | Not ours. `H.awardFriendship(ctx, uid, n)` runs the `friendship` command out of the `commands` registry; with no module registering one it does nothing. `petFriendship`/`feedFriendship` are gone from the tuning — the module that owns the friends owns those numbers. |
| **The mood** | Ours, and we offer it: `KIT.mons.provideMood(fn)` (if that hook exists) so the garden card shows the same mood the Jobs screen does. |
| **Being petted or fed** | Theirs. They say so with `world.events.emit('friendCared', { uid, what })` and we move the mood; nobody has to send it. |

`test/modules/integration.test.js` is where those four are held in place.

## What the engine gives us

The full punch list is **`docs/ENGINE-HOOKS.md`**; all of it is fixed. What this
module leans on, and used to have to fake:

* **The clock is the engine's** (§1). It runs the minutes, keeps the stamp
  fresh, measures the gap between sessions and says `sessionResumed
  { elapsedMs, minutesAdded }` once. We listen, and the jobs that were timed
  against the clock have simply finished. How fast it runs and what a gap is
  worth are `settings.clock` — the game's business, not ours.
* **The save and content slices are declared, not coded** (§2). The manifest
  says `save` and `content`; the engine fills, migrates, repairs and validates.
  `KIT.home.ensure(save)` and `KIT.home.pack(project)` are names for reading
  them, not implementations of them.
* **The map view reads the save live** (§6), so a rug appears as you put it
  down. `H.live(world).rebuild()` survives, rebuilding only the *entities* the
  overlay made.
* **A menu label may be a function** (§4), so both pause-menu entries take their
  words from the Terms table.
* **`interactMissed`** (§5) means a board whose pages the author deleted still
  opens. The type's default page carrying `@openJobBoard` is still the visible,
  editable way in; that listener is the safety net underneath it.

* **`world.markers`** (§7) is what the placement ghost is: a tile drawn on the
  map that is not in it, so nothing walks into it and nothing talks to it. Its
  outline is green where the furniture will go and red where it will not.
* **A covered scene is suspended** (§15), so the pause menu lets go of
  `#pause-menu` while our screens are drawn into it. `onlyAction` in `scenes.js`
  stayed as belt and braces: a click meant for our row has no business reaching
  anything underneath it.
* **The kit registers its own default `item` kind** (§16), so registering
  `furniture` no longer makes every plain keepsake in the project warn.

Nothing in this module works around the engine any more. If you find something
that has to, add it to `docs/ENGINE-HOOKS.md` — that list is how the engine
learns.
