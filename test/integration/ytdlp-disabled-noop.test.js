'use strict';

// [INTEGRATION] The acceptance north star for the optional yt-dlp module
// (v1.11.0): when disabled (the default), FileTube behaves byte-identically
// to today. Proves, in ONE process:
//   - AC1: every /api/subscriptions* path 404s when disabled.
//   - AC2: currentYtdlpPollTimer() reports null/not-armed when disabled.
//   - AC4: require('../../lib/ytdlp') has no side effects (no route added to
//     a bare express() app, no timer armed, just by requiring).
//   - AC8: the SAME process can flip the config on and off and observe both
//     the route and the timer toggle accordingly (not just two separate runs).
//
// Isolated DATA_DIR before requiring the app, per the existing integration-
// test pattern (test/integration/api.test.js, scan-api.test.js).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
// The master flag must be unset/off for the "disabled by default" half of
// this proof -- delete any inherited value so the test is deterministic
// regardless of the shell environment it runs under.
delete process.env.FILETUBE_YTDLP_ENABLED;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { app, currentYtdlpPollTimer } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const { readPersistedDatabase } = require('../../lib/db/sqlite');
const ytdlp = require('../../lib/ytdlp');

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
  // fetch (undici) pools keep-alive sockets; force them shut so close()
  // resolves promptly instead of waiting on idle connections (avoids CI hangs).
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

// ---- Disabled path is a no-op (AC1, AC2) ----

test('GET /api/subscriptions/health 404s when the module is disabled', async () => {
  const res = await fetch(`${base}/api/subscriptions/health`);
  assert.equal(res.status, 404);
});

test('any other /api/subscriptions* path 404s when the module is disabled', async () => {
  const list = await fetch(`${base}/api/subscriptions`);
  assert.equal(list.status, 404);
  const byId = await fetch(`${base}/api/subscriptions/some-id`);
  assert.equal(byId.status, 404);
});

// T2's CRUD + settings routes are registered inside the same `isEnabled`
// gate as `/health` above, so they must be equally absent when disabled.
test('T2 CRUD + settings routes 404 when the module is disabled', async () => {
  const getList = await fetch(`${base}/api/subscriptions`);
  assert.equal(getList.status, 404);

  const post = await fetch(`${base}/api/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelUrl: 'https://www.youtube.com/@x', format: 'video' }),
  });
  assert.equal(post.status, 404);

  const del = await fetch(`${base}/api/subscriptions/some-id`, { method: 'DELETE' });
  assert.equal(del.status, 404);

  const getSettings = await fetch(`${base}/api/subscriptions/settings`);
  assert.equal(getSettings.status, 404);

  const postSettings = await fetch(`${base}/api/subscriptions/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowMembersOnly: true }),
  });
  assert.equal(postSettings.status, 404);
});

test('disabled path never writes a db.ytdlp namespace', () => {
  // v1.42: read the persisted store via the sanctioned independent
  // connection. Nothing persisted at all yields {} -- equally fine.
  const raw = readPersistedDatabase(process.env.DATA_DIR);
  assert.equal(raw.ytdlp, undefined, 'a disabled module must never materialize db.ytdlp');
});

test('currentYtdlpPollTimer() reports null when the module is disabled', () => {
  assert.equal(currentYtdlpPollTimer(), null);
});

// T4's manual re-pull triggers are registered inside the same `isEnabled`
// gate as everything else, so they must be equally absent when disabled --
// AND, because they are the ONLY entry point into the download loop besides
// the timer, their absence is also the proof that a disabled module can
// never spawn yt-dlp at all (no route can ever reach `runPoll`).
test('T4 re-pull-all/re-pull-one routes 404 when the module is disabled (no spawn is ever reachable)', async () => {
  const all = await fetch(`${base}/api/subscriptions/repull`, { method: 'POST' });
  assert.equal(all.status, 404);

  const one = await fetch(`${base}/api/subscriptions/some-id/repull`, { method: 'POST' });
  assert.equal(one.status, 404);
});

// T3's one-shot/edit/status routes are registered inside the SAME
// `isEnabled` gate as everything else, so they must be equally absent when
// disabled (AC 1, 3, 25, 32 -- restated here for grouping completeness).
test('T3 one-shot download / edit-pause / status routes 404 when the module is disabled (AC1/3/32)', async () => {
  const oneShot = await fetch(`${base}/api/ytdlp/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
  });
  assert.equal(oneShot.status, 404, 'POST /api/ytdlp/download must 404 when disabled (AC1)');

  const patch = await fetch(`${base}/api/subscriptions/some-id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paused: true }),
  });
  assert.equal(patch.status, 404, 'PATCH /api/subscriptions/:id must 404 when disabled (AC3/25)');

  const status = await fetch(`${base}/api/subscriptions/status`);
  assert.equal(status.status, 404, 'GET /api/subscriptions/status must 404 when disabled (AC32)');
});

// v1.24.0 A3: the new one-shot cancel route is registered inside the SAME
// `isEnabled` gate as every route above -- it must be equally absent when
// disabled, regardless of what jobId is targeted.
test('T15 A3: POST /api/ytdlp/download/:jobId/cancel 404s when the module is disabled', async () => {
  const res = await fetch(`${base}/api/ytdlp/download/some-job-id/cancel`, { method: 'POST' });
  assert.equal(res.status, 404, 'POST /api/ytdlp/download/:jobId/cancel must 404 when disabled');
});

// v1.21.0 FR-5 (AC69): the 3 channel-pin routes are registered inside the
// SAME `isEnabled` gate as everything else, so they must be equally absent
// (native Express 404, no separate no-op guard) when disabled.
test('T5 channel-pin routes (list/add/remove) 404 when the module is disabled', async () => {
  const list = await fetch(`${base}/api/subscriptions/pins`);
  assert.equal(list.status, 404, 'GET /api/subscriptions/pins must 404 when disabled');

  const add = await fetch(`${base}/api/subscriptions/pins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelDir: '/data/ytdlp-downloads/x', label: 'x' }),
  });
  assert.equal(add.status, 404, 'POST /api/subscriptions/pins must 404 when disabled');

  const del = await fetch(`${base}/api/subscriptions/pins/some-id`, { method: 'DELETE' });
  assert.equal(del.status, 404, 'DELETE /api/subscriptions/pins/:id must 404 when disabled');
});

// T4's startBackground registers the download dir into db.folders and arms
// the real poll timer -- both must be complete no-ops when disabled.
test('startBackground never registers db.folders, never arms a timer, and never touches the filesystem when the module is disabled', async () => {
  const disabledConfig = ytdlp.parseYtdlpConfig({});
  const updateDatabaseCalls = [];
  const fakeDb = { folders: [] };
  const fakeDeps = {
    loadDatabase: () => fakeDb,
    updateDatabase: (mutatorFn) => {
      updateDatabaseCalls.push(1);
      return Promise.resolve(mutatorFn(fakeDb));
    },
    scanDirectories: async () => {},
    getMediaId: (input) => input,
  };

  ytdlp.startBackground(fakeDeps, disabledConfig);
  // Allow a macrotask tick defensively (startBackground's disabled branch
  // returns synchronously today, but this keeps the assertion meaningful
  // even if that ever changed).
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(updateDatabaseCalls, [], 'a disabled module must never write to db.folders');
  assert.deepEqual(fakeDb.folders, [], 'db.folders must be untouched when disabled');
  assert.equal(ytdlp.currentYtdlpPollTimer(), null);
});

// ---- require() is side-effect-free (AC4) ----

test('requiring lib/ytdlp adds no route to a bare express() app and arms no timer', async () => {
  // Requiring the module (done at file-load time, above) must not have
  // registered anything anywhere on its own -- only an explicit
  // registerRoutes/armYtdlpTimer call can do that. A brand-new app that
  // never had registerRoutes called against it must 404 the same way.
  const bareApp = express();
  const bareServer = await new Promise((resolve) => {
    const s = bareApp.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${bareServer.address().port}/api/subscriptions/health`);
    assert.equal(res.status, 404);
  } finally {
    bareServer.closeAllConnections?.();
    await new Promise((resolve) => bareServer.close(resolve));
  }
  assert.equal(ytdlp.currentYtdlpPollTimer(), null);
});

// ---- Same-process on/off toggle (AC8) ----

test('registerRoutes/armYtdlpTimer toggle on and off within the same process', async () => {
  const disabledConfig = ytdlp.parseYtdlpConfig({});
  const enabledConfig = ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'true',
    FILETUBE_YTDLP_POLL_MINUTES: '1',
  });
  assert.equal(ytdlp.isEnabled(disabledConfig), false);
  assert.equal(ytdlp.isEnabled(enabledConfig), true);

  // OFF: a fresh app with the disabled config gets no route.
  const offApp = express();
  ytdlp.registerRoutes(offApp, {}, disabledConfig);
  const offServer = await new Promise((resolve) => {
    const s = offApp.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${offServer.address().port}/api/subscriptions/health`);
    assert.equal(res.status, 404);
  } finally {
    offServer.closeAllConnections?.();
    await new Promise((resolve) => offServer.close(resolve));
  }

  // ON: a different fresh app with the enabled config gets the health route.
  const onApp = express();
  ytdlp.registerRoutes(onApp, {}, enabledConfig);
  const onServer = await new Promise((resolve) => {
    const s = onApp.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${onServer.address().port}/api/subscriptions/health`);
    assert.equal(res.status, 200);
    // v1.20.0 FR-1 (T3), AC26: additive `defaultMaxVideos` field (see
    // ytdlp-crud.test.js's dedicated health-shape test for the full comment).
    assert.deepEqual(await res.json(), { enabled: true, defaultMaxVideos: 2 });
  } finally {
    onServer.closeAllConnections?.();
    await new Promise((resolve) => onServer.close(resolve));
  }

  try {
    // Timer: disabled config arms nothing.
    assert.equal(ytdlp.armYtdlpTimer(disabledConfig), null);
    assert.equal(ytdlp.currentYtdlpPollTimer(), null);

    // Timer: enabled config + pollMinutes > 0 arms a .unref()'d interval.
    const timer = ytdlp.armYtdlpTimer(enabledConfig);
    assert.notEqual(timer, null);
    assert.equal(ytdlp.currentYtdlpPollTimer(), timer);
    assert.equal(typeof timer.hasRef, 'function');
    assert.equal(timer.hasRef(), false, 'the poll timer must be .unref()\'d');
  } finally {
    // Clean up so no dangling timer survives this test / keeps the runner alive.
    ytdlp.armYtdlpTimer(disabledConfig);
    assert.equal(ytdlp.currentYtdlpPollTimer(), null);
  }
});
