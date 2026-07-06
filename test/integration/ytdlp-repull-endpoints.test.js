'use strict';

// [INTEGRATION] The T4 HTTP surface: `POST /api/subscriptions/repull`
// (re-pull-all) and `POST /api/subscriptions/:id/repull` (re-pull-one),
// registered by `registerRoutes` inside the same `isEnabled` gate as every
// other subscriptions route (AC 15-16, 33), plus `startBackground`'s
// download-directory creation and the module-owned `extraScanRoots` scan-root
// mechanism (AC 17, C3+C7 T4 fix round -- `startBackground` no longer writes
// `db.folders` at all; see the `extraScanRoots` tests below and
// server.js's `runScanDirectories` (currentFolders merge) for the
// replacement). `run.runList`/`run.runDownload` are mocked -- no real
// yt-dlp binary or network is ever touched. Uses a fresh `express()` app per
// test (the same same-process pattern already established in
// ytdlp-disabled-noop.test.js) rather than booting the real server.js, so
// this file needs no DATA_DIR isolation dance.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const run = require('../../lib/ytdlp/run');
const store = require('../../lib/ytdlp/store');

const originalRunList = run.runList;
const originalRunDownload = run.runDownload;

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-repull-'));
});

afterEach(() => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  ytdlp.armYtdlpTimer(ytdlp.parseYtdlpConfig({})); // clear any armed timer between tests
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeFakeDeps(initialDb = {}) {
  let db = initialDb;
  return {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
  };
}

function enabledConfig(overrides = {}) {
  return ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'true',
    FILETUBE_YTDLP_POLL_MINUTES: '0',
    FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir,
    ...overrides,
  });
}

async function startTestApp(deps, config) {
  const app = express();
  app.use(express.json());
  ytdlp.registerRoutes(app, deps, config);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test('POST /api/subscriptions/repull accepts immediately (202) and polls every subscription in the background', async () => {
  const deps = makeFakeDeps();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanB', format: 'video' });

  let listCalls = 0;
  let resolveList;
  run.runList = () => new Promise((resolve) => {
    listCalls += 1;
    resolveList = resolveList || (() => {});
    resolve({ ok: true, stdout: '', stderr: '' });
  });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/subscriptions/repull`, { method: 'POST' });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { accepted: true });

    // Give the fire-and-forget poll a moment to actually run against both subs.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(listCalls, 2, 'both subscriptions should have been polled');
  } finally {
    await close();
  }
});

test('POST /api/subscriptions/:id/repull polls only that one subscription (202), unknown id -> 404 (AC33)', async () => {
  const deps = makeFakeDeps();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanB', format: 'video' });

  const polled = [];
  run.runList = async (sub) => {
    polled.push(sub.id);
    return { ok: true, stdout: '', stderr: '' };
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const okRes = await fetch(`${base}/api/subscriptions/${subA.id}/repull`, { method: 'POST' });
    assert.equal(okRes.status, 202);

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(polled, [subA.id], 'only the targeted subscription should have been polled');

    const notFoundRes = await fetch(`${base}/api/subscriptions/no-such-id/repull`, { method: 'POST' });
    assert.equal(notFoundRes.status, 404);
    assert.ok((await notFoundRes.json()).error);
  } finally {
    await close();
  }
});

// ---- AC17 / C3+C7: module-owned scan root on enable, NEVER db.folders -----

test('startBackground creates the download directory on disk but NEVER touches db.folders (C3+C7: module-owned scan root)', async () => {
  const downloadDir = path.join(tmpDir, 'downloads-subdir');
  const config = enabledConfig({ FILETUBE_YTDLP_DOWNLOAD_DIR: downloadDir });
  let db = { folders: ['/existing/media'] };
  const updateDatabaseCalls = [];
  const deps = {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => {
      updateDatabaseCalls.push(1);
      const result = mutatorFn(db);
      return Promise.resolve(result);
    },
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
  };

  try {
    ytdlp.startBackground(deps, config);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(fs.existsSync(downloadDir), true, 'the download directory must be created on disk');
    assert.deepEqual(db.folders, ['/existing/media'], 'db.folders must never be written to by startBackground (C3+C7)');
    assert.deepEqual(updateDatabaseCalls, [], 'startBackground must never call updateDatabase at all');

    // Calling it again must remain a no-op with respect to db.folders/updateDatabase.
    ytdlp.startBackground(deps, config);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(db.folders, ['/existing/media']);
    assert.deepEqual(updateDatabaseCalls, []);

    // The module-owned scan root mechanism (extraScanRoots) is what the
    // scanner merges instead -- proven independently here.
    assert.deepEqual(ytdlp.extraScanRoots(config), [path.resolve(downloadDir)]);
  } finally {
    ytdlp.armYtdlpTimer(ytdlp.parseYtdlpConfig({})); // clear the timer this armed
  }
});

// D1 (T4 fix round #2): extraScanRoots gates on fs.existsSync(downloadDir),
// NOT on config.enabled. These two cases were previously a single test
// asserting "disabled -> []" unconditionally -- that wording no longer holds
// when the directory happens to exist (see the D1-preserved case below,
// which is the actual acceptance-critical behavior change).

test('D1: extraScanRoots returns [] when disabled AND the download dir does not exist on disk (fresh-install/never-enabled case)', () => {
  const neverCreatedDir = path.join(tmpDir, 'never-created-subdir');
  const disabledConfig = ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_DOWNLOAD_DIR: neverCreatedDir });
  assert.equal(fs.existsSync(neverCreatedDir), false, 'sanity: this case requires the dir to be absent');
  assert.deepEqual(ytdlp.extraScanRoots(disabledConfig), []);
});

test('D1: extraScanRoots STILL returns the resolved dir when disabled but the dir EXISTS on disk (was-enabled-then-disabled-with-content case)', () => {
  const existingDir = fs.mkdtempSync(path.join(tmpDir, 'already-exists-'));
  const disabledConfig = ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_DOWNLOAD_DIR: existingDir });
  assert.deepEqual(
    ytdlp.extraScanRoots(disabledConfig),
    [path.resolve(existingDir)],
    'a disabled module must still contribute a download dir that exists with content -- disabling must never destroy it (Dean\'s D1 decision)',
  );
});

test('startBackground never touches db.folders or creates a directory when disabled', async () => {
  const downloadDir = path.join(tmpDir, 'should-not-exist');
  const disabledConfig = ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_DOWNLOAD_DIR: downloadDir });
  let db = { folders: [] };
  const calls = [];
  const deps = {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => {
      calls.push(1);
      return Promise.resolve(mutatorFn(db));
    },
    scanDirectories: async () => {},
    getMediaId: (input) => input,
  };

  ytdlp.startBackground(deps, disabledConfig);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, []);
  assert.equal(fs.existsSync(downloadDir), false);
  assert.equal(ytdlp.currentYtdlpPollTimer(), null);
});

// ---- D2: migrateStaleDownloadDirFromFolders (deterministic, fake deps) -----

test('D2: migrateStaleDownloadDirFromFolders removes a matching downloadDir entry from db.folders and leaves the rest alone', async () => {
  const downloadDir = path.join(tmpDir, 'stale-download-dir');
  const config = ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_DOWNLOAD_DIR: downloadDir });
  let db = { folders: ['/existing/media', downloadDir, '/another/kept/folder'] };
  const deps = {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
  };

  await ytdlp.migrateStaleDownloadDirFromFolders(deps, config);

  assert.deepEqual(db.folders, ['/existing/media', '/another/kept/folder'], 'only the stale downloadDir entry must be removed');
});

test('D2: migrateStaleDownloadDirFromFolders never calls updateDatabase when db.folders has no matching entry (clean db.json stays untouched)', async () => {
  const downloadDir = path.join(tmpDir, 'stale-download-dir-2');
  const config = ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_DOWNLOAD_DIR: downloadDir });
  let db = { folders: ['/existing/media'] };
  const updateDatabaseCalls = [];
  const deps = {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => {
      updateDatabaseCalls.push(1);
      return Promise.resolve(mutatorFn(db));
    },
  };

  await ytdlp.migrateStaleDownloadDirFromFolders(deps, config);

  assert.deepEqual(updateDatabaseCalls, [], 'a clean db.json must never take the updateDatabase lock');
  assert.deepEqual(db.folders, ['/existing/media']);
});

test('D2: migrateStaleDownloadDirFromFolders is idempotent -- a second call after the entry is gone is a no-op', async () => {
  const downloadDir = path.join(tmpDir, 'stale-download-dir-3');
  const config = ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_DOWNLOAD_DIR: downloadDir });
  let db = { folders: [downloadDir] };
  const updateDatabaseCalls = [];
  const deps = {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => {
      updateDatabaseCalls.push(1);
      return Promise.resolve(mutatorFn(db));
    },
  };

  await ytdlp.migrateStaleDownloadDirFromFolders(deps, config);
  assert.deepEqual(db.folders, []);
  assert.equal(updateDatabaseCalls.length, 1);

  await ytdlp.migrateStaleDownloadDirFromFolders(deps, config);
  assert.deepEqual(db.folders, [], 'still empty after the second call');
  assert.equal(updateDatabaseCalls.length, 1, 'the second call must never re-enter updateDatabase -- nothing left to migrate');
});

test('F2: migrateStaleDownloadDirFromFolders never throws when deps.updateDatabase throws SYNCHRONOUSLY', async () => {
  const downloadDir = path.join(tmpDir, 'stale-download-dir-4');
  const config = ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_DOWNLOAD_DIR: downloadDir });
  const db = { folders: [downloadDir] };
  const deps = {
    loadDatabase: () => db,
    // A synchronous throw thrown during the CALL ITSELF (not a rejected
    // promise it returns) -- e.g. a real `updateDatabase` throwing while
    // acquiring its lock before it ever gets to returning a promise. The
    // documented contract is "never throws; log and try again next start",
    // so this must be caught and swallowed, not propagated.
    updateDatabase: () => {
      throw new Error('synchronous updateDatabase failure');
    },
  };

  // Must resolve (not reject/throw) despite the synchronous throw above.
  await assert.doesNotReject(ytdlp.migrateStaleDownloadDirFromFolders(deps, config));
  // The stale entry is still present -- the migration is safe to retry on
  // the next start, per the "try again next start" contract.
  assert.deepEqual(db.folders, [downloadDir]);
});

test('F2: startBackground never throws when migrateStaleDownloadDirFromFolders hits a synchronous updateDatabase throw', () => {
  const downloadDir = path.join(tmpDir, 'stale-download-dir-5');
  const config = ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_ENABLED: '1', FILETUBE_YTDLP_DOWNLOAD_DIR: downloadDir });
  const db = { folders: [downloadDir] };
  const deps = {
    loadDatabase: () => db,
    updateDatabase: () => {
      throw new Error('synchronous updateDatabase failure');
    },
  };

  // `startBackground` calls `migrateStaleDownloadDirFromFolders` unawaited
  // with no call-site `.catch` -- a synchronous throw escaping the migration
  // function would otherwise crash the startup path. Asserting the call
  // itself never throws is the regression test for that startup-crash risk.
  assert.doesNotThrow(() => ytdlp.startBackground(deps, config));
});
