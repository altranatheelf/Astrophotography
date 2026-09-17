# 0012 — A rule of the world is a thing in the world, made of a condition and a script

**Status:** accepted

## The question
Most engines keep the rules of a game in the engine, where the game cannot reach
them. If a story wants to say "from now on, doors do not need keys", what shape
is that?

## What was chosen
A rule is a row in the project, beside the variables and the items, with three
parts an author already knows:

| part   | type                                   |
| ------ | -------------------------------------- |
| `when` | an event name (`step`, `mapEnter`, `bump`, `logged`, …) |
| `if`   | a **condition** — the same type an event page's page-condition uses |
| `do`   | a **script** — the same command list an event page runs |

Plus `on`, `priority`, `edible`, `carrier` and a `scope` of maps and layers.

It can be switched off, **rewritten**, and **eaten**. `@rule eat doors-need-keys`
is a verb a story can use, and after it the doors do not need keys, because the
rule that said so is gone. `rule.doors-need-keys` is a condition; `not
rule.doors-need-keys` asks whether it has been eaten.

Eating writes to the history (`ate rule:doors-need-keys`), so a line ten hours
later can ask about it.

## What was rejected, and why it matters
**A rule DSL.** Inventing a rule language means inventing predicates, effects, an
editor widget for each, a validator, a text form, a reference index and
translation extraction — every one of which already exists here for conditions
and scripts. A rule that reuses them inherits all of it the day it is written:
the e2e proves the ＋ New button produces a working form without a line of
hand-built UI.

**Listener objects in code.** The WEFT plan's ADR-0006 chose TypeScript listener
objects, and then its own Editor document required rules to be authored as JSON
in a GUI. Its §9 records the contradiction and resolves it: *"Since you can't
write TypeScript, the Editor doc has to win."* That is the same conclusion, and
it is worth noting that a plan can only record the contradiction — it took
running code to find out that the resolved design is *cheaper*, not more
expensive, because the pieces were already there.

## Conflict is defined, not emergent
Two rules on the same event run in a stated order: **priority**, then
**specificity** (a rule naming this map beats one naming a layer, which beats a
global), then **most recently defined** (a rule invented during the run beats one
that shipped), then id. `KIT.rules.matching()` is pure, so the editor can show an
author exactly what will happen and in what order.

## Loops are capped in two places, because there are two ways round
`KIT.rules.fire` caps the **depth** of one chain at 8. The world's drain caps the
**number of firings** in one pass at 512, because a rule can also come back round
through the event queue where the depth counter cannot see it. Both write
`rule:loop` into the history rather than freezing.

The loop-breaker writes that line *before* it empties the queue: writing
something down is itself an event, and a rule listening for `logged` is exactly
the kind of rule that caused the loop. Getting that backwards re-armed the loop
it had just broken, which is how the ordering was found.

## Firings are queued
A rule's `do` can speak, and speaking takes time. Two footsteps in one frame must
not start two conversations, so firings queue and drain in order, one at a time.
`world.rulesSettled()` is how a test waits. `world.busy` goes on around a rule's
script and not around the whole drain — most events match no rule, and a world
that goes busy on every footstep is a world you cannot walk across.

## What this costs
- A rule is as slow as its condition, on every matching event. The cheap path is
  a dictionary lookup on `when` before anything else runs.
- `scope` is maps and layers only. "Within three tiles of the tomb" is not
  expressible; the `if` condition is where that goes.
- Eating is permanent within a run and cannot be undone by `@rule on`. A story
  that puts the tome back together says so itself, by defining the rule again.

## What would make this wrong
If authored rules turn out to be mostly `when: step` with a heavy `if` — that
would mean the event surface is too coarse and the real fix is more events, not
more rules. Watch for `if` conditions that re-derive where the player is.

## Consequences you can see
`js/kit/world/rules.js`, the `rule` shape in `js/kit/world/project.js`, the
`@rule` command, the `rule` condition kind and its bare-word text form, the Rules
panel in `js/kit/editor/panels-project.js`, `test/kit/rules.test.js` (19 tests),
and `e2e/rules.js` — which eats a rule in a browser, walks, and proves the world
plays differently, then reloads and proves the save remembered.
