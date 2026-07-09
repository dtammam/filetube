'use strict';

// [INTEGRATION] v1.24.0 T8 -- the HTTP surface for B4 (`POST
// /api/subscriptions/reorder`) and A4 (poll-timing fields additively surfaced
// on `GET /api/subscriptions/settings` and `GET /api/subscriptions/status`).
// Registered inside the SAME `isEnabled` gate as every other subscriptions
// route -- disabled-module no-op is asserted here too (all new surface must
// 404 when the module is off). Uses a fresh `express()` app per test (the
// same same-process pattern established in ytdlp-repull-endpoints.test.js)
// rather than booting the real server.js.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const store = require('../../lib/ytdlp/store');
const activity = require('../../lib/ytdlp/activity');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-reorder-'));
  activity.resetForTests();
});

afterEach(() => {
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

function disabledConfig(overrides = {}) {
  return ytdlp.parseYtdlpConfig({
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

// ---- B4: POST /api/subscriptions/reorder -----------------------------------

test('POST /api/subscriptions/reorder persists the new order and returns the reordered, enriched list', async () => {
  const deps = makeFakeDeps();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  const subB = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanB', format: 'video' });
  const subC = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanC', format: 'video' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/subscriptions/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: [subC.id, subA.id, subB.id] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.map((s) => s.id), [subC.id, subA.id, subB.id], 'the response must reflect the new order');

    // Persisted: a fresh GET /api/subscriptions reflects the SAME order.
    const listRes = await (await fetch(`${base}/api/subscriptions`)).json();
    assert.deepEqual(listRes.map((s) => s.id), [subC.id, subA.id, subB.id], 'the new order must be persisted, not just echoed');
  } finally {
    await close();
  }
});

test('POST /api/subscriptions/reorder with a non-array orderedIds returns 400 and never touches persisted order', async () => {
  const deps = makeFakeDeps();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@origA', format: 'video' });
  const subB = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@origB', format: 'video' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/subscriptions/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: 'not-an-array' }),
    });
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error);

    const listRes = await (await fetch(`${base}/api/subscriptions`)).json();
    assert.deepEqual(listRes.map((s) => s.id), [subA.id, subB.id], 'a rejected request must never persist any reorder');
  } finally {
    await close();
  }
});

test('POST /api/subscriptions/reorder tolerates unknown ids -- ignores them, never errors (B4 store contract passthrough)', async () => {
  const deps = makeFakeDeps();
  const subA = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@tolA', format: 'video' });
  const subB = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@tolB', format: 'video' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/subscriptions/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: [subB.id, 'no-such-id', subA.id] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.map((s) => s.id), [subB.id, subA.id]);
  } finally {
    await close();
  }
});

// ---- A4: poll-timing fields on GET /api/subscriptions/settings + /status --

test('GET /api/subscriptions/settings surfaces the currently-armed pollMinutes additively, without changing the POST response shape', async () => {
  const deps = makeFakeDeps();
  const { base, close } = await startTestApp(deps, enabledConfig({ FILETUBE_YTDLP_POLL_MINUTES: '45' }));
  try {
    const getRes = await (await fetch(`${base}/api/subscriptions/settings`)).json();
    assert.equal(getRes.allowMembersOnly, false);
    assert.equal(getRes.pollMinutes, 45);

    // POST response shape is UNCHANGED (still exactly { allowMembersOnly }) --
    // regression lock against a shape drift that could break an existing
    // client expectation.
    const postRes = await fetch(`${base}/api/subscriptions/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowMembersOnly: true }),
    });
    assert.deepEqual(await postRes.json(), { allowMembersOnly: true });
  } finally {
    await close();
  }
});

test('GET /api/subscriptions/status surfaces lastCheckedAt + nextPollDue per subscription, reusing the armed interval (A4, no new persistence)', async () => {
  const deps = makeFakeDeps();
  const pollMinutes = 30;
  const config = enabledConfig({ FILETUBE_YTDLP_POLL_MINUTES: String(pollMinutes) });
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@polltiming', format: 'video' });
  const lastCheckedAt = '2026-07-09T00:00:00.000Z';
  await store.setSubscriptionStatus(deps, sub.id, { lastCheckedAt, lastStatus: 'ok' });

  const { base, close } = await startTestApp(deps, config);
  try {
    const snap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(snap.subscriptions[sub.id].lastCheckedAt, lastCheckedAt);
    assert.equal(snap.subscriptions[sub.id].nextPollDue, Date.parse(lastCheckedAt) + pollMinutes * 60 * 1000);
  } finally {
    await close();
  }
});

test('GET /api/subscriptions/status: a never-checked subscription (lastCheckedAt null) gets nextPollDue null', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@neverchecked', format: 'video' });

  const { base, close } = await startTestApp(deps, enabledConfig({ FILETUBE_YTDLP_POLL_MINUTES: '30' }));
  try {
    const snap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(snap.subscriptions[sub.id].lastCheckedAt, null);
    assert.equal(snap.subscriptions[sub.id].nextPollDue, null);
  } finally {
    await close();
  }
});

test('GET /api/subscriptions/status: manual-only polling (pollMinutes=0) always yields nextPollDue null, even for a checked subscription', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@manualonly', format: 'video' });
  await store.setSubscriptionStatus(deps, sub.id, { lastCheckedAt: new Date().toISOString(), lastStatus: 'ok' });

  const { base, close } = await startTestApp(deps, enabledConfig({ FILETUBE_YTDLP_POLL_MINUTES: '0' }));
  try {
    const snap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(snap.subscriptions[sub.id].nextPollDue, null);
  } finally {
    await close();
  }
});

test('GET /api/subscriptions/status: poll-timing fields do not clobber an in-flight live entry\'s state/percent/title', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@liveplusfields', format: 'video' });
  await store.setSubscriptionStatus(deps, sub.id, { lastCheckedAt: '2026-07-08T00:00:00.000Z', lastStatus: 'ok' });
  activity.setSubscription(sub.id, { state: 'downloading', percent: 55, title: 'Some Title' });

  const { base, close } = await startTestApp(deps, enabledConfig({ FILETUBE_YTDLP_POLL_MINUTES: '10' }));
  try {
    const snap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    const entry = snap.subscriptions[sub.id];
    assert.equal(entry.state, 'downloading');
    assert.equal(entry.percent, 55);
    assert.equal(entry.title, 'Some Title');
    assert.equal(entry.lastCheckedAt, '2026-07-08T00:00:00.000Z');
    assert.equal(entry.nextPollDue, Date.parse('2026-07-08T00:00:00.000Z') + 10 * 60 * 1000);
  } finally {
    await close();
  }
});

// ---- disabled-module no-op (mandatory: every T8 route/field is gated) -----

test('T8 disabled no-op: POST /api/subscriptions/reorder 404s when the module is disabled', async () => {
  const deps = makeFakeDeps();
  const { base, close } = await startTestApp(deps, disabledConfig());
  try {
    const res = await fetch(`${base}/api/subscriptions/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: ['a', 'b'] }),
    });
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});

test('T8 disabled no-op: GET /api/subscriptions/settings and /status (with the new A4 fields) 404 when the module is disabled', async () => {
  const deps = makeFakeDeps();
  const { base, close } = await startTestApp(deps, disabledConfig());
  try {
    const settingsRes = await fetch(`${base}/api/subscriptions/settings`);
    assert.equal(settingsRes.status, 404);

    const statusRes = await fetch(`${base}/api/subscriptions/status`);
    assert.equal(statusRes.status, 404);
  } finally {
    await close();
  }
});
