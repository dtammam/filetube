'use strict';

// lib/media/move.js - the library item MOVER: `computeMoveTarget` (pure,
// zero-filesystem destination resolution + confinement) and
// `moveItemToFolder` (the atomically-exclusive physical move, then the id
// re-key of db.metadata and every id-keyed carrier and sidecar). Both moved
// VERBATIM out of server.js in Wave 7b, slice S5, of the relational-migration
// arc (docs/exec-plans/completed/2026-09-13-sqlite-relational-migration.md): the
// bodies are byte-identical to the server.js originals, their free identifiers
// resolving from the `const { ... } = deps` destructure of the factory
// server.js calls once at boot (the lib/books/scanRunner.js +
// lib/music/scanRunner.js pattern). A missing dep is a hard failure (a
// destructured undefined that is later called throws), never a silent fallback.
//
// A FACTORY, not a registerRoutes module: only the two movers moved. Their
// caller-visible contract is unchanged - both still take their own `deps`
// ARGUMENT (`{ loadDatabase, updateDatabase, getMediaId, fs? }`), which is how
// the routes, the import relocation and T19's physical reconcile already call
// them; the factory bundle carries the module-scope collaborators that used to
// be in scope by being in the same file.
//
// What stays in server.js and crosses as a dep, with the reason:
//   - `configuredLibraryRoots` - ten callers (the scan, the routes, the
//     relocation planners), and it reads `folderStore`/`ytdlp`;
//   - `hashFileStreaming` - server.js exports it for unit coverage;
//   - `rekeyInFlightState` - the post-commit carry the move, the trash and the
//     restore all pass through; it owns `pendingProgress`, `persistedServedAt`
//     and `recentlyServed`, whose other readers and writers are all still in
//     server.js (the R2 mutable-state rule: state moves with ALL its readers
//     and writers or not at all);
//   - `destroyMediaStreams`, the four sidecar path helpers, the four stores.
// NOTHING crosses as a live accessor: an AST pass over server.js's module scope
// shows every one of the 16 deps is a `const` or a hoisted function
// declaration, never a reassigned `let` - so the destructure below cannot
// freeze a seam the way S1a's DNS lookup and R2's `ffmpegAvailable` would have.
//
// Comment fidelity: the two JSDoc blocks and the C1 grounding-fact block below
// came with the functions. Three positional references were corrected because
// they would now LIE, all of them in comments, never in a moved body:
// `computeMoveTarget`'s two "(`configuredLibraryRoots`, above/below)" now say
// "server.js", and `moveItemToFolder`'s "every other route in this file" now
// says "in server.js".

function createMoveOps(deps) {
  const {
    THUMBNAIL_DIR, // the id-keyed thumbnail/storyboard/preview directory
    audioPath, // the .m4a background-audio sidecar path for an id
    configuredLibraryRoots, // the allowed-roots list the confinement runs against (stays in server.js: ten callers)
    destroyMediaStreams, // closes OUR OWN read streams before the source unlink (v1.41.10)
    fs,
    hashFileStreaming, // the EXDEV branch's content verification (stays: exported for unit coverage)
    inSaveTransaction, // the re-key batches every store write into ONE commit
    likedStore,
    matchRootFolder, // lib/scanRoots - the rootFolder re-derivation
    path,
    previewClipPath,
    progressStore,
    rekeyInFlightState, // the POST-COMMIT process-memory + per-user carry (stays in server.js)
    storyboardPath,
    tombstoneStore,
    transcodedPath,
  } = deps;

  // ---- C1 (v1.24 UX Round, Wave 3): move files between folders + id re-key --
  //
  // LOAD-BEARING GROUNDING FACT (docs/exec-plans/completed/2026-07-09-v1.24-ux-round.md
  // Design section): `getMediaId(filePath)` is `md5(filePath)` -- the media id
  // is a hash of the PATH, not of content. Watch progress (the per-user rows and
  // the frozen pre-auth `media_progress` row - Wave 2 - keyed by `id`),
  // thumbnails (`THUMBNAIL_DIR/<id>.jpg`) and transcode sidecars
  // (`transcodedPath(id)`) are all keyed by that id. A naive `fs.rename`-then-
  // rescan would therefore make a moved file look like a delete (old id
  // pruned, progress lost) + a brand-new add (new id, no history). The two
  // functions below exist specifically to prevent that: `computeMoveTarget`
  // resolves + CONFINES the destination (pure, zero filesystem access) before
  // any FS op ever runs; `moveItemToFolder` does the FS move, then re-keys
  // `db.metadata` (doc) plus the progress / tombstone / frozen-like rows
  // (relational since Waves 2-4, inside the same save transaction) and the
  // view counter (post-commit in rekeyInFlightState) and renames the
  // thumbnail/transcode/background-audio/subtitle sidecars from the OLD
  // path-derived id to the NEW one, all inside ONE `updateDatabase` mutator --
  // so the next scan finds the file already indexed under its new-path id and
  // takes the reuse fast-path, history intact, not a delete+new-add.
  //
  // v1.41.6 completed that list. `db.liked` (v1.30) and the `.m4a`
  // background-audio sidecar (v1.35) were both added to the app AFTER this
  // function was written and never joined its re-key -- so every move silently
  // dropped the item's Like and orphaned its audio sidecar -- and
  // `deleteTombstones` (v1.41.3) could reap the moved file at its destination.
  // The one thing that is deliberately NOT id-keyed and therefore needs nothing
  // here: `db.ytdlp.pins`, whose `id` is `getMediaId(channelDir)` -- a hash of a
  // FOLDER, not of a media file (see lib/ytdlp/store.js's pin comment) -- so no
  // media move can ever invalidate a pin.

  /**
   * Pure: resolve and CONFINE a move's destination. `filePath` is the item's
   * CURRENT on-disk path (trusted -- it is already indexed in `db.metadata`);
   * `targetFolder` is UNTRUSTED client input; `allowedRoots` is the server's
   * own configured library roots (`configuredLibraryRoots`, server.js). No
   * filesystem access happens in this function at all -- callers can reject an
   * escaping target before any FS op ever runs.
   *
   * Confinement discipline mirrors `lib/ytdlp/args.js`'s `isPathUnder`/
   * `resolveChannelDir`: resolve BOTH sides with `path.resolve`, then require
   * exact equality OR `startsWith(root + path.sep)` -- never a bare
   * `startsWith(root)` string check, which a sibling directory sharing a
   * prefix (e.g. target `/media/lib2` against allowed root `/media/lib`) would
   * wrongly pass.
   *
   * TRUST BOUNDARY (mirrors `normalizeScanRoot`'s own scan-root posture
   * comment, above `runScanDirectories`): this confinement is a LEXICAL
   * `path.resolve` boundary and deliberately does NOT `fs.realpathSync`/
   * dereference symlinks -- doing so here would have the exact same
   * `getMediaId`-hash-stability hazard FIX-1 documents for scan roots (a
   * resolved spelling changes the absolute path, which changes the path-hashed
   * id). `allowedRoots` (`configuredLibraryRoots`, server.js) is therefore an
   * OPERATOR-TRUSTED, absolute/canonical surface, not something re-verified
   * against the real filesystem tree at move time: a symlink an operator
   * chooses to plant inside a configured root is out of the external threat
   * model on this single-user LAN box, same as everywhere else this codebase
   * makes that call.
   *
   * v1.41.6 (`opts.newBaseName`, OPTIONAL): the move may also RENAME the file.
   * The reheat's import-relocation (see `relocateHydratedImportIntoChannelFolder`)
   * needs the destination to carry the NATIVE yt-dlp filename shape
   * (`<title> [<videoId>].<ext>`) so a future scan re-derives the video id from
   * the filename bracket exactly like a real download's. Omitted (every
   * pre-existing caller) => the source basename is preserved verbatim, byte for
   * byte, as before. Supplied => it must be a bare, single-segment filename:
   * anything carrying a path separator, or `.`/`..`, is REJECTED here (a pure
   * decision, before any FS op) rather than normalized -- a rename is the one
   * place a caller-built string re-enters the path layer, so it gets the same
   * "verify what was actually built, never assume" treatment as the folder.
   *
   * Returns `{ ok:true, newPath }` on success, `{ ok:false, error }` otherwise.
   */
  function computeMoveTarget(filePath, targetFolder, allowedRoots, opts = {}) {
    if (typeof filePath !== 'string' || filePath === '') {
      return { ok: false, error: 'invalid source file path' };
    }
    if (typeof targetFolder !== 'string' || targetFolder.trim() === '') {
      return { ok: false, error: 'targetFolder is required' };
    }
    const roots = Array.isArray(allowedRoots) ? allowedRoots : [];
    const resolvedTarget = path.resolve(targetFolder);
    const confined = roots.some((root) => {
      if (typeof root !== 'string' || root === '') return false;
      const resolvedRoot = path.resolve(root);
      return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
    });
    if (!confined) {
      return { ok: false, error: 'targetFolder is outside every configured/allowed library folder' };
    }

    const rename = (opts && typeof opts.newBaseName === 'string') ? opts.newBaseName : null;
    if (rename !== null) {
      // A caller-supplied destination NAME. `path.basename(rename) === rename`
      // is the structural check: it fails for `a/b`, `../x`, `x/` and (on
      // Windows spellings) `a\b`, so no rename can ever add a path segment or
      // climb out of the confined folder.
      if (rename.trim() === '' || rename === '.' || rename === '..' || path.basename(rename) !== rename) {
        return { ok: false, error: 'invalid destination file name' };
      }
    }
    const baseName = rename !== null ? rename : path.basename(filePath);
    if (!baseName || baseName === '.' || baseName === '..') {
      return { ok: false, error: 'invalid source file path' };
    }
    const newPath = path.join(resolvedTarget, baseName);
    // Defense-in-depth re-check on the FINAL joined path -- mirrors
    // `resolveChannelDir`'s own post-join re-check. `path.basename` can never
    // itself reintroduce a path separator, but this keeps the same "verify what
    // was actually built, never assume" discipline used elsewhere (SF4).
    if (newPath !== resolvedTarget && !newPath.startsWith(resolvedTarget + path.sep)) {
      return { ok: false, error: 'resolved destination escapes the target folder' };
    }

    if (path.resolve(filePath) === newPath) {
      return { ok: false, error: 'source and destination are the same file' };
    }

    return { ok: true, newPath };
  }

  /**
   * Move a library item to another configured folder, re-keying its id and
   * every id-keyed sidecar. `deps` ({ loadDatabase, updateDatabase, getMediaId,
   * fs? }) is accepted (rather than closing over this module's own state
   * directly) so a DIFFERENT module can call this the same way `registerRoutes`/
   * `startBackground` receive their own deps bundle from server.js -- T19
   * (Wave 7, B2 Phase 2) reuses this exact function for its physical-reconcile
   * move, without re-touching server.js. `deps.fs` is an optional filesystem
   * override (defaults to the real `fs` module) purely for deterministic
   * EXDEV-fallback test coverage; every real caller omits it.
   *
   * Returns `{ ok:true, oldId, newId, newPath }` on success, or
   * `{ ok:false, status, error }` on any failure -- never throws for an
   * anticipated failure (missing item, confinement reject, FS error,
   * concurrent delete); a genuinely unexpected error still propagates so the
   * caller's own try/catch (mirroring every other route in server.js) can log
   * and 500.
   *
   * @param {{loadDatabase: Function, updateDatabase: Function, getMediaId: Function, fs?: object}} deps
   * @param {string} id current media id
   * @param {string} targetFolder untrusted client-supplied destination folder
   * @param {{newBaseName?: string}} [opts] v1.41.6: optionally RENAME the file as
   *   part of the move (see `computeMoveTarget`'s own `opts` contract). Omitted
   *   by every pre-existing caller -- the basename is preserved as before.
   */
  async function moveItemToFolder(deps, id, targetFolder, opts = {}) {
    const d = deps || {};
    const loadDb = d.loadDatabase;
    const updateDb = d.updateDatabase;
    const computeId = d.getMediaId;
    const fsImpl = d.fs || fs;
    if (typeof loadDb !== 'function' || typeof updateDb !== 'function' || typeof computeId !== 'function') {
      return { ok: false, status: 500, error: 'moveItemToFolder: missing required deps (loadDatabase/updateDatabase/getMediaId)' };
    }

    const db = loadDb();
    const item = db.metadata[id];
    if (!item) {
      return { ok: false, status: 404, error: 'Media file not found' };
    }

    const allowedRoots = configuredLibraryRoots(db);
    const target = computeMoveTarget(item.filePath, targetFolder, allowedRoots, opts);
    if (!target.ok) {
      return { ok: false, status: 400, error: target.error };
    }
    const { newPath } = target;
    const oldPath = item.filePath;

    // Destination collision FAST-PATH -- a friendly early 409 for the common
    // case (no FS write attempted at all). This check alone does NOT prevent a
    // clobber: two concurrent moves of same-basename files into this folder
    // can both observe `existsSync(newPath) === false` here and both proceed
    // (a classic TOCTOU race). Correctness rests on the WRITE below being
    // atomically exclusive, not on this pre-check -- see the comment there.
    if (fsImpl.existsSync(newPath)) {
      return { ok: false, status: 409, error: 'A file already exists at the destination' };
    }

    // v1.41.6 gate fix (adversarial CRITICAL -- ORDERING IS THE FIX, and it must
    // happen HERE, before a single byte moves).
    //
    // A v1.41.3 deletion tombstone at the DESTINATION path (`getMediaId(newPath)`)
    // tells the scan's deferred-delete retry "the user deleted this; if you ever
    // see a file at that path again with an older mtime, unlink it." Tombstones are
    // minted on any unverified delete -- including the wholly ordinary "the file
    // was already gone out-of-band, the user clicks Delete, the unlink ENOENTs"
    // case -- and they live for 90 days. `linkSync` (the same-volume path: the
    // ORDINARY Docker install) preserves the inode and therefore the ORIGINAL
    // mtime, so a file relocated into such a path matches that description exactly.
    //
    // Retiring the tombstone at the END of the move -- inside the same mutator as
    // the re-key, AFTER the source had been unlinked -- left a window in which the
    // only copy of the file sat at a path the database still said was deleted. A crash,
    // an OOM kill or a `docker compose down` in that window made the reap
    // PERMANENT; and a scan that had merely STARTED before the mutator committed
    // reaped it with no crash at all, from its stale Phase-1 snapshot.
    //
    // So the tombstone is retired FIRST, in its own committed mutator, before the
    // filesystem is touched. Crashing after this point loses a tombstone whose file
    // is still safely at its source -- the harmless direction. (The scan's own
    // re-verify, added in the same release, closes the in-flight-scan half; this
    // closes the crash half. Both are needed: neither alone is sufficient.)
    const newIdForTombstone = computeId(newPath);
    try {
      await updateDb(() => {
        // Wave 2: the tombstone is a row; retired inside this mutator's own
        // committed save transaction (a `true` return with no doc change still
        // opens the transaction for the queued effect).
        if (!tombstoneStore.has(newIdForTombstone)) return false;
        inSaveTransaction(() => tombstoneStore.remove(newIdForTombstone));
        return true;
      });
    } catch (err) {
      // Could not retire it -> we cannot prove the destination is safe to occupy.
      // Refuse the move rather than move a file into a path a scan may reap.
      return { ok: false, status: 500, error: `Could not clear the destination's deletion tombstone: ${err.message}` };
    }

    try {
      fsImpl.mkdirSync(path.dirname(newPath), { recursive: true });
    } catch (err) {
      return { ok: false, status: 500, error: `Could not prepare the destination folder: ${err.message}` };
    }

    // Atomically-EXCLUSIVE write -- this, not the `existsSync` fast-path above,
    // is what actually closes the TOCTOU race: `linkSync` (same device) and
    // `copyFileSync(..., COPYFILE_EXCL)` (cross device) both fail with EEXIST
    // if the destination is created between our fast-path check and here (e.g.
    // by a second, concurrent move of a same-basename file into this same
    // folder) -- neither primitive ever clobbers an existing destination.
    // Exactly one racer wins the exclusive create; the loser gets EEXIST and
    // reports the SAME 409 shape a pre-existing destination would.
    try {
      fsImpl.linkSync(oldPath, newPath);
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        return { ok: false, status: 409, error: 'A file already exists at the destination' };
      }
      if (err && err.code === 'ENOENT') {
        return { ok: false, status: 404, error: 'The source file no longer exists on disk' };
      }
      if (err && err.code === 'EXDEV') {
        // Cross-device: a hard link can't span filesystems -- fall back to an
        // EXCLUSIVE copy. `COPYFILE_EXCL` gives the identical atomic-exclusive
        // guarantee as `linkSync` above (fails with EEXIST rather than
        // clobbering a concurrently-created destination).
        //
        // v1.41.6: this branch is no longer the rare case. The reheat's
        // import-relocation moves Dean's MeTube library -- which may well sit on
        // a NAS/second volume -- into the yt-dlp download dir, so EXDEV is the
        // EXPECTED path there, and it is the one where a half-written
        // destination followed by an unlinked source would be real data loss.
        // Hence the verify-then-unlink discipline below: the copy is fsync'd, its
        // size is checked as a cheap pre-filter, and then (v1.41.7) its CONTENT is
        // checksum-verified against the source BEFORE the caller is allowed to
        // reach the `unlinkSync(oldPath)` further down; a short/torn/corrupt copy
        // takes the partial destination back out and fails the move with BOTH the
        // file and the db entry untouched.
        try {
          fsImpl.copyFileSync(oldPath, newPath, fs.constants.COPYFILE_EXCL);
        } catch (copyErr) {
          if (copyErr && copyErr.code === 'EEXIST') {
            return { ok: false, status: 409, error: 'A file already exists at the destination' };
          }
          return { ok: false, status: 500, error: `Could not move the file across devices: ${copyErr.message}` };
        }
        // Durability: `copyFileSync` does not itself fsync, so a power loss
        // between the copy and the source unlink could leave a destination whose
        // bytes never reached the platter while the ONLY other copy was removed.
        // Best-effort (a filesystem that refuses the fsync must not fail an
        // otherwise-good move) and `fsImpl`-guarded so a test's minimal fs stub
        // need not implement it.
        try {
          if (typeof fsImpl.openSync === 'function' && typeof fsImpl.fsyncSync === 'function') {
            const fd = fsImpl.openSync(newPath, 'r+');
            try { fsImpl.fsyncSync(fd); } finally { fsImpl.closeSync(fd); }
          }
        } catch (syncErr) {
          console.error(`Move: could not fsync the cross-device copy at ${newPath} (continuing):`, syncErr.message);
        }
        // SIZE-verify FIRST, as a cheap PRE-FILTER before the expensive hash:
        // destination genuinely present, and the same number of bytes. A mismatch
        // means a truncated/torn copy (ENOSPC on a filesystem that reports lazily,
        // a NAS write that silently short-wrote) -- take the bad destination back
        // out and leave the source exactly where it is. Fast to fail here before
        // hashing gigabytes.
        try {
          const srcSize = fsImpl.statSync(oldPath).size;
          const dstSize = fsImpl.statSync(newPath).size;
          if (srcSize !== dstSize) {
            try { fsImpl.unlinkSync(newPath); } catch (_) { /* best-effort cleanup of the bad copy */ }
            return {
              ok: false, status: 500,
              error: `Cross-device copy verification failed (${dstSize} of ${srcSize} bytes at the destination) -- the source file was left untouched`,
            };
          }
        } catch (statErr) {
          try { fsImpl.unlinkSync(newPath); } catch (_) { /* best-effort cleanup of the unverifiable copy */ }
          return {
            ok: false, status: 500,
            error: `Could not verify the cross-device copy (${statErr.message}) -- the source file was left untouched`,
          };
        }

        // v1.41.7 (Dean has NO media backup -- this is the WHOLE reason this exists):
        // SIZE-EQUAL IS NOT INTACT. A cross-filesystem copy (NAS -> local, an
        // overlay/fuse mount) can land the exact right number of bytes and still be
        // silently corrupted -- a flipped block, a torn-then-refilled write, a NAS
        // that lies about a completed flush. The OLD code unlinked the source on a
        // size match ALONE, which on this one path means deleting the only remaining
        // copy of an irreplaceable file on the strength of an unverified duplicate.
        // So the source is now unlinked ONLY after a full sha256 of BOTH files
        // matches, computed by streaming (constant memory -- see `hashFileStreaming`).
        //
        // COST, disclosed honestly (and surfaced in the preview UI): a
        // cross-filesystem move now reads every byte of the file TWICE -- once to
        // copy, once to hash each side. The same-filesystem `linkSync` path above
        // never reaches here and pays NOTHING: a hard link is the same inode, so
        // there is nothing to compare -- source and destination are literally the
        // same bytes on disk.
        //
        // On mismatch OR an unreadable file: remove the destination copy, leave the
        // source untouched, and fail honestly -- the caller (the reheat batch)
        // counts this into its existing failure counter, and the db entry has not
        // been touched (the re-key mutator below has not run yet).
        try {
          const [srcDigest, dstDigest] = await Promise.all([
            hashFileStreaming(oldPath, fsImpl),
            hashFileStreaming(newPath, fsImpl),
          ]);
          if (srcDigest !== dstDigest) {
            try { fsImpl.unlinkSync(newPath); } catch (_) { /* best-effort cleanup of the corrupt copy */ }
            return {
              ok: false, status: 500,
              error: 'Cross-device copy verification failed (sha256 checksum mismatch) -- the corrupt copy was removed and the source file was left untouched',
            };
          }
        } catch (hashErr) {
          try { fsImpl.unlinkSync(newPath); } catch (_) { /* best-effort cleanup of the unverifiable copy */ }
          return {
            ok: false, status: 500,
            error: `Could not checksum-verify the cross-device copy (${hashErr.message}) -- the copy was removed and the source file was left untouched`,
          };
        }
      } else {
        return { ok: false, status: 500, error: `Could not move the file: ${err.message}` };
      }
    }

    // The exclusive link/copy above succeeded: the file's bytes now exist at BOTH
    // oldPath and newPath (same inode via hard link, or an independent, size-
    // verified copy cross-device).
    //
    // v1.41.6 gate fix (QA WARNING -- FS/DB ORDERING). The source is NOT unlinked
    // yet: the DATABASE IS RE-KEYED FIRST, and the unlink happens only after that
    // mutator has committed (below). The old order (unlink, then re-key) left a
    // window -- not an instantaneous one; `updateDb` queues behind `dbWriteChain`
    // and can be backlogged for seconds during a scan -- in which the database pointed
    // at a path that no longer existed. Process death there cost the item its
    // entire history: the next scan pruned the old id (taking `db.progress` with
    // it, leaving a dangling `db.liked` entry) and re-added the file at its new
    // path as a STRANGER -- addedAt, progress, Like, chapters and the reheat marker
    // gone, and on the cross-device path `releaseDate` re-derived from a fresh
    // mtime, so it also jumped to the top of the default release-date sort.
    //
    // Re-keying first inverts the failure mode into the recoverable direction: a
    // crash between the link/copy and the unlink leaves a stray directory entry at
    // the old path -- a VISIBLE artifact (a same-inode hard link on the ordinary
    // same-volume path; a genuine duplicate on the cross-device path, consuming
    // real extra disk and NOT self-healing -- see the EXDEV branch) that the user
    // can simply delete -- while the db, the id, and every scrap of history are
    // already correct and pointing at a file that really is there.
    //
    // LOAD-BEARING INVARIANT (why re-keying before the unlink cannot race the
    // scan): everything from the exclusive link/copy through the `updateDb(...)`
    // call below runs SYNCHRONOUSLY in one tick -- the mutator is enqueued onto
    // `dbWriteChain` in the same tick the filesystem changed. So any scan whose
    // walk observed the POST-move filesystem necessarily enqueues its own final
    // merge AFTER ours, and sees the re-keyed item; and any scan that observed the
    // PRE-move filesystem is handled by the Phase-2 adoption/HR1b pair. There is no
    // interleaving in which a scan sees the new file but not the new id.
    const oldId = id;
    let mutatorResult;
    try {
      mutatorResult = await updateDb((freshDb) => {
        const freshItem = freshDb.metadata[oldId];
        if (!freshItem) return false; // concurrently deleted -- nothing left to re-key

        const newId = computeId(newPath);

        freshItem.filePath = newPath;
        freshItem.id = newId;
        // v1.41.6: the move may also have RENAMED the file (`opts.newBaseName`
        // -- the reheat's import-relocation gives the file its native
        // `<title> [<videoId>].<ext>` shape). `name` is the on-disk basename
        // everywhere else in this file (the scan sets it, and the FR-2 channel
        // bridge reads the `[id]` bracket back out of `path.basename(item.name,
        // item.ext)`), so leaving it on the OLD name would make the item lie
        // about its own file. Derived from `newPath`, never from the caller's
        // string.
        freshItem.name = path.basename(newPath);
        // Mirrors scanDirRecursive's own folderName derivation (immediate
        // parent dir basename) so the moved item's folder label doesn't go
        // stale until the next scan recomputes it anyway.
        freshItem.folderName = path.basename(path.dirname(newPath)) || freshItem.folderName;
        // v1.41.6: ...and the same for `rootFolder`, which the scan recomputes
        // from `matchRootFolder` (see runScanDirectories' reconcile loop) and
        // which hidden-folder filtering, `selectPrunableIds`' mount-loss guard
        // and `detectVanishedRoots` all attribute items by. Every PREVIOUS
        // caller moved a file WITHIN one root (the C1 route between library
        // folders is root-to-root, but the T4 one-off migration stays inside the
        // download root), so a stale value was survivable until the next scan.
        // The reheat's relocation crosses roots BY DEFINITION -- a plain library
        // root -> the yt-dlp download root -- so a stale `rootFolder` would
        // attribute the item to a root it no longer lives under. Recomputed from
        // the same `configuredLibraryRoots` the destination was confined against;
        // a `null` (unattributable) result keeps the existing value rather than
        // blanking it, since an item with no root is retained-not-pruned (guard
        // (3) in selectPrunableIds) and we must not weaken that by accident.
        const newRoot = matchRootFolder(newPath, configuredLibraryRoots(freshDb));
        if (newRoot) freshItem.rootFolder = newRoot;

        delete freshDb.metadata[oldId];
        freshDb.metadata[newId] = freshItem;

        // Wave 2: the frozen pre-auth position follows the re-key inside this
        // save transaction (it was a doc carry: progress[newId] = progress[oldId]).
        inSaveTransaction(() => progressStore.rekey(oldId, newId));

        // v1.30 C2: LIKED state is membership in `db.liked` (an ARRAY of media
        // ids -- there is no boolean on the item), so it is id-keyed exactly
        // like `db.progress` and has to follow the re-key. It did not, until
        // v1.41.6: every move since v1.30 (the C1 route, the T4 one-off
        // migration) silently DROPPED the item's Like -- the id in the array
        // stopped matching any item and the heart came back empty, with no way
        // for the user to know why. Written back in place (same index) so the
        // liked-view's array order -- which is what `likedItems` renders by --
        // is preserved rather than bumping the item to the end.
        // Wave 4: the frozen likes are a table; the re-key keeps the slot (the
        // liked-view's order) and rides the doc commit's transaction.
        inSaveTransaction(() => likedStore.rekey(oldId, newId));

        // (v1.42: `viewCounts` followed the re-key HERE as a doc carry - added
        // after the adversarial seat proved a move zeroed the moved item's count
        // and orphaned the old row, the v1.41.6 liked-drop class striking the one
        // field v1.42 extracted to protect. Wave 1: the counter is relational,
        // so it re-keys POST-COMMIT in rekeyInFlightState beside the per-user
        // rows - the move-files suite still locks that the count rides along.)
        // Every new id-keyed DOC namespace MUST be added to this mutator (and
        // to the delete/prune cleanups); every RELATIONAL carrier to
        // rekeyInFlightState + removeMediaState's sites.

        // NOTE (gate fix round 3, QA sub-note): the three MODULE-LEVEL maps this
        // move also has to re-key -- `pendingProgress`, `persistedServedAt`,
        // `recentlyServed` -- are deliberately NOT touched inside this mutator.
        // They are process memory, not part of `freshDb`, so a `saveDatabase` throw
        // would roll the database back while leaving them mutated: the in-flight
        // progress ping would end up keyed to a `newId` that has no metadata entry,
        // and `flushPendingProgress` would drop it. They are re-keyed AFTER this
        // mutator has committed instead (see `rekeyInFlightState`, below the
        // updateDb call), where the db and the maps can only ever agree.

        // v1.41.3 deletion tombstones (`{ [id]: { filePath, deletedAt } }`), also
        // id-keyed.
        //
        // `deleteTombstones[newId]` -- the DESTINATION's tombstone, the one that
        // can get the relocated file reaped -- is NOT retired here: it is retired
        // in its own committed mutator BEFORE the filesystem is touched (see the
        // big comment above the link/copy). Doing it here was the CRITICAL the gate
        // proved: by the time this mutator ran, the source was already gone and the
        // tombstone was still live on disk. This delete is kept only as a
        // belt-and-braces no-op for the ordinary case where the pre-move mutator
        // already removed it, and as the correct behavior for any caller that
        // reaches this mutator by another route.
        //
        // `deleteTombstones[oldId]` is stale by construction (a tombstone plus a
        // live metadata entry under the same id can only be a leftover), and the
        // path it names is now empty. Dropped so it can never be applied to some
        // future file that lands at the old path.
        // Wave 2: both retirements inside this mutator's save transaction.
        inSaveTransaction(() => tombstoneStore.remove([newId, oldId]));

        try {
          const oldThumb = path.join(THUMBNAIL_DIR, `${oldId}.jpg`);
          const newThumb = path.join(THUMBNAIL_DIR, `${newId}.jpg`);
          if (fsImpl.existsSync(oldThumb)) fsImpl.renameSync(oldThumb, newThumb);
        } catch (thumbErr) {
          console.error(`Move: failed to re-key thumbnail for ${oldId} -> ${newId}:`, thumbErr.message);
        }
        // v1.92: the storyboard sprite re-keys with the id too.
        try {
          if (fsImpl.existsSync(storyboardPath(oldId))) fsImpl.renameSync(storyboardPath(oldId), storyboardPath(newId));
          if (fsImpl.existsSync(previewClipPath(oldId))) fsImpl.renameSync(previewClipPath(oldId), previewClipPath(newId)); // v1.94 preview clip
        } catch (sbErr) {
          console.error(`Move: failed to re-key storyboard for ${oldId} -> ${newId}:`, sbErr.message);
        }

        try {
          const oldTranscode = transcodedPath(oldId);
          const newTranscode = transcodedPath(newId);
          if (fsImpl.existsSync(oldTranscode)) fsImpl.renameSync(oldTranscode, newTranscode);
        } catch (transcodeErr) {
          console.error(`Move: failed to re-key transcode sidecar for ${oldId} -> ${newId}:`, transcodeErr.message);
        }

        // v1.35 background-audio sidecar (`audioPath(id)`, the `.m4a` extraction
        // the iOS background-audio handoff plays). Same id-keyed cache dir as the
        // transcode above, and it was simply MISSING from this re-key until
        // v1.41.6: a moved item's sidecar was orphaned under the dead id (dead
        // weight against the cache cap until the age sweep got to it) and the
        // item had to re-extract from scratch on its next background hand-off --
        // exactly the "deterministic background audio" promise `preExtractAudio`
        // exists to make, quietly broken by a move.
        try {
          const oldAudio = audioPath(oldId);
          const newAudio = audioPath(newId);
          if (fsImpl.existsSync(oldAudio)) fsImpl.renameSync(oldAudio, newAudio);
        } catch (audioErr) {
          console.error(`Move: failed to re-key background-audio sidecar for ${oldId} -> ${newId}:`, audioErr.message);
        }

        // Subtitle sidecars (A6, T16 shipped in Wave 5; this rename is a T16
        // completion follow-up).
        //
        // v1.41.6: this used to move exactly ONE sidecar -- whichever
        // `lib/subtitles.js`'s `findSubtitleSidecar` resolver ranked first. That
        // is the right resolver for "which sidecar do we SERVE", but the wrong
        // question for "which files belong to this item": a yt-dlp download with
        // several subtitle languages lands `<base>.en.vtt` AND `<base>.es.vtt`,
        // and every one after the first was left behind at the old path --
        // orphaned next to a media file that no longer exists, and gone from the
        // item forever. The move now sweeps the source directory for the item's
        // WHOLE sidecar set, the same way the DELETE route's v1.36.2 sweep does,
        // and preserves each file's suffix verbatim on the new basename (so a
        // language tag survives the move, and a rename carries the set with it).
        //
        // The sweep is deliberately NARROW: `<oldBase>.vtt`, `<oldBase>.srt` or
        // `<oldBase>.<lang>.vtt|srt` with a short, token-shaped `<lang>`. A
        // broader `startsWith(oldBase + '.') && endsWith('.vtt')` (what delete
        // uses -- it can afford to be greedy, since it is removing a file whose
        // media is going away) could in principle claim a DIFFERENT item's
        // sidecar whose own basename begins with ours ("Trip.mp4" +
        // "Trip.day2.mp4" -> "Trip.day2.vtt"), and stealing another item's
        // subtitles is not an acceptable cost of a move. Best-effort throughout:
        // a sidecar failure logs and continues -- the media file is already
        // physically moved and its db entry MUST still be re-keyed.
        try {
          const oldDir = path.dirname(oldPath);
          const newDir = path.dirname(newPath);
          const oldBase = path.basename(oldPath, path.extname(oldPath));
          const newBase = path.basename(newPath, path.extname(newPath));
          const sidecarSuffix = /^\.(?:[A-Za-z0-9_-]{1,15}\.)?(?:vtt|srt)$/i;
          for (const name of fsImpl.readdirSync(oldDir)) {
            if (!name.startsWith(`${oldBase}.`)) continue;
            const suffix = name.slice(oldBase.length); // e.g. ".en.vtt", ".vtt", ".srt"
            if (!sidecarSuffix.test(suffix)) continue;
            const from = path.join(oldDir, name);
            const to = path.join(newDir, newBase + suffix);
            try {
              // Never clobber an existing sidecar at the destination (a same-named
              // subtitle already there belongs to whatever else lives in that
              // folder -- the media move's own no-clobber guarantee, applied to
              // the sidecar set).
              if (fsImpl.existsSync(to)) continue;
              fsImpl.renameSync(from, to);
            } catch (renameErr) {
              if (renameErr && renameErr.code === 'EXDEV') {
                // Cross-device (the NAS-to-local relocation case): copy, then
                // remove the source -- never the other way round.
                try {
                  fsImpl.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
                  fsImpl.unlinkSync(from);
                } catch (copyErr) {
                  console.error(`Move: failed to carry subtitle sidecar ${name} across devices:`, copyErr.message);
                }
              } else {
                console.error(`Move: failed to carry subtitle sidecar ${name}:`, renameErr.message);
              }
            }
          }
        } catch (subErr) {
          console.error(`Move: failed to re-key subtitle sidecars for ${oldId} -> ${newId}:`, subErr.message);
        }

        return newId;
      });
    } catch (err) {
      // ROLLED BACK (gate fix round 3, QA WARNING -- and the previous comment here,
      // which claimed we "cannot prove nothing was persisted", was simply FALSE
      // against this codebase; QA traced it and it does not hold):
      //
      //   - `updateDatabase` runs `const result = mutatorFn(db); if (result !== false)
      //     saveDatabase(db);` -- a THROW from the mutator means `saveDatabase` is
      //     never called at all.
      //   - `saveDatabase` (v1.42) commits ONE SQLite transaction; a failure
      //     ROLLS BACK with the on-disk state untouched, and the only
      //     statements after a successful commit are two plain assignments
      //     (`dbCache = db; dbCacheValid = true;`), which cannot throw. So any
      //     throw leaves the committed state exactly as it was.
      //   - `loadDatabase` re-assembles a fresh object on every call and never
      //     hands out `dbCache` by reference, so the half-mutated in-memory object
      //     this mutator may have left behind is unreachable and corrupts nothing.
      //
      // => On ANY rejection, the re-key provably did not land. The destination is
      // ours (created moments ago via an EXCLUSIVE linkSync/COPYFILE_EXCL, never a
      // pre-existing file), so unlinking it restores the exact pre-move state.
      //
      // And NOT rolling back is worse than "a leftover the user can delete": the
      // destination sits in a CHANNEL FOLDER under the download root with a native
      // `<title> [id].ext` name, so the next scan indexes it as a BRAND-NEW item
      // (new path -> new getMediaId) -- the same video twice in the library, and on
      // the cross-device path a real duplicate burning real disk.
      try {
        fsImpl.unlinkSync(newPath);
      } catch (unlinkErr) {
        console.error(`Move: the database update failed and the destination copy at ${newPath} could not be rolled back:`, unlinkErr.message);
      }
      return {
        ok: false, status: 500,
        error: `The database update failed, so the move was rolled back (the original is untouched): ${err.message}`,
        newPath,
      };
    }

    if (mutatorResult === false) {
      // v1.41.6 gate fix (QA WARNING): a DELETE committed between our initial
      // `loadDb()` and this mutator -- the item is gone from db.metadata. The FS
      // link/copy has ALREADY happened, so without this rollback the bytes would
      // sit at `newPath` (under the yt-dlp download root, with an `[id]` bracket,
      // in a channel folder) with no db entry, and the DELETE's own tombstone --
      // keyed on the OLD path's id -- could not suppress them. The very next scan
      // would index the video the user just deleted straight back into the
      // library, defeating v1.41.3's "delete stays gone".
      //
      // Removing `newPath` is safe and correct: we created it EXCLUSIVELY moments
      // ago (linkSync/COPYFILE_EXCL -- it is ours, never a pre-existing file), and
      // the user's deliberate delete is the newest expression of intent. On the
      // same-volume path it is a hard link to the very inode the DELETE unlinked,
      // so removing it completes the deletion the user asked for.
      try {
        fsImpl.unlinkSync(newPath);
      } catch (err) {
        console.error(`Move: item ${oldId} was deleted mid-move; could not remove the copy at ${newPath}:`, err.message);
      }
      return {
        ok: false, status: 404,
        error: 'Media file was removed before the move could be recorded -- the move was rolled back',
      };
    }

    // The db re-key is COMMITTED. Now -- and only now -- carry the PROCESS-MEMORY
    // state that is keyed by the same id/path onto the new key. Doing this inside
    // the mutator (where it lived until the round-3 gate) meant a `saveDatabase`
    // throw rolled the DATABASE back while leaving these maps re-keyed: the
    // in-flight progress ping would then be keyed to a `newId` with no metadata
    // entry, and `flushPendingProgress` (which drops any id whose metadata is gone)
    // would silently destroy it -- the very loss the carry exists to prevent.
    rekeyInFlightState(oldId, mutatorResult, oldPath, newPath);

    // v1.49 GATE FIX (adversarial WARNING 6): close our own read streams on the
    // source BEFORE unlinking it -- the same thing `DELETE /api/videos/:id` has
    // done since v1.41.10, for the same reason. An unlink issued while this
    // process still holds an fd is the DELETE_PENDING trap on SMB/CIFS: the
    // dirent survives, and on the cross-device path that leftover is a FULL
    // DUPLICATE of an irreplaceable file sitting in a scanned library root, which
    // the next scan indexes as a second item. The delete route's tombstone net
    // does not cover this path.
    //
    // This was previously unreachable here only by accident: `planImportRelocation`'s
    // `recently-watched` clause meant a file this process had been streaming was
    // never relocated. v1.49 lifts that clause for the attended per-video confirm,
    // and the watch page streams the video on mount -- so the correlation went
    // from incidental to GUARANTEED. Bounded (3s) and never throws; on timeout the
    // unlink proceeds exactly as it did before.
    //
    // Deliberately also fixes `POST /api/videos/:id/move`, which shares this
    // function and has always had the same exposure.
    await destroyMediaStreams(oldPath);

    // Only now is the source directory entry removed. A failure here is a stray
    // leftover, never data loss (the db and the bytes already agree) -- log and
    // continue, exactly as before.
    try {
      fsImpl.unlinkSync(oldPath);
    } catch (err) {
      console.error(`Move: file linked/copied to ${newPath} and the database re-keyed, but the old path ${oldPath} could not be removed:`, err.message);
    }

    return { ok: true, oldId, newId: mutatorResult, newPath };
  }

  return { computeMoveTarget, moveItemToFolder };
}

module.exports = { createMoveOps };
