// e2e/voices.js — a voice is a bundle, and it can change mid-sentence.
//
//   NODE_PATH=$(npm root -g) node e2e/voices.js
//
// Undertale's "character voice" is a numbered preset carrying font, colour, box
// geometry, typing speed, letter shake and blip sound together — 114 of them, in
// a 310-line if-chain, and `\TX` switches one mid-line. That bundle is why Sans
// and Papyrus sound and look like themselves. The bundle is the right idea; 114
// hardcoded presets is not.
//
// Checked in a browser because the half that matters is the half a unit test
// cannot see: what the box actually puts on screen, and how fast.
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'index.html');
const SHOTS = process.env.KIT_SHOTS ||
  '/tmp/claude-0/-home-user-Astrophotography/19812bb4-4e6f-5d04-84c2-78d4b1a8e91f/scratchpad/kit/shots';
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
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(PAGE);
  await page.waitForFunction(() => window.KIT && KIT.game && KIT.game.booted, { timeout: 30000 });
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => KIT.game.scene() === 'map' && !!KIT.game.world && !KIT.interpreter.mainBusy())) break;
    await page.keyboard.press('z');
    await page.waitForTimeout(140);
  }

  await page.evaluate(() => {
    KIT.registry('voices').addAll([
      { id: 'e2e-slow', name: 'Slow', sound: 'blip', pitch: 0.55, everyChars: 2,
        font: '"Comic Sans MS", cursive', color: '#2b3a55', speed: 12 },
      { id: 'e2e-loud', name: 'Loud', sound: 'blip', pitch: 1.5, everyChars: 1,
        font: 'Papyrus, fantasy', color: '#b8860b', size: 'big', speed: 60 },
    ]);
  });

  beat(1, 'one message, two voices, and each run wears its own');
  const look = await page.evaluate(async () => {
    KIT.scenes.push('dialogue', {
      who: 'Slow', voice: 'e2e-slow',
      text: 'quiet here.\n{voice:e2e-loud}NOT HERE{/voice}\nquiet again.',
      ctx: {},
    });
    await new Promise((r) => setTimeout(r, 4000));      // let it finish typing
    const t = document.querySelector('.kit-text');
    const runs = Array.from(t.querySelectorAll('.kit-line > span')).map((el) => ({
      text: el.textContent,
      font: el.style.fontFamily,
      color: el.style.color,
      big: el.classList.contains('is-big'),
    })).filter((r) => r.text.trim());
    const name = document.querySelector('.kit-name');
    return { runs, nameFont: name.style.fontFamily, nameColor: name.style.color };
  });
  check(look.runs.length === 3, `three runs (${look.runs.length})`);
  check(/Comic Sans/.test(look.runs[0].font), 'the first wears the line voice');
  check(/Papyrus/.test(look.runs[1].font), 'the middle switched font mid-message');
  check(look.runs[1].big === true, 'and size');
  check(look.runs[1].color !== look.runs[0].color, 'and colour');
  check(/Comic Sans/.test(look.runs[2].font), 'and it popped back afterwards');
  check(/Comic Sans/.test(look.nameFont), 'the name box wears the speaker too');

  beat(2, 'the pace follows whoever is speaking');
  const pace = await page.evaluate(async () => {
    KIT.scenes.pop();
    KIT.scenes.push('dialogue', { who: 'Slow', voice: 'e2e-slow',
      text: 'aaaaaaaaaaaaaaaaaaaaaaaa', ctx: {} });
    await new Promise((r) => setTimeout(r, 1000));
    const slow = document.querySelector('.kit-text').textContent.length;
    KIT.scenes.pop();
    KIT.scenes.push('dialogue', { who: 'Loud', voice: 'e2e-loud',
      text: 'aaaaaaaaaaaaaaaaaaaaaaaa', ctx: {} });
    await new Promise((r) => setTimeout(r, 1000));
    const fast = document.querySelector('.kit-text').textContent.length;
    KIT.scenes.pop();
    return { slow, fast };
  });
  check(pace.slow > 2 && pace.slow < 22, `the slow voice typed ${pace.slow} letters in a second (asked for 12)`);
  check(pace.fast > pace.slow * 1.8, `the loud one typed ${pace.fast} — genuinely faster, not a label`);

  beat(3, 'a per-letter effect is per letter, and staggered');
  const fx = await page.evaluate(async () => {
    KIT.scenes.push('dialogue', { who: '', text: '{fx:wave,2}wavy{/fx} and {fx:shiver}brr{/fx}', ctx: {} });
    await new Promise((r) => setTimeout(r, 2500));
    const t = document.querySelector('.kit-text');
    const wave = Array.from(t.querySelectorAll('.kit-fx-wave'));
    const shiver = Array.from(t.querySelectorAll('.kit-fx-shiver'));
    const host = wave.length ? wave[0].parentElement : null;
    return {
      waveChars: wave.length,
      shiverChars: shiver.length,
      delays: wave.slice(0, 3).map((c) => c.style.animationDelay),
      amount: host ? getComputedStyle(host).getPropertyValue('--kit-fx').trim() : '',
      moving: wave.length ? getComputedStyle(wave[1]).animationName : '',
    };
  });
  check(fx.waveChars === 4, `one element per letter of "wavy" (${fx.waveChars})`);
  check(fx.shiverChars === 3, `and per letter of "brr" (${fx.shiverChars})`);
  check(fx.delays.join(',') === '0ms,70ms,140ms', `each letter later than the last (${fx.delays.join(', ')})`);
  check(fx.amount === '2', `the amount reached the CSS (--kit-fx: ${fx.amount})`);
  check(fx.moving === 'kit-fx-wave', 'and the animation is actually running');

  beat(4, 'an effected run still finishes typing');
  const typed = await page.evaluate(() => {
    const vis = Array.from(document.querySelectorAll('.kit-char')).filter((c) => c.style.visibility === 'visible');
    return { visible: vis.length, total: document.querySelectorAll('.kit-char').length };
  });
  check(typed.visible === typed.total && typed.total === 7,
    `every letter revealed (${typed.visible}/${typed.total}) — hidden letters hold the layout still while it types`);

  await page.screenshot({ path: SHOTS + '/voices.png' });
  await page.evaluate(() => KIT.scenes.pop());

  beat(5, 'nothing broke');
  check(errors.length === 0, `no console errors or page errors${errors.length ? ': ' + errors[0] : ''}`);
  for (const e of errors) log('     ! ' + e);
  await page.close();
}

(async () => {
  const browser = await chromium.launch();
  try { await run(browser); }
  catch (e) { failures++; log('\nUNCAUGHT: ' + (e && e.stack ? e.stack : e)); }
  await browser.close();
  log(`\nscreenshot: ${SHOTS}/voices.png`);
  if (failures) { log(`\n${failures} check(s) failed`); process.exit(1); }
  log('\nPASS');
})();
