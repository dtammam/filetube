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

test('served registry: the session a card was served in is remembered, carried by advance, and kept by a session-less re-mark (gate r1 qa S5)', () => {
  const reg = createServedRegistry({ now: () => 1 });
  reg.mark(1, 'book', 'b', 't1', 'sess1');
  assert.strictEqual(reg.sessionOf(1, 'book', 'b'), 'sess1');
  reg.advance(1, 'book', 'b', 't2');
  assert.strictEqual(reg.sessionOf(1, 'book', 'b'), 'sess1', 'advance keeps the session');
  reg.mark(1, 'book', 'b', 't2');
  assert.strictEqual(reg.sessionOf(1, 'book', 'b'), 'sess1', 'a mark with no session keeps the live one');
  reg.mark(1, 'book', 'b', 't2', 'sess2');
  assert.strictEqual(reg.sessionOf(1, 'book', 'b'), 'sess2', 'a mark with a session replaces it');
  assert.strictEqual(reg.sessionOf(1, 'book', 'other'), null);
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

// ---- v1.382.0 (D6): a reel shorter than the minute counts once played whole; the minute stays the floor otherwise ------
test('v1.382.0 D6 freshNeedSec(duration, slice): the whole reel less the slack, never above the minute, a 10 s look never enough', () => {
  assert.strictEqual(safe.freshNeedSec(1200), 60, 'no slice: the shipped minute');
  assert.strictEqual(safe.freshNeedSec(1200, 60), 60 - safe.REEL_END_SLACK_SEC, 'a 60 s reel: 59 s');
  assert.strictEqual(safe.freshNeedSec(1200, 30), 29);
  assert.strictEqual(safe.freshNeedSec(1200, 90), 60, 'a 90 s reel: the minute comes first');
  assert.strictEqual(safe.freshNeedSec(45, 30), 29, 'a 45 s clip: 80% is 36, the 30 s reel 29');
  assert.strictEqual(safe.freshNeedSec(1200, 0), 60, '0 = unknown');
  assert.strictEqual(safe.freshNeedSec(1200, -5), 60);
  assert.strictEqual(safe.freshNeedSec(1200, 'x'), 60);
  assert.strictEqual(safe.freshNeedSec(1200, 0.5), 60, 'a slice under REEL_MIN_SEC never relaxes the minute (gate r1, adversary W1)');
  assert.strictEqual(safe.freshNeedSec(1200, 8), 60, 'an 8 s slice (a short chapter, a reel the file end cut) keeps the minute');
  assert.strictEqual(safe.freshNeedSec(1200, 29.9), 60);
  assert.strictEqual(safe.REEL_MIN_SEC, 30);
  assert.strictEqual(safe.freshNeedSec(20, 8), 16, 'a 20 s clip keeps its own 80% rule');
  for (const slice of [30, 45, 60, 90, 120]) {
    const d = safe.decideTimeMove({ storedSec: 0, nextSec: 10, served: 'ok', fresh: true, playedSec: 10, durationSec: 1200, sliceSec: slice });
    assert.strictEqual(d.reason, 'too-early', 'a 10 s look writes nothing (' + slice + ' s reel)');
  }
  assert.strictEqual(safe.decideTimeMove({ storedSec: 0, nextSec: 60, served: 'ok', fresh: true, playedSec: 59.2, durationSec: 1200, sliceSec: 60 }).ok, true, 'the whole 60 s reel counts');
  assert.strictEqual(safe.decideTimeMove({ storedSec: 0, nextSec: 60, served: 'ok', fresh: true, playedSec: 59.2, durationSec: 1200 }).reason, 'too-early', 'without the slice: the minute');
});

test('v1.382.0 D6 the served registry keeps the slice a card was served with, through a write and a Start over; a re-serve replaces it', () => {
  let t = 1000;
  const reg = createServedRegistry({ now: () => t });
  reg.mark('u', 'media', 'v', '', 's1', true, 60);
  assert.strictEqual(reg.sliceSecOf('u', 'media', 'v'), 60);
  reg.advance('u', 'media', 'v', '2026-10-10T00:00:00.000Z');
  assert.strictEqual(reg.sliceSecOf('u', 'media', 'v'), 60, 'kept through a landed write');
  reg.markReset('u', 'media', 'v', 's1');
  assert.strictEqual(reg.sliceSecOf('u', 'media', 'v'), 60, 'the started-over card replays its same slice');
  reg.mark('u', 'media', 'v', '', 's1', true);
  assert.strictEqual(reg.sliceSecOf('u', 'media', 'v'), 0, 'a serve with no slice: unknown (the minute rule alone)');
  for (const junk of [-1, 'x', Infinity, 1e9]) { reg.mark('u', 'media', 'v', '', 's1', true, junk); assert.strictEqual(reg.sliceSecOf('u', 'media', 'v'), 0, String(junk)); }
  assert.strictEqual(reg.sliceSecOf('u', 'media', 'nothing'), 0);
  reg.mark('u', 'media', 'v', '', 's1', true, 30);
  t += reg.size() ? 7 * 60 * 60 * 1000 : 0;
  assert.strictEqual(reg.sliceSecOf('u', 'media', 'v'), 0, 'an aged-out entry is unknown');
});
