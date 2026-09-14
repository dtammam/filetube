'use strict';

// lib/scan/captured.js -- the write boundary for values CAPTURED by the
// yt-dlp download bridge - the source view/follower counts carried onto a
// library item, and the notification-bell rows a consume stages.
//
// Wave 6 of the relational-migration arc (docs/exec-plans/active/
// 2026-09-13-sqlite-relational-migration.md): extracted from server.js
// VERBATIM: every body and doc comment is the original text. The ONLY comment
// edits anywhere in the extraction were positional locator words
// ("above"/"below") that pointed at a server.js NEIGHBOUR - those now name
// their target instead, so no comment here lies about where its subject is.
// server.js requires this module back and re-exports each helper, so
// `require('../../server').<name>` is the SAME function object as the one
// `require('../../lib/scan/<this file>').<name>` hands you.

// v1.48 item 2: carry a captured day-of view count from a consumed downloadMeta
// bridge entry onto the library item. ONE writer for all three consume sites
// (universal, the D1a proxy-host YouTube recovery, and the plain YouTube
// bracket path) -- the v1.41.4 lesson was a seat that forgot to CALL the shared
// helper, so there is exactly one to call and it is called from every site.
//
// THE FIELD IS `sourceViewCount`, NOT `viewCount`, AND THAT IS LOAD-BEARING.
// `item.viewCount` is ALREADY TAKEN, with completely different semantics: it is
// the legacy pre-v1.42 LOCAL watch counter, and `effectiveViewCount` (server.js)
// still honors a leftover embedded `item.viewCount` as the starting value for
// how many times DEAN has played that file. Writing a YouTube view count into
// that name would have been read straight back as a local play count -- a
// freshly-downloaded video would have reported ~12 million local watches on the
// stats page, and `withEffectiveViewCounts` would have propagated it. The two
// numbers are unrelated and must never share a key. `sourceViewCount` also
// matches the existing `sourceTitle`/`sourceId`/`sourceExtractor` convention
// for "this value came from the SOURCE, not from us".
//
// The count and its capture date are written as a UNIT, and only when the count
// itself survives re-validation: an item must never end up with a number and no
// date (the UI would have to invent one for the "when downloaded" label) or a
// date with no number. The date falls back to now only when the bridge entry
// carried no usable `capturedAt` of its own.
//
// `consumed.sourceViewCount` has already crossed `store.parseCapturedViewCount` at
// the read boundary; the `typeof`/`Number.isInteger` re-check here is the same
// re-validate-at-the-write-boundary posture every sibling field above uses.
function applyCapturedViewCount(item, consumed, nowMs = Date.now()) {
  if (!item || !consumed) return false;
  const views = consumed.sourceViewCount;
  if (typeof views !== 'number' || !Number.isInteger(views) || views < 0) return false;
  const capturedAt = consumed.sourceViewCountCapturedAt;
  item.sourceViewCount = views;
  item.sourceViewCountCapturedAt =
    (typeof capturedAt === 'number' && Number.isFinite(capturedAt) && capturedAt > 0)
      ? capturedAt
      : nowMs;
  return true;
}

// v1.54 (Dean's real subscriber counts): the follower-count sibling of
// applyCapturedViewCount above -- ONE writer for all three consume sites
// (the v1.41.4 discipline), the count and its capture moment written as a
// UNIT. Field is `sourceFollowerCount` (collision-grepped clean; the v1.48
// name-already-taken lesson).
function applyCapturedFollowerCount(item, consumed, nowMs = Date.now()) {
  if (!item || !consumed) return false;
  const followers = consumed.sourceFollowerCount;
  if (typeof followers !== 'number' || !Number.isInteger(followers) || followers < 0) return false;
  const capturedAt = consumed.sourceFollowerCountCapturedAt;
  item.sourceFollowerCount = followers;
  item.sourceFollowerCountCapturedAt =
    (typeof capturedAt === 'number' && Number.isFinite(capturedAt) && capturedAt > 0)
      ? capturedAt
      : nowMs;
  return true;
}

// v1.51 notification bell: ONE collector for all three downloadMeta consume
// sites (the v1.41.4 lesson is a seat that forgot to CALL the shared helper,
// so there is exactly one to call and every site calls it). Only ever invoked
// right after a consume SUCCEEDED inside the scan's Phase-2 mutator — that is
// the load-bearing scoping: a consume fires only for a freshly-indexed file
// under the yt-dlp download roots whose bridge entry still existed, so
// reheats, re-encodes, hand-dropped files and plain re-scans can never
// notify. createdAt is the CONSUME moment (nowMs), NOT item.addedAt.
//
// GATE FIX (adversarial W1, repro'd): addedAt is the file's birthtime, and
// on yt-dlp's single-format path that is the moment the `.part` download
// STARTED (the rename preserves the inode's btime) -- so a long download
// finishing after Dean opened the bell was born already-seen (badge never
// increments), a Clear mid-download hid it forever, and with 200 newer rows
// it was evicted inside its own insert transaction. A birthtime AHEAD of
// the server clock (NAS mount skew) was worse: a badge that mark-seen could
// not zero until wall-clock caught up. The watermark algebra is strictly
// `created_at > last_seen_at`, so the only value that is always correct on
// both sides of "now" is the moment the event actually entered the feed --
// the v1.50 lesson: normalize a client-supplied number ONCE at the staging
// boundary. Seeding (seedNotificationHistoryOnce) deliberately still uses
// addedAt: history ORDERING is what matters there and every seeded row is
// born read+seen, so the algebra never touches it.
//
// De-dups by mediaId because ONE item can legitimately hit two consume
// sites in one pass (universal + the D1a proxy-host YouTube recovery).
function collectDownloadNotification(pending, item, nowMs = Date.now()) {
  if (!Array.isArray(pending) || !item || typeof item.id !== 'string' || item.id === '') return false;
  if (pending.some((p) => p.mediaId === item.id)) return false;
  pending.push({ mediaId: item.id, createdAt: nowMs });
  return true;
}

module.exports = {
  applyCapturedViewCount,
  applyCapturedFollowerCount,
  collectDownloadNotification,
};
