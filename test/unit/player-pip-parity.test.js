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
const SHELLS = [
  path.join(ROOT, 'public', 'index.html'),
  path.join(ROOT, 'public', 'setup.html'),
  path.join(ROOT, 'public', 'watch.html'),
  path.join(ROOT, 'lib', 'ytdlp', 'views', 'subscriptions.html'),
];

const PIP_BTN_MARKUP = '<button type="button" id="pip-btn" class="pc-btn pip-btn" aria-label="Picture in picture">⧉</button>';

test('pip-btn parity: every shell\'s #player-host-template carries the exact same #pip-btn markup', () => {
  for (const shellPath of SHELLS) {
    const html = fs.readFileSync(shellPath, 'utf8');
    assert.ok(html.includes(PIP_BTN_MARKUP), `${shellPath} is missing the byte-identical #pip-btn markup`);
  }
});

test('pip-btn parity: #pip-btn is placed immediately after #fs-btn in #player-controls, in every shell', () => {
  const afterFsBtn = /id="fs-btn"[^>]*>⛶<\/button>\s*\n\s*<button type="button" id="pip-btn"/;
  for (const shellPath of SHELLS) {
    const html = fs.readFileSync(shellPath, 'utf8');
    assert.match(html, afterFsBtn, `${shellPath} does not place #pip-btn immediately after #fs-btn`);
  }
});

test('pip-btn parity: exactly one #pip-btn per shell (no accidental duplication)', () => {
  for (const shellPath of SHELLS) {
    const html = fs.readFileSync(shellPath, 'utf8');
    const matches = html.match(/id="pip-btn"/g) || [];
    assert.strictEqual(matches.length, 1, `${shellPath} should have exactly one #pip-btn, found ${matches.length}`);
  }
});
