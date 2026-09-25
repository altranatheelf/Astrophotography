# Looks — how your game looks and sounds

This document is for the person making the game: what the **Look** group in
Creator Mode does, what every control in it means, and how to get the three
looks people ask for most. It is written for a phone, because that is where
you will do it. Where this page and the game disagree, the game wins and this
page is wrong — say so and it gets fixed.

A **look** is a set of choices about everything round the game that is not
the map: the message box people talk in, the answers to a question, the
cursor, the pause menu, the little note that pops up ("Saved."), the buttons
on a phone's screen, and the sounds all of these make. Your game starts from
one of four looks, and anything you change is kept on top of it. Nothing is
drawn: a look is colours, shapes, letters and the game's own sounds, so it
works offline and costs your game almost nothing to carry.

## Opening it

* From the title screen: **Creator Mode**, then the **Look** group (the middle
  one of Map · Story · **Look** · Game · Problems).
* During a game: **☰ › Creator Mode**, then **Look**.

The top half of the screen becomes a **live preview** of your game — the room
you were editing behind it, and somebody talking over it. The bottom half is
the list of settings. Every change shows in the preview straight away, while
your finger is still on it. Change a colour the preview is not showing (the
chosen line in a menu while somebody is talking, say, or the OK button of the
box that asks for a name) and it turns to a screen where that colour is.

## The preview

The row of tabs above it says what it shows:

| Tab | Shows |
|---|---|
| **Talk** | Somebody from your game talking, typing and blipping the way the game will. It uses the first line in your game that somebody says (one with a portrait, if there is one). When no line in your game has a portrait, one of your game's portraits stands in (or a plain face shape, if the game has none), so you can see what the portrait settings do. |
| **Choice** | A question — "Ready?" — with Yes and No. |
| **Menu** | The pause menu that ☰ opens, with the entries your game really has. The whole of it is shown, made smaller when it has a lot of lines, so the last line and the help line under it are always in sight. |
| **Title** | The title screen, as a player sees it — made smaller when the preview is too short for all of it, so the help line at the bottom is always in sight. |
| **Toast** | A "Saved." note and a chapter card. With the note in the **Middle**, the card's words move to the top so you can read both. |
| **Pad** | The on-screen buttons a phone plays with, under somebody talking. The screen is short here, so a portrait **above** the box is left out on this tab. |
| **▶ Try** | Hands the preview to you as a player: tap to turn the page, pick an answer, walk down the menu. Tap **✎ Edit** to stop. |

In the ordinary mode (not Try), **tapping a part of the preview opens its
settings** and outlines it: tap the message box and *Message box* opens; tap a
portrait and it opens at *Portrait*; tap the menu and *Pause menu* opens; tap
the "Saved." note and *Toast* opens. The title screen and the chapter card
open *Colours*, scrolled to the colour of what you tapped: the game's name, a
button, the chapter title — and, anywhere else on them, their background.

Tapping a tab you are already on plays it again from the start.

The **▴** at the end of the group row makes the settings sheet taller, for
when you want to see more of them at once. The preview keeps enough room for
the whole message box, so you can still watch what you change. **▾** puts it
back.

On a computer there is one more chip, **Phone | Fill**: the preview is a
phone's width, or fills the space. The talk starts again when you switch, so
the lines break where they would on that width.

**Undo** is the same as on the map: ↶ at the top, or tap the preview with
**two fingers**. Three fingers is redo. Every change is **one** undo step,
however you made it: dragging across the colour picker, or tapping − three
times quickly, comes back in one go.

## Start from

Four cards, each drawn as a tiny message box in its own look, so you can see
the difference before you tap:

* **Kit** — the engine's own: a white box with a dark border and round
  corners, a blue accent, a ▶ cursor.
* **Handheld** — a white box with a soft shadow under the letters, two lines
  at a time, no names or portraits in the box, the pause menu down the right
  in capitals, silent typing.
* **Soul** — a black box with a square white border, monospace letters, a red
  heart for a cursor, a blip on every letter, `* ` at the start of each line
  and no ▼.
* **Dream** — a black box with a thin white border, the speaker's name on a
  tab in capitals, a framed portrait above the box, a blinking ▼, and a white
  bar with a black ☞ for the chosen answer.

The look in use has a ✓ and a blue edge, and its description is under the
cards. Tap another card to start from it. If you have changed things
yourself, it asks first:

* **Keep my changes** puts your changes on top of the new look.
* **Start clean** gives you the new look exactly as it comes.

Either way it is one undo step, so you can always go back.

## Colours

Each colour is a little square you tap to pick from, and the same colour
written as `#rrggbb` beside it (type one there if you have one — `#ff0000` is
red). If that box's edge turns red, what is in it is not a colour yet, and
nothing changes until it is. A colour with a button beside it, like **None**
or **Same as accent**, can also have no colour of its own. Its square then
fades, and shows the colour the game draws instead: the accent for **Same as
accent**, the text colour for **Same as text**, the title's dark blue for
**Night sky**. (**None** really is no colour, so that square is only faded.)
A setting still at the look's own value has its name greyed.

* **Box** — the message box and menu background.
* **Text** — the words in them.
* **Border** — the line round the box, the menus and the portrait.
* **Accent** — the one to try first. The speaker's name, the ▼, the cursor,
  menu values and the chosen line's border all follow it until you give them
  colours of their own.
* **Chosen line** — the background of the line the cursor is on.
  **Chosen line's text** — its words. When you change either of these, a
  value on the chosen line (a volume, a save's date) takes the chosen line's
  text colour too, so it never disappears into the bar; give **Menu values**
  a colour of your own under More colours to choose it yourself.
* **Dimmed background** — what darkens the game behind some messages.
* **Border thickness** — 0 is no border, 12 is very thick.
* **Rounded corners** — 0 is square.
* **More colours** — the finer parts: the inner line and shadow of the box,
  the shadow under the letters, each thing that follows the accent (so you
  can make just the names red), the box that asks the player for a name
  (**Inside a name box** is behind the name they type, which is in the
  **Text** colour; **OK button text** is the word on OK), how dark the game
  goes behind a message and behind the menu, the title screen, the chapter
  card, and the screen's border.

**↺** next to any setting puts back what the look you started from has.

## Message box

* **Lines in the box** — how many lines show at once (2 to 6). Fewer lines,
  more pages.
* **Width** — how much of the screen's width the box takes.
* **Gap round the box** — space between the box and the screen's edge.
* **Portrait** — where a speaker's face goes on a line that has one: **Left**,
  **Right**, **Above left**, **Above right**, or **Hidden**. Above the box,
  it hangs underneath instead when the box is at the top of the screen.
* **Portrait size** — how many times bigger than the picture.
* **Frame round the portrait** — on or off.
* **Speaker's name** — **In the box**, **On a tab** sitting on the box's top
  edge, or **Hidden**. With the portrait **Above left**, the tab moves to the
  right-hand corner so it does not cover the face.
* **Letters of the name** — as written, CAPITALS, or lower case.
* **Start each line with** — a mark put in front of every line you start on
  its own (every new line in your text). `* ` is the classic one, and it can
  be up to four letters long (the box stops taking letters after four). When
  a line is too long and wraps, the rest lines up *after* the mark, not under
  it.
* **“More” mark** — the ▼ in the corner when a page is done and there is more.
  Pick one, type your own (one or two letters), or **None**.
* **The mark** — **Bobs**, **Blinks**, or **Stays still**.

## Choices

* **Where the answers go** — the **Corner** (bottom right) or the **Middle**.
* **Answers in a** — **Column**, **Row** (side by side), or **Grid**. In a
  row or a grid the arrows on the pad move the way they point: ▼ goes to the
  answer underneath, and ▼ in a row of Yes and No stays where it is.
  Pressed at the edge, an arrow goes round to the other end of that row or
  column, the way a column goes from its last answer back to its first.
* **Columns** — for a grid, how many across.

## Cursor

* **Cursor** — the mark beside the chosen line of a question or a menu: ▶, ♥,
  ☞, ►, •, none, or one or two letters of your own.
* **Cursor colour** — its own colour, or the same as the accent (its square
  shows the accent until you pick one).
* **Cursor size** — in pixels.
* **Box round the chosen line** — off leaves only the cursor to say which
  line is chosen.

The title screen keeps its own buttons: a heart beside "New Game" looks
broken, so the cursor is for questions and menus.

## Pause menu

* **Where** — Middle, Left, Right, Top left, or Top.
* **“Paused” at the top** — on or off.
* **Help line at the bottom** — the line that says how to use the menu. Only
  the pause menu loses it: Settings and Save keep theirs, because it is the one
  line there that says how to get back out.
* **CAPITAL letters** — the menu's words in capitals. A warning in the save
  list stays as written, since a whole sentence in capitals is hard to read.

## Toast

A toast is the little note that pops up, like "Saved.".

* **Where** — Top, Bottom or Middle.
* **Shape** — a round **Pill**, or a **Box** with the same corners as the
  message box.
* **How long it stays** — in thousandths of a second: 1000 is one second.
* Its colours: background, border, text.

## On-screen buttons

* **A and B buttons** — **Round** or **Square**.
* Their colours: the borders, the arrows and labels, A, and B.

## Sounds

One line per thing the player does — moving the cursor, choosing, going back,
"not now", saved, opening and closing the menu, a note popping up. Pick a
sound from your game's list (sounds you have imported are there too), or
**Silent**. **▶** plays it; **↺** puts back the look's own. A sound still at
the look's own has its name greyed, and so does the typing sound below.

**Typing sound (this look)** is how letters sound as they appear, for anyone
who has no voice of their own. A person in the Cast with a voice keeps it,
and *Game › Project › “Everybody sounds like”* wins over this. **▶** here
plays the preview's talk again so you can hear it.

## Getting the three looks

These are starting points — each is one tap, then make it yours.

**A handheld monster-catching RPG** (the look of the Pokémon games on the
old handhelds). Start from **Handheld**. You get the clean white two-line box
with the grey shadow under every letter, a ▶ cursor with no box round the
chosen line, a red ▼, and a start menu down the right-hand side in capitals
with **Keep playing** at the bottom. To go further: a pixel font of your own
is the biggest step (it arrives with *Fonts*, below); set **Border** and
**Box** to your palette; try **Speaker's name › Hidden** and **Portrait ›
Hidden** if your people never show faces.

**An RPG where you can spare everybody** (the look of Undertale). Start from
**Soul**. You get the black box with the square white border, monospace
letters, `* ` before each line with the wrap lined up after it, a blip on
every letter, no ▼, a red heart cursor, answers in a row, the menu in the
top left with no heading, and a black name box with a white OK. To go
further: set **Cursor** to your own heart colour; turn **Gap round the box**
up for a bigger frame; a font of your own, again, is the finishing touch.

**A dream-world RPG** (the look of Omori). Start from **Dream**. You get the
black box with a thin white border, the speaker's NAME on a tab on top of the
box, their portrait framed above the box on the right, a blinking ▼, and the
chosen answer as a white bar with a black ☞ (and OK a white button the
same way, over a black name box). To go further: **Portrait size** to fit
your faces; **Border thickness** 1 for a finer line.

## What happens to what you change

* It is saved in your game, like everything else in Creator Mode — only what
  you changed, on top of the look you started from. A setting put back to the
  look's own is not a change and is not kept.
* Close Creator Mode (✕) and play: the game is in your look from the title
  on. It is still there after the phone is switched off, and it travels with
  the game when you move it to your computer or hand it to somebody.
* The **Problems** group tells you about a look that will not work well: two
  colours too close to read one on the other (the words in the box, the
  chosen line, a toast, a name typed into the name box, the word on OK), a
  message box so big it covers the game on a phone, or a sound or voice your
  game does not have. None of them stop the game. Tap one and the Look group
  opens at the setting to change, with it outlined for a moment.

## Not yet

These are on the way and are not in the Look group yet, so a look cannot do
them today:

* **Fonts** — your own font files (TTF, OTF, WOFF, WOFF2), pixel fonts,
  text size, and line spacing.
* **Typing feel** — text speeds for a look, the page that scrolls up a line
  instead of clearing, a box that moves out of the hero's way, and a box that
  pops or slides open. (The Handheld and Soul looks already hold their
  choices for these, and will use them when the game can.)
* **Answers by the box** — Yes/No above the box, inside it, or beside it,
  with the question still showing. (Handheld, Soul and Dream hold theirs.)
* The pause menu's **order** and hiding its entries (Handheld already puts
  Keep playing last, and Soul leaves it out — B closes the menu), the
  **title screen** (a logo, a background picture), hiding the Creator Mode
  doors in a finished game, **voices** of your own, **saving a look** to use
  in another game, **window pictures**, and **screens** of your own (a bag, a
  game over, a HUD).

## For programmers

A game's look is `project.ui`: only the overrides, on top of `ui.base`. The
fields are `KIT.look.TOKENS` (colours, widths) and `KIT.look.PARTS` (each
part's options, with the words shown here as their `label` and `doc`);
`KIT.look.resolve` fills a look in, `KIT.look.compile` turns it into one
stylesheet (`''` for the kit look), and `KIT.look.apply` puts it in the page.
The Look panel writes through `KIT.editor.ops.look`. All of it is in
`docs/KIT-API.md`; why it is data and not a stylesheet is
`docs/decisions/0017-looks-are-data.md`.

`look.css` in a game made with `tools/new-game.js` is still there for what
the Look group cannot do. It is loaded after the engine's stylesheet and can
set any of the variables `css/kit.css` reads (`--paper`, `--ink`,
`--kit-frame`, `--kit-accent`, `--kit-screen-bg` and the rest); a look set in
Creator Mode wins over it. It never travels with a look.

```jsonc
"ui": {
  "base": "soul",
  "tokens":   { "paper": "#101010" },
  "dialogue": { "lines": 2 },
  "cursor":   { "color": "#ffcc00" }
}
```

Checked by `test/kit/look.test.js`, `test/kit/look-ops.test.js` and
`e2e/look.js` (a phone picking a look with its fingers, then playing in it).
