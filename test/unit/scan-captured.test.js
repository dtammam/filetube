'use strict';

// [UNIT] Wave 6 (scan extraction) -- lib/scan/captured.js, required DIRECTLY.
//
// These three are the WRITE BOUNDARY for everything the yt-dlp download bridge
// captured, and each is the ONE writer its three consume sites call (the
// v1.41.4 "a seat forgot to call the shared helper" lesson):
//
//   - applyCapturedViewCount / applyCapturedFollowerCount: the count and its
//     capture moment are written as a UNIT, and only when the count itself
//     survives re-validation at this boundary. An item must never end up with
//     a number and no date, or a date and no number.
//   - collectDownloadNotification: stages one bell row per media id, de-duped
//     because one item can legitimately hit two consume sites in one pass.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  applyCapturedViewCount,
  applyCapturedFollowerCount,
  collectDownloadNotification,
} = require('../../lib/scan/captured');

const NOW = () => Date.now();

// ---- applyCapturedViewCount -------------------------------------------------

test('applyCapturedViewCount: writes the count and its capture moment as a unit', () => {
  const capturedAt = NOW() - 5_000;
  const item = {};
  assert.strictEqual(applyCapturedViewCount(item, { sourceViewCount: 12, sourceViewCountCapturedAt: capturedAt }), true);
  assert.deepStrictEqual(item, { sourceViewCount: 12, sourceViewCountCapturedAt: capturedAt });
});

test('applyCapturedViewCount: the field is sourceViewCount, NEVER viewCount (v1.48 collision)', () => {
  const item = { viewCount: 3 }; // the legacy LOCAL play counter
  applyCapturedViewCount(item, { sourceViewCount: 12_000_000 }, NOW());
  assert.strictEqual(item.viewCount, 3,
    'a YouTube view count written into viewCount would be read back as Dean\'s local play count');
  assert.strictEqual(item.sourceViewCount, 12_000_000);
});

test('applyCapturedViewCount: a missing/unusable capturedAt falls back to now', () => {
  const now = NOW();
  for (const bad of [undefined, null, 0, -1, NaN, Infinity, 'yesterday']) {
    const item = {};
    applyCapturedViewCount(item, { sourceViewCount: 5, sourceViewCountCapturedAt: bad }, now);
    assert.strictEqual(item.sourceViewCountCapturedAt, now, `capturedAt ${String(bad)} -> now`);
  }
});

test('applyCapturedViewCount: a count that fails re-validation writes NOTHING at all', () => {
  for (const bad of [undefined, null, -1, 1.5, NaN, '12', {}]) {
    const item = {};
    assert.strictEqual(applyCapturedViewCount(item, { sourceViewCount: bad }, NOW()), false,
      `${String(bad)} is rejected`);
    assert.deepStrictEqual(item, {}, 'no half-written pair: neither the number nor the date lands');
  }
});

test('applyCapturedViewCount: zero views is a legitimate count', () => {
  const item = {};
  assert.strictEqual(applyCapturedViewCount(item, { sourceViewCount: 0 }, NOW()), true);
  assert.strictEqual(item.sourceViewCount, 0);
});

test('applyCapturedViewCount: a missing item or consumed entry is a no-op', () => {
  assert.strictEqual(applyCapturedViewCount(null, { sourceViewCount: 1 }), false);
  assert.strictEqual(applyCapturedViewCount({}, null), false);
});

// ---- applyCapturedFollowerCount ---------------------------------------------

test('applyCapturedFollowerCount: writes sourceFollowerCount + its capture moment as a unit', () => {
  const capturedAt = NOW() - 1_000;
  const item = {};
  assert.strictEqual(
    applyCapturedFollowerCount(item, { sourceFollowerCount: 900, sourceFollowerCountCapturedAt: capturedAt }), true);
  assert.deepStrictEqual(item, { sourceFollowerCount: 900, sourceFollowerCountCapturedAt: capturedAt });
});

test('applyCapturedFollowerCount: a missing/unusable capturedAt falls back to now', () => {
  const now = NOW();
  const item = {};
  applyCapturedFollowerCount(item, { sourceFollowerCount: 7 }, now);
  assert.strictEqual(item.sourceFollowerCountCapturedAt, now);
});

test('applyCapturedFollowerCount: a rejected count writes NOTHING (same both-or-neither rule)', () => {
  for (const bad of [undefined, null, -1, 2.5, 'many']) {
    const item = {};
    assert.strictEqual(applyCapturedFollowerCount(item, { sourceFollowerCount: bad }, NOW()), false);
    assert.deepStrictEqual(item, {});
  }
});

test('applyCapturedFollowerCount: it touches ONLY its own namespace, not the view-count pair', () => {
  const item = {};
  applyCapturedFollowerCount(item, { sourceFollowerCount: 5 }, NOW());
  assert.strictEqual(item.sourceViewCount, undefined);
  assert.strictEqual(item.followerCount, undefined, 'the un-prefixed name is never written');
});

// ---- collectDownloadNotification --------------------------------------------

test('collectDownloadNotification: stages { mediaId, createdAt } with createdAt = the CONSUME moment', () => {
  const now = NOW();
  const pending = [];
  assert.strictEqual(collectDownloadNotification(pending, { id: 'abc', addedAt: now - 3_600_000 }, now), true);
  assert.deepStrictEqual(pending, [{ mediaId: 'abc', createdAt: now }],
    'NOT item.addedAt - a birthtime is the .part download START, and can even sit ahead of the server clock');
});

test('collectDownloadNotification: de-dupes by mediaId (one item can hit two consume sites in a pass)', () => {
  const now = NOW();
  const pending = [];
  collectDownloadNotification(pending, { id: 'abc' }, now);
  assert.strictEqual(collectDownloadNotification(pending, { id: 'abc' }, now + 10), false);
  assert.strictEqual(pending.length, 1);
});

test('collectDownloadNotification: distinct ids all land, in order', () => {
  const now = NOW();
  const pending = [];
  collectDownloadNotification(pending, { id: 'a' }, now);
  collectDownloadNotification(pending, { id: 'b' }, now + 1);
  assert.deepStrictEqual(pending.map((p) => p.mediaId), ['a', 'b']);
});

test('collectDownloadNotification: a non-array pending, a missing item, or a blank id is a no-op', () => {
  assert.strictEqual(collectDownloadNotification(null, { id: 'a' }), false);
  assert.strictEqual(collectDownloadNotification([], null), false);
  assert.strictEqual(collectDownloadNotification([], {}), false);
  assert.strictEqual(collectDownloadNotification([], { id: '' }), false);
  assert.strictEqual(collectDownloadNotification([], { id: 42 }), false);
  const pending = [];
  collectDownloadNotification(pending, { id: '' });
  assert.deepStrictEqual(pending, [], 'a rejected item leaves the queue untouched');
});
