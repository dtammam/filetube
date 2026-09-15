'use strict';

// lib/media/transcode.js - the on-demand transcode / background-audio-extract /
// roku-compat rendition QUEUE machinery, moved VERBATIM out of server.js in Wave
// 7b (slice S8) of the relational-migration arc (docs/exec-plans/active/
// 2026-09-13-sqlite-relational-migration.md). Every function body is byte-identical
// to the server.js original; the free identifiers resolve from the `const { ... } =
// deps` destructure of the factory (the lib/media/trash.js createTrashOps pattern).
// A missing dep is a hard failure, never a silent fallback.
//
// Mutable state that moves IN (every reader and writer is a moved function): the
// three single-worker queues (`transcodeQueue`/`audioExtractQueue` STAY in server.js
// because `isMediaJobInFlight` reads them, and cross as the SAME array reference;
// `rokuCompatQueue` moves), the busy flags (`transcodeBusy`/`audioExtractBusy`/
// `rokuCompatBusyId`), `rokuCompatProbing`, and `rokuCompatBlockLogged`. The two
// progress maps (`transcodeProgress`/`audioExtractProgress`) STAY in server.js
// (lib/config + lib/media routes read them) and cross as the same OBJECT reference -
// never a frozen copy, because they are const and never reassigned.
//
// The ONE non-byte-identical token: `ffmpegAvailable` is a server.js `let` an async
// boot probe flips from false to true; destructuring it would freeze the boot-time
// false (503 every request forever), so it crosses as the live reader
// `ffmpegIsAvailable()` (the R2 seam class; test/unit background-audio + roku-compat
// suites prove the seam live).

function createTranscodeQueues(deps) {
  const {
    fs,
    path,
    spawn,
    getCachedDatabase,
    loadDatabase,
    updateDatabase,
    settingsStore,
    recordServed,
    TRANSCODE_DIR,
    TRANSCODE_CRF,
    TRANSCODE_CACHE_MAX_BYTES,
    RECENT_STREAM_MS,
    recentlyServed,
    transcodeQueue,
    transcodeProgress,
    audioExtractQueue,
    audioExtractProgress,
    audioPath,
    buildAudioExtractArgs,
    needsTranscode,
    ROKU_COMPAT_DIR,
    ROKU_COMPAT_CACHE_MAX_BYTES,
    rokuCompatLib,
    rokuCompatRenditionPath,
    readRokuCompatSidecar,
    writeRokuCompatSidecar,
    probeForRokuCompat,
    configuredLibraryRoots,
    TTS_CACHE_DIR,
    booksDb,
    booksStore,
    booksTtsChunk,
    booksTtsEngine,
    booksZip,
    resolveTtsChapter,
    runFfmpeg,
    setTtsStatus,
    synthesizeBlock,
    ttsBlocksPath,
    ttsM4aPath,
    ttsSettings,
    wavDurationSec,
    ffmpegIsAvailable,
  } = deps;

  // ---- Internal single-worker queue state (moves WITH every reader/writer) ----
  const rokuCompatQueue = [];
  let rokuCompatBusyId = null; // id of the job ffmpeg is running RIGHT NOW
  const rokuCompatProbing = new Set(); // ids with an ffprobe in flight

  // The rendition cache dir must never live inside a scanned library root, or
  // the scan would index renditions as media (the v1.41.6 seam class). Config
  // folders can change at runtime, so this is checked per-request (cheap pure
  // prefix test), not just at boot; when violated the feature disables itself
  // (originals still serve) and logs once.
  let rokuCompatBlockLogged = false;
  function rokuCompatBlocked() {
    const blocked = rokuCompatLib.isInsideAnyRoot(ROKU_COMPAT_DIR, configuredLibraryRoots(getCachedDatabase()), path);
    if (blocked && !rokuCompatBlockLogged) {
      rokuCompatBlockLogged = true;
      console.error(`Roku-compat cache directory ${ROKU_COMPAT_DIR} is inside a configured media folder -- compatibility renditions are DISABLED (the scan would index renditions as media). Move it with ROKU_COMPAT_DIR.`);
    }
    return blocked;
  }

  let transcodeBusy = false;
  let audioExtractBusy = false;

  function transcodedPath(id) {
    return path.join(TRANSCODE_DIR, `${id}.mp4`);
  }

  // True for an in-flight (not-yet-finalized) write in TRANSCODE_DIR, either
  // kind: a pre-transcoded video (`*.tmp.mp4`) or a background-audio extract
  // (`*.tmp.m4a`, v1.27.0). Shared by every predicate below that must never
  // touch/delete/count an in-progress write, so the two kinds can't drift.
  function isInFlightTranscode(p) {
    return p.endsWith('.tmp.mp4') || p.endsWith('.tmp.m4a');
  }

  // Pure: given files [{path, size, atimeMs}], return the paths to delete so the
  // total size drops to <= maxBytes. Never returns an in-flight write
  // (*.tmp.mp4 / *.tmp.m4a — see isInFlightTranscode) or keepPath (the
  // just-produced file) — though keepPath's size still counts toward the
  // total. Evicts least-recently-used first (atime asc, then path).
  function selectEvictions(files, maxBytes, protectedPaths) {
    // protectedPaths may be a single path, an array, or a Set — never evicted,
    // though their size still counts toward the total.
    const keep = protectedPaths instanceof Set
      ? protectedPaths
      : new Set(protectedPaths ? [].concat(protectedPaths) : []);
    const eligible = files.filter(f => !isInFlightTranscode(f.path));
    let total = eligible.reduce((sum, f) => sum + f.size, 0);
    if (total <= maxBytes) return [];
    const candidates = eligible
      .filter(f => !keep.has(f.path))
      .sort((a, b) => (a.atimeMs - b.atimeMs) || (a.path < b.path ? -1 : 1));
    const toDelete = [];
    for (const f of candidates) {
      if (total <= maxBytes) break;
      toDelete.push(f.path);
      total -= f.size;
    }
    return toDelete;
  }

  // True for a finished transcoded MP4 OR a finished background-audio extract
  // (v1.27.0) — `*.mp4`/`*.m4a` that is NOT the in-flight `*.tmp.mp4`/`*.tmp.m4a`
  // write (see isInFlightTranscode). Shared by every site that enumerates
  // TRANSCODE_DIR (size display, eviction, age sweep, "clear cache now") so
  // the exclusion/inclusion can't drift between copies — this is what makes
  // the audio-extract cache ride the SAME lifecycle as the video transcode
  // cache rather than needing its own parallel set of predicates.
  function isCompletedTranscode(name) {
    return (name.endsWith('.mp4') || name.endsWith('.m4a')) && !isInFlightTranscode(name);
  }

  // Paths served within RECENT_STREAM_MS (the live-watch protection set shared
  // by evictTranscodeCache, sweepAgedTranscodes, and POST /api/cache/clear),
  // pruning stale entries out of `recentlyServed` as it goes. A single source so
  // all three sites agree on both membership AND stale-entry pruning (the two
  // non-evict copies previously omitted the pruning).
  function activeProtectedPaths(now) {
    const set = new Set();
    for (const [p, t] of recentlyServed) {
      if (now - t <= RECENT_STREAM_MS) set.add(p);
      else recentlyServed.delete(p); // prune stale entries
    }
    return set;
  }

  // Enforce the cache cap by evicting LRU transcoded MP4s from TRANSCODE_DIR.
  // Never evicts justProducedPath or any recently-served file. Returns the count
  // deleted. (LRU order among evictable files is still atime-keyed — best-effort.)
  function evictTranscodeCache(maxBytes, justProducedPath) {
    let entries;
    try { entries = fs.readdirSync(TRANSCODE_DIR); } catch (_) { return 0; }
    // v1.35 (preExtractAudio): while the setting is ON, .m4a background-audio
    // sidecars are PINNED -- never candidates for the automatic size-cap
    // eviction (this function) or the age sweep (below). The manual Settings
    // "Clear cache" button (POST /api/cache/clear) still removes them --
    // explicit user intent wins over the pin. They still COUNT toward the
    // displayed cache size (honest accounting).
    const pinAudioSidecars = !!settingsStore.getKey('preExtractAudio'); // Wave 4
    // Gate QA-WARNING: the preExtractAudio pin protects VIDEO background-audio
    // sidecars only -- a music ALAC rendition (also `<id>.m4a` in TRANSCODE_DIR,
    // shared by design) must NOT be pinned, or a large ALAC library would grow
    // eviction-immune. A sidecar's id is a db.metadata (video) id; a rendition's
    // id is a db.music.tracks id, so metadata membership discriminates the two.
    const pinnableVideoMeta = pinAudioSidecars ? (getCachedDatabase().metadata || {}) : null;
    const isPinnedSidecar = (name) => pinAudioSidecars && name.endsWith('.m4a')
      && Object.prototype.hasOwnProperty.call(pinnableVideoMeta, name.slice(0, -'.m4a'.length));
    const files = [];
    for (const name of entries) {
      if (!isCompletedTranscode(name)) continue;
      if (isPinnedSidecar(name)) continue;
      const p = path.join(TRANSCODE_DIR, name);
      try {
        const st = fs.statSync(p);
        files.push({ path: p, size: st.size, atimeMs: st.atimeMs || st.mtimeMs });
      } catch (_) { /* file vanished between readdir and stat; skip */ }
    }
    // Protect the just-produced file and anything served in the recent window.
    const now = Date.now();
    const protectedPaths = activeProtectedPaths(now);
    if (justProducedPath) protectedPaths.add(justProducedPath);
    const victims = selectEvictions(files, maxBytes, protectedPaths);
    let removed = 0;
    for (const p of victims) {
      try {
        fs.unlinkSync(p);
        removed++;
        console.log(`Evicted from transcode cache: ${p}`);
        // F1 (two-reviewer gate, v1.27.0): an evicted background-audio
        // sidecar (`.m4a`) must not leave a stale `audioStatus: 'ready'`
        // behind it -- see clearAudioStatus's own comment for why this is a
        // deliberate strengthening beyond how `.mp4` deletion here already
        // leaves `transcodeStatus` untouched (scan-lazy reconciliation).
        if (p.endsWith('.m4a')) clearAudioStatus(path.basename(p, '.m4a'));
      }
      catch (e) { console.error(`Failed to evict ${p}:`, e.message); }
    }
    return removed;
  }

  // The route's one entry point: -> { state: 'clean'|'ready'|'building'|'failed', path? }
  // 'clean'    serve the original (also every error path -- fail-open).
  // 'ready'    serve the cached rendition at .path.
  // 'building' 503 {error:'transcoding'} (same retry contract as transcodes).
  // 'failed'   a build broke; serve the original so the client shows its
  //            honest playback error instead of looping on 503s. A replaced
  //            source (new size/mtime) resets failed and re-probes.
  // The probe runs INLINE (await, ~100-300ms) rather than 503-first: every
  // Roku play carries ?compat=roku and most verdicts are 'clean', so a
  // 503-per-first-play would surface a bogus error dialog on every new video.
  async function resolveRokuCompat(item) {
    try {
      if (!ffmpegIsAvailable() || rokuCompatBlocked()) return { state: 'clean' };
      // Gate C1 (adversarial seat): renditions are MP4-FAMILY SOURCES ONLY.
      // The Roku channel picks its demuxer from the ORIGINAL extension
      // (streamFormat "mkv" for .mkv), so handing it MP4 rendition bytes for a
      // matroska source would break files that play fine today (matroska
      // attachments aren't tracks -- Roku ignores embedded art there). Both
      // confirmed broken classes (yt-dlp cover-art MP4s, rotated phone
      // recordings) are MP4-family; cover-art/rotated MKVs stay untouched, a
      // DISCLOSED limitation rather than silent breakage.
      const sourceExt = String(item.ext || '').toLowerCase();
      if (sourceExt !== '.mp4' && sourceExt !== '.m4v' && sourceExt !== '.mov') return { state: 'clean' };
      const stat = await fs.promises.stat(item.filePath);
      const renditionPath = rokuCompatRenditionPath(item.id);
      let meta = readRokuCompatSidecar(item.id);
      // Re-probe when the source moved (size/mtime) OR when the verdict RULES
      // changed since this sidecar was written (v mismatch) -- the latter
      // auto-heals a file cached 'clean' by an older, narrower rule set.
      if (!meta || meta.v !== rokuCompatLib.VERDICT_VERSION || !rokuCompatLib.signatureMatches(meta.source, stat)) {
        // Concurrent first-touch: one request probes, the rest 503-retry.
        if (rokuCompatProbing.has(item.id) || rokuCompatBusyId === item.id) return { state: 'building' };
        rokuCompatProbing.add(item.id);
        let stdout;
        try { stdout = await probeForRokuCompat(item.filePath); }
        finally { rokuCompatProbing.delete(item.id); }
        const { verdict } = rokuCompatLib.rokuCompatVerdict(stdout);
        meta = { v: rokuCompatLib.VERDICT_VERSION, source: rokuCompatLib.sourceSignature(stat), verdict, renditionReady: false, failed: false };
        // A rendition built from an OLDER source must never survive the
        // signature change -- drop it before the new verdict is persisted.
        try { fs.unlinkSync(renditionPath); } catch (_) { /* none existed */ }
        writeRokuCompatSidecar(item.id, meta);
      }
      if (meta.verdict === 'clean') return { state: 'clean' };
      if (meta.renditionReady && fs.existsSync(renditionPath)) return { state: 'ready', path: renditionPath };
      if (meta.failed) return { state: 'failed' };
      queueRokuCompatBuild(item.id, item.filePath, meta);
      return { state: 'building' };
    } catch (err) {
      console.error(`roku-compat: resolve failed for ${item.id}:`, err.message);
      return { state: 'clean' };
    }
  }

  function queueRokuCompatBuild(id, srcPath, meta) {
    if (rokuCompatBusyId === id) return;
    if (rokuCompatQueue.some(job => job.id === id)) return;
    rokuCompatQueue.push({ id, srcPath, verdict: meta.verdict, source: meta.source });
    processRokuCompatQueue();
  }

  function processRokuCompatQueue() {
    if (rokuCompatBusyId !== null || rokuCompatQueue.length === 0) return;
    const job = rokuCompatQueue.shift();
    rokuCompatBusyId = job.id;
    const renditionPath = rokuCompatRenditionPath(job.id);
    const tmpPath = `${renditionPath}.tmp.mp4`; // same suffix convention as the transcode queue -> cleanupOrphanTmp sweeps it
    const args = job.verdict === 'rotate'
      ? rokuCompatLib.buildRotateArgs(job.srcPath, tmpPath, TRANSCODE_CRF)
      : rokuCompatLib.buildStripArgs(job.srcPath, tmpPath);

    // Gate W1: Node documents that 'close' "may or may not" fire after
    // 'error' on the same spawn -- an unguarded double finish() would null
    // rokuCompatBusyId twice and kick the queue into overlapping workers.
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      if (ok) {
        try { fs.renameSync(tmpPath, renditionPath); } catch (e) { console.error(`roku-compat: finalize failed for ${job.id}:`, e.message); ok = false; }
      }
      if (!ok) { try { fs.unlinkSync(tmpPath); } catch (_) { /* nothing to clean */ } }
      // Only update the sidecar if it still describes THIS job's source -- a
      // replaced-mid-build file has already been re-probed under a new
      // signature and must not have its fresh sidecar clobbered.
      const meta = readRokuCompatSidecar(job.id);
      if (meta && rokuCompatLib.signatureMatches(job.source, meta.source)) {
        writeRokuCompatSidecar(job.id, { ...meta, renditionReady: ok, failed: !ok });
      }
      rokuCompatBusyId = null;
      if (ok) evictRokuCompatCache(renditionPath);
      processRokuCompatQueue();
    };

    let proc;
    // stdio ignored: nothing parses compat-build progress, and an unread
    // stderr pipe can fill and stall ffmpeg on chatty encodes.
    try { proc = spawn('ffmpeg', args, { stdio: 'ignore' }); }
    catch (e) { console.error(`roku-compat: spawn failed for ${job.id}:`, e.message); finish(false); return; }
    proc.on('error', (e) => { console.error(`roku-compat: ffmpeg error for ${job.id}:`, e.message); finish(false); });
    proc.on('close', (code) => {
      let ok = code === 0 && fs.existsSync(tmpPath);
      if (ok) {
        // Paranoia: the source may have been replaced while ffmpeg ran; a
        // rendition of vanished bytes must not be published under the old key.
        try { ok = rokuCompatLib.signatureMatches(job.source, fs.statSync(job.srcPath)); }
        catch (_) { ok = false; }
      }
      finish(ok);
    });
  }

  // LRU cap eviction, mirroring evictTranscodeCache's protections (in-flight
  // tmp writes, recently-served, just-produced). Sidecars are tiny and kept:
  // an evicted rendition self-heals as a probe-free rebuild on next request.
  function evictRokuCompatCache(justProducedPath) {
    let entries;
    try { entries = fs.readdirSync(ROKU_COMPAT_DIR); } catch (_) { return 0; }
    const files = [];
    for (const name of entries) {
      if (!name.endsWith('.mp4') || isInFlightTranscode(name)) continue;
      const p = path.join(ROKU_COMPAT_DIR, name);
      try {
        const st = fs.statSync(p);
        files.push({ path: p, size: st.size, atimeMs: st.atimeMs || st.mtimeMs });
      } catch (_) { /* vanished between readdir and stat */ }
    }
    const protectedPaths = activeProtectedPaths(Date.now());
    if (justProducedPath) protectedPaths.add(justProducedPath);
    let removed = 0;
    for (const p of selectEvictions(files, ROKU_COMPAT_CACHE_MAX_BYTES, protectedPaths)) {
      try { fs.unlinkSync(p); removed++; console.log(`Evicted from roku-compat cache: ${p}`); }
      catch (e) { console.error(`Failed to evict ${p}:`, e.message); }
    }
    return removed;
  }

  // Pure: given transcoded-cache files [{path, lastServedAt?, atimeMs}], return
  // the paths eligible for age-based deletion — those whose most-recently-known
  // served time is older than `now - maxAgeMs`. `lastServedAt` (a persisted,
  // FileTube-controlled timestamp) is authoritative whenever it is a number;
  // `atimeMs` is only a fallback for pre-upgrade files that predate it. This
  // keeps the age sweep immune to the atime unreliability under relatime/
  // noatime (see the `recentlyServed` comment above). Never returns a
  // *.tmp.mp4 (in-flight write) or a protected path. maxAgeMs <= 0/falsy means
  // retention is "Off" -> always [].
  function selectAgedOut(files, maxAgeMs, now, protectedPaths) {
    if (!maxAgeMs || maxAgeMs <= 0) return [];
    const keep = protectedPaths instanceof Set
      ? protectedPaths
      : new Set(protectedPaths ? [].concat(protectedPaths) : []);
    const cutoff = now - maxAgeMs;
    const agedOut = [];
    for (const f of files) {
      if (isInFlightTranscode(f.path)) continue;
      if (keep.has(f.path)) continue;
      const effective = typeof f.lastServedAt === 'number' ? f.lastServedAt : f.atimeMs;
      if (effective < cutoff) agedOut.push(f.path);
    }
    return agedOut;
  }

  // Filesystem wrapper around the pure `selectAgedOut` selector — the D3 age-
  // retention sweep. Structured like `evictTranscodeCache`, but kept as a
  // SEPARATE step (never folded in): reads the cacheMaxAgeDays setting (0/falsy
  // = "Off", in which case selectAgedOut always returns [] and nothing is
  // touched — evictTranscodeCache's size-cap LRU path stays completely
  // unaffected). Builds {path, lastServedAt, atimeMs} for every non-*.tmp.mp4
  // *.mp4 in TRANSCODE_DIR, looking up lastServedAt via
  // db.metadata[basename(path,'.mp4')].lastServedAt (falls back to atime for
  // files predating this feature). Protects the same recentlyServed-within-
  // RECENT_STREAM_MS set evictTranscodeCache builds, so a file actively being
  // watched is never aged out even if its recorded/atime age looks stale.
  // Call sites (post-produce, startup) run this immediately BEFORE
  // evictTranscodeCache — never inside it, so the frozen
  // test/unit/transcode-cache.test.js (which never invokes the age sweep)
  // keeps passing unmodified. Returns the count removed.
  function sweepAgedTranscodes(now) {
    // v1.30 A3: intentionally left on `loadDatabase()`, not switched to the
    // cache -- this is a transcode/audio-extract job-completion (or startup)
    // callback, not a request/serve-path read, and it iterates ALL of
    // `db.metadata` rather than a single lookup, so it doesn't fit either of
    // T4's explicit "beyond the 10 routes" examples (transcode-cache-cap reads,
    // srcMeta lookups). Coherency-safe either way; kept as-is (minimal diff).
    const db = loadDatabase();
    const settings = settingsStore.get(); // Wave 4: the table, read once for this sweep
    const cacheMaxAgeDays = settings.cacheMaxAgeDays;
    const maxAgeMs = cacheMaxAgeDays ? cacheMaxAgeDays * 24 * 60 * 60 * 1000 : 0;
    let entries;
    try { entries = fs.readdirSync(TRANSCODE_DIR); } catch (_) { return 0; }
    // v1.35 (preExtractAudio): same sidecar pin as evictTranscodeCache -- see
    // its comment there.
    const pinAudioSidecars = !!settings.preExtractAudio;
    // Same video-only sidecar scoping as evictTranscodeCache (music ALAC
    // renditions must stay evictable) -- see that comment.
    const pinnableVideoMeta = pinAudioSidecars ? (db.metadata || {}) : null;
    const files = [];
    for (const name of entries) {
      if (!isCompletedTranscode(name)) continue;
      if (pinAudioSidecars && name.endsWith('.m4a') && Object.prototype.hasOwnProperty.call(pinnableVideoMeta, name.slice(0, -'.m4a'.length))) continue;
      const p = path.join(TRANSCODE_DIR, name);
      try {
        const st = fs.statSync(p);
        // v1.27.0: `name` is now either `<id>.mp4` (video transcode) or
        // `<id>.m4a` (background-audio extract) -- derive the id via the
        // file's own extension rather than a hardcoded `.mp4`, so both kinds
        // resolve to the SAME db.metadata[id].lastServedAt this sweep already
        // keys off (one coherent cache, not a forked one).
        const id = path.basename(name, path.extname(name));
        const meta = db.metadata[id];
        files.push({ path: p, lastServedAt: meta && meta.lastServedAt, atimeMs: st.atimeMs || st.mtimeMs });
      } catch (_) { /* file vanished between readdir and stat; skip */ }
    }
    // Same live-watch protection evictTranscodeCache uses — a file served
    // within the recent window is never aged out either.
    const protectedPaths = activeProtectedPaths(now);
    const victims = selectAgedOut(files, maxAgeMs, now, protectedPaths);
    let removed = 0;
    for (const p of victims) {
      try {
        fs.unlinkSync(p);
        removed++;
        console.log(`Aged out of transcode cache: ${p}`);
        // F1 (two-reviewer gate, v1.27.0): mirrors evictTranscodeCache's own
        // clearAudioStatus call -- an aged-out `.m4a` sidecar must not leave a
        // stale `audioStatus: 'ready'` behind it either.
        if (p.endsWith('.m4a')) clearAudioStatus(path.basename(p, '.m4a'));
      }
      catch (e) { console.error(`Failed to remove aged-out transcode ${p}:`, e.message); }
    }
    return removed;
  }

  // Sum of st.size for every completed transcode/audio-extract (isCompletedTranscode)
  // in dir — video *.mp4 AND background-audio *.m4a (v1.27.0), one coherent
  // total. Used for the Settings "current cache size" display. try/catch so a
  // missing/unreadable dir or a file that vanished mid-scan (readdir vs stat
  // race) never throws.
  function transcodeCacheSize(dir) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch (_) { return 0; }
    let total = 0;
    for (const name of entries) {
      if (!isCompletedTranscode(name)) continue;
      try { total += fs.statSync(path.join(dir, name)).size; } catch (_) { /* vanished; skip */ }
    }
    return total;
  }

  // Resolve the effective transcode-cache byte cap: a UI-set `cacheMaxBytes`
  // (positive integer) takes precedence; otherwise fall back to the existing
  // env-var-or-5GB-default module constant, so env-only deployments keep
  // working unchanged when no UI override is persisted.
  function effectiveCacheCap(settings) {
    const uiCap = settings && settings.cacheMaxBytes;
    if (Number.isInteger(uiCap) && uiCap > 0) return uiCap;
    return TRANSCODE_CACHE_MAX_BYTES;
  }

  // The synthesis pipeline for one chapter: extract XHTML -> chunk -> synth each
  // block -> concat to m4a -> write blocks.json. Atomic .tmp->rename finalize.
  async function runChapterSynthesis({ bookId, spineIndex, key }) {
    const chapter = resolveTtsChapter(bookId, spineIndex);
    if (!chapter) {
      // The book was pruned/removed between enqueue and now. Drop the stale
      // pending row WITHOUT recreating an audio map for a gone book
      // (clearBookAudioStatus is a no-op when the map is already absent).
      booksStore.clearBookAudioStatus({ updateDatabase, booksDb }, bookId, spineIndex)
        .catch((err) => console.error(`TTS: failed to clear status for a vanished book ${bookId}/${spineIndex}:`, err && err.message));
      return { ok: false };
    }
    setTtsStatus(bookId, spineIndex, { status: 'processing', key });

    const buf = await fs.promises.readFile(chapter.book.filePath);
    const entries = booksZip.listEntries(buf);
    const xhtmlBuf = booksZip.extractEntryByName(buf, entries, chapter.spineEntry.href);
    const blocks = booksTtsChunk.chunkChapter(xhtmlBuf ? xhtmlBuf.toString('utf8') : '');

    fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
    const workDir = path.join(TTS_CACHE_DIR, `.tmp-${key}`);
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });

    try {
      const rate = ttsSettings().rate;
      const wavFiles = [];
      const blockOffsets = []; // {blockIndex, startSec} for EVERY block (incl. empty)
      let cursorSec = 0;
      for (const b of blocks) {
        // Every block gets an offset (empty ancestor-only slots point at the
        // start of the next real audio, i.e. the current cursor) so the reader's
        // blockIndex always maps to a sane startSec.
        blockOffsets.push({ blockIndex: b.blockIndex, startSec: Math.round(cursorSec * 1000) / 1000 });
        if (!b.text) continue;
        const wavPath = path.join(workDir, `b${b.blockIndex}.wav`);
        await synthesizeBlock(b.text, wavPath, rate);
        wavFiles.push(wavPath);
        cursorSec += wavDurationSec(wavPath);
      }

      if (wavFiles.length === 0) {
        // Nothing speakable in this chapter (an image-only/nav chapter) -- mark it
        // FAILED explicitly (honest "audio unavailable") rather than serving a
        // zero-length file. Without this the row would stay 'processing' forever
        // and the reader's status poll would spin (gate finding, v1.38.0). ok:false
        // means processTtsQueue does NOT chain a prefetch off this chapter.
        setTtsStatus(bookId, spineIndex, { status: 'failed', key });
        return { ok: false };
      }

      const listPath = path.join(workDir, 'concat.txt');
      fs.writeFileSync(listPath, `${wavFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n')}\n`);
      const tmpM4a = `${ttsM4aPath(key)}.tmp.m4a`;
      await runFfmpeg(booksTtsEngine.buildTtsEncodeArgs(listPath, tmpM4a));
      const durationSec = Math.round(cursorSec * 1000) / 1000;

      // A book scan may have PRUNED this book while we were synthesizing. If so,
      // finalizing here would recreate its audio row + leak cache files at a key
      // the prune already swept (gate finding, v1.38.0). Re-validate as late as
      // possible; if the book vanished, discard the temp and abort cleanly.
      if (!resolveTtsChapter(bookId, spineIndex)) {
        try { fs.unlinkSync(tmpM4a); } catch (_) { /* best-effort */ }
        return { ok: false };
      }

      // Atomic finalize: audio first, then the index -- a reader only ever asks
      // for blocks.json AFTER status is 'ready', which is written last.
      fs.renameSync(tmpM4a, ttsM4aPath(key));
      const tmpBlocks = `${ttsBlocksPath(key)}.tmp`;
      fs.writeFileSync(tmpBlocks, JSON.stringify(blockOffsets));
      fs.renameSync(tmpBlocks, ttsBlocksPath(key));

      setTtsStatus(bookId, spineIndex, { status: 'ready', key, durationSec });
      return { ok: true };
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }

  // Persist a media item's transcode status without clobbering unrelated db
  // changes. Fire-and-forget from every production call site (none of them
  // await this) -- the write is still serialized through updateDatabase, so it
  // can never race another concurrent writer. Returns the updateDatabase
  // promise (already .catch-guarded against an unhandled rejection) so tests
  // that need to observe the persisted write can await it deterministically.
  function setTranscodeStatus(id, status) {
    return updateDatabase(db => {
      const m = db.metadata[id];
      if (m && m.transcodeStatus !== status) {
        m.transcodeStatus = status;
        return true;
      }
      return false; // no-op: preserves today's "no write when unchanged" behavior
    }).catch(err => console.error('Error persisting transcode status:', err));
  }

  function processTranscodeQueue() {
    if (transcodeBusy || transcodeQueue.length === 0) return;
    const { id, srcPath } = transcodeQueue.shift();

    // Skip if the source vanished or a finished MP4 already exists.
    if (!fs.existsSync(srcPath)) { processTranscodeQueue(); return; }
    const outPath = transcodedPath(id);
    if (fs.existsSync(outPath)) { setTranscodeStatus(id, 'ready'); processTranscodeQueue(); return; }

    transcodeBusy = true;
    const tmpPath = outPath + '.tmp.mp4';
    setTranscodeStatus(id, 'processing');
    transcodeProgress[id] = 0;
    // Total duration (from the scan's ffprobe) lets us turn FFmpeg's time= into a percentage.
    // v1.30 A3: read-only lookup on the transcode hot path -- safe on the cache.
    const srcMeta = getCachedDatabase().metadata[id];
    const totalDuration = (srcMeta && srcMeta.duration) || 0;
    console.log(`Transcoding to MP4: ${srcPath}`);

    // H.264 + AAC in an MP4 with a front-loaded moov atom (+faststart) for smooth streaming.
    // ultrafast + yuv420p: fastest conversion, broadly compatible (incl. iOS Safari).
    const args = [
      '-i', srcPath,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', String(TRANSCODE_CRF), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
      '-movflags', '+faststart',
      '-y', tmpPath
    ];

    let proc;
    try {
      proc = spawn('ffmpeg', args);
    } catch (e) {
      console.error(`Failed to start FFmpeg for ${srcPath}:`, e.message);
      setTranscodeStatus(id, 'failed');
      transcodeBusy = false;
      processTranscodeQueue();
      return;
    }

    let errTail = '';
    proc.stderr.on('data', d => {
      const text = d.toString();
      errTail = (errTail + text).slice(-1500);
      // FFmpeg reports progress on stderr as "time=HH:MM:SS.xx"; convert to a percent.
      if (totalDuration > 0) {
        const m = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g);
        if (m && m.length) {
          const last = m[m.length - 1].match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
          const secs = (+last[1]) * 3600 + (+last[2]) * 60 + parseFloat(last[3]);
          transcodeProgress[id] = Math.max(0, Math.min(99, Math.round((secs / totalDuration) * 100)));
        }
      }
    });

    proc.on('error', (e) => {
      console.error(`FFmpeg error for ${srcPath}:`, e.message);
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
      delete transcodeProgress[id];
      setTranscodeStatus(id, 'failed');
      transcodeBusy = false;
      processTranscodeQueue();
    });

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(tmpPath)) {
        try {
          fs.renameSync(tmpPath, outPath); // atomic: never serve a half-written file
          setTranscodeStatus(id, 'ready');
          console.log(`Transcode ready: ${outPath}`);
          // A freshly-produced file starts with a fresh lastServedAt, so it
          // isn't immediately eligible for the age sweep.
          recordServed(id);
          // Keep the cache under its cap now that we've added a file. Runs
          // synchronously here (inside the single-worker close callback, before
          // transcodeBusy is released) so it can't race another transcode. The
          // just-produced file is protected from eviction. The age sweep runs
          // as a SEPARATE step immediately before the size-cap eviction (never
          // folded into evictTranscodeCache — see its comment above).
          try {
            sweepAgedTranscodes(Date.now());
            // v1.30 A3: transcode-cache-cap read -- safe on the cache.
            evictTranscodeCache(effectiveCacheCap(settingsStore.get()), outPath); // Wave 4
          } catch (e) { console.error('Transcode cache eviction failed:', e.message); }
        } catch (e) {
          console.error(`Failed to finalize transcode for ${srcPath}:`, e.message);
          setTranscodeStatus(id, 'failed');
        }
      } else {
        console.error(`Transcode failed (exit ${code}) for ${srcPath}:\n${errTail}`);
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
        setTranscodeStatus(id, 'failed');
      }
      delete transcodeProgress[id];
      transcodeBusy = false;
      processTranscodeQueue();
    });
  }

  // Persist a media item's background-audio extract status, mirroring
  // setTranscodeStatus's exact no-clobber/fire-and-forget contract (see its own
  // comment above) -- db.metadata[id].audioStatus: 'pending' | 'processing' |
  // 'ready' | 'failed'.
  function setAudioStatus(id, status) {
    return updateDatabase(db => {
      const m = db.metadata[id];
      if (m && m.audioStatus !== status) {
        m.audioStatus = status;
        return true;
      }
      return false;
    }).catch(err => console.error('Error persisting audio status:', err));
  }

  // F1 (two-reviewer gate, v1.27.0): deletes db.metadata[id].audioStatus
  // entirely (never leaves a stale value behind). Called from every site that
  // deletes a `.m4a` sidecar OUTSIDE the normal extract-queue lifecycle --
  // evictTranscodeCache, sweepAgedTranscodes, POST /api/cache/clear (below) --
  // so a status claiming 'ready' can never survive the file it describes being
  // removed out from under it.
  //
  // This is a DELIBERATE strengthening beyond how the video transcode cache
  // treats `transcodeStatus` on `.mp4` deletion: `reconcileTranscode`'s own
  // comment shows `transcodeStatus` is left completely untouched by
  // evictTranscodeCache/sweepAgedTranscodes/POST /api/cache/clear and is only
  // ever reconciled LAZILY, at the next full library SCAN (via a fresh
  // `fs.existsSync(transcodedPath(id))` check). Background-audio extraction
  // has no scan-time equivalent to piggyback on -- it is entirely on-demand
  // (see queueAudioExtract's own comment) -- and the request-time self-heal
  // added to GET /audio/:id and POST /api/videos/:id/prepare-audio (see their
  // comments) only fires on the NEXT request for that specific item, which
  // could be a long time coming for a rarely-revisited one. Clearing eagerly
  // here closes that staleness window immediately, at the moment the file is
  // actually deleted, rather than waiting on either a future scan (there
  // isn't one) or a future request (there might not be one soon).
  function clearAudioStatus(id) {
    return updateDatabase(db => {
      const m = db.metadata[id];
      if (m && m.audioStatus !== undefined) {
        delete m.audioStatus;
        return true;
      }
      return false;
    }).catch(err => console.error('Error clearing audio status:', err));
  }

  function processAudioExtractQueue() {
    if (audioExtractBusy || audioExtractQueue.length === 0) return;
    const { id, srcPath } = audioExtractQueue.shift();

    // Skip if the source vanished or a finished sidecar already exists.
    if (!fs.existsSync(srcPath)) { processAudioExtractQueue(); return; }
    const outPath = audioPath(id);
    if (fs.existsSync(outPath)) { setAudioStatus(id, 'ready'); processAudioExtractQueue(); return; }

    audioExtractBusy = true;
    const tmpPath = outPath + '.tmp.m4a';
    setAudioStatus(id, 'processing');
    audioExtractProgress[id] = 0;
    // v1.30 A3: read-only lookup on the transcode/audio-extract hot path -- safe on the cache.
    const srcMeta = getCachedDatabase().metadata[id];
    const totalDuration = (srcMeta && srcMeta.duration) || 0;
    console.log(`Extracting background-audio sidecar: ${srcPath}`);

    const args = buildAudioExtractArgs(srcPath, tmpPath);

    let proc;
    try {
      proc = spawn('ffmpeg', args);
    } catch (e) {
      console.error(`Failed to start FFmpeg audio extract for ${srcPath}:`, e.message);
      setAudioStatus(id, 'failed');
      audioExtractBusy = false;
      processAudioExtractQueue();
      return;
    }

    let errTail = '';
    proc.stderr.on('data', d => {
      const text = d.toString();
      errTail = (errTail + text).slice(-1500);
      // Same time=HH:MM:SS.xx progress parsing the video transcode queue uses.
      if (totalDuration > 0) {
        const m = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g);
        if (m && m.length) {
          const last = m[m.length - 1].match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
          const secs = (+last[1]) * 3600 + (+last[2]) * 60 + parseFloat(last[3]);
          audioExtractProgress[id] = Math.max(0, Math.min(99, Math.round((secs / totalDuration) * 100)));
        }
      }
    });

    proc.on('error', (e) => {
      console.error(`FFmpeg audio-extract error for ${srcPath}:`, e.message);
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
      delete audioExtractProgress[id];
      setAudioStatus(id, 'failed');
      audioExtractBusy = false;
      processAudioExtractQueue();
    });

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(tmpPath)) {
        try {
          fs.renameSync(tmpPath, outPath); // atomic: never serve a half-written file
          setAudioStatus(id, 'ready');
          console.log(`Background-audio sidecar ready: ${outPath}`);
          // A freshly-produced sidecar starts with a fresh lastServedAt, same
          // as a freshly-produced video transcode (see processTranscodeQueue).
          recordServed(id);
          try {
            sweepAgedTranscodes(Date.now());
            // v1.30 A3: transcode-cache-cap read -- safe on the cache.
            evictTranscodeCache(effectiveCacheCap(settingsStore.get()), outPath); // Wave 4
          } catch (e) { console.error('Transcode cache eviction failed:', e.message); }
        } catch (e) {
          console.error(`Failed to finalize audio extract for ${srcPath}:`, e.message);
          setAudioStatus(id, 'failed');
        }
      } else {
        console.error(`Audio extract failed (exit ${code}) for ${srcPath}:\n${errTail}`);
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
        setAudioStatus(id, 'failed');
      }
      delete audioExtractProgress[id];
      audioExtractBusy = false;
      processAudioExtractQueue();
    });
  }

  // Keep an item's transcode flag/status accurate WITHOUT pre-transcoding on scan.
  // Transcoding is now lazy — kicked off on demand when a mobile client requests playback
  // (see /video/:id). This avoids converting the entire library up front (huge disk cost).
  // Mutates the item in place; returns true if the status changed.
  function reconcileTranscode(item) {
    if (!item || item.type === 'audio') {
      if (item && item.transcodeStatus !== undefined) { delete item.transcodeStatus; return true; }
      return false;
    }
    const before = item.transcodeStatus;
    // FR-1b (v1.18.0): the authoritative recompute -- runs after the scan's
    // probe has attached `videoCodec`/`audioCodec` to the item, so a nominally
    // web-safe container with a non-allowlisted codec (HEVC, VP9, AC-3, ...)
    // gets flagged here even though the scan-time seed (ext-only, codecs aren't
    // known yet at that point) did not.
    item.needsTranscode = needsTranscode(item.ext, item.videoCodec, item.audioCodec);
    if (!item.needsTranscode) {
      if (item.transcodeStatus !== undefined) { delete item.transcodeStatus; return true; }
      return false;
    }
    if (fs.existsSync(transcodedPath(item.id))) {
      // Cached MP4 present → ready.
      if (item.transcodeStatus !== 'ready') { item.transcodeStatus = 'ready'; return true; }
      return false;
    }
    // No cached MP4. Clear a stale 'ready'; leave in-flight (pending/processing/failed) alone.
    if (item.transcodeStatus === 'ready') { delete item.transcodeStatus; return true; }
    return before !== item.transcodeStatus;
  }

  return {
    transcodedPath,
    isInFlightTranscode,
    selectEvictions,
    isCompletedTranscode,
    activeProtectedPaths,
    evictTranscodeCache,
    rokuCompatBlocked,
    resolveRokuCompat,
    queueRokuCompatBuild,
    processRokuCompatQueue,
    evictRokuCompatCache,
    selectAgedOut,
    sweepAgedTranscodes,
    transcodeCacheSize,
    effectiveCacheCap,
    runChapterSynthesis,
    setTranscodeStatus,
    processTranscodeQueue,
    setAudioStatus,
    clearAudioStatus,
    processAudioExtractQueue,
    reconcileTranscode,
  };
}

module.exports = { createTranscodeQueues };
