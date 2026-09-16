# `bullet` — a real-time fight, and what writing it proved

This module exists to answer one question with code rather than opinion: **can
you write an Undertale-style battle against this engine's public API, without
touching `js/kit`?**

The answer is yes, and it runs at 60fps with 334 live bullets. What it cost is
the interesting part, and it is written down at the bottom.

## What it is

```
@fight rain 24
```

A box, a soul you steer with the d-pad, patterns of bullets, invulnerability
frames, grazing, and an HP bar. `rules.js` is pure — no DOM, no canvas, no
timers — so a pattern can be simulated in Node and a fight can be balanced
without playing it. `register.js` is the scene, the art and the command.

| | |
|---|---|
| `KIT.bullet.create({x,y,w,h,hp,speed})` | a fight |
| `steer(f, {x,y}, dt)` · `spawn(f, {...})` · `step(f, dt, dir) -> { hit, grazed, gone }` | the loop |
| `pattern(steps)` · `runPattern(f, p, dt)` · `patternDone(f, p)` | patterns are data: `{ at, spawn }` |
| `B.movers` | `straight` `sine` `homing` `orbit` — a registry an author adds to |
| `B.PATTERNS` | `rain` `sweep` `hunt` `ring` to start from |

A bullet is `{ x, y, vx, vy, r, damage, life, move, data }` and a pattern is a
sorted list of `{ at, spawn }`. Both are plain data, which is what lets the
editor form itself from them later and what lets a test run a whole fight in a
loop with no browser.

## Measured

| | |
|---|---|
| four patterns, live in Chromium | **60 fps**, 0 dropped frames |
| a Sans-density pattern: 334 live bullets | worst simulation step **0.5ms** of a 16.7ms budget |
| the rules, headless in Node | a 544-step fight in milliseconds |

Performance is not what stops this engine making Undertale.

## What it cost — the real findings

**1. A scene could not draw.** `KIT.scenes` gave a scene
`enter/exit/update/input` and no way to put a pixel on the canvas. The only
things that drew were the renderer (map, entities, markers), `KIT.fx` and DOM
overlays. The first version of this fight painted itself into `world.markers` —
which worked, and was fast, and meant **the arena was drawn on top of whatever
bedroom you happened to be standing in.** There was no battle *screen*.

That was the one thing standing between "could this make Undertale" and "yes",
so it is fixed. A scene now has:

```js
{ opaque: true, background: '#000000', draw(ctx, view) { … } }
```

`draw` is called every frame, bottom of the stack upwards, with
`{ W, H, tilePx, camX, camY, time, world, scale }` — so a scene can line up with
the map, or ignore it. `opaque` tells the renderer not to draw the world at all:
it clears to `background` and hands over the frame. A battle screen is now
*cheaper* than a map, not more expensive.

This module is what proved it was missing and what proves it works: the whole
`paint()` function that shuffled markers is gone, replaced by a `draw` that puts
the arena in the middle of a black screen.

**2. The world keeps running underneath.** Nothing stops NPCs wandering while
you dodge, so the scene sets `world.busy = true` by hand. A scene that takes
over the screen could reasonably do that for itself.

**3. Everything else was fine.** `KIT.input.state(player)` gives held direction
for continuous movement. The command registers with fields, a summary and a
Screenplay round-trip (`@fight hunt 6`). The manifest declares a save slice and
a content slice and the engine fills both. Sounds, screen shake and the overlay
host were all reachable. No part of the engine had to be patched to write the
fight — only to let it have the screen.

## Using it

It is a module, so a project switches it on:

```
node tools/new-game.js "The Deep" --modules bullet
```

or adds `bullet` to `project.modules`. Then `@fight rain 24` in any script.
