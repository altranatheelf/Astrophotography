'use strict';
// Nothing the editor says out loud may depend on a key a phone does not have.
//
// Creator Mode runs on a phone, and every "Ctrl+Z brings it back" was a promise
// to half the people reading it. The undo affordance that exists everywhere is
// the ↶ button in the tool row (and a two-finger tap on touch), so that is what
// the copy names. `Ctrl+Z` may still appear as the *extra* — in the ↶ button's
// own tooltip, and in the keyboard table in the docs — never as the only way.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FILES = fs.readdirSync(path.join(ROOT, 'js/kit/editor'))
  .filter(f => f.endsWith('.js'))
  .concat(['../scenes/start.js', '../scenes/title.js', '../world/project.js'])
  .map(f => path.join('js/kit/editor', f));

/** A line that says Ctrl, or Escape, to somebody, rather than about somebody. */
const MENTIONS = /Ctrl\+|[Pp]ress Escape|text: 'Escape'/;
/** The ones that are allowed to: they name the button in the same breath, or only show on a keyboard. */
const PAIRED = /↶|↷|Undo \(|Redo \(|isTouch\(\)/;

test('no editor message tells a phone to press a key it does not have', () => {
  const guilty = [];
  for (const rel of FILES) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!MENTIONS.test(line)) return;
      if (PAIRED.test(line)) return;                       // names the button too
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;         // a comment is for a reader of the code
      guilty.push(`${rel}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(guilty, [],
    'these name a key a phone does not have, without the button that works everywhere:\n  ' + guilty.join('\n  '));
});

test('the undo button is still there to be named', () => {
  const editor = fs.readFileSync(path.join(ROOT, 'js/kit/editor/editor.js'), 'utf8');
  assert.match(editor, /ED\.el\.undoBtn\s*=\s*mk\('↶'/, 'the ↶ button the copy points at');
  assert.match(editor, /g\.fingers === 2\) \{ ED\.undo\(\)/, 'and the two-finger tap that is undo on touch');
});
