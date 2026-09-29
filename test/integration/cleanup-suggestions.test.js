'use strict';

// [INTEGRATION] v1.342 Clean up: GET /api/cleanup/suggestions against the REAL app. The route is
// read-only (it never touches a file), a viewer gets 403, the shortlist reflects the caller's own
// watched state and everyone's likes, and a bulk clear is just N ordinary DELETE /api/videos/:id
// calls that land in Trash and restore from it.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cleanup-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, userStore, __mintTestSession, viewCountStore } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');

const DAY = 86400000;
let server, base, auth, viewer;
const file = (n) => path.join(DATA_DIR, `${n}.mp4`);
let nextSize = 100; // distinct sizes: the no-source-id duplicate rule keys on size + duration
const mk = (id, over) => Object.assign({
  id, title: `Title ${id}`, name: `${id}.mp4`, filePath: file(id), folderName: 'Lib', channelName: 'Lib',
  rootFolder: DATA_DIR, type: 'video', ext: '.mp4', duration: 100, size: (nextSize += 7), addedAt: Date.now() - 90 * DAY,
}, over || {});
const get = (p, cookie) => fetch(`${base}${p}`, cookie ? { headers: { Cookie: cookie } } : undefined);

before(async () => {
  for (const n of ['seen', 'liked', 'half', 'fresh', 'big', 'copyA', 'copyB']) fs.writeFileSync(file(n), 'BYTES-' + n);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // admin
  viewCountStore.replaceAll({});
  seedState({
    folders: [], folderSettings: {},
    metadata: {
      seen: mk('seen'),
      liked: mk('liked'),
      half: mk('half'),
      fresh: mk('fresh', { addedAt: Date.now() - DAY }),
      big: mk('big', { size: 5000 }),
      copyA: mk('copyA', { youtubeId: 'ZZZZZZZZZZZ', addedAt: Date.now() - 200 * DAY }),
      copyB: mk('copyB', { youtubeId: 'ZZZZZZZZZZZ', addedAt: Date.now() - 100 * DAY }),
    },
    liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });
  const uid = auth.user.id;
  const stamp = new Date(Date.now() - 60 * DAY).toISOString();
  userStore.markWatched(uid, 'seen', stamp);
  userStore.markWatched(uid, 'liked', stamp);
  userStore.addLiked(uid, 'liked', stamp);
  userStore.setProgress(uid, 'half', { timestamp: 40, duration: 100, updatedAt: stamp });
  viewer = __mintTestSession({ username: 'viewer1', role: 'member' }); // canModifyLibrary false
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('a viewer without library-modify rights gets 403 and no shortlist', async () => {
  const r = await get('/api/cleanup/suggestions', viewer.cookie);
  assert.strictEqual(r.status, 403);
  assert.strictEqual((await r.json()).watched, undefined);
});

test('the shortlist: watched (not the liked or half-watched one), big, duplicates keep the oldest', async () => {
  const r = await (await get('/api/cleanup/suggestions?days=30')).json();
  assert.strictEqual(r.days, 30);
  assert.deepStrictEqual(r.watched.map((x) => x.id), ['seen']);
  assert.deepStrictEqual(r.duplicates.map((x) => x.id), ['copyB']);
  assert.strictEqual(r.duplicates[0].keepId, 'copyA');
  assert.strictEqual(r.largest[0].id, 'big');
  const all = [...r.watched, ...r.stale_subscriptions, ...r.largest, ...r.duplicates].map((x) => x.id);
  for (const protectedId of ['liked', 'half', 'fresh']) assert.ok(!all.includes(protectedId), `${protectedId} is never listed`);
  assert.ok(!JSON.stringify(r).includes(DATA_DIR), 'no on-disk path leaks');
});

test('the days setting moves the line: 120 days drops the 60-day-old watched item', async () => {
  const r = await (await get('/api/cleanup/suggestions?days=120')).json();
  assert.deepStrictEqual(r.watched, []);
});

test('reading the shortlist deletes nothing', async () => {
  await get('/api/cleanup/suggestions');
  for (const n of ['seen', 'liked', 'half', 'fresh', 'big', 'copyA', 'copyB']) assert.ok(fs.existsSync(file(n)), `${n} still on disk`);
  const list = await (await get('/api/videos?limit=50')).json();
  assert.strictEqual((list.items || []).length, 7);
});

test('a bulk clear is explicit DELETEs to Trash: it lands, a second tap is a 404, and Trash restores it', async () => {
  const r1 = await fetch(`${base}/api/videos/copyB`, { method: 'DELETE' });
  assert.strictEqual(r1.status, 200);
  assert.strictEqual(fs.existsSync(file('copyB')), false, 'moved out of the library folder');
  const r2 = await fetch(`${base}/api/videos/copyB`, { method: 'DELETE' });
  assert.strictEqual(r2.status, 404, 'a double tap finds nothing left to delete');
  const trash = (await (await get('/api/trash')).json()).items || [];
  const rec = trash.find((t) => t.originalId === 'copyB');
  assert.ok(rec, 'the item is in Trash');
  const back = await fetch(`${base}/api/trash/${encodeURIComponent(rec.id || rec.trashId)}/restore`, { method: 'POST' });
  assert.strictEqual(back.status, 200);
  assert.ok(fs.existsSync(file('copyB')), 'the file is back');
});

test('a viewer cannot delete what the shortlist named', async () => {
  const r = await fetch(`${base}/api/videos/seen`, { method: 'DELETE', headers: { Cookie: viewer.cookie } });
  assert.strictEqual(r.status, 403);
  assert.ok(fs.existsSync(file('seen')));
});

test('GET /cleanup serves the shell with the cleanup view root and script (a deep link and an in-app swap both work)', async () => {
  const res = await get('/cleanup', auth.cookie);
  assert.strictEqual(res.status, 200);
  const html = await res.text();
  assert.match(html, /<div id="view-root" data-view="cleanup">/);
  assert.match(html, /<script src="\/js\/cleanup\.js"><\/script>/);
  assert.match(html, /<title>Clean up - FileTube<\/title>/);
  assert.ok(!/history\.js/.test(html), 'the History view script is not loaded here');
  assert.match(html, /<header/, 'the shared header comes along');
});
