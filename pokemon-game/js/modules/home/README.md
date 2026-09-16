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
one step per `moodDriftMinutes`, seeded by the save, so a replay drifts exactly
the same way. They react to what you do (`fed`, `petted`, `worked`, `ignored`).
A friend who likes you enough and is in a good mood may, at most once a day,
leave a present at the door — an ordinary `item` object in the house overlay
with a note on it.

Every number is in `project.packs.home.tuning`, editable in the Home panel.

## What it owns

* Save: `save.modules.home` —
  `{ version, jobs:[{ id, job, board, title, who, whoName, startedAt, minutes, reward, count, flag, done, collectedAt }], gifts:[], moods:{ uid:{ mood, changedAt, bucket } }, placed, furniture:[], seenAt, log:[] }`
  `furniture` is the record needed to pick a piece back up; `placed` is how many
  are out. Migrations go in `KIT.home.migrations` and run in `KIT.home.ensure`.
* Content: `project.packs.home` — `{ tuning:{…}, giftItems:[], giftSpot, workers }`.
* Registered ids: item kind `furniture`; object type `job-board`; commands
  `placeFurniture giveJob collectJob moodSet openJobBoard`; conditions
  `jobDone jobsReady hasFurniture mood`; system `home` (order 60); scenes
  `home-place home-board home-jobs`; menus `home-jobs home-decorate`; editor
  panel `home`; strings `home.*`.

## What the engine still owes us

1. **`sessionResumed` is documented but never emitted** (`docs/ARCHITECTURE.md`
   §8.4, `docs/DESIGN.md` 6). The clock system keeps `save.clock.lastSeenAt` in
   the shape but nothing writes it or measures the gap. This module stamps
   `save.modules.home.seenAt` (and `save.clock.lastSeenAt`) itself in
   `KIT.home.touch`, measures the gap in `KIT.home.resume`, and emits
   `sessionResumed { elapsedMs, minutesAdded }` on the world bus so other
   modules can already listen for it. When the kit does this properly, delete
   `H.resume`'s stamping and listen instead.
2. **A module's `save` and `content` declarations are never read.**
   `KIT.module({ save, content })` is in `docs/MODULES.md`, but nothing in
   `js/main.js` or `js/kit/game.js` fills `save.modules.<key>` from `defaults()`,
   runs the `migrate` chain, or validates `project.packs.<key>` against
   `content.fields`. `KIT.home.ensure(save)` and `KIT.home.pack(project)` do
   both by hand, on every entry point.
3. **No `interact` event on the world bus** (again documented in §8.4). Without
   it an object type cannot react to the A button on its own, so `job-board`
   ships an `on.interact` default page carrying `@openJobBoard`. That is a fine
   outcome — the author can see and change it — but a module that wants to react
   *without* a visible script has nowhere to hook.
4. **The renderer cannot draw a ghost.** The placement screen fakes one with a
   `through`, non-solid entity whose `look` is the tile and whose `opacity`
   pulses. It works, but a `world.markers` list the renderer draws (tile art,
   tint, outline) would be the honest primitive — Creator Mode's tools already
   have `preview(ctx, ed)` for exactly this.
5. **`KIT.mapView` captures `save.overlays[mapId]` once.** A map entered before
   its overlay existed never sees new overlay tiles, so anything writing an
   overlay must rebuild the view. `H.live(world).rebuild()` and the placement
   screen's `syncWorld()` do that. Reading `save.overlays[mapId]` lazily inside
   the view would remove the trap.
