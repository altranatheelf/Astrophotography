// {{TITLE}} — the whole world, as one file.
//
// This is an empty game on purpose: one room, one person to be, and nothing
// else, so the first thing in it is yours and not somebody else's idea.
//
// `build()` hands the engine a plain object. Nothing here is magic — every key
// is described in docs/ARCHITECTURE.md ("the project format"), and Creator Mode
// edits exactly this shape in the browser. Two ways to work, one world:
//
//   npm run build     turns this file into content/project.js and content/maps/*
//   ?edit=1           opens Creator Mode; "Export" writes the same files back
//
// Edit whichever you like. Just don't edit both at once without exporting first.
'use strict';

module.exports = {
  id: '{{ID}}',
  name: '{{TITLE}}',

  /**
   * build({ KIT, id, name }) -> the project, before it is normalized.
   *
   * Leave a field out and the engine fills in a sensible default; the ones
   * below are spelled out so you can see what there is to change.
   */
  build({ KIT, id, name }) {
    const W = 20, H = 15;

    // A map's layers are flat arrays, row by row: index = y * width + x.
    // `blank` makes one of them. `terrain` is a number (what the ground IS, for
    // rules like water and walking sounds); `ground`, `deco` and `above` are
    // tile ids (what it LOOKS like), drawn under you, with you, and over you.
    const blank = (fill) => new Array(W * H).fill(fill);

    const start = {
      id: 'start',
      name: 'A room with nothing in it',
      width: W, height: H,
      kind: 'outdoor',            // 'outdoor' | 'indoor' | 'cave' — lighting and encounter rules read this
      music: null,
      note: 'The first room. Paint over it.',
      layers: {
        terrain: blank(1),        // 1 = the grass declared in `terrains` below
        ground: blank('grass'),
        deco: blank(null),
        above: blank(null),
        regions: blank(0),        // region numbers you can test for in a script
      },
      collision: blank(null),     // null = follow the terrain; true/false = override it here
      objects: [],                // people, doors, chests, triggers — add them in Creator Mode
      props: {},
    };

    return {
      version: 3,
      meta: { id, title: name, subtitle: '', pitch: '' },

      // Modules are optional systems: `--modules <id>` when you make a game, or
      // add an id here. See docs/MODULES.md for what each one gives you.
      modules: [],

      settings: {
        tileSize: 16,
        viewport: { w: 16, h: 12 },   // how much world fits on screen, in tiles
      },

      // Who the player is. Add a second hero and the engine gives you a second
      // player on the same device; the world does not have to change.
      heroes: [
        { id: 'p1', name: 'You', sprite: 'hero-boy', recolor: {} },
      ],
      start: { map: 'start', x: 10, y: 7, dir: 'down' },

      vars: {},           // the story's own variables — flags, counts, names
      items: {},          // things that can be carried
      scripts: {},        // common events: scenes any map can call
      fragments: [],      // reusable pieces of script
      testStates: [],     // named save states to jump into while you work

      // What the ground is made of. `base` decides how it behaves.
      terrains: [
        { id: 1, name: 'Grass', color: '#78c850', base: 'grass' },
      ],
      autotiles: {},

      // Where the maps sit relative to each other, so the editor can show them
      // side by side and so walking off one edge can lead to another.
      world: { maps: { start: { x: 0, y: 0, folder: '' } }, connections: [] },

      maps: { start },
      packs: {},
    };
  },
};
