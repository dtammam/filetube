'use strict';

// ---- per-folder settings: { [rootPath]: { name, hidden, hiddenFromSidebar,
// glyph?, order? } } -------------------------------------------------------
//
// Wave 4 of the relational-migration arc (docs/exec-plans/active/
// 2026-09-13-sqlite-relational-migration.md). `folderSettings` was ONE
// doc_single row holding the whole map. It is now
// `library_folder_settings (root_path TEXT PRIMARY KEY, json TEXT NOT NULL)`
// on the shared lib/media/jsonRowStore.js shape, keyed by the root's STORED
// spelling (QW2: the same string `library_folders` holds, so the client's
// `item.rootFolder` lookups find it) - a synthetic yt-dlp root keeps its
// resolved-path key and may hold a row without ever being a folder row.
// The config POST replaces the map whole inside the doc commit's
// transaction; every reader takes `getAll()` (the map shape it always had).

const { defineJsonRowStore } = require('../media/jsonRowStore');

const def = defineJsonRowStore({ label: 'folderSettings', table: 'library_folder_settings', keyColumn: 'root_path' });

function createFolderSettingsStore(adapter) {
  return def.createStore(adapter);
}

module.exports = createFolderSettingsStore;
module.exports.TABLE = def.table;
module.exports.UPSERT_SQL = def.UPSERT_SQL;
module.exports.rowParams = def.rowParams;
