'use strict';

// [UNIT] FR-4 (T1, v1.22.1): the persistent playback-speed cycle button
// (`#speed-btn`) is added to `#player-controls` inside
// `#player-host-template` -- a template block that must stay byte-identical
// across all four shells (public/index.html, public/setup.html,
// public/watch.html, lib/ytdlp/views/subscriptions.html), mirroring the
// shell-parity posture of test/unit/player-pip-parity.test.js (the
// #pip-btn precedent this new control follows). The actual cycle/persist
// feel is covered by the pure `nextPlaybackRate` helper's own tests
// (test/unit/player-controls.test.js) and Dean's on-device pass across eras/
// themes (light single-QA gate, per the exec plan) -- not repeated here.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SHELLS = [
  path.join(ROOT, 'public', 'index.html'),
  path.join(ROOT, 'public', 'setup.html'),
  path.join(ROOT, 'public', 'watch.html'),
  path.join(ROOT, 'lib', 'ytdlp', 'views', 'subscriptions.html'),
];

const SPEED_BTN_MARKUP = '<button type="button" id="speed-btn" class="pc-btn speed-btn" aria-label="Playback speed">1×</button>';

test('speed-btn parity: every shell\'s #player-host-template carries the exact same #speed-btn markup', () => {
  for (const shellPath of SHELLS) {
    const html = fs.readFileSync(shellPath, 'utf8');
    assert.ok(html.includes(SPEED_BTN_MARKUP), `${shellPath} is missing the byte-identical #speed-btn markup`);
  }
});

test('speed-btn parity: #speed-btn is placed immediately BEFORE #fs-btn in #player-controls, in every shell', () => {
  const beforeFsBtn = /<button type="button" id="speed-btn"[^>]*>1×<\/button>\s*\n\s*<button type="button" id="fs-btn"/;
  for (const shellPath of SHELLS) {
    const html = fs.readFileSync(shellPath, 'utf8');
    assert.match(html, beforeFsBtn, `${shellPath} does not place #speed-btn immediately before #fs-btn`);
  }
});

test('speed-btn parity: exactly one #speed-btn per shell (no accidental duplication)', () => {
  for (const shellPath of SHELLS) {
    const html = fs.readFileSync(shellPath, 'utf8');
    const matches = html.match(/id="speed-btn"/g) || [];
    assert.strictEqual(matches.length, 1, `${shellPath} should have exactly one #speed-btn, found ${matches.length}`);
  }
});

// ---- v1.50.3 (Dean, item A): the speed PICKER (#speed-menu) ----------------
// The button now opens a picker instead of blind-cycling eight rates. The
// popup div must ride the SAME template in every shell that carries the
// player host (all seven, not just this file's original four -- the picker
// works wherever the docked player can expand).

const ALL_TEMPLATE_SHELLS = [
  path.join(ROOT, 'public', 'index.html'),
  path.join(ROOT, 'public', 'setup.html'),
  path.join(ROOT, 'public', 'watch.html'),
  path.join(ROOT, 'public', 'music.html'),
  path.join(ROOT, 'public', 'read.html'),
  path.join(ROOT, 'public', 'stats.html'),
  path.join(ROOT, 'lib', 'ytdlp', 'views', 'subscriptions.html'),
];
const SPEED_MENU_MARKUP = '<div id="speed-menu" class="chapters-menu speed-menu" hidden></div>';

test('speed-menu parity: every player-host shell carries the byte-identical #speed-menu popup', () => {
  for (const shellPath of ALL_TEMPLATE_SHELLS) {
    const html = fs.readFileSync(shellPath, 'utf8');
    assert.ok(html.includes(SPEED_MENU_MARKUP), `${shellPath} is missing the #speed-menu popup`);
  }
});

test('speed-menu wiring: the button toggles the picker, selection routes through applyPlaybackRate, and the shared close path covers it', () => {
  const playerJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  assert.match(playerJs, /function buildSpeedMenu\(\)/, 'the DOM builder exists');
  assert.match(playerJs, /buildSpeedMenuModel\(mediaPlayer \? mediaPlayer\.playbackRate : 1\)/, 'rows come from the pure model fed the LIVE rate');
  assert.match(playerJs, /applyPlaybackRate\(row\.rate\)/, 'selection routes through the ONE apply path the </> keys use');
  const closeChapters = /function closeChaptersMenu\(\) \{[\s\S]*?\n {4}\}/.exec(playerJs);
  assert.ok(closeChapters, 'expected closeChaptersMenu');
  assert.match(closeChapters[0], /closeSpeedMenu\(\)/, 'every lifecycle site that dismisses chapters dismisses the speed picker too');
  assert.match(playerJs, /closeSpeedMenuOnOutside/, 'the picker has its own outside-close (click+pointerdown)');
});
