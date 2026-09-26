'use strict';

// [UNIT] C4 (v1.24 UX Round, Wave 3) -- the pure aggregation helpers in
// lib/stats.js, exercised against a synthetic `db.metadata`-shaped fixture
// (never a real database/filesystem). GET /api/stats (server.js) is a thin
// wrapper around `computeLibraryStats`; this suite is the load-bearing
// coverage the exec-plan's C4 acceptance criteria asks for.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  toItemList, computeCounts, computeTotalDuration, computeTotalSize,
  computeBreakdownByFolder, computeBreakdownByChannel, computeBreakdownByType,
  findLongest, findShortest, findNewest, findMostWatched, computeLibraryStats,
  DEFAULT_MOST_WATCHED_LIMIT, computeInventory,
} = require('../../lib/stats');

function item(overrides) {
  return {
    id: 'id', title: 'Title', folderName: 'Folder', type: 'video',
    duration: 100, size: 1000, addedAt: 1000,
    ...overrides,
  };
}

// ---- toItemList ----------------------------------------------------------

test('toItemList: converts an id->item map to a plain array', () => {
  const list = toItemList({ a: item({ id: 'a' }), b: item({ id: 'b' }) });
  assert.deepEqual(list.map((i) => i.id).sort(), ['a', 'b']);
});

test('toItemList: a missing/malformed metadata map fails safe to an empty array', () => {
  assert.deepEqual(toItemList(undefined), []);
  assert.deepEqual(toItemList(null), []);
  assert.deepEqual(toItemList('not-an-object'), []);
});

// ---- computeCounts --------------------------------------------------------

test('computeCounts: totals video/audio/total, an unrecognized type counts toward total only', () => {
  const list = [
    item({ id: 'v1', type: 'video' }),
    item({ id: 'v2', type: 'video' }),
    item({ id: 'a1', type: 'audio' }),
    item({ id: 'x1', type: 'ambiguous' }),
  ];
  assert.deepEqual(computeCounts(list), { total: 4, video: 2, audio: 1 });
});

test('computeCounts: an empty list is all zeros', () => {
  assert.deepEqual(computeCounts([]), { total: 0, video: 0, audio: 0 });
});

// ---- computeTotalDuration / computeTotalSize ------------------------------

test('computeTotalDuration: sums duration across items', () => {
  assert.equal(computeTotalDuration([item({ duration: 100 }), item({ duration: 250 })]), 350);
});

test('computeTotalDuration: a corrupt/missing duration field contributes zero, not NaN', () => {
  const list = [item({ duration: 100 }), item({ duration: 'not-a-number' }), item({ duration: undefined }), item({ duration: -5 })];
  assert.equal(computeTotalDuration(list), 100);
});

test('computeTotalSize: sums size across items, fails safe on a corrupt field', () => {
  const list = [item({ size: 1000 }), item({ size: NaN }), item({ size: 2000 })];
  assert.equal(computeTotalSize(list), 3000);
});

// ---- computeBreakdownByFolder ---------------------------------------------

test('computeBreakdownByFolder: groups by folderName, sums duration/size, sorted count desc then key asc', () => {
  const list = [
    item({ folderName: 'B', duration: 10, size: 100 }),
    item({ folderName: 'A', duration: 20, size: 200 }),
    item({ folderName: 'A', duration: 30, size: 300 }),
  ];
  const result = computeBreakdownByFolder(list);
  assert.deepEqual(result, [
    { folderName: 'A', count: 2, totalDurationSeconds: 50, totalSizeBytes: 500 },
    { folderName: 'B', count: 1, totalDurationSeconds: 10, totalSizeBytes: 100 },
  ]);
});

test('computeBreakdownByFolder: a missing/blank folderName is excluded, not grouped as "undefined"', () => {
  const list = [item({ folderName: undefined }), item({ folderName: '' }), item({ folderName: '  ' }), item({ folderName: 'Real' })];
  const result = computeBreakdownByFolder(list);
  assert.equal(result.length, 1);
  assert.equal(result[0].folderName, 'Real');
});

// ---- computeBreakdownByChannel ---------------------------------------------

test('computeBreakdownByChannel: groups by channelUrl, excludes items with no channelUrl at all', () => {
  const list = [
    item({ id: 'c1', channelUrl: 'https://www.youtube.com/@a' }),
    item({ id: 'c2', channelUrl: 'https://www.youtube.com/@a' }),
    item({ id: 'c3' }), // no channelUrl -- a plain library file
  ];
  const result = computeBreakdownByChannel(list);
  assert.deepEqual(result, [{ channelUrl: 'https://www.youtube.com/@a', count: 2, totalDurationSeconds: 200, totalSizeBytes: 2000 }]);
});

// v1.338 D8b (Dean: "non-YouTube things supported by YT DLP should have generally
// first-class experiences"): a download from another site (sourceExtractor, no
// channelUrl) joins By channel as its own site + uploader row. Fixture: two
// uploaders on one site, one uploader name shared across two sites, a no-uploader
// item that falls back to its folder, and a YouTube channel whose numbers must not move.
test('v1.338 D8b computeBreakdownByChannel: downloads from other sites group by site + uploader; YouTube rows unchanged', () => {
  const youtubeOnly = [
    item({ id: 'y1', channelUrl: 'https://www.youtube.com/@a', duration: 10, size: 100 }),
    item({ id: 'y2', channelUrl: 'https://www.youtube.com/@a', duration: 20, size: 200 }),
    item({ id: 'y3', channelUrl: 'https://www.youtube.com/@a', duration: 30, size: 300 }),
    item({ id: 'y4', channelUrl: 'https://www.youtube.com/@b', duration: 40, size: 400 }), // sorts AMONG the other sites' rows
    item({ id: 'p1' }), // a plain library file: in no row
  ];
  const universal = [
    item({ id: 'r1', sourceExtractor: 'Reddit', sourceId: 'r1', channelName: 'alice', duration: 5, size: 50 }),
    item({ id: 'r2', sourceExtractor: 'Reddit', sourceId: 'r2', channelName: 'alice', duration: 6, size: 60 }),
    item({ id: 'r3', sourceExtractor: 'Reddit', sourceId: 'r3', channelName: 'bob', duration: 7, size: 70 }),
    item({ id: 'f1', sourceExtractor: 'Facebook', sourceId: 'f1', channelName: 'alice', duration: 8, size: 80 }),
    item({ id: 't1', sourceExtractor: 'TikTok', sourceId: 't1', folderName: 'TikTok', duration: 9, size: 90 }), // no uploader captured: the folder it landed in
  ];
  const before = computeBreakdownByChannel(youtubeOnly);
  const result = computeBreakdownByChannel([...youtubeOnly, ...universal]);
  assert.deepEqual(result.filter((r) => r.channelUrl), before, 'every YouTube row is byte-identical with the other sites present');
  assert.deepEqual(result, [
    { channelUrl: 'https://www.youtube.com/@a', count: 3, totalDurationSeconds: 60, totalSizeBytes: 600 },
    { sourceExtractor: 'Reddit', channelName: 'alice', count: 2, totalDurationSeconds: 11, totalSizeBytes: 110 },
    { sourceExtractor: 'Facebook', channelName: 'alice', count: 1, totalDurationSeconds: 8, totalSizeBytes: 80 },
    { channelUrl: 'https://www.youtube.com/@b', count: 1, totalDurationSeconds: 40, totalSizeBytes: 400 },
    { sourceExtractor: 'Reddit', channelName: 'bob', count: 1, totalDurationSeconds: 7, totalSizeBytes: 70 },
    { sourceExtractor: 'TikTok', channelName: 'TikTok', count: 1, totalDurationSeconds: 9, totalSizeBytes: 90 },
  ]);
});

test('v1.338 D8b computeBreakdownByChannel: a YouTube item that also carries sourceExtractor (a proxy-host download) stays in its YouTube row only', () => {
  const result = computeBreakdownByChannel([
    item({ id: 'y1', channelUrl: 'https://www.youtube.com/@a', sourceExtractor: 'Youtube', sourceId: 'AAAAAAAAAAA', channelName: 'A' }),
    item({ id: 'y2', channelUrl: 'https://www.youtube.com/@a' }),
  ]);
  assert.deepEqual(result, [{ channelUrl: 'https://www.youtube.com/@a', count: 2, totalDurationSeconds: 200, totalSizeBytes: 2000 }]);
});

test('v1.338 D8b computeBreakdownByChannel: a site with no uploader AND no folder, or a blank site, forms no row', () => {
  const result = computeBreakdownByChannel([
    item({ id: 'x1', sourceExtractor: 'Reddit', folderName: '' }),
    item({ id: 'x2', sourceExtractor: '   ', channelName: 'alice' }),
    item({ id: 'x3', sourceExtractor: 42, channelName: 'alice' }),
  ]);
  assert.deepEqual(result, []);
});

// ---- computeBreakdownByType -------------------------------------------------

test('computeBreakdownByType: separate video/audio buckets with independent duration/size totals', () => {
  const list = [
    item({ type: 'video', duration: 100, size: 1000 }),
    item({ type: 'video', duration: 200, size: 2000 }),
    item({ type: 'audio', duration: 50, size: 500 }),
  ];
  assert.deepEqual(computeBreakdownByType(list), {
    video: { count: 2, totalDurationSeconds: 300, totalSizeBytes: 3000 },
    audio: { count: 1, totalDurationSeconds: 50, totalSizeBytes: 500 },
  });
});

// ---- findLongest / findShortest --------------------------------------------

test('findLongest: returns the item with the maximum duration', () => {
  const list = [item({ id: 'a', title: 'A', duration: 100 }), item({ id: 'b', title: 'B', duration: 500 }), item({ id: 'c', title: 'C', duration: 200 })];
  assert.deepEqual(findLongest(list), { id: 'b', title: 'B', folderName: 'Folder', duration: 500 });
});

test('findShortest: returns the item with the minimum POSITIVE duration', () => {
  const list = [item({ id: 'a', title: 'A', duration: 100 }), item({ id: 'b', title: 'B', duration: 30 })];
  assert.deepEqual(findShortest(list), { id: 'b', title: 'B', folderName: 'Folder', duration: 30 });
});

test('findLongest/findShortest: items with a zero/missing duration are excluded from BOTH', () => {
  const list = [item({ id: 'a', duration: 0 }), item({ id: 'b', duration: undefined })];
  assert.equal(findLongest(list), null);
  assert.equal(findShortest(list), null);
});

test('findLongest/findShortest: an empty list returns null', () => {
  assert.equal(findLongest([]), null);
  assert.equal(findShortest([]), null);
});

// ---- findNewest -------------------------------------------------------------

test('findNewest: returns the item with the maximum addedAt', () => {
  const list = [item({ id: 'a', addedAt: 1000 }), item({ id: 'b', addedAt: 3000 }), item({ id: 'c', addedAt: 2000 })];
  assert.equal(findNewest(list).id, 'b');
});

test('findNewest: an empty list returns null', () => {
  assert.equal(findNewest([]), null);
});

// ---- findMostWatched ---------------------------------------------------------

test('findMostWatched: sorted by viewCount descending, zero/missing viewCount excluded', () => {
  const list = [
    item({ id: 'a', title: 'A', viewCount: 5 }),
    item({ id: 'b', title: 'B', viewCount: 0 }),
    item({ id: 'c', title: 'C', viewCount: 20 }),
    item({ id: 'd', title: 'D' }), // no viewCount field at all -- the v1.24 backfill default
  ];
  const result = findMostWatched(list, 10);
  assert.deepEqual(result.map((i) => i.id), ['c', 'a']);
});

test('findMostWatched: ties broken by title ascending for a deterministic order', () => {
  const list = [item({ id: 'z', title: 'Zebra', viewCount: 5 }), item({ id: 'a', title: 'Apple', viewCount: 5 })];
  assert.deepEqual(findMostWatched(list, 10).map((i) => i.id), ['a', 'z']);
});

test('findMostWatched: respects a custom limit, defaults to DEFAULT_MOST_WATCHED_LIMIT otherwise', () => {
  const list = Array.from({ length: 15 }, (_, i) => item({ id: `id${i}`, title: `T${i}`, viewCount: i + 1 }));
  assert.equal(findMostWatched(list, 3).length, 3);
  assert.equal(findMostWatched(list).length, DEFAULT_MOST_WATCHED_LIMIT);
});

test('findMostWatched: an empty/all-unwatched list returns an empty array, never null', () => {
  assert.deepEqual(findMostWatched([], 10), []);
  assert.deepEqual(findMostWatched([item({ viewCount: 0 })], 10), []);
});

// ---- computeLibraryStats (the GET /api/stats entry point) -------------------

test('computeLibraryStats: assembles every section from a synthetic db.metadata fixture', () => {
  const metadata = {
    v1: item({ id: 'v1', title: 'Video One', type: 'video', folderName: 'Movies', duration: 600, size: 5000, addedAt: 1000, channelUrl: 'https://www.youtube.com/@chan', viewCount: 3 }),
    v2: item({ id: 'v2', title: 'Video Two', type: 'video', folderName: 'Movies', duration: 300, size: 3000, addedAt: 3000 }),
    a1: item({ id: 'a1', title: 'Audio One', type: 'audio', folderName: 'Music', duration: 200, size: 1000, addedAt: 2000 }),
  };
  const stats = computeLibraryStats(metadata);
  assert.deepEqual(stats.count, { total: 3, video: 2, audio: 1 });
  assert.equal(stats.totalDurationSeconds, 1100);
  assert.equal(stats.totalSizeBytes, 9000);
  assert.deepEqual(stats.byFolder.map((f) => f.folderName).sort(), ['Movies', 'Music']);
  assert.deepEqual(stats.byChannel, [{ channelUrl: 'https://www.youtube.com/@chan', count: 1, totalDurationSeconds: 600, totalSizeBytes: 5000 }]);
  assert.equal(stats.byType.video.count, 2);
  assert.equal(stats.byType.audio.count, 1);
  assert.equal(stats.longest.id, 'v1');
  assert.equal(stats.shortest.id, 'a1');
  assert.equal(stats.newest.id, 'v2');
  assert.deepEqual(stats.mostWatched.map((i) => i.id), ['v1']);
});

test('computeLibraryStats: an empty library returns zeroed counts and null/empty records, never throws', () => {
  const stats = computeLibraryStats({});
  assert.deepEqual(stats.count, { total: 0, video: 0, audio: 0 });
  assert.equal(stats.totalDurationSeconds, 0);
  assert.equal(stats.totalSizeBytes, 0);
  assert.deepEqual(stats.byFolder, []);
  assert.deepEqual(stats.byChannel, []);
  assert.equal(stats.longest, null);
  assert.equal(stats.shortest, null);
  assert.equal(stats.newest, null);
  assert.deepEqual(stats.mostWatched, []);
});

test('computeLibraryStats: a missing/malformed metadata argument fails safe instead of throwing', () => {
  assert.doesNotThrow(() => computeLibraryStats(undefined));
  assert.doesNotThrow(() => computeLibraryStats(null));
  assert.equal(computeLibraryStats(null).count.total, 0);
});

// ---- v1.44.3: library inventory (namespace counts) --------------------------

test('computeInventory: counts each namespace (objects by key count, arrays by length)', () => {
  const inv = computeInventory({
    metadata: { a: {}, b: {}, c: {} },
    progress: { a: 1, b: 2 },
    viewCounts: { a: 5 },
    liked: ['x', 'y', 'z', 'w'],          // db.liked is an ARRAY
    folders: ['/media/a', '/media/b'],
    books: { items: { b1: {}, b2: {} }, progress: { b1: {} }, audio: { b1: {} } },
    music: { tracks: { t1: {}, t2: {}, t3: {} }, folders: ['/music'] },
    users: 2,
  });
  assert.deepStrictEqual(inv, {
    videos: 3,
    watchProgress: 2,
    viewCounts: 1,
    liked: 4,
    deleteTombstones: 0,
    scanFolders: 2,
    books: { items: 2, progress: 1, narrationAudio: 1 },
    music: { tracks: 3, folders: 1 },
    users: 2,
  });
});

test('computeInventory: tolerant of missing/malformed input (all zeros, never throws)', () => {
  const inv = computeInventory();
  assert.deepStrictEqual(inv, {
    videos: 0, watchProgress: 0, viewCounts: 0, liked: 0, deleteTombstones: 0, scanFolders: 0,
    books: { items: 0, progress: 0, narrationAudio: 0 },
    music: { tracks: 0, folders: 0 },
    users: 0,
  });
  // A non-integer `users` (e.g. accidentally passed the object) falls back to a size count.
  assert.strictEqual(computeInventory({ users: { u1: {}, u2: {} } }).users, 2);
  assert.strictEqual(computeInventory({ metadata: 'nope', liked: 42 }).videos, 0);
});
