'use strict';

// ---- the ordered-list-of-RECORDS store: the shape a feature's `pins` /
// `subscriptions` array takes as it leaves the document model --------------
//
// Wave 5 of the relational-migration arc (docs/exec-plans/completed/
// 2026-09-13-sqlite-relational-migration.md). `books.pins`, `ytdlp.pins`,
// `ytdlp.subscriptions` and `podcasts.subscriptions` were whole JSON arrays
// of id-bearing records in doc_single, mutated by pure reducers (add / remove
// / reorder / patch) and rewritten whole. Here each record is ONE ROW,
// `(id TEXT PRIMARY KEY, position INTEGER NOT NULL, json TEXT NOT NULL)`,
// read back in array order. The record is kept VERBATIM (its own `order`
// field included - the reducers' order-gap discipline is theirs, the row's
// `position` is only the array index).
//
// Contract, shared with lib/media/jsonRowStore.js and its siblings:
//   - receives the adapter, prepares against adapter.sql, never require()s
//     node:sqlite; multi-row writes join an ALREADY-OPEN adapter transaction;
//   - a record must be a plain object with a persistable string `id`
//     (non-empty, no NUL); a duplicate id in a list collapses keep-first (set
//     semantics on the id, like the ordered-list store);
//   - READS of an impossible id are tolerant (absent), WRITES assert.

const { isPersistableId } = require('../media/jsonRowStore');

function assertRecord(label, record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`${label}: a record must be a plain object (got ${record === null ? 'null' : Array.isArray(record) ? 'array' : typeof record})`);
  }
  if (typeof record.id !== 'string' || record.id === '') {
    throw new Error(`${label}: a record needs a non-empty string id (got ${typeof record.id})`);
  }
  if (record.id.includes('\u0000')) {
    throw new Error(`${label}: a record id contains U+0000 - refusing (unaddressable by any route; node:sqlite reads it back differently by version).`);
  }
}

// Validate a whole array and collapse duplicate ids keep-first. Shared with
// the adapter's migration / import seams.
function normalizeRecords(label, list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error(`${label}: expects an array of records`);
  const seen = new Set();
  const out = [];
  for (const record of list) {
    assertRecord(label, record);
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    out.push(record);
  }
  return out;
}

function defineRecordListStore({ label, table }) {
  const UPSERT_SQL = `INSERT INTO ${table}(id, position, json) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET position = excluded.position, json = excluded.json`;

  function statementsFor(adapter) {
    const cacheKey = `__recordListStmts_${table}`;
    if (adapter[cacheKey]) return adapter[cacheKey];
    const sql = adapter.sql;
    const s = {
      all: sql.prepare(`SELECT id, json FROM ${table} ORDER BY position, id`),
      get: sql.prepare(`SELECT json FROM ${table} WHERE id = ?`),
      has: sql.prepare(`SELECT 1 AS x FROM ${table} WHERE id = ?`),
      position: sql.prepare(`SELECT position FROM ${table} WHERE id = ?`),
      maxPos: sql.prepare(`SELECT COALESCE(MAX(position), -1) AS m FROM ${table}`),
      upsert: sql.prepare(UPSERT_SQL),
      del: sql.prepare(`DELETE FROM ${table} WHERE id = ?`),
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

      // The records in array order - a fresh array of fresh objects per call.
      list() {
        return st().all.all().map((r) => JSON.parse(r.json));
      },

      get(id) {
        if (!isPersistableId(id)) return undefined;
        const row = st().get.get(id);
        return row ? JSON.parse(row.json) : undefined;
      },

      has(id) {
        if (!isPersistableId(id)) return false;
        return !!st().has.get(id);
      },

      size() {
        return st().countRows.get().c;
      },

      // Upsert one record: an existing id keeps its position, a new one
      // appends at max(position) + 1.
      set(record) {
        assertRecord(label, record);
        const pos = st().position.get(record.id);
        st().upsert.run(record.id, pos ? pos.position : st().maxPos.get().m + 1, JSON.stringify(record));
      },

      remove(ids) {
        const list = Array.isArray(ids) ? ids : [ids];
        if (list.length === 0) return 0;
        for (const id of list) {
          if (!isPersistableId(id)) throw new Error(`${label}: cannot remove an unaddressable id (${typeof id})`);
        }
        return tx(() => {
          let n = 0;
          for (const id of list) n += st().del.run(id).changes;
          return n;
        });
      },

      // Wipe-and-replace from an array - validated whole before a row is
      // touched, duplicate ids collapsed keep-first, numbered from 0; joins an
      // open transaction. null / undefined = empty.
      replaceAll(list) {
        const records = normalizeRecords(label, list);
        tx(() => {
          st().clear.run();
          records.forEach((record, i) => st().upsert.run(record.id, i, JSON.stringify(record)));
        });
      },

      __stmts: st,
      __tx: tx,
    };
  }

  return { createStore, UPSERT_SQL, table, normalizeRecords: (list) => normalizeRecords(label, list) };
}

module.exports = { defineRecordListStore };
