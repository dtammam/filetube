'use strict';

// [INTEGRATION] v1.20.0 FR-1 (T3), TWO-REVIEWER GATE -- the watch page is a
// NEW caller into the spawn-guarded subscription create/delete system
// (public/js/watch.js's Subscribe toggle -> common.js's buildSubscribeModal).
// This proves, against the REAL server (not a re-implementation), that this
// new caller has NO bypass: every channelUrl POSTed -- whether it looks
// user-typed or FR-2-derived-from-a-file -- goes through the SAME,
// UNMODIFIED `store.validateSubscriptionInput` -> `url.validateChannelUrl`
// path the existing `/subscriptions` add form has always used, and that
// `GET /api/subscriptions/health` exposes the single-sourced
// `defaultMaxVideos` (AC26) the compact modal pre-fills from.
//
// Isolated DATA_DIR before requiring the app, per the established pattern
// (test/integration/ytdlp-crud.test.js).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0'; // manual-only: no real timer during tests

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

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
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

test('GET /api/subscriptions/health exposes defaultMaxVideos=2 (AC26 -- single server-side source for the modal pre-fill)', async () => {
  const res = await fetch(`${base}/api/subscriptions/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.enabled, true);
  assert.equal(data.defaultMaxVideos, 2);
});

test('a FR-2-derived, legitimate channelUrl (the shape watch.js\'s modal actually sends) is accepted and persists all the modal\'s fields', async () => {
  const res = await fetch(`${base}/api/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channelUrl: 'https://www.youtube.com/channel/UCwatchpagederived12',
      name: 'Watch Page Derived Creator',
      format: 'video',
      quality: 'best',
      maxVideos: 2,
      skipShorts: false,
      filetype: 'mp4',
    }),
  });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal(created.channelUrl, 'https://www.youtube.com/channel/UCwatchpagederived12');
  assert.equal(created.name, 'Watch Page Derived Creator');
  assert.equal(created.maxVideos, 2);
  assert.equal(created.skipShorts, false);
  assert.equal(created.filetype, 'mp4');

  const delRes = await fetch(`${base}/api/subscriptions/${created.id}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);
});

// ---- SECURITY: no bypass for the new watch-page caller ---------------------

test('a hostile channelUrl (shell metacharacter) sent through the exact watch-modal body shape is STILL rejected (no bypass)', async () => {
  const res = await fetch(`${base}/api/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channelUrl: 'https://www.youtube.com/channel/UC123; rm -rf /',
      name: 'Hostile',
      format: 'video',
      quality: 'best',
      maxVideos: 2,
      skipShorts: false,
      filetype: 'mp4',
    }),
  });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);

  // Never persisted, never listed.
  const list = await (await fetch(`${base}/api/subscriptions`)).json();
  assert.ok(!list.some((s) => s.channelUrl.includes('rm -rf')));
});

test('a channelUrl on a disallowed host, sent through the exact watch-modal body shape, is STILL rejected (no bypass)', async () => {
  const res = await fetch(`${base}/api/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channelUrl: 'https://evil-not-youtube.example.com/channel/UC12345',
      name: 'Hostile Host',
      format: 'video',
      quality: 'best',
      maxVideos: 2,
      skipShorts: false,
      filetype: 'mp4',
    }),
  });
  assert.equal(res.status, 400);
});

// ---- Unsubscribe: DELETE targets only the exact matched id -----------------

test('DELETE only removes the subscription whose id was actually returned by the matcher -- a wrong/unknown id 404s and changes nothing', async () => {
  const addRes = await fetch(`${base}/api/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelUrl: 'https://www.youtube.com/channel/UCdeletetargeting1', format: 'video' }),
  });
  const created = await addRes.json();

  const wrongDelRes = await fetch(`${base}/api/subscriptions/not-a-real-id`, { method: 'DELETE' });
  assert.equal(wrongDelRes.status, 404);

  // Still present -- the bogus delete attempt touched nothing.
  const stillThere = await (await fetch(`${base}/api/subscriptions`)).json();
  assert.ok(stillThere.some((s) => s.id === created.id));

  const delRes = await fetch(`${base}/api/subscriptions/${created.id}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);

  const afterList = await (await fetch(`${base}/api/subscriptions`)).json();
  assert.ok(!afterList.some((s) => s.id === created.id));
});
