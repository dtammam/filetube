'use strict';

// ---- per-channel-folder display names: { [folderName]: displayName } -----
//
// Wave 4 of the relational-migration arc (docs/exec-plans/completed/
// 2026-09-13-sqlite-relational-migration.md). `folderDisplayNames` (v1.126:
// written by the "Refresh channel names" reconcile when a folder heals to
// one canonical name, and by the manual rename route; keyed by folderName,
// mirroring the `?folder=` filter's grouping) was ONE doc_single row. It is
// now `channel_folder_display_names (folder_name TEXT PRIMARY KEY, json TEXT
// NOT NULL)` on the shared lib/media/jsonRowStore.js shape - the value is
// the display-name STRING, stored as its JSON encoding (the shared shape
// keeps records verbatim; a string is a legal record). The heal's write
// rides the doc commit's transaction (OVERWRITE posture - the v1.116
// lesson); every reader takes `getAll()` (the map shape it always had).

const { defineJsonRowStore } = require('../media/jsonRowStore');

const def = defineJsonRowStore({ label: 'folderDisplayNames', table: 'channel_folder_display_names', keyColumn: 'folder_name' });

function createFolderDisplayNameStore(adapter) {
  return def.createStore(adapter);
}

module.exports = createFolderDisplayNameStore;
module.exports.TABLE = def.table;
module.exports.UPSERT_SQL = def.UPSERT_SQL;
module.exports.rowParams = def.rowParams;
