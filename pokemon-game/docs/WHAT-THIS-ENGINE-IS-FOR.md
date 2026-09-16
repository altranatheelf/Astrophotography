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

**Text that reads like it was written.** Register control: speed, pauses,
silence, a line with no box, a name that is not a name yet, a font that changes
when the voice does. *RPG Maker: a three-line box and a word-wrap plugin.*

**Other media inside the game.** Field recordings, photographs, documents,
a radio that plays something real. The archive is part of the story. *RPG Maker:
no.*

**Authored from a phone or a laptop, by you, alone.** Every panel thumb-sized,
the project a file you can move between devices, and no install anywhere. *RPG
Maker: a Windows desktop application.*

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
| Runs remembered across New Game (the `meta` section) | **partly** — stored, not yet exposed to authors |
| Atmosphere: light, fog, grain, vignette, letterbox, palette | **in progress** |
| Camera: zoom, anchor, pan, look-at, framing | **in progress** |
| Parallax layers | **in progress** |
| Scenes that run at once (`meanwhile`) | **in progress** |
| Layers of reality (map variants, swap as a verb) | next |
| Cast: people, relationships, knowledge | next |
| The archive: documents, recordings, photographs | next |
| Project sync between phone and laptop | next |

## The rule

Everything above is engine or module, never content. The engine ships with no
sample game; the demo world exists only to exercise features and can be deleted
without losing anything.
