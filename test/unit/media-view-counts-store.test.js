'use strict';

// [UNIT] Wave 1 of the relational-migration arc (2026-09-13) - `viewCounts`
// leaves the document model for the `media_view_counts` table owned by
// lib/media/viewCounts.js. Binds, in order:
//   1. the store API (get/set/increment with legacy floor/remove/rekey with
//      collision/replaceAll refuse-whole/getAll own-property keys/NUL refusal,
//      and transaction nesting inside an already-open adapter transaction);
//   2. the v20 -> v21 MIGRATION: doc_kv `viewCounts` rows are copied into the
//      table with the v1.42 value filter and DELETED from doc_kv, the stamp
//      becomes 21, and load() no longer assembles a `viewCounts` key (which the
//      save-lock would refuse - the boot-breaker this wave had to avoid);
//   3. the save-lock: a doc object carrying `viewCounts` is REFUSED;
//   4. the two bulk seams: importParsedJson routes bundle `viewCounts` and the
//      legacy embedded `item.viewCount` through the insertViewCount handle (and
//      refuses loudly without one); exclusiveReplace wipes the table and
//      repopulates it inside its transaction, rolling back on a bad row;
//   5. readPersistedDatabase surfaces the table as `viewCounts` only when rows
//      exist (the empty-is-absent normalization);
//   6. source locks: server.js never names the table or the doc key in CODE,
//      and the only INSERT text for the table lives in the store module.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
const {
  SQLITE_FILENAME, SqliteAdapter, SCHEMA_VERSION, DOC_KV_NAMESPACES, readPersistedDatabase, importParsedJson,
  // The adapter's sanctioned raw door (the node:sqlite source lock keeps every
  // API touch in lib/db/sqlite.js - tests included).
  __openRawForTests: openRaw,
} = require('../../lib/db/sqlite');
const createViewCountStore = require('../../lib/media/viewCounts');

let dir;
let adapter;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-view-counts-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
});
afterEach(() => {
  try { adapter.close(); } catch (_) { /* closed by the test */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

// node:sqlite rows are null-prototype objects; re-shape for deepStrictEqual.
const rows = () => adapter.sql.prepare('SELECT media_id, count FROM media_view_counts ORDER BY media_id').all()
  .map((r) => ({ media_id: r.media_id, count: r.count }));

// ---- 1. the store API ------------------------------------------------------

test('store: get/set/getAll/size - absent reads as 0, set upserts, getAll is a plain { id: count } map', () => {
  const s = createViewCountStore(adapter);
  assert.strictEqual(s.get('nope'), 0);
  s.set('a', 3);
  s.set('b', 0);
  s.set('a', 4); // upsert, not insert-or-throw
  assert.strictEqual(s.get('a'), 4);
  assert.deepStrictEqual(s.getAll(), { a: 4, b: 0 });
  assert.strictEqual(s.size(), 2);
});

test('store: increment is one atomic upsert - born at floor + 1, then +1 each call; the floor is only ever the FIRST value', () => {
  const s = createViewCountStore(adapter);
  assert.strictEqual(s.increment('fresh'), 1);
  assert.strictEqual(s.increment('fresh'), 2);
  assert.strictEqual(s.increment('legacy', { floor: 7 }), 8, 'a legacy embedded viewCount seeds the first count');
  assert.strictEqual(s.increment('legacy', { floor: 7 }), 9, 'the floor is ignored once a row exists');
  assert.strictEqual(s.increment('junkfloor', { floor: 'lots' }), 1, 'a non-numeric floor reads as 0');
  assert.strictEqual(s.increment('floatfloor', { floor: 2.9 }), 3, 'a float floor truncates (2 + 1)');
  assert.strictEqual(s.increment('zerofloor', { floor: 0 }), 1);
});

test('store: remove accepts one id or a list, in one transaction; unknown ids are a no-op', () => {
  const s = createViewCountStore(adapter);
  s.set('a', 1); s.set('b', 2); s.set('c', 3);
  s.remove('a');
  s.remove(['b', 'ghost']);
  s.remove([]);
  assert.deepStrictEqual(s.getAll(), { c: 3 });
});

test('store: rekey moves the count to the new id, leaves no row under the old id, and a destination collision is REPLACED not thrown', () => {
  const s = createViewCountStore(adapter);
  s.set('old', 5);
  s.rekey('old', 'new');
  assert.deepStrictEqual(s.getAll(), { new: 5 });
  s.set('other', 1);
  s.set('taken', 99);
  s.rekey('other', 'taken'); // UPDATE OR REPLACE: the moving row wins
  assert.deepStrictEqual(s.getAll(), { new: 5, taken: 1 });
  s.rekey('new', 'new'); // same id: nothing happens, nothing throws
  assert.strictEqual(s.get('new'), 5);
  s.rekey('absent', 'elsewhere'); // no source row: nothing happens
  assert.strictEqual(s.get('elsewhere'), 0);
});

test('store: replaceAll is refuse-whole - one bad entry leaves the previous rows untouched; a good map replaces everything', () => {
  const s = createViewCountStore(adapter);
  s.set('keep', 2);
  assert.throws(() => s.replaceAll({ ok: 1, bad: -1 }), /non-negative safe integer/);
  assert.throws(() => s.replaceAll({ ok: 1, float: 1.5 }), /non-negative safe integer/);
  assert.throws(() => s.replaceAll(['not', 'a', 'map']), /expects an object map/);
  assert.deepStrictEqual(s.getAll(), { keep: 2 }, 'refused maps changed nothing');
  s.replaceAll({ x: 1, y: 2 });
  assert.deepStrictEqual(s.getAll(), { x: 1, y: 2 });
  s.replaceAll(null);
  assert.deepStrictEqual(s.getAll(), {}, 'null/undefined means empty');
});

test('store: a __proto__ id is inert data (own property on the way out), and a NUL-bearing id is refused at every write', () => {
  const s = createViewCountStore(adapter);
  s.replaceAll(JSON.parse('{"__proto__": 9, "x": 1}'));
  const all = s.getAll();
  assert.ok(Object.prototype.hasOwnProperty.call(all, '__proto__'), 'defined as an OWN property');
  assert.strictEqual(all['__proto__'], 9);
  assert.strictEqual(Object.getPrototypeOf(all), Object.prototype, 'the prototype was not reassigned');
  assert.strictEqual(({}).x, undefined, 'no pollution leaked');
  for (const call of [
    () => s.set('a\u0000b', 1), () => s.increment('a\u0000b'), () => s.remove('a\u0000b'),
    () => s.rekey('x', 'a\u0000b'), () => s.replaceAll({ 'a\u0000b': 1 }), () => s.get(''),
  ]) assert.throws(call, /U\+0000|non-empty string/);
  assert.throws(() => s.set('a', -1), /non-negative safe integer/);
  assert.throws(() => s.set('a', 1.5), /non-negative safe integer/);
});

test('store: the safe-integer ceiling - a count past 2^53 is refused at every write boundary and dropped by the value rule (adversarial W1: it would poison every READ of the table)', () => {
  const s = createViewCountStore(adapter);
  const TOO_BIG = 2 ** 53; // 9007199254740992: Number.isInteger says yes, node:sqlite cannot read it back
  s.set('ok', Number.MAX_SAFE_INTEGER);
  assert.strictEqual(s.get('ok'), Number.MAX_SAFE_INTEGER, 'the ceiling itself is storable and readable');
  assert.throws(() => s.set('a', TOO_BIG), /safe integer/);
  assert.throws(() => s.replaceAll({ a: 1, b: TOO_BIG }), /safe integer/);
  assert.throws(() => adapter.exclusiveReplace((h) => h.insertViewCount('a', TOO_BIG)), /safe integer/);
  assert.strictEqual(createViewCountStore.usableCount(TOO_BIG), null, 'the migration/import value rule drops it');
  assert.strictEqual(createViewCountStore.usableCount(1e300), null, 'and 1e300 (would land as REAL and make increment a no-op)');
  assert.strictEqual(createViewCountStore.usableCount(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  assert.strictEqual(createViewCountStore.usableCount(2.9), 2);
  assert.deepStrictEqual(s.getAll(), { ok: Number.MAX_SAFE_INTEGER }, 'every refusal left the table readable and unchanged');
  assert.strictEqual(s.increment('ok'), Number.MAX_SAFE_INTEGER, 'increment SATURATES at the ceiling - no arithmetic can write the poisoning value');
  assert.strictEqual(s.get('ok'), Number.MAX_SAFE_INTEGER);
});

test('store: a multi-row write inside an ALREADY-OPEN adapter transaction joins it (no nested BEGIN), and the outer rollback discards it', () => {
  const s = createViewCountStore(adapter);
  s.set('before', 1);
  adapter.begin();
  s.replaceAll({ inside: 5 }); // would throw "cannot start a transaction within a transaction" if it opened its own
  s.remove(['inside']);
  s.replaceAll({ inside2: 6 });
  adapter.rollback();
  assert.deepStrictEqual(s.getAll(), { before: 1 }, 'the outer rollback discarded every inner write');
});

// ---- 2. the v20 -> v21 migration ------------------------------------------

test('migration v21: doc_kv viewCounts rows move into the table (v1.42 value filter), the doc rows are deleted, load() carries no viewCounts key, save() still works', () => {
  assert.ok(SCHEMA_VERSION >= 21, 'the schema is at least v21');
  assert.ok(!DOC_KV_NAMESPACES.includes('viewCounts'), 'viewCounts is not a doc_kv namespace any more');
  // Rewind this fresh v21 file to the v20 shape: drop the table, re-stamp, and
  // seed the doc_kv namespace the way a v1.290 instance persisted it.
  adapter.close();
  const raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('DROP TABLE media_view_counts');
  raw.exec('PRAGMA user_version = 20');
  const ins = raw.prepare('INSERT INTO doc_kv(namespace, key, json) VALUES(?, ?, ?)');
  ins.run('viewCounts', 'seven', '7');
  ins.run('viewCounts', 'float', '2.9');
  ins.run('viewCounts', 'zero', '0');
  ins.run('viewCounts', 'negative', '-3');
  ins.run('viewCounts', 'junk', '"lots"');
  ins.run('viewCounts', 'nul', 'null');
  ins.run('viewCounts', 'huge', '9007199254740992'); // 2^53: v1.290's validator let it in; it must NOT reach the INTEGER column
  ins.run('metadata', 'seven', JSON.stringify({ id: 'seven', title: 'kept' }));
  raw.close();

  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'stamped forward');
  assert.deepStrictEqual(rows(), [{ media_id: 'float', count: 2 }, { media_id: 'seven', count: 7 }],
    'a finite positive number is a count (float truncated); 0 / negative / junk / null / 2^53 are dropped, and the table READS');
  assert.strictEqual(adapter.sql.prepare("SELECT COUNT(*) AS c FROM doc_kv WHERE namespace = 'viewCounts'").get().c, 0,
    'the doc rows are gone - otherwise load() would assemble a key the save-lock refuses');
  const db = adapter.load();
  assert.strictEqual(db.viewCounts, undefined, 'load() carries no viewCounts key');
  assert.deepStrictEqual(db.metadata, { seven: { id: 'seven', title: 'kept' } }, 'other namespaces untouched');
  assert.doesNotThrow(() => adapter.save(db), 'the first write after the upgrade succeeds');
  const s = createViewCountStore(adapter);
  assert.strictEqual(s.get('seven'), 7, 'and the store reads the migrated count');
});

test('migration v21: re-running the block is a no-op (idempotent under a crash between COMMIT and the version stamp)', () => {
  const s = createViewCountStore(adapter);
  s.set('kept', 4);
  adapter.close();
  const raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('PRAGMA user_version = 20'); // the stamp never landed; the table + rows did
  raw.close();
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  assert.deepStrictEqual(rows(), [{ media_id: 'kept', count: 4 }], 'the existing rows survive the re-run');
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
});

// ---- 3. the save-lock --------------------------------------------------------

test('save-lock: a doc object carrying `viewCounts` is REFUSED (the namespace left the document model)', () => {
  assert.throws(() => adapter.save({ folders: [], viewCounts: { a: 1 } }), /unknown top-level db key 'viewCounts'/);
  assert.throws(() => adapter.save({ folders: [], viewCounts: {} }), /unknown top-level db key 'viewCounts'/, 'even an empty one');
});

// ---- 4. the bulk seams -------------------------------------------------------

function handlesInto(adapterInstance, { withViewCount = true } = {}) {
  const kv = [];
  const vc = [];
  const h = {
    insertKv: (ns, key, value) => kv.push([ns, key, value]),
    insertSingle: () => {},
  };
  if (withViewCount) h.insertViewCount = (id, count) => vc.push([id, count]);
  return { h, kv, vc };
}

test('importParsedJson: a bundle `viewCounts` map and a legacy embedded item.viewCount BOTH route through insertViewCount (usable values only); the summary counts them', () => {
  const { h, kv, vc } = handlesInto(adapter);
  const summary = importParsedJson({
    folders: [],
    viewCounts: { fromBundle: 3, half: 2.5, zero: 0, junk: 'x' },
    metadata: { legacy: { id: 'legacy', title: 'L', viewCount: 4 }, plain: { id: 'plain' } },
  }, h, { source: 'bundle' });
  assert.deepStrictEqual(vc.sort(), [['fromBundle', 3], ['half', 2], ['legacy', 4]].sort());
  assert.deepStrictEqual(kv.find(([, key]) => key === 'legacy')[2], { id: 'legacy', title: 'L' }, 'the embedded field is stripped off the item');
  assert.strictEqual(summary.viewCounts, 3);
  assert.ok(!kv.some(([ns]) => ns === 'viewCounts'), 'nothing was written to doc_kv under the dead namespace');
});

test('importParsedJson: when a source carries BOTH shapes for one id, the first-class viewCounts key wins (routed last) and the summary counts the id once (gate S2/S5: the first cut flipped this)', () => {
  const { h, vc } = handlesInto(adapter);
  const summary = importParsedJson({
    viewCounts: { both: 9, junkFirstClass: 'x' },
    metadata: { both: { id: 'both', viewCount: 4 }, junkFirstClass: { id: 'junkFirstClass', viewCount: 2 } },
  }, h, { source: 'bundle' });
  assert.deepStrictEqual(vc.filter(([id]) => id === 'both'), [['both', 9]], 'exactly one write for the id, the first-class value');
  assert.deepStrictEqual(vc.filter(([id]) => id === 'junkFirstClass'), [['junkFirstClass', 2]], 'an UNUSABLE first-class value falls back to the embedded one');
  assert.strictEqual(summary.viewCounts, 2, 'each id counted once');
  // Through the real restore seam the same rule holds on disk.
  adapter.exclusiveReplace((handles) => importParsedJson({ viewCounts: { both: 9 }, metadata: { both: { id: 'both', viewCount: 4 } } }, handles, { source: 'bundle' }));
  assert.deepStrictEqual(createViewCountStore(adapter).getAll(), { both: 9 });
});

test('importParsedJson: WITHOUT an insertViewCount handle a source that carries view counts is refused loudly (never a silent drop)', () => {
  const { h } = handlesInto(adapter, { withViewCount: false });
  assert.throws(() => importParsedJson({ viewCounts: { a: 1 } }, h), /no insertViewCount handle/);
  assert.throws(() => importParsedJson({ metadata: { a: { id: 'a', viewCount: 2 } } }, h), /no insertViewCount handle/);
  assert.doesNotThrow(() => importParsedJson({ metadata: { a: { id: 'a' } }, viewCounts: {} }, h), 'nothing to route -> no handle needed');
  assert.throws(() => importParsedJson({ viewCounts: ['a'] }, handlesInto(adapter).h), /'viewCounts' is not an object/);
  assert.throws(() => importParsedJson({ viewCounts: { 'a\u0000b': 1 } }, handlesInto(adapter).h), /U\+0000/);
});

test('exclusiveReplace: wipes the table, repopulates it through insertViewCount inside the transaction, and a bad row rolls the whole replace back', () => {
  const s = createViewCountStore(adapter);
  s.set('old', 1);
  adapter.exclusiveReplace(() => {});
  assert.deepStrictEqual(rows(), [], 'a populate that writes nothing leaves an EMPTY table (restore = the bundle and nothing else)');
  adapter.exclusiveReplace((h) => { h.insertViewCount('a', 2); h.insertViewCount('b', 3); });
  assert.deepStrictEqual(s.getAll(), { a: 2, b: 3 });
  assert.throws(() => adapter.exclusiveReplace((h) => { h.insertViewCount('c', 5); h.insertViewCount('d', -1); }), /non-negative safe integer/);
  assert.deepStrictEqual(s.getAll(), { a: 2, b: 3 }, 'rolled back whole: the previous rows are intact, c never landed');
  assert.throws(() => adapter.exclusiveReplace((h) => h.insertViewCount('x\u0000y', 1)), /U\+0000/);
});

// ---- 5. the test read ----------------------------------------------------------

test('readPersistedDatabase: surfaces the table as `viewCounts` only when rows exist (independent connection)', () => {
  assert.deepStrictEqual(readPersistedDatabase(dir), {}, 'empty store, no key');
  const s = createViewCountStore(adapter);
  s.set('a', 6);
  adapter.save({ folders: ['/x'] });
  const db = readPersistedDatabase(dir);
  assert.deepStrictEqual(db.viewCounts, { a: 6 });
  assert.deepStrictEqual(db.folders, ['/x']);
  s.remove('a');
  assert.strictEqual(readPersistedDatabase(dir).viewCounts, undefined, 'back to absent once the rows are gone');
});

// ---- 6. source locks -----------------------------------------------------------

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

test('source lock: server.js never touches the table or the dead doc key in CODE; the store module holds the only INSERT text for the table', () => {
  const server = stripComments(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'));
  assert.ok(!/media_view_counts/.test(server), 'server.js does not name the table (the store is the seam)');
  assert.ok(!/\b(db|freshDb|fresh|current)\.viewCounts\b/.test(server), 'no doc-model viewCounts access survives in server.js code');
  assert.ok(/viewCountStore\.(increment|remove|rekey|getAll)\(/.test(server), 'the store is what server.js calls');
  const { execFileSync } = require('node:child_process');
  // --cached + --others: a module born on this branch must be in the sweep
  // before it is staged (an untracked writer would otherwise be invisible).
  const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '*.js'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean)
    .filter((p) => !p.startsWith('test/') && !/(^|\/)(vendor|node_modules)\//.test(p));
  const inserters = tracked.filter((p) => /INSERT\s+INTO\s+(media_view_counts|\$\{TABLE\})/.test(stripComments(fs.readFileSync(path.join(ROOT, p), 'utf8'))));
  assert.deepStrictEqual(inserters, ['lib/media/viewCounts.js'], 'exactly one module owns the INSERT text');
  const sqlite = stripComments(fs.readFileSync(path.join(ROOT, 'lib', 'db', 'sqlite.js'), 'utf8'));
  assert.ok(/VIEW_COUNT_UPSERT_SQL/.test(sqlite) && /require\('\.\.\/media\/viewCounts'\)/.test(sqlite), 'the adapter reuses the store\'s upsert text, never a copy');
});
