'use strict';

// [UNIT] v1.387.0 offline playback, plan D4 - the newer-wins rule (lib/offline/routes.js newerWins), pure:
// an offline event lands only when its corrected moment is STRICTLY later than the stored position's
// updatedAt. Equal moments cannot be staged against a real clock through the route (each request's skew
// carries its own latency), so the W3 mutant round left `>` vs `>=` unbound; this binds it, with the
// oldest-possible readings of a missing row, a null stamp and an unparsable stamp.

const { test } = require('node:test');
const assert = require('node:assert');
const { newerWins, stampMs } = require('../../lib/offline/routes');

const T = Date.parse('2026-10-12T00:00:00.000Z');

test('strictly later wins; equal and earlier do not', () => {
  const stored = { updatedAt: new Date(T).toISOString() };
  assert.strictEqual(newerWins(T + 1, stored), true);
  assert.strictEqual(newerWins(T, stored), false, 'an equal moment is NOT newer (a replay changes nothing)');
  assert.strictEqual(newerWins(T - 1, stored), false);
});

test('a missing row, a null stamp and an unparsable stamp are the oldest possible: any finite moment wins', () => {
  for (const stored of [null, undefined, {}, { updatedAt: null }, { updatedAt: 'not a date' }, { updatedAt: 42 }]) {
    assert.strictEqual(newerWins(T - 10 * 365 * 24 * 3600 * 1000, stored), true, JSON.stringify(stored));
    assert.strictEqual(stampMs(stored), -Infinity, JSON.stringify(stored));
  }
});

test('a non-finite corrected moment never wins (a guard against NaN arithmetic upstream)', () => {
  assert.strictEqual(newerWins(NaN, null), false);
  assert.strictEqual(newerWins(Infinity, null), false);
  assert.strictEqual(newerWins(undefined, { updatedAt: 'x' }), false);
});

test('stampMs parses the stored ISO string to the moment it names', () => {
  assert.strictEqual(stampMs({ updatedAt: '2026-10-12T00:00:00.000Z' }), T);
  assert.strictEqual(stampMs({ updatedAt: '2026-10-12T00:00:00.001Z' }), T + 1);
});
