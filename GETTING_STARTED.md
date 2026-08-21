# METEORPREP — plain-language guide

## Fastest route: straight from your phone, no computer

If you're working with Claude (the AI that built this tool), your phone is
already the app: Claude's cloud computer has METEORPREP installed.

1. **Let the cloud reach the star map** (one-time): in your Claude Code
   settings on claude.ai, open your environment's **network settings** and
   allow internet access (only needed for the OPTIONAL online star
   catalogue; the built-in star map works offline). The solver
   needs it to look up the stars in your photos.
2. **Get your frames to the cloud**, either way works:
   - *Small batch:* attach 10–20 RAW files straight to a message.
   - *Whole night:* in the Files app, select the frames → **Compress** →
     upload the zip to iCloud Drive / Dropbox / Google Drive → **Share ▸
     Copy Link** → paste the link into the chat.
3. **Say roughly where the camera pointed** — a compass direction and how
   high ("northeast, about halfway up the sky"). That plus the photos'
   own timestamps is all the solver needs.
4. Claude runs the pipeline (`meteorprep-cloud <link> --pointed NE
   --elevation 55`), shows you the contact sheet, and sends back the
   layered result — which opens in **Photoshop on iPhone/iPad**.

Everything below is the do-it-yourself route on your own computer.

## Phone-guided mode on your own computer

Run `meteorprep-phone` on the computer once; it prints an address like
`http://192.168.1.23:8765`. Open that on your phone (same Wi-Fi): a
step-by-step page checks the setup, takes your photos (a card reader
plugged into the phone works), shows live progress, then the contact
sheet and a download button. Safari's **Share ▸ Add to Home Screen**
gives it an app icon. The page only exists on your home network — don't
expose it to the internet.

*For the photographer with a folder of meteor-shower RAW files who does not
want to learn programming. Ten minutes of one-time setup, then it's
drag-and-drop.*

## What this tool actually does

You shot hundreds of frames on a fixed tripod during the Perseids. Somewhere
in there are a handful of meteors, plus planes, satellites, and a lot of
identical starfields. METEORPREP:

1. Reads every RAW file and its capture time.
2. Works out the exact sky position of every frame (it matches your stars
   to a star map — it carries its own, so this works offline).
3. Undoes the sky's rotation **correctly**. Simply rotating the images
   looks fine in the middle but is off by *hundreds of pixels* in the
   corners of a wide lens over a night — this tool does the real map
   projection instead, so corner stars and meteors land where they should.
4. Finds streaks, and tells meteors apart from planes (blinking, colored)
   and satellites (thin, steady, multi-frame). Nothing is deleted — the
   rejects go into a hidden "FLAGGED" folder of layers you can inspect.
5. Averages all your frames into one super-clean starfield (the meteors are
   carefully kept out of the average).
6. Gives you a layered Photoshop document: clean sky at the bottom, your
   foreground, then **one layer per meteor** that you toggle on/off.

Your taste stays yours: which meteors to keep, which foreground, crop,
color — all still done by you in Photoshop, non-destructively.

## One-time setup (Mac)

1. Install Python from https://www.python.org/downloads/ (big yellow
   button, then open the downloaded file and click through).
2. Install exiftool from https://exiftool.org (reads capture times from
   your RAWs — same drill, download and double-click the installer).
3. Open the **Terminal** app once (I know — it's three lines, copy-paste
   them one at a time and press Return):

   ```
   pip3 install meteorprep-folder-path-here   # or: pip3 install -e /path/to/this/folder
   pip3 install twirl astroquery              # optional: online star
                                              # catalogue as a fallback
   pip3 install PySide6                       # the drag-and-drop window
   ```

## Every time after that

1. Put all the frames from one night, one tripod position, in one folder
   (subfolders are fine; don't mix in shots from a different composition).
2. Run: `python3 -m meteorprep.gui` (or make a shortcut for it once).
3. Drag your folder onto the window. It counts your photos and tells you
   roughly how long each choice will take on *your* Mac.
4. Pick one of the three, press **Find my meteors**, go make coffee.
   (The same button turns into **Stop** while it's working. Stopping is
   safe — everything worked out so far is kept, and running the same
   folder again picks up from there.)
5. It opens the report by itself when it's done. Start there.

## The three choices, and the difference between them

They all read every photo and search every one of them the same way, so
**they all find the same meteors**. What changes is what you get out.

| | you get | roughly |
|---|---|---|
| **Quick look** | a half-size JPEG and the report — no Photoshop file | a third of the time |
| **Full quality** | the layered Photoshop file at full size | the whole run |
| **Full quality, half size** | the same layers, half as wide and tall | about half |

**Quick look** is for "did I catch anything, and does it look good?" It
lands in a folder of its own called `quick-look`, so it can never be
mixed up with the real files. It also skips the slower second pass that
hunts the very faintest meteors, and on a long night it builds the
background sky from a few dozen photos instead of all of them — the sky
is a touch noisier, the meteors are all there.

The good part: **a quick look is not wasted work.** Run the same folder
again on Full quality and it reuses everything — the folder scan, the
star lock and the whole meteor search are already done, so it starts
most of the way in.

**Full quality, half size** is the one to pick if your disk is nearly
full or a full-size run was more than your Mac wanted to do. Same
layers, same meteors, quarter-size files.

From the command line: `--mode quick`, `--mode full`, `--mode smaller`.

## Where the files land

Everything goes in a folder next to your photos called
`<your folder>_meteorprep`. Inside it there is one folder per shooting
sequence — usually just **g01** — and that is where your files are:

`<your folder>_meteorprep/g01/…` (and `g01/quick-look/…` for a Quick
look). Only `run_log.txt` and `cache/` sit at the top level.

- **report.html** — opens by itself; every candidate with a thumbnail and
  a verdict. Your 30-second check of its work.
- **meteorprep.psd** — the layered file (not in a quick look).
- **preview.jpg** — the finished picture, ready to share as-is.
- **preview_all_trails.jpg** — the same sky with the planes and
  satellites composited too.
- **contact_sheet.png** — one thumbnail of every candidate, side by side.
- **startrail.tif / .jpg** — the classic circular trails, if you asked.
- **meteorprep.json** — every measurement, for the record.
- **capsule.txt** — a caption you can paste under a post: integration
  time, what was calibrated, and that no pixel was invented.
- **skymask.png** — what the tool decided was ground. It should look
  like your treeline's silhouette.
- **evidence/** — the stack's own receipts: how many photos built each
  pixel, where outliers were thrown away, what light was removed.
- **run_log.txt** — the full diary (one level up, next to `g01`). This
  is the file to send if something looks wrong. A Quick look writes its
  own as `run_log_quick.txt` so the two never overwrite each other.
- **cache/** — working files. Safe to delete once you're happy; keeping
  it is what makes a second run on the same folder fast.

## Getting it into Photoshop

- If a `meteorprep.psd` file was written: just open it.
- Otherwise (always works): open Photoshop, go to
  **File ▸ Scripts ▸ Browse…**, pick `assemble.jsx` from the output
  folder. Photoshop rebuilds the whole layered document itself.

What you'll see in the Layers panel:

- **BASE_SKY** — the clean averaged starfield. Bottom layer.
- **FOREGROUND** — your foreground options (the normal one is on; any
  light-painted versions are there too, turned off — pick your favorite).
- **METEORS** — one layer per meteor, already in Screen mode, named with
  its source file, time, and a `perseid`/`sporadic` tag. Turn them on and
  off to taste. That's the whole game.
- **FLAGGED** (hidden) — the planes/satellites/searchlight frames, in case
  the tool got one wrong. Peek if a meteor you remember is missing.

Every layer is numbered once across both groups — there is no second
M001 hiding in FLAGGED — so dragging one from FLAGGED up into METEORS
never gives you two layers with the same name.

Layers in **METEORS** are set to Screen — the layer holds the streak's
own added light, so screening it onto the sky is the physical
composite and leaves no box edge. Their names carry
the source file, the time, a `perseid`/`sporadic` tag and — if the tool
knows where you were standing — roughly how long that meteor lasted and
how high above the horizon it burned.

There's also `meteorprep.json` — a receipt of everything the tool did, so
your composite is honestly documentable ("all meteors registered to the sky
positions they actually occurred at").

## The receipts

- **capsule.txt** — a short "how this image was made" block you can paste
  under a post: integration time, how many frames, what was calibrated,
  how many meteors are at their true sky positions, and *generated
  pixels: none*. It ends with the hash of the exact recipe used, so the
  same folder run again reproduces the same file.
- **evidence/** — the stack's own measurements, as pictures:
  `coverage.png` (how many photos built each pixel), `noise.png` (the
  per-pixel sky noise), `rejected.png` (where outliers were thrown away),
  `removed.png` (the light that was thrown away — meteors, planes,
  satellites, cosmic rays) and `ledger.png`, which colours every pixel by
  where it came from: measured at full depth, outliers removed, thin
  coverage at the rim, or foreground.

## Telling the tool where you were standing

Optional, and worth ten seconds. Put your latitude and longitude in the
**Where** box (Apple Maps: press and hold your spot, the numbers are on
the place card) and each meteor also gets an estimate of how long it
lasted, how high it burned and how far away it was — plus a sanity check
that catches the rare case where the star matching locks onto the wrong
patch of sky. Leave it empty and everything else works exactly the same;
those numbers are simply left out rather than guessed. If your camera
records GPS, the tool reads it from the photos and you can ignore the box.

## If something goes wrong

- **"couldn't read the capture times"** → install exiftool (step 2 above).
- **"couldn't match the stars"** → this does NOT need the internet;
  the star map is built in. Check the pointing hints instead
  (it downloads a star map for your patch of sky), and the middle frame of
  your sequence needs a reasonable amount of visible sky. Frames ruined by
  clouds or car headlights are fine elsewhere in the folder — the tool
  skips them for matching.
- **A plane got labeled as a meteor (or vice versa)** → nothing is lost;
  drag the layer between the METEORS and FLAGGED groups in Photoshop.
- **"the camera moved during the night"** → you knocked the tripod. The
  stars and the meteors are fine: every frame is matched to the star map
  on its own and put back where it really pointed. The one casualty is
  the extra-clean averaged foreground, which would show two horizons, so
  the tool leaves it out and says so in the report. Use the FOREGROUND
  layer that comes from a single photo.
