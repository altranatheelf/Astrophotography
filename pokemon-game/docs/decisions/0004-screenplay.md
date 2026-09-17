# 0004 — Scripts have a lossless plain-text form

**Status:** accepted

## The question
A script is a list of command objects. How does a writer edit it?

## What was chosen
Screenplay: every command list has a plain-text rendering that parses back to
exactly the same commands. `Mira: Hello.` is a `say`. `? Do you remember me?`
with `- Of course.` under it is a `choice`. `@if` / `@else` / `@end` is a branch.
Round-trip is enforced by a test over *every registered command with every field
populated*, including gnarly quoted strings.

## What that rules out
A node-graph editor. A form-only editor. Any representation where the text is a
view that can drift from the truth.

## Why
Writers write in text. The research on narrative tooling is consistent about
this — Ink, Yarn and Twine are all plain text, and Yarn Spinner's graph view
stores node positions *as headers inside the .yarn file* precisely so the graph
is a view over diffable text rather than a separate binary.

The engine gets the same benefit twice over: a script is diffable, and the
editor's script panel and the raw file are the same thing.

## What that costs
Every new command must implement `text.toLine` / `text.fromLine`, and the
round-trip test will fail loudly when it does not. That test has caught real
bugs — most recently `@layer` failing on a quoted layer name with spaces.

## What would make this wrong
If a command genuinely cannot be expressed on one line without becoming worse to
read than the form. So far none has; the escape hatch is `raw`, which keeps a
line the parser did not understand rather than dropping it.
