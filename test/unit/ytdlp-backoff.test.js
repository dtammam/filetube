'use strict';

// [UNIT] v1.36 F2: the per-channel check-failure backoff pair
// (computeCheckBackoff / isInCheckBackoff) -- pure logic, no fs/env/server
// import needed (same posture as ytdlp-config.test.js). The integration
// behavior (runPoll actually skipping a cooling channel, the explicit-repull
// bypass, the persisted fields) lives in
// test/integration/ytdlp-check-backoff.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const { computeCheckBackoff, isInCheckBackoff } = require('../../lib/ytdlp');

const NOW = Date.parse('2026-07-12T12:00:00.000Z');
const MIN = 60 * 1000;

// ---- computeCheckBackoff: the exponential schedule --------------------------

test('v1.36 F2: first failure -> checkFailures 1 + a 30-minute backoff window', () => {
  const patch = computeCheckBackoff(undefined, 'error', NOW);
  assert.equal(patch.checkFailures, 1);
  assert.equal(Date.parse(patch.backoffUntil), NOW + 30 * MIN);
});

test('v1.36 F2: consecutive failures double the window (30m, 1h, 2h, 4h) and cap at 6h -- never unbounded', () => {
  const expectMinutes = [
    [1, 30], [2, 60], [3, 120], [4, 240],
    [5, 360], // 8h would exceed the cap -> clamped to 6h
    [6, 360], [50, 360], // stays clamped forever after
  ];
  for (const [prior, minutes] of expectMinutes) {
    const patch = computeCheckBackoff(prior - 1, 'error', NOW);
    assert.equal(patch.checkFailures, prior);
    assert.equal(Date.parse(patch.backoffUntil), NOW + minutes * MIN, `failure #${prior} must back off ${minutes}m`);
  }
});

test('v1.36 F2: a malformed/negative previous count is treated as 0 (first failure), never NaN math', () => {
  for (const bad of [undefined, null, -3, 1.5, 'seven', NaN, {}]) {
    const patch = computeCheckBackoff(bad, 'error', NOW);
    assert.equal(patch.checkFailures, 1, `prev=${String(bad)}`);
    assert.equal(Date.parse(patch.backoffUntil), NOW + 30 * MIN);
  }
});

test('v1.36 F2: success and partial both RESET -- checkFailures 0 and an explicit backoffUntil null (a persisted clear, not an omission)', () => {
  for (const outcome of ['success', 'partial']) {
    assert.deepEqual(computeCheckBackoff(4, outcome, NOW), { checkFailures: 0, backoffUntil: null });
  }
});

test("v1.36 F2: 'cancelled' (and any unknown outcome) neither counts nor resets -- an empty patch leaves the persisted fields untouched, mirroring the breaker's own counting rule", () => {
  for (const outcome of ['cancelled', undefined, 'weird-future-outcome']) {
    assert.deepEqual(computeCheckBackoff(3, outcome, NOW), {});
  }
});

// ---- isInCheckBackoff: the read-side gate -----------------------------------

test('v1.36 F2: isInCheckBackoff is true strictly inside the window, false at/after expiry', () => {
  const sub = { backoffUntil: new Date(NOW + 10 * MIN).toISOString() };
  assert.equal(isInCheckBackoff(sub, NOW), true);
  assert.equal(isInCheckBackoff(sub, NOW + 10 * MIN), false, 'the boundary instant is NOT in backoff (strict >)');
  assert.equal(isInCheckBackoff(sub, NOW + 11 * MIN), false);
});

test('v1.36 F2: isInCheckBackoff fails OPEN on missing/null/malformed backoffUntil -- a corrupted value degrades to "always eligible", never a permanently muted channel', () => {
  for (const bad of [undefined, null, '', 'not-a-date', 12345, {}]) {
    assert.equal(isInCheckBackoff({ backoffUntil: bad }, NOW), false, `backoffUntil=${JSON.stringify(bad)}`);
  }
  assert.equal(isInCheckBackoff(null, NOW), false);
  assert.equal(isInCheckBackoff(undefined, NOW), false);
});

// ---- the round trip: what a failure writes is what the gate reads -----------

test('v1.36 F2: round trip -- the patch a failure computes puts the sub in backoff NOW and out of backoff after the window', () => {
  const patch = computeCheckBackoff(0, 'error', NOW);
  const sub = { ...patch };
  assert.equal(isInCheckBackoff(sub, NOW), true);
  assert.equal(isInCheckBackoff(sub, NOW + 30 * MIN), false);
  const cleared = { ...sub, ...computeCheckBackoff(sub.checkFailures, 'success', NOW) };
  assert.equal(isInCheckBackoff(cleared, NOW), false, 'a success clear (backoffUntil null) must read as not-in-backoff');
});
