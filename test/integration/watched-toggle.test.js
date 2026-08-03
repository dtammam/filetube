'use strict';

// [INTEGRATION] v1.72 (cap 6) - the manual watched latch routes:
// POST /api/watched/:id (mark watched now, idempotent, existence-gated)
// DELETE /api/watched/:id (the un-watch verb - history-row-delete
// semantics: staged ping + progress + latch all clear, so a >=90% item's
// toggle actually releases instead of re-deriving 'watched').
// Actor-scoped at the ROUTE layer (a new per-user route family gets its
// wrong-user assertions in the birth commit - the v1.71 W4 rule), plus the
// v1.64 empty-id/trailing-slash aliasing check.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-watchedtoggle-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, __mintTestSession, userStore } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, uid;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const auth = authenticateFetch(server, base);
  uid = auth.user.id;
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: {
      wtA: { id: 'wtA', title: 'wtA', filePath: '/media/wtA.mp4', folderName: 'media', type: 'video', ext: '.mp4', duration: 100, size: 1000, addedAt: 5000 },
      wtB: { id: 'wtB', title: 'wtB', filePath: '/media/wtB.mp4', folderName: 'media', type: 'video', ext: '.mp4', duration: 100, size: 1000, addedAt: 5000 },
    },
    liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const postJson = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

test('POST /api/watched/:id latches; the detail watchState and the watch=watched filter both flip; a duplicate POST preserves the original completed_at', async () => {
  const r = await postJson('/api/watched/wtA');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await r.json(), { success: true, watched: true });
  assert.deepStrictEqual(userStore.getWatchedIds(uid), ['wtA']);
  const stamp1 = userStore.getWatchedTimes(uid).wtA;

  const detail = await (await fetch(`${base}/api/videos/wtA`)).json();
  assert.strictEqual(detail.watchState, 'watched', 'the detail read side derives from the latch');
  const filtered = await (await fetch(`${base}/api/videos?watch=watched`)).json();
  assert.deepStrictEqual(filtered.items.map((i) => i.id), ['wtA']);

  await postJson('/api/watched/wtA'); // duplicate
  assert.strictEqual(userStore.getWatchedTimes(uid).wtA, stamp1, 'markWatched no-ops on an existing row (the playback invariant)');
});

test('DELETE /api/watched/:id is the full un-watch verb: staged ping + progress + latch all clear, watchState returns to new', async () => {
  // A fully-watched item: latch + a 95% position, PLUS a staged (unflushed)
  // ping - the resurrection vector the handler must purge synchronously.
  userStore.setProgress(uid, 'wtB', { timestamp: 95, duration: 100, updatedAt: '2026-08-01T00:00:00Z' });
  await postJson('/api/watched/wtB');
  await postJson('/api/progress', { id: 'wtB', timestamp: 96, duration: 100 }); // staged in the coalescer

  const r = await fetch(`${base}/api/watched/wtB`, { method: 'DELETE' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await r.json(), { success: true, watched: false });

  assert.ok(!userStore.getWatchedIds(uid).includes('wtB'), 'latch cleared');
  assert.strictEqual(userStore.getOneProgress(uid, 'wtB'), null, 'position cleared - un-watch would otherwise re-derive watched at >=90%');
  const detail = await (await fetch(`${base}/api/videos/wtB`)).json();
  assert.strictEqual(detail.watchState, 'new', 'no staged ping resurrected the state');
  assert.strictEqual(detail.progress, 0);
});

test('existence + junk-key guards: unknown id 404s; __proto__ never mints a row; the empty-id form never aliases onto anything', async () => {
  assert.strictEqual((await postJson('/api/watched/nope')).status, 404);
  assert.strictEqual((await postJson('/api/watched/__proto__')).status, 404, 'own-property gate (the v1.42 lesson)');
  const empty = await fetch(`${base}/api/watched/`, { method: 'DELETE' });
  assert.strictEqual(empty.status, 404, 'no collection route exists to alias onto (the v1.64 class)');
});

test('actor isolation at the route layer: a second session\'s toggle touches ONLY its own rows', async () => {
  await postJson('/api/watched/wtA'); // first user latched (idempotent if already)
  const second = __mintTestSession({ username: 'watchedOther' });
  const asOther = (p, method) => fetch(`${base}${p}`, { method, headers: { Cookie: second.cookie } });

  // The second user marks the SAME id watched, then un-watches it.
  assert.strictEqual((await asOther('/api/watched/wtA', 'POST')).status, 200);
  assert.ok(userStore.getWatchedIds(second.user.id).includes('wtA'));
  assert.strictEqual((await asOther('/api/watched/wtA', 'DELETE')).status, 200);
  assert.ok(!userStore.getWatchedIds(second.user.id).includes('wtA'));

  // The first user's latch survived both of the second user's writes.
  assert.ok(userStore.getWatchedIds(uid).includes('wtA'), 'wrong-user writes never cross the user_id scope');
});
