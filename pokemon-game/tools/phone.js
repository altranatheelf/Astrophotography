#!/usr/bin/env node
// Put the game on your phone, with one command and no files to move.
//
//   npm run phone            -> serves this folder on every address this computer has
//   npm run phone -- 9000    -> on a port of your choosing
//
// It prints the address to type into the phone's browser. Both devices have to
// be on the same Wi-Fi; nothing leaves the network, and there is no account,
// no upload and no third computer in the middle.
//
// Why a server at all, when the whole game is one HTML file you could AirDrop?
// Because a served page can do three things a file:// page cannot:
//   * "Add to Home Screen" gives a real app icon and a full-screen window
//     (the manifest and the apple-touch-icon only load over http);
//   * edits on the computer show up on the phone with a refresh, instead of
//     another round of sending yourself a file;
//   * iOS Safari, which is awkward about local files, is perfectly happy here.
//
// No dependencies: this is node's own http module and about eighty lines.
'use strict';
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const port = Number(process.argv[2]) || 8321;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Where a request is allowed to land: inside this folder, and nowhere else. */
function resolve(urlPath) {
  let rel = decodeURIComponent(String(urlPath).split('?')[0].split('#')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.resolve(root, '.' + path.posix.normalize(rel));
  // path.resolve collapses ".."; anything that climbs out of the folder is refused
  // rather than served, because this listens on the whole network.
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  // And nothing hidden. A game folder is usually a git repository, and `.git`
  // holds every version of everything you have ever written in it — not a thing
  // to hand out to the network just because you wanted the map on your phone.
  const inside = full.slice(root.length).split(path.sep).filter(Boolean);
  if (inside.some(part => part.startsWith('.'))) return null;
  return full;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  const file = resolve(req.url);
  if (!file) { res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('outside the game folder\n'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`not here: ${req.url}\n`);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      // The point of this is editing: never hand back yesterday's file.
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
});

/** Every address a phone on the same Wi-Fi could reach this on. */
function addresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (net.internal) continue;
      out.push(net.address);
    }
  }
  return out;
}

server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`Port ${port} is busy. Try: npm run phone -- ${port + 1}`);
    process.exit(1);
  }
  throw e;
});

server.listen(port, '0.0.0.0', () => {
  const lan = addresses();
  console.log('');
  console.log('  The game is being served. On your phone, open:');
  console.log('');
  if (lan.length) for (const ip of lan) console.log(`      http://${ip}:${port}/`);
  else console.log(`      http://<this computer's address>:${port}/     (no network address found — are you on Wi-Fi?)`);
  console.log('');
  console.log('  Then, to keep it: the browser menu → "Add to Home Screen".');
  console.log('  It gets an icon and opens full screen, like an app.');
  console.log('');
  console.log(`  On this computer:  http://localhost:${port}/`);
  console.log('  Ctrl+C stops it.');
  console.log('');
});
