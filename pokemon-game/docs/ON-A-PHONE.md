# On a phone

**This document is** about running the engine on a phone — how to get it there,
and what is different once it is. Where it disagrees with
`docs/CREATOR-MODE.md` about what a panel does, that one wins; where it
disagrees with `README.md` about how to start, this one wins, because the
phone is the case the README's one-liners are shortened for.

The whole engine runs on a phone: the game, and Creator Mode with it.

## The short version

**With only a phone, open this link** in the phone's browser:

https://raw.githack.com/altranatheelf/Astrophotography/claude/pokemon-two-player-game-b6ol8x/pokemon-game/Our-Adventure.html

That is the whole game in one page, served straight from the repository
(raw.githack.com hands GitHub's copy of `Our-Adventure.html` to the browser as
a web page). It is the latest version pushed to that branch; once the branch is
merged, the same address with `main` in place of the branch name is the one to
use. Saves stay in that browser on that phone. For an icon, use the browser's
Share menu › **Add to Home Screen**.

**On the phone, start your own game in two taps.** Open the page, tap **Start
your own game** on the title screen, tap **A region to explore**. You get a
town with a house and a lab you can walk into, a route north with tall grass
that has things living in it, and Creator Mode already open on the town. There
is nothing to type, nothing to import and nothing to download.

Once there is a game on the device, that second tap asks before replacing it,
and names what it would replace. **↶** in Creator Mode undoes it in one step
either way.

**Or, from a computer on the same Wi-Fi, with one command:**

```
npm run phone
```

It prints an address like `http://192.168.1.23:8321/`. Type that into the
phone's browser — both devices on the same Wi-Fi — and the game is there.
Nothing is uploaded anywhere; the two devices talk to each other and to nobody
else. `npm run phone -- 9000` picks a different port.

Then, in the phone browser's menu, **Add to Home Screen**. It gets an icon and
opens full screen, with no browser chrome, like an app.

## The other ways to get it there

* **One file, sent to yourself.** `npm run build` writes `Our-Adventure.html` —
  about 2 MB with everything inside it, including the art. AirDrop, email or
  Drive it to the phone and open it. It works offline forever after that. This
  is the simplest route on Android; on iOS, Safari is awkward about files saved
  on the device, and `npm run phone` is the easier path.
* **A static host.** Drop the folder on Netlify, GitHub Pages or anything else
  that serves files, and the URL works on every device you own. Same as
  `npm run phone`, but it keeps working when your computer is off.

## Why serve it rather than send the file

A served page can do three things a page opened from a file cannot:

* **Add to Home Screen gives a real app.** The icon and the full-screen window
  come from `manifest.webmanifest` and `icons/apple-touch-icon.png`, and a
  browser will only fetch those over `http`/`https`. From a file, the tags are
  simply ignored and you get a bookmark.
* **Edits on the computer show up on the phone** when you pull to refresh,
  instead of sending yourself the file again.
* **iOS Safari is happy.** Local HTML files are second-class citizens there.

## What Creator Mode looks like on a phone

* **The bottom sheet** holds all of it. It is short under **Map** so you can see
  what you are painting, and tall under **Story**, **Game** and **Problems** so
  you can read. The **▴/▾** grip above the group row flips it by hand; when it
  goes tall the tool row hides to make room.
* **Chip rows scroll sideways** — the layer chips under "Painting on", the tile
  categories, the panel chips. If the one you want is not there, swipe the row.
* **Tiles stay thumb-sized.** A map opens at a zoom that fits it *and* keeps a
  square big enough to hit; on a phone the second rule wins, so a large map
  opens showing part of itself. **−** and **+** on the tool row change it.
* **Turn the phone sideways** for the computer's side-by-side layout. Better for
  anything with a long list — Variables, Species, Problems.
* **Game › On-screen buttons** is auto / on / off. "off" still keeps ☰, so the
  pause menu is always reachable.

## Importing on a phone

The Import panel opens the phone's own file picker, so anything in Files or
Drive works: Tiled `.tmx`/`.json`, an RPG Maker project, Aseprite `.ase`,
Pokémon Essentials `.txt`, plain `.png` tilesets and character sheets,
`.ogg`/`.mp3`/`.wav`. The one thing that does not work is dropping a whole
*folder* — phones have no folder drag-and-drop, so pick the files.

## Moving work between the phone and the computer

**Project › This game, on your other device:**

* **Copy** puts the whole game on the clipboard. Two taps, no Files app; paste
  it into the box on the other device.
* **↓ Save a copy** writes one `<name>.kitgame.json` to send however you send
  things.
* **↓ Save as files (for git)** comes down as one `<name>-files.zip` on a phone
  (one file per map, sorted keys). Unzip it into the game folder on the computer
  and commit. Only Chrome and Edge on a computer can write straight into a
  folder.

Opening a game replaces the one you are editing as a single undo step, so a
mis-paste is not fatal.

## What to know before you rely on it

* **Storage is per browser and per device.** The game on the phone is a
  different draft from the one on the computer; the export above is the bridge,
  there is no sync. Your work does survive closing the tab and reopening it.
* **Safari can evict storage** when the phone gets tight. Export anything you
  care about rather than trusting the browser to hold it.
* **A very large map is slower on a phone** than on a computer — the tile cache
  has a budget and starts re-drawing instead of remembering. It gets slow, it
  does not break.
