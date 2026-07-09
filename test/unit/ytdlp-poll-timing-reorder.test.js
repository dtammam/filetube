'use strict';

// [UNIT] v1.24.0 T8 -- `lib/ytdlp/index.js`'s pure helpers backing A4
// (poll-timing estimate) and B4 (the `POST /api/subscriptions/reorder`
// request-shape validator). Both are pure, no-I/O functions, tested directly
// without booting an app -- the HTTP-level behavior (route wiring, status/
// settings field surfacing, disabled no-op) is covered separately in
// test/integration/ytdlp-reorder-poll-timing.test.js.

const { test } = require('node:test');
const assert = require('node:assert');

const { computeNextPollDue, validateReorderRequest } = require('../../lib/ytdlp');

// ---- computeNextPollDue (A4) ------------------------------------------------

test('computeNextPollDue returns lastCheckedMs + intervalMs for a normal, already-checked subscription', () => {
  const lastCheckedMs = Date.parse('2026-07-09T00:00:00.000Z');
  const intervalMs = 30 * 60 * 1000; // 30 minutes
  assert.equal(computeNextPollDue(lastCheckedMs, intervalMs), lastCheckedMs + intervalMs);
});

test('computeNextPollDue returns null when intervalMs === 0 (manual-only polling, no scheduled next check)', () => {
  const lastCheckedMs = Date.parse('2026-07-09T00:00:00.000Z');
  assert.equal(computeNextPollDue(lastCheckedMs, 0), null);
});

test('computeNextPollDue returns null for a never-checked subscription (lastCheckedMs is NaN, e.g. Date.parse(null))', () => {
  assert.equal(computeNextPollDue(Date.parse(null), 30 * 60 * 1000), null);
  assert.equal(computeNextPollDue(NaN, 30 * 60 * 1000), null);
});

test('computeNextPollDue is defensive against non-finite/negative/non-numeric intervalMs -- never throws, always null', () => {
  const lastCheckedMs = Date.now();
  assert.equal(computeNextPollDue(lastCheckedMs, -5), null);
  assert.equal(computeNextPollDue(lastCheckedMs, NaN), null);
  assert.equal(computeNextPollDue(lastCheckedMs, undefined), null);
  assert.equal(computeNextPollDue(lastCheckedMs, 'not-a-number'), null);
});

test('computeNextPollDue is defensive against non-numeric lastCheckedMs -- never throws, always null', () => {
  const intervalMs = 60 * 1000;
  assert.equal(computeNextPollDue(undefined, intervalMs), null);
  assert.equal(computeNextPollDue('not-a-number', intervalMs), null);
  assert.equal(computeNextPollDue(null, intervalMs), null);
});

// ---- validateReorderRequest (B4 request-shape validation) ------------------

test('validateReorderRequest accepts a well-formed array of non-empty string ids', () => {
  const result = validateReorderRequest({ orderedIds: ['a', 'b', 'c'] });
  assert.deepEqual(result, { ok: true, value: ['a', 'b', 'c'] });
});

test('validateReorderRequest accepts an empty array (a valid, if unusual, reorder request)', () => {
  const result = validateReorderRequest({ orderedIds: [] });
  assert.deepEqual(result, { ok: true, value: [] });
});

test('validateReorderRequest rejects a missing orderedIds field', () => {
  const result = validateReorderRequest({});
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('validateReorderRequest rejects a non-array orderedIds (string, object, number)', () => {
  assert.equal(validateReorderRequest({ orderedIds: 'a,b,c' }).ok, false);
  assert.equal(validateReorderRequest({ orderedIds: { 0: 'a' } }).ok, false);
  assert.equal(validateReorderRequest({ orderedIds: 42 }).ok, false);
});

test('validateReorderRequest rejects an array containing a non-string or empty-string element', () => {
  assert.equal(validateReorderRequest({ orderedIds: ['a', 42, 'c'] }).ok, false);
  assert.equal(validateReorderRequest({ orderedIds: ['a', '', 'c'] }).ok, false);
  assert.equal(validateReorderRequest({ orderedIds: ['a', '   ', 'c'] }).ok, false, 'whitespace-only id is treated as empty');
  assert.equal(validateReorderRequest({ orderedIds: [null] }).ok, false);
});

test('validateReorderRequest rejects a pathologically oversized array outright', () => {
  const hugeArray = new Array(5001).fill('id');
  const result = validateReorderRequest({ orderedIds: hugeArray });
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('validateReorderRequest never throws on a malformed/missing body (null, undefined, non-object)', () => {
  assert.doesNotThrow(() => validateReorderRequest(null));
  assert.doesNotThrow(() => validateReorderRequest(undefined));
  assert.doesNotThrow(() => validateReorderRequest('garbage'));
  assert.equal(validateReorderRequest(null).ok, false);
  assert.equal(validateReorderRequest(undefined).ok, false);
});
