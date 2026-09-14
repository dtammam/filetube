'use strict';

// [UNIT] Wave 3 of the relational-migration arc (2026-09-13) - `trash` (the
// trashed-item records, the only way back for a trashed file) leaves the
// document model for the `media_trash` table (lib/media/trashRecords.js on the
// shared jsonRowStore shape). Binds, in order:
//   1. the store: verbatim records, the typed `trashed_at` column derived per
//      row, and `expiredBefore()` - the retention sweep's query: STRICTLY older
//      than the cutoff, a record without a numeric trashedAt is NEVER returned
//      (the v1.65 "never auto-sweep a malformed record" rule), ordered oldest
//      first with a media_id tie-break;
//   2. the v22 -> v23 MIGRATION: doc rows verbatim, trashed_at derived, doc
//      rows deleted, stamp 23, load() has no `trash` key, save() works, re-run
//      idempotent, a corrupt row rolls the whole block back to a re-runnable v22;
//   3. the save-lock refuses the dead key;
//   4. the bulk seams: importParsedJson routes `trash` through insertTrash (and
//      refuses without it); exclusiveReplace wipes + repopulates inside its
//      transaction and rolls back whole on a bad row;
//   5. readPersistedDatabase surfaces the table as `trash` when rows exist;
//   6. source locks: server.js never names the table or the dead doc key in
//      CODE; the INSERT text stays in the shared store definition.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const {
  SQLITE_FILENAME, SqliteAdapter, SCHEMA_VERSION, DOC_KV_NAMESPACES, readPersistedDatabase, importParsedJson,
  __openRawForTests: openRaw,
} = require('../../lib/db/sqlite');
const createTrashStore = require('../../lib/media/trashRecords');

let dir;
let adapter;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-trash-store-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
});
afterEach(() => {
  try { adapter.close(); } catch (_) { /* closed by the test */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const rows = () => adapter.sql.prepare('SELECT media_id, trashed_at FROM media_trash ORDER BY media_id').all().map((r) => [r.media_id, r.trashed_at]);
const rec = (over) => ({ originalId: 'o', originalPath: '/lib/a.mp4', trashPath: '/lib/.filetube-trash/1-o-a.mp4', trashedAt: 1000, rootFolder: '/lib', item: { id: 'o', title: 'A' }, ...over });

// ---- 1. the store ----------------------------------------------------------------

test('trash store: records round-trip verbatim; trashed_at is derived per row (NULL when not a finite number)', () => {
  const t = createTrashStore(adapter);
  t.set('a', rec({ trashedAt: 5 }));
  t.set('b', rec({ trashedAt: 'yesterday' }));
  t.set('c', { originalPath: '/only' }); // the deferred-retry's minimal shape survives too
  assert.deepStrictEqual(t.get('a'), rec({ trashedAt: 5 }));
  assert.deepStrictEqual(t.get('c'), { originalPath: '/only' });
  assert.deepStrictEqual(rows(), [['a', 5], ['b', null], ['c', null]]);
  assert.strictEqual(t.size(), 3);
  assert.strictEqual(t.has('a'), true);
  assert.strictEqual(t.get('nope'), undefined);
});

test('trash store: expiredBefore(cutoff) is STRICT, skips NULL trashed_at, and orders oldest-first with a media_id tie-break', () => {
  const t = createTrashStore(adapter);
  t.set('boundary', rec({ trashedAt: 1000 }));
  t.set('older', rec({ trashedAt: 999 }));
  t.set('older2', rec({ trashedAt: 999 }));
  t.set('newer', rec({ trashedAt: 1001 }));
  t.set('malformed', rec({ trashedAt: undefined }));
  t.set('stringy', rec({ trashedAt: '1' }));
  assert.deepStrictEqual(Object.keys(t.expiredBefore(1000)), ['older', 'older2'], 'strictly older than the cutoff, ties by media_id');
  assert.deepStrictEqual(Object.keys(t.expiredBefore(1001)), ['older', 'older2', 'boundary']);
  assert.deepStrictEqual(Object.keys(t.expiredBefore(Number.MAX_SAFE_INTEGER)), ['older', 'older2', 'boundary', 'newer'], 'a malformed record is NEVER auto-swept');
  assert.deepStrictEqual(t.expiredBefore(1000).older, rec({ trashedAt: 999 }), 'the full record comes back (the sweep needs restorability checks on it)');
  assert.strictEqual(Object.getPrototypeOf(t.expiredBefore(1000)), Object.prototype);
});

// ---- 2. the migration ------------------------------------------------------------

function rewindToV22(seedRows) {
  adapter.close();
  const raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('DROP TABLE media_trash; PRAGMA user_version = 22');
  const ins = raw.prepare('INSERT INTO doc_kv(namespace, key, json) VALUES(?, ?, ?)');
  for (const [key, json] of seedRows) ins.run('trash', key, json);
  raw.close();
}

test('migration v23: doc rows move VERBATIM (trashed_at derived), doc rows deleted, stamp 23, load() has no trash key, save() works', () => {
  assert.ok(SCHEMA_VERSION >= 23);
  assert.ok(!DOC_KV_NAMESPACES.includes('trash'));
  rewindToV22([
    ['t1', JSON.stringify(rec({ trashedAt: 7 }))],
    ['t2', JSON.stringify({ originalPath: '/minimal' })],
    ['t3', JSON.stringify(rec({ trashedAt: 'bad', item: { id: 'x', chaptersManual: [{ t: 0, title: 'Intro' }] } }))],
  ]);
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const t = createTrashStore(adapter);
  assert.deepStrictEqual(t.get('t1'), rec({ trashedAt: 7 }));
  assert.deepStrictEqual(t.get('t2'), { originalPath: '/minimal' });
  assert.deepStrictEqual(t.get('t3').item.chaptersManual, [{ t: 0, title: 'Intro' }], 'the snapshot survives verbatim');
  assert.deepStrictEqual(rows(), [['t1', 7], ['t2', null], ['t3', null]]);
  assert.strictEqual(adapter.sql.prepare("SELECT COUNT(*) AS c FROM doc_kv WHERE namespace = 'trash'").get().c, 0);
  const db = adapter.load();
  assert.strictEqual(db.trash, undefined);
  assert.doesNotThrow(() => adapter.save(db));
});

test('migration v23: re-running is a no-op; a corrupt doc row rolls the whole block back to a re-runnable v22 (CREATE TABLE included)', () => {
  createTrashStore(adapter).set('kept', rec());
  adapter.close();
  let raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('PRAGMA user_version = 22');
  raw.close();
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  assert.deepStrictEqual(createTrashStore(adapter).get('kept'), rec());
  rewindToV22([['good', JSON.stringify(rec())], ['bad', '{not json']]);
  assert.throws(() => new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }), /JSON|Unexpected/);
  raw = openRaw(path.join(dir, SQLITE_FILENAME));
  assert.strictEqual(raw.prepare('PRAGMA user_version').get().user_version, 22);
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM doc_kv WHERE namespace = 'trash'").get().c, 2, 'doc rows untouched');
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 'media_trash'").get().c, 0, 'the table creation rolled back too');
  raw.prepare("UPDATE doc_kv SET json = ? WHERE key = 'bad'").run(JSON.stringify(rec({ trashedAt: 2 })));
  raw.close();
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  assert.deepStrictEqual(Object.keys(createTrashStore(adapter).getAll()).sort(), ['bad', 'good']);
});

test('migration v23: a doc row whose key fails the id rule (empty / NUL - a <=v1.292 restore accepted it) is SKIPPED and logged, never moved (it would be an unpurgeable row that aborts the sweep)', () => {
  rewindToV22([['', JSON.stringify(rec({ trashedAt: 1 }))], ['ok', JSON.stringify(rec({ trashedAt: 2 }))]]);
  const raw = openRaw(path.join(dir, SQLITE_FILENAME));
  // node:sqlite TRUNCATES a TEXT bind at NUL (a NUL key cannot even reach
  // doc_kv that way), so the non-string arm is planted as a BLOB key - the
  // shape a hand-edited file could carry.
  raw.prepare('INSERT INTO doc_kv(namespace, key, json) VALUES(?, ?, ?)').run('trash', Buffer.from('blob-key'), JSON.stringify(rec({ trashedAt: 3 })));
  raw.close();
  const logged = [];
  const origError = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  } finally { console.error = origError; }
  assert.strictEqual(logged.filter((l) => l.includes('migration v23: skipping')).length, 2, 'both unaddressable rows were logged: ' + logged.join(' | '));
  const t = createTrashStore(adapter);
  assert.deepStrictEqual(Object.keys(t.getAll()), ['ok'], 'only the addressable record moved');
  assert.strictEqual(adapter.sql.prepare("SELECT COUNT(*) AS c FROM doc_kv WHERE namespace = 'trash'").get().c, 0, 'the doc rows are gone either way');
  assert.deepStrictEqual(Object.keys(t.expiredBefore(Number.MAX_SAFE_INTEGER)), ['ok'], 'the sweep can never see an unaddressable row');
  // Reads of such ids are tolerant, never a throw (the routes hand them request ids).
  assert.strictEqual(t.get(''), undefined);
  assert.strictEqual(t.has('a\u0000b'), false);
});

// ---- 3. the save-lock -------------------------------------------------------------

test('save-lock: `trash` on the doc object is REFUSED', () => {
  assert.throws(() => adapter.save({ folders: [], trash: {} }), /unknown top-level db key 'trash'/);
  assert.throws(() => adapter.save({ folders: [], trash: { t: rec() } }), /unknown top-level db key 'trash'/);
});

// ---- 4. the bulk seams ---------------------------------------------------------------

test('importParsedJson: routes `trash` verbatim through insertTrash (never doc_kv); refuses without the handle / on a bad shape', () => {
  const kv = [];
  const trash = [];
  const h = { insertKv: (ns, k, v) => kv.push([ns, k, v]), insertSingle: () => {}, insertViewCount: () => {}, insertProgress: () => {}, insertTombstone: () => {}, insertTrash: (id, r) => trash.push([id, r]) };
  const summary = importParsedJson({ folders: [], trash: { t1: rec(), t2: { originalPath: '/m' } } }, h, { source: 'bundle' });
  assert.deepStrictEqual(trash, [['t1', rec()], ['t2', { originalPath: '/m' }]]);
  assert.strictEqual(summary.trash, 2);
  assert.ok(!kv.some(([ns]) => ns === 'trash'));
  const noHandle = { ...h };
  delete noHandle.insertTrash;
  assert.throws(() => importParsedJson({ trash: { t: rec() } }, noHandle), /no insertTrash handle/);
  assert.throws(() => importParsedJson({ trash: ['x'] }, h), /'trash' is not an object/);
  assert.throws(() => importParsedJson({ trash: { 'a\u0000b': rec() } }, h), /U\+0000/);
  assert.doesNotThrow(() => importParsedJson({ trash: {} }, noHandle), 'an empty map needs no handle');
});

test('exclusiveReplace: wipes the table, repopulates through insertTrash inside its transaction, rolls back whole on a bad row', () => {
  const t = createTrashStore(adapter);
  t.set('old', rec());
  adapter.exclusiveReplace(() => {});
  assert.strictEqual(t.size(), 0, 'restore = the bundle and nothing else');
  adapter.exclusiveReplace((h) => { h.insertTrash('a', rec({ trashedAt: 3 })); });
  assert.deepStrictEqual(rows(), [['a', 3]], 'the typed column is derived on this seam too');
  assert.throws(() => adapter.exclusiveReplace((h) => { h.insertTrash('b', rec()); h.insertTrash('c\u0000', rec()); }), /U\+0000/);
  assert.deepStrictEqual(Object.keys(t.getAll()), ['a'], 'rolled back whole');
  assert.throws(() => adapter.exclusiveReplace((h) => h.insertTrash('d', undefined)), /undefined/);
});

// ---- 5. the test read ------------------------------------------------------------------

test('readPersistedDatabase: surfaces the table as `trash` only when rows exist', () => {
  assert.deepStrictEqual(readPersistedDatabase(dir), {});
  const t = createTrashStore(adapter);
  t.set('a', rec());
  assert.deepStrictEqual(readPersistedDatabase(dir), { trash: { a: rec() } });
  t.remove('a');
  assert.deepStrictEqual(readPersistedDatabase(dir), {});
});

// ---- 6. source locks -----------------------------------------------------------------------

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

test('source lock: server.js never names media_trash or the dead doc key in CODE and calls the store at every seam; the INSERT text stays in the shared definition', () => {
  const server = stripComments(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'));
  assert.ok(!/media_trash/.test(server));
  assert.ok(!/\b(db|freshDb|fresh|current|state)\.trash\b/.test(server), 'no doc-model trash access survives');
  assert.ok(!/getCachedDatabase\(\)\.trash\b/.test(server), 'nor through the read cache (the route lookup the first cut missed)');
  for (const call of ['trashStore.getAll(', 'trashStore.get(', 'trashStore.has(', 'trashStore.set(', 'trashStore.remove(', 'trashStore.expiredBefore(']) {
    assert.ok(server.includes(call), `server.js calls ${call}`);
  }
  const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '*.js'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean)
    .filter((p) => !p.startsWith('test/') && !/(^|\/)(vendor|node_modules)\//.test(p));
  const writers = tracked.filter((p) => /(INSERT\s+INTO|UPDATE(\s+OR\s+REPLACE)?)\s+(media_trash|\$\{table\}|\$\{def\.table\})/.test(stripComments(fs.readFileSync(path.join(ROOT, p), 'utf8'))));
  // Wave 4: the two sibling primitives (kv / ordered-list) interpolate their
  // own `${table}` - shared definitions, not drifting copies of THIS table's text.
  assert.deepStrictEqual(writers, ['lib/db/kvStore.js', 'lib/db/orderedListStore.js', 'lib/media/jsonRowStore.js']);
  const deleters = tracked.filter((p) => /DELETE\s+FROM\s+(media_trash|\$\{trashDef\.TABLE\})/.test(stripComments(fs.readFileSync(path.join(ROOT, p), 'utf8'))));
  assert.deepStrictEqual(deleters, ['lib/db/sqlite.js'], 'only the adapter\'s wipe-and-replace DELETEs by name; the store deletes through the shared definition');
});
