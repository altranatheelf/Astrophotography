# 0003 — Projects are readable JS, one file per map

**Status:** accepted

## The question
What does a saved project look like on disk?

## What was chosen
Readable JavaScript with sorted keys, one file per map under `maps/<id>.js`,
plus `project.js`. A 20×15 map is about 245 lines with the longest line at 159
characters. No minification, ever.

## What that rules out
A single blob. A binary format. Anything faster to parse.

## Why
Git. RPG Maker MV writes each map as one minified JSON line, and the consequence
is documented by its own users: git sees a single line, so it cannot merge even
non-overlapping edits — two people editing different corners of a map produce a
conflict a human has to resolve by hand in a beautified copy. The community's
answer is a git hook or a "Pretty JSON" plugin; MZ shipped a formatting option
in 2025, nine years after MV.

Construct has roughly double GameMaker's footprint on itch.io despite an
unmergeable binary project file, so this is not what most people choose on. It is
what a multi-year project needs, and this engine is for a multi-year project.

## What would make this wrong
If parse time at OMORI scale became the boot bottleneck. Measured: 400 maps
boots in 0.34s, 1,000 in 0.92s. Not close.

## Consequences you can see
`KIT.project.exportFiles`, the "Save as files (for git)" button in the Project
panel, and the deliberate refusal to offer that button as 400 downloads when the
browser has no directory picker.
