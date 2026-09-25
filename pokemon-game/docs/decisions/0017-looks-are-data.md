# 0017 — Looks are data, compiled to one stylesheet

**Status:** accepted. Amends 0014: Creator Mode has five groups.

## The question
The person this engine is for makes games in the style of three well-known
RPGs, on a phone, and every one of those games is recognised by its interface
before anything else: the box, the cursor, the menu, the sound of the letters.
The engine had one interface, and changing it meant editing `css/kit.css` and
the scenes' code on a computer. How does an author make the game *look like
their game* — from a phone, safely, and in a form that can later be carried
from one game to another?

## What was chosen
**A look is data: `project.ui`, overrides only.** A small object of what this
game changes, on top of a look it starts from (`ui.base`: the built-in `kit`,
`handheld`, `soul`, `dream`, or one of the game's own). Every field has a
schema — `KIT.look.TOKENS` for colours and widths, `KIT.look.PARTS` for each
part's options — and every value is cleaned against it: hex colours, numbers
pulled into range, known choices, marks cut to their length and escaped. There
is no field for raw CSS.

**One compiler, one stylesheet.** `KIT.look.compile` is pure and turns a look
into `<style id="kit-look">`: the tokens as custom properties on `#stage`,
which `css/kit.css` reads through `var(--kit-*, <its old literal>)`, then one
rule for each option that is not the kit's own. Every rule starts at `#stage`
or `#screen`, so it wins over the kit and cannot reach Creator Mode. The kit
look compiles to the empty string, which is how "a game that never touched its
look is the game it was" is proved: a unit test holds the fallbacks to the
tokens, and a browser snapshot of the computed style of the game's chrome, on
a phone and a laptop, holds the result.

**The built-in screens stay code.** The message box, the choice, the menus and
the title keep their markup, their input and their timing; a look changes how
they are drawn and a few things they read (lines to a page, the mark at the
start of a line, the ▼, the menu's heading). They are not turned into widget
trees an author edits — that is a bigger engine for a smaller gain, and the
author's own screens, when they come, are a separate thing.

**Look is a group of its own.** Creator Mode was four groups (ADR-0014). How
the game looks and sounds is something a person sets out to do, not a setting
among the game's; as the seventh chip under Game it would not be found. The
groups are now Map · Story · Look · Game · Problems, and on the narrowest
phones Problems is `⚠ n` so five fit. Under Look the sheet is short, like Map,
because the top half of the phone is a **live preview**: the real dialogue and
choice scenes, driven off the scene stack into a shadow root, so a look is
judged by watching it type. A panel may now own the stage (`stage(el, ed)`),
and a change is written once when the controls go still (`KIT.editor.pending`),
so a colour dragged across the picker is one undo step.

## What was not chosen
- **A stylesheet per game that the author edits.** It can do anything —
  fetch, hide the pause menu, cover the screen — so it cannot travel between
  games or be trusted from a file, and on a phone nobody writes CSS.
  `look.css` stays as a programmer's escape hatch and never travels.
- **Built-in screens as data.** See above.
- **A second words table for the interface.** The Terms table is the one
  place words live; the Look panel will link to it.
- **Storing the whole resolved look in the game.** Only overrides are kept,
  so a better built-in look reaches a game that started from it, and a value
  put back to the look's own is not a change.

## What would make this wrong
- An author needs something a token or an option cannot say, often enough
  that `look.css` becomes the normal way in. Then the fields are too few, and
  the answer is more fields, not raw CSS.
- The preview drifts from the game: a scene that behaves differently off the
  stack than on it. `e2e/look.js` shows the same look in the preview and then
  in the game, and compares the message box's computed colours, border and
  corners in the two; if that has to start excusing differences, the preview
  is lying.
- Five groups stop fitting a phone. They fit at 390 pixels wide, with the
  sheet's grip beside them, every target at least 44 pixels, which
  `e2e/look.js` measures.
