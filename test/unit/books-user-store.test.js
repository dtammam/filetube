'use strict';

// [UNIT] v1.72 - per-user BOOK likes + the manual finished latch (the
// TWELFTH id-keyed carrier) in lib/auth/store.js against a real temp SQLite
// adapter. Mirrors podcast-user-store.test.js: round-trips + ACTOR
// isolation, the carrier's delete half (removeBookState retires liked +
// finished + progress together), the FK cascade on user delete, the
// v10 -> v11 migration on a live db, and the backup export/restore arms
// incl. the pre-v1.72-bundle-absent case.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
const createUserStore = require('../../lib/auth/store');

let dir, adapter, store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-bookstore-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  store = createUserStore(adapter);
});
afterEach(() => {
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ISO = '2026-08-03T12:00:00.000Z';
const ISO2 = '2026-08-03T13:00:00.000Z';
function twoUsers() {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'ha' }, {}, ISO);
  const b = store.createUser({ username: 'b', displayName: 'B', passwordHash: 'hb', role: 'member' }, ISO);
  return { a, b };
}

test('likes: round-trip, idempotent add (original liked_at survives), per-user ACTOR isolation', () => {
  const { a, b } = twoUsers();
  store.addBookLiked(a.id, 'bk1', ISO);
  store.addBookLiked(a.id, 'bk1', ISO2); // duplicate - DO NOTHING
  assert.deepEqual(store.getBookLiked(a.id), [{ bookId: 'bk1', likedAt: ISO }], 'one row, the FIRST stamp');
  assert.deepEqual(store.getBookLiked(b.id), [], 'the other user sees nothing');
  store.removeBookLiked(b.id, 'bk1'); // wrong-user delete
  assert.equal(store.getBookLiked(a.id).length, 1, 'a wrong-user remove never crosses user_id');
  store.removeBookLiked(a.id, 'bk1');
  assert.deepEqual(store.getBookLiked(a.id), []);
});

test('finished latch: set/re-set/clear round-trip, actor isolation, __proto__ id lands as a plain key', () => {
  const { a, b } = twoUsers();
  store.setBookFinished(a.id, 'bk1', ISO);
  store.setBookFinished(a.id, 'bk1', ISO2); // re-set updates the stamp (manual re-latch)
  assert.equal(store.getBookFinished(a.id).bk1, ISO2);
  assert.deepEqual(Object.keys(store.getBookFinished(b.id)), []);
  store.setBookFinished(a.id, '__proto__', ISO);
  const map = store.getBookFinished(a.id);
  assert.ok(Object.prototype.hasOwnProperty.call(map, '__proto__'), 'null-prototype map takes the key literally');
  assert.equal(Object.getPrototypeOf(map), null);
  store.clearBookFinished(a.id, 'bk1');
  assert.ok(!Object.prototype.hasOwnProperty.call(store.getBookFinished(a.id), 'bk1'));
});

test('the delete half: removeBookState retires liked + finished + progress for EXACTLY the pruned ids, every user', () => {
  const { a, b } = twoUsers();
  for (const u of [a, b]) {
    store.setBookProgress(u.id, 'gone', { locator: { kind: 'epub', cfi: 'x' }, percent: 10, updatedAt: ISO });
    store.addBookLiked(u.id, 'gone', ISO);
    store.setBookFinished(u.id, 'gone', ISO);
    store.setBookProgress(u.id, 'kept', { locator: { kind: 'epub', cfi: 'y' }, percent: 20, updatedAt: ISO });
    store.addBookLiked(u.id, 'kept', ISO);
    store.setBookFinished(u.id, 'kept', ISO);
  }
  store.removeBookState(['gone']);
  for (const u of [a, b]) {
    assert.deepEqual(store.getBookLiked(u.id).map((l) => l.bookId), ['kept'], `user ${u.username}: only the pruned id shed its like`);
    assert.deepEqual(Object.keys(store.getBookFinished(u.id)), ['kept']);
    assert.equal(store.getOneBookProgress(u.id, 'gone'), null);
    assert.notEqual(store.getOneBookProgress(u.id, 'kept'), null);
  }
});

test('FK cascade: deleting a user drops their book rows; the survivor is untouched', () => {
  const { a, b } = twoUsers();
  store.addBookLiked(a.id, 'bk1', ISO);
  store.setBookFinished(a.id, 'bk1', ISO);
  store.addBookLiked(b.id, 'bk1', ISO);
  store.setBookFinished(b.id, 'bk1', ISO);
  store.deleteUser(b.id);
  assert.equal(adapter.sql.prepare("SELECT COUNT(*) AS n FROM user_book_liked WHERE user_id = ?").get(b.id).n, 0);
  assert.equal(adapter.sql.prepare("SELECT COUNT(*) AS n FROM user_book_finished WHERE user_id = ?").get(b.id).n, 0);
  assert.equal(store.getBookLiked(a.id).length, 1, 'the surviving user is unaffected');
});

test('schema v10 -> v11 migration: an existing db gains the two tables without touching live rows', () => {
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-booksv10-'));
  const dbPath = path.join(dir, SQLITE_FILENAME);

  const first = new SqliteAdapter(dbPath, { log: () => {} });
  const s1 = createUserStore(first);
  const admin = s1.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, {}, ISO);
  s1.setBookProgress(admin.id, 'bk1', { locator: { kind: 'epub', cfi: 'z' }, percent: 40, updatedAt: ISO });
  // Simulate a pre-v1.72 install: drop the v11 tables and stamp v10.
  first.sql.exec('DROP TABLE user_book_liked; DROP TABLE user_book_finished; PRAGMA user_version = 10');
  first.close();

  adapter = new SqliteAdapter(dbPath, { log: () => {} });
  store = createUserStore(adapter);
  assert.equal(adapter.sql.prepare('PRAGMA user_version').get().user_version, 14);
  const admin2 = store.getByUsername('a');
  assert.equal(store.getOneBookProgress(admin2.id, 'bk1').percent, 40, 'pre-existing rows untouched');
  store.addBookLiked(admin2.id, 'bk2', ISO);
  store.setBookFinished(admin2.id, 'bk2', ISO);
  assert.equal(store.getBookLiked(admin2.id).length, 1, 'the new tables work post-migration');
});

test('backup arms: export carries bookLiked/bookFinished; restore replays them; a pre-v1.72 bundle (fields absent) restores empty, never throws', () => {
  const { a } = twoUsers();
  store.addBookLiked(a.id, 'bk1', ISO);
  store.setBookFinished(a.id, 'bk2', ISO2);
  const users = store.exportUsersForBackup();
  const exported = users.find((u) => u.username === 'a');
  assert.deepEqual(exported.bookLiked, [{ bookId: 'bk1', likedAt: ISO }]);
  assert.deepEqual(exported.bookFinished, { bk2: ISO2 });

  // Restore into a fresh instance.
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-booksrestore-'));
  const a2 = new SqliteAdapter(path.join(dir2, SQLITE_FILENAME), { log: () => {} });
  const s2 = createUserStore(a2);
  try {
    s2.replaceAllUsersRaw(users, ISO);
    const r = s2.getByUsername('a');
    assert.deepEqual(s2.getBookLiked(r.id).map((l) => l.bookId), ['bk1']);
    assert.equal(s2.getBookFinished(r.id).bk2, ISO2);

    // The absent-fields (pre-v1.72 bundle) case: strip and re-restore.
    const legacy = users.map((u) => { const c = { ...u }; delete c.bookLiked; delete c.bookFinished; return c; });
    s2.replaceAllUsersRaw(legacy, ISO);
    const r2 = s2.getByUsername('a');
    assert.deepEqual(s2.getBookLiked(r2.id), [], 'absent field restores empty');
    assert.deepEqual(Object.keys(s2.getBookFinished(r2.id)), []);
  } finally {
    a2.close();
    fs.rmSync(dir2, { recursive: true, force: true });
  }
});
