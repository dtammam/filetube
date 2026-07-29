'use strict';

// [UNIT] FR-4 (T1, v1.22.1) / v1.50.3: the persistent playback-speed button
// (`#speed-btn`) is added to `#player-controls` inside
// `#player-host-template`, byte-identical across shells, mirroring the
// shell-parity posture of test/unit/player-pip-parity.test.js. Since
// v1.50.3 the button opens a PICKER (#speed-menu, parity-locked across all
// SEVEN player-host shells below); the picker's pure row model
// (`buildSpeedMenuModel`) is covered in test/unit/player-controls.test.js
// (the retired `nextPlaybackRate` cycle has a removal lock there), and
// Dean's on-device pass across eras/themes stays the visual arbiter.
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
  assert.match(closeChapters[0], /closeSpeedMenu\(\)/, 'every caller that dismisses chapters dismisses the speed picker too');
  assert.match(playerJs, /closeSpeedMenuOnOutside/, 'the picker has its own outside-close (click+pointerdown)');
  assert.match(playerJs, /addEventListener\('touchstart', closeSpeedMenuOnOutside/, 'gate S1: the iOS touchstart belt covers the speed picker too');
});

test('gate C1 lock: the picker is height-clamped on open and on resize (the v1.43.1 mobile-portrait clip class)', () => {
  const playerJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  const code = playerJs.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(code, /if \(opening\) clampBarMenuHeight\(speedMenu\)/, 'clamped AFTER unhiding on every open');
  assert.match(code, /addEventListener\('resize', function \(\) \{ clampBarMenuHeight\(speedMenu\); \}\)/, 'rotation/viewport changes re-clamp while open');
  assert.match(code, /function clampChaptersMenuHeight\(\) \{ clampBarMenuHeight\(chaptersMenu\); \}/, 'chapters routes through the SAME shared clamp -- one measurement function, two popups');
});

test('gate W1 lock: dock() inlines the stale-open dismissal for BOTH bar popups (Back-button dock has no click for the outside-close)', () => {
  const playerJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  const code = playerJs.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const dockStart = code.indexOf('function dock()');
  assert.notEqual(dockStart, -1, 'expected dock()');
  const dockBody = code.slice(dockStart, code.indexOf('\n  function ', dockStart + 10));
  assert.match(dockBody, /chaptersMenu\.hidden = true/);
  assert.match(dockBody, /speedMenu\.hidden = true/, 'the speed picker must not survive a popstate dock invisibly open');
  assert.match(dockBody, /speedBtn\.setAttribute\('aria-expanded', 'false'\)/);
});
