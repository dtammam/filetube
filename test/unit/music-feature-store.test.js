'use strict';

// [UNIT] Wave 5 of the relational-migration arc (2026-09-14), second feature -
// the music namespace (`music.folders` / `music.tracks` / `music.settings` /
// `music.channels`) leaves the document model for music_folders / music_tracks /
// music_settings / music_channels behind the feature store lib/music/store.js
// exports (FEATURE, createMusicStore). `music.channels` was a doc_single MAP -
// the migration splits it into one row per folder. Binds:
//   1. the v27 -> v28 MIGRATION: the root list, the episode rows and the
//      settings copied verbatim, the doc rows (doc_kv + doc_single) deleted,
//      stamp 28 inside the block, load() has no `tv` key, save() works, re-run
//      idempotent, a corrupt episode row rolls the whole block back to a
//      re-runnable v27 (all four CREATE TABLEs included);
//   2. the save-lock refuses a stray `db.tv` write (the container left the lock);
//   3. the bulk seams: importParsedJson routes `tv` whole through
//      replaceFeature (refused without the handle / on an unknown part / a bad
//      shape); exclusiveReplace wipes all three tables and repopulates inside
//      its transaction, rolling back whole on a bad row;
//   4. readPersistedDatabase surfaces `tv` in its container shape when any
//      part has rows;
//   5. source locks: server.js never names the tables or the dead doc
//      spellings in CODE; the scan merge and the config POST run through
//      tvDb.mutate; the reads take tvDb.read().

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const {
  SQLITE_FILENAME, SqliteAdapter, SCHEMA_VERSION, FEATURE_DEFS, readPersistedDatabase, importParsedJson,
  __openRawForTests: openRaw,
} = require('../../lib/db/sqlite');
const { ensureLegacyDocTables, countLegacyDocTables } = require('../helpers/legacy-doc-tables');
const { routeSurfaceSource } = require('../helpers/route-surface'); // Wave 7b: the source locks read server.js + its registerRoutes modules
const musicStore = require('../../lib/music/store');

let dir;
let adapter;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-music-feature-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
});
afterEach(() => {
  try { adapter.close(); } catch (_) { /* closed by the test */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const trk = (id, over) => ({ id, title: id, artist: 'A', album: 'Al', filePath: `/music/A/Al/${id}.flac`, rootFolder: '/music', ...over });

function rewindToV27(rows) {
  adapter.close();
  const raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('DROP TABLE music_folders; DROP TABLE music_tracks; DROP TABLE music_settings; DROP TABLE music_channels; PRAGMA user_version = 27');
  ensureLegacyDocTables(raw);
  const kv = raw.prepare('INSERT INTO doc_kv(namespace, key, json) VALUES(?, ?, ?)');
  const single = raw.prepare('INSERT INTO doc_single(name, json) VALUES(?, ?)');
  for (const [kind, a, b, c] of rows) (kind === 'kv' ? kv.run(a, b, c) : single.run(a, b));
  raw.close();
}
const reopen = () => { adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }); return adapter; };

test('migration v27: the root list, the episode rows and the settings move verbatim; doc rows deleted; stamp 28; load() has no tv key; save() works', () => {
  assert.ok(SCHEMA_VERSION >= 28);
  assert.ok(FEATURE_DEFS.some((d) => d.name === 'music'));
  rewindToV27([
    ['single', 'music.folders', JSON.stringify(['/music/b', '/music/a'])],
    ['single', 'music.settings', JSON.stringify({ x: 1 })],
    ['single', 'music.channels', JSON.stringify({ NESTALGIA: 'on', Zarchivo: 'off' })],
    ['kv', 'music.tracks', 't1', JSON.stringify(trk('t1', { albumArtKey: 'k' }))],
    ['kv', 'music.tracks', 't2', JSON.stringify(trk('t2'))],
  ]);
  reopen();
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const music = musicStore.createMusicStore(adapter);
  assert.deepStrictEqual(music.read(), { folders: ['/music/b', '/music/a'], tracks: { t1: trk('t1', { albumArtKey: 'k' }), t2: trk('t2') }, settings: { x: 1 }, channels: { NESTALGIA: 'on', Zarchivo: 'off' } });
  assert.deepStrictEqual(adapter.sql.prepare('SELECT folder_name, json FROM music_channels ORDER BY folder_name').all().map((r) => [r.folder_name, r.json]), [['NESTALGIA', '"on"'], ['Zarchivo', '"off"']], 'the doc_single MAP became one row per folder');
  assert.strictEqual(countLegacyDocTables(adapter.sql), 0, 'the doc tables are gone (v33 - which refuses to drop a table that still holds a row, so every drain before it deleted its rows)');
  const db = adapter.load();
  assert.strictEqual(db.music, undefined, 'no doc-model music key');
  assert.doesNotThrow(() => adapter.save(db));
  assert.deepStrictEqual(music.read().folders, ['/music/b', '/music/a'], 'a doc save never touches the tables');
  assert.deepStrictEqual(musicStore.readMusic(music.holder()), { folders: music.read().folders, tracks: music.read().tracks, settings: music.read().settings }, 'the module\'s read view over the holder is the same snapshot');
});

test('migration v28: re-run is a no-op; a corrupt track row rolls the whole block back to a re-runnable v27 (all four CREATE TABLEs included)', () => {
  rewindToV27([]);
  reopen();
  musicStore.createMusicStore(adapter).replaceAll({ folders: ['/kept'] });
  adapter.close();
  let raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('PRAGMA user_version = 27');
  ensureLegacyDocTables(raw);
  raw.close();
  reopen();
  assert.deepStrictEqual(musicStore.createMusicStore(adapter).read().folders, ['/kept'], 'a re-run neither wipes nor duplicates');
  rewindToV27([['single', 'music.folders', JSON.stringify(['/good'])], ['kv', 'music.tracks', 'bad', '{not json']]);
  assert.throws(() => new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }), /JSON|Unexpected/);
  raw = openRaw(path.join(dir, SQLITE_FILENAME));
  assert.strictEqual(raw.prepare('PRAGMA user_version').get().user_version, 27, 'the stamp is the last committed floor');
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM doc_kv WHERE namespace = 'music.tracks'").get().c, 1, 'doc rows untouched');
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name IN ('music_folders', 'music_tracks', 'music_settings', 'music_channels')").get().c, 0, 'every table creation rolled back');
  raw.prepare("UPDATE doc_kv SET json = ? WHERE key = 'bad'").run(JSON.stringify(trk('bad')));
  raw.close();
  reopen();
  assert.deepStrictEqual(Object.keys(musicStore.createMusicStore(adapter).read().tracks), ['bad'], 'repaired and re-run');
});

test('save-lock: a stray `music` container on the doc object is REFUSED (the container left the lock)', () => {
  assert.throws(() => adapter.save({ metadata: {}, music: { folders: [] } }), /unknown top-level db key 'music'/);
});

test('importParsedJson: `music` routes whole through replaceFeature (never doc rows); refused without the handle / on an unknown part / a bad shape', () => {
  const features = [];
  const h = { insertViewCount: () => {}, insertProgress: () => {}, insertTombstone: () => {}, insertTrash: () => {}, insertSetting: () => {}, replaceFolders: () => {}, insertFolderSetting: () => {}, insertFolderDisplayName: () => {}, replaceLiked: () => {}, replaceFeature: (name, ns) => features.push([name, ns]) };
  const ns = { folders: ['/music'], tracks: { t1: trk('t1') }, settings: {}, channels: { N: 'on' } };
  const summary = importParsedJson({ metadata: {}, music: ns }, h);
  assert.deepStrictEqual(features, [['music', ns]]);
  assert.strictEqual(summary['music.folders'], 1);
  assert.strictEqual(summary['music.tracks'], 1);
  assert.strictEqual(summary['music.channels'], 1);
  const noHandle = { ...h };
  delete noHandle.replaceFeature;
  assert.throws(() => importParsedJson({ music: ns }, noHandle), /no replaceFeature handle/);
  assert.throws(() => importParsedJson({ music: ['x'] }, h), /'music' is not an object/);
  assert.throws(() => importParsedJson({ music: { playlists: {} } }, h), /unknown key 'music\.playlists'/);
});

test('exclusiveReplace: wipes all four tables, repopulates through replaceFeature inside its transaction, rolls back whole on a bad row', () => {
  const music = musicStore.createMusicStore(adapter);
  music.replaceAll({ folders: ['/old'], tracks: { old: trk('old') }, settings: { s: 1 }, channels: { O: 'on' } });
  adapter.exclusiveReplace(() => {});
  assert.deepStrictEqual(music.read(), { folders: [], tracks: {}, settings: {}, channels: {} }, 'restore = the bundle and nothing else');
  adapter.exclusiveReplace((h) => { h.replaceFeature('music', { folders: ['/b', '/a'], tracks: { t1: trk('t1') }, channels: { N: 'off' } }); });
  assert.deepStrictEqual(music.read(), { folders: ['/b', '/a'], tracks: { t1: trk('t1') }, settings: {}, channels: { N: 'off' } });
  assert.throws(() => adapter.exclusiveReplace((h) => { h.replaceFeature('music', { folders: ['/c'], tracks: { '': trk('x') } }); }), /non-empty string/);
  assert.deepStrictEqual(music.read().folders, ['/b', '/a'], 'rolled back whole');
  assert.throws(() => adapter.exclusiveReplace((h) => h.replaceFeature('nope', {})), /unknown feature 'nope'/);
});

test('readPersistedDatabase: surfaces `music` in its container shape only when some part has rows', () => {
  assert.deepStrictEqual(readPersistedDatabase(dir), {});
  const music = musicStore.createMusicStore(adapter);
  music.replaceAll({ channels: { N: 'on' } });
  assert.deepStrictEqual(readPersistedDatabase(dir), { music: { folders: [], tracks: {}, settings: {}, channels: { N: 'on' } } });
  music.replaceAll(null);
  assert.deepStrictEqual(readPersistedDatabase(dir), {});
});

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

test('source lock: the route surface never names the music tables or the dead doc spellings in CODE; the scan merge, the config POST and the channel-mark route run through musicDb.mutate; the reads take musicDb.read()', () => {
  // Wave 7b (the monolith split, slice S1a): shapedQueue's music reads left
  // server.js with the /api/queue routes. The lock reads the whole ROUTE
  // SURFACE - server.js plus every registerRoutes module it registers, derived
  // from server.js's own requires - so the counts follow the code and the
  // never-name-the-table checks now cover the modules too.
  const server = routeSurfaceSource((p) => stripComments(fs.readFileSync(p, 'utf8')), ROOT);
  for (const t of ['music_folders', 'music_tracks', 'music_settings', 'music_channels']) assert.ok(!server.includes(t), t);
  assert.ok(!/\b(db|freshDb|fresh|current|state|next|prev|cached\w*|loaded|persisted|snapshot|handoffDb|srcMeta|getCachedDatabase\(\)|loadDatabase\(\))\.music\b/.test(server), 'no doc-model music access survives');
  assert.ok(!/musicStore\.readMusic\(/.test(server), 'every read view moved to musicDb.read()');
  assert.ok(!/musicStore\.ensureMusic\((db|fresh|freshDb)\)/.test(server), 'no ensureMusic over the doc object');
  assert.strictEqual((server.match(/musicDb\.mutate\(/g) || []).length, 3, 'the scan merge, the config POST and the channel-mark route - the three writers');
  assert.ok((server.match(/musicDb\.read\(\)/g) || []).length + (server.match(/musicDb\.parts\.tracks\.get\(/g) || []).length + (server.match(/musicDb\.readPart\(/g) || []).length >= 30, 'the reads (snapshots + the point queries + the one-table reads of gate pass B)');
  assert.ok((server.match(/musicDb\.parts\.tracks\.get\(/g) || []).length >= 4 && (server.match(/musicDb\.readPart\('channels'\)/g) || []).length >= 2, 'gate pass B: single-track lookups are point queries; the mark readers read one table');
  assert.ok(/bundle\.music = musicDb\.read\(\)/.test(server), 'the bundle reads the tables');
});
