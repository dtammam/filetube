'use strict';

// [INTEGRATION] Wave 3 gate CRITICAL (both seats): the record stores' id
// assertion had moved onto READ paths fed by request-derived ids, so a `%00`
// path parameter hung the async restore/purge handlers (a rejection Express 4
// never observes) and 500'd the three serve routes, and one hostile
// notification row (media_id '') made the bell 500 for every user. Reads are
// tolerant now (an unpersistable id reads as absent); this file binds the
// v1.292.0 statuses and that the server keeps answering afterwards.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-hostile-ids-'));
process.env.FILETUBE_YTDLP_ENABLED = '1'; // the notifications feed route needs the module
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, __resetDatabaseForTests, trashStore, progressStore, tombstoneStore, viewCountStore, userStore } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { SQLITE_FILENAME, __openRawForTests: openRaw } = require('../../lib/db/sqlite');

let server;
let base;
before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
  await __resetDatabaseForTests();
  seedState({
    folders: [DATA_DIR], folderSettings: {}, liked: [], metadata: {},
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
    // The bell is a 404 unless the downloader module is on AND a subscription exists.
    ytdlp: { subscriptions: [{ id: 'sub1', channelUrl: 'https://www.youtube.com/@x', name: 'X', order: 0 }] },
  });
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const withTimeout = (p, ms = 4000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`no response within ${ms}ms (the handler hung)`)), ms))]);

test('a %00 id on the trash restore/purge routes is a 404 (never a hung handler), and on the serve routes the v1.292.0 status (placeholder / 404)', async () => {
  const r1 = await withTimeout(fetch(`${base}/api/trash/%00/restore`, { method: 'POST' }));
  assert.strictEqual(r1.status, 404, 'restore of a NUL id');
  const r2 = await withTimeout(fetch(`${base}/api/trash/%00`, { method: 'DELETE' }));
  assert.strictEqual(r2.status, 404, 'purge of a NUL id');
  const r3 = await withTimeout(fetch(`${base}/thumbnail/%00`));
  assert.strictEqual(r3.status, 200, 'thumbnail of a NUL id falls to the placeholder, as before');
  assert.match(r3.headers.get('content-type') || '', /image\/svg/);
  for (const route of ['/storyboard/%00', '/preview/%00']) {
    const r = await withTimeout(fetch(`${base}${route}`));
    assert.strictEqual(r.status, 404, `${route} -> 404 as before`);
  }
  // Empty-string ids at the store level read as absent, never throw.
  for (const s of [trashStore, progressStore, tombstoneStore]) {
    assert.strictEqual(s.get(''), undefined);
    assert.strictEqual(s.has(String.fromCharCode(0)), false);
    assert.strictEqual(s.get(42), undefined);
  }
  assert.strictEqual(viewCountStore.get(''), 0);
  // The server is still alive and answering.
  const list = await withTimeout(fetch(`${base}/api/trash`));
  assert.strictEqual(list.status, 200, 'the process kept serving');
});

test('a notification row whose media id is unaddressable (a NUL id a <=v1.292 restore accepted - read as "" on Node <=24.14, as the NUL on 24.20+) no longer 500s the bell for everyone', async () => {
  // Plant the row the way a restored bundle leaves it: the raw replace seam
  // drops a literal '' (isValidNotificationEntry), but a NUL id passes it - so
  // seed the NUL. The bind stores the NUL byte on EVERY Node version (measured
  // v1.293.1: hex(media_id) = 00 on 22.23.1 / 24.14.0 / 24.20.0); what differs
  // is the READ-BACK - node:sqlite up to 24.14 converts a TEXT column to a JS
  // string stopping at the first NUL (the row reads as ''), 24.20+ converts by
  // byte length (it reads as '\x00'). CI's Node 24 runner was on 24.20.0 and
  // this assertion, pinned to '', was the only red test. Either reading is the
  // hostile row this test is about - an id no route could ever address - and
  // the populate step stays bound (QA delta W1: an empty feed made this test a
  // vacuous floor). Tracker #225.
  userStore.replaceAllNotificationsRaw([{ mediaId: String.fromCharCode(0), createdAt: Date.now(), kind: 'media' }]);
  const raw = openRaw(path.join(DATA_DIR, SQLITE_FILENAME));
  let planted;
  try { planted = raw.prepare('SELECT media_id FROM notifications').all().map((r) => r.media_id); } finally { raw.close(); }
  assert.strictEqual(planted.length, 1, 'the hostile row is really in the table');
  assert.ok(planted[0] === '' || planted[0] === String.fromCharCode(0), `the planted id reads as the older runtimes' '' or 24.20+'s verbatim NUL (got ${JSON.stringify(planted[0])})`);
  for (let i = 0; i < 3; i++) {
    const r = await withTimeout(fetch(`${base}/api/notifications`));
    assert.strictEqual(r.status, 200, `bell open #${i + 1} answers`);
  }
});
