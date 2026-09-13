'use strict';

// ---- media_delete_tombstones: the deferred-delete contract's records -------
//
// Wave 2 of the relational-migration arc. A tombstone is minted by a delete
// whose conclusion could not be VERIFIED (v1.41.3) - `{ filePath, deletedAt,
// youtubeId, sourceRef? }`, since v1.65 sometimes `{ item }` too - and is
// consumed by the scan's deferred retry (one delete, one retry, never a
// standing suppress-list). The record stays VERBATIM in `json` (the scan's
// SEAM-2 secondary match reads youtubeId / sourceRef / filePath, the stats
// scoping reads `.item`); `deleted_at` is a typed column beside it so the
// growth bound (age-out + FIFO cap) is one query, not a full-table parse.
//
// ATOMICITY: the mint rides the SAME transaction as the doc commit that
// removes the metadata entry (server.js registers it as an in-save-
// transaction effect) - a crash between the two would otherwise leave a
// deleted item with no tombstone, and its survivor would be re-indexed by
// the next scan: the exact class v1.41.3 closed. The retirements at
// move / trash / restore / purge ride their mutators' transactions the same
// way. The scan reads a Phase-1 SNAPSHOT (getAll()) and re-verifies the
// matched key against the live table before reaping.

const { defineJsonRowStore } = require('./jsonRowStore');

const DELETE_TOMBSTONE_CAP = 500;
const DELETE_TOMBSTONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

const def = defineJsonRowStore({
  label: 'deleteTombstones',
  table: 'media_delete_tombstones',
  columns: [{ name: 'deleted_at', derive: (rec) => (rec && typeof rec.deletedAt === 'number' && Number.isFinite(rec.deletedAt) ? rec.deletedAt : null) }],
});

// The growth bound, as a PURE policy over a { [id]: record } map: returns the
// ids to drop. Malformed entries (no numeric deletedAt) go first; then
// everything older than the max age; then the OLDEST beyond the cap (FIFO by
// deletedAt). `now` is injected (near-today literals rot - the v1.37.0 lesson).
function selectPrunedTombstoneIds(tombstones, now = Date.now()) {
  const drop = new Set();
  const kept = [];
  for (const id of Object.keys(tombstones || {})) {
    const t = tombstones[id];
    if (!t || typeof t.deletedAt !== 'number' || now - t.deletedAt > DELETE_TOMBSTONE_MAX_AGE_MS) drop.add(id);
    else kept.push(id);
  }
  if (kept.length > DELETE_TOMBSTONE_CAP) {
    kept.sort((a, b) => tombstones[a].deletedAt - tombstones[b].deletedAt);
    for (const id of kept.slice(0, kept.length - DELETE_TOMBSTONE_CAP)) drop.add(id);
  }
  return [...drop];
}

// In-place form of the same policy (the v1.41.3 signature, kept for the
// pure unit test and any map-shaped caller).
function pruneDeleteTombstones(tombstones, now = Date.now()) {
  for (const id of selectPrunedTombstoneIds(tombstones, now)) delete tombstones[id];
}

function createDeleteTombstoneStore(adapter) {
  const base = def.createStore(adapter);
  return {
    ...base,
    // Apply the growth bound to the table. Runs inside an open transaction
    // when one is held (the delete mutator's save), else its own.
    prune(now = Date.now()) {
      const victims = selectPrunedTombstoneIds(base.getAll(), now);
      if (victims.length) base.remove(victims);
      return victims.length;
    },
  };
}

module.exports = createDeleteTombstoneStore;
module.exports.TABLE = def.table;
module.exports.UPSERT_SQL = def.UPSERT_SQL;
module.exports.rowParams = def.rowParams;
module.exports.DELETE_TOMBSTONE_CAP = DELETE_TOMBSTONE_CAP;
module.exports.DELETE_TOMBSTONE_MAX_AGE_MS = DELETE_TOMBSTONE_MAX_AGE_MS;
module.exports.selectPrunedTombstoneIds = selectPrunedTombstoneIds;
module.exports.pruneDeleteTombstones = pruneDeleteTombstones;
