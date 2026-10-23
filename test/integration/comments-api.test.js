'use strict';

// [INTEGRATION] v1.394.0 W4: GET /api/videos/:id/comments - R2 and visibility at the API, never
// the DOM. Every account kind: an admin, a restricted BLOCKLIST member (the video stays visible to
// them - the restriction names another folder), a restricted ALLOWLIST member (allowed this video's
// folder), and an unrestricted member. Plus the item's own gate (a hidden item is the neutral 404),
// a `__proto__` / NUL / missing id, and the other read surfaces that must never carry comments
// (the item body, search, the library list).

const { DATA_DIR } = require('../helpers/isolate-data-dir');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { app, __resetDatabaseForTests, sourceCommentStore, userStore, __mintTestSession } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;
before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => __resetDatabaseForTests());

const SNAP = { state: 'ok', fetchedAt: '2026-10-20T00:00:00.000Z', comments: [{ id: 'c1', text: 'SECRET-COMMENT-TEXT at 0:30', author: 'Viewer', likeCount: 2 }] };
const item = (id, folderName) => ({
  id, title: id, name: `${id}.mp4`, filePath: path.join(DATA_DIR, folderName, `${id}.mp4`), folderName,
  rootFolder: DATA_DIR, type: 'video', ext: '.mp4', duration: 100, size: 1, addedAt: 1,
});
function seed() {
  seedState({
    folders: [DATA_DIR], folderSettings: {}, liked: [],
    metadata: { kidsvid: item('kidsvid', 'Kids'), grownvid: item('grownvid', 'Grown') },
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30, trashRetentionDays: 30 },
  });
  sourceCommentStore.apply('kidsvid', SNAP);
  sourceCommentStore.apply('grownvid', SNAP);
}
const get = (url, cookie) => (cookie ? fetch(base + url, { headers: { cookie } }) : fetch(base + url));
async function bodyText(url, cookie) { const r = await get(url, cookie); return { status: r.status, text: await r.text(), headers: r.headers }; }

test('admin: the snapshot is served, privately (no shared cache)', async () => {
  seed();
  const r = await bodyText('/api/videos/kidsvid/comments');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(JSON.parse(r.text), SNAP);
  assert.match(r.headers.get('cache-control'), /no-store/);
});

test('R2: restricted blocklist and allowlist members get NO real comments for a video they CAN watch; an unrestricted member gets them', async () => {
  seed();
  const block = __mintTestSession({ username: 'kid-block', role: 'member' });
  userStore.setRestrictions(block.user.id, [{ kind: 'folder', value: 'Grown' }]);
  const allow = __mintTestSession({ username: 'kid-allow', role: 'member' });
  userStore.setRestrictions(allow.user.id, [{ kind: 'mode', value: 'allowlist' }, { kind: 'folder', value: 'Kids' }]);
  const plain = __mintTestSession({ username: 'plain-member', role: 'member' });

  for (const [who, s] of [['blocklist', block], ['allowlist', allow]]) {
    const watch = await get('/api/videos/kidsvid', s.cookie);
    assert.strictEqual(watch.status, 200, who + ': precondition - the video itself is visible');
    const r = await bodyText('/api/videos/kidsvid/comments', s.cookie);
    assert.strictEqual(r.status, 200, who);
    assert.deepStrictEqual(JSON.parse(r.text), { state: 'none', fetchedAt: null, comments: [] }, who + ': the empty answer');
    assert.ok(!r.text.includes('SECRET-COMMENT-TEXT'), who + ': no comment text on the wire');
  }
  const p = await bodyText('/api/videos/kidsvid/comments', plain.cookie);
  assert.deepStrictEqual(JSON.parse(p.text), SNAP, 'an unrestricted member gets the comments (the gate is the restriction, not the role)');
  // lifting the restriction gives them back (discrimination)
  userStore.setRestrictions(block.user.id, []);
  assert.deepStrictEqual(JSON.parse((await bodyText('/api/videos/kidsvid/comments', block.cookie)).text), SNAP);
});

test('a hidden item is the neutral 404 (the item gate first); a missing, __proto__ or NUL id is a 404', async () => {
  seed();
  const block = __mintTestSession({ username: 'kid-hidden', role: 'member' });
  userStore.setRestrictions(block.user.id, [{ kind: 'folder', value: 'Grown' }]);
  const hidden = await bodyText('/api/videos/grownvid/comments', block.cookie);
  assert.strictEqual(hidden.status, 404);
  assert.ok(!hidden.text.includes('SECRET'));
  for (const id of ['no-such', '__proto__', 'constructor', 'kids\u0000vid']) {
    assert.strictEqual((await get(`/api/videos/${encodeURIComponent(id)}/comments`)).status, 404, JSON.stringify(id));
  }
});

test('no snapshot reads as none; the comments-off state is served as such', async () => {
  seed();
  sourceCommentStore.replaceAll({ grownvid: { state: 'disabled', fetchedAt: '2026-10-20T00:00:00.000Z', comments: [] } });
  assert.deepStrictEqual(JSON.parse((await bodyText('/api/videos/kidsvid/comments')).text), { state: 'none', fetchedAt: null, comments: [] });
  assert.strictEqual(JSON.parse((await bodyText('/api/videos/grownvid/comments')).text).state, 'disabled');
});

test('no other read surface carries the comments: the item body, the library list, search', async () => {
  seed();
  for (const url of ['/api/videos/kidsvid', '/api/videos?limit=50', '/api/search?q=SECRET', '/api/search?q=kidsvid']) {
    const r = await bodyText(url);
    assert.ok(r.status < 500, url + ' ' + r.status);
    assert.ok(!r.text.includes('SECRET-COMMENT-TEXT'), url + ' must not carry comment text');
  }
});
