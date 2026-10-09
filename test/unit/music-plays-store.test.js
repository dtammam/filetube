'use strict';

// [UNIT] v1.378.0 music stations W1 (plan docs/exec-plans/completed/2026-10-09-music-stations.md): the
// per-user play / skip / finish counts (user_music_plays, schema v35), a user's own stations and the
// hidden station keys, against a real temp SQLite adapter - counter bumps, cross-user isolation, every
// id-keyed carrier (a native prune / move, a yt-dlp file's delete / move with its chapter rows), the
// backup round-trip, the user cascade and the test reset.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
const createUserStore = require('../../lib/auth/store');

let dir, adapter, store, a, b;
const ISO = (n) => `2026-10-09T12:00:0${n}.000Z`;
const MD5 = 'd41d8cd98f00b204e9800998ecf8427e'; // a media id (a yt-dlp audio file)
const MD5B = '0cc175b9c0f1b6a831c399e269772661';
const ev = (trackId, kind) => ({ trackId, kind });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-musicplays-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  store = createUserStore(adapter);
  a = store.createFirstAdmin({ username: 'a', displayName: 'A', passwordHash: 'h' }, null, ISO(0));
  b = store.createUser({ username: 'b', displayName: 'B', passwordHash: 'h', role: 'member' }, ISO(0));
});
afterEach(() => {
  adapter.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('recordMusicPlays bumps counters per kind; last_played_at moves only on a play; an unknown kind is ignored', () => {
  store.recordMusicPlays(a.id, [ev('t1', 'play'), ev('t1', 'finish'), ev('t2', 'skip')], ISO(1));
  store.recordMusicPlays(a.id, [ev('t1', 'play'), ev('t2', 'skip'), ev('t2', 'bogus'), { trackId: '', kind: 'play' }], ISO(2));
  const p = store.getMusicPlays(a.id);
  assert.deepStrictEqual(p.t1, { plays: 2, skips: 0, finishes: 1, lastPlayedAt: ISO(2) });
  assert.deepStrictEqual(p.t2, { plays: 0, skips: 2, finishes: 0, lastPlayedAt: null }, 'a skip never stamps last_played_at');
  assert.strictEqual(Object.keys(p).length, 2, 'the empty id and the bogus kind wrote nothing');
  assert.strictEqual(Object.getPrototypeOf(p), null, 'a null-proto map');
  store.recordMusicPlays(a.id, [ev('__proto__', 'play')], ISO(3));
  assert.deepStrictEqual(store.getMusicPlays(a.id).__proto__, { plays: 1, skips: 0, finishes: 0, lastPlayedAt: ISO(3) }, 'a hostile id is a plain key');
});

test('cross-user isolation: one user\'s counts never read as another\'s', () => {
  store.recordMusicPlays(a.id, [ev('shared', 'play')], ISO(1));
  assert.deepStrictEqual(store.getMusicPlays(b.id), Object.create(null));
  store.recordMusicPlays(b.id, [ev('shared', 'skip')], ISO(1));
  assert.strictEqual(store.getMusicPlays(a.id).shared.skips, 0);
  assert.strictEqual(store.getMusicPlays(b.id).shared.plays, 0);
});

test('removeMusicState (a native prune) sheds every user\'s counts for the track; rekeyMusicState carries them, a collision does not throw', () => {
  for (const u of [a, b]) store.recordMusicPlays(u.id, [ev('doomed', 'play'), ev('keeper', 'play')], ISO(1));
  store.removeMusicState(['doomed']);
  for (const u of [a, b]) assert.deepStrictEqual(Object.keys(store.getMusicPlays(u.id)), ['keeper']);
  store.recordMusicPlays(a.id, [ev('old', 'play'), ev('old', 'play')], ISO(2));
  store.recordMusicPlays(b.id, [ev('old', 'play'), ev('new', 'skip')], ISO(2));
  store.rekeyMusicState('old', 'new');
  assert.strictEqual(store.getMusicPlays(a.id).new.plays, 2, 'the counts moved to the new id');
  assert.strictEqual(store.getMusicPlays(a.id).old, undefined);
  assert.deepStrictEqual(Object.keys(store.getMusicPlays(b.id)).filter((k) => k !== 'keeper'), ['new'], 'one row under the new id after the collision');
});

test('removeMediaState (a yt-dlp file deleted) sheds the file\'s row AND its chapter rows, never a different file\'s; rekeyMediaState carries both', () => {
  store.recordMusicPlays(a.id, [ev(MD5, 'play'), ev(MD5 + '::c0', 'finish'), ev(MD5 + '::c12', 'skip'), ev(MD5B, 'play'), ev(MD5B + '::c0', 'play'), ev(MD5 + 'x', 'play')], ISO(1));
  store.removeMediaState([MD5]);
  assert.deepStrictEqual(Object.keys(store.getMusicPlays(a.id)).sort(), [MD5B, MD5B + '::c0', MD5 + 'x'].sort(), 'the base id and every ::c row went; a longer id sharing the prefix and another file stayed');
  store.rekeyMediaState(MD5B, MD5);
  const p = store.getMusicPlays(a.id);
  assert.strictEqual(p[MD5].plays, 1, 'the file row moved');
  assert.strictEqual(p[MD5 + '::c0'].plays, 1, 'its chapter row moved with it, the chapter index kept');
  assert.strictEqual(p[MD5B], undefined);
  assert.strictEqual(p[MD5B + '::c0'], undefined);
});

test('stations: set / get / replace / remove per user, creation order kept, a bad json row is skipped', () => {
  store.setMusicStation(a.id, 's1', { name: 'Chill', genres: ['chill'] }, ISO(1));
  store.setMusicStation(a.id, 's2', { name: 'Reggae', words: ['reggae'] }, ISO(2));
  store.setMusicStation(b.id, 's1', { name: 'Mine' }, ISO(1));
  assert.deepStrictEqual(store.getMusicStations(a.id).map((s) => [s.id, s.name, s.createdAt, s.updatedAt]), [['s1', 'Chill', ISO(1), ISO(1)], ['s2', 'Reggae', ISO(2), ISO(2)]]);
  store.setMusicStation(a.id, 's1', { name: 'Chill 2', genres: ['chill', 'ambient'] }, ISO(3));
  const s1 = store.getMusicStations(a.id)[0];
  assert.deepStrictEqual([s1.name, s1.genres, s1.createdAt, s1.updatedAt], ['Chill 2', ['chill', 'ambient'], ISO(1), ISO(3)], 'a replace keeps created_at, moves updated_at');
  store.removeMusicStation(a.id, 's2');
  store.removeMusicStation(a.id, 'ghost');
  assert.deepStrictEqual(store.getMusicStations(a.id).map((s) => s.id), ['s1']);
  assert.deepStrictEqual(store.getMusicStations(b.id).map((s) => s.name), ['Mine'], 'another user\'s s1 untouched');
  adapter.sql.exec(`INSERT INTO user_music_stations (user_id, station_id, json, created_at, updated_at) VALUES (${a.id}, 'bad', 'not json', '${ISO(4)}', '${ISO(4)}')`);
  assert.deepStrictEqual(store.getMusicStations(a.id).map((s) => s.id), ['s1'], 'a corrupt row is skipped, never thrown');
});

test('hidden station keys: hide is idempotent, unhide removes, per user', () => {
  store.setMusicStationHidden(a.id, 'g:rock', true, ISO(1));
  store.setMusicStationHidden(a.id, 'g:rock', true, ISO(2));
  store.setMusicStationHidden(a.id, 'favorites', true, ISO(3));
  assert.deepStrictEqual(store.getMusicStationHidden(a.id), [{ key: 'g:rock', hiddenAt: ISO(1) }, { key: 'favorites', hiddenAt: ISO(3) }]);
  assert.deepStrictEqual(store.getMusicStationHidden(b.id), []);
  store.setMusicStationHidden(a.id, 'g:rock', false);
  assert.deepStrictEqual(store.getMusicStationHidden(a.id).map((h) => h.key), ['favorites']);
});

test('backup export -> restore round-trips the three namespaces per user; an older bundle without them restores empty, losing nothing else', () => {
  store.recordMusicPlays(a.id, [ev('t1', 'play'), ev('t1', 'skip'), ev('t2', 'finish')], ISO(1));
  store.setMusicStation(a.id, 's1', { name: 'Chill', genres: ['chill'], strict: true }, ISO(2));
  store.setMusicStationHidden(a.id, 'g:rock', true, ISO(3));
  store.recordMusicPlays(b.id, [ev('t9', 'play')], ISO(1));
  store.addMusicLiked(a.id, 'liked-x', ISO(1));
  const bundle = store.exportUsersForBackup();
  const ab = bundle.find((u) => u.id === a.id);
  assert.deepStrictEqual(ab.musicPlays, [{ trackId: 't1', plays: 1, skips: 1, finishes: 0, lastPlayedAt: ISO(1) }, { trackId: 't2', plays: 0, skips: 0, finishes: 1, lastPlayedAt: null }]);
  assert.deepStrictEqual(ab.musicStations, [{ id: 's1', name: 'Chill', genres: ['chill'], strict: true, createdAt: ISO(2), updatedAt: ISO(2) }]);
  assert.deepStrictEqual(ab.musicStationHidden, [{ key: 'g:rock', hiddenAt: ISO(3) }]);
  store.replaceAllUsersRaw(JSON.parse(JSON.stringify(bundle)));
  assert.deepStrictEqual(store.getMusicPlays(a.id).t1, { plays: 1, skips: 1, finishes: 0, lastPlayedAt: ISO(1) }, 'restored verbatim, not added to');
  // a restored station is stored as the validator's NORMALIZED definition (v1.378.0 gate r2, security): every list present, years null
  assert.deepStrictEqual(store.getMusicStations(a.id), [{ id: 's1', name: 'Chill', genres: ['chill'], artists: [], words: [], yearFrom: null, yearTo: null, exclude: [], strict: true, createdAt: ISO(2), updatedAt: ISO(2) }]);
  assert.deepStrictEqual(store.getMusicStationHidden(a.id), [{ key: 'g:rock', hiddenAt: ISO(3) }]);
  assert.strictEqual(store.getMusicPlays(b.id).t9.plays, 1);
  const older = JSON.parse(JSON.stringify(bundle));
  for (const u of older) { delete u.musicPlays; delete u.musicStations; delete u.musicStationHidden; }
  store.replaceAllUsersRaw(older);
  assert.deepStrictEqual(store.getMusicPlays(a.id), Object.create(null));
  assert.deepStrictEqual(store.getMusicStations(a.id), []);
  assert.deepStrictEqual(store.getMusicStationHidden(a.id), []);
  assert.deepStrictEqual(store.getMusicLiked(a.id), ['liked-x'], 'the like survived the older bundle');
});

test('deleting a user cascades the three tables away; the survivor is untouched', () => {
  for (const u of [a, b]) {
    store.recordMusicPlays(u.id, [ev('t', 'play')], ISO(1));
    store.setMusicStation(u.id, 's', { name: 'S' }, ISO(1));
    store.setMusicStationHidden(u.id, 'k', true, ISO(1));
  }
  store.deleteUser(b.id);
  assert.deepStrictEqual(store.getMusicPlays(b.id), Object.create(null));
  assert.deepStrictEqual(store.getMusicStations(b.id), []);
  assert.deepStrictEqual(store.getMusicStationHidden(b.id), []);
  assert.strictEqual(store.getMusicPlays(a.id).t.plays, 1);
  assert.strictEqual(store.getMusicStations(a.id).length, 1);
  assert.strictEqual(store.getMusicStationHidden(a.id).length, 1);
});

test('__clearUserStateForTests empties the three tables', () => {
  store.recordMusicPlays(a.id, [ev('t', 'play')], ISO(1));
  store.setMusicStation(a.id, 's', { name: 'S' }, ISO(1));
  store.setMusicStationHidden(a.id, 'k', true, ISO(1));
  store.__clearUserStateForTests();
  for (const t of ['user_music_plays', 'user_music_stations', 'user_music_station_hidden']) {
    assert.strictEqual(adapter.sql.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c, 0, t);
  }
});
