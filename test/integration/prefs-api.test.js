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
    body: JSON.stringify({ entries: [{ key: 'ft-era', value: '2009', updatedAt: 1234 }] }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { applied: ['ft-era'], skipped: [], rejected: [] });

  res = await fetch(`${base}/api/prefs`);
  assert.deepEqual(await res.json(), { prefs: { 'ft-era': { value: '2009', updatedAt: 1234 } } });
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
    body: JSON.stringify({ entries: [{ key: 'ft-era', value: 'x'.repeat(513), updatedAt: 1 }] }),
  });
  const json = await res.json();
  assert.deepEqual(json.rejected, ['ft-era']);
  assert.deepEqual(json.applied, []);
});

// v1.382.0 (Dean's ruling 2026-10-10): the Feed's "Fewer from" list is the ONE key with an 8 KB cap (200 names); every
// other key, the Feed's own settings included, stays at 512 bytes.
test('the per-key cap: ft-feed-fewer takes 8 KB (and no more), ft-feed-settings and the rest stay at 512 bytes', async () => {
  const post = (key, value) => fetch(`${base}/api/prefs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: [{ key, value, updatedAt: 1 }] }),
  }).then((r) => r.json());
  assert.deepEqual((await post('ft-feed-fewer', 'x'.repeat(8192))).applied, ['ft-feed-fewer']);
  assert.deepEqual((await post('ft-feed-fewer', 'y'.repeat(8193))).rejected, ['ft-feed-fewer']);
  assert.deepEqual((await post('ft-feed-settings', 'x'.repeat(513))).rejected, ['ft-feed-settings']);
  assert.deepEqual((await post('ft-feed-settings', '{"reel":30}')).applied, ['ft-feed-settings']);
  assert.deepEqual((await post('ft-era', 'x'.repeat(600))).rejected, ['ft-era'], 'the 8 KB cap is that key only');
  const got = await (await fetch(`${base}/api/prefs`)).json();
  assert.equal(got.prefs['ft-feed-fewer'].value.length, 8192, 'the 8 KB value stood; the 8193 one never replaced it');
});

test('route-level LWW: a stale updatedAt is reported skipped and changes nothing', async () => {
  const post = (updatedAt, value) => fetch(`${base}/api/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: [{ key: 'ft-music-skin', value, updatedAt }] }),
  });
  await post(2000, 'ipod-matte');
  const json = await (await post(1000, 'apple')).json();
  assert.deepEqual(json, { applied: [], skipped: ['ft-music-skin'], rejected: [] });
  const got = await (await fetch(`${base}/api/prefs`)).json();
  assert.equal(got.prefs['ft-music-skin'].value, 'ipod-matte');
});

test('unauthenticated GET and POST are refused (the auth wall, not a silent empty)', async () => {
  const resGet = await fetch(`${base}/api/prefs`, { headers: { Cookie: '' } });
  assert.ok(resGet.status === 401 || resGet.status === 403, `got ${resGet.status}`);
  const resPost = await fetch(`${base}/api/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: '' },
    body: JSON.stringify({ entries: [{ key: 'ft-era', value: '2009', updatedAt: 1 }] }),
  });
  assert.ok(resPost.status === 401 || resPost.status === 403, `got ${resPost.status}`);
});

test('per-caller scoping: a SECOND session sees its own empty prefs, not the first user\'s', async () => {
  await fetch(`${base}/api/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: [{ key: 'ft-mode', value: 'dark', updatedAt: 1 }] }),
  });
  const second = __mintTestSession({ username: 'prefs-second-user' });
  const res = await fetch(`${base}/api/prefs`, { headers: { Cookie: second.cookie } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { prefs: {} }, 'user B reads B\'s store, never A\'s');
});


test('QA W3: a far-future updatedAt is CLAMPED (a wrong-clock device cannot wedge a key forever)', async () => {
  const res = await fetch(`${base}/api/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: [{ key: 'ft-era', value: '2009', updatedAt: 9e15 }] }),
  });
  assert.deepEqual((await res.json()).applied, ['ft-era']);
  const got = await (await fetch(`${base}/api/prefs`)).json();
  const stored = got.prefs['ft-era'].updatedAt;
  assert.ok(stored <= Date.now() + 300000 + 5000, `stored stamp ${stored} exceeds now+5min - the wedge lives`);
  // The recovery is TIME-BOUNDED, not instant (honest semantics): the clamped
  // stamp sits at now+5min, so a sane device's write is skipped for AT MOST
  // 5 minutes of wall clock - versus FOREVER under the unclamped wedge.
  const res2 = await fetch(`${base}/api/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: [{ key: 'ft-era', value: '2021', updatedAt: Date.now() }] }),
  });
  assert.deepEqual((await res2.json()).skipped, ['ft-era'], 'inside the 5-min window the clamp still wins - the bound, not a bug');
});
