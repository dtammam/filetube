'use strict';

// [UNIT] v1.44.2 (Music "Spotify feel") — SOURCE-LOCKs for the player.js
// play->dock entry path. This codebase has NO jsdom/browser harness, so the
// DOM reparent/mount machinery itself is validated on-device (Dean's pass);
// these locks pin the CONTRACT the /music view depends on so a refactor can't
// silently revert it (the music-view.test.js SOURCE-LOCK posture).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PLAYER_JS = fs.readFileSync(path.join(__dirname, '../../public/js/player.js'), 'utf8');

test('load() branches on options.dock for BOTH the adopt and the fresh path (v1.138: via the pure mount decision)', () => {
  // v1.138 respell: both seams now consult resolveLoadMountTarget - the
  // dock:true contract survives via the pure table (un-staged + dock ->
  // 'dock'), bound behaviorally here and in player-fullscreen-stage.test.js.
  const { resolveLoadMountTarget } = require('../../public/js/player.js');
  assert.strictEqual(resolveLoadMountTarget(false, true), 'dock', 'a fresh load with {dock:true} must mount into the dock');
  assert.strictEqual(resolveLoadMountTarget(false, false), 'slot');
  // The fresh-load branch mounts by the decision.
  assert.match(PLAYER_JS, /else if \(mountTarget === 'dock'\) mountInDock\(\);\s*\n\s*else mountInSlot\(options\.slot\);/,
    'the fresh seam maps dock->mountInDock, slot->mountInSlot');
  // The adopt (re-tap same track) branch docks instead of expanding FULL.
  assert.match(PLAYER_JS, /else if \(adoptTarget === 'dock'\) dock\(\);\s*\n\s*else expand\(options\.slot\);/,
    'the adopt seam maps dock->dock, slot->expand');
});

test('mountInDock() reparents the host into #player-dock and lands DOCKED', () => {
  const body = PLAYER_JS.slice(PLAYER_JS.indexOf('function mountInDock'));
  assert.match(body, /getElementById\('player-dock'\)/, 'mountInDock targets #player-dock');
  assert.match(body, /if \(!host \|\| !dockEl\) return;/, 'mountInDock no-ops without a host or dock element');
  assert.match(body, /state = STATE_DOCKED;/, 'mountInDock lands in the DOCKED state');
  // wasPlaying->play() recovery, mirroring the other reparent sites (iOS).
  assert.match(body.slice(0, body.indexOf('function', 5)), /wasPlaying && mediaPlayer\.paused/,
    'mountInDock recovers playback after the reparent');
});

test('the docked-tap return href falls back through readerHref (music sets it to /music)', () => {
  // Guards the latent bug: a music track id must NOT reach /watch.html?v= (a
  // video route -> 404). readerHref is the generic dock-return href.
  assert.match(PLAYER_JS, /currentData\.readerHref === 'string' && currentData\.readerHref/,
    'the dock click prefers currentData.readerHref before the /watch.html fallback');
});
