'use strict';

// [UNIT] Wave 4 of the relational-migration arc (2026-09-14), second group -
// the folder config leaves doc_single: `folders` -> library_folders (an
// ordered list, lib/config/folders.js on lib/db/orderedListStore.js),
// `folderSettings` -> library_folder_settings and `folderDisplayNames` ->
// channel_folder_display_names (lib/config/folderSettings.js /
// folderDisplayNames.js on lib/media/jsonRowStore.js with an honest key
// column). Binds, in order:
//   1. the three stores' shapes (order kept, values verbatim, key columns);
//   2. the v24 -> v25 MIGRATION: the list numbered by index (a duplicate / an
//      unaddressable entry collapsed or skipped with a log line), the maps one
//      row per key, doc rows deleted, stamp 25, load() has none of the keys,
//      save() works, re-run idempotent, a corrupt row rolls the whole block
//      back to a re-runnable v24 (all three CREATE TABLEs included), a
//      wrong-shaped row dropped with a log line;
//   3. the save-lock refuses the three dead keys;
//   4. the bulk seams: importParsedJson routes the list through replaceFolders
//      (validated whole, refused without the handle / on a bad entry) and the
//      maps through their handles; exclusiveReplace wipes + repopulates all
//      three inside its transaction and rolls back whole on a bad row;
//   5. readPersistedDatabase surfaces the three under their old keys;
//   6. source locks: server.js never names the tables or the dead doc keys in
//      CODE and calls the stores at every seam; the config POST's two writes
//      ride inSaveTransaction together.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const {
  SQLITE_FILENAME, SqliteAdapter, SCHEMA_VERSION, readPersistedDatabase, importParsedJson,
  __openRawForTests: openRaw,
} = require('../../lib/db/sqlite');
const { ensureLegacyDocTables, countLegacyDocTables } = require('../helpers/legacy-doc-tables');
const createFolderStore = require('../../lib/config/folders');
const createFolderSettingsStore = require('../../lib/config/folderSettings');
const createFolderDisplayNameStore = require('../../lib/config/folderDisplayNames');

const NUL = String.fromCharCode(0);
let dir;
let adapter;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-folder-stores-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
});
afterEach(() => {
  try { adapter.close(); } catch (_) { /* closed by the test */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const stores = () => ({ f: createFolderStore(adapter), fs: createFolderSettingsStore(adapter), fd: createFolderDisplayNameStore(adapter) });
const folderRows = () => adapter.sql.prepare('SELECT path, position FROM library_folders ORDER BY position').all().map((r) => [r.path, r.position]);
const SETTING = { name: 'Movies', hidden: false, hiddenFromSidebar: true, glyph: 'film' };

// ---- 1. the stores ---------------------------------------------------------------

test('folder stores: the root list keeps the operator order and spelling; the two maps keep values verbatim under honest key columns', () => {
  const { f, fs: fsS, fd } = stores();
  f.replaceAll(['/b/', 'relative/dir', '/a']);
  assert.deepStrictEqual(f.list(), ['/b/', 'relative/dir', '/a'], 'order and spelling as given - never path.resolve()d (FIX-1)');
  assert.deepStrictEqual(folderRows(), [['/b/', 0], ['relative/dir', 1], ['/a', 2]]);
  fsS.set('/b/', SETTING);
  fsS.set('/synthetic/downloads', { name: 'Downloads', order: 2 });
  assert.deepStrictEqual(fsS.getAll(), { '/b/': SETTING, '/synthetic/downloads': { name: 'Downloads', order: 2 } }, 'a synthetic root may hold a row without a folder row');
  assert.deepStrictEqual(adapter.sql.prepare('SELECT root_path FROM library_folder_settings ORDER BY root_path').all().map((r) => r.root_path), ['/b/', '/synthetic/downloads']);
  fd.set('NESTALGIA', 'Nestalgia Music');
  assert.strictEqual(fd.get('NESTALGIA'), 'Nestalgia Music', 'a string record round-trips');
  assert.deepStrictEqual(adapter.sql.prepare('SELECT folder_name, json FROM channel_folder_display_names').all().map((r) => [r.folder_name, r.json]), [['NESTALGIA', '"Nestalgia Music"']]);
});

// ---- 2. the migration ------------------------------------------------------------

function rewindToV24(singles) {
  adapter.close();
  const raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('DROP TABLE library_folders; DROP TABLE library_folder_settings; DROP TABLE channel_folder_display_names; PRAGMA user_version = 24');
  ensureLegacyDocTables(raw);
  const ins = raw.prepare('INSERT INTO doc_single(name, json) VALUES(?, ?)');
  for (const [name, json] of singles) ins.run(name, json);
  raw.close();
}
const reopen = () => { adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }); return adapter; };

test('migration v25: the list is numbered by index, the maps split one row per key (verbatim), doc rows deleted, stamp 25, load() has no keys, save() works', () => {
  assert.ok(SCHEMA_VERSION >= 25);
  rewindToV24([
    ['folders', JSON.stringify(['/media/movies', '/media/tv'])],
    ['folderSettings', JSON.stringify({ '/media/movies': SETTING, '/synthetic': { name: 'D', order: 1 } })],
    ['folderDisplayNames', JSON.stringify({ NESTALGIA: 'Nestalgia Music' })],
  ]);
  reopen();
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const { f, fs: fsS, fd } = stores();
  assert.deepStrictEqual(f.list(), ['/media/movies', '/media/tv']);
  assert.deepStrictEqual(fsS.getAll(), { '/media/movies': SETTING, '/synthetic': { name: 'D', order: 1 } });
  assert.deepStrictEqual(fd.getAll(), { NESTALGIA: 'Nestalgia Music' });
  assert.strictEqual(countLegacyDocTables(adapter.sql), 0, 'the doc tables are gone (v33 - which refuses to drop a table that still holds a row, so every drain before it deleted its rows)');
  const db = adapter.load();
  for (const k of ['folders', 'folderSettings', 'folderDisplayNames']) assert.strictEqual(db[k], undefined, `no doc-model ${k} key`);
  assert.doesNotThrow(() => adapter.save(db));
  assert.deepStrictEqual(f.list(), ['/media/movies', '/media/tv'], 'a doc save never touches the tables');
});

test('migration v25: re-run is a no-op; a corrupt doc row rolls the whole block back to a re-runnable v24 (all three CREATE TABLEs included)', () => {
  rewindToV24([]);
  reopen();
  stores().f.replaceAll(['/kept']);
  adapter.close();
  let raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('PRAGMA user_version = 24');
  ensureLegacyDocTables(raw);
  raw.close();
  reopen();
  assert.deepStrictEqual(stores().f.list(), ['/kept'], 'a re-run neither wipes nor duplicates');
  rewindToV24([['folders', JSON.stringify(['/good'])], ['folderSettings', '{not json']]);
  assert.throws(() => new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }), /JSON|Unexpected/);
  raw = openRaw(path.join(dir, SQLITE_FILENAME));
  assert.strictEqual(raw.prepare('PRAGMA user_version').get().user_version, 24);
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM doc_single WHERE name IN ('folders', 'folderSettings')").get().c, 2, 'doc rows untouched');
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name IN ('library_folders', 'library_folder_settings', 'channel_folder_display_names')").get().c, 0, 'every table creation rolled back');
  raw.prepare("UPDATE doc_single SET json = ? WHERE name = 'folderSettings'").run('{}');
  raw.close();
  reopen();
  assert.deepStrictEqual(stores().f.list(), ['/good'], 'repaired and re-run');
});

test('migration v25: a duplicate / an unaddressable list entry and an unaddressable map key are collapsed / skipped and logged; a wrong-shaped row is dropped and logged', () => {
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    rewindToV24([
      ['folders', JSON.stringify(['/a', '', '/a', 7, '/b'])],
      ['folderSettings', JSON.stringify({ '': { name: 'x' }, '/a': { name: 'A' } })],
      ['folderDisplayNames', JSON.stringify('not a map')],
    ]);
    reopen();
    const { f, fs: fsS, fd } = stores();
    assert.deepStrictEqual(f.list(), ['/a', '/b'], 'duplicates collapsed keep-first, junk skipped');
    assert.deepStrictEqual(folderRows(), [['/a', 0], ['/b', 1]], 'numbered by kept index');
    assert.deepStrictEqual(fsS.getAll(), { '/a': { name: 'A' } });
    assert.deepStrictEqual(fd.getAll(), {});
    assert.strictEqual(logged.filter((l) => l.includes('migration v25: skipping a library folder entry')).length, 2, logged.join(' | '));
    assert.strictEqual(logged.filter((l) => l.includes('migration v25: skipping a folderSettings key')).length, 1);
    assert.strictEqual(logged.filter((l) => l.includes('migration v25: the folderDisplayNames row was not an object')).length, 1);
    assert.strictEqual(countLegacyDocTables(adapter.sql), 0, 'the doc tables are gone (v33)');
  } finally {
    console.error = orig;
  }
});

// ---- 3. the save-lock -------------------------------------------------------------

test('save-lock: `folders`, `folderSettings` and `folderDisplayNames` on the doc object are REFUSED', () => {
  assert.throws(() => adapter.save({ metadata: {}, folders: [] }), /unknown top-level db key 'folders'/);
  assert.throws(() => adapter.save({ metadata: {}, folderSettings: {} }), /unknown top-level db key 'folderSettings'/);
  assert.throws(() => adapter.save({ metadata: {}, folderDisplayNames: {} }), /unknown top-level db key 'folderDisplayNames'/);
});

// ---- 4. the bulk seams ---------------------------------------------------------------

test('importParsedJson: the list routes through replaceFolders (validated whole, duplicates collapsed) and the maps through their handles; refuses without a handle / on a bad entry', () => {
  const calls = { folders: null, fs: [], fd: [] };
  const h = {
    insertViewCount: () => {}, insertProgress: () => {}, insertTombstone: () => {}, insertTrash: () => {}, insertSetting: () => {},
    replaceFolders: (list) => { calls.folders = list; }, insertFolderSetting: (k, v) => calls.fs.push([k, v]), insertFolderDisplayName: (k, v) => calls.fd.push([k, v]),
  };
  const summary = importParsedJson({ folders: ['/a', '/b', '/a'], folderSettings: { '/a': SETTING }, folderDisplayNames: { N: 'Name' }, metadata: {} }, h);
  assert.deepStrictEqual(calls.folders, ['/a', '/b']);
  assert.deepStrictEqual(calls.fs, [['/a', SETTING]]);
  assert.deepStrictEqual(calls.fd, [['N', 'Name']]);
  assert.strictEqual(summary.folders, 2);
  assert.strictEqual(summary.folderSettings, 1);
  const noHandle = { ...h };
  delete noHandle.replaceFolders;
  assert.throws(() => importParsedJson({ folders: ['/x'] }, noHandle), /no replaceFolders handle/);
  assert.doesNotThrow(() => importParsedJson({ folders: [] }, noHandle), 'an empty list needs no handle');
  assert.throws(() => importParsedJson({ folders: 'nope' }, h), /'folders' is not an array/);
  assert.throws(() => importParsedJson({ folders: ['/ok', ''] }, h), /non-empty string/);
  assert.throws(() => importParsedJson({ folders: ['/ok', 'a' + NUL] }, h), /U\+0000/);
  assert.throws(() => importParsedJson({ folderSettings: ['x'] }, h), /'folderSettings' is not an object/);
  assert.throws(() => importParsedJson({ folderDisplayNames: { ['a' + NUL]: 'x' } }, h), /U\+0000/);
});

test('exclusiveReplace: wipes all three tables, repopulates through the handles inside its transaction, rolls back whole on a bad row', () => {
  const { f, fs: fsS, fd } = stores();
  f.replaceAll(['/old']);
  fsS.set('/old', SETTING);
  fd.set('Old', 'Old Name');
  adapter.exclusiveReplace(() => {});
  assert.deepStrictEqual([f.size(), fsS.size(), fd.size()], [0, 0, 0], 'restore = the bundle and nothing else');
  adapter.exclusiveReplace((h) => { h.replaceFolders(['/b', '/a', '/b']); h.insertFolderSetting('/a', SETTING); h.insertFolderDisplayName('N', 'Name'); });
  assert.deepStrictEqual(f.list(), ['/b', '/a'], 'order kept, duplicate collapsed');
  assert.deepStrictEqual(fsS.getAll(), { '/a': SETTING });
  assert.deepStrictEqual(fd.getAll(), { N: 'Name' });
  assert.throws(() => adapter.exclusiveReplace((h) => { h.replaceFolders(['/c']); h.insertFolderSetting('x' + NUL, {}); }), /U\+0000/);
  assert.deepStrictEqual(f.list(), ['/b', '/a'], 'rolled back whole');
  assert.throws(() => adapter.exclusiveReplace((h) => h.insertFolderDisplayName('d', undefined)), /undefined/);
  assert.throws(() => adapter.exclusiveReplace((h) => h.replaceFolders(['/ok', 42])), /non-empty string/);
});

// ---- 5. the test read ------------------------------------------------------------------

test('readPersistedDatabase: surfaces the three under their old keys only when rows exist', () => {
  assert.deepStrictEqual(readPersistedDatabase(dir), {});
  const { f, fs: fsS, fd } = stores();
  f.replaceAll(['/z', '/a']);
  fsS.set('/a', SETTING);
  fd.set('N', 'Name');
  assert.deepStrictEqual(readPersistedDatabase(dir), { folders: ['/z', '/a'], folderSettings: { '/a': SETTING }, folderDisplayNames: { N: 'Name' } });
  f.replaceAll([]);
  fsS.remove('/a');
  fd.remove('N');
  assert.deepStrictEqual(readPersistedDatabase(dir), {});
});

// ---- 6. source locks -----------------------------------------------------------------------

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

test('source lock: server.js never names the three tables or the dead doc keys in CODE, calls the stores at every seam, and the config POST writes both maps in ONE inSaveTransaction', () => {
  const server = stripComments(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'));
  for (const t of ['library_folders', 'library_folder_settings', 'channel_folder_display_names']) assert.ok(!server.includes(t), t);
  // Every holder name the doc object has worn in this file (the gate lesson: `cachedForBooks`, `cached` and `mdb` hid three reads from the first census).
  assert.ok(!/\b(db|freshDb|fresh|current|state|next|prev|cached\w*|mdb|loaded|persisted|snapshot)\.(folders|folderSettings|folderDisplayNames)\b/.test(server), 'no doc-model access to the dead keys survives');
  assert.ok(!/(getCachedDatabase|loadDatabase)\(\)\.(folders|folderSettings|folderDisplayNames)\b/.test(server));
  for (const call of ['folderStore.list(', 'folderStore.replaceAll(', 'folderStore.remove(', 'folderStore.size(', 'folderSettingsStore.getAll(', 'folderSettingsStore.replaceAll(', 'folderDisplayNameStore.getAll(', 'folderDisplayNameStore.get(', 'folderDisplayNameStore.set(', 'folderDisplayNameStore.remove(']) {
    assert.ok(server.includes(call), `server.js calls ${call}`);
  }
  assert.match(server, /inSaveTransaction\(\(\) => \{\s*folderStore\.replaceAll\(validFolders\);\s*folderSettingsStore\.replaceAll\(cleanSettings\);\s*\}\)/, 'the config POST writes the list and the map inside one commit');
  const ytdlp = stripComments(fs.readFileSync(path.join(ROOT, 'lib', 'ytdlp', 'index.js'), 'utf8'));
  assert.ok(!/\bdb\.folders\b/.test(ytdlp), 'the yt-dlp module no longer touches db.folders in code');
  assert.ok(/deps\.removeLibraryFolder\(/.test(ytdlp) && /deps\.getLibraryFolders\(\)/.test(ytdlp), 'the stale-downloadDir migration goes through the deps seam');
});

test('migration stamps ride their OWN commits: v25 lands and v26 fails -> the stamp is 25 (the folder rows kept, their doc rows gone) - defence in depth behind the v24 floor (adversarial pass A delta N1b)', () => {
  adapter.close();
  let raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('DROP TABLE library_folders; DROP TABLE library_folder_settings; DROP TABLE channel_folder_display_names; DROP TABLE media_liked; PRAGMA user_version = 24');
  ensureLegacyDocTables(raw);
  const ins = raw.prepare('INSERT INTO doc_single(name, json) VALUES(?, ?)');
  ins.run('folders', JSON.stringify(['/kept']));
  ins.run('liked', '[not json'); // v26 will fail on this row
  raw.close();
  assert.throws(() => new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }), /JSON|Unexpected/);
  raw = openRaw(path.join(dir, SQLITE_FILENAME));
  assert.strictEqual(raw.prepare('PRAGMA user_version').get().user_version, 25, 'the stamp is the last COMMITTED floor');
  assert.deepStrictEqual(raw.prepare('SELECT path FROM library_folders').all().map((r) => r.path), ['/kept'], 'v25 committed its rows');
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM doc_single WHERE name = 'folders'").get().c, 0, 'and deleted the doc row');
  raw.prepare("UPDATE doc_single SET json = '[]' WHERE name = 'liked'").run();
  raw.close();
  reopen();
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'repaired: runs to the current version');
  assert.deepStrictEqual(stores().f.list(), ['/kept'], 'the folder list survived the partial run intact');
});
