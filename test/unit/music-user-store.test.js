'use strict';

// [UNIT] v1.44 T2 — per-user MUSIC state in lib/auth/store.js against a real
// temp SQLite adapter. Mirrors auth-store.test.js's per-user coverage for the
// media/book tables: liked/progress round-trips + isolation, the coalescer
// batch flush + FK-poison guard, the track-id lifecycle carriers
// (removeMusicState/rekeyMusicState incl. the resume-pointer cleanup), the
// FK cascade on user delete, and the backup export/restore round-trip.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
const createUserStore = require('../../lib/auth/store');

let dir, adapter, store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-musicstore-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  store = createUserStore(adapter);
});
afterEach(() => {
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ISO = '2026-07-17T12:00:00.000Z';
function twoUsers() {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'ha' }, {}, ISO);
  const b = store.createUser({ username: 'b', displayName: 'B', passwordHash: 'hb', role: 'member' }, ISO);
  return { a, b };
}

test('T2: music liked is per-user and isolated (no bleed)', () => {
  const { a, b } = twoUsers();
  store.addMusicLiked(a.id, 'trk1', ISO);
  store.addMusicLiked(a.id, 'trk2', ISO);
  store.addMusicLiked(b.id, 'trk3', ISO);
  assert.deepEqual(store.getMusicLiked(a.id).sort(), ['trk1', 'trk2']);
  assert.deepEqual(store.getMusicLiked(b.id), ['trk3']);
  // idempotent add (ON CONFLICT DO NOTHING)
  store.addMusicLiked(a.id, 'trk1', ISO);
  assert.deepEqual(store.getMusicLiked(a.id).sort(), ['trk1', 'trk2']);
  store.removeMusicLiked(a.id, 'trk1');
  assert.deepEqual(store.getMusicLiked(a.id), ['trk2']);
  assert.deepEqual(store.getMusicLiked(b.id), ['trk3'], 'b untouched');
});

test('T2: music progress single + read-one round-trips position/duration', () => {
  const { a } = twoUsers();
  store.setMusicProgress(a.id, 'trk1', { position: 123.4, duration: 610, updatedAt: ISO });
  assert.deepEqual(store.getOneMusicProgress(a.id, 'trk1'), { position: 123.4, duration: 610, updatedAt: ISO });
  assert.equal(store.getOneMusicProgress(a.id, 'nope'), null);
  assert.deepEqual(store.getMusicProgress(a.id).trk1, { position: 123.4, duration: 610, updatedAt: ISO });
});

test('T2: setMusicProgressBatch commits many users x many ids in one transaction; a vanished-user entry is filtered (FK-poison guard)', () => {
  const { a, b } = twoUsers();
  const ghostId = 99999;
  assert.doesNotThrow(() => store.setMusicProgressBatch([
    { userId: a.id, trackId: 't1', value: { position: 10, duration: 200, updatedAt: ISO } },
    { userId: b.id, trackId: 't1', value: { position: 20, duration: 200, updatedAt: ISO } },
    { userId: ghostId, trackId: 't1', value: { position: 30, duration: 200, updatedAt: ISO } }, // FK-poison bait
  ]));
  assert.equal(store.getOneMusicProgress(a.id, 't1').position, 10, 'survivor a committed');
  assert.equal(store.getOneMusicProgress(b.id, 't1').position, 20, 'survivor b committed, not rolled back by the ghost');
});

test('T2: resume pointer set/get round-trips lastTrackId + queueCtx (JSON) + position', () => {
  const { a } = twoUsers();
  assert.equal(store.getMusicState(a.id), null, 'no pointer initially');
  const ctx = { src: 'music', folder: '/m/Album', sort: 'newest' };
  store.setMusicState(a.id, { lastTrackId: 'trk1', queueCtx: ctx, position: 88.5, updatedAt: ISO });
  const s = store.getMusicState(a.id);
  assert.equal(s.lastTrackId, 'trk1');
  assert.deepEqual(s.queueCtx, ctx);
  assert.equal(s.position, 88.5);
  // upsert replaces the single row
  store.setMusicState(a.id, { lastTrackId: 'trk2', queueCtx: null, position: 0, updatedAt: ISO });
  assert.equal(store.getMusicState(a.id).lastTrackId, 'trk2');
  assert.equal(store.getMusicState(a.id).queueCtx, null);
});

test('T2: removeMusicState sheds EVERY user\'s liked + progress for the track AND nulls a resume pointer that referenced it', () => {
  const { a, b } = twoUsers();
  store.addMusicLiked(a.id, 'doomed', ISO);
  store.addMusicLiked(b.id, 'doomed', ISO);
  store.addMusicLiked(a.id, 'keep', ISO);
  store.setMusicProgress(a.id, 'doomed', { position: 5, duration: 100, updatedAt: ISO });
  store.setMusicProgress(b.id, 'keep', { position: 9, duration: 100, updatedAt: ISO });
  store.setMusicState(a.id, { lastTrackId: 'doomed', queueCtx: { src: 'music' }, position: 5, updatedAt: ISO });
  store.setMusicState(b.id, { lastTrackId: 'keep', queueCtx: { src: 'music' }, position: 9, updatedAt: ISO });

  store.removeMusicState(['doomed']);

  assert.deepEqual(store.getMusicLiked(a.id), ['keep'], 'a: doomed like shed, keep survives');
  assert.deepEqual(store.getMusicLiked(b.id), [], 'b: doomed like shed');
  assert.equal(store.getOneMusicProgress(a.id, 'doomed'), null, 'a: doomed progress shed');
  assert.equal(store.getOneMusicProgress(b.id, 'keep').position, 9, 'b: keep progress intact');
  assert.equal(store.getMusicState(a.id).lastTrackId, null, 'a: dangling resume pointer nulled');
  assert.equal(store.getMusicState(b.id).lastTrackId, 'keep', 'b: resume pointer to a surviving track untouched');
});

test('T2: rekeyMusicState carries EVERY user\'s rows + resume pointer old->new; an existing new-id row is replaced, not thrown on', () => {
  const { a, b } = twoUsers();
  store.setMusicProgress(a.id, 'old', { position: 1, duration: 100, updatedAt: ISO });
  store.setMusicProgress(b.id, 'old', { position: 2, duration: 100, updatedAt: ISO });
  store.addMusicLiked(a.id, 'old', ISO);
  store.setMusicState(a.id, { lastTrackId: 'old', queueCtx: null, position: 1, updatedAt: ISO });
  // b already has a row under the NEW id (an in-flight ping re-keyed ahead) —
  // the re-key must OR-REPLACE, not throw on the PK collision.
  store.setMusicProgress(b.id, 'new', { position: 7, duration: 100, updatedAt: ISO });

  assert.doesNotThrow(() => store.rekeyMusicState('old', 'new'));

  assert.equal(store.getOneMusicProgress(a.id, 'new').position, 1, 'a carried old->new');
  assert.equal(store.getOneMusicProgress(a.id, 'old'), null, 'old gone');
  assert.deepEqual(store.getMusicLiked(a.id), ['new'], 'liked carried');
  assert.equal(store.getMusicState(a.id).lastTrackId, 'new', 'resume pointer carried');
});

test('T2: deleting a user cascades away ALL their music state (FK ON DELETE CASCADE)', () => {
  const { a, b } = twoUsers();
  store.addMusicLiked(b.id, 't', ISO);
  store.setMusicProgress(b.id, 't', { position: 3, duration: 100, updatedAt: ISO });
  store.setMusicState(b.id, { lastTrackId: 't', queueCtx: null, position: 3, updatedAt: ISO });
  store.deleteUser(b.id);
  assert.deepEqual(store.getMusicLiked(b.id), []);
  assert.equal(store.getOneMusicProgress(b.id, 't'), null);
  assert.equal(store.getMusicState(b.id), null);
  // a's counterpart data (created below) is unaffected
  store.addMusicLiked(a.id, 't', ISO);
  assert.deepEqual(store.getMusicLiked(a.id), ['t']);
});

test('T2: a __proto__ track_id lands as a PLAIN own key in getMusicProgress (no prototype pollution)', () => {
  const { a } = twoUsers();
  store.setMusicProgress(a.id, '__proto__', { position: 1, duration: 2, updatedAt: ISO });
  const map = store.getMusicProgress(a.id);
  assert.ok(Object.prototype.hasOwnProperty.call(map, '__proto__'), '__proto__ is an own enumerable key');
  assert.equal(Object.getPrototypeOf(map), null, 'accumulator has null prototype');
  assert.equal(map['__proto__'].position, 1);
});

test('T2: backup export + restore round-trips music liked/progress/state (the SEVENTH-strike carrier)', () => {
  const { a } = twoUsers();
  store.addMusicLiked(a.id, 'trk1', ISO);
  store.setMusicProgress(a.id, 'trk1', { position: 42, duration: 900, updatedAt: ISO });
  store.setMusicState(a.id, { lastTrackId: 'trk1', queueCtx: { src: 'music', folder: '/m' }, position: 42, updatedAt: ISO });

  const bundle = store.exportUsersForBackup();
  const exported = bundle.find((u) => u.username === 'a');
  assert.deepEqual(exported.musicLiked, [{ trackId: 'trk1', likedAt: ISO }]);
  assert.equal(exported.musicProgress.trk1.position, 42);
  assert.equal(exported.musicState.lastTrackId, 'trk1');

  // Wipe-and-replace from the bundle, inside a transaction (restore posture).
  adapter.begin();
  try { store.replaceAllUsersRaw(bundle); adapter.commit(); } catch (e) { adapter.rollback(); throw e; }

  const restored = store.getByUsername('a');
  assert.deepEqual(store.getMusicLiked(restored.id), ['trk1']);
  assert.equal(store.getOneMusicProgress(restored.id, 'trk1').position, 42);
  assert.deepEqual(store.getMusicState(restored.id).queueCtx, { src: 'music', folder: '/m' });
});
