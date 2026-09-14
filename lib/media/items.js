'use strict';

// ---- the media index: `media_items` (media_id, json) - the LAST namespace to
// leave the document model (Wave 6 of the relational-migration arc,
// docs/exec-plans/active/2026-09-13-sqlite-relational-migration.md) --------
//
// `metadata` is the library index: one record per indexed file, keyed by the
// media id (md5 of the path), written by the scan's final merge in the
// thousands per pass and read by every listing route. It rode `doc_kv` as the
// namespace 'metadata' from v1.42 to v1.294. This module owns its table now.
//
// What deliberately did NOT change (the persist-gate discipline - the class
// this repo has been bitten by five times lives in the mega-object's
// carry-forward and merge seams, and Wave 6 moves STORAGE, not those seams):
//   - the routes keep reading the index as the `{ metadata }` object
//     `loadDatabase()` / `getCachedDatabase()` hand them (the adapter's
//     `load()` assembles it from this table), and the mutators keep writing
//     `db.metadata[id] = item` / `delete db.metadata[id]` inside an
//     `updateDatabase` tick - the adapter's `save()` hands the object's
//     `metadata` to `planDiff` / `applyPlan` / `advancePlan` below;
//   - the write is the same PER-ROW DIFF the adapter did for doc_kv: the
//     serialized JSON of every id is compared against the last commit's
//     snapshot, changed rows are upserted, vanished ids deleted, in ONE
//     transaction with every `inSaveTransaction` effect; the snapshot advances
//     only after COMMIT (a failed save leaves the diff base honest);
//   - an ABSENT `metadata` key means "not loaded", never "deleted" (rows
//     kept); a PRESENT-but-empty map deletes every row; an `undefined` value
//     is dropped exactly as JSON.stringify dropped it from db.json;
//   - ids are the store's rule: non-empty, NUL-free (node:sqlite reads a
//     NUL-bearing TEXT back version-dependently - truncated on <= 24.14,
//     verbatim on 24.20, tracker #225 - so such a key could never be
//     addressed reliably) - the WRITE refuses, reads are tolerant; a
//     `__proto__` id is inert own data (getAll defines own properties).
//
// The bulk seams in lib/db/sqlite.js (the legacy-JSON import, the v32
// backfill, exclusiveReplace, readPersistedDatabase) go through the exports
// below - one upsert text, one id rule, never a drifting copy.

const { defineJsonRowStore, isPersistableId } = require('./jsonRowStore');

const TABLE = 'media_items';
const LABEL = 'media items';
const def = defineJsonRowStore({ label: LABEL, table: TABLE, keyColumn: 'media_id' });

// Rows in ROWID order - the order doc_kv handed the index back in (insertion
// order, an upsert keeps a row's rowid), so `Object.keys(db.metadata)` walks
// the library exactly as it did before the move.
const ALL_SQL = `SELECT media_id AS id, json FROM ${TABLE} ORDER BY rowid`;

function createItemsStore(adapter) {
  const base = def.createStore(adapter);
  const sql = adapter.sql;
  const stmts = {
    all: sql.prepare(ALL_SQL),
    upsertJson: sql.prepare(def.UPSERT_SQL), // (media_id, json) - the json already serialized
    del: sql.prepare(`DELETE FROM ${TABLE} WHERE media_id = ?`),
  };
  // Per-row serialized-JSON snapshot of the LAST COMMIT (the diff base).
  // Rebuilt from disk at open and after exclusiveReplace (the restore).
  const snapshot = new Map();

  function rebuildSnapshot() {
    snapshot.clear();
    for (const row of stmts.all.all()) snapshot.set(row.id, row.json);
  }
  // (no rebuild here: the adapter's constructor rebuilds every diff base once,
  // through rebuildSnapshotFromDisk, right after creating this store)

  // { [id]: record } in rowid order, own properties only.
  function getAll() {
    const out = {};
    for (const row of stmts.all.all()) {
      Object.defineProperty(out, row.id, { value: JSON.parse(row.json), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }

  // The diff of a `metadata` object against the last commit. `undefined`
  // (the key absent from the doc object) = no plan at all (rows kept);
  // an object = every id compared; an id whose value serializes to
  // `undefined` is treated as absent (dropped, its stale row deleted).
  function planDiff(map) {
    if (map === undefined || map === null) return { writes: [], deletes: [], absent: true };
    if (typeof map !== 'object' || Array.isArray(map)) throw new Error(`${LABEL}: metadata must be an object map`);
    const writes = [];
    const deletes = [];
    const seen = new Set();
    for (const id of Object.keys(map)) {
      const json = JSON.stringify(map[id]);
      if (json === undefined) continue; // JSON.stringify's legacy db.json semantics: the key is simply omitted
      def.assertMediaId(id); // NUL / empty / non-string ids are REFUSED at the write
      seen.add(id);
      if (snapshot.get(id) !== json) writes.push([id, json]);
    }
    for (const id of snapshot.keys()) {
      if (!seen.has(id)) deletes.push(id);
    }
    return { writes, deletes, absent: false };
  }

  // Run the plan's statements inside the CALLER's open transaction.
  function applyPlan(plan) {
    for (const [id, json] of plan.writes) stmts.upsertJson.run(id, json);
    for (const id of plan.deletes) stmts.del.run(id);
  }

  // Advance the diff base - ONLY after the caller's COMMIT succeeded.
  function advancePlan(plan) {
    for (const [id, json] of plan.writes) snapshot.set(id, json);
    for (const id of plan.deletes) snapshot.delete(id);
  }

  // The standalone form (unit harnesses): plan + apply + advance in the
  // store's own transaction, with an optional in-transaction effect.
  function saveDiff(map, { alsoInTransaction = null } = {}) {
    const plan = planDiff(map);
    if (plan.writes.length === 0 && plan.deletes.length === 0 && !alsoInTransaction) return { rowsWritten: 0, rowsDeleted: 0 };
    base.__tx(() => {
      applyPlan(plan);
      if (alsoInTransaction) alsoInTransaction();
    });
    advancePlan(plan);
    return { rowsWritten: plan.writes.length, rowsDeleted: plan.deletes.length };
  }

  return {
    table: TABLE,
    get: base.get,
    has: base.has,
    size: base.size,
    set: base.set,
    setMany: base.setMany,
    remove: base.remove,
    rekey: base.rekey,
    replaceAll: (map) => { base.replaceAll(map); rebuildSnapshot(); },
    getAll,
    planDiff,
    applyPlan,
    advancePlan,
    saveDiff,
    rebuildSnapshot,
    snapshotSize: () => snapshot.size,
    __stmts: base.__stmts,
    __diffStmts: stmts, // the diff's own statements (a test seam for the mid-transaction poison)
  };
}

// The one-shot v32 backfill: the doc_kv 'metadata' rows into the table,
// VERBATIM json (validated as JSON so a corrupt row rolls the block back),
// rowid order kept; a key no route could have written (empty, NUL-bearing)
// is skipped with a log line; then the doc rows are deleted. Runs inside the
// caller's open transaction on a raw connection.
function migrateFromDoc(sql, log = console.error) {
  // The NUL test runs in SQL, on the stored BYTES: node:sqlite hands a
  // NUL-bearing TEXT back truncated on Node <= 24.14 (verbatim on 24.20 -
  // tracker #225), so a JS-side check would see `abc` for a stored `abc\0`
  // and the upsert would CLOBBER the real `abc` row (the gate's repro).
  const rows = sql.prepare("SELECT key, json, instr(CAST(key AS BLOB), x'00') AS nulpos FROM doc_kv WHERE namespace = 'metadata' ORDER BY rowid").all();
  if (rows.length === 0) return 0;
  const upsert = sql.prepare(def.UPSERT_SQL);
  let moved = 0;
  for (const row of rows) {
    if (row.nulpos > 0 || !isPersistableId(row.key)) { log(`[db] migration: skipping a metadata key no route could have written (${JSON.stringify(row.key)})`); continue; }
    JSON.parse(row.json); // validate - a corrupt row aborts the block (rolled back whole)
    upsert.run(row.key, row.json);
    moved += 1;
  }
  sql.prepare("DELETE FROM doc_kv WHERE namespace = 'metadata'").run();
  return moved;
}

// The test read (readPersistedDatabase): the index in its `metadata` shape on
// a raw read-only connection, or undefined when the table is empty (the
// empty-is-absent normalization every doc_kv namespace had).
function readPersisted(sql) {
  const rows = sql.prepare(ALL_SQL).all();
  if (rows.length === 0) return undefined;
  const out = {};
  for (const row of rows) Object.defineProperty(out, row.id, { value: JSON.parse(row.json), enumerable: true, writable: true, configurable: true });
  return out;
}

module.exports = {
  TABLE,
  UPSERT_SQL: def.UPSERT_SQL,
  rowParams: def.rowParams,
  assertMediaId: def.assertMediaId,
  createItemsStore,
  migrateFromDoc,
  readPersisted,
};
