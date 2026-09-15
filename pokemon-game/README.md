# Kit — a story-adventure engine with a creator mode

A top-down, GBA-style adventure engine built to be **yours**: you make the maps,
the people, the dialogue and the story inside the game itself, and everything
else is a module that can be added without touching the engine.

It is plain HTML, CSS and JavaScript. No install, no build step, no framework.
Open the page and it runs; open Creator Mode and you can change the world you
are standing in.

## Run it

```
open index.html                 # the game (any modern browser, also from a file)
open index.html?edit=1          # straight into Creator Mode
npm test                        # 99 unit tests, pure Node, no browser
node tools/build-demo.js        # regenerate the demo world content
node tools/build.js             # bundle everything into one shareable .html
```

## What is here

| | |
|---|---|
| `docs/DESIGN.md` | Why the engine is shaped this way, and how future ideas plug in |
| `docs/ARCHITECTURE.md` | The build contract: data model, commands, editor, phases |
| `docs/KIT-API.md` | Every public function, with signatures |
| `js/kit/` | The engine: core, world, script, systems, render, scenes, editor |
| `js/art/` | Pixel art: ~80 map tiles, characters (some real, some generated placeholders) |
| `js/data/`, `js/sprites/` | The 32-Pokémon data pack and portraits (for the Pokémon module) |
| `js/content/demo/` | The demo world — ordinary content, made to be replaced |
| `tools/` | Sprite/tile renderers, the demo builder, the single-file bundler |
| `test/`, `e2e/` | Node tests and browser play-throughs |

## The ideas the engine is built on

- **Three layers that only point down.** `kit → modules → content`. The engine
  knows nothing about Pokémon; the Pokémon part is a module; your story is data.
- **Registries with schemas.** Tiles, commands, object types, conditions, menus,
  editor panels: each is a registered definition whose fields are declared once.
  From that one declaration you get the editor form, validation, "where is this
  used", and the save shape. Adding a command means adding one registration.
- **Every edit is a patch.** Creator Mode never writes to the project directly;
  it applies operations with inverses through one document. Undo, redo, autosave
  and live re-render therefore work everywhere, in every panel, forever.
- **Saves hold state, never content.** Rewrite the town and an old save still
  loads. Numbered migrations handle real format changes.
- **The simulation is headless.** Movement, scripts, conditions and story
  branches run in Node with fake input and output, so they are tested properly.
- **RPG Maker's vocabulary.** Events with pages, self state, common events,
  switches and variables, move routes, balloons — with the things MV gets wrong
  fixed: unlimited undo, named self state, conditions that nest, dialogue that
  wraps and paginates, find-usages that knows reads from writes.

## Writing dialogue

Scripts are command lists, but you never have to think in JSON. Every script has
a plain-text view that round-trips losslessly:

```
Mom: Good morning, {p1}! {pause} You and {p2} slept late again.
? Ready to go?
- Yes
    @give item=pokeball count=5 notify=true
    @set chapter = 1
- Not yet
    Mom: Take your time.
@if when: chapter >= 1
    Mom: The Professor is waiting.
@end
```

Write it here, in the editor, or hand it to Claude — it is the same thing
underneath.

## Where it stands

Done and tested: the core (registries, schema, patch document, deterministic
randomness), the project format with migrations, autotiles, the full command
set, conditions, the Screenplay text format, the interpreter with threads and
breakpoints, the map view, entities and movement, the world runtime with event
pages and slots, the standard systems, the editor operations, and the demo
world.

In progress: the browser layer (renderer, scenes, input, audio, storage, game
boot) and Creator Mode's panels. After that: the Pokémon module (catching,
Pokédex, the garden, followers) and whatever you want next.

## A note on names and art

This is a personal, non-commercial project. Pokémon and the Pokémon names are
trademarks of Nintendo / Creatures Inc. / GAME FREAK Inc. All art here is
original, and most character art is a generated placeholder until it is drawn.
