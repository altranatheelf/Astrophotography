# Creator Mode — the guide

Creator Mode is the editor that lives inside the game. You are never looking at
a copy of your world: you are standing in it, and every change is in the game
the moment you make it.

If you know RPG Maker MV, you know most of this already — the words are the same
(Event, Event Page, Switch, Variable, Common Event, Move Route, Region, Transfer,
Balloon, Note, Terms). The differences are deliberate: undo goes back forever,
nothing is modal, and it all works with a thumb on a phone.

## Opening and closing it

* **Creator Mode** on the title screen — the map the game starts on, before any
  game is running. Closing it comes back to the title.
* `index.html?edit=1` — straight into Creator Mode, on the map the game starts on.
* In the game: **Escape → Creator Mode** in the pause menu, and it opens on the
  map you are standing on.
* **✕** (top right) closes it and puts you back exactly where you were standing,
  with your edits in place.

Your work saves itself. There is no Save button for the world: every edit goes
into a draft in the browser a moment after you make it (the status bar says
`saving…` then `saved`), and the draft is what loads next time you open the page.
`Ctrl+S` saves right now if you want to be sure. To hand the game to someone
else, run `node tools/build.js` — one `.html` file with everything in it.

## Your own game

The game that opens is a worked example. To start yours, the front page has a
door: **Start your own game**, above Creator Mode on the title screen. It asks
one thing — what you want to begin with — and a name, which is optional because
each starting point has a name of its own.

* **A region to explore** is a town with a house and a lab you can walk into, a
  professor who hands you a first partner, and a route north whose tall grass
  has something living in it. Four maps, joined the two ways this engine joins
  maps: a seamless edge between the town and the route, a warp through each
  door. Every tile of it is ordinary project data — repaint it, rename it,
  delete the half you don't want.
* **A blank map** is one empty outdoor map with your title on it. The Tiles
  panel says what to do first while it is empty.

Either way the example is replaced as one undo step, **↶** (or `Ctrl+Z`) brings it back,
and what you made is what loads from then on. Once there is a game saved on the
device, the door asks before replacing it and names what it would replace; the
first time, it does not. The same list is inside the editor at
**Game › Project › Start a new game**, for when you are already in there.

A module brings its own starting points with it, so this list is whatever is
loaded (`docs/decisions/0015-a-new-game-is-a-blueprint.md`).

## The screen

```
┌──────────────────────────────────────────────┬───────────────────────────┐
│ map ▾   Pencil Fill Rect Erase Pick Stamp    │ Map · Story · Game · Problems │
│         Terrain Move Hand  ↶ ↷ − + ▶ Play ✕  │ Tiles  Events  Map  …     │
├──────────────────────────────────────────────┤                           │
│                                              │  the panel you picked     │
│                 the map                      │                           │
│                                              │                           │
├──────────────────────────────────────────────┴───────────────────────────┤
│ 4, 7 · ground · saved · 2 warnings                                       │
└──────────────────────────────────────────────────────────────────────────┘
```

Every tool has its name under its icon, so nothing has to be guessed at. The
side panel is four groups — **Map** (what is on this map), **Story** (what
happens and who says it), **Game** (the whole project) and **Problems** — and
under the group you picked, a chip for each of its panels. A group with one
panel just opens it. The Problems group shows a count, red when any is an error.

On a phone the panel is a sheet under the map: the tools sit in a row of their
own above it, the groups and chips wrap, and everything is the same, just
stacked. Under **Map** the sheet is short, because the map is what you tap;
under the other groups it takes most of the screen, because a script or a form
is what you read. The **▴ / ▾** grip beside the groups flips it either way.

## Painting

1. Open **Tiles**.
2. Pick what you are painting **on**: Ground, Deco, Above, Terrain, Regions or
   Collision. (Ground is the floor, Deco stands on it, Above is drawn over
   people's heads — treetops, roofs.)
3. Pick a tile from the palette. The brush line at the top always shows what you
   are holding.
4. Draw on the map with the **Pencil**, or:
   * **Fill** — one tap fills everything joined to that square. Hovering shows
     you the area outlined before you commit.
   * **Rectangle** — drag, or tap one corner then the other.
   * **Eraser**, **Pick** (the eyedropper), **Stamp** (a multi-square brush).
   * **Terrain brush** — paint *what the ground is* (grass, water, path) and the
     autotiles draw the edges and corners for you. Set them up under
     *Terrains & autotiles* in the Tiles panel.
5. Anything you paint is one undo step per stroke: **↶** or `Ctrl+Z`.
6. **Collision** is where walls, fences and **tall grass** live: paint *Tall
   grass — wild encounters* over any squares, from any tileset, and a step there
   can roll the map's encounter table (**Map › Encounters**). Turn on the
   Collision view to see what you have painted.

Handy: hold **Shift** with the Pencil to draw a straight line from the last
square you painted; hold **Alt** to pick the tile under the pointer.

## Placing an Event

An Event is a person, a sign, a door, an item on the ground, a trigger — anything
the player can bump into.

1. Open **Events** → **＋ Add**.
2. Pick a ready-made one (NPC, Sign, Door, Item, Transfer pair) or a plain type.
3. A preset asks you for what it needs first — a name, a line, where the door
   goes — then **✛ Place it on the map** and you tap the square.
4. The new Event opens in the inspector: Name, Type, Position, Note, its **Event
   Pages**, how it looks, what it does by itself (stand, wander, a Move Route),
   and **What happens** — the six script slots (On Interact, On Step, On Touch,
   On Enter, Every Tick, On Init).

To move an Event later: the **Select / Move** tool (✥). Tap it, then tap where it
should go — or drag it. To delete: select it and press Delete, or 🗑 in the
inspector.

**Event Pages** work like MV's: each page has a condition, and the *last* page
whose condition passes is the one that runs. The panel shows you which page
would run right now.

## Writing a line

1. Select the Event, scroll to **What happens**, and tap **Open ✎** on *On
   Interact*. That opens the **Script** panel.
2. The script has two views:
   * **Cards** — one card per command, with its fields inline. ＋ adds a command
     after the one you tapped; ▲▼ move it; ⧉ copies; the switch turns it off
     without deleting it.
   * **Text** — the same script as screenplay:

     ```
     Rosie: Welcome to the festival! {pause} Try the stall by the gate.
     ? Do you want to help?
     - Yes
         @set friendship += 1
         Rosie: Wonderful.
     - Not now
         Rosie: Another time, then.
     ```

     Anything it cannot read stays on the page as a raw line, marked amber —
     nothing is ever thrown away. Switching back to Cards (or **Apply**) reads
     it in as one undo step.

Write wherever you like; they are the same script underneath.

## Testing it

**▶ Play here** (or `F5`) starts the real game standing on the square under the
cursor, with the switches and items you had when you opened Creator Mode — so
you can test the middle of chapter three without playing the first two.

Press **Escape**, or **‹ Back to Creator Mode**, to come back to exactly the same
place in the editor.

## Where everything is

| Group · Panel | What it is for |
|---|---|
| **Map · Tiles** | The layer you are painting, the palette, stamps, terrains and autotiles, and what the map shows (grid, collision, regions, names) |
| **Map · Events** | Every Event on this map, and the inspector for the selected one |
| **Story · Script** | The script editor — cards or screenplay — for the slot or Common Event you opened |
| **Story · Common Events** | Scripts any Event can call: an intro, a shop, a cutscene |
| **Story · Fragments** | The notebook: lines and scenes you have not placed yet. “Use this” turns one into a Common Event or drops it into the script you have open |
| **Story · Dialogue** | Every piece of text in the game in one table, for a read-through and a word count |
| **Map · Map** | This map's name, kind, size, music and note; where the game starts; the doors to the maps next door; and every map in the world |
| **Game · Project** | Title, subtitle, pitch, the heroes, where the game starts, the settings, the modules — and moving the game to your other device |
| **Story · Rules** | Rules of the world: when something happens (a step, a bump, an item changing), what must be true, and what to do. A rule can be switched off, rewritten, or eaten by the player with `@rule eat <id>` — and after that the game plays differently |
| **Story · Cast** | Everybody in the story: what they know and who told them, how they feel about each other, and — the other way round — every fact and who has heard it. **＋ New person** and **＋ New fact** add to it; each one opens as a form |
| **Game · Variables** | Switches and Variables: declare them, see every read and every write |
| **Game · Items** | What Events give and conditions ask about |
| **Game · Species** | Everybody who can be met, caught and walked with (the Pokémon-style module). The ones that came with the engine are a worked example: **✎ Make it mine** copies one in so you can restat or rename it, **＋ New species** invents one. A species of yours with a built-in id wins |
| **Game · Terms** | The words the engine says (“Yes”, “Got {item}!”) when you want different ones |
| **Problems · Problems** | What the validator noticed, in plain English. It is a to-do list, never a gate — you can always play |
| **Game · Data** | The raw JSON of whatever is selected, for when you want to edit by hand |
| **Game · Import** | A Tiled map, an RPG Maker MV/MZ folder, Aseprite art, a Pokémon Essentials PBS file, a PNG on its own (cut into tiles or a walking character), or music and sound effects — dropped in (`docs/IMPORTING.md`) |

Modules add their panels to the same groups: with the Pokémon-style module on,
**Map · Encounters** is there too, and the Home module puts its jobs, furniture
and presents under **Game · Home & jobs**. An Event's **Id** is shown
but not editable in the form — it is the name every script uses to find the
Event, and renaming happens through the Events list, which rewrites every
reference for you.

## Working on your phone and on your computer

Both. Creator Mode is the same editor either way, and every panel is thumb-sized.

What it cannot do by itself is be in two places at once: each browser keeps its
own draft, in its own storage, so work done on the phone stays on the phone until
you move it. **Project › This game, on your other device** is how:

* **↓ Save a copy** writes the whole game — maps, people, scripts, art — as one
  `<name>.kitgame.json`. Send it to yourself however you already send things.
* **Copy** puts the same thing on the clipboard, which on a phone is two taps
  instead of a trip through the Files app.
* **Choose File**, or the paste box, opens one. It checks the file first: a file
  that is not a game says so and changes nothing.
* **↓ Save as files (for git)** writes the same game the way version control
  wants it — one file per map, sorted keys. Chrome and Edge on a computer ask
  you for a folder and write straight into it; everywhere else, phones included,
  you get one `<name>-files.zip` with the same files inside, to unzip into the
  game folder yourself. This is how work done in Creator Mode gets back into a
  game folder's `content/`.

Opening a game REPLACES the one you are editing, as one undo step — **↶** (or `Ctrl+Z`)
puts it back, and the one you replaced is still in the file you saved.

No server, no account, and nothing goes through anybody else's computer. Your
game is a file you own, the way a document is.

## Keys

| | |
|---|---|
| `1`–`9` | The tools, in toolbar order |
| `[` `]` | Previous / next layer |
| `g` `c` `r` `t` | Show grid / collision / regions / terrain |
| `Ctrl+Z`, `Ctrl+Shift+Z` | Undo, redo (no limit) |
| `Ctrl+S` | Save the draft now |
| `F5` | Play here · `Escape` comes back |
| `Escape` | Drop the selection |
| `Delete` | Delete the selected Event |
| Space-drag, middle-drag, ✋ | Move the map · wheel or − + to zoom |

## If something looks wrong

* **The Problems panel** explains each one in a sentence and jumps you to the
  thing it is about. The count on the Problems group is the same list.
* **A person you placed is not on the map** in play: an NPC page with no sprite
  draws nothing. Problems says so (*has no sprite, so nothing is drawn*); the
  NPC preset starts with one now, so this only happens to a page you cleared.
* **Undo** goes back as far as you like, including inspector fields, deletes and
  imports.
* Nothing you do in Creator Mode can break a save: saves hold your progress, the
  project holds the world.
