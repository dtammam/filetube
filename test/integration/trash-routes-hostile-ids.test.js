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
const { app, saveDatabase, __resetDatabaseForTests, trashStore, progressStore, tombstoneStore, viewCountStore, userStore } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;
before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
  await __resetDatabaseForTests();
  saveDatabase({
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

test('a notification row whose media id is empty (a hostile bundle restored on <=v1.292 stores a NUL id as "") no longer 500s the bell for everyone', async () => {
  // Plant the row the way a restored bundle would leave it.
  userStore.replaceAllNotificationsRaw([{ mediaId: '', createdAt: Date.now(), kind: 'media' }]);
  for (let i = 0; i < 3; i++) {
    const r = await withTimeout(fetch(`${base}/api/notifications`));
    assert.strictEqual(r.status, 200, `bell open #${i + 1} answers`);
  }
});
