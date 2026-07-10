'use strict';

// [UNIT] A6 (T16, v1.24 UX Round, Wave 5): the ONE approved player-controls
// exception -- `<track kind="captions">` on the persistent host's
// `#media-player` + a `#cc-btn` toggle on `#player-controls`, mirroring the
// shell-parity posture of test/unit/player-pip-parity.test.js /
// test/unit/player-speed-btn-parity.test.js (the #pip-btn/#speed-btn
// precedent this new control follows).
//
// FIVE-SHELL PARITY (T16 completion follow-up, v1.24 UX Round): T16's own
// task card restricted file ownership to public/index.html + public/
// watch.html, but #player-host-template (with byte-identical #pip-btn/
// #speed-btn control markup) is ALSO duplicated in public/setup.html,
// public/stats.html, and lib/ytdlp/views/subscriptions.html. Because
// player.js's persistent host is cloned ONCE from whichever shell happens to
// be the current document at `ensureHost()` time (the SPA-lite router only
// swaps `#view-root`, never re-clones the host -- see player.js's own module
// comment), an app session that boots from setup.html/stats.html/
// subscriptions.html would otherwise get a persistent host with NO
// `<track>`/`#cc-btn` at all, for its entire session. The follow-up task
// closed that gap by adding the byte-identical markup to all three
// remaining shells; this file now asserts parity across all FIVE shells (the
// same class of gap that let a stale `.mobile-logo` survive on one shell --
// lock all five here).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SHELLS = [
  path.join(ROOT, 'public', 'index.html'),
  path.join(ROOT, 'public', 'watch.html'),
  path.join(ROOT, 'public', 'setup.html'),
  path.join(ROOT, 'public', 'stats.html'),
  path.join(ROOT, 'lib', 'ytdlp', 'views', 'subscriptions.html'),
];

const CC_TRACK_MARKUP = '<track id="cc-track" kind="captions" srclang="en" label="English">';
const CC_BTN_MARKUP = '<button type="button" id="cc-btn" class="pc-btn cc-btn" aria-label="Toggle captions" aria-pressed="false" style="display: none;">CC</button>';

test('cc-track parity: both owned shells\' #player-host-template carry the exact same <track id="cc-track"> markup, inside #media-player', () => {
  for (const shellPath of SHELLS) {
    const html = fs.readFileSync(shellPath, 'utf8');
    assert.ok(html.includes(CC_TRACK_MARKUP), `${shellPath} is missing the byte-identical #cc-track markup`);
    // Must be a child of #media-player, not floating elsewhere in the shell.
    const videoBlock = /<video id="media-player"[^>]*>([\s\S]*?)<\/video>/.exec(html);
    assert.ok(videoBlock, `${shellPath} is missing the #media-player <video> block`);
    assert.ok(videoBlock[1].includes(CC_TRACK_MARKUP), `${shellPath}'s <track id="cc-track"> must be INSIDE #media-player`);
  }
});

test('cc-btn parity: both owned shells\' #player-host-template carry the exact same #cc-btn markup', () => {
  for (const shellPath of SHELLS) {
    const html = fs.readFileSync(shellPath, 'utf8');
    assert.ok(html.includes(CC_BTN_MARKUP), `${shellPath} is missing the byte-identical #cc-btn markup`);
  }
});

test('cc-btn parity: #cc-btn is placed immediately after #pip-btn in #player-controls, in every owned shell', () => {
  const afterPipBtn = /id="pip-btn"[^>]*>⧉<\/button>\s*\n\s*<button type="button" id="cc-btn"/;
  for (const shellPath of SHELLS) {
    const html = fs.readFileSync(shellPath, 'utf8');
    assert.match(html, afterPipBtn, `${shellPath} does not place #cc-btn immediately after #pip-btn`);
  }
});

test('cc-btn parity: exactly one #cc-btn and one #cc-track per owned shell (no accidental duplication)', () => {
  for (const shellPath of SHELLS) {
    const html = fs.readFileSync(shellPath, 'utf8');
    assert.strictEqual((html.match(/id="cc-btn"/g) || []).length, 1, `${shellPath} should have exactly one #cc-btn`);
    assert.strictEqual((html.match(/id="cc-track"/g) || []).length, 1, `${shellPath} should have exactly one #cc-track`);
  }
});

test('cc-btn parity: #cc-btn starts hidden (style="display: none;") -- setupForMedia() in player.js is the only thing that ever reveals it, gated on hasSubtitles', () => {
  for (const shellPath of SHELLS) {
    const html = fs.readFileSync(shellPath, 'utf8');
    assert.match(html, /id="cc-btn"[^>]*style="display: none;"/, `${shellPath}'s #cc-btn must start hidden in markup`);
  }
});

test('this round\'s ONE approved player-controls exception did not otherwise touch #player-controls: every pre-existing control id is still present, unchanged, in both owned shells', () => {
  const PRE_EXISTING_IDS = ['pp-btn', 'time-cur', 'seek-bar', 'time-dur', 'mute-btn', 'vol-bar', 'speed-btn', 'fs-btn', 'pip-btn'];
  for (const shellPath of SHELLS) {
    const html = fs.readFileSync(shellPath, 'utf8');
    for (const id of PRE_EXISTING_IDS) {
      assert.ok(html.includes(`id="${id}"`), `${shellPath} is missing pre-existing control #${id} -- T16 must not remove/rename any existing control`);
    }
  }
});
