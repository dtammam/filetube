'use strict';

// [INTEGRATION] The T4 HTTP surface: `POST /api/subscriptions/repull`
// (re-pull-all) and `POST /api/subscriptions/:id/repull` (re-pull-one),
// registered by `registerRoutes` inside the same `isEnabled` gate as every
// other subscriptions route (AC 15-16, 33), plus `startBackground`'s
// `db.folders` registration (AC 17). `run.runList`/`run.runDownload` are
// mocked -- no real yt-dlp binary or network is ever touched. Uses a fresh
// `express()` app per test (the same same-process pattern already
// established in ytdlp-disabled-noop.test.js) rather than booting the real
// server.js, so this file needs no DATA_DIR isolation dance.

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

// ---- AC17: db.folders registration on enable -------------------------------

test('startBackground registers the download dir into db.folders (idempotently) and creates it on disk', async () => {
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
    // ensureDownloadDirRegistered's updateDatabase call is fire-and-forget
    // from startBackground's perspective -- give it a tick to land.
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(fs.existsSync(downloadDir), true, 'the download directory must be created on disk');
    assert.ok(db.folders.includes(downloadDir), 'the download dir must be registered into db.folders');
    assert.ok(db.folders.includes('/existing/media'), 'an existing folder must not be clobbered');

    // Calling it again must be idempotent -- no duplicate entry, no extra
    // meaningful write.
    const callsBefore = updateDatabaseCalls.length;
    ytdlp.startBackground(deps, config);
    await new Promise((resolve) => setImmediate(resolve));
    const occurrences = db.folders.filter((f) => f === downloadDir).length;
    assert.equal(occurrences, 1, 'the download dir must never be registered twice');
    assert.ok(updateDatabaseCalls.length >= callsBefore);
  } finally {
    ytdlp.armYtdlpTimer(ytdlp.parseYtdlpConfig({})); // clear the timer this armed
  }
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
