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

/**
 * Every table a project carries, and where an AUTHOR edits it. A panel id means
 * that panel owns it; a sentence means it is deliberately edited somewhere else,
 * and the sentence has to say where.
 *
 * This list exists because `rules` was added to the project format, filled by
 * the normalizer, saved, validated, referenced by a command, a condition and a
 * screenplay form — and for a while had no screen. Every one of those pieces had
 * a passing test. The engine could do it and nobody could reach it, which is the
 * exact failure the top of this file is about, one layer up.
 */
const AUTHORED_IN = {
  strings: 'strings',
  vars: 'vars',
  items: 'items',
  rules: 'rules',
  cast: 'cast',
  scripts: 'scripts',
  facts: 'the Cast panel — a fact is something a person can know, and is edited beside them (panel-cast.js, the "What is known" tab)',
  languages: 'the Project panel\'s Languages section: add, import, export, delete a translation',
  maps: 'the map editor itself (panels-map.js) and the Objects panel — a map is not a table row',
  assets: 'the Import panel: art comes in from Tiled/RPG Maker/Aseprite, it is not typed in',
  autotiles: 'the Import panel, same as the rest of the art',
  // The look is not filled in by normalize — an absent key is the kit's own
  // look — so these are not `p.x = {}` lines and the loop below never meets
  // them. They are held to a real panel by the check after it.
  ui: 'look',
  looks: 'look',
  fonts: 'look',
  voices: 'the Look group\'s Voices panel',
};

test('every table a project carries is editable by an author', () => {
  const project = read('js/kit/world/project.js');
  const tables = Array.from(project.matchAll(/^\s*p\.([a-zA-Z]+) = \{\};/gm)).map((m) => m[1]);
  assert.ok(tables.length >= 8, `found the project's tables (${tables.length})`);

  const panelSrc = ['js/kit/editor/panels-project.js', 'js/kit/editor/panels-writing.js',
    'js/kit/editor/panels-objects.js', 'js/kit/editor/panels-map.js', 'js/kit/editor/panel-cast.js',
    'js/kit/editor/panel-look.js']
    .map(read).join('\n');
  const panels = new Set(Array.from(panelSrc.matchAll(/editorPanels'\)\.add\(\{\s*\n?\s*id: '([a-z-]+)'/g)).map((m) => m[1]));
  assert.ok(panels.size >= 6, `found the panels (${Array.from(panels).sort().join(', ')})`);

  const unreachable = [];
  for (const t of tables) {
    const where = AUTHORED_IN[t];
    if (!where) { unreachable.push(`${t} (not in AUTHORED_IN at all)`); continue; }
    // A one-word answer names a panel, and the panel has to be real.
    if (/^[a-z-]+$/.test(where) && !panels.has(where)) unreachable.push(`${t} (says panel '${where}', which does not exist)`);
  }
  assert.deepEqual(unreachable, [],
    `a project can hold these and no author can edit them: ${unreachable.join('; ')}.\n` +
    'Add a panel to the editorPanels registry, or add the table to AUTHORED_IN with the place it IS edited.');
  // And every panel this list names is real, whether or not normalize lists
  // the table: `ui` is edited in the Look panel or it is edited nowhere.
  const ghosts = Object.keys(AUTHORED_IN).filter((t) => /^[a-z-]+$/.test(AUTHORED_IN[t]) && !panels.has(AUTHORED_IN[t]));
  assert.deepEqual(ghosts, [], `AUTHORED_IN names panels that do not exist: ${ghosts.map((t) => `${t} → ${AUTHORED_IN[t]}`).join(', ')}`);
});

test('a player can actually walk back into a moment', () => {
  // The tree of moments (ADR-0013) is the same kind of thing the top of this
  // file is about: a capability with nothing in front of it. It is not a
  // setting and not a project table, so neither of the checks above would see
  // it — and the whole feature is "go back to when you were in the graveyard",
  // which is a screen or it is nothing.
  const menu = read('js/kit/scenes/menu.js');
  const game = read('js/kit/game.js');
  assert.ok(/\{ id: 'moments'/.test(menu), 'there is a Moments entry in the pause menu');
  assert.ok(/mode === 'moments'/.test(menu), 'and the menu scene knows how to draw it');
  assert.ok(/function momentRows/.test(menu), 'from real rows');
  assert.ok(/'moment:'/.test(menu) && /action\.startsWith\('moment:'\)/.test(menu),
    'and choosing a row does something');
  assert.ok(/G\.gotoMoment = /.test(game), 'which the game implements');
  assert.ok(/KIT\.timeline\.record\(/.test(game),
    'and every save records one, so the list is never empty for a player who has played');
  assert.ok(/KIT\.timeline\.headTo\(/.test(game),
    'and loading a save stands at its moment, which is what makes the next save branch');
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
