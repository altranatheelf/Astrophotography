// Experiment: what does one frame actually cost, and where does it go?
//
//   NODE_PATH=$(npm root -g) node tools/experiments/frame.js
//
// Every frame-rate number in docs/AGAINST-THE-INDUSTRY.md — 1600 characters at
// 60fps, 3000 markers at 60fps, 128 lights at 32.5 — was measured once, by hand,
// and the harness was thrown away. So each of them is a claim about a version of
// the engine that no longer exists, and a regression in any of them is invisible
// until somebody goes looking. That is the same failure as a stale test count in
// a document, one layer down.
//
// This keeps the measurement. It drives the fixed-step loop by hand
// (`KIT.game.tick`), so there is no requestAnimationFrame jitter in the number,
// and it wraps each system on the world so the frame is broken down rather than
// reported as one figure you cannot act on.
//
// The thresholds are the budget at 60fps: 16.7ms for everything. A frame that
// spends more than half of it in one system is the thing worth knowing.
//
// READ THE NUMBERS AS A TREND, NOT AS A GRADE. They are this machine, this
// viewport (960x720 at dpr 1) and this browser; a phone at dpr 3 is a different
// number and the old hand-measured fps figures were taken somewhere else again.
// What the harness is FOR is the day one of them doubles.
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(__dirname, '..', '..', 'index.html');
let failures = 0;
const log = (...a) => console.log(...a);
function threshold(name, value, ok, unit) {
  const pass = !!ok;
  if (!pass) failures++;
  log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(50)} ${String(value)}${unit || ''}`);
  return pass;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(PAGE + '?fast=1');
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted, { timeout: 30000 });
  // Into the world, past the title.
  await page.evaluate(() => { const b = document.querySelector('[data-action="new-game"]'); if (b) b.click(); });
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => KIT.game.scene() === 'map' && !!KIT.game.world && !KIT.interpreter.mainBusy())) break;
    await page.keyboard.press('z');
    await page.waitForTimeout(140);
  }

  const r = await page.evaluate(async () => {
    const G = KIT.game;
    const world = G.world;
    const out = { loads: [] };

    // Wrap each system once, so a load can be attributed rather than guessed at.
    const spent = {};
    for (const s of world.systems) {
      if (typeof s.update !== 'function' || s._wrapped) continue;
      const orig = s.update;
      s._wrapped = true;
      s.update = function (w, dt) {
        const t0 = performance.now();
        try { return orig.call(this, w, dt); }
        finally { spent[s.id] = (spent[s.id] || 0) + (performance.now() - t0); }
      };
    }

    const baseEntities = world.entities.length;
    const baseMarkers = world.markers.length;

    /** Fill the map with wandering, drawn characters, the way the old benchmark did. */
    function crowd(n) {
      world.entities.length = baseEntities;
      const view = world.map;
      for (let i = 0; i < n; i++) {
        const e = KIT.entities.create({
          id: 'bench' + i, kind: 'npc',
          x: i % view.width, y: Math.floor(i / view.width) % view.height,
          sprite: 'woman', speed: 4, solid: false,
          behaviour: { kind: 'wander', radius: 3, frequency: 6 },
        });
        world.entities.push(e);
      }
    }
    function markers(n) {
      world.markers.length = baseMarkers;
      for (let i = 0; i < n; i++) world.markers.push({ x: i % 40, y: Math.floor(i / 40) % 30, kind: 'tint', color: '#ff00aa', alpha: 0.5 });
    }

    /** ms per frame, driving the fixed step by hand so there is no rAF jitter. */
    function measure(label, frames) {
      for (const k of Object.keys(spent)) delete spent[k];
      KIT.renderer.profile = {};
      for (let i = 0; i < 10; i++) G.tick(16);            // warm the caches this load needs
      for (const k of Object.keys(spent)) delete spent[k];
      KIT.renderer.profile = {};
      const n = frames || 60;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) G.tick(16);
      const total = (performance.now() - t0) / n;
      const systems = {};
      let sys = 0;
      for (const k of Object.keys(spent)) { systems[k] = spent[k] / n; sys += spent[k] / n; }
      // The renderer's own breakdown, by phase (KIT.renderer.profile).
      const draw = {};
      for (const [k, v] of Object.entries(KIT.renderer.profile)) draw[k] = v / n;
      KIT.renderer.profile = null;
      return {
        label, total, systems: sys, rest: total - sys, draw,
        worst: Object.entries(systems).sort((a, b) => b[1] - a[1]).slice(0, 4)
          .map(([k, v]) => ({ id: k, ms: v })),
        entities: world.entities.length, markers: world.markers.length,
      };
    }

    out.loads.push(measure('an empty room'));
    for (const n of [200, 800, 1600]) { crowd(n); out.loads.push(measure(`${n} characters`)); }
    crowd(0);
    markers(3000); out.loads.push(measure('3000 markers'));
    markers(0);

    // Light is the one that was measured worst (128 lights: 11fps -> 32.5).
    //
    // A light is not a thing you hand the renderer: `A.lights(world)` gathers
    // them from ENTITIES carrying `data.light`. The first version of this set
    // `world.lights = [...]`, which nothing reads, and measured 0.14ms — exactly
    // an empty room, and a threshold that passed because the test did nothing.
    // `check` below is what stops that happening again.
    if (KIT.atmosphere) {
      world.entities.length = baseEntities;
      for (let i = 0; i < 128; i++) {
        const e = KIT.entities.create({ id: 'lamp' + i, kind: 'npc', x: (i % 16) * 2, y: Math.floor(i / 16) * 2, sprite: 'woman', solid: false });
        e.data.light = { radius: 3, color: '#ffdca8', softness: 0.45 };
        world.entities.push(e);
      }
      KIT.atmosphere.set({ darkness: 0.85 }, { ms: 0 });
      const lit = measure('128 lights, darkness 0.85', 30);
      // The measurement has to be able to prove it measured something.
      lit.check = { lights: KIT.atmosphere.lights(world).length, darkness: KIT.atmosphere.state().darkness };
      out.loads.push(lit);
      world.entities.length = baseEntities;
      KIT.atmosphere.set({ darkness: 0 }, { ms: 0 });
    }

    // What the caches are holding after all that.
    out.cache = G.renderer && G.renderer.cacheStats ? G.renderer.cacheStats() : null;
    out.heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
    return out;
  });

  log('\n--- one frame, by load ---');
  log('  ' + 'load'.padEnd(28) + 'total'.padStart(9) + 'systems'.padStart(10) + 'draw+rest'.padStart(11) + '   worst system');
  for (const l of r.loads) {
    log('  ' + l.label.padEnd(28)
      + (l.total.toFixed(2) + 'ms').padStart(9)
      + (l.systems.toFixed(2) + 'ms').padStart(10)
      + (l.rest.toFixed(2) + 'ms').padStart(11)
      + '   ' + l.worst.map((w) => `${w.id} ${w.ms.toFixed(2)}`).join(', '));
  }
  log('\n--- and where the drawing went (KIT.renderer.profile), ms per frame ---');
  const phases = ['tiles', 'sort', 'entities', 'markers', 'atmosphere', 'scenes', 'overlays'];
  log('  ' + 'load'.padEnd(28) + phases.map((p) => p.padStart(11)).join(''));
  for (const l of r.loads) {
    log('  ' + l.label.padEnd(28) + phases.map((p) => ((l.draw[p] || 0).toFixed(2)).padStart(11)).join(''));
  }
  if (r.cache) log(`\n  tile cache: ${JSON.stringify(r.cache)}`);
  if (r.heap) log(`  heap: ${r.heap} MB`);

  log('\n--- thresholds (16.7ms is the whole frame at 60fps) ---');
  const by = (name) => r.loads.find((l) => l.label === name) || { total: Infinity, systems: Infinity, rest: Infinity, worst: [] };
  threshold('an empty room is nearly free', by('an empty room').total.toFixed(2), by('an empty room').total < 4, 'ms');
  threshold('200 characters inside the budget', by('200 characters').total.toFixed(2), by('200 characters').total < 16.7, 'ms');
  threshold('800 characters inside the budget', by('800 characters').total.toFixed(2), by('800 characters').total < 16.7, 'ms');
  threshold('1600 characters inside the budget', by('1600 characters').total.toFixed(2), by('1600 characters').total < 16.7, 'ms');
  threshold('3000 markers inside the budget', by('3000 markers').total.toFixed(2), by('3000 markers').total < 16.7, 'ms');
  const crowded = by('1600 characters');
  const worst = crowded.worst[0] || { id: '—', ms: 0 };
  threshold('no single system eats half the frame', `${worst.id} ${worst.ms.toFixed(2)}ms`, worst.ms < 8.35, '');
  // The sort-and-split before drawing characters should be a rounding error next
  // to drawing them: it is bookkeeping, and the characters move a fraction of a
  // tile per frame so the order barely changes.
  const sortShare = crowded.draw.sort / Math.max(0.001, crowded.draw.entities);
  threshold('sorting 1600 characters is a rounding error next to drawing them',
    `sort ${crowded.draw.sort.toFixed(2)}ms vs draw ${crowded.draw.entities.toFixed(2)}ms`, sortShare < 0.1);
  const marked = by('3000 markers');
  threshold('3000 markers are drawn once, not once per layer',
    `${marked.draw.markers.toFixed(2)}ms`, marked.draw.markers < 4);
  // Cost must grow with the work, not faster than it. Doubling the crowd may
  // cost more than double once — this catches the day it costs four times.
  const a = by('200 characters').total, b = by('800 characters').total, c = by('1600 characters').total;
  threshold('cost grows with the crowd, not faster', `200→800 ×${(b / a).toFixed(1)}, 800→1600 ×${(c / b).toFixed(1)}`,
    b / a < 6 && c / b < 3);
  const lit = r.loads.find((l) => l.label.startsWith('128 lights'));
  if (lit) {
    // Proof of work before the number: a light benchmark that lit nothing
    // measured 0.14ms and passed, which is worse than no benchmark at all.
    threshold('the lights were actually lit', JSON.stringify(lit.check),
      !!lit.check && lit.check.lights === 128 && lit.check.darkness > 0.8);
    threshold('128 lights stay above 30fps', lit.total.toFixed(2), lit.total < 33, 'ms');
  }
  threshold('nothing threw', errs.length ? errs[0] : 'clean', errs.length === 0);

  await browser.close();
  if (failures) { log(`\n${failures} threshold(s) failed`); process.exit(1); }
  log('\nALL THRESHOLDS PASS');
})();
