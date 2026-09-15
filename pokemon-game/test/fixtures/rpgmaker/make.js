#!/usr/bin/env node
// Generates the RPG Maker MV fixture project used by test/kit/import-rpgmaker.test.js.
//   node test/fixtures/rpgmaker/make.js
// Both this script and everything it writes are committed, so the test never
// needs to run it — re-run it only when the fixture should change.
//
// It writes the files an MV project really has, with MV's own conventions:
//   data/MapInfos.json     two maps in the map tree
//   data/Map001.json       6x5, data = width*height*6 (4 tile layers, shadow, region)
//   data/Map002.json       a 4x4 inn to transfer into
//   data/Tilesets.json     tilesetNames[9] + a full 8192-entry flags array
//   data/System.json       named switches/variables (index 0 is always "") + start position
//   data/CommonEvents.json one autorun common event gated on a switch, plus a
//                          "kitchen sink" one for the command translator
//   data/Items.json, data/Actors.json
//   img/tilesets/Willow_B.png   16x16 tiles of 8px  (128x128)
//   img/tilesets/Willow_A2.png  16x12 tiles of 8px  (128x96)
//   img/characters/Villagers.png 12x8 frames of 8x12 (96x96)
//   img/faces/People1.png        4x2 faces of 16x16  (64x32)
'use strict';
const fs = require('fs');
const path = require('path');
const { encodePng } = require('../../../tools/sprite-png.js');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const IMG = path.join(ROOT, 'img');

// ---------------------------------------------------------------------------
// tiny PNGs
// ---------------------------------------------------------------------------
/** A flat grid of colours so each cell of a sheet is visibly different. */
function gridPng(file, cols, rows, cellW, cellH, colorAt) {
  const W = cols * cellW, H = rows * cellH;
  const rgba = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = colorAt(Math.floor(x / cellW), Math.floor(y / cellH), x % cellW, y % cellH);
      const o = (y * W + x) * 4;
      rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = c.length > 3 ? c[3] : 255;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng(W, H, rgba));
  return { w: W, h: H };
}

const hash = (a, b) => ((a * 73 + b * 151) >>> 0);
const cellColor = (cx, cy, ix, iy) => {
  const h = hash(cx + 1, cy + 3);
  const edge = (ix === 0 || iy === 0) ? 40 : 0;                     // a 1px darker border per cell
  return [(h % 200) + 40 - edge, ((h >> 8) % 200) + 40 - edge, ((h >> 16) % 200) + 40 - edge];
};

// ---------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------
const audio = (name) => ({ name, volume: 90, pitch: 100, pan: 0 });
const NO_AUDIO = { name: '', volume: 90, pitch: 100, pan: 0 };
const END = { code: 0, indent: 0, parameters: [] };

function conditions(extra) {
  return Object.assign({
    actorId: 1, actorValid: false, itemId: 1, itemValid: false,
    selfSwitchCh: 'A', selfSwitchValid: false,
    switch1Id: 1, switch1Valid: false, switch2Id: 1, switch2Valid: false,
    variableId: 1, variableValid: false, variableValue: 0,
  }, extra || {});
}
function image(extra) {
  return Object.assign({ tileId: 0, characterName: '', direction: 2, pattern: 1, characterIndex: 0 }, extra || {});
}
function page(extra) {
  return Object.assign({
    conditions: conditions(), directionFix: false, image: image(), list: [END],
    moveFrequency: 3, moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false },
    moveSpeed: 3, moveType: 0, priorityType: 1, stepAnime: false, through: false, trigger: 0, walkAnime: true,
  }, extra || {});
}
function mapFile(extra) {
  return Object.assign({
    autoplayBgm: false, autoplayBgs: false, battleback1Name: '', battleback2Name: '',
    bgm: NO_AUDIO, bgs: NO_AUDIO, disableDashing: false, displayName: '',
    encounterList: [], encounterStep: 30, note: '',
    parallaxLoopX: false, parallaxLoopY: false, parallaxName: '', parallaxShow: false, parallaxSx: 0, parallaxSy: 0,
    scrollType: 0, specifyBattleback: false, tilesetId: 1,
  }, extra || {});
}

// ---- Map001: 6 x 5 ---------------------------------------------------------
const W1 = 6, H1 = 5;
const TILE = { GRASS: 1, PATH: 9, WALL: 16, BUSH: 17, COUNTER: 18, ROOF: 20, FLOWERS: 2816 };  // 2816 = A2 autotile kind 16 shape 0

function layer(w, h, rows) {
  const out = new Array(w * h).fill(0);
  rows.forEach((row, y) => row.forEach((v, x) => { out[y * w + x] = v; }));
  return out;
}
const map1Data = [].concat(
  // z0 — ground
  layer(W1, H1, [
    [TILE.WALL, TILE.WALL, TILE.WALL, TILE.WALL, TILE.WALL, TILE.WALL],
    [TILE.GRASS, TILE.GRASS, TILE.PATH, TILE.GRASS, TILE.GRASS, TILE.GRASS],
    [TILE.GRASS, TILE.GRASS, TILE.PATH, TILE.GRASS, TILE.GRASS, TILE.GRASS],
    [TILE.GRASS, TILE.GRASS, TILE.PATH, TILE.GRASS, TILE.GRASS, TILE.COUNTER],
    [TILE.GRASS, TILE.GRASS, TILE.PATH, TILE.GRASS, TILE.GRASS, TILE.GRASS],
  ]),
  // z1 — the layer above the ground (still under the characters)
  layer(W1, H1, [
    [0, 0, 0, 0, 0, 0],
    [0, TILE.FLOWERS, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, TILE.BUSH, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
  ]),
  // z2 — over the characters
  layer(W1, H1, [
    [0, 0, 0, 0, 0, TILE.ROOF],
    [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0],
  ]),
  // z3 — the fourth tile layer, unused here
  layer(W1, H1, [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]]),
  // z4 — wall shadows (a bitfield the importer ignores on purpose)
  layer(W1, H1, [[0, 0, 0, 0, 0, 0], [5, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]]),
  // z5 — region ids
  layer(W1, H1, [
    [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 3, 0, 0, 0],
  ])
);

// Event 1: two pages. Page 1 talks, gives an item and flips self switch A;
// page 2 is conditioned on that self switch and says something else.
const oldBran = {
  id: 1, name: 'Old Bran', note: '', x: 2, y: 2,
  pages: [
    page({
      trigger: 0, priorityType: 1, moveType: 1, moveFrequency: 3, moveSpeed: 3,
      image: image({ characterName: 'Villagers', characterIndex: 2, direction: 2, pattern: 1 }),
      list: [
        { code: 101, indent: 0, parameters: ['People1', 3, 0, 2] },
        { code: 401, indent: 0, parameters: ['Morning, \\N[1]. Mind the \\C[2]bees\\C[0].'] },
        { code: 401, indent: 0, parameters: ['Here, take this.\\|'] },
        { code: 126, indent: 0, parameters: [1, 0, 0, 1] },
        { code: 250, indent: 0, parameters: [audio('Item1')] },
        { code: 123, indent: 0, parameters: ['A', 0] },
        END,
      ],
    }),
    page({
      trigger: 0, priorityType: 1,
      conditions: conditions({ selfSwitchValid: true, selfSwitchCh: 'A' }),
      image: image({ characterName: 'Villagers', characterIndex: 2, direction: 2, pattern: 1 }),
      list: [
        { code: 101, indent: 0, parameters: ['People1', 3, 0, 2] },
        { code: 401, indent: 0, parameters: ['Buns keep you honest. \\V[1] coins left, eh?'] },
        END,
      ],
    }),
  ],
};

// Event 2: an invisible door on Player Touch that transfers to Map002.
const innDoor = {
  id: 2, name: 'Inn Door', note: '', x: 5, y: 4,
  pages: [
    page({
      trigger: 1, priorityType: 0, through: true,
      list: [
        { code: 250, indent: 0, parameters: [audio('Door1')] },
        { code: 201, indent: 0, parameters: [0, 2, 1, 1, 2, 0] },
        END,
      ],
    }),
  ],
};

const map001 = mapFile({ width: W1, height: H1, data: map1Data, events: [null, oldBran, innDoor], displayName: 'Willow Town' });

// ---- Map002: 4 x 4 ---------------------------------------------------------
const W2 = 4, H2 = 4;
const map2Data = [].concat(
  new Array(W2 * H2).fill(TILE.GRASS),
  new Array(W2 * H2).fill(0), new Array(W2 * H2).fill(0), new Array(W2 * H2).fill(0),
  new Array(W2 * H2).fill(0), new Array(W2 * H2).fill(0)
);
const map002 = mapFile({ width: W2, height: H2, data: map2Data, events: [null], autoplayBgm: true, bgm: audio('Inn') });

// ---- MapInfos --------------------------------------------------------------
const mapInfos = [null,
  { id: 1, expanded: true, name: 'Willow Town', order: 1, parentId: 0, scrollX: 0, scrollY: 0 },
  { id: 2, expanded: false, name: 'Inn', order: 2, parentId: 1, scrollX: 0, scrollY: 0 },
];

// ---- Tilesets --------------------------------------------------------------
// flags is indexed by tileId and is always 8192 long (Tilemap.TILE_ID_MAX).
// 1536 = 0x600 = "no boat, no ship" — MV's default for a plain walkable tile.
const flags = new Array(8192).fill(0);
for (let i = 1; i < 8192; i++) flags[i] = 0x600;
flags[0] = 0x10;                                       // the empty tile is a [*] star tile
flags[TILE.GRASS] = 0x600;                             // walkable
flags[TILE.PATH] = 0x600 | (1 << 12);                  // walkable, terrain tag 1
flags[TILE.WALL] = 0x600 | 0x0f;                       // impassable in all four directions
flags[TILE.BUSH] = 0x600 | 0x40;                       // bush
flags[TILE.COUNTER] = 0x600 | 0x80;                    // counter
flags[TILE.ROOF] = 0x600 | 0x10;                       // [*] no effect on passage
flags[3] = 0x600 | 0x20;                               // a ladder tile, unused by the maps
flags[4] = 0x600 | 0x100;                              // a damage floor, unused by the maps
flags[5] = 0x600 | 0x08 | 0x02;                        // one-way: cannot pass up or left
for (let i = 0; i < 48; i++) flags[2816 + i] = 0x600;  // the A2 autotile kind 16 block

const tilesets = [null, {
  id: 1, name: 'Willow', mode: 0, note: '',
  flags,
  tilesetNames: ['', 'Willow_A2', '', '', '', 'Willow_B', '', '', ''],
}];

// ---- System ----------------------------------------------------------------
// Index 0 of switches/variables is always "" — MV numbers them from 1.
const system = {
  gameTitle: 'Willow Town',
  switches: ['', 'Met Bran', 'Sunrise Done'],
  variables: ['', 'Coins', 'Chapter'],
  startMapId: 1, startX: 1, startY: 1,
  partyMembers: [1], currencyUnit: 'G', locale: 'en_US', versionId: 12345678,
  optDisplayTp: false, optDrawTitle: true, optExtraExp: false, optFloorDeath: false,
  optFollowers: true, optSideView: false, optSlipDeath: false, optTransparent: false,
  title1Name: '', title2Name: '', titleBgm: NO_AUDIO, battleBgm: NO_AUDIO, victoryMe: NO_AUDIO,
  defeatMe: NO_AUDIO, gameoverMe: NO_AUDIO, sounds: [], terms: { basic: [], commands: [], params: [], messages: {} },
  armorTypes: [''], elements: [''], equipTypes: [''], skillTypes: [''], weaponTypes: [''],
  windowTone: [0, 0, 0], testTroopId: 1, testBattlers: [], editMapId: 1, magicSkills: [1], menuCommands: [],
  attackMotions: [], battlerHue: 0, battlerName: '', battleback1Name: '', battleback2Name: '',
  boat: { bgm: NO_AUDIO, characterIndex: 0, characterName: '', startMapId: 0, startX: 0, startY: 0 },
  ship: { bgm: NO_AUDIO, characterIndex: 0, characterName: '', startMapId: 0, startX: 0, startY: 0 },
  airship: { bgm: NO_AUDIO, characterIndex: 0, characterName: '', startMapId: 0, startX: 0, startY: 0 },
};

// ---- CommonEvents ----------------------------------------------------------
// 1: an autorun gated on switch 2 that sets it off again (MV's usual pattern).
// 2: a call-type event that exercises the branchy parts of the translator.
const commonEvents = [null,
  {
    id: 1, name: 'Sunrise', switchId: 2, trigger: 1,
    list: [
      { code: 223, indent: 0, parameters: [[34, 34, 68, 0], 60, true] },
      { code: 122, indent: 0, parameters: [2, 2, 0, 0, 1] },
      { code: 121, indent: 0, parameters: [2, 2, 1] },
      END,
    ],
  },
  {
    id: 2, name: 'Gate Riddle', switchId: 1, trigger: 0,
    list: [
      { code: 111, indent: 0, parameters: [1, 1, 0, 3, 1] },                 // if Coins >= 3
      { code: 101, indent: 1, parameters: ['', 0, 0, 2] },
      { code: 401, indent: 1, parameters: ['The gate creaks open.'] },
      { code: 205, indent: 1, parameters: [0, { list: [
        { code: 4, parameters: [] }, { code: 4, parameters: [] }, { code: 15, parameters: [30] }, { code: 0, parameters: [] },
      ], repeat: false, skippable: true, wait: true }] },
      { code: 505, indent: 1, parameters: [{ code: 4, parameters: [] }] },
      { code: 505, indent: 1, parameters: [{ code: 4, parameters: [] }] },
      { code: 505, indent: 1, parameters: [{ code: 15, parameters: [30] }] },
      { code: 505, indent: 1, parameters: [{ code: 0, parameters: [] }] },
      { code: 411, indent: 0, parameters: [] },                              // else
      { code: 102, indent: 1, parameters: [['Pay up', 'Walk away'], 1, 0, 2, 0] },
      { code: 402, indent: 1, parameters: [0, 'Pay up'] },
      { code: 122, indent: 2, parameters: [1, 1, 2, 0, 3] },                 // Coins -= 3
      { code: 0, indent: 2, parameters: [] },
      { code: 402, indent: 1, parameters: [1, 'Walk away'] },
      { code: 115, indent: 2, parameters: [] },
      { code: 0, indent: 2, parameters: [] },
      { code: 404, indent: 1, parameters: [] },                              // one End of Choices
      { code: 412, indent: 0, parameters: [] },                              // end if
      { code: 356, indent: 0, parameters: ['OpenGate west 2'] },             // no Kit equivalent
      END,
    ],
  },
];

// ---- Items / Actors --------------------------------------------------------
const items = [null, {
  id: 1, name: 'Honey Bun', description: 'Sticky. Filling.', iconIndex: 176, itypeId: 1,
  price: 20, consumable: true, scope: 7, occasion: 0, speed: 0, successRate: 100, repeats: 1, tpGain: 0,
  hitType: 0, animationId: 0, note: '', damage: { critical: false, elementId: 0, formula: '0', type: 0, variance: 20 },
  effects: [{ code: 11, dataId: 0, value1: 0, value2: 100 }],
}];
const actors = [null, {
  id: 1, name: 'Robin', nickname: '', note: '', profile: '', classId: 1, initialLevel: 1, maxLevel: 99,
  characterName: 'Villagers', characterIndex: 0, faceName: 'People1', faceIndex: 0,
  battlerName: '', equips: [0, 0, 0, 0, 0], traits: [],
}];

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------
function writeJson(name, value) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, name), JSON.stringify(value) + '\n');
  return name;
}

const written = [
  writeJson('MapInfos.json', mapInfos),
  writeJson('Map001.json', map001),
  writeJson('Map002.json', map002),
  writeJson('Tilesets.json', tilesets),
  writeJson('System.json', system),
  writeJson('CommonEvents.json', commonEvents),
  writeJson('Items.json', items),
  writeJson('Actors.json', actors),
];

const sheets = [
  ['img/tilesets/Willow_B.png', gridPng(path.join(IMG, 'tilesets/Willow_B.png'), 16, 16, 8, 8, cellColor)],
  ['img/tilesets/Willow_A2.png', gridPng(path.join(IMG, 'tilesets/Willow_A2.png'), 16, 12, 8, 8, cellColor)],
  ['img/characters/Villagers.png', gridPng(path.join(IMG, 'characters/Villagers.png'), 12, 8, 8, 12, cellColor)],
  ['img/faces/People1.png', gridPng(path.join(IMG, 'faces/People1.png'), 4, 2, 16, 16, cellColor)],
];

for (const n of written) console.log(`data/${n}`);
for (const [n, size] of sheets) console.log(`${n} (${size.w}x${size.h})`);
