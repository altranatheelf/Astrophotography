# Looks — how your game looks and sounds

This document is for the person making the game: what the **Look** group in
Creator Mode does, what every control in it means, and how to get the three
looks people ask for most. It is written for a phone, because that is where
you will do it. Where this page and the game disagree, the game wins and this
page is wrong — say so and it gets fixed.

A **look** is a set of choices about everything round the game that is not
the map: the message box people talk in, the letters it is written in, how
fast the words type and how a page turns, the answers to a question, the
cursor, the pause menu, the little note that pops up ("Saved."), the buttons
on a phone's screen, and the sounds all of these make. Your game starts from
one of four looks, and anything you change is kept on top of it. Nothing is
drawn: a look is colours, shapes, letters and the game's own sounds, so it
works offline and costs your game almost nothing to carry. The one thing you
can bring in is a font: its file is kept inside the game, so that works
offline too.

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
| **Talk** | Somebody from your game talking, typing and blipping the way the game will — at the look's speed, in its font, turning its pages its way. It uses the first line in your game that somebody says (one with a portrait, if there is one). When no line in your game has a portrait, one of your game's portraits stands in (or a plain face shape, if the game has none), so you can see what the portrait settings do. |
| **Choice** | A question — "Ready?" — with Yes and No, where the look puts them: in the corner, in the middle, or by a message box holding the question. |
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
  at a time that **scroll up** a line at a time, slow silent typing, no names
  or portraits in the box, **Yes and No in a little window above the box**
  with the question still in it, and the pause menu down the right in
  capitals.
* **Soul** — a black box with a square white border, monospace letters, a red
  heart for a cursor, a blip on every letter, `* ` at the start of each line,
  no ▼, a box that **moves to the top when the hero is below it**, and **the
  answers in a row inside the box**, under the line that asked.
* **Dream** — a black box with a thin white border, the speaker's name on a
  tab in capitals, a framed portrait above the box, a blinking ▼, **the
  answers in a window of their own beside the box**, and a white bar with a
  black ☞ for the chosen answer.

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

## Fonts

A font is the shape of the letters. Your game can carry fonts of its own:

1. Tap **＋ Add a font…** and pick a font file from the phone (or the
   computer) — a **TTF**, **OTF**, **WOFF** or **WOFF2**. You can pick more
   than one. It is kept *inside* your game, so the game still works with no
   internet, and the font goes wherever the game goes. Game › Import takes
   font files too.
2. The font appears as a card, its name written in the font itself, with its
   size. Under it:
   * **Pixel font** — tap it if the font is drawn in squares (most retro
     fonts are). Then **Drawn at** says the size its letters were drawn at,
     in pixels — usually 8 or 16, and the font's page usually says. The game
     then only draws it at whole times that size (16 or 24 for an 8-pixel
     font), so every square stays sharp instead of smudging.
   * **Remove** takes the font out of the game. Anything that was written in
     it goes back to the look's own letters. ↶ brings it back.
3. Then pick where it is used. Each choice is a row of buttons, each written in
   its own letters so you can see them before you tap:
   * **Message text** — what people say, the answers and the lines of the
     menus: most of the words on the game screen.
   * **Names and menus** — menu headings and values, the speaker's name, the
     chapter card, and the game's name and buttons on the title screen.
   * **Speaker's name** — only the name over what somebody says. **Same as
     names and menus** unless you pick one.
   * Without a font of your own: **Plain** (the phone's own), **Pixel**,
     **Typewriter**, **Book** and **Rounded**. On a phone these use the fonts
     it already has, so they look a little different from phone to phone.
   * **Add a font…** at the end of each row brings a file in and uses it
     right there.
4. **Text size** — Small, Normal, Large or Huge, for what people say. With a
   pixel font, the nearest size where its squares stay sharp, so two sizes can
   come out the same: an 8-pixel font is 16 at Small and Normal, and 24 at
   Large and Huge; a 16-pixel font is 16 at all but Huge, which is 32.
5. **Line spacing** — the space between the lines of a message.

A few things to know:

* A file is taken as a font only if what is inside it is one. A download that
  did not finish, or another file renamed to `.ttf`, is refused with a note
  saying so, rather than added as a font that draws nothing.
* **Big fonts make a big game.** A font over 300 KB gets a warning in
  Problems, and so do fonts adding up to more than 1.5 MB: a game opened from
  a file keeps its unsaved changes in about 5 MB of the browser's storage. A
  **WOFF2** of the same font is usually a third of the size of the TTF.
* A font only has the letters its maker drew. A letter it does not have (an
  accent, a symbol) is drawn in the look's own letters instead.
* Make sure the font's licence lets you put it in a game you share. Many free
  pixel fonts do; the page you got it from says.

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
* **Opening** — how the box comes up when somebody starts talking: it
  **Appears**, **Pops** or **Slides up**. Lines one after another stay in the
  same box, so a conversation opens once — a line after a `{shake}`, or the
  answer to a question asked by the box, carries on in it rather than opening
  it again. With the phone's or the game's *Reduce motion* on, it just
  appears.
* **Where the box goes** — at the **Bottom**, or **Out of the hero's way**:
  at the bottom unless the hero is standing in the bottom half of the screen,
  and then at the top, so you can always see who is talking. A line you told
  to go at the top or in the middle (in Show Text) still goes there. A line
  cannot be made to stay at the bottom over the hero with this on: pick
  **Bottom** here for that.

## Typing

How the words arrive.

* **Typing speeds** — **Slow**, **Normal** and **Fast** are the three a
  player picks from in Settings; here you say how many letters a second each
  one types in your look. About 30 is an easy read, 60 is quick, and the old
  handhelds are about 15. The player still chooses which of the three. A
  person in the Cast whose voice has a speed of its own keeps it.
* **Next page** — **Clears the box**: the next page starts empty. **Scrolls
  up a line**: the bottom line moves up to the top and only the new line
  types under it, the way the old handheld games do; the line that moved up
  is not typed again, and makes no sound. Each tap brings one more line.
  To see it, tap **▶ Try** and then the box: with Scrolls up a line the
  preview's line goes on for a page more than the box holds, so a tap always
  has a page to scroll to, even when your game's first line fits in one.

The Show Text box in Story shows how the message box will break what you
write — how many lines to a page, and the mark in front of each line — in
your look. With **Scrolls up a line**, it shows what each press of A shows:
the line before kept at the top, one new line under it. Change the look and
come back, and it shows the new look's pages.

## Choices

* **Where the answers go** — the **Corner** (bottom right), the **Middle**,
  or by a message box that keeps the question on screen:
  * **Above the box** — the answers in a little window over the box's right
    corner (the handheld way).
  * **In the box** — the answers side by side inside the box, under the
    question. Answers too long to sit side by side go onto the lines under,
    still inside the box.
  * **Beside the box** — the answers in a window of their own, to the right of
    the box. The box is narrower then, and the question's words flow again to
    fit it. The window goes over the box's right end instead, and the box
    keeps its full width, when there is not room beside it — long answers, a
    grid of three, a row too wide — or when the question squeezed beside the
    window would be more than a line taller than it was. A portrait above the
    box stays in its corner: when the window is taller than the box, the
    portrait sits on top of the window rather than behind it. The window keeps
    clear of a name on a tab, too.

  In these three the question is in a box like the message box. When the
  question has words of its own (the text box of Show Choices), those are
  in it. When it has none, the box keeps **the last thing that was said** —
  so "Take it?" in Show Text followed by Show Choices with no text shows
  "Take it?" with Yes and No by it, the way most RPGs ask. The box goes
  where the message box went: at the top, if it moved out of the hero's way.
  A line with no window, or with the game dimmed behind it, stays that way
  while the question is asked.
* **Answers in a** — **Column**, **Row** (side by side, beside the box too),
  or **Grid**. Answers side by side — in a row, a grid, or inside the box —
  move the way the arrows on the pad point: ▼ goes to the answer underneath,
  and ▼ in a row of Yes and No stays where it is. Pressed at the edge, an
  arrow goes round to the other end of that row or column, the way a column
  goes from its last answer back to its first. ◀ and ▶ always move: when long
  answers have gone one to a line, they step to the next answer and the one
  before. Tapping an answer picks it, wherever it is.
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
"not now", saved, opening and closing the menu, turning a page of a message
(and closing its last one), a note popping up. Pick a
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
with the grey shadow under every letter, slow silent typing, a page that
scrolls up a line at a time with a click as it turns, Yes and No in a little
window above the box with the question still showing, a ▶ cursor with no box
round the chosen line, a red ▼, and a start menu down the right-hand side in
capitals with **Keep playing** at the bottom. To go further: a pixel font of
your own is the biggest step (**Fonts › Add a font…**, then **Pixel font**
and its size); set **Border** and **Box** to your palette.

**An RPG where you can spare everybody** (the look of Undertale). Start from
**Soul**. You get the black box with the square white border, monospace
letters, `* ` before each line with the wrap lined up after it, a blip on
every letter, no ▼, a red heart cursor, answers in a row, the menu in the
top left with no heading, and a black name box with a white OK. The box
moves to the top of the screen when the hero is in the bottom half, and a
question is asked inside the box, under the line that asked it, with the
answers in a row and the heart beside the chosen one. To go further: set
**Cursor** to your own heart colour; turn **Gap round the box** up for a
bigger frame; a font of your own, again, is the finishing touch.

**A dream-world RPG** (the look of Omori). Start from **Dream**. You get the
black box with a thin white border, the speaker's NAME on a tab on top of the
box, their portrait framed above the box on the right, a blinking ▼, the
answers in their own window beside the box with the question still in it,
and the chosen answer as a white bar with a black ☞ (and OK a white button
the same way, over a black name box). To go further: **Portrait size** to
fit your faces; **Border thickness** 1 for a finer line; a font of your own.

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
  message box so big it covers the game on a phone, a sound, voice or font
  your game does not have, a font file that is not a font the game can use,
  or fonts big enough to fill a phone's storage. None of them stop the game.
  Tap one and the Look group opens at the setting to change, with it
  outlined for a moment.

## Not yet

These are on the way and are not in the Look group yet, so a look cannot do
them today:

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
stylesheet (`''` for the kit look in a game with no fonts of its own), and
`KIT.look.apply` puts it in the page.
The Look panel writes through `KIT.editor.ops.look`. All of it is in
`docs/KIT-API.md`; why it is data and not a stylesheet is
`docs/decisions/0017-looks-are-data.md`.

A game's own fonts are `project.fonts`: `{ id: { name, src, pixel, px } }`,
`src` a `data:font/<ttf|otf|woff|woff2>;base64,…` URI (anything else is not
used, and never fetched). The look names one by its id (`"fontText":
"dotgothic"`), and `compile` writes each one as an `@font-face` for the
family `"kitf-<id>"` — every usable font, used or not, so the Look group can
show each in its own letters. `apply` keeps those in a
`<style id="kit-look-fonts">` of their own, written only when the fonts
change: a colour dragged in the Look group never makes the browser read the
font files again. `KIT.import.image.fontsFrom(files)` makes them from
font files; `KIT.editor.ops.look.addFont` and `editFont` write them.

`look.css` in a game made with `tools/new-game.js` is still there for what
the Look group cannot do. It is loaded after the engine's stylesheet and can
set any of the variables `css/kit.css` reads (`--paper`, `--ink`,
`--kit-frame`, `--kit-accent`, `--kit-screen-bg` and the rest); a look set in
Creator Mode wins over it. It never travels with a look.

```jsonc
"ui": {
  "base": "soul",
  "tokens":   { "paper": "#101010", "fontText": "dotgothic", "textSize": "large" },
  "dialogue": { "lines": 2, "pageTurn": "scroll", "speeds": { "normal": 24 } },
  "choice":   { "place": "above-box" },
  "cursor":   { "color": "#ffcc00" }
},
"fonts": { "dotgothic": { "name": "DotGothic", "src": "data:font/woff2;base64,…", "pixel": true, "px": 8 } }
```

Checked by `test/kit/look.test.js`, `test/kit/look-ops.test.js` and
`e2e/look.js` (a phone picking a look with its fingers, then playing in it,
and bringing in a font: `test/fixtures/look/one-glyph.ttf`, one square for the
letter A, written by `tools/make-test-font.js`).
