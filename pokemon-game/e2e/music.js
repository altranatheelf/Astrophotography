// e2e/music.js — music that answers what is happening.
//
//   NODE_PATH=$(npm root -g) node e2e/music.js
//
// A real AudioContext, because the thing worth checking is the audio graph and
// not a bookkeeping object agreeing with itself. A track with named layers is
// played; layers are brought up and down; the gain nodes are read while the
// fades are still running; the piece is checked to be the same piece afterwards.
//
// That last point is the whole feature. RPG Maker's answer to "the music should
// get tense now" is to play a different track, which restarts it. Here the
// layers have been playing silently all along on their own gain nodes, so one
// swells in on the beat it was already on.
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html');
const IGNORE = /fonts\.googleapis|fonts\.gstatic|ERR_CERT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_FAILED.*fonts|AudioContext/i;

let failures = 0;
const log = (...a) => console.log(...a);
const beat = (n, what) => log(`\n--- ${n}. ${what} ---`);
function check(ok, what) {
  if (ok) log('  ok  ' + what);
  else { failures++; log('  FAIL ' + what); }
  return ok;
}

const errors = [];

async function run(browser) {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(PAGE);
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted, { timeout: 30000 });

  const setup = await page.evaluate(async () => {
    KIT.audio.unlock();
    KIT.registry('music').add({
      id: 'e2e-storm', name: 'Storm', kind: 'synth', tempo: 140, gain: 0.2,
      lead: ['c4', '-', 'e4', '-', 'g4', '-', 'e4', '-'],
      bass: ['c2', '-', '-', '-', 'g1', '-', '-', '-'],
      layers: {
        rain: { drum: ['h', 'h', 'h', 'h', 'h', 'h', 'h', 'h'], gain: 0.1 },
        danger: { bass: ['c2', 'c2', 'e2', 'e2'], bassWave: 'sawtooth', gain: 0.18 },
        chorus: { lead: ['c5', 'e5', 'g5', 'e5'], gain: 0.12, on: true },
      },
    });
    await KIT.audio.music('e2e-storm');
    await new Promise((r) => setTimeout(r, 200));
    return {
      context: !!KIT.audio.init(),
      playing: KIT.audio.current(),
      names: KIT.audio.layersOf('e2e-storm'),
      start: KIT.audio.layers(),
      chorusAtStart: KIT.audio.layerGain('chorus'),
    };
  });

  beat(1, 'a track with layers plays, and the layers are real nodes');
  check(setup.context, 'there is an AudioContext');
  check(setup.playing === 'e2e-storm', 'the track is playing');
  check(setup.names.join(',') === 'rain,danger,chorus', `it declares its layers (${setup.names.join(', ')})`);
  check(setup.start.rain === 0 && setup.start.danger === 0, 'layers start down');
  check(setup.chorusAtStart === 1, 'unless the track says `on: true` — then it is up from the first bar');

  beat(2, 'bringing a layer in ramps the graph, it does not jump');
  const fade = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const before = KIT.audio.layerGain('rain');
    KIT.audio.layer('rain', true, 1000);
    await wait(400);
    const mid = KIT.audio.layerGain('rain');
    await wait(900);
    return { before, mid, after: KIT.audio.layerGain('rain'), playing: KIT.audio.current() };
  });
  check(fade.before === 0, 'it was down');
  check(fade.mid > 0.05 && fade.mid < 0.95, `and part way up mid-fade (${fade.mid.toFixed(2)}) — a ramp, not a switch`);
  check(fade.after === 1, 'and up at the end');
  check(fade.playing === 'e2e-storm', 'and it is STILL THE SAME PIECE — nothing restarted');

  beat(3, 'a layer can sit part way, for weather rather than a switch');
  const half = await page.evaluate(async () => {
    KIT.audio.layer('danger', 0.4, 50);
    await new Promise((r) => setTimeout(r, 200));
    return { want: KIT.audio.layers().danger, real: KIT.audio.layerGain('danger') };
  });
  check(Math.abs(half.want - 0.4) < 0.001, 'the wish is 0.4');
  check(Math.abs(half.real - 0.4) < 0.02, `and the graph is there too (${half.real.toFixed(2)})`);

  beat(4, 'taking one out goes to true silence, not nearly');
  const out = await page.evaluate(async () => {
    KIT.audio.layer('rain', false, 100);
    await new Promise((r) => setTimeout(r, 300));
    return KIT.audio.layerGain('rain');
  });
  check(out === 0, `exactly zero (${out}) — an exponential ramp could never get there`);

  beat(5, 'a wish outlives the track it was made on');
  const across = await page.evaluate(async () => {
    KIT.audio.layer('danger', true, 10);
    await new Promise((r) => setTimeout(r, 100));
    KIT.registry('music').add({ id: 'e2e-other', name: 'Other', kind: 'synth', tempo: 120,
      lead: ['a3', '-'], layers: { danger: { drum: ['k', '-'], gain: 0.2 } } });
    await KIT.audio.music('e2e-other');
    await new Promise((r) => setTimeout(r, 250));
    return { want: KIT.audio.layers().danger, real: KIT.audio.layerGain('danger'), playing: KIT.audio.current() };
  });
  check(across.playing === 'e2e-other', 'the track changed');
  check(across.want === 1, 'the wish survived it');
  check(across.real === 1, 'and the new track came in with that layer already up, no second fade');

  beat(6, 'the command says it in one line, both ways');
  const script = await page.evaluate(() => {
    const text = '@layer rain on ms=1200\n@layer danger off\n@layer "the far rain" on';
    const r = KIT.screenplay.parse(text);
    return { problems: r.problems, cmds: r.commands, back: KIT.screenplay.serialize(r.commands) };
  });
  check(script.problems.length === 0, 'it parses');
  check(script.cmds[0].name === 'rain' && script.cmds[0].on === true && script.cmds[0].ms === 1200, 'with the right fields');
  check(script.cmds[1].on === false, 'off means off');
  check(script.cmds[2].name === 'the far rain', 'a name with spaces survives the quotes');
  check(script.back === '@layer rain on ms=1200\n@layer danger off\n@layer "the far rain" on', 'and it writes back exactly as typed');

  beat(7, 'the music gets out of the way of a voice');
  const ducked = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await KIT.audio.music('e2e-storm');
    await wait(150);
    const idle = KIT.audio.duckedBy();
    KIT.scenes.push('dialogue', { text: 'Someone is talking.' });
    await wait(300);
    const one = KIT.audio.duckedBy();
    KIT.scenes.push('dialogue', { text: 'And someone else.' });
    await wait(200);
    const two = KIT.audio.duckedBy();
    KIT.scenes.pop(); await wait(200);
    const stillOne = KIT.audio.duckedBy();
    KIT.scenes.pop(); await wait(600);
    return { idle, one, two, stillOne, back: KIT.audio.duckedBy(), playing: KIT.audio.current() };
  });
  check(ducked.idle === 0, 'nothing ducking to begin with');
  check(ducked.one === 1, 'a line of dialogue pulls the music down');
  check(ducked.two === 2, 'a second line over the top does not double-duck the level');
  check(ducked.stillOne === 1, 'closing one leaves the other one holding it down');
  check(ducked.back === 0, 'and the last one lets it back up');
  check(ducked.playing === 'e2e-storm', 'all without touching the track');

  beat(8, 'a file track loops where the composer said, and is on the graph');
  const file = await page.evaluate(async () => {
    const rate = 44100, secs = 3, n = rate * secs;
    const buf = new ArrayBuffer(44 + n * 2);
    const view = new DataView(buf);
    const put = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    put(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); put(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    put(36, 'data'); view.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      view.setInt16(44 + i * 2, Math.sin(t * (t < 1 ? 220 : 440) * 2 * Math.PI) * 8000, true);
    }
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    KIT.registry('music').add({ id: 'e2e-file', name: 'File', kind: 'file', src: url,
                                loop: true, loopStart: 1, loopEnd: 3 });
    await KIT.audio.music('e2e-file');
    await new Promise((r) => setTimeout(r, 700));
    const decoded = KIT.audio.loaded(url);
    const playing = KIT.audio.current();
    // Ducking only reaches it if it is on the audio graph. An <audio> element
    // would keep playing at full volume, which is exactly the old bug.
    KIT.audio.duck(0.2, 20);
    await new Promise((r) => setTimeout(r, 120));
    const ducked = KIT.audio.duckedBy();
    KIT.audio.unduck(20);
    await new Promise((r) => setTimeout(r, 100));
    const released = KIT.audio.duckedBy();
    // an <audio> element would still be in flight; there should be none
    const elements = document.querySelectorAll('audio').length;
    URL.revokeObjectURL(url);
    return { decoded, playing, ducked, released, elements };
  });
  check(file.decoded, 'the file was decoded rather than handed to an <audio> element');
  check(file.playing === 'e2e-file', 'and it is the playing track');
  check(file.elements === 0, 'with no <audio> element in the page at all');
  check(file.ducked === 1 && file.released === 0, 'and it ducks, which only works on the graph');

  beat(9, 'nothing broke');
  await page.evaluate(() => KIT.audio.stop('all'));
  check(errors.length === 0, `no console errors or page errors${errors.length ? ': ' + errors[0] : ''}`);
  for (const e of errors) log('     ! ' + e);
  await page.close();
}

(async () => {
  // The context is allowed without a gesture here so the graph can be measured.
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try { await run(browser); }
  catch (e) { failures++; log('\nUNCAUGHT: ' + (e && e.stack ? e.stack : e)); }
  await browser.close();
  if (failures) { log(`\n${failures} check(s) failed`); process.exit(1); }
  log('\nPASS');
})();
