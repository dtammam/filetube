'use strict';

// lib/scan/merge.js -- the scan's end-of-pass reconciliation with what is
// already persisted - which non-surviving ids may be pruned, and how a
// freshly re-read metadata map merges into the scan's own.
//
// Wave 6 of the relational-migration arc (docs/exec-plans/active/
// 2026-09-13-sqlite-relational-migration.md): extracted from server.js
// VERBATIM: every body and doc comment is the original text. The ONLY comment
// edits anywhere in the extraction were positional locator words
// ("above"/"below") that pointed at a server.js NEIGHBOUR - those now name
// their target instead, so no comment here lies about where its subject is.
// server.js requires this module back and re-exports each helper, so
// `require('../../server').<name>` is the SAME function object as the one
// `require('../../lib/scan/<this file>').<name>` hands you.

const { matchRootFolder } = require('./roots');

// Pure: decide which old-metadata ids are safe to prune during a scan.
// `oldMetadata` is the previous db.metadata object; `survivingIds` is the set
// of ids the current scan actually found on disk. `opts` = { missingRoots,
// unreadablePaths, folders, pruneMissing } (all normalized single/array/Set).
// Guards run, IN ORDER, BEFORE the pruneMissing toggle check, so each of them
// holds regardless of the toggle:
//   1. survives on disk                                  -> keep
//   2. root (backfilled, or derived via matchRootFolder
//      for legacy pre-backfill entries) is missing        -> keep (mount-loss, depth 0)
//   3. root cannot be attributed to any configured folder -> keep (conservative;
//      covers legacy falsy-rootFolder entries whose derived root is null)
//   4. filePath falls under any unreadablePaths prefix     -> keep (incomplete
//      enumeration -- a swallowed readdir/stat error anywhere in that
//      subtree must never be mistaken for a bulk deletion, at any depth)
//   5. pruneMissing === false                              -> keep
//   6. otherwise (present, readable root + file individually gone + prune ON) -> prune
function selectPrunableIds(oldMetadata, survivingIds, opts) {
  const { missingRoots, unreadablePaths, folders, pruneMissing } = opts || {};
  const surviving = survivingIds instanceof Set ? survivingIds : new Set(survivingIds);
  const missing = missingRoots instanceof Set ? missingRoots : new Set(missingRoots || []);
  const incomplete = unreadablePaths instanceof Set ? unreadablePaths : new Set(unreadablePaths || []);
  const allFolders = folders || [];
  const under = (p, prefix) =>
    p === prefix || p.startsWith(prefix + '/') || p.startsWith(prefix + '\\');
  const prune = [];
  for (const [id, entry] of Object.entries(oldMetadata)) {
    if (surviving.has(id)) continue;                       // (1) file still on disk -> keep
    const filePath = entry && entry.filePath;
    let root = entry && entry.rootFolder;
    if (!root && filePath) root = matchRootFolder(filePath, allFolders); // (iii) derive for legacy entries
    if (root && missing.has(root)) continue;                // (2) MOUNT-LOSS GUARD
    if (!root) continue;                                    // (3) unattributable -> retain
    if (filePath && [...incomplete].some((pre) => under(filePath, pre))) continue; // (4) any-depth guard
    if (!pruneMissing) continue;                            // (5) toggle OFF -> retain stale entry
    prune.push(id);                                         // (6) root present + readable + file gone + prune ON
  }
  return prune;
}

// Pure: reconcile a scan's freshly-built metadata map with a FRESHLY re-read
// on-disk metadata map (taken immediately before the final save, see the
// `runScanDirectories` save block). `newMetadata` is authoritative for
// membership (a scan-pruned id stays pruned even if it still exists in
// `freshMetadata`) and every scan-derived field, EXCEPT `lastServedAt`: a
// concurrent `recordServed` call may have persisted a NEWER timestamp on
// `freshMetadata[id]` while the scan was still running (the scan's own
// snapshot of that entry is stale). Adopt the newer of the two so a serve
// recorded mid-scan is never reverted -- on-disk `lastServedAt` is the single
// source of truth and this merge only ever advances it, never regresses it.
// Mutates and returns `newMetadata`; does no FS I/O (pure).
function mergeScannedMetadata(freshMetadata, newMetadata) {
  for (const [id, entry] of Object.entries(newMetadata)) {
    const prior = freshMetadata[id];
    if (prior && typeof prior.lastServedAt === 'number' &&
        (typeof entry.lastServedAt !== 'number' || prior.lastServedAt > entry.lastServedAt)) {
      entry.lastServedAt = prior.lastServedAt;
    }
  }
  return newMetadata;
}

module.exports = {
  selectPrunableIds,
  mergeScannedMetadata,
};
