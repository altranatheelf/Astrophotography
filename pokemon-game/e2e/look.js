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
    }
  } catch (e) { failures++; log('\nUNCAUGHT: ' + (e && e.stack ? e.stack : e)); }
  await browser.close();
  if (failures) { log(`\n${failures} check(s) failed`); process.exit(1); }
  log('\nPASS');
})();
