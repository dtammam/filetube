'use strict';

// [UNIT] v1.68 T1 - the per-user notification DISMISSAL lane (schema v8
// `user_notification_dismissals` + lib/auth/store.js verbs) against a real
// temp filetube.db. Dean's rulings 1-3: dismissal is PER-USER (the row
// survives for everyone else, the clear-all discipline), reachable by row
// id (the panel X) and by media id (the play hook), and the lane rides
// every carrier seam the reads lane rides: cap eviction, replace-on-same-
// media, the media-delete purge, the raw-feed restore snapshot, and the
// per-user backup bundle halves.
//
// Fixture spellings deliberately DIVERGENT (v1.41.9): non-hex ids with
// case + accents; timestamps are explicit offsets, never near-today
// literals (v1.37).

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
const createUserStore = require('../../lib/auth/store');

let dir, adapter, store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dismissstore-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  store = createUserStore(adapter);
});
afterEach(() => {
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ACCOUNT_ISO = '2026-01-10T00:00:00.000Z';
const ACCOUNT_MS = Date.parse(ACCOUNT_ISO);
const HOUR = 60 * 60 * 1000;

function mkAdmin(name = 'Dean') {
  return store.createFirstAdmin({ username: name, displayName: name, passwordHash: 'h' }, null, ACCOUNT_ISO);
}
function mkUser(name) {
  return store.createUser({ username: name, displayName: name, passwordHash: 'h', role: 'member' }, ACCOUNT_ISO);
}
function feed(mediaId, offsetHours) {
  store.recordNotifications([{ mediaId, createdAt: ACCOUNT_MS + offsetHours * HOUR }]);
  return adapter.sql.prepare('SELECT id FROM notifications WHERE media_id = ?').get(mediaId).id;
}

test('schema v8: the dismissals table exists on a fresh adapter', () => {
  const row = adapter.sql
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'user_notification_dismissals'")
    .get();
  assert.ok(row, 'user_notification_dismissals must exist');
  assert.ok(adapter.sql.prepare('PRAGMA user_version').get().user_version >= 8, 'user_version bumped');
});

test('dismissNotification: hides the row for THAT user only (panel + badge agree); phantom id returns false', () => {
  const dean = mkAdmin();
  const kim = mkUser('kim2');
  const id = feed('Vídeo-Ålpha', 1);

  assert.strictEqual(store.dismissNotification(dean.id, id, ACCOUNT_MS + 2 * HOUR), true);
  assert.deepStrictEqual(store.listNotifications(dean.id).items, [], 'dismissed row leaves Dean\'s panel');
  assert.strictEqual(store.countUnseenNotifications(dean.id), 0, 'and his badge');
  assert.strictEqual(store.listNotifications(kim.id).items.length, 1, 'Kìm still sees it');
  assert.strictEqual(store.countUnseenNotifications(kim.id), 1, 'with her badge intact');

  assert.strictEqual(store.dismissNotification(dean.id, 999999, ACCOUNT_MS), false, 'phantom id -> false (route 400s)');
  assert.strictEqual(store.dismissNotification(dean.id, id, ACCOUNT_MS + 3 * HOUR), true, 'repeat dismiss stays true (idempotent)');
});

test('dismissNotificationByMedia: the play hook - hides by media id, silent no-op when no row exists', () => {
  const dean = mkAdmin();
  feed('Vídeo-Bèta', 1);
  assert.strictEqual(store.dismissNotificationByMedia(dean.id, 'Vídeo-Bèta', ACCOUNT_MS + 2 * HOUR), true);
  assert.deepStrictEqual(store.listNotifications(dean.id).items, []);
  assert.strictEqual(store.dismissNotificationByMedia(dean.id, 'never-in-feed', ACCOUNT_MS), false, 'a play with no feed row is not an error');
});

test('replace-on-same-media makes the row NEW again: a prior dismissal does not survive a re-download', () => {
  const dean = mkAdmin();
  feed('Vídeo-Gamma', 1);
  store.dismissNotificationByMedia(dean.id, 'Vídeo-Gamma', ACCOUNT_MS + 2 * HOUR);
  assert.deepStrictEqual(store.listNotifications(dean.id).items, []);
  feed('Vídeo-Gamma', 5); // re-download -> replace semantics
  const items = store.listNotifications(dean.id).items;
  assert.strictEqual(items.length, 1, 'the re-downloaded row is visible again (it IS new again)');
});

test('cap eviction sweeps dismissals with their rows (no orphan growth)', () => {
  const dean = mkAdmin();
  const first = feed('Vídeo-Evict-0', 0);
  store.dismissNotification(dean.id, first, ACCOUNT_MS + HOUR);
  for (let i = 1; i <= 200; i++) feed(`Vídeo-Evict-${i}`, i); // pushes the first row past the 200 cap
  const orphan = adapter.sql
    .prepare('SELECT COUNT(*) AS c FROM user_notification_dismissals WHERE notification_id = ?')
    .get(first).c;
  assert.strictEqual(orphan, 0, 'the evicted row\'s dismissal went with it');
});

test('media delete purges dismissals (the id-keyed-carrier lifecycle)', () => {
  const dean = mkAdmin();
  const id = feed('Vídeo-Delta', 1);
  store.dismissNotification(dean.id, id, ACCOUNT_MS + 2 * HOUR);
  store.removeMediaState('Vídeo-Delta');
  const left = adapter.sql.prepare('SELECT COUNT(*) AS c FROM user_notification_dismissals').get().c;
  assert.strictEqual(left, 0, 'no dangling dismissal after the media is gone');
});

test('replaceAllNotificationsRaw preserves dismissals by MEDIA id across the feed-id regeneration (the reads QA-W1 pattern)', () => {
  const dean = mkAdmin();
  feed('Vídeo-Keep', 1);
  feed('Vídeo-Other', 2);
  store.dismissNotificationByMedia(dean.id, 'Vídeo-Keep', ACCOUNT_MS + 3 * HOUR);
  // A feed-only restore (no users array) regenerates feed ids in place.
  store.replaceAllNotificationsRaw([
    { mediaId: 'Vídeo-Keep', createdAt: ACCOUNT_MS + 1 * HOUR },
    { mediaId: 'Vídeo-Other', createdAt: ACCOUNT_MS + 2 * HOUR },
  ]);
  const items = store.listNotifications(dean.id).items.map((i) => i.mediaId);
  assert.deepStrictEqual(items, ['Vídeo-Other'], 'the dismissal re-resolved onto the regenerated row');
});

test('gate W1: a NON-first user\'s dismiss verbs write for THAT user - the admin\'s rows survive (kills the hardcoded-id-1 mutants)', () => {
  // Every earlier writer-test acted as user id 1, so a wrong-user write
  // (hardcoded id, swapped variable) shipped green. Here the ACTOR is the
  // second user for BOTH write verbs; both users' panels are asserted.
  const dean = mkAdmin();
  const kim = mkUser('kim2');
  assert.notStrictEqual(kim.id, 1, 'fixture sanity: the actor must not be user 1');
  const idA = feed('Vídeo-W1a', 1);
  feed('Vídeo-W1b', 2);

  assert.strictEqual(store.dismissNotification(kim.id, idA, ACCOUNT_MS + 3 * HOUR), true);
  assert.strictEqual(store.dismissNotificationByMedia(kim.id, 'Vídeo-W1b', ACCOUNT_MS + 3 * HOUR), true);
  assert.deepStrictEqual(store.listNotifications(kim.id).items, [], 'the ACTOR\'s panel emptied');
  assert.strictEqual(store.countUnseenNotifications(kim.id), 0);
  assert.strictEqual(store.listNotifications(dean.id).items.length, 2, 'the admin (user 1) keeps BOTH rows');
  assert.strictEqual(store.countUnseenNotifications(dean.id), 2, 'and the admin\'s badge');
});

test('gate W3: a rekey COLLISION scrubs the collided row\'s dismissals with its reads (no orphan)', () => {
  const dean = mkAdmin();
  const collidedId = feed('Vídeo-Dest', 1);
  feed('Vídeo-Src', 2);
  store.dismissNotification(dean.id, collidedId, ACCOUNT_MS + 3 * HOUR);
  store.rekeyMediaState('Vídeo-Src', 'Vídeo-Dest'); // destination row already exists -> the collision scrub
  const orphans = adapter.sql
    .prepare('SELECT COUNT(*) AS c FROM user_notification_dismissals WHERE notification_id = ?')
    .get(collidedId).c;
  assert.strictEqual(orphans, 0, 'the collided row\'s dismissal went with it');
});

test('gate S1: the orphan-hygiene deletes are COUNT-bound (replace-on-same-media and the raw-feed restore leave zero stray rows)', () => {
  const dean = mkAdmin();
  const total = () => adapter.sql.prepare('SELECT COUNT(*) AS c FROM user_notification_dismissals').get().c;

  feed('Vídeo-S1', 1);
  store.dismissNotificationByMedia(dean.id, 'Vídeo-S1', ACCOUNT_MS + 2 * HOUR);
  assert.strictEqual(total(), 1);
  feed('Vídeo-S1', 5); // replace-on-same-media
  assert.strictEqual(total(), 0, 'the replace loop deleted the old row\'s dismissal outright (not merely detached it)');

  feed('Vídeo-S1b', 6);
  store.dismissNotificationByMedia(dean.id, 'Vídeo-S1b', ACCOUNT_MS + 7 * HOUR);
  assert.strictEqual(total(), 1);
  store.replaceAllNotificationsRaw([{ mediaId: 'Vídeo-OTHER', createdAt: ACCOUNT_MS + 8 * HOUR }]);
  assert.strictEqual(total(), 0, 'a feed replace that drops the row drops its dismissal (the snapshot re-resolve found no home)');
});

test('backup: per-user bundles carry dismissals; restore re-resolves them; a pre-v1.68 bundle (absent key) is legal', () => {
  const dean = mkAdmin();
  feed('Vídeo-Bundle', 1);
  store.dismissNotificationByMedia(dean.id, 'Vídeo-Bundle', ACCOUNT_MS + 2 * HOUR);

  const users = store.exportUsersForBackup();
  const mine = users.find((u) => u.username === 'Dean');
  assert.ok(Array.isArray(mine.notificationDismissals), 'export carries the lane');
  assert.strictEqual(mine.notificationDismissals[0].mediaId, 'Vídeo-Bundle');

  // Round-trip into the same instance (feed first, then users - the restore order).
  adapter.begin();
  try {
    store.replaceAllNotificationsRaw([{ mediaId: 'Vídeo-Bundle', createdAt: ACCOUNT_MS + 1 * HOUR }]);
    store.replaceAllUsersRaw(users, ACCOUNT_MS + 5 * HOUR);
    adapter.commit();
  } catch (e) { adapter.rollback(); throw e; }
  const restoredDean = store.getByUsername('Dean');
  assert.deepStrictEqual(store.listNotifications(restoredDean.id).items, [], 'dismissal survives the round-trip');

  // Absent key (pre-v1.68 bundle): strip it and restore - no throw, row visible.
  const legacy = store.exportUsersForBackup().map((u) => { const c = { ...u }; delete c.notificationDismissals; return c; });
  adapter.begin();
  try {
    store.replaceAllNotificationsRaw([{ mediaId: 'Vídeo-Bundle', createdAt: ACCOUNT_MS + 1 * HOUR }]);
    store.replaceAllUsersRaw(legacy, ACCOUNT_MS + 6 * HOUR);
    adapter.commit();
  } catch (e) { adapter.rollback(); throw e; }
  const dean2 = store.getByUsername('Dean');
  assert.strictEqual(store.listNotifications(dean2.id).items.length, 1, 'absent lane restores with nothing dismissed');
});
