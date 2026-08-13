'use strict';

// [UNIT] FR-8(b) (TG, v1.22.0, AC58-AC61): the native Picture-in-Picture
// button (`#pip-btn`) is added to `#player-controls` inside
// `#player-host-template` -- a template block that must stay byte-identical
// across all four shells (public/index.html, public/setup.html,
// public/watch.html, lib/ytdlp/views/subscriptions.html), mirroring the
// shell-parity posture of test/unit/mobile-wordmark.test.js. The actual PiP
// feel (popping into a native OS window, persisting across tabs, restoring on
// return) is NOT covered here -- no jsdom/browser harness in this codebase
// (see CONTRIBUTING.md); Dean's on-device desktop-browser pass is the
// documented arbiter (AC61).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
// v1.112: widened to ALL NINE player-host shells (was a 4-shell subset).
const SHELLS = [
  path.join(ROOT, 'lib', 'ytdlp', 'views', 'subscriptions.html'),
  path.join(ROOT, 'public', 'history.html'),
  path.join(ROOT, 'public', 'index.html'),
  path.join(ROOT, 'public', 'music.html'),
  path.join(ROOT, 'public', 'podcasts.html'),
  path.join(ROOT, 'public', 'read.html'),
  path.join(ROOT, 'public', 'setup.html'),
  path.join(ROOT, 'public', 'stats.html'),
  path.join(ROOT, 'public', 'watch.html'),
];

// v1.112 (Dean, settings cog): #pip-btn moved OFF the bar into #settings-menu as
// the last menu row (class gains `settings-menu-item`). It keeps its own
// `document.pictureInPictureEnabled` gate (player.js hides it where unsupported),
// which now hides the ROW; the toggle handler is unchanged (id-keyed).
const PIP_BTN_MARKUP = '<button type="button" id="pip-btn" class="pc-btn settings-menu-item pip-btn" aria-label="Picture in picture">⧉</button>';

test('pip-btn parity: every shell\'s #player-host-template carries the exact same #pip-btn markup', () => {
  for (const shellPath of SHELLS) {
    const html = fs.readFileSync(shellPath, 'utf8');
    assert.ok(html.includes(PIP_BTN_MARKUP), `${shellPath} is missing the byte-identical #pip-btn markup`);
  }
});

test('pip-btn parity: v1.112 #pip-btn is the LAST row of #settings-menu, immediately after #cc-btn, then the menu closes', () => {
  const lastInSettings = /<button type="button" id="cc-btn"[^>]*>CC<\/button>\s*\n\s*<button type="button" id="pip-btn"[^>]*>⧉<\/button>\s*\n\s*<\/div>/;
  for (const shellPath of SHELLS) {
    const html = fs.readFileSync(shellPath, 'utf8');
    assert.match(html, lastInSettings, `${shellPath} does not place #pip-btn as the last #settings-menu row after #cc-btn`);
  }
});

test('pip-btn parity: exactly one #pip-btn per shell (no accidental duplication)', () => {
  for (const shellPath of SHELLS) {
    const html = fs.readFileSync(shellPath, 'utf8');
    const matches = html.match(/id="pip-btn"/g) || [];
    assert.strictEqual(matches.length, 1, `${shellPath} should have exactly one #pip-btn, found ${matches.length}`);
  }
});
