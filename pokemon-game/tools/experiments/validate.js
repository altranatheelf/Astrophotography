// Experiment: how long does the project take to check, at the size of a real game?
//
//   node tools/experiments/validate.js        (no browser: this is pure JavaScript)
//
// Validation runs twice a session: once at boot, inside normalize(), and then
// 250ms after every edit in Creator Mode. It is synchronous, so whatever it
// costs is a freeze — and at 400 maps with OMORI's 6,000 events it cost 2.2s,
// which nobody had measured because the boot figure in the docs came from a
// project of 400 empty maps. One function was half of it (the schema layer
// re-normalising static field declarations per command); this is the threshold
// that keeps it fixed.
'use strict';
const path = require('path');
const KIT = require(path.join(__dirname, '..', '..', 'test', 'kit', '_load.js'));
const P = KIT.project, SP = KIT.screenplay;

let failures = 0;
const log = (...a) => console.log(...a);
function threshold(name, value, ok, unit) {
  const pass = !!ok;
  if (!pass) failures++;
  log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(50)} ${String(value)}${unit || ''}`);
  return pass;
}
const ms = (fn) => { const t0 = process.hrtime.bigint(); const r = fn(); return { ms: Number(process.hrtime.bigint() - t0) / 1e6, r }; };

const tiles = KIT.registry('tiles');
for (const t of ['grass', 'wall', 'floor-wood']) if (!tiles.has(t)) tiles.add({ id: t, group: 'nature', solid: t === 'wall' });
// A page with a line, a variable, a choice and two more lines: what an ordinary
// NPC carries. Fifteen of them per map is OMORI's density.
const body = SP.parse(['Mom: Good morning, {p1}!', '@set chapter += 1', '? Are you ready?', '- Yes', '  Mom: Off you go.', '- No', '  Mom: Take your time.'].join('\n')).commands;
function sized(n) {
  const p = P.blank();
  p.vars = { chapter: { type: 'number', default: 0 } };
  for (let i = 0; i < n; i++) {
    const m = P.newMap({ id: 'm' + i, name: 'Map ' + i, width: 30, height: 20, kind: 'outdoor' });
    for (let k = 0; k < 15; k++) {
      m.objects.push({ id: 'npc' + k, name: 'NPC ' + k, type: 'npc', x: k, y: k % 20, pages: [{
        when: null, sprite: 'woman', dir: 'down', layer: 'same', through: false, dirFix: false, stepAnim: false, visible: true,
        behaviour: { kind: 'none' }, on: { interact: body }, once: false, needsBoth: false, props: {},
      }] });
    }
    p.maps['m' + i] = m;
    p.world.maps['m' + i] = { x: i * 34, y: 0, folder: '' };
  }
  return p;
}

log('\n--- what was measured (this machine; read it as a trend) ---');
const rows = [];
for (const n of [30, 100, 400]) {
  const raw = sized(n);
  const norm = ms(() => P.normalize(raw));
  const project = norm.r.project;
  const val1 = ms(() => P.validate(project));
  const val2 = ms(() => P.validate(project));
  const col = ms(() => P.collect(project));
  rows.push({ n, events: n * 15, normalize: norm.ms, validate: val1.ms, again: val2.ms, collect: col.ms, problems: val1.r.length });
  log(`  ${String(n).padStart(3)} maps, ${String(n * 15).padStart(4)} events:  normalize ${norm.ms.toFixed(0).padStart(5)}ms   validate ${val1.ms.toFixed(0).padStart(5)}ms   again ${val2.ms.toFixed(0).padStart(5)}ms   collect ${col.ms.toFixed(0).padStart(4)}ms`);
}

log('\n--- thresholds ---');
const big = rows[rows.length - 1];
// Boot and the post-edit check at OMORI's size. 2.2s and 2.5s before; a whole
// second is already a freeze an author feels, so that is the line.
threshold('400 maps / 6,000 events validate in under a second', big.validate.toFixed(0), big.validate < 1000, 'ms');
threshold('and normalize (boot) in under 1.2 seconds', big.normalize.toFixed(0), big.normalize < 1200, 'ms');
threshold('and collect (the Variables index) in under half a second', big.collect.toFixed(0), big.collect < 500, 'ms');
// The memo is the fix, so the memo is what is checked: a second validation of
// the same project must not be slower than the first. Before the fix it was
// slower, because every call built fresh copies of the schema and a WeakMap
// entry for each.
threshold('a second validation is no slower than the first', `${big.again.toFixed(0)}ms after ${big.validate.toFixed(0)}ms`, big.again <= big.validate * 1.25 + 20);
// Cost has to grow with the project, not faster than it.
const small = rows[0], mid = rows[1];
threshold('cost grows with the project, not faster', `30→100 ×${(mid.validate / small.validate).toFixed(1)}, 100→400 ×${(big.validate / mid.validate).toFixed(1)}`,
  mid.validate / small.validate < 5 && big.validate / mid.validate < 6);
threshold('the validator still finds the one real problem', big.problems, big.problems === 1);

if (failures) { log(`\n${failures} threshold(s) failed`); process.exit(1); }
log('\nALL THRESHOLDS PASS');
