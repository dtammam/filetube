'use strict';

// v1.65 trash: the ONE authority for the trash directory name and the
// trash-side path shapes. Lives outside server.js so all three scan walkers
// (media in server.js, lib/books/scan.js, lib/music/scan.js) and the trash
// machinery share the same constant without a circular require.
//
// '.filetube-trash', NOT '.trash': NAS ecosystems already use generic
// recycle names ('#recycle', '.Trash-1000') and the walker exclusion below
// must never accidentally hide a directory some OTHER tool owns.

const path = require('path');

const TRASH_DIR_NAME = '.filetube-trash';

// Pure: where a file's trash directory lives. Root-attributed items trash
// under <root>/.filetube-trash (Dean's ruling: per LIBRARY ROOT); an
// unattributable file falls back to its OWN directory's .filetube-trash --
// same directory means same filesystem, so the rename stays atomic either
// way (the no-copy, no-doubled-disk ruling).
function trashDirFor(filePath, matchedRoot) {
  return path.join(matchedRoot || path.dirname(filePath), TRASH_DIR_NAME);
}

// Pure: the flat trash-side filename -- <trashedAtMs>-<idPrefix>-<basename>.
// Unique (millisecond stamp + id prefix covers same-basename retrashes) and
// human-recoverable (the original basename survives verbatim for manual
// rescue straight off the filesystem).
function trashFileName(originalPath, originalId, nowMs) {
  return `${nowMs}-${String(originalId).slice(0, 8)}-${path.basename(originalPath)}`;
}

// Pure: the full trash target for one file.
function computeTrashTarget(filePath, originalId, matchedRoot, nowMs) {
  const trashDir = trashDirFor(filePath, matchedRoot);
  return { trashDir, trashPath: path.join(trashDir, trashFileName(filePath, originalId, nowMs)) };
}

module.exports = { TRASH_DIR_NAME, trashDirFor, trashFileName, computeTrashTarget };
