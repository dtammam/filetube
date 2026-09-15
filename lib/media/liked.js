'use strict';

// ---- the FROZEN pre-auth likes: the last top-level doc singleton ------------
//
// Wave 4 of the relational-migration arc (docs/exec-plans/completed/
// 2026-09-13-sqlite-relational-migration.md), third group. `liked` (v1.30:
// an array of media ids in like order) has been FROZEN since v1.43 - live
// likes are per-user rows in `user_liked`; this record is read exactly once,
// when the first admin account is created and adopts it (lib/auth/store.js
// adoptInto), and otherwise only carried: the rename / trash / restore /
// purge mutators re-key or remove an id in place so the adoption still finds
// the right item. It is now `media_liked (media_id TEXT PRIMARY KEY,
// position INTEGER NOT NULL)` on the shared lib/db/orderedListStore.js
// shape - `list()` is the array in like order (the adoption's and the stats
// inventory's read), `rekey()` keeps the slot (the array idiom wrote the new
// id back at the SAME index), and every carrier write rides the doc commit's
// transaction (inSaveTransaction) exactly like the Wave 2 carriers.

const { defineOrderedListStore } = require('../db/orderedListStore');

const def = defineOrderedListStore({ label: 'liked', table: 'media_liked', column: 'media_id' });

function createLikedStore(adapter) {
  return def.createStore(adapter);
}

module.exports = createLikedStore;
module.exports.TABLE = def.table;
module.exports.UPSERT_SQL = def.UPSERT_SQL;
module.exports.normalizeList = def.normalizeList;
