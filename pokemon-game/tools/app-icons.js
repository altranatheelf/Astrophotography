#!/usr/bin/env node
// The home-screen icon and the web app manifest.
//
//   node tools/app-icons.js
//
// Writes icons/icon-192.png, icons/icon-512.png, icons/apple-touch-icon.png and
// manifest.webmanifest. Run it when the icon below or the game's name changes;
// the files it writes are committed, so a clone has them without running it.
//
// Why bother: "Add to Home Screen" on a phone gives you an app icon and a
// full-screen window with no browser chrome — which is the difference between
// a bookmark and a thing you open to work on your game. Android reads the
// manifest for the name and icon; iOS reads the apple-touch-icon and the
// apple-mobile-web-app-* meta tags in index.html. Both want a real file at a
// real URL, so none of this does anything for a page opened from the Downloads
// folder (file://) — it is for the served case, which is the one worth setting
// up on a phone anyway.
'use strict';
const fs = require('fs');
const path = require('path');
const { encodePng, hexToRgb } = require('./sprite-png.js');

const root = path.join(__dirname, '..');

// The icon, in the same form as every other piece of art in this repo: rows of
// characters and a palette. A crossroads with four trees — a small map, which
// is what this is for.
const PALETTE = {
  o: '#0b0c12',   // the frame
  G: '#78c850',   // grass
  p: '#d8b878',   // path
  t: '#3a7a2a',   // tree, shaded
  T: '#5aa83a',   // tree, lit
  b: '#6b4a2a',   // trunk
};
const ROWS = [
  'oooooooooooooooo',
  'oGGGGGGppGGGGGGo',
  'oGGGGGGppGGGGGGo',
  'oGGtTtGppGGtTtGo',
  'oGGTTTGppGGTTTGo',
  'oGGGbGGppGGGbGGo',
  'oGGGGGGppGGGGGGo',
  'oppppppppppppppo',
  'oppppppppppppppo',
  'oGGGGGGppGGGGGGo',
  'oGGGGGGppGGGGGGo',
  'oGGtTtGppGGtTtGo',
  'oGGTTTGppGGTTTGo',
  'oGGGbGGppGGGbGGo',
  'oGGGGGGppGGGGGGo',
  'oooooooooooooooo',
];

for (let y = 0; y < ROWS.length; y++) {
  if (ROWS[y].length !== 16) throw new Error(`icon row ${y} is ${ROWS[y].length} wide, not 16`);
  for (const ch of ROWS[y]) if (!PALETTE[ch]) throw new Error(`icon row ${y}: “${ch}” is not in the palette`);
}

/** Nearest-neighbour to any size, so 180 works as well as 192 and 512. */
function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(15, Math.floor((y * 16) / size));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(15, Math.floor((x * 16) / size));
      const [r, g, b] = hexToRgb(PALETTE[ROWS[sy][sx]]);
      const o = (y * size + x) * 4;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

const MANIFEST = {
  name: 'Our Adventure',
  short_name: 'Adventure',
  description: 'A story-adventure engine with a creator mode built in.',
  start_url: './index.html',
  scope: './',
  display: 'standalone',
  orientation: 'any',
  background_color: '#0a0b10',
  theme_color: '#0b0c12',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  ],
};

fs.mkdirSync(path.join(root, 'icons'), { recursive: true });
const wrote = [];
for (const [name, size] of [['icons/icon-192.png', 192], ['icons/icon-512.png', 512], ['icons/apple-touch-icon.png', 180]]) {
  fs.writeFileSync(path.join(root, name), render(size));
  wrote.push(`${name} (${size}×${size})`);
}
fs.writeFileSync(path.join(root, 'manifest.webmanifest'), JSON.stringify(MANIFEST, null, 2) + '\n');
wrote.push('manifest.webmanifest');
console.log('wrote ' + wrote.join(', '));
