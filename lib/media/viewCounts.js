'use strict';

// ---- media view counts: the first RELATIONAL media namespace ---------------
//
// Wave 1 of the relational-migration arc (docs/exec-plans/completed/
// 2026-09-13-sqlite-relational-migration.md). `viewCounts` used to be a doc_kv
// namespace riding the loadDatabase/saveDatabase mega-object - the one
// NON-REBUILDABLE per-item field (a rescan rebuilds metadata; it cannot
// rebuild how many times you watched something). It now lives in its own
// table, `media_view_counts (media_id TEXT PRIMARY KEY, count INTEGER)`,
// owned by this module the way lib/auth/store.js owns the per-user tables:
//   - it receives the adapter and prepares statements against the adapter's
//     warm connection (adapter.sql); it never require()s node:sqlite;
//   - every RUNTIME write to the table goes through this module. THREE bulk
//     seams also touch it, all in lib/db/sqlite.js and all the arc's tracked
//     residual (tech-debt #224): the boot-time legacy-JSON import (rule 2,
//     retired in Wave 7), the one-shot v21 migration backfill, and
//     exclusiveReplace (the restore / test-reset wipe-and-replace primitive,
//     which must wipe every table the bundle repopulates). All three use
//     UPSERT_SQL exported below - one SQL text, no drifting copy.
//   - writes are transactional: a multi-row call opens its own transaction
//     unless the caller already holds one (the restore path runs inside
//     exclusiveReplace's open transaction), so it never nests BEGIN.
//
// Why a table and not the doc model: the persist-gate / stale-snapshot class
// (5+ strikes) is a property of the mega-object - every new per-item field
// needed a backfill + carry-forward + merge guard + namespace-lock entry. A
// row keyed by media id has none of those seams. The id-keyed CARRIER
// discipline still applies (delete / prune / move / trash / restore / purge
// must remove or re-key the row) - server.js calls remove()/rekey() at the
// same post-commit sites where userStore.removeMediaState/rekeyMediaState
// already run.
//
// Media ids are md5 hex today, but the guard below refuses only what would
// CORRUPT: a NUL (read back truncated on Node <= 24.14, #225 - the repo's
// assertRowKeySafe lesson) or a non-string. `__proto__` as an id is inert
// here (it is a TEXT column value), and getAll() defines it as an own
// property so it can never become a prototype assignment on the way out.

const { isPersistableId } = require('./jsonRowStore'); // the ONE id rule (QA delta S1)

const TABLE = 'media_view_counts';
const UPSERT_SQL = `INSERT INTO ${TABLE}(media_id, count) VALUES(?, ?) ON CONFLICT(media_id) DO UPDATE SET count = excluded.count`;

function assertMediaId(id) {
  if (typeof id !== 'string' || id === '') {
    throw new Error(`viewCounts: media id must be a non-empty string (got ${typeof id})`);
  }
  if (id.includes('\u0000')) {
    throw new Error('viewCounts: media id contains U+0000 - node:sqlite reads a NUL-bearing TEXT back truncated on Node 24.14 and older (verbatim from 24.20 - tech-debt #225), so a persisted NUL-bearing key would read back as a colliding prefix and silently corrupt the key. Refusing.');
  }
}

// The column is INTEGER and node:sqlite reads a stored integer back as a JS
// number: a value above Number.MAX_SAFE_INTEGER lands fine and then throws
// ERR_OUT_OF_RANGE on EVERY read of the table - getAll() (backup, stats) dies
// for all rows, not just the poisoned one (Wave 1 adversarial W1, measured:
// backup 500, stats 500, view 500 until SQL surgery). So the safe-integer
// range is a hard ceiling at every write boundary, shared with the bundle
// validator and the restore handle.
const MAX_COUNT = Number.MAX_SAFE_INTEGER;

function assertCount(n) {
  if (!Number.isInteger(n) || n < 0 || n > MAX_COUNT) {
    throw new Error(`viewCounts: count must be a non-negative safe integer (got ${String(n)})`);
  }
}

// A persisted value that is usable as a count: finite, positive, within the
// safe-integer range. Used by the migration backfill and the import seams,
// where a legacy value may be a float or junk - anything else is dropped (the
// v1.42 import made the same call: "vid3's viewCount:0 is dropped; missing
// reads as 0"; a count past 2^53 is dropped rather than poisoning the table).
function usableCount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const n = Math.trunc(value);
  return n > MAX_COUNT ? null : n;
}

function statementsFor(adapter) {
  if (adapter.__viewCountStmts) return adapter.__viewCountStmts;
  const sql = adapter.sql;
  const s = {
    get: sql.prepare(`SELECT count FROM ${TABLE} WHERE media_id = ?`),
    all: sql.prepare(`SELECT media_id, count FROM ${TABLE} ORDER BY media_id`),
    upsert: sql.prepare(UPSERT_SQL),
    // One atomic statement: a missing row is born at the caller's floor + 1,
    // an existing row steps by exactly one, saturating at the safe-integer
    // ceiling so no arithmetic can ever write the read-poisoning value.
    // RETURNING hands back the new value without a second read (the view
    // route answers with it).
    increment: sql.prepare(`INSERT INTO ${TABLE}(media_id, count) VALUES(?, ?) ON CONFLICT(media_id) DO UPDATE SET count = MIN(count + 1, ${MAX_COUNT}) RETURNING count`),
    del: sql.prepare(`DELETE FROM ${TABLE} WHERE media_id = ?`),
    // OR REPLACE: if the destination id already has a row (a re-add of the
    // same path, or a collision the move route refuses anyway), the re-key
    // must not throw on the PK - the moving row wins, matching the other
    // carriers (lib/auth/store.js rekeyProgress).
    rekey: sql.prepare(`UPDATE OR REPLACE ${TABLE} SET media_id = ? WHERE media_id = ?`),
    clear: sql.prepare(`DELETE FROM ${TABLE}`),
    countRows: sql.prepare(`SELECT COUNT(*) AS c FROM ${TABLE}`),
  };
  adapter.__viewCountStmts = s;
  return s;
}

function createViewCountStore(adapter) {
  const st = () => statementsFor(adapter);
  // Run `fn` inside a transaction - the caller's, if one is already open
  // (exclusiveReplace's restore populate), else our own.
  const tx = (fn) => {
    if (adapter.inTransaction) return fn();
    adapter.begin();
    try {
      const out = fn();
      adapter.commit();
      return out;
    } catch (err) {
      adapter.rollback();
      throw err;
    }
  };

  return {
    // The count for one id; 0 when there is no row (a count is additive,
    // default 0 - never a reason to reprocess anything). READ-tolerant (the
    // Wave 3 gate's CRITICAL on the record stores): an id that could never
    // have been persisted reads as 0, never throws.
    get(id) {
      if (!isPersistableId(id)) return 0;
      const row = st().get.get(id);
      return row ? row.count : 0;
    },

    // Every row as { [mediaId]: count } - the shape the backup bundle, the
    // stats inventory and the read-side overlay consume. Keys are defined as
    // OWN properties (a '__proto__' id round-trips as inert data).
    getAll() {
      const out = {};
      for (const row of st().all.all()) {
        Object.defineProperty(out, row.media_id, { value: row.count, enumerable: true, writable: true, configurable: true });
      }
      return out;
    },

    size() {
      return st().countRows.get().c;
    },

    set(id, count) {
      assertMediaId(id);
      assertCount(count);
      st().upsert.run(id, count);
    },

    // Record one view. `floor` is the legacy embedded `item.viewCount` a
    // pre-v1.42 item may still carry (honored as the STARTING value the first
    // time the id is counted - the v1.42 contract, unchanged). Returns the
    // new count.
    increment(id, { floor = 0 } = {}) {
      assertMediaId(id);
      const start = usableCount(floor) || 0;
      return st().increment.get(id, start + 1).count;
    },

    // Id-keyed carrier: delete / prune / purge. Accepts one id or a list;
    // one transaction for the whole set.
    remove(mediaIds) {
      const ids = Array.isArray(mediaIds) ? mediaIds : [mediaIds];
      if (ids.length === 0) return;
      for (const id of ids) assertMediaId(id);
      tx(() => { for (const id of ids) st().del.run(id); });
    },

    // Id-keyed carrier: move / trash / restore. The count follows the item to
    // its new id; the old row is gone (no orphan, no stale-count resurrection
    // onto a future re-add of the old path).
    rekey(oldId, newId) {
      assertMediaId(oldId);
      assertMediaId(newId);
      if (oldId === newId) return;
      st().rekey.run(newId, oldId);
    },

    // Wipe-and-replace from a { [mediaId]: count } map (restore, seeding).
    // Validates EVERY entry before touching a row - refuse-whole, never a
    // half-applied map. Runs inside the caller's transaction when one is open.
    replaceAll(map) {
      const entries = [];
      if (map != null) {
        if (typeof map !== 'object' || Array.isArray(map)) throw new Error('viewCounts: replaceAll expects an object map');
        for (const id of Object.keys(map)) {
          assertMediaId(id);
          assertCount(map[id]);
          entries.push([id, map[id]]);
        }
      }
      tx(() => {
        st().clear.run();
        for (const [id, count] of entries) st().upsert.run(id, count);
      });
    },
  };
}

module.exports = createViewCountStore;
module.exports.TABLE = TABLE;
module.exports.UPSERT_SQL = UPSERT_SQL;
module.exports.usableCount = usableCount;
