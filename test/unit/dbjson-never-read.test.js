'use strict';

// [UNIT] Wave 7 of the relational-migration arc (2026-09-14) - the legacy
// db.json file is INVISIBLE to boot. Wave 0 bound "when filetube.db exists its
// CONTENT is never read" while boot rule 2 (the one-time import when
// filetube.db is absent) stayed as the arc's rollback net; Wave 7 removed rule
// 2 with the document model (docs/exec-plans/active/2026-09-13-sqlite-
// relational-migration.md, Wave 7), so this file now proves the stronger
// claim on BOTH arms: with or without filetube.db, openAdapter never names,
// probes or reads a file called db.json - and the DoD's source lock: no
// shipped JavaScript spells the name at all.
//
// Binding, not prose: an in-process spy on every fs content-reader AND every
// metadata probe records any call aimed at a path named db.json, and the file
// beside filetube.db is deliberately NOT JSON - so a read of it by the old
// importer would have been FATAL. The spy is proven live inside the very run
// that relies on it: a control read of the same file through the spied fs is
// recorded.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const { SQLITE_FILENAME, SqliteAdapter, openAdapter, SCHEMA_VERSION } = require('../../lib/db/sqlite');

const ROOT = path.join(__dirname, '..', '..');
let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dbjson-never-read-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const dbPath = () => path.join(dir, SQLITE_FILENAME);
const jsonPath = () => path.join(dir, 'db.json');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const GARBAGE = '{ this is not JSON - a read of me would have been FATAL by design';
const SEED = { metadata: { vid1: { title: 'seeded item' }, marker: { title: 'seeded marker' } } };

function seedSqlite(db) {
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try { if (db) a.save(db); } finally { a.close(); }
}

// Wrap every fs entry point that yields file CONTENT (sync, callback, promise,
// stream) AND every copy that could smuggle the bytes to another name (the
// Wave 0 slim gate's mutant: copyFileSync to a tmp, then read the tmp), plus
// the metadata probes (existsSync / statSync / accessSync - the old boot rule
// used the first two), recording calls aimed at db.json.
function withFsSpy(run) {
  const reads = [];
  const probes = [];
  const isDbJson = (p) => {
    try { return path.basename(typeof p === 'string' ? p : String(p)) === 'db.json'; } catch (_) { return false; }
  };
  const patch = (obj, name, bucket) => {
    const orig = obj[name];
    obj[name] = function (p, ...rest) {
      if (isDbJson(p)) bucket.push(name);
      return orig.call(this, p, ...rest);
    };
    return () => { obj[name] = orig; };
  };
  const restores = [];
  for (const name of ['readFileSync', 'readFile', 'openSync', 'open', 'createReadStream', 'copyFileSync', 'copyFile', 'renameSync', 'rename']) {
    if (typeof fs[name] === 'function') restores.push(patch(fs, name, reads));
  }
  for (const name of ['readFile', 'open', 'copyFile', 'rename']) {
    if (fs.promises && typeof fs.promises[name] === 'function') restores.push(patch(fs.promises, name, reads));
  }
  for (const name of ['existsSync', 'statSync', 'lstatSync', 'accessSync']) {
    restores.push(patch(fs, name, probes));
  }
  try {
    return { result: run(), reads, probes };
  } finally {
    for (const restore of restores) restore();
  }
}

test('control: the spy is live - a read and a probe of db.json through the spied fs are recorded', () => {
  fs.writeFileSync(jsonPath(), GARBAGE, 'utf8');
  const { reads, probes } = withFsSpy(() => { fs.existsSync(jsonPath()); return fs.readFileSync(jsonPath(), 'utf8'); });
  assert.deepStrictEqual(reads, ['readFileSync']);
  assert.deepStrictEqual(probes, ['existsSync']);
});

test('filetube.db present + a NON-JSON db.json beside it -> boots from SQLite; db.json is never read, never probed, bytes untouched', () => {
  seedSqlite(SEED);
  fs.writeFileSync(jsonPath(), GARBAGE, 'utf8');
  const before = sha(jsonPath());
  const lines = [];

  const { result, reads, probes } = withFsSpy(() => openAdapter(dir, { log: (m) => lines.push(m) }));
  try {
    assert.deepStrictEqual(reads, [], `db.json content was read via: ${reads.join(', ')}`);
    assert.deepStrictEqual(probes, [], `db.json was probed via: ${probes.join(', ')} (Wave 7: boot does not even look for it)`);
    assert.deepStrictEqual(lines.filter((l) => /db\.json|import|stranded|ignored/i.test(l)), [], 'no boot line mentions a legacy file');
    const loaded = result.adapter.load();
    assert.deepStrictEqual(loaded.metadata.marker, SEED.metadata.marker, 'state comes from filetube.db, not the file beside it');
    assert.strictEqual(loaded.metadata.vid1.title, 'seeded item');
  } finally {
    result.adapter.close();
  }
  assert.strictEqual(sha(jsonPath()), before, 'db.json is byte-identical after boot');
});

test('NO filetube.db + a NON-JSON db.json -> a FRESH empty schema (never an import, never a throw); db.json never read, never probed, bytes untouched', () => {
  fs.writeFileSync(jsonPath(), GARBAGE, 'utf8');
  const before = sha(jsonPath());

  const { result, reads, probes } = withFsSpy(() => openAdapter(dir, { log: () => {} }));
  try {
    assert.deepStrictEqual(reads, [], `db.json content was read via: ${reads.join(', ')}`);
    assert.deepStrictEqual(probes, [], `db.json was probed via: ${probes.join(', ')}`);
    assert.deepStrictEqual(result.adapter.load(), {}, 'a fresh empty library - the legacy file is not a seed any more');
    assert.strictEqual(result.adapter.sql.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  } finally {
    result.adapter.close();
  }
  assert.ok(fs.existsSync(dbPath()), 'filetube.db was created');
  assert.strictEqual(sha(jsonPath()), before, 'the garbage file is untouched');
});

test('a VALID legacy db.json without filetube.db is NOT imported either (the rollback net is gone - the documented upgrade path is a v1.42-v1.295 boot first)', () => {
  fs.writeFileSync(jsonPath(), JSON.stringify(SEED), 'utf8');
  const { result, reads } = withFsSpy(() => openAdapter(dir, { log: () => {} }));
  try {
    assert.deepStrictEqual(reads, []);
    assert.deepStrictEqual(result.adapter.load(), {}, 'nothing was imported');
  } finally {
    result.adapter.close();
  }
});

// ---- the source locks -----------------------------------------------------------
//
// The DoD of the arc: "no shipped code references db.json". Bound here on
// the same file set scripts/relational-arc-baseline.js measures (every
// tracked .js outside test/ and vendor/, minus the baseline instrument
// itself, whose labels name the metric). A comment counts: the point is
// that nothing in the shipped tree - code OR prose - keeps the legacy file
// alive as a concept a future change could reach for.

test('DoD: no shipped JavaScript names db.json (code or comment); server.js boots through openAdapter exactly once and has no DB_FILE', () => {
  const shipped = execFileSync('git', ['ls-files', '*.js'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
    .filter((p) => !/(^|\/)(vendor|node_modules)\//.test(p) && !p.startsWith('test/') && p !== 'scripts/relational-arc-baseline.js');
  assert.ok(shipped.length > 50, `sanity: the shipped set is real (${shipped.length} files)`);
  assert.ok(shipped.includes('server.js') && shipped.includes('lib/db/sqlite.js'), 'sanity: the two files that carried the import path are in the set');
  const offenders = shipped.filter((p) => /db\.json/.test(fs.readFileSync(path.join(ROOT, p), 'utf8')));
  assert.deepStrictEqual(offenders, [], 'shipped files that still name the legacy file');

  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.strictEqual((src.match(/sqliteDb\.openAdapter\(/g) || []).length, 1, 'boot opens the store through openAdapter exactly once');
  assert.ok(!/\bDB_FILE\b/.test(src), 'the DB_FILE constant (the last server-side spelling of the legacy path) is gone');
  assert.ok(!/cleanupOrphanDbTmp/.test(src), 'the pre-v1.42 orphan-tmp sweep is gone with it');
});
