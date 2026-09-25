'use strict';
// THE LOOK: what the game looks and sounds like, as data (js/kit/core/look.js).
//
// The first promise is the one everything else stands on: a game that never
// touched its look is the game it was. css/kit.css now reads its colours
// through `var(--kit-*, <the old literal>)`, so the literal after the comma and
// the token table here are two copies of the same fact, and this file is what
// stops them drifting. e2e/look.js makes the same promise in a browser, with
// the computed styles themselves.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const KIT = require('./_load.js');
const ROOT = path.join(__dirname, '..', '..');
const R = (f) => require(path.join(ROOT, f));
R('js/kit/scenes/stack.js'); R('js/kit/ui/parts.js'); R('js/kit/scenes/menu.js');
const L = KIT.look;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/** The stylesheet without its comments, which describe the rule in the same words as the rule. */
const stylesheet = () => read('css/kit.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `var(--kit-name, fallback)` in a stylesheet, nested ones included, fallback whitespace-normalised. */
function vars(css) {
  const out = [];
  let at = 0;
  for (;;) {
    const i = css.indexOf('var(--kit-', at);
    if (i < 0) return out;
    const comma = css.indexOf(',', i);
    const close = css.indexOf(')', i);
    const name = css.slice(i + 4, Math.min(comma < 0 ? Infinity : comma, close)).trim();
    if (comma < 0 || close < comma) { out.push({ name, fallback: null }); at = i + 4; continue; }
    let depth = 0, j = comma + 1;
    for (; j < css.length; j++) {
      if (css[j] === '(') depth++;
      else if (css[j] === ')') { if (depth === 0) break; depth--; }
    }
    out.push({ name, fallback: css.slice(comma + 1, j).replace(/\s+/g, ' ').trim() });
    at = i + 4;
  }
}
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

// Custom properties css/kit.css reads that are not tokens, each with why. The
// first three are set by a part's option rather than a colour (the cursor's
// size, a boxy toast, square A and B); --kit-fx is a text effect's strength,
// set on each run by js/kit/scenes/dialogue.js.
const NOT_TOKENS = { '--kit-cursor-size': '11px', '--kit-toast-radius': '999px', '--kit-pad-ab-radius': '50%', '--kit-fx': '1' };
// Tokens that were custom properties on :root before there were looks; a look
// sets them on #stage, and the stylesheet keeps reading them as it always did.
const ON_ROOT = ['--paper', '--ink', '--font-ui', '--accent', '--accent-2'];

test('look: every var(--kit-*) in css/kit.css is a token, with the token\'s fallback', () => {
  const css = stylesheet();
  const found = vars(css);
  assert.ok(found.length >= 40, `kit.css reads the look (${found.length} vars)`);
  const byCss = new Map(L.TOKENS.filter(t => t.css).map(t => [t.css, t]));
  const wrong = [];
  for (const v of found) {
    if (v.fallback === null) { wrong.push(`${v.name} has no fallback, so with no look it is nothing`); continue; }
    if (NOT_TOKENS[v.name] !== undefined) {
      if (v.fallback !== NOT_TOKENS[v.name]) wrong.push(`${v.name}: kit.css says ${v.fallback}, expected ${NOT_TOKENS[v.name]}`);
      continue;
    }
    const t = byCss.get(v.name);
    if (!t) { wrong.push(`${v.name} is read by kit.css and is no token`); continue; }
    if (norm(t.fallback) !== v.fallback) wrong.push(`${v.name}: kit.css falls back to "${v.fallback}", the token says "${t.fallback}"`);
  }
  assert.deepEqual(wrong, []);
});

test('look: every token lands somewhere in css/kit.css', () => {
  const css = stylesheet();
  const root = /:root\s*\{([\s\S]*?)\}/.exec(css)[1];
  const read1 = new Set(vars(css).map(v => v.name));
  const missing = [];
  for (const t of L.TOKENS) {
    if (!t.css) continue;
    if (ON_ROOT.includes(t.css)) {
      const m = new RegExp(t.css.replace(/[-]/g, '\\-') + ':\\s*([^;]+);').exec(root);
      if (!m) missing.push(`${t.css} is not on :root`);
      else if (norm(m[1]) !== norm(t.fallback)) missing.push(`${t.css}: :root says "${norm(m[1])}", the token says "${t.fallback}"`);
      continue;
    }
    if (!read1.has(t.css)) missing.push(`${t.key} (${t.css}) is compiled but kit.css never reads it`);
  }
  assert.deepEqual(missing, []);
});

test('look: the kit look compiles to nothing', () => {
  assert.equal(L.compile(L.resolve(KIT.project.blank())), '', 'a new game\'s project');
  assert.equal(L.css(KIT.project.blank()), '');
  assert.equal(L.compile(L.resolve({ ui: {} })), '');
  assert.equal(L.compile(L.resolve({ ui: { base: 'kit' } })), '');
  assert.equal(L.compile(L.resolve(null)), '', 'no project at all is the kit look too');
  // A value that happens to equal the kit's own is not a change either.
  assert.equal(L.compile(L.resolve({ ui: { tokens: { paper: '#fdfdfb', frameWidth: 3 } } })), '');
});

test('look: a change is one custom property on #stage, and only that', () => {
  const css = L.compile(L.resolve({ ui: { tokens: { paper: '#000000', frameWidth: 4 } } }));
  assert.equal(css, '#stage{--paper:#000000;--kit-frame-w:4px}');
  assert.equal(css, L.compile(L.resolve({ ui: { tokens: { paper: '#000000', frameWidth: 4 } } })), 'the same look, the same text');
  // Two tokens make one colour: the dim behind a message is its colour and its amount.
  assert.equal(L.compile(L.resolve({ ui: { tokens: { dimAmount: 0.8 } } })), '#stage{--kit-dim:rgba(8,9,15,0.8)}');
  // An ink that follows the accent until it is given its own.
  assert.equal(L.compile(L.resolve({ ui: { tokens: { nameInk: '#ff0000' } } })), '#stage{--kit-name-ink:#ff0000}');
  // "No rim" is a colour of its own: transparent, not the fallback.
  assert.equal(L.compile(L.resolve({ ui: { tokens: { rim: null } } })), '#stage{--kit-rim:transparent}');
  assert.equal(L.compile(L.resolve({ ui: { tokens: { fontText: 'mono' } } })),
    '#stage{--kit-font-text:ui-monospace, "SFMono-Regular", Menlo, Consolas, "Courier New", monospace}');
});

test('look: the sanitiser keeps text out of the stylesheet', () => {
  const r = L.resolve({ ui: { tokens: { paper: 'red;}body{x', frameWidth: 99, textSize: 'giant' } } });
  const bad = r._problems.filter(p => p.code === 'ui-bad-value').map(p => p.where.path.join('.'));
  assert.ok(bad.includes('ui.tokens.paper'), `the colour that is not a colour is dropped and said (${bad})`);
  assert.equal(r.tokens.paper, '#fdfdfb', 'and the kit\'s own is used instead');
  assert.equal(r.tokens.frameWidth, 12, 'a number out of range is pulled in, not refused');
  assert.equal(r.tokens.textSize, 'normal', 'an unknown size is dropped');
  assert.ok(bad.includes('ui.tokens.textSize'));
  const css = L.compile(r);
  assert.ok(!css.includes(';}') && !css.includes('body') && !css.includes('red'), css);
  assert.equal(css, '#stage{--kit-frame-w:12px}');
  // compile does not trust what it is handed: a look that never went through resolve.
  assert.equal(L.compile({ tokens: { paper: 'red;}body{x', ink: 'url(https://x)' } }), '');
  // Unknown tokens and parts, and a base that is not an id, are dropped and said.
  const s = L.sanitize({ base: '../x', tokens: { nope: '#fff' }, stylesheet: 'body{}', sounds: { move: 'tick', confirm: 'no spaces' } });
  assert.deepEqual(s.ui, { tokens: {}, sounds: { move: 'tick' } });
  assert.deepEqual(s.dropped.map(d => d.path.join('.')).sort(), ['base', 'sounds.confirm', 'stylesheet', 'tokens.nope']);
  assert.deepEqual(L.sanitize('body{}').dropped, [{ path: [], value: 'body{}' }]);
});

test('look: a key every object inherits is not a part (a file\'s `constructor` does not throw)', () => {
  // `constructor`, `__proto__` and `toString` were found on PARTS by
  // inheritance, taken for a field list, and threw: the game would not boot
  // and every line of dialogue failed, because each one asks for its voice.
  const hostile = JSON.parse('{"constructor":{},"__proto__":{"paper":"#000000"},"toString":{},"hasOwnProperty":{}}');
  const s = L.sanitize(hostile);
  assert.deepEqual(s.ui, {});
  assert.deepEqual(s.dropped.map(d => d.path.join('.')).sort(), ['__proto__', 'constructor', 'hasOwnProperty', 'toString']);
  const r = L.resolve({ ui: hostile });
  assert.deepEqual(r._problems.map(p => p.code), ['ui-bad-value', 'ui-bad-value', 'ui-bad-value', 'ui-bad-value']);
  assert.equal(r.tokens.paper, '#fdfdfb', 'nothing under __proto__ reached the look');
  assert.equal(L.compile(r), '');
  // The same hole, reached through a look in the game's own library.
  const lib = L.resolve({ ui: { base: 'mine' }, looks: { mine: { ui: JSON.parse('{"constructor":{"a":1}}') } } });
  assert.deepEqual(lib._problems.map(p => p.where.path.join('.')), ['looks.mine.ui.constructor']);
  // And through everything that asks the look something on the way to the screen.
  const p = { ui: JSON.parse('{"constructor":{"a":1}}'), settings: {} };
  assert.equal(L.voice(p), null);
  assert.deepEqual(KIT.cast.speaker(p, { who: 'Mom', text: 'hi' }), { who: 'Mom', text: 'hi' });
  const { problems } = KIT.project.normalize({ version: 3, meta: { id: 'hostile' }, maps: { a: {} }, ui: JSON.parse('{"constructor":{"a":1}}') });
  assert.ok(!problems.some(q => q.code === 'validator-threw'), 'the validator reports it rather than throwing');
  assert.ok(problems.some(q => q.code === 'ui-bad-value'));
  try {
    L.use(p);
    assert.equal(L.get('tokens.constructor', 'none'), 'none', 'get reads the look\'s own fields only');
  } finally { L.use(null); }
});

test('look: a font is a word or one of the game\'s own fonts, and nothing else reaches the stylesheet', () => {
  // The game's own font: its family, then a stack to fall back on while it
  // loads — monospace for a pixel font — and the family fontsReady waits for.
  const fonts = { dtm: { name: 'DTM Mono', pixel: true }, soft: { name: 'Soft' } };
  assert.equal(L.css({ ui: { tokens: { fontText: 'dtm' } }, fonts }),
    '#stage{--kit-font-text:"kitf-dtm", ui-monospace, "SFMono-Regular", Menlo, Consolas, "Courier New", monospace}');
  assert.equal(L.css({ ui: { tokens: { fontUi: 'soft' } }, fonts }),
    '#stage{--font-ui:"kitf-soft", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif}');
  // An id the game has no font for, or a CSS keyword dressed as one, keeps the
  // kit's font: a bare `dtm` or `initial` threw the whole fallback stack away.
  for (const v of ['dtm', 'initial', 'inherit', 'unset', 'revert']) {
    assert.equal(L.css({ ui: { tokens: { fontText: v, fontUi: v } } }), '', v);
  }
  assert.equal(L.compile(L.resolve({ ui: { tokens: { fontText: 'dtm' } } }), { fonts }), L.css({ ui: { tokens: { fontText: 'dtm' } }, fonts }));
  // family() on its own: words, the game's fonts, and anything else untouched
  // (a voice's font written out as a family still works).
  assert.equal(L.family('serif'), 'Georgia, "Times New Roman", serif');
  assert.equal(L.family('soft', fonts), '"kitf-soft", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif');
  assert.equal(L.family('Georgia', fonts), 'Georgia');
  assert.equal(L.family('monospace'), 'monospace', 'a generic family is not one of the game\'s fonts');
  assert.equal(L.family('constructor', {}), 'constructor');
});

test('look: apply writes what css(project) says, and says so', () => {
  const p = { ui: { tokens: { paper: '#000000' } } };
  const seen = [];
  const off = L.events.on('applied', (e) => seen.push(e.css));
  return L.apply(p).then(() => {
    assert.deepEqual(seen, [L.css(p)]);
    assert.equal(seen[0], '#stage{--paper:#000000}');
    assert.equal(L.current().tokens.paper, '#000000', 'and the look is the one in use');
  }).finally(() => { off(); L.use(null); });
});

test('look: the chain of looks, and what happens when it breaks', () => {
  // A look of the game's own, built on the kit, with this game's changes on top.
  const good = L.resolve({ ui: { base: 'mine', tokens: { ink: '#000000' } }, looks: { mine: { label: 'Mine', base: 'kit', ui: { tokens: { accent: '#ff0000', ink: '#111111' } } } } });
  assert.deepEqual(good._chain, ['kit', 'mine']);
  assert.equal(good.tokens.accent, '#ff0000', 'the look underneath shows');
  assert.equal(good.tokens.ink, '#000000', 'and the game\'s own change wins over it');
  assert.deepEqual(good._problems, []);

  const loop = L.resolve({ ui: { base: 'a' }, looks: { a: { base: 'b', ui: { tokens: { accent: '#111111' } } }, b: { base: 'a', ui: {} } } });
  assert.deepEqual(loop._problems.map(p => p.code), ['ui-base-cycle']);
  assert.equal(loop.tokens.accent, '#111111', 'the looks before the loop still apply');

  const looks = {};
  for (let i = 1; i <= 9; i++) looks['l' + i] = { base: i < 9 ? 'l' + (i + 1) : 'kit', ui: {} };
  assert.deepEqual(L.resolve({ ui: { base: 'l1' }, looks })._problems.map(p => p.code), ['ui-base-deep']);
  delete looks.l9; looks.l8.base = 'kit';
  assert.deepEqual(L.resolve({ ui: { base: 'l1' }, looks })._problems, [], 'eight deep is allowed');

  const lost = L.resolve({ ui: { base: 'nope', tokens: { paper: '#000000' } } });
  assert.deepEqual(lost._problems.map(p => p.code), ['ui-base-missing']);
  assert.deepEqual(lost._chain, ['kit'], 'a missing look falls back to the kit');
  assert.equal(lost.tokens.paper, '#000000', 'and the game\'s own changes still apply');
  // A bad value inside a look of the game's own library is reported where it is.
  const inLib = L.resolve({ ui: { base: 'mine' }, looks: { mine: { ui: { tokens: { ink: 'blue' } } } } });
  assert.deepEqual(inLib._problems.map(p => p.where.path.join('.')), ['looks.mine.ui.tokens.ink']);
});

test('look: the `ui` validator reports through the project\'s own checks', () => {
  const { problems } = KIT.project.normalize({ version: 3, meta: { id: 'look-test' }, maps: { a: {} }, ui: { base: 'nope', tokens: { paper: 'red' } } });
  const mine = problems.filter(p => p.where && p.where.look);
  assert.deepEqual(mine.map(p => p.code).sort(), ['ui-bad-value', 'ui-base-missing']);
  assert.ok(mine.every(p => p.severity === 'warn'), 'a game with a broken look still plays');
  assert.deepEqual(L.problems({ ui: {} }), []);
});

test('look: each sound is a role, and the kit plays what it always played', () => {
  const played = [];
  const was = KIT.audio.play;
  KIT.audio.play = (id) => { played.push(id); };
  try {
    L.use(null);
    assert.equal(L.sound('move'), 'blip');
    assert.equal(L.sound('confirm'), 'select');
    assert.equal(L.sound('cancel'), 'back');
    assert.equal(L.sound('save'), 'save');
    assert.equal(L.sound('buzzer'), null, 'the kit has no buzzer');
    assert.equal(L.sound('buzzer', { or: 'cancel' }), 'back', 'so a refusal falls back to the cancel sound');
    assert.equal(L.sound('open'), null);
    assert.equal(L.sound('move', { overrides: { move: 'tick' } }), 'tick', 'a screen\'s own sound wins');
    assert.equal(L.sound('move', { overrides: { move: null } }), null, 'and may be silence');
    assert.deepEqual(played, ['blip', 'select', 'back', 'save', 'back', 'tick']);
    // A look's own sounds are what the scenes then hear.
    L.use({ ui: { sounds: { move: 'tick', buzzer: 'bump' } } });
    played.length = 0;
    L.sound('move'); L.sound('buzzer', { or: 'cancel' });
    assert.deepEqual(played, ['tick', 'bump']);
  } finally { KIT.audio.play = was; L.use(null); }
});

test('look: use, current and get', () => {
  const seen = [];
  const off = L.events.on('changed', (e) => seen.push(e.look.tokens.paper));
  try {
    L.use({ ui: { tokens: { paper: '#000000' } } });
    assert.equal(L.current().tokens.paper, '#000000');
    assert.equal(L.get('tokens.paper', 'x'), '#000000');
    assert.equal(L.get('menu.order', ['*']).join(), '*', 'a part the look does not have gives the fallback');
    assert.equal(L.get('tokens.nothing', 7), 7);
    L.use(null);
    assert.equal(L.get('tokens.paper'), '#fdfdfb');
    assert.deepEqual(seen, ['#000000', '#fdfdfb']);
  } finally { off(); L.use(null); }
});

test('look: menuOrder is the pause menu\'s own order when the look says nothing', () => {
  const menus = KIT.registry('menus');
  // Today's pauseRows, written out the way it was before there were looks.
  const before = ['keep-playing'].concat(menus.list().slice().sort((a, b) => (a.order || 50) - (b.order || 50)).map(d => d.id));
  const entries = [{ id: 'keep-playing', order: -Infinity }].concat(menus.list().map(d => ({ id: d.id, order: d.order })));
  assert.deepEqual(L.menuOrder(entries, {}), before);
  assert.deepEqual(L.menuOrder(entries, L.get('menu', {})), before);
  // `order: 0` has always sorted as 50, between Settings (40) and Debug (55).
  const zero = entries.concat([{ id: 'zero', order: 0 }]);
  const got = L.menuOrder(zero, {});
  assert.ok(got.indexOf('zero') > got.indexOf('settings') && got.indexOf('zero') < got.indexOf('debug'), got.join(', '));
  // What a look may ask for: '*' is everything not named, and Settings stays.
  assert.deepEqual(L.menuOrder(entries, { order: ['save', '*'] })[0], 'save');
  assert.equal(L.menuOrder(entries, { order: ['*', 'keep-playing'] }).slice(-1)[0], 'keep-playing');
  assert.ok(!L.menuOrder(entries, { hide: ['coop'] }).includes('coop'));
  assert.ok(L.menuOrder(entries, { hide: ['settings'] }).includes('settings'), 'Settings can never be hidden');
  assert.ok(L.menuOrder(entries, { order: ['save'] }).includes('quit'), 'an order that names a few keeps the rest');
});

test('look: KIT.cast.speaker gives a line its speaker\'s voice', () => {
  const p = KIT.project.normalize({ version: 3, meta: { id: 'speaker-test' }, maps: { a: {} }, cast: { mira: { name: 'Mira', voice: 'high' } } }).project;
  assert.equal(KIT.cast.speaker(p, { who: 'mira', text: 'hi' }).voice, 'high', 'by id');
  assert.equal(KIT.cast.speaker(p, { who: 'Mira', text: 'hi' }).voice, 'high', 'by the name on screen');
  assert.equal(KIT.cast.speaker(p, { who: 'Mira', text: 'hi', voice: 'low' }).voice, 'low', 'a line that asks for a voice gets it');
  const fallback = Object.assign({}, p, { settings: Object.assign({}, p.settings, { voice: 'flat' }) });
  assert.equal(KIT.cast.speaker(fallback, { who: 'Mom', text: 'hi' }).voice, 'flat', 'the game\'s setting covers everyone else');
  const plain = KIT.cast.speaker(p, { who: 'Mom', text: 'hi' });
  assert.deepEqual(plain, { who: 'Mom', text: 'hi' }, 'nobody with a voice: the payload is untouched, with no voice key');
  assert.ok(!('voice' in plain));
  // The look's own voice is the last resort, under the game's setting.
  const looked = Object.assign({}, p, { ui: { voice: 'soft' } });
  assert.equal(KIT.cast.speaker(looked, { who: 'Mom' }).voice, 'soft');
  assert.equal(L.voice(Object.assign({}, looked, { settings: { voice: 'flat' } })), 'flat');
});

test('look: a line is translated once, not twice', () => {
  // The say, choice, chapter and toast payloads arrive substituted, which
  // translated them. Substituting again translated the translation.
  const was = KIT.lang.t;
  KIT.lang.t = (s) => (s === 'A' ? 'B' : s === 'B' ? 'C' : s);
  try {
    assert.equal(KIT.text.strip('B'), 'B');
    assert.equal(KIT.text.plain('B'), 'C', 'the old path: B is the translation of A, and came out as C');
  } finally { KIT.lang.t = was; }
  for (const f of ['js/kit/scenes/dialogue.js', 'js/kit/ui/parts.js']) {
    assert.ok(!read(f).includes('KIT.text.plain('), `${f} does not substitute a line a second time`);
  }
});

test('look: KIT.ui.el finds an element in a root of its own', () => {
  const inside = { id: 'dialogue' };
  const shadow = { getElementById: (id) => (id === 'dialogue' ? inside : null) };
  assert.equal(KIT.ui.el('dialogue', shadow), inside);
  assert.equal(KIT.ui.el('nothing', shadow), null);
  assert.equal(KIT.ui.el('dialogue'), null, 'and with no document there is nothing to find');
});

test('look: the kit ships the kit look, empty', () => {
  const kit = KIT.registry('looks').get('kit');
  assert.ok(kit, 'registered');
  assert.deepEqual(kit.ui, {});
  assert.equal(kit.rev, 1);
  assert.deepEqual(Object.keys(L.ROLES), L.PARTS.sounds.map(f => f.key), 'every role is a sound option');
});

test('the pause menu waits for the cutscene', () => {
  // Not the look, but the same phone play-through found it: ☰ during a script
  // opened a menu whose Save wrote a world half way through a scene.
  R('js/kit/core/storage.js'); R('js/kit/game.js');
  const G = KIT.game;
  const was = { world: G.world, busy: KIT.interpreter.mainBusy };
  try {
    G.world = null;
    assert.equal(G.canOpenMenu(), false, 'no world, no pause');
    G.world = { busy: false, save: {} };
    assert.equal(G.canOpenMenu(), true);
    G.world.busy = true;
    assert.equal(G.canOpenMenu(), false, 'a script holds the world');
    G.world.busy = false;
    KIT.interpreter.mainBusy = () => true;
    assert.equal(G.canOpenMenu(), false, 'a main-thread script is still running');
    KIT.interpreter.mainBusy = was.busy;
    G.world.save.locks = { menu: true };
    assert.equal(G.canOpenMenu(), false, 'the story locked the menu');
  } finally { G.world = was.world; KIT.interpreter.mainBusy = was.busy; }
});
