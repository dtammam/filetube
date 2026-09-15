'use strict';

// lib/media/trash.js - the v1.65 TRASH core (the only way back for a deleted
// file) and the four /api/trash routes, moved VERBATIM out of server.js in
// Wave 7b, slice S5, of the relational-migration arc (docs/exec-plans/active/
// 2026-09-13-sqlite-relational-migration.md). Five functions - `trashItem`
// (library item -> its root's trash dir, with its whole identity),
// `trashOrphanFile` (the scan's deferred-delete retry), `restoreTrashItem`
// (the exact reverse), `purgeTrashItem` (the ONLY remaining true unlink for
// library media) and `sweepTrash` (the retention auto-purge) - plus GET
// /api/trash, POST /api/trash/purge-all, POST /api/trash/:id/restore and
// DELETE /api/trash/:id. Every body is byte-identical to the server.js
// original; the free identifiers resolve from the `const { ... } = deps`
// destructure of the factory (for the functions) or of `registerRoutes` (for
// the routes) - the lib/books/scanRunner.js + lib/ytdlp registerRoutes
// patterns. A missing dep is a hard failure, never a silent fallback.
//
// TWO exports because the routes CALL the functions: server.js builds the
// factory FIRST and hands `restoreTrashItem`/`purgeTrashItem` straight into
// `registerRoutes`' deps object. That ordering is load-bearing - a deps object
// is evaluated eagerly, and the moved functions are `const` bindings now, not
// hoisted declarations - which is why server.js's factory call sits beside the
// routes rather than where `trashItem` used to be declared.
//
// What stays in server.js and crosses as a dep, with the reason:
//   - `trashRecordPlacement` - the ONE "is this record restorable where it says
//     it belongs" authority `restoreTrashItem` and `sweepTrash` share (v1.65
//     gate round 4: a hand-copied second version had already diverged). grep
//     says the two moved functions are its only referrers today, so a later
//     slice may bring it along; this slice keeps the blast radius minimal and
//     passes it in;
//   - `rekeyInFlightState` - the post-commit process-memory + per-user carry
//     the move, the trash and the restore all pass through; it owns
//     `pendingProgress`/`persistedServedAt`/`recentlyServed`, whose other
//     readers and writers are all still in server.js (the R2 rule: mutable
//     state moves with ALL its readers and writers, or stays with them);
//   - `configuredLibraryRoots` (ten callers), `hashFileStreaming` and
//     `RECOVERABLE_DELETE_CODES` (both exported by server.js),
//     `leafStillEnumerated` (the delete route's own guard reads it too),
//     `trashRecordVisibleTo` (the RBAC predicate; grep says the four moved
//     routes are its only callers - same "later slice may take it" note),
//     `destroyMediaStreams`, `clearPersistedServedAt`, the sidecar path
//     helpers, the stores and the db accessors.
// NOTHING crosses as a live accessor: an AST pass over server.js's module scope
// shows every one of the 32 factory deps and the 11 route deps is a `const` or
// a hoisted function declaration, never a reassigned `let`, so a destructure
// cannot freeze a seam (the S1a DNS-lookup and R2 `ffmpegAvailable` class).
//
// Comment fidelity: every section comment and every inline comment came with
// its code. ONE positional reference was corrected, in a comment above a
// function and never inside a moved body: `trashItem`'s "a sibling of
// `moveItemToFolder` above" now names lib/media/move.js, where slice S5 put it.

function createTrashOps(deps) {
  const {
    AUDIO_EXTENSIONS, // trashOrphanFile's audio/video type guess for the minimal snapshot
    DEFAULT_SETTINGS, // the sweep's retention-days fallback
    RECOVERABLE_DELETE_CODES, // EROFS/EACCES/EBUSY/EPERM - the actionable 409 class (exported, so it stays)
    THUMBNAIL_DIR, // the id-keyed sidecars that follow the id into trash and back
    TRASH_DIR_NAME, // lib/trashPaths - the one directory name the sweep may ever unlink inside
    TRASH_RETENTION_DAYS_VALID_VALUES, // the sweep re-validates the stored setting
    audioPath,
    clearPersistedServedAt, // the purge drops the serve-write throttle entry
    computeTrashTarget, // lib/trashPaths - the trash-side destination
    configuredLibraryRoots, // restore confinement + the sweep's root walk
    destroyMediaStreams, // closes OUR OWN read streams before the source unlink (v1.41.10)
    fs,
    getMediaId, // trashOrphanFile mints its own ids (it takes no deps bundle)
    hashFileStreaming, // the EXDEV branch's content verification
    inSaveTransaction, // every carrier write rides the doc commit
    leafStillEnumerated, // the multi-tab/leaf guard trashItem checks before it moves bytes
    likedStore,
    loadDatabase, // trashOrphanFile + sweepTrash read the db directly (no deps bundle)
    matchRootFolder, // lib/scanRoots - the item's root folder
    path,
    previewClipPath,
    progressStore,
    rekeyInFlightState, // the POST-COMMIT process-memory + per-user carry (stays in server.js)
    settingsStore, // the sweep reads trashRetentionDays
    storyboardPath,
    tombstoneStore,
    transcodedPath,
    trashRecordPlacement, // the ONE restorability authority restore and the sweep share (stays in server.js)
    trashStore, // lib/media/trashRecords - the media_trash table
    updateDatabase, // trashOrphanFile + sweepTrash mutate directly
    userStore, // the purge drops every per-user carrier row
    viewCountStore, // the purge drops the relational view counter
  } = deps;

  // ---- v1.65 trash core -------------------------------------------------------
  //
  // trashItem: move ONE library item into its root's trash directory
  // (lib/trashPaths.js), carrying its ENTIRE identity with it. Structurally a
  // sibling of `moveItemToFolder` (lib/media/move.js, Wave 7b slice S5) and it
  // inherits that function's battle-won ordering discipline wholesale:
  //
  //   exclusive link (EXDEV -> verified copy) -> ONE re-key mutator ->
  //   rollback-unlink on mutator failure -> post-commit rekeyInFlightState
  //   (pendingProgress + ALL NINE per-user carriers via rekeyMediaState) ->
  //   destroyMediaStreams -> source unlink last.
  //
  // The one structural difference from a move: the item LEAVES db.metadata and
  // its full record lands in media_trash under trashId (= md5(trashPath) --
  // the id system is untouched, trash is "just a move" to the carriers; Wave 3:
  // the record is a row minted INSIDE this mutator's save transaction). The
  // doc-table carry (liked) rides old->trash inside the mutator exactly like a
  // move; the progress row and the tombstones ride the same save transaction
  // (Wave 2), and the RELATIONAL carriers (per-user rows, and since Wave 1 the
  // view-count row) re-key post-commit in rekeyInFlightState, so a
  // restore re-links every scrap of history.
  //
  // NO pre-mutator tombstone retirement here (the move's mutator A): that
  // discipline protects a DESTINATION the scan can reap, and the scan never
  // walks TRASH_DIR_NAME (the v1.65 walker exclusion) -- no tombstone can ever
  // act on a trash-side path. restoreTrashItem (t3) re-occupies a REAL library
  // path and therefore DOES inherit mutator A. The trash records (media_trash)
  // deliberately do NOT join the move/prune mutators: they reference trash-side
  // paths no move or scan ever touches.
  //
  // SOURCE-UNLINK FAILURE (the last step) mints a deletion tombstone for the
  // old path: the bytes are safely in trash and the library entry is gone, but
  // a leftover hard-linked dirent at the old path would be re-indexed by the
  // next scan under the ORIGINAL id (path unchanged -> same md5) -- the
  // resurrection class. The tombstone hands the leftover to the scan's
  // deferred-delete retry (mtime is preserved by the hard link, so the
  // `mtime <= deletedAt` guard is satisfied) instead of leaving a ghost.
  async function trashItem(deps, id, opts = {}) {
    const d = deps || {};
    const loadDb = d.loadDatabase;
    const updateDb = d.updateDatabase;
    const computeId = d.getMediaId;
    const fsImpl = d.fs || fs;
    if (typeof loadDb !== 'function' || typeof updateDb !== 'function' || typeof computeId !== 'function') {
      return { ok: false, status: 500, error: 'trashItem: missing required deps (loadDatabase/updateDatabase/getMediaId)' };
    }

    const db = loadDb();
    const item = db.metadata[id];
    if (!item) {
      return { ok: false, status: 404, error: 'Media file not found' };
    }
    const oldPath = item.filePath;
    // The DELETE route resolves the ACTUAL on-disk entry (NFC/NFD, bracket-id,
    // raw-Buffer names -- v1.37.5) before calling us; FS ops on the media file
    // use that spelling, while ids/db keys stay derived from the STORED path.
    const sourcePath = opts.sourcePath || oldPath;
    const nowMs = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();

    const matchedRoot = matchRootFolder(oldPath, configuredLibraryRoots(db));
    const { trashDir, trashPath } = computeTrashTarget(oldPath, id, matchedRoot, nowMs);
    const trashId = computeId(trashPath);

    // A read-only mount can no more rename than unlink: both the mkdir and the
    // link classify EROFS/EACCES/EPERM/EBUSY as the recoverable 409 the DELETE
    // route has always surfaced (with its removeAnyway escape hatch).
    try {
      fsImpl.mkdirSync(trashDir, { recursive: true });
    } catch (err) {
      if (err && RECOVERABLE_DELETE_CODES.has(err.code)) {
        return { ok: false, status: 409, code: err.code, error: `Could not create the trash folder (${err.code})` };
      }
      return { ok: false, status: 500, error: `Could not create the trash folder: ${err.message}` };
    }

    try {
      fsImpl.linkSync(sourcePath, trashPath);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        return { ok: false, status: 404, code: 'ENOENT', error: 'The source file no longer exists on disk' };
      }
      if (err && RECOVERABLE_DELETE_CODES.has(err.code)) {
        return { ok: false, status: 409, code: err.code, error: `Could not move the file to trash (${err.code})` };
      }
      if (err && err.code === 'EEXIST') {
        // ms-stamp + id-prefix collisions are not a thing in practice; refuse
        // rather than clobber (the move's no-clobber posture).
        return { ok: false, status: 500, error: 'Trash target collision -- nothing was moved' };
      }
      if (err && err.code === 'EXDEV') {
        // A bind-mounted subtree inside a root: same design as the move's
        // EXDEV branch -- EXCLUSIVE copy, fsync, size pre-filter, then full
        // sha256 of both sides BEFORE the source is ever unlinked. The
        // same-filesystem rename is the DESIGN (no copy, no doubled disk);
        // this is the disclosed safety net for exotic mounts.
        try {
          fsImpl.copyFileSync(sourcePath, trashPath, fs.constants.COPYFILE_EXCL);
        } catch (copyErr) {
          return { ok: false, status: 500, error: `Could not move the file to trash across devices: ${copyErr.message}` };
        }
        try {
          if (typeof fsImpl.openSync === 'function' && typeof fsImpl.fsyncSync === 'function') {
            const fd = fsImpl.openSync(trashPath, 'r+');
            try { fsImpl.fsyncSync(fd); } finally { fsImpl.closeSync(fd); }
          }
        } catch (syncErr) {
          console.error(`Trash: could not fsync the cross-device copy at ${trashPath} (continuing):`, syncErr.message);
        }
        try {
          const srcSize = fsImpl.statSync(sourcePath).size;
          const dstSize = fsImpl.statSync(trashPath).size;
          if (srcSize !== dstSize) {
            try { fsImpl.unlinkSync(trashPath); } catch (_) { /* best-effort cleanup of the bad copy */ }
            return { ok: false, status: 500, error: `Cross-device trash copy verification failed (${dstSize} of ${srcSize} bytes) -- the source file was left untouched` };
          }
          const [srcDigest, dstDigest] = await Promise.all([
            hashFileStreaming(sourcePath, fsImpl),
            hashFileStreaming(trashPath, fsImpl),
          ]);
          if (srcDigest !== dstDigest) {
            try { fsImpl.unlinkSync(trashPath); } catch (_) { /* best-effort cleanup of the corrupt copy */ }
            return { ok: false, status: 500, error: 'Cross-device trash copy verification failed (sha256 mismatch) -- the corrupt copy was removed and the source file was left untouched' };
          }
        } catch (verifyErr) {
          try { fsImpl.unlinkSync(trashPath); } catch (_) { /* best-effort cleanup of the unverifiable copy */ }
          return { ok: false, status: 500, error: `Could not verify the cross-device trash copy (${verifyErr.message}) -- the source file was left untouched` };
        }
      } else {
        return { ok: false, status: 500, error: `Could not move the file to trash: ${err.message}` };
      }
    }

    // Bytes now exist at BOTH paths (same inode, or a checksum-verified copy).
    // Re-key the database FIRST; the source unlink comes only after the commit
    // (the move's v1.41.6 ordering -- a crash here leaves a visible leftover,
    // never a lost identity).
    let mutatorResult;
    try {
      mutatorResult = await updateDb((freshDb) => {
        const freshItem = freshDb.metadata[id];
        if (!freshItem) return false; // concurrently deleted -- nothing left to trash

        // Wave 3: the record is a media_trash row, minted INSIDE this save
        // transaction (see the inSaveTransaction call right after it) - the
        // bytes are already linked into trash, and the row is the only way back.
        const trashRecord = {
          originalId: id,
          originalPath: oldPath,
          trashPath,
          trashedAt: nowMs,
          rootFolder: freshItem.rootFolder || matchedRoot || null,
          // The FULL metadata record, snapshotted verbatim (still carrying the
          // ORIGINAL id/filePath): the Trash view renders from it and restore
          // rebuilds db.metadata from it byte-identical.
          item: { ...freshItem },
        };
        inSaveTransaction(() => trashStore.set(trashId, trashRecord));
        delete freshDb.metadata[id];

        // Doc-table id-keyed carries, old -> trash (the move mutator's list;
        // its standing order applies here too).
        // Wave 2: the frozen pre-auth position rides id -> trashId inside this
        // save transaction; the tombstones for both ids retire in the same one.
        inSaveTransaction(() => {
          progressStore.rekey(id, trashId);
          tombstoneStore.remove([trashId, id]);
        });
        inSaveTransaction(() => likedStore.rekey(id, trashId)); // Wave 4: the frozen likes follow the item into the trash
        // (Wave 1: the view counter is relational - it re-keys id -> trashId
        // post-commit in rekeyInFlightState with the per-user carriers.)
        // (Gate W8 note: the crash window between this commit and the source
        // unlink is closed by the SCAN's same-inode leftover reconcile, not a
        // pre-minted tombstone -- the AC4.2 1:1-write lock refuses a second
        // durable write on the happy path, and it caught the first draft of
        // this fix doing exactly that.)

        // Id-keyed sidecars follow the id into trash (the move's set: thumbnail
        // + transcode + background audio), so restore gets them back intact and
        // purge can account for every artifact. Best-effort each.
        try {
          const oldThumb = path.join(THUMBNAIL_DIR, `${id}.jpg`);
          const newThumb = path.join(THUMBNAIL_DIR, `${trashId}.jpg`);
          if (fsImpl.existsSync(oldThumb)) fsImpl.renameSync(oldThumb, newThumb);
        } catch (thumbErr) {
          console.error(`Trash: failed to re-key thumbnail for ${id} -> ${trashId}:`, thumbErr.message);
        }
        // v1.92: the storyboard sprite follows the id into trash too.
        try {
          if (fsImpl.existsSync(storyboardPath(id))) fsImpl.renameSync(storyboardPath(id), storyboardPath(trashId));
          if (fsImpl.existsSync(previewClipPath(id))) fsImpl.renameSync(previewClipPath(id), previewClipPath(trashId)); // v1.94 preview clip
        } catch (sbErr) {
          console.error(`Trash: failed to re-key storyboard for ${id} -> ${trashId}:`, sbErr.message);
        }
        try {
          if (fsImpl.existsSync(transcodedPath(id))) fsImpl.renameSync(transcodedPath(id), transcodedPath(trashId));
        } catch (transcodeErr) {
          console.error(`Trash: failed to re-key transcode sidecar for ${id} -> ${trashId}:`, transcodeErr.message);
        }
        try {
          if (fsImpl.existsSync(audioPath(id))) fsImpl.renameSync(audioPath(id), audioPath(trashId));
        } catch (audioErr) {
          console.error(`Trash: failed to re-key background-audio sidecar for ${id} -> ${trashId}:`, audioErr.message);
        }

        // Subtitle sidecars follow the file into the trash dir under the
        // trash-side basename (the move's NARROW matcher -- never another
        // item's sidecars).
        try {
          const oldDir = path.dirname(oldPath);
          const oldBase = path.basename(oldPath, path.extname(oldPath));
          const trashBase = path.basename(trashPath, path.extname(trashPath));
          const sidecarSuffix = /^\.(?:[A-Za-z0-9_-]{1,15}\.)?(?:vtt|srt)$/i;
          for (const name of fsImpl.readdirSync(oldDir)) {
            if (!name.startsWith(`${oldBase}.`)) continue;
            const suffix = name.slice(oldBase.length);
            if (!sidecarSuffix.test(suffix)) continue;
            const from = path.join(oldDir, name);
            const to = path.join(trashDir, trashBase + suffix);
            try {
              if (fsImpl.existsSync(to)) continue;
              fsImpl.renameSync(from, to);
            } catch (renameErr) {
              if (renameErr && renameErr.code === 'EXDEV') {
                // Gate fix (adversarial S2): the one layout the media EXDEV
                // branch exists for would otherwise strand subtitles beside a
                // media file that no longer exists -- copy-then-unlink, the
                // move's own sidecar posture.
                try {
                  fsImpl.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
                  fsImpl.unlinkSync(from);
                } catch (copyErr) {
                  console.error(`Trash: failed to carry subtitle sidecar ${name} across devices:`, copyErr.message);
                }
              } else {
                console.error(`Trash: failed to carry subtitle sidecar ${name}:`, renameErr.message);
              }
            }
          }
        } catch (subErr) {
          console.error(`Trash: failed to carry subtitle sidecars for ${id}:`, subErr.message);
        }

        return trashId;
      });
    } catch (err) {
      // Same rollback proof as the move: a mutator throw means saveDatabase
      // never ran (or rolled back whole). The trash-side link is OURS
      // (exclusive create moments ago) -- unlinking it restores the exact
      // pre-trash state.
      try {
        fsImpl.unlinkSync(trashPath);
      } catch (unlinkErr) {
        console.error(`Trash: the database update failed and the trash copy at ${trashPath} could not be rolled back:`, unlinkErr.message);
      }
      return { ok: false, status: 500, error: `The database update failed, so the trash move was rolled back (the original is untouched): ${err.message}` };
    }

    if (mutatorResult === false) {
      try {
        fsImpl.unlinkSync(trashPath);
      } catch (err) {
        console.error(`Trash: item ${id} vanished mid-trash; could not remove the copy at ${trashPath}:`, err.message);
      }
      return { ok: false, status: 404, error: 'Media file was removed before the trash move could be recorded' };
    }

    // Committed. Carry process-memory + the nine per-user carriers (post-commit
    // posture, same as the move), release our own read streams, then remove the
    // source directory entry LAST.
    rekeyInFlightState(id, trashId, oldPath, trashPath);
    await destroyMediaStreams(oldPath);

    let sourceUnlinkFailed = false;    // surfaces as fileRemainsOnDisk
    let sourceDeletePending = false;   // surfaces as deletePending
    // Unverified source-unlink conclusions mint the deferred-retry tombstone
    // below; the VERIFIED clean path mints nothing (v1.41.3) and costs no
    // extra write (the AC4.2 lock). The no-tombstone crash window is the
    // scan reconcile's job (see the trash-leftover block in the scan).
    let mintLeftoverTombstone = false;
    let unlinkEnoent = false;
    try {
      fsImpl.unlinkSync(sourcePath);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        // Unverified (the v1.41.3 rule): "no such file" for a path we hard-
        // linked FROM microseconds ago is a race or a lying layer -- keep the
        // tombstone and let the scan's mtime + fresh-db checks decide.
        unlinkEnoent = true;
        mintLeftoverTombstone = true;
      } else {
        sourceUnlinkFailed = true;
        mintLeftoverTombstone = true;
        console.error(`Trash: file moved to ${trashPath} but the old path ${oldPath} could not be removed:`, err.message);
      }
    }
    // v1.41.10 post-verify AT ITS NEW HOME: both the clean-unlink and the
    // ENOENT shapes can lie under SMB/CIFS DELETE_PENDING (the dirent stays
    // enumerable while every new open is refused). Enumerated + unopenable =
    // the file is NOT gone: report honestly + tombstone. Enumerated + openable
    // after a CLEAN unlink = brand-new content landed in the window -- leave
    // it alone, mint nothing (this release's C1 rule, preserved verbatim).
    if (!sourceUnlinkFailed) {
      try {
        if (leafStillEnumerated(sourcePath)) {
          let openable = false;
          try {
            fsImpl.closeSync(fsImpl.openSync(sourcePath, 'r'));
            openable = true;
          } catch (_) { /* unopenable: the delete-pending signature */ }
          if (!openable) {
            sourceUnlinkFailed = true;
            sourceDeletePending = true;
            mintLeftoverTombstone = true;
            console.warn(`Trash: ${oldPath} is STILL enumerated and refuses opens after the source unlink (delete-pending) -- reporting honestly and minting a tombstone.`);
          } else if (unlinkEnoent) {
            // An openable survivor after an ENOENT: honest fileRemainsOnDisk
            // (the tombstone stays; the scan decides).
            sourceUnlinkFailed = true;
          }
        }
      } catch (_) { /* probe is best-effort; the mint rules above stand */ }
    }
    if (mintLeftoverTombstone) {
      // Hand the leftover/uncertain dirent to the scan's deferred-delete retry
      // (which since v1.65 TRASHES survivors, or same-inode-reconciles a
      // record-covered leftover). Best-effort.
      try {
        await updateDb(() => {
          // Wave 2: minted as a row inside this mutator's save transaction.
          const leftover = { filePath: oldPath, deletedAt: Date.now(), youtubeId: null };
          inSaveTransaction(() => {
            tombstoneStore.set(id, leftover);
            tombstoneStore.prune();
          });
          return true;
        });
      } catch (tombErr) {
        console.error(`Trash: could not record the leftover at ${oldPath} for deferred cleanup:`, tombErr.message);
      }
    }

    return { ok: true, oldId: id, trashId, trashPath, sourceUnlinkFailed, sourceDeletePending };
  }

  // v1.65: the scan's deferred-delete retry routes through trash too (ruling
  // 3: EVERY delete path). By the time the retry fires, the original delete
  // already removed the library entry and every carrier -- this is an ORPHAN
  // move: bytes into the trash dir + a minimal media_trash record (a restore
  // puts the file back and the next scan re-indexes it into full metadata).
  // Sidecar subtitles ride along under the narrow matcher (the retry used to
  // greedily DELETE them; carrying is strictly better).
  //
  // Error contract, matched to the caller's existing branches: any LINK-stage
  // failure rethrows the raw fs error (the caller's ENOENT branch keeps its
  // delete-pending semantics; other codes fall to the honest re-index). A
  // mutator failure rolls the link back and throws a non-ENOENT error.
  // Returns the trashPath on success.
  async function trashOrphanFile(filePath, opts = {}) {
    const nowMs = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
    const db = loadDatabase();
    // v1.65 gate round 2 (adversarial W2, the v1.48 mutually-masking-guards
    // class): this function used to carry its own covering-record/same-inode
    // branch, redundant with the scan's leftover reconcile -- which runs
    // EARLIER in the same per-file loop and consumes the tombstone, so a
    // record-covered same-inode dirent can never reach this function. The
    // branch is deleted rather than bound; a DIFFERENT-inode file at a
    // tombstoned path falls through to the normal orphan move below
    // (recoverable in trash, never a blind unlink -- behavior-bound in
    // trash-gate-bindings).
    const originalId = getMediaId(filePath);
    const matchedRoot = matchRootFolder(filePath, configuredLibraryRoots(db));
    const { trashDir, trashPath } = computeTrashTarget(filePath, originalId, matchedRoot, nowMs);
    const trashId = getMediaId(trashPath);

    fs.mkdirSync(trashDir, { recursive: true });
    fs.linkSync(filePath, trashPath); // throws verbatim -- see the contract above

    try {
      await updateDatabase((freshDb) => {
        const ext = path.extname(filePath).toLowerCase();
        // Wave 3: a media_trash row, minted inside this mutator's save transaction.
        const leftoverRecord = {
          originalId,
          originalPath: filePath,
          trashPath,
          trashedAt: nowMs,
          rootFolder: matchedRoot || null,
          item: {
            id: originalId, filePath, name: path.basename(filePath),
            title: path.basename(filePath, path.extname(filePath)),
            ext, type: AUDIO_EXTENSIONS.includes(ext) ? 'audio' : 'video',
            // Marks the minimal snapshot: a restore re-indexes for the rest.
            orphanedByDeferredDelete: true,
          },
        };
        inSaveTransaction(() => trashStore.set(trashId, leftoverRecord));
        return true;
      });
    } catch (err) {
      try { fs.unlinkSync(trashPath); } catch (_) { /* best-effort rollback */ }
      const wrapped = new Error(`trash record write failed: ${err.message}`);
      wrapped.code = 'ETRASHDB';
      throw wrapped;
    }

    // Narrow-matched subtitle carry into the trash dir (trashBase naming, so
    // a restore's reverse sweep finds them). Best-effort.
    try {
      const dir = path.dirname(filePath);
      const base = path.basename(filePath, path.extname(filePath));
      const trashBase = path.basename(trashPath, path.extname(trashPath));
      const sidecarSuffix = /^\.(?:[A-Za-z0-9_-]{1,15}\.)?(?:vtt|srt)$/i;
      for (const name of fs.readdirSync(dir)) {
        if (!name.startsWith(`${base}.`)) continue;
        const suffix = name.slice(base.length);
        if (!sidecarSuffix.test(suffix)) continue;
        try {
          const to = path.join(trashDir, trashBase + suffix);
          if (!fs.existsSync(to)) fs.renameSync(path.join(dir, name), to);
        } catch (_) { /* best-effort */ }
      }
    } catch (_) { /* best-effort */ }

    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      // Bytes + record are safe in trash; the leftover dirent re-indexes on
      // the next scan and a re-delete routes through the normal trash path.
      console.error(`Scan: orphan moved to ${trashPath} but the old dirent ${filePath} could not be removed:`, err.message);
    }
    return trashPath;
  }

  // restoreTrashItem: the exact reverse of trashItem -- link back to the
  // original path, ONE mutator (media_trash record -> db.metadata + doc-table
  // carries + sidecar renames back), rollback on failure, post-commit
  // rekeyInFlightState (all nine carriers re-link: the restored id IS the
  // pre-trash id, md5 of the same path). Ruling 4's full-fidelity promise
  // lives here.
  //
  // Unlike trashItem, restore DOES inherit the move's mutator-A discipline: it
  // re-occupies a REAL library path, and a deletion tombstone at that path
  // (e.g. the user trashed A, downloaded a new file to the same path, then
  // removeAnyway'd it) would let the scan reap the restored file -- a hard
  // link preserves mtime, so the mtime guard is no defense. The tombstone is
  // retired FIRST, in its own committed mutator, before any FS op.
  async function restoreTrashItem(deps, trashId) {
    const d = deps || {};
    const loadDb = d.loadDatabase;
    const updateDb = d.updateDatabase;
    const computeId = d.getMediaId;
    const fsImpl = d.fs || fs;
    if (typeof loadDb !== 'function' || typeof updateDb !== 'function' || typeof computeId !== 'function') {
      return { ok: false, status: 500, error: 'restoreTrashItem: missing required deps' };
    }

    const db = loadDb();
    const rec = trashStore.get(trashId) || null; // Wave 3: the table
    if (!rec) {
      return { ok: false, status: 404, error: 'Trash item not found' };
    }
    const originalPath = rec.originalPath;
    const trashPath = rec.trashPath;
    const originalId = computeId(originalPath);

    // v1.65 gate fix (adversarial C2): both paths reach FS ops verbatim and
    // records can arrive from a restore bundle -- confine BEFORE anything
    // runs. trashPath must sit directly inside a trash dir; originalPath must
    // land inside a configured library root OR under the trash dir's own
    // parent (the dirname-fallback layout trashItem uses for unattributable
    // files). A malformed record is purge-only (purge retires it without
    // touching the filesystem).
    const placement = trashRecordPlacement(rec, configuredLibraryRoots(db));
    if (!placement.restorable) {
      return { ok: false, status: 400, error: 'This trash record is malformed and cannot be restored -- purge it instead' };
    }

    // v1.65 gate fix (adversarial W9): a crash between a previous restore's
    // link and its mutator leaves originalPath and trashPath as the SAME
    // inode with the record still present -- which used to be a permanent 409
    // stranding the carriers at the trashId until the sweep destroyed them.
    // Detect that half-restored state precisely (same device + inode) and
    // COMPLETE the restore (skip the link); anything else at the path is a
    // genuine conflict.
    let alreadyLinked = false;
    if (fsImpl.existsSync(originalPath)) {
      try {
        const a = fsImpl.statSync(originalPath);
        const b = fsImpl.statSync(trashPath);
        alreadyLinked = a.ino !== undefined && a.ino === b.ino && a.dev === b.dev;
      } catch (_) { /* either stat failing means this is not our half-state */ }
      if (!alreadyLinked) {
        return { ok: false, status: 409, error: 'A file already exists at the original location -- move or delete it first, then restore again' };
      }
    }
    if (!alreadyLinked && !fsImpl.existsSync(trashPath)) {
      // The bytes vanished out-of-band (manual cleanup inside the trash dir).
      // The record is KEPT -- purge is the honest way to retire it.
      return { ok: false, status: 404, error: 'The trashed file is missing on disk -- it can only be purged' };
    }

    // Mutator A (the move's discipline): retire the DESTINATION tombstone in
    // its own committed mutator BEFORE any FS write -- but AFTER the
    // occupancy/confinement checks above (adversarial S4: a refused restore
    // must not have consumed the destination's tombstone as a side effect).
    try {
      await updateDb(() => {
        // Wave 2: a row, retired inside this mutator's own committed save transaction.
        if (!tombstoneStore.has(originalId)) return false;
        inSaveTransaction(() => tombstoneStore.remove(originalId));
        return true;
      });
    } catch (err) {
      return { ok: false, status: 500, error: `Could not clear the destination's deletion tombstone: ${err.message}` };
    }

    try {
      if (!alreadyLinked) {
        fsImpl.mkdirSync(path.dirname(originalPath), { recursive: true });
        fsImpl.linkSync(trashPath, originalPath);
      }
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        return { ok: false, status: 409, error: 'A file already exists at the original location -- move or delete it first, then restore again' };
      }
      if (err && err.code === 'ENOENT') {
        return { ok: false, status: 404, error: 'The trashed file is missing on disk -- it can only be purged' };
      }
      if (err && RECOVERABLE_DELETE_CODES.has(err.code)) {
        return { ok: false, status: 409, code: err.code, error: `Could not restore the file (${err.code})` };
      }
      return { ok: false, status: 500, error: `Could not restore the file: ${err.message}` };
    }

    let mutatorResult;
    try {
      mutatorResult = await updateDb((freshDb) => {
        const freshRec = trashStore.get(trashId); // Wave 3: the LIVE table, inside the write chain
        if (!freshRec) return false;

        // Rebuild the metadata entry from the snapshot; id/filePath/name are
        // recomputed from the ORIGINAL path (originalId is md5(originalPath)
        // by construction, never trusted from the record). An orphan record
        // (the deferred-retry's minimal snapshot) restores too; the next scan
        // enriches it.
        freshDb.metadata[originalId] = {
          ...freshRec.item,
          id: originalId,
          filePath: originalPath,
          name: path.basename(originalPath),
          folderName: path.basename(path.dirname(originalPath)) || freshRec.item.folderName,
        };
        // Wave 3: the trash record retires inside this save transaction (the
        // same commit that re-creates the metadata entry - never a dangling
        // record, never a re-created entry without its record gone).
        // Wave 2: the frozen pre-auth position rides trashId -> originalId
        // inside this save transaction; both ids' tombstones retire in the same one.
        inSaveTransaction(() => {
          trashStore.remove(trashId);
          progressStore.rekey(trashId, originalId);
          tombstoneStore.remove([originalId, trashId]);
        });
        inSaveTransaction(() => likedStore.rekey(trashId, originalId)); // Wave 4: and back out of it
        // (Wave 1: the view counter is relational - it re-keys trashId ->
        // originalId post-commit in rekeyInFlightState with the per-user carriers.)

        try {
          const trashThumb = path.join(THUMBNAIL_DIR, `${trashId}.jpg`);
          if (fsImpl.existsSync(trashThumb)) fsImpl.renameSync(trashThumb, path.join(THUMBNAIL_DIR, `${originalId}.jpg`));
        } catch (thumbErr) {
          console.error(`Restore: failed to re-key thumbnail for ${trashId} -> ${originalId}:`, thumbErr.message);
        }
        // v1.92: restore the storyboard sprite back to the original id too.
        try {
          if (fsImpl.existsSync(storyboardPath(trashId))) fsImpl.renameSync(storyboardPath(trashId), storyboardPath(originalId));
          if (fsImpl.existsSync(previewClipPath(trashId))) fsImpl.renameSync(previewClipPath(trashId), previewClipPath(originalId)); // v1.94 preview clip
        } catch (sbErr) {
          console.error(`Restore: failed to re-key storyboard for ${trashId} -> ${originalId}:`, sbErr.message);
        }
        try {
          if (fsImpl.existsSync(transcodedPath(trashId))) fsImpl.renameSync(transcodedPath(trashId), transcodedPath(originalId));
        } catch (transcodeErr) {
          console.error(`Restore: failed to re-key transcode sidecar for ${trashId} -> ${originalId}:`, transcodeErr.message);
        }
        try {
          if (fsImpl.existsSync(audioPath(trashId))) fsImpl.renameSync(audioPath(trashId), audioPath(originalId));
        } catch (audioErr) {
          console.error(`Restore: failed to re-key background-audio sidecar for ${trashId} -> ${originalId}:`, audioErr.message);
        }

        // Subtitles: the reverse of trashItem's carry -- sweep the trash dir
        // for the trash-side basename, restore each under the original one.
        try {
          const trashDir = path.dirname(trashPath);
          const trashBase = path.basename(trashPath, path.extname(trashPath));
          const origDir = path.dirname(originalPath);
          const origBase = path.basename(originalPath, path.extname(originalPath));
          const sidecarSuffix = /^\.(?:[A-Za-z0-9_-]{1,15}\.)?(?:vtt|srt)$/i;
          for (const name of fsImpl.readdirSync(trashDir)) {
            if (!name.startsWith(`${trashBase}.`)) continue;
            const suffix = name.slice(trashBase.length);
            if (!sidecarSuffix.test(suffix)) continue;
            try {
              const to = path.join(origDir, origBase + suffix);
              if (!fsImpl.existsSync(to)) fsImpl.renameSync(path.join(trashDir, name), to);
            } catch (_) { /* best-effort */ }
          }
        } catch (subErr) {
          console.error(`Restore: failed to carry subtitle sidecars for ${trashId}:`, subErr.message);
        }

        return originalId;
      });
    } catch (err) {
      // Same last-link guard as the record-vanished branch below (gate round
      // 2, S-C symmetry): never unlink our fresh link unless the trash-side
      // link demonstrably survives.
      let trashSideSurvivesThrow = false;
      try { trashSideSurvivesThrow = fsImpl.existsSync(trashPath); } catch (_) { /* keep the bytes */ }
      if (trashSideSurvivesThrow) {
        try {
          fsImpl.unlinkSync(originalPath);
        } catch (unlinkErr) {
          console.error(`Restore: the database update failed and the restored copy at ${originalPath} could not be rolled back:`, unlinkErr.message);
        }
      } else {
        console.warn(`Restore: the database update failed AND the trash copy is gone -- keeping the restored bytes at ${originalPath} (the only remaining link).`);
      }
      return { ok: false, status: 500, error: `The database update failed, so the restore was rolled back (the trash copy is untouched): ${err.message}` };
    }

    if (mutatorResult === false) {
      // v1.65 gate fix (adversarial C1): the record vanishing mid-restore
      // means a concurrent purge (the route, or the retention sweep firing on
      // its timer) already unlinked the TRASH-side link -- our fresh link at
      // originalPath is then the ONLY remaining link to the inode, and
      // "rolling it back" would free the bytes forever (the seat's repro
      // measured exactly that). Only unlink when the trash-side link
      // demonstrably survives; otherwise KEEP the file -- the next scan
      // indexes it (an implicit carrier-less restore beats destroyed bytes).
      let trashSideSurvives = false;
      try { trashSideSurvives = fsImpl.existsSync(trashPath); } catch (_) { /* treat as gone: keep the bytes */ }
      if (trashSideSurvives) {
        try {
          fsImpl.unlinkSync(originalPath);
        } catch (err) {
          console.error(`Restore: record ${trashId} vanished mid-restore; could not remove the copy at ${originalPath}:`, err.message);
        }
      } else {
        console.warn(`Restore: record ${trashId} was purged mid-restore -- keeping the restored bytes at ${originalPath} (the only remaining link); the next scan will index them.`);
      }
      return { ok: false, status: 404, error: 'Trash item was removed before the restore could be recorded' };
    }

    // All nine carriers re-link to the ORIGINAL id (same path -> same md5).
    rekeyInFlightState(trashId, originalId, trashPath, originalPath);

    try {
      fsImpl.unlinkSync(trashPath);
    } catch (err) {
      // A leftover in the trash dir is invisible to scans and unreferenced by
      // any record -- the retention sweep's orphan pass retires it.
      console.error(`Restore: file restored to ${originalPath} but the trash copy ${trashPath} could not be removed:`, err.message);
    }

    return { ok: true, trashId, restoredId: originalId, originalPath };
  }

  // purgeTrashItem: the ONLY remaining true unlink for library media. Verified
  // destruction of ONE trash record's artifacts: the trash-side file, its
  // three id-keyed sidecars, its subtitle set, its doc-table rows, and every
  // per-user carrier row. Mints NO tombstone (the trash dir is unscanned; a
  // verified conclusion mints nothing).
  async function purgeTrashItem(deps, trashId) {
    const d = deps || {};
    const loadDb = d.loadDatabase;
    const updateDb = d.updateDatabase;
    const fsImpl = d.fs || fs;
    if (typeof loadDb !== 'function' || typeof updateDb !== 'function') {
      return { ok: false, status: 500, error: 'purgeTrashItem: missing required deps' };
    }

    const rec = trashStore.get(trashId) || null; // Wave 3: the table (loadDb stays a required dep for the doc-side gate below)
    if (!rec) {
      return { ok: false, status: 404, error: 'Trash item not found' };
    }
    const trashPath = rec.trashPath;
    // v1.65 gate fix (adversarial C2): this function unlinks rec.trashPath
    // VERBATIM, and records can arrive from a restore bundle. A record whose
    // trashPath does not sit directly inside a TRASH_DIR_NAME directory is
    // corrupt or hostile -- that path is NOT ours to unlink. Retire the
    // record and its carriers WITHOUT touching the filesystem.
    // QA S2: the shared predicate, not a third hand-copy -- round 4 exists
    // because a copy of exactly this rule diverged and destroyed bytes.
    const trashPathConfined = trashRecordPlacement(rec, []).trashConfined;
    if (!trashPathConfined) {
      console.warn(`Purge: unconfined trashPath on record ${trashId} (${trashPath}) -- retiring the record, touching NOTHING on disk.`);
    }

    if (trashPathConfined) {
    try {
      fsImpl.unlinkSync(trashPath);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        // Already gone out-of-band -- the desired end state holds; fall
        // through and retire the record + artifacts.
      } else if (err && RECOVERABLE_DELETE_CODES.has(err.code)) {
        // Record KEPT: purge again later (or the retention sweep retries).
        return { ok: false, status: 409, code: err.code, error: `Could not purge the file (${err.code})` };
      } else {
        return { ok: false, status: 500, error: `Could not purge the file: ${err.message}` };
      }
    }

    // Id-keyed sidecars + the subtitle set, best-effort.
    try { const p = path.join(THUMBNAIL_DIR, `${trashId}.jpg`); if (fsImpl.existsSync(p)) fsImpl.unlinkSync(p); } catch (_) { /* best-effort */ }
    try { if (fsImpl.existsSync(storyboardPath(trashId))) fsImpl.unlinkSync(storyboardPath(trashId)); } catch (_) { /* best-effort */ } // v1.92 sprite
    try { if (fsImpl.existsSync(previewClipPath(trashId))) fsImpl.unlinkSync(previewClipPath(trashId)); } catch (_) { /* best-effort */ } // v1.94 preview clip
    try { if (fsImpl.existsSync(transcodedPath(trashId))) fsImpl.unlinkSync(transcodedPath(trashId)); } catch (_) { /* best-effort */ }
    try { if (fsImpl.existsSync(audioPath(trashId))) fsImpl.unlinkSync(audioPath(trashId)); } catch (_) { /* best-effort */ }
    try {
      const trashDir = path.dirname(trashPath);
      const trashBase = path.basename(trashPath, path.extname(trashPath));
      const sidecarSuffix = /^\.(?:[A-Za-z0-9_-]{1,15}\.)?(?:vtt|srt)$/i;
      for (const name of fsImpl.readdirSync(trashDir)) {
        if (!name.startsWith(`${trashBase}.`)) continue;
        if (!sidecarSuffix.test(name.slice(trashBase.length))) continue;
        try { fsImpl.unlinkSync(path.join(trashDir, name)); } catch (_) { /* best-effort */ }
      }
    } catch (_) { /* best-effort -- e.g. the trash dir itself is gone */ }
    } // end trashPathConfined -- the id-keyed sidecar unlinks above are safe
      // either way (our own DATA_DIR caches keyed by trashId), but they sit
      // inside the gate with the rest for simplicity of reasoning.

    try {
      await updateDb((freshDb) => {
        // Wave 3: the trash record, and (Wave 2) the frozen pre-auth position
        // and the tombstone under the trashId, are purged inside this save
        // transaction.
        inSaveTransaction(() => {
          trashStore.remove(trashId);
          progressStore.remove(trashId);
          tombstoneStore.remove(trashId);
        });
        // (Wave 1: the relational view counter is removed post-commit below.)
        inSaveTransaction(() => likedStore.remove(trashId)); // Wave 4: the frozen like goes with the purge
        clearPersistedServedAt(trashId);
        return true;
      });
    } catch (err) {
      return { ok: false, status: 500, error: `The file was purged but the record could not be removed: ${err.message}` };
    }

    try {
      userStore.removeMediaState(trashId);
    } catch (err) {
      console.error(`Purge: failed to remove per-user rows for ${trashId} (continuing):`, err.message);
    }
    // Wave 1: the relational view counter is purged with the record.
    try {
      viewCountStore.remove(trashId);
    } catch (err) {
      console.error(`Purge: failed to remove the view count for ${trashId} (continuing):`, err.message);
    }

    return { ok: true, trashId };
  }

  // sweepTrash: the retention auto-purge (ruling 1). Record-driven pass first
  // (purgeTrashItem per expired record -- the only true unlink path, itself
  // confined to TRASH_DIR_NAME paths, gate fix C2), then an ORPHAN pass over
  // the trash directories themselves: files referenced by NO record (crash
  // windows whose rollback unlink failed, restore leftovers) age by CTIME --
  // a hard link PRESERVES mtime (could be years old the moment it lands) but
  // link creation bumps ctime, so ctime is "when this appeared in the trash
  // dir". MEDIA orphans under the link-first discipline have their bytes safe
  // elsewhere; SUBTITLE sidecars carried beside a live record do NOT (gate
  // fix W4) -- so the pass skips anything whose name prefix-matches a
  // referenced record's trash-side basename. The sweep never touches a path
  // outside a directory literally named TRASH_DIR_NAME (belt, bound by test).
  // `now` injectable for tests. Runs at boot + on the scan timer slot (the
  // books/music piggyback precedent -- no second timer).
  async function sweepTrash(now = Date.now()) {
    const db = loadDatabase();
    // v1.65 gate fix (adversarial C2 amplifier): the POST route validates the
    // allowed set, but a restored bundle's settings arrive verbatim -- a
    // smuggled 1e-9 would purge the whole trash on the next sweep. Clamp to
    // the SAME allowed set here; anything else falls back to the default.
    const raw = settingsStore.getKey('trashRetentionDays'); // Wave 4
    const days = TRASH_RETENTION_DAYS_VALID_VALUES.has(raw) ? raw : DEFAULT_SETTINGS.trashRetentionDays;
    if (days <= 0) return 0; // 0 = keep forever
    const maxAgeMs = days * 86400000;
    let purged = 0;

    const sweepRoots = configuredLibraryRoots(db).filter((r) => typeof r === 'string' && r !== '');
    // Wave 3: the retention query runs on the typed trashed_at column - a record
    // with no numeric trashedAt is never returned (the v1.65 rule, unchanged),
    // and the boundary is the same strict `now - trashedAt > maxAgeMs`.
    for (const [tid, rec] of Object.entries(trashStore.expiredBefore(now - maxAgeMs))) {
      if (!rec) continue;
      // Gate round 3 (adversarial S-2): NEVER auto-destroy a record the user
      // cannot currently restore. If restore would refuse this record (its
      // destination sits neither under a configured root nor under the trash
      // dir's own parent -- e.g. a library folder removed from the config),
      // leave it standing for an EXPLICIT purge instead of silently reaping
      // it in the background.
      // ONE predicate, shared with restoreTrashItem (gate round 4 W1).
      if (!trashRecordPlacement(rec, sweepRoots).restorable) {
        console.warn(`Trash sweep: ${tid} is past retention but NOT restorable right now (its library folder may be unconfigured) -- keeping it; purge it explicitly to remove it.`);
        continue;
      }
      const result = await purgeTrashItem({ loadDatabase, updateDatabase }, tid);
      if (result.ok) purged += 1;
      else console.warn(`Trash sweep: could not purge ${tid} (${result.error}) -- will retry next sweep.`);
    }

    try {
      const fresh = loadDatabase();
      const liveTrash = trashStore.getAll(); // Wave 3: the table, read AFTER the purges above
      const referenced = new Set(Object.values(liveTrash).map((r) => r && r.trashPath).filter(Boolean));
      // Gate fix W4: a live record's subtitle sidecars share its trash-side
      // basename -- referenced in spirit, bytes exist nowhere else.
      const referencedBases = new Set();
      for (const p of referenced) referencedBases.add(path.basename(p, path.extname(p)));
      const trashDirs = new Set(configuredLibraryRoots(fresh).map((r) => path.join(r, TRASH_DIR_NAME)));
      for (const r of Object.values(liveTrash)) {
        if (r && r.trashPath) trashDirs.add(path.dirname(r.trashPath));
      }
      for (const dir of trashDirs) {
        // Confinement belt: only ever sweep inside a directory NAMED as the
        // trash dir -- a corrupted record's dirname can never widen the blast
        // radius to a real library folder.
        if (path.basename(dir) !== TRASH_DIR_NAME) continue;
        let names;
        try { names = fs.readdirSync(dir); } catch { continue; }
        for (const name of names) {
          const full = path.join(dir, name);
          if (referenced.has(full)) continue;
          let coveredByRecord = false;
          for (const b of referencedBases) {
            if (name.startsWith(b)) { coveredByRecord = true; break; }
          }
          if (coveredByRecord) continue; // gate fix W4: a live record's sidecar set
          try {
            const st = fs.statSync(full);
            if (!st.isFile()) continue;
            if (now - st.ctimeMs > maxAgeMs) {
              fs.unlinkSync(full);
              console.log(`Trash sweep: removed an unreferenced trash-dir orphan past retention: ${full}`);
            }
          } catch { /* best-effort per entry */ }
        }
      }
    } catch (err) {
      console.warn('Trash sweep: orphan pass failed (continuing):', err && err.message);
    }

    return purged;
  }

  return {
    trashItem, trashOrphanFile, restoreTrashItem, purgeTrashItem, sweepTrash,
  };
}

// The four /api/trash routes, in their server.js order (GET, then purge-all
// BEFORE the `:id` routes - the v1.64 static-segment-first rule).
function registerRoutes(app, deps) {
  const {
    getMediaId, // handed to restoreTrashItem's deps bundle
    loadDatabase,
    path, // the listing's basename fallbacks
    purgeTrashItem, // from createTrashOps above - the single + bulk purge
    refuseIfReadOnlyMedia, // the read-only-mount refusal (second guard)
    requireModifyLibrary, // v1.81 write-RBAC (first guard)
    restoreTrashItem, // from createTrashOps above
    settingsStore, // the listing reports retentionDays
    trashRecordVisibleTo, // v1.80 RBAC: the ONE visibility predicate GET and every purge path share
    trashStore, // lib/media/trashRecords - the media_trash table
    updateDatabase,
  } = deps;

  // ---- v1.65 trash routes -----------------------------------------------------
  // GET lists newest-first (items render from the stored metadata snapshot, and
  // /thumbnail/<trashId> works - the sidecar re-keyed with the move). Mutations:
  // restore is a POST under the id, single-purge is DELETE under the id, and
  // v1.158 added POST /api/trash/purge-all (bulk "Empty trash"). There is still NO
  // collection-wide DELETE /api/trash (the v1.64 route-alias lesson - an empty-id
  // DELETE matches no route). v1.80 RBAC: a restricted member must not even see a
  // restricted item's TITLE/existence in the trash - so GET and EVERY purge path
  // (single + bulk) filter by the SAME shared trashRecordVisibleTo predicate, so
  // the set a member can list is exactly the set they can destroy (admin's empty
  // index keeps everything).
  app.get('/api/trash', (req, res) => {
    const retentionDays = Number(settingsStore.getKey('trashRetentionDays')); // Wave 4
    const items = Object.entries(trashStore.getAll()) // Wave 3: the table
      .filter(([, rec]) => trashRecordVisibleTo(req, rec)) // the ONE predicate (shared with purge/restore)
      .map(([tid, rec]) => ({
        trashId: tid,
        originalId: rec.originalId,
        originalPath: rec.originalPath,
        trashedAt: rec.trashedAt,
        rootFolder: rec.rootFolder || null,
        title: (rec.item && (rec.item.title || rec.item.name)) || path.basename(rec.originalPath || ''),
        name: (rec.item && rec.item.name) || path.basename(rec.originalPath || ''),
        type: (rec.item && rec.item.type) || 'video',
        ext: (rec.item && rec.item.ext) || '',
        size: (rec.item && rec.item.size) || 0,
        duration: (rec.item && rec.item.duration) || 0,
        orphaned: !!(rec.item && rec.item.orphanedByDeferredDelete),
      }))
      .sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0));
    res.json({
      items,
      total: items.length,
      // v1.158 (Dean): the total bytes the VISIBLE trash holds - what "Empty
      // trash" reclaims. Summed over the SAME visibility-filtered set, so the
      // figure the client shows == what purge-all frees. Orphans with no snapshot
      // size contribute 0 (best-effort; disclosed).
      totalSizeBytes: items.reduce((sum, it) => sum + (Number(it.size) || 0), 0),
      retentionDays: Number.isFinite(retentionDays) ? retentionDays : null,
    });
  });

  // v1.158 (Dean): "Empty trash" - permanently purge EVERY trash item the
  // requester can see, in one call. Destructive: same three guards as the single-
  // item DELETE below (write-RBAC, read-only refusal, per-item visibility), and
  // it enumerates the SAME visibility-filtered set GET /api/trash returns - a
  // restricted member purges ONLY their visible items, never a hidden one (v1.80/
  // v1.81 route-count-lock class). Registered BEFORE POST /api/trash/:id/restore
  // so the static `purge-all` segment can never be captured as an `:id`.
  app.post('/api/trash/purge-all', async (req, res) => {
    if (!requireModifyLibrary(req, res)) return; // v1.81 write-RBAC (first guard)
    if (refuseIfReadOnlyMedia(res)) return;
    // Snapshot the visible id set + each record's size BEFORE any purge (each
    // purgeTrashItem reloads + mutates the db; freedBytes must read the size from
    // the pre-purge snapshot).
    const targets = Object.entries(trashStore.getAll()) // Wave 3: the table
      .filter(([, rec]) => trashRecordVisibleTo(req, rec))
      .map(([tid, rec]) => ({ tid, size: (rec.item && Number(rec.item.size)) || 0 }));
    let purgedCount = 0;
    let freedBytes = 0;
    const failures = [];
    for (const { tid, size } of targets) {
      // Sequential on purpose: purgeTrashItem reload/mutates the db per call;
      // concurrent purges would race the write.
      const result = await purgeTrashItem({ loadDatabase, updateDatabase }, tid);
      if (result.ok) { purgedCount += 1; freedBytes += size; }
      else failures.push({ tid, error: result.error, code: result.code });
    }
    res.json({ success: failures.length === 0, purgedCount, freedBytes, failures });
  });

  app.post('/api/trash/:id/restore', async (req, res) => {
    if (!requireModifyLibrary(req, res)) return; // v1.81 write-RBAC (first guard)
    if (refuseIfReadOnlyMedia(res)) return;
    // v1.123 T3 (security): visibility axis. requireModifyLibrary gates the
    // capability; a member holding it but RESTRICTED from the item's folder must
    // still not re-materialize it. 404 (neutral - same as a missing id below).
    if (!trashRecordVisibleTo(req, trashStore.get(req.params.id))) {
      return res.status(404).json({ error: 'Trash item not found' });
    }
    const result = await restoreTrashItem({ loadDatabase, updateDatabase, getMediaId }, req.params.id);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, ...(result.code ? { code: result.code } : {}) });
    }
    res.json({ success: true, restoredId: result.restoredId, originalPath: result.originalPath });
  });

  app.delete('/api/trash/:id', async (req, res) => {
    if (!requireModifyLibrary(req, res)) return; // v1.81 write-RBAC (first guard)
    if (refuseIfReadOnlyMedia(res)) return;
    // v1.123 T3 (security): visibility axis - purge PERMANENTLY destroys the file,
    // so a capable-but-restricted member must never reach it for a hidden item.
    // 404 (neutral - same as a missing id below).
    if (!trashRecordVisibleTo(req, trashStore.get(req.params.id))) {
      return res.status(404).json({ error: 'Trash item not found' });
    }
    const result = await purgeTrashItem({ loadDatabase, updateDatabase }, req.params.id);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, ...(result.code ? { code: result.code } : {}) });
    }
    res.json({ success: true });
  });
}

module.exports = { createTrashOps, registerRoutes };
