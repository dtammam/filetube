'use strict';

// ---- the FEATURE store: a content module's whole namespace as a set of
// relational tables, read as ONE snapshot and written back as a DIFF ------
//
// Wave 5 of the relational-migration arc (docs/exec-plans/active/
// 2026-09-13-sqlite-relational-migration.md). Every content module (books,
// music, podcasts, tv, ytdlp) owned a doc container (`db.books` = { folders,
// items, progress, pins, settings, audio }) that it read through `readX(db)`
// (a non-mutating view) and mutated through `ensureX(db)` inside an
// `updateDatabase` mutator, relying on the mega-object's diff-save. A feature
// store keeps that CONTRACT and moves the STORAGE:
//
//   - each part of the namespace is its own table on a shared primitive -
//     `list` (an ordered list of strings: lib/db/orderedListStore.js), `map`
//     (id -> JSON record: lib/media/jsonRowStore.js), `kv` (key -> JSON
//     value: lib/db/kvStore.js), `records` (an ordered array of id-bearing
//     records: lib/db/recordListStore.js), `value` (one scalar kept as a key
//     of a sibling `kv` part);
//   - `read()` is the snapshot `readX(db)` used to hand back (the same shape:
//     arrays, maps, objects), `holder()` wraps it as `{ [name]: snapshot }` so
//     the module's own `ensureX(holder)` normaliser still applies;
//   - `mutate(fn)` runs a mutator against a fresh holder and writes the DIFF
//     back (changed rows only, per part) inside the doc commit's transaction
//     when an `inSaveTransaction` hook was handed in (server.js) or in its
//     own transaction otherwise (unit harnesses). A mutator returning `false`
//     writes nothing - the `updateDatabase` skip-the-save contract.
//   - `replaceAll(ns)` is the bundle-restore / test-seed write (refuse-whole);
//     `readPersisted(sql)` is the test read; `migrateFromDoc(sql, log)` is the
//     one-shot backfill the adapter's migration calls (the CREATE TABLEs stay
//     LITERAL in lib/db/sqlite.js - the diagrams census reads them there).
//
// Why a diff and not a rewrite: the doc adapter wrote only changed rows; a
// scan merge over thousands of tracks must not rewrite every row per pass.

const { defineOrderedListStore } = require('./orderedListStore');
const { defineKvStore } = require('./kvStore');
const { defineRecordListStore } = require('./recordListStore');
const { defineJsonRowStore, isPersistableId } = require('../media/jsonRowStore');

const KINDS = new Set(['list', 'map', 'kv', 'records', 'value']);

function defineFeatureStore({ name, prefix = name, parts }) {
  const defs = {};
  for (const [part, spec] of Object.entries(parts)) {
    if (!KINDS.has(spec.kind)) throw new Error(`featureStore ${name}: unknown kind '${spec.kind}' for part '${part}'`);
    const table = `${prefix}_${spec.table || part}`;
    const label = `${name}.${part}`;
    if (spec.kind === 'list') defs[part] = { kind: 'list', table, def: defineOrderedListStore({ label, table, column: spec.column || 'value' }) };
    // `docSingleMap`: a map that lived as ONE doc_single object (music.channels)
    // rather than per-key doc_kv rows - the migration reads it from there.
    else if (spec.kind === 'map') defs[part] = { kind: 'map', table, docSingleMap: !!spec.docSingleMap, def: defineJsonRowStore({ label, table, keyColumn: spec.keyColumn || 'id' }) };
    // `internal`: a kv part that exists only to back `value` parts (ytdlp's
    // allowMembersOnly) - a table, never a key of the namespace (read(),
    // syncFrom(), replaceAll() and the bundle skip it).
    else if (spec.kind === 'kv') defs[part] = { kind: 'kv', table, internal: !!spec.internal, def: defineKvStore({ label, table }) };
    else if (spec.kind === 'records') defs[part] = { kind: 'records', table, def: defineRecordListStore({ label, table }) };
    else defs[part] = { kind: 'value', via: spec.via, defaultValue: spec.defaultValue };
  }
  for (const [part, d] of Object.entries(defs)) {
    if (d.kind === 'value' && (!defs[d.via] || defs[d.via].kind !== 'kv')) throw new Error(`featureStore ${name}: value part '${part}' needs a kv part named '${d.via}'`);
  }
  const tables = Object.entries(defs).filter(([, d]) => d.table).map(([part, d]) => ({ part, table: d.table, kind: d.kind }));
  // The namespace's KEYS (what read() hands back and a bundle may carry).
  const publicDefs = Object.fromEntries(Object.entries(defs).filter(([, d]) => !d.internal));
  const publicParts = () => Object.entries(publicDefs);
  // The doc-model addresses the parts lived at: a `map` was a doc_kv
  // namespace `<name>.<part>`, everything else a doc_single `<name>.<part>`.
  const docKvNamespaces = Object.entries(defs).filter(([, d]) => d.kind === 'map' && !d.docSingleMap).map(([part]) => `${name}.${part}`);
  const docSingleNames = Object.entries(defs).filter(([, d]) => d.kind !== 'map' || d.docSingleMap).map(([part]) => `${name}.${part}`);

  function createStore(adapter, { inSaveTransaction = null } = {}) {
    const sub = {};
    for (const [part, d] of Object.entries(defs)) {
      if (d.kind !== 'value') sub[part] = d.def.createStore(adapter);
    }
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

    function readPart(part) {
      const d = defs[part];
      if (d.kind === 'list' || d.kind === 'records') return sub[part].list();
      if (d.kind === 'map') return sub[part].getAll();
      if (d.kind === 'kv') return sub[part].getRaw();
      const v = sub[d.via].getKey(part);
      return v === undefined ? d.defaultValue : v;
    }

    // `only`: an optional list of parts - a request that needs two of five
    // parts reads two tables, not five (a missing part is simply absent from
    // the snapshot; the module's ensureX(holder) fills a default for it).
    function read(only) {
      const out = {};
      for (const part of Object.keys(publicDefs)) {
        if (Array.isArray(only) && !only.includes(part)) continue;
        out[part] = readPart(part);
      }
      return out;
    }

    // Write only what changed, per part, against the CURRENT rows (the
    // caller holds the write lock; the comparison is JSON text).
    function syncFrom(ns) {
      if (ns === null || typeof ns !== 'object' || Array.isArray(ns)) throw new Error(`featureStore ${name}: syncFrom expects the namespace object`);
      return tx(() => {
        const stats = { rowsWritten: 0, rowsDeleted: 0 };
        for (const [part, d] of publicParts()) {
          const next = ns[part];
          if (d.kind === 'list' || d.kind === 'records') {
            const current = sub[part].list();
            const nextList = next == null ? [] : next;
            if (JSON.stringify(current) !== JSON.stringify(nextList)) {
              sub[part].replaceAll(nextList);
              stats.rowsWritten += Array.isArray(nextList) ? nextList.length : 0;
            }
          } else if (d.kind === 'map') {
            const current = sub[part].getAll();
            const nextMap = next == null ? {} : next;
            if (typeof nextMap !== 'object' || Array.isArray(nextMap)) throw new Error(`${name}.${part}: expects an object map`);
            const gone = Object.keys(current).filter((id) => !Object.prototype.hasOwnProperty.call(nextMap, id));
            if (gone.length) { sub[part].remove(gone); stats.rowsDeleted += gone.length; }
            const changed = {};
            for (const id of Object.keys(nextMap)) {
              if (nextMap[id] === undefined) continue; // JSON.stringify dropped it from the doc model too
              if (!Object.prototype.hasOwnProperty.call(current, id) || JSON.stringify(current[id]) !== JSON.stringify(nextMap[id])) changed[id] = nextMap[id];
            }
            const n = Object.keys(changed).length;
            if (n) { sub[part].setMany(changed); stats.rowsWritten += n; }
          } else if (d.kind === 'kv') {
            const current = sub[part].getRaw();
            const nextObj = next == null ? {} : next;
            if (typeof nextObj !== 'object' || Array.isArray(nextObj)) throw new Error(`${name}.${part}: expects an object`);
            const patch = {};
            for (const key of Object.keys(current)) if (!Object.prototype.hasOwnProperty.call(nextObj, key) || nextObj[key] === undefined) patch[key] = undefined;
            for (const key of Object.keys(nextObj)) {
              if (nextObj[key] === undefined) continue;
              if (!Object.prototype.hasOwnProperty.call(current, key) || JSON.stringify(current[key]) !== JSON.stringify(nextObj[key])) patch[key] = nextObj[key];
            }
            const n = Object.keys(patch).length;
            if (n) { sub[part].update(patch); stats.rowsWritten += n; }
          } else {
            // value: a key of the sibling kv part - written only when it differs
            // (an unset key IS the default: no row for a default value)
            const stored = sub[d.via].getKey(part);
            const current = stored === undefined ? d.defaultValue : stored;
            const nextVal = next === undefined ? d.defaultValue : next;
            if (JSON.stringify(current) !== JSON.stringify(nextVal)) { sub[d.via].set(part, nextVal); stats.rowsWritten += 1; }
          }
        }
        return stats;
      });
    }

    function replaceAll(ns) {
      const obj = ns == null ? {} : ns;
      if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error(`featureStore ${name}: replaceAll expects the namespace object`);
      for (const key of Object.keys(obj)) {
        if (!publicDefs[key]) throw new Error(`featureStore ${name}: unknown part '${key}' - refusing a lossy write`);
      }
      // Validate every part before a row is touched (refuse-whole), then write.
      const staged = {};
      for (const [part, d] of publicParts()) {
        const v = obj[part];
        if (d.kind === 'list') staged[part] = d.def.normalizeList(v);
        else if (d.kind === 'records') staged[part] = d.def.normalizeRecords(v);
        else if (d.kind === 'map') {
          if (v != null && (typeof v !== 'object' || Array.isArray(v))) throw new Error(`${name}.${part}: expects an object map`);
          for (const id of Object.keys(v || {})) { d.def.assertMediaId(id); if (v[id] === undefined) throw new Error(`${name}.${part}: '${id}' cannot be undefined`); }
          staged[part] = v || {};
        } else if (d.kind === 'kv') {
          if (v != null && (typeof v !== 'object' || Array.isArray(v))) throw new Error(`${name}.${part}: expects an object`);
          for (const key of Object.keys(v || {})) { d.def.assertKey(key); if (v[key] === undefined) throw new Error(`${name}.${part}: '${key}' cannot be undefined`); }
          staged[part] = v || {};
        } else staged[part] = v;
      }
      tx(() => {
        for (const [part, d] of Object.entries(defs)) {
          if (d.kind === 'value') continue;
          sub[part].replaceAll(d.internal ? {} : staged[part]); // an internal kv is cleared, then the values below land
        }
        for (const [part, d] of Object.entries(defs)) {
          if (d.kind !== 'value') continue;
          const v = staged[part];
          if (v !== undefined) sub[d.via].set(part, v);
        }
      });
    }

    return {
      name,
      parts: sub,
      tables,
      read,
      holder(only) { return { [name]: read(only) }; },
      readPart,
      syncFrom,
      replaceAll,
      // The mutator contract: a fresh holder, the module's own reducers,
      // then the diff - inside the doc commit when the hook is present.
      mutate(fn) {
        const holder = { [name]: read() };
        const result = fn(holder);
        if (result === false) return false;
        const apply = () => syncFrom(holder[name]);
        if (typeof inSaveTransaction === 'function') inSaveTransaction(apply);
        else apply();
        return result;
      },
      // Empty = no rows in any public table part and no value part set (an
      // internal kv holds only the value parts, so it is covered by them).
      isEmpty() {
        return Object.entries(defs).every(([part, d]) => {
          if (d.kind === 'value') return sub[d.via].getKey(part) === undefined;
          if (d.internal) return true;
          return sub[part].size() === 0;
        });
      },
      __tx: tx,
    };
  }

  // The one-shot backfill: doc rows -> tables (values verbatim; a wrong-shaped
  // single dropped with a log line; an unaddressable key skipped with one),
  // then the doc rows deleted. Runs inside the caller's open transaction on a
  // raw connection (the adapter is not open yet during a migration).
  function migrateFromDoc(sql, log = console.error) {
    const rawAdapter = { sql, inTransaction: true };
    const store = createStore(rawAdapter);
    const ns = {};
    for (const [part, d] of Object.entries(defs)) {
      const docName = `${name}.${part}`;
      if (d.kind === 'map' && !d.docSingleMap) {
        const rows = sql.prepare('SELECT key, json FROM doc_kv WHERE namespace = ?').all(docName);
        if (rows.length === 0) continue; // nothing to move (or already moved)
        const obj = {};
        for (const row of rows) {
          if (!isPersistableId(row.key)) { log(`[db] migration: skipping a ${docName} key no route could have written (${JSON.stringify(row.key)})`); continue; }
          obj[row.key] = JSON.parse(row.json);
        }
        ns[part] = obj;
      } else if (d.kind === 'map') {
        // a doc_single MAP: one object row, split into one row per key
        const row = sql.prepare('SELECT json FROM doc_single WHERE name = ?').get(docName);
        if (!row) continue;
        const value = JSON.parse(row.json);
        if (value === null || typeof value !== 'object' || Array.isArray(value)) { log(`[db] migration: the ${docName} row was not an object - dropped`); continue; }
        const obj = {};
        for (const key of Object.keys(value)) {
          if (!isPersistableId(key)) { log(`[db] migration: skipping a ${docName} key no route could have written (${JSON.stringify(key)})`); continue; }
          if (value[key] === undefined) continue;
          obj[key] = value[key];
        }
        ns[part] = obj;
      } else {
        const row = sql.prepare('SELECT json FROM doc_single WHERE name = ?').get(docName);
        if (!row) continue;
        const value = JSON.parse(row.json);
        if (d.kind === 'list' || d.kind === 'records') {
          if (!Array.isArray(value)) { log(`[db] migration: the ${docName} row was not an array - dropped`); continue; }
          const kept = [];
          for (const entry of value) {
            const ok = d.kind === 'list' ? isPersistableId(entry) : (entry && typeof entry === 'object' && !Array.isArray(entry) && isPersistableId(entry.id));
            if (!ok) { log(`[db] migration: skipping a ${docName} entry no route could have written (${JSON.stringify(entry).slice(0, 80)})`); continue; }
            kept.push(entry);
          }
          ns[part] = kept;
        } else if (d.kind === 'kv') {
          if (value === null || typeof value !== 'object' || Array.isArray(value)) { log(`[db] migration: the ${docName} row was not an object - dropped`); continue; }
          const obj = {};
          for (const key of Object.keys(value)) {
            if (!isPersistableId(key)) { log(`[db] migration: skipping a ${docName} key no route could have written (${JSON.stringify(key)})`); continue; }
            obj[key] = value[key];
          }
          ns[part] = obj;
        } else {
          ns[part] = value;
        }
      }
    }
    // Write ONLY the parts that had doc rows, and never wipe: a re-run over an
    // already-migrated database (the doc rows gone) must neither clear nor
    // duplicate what the first run landed (the Wave 4 migrations' idempotency
    // rule). A list / record list replaces whole (the doc row IS the whole
    // list); a map / kv upserts; the scalar sets.
    for (const [part, d] of Object.entries(defs)) {
      if (!Object.prototype.hasOwnProperty.call(ns, part)) continue;
      const v = ns[part];
      if (d.kind === 'list' || d.kind === 'records') store.parts[part].replaceAll(v);
      else if (d.kind === 'map') store.parts[part].setMany(v);
      else if (d.kind === 'kv') store.parts[part].update(v);
      else store.parts[d.via].set(part, v);
    }
    const delKv = sql.prepare('DELETE FROM doc_kv WHERE namespace = ?');
    for (const nsName of docKvNamespaces) delKv.run(nsName);
    const delSingle = sql.prepare('DELETE FROM doc_single WHERE name = ?');
    for (const single of docSingleNames) delSingle.run(single);
  }

  // The test read (readPersistedDatabase): the namespace assembled from the
  // tables on a raw read-only connection, or undefined when every part is empty.
  function readPersisted(sql) {
    const store = createStore({ sql, inTransaction: true });
    if (store.isEmpty()) return undefined;
    return store.read();
  }

  return { name, prefix, createStore, tables, docKvNamespaces, docSingleNames, migrateFromDoc, readPersisted, parts: publicDefs };
}

module.exports = { defineFeatureStore };
