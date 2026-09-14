'use strict';

// [UNIT] Wave 7 of the relational-migration arc (2026-09-14) - schema v33
// DROPS the two document tables (`doc_kv`, `doc_single`) that v1.42 persisted
// the legacy object into and that Waves 1-6 (v21-v32) drained. Binds:
//   1. a v1.295-shaped file (v32, both tables empty) loses both tables and
//      stamps 33; a fresh file has none; a re-run is a no-op;
//   2. the REFUSAL: a table that still holds a row (bytes no build reads any
//      more, but bytes all the same) makes the open throw, naming every stray
//      namespace / name with its row count; the database stays at v32 with the
//      tables AND the rows intact (re-runnable, still writable by v1.295);
//      deleting the rows lets the next open finish;
//   3. the whole chain from v20: a file stamped back below every drain with
//      real legacy rows runs every block against the re-created doc tables
//      (the below-v33 guard in migrateSchema), the rows land in their tables,
//      and v33 finds the doc tables empty and drops them;
//   4. the adapter's exports carry no doc-model list or handle any more.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sqlite = require('../../lib/db/sqlite');
const { SQLITE_FILENAME, SqliteAdapter, SCHEMA_VERSION, readPersistedDatabase, __openRawForTests: openRaw } = sqlite;
const { ensureLegacyDocTables, countLegacyDocTables } = require('../helpers/legacy-doc-tables');

let dir;
let adapter;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-doc-drop-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
});
afterEach(() => {
  try { adapter.close(); } catch (_) { /* closed by the test */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const dbPath = () => path.join(dir, SQLITE_FILENAME);
const reopen = () => { adapter = new SqliteAdapter(dbPath(), { log: () => {} }); return adapter; };
const version = (sql) => sql.prepare('PRAGMA user_version').get().user_version;

// Rewind a fresh (v33) file to the v1.295 shape: the doc tables present and
// EMPTY, stamped 32 - then plant whatever rows the test wants.
function rewindToV32(plant = () => {}) {
  adapter.close();
  const raw = openRaw(dbPath());
  raw.exec('PRAGMA user_version = 32');
  ensureLegacyDocTables(raw);
  plant(raw);
  raw.close();
}

test('migration v33: a v1.295-shaped file (v32, both doc tables empty) loses both tables and stamps 33; a fresh file has none; a re-run is a no-op', () => {
  assert.strictEqual(SCHEMA_VERSION, 33, 'Wave 7 is the fourteenth floor');
  assert.strictEqual(countLegacyDocTables(adapter.sql), 0, 'a fresh file has no document tables');
  adapter.save({ metadata: { kept: { id: 'kept', title: 'Kept' } } });
  rewindToV32();
  let raw = openRaw(dbPath());
  assert.strictEqual(countLegacyDocTables(raw), 2, 'the rewind models a v1.295 file: both tables present');
  raw.close();
  reopen();
  assert.strictEqual(version(adapter.sql), 33);
  assert.strictEqual(countLegacyDocTables(adapter.sql), 0, 'both tables dropped');
  assert.deepStrictEqual(adapter.load(), { metadata: { kept: { id: 'kept', title: 'Kept' } } }, 'the relational rows are untouched');
  // re-run: stamp back to 32 WITHOUT the tables (a file that already ran v33
  // cannot be at 32 for real; the guard re-creates them and v33 drops them again)
  adapter.close();
  raw = openRaw(dbPath());
  raw.exec('PRAGMA user_version = 32');
  raw.close();
  reopen();
  assert.strictEqual(version(adapter.sql), 33);
  assert.strictEqual(countLegacyDocTables(adapter.sql), 0);
  assert.deepStrictEqual(readPersistedDatabase(dir).metadata.kept.title, 'Kept');
});

test('migration v33: REFUSES to drop a table that still holds a row - names every stray with its count, leaves v32 + the tables + the rows intact (re-runnable); deleting the rows lets the next open finish', () => {
  adapter.save({ metadata: { kept: { id: 'kept' } } });
  rewindToV32((raw) => {
    raw.prepare('INSERT INTO doc_kv(namespace, key, json) VALUES(?, ?, ?)').run('ghost.ns', 'k1', '1');
    raw.prepare('INSERT INTO doc_kv(namespace, key, json) VALUES(?, ?, ?)').run('ghost.ns', 'k2', '2');
    raw.prepare('INSERT INTO doc_single(name, json) VALUES(?, ?)').run('ghost', '"x"');
  });
  assert.throws(
    () => new SqliteAdapter(dbPath(), { log: () => {} }),
    /migration v33 refuses to drop the document tables while they still hold rows: doc_kv namespace 'ghost\.ns' \(2 row\(s\)\); doc_single name 'ghost' \(1 row\(s\)\)\..*still opens on v1\.295/s,
    'the refusal names the strays and the way back'
  );
  const raw = openRaw(dbPath());
  try {
    assert.strictEqual(version(raw), 32, 'the stamp is the last committed floor - a v1.295 build still opens this file');
    assert.strictEqual(countLegacyDocTables(raw), 2, 'the tables survived');
    assert.strictEqual(raw.prepare('SELECT COUNT(*) AS c FROM doc_kv').get().c + raw.prepare('SELECT COUNT(*) AS c FROM doc_single').get().c, 3, 'and every row with them');
    assert.strictEqual(raw.prepare('SELECT COUNT(*) AS c FROM media_items').get().c, 1, 'the relational rows too');
    // the operator's way through: export / delete the rows deliberately
    raw.exec('DELETE FROM doc_kv; DELETE FROM doc_single');
  } finally {
    raw.close();
  }
  reopen();
  assert.strictEqual(version(adapter.sql), 33);
  assert.strictEqual(countLegacyDocTables(adapter.sql), 0);
  assert.deepStrictEqual(Object.keys(adapter.load().metadata), ['kept']);
});

test('migration v33: the refusal names a NUL-bearing namespace as BYTES (never two strays under one truncated name - #225) and caps the list', () => {
  const NUL = String.fromCharCode(0);
  rewindToV32((raw) => {
    const ins = raw.prepare('INSERT INTO doc_kv(namespace, key, json) VALUES(?, ?, ?)');
    ins.run(`evil${NUL}x`, 'k', '1'); // the bind stores the bytes on every runtime (#225)
    ins.run('evil', 'k', '1');
    for (let i = 0; i < 25; i++) ins.run(`ns${String(i).padStart(2, '0')}`, 'k', '1');
  });
  let message = '';
  try { new SqliteAdapter(dbPath(), { log: () => {} }); } catch (err) { message = err.message; }
  assert.match(message, /doc_kv namespace <bytes 6576696C0078> \(1 row\(s\)\)/, 'the NUL-bearing name is reported as its bytes');
  assert.match(message, /doc_kv namespace 'evil' \(1 row\(s\)\)/, 'and the real one by name - two distinct strays');
  assert.strictEqual((message.match(/row\(s\)/g) || []).length, 20, 'capped at 20 entries');
  assert.match(message, /; \.\.\. and 7 more\./, 'the remainder is counted, not printed');
  assert.match(message, /The document tables and their rows are unchanged; the database is still at v32/);
  const raw = openRaw(dbPath());
  try {
    assert.strictEqual(version(raw), 32);
    assert.strictEqual(raw.prepare('SELECT COUNT(*) AS c FROM doc_kv').get().c, 27, 'every row survived');
  } finally { raw.close(); }
});

test('the below-v33 guard LOGS when a STAMPED file lacks a doc table (tampering) and stays silent for a fresh file and for a rewind that re-created them', () => {
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    adapter.close();
    let raw = openRaw(dbPath());
    raw.exec('PRAGMA user_version = 25'); // stamped, tables absent - the tamper shape
    raw.close();
    reopen();
    assert.strictEqual(logged.filter((l) => /MISSING its document table\(s\) doc_kv, doc_single/.test(l)).length, 1, logged.join(' | '));
    logged.length = 0;
    rewindToV32(); // the tables re-created by the rewind: nothing to say
    reopen();
    assert.deepStrictEqual(logged.filter((l) => /MISSING/.test(l)), []);
    adapter.close();
    raw = openRaw(dbPath());
    raw.exec('PRAGMA user_version = 0'); // a fresh-file shape: the v1 block creates them, no log
    raw.close();
    reopen();
    assert.deepStrictEqual(logged.filter((l) => /MISSING/.test(l)), []);
  } finally { console.error = orig; }
});

test('migration v33: a file that would-be-refused is never partially dropped - one stray in doc_single alone keeps doc_kv too', () => {
  rewindToV32((raw) => { raw.prepare('INSERT INTO doc_single(name, json) VALUES(?, ?)').run('lonely', 'null'); });
  assert.throws(() => new SqliteAdapter(dbPath(), { log: () => {} }), /doc_single name 'lonely' \(1 row\(s\)\)/);
  const raw = openRaw(dbPath());
  try {
    assert.strictEqual(countLegacyDocTables(raw), 2, 'neither table dropped - the check runs before any DROP');
    assert.strictEqual(version(raw), 32);
  } finally {
    raw.close();
  }
});

test('the whole chain from v20 with real legacy rows: every drain runs against the re-created doc tables, the rows land in their tables, v33 finds the doc tables empty and drops them', () => {
  adapter.close();
  const raw = openRaw(dbPath());
  // A fresh (v33) file has no doc tables. Rewinding below every drain models a
  // v1.290 file - which HAD them - so the tables are re-created here, exactly
  // as migrateSchema's below-v33 guard does for a file that merely lost them.
  raw.exec('DROP TABLE media_view_counts; DROP TABLE media_items; PRAGMA user_version = 20');
  ensureLegacyDocTables(raw);
  raw.prepare('INSERT INTO doc_kv(namespace, key, json) VALUES(?, ?, ?)').run('viewCounts', 'vid1', '7');
  raw.prepare('INSERT INTO doc_kv(namespace, key, json) VALUES(?, ?, ?)').run('metadata', 'vid1', JSON.stringify({ id: 'vid1', title: 'One' }));
  raw.prepare('INSERT INTO doc_single(name, json) VALUES(?, ?)').run('settings', JSON.stringify({ scanIntervalMinutes: 45 }));
  raw.close();
  reopen();
  assert.strictEqual(version(adapter.sql), 33);
  assert.strictEqual(countLegacyDocTables(adapter.sql), 0, 'dropped at the end of the chain');
  const persisted = readPersistedDatabase(dir);
  assert.deepStrictEqual(persisted.viewCounts, { vid1: 7 }, 'v21 drained the count');
  assert.deepStrictEqual(persisted.metadata, { vid1: { id: 'vid1', title: 'One' } }, 'v32 drained the index');
  assert.deepStrictEqual(persisted.settings, { scanIntervalMinutes: 45 }, 'v24 drained the settings');
});

test('the below-v33 guard: a file stamped below v33 that LOST its doc tables (a test rewind, never a real file) gets them re-created so the drains can run - without the guard the first drain would throw "no such table"', () => {
  adapter.close();
  const raw = openRaw(dbPath());
  raw.exec('PRAGMA user_version = 20'); // no ensureLegacyDocTables: the tables are absent
  raw.close();
  assert.doesNotThrow(() => reopen(), 'every drain ran against re-created (empty) tables');
  assert.strictEqual(version(adapter.sql), 33);
  assert.strictEqual(countLegacyDocTables(adapter.sql), 0);
});

test('the adapter exports no doc-model list, no doc handle, no boot importer (Wave 7)', () => {
  for (const gone of ['DOC_KV_NAMESPACES', 'SINGLETON_NAMES', 'CONTAINER_KEYS', 'importDbJson']) {
    assert.strictEqual(sqlite[gone], undefined, `${gone} left with the document model`);
  }
  assert.deepStrictEqual(sqlite.DOC_OBJECT_KEYS, ['metadata'], 'the one key of the doc object the routes still read');
  adapter.exclusiveReplace((handles) => {
    assert.strictEqual(handles.insertKv, undefined);
    assert.strictEqual(handles.insertSingle, undefined);
    assert.strictEqual(typeof handles.insertItem, 'function', 'the index handle is what a bundle restore uses');
  });
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'db', 'sqlite.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const fromClass = src.slice(src.indexOf('class SqliteAdapter'));
  assert.ok(!/doc_kv|doc_single|SNAPSHOT_SEP|snapshot\.set|snapshot\.get/.test(fromClass), 'from the adapter class down, nothing names a doc table or the doc snapshot');
  assert.ok(!/require\(\s*['"`](?:node:)?fs(?:\/promises)?['"`]\s*\)/.test(src), 'the adapter module reads no file but the database (the fs require left with the importer - either spelling)');
});
