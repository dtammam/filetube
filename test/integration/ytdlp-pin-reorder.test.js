'use strict';

// [INTEGRATION] v1.24.3 -- the HTTP surface for the pinned-channel
// drag-and-drop reorder (`POST /api/subscriptions/pins/reorder`), the
// pinned-channel mirror of v1.24.0 B4's `POST /api/subscriptions/reorder`
// (see test/integration/ytdlp-reorder-poll-timing.test.js, the template this
// file mirrors). Registered inside the SAME `isEnabled` gate as every other
// subscriptions/pins route -- disabled-module no-op is asserted here too.
// Also re-asserts the pin-store's HARD `db.folders`/`db.folderSettings`
// invariant (mirrors test/integration/ytdlp-pins.test.js's own regression
// test) across a reorder specifically, since this is a NEW mutator path into
// `db.ytdlp.pins`.
//
// Uses a fresh `express()` app per test (the same same-process pattern
// established in ytdlp-repull-endpoints.test.js / ytdlp-reorder-poll-timing.
// test.js) rather than booting the real server.js.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const store = require('../../lib/ytdlp/store');
const args = require('../../lib/ytdlp/args');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-pin-reorder-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// v1.43 (chunk 4b): pins are PER-USER -- the routes read/write through
// `deps.userChannelPins` (server.js bridges it to user_channel_pins rows).
// The fake mirrors that backend with an in-memory per-user map; the fake
// TEST_UID matches the req.user the harness middleware injects below.
const TEST_UID = 1;
function makeFakeDeps(initialDb = {}) {
  let db = initialDb;
  const userPins = new Map();
  return {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
    userChannelPins: {
      list: (uid) => (userPins.get(uid) || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)),
      replace: (uid, pins) => { userPins.set(uid, pins); },
    },
  };
}

// Seed a pin the way the POST route does: the pure reducer against the
// user's current list, persisted through the per-user backend.
function seedPin(deps, { channelDir, label }) {
  const result = store.reduceAddPin(deps.userChannelPins.list(TEST_UID), {
    id: deps.getMediaId(channelDir), channelDir, label, pinnedAt: new Date().toISOString(),
  });
  deps.userChannelPins.replace(TEST_UID, result.pins);
  return result.record;
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
  // v1.43: the real app's auth gate sets req.user before any route runs;
  // this standalone harness injects the same shape (the pin routes key
  // their per-user reads/writes on req.user.id).
  app.use((req, res, next) => { req.user = { id: TEST_UID, role: 'admin' }; next(); });
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

test('POST /api/subscriptions/pins/reorder persists the new order and returns the reordered, order-sorted list', async () => {
  const deps = makeFakeDeps();
  const pinA = seedPin(deps, { channelDir: path.join(tmpDir, 'Chan A'), label: 'Chan A' });
  const pinB = seedPin(deps, { channelDir: path.join(tmpDir, 'Chan B'), label: 'Chan B' });
  const pinC = seedPin(deps, { channelDir: path.join(tmpDir, 'Chan C'), label: 'Chan C' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/subscriptions/pins/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: [pinC.id, pinA.id, pinB.id] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.map((p) => p.id), [pinC.id, pinA.id, pinB.id], 'the response must reflect the new order');

    // Persisted: a fresh GET /api/subscriptions/pins reflects the SAME order.
    const listRes = await (await fetch(`${base}/api/subscriptions/pins`)).json();
    assert.deepEqual(listRes.map((p) => p.id), [pinC.id, pinA.id, pinB.id], 'the new order must be persisted, not just echoed');
  } finally {
    await close();
  }
});

test('POST /api/subscriptions/pins/reorder with a non-array orderedIds returns 400 and never touches persisted order', async () => {
  const deps = makeFakeDeps();
  const pinA = seedPin(deps, { channelDir: path.join(tmpDir, 'Orig A'), label: 'Orig A' });
  const pinB = seedPin(deps, { channelDir: path.join(tmpDir, 'Orig B'), label: 'Orig B' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/subscriptions/pins/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: 'not-an-array' }),
    });
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error);

    const listRes = await (await fetch(`${base}/api/subscriptions/pins`)).json();
    assert.deepEqual(listRes.map((p) => p.id), [pinA.id, pinB.id], 'a rejected request must never persist any reorder');
  } finally {
    await close();
  }
});

test('POST /api/subscriptions/pins/reorder tolerates unknown ids -- ignores them, never errors (store contract passthrough)', async () => {
  const deps = makeFakeDeps();
  const pinA = seedPin(deps, { channelDir: path.join(tmpDir, 'Tol A'), label: 'Tol A' });
  const pinB = seedPin(deps, { channelDir: path.join(tmpDir, 'Tol B'), label: 'Tol B' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/subscriptions/pins/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: [pinB.id, 'no-such-pin-id', pinA.id] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.map((p) => p.id), [pinB.id, pinA.id]);
  } finally {
    await close();
  }
});

test('POST /api/subscriptions/pins/reorder response is enriched with each pin\'s captured channelAvatarUrl, exactly like GET /api/subscriptions/pins', async () => {
  const deps = makeFakeDeps();
  const name = 'Reorder Avatar Channel';
  const channelUrl = 'https://www.youtube.com/@reorderavatarchannel';
  await store.addSubscription(deps, { channelUrl, name });
  await store.recordSubscriptionChannelAvatar(deps, channelUrl, 'https://yt3.ggpht.com/reorder-avatar.jpg');

  const channelDir = args.resolveChannelDir({ downloadDir: tmpDir }, { name });
  const pinA = seedPin(deps, { channelDir, label: name });
  const pinB = seedPin(deps, { channelDir: path.join(tmpDir, 'No Avatar Chan'), label: 'No Avatar Chan' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/subscriptions/pins/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: [pinB.id, pinA.id] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    const matched = body.find((p) => p.id === pinA.id);
    assert.equal(
      matched.channelAvatarUrl,
      'https://yt3.ggpht.com/reorder-avatar.jpg',
      'the reorder response must carry the SAME read-time avatar enrichment GET /api/subscriptions/pins applies',
    );
    const unmatched = body.find((p) => p.id === pinB.id);
    assert.ok(!('channelAvatarUrl' in unmatched), 'a pin with no matching subscription must be byte-identical -- no channelAvatarUrl key added');
  } finally {
    await close();
  }
});

test('REGRESSION: db.folders/db.folderSettings stay empty across a pin reorder (structural invariant)', async () => {
  const deps = makeFakeDeps({ folders: ['/movies'], folderSettings: { '/movies': { name: 'Movies' } } });
  const pinA = seedPin(deps, { channelDir: path.join(tmpDir, 'Invariant A'), label: 'Invariant A' });
  const pinB = seedPin(deps, { channelDir: path.join(tmpDir, 'Invariant B'), label: 'Invariant B' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/subscriptions/pins/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: [pinB.id, pinA.id] }),
    });
    assert.equal(res.status, 200);

    const db = deps.loadDatabase();
    assert.deepEqual(db.folders, ['/movies'], 'db.folders must be byte-identical -- a pin reorder never touches it');
    assert.deepEqual(db.folderSettings, { '/movies': { name: 'Movies' } }, 'db.folderSettings must be byte-identical -- a pin reorder never touches it');
  } finally {
    await close();
  }
});

test('disabled-module no-op preserved: POST /api/subscriptions/pins/reorder 404s when the module is disabled', async () => {
  const deps = makeFakeDeps();
  const { base, close } = await startTestApp(deps, disabledConfig());
  try {
    const res = await fetch(`${base}/api/subscriptions/pins/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: ['a', 'b'] }),
    });
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});
