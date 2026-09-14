'use strict';

// [UNIT] Wave 5 of the relational-migration arc (2026-09-14), third feature -
// the books namespace (`books.folders/items/progress/pins/settings/audio`)
// leaves the document model for books_folders / books_items / books_progress
// / books_pins / books_settings / books_audio behind lib/books/store.js's
// feature store (FEATURE, createBooksStore). `progress` and `pins` are the
// FROZEN pre-auth records the first admin adopts once (pins is an ordered
// record list). Binds the same six axes as the tv / music suites: the v28 ->
// v29 migration (verbatim, doc rows deleted, stamp inside the block, re-run
// idempotent, corrupt row rollback incl. all six CREATE TABLEs), the
// save-lock, the import route, exclusiveReplace, the test read, and the
// server.js source locks.

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
const booksStore = require('../../lib/books/store');

let dir;
let adapter;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-books-feature-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
});
afterEach(() => {
  try { adapter.close(); } catch (_) { /* closed by the test */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const bk = (id, over) => ({ id, title: id, author: 'A', filePath: `/books/${id}.epub`, rootFolder: '/books', format: 'epub', ...over });
const TABLES = ['books_folders', 'books_items', 'books_progress', 'books_pins', 'books_settings', 'books_audio'];
const EMPTY = { folders: [], items: {}, progress: {}, pins: [], settings: {}, audio: {} };

function rewindToV28(rows) {
  adapter.close();
  const raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec(TABLES.map((t) => `DROP TABLE ${t};`).join(' ') + ' PRAGMA user_version = 28');
  ensureLegacyDocTables(raw);
  const kv = raw.prepare('INSERT INTO doc_kv(namespace, key, json) VALUES(?, ?, ?)');
  const single = raw.prepare('INSERT INTO doc_single(name, json) VALUES(?, ?)');
  for (const [kind, a, b, c] of rows) (kind === 'kv' ? kv.run(a, b, c) : single.run(a, b));
  raw.close();
}
const reopen = () => { adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }); return adapter; };

test('migration v29: every part moves verbatim (the frozen progress + pins included, pins in order); doc rows deleted; stamp 29; load() has no books key; save() works', () => {
  assert.ok(SCHEMA_VERSION >= 29);
  assert.ok(FEATURE_DEFS.some((d) => d.name === 'books'));
  const pins = [{ id: 'p2', dir: '/books/b', label: 'B', pinnedAt: 't', order: 1 }, { id: 'p1', dir: '/books/a', label: 'A', pinnedAt: 't', order: 0 }];
  rewindToV28([
    ['single', 'books.folders', JSON.stringify(['/books'])],
    ['single', 'books.settings', JSON.stringify({ engine: 'piper' })],
    ['single', 'books.pins', JSON.stringify(pins)],
    ['kv', 'books.items', 'b1', JSON.stringify(bk('b1', { spine: ['a', 'b'] }))],
    ['kv', 'books.progress', 'b1', JSON.stringify({ locator: { kind: 'epub', cfi: 'x' }, percent: 40, updatedAt: 't' })],
    ['kv', 'books.audio', 'b1', JSON.stringify({ 0: { status: 'ready', key: 'k0' } })],
  ]);
  reopen();
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const books = booksStore.createBooksStore(adapter);
  assert.deepStrictEqual(books.read(), { folders: ['/books'], items: { b1: bk('b1', { spine: ['a', 'b'] }) }, progress: { b1: { locator: { kind: 'epub', cfi: 'x' }, percent: 40, updatedAt: 't' } }, pins, settings: { engine: 'piper' }, audio: { b1: { 0: { status: 'ready', key: 'k0' } } } });
  assert.strictEqual(countLegacyDocTables(adapter.sql), 0, 'the doc tables are gone (v33 - which refuses to drop a table that still holds a row, so every drain before it deleted its rows)');
  const db = adapter.load();
  assert.strictEqual(db.books, undefined, 'no doc-model books key');
  assert.doesNotThrow(() => adapter.save(db));
  assert.deepStrictEqual(booksStore.readBooks(books.holder()), books.read(), 'the module\'s read view over the holder is the same snapshot');
});

test('migration v29: re-run is a no-op; a corrupt item row rolls the whole block back to a re-runnable v28 (all six CREATE TABLEs included)', () => {
  rewindToV28([]);
  reopen();
  booksStore.createBooksStore(adapter).replaceAll({ folders: ['/kept'] });
  adapter.close();
  let raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('PRAGMA user_version = 28');
  ensureLegacyDocTables(raw);
  raw.close();
  reopen();
  assert.deepStrictEqual(booksStore.createBooksStore(adapter).read().folders, ['/kept'], 'a re-run neither wipes nor duplicates');
  rewindToV28([['single', 'books.folders', JSON.stringify(['/good'])], ['kv', 'books.items', 'bad', '{not json']]);
  assert.throws(() => new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }), /JSON|Unexpected/);
  raw = openRaw(path.join(dir, SQLITE_FILENAME));
  assert.strictEqual(raw.prepare('PRAGMA user_version').get().user_version, 28, 'the stamp is the last committed floor');
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM doc_kv WHERE namespace = 'books.items'").get().c, 1, 'doc rows untouched');
  assert.strictEqual(raw.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE name IN (${TABLES.map((t) => `'${t}'`).join(',')})`).get().c, 0, 'every table creation rolled back');
  raw.prepare("UPDATE doc_kv SET json = ? WHERE key = 'bad'").run(JSON.stringify(bk('bad')));
  raw.close();
  reopen();
  assert.deepStrictEqual(Object.keys(booksStore.createBooksStore(adapter).read().items), ['bad'], 'repaired and re-run');
});

test('save-lock: a stray `books` container on the doc object is REFUSED (the container left the lock)', () => {
  assert.throws(() => adapter.save({ metadata: {}, books: { folders: [] } }), /unknown top-level db key 'books'/);
});

test('importParsedJson: `books` routes whole through replaceFeature (never doc rows); refused without the handle / on an unknown part / a bad shape', () => {
  const features = [];
  const h = { insertViewCount: () => {}, insertProgress: () => {}, insertTombstone: () => {}, insertTrash: () => {}, insertSetting: () => {}, replaceFolders: () => {}, insertFolderSetting: () => {}, insertFolderDisplayName: () => {}, replaceLiked: () => {}, replaceFeature: (name, ns) => features.push([name, ns]) };
  const ns = { folders: ['/books'], items: { b1: bk('b1') }, progress: {}, pins: [{ id: 'p1', dir: '/books', label: 'L', pinnedAt: 't', order: 0 }], settings: {}, audio: {} };
  const summary = importParsedJson({ metadata: {}, books: ns }, h, { source: 'bundle' });
  assert.deepStrictEqual(features, [['books', ns]]);
  assert.strictEqual(summary['books.items'], 1);
  assert.strictEqual(summary['books.pins'], 1);
  const noHandle = { ...h };
  delete noHandle.replaceFeature;
  assert.throws(() => importParsedJson({ books: ns }, noHandle), /no replaceFeature handle/);
  assert.throws(() => importParsedJson({ books: ['x'] }, h), /'books' is not an object/);
  assert.throws(() => importParsedJson({ books: { playlists: {} } }, h), /unknown key 'books\.playlists'/);
});

test('exclusiveReplace: wipes all six tables, repopulates through replaceFeature inside its transaction, rolls back whole on a bad row', () => {
  const books = booksStore.createBooksStore(adapter);
  books.replaceAll({ folders: ['/old'], items: { old: bk('old') }, pins: [{ id: 'op' }], settings: { s: 1 }, audio: { old: { 0: {} } }, progress: { old: { percent: 1 } } });
  adapter.exclusiveReplace(() => {});
  assert.deepStrictEqual(books.read(), EMPTY, 'restore = the bundle and nothing else');
  adapter.exclusiveReplace((h) => { h.replaceFeature('books', { folders: ['/b', '/a'], items: { b1: bk('b1') }, pins: [{ id: 'p1' }] }); });
  assert.deepStrictEqual(books.read(), { ...EMPTY, folders: ['/b', '/a'], items: { b1: bk('b1') }, pins: [{ id: 'p1' }] });
  assert.throws(() => adapter.exclusiveReplace((h) => { h.replaceFeature('books', { folders: ['/c'], pins: [{ noId: true }] }); }), /non-empty string id/);
  assert.deepStrictEqual(books.read().folders, ['/b', '/a'], 'rolled back whole');
});

test('readPersistedDatabase: surfaces `books` in its container shape only when some part has rows', () => {
  assert.deepStrictEqual(readPersistedDatabase(dir), {});
  const books = booksStore.createBooksStore(adapter);
  books.replaceAll({ audio: { b1: { 0: { status: 'ready' } } } });
  assert.deepStrictEqual(readPersistedDatabase(dir), { books: { ...EMPTY, audio: { b1: { 0: { status: 'ready' } } } } });
  books.replaceAll(null);
  assert.deepStrictEqual(readPersistedDatabase(dir), {});
});

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

test('source lock: server.js never names the books tables or the dead doc spellings in CODE; every writer runs through booksDb.mutate (directly or through the store module\'s deps); the reads take booksDb.read()', () => {
  const server = stripComments(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'));
  for (const t of TABLES) assert.ok(!server.includes(t), t);
  assert.ok(!/\b(db|freshDb|fresh|current|state|next|prev|cached\w*|mdb|loaded|persisted|snapshot|handoffDb|srcMeta|getCachedDatabase\(\)|loadDatabase\(\))\.books\b/.test(server), 'no doc-model books access survives');
  assert.ok(!/booksStore\.readBooks\(/.test(server), 'every read view moved to booksDb.read()');
  assert.ok(!/booksStore\.ensureBooks\((loadDatabase\(\)|fresh|freshDb)\)/.test(server), 'no ensureBooks over the doc object');
  assert.strictEqual((server.match(/booksDb\.mutate\(/g) || []).length, 5, 'the scan merge, the config POST, the cover POST, the TTS boot reconcile and the clear-cache drop - the five in-file writers');
  assert.strictEqual((server.match(/\{ updateDatabase, booksDb \}/g) || []).length, 2, 'the TTS status writers in lib/books/store.js get the store through deps');
  assert.ok((server.match(/booksDb\.read\(\)/g) || []).length + (server.match(/booksDb\.parts\.(items|audio)\.get\(/g) || []).length >= 30, 'the reads (snapshots + the single-lookup point queries of gate pass B)');
  assert.ok((server.match(/booksDb\.parts\.(items|audio)\.get\(/g) || []).length >= 6, 'gate pass B: the six single-book lookups are point queries, never a six-table read');
  assert.ok(/bundle\.books = booksDb\.read\(\)/.test(server), 'the bundle reads the tables');
  const lib = stripComments(fs.readFileSync(path.join(ROOT, 'lib', 'books', 'store.js'), 'utf8'));
  assert.strictEqual((lib.match(/deps\.booksDb\.mutate\(/g) || []).length, 5, 'the module\'s five deps-mutators write through the store');
  assert.ok(!/deps\.loadDatabase\(\)/.test(lib), 'no doc read left in the module');
});
