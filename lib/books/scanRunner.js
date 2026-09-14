'use strict';

// lib/books/scanRunner.js - ONE pass of the book scan (the walk, the cover
// writes, the merge into the books tables, and the pruned books' per-user /
// cover-file / TTS-cache hygiene), moved VERBATIM out of server.js in Wave 7b,
// slice S2, of the relational-migration arc (docs/exec-plans/active/
// 2026-09-13-sqlite-relational-migration.md). The body is byte-identical to
// server.js's `runBookScan`; its free identifiers resolve from the `deps`
// bundle the factory closes over.
//
// A factory rather than a registerRoutes module because the pass needs its
// collaborators bound once at boot, and because only the PASS moved: its
// caller `scanBooks` stays in server.js, where it owns `bookScanState`, the
// single deferred-rescan timer and the MAX_RESCAN_FOLLOWUPS budget, is called
// by the media scan and the boot path as well as by the books routes, and is
// re-exported for the integration tests. `runBookScan` itself had exactly one
// referrer (scanBooks) and was never exported, which is what made it separable.

function createBookScanRunner(deps) {
  const {
    BOOKCOVER_DIR,
    booksDb,
    booksScan,
    booksStore,
    fs,
    getMediaId,
    path,
    settingsStore,
    ttsBlocksPath, // the pruned books' TTS cache sweep
    ttsM4aPath,
    updateDatabase,
    userStore,
  } = deps;

  async function runBookScan() {
    // Phase-1 read (no lock): folders + the previous items snapshot. All the
    // slow work (walk, zip reads, cover extraction) happens against this
    // snapshot, off the writer lock -- the media scan's own discipline.
    const scanSettings = settingsStore.get(); // Wave 4: captured with the snapshot
    const ns = booksDb.read(); // Wave 5: the Phase-1 snapshot comes from the tables
    const folders = ns.folders.slice();
    if (folders.length === 0 && Object.keys(ns.items).length === 0) return; // books-less: total no-op
    const { items, covers, survivingIds, missingRoots, erroredDirs } = await booksScan.collectBooks(folders, ns.items, getMediaId);
    for (const root of missingRoots) {
      console.warn(`books: configured folder is missing/unmounted -- nothing under it will be pruned: ${root}`);
    }

    // Cover writes BEFORE the db merge (an item never claims hasCover before
    // its file exists) -- atomic tmp+rename, best-effort per cover.
    if (covers.length > 0) {
      fs.mkdirSync(BOOKCOVER_DIR, { recursive: true });
      for (const cover of covers) {
        const finalPath = path.join(BOOKCOVER_DIR, `${cover.id}${cover.ext}`);
        const tmpPath = `${finalPath}.tmp`;
        try {
          fs.writeFileSync(tmpPath, cover.data);
          fs.renameSync(tmpPath, finalPath);
        } catch (err) {
          console.warn(`books: failed to write cover for ${cover.id} (${err && err.code}) -- placeholder card`);
          try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort */ }
        }
      }
    }

    const pruneMissing = !!scanSettings.pruneMissing;
    const prunedIds = [];
    const prunedAudioKeys = []; // v1.38.0: TTS cache keys of pruned books, deleted below
    // Wave 5: the merge runs against a FRESH holder; the diff rides the doc commit.
    await updateDatabase(() => booksDb.mutate((holder) => {
      const freshNs = booksStore.ensureBooks(holder);
      // v1.37.0 gate fix (QA CRITICAL #2 -- the v1.33 tech-debt-#10 Option-C
      // lesson, now applied to books): a root whose mountpoint DIRECTORY
      // still exists but yielded ZERO files this pass, while the library
      // previously had items under it, is the classic unmounted-share-with-
      // leftover-mountpoint signature -- treated as VANISHED (nothing under
      // it prunes), never as a bulk deletion. Without this, an NFS/SMB
      // hiccup + pruneMissing (default on) wiped every book AND its reading
      // progress on the next scan -- the exact bug class the media scanner's
      // detectVanishedRoots closed in v1.33.0.
      const effectiveMissingRoots = new Set(missingRoots);
      for (const root of folders) {
        if (effectiveMissingRoots.has(root)) continue;
        const hadItems = Object.values(freshNs.items).some((i) => i && i.rootFolder === root);
        const hasSurvivors = Object.values(items).some((i) => i && i.rootFolder === root);
        if (hadItems && !hasSurvivors) {
          effectiveMissingRoots.add(root);
          console.warn(`books: root ${root} exists but scanned EMPTY while the library has items under it -- treating as unmounted, pruning nothing beneath it`);
        }
      }
      const prunable = new Set(booksStore.selectPrunableBookIds(freshNs.items, survivingIds, { missingRoots: effectiveMissingRoots, pruneMissing, erroredDirs }));
      const next = {};
      for (const [id, item] of Object.entries(items)) {
        // The books-internal persist-gate carve-out (exec plan risk #1): the
        // ONLY non-scan writer of item fields is the client cover/pageCount
        // backfill (POST /api/books/:id/cover), which can land between this
        // scan's Phase-1 snapshot and this merge. Carry those three fields
        // forward from the FRESH row whenever this pass didn't produce them
        // itself -- regression-locked in the books scanner integration test.
        const freshItem = freshNs.items[id];
        let merged = item;
        if (freshItem) {
          if (!merged.hasCover && freshItem.hasCover === true) {
            merged = { ...merged, hasCover: true, coverExt: freshItem.coverExt || null };
          }
          if (merged.pageCount === undefined && freshItem.pageCount !== undefined) {
            merged = { ...merged, pageCount: freshItem.pageCount };
          }
        }
        next[id] = merged;
      }
      // Non-surviving items: kept unless genuinely prunable (mount-loss guard
      // + the pruneMissing gate live inside selectPrunableBookIds).
      for (const [id, item] of Object.entries(freshNs.items)) {
        if (next[id]) continue;
        if (prunable.has(id)) {
          prunedIds.push(id);
          delete freshNs.progress[id];
          // v1.38.0 persist-gate carry: a pruned book must not leak its TTS audio
          // status rows OR orphan its cache files. Capture the keys before the
          // delete so the files can be swept after the db state is authoritative.
          const audioMap = freshNs.audio[id];
          if (audioMap && typeof audioMap === 'object') {
            for (const entry of Object.values(audioMap)) {
              if (entry && entry.key) prunedAudioKeys.push(entry.key);
            }
            delete freshNs.audio[id];
          }
          continue;
        }
        next[id] = item;
      }
      freshNs.items = next;
      return true;
    }));

    // v1.43: per-user reading positions are book-id-keyed carriers -- pruned
    // books shed them too (post-commit, the removeMediaState posture; one
    // transaction for the set). Shelf pins are DIR-keyed, not book-keyed, so
    // they are deliberately untouched here.
    if (prunedIds.length > 0) {
      try {
        userStore.removeBookState(prunedIds);
      } catch (err) {
        console.error('books: failed to prune per-user reading positions (continuing):', err && err.message);
      }
    }

    // Cover-file hygiene for genuinely pruned books -- best-effort, after the
    // db state is authoritative.
    for (const id of prunedIds) {
      for (const ext of ['.jpg', '.png']) {
        try { fs.unlinkSync(path.join(BOOKCOVER_DIR, `${id}${ext}`)); } catch (_) { /* best-effort */ }
      }
    }
    // v1.38.0: sweep the pruned books' TTS cache files (m4a + blocks.json).
    for (const key of prunedAudioKeys) {
      for (const p of [ttsM4aPath(key), ttsBlocksPath(key)]) {
        try { fs.unlinkSync(p); } catch (_) { /* best-effort */ }
      }
    }
  }

  return { runBookScan };
}

module.exports = { createBookScanRunner };
