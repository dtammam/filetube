'use strict';

// [INTEGRATION] v1.97 "Hide from feed" - the bidirectional contract.
//   FORWARD (the point): a feed-hidden id LEAVES the modern grid
//     (GET /api/home?view=grid), pagination total/offset stay correct.
//   INVERSE (the v1.80 list-leak class, flipped): the SAME id is STILL returned
//     by every OTHER surface - /api/videos, /api/liked, the row home feed - and
//     feed-hiding never sets the admin visibility flag or restricts the item.
//   ROUTES: POST/DELETE/GET /api/feed-hidden behave; POST is existence-gated;
//     GET is RBAC-filtered and cross-user isolated.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-feedhidden-api-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, saveDatabase, userStore, __mintTestSession, __resetDatabaseForTests,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, uid, auth;

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
beforeEach(async () => { await __resetDatabaseForTests(); });

function item(id, over = {}) {
  return {
    id, title: `Title ${id}`, filePath: `/media/Chan/${id}.mp4`, folderName: 'Chan',
    channelName: 'Chan', type: 'video', ext: '.mp4', duration: 100, size: 1000, addedAt: 5000, ...over,
  };
}
function seed(metadata, over = {}) {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {}, metadata, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
    ...over,
  });
}
const gridIds = async () => {
  const res = await fetch(`${base}/api/home?view=grid&filter=all&limit=100`);
  const body = await res.json();
  return { ids: (body.items || []).map((i) => i.id), total: body.total, body };
};
const hide = (id) => fetch(`${base}/api/feed-hidden/${encodeURIComponent(id)}`, { method: 'POST' });
const unhide = (id) => fetch(`${base}/api/feed-hidden/${encodeURIComponent(id)}`, { method: 'DELETE' });

test('FORWARD: hiding an item removes it from the modern grid and drops total by one; unhiding restores it', async () => {
  seed({ a: item('a'), b: item('b'), c: item('c') });
  let g = await gridIds();
  assert.deepEqual(g.ids.sort(), ['a', 'b', 'c']);
  assert.strictEqual(g.total, 3);

  const r = await hide('b');
  assert.strictEqual(r.status, 200);
  assert.deepEqual((await r.json()), { success: true, hidden: true });

  g = await gridIds();
  assert.deepEqual(g.ids.sort(), ['a', 'c'], 'b left the modern grid');
  assert.strictEqual(g.total, 2, 'total reflects the prune (pagination stays correct)');

  await unhide('b');
  g = await gridIds();
  assert.deepEqual(g.ids.sort(), ['a', 'b', 'c'], 'unhide restores it to the grid');
  assert.strictEqual(g.total, 3);
});

test('FORWARD pagination: the hidden item never occupies a page slot (no gap, no dupe across pages)', async () => {
  const meta = {};
  for (let i = 0; i < 6; i++) meta['v' + i] = item('v' + i, { addedAt: 1000 + i });
  seed(meta);
  await hide('v3');
  // page the grid in 2s across the 5 remaining; collect every id seen.
  const seen = [];
  for (let off = 0; off < 6; off += 2) {
    const res = await fetch(`${base}/api/home?view=grid&filter=all&sort=newest&offset=${off}&limit=2`);
    const body = await res.json();
    for (const it of body.items) seen.push(it.id);
  }
  assert.ok(!seen.includes('v3'), 'the hidden id appears on no page');
  assert.strictEqual(new Set(seen).size, seen.length, 'no duplicate across pages');
  assert.strictEqual(new Set(seen).size, 5, 'all 5 survivors are paged exactly once');
});

test('INVERSE: a feed-hidden item is STILL returned by /api/videos and /api/liked (fully findable)', async () => {
  seed({ a: item('a'), b: item('b') });
  await fetch(`${base}/api/liked/b`, { method: 'POST' }); // b is liked
  await hide('b');

  // Not in the modern grid...
  assert.ok(!(await gridIds()).ids.includes('b'), 'gone from the modern feed');

  // ...but the classic library list still has it.
  const vids = await (await fetch(`${base}/api/videos?limit=100`)).json();
  assert.ok((vids.items || []).some((i) => i.id === 'b'), '/api/videos still returns the feed-hidden item');

  // ...and the Liked view still has it (feed-hide is orthogonal to Like).
  const liked = await (await fetch(`${base}/api/liked?limit=100`)).json();
  assert.ok((liked.items || []).some((i) => i.id === 'b'), '/api/liked still returns the feed-hidden item');
});

test('INVERSE: the row home feed (GET /api/home, no view=grid) still surfaces a feed-hidden recently-added item', async () => {
  // A single fresh item lands in the row feed\'s "recently added" lane.
  seed({ fresh: item('fresh', { addedAt: Date.now() }) });
  await hide('fresh');
  const body = await (await fetch(`${base}/api/home`)).json();
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const allRowIds = rows.flatMap((r) => (r.items || []).map((i) => i.id));
  assert.ok(allRowIds.includes('fresh'), 'the row feed stays complete - only the modern grid honors feed-hide');
});

test('SEPARATION: hiding from feed does NOT set the admin visibility flag or restrict the item', async () => {
  seed({ a: item('a') });
  await hide('a');
  // The item is still VISIBLE (not RBAC-restricted): the watch detail resolves,
  // and /api/videos returns it - feed-hide is not a permission.
  const detail = await fetch(`${base}/api/videos/a`);
  assert.strictEqual(detail.status, 200, 'feed-hidden != restricted: the item is still fully accessible');
  const vids = await (await fetch(`${base}/api/videos?limit=100`)).json();
  assert.ok((vids.items || []).some((i) => i.id === 'a'));
});

test('GET /api/feed-hidden lists the hidden items (newest-first) for the You-tab restore', async () => {
  seed({ a: item('a'), b: item('b'), c: item('c') });
  await hide('a');
  await hide('c');
  const body = await (await fetch(`${base}/api/feed-hidden`)).json();
  const ids = (body.items || []).map((i) => i.id);
  assert.deepEqual(ids.sort(), ['a', 'c'], 'exactly the hidden items');
  assert.strictEqual(body.total, 2);
  assert.ok(body.items.every((i) => i.title && i.id), 'items are shaped for card rendering');
});

test('RBAC: GET /api/feed-hidden never leaks a SINCE-restricted item (the v1.80 list-leak class)', async () => {
  // A member hides an item they can see, THEN an admin restricts its folder for
  // them. The restore list must drop it - id AND title - not leak it.
  seed({ secret: item('secret', { folderName: 'Vault', filePath: '/media/Vault/secret.mp4' }), plain: item('plain') });
  const kid = __mintTestSession({ username: 'kidhide', role: 'member' });
  await fetch(`${base}/api/feed-hidden/secret`, { method: 'POST', headers: { Cookie: kid.cookie } });
  await fetch(`${base}/api/feed-hidden/plain`, { method: 'POST', headers: { Cookie: kid.cookie } });

  // Before restriction: both are in the member's restore list.
  let body = await (await fetch(`${base}/api/feed-hidden`, { headers: { Cookie: kid.cookie } })).json();
  assert.deepEqual((body.items || []).map((i) => i.id).sort(), ['plain', 'secret']);

  // Restrict the member from the 'Vault' folder.
  userStore.setRestrictions(kid.user.id, [{ kind: 'folder', value: 'Vault' }]);

  body = await (await fetch(`${base}/api/feed-hidden`, { headers: { Cookie: kid.cookie } })).json();
  const ids = (body.items || []).map((i) => i.id);
  assert.ok(!ids.includes('secret'), 'the since-restricted item is NOT leaked in the restore list');
  assert.deepEqual(ids, ['plain'], 'only the still-visible item remains');
  assert.strictEqual(body.total, 1, 'total reflects the RBAC filter, not the raw membership');
  assert.ok(!JSON.stringify(body).includes('Title secret'), 'the restricted item\'s TITLE never appears in the payload');
});

test('ROUTE: POST 404s an unknown id (existence-gated) and never persists it', async () => {
  seed({ a: item('a') });
  const r = await hide('ghost');
  assert.strictEqual(r.status, 404);
  assert.deepEqual(userStore.getFeedHidden(uid), [], 'nothing persisted for a non-existent id');
});

test('ISOLATION: user A hiding an item does not remove it from user B\'s grid', async () => {
  seed({ a: item('a'), b: item('b') });
  await hide('a'); // A (the authed admin) hides a

  // A second user with their own session (mints its own account + cookie).
  const other = __mintTestSession({ username: 'mate', role: 'member' });
  const res = await fetch(`${base}/api/home?view=grid&filter=all&limit=100`, { headers: { Cookie: other.cookie } });
  const body = await res.json();
  const ids = (body.items || []).map((i) => i.id);
  assert.ok(ids.includes('a'), 'B still sees the item A hid');
  assert.ok(ids.includes('b'));
});
