'use strict';

// lib/scan/probe.js -- the cheap, schema-only per-file detections the scan
// reruns on every pass (no ffmpeg, no thumbnail/transcode work).
//
// Wave 6 of the relational-migration arc (docs/exec-plans/completed/
// 2026-09-13-sqlite-relational-migration.md): extracted from server.js
// VERBATIM: every body and doc comment is the original text. The ONLY comment
// edits anywhere in the extraction were positional locator words
// ("above"/"below") that pointed at a server.js NEIGHBOUR - those now name
// their target instead, so no comment here lies about where its subject is.
// server.js requires this module back and re-exports each helper, so
// `require('../../server').<name>` is the SAME function object as the one
// `require('../../lib/scan/<this file>').<name>` hands you.

const subtitles = require('../subtitles');

// A6 (v1.24 UX Round, Wave 5): additive `hasSubtitles` detection, shared by
// every scan branch in server.js's runScanDirectories that reuses an `existing` entry. SCHEMA-ONLY --
// `findSubtitleSidecar` only stats/reads the containing directory (no
// ffmpeg, no thumbnail/transcode work), so calling this can never trigger
// the thumbnail-backfill-regression class of bug. Deliberately recomputed on
// EVERY scan (unlike the one-time `releaseDate` backfill in `runScanDirectories`, which only
// fills a missing field once) -- a subtitle sidecar a user drops in, or
// removes, later is picked up (or cleared) on the very next scan, not just
// once. Mutates `existing.hasSubtitles` in place and returns `true` iff the
// value actually changed (so callers know whether to set `dbChanged`).
// `dirCache` (v1.30, A1 / AC1.3): an OPTIONAL per-scan `Map<dir, string[]>`
// (see `runScanDirectories`) forwarded straight into `findSubtitleSidecar`
// -- memoizes each directory's listing across every file scanned from it
// THIS PASS, closing the O(N^2) `readdirSync` storm at Dean's ~1300-item
// scale. It is discarded at the end of the scan pass (see call site), so a
// sidecar dropped/removed between scans is still picked up on the very next
// one -- this does NOT change the "recomputed every scan" contract
// described above, only how many times the directory is actually listed on
// disk within a single pass.
function applyHasSubtitlesDetection(existing, filePath, dirCache) {
  const hasSubtitles = !!subtitles.findSubtitleSidecar(filePath, undefined, dirCache);
  if (existing.hasSubtitles === hasSubtitles) return false;
  existing.hasSubtitles = hasSubtitles;
  return true;
}

module.exports = {
  applyHasSubtitlesDetection,
};
