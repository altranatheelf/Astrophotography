# 0016 — One definition, and the instrument that says so

**Status:** accepted

## The question
This engine was written by an AI assistant across many sessions, and the
published measurements of what that produces (GitClear 2025, 2026; see
`docs/SLOP.md`) name the same thing first every year: copies instead of calls.
When this repo was measured it had it. `num` was written out in twenty
files while `KIT.clamp` and `KIT.isObject` sat unused in `js/kit/core/util.js`,
and the copies had drifted until `num(null, 5)` was `0` in one file and `5` in
the next. Nine public functions had no caller anywhere. What rule stops it
coming back?

## What was chosen
**A helper has one definition, in `js/kit/core/util.js`.** A file that needs
it writes `const num = KIT.num;` at the top — an alias, so the body of the file
reads exactly as before — and never writes the body out again. A same-named
local that is a different thing (a field builder called `num`, a schema lookup
called `has`) is allowed and is distinguishable by its signature; a wrapper that
calls the shared one and adjusts (essentials lowercases before `titleCase`,
because PBS files shout) is allowed because it calls it.

**Dead means unreferenced anywhere.** A function on a public namespace that
nothing calls — not the engine, a module, a test, a tool, a document or a page —
is deleted, not kept "in case". A public API that is meant for a caller who has
not arrived yet is documented in `docs/KIT-API.md`, which counts as a reference,
and that is the whole of the ceremony: document it or it is dead.

**An empty catch says why.** `catch (e) { /* no clipboard here */ }` is a
decision; `catch (e) {}` is a bug report that was never filed.

**The instrument is separate from the judge.** `tools/slop.js` counts and
prints everything, including what is not gated (function length, shared
windows, comment density), so a person can look. `test/kit/slop.test.js` and
`test/kit/helpers.test.js` fail on the lines that can be drawn without reading.
The judgment calls stay judgment calls, on the list in `docs/SLOP.md`, to be
read for.

## What this rules out
* A second `util` — a module's own `helpers.js` with its own `num`. A module
  that needs a helper the kit lacks adds it to the kit.
* Keeping an unreferenced function because a comment says what it is for. The
  comment on `M.invalidateArt` said "Creator Mode edits art in place"; Creator
  Mode does not, and the function was the only evidence anyone had meant it to.
* Gating what needs reading. A threshold on function length would have split
  the panel builders into twelve pieces called once each, and called that
  organized.

## How it is checked
`npm test` runs `test/kit/helpers.test.js` (the shared helpers exist, mean one
thing, and are defined nowhere else) and `test/kit/slop.test.js` (no bare
catch, no dead API, no leftovers), both read off `tools/slop.js`, so the test
and the report cannot disagree about what they counted.
