// e2e/look.js — the game's look, and a phone that plays it with fingers only.
//
//   NODE_PATH=$(npm root -g) node e2e/look.js
//   LOOK_SNAPSHOT=write NODE_PATH=$(npm root -g) node e2e/look.js   (rewrites the fixture)
//
// Beat 0 is the proof that the look layer changed nothing. Every colour, border,
// radius, font and shadow in css/kit.css became `var(--kit-*, <the same
// literal>)`, and a unit test holds the literals to the token table — but a
// typo in a shorthand, a lost `inset`, a `calc()` that rounds differently, are
// things only a browser can see. So the browser reads the computed style of
// about fifty pieces of the game's chrome, on a phone and on a laptop, and
// compares them with test/fixtures/look/kit-computed.json, which was written
// from the stylesheet BEFORE it was tokenised. A pixel diff would say the same
// thing less usefully: this one names the element and the property.
//
// Beat 1 is the phone: taps and the on-screen pad only (no keyboard, no mouse).
// It walks the fixes that came with the groundwork — ☰ refused during a
// cutscene, the in-game Reduce motion reaching text effects, A on the pad
// confirming name entry (but not an A or a ☰ meant for the line before it, and
// saying so when it does not), OK and Cancel in the author's words, B out of a
// list the menu was opened on, the save list that said "Loading…" forever, B
// while a save is still being written, the menu's open and close sounds on
// every way in, and a module's line in its speaker's voice.
//
// Beat 2 is a laptop's keyboard, for the keys the phone does not have: Escape,
// which cancels the name box wherever the caret is, and Enter, which both
// turns a page and answers the box.
//
// Beat 3 is picking a look, on a phone, with fingers: Creator Mode ▸ Look, a
// live preview in the top half, every control a thumb can hit, every part of
// the preview whole and each one a tap away from its settings, Soul in one
// tap and one undo step, three quick taps on a stepper as one step, a colour
// dragged as one step, a tap on the preview opening the part it landed on, a
// two-finger tap taking it back, an undo made on the map reaching the page —
// and then the game itself, in the look, compared with the preview.
//
// Beat 4 is the preview on a laptop: Phone | Fill.
//
// Beat 5 is a shorter phone, an iPhone's Safari with its bars showing: the
// title shrunk to fit the preview, and a toast in the middle kept off the
// chapter card's words.
//
// Beat 6 is fonts and feel, on a phone, with fingers: a font file brought in
// and used for what people say (and Game › Import knowing it too), Line
// spacing stepped without stray decimals, a page scrolling up a line in the
// preview's Try, then Handheld's two-line box whose page scrolls up a line
// with a sound, Soul's box stepping out of the hero's way and its answers
// inside the box under the line that asked, Dream's answers in a window
// beside it (a row kept a row, a long question's box kept whole, a portrait
// kept in its corner), and a box that pops open only where things may move.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html') + '?fast=1';
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'look', 'kit-computed.json');
const WRITE = process.env.LOOK_SNAPSHOT === 'write';
const IGNORE = /fonts\.googleapis|fonts\.gstatic|ERR_CERT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_FAILED.*fonts|AudioContext/i;

let failures = 0;
const log = (...a) => console.log(...a);
const beat = (n, what) => log(`\n--- ${n}. ${what} ---`);
function check(ok, what) {
  if (ok) log('  ok  ' + what);
  else { failures++; log('  FAIL ' + what); }
  return ok;
}
async function expect(page, fn, what, arg, timeout) {
  try { await page.waitForFunction(fn, arg, { timeout: timeout || 6000 }); return check(true, what); }
  catch (e) { return check(false, what + '  (timed out)'); }
}

// ---- beat 0: what the chrome looks like ------------------------------------------

/** The properties read off every element. Layout sizes are left out: they are the page's, not the look's. */
const PROPS = [
  'display', 'color', 'backgroundColor', 'backgroundImage',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
  'boxShadow', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'textShadow', 'textTransform',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'minHeight',
  'opacity', 'animationName', 'alignItems', 'justifyContent', 'content',
];

/**
 * Read the listed elements in the page, in the same task as whatever put them
 * on screen: a toast in fast mode lives 200 ms and a chapter card 80, so a
 * round trip to Node between showing and reading would read an empty host.
 * A missing element is recorded as null, so the fixture also says what exists.
 */
const READ = `(list, props) => {
  const out = {};
  for (const [label, sel, pseudo] of list) {
    const el = document.querySelector(sel);
    if (!el) { out[label] = null; continue; }
    const cs = getComputedStyle(el, pseudo || null);
    const row = {};
    for (const p of props) {
      // 'content' only means something on a pseudo-element.
      if (p === 'content' && !pseudo) continue;
      row[p] = cs[p];
    }
    out[label] = row;
  }
  return out;
}`;
const read = (page, list) => page.evaluate(`(${READ})(${JSON.stringify(list)}, ${JSON.stringify(PROPS)})`);

const TITLE = [
  ['stage', '#stage'], ['screen', '#screen'], ['title host', '#screen-title'],
  ['title inner', '#screen-title .kit-title-inner'], ['title', '#screen-title .kit-title'],
  ['title subtitle', '#screen-title .kit-subtitle'], ['title pitch', '#screen-title .kit-pitch'],
  ['title hint', '#screen-title .kit-hint'],
  ['title pick', '#screen-title .kit-menu-item.is-selected'], ['title pick marker', '#screen-title .kit-menu-item.is-selected', '::before'],
  ['title disabled', '#screen-title .kit-menu-item[data-action="continue"]'],
  ['title item', '#screen-title .kit-menu-item[data-action="settings"]'],
  ['title item marker', '#screen-title .kit-menu-item[data-action="settings"]', '::before'],
  ['pad', '#controls'], ['pad dir', '#controls [data-btn="up"][data-player="1"]'],
  ['pad a', '#controls .kit-a'], ['pad b', '#controls .kit-b'], ['pad menu', '#controls .kit-menu'],
];
const LIST = (host) => [
  [host + ' host', '#pause-menu'], [host + ' panel', '#pause-menu .kit-panel'],
  [host + ' title', '#pause-menu .kit-panel-title'],
  [host + ' pick', '#pause-menu .kit-menu-item.is-selected'], [host + ' pick marker', '#pause-menu .kit-menu-item.is-selected', '::before'],
  [host + ' row', '#pause-menu .kit-menu-item:not(.is-selected):not(:disabled)'],
  [host + ' row marker', '#pause-menu .kit-menu-item:not(.is-selected):not(:disabled)', '::before'],
  [host + ' label', '#pause-menu .kit-item-label'], [host + ' value', '#pause-menu .kit-item-value'],
  [host + ' hint', '#pause-menu .kit-hint'],
];
const TALK = (as) => [
  [as + ' host', '#dialogue'], [as + ' box', '#dialogue .kit-box'], [as + ' face', '#dialogue .kit-facebox'],
  [as + ' wrap', '#dialogue .kit-textwrap'], [as + ' name', '#dialogue .kit-name'], [as + ' text', '#dialogue .kit-text'],
  [as + ' line', '#dialogue .kit-line'], [as + ' run', '#dialogue .kit-line > span'], [as + ' next', '#dialogue .kit-next'],
];

/** Still in the intro: a message on screen, or the script that shows them still running. */
function stillInIntro(state) { return state[0] !== 'map' || state[1]; }

/** Put every piece of chrome on screen in turn and read it. The staging is setup, not play. */
async function snapshot(browser, size, touch) {
  const ctx = await browser.newContext({ viewport: size, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 3 : 1 });
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted && KIT.game.scene() === 'title', undefined, { timeout: 30000 });
  await page.waitForTimeout(300);
  const out = {};
  Object.assign(out, await read(page, TITLE));

  // Settings, from the title.
  await page.evaluate(() => document.querySelector('#screen-title [data-action="settings"]').click());
  await page.waitForFunction(() => !!document.querySelector('#pause-menu [data-action="cycle:textSpeed"]'));
  Object.assign(out, await read(page, LIST('settings')));
  await page.evaluate(() => KIT.scenes.top().finish('close'));

  // The intro's first message, after New Game.
  await page.evaluate(() => document.querySelector('#screen-title [data-action="new-game"]').click());
  await page.waitForFunction(() => KIT.game.scene() === 'dialogue' && !!document.querySelector('#dialogue .kit-next.is-ready'), undefined, { timeout: 10000 });
  Object.assign(out, await read(page, TALK('intro')));
  for (let i = 0; i < 20 && stillInIntro(await page.evaluate(() => [KIT.game.scene(), KIT.game.world && KIT.game.world.busy])); i++) {
    await page.evaluate(() => KIT.game.press('a'));
    await page.waitForTimeout(120);
  }

  // A named speaker with a face, on the dimmed background, with a text effect.
  await page.evaluate(() => {
    const face = KIT.registry('faces').ids()[0];
    KIT.scenes.run('dialogue', { who: 'Mira', face, bg: 'dim', text: 'Hello {fx:wave}there{/fx}.' });
  });
  await page.waitForFunction(() => !!document.querySelector('#dialogue .kit-next.is-ready'));
  Object.assign(out, await read(page, TALK('named').concat([['named effect', '#dialogue .kit-fx-wave']])));
  await page.evaluate(() => KIT.scenes.top().finish(true));

  // A choice.
  await page.evaluate(() => { KIT.scenes.run('choice', { prompt: 'Ready?', options: [{ text: 'Yes', index: 0 }, { text: 'No', index: 1 }] }); });
  await page.waitForFunction(() => !!document.querySelector('#choice .kit-option'));
  Object.assign(out, await read(page, [
    ['choice host', '#choice'], ['choice panel', '#choice .kit-panel'], ['choice prompt', '#choice .kit-prompt'],
    ['choice list', '#choice .kit-list'],
    ['choice pick', '#choice .kit-option.is-selected'], ['choice pick marker', '#choice .kit-option.is-selected', '::before'],
    ['choice row', '#choice .kit-option[data-index="1"]'], ['choice row marker', '#choice .kit-option[data-index="1"]', '::before'],
  ]));
  await page.evaluate(() => KIT.scenes.top().finish(0));

  // Name entry.
  await page.evaluate(() => { KIT.scenes.run('nameEntry', { prompt: 'Name?' }); });
  await page.waitForFunction(() => !!document.querySelector('#choice .kit-input'));
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  Object.assign(out, await read(page, [
    ['entry panel', '#choice .kit-panel.kit-modal'], ['entry prompt', '#choice .kit-modal .kit-prompt'],
    ['entry field', '#choice .kit-input'], ['entry row', '#choice .kit-row'],
    ['entry cancel', '#choice .kit-row [data-action="cancel"]'], ['entry ok', '#choice .kit-row [data-action="ok"]'],
  ]));
  await page.evaluate(() => KIT.scenes.top().finish(null));

  // The pause menu, then its save list.
  await page.evaluate(() => { KIT.game.openMenu(); });
  await page.waitForFunction(() => !!document.querySelector('#pause-menu [data-action="menu:save"]'));
  Object.assign(out, await read(page, LIST('pause')));
  await page.evaluate(() => document.querySelector('#pause-menu [data-action="menu:save"]').click());
  await page.waitForFunction(() => !!document.querySelector('#pause-menu [data-action="slot:1"]'));
  Object.assign(out, await read(page, LIST('save').concat([
    ['save locked', '#pause-menu .kit-menu-item:disabled'], ['save note', '#pause-menu .kit-item-note'],
  ])));
  await page.evaluate(() => KIT.scenes.top().finish('close'));

  // A toast and a chapter card, read in the same task that shows them.
  Object.assign(out, await page.evaluate(`(() => { KIT.toast('Saved.'); return (${READ})(${JSON.stringify([['toast host', '#toast'], ['toast', '#toast .kit-toast-pill']])}, ${JSON.stringify(PROPS)}); })()`));
  Object.assign(out, await page.evaluate(`(() => {
    const card = KIT.scenes.push('chapter', { title: 'Chapter One', subtitle: 'the start' });
    const got = (${READ})(${JSON.stringify([['chapter host', '#chapter'], ['chapter card', '#chapter .kit-card'], ['chapter title', '#chapter .kit-chapter-title'], ['chapter sub', '#chapter .kit-chapter-sub']])}, ${JSON.stringify(PROPS)});
    card.finish(true);
    return got;
  })()`));

  // What the look layer promises about the page itself.
  const page0 = await page.evaluate(() => {
    const style = document.getElementById('kit-look');
    const stage = document.getElementById('stage');
    const out = {
      style: !!style, empty: !!style && style.textContent === '', inHead: !!style && style.parentNode === document.head,
      stageStyle: stage.getAttribute('style'), motion: stage.getAttribute('data-kit-motion'), fast: stage.hasAttribute('data-kit-fast'),
    };
    // A host of its own for anything that draws over the game: made once, in
    // #screen, directly behind the one it names — the paint order between two
    // overlays of the same z-index is their order in the page.
    if (KIT.ui.host) {
      const a = KIT.ui.host('kit-e2e-host', { after: 'game-canvas' });
      const b = KIT.ui.host('kit-e2e-host', { after: 'toast' });
      out.host = !!a && a === b && a.parentNode.id === 'screen' && a.previousElementSibling.id === 'game-canvas'
        && a.classList.contains('overlay') && a.hidden && document.querySelectorAll('#kit-e2e-host').length === 1;
      a.remove();
    }
    return out;
  });
  await ctx.close();
  return { styles: out, page: page0 };
}

/** The first difference between two snapshots, as "element: property was → is". */
function differences(want, got) {
  const out = [];
  for (const label of new Set(Object.keys(want).concat(Object.keys(got)))) {
    const a = want[label], b = got[label];
    if (a === null || b === null || a === undefined || b === undefined) {
      if (a !== b) out.push(`${label}: ${a ? 'there' : 'missing'} → ${b ? 'there' : 'missing'}`);
      continue;
    }
    for (const p of new Set(Object.keys(a).concat(Object.keys(b)))) {
      if (a[p] !== b[p]) out.push(`${label}: ${p} ${JSON.stringify(a[p])} → ${JSON.stringify(b[p])}`);
    }
  }
  return out;
}

// ---- beat 1: a phone, with fingers ------------------------------------------------

/**
 * Press an on-screen pad button the way a finger does: a touch pointer down on
 * it, held, and up. The pad reads the button under the pointer, so the event
 * carries the button's own centre. The pattern is e2e/touch.js's.
 */
const PAD = `async ({ btn, ms }) => {
  const b = document.querySelector('[data-btn="' + btn + '"][data-player="1"]');
  if (!b) return false;
  const r = b.getBoundingClientRect();
  const at = { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
  const ev = (type) => new PointerEvent(type, Object.assign({ pointerId: 41, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true }, at));
  b.dispatchEvent(ev('pointerdown'));
  await new Promise(z => setTimeout(z, ms || 60));
  b.dispatchEvent(ev('pointerup'));
  await new Promise(z => setTimeout(z, 80));
  return true;
}`;
const pad = (page, btn, ms) => page.evaluate(`(${PAD})(${JSON.stringify({ btn, ms })})`);
const scene = (page) => page.evaluate(() => KIT.game.scene());

/** Tap the message box until the script behind it has finished and the map is ours. */
async function tapThrough(page, limit) {
  for (let i = 0; i < (limit || 30); i++) {
    const s = await page.evaluate(() => ({ top: KIT.game.scene(), busy: !!(KIT.game.world && KIT.game.world.busy), main: KIT.interpreter.mainBusy() }));
    if (s.top === 'map' && !s.busy && !s.main) return true;
    if (s.top === 'dialogue') await page.locator('#dialogue').tap();
    await page.waitForTimeout(120);
  }
  return false;
}

/** A page at the title, with its console and page errors collected. */
async function open(browser, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(PAGE);
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted && KIT.game.scene() === 'title', undefined, { timeout: 30000 });
  await page.waitForTimeout(300);
  return { ctx, page, errors };
}
function noErrors(errors) {
  check(errors.length === 0, `no console errors or page errors${errors.length ? ': ' + errors[0] : ''}`);
  for (const e of errors) log('     ! ' + e);
}
/** How long the name box wants A and ☰ left alone before either counts (SETTLE in js/kit/scenes/dialogue.js), and a little more. */
const SETTLED = 1000;

async function phone(browser) {
  const { ctx, page, errors } = await open(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.evaluate(() => {                                                    // (setup) note which sound each part of the interface asks for
    window.__roles = [];
    const ask = KIT.look.sound;
    KIT.look.sound = function (role) { window.__roles.push(role); return ask.apply(this, arguments); };
  });
  const heard = () => page.evaluate(() => window.__roles.splice(0));
  const count = (list, role) => list.filter(r => r === role).length;

  beat('1.0', 'Settings from the title, and B on the pad');
  await page.locator('#screen-title [data-action="settings"]').tap();
  await expect(page, () => KIT.game.scene() === 'menu' && !!document.querySelector('#pause-menu [data-action="toggle:reduceMotion"]'), 'Settings opens over the title');
  await pad(page, 'b');
  await expect(page, () => KIT.game.scene() === 'title', 'B goes back to the title');
  check(await page.evaluate(() => document.getElementById('pause-menu').hidden), 'and not to a "Paused" menu over it');
  const r0 = await heard();
  check(count(r0, 'open') === 1 && count(r0, 'close') === 1, `the menu asked for its open sound and its close sound (${r0.join(', ')})`);

  beat('1.1', 'New Game, and the intro tapped through');
  await page.locator('#screen-title [data-action="new-game"]').tap();
  await expect(page, () => KIT.scenes.ids().some(id => id === 'dialogue' || id === 'chapter'), 'the intro starts');
  check(await tapThrough(page), 'tapping the box ends the intro, and the map is ours again');

  beat('1.2', '☰ waits for the cutscene');
  await page.evaluate(() => { KIT.game.world.busy = true; });                  // (setup) a cutscene is running
  await pad(page, 'menu');
  await page.waitForTimeout(150);
  check(await scene(page) === 'map', `☰ during a cutscene leaves the map where it is (${await scene(page)})`);
  await page.evaluate(() => { KIT.game.world.busy = false; });                 // (setup) it has ended
  await pad(page, 'menu');
  await expect(page, () => KIT.game.scene() === 'menu', '☰ after it opens the pause menu');

  beat('1.3', 'Reduce motion reaches the text effects');
  await page.locator('#pause-menu [data-action="menu:settings"]').tap();
  await page.locator('#pause-menu [data-action="toggle:reduceMotion"]').tap();
  await page.locator('#pause-menu [data-action="back"]').tap();
  await page.locator('#pause-menu [data-action="close"]').tap();
  await expect(page, () => KIT.game.scene() === 'map', 'Keep playing closes the menu');
  check(await page.evaluate(() => document.getElementById('stage').getAttribute('data-kit-motion')) === 'reduce', '#stage says motion is reduced');
  const WAVE = () => { KIT.scenes.run('dialogue', { text: 'A {fx:wave}wavy{/fx} word.' }); };
  const waveName = () => page.evaluate(() => { const el = document.querySelector('#dialogue .kit-fx-wave'); return el ? getComputedStyle(el).animationName : null; });
  await page.evaluate(WAVE);                                                     // (setup) a line with an effect
  await expect(page, () => !!document.querySelector('#dialogue .kit-fx-wave'), 'the line with a wave is on screen');
  check(await waveName(page) === 'none', `and the wave stands still (${await waveName(page)})`);
  check(await tapThrough(page), 'a tap closes it');
  await pad(page, 'menu');
  await expect(page, () => KIT.game.scene() === 'menu', '☰ opens the menu again');
  await page.locator('#pause-menu [data-action="menu:settings"]').tap();
  await page.locator('#pause-menu [data-action="toggle:reduceMotion"]').tap();
  await page.locator('#pause-menu [data-action="back"]').tap();
  await page.locator('#pause-menu [data-action="close"]').tap();
  await expect(page, () => KIT.game.scene() === 'map', 'and closes');
  check(await page.evaluate(() => document.getElementById('stage').hasAttribute('data-kit-motion')) === false, 'motion is normal again on #stage');
  await page.evaluate(WAVE);                                                     // (setup) the same line again
  await expect(page, () => !!document.querySelector('#dialogue .kit-fx-wave'), 'the same line again');
  check(await waveName(page) === 'kit-fx-wave', `and now it waves (${await waveName(page)})`);
  check(await tapThrough(page), 'a tap closes it');
  const r1 = await heard();
  check(count(r1, 'open') === 2 && count(r1, 'close') === 2, `☰ twice: two open sounds and two close sounds (${count(r1, 'open')} / ${count(r1, 'close')})`);

  beat('1.4', 'name entry: the author\'s words, and A on the pad');
  await page.evaluate(() => {                                                    // (setup) Terms of the author's own
    const p = JSON.parse(JSON.stringify(KIT.game.project));
    p.strings = Object.assign({}, p.strings, { ok: 'Sure', cancel: 'Nope' });
    KIT.game.loadProject(p);
    window.__named = undefined;
    KIT.scenes.run('nameEntry', { prompt: 'Name?' }).then((v) => { window.__named = v; });
  });
  await expect(page, () => !!document.querySelector('#choice [data-role="name-entry"]'), 'the name box is up');
  const words = await page.evaluate(() => ({
    ok: document.querySelector('#choice [data-action="ok"]').textContent,
    cancel: document.querySelector('#choice [data-action="cancel"]').textContent,
  }));
  check(words.ok === 'Sure' && words.cancel === 'Nope', `the buttons say what the author wrote (${words.ok} / ${words.cancel})`);
  await page.locator('[data-role="name-entry"]').fill('Ava');
  await pad(page, 'a');
  await expect(page, () => window.__named === 'Ava', 'A on the pad takes the name, at once when the player has typed one');
  check(await page.evaluate(() => window.__named) === 'Ava', `the scene answered "${await page.evaluate(() => window.__named)}"`);
  const askOld = () => page.evaluate(() => {                                    // (setup) the box again, with a name in it
    window.__named = undefined;
    KIT.scenes.run('nameEntry', { prompt: 'Name?', current: 'Old' }).then((v) => { window.__named = v; });
  });
  const shook = (action) => page.evaluate((a) => { const b = document.querySelector('#choice [data-action="' + a + '"]'); return !!b && b.classList.contains('is-shaking'); }, action);
  await askOld();
  await expect(page, () => !!document.querySelector('#choice [data-role="name-entry"]'), 'the name box is up again');
  await heard();
  await pad(page, 'a');
  check(await page.evaluate(() => window.__named) === undefined, 'A straight away, with nothing typed, does not take the name yet');
  check(await shook('ok') && count(await heard(), 'buzzer') === 1, 'and says so: OK shakes, to the buzzer');
  await pad(page, 'menu');
  check(await page.evaluate(() => window.__named) === undefined && await shook('cancel'), 'nor does ☰, and it is Cancel that shakes');
  await page.waitForTimeout(SETTLED);
  await pad(page, 'a');
  await expect(page, () => window.__named === 'Old', 'after a pause, A takes the name as it stands');
  await askOld();
  await expect(page, () => !!document.querySelector('#choice [data-role="name-entry"]'), 'the name box once more');
  await page.waitForTimeout(SETTLED);
  await pad(page, 'menu');
  await expect(page, () => window.__named === null, 'and ☰, after a pause, is Cancel, the way it is "back" everywhere else');

  beat('1.5', 'paging a line with A or ☰ does not answer the name box after it');
  const lineThenName = () => page.evaluate(() => {                              // (setup) what a catch or a birthday runs: a line, then the name box
    window.__script = 'running';
    const cmds = KIT.screenplay.parse('Mom: Remind me, what do you like to be called?\n@nameEntry').commands;
    KIT.interpreter.run(cmds, KIT.game.world.makeCtx(null, 'p1')).then(() => { window.__script = 'done'; });
  });
  const hero = () => page.evaluate(() => KIT.game.world.save.heroes[0].name);
  /** Press `btn` about four times a second, the way a line gets paged through; how many landed on the box. */
  const mash = async (btn) => {
    let onBox = 0;
    for (let i = 0; i < 8; i++) {
      if (await scene(page) === 'nameEntry') onBox++;
      await pad(page, btn);
      await page.waitForTimeout(60);
    }
    return onBox;
  };
  for (const [btn, name] of [['a', 'A'], ['menu', '☰']]) {
    const before = await hero();
    await lineThenName();
    await expect(page, () => KIT.game.scene() === 'dialogue', `the line is up (paged with ${name})`);
    const onBox = await mash(btn);
    check(onBox >= 4, `most of those presses of ${name} landed on the name box (${onBox} of 8)`);
    check(await scene(page) === 'nameEntry', `and it is still waiting for a name (${await scene(page)})`);
    check(await page.evaluate(() => window.__script) === 'running', 'the script is still waiting for it');
    check(await shook(btn === 'a' ? 'ok' : 'cancel'), `the box met the early presses of ${name} with a shake of the button they would have pressed`);
    if (btn === 'a') {
      await page.locator('[data-role="name-entry"]').fill('Kit');
      await pad(page, 'a');
      await expect(page, () => window.__script === 'done', 'then the player types a name, and A answers at once');
      check(await hero() === 'Kit', `the hero is called what the player typed (${before} → ${await hero()})`);
    } else {
      await page.waitForTimeout(SETTLED);                                        // the player stops, reads, and means it
      await pad(page, 'a');
      await expect(page, () => window.__script === 'done', 'then one A, after a pause, answers it');
      check(await hero() === before, `with the name as it stood (${before} → ${await hero()})`);
    }
  }

  beat('1.6', 'the save list, opened on its own; and B while a save is being written');
  const saveList = async (what) => {
    await page.evaluate(() => { KIT.scenes.run('menu', { mode: 'save' }); });    // (setup) a save list something opened by itself
    return expect(page, () => { const b = document.querySelector('#pause-menu [data-action="slot:1"]'); return !!b && b.offsetParent !== null; }, what);
  };
  await saveList('slot 1 is there');
  const loading = await page.evaluate(() => Array.from(document.querySelectorAll('#pause-menu .kit-menu-item')).some(b => /Loading/.test(b.textContent)));
  check(!loading, 'and nothing still says "Loading…"');
  await pad(page, 'b');
  await expect(page, () => KIT.game.scene() === 'map', 'B closes it, and hands over no pause menu');
  await saveList('opened again');
  await page.locator('#pause-menu [data-action="slot:1"]').tap();
  await expect(page, () => KIT.game.scene() === 'map', 'saving into a slot closes it too', undefined, 8000);
  check(await page.evaluate(() => document.getElementById('pause-menu').hidden), 'with no "Paused" left behind');
  await saveList('and again');
  await page.locator('#pause-menu [data-action="back"]').tap();
  await expect(page, () => KIT.game.scene() === 'map', 'Back closes it');
  await page.evaluate(() => {                                                    // (setup) a save that takes a moment, like a slow phone's storage
    const real = KIT.game.save;
    window.__saving = null;
    KIT.game.save = function () {
      const args = arguments;
      window.__saving = new Promise((res) => setTimeout(res, 400)).then(() => real.apply(KIT.game, args)).then((ok) => { KIT.game.save = real; window.__saving = 'done'; return ok; });
      return window.__saving;
    };
  });
  await pad(page, 'menu');
  await expect(page, () => KIT.game.scene() === 'menu', '☰ opens the pause menu');
  await page.locator('#pause-menu [data-action="menu:save"]').tap();
  await expect(page, () => !!document.querySelector('#pause-menu [data-action="slot:1"]'), 'its Save shows the slots');
  await page.locator('#pause-menu [data-action="slot:1"]').tap();
  await pad(page, 'b');                                                          // back a step while the save is still being written
  const paused = () => page.evaluate(() => { const t = document.querySelector('#pause-menu .kit-panel-title'); return KIT.game.scene() === 'menu' && !!t && t.textContent; });
  check(await paused() === 'Paused', `B while saving steps back to the pause menu (${await paused()})`);
  await expect(page, () => window.__saving === 'done', 'the save finishes');
  await page.waitForTimeout(300);
  check(await paused() === 'Paused', `and the pause menu is still there once "Saved." has come and gone (${await paused()})`);
  await pad(page, 'b');
  await expect(page, () => KIT.game.scene() === 'map', 'B closes it');

  beat('1.7', 'every way into the menu sounds the same on the way out');
  await heard();
  await page.evaluate(() => { KIT.game.ports.game.menu(); });                   // (setup) what a script's @menu does
  await expect(page, () => KIT.game.scene() === 'menu', 'a script\'s menu opens');
  await pad(page, 'b');
  await expect(page, () => KIT.game.scene() === 'map', 'B closes it');
  const r2 = await heard();
  check(count(r2, 'open') === 1 && count(r2, 'close') === 1, `one open sound, one close sound (${r2.join(', ')})`);

  beat('1.8', 'a line from a module speaks in its speaker\'s voice');
  await page.evaluate(() => {                                                    // (setup) a red voice, and Mira who has it
    // Something else left in the message host, the way a module's own screen
    // can leave it: the box used to be built only into an EMPTY host, and then
    // the next line found no name tag to write to.
    document.getElementById('dialogue').innerHTML = '<div class="kit-scroll">left behind</div>';
    KIT.registry('voices').add({ id: 't-red', name: 'Red', color: '#ff0000' });
    KIT.game.project.cast = Object.assign({}, KIT.game.project.cast, { mira: { name: 'Mira', voice: 't-red' } });
    KIT.game.ports.io.say({ who: 'mira', text: 'hi' });
  });
  await expect(page, () => { const n = document.querySelector('#dialogue .kit-name'); return !!n && !n.hidden; }, 'the name tag is up');
  const ink = await page.evaluate(() => document.querySelector('#dialogue .kit-name').style.color);
  check(ink === 'rgb(255, 0, 0)', `the name is in Mira's red (${ink})`);
  check(await tapThrough(page), 'a tap closes it');

  beat('1.9', 'nothing broke');
  noErrors(errors);
  await ctx.close();
}

// ---- beat 2: a keyboard -------------------------------------------------------------

async function keyboard(browser) {
  const { ctx, page, errors } = await open(browser, { viewport: { width: 1280, height: 800 } });
  const ask = () => page.evaluate(() => {                                        // (setup) the name box, with a name in it already
    window.__named = undefined;
    KIT.scenes.run('nameEntry', { prompt: 'Name?', current: 'Old' }).then((v) => { window.__named = v; });
  });
  const caret = () => page.evaluate(() => !!document.activeElement && document.activeElement.getAttribute('data-role') === 'name-entry');

  beat('2.1', 'Escape cancels the name box wherever the caret is');
  await ask();
  await expect(page, () => !!document.activeElement && document.activeElement.getAttribute('data-role') === 'name-entry', 'the caret starts in the field');
  await page.keyboard.press('Escape');
  await expect(page, () => window.__named === null, 'Escape there cancels');
  await ask();
  await expect(page, () => !!document.activeElement && document.activeElement.getAttribute('data-role') === 'name-entry', 'the box again');
  await page.locator('#choice .kit-prompt').click();
  check(!(await caret()), 'the caret has left the field');
  await page.waitForTimeout(SETTLED);                                            // out of the field Escape is the keyboard's ☰, which waits for the box to settle
  await page.keyboard.press('Escape');
  await expect(page, () => window.__named === null, 'and Escape cancels here too — it used to take "Old"');

  beat('2.2', 'Z is A, and Enter in the field is OK');
  await ask();
  await expect(page, () => !!document.querySelector('#choice [data-role="name-entry"]'), 'the box again');
  await page.locator('#choice .kit-prompt').click();
  await page.waitForTimeout(SETTLED);
  await page.keyboard.press('KeyZ');
  await expect(page, () => window.__named === 'Old', 'Z takes the name as it stands');
  await ask();
  await expect(page, () => !!document.activeElement && document.activeElement.getAttribute('data-role') === 'name-entry', 'the box again');
  await page.keyboard.type('Zed');
  await page.keyboard.press('Enter');
  await expect(page, () => window.__named === 'Zed', 'typing a Z types a Z, and Enter takes the name at once');

  beat('2.3', 'Enter pressed through a line does not answer the name box after it');
  await page.evaluate(() => {                                                    // (setup) a line, then the name box, the way a script runs them
    window.__named = undefined;
    KIT.scenes.run('dialogue', { who: 'Mom', text: 'Remind me, what do you like to be called?' })
      .then(() => KIT.scenes.run('nameEntry', { prompt: 'Name?', current: 'Old' }))
      .then((v) => { window.__named = v; });
  });
  await expect(page, () => KIT.game.scene() === 'dialogue', 'the line is up');
  let inField = 0;
  for (let i = 0; i < 8; i++) {                                                  // Enter, four times a second
    if (await caret()) inField++;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
  }
  check(inField >= 4, `most of those presses landed in the name field (${inField} of 8)`);
  check(await page.evaluate(() => KIT.game.scene() === 'nameEntry' && window.__named === undefined), 'and the box is still waiting for a name');
  check(await page.evaluate(() => { const b = document.querySelector('#choice [data-action="ok"]'); return !!b && b.classList.contains('is-shaking'); }), 'OK shook at the Enters that came too soon');
  await page.waitForTimeout(SETTLED);
  await page.keyboard.press('Enter');
  await expect(page, () => window.__named === 'Old', 'one Enter after a pause takes the name as it stands');

  beat('2.4', 'nothing broke');
  noErrors(errors);
  await ctx.close();
}

// ---- beat 3: pick a look, on a phone ---------------------------------------------------

/** Read something inside the Look preview's shadow root. */
const inPreview = (page, fn, arg) => page.evaluate(`(() => {
  const host = document.querySelector('.ed-look-preview');
  const root = host && host.shadowRoot;
  return root ? (${fn})(root, ${JSON.stringify(arg === undefined ? null : arg)}) : null;
})()`);
const history = (page) => page.evaluate(() => KIT.editor.state.doc.history.length);
/** Two fingers tapping the preview: undo, the way it is on the map (the pattern of e2e/touch.js). */
const TWO_FINGERS = `(async () => {
  const el = document.querySelector('.ed-stage-panel');
  const r = el.getBoundingClientRect();
  const wait = (ms) => new Promise(z => setTimeout(z, ms));
  const send = (target, type, id, i) => target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch',
    isPrimary: i === 0, bubbles: true, cancelable: true, clientX: r.x + 80 + i * 30, clientY: r.y + 160 }));
  send(el, 'pointerdown', 31, 0); await wait(10); send(el, 'pointerdown', 32, 1);
  await wait(40);
  send(window, 'pointerup', 31, 0); await wait(8); send(window, 'pointerup', 32, 1);
  await wait(150);
})()`;
/** Every button and field a thumb can see in the Look panel and above the preview that is smaller than 44×44. */
const tooSmall = (page) => page.evaluate(() => {
  const out = [];
  for (const scope of [document.querySelector('.ed-panel-body[data-panel="look"]'), document.querySelector('.ed-look-chips'), document.querySelector('.ed-groups')]) {
    for (const el of scope ? scope.querySelectorAll('button, input, select') : []) {
      const r = el.getBoundingClientRect();
      if (el.offsetParent === null || !r.width || !r.height) continue;
      if (r.width < 44 || r.height < 44) out.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 16)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  }
  return out;
});
const section = (page, id) => page.locator(`.ed-look-section[data-section="${id}"]`);
/** A tap on the preview opened Colours at `key`: that row is flashed, and in the sheet where a thumb can see it. */
const flashedInView = (key) => `(() => {
  const row = document.querySelector('.ed-look-body .ed-f.is-flash[data-key="${key}"]');
  if (!row) return false;
  const r = row.getBoundingClientRect(), side = document.querySelector('.ed-side').getBoundingClientRect();
  return r.height > 0 && r.top >= side.top - 1 && r.bottom <= side.bottom + 1;
})()`;
/** Tap a point inside a part of the preview, `dx`/`dy` from its top left (the middle when not given). */
async function tapPart(page, sel, dx, dy) {
  const r = await inPreview(page, (root, s) => { const e = root.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, sel);
  if (!r) return false;
  await page.touchscreen.tap(r.x + (dx == null ? r.w / 2 : dx), r.y + (dy == null ? r.h / 2 : dy));
  return true;
}
/** Which of `sels` are not inside the preview's screen, top to bottom: missing counts, not drawn (hidden) does not. */
const wholeOnScreen = (page, sels) => inPreview(page, (root, list) => {
  const s = root.querySelector('#screen').getBoundingClientRect();
  return list.filter((sel) => {
    const e = root.querySelector(sel);
    if (!e) return true;
    if (!e.getClientRects().length) return false;
    const b = e.getBoundingClientRect();
    return b.top < s.top - 0.5 || b.bottom > s.bottom + 0.5;
  });
}, sels);
/** Whether the toast and the chapter card's words overlap in the Toast tab (null when the words gave way). */
const toastOnCard = (page) => inPreview(page, (root) => {
  const card = root.querySelector('#chapter .kit-card');
  if (!card || card.hidden) return null;
  const a = root.querySelector('.kit-toast-pill').getBoundingClientRect();
  return Array.from(card.children).some((w) => { const b = w.getBoundingClientRect(); return !(b.bottom <= a.top || b.top >= a.bottom || b.right <= a.left || b.left >= a.right); });
});
async function openSection(page, id) {
  if (await section(page, id).getAttribute('aria-expanded') !== 'true') await section(page, id).tap();
  await page.waitForFunction((s) => document.querySelector(`.ed-look-section[data-section="${s}"]`).getAttribute('aria-expanded') === 'true', id);
}

async function pickALook(browser) {
  const { ctx, page, errors } = await open(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

  beat('3.1', 'Creator Mode ▸ Look: the preview in the top half, and every control a thumb can hit');
  await page.locator('#screen-title [data-action="creator"]').tap();
  await expect(page, () => KIT.editor && KIT.editor.isOpen(), 'Creator Mode opens from the title');
  await page.locator('.ed-group[data-group="look"]').tap();
  await expect(page, () => { const p = document.querySelector('.ed-stage .ed-look-preview'); return !!p && p.offsetParent !== null && !!p.shadowRoot; }, 'the Look preview is in the stage, where the map was');
  check(!(await page.evaluate(() => document.querySelector('.ed-root').classList.contains('is-sheet-tall'))), 'and the sheet under it is the short one');
  await expect(page, () => { const r = document.querySelector('.ed-look-preview').shadowRoot; return !!r.querySelector('#dialogue:not([hidden]) .kit-line'); }, 'somebody is talking in it');
  const narrow = await page.evaluate(() => { const b = document.querySelector('.ed-group[data-group="problems"]'); return getComputedStyle(b.querySelector('.ed-group-label')).display === 'none' && b.getAttribute('aria-label') === 'Problems'; });
  check(narrow, 'five groups fit: Problems is ⚠ on a phone this narrow, and still called Problems');
  const small = [];
  for (const id of ['start', 'colours', 'fonts', 'box', 'typing', 'choice', 'cursor', 'menu', 'toast', 'pad', 'sounds']) {
    await openSection(page, id);
    for (const s of await tooSmall(page)) small.push(`${id}: ${s}`);
  }
  check(small.length === 0, `every button and field in every section, the tabs over the preview and the five groups with the grip, are at least 44×44${small.length ? ': ' + small.slice(0, 4).join('; ') : ''}`);
  const widths = await page.evaluate(() => { const p = document.querySelector('.ed-panel'); return { page: document.documentElement.scrollWidth, panel: p.scrollWidth, room: p.clientWidth }; });
  check(widths.page <= 390 && widths.panel <= widths.room, `nothing sticks out sideways (page ${widths.page}, panel ${widths.panel}/${widths.room})`);
  check(await page.evaluate(() => Array.from(document.querySelectorAll('.ed-toolbar .ed-zoom')).every(b => b.offsetParent === null)),
    'the map\'s zoom − and + are not in the toolbar: there is no map under the preview for them to zoom');

  beat('3.1b', 'the preview shows each part whole, and a tap on any of them opens its settings');
  await page.locator('.ed-look-chip[data-preview="menu"]').tap();
  await expect(page, () => !!document.querySelector('.ed-look-preview').shadowRoot.querySelector('#pause-menu:not([hidden]) .kit-hint'), 'the Menu tab shows the pause menu');
  const menuFit = await inPreview(page, (r) => {
    const s = r.querySelector('#screen').getBoundingClientRect();
    const rows = r.querySelectorAll('#pause-menu .kit-menu-item');
    const inside = (el) => { const b = el.getBoundingClientRect(); return b.top >= s.top && b.bottom <= s.bottom && b.left >= s.left && b.right <= s.right; };
    return { rows: rows.length, last: inside(rows[rows.length - 1]), hint: inside(r.querySelector('#pause-menu .kit-hint')) };
  });
  check(menuFit.rows >= 5 && menuFit.last && menuFit.hint, `all ${menuFit.rows} rows and the help line under them are inside the preview's screen (last row ${menuFit.last}, help line ${menuFit.hint})`);
  await page.locator('.ed-look-chip[data-preview="title"]').tap();
  await expect(page, () => !!document.querySelector('.ed-look-preview').shadowRoot.querySelector('#screen-title:not([hidden]) .kit-hint'), 'the Title tab shows the title screen');
  const titleOut = await wholeOnScreen(page, ['.kit-title', '.kit-pitch', '#screen-title .kit-menu-item:last-child', '#screen-title .kit-hint']);
  check(titleOut.length === 0, `the game's name, its blurb, the buttons and the help line are all inside the preview's screen${titleOut.length ? ' — not: ' + titleOut.join(', ') : ''}`);
  await page.locator('.ed-look-preview #screen-title .kit-hint').tap();
  await expect(page, flashedInView('titleBg'), 'a tap on the title\'s help line opens Colours at the title\'s background, in sight');
  await page.locator('.ed-look-chip[data-preview="toast"]').tap();
  // A part that lets taps through cannot be tapped at all: that is a failed check, not a stopped run.
  await page.locator('.ed-look-preview .kit-toast-pill').tap({ timeout: 3000 }).catch(() => {});
  await expect(page, () => document.querySelector('.ed-look-section[data-section="toast"]').getAttribute('aria-expanded') === 'true', 'a tap on the toast opens Toast');
  await page.locator('.ed-look-preview .kit-chapter-title').tap({ timeout: 3000 }).catch(() => {});
  await expect(page, () => document.querySelector('.ed-look-section[data-section="colours"]').getAttribute('aria-expanded') === 'true', 'and a tap on the chapter card opens its colours');
  // The card's words fill only part of it, and a thumb aiming at the card lands on its edge as often as on them.
  await tapPart(page, '#chapter .kit-card', 5, 5);
  await expect(page, flashedInView('chapterBg'), 'a tap on the card\'s edge, not on its words, opens Colours at the card\'s own colour, in sight');
  check(await inPreview(page, (r) => r.querySelector('#chapter .kit-card').classList.contains('ed-look-picked')), 'with the card outlined');
  await openSection(page, 'toast');
  await page.locator('.ed-look-body .ed-f[data-key="at"] .ed-chip[data-value="center"]').tap();
  await expect(page, `(() => { const r = document.querySelector('.ed-look-preview').shadowRoot; return r.getElementById('chapter').hasAttribute('data-apart') && !!r.querySelector('.kit-toast-pill'); })()`, 'Toast › Where › Middle');
  check(await toastOnCard(page) === false, 'the toast in the middle keeps off the chapter card\'s words, and both are there to read');
  await page.evaluate(TWO_FINGERS);
  await expect(page, () => !KIT.editor.state.project.ui, 'two fingers take that back');
  await openSection(page, 'cursor');
  const cursorSquare = await page.evaluate(() => { const i = document.querySelector('.ed-look-body .ed-f[data-key="color"] input.ed-color'); return { value: i.value, faded: i.classList.contains('is-none'), accent: KIT.look.resolve(KIT.editor.state.project).tokens.accent }; });
  check(cursorSquare.faded && cursorSquare.value === cursorSquare.accent, `the cursor's colour, "Same as accent", shows the accent in its square, faded (${cursorSquare.value}, the accent ${cursorSquare.accent})`);
  await openSection(page, 'box');
  await expect(page, () => { const f = document.querySelector('.ed-look-preview').shadowRoot.querySelector('#dialogue .kit-facebox'); return !!f && !f.hidden && !!f.querySelector('canvas'); },
    'no line in the game has a portrait, and the talk shows one anyway, for the portrait\'s settings to change');
  await page.locator('.ed-look-body .ed-f[data-key="face"] .ed-chip[data-value="above-right"]').tap();
  await expect(page, () => {
    const r = document.querySelector('.ed-look-preview').shadowRoot;
    const f = r.querySelector('#dialogue .kit-facebox').getBoundingClientRect(), b = r.querySelector('#dialogue .kit-box').getBoundingClientRect();
    return f.height > 0 && f.bottom <= b.top && Math.abs(f.right - b.right) <= 6;
  }, 'Portrait › Above right puts it over the box\'s right-hand corner');
  await page.locator('.ed-look-chip[data-preview="pad"]').tap();
  await expect(page, () => { const r = document.querySelector('.ed-look-preview').shadowRoot; return !r.getElementById('controls').hidden && !!r.querySelector('#dialogue .kit-line'); }, 'the Pad tab: the buttons, under somebody talking');
  const padOut = await wholeOnScreen(page, ['#dialogue .kit-box', '#dialogue .kit-name', '#dialogue .kit-facebox']);
  check(padOut.length === 0, `on the strip of screen the pad leaves, nothing hangs out of the top — the portrait above the box is left out there${padOut.length ? ' — not: ' + padOut.join(', ') : ''}`);
  await page.evaluate(TWO_FINGERS);
  await expect(page, () => !KIT.editor.state.project.ui, 'two fingers take that back, and the game has no look of its own again');

  beat('3.2', 'Soul, in one tap and one undo step');
  await openSection(page, 'start');
  const cards = await page.evaluate(() => Array.from(document.querySelectorAll('.ed-look-card')).map(c => c.dataset.look));
  check(['kit', 'handheld', 'soul', 'dream'].every(id => cards.includes(id)), `the four looks are there to start from (${cards.join(', ')})`);
  const swatches = await page.evaluate(() => Array.from(document.querySelectorAll('.ed-look-card .ed-look-swatch')).map((s) => {
    const cs = getComputedStyle(s);
    return [cs.backgroundColor, cs.borderTopColor, cs.borderTopWidth, cs.borderTopLeftRadius, cs.fontFamily, s.textContent].join(' | ');
  }));
  check(new Set(swatches).size === swatches.length, 'and each one\'s little box looks different');
  const h0 = await history(page);
  await page.locator('.ed-look-card[data-look="soul"]').tap();
  const keep = page.locator('.ed-look-sheet button', { hasText: 'Keep my changes' });
  if (await keep.count()) await keep.tap();
  await expect(page, () => { const r = document.querySelector('.ed-look-preview').shadowRoot; const b = r.querySelector('#dialogue .kit-box'); return !!b && getComputedStyle(b).backgroundColor === 'rgb(0, 0, 0)' && getComputedStyle(b).borderTopWidth === '3px'; },
    'within a moment the preview\'s box is black, with a 3px border', undefined, 400);
  check(await history(page) === h0 + 1, `and that was one undo step (${h0} → ${await history(page)})`);
  check(await page.evaluate(() => KIT.editor.state.project.ui.base === 'soul'), 'the game starts from Soul now');
  await openSection(page, 'sounds');
  const voiceRow = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.ed-look-body .ed-look-sound'));
    const ink = (r) => getComputedStyle(r.querySelector('.ed-f-label')).color;
    const voice = rows[rows.length - 1];
    return { name: voice.querySelector('.ed-f-label').textContent, dim: voice.classList.contains('is-inherited'), same: ink(voice) === ink(rows[0]) && rows[0].classList.contains('is-inherited') };
  });
  check(/Typing sound/.test(voiceRow.name) && voiceRow.dim && voiceRow.same, `"${voiceRow.name}" is Soul's own Typewriter, and its name is greyed like the sounds above it`);

  beat('3.3', 'three quick taps on Lines −, one step, and pages of two lines');
  await openSection(page, 'box');
  const h1 = await history(page);
  const less = page.locator('.ed-look-body .ed-f[data-key="lines"] button[aria-label="Less"]');
  for (let i = 0; i < 3; i++) await less.tap();
  await page.waitForTimeout(450);
  check(await history(page) === h1 + 1, `three taps are one undo step (${h1} → ${await history(page)})`);
  check(await page.evaluate(() => KIT.editor.state.project.ui.dialogue && KIT.editor.state.project.ui.dialogue.lines === 2), 'and the game has two lines to a page');
  await page.locator('.ed-look-chip[data-preview-mode]').tap();
  check(await page.evaluate(() => document.querySelector('.ed-look-chip[data-preview-mode]').dataset.previewMode === 'try'), '▶ Try hands the preview to the player');
  const pages = [];
  for (let i = 0; i < 6; i++) {
    const n = await inPreview(page, (r) => { const d = r.querySelector('#dialogue'); return d && !d.hidden && r.querySelector('#dialogue .kit-next.is-ready') ? r.querySelectorAll('#dialogue .kit-line').length : null; });
    if (n !== null) pages.push(n);
    await page.locator('.ed-look-preview').tap();
    await page.waitForTimeout(120);
  }
  check(pages.length >= 2 && pages.every(n => n <= 2), `tapped through, every page has at most two lines (${pages.join(', ')})`);
  await page.locator('.ed-look-chip[data-preview-mode]').tap();
  check(await page.evaluate(() => document.querySelector('.ed-look-chip[data-preview-mode]').dataset.previewMode === 'edit'), 'and ✎ Edit takes it back');

  beat('3.4', 'a colour dragged across the picker is one undo step');
  await openSection(page, 'colours');
  const paperRow = '.ed-look-body .ed-f[data-key="paper"]';
  const dim = await page.evaluate((sel) => {
    const row = document.querySelector(sel);
    const seen = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
    return { inherited: row.classList.contains('is-inherited'), square: seen(row.querySelector('input.ed-color')), hex: seen(row.querySelector('.ed-hex')) };
  }, paperRow);
  check(dim.inherited && dim.square === 1 && dim.hex < 1, `Soul's own box colour: its square shows the colour as it is, and only the words beside it are dimmed (${dim.square} / ${dim.hex})`);
  const h1b = await history(page);
  await page.locator(paperRow + ' .ed-hex').fill('pink');
  check(await page.evaluate((sel) => document.querySelector(sel + ' .ed-hex').classList.contains('is-bad'), paperRow), '"pink" typed as a colour turns the box\'s edge red');
  await page.waitForTimeout(350);
  check(await history(page) === h1b, 'and is not written');
  await page.locator(paperRow + ' .ed-hex').fill('');
  const h2 = await history(page);
  const drag = await page.evaluate(async () => {                               // the picker's drag: ten values, one after another
    const pick = document.querySelector('.ed-look-body .ed-f[data-key="paper"] input[type="color"]');
    let last = null;
    for (let i = 0; i < 10; i++) {
      last = '#' + (0x10 + i * 8).toString(16).padStart(2, '0') + '2040';
      pick.value = last;
      pick.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(z => setTimeout(z, 16));
    }
    return last;
  });
  await page.waitForTimeout(450);
  check(await history(page) === h2 + 1, `ten values are one undo step (${h2} → ${await history(page)})`);
  const want = await page.evaluate((hex) => { const d = document.createElement('div'); d.style.color = hex; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; }, drag);
  const got = await inPreview(page, (r) => getComputedStyle(r.querySelector('#dialogue .kit-box')).backgroundColor);
  check(got === want, `and the preview's box is the last of them (${got})`);
  // With changes of the author's own, starting from another look asks first.
  await openSection(page, 'start');
  const h3 = await history(page);
  await page.locator('.ed-look-card[data-look="kit"]').tap();
  await expect(page, () => { const s = document.querySelector('.ed-look-sheet'); return !!s && /Keep my changes \(2\)/.test(s.textContent) && /Start clean/.test(s.textContent); },
    'another look now asks first: keep my 2 changes, or start clean');
  await page.locator('.ed-look-sheet button', { hasText: 'Cancel' }).tap();
  check(await page.evaluate(() => !document.querySelector('.ed-look-sheet') && KIT.editor.state.project.ui.base === 'soul') && await history(page) === h3, 'and Cancel changes nothing');
  await openSection(page, 'colours');

  beat('3.5', 'a tap on the preview opens what it landed on');
  await page.locator('.ed-look-preview .kit-text').tap();
  await expect(page, () => document.querySelector('.ed-look-section[data-section="box"]').getAttribute('aria-expanded') === 'true', 'the message box opens Message box');
  check(await inPreview(page, (r) => !!r.querySelector('.ed-look-picked')), 'with the part outlined');

  beat('3.6', 'two fingers take it back, a step at a time');
  await page.evaluate(TWO_FINGERS);
  await expect(page, () => !(KIT.editor.state.project.ui.tokens && KIT.editor.state.project.ui.tokens.paper), 'the first undoes the colour');
  await page.evaluate(TWO_FINGERS);
  await expect(page, () => !(KIT.editor.state.project.ui.dialogue && KIT.editor.state.project.ui.dialogue.lines), 'the second undoes the lines: three again, Soul\'s own');
  check(await page.evaluate(() => JSON.stringify(KIT.editor.state.project.ui)) === '{"base":"soul"}', `and what is left is Soul (${await page.evaluate(() => JSON.stringify(KIT.editor.state.project.ui))})`);
  await expect(page, () => { const r = document.querySelector('.ed-look-preview').shadowRoot; const b = r.querySelector('#dialogue .kit-box'); return !!b && getComputedStyle(b).backgroundColor === 'rgb(0, 0, 0)'; }, 'the preview follows the undo');

  beat('3.6a', 'a colour the screen on show does not draw turns the preview to one that does');
  // "Chosen line" changed while somebody talked, and "OK button" had no screen
  // at all: the square changed and nothing else did, which reads as broken.
  await openSection(page, 'colours');
  await page.locator('.ed-look-chip[data-preview="talk"]').tap();
  await expect(page, () => !!document.querySelector('.ed-look-preview').shadowRoot.querySelector('#dialogue:not([hidden]) .kit-box'), 'the preview shows somebody talking');
  await page.locator('.ed-look-body .ed-f[data-key="selectInk"] .ed-hex').fill('#ff3030');
  await expect(page, () => { const r = document.querySelector('.ed-look-preview').shadowRoot; const row = r.querySelector('#pause-menu:not([hidden]) .kit-menu-item.is-selected'); return !!row && getComputedStyle(row).color === 'rgb(255, 48, 48)'; },
    '"Chosen line\'s text" turns the preview to the pause menu, and the chosen line\'s letters are that colour');
  await page.waitForTimeout(400);
  await page.evaluate(TWO_FINGERS);
  await expect(page, () => JSON.stringify(KIT.editor.state.project.ui) === '{"base":"soul"}', 'two fingers take it back');
  // Soul has no box round the chosen line, so its colour cannot be seen: say so.
  await page.locator('.ed-look-body .ed-f[data-key="select"] .ed-hex').fill('#ff3030');
  await expect(page, () => /no box round the chosen line/.test((document.querySelector('.ed-toast') || {}).textContent || ''), '"Chosen line" in a look with no box round it says why nothing changed, and where to turn it on');
  await page.waitForTimeout(400);
  await page.evaluate(TWO_FINGERS);
  await expect(page, () => JSON.stringify(KIT.editor.state.project.ui) === '{"base":"soul"}', 'two fingers take that back too');
  if (!(await page.locator('.ed-look-body .ed-f[data-key="button"]').isVisible())) await page.locator('.ed-look-body summary', { hasText: 'More colours' }).tap();
  await page.locator('.ed-look-body .ed-f[data-key="button"] .ed-hex').fill('#ff00ff');
  await expect(page, () => { const r = document.querySelector('.ed-look-preview').shadowRoot; const ok = r.querySelector('#choice:not([hidden]) .kit-modal .kit-uibtn.is-primary'); return !!ok && getComputedStyle(ok).backgroundColor === 'rgb(255, 0, 255)'; },
    '"OK button" shows the box that asks for a name, with OK in that colour');
  await page.waitForTimeout(400);
  await page.evaluate(TWO_FINGERS);
  await expect(page, () => JSON.stringify(KIT.editor.state.project.ui) === '{"base":"soul"}', 'and back again');

  beat('3.6b', 'the caret in a text box, and a tap on another section');
  await openSection(page, 'box');
  const prefix = page.locator('.ed-look-body .ed-f[data-key="prefix"] input[type="text"]');
  await prefix.fill('abcdefgh');
  check(await prefix.inputValue() === 'abcd', `"Start each line with" takes four letters, as many as the game shows (${await prefix.inputValue()})`);
  // (setup) a tap as an iPhone delivers it to a button: the click, with the caret left in the box.
  await page.evaluate(() => document.querySelector('.ed-look-section[data-section="colours"]').click());
  await expect(page, () => document.querySelector('.ed-look-section[data-section="colours"]').getAttribute('aria-expanded') === 'true', 'Colours opens at once');
  check(await page.evaluate(() => KIT.editor.state.project.ui.dialogue && KIT.editor.state.project.ui.dialogue.prefix) === 'abcd', 'and what was typed is written, the four letters the game uses');
  await page.evaluate(TWO_FINGERS);
  await expect(page, () => JSON.stringify(KIT.editor.state.project.ui) === '{"base":"soul"}', 'two fingers take it back');

  beat('3.6c', 'an undo made on the map takes the look off the page too');
  await openSection(page, 'box');
  await page.locator('.ed-look-body .ed-f[data-key="lines"] button[aria-label="Less"]').tap();
  await page.locator('.ed-group[data-group="map"]').tap();
  await expect(page, () => KIT.editor.state.project.ui.dialogue && KIT.editor.state.project.ui.dialogue.lines === 2 && document.getElementById('kit-look').textContent.includes('* 2 * 1em'),
    'Lines − and straight to Map: written, and on the page');
  check(await page.evaluate(() => Array.from(document.querySelectorAll('.ed-toolbar .ed-zoom')).filter(b => b.offsetParent !== null).length === 2), 'the map\'s zoom − and + are back with the map');
  await page.locator('.ed-toolbar .ed-btn[title^="Undo"]').tap();
  await expect(page, () => !document.getElementById('kit-look').textContent.includes('* 2 * 1em') && KIT.look.get('dialogue.lines') === 3,
    '↶ on the map takes it off the page, and the game\'s look says three lines again');
  // Back by way of Story, whose tall sheet squashes the map's canvas: the copy
  // of the map behind the preview has to be taken once the canvas has its
  // own shape again, not the strip Story left it.
  await page.locator('.ed-group[data-group="story"]').tap();
  await page.waitForTimeout(200);
  await page.locator('.ed-group[data-group="look"]').tap();
  await expect(page, () => { const r = document.querySelector('.ed-look-preview'); return !!r && !!r.shadowRoot.querySelector('#dialogue .kit-box'); }, 'back to Look');
  await page.waitForTimeout(300);
  const backdrop = await page.evaluate(async () => {
    const url = (document.querySelector('.ed-look-preview').shadowRoot.getElementById('screen').style.backgroundImage.match(/url\("(.*)"\)/) || [])[1];
    if (!url) return null;
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.onerror = res; img.src = url; });
    const c = KIT.editor.el.canvas;
    return { copy: [img.naturalWidth, img.naturalHeight], canvas: [c.width, c.height] };
  });
  check(!!backdrop && backdrop.copy.join('×') === backdrop.canvas.join('×'), `the map behind the preview is the whole map, not the strip Story left (${backdrop && backdrop.copy.join('×')} of ${backdrop && backdrop.canvas.join('×')})`);
  const BOX = (r) => { const cs = getComputedStyle(r.querySelector('#dialogue .kit-box')); return [cs.backgroundColor, cs.borderTopWidth, cs.borderTopColor, cs.borderTopLeftRadius, cs.color].join(' | '); };
  await expect(page, `(() => { const r = document.querySelector('.ed-look-preview').shadowRoot; return !!r.querySelector('#dialogue .kit-line'); })()`, 'somebody is talking again');
  const previewBox = await inPreview(page, BOX);

  beat('3.6d', 'the tall sheet keeps the message box in sight');
  await page.locator('.ed-sheet-grip').tap();
  await expect(page, () => document.querySelector('.ed-root').classList.contains('is-sheet-tall'), '▴ makes the sheet tall');
  await page.waitForTimeout(200);
  const sheet = await page.evaluate(() => ({ side: Math.round(document.querySelector('.ed-side').getBoundingClientRect().height), short: Math.round(innerHeight * 0.46) }));
  check(sheet.side > sheet.short + 60, `the sheet grows (${sheet.short} → ${sheet.side}px)`);
  const tallOut = await wholeOnScreen(page, ['#dialogue .kit-box']);
  check(tallOut.length === 0, 'and the whole message box is still in the preview above it, not a strip of its last line');
  await page.locator('.ed-sheet-grip').tap();
  await expect(page, () => !document.querySelector('.ed-root').classList.contains('is-sheet-tall'), '▾ puts it back');

  beat('3.6e', 'a problem tapped in Problems opens the colour it names, where a thumb can see it');
  // (setup) Soul with the white name box it used to have: white words typed on white.
  await page.evaluate(() => KIT.editor.commit('setup', (doc, O) => O.look.set(doc, ['tokens', 'inputBg'], '#ffffff')));
  await page.locator('.ed-group[data-group="problems"]').tap();
  const nameProblem = page.locator('.ed-problem', { hasText: 'A name the player types is hard to read' });
  await expect(page, () => Array.from(document.querySelectorAll('.ed-problem')).some(p => /A name the player types is hard to read/.test(p.textContent)), 'Problems says a name typed into that box cannot be read');
  await nameProblem.tap();
  // The colour is far down More colours: the sheet has to move to it, and stay moved.
  await expect(page, () => {
    const row = document.querySelector('.ed-look-body .ed-f.is-flash[data-key="inputBg"]');
    if (!row) return false;
    const r = row.getBoundingClientRect(), s = document.querySelector('.ed-panel').getBoundingClientRect();
    return r.height > 0 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1;
  }, 'the tap opens Colours at "Inside a name box", flashed, inside the sheet');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => { const r = document.querySelector('.ed-look-body .ed-f[data-key="inputBg"]').getBoundingClientRect(), s = document.querySelector('.ed-panel').getBoundingClientRect(); return r.top >= s.top - 1 && r.bottom <= s.bottom + 1; }),
    'and it is still there a moment later');
  await page.evaluate(TWO_FINGERS);
  await expect(page, () => JSON.stringify(KIT.editor.state.project.ui) === '{"base":"soul"}', 'two fingers take it back');

  beat('3.7', 'closed, and a new game in the look');
  await page.locator('.ed-toolbar .ed-btn[title="Close Creator Mode"]').tap();
  await expect(page, () => !KIT.editor.isOpen() && KIT.game.scene() === 'title', 'back at the title');
  check(await page.evaluate(() => !document.querySelector('.ed-look-preview')), 'the preview has gone with Creator Mode');
  await page.locator('#screen-title [data-action="new-game"]').tap();
  await expect(page, () => !!document.querySelector('#dialogue:not([hidden]) .kit-line'), 'the intro starts talking');
  const intro = await page.evaluate(() => {
    const box = document.querySelector('#dialogue .kit-box');
    const start = document.querySelector('#dialogue .kit-line.is-start');
    return { bg: getComputedStyle(box).backgroundColor, mark: start ? getComputedStyle(start, '::before').content : null, next: getComputedStyle(document.querySelector('#dialogue .kit-next')).display };
  });
  check(intro.bg === 'rgb(0, 0, 0)', `the box is black (${intro.bg})`);
  const gameBox = await page.evaluate(`(${BOX.toString()})(document)`);
  check(gameBox === previewBox, `the box in the game is the box the preview showed (${gameBox})`);
  check(intro.mark === '"* "', `each line starts with “* ” (${intro.mark})`);
  check(intro.next === 'none', `and there is no ▼ (${intro.next})`);

  beat('3.8', 'the pause menu, in the top left, with a red heart');
  check(await tapThrough(page), 'the intro tapped through');
  await pad(page, 'menu');
  await expect(page, () => KIT.game.scene() === 'menu' && !!document.querySelector('#pause-menu .kit-menu-item.is-selected'), '☰ opens the pause menu');
  const menu = await page.evaluate(() => {
    const host = document.getElementById('pause-menu');
    const cs = getComputedStyle(host);
    const pick = document.querySelector('#pause-menu .kit-menu-item.is-selected');
    const before = getComputedStyle(pick, '::before');
    return { justify: cs.justifyContent, align: cs.alignItems, title: !!host.querySelector('.kit-panel-title'), hint: !!host.querySelector('.kit-hint'),
      mark: before.content, ink: before.color, caps: getComputedStyle(pick.querySelector('.kit-item-label')).textTransform };
  });
  check(menu.justify === 'flex-start' && menu.align === 'flex-start', `it sits in the top left (${menu.justify} / ${menu.align})`);
  check(!menu.title && !menu.hint, 'with no "Paused" and no help line');
  check(menu.mark === '"♥"' && menu.ink === 'rgb(255, 0, 0)', `the chosen line has a red heart (${menu.mark}, ${menu.ink})`);
  check(menu.caps === 'uppercase', 'in capitals');
  await page.locator('#pause-menu [data-action="menu:settings"]').tap();
  await expect(page, () => !!document.querySelector('#pause-menu [data-action="toggle:reduceMotion"]'), 'Settings opens from it');
  const settingsList = await page.evaluate(() => ({ title: !!document.querySelector('#pause-menu .kit-panel-title'), hint: !!document.querySelector('#pause-menu .kit-hint') }));
  check(settingsList.title && settingsList.hint, 'and keeps its heading and its help line, the one line saying how to get back out');
  await pad(page, 'b');
  await expect(page, () => !!document.querySelector('#pause-menu [data-action="menu:settings"]'), 'B steps back to the pause menu');
  await pad(page, 'b');
  await expect(page, () => KIT.game.scene() === 'map', 'B closes it');

  beat('3.8b', 'the name box in Soul can be read, and answers move the way the arrow points');
  await page.evaluate(() => { window.__named = undefined; KIT.scenes.run('nameEntry', { prompt: 'What is your name?' }).then(v => { window.__named = v; }); });   // (setup)
  await expect(page, () => KIT.game.scene() === 'nameEntry', 'the name box opens');
  await page.locator('[data-role=name-entry]').fill('Ava');
  const nameBox = await page.evaluate(() => {
    const cs = (el) => getComputedStyle(el);
    const field = document.querySelector('[data-role=name-entry]'), ok = document.querySelector('#choice [data-action="ok"]');
    return { field: `${cs(field).color} on ${cs(field).backgroundColor}`, ok: `${cs(ok).color} on ${cs(ok).backgroundColor}` };
  });
  check(nameBox.field === 'rgb(255, 255, 255) on rgb(0, 0, 0)', `the name typed is white on black, not white on white (${nameBox.field})`);
  check(nameBox.ok === 'rgb(0, 0, 0) on rgb(255, 255, 255)', `and OK is black on its white button (${nameBox.ok})`);
  await page.locator('#choice [data-action="ok"]').tap();
  await expect(page, () => window.__named === 'Ava', 'OK takes the name');
  const chosen = () => page.evaluate(() => (document.querySelector('#choice .kit-option.is-selected') || {}).textContent);
  const ask = (options) => page.evaluate((o) => { window.__picked = undefined; KIT.scenes.run('choice', { prompt: 'Which way?', options: o.map(text => ({ text })) }).then(v => { window.__picked = v; }); }, options);
  await ask(['Yes', 'No']);                                                                                   // (setup)
  await expect(page, () => KIT.game.scene() === 'choice', 'Soul asks with its answers in a row');
  await pad(page, 'down');
  check(await chosen() === 'Yes', `▼ on Yes beside No stays on Yes (${await chosen()})`);
  await pad(page, 'right');
  check(await chosen() === 'No', `and ▶ goes to No (${await chosen()})`);
  await pad(page, 'a');
  await expect(page, () => window.__picked === 1, 'A answers No');
  // (setup) the same look with its answers in a grid, two across, for one question.
  await page.evaluate(() => { const p = KIT.game.project; KIT.look.apply(Object.assign({}, p, { ui: Object.assign({}, p.ui, { choice: { layout: 'grid', columns: 2 } }) })); });
  await ask(['North', 'South', 'East', 'West', 'Stay']);
  await expect(page, () => KIT.game.scene() === 'choice', 'a question with five answers in a grid');
  const moves = [];
  for (const b of ['right', 'down', 'left', 'up']) { await pad(page, b); moves.push(`${b} ${await chosen()}`); }
  check(moves.join(', ') === 'right South, down West, left East, up North', `each arrow goes to the answer that way: ▼ from South is West under it, not East across (${moves.join(', ')})`);
  await pad(page, 'a');
  await expect(page, () => window.__picked === 0, 'A answers North');
  await page.evaluate(() => KIT.look.apply(KIT.game.project));                                               // (setup) the game's own look back

  beat('3.9', 'the look is kept');
  await page.reload();
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted && KIT.game.scene() === 'title', undefined, { timeout: 30000 });
  check(await page.evaluate(() => KIT.game.project.ui && KIT.game.project.ui.base === 'soul'), 'after a reload the game still starts from Soul');
  check(await page.evaluate(() => document.getElementById('kit-look').textContent.includes('--paper:#000000')), 'and the page has its stylesheet');

  beat('3.10', 'nothing broke');
  noErrors(errors);
  await ctx.close();
}

// ---- beat 4: the preview on a laptop -------------------------------------------------

async function laptopLook(browser) {
  const { ctx, page, errors } = await open(browser, { viewport: { width: 1280, height: 800 } });
  beat('4.1', 'Phone | Fill: the talk is drawn again at the new width');
  await page.locator('#screen-title [data-action="creator"]').click();
  await expect(page, () => KIT.editor && KIT.editor.isOpen(), 'Creator Mode opens');
  await page.locator('.ed-group[data-group="look"]').click();
  const lines = () => inPreview(page, (r) => (r.querySelector('#dialogue .kit-next.is-ready') ? r.querySelectorAll('#dialogue .kit-line').length : null));
  await expect(page, `(() => { const r = document.querySelector('.ed-look-preview'); return !!r && !!r.shadowRoot.querySelector('#dialogue .kit-next.is-ready'); })()`, 'the first page is typed, a phone wide');
  const narrow = await lines();
  await page.locator('.ed-look-chip.ed-look-size').click();
  await expect(page, () => document.querySelector('.ed-look-chip.ed-look-size').dataset.previewSize === 'fill', 'Fill');
  await page.waitForTimeout(300);
  await expect(page, `(() => { const r = document.querySelector('.ed-look-preview').shadowRoot; return !!r.querySelector('#dialogue .kit-next.is-ready'); })()`, 'the page is typed again');
  const wide = await lines();
  check(wide < narrow, `the same page takes fewer lines filling the space than a phone wide (${narrow} → ${wide})`);
  // The sheet is narrower here than on a phone: a font's card keeps its whole
  // name (on two lines if it must) and its size on one line.
  await page.locator('.ed-look-section[data-section="fonts"]').click();
  await page.locator('.ed-look-body .ed-look-font-file').setInputFiles({ name: 'Silkscreen Extra Wide Regular.ttf', mimeType: 'font/ttf', buffer: fs.readFileSync(FONT) });
  await expect(page, () => !!document.querySelector('.ed-look-font[data-key="silkscreen-extra-wide-regular"]'), 'a font with a long name comes in');
  const card = await page.evaluate(() => {
    const row = document.querySelector('.ed-look-font[data-key="silkscreen-extra-wide-regular"]');
    const name = row.querySelector('.ed-look-font-name'), size = row.querySelector('.ed-look-font-head > .ed-sub');
    const one = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getClientRects().length; };
    return { name: name.textContent, cut: name.scrollWidth > name.clientWidth + 1, size: size.textContent, lines: one(size) };
  });
  check(!card.cut && /^Silkscreen Extra Wide Regular$/i.test(card.name), `its card shows the whole name ("${card.name}")`);
  check(card.lines === 1, `and "${card.size}" on one line (${card.lines} line boxes)`);
  beat('4.2', 'nothing broke');
  noErrors(errors);
  await ctx.close();
}

// ---- beat 5: a phone with its browser's bars showing ----------------------------------

async function shortPhone(browser) {
  // 390×664 is an iPhone's Safari with its toolbars up: the preview's screen is
  // about 200px tall, a third less than on the phone above.
  const { ctx, page, errors } = await open(browser, { viewport: { width: 390, height: 664 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  beat('5.1', 'the title and the toast, on the shorter screen');
  await page.locator('#screen-title [data-action="creator"]').tap();
  await expect(page, () => KIT.editor && KIT.editor.isOpen(), 'Creator Mode opens');
  await page.locator('.ed-group[data-group="look"]').tap();
  await expect(page, () => !!document.querySelector('.ed-stage .ed-look-preview'), 'Look');
  await page.locator('.ed-look-chip[data-preview="title"]').tap();
  await expect(page, () => !!document.querySelector('.ed-look-preview').shadowRoot.querySelector('#screen-title:not([hidden]) .kit-hint'), 'the Title tab');
  const out = await wholeOnScreen(page, ['.kit-title', '.kit-pitch', '#screen-title .kit-menu-item:last-child', '#screen-title .kit-hint']);
  check(out.length === 0, `the whole title is inside the preview, shrunk to fit it${out.length ? ' — not: ' + out.join(', ') : ''}`);
  await openSection(page, 'toast');
  await page.locator('.ed-look-body .ed-f[data-key="at"] .ed-chip[data-value="center"]').tap();
  await expect(page, `(() => { const r = document.querySelector('.ed-look-preview').shadowRoot; return r.getElementById('chapter').hasAttribute('data-apart'); })()`, 'Toast › Where › Middle');
  check(await toastOnCard(page) !== true, 'the toast in the middle does not cover the chapter card\'s words');
  beat('5.2', 'nothing broke');
  noErrors(errors);
  await ctx.close();
}

// ---- beat 6: fonts and feel -----------------------------------------------------------

const FONT = path.join(ROOT, 'test', 'fixtures', 'look', 'one-glyph.ttf');
/** Put a look on the game as it plays, without keeping it: (setup) only. */
const wear = (page, ui) => page.evaluate((u) => KIT.look.apply(Object.assign({}, KIT.game.project, { ui: u })), ui);
/** Run a little script on the map, the way an event would; window.__script says when it is done. */
const script = (page, text) => page.evaluate((t) => {
  window.__script = 'running';
  KIT.interpreter.run(KIT.screenplay.parse(t).commands, KIT.game.world.makeCtx(null, 'p1')).then(() => { window.__script = 'done'; });
}, text);
const lineTexts = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#dialogue .kit-line')).map(l => l.textContent));
const ready = (page) => page.waitForFunction(() => KIT.game.scene() !== 'dialogue' || !!document.querySelector('#dialogue:not([hidden]) .kit-next.is-ready'), undefined, { timeout: 8000 });

async function fontsAndFeel(browser) {
  const { ctx, page, errors } = await open(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

  beat('6.1', 'a font of the game\'s own, brought in on the phone');
  await page.locator('#screen-title [data-action="creator"]').tap();
  await page.locator('.ed-group[data-group="look"]').tap();
  await expect(page, () => !!document.querySelector('.ed-stage .ed-look-preview'), 'Look is open');
  await openSection(page, 'fonts');
  const h0 = await history(page);
  await page.locator('.ed-look-body .ed-look-font-file').setInputFiles(FONT);
  await expect(page, () => document.fonts.check('16px "kitf-one-glyph"') && Array.from(document.fonts).some(f => f.family.replace(/"/g, '') === 'kitf-one-glyph' && f.status === 'loaded'),
    'within 2 s the page has the font, loaded', undefined, 2000);
  check(await history(page) === h0 + 1, 'bringing it in was one undo step');
  await expect(page, () => !!document.querySelector('.ed-look-font[data-key="one-glyph"]'), 'Fonts lists it, with its size');
  const small = await tooSmall(page);
  check(small.length === 0, `every control in Fonts is at least 44×44${small.length ? ': ' + small.slice(0, 3).join('; ') : ''}`);
  // A pixel font asks what size it was drawn at: that stepper is a control a thumb has to hit too.
  await page.locator('.ed-look-font[data-key="one-glyph"] button', { hasText: 'Pixel font' }).tap();
  await expect(page, () => !!document.querySelector('.ed-look-font[data-key="one-glyph"] .ed-look-font-size input'), 'Pixel font on: it asks what size it was drawn at');
  const smallPixel = await tooSmall(page);
  check(smallPixel.length === 0, `and every control, Drawn at's too, is still at least 44×44${smallPixel.length ? ': ' + smallPixel.slice(0, 3).join('; ') : ''}`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'with nothing wider than the phone');
  await page.locator('.ed-look-font[data-key="one-glyph"] button', { hasText: 'Pixel font' }).tap();
  await expect(page, () => !document.querySelector('.ed-look-font[data-key="one-glyph"] .ed-look-font-size'), 'and off again');
  await page.locator('.ed-look-body .ed-f[data-key="fontText"] .ed-chip[data-value="one-glyph"]').tap();
  await expect(page, () => { const t = document.querySelector('.ed-look-preview').shadowRoot.querySelector('#dialogue .kit-text'); return !!t && /^"?kitf-one-glyph"?,/.test(getComputedStyle(t).fontFamily); },
    'tapped for Message text, the preview\'s words are in it');
  await page.waitForTimeout(400);
  check(await page.evaluate(() => KIT.editor.state.project.ui.tokens.fontText) === 'one-glyph', 'and the look keeps it');
  check(await page.evaluate(() => !document.getElementById('kit-look').textContent.includes('@font-face') && document.getElementById('kit-look-fonts').textContent.startsWith('@font-face{font-family:"kitf-one-glyph"')),
    'the font is in a stylesheet of its own, apart from the look that changes at every tap');
  // Line spacing steps by 0.05: six taps on + from 1.45 were 1.7500000000000002, in the box and in the game.
  const spacing = '.ed-look-body .ed-f[data-key="lineHeight"]';
  for (let i = 0; i < 6; i++) await page.locator(`${spacing} button[aria-label="More"]`).tap();
  await page.waitForTimeout(400);
  const spaced = await page.evaluate((sel) => [document.querySelector(sel + ' input').value, KIT.editor.state.project.ui.tokens.lineHeight], spacing);
  check(spaced[0] === '1.75' && spaced[1] === 1.75, `six taps on Line spacing + make 1.75, in the box and in the look (${spaced.join(', ')})`);
  for (let i = 0; i < 6; i++) await page.locator(`${spacing} button[aria-label="Less"]`).tap();
  await expect(page, () => !('lineHeight' in KIT.editor.state.project.ui.tokens), 'and six on − bring it back to the look\'s own 1.45');
  // The same file through Game › Import: it knows a font, and that the game has this one.
  await page.locator('.ed-group[data-group="game"]').tap();
  const tab = page.locator('.ed-tab[data-panel="import"]');
  if (await tab.isVisible()) await tab.tap();
  await page.locator('.ed-panel-body[data-panel="import"] input[type="file"]').setInputFiles(FONT);
  await expect(page, () => /1 font(?!s)/.test((document.querySelector('.ed-import-report') || {}).textContent || ''), 'Game › Import takes the same file, and its report says "1 font"');

  beat('6.1b', 'Scrolls up a line, tried in the preview, where the game\'s first line fits one page');
  await page.locator('.ed-group[data-group="look"]').tap();
  await openSection(page, 'typing');
  await page.locator('.ed-look-body .ed-f[data-key="pageTurn"] .ed-chip[data-value="scroll"]').tap();
  await expect(page, () => (KIT.editor.state.project.ui.dialogue || {}).pageTurn === 'scroll', 'Next page › Scrolls up a line');
  await page.locator('.ed-look-chip[data-preview-mode]').tap();
  // Each finished page, as a tap on the preview turns it (a tap on a page still typing finishes it).
  const tried = [];
  for (let i = 0; i < 8 && tried.length < 2; i++) {
    const shown = await inPreview(page, (r) => { const d = r.querySelector('#dialogue'); return d && !d.hidden && r.querySelector('#dialogue .kit-next.is-ready') ? Array.from(r.querySelectorAll('#dialogue .kit-line'), (l) => l.textContent) : null; });
    if (shown && (!tried.length || shown.join('|') !== tried[tried.length - 1].join('|'))) tried.push(shown);
    await page.locator('.ed-look-preview').tap();
    await page.waitForTimeout(150);
  }
  check(tried.length === 2 && tried[0].length === 3 && tried[1][0] === tried[0][1],
    `a tap scrolls the page up a line: the new first line is the old second (${JSON.stringify(tried)})`);
  await page.locator('.ed-look-chip[data-preview-mode]').tap();

  beat('6.2', 'Handheld: two lines, and the page scrolls up a line');
  await openSection(page, 'start');
  await page.locator('.ed-look-card[data-look="handheld"]').tap();
  await page.locator('.ed-look-sheet button', { hasText: 'Start clean' }).tap();
  await expect(page, () => KIT.editor.state.project.ui && KIT.editor.state.project.ui.base === 'handheld' && !KIT.editor.state.project.ui.tokens, 'the game starts from Handheld, as it comes');
  // Handheld hides the speaker's name and the menu's heading, so Names and
  // menus is seen on the title: a tap on one of its fonts turns the preview there.
  await openSection(page, 'fonts');
  await page.locator('.ed-look-body .ed-f[data-key="fontUi"] .ed-chip[data-value="mono"]').tap();
  await expect(page, () => (document.querySelector('.ed-look-chips .ed-look-chip[aria-selected="true"]') || {}).textContent === 'Title',
    'a font for names and menus, in a look that hides the name, is shown on the title');
  await page.locator('.ed-look-body .ed-f[data-key="fontUi"] .ed-chip[data-value="pixel"]').tap();
  await expect(page, () => !KIT.editor.state.project.ui.tokens, 'and put back, Handheld is as it came again');
  await page.locator('.ed-toolbar .ed-btn[title="Close Creator Mode"]').tap();
  await expect(page, () => !KIT.editor.isOpen() && KIT.game.scene() === 'title', 'closed, at the title');
  await page.locator('#screen-title [data-action="new-game"]').tap();
  const intro = [];
  for (let i = 0; i < 30; i++) {
    const s = await page.evaluate(() => ({ top: KIT.game.scene(), busy: !!(KIT.game.world && KIT.game.world.busy), main: KIT.interpreter.mainBusy() }));
    if (s.top === 'map' && !s.busy && !s.main) break;
    if (s.top === 'dialogue') {
      await ready(page);
      intro.push((await lineTexts(page)).length);
      await page.locator('#dialogue').tap();
    }
    await page.waitForTimeout(120);
  }
  check(intro.length >= 1 && intro.every(n => n <= 2), `each of the intro's ${intro.length} page(s) has at most two lines (${intro.join(', ')})`);
  await page.evaluate(() => {                                                    // (setup) note every sound, and a line long enough for several pages
    window.__played = [];
    const play = KIT.audio.play;
    KIT.audio.play = function (id) { window.__played.push(id); return play.apply(this, arguments); };
    KIT.game.ports.io.say({ who: 'Mom', text: 'Remember to take the map, the berries, the bus fare and the letter for your aunt, and come home before it gets dark tonight.' });
  });
  await ready(page);
  const before = await lineTexts(page);
  check(before.length === 2, `a long line: two lines to a page (${before.length})`);
  await page.evaluate(() => { window.__played.length = 0; });                  // (setup)
  await pad(page, 'a');
  await ready(page);
  const after = await lineTexts(page);
  check(after[0] === before[1], `A on a finished page scrolls it up: the new first line is the old second ("${after[0]}")`);
  check(after[1] && after[1] !== before[1], 'and a new line types under it');
  check((await page.evaluate(() => window.__played)).includes('select'), `the page turn has Handheld's sound (${await page.evaluate(() => window.__played.join(', '))})`);
  const seen = [before, after];
  for (let i = 0; i < 10 && await scene(page) === 'dialogue'; i++) {
    await pad(page, 'a');
    await ready(page);
    if (await scene(page) === 'dialogue') seen.push(await lineTexts(page));
  }
  await expect(page, () => KIT.game.scene() === 'map', 'the line ends');
  check(seen.length >= 3 && seen.every(p => p.length <= 2) && seen.every((p, i) => !i || p[0] === seen[i - 1][1]),
    `all ${seen.length} presses of it: two lines each, each keeping the line before`);
  // A voice can name one of the game's own fonts by its id, as a look does.
  await page.evaluate(() => {                                                    // (setup) such a voice, until voices have a form of their own
    KIT.registry('voices').add({ id: 't-glyph', name: 'Glyph', font: 'one-glyph' });
    KIT.game.ports.io.say({ text: 'A', voice: 't-glyph' });
  });
  await ready(page);
  const voiceFont = await page.evaluate(() => (document.querySelector('#dialogue .kit-line > span') || { style: {} }).style.fontFamily);
  check(/^"?kitf-one-glyph"?, /.test(voiceFont || ''), `a voice whose font is the game's own speaks in it (${voiceFont})`);
  await page.locator('#dialogue').tap();
  await expect(page, () => KIT.game.scene() === 'map', 'a tap closes it');

  beat('6.3', 'Soul: the box steps out of the hero\'s way');
  await wear(page, { base: 'soul' });                                            // (setup)
  const heroAt = (page2, row) => page2.evaluate((r) => {                        // (setup) the hero on a row of the map, the camera on them
    const w = KIT.game.world, h = w.hero();
    const y = r === 'bottom' ? w.map.height - 2 : 1;
    h.y = y; h.py = y;
    return new Promise((res) => setTimeout(res, 150));
  }, row);
  const fraction = () => page.evaluate(() => { const r = KIT.game.renderer, h = KIT.game.world.hero(); return r.tileToScreen(0, h.py + 0.5).y / r.canvas.clientHeight; });
  await heroAt(page, 'bottom');
  check(await fraction() > 0.5, `the hero stands in the bottom half of the screen (${(await fraction()).toFixed(2)})`);
  await page.evaluate(() => { KIT.game.ports.io.say({ text: 'x' }); });        // (setup)
  await expect(page, () => { const d = document.getElementById('dialogue'); return !d.hidden && d.getAttribute('data-position') === 'top'; }, 'a line meant for the bottom goes to the top');
  await ready(page);
  await page.locator('#dialogue').tap();
  await expect(page, () => KIT.game.scene() === 'map', 'a tap closes it');
  await heroAt(page, 'top');
  await page.evaluate(() => { KIT.game.ports.io.say({ text: 'x' }); });        // (setup)
  await expect(page, () => { const d = document.getElementById('dialogue'); return !d.hidden && d.getAttribute('data-position') === 'bottom'; }, 'with the hero up top, it stays at the bottom');
  await ready(page);
  await page.locator('#dialogue').tap();
  await expect(page, () => KIT.game.scene() === 'map', 'a tap closes it');

  beat('6.4', 'Soul: the answers inside the box, under the line that asked');
  const asked = () => page.evaluate(() => KIT.conditions.getVar(KIT.game.world.makeCtx(null, 'p1'), 'picked'));
  await script(page, 'Mom: Take it?\n?\n- Yes\n\t@set picked = 1\n- No\n\t@set picked = 2');  // (setup) a line, then a question with no words of its own
  await expect(page, () => KIT.game.scene() === 'dialogue', 'Mom asks');
  await ready(page);
  await page.locator('#dialogue').tap();
  await expect(page, () => KIT.game.scene() === 'choice', 'the question comes up');
  const inBox = await page.evaluate(() => {
    const box = document.querySelector('#choice[data-place="in-box"] .kit-promptbox');
    const opts = Array.from(document.querySelectorAll('#choice .kit-promptbox .kit-option')).map(o => o.getBoundingClientRect());
    return { text: box ? box.textContent : null, tops: opts.map(r => Math.round(r.top)), talk: document.getElementById('dialogue').hidden };
  });
  check(!!inBox.text && inBox.text.includes('Take it?'), `the question's box still says what Mom said (${inBox.text})`);
  check(inBox.tops.length === 2 && inBox.tops[0] === inBox.tops[1], `the answers sit in a row inside it (tops ${inBox.tops.join(', ')})`);
  check(inBox.talk, 'and the message box it came from is gone, not doubled');
  const picked = () => page.evaluate(() => (document.querySelector('#choice .kit-option.is-selected') || {}).textContent);
  await pad(page, 'right');
  check(await picked() === 'No', `▶ on the pad moves to No (${await picked()})`);
  await page.locator('#choice .kit-option[data-index="0"]').tap();
  await expect(page, () => window.__script === 'done' && KIT.game.scene() === 'map', 'tapping Yes answers, and the script goes on');
  check(await asked() === 1, `and it was Yes that was answered (${await asked()})`);
  // Four long answers inside the box, in the kit's own column: they wrap onto
  // lines of their own, every one inside the box, and ◀ ▶ still move.
  await wear(page, { choice: { place: 'in-box' } });                            // (setup)
  await script(page, 'Mom: Which way?\n?\n- Buy something to eat\n\t@set picked = 1\n- Sell the old locket\n\t@set picked = 2\n- Ask about the ruins\n\t@set picked = 3\n- Leave the shop\n\t@set picked = 4');  // (setup)
  await ready(page);
  await page.locator('#dialogue').tap();
  await expect(page, () => KIT.game.scene() === 'choice', 'four long answers, inside the box');
  const four = await page.evaluate(() => {
    const box = document.querySelector('#choice .kit-promptbox').getBoundingClientRect(), screen = document.getElementById('screen').getBoundingClientRect();
    const opts = Array.from(document.querySelectorAll('#choice .kit-promptbox .kit-option')).map(o => o.getBoundingClientRect());
    return { n: opts.length, out: opts.filter(r => r.left < box.left || r.right > box.right || r.top < box.top || r.bottom > box.bottom || r.right > screen.right).length };
  });
  check(four.n === 4 && four.out === 0, `all four inside the box, none off the screen (${four.out} outside)`);
  await pad(page, 'right');
  check(await picked() === 'Sell the old locket', `▶ moves to the next answer, though none is beside it (${await picked()})`);
  await page.locator('#choice .kit-option[data-index="3"]').tap();
  await expect(page, () => window.__script === 'done' && KIT.game.scene() === 'map', 'tapping the last answers');
  check(await asked() === 4, `and it was the one tapped (${await asked()})`);
  // A question with no words, and nothing said before it: the box holds the answers and nothing else.
  await page.evaluate(() => { window.__answer = null; KIT.game.ports.io.choice({ options: [{ text: 'Yes', index: 0 }, { text: 'No', index: 1 }] }).then((i) => { window.__answer = i; }); });  // (setup)
  await expect(page, () => KIT.game.scene() === 'choice', 'a question with no words');
  check(await page.evaluate(() => document.querySelectorAll('#choice .kit-promptbox .kit-line').length) === 0, 'has no empty line over its answers');
  await page.locator('#choice .kit-option[data-index="1"]').tap();
  await expect(page, () => window.__answer === 1 && KIT.game.scene() === 'map', 'and tapping No answers 1');

  beat('6.5', 'Dream: the answers in a window beside the box');
  await wear(page, { base: 'dream' });                                           // (setup)
  await script(page, 'Mom: You found the key under the mat. Will you open the door now?\n?\n- Yes\n\t@set picked = 1\n- No\n\t@set picked = 2');  // (setup)
  await expect(page, () => KIT.game.scene() === 'dialogue', 'Mom asks');
  await ready(page);
  const said = await lineTexts(page);
  await page.locator('#dialogue').tap();
  await expect(page, () => KIT.game.scene() === 'choice', 'the question comes up');
  const beside = await page.evaluate(() => {
    const box = document.querySelector('#choice[data-place="beside-box"] .kit-promptbox'), panel = document.querySelector('#choice[data-place="beside-box"] .kit-panel');
    if (!box || !panel) return null;
    const b = box.getBoundingClientRect(), p = panel.getBoundingClientRect();
    return { box: Math.round(b.left), panel: Math.round(p.left), right: Math.round(b.right), text: box.textContent,
      lines: Array.from(box.querySelectorAll('.kit-line')).map(l => l.textContent), cut: box.scrollHeight > box.clientHeight + 1 };
  });
  check(!!beside && beside.panel >= beside.right && beside.text.includes('Will you open'), `the answers' window is to the right of the question's box (${beside && `${beside.box}–${beside.right} | ${beside.panel}`})`);
  // The question's box is narrower than the line's was: the words flow again
  // at its width, rather than each old line breaking again mid-sentence.
  check(said.length === 2 && !!beside && beside.lines.length === 1 && beside.lines[0] === said.join(' ') && !beside.cut,
    `its lines, wrapped for the wider box, are one flowing line again (${beside && JSON.stringify(beside.lines)})`);
  await page.locator('#choice .kit-option[data-index="1"]').tap();
  await expect(page, () => window.__script === 'done', 'tapping No answers');
  check(await asked() === 2, `and it was No that was answered (${await asked()})`);
  // A grid of answers beside the box: every answer inside its window, and
  // three across — too wide to leave the box room — go over the box instead.
  for (const columns of [2, 3]) {
    await wear(page, { base: 'dream', choice: { layout: 'grid', columns } });   // (setup)
    await script(page, 'Mom: Which way?\n?\n- North\n- East\n- West\n- South');  // (setup)
    await ready(page);
    await page.locator('#dialogue').tap();
    await expect(page, () => KIT.game.scene() === 'choice', `a grid of ${columns} comes up`);
    const grid = await page.evaluate(() => {
      const panel = document.querySelector('#choice .kit-panel').getBoundingClientRect(), box = document.querySelector('#choice .kit-promptbox').getBoundingClientRect();
      const screen = document.getElementById('screen').getBoundingClientRect();
      const opts = Array.from(document.querySelectorAll('#choice .kit-option')).map(o => o.getBoundingClientRect());
      return { out: opts.filter(r => r.left < panel.left || r.right > panel.right || r.top < panel.top || r.bottom > panel.bottom).length,
        off: panel.right > screen.right || panel.left < screen.left, above: panel.bottom <= box.top, beside: panel.left >= box.right };
    });
    check(grid.out === 0 && !grid.off, `every answer of a grid of ${columns} inside its window, on the screen`);
    check(columns === 2 ? grid.beside : grid.above, columns === 2 ? 'two across fit beside the box' : 'three across go over the box');
    await page.locator('#choice .kit-option[data-index="0"]').tap();
    await expect(page, () => window.__script === 'done', 'tapping North answers');
  }
  // Where the question and its answers stand, beside the box: the box, the window, the portrait and the name's tab.
  const layout = () => page.evaluate(() => {
    const rect = (el) => { if (!el || !el.getClientRects().length) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const c = document.getElementById('choice'), box = c.querySelector('.kit-promptbox');
    return { box: rect(box), panel: rect(c.querySelector('.kit-panel')), face: rect(box.querySelector('.kit-facebox')), tab: rect(box.querySelector('.kit-name')),
      tops: Array.from(c.querySelectorAll('.kit-option'), (o) => Math.round(o.getBoundingClientRect().top)) };
  });
  const said2 = () => page.evaluate(() => { const rect = (el) => { if (!el || !el.getClientRects().length) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    return { box: rect(document.querySelector('#dialogue .kit-box')), face: rect(document.querySelector('#dialogue .kit-facebox')) }; });
  const meets = (a, b) => !!a && !!b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  // A long question beside a grid of two: squeezed into what the grid left,
  // it was a column of one or two words, three times the line's height.
  await wear(page, { base: 'dream', choice: { layout: 'grid', columns: 2 } });   // (setup)
  await script(page, 'Mom: You found the key under the mat. Will you open the door now? It is getting late and cold.\n?\n- North\n- East\n- West\n- South');  // (setup)
  await ready(page);
  const longSaid = await said2();
  await page.locator('#dialogue').tap();
  await expect(page, () => KIT.game.scene() === 'choice', 'a long question with a grid of two comes up');
  const longAsk = await layout();
  check(Math.abs(longAsk.box.l - longSaid.box.l) < 1 && Math.abs(longAsk.box.r - longSaid.box.r) < 1 && Math.abs(longAsk.box.t - longSaid.box.t) < 1,
    `its box keeps the line's width and height, not squeezed taller beside the window (${Math.round(longSaid.box.r - longSaid.box.l)}×${Math.round(longSaid.box.b - longSaid.box.t)} → ${Math.round(longAsk.box.r - longAsk.box.l)}×${Math.round(longAsk.box.b - longAsk.box.t)})`);
  check(longAsk.panel.b <= longAsk.box.t && !meets(longAsk.panel, longAsk.tab), 'the window goes over the box\'s right end, clear of the name\'s tab');
  await page.locator('#choice .kit-option[data-index="3"]').tap();
  await expect(page, () => window.__script === 'done', 'tapping South answers');
  // Answers in a row stay a row beside the box: its window took half the
  // screen, and a row that may wrap stacked Yes over No in it.
  await wear(page, { base: 'dream', choice: { layout: 'row' } });               // (setup)
  for (const [yes, no] of [['Yes', 'No'], ['Yes please', 'No thanks']]) {
    await script(page, `Mom: Ready?\n?\n- ${yes}\n- ${no}`);                    // (setup)
    await ready(page);
    await page.locator('#dialogue').tap();
    await expect(page, () => KIT.game.scene() === 'choice', `"${yes}" and "${no}" in a row come up`);
    const row = await layout();
    check(row.tops.length === 2 && row.tops[0] === row.tops[1] && (row.panel.l >= row.box.r || row.panel.b <= row.box.t),
      `side by side, the window beside the box or over it (${JSON.stringify(row.tops)})`);
    await page.locator('#choice .kit-option[data-index="1"]').tap();
    await expect(page, () => window.__script === 'done', `tapping ${no} answers`);
  }
  // Dream's portrait over the box's right corner stays in its corner as the
  // question comes up: it followed the narrowed box a hundred pixels left.
  // Clear of the window, which is taller than the box, it sits on top of it.
  for (const [columns, what] of [[1, 'Yes and No'], [3, 'a grid of three, over the box']]) {
    await wear(page, columns === 1 ? { base: 'dream' } : { base: 'dream', choice: { layout: 'grid', columns } });   // (setup)
    await script(page, `Mom (face=mom): Is that you? Come here, I have something for you.\n?\n- ${columns === 1 ? 'Yes\n- No' : 'North\n- East\n- West\n- South'}`);  // (setup)
    await ready(page);
    const before = await said2();
    await page.locator('#dialogue').tap();
    await expect(page, () => KIT.game.scene() === 'choice', `${what}, asked with a portrait`);
    const ask = await layout();
    check(!!before.face && !!ask.face && Math.abs(ask.face.l - before.face.l) < 1 && Math.abs(ask.face.r - before.face.r) < 1,
      `the portrait keeps its corner (${before.face && Math.round(before.face.l)} → ${ask.face && Math.round(ask.face.l)})`);
    check(!meets(ask.face, ask.panel) && !meets(ask.face, ask.box), 'and no window or box covers it');
    await page.locator('#choice .kit-option[data-index="0"]').tap();
    await expect(page, () => window.__script === 'done', 'tapping the first answer answers');
  }
  // A line with the game dimmed behind it keeps the dim while it asks.
  await wear(page, { base: 'handheld' });                                        // (setup)
  await script(page, 'Mom (bg=dim): Take it?\n?\n- Yes\n- No');                // (setup)
  await ready(page);
  const dimmed = await page.evaluate(() => getComputedStyle(document.getElementById('dialogue')).backgroundColor);
  await page.locator('#dialogue').tap();
  await expect(page, () => KIT.game.scene() === 'choice', 'Handheld asks, over a dimmed game');
  const stillDim = await page.evaluate(() => getComputedStyle(document.getElementById('choice')).backgroundColor);
  check(dimmed !== 'rgba(0, 0, 0, 0)' && stillDim === dimmed, `the game stays dimmed behind the question (${dimmed} → ${stillDim})`);
  await page.locator('#choice .kit-option[data-index="0"]').tap();
  await expect(page, () => window.__script === 'done' && KIT.game.scene() === 'map', 'tapping Yes answers');

  beat('6.6', 'a box that pops open, once a conversation, only where things may move');
  await wear(page, { dialogue: { open: 'pop' }, choice: { place: 'in-box' } });  // (setup)
  const boxAnimation = () => page.evaluate(() => getComputedStyle(document.querySelector('#dialogue .kit-box')).animationName);
  // A box gone for good is hidden (a line by a box that asks keeps it up to
  // the end of its turn): only then is the next line a new conversation.
  const gone = (what) => expect(page, () => KIT.game.scene() === 'map' && document.getElementById('dialogue').hidden, what);
  await page.evaluate(() => { KIT.game.ports.io.say({ text: 'Pop!' }); });     // (setup)
  check(await boxAnimation() === 'none', 'with ?fast=1 the box just appears');
  await ready(page);
  await page.locator('#dialogue').tap();
  await gone('a tap closes it');
  await page.evaluate(() => {                                                    // (setup) as a game without ?fast=1, noting each animation the box starts
    KIT.fx.instant = false; KIT.look.syncMotion();
    window.__opened = [];
    document.getElementById('dialogue').addEventListener('animationstart', (e) => { if (/^kit-(look-pop|shake)$/.test(e.animationName)) window.__opened.push(e.animationName); });
  });
  await page.evaluate(() => { KIT.game.ports.io.say({ text: 'Pop!' }); });     // (setup)
  check(await boxAnimation() === 'kit-look-pop', 'without it, the box pops');
  await ready(page);
  await page.locator('#dialogue').tap();
  await gone('a tap closes it, once the words are all there');
  await page.evaluate(() => { window.__opened.length = 0; });                   // (setup)
  await script(page, 'Mom: One.\nMom: Two {shake}shake.\nMom: Three.\n?\n- Yes\n- No\nMom: Four.');  // (setup)
  for (let i = 0; i < 12 && await page.evaluate(() => window.__script) !== 'done'; i++) {
    if (await scene(page) === 'choice') await page.locator('#choice .kit-option[data-index="0"]').tap();
    else if (await scene(page) === 'dialogue') { await ready(page); await page.locator('#dialogue').tap(); }
    await page.waitForTimeout(80);
  }
  await expect(page, () => window.__script === 'done' && KIT.game.scene() === 'map', 'a conversation of four lines and a question, tapped through');
  const opened = await page.evaluate(() => window.__opened.slice());
  check(opened.filter(n => n === 'kit-look-pop').length === 1 && opened.includes('kit-shake'),
    `the box popped open once, for the first line — not after the shake, nor after the question (${opened.join(', ')})`);
  await page.evaluate(() => { KIT.fx.instant = true; KIT.look.syncMotion(); });  // (setup)

  beat('6.7', 'nothing broke');
  noErrors(errors);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    beat(0, 'the kit look changes nothing');
    const phoneSnap = await snapshot(browser, { width: 390, height: 844 }, true);
    const laptopSnap = await snapshot(browser, { width: 1280, height: 800 }, false);
    const got = { phone: phoneSnap.styles, laptop: laptopSnap.styles };
    if (WRITE) {
      fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
      fs.writeFileSync(FIXTURE, JSON.stringify(got, null, 1) + '\n');
      log(`  wrote ${path.relative(ROOT, FIXTURE)} (${Object.keys(got.phone).length} elements on each device)`);
    } else {
      const want = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
      for (const device of ['phone', 'laptop']) {
        const diff = differences(want[device], got[device]);
        check(diff.length === 0, `${device}: ${Object.keys(got[device]).length} elements look exactly as they did${diff.length ? ` — ${diff.length} differ` : ''}`);
        for (const d of diff.slice(0, 12)) log('     ! ' + d);
      }
      for (const [device, snap] of [['phone', phoneSnap], ['laptop', laptopSnap]]) {
        const p = snap.page;
        check(p.style && p.empty && p.inHead, `${device}: <style id="kit-look"> is in <head>, and empty`);
        check(p.stageStyle === null && p.motion === null, `${device}: #stage has no style attribute and no data-kit-motion`);
        check(p.fast, `${device}: #stage carries data-kit-fast under ?fast=1`);
        check(p.host === true, `${device}: KIT.ui.host makes one overlay, once, directly behind the host it names`);
      }
      await phone(browser);
      await keyboard(browser);
      await pickALook(browser);
      await laptopLook(browser);
      await shortPhone(browser);
      await fontsAndFeel(browser);
    }
  } catch (e) { failures++; log('\nUNCAUGHT: ' + (e && e.stack ? e.stack : e)); }
  await browser.close();
  if (failures) { log(`\n${failures} check(s) failed`); process.exit(1); }
  log('\nPASS');
})();
