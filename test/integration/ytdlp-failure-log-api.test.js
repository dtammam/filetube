'use strict';

// [INTEGRATION] v1.47.4 item 7 -- the failure-log HTTP surface, end to end
// through the REAL express app, the REAL auth gate, and a REAL data directory.
//
// Dean: "If any downloads fail I'd like it to be explicitly logged and have the
// error so one can look in posterity. It should be able to be cleared/deleted
// as well."
//
// Two of these three routes DESTROY user-visible records, so per this repo's
// destructive-work norm they are proven against real files, and asserted for
// what they must NOT destroy as much as for what they must.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-faillog-api-'));
process.env.DATA_DIR = DATA_DIR;
// The failure routes live inside the module's `isEnabled` gate, so the module
// must be ON for this file (the disabled-module 404 posture is proven by
// ytdlp-disabled-noop.test.js, which owns that acceptance).
process.env.FILETUBE_YTDLP_ENABLED = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const faillog = require('../../lib/ytdlp/faillog');

let server;
let base;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function seed(entries) {
  faillog.clearFailures(DATA_DIR);
  faillog.recordFailures(DATA_DIR, entries);
  return faillog.readFailures(DATA_DIR);
}

const ONE_OFF = { source: 'one-off', videoId: 'vid1', title: 'One-off item', reason: 'ERROR: Video unavailable' };
const SUB = { source: 'subscription', videoId: 'vid2', title: 'Sub item', reason: 'ERROR: HTTP Error 429' };

test('GET returns the recorded failures, newest-first, with the verbatim reason', async () => {
  seed([ONE_OFF, SUB]);
  const res = await fetch(`${base}/api/subscriptions/failures`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.entries.length, 2);
  assert.equal(body.entries[0].videoId, 'vid2', 'newest first');
  assert.equal(body.entries[0].reason, 'ERROR: HTTP Error 429', 'the real error text survives the round trip');
  assert.ok(body.entries.every((e) => typeof e.id === 'string' && e.id !== ''), 'every row is addressable');
});

test('GET degrades to an empty list rather than erroring when nothing is recorded', async () => {
  faillog.clearFailures(DATA_DIR);
  const res = await fetch(`${base}/api/subscriptions/failures`);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).entries, []);
});

test('DELETE removes EXACTLY the addressed entry and leaves the others intact', async () => {
  const seeded = seed([ONE_OFF, SUB]);
  const target = seeded.find((e) => e.videoId === 'vid1');
  const res = await fetch(`${base}/api/subscriptions/failures/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
  assert.equal(res.status, 200);

  const remaining = (await (await fetch(`${base}/api/subscriptions/failures`)).json()).entries;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].videoId, 'vid2', 'the untargeted row must survive untouched');
  assert.deepEqual(remaining[0], seeded.find((e) => e.videoId === 'vid2'),
    'the survivor must be field-for-field identical -- a delete must never rewrite its neighbours');
});

test('DELETE of an unknown id 404s and DESTROYS NOTHING', async () => {
  seed([ONE_OFF, SUB]);
  const file = path.join(DATA_DIR, 'ytdlp-failures.jsonl');
  const before = fs.readFileSync(file);

  const res = await fetch(`${base}/api/subscriptions/failures/no-such-id`, { method: 'DELETE' });
  assert.equal(res.status, 404);
  // A stale id from a double-click or a stale tab must be a genuine no-op --
  // not a rewrite of the whole log.
  assert.deepEqual(fs.readFileSync(file), before, 'the log must be byte-identical after a no-match delete');
});

test('DELETE id traversal/oddity cannot escape the store or corrupt it', async () => {
  seed([ONE_OFF, SUB]);
  const file = path.join(DATA_DIR, 'ytdlp-failures.jsonl');
  const before = fs.readFileSync(file);
  for (const hostile of ['../../etc/passwd', '..%2F..%2Fetc%2Fpasswd', '%00', 'a'.repeat(500)]) {
    const res = await fetch(`${base}/api/subscriptions/failures/${encodeURIComponent(hostile)}`, { method: 'DELETE' });
    // The id is only ever compared for EQUALITY against stored ids, never used
    // as a path segment, so every one of these is simply "no such entry".
    assert.equal(res.status, 404, `${hostile} must be a plain no-match`);
  }
  assert.deepEqual(fs.readFileSync(file), before, 'no hostile id may disturb the log');
  assert.equal((await (await fetch(`${base}/api/subscriptions/failures`)).json()).entries.length, 2);
});

test('DELETE (clear-all) empties the log and reports the REAL removed count', async () => {
  seed([ONE_OFF, SUB]);
  const res = await fetch(`${base}/api/subscriptions/failures/all`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.removed, 2, 'the count must be real, never assumed');
  assert.deepEqual((await (await fetch(`${base}/api/subscriptions/failures`)).json()).entries, []);
});

test('clear-all on an already-empty log reports 0 rather than failing', async () => {
  faillog.clearFailures(DATA_DIR);
  const body = await (await fetch(`${base}/api/subscriptions/failures/all`, { method: 'DELETE' })).json();
  assert.equal(body.removed, 0);
});

test('the log survives clear -> re-record (no wedged state)', async () => {
  seed([ONE_OFF]);
  await fetch(`${base}/api/subscriptions/failures/all`, { method: 'DELETE' });
  faillog.recordFailures(DATA_DIR, [SUB]);
  const entries = (await (await fetch(`${base}/api/subscriptions/failures`)).json()).entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].videoId, 'vid2');
});

test('?limit= narrows the result and can never widen past the store cap', async () => {
  seed([ONE_OFF, SUB]);
  const one = (await (await fetch(`${base}/api/subscriptions/failures?limit=1`)).json()).entries;
  assert.equal(one.length, 1);
  // A caller cannot ask for more than the store itself will ever hold.
  const huge = (await (await fetch(`${base}/api/subscriptions/failures?limit=999999`)).json()).entries;
  assert.ok(huge.length <= faillog.YTDLP_FAILLOG_MAX_ENTRIES);
  // Garbage limits fall back to the full set rather than erroring or returning
  // nothing (which would read as "no failures").
  for (const bad of ['abc', '-5', '0', '']) {
    const res = await fetch(`${base}/api/subscriptions/failures?limit=${bad}`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).entries.length, 2, `limit=${bad} must not hide failures`);
  }
});

test('a corrupt on-disk log degrades to the salvageable rows instead of a 500', async () => {
  const file = path.join(DATA_DIR, 'ytdlp-failures.jsonl');
  fs.writeFileSync(file, [
    '{"id":"keep","ts":"2026-07-27T00:00:00.000Z","source":"one-off","reason":"fine"}',
    'not json',
    '{"id":"trunc","ts":"2026',
  ].join('\n') + '\n', 'utf8');
  const res = await fetch(`${base}/api/subscriptions/failures`);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).entries.map((e) => e.id), ['keep']);
});
