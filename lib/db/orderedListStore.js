'use strict';

// ---- the ordered-list-of-strings store: the shape an array "singleton"
// namespace takes as it leaves the document model --------------------------
//
// Wave 4 of the relational-migration arc (docs/exec-plans/active/
// 2026-09-13-sqlite-relational-migration.md). `folders` (the library roots, in
// the operator's display order) and `liked` (the frozen pre-auth likes, in
// like order) were whole JSON arrays in doc_single; every push/splice/re-key
// rewrote the blob. Here each string is ONE ROW with a `position`, read back
// in position order. A list has SET semantics (the config route dedupes; a
// like is membership), so the value column is the PRIMARY KEY and
// replaceAll() collapses an exact duplicate keep-first instead of refusing a
// legacy export that carried one.
//
// Contract, shared with lib/media/jsonRowStore.js / lib/db/kvStore.js:
//   - receives the adapter, prepares against adapter.sql, never require()s
//     node:sqlite (that stays in lib/db/sqlite.js);
//   - multi-row writes join an ALREADY-OPEN adapter transaction;
//   - values: the ONE id rule (`isPersistableId` - non-empty string, no NUL);
//     READS of an impossible value are tolerant (absent), WRITES assert;
//   - positions are never renumbered on remove (gaps are fine; order is what
//     matters), `add` appends at max(position) + 1, `replaceAll` numbers from 0.
//
// The bulk seams in lib/db/sqlite.js (legacy-JSON import, the one-shot
// migration backfill, exclusiveReplace) reuse the exported UPSERT_SQL.

const { isPersistableId } = require('../media/jsonRowStore');

function assertValue(label, value) {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${label}: a list entry must be a non-empty string (got ${typeof value})`);
  }
  if (value.includes('\u0000')) {
    throw new Error(`${label}: a list entry contains U+0000 - node:sqlite reads a NUL-bearing TEXT back truncated on Node 24.14 and older (verbatim from 24.20 - tech-debt #225), so a persisted NUL-bearing entry would read back as a colliding prefix and silently corrupt the entry. Refusing.`);
  }
}

// Validate a whole array and collapse exact duplicates keep-first (set
// semantics). Shared with the adapter's migration / import seams so the
// three writers agree on what a legacy array becomes.
function normalizeList(label, list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error(`${label}: expects an array`);
  const seen = new Set();
  const out = [];
  for (const value of list) {
    assertValue(label, value);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function defineOrderedListStore({ label, table, column }) {
  const UPSERT_SQL = `INSERT INTO ${table}(${column}, position) VALUES(?, ?) ON CONFLICT(${column}) DO UPDATE SET position = excluded.position`;

  function statementsFor(adapter) {
    const cacheKey = `__listStmts_${table}`;
    if (adapter[cacheKey]) return adapter[cacheKey];
    const sql = adapter.sql;
    const s = {
      all: sql.prepare(`SELECT ${column} AS value FROM ${table} ORDER BY position, ${column}`),
      has: sql.prepare(`SELECT 1 AS x FROM ${table} WHERE ${column} = ?`),
      maxPos: sql.prepare(`SELECT COALESCE(MAX(position), -1) AS m FROM ${table}`),
      upsert: sql.prepare(UPSERT_SQL),
      del: sql.prepare(`DELETE FROM ${table} WHERE ${column} = ?`),
      // OR REPLACE: if the destination value already has a row, the moving
      // row wins (its position) - the other carriers' rule.
      rekey: sql.prepare(`UPDATE OR REPLACE ${table} SET ${column} = ? WHERE ${column} = ?`),
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

      // The list in position order - a fresh array per call.
      list() {
        return st().all.all().map((r) => r.value);
      },

      has(value) {
        if (!isPersistableId(value)) return false;
        return !!st().has.get(value);
      },

      size() {
        return st().countRows.get().c;
      },

      // Append (idempotent): true when the value was added, false when it was
      // already a member (its position is untouched).
      add(value) {
        assertValue(label, value);
        if (st().has.get(value)) return false;
        st().upsert.run(value, st().maxPos.get().m + 1);
        return true;
      },

      // Remove one value or a list of values; returns how many rows went.
      // Positions of the survivors are untouched (gaps are fine).
      remove(values) {
        const list = Array.isArray(values) ? values : [values];
        if (list.length === 0) return 0;
        for (const value of list) assertValue(label, value);
        return tx(() => {
          let n = 0;
          for (const value of list) n += st().del.run(value).changes;
          return n;
        });
      },

      // Carrier: a member changes identity (rename / trash / restore) and
      // keeps its position. A non-member is a no-op (the array idiom
      // `indexOf !== -1 && (arr[i] = newId)`). Returns whether a row moved.
      rekey(oldValue, newValue) {
        assertValue(label, oldValue);
        assertValue(label, newValue);
        if (oldValue === newValue) return st().has.get(oldValue) ? true : false;
        return st().rekey.run(newValue, oldValue).changes > 0;
      },

      // Wipe-and-replace from an array - validated whole before a row is
      // touched, duplicates collapsed keep-first, numbered from 0; joins an
      // open transaction. null / undefined = empty.
      replaceAll(list) {
        const values = normalizeList(label, list);
        tx(() => {
          st().clear.run();
          values.forEach((value, i) => st().upsert.run(value, i));
        });
      },

      __stmts: st,
      __tx: tx,
    };
  }

  return { createStore, UPSERT_SQL, table, column, normalizeList: (list) => normalizeList(label, list) };
}

module.exports = { defineOrderedListStore };
