'use strict';

// [UNIT] Wave 0 of the relational-migration arc (2026-09-13) - db.json is a
// one-time import SEED, never a live store: when filetube.db exists its
// CONTENT is never read (docs/exec-plans/active/2026-09-13-sqlite-relational-
// migration.md, Section 0 + Wave 0). The import path itself (boot rule 2) is
// the arc's rollback net and is scheduled for removal in Wave 7; until then
// this file proves BOTH halves: rule 1 never reads the file, rule 2 still can.
//
// Binding, not prose: an in-process spy on every fs content-reader records
// any call aimed at a path named db.json, and the file beside filetube.db is
// deliberately NOT JSON - so a read would have been FATAL (importDbJson's
// strict parse), which the positive-control tests prove by letting it happen.
// The spy is proven live inside the very run it guards: the existence probe
// openAdapter makes (fs.existsSync) is recorded by the same spy.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { SQLITE_FILENAME, SqliteAdapter, openAdapter } = require('../../lib/db/sqlite');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dbjson-never-read-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const dbPath = () => path.join(dir, SQLITE_FILENAME);
const jsonPath = () => path.join(dir, 'db.json');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const GARBAGE = '{ this is not JSON - a read of me is FATAL by design';
const SEED = { folders: ['/media/seeded'], settings: { theme: 'seeded' }, metadata: { vid1: { title: 'seeded item' } } };

// `null` seeds a schema-current, row-empty filetube.db (open + close only).
function seedSqlite(db) {
  const a = new SqliteAdapter(dbPath(), { log: () => {} });
  try { if (db) a.save(db); } finally { a.close(); }
}

// Wrap every fs entry point that yields file CONTENT (sync, callback, promise,
// stream) AND every copy that could smuggle the bytes to another name (the
// slim gate's mutant: copyFileSync to a tmp, then read the tmp), plus the two
// metadata probes, recording calls aimed at db.json.
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
  const restores = [
    patch(fs, 'readFileSync', reads),
    patch(fs, 'openSync', reads),
    patch(fs, 'createReadStream', reads),
    patch(fs, 'readFile', reads),
    patch(fs, 'open', reads),
    patch(fs.promises, 'readFile', reads),
    patch(fs.promises, 'open', reads),
    patch(fs, 'copyFileSync', reads),
    patch(fs, 'copyFile', reads),
    patch(fs, 'cpSync', reads),
    patch(fs, 'cp', reads),
    patch(fs.promises, 'copyFile', reads),
    patch(fs.promises, 'cp', reads),
    ...(typeof fs.openAsBlob === 'function' ? [patch(fs, 'openAsBlob', reads)] : []),
    patch(fs, 'existsSync', probes),
    patch(fs, 'statSync', probes),
  ];
  try {
    return { result: run(), reads, probes };
  } finally {
    for (const restore of restores) restore();
  }
}

test('rule 1: filetube.db present (non-empty) + a NON-JSON db.json beside it -> boots from SQLite, db.json content never read, bytes untouched', () => {
  seedSqlite(SEED);
  fs.writeFileSync(jsonPath(), GARBAGE, 'utf8');
  const before = sha(jsonPath());
  const lines = [];

  const { result, reads, probes } = withFsSpy(() => openAdapter(dir, { log: (m) => lines.push(m) }));
  try {
    assert.strictEqual(result.importSummary, null, 'no import happened');
    assert.deepStrictEqual(reads, [], `db.json content was read via: ${reads.join(', ')}`);
    assert.ok(probes.includes('existsSync'), 'the spy is live: the existence probe on db.json was observed in this run');
    assert.ok(lines.some((l) => l.includes('db.json is present and ignored')), 'the ignored line is logged');
    const loaded = result.adapter.load();
    assert.deepStrictEqual(loaded.folders, SEED.folders, 'state comes from filetube.db, not the file beside it');
    assert.deepStrictEqual(loaded.settings, SEED.settings);
    assert.strictEqual(loaded.metadata.vid1.title, 'seeded item');
  } finally {
    result.adapter.close();
  }
  assert.strictEqual(sha(jsonPath()), before, 'db.json is byte-identical after boot');
});

test('rule 1 (stranded fingerprint arm): an EMPTY filetube.db beside a non-JSON db.json -> warns by SIZE only, content still never read', () => {
  seedSqlite(null); // schema-current, row-empty
  fs.writeFileSync(jsonPath(), GARBAGE, 'utf8');
  const lines = [];

  const { result, reads, probes } = withFsSpy(() => openAdapter(dir, { log: (m) => lines.push(m) }));
  result.adapter.close();
  assert.strictEqual(result.importSummary, null);
  assert.deepStrictEqual(reads, [], `db.json content was read via: ${reads.join(', ')}`);
  assert.ok(probes.includes('statSync'), 'the fingerprint arm looks at the size (a metadata probe), which the spy observed');
  assert.ok(lines.some((l) => l.includes('stranded import')), 'the stranded-import warning is the only reaction');
});

test('positive control A: WITHOUT filetube.db the same garbage IS read and aborts boot FATALLY, creating nothing', () => {
  fs.writeFileSync(jsonPath(), GARBAGE, 'utf8');
  const before = sha(jsonPath());

  const { reads } = withFsSpy(() => {
    assert.throws(() => openAdapter(dir, { log: () => {} }), /FATAL: .*not parseable JSON/);
  });
  assert.ok(reads.includes('readFileSync'), `the spy sees the import read (got: ${reads.join(', ') || 'nothing'})`);
  assert.ok(!fs.existsSync(dbPath()), 'no filetube.db was created by the aborted import');
  assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.startsWith(SQLITE_FILENAME)), [], 'no tmp/sidecar either');
  assert.strictEqual(sha(jsonPath()), before, 'the garbage file is untouched');
});

test('positive control B: the rollback net still works - WITHOUT filetube.db a valid db.json is imported once, then ignored on the next boot', () => {
  fs.writeFileSync(jsonPath(), JSON.stringify(SEED), 'utf8');

  const first = withFsSpy(() => openAdapter(dir, { log: () => {} }));
  first.result.adapter.close();
  assert.ok(first.result.importSummary, 'first boot imports');
  assert.ok(first.reads.includes('readFileSync'), 'the import read is observed');

  // Now corrupt the seed file: the second boot must not care.
  fs.writeFileSync(jsonPath(), GARBAGE, 'utf8');
  const second = withFsSpy(() => openAdapter(dir, { log: () => {} }));
  try {
    assert.strictEqual(second.result.importSummary, null, 'no re-import');
    assert.deepStrictEqual(second.reads, [], 'second boot never reads db.json');
    assert.deepStrictEqual(second.result.adapter.load().folders, SEED.folders, 'the imported state is what boots');
  } finally {
    second.result.adapter.close();
  }
});

// ---- server.js seam lock: the server has no reader of db.json ----------------
//
// server.js keeps a DB_FILE constant for the legacy tmp-file sweep only
// (cleanupOrphanDbTmp matches `db.json.<pid>.<seq>.tmp` NAMES). Every CODE
// mention of DB_FILE must be one of those two shapes (comment lines are
// skipped - a prose mention is not a reader); a new reader of the file fails
// here before it can ship. Boot goes through openAdapter exactly once. This
// is a SOURCE lock: an indirect spelling (`'db' + '.json'`) evades it, which
// is why the fs-spy tests above bind the behaviour at the adapter seam, and
// why Wave 7 (removing rule 2) owes an integration boot of server.js itself
// with garbage db.json beside filetube.db (slim gate SUGGESTION 7).

test('server.js: DB_FILE is defined once and only ever used for the tmp-sweep basename; boot calls openAdapter exactly once and never importDbJson', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  const lines = src.split('\n');
  const mentions = lines.map((l, i) => ({ n: i + 1, l }))
    .filter(({ l }) => !/^\s*\/\//.test(l) && /\bDB_FILE\b/.test(l));
  const definition = mentions.filter(({ l }) => /^const DB_FILE = path\.join\(DATA_DIR, 'db\.json'\);$/.test(l));
  const basenameUse = mentions.filter(({ l }) => /path\.basename\(DB_FILE\)/.test(l));
  assert.strictEqual(definition.length, 1, 'DB_FILE is defined exactly once');
  const stray = mentions.filter((m) => !definition.includes(m) && !basenameUse.includes(m));
  assert.deepStrictEqual(stray.map((m) => `${m.n}: ${m.l.trim()}`), [],
    'server.js gained a NEW use of DB_FILE - db.json is a one-time import seed, the server never reads it');

  const openCalls = src.match(/sqliteDb\.openAdapter\(/g) || [];
  assert.strictEqual(openCalls.length, 1, 'boot opens the store through openAdapter exactly once');
  assert.ok(!/importDbJson\(/.test(src), 'server.js never calls the importer directly - only openAdapter rule 2 may');
  assert.ok(!/readFileSync\([^)]*db\.json/.test(src) && !/JSON\.parse\([^)]*DB_FILE/.test(src),
    'no direct db.json read in server.js');
});
