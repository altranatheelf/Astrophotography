'use strict';
// REMAPPING THE CONTROLS.
//
// The Game Accessibility Guidelines' Basic tier — the realistic floor for a
// one-person game — opens with "allow controls to be remapped", and Steam Deck's
// compatibility review requires the default configuration to reach all content
// with no in-game changes. This engine had the whole API for weeks: bind,
// setKeymap, resetKeymap, keymaps, and `settings.keys` saved and restored at
// boot. Every piece worked, a unit test called each one, and no player could
// reach any of it. `test/kit/reachable.test.js` carried it as a written
// admission, which is the honest thing to do and not a fix.
//
// The pure half of the screen is checked here; that a player can really walk
// into it and change a key is `e2e/keys.js`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const KIT = require('./_load.js');
require(path.join(__dirname, '..', '..', 'js/kit/scenes/stack.js'));
require(path.join(__dirname, '..', '..', 'js/kit/scenes/menu.js'));
const I = KIT.input;

test('keys: a physical key code is shown as the thing printed on the key', () => {
  // `KeyboardEvent.code` is a position, not a label: `KeyZ` whatever the cap
  // says, `Digit1` for the 1 above the letters. A remapping screen that showed
  // the codes would be asking a player to read a spec.
  for (const [code, want] of [
    ['ArrowUp', '↑'], ['ArrowLeft', '←'], ['KeyZ', 'Z'], ['KeyQ', 'Q'],
    ['Space', 'Space'], ['Enter', 'Enter'], ['NumpadEnter', 'Enter (num)'], ['Escape', 'Esc'],
    ['Digit1', '1'], ['Numpad5', 'Num 5'], ['F11', 'F11'], ['Comma', ','], ['Period', '.'],
  ]) assert.equal(I.keyLabel(code), want, code);
  // Anything unheard-of still has to read as something.
  assert.equal(I.keyLabel('MediaPlayPause'), 'Media Play Pause');
  assert.equal(I.keyLabel(''), '—');
});

test('keys: the screen offers every button, for the players there are', () => {
  I.resetKeymap();
  const project = { meta: { id: 'k' }, strings: {} };
  const one = KIT.keysScreen.rows(project, 1);
  const actions = one.filter(r => r.action && r.action.startsWith('bind:')).map(r => r.action);
  assert.deepEqual(actions, I.KEYS.map(b => `bind:0:${b}`),
    'every button the engine has, in the order it lists them');
  assert.ok(one.some(r => r.action === 'keys-reset'), 'and a way back to the defaults');
  assert.ok(one.some(r => r.action === 'back'), 'and a way out');
  assert.ok(!one.some(r => r.heading), 'one player needs no headings');

  const two = KIT.keysScreen.rows(project, 2);
  assert.equal(two.filter(r => r.action && r.action.startsWith('bind:1:')).length, I.KEYS.length,
    'in co-op, player two gets the same list');
  assert.equal(two.filter(r => r.heading).length, 2, 'with a heading each, so you know whose keys these are');
});

test('keys: a row shows the keys that really mean that button', () => {
  I.resetKeymap();
  const rows = KIT.keysScreen.rows({ meta: { id: 'k' }, strings: {} }, 1);
  const a = rows.find(r => r.action === 'bind:0:a');
  assert.equal(a.value, 'Enter / Z / Enter (num) / Space', 'all four of them, as a player would recognise them');
  const menu = rows.find(r => r.action === 'bind:0:menu');
  assert.equal(menu.value, 'Esc');
});

test('keys: “put them back” is offered only when there is something to put back', () => {
  I.resetKeymap();
  const project = { meta: { id: 'k' }, strings: {} };
  assert.equal(KIT.keysScreen.rows(project, 1).find(r => r.action === 'keys-reset').disabled, true,
    'nothing has changed, so the row is there but greyed — not missing, which would be a moving list');
  I.bind(0, 'KeyQ', 'a');
  assert.equal(KIT.keysScreen.rows(project, 1).find(r => r.action === 'keys-reset').disabled, false);
  const a = KIT.keysScreen.rows(project, 1).find(r => r.action === 'bind:0:a');
  assert.ok(a.value.includes('Q'), `the new key is shown (${a.value})`);
  I.resetKeymap();
  assert.equal(I.isDefaultKeymap(), true, 'and putting them back really does');
});

test('keys: binding a key that already means something MOVES it', () => {
  // A code can only mean one thing per player. The screen says what it took the
  // key away from, because a silent steal is how a player ends up unable to open
  // the menu with no idea why.
  I.resetKeymap();
  assert.equal(I.keymap(0).KeyZ, 'a');
  I.bind(0, 'KeyZ', 'b');
  assert.equal(I.keymap(0).KeyZ, 'b', 'it moved');
  assert.ok(!I.boundTo(0, 'a').includes('KeyZ'), 'and is not still on the old button as well');
  assert.ok(I.boundTo(0, 'a').length, 'talk/choose is not left with nothing, because it had four keys');
  I.resetKeymap();
});

test('keys: a button can be left with nothing, and the screen says so', () => {
  // Allowed on purpose: somebody may want the menu on one key and nothing else,
  // or may be building a one-handed layout. An empty button reads as empty
  // rather than as the default it no longer is.
  I.resetKeymap();
  for (const code of I.boundTo(0, 'menu')) I.bind(0, code, null);
  assert.deepEqual(I.boundTo(0, 'menu'), []);
  const row = KIT.keysScreen.rows({ meta: { id: 'k' }, strings: {} }, 1).find(r => r.action === 'bind:0:menu');
  assert.equal(row.value, 'nothing');
  I.resetKeymap();
});

test('keys: the one key that cannot be captured is named, not hidden', () => {
  // Escape is how a player gets out of the waiting state, so it cannot also be
  // the key they are binding. That is a real limitation and it is declared on
  // the input module rather than buried in the scene, so somebody can find it.
  assert.deepEqual(I.NOT_CAPTURABLE, ['Escape']);
  assert.equal(I.capturable('Escape'), false);
  assert.equal(I.capturable('KeyQ'), true);
  assert.equal(I.capturable(''), false);
});

test('keys: a saved table survives a reload, and only overrides what it names', () => {
  I.resetKeymap();
  I.bind(0, 'KeyQ', 'a');
  const saved = I.keymaps();
  I.resetKeymap();
  I.setKeymap(saved);
  assert.equal(I.keymap(0).KeyQ, 'a', 'the change came back');
  assert.equal(I.keymap(0).ArrowUp, 'up', 'and the keys nobody touched are still the engine’s');
  assert.equal(I.keymap(1).KeyW, 'up', 'including player two’s');
  I.resetKeymap();
});
