'use strict';

// ---- the id-keyed JSON-record store: the shape every per-item media
// namespace takes as it leaves the document model --------------------------
//
// Wave 2 of the relational-migration arc (docs/exec-plans/active/
// 2026-09-13-sqlite-relational-migration.md). Wave 1's view-count store is a
// single-integer column; the namespaces that follow (`progress` - the frozen
// pre-auth positions the first admin adopts once - and `deleteTombstones`,
// then `trash` in Wave 3) are id-keyed RECORDS whose shape varies by era
// (a tombstone is flat, with or without youtubeId/sourceRef, and the stats
// reader tolerates an `item`-bearing one; a legacy progress value can be a
// bare number or a `{position}`). So the row keeps the record
// VERBATIM as JSON, and a store may declare typed columns derived from the
// record for the queries it runs (a tombstone's `deleted_at` for the age
// prune). That is deliberately NOT doc_kv again: the table is feature-owned,
// has no backfill / carry-forward / merge-guard / namespace-lock seams (the
// persist-gate class lives in the mega-object, not in a row), and every
// write goes through one module with one transaction discipline.
//
// Contract, shared with lib/media/viewCounts.js:
//   - receives the adapter, prepares against adapter.sql, never require()s
//     node:sqlite (the source lock keeps that in lib/db/sqlite.js);
//   - multi-row writes join an ALREADY-OPEN adapter transaction (the
//     restore populate, and server.js's in-save-transaction effects) instead
//     of nesting BEGIN;
//   - ids: non-empty strings, no U+0000 (node:sqlite truncates TEXT at NUL);
//     `__proto__` is inert (a TEXT value; getAll() defines own properties);
//   - values: any JSON-serialisable non-undefined value (JSON.stringify
//     escapes control characters, so the json column never carries a raw NUL).
//
// The bulk seams in lib/db/sqlite.js (legacy-JSON import, the one-shot
// migration backfill, exclusiveReplace) reuse each store's exported
// UPSERT_SQL - one statement text per table, never a drifting copy.

function assertMediaId(label, id) {
  if (typeof id !== 'string' || id === '') {
    throw new Error(`${label}: media id must be a non-empty string (got ${typeof id})`);
  }
  if (id.includes('\u0000')) {
    throw new Error(`${label}: media id contains U+0000 - node:sqlite truncates TEXT at NUL, so persisting it would silently corrupt the key. Refusing.`);
  }
}

function assertValue(label, value) {
  if (value === undefined) throw new Error(`${label}: a record cannot be undefined`);
  if (typeof value === 'function' || typeof value === 'symbol') throw new Error(`${label}: a record must be JSON-serialisable`);
}

// `columns`: [{ name, derive(record) }] - typed columns kept beside the json
// (e.g. deleted_at). `derive` returns null for "no typed value".
function defineJsonRowStore({ label, table, columns = [] }) {
  const colNames = columns.map((c) => c.name);
  const allCols = ['media_id', ...colNames, 'json'];
  const placeholders = allCols.map(() => '?').join(', ');
  const updates = [...colNames, 'json'].map((c) => `${c} = excluded.${c}`).join(', ');
  const UPSERT_SQL = `INSERT INTO ${table}(${allCols.join(', ')}) VALUES(${placeholders}) ON CONFLICT(media_id) DO UPDATE SET ${updates}`;

  // The bound parameters for UPSERT_SQL, from a record - shared by the store
  // and by the adapter's bulk seams so the typed columns can never drift
  // from the json.
  const rowParams = (id, record) => [id, ...columns.map((c) => c.derive(record)), JSON.stringify(record)];

  function statementsFor(adapter) {
    const cacheKey = `__jsonRowStmts_${table}`;
    if (adapter[cacheKey]) return adapter[cacheKey];
    const sql = adapter.sql;
    const s = {
      get: sql.prepare(`SELECT json FROM ${table} WHERE media_id = ?`),
      has: sql.prepare(`SELECT 1 AS x FROM ${table} WHERE media_id = ?`),
      all: sql.prepare(`SELECT media_id, json FROM ${table} ORDER BY media_id`),
      upsert: sql.prepare(UPSERT_SQL),
      del: sql.prepare(`DELETE FROM ${table} WHERE media_id = ?`),
      // OR REPLACE: a destination row (a same-path re-add) is replaced by
      // the moving row - the other carriers' rule (lib/auth/store.js).
      rekey: sql.prepare(`UPDATE OR REPLACE ${table} SET media_id = ? WHERE media_id = ?`),
      clear: sql.prepare(`DELETE FROM ${table}`),
      countRows: sql.prepare(`SELECT COUNT(*) AS c FROM ${table}`),
    };
    adapter[cacheKey] = s;
    return s;
  }

  function createStore(adapter) {
    const st = () => statementsFor(adapter);
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
      table,

      // The record for one id, or undefined.
      get(id) {
        assertMediaId(label, id);
        const row = st().get.get(id);
        return row ? JSON.parse(row.json) : undefined;
      },

      has(id) {
        assertMediaId(label, id);
        return !!st().has.get(id);
      },

      // Every row as { [id]: record } - the doc-namespace shape the backup
      // bundle, the stats inventory and the scan's Phase-1 snapshot consume.
      // Own properties only (a '__proto__' id round-trips as inert data).
      getAll() {
        const out = {};
        for (const row of st().all.all()) {
          Object.defineProperty(out, row.media_id, { value: JSON.parse(row.json), enumerable: true, writable: true, configurable: true });
        }
        return out;
      },

      size() {
        return st().countRows.get().c;
      },

      set(id, record) {
        assertMediaId(label, id);
        assertValue(label, record);
        st().upsert.run(...rowParams(id, record));
      },

      // Id-keyed carrier: delete / prune / purge. One id or a list; one
      // transaction for the set (joins an open one).
      remove(ids) {
        const list = Array.isArray(ids) ? ids : [ids];
        if (list.length === 0) return;
        for (const id of list) assertMediaId(label, id);
        tx(() => { for (const id of list) st().del.run(id); });
      },

      // Id-keyed carrier: move / trash / restore.
      rekey(oldId, newId) {
        assertMediaId(label, oldId);
        assertMediaId(label, newId);
        if (oldId === newId) return;
        st().rekey.run(newId, oldId);
      },

      // Wipe-and-replace from a { [id]: record } map - refuse-whole
      // (every entry validated before a row is touched); joins an open txn.
      replaceAll(map) {
        const entries = [];
        if (map != null) {
          if (typeof map !== 'object' || Array.isArray(map)) throw new Error(`${label}: replaceAll expects an object map`);
          for (const id of Object.keys(map)) {
            assertMediaId(label, id);
            assertValue(label, map[id]);
            entries.push([id, map[id]]);
          }
        }
        tx(() => {
          st().clear.run();
          for (const [id, record] of entries) st().upsert.run(...rowParams(id, record));
        });
      },

      // For a feature store's own extensions (a prune that deletes by a
      // typed column, etc.): the statements + the transaction helper.
      __stmts: st,
      __tx: tx,
    };
  }

  return { createStore, UPSERT_SQL, rowParams, table, assertMediaId: (id) => assertMediaId(label, id) };
}

module.exports = { defineJsonRowStore };
