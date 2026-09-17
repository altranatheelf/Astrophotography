# Could this make Undertale or OMORI?

Yes. The interesting part is *why* that answer is not about features.

This document is the audit: what the industry actually does, measured against
what this engine actually does. Everything with a number in it was measured on
this machine, in a real browser, not estimated. Everything about other people's
games is sourced.

---

## 1. The thing nobody tells you about RPG Maker

The common story is that RPG Maker is limiting — that you hit a wall of things
it cannot do. The people who actually shipped on it say something different, and
they say it consistently.

**Kan Gao** (To the Moon, the most commercially successful long-term RPG Maker
developer) says there is "a misconception that RPG Maker can't make advanced
custom systems." The one wall he names is *porting* — getting the finished game
onto another platform — and it was solved for him not by the vendor but by
Ancurio, an unpaid open-source developer who reimplemented the runtime.

Look at where the notable RPG Maker games ended up:

| Game | Made in | How it reached console |
|---|---|---|
| LISA | RPG Maker VX Ace | rebuilt from scratch in **Unity** (Serenity Forge, 2023) |
| Rakuen | RPG Maker XP | a **bespoke Go runtime** on Ebitengine, written for one game |
| To the Moon | RPG Maker XP | **Unity** builds |
| OneShot | RPG Maker XP | **forked the entire runtime** (mkxp-oneshot, C++/SDL2) |
| Corpse Party | RPG Tsukūru Dante 98 | rebuilt for PSP with 5pb |
| OMORI | RPG Maker MV | contracted out to **MP2 Games**, 18 months after PC |

Not one of them shipped a console build *as an RPG Maker game*. RPG Maker MV
Trinity, the official Switch version, cannot use plugins, cannot import custom
assets, and has no export at all.

**So the failure mode is not "I can't build it." It is "I built it and now I
can't ship it, move it, translate it, or maintain it for six years."**

That reframes what a better tool has to be good at.

---

## 2. What OMORI actually cost

OMORI is the closest thing to a controlled experiment, because its lead
programmer (Archeia) *worked for the company that makes RPG Maker* — and the
stock tools were still not enough.

- Kickstarted April 2014 targeting 2015. **Shipped 25 December 2020** — about
  six years and eight months.
- Started in VX Ace, migrated to MV. The migration broke the plugins and **most
  of the first half of 2017 went to the conversion alone**. VX Ace is Ruby; MV
  is JavaScript. Nothing carried over.
- **The map editor was the first thing thrown out.** Maps are authored in Tiled
  (pinned to version 1.0.3, "anything newer/older might break"). RPG Maker is
  used only to allocate map IDs.
- **The dialogue system was the second.** OMORI does not use Show Text. Text
  lives in YAML files under `www/languages/<lang>/`, addressed by key.
- The UI was replaced wholesale. The asset encryption was replaced (MV's is XOR
  against a key shipped in plaintext).
- The emotion system works by **duplicating every enemy four times in the
  database** — neutral at the base ID, angry at base+1, happy at base+2, sad at
  base+3 — because an RPG Maker battler is one database row with one sprite and
  cannot change appearance mid-battle.
- Its 32×32 art collided with MV hardcoding 48×48 in the scroll path. Players
  reported stuttering "mainly in wide open areas" within a week of release.
- Mid-development, the vendor shipped MV 1.6.0, broke projects, and **un-shipped
  it** — demoting it to beta and reinstating 1.5.2.
- Japanese shipped **12 months** after English. Korean and Chinese, **15 months**.

Fear & Hunger independently invented the same hack as OMORI for a different
goal: to give an enemy targetable limbs, each body part is a separate enemy in
the Troop, hand-aligned in the editor. Two unrelated developers converging on
"multiply database rows to fake sub-entity state" is not two eccentric people.
It is a missing primitive.

---

## 3. The scoreboard

Measured on this machine, in Chromium, with a real requestAnimationFrame loop.

### Where this engine is already ahead

| | This engine | RPG Maker |
|---|---|---|
| **Version control** | one map = 291 readable lines, longest 185 chars, zero single-line blobs | minified JSON, one line per map; git cannot merge non-overlapping edits. Needs a plugin or a git hook to be usable at all |
| **Localization** | built in, extracts any time, keyed on the lines themselves | third-party plugins only, and their own docs say *generate language files only after the game is finished* — changing game data afterwards "can lead to serious errors" |
| **Tile size** | `settings.tileSize`, data-driven | 48×48 hardcoded through the scroll path |
| **Custom data on things** | typed schema fields, declared once, driving widget + validator + save shape | notetags: free text parsed out of description fields |
| **Extending the engine** | module manifests with declared save and content slices, versioned, with migrations | monkey-patching. Plugin-on-plugin overriding. An engine update rewrites your plugins |
| **Authoring on a phone** | Creator Mode, whole project as one file, no server, no account | a Windows desktop application |
| **Runtime size** | an HTML file | 150–400MB of bundled Chromium before a single asset |
| **Custom battles** | a scene draws, gets input, and saves — `js/modules/bullet/` is a working Undertale-style fight | plugins over plugins; OMORI "heavily overrides" the ones it uses |
| **The rules of the world** | a row an author edits: a trigger, a condition, a script — and a story can **eat** one, after which the world plays differently | in the engine, where a game cannot reach them |
| **Going back** | saves are a tree; going back **branches** instead of overwriting, and a line of dialogue can ask what happened in the branch you left | 20 slots, and going back means overwriting the one you came from |

### Where it is at parity

Both are single-threaded JavaScript in a browser engine. Neither will beat a
native engine at raw compute. That is a real ceiling, and it is the same ceiling.

### Measured ceilings

| what | fps |
|---|---|
| 1600 moving, drawn characters | 60 |
| 3000 markers (the bullet-hell substrate) | 60 |
| walking a 64×48 map | 60 |
| 400 characters on a phone viewport | 58.5 |
| darkness + 32 dynamic lights | 60 *(was 56.5)* |
| darkness + 64 lights | 57 *(was 22)* |
| darkness + 128 lights | 32.5 *(was 11)* |

Undertale's densest patterns run to a couple of hundred bullets. This engine
simulates **334 live bullets in 0.5ms of a 16.7ms frame budget**.

Project scale, at OMORI's size (400 maps, 6,000 events, 48,000 dialogue lines):

| | boot |
|---|---|
| a chapter (30 maps) | 0.05s |
| a small game (100 maps) | 0.11s |
| **OMORI-ish (400 maps)** | **0.34s** *(was 2.9s)* |
| bigger than OMORI (1000 maps) | 0.92s *(was 7.4s)* |

Heap at OMORI scale: +224MB.

**Performance is not what would stop you.**

---

## 4. What the gaps actually are

Ordered by what would really block a game of that scope, not by what sounds
impressive.

### Shipping — the one that matters
The research is unambiguous: this is what kills RPG Maker games. This engine is
HTML, so *web* is free and *desktop* is a known path (Electron/Tauri/NW.js).
**Console is not solved, and nothing here pretends it is.** Worth knowing before
you need it, not after.

### An animation format with named clips
OMORI's animation model is "a grid in a PNG, indexed by row and column" — no
timeline, no named clips, no events on frames, and Hardcore Gaming 101 estimates
"well above a hundred frames" per party character. That is why their art
pipeline took years. This engine has an `animations` art table but no clip
format with metadata. Cheap to build, disproportionately valuable.

### Composable entities for battles
The OMORI/Fear & Hunger convergent hack. Worth checking that a battler here can
swap visual state and hold sub-parts without duplicating rows — the modules
layer suggests yes, but it has not been proven the way the bullet-hell was.

### Control remapping
The keymap is data and `KIT.input.bind()` exists; what is missing is the
key-capture screen a player would use. The Game Accessibility Guidelines' Basic
tier opens with "allow controls to be remapped", and Steam Deck's compatibility
review requires the default configuration to reach all content without changing
settings. Z/X/Enter/Space is not remappable for somebody who cannot reach those
keys.

### The engine has never had a game built in it
Every scale number here is synthetic — generated projects, not authored ones.
That is the honest caveat on the whole document, and the only thing that fixes
it is building Elsewhenowhere in it.

### Shaders / WebGL
Canvas 2D only. Everything measured holds 60fps, so this is about *effects that
are impossible*, not speed. Real, but not blocking.

### Richer text effects
Colour, shake, size, speed and wait exist. Wave, per-character timing and
mid-line font swaps do not — and mid-line font swaps are how Undertale gives
Sans and Papyrus their voices.

### Mod loading
Every popular RPG Maker game grew one by hand. OMORI's two community mod loaders
differ by **8× in memory** (200MB vs 1.6GB) for the same mod, because the game
exposed no extension point.

---

## 5. What landed this round

Ordered by how badly it was needed, not by how it sounds.

**Things the platform was quietly taking from a player**

1. **Safari deletes everything a page stored** after seven days without a visit
   — IndexedDB, localStorage, all of it, with no warning and no event to catch.
   A browser game you send to one person to play would forget them over a
   fortnight's holiday. The engine now asks for persistent storage on the first
   gesture and, when the browser refuses, *says so on the save screen* instead of
   letting somebody lose thirty hours.
2. **The iPhone's mute switch killed Web Audio** — and only Web Audio, while
   video kept playing — until iOS 17. One line most engines still don't set.
3. **The tile cache had no ceiling.** Measured on an ordinary dpr-3 phone: one
   room costs 85MB and five rooms reached **258MB, held forever**. OMORI has
   four hundred rooms. Now accounted in bytes and evicted least-recently-used;
   the same walk settles at 122MB.

**Things an Undertale-scope game actually needs**

4. **A scene can draw.** Invisible until a real battle was built against the API.
5. **A scene can draw TEXT** — which is most of what an Undertale battle is.
   Same pipeline as the dialogue box, so `{color:}`, `{fx:wave}` and `{voice:}`
   work in a fight without being rewritten.
6. **A voice is a bundle** — font, colour, pace and blip together, switchable
   mid-sentence with `{voice:sans}`. This is exactly Undertale's typer preset,
   which it has 114 of in a 310-line if-chain.
7. **Named text effects** (`{fx:shiver,3}`) instead of Undertale's single `shake`
   scalar whose meaning changes at 39.
8. **Layered music** — `@layer danger on` swells a part in without restarting
   the piece. **Ducking** under dialogue, counted so overlapping lines behave.
   **File music decoded onto the graph** with real loop points, so an intro plays
   once and the body loops seamlessly.
9. **Localization** that a player can actually reach — a setting, a menu row, and
   a first-boot guess from the browser's own languages. The engine's own menu
   words moved into the Terms table, because a literal is a line nobody can
   translate.
10. **Two fingers undo, three redo** — what Procreate and Nomad Sculpt both
    settled on, and it costs no screen space. Godot's Android editor docs tell
    you to bring a Bluetooth keyboard.
11. **Light got cheap**: 128 lights went 11fps → 32.5, verified pixel-identical.
12. **Boot got 8.5× faster** at OMORI scale. Gamepads. Voice blips.

Every one of items 1, 2, 3, 9 and the double-translation bug below was found by
research or by an audit, not by playing the game — which is the argument for
doing it this way.

**Things a story should be able to do to the world, and could not**

13. **The rules of the world are rows now** — a trigger, a condition, a script
    (ADR-0012). `@rule eat doors-need-keys` and the doors do not need keys, with
    the project untouched and the change in the save. Conflict is stated
    (priority → specificity → recency → id) rather than depending on file order,
    and loops are capped twice because there are two ways round: depth 8 in one
    chain, 512 firings in one drain for a chain that goes back through the event
    queue.
14. **Saves are a tree** (ADR-0013). Going back branches instead of overwriting,
    there is a Moments row in the pause menu, and `elsewhere.killed/dog >= 1` is
    a condition an author can write — the one question no variable can answer,
    because the variable was in the other branch. 409KB for 200 moments against
    6.65MB for a save each.
15. **Six events that went nowhere.** `KIT.events(name)` MAKES a bus — a fresh
    one, no listeners — and `KIT.bus` IS the shared one. Six call sites were
    written `KIT.events('kit').emit(...)`, which builds an empty bus, emits into
    it and drops it. Faults, language changes, editor problems and every line of
    history announced themselves to nobody, and nothing said so, because emitting
    into an empty bus is legal and returns 0. A test now fails if that spelling
    comes back.
17. **"You have been here before" had no way to be said.** `KIT.history.promote`
    is the one function that carries a fact across New Game — the whole of the
    engine's memory of the *player* rather than of the run. It was called by
    nothing. Not a command, not a condition, not a screen. It had a doc comment
    quoting Undertale's True Reset, a unit test, and no way for a story to use
    it: the headline feature, half-built, with a green suite. Now
    `@remember <verb>/<what> ever` says it and `ever.<verb>/<what> >= n` asks it,
    and `test/kit/story-reach.test.js` classifies every function the story layer
    exports as SAID, ASKED, SHOWN or PLUMBING and fails until a new one is
    classified. It also found that carrying over something that never happened
    recorded it as having happened once.
16. **Reachability got its second half.** A setting a player can change had a
    test; a table an author can edit did not — and `rules` was normalized, saved,
    validated and referenced by a command, a condition and a screenplay form,
    with a passing test for each, and no screen. Every table a project carries
    must now name the panel that edits it or the place it is edited instead.

**And three bugs in work from this same session**, found by auditing it:
the language pipeline terminated one line short of the player; every visible
line was translated *twice* (with `'Yes.' → 'Non.'` and `'Non.'` also a source
line, a French player saw the wrong sentence); and the battle's text band was
computed from one font size while the writer drew at another, so a long line
landed on top of the arena.

## 5b. Measured against a plan instead of a product

The other comparison worth making is against a *design document* rather than a
shipped tool — a large, coherent, never-built plan for a 2D RPG engine with five
primitives. A plan has one enormous advantage: nothing in it was shaped by what
was easy to implement. Four things it does that this repo did not, all cheap,
all now here:

- **A thesis**, not a comparison. One sentence naming what the engine IS, so it
  can say what to refuse. See the top of this document's sibling.
- **An interaction matrix.** Every pair of primitives with a stated default. The
  plan's is a table nobody can run; `test/kit/interactions.test.js` is 26 tests.
- **Decisions as artifacts** with what they ruled out — `docs/decisions/`.
- **De-risking before architecting**, with thresholds set first —
  `npm run experiments`. Every other number in this document was measured after
  the thing was built, which makes it a discovery rather than a decision.

The plan merged five pitches, and it is worth listing all five against what is
here rather than only the ones that were missing:

| the plan's pitch | what it means | here |
|---|---|---|
| **LATTICE** | dimensions as real layers, swapping as a verb | ADR-0009 — a layer overrides sparse cells, not whole maps, and `save.dimension` is one global value because a layer of reality is a property of the world and not of a room |
| **PALIMPSEST** | every playthrough remembered; Undertale's "you have been here before" as a primitive | ADR-0008 + ADR-0011 — and the *reach* for it was missing until this round: `promote` existed and nothing called it |
| **LIVEMOD** | rules as in-world objects, Baba Is You scaled to an RPG | ADR-0012 |
| **LOOM** | NPCs keep living between sessions | the clock measures the gap and the world says `sessionResumed`; two modules pay out on it, and a rule can now hang off it with no code at all |
| **FORK** | saves as a branching tree | ADR-0013 |

Three of the plan's primitives that this repo did not have are now here, and
each one's design diverges from the plan's on purpose, in the same direction every
time — because a save here is one JSON document in browser storage rather than a
row in a database, and that one fact changes the right answer three times:

| The plan's primitive | The plan's design | What was built here, and why |
|---|---|---|
| A run that remembers (ADR-0011) | unbounded log in IndexedDB; a Bloom filter in a worker for "ever?"; sqlite-wasm if it does not scale | a permanent tally plus a bounded window. "Ever?" is a map lookup, not a Bloom filter. Exact forever for the questions the tally covers, and it says which those are. |
| Rules as entities (ADR-0012) | TypeScript listener objects — which the plan's own Editor document then contradicts, requiring JSON authoring; its §9 resolves it in favour of the editor | a trigger, an existing `condition` and an existing `script`. The editor widget, validator, text form, reference index and translation extraction were already there, so the resolved design turned out **cheaper**, not more expensive. |
| Time-tree saves (ADR-0013) | branches as a navigable DAG; the plan's own review calls this its thesis | a tree of deltas, anchored on economics rather than a count, with `elsewhere.killed/dog >= 1` as an authorable condition. 409KB for 200 moments; a save per moment would be 6.65MB. |

The third row is the one worth dwelling on, because it is the argument for
building over planning made in a single number. The first design here — a delta
per node with a whole save every twelve — was written, measured, and **failed two
of its own thresholds**. The measurement said exactly why: the whole saves were
592KB of a 1.1MB tree while every delta put together was 119KB. No amount of
review finds that. The plan could not have known it, and neither could I until
the number came back.

### Could a game made in the plan be better than one made in this?

Asked plainly, and worth answering plainly rather than defensively.

**Where a WEFT game would win.** TypeScript across engine, editor and content
means a renamed field breaks the build instead of a playthrough; this repo
catches that with a validator and a test suite, which is later and weaker.
Excalibur.js brings a maintained scene graph, tilemap and collision system with
other people fixing it. A Tauri editor gets real windows, real file dialogs and
a filesystem, where Creator Mode gets one browser tab. Those are genuine
advantages and none of them are stylistic.

**Where this one wins.** It exists. Not as a debating point — as the thing that
decides the outcome. The plan is eighteen months old with zero lines of code, and
its own estimate of shipping engine, editor and a prologue together is 30–35%.
Every number in this document is measured; every number in the plan is estimated,
and the two times a plan-derived design was measured here, it lost to what the
measurement suggested instead.

**So the honest answer:** a WEFT game would be built on firmer foundations and is
much less likely to be built at all. A plan is worth reading for the primitives it
names — three of them are in this repo now and the engine is better for all
three. It is not worth waiting for. The plan's best ideas transferred in a week;
its eighteen months of not shipping did not have to.

---

## 6. What the audit found in its own work

The audit was run twice: once on the engine, then again after a week of fixes.
The second pass found three bugs in the first pass's own output, and one pattern
underneath all of them.

**The pattern.** The same defect had landed three times and the whole test suite
would not have caught any of it:

| The capability | Real and tested | Reachable |
|---|---|---|
| Localization | yes | **no player could select a language** |
| Sound and music volume | yes | **no row in the menu** |
| The git-mergeable format | yes | **no button in the editor** |

Each time, "done" had quietly come to mean *the API exists and a unit test calls
it*. The fix is not three fixes; it is `test/kit/reachable.test.js`, which
asserts that a setting a player is meant to change appears as a **row** — and
which failed to catch the bug in its first version, because it searched the whole
file and the handler in `nudge()` still mentioned the setting. A setting you can
only change if you can see it.

**And the other two.** Every visible line was translated *twice* — with
`'Yes.' → 'Non.'` and `'Non.'` also a source line, a French player saw a sentence
from somewhere else. And the battle's text band was computed from one font size
while the writer drew at another, so on a short window a long line landed on top
of the arena.

None of these were found by playing the game.

## 6. The honest summary

An Undertale-scope game is well within reach today, and the bullet-hell module
is the proof rather than the promise.

An OMORI-scope game is a question about *six years*, not about frame rate. The
things that made OMORI take six years and eight months — the map editor being
unusable, dialogue being unaddressable, plugins breaking on engine updates,
localization being impossible to retrofit, save formats that cannot change —
are the exact things this engine was built to not have.

The gap that remains is the one the research says actually kills these games:
**where it ships**.
