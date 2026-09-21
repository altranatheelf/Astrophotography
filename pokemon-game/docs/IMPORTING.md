# Bringing things in from other tools

*Written for the person making a game, not the person building the engine.
`IMPORT-CONTRACT.md` is the shape importers must produce and wins on any
detail of the format; this is how you actually use them.*

You do not have to draw everything here. A map you built in **Tiled**, a whole
**RPG Maker MV** project, a character you animated in **Aseprite** — one command
brings each of them into your game, with the tiles, the images, the people and
the dialogue attached.

Everything here happens from a terminal in the game's folder:

```
node tools/import.js <the file or folder> --into js/content/demo
```

`--into` is where your game's content lives. The demo world is
`js/content/demo`, and that is the default, so you can usually leave it out.

**It is always safe to run twice.** Importing the same file again updates what
changed and leaves everything else exactly as it was. If you are not sure what
something will do, add `--dry-run` and it will tell you without touching a file.

---

## A map from Tiled

### In Tiled

1. Make the map **Orthogonal**, with square tiles the same size as the rest of
   your game (16 × 16 unless you have changed `settings.tileSize`).
2. Name your layers `ground`, `deco` and `above`. Kit draws them in that order:
   `ground` is the floor, `deco` sits on it, `above` is drawn over your head
   (roofs, treetops). If you do not name them, the first three layers are used in
   that order and the import tells you what it guessed.
3. Put your people, doors and signs in an **object layer**. Give each object a
   **Class** (Tiled calls it "Type" in older versions):

   | Class | What it becomes | Properties it reads |
   |---|---|---|
   | `npc` | A person you can talk to | `sprite`, `dialogue`, `behaviour` (`look`, `wander`, `route`, `approach`) |
   | `sign` | Something you can read | `look` (the tile drawn there), `dialogue` |
   | `warp` | A door | `map`, `x`, `y`, `dir` |
   | `item` | A thing lying on the ground | `item`, `count` |
   | `trigger` | Invisible; runs when stepped on | anything — it is all kept |
   | `collision` | Not an object: paints the tile as solid | — |

   An object with no class becomes a `trigger` and keeps its properties, so
   nothing you typed is ever thrown away.
4. Dialogue goes in a `dialogue` (or `text`) property. Plain lines work, and so
   does the full screenplay format:

   ```
   Mom: Good morning!
   Mom: Mind the water.
   ```

5. Tile properties become tile behaviour. On a tile in the tileset, add:
   `solid`, `bush`, `counter`, `ledge` (`down`/`up`/`left`/`right`), `encounter`,
   `warpLook`, `terrainTag`, `animMs`, or `name` (what the tile is called in
   Kit). A collision shape covering the whole tile means solid; a thin strip
   along one edge blocks that edge only. Anything else you invented is kept on
   the tile and shown in the editor.
6. Save as `.tmj` (**File → Save As → JSON map files**) — or keep `.tmx`, both
   are read. Keep the tileset `.tsj`/`.tsx` and the tileset image next to it.

### In the terminal

```
node tools/import.js ~/maps/town.tmj --prefix outside
```

You get: the map, its objects, every tile it uses (backed by the tileset image,
which is copied into `js/content/demo/assets/`), and any terrain sets as
autotile groups.

**A door that leads to another map.** If the `map` property names a map your
game already has (`home`, or `home.tmj`), the door points at it. If it names a
map you have not imported yet, import that one too and the door starts working —
the report will say `leads to missing map` until then, which is a to-do list,
not an error.

**Two maps that share a tileset** import once and share the tiles, as long as
they name the same tileset file.

---

## A whole RPG Maker MV (or MZ) project

Point the importer at the project folder — the one with `data/`, `img/` and
`Game.rpgproject` in it:

```
node tools/import.js ~/RPGMakerGames/MyGame --prefix mv
```

It reads the maps, the events (all their pages, conditions and triggers), the
common events, the switches and variables, the items, the tilesets, the
character sheets and the face sheets, and turns the event commands into Kit
commands one by one.

**What comes across well:** Show Text (with `\V[n]`, `\N[n]`, `\C[n]`, `\I[n]`,
`\.`, `\|` and friends), Show Choices, conditional branches, loops, labels,
variables and switches, self switches, transfers, move routes, balloons,
animations, screen tint and flash and shake, pictures, weather, timers, items,
gold, common event calls, and the page conditions that decide which version of
an event you meet.

**What cannot come across, and what happens instead:**

| In MV | Here |
|---|---|
| Battles, troops, skills, states, enemies, the shop, party members | There is no battle system in Kit. Each command is kept as a comment so you can see what was there, and the report lists them. |
| Plugins and script calls | Arbitrary JavaScript cannot run in Kit's command model. Kept verbatim as a comment. |
| Audio files (`.ogg`/`.m4a`) | The *commands* are imported and name the track, but the sound itself is not copied — the report gives you the list of names to add. |
| Vehicles (boat, ship, airship) | No Kit equivalent. |
| The wall-shadow layer | Kit has no shadow layer. |
| Autotiles | Kit bakes its own autotiles from terrain rules. Each MV autotile becomes one flat tile (its top-left piece), which you can then re-paint or wire into an autotile group. |
| A fourth tile layer | Kit has three (`ground`, `deco`, `above`); MV's layers 3 and 4 are merged into `above`. |

**Tile size.** MV draws 48 × 48 tiles; Kit's default is 16 × 16. The import says
so, and the game scales the imported tiles into your tile size so the map still
looks right. If you would rather change the game to match, pass
`--tile-size 48 --overwrite` (every map you already had will be drawn bigger).

---

## A picture on its own

Most of what turns up online is neither a Tiled map nor an Aseprite export: it
is a PNG. A tileset sheet, or a character's walk cycle in a grid. Drop it in on
its own and Creator Mode asks how it is cut, guesses from the picture's size,
and cuts it.

* **A tileset** — every square becomes a tile, `<sheet>:<n>`, in a palette group
  named after the file. Tile size is guessed (16, then 32, 48…; the project's own
  size wins when it fits); margin and spacing are there for sheets that have
  them. Fully transparent squares are left out, so a sheet with gaps does not
  fill the palette with nothing.
* **A character** — rows are directions, columns are frames. A 3×4 sheet is the
  common shape (RPG Maker and most walk cycles): down, left, right, up. Pick
  another order if the sheet is laid out differently, or one row for a strip
  that only faces down. The result is one sprite, ready for the NPC preset.

The same from the terminal:

```
node tools/import.js forest.png --into games/mill-lane/content --prefix web
node tools/import.js forest.png --tile-size 32 --margin 1 --spacing 1 …
node tools/import.js hero.png --kind sprite --columns 3 --rows 4 --order dlru …
```

(The terminal cannot see pixels, so it keeps every square; leave out the empty
ones in Creator Mode, or delete them from the palette.)

Check the licence of what you download. A fan game is still a game you are
publishing, and "found online" is not a licence.

## Art from Aseprite

There are two ways in, and they give you different things.

### 1. The sheet export — for anything

In Aseprite: **File → Export Sprite Sheet**, tick **JSON Data**, choose
**Hash** or **Array**, and save the `.png` and `.json` next to each other. Then:

```
node tools/import.js ~/art/hero.json                 # a walking character
node tools/import.js ~/art/tiles.json --kind tiles   # map tiles
node tools/import.js ~/art/faces.json --kind faces   # dialogue faces
node tools/import.js ~/art/icons.json --kind icons   # item icons
```

Name your **tags** after the directions and the importer wires the walk cycle up
for you: `walk-down`, `walk-up`, `walk-left`, `walk-right` (also `down`, `up`,
`left`, `right`, `north`/`south`/`east`/`west`, and `_` or a space instead of the
dash). A tag that is not a direction — `blink`, `celebrate` — is kept as a named
animation, but nothing plays those yet.

**Slices** become faces or icons when you name them so (`face-mom`, `icon-berry`).
`--trim` is fine: the trimmed rectangle and where it sat are both kept, so a
trimmed walk cycle does not wobble.

### 2. The `.aseprite` file itself — for small pixel art

```
node tools/import.js ~/art/hero.aseprite
```

This one does not use a PNG at all: the layers are flattened, the colours are
turned into a palette, and you get **native Kit pixel art** — the same kind you
can recolour and edit in Creator Mode. It is meant for small art (up to about
4096 pixels and 60 colours a frame); anything bigger falls back to a PNG, and the
report says so.

Aseprite things Kit has no place for: blend modes other than Normal (layers are
composited as Normal), per-pixel transparency (a pixel is either there or it is
not), tilemap layers, and colour profiles.

---

## The options

| | |
|---|---|
| `--into <folder>` | Where the content lives. Default `js/content/demo`. A folder with no `project.js` in it becomes a brand new project. |
| `--prefix <name>` | Namespaces every id: `--prefix outside` gives `outside:town`, `outside:grass`. Use it so an import can never quietly overwrite something of yours. |
| `--overwrite` | Let the import replace ids that are already in the project. Without it, anything that clashes is kept as it was and listed. |
| `--dry-run` | Say what would happen; write nothing. |
| `--inline` | Put images into the project as `data:` URIs instead of copying files (handy for the single-file build). |
| `--tile-size <n>` | Force the tile size of the tool you are importing from. |
| `--kind <k>` | For an Aseprite sheet: `sprite` (default), `tiles`, `faces`, `icons`. |
| `--quiet` | Only the summary and the things that matter. |

## Reading the report

```
  added      1 map · 3 objects · 5 tiles · 2 images · 1 autotile group
  replaced   —
  kept       1 terrain  (already there; --overwrite replaces)
  unchanged  —
  images     2 files -> js/content/demo/assets

  2 notes about the import:
  warn   flipped-tile: 'outside:wall' is flipped horizontally on 1 cell ...

  1 thing to fix in the project itself:
  ERROR  bad-target: door page 1: leads to missing map 'outside:home'
```

- **added / replaced / kept / unchanged** — what happened to each thing. `kept`
  means an id was already taken by something different and yours was left alone.
- **notes about the import** — what the other tool could do and Kit cannot, or
  something that needed guessing. `warn` deserves a look; `info` is for the
  record.
- **things to fix in the project itself** — the game's own validator. These never
  stop the import; they are the list of what is not finished yet (a door to a map
  you have not imported, a sprite that is not drawn).

## After an import

Open `index.html` and the imported map is in the game. If you made a **new**
project (a folder of your own rather than `js/content/demo`), the importer
prints the four `<script src="...">` lines to add to `index.html` — put them
where the demo's lines are, just before `js/main.js`.

Imported images live in `<your content folder>/assets/`. They are part of the
project: `node tools/build.js` bundles everything into one shareable file, and
`--inline` puts the images in the project file itself if you would rather not
carry a folder around.

## When something goes wrong

- **“is not a Tiled map or tileset, an Aseprite sheet, or an RPG Maker folder”** —
  you pointed at a file the importer does not know. A `.png` on its own is not
  enough; export the data file next to it.
- **“the image ... is not next to the file that names it”** — Tiled and Aseprite
  store image paths relative to the file that mentions them. Keep the map, the
  tileset and the image in one folder, or fix the path in the tool and export
  again.
- **“is already in the project and is different”** — you have imported this
  before and then changed one of them. `--overwrite` takes the new one; without
  it, yours is kept.
- **A map full of grey squares** — the tiles registered but the image did not
  load. Check that `<your content folder>/assets/` sits next to the page, or
  re-run with `--inline`.
- **compressed map data** — Tiled's zlib/gzip/zstd compression is decompressed by
  the importer. If you ever see `compressed-unsupported`, re-save the map from
  Tiled with **CSV** tile layer format and import it again.

## For programmers

The importers themselves are pure: they take parsed data and return a result,
and never touch the disk. `tools/import.js` is the part that reads files, copies
images and writes content. See `docs/IMPORT-CONTRACT.md` for the shape they
return and `docs/KIT-API.md` (`KIT.import`) for the functions.
