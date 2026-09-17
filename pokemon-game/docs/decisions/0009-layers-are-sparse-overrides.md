# 0009 — A layer of reality overrides cells, not whole maps

**Status:** accepted

## The question
"The same room, otherwise" — a second map, or a diff?

## What was chosen
A diff. `map.dimensions.<name>` holds `tiles` (a sparse map keyed `"x,y"`),
`objects` (per-object `hidden`), and optionally its own `music` and
`atmosphere`. The layer you are in is one value, `save.dimension`, which is
global rather than per-map: a layer of reality is a property of the world, not
of a room.

## What was rejected
Paired maps with warp tiles, which is what A Link to the Past does and what RPG
Maker forces. Also OMORI's approach: a hard cut where both layers are never live.

## Why a diff
Authoring. A paired map means every ordinary edit has to be made twice, and they
drift — the Dark World and Light World diverge by accident, not intention. A
diff means the author changes only what differs, which is usually a handful of
tiles and who is standing there.

## Why the layer is global
Tested, in `interactions.test.js`: shift into a layer, walk to a place that does
not have it, and that place shows itself — not an error and not a blank room —
but the view still reports which layer you are in, so a door can care. Walk back
and you are still in it. That is the behaviour "parallel dimensions" wants; a
per-map layer would mean walking through an ordinary corridor quietly returns you
to reality.

## What would make this wrong
A game where two places have same-named layers that mean different things. The
global name would collide. No such case has come up; if one does, the fix is a
namespace on the layer name, not per-map state.

## Consequences you can see
`KIT.mapView`'s `dimNow()`, `world.shift`, the `@shift` command, and four pairs
in the interaction matrix.
