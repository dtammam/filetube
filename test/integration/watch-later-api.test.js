'use strict';

// [INTEGRATION] v1.343 Watch later. Routes, ownership, visibility, finish
// auto-removal (only on a WATCHED_PCT crossing), the reorder race, and the
// server-side "Play all" queue feed. Isolated DATA_DIR; own process.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-watchlater-api-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, userStore, __mintTestSession, __resetDatabaseForTests } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, uid, kid, hidRoot;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  uid = auth.user.id;
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

function item(id, over = {}) {
  return { id, title: `Title ${id}`, filePath: `/media/Chan/${id}.mp4`, folderName: 'Chan', channelName: 'Chan',
    type: 'video', ext: '.mp4', duration: 100, size: 1000, addedAt: 5000, ...over };
}
function seed(metadata, folders = []) {
  seedState({ folders, folderSettings: {}, metadata, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
}
beforeEach(async () => {
  await __resetDatabaseForTests();
  hidRoot = path.join(DATA_DIR, 'HiddenRoot');
  kid = null;
});

const J = { 'Content-Type': 'application/json' };
const hdr = (cookie) => Object.assign({}, J, cookie ? { Cookie: cookie } : {});
const add = (id, cookie) => fetch(`${base}/api/watch-later/${encodeURIComponent(id)}`, { method: 'POST', headers: cookie ? { Cookie: cookie } : {} });
const del = (id, cookie) => fetch(`${base}/api/watch-later/${encodeURIComponent(id)}`, { method: 'DELETE', headers: cookie ? { Cookie: cookie } : {} });
const order = (ids, cookie) => fetch(`${base}/api/watch-later/order`, { method: 'PUT', headers: hdr(cookie), body: JSON.stringify({ ids }) });
const list = async (q = '', cookie) => (await fetch(`${base}/api/watch-later${q}`, { headers: cookie ? { Cookie: cookie } : {} })).json();
const idsOf = async (cookie) => (await (await fetch(`${base}/api/watch-later/ids`, { headers: cookie ? { Cookie: cookie } : {} })).json()).ids;
const ping = (id, timestamp, duration = 100) => fetch(`${base}/api/progress`, { method: 'POST', headers: J, body: JSON.stringify({ id, timestamp, duration }) });

test('add / list in order / remove; the list is shaped like Liked media with watchLater true', async () => {
  seed({ a: item('a'), b: item('b'), c: item('c') });
  for (const id of ['b', 'a', 'c']) assert.strictEqual((await add(id)).status, 200);
  assert.strictEqual((await add('b')).status, 200, 're-add is fine');
  const l = await list();
  assert.deepEqual(l.items.map((i) => i.id), ['b', 'a', 'c'], 'add order, not library order');
  assert.strictEqual(l.total, 3);
  assert.ok(l.items.every((i) => i.watchLater === true && i.kind === 'media'));
  assert.deepEqual(await idsOf(), ['b', 'a', 'c']);
  assert.strictEqual((await del('a')).status, 200);
  assert.strictEqual((await del('a')).status, 200, 'DELETE is idempotent');
  assert.deepEqual((await list()).items.map((i) => i.id), ['b', 'c']);
});

test('POST 404s a missing id and refuses __proto__ (nothing is stored)', async () => {
  seed({ a: item('a') });
  assert.strictEqual((await add('nope')).status, 404);
  assert.strictEqual((await add('__proto__')).status, 404);
  assert.strictEqual((await add('constructor')).status, 404);
  assert.deepEqual(await idsOf(), []);
});

test('another user never sees or affects my list', async () => {
  seed({ a: item('a'), b: item('b') });
  kid = __mintTestSession({ username: 'kidwl', role: 'member' });
  await add('a');
  assert.deepEqual(await idsOf(kid.cookie), []);
  assert.deepEqual((await list('', kid.cookie)).items, []);
  await add('b', kid.cookie);
  await del('a', kid.cookie);
  await order(['b', 'a'], kid.cookie);
  assert.deepEqual(await idsOf(), ['a'], 'my list is untouched by the other member');
  assert.deepEqual(await idsOf(kid.cookie), ['b']);
});

test('a restricted member: POST of a hidden id 404s like a missing one; a hidden id already stored never lists', async () => {
  const hid = item('hid', { filePath: path.join(hidRoot, 'Vault', 'hid.mp4'), rootFolder: hidRoot, folderName: 'Vault', title: 'SECRETCLIP' });
  seed({ open: item('open'), hid }, [hidRoot]);
  kid = __mintTestSession({ username: 'kidwl2', role: 'member' });
  userStore.setRestrictions(kid.user.id, [{ kind: 'path', value: hidRoot }]);
  const hidStatus = (await add('hid', kid.cookie)).status;
  const missStatus = (await add('deadbeef', kid.cookie)).status;
  assert.strictEqual(hidStatus, 404);
  assert.strictEqual(hidStatus, missStatus, 'no oracle');
  assert.strictEqual((await add('open', kid.cookie)).status, 200);
  userStore.addWatchLater(kid.user.id, 'hid', new Date().toISOString()); // stored before the restriction
  const l = await list('', kid.cookie);
  assert.deepEqual(l.items.map((i) => i.id), ['open']);
  assert.ok(!JSON.stringify(l).includes('SECRETCLIP'));
  const q = await fetch(`${base}/api/queue/watch-later`, { method: 'POST', headers: hdr(kid.cookie) }).then((r) => r.json());
  assert.strictEqual(q.added, 1, 'only the visible id was added');
  assert.deepEqual(userStore.getQueue(kid.user.id).entries.map((e) => e.mediaId), ['open'], 'the STORED queue never holds the hidden id');
  assert.deepEqual(q.queue.entries.map((e) => e.mediaId), ['open'], 'Play all skips the hidden id too');
});

test('a deleted / trashed id (gone from the library) is skipped at read time, never an error', async () => {
  seed({ a: item('a'), b: item('b') });
  await add('a'); await add('b');
  seed({ b: item('b') });
  const l = await list();
  assert.deepEqual(l.items.map((i) => i.id), ['b']);
  assert.strictEqual(l.total, 1);
});

test('PUT order: validates the body; reorders; a stale order never drops a new item or resurrects a removed one', async () => {
  seed({ a: item('a'), b: item('b'), c: item('c'), d: item('d') });
  for (const id of ['a', 'b', 'c']) await add(id);
  assert.strictEqual((await fetch(`${base}/api/watch-later/order`, { method: 'PUT', headers: J, body: JSON.stringify({ ids: 'a' }) })).status, 400);
  assert.strictEqual((await order([1, 2])).status, 400);
  assert.strictEqual((await order(new Array(5001).fill('a'))).status, 400);
  assert.strictEqual((await order(['c', 'a', 'b'])).status, 200);
  assert.deepEqual(await idsOf(), ['c', 'a', 'b']);
  await del('a'); await add('d');
  await order(['b', 'a', 'c']); // stale: still lists the removed 'a', misses the new 'd'
  assert.deepEqual(await idsOf(), ['b', 'c', 'd']);
});

test('GET honours limit/offset and the watch filter', async () => {
  seed({ a: item('a'), b: item('b'), c: item('c') });
  for (const id of ['a', 'b', 'c']) await add(id);
  const page = await list('?limit=1&offset=1');
  assert.deepEqual(page.items.map((i) => i.id), ['b']);
  assert.strictEqual(page.total, 3);
  await fetch(`${base}/api/watched/b`, { method: 'POST' });
  await add('b');
  assert.deepEqual((await list('?watch=new')).items.map((i) => i.id), ['a', 'c']);
  assert.deepEqual((await list('?watch=watched')).items.map((i) => i.id), ['b']);
});

test('finish rule: a ping below 90% never removes; at or above 90% removes; manual mark-watched removes', async () => {
  seed({ a: item('a'), b: item('b'), c: item('c') });
  for (const id of ['a', 'b', 'c']) await add(id);
  assert.strictEqual((await ping('a', 50)).status, 200);
  assert.strictEqual((await ping('a', 89)).status, 200);
  assert.deepEqual(await idsOf(), ['a', 'b', 'c'], 'an unfinished item is never removed');
  assert.strictEqual((await ping('a', 95)).status, 200);
  assert.deepEqual(await idsOf(), ['b', 'c'], 'finishing removes it');
  assert.strictEqual((await fetch(`${base}/api/watched/b`, { method: 'POST' })).status, 200);
  assert.deepEqual(await idsOf(), ['c'], 'mark-watched removes it');
});

test('POST /api/queue/watch-later: list order, skips dead ids, reports added, and 0 added leaves the queue alone', async () => {
  seed({ a: item('a'), b: item('b'), c: item('c') });
  for (const id of ['c', 'a', 'b']) await add(id);
  userStore.addWatchLater(uid, 'ghost', new Date().toISOString());
  const r = await fetch(`${base}/api/queue/watch-later`, { method: 'POST', headers: J });
  assert.strictEqual(r.status, 200);
  const body = await r.json();
  assert.strictEqual(body.added, 3);
  assert.deepEqual(body.queue.entries.map((e) => e.mediaId), ['c', 'a', 'b']);
  assert.ok(body.first);
  await __resetDatabaseForTests();
  seed({ a: item('a') });
  const empty = await fetch(`${base}/api/queue/watch-later`, { method: 'POST', headers: J }).then((x) => x.json());
  assert.strictEqual(empty.added, 0);
});
