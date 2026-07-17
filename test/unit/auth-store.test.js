'use strict';

// [UNIT] v1.43 — the user + per-user-state store (lib/auth/store.js) against
// a real in-memory-ish SQLite adapter (a temp filetube.db). Covers the
// atomic create-admin + adoption transaction (design-delta WARNING-4),
// token-version bumps for instant revocation, hard-delete cascade + no id
// reuse (SUGGESTION-6), and the per-user state round-trips.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
const createUserStore = require('../../lib/auth/store');

let dir, adapter, store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-authstore-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  store = createUserStore(adapter);
});
afterEach(() => {
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ISO = '2026-07-17T12:00:00.000Z';

test('countUsers starts at 0; createFirstAdmin creates an admin and adopts global state', () => {
  assert.equal(store.countUsers(), 0);
  const admin = store.createFirstAdmin(
    { username: 'Dean', displayName: 'Dean', passwordHash: 'scrypt$32768$8$1$aaaa$bbbb' },
    {
      progress: { vid1: { timestamp: 42, duration: 100, updatedAt: '2026-07-01T00:00:00.000Z' }, vid2: { timestamp: 5, duration: 60 } },
      liked: ['vid1', 'vid2'],
      bookProgress: { bk1: { percent: 30, updatedAt: '2026-07-02T00:00:00.000Z' } },
      bookPins: [{ id: 'p1', dir: '/books', label: 'Shelf', order: 0 }],
      channelPins: [{ id: 'c1', channelDir: '/ch', label: 'Chan', order: 0 }],
    },
    ISO
  );
  assert.equal(admin.username, 'Dean');
  assert.equal(admin.role, 'admin');
  assert.equal(admin.canManageSubscriptions, true, 'first admin can manage subscriptions');
  assert.equal(admin.tokenVersion, 0);
  assert.equal(store.countUsers(), 1);

  // Adoption landed with REAL updatedAt where present, setup-time where absent.
  const prog = store.getProgress(admin.id);
  assert.equal(prog.vid1.timestamp, 42);
  assert.equal(prog.vid1.updatedAt, '2026-07-01T00:00:00.000Z', 'real updatedAt carried');
  assert.equal(prog.vid2.updatedAt, ISO, 'missing updatedAt synthesized to setup time');
  assert.deepEqual(store.getLiked(admin.id).sort(), ['vid1', 'vid2']);
  assert.equal(store.getBookProgress(admin.id).bk1.percent, 30);
  assert.equal(store.getBookPins(admin.id)[0].id, 'p1');
  assert.equal(store.getChannelPins(admin.id)[0].id, 'c1');
});

test('WARNING-4: createFirstAdmin is count-guarded — a SECOND call returns null and adopts nothing', () => {
  store.createFirstAdmin({ username: 'first', displayName: 'First', passwordHash: 'h' }, { liked: ['x'] }, ISO);
  const second = store.createFirstAdmin({ username: 'sneaky', displayName: 'Sneaky', passwordHash: 'h2' }, { liked: ['y'] }, ISO);
  assert.equal(second, null, 'guard fired: no second admin');
  assert.equal(store.countUsers(), 1, 'still exactly one user');
  assert.equal(store.getByUsername('sneaky'), null, 'the second create left nothing behind');
  // And the first admin was not re-adopted / clobbered.
  assert.deepEqual(store.getLiked(store.getByUsername('first').id), ['x']);
});

test('getPasswordHash is the ONLY hash accessor; rowToUser never carries it', () => {
  const admin = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'the-secret-hash' }, null, ISO);
  assert.equal(JSON.stringify(admin).includes('the-secret-hash'), false, 'a serialized user object cannot leak the hash');
  assert.equal(store.getPasswordHash(admin.id), 'the-secret-hash');
});

test('updatePassword and setDisabled each BUMP token_version (instant revocation)', () => {
  const admin = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h1' }, null, ISO);
  assert.equal(store.getById(admin.id).tokenVersion, 0);
  store.updatePassword(admin.id, 'h2');
  assert.equal(store.getById(admin.id).tokenVersion, 1, 'password change revokes existing sessions');
  store.setDisabled(admin.id, true);
  assert.equal(store.getById(admin.id).tokenVersion, 2, 'disable revokes existing sessions');
  assert.equal(store.getById(admin.id).disabled, true);
});

test('createUser: admin adds a member; duplicate username (case-insensitive) throws', () => {
  store.createFirstAdmin({ username: 'admin', displayName: 'Admin', passwordHash: 'h' }, null, ISO);
  const wife = store.createUser({ username: 'wife', displayName: 'Wife', passwordHash: 'hw', role: 'member' }, ISO);
  assert.equal(wife.role, 'member');
  assert.equal(wife.canManageSubscriptions, false);
  assert.equal(store.countUsers(), 2);
  assert.throws(() => store.createUser({ username: 'WIFE', displayName: 'x', passwordHash: 'y' }, ISO), /UNIQUE|constraint/i, 'username is case-insensitively unique');
});

test('SUGGESTION-6: hard-delete cascades per-user rows AND the id is never reused', () => {
  const admin = store.createFirstAdmin({ username: 'admin', displayName: 'A', passwordHash: 'h' }, null, ISO);
  const m = store.createUser({ username: 'm', displayName: 'M', passwordHash: 'h', role: 'member' }, ISO);
  store.setProgress(m.id, 'vid1', { timestamp: 1, duration: 2, updatedAt: ISO });
  store.addLiked(m.id, 'vid1', ISO);
  const deletedId = m.id;
  store.deleteUser(m.id);
  assert.equal(store.getById(deletedId), null, 'user gone');
  assert.deepEqual(store.getProgress(deletedId), {}, 'per-user progress cascaded');
  assert.deepEqual(store.getLiked(deletedId), [], 'per-user liked cascaded');
  // Recreate: MUST get a fresh id, never the reaped one (so an old cookie
  // carrying deletedId cannot inherit the new user).
  const recreated = store.createUser({ username: 'm2', displayName: 'M2', passwordHash: 'h', role: 'member' }, ISO);
  assert.notEqual(recreated.id, deletedId, 'a recreated user never reuses a reaped id');
  assert.ok(recreated.id > admin.id, 'monotonic id assignment');
});

test('per-user progress/liked round-trip and overwrite', () => {
  const admin = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO);
  store.setProgress(admin.id, 'vid', { timestamp: 10, duration: 100, updatedAt: ISO });
  store.setProgress(admin.id, 'vid', { timestamp: 55, duration: 100, updatedAt: '2026-07-18T00:00:00.000Z' });
  assert.equal(store.getOneProgress(admin.id, 'vid').timestamp, 55, 'upsert overwrites');
  store.addLiked(admin.id, 'x', ISO);
  store.addLiked(admin.id, 'x', ISO); // idempotent
  assert.deepEqual(store.getLiked(admin.id), ['x']);
  store.removeLiked(admin.id, 'x');
  assert.deepEqual(store.getLiked(admin.id), []);
});

test('two users have fully independent per-user state', () => {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, { liked: ['shared'] }, ISO);
  const b = store.createUser({ username: 'b', displayName: 'B', passwordHash: 'h', role: 'member' }, ISO);
  store.addLiked(b.id, 'b-only', ISO);
  assert.deepEqual(store.getLiked(a.id), ['shared'], 'admin adopted the pre-auth like; b did not');
  assert.deepEqual(store.getLiked(b.id), ['b-only'], 'b has only its own');
});

// ---- v1.43 chunk 4b: batch flush + media-id lifecycle helpers ---------------

test('setProgressBatch commits many users x many ids in one transaction; a throw mid-batch rolls the WHOLE batch back', () => {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO);
  const b = store.createUser({ username: 'b', displayName: 'B', passwordHash: 'h', role: 'member' }, ISO);
  store.setProgressBatch([
    { userId: a.id, mediaId: 'v1', value: { timestamp: 1, duration: 10, updatedAt: ISO } },
    { userId: a.id, mediaId: 'v2', value: { timestamp: 2, duration: 10, updatedAt: ISO } },
    { userId: b.id, mediaId: 'v1', value: { timestamp: 9, duration: 10, updatedAt: ISO } },
  ]);
  assert.equal(store.getOneProgress(a.id, 'v1').timestamp, 1);
  assert.equal(store.getOneProgress(a.id, 'v2').timestamp, 2);
  assert.equal(store.getOneProgress(b.id, 'v1').timestamp, 9);

  // Atomicity: a batch whose LAST row violates the FK (unknown user id)
  // must land nothing at all.
  assert.throws(() => store.setProgressBatch([
    { userId: a.id, mediaId: 'v3', value: { timestamp: 3, duration: 10, updatedAt: ISO } },
    { userId: 999999, mediaId: 'v3', value: { timestamp: 4, duration: 10, updatedAt: ISO } },
  ]));
  assert.equal(store.getOneProgress(a.id, 'v3'), null, 'the failed batch rolled back whole');
});

test('removeMediaState deletes EVERY user\'s progress + liked rows for the media id, and nothing else', () => {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO);
  const b = store.createUser({ username: 'b', displayName: 'B', passwordHash: 'h', role: 'member' }, ISO);
  for (const u of [a, b]) {
    store.setProgress(u.id, 'doomed', { timestamp: 5, duration: 10, updatedAt: ISO });
    store.setProgress(u.id, 'keeper', { timestamp: 6, duration: 10, updatedAt: ISO });
    store.addLiked(u.id, 'doomed', ISO);
    store.addLiked(u.id, 'keeper', ISO);
  }
  store.removeMediaState(['doomed']);
  for (const u of [a, b]) {
    assert.equal(store.getOneProgress(u.id, 'doomed'), null);
    assert.equal(store.getOneProgress(u.id, 'keeper').timestamp, 6);
    assert.deepEqual(store.getLiked(u.id), ['keeper']);
  }
});

test('rekeyMediaState carries EVERY user\'s rows old->new; an existing new-id row is replaced, not thrown on', () => {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO);
  const b = store.createUser({ username: 'b', displayName: 'B', passwordHash: 'h', role: 'member' }, ISO);
  store.setProgress(a.id, 'old', { timestamp: 11, duration: 10, updatedAt: ISO });
  store.setProgress(b.id, 'old', { timestamp: 22, duration: 10, updatedAt: ISO });
  store.addLiked(a.id, 'old', ISO);
  // b already has a row under the NEW id (an in-flight ping landed first) --
  // the re-key must not throw on the PK collision (UPDATE OR REPLACE).
  store.setProgress(b.id, 'new', { timestamp: 99, duration: 10, updatedAt: ISO });

  store.rekeyMediaState('old', 'new');
  assert.equal(store.getOneProgress(a.id, 'old'), null);
  assert.equal(store.getOneProgress(b.id, 'old'), null);
  assert.equal(store.getOneProgress(a.id, 'new').timestamp, 11);
  assert.equal(typeof store.getOneProgress(b.id, 'new').timestamp, 'number', 'b keeps exactly one row under the new id');
  assert.deepEqual(store.getLiked(a.id), ['new'], 'the Like followed the re-key');
});

test('__clearUserStateForTests wipes per-user STATE but keeps the users (session cookies stay valid across a test reset)', () => {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, { liked: ['x'], progress: { v: { timestamp: 1, duration: 2 } } }, ISO);
  store.__clearUserStateForTests();
  assert.equal(store.countUsers(), 1, 'the user survives');
  assert.deepEqual(store.getLiked(a.id), []);
  assert.equal(store.getOneProgress(a.id, 'v'), null);
});
