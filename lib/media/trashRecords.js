'use strict';

// ---- media_trash: the trashed-item records (Wave 3 of the relational arc) --
//
// A record is minted by a trash move (trashItem, or the scan's deferred-retry
// trashing of a tombstoned survivor) and keyed by trashId = md5(trashPath):
// `{ originalId, originalPath, trashPath, trashedAt, rootFolder, item }` where
// `item` is the FULL metadata snapshot the Trash view renders from and a
// restore rebuilds `db.metadata` from byte-identical. The record stays
// VERBATIM in `json`; `trashed_at` is a typed column beside it and
// `expiredBefore()` is the retention sweep's query on it (a record without a
// numeric trashedAt is never auto-swept - the v1.65 rule, unchanged).
//
// DATA-LOSS COUPLING: a record IS the only way back for a trashed file (its
// bytes sit under `.filetube-trash/`; the retention sweep DESTROYS unreferenced
// files there). So the mint rides the SAME save transaction as the metadata
// removal (inSaveTransaction), the restore's record removal rides the
// metadata re-creation, and the purge's removal rides its doc commit - never
// a window where the bytes are orphaned or the record dangles.
//
// The scan's leftover reconcile reads a Phase-1 SNAPSHOT (getAll()) keyed by
// originalPath; the trash list / purge-all / serve routes read the live table.

const { defineJsonRowStore } = require('./jsonRowStore');

const def = defineJsonRowStore({
  label: 'trash',
  table: 'media_trash',
  columns: [{ name: 'trashed_at', derive: (rec) => (rec && typeof rec.trashedAt === 'number' && Number.isFinite(rec.trashedAt) ? rec.trashedAt : null) }],
});

function createTrashRecordStore(adapter) {
  const base = def.createStore(adapter);
  // Prepared once per ADAPTER (the base store's cache discipline), not per
  // store instance - a second createTrashRecordStore(adapter) reuses it.
  const expiredStmt = () => {
    if (!adapter.__trashExpiredStmt) adapter.__trashExpiredStmt = adapter.sql.prepare(`SELECT media_id, json FROM ${def.table} WHERE trashed_at IS NOT NULL AND trashed_at < ? ORDER BY trashed_at ASC, media_id ASC`);
    return adapter.__trashExpiredStmt;
  };
  return {
    ...base,
    // Records whose trashedAt is a number STRICTLY older than `cutoffMs`
    // (the sweep's `now - trashedAt > maxAgeMs`), as { [trashId]: record }.
    // A record with no numeric trashedAt (NULL) is never returned.
    expiredBefore(cutoffMs) {
      const out = {};
      for (const row of expiredStmt().all(cutoffMs)) {
        Object.defineProperty(out, row.media_id, { value: JSON.parse(row.json), enumerable: true, writable: true, configurable: true });
      }
      return out;
    },
  };
}

module.exports = createTrashRecordStore;
module.exports.TABLE = def.table;
module.exports.UPSERT_SQL = def.UPSERT_SQL;
module.exports.rowParams = def.rowParams;
