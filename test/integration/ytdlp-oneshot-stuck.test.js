'use strict';

// [INTEGRATION] v1.34 T7 (Dean's stuck-"running" one-shot) -- the four fixes:
//   1. the post-download channel-meta persist is TIME-BOUNDED: a wedged
//      updateDatabase can no longer block the terminal 'done' write (the
//      stuck-forever root cause) nor wedge the shared FIFO gate
//   2. cancelling a CHILDLESS non-terminal entry works (no more
//      "may have already finished" dead end)
//   3. a job cancelled while QUEUED never spawns when dequeued
//   4. the stale-'downloading' watchdog sweep flips a wedged entry to a
//      terminal error
// Same express + fake-deps harness as ytdlp-repull-metadata-endpoint.test.js.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const ytdlp = require('../../lib/ytdlp');
const run = require('../../lib/ytdlp/run');
const activity = require('../../lib/ytdlp/activity');

const originalRunDownload = run.runDownload;

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-oneshot-stuck-'));
  activity.resetForTests();
});

afterEach(() => {
  run.runDownload = originalRunDownload;
  ytdlp.setOneShotPersistTimeoutForTests(null); // restore the 30s default
  activity.resetForTests();
  ytdlp.armYtdlpTimer(ytdlp.parseYtdlpConfig({}));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeFakeDeps(overrides = {}) {
  return {
    loadDatabase: () => ({ metadata: {}, ytdlp: {} }),
    updateDatabase: (fn) => Promise.resolve(fn({ metadata: {}, ytdlp: { subscriptions: [], downloadMeta: {}, pins: [] } })),
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
    dataDir: tmpDir,
    ...overrides,
  };
}

function enabledConfig() {
  return ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'true',
    FILETUBE_YTDLP_POLL_MINUTES: '0',
    FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir,
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

function flush(ms = 30) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollOneShotState(base, jobId, wanted, deadlineMs = 5000) {
  const startedAt = Date.now();
  for (;;) {
    const res = await fetch(`${base}/api/subscriptions/status`);
    const body = await res.json();
    const entry = body.oneShots && body.oneShots[jobId];
    if (entry && entry.state === wanted) return entry;
    if (Date.now() - startedAt > deadlineMs) return entry;
    await flush(25);
  }
}

test('a WEDGED channel-meta persist can no longer stick the entry at downloading -- the bounded persist lets the done write land', async () => {
  ytdlp.setOneShotPersistTimeoutForTests(150);
  // The download itself "succeeds" and captures channel meta, but the deps'
  // updateDatabase NEVER SETTLES for the meta write -- the pre-v1.34 wedge.
  run.runDownload = async () => ({
    ok: true, code: 0,
    channelMeta: [{ videoId: 'dQw4w9WgXcQ', channel_url: 'https://www.youtube.com/@x' }],
    failures: [],
  });
  const deps = makeFakeDeps({
    updateDatabase: () => new Promise(() => {}), // wedged forever
  });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const post = await fetch(`${base}/api/ytdlp/download`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
    });
    assert.equal(post.status, 202);
    const { jobId } = await post.json();

    const entry = await pollOneShotState(base, jobId, 'done');
    assert.ok(entry, 'entry must exist');
    assert.equal(entry.state, 'done',
      'the terminal write must land despite the wedged persist (bounded by the persist timeout)');
  } finally {
    await close();
  }
});

test('cancelling a CHILDLESS non-terminal entry clears it (no more "may have already finished" dead end); terminal/unknown ids still 404', async () => {
  const deps = makeFakeDeps();
  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    // Seed a stuck-looking entry directly: 'downloading', no live child --
    // exactly the pre-v1.34 wedge's observable state.
    activity.setOneShot('stuck-job-1', { state: 'downloading', label: 'Stuck video' });

    const cancel = await fetch(`${base}/api/ytdlp/download/stuck-job-1/cancel`, { method: 'POST' });
    assert.equal(cancel.status, 200, 'a childless non-terminal entry must be cancellable');
    const body = await cancel.json();
    assert.equal(body.cancelled, true);

    const entry = await pollOneShotState(base, 'stuck-job-1', 'cancelled');
    assert.equal(entry.state, 'cancelled', 'the entry leaves the active set and TTL-prunes like any terminal entry');

    // Terminal entry -> honest 404 (nothing to cancel).
    const again = await fetch(`${base}/api/ytdlp/download/stuck-job-1/cancel`, { method: 'POST' });
    assert.equal(again.status, 404);
    // Unknown id -> 404, unchanged.
    const unknown = await fetch(`${base}/api/ytdlp/download/never-existed/cancel`, { method: 'POST' });
    assert.equal(unknown.status, 404);
  } finally {
    await close();
  }
});

test('a job cancelled while QUEUED never spawns: the worker checks the latch as its first act', async () => {
  // Track spawns PER VIDEO -- job 1's own (legitimate) spawn must not trip
  // the assertion about job 2.
  const spawnedIds = [];
  // A slow first job holds the FIFO gate so the second job sits queued long
  // enough to cancel it.
  let releaseFirst;
  const firstGateHeld = new Promise((resolve) => { releaseFirst = resolve; });
  let firstStarted;
  const firstStartedP = new Promise((resolve) => { firstStarted = resolve; });
  run.runDownload = async (sub, config, videoIds) => {
    spawnedIds.push(videoIds && videoIds[0]);
    if (videoIds && videoIds[0] === 'aaaaaaaaaaa') {
      firstStarted();
      await firstGateHeld;
    }
    return { ok: true, code: 0, channelMeta: [], failures: [] };
  };

  const deps = makeFakeDeps();
  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const first = await fetch(`${base}/api/ytdlp/download`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }),
    });
    const firstJob = (await first.json()).jobId;
    await firstStartedP; // the gate is now held by job 1

    const second = await fetch(`${base}/api/ytdlp/download`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' }),
    });
    const secondJob = (await second.json()).jobId;

    // Cancel the QUEUED job (childless -> the new honest-cancel path).
    const cancel = await fetch(`${base}/api/ytdlp/download/${secondJob}/cancel`, { method: 'POST' });
    assert.equal(cancel.status, 200);

    releaseFirst(); // job 1 finishes; the gate dequeues job 2
    await pollOneShotState(base, firstJob, 'done');
    await flush(100); // give job 2's worker its turn on the gate

    assert.ok(!spawnedIds.includes('bbbbbbbbbbb'), 'the cancelled-while-queued job must never spawn yt-dlp');
    const entry = (await (await fetch(`${base}/api/subscriptions/status`)).json()).oneShots[secondJob];
    assert.equal(entry.state, 'cancelled');
  } finally {
    await close();
  }
});

test('the stale-downloading watchdog flips a wedged childless entry to a terminal error on the status poll', async () => {
  const deps = makeFakeDeps();
  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    activity.setOneShot('wedged-old', { state: 'downloading', label: 'Wedged long ago' });
    // Direct sweep call with a synthetic "now" far past the threshold -- the
    // route runs the same function on every poll with the real clock.
    ytdlp.sweepStuckOneShots(Date.now() + ytdlp.ONESHOT_STUCK_SWEEP_MS + 1000);

    const res = await fetch(`${base}/api/subscriptions/status`);
    const entry = (await res.json()).oneShots['wedged-old'];
    assert.equal(entry.state, 'error', 'the watchdog must flip a stale childless downloading entry to error');
    assert.match(entry.error || '', /watchdog/i);

    // A FRESH childless 'downloading' entry (the normal brief post-download
    // window) is NOT swept.
    activity.setOneShot('fresh-window', { state: 'downloading', label: 'Just finished its spawn' });
    ytdlp.sweepStuckOneShots(Date.now());
    const fresh = (await (await fetch(`${base}/api/subscriptions/status`)).json()).oneShots['fresh-window'];
    assert.equal(fresh.state, 'downloading', 'a fresh childless window must be left alone');
  } finally {
    await close();
  }
});
