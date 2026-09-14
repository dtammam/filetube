'use strict';

// [UNIT] Wave 4 of the relational-migration arc (2026-09-14), third group -
// `liked` (the FROZEN pre-auth likes the first admin adopts once, v1.30 /
// v1.43) leaves doc_single for `media_liked` (lib/media/liked.js on the shared
// lib/db/orderedListStore.js shape). After it, no top-level doc_single name is
// left. Binds, in order:
//   1. the store keeps like ORDER and re-keys in place (the array idiom wrote
//      the new id back at the same index);
//   2. the v25 -> v26 MIGRATION: rows numbered by index, duplicate collapsed,
//      unaddressable entry skipped + logged, the doc row deleted, stamp 26,
//      load() has no `liked` key, save() works, re-run idempotent, a corrupt
//      row rolls back to a re-runnable v25 (CREATE TABLE included), a
//      non-array row dropped + logged;
//   3. the save-lock refuses the dead key, and SINGLETON_NAMES holds container
//      sub-keys only;
//   4. the bulk seams: importParsedJson routes the list through replaceLiked
//      (validated whole; refused without the handle / on a bad entry);
//      exclusiveReplace wipes + repopulates inside its transaction;
//   5. readPersistedDatabase surfaces `liked` (like order) when rows exist;
//   6. source locks: server.js never names the table or the dead doc key in
//      CODE, and every carrier re-key/remove rides inSaveTransaction.

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
const createLikedStore = require('../../lib/media/liked');

const NUL = String.fromCharCode(0);
let dir;
let adapter;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-liked-store-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
});
afterEach(() => {
  try { adapter.close(); } catch (_) { /* closed by the test */ }
  fs.rmSync(dir, { recursive: true, force: true });
});
const rows = () => adapter.sql.prepare('SELECT media_id, position FROM media_liked ORDER BY position').all().map((r) => [r.media_id, r.position]);

test('liked store: like order kept; rekey keeps the slot (rename / trash / restore); remove drops the row (purge); a non-member re-key is a no-op', () => {
  const l = createLikedStore(adapter);
  l.replaceAll(['b', 'a', 'c']);
  assert.deepStrictEqual(l.list(), ['b', 'a', 'c']);
  assert.strictEqual(l.rekey('a', 'trash-a'), true);
  assert.deepStrictEqual(l.list(), ['b', 'trash-a', 'c'], 'the trashed item keeps its slot');
  assert.strictEqual(l.rekey('trash-a', 'a'), true);
  assert.deepStrictEqual(l.list(), ['b', 'a', 'c'], 'and comes back into it');
  assert.strictEqual(l.rekey('ghost', 'x'), false, 'an unliked item: nothing to carry');
  assert.strictEqual(l.remove('b'), 1);
  assert.deepStrictEqual(l.list(), ['a', 'c']);
});

function rewindToV25(likedJson) {
  adapter.close();
  const raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('DROP TABLE media_liked; PRAGMA user_version = 25');
  ensureLegacyDocTables(raw);
  if (likedJson !== undefined) raw.prepare('INSERT INTO doc_single(name, json) VALUES(?, ?)').run('liked', likedJson);
  raw.close();
}
const reopen = () => { adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }); return adapter; };

test('migration v26: the doc array becomes rows numbered by index (duplicate collapsed, unaddressable skipped + logged), doc row deleted, stamp 26, load() has no liked key, save() works', () => {
  assert.ok(SCHEMA_VERSION >= 26);
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    rewindToV25(JSON.stringify(['b', 'a', '', 'b', 7, 'c']));
    reopen();
  } finally {
    console.error = orig;
  }
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const l = createLikedStore(adapter);
  assert.deepStrictEqual(l.list(), ['b', 'a', 'c'], 'like order, duplicate collapsed keep-first, junk skipped');
  assert.deepStrictEqual(rows(), [['b', 0], ['a', 1], ['c', 2]]);
  assert.strictEqual(logged.filter((m) => m.includes('migration v26: skipping a liked entry')).length, 2, logged.join(' | '));
  assert.strictEqual(countLegacyDocTables(adapter.sql), 0, 'the doc tables are gone (v33 - which refuses to drop a table that still holds a row, so every drain before it deleted its rows)');
  const db = adapter.load();
  assert.strictEqual(db.liked, undefined, 'no doc-model liked key');
  assert.doesNotThrow(() => adapter.save(db));
  assert.deepStrictEqual(l.list(), ['b', 'a', 'c'], 'a doc save never touches the table');
});

test('migration v26: no doc row -> empty table; re-run is a no-op; a corrupt row rolls back to a re-runnable v25 (CREATE TABLE included); a non-array row is dropped + logged', () => {
  rewindToV25(undefined);
  reopen();
  assert.deepStrictEqual(rows(), []);
  createLikedStore(adapter).replaceAll(['kept']);
  adapter.close();
  let raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('PRAGMA user_version = 25');
  ensureLegacyDocTables(raw);
  raw.close();
  reopen();
  assert.deepStrictEqual(createLikedStore(adapter).list(), ['kept'], 'a re-run neither wipes nor duplicates');
  rewindToV25('[not json');
  assert.throws(() => new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }), /JSON|Unexpected/);
  raw = openRaw(path.join(dir, SQLITE_FILENAME));
  assert.strictEqual(raw.prepare('PRAGMA user_version').get().user_version, 25);
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM doc_single WHERE name = 'liked'").get().c, 1, 'the doc row untouched');
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 'media_liked'").get().c, 0, 'the table creation rolled back too');
  raw.prepare("UPDATE doc_single SET json = ? WHERE name = 'liked'").run(JSON.stringify({ not: 'an array' }));
  raw.close();
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try { reopen(); } finally { console.error = orig; }
  assert.deepStrictEqual(rows(), [], 'a non-array row is dropped');
  assert.strictEqual(logged.filter((m) => m.includes('migration v26: the liked row was not an array')).length, 1, logged.join(' | '));
});

test('save-lock: `liked` on the doc object is REFUSED', () => {
  assert.throws(() => adapter.save({ metadata: {}, liked: [] }), /unknown top-level db key 'liked'/);
  assert.throws(() => adapter.save({ metadata: {}, liked: ['a'] }), /unknown top-level db key 'liked'/);
});

test('importParsedJson: the list routes through replaceLiked (validated whole, duplicates collapsed); refused without the handle / on a bad entry', () => {
  let got = null;
  const h = { insertViewCount: () => {}, insertProgress: () => {}, insertTombstone: () => {}, insertTrash: () => {}, insertSetting: () => {}, replaceFolders: () => {}, insertFolderSetting: () => {}, insertFolderDisplayName: () => {}, replaceLiked: (list) => { got = list; } };
  const summary = importParsedJson({ metadata: {}, liked: ['a', 'b', 'a'] }, h);
  assert.deepStrictEqual(got, ['a', 'b']);
  assert.strictEqual(summary.liked, 2);
  const noHandle = { ...h };
  delete noHandle.replaceLiked;
  assert.throws(() => importParsedJson({ liked: ['x'] }, noHandle), /no replaceLiked handle/);
  assert.doesNotThrow(() => importParsedJson({ liked: [] }, noHandle), 'an empty list needs no handle');
  assert.throws(() => importParsedJson({ liked: 'nope' }, h), /'liked' is not an array/);
  assert.throws(() => importParsedJson({ liked: ['ok', ''] }, h), /non-empty string/);
  assert.throws(() => importParsedJson({ liked: ['ok', 'a' + NUL] }, h), /U\+0000/);
});

test('exclusiveReplace: wipes the table, repopulates through replaceLiked inside its transaction, rolls back whole on a bad entry', () => {
  const l = createLikedStore(adapter);
  l.replaceAll(['old']);
  adapter.exclusiveReplace(() => {});
  assert.strictEqual(l.size(), 0, 'restore = the bundle and nothing else');
  adapter.exclusiveReplace((h) => { h.replaceLiked(['b', 'a', 'b']); });
  assert.deepStrictEqual(l.list(), ['b', 'a']);
  assert.throws(() => adapter.exclusiveReplace((h) => { h.replaceLiked(['c', 42]); }), /non-empty string/);
  assert.deepStrictEqual(l.list(), ['b', 'a'], 'rolled back whole');
});

test('readPersistedDatabase: surfaces `liked` in like order only when rows exist', () => {
  assert.deepStrictEqual(readPersistedDatabase(dir), {});
  const l = createLikedStore(adapter);
  l.replaceAll(['z', 'a']);
  assert.deepStrictEqual(readPersistedDatabase(dir), { liked: ['z', 'a'] });
  l.replaceAll([]);
  assert.deepStrictEqual(readPersistedDatabase(dir), {});
});

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

test('source lock: server.js never names media_liked or the dead doc key in CODE; every carrier write rides inSaveTransaction; the adoption and the stats inventory read the table', () => {
  const server = stripComments(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'));
  assert.ok(!server.includes('media_liked'));
  assert.ok(!/\b(db|freshDb|fresh|current|state|next|prev|cached\w*|mdb|loaded|persisted|snapshot|getCachedDatabase\(\)|loadDatabase\(\))\.liked\b/.test(server), 'no doc-model liked access survives');
  assert.strictEqual((server.match(/inSaveTransaction\(\(\) => likedStore\.rekey\(/g) || []).length, 3, 'rename, trash and restore re-key inside the commit');
  assert.strictEqual((server.match(/inSaveTransaction\(\(\) => likedStore\.remove\(/g) || []).length, 1, 'purge removes inside the commit');
  assert.ok(/liked: likedStore\.list\(\)/.test(server), 'the adoption and the stats inventory read the table');
  assert.ok(/bundle\.liked = likedStore\.list\(\)/.test(server), 'the bundle reads the table');
});
