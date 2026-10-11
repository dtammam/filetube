'use strict';

// [UNIT] v1.386.0 speed pass (W3): the music library's read routes take a SHARED, FROZEN snapshot of the
// music_tracks rows (lib/media/jsonRowStore.js getAllShared via featureStore.readPartShared) instead of re-reading
// and re-parsing ~23,000 rows per request. The snapshot is rebuilt whenever SQLite's own per-table write counter
// moves (lib/db/tableGeneration.js: TEMP triggers on INSERT / UPDATE / DELETE), so every writer is seen - the store
// methods, the feature store's diff, a raw statement, a restore's DELETE FROM - and a rolled-back write is undone
// with its count. Binds: reuse while unchanged, a rebuild after each kind of write, the freeze, the transaction
// bypass, the rollback, and that a mutator still writes (the snapshot never reaches the diff).

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SQLITE_FILENAME, SqliteAdapter } = require('../../lib/db/sqlite');
const musicStore = require('../../lib/music/store');

let dir, adapter, store;
const trk = (id, over) => ({ id, title: 'T ' + id, artist: 'A', album: 'Al', filePath: `/music/A/Al/${id}.flac`, rootFolder: '/music', tags: { genre: ['g'] }, ...over });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-shared-tracks-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  store = musicStore.createMusicStore(adapter);
  store.replaceAll({ folders: ['/music'], tracks: { a: trk('a'), b: trk('b') }, settings: {}, channels: {} });
});
afterEach(() => {
  try { adapter.close(); } catch (_) { /* closed by the test */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an unchanged table hands back the SAME snapshot; it equals a fresh read', () => {
  const s1 = store.readPartShared('tracks');
  const s2 = store.readPartShared('tracks');
  assert.strictEqual(s1, s2, 'reused, not re-read');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s1)), store.readPart('tracks'));
  assert.deepStrictEqual(Object.keys(s1).sort(), ['a', 'b']);
});

test('the snapshot is frozen all the way down (an in-place edit throws, the shared copy never drifts)', () => {
  const s = store.readPartShared('tracks');
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.a) && Object.isFrozen(s.a.tags) && Object.isFrozen(s.a.tags.genre));
  assert.throws(() => { s.a.title = 'edited'; }, TypeError);
  assert.throws(() => { s.a.tags.genre.push('x'); }, TypeError);
  assert.throws(() => { s.c = trk('c'); }, TypeError);
  assert.strictEqual(store.readPart('tracks').a.title, 'T a');
});

// Every write path moves SQLite's counter, so the next read rebuilds and shows the write.
const WRITES = {
  'mutate (the feature store diff)': () => store.mutate((h) => { musicStore.ensureMusic(h).tracks.c = trk('c'); return true; }),
  'mutate editing a row in place': () => store.mutate((h) => { musicStore.ensureMusic(h).tracks.a.title = 'renamed'; return true; }),
  'mutate deleting a row': () => store.mutate((h) => { delete musicStore.ensureMusic(h).tracks.b; return true; }),
  'parts.tracks.set': () => store.parts.tracks.set('c', trk('c')),
  'parts.tracks.setMany': () => store.parts.tracks.setMany({ a: trk('a', { title: 'renamed' }) }),
  'parts.tracks.remove': () => store.parts.tracks.remove('b'),
  'parts.tracks.rekey': () => store.parts.tracks.rekey('b', 'c'),
  'parts.tracks.replaceAll': () => store.parts.tracks.replaceAll({ a: trk('a', { title: 'renamed' }) }),
  'the restore (replaceAll on the namespace)': () => store.replaceAll({ folders: [], tracks: { z: trk('z') }, settings: {}, channels: {} }),
  'a raw UPDATE statement': () => adapter.sql.prepare("UPDATE music_tracks SET json = ? WHERE track_id = 'a'").run(JSON.stringify(trk('a', { title: 'renamed' }))),
  'a raw DELETE FROM (the exclusiveReplace shape)': () => adapter.sql.exec('DELETE FROM music_tracks'),
};
for (const [name, write] of Object.entries(WRITES)) {
  test('a write the snapshot must see: ' + name, () => {
    const before = store.readPartShared('tracks');
    write();
    const after = store.readPartShared('tracks');
    assert.notStrictEqual(after, before, 'rebuilt');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(after)), store.readPart('tracks'), 'the rebuilt snapshot is the table');
  });
}

test('a write to ANOTHER table (settings, folders) keeps the snapshot', () => {
  const before = store.readPartShared('tracks');
  store.mutate((h) => { const ns = musicStore.ensureMusic(h); ns.folders = ['/music', '/more']; ns.settings.x = 1; return true; });
  assert.strictEqual(store.readPartShared('tracks'), before);
});

test('inside an open transaction it reads uncached; a rolled-back write never survives in the snapshot', () => {
  const before = store.readPartShared('tracks');
  adapter.begin();
  store.parts.tracks.set('c', trk('c'));
  const inside = store.readPartShared('tracks');
  assert.ok(inside.c, 'the open transaction sees its own row');
  assert.notStrictEqual(inside, before);
  adapter.rollback();
  const after = store.readPartShared('tracks');
  assert.ok(!after.c, 'the rolled-back row is gone');
  // the in-transaction read was never cached: a later COMMITTED write that lands on the same counter value still
  // rebuilds (the snapshot is keyed to a state that was committed)
  store.parts.tracks.set('d', trk('d'));
  const later = store.readPartShared('tracks');
  assert.ok(later.d && !later.c);
});

test('the TEMP triggers are re-installed if one goes missing, and never touch the stored schema', () => {
  const s0 = store.readPartShared('tracks');
  const temp = adapter.sql.prepare("SELECT name FROM sqlite_temp_master WHERE type = 'trigger' ORDER BY name").all().map((r) => r.name);
  assert.deepStrictEqual(temp, ['ft_gen_music_tracks_del', 'ft_gen_music_tracks_ins', 'ft_gen_music_tracks_upd']);
  const main = adapter.sql.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'ft_gen_%' OR name = 'ft_table_gen'").all();
  assert.deepStrictEqual(main, [], 'nothing in the database file');
  adapter.sql.exec('DROP TRIGGER temp.ft_gen_music_tracks_upd');
  // a write in the gap (no trigger to count it)
  adapter.sql.prepare("UPDATE music_tracks SET json = ? WHERE track_id = 'b'").run(JSON.stringify(trk('b', { title: 'in the gap' })));
  const before = store.readPartShared('tracks'); // re-installs AND rebuilds: the counter cannot vouch for the gap
  assert.notStrictEqual(before, s0);
  assert.strictEqual(before.b.title, 'in the gap');
  adapter.sql.prepare("UPDATE music_tracks SET json = ? WHERE track_id = 'a'").run(JSON.stringify(trk('a', { title: 'after reinstall' })));
  assert.strictEqual(store.readPartShared('tracks').a.title, 'after reinstall');
  assert.notStrictEqual(store.readPartShared('tracks'), before);
});

test('a mutator still persists an in-place edit after the snapshot was taken (the snapshot never reaches the diff)', () => {
  const s = store.readPartShared('tracks');
  store.mutate((h) => { musicStore.ensureMusic(h).tracks.a.title = 'persisted'; return true; });
  assert.strictEqual(store.readPart('tracks').a.title, 'persisted');
  assert.strictEqual(s.a.title, 'T a', 'an earlier snapshot is never edited');
  assert.strictEqual(store.readPartShared('tracks').a.title, 'persisted');
});

test('readPartShared refuses a part that is not a map', () => {
  assert.throws(() => store.readPartShared('folders'), /needs a map part/);
  assert.throws(() => store.readPartShared('nope'), /needs a map part/);
});
