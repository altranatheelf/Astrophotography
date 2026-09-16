# The Dungeon module

Room-to-room crawling, as a module. The kit knows nothing about keys, blocks or
darkness; this folder adds them with object types, commands, conditions, a
behaviour and one per-tick system, and nothing in `js/kit/` was touched to do it.

Turn it on by listing `"dungeon"` in `project.modules` (the Project panel in
Creator Mode has a checkbox), and load the five files before `js/main.js`:

```html
<script src="js/modules/dungeon/rules.js"></script>
<script src="js/modules/dungeon/art.js"></script>
<script src="js/modules/dungeon/register.js"></script>
<script src="js/modules/dungeon/panel.js"></script>
<script src="js/modules/dungeon/manifest.js"></script>
```

## What you get

| Object type | What it does |
|---|---|
| **Locked door** (`dungeon-door`) | Solid until you face it and press A carrying its key. The key is used up (unless you say otherwise), the door stays open for good, and the tile changes to the open one. Opened-ness lives in the engine's own `self.opened`, so a page can still test `self.opened == true`. |
| **Pushable block** (`dungeon-block`) | Walk into it and it grinds one square. Where you leave it is saved; **the map is never edited**. `resetOnEnter` puts it back every time you walk into the room. |
| **Switch plate** (`dungeon-switch`) | Down while a hero or a block is standing on it. `hold` / `toggle` / `latch`, and `holders` says what is heavy enough. |
| **Gate** (`dungeon-gate`) | Open while every switch in its `needs` list is down. `invert` makes it a trap door. |
| **Guard** (`dungeon-guard`) | Somebody who paces up and down until something stops them. |

Plus **one-way ledges**: the tiles `dun-ledge-down` / `-left` / `-right` are
ordinary tiles with the kit's own `ledge` flag, so you drop off them and cannot
climb back. Paint them like any other tile.

| Also registered | |
|---|---|
| commands | `openDoor` · `pushBlock` · `torch` · `setSwitch` |
| conditions | `switch` (a named plate is down) · `torchLit` |
| behaviour | `pace` — walks one way until something stops it, then turns round. The kit's page schema has a fixed list of behaviour kinds (see below), so the module reaches it through its own `dungeon-guard` event type. |
| system | `dungeon` (order 35) — looks, solidity, plates, gates, the lantern, and pushing by walking |
| presets | **Locked door** · **Switch and gate** (places both halves at once) |
| tiles / icons | `dun-floor` `dun-wall` `dun-rubble` `dun-door-locked` `dun-door-open` `dun-gate-closed` `dun-gate-open` `dun-plate` `dun-plate-down` `dun-block` `dun-ledge-down/left/right` `dun-stairs-up/down` `dun-torch` · icons `dun-key` `dun-torch-icon` |
| pause menu | **Lantern** — light it, put it out |
| validator | a gate waiting for a switch nobody sets is a warning, not a silent bug |

## The dark

A dungeon map carries its own atmosphere:

```js
map.props.atmosphere = { darkness: 0.88, ambient: '#05070d' }
```

Walk into it and the module lights the lantern for you (`lightOnEnter`). The
lantern hangs on the heroes as `hero.data.light`, which is what
`KIT.atmosphere` already draws holes in the dark for — so the torch radius is
the kit's lighting, not a second system.

## What it owns

```js
save.modules.dungeon = {
  version: 1,
  torch:    { lit: false, radius: 0 },   // the lantern
  blocks:   { 'map:objectId': { x, y } },// only blocks that have been moved
  switches: { 'switch-name': true },     // plates that are down
  pushes:   0,                           // a tally, for the panel
}

project.packs.dungeon = {               // every number, editable in the Dungeon panel
  darkness, ambient, torchRadius, torchColor, torchFlicker, torchSoftness,
  lightOnEnter, pushBlocks, pushSound, lockedSound, unlockSound, switchSound, gateSound,
}
```

Nothing else is the module's. Doors use the engine's `self` state; keys are
ordinary bag items; the dark is the kit's atmosphere.

## The rules are pure

`rules.js` has no DOM, no registries and no world in it — it is all "given this
save and this map view, what happens?". `test/modules/dungeon.test.js` runs it
in Node (20 tests). `register.js` is only wiring; `panel.js` is only a form.

## What the engine still owes us

1. **A bump event.** Pushing a block by walking into it should be the answer to
   "the hero tried to move and could not". `world.move()` knows that — it plays
   the bump sound — but emits nothing, so the system polls
   `world.ports.input.pressed(hero.dir)` every tick instead. One line in
   `world.move` (`events.emit('bump', { hero, dir, reason, to })`) would replace
   the poll and make pushing work for any input source, including a moveRoute.
2. **Darkness on a layer of its own.** `KIT.atmosphere.draw` punches its light
   holes with `destination-out` straight onto the finished frame, so the hole
   erases the *map* as well as the darkness over it. Measured on this dungeon at
   `darkness: 0.88`, the floor inside the lantern came out at brightness 64
   against 51 outside it — the lit circle was very nearly as blank as the dark.
   Drawn on an offscreen layer and composited with `source-over`, the same floor
   reads 135 against 51, which is what a lantern is for. Until the kit does that,
   `KIT.dungeon.fixDarkness()` wraps `A.draw`, does the darkness pass itself and
   lets the kit do the rest with `darkness` momentarily 0 (`register.js`,
   "the dark, drawn the way it was meant to be"). It keeps the original on
   `A.__dungeonOriginalDraw`, and it stands down the moment the kit sets
   `KIT.atmosphere.LAYERED_DARKNESS = true`. **A map with darkness and no lights
   on it is fine either way** — only a light source shows the bug — so this
   affects every game that wants a torch, not only this module.
3. **A reworded menu label.** `KIT.registry('menus')` validates `label` as plain
   text, although `scenes/menu.js` already calls a function label. Until the
   registry allows a function (or a `labelKey` read from the strings table), the
   Lantern entry cannot be reworded in the Terms panel like everything else. The
   entry carries `labelKey: 'dungeon-menu-lantern'` ready for the day it can.

4. **Module behaviours on any event.** `docs/MODULES.md` lists `behaviours` as a
   registry a module may add to, and this module adds `pace` — but a page cannot
   name it: `js/kit/world/project.js` declares `behaviour.kind` as
   `{ type: 'enum', options: ['none','wander','look','route','approach'] }`, a
   fixed list written before any module loads, so `kind: 'pace'` is a
   `schema` error at validation. The workaround is the `dungeon-guard` event
   type, whose system branch hands the entity `{ kind: 'pace', ... }` at run time
   (the registry lookup is live, only the *authored* page is validated). The fix
   is one word: `optionsFrom: 'behaviours'` instead of `options: [...]`, and then
   every module's behaviour works on any NPC.
