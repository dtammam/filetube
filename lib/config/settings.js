'use strict';

// ---- app settings: the first CONFIG singleton to leave the document model ---
//
// Wave 4 of the relational-migration arc (docs/exec-plans/active/
// 2026-09-13-sqlite-relational-migration.md). `settings` was ONE doc_single
// row holding the whole object; every POST /api/settings rewrote the blob and
// `loadDatabase()` merged DEFAULT_SETTINGS under it on every load. It is now
// `app_settings (key TEXT PRIMARY KEY, json TEXT NOT NULL)` on the shared
// lib/db/kvStore.js shape: one row per setting, `get()` merges the defaults
// the caller hands in at construction (server.js keeps owning
// DEFAULT_SETTINGS - the store is storage, not policy), `update(patch)`
// writes only the touched keys.
//
// Readers: every `db.settings.x` site reads `settingsStore.get().x` (or
// `getKey('x')`); a long-lived snapshot (the scan) captures `get()` once where
// it used to capture `db`. Writers ride `inSaveTransaction` when they sit in a
// mutator (the settings POST, the custom-logo mime keys, the notifications
// seed stamp) so a failed doc save still rolls the setting back.

const { defineKvStore } = require('../db/kvStore');

const def = defineKvStore({ label: 'settings', table: 'app_settings' });

function createSettingsStore(adapter, { defaults } = {}) {
  return def.createStore(adapter, { defaults: defaults || {} });
}

module.exports = createSettingsStore;
module.exports.TABLE = def.table;
module.exports.UPSERT_SQL = def.UPSERT_SQL;
module.exports.assertKey = def.assertKey;
