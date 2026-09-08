'use strict';

// [UNIT] (Dean) the all-views player height cap. The shared 16:9 player host
// overflows a wide monitor in EVERY view (watch/music/podcasts/shows), not just
// watch - because a fixed height budget only works where the player sits near the
// top. The fix MEASURES the real space below the player (player.js) into
// `--player-cap-h`, which one CSS rule reads. These bind the pure core (arithmetic
// + the "should this player be capped?" decision) and source-lock the DOM/wiring
// shell; the visual FEEL on a wide monitor is Dean's device arbiter.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { computePlayerCapHeight, shouldCapPlayerHeight } = require('../../public/js/player.js');
const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');

// ---- computePlayerCapHeight: viewport - top - reserve, never negative ----------

test('computePlayerCapHeight = round(innerHeight - slotTop - reserve), floored at 0', () => {
  assert.strictEqual(computePlayerCapHeight(1080, 200, 42), 838);   // 1080-200-42
  assert.strictEqual(computePlayerCapHeight(1440, 300, 42), 1098);
  assert.strictEqual(computePlayerCapHeight(1000.6, 100, 42), 859); // rounds
});

test('computePlayerCapHeight never returns negative (a player pushed below the fold -> 0, not a negative width)', () => {
  assert.strictEqual(computePlayerCapHeight(600, 700, 42), 0);
  assert.strictEqual(computePlayerCapHeight(0, 0, 42), 0);
});

test('computePlayerCapHeight coerces junk to 0 rather than NaN (a bad measurement never yields NaN width)', () => {
  assert.strictEqual(computePlayerCapHeight(undefined, 200, 42), 0);
  assert.strictEqual(computePlayerCapHeight('nope', 'x', null), 0);
});

// ---- shouldCapPlayerHeight: only the FULL, in-#player-slot, video-ish player -----

test('shouldCapPlayerHeight is true ONLY for the FULL, real #player-slot, non-reader, non-fullscreen, non-audio-expanded player', () => {
  const base = { isFull: true, slotId: 'player-slot', slotIsReader: false, audioExpanded: false, cssFullscreen: false };
  assert.strictEqual(shouldCapPlayerHeight(base), true);
  assert.strictEqual(shouldCapPlayerHeight({ ...base, isFull: false }), false, 'not FULL (docked/closed) -> no cap');
  assert.strictEqual(shouldCapPlayerHeight({ ...base, slotId: 'player-dock' }), false, 'docked host -> no cap');
  assert.strictEqual(shouldCapPlayerHeight({ ...base, slotId: 'fs-stage' }), false, 'fullscreen stage -> no cap');
  assert.strictEqual(shouldCapPlayerHeight({ ...base, slotIsReader: true }), false, 'reader compact bar -> no cap (owns its size)');
  assert.strictEqual(shouldCapPlayerHeight({ ...base, audioExpanded: true }), false, 'audio-expanded overlay -> no cap');
  assert.strictEqual(shouldCapPlayerHeight({ ...base, cssFullscreen: true }), false, 'css-fullscreen -> no cap');
  assert.strictEqual(shouldCapPlayerHeight(undefined), false, 'no input -> no cap');
});

// ---- the DOM measure + wiring (browser-only shell; source-locked) --------------

test('refreshPlayerHeightCap uses BOTH pure helpers and writes the measured --player-cap-h', () => {
  const m = /function refreshPlayerHeightCap\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(m, 'refreshPlayerHeightCap() exists');
  const body = m[1];
  assert.match(body, /shouldCapPlayerHeight\(/, 'guards on the pure should-cap decision');
  assert.match(body, /computePlayerCapHeight\(window\.innerHeight,\s*top,\s*42\)/, 'measures innerHeight - slotTop - 42 (40px bar + 2px border)');
  assert.match(body, /setProperty\('--player-cap-h',\s*capH \+ 'px'\)/, 'writes the measured cap into --player-cap-h');
  assert.match(body, /getBoundingClientRect\(\)\.top/, 'the top offset is MEASURED, not assumed');
});

test('the cap is refreshed on mount (mountInSlot) and on viewport change (resize + orientationchange), rAF-coalesced', () => {
  const mount = /function mountInSlot\([\s\S]*?\n {2}\}/.exec(PLAYER_JS);
  assert.ok(mount && /scheduleCapRefresh\(\)/.test(mount[0]), 'mountInSlot() schedules a cap refresh (the wide-monitor case: opening a video)');
  assert.match(PLAYER_JS, /window\.addEventListener\('resize', scheduleCapRefresh\)/, 'resize re-measures');
  assert.match(PLAYER_JS, /window\.addEventListener\('orientationchange', scheduleCapRefresh\)/, 'orientationchange re-measures');
  const sched = /function scheduleCapRefresh\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.ok(sched, 'scheduleCapRefresh() exists');
  assert.match(sched[1], /capRefreshPending/, 'coalesced (one pending flag)');
  assert.match(sched[1], /requestAnimationFrame\(/, 'measured after a rAF so layout has settled');
});
