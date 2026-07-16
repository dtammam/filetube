'use strict';

// C4 "fun stats" page (v1.24 UX Round, Wave 3): pure aggregation helpers over
// `db.metadata`. Every function here is a plain synchronous transform --
// object/array in, plain data out -- with NO filesystem access, no database
// I/O, and no `require('../server')`. `GET /api/stats` (server.js) is a thin
// HTTP wrapper: `loadDatabase()` once, then `computeLibraryStats(db.metadata)`
// exactly once per request. This is a deliberate LIVE compute, not a cached
// aggregate -- see the exec-plan's Design section ("C4 cached stats
// aggregate ... rejected"): at home-server scale (thousands of items, not
// millions) an O(n) pass per request is trivial and always fresh; a cached
// aggregate would need its own invalidation story for zero real benefit.
//
// "Most-watched" is backed by `db.metadata[id].viewCount` (additive integer,
// default 0 when absent -- never backfilled by re-processing/re-scanning,
// per the thumbnail-backfill-regression lesson). It is incremented ONCE per
// watch-page open by the dedicated `POST /api/videos/:id/view` route in
// server.js -- see that route's own comment for why it is deliberately NOT
// folded into `POST /api/progress` or the `/video/:id` Range-serve.

const path = require('path'); // pure string manipulation only -- no fs here, per the header contract

const DEFAULT_MOST_WATCHED_LIMIT = 10;

// `db.metadata` (an id -> item map) -> a plain array of items. Tolerant of a
// missing/malformed map (returns `[]`) so every caller below can assume a
// real array without its own guard.
function toItemList(metadata) {
  if (!metadata || typeof metadata !== 'object') return [];
  return Object.values(metadata);
}

// A finite, non-negative number from a possibly-missing/malformed field --
// every numeric aggregator below reads fields through this so a single
// corrupt/legacy record (a string, `NaN`, a negative stray value) can never
// poison a running total for the whole library.
function safeNumber(value) {
  return (typeof value === 'number' && Number.isFinite(value) && value >= 0) ? value : 0;
}

function isVideo(item) { return !!item && item.type === 'video'; }
function isAudio(item) { return !!item && item.type === 'audio'; }

// `{ total, video, audio }`. video/audio are NOT assumed to sum to total: an
// item with a missing/unrecognized `type` still counts toward `total` (it is
// real library content) but toward neither the video nor the audio bucket --
// mirrors C3's own fail-safe posture for an ambiguous type, just inverted
// (C3 fails an unknown type safe to "show it"; this fails it safe to "don't
// silently misclassify it").
function computeCounts(items) {
  const list = Array.isArray(items) ? items : [];
  return {
    total: list.length,
    video: list.filter(isVideo).length,
    audio: list.filter(isAudio).length,
  };
}

function computeTotalDuration(items) {
  const list = Array.isArray(items) ? items : [];
  return list.reduce((sum, item) => sum + safeNumber(item && item.duration), 0);
}

function computeTotalSize(items) {
  const list = Array.isArray(items) ? items : [];
  return list.reduce((sum, item) => sum + safeNumber(item && item.size), 0);
}

// Generic grouped breakdown: groups `items` by `keyFn(item)`, skipping any
// item whose key is missing/blank (e.g. a non-yt-dlp file has no
// `channelUrl` at all -- that is "not in any channel group," not a group
// literally named "undefined"). Returns an array (never a plain object, so
// consumers don't need `Object.keys` + a second sort pass), sorted by count
// descending then by key ascending -- a stable, fully deterministic order so
// the exact same fixture always renders identically in a test or on screen.
function groupBy(items, keyFn) {
  const list = Array.isArray(items) ? items : [];
  const groups = new Map();
  for (const item of list) {
    const key = typeof keyFn === 'function' ? keyFn(item) : undefined;
    if (typeof key !== 'string' || key.trim() === '') continue;
    let group = groups.get(key);
    if (!group) {
      group = { key, count: 0, totalDurationSeconds: 0, totalSizeBytes: 0 };
      groups.set(key, group);
    }
    group.count += 1;
    group.totalDurationSeconds += safeNumber(item && item.duration);
    group.totalSizeBytes += safeNumber(item && item.size);
  }
  return [...groups.values()].sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));
}

function computeBreakdownByFolder(items) {
  return groupBy(items, (item) => item && item.folderName).map((g) => ({
    folderName: g.key, count: g.count, totalDurationSeconds: g.totalDurationSeconds, totalSizeBytes: g.totalSizeBytes,
  }));
}

// Grouped by `channelUrl` -- only ever set on yt-dlp-managed items (see
// server.js's Phase-2 channel-identity bridge). Non-yt-dlp library files
// have no `channelUrl` and are correctly excluded (they don't belong to any
// channel), not folded into a misleading catch-all bucket.
function computeBreakdownByChannel(items) {
  return groupBy(items, (item) => item && item.channelUrl).map((g) => ({
    channelUrl: g.key, count: g.count, totalDurationSeconds: g.totalDurationSeconds, totalSizeBytes: g.totalSizeBytes,
  }));
}

function computeBreakdownByType(items) {
  const list = Array.isArray(items) ? items : [];
  const video = list.filter(isVideo);
  const audio = list.filter(isAudio);
  return {
    video: { count: video.length, totalDurationSeconds: computeTotalDuration(video), totalSizeBytes: computeTotalSize(video) },
    audio: { count: audio.length, totalDurationSeconds: computeTotalDuration(audio), totalSizeBytes: computeTotalSize(audio) },
  };
}

// Small display-only projection of a full metadata record: the id/title/
// folderName every record card wants, plus whichever extra field(s) the
// caller asks for. Deliberately never returns the raw item -- keeps the API
// response small and avoids leaking fields (e.g. `filePath`) the stats page
// has no use for.
function pickSummary(item, extraFields) {
  const summary = { id: item.id, title: item.title, folderName: item.folderName };
  for (const field of extraFields) summary[field] = item[field];
  return summary;
}

// Longest/shortest by `duration`. Items with a missing/zero/negative
// duration (undetermined -- e.g. metadata extraction failed or hasn't run
// yet) are excluded from BOTH, so an undetermined record can never
// masquerade as "shortest." Returns `null` on an empty/all-undetermined list.
function findLongest(items) {
  const list = (Array.isArray(items) ? items : []).filter((item) => safeNumber(item && item.duration) > 0);
  if (list.length === 0) return null;
  const longest = list.reduce((best, item) => (item.duration > best.duration ? item : best));
  return pickSummary(longest, ['duration']);
}

function findShortest(items) {
  const list = (Array.isArray(items) ? items : []).filter((item) => safeNumber(item && item.duration) > 0);
  if (list.length === 0) return null;
  const shortest = list.reduce((best, item) => (item.duration < best.duration ? item : best));
  return pickSummary(shortest, ['duration']);
}

// Newest by `addedAt`. `null` on an empty list.
function findNewest(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return null;
  const newest = list.reduce((best, item) => (safeNumber(item && item.addedAt) > safeNumber(best && best.addedAt) ? item : best));
  return pickSummary(newest, ['addedAt']);
}

// Top `limit` most-watched items by `viewCount` (additive, default 0 -- see
// this module's header comment). Items with a zero/missing `viewCount` are
// excluded entirely (nothing has been "watched" yet under this field) rather
// than padding the list with zero-view noise; ties broken by title ascending
// for a stable, deterministic order.
function findMostWatched(items, limit) {
  const list = Array.isArray(items) ? items : [];
  const cap = (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) ? Math.floor(limit) : DEFAULT_MOST_WATCHED_LIMIT;
  return list
    .filter((item) => safeNumber(item && item.viewCount) > 0)
    .sort((a, b) => (safeNumber(b.viewCount) - safeNumber(a.viewCount)) || String(a.title).localeCompare(String(b.title)))
    .slice(0, cap)
    .map((item) => pickSummary(item, ['viewCount']));
}

// ---- v1.41.0: book-library stats (Dean) ------------------------------------
// `db.books.items` is an id->book map (lib/books/store.js); books carry `size`,
// `format` ('epub'|'pdf'), and `folderName` -- so this mirrors the video
// aggregation with a SIZE-ONLY shape (books have no duration). Pure, same
// fail-safe posture as everything above (tolerant of missing/malformed input).

function bookFormat(item) {
  return (item && (item.format === 'epub' || item.format === 'pdf')) ? item.format : null;
}

// Grouped by immediate containing folder, size-only (no duration for books).
// Reuses groupBy's blank-key skip + deterministic count-desc/key-asc sort.
function computeBookFolderBreakdown(items) {
  return groupBy(items, (b) => b && b.folderName).map((g) => ({
    folderName: g.key, count: g.count, totalSizeBytes: g.totalSizeBytes,
  }));
}

// How many books have at least one chapter with READY TTS narration.
// `audioMap` is `db.books.audio` (audio[bookId][spineIndex] = { status, ... });
// boot-reconcile already prunes stale 'processing'/'pending' and 'ready'-with-
// missing-file entries (server.js), so a surviving `status: 'ready'` is real.
function computeNarratedCount(booksItems, audioMap) {
  if (!audioMap || typeof audioMap !== 'object') return 0;
  const items = (booksItems && typeof booksItems === 'object') ? booksItems : {};
  let narrated = 0;
  for (const id of Object.keys(items)) {
    const perBook = audioMap[id];
    if (perBook && typeof perBook === 'object' &&
        Object.values(perBook).some((e) => e && e.status === 'ready')) {
      narrated += 1;
    }
  }
  return narrated;
}

function computeBookStats(booksItems, audioMap) {
  const items = toItemList(booksItems);
  const epub = items.filter((b) => bookFormat(b) === 'epub');
  const pdf = items.filter((b) => bookFormat(b) === 'pdf');
  return {
    count: items.length,
    totalSizeBytes: computeTotalSize(items),
    byFormat: {
      epub: { count: epub.length, totalSizeBytes: computeTotalSize(epub) },
      pdf: { count: pdf.length, totalSizeBytes: computeTotalSize(pdf) },
    },
    byFolder: computeBookFolderBreakdown(items),
    narratedCount: computeNarratedCount(booksItems, audioMap),
  };
}

// The single entry point `GET /api/stats` calls: `metadata` is `db.metadata`
// (an id -> item map) straight off a freshly-`loadDatabase()`d db, computed
// LIVE on every call (no cached aggregate -- see this module's header
// comment). Pure; never throws on a missing/malformed `metadata`.
function computeLibraryStats(metadata) {
  const items = toItemList(metadata);
  return {
    count: computeCounts(items),
    totalDurationSeconds: computeTotalDuration(items),
    totalSizeBytes: computeTotalSize(items),
    byFolder: computeBreakdownByFolder(items),
    byChannel: computeBreakdownByChannel(items),
    byType: computeBreakdownByType(items),
    longest: findLongest(items),
    shortest: findShortest(items),
    newest: findNewest(items),
    mostWatched: findMostWatched(items, DEFAULT_MOST_WATCHED_LIMIT),
  };
}

// ---- v1.41.11 (Dean): duplicates report ------------------------------------
//
// "I want to see files that are truly duplicates so I can clean them up."
// Two sections, both derived purely from `db.metadata` (the library index is
// the source of truth -- no filesystem walk, no hashing; Dean scoped this to
// FILENAME-level truth):
//   - nameGroups: 2+ items sharing an EXACT basename (name + extension, byte
//     comparison) in different folders -- the classic "same file copied into
//     two playlists" case.
//   - idGroups:   2+ items sharing a yt-dlp video id (the `[id]` filename
//     bracket, else a validly-shaped persisted `youtubeId`) under 2+ DISTINCT
//     basenames -- the cross-folder copy whose titles drifted (a re-download
//     with a renamed title, a Topic/VEVO mirror, the v1.41.9 divergent-
//     spelling class). Groups where every basename is identical already live
//     in nameGroups; requiring 2+ distinct names keeps the sections from
//     being mirror images (a mixed group legitimately appears in both, one
//     per lens). A coincidentally-bracketed non-yt-dlp file cannot form a
//     group alone -- it takes TWO files claiming the SAME 11-char id -- and
//     this surface is read-only, so the scan-time root-scoping rule for
//     extractYtdlpVideoId (see its server.js header) is deliberately not
//     applied here.
//
// `wastedBytes` is the reclaim ESTIMATE for keeping only the largest copy:
// sum(sizes) - max(size). For name-groups the copies are usually identical
// bytes; for id-groups the copies can be different qualities -- either way
// it's what deleting all-but-the-biggest would free. Reported per group and
// totaled per section.
//
// `extractVideoId` is INJECTED (server.js passes its own extractYtdlpVideoId)
// -- the same deps-bundle posture as moveItemToFolder -- so this module keeps
// its "no require('../server')" contract without duplicating the bracket
// regex. Omitting it just yields an empty idGroups section.
function buildDuplicateGroup(key, group) {
  const items = group
    .map((item) => ({ id: item.id, filePath: item.filePath, size: safeNumber(item.size) }))
    .sort((a, b) => b.size - a.size || (a.filePath < b.filePath ? -1 : 1));
  const totalBytes = items.reduce((sum, item) => sum + item.size, 0);
  return { key, items, totalBytes, wastedBytes: totalBytes - (items.length ? items[0].size : 0) };
}

const VIDEO_ID_SHAPE = /^[A-Za-z0-9_-]{11}$/; // the url.isSafeVideoId shape (11 chars of [A-Za-z0-9_-])

function computeDuplicateReport(metadata, opts) {
  const extractVideoId = (opts && typeof opts.extractVideoId === 'function') ? opts.extractVideoId : () => null;
  const items = toItemList(metadata).filter((item) => item && typeof item.filePath === 'string' && item.filePath !== '');

  const byName = new Map();
  const byVideoId = new Map();
  for (const item of items) {
    // NFC-normalized name key (adversarial-gate suggestion): two copies of
    // the same file whose names differ only by Unicode normalization (the
    // NFC/NFD divergence SMB/APFS produce -- the v1.41.9 class's gentler
    // sibling) ARE the same filename to a human and must group. Read-only
    // safe: the key is for grouping/display; item.filePath keeps the real
    // on-disk bytes.
    let base = path.basename(item.filePath);
    try { base = base.normalize('NFC'); } catch (_) { /* keep the raw name */ }
    if (!byName.has(base)) byName.set(base, []);
    byName.get(base).push(item);

    const stem = path.basename(item.filePath, path.extname(item.filePath));
    const vid = extractVideoId(stem)
      || ((typeof item.youtubeId === 'string' && VIDEO_ID_SHAPE.test(item.youtubeId)) ? item.youtubeId : null);
    if (vid) {
      if (!byVideoId.has(vid)) byVideoId.set(vid, []);
      byVideoId.get(vid).push(item);
    }
  }

  const nameGroups = [];
  for (const [base, group] of byName) {
    if (group.length >= 2) nameGroups.push(buildDuplicateGroup(base, group));
  }
  const idGroups = [];
  for (const [vid, group] of byVideoId) {
    if (group.length < 2) continue;
    // Same NFC lens as the name-group keys above, so "distinct" here can
    // never disagree with what the name section grouped.
    const distinctNames = new Set(group.map((item) => {
      let base = path.basename(item.filePath);
      try { base = base.normalize('NFC'); } catch (_) { /* raw */ }
      return base;
    }));
    if (distinctNames.size < 2) continue; // identical names -> already a nameGroup
    idGroups.push(buildDuplicateGroup(vid, group));
  }
  // Biggest reclaim first; key as a deterministic tiebreak (Map iteration
  // order is insertion order = db order, which shifts between scans).
  const byWasted = (a, b) => b.wastedBytes - a.wastedBytes || (a.key < b.key ? -1 : 1);
  nameGroups.sort(byWasted);
  idGroups.sort(byWasted);

  const sum = (groups, field) => groups.reduce((total, g) => total + g[field], 0);
  return {
    nameGroups,
    idGroups,
    totals: {
      nameGroupCount: nameGroups.length,
      nameFileCount: nameGroups.reduce((n, g) => n + g.items.length, 0),
      nameWastedBytes: sum(nameGroups, 'wastedBytes'),
      idGroupCount: idGroups.length,
      idFileCount: idGroups.reduce((n, g) => n + g.items.length, 0),
      idWastedBytes: sum(idGroups, 'wastedBytes'),
    },
  };
}

// RFC 4180 serializer for the report: one row per file, section-tagged, CRLF
// line endings, EVERY field quoted with internal quotes doubled -- library
// filenames legitimately contain commas, quotes, emoji, and full-width
// punctuation, so selective quoting would be a footgun. Pure string in/out.
//
// Formula-injection hardening (adversarial-gate W5, OWASP CSV-injection
// class): spreadsheet apps EVALUATE a parsed cell that begins with = + - or
// @ regardless of CSV quoting, and these fields carry internet-controlled
// YouTube titles (`=HYPERLINK(...) [id].mp4` is a legal filename). A cell
// starting with one of those gets the standard leading-apostrophe defusal --
// numeric fields never start with them (sizes/counts are non-negative), so
// data cells are untouched.
function csvField(value) {
  let s = String(value === undefined || value === null ? '' : value);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function duplicateReportToCsv(report) {
  const rows = [['section', 'group_key', 'file_path', 'size_bytes', 'group_file_count', 'group_wasted_bytes']];
  const push = (section, groups) => {
    for (const group of groups) {
      group.items.forEach((item, index) => {
        // group_wasted_bytes on the FIRST row of the group only (adversarial
        // gate: repeating it per row invites a naive column SUM that
        // multiplies the reclaim estimate by group size -- exactly the
        // cleanup math this export exists to inform).
        rows.push([section, group.key, item.filePath, item.size, group.items.length, index === 0 ? group.wastedBytes : '']);
      });
    }
  };
  push('same-filename', (report && report.nameGroups) || []);
  push('same-videoid', (report && report.idGroups) || []);
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

module.exports = {
  toItemList,
  computeCounts,
  computeTotalDuration,
  computeTotalSize,
  computeBreakdownByFolder,
  computeBreakdownByChannel,
  computeBreakdownByType,
  findLongest,
  findShortest,
  findNewest,
  findMostWatched,
  computeLibraryStats,
  computeBookStats,
  computeBookFolderBreakdown,
  computeNarratedCount,
  DEFAULT_MOST_WATCHED_LIMIT,
  // v1.41.11 (Dean): duplicates report + its CSV serializer.
  computeDuplicateReport,
  duplicateReportToCsv,
};
