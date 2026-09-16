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

1. **A scene can draw.** This was the decisive gap and it was invisible until a
   real battle was built against the API. Scenes now get `draw(ctx, view)` and
   `opaque`. Without it, an Undertale battle is not possible; with it, it is
   `js/modules/bullet/`.
2. **Localization**, keyed on the lines themselves, extractable at any point,
   with a translation file a person can read. 227 lines found in the demo world
   without anyone listing one.
3. **Layered music.** Named layers on one clock, brought up and down with
   `@layer danger on`. The piece never restarts.
4. **Boot got 8.5× faster** at OMORI scale, by deferring validation off the
   critical path.
5. **Light got cheap.** Culling, half-resolution darkness and cached falloff
   sprites: 128 lights went from 11fps to 32.5, and 32 lights from 56.5 to a
   solid 60. Measured pixel-identical — 2 levels out of 255 at worst.
6. **Gamepads**, and **voices** — per-character blips while text types.

---

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
