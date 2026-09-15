#!/usr/bin/env node
// Generates the Tiled fixtures used by test/kit/import-tiled.test.js.
//   node test/fixtures/tiled/make.js
//
// The files follow Tiled's own conventions (field names, ordering, the version
// strings it writes, base64 little-endian gid data, chunked infinite maps):
//   https://doc.mapeditor.org/en/stable/reference/json-map-format/
//   https://doc.mapeditor.org/en/stable/reference/tmx-map-format/
//   https://doc.mapeditor.org/en/stable/reference/global-tile-ids/
//
// Everything stays tiny on purpose: a 6x5 map, a 2x1 tileset image of 16px
// tiles plus one 16x16 sprite, all committed next to this script.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { encodePng } = require('../../../tools/sprite-png.js');

const OUT = __dirname;
const write = (name, text) => { fs.writeFileSync(path.join(OUT, name), text); console.log('wrote', name); };
const writeJson = (name, value) => write(name, JSON.stringify(value, null, 1) + '\n');

const VERSION = '1.10';
const TILED = '1.11.0';
const TW = 16, TH = 16;
const W = 6, H = 5;

// ---- images ----------------------------------------------------------------
// tiles.png: a 4x1 sheet of 16px tiles — grass, wall, water A, water B.
function solidTile(rgba, width, tx, ty, color) {
  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      const o = ((ty * TH + y) * width + (tx * TW + x)) * 4;
      rgba[o] = color[0]; rgba[o + 1] = color[1]; rgba[o + 2] = color[2]; rgba[o + 3] = 255;
    }
  }
}
function makeTilesPng() {
  const width = TW * 4, height = TH;
  const rgba = Buffer.alloc(width * height * 4);
  solidTile(rgba, width, 0, 0, [88, 184, 72]);      // grass
  solidTile(rgba, width, 1, 0, [120, 104, 88]);     // wall
  solidTile(rgba, width, 2, 0, [64, 120, 208]);     // water frame 1
  solidTile(rgba, width, 3, 0, [88, 144, 232]);     // water frame 2
  fs.writeFileSync(path.join(OUT, 'tiles.png'), encodePng(width, height, rgba));
  console.log('wrote tiles.png', `${width}x${height}`);
  return { width, height };
}
function makeSpritePng() {
  const width = TW, height = TH;
  const rgba = Buffer.alloc(width * height * 4);
  solidTile(rgba, width, 0, 0, [216, 96, 96]);
  fs.writeFileSync(path.join(OUT, 'sprite.png'), encodePng(width, height, rgba));
  console.log('wrote sprite.png', `${width}x${height}`);
}

// ---- the external tileset (.tsj) -------------------------------------------
// tile 0 grass (encounter + terrainTag), tile 1 wall (solid via a full-tile
// collision box), tile 2 water (animated 2 frames, blocks its north edge via a
// thin collision strip), tile 3 the second water frame.
function tileset(image) {
  return {
    columns: 4,
    image: 'tiles.png',
    imageheight: image.height,
    imagewidth: image.width,
    margin: 0,
    name: 'outside',
    spacing: 0,
    tilecount: 4,
    tiledversion: TILED,
    tileheight: TH,
    tilewidth: TW,
    type: 'tileset',
    version: VERSION,
    wangsets: [{
      colors: [{ color: '#58b848', name: 'Grass', probability: 1, tile: 0 }],
      name: 'Ground',
      tile: -1,
      type: 'edge',
      wangtiles: [{ tileid: 0, wangid: [1, 0, 1, 0, 1, 0, 1, 0] }],
    }],
    tiles: [
      {
        id: 0,
        properties: [
          { name: 'name', type: 'string', value: 'grass' },
          { name: 'encounter', type: 'bool', value: true },
          { name: 'terrainTag', type: 'int', value: 2 },
          { name: 'footstep', type: 'string', value: 'soft' },
          { name: 'rarity', type: 'float', value: 0.25 },
        ],
      },
      {
        id: 1,
        type: 'wall',
        properties: [{ name: 'name', type: 'string', value: 'wall' }],
        objectgroup: {
          draworder: 'index', id: 2, name: '', objects: [
            { height: TH, id: 1, name: '', rotation: 0, type: '', visible: true, width: TW, x: 0, y: 0 },
          ], opacity: 1, type: 'objectgroup', visible: true, x: 0, y: 0,
        },
      },
      {
        id: 2,
        animation: [{ duration: 400, tileid: 2 }, { duration: 400, tileid: 3 }],
        properties: [
          { name: 'name', type: 'string', value: 'water' },
          { name: 'bush', type: 'bool', value: true },
          { name: 'ledge', type: 'string', value: 'down' },
        ],
        objectgroup: {
          draworder: 'index', id: 2, name: '', objects: [
            { height: 3, id: 1, name: '', rotation: 0, type: '', visible: true, width: TW, x: 0, y: 0 },
          ], opacity: 1, type: 'objectgroup', visible: true, x: 0, y: 0,
        },
      },
      { id: 3, properties: [{ name: 'name', type: 'string', value: 'water-b' }] },
    ],
  };
}

// ---- the map ----------------------------------------------------------------
// GIDs: 1 grass, 2 wall, 3 water. The wall on (4,1) is stored horizontally
// flipped (0x80000000) so the importer has a flip bit to report.
const FLIP_H = 0x80000000;
const G = 1, WALL = 2, WATER = 3;
const groundGids = [
  G, G, G, G, G, G,
  G, G, WATER, G, (WALL | FLIP_H) >>> 0, G,
  G, G, G, G, G, G,
  G, G, G, G, G, G,
  G, G, G, G, G, G,
];
const decoGids = [
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, WALL, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
];

const OBJECTS = [
  {
    // An NPC as a tile object from the embedded image-collection tileset. Tiled
    // anchors tile objects at the BOTTOM-left corner, so y = 48 means tile row 2.
    // It has no class of its own: it inherits 'npc' (and the sprite property)
    // from its tile, which is Tiled's property inheritance.
    gid: 5, height: TH, id: 1, name: 'Mom', rotation: 0, type: '', visible: true, width: TW,
    x: 2 * TW, y: 3 * TH,
    properties: [
      { name: 'dialogue', type: 'string', value: 'Mom: Good morning!\nMom: Mind the water.' },
      { name: 'behaviour', type: 'string', value: 'look' },
      { name: 'mood', type: 'string', value: 'cheerful' },
    ],
  },
  {
    // A rectangle warp: shapes are anchored TOP-left, so (5,4) is tile (5,4).
    height: TH, id: 2, name: 'Door', rotation: 0, type: 'warp', visible: true, width: TW,
    x: 5 * TW, y: 4 * TH,
    properties: [
      { name: 'map', type: 'string', value: 'home.tmj' },
      { name: 'x', type: 'int', value: 3 },
      { name: 'y', type: 'int', value: 7 },
      { name: 'dir', type: 'string', value: 'up' },
    ],
  },
  {
    // A plain rectangle with no class: becomes a trigger carrying its properties.
    height: 2 * TH, id: 3, name: 'Meadow', rotation: 0, type: '', visible: true, width: 2 * TW,
    x: 1 * TW, y: 3 * TH,
    properties: [
      { name: 'zone', type: 'string', value: 'meadow' },
      { name: 'steps', type: 'int', value: 4 },
      { name: 'secret', type: 'bool', value: true },
    ],
  },
  {
    // class 'collision': not an object at all, it paints the map's collision array.
    height: TH, id: 4, name: 'Fence', rotation: 0, type: 'collision', visible: true, width: 2 * TW,
    x: 3 * TW, y: 3 * TH, properties: [],
  },
];

function objectLayer() {
  return { draworder: 'topdown', id: 3, name: 'events', objects: JSON.parse(JSON.stringify(OBJECTS)), opacity: 1, type: 'objectgroup', visible: true, x: 0, y: 0 };
}

// An embedded image-collection tileset (no sheet image; one image per tile).
// Its single tile carries the class 'npc', so a tile object using it becomes a
// Kit npc without repeating the class on every object.
function embeddedTileset() {
  return {
    columns: 0,
    firstgid: 5,
    grid: { height: TH, orientation: 'orthogonal', width: TW },
    margin: 0,
    name: 'folk',
    spacing: 0,
    tilecount: 1,
    tileheight: TH,
    tilewidth: TW,
    tiles: [{
      id: 0, image: 'sprite.png', imageheight: TH, imagewidth: TW, type: 'npc',
      properties: [{ name: 'sprite', type: 'string', value: 'woman' }],
    }],
  };
}
function csvMap() {
  return {
    compressionlevel: -1,
    height: H,
    infinite: false,
    layers: [
      { data: groundGids, height: H, id: 1, name: 'ground', opacity: 1, type: 'tilelayer', visible: true, width: W, x: 0, y: 0 },
      { data: decoGids, height: H, id: 2, name: 'deco', opacity: 1, type: 'tilelayer', visible: true, width: W, x: 0, y: 0 },
      objectLayer(),
    ],
    nextlayerid: 4,
    nextobjectid: 5,
    orientation: 'orthogonal',
    properties: [{ name: 'kind', type: 'string', value: 'outdoor' }, { name: 'music', type: 'string', value: 'town' }],
    renderorder: 'right-down',
    tiledversion: TILED,
    tileheight: TH,
    tilesets: [{ firstgid: 1, source: 'outside.tsj' }, embeddedTileset()],
    tilewidth: TW,
    type: 'map',
    version: VERSION,
    width: W,
  };
}
const b64 = (gids, compression) => {
  const buf = Buffer.alloc(gids.length * 4);
  gids.forEach((g, i) => buf.writeUInt32LE(g >>> 0, i * 4));
  const out = compression === 'zlib' ? zlib.deflateSync(buf) : compression === 'gzip' ? zlib.gzipSync(buf) : buf;
  return out.toString('base64');
};
function zlibMap() {
  const m = csvMap();
  for (const l of m.layers) {
    if (l.type !== 'tilelayer') continue;
    l.encoding = 'base64';
    l.compression = 'zlib';
    l.data = b64(l.data, 'zlib');
  }
  return m;
}
// The infinite variant: the same picture, but living at chunk (-16, -16) so the
// importer has to find the used bounds and offset everything back to (0, 0).
const CHUNK = 16;
function chunkFrom(gids, ox, oy) {
  const data = new Array(CHUNK * CHUNK).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[(y + oy) * CHUNK + (x + ox)] = gids[y * W + x];
  return data;
}
function infiniteMap() {
  const ox = 3, oy = 2;                   // inside the chunk, so the used area is offset both ways
  const m = csvMap();
  m.infinite = true;
  for (const l of m.layers) {
    if (l.type !== 'tilelayer') continue;
    l.chunks = [{ data: chunkFrom(l.data, ox, oy), height: CHUNK, width: CHUNK, x: -CHUNK, y: -CHUNK }];
    l.startx = -CHUNK;
    l.starty = -CHUNK;
    delete l.data;
  }
  for (const o of m.layers[2].objects) {
    o.x += (-CHUNK + ox) * TW;
    o.y += (-CHUNK + oy) * TH;
  }
  return m;
}

// ---- TMX / TSX ---------------------------------------------------------------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
function xmlProps(list, indent) {
  if (!list || !list.length) return '';
  const lines = list.map(p => `${indent} <property name="${esc(p.name)}"${p.type && p.type !== 'string' ? ` type="${p.type}"` : ''} value="${esc(p.value)}"/>`);
  return `${indent}<properties>\n${lines.join('\n')}\n${indent}</properties>\n`;
}
function tsx(ts) {
  let out = '<?xml version="1.0" encoding="UTF-8"?>\n';
  out += `<tileset version="${VERSION}" tiledversion="${TILED}" name="${ts.name}" tilewidth="${ts.tilewidth}" tileheight="${ts.tileheight}" tilecount="${ts.tilecount}" columns="${ts.columns}">\n`;
  out += ` <image source="${ts.image}" width="${ts.imagewidth}" height="${ts.imageheight}"/>\n`;
  for (const t of ts.tiles) {
    out += ` <tile id="${t.id}"${t.type ? ` type="${t.type}"` : ''}>\n`;
    out += xmlProps(t.properties, '  ');
    if (t.objectgroup) {
      out += '  <objectgroup draworder="index" id="2">\n';
      for (const o of t.objectgroup.objects) out += `   <object id="${o.id}" x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}"/>\n`;
      out += '  </objectgroup>\n';
    }
    if (t.animation) {
      out += '  <animation>\n';
      for (const f of t.animation) out += `   <frame tileid="${f.tileid}" duration="${f.duration}"/>\n`;
      out += '  </animation>\n';
    }
    out += ' </tile>\n';
  }
  for (const ws of (ts.wangsets || [])) {
    out += ' <wangsets>\n';
    out += `  <wangset name="${ws.name}" type="${ws.type}" tile="${ws.tile}">\n`;
    for (const c of ws.colors) out += `   <wangcolor name="${c.name}" color="${c.color}" tile="${c.tile}" probability="${c.probability}"/>\n`;
    for (const wt of ws.wangtiles) out += `   <wangtile tileid="${wt.tileid}" wangid="${wt.wangid.join(',')}"/>\n`;
    out += '  </wangset>\n';
    out += ' </wangsets>\n';
  }
  out += '</tileset>\n';
  return out;
}
function tmx() {
  const m = csvMap();
  let out = '<?xml version="1.0" encoding="UTF-8"?>\n';
  out += `<map version="${VERSION}" tiledversion="${TILED}" orientation="orthogonal" renderorder="right-down" width="${W}" height="${H}" tilewidth="${TW}" tileheight="${TH}" infinite="0" nextlayerid="4" nextobjectid="5">\n`;
  out += xmlProps(m.properties, ' ');
  out += ' <tileset firstgid="1" source="outside.tsx"/>\n';
  const emb = embeddedTileset();
  out += ` <tileset firstgid="${emb.firstgid}" name="${emb.name}" tilewidth="${emb.tilewidth}" tileheight="${emb.tileheight}" tilecount="${emb.tilecount}" columns="0">\n`;
  out += `  <grid orientation="orthogonal" width="${emb.grid.width}" height="${emb.grid.height}"/>\n`;
  for (const t of emb.tiles) {
    out += `  <tile id="${t.id}" type="${t.type}">\n`;
    out += xmlProps(t.properties, '   ');
    out += `   <image source="${t.image}" width="${t.imagewidth}" height="${t.imageheight}"/>\n`;
    out += '  </tile>\n';
  }
  out += ' </tileset>\n';
  for (const l of m.layers) {
    if (l.type === 'tilelayer') {
      out += ` <layer id="${l.id}" name="${l.name}" width="${W}" height="${H}">\n`;
      out += '  <data encoding="csv">\n';
      for (let y = 0; y < H; y++) out += l.data.slice(y * W, y * W + W).join(',') + (y === H - 1 ? '' : ',') + '\n';
      out += '  </data>\n </layer>\n';
      continue;
    }
    out += ` <objectgroup id="${l.id}" name="${l.name}">\n`;
    for (const o of l.objects) {
      const gid = o.gid ? ` gid="${o.gid}"` : '';
      const type = o.type ? ` type="${o.type}"` : '';
      out += `  <object id="${o.id}" name="${o.name}"${type}${gid} x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}">\n`;
      out += xmlProps(o.properties, '   ');
      out += '  </object>\n';
    }
    out += ' </objectgroup>\n';
  }
  out += '</map>\n';
  return out;
}

// ---- go ------------------------------------------------------------------------
const image = makeTilesPng();
makeSpritePng();
const ts = tileset(image);
writeJson('outside.tsj', ts);
write('outside.tsx', tsx(ts));
writeJson('town.tmj', csvMap());
writeJson('town-zlib.tmj', zlibMap());
writeJson('town-infinite.tmj', infiniteMap());
write('town.tmx', tmx());
