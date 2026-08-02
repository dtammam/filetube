'use strict';

// [UNIT] v1.69.0 T6 - per-user PODCAST state (episode resume + played latch)
// in lib/auth/store.js against a real temp SQLite adapter. Mirrors
// music-user-store.test.js: round-trips + isolation, the played toggle, the
// TENTH id-keyed carrier's delete half (removePodcastEpisodeState), the FK
// cascade on user delete, schema v8->v9 migration on a live db, and the
// backup export/restore round-trip incl. the pre-v1.69-bundle-absent case.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
const createUserStore = require('../../lib/auth/store');

let dir, adapter, store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-podcaststore-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  store = createUserStore(adapter);
});
afterEach(() => {
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ISO = '2026-08-02T12:00:00.000Z';
const ISO2 = '2026-08-02T13:00:00.000Z';
function twoUsers() {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'ha' }, {}, ISO);
  const b = store.createUser({ username: 'b', displayName: 'B', passwordHash: 'hb', role: 'member' }, ISO);
  return { a, b };
}

test('progress round-trips and is per-user isolated; upsert wins latest', () => {
  const { a, b } = twoUsers();
  store.setPodcastProgress(a.id, 'ep1', { position: 1200.5, duration: 4357, updatedAt: ISO });
  store.setPodcastProgress(b.id, 'ep1', { position: 7, duration: 4357, updatedAt: ISO });
  assert.deepEqual(store.getOnePodcastProgress(a.id, 'ep1'), { position: 1200.5, duration: 4357, updatedAt: ISO });
  assert.deepEqual(store.getOnePodcastProgress(b.id, 'ep1'), { position: 7, duration: 4357, updatedAt: ISO });
  store.setPodcastProgress(a.id, 'ep1', { position: 4300, duration: 4357, updatedAt: ISO2 });
  assert.deepEqual(store.getOnePodcastProgress(a.id, 'ep1'), { position: 4300, duration: 4357, updatedAt: ISO2 });
  assert.equal(store.getOnePodcastProgress(a.id, 'nope'), null);
});

test('played latch: set / re-set / clear, per-user isolated', () => {
  const { a, b } = twoUsers();
  store.setPodcastPlayed(a.id, 'ep1', ISO);
  store.setPodcastPlayed(a.id, 'ep2', ISO);
  store.setPodcastPlayed(b.id, 'ep1', ISO2);
  assert.deepEqual({ ...store.getPodcastPlayed(a.id) }, { ep1: ISO, ep2: ISO });
  assert.deepEqual({ ...store.getPodcastPlayed(b.id) }, { ep1: ISO2 });
  store.setPodcastPlayed(a.id, 'ep1', ISO2); // idempotent re-latch updates the stamp
  assert.equal(store.getPodcastPlayed(a.id).ep1, ISO2);
  store.clearPodcastPlayed(a.id, 'ep1'); // the manual unplay toggle
  assert.deepEqual({ ...store.getPodcastPlayed(a.id) }, { ep2: ISO });
  assert.deepEqual({ ...store.getPodcastPlayed(b.id) }, { ep1: ISO2 }, 'b untouched');
});

test('a hostile __proto__ episode id lands as a plain key (null-prototype maps)', () => {
  const { a } = twoUsers();
  store.setPodcastProgress(a.id, '__proto__', { position: 1, duration: 2, updatedAt: ISO });
  const prog = store.getPodcastProgress(a.id);
  assert.deepEqual(prog['__proto__'], { position: 1, duration: 2, updatedAt: ISO });
  assert.strictEqual(Object.prototype.polluted, undefined);
  assert.strictEqual(Object.getPrototypeOf(prog), null);
});

test('TENTH carrier delete half: removePodcastEpisodeState purges EVERY user\'s rows for those episodes only', () => {
  const { a, b } = twoUsers();
  store.setPodcastProgress(a.id, 'ep1', { position: 10, duration: 100, updatedAt: ISO });
  store.setPodcastProgress(b.id, 'ep1', { position: 20, duration: 100, updatedAt: ISO });
  store.setPodcastProgress(a.id, 'ep2', { position: 30, duration: 100, updatedAt: ISO });
  store.setPodcastPlayed(a.id, 'ep1', ISO);
  store.setPodcastPlayed(b.id, 'ep1', ISO);
  store.setPodcastPlayed(b.id, 'ep2', ISO);

  store.removePodcastEpisodeState(['ep1']);
  assert.equal(store.getOnePodcastProgress(a.id, 'ep1'), null);
  assert.equal(store.getOnePodcastProgress(b.id, 'ep1'), null);
  assert.deepEqual({ ...store.getPodcastPlayed(a.id) }, {});
  assert.deepEqual({ ...store.getPodcastPlayed(b.id) }, { ep2: ISO });
  assert.deepEqual(store.getOnePodcastProgress(a.id, 'ep2'), { position: 30, duration: 100, updatedAt: ISO }, 'other episodes untouched');

  store.removePodcastEpisodeState([]); // no-op, never throws
  store.removePodcastEpisodeState('ep2'); // scalar form
  assert.equal(store.getOnePodcastProgress(a.id, 'ep2'), null);
});

test('FK cascade: deleting a user removes their podcast rows', () => {
  const { a, b } = twoUsers();
  store.setPodcastProgress(b.id, 'ep1', { position: 1, duration: 2, updatedAt: ISO });
  store.setPodcastPlayed(b.id, 'ep1', ISO);
  store.deleteUser(b.id);
  assert.equal(adapter.sql.prepare('SELECT COUNT(*) AS n FROM user_podcast_progress').get().n, 0);
  assert.equal(adapter.sql.prepare('SELECT COUNT(*) AS n FROM user_podcast_played').get().n, 0);
  store.setPodcastProgress(a.id, 'epX', { position: 1, duration: 2, updatedAt: ISO });
  assert.notEqual(store.getOnePodcastProgress(a.id, 'epX'), null, 'the surviving user is unaffected');
});

test('schema v8 -> v9 migration: an existing db gains the tables without touching live rows', () => {
  // Close the beforeEach adapter and build a v8-shaped db by hand.
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-podcastsv8-'));
  const dbPath = path.join(dir, SQLITE_FILENAME);

  const first = new SqliteAdapter(dbPath, { log: () => {} });
  const s1 = createUserStore(first);
  const admin = s1.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, {}, ISO);
  s1.setProgress(admin.id, 'vid1', { timestamp: 5, duration: 10, updatedAt: ISO });
  // NOW simulate a pre-v1.69 install: drop the v9 tables and stamp v8.
  first.sql.exec('DROP TABLE user_podcast_progress; DROP TABLE user_podcast_played; PRAGMA user_version = 8');
  first.close();

  // Re-open: migrateSchema must run the v9 block against the live db.
  adapter = new SqliteAdapter(dbPath, { log: () => {} });
  store = createUserStore(adapter);
  assert.equal(adapter.sql.prepare('PRAGMA user_version').get().user_version, 9);
  const admin2 = store.getByUsername('a');
  assert.deepEqual(store.getProgress(admin2.id).vid1, { timestamp: 5, duration: 10, updatedAt: ISO }, 'pre-existing rows untouched');
  store.setPodcastProgress(admin2.id, 'ep1', { position: 1, duration: 2, updatedAt: ISO });
  assert.notEqual(store.getOnePodcastProgress(admin2.id, 'ep1'), null, 'the new tables work post-migration');
});

test('backup export/restore round-trip carries podcast state; a pre-v1.69 bundle (fields absent) restores clean', () => {
  const { a, b } = twoUsers();
  store.setPodcastProgress(a.id, 'ep1', { position: 99, duration: 4357, updatedAt: ISO });
  store.setPodcastPlayed(a.id, 'ep2', ISO2);

  const exported = store.exportUsersForBackup();
  const ua = exported.find((u) => u.id === a.id);
  assert.deepEqual(ua.podcastProgress, { ep1: { position: 99, duration: 4357, updatedAt: ISO } });
  assert.deepEqual(ua.podcastPlayed, { ep2: ISO2 });
  const ub = exported.find((u) => u.id === b.id);
  assert.deepEqual(ub.podcastProgress, {}, 'a user with no state exports empty maps, honestly');

  // Round-trip into a fresh store.
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-podcastrt-'));
  const a2 = new SqliteAdapter(path.join(dir2, SQLITE_FILENAME), { log: () => {} });
  try {
    const s2 = createUserStore(a2);
    s2.replaceAllUsersRaw(exported, ISO);
    const restoredA = s2.getByUsername('a');
    assert.deepEqual(s2.getOnePodcastProgress(restoredA.id, 'ep1'), { position: 99, duration: 4357, updatedAt: ISO });
    assert.deepEqual({ ...s2.getPodcastPlayed(restoredA.id) }, { ep2: ISO2 });

    // Pre-v1.69 bundle: strip the new fields entirely - restore must not throw.
    const legacy = exported.map((u) => {
      const copy = { ...u };
      delete copy.podcastProgress;
      delete copy.podcastPlayed;
      return copy;
    });
    s2.replaceAllUsersRaw(legacy, ISO);
    const legacyA = s2.getByUsername('a');
    assert.equal(s2.getOnePodcastProgress(legacyA.id, 'ep1'), null, 'absent fields restore nothing');
  } finally {
    a2.close();
    fs.rmSync(dir2, { recursive: true, force: true });
  }
});
