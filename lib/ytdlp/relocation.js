'use strict';

// lib/ytdlp/relocation.js - the reheat's IMPORT-RELOCATION and metadata-REPULL
// planners: the one-time flat-one-off migration, the shared move/skip DECISION
// that the executor and the dry-run preview both read, the executor itself, the
// whole-library preview, and the two halves of the metadata+subtitle re-pull
// backfill (the pure eligibility enumeration, and the single deps-injected
// writer). Moved VERBATIM out of server.js in Wave 7b, slice S6, of the
// relational-migration arc (docs/exec-plans/completed/
// 2026-09-13-sqlite-relational-migration.md): every body is byte-identical to
// its server.js original, they keep their source order, and their free
// identifiers resolve from the `deps` bundle the factory closes over - the
// lib/books/scanRunner.js + lib/music/scanRunner.js factory pattern. A missing
// dep is a hard failure (a destructured undefined that is later called throws),
// never a silent fallback.
//
// THESE FUNCTIONS MOVE USER FILES. Nothing here was rewritten, re-ordered or
// "improved" on the way across: the comments below are the record of gates that
// took three rounds and caught a bug that destroyed files, and they ARE the
// specification. The header comment that travelled with each function is
// unchanged except where the move itself made a POSITIONAL reference false
// ("above" / "below" / "this file" / "~line NNNN" pointing at code that stayed
// behind) - each of those now names server.js instead of a direction.
//
// A factory rather than a `registerRoutes` module because these are functions,
// not routes: server.js binds the collaborators once, at the position the first
// of the six was declared, and re-exports all six as the SAME function objects
// (so `require('./server').planImportRelocation` and friends keep working, and
// the two the yt-dlp router needs - `recordRepulledItemMeta` and
// `enumerateRepullableItems` - keep crossing the deps bridge it already uses).
//
// `moveItemToFolder` arrives as a LAZY wrapper from the call site: slice S5 of
// this same release turns that hoisted function declaration into a `const` from
// a factory call that sits BELOW this module's own call site, so a direct
// binding would be a boot-time TDZ error. Every other dep is passed directly.
// Nothing here is a `let`: a scope-aware AST pass over server.js found zero
// reassignments of any of the 22 names below after their declarations (13
// `const`s, 9 hoisted function declarations), so NO live-accessor seam crosses.
// The mutable values among them - `activeProtectedPaths` (a function returning
// the recently-served path Set), `settingsStore`, `ytdlpDb`, `subtitles`,
// `ytdlp`, `ytdlpArgs` - cross as the SAME object/function reference, which a
// destructure preserves, so every later mutation is visible here.

// v1.338 D9: the saved page link's checks (leaf modules, no deps bridge needed).
const { sanitizeSourceShareUrl } = require('../media/source-share');
const { isPlausibleMediaUrl } = require('./url');

function createRelocation(deps) {
  const {
    READ_ONLY_MEDIA, // the safe-mode lever: an automatic file-mover refuses to run under it
    activeProtectedPaths, // (now) -> the Set of recently-served paths a relocation must not yank a file out of
    buildWatchUrl,
    classifyMetadataEffect, // stays in server.js (exported, and classifyTransfer's sibling)
    classifyTransfer, // the hardlink-vs-copy prediction (stays: exported, and it reads nearestExistingDir)
    extractYtdlpVideoId,
    finalizeChapters,
    fs,
    getMediaId,
    isMediaJobInFlight, // reads the transcode/audio-extract queues, which stay in server.js
    isSafeVideoId,
    matchRootFolder,
    moveItemToFolder, // a LAZY wrapper (slice S5 moves the declaration below this module's call site)
    normalizeChapter,
    path,
    resolveRelocationTitle, // stays: exported, and it reads cleanDisplayTitle + the byte cap
    settingsStore,
    subtitles,
    validateChannelUrl,
    ytdlp,
    ytdlpArgs,
    ytdlpDb,
  } = deps;

  // ---- T4 (v1.25 QoL): one-time migration of pre-existing flat one-off
  // downloads into their captured channel's folder -----------------------------
  //
  // Context: before this round's earlier task (T3) fixed it going forward,
  // every one-shot download landed in a single flat 'One-Off' bucket even when
  // the video's channel identity WAS captured -- T3 made every NEW one-shot
  // resolve straight into `resolveChannelDir`/`ONE_OFF_FALLBACK_FOLDER`
  // (lib/ytdlp/index.js), but did nothing for what was already on disk. This
  // function is the one-time RETROACTIVE reconciliation pass for everything
  // downloaded before that fix: it walks `db.metadata`, and for every
  // yt-dlp-downloaded item that (a) carries a captured channel identity and (b)
  // is not ALREADY sitting in that channel's resolved folder, it physically
  // relocates the file via T9's `moveItemToFolder` (server.js) -- the SAME atomic
  // link/unlink + id re-key machinery `POST /api/videos/:id/move` uses, so
  // watch progress and every id-keyed sidecar (thumbnail/transcode/subtitle)
  // survive the move exactly like any other library move (see that function's
  // own header comment for the full `getMediaId`-hash-stability hazard and how
  // it's mitigated).
  //
  // SCOPE (v1.25.x two-reviewer-gate fix -- narrowed from the original
  // predicate below): eligibility is now the FLAT one-off pile ONLY -- an
  // item's current parent directory must be the download root ITSELF, or the
  // legacy pre-T3 flat 'One-Off' folder (what every one-shot download landed
  // in before T3 started routing new downloads straight into a per-channel
  // folder via `args.resolveChannelDir(config, { name: 'One-Off' })`; see
  // `git log -p -S"'One-Off'"` for that literal's history). An item already
  // sitting in ANY OTHER per-channel subfolder is deliberately EXCLUDED here,
  // even if its captured identity's resolved folder differs from its current
  // one.
  //
  // Why: the original predicate generalized to "any yt-dlp download whose
  // current parent folder doesn't match its own captured channel identity's
  // resolved folder." That is NOT limited to the flat pile -- a subscription
  // download lives in a folder derived from `sub.name` (typically the
  // subscribed `@handle`; no channel-name probe happens at subscribe time),
  // while `item.channelName` (bridged from the scan) is yt-dlp's REAL channel
  // display name. Those two routinely sanitize to DIFFERENT folder names. An
  // adversarial probe confirmed the broad predicate relocates EVERY such
  // subscription video on the first post-upgrade boot -- while the
  // subscription keeps downloading NEW videos into its `sub.name` folder --
  // permanently splitting each affected channel's library across two folders.
  // Not data loss (the move itself is atomic/confined/history-preserving, see
  // `moveItemToFolder`), but an unintended, unbounded library-wide
  // reorganization the download path itself disagrees with. Narrowing
  // eligibility to the two known flat locations is what stops that: a
  // subscription-foldered (or already-migrated) item never has the download
  // root or the legacy 'One-Off' folder as its immediate parent, so it can
  // never match.
  //
  // Idempotent by construction: an item already living in its own
  // `resolveChannelDir` folder fails the "current dir !== target dir" check and
  // is skipped -- re-running this on every server start (its actual call site,
  // see server.js's `require.main === module` block) is a harmless no-op once the
  // pile has been reconciled once. Every item is processed independently inside
  // its own try/catch so one failure (a confinement reject, a destination
  // collision, an unexpected FS error) is logged and skipped, never aborting
  // the rest of the pass.
  //
  // Confinement: the destination is computed via `resolveChannelDir` (which
  // throws if it can't confine the candidate under `config.downloadDir`) AND
  // independently re-checked by `moveItemToFolder`'s own `computeMoveTarget`
  // against `configuredLibraryRoots` (which includes the download root via
  // `ytdlp.extraScanRoots`) -- the same two-layer discipline every other move
  // path in server.js gets; nothing here bypasses it.
  //
  // Never touches the yt-dlp `--download-archive` (a separate dotfile keyed by
  // extractor+video id, not by path -- see `lib/ytdlp/args.js`'s
  // `resolveArchivePath`), so a migrated item can never look like a "new" video
  // to a later poll and trigger a re-download.
  //
  // Two passes: pass 1 (sync, no FS/db writes) determines exactly which items
  // need to move, so an up-front log line can report an accurate count of real
  // work BEFORE pass 2's slow, serial per-item `moveItemToFolder` calls (each a
  // full db write) run -- making the one-time first-boot latency observable
  // instead of looking like a silent hang.
  //
  // @param {{loadDatabase: Function, updateDatabase: Function, getMediaId: Function, fs?: object}} deps same shape `moveItemToFolder` takes
  // @param {object} config a parsed yt-dlp config (`ytdlp.parseYtdlpConfig()`)
  // @returns {Promise<{moved: number, skipped: number, errors: number, collisions: number}>}
  async function migrateOneOffsIntoChannelFolders(deps, config) {
    const summary = { moved: 0, skipped: 0, errors: 0, collisions: 0 };

    // v1.42 safe-mode lever (AC8 / design review F10b): an automatic
    // file-mover has no business running from a read-only-media instance —
    // the beta shares prod's download root, and moving prod's files is
    // exactly what the lever exists to prevent. Guarded HERE (not only at
    // the boot call site) so the refusal is testable and holds for any
    // future caller.
    if (READ_ONLY_MEDIA) {
      console.log('[safe-mode] one-off migration skipped — FILETUBE_READ_ONLY_MEDIA=1.');
      return summary;
    }

    // Disabled-module no-op (mirrors every other yt-dlp entry point's own
    // gate): never reads db.metadata, never resolves a channel dir, never
    // touches the filesystem when the module is off.
    if (!ytdlp.isEnabled(config)) return summary;

    const d = deps || {};
    const loadDb = d.loadDatabase;
    if (typeof loadDb !== 'function') return summary;

    const downloadRoots = ytdlp.extraScanRoots(config);
    if (downloadRoots.length === 0) return summary;

    const db = loadDb();
    const metadata = (db && db.metadata) || {};
    const ids = Object.keys(metadata);

    // ---- Pass 1: determine the work -- no filesystem/db writes ---------------
    const toMove = [];
    for (const id of ids) {
      try {
        const item = metadata[id];
        if (!item || typeof item.filePath !== 'string' || item.filePath === '') continue;

        // Only items physically living under the yt-dlp download root are ever
        // eligible -- a regular (non-yt-dlp) library file is never touched, no
        // matter what channel-shaped fields it happens to carry.
        const matchedRoot = matchRootFolder(item.filePath, downloadRoots);
        if (!matchedRoot) continue;

        // FLAT-PILE-ONLY scope (see the module comment above): the item's
        // current parent must be the download root itself, or the legacy
        // pre-T3 flat 'One-Off' folder. Anything else -- a subscription's
        // `sub.name` subfolder, an already-migrated one-off's channel folder,
        // any other per-channel subfolder -- is left alone.
        const currentDir = path.resolve(path.dirname(item.filePath));
        const legacyFlatDir = path.resolve(matchedRoot, 'One-Off');
        const isFlat = currentDir === path.resolve(matchedRoot) || currentDir === legacyFlatDir;
        if (!isFlat) {
          summary.skipped++;
          continue; // already channel-foldered (subscription or prior migration) -- never touched
        }

        const channelName = typeof item.channelName === 'string' ? item.channelName.trim() : '';
        const channelUrl = typeof item.channelUrl === 'string' ? item.channelUrl.trim() : '';
        if (channelName === '' && channelUrl === '') {
          summary.skipped++;
          continue; // no captured identity -- leave it exactly where it is
        }

        // `resolveChannelDir` itself falls back from `name` to `channelUrl`
        // when `name` is falsy (lib/ytdlp/args.js) -- passing both lets a
        // channelName-less-but-channelUrl-tagged item still resolve a stable,
        // deterministic target folder without this function reimplementing
        // that fallback itself.
        const targetDir = ytdlpArgs.resolveChannelDir(config, { name: channelName, channelUrl });
        if (currentDir === targetDir) {
          summary.skipped++;
          continue; // already correctly foldered -- idempotent no-op
        }

        toMove.push({ id, filePath: item.filePath, targetDir });
      } catch (err) {
        summary.errors++;
        console.error(`yt-dlp one-off migration: unexpected error evaluating item ${id}:`, err && err.message);
      }
    }

    if (toMove.length === 0) return summary;

    // Visible up-front, before the slow part (pass 2 below) starts.
    console.log(`[migrate-oneoffs] relocating ${toMove.length} flat one-off item(s) into channel folders`);

    // ---- Pass 2: do the work ---------------------------------------------
    for (const { id, filePath, targetDir } of toMove) {
      try {
        const result = await moveItemToFolder(deps, id, targetDir);
        if (result.ok) {
          summary.moved++;
          console.log(`yt-dlp one-off migration: moved ${filePath} -> ${result.newPath}`);
        } else if (result.status === 409) {
          // A same-basename collision: the destination is permanently occupied
          // by a DIFFERENT flat item that already won the race to move there
          // (`moveItemToFolder`'s own no-clobber guarantee -- see its header
          // comment). This "loser" can never move as long as the winner stays
          // put, and this predicate is idempotent, so it hits this exact
          // branch again on EVERY future boot. Counted separately from
          // `errors` (it is not a failure this migration can recover from, and
          // the no-clobber behavior itself is correct) and logged at `warn`
          // rather than `error`, so a healthy, unchanging install doesn't
          // accumulate an error-level log line forever.
          summary.collisions++;
          console.warn(`yt-dlp one-off migration: skipped ${filePath} (destination already occupied by another item): ${result.error}`);
        } else {
          summary.errors++;
          console.error(`yt-dlp one-off migration: could not move ${filePath} to ${targetDir}: ${result.error}`);
        }
      } catch (err) {
        summary.errors++;
        console.error(`yt-dlp one-off migration: unexpected error processing item ${id}:`, err && err.message);
      }
    }

    console.log(`yt-dlp one-off migration: complete (${summary.moved} moved, ${summary.skipped} skipped, ${summary.collisions} collision(s) skipped, ${summary.errors} error(s))`);
    return summary;
  }

  // ---- v1.41.7 (Dean has NO media backup): the SHARED relocation DECISION -------
  //
  // THE ANTI-DRIFT SEAM. Dean is about to run a bulk, irreversible file op on
  // irreplaceable files with no backup, and he needs a "Preview changes" button
  // that shows EXACTLY what a Reheat will do before it does it. A preview that
  // computed eligibility with its OWN copy of the rules could quietly disagree
  // with the executor -- and a preview that lies about which files move is worse
  // than no preview at all. So the move/skip decision lives in ONE pure function,
  // and BOTH the executor (`relocateHydratedImportIntoChannelFolder`) and the
  // preview (`buildImportRelocationPreview`) call it. There is no second copy of
  // "would it move?" anywhere.
  //
  // PURE + READ-ONLY: this reads `db` and the filesystem (existsSync/statSync)
  // but MUTATES NOTHING -- no updateDatabase, no fs write, no spawn, no network.
  // That is what makes it safe for the preview to call over the whole library.
  // (The one opportunistic WRITE the old executor did -- backfilling a
  // subscription's channelId -- has moved OUT to the executor's move branch, so
  // the shared decision is write-free.)
  //
  // Every clause below is the SAME clause the v1.41.6 executor had, in the same
  // order, with the same reason strings (the executor now maps this function's
  // result straight onto its `{status, reason}` contract). See the executor's own
  // header, still below, for WHY each clause exists -- this is the load-bearing
  // "moves user files" logic and its comments are the record of a gate that took
  // three rounds and caught a bug that destroyed files.
  //
  // Returns one of:
  //   { action: 'move', reason: 'ok', ...destination + transfer classification }
  //   { action: 'skip', reason: <one of the executor's skip reasons> }
  //   { action: 'skip', reason: 'channel-dir-unresolvable', status: 'failed', failReason }
  //     -- the ONE non-move outcome the executor reports as a hard FAILURE rather
  //     than a skip (a misconfigured/unconfinable download root, not "not a
  //     candidate").
  //
  // PERF (v1.41.7 gate fix, QA WARNING 1): `dbSnapshot` is an OPTIONAL, already-
  // loaded `db` the caller hands in so a whole-library preview does NOT pay one
  // full synchronous `loadDatabase()` (readFileSync + JSON.parse of the entire
  // file) PER ITEM -- an O(N x dbSize) event-loop freeze the gate measured at ~11 s
  // on a 2000-item library, exactly Dean's large-MeTube-library use case. The
  // preview loads the db ONCE and threads it here; the EXECUTOR passes nothing and
  // keeps its fresh per-item read (it needs to observe a mid-batch settings flip).
  // This does NOT weaken anti-drift: only the db SOURCE differs, never the decision
  // logic -- and a point-in-time snapshot is exactly right for a point-in-time
  // preview.
  function planImportRelocation(deps, config, mediaId, dbSnapshot, opts) {
    const d = deps || {};
    const loadDb = d.loadDatabase;
    const updateDb = d.updateDatabase;
    const fsImpl = d.fs || fs;

    if (typeof loadDb !== 'function' || typeof updateDb !== 'function') {
      return { action: 'skip', reason: 'no-deps', mediaId };
    }
    // Disabled-module no-op (mirrors every other yt-dlp entry point's gate).
    if (!ytdlp.isEnabled(config)) return { action: 'skip', reason: 'module-disabled', mediaId };
    const downloadRoots = ytdlp.extraScanRoots(config);
    if (downloadRoots.length === 0) return { action: 'skip', reason: 'no-download-root', mediaId };

    // Use the caller's snapshot when supplied (the preview's O(1) read); otherwise
    // load fresh (the executor's per-item read).
    const db = dbSnapshot || loadDb();

    // The operator's opt-out (ON by default -- see DEFAULT_SETTINGS). Read from
    // the FRESH db so flipping it off mid-batch stops the very next item.
    if (settingsStore.getKey('relocateHydratedImports') === false) { // Wave 4: the table is always fresh
      return { action: 'skip', reason: 'setting-off', mediaId };
    }

    const item = db.metadata && db.metadata[mediaId];
    if (!item || typeof item.filePath !== 'string' || item.filePath === '') {
      return { action: 'skip', reason: 'item-gone', mediaId };
    }

    // A human-readable label for the preview (never a full server path in the
    // move-decision itself; the preview renders currentPath separately). Falls
    // back to the basename.
    const title = (typeof item.title === 'string' && item.title.trim() !== '')
      ? item.title.trim()
      : path.basename(item.filePath);
    const currentPath = item.filePath;
    // v1.41.7: the METADATA half of the reheat's effect on this item (see
    // `classifyMetadataEffect`) -- threaded through the SAME decision so the
    // preview's "what would be touched, and in what way" can never drift from what
    // the executor's batch does.
    const metadataEffect = classifyMetadataEffect(item);
    const skipWithItem = (reason, extra) => ({ action: 'skip', reason, mediaId, title, currentPath, metadataEffect, ...(extra || {}) });

    // Already home: a native download, or an import a previous reheat relocated.
    if (matchRootFolder(item.filePath, downloadRoots)) {
      return skipWithItem('already-in-download-root');
    }

    // Identity, re-validated at the write boundary (the database is a file anything
    // could have touched, and this decision moves a file). No YouTube identity =>
    // never moved: this is the clause that keeps genuine local media untouched.
    const channelName = typeof item.channelName === 'string' ? item.channelName.trim() : '';
    const youtubeId = isSafeVideoId(item.youtubeId) ? item.youtubeId : null;
    const channelUrlCheck = validateChannelUrl(item.channelUrl);
    if (!channelUrlCheck.ok || channelName === '' || !youtubeId) {
      return skipWithItem('no-youtube-identity');
    }

    // The file itself must still be there.
    if (!fsImpl.existsSync(item.filePath)) return skipWithItem('file-missing');

    // DON'T MOVE WHAT SOMEONE IS WATCHING (the id is a hash of the PATH; a move
    // re-keys it out from under a mid-playback client).
    //
    // v1.49 GATE FIX (adversarial CRITICAL 1) -- `opts.allowRecentlyWatched`.
    // This clause silently made the per-video reheat's relocation half DEAD CODE.
    // The watch page streams the video on mount (`preload="metadata"`), which
    // calls `markServed(item.filePath)` on every serve, and the watch page is the
    // ONLY entry point for the per-video reheat -- so by the time the button is
    // clickable the item is protected for the next ten minutes, the proposal
    // always came back 'recently-watched', and the confirm dialog could never
    // open. Proven with a repro; the repo's OWN v1.41.6 test
    // (test/integration/repull-relocate.test.js) already asserted this exact
    // behaviour, and this feature was built on top of it anyway.
    //
    // Why lifting it is CORRECT here and nowhere else: the clause protects a
    // mid-playback client from having its id re-keyed away, which is a session
    // integrity concern, not a data-loss one. Two facts settle it:
    //   1. `POST /api/videos/:id/move` -- the Move button sitting right next to
    //      Reheat on the same page -- has NO such guard and never has. Moving the
    //      file you are watching is already accepted behaviour; only this path
    //      forbade it.
    //   2. The per-video confirm closes ITS OWN player before requesting the move
    //      (public/js/watch.js), so the client that asked for it is handled.
    //      DISCLOSED, not claimed away (gate fix, adversarial WARNING 7): this set
    //      is global and path-keyed, with no notion of WHOSE stream marked it, so
    //      in a multi-user install (v1.43) another user streaming the same item
    //      DOES take a session break -- their player keeps requesting an id that
    //      no longer resolves. That is the identical break `POST
    //      /api/videos/:id/move` already imposes on them today, from the same
    //      page, which is what makes it acceptable here -- not the false claim
    //      that only the requester can be affected.
    // DEFAULTS OFF: the BATCH keeps the clause absolute, because it is unattended
    // and may hit a file some OTHER user is streaming right now (v1.43 made this
    // multi-user), and so does the whole-library preview.
    if (!(opts && opts.allowRecentlyWatched === true)
      && activeProtectedPaths(Date.now()).has(item.filePath)) {
      return skipWithItem('recently-watched');
    }

    // DON'T MOVE WHAT FFMPEG IS WORKING ON (a queued/running transcode/audio job
    // pins the old path; a move strands it).
    if (isMediaJobInFlight(item)) {
      return skipWithItem('transcode-or-audio-job-in-flight');
    }

    const channelForJoin = {
      channelUrl: channelUrlCheck.url,
      channelHandleUrl: item.channelHandleUrl,
      channelId: item.channelId,
      channelName,
    };

    // When even the both-URL-forms + id join can't decide, don't guess -- a
    // skipped file is recoverable, a split library is not.
    const ytSubs = ytdlpDb.holder(['subscriptions']); // Wave 5: the subscriptions, from their table
    if (ytdlp.hasAmbiguousChannelSubscription(ytSubs, channelForJoin)) {
      return skipWithItem('ambiguous-subscription');
    }

    let targetDir;
    try {
      targetDir = ytdlp.resolveChannelDirForChannel(ytSubs, config, channelForJoin);
    } catch (err) {
      // The executor treats this as a hard FAILURE, not a skip.
      return {
        action: 'skip', reason: 'channel-dir-unresolvable', status: 'failed',
        failReason: `channel-dir: ${err && err.message}`, mediaId, title, currentPath, metadataEffect,
      };
    }

    // Destination NAME: the native yt-dlp shape, then VERIFY the bracket reads
    // back as this exact id (never assume) -- a mismatch is a skip.
    const ext = path.extname(item.filePath);
    const relocationTitle = resolveRelocationTitle(item);
    const newBaseName = `${relocationTitle} [${youtubeId}]${ext}`;
    if (extractYtdlpVideoId(path.basename(newBaseName, ext)) !== youtubeId) {
      return skipWithItem('id-not-bracket-shaped');
    }

    const destinationPath = path.join(targetDir, newBaseName);

    // Destination occupied: the channel folder already holds this exact file (the
    // same video downloaded natively). A SKIP, never a clobber -- the executor
    // reaches the same outcome via `moveItemToFolder`'s 409, but surfacing it here
    // lets the preview show it up front (and lets the executor short-circuit).
    if (fsImpl.existsSync(destinationPath)) {
      return skipWithItem('destination-occupied');
    }

    // How the real move will transfer the bytes -- THE fact Dean needs to judge
    // safety. Computed without moving anything (see `classifyTransfer`).
    let sizeBytes = null;
    try { sizeBytes = fsImpl.statSync(item.filePath).size; } catch { sizeBytes = null; }
    const { transfer, sameDevice } = classifyTransfer(item.filePath, targetDir, fsImpl);

    return {
      action: 'move',
      reason: 'ok',
      mediaId,
      title,
      currentPath,
      metadataEffect,
      destinationDir: targetDir,
      destinationPath,
      newBaseName,
      youtubeId,
      // Carried so the executor can do its opportunistic channelId backfill
      // WITHOUT re-deriving them (keeps the write out of this pure function).
      channelUrlValidated: channelUrlCheck.url,
      channelHandleUrl: item.channelHandleUrl,
      channelId: item.channelId,
      transfer,
      sameDevice,
      sizeBytes,
    };
  }

  // ---- v1.41.6 (Dean): relocate a HYDRATED IMPORT into its channel folder ----
  //
  // The other half of v1.41.5. That release taught the reheat to hydrate a
  // MeTube-era import -- a file sitting in an ordinary library root, with no
  // `[videoid]` filename bracket, whose only link back to YouTube is the source
  // URL in its embedded `comment`/`purl` tag -- with its REAL channel identity
  // (channelUrl/channelId/channelName/avatar) + `youtubeId`. The card then shows
  // the right creator and a working Subscribe button... but the file is still
  // physically a stranger: it does not live under a channel folder, so it cannot
  // be pinned, it does not appear in the channel's sidebar folder, and its
  // channel link resolves to whatever folder it happens to sit in (the disclosed
  // v1.41.5 gap). Dean's ask: "make an import indistinguishable from a native
  // download -- and if a reheat finds a hydrated file NOT in such a folder, fix
  // it."
  //
  // So: after hydration lands for an item, MOVE the file into that channel's
  // folder -- via `ytdlp.resolveChannelDirForChannel`, which hands back the
  // EXISTING subscription's own `resolveChannelDir(config, sub)` folder when the
  // channel is subscribed (byte-identical to where its downloads land, NOT a
  // parallel channelName-derived folder -- see that function's header for the trap)
  // and the channel's display name otherwise -- and give it the native
  // `<title> [<videoId>].<ext>` filename shape, so a future scan re-derives its id
  // from the filename bracket exactly like a real download's.
  //
  // THIS MOVES USER FILES. Every rule below is written from that premise:
  //
  // ELIGIBILITY is a conjunction, and anything that fails ANY clause is skipped
  // (never "best-effort moved"):
  //   - the module is enabled and has a resolvable download dir;
  //   - the item carries a `channelUrl` that still passes `validateChannelUrl`
  //     (re-validated HERE, at the write boundary, not trusted from the database) AND
  //     a non-empty `channelName` AND a `youtubeId` that still passes
  //     `isSafeVideoId`. No YouTube identity => never moved. This is the clause
  //     that keeps genuine local media -- Dean's home videos, his ripped CDs,
  //     his movie rips -- physically untouched: they have no channelUrl and no
  //     youtubeId, and the widened v1.41.5 reheat enumerates them, so this gate
  //     is the only thing standing between them and a relocation.
  //   - the item is NOT already under a yt-dlp download root (`matchRootFolder`).
  //     A native download is already home. An item in the download root but in
  //     the "wrong" channel folder is DELIBERATELY out of scope: that is exactly
  //     the library-wide-reorganization hazard the v1.25 gate caught for
  //     `migrateOneOffsIntoChannelFolders` (a subscription's folder is derived
  //     from `sub.name`, while `channelName` is yt-dlp's real display name, and
  //     the two routinely sanitize differently -- relocating on that mismatch
  //     would split every subscribed channel's library in two while the
  //     downloader kept writing to the old folder). See that function's header.
  //   - the file still exists on disk.
  //
  // SAFETY: the move itself is `moveItemToFolder` -- the same atomically-exclusive
  // link-or-copy + verify + unlink + id re-key machinery `POST /api/videos/:id/move`
  // and the T4 migration use (see its header for the `getMediaId`-hash-stability
  // hazard). It never clobbers: a destination that already exists (the same video
  // already downloaded natively into that channel folder) is a 409, which this
  // function reports as a SKIP -- not a failure, and never an overwrite. It never
  // unlinks the source until the destination is verified present and the same
  // size (the EXDEV/NAS path). On any failure BOTH the file and the db entry are
  // left exactly as they were.
  //
  // ARCHIVE: a successful move is followed by `recordOneShotInArchive`. This is
  // load-bearing, not bookkeeping, and it is a SINGLE POINT OF FAILURE: the file
  // now sits in a channel folder under the download root, so a poll of that
  // channel would see a video it has no archive line for, in a folder it owns, and
  // re-download a duplicate -- and yt-dlp's own "file already exists" skip cannot
  // back us up, because the name we build is not byte-identical to the one yt-dlp
  // would (see `resolveRelocationTitle`). So an append failure is REPORTED to the
  // caller (`archived: false`), which surfaces it in the reheat's activity entry,
  // rather than being logged to stderr and forgotten (gate fix, QA WARNING).
  //
  // IDEMPOTENT: a second reheat finds the item already under a download root
  // (clause 3) and skips it -- no move, no re-count, no thrash.
  //
  // @param {{loadDatabase: Function, updateDatabase: Function, getMediaId: Function, fs?: object}} deps same shape moveItemToFolder takes
  // @param {object} config a parsed yt-dlp config
  // @param {string} mediaId the item's CURRENT (pre-move) media id
  // @returns {Promise<{status: 'moved'|'skipped'|'failed', reason: string, newId?: string, newPath?: string, archived?: boolean}>}
  //   never throws for an anticipated failure; `status` is what the reheat batch
  //   counts.
  async function relocateHydratedImportIntoChannelFolder(deps, config, mediaId, opts) {
    const d = deps || {};
    const loadDb = d.loadDatabase;
    const updateDb = d.updateDatabase;

    // v1.41.7: the move/skip DECISION now lives in ONE shared, pure function
    // (`planImportRelocation`, above) that the "Preview changes" button calls too
    // -- so the preview can never lie about what a Reheat will actually do. Every
    // eligibility clause the v1.41.6 executor carried inline is now in there, in
    // the same order, with the same reason strings; the executor simply maps the
    // plan's result onto its `{status, reason}` contract and, for a `move`, does
    // the WRITES (the channelId backfill + `moveItemToFolder` + archive append)
    // that the pure decision deliberately does not.
    // v1.49 (per-video confirm): `opts` carries `allowRecentlyWatched` (see the
    // clause's own comment in planImportRelocation) and `expect` (the
    // proposal-binding check below). Absent for the batch, which keeps every
    // v1.41.6 posture byte-for-byte.
    const plan = planImportRelocation(deps, config, mediaId, null, opts);
    if (plan.action !== 'move') {
      // `channel-dir-unresolvable` is the ONE non-move outcome that is a hard
      // FAILURE (an unconfinable/misconfigured download root), not a skip -- the
      // plan flags it with `status: 'failed'`. Everything else is an honest skip
      // whose reason string is unchanged from v1.41.6.
      if (plan.status === 'failed') {
        return { status: 'failed', reason: plan.failReason || plan.reason };
      }
      return { status: 'skipped', reason: plan.reason };
    }

    // v1.49 GATE FIX (adversarial CRITICAL 3): PROPOSAL BINDING.
    //
    // Re-running the decision proves the move is LEGAL. It does not prove it is
    // THE MOVE THE USER APPROVED -- and those came apart in at least three
    // reachable ways, all of them between the dialog opening and the confirm
    // click:
    //   (a) The user SUBSCRIBES to the channel. Giving the watch page a working
    //       Subscribe button is the point of the reheat, so this is the LIKELY
    //       case, not the exotic one -- and `resolveChannelDirForChannel` then
    //       resolves the subscription's own folder instead of the channel-name
    //       one, so the file lands somewhere the user never saw.
    //   (b) A concurrent library reheat rewrites `sourceTitle`, so
    //       `resolveRelocationTitle` changes the destination FILENAME.
    //   (c) The id is `md5(filePath)` with no salt: if the item is moved or
    //       deleted and another file later occupies that exact path, a scan mints
    //       an entry under the SAME id -- and a stale open dialog would relocate a
    //       completely different video.
    //
    // So the caller echoes back what it showed, and a disagreement is refused
    // rather than resolved in the user's absence. `expect` absent (the batch, the
    // preview) => this check is skipped entirely and behaviour is unchanged.
    //
    // GATE FIX (adversarial WARNING 5): `transfer` and `sizeBytes` are bound too,
    // not just the two paths. `transfer` is the load-bearing one -- it is the
    // sentence the dialog puts in front of the user ("Hard link on the same
    // filesystem, no data is copied" vs "Copied across filesystems, then the
    // original is removed after a checksum match"), i.e. the fact intake decision
    // 1 required the dialog to state. And it can flip with BOTH path strings
    // byte-identical: `classifyTransfer` measures the device of
    // `nearestExistingDir(destinationDir)`, and the channel directory usually does
    // not exist yet at propose time, so it measures an ANCESTOR. If the real
    // channel dir appears on a different device in between (a bind mount, a NAS
    // volume, a subscription poll creating it), the user consented to a hard link
    // and gets a copy-then-delete of an irreplaceable file. `sizeBytes` is bound
    // for the same reason at lower stakes: it is what the user judges "do I have
    // room, how long will this take" on, and a file swapped at the same path
    // changes it while both paths match.
    //
    // The `typeof` guards below are DEFENCE IN DEPTH, not an accommodation: the
    // HTTP route refuses a partial `expect` with a 400 before ever reaching here
    // (see its own comment for why "be kind to an older caller" was a false
    // justification -- there is no such caller). A direct in-process caller that
    // hands over a partial object still gets the paths bound rather than nothing.
    if (opts && opts.expect && typeof opts.expect === 'object') {
      const e = opts.expect;
      const transferChanged = typeof e.transfer === 'string' && e.transfer !== plan.transfer;
      const sizeChanged = typeof e.sizeBytes === 'number' && e.sizeBytes !== plan.sizeBytes;
      if (e.currentPath !== plan.currentPath || e.destinationPath !== plan.destinationPath
        || transferChanged || sizeChanged) {
        return {
          status: 'stale',
          reason: 'proposal-stale',
          // The FRESH plan, so the caller can re-ask about the move that is
          // actually on the table now instead of silently doing a different one.
          currentPath: plan.currentPath,
          destinationPath: plan.destinationPath,
          transfer: plan.transfer,
          sameDevice: plan.sameDevice,
          sizeBytes: plan.sizeBytes,
        };
      }
    }

    const { destinationDir: targetDir, newBaseName, youtubeId } = plan;

    // Belt-and-braces on the SAME class: if this channel IS subscribed and we now
    // hold a validated channelId the subscription lacks, record it. That both makes
    // every FUTURE join (avatars, folder matching, the plan above) exact, and means
    // the miss can only ever happen once per subscription. Never throws; a failure
    // here is irrelevant to the move (the folder is already resolved). This is the
    // one WRITE the pure decision could not do -- it lives here, on the move path.
    try {
      if (typeof plan.channelId === 'string' && plan.channelId !== '') {
        await ytdlp.backfillSubscriptionChannelIdForChannel(
          { loadDatabase: loadDb, updateDatabase: updateDb, ytdlpDb }, // Wave 5: the subscription lives in its table
          { channelUrl: plan.channelUrlValidated, channelHandleUrl: plan.channelHandleUrl, channelId: plan.channelId },
        );
      }
    } catch (err) {
      console.error('Relocate: could not backfill the subscription channelId (continuing):', err && err.message);
    }

    const result = await moveItemToFolder(deps, mediaId, targetDir, { newBaseName });
    if (!result.ok) {
      if (result.status === 409) {
        // The destination is occupied -- this channel folder ALREADY holds a file
        // by that exact name, i.e. the same video, downloaded natively. Not a
        // failure and emphatically not something to overwrite: the user has two
        // copies of one video and gets to decide. Reported, never clobbered.
        return { status: 'skipped', reason: 'destination-occupied' };
      }
      return { status: 'failed', reason: result.error || 'move failed' };
    }

    // The file now lives in a channel folder under the download root. If that
    // channel is subscribed, the next poll would otherwise treat this video as one
    // it has never downloaded -- and re-download it. The move itself has already
    // succeeded, so a failed append is NOT a failed relocation; but it is also not
    // nothing (see this function's ARCHIVE note), so it is reported rather than
    // swallowed. `recordOneShotInArchive` now returns whether the id is on record.
    let archived = false;
    try {
      archived = ytdlp.recordOneShotInArchive(config, youtubeId) !== false;
    } catch (err) {
      archived = false;
      console.error(`Relocate: moved ${result.newPath} but could not record ${youtubeId} in the yt-dlp archive:`, err && err.message);
    }
    if (!archived) {
      console.warn(`Relocate: ${result.newPath} is NOT recorded in .ytdlp-archive.txt -- a subscription poll of this channel may re-download it.`);
    }

    console.log(`Relocate: hydrated import moved into its channel folder: ${plan.currentPath} -> ${result.newPath}`);
    return { status: 'moved', reason: 'ok', newId: result.newId, newPath: result.newPath, archived };
  }

  // ---- v1.41.7 (Dean has NO media backup): the DRY-RUN preview -----------------
  //
  // The headline of this release. Dean cannot back up his media, so before he runs
  // a bulk, irreversible relocation he needs to SEE exactly what it will do -- and
  // (Dean's explicit ask) WHAT WOULD BE TOUCHED AND IN WHAT WAY. This drives EVERY
  // db item through the SAME `planImportRelocation` predicate the executor uses --
  // so the preview is a true dry run, not a parallel guess.
  //
  // A reheat does TWO things per item: (1) hydrate/refresh channel metadata (no
  // file touch), and (2) maybe relocate the file. So each item is classified into
  // ONE of five honest categories:
  //
  //   1. 'move-hardlink'   -- file HARD-LINKED into the channel folder (no bytes
  //                           copied, same inode, inherently safe).
  //   2. 'move-copy'       -- file COPIED across filesystems (bytes duplicated,
  //                           original deleted after a sha256 match). THE warning
  //                           category.
  //   3. 'metadata-only'   -- the FILE STAYS PUT (already under a download root,
  //                           ambiguous subscription we deliberately won't guess,
  //                           in-flight transcode, recently watched, destination
  //                           occupied, relocation toggled off, ...), but a reheat
  //                           may still refresh its channel metadata. File NOT
  //                           touched.
  //   4. 'untouched'       -- no YouTube identity in the database: the FILE is not
  //                           moved, and nothing here points to YouTube. But this
  //                           is NOT "nothing happens": a reheat still runs a local,
  //                           network-free ffprobe over such a file and can recompute
  //                           `hasSubtitles`/embedded date. So a NEVER-reheated one
  //                           carries `metadataEffect: 'may-refresh'` and BOTH the
  //                           row and the summary say so out loud (gate fix, HONESTY
  //                           1). An already-reheated one is skipped whole by a
  //                           non-force reheat, so it is genuinely untouched.
  //   5. 'would-hydrate-first' -- has a video id but no full channel identity yet:
  //                           a real reheat would hydrate it FIRST (a network
  //                           pass), and only then could a destination be computed.
  //                           We never fetch, so the destination is honestly
  //                           "unknown until then".
  //
  // The METADATA half (`metadataEffect`: 'up-to-date' | 'may-refresh') comes from
  // the SAME `classifyMetadataEffect` predicate `enumerateRepullableItems` gates on
  // -- so the preview cannot overstate or drift from what the executor's batch
  // actually does.
  //
  // STRUCTURALLY INCAPABLE OF WRITING: it calls `deps.loadDatabase()` and
  // `planImportRelocation` (both read-only) and NOTHING ELSE. No `updateDatabase`,
  // no filesystem mutation, no `runExclusive`, no yt-dlp/ffmpeg spawn, no network.
  //
  // @param {{loadDatabase: Function, updateDatabase: Function, getMediaId: Function, fs?: object}} deps
  // @param {object} config a parsed yt-dlp config
  // @param {Function} [itemVisible] v1.127: requester-visibility predicate (from
  //   mediaVisiblePredicate); a hidden item contributes no row and no counts
  // @returns {{moves: Array, skips: Array, summary: object}}
  function buildImportRelocationPreview(deps, config, itemVisible) {
    const d = deps || {};
    const loadDb = d.loadDatabase;
    const moves = [];
    const skips = [];
    let hardlinkCount = 0;
    let copyCount = 0;
    let unknownCount = 0;
    let copyBytes = 0;
    let hardlinkBytes = 0;
    let metadataOnlyCount = 0;
    let wouldHydrateCount = 0;
    let untouchedCount = 0;
    // v1.41.7 gate fix (HONESTY 1, both seats): of the 'untouched' items, how many
    // would still have a local, network-free ffprobe tag check run over them by a
    // reheat (never-reheated ones). Kept separate so the summary can be honest --
    // "not touched" overstates for a file whose `hasSubtitles`/embedded date a
    // reheat CAN still recompute.
    let untouchedMayRefreshCount = 0;

    // v1.41.7 gate fix (QA WARNING 1 -- the perf blocker): load the db ONCE and
    // thread it into every per-item decision, instead of `planImportRelocation`
    // re-reading (readFileSync + full JSON.parse) once PER ITEM. A point-in-time
    // snapshot is exactly right for a point-in-time preview.
    const db = (typeof loadDb === 'function') ? loadDb() : {};
    const metadata = (db && db.metadata) || {};
    const ids = Object.keys(metadata);

    for (const mediaId of ids) {
      const item = metadata[mediaId];
      // v1.127 Wave A: requester visibility - a hidden item contributes NOTHING
      // to the preview: no move row (its current AND destination paths would
      // render for a restricted manage-subs member), no summary counts.
      if (typeof itemVisible === 'function' && !itemVisible(item)) continue;
      // ONE shared decision -- identical to what the executor would decide for this
      // item right now. No fetch, no ffprobe: purely persisted db state + read-only
      // fs stats. The already-loaded `db` snapshot is threaded in (perf: no per-item
      // reload) -- the decision LOGIC is byte-identical to the executor's, only the
      // db source differs.
      const plan = planImportRelocation(deps, config, mediaId, db);
      // The metadata half -- the SAME predicate the batch gates on (see
      // `classifyMetadataEffect`). Preferred off the plan (item-bearing paths),
      // else computed from the item directly for the rare global-skip paths
      // (module-disabled / no-download-root / setting-off / item-gone) -- the SAME
      // function either way, never a separate reimplementation.
      const metadataEffect = plan.metadataEffect || classifyMetadataEffect(item);

      if (plan.action === 'move') {
        const bytes = Number.isFinite(plan.sizeBytes) ? plan.sizeBytes : 0;
        const category = plan.transfer === 'hardlink' ? 'move-hardlink'
          : (plan.transfer === 'copy' ? 'move-copy' : 'move-unknown');
        moves.push({
          mediaId,
          title: plan.title,
          currentPath: plan.currentPath,
          destinationPath: plan.destinationPath,
          transfer: plan.transfer, // 'hardlink' | 'copy' | 'unknown'
          sizeBytes: plan.sizeBytes,
          category,
          metadataEffect,
        });
        if (plan.transfer === 'hardlink') { hardlinkCount += 1; hardlinkBytes += bytes; }
        else if (plan.transfer === 'copy') { copyCount += 1; copyBytes += bytes; }
        else { unknownCount += 1; }
        continue;
      }

      // A NON-move. The relocation DECISION is entirely the plan's; the preview
      // layer only assigns the plain-language CATEGORY (Dean's "in what way") and a
      // friendlier reason label. Three cases:
      //   - 'no-youtube-identity' WITH a derivable youtubeId -> would-hydrate-first
      //     (not yet hydrated; destination unknown until a real reheat probes it);
      //   - 'no-youtube-identity' WITHOUT one -> untouched (genuine local media);
      //   - any other skip reason -> metadata-only (the file stays put for a benign
      //     reason, but the reheat may still refresh channel metadata).
      let reason = plan.reason;
      let category;
      if (plan.reason === 'no-youtube-identity') {
        if (item && isSafeVideoId(item.youtubeId)) {
          reason = 'would-hydrate-first';
          category = 'would-hydrate-first';
          wouldHydrateCount += 1;
        } else {
          category = 'untouched';
          untouchedCount += 1;
          // Honest bookkeeping: a never-reheated file still gets a local tag check.
          if (metadataEffect === 'may-refresh') untouchedMayRefreshCount += 1;
        }
      } else {
        category = 'metadata-only';
        metadataOnlyCount += 1;
      }

      skips.push({
        mediaId,
        title: plan.title || (item && typeof item.title === 'string' && item.title) ||
          (item && typeof item.filePath === 'string' ? path.basename(item.filePath) : ''),
        currentPath: plan.currentPath || (item && item.filePath) || '',
        reason,
        category,
        metadataEffect,
      });
    }

    return {
      moves,
      skips,
      summary: {
        // v1.127: derived from the rows, not `ids.length` - every non-hidden id
        // lands in exactly one of moves/skips, so this is byte-identical for an
        // unrestricted caller and honestly EXCLUDES hidden items for a
        // restricted one (ids.length would have leaked their count).
        totalItems: moves.length + skips.length,
        moveCount: moves.length,
        skipCount: skips.length,
        hardlinkCount,
        copyCount,
        unknownCount,
        copyBytes,
        hardlinkBytes,
        // v1.41.7: the metadata/effect taxonomy counts (Dean's "what would be
        // touched, and in what way").
        metadataOnlyCount,
        wouldHydrateCount,
        untouchedCount,
        untouchedMayRefreshCount,
      },
    };
  }

  // ---- Metadata+subtitle re-pull backfill (v1.25 QoL follow-up) -------------
  // A user-triggered "re-pull" job re-fetches yt-dlp metadata (release date,
  // channel avatar) and subtitles for an already-downloaded item, WITHOUT
  // touching the media file itself -- so, unlike `migrateOneOffsIntoChannelFolders`
  // (above) and `moveItemToFolder` (server.js), the item's id is completely
  // STABLE (`getMediaId` hashes the path, and the path never changes here).
  // The two halves below are deliberately split the same way the move
  // machinery is split into "compute eligibility" (pure) and "do the mutation"
  // (deps-injected, single serialized `updateDatabase` writer):
  //
  //   - `enumerateRepullableItems` (pure aggregation over a `db` snapshot +
  //     parsed config) answers "which items COULD be re-pulled, and how many
  //     can't be" -- the endpoint that owns the actual re-pull job (another
  //     task) uses this to build its work queue and report the blast radius
  //     before doing any network I/O.
  //   - `recordRepulledItemMeta` (deps-injected, mirrors `moveItemToFolder`'s
  //     `{loadDatabase, updateDatabase, getMediaId}`-shaped deps bundle, but
  //     simpler -- no file move, so no re-key) is the ONLY function that
  //     actually writes the result of a re-pull job back into `db.metadata`,
  //     through the single serialized `updateDatabase` mutator.
  //
  // WIRING CONTRACT for the caller that owns the actual re-pull job (currently
  // `lib/ytdlp/index.js`'s `registerRoutes`, another task): both functions are
  // bridged through the SAME `deps`-object mechanism `updateDatabase`/
  // `loadDatabase`/`scanDirectories`/`getMediaId` already use (see the
  // `ytdlp.registerRoutes(app, {...})` call in server.js) -- NOT a
  // second `require('../../server')` from `lib/ytdlp/index.js`. That module is
  // itself `require()`d near the top of server.js, before that file's `module.exports` is
  // assigned, so a `require('../../server')` from inside it would only ever
  // observe an incomplete (still-`{}`) exports object -- the deps bridge is
  // what avoids that circular-require trap, exactly like every other
  // server.js-owned primitive this module already receives.
  //   - `enumerateRepullableItems` takes `(db, config, itemVisible?)` directly
  //     (no db access of its own) -- the caller already has a fresh `db` (from
  //     `deps.loadDatabase()`) and its own parsed yt-dlp config in hand. The
  //     THIRD arg (v1.127 Wave A) is the OPTIONAL requester-visibility predicate
  //     (from `deps.mediaVisiblePredicate(req)`): a new caller that omits it
  //     enumerates the WHOLE library, so a caller acting on behalf of a
  //     restricted member MUST pass it (the batch/preview/per-item routes do).
  //   - `recordRepulledItemMeta` takes `(deps, mediaId, meta, nowMs)` -- pass
  //     the SAME `deps` object `registerRoutes` itself received.

  /**
   * Pure eligibility gate: classify every `db.metadata` item as re-pullable or
   * not, without touching the filesystem or the database.
   *
   * v1.33 T1: a video id is NO LONGER required for eligibility. Each item
   * carries the best id currently derivable -- the filename's `[<11-char id>]`
   * bracket, else a previously-persisted `item.youtubeId` (re-checked through
   * `isSafeVideoId`) -- as `videoId`/`watchUrl`, which are `null` when neither
   * exists (a bracket-less metube-era import). The batch worker
   * (`runRepullMetadataBatch`, lib/ytdlp/index.js) runs its LOCAL ffprobe tags
   * pass on those regardless, and can derive a watch URL on the fly from an
   * embedded `purl` tag; only the NETWORK pass is gated on a watch URL.
   *
   * v1.41.5 (Dean's MeTube-import hydration): this gate is now ROOT-AGNOSTIC.
   * It used to hard-require `matchRootFolder(item.filePath, downloadRoots)` --
   * which excluded exactly the library Dean actually needs hydrated: .mp3/.mp4
   * files MeTube downloaded into a NORMAL library root (never FileTube's own
   * yt-dlp download dir), with no `[<id>]` filename bracket but WITH the source
   * YouTube URL in their embedded `comment`/`purl` tag. Those items already
   * carry a valid `item.youtubeId` (the scan's `deriveScanYoutubeId` has been
   * root-agnostic through the embedded tag since v1.33), so the ONLY thing
   * standing between them and a full identity backfill was this scoping check.
   *
   * What replaced it -- an item is eligible when it can plausibly yield a
   * YouTube video id:
   *   1. a filename `[<11-char id>]` bracket -- ONLY trusted for a file rooted
   *      under the module's own download dir (`ytdlp.extraScanRoots(config)`,
   *      still computed here for exactly this purpose). An ordinary library
   *      file can innocently carry an 11-char bracket (`Vacation
   *      [Holiday2024].mp4` -- see `cleanDisplayTitle`'s own note), and
   *      trusting that outside the download root would aim a NETWORK call at a
   *      coincidence.
   *   2. else a persisted `item.youtubeId` that survives `isSafeVideoId` --
   *      trusted from ANY root, because it can only have come from the
   *      downloader's own embedded provenance tag (the trust boundary
   *      `deriveScanYoutubeId` documents - lib/scan/identity.js) or a prior reheat.
   *   3. else `null` id -- still enumerated (never a network call: the worker
   *      gates its spawn on a watch URL) purely so the worker's LOCAL,
   *      network-free ffprobe tags pass can still upgrade it from an embedded
   *      `purl` a pre-v1.33 scan never stored. A genuine home video with no
   *      tags at all resolves nothing there, is marked `exhausted`, counted
   *      `skipped`, and never touches the network.
   * `withSourceId` counts (2)+(1) -- the items a network pass will actually
   * run for, plus (v1.338 D9) a download from another site in the download root
   * with a usable saved page link -- so the caller can report an honest blast radius instead of
   * implying every library file is about to be fetched.
   *
   * The old `downloadRoots.length === 0 -> everything ineligible` early return
   * is gone with the scoping: a perfectly normal deployment now has re-pullable
   * items with no download root involved at all.
   *
   * Each eligible item's own `metadataRepulledAt` (already set by a prior
   * `recordRepulledItemMeta` call, or absent) is surfaced as `alreadyRepulled`
   * so the caller can decide whether to skip it (a `force` re-run is the
   * caller's own concern -- this helper only classifies, it never filters on
   * that flag itself). Dean's imported items have never been through a reheat
   * batch (they were ineligible until now), so none of them carry the marker:
   * the FIRST widened run picks up every one of them, no `force` needed.
   *
   * @param {object} db a `loadDatabase()`-shaped db snapshot
   * @param {object} config a parsed yt-dlp config (`ytdlp.parseYtdlpConfig()`)
   * @param {Function} [itemVisible] v1.127 Wave A: an optional requester-visibility
   *   predicate (the full metadata item -> boolean, from `mediaVisiblePredicate`).
   *   When passed, a hidden item enters NEITHER the worklist NOR the
   *   eligible/withSourceId counts; when omitted, the whole library is enumerated
   *   (the pre-v1.127 behavior, correct only for admin/system callers).
   * @returns {{items: Array<{mediaId: string, filePath: string, videoId: string|null, watchUrl: string|null, inDownloadRoot: boolean, alreadyRepulled: boolean}>, eligible: number, ineligible: number, withSourceId: number}}
   */
  // v1.338 gate (adversary r1 S3, qa r2 S1): a saved link the re-pull would REFUSE (the lane's intake
  // check) or could not verify (no sourceId) never reaches the network, so it is not counted.
  function reheatableLink(item) {
    const link = sanitizeSourceShareUrl(item.sourceUrl);
    return Boolean(link) && isPlausibleMediaUrl(link).ok === true
      && typeof item.sourceId === 'string' && item.sourceId !== '';
  }

  function enumerateRepullableItems(db, config, itemVisible) {
    const result = { items: [], eligible: 0, ineligible: 0, withSourceId: 0 };
    const metadata = (db && db.metadata) || {};
    const downloadRoots = ytdlp.extraScanRoots(config);

    for (const id of Object.keys(metadata)) {
      const item = metadata[id];
      if (!item || typeof item.filePath !== 'string' || item.filePath === '') {
        result.ineligible++;
        continue;
      }
      // v1.127 Wave A: optional requester-visibility predicate (from
      // mediaVisiblePredicate). A hidden item never enters the worklist NOR the
      // eligible/withSourceId counts - counting it would leak its existence to a
      // restricted manage-subs member. Checked AFTER the broken-record branch so
      // the ineligible count stays identical for every caller.
      if (typeof itemVisible === 'function' && !itemVisible(item)) continue;
      const baseName = path.basename(item.filePath, path.extname(item.filePath));
      // Filename `[id]` bracket first -- but ONLY inside the download root (see
      // this function's doc comment: the bracket is a yt-dlp naming convention
      // there and a coincidence anywhere else). Else a previously-persisted
      // `youtubeId` (scan backfill from the embedded tag / a prior reheat's own
      // discovery), re-checked through isSafeVideoId (untrusted-until-proven,
      // same as every other persisted-then-reread field) and trusted from any
      // root. An item with NEITHER still flows through with null
      // videoId/watchUrl so the batch worker's LOCAL ffprobe pass runs; the
      // worker derives a watch URL from an embedded purl on the fly when one
      // exists (see runRepullMetadataBatch, lib/ytdlp/index.js).
      const bracketId = matchRootFolder(item.filePath, downloadRoots)
        ? extractYtdlpVideoId(baseName)
        : null;
      const videoId = bracketId || (isSafeVideoId(item.youtubeId) ? item.youtubeId : null);
      const watchUrl = videoId ? buildWatchUrl(videoId) : null;

      const inDownloadRoot = !!matchRootFolder(item.filePath, downloadRoots);
      // v1.338 D9: a download from another site (no YouTube id, a non-YouTube extractor).
      const universal = !videoId && typeof item.sourceExtractor === 'string' && item.sourceExtractor !== ''
        && item.sourceExtractor.toLowerCase() !== 'youtube';
      result.items.push({
        mediaId: getMediaId(item.filePath),
        filePath: item.filePath,
        videoId,
        watchUrl,
        // v1.41.5 gate fix: does this file live under the module's OWN download
        // dir? Before the widening, that was true of EVERY enumerated item and
        // was therefore implicit -- it is what licenses the batch to trust the
        // file's embedded `title`/`date` tags as YouTube provenance (a file in
        // there was put there by yt-dlp/metube). Now that plain library files are
        // enumerated too, the batch needs the fact explicitly, or it would
        // supersede a ripped CD's curated title with its ID3 tag. See
        // `runRepullMetadataBatch`'s `trustEmbeddedTags`.
        inDownloadRoot,
        alreadyRepulled: !!item.metadataRepulledAt,
        // v1.338 (Dean: "Reheat is fine" / plan first-class-any-site D9): a download from another site
        // (no YouTube id, a non-YouTube extractor) re-pulls from its SAVED page link. Raw here; the
        // reheat re-checks it (sanitizeSourceShareUrl) and the re-pull guards it (isPlausibleMediaUrl,
        // a DNS resolve-then-check, the named-extractor gate) before yt-dlp ever sees it.
        universal,
        sourceUrl: typeof item.sourceUrl === 'string' && item.sourceUrl !== '' ? item.sourceUrl : null,
        // v1.338 gate (adversary r1 W1): the id the re-pull must see come back (raw; checked in run.js).
        sourceId: universal && typeof item.sourceId === 'string' && item.sourceId !== '' ? item.sourceId : null,
      });
      result.eligible++;
      // v1.338 D9 (gate r1 qa 3): a download from another site with a usable saved link is network-bound
      // too (the reheat re-pulls it under the same runExclusive gate), so it counts. A link only in its
      // file tags is found at reheat time and is not counted here (no file reads while enumerating).
      if (videoId || (universal && inDownloadRoot && reheatableLink(item))) result.withSourceId++;
    }

    return result;
  }

  /**
   * Write a single re-pull job's result back into `db.metadata[mediaId]`,
   * through the single serialized `updateDatabase` mutator -- mirrors
   * `moveItemToFolder`'s deps shape (`{loadDatabase, updateDatabase,
   * getMediaId}`), but only `deps.updateDatabase` is actually needed here:
   * there is no file move, so no id re-key, and no separate `loadDatabase()`
   * call (`updateDatabase` already hands the mutator a fresh, lock-held `db`).
   *
   * - `meta.releaseDate`, when a finite number, SUPERSEDES whatever value
   *   `item.releaseDate` already carries (the same "yt-dlp metadata is more
   *   precise than a filesystem timestamp" precedence the scan's own
   *   `consumeDownloadChannelMeta` bridge in server.js already applies) -- a
   *   re-pull is a deliberate refresh, not a gap-fill, so it must never lose to
   *   a stale/mtime-derived value the way the scan's ADDITIVE
   *   `hasOwnProperty`-guarded backfills in server.js's scan do.
   * - `meta.channelAvatarUrl`, when a non-empty string, is set the same way --
   *   but ONLY when the item is attributable to the channel that avatar belongs
   *   to (see `meta.channel` below). (v1.41.5: this branch was DEAD -- nothing
   *   ever passed the field, since a per-video `--dump-json` carries no
   *   `channel_thumbnail`. It is live again: the reheat batch now hands it the
   *   avatar `ensureChannelAvatar` probed for this item's newly-discovered
   *   channel, ONCE per distinct channel.)
   * - `meta.channel` (v1.41.5, MeTube-import hydration), when present, carries
   *   the item's CHANNEL IDENTITY -- `{channelUrl, channelHandleUrl?,
   *   channelId?, channelName?}`, already validated by the SINGLE gate the
   *   download-capture path uses (`store.sanitizeCapturedChannelMeta`, called
   *   in `run.repullItemMetaAndSubs` off the same `--dump-json` payload). This
   *   is what turns a MeTube-imported file's generic folder-name "channel" into
   *   the real creator (name + avatar + a working Subscribe button:
   *   `resolveChannelName`/`deriveChannelIdentity`, public/js/common.js).
   *   Unlike `releaseDate`/`sourceTitle` above, identity is written with a
   *   NEVER-OVERWRITE guard -- the SAME AC17 posture as the scan's own
   *   folder-based backfill in server.js (`if (!item.channelUrl)`): an item that
   *   already has a `channelUrl` (a native FileTube download, or a previously
   *   hydrated import) is never re-pointed at a different channel by a reheat.
   *   Its individual gaps are still filled, but ONLY when the discovered
   *   `channelUrl` is the SAME channel -- so a video that has since been
   *   re-uploaded elsewhere can never staple channel B's name/id/avatar onto an
   *   item already attributed to channel A.
   * - `item.hasSubtitles` is UNCONDITIONALLY recomputed from
   *   `subtitles.findSubtitleSidecar(item.filePath)` -- re-checked against the
   *   real filesystem so a subtitle sidecar the re-pull job just wrote lights
   *   up the CC button immediately, without waiting for the next scan.
   * - ALL of the above are persisted regardless of `meta.markComplete` -- a
   *   re-pull's metadata pass (Pass A) and subtitle pass (Pass B) run and fail
   *   INDEPENDENTLY (see `run.repullItemMetaAndSubs`'s own doc comment), so
   *   whatever either pass actually produced is always worth keeping.
   * - `item.metadataRepulledAt` is set to `nowMs` ONLY when `meta.markComplete
   *   === true`. The caller (`runRepullMetadataBatch`, lib/ytdlp/index.js)
   *   passes `true` iff the SUBTITLE pass actually completed
   *   (`result.wroteSubs === true`) -- a TRANSIENT subtitle-spawn failure
   *   (timeout/spawn error, `wroteSubs: false`) must never permanently mark
   *   this item "done": `enumerateRepullableItems`'s `alreadyRepulled` flag is
   *   this exact marker, and setting it unconditionally would make a
   *   subs-spawn failure un-retryable on every later non-`force` reheat, even
   *   though the metadata half genuinely succeeded. When `markComplete` is
   *   `false`/absent, the marker is left exactly as it already was (never
   *   cleared, never set) -- only the fields above are refreshed.
   * - NO re-key: `mediaId` is the same before and after (no file move ever
   *   happens here), so the progress rows for `mediaId` and every id-keyed sidecar
   *   (thumbnail, transcode) stay bound to the exact same id, untouched.
   * - A `mediaId` no longer present in `db.metadata` (the item was deleted
   *   concurrently, mid-run) is a safe no-op: the mutator returns `false`
   *   (skips the save) and this function resolves to `false`.
   *
   * @param {{loadDatabase?: Function, updateDatabase: Function, getMediaId?: Function}} deps
   * @param {string} mediaId
   * @param {{releaseDate?: number, channelAvatarUrl?: string, channel?: {channelUrl: string, channelHandleUrl?: string, channelId?: string, channelName?: string}, filePath: string, markComplete?: boolean, allowViewCountDecrease?: boolean}} meta
   *   `allowViewCountDecrease` (v1.49): opt OUT of the view-count monotonicity
   *   guard for THIS call only -- see the guard's own comment below. Passed
   *   solely by the per-video force reheat; absent/false everywhere else.
   * @param {number} [nowMs] injectable clock, for deterministic tests (mirrors store.js's own `nowMs=Date.now()` pattern)
   * @returns {Promise<boolean>} resolves `true` if the item was updated, `false` on a safe no-op
   */
  async function recordRepulledItemMeta(deps, mediaId, meta, nowMs = Date.now()) {
    const d = deps || {};
    const updateDb = d.updateDatabase;
    if (typeof updateDb !== 'function') return false;
    const m = meta || {};

    return updateDb((db) => {
      const item = db.metadata[mediaId];
      if (!item) return false; // vanished mid-run -- no-op, never resurrect

      if (typeof m.releaseDate === 'number' && Number.isFinite(m.releaseDate)) {
        item.releaseDate = m.releaseDate; // SUPERSEDE, not gap-fill
      }
      // v1.48 item 2 (Dean: "have it re-heatable if pulled later"): the
      // re-snapshotted view count, SUPERSEDING the stored one -- re-snapshotting
      // IS the feature, so a reheat deliberately replaces an older count rather
      // than gap-filling. Re-validated at this write boundary through the same
      // standalone validator the capture path used, never trusted from the
      // caller. `viewCountCapturedAt` is stamped from `nowMs` (this function's
      // already-injected clock, never a fresh Date.now()) and is what lets the UI
      // say "when downloaded" honestly instead of implying a live number; the two
      // fields are written as a UNIT so a count can never carry a stale date.
      // NOTE the field name: `sourceViewCount`, never `viewCount` -- see
      // `applyCapturedViewCount` for why that collision would have corrupted the
      // legacy local watch counter.
      // GATE FIX (adversarial WARNING W1): MONOTONICITY GUARD. A reheat
      // supersedes, so without this any value clearing the validator -- including
      // 0 -- replaced a good count. A LOWER number from a reheat is nearly always
      // a degraded read rather than news: a bot-check/age-gate client fallback
      // reporting "0", a members-only or premiere state, a re-upload behind the
      // same id. Refusing those keeps the better-sourced number instead of
      // writing "0 views" over a captured 1.67 billion.
      //
      // HONEST LIMIT (adversarial SUGGESTION S-D2): "monotonically non-decreasing"
      // is an approximation, not a law -- YouTube does audit and purge bot views,
      // which legitimately lowers a count. This policy therefore delays a genuine
      // downward correction until the real number climbs back past the stored
      // high-water mark, and it applies to `force` reheats too. That trade is
      // deliberate and recorded in docs/exec-plans/tech-debt-tracker.md #60 with
      // its revisit trigger: a count that is slightly stale-HIGH and self-heals
      // beats one that is visibly wrong because a degraded read destroyed good
      // data on the user's own click.
      //
      // The guard applies ONLY to the supersede-an-existing-value case; a FIRST
      // capture of 0 is legitimate (a brand-new upload) and still lands. The date
      // is only re-stamped when the count is actually accepted, so a refused
      // reheat cannot leave a stale count wearing a fresh date.
      //
      // v1.49 (Dean, per-video reheat decision 2): `m.allowViewCountDecrease`
      // is the ONE documented escape hatch, and it is passed ONLY by the
      // explicit single-video force (`POST /api/ytdlp/repull-metadata/item/:id`).
      // The reasoning that makes a blanket guard right for the BATCH is exactly
      // what makes it wrong there: the batch refuses a decrease because it
      // cannot tell a degraded read from news across thousands of unattended
      // items, whereas a per-video force is one human, looking at one item,
      // asking for this specific number to be re-fetched -- and today the guard
      // makes that click silently do nothing in the case most likely to prompt
      // it. Blast radius is one row, and pressing it again re-fetches.
      // DEFAULTS OFF (`=== true`): the batch's behaviour is byte-identical to
      // v1.48, and tech-debt #60 stays open against the batch.
      const repulledViews = ytdlp.parseCapturedViewCount(m.sourceViewCount);
      if (repulledViews !== null) {
        const stored = item.sourceViewCount;
        const hasStored = typeof stored === 'number' && Number.isInteger(stored) && stored >= 0;
        if (!hasStored || repulledViews >= stored || m.allowViewCountDecrease === true) {
          item.sourceViewCount = repulledViews;
          item.sourceViewCountCapturedAt = nowMs;
        }
      }
      // v1.54: the follower count SUPERSEDES unconditionally -- deliberately NO
      // monotonicity guard (unlike views): subscriber counts legitimately fall,
      // a reheat is a deliberate refresh, and the label carries its own "as of"
      // date. Decided + disclosed in the v1.54 exec plan.
      const repulledFollowers = ytdlp.parseCapturedFollowerCount(m.sourceFollowerCount);
      if (repulledFollowers !== null) {
        item.sourceFollowerCount = repulledFollowers;
        item.sourceFollowerCountCapturedAt = nowMs;
      }
      // v1.41.5 (MeTube-import hydration): the channel identity the network
      // metadata pass discovered -- NEVER-OVERWRITE (AC17 posture), see this
      // function's doc comment. `m.channel` has already crossed
      // `store.sanitizeCapturedChannelMeta` in run.js (channelUrl normalized by
      // `url.validateChannelUrl`, channelId `UC…`-shaped, channelName
      // control-stripped/capped) -- the shape checks below are the same
      // re-validate-at-the-write-boundary defense-in-depth every other branch
      // here uses, never a second/forked validator.
      const c = m.channel && typeof m.channel === 'object' ? m.channel : null;
      // Is the discovered channel the one this item is ALREADY attributed to?
      // (gate fix, adversarial SUGGESTION): compare by `channelId` when BOTH
      // sides know one -- yt-dlp returns the canonical `/channel/UC…` form while
      // a folder-backfilled item carries the subscription's HANDLE url
      // (`/@name`), so a bare string compare would have declined the gap-fill
      // branch's own headline use case. URL equality is the fallback when either
      // side has no id.
      const sameChannel = c && item.channelUrl && (
        (typeof item.channelId === 'string' && item.channelId !== '' && typeof c.channelId === 'string' && c.channelId !== '')
          ? item.channelId === c.channelId
          : item.channelUrl === c.channelUrl
      );
      // The item is attributable to this discovered channel iff it has no
      // identity yet, or the identity it has IS this channel. Everything below
      // -- including the avatar -- is gated on it (gate fix, adversarial
      // WARNING): the avatar used to be written unconditionally, ABOVE this
      // guard, so an item the guard correctly DECLINED to re-point still got the
      // other channel's face stapled onto it (channel A's name over channel B's
      // avatar on the watch page).
      const attributable = !!c && (!item.channelUrl || sameChannel);
      // v1.53 (manual attribution, Dean's decision 3): a MANUAL attribution
      // that disagrees with the freshly-resolved network identity is KEPT --
      // and REPORTED, never silently. The `attributable` guard above already
      // declines the write (manual sets channelUrl, so attributable collapses
      // to sameChannel); what was missing is the signal. The conflict is
      // written onto the caller-owned `m` (the deps-bridge style) so
      // runSingleItemReheat can stamp it on the activity one-shot -- without
      // it, describeReheat toasts "everything was already up to date", which
      // is actively false.
      if (item.channelAttributedManually === true && c && item.channelUrl && !sameChannel) {
        m.attributionConflict = {
          kept: typeof item.channelName === 'string' && item.channelName !== '' ? item.channelName : item.channelUrl,
          discovered: typeof c.channelName === 'string' && c.channelName !== '' ? c.channelName : c.channelUrl,
        };
      }
      if (c && typeof c.channelUrl === 'string' && c.channelUrl !== '' && attributable) {
        if (!item.channelUrl) {
          // A genuine gap -- exactly Dean's MeTube imports (a folder name is all
          // they ever had). Write the identity as a UNIT: all of it comes from
          // this one video's own info dict, so it can never be mixed.
          item.channelUrl = c.channelUrl;
          if (typeof c.channelHandleUrl === 'string' && c.channelHandleUrl !== '') item.channelHandleUrl = c.channelHandleUrl;
          if (typeof c.channelId === 'string' && c.channelId !== '') item.channelId = c.channelId;
          if (typeof c.channelName === 'string' && c.channelName !== '') item.channelName = c.channelName;
        } else if (!item.channelAttributedManually) {
          // Already attributed to this SAME channel -- fill genuine per-field
          // gaps only (e.g. a folder-backfilled item that got a handle URL but
          // no channelId), never re-point or rewrite what is already there. The
          // existing `channelUrl` is deliberately NOT normalized to the
          // canonical form: rewriting it is an overwrite, not a gap-fill, and
          // every consumer already joins on channelId/handle alike.
          // v1.53: a MANUALLY-attributed item is excluded even from same-
          // channel gap-fill -- what Dean wrote by hand is exactly what he
          // sees, and the network adds nothing to it uninvited.
          if (!item.channelHandleUrl && typeof c.channelHandleUrl === 'string' && c.channelHandleUrl !== '') item.channelHandleUrl = c.channelHandleUrl;
          if (!item.channelId && typeof c.channelId === 'string' && c.channelId !== '') item.channelId = c.channelId;
          if (!item.channelName && typeof c.channelName === 'string' && c.channelName !== '') item.channelName = c.channelName;
        }
      }
      // ...and the avatar the batch probed for THAT channel, only when the item
      // is genuinely attributable to it (see `attributable` above). An item with
      // no `m.channel` at all (no identity was discovered this run) can still
      // take an avatar -- that is the pre-existing, item-scoped contract, and
      // there is no other channel it could belong to.
      if (typeof m.channelAvatarUrl === 'string' && m.channelAvatarUrl !== '' && (!c || attributable) && !item.channelAttributedManually) {
        // v1.53: the manual guard joins the avatar gate -- a manual
        // attribution's avatar (or deliberate lack of one) is part of the
        // hand-set unit.
        item.channelAvatarUrl = m.channelAvatarUrl;
      }
      // v1.33 T3: the re-pulled REAL title (network `--dump-json` or the local
      // embedded `title` tag) -- sanitized through the SAME single gate the
      // download-capture path uses (`ytdlp.sanitizeCapturedTitle`: control-char
      // strip, trim, length cap; emoji survive). SUPERSEDES the display title,
      // same "a re-pull is a deliberate refresh" precedence as releaseDate.
      if (typeof m.sourceTitle === 'string') {
        const cleanTitle = ytdlp.sanitizeCapturedTitle(m.sourceTitle);
        if (cleanTitle !== null) {
          item.sourceTitle = cleanTitle;
          item.title = cleanTitle;
        }
      }
      // v1.33 T1: a youtubeId discovered by the batch (filename bracket, a
      // prior persisted value, or an embedded purl the LOCAL pass surfaced) --
      // re-checked through isSafeVideoId before persisting, gap-fill-or-refresh
      // (the id for a given file can only ever be one value, so supersede is
      // safe and heals a stale/garbage value too).
      if (typeof m.youtubeId === 'string' && isSafeVideoId(m.youtubeId)) {
        item.youtubeId = m.youtubeId;
      }
      // v1.34 T3: re-pulled EMBEDDED/NETWORK chapters -- re-normalized through
      // the same single grammar owner before anything is stored, SUPERSEDE
      // semantics like releaseDate (a reheat is a deliberate refresh). Only
      // ever touches the probe-derived field; chaptersManual stays the
      // editor's alone.
      if (Array.isArray(m.chapters)) {
        const cleaned = finalizeChapters(m.chapters
          .map((ch) => ch && typeof ch === 'object' ? normalizeChapter(ch.startTime, ch.title) : null)
          .filter(Boolean));
        item.chapters = cleaned;
      }
      // Re-check the sidecar on disk NOW (after the subs pass), against the
      // item's OWN filePath -- same resolver the scan's `hasSubtitles`
      // detection and `GET /api/subtitles/:id` use, so this can never disagree
      // with what those consider "this item's sidecar".
      item.hasSubtitles = !!subtitles.findSubtitleSidecar(item.filePath);
      // The idempotency marker is gated on the caller's own completion signal
      // -- see this function's doc comment above for why an absent/`false`
      // `markComplete` must leave it untouched rather than clearing it.
      if (m.markComplete === true) {
        item.metadataRepulledAt = nowMs;
      }

      return true;
    });
  }

  return {
    migrateOneOffsIntoChannelFolders,
    planImportRelocation,
    relocateHydratedImportIntoChannelFolder,
    buildImportRelocationPreview,
    enumerateRepullableItems,
    recordRepulledItemMeta,
  };
}

module.exports = { createRelocation };
