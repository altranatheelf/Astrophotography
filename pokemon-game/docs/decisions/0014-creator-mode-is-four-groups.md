# 0014 — Creator Mode is four groups, and a panel picks its tool

**Status:** accepted. Amended by [0017](0017-looks-are-data.md): the groups are five, with Look between Story and Game.

## The question
Creator Mode grew one panel at a time until there were nineteen tabs in a row,
nine unlabeled emoji for tools, and a side sheet that took a quarter of a phone
whichever panel was open. Every panel was reachable (ADR-0010) and nothing was
usable. What shape should the editor have, and what decides it?

## What was chosen
**Screenshots decide.** Every change in this pass was made against a photograph
of the editor at 390×844 and 1280×800, and the e2e suite photographs every panel
at both sizes on every run. A layout claim that is not in a screenshot is not a
claim.

**Four groups.** The side panel is *Map* (what is on this map), *Story* (what
happens and who says it), *Game* (the whole project) and *Problems*. A panel
says which group it belongs to (`section`); a module's panel says so itself, so
the kit never names a module (the purity test holds). A group with one panel
opens it; Problems carries a count.

**A panel picks its tool.** Opening Events hands the pointer to Move, opening
Tiles hands it back to the Pencil (`tool` / `tools` on the panel definition).
Before this, tapping an event with Events open painted grass under it: the tool
and the panel were two states the author had to keep in step by hand, which is
the RPG Maker "map mode / event mode" switch done worse. Now the panel is the
mode.

**The sheet follows the group.** On a phone the sheet is short under Map,
because the map is what you tap, and tall everywhere else, because a script or
a form is what you read; the tool row hides with it. A grip overrules the guess.

**Words on the tools.** Every tool button carries its name. An icon alone is a
puzzle; a word under it is a label.

## What was not chosen
- A drawer or hamburger for the panels. Four words across the top are one tap
  from anywhere; a drawer is two, and hides where you are.
- Hiding the map entirely off the Map group. A strip of map keeps the author
  oriented and lets pick-on-map flows stay visible.
- Making the demo project the only project. *Game › Project › Start a new
  game* replaces it with a blank map, as one undo step, from the phone.

## Consequences
- `EDITOR-CONTRACT.md`: `section`, `tool`, `tools`, `sheet`.
- A panel that names no group lands in Game, so an unplaced panel is a visible
  mistake, not a lost one.
- The reachability tests keep every panel and every setting reachable; this ADR
  adds the second half: reachable *and photographed*.
