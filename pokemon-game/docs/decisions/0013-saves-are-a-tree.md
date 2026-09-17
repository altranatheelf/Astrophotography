# 0013 — Saves are a tree of moments, stored as deltas

**Status:** accepted

## The question
A save slot is a lie a hard disk told us in 1994. What a player actually does is
go back to a moment and try the other thing, and every engine answers that by
making them overwrite the moment they came from. What shape should saves be?

## What was chosen
A tree. Every save is a **node** whose parent is the save it was made from, so
playing on from an older node makes a **branch**. Nothing is overwritten.

`save.moment` carries the node's id, so *loading* a save stands the player at
that point in the tree and the next save branches from there. That is the whole
mechanic and it needs no button: going back and playing on **is** branching.

The pause menu has a **Moments** row. A list, not a drawn graph: the tree is a
shape, but what a player wants is "take me back to when I was in the graveyard",
and indentation says branch well enough for that. A drawing is a nicer screen and
a worse answer, and it can come later without changing anything underneath.

## The payoff is not undo
Undo is the editor's (`KIT.document`): per-edit, in memory, linear. This is
per-save, on disk, and branching. What it buys that no amount of undo does is a
question the game can ask:

```
elsewhere.killed/dog >= 1        # a condition
{elsewhere:ate/bread}            # in a line of dialogue
```

"In some branch this playthrough went down and came back from, did they do this?"
No variable can answer that, because the variable was in the other branch. What
happened *before* the fork is not counted: that is our own past and it is not
news from elsewhere.

## The design was chosen by measurement, and the first version failed
`tools/experiments/timeline.js`, written and run **before** any of this was wired
to a menu, a command or a condition — the order `storage.js` should have been
built in and was not. Seven thresholds, set first, so that a failure would be an
instruction rather than a number to admire afterwards.

A save is one JSON document in browser storage (ADR-0008), so a tree of N saves
is N of them: 200 moments of the demo world as full saves is **6.65MB**. The
first design — a delta per node with a whole save every 12 — came in at **1.1MB**
and **failed two thresholds**. The measurement said why: the 17 whole saves were
592KB of that 1.1MB, and all 183 deltas together were 119KB. *The anchors were the
tree.* A further 400KB was each node's copy of the run's history tally.

Two changes, both of which the number pointed at:

1. **Anchor on economics, not on a count.** A chain of deltas may not cost more
   than the save it stands in for. Cheap deltas earn a long chain; an expensive
   one (a newly painted map) pays for an anchor immediately. It tunes itself to
   whatever a game turns out to save, which no constant can. The only fixed cap
   left is `MAX_CHAIN`, and that is about rebuild latency, not size.
2. **Store what a moment ADDED to the tally, not the whole tally.** A tally only
   ever grows, so the increments are one or two keys, and "how many times over
   there" is the sum of the increments between the fork and the tip. Same answer,
   forty times smaller.

Result: **409KB for 200 moments**, 17× cheaper than a save per moment, every
threshold passing with room:

| | measured |
|---|---|
| 200 moments | 409 KB (3 whole saves, 197 deltas, 629 B average) |
| rebuilding the oldest | 0.2 ms |
| recording one | 5.0 ms |
| `elsewhere()` | 0.9 ms |
| writing the whole tree | 4.2 ms |
| a rebuilt save vs the save | identical |

And then again at the ceiling — 1,500 moments, which is what the 3MB budget
allows and is where a long playthrough arrives. That run found a second cliff
that 200 moments could never have shown: `prune()` asked "have I anything to do"
by stringifying the whole tree, which at 1.89MB was **27.5ms of a 16.7ms frame,
on every save**. The total is carried instead — each node adds its bytes when
recorded and gives them back when pruned, measured exactly once when the tree is
read in. (Carrying it was wrong by one node at first: the lazy first measurement
counted the node being added, and then added it again. 34KB of drift that never
washes out, caught by a threshold on the drift itself.)

| at 1,500 moments | measured |
|---|---|
| recording one | 7.5 ms |
| `elsewhere()` | 0.44 ms |
| rebuilding the oldest | 0.4 ms |
| drawing the whole list | 1.2 ms |
| writing the tree | 24.2 ms |
| running total vs the real one | 11 bytes of 1.98MB |
| every moment left rebuildable | 1500 of 1500 |

`elsewhere` and `everywhere` are **conditions**: they run inside a frame, on
every event page the world evaluates. Both had a square in them, in different
shapes, which is why it was worth looking twice.

- Three things asked `children(id)`, a scan of every node, for every node in
  turn. There is one parent→child index now, built on demand and dropped
  whenever the tree changes.
- `everywhere` asked `tallyAt` for every branch tip, and each of those walks its
  whole line and builds the entire ledger to read one key out of it. Measured on
  a 1,500-moment tree with 38 tips and 90 tally keys: **9.4ms that way, 0.60ms**
  as a single pass that adds up as it goes, same answer. More than half a frame
  for one question.

The single pass works because nodes come in the order they were recorded and a
child is always recorded after its parent, so a parent's running total is always
ready — and because a tally only grows along a chain, the largest total anywhere
in the tree is already the largest at some tip.

## The delta format is three ops
```
{ p: path, v: value }            set
{ p: path, x: 1 }                delete
{ p: path, cut: n, add: [...] }  an array lost n from its front and gained these
```
The third exists for exactly one shape, and it is the shape that matters. The
history window (ADR-0011) is a bounded list that drops its oldest as it gains its
newest, so between two saves it is the same 399 entries at different indices. A
prefix/suffix diff calls that "everything changed" and writes 40KB into every
moment; this sees one entry. **185 bytes instead of 40KB.**

Arrays get three candidate encodings — item by item, head-drop-plus-append, and
replace-the-lot — and the smallest **measured in bytes** wins, because which one
is smaller depends entirely on what the array is for.

## What gets thrown away
Only **leaves**, because a node in the middle is what its children's deltas are
written against. Never one on the way to where the player is, never one the story
named with `@moment`, never the root, oldest dead end first. When everything left
is load-bearing, the tree stops pruning and says so rather than corrupting
itself. The test asserts the invariant directly: every surviving node still
rebuilds.

## What this costs
- A save is ~5ms slower, because recording a moment diffs the save.
- Rewinding is not rewinding *time*: it loads a save. A scene mid-conversation is
  not resumable, because a save was never resumable.
- `elsewhere` reads the tally, so it can only ask questions the tally can answer
  (ADR-0011): a verb, or a verb and its object. Not "in the diner".
- A tree can still be pruned away under a full store. The player's own line and
  every named moment are the last things to go, which is the right order, but
  "every branch forever" is not a promise this can make.
- The tree is one document, so saving writes all of it: 24ms at the 3MB ceiling.
  Under the storage experiment's own 100ms rule, but it is the cost that scales
  with the budget rather than with the change. One key per node would fix it and
  would make `rebuild` asynchronous, which is a bigger change than the number
  currently justifies.
- A store is not a promise, so `repair()` runs on the way in and drops any moment
  whose parent is gone, and everything below it — a delta is written against its
  parent, so an orphan cannot be rebuilt and neither can its children. The
  alternative is a Moments list with rows that do nothing.

## What would make this wrong
If players never open the Moments list. That would mean branching is a thing
*designers* like and *players* do not, and the honest response would be to keep
the delta store (which is strictly cheaper than slots) and drop the screen.

Watch also for authors using `elsewhere` to fake a variable — "set a flag over
there, read it here". That is the interesting use and also the one that turns into
spaghetti fastest.

## Consequences you can see
`js/kit/world/timeline.js`, `tools/experiments/timeline.js` (`npm run
experiments`), the Moments row in `js/kit/scenes/menu.js`, `G.enterSave` and
`G.gotoMoment` in `js/kit/game.js`, the `@moment` command, the `elsewhere` and
`everywhere` conditions, `{elsewhere:…}` and `{everywhere:…}` in a line,
`test/kit/timeline.test.js` (18 tests, including a hundred seeded rounds of
play), and `e2e/moments.js` — which branches in a browser through the pause menu
and proves the abandoned line is still there after a reload.
