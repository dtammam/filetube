'use strict';

// [UNIT] Wave 5 of the relational-migration arc (2026-09-14) - the two shared
// primitives the content modules' namespaces move onto:
//   lib/db/recordListStore.js - an ordered array of id-bearing records as
//     (id PK, position, json) rows (pins / subscriptions);
//   lib/db/featureStore.js    - a module's whole namespace as a set of tables:
//     read() = the readX(db) snapshot shape, holder() for the module's own
//     ensureX() normaliser, mutate() = a fresh holder + the module's reducers +
//     a DIFF written back (inside the doc commit through the inSaveTransaction
//     hook when handed one), replaceAll (refuse-whole), migrateFromDoc (the
//     one-shot backfill from doc_kv / doc_single, skips + drops with log lines,
//     deletes the doc rows), readPersisted (the test read).
// The tables here are PRIVATE to this file (the real ones are created by the
// per-feature migrations and bound by their own suites).

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SQLITE_FILENAME, SqliteAdapter, __openRawForTests: openRaw } = require('../../lib/db/sqlite');
const { defineRecordListStore } = require('../../lib/db/recordListStore');
const { defineFeatureStore } = require('../../lib/db/featureStore');

const NUL = String.fromCharCode(0);
let dir;
let adapter;
const DDL = `
  CREATE TABLE t_folders (path TEXT PRIMARY KEY, position INTEGER NOT NULL);
  CREATE TABLE t_episodes (episode_id TEXT PRIMARY KEY, json TEXT NOT NULL);
  CREATE TABLE t_settings (key TEXT PRIMARY KEY, json TEXT NOT NULL);
  CREATE TABLE t_pins (id TEXT PRIMARY KEY, position INTEGER NOT NULL, json TEXT NOT NULL);
  CREATE TABLE t_channels (folder_name TEXT PRIMARY KEY, json TEXT NOT NULL);
`;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-feature-store-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  adapter.sql.exec(DDL);
});
afterEach(() => {
  try { adapter.close(); } catch (_) { /* closed by the test */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const featureDef = defineFeatureStore({
  name: 't',
  parts: {
    folders: { kind: 'list', column: 'path' },
    episodes: { kind: 'map', keyColumn: 'episode_id' },
    settings: { kind: 'kv' },
    pins: { kind: 'records' },
    allowMembersOnly: { kind: 'value', via: 'settings', defaultValue: false },
    channels: { kind: 'map', keyColumn: 'folder_name', docSingleMap: true }, // music.channels' shape: a doc_single MAP
  },
});

test('recordList: array order, verbatim records, set keeps position / appends, remove, replaceAll dedupes by id keep-first, tolerant reads / asserting writes', () => {
  const r = defineRecordListStore({ label: 'pins', table: 't_pins' }).createStore(adapter);
  r.replaceAll([{ id: 'b', order: 5 }, { id: 'a', order: 1 }, { id: 'b', order: 9 }]);
  assert.deepStrictEqual(r.list(), [{ id: 'b', order: 5 }, { id: 'a', order: 1 }], 'array order kept; the record keeps its own order field; duplicate id keep-first');
  r.set({ id: 'a', order: 2, label: 'x' });
  assert.deepStrictEqual(r.list(), [{ id: 'b', order: 5 }, { id: 'a', order: 2, label: 'x' }], 'an existing id keeps its slot');
  r.set({ id: 'c' });
  assert.deepStrictEqual(r.list().map((x) => x.id), ['b', 'a', 'c'], 'a new id appends');
  assert.strictEqual(r.remove('b'), 1);
  assert.deepStrictEqual(r.get('a'), { id: 'a', order: 2, label: 'x' });
  assert.strictEqual(r.get(''), undefined);
  assert.strictEqual(r.has(NUL), false);
  for (const bad of [null, 'str', [], { id: '' }, { id: 7 }, { id: 'x' + NUL }]) assert.throws(() => r.set(bad), /plain object|non-empty string id|U\+0000/);
  assert.throws(() => r.replaceAll([{ id: 'ok' }, { noId: true }]), /non-empty string id/);
  assert.deepStrictEqual(r.list().map((x) => x.id), ['a', 'c'], 'a refused replaceAll wrote nothing');
});

test('feature store: read() is the snapshot shape (arrays/maps/objects/scalar); holder() wraps it; parts are the sub-stores', () => {
  const s = featureDef.createStore(adapter);
  assert.deepStrictEqual(s.read(), { folders: [], episodes: {}, settings: {}, pins: [], allowMembersOnly: false, channels: {} });
  assert.deepStrictEqual(s.holder(), { t: { folders: [], episodes: {}, settings: {}, pins: [], allowMembersOnly: false, channels: {} } });
  s.parts.folders.replaceAll(['/b', '/a']);
  s.parts.episodes.set('e1', { id: 'e1', title: 'One' });
  s.parts.settings.set('pollMinutes', 60);
  s.parts.pins.replaceAll([{ id: 'p1', order: 0 }]);
  s.parts.settings.set('allowMembersOnly', true);
  assert.deepStrictEqual(s.read(), { folders: ['/b', '/a'], episodes: { e1: { id: 'e1', title: 'One' } }, settings: { pollMinutes: 60, allowMembersOnly: true }, pins: [{ id: 'p1', order: 0 }], allowMembersOnly: true, channels: {} });
  assert.deepStrictEqual(s.tables.map((t) => t.table), ['t_folders', 't_episodes', 't_settings', 't_pins', 't_channels']);
  assert.deepStrictEqual(featureDef.docKvNamespaces, ['t.episodes']);
  assert.deepStrictEqual(featureDef.docSingleNames, ['t.folders', 't.settings', 't.pins', 't.allowMembersOnly', 't.channels']);
});

test('feature store: mutate() runs the module\'s mutator on a fresh holder and writes ONLY the diff; false writes nothing; a throw writes nothing', () => {
  const s = featureDef.createStore(adapter);
  s.replaceAll({ folders: ['/a'], episodes: { e1: { id: 'e1', v: 1 }, e2: { id: 'e2', v: 1 }, e3: { id: 'e3', v: 1 } }, settings: { pollMinutes: 60, keep: 'k' }, pins: [{ id: 'p1' }], allowMembersOnly: false });
  const out = s.mutate((h) => {
    const ns = h.t;
    ns.episodes.e2.v = 2;           // changed
    delete ns.episodes.e3;          // gone
    ns.episodes.e4 = { id: 'e4' };  // new
    ns.settings.pollMinutes = 120;  // changed
    delete ns.settings.keep;        // gone
    ns.folders.push('/b');          // list changed
    ns.allowMembersOnly = true;     // value changed
    return 'result';
  });
  assert.strictEqual(out, 'result');
  assert.deepStrictEqual(s.read(), { folders: ['/a', '/b'], episodes: { e1: { id: 'e1', v: 1 }, e2: { id: 'e2', v: 2 }, e4: { id: 'e4' } }, settings: { pollMinutes: 120, allowMembersOnly: true }, pins: [{ id: 'p1' }], allowMembersOnly: true, channels: {} });
  // the diff is measured: an unchanged mutate writes nothing
  const stats = s.syncFrom(s.read());
  assert.deepStrictEqual(stats, { rowsWritten: 0, rowsDeleted: 0 });
  const stats2 = s.syncFrom({ ...s.read(), episodes: { e1: { id: 'e1', v: 1 }, e2: { id: 'e2', v: 3 } } });
  assert.deepStrictEqual(stats2, { rowsWritten: 1, rowsDeleted: 1 }, 'one changed row written, one gone row deleted, e1 untouched');
  assert.strictEqual(s.mutate((h) => { h.t.folders = []; return false; }), false);
  assert.deepStrictEqual(s.read().folders, ['/a', '/b'], 'false = skip the write');
  assert.throws(() => s.mutate((h) => { h.t.folders = ['/x']; throw new Error('boom'); }), /boom/);
  assert.deepStrictEqual(s.read().folders, ['/a', '/b'], 'a throwing mutator writes nothing');
});

test('feature store: mutate() with an inSaveTransaction hook defers the diff to the hook (the doc commit); the hook rolling back leaves the tables untouched', () => {
  const queued = [];
  const s = featureDef.createStore(adapter, { inSaveTransaction: (fn) => queued.push(fn) });
  s.replaceAll({ folders: ['/a'] });
  s.mutate((h) => { h.t.folders.push('/b'); return true; });
  assert.deepStrictEqual(s.read().folders, ['/a'], 'nothing written yet - the hook owns the write');
  adapter.begin();
  for (const fn of queued) fn();
  assert.deepStrictEqual(s.read().folders, ['/a', '/b'], 'written inside the open transaction');
  adapter.rollback();
  assert.deepStrictEqual(s.read().folders, ['/a'], 'the rollback took the diff with it');
});

test('feature store: replaceAll is refuse-whole (unknown part, bad list entry, bad record, bad map key) and null = empty', () => {
  const s = featureDef.createStore(adapter);
  s.replaceAll({ folders: ['/a'], pins: [{ id: 'p' }] });
  assert.throws(() => s.replaceAll({ folders: ['/b'], playlists: {} }), /unknown part 'playlists'/);
  assert.throws(() => s.replaceAll({ folders: ['/b', ''] }), /non-empty string/);
  assert.throws(() => s.replaceAll({ pins: [{ id: 'x' }, 'junk'] }), /plain object/);
  assert.throws(() => s.replaceAll({ episodes: { ['a' + NUL]: {} } }), /U\+0000/);
  assert.throws(() => s.replaceAll({ episodes: ['x'] }), /object map/);
  assert.throws(() => s.replaceAll({ settings: { ok: 1, bad: undefined } }), /cannot be undefined/);
  assert.deepStrictEqual(s.read().folders, ['/a'], 'every refusal wrote nothing');
  assert.deepStrictEqual(s.read().pins, [{ id: 'p' }]);
  s.replaceAll(null);
  assert.deepStrictEqual(s.read(), { folders: [], episodes: {}, settings: {}, pins: [], allowMembersOnly: false, channels: {} });
  assert.strictEqual(s.isEmpty(), true);
});

test('feature store: a PARTIAL snapshot (read(only) / holder(only)) syncs only the parts it read - the rest is untouched, even after the module\'s ensure fills defaults (gate pass B, adversarial W1)', () => {
  const s = featureDef.createStore(adapter);
  s.replaceAll({ folders: ['/a'], episodes: { e1: { id: 'e1' } }, pins: [{ id: 'p1' }], settings: { k: 1 }, allowMembersOnly: true, channels: { c: 'on' } });
  const h = s.holder(['folders']);
  assert.deepStrictEqual(Object.keys(h.t), ['folders'], 'only the part asked for');
  // a module's ensureX(holder) fills the missing keys with defaults - the very
  // shape that used to read as "the user emptied every other part"
  Object.assign(h.t, { episodes: {}, pins: [], settings: {}, allowMembersOnly: false, channels: {} });
  h.t.folders = ['/b'];
  assert.deepStrictEqual(s.syncFrom(h.t), { rowsWritten: 1, rowsDeleted: 0 }, 'the read part diffs; nothing else is touched');
  assert.deepStrictEqual(s.read(), { folders: ['/b'], episodes: { e1: { id: 'e1' } }, pins: [{ id: 'p1' }], settings: { k: 1, allowMembersOnly: true }, allowMembersOnly: true, channels: { c: 'on' } }); // (this fixture's settings kv is not `internal`, so the value shows there too)
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s.read(['pins']))), { pins: [{ id: 'p1' }] }, 'the tag is invisible to JSON');
  const full = s.holder();
  full.t.pins = [];
  assert.deepStrictEqual(s.syncFrom(full.t), { rowsWritten: 0, rowsDeleted: 0 }, 'a FULL holder emptying a part still wipes it (a records part replaces whole; the stats count rows written)');
  assert.deepStrictEqual(s.read().pins, [], 'the full holder is authoritative for every part');
});

test('feature store: migrateFromDoc copies the doc rows (maps from doc_kv, the rest from doc_single) verbatim, skips/drops with a log line, deletes the doc rows; readPersisted assembles the namespace or undefined', () => {
  const raw = adapter.sql;
  raw.exec(`INSERT INTO doc_kv(namespace, key, json) VALUES ('t.episodes', 'e1', '{"id":"e1"}'), ('t.episodes', '', '{"id":""}'), ('other.ns', 'k', '1')`);
  raw.exec(`INSERT INTO doc_single(name, json) VALUES ('t.folders', '["/a","","/a","/b"]'), ('t.settings', '{"pollMinutes":30,"":1}'), ('t.pins', '[{"id":"p1"},"junk",{"id":"p1"}]'), ('t.allowMembersOnly', 'true'), ('t.channels', '{"NESTALGIA":"on","":"off","Zarchivo":"off"}'), ('other', '[]')`);
  const logged = [];
  raw.exec('BEGIN');
  featureDef.migrateFromDoc(raw, (m) => logged.push(m));
  raw.exec('COMMIT');
  const s = featureDef.createStore(adapter);
  assert.deepStrictEqual(s.read(), { folders: ['/a', '/b'], episodes: { e1: { id: 'e1' } }, settings: { pollMinutes: 30, allowMembersOnly: true }, pins: [{ id: 'p1' }], allowMembersOnly: true, channels: { NESTALGIA: 'on', Zarchivo: 'off' } });
  assert.strictEqual(logged.length, 5, logged.join(' | '));
  assert.deepStrictEqual(featureDef.docKvNamespaces, ['t.episodes'], 'a doc_single MAP is not a doc_kv namespace');
  assert.ok(featureDef.docSingleNames.includes('t.channels'));
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM doc_kv WHERE namespace LIKE 't.%'").get().c, 0);
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM doc_single WHERE name LIKE 't.%'").get().c, 0);
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM doc_kv WHERE namespace = 'other.ns'").get().c, 1, 'other namespaces untouched');
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM doc_single WHERE name = 'other'").get().c, 1);
  const ro = openRaw(path.join(dir, SQLITE_FILENAME));
  try {
    assert.deepStrictEqual(featureDef.readPersisted(ro), s.read());
  } finally { ro.close(); }
  s.replaceAll(null);
  const ro2 = openRaw(path.join(dir, SQLITE_FILENAME));
  try { assert.strictEqual(featureDef.readPersisted(ro2), undefined, 'every part empty -> absent'); } finally { ro2.close(); }
});
