'use strict';

// [INTEGRATION] v1.68 - the per-user notification dismissal lane over HTTP
// against the REAL app (Dean's rulings 1-3): POST /api/notifications/dismiss
// (phantom-id 400 discipline, per-user isolation with two live sessions,
// badge/panel coherence) and - from T2 - the play hook (POST
// /api/videos/:id/view dismisses the player's own feed row, any play path,
// no resurrection on re-play). Harness mirrors notifications-api.test.js
// (same three-way feature gate, same account-clock anchoring).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dismissapi-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, updateDatabase, userStore, __resetDatabaseForTests, __mintTestSession,
} = require('../../server');
const store = require('../../lib/ytdlp/store');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
});

after(async () => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  await __resetDatabaseForTests();
});

const ITEM_ADDED_AT = Date.UTC(2026, 5, 20, 10, 0, 0);
let T0;
async function armFeature() {
  T0 = Date.parse(userStore.getById(auth.user.id).createdAt) + 2;
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.subscriptions.push({ id: 'sub1', channelUrl: 'https://www.youtube.com/@sömechannel', name: 'Söme Channel', order: 0 });
    db.metadata['mediä-A'] = {
      id: 'mediä-A', name: 'Clïp A.mp4', title: 'Clïp A', type: 'video', ext: '.mp4',
      filePath: '/lib/Clïp A.mp4', size: 10, addedAt: ITEM_ADDED_AT,
      folderName: 'Söme Channel', channelName: 'Söme Channel',
    };
    db.metadata['mediä-B'] = {
      id: 'mediä-B', name: 'Clïp B.mp4', title: 'Clïp B', type: 'video', ext: '.mp4',
      filePath: '/lib/Clïp B.mp4', size: 10, addedAt: ITEM_ADDED_AT + 1000,
      folderName: 'Söme Channel',
    };
  });
  userStore.recordNotifications([
    { mediaId: 'mediä-A', createdAt: T0 },
    { mediaId: 'mediä-B', createdAt: T0 + 2 },
  ]);
}

async function jpost(url, body) {
  return fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
}
async function panel() {
  return (await (await fetch(`${base}/api/notifications`)).json());
}
async function badge() {
  return (await (await fetch(`${base}/api/notifications/badge`)).json()).count;
}

test('dismiss: the row leaves MY panel and badge; the other user still has it; phantom/garbage ids 400', async () => {
  await armFeature();
  const mine = await panel();
  assert.equal(mine.items.length, 2);
  const target = mine.items.find((i) => i.mediaId === 'mediä-A');

  // A second live session (the notifications-api two-session pattern).
  const other = __mintTestSession({ username: 'seconduser', role: 'member' });

  assert.equal((await jpost('/api/notifications/dismiss', { id: target.id })).status, 200);
  const after1 = await panel();
  assert.deepEqual(after1.items.map((i) => i.mediaId), ['mediä-B'], 'only the dismissed row left MY panel');
  assert.equal(await badge(), 1, 'badge agrees');

  const otherPanel = await (await fetch(`${base}/api/notifications`, { headers: { Cookie: other.cookie } })).json();
  assert.equal(otherPanel.items.length, 2, 'the other user still sees both rows');

  for (const bad of [{ id: 999999 }, { id: 'x' }, {}, { id: 1.5 }]) {
    assert.equal((await jpost('/api/notifications/dismiss', bad)).status, 400, `payload ${JSON.stringify(bad)} must 400`);
  }
  // Idempotent repeat on a real (already-dismissed) id stays 200.
  assert.equal((await jpost('/api/notifications/dismiss', { id: target.id })).status, 200);
});

test('dismiss vs seen/read/clear interplay: dismissing an unread row drops the badge; clear-all still works after dismissals', async () => {
  await armFeature();
  assert.equal(await badge(), 2);
  const mine = await panel();
  assert.equal((await jpost('/api/notifications/dismiss', { id: mine.items[0].id })).status, 200);
  assert.equal(await badge(), 1, 'an unread dismissed row stops counting');
  assert.equal((await jpost('/api/notifications/clear')).status, 200);
  assert.equal(await badge(), 0);
  assert.equal((await panel()).items.length, 0);
});

test('the feature gate covers the new route: module off -> 404', async () => {
  await armFeature();
  delete process.env.FILETUBE_YTDLP_ENABLED;
  assert.equal((await jpost('/api/notifications/dismiss', { id: 1 })).status, 404);
});
