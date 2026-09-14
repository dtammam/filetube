'use strict';

// lib/scan/roots.js -- scan ROOT attribution - which configured folder owns a
// file path, the canonical spelling of a configured root, and the
// vanished-root (empty-but-present mountpoint) detector.
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

const fs = require('fs');
const path = require('path');

// Which configured folder does this file live under? (longest matching prefix)
function matchRootFolder(filePath, folders) {
  let best = null;
  for (const f of folders) {
    if (filePath === f || filePath.startsWith(f + '/') || filePath.startsWith(f + '\\')) {
      if (!best || f.length > best.length) best = f;
    }
  }
  return best;
}

// FR-G hardening (v1.12.0, yt-dlp module parity): normalize a scan root to
// its canonical, real filesystem path BEFORE the `Set`-dedup in `runScanDirectories`, which
// otherwise only collapses byte-identical strings. Root cause of the
// duplicate-library-row bug this closes: media ids are `md5(absolute path)`
// (`getMediaId`), and `db.folders` entries were historically persisted
// as-typed/unresolved while `ytdlp.extraScanRoots()` always returns
// `path.resolve(downloadDir)` -- so a bind-mount/symlink/relative
// re-spelling of the SAME real directory tree produced two different root
// strings, which walked the same files twice under two different absolute
// paths -> two different path-based ids -> duplicate rows. `fs.realpathSync`
// resolves symlinks and `..`/relative segments to one canonical path, so
// divergent spellings of the same real tree collapse to the same string
// here; two genuinely DISTINCT trees still resolve to two distinct
// realpaths (never falsely collapsed). On ANY error (most commonly ENOENT --
// a root that is missing/unmounted right now) this falls back to
// `path.resolve(p)` rather than dropping the root: the caller's
// `fs.existsSync` check still needs a stable string to mark as a
// `missingRoot` so the E1 mount-loss guard (`selectPrunableIds`) can protect
// that root's previously-scanned ids instead of silently losing the root
// (and thus the guard) entirely. Cheap: called once per scan ROOT (a
// handful of configured folders), never per file.
function normalizeScanRoot(p) {
  try {
    return fs.realpathSync(p);
  } catch (_) {
    return path.resolve(p);
  }
}

// v1.33 T4 (tech-debt #10, Dean's Option C): the EMPTY-BUT-PRESENT
// mountpoint detector. An unmounted network share often leaves its
// mountpoint directory in place -- `fs.existsSync(root)` stays true, readdir
// returns zero entries -- so the root never lands in `missingRoots` and,
// before this guard, every id under it looked individually deleted and was
// pruned (progress/thumbnail/transcode sidecars reaped). The signature this
// detects: a configured root that PREVIOUSLY held indexed items contributed
// ZERO files to this scan (not one survivor, not one new file) while the
// directory itself still exists. That is an unmount/mount-wedge shape, not a
// plausible organic library change -- so the root is treated exactly like a
// missing root (protect, don't reap).
//
// Deliberate, accepted cost: genuinely emptying a configured folder's ENTIRE
// content out-of-band (outside FileTube) now retains its stale entries
// instead of pruning them, with a loud per-scan warning. The escape hatch is
// removing the folder from Settings (an entry whose root is no longer a
// configured folder but still carries `rootFolder` falls through to
// selectPrunableIds' normal pruning) -- or deleting the items through
// FileTube itself, which never routes through prune at all. Partial
// deletions of any size are unaffected: one surviving OR new file under the
// root defuses the signature entirely.
//
// Pure: no FS I/O (the "directory still exists" half is established by the
// caller's own walk -- a root that failed existsSync is already in
// `missingRoots` and is skipped here). Attribution matches
// selectPrunableIds exactly (entry.rootFolder, matchRootFolder fallback for
// legacy entries) so the two can never disagree about which root owns an id.
// `newMetadata` at the call site is exactly this scan's found-on-disk items
// (retention copy-back happens after), so "contributed zero files" is a
// plain per-root count over it.
// @returns {string[]} configured roots showing the vanished signature
function detectVanishedRoots(oldMetadata, newMetadata, folders, missingRoots) {
  const allFolders = folders || [];
  const missing = missingRoots instanceof Set ? missingRoots : new Set(missingRoots || []);
  const priorCounts = new Map();
  for (const entry of Object.values(oldMetadata || {})) {
    const filePath = entry && entry.filePath;
    let root = entry && entry.rootFolder;
    if (!root && filePath) root = matchRootFolder(filePath, allFolders);
    if (!root) continue;
    priorCounts.set(root, (priorCounts.get(root) || 0) + 1);
  }
  const currentCounts = new Map();
  for (const entry of Object.values(newMetadata || {})) {
    const filePath = entry && entry.filePath;
    let root = entry && entry.rootFolder;
    if (!root && filePath) root = matchRootFolder(filePath, allFolders);
    if (!root) continue;
    currentCounts.set(root, (currentCounts.get(root) || 0) + 1);
  }
  const vanished = [];
  for (const folder of allFolders) {
    if (missing.has(folder)) continue; // already protected (existsSync failed)
    if ((priorCounts.get(folder) || 0) > 0 && (currentCounts.get(folder) || 0) === 0) {
      vanished.push(folder);
    }
  }
  return vanished;
}

module.exports = {
  matchRootFolder,
  normalizeScanRoot,
  detectVanishedRoots,
};
