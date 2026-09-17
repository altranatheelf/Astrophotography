'use strict';
// Can a player actually GET to it?
//
// This test exists because the same defect landed three times in one week, and
// nobody noticed until an audit went looking:
//
//   - a complete localization pipeline no player could select a language from
//   - separate sound and music volumes in the API and in the saved settings,
//     with no way to change either
//   - a git-mergeable project format the editor had no button for
//
// Each time, the capability was real, tested, and unreachable. 455 unit tests
// passed and not one of them would have failed if the feature had been deleted
// from the product's reach, because the definition of "done" in this codebase
// had quietly become "the API exists and a unit test calls it".
//
// So this is the rule, written down: a device setting a player is meant to
// change must be reachable from the settings menu. It is deliberately narrow —
// a grep over the whole KIT surface produces mostly noise, and noise gets
// muted. This checks the exact contract that actually broke.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/**
 * Settings the player is NOT expected to find in the menu, each with the reason.
 * Adding to this list is allowed and is meant to be uncomfortable: it is a
 * written admission that a setting exists which nobody can change.
 */
const NOT_IN_MENU = {
  coop: 'has its own pause-menu row (menus registry: "Two players"), not a settings row',
  keys: 'remapping needs a key-capture screen; the API is there and the screen is not — see docs',
};

test('every player setting is reachable from the settings menu', () => {
  const storage = read('js/kit/core/storage.js');
  const menu = read('js/kit/scenes/menu.js');

  const block = /const DEFAULT_SETTINGS = \{([\s\S]*?)\n  \};/.exec(storage);
  assert.ok(block, 'found DEFAULT_SETTINGS');
  // Comments inside the block describe shapes ({ code: button }), which look
  // exactly like settings. Strip them first.
  const body = block[1].replace(/\/\/[^\n]*/g, '');
  const keys = Array.from(body.matchAll(/(?:^|[{,])\s*([A-Za-z_]\w*)\s*:/gm)).map((m) => m[1]);
  assert.ok(keys.length >= 8, `found the settings (${keys.length})`);

  // Scoped to the ROWS, not the whole file. The first version of this test
  // searched all of menu.js and passed with the volume row deleted, because the
  // handler in nudge() still mentioned `s.soundVolume` — a setting you can only
  // change if you can see it, and the handler is not a row.
  const from = menu.indexOf('function settingRows');
  const to = menu.indexOf('function nudge');
  assert.ok(from > 0 && to > from, 'found settingRows()');
  const rows = menu.slice(from, to);

  const unreachable = [];
  for (const key of keys) {
    if (NOT_IN_MENU[key]) continue;
    // Reachable means a ROW offers it: `cycle:zoom`, `toggle:sound`, or a row
    // built from `s.soundVolume`.
    const named = new RegExp(`(cycle|toggle):${key}\\b|\\bs\\.${key}\\b`).test(rows);
    if (!named) unreachable.push(key);
  }
  assert.deepEqual(unreachable, [],
    `these settings exist but no player can change them: ${unreachable.join(', ')}.\n` +
    'Add a row to settingRows() in js/kit/scenes/menu.js, or add it to NOT_IN_MENU with a reason.');
});

test('the settings menu does not offer settings that do not exist', () => {
  const storage = read('js/kit/core/storage.js');
  const menu = read('js/kit/scenes/menu.js');
  const block = /const DEFAULT_SETTINGS = \{([\s\S]*?)\n  \};/.exec(storage);
  const keys = new Set(Array.from(block[1].replace(/\/\/[^\n]*/g, '').matchAll(/(?:^|[{,])\s*([A-Za-z_]\w*)\s*:/gm)).map((m) => m[1]));
  const offered = Array.from(menu.matchAll(/'(?:cycle|toggle):(\w+)'/g)).map((m) => m[1]);
  const ghosts = offered.filter((k) => !keys.has(k) && k !== 'language');
  assert.deepEqual(ghosts, [], `the menu cycles settings that are not declared: ${ghosts.join(', ')}`);
});

test('the words the menu says are in the Terms table, so they can be translated', () => {
  const project = read('js/kit/world/project.js');
  const menu = read('js/kit/scenes/menu.js');
  // Every t('...') the menu asks for must be a registered string.
  // `t('speed-' + s.textSpeed)` asks for several ids at once; check the family
  // rather than pretending there is one called 'speed-'.
  const asked = Array.from(menu.matchAll(/\bt\('([a-z-]+)'(\s*\+)?/g))
    .filter((m) => !m[2])
    .map((m) => m[1]);
  const families = Array.from(menu.matchAll(/\bt\('([a-z-]+-)'\s*\+/g)).map((m) => m[1]);
  assert.ok(asked.length >= 8, `the menu goes through the Terms table (${asked.length} lookups)`);
  const missing = asked.filter((id) => !new RegExp(`id: '${id}'`).test(project));
  for (const fam of families) {
    const any = new RegExp(`id: '${fam}\\w+'`).test(project);
    if (!any) missing.push(fam + '*');
  }
  assert.deepEqual(missing, [],
    `the menu asks for Terms that are not registered, so they fall back to the raw id: ${missing.join(', ')}`);
});

test('a translatable game does not hide English literals in its own menu', () => {
  const menu = read('js/kit/scenes/menu.js');
  const rows = menu.slice(menu.indexOf('function settingRows'), menu.indexOf('function nudge'));
  const literals = Array.from(rows.matchAll(/label:\s*'([A-Z][^']{2,})'/g)).map((m) => m[1]);
  assert.deepEqual(literals, [],
    `hardcoded English in the settings menu — extraction is Terms-driven, so these can never be translated: ${literals.join(', ')}`);
});
