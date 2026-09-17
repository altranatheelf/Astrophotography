# 0008 — A save is per-run; `meta` is per-player and survives New Game

**Status:** accepted

## The question
Where does "the game remembers you" live?

## What was chosen
Two tiers, explicitly separate. A **save** is one run: position, variables,
inventory, who knows what, which layer you are in. **`meta`** is the player:
how many runs, which endings were seen, names used, anything `@remember` writes.
New Game wipes the first and never touches the second.

## Why
This is the single feature the research names as load-bearing for a whole genre.
Undertale's `undertale.ini` is a 22-section, ~74-key cross-run layer next to the
per-run `file0`, and it is what makes every "you were here before" moment
possible. Its True Reset is *authored content* — a hand-picked whitelist of six
values that survive. RPG Maker has no such concept at all.

Two tiers is also what stops the obvious hack: without it, "remember across runs"
means not clearing something on New Game, which means the boundary between a run
and a player is wherever somebody last forgot to reset a variable.

## What was rejected
One store with a "don't clear me" flag per key. It puts the decision at the call
site, where it will be inconsistent, instead of in the shape of the data.

## What is NOT here
Undertale also writes files with deliberately innocuous names *outside* the save
directory (`system_information_962`, containing one character), so a True Reset
cannot reach them. A browser game cannot do that, and should not pretend to. The
honest equivalent is that `meta` is device-scoped and the player can clear it —
`KIT.storage` has export, import and delete-all.

## What would make this wrong
If authors keep reaching for a third tier — something per-chapter, or per-branch
— the two-tier model is too coarse. Watch for `meta` keys that encode a scope.
