'use strict';

// v1.265 cross-device preference sync - GET/POST /api/prefs through the real
// auth gate. The enforcement axes: per-caller scoping (no user param exists to
// attack - proven by the second-session test), the server-side allowlist
// (per-ITEM rejection, a junk key cannot poison a batch), the value byte-cap,
// and route-level LWW (skipped reported). The unauthenticated paths ride
// auth-flow.test.js's pattern: an explicit empty Cookie bypasses the helper.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-prefs-api-'));

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, __resetDatabaseForTests, __mintTestSession } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  await __resetDatabaseForTests();
});

test('GET /api/prefs starts empty; POST round-trips an allowlisted key with its stamp', async () => {
  let res = await fetch(`${base}/api/prefs`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { prefs: {} });

  res = await fetch(`${base}/api/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: [{ key: 'theme', value: 'dark', updatedAt: 1234 }] }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { applied: ['theme'], skipped: [], rejected: [] });

  res = await fetch(`${base}/api/prefs`);
  assert.deepEqual(await res.json(), { prefs: { theme: { value: 'dark', updatedAt: 1234 } } });
});

test('the allowlist rejects PER-ITEM: junk keys bounce while good keys in the same batch land', async () => {
  const res = await fetch(`${base}/api/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entries: [
        { key: 'ft-volume', value: '0.4', updatedAt: 1 },   // deliberately LOCAL - not synced
        { key: 'ft-is-admin', value: '1', updatedAt: 1 },   // a cache, never a pref
        { key: 'evil', value: 'x', updatedAt: 1 },
        { key: 'ft-era', value: '2009', updatedAt: 1 },
      ],
    }),
  });
  const json = await res.json();
  assert.deepEqual(json.applied, ['ft-era']);
  assert.deepEqual(json.rejected.sort(), ['evil', 'ft-is-admin', 'ft-volume']);
  const got = await (await fetch(`${base}/api/prefs`)).json();
  assert.deepEqual(Object.keys(got.prefs), ['ft-era'], 'nothing off-list was stored');
});

test('the value byte-cap rejects an oversized value (a data-URI does not belong in prefs)', async () => {
  const res = await fetch(`${base}/api/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: [{ key: 'theme', value: 'x'.repeat(513), updatedAt: 1 }] }),
  });
  const json = await res.json();
  assert.deepEqual(json.rejected, ['theme']);
  assert.deepEqual(json.applied, []);
});

test('route-level LWW: a stale updatedAt is reported skipped and changes nothing', async () => {
  const post = (updatedAt, value) => fetch(`${base}/api/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: [{ key: 'ft-music-skin', value, updatedAt }] }),
  });
  await post(2000, 'zune-classic');
  const json = await (await post(1000, 'apple')).json();
  assert.deepEqual(json, { applied: [], skipped: ['ft-music-skin'], rejected: [] });
  const got = await (await fetch(`${base}/api/prefs`)).json();
  assert.equal(got.prefs['ft-music-skin'].value, 'zune-classic');
});

test('unauthenticated GET and POST are refused (the auth wall, not a silent empty)', async () => {
  const resGet = await fetch(`${base}/api/prefs`, { headers: { Cookie: '' } });
  assert.ok(resGet.status === 401 || resGet.status === 403, `got ${resGet.status}`);
  const resPost = await fetch(`${base}/api/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: '' },
    body: JSON.stringify({ entries: [{ key: 'theme', value: 'dark', updatedAt: 1 }] }),
  });
  assert.ok(resPost.status === 401 || resPost.status === 403, `got ${resPost.status}`);
});

test('per-caller scoping: a SECOND session sees its own empty prefs, not the first user\'s', async () => {
  await fetch(`${base}/api/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: [{ key: 'theme', value: 'dark', updatedAt: 1 }] }),
  });
  const second = __mintTestSession({ username: 'prefs-second-user' });
  const res = await fetch(`${base}/api/prefs`, { headers: { Cookie: second.cookie } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { prefs: {} }, 'user B reads B\'s store, never A\'s');
});
