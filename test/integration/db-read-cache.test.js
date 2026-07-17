'use strict';

// [INTEGRATION] v1.30 A3 (T4): the in-memory DB read cache
// (`getCachedDatabase()`) + invalidate-on-save contract. Isolated DATA_DIR
// before requiring the app so the suite never reads or writes real project
// data -- own process per file (node --test), mirroring
// test/integration/settings-cache-api.test.js.
//
// Coverage:
//  - AC3.3 (headline): N sequential GET /thumbnail/:id against an unchanged
//    db invoke the load/parse function O(1) (1 population, 0 thereafter),
//    not N -- via the `__getLoadDatabaseCallCount()` accessor.
//  - No stale read after a write: a real mutation (POST /api/config) is
//    visible on the very next GET, proving the cache is invalidated/
//    refreshed on save, not just populated once forever.
//  - Read coherency: a couple of the switched hot routes still return the
//    exact payloads a fresh disk read would produce (regression guard).
//  - Lost-update / mutate-in-place guards: the two coherency fixes T4 made
//    to keep pre-existing in-place-mutation patterns (healStaleAudioReady,
//    the ytdlp avatar lookup's ensureYtdlp backfill) from corrupting the
//    SHARED cache object now that these routes read through it.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-db-cache-'));
const DATA_DIR = process.env.DATA_DIR;
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app,
  saveDatabase,
  getCachedDatabase,
  __getLoadDatabaseCallCount,
  setAudioStatus,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

function baseSettings(overrides) {
  return {
    scanIntervalMinutes: 30,
    pruneMissing: true,
    cacheMaxBytes: null,
    cacheMaxAgeDays: 30,
    defaultView: '',
    autoplayNext: false,
    backgroundAudioForVideo: false,
    ...overrides,
  };
}

// v1.30 A3 (in-memory DB read cache): seed via the exported `saveDatabase()`
// (an established test primitive, see CONTRIBUTING.md) rather than a raw
// `fs.writeFileSync`, so the in-process db cache stays coherent.
function writeDb(db) {
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings(), ...db });
}

let server;
let base;

before(async () => {
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
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

// ---- AC3.3 (headline): O(1) loads across N requests, not N ----------------

// This MUST be the first test in the file: it relies on this process's
// module-level db cache still being COLD (dbCacheValid === false,
// loadDatabaseCallCount === 0) -- the exact "population" scenario the
// mechanism describes. Nothing before this point (the `before()` hook only
// calls `app.listen`) ever reads the db, so that invariant holds as long as
// no earlier test in this file touches a db route first.
test('AC3.3: N sequential GET /thumbnail/:id against an unchanged DB invoke loadDatabase O(1) (1 population, 0 thereafter), not N', async () => {
  const startCount = __getLoadDatabaseCallCount();
  assert.equal(startCount, 0, 'sanity: this must run before anything else in the file touches the db');

  const N = 5;
  for (let i = 0; i < N; i++) {
    // Unknown id -> 200 SVG placeholder branch; still exercises the db read
    // (`db.metadata[req.params.id]` lookup) on every single request.
    const res = await fetch(`${base}/thumbnail/does-not-exist`);
    assert.equal(res.status, 200);
  }

  const endCount = __getLoadDatabaseCallCount();
  assert.equal(
    endCount - startCount, 1,
    `${N} sequential /thumbnail/:id requests must invoke the load/parse function exactly ONCE (population), not once per request`
  );
});

test('AC3.3 continued: further requests after the cache is warm invoke loadDatabase zero additional times', async () => {
  const startCount = __getLoadDatabaseCallCount();
  assert.ok(startCount > 0, 'the cache should already be warm from the previous test');

  for (let i = 0; i < 10; i++) {
    const res = await fetch(`${base}/thumbnail/does-not-exist`);
    assert.equal(res.status, 200);
  }
  // Also exercise a couple of the OTHER switched hot routes -- all of them
  // must be reading the same warm cache, not each paying their own load.
  await fetch(`${base}/api/videos`);
  await fetch(`${base}/api/config`);
  await fetch(`${base}/api/scan-status`);

  assert.equal(
    __getLoadDatabaseCallCount(), startCount,
    'no additional loadDatabase calls once the cache is warm, across multiple different hot routes'
  );
});

// ---- No stale read after a write -------------------------------------------

test('no stale read: a POST /api/config write is visible on the very next GET /api/config (cache invalidated/refreshed on save)', async () => {
  writeDb({});

  const before1 = await fetch(`${base}/api/config`);
  const beforeJson = await before1.json();
  assert.deepEqual(beforeJson.folders, [], 'starts with no folders');

  const newFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cache-folder-'));
  const post = await fetch(`${base}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folders: [newFolder], folderSettings: {} }),
  });
  assert.equal(post.status, 200);

  const after1 = await fetch(`${base}/api/config`);
  const afterJson = await after1.json();
  assert.deepEqual(afterJson.folders, [newFolder], 'the write must be visible on the very next read, not stale');
});

test('no stale read: a DELETE /api/videos/:id write is visible on the very next GET /api/videos (cache invalidated/refreshed on save)', async () => {
  writeDb({
    metadata: {
      delMe: {
        id: 'delMe', title: 'Clip', type: 'video', ext: '.mp4',
        folderName: 'x', size: 10, addedAt: Date.now(), filePath: path.join(DATA_DIR, 'nonexistent-delMe.mp4'),
      },
    },
  });

  const before1 = await fetch(`${base}/api/videos`);
  const { items: beforeList } = await before1.json();
  assert.ok(beforeList.some((i) => i.id === 'delMe'), 'seeded item is present before delete');

  const del = await fetch(`${base}/api/videos/delMe`, { method: 'DELETE' });
  assert.equal(del.status, 200);

  const after1 = await fetch(`${base}/api/videos`);
  const { items: afterList } = await after1.json();
  assert.ok(!afterList.some((i) => i.id === 'delMe'), 'the deleted item must be gone on the very next read, not stale');

  const single = await fetch(`${base}/api/videos/delMe`);
  assert.equal(single.status, 404, 'GET /api/videos/:id must also reflect the delete immediately');
});

// ---- Read coherency across switched hot routes (regression guard) ---------

test('read coherency: GET /api/videos, /api/videos/:id, and /thumbnail/:id all agree on the same seeded item via the cache', async () => {
  writeDb({
    metadata: {
      coh1: {
        id: 'coh1', title: 'Coherent Clip', type: 'video', ext: '.mp4',
        folderName: 'x', rootFolder: '/media/x', artist: '', size: 555,
        addedAt: 1712345678000,
      },
    },
  });

  const { items: list } = await (await fetch(`${base}/api/videos`)).json();
  const fromList = list.find((i) => i.id === 'coh1');
  assert.ok(fromList, 'present in the list route');
  assert.equal(fromList.title, 'Coherent Clip');

  const single = await (await fetch(`${base}/api/videos/coh1`)).json();
  assert.equal(single.title, 'Coherent Clip');
  assert.equal(single.size, 555);

  // No thumbnail on disk -> the SVG placeholder branch, but it still proves
  // the route resolved the SAME item via the cache (uses item.title/type).
  const thumb = await fetch(`${base}/thumbnail/coh1`);
  assert.equal(thumb.status, 200);
  assert.match(thumb.headers.get('content-type') || '', /image\/svg\+xml/);
});

// ---- Lost-update / mutate-in-place guards ----------------------------------

test('cache-coherency guard: GET /audio/:id healing a stale "ready" status never mutates the shared cache object in place', async () => {
  writeDb({
    metadata: {
      audHeal: {
        id: 'audHeal', title: 'Audio Heal Clip', type: 'video', ext: '.mp4',
        folderName: 'x', size: 10, addedAt: Date.now(),
        filePath: path.join(DATA_DIR, 'nonexistent-audHeal.mp4'),
        audioStatus: 'ready', // stale: no .m4a sidecar actually exists on disk
      },
    },
  });

  // Prime + capture a reference to the CURRENT cached object, mirroring what
  // a concurrent reader mid-request would be holding.
  const snapshotBeforeHeal = getCachedDatabase();
  assert.equal(snapshotBeforeHeal.metadata.audHeal.audioStatus, 'ready');

  const res = await fetch(`${base}/audio/audHeal`);
  // No sidecar on disk and no ffmpeg in the test environment -> a 503 either
  // way (ffmpeg-unavailable or extracting); either response path runs
  // healStaleAudioReady first. The exact status code isn't this test's
  // concern -- the coherency guarantee is.
  assert.equal(res.status, 503);

  // The PRIOR snapshot reference must be completely untouched -- if
  // healStaleAudioReady had mutated `item` in place (like it did before the
  // v1.30 A3 fix), this would now read 'pending' instead of 'ready'.
  assert.equal(
    snapshotBeforeHeal.metadata.audHeal.audioStatus, 'ready',
    'a reader holding a reference to a prior cache snapshot must never observe an in-place mutation'
  );

  // The heal is persisted via `setAudioStatus` -> `updateDatabase`,
  // fire-and-forget from the route's perspective -- await a same-id
  // round trip on the shared write chain to guarantee it has settled
  // (mirrors test/unit/background-audio-extract.test.js's own pattern).
  await setAudioStatus('audHeal', 'pending');

  const freshCache = getCachedDatabase();
  assert.equal(freshCache.metadata.audHeal.audioStatus, 'pending', 'the healed value IS visible once the write has settled');
  assert.notStrictEqual(
    freshCache, snapshotBeforeHeal,
    'the cache must be a NEW object (replaced by reference on write), never the same object mutated in place'
  );
});

test('cache-coherency guard: GET /api/videos/:id never lets the yt-dlp avatar lookup backfill db.ytdlp onto the shared cache', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  try {
    // Deliberately NO `ytdlp` namespace at all -- simulates a legacy db that
    // predates the yt-dlp module, or one where it has never been enabled
    // until now. `ensureYtdlp` (called internally by
    // `resolveItemChannelAvatarUrl`) would backfill `db.ytdlp` IN PLACE on
    // whatever object it's handed.
    writeDb({
      metadata: {
        avatarLookup: {
          id: 'avatarLookup', title: 'Needs Avatar Lookup', type: 'video', ext: '.mp4',
          folderName: 'x', size: 10, addedAt: Date.now(),
          channelUrl: 'https://www.youtube.com/channel/UC_example', // present, no channelAvatarUrl
        },
      },
    });

    assert.equal(getCachedDatabase().ytdlp, undefined, 'sanity: no ytdlp namespace before the request');

    const res = await fetch(`${base}/api/videos/avatarLookup`);
    assert.equal(res.status, 200);
    await res.json(); // drain -- response shape isn't this test's concern

    assert.equal(
      getCachedDatabase().ytdlp, undefined,
      'the shared cache must NOT have gained a db.ytdlp namespace as a side effect of the avatar lookup -- ' +
      'ensureYtdlp\'s in-place backfill must land on a throwaway clone, never the live cache reference'
    );
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
  }
});
