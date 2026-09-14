'use strict';
// Phase 1 acceptance (§14): every command round-trips through Screenplay with every field populated;
// a branching script runs deterministically; a blank project normalizes clean and exports/imports identically.
const test = require('node:test');
const assert = require('node:assert/strict');
const KIT = require('./_load.js');
const S = KIT.schema, CMD = KIT.commands, SP = KIT.screenplay, I = KIT.interpreter, P = KIT.project;

function sample(field, depth) {
  const f = S.field(field);
  switch (f.type) {
    case 'string': return f.pattern ? 'abc' : 'x y "q" {b} \\ z';
    case 'text': case 'note': return 'Line one, "quoted" {p1}\nline two: @not-a-command';
    case 'number': { const lo = f.min != null ? f.min : 0; const v = f.integer ? lo + 1 : lo + 1.5; return f.max != null && v > f.max ? f.max : v; }
    case 'bool': return !S.defaultFor(f);
    case 'enum': { const opts = (f.options || []).map(o => (o && typeof o === 'object') ? o.value : o); return opts.find(o => o !== S.defaultFor(f)) || opts[0]; }
    case 'color': return '#123456';
    case 'position': return { x: 3, y: 4 };
    case 'direction': return 'left';
    case 'region': return 7;
    case 'route': return ['up', 'wait:300', 'face:left'];
    case 'script': return depth < 2 ? [{ t: 'say', who: 'A', text: 'nested ' + depth }, { t: 'setVar', name: 'n', op: 'add', value: 1 }] : [];
    case 'condition': return { kind: 'all', of: [{ kind: 'var', name: 'chapter', op: '>=', value: 2 }, { kind: 'not', of: { kind: 'item', id: 'berry', op: '>=', count: 1 } }] };
    case 'strings': return { a: 'b c' };
    case 'scalar': return 'two words';
    case 'list': return [sample(f.of, depth + 1), sample(f.of, depth + 1)];
    case 'group': { const o = {}; for (const g of f.fields || []) o[g.key] = sample(g, depth + 1); return o; }
    default: return f.type.startsWith('ref:') || f.type === 'tile' || f.type === 'face' ? 'some-id' : 'x';
  }
}

test('phase 1: every registered command round-trips through Screenplay with every field populated', () => {
  const all = [];
  for (const def of CMD.list()) {
    const cmd = { t: def.id };
    for (const f of S.fields(def.fields || [])) { if (S.visible(f, cmd)) cmd[f.key] = sample(f, 0); }
    // `when`-gated fields: fill after the gate fields exist
    for (const f of S.fields(def.fields || [])) if (cmd[f.key] === undefined && S.visible(f, cmd)) cmd[f.key] = sample(f, 0);
    all.push(cmd, Object.assign({}, cmd, { disabled: true }));
  }
  assert.ok(all.length >= 80, `expected 40+ commands, got ${all.length / 2}`);
  const norm = CMD.normalizeAll(all);
  const text = SP.serialize(norm);
  const r = SP.parse(text);
  assert.deepEqual(r.problems, []);
  for (let i = 0; i < norm.length; i++) assert.deepEqual(r.commands[i], norm[i], `command ${norm[i].t}${norm[i].disabled ? ' (disabled)' : ''}:\n${SP.serialize([norm[i]])}`);
  assert.equal(SP.serialize(r.commands), text);
});

test('phase 1: a branching script runs deterministically with the fake ctx', async () => {
  const cmds = SP.parse(['@set roll = random(1, 6)', '? Which?', '- Left', '    Mom: left {var:roll}', '- Right', '    Mom: right {var:roll}'].join('\n')).commands;
  const a = I.fakeCtx({ seed: 3, answers: ['Right'] }); await I.run(cmds, a);
  const b = I.fakeCtx({ seed: 3, answers: ['Right'] }); await I.run(cmds, b);
  assert.deepEqual(a.said(), b.said());
  assert.match(a.said()[0], /^right \d$/);
});

test('phase 1: blank project normalizes with zero problems and exports/imports identically', () => {
  const { project, problems } = P.normalize(P.blank());
  assert.deepEqual(problems.filter(p => p.severity === 'error'), []);
  const files = P.exportFiles(project);
  assert.ok(Object.keys(files).some(k => k === 'project.js'));
  const back = P.importFiles(files);
  assert.deepEqual(back, project);
  assert.equal(JSON.stringify(P.exportFiles(back)), JSON.stringify(files));
});
