'use strict';

// v1.44 T1 (music): lib/music/store.js -- the `db.music` namespace owner.
// Mirrors test/unit/books-store.test.js's ensure/read/prune coverage. Pure
// module, no DB/ffmpeg -- direct calls against hand-built objects.

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../../lib/music/store');

// ---- ensureMusic -------------------------------------------------------------

test('T1: ensureMusic builds a fresh well-formed namespace and is idempotent (present keys untouched)', () => {
  const db = {};
  const ns = store.ensureMusic(db);
  assert.deepEqual(ns, { folders: [], tracks: {}, settings: {} });
  assert.strictEqual(db.music, ns);
  ns.tracks.trk1 = { id: 'trk1', title: 'Keep me' };
  const again = store.ensureMusic(db);
  assert.strictEqual(again.tracks.trk1.title, 'Keep me', 'a present tracks map is never rebuilt/dropped');
});

test('T1: ensureMusic repairs individually broken sub-keys without touching healthy ones', () => {
  const db = { music: { folders: 'junk', tracks: { t: { id: 't' } }, settings: [] } };
  const ns = store.ensureMusic(db);
  assert.deepEqual(ns.folders, [], 'broken folders repaired to []');
  assert.deepEqual(ns.settings, {}, 'broken settings (array) repaired to {}');
  assert.strictEqual(ns.tracks.t.id, 't', 'healthy tracks map preserved');
});

test('T1: ensureMusic replaces a non-object/array music namespace wholesale', () => {
  assert.deepEqual(store.ensureMusic({ music: 'nope' }), { folders: [], tracks: {}, settings: {} });
  assert.deepEqual(store.ensureMusic({ music: ['a'] }), { folders: [], tracks: {}, settings: {} });
});

// ---- readMusic (non-mutating) -----------------------------------------------

test('T1: readMusic returns a defensive shape and NEVER mutates its argument', () => {
  const db = {}; // no music namespace
  const view = store.readMusic(db);
  assert.deepEqual(view, { folders: [], tracks: {}, settings: {} });
  assert.strictEqual(db.music, undefined, 'readMusic must not create db.music (read-cache invariant)');

  const db2 = { music: { folders: ['/m'], tracks: { a: { id: 'a' } }, settings: { x: 1 } } };
  const v2 = store.readMusic(db2);
  assert.deepEqual(v2.folders, ['/m']);
  assert.deepEqual(v2.tracks, { a: { id: 'a' } });
  assert.deepEqual(v2.settings, { x: 1 });
});

test('T1: readMusic coerces broken sub-keys without throwing', () => {
  assert.deepEqual(store.readMusic({ music: { folders: 'x', tracks: [], settings: 5 } }),
    { folders: [], tracks: {}, settings: {} });
  assert.deepEqual(store.readMusic({ music: null }), { folders: [], tracks: {}, settings: {} });
  assert.deepEqual(store.readMusic(null), { folders: [], tracks: {}, settings: {} });
});

// ---- selectPrunableTrackIds (mount-loss policy) ------------------------------

test('T1: prune policy -- pruneMissing off prunes nothing; missing root protects its tracks; genuine deletes prune', () => {
  const tracks = {
    a: { id: 'a', rootFolder: '/m/one' },
    b: { id: 'b', rootFolder: '/m/two' },
    c: { id: 'c', rootFolder: '/m/one' },
  };
  const surviving = new Set(['a']); // b and c vanished this walk

  // pruneMissing OFF -> nothing prunes.
  assert.deepEqual(
    store.selectPrunableTrackIds(tracks, surviving, { missingRoots: new Set(), pruneMissing: false }),
    [],
  );
  // /m/two unmounted -> b protected; c (under mounted /m/one, vanished) prunes.
  assert.deepEqual(
    store.selectPrunableTrackIds(tracks, surviving, { missingRoots: new Set(['/m/two']), pruneMissing: true }),
    ['c'],
  );
  // both roots mounted -> both vanished tracks prune.
  assert.deepEqual(
    store.selectPrunableTrackIds(tracks, surviving, { missingRoots: new Set(), pruneMissing: true }).sort(),
    ['b', 'c'],
  );
  // empty map -> nothing.
  assert.deepEqual(store.selectPrunableTrackIds({}, new Set(), { pruneMissing: true }), []);
});

test('T1: selectPrunableTrackIds accepts array forms for surviving/missing', () => {
  const tracks = { a: { id: 'a', rootFolder: '/m' }, b: { id: 'b', rootFolder: '/m' } };
  assert.deepEqual(
    store.selectPrunableTrackIds(tracks, ['a'], { missingRoots: [], pruneMissing: true }),
    ['b'],
  );
});

// ---- albumKeyFor (grouping) -------------------------------------------------

test('T1: albumKeyFor prefers albumArtist, falls back to artist, and separates artist from album', () => {
  const sep = store.ALBUM_KEY_SEP;
  assert.equal(store.albumKeyFor({ albumArtist: 'VA', artist: 'Track Artist', album: 'Comp' }), `VA${sep}Comp`);
  assert.equal(store.albumKeyFor({ artist: 'Solo', album: 'LP' }), `Solo${sep}LP`);
  // Two DIFFERENT albums by the same artist never collide.
  assert.notEqual(store.albumKeyFor({ artist: 'A', album: 'One' }), store.albumKeyFor({ artist: 'A', album: 'Two' }));
  // Missing pieces degrade to '' rather than throwing.
  assert.equal(store.albumKeyFor({}), `${sep}`);
  assert.equal(store.albumKeyFor(null), `${sep}`);
});
