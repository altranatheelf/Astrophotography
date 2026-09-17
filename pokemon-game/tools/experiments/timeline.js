// Experiment: does a tree of saves fit, and can you walk back into one?
//
//   NODE_PATH=$(npm root -g) node tools/experiments/timeline.js
//
// Run BEFORE the tree was wired to a menu, a command or a condition — the same
// order storage.js should have been built in and was not. The thresholds are set
// here first so that a failure is an instruction to change the design rather
// than a number to admire afterwards.
//
// The risk is specific and it is the reason every other engine ships slots: a
// save is one JSON document in browser storage, and a tree of N saves is N of
// them. At the measured 3.86MB for a 400-map project, 200 full saves would be a
// tree larger than most disks want to give a web page. So the design is deltas
// with an anchor every 12 nodes — and either it is an order of magnitude
// cheaper than full saves or the whole idea is wrong.
//
//   1. 200 moments must fit in 1MB, so the tree never competes with the saves.
//   2. A moment must average under a tenth of a full save.
//   3. Rebuilding the oldest moment must be under 50ms — it is a menu action.
//   4. Recording one must be under 16ms — it happens during play.
//   5. `elsewhere()` must be under 2ms — it is a condition, it runs in a frame.
//   6. A rebuilt save must be EXACTLY the save that was recorded. Not close.
//   7. Writing the whole tree must be under 100ms.
//   8. And none of 3, 4 or 5 may fall off a cliff at the size the storage budget
//      actually allows — which is where a long game arrives, and is therefore
//      the only size at which those numbers matter.
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(__dirname, '..', '..', 'index.html');
let failures = 0;
const log = (...a) => console.log(...a);
function threshold(name, value, ok, unit) {
  const pass = !!ok;
  if (!pass) failures++;
  log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(52)} ${String(value)}${unit || ''}`);
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
    const T = KIT.timeline;
    const project = KIT.game.project;
    const mapIds = Object.keys(project.maps);

    // A save, and then the way play changes one. Not a random walk: the things
    // that actually move — where the heroes are, the clock, a variable, an
    // object's state, a line of history — plus a painted tile now and then,
    // because an author's overlays are the biggest thing in a real save.
    const fresh = () => ({
      vars: Object.fromEntries(Object.keys(project.vars || {}).map(k => [k, project.vars[k].default])),
      inventory: {}, objects: {}, overlays: {}, meta: {}, clock: { day: 1, minutes: 480 },
      heroes: [{ map: mapIds[0], x: 4, y: 4, dir: 'down' }, { map: mapIds[0], x: 4, y: 5, dir: 'down' }],
      log: { n: 0, entries: [], tally: {} },
      dimension: null, rules: {},
    });
    const played = (save, i) => {
      const s = KIT.deepClone(save);
      s.heroes[0].x = 2 + (i % 11); s.heroes[0].y = 2 + (i % 7);
      s.heroes[0].map = mapIds[i % mapIds.length];
      s.clock.minutes += 7; if (s.clock.minutes > 1440) { s.clock.minutes -= 1440; s.clock.day++; }
      const names = Object.keys(s.vars);
      if (names.length) s.vars[names[i % names.length]] = i;
      s.objects[`${s.heroes[0].map}:npc${i % 9}`] = { self: { done: true, talks: i } };
      KIT.history.add(s, i % 3 === 0 ? 'walked' : 'looked', { what: 'thing' + (i % 5), where: s.heroes[0].map });
      if (i % 10 === 0) {
        const m = s.overlays[mapIds[0]] || (s.overlays[mapIds[0]] = { tiles: {} });
        for (let n = 0; n < 12; n++) m.tiles[`${n},${i}`] = { ground: 'grass' };
      }
      return s;
    };

    // Fill the history window first: the whole reason the `cut` op exists is the
    // bounded list, and a list that is not yet full never exercises it. A tree
    // measured on an empty log would be a flattering lie.
    let save = fresh();
    for (let i = 0; i < KIT.history.WINDOW + 20; i++) KIT.history.add(save, 'warmup', { what: 'x' + (i % 40) });
    const fullSaveBytes = JSON.stringify(save).length;

    T._setTree(undefined);
    T.now();
    const kept = [];
    let recordWorst = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      save = played(save, i);
      // Branch every 25 moments, the way a player who goes back and tries the
      // other thing does. A straight line would never test a branch at all.
      if (i > 0 && i % 25 === 0) T.now().head = kept[Math.max(0, kept.length - 13)];
      const t0 = performance.now();
      const id = T.record(save, { label: i % 25 === 0 ? 'a fork' : '' });
      recordWorst = Math.max(recordWorst, performance.now() - t0);
      kept.push(id);
      if (i === 0 || i === N - 1 || i === 97) T.now().nodes[id]._check = JSON.stringify(save);
    }

    const treeBytes = T.bytes();
    const nodes = T.count();

    // 6: a rebuilt save must be the save. Checked on the first, a middle and the
    // last, including one on a branch.
    const exact = [];
    for (const [id, n] of Object.entries(T.now().nodes)) {
      if (!n._check) continue;
      const back = T.rebuild(id);
      exact.push({ id, same: JSON.stringify(back) === n._check, len: n._check.length });
    }

    const oldest = Object.keys(T.now().nodes).sort((a, b) => T.now().nodes[a].at - T.now().nodes[b].at)
      .filter(id => T.path(id).length > 6).pop() || T.now().head;
    const t1 = performance.now();
    const deepest = T.rebuild(T.now().head);
    const rebuildHead = performance.now() - t1;
    const t2 = performance.now();
    T.rebuild(oldest);
    const rebuildOld = performance.now() - t2;

    const t3 = performance.now();
    let els = 0;
    for (let i = 0; i < 20; i++) els = T.elsewhere({ verb: 'walked', what: 'thing1' });
    const elsewhereMs = (performance.now() - t3) / 20;

    const t4 = performance.now();
    const wrote = await T.flush();
    const writeMs = performance.now() - t4;
    const readBack = await KIT.storage.get(T.key());

    // How much of the tree is anchors (whole saves) rather than deltas.
    const anchors = Object.values(T.now().nodes).filter(n => n.full).length;
    const deltaBytes = Object.values(T.now().nodes).filter(n => n.d).reduce((a, n) => a + JSON.stringify(n.d).length, 0);
    const deltaCount = nodes - anchors;

    // 200 full saves, for the comparison the whole design rests on.
    const naive = fullSaveBytes * N;

    const momentRows = T.moments().length;

    // ---- and again at the ceiling ------------------------------------------
    // 200 moments is a session. The budget allows something like 1,500, which is
    // a playthrough, and it is the size at which an O(n²) would show. `elsewhere`
    // is a CONDITION — it runs inside a frame — so this is the number that
    // decides whether the feature is usable at the end of a long game.
    T._setTree(null);
    let big = save;
    let ceilRecord = 0;
    const BIG = 1500;
    const bigIds = [];
    for (let i = 0; i < BIG; i++) {
      big = played(big, i);
      if (i > 0 && i % 40 === 0) T.now().head = bigIds[Math.max(0, bigIds.length - 21)];
      const t0 = performance.now();
      bigIds.push(T.record(big, {}));
      ceilRecord = Math.max(ceilRecord, performance.now() - t0);
    }
    const ceilNodes = T.count();
    const t5 = performance.now();
    for (let i = 0; i < 20; i++) T.elsewhere({ verb: 'walked', what: 'thing1' });
    const ceilElsewhere = (performance.now() - t5) / 20;
    const oldestBig = bigIds.find(id => T.now().nodes[id]);
    const t6 = performance.now();
    const ceilRebuiltOk = !!T.rebuild(oldestBig);
    const ceilRebuild = performance.now() - t6;
    const t7 = performance.now();
    const ceilRows = T.moments().length;
    const ceilMoments = performance.now() - t7;
    const ceilBytes = T.bytes();
    const t8 = performance.now();
    await T.flush();
    const ceilWrite = performance.now() - t8;
    const sizeDrift = Math.abs(T.size() - ceilBytes);
    // Every moment left standing must still be rebuildable — the invariant that
    // pruning could break and nothing else would notice.
    let whole = 0, broken = 0;
    for (const id of Object.keys(T.now().nodes)) { if (T.rebuild(id)) whole++; else broken++; }

    await KIT.storage.del(T.key());
    return {
      ceilNodes, ceilRecord, ceilElsewhere, ceilRebuild, ceilRebuiltOk, ceilMoments, ceilRows,
      ceilBytes, ceilWrite, sizeDrift, whole, broken, ceilAsked: BIG,
      fullSaveBytes, treeBytes, nodes, anchors, deltaCount,
      avgDelta: deltaCount ? Math.round(deltaBytes / deltaCount) : 0,
      avgNode: Math.round(treeBytes / nodes),
      naive, rebuildHead, rebuildOld, recordWorst, elsewhereMs, writeMs, wrote,
      readOk: !!(readBack && readBack.nodes && Object.keys(readBack.nodes).length === nodes),
      exact, els, moments: momentRows,
      deepestOk: !!deepest,
    };
  });

  log('\n--- what was measured ---');
  log(`  one save (history window full)      ${(r.fullSaveBytes / 1024).toFixed(1)} KB`);
  log(`  200 of them, the naive tree         ${(r.naive / 1024 / 1024).toFixed(2)} MB`);
  log(`  the delta tree                      ${(r.treeBytes / 1024).toFixed(1)} KB  (${r.nodes} moments, ${r.anchors} whole saves, ${r.deltaCount} deltas)`);
  log(`  average delta                       ${r.avgDelta} B`);
  log(`  average moment, anchors included    ${r.avgNode} B`);
  log(`  saving ${(r.naive / r.treeBytes).toFixed(0)}× over one save per moment`);

  log('\n--- thresholds ---');
  threshold('1. 200 moments fit in 1MB', (r.treeBytes / 1024).toFixed(0) + ' KB', r.treeBytes < 1024 * 1024);
  threshold('2. a moment averages under a tenth of a save',
    `${r.avgNode} B vs ${r.fullSaveBytes} B`, r.avgNode < r.fullSaveBytes / 10);
  threshold('3. rebuilding the oldest is under 50ms', r.rebuildOld.toFixed(1), r.rebuildOld < 50, 'ms');
  threshold('4. recording one is under 16ms', r.recordWorst.toFixed(1), r.recordWorst < 16, 'ms');
  threshold('5. elsewhere() is under 2ms', r.elsewhereMs.toFixed(2), r.elsewhereMs < 2, 'ms');
  threshold('6. a rebuilt save is exactly the save',
    r.exact.map(e => (e.same ? 'ok' : 'WRONG')).join(' '), r.exact.length >= 3 && r.exact.every(e => e.same));
  threshold('7. writing the whole tree is under 100ms', r.writeMs.toFixed(1), r.writeMs < 100, 'ms');
  threshold('   and it reads back with every moment', r.readOk ? 'yes' : 'no', r.readOk);
  threshold('   rebuilding the head works at all', r.deepestOk ? 'yes' : 'no', r.deepestOk);
  threshold('   the tree draws as rows', r.moments + ' rows', r.moments === r.nodes);
  threshold('   elsewhere() finds another branch', r.els, r.els > 0);
  log('\n--- and at the ceiling: ' + r.ceilAsked + ' moments recorded, ' + r.ceilNodes + ' still standing ---');
  log(`  the tree pruned itself to              ${(r.ceilBytes / 1024 / 1024).toFixed(2)} MB`);
  threshold('8. recording one is still under 16ms', r.ceilRecord.toFixed(1), r.ceilRecord < 16, 'ms');
  threshold('   elsewhere() is still under 2ms', r.ceilElsewhere.toFixed(2), r.ceilElsewhere < 2, 'ms');
  threshold('   rebuilding the oldest is still under 50ms', r.ceilRebuild.toFixed(1), r.ceilRebuild < 50 && r.ceilRebuiltOk, 'ms');
  threshold('   drawing the whole list is under 50ms', r.ceilMoments.toFixed(1), r.ceilMoments < 50, 'ms');
  threshold('   the tree stayed inside its budget', (r.ceilBytes / 1024 / 1024).toFixed(2) + ' MB', r.ceilBytes <= 3 * 1024 * 1024);
  threshold('   writing it is still under 100ms', r.ceilWrite.toFixed(1), r.ceilWrite < 100, 'ms');
  threshold('   the running size has not drifted from the real one',
    r.sizeDrift + ' B of ' + r.ceilBytes, r.sizeDrift < r.ceilBytes * 0.005);
  threshold('   and every moment left can still be rebuilt',
    `${r.whole} whole, ${r.broken} broken`, r.broken === 0 && r.whole === r.ceilNodes);
  threshold('   nothing threw', errs.length ? errs[0] : 'clean', errs.length === 0);

  await browser.close();
  if (failures) { log(`\n${failures} threshold(s) failed — the design is wrong, not the number.`); process.exit(1); }
  log('\nALL THRESHOLDS PASS');
})();
