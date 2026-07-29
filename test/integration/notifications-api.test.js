'use strict';

// [INTEGRATION] v1.51 notification bell -- the five /api/notifications
// endpoints against the REAL app: the three-way visibility gate (module env,
// sub count, settings toggle), the joined panel payload, two-tier
// seen/read/clear semantics over HTTP, per-user isolation with two live
// sessions, and the settings-toggle round-trip. Auth is the real gate
// (patched-fetch helper); the census suite separately proves 401s.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-notifapi-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, updateDatabase, userStore, __resetDatabaseForTests,
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
  delete process.env.FILETUBE_YTDLP_ENABLED;
});

// The gate needs: module env ON + >=1 subscription + toggle not-false. This
// arms the first two and seeds one indexed item the feed rows can join.
//
// FEED TIMES anchor to the ADMIN ACCOUNT's creation moment plus a few ms:
// they must be strictly AFTER the account (a stateless user's badge
// watermark defaults to created_at, so pre-account rows correctly never
// badge) yet strictly BEFORE the server's own Date.now() when seen/clear
// stamp their watermarks mid-test. A fixed literal fails the first
// constraint; "now + offset" fails the second. item.addedAt stays a fixed
// literal (the join payload does not depend on the account clock).
const ITEM_ADDED_AT = Date.UTC(2026, 5, 20, 10, 0, 0);
let T0;
async function armFeature() {
  // auth.user is the publicUser projection (no createdAt) -- read the full
  // row for the account clock.
  T0 = Date.parse(userStore.getById(auth.user.id).createdAt) + 2;
  assert.ok(Number.isFinite(T0), 'fixture anchor must be a real timestamp');
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.subscriptions.push({ id: 'sub1', channelUrl: 'https://www.youtube.com/@sömechannel', name: 'Söme Channel', order: 0 });
    db.metadata['mediä-1'] = {
      id: 'mediä-1', name: 'Clïp One.mp4', title: 'Clïp One', type: 'video', ext: '.mp4',
      filePath: '/lib/Clïp One.mp4', size: 10, addedAt: ITEM_ADDED_AT,
      folderName: 'Söme Channel', channelName: 'Söme Channel', hasThumbnail: true,
    };
    db.metadata['mediä-2'] = {
      id: 'mediä-2', name: 'Söng Two.m4a', title: 'Söng Two', type: 'audio', ext: '.m4a',
      filePath: '/lib/Söng Two.m4a', size: 10, addedAt: ITEM_ADDED_AT + 1000,
      folderName: 'Söme Channel',
    };
  });
  userStore.recordNotifications([
    { mediaId: 'mediä-1', createdAt: T0 },
    { mediaId: 'mediä-2', createdAt: T0 + 2 },
  ]);
}

test('the three-way visibility gate: module off, zero subs, and toggle off each 404 every endpoint', async () => {
  // 1. Module env off (but subs + rows exist).
  await armFeature();
  delete process.env.FILETUBE_YTDLP_ENABLED;
  for (const [method, url] of [['GET', '/api/notifications'], ['GET', '/api/notifications/badge'], ['POST', '/api/notifications/seen'], ['POST', '/api/notifications/read'], ['POST', '/api/notifications/clear']]) {
    const res = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    assert.equal(res.status, 404, `${method} ${url} must 404 with the module off`);
  }

  // 2. Module on, zero subscriptions.
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  await updateDatabase((db) => { store.ensureYtdlp(db).subscriptions.length = 0; });
  assert.equal((await fetch(`${base}/api/notifications/badge`)).status, 404, 'no subs -> no bell (decision 9)');

  // 3. Subs back, toggle off.
  await updateDatabase((db) => {
    store.ensureYtdlp(db).subscriptions.push({ id: 'sub1', channelUrl: 'https://www.youtube.com/@x', name: 'X', order: 0 });
    db.settings.notificationsEnabled = false;
  });
  assert.equal((await fetch(`${base}/api/notifications/badge`)).status, 404, 'toggle off -> no bell');
});

test('panel payload: rows join the CURRENT item (title/channel/type/thumbnail), phantom media filtered, badge counts', async () => {
  await armFeature();
  userStore.recordNotifications([{ mediaId: 'gone-mediä', createdAt: T0 + 4 }]);

  const badge = await (await fetch(`${base}/api/notifications/badge`)).json();
  assert.equal(badge.count, 3, 'all three rows are unseen (feed-level), including the phantom');

  const { items, unseenCount } = await (await fetch(`${base}/api/notifications`)).json();
  assert.equal(unseenCount, 3);
  assert.deepEqual(items.map((i) => i.mediaId), ['mediä-2', 'mediä-1'], 'newest first; the phantom row is filtered by the join net');
  const video = items.find((i) => i.mediaId === 'mediä-1');
  assert.equal(video.title, 'Clïp One');
  assert.equal(video.channelName, 'Söme Channel');
  assert.equal(video.type, 'video');
  assert.equal(video.hasThumbnail, true);
  assert.equal(video.unread, true);
  assert.equal(video.createdAt, T0);
  const audio = items.find((i) => i.mediaId === 'mediä-2');
  assert.equal(audio.type, 'audio');
  assert.equal(audio.channelName, '', 'no captured channel -> empty string, the client derives from folderName');
  assert.equal(audio.folderName, 'Söme Channel');
});

test('two-tier semantics over HTTP: seen zeroes the badge but keeps dots; read drops a dot; clear empties the panel', async () => {
  await armFeature();

  assert.equal((await (await fetch(`${base}/api/notifications/badge`)).json()).count, 2);
  const seenRes = await fetch(`${base}/api/notifications/seen`, { method: 'POST' });
  assert.equal(seenRes.status, 200);
  assert.equal((await (await fetch(`${base}/api/notifications/badge`)).json()).count, 0, 'opening the panel zeroed the badge');

  let { items } = await (await fetch(`${base}/api/notifications`)).json();
  assert.ok(items.every((i) => i.unread === true), 'dots survive mark-seen (two-tier)');

  const readRes = await fetch(`${base}/api/notifications/read`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: items[0].id }),
  });
  assert.equal(readRes.status, 200);
  ({ items } = await (await fetch(`${base}/api/notifications`)).json());
  assert.equal(items[0].unread, false, 'tapped row lost its dot');
  assert.equal(items[1].unread, true, 'untapped row kept its dot');

  for (const badId of [items[0].id + 999, 'seven', 1.5, null]) {
    const bad = await fetch(`${base}/api/notifications/read`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: badId }),
    });
    assert.equal(bad.status, 400, `phantom/garbage id ${JSON.stringify(badId)} must 400`);
  }

  const clearRes = await fetch(`${base}/api/notifications/clear`, { method: 'POST' });
  assert.equal(clearRes.status, 200);
  const after = await (await fetch(`${base}/api/notifications`)).json();
  assert.deepEqual(after.items, [], 'clear-all emptied the panel');
  assert.equal(after.unseenCount, 0);
});

test('per-user isolation over HTTP: one user clearing never touches the other session', async () => {
  await armFeature();
  const { __mintTestSession } = require('../../server');
  const other = __mintTestSession({ username: 'wife2', role: 'member' });
  const asOther = (url, opts = {}) => fetch(`${base}${url}`, { ...opts, headers: { ...(opts.headers || {}), Cookie: other.cookie } });

  await fetch(`${base}/api/notifications/clear`, { method: 'POST' }); // admin clears

  assert.equal((await (await fetch(`${base}/api/notifications`)).json()).items.length, 0, 'admin panel empty');
  const otherView = await (await asOther('/api/notifications')).json();
  assert.equal(otherView.items.length, 2, "the other user's panel is untouched");
  assert.ok(otherView.items.every((i) => i.unread === true), 'and their dots survive too');
  // (No badge assert for the second user: their account postdates the feed
  // rows, so the created_at default correctly reads 0 -- badge isolation is
  // proven at the store layer in test/unit/notification-store.test.js.)
});

test('the settings toggle round-trips through POST /api/settings and gates the bell live', async () => {
  await armFeature();
  assert.equal((await fetch(`${base}/api/notifications/badge`)).status, 200);

  let res = await fetch(`${base}/api/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notificationsEnabled: false }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).notificationsEnabled, false);
  assert.equal((await fetch(`${base}/api/notifications/badge`)).status, 404, 'toggle off took effect immediately');

  // The feed still accumulates while off (decision 8).
  userStore.recordNotifications([{ mediaId: 'mediä-1', createdAt: T0 + 6 }]);

  res = await fetch(`${base}/api/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notificationsEnabled: true }),
  });
  assert.equal((await res.json()).notificationsEnabled, true);
  assert.equal((await fetch(`${base}/api/notifications/badge`)).status, 200, 'and back on');
  const { items } = await (await fetch(`${base}/api/notifications`)).json();
  assert.equal(items.filter((i) => i.mediaId === 'mediä-1').length, 1, 'history accumulated while off has no gap');

  const bad = await fetch(`${base}/api/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notificationsEnabled: 'yes' }),
  });
  assert.equal(bad.status, 400, 'non-boolean toggle 400s like every typed key');
});
