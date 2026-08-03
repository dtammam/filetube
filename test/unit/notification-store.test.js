'use strict';

// [UNIT] v1.51 - the notification-bell store surface (lib/auth/store.js +
// the schema v5 tables) against a real temp filetube.db. Covers: feed
// insert/replace/cap semantics, the per-user seen/read/cleared watermarks
// (incl. the account-created_at default for stateless users), per-user
// isolation, the EIGHTH id-keyed-carrier lifecycle (removeMediaState /
// rekeyMediaState), upgrade seeding, and the backup bundle round-trip in
// all three bundle shapes (state object / explicit null / pre-v1.51 absent).
//
// Fixture spellings are deliberately DIVERGENT from anything the code could
// invent (v1.41.9 lesson): media ids are non-hex strings with case + accents.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
const createUserStore = require('../../lib/auth/store');

let dir, adapter, store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-notifstore-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  store = createUserStore(adapter);
});
afterEach(() => {
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// Account creation moment; every feed timestamp below is an explicit offset
// from this (no near-today literals - v1.37 lesson).
const ACCOUNT_ISO = '2026-01-10T00:00:00.000Z';
const ACCOUNT_MS = Date.parse(ACCOUNT_ISO);
const HOUR = 60 * 60 * 1000;

function mkAdmin(name = 'Dean') {
  return store.createFirstAdmin({ username: name, displayName: name, passwordHash: 'h' }, null, ACCOUNT_ISO);
}

test('schema v5: notification tables exist on a fresh adapter, and a v4 db forward-migrates', () => {
  const names = () => adapter.sql
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%notification%' ORDER BY name")
    .all().map((r) => r.name);
  // v1.68: user_notification_dismissals joins the family (schema v8).
  assert.deepEqual(names(), ['notifications', 'user_notification_dismissals', 'user_notification_reads', 'user_notification_state']);
  assert.equal(adapter.sql.prepare('PRAGMA user_version').get().user_version, 11);

  // Simulate a v1.50 file: drop the v5 tables, stamp user_version 4, reopen.
  adapter.sql.exec('DROP TABLE user_notification_reads; DROP TABLE user_notification_state; DROP TABLE notifications;');
  adapter.sql.exec('PRAGMA user_version = 4');
  adapter.close();
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  store = createUserStore(adapter);
  assert.deepEqual(names(), ['notifications', 'user_notification_dismissals', 'user_notification_reads', 'user_notification_state'], 'v4 -> v8 recreated the tables');
  assert.equal(adapter.sql.prepare('PRAGMA user_version').get().user_version, 11);
});

test('recordNotifications: valid rows land, garbage is skipped (never coerced), return value counts inserts', () => {
  const n = store.recordNotifications([
    { mediaId: 'Vïd-Alpha', createdAt: ACCOUNT_MS + 1 * HOUR },
    { mediaId: '', createdAt: ACCOUNT_MS },                    // empty id
    { mediaId: 'no-date' },                                     // missing createdAt
    { mediaId: 'nan-date', createdAt: NaN },                    // NaN
    { mediaId: 'neg-date', createdAt: -5 },                     // non-positive
    { mediaId: 'str-date', createdAt: '17' },                   // string number is NOT accepted
    null,
  ]);
  assert.equal(n, 1);
  assert.equal(store.countNotifications(), 1);
});

test('replace-on-same-media: a re-download re-tops the feed with a FRESH id and drops old reads', () => {
  const u = mkAdmin();
  store.recordNotifications([
    { mediaId: 'Vïd-Old', createdAt: ACCOUNT_MS + 1 * HOUR },
    { mediaId: 'Vïd-Other', createdAt: ACCOUNT_MS + 2 * HOUR },
  ]);
  const first = store.listNotifications(u.id).items.find((i) => i.mediaId === 'Vïd-Old');
  assert.ok(store.markNotificationRead(u.id, first.id, ACCOUNT_MS + 3 * HOUR));
  assert.equal(store.listNotifications(u.id).items.find((i) => i.mediaId === 'Vïd-Old').unread, false);

  store.recordNotifications([{ mediaId: 'Vïd-Old', createdAt: ACCOUNT_MS + 9 * HOUR }]);
  const { items } = store.listNotifications(u.id);
  assert.equal(items.length, 2, 'replaced, not duplicated');
  assert.equal(items[0].mediaId, 'Vïd-Old', 're-download re-sorts to the top');
  assert.notEqual(items[0].id, first.id, 'fresh id');
  assert.equal(items[0].unread, true, 'old read does NOT carry to the new event');
});

test('cap eviction: only the newest 200 survive, and evicted rows take their reads with them', () => {
  const u = mkAdmin();
  const entries = [];
  for (let i = 0; i < 205; i++) entries.push({ mediaId: `bulk-${i}`, createdAt: ACCOUNT_MS + i * 1000 });
  store.recordNotifications(entries.slice(0, 3));
  const oldest = store.listNotifications(u.id).items.at(-1);
  assert.ok(store.markNotificationRead(u.id, oldest.id, ACCOUNT_MS + HOUR), 'read banked on a row destined for eviction');
  store.recordNotifications(entries.slice(3));
  assert.equal(store.countNotifications(), 200);
  const ids = store.listNotifications(u.id).items.map((i) => i.mediaId);
  assert.equal(ids.length, 200);
  assert.ok(!ids.includes('bulk-0') && !ids.includes('bulk-4'), 'oldest evicted');
  assert.ok(ids.includes('bulk-204') && ids.includes('bulk-5'), 'newest 200 kept');
  assert.equal(adapter.sql.prepare('SELECT COUNT(*) AS c FROM user_notification_reads').get().c, 0, 'evicted row took its read along');
});

test('stateless-user default: the badge never counts feed rows older than the account', () => {
  const u = mkAdmin();
  store.recordNotifications([
    { mediaId: 'before-account', createdAt: ACCOUNT_MS - 5 * HOUR },
    { mediaId: 'after-account', createdAt: ACCOUNT_MS + 5 * HOUR },
  ]);
  assert.equal(store.countUnseenNotifications(u.id), 1, 'only the post-account row is unseen');
  const { items } = store.listNotifications(u.id);
  assert.equal(items.length, 2, 'the LIST still shows both (cleared_at defaults 0, not created_at)');
});

test('seen/badge lifecycle + watermark monotonicity', () => {
  const u = mkAdmin();
  store.recordNotifications([
    { mediaId: 'a1', createdAt: ACCOUNT_MS + 1 * HOUR },
    { mediaId: 'b2', createdAt: ACCOUNT_MS + 2 * HOUR },
    { mediaId: 'c3', createdAt: ACCOUNT_MS + 3 * HOUR },
  ]);
  assert.equal(store.countUnseenNotifications(u.id), 3);
  store.markNotificationsSeen(u.id, ACCOUNT_MS + 4 * HOUR);
  assert.equal(store.countUnseenNotifications(u.id), 0, 'opening the panel zeroes the badge');
  // A stale/racing writer cannot move the watermark backward.
  store.markNotificationsSeen(u.id, ACCOUNT_MS + 1 * HOUR);
  assert.equal(store.countUnseenNotifications(u.id), 0, 'older mark-seen is a no-op');
  store.recordNotifications([{ mediaId: 'd4', createdAt: ACCOUNT_MS + 5 * HOUR }]);
  assert.equal(store.countUnseenNotifications(u.id), 1, 'a NEW download re-arms the badge');
});

test('read semantics: dot until tapped, phantom ids refused, idempotent', () => {
  const u = mkAdmin();
  store.recordNotifications([{ mediaId: 'tap-me', createdAt: ACCOUNT_MS + HOUR }]);
  store.markNotificationsSeen(u.id, ACCOUNT_MS + 2 * HOUR);
  let row = store.listNotifications(u.id).items[0];
  assert.equal(row.unread, true, 'mark-seen does NOT clear the per-row dot (two-tier semantics)');
  assert.equal(store.markNotificationRead(u.id, row.id + 999, ACCOUNT_MS), false, 'phantom id refused');
  assert.equal(store.markNotificationRead(u.id, 1.5, ACCOUNT_MS), false, 'non-integer refused');
  assert.ok(store.markNotificationRead(u.id, row.id, ACCOUNT_MS + 3 * HOUR));
  assert.ok(store.markNotificationRead(u.id, row.id, ACCOUNT_MS + 4 * HOUR), 'second tap idempotent');
  row = store.listNotifications(u.id).items[0];
  assert.equal(row.unread, false);
});

test('clear-all: panel empties, badge zeroes, and only NEWER events resurface', () => {
  const u = mkAdmin();
  store.recordNotifications([
    { mediaId: 'old-1', createdAt: ACCOUNT_MS + 1 * HOUR },
    { mediaId: 'old-2', createdAt: ACCOUNT_MS + 2 * HOUR },
  ]);
  store.clearNotifications(u.id, ACCOUNT_MS + 3 * HOUR);
  assert.equal(store.listNotifications(u.id).items.length, 0, 'cleared rows leave the panel');
  assert.equal(store.countUnseenNotifications(u.id), 0, 'clear implies seen');
  store.recordNotifications([{ mediaId: 'new-after-clear', createdAt: ACCOUNT_MS + 5 * HOUR }]);
  const { items } = store.listNotifications(u.id);
  assert.deepEqual(items.map((i) => i.mediaId), ['new-after-clear']);
  assert.equal(store.countUnseenNotifications(u.id), 1);
});

test('per-user isolation: A seeing/reading/clearing never leaks to B', () => {
  const a = mkAdmin('A');
  const b = store.createUser({ username: 'B', displayName: 'B', passwordHash: 'h', role: 'member' }, ACCOUNT_ISO);
  store.recordNotifications([
    { mediaId: 'shared-1', createdAt: ACCOUNT_MS + 1 * HOUR },
    { mediaId: 'shared-2', createdAt: ACCOUNT_MS + 2 * HOUR },
  ]);
  store.markNotificationsSeen(a.id, ACCOUNT_MS + 3 * HOUR);
  store.markNotificationRead(a.id, store.listNotifications(a.id).items[0].id, ACCOUNT_MS + 3 * HOUR);
  store.clearNotifications(a.id, ACCOUNT_MS + 4 * HOUR);
  assert.equal(store.listNotifications(a.id).items.length, 0, 'A cleared');
  assert.equal(store.countUnseenNotifications(b.id), 2, 'B badge untouched');
  const bItems = store.listNotifications(b.id).items;
  assert.equal(bItems.length, 2, 'B panel untouched');
  assert.ok(bItems.every((i) => i.unread === true), 'B dots untouched');
});

test('EIGHTH id-keyed carrier: removeMediaState prunes the feed row + reads; rekeyMediaState moves it', () => {
  const u = mkAdmin();
  store.recordNotifications([
    { mediaId: 'doomed', createdAt: ACCOUNT_MS + 1 * HOUR },
    { mediaId: 'moving', createdAt: ACCOUNT_MS + 2 * HOUR },
  ]);
  store.markNotificationRead(u.id, store.listNotifications(u.id).items.find((i) => i.mediaId === 'doomed').id, ACCOUNT_MS + 3 * HOUR);
  store.removeMediaState('doomed');
  assert.deepEqual(store.listNotifications(u.id).items.map((i) => i.mediaId), ['moving'], 'deleted media leaves the feed');
  assert.equal(adapter.sql.prepare('SELECT COUNT(*) AS c FROM user_notification_reads').get().c, 0, 'its reads went with it');

  const movedRead = store.listNotifications(u.id).items[0];
  store.markNotificationRead(u.id, movedRead.id, ACCOUNT_MS + 4 * HOUR);
  store.rekeyMediaState('moving', 'moved-Sürprise');
  const after = store.listNotifications(u.id).items;
  assert.deepEqual(after.map((i) => i.mediaId), ['moved-Sürprise'], 'move re-keys the feed row');
  assert.equal(after[0].id, movedRead.id, 'notification id is stable across a media re-key');
  assert.equal(after[0].unread, false, 'read survives the re-key (it keys by notification id)');
});

test('seedNotifications: history lands read+seen for every EXISTING user; later accounts stay quiet by default', () => {
  const a = mkAdmin('A');
  const b = store.createUser({ username: 'B', displayName: 'B', passwordHash: 'h', role: 'member' }, ACCOUNT_ISO);
  const seededAt = ACCOUNT_MS + 10 * HOUR;
  const n = store.seedNotifications([
    { mediaId: 'seed-1', createdAt: ACCOUNT_MS + 1 * HOUR },
    { mediaId: 'seed-2', createdAt: ACCOUNT_MS + 2 * HOUR },
    { mediaId: 'bogus', createdAt: 'nope' },
  ], seededAt);
  assert.equal(n, 2);
  for (const u of [a, b]) {
    assert.equal(store.countUnseenNotifications(u.id), 0, 'badge 0 after seeding');
    const items = store.listNotifications(u.id).items;
    assert.equal(items.length, 2, 'panel populated');
    assert.ok(items.every((i) => i.unread === false), 'no dots on seeded history');
  }
  // A user created AFTER seeding has no state row; their created_at default
  // must still not badge the seeded history -- and (gate fix, adversarial
  // S2) the rows must not wear dots either: history that predates the
  // account cannot be "new to them".
  const late = store.createUser({ username: 'late', displayName: 'L', passwordHash: 'h', role: 'member' }, new Date(seededAt + HOUR).toISOString());
  assert.equal(store.countUnseenNotifications(late.id), 0);
  const lateItems = store.listNotifications(late.id).items;
  assert.equal(lateItems.length, 2, 'the history itself is visible to them');
  assert.ok(lateItems.every((i) => i.unread === false), 'but none of it is dotted');
});

test('account-age dot suppression: pre-account rows never dot, post-account rows still do', () => {
  const a = mkAdmin();
  store.recordNotifications([{ mediaId: 'before-b', createdAt: ACCOUNT_MS + 1 * HOUR }]);
  const b = store.createUser({ username: 'B', displayName: 'B', passwordHash: 'h', role: 'member' }, new Date(ACCOUNT_MS + 2 * HOUR).toISOString());
  store.recordNotifications([{ mediaId: 'after-b', createdAt: ACCOUNT_MS + 3 * HOUR }]);
  const bItems = store.listNotifications(b.id).items;
  assert.equal(bItems.find((i) => i.mediaId === 'before-b').unread, false, 'predates the account -> no dot');
  assert.equal(bItems.find((i) => i.mediaId === 'after-b').unread, true, 'genuinely new to them -> dot');
  // The original user (older than both rows) keeps both dots.
  assert.ok(store.listNotifications(a.id).items.every((i) => i.unread === true));
});

test('gate fix (QA S1/adversarial W2): a re-key onto an id that ALREADY has a feed row leaves no orphaned reads', () => {
  const u = mkAdmin();
  store.recordNotifications([
    { mediaId: 'mover', createdAt: ACCOUNT_MS + 1 * HOUR },
    { mediaId: 'occupant', createdAt: ACCOUNT_MS + 2 * HOUR },
  ]);
  const occupantRow = store.listNotifications(u.id).items.find((i) => i.mediaId === 'occupant');
  store.markNotificationRead(u.id, occupantRow.id, ACCOUNT_MS + 3 * HOUR);
  store.rekeyMediaState('mover', 'occupant');
  const items = store.listNotifications(u.id).items;
  assert.equal(items.length, 1, 'one row survives the collision');
  assert.equal(items[0].mediaId, 'occupant');
  assert.equal(items[0].createdAt, ACCOUNT_MS + 1 * HOUR, 'the MOVED row is the survivor (the occupant was scrubbed)');
  assert.equal(adapter.sql.prepare('SELECT COUNT(*) AS c FROM user_notification_reads').get().c, 0,
    "the scrubbed occupant's read went with it -- no orphans");
});

test('gate fix (QA W1): a feed-only replace preserves EXISTING users\' reads across the id regeneration', () => {
  const u = mkAdmin();
  store.recordNotifications([
    { mediaId: 'kept-read', createdAt: ACCOUNT_MS + 1 * HOUR },
    { mediaId: 'kept-unread', createdAt: ACCOUNT_MS + 2 * HOUR },
  ]);
  store.markNotificationRead(u.id, store.listNotifications(u.id).items.find((i) => i.mediaId === 'kept-read').id, ACCOUNT_MS + 3 * HOUR);

  // A feed-only restore (no users replace follows -- the QA W1 shape).
  adapter.begin();
  store.replaceAllNotificationsRaw([
    { mediaId: 'kept-read', createdAt: ACCOUNT_MS + 1 * HOUR },
    { mediaId: 'kept-unread', createdAt: ACCOUNT_MS + 2 * HOUR },
    { mediaId: 'brand-new', createdAt: ACCOUNT_MS + 4 * HOUR },
  ]);
  adapter.commit();

  const items = store.listNotifications(u.id).items;
  assert.equal(items.find((i) => i.mediaId === 'kept-read').unread, false, 'the tapped dot did NOT resurrect');
  assert.equal(items.find((i) => i.mediaId === 'kept-unread').unread, true);
  assert.equal(items.find((i) => i.mediaId === 'brand-new').unread, true);
});

test('gate fix (adversarial W3): replaceAllNotificationsRaw enforces the 200 cap, newest kept', () => {
  const rows = [];
  for (let i = 0; i < 240; i++) rows.push({ mediaId: `flood-${i}`, createdAt: ACCOUNT_MS + i * 1000 });
  adapter.begin();
  store.replaceAllNotificationsRaw(rows);
  adapter.commit();
  assert.equal(store.countNotifications(), 200);
  const u = mkAdmin();
  const items = store.listNotifications(u.id).items;
  assert.equal(items[0].mediaId, 'flood-239', 'newest survived');
  assert.ok(!items.some((i) => i.mediaId === 'flood-39'), 'oldest 40 dropped');
});

test('backup round-trip: feed + per-user state/reads survive; the three bundle shapes restore differently', () => {
  const a = mkAdmin('A');
  const b = store.createUser({ username: 'B', displayName: 'B', passwordHash: 'h', role: 'member' }, ACCOUNT_ISO);
  store.recordNotifications([
    { mediaId: 'keep-1', createdAt: ACCOUNT_MS + 1 * HOUR },
    { mediaId: 'keep-2', createdAt: ACCOUNT_MS + 2 * HOUR },
  ]);
  store.markNotificationsSeen(a.id, ACCOUNT_MS + 3 * HOUR);
  store.markNotificationRead(a.id, store.listNotifications(a.id).items[0].id, ACCOUNT_MS + 3 * HOUR);
  // B never touches the panel -> exported state must be null (absence carried honestly).

  const feed = store.exportNotificationsForBackup();
  const users = store.exportUsersForBackup();
  const ua = users.find((u) => u.username === 'A');
  const ub = users.find((u) => u.username === 'B');
  assert.deepEqual(feed.map((f) => f.mediaId), ['keep-1', 'keep-2']);
  assert.equal(ua.notificationState.lastSeenAt, ACCOUNT_MS + 3 * HOUR);
  assert.deepEqual(ua.notificationReads, [{ mediaId: 'keep-2', readAt: ACCOUNT_MS + 3 * HOUR }], 'reads exported by MEDIA id');
  assert.equal(ub.notificationState, null);

  // Wipe into a second instance (fresh db), restore inside a transaction as
  // the restore route does. Shape 3: strip the keys from B to simulate a
  // pre-v1.51 bundle user.
  const restoreNow = ACCOUNT_MS + 100 * HOUR;
  delete ub.notificationState;
  delete ub.notificationReads;
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-notifstore-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  store = createUserStore(adapter);
  adapter.begin();
  store.replaceAllNotificationsRaw(feed);
  store.replaceAllUsersRaw([ua, ub], restoreNow);
  adapter.commit();

  const aItems = store.listNotifications(a.id).items;
  assert.deepEqual(aItems.map((i) => i.mediaId), ['keep-2', 'keep-1'], 'feed restored');
  assert.equal(aItems[0].unread, false, 'A read survived by media-id resolution');
  assert.equal(store.countUnseenNotifications(a.id), 0, 'A watermark restored verbatim');
  assert.equal(store.countUnseenNotifications(b.id), 0, 'pre-v1.51 bundle: everything before the restore is seen');
  const bState = adapter.sql.prepare('SELECT last_seen_at FROM user_notification_state WHERE user_id = ?').get(b.id);
  assert.equal(bState.last_seen_at, restoreNow, 'absent-key bundle wrote the restore-moment watermark');

  // Shape 2 check on a third instance: explicit null restores NO row.
  const ua2 = { ...ua, notificationState: null, notificationReads: [] };
  adapter.begin();
  store.replaceAllNotificationsRaw(feed);
  store.replaceAllUsersRaw([ua2], restoreNow);
  adapter.commit();
  assert.equal(adapter.sql.prepare('SELECT COUNT(*) AS c FROM user_notification_state WHERE user_id = ?').get(ua2.id).c, 0, 'explicit-null bundle leaves the created_at default in charge');
});
