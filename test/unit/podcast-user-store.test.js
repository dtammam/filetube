'use strict';

// [UNIT] v1.69.0 T6 - per-user PODCAST state (episode resume + played latch)
// in lib/auth/store.js against a real temp SQLite adapter. Mirrors
// music-user-store.test.js: round-trips + isolation, the played toggle, the
// TENTH id-keyed carrier's delete half (removePodcastEpisodeState), the FK
// cascade on user delete, schema v8->v9 migration on a live db, and the
// backup export/restore round-trip incl. the pre-v1.69-bundle-absent case.
// v1.71 T1 adds: episode likes (ELEVENTH carrier - round-trip, actor
// isolation, carrier purge, bundle arms) and the queue entry_kind column
// (round-trip, kind-scoped media/podcast lifecycle carriers, v9->v10
// migration, pre-v10 bundle default).

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

  // Re-open: migrateSchema must run the v9 block (and everything after it)
  // against the live db - the version lands at the CURRENT head.
  adapter = new SqliteAdapter(dbPath, { log: () => {} });
  store = createUserStore(adapter);
  assert.equal(adapter.sql.prepare('PRAGMA user_version').get().user_version, 11);
  const admin2 = store.getByUsername('a');
  assert.deepEqual(store.getProgress(admin2.id).vid1, { timestamp: 5, duration: 10, updatedAt: ISO }, 'pre-existing rows untouched');
  store.setPodcastProgress(admin2.id, 'ep1', { position: 1, duration: 2, updatedAt: ISO });
  assert.notEqual(store.getOnePodcastProgress(admin2.id, 'ep1'), null, 'the new tables work post-migration');
});

// ---- v1.71 T1: episode likes (ELEVENTH carrier) + queue entry_kind ----

test('v1.71 likes: round-trip, idempotent add, per-user ACTOR isolation (the wrong-user mutant fails here)', () => {
  const { a, b } = twoUsers();
  store.addPodcastLiked(a.id, 'ep1', ISO);
  store.addPodcastLiked(a.id, 'ep2', ISO2);
  store.addPodcastLiked(b.id, 'ep1', ISO2);
  assert.deepEqual(store.getPodcastLiked(a.id), [{ episodeId: 'ep2', likedAt: ISO2 }, { episodeId: 'ep1', likedAt: ISO }], 'latest-first');
  assert.deepEqual(store.getPodcastLiked(b.id), [{ episodeId: 'ep1', likedAt: ISO2 }], 'b sees ONLY b\'s likes');
  store.addPodcastLiked(a.id, 'ep1', ISO2); // DO NOTHING - first stamp wins
  assert.equal(store.getPodcastLiked(a.id).find((l) => l.episodeId === 'ep1').likedAt, ISO);
  store.removePodcastLiked(a.id, 'ep1');
  assert.deepEqual(store.getPodcastLiked(a.id), [{ episodeId: 'ep2', likedAt: ISO2 }]);
  assert.deepEqual(store.getPodcastLiked(b.id), [{ episodeId: 'ep1', likedAt: ISO2 }], 'a\'s unlike NEVER touches b\'s row');
  store.removePodcastLiked(b.id, 'nope'); // unliking the unliked: no-op
});

test('v1.71 queue kind: round-trips through setQueue/getQueue; kind-less entries persist as media', () => {
  const { a } = twoUsers();
  store.setQueue(a.id, [
    { uid: 'u1', mediaId: 'vid1' }, // legacy caller shape - no kind
    { uid: 'u2', mediaId: 'ep1', kind: 'podcast' },
    { uid: 'u3', mediaId: 'vid2', kind: 'media' },
    { uid: 'u4', mediaId: 'x', kind: 'garbage' }, // unknown kind never persists as such
  ], 'u2', 111);
  const q = store.getQueue(a.id);
  assert.deepEqual(q.entries.map((e) => [e.uid, e.mediaId, e.kind]), [
    ['u1', 'vid1', 'media'], ['u2', 'ep1', 'podcast'], ['u3', 'vid2', 'media'], ['u4', 'x', 'media'],
  ]);
  assert.equal(q.pointerUid, 'u2');
  // Gate S3: the WRITE side normalizes - the column itself never carries a
  // third value (a verbatim-persist mutant is masked by the read-side
  // normalization, so bind the raw rows).
  const raw = adapter.sql.prepare('SELECT entry_kind FROM user_queue WHERE user_id = ? ORDER BY entry_order').all(a.id);
  assert.deepEqual(raw.map((r) => r.entry_kind), ['media', 'podcast', 'media', 'media'], 'raw column values, not the accessor\'s view');
});

test('v1.71 kind-scoped lifecycle: a media delete/re-key never touches a SAME-ID podcast row, and vice versa', () => {
  const { a } = twoUsers();
  // The collision shape: one md5-looking id living in BOTH kinds. Every
  // carrier below runs while BOTH rows are live at the colliding id -
  // the adversarial seat proved a re-key-first ordering makes the
  // episode-carrier assertion vacuous (the scope mutant survived).
  store.setQueue(a.id, [
    { uid: 'u1', mediaId: 'deadbeef', kind: 'media' },
    { uid: 'u2', mediaId: 'deadbeef', kind: 'podcast' },
  ], null, 1);
  store.removePodcastEpisodeState(['deadbeef']);
  let q = store.getQueue(a.id);
  assert.deepEqual(q.entries.map((e) => [e.uid, e.kind]), [['u1', 'media']], 'the episode carrier took ONLY the podcast-kind row - the media row SURVIVES the collision');

  store.setQueue(a.id, [
    { uid: 'u1', mediaId: 'deadbeef', kind: 'media' },
    { uid: 'u2', mediaId: 'deadbeef', kind: 'podcast' },
  ], null, 2);
  store.removeMediaState(['deadbeef']);
  q = store.getQueue(a.id);
  assert.deepEqual(q.entries.map((e) => [e.uid, e.kind]), [['u2', 'podcast']], 'media delete took ONLY the media-kind row');

  store.setQueue(a.id, [
    { uid: 'u1', mediaId: 'deadbeef', kind: 'media' },
    { uid: 'u2', mediaId: 'deadbeef', kind: 'podcast' },
  ], null, 3);
  store.rekeyMediaState('deadbeef', 'cafebabe');
  q = store.getQueue(a.id);
  assert.deepEqual(q.entries.map((e) => [e.mediaId, e.kind]).sort(), [['cafebabe', 'media'], ['deadbeef', 'podcast']], 're-key moved ONLY the media-kind row');
});

test('v1.71 carrier: removePodcastEpisodeState purges likes AND podcast queue rows with progress/played, one transaction', () => {
  const { a, b } = twoUsers();
  store.setPodcastProgress(a.id, 'ep1', { position: 10, duration: 100, updatedAt: ISO });
  store.addPodcastLiked(a.id, 'ep1', ISO);
  store.addPodcastLiked(b.id, 'ep1', ISO2);
  store.addPodcastLiked(b.id, 'ep2', ISO2);
  store.setQueue(b.id, [{ uid: 'u1', mediaId: 'ep1', kind: 'podcast' }, { uid: 'u2', mediaId: 'ep2', kind: 'podcast' }], null, 1);

  store.removePodcastEpisodeState(['ep1']);
  assert.deepEqual(store.getPodcastLiked(a.id), [], 'a\'s like purged');
  assert.deepEqual(store.getPodcastLiked(b.id), [{ episodeId: 'ep2', likedAt: ISO2 }], 'EVERY user\'s ep1 like purged, ep2 kept');
  assert.deepEqual(store.getQueue(b.id).entries.map((e) => e.mediaId), ['ep2'], 'the queued episode left the queue');
});

test('v1.71 schema v9 -> v10 migration: live queue rows survive and read back as media', () => {
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-podcastsv9-'));
  const dbPath = path.join(dir, SQLITE_FILENAME);

  const first = new SqliteAdapter(dbPath, { log: () => {} });
  const s1 = createUserStore(first);
  const admin = s1.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, {}, ISO);
  s1.setQueue(admin.id, [{ uid: 'u1', mediaId: 'vid1' }], 'u1', 5);
  // Simulate a v1.69/v1.70 install: no likes table, no kind column, v9 stamp.
  first.sql.exec('DROP TABLE user_podcast_liked; ALTER TABLE user_queue DROP COLUMN entry_kind; PRAGMA user_version = 9');
  first.close();

  adapter = new SqliteAdapter(dbPath, { log: () => {} });
  store = createUserStore(adapter);
  assert.equal(adapter.sql.prepare('PRAGMA user_version').get().user_version, 11);
  const admin2 = store.getByUsername('a');
  const q = store.getQueue(admin2.id);
  assert.deepEqual(q.entries, [{ uid: 'u1', mediaId: 'vid1', kind: 'media' }], 'the pre-v10 row survives AND reads as media');
  assert.equal(q.pointerUid, 'u1', 'pointer untouched');
  store.addPodcastLiked(admin2.id, 'ep1', ISO);
  assert.deepEqual(store.getPodcastLiked(admin2.id), [{ episodeId: 'ep1', likedAt: ISO }], 'the new table works post-migration');
});

test('v1.71 backup: podcastLiked + queue kind round-trip; pre-v1.71 bundles restore clean defaults', () => {
  const { a } = twoUsers();
  store.addPodcastLiked(a.id, 'ep1', ISO);
  store.setQueue(a.id, [{ uid: 'u1', mediaId: 'vid1', kind: 'media' }, { uid: 'u2', mediaId: 'ep1', kind: 'podcast' }], 'u2', 7);

  const exported = store.exportUsersForBackup();
  const ua = exported.find((u) => u.id === a.id);
  assert.deepEqual(ua.podcastLiked, [{ episodeId: 'ep1', likedAt: ISO }]);
  assert.deepEqual(ua.queue.entries.map((e) => [e.uid, e.kind]), [['u1', 'media'], ['u2', 'podcast']], 'kind rides the bundle');

  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-podcastlkrt-'));
  const a2 = new SqliteAdapter(path.join(dir2, SQLITE_FILENAME), { log: () => {} });
  try {
    const s2 = createUserStore(a2);
    s2.replaceAllUsersRaw(exported, ISO);
    const ra = s2.getByUsername('a');
    assert.deepEqual(s2.getPodcastLiked(ra.id), [{ episodeId: 'ep1', likedAt: ISO }]);
    assert.deepEqual(s2.getQueue(ra.id).entries.map((e) => [e.uid, e.kind]), [['u1', 'media'], ['u2', 'podcast']]);

    // Pre-v1.71 bundle: no podcastLiked, queue entries carry no kind.
    const legacy = exported.map((u) => {
      const copy = { ...u };
      delete copy.podcastLiked;
      copy.queue = { entries: [{ uid: 'u1', mediaId: 'vid1' }], pointerUid: 'u1', updatedAt: 3 };
      return copy;
    });
    s2.replaceAllUsersRaw(legacy, ISO);
    const la = s2.getByUsername('a');
    assert.deepEqual(s2.getPodcastLiked(la.id), [], 'absent likes restore nothing');
    assert.deepEqual(s2.getQueue(la.id).entries, [{ uid: 'u1', mediaId: 'vid1', kind: 'media' }], 'kind-less bundle rows restore as media');
  } finally {
    a2.close();
    fs.rmSync(dir2, { recursive: true, force: true });
  }
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
