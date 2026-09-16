# Starting a game

For the person writing the game. You need a terminal for about four commands;
everything after that is a text editor and a browser.

---

## 1. Make one

```
node tools/new-game.js "Mill Lane"
```

That writes `games/mill-lane/` — a whole game, finished enough to play. Open
`games/mill-lane/index.html` in a browser (double-click it) and it runs. No
server, no install, no build.

Arrow keys or WASD to walk. **Z** to talk and to choose. **X** to go back.
**Enter** for the menu. On a phone the pads are on the screen.

```
cd games/mill-lane
npm start          open it
npm run edit       open it in Creator Mode
npm run build      story.js  ->  content/
npm run share      the whole game as one .html file
```

---

## 2. What you start from

One template, and it is empty:

| `--template` | what you get |
|---|---|
| **empty** (the default) | One room, one person to be, and nothing else. |

That is deliberate. A kit that hands you a finished little village hands you
somebody else's idea, and most of the work after that is deleting it. You get a
room and the tools; the first thing in the game should be yours.

What the room is made of — the map, the hero, the terrain — is spelled out in
`story.js` with a comment on every field, so it doubles as the shortest possible
description of the project format.

Other useful flags:

```
--into <folder>    where to put it        (default: ./games)
--modules a,b      switch extra modules on (see §5 — mons, home, dungeon)
--kit <folder>     use a packed kit instead of this repo   (see §7)
--copy-kit         copy the engine into the game folder, so it needs nothing else
```

`--modules` copies each module's folder into the game (it is your copy now),
puts its `<script>` lines on the page in the right place, and lists it in the
project — so `node tools/new-game.js "The Deep" --modules dungeon` gives you the
empty room plus keys, locked doors, blocks you shove about and a lantern you
carry. It is your copy of the module, so you can open it and change it.

Running it twice with the same name **refuses** and tells you what to do instead.
It will never write over an afternoon of work.

---

## 3. What is in the folder

```
mill-lane/
  index.html      the page. It lists every file the game loads, in order.
  story.js        YOUR WHOLE WORLD, in one readable file. Start here.
  look.css        your colours and your type.
  content/        what `npm run build` writes from story.js. Do not hand-edit.
    project.js      everybody, everything, every line of dialogue
    maps/*.js       one file per map
  art/            the pictures this game adds to the ones the Kit ships.
  modules/        extra systems this game uses (if any).
  tools/          build-content, share, open, kit-node. Four little scripts.
  README.md       what this template is showing you, and what to change first.
```

The only two files you will spend real time in are **story.js** and **look.css**.

---

## 4. Two ways to work. Both edit the same world.

**In the file.** Open `story.js`. Everything anybody says is in there, written
the way a script is written:

```js
'Gran: There you are, {p1}. {pause} Sleep well?',
'? Want to come?',
'- Yes',
'    Pip: {pause} I had better not. Mum said.',
'    @set friendship += 1',
'- Not this time',
'    Pip: Suit yourself!',
```

Change a line, then:

```
npm run build
```

and refresh the page. If the world is broken the build says where and writes
nothing, so you can never half-save a game.

**In the game.** Open it and choose **Create** in the pause menu (or add
`?edit=1` to the address). That is Creator Mode: paint maps with a pencil, drop
people on them, write their scripts, rename every word the game says, play from
the square under your finger and come straight back. It saves as you go, and its
**Export** writes `content/` back out.

> Use whichever suits the afternoon. The one rule: do not run `npm run build`
> while Creator Mode has changes you have not exported, or the build will write
> over them.

---

## 5. Add a system of your own: a module

A module is how you add something the engine has never heard of — jobs, weather,
cooking, a card game — without editing the engine. It is a folder with rules in
it, and a game turns it on in one line.

```
node tools/new-module.js weather --label "Weather" --describe "Rain, and what it does to everybody"
```

That writes a module that **already works**: a save section of its own, a slice
of the project to keep its numbers in, one script command, one condition, one
thing that happens every tick, a menu entry, a panel in Creator Mode, a README
and a test. Run the test and it passes.

Then delete the example rule and write yours. `js/modules/<id>/README.md` says
what to delete first, and `docs/MODULES.md` is the whole contract.

To put one straight into a game:

```
node tools/new-module.js weather --into games/mill-lane
```

and add its four `<script src="modules/weather/…">` lines to that game's
`index.html`, above `js/main.js`. Then tick it on in the **Project** panel of
Creator Mode (or add `"weather"` to `modules` in `story.js`).

The **dungeon** template is a worked example of a real one: keys, doors,
pushable blocks, plates, gates and a lantern, all in `modules/dungeon/`, with the
engine untouched.

Three modules ship with the engine, and `docs/MODULES.md` has the table:

| | |
|---|---|
| **mons** | Befriending instead of fighting: an encounter in the tall grass, catching, a Pokédex, a garden, a follower who walks behind you. |
| **home** | What there is to do afterwards: a room you decorate, a job board your friends go out on while the clock runs, moods, small presents. |
| **dungeon** | Room to room in the dark: keys, locked doors, pushable blocks, plates and gates, one-way ledges, a lantern. |

`mons` and `home` are what the demo in this repo turns on; `dungeon` is what the
dungeon template turns on. They are all ordinary modules — you can switch any of
them on in a game of yours with `--modules mons,home`, or off in the **Project**
panel, and the game keeps playing either way.

One warning worth knowing: a module's `<script>` tags must come **before**
`js/main.js`, not after. `new-game.js` writes them that way; if you add one by
hand, keep it above that line. (`docs/ENGINE-HOOKS.md` §9 says why.)

---

## 6. Bring in art and maps from elsewhere

You do not have to draw anything. Missing art is drawn as a coloured silhouette,
so a half-finished game still plays. But if you already have pictures:

```
node tools/import.js ~/sheets/hero.aseprite --kind sprite     an Aseprite file
node tools/import.js ~/sheets/hero.json     --kind sprite     an Aseprite --sheet export
node tools/import.js ~/sheets/town.json     --kind tiles      a sheet of tiles
node tools/import.js ~/tiled/town.tmj                         a Tiled map
node tools/import.js ~/tiled/outside.tsj --prefix outside     a Tiled tileset on its own
node tools/import.js ~/RPGMakerProjects/MyGame                a whole RPG Maker MV/MZ project
```

Add `--into games/mill-lane/content` to put it in a game you made (without it,
things land in this repo's own demo).

What happens: the pictures are copied next to your content as
`content/assets/<name>.png`, the maps and tilesets become Kit maps and tiles,
RPG Maker events become Kit events with their scripts translated, and the whole
lot is written into `content/`. It is **safe to run twice** — ids come from the
file, so a second run updates rather than duplicates, and re-importing something
unchanged writes nothing.

Use `--dry-run` first if you want to see what it would do. `--prefix outside`
namespaces everything it makes (`outside:grass`), which is what you want when
you are pulling several sets in.

Two things worth knowing:

- The importer checks the whole project afterwards, and it does **not** load your
  game's own `art/` files — so it may report `unknown-tile: 'my-rug'` for a tile
  you drew yourself. The files are still written and the game is fine; the check
  that knows about your art is `npm run build` inside the game.
- Pictures land in `content/assets/` and are recorded in `content/assets.js`,
  which every new game already lists in its `index.html`. Nothing to add.

You can also do it without a terminal: open Creator Mode and drop the files on
the **Import** panel.

The long version, with what survives the trip and what does not, is
`docs/IMPORTING.md`.

---

## 7. Send it to somebody

```
cd games/mill-lane
npm run share
```

That squashes the page, the engine, the art and the whole world into **one
`.html` file** next to `index.html`. AirDrop it, e-mail it, put it on a stick.
The person you send it to double-clicks it. It needs no internet, no install and
no folder — it is one file and it plays.

---

## 8. Take the engine with you

The engine is a library, not part of any one game. To lift it out:

```
node tools/pack-kit.js --out ~/kit-2026-09
```

That writes a folder with the engine, the art, the stylesheets, the templates,
the modules those templates use, the tools and the docs — and nothing of
anybody's story in it. It carries a version stamp and a list of every file it
contains, and it refuses to be written if a single file in it still reaches back
into a game's own folders.

Then, from anywhere:

```
node ~/kit-2026-09/tools/new-game.js "Next Thing" --kit ~/kit-2026-09 --into ~/games
```

Keep one packed kit per finished game and that game will still build in five
years, whatever happens to the engine afterwards.

---

## 9. When something goes wrong

| what you see | what it is |
|---|---|
| A red bar across the top of the page | A module asked for another module that is not loaded, or failed to start. The bar says which. |
| `npm run build` prints `ERROR [something]` and writes nothing | The world is not valid yet — a door leading to a map that does not exist, a tile id with a typo. The message says the map, the event and the page. |
| The game opens but everything is a coloured blob | The art files did not load. Check the `<script src="art/…">` lines in `index.html`. |
| A square where a picture should be | That art id does not exist. It is not an error; the game keeps playing. |
| Creator Mode's **Problems** panel has a list in it | The same checks the build runs, live. Tap one to be taken to it. |

Nothing in the Kit ever fails silently: if it cannot do something it says so once
and keeps going.

---

## Where to read next

| | |
|---|---|
| the game's own `README.md` | what that template is showing you, and what to change first |
| `docs/CREATOR-MODE.md` | the editor, panel by panel |
| `docs/MODULES.md` | the module contract, in two pages |
| `docs/IMPORTING.md` | Tiled, RPG Maker and Aseprite in detail |
| `docs/KIT-API.md` | everything the engine can do, for when you want to know |
