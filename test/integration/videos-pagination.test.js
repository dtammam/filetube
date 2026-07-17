'use strict';

// [INTEGRATION] v1.30 A5 (T6): paginated `GET /api/videos` -- AC3.1 (bounded
// first page + correct total, against a 1300+-item fixture) and AC3.2
// (cross-window correctness: `page(sort, filter)` concatenated equals
// `sort(filter(full))` sliced; a search match on a deep "page 3" item is
// found at its offset; seeded `random` stays stable across sequential page
// fetches). See lib/videoQuery.js (the pure comparators/predicates this
// pipeline is built on) and test/unit/videoquery.test.js /
// videoquery-parity.test.js for the pure-function coverage this integration
// test complements. Isolated DATA_DIR before requiring the app, own process
// per file (node --test), mirroring test/integration/db-read-cache.test.js.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-videos-pagination-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base); // v1.43: auth through the real gate
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

// Builds `count` synthetic items with strictly increasing `addedAt` (index
// order), so the default 'newest' sort (addedAt descending) is a
// deterministic reverse-index order -- item i lands at position
// (count - 1 - i). Every 5th item (i % 5 === 0) is 'audio', the rest
// 'video', so format-filter totals are predictable too. Each call fully
// REPLACES the db (via `saveDatabase`, the established test-seeding
// primitive -- see CONTRIBUTING.md), so tests never leak fixtures into one
// another despite sharing one DATA_DIR/process.
function buildFixture(count) {
  const metadata = {};
  for (let i = 0; i < count; i++) {
    const id = `vid${i}`;
    metadata[id] = {
      id,
      title: `Video ${i}`,
      type: i % 5 === 0 ? 'audio' : 'video',
      ext: i % 5 === 0 ? '.m4a' : '.mp4',
      folderName: `Folder${i % 7}`,
      rootFolder: `/media/Folder${i % 7}`,
      filePath: `/media/Folder${i % 7}/vid${i}.mp4`,
      artist: '',
      size: 1000 + i,
      addedAt: 1700000000000 + i,
    };
  }
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, metadata });
  return metadata;
}

async function getVideos(qs) {
  const res = await fetch(`${base}/api/videos${qs ? `?${qs}` : ''}`);
  return { status: res.status, body: await res.json() };
}

// ---- AC3.1 -------------------------------------------------------------

test('AC3.1: first-page request against a 1300+-item fixture returns a bounded page + correct total, well within the latency ceiling', async () => {
  const FIXTURE_SIZE = 1300;
  buildFixture(FIXTURE_SIZE);

  const start = Date.now();
  const { status, body } = await getVideos();
  const elapsedMs = Date.now() - start;

  assert.equal(status, 200);
  assert.equal(body.items.length, 60, 'default page size is 60');
  assert.equal(body.total, FIXTURE_SIZE, 'total reflects the full filtered library, not just the page');
  assert.equal(body.offset, 0);
  assert.equal(body.limit, 60);
  // Design proposes <=150ms for the mechanism (bounded, in-memory sort+
  // slice, no per-request parse -- getCachedDatabase() is already warm).
  // CI-relaxed here per this suite's existing convention (see
  // test/integration/scan-cooperative.test.js's own rationale comment) to
  // avoid flaking on slower CI/dev hardware while still proving the request
  // is nowhere near an O(request-count) or unbounded-payload cost.
  assert.ok(elapsedMs < 1000, `first-page request took ${elapsedMs}ms, expected well under 1000ms`);
});

test('AC3.1: response payload is bounded to the requested page, not the full library', async () => {
  buildFixture(200);
  const { body } = await getVideos('limit=25&offset=0');
  assert.equal(body.items.length, 25);
  assert.equal(body.total, 200);
});

// ---- AC3.2: windowing + cross-window correctness -------------------------

test('AC3.2 (windowing): sequential pages concatenated equal the full unpaged, sorted list, in the same order', async () => {
  buildFixture(130);
  const pageSize = 40;
  const pages = [];
  for (let offset = 0; offset < 130; offset += pageSize) {
    const { body } = await getVideos(`sort=title-asc&limit=${pageSize}&offset=${offset}`);
    pages.push(...body.items);
  }
  const full = await getVideos('sort=title-asc&limit=200&offset=0');
  assert.deepEqual(
    pages.map((i) => i.id),
    full.body.items.map((i) => i.id),
    'concatenated pages must equal the full sorted list, in the same order (item at the end of one page must sort correctly relative to the start of the next)'
  );
});

test('AC3.2 (cross-window search match): an item findable only on a later page (within the FILTERED result set) is returned once that offset is requested', async () => {
  // Half the fixture (every even index) matches the search term -- a
  // realistic "narrows but doesn't collapse to one result" filter, unlike
  // an unrealistically-unique title that would trivially always land on
  // page 0 of a 1-item filtered set. addedAt increases with `i`, so under
  // the default 'newest' (addedAt descending) sort the matching items are
  // ordered i=158, 156, ..., 10, ..., 0 -- vid10 (i=10) is the 75th matching
  // item (0-indexed position 74 of 80 total matches), past the first page.
  const count = 160;
  const metadata = {};
  for (let i = 0; i < count; i++) {
    const id = `vid${i}`;
    const matches = i % 2 === 0;
    metadata[id] = {
      id,
      title: matches ? `Video ${i} matchclip` : `Video ${i}`,
      type: 'video', ext: '.mp4', folderName: 'F', rootFolder: '/media/F',
      filePath: `/media/F/${id}.mp4`, artist: '', size: 1000 + i,
      addedAt: 1700000000000 + i,
    };
  }
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, metadata });

  const page0 = await getVideos('search=matchclip&sort=newest&limit=40&offset=0');
  assert.equal(page0.body.total, 80, 'sanity: the search narrows the library to the 80 matching items');
  assert.ok(!page0.body.items.some((i) => i.id === 'vid10'), 'sanity: the match is not on page 0 under this sort');

  const laterPage = await getVideos('search=matchclip&sort=newest&limit=40&offset=40');
  assert.ok(
    laterPage.body.items.some((i) => i.id === 'vid10'),
    'the searched item must be found once its containing page (offset 40, within the filtered 80-item result set) is requested'
  );
});

test('AC3.2 (seeded random stability): the same seed reproduces the identical page-by-page order across separate request sequences', async () => {
  buildFixture(100);
  const seed = 777;
  const pageSize = 30;

  async function fetchAllPagesWithSeed() {
    const ids = [];
    for (let offset = 0; offset < 100; offset += pageSize) {
      const { body } = await getVideos(`sort=random&seed=${seed}&limit=${pageSize}&offset=${offset}`);
      ids.push(...body.items.map((i) => i.id));
    }
    return ids;
  }

  const runA = await fetchAllPagesWithSeed();
  const runB = await fetchAllPagesWithSeed();

  assert.deepEqual(runA, runB, 'the same seed must reproduce the identical page-by-page order across separate request sequences');
  assert.equal(new Set(runA).size, 100, 'every item must appear exactly once across the seeded pages -- no drops, no dupes');
});

test('AC3.2 (seeded random cross-check): a different seed generally produces a different order', async () => {
  buildFixture(100);
  const a = await getVideos('sort=random&seed=1&limit=100&offset=0');
  const b = await getVideos('sort=random&seed=2&limit=100&offset=0');
  assert.notDeepEqual(a.body.items.map((i) => i.id), b.body.items.map((i) => i.id));
});

// ---- format filter runs server-side, before pagination ---------------------

test('format filter is applied server-side, and `total` reflects the FILTERED count (not the full library)', async () => {
  buildFixture(50); // i % 5 === 0 -> 10 audio items, 40 video items
  const { body } = await getVideos('format=audio&limit=100');
  assert.equal(body.total, 10);
  assert.ok(body.items.every((i) => i.type === 'audio'));
  assert.equal(body.items.length, 10);
});

// ---- defensive parameter validation ----------------------------------------

test('a garbage limit/offset/seed never 500s -- falls back to sane defaults', async () => {
  buildFixture(10);
  const { status, body } = await getVideos('limit=not-a-number&offset=not-a-number&seed=not-a-number&sort=random');
  assert.equal(status, 200);
  assert.equal(body.offset, 0);
  assert.equal(body.limit, 60);
  assert.equal(body.items.length, 10);
});

test('a negative offset falls back to 0; an offset past the end of the (filtered) list returns an empty page with a correct total', async () => {
  buildFixture(10);
  const negative = await getVideos('offset=-5');
  assert.equal(negative.body.offset, 0);

  const pastEnd = await getVideos('offset=1000&limit=10');
  assert.equal(pastEnd.status, 200);
  assert.deepEqual(pastEnd.body.items, []);
  assert.equal(pastEnd.body.total, 10);
});
