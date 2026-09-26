'use strict';

// lib/config/configVersion.js - the compare-and-set token for the media-folder
// config (v1.339 S2, plan docs/exec-plans/active/2026-09-26-fouc-toctou-audit.md
// T-C1 / D2).
//
// POST /api/config replaces BOTH folder tables wholesale and fires a scan, and a
// folder missing from the submitted list is no longer configured (its items then
// fall through to normal pruning). A client that POSTs a list it loaded before
// another device changed the config would silently drop that device's work. The
// fix is compare-and-set: GET returns `configVersion`, a client echoes it back as
// `baseVersion`, and a POST whose base no longer matches the STORED config is
// refused with 409 and writes nothing.
//
// The version is a hash of the STORED rows (folderStore.list() +
// folderSettingsStore.getAll()), never of GET's response: GET splices the
// yt-dlp synthetic root into `folders` and defaults its `name`, and filters both
// for a restricted member - none of which is storage. Hashing the projection
// would make the token change with the module's config, not the operator's.
//
// Canonical form: `folders` keeps its ORDER (order is the data a reorder
// changes); every object has its keys sorted recursively, so a SQL row order or
// a JSON key order never changes the token for the same stored content.

const crypto = require('crypto');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    // defineProperty, not `out[key] =`: a stored '__proto__' key (getAll()
    // defines own properties) must stay inert data, never a prototype write.
    const out = {};
    for (const key of Object.keys(value).sort()) {
      Object.defineProperty(out, key, { value: canonicalize(value[key]), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  return value;
}

/**
 * The stable version token of a stored folder config. Pure.
 * @param {string[]} folders the stored folder list, in the operator's order
 * @param {Object<string, object>} folderSettings the stored per-folder settings map
 * @returns {string} sha1 hex of the canonical JSON of both
 */
function computeConfigVersion(folders, folderSettings) {
  const doc = {
    folders: Array.isArray(folders) ? folders.slice() : [],
    folderSettings: canonicalize(folderSettings && typeof folderSettings === 'object' ? folderSettings : {}),
  };
  return crypto.createHash('sha1').update(JSON.stringify(doc)).digest('hex');
}

/** The version of what the two stores hold RIGHT NOW (read the tables fresh). */
function storedConfigVersion(folderStore, folderSettingsStore) {
  return computeConfigVersion(folderStore.list(), folderSettingsStore.getAll());
}

module.exports = { computeConfigVersion, storedConfigVersion, canonicalize };
