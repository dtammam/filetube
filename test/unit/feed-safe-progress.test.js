'use strict';

// [UNIT] v1.379.0 Feed mode, plan D5: the forward-only / never-over-another-device
// rule (lib/feed/safe-progress.js) and the served-position registry
// (lib/feed/served.js). Each refusal reason is bound by an input ONLY it refuses
// (LESSONS 2: redundant guards mask each other), and the registry's three verdicts
// are driven from a POPULATED state (a 'stale' read on an empty registry is 'unknown',
// never a vacuous pass).

const { test } = require('node:test');
const assert = require('node:assert');

const safe = require('../../lib/feed/safe-progress');
const { createServedRegistry } = require('../../lib/feed/served');

const P = (spineIndex, blockIndex) => ({ spineIndex, blockIndex });

test('compareBookPosition orders by spine first, then block', () => {
  assert.strictEqual(safe.compareBookPosition(P(0, 9), P(1, 0)), -1);
  assert.strictEqual(safe.compareBookPosition(P(1, 0), P(0, 9)), 1);
  assert.strictEqual(safe.compareBookPosition(P(2, 3), P(2, 4)), -1);
  assert.strictEqual(safe.compareBookPosition(P(2, 4), P(2, 3)), 1);
  assert.strictEqual(safe.compareBookPosition(P(2, 4), P(2, 4)), 0);
});

test('decideBookMove: forward from a served, unchanged record is the ONLY accepted shape', () => {
  const ok = safe.decideBookMove({ stored: P(1, 4), next: P(1, 5), served: 'ok', storedExists: true });
  assert.deepStrictEqual(ok, { ok: true, reason: 'ok' });
  // Across a chapter boundary is forward too.
  assert.strictEqual(safe.decideBookMove({ stored: P(1, 40), next: P(2, 0), served: 'ok', storedExists: true }).ok, true);
  // An unstarted book (no stored record) accepts any position.
  assert.strictEqual(safe.decideBookMove({ stored: null, next: P(0, 3), served: 'ok', storedExists: false }).ok, true);
});

test('decideBookMove refuses each wrong input for ITS reason (one axis varied per case)', () => {
  const base = { stored: P(1, 4), next: P(1, 5), served: 'ok', storedExists: true };
  // backward and equal are both "not forward"
  assert.deepStrictEqual(safe.decideBookMove({ ...base, next: P(1, 3) }), { ok: false, reason: 'backward' });
  assert.deepStrictEqual(safe.decideBookMove({ ...base, next: P(1, 4) }), { ok: false, reason: 'backward' });
  assert.deepStrictEqual(safe.decideBookMove({ ...base, next: P(0, 99) }), { ok: false, reason: 'backward' });
  // another device moved the record after the card was served
  assert.deepStrictEqual(safe.decideBookMove({ ...base, served: 'stale' }), { ok: false, reason: 'stale' });
  // no card was served (or the server restarted)
  assert.deepStrictEqual(safe.decideBookMove({ ...base, served: 'unknown' }), { ok: false, reason: 'not-served' });
  // a stored record whose locator resolves to no coordinates: never compared, never overwritten
  assert.deepStrictEqual(safe.decideBookMove({ ...base, stored: null }), { ok: false, reason: 'unresolved' });
  // a malformed target
  assert.deepStrictEqual(safe.decideBookMove({ ...base, next: { spineIndex: 1 } }), { ok: false, reason: 'invalid' });
  assert.deepStrictEqual(safe.decideBookMove({ ...base, next: P(-1, 0) }), { ok: false, reason: 'invalid' });
  assert.deepStrictEqual(safe.decideBookMove({ ...base, next: P(1, 1.5) }), { ok: false, reason: 'invalid' });
});

test('decideBookMove: stale outranks backward and invalid outranks stale (a refusal names the first wrong thing)', () => {
  assert.strictEqual(safe.decideBookMove({ stored: P(1, 4), next: P(1, 3), served: 'stale', storedExists: true }).reason, 'stale');
  assert.strictEqual(safe.decideBookMove({ stored: P(1, 4), next: null, served: 'stale', storedExists: true }).reason, 'invalid');
});

test('decideTimeMove: strictly later from a served, unchanged record; equal or earlier is backward', () => {
  assert.deepStrictEqual(safe.decideTimeMove({ storedSec: 120, nextSec: 124, served: 'ok' }), { ok: true, reason: 'ok' });
  assert.deepStrictEqual(safe.decideTimeMove({ storedSec: 0, nextSec: 4, served: 'ok' }), { ok: true, reason: 'ok' });
  assert.deepStrictEqual(safe.decideTimeMove({ storedSec: null, nextSec: 4, served: 'ok' }), { ok: true, reason: 'ok' });
  assert.deepStrictEqual(safe.decideTimeMove({ storedSec: 120, nextSec: 120, served: 'ok' }), { ok: false, reason: 'backward' });
  assert.deepStrictEqual(safe.decideTimeMove({ storedSec: 120, nextSec: 60, served: 'ok' }), { ok: false, reason: 'backward' });
  assert.deepStrictEqual(safe.decideTimeMove({ storedSec: 120, nextSec: 124, served: 'stale' }), { ok: false, reason: 'stale' });
  assert.deepStrictEqual(safe.decideTimeMove({ storedSec: 120, nextSec: 124, served: 'unknown' }), { ok: false, reason: 'not-served' });
  assert.deepStrictEqual(safe.decideTimeMove({ storedSec: 120, nextSec: -1, served: 'ok' }), { ok: false, reason: 'invalid' });
  assert.deepStrictEqual(safe.decideTimeMove({ storedSec: 120, nextSec: NaN, served: 'ok' }), { ok: false, reason: 'invalid' });
  assert.deepStrictEqual(safe.decideTimeMove({ storedSec: 120, nextSec: '125', served: 'ok' }), { ok: false, reason: 'invalid' });
});

test('statusForReason: a conflict with storage is 409, a malformed request 400', () => {
  assert.strictEqual(safe.statusForReason('backward'), 409);
  assert.strictEqual(safe.statusForReason('stale'), 409);
  assert.strictEqual(safe.statusForReason('not-served'), 409);
  assert.strictEqual(safe.statusForReason('unresolved'), 409);
  assert.strictEqual(safe.statusForReason('invalid'), 400);
});

// ---- the served registry ----------------------------------------------------------

test('served registry: unknown until marked, ok while the stamp matches, stale once it differs, ok again after advance', () => {
  let t = 1000;
  const reg = createServedRegistry({ now: () => t });
  assert.strictEqual(reg.status(7, 'book', 'b1', '2026-10-09T10:00:00.000Z'), 'unknown');
  reg.mark(7, 'book', 'b1', '2026-10-09T10:00:00.000Z');
  assert.strictEqual(reg.status(7, 'book', 'b1', '2026-10-09T10:00:00.000Z'), 'ok');
  // another device wrote: the stored stamp is newer than the served one
  assert.strictEqual(reg.status(7, 'book', 'b1', '2026-10-09T10:05:00.000Z'), 'stale');
  // the feed's own write continues the chain
  reg.advance(7, 'book', 'b1', '2026-10-09T10:05:00.000Z');
  assert.strictEqual(reg.status(7, 'book', 'b1', '2026-10-09T10:05:00.000Z'), 'ok');
  assert.strictEqual(reg.status(7, 'book', 'b1', '2026-10-09T10:00:00.000Z'), 'stale');
  // keyed per user AND kind AND id
  assert.strictEqual(reg.status(8, 'book', 'b1', '2026-10-09T10:05:00.000Z'), 'unknown');
  assert.strictEqual(reg.status(7, 'media', 'b1', '2026-10-09T10:05:00.000Z'), 'unknown');
  assert.strictEqual(reg.status(7, 'book', 'b2', '2026-10-09T10:05:00.000Z'), 'unknown');
  reg.forget(7, 'book', 'b1');
  assert.strictEqual(reg.status(7, 'book', 'b1', '2026-10-09T10:05:00.000Z'), 'unknown');
});

test('served registry: an unstarted item (no record) is served as the empty stamp and matches an absent stored stamp only', () => {
  const reg = createServedRegistry({ now: () => 1 });
  reg.mark(1, 'podcast', 'e1', '');
  assert.strictEqual(reg.status(1, 'podcast', 'e1', undefined), 'ok');
  assert.strictEqual(reg.status(1, 'podcast', 'e1', null), 'ok');
  assert.strictEqual(reg.status(1, 'podcast', 'e1', '2026-10-09T10:00:00.000Z'), 'stale');
});

test('served registry: entries age out (TTL) and the oldest are evicted past the cap', () => {
  let t = 0;
  const reg = createServedRegistry({ now: () => t, ttlMs: 1000, maxEntries: 3 });
  reg.mark(1, 'book', 'a', 'x');
  t = 999;
  assert.strictEqual(reg.status(1, 'book', 'a', 'x'), 'ok');
  t = 1001;
  assert.strictEqual(reg.status(1, 'book', 'a', 'x'), 'unknown', 'aged out');
  t = 2000;
  reg.mark(1, 'book', 'a', 'x');
  reg.mark(1, 'book', 'b', 'x');
  reg.mark(1, 'book', 'c', 'x');
  reg.mark(1, 'book', 'd', 'x');
  assert.strictEqual(reg.size(), 3);
  assert.strictEqual(reg.status(1, 'book', 'a', 'x'), 'unknown', 'the oldest was evicted');
  assert.strictEqual(reg.status(1, 'book', 'd', 'x'), 'ok');
  // a re-mark refreshes recency: 'b' survives the next eviction, 'c' goes
  reg.mark(1, 'book', 'b', 'x');
  reg.mark(1, 'book', 'e', 'x');
  assert.strictEqual(reg.status(1, 'book', 'c', 'x'), 'unknown');
  assert.strictEqual(reg.status(1, 'book', 'b', 'x'), 'ok');
});
