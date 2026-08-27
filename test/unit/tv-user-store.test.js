'use strict';

// [UNIT] v1.196 TV player integration - per-user TV state (episode resume +
// played latch + likes) in lib/auth/store.js against a real temp SQLite adapter.
// Mirrors podcast-user-store.test.js: round-trips + per-user isolation, the
// played toggle, null-prototype row keys, the id-keyed prune carrier
// (removeTvEpisodeState, born v1.195), and the FK cascade on user delete. The
// user_tv_* tables already shipped (schema v19); these bind the read/write
// accessors added with the routes.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
const createUserStore = require('../../lib/auth/store');

let dir, adapter, store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tvstore-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  store = createUserStore(adapter);
});
afterEach(() => {
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ISO = '2026-08-26T12:00:00.000Z';
const ISO2 = '2026-08-26T13:00:00.000Z';
function twoUsers() {
  const a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'ha' }, {}, ISO);
  const b = store.createUser({ username: 'b', displayName: 'B', passwordHash: 'hb', role: 'member' }, ISO);
  return { a, b };
}

test('tv progress round-trips and is per-user isolated; upsert wins latest', () => {
  const { a, b } = twoUsers();
  store.setTvProgress(a.id, 'ep1', { position: 1200.5, duration: 2580, updatedAt: ISO });
  store.setTvProgress(b.id, 'ep1', { position: 7, duration: 2580, updatedAt: ISO });
  assert.deepEqual(store.getOneTvProgress(a.id, 'ep1'), { position: 1200.5, duration: 2580, updatedAt: ISO });
  assert.deepEqual(store.getOneTvProgress(b.id, 'ep1'), { position: 7, duration: 2580, updatedAt: ISO });
  store.setTvProgress(a.id, 'ep1', { position: 2500, duration: 2580, updatedAt: ISO2 });
  assert.deepEqual(store.getOneTvProgress(a.id, 'ep1'), { position: 2500, duration: 2580, updatedAt: ISO2 });
  assert.equal(store.getOneTvProgress(a.id, 'nope'), null);
});

test('tv played latch: set / re-set / clear, per-user isolated', () => {
  const { a, b } = twoUsers();
  store.setTvPlayed(a.id, 'ep1', ISO);
  store.setTvPlayed(a.id, 'ep2', ISO);
  store.setTvPlayed(b.id, 'ep1', ISO2);
  assert.deepEqual({ ...store.getTvPlayed(a.id) }, { ep1: ISO, ep2: ISO });
  assert.deepEqual({ ...store.getTvPlayed(b.id) }, { ep1: ISO2 });
  store.setTvPlayed(a.id, 'ep1', ISO2); // idempotent re-latch updates the stamp
  assert.equal(store.getTvPlayed(a.id).ep1, ISO2);
  store.clearTvPlayed(a.id, 'ep1'); // the manual unwatch toggle
  assert.deepEqual({ ...store.getTvPlayed(a.id) }, { ep2: ISO });
  assert.deepEqual({ ...store.getTvPlayed(b.id) }, { ep1: ISO2 }, 'b untouched');
});

test('tv likes: round-trip, idempotent add, per-user ACTOR isolation', () => {
  const { a, b } = twoUsers();
  store.addTvLiked(a.id, 'ep1', ISO);
  store.addTvLiked(a.id, 'ep2', ISO2);
  store.addTvLiked(b.id, 'ep1', ISO2);
  assert.deepEqual(store.getTvLiked(a.id), [{ episodeId: 'ep2', likedAt: ISO2 }, { episodeId: 'ep1', likedAt: ISO }], 'latest-first');
  assert.deepEqual(store.getTvLiked(b.id), [{ episodeId: 'ep1', likedAt: ISO2 }], 'b sees ONLY b\'s likes');
  store.addTvLiked(a.id, 'ep1', ISO2); // DO NOTHING - first stamp wins
  assert.equal(store.getTvLiked(a.id).find((l) => l.episodeId === 'ep1').likedAt, ISO);
  store.removeTvLiked(a.id, 'ep1');
  assert.deepEqual(store.getTvLiked(a.id), [{ episodeId: 'ep2', likedAt: ISO2 }]);
  assert.deepEqual(store.getTvLiked(b.id), [{ episodeId: 'ep1', likedAt: ISO2 }], 'a\'s unlike NEVER touches b\'s row');
});

test('a hostile __proto__ episode id lands as a plain key (null-prototype maps)', () => {
  const { a } = twoUsers();
  store.setTvProgress(a.id, '__proto__', { position: 1, duration: 2, updatedAt: ISO });
  const prog = store.getTvProgress(a.id);
  assert.deepEqual(prog['__proto__'], { position: 1, duration: 2, updatedAt: ISO });
  assert.strictEqual(Object.prototype.polluted, undefined);
  assert.strictEqual(Object.getPrototypeOf(prog), null);
});

test('removeTvEpisodeState purges EVERY user\'s progress/played/liked for those episodes only', () => {
  const { a, b } = twoUsers();
  store.setTvProgress(a.id, 'ep1', { position: 10, duration: 100, updatedAt: ISO });
  store.setTvProgress(b.id, 'ep1', { position: 20, duration: 100, updatedAt: ISO });
  store.setTvProgress(a.id, 'ep2', { position: 30, duration: 100, updatedAt: ISO });
  store.setTvPlayed(a.id, 'ep1', ISO);
  store.setTvPlayed(b.id, 'ep2', ISO);
  store.addTvLiked(a.id, 'ep1', ISO);
  store.addTvLiked(b.id, 'ep1', ISO2);

  store.removeTvEpisodeState(['ep1']);
  assert.equal(store.getOneTvProgress(a.id, 'ep1'), null);
  assert.equal(store.getOneTvProgress(b.id, 'ep1'), null);
  assert.deepEqual({ ...store.getTvPlayed(a.id) }, {});
  assert.deepEqual({ ...store.getTvPlayed(b.id) }, { ep2: ISO });
  assert.deepEqual(store.getTvLiked(a.id), [], 'a\'s ep1 like purged');
  assert.deepEqual(store.getTvLiked(b.id), [], 'EVERY user\'s ep1 like purged');
  assert.deepEqual(store.getOneTvProgress(a.id, 'ep2'), { position: 30, duration: 100, updatedAt: ISO }, 'other episodes untouched');

  store.removeTvEpisodeState([]); // no-op, never throws
  store.removeTvEpisodeState('ep2'); // scalar form
  assert.equal(store.getOneTvProgress(a.id, 'ep2'), null);
});

test('FK cascade: deleting a user removes their tv rows', () => {
  const { a, b } = twoUsers();
  store.setTvProgress(b.id, 'ep1', { position: 1, duration: 2, updatedAt: ISO });
  store.setTvPlayed(b.id, 'ep1', ISO);
  store.addTvLiked(b.id, 'ep1', ISO);
  store.deleteUser(b.id);
  assert.equal(adapter.sql.prepare('SELECT COUNT(*) AS n FROM user_tv_progress').get().n, 0);
  assert.equal(adapter.sql.prepare('SELECT COUNT(*) AS n FROM user_tv_played').get().n, 0);
  assert.equal(adapter.sql.prepare('SELECT COUNT(*) AS n FROM user_tv_liked').get().n, 0);
  store.setTvProgress(a.id, 'epX', { position: 1, duration: 2, updatedAt: ISO });
  assert.notEqual(store.getOneTvProgress(a.id, 'epX'), null, 'the surviving user is unaffected');
});
