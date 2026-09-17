# 0007 — Text is DOM; the world is canvas; scenes may draw both

**Status:** accepted

## The question
Draw text with the canvas, or lay it out with the browser?

## What was chosen
Both, for different jobs. The dialogue box is DOM — real text, selectable,
scalable, and the browser does line breaking, font fallback and CJK. A scene that
owns the screen draws its own words with `KIT.drawText`, on the same span
pipeline, so `{color:}`, `{voice:}` and `{fx:}` mean the same thing in both.

## Why not canvas everywhere
Undertale draws every glyph itself, and the consequences are all in its source:
kerning is a hand-written per-letter lookup inside the draw loop (22 hardcoded
adjustments for the Papyrus font alone), the visible text is re-parsed and
re-drawn character by character *every frame*, and the Japanese localization
required doubling the font set plus vertical-text support. Scribble, the library
GameMaker users reach for, exists specifically because that approach "ends up
being slow or limited (or both)."

Using DOM for prose means CJK, Cyrillic and Greek work on every platform with no
glyph atlas, no subsetting, and no kerning table — the entire category of problem
is the browser's, and the browser is good at it.

## Why not DOM everywhere
An Undertale battle IS its text: the line sits inside the arena, the labels are
on the battle surface, damage numbers fly off the enemy. None of that is an
overlay. A scene that owns the frame has to be able to write on it.

## What would make this wrong
If the two paths drift — if a code works in one and not the other, an author has
learned two systems. The guard is that both consume `KIT.text.tokenize`/`wrap`;
they cannot diverge without that being deliberate.
