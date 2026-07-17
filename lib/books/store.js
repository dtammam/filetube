'use strict';

// v1.37.0 T3 (books): the `db.books` namespace owner -- backfill, item
// shape, prune policy, and shelf pins. Mirrors lib/ytdlp/store.js's
// namespace discipline exactly (see that module's HARD INVARIANT comments):
// nothing in this file ever reads or writes `db.folders`/`db.folderSettings`
// /`db.metadata`, and nothing outside the books module writes `db.books` --
// which is the whole point of the namespace: `updateDatabase` round-trips
// untouched keys verbatim, so the media scan's Phase-2 merge (the 5-strike
// persist-gate class) can never clobber a book field.
//
// HARD INVARIANT (books half): `db.books.folders` is a SEPARATE root list
// from `db.folders`. The config route rejects overlap at save time; this
// module never consults the media list at all.

const { isPathUnder } = require('../ytdlp/args');

// Same order-of-magnitude cap as ytdlp's pin list -- a FIFO bound, not a
// quota (hundreds of books, but nobody pins a hundred shelves).
const MAX_SHELF_PINS = 100;

/**
 * Namespace backfill -- the ensureYtdlp posture verbatim: a missing/broken
 * namespace (or sub-key) is replaced with a fresh, well-formed value; a
 * present one is left completely untouched (never a shared/frozen
 * reference). Mutates IN MEMORY on every read; persists on whatever write
 * next touches the db.
 */
function ensureBooks(db) {
  if (!db.books || typeof db.books !== 'object' || Array.isArray(db.books)) {
    db.books = { folders: [], items: {}, progress: {}, pins: [], settings: {}, audio: {} };
    return db.books;
  }
  const ns = db.books;
  if (!Array.isArray(ns.folders)) ns.folders = [];
  if (!ns.items || typeof ns.items !== 'object' || Array.isArray(ns.items)) ns.items = {};
  if (!ns.progress || typeof ns.progress !== 'object' || Array.isArray(ns.progress)) ns.progress = {};
  if (!Array.isArray(ns.pins)) ns.pins = [];
  // Reserved for wave-2 TTS (engine/voice/rate) -- deliberately NOT
  // db.settings, keeping the media settings shape lock untouched.
  if (!ns.settings || typeof ns.settings !== 'object' || Array.isArray(ns.settings)) ns.settings = {};
  // v1.38.0 TTS: per-book, per-chapter synthesis status
  // (audio[bookId][spineIndex] = {status,key,durationSec,updatedAt}). MUST be
  // mirrored in `readBooks` below -- the read view rebuilds a fixed shape, so
  // omitting it there would silently DROP audio state on every GET path.
  if (!ns.audio || typeof ns.audio !== 'object' || Array.isArray(ns.audio)) ns.audio = {};
  return ns;
}

/**
 * v1.37.0 gate fix (QA W3): the NON-MUTATING read view for GET routes.
 * `ensureBooks` backfills BY MUTATING its argument -- correct inside an
 * `updateDatabase` mutator or against a private `loadDatabase()` copy, but
 * a violation of the A3 read-cache invariant ("the cached object is
 * replaced by reference, never mutated in place") when called against
 * `getCachedDatabase()`. Read paths use this instead: same defensive
 * per-key shape, zero writes to the passed object.
 */
function readBooks(db) {
  const ns = db && db.books;
  if (!ns || typeof ns !== 'object' || Array.isArray(ns)) {
    return { folders: [], items: {}, progress: {}, pins: [], settings: {}, audio: {} };
  }
  return {
    folders: Array.isArray(ns.folders) ? ns.folders : [],
    items: ns.items && typeof ns.items === 'object' && !Array.isArray(ns.items) ? ns.items : {},
    progress: ns.progress && typeof ns.progress === 'object' && !Array.isArray(ns.progress) ? ns.progress : {},
    pins: Array.isArray(ns.pins) ? ns.pins : [],
    settings: ns.settings && typeof ns.settings === 'object' && !Array.isArray(ns.settings) ? ns.settings : {},
    // v1.38.0 TTS: MUST be carried here too (see ensureBooks' note) -- omitting
    // it drops synthesis status on every read path (all GET routes use this view).
    audio: ns.audio && typeof ns.audio === 'object' && !Array.isArray(ns.audio) ? ns.audio : {},
  };
}

/**
 * Pure prune policy -- the media scan's mount-loss posture
 * (selectPrunableIds, server.js) reimplemented at ~1/10 the surface:
 * an item is prunable ONLY when (a) the global `pruneMissing` setting is
 * on, (b) its file did not survive this walk, AND (c) its root folder is
 * NOT in `missingRoots` (an unmounted/vanished root prunes NOTHING under
 * it -- absence of a mount is not deletion of a library).
 * @param {Object<string, object>} items db.books.items
 * @param {Set<string>|string[]} survivingIds ids the current walk found
 * @param {{missingRoots?: (Set<string>|string[]), pruneMissing?: boolean}} opts
 * @returns {string[]} ids safe to prune
 */
function selectPrunableBookIds(items, survivingIds, { missingRoots, pruneMissing } = {}) {
  if (pruneMissing !== true) return [];
  const surviving = survivingIds instanceof Set ? survivingIds : new Set(Array.isArray(survivingIds) ? survivingIds : []);
  const missing = missingRoots instanceof Set ? missingRoots : new Set(Array.isArray(missingRoots) ? missingRoots : []);
  const prunable = [];
  for (const id of Object.keys(items || {})) {
    if (surviving.has(id)) continue;
    const item = items[id];
    const root = item && typeof item.rootFolder === 'string' ? item.rootFolder : null;
    if (root && missing.has(root)) continue; // mount-loss guard
    prunable.push(id);
  }
  return prunable;
}

// ---- shelf pins (ports of lib/ytdlp/store.js's pin reducers) ---------------

/**
 * Validate a shelf-pin request: `dir` must be a non-empty string resolving
 * UNDER one of the configured book roots (the same isPathUnder primitive
 * ytdlp's validatePinInput uses -- the confinement posture is ported, the
 * security-gated ytdlp validator itself is deliberately NOT widened).
 * `label` optional, trimmed, bounded.
 * @returns {{ok: true, value: {dir: string, label: string}} | {ok: false, error: string}}
 */
function validateShelfPinInput(input, bookFolders) {
  const dir = input && typeof input.dir === 'string' ? input.dir.trim() : '';
  if (dir === '') return { ok: false, error: 'dir must be a non-empty string' };
  const roots = Array.isArray(bookFolders) ? bookFolders : [];
  const confined = roots.some((root) => typeof root === 'string' && root !== '' && (isPathUnder(dir, root) || dir === root));
  if (!confined) return { ok: false, error: 'dir must be inside a configured book folder' };
  const rawLabel = input && typeof input.label === 'string' ? input.label.trim() : '';
  const label = rawLabel.slice(0, 150);
  return { ok: true, value: { dir, label } };
}

// Pure reducer: add (idempotent) -- tail append at max(order)+1, never
// list.length (the order-gap lesson from reduceAddPin's own comment: removal
// never renumbers survivors, so length can lag the highest order in use).
function reduceAddShelfPin(pins, { id, dir, label, pinnedAt }) {
  const list = Array.isArray(pins) ? pins : [];
  const existing = list.find((p) => p && p.id === id);
  if (existing) return { pins: list, record: existing, changed: false };
  const order = 1 + list.reduce((max, p) => Math.max(max, p && Number.isInteger(p.order) ? p.order : -1), -1);
  const record = { id, dir, label, pinnedAt, order };
  const next = [...list, record];
  const bounded = next.length > MAX_SHELF_PINS ? next.slice(next.length - MAX_SHELF_PINS) : next;
  return { pins: bounded, record, changed: true };
}

// Pure reducer: remove by id; changed:false (array as-is) for an unknown id.
function reduceRemoveShelfPin(pins, id) {
  const list = Array.isArray(pins) ? pins : [];
  const next = list.filter((p) => !p || p.id !== id);
  return { pins: next, changed: next.length !== list.length };
}

// Pure reducer: drag-reorder -- the reduceReorder algorithm verbatim
// (leading ids in requested order, stable-partitioned tail after).
function reduceReorderShelfPins(pins, orderedIds) {
  const list = Array.isArray(pins) ? pins : [];
  const knownIds = new Set(list.filter((p) => p && p.id !== undefined).map((p) => p.id));
  const candidateIds = Array.isArray(orderedIds) ? orderedIds : [];
  const seen = new Set();
  const leadingIds = [];
  for (const id of candidateIds) {
    if (knownIds.has(id) && !seen.has(id)) {
      leadingIds.push(id);
      seen.add(id);
    }
  }
  const position = new Map();
  leadingIds.forEach((id, index) => position.set(id, index));
  let tailIndex = leadingIds.length;
  for (const p of list) {
    if (p && p.id !== undefined && !position.has(p.id)) {
      position.set(p.id, tailIndex);
      tailIndex += 1;
    }
  }
  return list.map((p) => (p && position.has(p.id) ? { ...p, order: position.get(p.id) } : p));
}

// ---- deps-backed mutators/readers (the ytdlp store call shapes) -------------
// LEGACY (v1.43 chunk 4b): no route calls these four anymore -- shelf pins
// are per-user (user_book_pins rows; server.js's routes run the pure
// reducers against userStore). They remain ONLY as utilities over the
// frozen pre-auth `db.books.pins` record (unit-covered). Do NOT wire a
// route back onto them (design finding #6's divergence class).

function listShelfPins(deps) {
  const db = deps.loadDatabase();
  const pins = ensureBooks(db).pins;
  return pins.slice().sort((a, b) => {
    const orderA = a && typeof a.order === 'number' ? a.order : 0;
    const orderB = b && typeof b.order === 'number' ? b.order : 0;
    return orderA - orderB;
  });
}

function addShelfPin(deps, { dir, label } = {}) {
  const id = deps.getMediaId(dir);
  const pinnedAt = new Date().toISOString();
  let record;
  return deps.updateDatabase((db) => {
    const ns = ensureBooks(db);
    const result = reduceAddShelfPin(ns.pins, { id, dir, label, pinnedAt });
    record = result.record;
    if (!result.changed) return false; // idempotent re-pin: skip the save
    ns.pins = result.pins;
  }).then(() => record);
}

function removeShelfPin(deps, id) {
  let removedFlag = false;
  return deps.updateDatabase((db) => {
    const ns = ensureBooks(db);
    const result = reduceRemoveShelfPin(ns.pins, id);
    removedFlag = result.changed;
    if (!result.changed) return false; // unknown id: skip the save
    ns.pins = result.pins;
  }).then(() => removedFlag);
}

function reorderShelfPins(deps, orderedIds) {
  return deps.updateDatabase((db) => {
    const ns = ensureBooks(db);
    ns.pins = reduceReorderShelfPins(ns.pins, orderedIds);
  });
}

// ---- v1.38.0 TTS: per-chapter synthesis status (no-clobber) -----------------
//
// Mirrors server.js's setAudioStatus/clearAudioStatus (the media-side
// background-audio status map): a status write inside `updateDatabase` that
// (a) never touches sibling keys, (b) skips the save when nothing actually
// changed (returns `false`), and (c) is the SINGLE writer of
// `db.books.audio[bookId][spineIndex]`. `spineIndex` is coerced to a string
// key (JSON object keys are strings anyway) so numeric and string callers
// address the same slot.

function setBookAudioStatus(deps, bookId, spineIndex, patch) {
  const idx = String(spineIndex);
  return deps.updateDatabase((db) => {
    const ns = ensureBooks(db);
    if (!ns.audio[bookId] || typeof ns.audio[bookId] !== 'object') ns.audio[bookId] = {};
    const prev = ns.audio[bookId][idx] || {};
    const next = { ...prev, ...patch };
    // No-clobber: skip the save when the merged value is byte-identical.
    if (JSON.stringify(prev) === JSON.stringify(next)) return false;
    ns.audio[bookId][idx] = next;
    return true;
  });
}

function clearBookAudioStatus(deps, bookId, spineIndex) {
  const idx = spineIndex === undefined || spineIndex === null ? null : String(spineIndex);
  return deps.updateDatabase((db) => {
    const ns = ensureBooks(db);
    const book = ns.audio[bookId];
    if (!book || typeof book !== 'object') return false; // nothing to clear
    if (idx === null) {
      // Clear the whole book's audio map (used on prune/delete of the book).
      delete ns.audio[bookId];
      return true;
    }
    if (!(idx in book)) return false; // unknown chapter: skip the save
    delete book[idx];
    // Tidy: drop the now-empty per-book object so the map doesn't accrete husks.
    if (Object.keys(book).length === 0) delete ns.audio[bookId];
    return true;
  });
}

module.exports = {
  ensureBooks,
  readBooks,
  selectPrunableBookIds,
  validateShelfPinInput,
  reduceAddShelfPin,
  reduceRemoveShelfPin,
  reduceReorderShelfPins,
  listShelfPins,
  addShelfPin,
  removeShelfPin,
  reorderShelfPins,
  // v1.38.0 TTS synthesis-status mutators (no-clobber, single-writer).
  setBookAudioStatus,
  clearBookAudioStatus,
  MAX_SHELF_PINS,
};
