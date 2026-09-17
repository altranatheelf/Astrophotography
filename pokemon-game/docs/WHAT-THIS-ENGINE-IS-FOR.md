# What this engine is for

Not a Pokémon game. A world engine — the thing Elsewhenowhere needs and RPG
Maker cannot give you. Pokémon is one module that happens to be loaded first
because a gift was due.

This is the standing list of what the engine must be able to do, why RPG Maker
cannot, and where each piece stands. Nothing here is a template or a sample
game; it is all engine.

## The world you are building needs

**Places that feel enormous and slightly wrong.** Scale, light and silence do
that, not tiles. So: darkness with real light sources, coloured ambient per map
and per hour, fog and haze, grain, vignette, letterboxing, palette shift, and a
camera that can pull back until a person is small in a hall. *RPG Maker: needs
three plugins that fight each other, and the 48px grid fixes your scale.*

**Layers of the same place.** A room, and the same room otherwise. Swapping is
the verb, not a cutscene: you keep your position and your state and the world
changes around you. *RPG Maker: separate maps and a transfer, so the seam shows.*

**Scenes that happen at once.** A door closes while someone keeps talking while
the music drops out. Authored as parallel tracks with a shared clock, not a
queue of commands taking turns. *RPG Maker: Move Route with Wait, and prayer.*

**A game that remembers.** Across runs, not just saves: what you did last time,
which ending you reached, what you were called. An NPC can open with it. *RPG
Maker: nothing.*

**People who know things.** A cast with relationships and knowledge, where a
line changes because of what someone learned three scenes ago, and you can see
that graph while writing. *RPG Maker: switches, hand-counted.*

**A voice, not a font.** How somebody sounds AND looks while their words
arrive — font, colour, size, pace, blip — as one named thing you can switch in
the middle of a sentence. *RPG Maker: a colour code.* — done: Undertale bundles
exactly these into 114 numbered presets in a 310-line if-chain and switches them
with `\TX`; here it is one asset and `{voice:sans}`.

**Text that reads like it was written.** Register control: speed, pauses,
silence, a line with no box, a name that is not a name yet, a font that changes
when the voice does. *RPG Maker: a three-line box and a word-wrap plugin.*

**A second language without a second game.** Every line a player can read is
findable, and a translation is one text file keyed on the lines themselves — so
moving a scene keeps its translation and rewording a line correctly asks for it
again. *RPG Maker: ship a second copy of your project, which is why so few of
its games exist in more than one language.* — done: Project › Languages hands
out the file and takes it back, on a phone.

**Music that answers what is happening.** The same piece, with parts arriving
and leaving — rain, dread, a second voice — brought up and down while it plays,
never restarted. *RPG Maker: play a different track, which starts it again from
the top.* — done: a track declares named layers, `@layer danger on` swells one
in, and they have been playing silently on the same clock so one enters on the
beat it was already on.

**Other media inside the game.** Field recordings, photographs, documents,
a radio that plays something real. The archive is part of the story. *RPG Maker:
no.*

**Authored from a phone or a laptop, by you, alone.** Every panel thumb-sized,
the project a file you can move between devices, and no install anywhere. *RPG
Maker: a Windows desktop application.* — done: Creator Mode runs on both, and
Project › “This game, on your other device” saves the whole thing as one file to
send yourself, or puts it on the clipboard, and opens one the same way. No
server, no account, nothing through anybody else's computer. `e2e/devices.js`
does the round trip in two browsers that share nothing.

## Where each piece stands

| Capability | State |
|---|---|
| Maps, movement, collision, connections, ledges, counters | **done** |
| Events with pages, conditions, self state, six trigger slots | **done** |
| The full command set with RPG Maker's vocabulary | **done** |
| Dialogue with faces, wrapping, pagination, pacing codes | **done** |
| Screenplay: every script as plain text, losslessly | **done** |
| Creator Mode: paint, place, write, play here, on a phone | **done** |
| Import from Tiled, RPG Maker MV, Aseprite | **done** |
| Save and project formats with migrations | **done** |
| Atmosphere: light, fog, grain, vignette, letterbox, palette | **done** — real light sources, composited on their own layer |
| Camera: zoom, anchor, pan, look-at, framing | **done** |
| Scenes that run at once (`meanwhile`) | **done** |
| Layers of reality (map variants, shifting as a verb) | **done** |
| Markers: things drawn on the map that are not in it | **done** |
| One clock: the day, the hour, and the gap between sessions | **done** |
| Runs remembered across New Game (the `meta` section) | **done** — `@remember`, the `meta` condition, `{meta:key}` in a line |
| Cast: people, relationships, knowledge | **done** — and a panel that draws the graph |
| A game moved between a phone and a laptop | **done** — one file, both ways, no server |
| A second language, without a second copy of the game | **done** — one text file, keyed on the lines themselves |
| Music that answers what is happening, without restarting | **done** — named layers on one clock, `@layer rain on` |
| A voice that changes mid-sentence — font, colour, pace, blip | **done** — `{voice:sans}`, and `{fx:wave}` for the letters |
| Words drawn on a scene's own canvas, not only in a box | **done** — `KIT.drawText`, same codes, deterministic effects |
| The archive: documents, recordings, photographs | next |
| Parallax layers | next |

## The rule

Everything above is engine or module, never content. The engine ships with no
sample game; the demo world exists only to exercise features and can be deleted
without losing anything.
