'use strict';

// [UNIT] v1.110 (Dean): the "Share video vs Share at current time" prompt.
// - showChoiceModal (common.js): tested in overlays-dialogs-s9.test.js since sweep S9
//   (a ui.menu: XSS-safe textContent labels/title, one row per choice, one pick).
// - player.getCurrentTime + watch.js handleShareClick wiring: source-locked
//   (no player-boot jsdom harness in this repo -- CONTRIBUTING.md).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

// Sweep S9 (AC12): showChoiceModal is a ui.menu now; its tests (textContent title and
// labels, one row per choice, one pick run synchronously inside the tap, Close / Esc / the
// scrim settle with no pick) moved to test/unit/overlays-dialogs-s9.test.js.

// ---- source-locks: player.getCurrentTime + watch.js prompt wiring -----------
test('v1.110 source-lock: player.getCurrentTime is VOD-only (null for live), and watch prompts only >= 1s', () => {
  const playerSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'player.js'), 'utf8');
  const getT = playerSrc.slice(playerSrc.indexOf('getCurrentTime: function ()'), playerSrc.indexOf('getCurrentTime: function ()') + 300);
  assert.match(getT, /if \(!currentId \|\| !mediaPlayer \|\| liveMode\) return null;/, 'null when nothing loaded or live');
  assert.match(getT, /return \(typeof t === 'number' && isFinite\(t\)\) \? t : null;/, 'returns the finite currentTime else null');

  const watchSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'watch.js'), 'utf8');
  const fn = watchSrc.slice(watchSrc.indexOf('function handleShareClick()'), watchSrc.indexOf('function handleShareClick()') + 1200);
  assert.match(fn, /player\.getCurrentTime\(\)/, 'reads the live position from the player');
  // v1.337: the prompt is YouTube's `?t=` - a non-YouTube download's own link is shared as it is.
  assert.match(fn, /const isYouTube = base === mediaData\.watchUrl;/, 'the time choice is keyed on the YouTube link');
  assert.match(fn, /if \(isYouTube && typeof t === 'number' && isFinite\(t\) && t >= 1\) \{/, 'prompts only for a meaningful position (>= 1s), YouTube only');
  // UI pass sweep S3: the choice is a ui.menu anchored to Share (was the choice modal)
  assert.match(fn, /ui\.menu\(\{/, 'the choice is a ui.menu');
  assert.match(fn, /label: 'Share video', value: 'video'/, 'a plain-link choice');
  assert.match(fn, /onSelect: \(v\) => runShare\(v === 'at' \? withShareStartTime\(base, t\) : base\)/, 'a share-at-current-time choice with ?t=, else the plain link');
  assert.match(fn, /runShare\(base\);/, 'falls back to the plain share under 1s / null');
});
