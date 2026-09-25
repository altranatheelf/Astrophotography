# Slop

**This document is** the checklist this codebase is held against for the
failure modes of code written a file at a time — by an AI assistant across many
sessions, which is how this one was written — and the instrument and tests that
hold it there. Where it disagrees with `docs/ARCHITECTURE.md` about what the
engine is, that one wins; where it disagrees with a test, the test wins, because
the test runs and this page does not.

## What the research says

There is now enough AI-assisted code in the world to measure what it does
differently, and the findings are consistent from year to year. GitClear's
analysis of 211 million changed lines ([2025 report](https://www.gitclear.com/ai_assistant_code_quality_2025_research),
[2026 follow-up](https://www.gitclear.com/the_ai_code_quality_maintainability_gap))
puts numbers on it:

* **Copies instead of calls.** Copy/pasted lines went from 8.3% of changes in
  2020 to 15.7% in 2026; blocks of five or more duplicated lines rose 8× in a
  single year. Cross-file function calls fell 35%. The assistant reaches for a
  new block rather than the existing one, because a new block is what "tab"
  produces.
* **Refactoring collapsed.** "Moved" lines — the signature of reuse — fell from
  24% of changes to under 4%. AI-assisted developers are now about five times
  more likely to paste than to move.
* **Errors masked.** Error-masking constructs — the empty `catch`, the
  `|| {}`, the `?.` that turns a bug into a silent `undefined` — rose 47%.
* **Churn.** Code rewritten within two weeks of landing roughly doubled: it was
  wrong the first time, and nobody read it.
* **Atomic, not integrated.** The report's phrase: the default workflow is
  "incentivized to deliver atomic code — a happy path, a passing test, a closed
  ticket — while quietly taxing the invisible and the deferred."

The code-level lists that followed ([one](https://dev.to/bzprchny/5-code-smells-only-ai-creates-and-how-to-detect-them-1e3l),
[another](https://www.augmentcode.com/guides/debugging-ai-generated-code-8-failure-patterns-and-fixes),
[a third](https://tenki.cloud/blog/reviewing-ai-generated-code)) agree on the
shapes: the plausible API that does not exist; the thirty-line clone with one
field changed; the empty catch; the enterprise pattern wrapped round one use;
the function that is four concerns glued end to end; the comment that narrates
the next line, or describes what the code did two sessions ago; the hook
written for a caller that never came.

None of that is specific to machines. It is what any code gets when it is
written faster than it is read. The machine just does it at scale.

## What this codebase had

Measured in September 2026, before the pass that produced this page:

* `num` was defined locally in **21** files, `isObj` in **13**, `titleCase`
  in **12**, `has` in **9**, `clamp` in **3** — while `KIT.clamp`,
  `KIT.isObject` and `KIT.slug` already existed in `js/kit/core/util.js`. And
  the copies had drifted: `num(null, 5)` returned `0` in `js/kit` and `5` in
  `js/modules`. Same name, two answers, depending on the folder.
* **57** empty `catch` blocks. Every one carried a comment, which is better than
  the industry norm and still not the same as every one being right.
* **10** functions defined on a public namespace that nothing anywhere called —
  including `M.invalidateArt`, a hook "for when Creator Mode edits art in
  place", written for an art editor that was never built.
* Two file pairs sharing runs of six identical lines (`js/kit/editor/panels-project.js`
  and `js/kit/editor/panels-writing.js`; `js/modules/dungeon/panel.js` and
  `js/modules/home/panel.js`), and eight functions over 175 lines.
* Zero `TODO`s, zero stray `console.log`s, zero tests without an assertion, and
  a docs test that already failed when a document named a file that was not
  there. Those are the marks of having been read; this page is about the rest.

## What holds the line now

`npm run slop` (`tools/slop.js`) is the instrument: it counts the things above
and prints them, and it is meant to be run again in a year. It does not judge.
The judging is in tests, and a test only exists for a line that can be drawn
without reading:

| The line | Held by |
|---|---|
| A helper lives in `js/kit/core/util.js` once; a file may alias it, never copy it | `test/kit/helpers.test.js`, `test/kit/slop.test.js` |
| `num`, `has`, `titleCase` mean one thing | `test/kit/helpers.test.js` |
| An empty `catch` says why, or it is a bug report nobody filed | `test/kit/slop.test.js` |
| API nothing references — not the engine, tests, tools, docs or a page — is dead. Document it or delete it | `test/kit/slop.test.js` |
| No `console.log`, no `TODO`, after a session ends | `test/kit/slop.test.js` |
| `js/kit` names no module | `test/kit/purity.test.js` |
| The load order is one list, repeated nowhere it can drift | `test/kit/load-order.test.js` |
| A document names only files that exist and quotes only the true test count | `test/kit/docs.test.js` |
| Every `KIT.*` a document names exists, and so does every function a `typeof KIT.x === 'function'` guard asks about | `test/kit/docs-api.test.js` |
| No message tells a phone to press a key it does not have | `test/kit/phone-copy.test.js` |

## What is measured and not gated, on purpose

**Function length.** A 400-line function that builds one panel top to bottom is
one thing, and splitting it into twelve named pieces that are called once each
is a worse read, not a better one. A 400-line function that is four concerns
glued together is the smell. A number cannot tell those apart; a person can.
`npm run slop` lists the longest so a person looks.

**Shared six-line windows.** Two panels that build a status line the same way
might want one helper, or might be two things that happen to look alike this
week. Listed, not failed.

**Comment density.** This codebase comments heavily, in an essay style that
says *why*. That is a choice (`docs/decisions/README.md`), and the failure mode
is not the count but the lie: a paragraph that describes what the code did two
sessions ago. That takes reading, and it is the first question on the list
below.

**The empty catch with a comment.** The comment is the minimum; whether the
error it ignores is one the author needed to hear about is the second question.

## Reading the parts a count cannot see

Run the instrument, then read for these, in this order, and write down what
was found with a `file:line` or not at all:

1. **Does the comment tell the truth?** Pick a substantial comment; check the
   claim against the code under it and the code it names.
2. **Which swallowed errors were real?** For each empty catch: what can
   actually throw inside the try, and what does the user see instead?
3. **Is the long function one thing?** Read it whole. Name the seams if there
   are seams.
4. **What do the two files share, and have the copies drifted?**
5. **Does the API documentation describe this code?** Every signature in
   `docs/KIT-API.md` and `docs/EDITOR-CONTRACT.md` against `js/`.
6. **Is anything abstract for one user, or reimplemented beside the thing it
   reimplements?** A registry with one entry; a schema field nothing reads; a
   panel with its own undo.

Each finding gets a skeptic before it gets a fix: somebody whose job is to
refute it from the source. About a third do not survive that, and the ones
that do are the ones worth the time.

## What the reading found

The six questions above were put to the codebase in September 2026, one reader
per question, with a skeptic per finding reading the source to refute it. Of
110 findings, about a third had already been fixed by the time a skeptic got to
them, or were wrong. What survived was more interesting than the counts: the
worst of it was bugs, and every bug was one of the patterns in the research.

**Bugs, each now under a test.**

* *A copy that was wrong, copied.* The Dungeon panel handed the inspector's
  field path to `doc.set` as the whole pack, so the first number an author
  changed replaced `packs.dungeon` with `['torchRadius']`. `tools/new-module.js`
  wrote the same line into every module it scaffolded. Both now call one
  `KIT.editor.inspector.packForm` (`e2e/editor.js` makes a dungeon game and
  types into it; `test/kit/templates.test.js` guards the scaffold).
* *Hand-built beside the shared thing.* Home's numbers had their own inputs,
  which let a chance of 5 through; the inspector's widget, one call away,
  clamps. And every keystroke in a number field was its own undo step, while
  the text widget three screens down already waited for a pause.
* *Documented, consumed, never defined.* The Map panel asked for a `mapSections`
  registry, a module added to it, the API doc described it, and nothing had
  ever defined it, so both sides guarded on it and the section never appeared.
  The world never emitted the `interact` event its docs promised either.
* *Errors masked.* A corrupt Aseprite cel or Tiled layer was reported as "pass
  `opts.inflate`" — a missing decoder — because the decoder's own reason was
  caught and turned into `null`. A malformed external tileset was reported as
  never supplied. A malformed `@if` line lost the parser's reason and said
  "could not read this line". A validator that threw left the Problems panel
  empty. A draft the browser could not read was overwritten by the next
  autosave.
* *Work done twice.* Five panels, the ref creator and the Import panel ran the
  refresh, the validation and the save a second time after `ED.commit` had
  already done them.

**Dead weight.** Fields declared, validated and defaulted on every definition
and read by nothing (tile `probability` and `warpLook`, object-type `limit` and
`toc`, preset `kind`, a migration `target`, rule `carrier`,
`settings.encounterRate`, a `radius` display hint);
hooks for callers that never came (registry `onAdd`/`onRemove`/`silentReplace`,
the registry's and the module system's `reset()`, document snapshots, an editor
wrapper round `KIT.renderer.create`). All removed; saved projects that carry
the old keys still load.

**Copies turned into calls.** The script-slot labels (one panel said
"Interact" where the rest said "On Interact", against its own docstring), the
file picker and paste box, form teardown, the menu's screen switch, the catch
scene's way back to its menu, the home cursor, the RPG Maker parser's block
closer, and each module's private copy of the save-slice and pack logic that
`KIT.modules` already runs from its manifest (the copies had drifted: one
skipped the defaults, one let a failing migration throw). The one long function that was many things — the Project panel's
400-line `refresh`, eight sections that shared nothing but `host` — is eight
named sections now. The other long ones (`catchScene`, the menu, the script
editor's mount) are each one scene built top to bottom, and stay.

**Comments that described the past.** Section numbers pointing at sections
that do not exist; a shell described as "frozen" that had changed four times
that month; `@eat` for what is spelled `@rule eat`; a renderer described as
unable to draw sprites it had drawn for weeks; paragraphs that were the
biography of a line rather than its reason. Corrected or cut.

**Kept, on purpose.**

* Tile `terrainTag`. Nothing in the engine acts on it, but it is RPG Maker's
  own per-tile data: the importers carry it in and `KIT.tiles.flags` hands it
  to a game. Deleting it would lose what a person imported. (`warpLook`, which
  no tool outside this repo writes, went: it was set on five door tiles and
  promised as "tile behaviour" in the import guide, and it did nothing.)
* Registry `on('add'|'remove')`. Only a test calls it, but it is documented in
  `docs/KIT-API.md`, which ADR-0016 counts as a reference: an extension point
  offered on purpose.
* The shared six-line windows between the Dungeon and Home panels: the
  scaffold's panel skeleton, written so that a module reads on its own.

**Measured again afterwards:**

| | before | after |
|---|---|---|
| helper copies | 58 | 0 |
| empty `catch` blocks | 57 | 44, each with its reason |
| public API referenced by nothing | 10 | 0 |
| functions of 175 lines or more | 8 | 7 |
| unit tests | 610 | 632 |

