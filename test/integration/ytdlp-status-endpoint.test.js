'use strict';

// [INTEGRATION] T3/FR-E: `GET /api/subscriptions/status` -- the dedicated
// polling endpoint the `/subscriptions` UI hits every ~2.5s, returning
// `activity.getSnapshot()` verbatim. `run.runList`/`run.runDownload` are
// mocked -- no real yt-dlp binary or network is ever touched.

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
const activity = require('../../lib/ytdlp/activity');

const originalRunList = run.runList;
const originalRunDownload = run.runDownload;

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-status-'));
  activity.resetForTests();
});

afterEach(() => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  ytdlp.resetPollRerunStateForTests();
  activity.resetForTests();
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

// ---- AC28/30: reflects an in-flight download's state, distinct from -------
// lastStatus, and terminal states are exposed too -----------------------------

test('GET /api/subscriptions/status reflects an in-flight download live (state/title/index/total/percent), distinct from lastStatus', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@livestatus', format: 'video' });

  let resolveDownload;
  run.runList = async () => ({
    ok: true,
    stdout: JSON.stringify({ id: 'vid1', extractor_key: 'Youtube', availability: 'public' }),
    stderr: '',
  });
  run.runDownload = (subArg, config, targetIds, opts) => new Promise((resolve) => {
    // Simulate a real yt-dlp progress patch arriving mid-download.
    opts.onProgress({ state: 'downloading', percent: 42.5, title: 'Some Title' });
    resolveDownload = () => resolve({ ok: true, code: 0, stdout: '', stderr: '' });
  });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const pollPromise = ytdlp.runPoll(deps, enabledConfig());
    // Give the poll a moment to reach the in-flight downloading state.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const midRes = await fetch(`${base}/api/subscriptions/status`);
    assert.equal(midRes.status, 200);
    const midSnap = await midRes.json();
    assert.equal(midSnap.subscriptions[sub.id].state, 'downloading');
    assert.equal(midSnap.subscriptions[sub.id].percent, 42.5);
    assert.equal(midSnap.subscriptions[sub.id].title, 'Some Title');

    // The persisted lastStatus (terminal-summary, distinct field) is still
    // null at this point -- the poll hasn't finished yet.
    const listMid = await (await fetch(`${base}/api/subscriptions`)).json();
    assert.equal(listMid[0].lastStatus, null, 'the durable lastStatus must remain untouched mid-poll (a distinct field from the live status, AC28)');

    resolveDownload();
    await pollPromise;

    const doneRes = await fetch(`${base}/api/subscriptions/status`);
    const doneSnap = await doneRes.json();
    assert.equal(doneSnap.subscriptions[sub.id].state, 'done', 'terminal state must be reflected once the poll cycle completes (AC30)');
  } finally {
    await close();
  }
});

// ---- AC31/NFR3: no cookies path leakage in the status snapshot ------------

test('GET /api/subscriptions/status never surfaces a cookies path, even for an error entry', async () => {
  const cookiesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(cookiesDir, 'cookies.txt');
  fs.writeFileSync(cookiesFile, 'session=abc123');
  const deps = makeFakeDeps();
  const config = enabledConfig({ FILETUBE_YTDLP_COOKIES_FILE: cookiesFile });
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@cookieleak', format: 'video' });

  run.runList = async () => ({
    ok: false,
    code: 1,
    stdout: '',
    stderr: '',
    error: `Command failed: yt-dlp --cookies ${cookiesFile} -- https://www.youtube.com/@cookieleak`,
  });

  const { base, close } = await startTestApp(deps, config);
  try {
    await ytdlp.runPoll(deps, config);
    const res = await fetch(`${base}/api/subscriptions/status`);
    const snap = await res.json();
    assert.ok(!JSON.stringify(snap).includes(cookiesFile), `cookies path leaked into the status snapshot: ${JSON.stringify(snap)}`);
  } finally {
    fs.rmSync(cookiesDir, { recursive: true, force: true });
    await close();
  }
});

// ---- clearSubscription: a deleted subscription drops out of the snapshot --

test('deleting a subscription clears its live entry from the status snapshot', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@deleteme', format: 'video' });
  activity.setSubscription(sub.id, { state: 'downloading', percent: 10 });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const before = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.ok(before.subscriptions[sub.id]);

    const delRes = await fetch(`${base}/api/subscriptions/${sub.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);

    const after = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(after.subscriptions[sub.id], undefined, 'a deleted subscription must never reappear in the live status snapshot');
  } finally {
    await close();
  }
});

// ---- an empty snapshot when nothing is happening ---------------------------

test('GET /api/subscriptions/status returns empty namespaces when nothing has run yet', async () => {
  const deps = makeFakeDeps();
  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/subscriptions/status`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { subscriptions: {}, oneShots: {} });
  } finally {
    await close();
  }
});
