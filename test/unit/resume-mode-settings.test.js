'use strict';

// [UNIT] v1.363 W2 - Settings > Playback > "When a video has saved progress": the mode (Resume automatically /
// Ask me) and the Ask-only countdown controls, on the REAL setup.html with the REAL setup.js wiring. Reflect on
// load, write on change, reveal on Ask and hide on Auto (both axes), the clamp = the player's resolver, and the
// device-local keys: byte-identical between setup.js and player.js, never named in server.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const setup = require('../../public/js/setup.js');
const player = require('../../public/js/player.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HTML = read('public/setup.html');
const KEYS = ['filetube_resume_mode', 'filetube_resume_countdown', 'filetube_resume_countdown_action', 'filetube_resume_countdown_seconds'];

function realm(store) {
  const dom = new JSDOM(HTML, { url: 'http://localhost/setup.html' });
  const w = dom.window;
  for (const [k, v] of Object.entries(store || {})) w.localStorage.setItem(k, v);
  const $ = (id) => w.document.getElementById(id);
  return { w, $ };
}
const change = (w, el) => el.dispatchEvent(new w.Event('change', { bubbles: true }));

test('markup: a mode select (auto / ask) and the three countdown controls inside ONE hidden-by-default container', () => {
  const { w, $ } = realm();
  try {
    const opts = [...$('resume-mode-select').options].map((o) => [o.value, o.textContent]);
    assert.deepStrictEqual(opts, [['auto', 'Resume automatically'], ['ask', 'Ask me']]);
    const box = $('resume-ask-controls');
    assert.strictEqual(box.hidden, true, 'hidden in the markup (Auto is the default)');
    for (const id of ['resume-countdown-check', 'resume-countdown-seconds-input', 'resume-countdown-action-select']) assert.ok(box.contains($(id)), id + ' lives in the Ask-only box');
    assert.ok(!box.contains($('resume-mode-select')) && !box.contains($('resume-threshold-input')), 'the mode and the threshold are always visible');
    assert.match($('resume-threshold-input').closest('.ui-field').querySelector('.ui-field__help').textContent, /Resumed at[\s\S]*Resume playback\?/, 'the threshold copy covers both modes');
  } finally { w.close(); }
});

test('reflect on load: nothing stored = Auto, countdown on, 5 s, resume; stored values show; the Ask box follows the mode', () => {
  let r = realm();
  try {
    setup.loadResumeModeControls(r.w);
    assert.strictEqual(r.$('resume-mode-select').value, 'auto');
    assert.strictEqual(r.$('resume-countdown-check').checked, true);
    assert.strictEqual(r.$('resume-countdown-seconds-input').value, '5');
    assert.strictEqual(r.$('resume-countdown-action-select').value, 'resume');
    assert.strictEqual(r.$('resume-ask-controls').hidden, true);
  } finally { r.w.close(); }
  r = realm({ filetube_resume_mode: 'ask', filetube_resume_countdown: '0', filetube_resume_countdown_seconds: '0', filetube_resume_countdown_action: 'beginning' });
  try {
    setup.loadResumeModeControls(r.w);
    assert.strictEqual(r.$('resume-mode-select').value, 'ask');
    assert.strictEqual(r.$('resume-countdown-check').checked, false);
    assert.strictEqual(r.$('resume-countdown-seconds-input').value, '0', 'a stored 0 shows as 0, not the default');
    assert.strictEqual(r.$('resume-countdown-action-select').value, 'beginning');
    assert.strictEqual(r.$('resume-ask-controls').hidden, false);
  } finally { r.w.close(); }
  r = realm({ filetube_resume_mode: 'garbage', filetube_resume_countdown_seconds: 'x' });
  try {
    setup.loadResumeModeControls(r.w);
    assert.strictEqual(r.$('resume-mode-select').value, 'auto', 'only the literal ask is Ask');
    assert.strictEqual(r.$('resume-countdown-seconds-input').value, '5');
  } finally { r.w.close(); }
});

test('write on change: the mode stores ask / auto and reveals / hides the Ask box (both axes); the switch stores 0 only when off; the action and the clamped seconds store', () => {
  const { w, $ } = realm();
  try {
    setup.loadResumeModeControls(w);
    setup.wireResumeModeControls(w);
    const mode = $('resume-mode-select');
    mode.value = 'ask'; change(w, mode);
    assert.strictEqual(w.localStorage.getItem('filetube_resume_mode'), 'ask');
    assert.strictEqual($('resume-ask-controls').hidden, false, 'revealed on Ask');
    mode.value = 'auto'; change(w, mode);
    assert.strictEqual(w.localStorage.getItem('filetube_resume_mode'), 'auto');
    assert.strictEqual($('resume-ask-controls').hidden, true, 'hidden again on Auto');
    const check = $('resume-countdown-check');
    check.checked = false; change(w, check);
    assert.strictEqual(w.localStorage.getItem('filetube_resume_countdown'), '0');
    check.checked = true; change(w, check);
    assert.strictEqual(w.localStorage.getItem('filetube_resume_countdown'), null, 'on = the key removed (absent = on)');
    const action = $('resume-countdown-action-select');
    action.value = 'beginning'; change(w, action);
    assert.strictEqual(w.localStorage.getItem('filetube_resume_countdown_action'), 'beginning');
    const secs = $('resume-countdown-seconds-input');
    for (const [typed, stored, shown] of [['12', '12', '12'], ['99', '30', '30'], ['-3', '0', '0'], ['0', '0', '0'], ['', null, '5'], ['abc', null, '5']]) {
      secs.value = typed; change(w, secs);
      assert.strictEqual(w.localStorage.getItem('filetube_resume_countdown_seconds'), stored, 'typed ' + JSON.stringify(typed));
      assert.strictEqual(secs.value, shown, 'reflected back for ' + JSON.stringify(typed));
    }
  } finally { w.close(); }
});

test('clampResumeSeconds (setup, on write) and resolveResumeCountdownSeconds (player, on read) agree on every non-blank input', () => {
  for (const raw of ['0', '1', '5', '29', '30', '31', '999', '-1', '-99', '7.9', '12abc', ' 8 ', '1e1']) {
    const written = setup.clampResumeSeconds(raw);
    assert.strictEqual(written, player.resolveResumeCountdownSeconds(raw), JSON.stringify(raw));
  }
  for (const blank of [null, undefined, '', '   ', 'abc']) {
    assert.strictEqual(setup.clampResumeSeconds(blank), null, 'blank / garbage is "cleared", never a number: ' + JSON.stringify(blank));
    assert.strictEqual(player.resolveResumeCountdownSeconds(blank), 5, 'the player falls back to the default');
  }
});

test('the four keys are byte-identical between setup.js and player.js, device-local (never in server.js), and init + wireStaticControls reach the new controls', () => {
  const setupSrc = read('public/js/setup.js');
  const playerSrc = read('public/js/player.js');
  const serverSrc = read('server.js');
  const pairs = [['RESUME_MODE_KEY', 'RESUME_MODE_STORAGE_KEY'], ['RESUME_COUNTDOWN_KEY', 'RESUME_COUNTDOWN_STORAGE_KEY'],
    ['RESUME_COUNTDOWN_ACTION_KEY', 'RESUME_COUNTDOWN_ACTION_STORAGE_KEY'], ['RESUME_COUNTDOWN_SECONDS_KEY', 'RESUME_COUNTDOWN_SECONDS_STORAGE_KEY']];
  pairs.forEach(([sName, pName], i) => {
    const sm = new RegExp('const ' + sName + " = '([^']+)';").exec(setupSrc);
    const pm = new RegExp('var ' + pName + " = '([^']+)';").exec(playerSrc);
    assert.ok(sm && pm, sName + ' / ' + pName + ' declared');
    assert.strictEqual(sm[1], pm[1], sName + ' matches ' + pName);
    assert.strictEqual(sm[1], KEYS[i]);
    assert.ok(!serverSrc.includes(KEYS[i]), KEYS[i] + ' is device-local: server.js never names it');
  });
  const code = setupSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.match(/\nfunction wireStaticControls\(signal\) \{([\s\S]*?)\n\}/.exec(code)[1], /\n\s*wireResumeModeControls\(window, signal\);/, 'wireStaticControls wires it');
  assert.match(code, /\n\s*loadResumeModeControls\(window\);/, 'init prefills it');
});
