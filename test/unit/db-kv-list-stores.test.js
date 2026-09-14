'use strict';

// [UNIT] Wave 4 of the relational-migration arc (2026-09-14) - the two shared
// store primitives the config singletons move onto:
//   lib/db/kvStore.js         - key -> JSON value, one row per key (settings)
//   lib/db/orderedListStore.js - ordered list of strings as (value PK, position)
// and the `keyColumn` option lib/media/jsonRowStore.js gained. Binds, in order:
//   1. kv: get() merges defaults UNDER rows (a fresh object per call), getRaw()
//      is rows only, getKey/has, set/update (undefined = unset)/remove,
//      replaceAll refuse-whole, tolerant reads / asserting writes, __proto__
//      inert, joining an open transaction;
//   2. list: position order, add appends at max+1 (idempotent), remove keeps
//      the survivors' positions, rekey OR REPLACE keeps the position, replaceAll
//      dedupes keep-first and numbers from 0, tolerant reads / asserting writes;
//   3. jsonRowStore keyColumn: the PK column is named as declared; the
//      UPSERT text, get/has/getAll/rekey/setMany all address it.
// The NUL cases use String.fromCharCode(0) - never a typed escape (repo scar).

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SQLITE_FILENAME, SqliteAdapter } = require('../../lib/db/sqlite');
const { defineKvStore } = require('../../lib/db/kvStore');
const { defineOrderedListStore } = require('../../lib/db/orderedListStore');
const { defineJsonRowStore } = require('../../lib/media/jsonRowStore');

const NUL = String.fromCharCode(0);
let dir;
let adapter;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-kv-list-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  // Private tables for the primitives under test (the real ones are created by
  // the migrations and bound by their own store tests).
  adapter.sql.exec('CREATE TABLE t_kv (key TEXT PRIMARY KEY, json TEXT NOT NULL)');
  adapter.sql.exec('CREATE TABLE t_list (value TEXT PRIMARY KEY, position INTEGER NOT NULL)');
  adapter.sql.exec('CREATE TABLE t_rows (root_path TEXT PRIMARY KEY, json TEXT NOT NULL)');
});
afterEach(() => {
  try { adapter.close(); } catch (_) { /* closed by the test */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const kvDef = defineKvStore({ label: 'tkv', table: 't_kv' });
const listDef = defineOrderedListStore({ label: 'tlist', table: 't_list', column: 'value' });
const rowDef = defineJsonRowStore({ label: 'trows', table: 't_rows', keyColumn: 'root_path' });

// ---- 1. kv ------------------------------------------------------------------------

test('kv: get() merges defaults UNDER the rows and hands back a fresh object; getRaw() is rows only', () => {
  const s = kvDef.createStore(adapter, { defaults: { a: 1, b: 'two', nested: { x: 1 } } });
  assert.deepStrictEqual(s.get(), { a: 1, b: 'two', nested: { x: 1 } });
  assert.deepStrictEqual(s.getRaw(), {});
  s.set('b', 'stored');
  s.set('c', [1, 2]);
  assert.deepStrictEqual(s.get(), { a: 1, b: 'stored', nested: { x: 1 }, c: [1, 2] });
  assert.deepStrictEqual(s.getRaw(), { b: 'stored', c: [1, 2] });
  const one = s.get();
  one.a = 99;
  one.nested.x = 99;
  assert.deepStrictEqual(s.get(), { a: 1, b: 'stored', nested: { x: 1 }, c: [1, 2] }, 'a caller mutating its copy changes nothing (no shared default object)');
  assert.strictEqual(s.getKey('a'), 1, 'a default reads through getKey');
  assert.strictEqual(s.getKey('b'), 'stored');
  assert.strictEqual(s.getKey('zzz'), undefined);
  assert.strictEqual(s.has('a'), false, 'a default is not a row');
  assert.strictEqual(s.has('b'), true);
  assert.strictEqual(s.size(), 2);
});

test('kv: update() writes ONLY the touched keys (undefined unsets), remove(), replaceAll refuse-whole, and a bad patch changes nothing', () => {
  const s = kvDef.createStore(adapter, { defaults: { a: 1 } });
  s.replaceAll({ a: 10, b: 20, c: 30 });
  s.update({ b: 21, c: undefined });
  assert.deepStrictEqual(s.getRaw(), { a: 10, b: 21 });
  assert.strictEqual(s.get().c, undefined, 'unset falls back to no default');
  s.update({ a: undefined });
  assert.strictEqual(s.get().a, 1, 'unset falls back to the default');
  s.update({});
  assert.throws(() => s.update(['x']), /expects an object/);
  assert.throws(() => s.update({ ok: 1, bad: () => 1 }), /JSON-serialisable/);
  assert.deepStrictEqual(s.getRaw(), { b: 21 }, 'a refused patch wrote nothing');
  s.set('d', null);
  assert.strictEqual(s.getKey('d'), null, 'null is a value');
  s.remove('d');
  s.remove(['b', 'ghost']);
  s.remove([]);
  assert.deepStrictEqual(s.getRaw(), {});
  assert.throws(() => s.replaceAll({ ok: 1, bad: undefined }), /cannot be undefined/);
  assert.throws(() => s.replaceAll('x'), /expects an object/);
  s.replaceAll({ z: { deep: [1] } });
  assert.deepStrictEqual(s.getRaw(), { z: { deep: [1] } });
  s.replaceAll(null);
  assert.deepStrictEqual(s.getRaw(), {});
});

test('kv: tolerant reads / asserting writes on impossible keys; __proto__ is inert own data', () => {
  const s = kvDef.createStore(adapter);
  s.set('real', 1);
  for (const bad of ['', 'a' + NUL + 'b', NUL, 42, null, undefined, {}]) {
    assert.strictEqual(s.getKey(bad), undefined);
    assert.strictEqual(s.has(bad), false);
    assert.throws(() => s.set(bad, 1), /non-empty string|U\+0000/);
    if (typeof bad !== 'string') continue; // a computed non-string key stringifies ('42') - a valid key
    assert.throws(() => s.update({ [bad]: 1 }), /non-empty string|U\+0000/);
    assert.throws(() => s.replaceAll({ [bad]: 1 }), /non-empty string|U\+0000/);
  }
  assert.throws(() => s.remove(''), /non-empty string/);
  assert.strictEqual(s.getKey('real'), 1);
  s.replaceAll(JSON.parse('{"__proto__": {"polluted": 1}, "x": 1}'));
  const all = s.get();
  assert.ok(Object.prototype.hasOwnProperty.call(all, '__proto__'));
  assert.strictEqual(Object.getPrototypeOf(all), Object.prototype);
  assert.strictEqual(({}).polluted, undefined);
  const withDefaults = kvDef.createStore(adapter, { defaults: JSON.parse('{"__proto__": 5}') }).get();
  assert.ok(Object.prototype.hasOwnProperty.call(withDefaults, '__proto__'), 'a __proto__ default is defined as own data too');
});

test('kv + list: a multi-row write inside an ALREADY-OPEN adapter transaction joins it and the outer rollback discards it', () => {
  const s = kvDef.createStore(adapter);
  const l = listDef.createStore(adapter);
  s.set('before', 1);
  l.add('before');
  adapter.begin();
  s.replaceAll({ inside: 5 });
  s.update({ inside2: 6 });
  l.replaceAll(['x', 'y']);
  l.add('z');
  adapter.rollback();
  assert.deepStrictEqual(s.getRaw(), { before: 1 });
  assert.deepStrictEqual(l.list(), ['before']);
});

// ---- 2. list ----------------------------------------------------------------------

test('list: position order; add appends at max+1 and is idempotent; remove keeps survivor positions; rekey keeps the position (OR REPLACE)', () => {
  const l = listDef.createStore(adapter);
  assert.deepStrictEqual(l.list(), []);
  assert.strictEqual(l.add('b'), true);
  assert.strictEqual(l.add('a'), true);
  assert.strictEqual(l.add('c'), true);
  assert.strictEqual(l.add('a'), false, 'already a member');
  assert.deepStrictEqual(l.list(), ['b', 'a', 'c'], 'insertion order, not alphabetical');
  assert.strictEqual(l.has('a'), true);
  assert.strictEqual(l.size(), 3);
  assert.strictEqual(l.remove('a'), 1);
  assert.strictEqual(l.remove(['ghost']), 0);
  assert.strictEqual(l.remove([]), 0);
  assert.deepStrictEqual(l.list(), ['b', 'c']);
  assert.strictEqual(l.add('d'), true);
  assert.deepStrictEqual(l.list(), ['b', 'c', 'd'], 'appends after the gap, never into it');
  assert.strictEqual(l.rekey('b', 'B'), true);
  assert.deepStrictEqual(l.list(), ['B', 'c', 'd'], 'the renamed member keeps its slot');
  assert.strictEqual(l.rekey('ghost', 'x'), false, 'a non-member re-key is a no-op');
  assert.deepStrictEqual(l.list(), ['B', 'c', 'd']);
  assert.strictEqual(l.rekey('d', 'c'), true, 'collision: the moving row wins');
  assert.deepStrictEqual(l.list(), ['B', 'c'], 'one row, at the mover\'s position');
  assert.strictEqual(l.rekey('c', 'c'), true, 'same-value re-key of a member: true, no change');
  assert.deepStrictEqual(l.list(), ['B', 'c']);
});

test('list: replaceAll validates whole, dedupes keep-first, numbers from 0; tolerant reads / asserting writes', () => {
  const l = listDef.createStore(adapter);
  l.replaceAll(['b', 'a', 'b', 'c', 'a']);
  assert.deepStrictEqual(l.list(), ['b', 'a', 'c']);
  assert.deepStrictEqual(adapter.sql.prepare('SELECT value, position FROM t_list ORDER BY position').all().map((r) => [r.value, r.position]), [['b', 0], ['a', 1], ['c', 2]]);
  assert.throws(() => l.replaceAll(['ok', '']), /non-empty string/);
  assert.throws(() => l.replaceAll(['ok', 'a' + NUL]), /U\+0000/);
  assert.throws(() => l.replaceAll('nope'), /expects an array/);
  assert.deepStrictEqual(l.list(), ['b', 'a', 'c'], 'a refused list changed nothing');
  l.replaceAll(null);
  assert.deepStrictEqual(l.list(), []);
  for (const bad of ['', NUL, 42, null, undefined]) {
    assert.strictEqual(l.has(bad), false);
    assert.throws(() => l.add(bad), /non-empty string|U\+0000/);
    assert.throws(() => l.remove(bad), /non-empty string|U\+0000/);
    assert.throws(() => l.rekey('x', bad), /non-empty string|U\+0000/);
  }
  assert.deepStrictEqual(listDef.normalizeList(['x', 'x', 'y']), ['x', 'y'], 'the shared normalizer the migrations use');
});

// ---- 3. jsonRowStore keyColumn -----------------------------------------------------

test('jsonRowStore keyColumn: the declared PK column is what every statement addresses; setMany upserts without wiping', () => {
  assert.match(rowDef.UPSERT_SQL, /^INSERT INTO t_rows\(root_path, json\) VALUES\(\?, \?\) ON CONFLICT\(root_path\)/);
  assert.strictEqual(rowDef.keyColumn, 'root_path');
  const r = rowDef.createStore(adapter);
  r.set('/a', { name: 'A' });
  r.setMany({ '/b': { name: 'B' }, '/c': { name: 'C' } });
  assert.deepStrictEqual(r.getAll(), { '/a': { name: 'A' }, '/b': { name: 'B' }, '/c': { name: 'C' } }, 'setMany kept /a');
  assert.deepStrictEqual(r.get('/b'), { name: 'B' });
  assert.strictEqual(r.has('/c'), true);
  r.rekey('/a', '/z');
  assert.deepStrictEqual(Object.keys(r.getAll()), ['/b', '/c', '/z']);
  r.remove('/z');
  assert.strictEqual(r.size(), 2);
  assert.throws(() => r.setMany({ ok: {}, bad: undefined }), /cannot be undefined/);
  assert.strictEqual(r.size(), 2, 'a refused setMany wrote nothing');
  assert.deepStrictEqual(adapter.sql.prepare('SELECT root_path FROM t_rows ORDER BY root_path').all().map((x) => x.root_path), ['/b', '/c'], 'the column really is root_path');
  // The default is still media_id for the media stores.
  assert.strictEqual(defineJsonRowStore({ label: 'x', table: 'y' }).keyColumn, 'media_id');
});
