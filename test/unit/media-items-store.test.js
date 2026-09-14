'use strict';

// [UNIT] Wave 6 of the relational-migration arc (2026-09-14) - the media
// index (`metadata`, the LAST doc_kv namespace) leaves the document model
// for `media_items` (media_id, json) behind lib/media/items.js. The routes
// keep reading the `{ metadata }` object the adapter's load() assembles and
// the mutators keep writing it; the adapter's save() hands the object's
// `metadata` to the store's per-row diff (plan / apply / advance) inside the
// same transaction as every inSaveTransaction effect. Binds:
//   1. the v31 -> v32 migration: verbatim rows (json text untouched, rowid
//      order kept), a NUL-bearing key skipped with a log line, the doc rows
//      deleted, the stamp inside the block, a re-run no-op, a corrupt row
//      rolling the whole block back to a re-runnable v31;
//   2. the diff: changed rows only, vanished ids deleted, absent key = rows
//      kept, empty map = wiped, `undefined` dropped, a NUL id refused, the
//      snapshot advancing only after COMMIT, an in-transaction effect's throw
//      rolling the item rows back;
//   3. the seams: import (viewCount extraction still through insertViewCount),
//      exclusiveReplace (wipe + insertItem + snapshot rebuild), the test read,
//      the stranded-import fingerprint counting the table;
//   4. the locks: no doc namespace left, server.js never names the table,
//      lib/media/items.js is the table's only runtime writer.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const {
  SQLITE_FILENAME, SqliteAdapter, SCHEMA_VERSION, DOC_KV_NAMESPACES, SINGLETON_NAMES, DOC_OBJECT_KEYS, readPersistedDatabase, importParsedJson, openAdapter,
  __openRawForTests: openRaw,
} = require('../../lib/db/sqlite');
const items = require('../../lib/media/items');

let dir;
let adapter;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-media-items-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
});
afterEach(() => {
  try { adapter.close(); } catch (_) { /* closed by the test */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const it = (id, over) => ({ id, name: `${id}.mp4`, title: id, filePath: `/m/${id}.mp4`, type: 'video', ...over });
const NUL = String.fromCharCode(0);

function rewindToV31(rows) {
  adapter.close();
  const raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec(`DROP TABLE ${items.TABLE}; PRAGMA user_version = 31`);
  const kv = raw.prepare('INSERT INTO doc_kv(namespace, key, json) VALUES(?, ?, ?)');
  for (const [key, json] of rows) kv.run('metadata', key, json);
  raw.close();
}
const reopen = (log) => { adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: log || (() => {}) }); return adapter; };
const docRows = () => adapter.sql.prepare("SELECT COUNT(*) AS c FROM doc_kv WHERE namespace = 'metadata'").get().c;
const rawJson = (id) => adapter.sql.prepare(`SELECT json FROM ${items.TABLE} WHERE media_id = ?`).get(id).json;

test('migration v32: the doc rows move VERBATIM (json text untouched, rowid order kept); an unaddressable (empty) key is skipped with a log line; doc rows deleted; stamp 32; no doc namespace is left', () => {
  assert.ok(SCHEMA_VERSION >= 32);
  assert.deepStrictEqual(DOC_KV_NAMESPACES, [], 'the last doc_kv namespace is gone');
  assert.deepStrictEqual(SINGLETON_NAMES, []);
  assert.deepStrictEqual(DOC_OBJECT_KEYS, ['metadata'], 'the doc OBJECT keeps its one key');
  const spaced = '{"id":"b","title":"B",  "keep":  "spacing"}'; // not JSON.stringify's spelling - must land byte-identical
  // An EMPTY key and a NUL-bearing one. node:sqlite reads a NUL-bearing TEXT
  // back truncated on <= 24.14 and verbatim on 24.20 (tracker #225); the
  // migration decides in SQL on the stored bytes, so `alpha\0` is skipped on
  // every runtime and can never clobber the real `alpha` (the gate's repro).
  rewindToV31([['zeta', JSON.stringify(it('zeta'))], ['b', spaced], ['', JSON.stringify(it('bad'))], ['alpha', JSON.stringify(it('alpha'))], [`alpha${NUL}`, JSON.stringify(it('impostor'))]]);
  const lines = [];
  const origErr = console.error;
  console.error = (m) => lines.push(String(m));
  try { reopen(); } finally { console.error = origErr; }
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepStrictEqual(Object.keys(adapter.load().metadata), ['zeta', 'b', 'alpha'], 'rowid order, not id order - the walk order the routes had');
  assert.strictEqual(rawJson('b'), spaced, 'the json text is the doc row\'s bytes, never re-serialized');
  assert.strictEqual(docRows(), 0, 'every doc row is gone (the skipped one included)');
  assert.strictEqual(lines.filter((l) => /migration v32: skipping a metadata key/.test(l)).length, 2, 'the empty key AND the NUL key are logged, not moved');
  assert.strictEqual(JSON.parse(rawJson('alpha')).title, 'alpha', 'the real alpha row was never clobbered by the NUL impostor');
  assert.ok(lines.some((l) => /migration v32: moved 3 media item/.test(l)));
  assert.strictEqual(adapter.sql.prepare('SELECT COUNT(*) AS c FROM doc_kv').get().c + adapter.sql.prepare('SELECT COUNT(*) AS c FROM doc_single').get().c, 0, 'BOTH doc tables are empty for good');
});

test('migration v32: re-run is a no-op; a corrupt row rolls the whole block back to a re-runnable v31 (CREATE TABLE included)', () => {
  rewindToV31([]);
  reopen();
  adapter.save({ metadata: { kept: it('kept') } });
  adapter.close();
  let raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('PRAGMA user_version = 31');
  raw.close();
  reopen();
  assert.deepStrictEqual(Object.keys(adapter.load().metadata), ['kept'], 'a re-run neither wipes nor duplicates');
  rewindToV31([['good', JSON.stringify(it('good'))], ['bad', '{not json']]);
  assert.throws(() => new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }), /JSON|Unexpected/);
  raw = openRaw(path.join(dir, SQLITE_FILENAME));
  assert.strictEqual(raw.prepare('PRAGMA user_version').get().user_version, 31, 'the stamp is the last committed floor');
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM doc_kv WHERE namespace = 'metadata'").get().c, 2, 'doc rows untouched');
  assert.strictEqual(raw.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE name = '${items.TABLE}'`).get().c, 0, 'the table creation rolled back');
  raw.prepare("UPDATE doc_kv SET json = ? WHERE key = 'bad'").run(JSON.stringify(it('bad')));
  raw.close();
  reopen();
  assert.deepStrictEqual(Object.keys(adapter.load().metadata), ['good', 'bad'], 'repaired and re-run');
});

test('the diff through the adapter: changed rows only, vanished ids deleted, absent key = rows kept, empty map = wiped, undefined dropped, a NUL id refused, the base advances only after COMMIT', () => {
  const s = adapter.items;
  assert.deepStrictEqual(adapter.save({ metadata: { a: it('a'), b: it('b'), c: it('c') } }), { rowsWritten: 3, rowsDeleted: 0 });
  assert.deepStrictEqual(adapter.save({ metadata: { a: it('a'), b: it('b', { title: 'B2' }), c: it('c') } }), { rowsWritten: 1, rowsDeleted: 0 }, 'one changed item = one row');
  assert.deepStrictEqual(adapter.save({ metadata: { a: it('a'), b: it('b', { title: 'B2' }) } }), { rowsWritten: 0, rowsDeleted: 1 }, 'a vanished id = one delete');
  assert.deepStrictEqual(adapter.save({}), { rowsWritten: 0, rowsDeleted: 0 }, 'an ABSENT key plans nothing');
  assert.strictEqual(s.size(), 2, 'rows kept');
  assert.deepStrictEqual(adapter.save({ metadata: { a: it('a'), b: it('b', { title: 'B2' }), ghost: undefined } }), { rowsWritten: 0, rowsDeleted: 0 }, 'an undefined value is not a row');
  assert.throws(() => adapter.save({ metadata: { a: it('a'), [`x${NUL}y`]: it('x') } }), /contains U\+0000.*truncates TEXT at NUL/s, 'a NUL id is refused at the write');
  assert.strictEqual(s.size(), 2, 'the refused save wrote nothing');
  // an in-transaction effect that throws rolls the item rows back and the base does not advance
  assert.throws(() => adapter.save({ metadata: { a: it('a', { title: 'A2' }), b: it('b', { title: 'B2' }) } }, { alsoInTransaction: () => { throw new Error('effect failed'); } }), /effect failed/);
  assert.strictEqual(JSON.parse(rawJson('a')).title, 'a', 'rolled back on disk');
  assert.deepStrictEqual(adapter.save({ metadata: { a: it('a', { title: 'A2' }), b: it('b', { title: 'B2' }) } }), { rowsWritten: 1, rowsDeleted: 0 }, 'the base did not advance: the same change still writes its row');
  assert.deepStrictEqual(adapter.save({ metadata: {} }), { rowsWritten: 0, rowsDeleted: 2 }, 'a PRESENT-but-empty map wipes');
  assert.strictEqual(adapter.load().metadata, undefined, 'and the empty index assembles as absent');
});

test('the store standalone: saveDiff / getAll / point queries; `__proto__` is inert own data; replaceAll rebuilds the base', () => {
  const s = adapter.items;
  assert.deepStrictEqual(s.saveDiff(JSON.parse(`{"a":${JSON.stringify(it('a'))},"__proto__":{"id":"proto","polluted":true}}`)), { rowsWritten: 2, rowsDeleted: 0 }); // (JSON.parse materialises an OWN __proto__ key; an object literal would set the prototype)
  const all = s.getAll();
  assert.ok(Object.prototype.hasOwnProperty.call(all, '__proto__'), 'an own key');
  assert.strictEqual(Object.getPrototypeOf(all).polluted, undefined);
  assert.strictEqual(s.get('a').title, 'a');
  assert.strictEqual(s.get(`a${NUL}`), undefined, 'a read is tolerant');
  s.replaceAll({ z: it('z') });
  assert.deepStrictEqual(s.saveDiff({ z: it('z') }), { rowsWritten: 0, rowsDeleted: 0 }, 'the base was rebuilt by replaceAll');
  assert.deepStrictEqual(Object.keys(s.getAll()), ['z']);
});

test('the seams: import extracts viewCount to its handle and routes items through insertItem (refused without it when items exist); exclusiveReplace wipes + insertItem + rebuilds the base; the test read surfaces the index only when rows exist', () => {
  const written = [];
  const counts = [];
  const h = { insertItem: (id, rec) => written.push([id, rec]), insertViewCount: (id, c) => counts.push([id, c]), insertKv: () => { throw new Error('never a doc row'); }, insertSingle: () => { throw new Error('never'); } };
  const summary = importParsedJson({ metadata: { v1: { id: 'v1', viewCount: 7, title: 'one' }, v2: { id: 'v2' } } }, h, { source: 'db.json' });
  assert.deepStrictEqual(written, [['v1', { id: 'v1', title: 'one' }], ['v2', { id: 'v2' }]], 'the count is extracted off the item; the rest lands verbatim');
  assert.deepStrictEqual(counts, [['v1', 7]]);
  assert.strictEqual(summary.metadata, 2);
  assert.throws(() => importParsedJson({ metadata: { v1: { id: 'v1' } } }, { insertKv: () => {}, insertSingle: () => {} }), /no insertItem handle/);
  assert.doesNotThrow(() => importParsedJson({ metadata: {} }, { insertKv: () => {}, insertSingle: () => {} }), 'an empty index needs no handle');
  assert.throws(() => importParsedJson({ metadata: ['x'] }, h), /'metadata' is not an object/);
  assert.throws(() => importParsedJson({ metadata: { [`n${NUL}`]: {} } }, h), /U\+0000/);

  adapter.save({ metadata: { old: it('old') } });
  adapter.exclusiveReplace((handles) => { handles.insertItem('r1', it('r1')); });
  assert.deepStrictEqual(Object.keys(adapter.load().metadata), ['r1'], 'restore = the bundle and nothing else');
  assert.deepStrictEqual(adapter.save({ metadata: { r1: it('r1') } }), { rowsWritten: 0, rowsDeleted: 0 }, 'the diff base is the restored state');
  assert.throws(() => adapter.exclusiveReplace((handles) => { handles.insertItem('r2', it('r2')); handles.insertItem('', it('')); }), /non-empty string/);
  assert.deepStrictEqual(Object.keys(adapter.load().metadata), ['r1'], 'rolled back whole');
  assert.deepStrictEqual(readPersistedDatabase(dir).metadata, { r1: it('r1') });
  adapter.exclusiveReplace(() => {});
  assert.deepStrictEqual(readPersistedDatabase(dir), {}, 'empty = absent');
});

test('the stranded-import fingerprint counts media_items: a database holding only items beside a db.json is "in use", not "stranded"', () => {
  adapter.save({ metadata: { a: it('a') } });
  adapter.close();
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ metadata: { a: it('a') } }), 'utf8');
  const lines = [];
  const opened = openAdapter(dir, { log: (m) => lines.push(m) });
  opened.adapter.close();
  assert.ok(lines.some((l) => l.includes('ignored')), 'the in-use line');
  assert.ok(!lines.some((l) => l.includes('stranded')), 'never the stranded warning for a populated index');
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
});

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

test('source lock: server.js never names media_items; lib/media/items.js is the table\'s only runtime writer; the adapter routes the doc object\'s metadata through the store', () => {
  const server = stripComments(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'));
  assert.ok(!server.includes('media_items'), 'server.js never names the table');
  const files = execFileSync('git', ['ls-files', 'lib', 'server.js', 'scripts'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.js'));
  const writers = files.filter((f) => f !== 'lib/media/items.js' && /(INSERT INTO|UPDATE) (media_items|\$\{itemsDef\.TABLE\})|DELETE FROM media_items/.test(stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8')))); // (the template spelling `${itemsDef.TABLE}` counts too - gate S3; the adapter's DELETE wipe through the exported name is the one allowed seam)
  assert.deepStrictEqual(writers, [], 'no file outside the store spells a raw write of the table (the adapter\'s wipe goes through the store\'s exported TABLE name)');
  const sqlite = stripComments(fs.readFileSync(path.join(ROOT, 'lib', 'db', 'sqlite.js'), 'utf8'));
  assert.ok(/this\.items\.planDiff\(getPath\(db, 'metadata'\)\)/.test(sqlite) && /this\.items\.applyPlan\(itemsPlan\)/.test(sqlite) && /this\.items\.advancePlan\(itemsPlan\)/.test(sqlite), 'save() runs the store\'s diff inside its transaction and advances the base after the commit');
  assert.ok(/const items = this\.items\.getAll\(\);/.test(sqlite), 'load() assembles the object from the table');
  assert.ok(!/insertKv\('metadata'/.test(sqlite), 'no doc-row write of the index is left');
});
