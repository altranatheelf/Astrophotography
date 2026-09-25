#!/usr/bin/env node
// tools/new-module.js — scaffold a module.
//
//   node tools/new-module.js jobs --label "Jobs" --describe "Errands your friends can run"
//   node tools/new-module.js weather --into ../games/mill-lane
//
// A module is how you add a system to the engine without editing it: things,
// rules, screens and saved state, in one folder (docs/MODULES.md). This writes
// a working one — a save section, a content slice, a command, a condition, a
// system, a pause-menu entry, a Creator Mode panel, a README and a test — with
// everything in it obviously replaceable. Run its test and it passes; then
// delete the half you do not want and write the half you do.
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const KIT_ROOT = path.resolve(HERE, '..');

// ---- arguments -----------------------------------------------------------------
function parseArgs(argv) {
  const o = { id: null, label: null, describe: null, into: null, help: false, quiet: false };
  const takes = { '--label': 'label', '-l': 'label', '--describe': 'describe', '-d': 'describe', '--into': 'into' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a === '--quiet' || a === '-q') { o.quiet = true; continue; }
    if (takes[a]) { o[takes[a]] = argv[++i]; continue; }
    if (a.startsWith('--')) { o.unknown = a; continue; }
    if (o.id == null) o.id = a;
  }
  return o;
}
const USAGE = [
  'Scaffold a module (docs/MODULES.md).',
  '',
  '  node tools/new-module.js <id> [options]',
  '',
  '    --label <text>      what the Project panel calls it   (default: the id, tidied)',
  '    --describe <text>   one sentence, shown beside it',
  '    --into <dir>        a game folder, instead of this repo',
  '',
  '  node tools/new-module.js jobs --label "Jobs" --describe "Errands your friends can run"',
].join('\n');

/** The shortest way to say where something is: relative when that is shorter, else absolute. */
const show = (p2) => { const r = path.relative(process.cwd(), p2); return (!r || r.startsWith('..')) ? p2 : r; };

const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const camel = (s) => slug(s).replace(/-(\w)/g, (m, c) => c.toUpperCase());
const Pascal = (s) => { const c = camel(s); return c.charAt(0).toUpperCase() + c.slice(1); };
const titleCase = (s) => slug(s).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// ==================================================================================
// The files. Each one is a whole, working, ordinary file — not a stub with TODOs.
// ==================================================================================
function rulesJs(v) {
  return `// ${v.id}/rules — the pure part of the ${v.label} module.
//
// No DOM, no registries, no live world in here: every function is "given this
// save (or this project), what is true?". That is what makes it testable in
// Node (test/${v.id}.test.js) and what keeps register.js honest — register.js is
// only wiring.
//
// What this module owns:
//   save.modules.${v.camel}      { version, total, byKey, seconds }
//   project.packs.${v.camel}     see TUNING below
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const M = KIT.${v.camel} = KIT.${v.camel} || {};

  const isObj = (v2) => !!v2 && typeof v2 === 'object' && !Array.isArray(v2);
  const num = (v2, d) => (Number.isFinite(Number(v2)) ? Number(v2) : d);
  M.VERSION = 1;

  // ---- the save slice --------------------------------------------------------
  /** defaults() -> a fresh ${v.id} section of the save. */
  M.defaults = function () {
    return { version: M.VERSION, total: 0, byKey: {}, seconds: 0 };
  };

  /**
   * Migrations, in the shape the manifest declares. Add one whenever the shape
   * above changes, and old saves keep loading:
   *   { from: 1, to: 2, up(data) { data.newThing = 0; return data; } }
   */
  M.migrations = [];

  /**
   * repair(data) -> the same object, with its shape put right. In place: whoever
   * holds this section keeps holding the right one. The engine calls it after
   * filling and migrating, so an edited save cannot hand you a string where you
   * expect a number.
   */
  M.repair = function (data) {
    data.version = M.VERSION;
    data.total = num(data.total, 0);
    data.byKey = isObj(data.byKey) ? data.byKey : {};
    data.seconds = num(data.seconds, 0);
    return data;
  };

  /**
   * ensure(save) -> this module's section. KIT.modules fills, migrates and
   * repairs it from the save declaration in manifest.js, for a bare save too, so
   * the module works with no world around it. Never throws.
   */
  M.ensure = function (save) {
    if (!isObj(save)) return M.repair(M.defaults());
    return KIT.modules.saveSection(save, '${v.id}');
  };

  // ---- the content slice (project.packs.${v.camel}) --------------------------------
  /** Every number this module turns, as schema fields. The panel forms itself from these. */
  M.TUNING = [
    { key: 'label', type: 'string', default: '${v.label}', label: 'What to call it',
      doc: 'Shown in the pause menu. Change it here, not in the code.' },
    { key: 'step', type: 'number', integer: true, min: 1, max: 100, default: 1, label: 'How much one counts for' },
    { key: 'max', type: 'number', integer: true, min: 1, default: 99, label: 'As high as it goes' },
  ];
  /** contentDefaults() -> project.packs.${v.camel} before the author touches it. */
  M.contentDefaults = () => KIT.schema.defaults(M.TUNING);
  /** tuning(project) -> the pack with every default filled in. */
  M.tuning = (project) => KIT.modules.pack(project, '${v.id}');

  // ---- the rules ----------------------------------------------------------------
  // This is the part that is really yours. Everything above is bookkeeping; what
  // follows is the one thing the module actually knows how to do. Replace it.

  /**
   * add(data, key, n, tuning) -> { total, count, capped }
   * Counts something up, under a name, never past the ceiling.
   */
  M.add = function (data, key, n, tuning) {
    const t = tuning || M.contentDefaults();
    const step = num(n, 1) * num(t.step, 1);
    const name = String(key || 'all');
    const before = num(data.byKey[name], 0);
    const after = Math.max(0, Math.min(num(t.max, 99), before + step));
    data.byKey[name] = after;
    data.total = Object.values(data.byKey).reduce((s, x) => s + num(x, 0), 0);
    return { total: data.total, count: after, capped: before + step !== after };
  };

  /** count(data, key) -> how many under that name (or every name, with no key). */
  M.count = function (data, key) {
    if (!data) return 0;
    if (!key) return num(data.total, 0);
    return num(data.byKey && data.byKey[String(key)], 0);
  };

  /** atLeast(data, key, n) -> the question the condition asks. */
  M.atLeast = function (data, key, n) { return M.count(data, key) >= num(n, 1); };

  /** describe(data, tuning) -> one line for the pause menu. */
  M.describe = function (data, tuning) {
    const t = tuning || M.contentDefaults();
    return M.count(data) + ' / ' + num(t.max, 99);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

function registerJs(v) {
  return `// ${v.id}/register — everything the ${v.label} module puts into the kit's
// registries: the strings, one command, one condition, one per-tick system and
// one pause-menu entry.
//
// No rules live here. rules.js decides; this file wires. manifest.js calls
// KIT.${v.camel}.registerAll(KIT) when the project lists this module.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const M = KIT.${v.camel} = KIT.${v.camel} || {};

  const text = (project, key, vars) => KIT.strings.get(project, key, vars || {});

  // ---- every line this module can say ------------------------------------------
  // House rule: nothing the player reads is written in the code. It goes here,
  // and the Terms panel in Creator Mode can reword all of it.
  M.STRINGS = [
    { id: '${v.id}.menu', default: '${v.label}' },
    { id: '${v.id}.added', default: 'That is {count} now.' },
    { id: '${v.id}.full', default: 'That is as many as it goes.' },
  ];

  let registered = false;

  M.registerAll = function (kit) {
    if (registered) return;
    registered = true;
    const strings = KIT.registry('strings');
    for (const s of M.STRINGS) if (!strings.has(s.id)) strings.add(s);

    // ---- one command --------------------------------------------------------------
    // It shows up in the script editor and in the Screenplay panel as
    //   @${v.camel}Add key=berries count=1
    KIT.registry('commands').add({
      id: '${v.camel}Add', label: 'Count Up (${v.label})', group: '${v.label}', icon: 'flag',
      blocking: false, background: true,
      doc: 'Counts something up under a name. Replace this with whatever your module really does.',
      fields: [
        { key: 'key', type: 'string', default: 'all', doc: 'What is being counted' },
        { key: 'count', type: 'number', integer: true, default: 1 },
        { key: 'notify', type: 'bool', default: false, doc: 'Say so on screen' },
      ],
      async run(ctx, cmd) {
        const save = ctx.save || (ctx.world && ctx.world.save);
        if (!save) return;
        const data = M.ensure(save);
        const tuning = M.tuning(ctx.project);
        const r = M.add(data, cmd.key, cmd.count, tuning);
        if (ctx.emit) ctx.emit('${v.camel}Changed', { key: cmd.key, count: r.count, total: r.total });
        if (cmd.notify && ctx.io && ctx.io.toast) {
          await ctx.io.toast({ text: text(ctx.project, r.capped ? '${v.id}.full' : '${v.id}.added', { count: r.count }) });
        }
      },
      summary(cmd) { return 'Count up ' + (cmd.key || 'all') + ' by ' + (cmd.count == null ? 1 : cmd.count); },
    });

    // ---- one condition ----------------------------------------------------------------
    // Usable anywhere a page or an @if asks a question, and in the \`when:\` text
    // syntax as   ${v.camel}(key=berries, count=3)
    KIT.registry('conditions').add({
      id: '${v.camel}', label: '${v.label} is at least',
      fields: [
        { key: 'key', type: 'string', default: 'all' },
        { key: 'count', type: 'number', integer: true, min: 0, default: 1 },
      ],
      test(cond, ctx) {
        const save = (ctx && ctx.world && ctx.world.save) || (ctx && ctx.save) || {};
        return M.atLeast(M.ensure(save), cond.key, cond.count);
      },
      describe(cond) { return (cond.key || 'all') + ' is at least ' + (cond.count == null ? 1 : cond.count); },
    });

    // ---- one system ----------------------------------------------------------------------
    // Runs every tick, in \`order\`. Keep it cheap: it is called sixty times a second.
    KIT.registry('systems').add({
      id: '${v.id}', order: 60,
      update(world, dt) {
        if (!world || !world.map || world.busy) return;
        const data = M.ensure(world.save);
        data.seconds = (data.seconds || 0) + dt;      // the emptiest possible example: replace it
      },
      onMapEnter(world) {
        M.ensure(world.save);                          // make sure the section exists before anything reads it
      },
    });

    // ---- one pause-menu entry ---------------------------------------------------------------
    KIT.registry('menus').add({
      id: '${v.id}', order: 60,
      // The menus registry validates \`label\` as plain text today, so the reworded
      // string cannot be used here yet; \`labelKey\` is ready for when it can.
      label: '${v.label}', labelKey: '${v.id}.menu',
      when: (game) => !!(game && game.world),
      value: (game) => M.describe(M.ensure(game.world.save), M.tuning(game.project)),
      open(game) {
        // A real module opens a scene here: KIT.scenes.run('${v.id}', { game }).
        if (KIT.toast) KIT.toast(M.describe(M.ensure(game.world.save), M.tuning(game.project)));
      },
    });

    if (typeof M.registerPanel === 'function') M.registerPanel();
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

function panelJs(v) {
  return `// ${v.id}/panel — the "${v.label}" panel in Creator Mode.
// Contract: docs/EDITOR-CONTRACT.md.
//
// Nothing here writes to the project directly: every change goes through
// KIT.editor.commit (refresh + validate + autosave follow it), so undo covers all of it.
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  const M = KIT.${v.camel} = KIT.${v.camel} || {};
  const ED = KIT.editor = KIT.editor || {};
  const UI = KIT.ui;
  if (!UI || typeof document === 'undefined') return;            // headless: nothing to mount

  const make = UI.make;
  /** One undo step; ED.commit repaints, validates and saves after it. */
  const edit = (label, fn) => ED.commit(label, fn);
  function section(title, hint) {
    const box = make('div.ed-sec');
    box.appendChild(make('h4.ed-h4', { text: title }));
    if (hint) box.appendChild(make('p.ed-hint', { text: hint }));
    const body = make('div.ed-sec-body');
    box.appendChild(body);
    box.body = body;
    return box;
  }

  const panel = {
    id: '${v.id}', label: '${v.label}', icon: 'flag', order: 60,

    mount(el, ed) {
      UI.clear(el);
      this.root = make('div.ed-panel-body');
      this.tuneSec = section('The numbers', 'Every dial this module turns. They live in the project, not in the code.');
      this.useSec = section('Where it is used', 'Scripts that call this module\\u2019s command.');
      this.root.appendChild(this.tuneSec);
      this.root.appendChild(this.useSec);
      el.appendChild(this.root);
      this._tune = null;
      this.refresh(ed);
    },

    onSelect(sel, ed) { this.refresh(ed); },

    refresh(ed) {
      if (!this.root) return;
      const st = (ed && ed.state) || ED.state;
      if (!st || !st.project) return;
      this.renderTuning(st);
      this.renderUses(st);
    },

    renderTuning(st) {
      const insp = ED.inspector;
      if (!insp || typeof insp.packForm !== 'function') {
        UI.clear(this.tuneSec.body).appendChild(make('p.ed-hint', { text: 'The inspector is not loaded. The numbers live in project.packs.${v.camel}.' }));
        return;
      }
      this._tune = insp.packForm(this.tuneSec.body, this._tune, {
        project: st.project, fields: M.TUNING,
        value: Object.assign(M.contentDefaults(), st.project.packs && st.project.packs.${v.camel}),
        at: ['packs', '${v.camel}'], label: '${v.label} numbers',
      });
    },

    renderUses(st) {
      const body = UI.clear(this.useSec.body);
      const uses = [];
      KIT.project.walkCommands(st.project, (cmd, where) => {
        if (cmd && cmd.t === '${v.camel}Add') uses.push({ cmd, where });
      });
      if (!uses.length) {
        body.appendChild(make('p.ed-hint', { text: 'Nothing calls @${v.camel}Add yet. Add it to any script from the command picker (group \\u201c${v.label}\\u201d).' }));
        return;
      }
      for (const u of uses) {
        const row = make('div.ed-row');
        row.appendChild(make('span', { text: (u.cmd.key || 'all') + ' +' + (u.cmd.count == null ? 1 : u.cmd.count) }));
        row.appendChild(make('span.ed-hint', { text: (u.where && (u.where.object || u.where.script)) || '' }));
        body.appendChild(row);
      }
    },
  };

  let done = false;
  M.registerPanel = function () {
    if (done) return;
    done = true;
    KIT.registry('editorPanels').add(panel);
  };
  M.PANEL = panel;

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

function manifestJs(v) {
  return `// The ${v.label} module.
//
// ${v.describe}
//
// Turn it on by listing "${v.id}" in project.modules (the Project panel in
// Creator Mode has a checkbox), and load these four files before js/main.js:
//
//   ${v.loadPrefix}/${v.id}/rules.js
//   ${v.loadPrefix}/${v.id}/register.js
//   ${v.loadPrefix}/${v.id}/panel.js
//   ${v.loadPrefix}/${v.id}/manifest.js
//
// See ${v.loadPrefix}/${v.id}/README.md. Rules: rules.js (pure, tested in Node).
(function (root) {
  const KIT = root.KIT = root.KIT || {};
  if (!KIT.${v.camel} || typeof KIT.${v.camel}.registerAll !== 'function') {
    (KIT.log || console).error('[${v.id}] load rules.js and register.js before the manifest');
    return;
  }

  const DEF = {
    id: '${v.id}',
    version: 1,
    label: '${v.label}',
    requires: [],                 // other module ids; boot sorts them and says so loudly if one is missing
    describe: '${v.describeEsc}',

    register(kit) {
      KIT.${v.camel}.registerAll(kit);
    },

    // The slice of the save this module owns: save.modules.${v.camel}. The engine
    // fills it, runs the migrate chain over it and calls repair, every time a
    // world is made -- so this module never has to check.
    save: {
      key: '${v.camel}',   // a plain property name, so code can write save.modules.${v.camel}
      defaults: () => KIT.${v.camel}.defaults(),
      migrate: KIT.${v.camel}.migrations,
      repair: (data) => KIT.${v.camel}.repair(data),
    },

    // The slice of the project this module owns: project.packs.${v.camel}. Because
    // its fields are declared, normalize fills them, validate checks them, and
    // Creator Mode's generic inspector can edit them. (Add at: 'tuning' if you
    // move the numbers inside the pack instead of spreading them across it.)
    content: {
      key: '${v.camel}',   // a plain property name, so code can write save.modules.${v.camel}
      fields: KIT.${v.camel}.TUNING,
      defaults: () => KIT.${v.camel}.contentDefaults(),
    },
  };
  KIT.${v.camel}.MANIFEST = DEF;

  // The module system is the engine's (js/kit/core/modules.js), so KIT.module
  // exists as soon as the kit is on the page — long before this file.
  if (typeof KIT.module !== 'function') {
    (KIT.log || console).error('[${v.id}] KIT.module is missing: the engine is not on the page');
  } else {
    KIT.module(DEF);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

function testJs(v) {
  return `// The ${v.label} module's rules, in Node. Pure functions only — no DOM, no loop.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

${v.testLoad}
const M = KIT.${v.camel};
// Switch it on the way a game does, rather than calling registerAll by hand:
// that is what makes the engine act on the manifest's save and content slices.
KIT.modules.activate({ modules: ['${v.id}'] });

const blankSave = () => ({ version: 2, vars: {}, inventory: {}, objects: {}, overlays: {}, modules: {} });

test('ensure fills the save section and keeps what is already there', () => {
  const save = blankSave();
  const a = M.ensure(save);
  assert.equal(a.version, M.VERSION);
  assert.equal(a.total, 0);
  a.byKey.berries = 3;
  const b = M.ensure(save);
  assert.equal(b.byKey.berries, 3, 'a second call does not wipe it');
  assert.equal(save.modules.${v.camel}, b, 'it lives under save.modules.${v.camel}');
});

test('ensure survives rubbish and never throws', () => {
  const data = M.ensure({ modules: { ${v.camel}: { total: 'lots', byKey: 7, seconds: null } } });
  assert.equal(data.total, 0);
  assert.deepEqual(data.byKey, {});
  assert.equal(data.seconds, 0);
  assert.doesNotThrow(() => M.ensure(null));
});

test('counting up respects the step and the ceiling', () => {
  const data = M.defaults();
  const tuning = Object.assign(M.contentDefaults(), { step: 2, max: 5 });
  assert.deepEqual(M.add(data, 'berries', 1, tuning), { total: 2, count: 2, capped: false });
  assert.deepEqual(M.add(data, 'berries', 1, tuning), { total: 4, count: 4, capped: false });
  const third = M.add(data, 'berries', 1, tuning);
  assert.equal(third.count, 5, 'it stops at the ceiling');
  assert.equal(third.capped, true, 'and says so');
});

test('the total is every name added up', () => {
  const data = M.defaults();
  M.add(data, 'berries', 2);
  M.add(data, 'shells', 3);
  assert.equal(M.count(data, 'berries'), 2);
  assert.equal(M.count(data, 'shells'), 3);
  assert.equal(M.count(data), 5, 'no name means all of them');
  assert.equal(M.count(data, 'nothing'), 0);
});

test('atLeast is the question the condition asks', () => {
  const data = M.defaults();
  assert.equal(M.atLeast(data, 'berries', 1), false);
  M.add(data, 'berries', 1);
  assert.equal(M.atLeast(data, 'berries', 1), true);
  assert.equal(M.atLeast(data, 'berries', 2), false);
});

test('the tuning falls back to its defaults, field by field', () => {
  const defs = M.contentDefaults();
  assert.equal(M.tuning({}).max, defs.max);
  assert.equal(M.tuning({ packs: { ${v.camel}: { max: 7 } } }).max, 7);
  assert.equal(M.tuning({ packs: { ${v.camel}: { max: 7 } } }).step, defs.step, 'the rest still has defaults');
});

test('the command, the condition, the system and the menu entry are registered', () => {
  assert.ok(KIT.commands.get('${v.camel}Add'), 'the command');
  assert.ok(KIT.registry('conditions').get('${v.camel}'), 'the condition');
  assert.ok(KIT.registry('systems').get('${v.id}'), 'the system');
  assert.ok(KIT.registry('menus').get('${v.id}'), 'the menu entry');
  for (const s of M.STRINGS) assert.ok(KIT.registry('strings').has(s.id), s.id + ' is a registered string');
});

test('the condition reads this module\\u2019s save, not a project variable', () => {
  const def = KIT.registry('conditions').get('${v.camel}');
  const save = blankSave();
  assert.equal(def.test({ kind: '${v.camel}', key: 'berries', count: 1 }, { world: { save } }), false);
  M.add(M.ensure(save), 'berries', 1);
  assert.equal(def.test({ kind: '${v.camel}', key: 'berries', count: 1 }, { world: { save } }), true);
});

test('the command writes through the rules and reports the change', async () => {
  const project = KIT.project.normalize({
    version: 3, meta: { id: 'test-${v.id}' }, modules: ['${v.id}'],
    packs: { ${v.camel}: M.contentDefaults() },
  }).project;
  const save = blankSave();
  const events = [];
  const ctx = KIT.interpreter.fakeCtx({ project, save });
  ctx.emit = (name, payload) => events.push({ name, payload });
  await KIT.commands.exec(ctx, { t: '${v.camel}Add', key: 'berries', count: 2, notify: false });
  assert.equal(M.count(M.ensure(save), 'berries'), 2 * M.contentDefaults().step);
  assert.equal(events[0].name, '${v.camel}Changed');
});

test('the manifest declares a save section and a content slice, and sorts', () => {
  const m = M.MANIFEST;
  assert.equal(m.id, '${v.id}');
  assert.equal(m.save.key, '${v.camel}');
  assert.equal(m.content.key, '${v.camel}');
  assert.deepEqual(m.save.defaults(), M.defaults());
  assert.deepEqual(m.content.defaults(), M.contentDefaults());
  const { order, missing, cycles } = KIT.modules.order(['${v.id}']);
  assert.deepEqual(missing, [], 'nothing it needs is absent');
  assert.deepEqual(cycles, [], 'no circles');
  assert.equal(order[order.length - 1].id, '${v.id}', 'it comes after anything it requires');
});

test('the engine acts on those declarations without being asked', () => {
  // The save slice: a world fills it, so this module's code never has to check.
  const project = KIT.project.normalize({ version: 3, meta: { id: 'test-${v.id}' }, modules: ['${v.id}'] }).project;
  const save = blankSave();
  KIT.world.create({ project, save, ports: {} });
  assert.ok(save.modules.${v.camel}, 'the section is there before we ask for it');
  assert.equal(save.modules.${v.camel}.version, M.VERSION);

  // The content slice: normalize fills it, so every number has a value even for
  // an author who never opened this module's panel.
  const defs = M.contentDefaults();
  for (const key of Object.keys(defs)) {
    assert.equal(project.packs.${v.camel}[key], defs[key], key + ' has its default');
  }

  // and validate reports a number that is out of range, in the project's own list
  const wrong = KIT.project.normalize({
    version: 3, meta: { id: 'test-${v.id}' }, modules: ['${v.id}'],
    packs: { ${v.camel}: { max: -1 } },
  }).problems.filter(p => p.code === 'module-content');
  assert.equal(wrong.length, 1, JSON.stringify(wrong));
  assert.match(wrong[0].message, /${v.id}: max/);
});
`;
}

function readmeMd(v) {
  return `# The ${v.label} module

${v.describe}

Turn it on by listing \`"${v.id}"\` in \`project.modules\` (the Project panel in
Creator Mode has a checkbox), and load its four files before \`js/main.js\`:

\`\`\`html
<script src="${v.loadPrefix}/${v.id}/rules.js"></script>
<script src="${v.loadPrefix}/${v.id}/register.js"></script>
<script src="${v.loadPrefix}/${v.id}/panel.js"></script>
<script src="${v.loadPrefix}/${v.id}/manifest.js"></script>
\`\`\`

A module that is loaded but not listed registers nothing at all.

## What is in here

| file | what it is |
|---|---|
| \`rules.js\` | the rules, as pure functions. No DOM, no registries, no world. This is the part that is really yours. |
| \`register.js\` | the wiring: strings, one command, one condition, one system, one menu entry. |
| \`panel.js\` | the Creator Mode panel. Browser only; it does nothing headless. |
| \`manifest.js\` | \`KIT.module({...})\` — the id, the save section and the content slice. |
| \`${v.testPath}\` | the test. \`${v.testCmd}\` |

## What it does right now

It counts things. \`@${v.camel}Add key=berries count=1\` counts one up under the
name "berries", never past the ceiling; the condition \`${v.camel}(key=berries,
count=3)\` asks whether there are three; the pause menu shows the total; the
Creator Mode panel edits the ceiling and lists every script that counts up.

That is a placeholder, and it is meant to be deleted. It is here so that the
wiring around it is real and tested — so you can see exactly where your rule
goes, what a registered string looks like, how a save section is migrated, and
how a panel writes to the project without breaking undo.

## What it owns

\`\`\`js
save.modules.${v.camel} = { version: 1, total: 0, byKey: {}, seconds: 0 }
project.packs.${v.camel} = { label, step, max }
\`\`\`

Nothing else. Runtime state goes in the save section you declared; content goes
in \`project.packs.${v.camel}\`; everything a player reads is a registered string, so
the Terms panel can reword it.

## Where to start

1. **Delete the counter.** \`M.add\` / \`M.count\` / \`M.atLeast\` in \`rules.js\` and
   the command and condition in \`register.js\` that call them.
2. **Write your rule** as a pure function of the save and the project, and a
   test beside it.
3. **Wire it**: a command if a script should do it, a condition if a page should
   ask about it, a system if it happens by itself, a scene if it needs a screen,
   an object type if it goes on a map.
4. **Register every line of text** in \`M.STRINGS\`.
5. **Version the save.** If the shape changes, add a migration and old saves
   keep loading.

The whole contract is in \`docs/MODULES.md\`.
`;
}

// ==================================================================================
function main(argv) {
  const opts = parseArgs(argv);
  const say = (...a) => { if (!opts.quiet) console.log(...a); };
  if (opts.help || !opts.id) { console.log(USAGE); return opts.id ? 0 : (opts.help ? 0 : 2); }
  if (opts.unknown) { console.error(`I do not know the option ${opts.unknown}.\n`); console.log(USAGE); return 2; }

  const id = slug(opts.id);
  if (!id) { console.error('That is not a name I can make a folder out of.'); return 2; }
  if (!/^[a-z][a-z0-9-]*$/.test(id)) { console.error(`A module id has to start with a letter: “${id}” does not.`); return 2; }

  // Where does it go? A game folder keeps its modules in modules/; the repo in js/modules/.
  const inGame = !!opts.into;
  const base = inGame ? path.resolve(process.cwd(), opts.into) : KIT_ROOT;
  // A repo keeps its modules under js/modules; a packed kit keeps them under
  // modules/. (Spelt in pieces, because pack-kit rewrites that path.)
  const repoModules = path.join(base, 'js', 'modules');
  const moduleRoot = inGame ? path.join(base, 'modules')
    : (fs.existsSync(repoModules) || !fs.existsSync(path.join(base, 'modules')) ? repoModules : path.join(base, 'modules'));
  const testRoot = inGame ? path.join(base, 'test') : path.join(base, 'test', 'modules');
  const dir = path.join(moduleRoot, id);

  if (fs.existsSync(dir)) {
    console.error([
      `There is already a module at ${show(dir)}, so I have not touched it.`,
      'Pick another id, or move that folder out of the way first.',
    ].join('\n'));
    return 1;
  }

  const label = opts.label || titleCase(id);
  const describe = opts.describe || `What ${label} adds to the game. Say it in one sentence.`;
  const testFile = path.join(testRoot, id + '.test.js');
  const loadPrefix = path.relative(base, moduleRoot).split(path.sep).join('/');
  const v = {
    id, camel: camel(id), Pascal: Pascal(id), label,
    describe,
    describeEsc: describe.replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
    loadPrefix,
    testPath: path.relative(base, testFile).split(path.sep).join('/'),
    testCmd: inGame ? `node --test ${path.relative(base, testFile).split(path.sep).join('/')}` : `npm test`,
    testLoad: inGame
      ? [
        "const GAME = path.join(__dirname, '..');",
        "const KIT = require(path.join(GAME, 'tools/kit-node.js'));",
        `for (const f of ['rules', 'register', 'panel', 'manifest']) require(path.join(GAME, 'modules/${id}/' + f + '.js'));`,
      ].join('\n')
      : [
        "const ROOT = path.join(__dirname, '..', '..');",
        "const KIT = require(path.join(ROOT, 'test/kit/_load.js'));",
        "for (const f of ['map', 'entities', 'world']) require(path.join(ROOT, 'js/kit/world', f + '.js'));",
        `for (const f of ['rules', 'register', 'panel', 'manifest']) require(path.join(ROOT, '${loadPrefix}', '${id}', f + '.js'));`,
      ].join('\n'),
  };

  const written = [];
  const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); written.push(file); };
  put(path.join(dir, 'rules.js'), rulesJs(v));
  put(path.join(dir, 'register.js'), registerJs(v));
  put(path.join(dir, 'panel.js'), panelJs(v));
  put(path.join(dir, 'manifest.js'), manifestJs(v));
  put(path.join(dir, 'README.md'), readmeMd(v));
  put(testFile, testJs(v));

  for (const f of written) say(`  wrote ${show(f)}`);
  say('');
  say(`The ${label} module is there and it works. Next:`);
  say(`  1. run its test:        ${inGame ? 'cd ' + show(base) + ' && ' : ''}${v.testCmd}`);
  say(`  2. load its four files in index.html, before js/main.js`);
  say(`  3. add "${id}" to project.modules (or tick it in the Project panel)`);
  say(`  4. read ${show(path.join(dir, 'README.md'))} — it says what to delete first`);
  return 0;
}

module.exports = { main, parseArgs, slug, camel };
if (require.main === module) process.exit(main(process.argv.slice(2)));
