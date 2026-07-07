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
