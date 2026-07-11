'use strict';

// [INTEGRATION] v1.20.0 FR-4 (T4, TWO-REVIEWER GATE -- re-proves the
// db.folders/folderSettings synthetic-root invariant): each subscribed
// channel's own confined download subfolder (`args.resolveChannelDir`) is
// surfaced as a `channelDir` field on `GET /api/subscriptions`, and a
// `root=<channelDir>` filter on the EXISTING `GET /api/videos` route confines
// to exactly that channel's own videos -- never another channel's, never the
// whole Downloads root, and NEVER by writing anything into `db.folders`/
// `folderSettings` (AC18-AC21).
//
// Isolated DATA_DIR before requiring the app, per the existing pattern
// (test/integration/ytdlp-synthetic-folder.test.js, ytdlp-crud.test.js).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0'; // manual-only: no real timer during tests
// registerRoutes's `config` default (lib/ytdlp/index.js) is captured ONCE,
// at server.js's own require-time call to `ytdlp.registerRoutes(app, ...)` --
// so FILETUBE_YTDLP_DOWNLOAD_DIR must be set BEFORE requiring server.js
// (below), not inside `before()`, for the enriched GET /api/subscriptions
// route to resolve `channelDir` against THIS test's download dir rather than
// the default `DATA_DIR/ytdlp-downloads` fallback.
const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-channeldir-'));
process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { app, scanDirectories, loadDatabase, updateDatabase } = require('../../server');
const ytdlp = require('../../lib/ytdlp');
const argsMod = require('../../lib/ytdlp/args');

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

test('AC18/AC19: GET /api/subscriptions includes a channelDir per subscription, matching args.resolveChannelDir', async () => {
  const addRes = await fetch(`${base}/api/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelUrl: 'https://www.youtube.com/@channeldirtest', format: 'video' }),
  });
  assert.equal(addRes.status, 201);
  const created = await addRes.json();

  const listRes = await fetch(`${base}/api/subscriptions`);
  const list = await listRes.json();
  assert.equal(list.length, 1);
  const sub = list[0];
  assert.equal(sub.id, created.id);

  const config = ytdlp.parseYtdlpConfig(process.env);
  assert.equal(sub.channelDir, argsMod.resolveChannelDir(config, sub));
  assert.ok(sub.channelDir.startsWith(path.resolve(downloadDir)), 'channelDir must be confined under the download root');

  const delRes = await fetch(`${base}/api/subscriptions/${created.id}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);
});

test('AC21: channelDir resolution failure omits the field rather than 500ing the whole route', async () => {
  // A subscription with a name that sanitizes to something still valid can't
  // easily be made to fail confinement through the public API (the sanitizer
  // already strips traversal characters) -- so this proves the SAME
  // enrichment used by the live route degrades gracefully via the exported
  // pure helper, complementing the direct unit-test coverage of the throwing
  // branch (test/unit/ytdlp-channel-dir-enrichment.test.js).
  const { enrichSubscriptionWithChannelDir } = ytdlp;
  const brokenConfig = { downloadDir: undefined, cookiesFile: null };
  const enriched = enrichSubscriptionWithChannelDir(brokenConfig, { id: 'x', name: 'X' });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(enriched, 'channelDir'), false);
});

test('AC20: a root=<channelDir> filter on GET /api/videos surfaces only that channel\'s own confined subfolder, never another channel\'s videos or the whole Downloads root', async () => {
  const config = ytdlp.parseYtdlpConfig(process.env);

  const subA = { id: 'a', name: 'Channel A', channelUrl: 'https://www.youtube.com/@a' };
  const subB = { id: 'b', name: 'Channel B', channelUrl: 'https://www.youtube.com/@b' };
  const dirA = argsMod.resolveChannelDir(config, subA);
  const dirB = argsMod.resolveChannelDir(config, subB);
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });
  fs.writeFileSync(path.join(dirA, 'Video A.mp4'), 'not a real video');
  fs.writeFileSync(path.join(dirB, 'Video B.mp4'), 'not a real video');

  try {
    await scanDirectories();

    // v1.30 A5 (T6): `/api/videos` returns `{ items, total, offset, limit }`.
    const { items: rootAResults } = await (await fetch(`${base}/api/videos?root=${encodeURIComponent(dirA)}`)).json();
    assert.ok(rootAResults.length >= 1, 'channel A\'s own subfolder must surface at least its own video');
    assert.ok(rootAResults.every((v) => v.filePath.startsWith(dirA)), 'every result under root=dirA must actually live under dirA');
    assert.ok(!rootAResults.some((v) => v.filePath.startsWith(dirB)), 'channel A\'s playlist must never include channel B\'s videos');

    const { items: rootBResults } = await (await fetch(`${base}/api/videos?root=${encodeURIComponent(dirB)}`)).json();
    assert.ok(rootBResults.every((v) => v.filePath.startsWith(dirB)));
    assert.ok(!rootBResults.some((v) => v.filePath.startsWith(dirA)), 'channel B\'s playlist must never include channel A\'s videos');
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

test('AC21 (regression lock): adding/listing subscriptions with resolved channelDirs never writes db.folders/folderSettings', async () => {
  const addRes = await fetch(`${base}/api/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelUrl: 'https://www.youtube.com/@invariantcheck', format: 'video' }),
  });
  assert.equal(addRes.status, 201);
  const created = await addRes.json();

  // Exercise the enriched GET (the code path under gate) several times.
  await fetch(`${base}/api/subscriptions`);
  await fetch(`${base}/api/subscriptions`);

  const persisted = loadDatabase();
  assert.deepEqual(persisted.folders || [], [], 'db.folders must remain empty -- no per-channel Playlist entry is ever written there');
  assert.deepEqual(persisted.folderSettings || {}, {}, 'folderSettings must remain empty -- channelDir is display-only, never persisted as a managed/scanned folder');

  const delRes = await fetch(`${base}/api/subscriptions/${created.id}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);
});

test('disabled-module no-op preserved: GET /api/subscriptions still 404s (native) when the module is disabled, unaffected by the channelDir enrichment', async () => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  try {
    const disabledConfig = ytdlp.parseYtdlpConfig(process.env);
    // Registering routes against a disabled config on a throwaway app proves
    // the enrichment code is unreachable when disabled -- registerRoutes'
    // first line early-returns before the enriched /api/subscriptions route
    // is ever added.
    const throwawayApp = express();
    ytdlp.registerRoutes(throwawayApp, {}, disabledConfig);
    const throwawayServer = await new Promise((resolve) => {
      const s = throwawayApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const res = await fetch(`http://127.0.0.1:${throwawayServer.address().port}/api/subscriptions`);
      assert.equal(res.status, 404, 'GET /api/subscriptions must 404 (Express native) when the module is disabled');
    } finally {
      throwawayServer.closeAllConnections?.();
      await new Promise((resolve) => throwawayServer.close(resolve));
    }
  } finally {
    process.env.FILETUBE_YTDLP_ENABLED = 'true';
  }
});
