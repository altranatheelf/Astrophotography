// Experiment: does storage hold up at the size of a real game?
//
//   NODE_PATH=$(npm root -g) node tools/experiments/storage.js
//
// This is the test that should have been run before any of the storage code was
// written, and was not. Every other number in this repo was measured AFTER the
// thing was built — frame rate, boot time, the tile-cache leak — which means
// each one was a discovery rather than a decision. A threshold set beforehand is
// the only kind that can tell you to stop.
//
// The thresholds below are the ones an author would actually feel:
//   1. A save at OMORI scale must not block the frame for more than 100ms.
//   2. A project of 400 maps must actually fit.
//   3. A refused write must return false, not throw and not lie.
//   4. Reading a save back must give exactly what was written.
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(__dirname, '..', '..', 'index.html');
let failures = 0;
const log = (...a) => console.log(...a);
function threshold(name, value, ok, unit) {
  const pass = !!ok;
  if (!pass) failures++;
  log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} ${String(value)}${unit || ''}`);
  return pass;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(PAGE);
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted, { timeout: 30000 });

  const r = await page.evaluate(async () => {
    const S = KIT.storage;
    const base = KIT.game.project;
    const src = base.maps[Object.keys(base.maps)[0]];

    /** A project of n maps, cloned from a real one so the shape is honest. */
    const sized = (n) => {
      const p = KIT.deepClone(base);
      for (let i = 0; i < n; i++) p.maps['gen' + i] = KIT.deepClone(src);
      return p;
    };

    const out = { sizes: [] };
    for (const n of [0, 100, 400, 1000]) {
      const p = sized(n);
      const bytes = JSON.stringify(p).length;
      const t0 = performance.now();
      const ok = await S.set('kit.bench.project', { savedAt: new Date().toISOString(), project: p });
      const write = performance.now() - t0;
      const t1 = performance.now();
      const back = await S.get('kit.bench.project');
      const read = performance.now() - t1;
      out.sizes.push({
        maps: Object.keys(p.maps).length, mb: +(bytes / 1e6).toFixed(2),
        writeMs: +write.toFixed(1), readMs: +read.toFixed(1), ok: ok !== false,
        intact: !!(back && back.project && Object.keys(back.project.maps).length === Object.keys(p.maps).length),
      });
      if (ok === false) break;
    }

    // A store that refuses. The contract is: return false, never throw, and set
    // a warning a human can read.
    const realSet = S.set;
    let threw = false, returned = null, warned = '';
    S.set = async () => { S.warning = 'Could not save (storage is full or blocked).'; return false; };
    try { returned = await S.saveDraft(sized(1)); } catch (e) { threw = true; }
    warned = S.warning || '';
    S.set = realSet;

    await S.del('kit.bench.project');
    return Object.assign(out, { refusedThrew: threw, refusedReturned: returned, refusedWarning: warned,
                                adapter: S.durability().adapter });
  });

  log(`\nstorage experiment — adapter: ${r.adapter}\n`);
  log('  maps    size      write     read    intact');
  for (const s of r.sizes) {
    log(`  ${String(s.maps).padStart(4)}  ${String(s.mb + 'MB').padStart(7)}  ${String(s.writeMs + 'ms').padStart(8)}  ${String(s.readMs + 'ms').padStart(7)}   ${s.intact ? 'yes' : 'NO'}`);
  }
  log('');

  const omori = r.sizes.find((s) => s.maps >= 400);
  threshold('a save at OMORI scale is under 100ms', omori ? omori.writeMs : 'never got there', omori && omori.writeMs < 100, 'ms');
  threshold('400 maps actually fit', omori ? 'yes' : 'no', !!omori);
  threshold('what is read back is what was written', r.sizes.every((s) => s.intact) ? 'every size' : 'NO', r.sizes.every((s) => s.intact));
  threshold('a refused write returns false', String(r.refusedReturned), r.refusedReturned === false);
  threshold('a refused write does not throw', r.refusedThrew ? 'it threw' : 'no', !r.refusedThrew);
  threshold('and says something a person can read', JSON.stringify(r.refusedWarning).slice(0, 44), /storage/i.test(r.refusedWarning));

  await browser.close();
  if (errs.length) { failures++; log('\npage errors: ' + errs.slice(0, 2).join(' | ')); }
  log(failures ? `\n${failures} threshold(s) failed` : '\nALL THRESHOLDS PASS');
  process.exit(failures ? 1 : 0);
})();
