'use strict';

// [UNIT] Wave 5 of the relational-migration arc (2026-09-14), first feature -
// the Shows namespace (`tv.folders` / `tv.episodes` / `tv.settings`) leaves
// the document model for tv_folders / tv_episodes / tv_settings behind the
// feature store lib/tv/store.js exports (FEATURE, createTvStore). Binds:
//   1. the v26 -> v27 MIGRATION: the root list, the episode rows and the
//      settings copied verbatim, the doc rows (doc_kv + doc_single) deleted,
//      stamp 27 inside the block, load() has no `tv` key, save() works, re-run
//      idempotent, a corrupt episode row rolls the whole block back to a
//      re-runnable v26 (all three CREATE TABLEs included);
//   2. the save-lock refuses a stray `db.tv` write (the container left the lock);
//   3. the bulk seams: importParsedJson routes `tv` whole through
//      replaceFeature (refused without the handle / on an unknown part / a bad
//      shape); exclusiveReplace wipes all three tables and repopulates inside
//      its transaction, rolling back whole on a bad row;
//   4. readPersistedDatabase surfaces `tv` in its container shape when any
//      part has rows;
//   5. source locks: server.js never names the tables or the dead doc
//      spellings in CODE; the scan merge and the config POST run through
//      tvDb.mutate; the reads take tvDb.read().

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  SQLITE_FILENAME, SqliteAdapter, SCHEMA_VERSION, FEATURE_DEFS, readPersistedDatabase, importParsedJson,
  __openRawForTests: openRaw,
} = require('../../lib/db/sqlite');
const { ensureLegacyDocTables, countLegacyDocTables } = require('../helpers/legacy-doc-tables');
const tvStore = require('../../lib/tv/store');
const { routeSurfaceSource } = require('../helpers/route-surface');

let dir;
let adapter;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tv-feature-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
});
afterEach(() => {
  try { adapter.close(); } catch (_) { /* closed by the test */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const ep = (id, over) => ({ id, showId: 's1', showName: 'Show', title: id, filePath: `/tv/Show/${id}.mp4`, rootFolder: '/tv', seasonNum: 1, episodeNum: 1, ...over });

function rewindToV26(rows) {
  adapter.close();
  const raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('DROP TABLE tv_folders; DROP TABLE tv_episodes; DROP TABLE tv_settings; PRAGMA user_version = 26');
  ensureLegacyDocTables(raw);
  const kv = raw.prepare('INSERT INTO doc_kv(namespace, key, json) VALUES(?, ?, ?)');
  const single = raw.prepare('INSERT INTO doc_single(name, json) VALUES(?, ?)');
  for (const [kind, a, b, c] of rows) (kind === 'kv' ? kv.run(a, b, c) : single.run(a, b));
  raw.close();
}
const reopen = () => { adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }); return adapter; };

test('migration v27: the root list, the episode rows and the settings move verbatim; doc rows deleted; stamp 27; load() has no tv key; save() works', () => {
  assert.ok(SCHEMA_VERSION >= 27);
  assert.ok(FEATURE_DEFS.some((d) => d.name === 'tv'));
  rewindToV26([
    ['single', 'tv.folders', JSON.stringify(['/tv/b', '/tv/a'])],
    ['single', 'tv.settings', JSON.stringify({ pruneMissing: false })],
    ['kv', 'tv.episodes', 'e1', JSON.stringify(ep('e1', { thumb: null, codec: 'h264' }))],
    ['kv', 'tv.episodes', 'e2', JSON.stringify(ep('e2'))],
  ]);
  reopen();
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const tv = tvStore.createTvStore(adapter);
  assert.deepStrictEqual(tv.read(), { folders: ['/tv/b', '/tv/a'], episodes: { e1: ep('e1', { thumb: null, codec: 'h264' }), e2: ep('e2') }, settings: { pruneMissing: false } });
  assert.strictEqual(countLegacyDocTables(adapter.sql), 0, 'the doc tables are gone (v33 - which refuses to drop a table that still holds a row, so every drain before it deleted its rows)');
  const db = adapter.load();
  assert.strictEqual(db.tv, undefined, 'no doc-model tv key');
  assert.doesNotThrow(() => adapter.save(db));
  assert.deepStrictEqual(tv.read().folders, ['/tv/b', '/tv/a'], 'a doc save never touches the tables');
  assert.deepStrictEqual(tvStore.readTv(tv.holder()), tv.read(), 'the module\'s read view over the holder is the same snapshot');
});

test('migration v27: re-run is a no-op; a corrupt episode row rolls the whole block back to a re-runnable v26 (all three CREATE TABLEs included)', () => {
  rewindToV26([]);
  reopen();
  tvStore.createTvStore(adapter).replaceAll({ folders: ['/kept'] });
  adapter.close();
  let raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('PRAGMA user_version = 26');
  ensureLegacyDocTables(raw);
  raw.close();
  reopen();
  assert.deepStrictEqual(tvStore.createTvStore(adapter).read().folders, ['/kept'], 'a re-run neither wipes nor duplicates');
  rewindToV26([['single', 'tv.folders', JSON.stringify(['/good'])], ['kv', 'tv.episodes', 'bad', '{not json']]);
  assert.throws(() => new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }), /JSON|Unexpected/);
  raw = openRaw(path.join(dir, SQLITE_FILENAME));
  assert.strictEqual(raw.prepare('PRAGMA user_version').get().user_version, 26, 'the stamp is the last committed floor');
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM doc_kv WHERE namespace = 'tv.episodes'").get().c, 1, 'doc rows untouched');
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name IN ('tv_folders', 'tv_episodes', 'tv_settings')").get().c, 0, 'every table creation rolled back');
  raw.prepare("UPDATE doc_kv SET json = ? WHERE key = 'bad'").run(JSON.stringify(ep('bad')));
  raw.close();
  reopen();
  assert.deepStrictEqual(Object.keys(tvStore.createTvStore(adapter).read().episodes), ['bad'], 'repaired and re-run');
});

test('save-lock: a stray `tv` container on the doc object is REFUSED (the container left the lock)', () => {
  assert.throws(() => adapter.save({ metadata: {}, tv: { folders: [] } }), /unknown top-level db key 'tv'/);
});

test('importParsedJson: `tv` routes whole through replaceFeature (never doc rows); refused without the handle / on an unknown part / a bad shape', () => {
  const features = [];
  const h = { insertViewCount: () => {}, insertProgress: () => {}, insertTombstone: () => {}, insertTrash: () => {}, insertSetting: () => {}, replaceFolders: () => {}, insertFolderSetting: () => {}, insertFolderDisplayName: () => {}, replaceLiked: () => {}, replaceFeature: (name, ns) => features.push([name, ns]) };
  const ns = { folders: ['/tv'], episodes: { e1: ep('e1') }, settings: {} };
  const summary = importParsedJson({ metadata: {}, tv: ns }, h);
  assert.deepStrictEqual(features, [['tv', ns]]);
  assert.strictEqual(summary['tv.folders'], 1);
  assert.strictEqual(summary['tv.episodes'], 1);
  const noHandle = { ...h };
  delete noHandle.replaceFeature;
  assert.throws(() => importParsedJson({ tv: ns }, noHandle), /no replaceFeature handle/);
  assert.throws(() => importParsedJson({ tv: ['x'] }, h), /'tv' is not an object/);
  assert.throws(() => importParsedJson({ tv: { playlists: {} } }, h), /unknown key 'tv\.playlists'/);
});

test('exclusiveReplace: wipes all three tables, repopulates through replaceFeature inside its transaction, rolls back whole on a bad row', () => {
  const tv = tvStore.createTvStore(adapter);
  tv.replaceAll({ folders: ['/old'], episodes: { old: ep('old') }, settings: { s: 1 } });
  adapter.exclusiveReplace(() => {});
  assert.deepStrictEqual(tv.read(), { folders: [], episodes: {}, settings: {} }, 'restore = the bundle and nothing else');
  adapter.exclusiveReplace((h) => { h.replaceFeature('tv', { folders: ['/b', '/a'], episodes: { e1: ep('e1') } }); });
  assert.deepStrictEqual(tv.read(), { folders: ['/b', '/a'], episodes: { e1: ep('e1') }, settings: {} });
  assert.throws(() => adapter.exclusiveReplace((h) => { h.replaceFeature('tv', { folders: ['/c'], episodes: { '': ep('x') } }); }), /non-empty string/);
  assert.deepStrictEqual(tv.read().folders, ['/b', '/a'], 'rolled back whole');
  assert.throws(() => adapter.exclusiveReplace((h) => h.replaceFeature('nope', {})), /unknown feature 'nope'/);
});

test('readPersistedDatabase: surfaces `tv` in its container shape only when some part has rows', () => {
  assert.deepStrictEqual(readPersistedDatabase(dir), {});
  const tv = tvStore.createTvStore(adapter);
  tv.replaceAll({ episodes: { e1: ep('e1') } });
  assert.deepStrictEqual(readPersistedDatabase(dir), { tv: { folders: [], episodes: { e1: ep('e1') }, settings: {} } });
  tv.replaceAll(null);
  assert.deepStrictEqual(readPersistedDatabase(dir), {});
});

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

test('source lock: the route surface never names the tv tables or the dead doc spellings in CODE; the scan merge and the config POST run through tvDb.mutate; the reads take tvDb.read()', () => {
  // Wave 7b slice S4 (the monolith split): the config POST moved to
  // lib/tv/routes.js and the scan merge to lib/tv/scanRunner.js, so both
  // tvDb.mutate() writers left server.js. A moved sentence is not a deleted
  // sentence: the lock now reads the SURFACE (server.js PLUS every module the
  // split carved out of it, derived from server.js's own requires), so the
  // exact-2 writer count and the negative spellings still cover the code they
  // were written for wherever the slice put it.
  const server = routeSurfaceSource((p) => stripComments(fs.readFileSync(p, 'utf8')));
  for (const t of ['tv_folders', 'tv_episodes', 'tv_settings']) assert.ok(!server.includes(t), t);
  assert.ok(!/\b(db|freshDb|fresh|current|state|next|prev|cached\w*|mdb|loaded|persisted|snapshot|handoffDb|srcMeta|getCachedDatabase\(\)|loadDatabase\(\))\.tv\b/.test(server), 'no doc-model tv access survives');
  assert.ok(!/tvStore\.readTv\(/.test(server), 'every read view moved to tvDb.read()');
  assert.ok(!/tvStore\.ensureTv\((db|fresh|freshDb)\)/.test(server), 'no ensureTv over the doc object');
  assert.strictEqual((server.match(/tvDb\.mutate\(/g) || []).length, 2, 'the scan merge and the config POST - the two writers');
  assert.ok((server.match(/tvDb\.read\(\)/g) || []).length >= 13, 'the reads');
  assert.ok(/bundle\.tv = tvDb\.read\(\)/.test(server), 'the bundle reads the tables');
});
