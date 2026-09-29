'use strict';

// [UNIT] v1.343 Watch later - the per-user user_watch_later store (schema v34),
// against a real temp SQLite adapter: ordered list, idempotent add, race-safe
// reorder, purge / rekey / backup / cascade carriers, cross-user isolation.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
const createUserStore = require('../../lib/auth/store');

let dir, adapter, store, a, b;
const ISO = (n) => `2026-09-29T12:00:0${n}.000Z`;
const ids = (uid) => store.getWatchLater(uid).map((r) => (typeof r === 'string' ? r : r.mediaId));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-watchlater-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  store = createUserStore(adapter);
  a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO(0));
  b = store.createUser({ username: 'b', displayName: 'B', passwordHash: 'h', role: 'member' }, ISO(0));
});
afterEach(() => {
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('add appends in order; re-add is idempotent and keeps its place; remove is idempotent', () => {
  assert.deepEqual(ids(a.id), []);
  store.addWatchLater(a.id, 'v1', ISO(1));
  store.addWatchLater(a.id, 'v2', ISO(2));
  store.addWatchLater(a.id, 'v3', ISO(3));
  assert.deepEqual(ids(a.id), ['v1', 'v2', 'v3'], 'oldest-added first (append order)');
  store.addWatchLater(a.id, 'v1', ISO(9));
  assert.deepEqual(ids(a.id), ['v1', 'v2', 'v3'], 're-add keeps its place');
  store.removeWatchLater(a.id, 'v2');
  store.removeWatchLater(a.id, 'nope');
  assert.deepEqual(ids(a.id), ['v1', 'v3']);
  store.addWatchLater(a.id, 'v4', ISO(4));
  assert.deepEqual(ids(a.id), ['v1', 'v3', 'v4'], 'append after a gap still lands last');
});

test('cross-user isolation', () => {
  store.addWatchLater(a.id, 'shared', ISO(1));
  assert.deepEqual(ids(b.id), []);
  store.addWatchLater(b.id, 'shared', ISO(1));
  store.removeWatchLater(a.id, 'shared');
  assert.deepEqual(ids(b.id), ['shared'], "a's removal never touches b's list");
});

test('reorder: places listed ids first; unknown and duplicate ids ignored; a stale reorder never drops or resurrects', () => {
  for (const [i, id] of ['v1', 'v2', 'v3', 'v4'].entries()) store.addWatchLater(a.id, id, ISO(i));
  store.reorderWatchLater(a.id, ['v3', 'v1']);
  assert.deepEqual(ids(a.id), ['v3', 'v1', 'v2', 'v4'], 'unlisted rows keep their order after the listed ones');
  store.reorderWatchLater(a.id, ['v4', 'ghost', 'v4', 'v2']);
  assert.deepEqual(ids(a.id), ['v4', 'v2', 'v3', 'v1'], 'ghost never appears, the duplicate v4 is placed once');
  // a stale client that still lists a removed item and misses a new one
  store.removeWatchLater(a.id, 'v2');
  store.addWatchLater(a.id, 'v5', ISO(5));
  store.reorderWatchLater(a.id, ['v1', 'v2', 'v4']);
  assert.deepEqual(ids(a.id), ['v1', 'v4', 'v3', 'v5'], 'removed v2 stays removed; new v5 is kept, not dropped');
});

test('reorder never touches another user\'s list', () => {
  store.addWatchLater(a.id, 'x', ISO(1));
  store.addWatchLater(a.id, 'y', ISO(2));
  store.addWatchLater(b.id, 'x', ISO(1));
  store.addWatchLater(b.id, 'y', ISO(2));
  store.reorderWatchLater(a.id, ['y', 'x']);
  assert.deepEqual(ids(b.id), ['x', 'y']);
});

test('removeMediaState purges the id for every user; others survive', () => {
  for (const u of [a, b]) { store.addWatchLater(u.id, 'doomed', ISO(1)); store.addWatchLater(u.id, 'keeper', ISO(2)); }
  store.removeMediaState(['doomed']);
  for (const u of [a, b]) assert.deepEqual(ids(u.id), ['keeper']);
});

test('rekeyMediaState carries the entry, keeps its place, and a colliding new-id row does not throw', () => {
  store.addWatchLater(a.id, 'first', ISO(1));
  store.addWatchLater(a.id, 'old', ISO(2));
  store.addWatchLater(a.id, 'last', ISO(3));
  store.addWatchLater(b.id, 'old', ISO(1));
  store.addWatchLater(b.id, 'new', ISO(2));
  store.rekeyMediaState('old', 'new');
  assert.deepEqual(ids(a.id), ['first', 'new', 'last'], 'the move keeps the list position');
  assert.deepEqual(ids(b.id), ['new'], 'one row under the new id, no PK-collision throw');
});

test('backup export -> restore round-trips per user, in order', () => {
  store.addWatchLater(a.id, 'v1', ISO(1));
  store.addWatchLater(a.id, 'v2', ISO(2));
  store.addWatchLater(a.id, 'v3', ISO(3));
  store.reorderWatchLater(a.id, ['v3', 'v1', 'v2']);
  store.addWatchLater(b.id, 'v9', ISO(1));
  const bundle = store.exportUsersForBackup();
  const ab = bundle.find((u) => u.id === a.id);
  assert.deepEqual(ab.watchLater.map((w) => w.mediaId), ['v3', 'v1', 'v2'], 'export is in list order');
  store.replaceAllUsersRaw(bundle);
  assert.deepEqual(ids(a.id), ['v3', 'v1', 'v2']);
  assert.deepEqual(ids(b.id), ['v9']);
});

test('a bundle with no watchLater field restores as empty, losing nothing else', () => {
  store.addLiked(a.id, 'liked-x', ISO(1));
  const bundle = store.exportUsersForBackup();
  for (const u of bundle) delete u.watchLater;
  store.replaceAllUsersRaw(bundle);
  assert.deepEqual(ids(a.id), []);
  assert.deepEqual(store.getLiked(a.id), ['liked-x']);
});

test('deleting a user cascades their list away; the survivor is untouched', () => {
  store.addWatchLater(a.id, 'v', ISO(1));
  store.addWatchLater(b.id, 'v', ISO(1));
  store.deleteUser(b.id);
  assert.deepEqual(ids(b.id), []);
  assert.deepEqual(ids(a.id), ['v']);
});

test('__clearUserStateForTests empties the table', () => {
  store.addWatchLater(a.id, 'v', ISO(1));
  store.__clearUserStateForTests();
  assert.strictEqual(adapter.sql.prepare('SELECT COUNT(*) AS c FROM user_watch_later').get().c, 0);
});
