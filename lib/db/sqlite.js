'use strict';

// ---- SQLite persistence adapter (v1.42) ------------------------------------
//
// The ONLY module in this repo allowed to `require('node:sqlite')` — enforced
// by test/unit/db-sqlite-source-lock.test.js. node:sqlite is experimental on
// both project Node versions (v22.23.1, v24.14.0; re-verified 2026-07-17), so
// every API touch lives here: if the API shifts across a Node major, this is
// a one-file fix. The documented fallback trigger (exec plan §v1.42) is
// better-sqlite3.
//
// Design contract (docs/exec-plans/active/v1.42-multiuser-tranche.md):
// - The in-memory DB object shape, `updateDatabase`'s synchronous-mutator
//   mutex, and `saveDatabase`'s replace-by-reference cache-set all survive
//   unchanged in server.js; this module only swaps WHAT load/save do.
// - Collection namespaces persist as one row PER KEY (doc_kv), so a one-item
//   mutation writes one row, not the whole 175 KB. Small whole-array/object
//   namespaces persist as one row each (doc_single).
// - `save()` diffs per-row serialized JSON against a snapshot of the last
//   commit and writes only changed/inserted/deleted rows in ONE transaction.
// - The v1.43/v1.44 user tables are born complete (empty) in schema v1 so
//   later releases are additive `user_version` migrations, never restructures.
// - The module-level node:sqlite `backup()` API is deliberately NOT used
//   anywhere: empirically (2026-07-17, both binaries) it is unsafe under
//   concurrent same-process writes (silent 2-row snapshot of a 1002-row
//   source in one run; `ERR_SQLITE_ERROR: not an error` rejection in
//   another). The instance-backup bundle is SELECT-assembled instead.

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const SQLITE_FILENAME = 'filetube.db';

// Every persisted namespace, by storage bucket. THIS LIST IS A LOCK: `save()`
// throws on any db-object key outside it (see assertNoUnknownKeys) so a new
// namespace can never be silently dropped by the diff — adding one is a
// deliberate schema conversation (add it here + a test), exactly the posture
// the repo's other lock tests enforce. Classification per the exec plan's
// key census (drift re-verification 2026-07-17).
//
// doc_kv: mutated per-key in practice → one row per key.
//   - `books.audio`'s key is the BOOK id (one row per book holding that
//     book's spine map): mutation reality is per-(bookId, spineIndex) merges
//     plus whole-book deletes, so bookId is the write granularity (design
//     review F9).
//   - `viewCounts` is NEW in v1.42: the import extracts the one
//     non-rebuildable, clobber-prone field embedded in `metadata` items
//     (`viewCount`) into its own namespace (design finding #8 / review F4).
const DOC_KV_NAMESPACES = [
  'metadata',
  'progress',
  'deleteTombstones',
  'viewCounts',
  'books.items',
  'books.progress',
  'books.audio',
  'ytdlp.downloadMeta',
  'ytdlp.channelAvatars',
];

// doc_single: small arrays/objects mutated as wholes today → one row each.
const SINGLETON_NAMES = [
  'folders',
  'folderSettings',
  'settings',
  'liked',
  'books.folders',
  'books.settings',
  'books.pins',
  'ytdlp.subscriptions',
  'ytdlp.pins',
  'ytdlp.allowMembersOnly',
];

// The two container keys whose sub-keys the lists above enumerate. `save()`
// walks these to catch an unknown `db.books.X`/`db.ytdlp.X` the same way it
// catches an unknown top-level key.
const CONTAINER_KEYS = ['books', 'ytdlp'];

const KNOWN_TOP_LEVEL = new Set(
  [...DOC_KV_NAMESPACES, ...SINGLETON_NAMES]
    .map((p) => p.split('.')[0])
);
const KNOWN_SUBKEYS = new Map(CONTAINER_KEYS.map((c) => [
  c,
  new Set(
    [...DOC_KV_NAMESPACES, ...SINGLETON_NAMES]
      .filter((p) => p.startsWith(`${c}.`))
      .map((p) => p.split('.')[1])
  ),
]));

// ---- path helpers (namespace paths are at most `container.key` deep) ------

function getPath(obj, dotted) {
  const parts = dotted.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

// ---- schema ----------------------------------------------------------------

// Forward-only migration runner keyed on PRAGMA user_version. v1 creates
// everything v1.42 needs PLUS the v1.43/44 user tables (empty), per the plan:
// later releases only ADD (columns/tables/rows) at higher user_version — they
// never restructure what exists here.
const SCHEMA_VERSION = 1;

function migrateSchema(sql) {
  const current = sql.prepare('PRAGMA user_version').get().user_version;
  if (current >= SCHEMA_VERSION) return;
  if (current < 1) {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS doc_kv (
        namespace TEXT NOT NULL,
        key       TEXT NOT NULL,
        json      TEXT NOT NULL,
        PRIMARY KEY (namespace, key)
      );
      CREATE TABLE IF NOT EXISTS doc_single (
        name TEXT PRIMARY KEY,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT UNIQUE COLLATE NOCASE,
        display_name TEXT,
        password_hash TEXT,
        role TEXT CHECK(role IN ('admin','member')),
        can_manage_subscriptions INTEGER DEFAULT 0,
        settings_json TEXT DEFAULT '{}',
        token_version INTEGER DEFAULT 0,
        disabled INTEGER DEFAULT 0,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS user_progress (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_id TEXT NOT NULL,
        timestamp REAL,
        duration REAL,
        updated_at TEXT,
        PRIMARY KEY (user_id, media_id)
      );
      CREATE TABLE IF NOT EXISTS user_liked (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_id TEXT NOT NULL,
        liked_at TEXT,
        PRIMARY KEY (user_id, media_id)
      );
      CREATE TABLE IF NOT EXISTS user_book_progress (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        book_id TEXT NOT NULL,
        position_json TEXT NOT NULL,
        updated_at TEXT,
        PRIMARY KEY (user_id, book_id)
      );
      CREATE TABLE IF NOT EXISTS user_book_pins (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pin_id TEXT NOT NULL,
        pin_json TEXT NOT NULL,
        pin_order INTEGER,
        PRIMARY KEY (user_id, pin_id)
      );
      CREATE TABLE IF NOT EXISTS user_channel_pins (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pin_id TEXT NOT NULL,
        pin_json TEXT NOT NULL,
        pin_order INTEGER,
        PRIMARY KEY (user_id, pin_id)
      );
    `);
    sql.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
}

// WAL is persistent in the file. On a filesystem without shared-memory
// semantics (network FS) the pragma comes back non-'wal'; fall back to
// DELETE with one honest log line — DATA_DIR is expected to be local
// storage (exec plan, import step 6).
function applyJournalMode(sql, log) {
  const mode = sql.prepare('PRAGMA journal_mode = WAL').get().journal_mode;
  if (mode !== 'wal') {
    sql.exec('PRAGMA journal_mode = DELETE');
    if (log) log(`[db] WAL unavailable on this filesystem (got '${mode}'); using DELETE journal mode. DATA_DIR is expected to be local storage.`);
  }
  return mode;
}

function openConnection(dbPath) {
  const sql = new DatabaseSync(dbPath);
  sql.exec('PRAGMA foreign_keys = ON');
  return sql;
}

// ---- the adapter ------------------------------------------------------------

class SqliteAdapter {
  // `log` is injected (defaults to console.error to match server.js's own
  // logging posture) so tests can capture boot lines without spying globals.
  constructor(dbPath, { log = console.error } = {}) {
    this.dbPath = dbPath;
    this.log = log;
    this.sql = openConnection(dbPath);
    applyJournalMode(this.sql, log);
    migrateSchema(this.sql);
    // Prepared statements are created only AFTER migrations complete (design
    // review F8c) — preparing against pre-migration schema is a stale-handle
    // class.
    this.stmts = {
      allKv: this.sql.prepare('SELECT namespace, key, json FROM doc_kv'),
      allSingles: this.sql.prepare('SELECT name, json FROM doc_single'),
      upsertKv: this.sql.prepare('INSERT INTO doc_kv(namespace, key, json) VALUES(?, ?, ?) ON CONFLICT(namespace, key) DO UPDATE SET json = excluded.json'),
      deleteKv: this.sql.prepare('DELETE FROM doc_kv WHERE namespace = ? AND key = ?'),
      upsertSingle: this.sql.prepare('INSERT INTO doc_single(name, json) VALUES(?, ?) ON CONFLICT(name) DO UPDATE SET json = excluded.json'),
      deleteSingle: this.sql.prepare('DELETE FROM doc_single WHERE name = ?'),
    };
    this.inTransaction = false;
    // Per-row serialized-JSON snapshot of the LAST COMMIT. `save()` diffs
    // against it; it is rebuilt from disk here (open) and by
    // `exclusiveReplace` (restore). Keys: `kv <ns> <key>` and
    // `single <name>`.
    this.snapshot = new Map();
    this.rebuildSnapshotFromDisk();
  }

  rebuildSnapshotFromDisk() {
    this.snapshot.clear();
    for (const row of this.stmts.allKv.all()) {
      this.snapshot.set(`kv ${row.namespace} ${row.key}`, row.json);
    }
    for (const row of this.stmts.allSingles.all()) {
      this.snapshot.set(`single ${row.name}`, row.json);
    }
  }

  // Nested `BEGIN` throws in SQLite ("cannot start a transaction within a
  // transaction" — re-verified 2026-07-17 on both binaries), so the adapter
  // guards its own nesting explicitly for a clearer failure than SQLite's.
  begin() {
    if (this.inTransaction) {
      throw new Error('SqliteAdapter: re-entrant transaction (BEGIN inside BEGIN) — the write path must never nest');
    }
    this.sql.exec('BEGIN IMMEDIATE');
    this.inTransaction = true;
  }

  commit() {
    this.sql.exec('COMMIT');
    this.inTransaction = false;
  }

  rollback() {
    try {
      this.sql.exec('ROLLBACK');
    } finally {
      this.inTransaction = false;
    }
  }

  // Assemble the in-memory DB object from rows. Namespace ABSENCE is
  // preserved: a namespace with no row contributes nothing, so a DB imported
  // from a legacy-shape db.json assembles to the same partial object today's
  // JSON.parse would produce — and server.js's loadDatabase re-applies its
  // backfills verbatim on every load, exactly as it does for db.json (design
  // review F3: import raw, backfill at load).
  //
  // Documented normalization: an EMPTY doc_kv namespace ({}) has zero rows,
  // so empty and absent collapse at this layer. Observationally identical:
  // the top-level backfills and the lazy ensure* creators re-supply `{}`
  // before any consumer reads the namespace. AC1's fidelity check treats
  // this (alongside the viewCounts extraction) as the only permitted
  // transforms.
  load() {
    const db = {};
    for (const row of this.stmts.allSingles.all()) {
      setPath(db, row.name, JSON.parse(row.json));
    }
    const nsObjs = new Map();
    for (const row of this.stmts.allKv.all()) {
      let obj = nsObjs.get(row.namespace);
      if (!obj) {
        obj = {};
        nsObjs.set(row.namespace, obj);
        setPath(db, row.namespace, obj);
      }
      obj[row.key] = JSON.parse(row.json);
    }
    return db;
  }

  // The unknown-key lock: a mutator that grows a namespace this adapter
  // doesn't know about must FAIL the write loudly, not have its data
  // silently dropped by the diff. (Silent partial persistence is the
  // 5-strike persist-gate class in its most dangerous costume.)
  assertNoUnknownKeys(db) {
    for (const key of Object.keys(db)) {
      if (!KNOWN_TOP_LEVEL.has(key)) {
        throw new Error(`SqliteAdapter: unknown top-level db key '${key}' — add it to the schema map in lib/db/sqlite.js (deliberately, with a test) before persisting it`);
      }
      const subs = KNOWN_SUBKEYS.get(key);
      if (subs && db[key] != null && typeof db[key] === 'object') {
        for (const sub of Object.keys(db[key])) {
          if (!subs.has(sub)) {
            throw new Error(`SqliteAdapter: unknown db key '${key}.${sub}' — add it to the schema map in lib/db/sqlite.js (deliberately, with a test) before persisting it`);
          }
        }
      }
    }
  }

  // Diff-save: serialize every present row, write only what changed, delete
  // what disappeared, in ONE transaction. Returns write accounting for
  // tests/AC5. Synchronous throughout — the caller (server.js saveDatabase)
  // keeps its single-tick critical-section contract.
  save(db) {
    this.assertNoUnknownKeys(db);
    const writes = [];   // [kind, ns/name, key?, json]
    const deletes = [];  // [kind, ns/name, key?]
    const seen = new Set();

    for (const name of SINGLETON_NAMES) {
      const value = getPath(db, name);
      if (value === undefined) continue; // absent namespace: rows (if any) handled via `seen` sweep below
      const snapKey = `single ${name}`;
      seen.add(snapKey);
      const json = JSON.stringify(value);
      if (this.snapshot.get(snapKey) !== json) writes.push(['single', name, null, json]);
    }
    for (const ns of DOC_KV_NAMESPACES) {
      const obj = getPath(db, ns);
      if (obj === undefined || obj === null) continue;
      for (const key of Object.keys(obj)) {
        const snapKey = `kv ${ns} ${key}`;
        seen.add(snapKey);
        const json = JSON.stringify(obj[key]);
        if (this.snapshot.get(snapKey) !== json) writes.push(['kv', ns, key, json]);
      }
    }
    // Anything in the last commit that the current object no longer carries
    // is a delete — EXCEPT rows of a namespace that is absent-as-a-whole
    // (undefined, e.g. `books` never ensured this boot): absence means "not
    // loaded/ensured", not "deleted". A namespace present-but-empty ({})
    // DOES delete its stale rows.
    for (const snapKey of this.snapshot.keys()) {
      if (seen.has(snapKey)) continue;
      const parts = snapKey.split(' ');
      if (parts[0] === 'single') {
        if (getPath(db, parts[1]) === undefined) continue;
        deletes.push(['single', parts[1], null]);
      } else {
        const nsVal = getPath(db, parts[1]);
        if (nsVal === undefined || nsVal === null) continue;
        deletes.push(['kv', parts[1], parts[2]]);
      }
    }

    if (writes.length === 0 && deletes.length === 0) {
      return { rowsWritten: 0, rowsDeleted: 0 };
    }

    this.begin();
    try {
      for (const [kind, name, key, json] of writes) {
        if (kind === 'single') this.stmts.upsertSingle.run(name, json);
        else this.stmts.upsertKv.run(name, key, json);
      }
      for (const [kind, name, key] of deletes) {
        if (kind === 'single') this.stmts.deleteSingle.run(name);
        else this.stmts.deleteKv.run(name, key);
      }
      this.commit();
    } catch (err) {
      this.rollback();
      throw err;
    }
    // Snapshot advances only after a successful COMMIT, so a failed save
    // leaves the diff base pointing at what is actually on disk.
    for (const [kind, name, key, json] of writes) {
      this.snapshot.set(kind === 'single' ? `single ${name}` : `kv ${name} ${key}`, json);
    }
    for (const [kind, name, key] of deletes) {
      this.snapshot.delete(kind === 'single' ? `single ${name}` : `kv ${name} ${key}`);
    }
    return { rowsWritten: writes.length, rowsDeleted: deletes.length };
  }

  // Restore path (instance-bundle restore): wipe-and-replace inside ONE
  // transaction via a caller-provided populate function, then rebuild the
  // snapshot from disk so the diff base can never lie about what the last
  // commit contained (exec plan: "the write accounting would lie
  // otherwise"). The CALLER owns the surrounding coherency work — clearing
  // the progress coalescers and invalidating dbCache (design review F5).
  exclusiveReplace(populateFn) {
    this.begin();
    try {
      this.sql.exec('DELETE FROM doc_kv');
      this.sql.exec('DELETE FROM doc_single');
      populateFn({
        insertKv: (ns, key, value) => {
          if (!DOC_KV_NAMESPACES.includes(ns)) throw new Error(`exclusiveReplace: unknown doc_kv namespace '${ns}'`);
          this.stmts.upsertKv.run(ns, key, JSON.stringify(value));
        },
        insertSingle: (name, value) => {
          if (!SINGLETON_NAMES.includes(name)) throw new Error(`exclusiveReplace: unknown singleton '${name}'`);
          this.stmts.upsertSingle.run(name, JSON.stringify(value));
        },
      });
      this.commit();
    } catch (err) {
      this.rollback();
      throw err;
    }
    this.rebuildSnapshotFromDisk();
  }

  close() {
    this.sql.close();
  }
}

// ---- boot: open / import / fresh (exec plan boot order, reviews F1-F3) -----

// Strict import-time classifier: which source top-level keys map where.
// Unknown keys in the SOURCE abort the import (never silently dropped — a
// source written by a NEWER FileTube than this binary must not lose data
// through a lossy import; the operator sees the key name and can sort out
// the version mismatch). Two callers, one classification (no drift):
//   - the boot-time db.json import (source: 'db.json' — a legacy source can
//     never carry a `viewCounts` namespace; it is synthesized here by the
//     extraction)
//   - the instance-bundle restore (source: 'bundle' — the bundle DOES carry
//     `viewCounts` as a first-class namespace and it must round-trip)
function importParsedJson(parsed, handles, { source = 'db.json' } = {}) {
  const { insertKv, insertSingle } = handles;
  const summary = {};
  const count = (ns, n) => { summary[ns] = (summary[ns] || 0) + n; };

  for (const key of Object.keys(parsed)) {
    if (!KNOWN_TOP_LEVEL.has(key)) {
      throw new Error(`import: db.json contains unknown top-level key '${key}' — refusing a lossy import (was this file written by a newer FileTube?)`);
    }
  }
  for (const container of CONTAINER_KEYS) {
    const obj = parsed[container];
    if (obj == null) continue;
    if (typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error(`import: db.json key '${container}' is not an object`);
    }
    for (const sub of Object.keys(obj)) {
      if (!KNOWN_SUBKEYS.get(container).has(sub)) {
        throw new Error(`import: db.json contains unknown key '${container}.${sub}' — refusing a lossy import (was this file written by a newer FileTube?)`);
      }
    }
  }

  for (const name of SINGLETON_NAMES) {
    const value = getPath(parsed, name);
    if (value === undefined) continue;
    insertSingle(name, value);
    count(name, 1);
  }
  for (const ns of DOC_KV_NAMESPACES) {
    // db.json sources never carry viewCounts (synthesized by the metadata
    // extraction below); bundle sources carry it first-class.
    if (ns === 'viewCounts' && source === 'db.json') continue;
    const obj = getPath(parsed, ns);
    if (obj === undefined || obj === null) continue;
    if (ns === 'metadata') {
      // The one documented transform (design finding #8 / review F4):
      // `metadata[id].viewCount` is EXTRACTED into its own `viewCounts`
      // namespace — it is the single non-rebuildable field embedded in a
      // rebuildable namespace, and in place it is demonstrably clobber-prone
      // (the scan's Phase-2 merge and changed-file re-init both drop it).
      // Items are stored WITHOUT the field; view counts live per-id in
      // `viewCounts`. Everything else on an item migrates verbatim.
      let extracted = 0;
      for (const id of Object.keys(obj)) {
        const item = obj[id];
        if (item != null && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'viewCount')) {
          const { viewCount, ...rest } = item;
          if (typeof viewCount === 'number' && Number.isFinite(viewCount) && viewCount > 0) {
            insertKv('viewCounts', id, viewCount);
            extracted++;
          }
          insertKv('metadata', id, rest);
        } else {
          insertKv('metadata', id, item);
        }
      }
      count('metadata', Object.keys(obj).length);
      if (extracted) count('viewCounts', extracted);
    } else {
      for (const key of Object.keys(obj)) insertKv(ns, key, obj[key]);
      count(ns, Object.keys(obj).length);
    }
  }
  return summary;
}

// The WAL-safe import sequence (design review finding #1, re-proven
// empirically 2026-07-17: renaming a WAL db without a clean close leaves a
// file that fails to open outright with 'disk I/O error' — the -wal/-shm
// sidecars keep the tmp name across the rename). Steps:
//   1. unlink leftover tmp + sidecars from a prior crashed import
//   2. create/import into <db>.tmp inside one transaction, COMMIT
//   3. close() — checkpoints and removes the sidecars
//   4. fsync the tmp file fd
//   5. renameSync(tmp, final)
// Journal mode is set on the tmp before the clean close (persistent in the
// file; safe because step 3 checkpoints).
function importDbJson(jsonPath, dbPath, { log = console.error } = {}) {
  // STRICT parse — deliberately NOT loadDatabase's reset-to-fresh recovery
  // (design review F2 — CRITICAL): an importer that inherited that recovery
  // would commit a valid EMPTY filetube.db once, and the boot order would
  // then ignore the intact db.json forever. A parse failure here must abort
  // boot loudly, creating NOTHING, so the next boot retries the import.
  const raw = fs.readFileSync(jsonPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`FATAL: ${jsonPath} exists but is not parseable JSON (${err.message}). Refusing to create ${path.basename(dbPath)} — fix or move db.json and reboot; it has NOT been modified.`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`FATAL: ${jsonPath} does not contain a JSON object. Refusing to create ${path.basename(dbPath)}; db.json has NOT been modified.`);
  }

  const tmpPath = `${dbPath}.tmp`;
  for (const leftover of [tmpPath, `${tmpPath}-wal`, `${tmpPath}-shm`]) {
    try { fs.unlinkSync(leftover); } catch { /* ENOENT is the normal case */ }
  }

  const tmpSql = openConnection(tmpPath);
  let summary;
  try {
    applyJournalMode(tmpSql, log);
    migrateSchema(tmpSql);
    const insertKvStmt = tmpSql.prepare('INSERT INTO doc_kv(namespace, key, json) VALUES(?, ?, ?)');
    const insertSingleStmt = tmpSql.prepare('INSERT INTO doc_single(name, json) VALUES(?, ?)');
    tmpSql.exec('BEGIN IMMEDIATE');
    try {
      summary = importParsedJson(parsed, {
        insertKv: (ns, key, value) => insertKvStmt.run(ns, key, JSON.stringify(value)),
        insertSingle: (name, value) => insertSingleStmt.run(name, JSON.stringify(value)),
      });
      tmpSql.exec('COMMIT');
    } catch (err) {
      tmpSql.exec('ROLLBACK');
      throw err;
    }
  } finally {
    tmpSql.close(); // checkpoints WAL + removes -wal/-shm sidecars
  }

  const fd = fs.openSync(tmpPath, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, dbPath);
  return summary;
}

// Fingerprint check for boot rule #1's loud warning (design review F2): a
// schema-current but row-empty filetube.db sitting beside a non-empty
// db.json is the signature of a stranded import (or an aborted manual copy —
// a 0-byte file opens as a valid empty SQLite DB).
function isSchemaEmpty(sql) {
  const kv = sql.prepare('SELECT COUNT(*) AS c FROM doc_kv').get().c;
  const single = sql.prepare('SELECT COUNT(*) AS c FROM doc_single').get().c;
  const users = sql.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  return kv === 0 && single === 0 && users === 0;
}

// Boot orchestration (exec plan "Migration (boot order)"):
//   1. filetube.db exists → use it (+ the ignored-db.json line / the
//      stranded-import warning)
//   2. else db.json exists → WAL-safe import, then open
//   3. else → fresh empty schema
function openAdapter(dataDir, { log = console.error } = {}) {
  const dbPath = path.join(dataDir, SQLITE_FILENAME);
  const jsonPath = path.join(dataDir, 'db.json');
  const dbExists = fs.existsSync(dbPath);
  const jsonExists = fs.existsSync(jsonPath);
  let importSummary = null;

  if (!dbExists && jsonExists) {
    importSummary = importDbJson(jsonPath, dbPath, { log });
    log(`[db] Imported db.json into ${SQLITE_FILENAME}: ${
      Object.entries(importSummary).map(([k, v]) => `${k}=${v}`).join(', ') || 'empty'
    }. db.json is untouched and now ignored (it belongs to any old-tag instance).`);
  }

  const adapter = new SqliteAdapter(dbPath, { log });

  if (dbExists && jsonExists) {
    if (isSchemaEmpty(adapter.sql) && fs.statSync(jsonPath).size > 2) {
      log(`[db] WARNING: ${SQLITE_FILENAME} exists but is EMPTY while a non-empty db.json sits beside it. This is the fingerprint of a stranded import or an aborted copy. If this instance should own db.json's data, stop the server, delete ${SQLITE_FILENAME} (and its -wal/-shm sidecars), and reboot to re-import.`);
    } else {
      log(`[db] ${SQLITE_FILENAME} in use; db.json is present and ignored (it belongs to any old-tag instance).`);
    }
  }

  return { adapter, importSummary };
}

// Test helper (exec plan "test migration plan"): the one sanctioned way for
// tests to read persisted state — replaces every raw
// `JSON.parse(fs.readFileSync(DB_FILE))` across the 43 direct-I/O test
// files. Opens its OWN read-only connection (not the adapter's — AC5's
// verification explicitly distrusts the adapter's accounting), assembles,
// closes.
function readPersistedDatabase(dataDir) {
  const dbPath = path.join(dataDir, SQLITE_FILENAME);
  const sql = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const db = {};
    for (const row of sql.prepare('SELECT name, json FROM doc_single').all()) {
      setPath(db, row.name, JSON.parse(row.json));
    }
    const nsObjs = new Map();
    for (const row of sql.prepare('SELECT namespace, key, json FROM doc_kv').all()) {
      let obj = nsObjs.get(row.namespace);
      if (!obj) {
        obj = {};
        nsObjs.set(row.namespace, obj);
        setPath(db, row.namespace, obj);
      }
      obj[row.key] = JSON.parse(row.json);
    }
    return db;
  } finally {
    sql.close();
  }
}

module.exports = {
  SQLITE_FILENAME,
  DOC_KV_NAMESPACES,
  SINGLETON_NAMES,
  SqliteAdapter,
  openAdapter,
  importDbJson,
  readPersistedDatabase,
  // exported for direct unit coverage of the import classifier
  importParsedJson,
};
