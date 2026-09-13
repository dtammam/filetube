'use strict';

// ---- media_progress: the FROZEN pre-auth watch positions ------------------
//
// Wave 2 of the relational-migration arc. Before v1.43 every watch position
// lived in the global `db.progress` map; v1.43 moved live positions to the
// per-user `user_progress` table and left `db.progress` as the frozen
// pre-auth RECORD that the first admin ADOPTS once at setup
// (userStore.createFirstAdmin -> adoptInto). Nothing else ever reads it:
// playback reads user_progress (a read-through fallback was design finding
// #6's divergence bug farm). It is still carried by every id-keyed carrier
// (delete / prune / move / trash / restore / purge) so that, on an instance
// that has not run setup yet, a later adoption sees the right ids.
//
// The record is kept VERBATIM (legacy shapes vary: `{timestamp, duration,
// updatedAt?}`, older `{position}`, even bare numbers in the oldest
// fixtures) - adoptInto applies its own shape rules on the way out.

const { defineJsonRowStore } = require('./jsonRowStore');

const def = defineJsonRowStore({ label: 'progress', table: 'media_progress' });

module.exports = def.createStore;
module.exports.TABLE = def.table;
module.exports.UPSERT_SQL = def.UPSERT_SQL;
module.exports.rowParams = def.rowParams;
