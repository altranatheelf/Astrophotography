# 0015 — A new game is a blueprint, and a module brings its own

**Status:** accepted

## The question
"Start your own game" produced one blank 12×10 grid. On a computer that is a
reasonable place to begin: you have a mouse, two monitors and a folder of
tilesets. On a phone it is a dead end. The person who asked for this was on a
phone, and what they said was: make it so I can hit one button and have it set
up.

Between the blank grid and a game they could walk around in there were, on the
phone: open Creator Mode, find the Game group, find the Project panel, unfold a
section, type a title, tap the button, then paint a town a tile at a time with a
thumb, add a second map, join the two, paint tall grass, and fill in an
encounter table. Every one of those steps worked. Together they were enough
friction to end the idea, which is the same as not working.

## What was chosen
**A blueprint is a whole game.** `KIT.registry('blueprints')` holds
`{ id, label, describe, defaultTitle, order, build({ title, id }) -> project }`.
`presets` makes one object and `importers` reads one file; a blueprint makes the
entire project — maps, the connections between them, the people standing in
them, whatever a module keeps in `packs`. `KIT.blueprints.build(id, opts)`
normalizes the result, so what comes back is a project the editor and the game
can both take as they are.

**The engine ships exactly one: `blank`.** A blank map is the only game the
engine can describe without knowing what kind of game it is. Anything with tall
grass in it belongs to the module that knows the word (ADR-0005), so
`js/modules/mons/region.js` registers `mons-region`: a town, a house and a lab
you can walk into, a professor who gives you a first partner, and a route north
whose grass has something living in it. The purity test still holds — `js/kit`
names no module, and the list on the title screen is whatever is registered.

**The blueprint the module brings is listed first.** `blank` has `order: 90`.
The first item is the one a person lands on, and "here is an empty grid, good
luck" is the answer that sends them back to RPG Maker.

**The maps are sketches, not data files.** `region.js` holds four ASCII grids
and a legend, in the same shape as the tile art they are made of. You can read
the town. Somebody who wants a wider route widens the rows. Nothing is loaded
from a file, so the single-page build carries the whole thing for free, and a
phone with no signal can still start a game.

**Solidity is never written down.** The legend says which tile goes where; that
a wall stops you and tall grass has something in it comes from the tile
definitions in `js/art/tiles-*.js`. So an author who paints more tall grass
anywhere gets encounters there, without being told there is a collision layer.

**The door is on the title screen.** `Start your own game` sits above
`Creator Mode`, because a person who has just opened this on a phone wants
theirs, not this one. It opens one screen with one big button per blueprint and
an *optional* name box, left unfocused on purpose: a phone keyboard sliding up
over the buttons is the opposite of one tap. The same list is in
`Project › Start a new game` for people already inside Creator Mode.

**Creator Mode opens on the game being replaced, not on the new one.** The swap
is then a single commit against that document, which is the only reason undo
brings the old game back. Opening the editor on the new project instead hands it
a fresh document with an empty history — and a screen that offers an undo which
does not exist is worse than one that offers nothing. Both doors now take the
same path for the same reason.

**The second tap asks; the first one does not.** When `KIT.storage.hasDraft()`
says there is already a game on this device, tapping a blueprint repaints the
screen as "this replaces «that one»" with the safe answer selected. Somebody
opening this for the first time — the phone in the request — never sees it and
still gets two taps. Somebody who has spent a week on a region gets the one tap
that saves it. A modal in front of a first run would undo the whole point; a
silent replace of a week's work is not reversible enough just because undo
exists, because undo does not survive closing the tab.

**Nothing in the editor promises a key a phone does not have.** The copy says
**↶**, which is a button in the tool row on every device, rather than `Ctrl+Z`,
which is a promise to half the people reading it. (Two-finger tap is undo on
touch, and three fingers is redo.)

## What this rules out
* **Blueprints in the engine.** `js/kit/world/blueprints.js` may not name a map
  called "route" or a creature of any kind. If the kit ever ships a second
  blueprint it will be another empty thing, like "one map and one interior".
* **A wizard.** No steps, no next button, no "choose your region size". One
  screen, one tap, and everything it made is ordinary project data you can
  repaint, rename or delete.
* **Downloading a starter project.** It is computed in the page. No network, no
  second file to keep in step with the engine, nothing to go stale.

## How it is checked
`test/modules/region.test.js` floods the town from where the player starts and
asserts that both doors, the signs and the north edge are in the reachable set —
a region that validates but has the lab behind a tree is the same dead end as a
blank grid (ADR-0010). It also checks that the route's encounter table is keyed
on a region the map actually paints: the runtime falls back through `'*'` and so
never notices, while `Map › Encounters` lists one section per painted region and
would have said "Nobody lives here yet" over grass that was full of them.

`e2e/onetap.js` does the whole thing in a browser at 390×844 and 1280×800: two
taps, four maps, the Encounters panel showing all five species, undo bringing
the old game back, a partner from the professor, north across the seam, a step
in the grass, something meets you, a reload, still there — and, now that there
is something to lose, the door asking before it takes it.

`test/kit/phone-copy.test.js` fails if any message in Creator Mode tells a
person to press `Ctrl+Z` without naming the ↶ button beside it, and
`test/kit/load-order.test.js` fails if the single-file build starts asking for
a file it does not carry.
