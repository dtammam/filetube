'use strict';

// ---- library folders: the configured media roots, in display order --------
//
// Wave 4 of the relational-migration arc (docs/exec-plans/completed/
// 2026-09-13-sqlite-relational-migration.md). `folders` was ONE doc_single
// row holding the whole array; the config POST rewrote it and every reader
// (the scan's Phase-1 snapshot, GET /api/config, the stats inventory, the
// trash sweep's roots) read `db.folders`. It is now
// `library_folders (path TEXT PRIMARY KEY, position INTEGER NOT NULL)` on the
// shared lib/db/orderedListStore.js shape: `list()` is the array in the
// operator's order, `replaceAll(list)` is what the config POST writes (inside
// the doc commit's transaction), `remove(path)` is the yt-dlp module's
// one-time "stale downloadDir entry" migration.
//
// Semantics kept from the array: the STORED SPELLING is the operator's own
// (FIX-1: never path.resolve'd - a rewrite would change every file's id
// under that root); the config route dedupes by resolved key BEFORE the
// write, so the store's exact-duplicate collapse never fires on its input.

const { defineOrderedListStore } = require('../db/orderedListStore');

const def = defineOrderedListStore({ label: 'folders', table: 'library_folders', column: 'path' });

function createFolderStore(adapter) {
  return def.createStore(adapter);
}

module.exports = createFolderStore;
module.exports.TABLE = def.table;
module.exports.UPSERT_SQL = def.UPSERT_SQL;
module.exports.normalizeList = def.normalizeList;
