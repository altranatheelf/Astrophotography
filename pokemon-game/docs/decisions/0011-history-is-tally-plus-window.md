# 0011 — History is a permanent tally plus a bounded window

**Status:** accepted

## The question
A game that remembers you needs a list of what you did. Where does it live, and
how much of it is kept?

## What was chosen
Both halves, split by what they are asked for.

- A **tally**: a small map of counts, keyed `verb` and `verb/what`, never
  trimmed. `has()` and `count()` read this and are **exact for the life of the
  save**.
- A **window**: the last `KIT.history.WINDOW` entries in full, each with verb,
  what, who, where, which layer, and the in-game minute. `last()`, `all()` and
  `since()` read this and see only the recent past.

`KIT.history.exact(query)` says which of the two a given question gets, so an
author can find out without reading the source.

## What was rejected
An unbounded append-only log, which is what a database-backed engine would do
and what the WEFT plan specifies (IndexedDB via Dexie, a Bloom filter in a
worker for "did this ever happen", sqlite-wasm over OPFS if it does not scale).

That is the right design for a save that lives in a database. It is the wrong
one here, because **a save in this engine is one JSON document** in browser
storage. An unbounded list is a save that grows until it stops fitting, and the
measured write cost is already 75ms at 1,000 maps (`npm run experiments`).

The split is not a compromise on that design — it is a different answer to the
same question, and it happens to be cheaper: "did the player ever eat bread" is
a map lookup rather than a Bloom filter over a worker.

## What this costs
"How many times in the diner" is only exact within the window, because the tally
does not key on place. An author who needs that beyond the window counts it
themselves with a second verb — and `count` is how.

## Why not variables, the usual answer
Undertale's is a flat array of 512 integer flags, written and read in a bare
loop. Only 351 indices are ever used, and `FL_FinalTorielChoice` is index 512 —
outside the 0..511 loop that persists them, so it silently does not save. That is
what hand-counting narrative state looks like after 190,000 lines.

## What survives a run
Nothing, by default. `promote(save, verb, what)` moves one fact to `meta`
deliberately. What survives a reset is authored content, not a side effect —
Undertale's True Reset rewrites exactly six values out of twenty-two sections,
hand-picked, and that is the right shape.

A story says it with `@remember <verb>[/<what>] ever` and reads it back with
`ever.<verb>/<what> >= n` or `{ever:…}` in a line. Those two were added later than
this decision and the gap is worth recording: for a week this was the engine's
headline feature — "you have been here before" — with `promote` called by nothing
at all. Not a command, not a condition, not a screen. It had this document, a
unit test, and no way for a story to use it. `test/kit/story-reach.test.js` now
classifies every function the story layer exports as SAID, ASKED, SHOWN or
PLUMBING and fails until a new one is classified.

Carrying over something that never happened records nothing. It used to record 1
(`Math.max(1, count)`), which meant a line that ran on the wrong branch of an
`@if` could tell the player's own history a thing that never occurred, forever.
`count` is exact from the tally for this shape of question, so there was never
anything for the max to protect against.

## What would make this wrong
If authors routinely hit the window for questions the tally cannot answer. Watch
for games that raise `WINDOW` rather than adding a verb.

## Consequences you can see
`js/kit/world/log.js`, the `@did` command, the `did.<verb>/<what> >= n`
condition, `{did:…}` and `{ever:…}` in a line, and five pairs in the interaction
matrix. Named `KIT.history` because `KIT.log` is the engine's logger — a
collision the unit suite caught on the first run.
