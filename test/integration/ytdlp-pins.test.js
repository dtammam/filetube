'use strict';

// [INTEGRATION] v1.21.0 FR-5 (T5, TWO-REVIEWER GATE -- data-safety/
// folders-config invariant): a pinned channel playlist persists via a NEW,
// SEPARATE `db.ytdlp.pins` store -- never `db.folders`/`db.folderSettings`.
// Covers AC33-AC39/AC69:
//   - POST a pin -> GET returns it (round-trip persistence, AC34/AC37).
//   - DELETE removes it (AC37).
//   - A POST with a channelDir OUTSIDE `config.downloadDir` is rejected
//     (400), never persisted (the confinement security gate).
//   - REGRESSION (mirrors the v1.20 FR-4 db.folders-invariant test,
//     test/integration/ytdlp-channel-dir-playlist.test.js): db.folders/
//     db.folderSettings stay empty across a full pin add/list/remove cycle,
//     AND `POST /api/config` leaves `db.ytdlp.pins` completely untouched
//     (AC38).
//   - All 3 routes 404 when the module is disabled (AC69) -- also covered
//     more broadly in ytdlp-disabled-noop.test.js; re-asserted here
//     alongside the rest of this feature's own test suite for locality.
//
// Isolated DATA_DIR before requiring the app, per the existing pattern
// (test/integration/ytdlp-channel-dir-playlist.test.js).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0'; // manual-only: no real timer during tests
// registerRoutes's `config` default (lib/ytdlp/index.js) is captured ONCE,
// at server.js's own require-time call to `ytdlp.registerRoutes(app, ...)` --
// so FILETUBE_YTDLP_DOWNLOAD_DIR must be set BEFORE requiring server.js
// (below), not inside `before()`, for the pin routes' confinement check to
// resolve against THIS test's download dir.
const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pins-'));
process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { app, loadDatabase, updateDatabase, getMediaId } = require('../../server');
const ytdlp = require('../../lib/ytdlp');
const store = require('../../lib/ytdlp/store');
const args = require('../../lib/ytdlp/args');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  fs.rmSync(downloadDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await updateDatabase((db) => { db.folders = []; db.folderSettings = {}; db.ytdlp = undefined; return true; });
});

test('POST a pin -> GET /api/subscriptions/pins returns it', async () => {
  const channelDir = path.join(downloadDir, 'Test Channel');
  const addRes = await fetch(`${base}/api/subscriptions/pins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelDir, label: 'Test Channel' }),
  });
  assert.equal(addRes.status, 201);
  const created = await addRes.json();
  assert.equal(created.channelDir, path.resolve(channelDir));
  assert.equal(created.label, 'Test Channel');
  assert.equal(typeof created.id, 'string');
  assert.equal(typeof created.pinnedAt, 'string');

  const listRes = await fetch(`${base}/api/subscriptions/pins`);
  assert.equal(listRes.status, 200);
  const list = await listRes.json();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], created);
});

test('DELETE removes a pin; a repeat DELETE 404s', async () => {
  const channelDir = path.join(downloadDir, 'Delete Me');
  const addRes = await fetch(`${base}/api/subscriptions/pins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelDir, label: 'Delete Me' }),
  });
  const created = await addRes.json();

  const delRes = await fetch(`${base}/api/subscriptions/pins/${created.id}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);
  assert.deepEqual(await delRes.json(), { success: true });

  const listRes = await fetch(`${base}/api/subscriptions/pins`);
  assert.deepEqual(await listRes.json(), []);

  const secondDelRes = await fetch(`${base}/api/subscriptions/pins/${created.id}`, { method: 'DELETE' });
  assert.equal(secondDelRes.status, 404);
});

test('a POST with a channelDir OUTSIDE downloadDir is rejected (400), never persisted', async () => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-outside-'));
  try {
    const res = await fetch(`${base}/api/subscriptions/pins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelDir: outsideDir, label: 'Hostile' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);

    const listRes = await fetch(`${base}/api/subscriptions/pins`);
    assert.deepEqual(await listRes.json(), [], 'a rejected pin must never be persisted');
  } finally {
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('a POST with a traversal-shaped channelDir that RESOLVES outside downloadDir is also rejected', async () => {
  const res = await fetch(`${base}/api/subscriptions/pins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelDir: path.join(downloadDir, '..', '..', 'etc', 'passwd'), label: 'Traversal' }),
  });
  assert.equal(res.status, 400);
  const listRes = await fetch(`${base}/api/subscriptions/pins`);
  assert.deepEqual(await listRes.json(), []);
});

test('a POST with a missing/blank label is rejected (400)', async () => {
  const channelDir = path.join(downloadDir, 'No Label');
  const res = await fetch(`${base}/api/subscriptions/pins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelDir }),
  });
  assert.equal(res.status, 400);
});

test('REGRESSION (mirrors the v1.20 FR-4 db.folders-invariant test): db.folders/db.folderSettings stay empty across a full pin add/list/remove cycle', async () => {
  const channelDir = path.join(downloadDir, 'Invariant Channel');
  const addRes = await fetch(`${base}/api/subscriptions/pins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelDir, label: 'Invariant Channel' }),
  });
  const created = await addRes.json();

  await fetch(`${base}/api/subscriptions/pins`);
  await fetch(`${base}/api/subscriptions/pins`);

  const midway = loadDatabase();
  assert.deepEqual(midway.folders || [], [], 'db.folders must remain empty -- a pin is never written there');
  assert.deepEqual(midway.folderSettings || {}, {}, 'db.folderSettings must remain empty -- a pin is never written there');

  await fetch(`${base}/api/subscriptions/pins/${created.id}`, { method: 'DELETE' });

  const after1 = loadDatabase();
  assert.deepEqual(after1.folders || [], []);
  assert.deepEqual(after1.folderSettings || {}, {});
});

test('AC38 REGRESSION (mirrors the v1.20 FR-4 invariant test): POST /api/config never reads, writes, or prunes db.ytdlp.pins', async () => {
  const channelDir = path.join(downloadDir, 'Survives Config Save');
  const addRes = await fetch(`${base}/api/subscriptions/pins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelDir, label: 'Survives Config Save' }),
  });
  const created = await addRes.json();

  // A normal Settings-page save, submitting an EMPTY folders array (the
  // scenario that most aggressively prunes folderSettings) -- if pins were
  // ever accidentally routed through this handler's folderSettings-pruning
  // logic, this is exactly the save that would silently drop them.
  const configRes = await fetch(`${base}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folders: [], folderSettings: {} }),
  });
  assert.equal(configRes.status, 200);

  const listRes = await fetch(`${base}/api/subscriptions/pins`);
  const list = await listRes.json();
  assert.equal(list.length, 1, 'the pin must survive a POST /api/config save untouched');
  assert.deepEqual(list[0], created);

  const persisted = loadDatabase();
  assert.deepEqual(persisted.folders || [], [], 'the pin\'s channelDir must never leak into db.folders via a config save');
  assert.deepEqual(persisted.folderSettings || {}, {}, 'the pin must never leak into db.folderSettings via a config save');

  await fetch(`${base}/api/subscriptions/pins/${created.id}`, { method: 'DELETE' });
});

// v1.24 C6 (render hop): GET /api/subscriptions/pins enriches each pin AT READ
// TIME with the captured `channelAvatarUrl` from the matching SUBSCRIPTION
// record (matched by resolved channelDir) -- a pin itself never stores an
// avatar. This is the last hop that makes a captured channel avatar actually
// show as the sidebar/playlists folder icon (C6's MANUAL AC).
test('C6 render hop: a pin is enriched with its matching subscription\'s captured channelAvatarUrl', async () => {
  const deps = { updateDatabase, getMediaId };
  const name = 'Avatar Pin Channel';
  const channelUrl = 'https://www.youtube.com/@avatarpinchannel';
  await store.addSubscription(deps, { channelUrl, name });
  await store.recordSubscriptionChannelAvatar(deps, channelUrl, 'https://yt3.ggpht.com/pin-avatar.jpg');

  // Pin the SAME channelDir the subscription resolves to (the route matches on it).
  const channelDir = args.resolveChannelDir({ downloadDir }, { name });
  const addRes = await fetch(`${base}/api/subscriptions/pins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelDir, label: name }),
  });
  assert.equal(addRes.status, 201);

  const list = await (await fetch(`${base}/api/subscriptions/pins`)).json();
  assert.equal(list.length, 1);
  assert.equal(
    list[0].channelAvatarUrl,
    'https://yt3.ggpht.com/pin-avatar.jpg',
    'C6: the pin must be enriched at read time with the matching subscription\'s captured avatar',
  );
});

test('C6 render hop: a pin with NO matching subscription is returned unchanged (no channelAvatarUrl key)', async () => {
  const channelDir = path.join(downloadDir, 'Unmatched Pin');
  const created = await (await fetch(`${base}/api/subscriptions/pins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelDir, label: 'Unmatched Pin' }),
  })).json();

  const list = await (await fetch(`${base}/api/subscriptions/pins`)).json();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], created, 'a pin with no matching subscription must be byte-identical -- no channelAvatarUrl key added');
  assert.ok(!('channelAvatarUrl' in list[0]));
});

test('C6 render hop: a corrupted subscription avatar failing re-validation is NOT surfaced onto the pin', async () => {
  const name = 'Hostile Pin Channel';
  const channelUrl = 'https://www.youtube.com/@hostilepinchannel';
  // Bypass recordSubscriptionChannelAvatar's own sanitizer to plant a hostile persisted value.
  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.subscriptions.push({ id: 'hostile-pin-sub', channelUrl, name, channelAvatarUrl: 'javascript:alert(1)' });
    return true;
  });

  const channelDir = args.resolveChannelDir({ downloadDir }, { name });
  await fetch(`${base}/api/subscriptions/pins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelDir, label: name }),
  });

  const list = await (await fetch(`${base}/api/subscriptions/pins`)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].channelAvatarUrl, undefined, 'a hostile persisted avatar must never be surfaced into the pins response (re-validated at read)');
});

// v1.25.x QoL bugfix: when the matched subscription's OWN channelAvatarUrl
// is empty, the pin enrichment now falls back to the channelId-keyed
// REGISTRY before giving up -- so a channel whose avatar was only ever
// captured under a DIFFERENT identity (e.g. an item downloaded before this
// subscription existed) still renders as the pin's icon.
test('C6 render hop (registry fallback): a matched subscription with NO avatar of its own still gets one via the channelId registry', async () => {
  const deps = { updateDatabase, getMediaId };
  const name = 'Registry Fallback Pin Channel';
  const channelUrl = 'https://www.youtube.com/@registryfallbackpin';
  await store.addSubscription(deps, { channelUrl, name });

  const channelId = 'UCregistryfallbackpinxxx';
  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    const sub = ns.subscriptions.find((s) => s.channelUrl === channelUrl);
    sub.channelId = channelId; // the sub knows its own channelId but has no channelAvatarUrl of its own
    ns.channelAvatars[channelId] = { avatarUrl: 'https://yt3.ggpht.com/registry-only.jpg', fetchedAt: Date.now() };
    return true;
  });

  const channelDir = args.resolveChannelDir({ downloadDir }, { name });
  const addRes = await fetch(`${base}/api/subscriptions/pins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelDir, label: name }),
  });
  assert.equal(addRes.status, 201);

  const list = await (await fetch(`${base}/api/subscriptions/pins`)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].channelAvatarUrl, 'https://yt3.ggpht.com/registry-only.jpg', 'the registry must be read through when the sub itself has no channelAvatarUrl');
});

test('disabled-module no-op preserved: all 3 pin routes 404 when the module is disabled', async () => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  try {
    const disabledConfig = ytdlp.parseYtdlpConfig(process.env);
    const throwawayApp = express();
    ytdlp.registerRoutes(throwawayApp, {}, disabledConfig);
    const throwawayServer = await new Promise((resolve) => {
      const s = throwawayApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const listRes = await fetch(`http://127.0.0.1:${throwawayServer.address().port}/api/subscriptions/pins`);
      assert.equal(listRes.status, 404);
      const postRes = await fetch(`http://127.0.0.1:${throwawayServer.address().port}/api/subscriptions/pins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelDir: path.join(downloadDir, 'x'), label: 'x' }),
      });
      assert.equal(postRes.status, 404);
      const delRes = await fetch(`http://127.0.0.1:${throwawayServer.address().port}/api/subscriptions/pins/some-id`, { method: 'DELETE' });
      assert.equal(delRes.status, 404);
    } finally {
      throwawayServer.closeAllConnections?.();
      await new Promise((resolve) => throwawayServer.close(resolve));
    }
  } finally {
    process.env.FILETUBE_YTDLP_ENABLED = 'true';
  }
});
