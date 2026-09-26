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
R('js/kit/scenes/stack.js'); R('js/kit/ui/parts.js'); R('js/kit/scenes/dialogue.js'); R('js/kit/scenes/menu.js');
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

test('look: an empty colour that is drawn in another says which, the one css/kit.css falls back to', () => {
  // The Look panel shows that colour in the empty colour's square. Without it
  // the square was black beside "Same as accent", with the name drawn in blue.
  const empty = L.TOKENS.concat(L.PARTS.cursor).filter(f => f.type === 'color' && f.nullable && !f.none);
  assert.ok(empty.length >= 12, `the eight inks, the chosen line's text, the title's two and the cursor (${empty.length})`);
  for (const f of empty) {
    assert.ok(f.follows || f.shows, `${f.key} says what it is drawn in`);
    if (f.shows) assert.match(f.shows, /^#[0-9a-f]{6}$/, `${f.key} shows a colour`);
    if (!f.follows) continue;
    const to = L.TOKENS.find(t => t.key === f.follows);
    assert.ok(to && to.type === 'color', `${f.key} follows a colour token (${f.follows})`);
    const v = /^var\((--[\w-]+)/.exec(f.fallback || '');
    if (v) assert.equal(to.css, v[1], `${f.key} follows what the stylesheet falls back to`);
  }
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

test('look: in a game with fonts of its own, the kit look is only their @font-face, kept apart from the look', () => {
  const fonts = { dot: { name: 'Dot', src: 'data:font/ttf;base64,AAEAAA==', pixel: false } };
  const face = '@font-face{font-family:"kitf-dot";src:url("data:font/ttf;base64,AAEAAA==") format("truetype");font-display:block}';
  // The kit look with a font brought in from Game › Import and not used yet:
  // the font is declared (the Look panel shows it in its own letters), and
  // that is all.
  assert.equal(L.css({ fonts }), face);
  assert.equal(L.fontFaces(fonts), face);
  assert.equal(L.css({ fonts }, { faces: false }), '', 'the look itself is still nothing');
  assert.equal(L.fontFaces({}), '');
  // A look that uses it: the @font-face, a line each, then the look's rules —
  // which is how apply puts them in two stylesheets, the fonts written only
  // when they change.
  const p = { fonts, ui: { tokens: { fontText: 'dot', paper: '#000000' } } };
  assert.equal(L.css(p), L.fontFaces(fonts) + '\n' + L.css(p, { faces: false }));
  assert.ok(!L.css(p, { faces: false }).includes('@font-face'));
  assert.ok(read('js/kit/ui/parts.js').includes("styleIn('kit-look-fonts')"), 'apply keeps the fonts in a sheet of their own');
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
  const fonts = { dtm: { name: 'DTM Mono', pixel: true, src: 'data:font/ttf;base64,AAEAAA==' }, soft: { name: 'Soft', src: 'data:font/woff2;base64,d09GMg==' } };
  const faces = '@font-face{font-family:"kitf-dtm";src:url("data:font/ttf;base64,AAEAAA==") format("truetype");font-display:block}\n'
    + '@font-face{font-family:"kitf-soft";src:url("data:font/woff2;base64,d09GMg==") format("woff2");font-display:block}\n';
  // Every font the game has comes first as an @font-face, then the look names
  // one; a pixel font asks for its squares unsmudged.
  assert.equal(L.css({ ui: { tokens: { fontText: 'dtm' } }, fonts }),
    faces + '#stage{--kit-font-text:"kitf-dtm", ui-monospace, "SFMono-Regular", Menlo, Consolas, "Courier New", monospace}\n#screen{-webkit-font-smoothing:none;font-smooth:never}');
  assert.equal(L.css({ ui: { tokens: { fontUi: 'soft' } }, fonts }),
    faces + '#stage{--font-ui:"kitf-soft", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif}');
  // An id the game has no font for, or a CSS keyword dressed as one, keeps the
  // kit's font: a bare `dtm` or `initial` threw the whole fallback stack away.
  for (const v of ['dtm', 'initial', 'inherit', 'unset', 'revert']) {
    assert.equal(L.css({ ui: { tokens: { fontText: v, fontUi: v } } }), '', v);
  }
  // A font whose file is not a font inside the game is not a font at all.
  assert.equal(L.family('dtm', { dtm: { name: 'DTM', src: 'https://example.com/dtm.ttf' } }), 'dtm');
  assert.equal(L.compile(L.resolve({ ui: { tokens: { fontText: 'dtm' } } }), { fonts }), L.css({ ui: { tokens: { fontText: 'dtm' } }, fonts }));
  // family() on its own: words, the game's fonts, and anything else untouched
  // (a voice's font written out as a family still works).
  assert.equal(L.family('serif'), 'Georgia, "Times New Roman", serif');
  assert.equal(L.family('soft', fonts), '"kitf-soft", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif');
  assert.equal(L.family('Georgia', fonts), 'Georgia');
  assert.equal(L.family('monospace'), 'monospace', 'a generic family is not one of the game\'s fonts');
  assert.equal(L.family('constructor', {}), 'constructor');
});

test('look: only a font file inside the game becomes an @font-face, and a bad one says why', () => {
  const ok = 'data:font/ttf;base64,AAEAAA==';
  const fonts = { good: { name: 'Good', src: ok }, link: { name: 'Linked', src: 'https://example.com/x.ttf' }, pixel: { name: 'Named like a word', src: ok },
    fake: { name: 'Not a font', src: 'data:image/png;base64,iVBORw0KGgo=' } };
  const p = { fonts, ui: { tokens: { fontText: 'link' } } };
  const faces = L.css(p).split('\n').filter(r => r.startsWith('@font-face'));
  assert.deepEqual(faces, ['@font-face{font-family:"kitf-good";src:url("' + ok + '") format("truetype");font-display:block}'], 'only the good one');
  assert.ok(!L.css(p).includes('https:'), 'nothing that fetches reaches the page');
  const got = L.problems(p).map(q => `${q.code} ${q.where.path.join('.')}`).sort();
  assert.deepEqual(got, ['ui-bad-value fonts.pixel', 'ui-ref ui.tokens.fontText', 'ui-src fonts.fake', 'ui-src fonts.link']);
  assert.ok(L.problems(p).every(q => q.severity === 'warn' && q.where.look), 'all warnings, each one tapped opens the look');
  // Big fonts: one over 300 KB, and all of them over 1.5 MB.
  const big = (kb) => ({ name: 'Big', src: 'data:font/woff2;base64,' + 'A'.repeat(Math.ceil(kb * 1024 * 4 / 3)) });
  const sizes = L.problems({ fonts: { a: big(310), b: big(600), c: big(700) } }).filter(q => q.code === 'ui-big').map(q => q.where.path.join('.'));
  assert.deepEqual(sizes, ['fonts.a', 'fonts.b', 'fonts.c', 'fonts']);
  assert.deepEqual(L.problems({ fonts: { a: big(100) } }), [], 'a small font is no problem');
});

test('look: a pixel font is drawn at a whole multiple of its own size', () => {
  const fonts = { dot: { name: 'Dot', src: 'data:font/ttf;base64,AAEAAA==', pixel: true, px: 8 } };
  const size = (textSize, f) => {
    const m = /--kit-text-size:([^;}]+)/.exec(L.css({ fonts: f || fonts, ui: { tokens: { fontText: 'dot', textSize } } }));
    return m ? m[1] : null;
  };
  assert.equal(size('large'), '24px', 'Large aims at 20: 8 × 3 is nearer than 8 × 2');
  assert.equal(size('normal'), '16px', 'and Normal is 16 even though Normal writes nothing for any other font');
  assert.equal(size('small'), '16px', 'Small aims at 14: 8 × 2');
  assert.equal(size('huge'), '24px');
  assert.equal(size('small', { dot: Object.assign({}, fonts.dot, { px: 24 }) }), '24px', 'never less than the size it was drawn for');
  assert.equal(size('large', { dot: Object.assign({}, fonts.dot, { pixel: false }) }), 'clamp(17px,4.2vw,21px)', 'a font that is not pixel keeps the ordinary sizes');
  assert.equal(size('normal', { dot: Object.assign({}, fonts.dot, { px: null }) }), null, 'nor does a pixel font with no size of its own');
});

test('look: how the box opens and how a page scrolls only move where things may move', () => {
  const MOVING = '#stage:not([data-kit-motion=reduce]):not([data-kit-fast])';
  const pop = rulesOf(L.css({ ui: { dialogue: { open: 'pop' } } }));
  assert.deepEqual(pop, [MOVING + ' #screen #dialogue .kit-box.is-opening{animation:kit-look-pop .18s ease-out}', MOVING + ' #screen #dialogue .kit-box.is-shaking{animation:kit-shake .32s}'],
    'the box pops when the message box says it is opening, and a {shake} still shakes it');
  const scene = read('js/kit/scenes/dialogue.js');
  assert.ok(scene.includes("ui.box.classList.add('is-opening')") && scene.includes("classList.remove('is-shaking', 'is-opening')"),
    'the message box opens only when it comes up after being away, and takes the class off for every other line');
  assert.ok(L.css({ ui: { dialogue: { open: 'slide' } } }).includes('@keyframes kit-look-slide{'));
  const scroll = rulesOf(L.css({ ui: { dialogue: { pageTurn: 'scroll' } } }));
  assert.equal(scroll.length, 2);
  assert.ok(scroll.every(r => r.startsWith(MOVING + ' #screen #dialogue .kit-text.is-scrolled')), scroll.join('\n'));
  assert.equal(L.css({ ui: { dialogue: { open: 'none', pageTurn: 'clear' } } }), '', 'the kit\'s own write nothing');
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

// ---- the looks to start from, and the parts' options ---------------------------------

const PRESETS = ['handheld', 'soul', 'dream'];
/** The rules of a stylesheet, one per line as compile writes them, @keyframes left out. */
const rulesOf = (css) => css.split('\n').filter(r => r && !r.startsWith('@'));
const selectorsOf = (rule) => rule.slice(0, rule.indexOf('{')).split(',').map(s => s.trim());

test('look: each built-in look resolves with no problems, and compiles the same twice', () => {
  for (const id of PRESETS) {
    const p = { ui: { base: id } };
    const look = L.resolve(p);
    assert.deepEqual(look._chain, ['kit', id]);
    assert.deepEqual(L.problems(p), [], `${id} is a clean look`);
    const css = L.css(p);
    assert.ok(css.length > 0, `${id} changes something`);
    assert.equal(css, L.css({ ui: { base: id } }), `${id}: the same look, the same text`);
    const def = KIT.registry('looks').get(id);
    assert.ok(def.label && def.describe && def.rev === 1, `${id} has a name, a description and a rev`);
  }
  assert.ok(KIT.registry('voices').has('typer'), 'the Soul look talks in a voice the kit ships');
});

test('look: every compiled rule stays on the game screen, and off the title', () => {
  // The part options that are not the kit's own, all at once, on each look.
  const every = { tokens: { paper: '#101010' }, dialogue: { lines: 4, width: 80, margin: 20, face: 'above-left', faceFrame: false, name: 'tab', nameCase: 'upper', prefix: '> ', marker: '', markerMotion: 'blink', open: 'slide', pageTurn: 'scroll' },
    choice: { place: 'center', layout: 'grid', columns: 3 }, menu: { at: 'top', caps: true }, toast: { at: 'center', shape: 'box' },
    pad: { shape: 'square' }, cursor: { glyph: '*', color: '#00ff00', size: 20, highlight: false } };
  const sheets = PRESETS.map(id => L.css({ ui: { base: id } })).concat([L.css({ ui: every })]);
  for (const css of sheets) {
    for (const rule of rulesOf(css)) {
      for (const sel of selectorsOf(rule)) assert.ok(/^#(stage|screen|controls)\b/.test(sel), `"${sel}" starts at the game's own elements`);
      assert.ok(!rule.includes('#screen-title'), `the title keeps its own look for now: ${rule}`);
    }
  }
  // A cursor rule on the title would put a heart beside "New Game".
  assert.ok(!sheets.some(css => /#screen-title|\.kit-start/.test(css)));
});

test('look: a mark an author types cannot close the string it is written in', () => {
  // The prefix holds four letters: all three of these reach the stylesheet, escaped.
  const pre = L.css({ ui: { dialogue: { prefix: '"};' } } });
  assert.ok(pre.includes('content:"\\22 \\7d \\3b "'), pre);
  assert.ok(!/content:"[^"]*;/.test(pre.replace(/\\3b /g, '')), 'no bare ; inside the string');
  // A cursor holds two, so the ; never arrives at all.
  const cur = L.css({ ui: { cursor: { glyph: '"};' } } });
  assert.ok(cur.includes('content:"\\22 \\7d "'), cur);
  assert.equal(L.resolve({ ui: { cursor: { glyph: '"};' } } }).cursor.glyph, '"}');
  // Letters as a person counts them: a heart is one, and six are cut to four.
  assert.equal(L.resolve({ ui: { dialogue: { prefix: '♥♥♥♥♥♥' } } }).dialogue.prefix, '♥♥♥♥');
  assert.equal(L.resolve({ ui: { dialogue: { prefix: 7 } } }).dialogue.prefix, '', 'a number is not a mark');
  // What the soul look writes, as the spec for it says.
  assert.ok(L.css({ ui: { base: 'soul' } }).includes('.kit-line.is-start::before{content:"* "'));
  assert.ok(L.css({ ui: { base: 'soul' } }).includes('content:"\\2665 "'), 'the heart cursor');
});

test('look: a part\'s option is one rule, only when it is not the kit\'s own', () => {
  const one = (ui) => rulesOf(L.css({ ui }));
  assert.deepEqual(one({ dialogue: { lines: 3, width: 100, marker: '▼' } }), [], 'the kit\'s own values write nothing');
  // The question's box by the answers (a .kit-promptbox) is the message box too, but for the answers inside it.
  assert.deepEqual(one({ dialogue: { lines: 2 } }), ['#screen #dialogue .kit-text,#screen #choice[data-place]:not([data-place=in-box]) .kit-promptbox .kit-text{min-height:calc(var(--kit-line,1.45) * 2 * 1em)}']);
  assert.deepEqual(one({ menu: { at: 'top-left' } }), ['#screen #pause-menu:has(> .kit-pause){align-items:flex-start;justify-content:flex-start}']);
  assert.deepEqual(one({ pad: { shape: 'square' } }), ['#stage{--kit-pad-ab-radius:12px}']);
  assert.deepEqual(one({ toast: { shape: 'box' }, tokens: { radius: 6 } }), ['#stage{--kit-radius:6px;--kit-toast-radius:6px}']);
  // Blinking is an animation, so it only plays where things may move.
  const blink = L.css({ ui: { dialogue: { markerMotion: 'blink' } } });
  assert.ok(blink.includes('@keyframes kit-look-blink'));
  assert.ok(blink.includes('#stage:not([data-kit-motion=reduce]):not([data-kit-fast]) #screen #dialogue .kit-next.is-ready{animation:kit-look-blink'));
  assert.ok(blink.includes('#screen #dialogue .kit-next.is-ready{animation:none}'), 'and is still everywhere else');
  // Options the scenes act on without a stylesheet — where the box goes, the
  // typing speeds, the answers by the box (kit.css holds those rules, behind
  // data-place) — write nothing; and the menu's order, held for later, is a
  // clean look that writes nothing yet.
  const quiet = { dialogue: { at: 'avoid-hero', speeds: { slow: 5 } }, choice: { place: 'in-box' }, menu: { order: ['save', '*'], hide: ['coop'] } };
  assert.deepEqual(L.problems({ ui: quiet }), []);
  assert.equal(L.css({ ui: quiet }), '');
  assert.deepEqual(L.resolve({ ui: quiet }).dialogue.speeds, { slow: 5, normal: 48, fast: 96 });
  assert.ok(L.PARTS.menu.filter(f => f.later).map(f => f.key).join() === 'order,hide', 'only the menu\'s order and hiding are held for later');
  assert.ok(!L.PARTS.dialogue.concat(L.PARTS.choice, L.PARTS.sounds).some(f => f.later), 'the page turn, speeds, where the box goes, the answers by the box and the page sound all work now');
  const bad = L.resolve({ ui: { dialogue: { speeds: { slow: 'fast' } }, menu: { order: ['a;b'] } } });
  assert.deepEqual(bad._problems.map(q => q.where.path.join('.')).sort(), ['ui.dialogue.speeds.slow', 'ui.menu.order']);
});

test('look: on a chosen line with colours of its own, a value takes the line\'s colour', () => {
  const VALUE = '#screen #choice .kit-option.is-selected .kit-item-value,#screen #pause-menu .kit-menu-item.is-selected .kit-item-value,#screen .kit-ui-screen .kit-uibtn.is-selected .kit-item-value{color:var(--kit-sel-ink,var(--ink))}';
  const has = (ui) => rulesOf(L.css({ ui })).includes(VALUE);
  // Dream's chosen line is a white bar and its accent is white: the value on
  // it (Settings' "auto", a save's date) was white on white.
  assert.ok(has({ base: 'dream' }), 'Dream');
  const dream = L.resolve({ ui: { base: 'dream' } }).tokens;
  const lum = (hex) => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  assert.ok(ratio(dream.selectInk, dream.select) >= 3, 'and what it takes can be read on the bar');
  assert.ok(has({ base: 'soul' }) && has({ base: 'handheld' }), 'the other looks that change the chosen line do the same');
  assert.ok(!has({}) && !has({ tokens: { accent: '#ff0000' } }), 'the kit\'s own chosen line keeps accent-coloured values, and compiles to nothing');
  assert.ok(!has({ base: 'dream', tokens: { valueInk: '#ff0000' } }), 'a value colour of the look\'s own wins');
});

test('look: a name on a tab moves out of the way of a portrait above the same corner', () => {
  const MOVE = '#screen #dialogue .kit-name,#screen #choice[data-place] .kit-promptbox .kit-name{left:auto;right:12px}';
  assert.ok(rulesOf(L.css({ ui: { base: 'dream', dialogue: { face: 'above-left' } } })).includes(MOVE), 'Dream with its portrait moved to the left');
  assert.ok(!rulesOf(L.css({ ui: { base: 'dream' } })).includes(MOVE), 'Dream as it is: the portrait is right, the tab stays left');
  assert.ok(!rulesOf(L.css({ ui: { dialogue: { face: 'above-left' } } })).includes(MOVE), 'no tab, nothing to move');
});

test('look: answers in a row stay a row beside the box, and wrap only once they go over it', () => {
  // A row that may wrap needs no wider a window than its widest answer, and
  // beside the box that stacked Yes over No in half the screen.
  const rows = rulesOf(L.css({ ui: { base: 'dream', choice: { layout: 'row' } } }));
  assert.ok(rows.includes('#screen #choice .kit-list{flex-direction:row;flex-wrap:wrap;justify-content:space-around}'));
  assert.ok(rows.includes('#screen #choice[data-place=beside-box]:not([data-over]) .kit-list{flex-wrap:nowrap}'));
  assert.ok(!rulesOf(L.css({ ui: { base: 'dream', choice: { layout: 'grid' } } })).some(r => r.includes('nowrap')), 'a grid has columns, not a row to keep');
  // Over the box the window may be the whole width, where a long row wraps.
  const kitCss = stylesheet();
  assert.match(kitCss, /#choice\[data-place=beside-box\]\[data-over\] \.kit-promptbox \{ flex-basis: 100%; \}/);
  assert.match(kitCss, /#choice\[data-place=beside-box\]\[data-over\] \.kit-panel \{ max-width: 100%; \}/);
});

test('look: capitals leave a notice in a list as it was written', () => {
  const css = L.css({ ui: { menu: { caps: true } } });
  assert.ok(rulesOf(css).includes('#screen #pause-menu .kit-menu-item:not(.kit-menu-notice) .kit-item-label{text-transform:uppercase}'), css);
});

test('look: cleanAt cleans one value as its field says, the way a whole look is cleaned', () => {
  assert.deepEqual(L.cleanAt(['dialogue', 'prefix'], 'abcdefgh'), { ok: true, value: 'abcd' }, 'four letters');
  assert.deepEqual(L.cleanAt(['tokens', 'paper'], '#FFF'), { ok: true, value: '#ffffff' }, 'one spelling for one colour');
  assert.deepEqual(L.cleanAt(['tokens', 'frameWidth'], 99), { ok: true, value: 12 });
  assert.equal(L.cleanAt(['tokens', 'paper'], 'pink').ok, false);
  assert.equal(L.cleanAt(['tokens', 'paper'], null).ok, false, 'the box must have a colour');
  assert.deepEqual(L.cleanAt(['tokens', 'rim'], null), { ok: true, value: null }, 'the inner line may have none');
  assert.deepEqual(L.cleanAt(['dialogue', 'speeds'], { slow: 500 }), { ok: true, value: { slow: 120 } }, 'a group, field by field');
  assert.deepEqual(L.cleanAt(['dialogue', 'speeds', 'fast'], 0), { ok: true, value: 1 }, 'and one field of it');
  assert.deepEqual(L.cleanAt(['voice'], 'typer'), { ok: true, value: 'typer' });
  assert.equal(L.cleanAt(['voice'], 'no spaces').ok, false);
  for (const bad of [['nothing', 'here'], ['tokens'], ['dialogue', 'lines', 'deeper'], [], ['tokens', 'constructor']]) {
    assert.equal(L.cleanAt(bad, 1).ok, false, `${JSON.stringify(bad)} is no field`);
  }
  assert.equal(L.resolve({ ui: { tokens: { paper: '#ABC' } } }).tokens.paper, '#aabbcc', 'a look read from a file is spelled the same way');
});

test('look: inherited is the look underneath the game\'s own changes', () => {
  const p = { ui: { base: 'soul', tokens: { paper: '#123456' }, dialogue: { lines: 5 } } };
  assert.equal(L.inherited(p, ['tokens', 'paper']), '#000000', 'Soul\'s own');
  assert.equal(L.inherited(p, ['dialogue', 'lines']), 3, 'and where Soul says nothing, the kit\'s');
  assert.equal(L.inherited({}, ['tokens', 'paper']), '#fdfdfb');
  assert.equal(L.inherited(p, ['voice']), 'typer');
  assert.equal(L.inherited(p, ['nothing', 'here']), undefined);
  assert.equal(L.inherited(p, ['dialogue']).prefix, '* ', 'a whole part');
});

test('look: the validator says when words are hard to read, the box is huge, or a sound is missing', () => {
  const codes = (ui) => L.problems({ ui }).map(q => q.code + ':' + q.where.path.join('.'));
  assert.deepEqual(codes({ tokens: { ink: '#777777', paper: '#888888' } }), ['ui-contrast:ui.tokens.ink']);
  assert.deepEqual(codes({ tokens: { select: '#222222', selectInk: '#333333', accent: '#ffffff', buttonInk: '#000000' } }), ['ui-contrast:ui.tokens.selectInk']);
  assert.deepEqual(codes({ tokens: { select: null, ink: '#ffffff', paper: '#000000', selectInk: '#111111', accent: '#8899ff', inputBg: '#000000', buttonInk: '#000000' } }), ['ui-contrast:ui.tokens.selectInk'],
    'no background of its own: the chosen line is read against the box');
  // With the box round the chosen line off, the line has no background of its
  // own whatever `select` says: it is read against the box, both ways round.
  assert.deepEqual(codes({ tokens: { paper: '#fdfdfb', select: '#000000', selectInk: '#fdfdfb' }, cursor: { highlight: false } }), ['ui-contrast:ui.tokens.selectInk'],
    'near-white text on near-white paper is reported, though the unused bar behind it would have been dark');
  assert.deepEqual(codes({ tokens: { paper: '#000000', ink: '#ffffff', accent: '#ffffff', select: '#ffffff', selectInk: '#ffffff', inputBg: '#000000', buttonInk: '#000000' }, cursor: { highlight: false } }), [],
    'and white on black paper is not, though the unused bar would have been white');
  // A value on the chosen line (a volume) and the cursor beside it are read against the line too.
  assert.deepEqual(codes({ tokens: { accent: '#ffffff' } }), ['ui-contrast:ui.tokens.valueInk', 'ui-contrast:ui.tokens.cursorInk', 'ui-contrast:ui.tokens.buttonInk'],
    'a white accent on the kit\'s pale chosen line: its values and its cursor both vanish, and so does OK on a white button');
  assert.deepEqual(codes({ tokens: { select: '#ffffff', valueInk: '#fafafa' } }), ['ui-contrast:ui.tokens.valueInk'], 'a value colour of the look\'s own is its to keep, and is checked');
  assert.deepEqual(codes({ cursor: { color: '#eeeeee' } }), ['ui-contrast:ui.cursor.color'], 'a cursor colour of its own is named where it was set');
  assert.deepEqual(codes({ cursor: { color: '#eeeeee', glyph: '' } }), [], 'no cursor, nothing to read');
  assert.deepEqual(codes({ tokens: { toastInk: '#101010' } }), ['ui-contrast:ui.tokens.toastInk']);
  // The box that asks for a name. White words on a black message box were
  // typed white into a white field, and OK was white on a white button, and
  // nothing said so: Soul and Dream shipped that way.
  assert.deepEqual(codes({ tokens: { paper: '#000000', ink: '#ffffff', select: null, cursorInk: '#ffffff' } }), ['ui-contrast:ui.tokens.inputBg'], 'a name typed in white into the white name box');
  assert.deepEqual(codes({ tokens: { paper: '#000000', ink: '#ffffff', select: null, cursorInk: '#ffffff', inputBg: '#202020' } }), [], 'and a dark one of its own reads');
  assert.deepEqual(codes({ tokens: { button: '#f0f0f0' } }), ['ui-contrast:ui.tokens.buttonInk'], 'OK in white on a pale OK button');
  assert.deepEqual(codes({ tokens: { button: '#f0f0f0', buttonInk: '#000000' } }), []);
  for (const id of ['soul', 'dream']) {
    assert.deepEqual(codes({ base: id, tokens: { inputBg: '#ffffff', buttonInk: '#ffffff' } }), ['ui-contrast:ui.tokens.inputBg', 'ui-contrast:ui.tokens.buttonInk'],
      `${id} with the white name box and white OK it used to have is reported`);
    const look = L.resolve({ ui: { base: id } }).tokens;
    assert.ok(look.inputBg !== look.ink && look.buttonInk !== look.accent, `${id} has a name box and an OK button that can be read`);
  }
  assert.deepEqual(codes({ dialogue: { lines: 6 }, tokens: { lineHeight: 2.4, textSize: 'huge' } }), ['ui-lines:ui.dialogue.lines']);
  assert.deepEqual(codes({ dialogue: { face: 'above-left', faceScale: 6, lines: 4 } }), ['ui-lines:ui.dialogue.lines'], 'a big portrait over the box');
  assert.deepEqual(codes({ dialogue: { face: 'left', faceScale: 6, lines: 4 } }), [], 'the same portrait beside it is fine');
  assert.deepEqual(codes({ dialogue: { lines: 6 } }), [], 'six lines of ordinary text is a big box, not a problem');
  for (const id of PRESETS) assert.deepEqual(codes({ base: id }), [], `${id} keeps the game in sight`);
  assert.deepEqual(codes({ sounds: { move: 'nope' }, voice: 'nobody' }), ['ui-ref:ui.sounds.move', 'ui-ref:ui.voice']);
  assert.deepEqual(codes({ sounds: { move: 'select', open: 'save' }, voice: 'soft' }), []);
  assert.ok(L.problems({ ui: { sounds: { move: 'nope' } } }).every(q => q.severity === 'warn'), 'none of it stops the game');
});

test('look: dialogueLayout marks the first line of each piece the author wrote', () => {
  const DL = KIT.dialogueLayout;
  const lay = { width: 10, measure: (s) => s.length };
  const spans = KIT.text.tokenize('Hello there, you.\nSecond one\n\nThird');
  const r = DL.lines(spans, lay);
  const text = r.lines.map(l => l.map(sp => sp.text || '').join(''));
  assert.deepEqual(text, ['Hello', 'there,', 'you.', 'Second one', '', 'Third']);
  assert.deepEqual(Array.from(r.starts).sort((a, b) => a - b), [0, 3, 5], 'the first line, the one after each break, and not the blank line');
  assert.deepEqual(text, KIT.text.wrap(spans, lay).map(l => l.map(sp => sp.text || '').join('')), 'the same lines KIT.text.wrap makes');
  // A break at the end closes the last line; it opens no empty one.
  assert.deepEqual(DL.lines(KIT.text.tokenize('One\n'), lay).lines.length, KIT.text.wrap(KIT.text.tokenize('One\n'), lay).length);
  assert.deepEqual(Array.from(DL.lines([], lay).starts), [], 'nothing to say, nothing to mark');
});

test('look: dialogueLayout says where a line only wrapped, and what the wrap took out', () => {
  const DL = KIT.dialogueLayout;
  const lay = { width: 10, measure: (s) => s.length };
  const r = DL.lines(KIT.text.tokenize('Hello there, you.\nSecond one\nabcdefghijklmnop'), lay);
  const text = r.lines.map(l => l.map(sp => sp.text || '').join(''));
  assert.deepEqual(text, ['Hello', 'there,', 'you.', 'Second one', 'abcdefghij', 'klmnop']);
  // Lines 1 and 2 wrapped at a space, line 5 inside a word too long for the
  // box; 0, 3 and 4 start a piece the author wrote, and are their own lines.
  assert.deepEqual(Array.from(r.joins), [[1, ' '], [2, ' '], [5, '']]);
  // Joined back with what was taken out, each piece is the words as written.
  const pieces = [];
  text.forEach((t, i) => { if (r.joins.has(i)) pieces[pieces.length - 1] += r.joins.get(i) + t; else pieces.push(t); });
  assert.deepEqual(pieces, ['Hello there, you.', 'Second one', 'abcdefghijklmnop']);
  // An icon, and styled runs, walk the same way.
  const styled = DL.lines(KIT.text.tokenize('Take {color:#ff0000}the red{/color} {icon:key} key now'), lay);
  assert.deepEqual(Array.from(styled.joins.values()), styled.lines.slice(1).map(() => ' '));
});

test('look: a page that scrolls keeps its last line; a page that clears is the pagination it always was', () => {
  const DL = KIT.dialogueLayout;
  const scroll = DL.pages(['a', 'b', 'c', 'd'], 2, 'scroll');
  assert.deepEqual(scroll.map(w => w.lines.join('')), ['ab', 'bc', 'cd'], 'each press brings in one more line');
  assert.deepEqual(scroll.map(w => w.keep), [0, 1, 1], 'and keeps the one before it, already read');
  assert.deepEqual(scroll.map(w => w.from), [0, 1, 2]);
  const lines = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(DL.pages(lines, 2, 'clear').map(w => w.lines), KIT.text.paginate(lines, 2), '\'clear\' is KIT.text.paginate');
  assert.ok(DL.pages(lines, 2, 'clear').every(w => w.keep === 0));
  assert.deepEqual(DL.pages(['a'], 3, 'scroll').map(w => w.lines), [['a']], 'a short message is one page either way');
  assert.deepEqual(DL.pages([], 2, 'scroll').map(w => w.lines), [[]]);
  assert.ok(read('js/kit/scenes/dialogue.js').includes("KIT.look.get('dialogue.pageTurn', 'clear')"), 'the message box asks the look how its pages turn');
});

test('look: a box out of the hero\'s way goes to the top only when the hero is in the bottom half', () => {
  const place = KIT.dialogueLayout.place;
  assert.equal(place('bottom', 0.7, 'avoid-hero'), 'top');
  assert.equal(place('middle', 0.9, 'avoid-hero'), 'middle', 'a line told where to go stays there');
  assert.equal(place('bottom', 0.3, 'avoid-hero'), 'bottom');
  assert.equal(place('bottom', 0.7, 'bottom'), 'bottom', 'only when the look asks for it');
  assert.equal(place('bottom', null, 'avoid-hero'), 'bottom', 'no hero to look at (the title, a preview): where it was told');
  assert.equal(place(undefined, 0.9, 'avoid-hero'), 'top', 'no position is the bottom');
});

test('look: typing speeds are the look\'s, and the player still picks which', () => {
  try {
    L.use({ ui: { base: 'handheld' } });
    assert.deepEqual(L.get('dialogue.speeds'), { slow: 8, normal: 16, fast: 60 }, 'Handheld types at a handheld\'s pace');
    L.use({ ui: { base: 'soul' } });
    assert.equal(L.get('dialogue.at'), 'avoid-hero');
    assert.equal(L.get('choice.place'), 'in-box');
    L.use({ ui: { base: 'dream' } });
    assert.equal(L.get('choice.place'), 'beside-box');
    L.use({ ui: { base: 'handheld' } });
    assert.equal(L.get('choice.place'), 'above-box');
    assert.equal(L.get('dialogue.pageTurn'), 'scroll');
  } finally { L.use(null); }
  assert.ok(read('js/kit/scenes/dialogue.js').includes("KIT.look.get('dialogue.speeds', SPEEDS)"), 'the typing reads them');
  assert.ok(read('js/kit/scenes/dialogue.js').includes("KIT.look.sound('page')"), 'and a page turn has its sound');
});

test('look: an arrow in a row or a grid of answers moves the way it points', () => {
  const nav = KIT.ui.nav;
  /** Boxes of 100×40, laid out `cols` across in reading order, as a grid of answers is. */
  const grid = (n, cols) => Array.from({ length: n }, (_, i) => ({ left: (i % cols) * 100, top: Math.floor(i / cols) * 40, width: 100, height: 40 }));
  const column = grid(3, 1), row = grid(2, 2), two = grid(4, 2);
  assert.equal(nav(column, 0, 'down', true), 1, 'a column: down is the next');
  assert.equal(nav(column, 2, 'down', true), 0, 'and from the last, round to the first');
  assert.equal(nav(column, 2, 'down', false), 2, 'or not, without wrap');
  assert.equal(nav(row, 0, 'right', true), 1, 'a row: right is the next');
  assert.equal(nav(row, 1, 'right', true), 0, 'and round to the first');
  assert.equal(nav(row, 0, 'down', true), 0, '▼ on Yes beside No goes nowhere: nothing is under it');
  assert.equal(nav(two, 0, 'down', true), 2, 'a 2×2 grid: down from the top left is the bottom left');
  assert.equal(nav(two, 0, 'right', true), 1, 'and right is the top right');
  // The grid that was found: North South / East West / Stay, two across.
  const five = grid(5, 2);
  assert.equal(nav(five, 1, 'down', true), 3, '▼ from South is West, under it — it was East, in reading order');
  assert.equal(nav(five, 3, 'up', true), 1, '▲ from West is South');
  assert.equal(nav(five, 2, 'left', false), 2, '◀ from the left-hand column goes nowhere without wrap');
  assert.equal(nav(five, 2, 'left', true), 3, 'and round its own row with it, not up to the row before');
  assert.equal(nav(five, 4, 'down', true), 0, '▼ from the last, alone on its row, round to the top of its column');
  assert.equal(nav(five, 3, 'down', true), 4, '▼ from West, with nothing under it, is the nearest below');
  const unseen = grid(3, 3).map(() => ({ left: 0, top: 0, width: 0, height: 0 }));
  assert.equal(nav(unseen, 0, 'right', true), 1, 'answers nobody has laid out yet move in reading order');
  assert.equal(nav(unseen, 0, 'left', true), 2);
  assert.equal(nav([], 0, 'down', true), 0);
  assert.ok(read('js/kit/scenes/dialogue.js').includes('UI.nav('), 'the choice scene moves with it');
});

test('look: a toast stays as long as the look says', () => {
  try {
    L.use({ ui: { toast: { ms: 4000 } } });
    assert.equal(L.get('toast.ms', 1600), 4000);
    L.use({ ui: { toast: { ms: 99999 } } });
    assert.equal(L.get('toast.ms', 1600), 6000, 'pulled into range');
  } finally { L.use(null); }
  assert.ok(read('js/kit/scenes/dialogue.js').includes("KIT.look.get('toast.ms', 1600)"), 'KIT.toast asks the look when the caller did not say');
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
