'use strict';

// [UNIT] v1.44 T8 — the music SMART-RESUME rule (player.js shouldResumeMidTrack).
// A song restarts from the top; a LONG track (>10 min: mix/DJ set/long-form)
// resumes mid-track like a video. Pure helper, table-driven, exported from
// player.js for node:test (no DOM).

const { test } = require('node:test');
const assert = require('node:assert');
const { shouldResumeMidTrack } = require('../../public/js/player.js');

test('T8: a short song (< 10 min) restarts from the top', () => {
  assert.equal(shouldResumeMidTrack({ durationSeconds: 0 }), false);
  assert.equal(shouldResumeMidTrack({ durationSeconds: 180 }), false, '3-min song');
  assert.equal(shouldResumeMidTrack({ durationSeconds: 599 }), false, '9:59 -> restart');
});

test('T8: exactly 10:00 restarts (threshold is strict >)', () => {
  assert.equal(shouldResumeMidTrack({ durationSeconds: 600 }), false);
});

test('T8: a long track (> 10 min) resumes mid-track', () => {
  assert.equal(shouldResumeMidTrack({ durationSeconds: 601 }), true, '10:01 -> resume');
  assert.equal(shouldResumeMidTrack({ durationSeconds: 3600 }), true, '60-min mix -> resume');
});

test('T8: a missing/NaN/negative duration restarts (safe default: treat as a song)', () => {
  assert.equal(shouldResumeMidTrack({}), false);
  assert.equal(shouldResumeMidTrack({ durationSeconds: NaN }), false);
  assert.equal(shouldResumeMidTrack({ durationSeconds: -5 }), false);
  assert.equal(shouldResumeMidTrack(null), false);
  assert.equal(shouldResumeMidTrack(), false);
});

test('T8: a custom threshold overrides the 10-min default', () => {
  assert.equal(shouldResumeMidTrack({ durationSeconds: 200, thresholdSeconds: 120 }), true, '3:20 track, 2-min threshold');
  assert.equal(shouldResumeMidTrack({ durationSeconds: 100, thresholdSeconds: 120 }), false);
  // A non-positive/garbage threshold falls back to the 600s default.
  assert.equal(shouldResumeMidTrack({ durationSeconds: 700, thresholdSeconds: 0 }), true);
  assert.equal(shouldResumeMidTrack({ durationSeconds: 700, thresholdSeconds: 'x' }), true);
});
