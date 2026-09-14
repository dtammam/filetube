'use strict';

// [UNIT] Wave 4 of the relational-migration arc (2026-09-14), first group -
// `settings` (the app settings object) leaves doc_single for the `app_settings`
// table (lib/config/settings.js on the shared lib/db/kvStore.js shape, ONE ROW
// PER KEY). Binds, in order:
//   1. the store with construction-time defaults: get() is what
//      withDefaultSettings(db.settings) was; update() writes only touched keys;
//   2. the v23 -> v24 MIGRATION: the doc row's object split into rows verbatim,
//      the doc row deleted, stamp 24, load() has no `settings` key, save()
//      works, re-run idempotent, a corrupt row rolls the whole block back to a
//      re-runnable v23 (CREATE TABLE included), a non-object row is dropped
//      with a log line, an unaddressable key is skipped;
//   3. the save-lock refuses the dead key;
//   4. the bulk seams: importParsedJson routes `settings` through insertSetting
//      (and refuses without it / on a bad shape); exclusiveReplace wipes +
//      repopulates inside its transaction and rolls back whole on a bad row;
//   5. readPersistedDatabase surfaces the RAW rows as `settings` when rows exist;
//   6. source locks: the route surface (server.js plus the modules Wave 7b's
//      split carved out of it) never names the table or the dead doc key in
//      CODE and calls the store at every seam; the INSERT text stays in the
//      shared kv definition.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const {
  SQLITE_FILENAME, SqliteAdapter, SCHEMA_VERSION, readPersistedDatabase, importParsedJson,
  __openRawForTests: openRaw,
} = require('../../lib/db/sqlite');
const { ensureLegacyDocTables, countLegacyDocTables } = require('../helpers/legacy-doc-tables');
const createSettingsStore = require('../../lib/config/settings');
const { routeSurfaceSource } = require('../helpers/route-surface'); // Wave 7b: the source locks read server.js + the modules the split carved out of it

const DEFAULTS = { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, trashRetentionDays: 30, nested: { a: 1 } };
let dir;
let adapter;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-app-settings-'));
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
});
afterEach(() => {
  try { adapter.close(); } catch (_) { /* closed by the test */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const rows = () => adapter.sql.prepare('SELECT key, json FROM app_settings ORDER BY key').all().map((r) => [r.key, r.json]);

// ---- 1. the store ----------------------------------------------------------------

test('settings store: get() merges the defaults handed in at construction under the rows; update() writes only the touched keys; a fresh object per read', () => {
  const s = createSettingsStore(adapter, { defaults: DEFAULTS });
  assert.deepStrictEqual(s.get(), DEFAULTS, 'a fresh install reads the defaults');
  assert.deepStrictEqual(rows(), [], 'and holds no rows');
  s.update({ pruneMissing: false, cacheMaxAgeDays: 7 });
  assert.deepStrictEqual(rows(), [['cacheMaxAgeDays', '7'], ['pruneMissing', 'false']], 'one row per touched key, values verbatim');
  assert.deepStrictEqual(s.get(), { ...DEFAULTS, pruneMissing: false, cacheMaxAgeDays: 7 });
  assert.strictEqual(s.getKey('scanIntervalMinutes'), 30, 'a default reads through getKey');
  assert.strictEqual(s.getKey('pruneMissing'), false);
  assert.strictEqual(s.has('scanIntervalMinutes'), false, 'a default is not a row');
  const copy = s.get();
  copy.nested.a = 99;
  assert.strictEqual(s.get().nested.a, 1, 'a caller editing its copy cannot poison the next read');
  s.update({ cacheMaxAgeDays: undefined });
  assert.strictEqual(s.getKey('cacheMaxAgeDays'), undefined, 'undefined unsets the row');
  const noDefaults = createSettingsStore(adapter);
  assert.deepStrictEqual(noDefaults.get(), { pruneMissing: false }, 'no defaults handed in -> the rows only');
});

// ---- 2. the migration ------------------------------------------------------------

function rewindToV23(settingsJson) {
  adapter.close();
  const raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('DROP TABLE app_settings; PRAGMA user_version = 23');
  ensureLegacyDocTables(raw);
  if (settingsJson !== undefined) raw.prepare('INSERT INTO doc_single(name, json) VALUES(?, ?)').run('settings', settingsJson);
  raw.close();
}

function reopen(log) {
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: log || (() => {}) });
  return adapter;
}

test('migration v24: the doc row is split into one row per key (values verbatim), the doc row deleted, stamp 24, load() has no settings key, save() works', () => {
  assert.ok(SCHEMA_VERSION >= 24);
  const legacy = { scanIntervalMinutes: 60, pruneMissing: false, cacheMaxBytes: null, transcriptAiPrompts: [{ id: 'p1', text: 'Summarise' }], customLogoMimeLight: 'image/png' };
  rewindToV23(JSON.stringify(legacy));
  reopen();
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const s = createSettingsStore(adapter, { defaults: DEFAULTS });
  assert.deepStrictEqual(s.getRaw(), legacy, 'every key moved, values verbatim (null included)');
  assert.deepStrictEqual(s.get(), { ...DEFAULTS, ...legacy }, 'defaults fill what the legacy object never set');
  assert.strictEqual(countLegacyDocTables(adapter.sql), 0, 'the doc tables are gone (v33 - which refuses to drop a table that still holds a row, so every drain before it deleted its rows)');
  const db = adapter.load();
  assert.strictEqual(db.settings, undefined, 'no doc-model settings key');
  assert.doesNotThrow(() => adapter.save(db));
  assert.deepStrictEqual(s.getRaw(), legacy, 'a doc save never touches the table');
});

test('migration v24: no doc row -> an empty table; re-running is a no-op; a corrupt doc row rolls the whole block back to a re-runnable v23 (CREATE TABLE included)', () => {
  rewindToV23(undefined);
  reopen();
  assert.deepStrictEqual(rows(), []);
  // A second run over an already-migrated file: rows untouched.
  createSettingsStore(adapter).set('kept', 1);
  adapter.close();
  let raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('PRAGMA user_version = 23');
  ensureLegacyDocTables(raw);
  raw.close();
  reopen();
  assert.deepStrictEqual(rows(), [['kept', '1']], 'a re-run neither wipes nor duplicates');
  // The corrupt row.
  rewindToV23('{not json');
  assert.throws(() => new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }), /JSON|Unexpected/);
  raw = openRaw(path.join(dir, SQLITE_FILENAME));
  assert.strictEqual(raw.prepare('PRAGMA user_version').get().user_version, 23);
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM doc_single WHERE name = 'settings'").get().c, 1, 'the doc row untouched');
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 'app_settings'").get().c, 0, 'the table creation rolled back too');
  raw.prepare("UPDATE doc_single SET json = ? WHERE name = 'settings'").run(JSON.stringify({ pruneMissing: false }));
  raw.close();
  reopen();
  assert.deepStrictEqual(rows(), [['pruneMissing', 'false']], 'repaired and re-run');
});

test('migration v24: a non-object doc row is DROPPED with a log line (the defaults apply); a key failing the id rule is SKIPPED and logged', () => {
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    rewindToV23(JSON.stringify(['not', 'an', 'object']));
    reopen();
    assert.deepStrictEqual(rows(), []);
    assert.strictEqual(logged.filter((l) => l.includes('migration v24: the settings row was not an object')).length, 1, logged.join(' | '));
    logged.length = 0;
    // An unaddressable key: JSON.parse of '{"": 1}' is a legal object key.
    rewindToV23('{"": 1, "ok": 2}');
    reopen();
    assert.deepStrictEqual(rows(), [['ok', '2']], 'only the addressable key moved');
    assert.strictEqual(logged.filter((l) => l.includes('migration v24: skipping a settings key')).length, 1, logged.join(' | '));
  } finally {
    console.error = orig;
  }
  assert.strictEqual(countLegacyDocTables(adapter.sql), 0, 'the doc tables are gone (v33 - which refuses to drop a table that still holds a row, so every drain before it deleted its rows)');
});

// ---- 3. the save-lock -------------------------------------------------------------

test('save-lock: `settings` on the doc object is REFUSED', () => {
  assert.throws(() => adapter.save({ metadata: {}, settings: {} }), /unknown top-level db key 'settings'/);
  assert.throws(() => adapter.save({ metadata: {}, settings: { pruneMissing: true } }), /unknown top-level db key 'settings'/);
});

// ---- 4. the bulk seams ---------------------------------------------------------------

test('importParsedJson: routes `settings` through insertSetting (never doc_single); refuses without the handle / on a bad shape', () => {
  const settings = [];
  const h = { insertViewCount: () => {}, insertProgress: () => {}, insertTombstone: () => {}, insertTrash: () => {}, insertSetting: (k, v) => settings.push([k, v]) };
  const summary = importParsedJson({ folders: [], settings: { scanIntervalMinutes: 60, cacheMaxBytes: null, list: [1] } }, h);
  assert.deepStrictEqual(settings, [['scanIntervalMinutes', 60], ['cacheMaxBytes', null], ['list', [1]]]);
  assert.strictEqual(summary.settings, 3);
  const noHandle = { ...h };
  delete noHandle.insertSetting;
  assert.throws(() => importParsedJson({ settings: { a: 1 } }, noHandle), /no insertSetting handle/);
  assert.throws(() => importParsedJson({ settings: ['x'] }, h), /'settings' is not an object/);
  assert.throws(() => importParsedJson({ settings: { 'a\u0000b': 1 } }, h), /U\+0000/);
  assert.doesNotThrow(() => importParsedJson({ settings: {} }, noHandle), 'an empty object needs no handle');
});

test('exclusiveReplace: wipes the table, repopulates through insertSetting inside its transaction, rolls back whole on a bad row', () => {
  const s = createSettingsStore(adapter);
  s.set('old', 1);
  adapter.exclusiveReplace(() => {});
  assert.strictEqual(s.size(), 0, 'restore = the bundle and nothing else');
  adapter.exclusiveReplace((h) => { h.insertSetting('a', { deep: true }); });
  assert.deepStrictEqual(rows(), [['a', '{"deep":true}']]);
  assert.throws(() => adapter.exclusiveReplace((h) => { h.insertSetting('b', 1); h.insertSetting('c\u0000', 1); }), /U\+0000/);
  assert.deepStrictEqual(Object.keys(s.getRaw()), ['a'], 'rolled back whole');
  assert.throws(() => adapter.exclusiveReplace((h) => h.insertSetting('d', undefined)), /undefined/);
});

// ---- 5. the test read ------------------------------------------------------------------

test('readPersistedDatabase: surfaces the RAW rows as `settings` only when rows exist (no defaults - this is the on-disk truth)', () => {
  assert.deepStrictEqual(readPersistedDatabase(dir), {});
  const s = createSettingsStore(adapter, { defaults: DEFAULTS });
  s.set('pruneMissing', false);
  assert.deepStrictEqual(readPersistedDatabase(dir), { settings: { pruneMissing: false } });
  s.remove('pruneMissing');
  assert.deepStrictEqual(readPersistedDatabase(dir), {});
});

// ---- 6. source locks -----------------------------------------------------------------------

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

// Wave 7b (the monolith split, slice S10b): GET/POST /api/settings and the
// custom-logo routes - the only callers of settingsStore.update/remove/has -
// moved to lib/config/routes.js. The lock reads the route SURFACE (server.js
// PLUS every module the split carved out of it, derived from server.js's own
// requires) so it binds the same sentences wherever the slice put them; the
// negatives got STRONGER with it (they now sweep every extracted module too).
test('source lock: the route surface never names app_settings or the dead doc key in CODE and calls the store at every seam; the INSERT text stays in the shared kv definition', () => {
  const server = routeSurfaceSource((p) => stripComments(fs.readFileSync(p, 'utf8')), ROOT);
  assert.ok(!/app_settings/.test(server));
  assert.ok(!/\b(db|freshDb|fresh|current|state|next|prev|cached\w*|mdb|loaded|persisted|snapshot)\.settings\b/.test(server), 'no doc-model settings access survives (every holder name the doc object has worn)');
  assert.ok(!/(getCachedDatabase|loadDatabase)\(\)\.settings\b/.test(server), 'nor through the read cache / a fresh load');
  assert.ok(!/withDefaultSettings/.test(server), 'the load-time merge is gone (the store merges)');
  for (const call of ['settingsStore.get(', 'settingsStore.getKey(', 'settingsStore.set(', 'settingsStore.update(', 'settingsStore.remove(', 'settingsStore.has(']) {
    assert.ok(server.includes(call), `the route surface calls ${call}`);
  }
  // EXACT (the R2 gate's S5): existential, a moved writer could lose its ride while one
  // surviving site kept the lock green - four writers on the surface (three in
  // lib/config/routes.js, one in server.js).
  assert.strictEqual((server.match(/inSaveTransaction\(\(\) => settingsStore\.(set|update|remove)\(/g) || []).length, 4, 'every mutator\'s settings write rides the doc commit - four writers on the surface');
  const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '*.js'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean)
    .filter((p) => !p.startsWith('test/') && !/(^|\/)(vendor|node_modules)\//.test(p));
  const writers = tracked.filter((p) => /(INSERT\s+INTO|UPDATE)\s+(app_settings|\$\{settingsDef\.TABLE\})/.test(stripComments(fs.readFileSync(path.join(ROOT, p), 'utf8'))));
  assert.deepStrictEqual(writers, [], 'no literal INSERT for the table anywhere - the kv definition interpolates its own table name');
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'config', 'settings.js'), 'utf8');
  assert.match(src, /defineKvStore\(\{ label: 'settings', table: 'app_settings' \}\)/);
});

test('migration stamps ride their OWN commits: v24 lands and v25 fails -> the stamp is 24 (the settings rows kept, the doc row gone) - a <=v1.293 build refuses it instead of booting a partial database and defaulting the settings (adversarial pass A W1)', () => {
  adapter.close();
  let raw = openRaw(path.join(dir, SQLITE_FILENAME));
  raw.exec('DROP TABLE app_settings; DROP TABLE library_folders; DROP TABLE library_folder_settings; DROP TABLE channel_folder_display_names; DROP TABLE media_liked; PRAGMA user_version = 23');
  ensureLegacyDocTables(raw);
  const ins = raw.prepare('INSERT INTO doc_single(name, json) VALUES(?, ?)');
  ins.run('settings', JSON.stringify({ scanIntervalMinutes: 60, pruneMissing: false }));
  ins.run('folderSettings', '{not json'); // v25 will fail on this row
  raw.close();
  assert.throws(() => new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }), /JSON|Unexpected/);
  raw = openRaw(path.join(dir, SQLITE_FILENAME));
  assert.strictEqual(raw.prepare('PRAGMA user_version').get().user_version, 24, 'the stamp is the last COMMITTED floor, not the pre-migration one');
  assert.deepStrictEqual(raw.prepare('SELECT key, json FROM app_settings ORDER BY key').all().map((r) => [r.key, r.json]), [['pruneMissing', 'false'], ['scanIntervalMinutes', '60']], 'v24 committed its rows');
  assert.strictEqual(raw.prepare("SELECT COUNT(*) AS c FROM doc_single WHERE name = 'settings'").get().c, 0, 'and deleted the doc row (a re-run of v24 must not overwrite the rows with defaults)');
  raw.prepare("UPDATE doc_single SET json = '{}' WHERE name = 'folderSettings'").run();
  raw.close();
  reopen();
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'repaired: the remaining blocks run to the current version');
  assert.deepStrictEqual(createSettingsStore(adapter).getRaw(), { scanIntervalMinutes: 60, pruneMissing: false }, 'the settings survived the partial run intact');
});
