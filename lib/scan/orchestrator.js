'use strict';
// lib/scan/orchestrator.js - the scan orchestrator (runScanDirectories + its
// cooperative directory walk) and the ffprobe/metadata/thumbnail/storyboard
// extraction pipeline and the on-disk path resolvers, moved VERBATIM out of
// server.js in Wave 7b (slice S9) of the relational-migration arc. server.js
// keeps scanDirectories (the scan-lock/interval entry) and hands the
// collaborators in through deps (the lib/media/trash + lib/ytdlp/relocation
// factory pattern).
//
// TWO deliberate non-byte-identical seams - each a server.js let reassigned
// AFTER this factory is built, so a const { x } = deps snapshot would freeze
// the boot value (the S10a live-seams lesson):
//   - ffmpegAvailable (an async ffmpeg probe flips it long after boot) is read
//     LIVE as ffmpegIsAvailable() - the same accessor server.js already hands
//     lib/media and lib/music.
//   - persistedStateEpoch (the wipe-and-replace epoch) is read LIVE as
//     __getPersistedStateEpoch() - server.js's existing accessor.
// Every other byte is identical modulo one indent level (code lines only;
// multi-line string/template CONTENT lines are unindented and verbatim).
//
// The Wave 6 lib/scan leaf helpers (roots/merge/identity/captured/probe) are
// required DIRECTLY here with re-rooted ./ specifiers (server.js reaches them
// as ./lib/scan/*; a relative specifier follows the FILE it now lives in), not
// threaded through deps - module caching makes these the SAME objects server.js
// re-exports, so scan-helpers-extraction.test.js's identity lock still holds.

const { matchRootFolder, normalizeScanRoot, detectVanishedRoots } = require('./roots');
const { selectPrunableIds, mergeScannedMetadata } = require('./merge');
const { extractYtdlpVideoId, deriveScanYoutubeId, deriveReleaseDate } = require('./identity');
const { applyCapturedViewCount, applyCapturedFollowerCount, collectDownloadNotification } = require('./captured');
const { applyHasSubtitlesDetection } = require('./probe');

function createScanOrchestrator(deps) {
  const {
    ALL_EXTENSIONS,
    AUDIO_EXTENSIONS,
    READ_ONLY_MEDIA,
    THUMBNAIL_DIR,
    TRASH_DIR_NAME,
    __getPersistedStateEpoch,
    buildFfprobeArgs,
    buildStoryboardAssembleArgs,
    buildStoryboardFrameArgs,
    cleanDisplayTitle,
    clearPersistedServedAt,
    destroyMediaStreams,
    execFile,
    extractMediaRef,
    extractPreviewClip,
    faststart,
    ffmpegIsAvailable,
    firstStreamRotation,
    folderStore,
    fs,
    getMediaId,
    inSaveTransaction,
    isInFlightTranscode,
    isSafeVideoId,
    isValidMediaDimension,
    isYtdlpIntermediate,
    loadDatabase,
    maybeYieldScan,
    needsTranscode,
    orderScannedByRecency,
    parseEmbeddedReleaseDateMs,
    parseEmbeddedSourceUrl,
    parseFfprobeChapters,
    parseFfprobeTags,
    path,
    planStoryboard,
    previewClipPath,
    probeCodecsOnly,
    progressStore,
    pushDelivery,
    queueAudioExtract,
    reconcileTranscode,
    restoreMissingPreviewClip,
    restoreMissingStoryboard,
    restoreMissingThumbnail,
    runFfmpegQuiet,
    scanState,
    settingsStore,
    storyboardPath,
    storyboardSeekTimes,
    subtitles,
    tombstoneStore,
    transcodedPath,
    trashOrphanFile,
    trashStore,
    updateDatabase,
    userStore,
    viewCountStore,
    ytdlp,
    ytdlpDb,
  } = deps;

  function parseFfprobeStreams(input) {
    let j = input;
    if (typeof input === 'string') {
      try { j = JSON.parse(input); } catch (_) { return {}; }
    }
    if (!j || typeof j !== 'object') return {};
    const streams = Array.isArray(j.streams) ? j.streams : [];
    const out = {};
    const isAttachedPic = (s) => !!(s.disposition && s.disposition.attached_pic === 1);
    const videoStream = streams.find(s => s && s.codec_type === 'video' && s.codec_name && !isAttachedPic(s));
    if (videoStream) {
      out.videoCodec = String(videoStream.codec_name).toLowerCase();
      // Feature A (v1.26.1): same non-attached_pic video stream the codec was
      // just pulled from -- so an audio file's embedded cover-art stream (a
      // `codec_type: 'video'` entry too) never contributes a bogus width/
      // height. `Number(...)` first so a string-typed ffprobe field ("1920")
      // is still accepted; anything non-integer/non-positive/oversized is
      // left absent rather than persisted.
      const w = Number(videoStream.width);
      const h = Number(videoStream.height);
      if (isValidMediaDimension(w)) out.width = w;
      if (isValidMediaDimension(h)) out.height = h;
      // F2 (v1.26.1 two-reviewer follow-up): ffprobe's width/height are the
      // stream's CODED dims, not its DISPLAY dims -- a phone-shot portrait
      // video is frequently stored with landscape coded dims (e.g.
      // 1920x1080) plus a 90-degree rotation flag telling every player to
      // rotate it before display; a browser's own `videoWidth`/`videoHeight`
      // (player.js's `loadedmetadata`) already reflect that correction, but
      // ffprobe's raw `width`/`height` do not. Left uncorrected, this item's
      // stored dims (and the reserved-aspect box they drive, Feature A above)
      // would be landscape-shaped for a video that actually displays
      // portrait. `Math.abs(rotation) % 180 === 90` catches a 90-or-270-degree
      // turn (`firstStreamRotation` may return a NEGATIVE value, e.g. -90 --
      // `Math.abs` normalizes the sign since only the axis swap, not the
      // spin direction, matters here); a 0/180-degree rotation (or no side
      // data at all, `firstStreamRotation`'s `0` default) leaves the coded
      // orientation as-is. Only swaps when BOTH dims were actually accepted
      // above -- an invalid/missing dim is left absent, not swapped into the
      // other key.
      if (isValidMediaDimension(out.width) && isValidMediaDimension(out.height)) {
        const rotation = firstStreamRotation(videoStream);
        if (Math.abs(rotation) % 180 === 90) {
          const swapped = out.width;
          out.width = out.height;
          out.height = swapped;
        }
      }
    }
    const audioStream = streams.find(s => s && s.codec_type === 'audio' && s.codec_name);
    if (audioStream) out.audioCodec = String(audioStream.codec_name).toLowerCase();
    return out;
  }

  // Extract duration and thumbnail using FFmpeg
  function extractMetadataAndThumbnail(filePath, mediaId, isAudio) {
    return new Promise((resolve) => {
      const thumbName = `${mediaId}.jpg`;
      const thumbPath = path.join(THUMBNAIL_DIR, thumbName);

      if (!ffmpegIsAvailable()) {
        // FIX (v1.18.0 two-reviewer follow-up): explicit `null`, not an absent
        // key, even on this "ffmpeg isn't installed at all" path -- so a
        // no-ffmpeg deployment's reuse-guard `hasCodecFields` check (below,
        // ~line 1241) sees the codec keys as present (probed once, no usable
        // codec) instead of re-extracting (ffprobe attempt + ffmpeg thumbnail
        // attempt) every video item on every single scan forever.
        return resolve({ duration: 0, hasThumbnail: false, artist: '', tags: {}, videoCodec: null, audioCodec: null, embeddedReleaseDateMs: null, embeddedSourceUrl: null, width: null, height: null, chapters: [] });
      }

      // Get duration + all format tags (artist -> channel name; the rest -> the
      // additive "embedded info" block on the watch page) AND, per stream, its
      // codec + attached_pic disposition (FR-1b, v1.18.0 + two-reviewer
      // follow-up) -- ONE probe, no second spawn.
      // Bump maxBuffer well above the 1MB default — files with large embedded
      // tags (long descriptions/lyrics) could otherwise overflow it, set `err`, and
      // regress duration to 0 (which would also mis-time the thumbnail grab).
      execFile('ffprobe', buildFfprobeArgs(filePath), { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        let duration = 0;
        let artist = '';
        let tags = {};
        // FIX (v1.18.0 two-reviewer follow-up): default to explicit `null`
        // (a probe ATTEMPT was made -- this callback only runs once execFile
        // has already returned, whatever the outcome) rather than `undefined`.
        // Previously an errored/unparseable probe left these `undefined`,
        // which `JSON.stringify` drops entirely -> the key came back ABSENT
        // after the DB round-trip -> the reuse-guard's `hasCodecFields` check
        // (~line 1241) was false forever -> that file was re-extracted (a
        // fresh ffprobe + ffmpeg thumbnail spawn) on EVERY subsequent scan.
        // `null` here means "probed, no usable codec determined" (either the
        // probe failed/errored, or -- when overwritten below -- it succeeded
        // but that stream type is genuinely absent from the file); either way
        // the reuse guard now sees the keys present and stops re-probing this
        // file until its size/mtime actually changes. `codecNeedsTranscode`
        // treats `null` exactly like `undefined` (falsy -> never flags), so
        // this is degrade-safe: a corrupt/unprobeable file is simply never
        // flagged for transcode on codec grounds (it may still be flagged by
        // extension).
        let videoCodec = null;
        let audioCodec = null;
        // C5-local (v1.24): embedded release date, piggybacked on this SAME
        // probe (no second spawn) -- `null` means "no usable embedded date"
        // (probe failed/errored, or the file genuinely carries none), which
        // the caller (`deriveReleaseDate`) treats as "fall through to mtime".
        let embeddedReleaseDateMs = null;
        // v1.33 T1: embedded ORIGINAL source URL (yt-dlp/metube `--embed-metadata`
        // `purl`/`comment` tags), from this SAME probe -- `null` on probe
        // failure or when the file genuinely carries none; the scan's
        // new/updated branch turns it into a persisted `youtubeId` via the
        // classifySingleVideo gate.
        let embeddedSourceUrl = null;
        // v1.34 T3: embedded chapters, from this SAME probe (-show_chapters).
        // [] on probe failure or a file with none.
        let chapters = [];
        // Feature A (v1.26.1): VIDEO-only intrinsic dimensions, from the SAME
        // probe -- `null` by default (audio items, a failed/errored probe, or
        // a video whose real stream dims weren't usable) exactly like
        // `videoCodec`/`audioCodec` above; deliberately left `null` (never
        // set) for `isAudio` even if the probe happened to report a width/
        // height off an embedded cover-art stream -- `parseFfprobeStreams`
        // already excludes attached_pic streams from its video-stream pick,
        // but this is a second, explicit guard at the call site per the
        // "audio items get none" contract.
        let width = null;
        let height = null;
        if (!err && stdout) {
          try {
            const j = JSON.parse(stdout);
            duration = parseFloat(j.format && j.format.duration) || 0;
            const rawTags = (j.format && j.format.tags) || {};
            artist = (rawTags.artist || rawTags.ARTIST || rawTags.Artist || '').trim();
            // Tag/codec extraction is best-effort — never let it break duration/thumbnail.
            try { tags = parseFfprobeTags(j); } catch (_) { tags = {}; }
            try {
              const streams = parseFfprobeStreams(j);
              videoCodec = streams.videoCodec !== undefined ? streams.videoCodec : null;
              audioCodec = streams.audioCodec !== undefined ? streams.audioCodec : null;
              if (!isAudio) {
                width = Number.isInteger(streams.width) ? streams.width : null;
                height = Number.isInteger(streams.height) ? streams.height : null;
              }
            } catch (_) { videoCodec = null; audioCodec = null; }
            try { embeddedReleaseDateMs = parseEmbeddedReleaseDateMs(j); } catch (_) { embeddedReleaseDateMs = null; }
            try { embeddedSourceUrl = parseEmbeddedSourceUrl(j); } catch (_) { embeddedSourceUrl = null; }
            try { chapters = parseFfprobeChapters(j); } catch (_) { chapters = []; }
          } catch (_) {}
        }

        if (isAudio) {
          // Try to extract embedded audio artwork. `execFile` (not `exec`) so
          // `filePath`/`thumbPath` are passed as opaque argv elements, never
          // shell-interpreted -- a media file path containing shell
          // metacharacters could otherwise be a command-injection vector
          // (matches the ffprobe `execFile` hardening above).
          execFile('ffmpeg', ['-i', filePath, '-an', '-vcodec', 'copy', '-y', thumbPath], (artErr) => {
            // Audio-only: no storyboard sprite (excluded by type).
            resolve({ duration, artist, tags, videoCodec, audioCodec, embeddedReleaseDateMs, embeddedSourceUrl, chapters, width, height, hasThumbnail: !artErr && fs.existsSync(thumbPath) });
          });
        } else {
          // Extract video frame (at 2 seconds or 10% of duration, whichever is
          // smaller). `execFile` (not `exec`) for the same arg-array/no-shell
          // reason as the audio-art branch above.
          const timestamp = duration > 5 ? 2 : Math.max(0, duration / 2);
          execFile('ffmpeg', ['-ss', String(timestamp), '-i', filePath, '-vframes', '1', '-q:v', '2', '-y', thumbPath], async (frameErr) => {
            const hasThumbnail = !frameErr && fs.existsSync(thumbPath);
            // v1.92/v1.93.2: generate the scrub/card storyboard SPRITE FILE from
            // this SAME source (best-effort). Runs after the thumbnail so a
            // storyboard failure can never cost us the poster frame. v1.93.2: the
            // sprite is its own state on disk - no descriptor is threaded into the
            // metadata (it is derived at read time by storyboardDescriptor).
            try { await extractStoryboard(filePath, mediaId, duration); } catch (_) { /* best-effort */ }
            // v1.94: also generate the animated hover PREVIEW CLIP from the same
            // source (best-effort; its own on-disk state, no db field).
            try { await extractPreviewClip(filePath, mediaId, duration); } catch (_) { /* best-effort */ }
            resolve({ duration, artist, tags, videoCodec, audioCodec, embeddedReleaseDateMs, embeddedSourceUrl, chapters, width, height, hasThumbnail });
          });
        }
      });
    });
  }

  // v1.92/v1.93.2: generate the storyboard sprite FILE for a VIDEO (best-effort).
  // Returns true iff a valid sprite was written, false otherwise (ffmpeg missing,
  // ineligible duration, or a generation failure). Never throws and never blocks
  // the thumbnail/metadata result. v1.93.2: no descriptor is returned - the sprite
  // is its own on-disk state and its geometry is derived at read time by
  // storyboardDescriptor (so this owns only the FILE, not any db field).
  //
  // v1.93.1 BOUNDED MEMORY: the sprite is built in two ffmpeg stages so the
  // source file is open at most ONCE at a time. Stage 1 grabs each sampled frame
  // with its own single-input `ffmpeg -ss <t> -i src` (one decoder resident ~=
  // v1.92 RSS) into a per-id temp dir, SEQUENTIALLY. Stage 2 tiles those small
  // frames into the sprite (decodes only the tiles, not the source). This
  // replaces v1.93.0's single N-input command, whose N simultaneous decoder
  // contexts spiked to ~9.3 GB on a large 4K source and would OOM a memory-tight
  // host. The temp dir is deterministic (per-id: no mkdtemp inode leak, and a
  // crashed prior run's leftovers are cleared on entry) and ALWAYS removed in the
  // finally.
  async function extractStoryboard(filePath, id, duration) {
    if (!ffmpegIsAvailable()) return false;
    const outPath = storyboardPath(id);
    const plan = planStoryboard(duration);
    if (!plan) {
      // Newly ineligible (e.g. an in-place replace with a sub-2s clip): drop any
      // stale sprite so a leftover <id>.sb.jpg can't linger for the id's life.
      try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) { /* best-effort */ }
      return false;
    }
    const tmpDir = path.join(THUMBNAIL_DIR, `.sbtmp-${id}`);
    const seeks = storyboardSeekTimes(plan);
    try {
      // Fresh temp dir - clear any leftover from a crashed prior run so a stale
      // frame can't poison this sprite's numbered sequence.
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
      fs.mkdirSync(tmpDir, { recursive: true });
      // Belt (adversarial gate): if the rmSync above fail-opened (e.g. a crash
      // leftover the process now can't remove), mkdir is a no-op on the existing
      // dir - so a stale higher-index frame from a LONGER prior run could survive
      // and over-fill this run's partial last row in Stage 2. Guarantee the dir is
      // empty. A throw here degrades to null via the outer catch (safe).
      for (const stale of fs.readdirSync(tmpDir)) fs.rmSync(path.join(tmpDir, stale), { force: true });
      // Stage 1: grab each frame with its OWN ffmpeg, one at a time -> a single
      // decoder is ever resident. Lossless PNG intermediates (single JPEG encode
      // in Stage 2). `%03d`-padded to feed image2 (count <= SB_MAX_FRAMES = 100).
      for (let i = 0; i < seeks.length; i++) {
        const framePath = path.join(tmpDir, `f${String(i).padStart(3, '0')}.png`);
        const gErr = await runFfmpegQuiet(buildStoryboardFrameArgs(filePath, framePath, seeks[i], plan.tileW));
        let frameOk = false;
        try { frameOk = !gErr && fs.existsSync(framePath) && fs.statSync(framePath).size > 0; } catch (_) { frameOk = false; }
        if (!frameOk) {
          // A single missing frame breaks the image2 sequence -> abort cleanly.
          // No sprite is the same graceful degrade as v1.92 on a generation
          // failure; drop any stale sprite for this id.
          try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) { /* best-effort */ }
          return false;
        }
      }
      // Stage 2: tile the grabbed PNG frames into the sprite JPEG (small-tile
      // memory only; this is the single lossy encode).
      const pattern = path.join(tmpDir, 'f%03d.png');
      const aErr = await runFfmpegQuiet(buildStoryboardAssembleArgs(pattern, outPath, plan.cols, plan.rows));
      let ok = false;
      try { ok = !aErr && fs.existsSync(outPath) && fs.statSync(outPath).size > 0; } catch (_) { ok = false; }
      if (!ok) {
        try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) { /* best-effort */ }
        return false;
      }
      return true;
    } catch (_) {
      try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) { /* best-effort */ }
      return false;
    } finally {
      // ALWAYS remove the temp dir (success, abort, or throw) - the #110 leak lesson.
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
    }
  }

  // Scan directories and sync with database
  async function runScanDirectories() {
    // Wave 4: the settings this scan reads are captured ONCE, with the Phase-1
    // snapshot below - a settings change mid-scan is not observed mid-scan,
    // exactly as the old `db.settings` snapshot behaved.
    const scanSettings = settingsStore.get();
    const scanFolders = folderStore.list(); // Wave 4: the root list, captured with the snapshot too
    // v1.30 A3: intentionally left on `loadDatabase()`, not switched to the
    // cache -- this is the scan's own Phase-1 snapshot (background job, not a
    // request/serve-path read; runs once per scan pass, not per request). The
    // scan's authoritative write-back already goes through `updateDatabase`'s
    // own fresh-read-inside-the-lock (below), independent of this snapshot, so
    // leaving this on a genuinely fresh disk read keeps the T1/T2 scan-cache
    // interaction boundary unchanged from this task.
    const db = loadDatabase();
    // v1.42 (gate W4): remember which persisted-state EPOCH this scan's
    // Phase-1 snapshot belongs to — the final merge refuses to commit against
    // a different one (see the guard at the top of the final mutator below).
    const scanEpochAtStart = __getPersistedStateEpoch();
    // Merge in the yt-dlp module's own scan root (C3+C7 + D1 reframe + E1 fix,
    // T4 fix rounds #2/#3): `extraScanRoots(ytdlpConfig)` returns
    // `[path.resolve(downloadDir)]` when **`isEnabled(config)` OR
    // `fs.existsSync(downloadDir)`** (an OR-gate, not either condition alone),
    // and `[]` only when `downloadDir` is unset/blank, or the module has NEVER
    // been enabled AND the dir doesn't exist. Consequences: a never-enabled
    // install (the dir was never created) is byte-identical to
    // `db.folders || []`, same as before. An ENABLED module ALWAYS contributes
    // `downloadDir` here, even during a TRANSIENT unmount (NFS/external-drive
    // unmount, rename, EACCES) -- so it lands in `missingRoots` below and the
    // mount-loss guard in `selectPrunableIds` protects its ids' metadata,
    // thumbnails, transcode sidecars, and frozen pre-auth progress rows
    // (`media_progress`) from
    // `pruneMissing` instead of them being silently reaped while still enabled
    // (E1: gating this purely on `fs.existsSync` — dropping `config.enabled`
    // from the decision — reopened exactly that mount-loss data-destruction
    // class the v1.8.0 guard exists to prevent; do NOT "simplify" this back to
    // pure existence-gating). A was-enabled-then-disabled install whose
    // download dir still holds content ALSO keeps contributing it here (Dean's
    // decision: disabling must never destroy already-downloaded content).
    // When enabled it contributes `downloadDir` here rather than via a
    // `db.folders` write, so a `POST /api/config` save can never evict it.
    // De-duplicated via a `normalizeScanRoot`-keyed `Set` in case an operator
    // also manually added the same directory to `db.folders`. `ytdlpConfig` is
    // parsed ONCE per scan (D7b efficiency nit) rather than re-parsing ENV on
    // every call.
    //
    // FIX-1 (two-reviewer gate, BLOCKER, data-loss regression): `normalizeScanRoot`
    // is a DEDUP KEY ONLY here -- it must NEVER change the string that is
    // actually WALKED/scanned. The prior version of this code did
    // `[...].map(normalizeScanRoot)`, i.e. it realpath'd the ACTUAL scan roots
    // themselves. For an operator whose `db.folders` entry is a symlink or
    // bind-mount (common under Docker/NAS), that silently re-spelled the root
    // to its realpath -> `scanDirRecursive` walked the RESOLVED path instead of
    // the one on record -> every file's absolute path changed -> `getMediaId`
    // (an `md5(absolute path)` hash) produced brand-new ids for every file
    // under that root -> the OLD ids stopped surviving the scan -> the
    // default-ON `pruneMissing` toggle REAPED them (metadata, thumbnails,
    // transcode sidecars, AND `db.progress` watch positions) on the very next
    // scan after upgrade. A silent data-loss regression for any symlinked/
    // bind-mounted library folder, not just the yt-dlp module's own root.
    //
    // The fix: build the RAW root list first (original, un-realpath'd
    // spellings), then dedup by iterating it and computing
    // `normalizeScanRoot(root)` purely as a comparison KEY -- if that key was
    // already seen, this entry is dropped (it is the SAME real tree as an
    // earlier entry, under a different spelling); otherwise the ORIGINAL root
    // string (never the normalized key) is kept. Two divergent spellings of
    // the same real tree still collapse to exactly one scanned entry (the
    // FIRST-seen original spelling wins and is what actually gets walked), and
    // a root's on-disk spelling is now NEVER altered by this merge -- so no
    // existing file's path-based id can ever change as a side effect of
    // deduping. `db.folders` is iterated before `extraScanRoots` below, so a
    // manually-added `db.folders` alias of the module's own download dir (the
    // AC38/AC41 scenario) is the spelling that is kept and walked, exactly as
    // before this fix -- only the REALPATH-REWRITING side effect is removed.
    const ytdlpConfig = ytdlp.parseYtdlpConfig();
    const currentFolders = [];
    const seenScanRootKeys = new Set();
    for (const rawRoot of [...scanFolders, ...ytdlp.extraScanRoots(ytdlpConfig)]) {
      const key = normalizeScanRoot(rawRoot);
      if (seenScanRootKeys.has(key)) continue; // same real tree as an earlier entry -- drop, never re-walk
      seenScanRootKeys.add(key);
      currentFolders.push(rawRoot); // the ORIGINAL spelling -- never the normalized key
    }
    // FIX-9 (two-reviewer gate): the yt-dlp module's own download root(s),
    // captured once here so the metadata loop below can scope
    // `cleanDisplayTitle` to files actually written by the module -- see that
    // loop's own comment for why a scan-wide cleanup was a false-positive risk
    // for ordinary library files.
    const ytdlpDownloadRoots = ytdlp.extraScanRoots(ytdlpConfig);
    const scannedFiles = new Map(); // path -> file info
    // Configured root folders that are absent/unmounted this scan (the single
    // existence-check seam, reused by selectPrunableIds' mount-loss guard - lib/scan/merge.js).
    const missingRoots = new Set();
    // Directories that are un-enumerable this scan (EACCES/EIO/ESTALE etc.) --
    // populated both when a directory's OWN readdir throws AND when a per-FILE
    // stat throws for an entry inside an otherwise-readable directory (a
    // transient stat error one level deeper is treated the same as a readdir
    // failure: the whole containing directory is marked un-enumerable so its
    // entries are retained rather than pruned). A first-class "could not
    // enumerate this subtree" signal at ANY depth, reused by selectPrunableIds'
    // any-depth guard below.
    const unreadablePaths = new Set();

    // A1 (v1.30, AC1.3): ONE per-scan subtitle-sidecar directory-listing
    // cache, shared across every file processed by THIS scan pass -- see
    // `applyHasSubtitlesDetection`'s doc comment. Deliberately created fresh
    // per call (never module-level/persistent) so a sidecar dropped or
    // removed on disk between scans is still detected on the very next scan;
    // it exists only to collapse repeated `readdirSync`s of the SAME
    // directory within a single pass, not across passes.
    const perScanReaddirCache = new Map();

    // v1.30 A2 (AC1.1/AC1.2): one shared batch-yield counter for this whole
    // pass -- see `maybeYieldScan`/`SCAN_YIELD_BATCH` above. `scanState.phase`
    // tracks which cooperative stage this pass is in; `processed`/`total`
    // reset here (start of a fresh pass) then only ever grow until the pass's
    // own finally-block hand-off in `scanDirectories` (AC2.2).
    const yieldState = { count: 0 };
    scanState.phase = 'walking';
    scanState.processed = 0;
    scanState.total = 0;

    for (const folder of currentFolders) {
      if (!fs.existsSync(folder)) {
        console.warn(`Configured folder does not exist: ${folder}`);
        missingRoots.add(folder);
        continue;
      }
      await scanDirRecursive(folder, folder, scannedFiles, unreadablePaths, yieldState);
    }

    scanState.phase = 'syncing';

    // Update db.metadata
    const newMetadata = {};
    let dbChanged = false;
    // v1.20.0 FR-2: ids that are genuinely NEW/UPDATED this scan (the "else"
    // branch below, not the reuse/legacy-backfill fast paths) -- the Phase-2
    // channel-identity bridge (below) is scoped to these only, mirroring
    // FIX-9's own new-file-only scoping: an already-indexed reuse-fast-path
    // item already carries whatever identity it was assigned on first index
    // (or none), so there is nothing new to consume for it.
    const freshlyScannedIds = new Set();

    // v1.35 (preExtractAudio): freshly-indexed yt-dlp VIDEO files whose .m4a
    // background-audio sidecar should be extracted eagerly. Collected during
    // the walk but fired only AFTER the final save below -- queueAudioExtract's
    // setAudioStatus writes db.metadata[id].audioStatus, and doing that
    // mid-scan would race the Phase-2 wholesale metadata merge (the
    // stale-snapshot class; the sidecar's own self-heal would eventually
    // recover, but not writing into the race at all is strictly better).
    const preExtractCandidates = [];

    // v1.41.3 deletion tombstones (see pruneDeleteTombstones' header for the
    // full contract). Read from the Phase-1 snapshot -- a tombstone minted by
    // a DELETE that lands mid-scan is the concurrent-delete case HR1b (below)
    // already covers; ids consumed HERE are removed from the FRESH in-lock db
    // in the final mutator (never a wholesale replace of the namespace).
    // Wave 2: the tombstones are relational; this is the Phase-1 SNAPSHOT of
    // the table (one read, same moment as the doc snapshot above), consumed
    // ids are removed inside the final mutator's save transaction below.
    const deleteTombstones = tombstoneStore.getAll();
    const consumedTombstoneIds = new Set();

    // v1.65 gate fix (adversarial W8, revised under the AC4.2 lock): a crash
    // between the trash mutator's commit and the source unlink leaves a
    // leftover hard-linked dirent with NO tombstone (pre-minting one would
    // cost every happy-path delete a second durable write, which the
    // coalescer suite's 1:1 lock refuses -- it caught exactly that in this
    // fix round). The SCAN reconciles instead: a scanned file matching a
    // trash record's originalPath AND sharing its trashPath's inode IS that
    // leftover -- unlink it, never index it. A different inode is new content
    // the user placed; it indexes honestly.
    const trashByOriginalPath = new Map();
    // Wave 3: the records are relational; this is the Phase-1 SNAPSHOT of the
    // table (one read, the same moment as the doc snapshot above).
    for (const rec of Object.values(trashStore.getAll())) {
      if (rec && typeof rec.originalPath === 'string' && typeof rec.trashPath === 'string') {
        trashByOriginalPath.set(rec.originalPath, rec);
      }
    }

    // v1.94.1: process NEWEST-first so the default home view (recency-ordered) gets
    // its thumbnail/sprite/preview-clip sidecars generated FIRST. The walk yields
    // files in directory order, so a big backfill previously filled folders one by
    // one and left the home view (often the LAST folder walked) empty for the first
    // stretch. Ordering only changes WHICH files finish first - each is processed
    // independently, so the end state and the Phase-2 merge are unchanged.
    for (const { fp: filePath, fileInfo: info } of orderScannedByRecency(scannedFiles, db.metadata)) {
      const id = getMediaId(filePath);
      const isAudio = AUDIO_EXTENSIONS.includes(info.ext);

      // v1.65 (gate W8): trash-move leftover reconcile -- see the map above.
      const coveringTrashRec = trashByOriginalPath.get(filePath);
      if (coveringTrashRec) {
        let sameInode = false;
        try {
          const a = fs.statSync(filePath);
          const b = fs.statSync(coveringTrashRec.trashPath);
          sameInode = a.ino !== undefined && a.ino === b.ino && a.dev === b.dev;
        } catch (_) { /* stat failure -> not provably ours; index honestly */ }
        if (sameInode) {
          try {
            await destroyMediaStreams(filePath);
            fs.unlinkSync(filePath);
            console.log(`Scan: reconciled a trash-move leftover (same inode as its trash record): ${filePath}`);
          } catch (err) {
            console.warn(`Scan: could not remove the trash-move leftover at ${filePath} (${(err && err.code) || 'unknown'}) -- keeping it hidden; the next scan retries.`);
          }
          // Either way a record-covered same-inode dirent is NEVER indexed
          // (indexing it would resurrect a deleted item); a stale tombstone
          // for this path is consumed -- the reconcile IS its deferred retry.
          // (dbChanged: consumption must persist even on an otherwise
          // no-change scan, same as the retry path's own bookkeeping.)
          if (deleteTombstones[id]) {
            consumedTombstoneIds.add(id);
            dbChanged = true;
          }
          scanState.processed++;
          await maybeYieldScan(yieldState);
          continue;
        }
      }

      // v1.41.3: a re-discovered file whose id was DELETEd. The walk just
      // enumerated this exact path, so unlinking it here cannot suffer the
      // stored-name round-trip failures that let the original delete falsely
      // succeed (tech-debt #35a). mtime NEWER than the delete means new
      // content the user put back on purpose -- index it and forget the
      // tombstone. Either way the tombstone is consumed: one delete, one
      // deferred retry, never a standing suppress-list.
      let tombstone = deleteTombstones[id];
      let tombstoneKey = id;
      if (!tombstone) {
        // SEAM 2 (defense-in-depth secondary match): the primary lookup above is
        // keyed by md5(realDiskPath), but a tombstone from THIS bug class was
        // minted under md5(storedPath) -- a spelling that diverges from what
        // landed on disk (full-width/emoji/invalid-UTF-8/relocation), so the
        // direct hit MISSES and, without this, the survivor is re-indexed and the
        // deleted video REAPPEARS. Recover the match through the yt-dlp id (the
        // stable invariant on both spellings), but only inside the module's own
        // download roots, only on an EXACT id match, and only for a tombstoned
        // path that is itself under a download root -- so this can never reap a
        // DIFFERENT video, and (via the mtime<=deletedAt check below) never a
        // file the user deliberately re-downloaded.
        const scannedRoot = matchRootFolder(filePath, ytdlpDownloadRoots);
        if (scannedRoot) {
          const scannedYtId = extractYtdlpVideoId(path.basename(filePath, info.ext));
          if (scannedYtId) {
            // CRITICAL (v1.41.9 gate): the secondary match must identify the SAME
            // FILE under a divergent leaf spelling -- NOT merely the same youtube
            // id somewhere under a download root. A divergent stored-vs-disk
            // spelling of one file always shares its PARENT DIR and EXTENSION;
            // only the leaf title bytes differ. Without the dirname+extname
            // confinement below, deleting "copy A in chan1" would authorize the
            // scan to unlink an UNRELATED "copy B of the same video id in chan2"
            // (a cross-posted video, a Topic/VEVO mirror, the same video in two
            // subscriptions) -- a file the user never deleted, and mtime is NO
            // safety net here (yt-dlp's default --mtime back-dates a fresh
            // download to the video's UPLOAD time, so a legitimately-fresh copy B
            // has an OLD mtime and fails the mtime<=deletedAt gate). Relocation
            // into a NEW folder is deliberately NOT covered here -- it is handled
            // by the metadata re-key (the claim guard) + moveItemToFolder's
            // destination-tombstone retirement, never by a cross-directory reach.
            // Pick the NEWEST deletedAt on an id tie (most recent delete intent)
            // so the isNewerContent decision is deterministic, not iteration-order
            // dependent.
            for (const [tid, t] of Object.entries(deleteTombstones)) {
              if (!t || typeof t.deletedAt !== 'number' || t.youtubeId !== scannedYtId) continue;
              if (!matchRootFolder(t.filePath || '', ytdlpDownloadRoots)) continue;
              if (path.dirname(t.filePath) !== path.dirname(filePath)) continue;
              if (path.extname(t.filePath) !== path.extname(filePath)) continue;
              if (tombstone && t.deletedAt <= tombstone.deletedAt) continue;
              tombstone = t;
              tombstoneKey = tid;
            }
          } else {
            // v1.41.13 (design D4/D5): the SAME secondary match for a NON-YouTube
            // survivor. The on-disk bracket is the SANITIZED id, and the
            // tombstone stored the bracket id observed at delete time -- so match
            // BRACKET-vs-BRACKET (both dirent-derived, both sanitized; never the
            // raw sourceId), under the IDENTICAL same-dir + same-ext confinement
            // the YouTube branch uses. Cross-directory copies of the same source
            // id are never reaped (the confinement); mtime is no safety net here
            // either, so the dir+ext guard is load-bearing exactly as above.
            const scannedRef = extractMediaRef(path.basename(filePath, info.ext));
            if (scannedRef && scannedRef.source) {
              for (const [tid, t] of Object.entries(deleteTombstones)) {
                if (!t || typeof t.deletedAt !== 'number' || !t.sourceRef) continue;
                if (t.sourceRef.bracketId !== scannedRef.id) continue;
                if ((t.sourceRef.extractor || '').toLowerCase() !== scannedRef.source.toLowerCase()) continue;
                if (!matchRootFolder(t.filePath || '', ytdlpDownloadRoots)) continue;
                if (path.dirname(t.filePath) !== path.dirname(filePath)) continue;
                if (path.extname(t.filePath) !== path.extname(filePath)) continue;
                if (tombstone && t.deletedAt <= tombstone.deletedAt) continue;
                tombstone = t;
                tombstoneKey = tid;
              }
            }
          }
        }
      }
      if (tombstone && typeof tombstone.deletedAt === 'number') {
        // v1.42 safe-mode lever (design review F1 — CRITICAL): under
        // FILETUBE_READ_ONLY_MEDIA the scan must never act on a tombstone
        // match. The destroy scenario this blocks: the beta RESTORES prod's
        // backup bundle (until v1.295 it could also import prod's legacy JSON
        // file) INCLUDING a pending tombstone; prod's own scan later retires
        // its copy and the user re-downloads the video (yt-dlp --mtime
        // back-dates the fresh file, so the mtime<=deletedAt guard passes);
        // the beta's automatic boot scan then matches the imported tombstone
        // against prod's LIVE shared file and unlinks it. Here: no unlink, no
        // sidecar sweep, the tombstone stays UN-consumed (it is prod's to
        // retire), and the file is not indexed (it is, per the beta's own
        // imported state, a deleted file).
        if (READ_ONLY_MEDIA) {
          console.log(`Scan: read-only media mode — leaving tombstone-matched file on disk, unindexed, tombstone kept: ${filePath}`);
          scanState.processed++;
          await maybeYieldScan(yieldState);
          continue;
        }
        // v1.41.10: remembered so the delete-pending branch below can restore it
        // -- its un-consume makes this file's net db effect zero, and leaving
        // dbChanged forced-true would rewrite the index on every scan for as long
        // as the pending state lasts (QA-gate suggestion, this release).
        const dbChangedBeforeConsume = dbChanged;
        consumedTombstoneIds.add(tombstoneKey);
        dbChanged = true; // the consumption itself must persist
        const isNewerContent = typeof info.mtimeMs === 'number' && info.mtimeMs > tombstone.deletedAt;
        // v1.41.6 gate fix (adversarial CRITICAL -- proven with a runnable repro,
        // no crash required). THIS BRANCH UNLINKS A USER'S MEDIA FILE, and it was
        // deciding to do so from `db`, the Phase-1 SNAPSHOT taken at scan start.
        // Anything that legitimately puts a file at a tombstoned path WHILE a scan
        // is in flight is therefore invisible to it. v1.41.6's import-relocation is
        // exactly such a writer: it moves a file into a channel folder that may
        // carry a 90-day-old tombstone, and `linkSync` preserves the ORIGINAL
        // inode mtime -- so the relocated file looks, to the check above, precisely
        // like "the very file the user already deleted" (mtime <= deletedAt). The
        // relocation has already unlinked the source, so an unlink here is
        // IRREVERSIBLE LOSS of the only copy.
        //
        // Two re-checks against the FRESH on-disk db, immediately before the
        // unlink. Both are cheap: this whole block only runs on the rare tombstone
        // HIT, never on the ordinary per-file path.
        //   1. is the tombstone still there? (the relocation retires it in its own
        //      mutator BEFORE it touches the filesystem -- see moveItemToFolder);
        //   2. does a live metadata entry claim THIS EXACT PATH? An indexed item
        //      is by definition not a deleted one, whatever a stale tombstone says.
        // (2) is deliberately broader than (1): it hardens the whole class against
        // ANY future mid-scan writer, not just this one.
        let stillDeleted = !isNewerContent;
        if (stillDeleted) {
          try {
            const freshDb = loadDatabase();
            // Re-verify against the tombstone we actually matched (primary key
            // `id`, or the SEAM 2 secondary key `tombstoneKey`).
            const freshTombstone = tombstoneStore.get(tombstoneKey); // Wave 2: the live table, not the snapshot
            // The live-claim guard stays keyed by `id` (= md5(filePath)): any
            // legitimate live entry claiming THIS path is keyed by md5 of THIS
            // path, whatever key the tombstone used.
            const claimed = freshDb.metadata && freshDb.metadata[id] &&
              freshDb.metadata[id].filePath === filePath;
            if (!freshTombstone || claimed) {
              stillDeleted = false;
              console.log(`Scan: NOT reaping ${filePath} -- the delete tombstone was retired (or the path is claimed by a live library item) while this scan was running.`);
            }
          } catch (err) {
            // Cannot establish that the delete still stands -> do not destroy the
            // file. Fail CLOSED, in the direction that keeps the bytes.
            stillDeleted = false;
            console.warn(`Scan: could not re-verify the delete tombstone for ${filePath} (${err && err.message}) -- keeping the file.`);
          }
        }
        if (stillDeleted) {
          try {
            // v1.41.10 (adversarial-gate suggestion): if OUR OWN process is the
            // pinning handle (a stream that re-registered in the delete's
            // destroy->unlink window, or one whose 3s destroy cap expired), the
            // scan can self-heal instead of waiting on a client that may never
            // close -- destroy any registered streams before retrying.
            await destroyMediaStreams(filePath);
            // v1.65 (ruling 3): the deferred retry TRASHES the survivor
            // instead of unlinking it -- so even a wrongly-reaped file (the
            // 8-file incident's nightmare shape: every guard fooled at once)
            // lands recoverable in the trash dir, and its subtitles ride
            // along (narrow matcher) instead of being deleted. Link-stage
            // errors rethrow verbatim: the ENOENT branch below keeps its
            // delete-pending semantics, everything else re-indexes honestly.
            await trashOrphanFile(filePath);
            console.log(`Scan: trashed a deleted file that had survived its delete (deferred retry): ${filePath}`);
            // Keep /api/scan-status honest for this pass: this file was
            // processed (its processing was the removal), and the cooperative
            // yield must not be skipped on a reap-heavy pass.
            scanState.processed++;
            await maybeYieldScan(yieldState);
            continue; // stays gone -- never re-indexed
          } catch (err) {
            if (err && err.code === 'ENOENT') {
              // v1.41.10 (mechanism now the trash LINK, v1.65): "no such file" for a path THIS SCAN just
              // enumerated. That contradiction is the SMB/CIFS DELETE_PENDING
              // state (an open handle somewhere pins an already-deleted file;
              // the dirent stays enumerable while every new open is refused
              // with a status the kernel maps to ENOENT) -- or the file
              // genuinely vanished between enumeration and now, in which case
              // suppressing it costs nothing. Either way this is NOT the
              // undeletable-volume case the honest re-index below exists for
              // (those are EBUSY/EPERM/EROFS/EACCES), so: keep it hidden and
              // KEEP the tombstone -- un-consume it so every scan keeps
              // retrying until the dirent actually disappears. The 90-day
              // prune (pruneDeleteTombstones) is the backstop that keeps a
              // never-closing external handle from becoming a silent forever-
              // suppression; the "one delete, one retry" rule stands for every
              // other errno.
              consumedTombstoneIds.delete(tombstoneKey);
              dbChanged = dbChangedBeforeConsume; // net-zero for this file: no forced rewrite per scan
              console.warn(`Scan: deferred delete retry hit ENOENT on a path this scan just enumerated (delete-pending: open handles elsewhere) -- keeping it hidden, keeping the tombstone: ${filePath}`);
              scanState.processed++;
              await maybeYieldScan(yieldState);
              continue; // suppressed -- never re-indexed while the delete is pending
            }
            console.warn(`Scan: deferred delete retry failed (${(err && err.code) || 'unknown'}) -- re-indexing honestly: ${filePath}`);
            // fall through: the file exists and is undeletable; index it.
          }
        }
      }

      // If metadata already exists and file hasn't changed (based on size/mtime), reuse it.
      // FR-1b (v1.18.0) backfill, HOTFIXED in v1.18.1: a VIDEO item is only
      // taken on the plain reuse fast-path once it already carries the probed
      // codec fields (`videoCodec`/`audioCodec` -- present, even if `null`,
      // once a probe has actually run). A pre-v1.18 entry (or one whose last
      // probe failed) is missing both keys entirely (see
      // `extractMetadataAndThumbnail`'s comment on `undefined` vs. `null`).
      //
      // v1.18.0 REGRESSION (fixed here): that "missing codec fields" case used
      // to fall into the full re-init/`extractMetadataAndThumbnail` branch
      // below -- which runs an ffmpeg FRAME-GRAB, clobbering every pre-v1.18
      // video's existing thumbnail on the very first post-upgrade scan (icons
      // silently lost for the whole library). The fix: `unchanged` (same
      // filePath+size) VIDEO items missing codec fields get their OWN
      // `legacyVideoCodecBackfillOnly` branch below -- codec-only probe (no
      // frame-grab, no re-init, existing thumbnail left untouched unless it is
      // genuinely missing). Audio items are unaffected (skip this extra guard)
      // -- reconcileTranscode already short-circuits `type === 'audio'`.
      const existing = db.metadata[id];
      const hasCodecFields = !!existing &&
        Object.prototype.hasOwnProperty.call(existing, 'videoCodec') &&
        Object.prototype.hasOwnProperty.call(existing, 'audioCodec');
      const unchanged = !!existing && existing.filePath === filePath && existing.size === info.size;
      const reusable = unchanged && (isAudio || hasCodecFields);
      const legacyVideoCodecBackfillOnly = unchanged && !isAudio && !hasCodecFields;
      if (reusable) {
        // v1.19.1 hotfix: a reused VIDEO (already carries codec fields --
        // migrated by a prior scan, or genuinely new) can STILL have a
        // thumbnail that was clobbered/lost by the v1.18.0 regression before
        // this fix line existed; that case previously took this exact fast
        // path and copied `existing` as-is, so the missing icon never healed
        // on rescan. Restore it here, VIDEO-only -- audio "thumbnails" are
        // embedded cover art that is legitimately absent for many files, so
        // re-probing them every scan would be needless churn (and the v1.18
        // bug never affected audio in the first place).
        if (!isAudio) {
          const healed = await restoreMissingThumbnail(existing, id, filePath);
          if (healed) dbChanged = true;
          // v1.93.2: ensure the storyboard sprite FILE exists (backfill path for
          // the whole existing library). Keyed on the on-disk sprite, writes
          // nothing to the db -- so no dbChanged, and it converges on file
          // existence with no dependence on this scan pass completing its save.
          await restoreMissingStoryboard(existing, id, filePath);
          // v1.94: same disk-keyed heal for the hover preview clip.
          await restoreMissingPreviewClip(existing, id, filePath);
        }
        // C5-local (v1.24): SCHEMA-ONLY backfill of `releaseDate` for an item
        // that predates this field -- the thumbnail-backfill-regression
        // lesson means this must NEVER trigger a fresh probe. `embeddedMs` is
        // passed as `null` on purpose: only the already-known `info.mtimeMs`
        // (from the scan's existing `stat`, no extra I/O) is used. An item
        // that already carries `releaseDate` (from its original scan, or a
        // prior backfill pass) is left completely untouched.
        if (!Object.prototype.hasOwnProperty.call(existing, 'releaseDate')) {
          existing.releaseDate = deriveReleaseDate(null, info.mtimeMs);
          dbChanged = true;
        }
        // v1.33 T1: SCHEMA-ONLY youtubeId backfill for an item that predates
        // this field -- NO fresh probe (thumbnail-backfill lesson): the
        // filename's `[id]` bracket (yt-dlp-rooted only), else the embedded
        // `comment` tag ALREADY persisted by this item's original probe
        // (EMBEDDED_TAG_WHITELIST includes `comment`; yt-dlp/metube's
        // `--embed-metadata` writes the source URL there). Explicit `null`
        // marks the attempt so this runs exactly once per item; the reheat's
        // opt-in local ffprobe pass is what can still upgrade a `null` later
        // (e.g. from a `purl` tag, which the whitelisted `tags` never stored).
        if (!Object.prototype.hasOwnProperty.call(existing, 'youtubeId')) {
          existing.youtubeId = deriveScanYoutubeId(filePath, info, ytdlpDownloadRoots,
            existing.tags && typeof existing.tags.comment === 'string' ? existing.tags.comment : null);
          dbChanged = true;
        }
        // v1.251 (Dean's pinned-channel bug): SCHEMA-ONLY `type` backfill for an item that
        // predates the field. The scan has always known the answer - the extension is already
        // in hand (isAudio above; no I/O, the thumbnail-backfill lesson). Without it a
        // pre-type-era item renders as a VIDEO card on every list surface (musicHrefForItem
        // gates on type==='audio') and never projects into Music - the exact "audio from the
        // pinned channel opens the video player" symptom. An item that already carries `type`
        // is left completely untouched.
        if (!Object.prototype.hasOwnProperty.call(existing, 'type')) {
          existing.type = isAudio ? 'audio' : 'video';
          dbChanged = true;
        }
        if (applyHasSubtitlesDetection(existing, filePath, perScanReaddirCache)) dbChanged = true;
        newMetadata[id] = existing;
      } else if (legacyVideoCodecBackfillOnly) {
        // v1.18.1 hotfix: reuse the existing entry AS-IS (title, duration,
        // addedAt, artist, tags, hasThumbnail, and the on-disk thumbnail .jpg
        // are all preserved -- no re-init, no `cleanDisplayTitle` recompute).
        // Only the codec fields (and the `needsTranscode` they feed) are
        // backfilled, via the codec-only probe -- no ffmpeg frame-grab runs.
        console.log(`Backfilling codec fields for legacy video: ${info.name}`);
        try {
          const { videoCodec, audioCodec } = await probeCodecsOnly(filePath);
          existing.videoCodec = videoCodec;
          existing.audioCodec = audioCodec;
          // Authoritative recompute now that the codecs are known -- also
          // redone below by the final reconcileTranscode pass, but set here
          // too so `existing.needsTranscode` is correct even if that pass is
          // ever bypassed for this item.
          existing.needsTranscode = needsTranscode(existing.ext, videoCodec, audioCodec);
        } catch (err) {
          console.error(`Error backfilling codec fields for ${info.name}:`, err);
        }

        // Restore the thumbnail ONLY if it is genuinely missing -- shared with
        // the `reusable` fast-path above (v1.19.1 hotfix) via
        // `restoreMissingThumbnail`. A present, non-empty thumbnail is left
        // completely untouched -- no frame-grab, ever, for a file that already
        // has one.
        await restoreMissingThumbnail(existing, id, filePath);
        // v1.93.2/v1.94: ensure the storyboard sprite AND the hover preview clip
        // FILEs exist for a legacy video (on-disk-keyed, no db write).
        await restoreMissingStoryboard(existing, id, filePath);
        await restoreMissingPreviewClip(existing, id, filePath);

        // C5-local (v1.24): same schema-only `releaseDate` backfill as the
        // plain reuse fast-path above -- mtime-only, no fresh probe (the
        // codec-only probe just above this is pre-existing behavior, unrelated
        // to and not reused for the date).
        if (!Object.prototype.hasOwnProperty.call(existing, 'releaseDate')) {
          existing.releaseDate = deriveReleaseDate(null, info.mtimeMs);
          dbChanged = true;
        }
        // v1.33 T1: same schema-only youtubeId backfill as the plain reuse
        // fast-path above -- filename bracket / persisted `comment` tag only,
        // no fresh probe (the codec-only probe just above is unrelated).
        if (!Object.prototype.hasOwnProperty.call(existing, 'youtubeId')) {
          existing.youtubeId = deriveScanYoutubeId(filePath, info, ytdlpDownloadRoots,
            existing.tags && typeof existing.tags.comment === 'string' ? existing.tags.comment : null);
          dbChanged = true;
        }
        // v1.251: same schema-only `type` backfill as the plain reuse fast-path above
        // (this arm is video-only by construction, but the shared expression keeps the
        // two sites byte-symmetric).
        if (!Object.prototype.hasOwnProperty.call(existing, 'type')) {
          existing.type = isAudio ? 'audio' : 'video';
        }
        applyHasSubtitlesDetection(existing, filePath, perScanReaddirCache);

        newMetadata[id] = existing;
        dbChanged = true;
      } else {
        // New or updated file
        console.log(`Scanning new/updated file: ${info.name}`);
        // v1.20.0 FR-2: mark this id as freshly-scanned -- see the Phase-2
        // channel-identity bridge, below.
        freshlyScannedIds.add(id);
        // v1.111 (Dean, streaming Tier 1): a genuinely-NEW mp4 download under the
        // (writable) yt-dlp download dir gets its `moov` atom front-loaded
        // (+faststart) so it starts + seeks fast in the browser. Guards:
        //   !existing        -- NEW-to-db only (Dean deferred the existing-library
        //                       backfill; also skips a re-encoded replacement).
        //   !isAudio         -- video only (mp3 has no moov).
        //   isFaststartEligible -- .mp4 ONLY: the -movflags safety boundary, so it
        //                       can never reach a webm/mkv muxer.
        //   under ytdlpDownloadRoots -- guaranteed writable (yt-dlp wrote it there);
        //                       never attempt-and-fail on a read-only-mount import.
        //   !READ_ONLY_MEDIA + ffmpegAvailable -- honor safe-mode; no ffmpeg -> skip.
        // remuxFaststartInPlace is best-effort, non-throwing, atomic, and preserves
        // mtime, so it can never break the scan or lose the file. A real remux
        // changes the byte length, so refresh info.size HERE (before the entry is
        // built below) -- else the next scan sees a size change and needlessly
        // re-inits the item. Mirrors restoreMissingStoryboard's best-effort posture.
        if (!existing && !isAudio && !READ_ONLY_MEDIA && ffmpegIsAvailable() &&
            matchRootFolder(filePath, ytdlpDownloadRoots) && faststart.isFaststartEligible(filePath)) {
          const outcome = await faststart.remuxFaststartInPlace(filePath);
          if (outcome === 'remuxed') {
            try { info.size = fs.statSync(filePath).size; } catch (_) { /* keep stale size; next scan self-heals */ }
          }
        }
        // v1.35 (preExtractAudio): a freshly-indexed yt-dlp-rooted VIDEO is a
        // download -- queue its sidecar extraction (after the save; see the
        // collector's comment above) when the setting is ON.
        // (Read from the scan's Phase-1 snapshot -- a toggle flipped ON
        // mid-scan catches the NEXT scan's fresh files; already-indexed items
        // stay lazy-on-first-watch by design. Accepted narrow window.)
        if (scanSettings.preExtractAudio === true &&
            !isAudio && matchRootFolder(filePath, ytdlpDownloadRoots)) {
          preExtractCandidates.push({ id, filePath });
        }

        // FIX-9 (two-reviewer gate): `cleanDisplayTitle` strips a trailing
        // ` [<11-char id>]` bracket -- exactly the shape `--restrict-filenames`
        // produces for a yt-dlp download, but ALSO a shape an ordinary,
        // non-yt-dlp library file can innocently have (e.g.
        // `Vacation_2024 [Holiday2024].mp4` -- `Holiday2024` is coincidentally
        // 11 characters). Applying the cleanup scan-wide was a false-positive
        // risk for any such legitimately-named file. Scoped here to files that
        // are actually rooted under the module's OWN download dir
        // (`ytdlpDownloadRoots`, computed once above from `extraScanRoots`) --
        // reusing `matchRootFolder`'s existing prefix-match semantics rather
        // than a second, parallel path-matching helper. A non-yt-dlp file
        // (anywhere else in the library) always keeps its raw basename,
        // regardless of what it happens to look like.
        const rawTitle = path.basename(info.name, info.ext);
        const title = matchRootFolder(filePath, ytdlpDownloadRoots) ? cleanDisplayTitle(rawTitle) : rawTitle;

        // Initialize metadata entry
        newMetadata[id] = {
          id,
          name: info.name,
          title,
          filePath,
          folderName: info.folderName,
          size: info.size,
          ext: info.ext,
          type: isAudio ? 'audio' : 'video',
          addedAt: info.addedAt,
          duration: 0,
          hasThumbnail: false,
          artist: '',
          needsTranscode: !isAudio && needsTranscode(info.ext),
          // A6 (v1.24 UX Round, Wave 5): additive, schema-only -- see
          // applyHasSubtitlesDetection's comment (lib/scan/probe.js) for why this cheap
          // directory check never counts as "re-processing". Threads the same
          // per-scan `perScanReaddirCache` (v1.30, A1) as the reuse fast-paths
          // above so a NEW file sharing a directory with already-indexed
          // files doesn't trigger a redundant `readdirSync` either.
          hasSubtitles: !!subtitles.findSubtitleSidecar(filePath, undefined, perScanReaddirCache)
        };

        try {
          const meta = await extractMetadataAndThumbnail(filePath, id, isAudio);
          newMetadata[id].duration = meta.duration;
          newMetadata[id].hasThumbnail = meta.hasThumbnail;
          // v1.93.2: extractMetadataAndThumbnail generated the sprite FILE (its
          // own on-disk state); no descriptor is persisted - it is derived at read
          // time by storyboardDescriptor from the (now-known) duration/dims.
          newMetadata[id].artist = meta.artist || '';
          newMetadata[id].tags = meta.tags || {};
          // FR-1b (v1.18.0, + two-reviewer follow-up): probed codecs,
          // piggybacked on the same ffprobe call above. `meta.videoCodec`/
          // `meta.audioCodec` are now ALWAYS an explicit lowercased string or
          // `null` (never `undefined`) once a probe attempt has run --
          // `extractMetadataAndThumbnail` sets `null` on any failed/errored/
          // unavailable probe, not just a stream type genuinely absent from a
          // successful probe -- so the key always survives the JSON round-trip
          // and this item is probed/attempted only ONCE, not re-extracted on
          // every subsequent scan (see the reuse-guard `hasCodecFields` check
          // below, which relies on the keys being present).
          newMetadata[id].videoCodec = meta.videoCodec;
          newMetadata[id].audioCodec = meta.audioCodec;
          // Feature A (v1.26.1, Shorts player-size jump): VIDEO-only intrinsic
          // width/height, from this SAME probe -- additive/schema-only, and
          // ONLY ever set here on a genuinely new/updated file's initial scan
          // (this whole branch). NEVER a library-wide re-probe sweep for
          // already-indexed items -- an item that predates this field simply
          // has no `width`/`height` key (unlike `videoCodec`/`audioCodec`,
          // there is no reuse-guard keyed off these, so leaving them absent is
          // safe) until it is re-scanned as changed OR the player's own lazy
          // per-item `POST /api/videos/:id/dimensions` backfill (server route
          // below) fills it in from the browser's own `videoWidth`/
          // `videoHeight` on next play. Left unset entirely for audio, or when
          // the probe didn't yield usable dims.
          if (!isAudio && meta.width && meta.height) {
            newMetadata[id].width = meta.width;
            newMetadata[id].height = meta.height;
          }
          // C5-local (v1.24): embedded date (from this SAME probe) -> mtime
          // fallback. `meta.embeddedReleaseDateMs` is `null` on ffmpeg-
          // unavailable/probe-failure/no-usable-tag; `deriveReleaseDate`
          // falls through to `info.mtimeMs` in every one of those cases.
          newMetadata[id].releaseDate = deriveReleaseDate(meta.embeddedReleaseDateMs, info.mtimeMs);
          // v1.33 T1: persisted YouTube id -- filename `[id]` bracket
          // (yt-dlp-rooted files only, same scoping as cleanDisplayTitle/the
          // bridge below) first, else the embedded `purl`/`comment` source URL
          // this SAME probe surfaced (the only id source for a bracket-less
          // metube-era import), validated through classifySingleVideo. `null`
          // (never absent) once derivation has been attempted, mirroring the
          // codec fields' probed-once convention.
          newMetadata[id].youtubeId = deriveScanYoutubeId(filePath, info, ytdlpDownloadRoots, meta.embeddedSourceUrl);
          // v1.34 T3: embedded chapters off the same probe -- always an array
          // once a probe has run ([] = genuinely none), mirroring the codec
          // fields' probed-once convention. The MANUAL chapters field
          // (chaptersManual) is deliberately never touched by any scan path.
          newMetadata[id].chapters = Array.isArray(meta.chapters) ? meta.chapters : [];
        } catch (err) {
          console.error(`Error extracting metadata for ${info.name}:`, err);
          // Metadata extraction itself failed (before `meta` resolved) -- the
          // item still gets a `releaseDate` via the mtime-only fallback
          // rather than the field being left entirely absent.
          newMetadata[id].releaseDate = deriveReleaseDate(null, info.mtimeMs);
          // v1.33 T1: same probed-once convention on the failure path --
          // filename-bracket only (there is no probe output to read a purl
          // from), `null` when that yields nothing.
          newMetadata[id].youtubeId = deriveScanYoutubeId(filePath, info, ytdlpDownloadRoots, null);
          newMetadata[id].chapters = []; // probe failed -- none known (probed-once)
        }
        // v1.33 T3: a CHANGED file (same path, new size -- this whole re-init
        // branch) must not lose a previously captured/reheated real title
        // (`sourceTitle`, emoji intact) back to the filename-derived one: carry
        // it forward and keep preferring it as the display title. A genuinely
        // NEW file has no `existing`, so both stay filename-derived until the
        // bridge below (fresh yt-dlp download) or a reheat backfills them.
        if (existing && typeof existing.sourceTitle === 'string' && existing.sourceTitle !== '') {
          newMetadata[id].sourceTitle = existing.sourceTitle;
          newMetadata[id].title = existing.sourceTitle;
        }
        // v1.33 gate fix (adversarial CRITICAL): the SAME carry-forward for the
        // identity fields, symmetric with `sourceTitle` above. A re-encoded/
        // replaced file (same path, new size) whose replacement tool stripped
        // the embedded purl/comment tags would otherwise silently revert a
        // previously-established `youtubeId` (reheat-discovered or backfilled)
        // to this pass's fresh `null` derivation -- killing the Share button
        // and the item's reheat identity. A NON-null fresh derivation (bracket
        // or a still-present embedded tag) stays authoritative -- for the same
        // file path it can only ever be the same id. `metadataRepulledAt` rides
        // along for the same reason: the re-init literal omits it, and losing
        // it would silently flip the item back to reheat-eligible.
        if (existing) {
          if (newMetadata[id].youtubeId === null &&
              typeof existing.youtubeId === 'string' && isSafeVideoId(existing.youtubeId)) {
            newMetadata[id].youtubeId = existing.youtubeId;
          }
          if (typeof existing.metadataRepulledAt === 'number') {
            newMetadata[id].metadataRepulledAt = existing.metadataRepulledAt;
          }
          // v1.48 item 2: the captured view count + its capture date carry
          // forward too -- the persist-gate/stale-snapshot bug class's checkpoint
          // for THIS wave's new fields (this repo has been bitten by that class
          // in v1.32, v1.33, v1.34 and v1.41.5). A view count cannot be
          // re-derived from anything on disk: it came from a network capture at a
          // moment in time, so a changed file (same path, new size -- Dean
          // re-encodes something) would otherwise permanently revert the item to
          // a FABRICATED mock count with no way back short of a manual reheat.
          // Carried as a UNIT, and only when both halves are present, so the pair
          // can never be split into a count with a wrong date.
          if (typeof existing.sourceViewCount === 'number' && Number.isInteger(existing.sourceViewCount) && existing.sourceViewCount >= 0 &&
              typeof existing.sourceViewCountCapturedAt === 'number' && Number.isFinite(existing.sourceViewCountCapturedAt)) {
            newMetadata[id].sourceViewCount = existing.sourceViewCount;
            newMetadata[id].sourceViewCountCapturedAt = existing.sourceViewCountCapturedAt;
          }
          // v1.54: the follower count carries as a unit too (same persist-gate
          // checkpoint -- it cannot be re-derived from disk).
          if (typeof existing.sourceFollowerCount === 'number' && Number.isInteger(existing.sourceFollowerCount) && existing.sourceFollowerCount >= 0 &&
              typeof existing.sourceFollowerCountCapturedAt === 'number' && Number.isFinite(existing.sourceFollowerCountCapturedAt)) {
            newMetadata[id].sourceFollowerCount = existing.sourceFollowerCount;
            newMetadata[id].sourceFollowerCountCapturedAt = existing.sourceFollowerCountCapturedAt;
          }
          // v1.34 T3: MANUAL chapters are user data with no probe source --
          // a changed file must never lose them (embedded `chapters` refresh
          // naturally from this branch's own probe).
          if (Array.isArray(existing.chaptersManual)) {
            newMetadata[id].chaptersManual = existing.chaptersManual;
          }
          // v1.41.5 (MeTube-import hydration): the CHANNEL IDENTITY carries
          // forward too -- same reasoning as `youtubeId`/`sourceTitle` above,
          // and this is the persist-gate/stale-snapshot bug class's checkpoint
          // for the new fields. A yt-dlp-rooted item could always re-derive its
          // identity from its own download FOLDER on the next scan (the AC17
          // backfill below), but a HYDRATED IMPORT cannot: it lives in a plain
          // library root, so this re-init branch (same path, changed size --
          // e.g. Dean re-encodes or replaces a file) is the ONLY thing standing
          // between it and silently reverting to a generic folder-name channel.
          // The re-init literal never sets these, so this is a pure carry (no
          // supersede question), and the reheat's own never-overwrite guard
          // means a later reheat won't "fix" what a scan quietly dropped.
          if (typeof existing.channelUrl === 'string' && existing.channelUrl !== '') {
            newMetadata[id].channelUrl = existing.channelUrl;
          }
          if (typeof existing.channelHandleUrl === 'string' && existing.channelHandleUrl !== '') {
            newMetadata[id].channelHandleUrl = existing.channelHandleUrl;
          }
          if (typeof existing.channelId === 'string' && existing.channelId !== '') {
            newMetadata[id].channelId = existing.channelId;
          }
          if (typeof existing.channelName === 'string' && existing.channelName !== '') {
            newMetadata[id].channelName = existing.channelName;
          }
          if (typeof existing.channelAvatarUrl === 'string' && existing.channelAvatarUrl !== '') {
            newMetadata[id].channelAvatarUrl = existing.channelAvatarUrl;
          }
          // v1.53 (manual attribution): the STICKY flag carries with the
          // identity it protects -- the persist-gate checkpoint for this
          // wave's new field (seventh-strike class). Dropping the flag while
          // keeping the identity would silently re-arm the reheat/consume
          // writers to overwrite what Dean set by hand.
          if (existing.channelAttributedManually === true) {
            newMetadata[id].channelAttributedManually = true;
          }
          // v1.41.13 (universal one-offs): the non-YouTube source identity carries
          // forward with the rest -- the persist-gate checkpoint for the two new
          // fields (the six-strike class). A universal item CAN re-derive
          // sourceExtractor/sourceId from its own `[Extractor=id]` bracket on the
          // next scan (the bridge block does), but carrying them here keeps an
          // unchanged-item rescan from momentarily dropping them, matching every
          // sibling field above.
          if (typeof existing.sourceExtractor === 'string' && existing.sourceExtractor !== '') {
            newMetadata[id].sourceExtractor = existing.sourceExtractor;
          }
          if (typeof existing.sourceId === 'string' && existing.sourceId !== '') {
            newMetadata[id].sourceId = existing.sourceId;
          }
        }
        dbChanged = true;
      }

      // v1.30 A2 (AC1.1/AC2.2): advance the shared batch-yield counter and the
      // reported progress for every item reconciled this pass (all three
      // branches above), regardless of which fast-path it took -- see
      // `maybeYieldScan`. `total` was already fixed by the walk above (this
      // loop's own item count === scannedFiles.size), so `processed` only ever
      // grows toward it within this pass.
      scanState.processed++;
      await maybeYieldScan(yieldState);
    }

    // Mount-loss guard + toggleable prune (D2). A non-surviving old id is
    // NEVER dropped just because it wasn't rescanned — that would conflate
    // "file individually deleted" with "its whole mount disappeared". Instead,
    // selectPrunableIds (pure, T2-verified) decides which non-surviving ids are
    // actually safe to prune: its mount-loss guard fires BEFORE the
    // pruneMissing toggle, so anything rooted under a currently-missing/
    // unmounted folder is retained regardless of the toggle. Everything NOT in
    // the prunable set is copied back into newMetadata below, so
    // `db.metadata = newMetadata` further down never silently wipes a mount-loss.
    const survivingIds = new Set(Object.keys(newMetadata));
    const oldIds = Object.keys(db.metadata);
    // HR1b (finding D): the Phase-1 snapshot's id-set, closed over into the
    // Phase-2 mutator below. Used to distinguish "concurrently DELETEd during
    // this scan" (in phase1Ids, now absent from the fresh in-lock db -- drop,
    // don't resurrect) from "genuinely-new file" (absent from phase1Ids -- add).
    const phase1Ids = new Set(oldIds);
    // v1.33 T4 (tech-debt #10, Option C): promote any configured root whose
    // ENTIRE previously-indexed content vanished this pass (while the
    // directory itself still exists -- the empty-but-present unmount
    // signature) into `missingRoots`, so selectPrunableIds' existing
    // mount-loss guard (#2) protects its ids exactly like an existsSync-failed
    // root's. See detectVanishedRoots' own comment for the accepted
    // genuinely-emptied-folder cost + escape hatch.
    for (const vanishedRoot of detectVanishedRoots(db.metadata, newMetadata, currentFolders, missingRoots)) {
      console.warn(
        `Scan: every previously-indexed item under "${vanishedRoot}" is gone this pass while the folder itself is still present -- ` +
        'treating it as an unmounted/empty mountpoint and pruning NOTHING under it (watch progress and thumbnails are preserved). ' +
        'If you really did clear this folder\'s entire content on purpose, remove the folder from Settings to let its entries prune.'
      );
      missingRoots.add(vanishedRoot);
    }
    const prunable = new Set(
      selectPrunableIds(db.metadata, survivingIds, {
        missingRoots,
        unreadablePaths,
        folders: currentFolders,
        pruneMissing: scanSettings.pruneMissing,
      })
    );

    for (const oldId of oldIds) {
      if (survivingIds.has(oldId) || prunable.has(oldId)) continue;
      newMetadata[oldId] = db.metadata[oldId]; // retained: not pruned this scan
    }

    if (prunable.size > 0) {
      dbChanged = true;
      // Clean up thumbnails/transcodes ONLY for genuinely-pruned ids — retained
      // (mount-loss, unreadable-subtree, or toggle-off) entries must keep their
      // sidecars. These are idempotent FS ops and snapshot-independent, so they
      // stay here; the corresponding `db.progress` prune moves onto the FRESH
      // db re-read at save time, below (fix A: re-read-merge-on-save).
      for (const oldId of prunable) {
        const thumbPath = path.join(THUMBNAIL_DIR, `${oldId}.jpg`);
        if (fs.existsSync(thumbPath)) {
          try {
            fs.unlinkSync(thumbPath);
          } catch (e) {
            console.error('Failed to delete obsolete thumbnail:', e);
          }
        }
        // Remove any transcoded MP4 sidecar
        const oldTranscode = transcodedPath(oldId);
        if (fs.existsSync(oldTranscode)) {
          try {
            fs.unlinkSync(oldTranscode);
          } catch (e) {
            console.error('Failed to delete obsolete transcode:', e);
          }
        }
        // v1.92: remove any storyboard sprite sidecar (same id-keyed lifecycle).
        const oldStoryboard = storyboardPath(oldId);
        if (fs.existsSync(oldStoryboard)) {
          try {
            fs.unlinkSync(oldStoryboard);
          } catch (e) {
            console.error('Failed to delete obsolete storyboard:', e);
          }
        }
        // v1.94: same for the hover preview clip sidecar.
        const oldPreview = previewClipPath(oldId);
        if (fs.existsSync(oldPreview)) {
          try { fs.unlinkSync(oldPreview); } catch (e) { console.error('Failed to delete obsolete preview clip:', e); }
        }
      }
    }

    // v1.51 notification bell: download events collected INSIDE the mutator
    // (by collectDownloadNotification, at the three consume sites), inserted
    // into SQLite AFTER the doc commit below. The array only ever fills past
    // the stale-epoch guard, and every fill site also sets dbChanged, so a
    // discarded or unsaved merge can never have notified.
    const pendingNotifications = [];

    // Re-read-merge-on-save, now formalized as ONE serialized updateDatabase
    // mutator: the scan holds its own Phase-1 `db` snapshot across many awaited
    // extractMetadataAndThumbnail calls, so writing it back directly would
    // clobber ANY metadata field written concurrently (lastServedAt /
    // transcodeStatus; the settings, folder config and progress are their own
    // tables since Waves 2-4 and never ride this object) (POST /api/settings, POST
    // /api/config, recordServed, watch-progress, a transcode worker's
    // setTranscodeStatus) during the scan. `updateDatabase` hands the mutator a
    // FRESH db loaded INSIDE the lock -- there is no separate `loadDatabase()`
    // call and no gap between that read and the save, so the window that used
    // to be merely "hair-thin" (no `await` between the old explicit fresh-read
    // and its save) is now PROVABLY closed by the serialization itself, not
    // just coincidentally zero-width. The reconcile loop (root backfill + FR3.3
    // transcodeStatus seed + reconcileTranscode), mergeScannedMetadata, and the
    // progress/persistedServedAt prune all run inside this one mutator.
    // reconcileTranscode is safe here: it only does `fs.existsSync` reads and
    // in-place mutation -- no db writes, no queue kicks, so no re-entrant
    // updateDatabase call. Phase 1 above (the FFmpeg-awaiting extraction loop)
    // never holds this lock -- writes stay unblocked for the whole scan.
    await updateDatabase(fresh => {
      // Wave 5: the yt-dlp bridge map (downloadMeta, consumed below) and the
      // subscriptions (the folder backfill) come from their tables as ONE
      // snapshot holder; the consumed entries' diff is queued into this same
      // commit at the end (never a separate write, never on a skipped save).
      const ytScan = ytdlpDb.holder();
      // v1.42 (gate W4): if a RESTORE (or the tests' reset) wiped-and-replaced
      // the persisted state while this scan was walking, every decision below
      // -- phase1Ids, newMetadata, prunable -- was computed against a snapshot
      // of a database that no longer exists. mergeScannedMetadata is
      // authoritative for membership, so committing it would overwrite the
      // just-restored library with the pre-restore view (and drop restored
      // items whose files the walk never saw). Abandon the merge instead; the
      // next scan (periodic, or a manual "Scan now") rebuilds against the
      // restored state. The epoch is bumped inside replacePersistedState's
      // exclusive chain step, and this mutator runs on the same chain, so the
      // comparison can never race.
      if (scanEpochAtStart !== __getPersistedStateEpoch()) {
        console.log('Scan: a restore/wipe replaced the persisted state mid-scan — discarding this scan\'s merge (stale snapshot). The next scan rebuilds against the restored state.');
        return false;
      }
      // Backfill each item's configured root folder (for hidden-folder filtering) and
      // reconcile transcode state for browser-incompatible videos (queues jobs as needed).
      for (const item of Object.values(newMetadata)) {
        const newRoot = matchRootFolder(item.filePath, currentFolders);
        if (item.rootFolder !== newRoot) { item.rootFolder = newRoot; dbChanged = true; }
        // FR3.3: base transcodeStatus on the FRESH on-disk value (a concurrent
        // worker write), not the stale scan-start snapshot, so reconcileTranscode
        // preserves an in-flight 'processing'/'failed' and still wins with
        // 'ready'/clear-stale.
        const priorStatus = fresh.metadata[item.id] && fresh.metadata[item.id].transcodeStatus;
        if (priorStatus === undefined) delete item.transcodeStatus;
        else item.transcodeStatus = priorStatus;
        if (reconcileTranscode(item)) dbChanged = true;

        // F1 (v1.26.1 two-reviewer follow-up): same FR3.3 stale-snapshot guard,
        // applied to `width`/`height`. The reusable/legacyVideoCodecBackfillOnly
        // fast paths above (~line 1589/1627) set `newMetadata[id] = existing`,
        // where `existing` is a reference into the scan's Phase-1 `db` snapshot
        // taken at scan START -- never re-read mid-scan. A concurrent
        // `POST /api/videos/:id/dimensions` lazy backfill (the player's
        // `loadedmetadata` fallback, server route below) can land on the FRESH
        // on-disk db while this scan is still running; without this guard, the
        // unconditional `fresh.metadata = mergeScannedMetadata(fresh.metadata,
        // newMetadata)` below wholesale-replaces that fresh, now-dims-bearing
        // entry with the scan's stale, dims-less snapshot -- silently
        // reverting the backfill. Only carries the fresh values forward when
        // the SCAN's own item is missing EITHER dimension and the fresh
        // on-disk entry has BOTH -- an item the scan genuinely (re-)probed this
        // pass (the "new or updated file" branch, ~line 1703) already carries
        // its own freshly-probed width/height and is left untouched.
        if (!(item.width && item.height)) {
          const freshItem = fresh.metadata[item.id];
          if (freshItem && freshItem.width && freshItem.height) {
            item.width = freshItem.width;
            item.height = freshItem.height;
          }
        }

        // v1.33 gate fix (QA CRITICAL -- the stale-snapshot bug class's FOURTH
        // strike): the SAME F1 guard, applied to the REHEAT-writable fields. A
        // reheat batch (`recordRepulledItemMeta`, lib/ytdlp/relocation.js) writes `sourceTitle`/
        // `title`/`youtubeId`/`releaseDate`/`channelAvatarUrl`/`hasSubtitles`/
        // `metadataRepulledAt` through its own `updateDatabase` calls with NO
        // mutual exclusion against a running scan -- so a reheat landing after
        // this scan's Phase-1 snapshot but before this final save would be
        // silently reverted by the wholesale `newMetadata` replace below.
        // Two rules, mirroring F1's "only fill what the scan's own pass didn't
        // itself produce":
        //  - A reheat that COMPLETED mid-scan (fresh `metadataRepulledAt` is
        //    NEWER than the snapshot's) is authoritative for the whole field
        //    group -- adopt it. The FR-2 bridge below still runs AFTER this and
        //    may overwrite `sourceTitle`/`title` with a genuinely-fresh
        //    download capture, which is the correct precedence (newest event).
        //  - Independent of that, plain GAP-FILLS: a fresh `youtubeId`/
        //    `sourceTitle`/`metadataRepulledAt` the scan's own item simply
        //    LACKS is carried forward (a PARTIAL mid-scan reheat -- subs pass
        //    failed, marker withheld -- at least keeps its discovered id/title
        //    when the scan itself derived none).
        // Bounded remainder (accepted): a partial mid-scan reheat that
        // UPDATED an already-present releaseDate/sourceTitle can still lose
        // that update to the snapshot -- the item stays retryable (marker
        // unset), so the next reheat re-persists it with no scan running.
        {
          const freshItem = fresh.metadata[item.id];
          if (freshItem) {
            const freshReheatAt = typeof freshItem.metadataRepulledAt === 'number' ? freshItem.metadataRepulledAt : 0;
            const snapshotReheatAt = typeof item.metadataRepulledAt === 'number' ? item.metadataRepulledAt : 0;
            if (freshReheatAt > snapshotReheatAt) {
              item.metadataRepulledAt = freshItem.metadataRepulledAt;
              if (typeof freshItem.releaseDate === 'number' && Number.isFinite(freshItem.releaseDate)) {
                item.releaseDate = freshItem.releaseDate;
              }
              if (typeof freshItem.sourceTitle === 'string' && freshItem.sourceTitle !== '') {
                item.sourceTitle = freshItem.sourceTitle;
                item.title = freshItem.sourceTitle;
              }
              if (typeof freshItem.channelAvatarUrl === 'string' && freshItem.channelAvatarUrl !== '') {
                item.channelAvatarUrl = freshItem.channelAvatarUrl;
              }
              if (typeof freshItem.hasSubtitles === 'boolean') {
                item.hasSubtitles = freshItem.hasSubtitles;
              }
              // v1.34 T3: reheat-refreshed embedded chapters ride the same
              // completed-mid-scan adoption.
              if (Array.isArray(freshItem.chapters)) {
                item.chapters = freshItem.chapters;
              }
              // v1.48 item 2: a reheat that completed mid-scan re-snapshotted the
              // view count -- adopt it, or this scan's older Phase-1 snapshot
              // would write the PREVIOUS count back over the fresher one and
              // silently undo the refresh Dean triggered. Adopted as a unit with
              // its date, matching how it is written everywhere else.
              if (typeof freshItem.sourceViewCount === 'number' && Number.isInteger(freshItem.sourceViewCount) && freshItem.sourceViewCount >= 0 &&
                  typeof freshItem.sourceViewCountCapturedAt === 'number' && Number.isFinite(freshItem.sourceViewCountCapturedAt)) {
                item.sourceViewCount = freshItem.sourceViewCount;
                item.sourceViewCountCapturedAt = freshItem.sourceViewCountCapturedAt;
              }
              // v1.54: the reheat-refreshed follower count rides the same
              // completed-mid-scan adoption.
              if (typeof freshItem.sourceFollowerCount === 'number' && Number.isInteger(freshItem.sourceFollowerCount) && freshItem.sourceFollowerCount >= 0 &&
                  typeof freshItem.sourceFollowerCountCapturedAt === 'number' && Number.isFinite(freshItem.sourceFollowerCountCapturedAt)) {
                item.sourceFollowerCount = freshItem.sourceFollowerCount;
                item.sourceFollowerCountCapturedAt = freshItem.sourceFollowerCountCapturedAt;
              }
            }
            // v1.34 T3: MANUAL chapters are written ONLY by the editor
            // endpoint -- the scan never touches the field -- so the fresh
            // on-disk value (present OR absent) is always at least as new as
            // this scan's Phase-1 snapshot. Mirror it unconditionally: an edit
            // that landed mid-scan survives, and a mid-scan CLEAR is not
            // resurrected by the stale snapshot.
            if (Array.isArray(freshItem.chaptersManual)) {
              item.chaptersManual = freshItem.chaptersManual;
            } else {
              delete item.chaptersManual;
            }
            if ((item.youtubeId === null || item.youtubeId === undefined) &&
                typeof freshItem.youtubeId === 'string' && isSafeVideoId(freshItem.youtubeId)) {
              item.youtubeId = freshItem.youtubeId;
            }
            if ((typeof item.sourceTitle !== 'string' || item.sourceTitle === '') &&
                typeof freshItem.sourceTitle === 'string' && freshItem.sourceTitle !== '') {
              item.sourceTitle = freshItem.sourceTitle;
              item.title = freshItem.sourceTitle;
            }
            if (item.metadataRepulledAt === undefined && typeof freshItem.metadataRepulledAt === 'number') {
              item.metadataRepulledAt = freshItem.metadataRepulledAt;
            }
            // v1.48 item 2: the PARTIAL-reheat companion to the adoption above --
            // same gap-fill posture as sourceTitle/youtubeId/chapters. A reheat
            // that populated a view count for the first time but did not advance
            // the completion marker would otherwise be lost to the snapshot, and
            // the item would keep rendering a fabricated count.
            if (item.sourceViewCount === undefined &&
                typeof freshItem.sourceViewCount === 'number' && Number.isInteger(freshItem.sourceViewCount) && freshItem.sourceViewCount >= 0 &&
                typeof freshItem.sourceViewCountCapturedAt === 'number' && Number.isFinite(freshItem.sourceViewCountCapturedAt)) {
              item.sourceViewCount = freshItem.sourceViewCount;
              item.sourceViewCountCapturedAt = freshItem.sourceViewCountCapturedAt;
            }
            // v1.54: the partial-reheat companion for the follower count.
            if (item.sourceFollowerCount === undefined &&
                typeof freshItem.sourceFollowerCount === 'number' && Number.isInteger(freshItem.sourceFollowerCount) && freshItem.sourceFollowerCount >= 0 &&
                typeof freshItem.sourceFollowerCountCapturedAt === 'number' && Number.isFinite(freshItem.sourceFollowerCountCapturedAt)) {
              item.sourceFollowerCount = freshItem.sourceFollowerCount;
              item.sourceFollowerCountCapturedAt = freshItem.sourceFollowerCountCapturedAt;
            }
            // v1.34 gate fix (adversarial CRITICAL -- the class's companion
            // strike): a PARTIAL mid-scan reheat (markComplete false, marker
            // not advanced) that populated chapters for the first time was
            // lost to the snapshot -- the completed-adoption branch above
            // never fired. Same gap-fill posture as sourceTitle/youtubeId:
            // adopt the fresh value whenever the scan's own item has nothing
            // (absent or empty), regardless of the marker. An item whose scan
            // pass genuinely re-probed chapters this run carries a non-empty
            // list of its own and is left alone.
            if ((!Array.isArray(item.chapters) || item.chapters.length === 0) &&
                Array.isArray(freshItem.chapters) && freshItem.chapters.length > 0) {
              item.chapters = freshItem.chapters;
            }
            // v1.41.5 gate fix (adversarial CRITICAL -- the persist-gate/
            // stale-snapshot class's SIXTH strike, and the THIRD in this exact
            // block): the reheat's newly-writable CHANNEL IDENTITY needs the
            // same carry-forward. It is now a LIBRARY-WIDE batch that can run
            // for minutes-to-hours against a periodic scan with no mutual
            // exclusion (see this block's own header), so a hydration landing
            // mid-scan was silently reverted by the wholesale `newMetadata`
            // replace -- while `metadataRepulledAt` (adopted above) SURVIVED,
            // meaning a later non-force reheat would skip the item forever, and
            // the AC17 folder backfill can't heal a plain-library-root import
            // (it is scoped to ytdlpDownloadRoots). Permanent identity loss.
            //
            // GAP-FILL posture, NOT marker-gated (mirrors the youtubeId/
            // sourceTitle gap-fills above): a PARTIAL mid-scan reheat -- the
            // network pass discovered the channel but the subs pass failed, so
            // the marker was withheld -- must keep its identity too.
            //
            // Adopted as a UNIT, keyed on `channelUrl`: never mix channel A's
            // URL with channel B's name. Runs BEFORE the FR-2 bridge below, so
            // a genuinely-fresh download capture still wins (newest event).
            if (!item.channelUrl && typeof freshItem.channelUrl === 'string' && freshItem.channelUrl !== '') {
              item.channelUrl = freshItem.channelUrl;
              if (freshItem.channelHandleUrl) item.channelHandleUrl = freshItem.channelHandleUrl;
              if (freshItem.channelId) item.channelId = freshItem.channelId;
              if (freshItem.channelName) item.channelName = freshItem.channelName;
              if (freshItem.channelAvatarUrl) item.channelAvatarUrl = freshItem.channelAvatarUrl;
            }
            // v1.115 (Dean, A1) gate fix -- persist-gate/stale-snapshot class, the
            // 6th strike (adversarial WARNING-1): a "Refresh channel names" backfill
            // can commit a real channelName to the LIVE db BETWEEN this scan's
            // Phase-1 snapshot and this Phase-2 merge. The snapshot's `item` still
            // carries the OLD bad name and -- because it already HAS a channelUrl --
            // is skipped by the `!item.channelUrl` carry above, so the wholesale
            // db.metadata=newMetadata replace below would REVERT the backfill. This
            // is an UNCONDITIONAL, marker-agnostic gap-fill (mirrors the
            // sourceFollowerCount partial-reheat gap-fill above): whenever the
            // scan's OWN name is still bad (empty/@handle) but the LIVE db now has a
            // real one, adopt it -- never over a manual attribution. isBadChannelName
            // is the SAME predicate the backfill enumerator/writer + strip-@ use.
            // v1.116 gate round: capture the SNAPSHOT's bad-name state ONCE, before
            // the name gap-fill below mutates item.channelName -- the channelId
            // companion (further down) shares this predicate and must not re-read
            // the already-healed name (it would then never fire).
            const snapshotChannelNameWasBad = ytdlp.isBadChannelName(item.channelName);
            const freshChannelNameIsGood = !ytdlp.isBadChannelName(freshItem.channelName);
            if (!item.channelAttributedManually
                && snapshotChannelNameWasBad
                && freshChannelNameIsGood) {
              item.channelName = freshItem.channelName;
            }
            // v1.116 (Dean) gate fix -- persist-gate, the local-heal companion to
            // the name gap-fill above. The LOCAL reconciliation populates a
            // channelId (+ canonical url/handle/avatar) onto items that ALREADY
            // carry a channelUrl (the @handle fragments), so the `!item.channelUrl`
            // identity-carry above SKIPS them -- a heal landing mid-scan would be
            // reverted by the wholesale newMetadata replace.
            //
            // v1.116 gate round (QA WARNING): trigger this on the SAME predicate as
            // the name gap-fill (snapshot name bad -> live name good), NOT on
            // `!item.channelId`. The heal writer OVERWRITES channelId unconditionally
            // (a fragment can carry a WRONG pre-existing id); gating the carry on
            // `!item.channelId` would revert only the id, persisting a MIXED identity
            // (wrong id + healed name) and -- worse -- promoting that item to a
            // second "canonical" that flips its folder to a conflict and stops all
            // future healing. `freshItem` is the SAME item's live row, so adopting
            // its whole identity unit is authoritative and never mixes across items.
            if (!item.channelAttributedManually
                && snapshotChannelNameWasBad
                && freshChannelNameIsGood
                && typeof freshItem.channelId === 'string' && freshItem.channelId !== '') {
              item.channelId = freshItem.channelId;
              if (typeof freshItem.channelUrl === 'string' && freshItem.channelUrl !== '') item.channelUrl = freshItem.channelUrl;
              if (typeof freshItem.channelHandleUrl === 'string' && freshItem.channelHandleUrl !== '') item.channelHandleUrl = freshItem.channelHandleUrl;
              if (typeof freshItem.channelAvatarUrl === 'string' && freshItem.channelAvatarUrl !== ''
                  && (typeof item.channelAvatarUrl !== 'string' || item.channelAvatarUrl === '')) {
                item.channelAvatarUrl = freshItem.channelAvatarUrl;
              }
            }
            // v1.41.13: the same mid-scan-reheat gap-fill for the universal
            // source identity (persist-gate checkpoint). Keyed on sourceExtractor
            // as a unit (never mix one item's extractor with another's id), and
            // gap-fill only -- a fresh bracket-re-derivation this scan still wins.
            if (!item.sourceExtractor && typeof freshItem.sourceExtractor === 'string' && freshItem.sourceExtractor !== '') {
              item.sourceExtractor = freshItem.sourceExtractor;
              if (freshItem.sourceId) item.sourceId = freshItem.sourceId;
            }
            // v1.53 (manual attribution): the chaptersManual posture -- the
            // flag is written ONLY by the attribute endpoint, never the scan,
            // so the fresh in-lock value (present OR absent) is at least as
            // new as this scan's Phase-1 snapshot. Mirror it unconditionally,
            // INCLUDING clears. When manually attributed, adopt the identity
            // UNIT from fresh too (the flag and the identity it protects must
            // never desynchronize across a scan); on a mid-scan CLEAR, drop
            // the identity unit with the flag or the merge resurrects exactly
            // what the user just cleared.
            if (freshItem.channelAttributedManually === true) {
              item.channelAttributedManually = true;
              if (typeof freshItem.channelUrl === 'string' && freshItem.channelUrl !== '') item.channelUrl = freshItem.channelUrl;
              if (typeof freshItem.channelName === 'string' && freshItem.channelName !== '') item.channelName = freshItem.channelName;
              if (freshItem.channelHandleUrl) item.channelHandleUrl = freshItem.channelHandleUrl; else delete item.channelHandleUrl;
              if (freshItem.channelId) item.channelId = freshItem.channelId; else delete item.channelId;
              if (freshItem.channelAvatarUrl) item.channelAvatarUrl = freshItem.channelAvatarUrl; else delete item.channelAvatarUrl;
            } else {
              if (item.channelAttributedManually === true) {
                delete item.channelUrl;
                delete item.channelHandleUrl;
                delete item.channelId;
                delete item.channelName;
                delete item.channelAvatarUrl;
              }
              delete item.channelAttributedManually;
            }
          }
        }

        // v1.20.0 FR-2: bridge each freshly-scanned yt-dlp download's captured
        // channel identity onto its db.metadata item, inside the SAME
        // serialized mutator -- ytdlp.consumeDownloadChannelMeta reads+re-validates+
        // DELETES the entry on the `ytScan` holder (Wave 5: the bridge map is
        // ytdlp_download_meta; the deletions land through the syncFrom queued
        // into this commit below)
        // (read-validate-delete, bounding the map's growth to "lives only
        // until first index"). Scoped to items that are (a) genuinely
        // new/updated this scan (freshlyScannedIds -- an already-indexed
        // reuse-fast-path item keeps whatever identity it already has) and (b)
        // actually rooted under the module's OWN download dir
        // (`ytdlpDownloadRoots`), mirroring FIX-9's own scoping -- a non-yt-dlp
        // file is NEVER fed a videoId lookup, no matter what its filename
        // happens to look like. A lookup miss (no capture ever recorded for
        // this id, or the entry failed re-validation) leaves the item with no
        // channel identity, exactly as documented (AC12).
        if (freshlyScannedIds.has(item.id) && matchRootFolder(item.filePath, ytdlpDownloadRoots)) {
          const videoId = extractYtdlpVideoId(path.basename(item.name, item.ext));
          // v1.41.13 (universal one-offs, design D2 touch #6 + D1a): a
          // non-legacy-YouTube file carries a `[ExtractorKey=id]` bracket. Bridge
          // its pseudo-channel identity from the universal downloadMeta entry
          // (keyed by the rendered basename -- design D5), writing
          // sourceExtractor/sourceId + channelName (the D7 label) onto the item.
          // If the extractor is Youtube (a proxy-host download -- yewtu.be etc.,
          // design D1a), ALSO set youtubeId so Share/reheat identity is restored.
          // extractMediaRef's legacy branch never fires here (that's `videoId`
          // above); this is strictly the `key=id` shape.
          const mediaRef = !videoId ? extractMediaRef(path.basename(item.name, item.ext)) : null;
          if (mediaRef && mediaRef.source) {
            const isYt = mediaRef.source.toLowerCase() === 'youtube';
            const consumedU = ytdlp.consumeUniversalDownloadMeta(ytScan, path.basename(item.filePath));
            if (consumedU) {
              item.sourceExtractor = consumedU.sourceExtractor;
              item.sourceId = consumedU.sourceId;
              // v1.53: a MANUAL attribution outranks a capture (Dean set it by
              // hand; manual wins forever, exec-plan decision 3).
              if (consumedU.channelName && !item.channelAttributedManually) item.channelName = consumedU.channelName;
              if (typeof consumedU.releaseDate === 'number' && Number.isFinite(consumedU.releaseDate)) {
                item.releaseDate = consumedU.releaseDate;
              }
              if (typeof consumedU.sourceTitle === 'string' && consumedU.sourceTitle !== '') {
                item.sourceTitle = consumedU.sourceTitle;
                item.title = consumedU.sourceTitle;
              }
              applyCapturedViewCount(item, consumedU);
              applyCapturedFollowerCount(item, consumedU);
              collectDownloadNotification(pendingNotifications, item);
              dbChanged = true;
            } else if (!item.sourceId) {
              // No capture bridged (older download, or already consumed) AND the
              // item has no source identity yet -- record it from the on-disk
              // bracket. GAP-FILL ONLY (gate WARNING W1): an unconditional write
              // here clobbered the carried-forward RAW sourceId with the on-disk
              // SANITIZED bracket id on a changed-file rescan (raw `austrian/
              // page=1` -> sanitized `austrian⧸page=1`), and P3 keys the archive/
              // delete off sourceId (D5: RAW is authoritative) -> a deleted video
              // would re-download. The raw value, once persisted, is preserved by
              // the re-init carry-forward; only a genuinely-identity-less item is
              // filled here, from the best available (sanitized) fallback.
              item.sourceExtractor = mediaRef.source;
              item.sourceId = mediaRef.id;
              dbChanged = true;
            }
            // D1a: a proxy-host YouTube item keeps its real YouTube identity.
            // Its capture (extractor_key 'Youtube') was stored by the YouTube
            // sanitize branch keyed by the BARE videoId -- but on disk it carries
            // the `[Youtube=id]` bracket, so `videoId` above is null and the
            // YouTube-consume block below never runs. Recover it HERE: set
            // youtubeId and consume the YouTube downloadMeta by the bracket id, so
            // channelUrl/channelId/channelName/avatar reach the item (gate W2).
            if (isYt && isSafeVideoId(mediaRef.id)) {
              item.youtubeId = mediaRef.id;
              const consumedYt = ytdlp.consumeDownloadChannelMeta(ytScan, mediaRef.id);
              if (consumedYt) {
                // v1.53: identity written as a UNIT only when no MANUAL
                // attribution holds it (manual wins forever, decision 3); the
                // non-identity fields below (dates/title/views) always apply.
                if (!item.channelAttributedManually) {
                  item.channelUrl = consumedYt.channelUrl;
                  if (consumedYt.channelHandleUrl) item.channelHandleUrl = consumedYt.channelHandleUrl;
                  if (consumedYt.channelId) item.channelId = consumedYt.channelId;
                  if (consumedYt.channelName) item.channelName = consumedYt.channelName;
                  if (consumedYt.channelAvatarUrl) item.channelAvatarUrl = consumedYt.channelAvatarUrl;
                }
                if (typeof consumedYt.releaseDate === 'number' && Number.isFinite(consumedYt.releaseDate)) item.releaseDate = consumedYt.releaseDate;
                if (typeof consumedYt.sourceTitle === 'string' && consumedYt.sourceTitle !== '') { item.sourceTitle = consumedYt.sourceTitle; item.title = consumedYt.sourceTitle; }
                applyCapturedViewCount(item, consumedYt);
                applyCapturedFollowerCount(item, consumedYt);
                collectDownloadNotification(pendingNotifications, item);
                dbChanged = true;
              }
            }
          }
          if (videoId) {
            // v1.33 T1: the bracket id IS this item's YouTube id -- persist it
            // (the new/updated branch above already set it from the same
            // bracket, but this also covers the AC20 race window where the
            // item was indexed before this bridge pass).
            item.youtubeId = videoId;
            const consumed = ytdlp.consumeDownloadChannelMeta(ytScan, videoId);
            if (consumed) {
              // v1.53: same manual-wins unit guard as the D1a site above.
              if (!item.channelAttributedManually) {
                item.channelUrl = consumed.channelUrl;
                if (consumed.channelHandleUrl) item.channelHandleUrl = consumed.channelHandleUrl;
                if (consumed.channelId) item.channelId = consumed.channelId;
                if (consumed.channelName) item.channelName = consumed.channelName;
              }
              // C5-local/C5-ytdlp (T5 write path, wired end-to-end by T11 in
              // Wave 3): a yt-dlp-captured `upload_date`/`release_date` is
              // authoritative and supersedes the local-scan fallback (embedded
              // probe date / mtime) already set on `item.releaseDate` above --
              // yt-dlp's own metadata is more precise than a filesystem
              // timestamp.
              if (typeof consumed.releaseDate === 'number' && Number.isFinite(consumed.releaseDate)) {
                item.releaseDate = consumed.releaseDate;
              }
              // v1.33 T3: the captured REAL title (emoji intact -- see
              // CHANNEL_META_PRINT_TEMPLATE, lib/ytdlp/args.js) supersedes the
              // filename-derived display title, which `--restrict-filenames`
              // has already folded to underscores on disk. `sourceTitle` keeps
              // the provenance so later rescans of a changed file re-prefer it
              // (see the carry-forward in the new/updated branch above).
              if (typeof consumed.sourceTitle === 'string' && consumed.sourceTitle !== '') {
                item.sourceTitle = consumed.sourceTitle;
                item.title = consumed.sourceTitle;
              }
              // C6 (T11, Wave 3): `consumeDownloadChannelMeta` re-validates the
              // captured avatar via `sanitizeChannelAvatarUrl` before returning
              // it -- carry it onto the item exactly like the identity fields
              // above. v1.53: part of the identity unit, so the manual guard
              // covers it too.
              if (typeof consumed.channelAvatarUrl === 'string' && consumed.channelAvatarUrl !== '' && !item.channelAttributedManually) {
                item.channelAvatarUrl = consumed.channelAvatarUrl;
              }
              applyCapturedViewCount(item, consumed);
              applyCapturedFollowerCount(item, consumed);
              collectDownloadNotification(pendingNotifications, item);
              dbChanged = true;
            }
          }
        }

        // v1.22.0 FR-2: retroactive, folder-based backfill -- the sibling to
        // the freshlyScannedIds-scoped bridge above, but deliberately NOT
        // scoped to freshlyScannedIds: an already-indexed item (the
        // reusable/legacyVideoCodecBackfillOnly fast paths above) that is
        // STILL missing channel identity -- a pre-v1.20 download indexed long
        // before capture existed, or one the AC20 periodic-scan race left
        // un-bridged (freshlyScannedIds with no matching downloadMeta entry
        // yet) -- gets a second chance HERE, on every scan, by inferring
        // identity from its own download FOLDER instead of the consumed
        // per-video downloadMeta map. Never overwrites an item that already
        // has channelUrl (AC17, NEVER-OVERWRITE guard) -- only a genuine gap
        // is filled. Scoped to ytdlpDownloadRoots exactly like the bridge
        // above (matchRootFolder, same semantics) -- a non-yt-dlp library file
        // is NEVER fed the matcher, no matter what folder it happens to sit
        // in. Because this runs unconditionally every scan for every
        // identity-less yt-dlp item, it also heals the AC20 race itself: a
        // file the periodic auto-scan indexed before its downloadMeta was
        // written simply picks up its identity from its own folder on the
        // very next scan.
        // v1.53: `!item.channelUrl` already makes this safe against a manual
        // attribution TODAY (manual writes set channelUrl) -- the explicit flag
        // check makes the invariant survive any future manual shape that
        // doesn't (a name-only attribution, a cleared-URL edge).
        if (!item.channelUrl && !item.channelAttributedManually && matchRootFolder(item.filePath, ytdlpDownloadRoots)) {
          const backfilled = ytdlp.backfillChannelIdentityFromFolder(ytScan, item, ytdlpConfig);
          if (backfilled) {
            item.channelUrl = backfilled.channelUrl;
            // AC80: writing channelName here is what makes the real creator
            // name (not the generic "Downloads"/folder label) appear on the
            // watch page + cards -- resolveChannelName (common.js) already
            // ranks a captured item.channelName first; no client change needed.
            // v1.115 (Dean, A1) gate fix (QA SUGGESTION): only fill a BAD name --
            // an id-only item just backfilled to its real name (by the name-backfill
            // batch, carried across this scan by the gap-fill above) must not be
            // downgraded to a matched subscription's @handle here.
            if (backfilled.channelName && ytdlp.isBadChannelName(item.channelName)) item.channelName = backfilled.channelName;
            if (backfilled.channelId) item.channelId = backfilled.channelId;
            // C6 (T11, Wave 3): heals a matched subscription's avatar onto an
            // identity-less old item too -- `backfillChannelIdentityFromFolder`
            // already re-validated it via `sanitizeChannelAvatarUrl`.
            if (backfilled.channelAvatarUrl) item.channelAvatarUrl = backfilled.channelAvatarUrl;
            dbChanged = true;
          }
        }
      }

      if (!dbChanged) return false;
      inSaveTransaction(() => ytdlpDb.syncFrom(ytScan.ytdlp)); // Wave 5: the consumed bridge entries land in this commit (a no-op diff when nothing was consumed)

      // HR1b (finding D): never resurrect an id DELETEd concurrently during this
      // scan. An id in the Phase-1 snapshot (phase1Ids) that is now ABSENT from
      // the fresh in-lock db was removed by a DELETE /api/videos/:id that
      // committed while the scan ran; the Phase-1 pre-delete newMetadata must
      // not re-insert it. (An id NOT in phase1Ids is a genuinely-new file and is
      // still added; an id still present in fresh -- incl. mount-loss-retained
      // entries -- is kept, merged as today.)
      for (const id of Object.keys(newMetadata)) {
        if (phase1Ids.has(id) &&
            !Object.prototype.hasOwnProperty.call(fresh.metadata, id)) {
          delete newMetadata[id];
        }
      }

      // v1.41.6 -- HR1b's MIRROR IMAGE, and this release's persist-gate/
      // stale-snapshot checkpoint (the class has now struck six times; the sixth
      // was last release).
      //
      // `mergeScannedMetadata` below is AUTHORITATIVE FOR MEMBERSHIP: whatever is
      // not in `newMetadata` is gone from `db.metadata`. HR1b (above) uses that
      // to keep a concurrently-DELETEd id from being resurrected. The same
      // property is lethal to a concurrent RE-KEY: the reheat's import-relocation
      // (`relocateHydratedImportIntoChannelFolder`) moves a file and gives it a
      // BRAND-NEW path-derived id inside `fresh.metadata` -- an id this scan's
      // Phase-1 walk, which saw the file at its OLD path, has never heard of. The
      // old id is (correctly) dropped by HR1b, and the new one is not in
      // `newMetadata`, so the wholesale replace would silently DELETE the item's
      // metadata entry outright: the video vanishes from the library until some
      // later scan re-indexes the file as a stranger -- with its release date,
      // chapters, reheat marker and `addedAt` position gone. The reheat batch runs
      // for minutes-to-hours against a periodic scan with NO mutual exclusion (see
      // the merge block's own header), so this is not a narrow race.
      //
      // The rule: an id present in the FRESH db that this scan never saw
      // (`!phase1Ids.has(id)`) appeared DURING the scan -- a concurrent add or
      // re-key -- and the scan's stale snapshot is in no position to prune it.
      // Carry it forward, but only when its file is genuinely on disk, so this can
      // never resurrect a phantom. Deliberately NOT scoped to the relocation: any
      // future mid-scan writer of a new id gets the same protection, which is the
      // whole point of a checkpoint.
      for (const id of Object.keys(fresh.metadata)) {
        if (Object.prototype.hasOwnProperty.call(newMetadata, id)) continue; // the scan has its own, newer view
        if (phase1Ids.has(id)) continue; // pre-existing: the scan's prune/retain decision (above) stands
        const freshEntry = fresh.metadata[id];
        if (!freshEntry || typeof freshEntry.filePath !== 'string' || freshEntry.filePath === '') continue;
        if (!fs.existsSync(freshEntry.filePath)) continue; // no file behind it -- nothing to keep alive
        newMetadata[id] = freshEntry;
      }

      // v1.41.3: consume the tombstones this scan acted on -- targeted key
      // deletes against the FRESH map only (a tombstone minted mid-scan by a
      // concurrent DELETE is not in consumedTombstoneIds and survives intact).
      if (consumedTombstoneIds.size) {
        // Wave 2: consumed inside this mutator's save transaction (atomic with
        // the merge that indexes/reaps the files they governed).
        const consumed = [...consumedTombstoneIds];
        inSaveTransaction(() => tombstoneStore.remove(consumed));
      }

      fresh.metadata = mergeScannedMetadata(fresh.metadata, newMetadata);
      // Wave 2: the frozen pre-auth positions prune with their items inside
      // this save transaction (they used to be `delete fresh.progress[id]`).
      if (prunable.size > 0) {
        const pruned = [...prunable];
        inSaveTransaction(() => progressStore.remove(pruned));
      }
      for (const id of prunable) {
        // (v1.42 gate W3: the view counter used to prune here as a doc carry.
        // Wave 1: it is a relational carrier now, pruned post-commit below
        // beside the per-user rows - same two reasons: unbounded growth under
        // churn, and a stale count resurrecting onto a same-path re-add.)
        // Also drop the write-throttle map entry (FR3.2): without this, a
        // pruned id's persistedServedAt entry lingers forever (unbounded growth
        // under churn) and can suppress lastServedAt persistence if the same id
        // is re-added (e.g. same path restored) within RECENT_STREAM_MS.
        clearPersistedServedAt(id);
      }
      return true;
    });
    if (dbChanged) console.log('Database synced successfully.');

    // v1.43: mirror the mutator's `fresh.progress` prune
    // onto the per-user rows (user_progress/user_liked -- id-keyed carriers,
    // the v1.41.6 class), AFTER the doc commit for the same rolled-back-write
    // reason rekeyInFlightState documents. One transaction for the whole
    // prunable set.
    if (prunable.size > 0) {
      try {
        userStore.removeMediaState([...prunable]);
      } catch (err) {
        console.error('Scan: failed to prune per-user progress/liked for removed items (continuing):', err && err.message);
      }
      // Wave 1: the relational view counter is an id-keyed carrier too - same
      // post-commit posture, same one-transaction-for-the-set shape.
      try {
        viewCountStore.remove([...prunable]);
      } catch (err) {
        console.error('Scan: failed to prune view counts for removed items (continuing):', err && err.message);
      }
    }

    // v1.51: the download notifications collected inside the mutator land AFTER
    // the doc commit, for the same rolled-back-write reason as the per-user
    // prune above — a doc save that failed must not have already notified about
    // items the library never adopted. Best-effort: the item itself is indexed
    // either way, a lost notification is cosmetic.
    if (pendingNotifications.length > 0) {
      try {
        const inserted = userStore.recordNotifications(pendingNotifications);
        // v1.66: push delivery fires DETACHED (trigger() schedules via
        // setImmediate and coalesces overlapping rounds) - this function is
        // awaited by the scan-coalescing state machine, and a slow push
        // endpoint must never stall the next scan. Only the REAL record path
        // triggers: boot seeding and restore never reach this site.
        if (inserted > 0) pushDelivery.trigger('scan');
      } catch (err) {
        console.error('Scan: failed to record download notifications (continuing):', err && err.message);
      }
    }

    // v1.35 (preExtractAudio): fire the collected sidecar extractions now that
    // the final save has landed (see the collector's comment above for why not
    // mid-scan). queueAudioExtract is idempotent (queue-de-duped, skips when
    // the sidecar already exists, guards ffmpeg availability), so re-scans of
    // the same fresh window are harmless.
    for (const candidate of preExtractCandidates) {
      try {
        queueAudioExtract(candidate.id, candidate.filePath);
      } catch (err) {
        console.error(`preExtractAudio: failed to queue sidecar extraction for ${candidate.id}:`, err && err.message);
      }
    }
  }

  // Recursive directory scanning helper.
  // v1.30 A2 (AC1.1/AC1.2): converted to async/cooperative -- `fs.readdirSync`
  // -> `await fs.promises.readdir`, `fs.statSync` -> `await fs.promises.stat`,
  // the directory recursion itself is now `await`ed, and `yieldState` (shared
  // across the whole scan pass, see `maybeYieldScan`/`SCAN_YIELD_BATCH` above)
  // is advanced once per directory ENTRY (file or subdirectory) so a large,
  // flat directory can't itself exceed the yield budget between recursive
  // calls. Every OTHER byte of the filtering/guard logic below (the
  // `isYtdlpIntermediate` skip, the `ALL_EXTENSIONS` check, `folderName`
  // derivation, and -- most importantly -- the `unreadable.add(dirPath)`
  // mount-loss/per-file-stat-failure guard, AC1.4/AC1.5) is unchanged: only
  // the fs calls became async and a cooperative yield point was added.
  async function scanDirRecursive(rootFolder, dirPath, results, unreadable, yieldState) {
    let files;
    try {
      files = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      console.error(`Error reading directory ${dirPath}:`, err);
      // First-class "could not enumerate this subtree" signal, at ANY depth --
      // a transiently-unreadable directory (EACCES/EIO/ESTALE, a dropped nested
      // mount) must never be mistaken for its contents having been deleted.
      // selectPrunableIds retains every entry under this path. A child dir that
      // vanishes/becomes unreadable mid-recursion throws on its OWN readdir
      // call below and is recorded there, so nested depth is covered too.
      if (unreadable) unreadable.add(dirPath);
      return;
    }

    for (const file of files) {
      const fullPath = path.join(dirPath, file.name);
      if (file.isDirectory()) {
        // v1.65: the trash directory is INVISIBLE to the walk -- a trashed
        // file must never re-index (the resurrection class), and this skip is
        // the only thing standing between the two (there is no other
        // exclusion primitive; see docs/exec-plans/completed/2026-08-02-v1.65-trash.md).
        if (file.name === TRASH_DIR_NAME) continue;
        await scanDirRecursive(rootFolder, fullPath, results, unreadable, yieldState);
      } else if (file.isFile()) {
        // v1.15.1 hotfix: a yt-dlp download that is killed (e.g. the download
        // timeout) or otherwise fails leaves intermediate/partial artifacts
        // (merge temps, per-format fragments, `.part`/`.ytdl` markers) behind
        // in its download dir -- several of these shapes carry a whitelisted
        // media extension (e.g. `foo [id].f399.mp4`) and would otherwise be
        // indexed as a broken library card (no thumbnail, a raw yt-dlp-shaped
        // name). Skipped BEFORE the extension check below, regardless of the
        // file's own extension, so it can never slip through via a media ext.
        // This is intentionally distinct from FileTube's OWN `.tmp.mp4`
        // transcode-cache temp file (a different pattern, in a different
        // directory) -- that exclusion is unaffected.
        // v1.111: ALSO skip an in-flight/crash-left faststart temp
        // (`<orig>.faststart.tmp.mp4`, caught by isInFlightTranscode's `.tmp.mp4`
        // suffix). UNLIKE the transcode-cache `.tmp.mp4` (in TRANSCODE_DIR, outside
        // every scan root), the faststart remux writes its temp as a SIBLING of the
        // media file -- INSIDE a scan root -- so a process death between temp-write
        // and the atomic rename would otherwise leave a full-size `.tmp.mp4` the
        // walk indexes as a phantom/duplicate card (gate WARNING). Harmless for the
        // transcode-cache temp (never under a scan root anyway).
        if (isYtdlpIntermediate(file.name) || isInFlightTranscode(file.name)) {
          await maybeYieldScan(yieldState);
          continue;
        }
        const ext = path.extname(file.name).toLowerCase();
        if (ALL_EXTENSIONS.includes(ext)) {
          try {
            const stats = await fs.promises.stat(fullPath);
            // Folder name serves as the "channel name"
            // We can use the immediate parent directory name, or relative folder name from root
            let folderName = path.basename(dirPath);
            if (dirPath === rootFolder) {
              folderName = path.basename(rootFolder) || 'Library';
            }

            results.set(fullPath, {
              name: file.name,
              ext,
              size: stats.size,
              addedAt: stats.birthtimeMs || stats.mtimeMs,
              // C5-local (v1.24): the release-date fallback wants the actual
              // filesystem `mtime` (not `addedAt`'s birthtime-preferring
              // value) -- reused from THIS SAME `stat` call, no extra I/O.
              mtimeMs: stats.mtimeMs,
              folderName
            });
            // v1.30 A2 (AC2.2): `total` tracks files discovered so far this
            // pass -- `results` (the caller's `scannedFiles` Map) only ever
            // grows during the walk, so this is monotonic non-decreasing.
            scanState.total = results.size;
          } catch (err) {
            console.error(`Error stating file ${fullPath}:`, err);
            // Mirror the readdir-failure guard above at file granularity: a
            // transient per-file stat error (ESTALE/EIO/EACCES on a flaky mount)
            // even though THIS directory's own readdir succeeded must not
            // silently drop the file -- without this, the file is non-surviving
            // but its directory would never be recorded as un-enumerable, so
            // selectPrunableIds would treat it as genuinely gone and prune it
            // (pruneMissing default true) on a retryable error = permanent data
            // loss. Marking the whole directory unreadable is conservative (the
            // entire subtree is retained for this pass and re-evaluated on the
            // next scan) but never loses data to a transient failure.
            if (unreadable) unreadable.add(dirPath);
          }
        }
        await maybeYieldScan(yieldState);
      }
    }
  }

  // v1.37.5 (Dean: "I delete things and they don't actually get deleted" -- gone
  // from the list, back after a rescan, only a SMALL % of files, NOT a
  // permissions problem): resolve the stored `filePath` to the ACTUAL on-disk
  // entry before we unlink. Root cause of that bug: an item's id IS the md5 of
  // its path string and both `fs.existsSync`/`fs.unlinkSync` take that exact
  // byte sequence -- but a file's on-disk name can carry a DIFFERENT Unicode
  // normalization than what we persisted (NFC vs NFD; macOS/APFS and many SMB
  // shares hand back NFD, while a name typed/stored elsewhere is NFC). A single
  // combining-mark difference makes `existsSync(storedPath)` miss the real file;
  // the OLD handler then skipped the unlink, logged a warning, and deleted the
  // db entry anyway with `{success:true}` -- so the card vanished (client trusts
  // success) while the file survived and the next scan re-indexed it. This maps
  // the stored path to the real entry by resolving it ONE PATH COMPONENT AT A
  // TIME by NFC-normalized match, so a normalization difference in ANY segment
  // is handled -- not just the leaf filename. This matters because FileTube
  // stores downloads in per-CHANNEL folders and SMB/APFS emit NFD for the WHOLE
  // path, so a diacritic in the FOLDER name (Beyonce, Motorhead) is the same
  // failure as one in the filename (v1.37.5 gate finding). Each segment is tried
  // as an EXACT child first (cheap -- the all-ASCII common case never enumerates
  // a directory), then by NFC-normalized match within its real parent. Returns:
  //   { realPath: <string> }              -- resolved (may equal filePath): unlink this
  //   { realPath: null, gone: true }      -- a segment is genuinely absent (dir
  //                                          readable, no match): desired end state holds
  //   { realPath: null, unreadable: err } -- a dir on the path is un-enumerable
  //                                          (EACCES/EPERM/ENOTDIR): CANNOT confirm removal
  // The `unreadable` case is exactly what must NOT silently drop the library
  // entry (that is the reported bug); the caller surfaces it as a recoverable
  // 409 with the same opt-in `removeAnyway` escape hatch as a read-only volume.
  //
  // SEAM 1 (the recurring "delete a yt-dlp video -> rescan -> it REAPPEARS" bug,
  // "fixed" twice and still shipping): when the exact spelling AND the NFC/NFD
  // sibling walk BOTH fail on the LEAF filename, `resolveLeafByBracketId` below
  // is the last-resort resolver. WHY this class exists at all: the library id is
  // `md5(item.filePath)` = the STORED spelling, but yt-dlp can land the file at a
  // spelling that DIVERGES from what we stored in a way NFC/NFD cannot bridge --
  // a full-width U+FF1F where the title had '?', an emoji ZWJ sequence, raw
  // invalid-UTF-8 metube-era bytes, or a relocation-computed name that diverged
  // from what actually hit disk. For those, `existsSync(stored)` is false and the
  // NFC walk finds no canonical sibling, so this resolver USED to return `gone`
  // even though the real bytes are right there -- the delete then falsely reports
  // "already gone", never unlinks the file, AND files a tombstone keyed by
  // md5(storedPath) that the scanner (which keys by md5(realDiskPath)) can never
  // match, so the survivor is re-indexed and the video comes back. The `[id]`
  // bracket is the STABLE INVARIANT that survives any title mangling, so we
  // recover the real entry by its 11-char youtube id + extension.
  function resolveLeafByBracketId(dir, storedLeaf, stringEntries) {
    const storedExt = path.extname(storedLeaf);
    // SCOPING: only ever fires when the STORED basename itself carries a yt-dlp
    // bracket -- either the legacy YouTube `[<11-char id>]` OR (v1.41.13) the
    // universal `[<ExtractorKey>=<id>]` -- so a non-yt-dlp file can never be
    // matched by a coincidental bracket on a neighbour. Confined to `dir` (the
    // stored path's own already-resolved parent) -- never roams. `extractMediaRef`
    // parses both shapes; the YouTube leg is byte-identical to the prior
    // extractYtdlpVideoId behavior (same 11-char bracket, same id).
    const wantRef = extractMediaRef(path.basename(storedLeaf, storedExt));
    if (!wantRef) return null;
    // The exact bracket text this ref renders as on disk: `[id]` for YouTube,
    // `[Key=id]` for a universal source. Used for the raw-bytes Pass 2 below.
    const wantBracket = wantRef.source === 'youtube' ? `[${wantRef.id}]` : `[${wantRef.source}=${wantRef.id}]`;
    // Pass 1: the plain string entries readdir already produced (covers the
    // full-width / emoji-ZWJ divergences -- valid UTF-8, so they round-trip).
    let hit = null;
    for (const name of stringEntries) {
      if (path.extname(name) !== storedExt) continue;
      const nameRef = extractMediaRef(path.basename(name, storedExt));
      if (!nameRef || nameRef.source !== wantRef.source || nameRef.id !== wantRef.id) continue;
      const candidate = path.join(dir, name);
      // A name carrying invalid UTF-8 bytes decodes to U+FFFD replacement chars
      // in its string form, whose bracket still matches here but whose path does
      // NOT round-trip to the real bytes -- verify it actually resolves before
      // trusting it (else it falls to the raw-bytes Pass 2 below).
      let ok = false;
      try { ok = fs.existsSync(candidate); } catch (_) { ok = false; }
      if (!ok) continue;
      if (hit !== null && hit !== candidate) return null; // two matches -> ambiguous: do not guess
      hit = candidate;
    }
    if (hit !== null) return { realPath: hit };
    // Pass 2 (tech-debt #35a): a name that does not round-trip through a UTF-8
    // string decode -- Node replaced its bad bytes with U+FFFD, so Pass 1 could
    // not resolve it. Enumerate as raw buffers, match the ASCII `[id]` bracket in
    // the raw bytes, and hand back the ACTUAL entry (a Buffer path) so the caller
    // unlinks the real file rather than a lossy reconstruction.
    let bufEntries;
    try { bufEntries = fs.readdirSync(dir, { encoding: 'buffer' }); } catch (_) { return null; }
    const extBuf = Buffer.from(storedExt, 'utf8');
    const bracketBuf = Buffer.from(wantBracket, 'utf8'); // ASCII bracket text -> exact byte match
    let rawHit = null;
    for (const buf of bufEntries) {
      if (buf.length < extBuf.length || !buf.subarray(buf.length - extBuf.length).equals(extBuf)) continue;
      const stem = buf.subarray(0, buf.length - extBuf.length);
      if (stem.length <= bracketBuf.length) continue; // need at least one title byte before the bracket
      if (!stem.subarray(stem.length - bracketBuf.length).equals(bracketBuf)) continue;
      // Mirror extractYtdlpVideoId's ` [` / `_[` separator: the byte before the
      // bracket must be a space or underscore (so a mid-name coincidental bracket
      // is never matched).
      const sep = stem[stem.length - bracketBuf.length - 1];
      if (sep !== 0x20 && sep !== 0x5F) continue;
      if (rawHit !== null) return null; // ambiguous: do not guess
      rawHit = buf;
    }
    if (rawHit === null) return null;
    const rawPath = Buffer.concat([Buffer.from(dir + path.sep, 'utf8'), rawHit]);
    // realPath is a display-only lossy string; realPathRaw is what MUST be unlinked.
    return { realPath: path.join(dir, rawHit.toString('utf8')), realPathRaw: rawPath };
  }

  function resolveOnDiskPath(filePath) {
    try {
      if (fs.existsSync(filePath)) return { realPath: filePath };
    } catch (_) { /* fall through to the component walk */ }
    const resolvedAbs = path.resolve(filePath);
    const parts = resolvedAbs.split(path.sep).filter((p) => p !== '');
    let current = path.isAbsolute(resolvedAbs) ? path.sep : '.';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      // Fast path: the exact byte-spelling of this segment exists -- descend
      // without enumerating (keeps a mostly-ASCII path to O(depth) stats).
      const exact = path.join(current, part);
      let existsExact = false;
      try { existsExact = fs.existsSync(exact); } catch (_) { existsExact = false; }
      if (existsExact) { current = exact; continue; }
      // This segment's exact spelling is missing -- look for a Unicode-variant
      // sibling (NFC/NFD) in the real parent directory.
      let entries;
      try {
        entries = fs.readdirSync(current);
      } catch (err) {
        // ENOENT: the parent itself vanished mid-walk -> genuinely gone. Any
        // other errno (EACCES/EPERM/ENOTDIR) means we could not enumerate to
        // confirm -> unconfirmable, never reported as gone.
        if (err && err.code === 'ENOENT') return { realPath: null, gone: true };
        return { realPath: null, unreadable: err };
      }
      let want;
      try { want = part.normalize('NFC'); } catch (_) { want = part; }
      let matched = null;
      for (const name of entries) {
        let nfc;
        try { nfc = name.normalize('NFC'); } catch (_) { nfc = name; }
        if (nfc === want) { matched = name; break; }
      }
      if (matched === null && isLeaf) {
        // SEAM 1 last-resort: the leaf's title bytes diverged past NFC/NFD --
        // recover the real file by its stable yt-dlp `[id]` bracket (see
        // resolveLeafByBracketId's header for the resurrect-bug this closes).
        // ADDITIVE: only reached after the exact + NFC/NFD attempts already
        // failed, and only when the parent dir was successfully enumerated
        // (so the `unreadable`->409 vs `gone`->success distinction is intact).
        const byId = resolveLeafByBracketId(current, part, entries);
        if (byId) return byId;
      }
      // Dir readable but no canonical match -> this segment is genuinely absent.
      if (matched === null) return { realPath: null, gone: true };
      current = path.join(current, matched);
    }
    return { realPath: current };
  }

  return {
    parseFfprobeStreams,
    extractMetadataAndThumbnail,
    extractStoryboard,
    runScanDirectories,
    scanDirRecursive,
    resolveLeafByBracketId,
    resolveOnDiskPath,
  };
}

module.exports = { createScanOrchestrator };
