'use strict';

// ---- the key -> JSON-value store: the shape a whole-object "singleton"
// namespace takes as it leaves the document model --------------------------
//
// Wave 4 of the relational-migration arc (docs/exec-plans/active/
// 2026-09-13-sqlite-relational-migration.md). A doc_single row held a whole
// small object (`settings`, a feature's `settings`) and every write rewrote
// the whole blob. Here each top-level key is ONE ROW, so a route that changes
// one setting writes one row, a new default appears without a migration
// (`get()` merges construction-time defaults, exactly what
// `withDefaultSettings(db.settings)` did at load time), and the persist-gate
// / stale-snapshot class of the mega-object has no seam to live in.
//
// Contract, shared with lib/media/jsonRowStore.js (the same discipline):
//   - receives the adapter, prepares against adapter.sql, never require()s
//     node:sqlite (that stays in lib/db/sqlite.js);
//   - multi-row writes join an ALREADY-OPEN adapter transaction (the restore
//     populate, server.js's in-save-transaction effects) instead of nesting;
//   - keys: the ONE id rule (`isPersistableId` - non-empty string, no NUL);
//     READS of an impossible key are tolerant (absent), WRITES assert;
//   - values: any JSON-serialisable non-undefined value (JSON.stringify
//     escapes control characters, so the json column never carries a NUL);
//   - `__proto__` as a key is inert (a TEXT value; get() defines own props).
//
// The bulk seams in lib/db/sqlite.js (legacy-JSON import, the one-shot
// migration backfill, exclusiveReplace) reuse the exported UPSERT_SQL - one
// statement text per table, never a drifting copy.

const { isPersistableId } = require('../media/jsonRowStore');

function assertKey(label, key) {
  if (typeof key !== 'string' || key === '') {
    throw new Error(`${label}: key must be a non-empty string (got ${typeof key})`);
  }
  if (key.includes('\u0000')) {
    throw new Error(`${label}: key contains U+0000 - node:sqlite truncates TEXT at NUL, so persisting it would silently corrupt the key. Refusing.`);
  }
}

function assertValue(label, key, value) {
  if (value === undefined) throw new Error(`${label}: '${key}' cannot be undefined (remove the key instead)`);
  if (typeof value === 'function' || typeof value === 'symbol') throw new Error(`${label}: '${key}' must be JSON-serialisable`);
}

function defineOwn(out, key, value) {
  Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
}

function defineKvStore({ label, table }) {
  const UPSERT_SQL = `INSERT INTO ${table}(key, json) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json`;

  function statementsFor(adapter) {
    const cacheKey = `__kvStmts_${table}`;
    if (adapter[cacheKey]) return adapter[cacheKey];
    const sql = adapter.sql;
    const s = {
      get: sql.prepare(`SELECT json FROM ${table} WHERE key = ?`),
      has: sql.prepare(`SELECT 1 AS x FROM ${table} WHERE key = ?`),
      all: sql.prepare(`SELECT key, json FROM ${table} ORDER BY key`),
      upsert: sql.prepare(UPSERT_SQL),
      del: sql.prepare(`DELETE FROM ${table} WHERE key = ?`),
      clear: sql.prepare(`DELETE FROM ${table}`),
      countRows: sql.prepare(`SELECT COUNT(*) AS c FROM ${table}`),
    };
    adapter[cacheKey] = s;
    return s;
  }

  // `defaults`: the construction-time default object merged UNDER the rows by
  // get() (a stored key wins; an absent key reads as its default). Optional.
  function createStore(adapter, { defaults = {} } = {}) {
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

      // The stored rows only, as { key: value } (own properties) - what the
      // table holds, no defaults. The backup bundle exports get(), not this.
      getRaw() {
        const out = {};
        for (const row of st().all.all()) defineOwn(out, row.key, JSON.parse(row.json));
        return out;
      },

      // Defaults merged under the rows: a fresh object per call (callers may
      // spread/mutate their copy; a default VALUE is cloned too, so a caller
      // editing a nested default in its copy cannot poison the next read).
      get() {
        const out = {};
        for (const key of Object.keys(defaults)) defineOwn(out, key, structuredClone(defaults[key]));
        for (const row of st().all.all()) defineOwn(out, row.key, JSON.parse(row.json));
        return out;
      },

      // One key: the stored value, else the default, else undefined.
      getKey(key) {
        if (!isPersistableId(key)) return undefined;
        const row = st().get.get(key);
        if (row) return JSON.parse(row.json);
        return Object.prototype.hasOwnProperty.call(defaults, key) ? structuredClone(defaults[key]) : undefined;
      },

      // Whether a ROW exists (a default is not a row).
      has(key) {
        if (!isPersistableId(key)) return false;
        return !!st().has.get(key);
      },

      size() {
        return st().countRows.get().c;
      },

      set(key, value) {
        assertKey(label, key);
        assertValue(label, key, value);
        st().upsert.run(key, JSON.stringify(value));
      },

      // Write ONLY the keys of `patch` (an undefined value deletes the key -
      // the object-spread idiom `{ ...settings, k: undefined }` means "unset").
      // Validated whole before a row is touched; one transaction.
      update(patch) {
        if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) throw new Error(`${label}: update expects an object`);
        const entries = [];
        for (const key of Object.keys(patch)) {
          assertKey(label, key);
          const value = patch[key];
          if (value !== undefined) assertValue(label, key, value);
          entries.push([key, value]);
        }
        if (entries.length === 0) return;
        tx(() => {
          for (const [key, value] of entries) {
            if (value === undefined) st().del.run(key);
            else st().upsert.run(key, JSON.stringify(value));
          }
        });
      },

      remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        if (list.length === 0) return;
        for (const key of list) assertKey(label, key);
        tx(() => { for (const key of list) st().del.run(key); });
      },

      // Wipe-and-replace from a whole object - refuse-whole (every entry
      // validated before a row is touched); joins an open transaction. null /
      // undefined = empty.
      replaceAll(obj) {
        const entries = [];
        if (obj != null) {
          if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error(`${label}: replaceAll expects an object`);
          for (const key of Object.keys(obj)) {
            assertKey(label, key);
            assertValue(label, key, obj[key]);
            entries.push([key, obj[key]]);
          }
        }
        tx(() => {
          st().clear.run();
          for (const [key, value] of entries) st().upsert.run(key, JSON.stringify(value));
        });
      },

      __stmts: st,
      __tx: tx,
    };
  }

  return { createStore, UPSERT_SQL, table, assertKey: (key) => assertKey(label, key) };
}

module.exports = { defineKvStore };
