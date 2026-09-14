'use strict';

// [UNIT] Wave 2 of the relational-migration arc (2026-09-13) - `progress` (the
// frozen pre-auth positions) and `deleteTombstones` leave the document model
// for two id-keyed JSON-RECORD tables on the shared lib/media/jsonRowStore.js
// shape. Binds, in order:
//   1. the shared store API (get/has/getAll/size/set/remove/rekey/replaceAll,
//      verbatim records of any shape, NUL/empty-id refusal, __proto__ inert,
//      joining an already-open adapter transaction);
//   2. the tombstone store's typed `deleted_at` column + the growth-bound
//      prune (the v1.41.3 policy, now applied to rows; the pure in-place form
//      is still exported for its own unit test);
//   3. the v21 -> v22 MIGRATION: doc rows copied VERBATIM (legacy shapes
//      survive), deleted_at derived, doc rows deleted, stamp 22, load() has no
//      keys, first save() works, re-run idempotent, a corrupt row rolls the
//      whole block back to a re-runnable v21;
//   4. the save-lock refuses both dead keys;
//   5. the bulk seams: importParsedJson routes both (and refuses without a
//      handle / on a bad shape); exclusiveReplace wipes + repopulates both
//      inside its transaction and rolls back whole on a bad row;
//   6. readPersistedDatabase surfaces both when rows exist;
//   7. the adapter's `save(db, { alsoInTransaction })` hook: the callback
//      runs INSIDE the doc transaction (a throw rolls back the doc rows too;
//      a callback with no doc change still commits);
//   8. source locks: server.js never names the tables; the only INSERT text
//      for them lives in the shared store definition.

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
const createProgressStore = require('../../lib/media/progress');
const createTombstoneStore = require('../../lib/media/deleteTombstones');
const { DELETE_TOMBSTONE_CAP, DELETE_TOMBSTONE_MAX_AGE_MS, selectPrunedTombstoneIds, pruneDeleteTombstones } = createTombstoneStore;

let dir;
let adapter;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-record-stores-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
});
afterEach(() => {
  try { adapter.close(); } catch (_) { /* closed by the test */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const plain = (rows) => rows.map((r) => ({ ...r }));
const tombRows = () => plain(adapter.sql.prepare('SELECT media_id, deleted_at, json FROM media_delete_tombstones ORDER BY media_id').all());

// ---- 1. the shared store API --------------------------------------------------

test('record store: records of ANY shape round-trip verbatim; absent reads as undefined; has/size/getAll agree', () => {
  const p = createProgressStore(adapter);
  p.set('obj', { timestamp: 5, duration: 10, updatedAt: 'x' });
  p.set('legacy', { position: 42 });
  p.set('bare', 918);          // the oldest fixtures stored a bare number
  p.set('str', 'weird');
  p.set('nul', null);
  assert.deepStrictEqual(p.get('obj'), { timestamp: 5, duration: 10, updatedAt: 'x' });
  assert.deepStrictEqual(p.get('legacy'), { position: 42 });
  assert.strictEqual(p.get('bare'), 918);
  assert.strictEqual(p.get('str'), 'weird');
  assert.strictEqual(p.get('nul'), null);
  assert.strictEqual(p.get('missing'), undefined);
  assert.strictEqual(p.has('obj'), true);
  assert.strictEqual(p.has('missing'), false);
  assert.strictEqual(p.size(), 5);
  assert.deepStrictEqual(Object.keys(p.getAll()).sort(), ['bare', 'legacy', 'nul', 'obj', 'str']);
  p.set('obj', { timestamp: 6 }); // upsert replaces
  assert.deepStrictEqual(p.get('obj'), { timestamp: 6 });
});

test('record store: remove (one or many), rekey (OR REPLACE on collision, same-id no-op), replaceAll refuse-whole', () => {
  const p = createProgressStore(adapter);
  p.set('a', 1); p.set('b', 2); p.set('c', 3);
  p.remove('a');
  p.remove(['b', 'ghost']);
  p.remove([]);
  assert.deepStrictEqual(p.getAll(), { c: 3 });
  p.rekey('c', 'd');
  assert.deepStrictEqual(p.getAll(), { d: 3 });
  p.set('taken', 9);
  p.rekey('d', 'taken');
  assert.deepStrictEqual(p.getAll(), { taken: 3 }, 'the moving row wins the collision');
  p.rekey('taken', 'taken');
  assert.deepStrictEqual(p.getAll(), { taken: 3 });
  assert.throws(() => p.replaceAll({ ok: 1, bad: undefined }), /cannot be undefined/);
  assert.throws(() => p.replaceAll(['x']), /expects an object map/);
  assert.deepStrictEqual(p.getAll(), { taken: 3 }, 'refused maps changed nothing');
  p.replaceAll({ x: { y: 1 } });
  assert.deepStrictEqual(p.getAll(), { x: { y: 1 } });
  p.replaceAll(null);
  assert.deepStrictEqual(p.getAll(), {});
});

test('record store: ids - empty / non-string / NUL-bearing refused at every write; __proto__ is inert own-property data', () => {
  const p = createProgressStore(adapter);
  for (const call of [
    () => p.set('', 1), () => p.set(7, 1), () => p.set('a\u0000b', 1), () => p.remove('a\u0000b'),
    () => p.rekey('x', 'a\u0000b'), () => p.replaceAll({ 'a\u0000b': 1 }),
  ]) assert.throws(call, /U\+0000|non-empty string/);
  assert.throws(() => p.set('a', undefined), /cannot be undefined/);
  assert.throws(() => p.set('a', () => 1), /JSON-serialisable/);
  p.replaceAll(JSON.parse('{"__proto__": {"polluted": 1}, "x": 1}'));
  const all = p.getAll();
  assert.ok(Object.prototype.hasOwnProperty.call(all, '__proto__'));
  assert.strictEqual(Object.getPrototypeOf(all), Object.prototype, 'prototype not reassigned');
  assert.strictEqual(({}).polluted, undefined, 'no pollution leaked');
});

test('record store: READS are tolerant - an id that could never have been persisted reads as absent (undefined / false), never throws; WRITES still refuse it (Wave 3 gate CRITICAL)', () => {
  const p = createProgressStore(adapter);
  const t = createTombstoneStore(adapter);
  p.set('real', 1);
  for (const bad of ['', 'a\u0000b', String.fromCharCode(0), 42, null, undefined, {}]) {
    assert.strictEqual(p.get(bad), undefined, `get(${JSON.stringify(bad)}) reads as absent`);
    assert.strictEqual(p.has(bad), false, `has(${JSON.stringify(bad)}) is false`);
    assert.strictEqual(t.get(bad), undefined);
    assert.throws(() => p.set(bad, 1), /non-empty string|U\+0000/, `set(${JSON.stringify(bad)}) still refuses`);
  }
  assert.strictEqual(p.get('real'), 1, 'a real id still reads');
  assert.strictEqual(require('../../lib/media/viewCounts')(adapter).get(''), 0, 'the view-count store reads 0 for an unpersistable id');
  const { isPersistableId } = require('../../lib/media/jsonRowStore');
  assert.deepStrictEqual(['ok', '', 'a\u0000b', 7, null].map(isPersistableId), [true, false, false, false, false]);
});

test('record store: a multi-row write inside an ALREADY-OPEN adapter transaction joins it and the outer rollback discards it', () => {
  const p = createProgressStore(adapter);
  p.set('before', 1);
  adapter.begin();
  p.replaceAll({ inside: 5 });
  p.remove('inside');
  p.set('inside2', 6);
  adapter.rollback();
  assert.deepStrictEqual(p.getAll(), { before: 1 });
});

// ---- 2. the tombstone store ------------------------------------------------------

test('tombstones: deleted_at is derived from the record (typed column beside the verbatim json); a record without a numeric deletedAt stores NULL', () => {
  const t = createTombstoneStore(adapter);
  t.set('a', { filePath: '/a', deletedAt: 123, youtubeId: null });
  t.set('b', { filePath: '/b' });
  t.set('c', { filePath: '/c', deletedAt: 'yesterday' });
  assert.deepStrictEqual(tombRows(), [
    { media_id: 'a', deleted_at: 123, json: JSON.stringify({ filePath: '/a', deletedAt: 123, youtubeId: null }) },
    { media_id: 'b', deleted_at: null, json: JSON.stringify({ filePath: '/b' }) },
    { media_id: 'c', deleted_at: null, json: JSON.stringify({ filePath: '/c', deletedAt: 'yesterday' }) },
  ]);
  assert.deepStrictEqual(t.get('a'), { filePath: '/a', deletedAt: 123, youtubeId: null }, 'the record itself is verbatim');
});

test('tombstones: prune() applies the v1.41.3 growth bound to the rows (malformed first, then age, then FIFO cap) and the pure policy agrees', () => {
  const t = createTombstoneStore(adapter);
  const NOW = 1_800_000_000_000;
  t.set('old', { filePath: '/old', deletedAt: NOW - DELETE_TOMBSTONE_MAX_AGE_MS - 1 });
  t.set('malformed', { filePath: '/m' });
  t.set('fresh', { filePath: '/f', deletedAt: NOW - 1000 });
  assert.strictEqual(t.prune(NOW), 2);
  assert.deepStrictEqual(Object.keys(t.getAll()), ['fresh']);
  // cap: CAP + 3 fresh rows -> the 3 OLDEST go
  const many = {};
  for (let i = 0; i < DELETE_TOMBSTONE_CAP + 3; i++) many[`t${String(i).padStart(4, '0')}`] = { filePath: `/${i}`, deletedAt: NOW - 100000 + i };
  t.replaceAll(many);
  assert.strictEqual(t.prune(NOW), 3);
  assert.strictEqual(t.size(), DELETE_TOMBSTONE_CAP);
  assert.strictEqual(t.has('t0000'), false, 'the oldest is gone');
  assert.strictEqual(t.has('t0003'), true);
  // the pure forms agree with each other
  const map = { ...many, old: { filePath: '/old', deletedAt: NOW - DELETE_TOMBSTONE_MAX_AGE_MS - 1 } };
  const victims = selectPrunedTombstoneIds(map, NOW).sort();
  const copy = JSON.parse(JSON.stringify(map));
  pruneDeleteTombstones(copy, NOW);
  assert.deepStrictEqual(Object.keys(map).filter((k) => !(k in copy)).sort(), victims);
  assert.strictEqual(Object.keys(copy).length, DELETE_TOMBSTONE_CAP);
});

// ---- 3. the v21 -> v22 migration --------------------------------------------------

function rewindToV21(seedDocRows) {
  adapter.close();
  const raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('DROP TABLE media_progress; DROP TABLE media_delete_tombstones; PRAGMA user_version = 21');
  const ins = raw.prepare('INSERT INTO doc_kv(namespace, key, json) VALUES(?, ?, ?)');
  for (const [ns, key, json] of seedDocRows) ins.run(ns, key, json);
  raw.close();
}

test('migration v22: doc rows move VERBATIM into the two tables (legacy shapes intact, deleted_at derived), doc rows deleted, stamp 22, load() has no keys, save() works', () => {
  assert.ok(SCHEMA_VERSION >= 22);
  assert.ok(!DOC_KV_NAMESPACES.includes('progress') && !DOC_KV_NAMESPACES.includes('deleteTombstones'));
  rewindToV21([
    ['progress', 'v1', JSON.stringify({ timestamp: 5, duration: 10, updatedAt: 'x' })],
    ['progress', 'v2', JSON.stringify({ position: 42 })],
    ['progress', 'v3', '918'],
    ['deleteTombstones', 't1', JSON.stringify({ filePath: '/x', deletedAt: 123, youtubeId: null, sourceRef: { extractor: 'Vimeo', id: '1', bracketId: '1' } })],
    ['deleteTombstones', 't2', JSON.stringify({ filePath: '/y' })],
    ['deleteTombstones', 't3', JSON.stringify({ item: { id: 't3', title: 'snap' }, deletedAt: 5, filePath: '/z' })],
    ['metadata', 'v1', JSON.stringify({ id: 'v1', title: 'kept' })],
  ]);
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const p = createProgressStore(adapter);
  const t = createTombstoneStore(adapter);
  assert.deepStrictEqual(p.getAll(), { v1: { timestamp: 5, duration: 10, updatedAt: 'x' }, v2: { position: 42 }, v3: 918 });
  assert.deepStrictEqual(t.getAll(), {
    t1: { filePath: '/x', deletedAt: 123, youtubeId: null, sourceRef: { extractor: 'Vimeo', id: '1', bracketId: '1' } },
    t2: { filePath: '/y' },
    t3: { item: { id: 't3', title: 'snap' }, deletedAt: 5, filePath: '/z' },
  });
  assert.deepStrictEqual(tombRows().map((r) => [r.media_id, r.deleted_at]), [['t1', 123], ['t2', null], ['t3', 5]], 'deleted_at derived per row');
  assert.strictEqual(adapter.sql.prepare("SELECT COUNT(*) AS c FROM doc_kv WHERE namespace IN ('progress','deleteTombstones')").get().c, 0);
  const db = adapter.load();
  assert.strictEqual(db.progress, undefined);
  assert.strictEqual(db.deleteTombstones, undefined);
  assert.deepStrictEqual(db.metadata, { v1: { id: 'v1', title: 'kept' } });
  assert.doesNotThrow(() => adapter.save(db));
});

test('migration v22: re-running the block is a no-op (crash between COMMIT and the stamp); a corrupt doc row rolls the whole block back to a re-runnable v21', () => {
  const p = createProgressStore(adapter);
  p.set('kept', { timestamp: 1 });
  adapter.close();
  let raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('PRAGMA user_version = 21');
  raw.close();
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  assert.deepStrictEqual(createProgressStore(adapter).getAll(), { kept: { timestamp: 1 } }, 'rows survive the re-run');
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);

  // corrupt json in a doc row -> the block throws, nothing moves, v21 stays
  rewindToV21([['progress', 'good', '1'], ['deleteTombstones', 'bad', '{not json']]);
  assert.throws(() => new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }), /JSON|Unexpected/);
  raw = openRaw(path.join(dir, SQLITE_FILENAME));
  assert.strictEqual(raw.prepare('PRAGMA user_version').get().user_version, 21, 'stamp untouched');
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM doc_kv WHERE namespace IN ('progress','deleteTombstones')").get().c, 2, 'doc rows untouched');
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 'media_progress'").get().c, 0, 'the table creation rolled back too');
  raw.prepare("UPDATE doc_kv SET json = ? WHERE key = 'bad'").run(JSON.stringify({ filePath: '/fixed', deletedAt: 1 }));
  raw.close();
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  assert.deepStrictEqual(createTombstoneStore(adapter).getAll(), { bad: { filePath: '/fixed', deletedAt: 1 } }, 'fixed row -> the re-run completes');
});

// ---- 4. the save-lock ---------------------------------------------------------

test('save-lock: `progress` and `deleteTombstones` on the doc object are REFUSED', () => {
  assert.throws(() => adapter.save({ metadata: {}, progress: {} }), /unknown top-level db key 'progress'/);
  assert.throws(() => adapter.save({ metadata: {}, deleteTombstones: { a: {} } }), /unknown top-level db key 'deleteTombstones'/);
});

// ---- 5. the bulk seams ---------------------------------------------------------

function handles(with_ = ['insertProgress', 'insertTombstone']) {
  const seen = { kv: [], progress: [], tombstones: [] };
  const h = { insertKv: (ns, key, value) => seen.kv.push([ns, key, value]), insertSingle: () => {}, insertViewCount: () => {}, insertItem: () => {} }; // (insertItem: Wave 6 - the media index)
  if (with_.includes('insertProgress')) h.insertProgress = (id, rec) => seen.progress.push([id, rec]);
  if (with_.includes('insertTombstone')) h.insertTombstone = (id, rec) => seen.tombstones.push([id, rec]);
  return { h, seen };
}

test('importParsedJson: routes both record namespaces verbatim through their handles, counts them, and never writes them to doc_kv', () => {
  const { h, seen } = handles();
  const summary = importParsedJson({
    progress: { v1: { timestamp: 1 }, v2: 918 },
    deleteTombstones: { t1: { filePath: '/x', deletedAt: 1 } },
    metadata: { v1: { id: 'v1' } },
  }, h, { source: 'bundle' });
  assert.deepStrictEqual(seen.progress, [['v1', { timestamp: 1 }], ['v2', 918]]);
  assert.deepStrictEqual(seen.tombstones, [['t1', { filePath: '/x', deletedAt: 1 }]]);
  assert.strictEqual(summary.progress, 2);
  assert.strictEqual(summary.deleteTombstones, 1);
  assert.ok(!seen.kv.some(([ns]) => ns === 'progress' || ns === 'deleteTombstones'));
});

test('importParsedJson: refuses loudly - no handle for a carried namespace, a non-object map, a NUL id, an undefined record; an EMPTY map needs no handle', () => {
  assert.throws(() => importParsedJson({ progress: { a: 1 } }, handles(['insertTombstone']).h), /no insertProgress handle/);
  assert.throws(() => importParsedJson({ deleteTombstones: { a: {} } }, handles(['insertProgress']).h), /no insertTombstone handle/);
  assert.throws(() => importParsedJson({ progress: ['x'] }, handles().h), /'progress' is not an object/);
  assert.throws(() => importParsedJson({ deleteTombstones: 'x' }, handles().h), /'deleteTombstones' is not an object/);
  assert.throws(() => importParsedJson({ progress: { 'a\u0000b': 1 } }, handles().h), /U\+0000/);
  assert.throws(() => importParsedJson({ progress: { a: undefined } }, handles().h), /undefined record/);
  assert.doesNotThrow(() => importParsedJson({ progress: {}, deleteTombstones: {} }, handles([]).h));
});

test('exclusiveReplace: wipes both tables, repopulates through the handles inside its transaction, rolls back whole on a bad row', () => {
  const p = createProgressStore(adapter);
  const t = createTombstoneStore(adapter);
  p.set('old', 1); t.set('old', { filePath: '/o', deletedAt: 1 });
  adapter.exclusiveReplace(() => {});
  assert.strictEqual(p.size() + t.size(), 0, 'a populate that writes nothing leaves EMPTY tables');
  adapter.exclusiveReplace((h) => { h.insertProgress('a', { timestamp: 2 }); h.insertTombstone('b', { filePath: '/b', deletedAt: 3 }); });
  assert.deepStrictEqual(p.getAll(), { a: { timestamp: 2 } });
  assert.deepStrictEqual(t.getAll(), { b: { filePath: '/b', deletedAt: 3 } });
  assert.deepStrictEqual(tombRows().map((r) => r.deleted_at), [3], 'the typed column is derived on this seam too');
  assert.throws(() => adapter.exclusiveReplace((h) => { h.insertProgress('c', 1); h.insertTombstone('d\u0000', {}); }), /U\+0000/);
  assert.deepStrictEqual(p.getAll(), { a: { timestamp: 2 } }, 'rolled back whole');
  assert.throws(() => adapter.exclusiveReplace((h) => h.insertProgress('e', undefined)), /undefined/);
});

// ---- 6. the test read ------------------------------------------------------------

test('readPersistedDatabase: surfaces both tables under their old keys only when rows exist', () => {
  assert.deepStrictEqual(readPersistedDatabase(dir), {});
  const p = createProgressStore(adapter);
  const t = createTombstoneStore(adapter);
  p.set('a', { timestamp: 1 });
  adapter.save({ metadata: { x: { id: 'x' } } }); // (folders is relational since Wave 4)
  assert.deepStrictEqual(readPersistedDatabase(dir), { metadata: { x: { id: 'x' } }, progress: { a: { timestamp: 1 } } });
  t.set('b', { filePath: '/b', deletedAt: 2 });
  assert.deepStrictEqual(readPersistedDatabase(dir).deleteTombstones, { b: { filePath: '/b', deletedAt: 2 } });
  p.remove('a'); t.remove('b');
  assert.deepStrictEqual(readPersistedDatabase(dir), { metadata: { x: { id: 'x' } } });
});

// ---- 7. the in-transaction save hook ----------------------------------------------

test('save(db, { alsoInTransaction }): the callback runs INSIDE the doc transaction - a throw rolls back doc rows AND relational rows; no doc change still commits the callback', () => {
  const p = createProgressStore(adapter);
  const t = createTombstoneStore(adapter);
  adapter.save({ metadata: { m1: { id: 'm1', v: 'a' } } }); // (the doc field is a metadata row - folders is relational since Wave 4)
  // happy path: doc change + relational writes, one transaction
  adapter.save({ metadata: { m1: { id: 'm1', v: 'b' } } }, { alsoInTransaction: () => { t.set('m1', { filePath: '/m1', deletedAt: 1 }); p.remove('nothing'); } });
  assert.strictEqual(readPersistedDatabase(dir).metadata.m1.v, 'b');
  assert.deepStrictEqual(t.getAll(), { m1: { filePath: '/m1', deletedAt: 1 } });
  // a throw inside the callback: the doc write (v -> c) must NOT land
  assert.throws(() => adapter.save({ metadata: { m1: { id: 'm1', v: 'c' } } }, { alsoInTransaction: () => { p.set('x', 1); throw new Error('boom'); } }), /boom/);
  assert.strictEqual(readPersistedDatabase(dir).metadata.m1.v, 'b', 'doc rows rolled back with the callback');
  assert.strictEqual(p.has('x'), false, 'the relational write rolled back too');
  // the snapshot did not advance: the same doc change now writes its row
  const stats = adapter.save({ metadata: { m1: { id: 'm1', v: 'c' } } });
  assert.deepStrictEqual(stats, { rowsWritten: 1, rowsDeleted: 0 });
  // no doc change at all + a callback: still a real transaction
  const s2 = adapter.save({ metadata: { m1: { id: 'm1', v: 'c' } } }, { alsoInTransaction: () => t.remove('m1') });
  assert.deepStrictEqual(s2, { rowsWritten: 0, rowsDeleted: 0 });
  assert.strictEqual(t.has('m1'), false, 'the callback ran');
  assert.strictEqual(adapter.inTransaction, false, 'nothing left open');
});

// ---- 8. source locks -----------------------------------------------------------------

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

test('source lock: server.js never names the two tables or the dead doc keys in CODE; the INSERT text lives only in the shared store definition', () => {
  const server = stripComments(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'));
  assert.ok(!/media_progress|media_delete_tombstones/.test(server), 'server.js does not name the tables');
  assert.ok(!/\b(db|freshDb|fresh|current)\.(progress|deleteTombstones)\b/.test(server), 'no doc-model access to the dead keys survives in server.js code');
  for (const call of ['progressStore.getAll(', 'progressStore.remove(', 'progressStore.rekey(', 'tombstoneStore.getAll(', 'tombstoneStore.get(', 'tombstoneStore.has(', 'tombstoneStore.set(', 'tombstoneStore.remove(', 'tombstoneStore.prune(', 'inSaveTransaction(']) {
    assert.ok(server.includes(call), `server.js calls ${call}`);
  }
  const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '*.js'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean)
    .filter((p) => !p.startsWith('test/') && !/(^|\/)(vendor|node_modules)\//.test(p));
  // Any spelling of the table in an INSERT/UPDATE (a literal, or an
  // interpolated `${table}` / `${TABLE}` / `${def.table}`): the writers must be
  // the shared definition (INSERT + the OR REPLACE re-key) and the tombstone
  // store's own prune (DELETE on the typed column) - nothing else.
  // (`${TABLE}` is the view-count store's own constant - Wave 1's lock covers it.)
  const writers = tracked.filter((p) => /(INSERT\s+INTO|UPDATE(\s+OR\s+REPLACE)?)\s+(media_progress|media_delete_tombstones|\$\{table\}|\$\{def\.table\})/.test(stripComments(fs.readFileSync(path.join(ROOT, p), 'utf8'))));
  assert.deepStrictEqual(writers, ['lib/db/kvStore.js', 'lib/db/orderedListStore.js', 'lib/db/recordListStore.js', 'lib/media/jsonRowStore.js'], 'one INSERT/UPDATE text per shape, in the shared store definitions (Wave 4 added the kv / ordered-list siblings, Wave 5 the record-list one)');
  const deleters = tracked.filter((p) => /DELETE\s+FROM\s+(media_progress|media_delete_tombstones|\$\{table\}|\$\{def\.table\}|\$\{progressDef\.TABLE\}|\$\{tombstoneDef\.TABLE\})/.test(stripComments(fs.readFileSync(path.join(ROOT, p), 'utf8'))));
  assert.deepStrictEqual(deleters.sort(), ['lib/db/kvStore.js', 'lib/db/orderedListStore.js', 'lib/db/recordListStore.js', 'lib/db/sqlite.js', 'lib/media/deleteTombstones.js', 'lib/media/jsonRowStore.js'], 'DELETEs: the shared store definitions (Waves 4-5 siblings included), the tombstone prune, and the adapter\'s wipe-and-replace - nothing else');
});
