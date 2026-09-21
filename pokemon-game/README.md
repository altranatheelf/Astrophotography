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
open index.html?edit=1          # straight into Creator Mode (or pick it on the title screen)
npm test                        # 580 unit tests, pure Node, no browser
node tools/build-demo.js        # regenerate the demo world content
node tools/import.js <file>     # bring in a Tiled map, an RPG Maker project or Aseprite art
node tools/build.js             # bundle everything into one shareable .html
```

Play-throughs in a real browser (they need Playwright):

```
NODE_PATH=$(npm root -g) node e2e/walk.js     # title -> walk -> talk -> save -> co-op
NODE_PATH=$(npm root -g) node e2e/import.js   # import a map, then play it
NODE_PATH=$(npm root -g) node e2e/editor.js   # paint -> place an event -> write a line -> play it
NODE_PATH=$(npm root -g) node e2e/vision.js   # the whole thing: new game -> catch -> garden -> jobs -> decorate -> reload
```

## What is here

| | |
|---|---|
| `docs/DESIGN.md` | Why the engine is shaped this way, and how future ideas plug in |
| `docs/ARCHITECTURE.md` | The build contract: data model, commands, editor, phases |
| `docs/KIT-API.md` | Every public function, with signatures |
| `docs/CREATOR-MODE.md` | **The author's guide**: paint, place an Event, write a line, test it |
| `docs/EDITOR-CONTRACT.md` | How Creator Mode is put together: the shell, panels, tools |
| `docs/IMPORTING.md` | Bringing maps and art in from Tiled, RPG Maker MV and Aseprite |
| `docs/IMPORT-CONTRACT.md` | The shape every importer returns |
| `docs/MODULES.md` | **How to write a module**, and the ones that ship with the engine |
| `docs/STARTING-A-GAME.md` | The author's guide to starting a game of your own |
| `docs/ENGINE-HOOKS.md` | The punch list: everything a module had to work around, and the fix |
| `js/kit/` | The engine: core, world, script, systems, render, scenes, game |
| `js/kit/editor/` | Creator Mode: the shell (`editor.js`), the edits (`ops.js`), the map tools (`tools.js`), the form builder (`inspector.js`), the panels (`panels-map/-objects/-writing/-project.js`, `script-editor.js`) and the joins (`integration.js`) |
| `js/kit/import/` | Importers: Tiled, RPG Maker MV/MZ, Aseprite, and the merge into a project |
| `js/art/` | Pixel art: ~80 map tiles, characters (some real, some generated placeholders) |
| `js/data/`, `js/sprites/` | The 32-Pokémon data pack and portraits (for the Pokémon module) |
| `js/modules/mons/` | **Pokémon**: catching, the Pokédex, the garden, a follower, friendship |
| `js/modules/home/` | **Home**: decorating a room, jobs your friends run, moods, little presents |
| `js/modules/dungeon/` | **Dungeon**: keys and locked doors, pushable blocks, plates and gates, the dark |
| `js/content/demo/` | The demo world — ordinary content, made to be replaced |
| `templates/` | The shape a new game starts from, and the files every game gets |
| `tools/` | Sprite/tile renderers, the demo builder, the importer CLI, the bundler, `new-game`, `new-module`, `pack-kit` |
| `test/`, `e2e/` | Node tests (`test/kit/`, `test/modules/`) and browser play-throughs |

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

**The engine is finished and the first three modules are on top of it.**

Done and tested: the core (registries, schema, patch document, deterministic
randomness), the project format with migrations, autotiles, the full command
set, conditions, the Screenplay text format, the interpreter with threads and
breakpoints, the map view, entities and movement, the world runtime with event
pages and slots, the standard systems, the editor operations, the demo world,
and the importers — a Tiled map, an RPG Maker MV/MZ project or Aseprite art
becomes playable content with one command (`docs/IMPORTING.md`).

Also done: the browser layer (renderer, scenes, input, audio, storage, game
boot) and Creator Mode — sixteen panels in four groups and nine named map tools
around one document, opened from the title screen, `?edit=1` or the pause menu
(`docs/CREATOR-MODE.md`). `e2e/editor.js` plays the whole loop through a real
browser at phone and laptop size, and photographs every panel at both.

Also done: **three modules**, none of which touches `js/kit/`.
`mons` is the Pokémon half — befriending instead of fighting, the Pokédex, the
garden, a follower who walks behind you, and friendship that grows as you walk
together. `home` is what there is to do afterwards — a room you decorate, a job
board your friends go out on while the clock runs, moods, and the odd present
left at the door. `dungeon` is a whole genre as an add-on: keys, locked doors,
pushable blocks, switch-and-gate puzzles, one-way ledges and a lantern in the
dark. The demo enables `mons` and `home`; the dungeon template enables
`dungeon`. `docs/MODULES.md` has the table and how to write a fourth.

Also done: **starting a game of your own.** `tools/new-game.js` writes a whole
playable game folder from the template, `tools/new-module.js`
scaffolds a working module, and `tools/pack-kit.js` takes the engine out as a
library with a version stamp and a manifest (`docs/STARTING-A-GAME.md`).

`e2e/vision.js` is the proof that it all holds together: one browser run that
starts a new game, plays the intro, takes Mom's parcel, chooses a partner at the
lab, walks Route 1, befriends somebody in the tall grass, watches them follow,
visits the garden, pets and feeds them, sends them out on a job, lets the clock
run, welcomes them home with the reward, decorates a room, saves, reloads and
finds the friend, the job history and the furniture all still there — and then
switches **both modules off** and plays the same demo again.

Next: `docs/ENGINE-HOOKS.md` — seventeen places a module had to work around
something the engine does not offer yet. None of them is broken today; each one
would delete a paragraph of apology from a module.

## A note on names and art

This is a personal, non-commercial project. Pokémon and the Pokémon names are
trademarks of Nintendo / Creatures Inc. / GAME FREAK Inc. All art here is
original, and most character art is a generated placeholder until it is drawn.

---

# Starting a new game with this engine

The engine in `js/kit/` is not this game. It is a kit, and the point of a kit is
that you can start something else with it tomorrow. One command does that.

```
node tools/new-game.js "Mill Lane"
```

That writes `games/mill-lane/` — its own `index.html`, its own content files,
its own art folder, its own look, a README and four little scripts. Double-click
the `index.html` and it plays: no server, no install, no build step, straight
from `file://`. Run it twice with the same name and it politely refuses rather
than write over your afternoon.

```
cd games/mill-lane
npm start          open it
npm run edit       open it in Creator Mode
npm run build      story.js  ->  content/
npm run share      the whole game as ONE .html file you can send to somebody
```

The full walk-through, written for a writer rather than a programmer, is
**[docs/STARTING-A-GAME.md](docs/STARTING-A-GAME.md)**.

## One template, and it is empty

```
node tools/new-game.js "The Deep" --modules dungeon
```

A new game is one room, one person to be, and nothing else. No sample village,
no demo dungeon, no little story to delete before you can start — the first
thing in the game should be yours.

What you get instead is `story.js`: that one room written out as plain data with
a comment on every field, so the shortest description of the project format is
also the file you edit. `npm run build` turns it into the game's content;
Creator Mode edits the same world in the browser, and **Save as files (for git)** writes the same `content/` files.

Genres arrive as **modules**, not as templates. `--modules dungeon` adds keys,
locked doors, pushable blocks, one-way ledges and a lantern you carry — a whole
genre, with the engine untouched. The module's folder is copied into your game,
so it is yours to open and change. `node tools/new-module.js` writes another.

## Adding a system of your own

```
node tools/new-module.js weather --label "Weather" --describe "Rain, and what it does to everybody"
```

Scaffolds `js/modules/weather/` per [docs/MODULES.md](docs/MODULES.md): a
manifest with a save section and a content slice, one command, one condition,
one system, one menu entry, one Creator Mode panel, a README and a test — all of
it working, all of it obviously replaceable. Its test passes the moment it is
written. `--into games/mill-lane` puts it in a game instead of in this repo.

## Taking the engine out

```
node tools/pack-kit.js --out ~/kit-2026-09
node ~/kit-2026-09/tools/new-game.js "Next Thing" --kit ~/kit-2026-09 --into ~/games
```

`pack-kit` copies the engine, the art, the stylesheets, the templates, the
modules those templates use, the tools and the docs into a self-contained folder
with a version stamp and a manifest of every file in it. It is checked before it
is written: if a single packed file still reaches into a game's own `js/content`
or `js/modules`, the pack is refused. That check is a test
(`test/kit/templates.test.js`), because "the engine is a library" is a claim that
has to keep being true.

A game built against a packed kit keeps its own `content/`, `art/` and
`modules/` and loads the engine from wherever that folder is; `--copy-kit` puts
a copy inside the game so the folder needs nothing else at all.

| | |
|---|---|
| `tools/new-game.js` | a whole playable game folder, from a template |
| `tools/new-module.js` | a working module, scaffolded |
| `tools/pack-kit.js` | the engine as a library, with a manifest |
| `templates/` | the starting shape, and `_shared/` (the page, the three scripts every game gets) |
| `docs/STARTING-A-GAME.md` | the author's guide to all of it |
