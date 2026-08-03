'use strict';

// [UNIT] v1.66 - the push_subscriptions store surface (lib/auth/store.js +
// the schema v7 table) against a real temp filetube.db. Covers: upsert
// identity (endpoint), re-subscribe re-binding, the FORWARD-ONLY cursor
// (upsert MAX + advance MAX - a racing delivery or re-register can never
// rewind), owner-scoped unsubscribe, the delivery roster's disabled-user
// exclusion, user-delete cascade, the test-reset seam, and the v6 -> v7
// forward migration.
//
// Fixture endpoints are DIVERGENT spellings (v1.41.9 lesson): mixed case,
// query strings, non-hex tokens the code could never invent.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
const createUserStore = require('../../lib/auth/store');

let dir, adapter, store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pushstore-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  store = createUserStore(adapter);
});
afterEach(() => {
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ACCOUNT_ISO = '2026-02-01T00:00:00.000Z';
const NOW_MS = Date.parse(ACCOUNT_ISO) + 3600 * 1000;

const EP_A = 'https://Push.example/wp/QZx-19?tok=Aa_Bb';
const EP_B = 'https://updates.other.example/send/v2/rrTT.uu';

function mkAdmin(name = 'Dean') {
  return store.createFirstAdmin({ username: name, displayName: name, passwordHash: 'h' }, null, ACCOUNT_ISO);
}
function mkMember(name) {
  return store.createUser({ username: name, displayName: name, passwordHash: 'h', role: 'member' }, ACCOUNT_ISO);
}
function sub(endpoint, extra = {}) {
  return { endpoint, p256dh: 'Bp256-Divèrgent', auth: 'aUth-16', ...extra };
}

test('schema v7: push_subscriptions exists on a fresh adapter, and a v6 db forward-migrates', () => {
  const has = () => adapter.sql
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'push_subscriptions'")
    .all().length;
  assert.equal(has(), 1);
  assert.equal(adapter.sql.prepare('PRAGMA user_version').get().user_version, 13);

  // Simulate a v1.65 file: drop the v7 table, stamp user_version 6, reopen.
  adapter.sql.exec('DROP TABLE push_subscriptions;');
  adapter.sql.exec('PRAGMA user_version = 6');
  adapter.close();
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  store = createUserStore(adapter);
  assert.equal(has(), 1, 'v6 -> v7 recreated the table');
  assert.equal(adapter.sql.prepare('PRAGMA user_version').get().user_version, 13);
});

test('upsert: valid row lands with its initial cursor; garbage shapes THROW, never coerce', () => {
  const u = mkAdmin();
  store.upsertPushSubscription(u.id, sub(EP_A), 41, NOW_MS);
  const got = store.getPushSubscription(EP_A);
  assert.deepEqual(got, {
    endpoint: EP_A, userId: u.id, p256dh: 'Bp256-Divèrgent', auth: 'aUth-16',
    lastPushedId: 41, cooldownUntil: 0, createdAt: NOW_MS,
  });
  for (const bad of [
    null,
    {},
    sub(''),                                  // empty endpoint
    sub('x'.repeat(2049)),                    // oversize endpoint
    { endpoint: EP_B, p256dh: '', auth: 'a' },
    { endpoint: EP_B, p256dh: 'p', auth: 7 },
  ]) {
    assert.throws(() => store.upsertPushSubscription(u.id, bad, 0, NOW_MS), /invalid push subscription shape/);
  }
  assert.throws(() => store.upsertPushSubscription('1', sub(EP_B), 0, NOW_MS), /userId must be an integer/);
  assert.equal(store.getPushSubscription(EP_B), null, 'nothing landed for refused shapes');
});

test('re-subscribe re-binds keys and OWNER, but the cursor only moves forward (MAX)', () => {
  const a = mkAdmin();
  const b = mkMember('Kai');
  store.upsertPushSubscription(a.id, sub(EP_A), 50, NOW_MS);
  // Same endpoint re-registers under another user with fresh keys and a
  // LOWER initial cursor (e.g. an emptier feed after test churn): owner and
  // keys re-bind, cursor stays at 50.
  store.upsertPushSubscription(b.id, sub(EP_A, { p256dh: 'NewKey', auth: 'NewAuth' }), 3, NOW_MS + 1);
  const got = store.getPushSubscription(EP_A);
  assert.equal(got.userId, b.id);
  assert.equal(got.p256dh, 'NewKey');
  assert.equal(got.auth, 'NewAuth');
  assert.equal(got.lastPushedId, 50, 'cursor never rewinds on re-subscribe');
  assert.equal(got.createdAt, NOW_MS, 'created_at is the FIRST registration moment (conflict does not update it)');
});

test('advancePushCursor is monotonic; garbage ids are refused without touching the row', () => {
  const u = mkAdmin();
  store.upsertPushSubscription(u.id, sub(EP_A), 10, NOW_MS);
  store.advancePushCursor(EP_A, 25);
  assert.equal(store.getPushSubscription(EP_A).lastPushedId, 25);
  store.advancePushCursor(EP_A, 12); // stale racing delivery
  assert.equal(store.getPushSubscription(EP_A).lastPushedId, 25, 'never rewinds');
  store.advancePushCursor(EP_A, NaN);
  store.advancePushCursor(EP_A, -1);
  store.advancePushCursor(EP_A, '99');
  assert.equal(store.getPushSubscription(EP_A).lastPushedId, 25, 'non-integer ids are no-ops');
});

test('setPushCooldown stores the honor-until moment; delivery roster carries it', () => {
  const u = mkAdmin();
  store.upsertPushSubscription(u.id, sub(EP_A), 0, NOW_MS);
  store.setPushCooldown(EP_A, NOW_MS + 600000);
  assert.equal(store.getPushSubscription(EP_A).cooldownUntil, NOW_MS + 600000);
  const roster = store.listPushSubscriptionsForDelivery();
  assert.equal(roster.length, 1);
  assert.equal(roster[0].cooldownUntil, NOW_MS + 600000);
  assert.equal(typeof roster[0].settingsJson, 'string', 'roster joins the owner settings_json for the opt-out check');
});

test('unsubscribe is OWNER-scoped: another user cannot delete the row; prune is unconditional', () => {
  const a = mkAdmin();
  const b = mkMember('Rin');
  store.upsertPushSubscription(a.id, sub(EP_A), 0, NOW_MS);
  assert.equal(store.removeOwnPushSubscription(b.id, EP_A), false, 'cross-user unsubscribe refused');
  assert.notEqual(store.getPushSubscription(EP_A), null);
  assert.equal(store.removeOwnPushSubscription(a.id, EP_A), true);
  assert.equal(store.getPushSubscription(EP_A), null);
  // Prune (the 404/410 path) needs no owner.
  store.upsertPushSubscription(a.id, sub(EP_B), 0, NOW_MS);
  store.removePushSubscription(EP_B);
  assert.equal(store.getPushSubscription(EP_B), null);
});

test('delivery roster excludes DISABLED users and counts are per-user', () => {
  const a = mkAdmin();
  const b = mkMember('Noor');
  store.upsertPushSubscription(a.id, sub(EP_A), 0, NOW_MS);
  store.upsertPushSubscription(b.id, sub(EP_B), 0, NOW_MS);
  assert.equal(store.countPushSubscriptions(a.id), 1);
  assert.equal(store.countPushSubscriptions(b.id), 1);
  store.setDisabled(b.id, true);
  const roster = store.listPushSubscriptionsForDelivery();
  assert.deepEqual(roster.map((r) => r.endpoint), [EP_A], 'disabled user dropped from the roster');
  // The row itself survives (re-enable restores delivery without re-subscribing).
  assert.notEqual(store.getPushSubscription(EP_B), null);
});

test('user delete CASCADES the subscription rows (FK, no explicit code)', () => {
  const a = mkAdmin();
  const b = mkMember('Zia');
  store.upsertPushSubscription(b.id, sub(EP_B), 0, NOW_MS);
  store.deleteUser(b.id);
  assert.equal(store.getPushSubscription(EP_B), null, 'cascade removed the row');
  assert.notEqual(store.getById(a.id), null);
});

test('cursor feed reads: notificationsAfter/getMaxNotificationId answer by AUTOINCREMENT id', () => {
  mkAdmin();
  const T = Date.parse(ACCOUNT_ISO);
  store.recordNotifications([
    { mediaId: 'Vid-Ä-one', createdAt: T + 1000 },
    { mediaId: 'Vid-Ä-two', createdAt: T + 2000 },
    { mediaId: 'Vid-Ä-three', createdAt: T + 3000 },
  ]);
  const max = store.getMaxNotificationId();
  assert.ok(Number.isInteger(max) && max >= 3);
  const after = store.listNotificationsAfter(max - 2, 100);
  assert.deepEqual(after.map((r) => r.mediaId), ['Vid-Ä-two', 'Vid-Ä-three'], 'strictly-after semantics, id order');
  assert.equal(store.listNotificationsAfter(max, 100).length, 0);
  assert.equal(store.listNotificationsAfter(0, 2).length, 2, 'LIMIT bounds the read');
});

test('__clearUserStateForTests clears subscriptions (the hand-maintained seam)', () => {
  const u = mkAdmin();
  store.upsertPushSubscription(u.id, sub(EP_A), 0, NOW_MS);
  store.__clearUserStateForTests();
  assert.equal(store.getPushSubscription(EP_A), null);
  assert.notEqual(store.getById(u.id), null, 'users themselves survive the state reset');
});
