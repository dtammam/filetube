const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec, execFile, spawn } = require('child_process');
const mime = require('mime-types');
require('dotenv').config();

// Optional yt-dlp subscription module (v1.11.0): dormant by default.
// Requiring it has NO side effects -- it only defines functions; every side
// effect it can cause (route registration, timer arming) is gated behind
// `isEnabled(config)` inside the functions themselves. See
// lib/ytdlp/index.js for the dormant-wiring mechanism.
const ytdlp = require('./lib/ytdlp');
// v1.28.0 (two-reviewer gate follow-up, F1): shared body-parser-error ->
// JSON-response mapping, also required directly by lib/ytdlp/index.js for
// its own route-scoped `express.text()` error middleware -- see that
// module's own doc comment for why this is a shared FUNCTION rather than a
// shared middleware instance.
const { formatBodyParserError } = require('./lib/bodyParserErrors');
// T4 (v1.25 QoL): `resolveChannelDir` is a pure, side-effect-free path helper
// (see lib/ytdlp/args.js's own header comment) that `lib/ytdlp/index.js`
// itself already requires internally but does not re-export -- required
// directly here, exactly the same "no side effects at require time" posture
// as the `ytdlp` require above, so the one-time migration pass (below) can
// resolve a captured channel's confined target folder the identical way
// every other channel-dir consumer (subscriptions, one-shot downloads) does.
const ytdlpArgs = require('./lib/ytdlp/args');
// Metadata+subtitle re-pull backfill (v1.25 QoL follow-up): `buildWatchUrl` is
// a pure, side-effect-free helper (lib/ytdlp/url.js's own module comment) that
// `lib/ytdlp/index.js` already requires internally but does not re-export --
// required directly here, the exact same posture as `ytdlpArgs` above, so
// `enumerateRepullableItems` (below) can turn a recovered yt-dlp video id back
// into a canonical watch URL for the re-pull job to fetch.
// v1.33 T1/T2: `classifySingleVideo` turns an embedded `purl`/`comment` tag's
// URL into a validated {videoId, watchUrl} (the ONLY id source for a
// bracket-less metube-era filename); `isSafeVideoId` guards the persisted
// `youtubeId` field on both write paths -- same direct-require posture as
// `buildWatchUrl` below.
const { buildWatchUrl, classifySingleVideo, isSafeVideoId } = require('./lib/ytdlp/url');
// v1.15.1 hotfix: pure predicate for yt-dlp's own intermediate/partial-
// download artifacts (merge temps, per-format fragments, `.part`/`.ytdl`
// markers) left in its download dir mid-download or after a killed/failed
// download -- see lib/ytdlpIntermediates.js's module comment for why this
// is a standalone LEAF module rather than something scanDirRecursive (below)
// defines locally: lib/ytdlp/index.js's own best-effort post-failure cleanup
// needs the exact same predicate, and a leaf module lets both sides
// `require()` it directly without any circular dependency.
const { isYtdlpIntermediate } = require('./lib/ytdlpIntermediates');
// C4 "fun stats" page (v1.24 UX Round, Wave 3): pure aggregation helpers over
// `db.metadata`, unit-tested on their own against a synthetic fixture. See
// lib/stats.js's header comment and `GET /api/stats` below for the full
// live-compute rationale.
const stats = require('./lib/stats');
// A6 subtitles (v1.24 UX Round, Wave 5): pure srtToVtt + findSubtitleSidecar,
// shared by the scan's additive `hasSubtitles` detection below and
// `GET /api/subtitles/:id` -- see lib/subtitles.js's header comment.
const subtitles = require('./lib/subtitles');
// v1.30 A5 (T6): pure sort comparators + format/search predicates +
// pagination-parameter normalizers shared with the client's own
// sortItems/filterByMediaType -- see lib/videoQuery.js's header comment and
// `GET /api/videos` below for the paginated, server-authoritative pipeline.
const videoQuery = require('./lib/videoQuery');

const app = express();
const PORT = process.env.PORT || 3000;

// Dynamic data directory for Docker volume persistence
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : (fs.existsSync('/app/data') ? '/app/data' : __dirname);
const DB_FILE = path.join(DATA_DIR, 'db.json');
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');

// Resolve the transcode cache directory: `TRANSCODE_DIR` env override (resolved
// to an absolute path) takes precedence; otherwise default to `<dataDir>/
// transcoded` (unchanged default). Pure/testable — takes `env`/`dataDir`
// explicitly instead of reading `process.env`/`DATA_DIR` directly, mirroring
// the `parseCacheCap`-style env-parsing convention used elsewhere in this file.
function resolveTranscodeDir(env, dataDir) {
  const raw = env && env.TRANSCODE_DIR;
  return raw ? path.resolve(raw) : path.join(dataDir, 'transcoded');
}
// Browser-incompatible containers (e.g. AVI) are pre-transcoded to MP4 here on scan.
const TRANSCODE_DIR = resolveTranscodeDir(process.env, DATA_DIR);

// Create directories if they don't exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(THUMBNAIL_DIR)) {
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
}
if (!fs.existsSync(TRANSCODE_DIR)) {
  fs.mkdirSync(TRANSCODE_DIR, { recursive: true });
}
// Writability guard (AC7.4): a custom TRANSCODE_DIR (e.g. external/NFS
// storage) that exists but isn't writable must degrade gracefully (log
// clearly; per-file transcode failures are already handled) rather than
// crash the whole process at boot.
try {
  fs.accessSync(TRANSCODE_DIR, fs.constants.W_OK);
} catch (e) {
  console.error(`Transcode cache directory is not writable: ${TRANSCODE_DIR} (${e.message}). On-demand transcoding will fail until this is fixed.`);
}

// Default automation/cache-housekeeping settings. `0` means "Off" for
// scanIntervalMinutes/cacheMaxAgeDays; `cacheMaxBytes: null` defers to the
// env var / built-in default rather than a UI-set override. `defaultView`
// (v1.14.0 item 4) is the folder path/key to render on a bare home load
// (the SAME identity as a `folderSettings` key / `item.rootFolder` / the
// `?root=` param); `''` is the sentinel for "Most Recent" (today's default
// behavior, applied whenever this is unset, empty, or the stored folder no
// longer exists).
const DEFAULT_SETTINGS = {
  scanIntervalMinutes: 30,
  pruneMissing: true,
  cacheMaxBytes: null,
  cacheMaxAgeDays: 30,
  defaultView: '',
  // v1.16.0 FR-3 (T3): auto-plays the next video (per the client's
  // deriveOrderedIds/computeNeighbors, common.js) on the player's 'ended'
  // event. OFF by default -- mirrors defaultView's pattern exactly (see
  // settingsResponse/KNOWN_KEYS/the POST validation branch below).
  autoplayNext: false,
  // v1.27.0 (EXPERIMENTAL): on iOS, backgrounding the app suspends an inline
  // (non-fullscreen) mobile VIDEO. When ON, a playing inline mobile video
  // hands off to a hidden <audio> element playing an audio-only extraction
  // of the same item while backgrounded, then swaps back on foreground --
  // YouTube-Premium-style background audio. OFF by default -- mirrors
  // autoplayNext's own pattern exactly (see settingsResponse/KNOWN_KEYS/the
  // POST validation branch below). Desktop and audio-type items are
  // completely unaffected (see public/js/player.js's handoff gating).
  backgroundAudioForVideo: false
};

// Per-key merge so a partial/older `settings` object keeps whatever keys it
// already has and only gets the missing ones defaulted (mirrors the
// `folderSettings` backfill pattern below).
function withDefaultSettings(settings) {
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

// Module-level `loadDatabase` call counter (v1.30 A3, AC3.3 instrumentation):
// every `loadDatabase()` call anywhere in this file increments it, including
// the one-time populate inside `getCachedDatabase()` (below the DB layer) and
// the fresh-read-inside-the-lock in `updateDatabase`. See
// `__getLoadDatabaseCallCount()` (test accessor, mirrors `currentScanTimer`'s
// own test-observability style, exported near the bottom of this file) for
// how tests read it back out.
let loadDatabaseCallCount = 0;

// Ensure database file exists
function loadDatabase() {
  loadDatabaseCallCount++;
  if (!fs.existsSync(DB_FILE)) {
    const initialDb = {
      folders: [],
      folderSettings: {},
      progress: {},
      metadata: {},
      // v1.30 C2: liked-item membership (array of media ids) -- the SINGLE
      // source of truth for "liked" state (no separate boolean flag anywhere).
      liked: [],
      settings: withDefaultSettings()
    };
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2), 'utf8');
    } catch (err) {
      // An EACCES/ENOSPC etc. here must never throw OUTSIDE a try/catch (this
      // call site predates updateDatabase/saveDatabase's error handling). Log
      // and hand back the in-memory default regardless -- the caller can still
      // operate against it, and the next successful saveDatabase persists it.
      console.error('Error creating initial db.json:', err);
    }
    return initialDb;
  }
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    const db = JSON.parse(data);
    // Backfill EVERY top-level key (not just folderSettings/settings) so a
    // valid-JSON but partial/legacy db.json (hand-edited, or written by an
    // older version) can never make a mutator throw a TypeError against a
    // missing `folders`/`progress`/`metadata`.
    if (!Array.isArray(db.folders)) db.folders = [];
    if (!db.folderSettings || typeof db.folderSettings !== 'object') db.folderSettings = {}; // backfill for older databases
    if (!db.progress || typeof db.progress !== 'object') db.progress = {};
    if (!db.metadata || typeof db.metadata !== 'object') db.metadata = {};
    // v1.30 C2: backfill `liked` (array of media ids) for a legacy/partial
    // db.json the same way every other top-level key above is backfilled.
    if (!Array.isArray(db.liked)) db.liked = [];
    db.settings = withDefaultSettings(db.settings); // backfill for older databases
    return db;
  } catch (err) {
    console.error('Error reading db.json, resetting database:', err);
    // Every code path out of loadDatabase must hand back a settings-bearing DB.
    return { folders: [], folderSettings: {}, progress: {}, metadata: {}, liked: [], settings: withDefaultSettings() };
  }
}

// Monotonic counter (per-process) that, combined with the pid, guarantees a
// unique same-directory temp filename per save -- see saveDatabase below.
let dbTmpSeq = 0;

// Module-level `saveDatabase` call counter (v1.30 A4, AC4.1/AC4.2
// instrumentation): every `saveDatabase()` call anywhere in this file
// increments it (mirrors `loadDatabaseCallCount`'s own placement/pattern,
// above `loadDatabase`), regardless of whether the write itself ultimately
// succeeds or throws -- this is a CALL count (attempts), not a success
// count, exactly like its `loadDatabase` counterpart. AC4.1 asserts this
// grows far slower than the progress-ping count during a batched burst;
// AC4.2 asserts it grows exactly 1:1 with each real-mutation invocation
// (DELETE /api/videos/:id, POST /api/config, POST /api/settings, the scan's
// final merge -- every one of which still calls `updateDatabase` directly,
// unbatched). See `__getSaveDatabaseCallCount()` below.
let saveDatabaseCallCount = 0;

// Atomic on-disk save: write-temp-then-rename, mirroring the existing
// ".tmp.mp4" atomic-finalize pattern already used for transcodes. The temp
// file lives in the SAME directory as DB_FILE so `renameSync` is an atomic
// metadata-only operation on POSIX filesystems (a cross-filesystem rename
// would silently become a copy, which is not atomic). `fsync`ing the fd
// before the rename flushes the bytes to disk first, so a crash either
// leaves the OLD db.json fully intact (crash before rename) or the NEW one
// fully intact (crash after) -- never a half-written/truncated file.
//
// Durability note: this guards against PROCESS crashes (this app's threat
// model per RELIABILITY.md), not power loss -- the rename is not followed by
// a fsync of DATA_DIR itself, so a power-loss right at/after the rename can,
// on some filesystems, REVERT to the old db.json on next mount. It can never
// leave a torn/half-written file either way.
//
// On a write/rename failure this call's own temp file is cleaned up on a
// best-effort basis, the original DB_FILE is left untouched, and the error
// is RETHROWN so the caller (updateDatabase) REJECTS instead of silently
// resolving a false success. The best-effort cleanup can itself not run at
// all (e.g. the process is SIGKILLed/OOM-killed between openSync and the
// rename) and leave an orphan `db.json.<pid>.<seq>.tmp` behind -- the
// startup sweep (cleanupOrphanDbTmp, mirroring cleanupOrphanTmp for
// transcodes) reclaims those on the next boot. Stays SYNCHRONOUS on purpose:
// the mutate-then-save critical section inside updateDatabase (below) must
// complete in a single tick.
//
// v1.30 A3 (in-memory DB read cache): on a SUCCESSFUL save, `db` (the
// just-written object) BECOMES the read cache -- set here, immediately after
// the atomic rename, with no `await` in between (this whole function is
// synchronous). `saveDatabase` is the SOLE writer of `dbCache`; every real
// caller today reaches it exclusively through `updateDatabase`'s
// fresh-read-inside-the-lock (see that function's own comment), so this is
// still "one write's critical section, one cache-set" -- just located here
// instead of duplicated at every call site. See the coherency argument above
// `dbCache`'s own declaration for why this can never produce a torn/stale
// read. On a FAILED save (the catch branch below, which rethrows) the cache
// is deliberately left untouched -- an unpersisted `db` must never become
// the cache.
function saveDatabase(db) {
  saveDatabaseCallCount++;
  const tmp = `${DB_FILE}.${process.pid}.${dbTmpSeq++}.tmp`;
  try {
    const json = JSON.stringify(db, null, 2);
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, json, 'utf8');
      fs.fsyncSync(fd); // flush bytes to disk before the rename gate
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, DB_FILE); // atomic within DATA_DIR's filesystem
    dbCache = db;
    dbCacheValid = true;
  } catch (err) {
    console.error('Error saving db.json:', err);
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp); // best-effort cleanup for THIS call's temp
    } catch (cleanupErr) {
      console.error('Error cleaning up temp db file:', cleanupErr);
    }
    throw err; // PROPAGATE: caller (updateDatabase) must reject, never a false success
  }
}

// v1.30 A3: the in-memory DB read cache's own state -- declared here (right
// before its first writer, `saveDatabase`, above) rather than down by
// `getCachedDatabase()` itself; see that function (below `updateDatabase`)
// for the full coherency argument these two variables underpin.
let dbCache = null;
let dbCacheValid = false;

// ---- Serialized read-modify-write persistence ----------------------------
// Every db.json writer routes through this single in-process async-mutex
// (a promise chain) instead of its own loadDatabase/mutate/saveDatabase
// round trip. Per call: wait for every previously-enqueued write to finish,
// THEN load a FRESH db from disk, apply the mutator, and (unless it returns
// `false`) save atomically. Because the read, mutate, and save all happen
// inside one serialized step, no two writers can ever race a
// read-modify-write against each other -- whichever call reaches the front
// of the chain always sees every previously-committed write, closing the
// read-modify-write clobber class structurally rather than finding-by-finding.
//
// Contract:
//   - `mutatorFn` MUST be SYNCHRONOUS (no `await` inside it) -- the lock is
//     never held across an await, so the mutex chain always settles and
//     parallel `node:test` runs can never deadlock or hang.
//   - `mutatorFn` MUST NOT call `updateDatabase` re-entrantly (non-reentrant).
//   - Return `false` from the mutator to skip the save (no-op/guard paths,
//     e.g. "nothing actually changed" or "the target doesn't exist"). Any
//     other return value is handed back to the caller's awaited promise.
//   - A throwing mutator rejects ONLY that call's promise; the chain is kept
//     alive past the failure (`run.catch(() => {})`) so the NEXT queued
//     write still proceeds -- one failure can never wedge all future writes.
let dbWriteChain = Promise.resolve();
function updateDatabase(mutatorFn) {
  const run = dbWriteChain.then(() => {
    const db = loadDatabase();             // fresh read INSIDE the lock
    const result = mutatorFn(db);          // synchronous mutate
    // A skipped save (result === false, e.g. a no-op/guard branch) leaves
    // the existing cache untouched: `saveDatabase` (and its cache-set, see
    // its own comment above) is simply never called on this branch.
    if (result !== false) saveDatabase(db); // atomic write-temp-then-rename + cache-set
    return result;
  });
  dbWriteChain = run.catch(() => {}); // keep the chain alive past a failure
  return run;
}

// ---- In-memory DB read cache (v1.30 A3, AC3.3) ----------------------------
// A read-through cache in front of `updateDatabase`'s mutex, so hot GET
// readers stop paying a `readFileSync` + `JSON.parse` of the whole db.json
// per request. `saveDatabase` (above) is the ONLY writer of `dbCache`;
// readers never mutate it.
//
// Coherency argument (why this can never serve a torn/stale read):
//   1. Every writer is serialized through the single `updateDatabase` promise
//      chain (`dbWriteChain`) -- each write's load-mutate-save-cache-set runs
//      as one synchronous tick, never interleaved with another writer's tick.
//   2. Node is single-threaded: a synchronous reader (every route below runs
//      its handler synchronously up to `res.json`/`res.send`) always
//      completes entirely BEFORE or entirely AFTER any given write's tick --
//      it can never observe a write mid-flight.
//   3. This process is the ONLY writer of `db.json` (single-node,
//      single-process -- see ARCHITECTURE.md), so nothing outside this
//      process can make the cache silently drift from disk between writes.
//      (Test suites that seed `db.json` directly should go through the
//      exported `saveDatabase()` -- already an established test primitive,
//      see `CONTRIBUTING.md` -- rather than a raw `fs.writeFileSync`, so
//      this invariant holds in-process during tests too.)
//   4. The cached object is REPLACED BY REFERENCE on every successful write,
//      never mutated in place by a reader or by a mutator (mutators operate
//      on the freshly-loaded disk copy from step 1 above, which THEN becomes
//      the cache) -- so a reader holding a reference to a prior snapshot
//      stays internally consistent for the lifetime of its own request, even
//      if a write commits and replaces `dbCache` with a new object the
//      instant after the reader captured its local reference.
// Together, these mean every read via `getCachedDatabase()` is either the
// current on-disk state or a state that WAS the current on-disk state an
// instant ago -- exactly what `loadDatabase()` itself would have returned had
// it been called at that same point in the event loop, just without paying
// the disk I/O + JSON.parse cost on every request.

// Test-observability accessor (mirrors `currentScanTimer`'s own pattern):
// exposes the current `loadDatabase` call count without reaching into module
// internals, so AC3.3's "N sequential requests -> O(1) loads, not N" claim is
// directly assertable rather than inferred from timing/behavior alone.
function __getLoadDatabaseCallCount() {
  return loadDatabaseCallCount;
}

// Test-observability accessor for the `saveDatabase` write-count instrumentation
// declared above `dbTmpSeq` -- mirrors `__getLoadDatabaseCallCount()` immediately
// above. See its own comment for what it counts and why (AC4.1/AC4.2).
function __getSaveDatabaseCallCount() {
  return saveDatabaseCallCount;
}

// If the cache is valid, hand back the cached parsed object (no disk I/O);
// otherwise populate it via ONE `loadDatabase()` call, mark it valid, and
// return it. Every hot GET reader below calls this instead of `loadDatabase()`
// directly -- see the coherency argument above `dbCache` for why this is
// always safe.
function getCachedDatabase() {
  if (!dbCacheValid) {
    dbCache = loadDatabase();
    dbCacheValid = true;
  }
  return dbCache;
}

// ---- Progress-write coalescer (v1.30 A4, AC4.1-AC4.3) ----------------------
// `POST /api/progress` pings arrive far more often (roughly every 4s while a
// video plays) than any other mutation, and a lost/stale WATCH POSITION is a
// much cheaper thing to risk than a lost/stale metadata/folder/settings
// write -- so this is the ONLY write path allowed to relax the
// "atomic write+fsync every call" contract every other mutator keeps by
// calling `updateDatabase` directly. `pendingProgress` is a staging area: a
// ping is recorded here and the request returns immediately; a single
// debounce timer covers the whole batch window, so N pings (against the
// same or different ids) inside one window collapse into ONE whole-file
// atomic write (AC4.1). Nothing else ever routes through this Map --
// `DELETE /api/videos/:id`, `POST /api/config`, `POST /api/settings`, and
// the scan's final merge all still call `updateDatabase` directly, exactly
// once per invocation (AC4.2); see each of their own call sites, unchanged
// by this section.
const pendingProgress = new Map();

// Batch window in ms -- the production default (5000) matches the design's
// tunable bound (a realistic ~4s ping cadence needs a >=5s window for a
// >=5:1 write reduction). Overridable via `PROGRESS_FLUSH_MS` (mirrors
// `TRANSCODE_CACHE_MAX_BYTES`/`TRANSCODE_CRF`'s own env-tunable pattern
// above) purely so tests can shrink the window and exercise the REAL timer
// on a fast, deterministic cadence instead of sleeping for the production
// default.
function parseProgressFlushMs(raw) {
  if (raw === undefined || raw === null || raw === '') return 5000;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return 5000;
  return n;
}
const PROGRESS_FLUSH_MS = parseProgressFlushMs(process.env.PROGRESS_FLUSH_MS);

// The single in-flight debounce timer (or null when nothing is armed).
// `.unref()`'d exactly like `scanTimer`/`deferredRescanTimer` elsewhere in
// this file, so an armed timer never keeps the process -- or a test runner
// that never triggers a flush -- alive.
let progressFlushTimer = null;

// Test-observability accessor -- mirrors `currentScanTimer()`'s own pattern,
// so a test can assert a timer was (or wasn't) armed by a given ping.
function currentProgressFlushTimer() {
  return progressFlushTimer;
}

// Snapshot-and-clear every queued ping, then persist the whole batch as ONE
// atomic `updateDatabase` write -- covers the full window in a single
// write+fsync no matter how many ids/pings it holds. The
// `if (db.metadata[id])` guard drops an id that was deleted (via
// `DELETE /api/videos/:id`) between its ping and this flush, so a flush can
// never resurrect a metadata entry the operator already removed. A no-op
// (nothing pending -- e.g. the shutdown handler firing with an empty batch)
// skips `updateDatabase` entirely, never an empty write. Shared by the
// debounce timer (`armProgressFlushTimerIfNeeded`, below) AND the shutdown
// handlers (registered under `require.main === module`, near
// `app.listen`), and directly exported so tests can trigger a flush
// deterministically instead of waiting out `PROGRESS_FLUSH_MS`.
function flushPendingProgress() {
  if (progressFlushTimer) {
    clearTimeout(progressFlushTimer);
    progressFlushTimer = null;
  }
  if (pendingProgress.size === 0) return Promise.resolve(false);
  const snapshot = new Map(pendingProgress);
  pendingProgress.clear();
  return updateDatabase(db => {
    for (const [id, value] of snapshot) {
      if (db.metadata[id]) db.progress[id] = value;
    }
    return true;
  }).catch(err => {
    // A failed flush must never crash the process or wedge a future flush --
    // `updateDatabase`'s own chain already survives a rejected mutator/save
    // (see its comment above); this just logs so the failure stays visible.
    // The lost pings are already cleared from `pendingProgress` above, which
    // is the same bounded "at most one window" loss AC4.3 already accepts
    // for a hard crash -- a persistence failure here is not a WORSE outcome.
    console.error('Error flushing batched watch progress:', err);
  });
}

// Arms the single debounce timer if one isn't already running -- a second
// (or third, ...) ping inside the same window is just another `Map.set`
// against the already-armed timer, never a second timer.
function armProgressFlushTimerIfNeeded() {
  if (progressFlushTimer) return;
  progressFlushTimer = setTimeout(flushPendingProgress, PROGRESS_FLUSH_MS);
  progressFlushTimer.unref();
}

// Read-your-writes overlay (keeps A3's "cache is never mutated in place"
// invariant intact): a just-posted, not-yet-flushed position lives ONLY in
// `pendingProgress` until the next flush commits it into `db.progress` -- so
// every progress READER checks the overlay first, making a client's own
// just-saved position visible immediately without ever writing into the
// shared `getCachedDatabase()` object. Falls through to the cache's
// (as-of-last-flush) value when nothing is pending for `id`.
function effectiveProgress(id) {
  return pendingProgress.get(id) ?? getCachedDatabase().progress[id];
}

// Media extensions
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];
const ALL_EXTENSIONS = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS];

// Containers browsers can't decode natively — pre-transcoded to MP4 on scan.
// (Extend this list if other formats fail to play in the browser.)
const TRANSCODE_EXTENSIONS = ['.avi', '.flv', '.wmv', '.mpg', '.mpeg'];

// FR-1b (v1.18.0): extension-OR-codec. `videoCodec`/`audioCodec` are OPTIONAL
// (undefined for every pre-v1.18 call site) so single-arg callers get the
// exact byte-identical extension-only result they always have -- see
// `codecNeedsTranscode` (next to `parseFfprobeStreams`, below) for the
// codec-allowlist half of this check.
function needsTranscode(ext, videoCodec, audioCodec) {
  if (TRANSCODE_EXTENSIONS.includes(ext)) return true;
  return codecNeedsTranscode(videoCodec, audioCodec);
}
function transcodedPath(id) {
  return path.join(TRANSCODE_DIR, `${id}.mp4`);
}

// v1.27.0 (background-audio-for-video, EXPERIMENTAL): sits right next to
// transcodedPath -- same TRANSCODE_DIR, same id-keyed naming convention,
// just a different extension/purpose (an audio-only extraction of a VIDEO
// item, used for the mobile background-audio handoff; see
// queueAudioExtract/GET /audio/:id below). Deliberately NOT a second cache
// directory: every cache-lifecycle predicate below (isCompletedTranscode,
// selectEvictions/selectAgedOut via their .tmp-suffix checks,
// cleanupOrphanTmp, transcodeCacheSize) is widened to also recognize `.m4a`
// so this rides the SAME size-cap/age-sweep/live-watch-protection machinery
// as the video transcode cache -- one coherent cache, not a forked one.
function audioPath(id) {
  return path.join(TRANSCODE_DIR, `${id}.m4a`);
}

// ---- Transcode cache hygiene (size-capped LRU eviction + orphan cleanup) ----
// The transcoded MP4 cache in TRANSCODE_DIR would otherwise grow unbounded as
// AVI-class files get watched. We keep it under a cap, evicting least-recently-
// used files (by access time), and clean up orphaned *.tmp.mp4 on startup.
const DEFAULT_CACHE_MAX_BYTES = 5 * 1024 ** 3; // 5 GB

// Parse the cap from an env value; fall back to the default on anything invalid
// (unset, empty, non-integer, <= 0) so a bad TRANSCODE_CACHE_MAX_BYTES can never
// crash startup.
function parseCacheCap(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_CACHE_MAX_BYTES;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_CACHE_MAX_BYTES;
  return n;
}
const TRANSCODE_CACHE_MAX_BYTES = parseCacheCap(process.env.TRANSCODE_CACHE_MAX_BYTES);

// ---- Opt-in higher CRF (item 7, v1.15.0) ----
// x264 CRF: lower = higher quality/larger files, higher = smaller files/lower
// quality. Default (23) is unchanged for everyone who doesn't opt in.
const DEFAULT_CRF = 23;
const MIN_CRF = 1;
const MAX_CRF = 51; // x264's valid CRF range

// Parse TRANSCODE_CRF from an env value; fall back to the default (with a
// logged warning) on anything invalid (unset, empty, non-integer, out of the
// x264 [1, 51] range) so a bad env value can never crash startup or produce a
// degenerate encode.
function parseCrf(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_CRF;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_CRF || n > MAX_CRF) {
    console.warn(`Invalid TRANSCODE_CRF value "${raw}" -- falling back to the default CRF (${DEFAULT_CRF}).`);
    return DEFAULT_CRF;
  }
  return n;
}
const TRANSCODE_CRF = parseCrf(process.env.TRANSCODE_CRF);

// True for an in-flight (not-yet-finalized) write in TRANSCODE_DIR, either
// kind: a pre-transcoded video (`*.tmp.mp4`) or a background-audio extract
// (`*.tmp.m4a`, v1.27.0). Shared by every predicate below that must never
// touch/delete/count an in-progress write, so the two kinds can't drift.
function isInFlightTranscode(p) {
  return p.endsWith('.tmp.mp4') || p.endsWith('.tmp.m4a');
}

// Pure: given files [{path, size, atimeMs}], return the paths to delete so the
// total size drops to <= maxBytes. Never returns an in-flight write
// (*.tmp.mp4/*.tmp.m4a — see isInFlightTranscode) or keepPath (the
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

// Delete orphaned *.tmp.mp4/*.tmp.m4a files (left if a transcode or
// background-audio extract process was killed mid-write). Returns the count
// removed. Safe to call on startup.
function cleanupOrphanTmp(dir) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch (_) { return 0; }
  let removed = 0;
  for (const name of entries) {
    if (!isInFlightTranscode(name)) continue;
    try { fs.unlinkSync(path.join(dir, name)); removed++; }
    catch (e) { console.error(`Failed to remove orphan tmp ${name}:`, e.message); }
  }
  return removed;
}

// Delete orphaned `db.json.<pid>.<seq>.tmp` files (left if the process was
// SIGKILLed/OOM-killed between saveDatabase's openSync(tmp) and its rename --
// see saveDatabase's comment). Mirrors cleanupOrphanTmp's shape/contract
// exactly; the original DB_FILE is never touched. Returns the count removed.
// Safe to call on startup.
function cleanupOrphanDbTmp(dir) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch (_) { return 0; }
  const prefix = `${path.basename(DB_FILE)}.`;
  let removed = 0;
  for (const name of entries) {
    if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue;
    try { fs.unlinkSync(path.join(dir, name)); removed++; }
    catch (e) { console.error(`Failed to remove orphan db temp ${name}:`, e.message); }
  }
  return removed;
}

// Transcodes served to a client recently (path -> last-served epoch ms).
// Eviction never deletes a file served within RECENT_STREAM_MS, so a file a user
// is actively watching can't be pulled out from under them. This is the real
// protection against the eviction-vs-stream race — it does NOT rely on atime,
// which is unreliable under Linux relatime/noatime.
const recentlyServed = new Map();
const RECENT_STREAM_MS = 10 * 60 * 1000; // 10 minutes
function markServed(p) { recentlyServed.set(p, Date.now()); }

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
  const files = [];
  for (const name of entries) {
    if (!isCompletedTranscode(name)) continue;
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

// Valid "scan every N minutes" choices for the Settings UI (0 = Off / manual
// "Scan now" only). Anything not in this set (missing, unrecognized, negative)
// falls back to the 30-minute default rather than silently doing nothing.
const SCAN_INTERVAL_MINUTE_OPTIONS = new Set([30, 60, 360, 720, 1440]);
const DEFAULT_SCAN_INTERVAL_MINUTES = 30;

// Map a persisted `scanIntervalMinutes` preference to milliseconds for
// setInterval. 0 -> null (Off, no periodic scan). Anything unrecognized falls
// back to the 30-minute default so a corrupt/old value can never disable
// scanning silently.
function scanIntervalMs(minutes) {
  if (minutes === 0) return null;
  if (SCAN_INTERVAL_MINUTE_OPTIONS.has(minutes)) return minutes * 60000;
  return DEFAULT_SCAN_INTERVAL_MINUTES * 60000;
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
// SEPARATE step (never folded in): reads db.settings.cacheMaxAgeDays (0/falsy
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
  const cacheMaxAgeDays = db.settings && db.settings.cacheMaxAgeDays;
  const maxAgeMs = cacheMaxAgeDays ? cacheMaxAgeDays * 24 * 60 * 60 * 1000 : 0;
  let entries;
  try { entries = fs.readdirSync(TRANSCODE_DIR); } catch (_) { return 0; }
  const files = [];
  for (const name of entries) {
    if (!isCompletedTranscode(name)) continue;
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

// Generate deterministic ID from filepath
function getMediaId(filePath) {
  return crypto.createHash('md5').update(filePath).digest('hex');
}

// FR-F bug fix (v1.12.0, yt-dlp module parity): the optional yt-dlp module
// downloads with `--restrict-filenames` (SF4, kept intact -- NOT removed by
// this fix), which produces names shaped
// `Title_With_Underscores [<11-char id>].ext`. Before this fix the title
// shown in the UI was that raw, underscored, id-suffixed basename verbatim
// (`path.basename(info.name, info.ext)` below). This helper strips a
// trailing bracketed id and turns remaining underscores into spaces --
// display-only, applied at title derivation (scan time), never touching
// `info.name`/`filePath`/`getMediaId` (which hashes the PATH, not this
// derived title -- no id churn, no db migration needed).
//
// Tightly scoped so ordinary, non-yt-dlp library files are never rewritten:
// it only fires when the basename ends in a space-or-underscore followed by
// a bracketed token that is EXACTLY 11 characters of `[A-Za-z0-9_-]` -- the
// exact shape of a YouTube video id, which is also what `--restrict-filenames`
// preserves verbatim inside the brackets. Anything else -- no bracket at all
// (`My_Home_Movie`), or a bracket whose content isn't exactly 11 id-shaped
// characters (`Something [notanid]`, `Movie [2024]`, `Song [Remix]`) -- is
// returned completely UNCHANGED.
function cleanDisplayTitle(baseName) {
  const m = /^(.*?)[ _]\[[A-Za-z0-9_-]{11}\]$/.exec(baseName);
  if (!m) return baseName; // not a yt-dlp-shaped name -> untouched
  // Collapse a run of underscores (restrict-filenames can emit consecutive
  // underscores for consecutive non-ASCII/special characters) to a single
  // space, rather than leaving a double space per run.
  return m[1].replace(/_+/g, ' ').trim();
}

// v1.20.0 FR-2: sibling to cleanDisplayTitle, above -- extracts the yt-dlp
// video id from the SAME trailing ` [<11-char id>]` bracket suffix
// cleanDisplayTitle recognizes (and strips), reusing the identical bracket
// shape rather than a second, forked regex, so the two helpers can never
// disagree about what counts as a yt-dlp-shaped filename. Returns the
// bracketed id -- already charset/length-bounded by the regex itself
// (exactly 11 characters of `[A-Za-z0-9_-]`, the same shape
// `url.isSafeVideoId` accepts) -- or `null` when the basename doesn't match
// this shape at all (an ordinary, non-yt-dlp library file). Scan-time-only:
// callers are expected to scope this to files actually rooted under the
// yt-dlp module's own download dir first (mirroring cleanDisplayTitle's own
// FIX-9 scoping), so a coincidentally-bracketed non-yt-dlp file is never fed
// through this at all.
function extractYtdlpVideoId(baseName) {
  const m = /^(.*?)[ _]\[([A-Za-z0-9_-]{11})\]$/.exec(baseName);
  return m ? m[2] : null;
}

// v1.33 T1: scan-time YouTube-id derivation, shared by the new/updated
// branch's probe path and its probe-failure path. Two sources, in trust
// order: (1) the filename's `[id]` bracket -- scoped to yt-dlp-rooted files
// exactly like the bridge/cleanDisplayTitle (a coincidentally-bracketed
// library file elsewhere is never fed through extractYtdlpVideoId); (2) the
// embedded `purl`/`comment` source URL off the file's own probe -- an
// EXPLICIT downloader-written provenance tag, trusted from any root, but
// only after it survives the classifySingleVideo gate. Returns the id or
// `null` -- callers persist the `null` too (probed-once convention).
//
// ACCEPTED trust boundary (v1.33 gate, conscious decision): the embedded tag
// is only ever a claim about which YouTube video this file CAME FROM --
// anyone with write access to the media files themselves (already full
// control in this LAN-only, single-user app) could edit it to point the
// Share link / reheat metadata at a different-but-legitimate YouTube video.
// The gate guarantees it can only ever be a well-formed YouTube video URL
// (never another host, a playlist, or a credentialed URL); content-vs-id
// agreement is not (and cannot be) verified. Revisit if multi-user/untrusted
// library roots ever land (see ROADMAP's accounts item).
function deriveScanYoutubeId(filePath, info, ytdlpRoots, embeddedSourceUrl) {
  if (matchRootFolder(filePath, ytdlpRoots)) {
    const bracketId = extractYtdlpVideoId(path.basename(info.name, info.ext));
    if (bracketId) return bracketId;
  }
  return youtubeIdFromUrlString(embeddedSourceUrl);
}

// Check if ffmpeg is available
let ffmpegAvailable = false;
exec('ffmpeg -version', (error) => {
  if (!error) {
    ffmpegAvailable = true;
    console.log('FFmpeg is available in system PATH');
  } else {
    console.log('FFmpeg is not available in system PATH. Will fall back to dynamic SVG templates for thumbnails.');
  }
});

// ---- Pre-transcode queue (AVI and other non-web containers -> MP4) ----
// Jobs run one at a time to avoid overloading a home server with parallel FFmpeg runs.
const transcodeQueue = [];
let transcodeBusy = false;
const transcodeProgress = {}; // id -> percent complete (0-100) while a job runs

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

// id -> last-PERSISTED lastServedAt (epoch ms), the WRITE-THROTTLE for
// recordServed below. This is a DEDICATED map, deliberately separate from
// `recentlyServed` (path-keyed, updated unthrottled on every serve, pruned by
// eviction — different semantics/lifecycle). It exists ONLY to let
// recordServed short-circuit its hot-path disk read; on-disk
// db.metadata[id].lastServedAt remains the single source of truth
// (mergeScannedMetadata's contract), recordServed is still the only writer,
// and this map is NEVER read as truth nor fed into mergeScannedMetadata.
// Empty on boot -> the first serve per item after a restart still does one
// loadDatabase (acceptable; no served signal is lost worse than before).
const persistedServedAt = new Map();

// Persist a media item's last-served timestamp (db.metadata[id].lastServedAt,
// epoch ms) — the D3 age-retention signal `selectAgedOut`/`sweepAgedTranscodes`
// key off. This runs on the `/video/:id` streaming hot path, which fires many
// Range requests per playback, so the ~10-minute throttle short-circuits on a
// `persistedServedAt` Map lookup FIRST — no `loadDatabase` at all when this id
// was persisted within RECENT_STREAM_MS. Only when it may actually be due (no
// map entry, or the entry is stale) do we `loadDatabase`, check the on-disk
// value (which may already be fresh, e.g. right after boot), and persist +
// update the map. This mirrors setTranscodeStatus's no-clobber pattern while
// avoiding the full-DB read the old throttle-write-only version still paid on
// every Range request. Additive alongside the in-memory `markServed`/
// `recentlyServed` guard (which remains the real eviction-race protection) —
// recordServed is a separate, persisted-timestamp concern for the age sweep.
//
// `persistedServedAt` is set OPTIMISTICALLY, up front, before the
// `updateDatabase` enqueue -- this is what lets a burst of same-id calls
// within RECENT_STREAM_MS (e.g. many Range requests for one playback while
// dbWriteChain is backlogged, such as during a scan) short-circuit on the
// hot-path Map lookup after the FIRST call, instead of each enqueuing its own
// `updateDatabase` (and paying a synchronous loadDatabase inside the lock).
// Because the set happens before the mutator confirms the id's metadata
// entry still exists, the no-entry branch below MUST undo it
// (`persistedServedAt.delete(id)`) -- otherwise an id concurrently
// DELETEd/pruned (reachable e.g. via the transcode close-callback's
// recordServed, which has no same-tick existence guard) would leave a
// permanent throttle-map entry no cleanup ever reclaims (unbounded map growth
// under delete-while-streaming churn), and would suppress a legitimate
// re-add of the same id within RECENT_STREAM_MS (re-opening the FR3.2 leak).
//
// Returns the updateDatabase promise on the "due" branch (already
// .catch-guarded), or `undefined` on the throttled hot path -- production
// call sites never await this (fire-and-forget), but tests that need to
// observe the persisted write deterministically can `await recordServed(id)`.
function recordServed(id) {
  const now = Date.now();
  const last = persistedServedAt.get(id);
  if (last !== undefined && (now - last) < RECENT_STREAM_MS) return undefined; // hot path: no disk read, no lock
  persistedServedAt.set(id, now); // optimistic -- de-dupes a same-id burst while the write is enqueued/backlogged
  return updateDatabase(db => {
    const entry = db.metadata[id];
    if (!entry) {
      persistedServedAt.delete(id); // undo the optimistic set -- concurrently deleted/pruned, never mark the throttle map
      return false;
    }
    // Re-check the on-disk value inside the lock -- it may already be fresh
    // (e.g. right after boot, before this id has any persistedServedAt map
    // entry of its own). The entry exists either way at this point, so the
    // up-front optimistic set already stands in both branches below.
    if (typeof entry.lastServedAt === 'number' && (now - entry.lastServedAt) < RECENT_STREAM_MS) {
      return false;
    }
    entry.lastServedAt = now;
    return true;
  }).catch(err => console.error('Error persisting lastServedAt:', err));
}

// Removes a single id's write-throttle entry from `persistedServedAt`. Called
// for real by `runScanDirectories`' prune path (FR3.2) so a pruned id's entry
// doesn't linger forever (unbounded map growth under churn) or suppress
// `lastServedAt` persistence for a re-added same-id path within
// RECENT_STREAM_MS. Also used by tests to simulate a persisted-serve entry
// aging out of the throttle map (without waiting RECENT_STREAM_MS in real
// time) so they can exercise recordServed's "due" path deterministically.
function clearPersistedServedAt(id) {
  persistedServedAt.delete(id);
}

function queueTranscode(id, srcPath) {
  if (!ffmpegAvailable) return;
  if (transcodeQueue.some(job => job.id === id)) return; // already queued
  transcodeQueue.push({ id, srcPath });
  processTranscodeQueue();
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
          evictTranscodeCache(effectiveCacheCap(getCachedDatabase().settings), outPath);
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

// ---- Background-audio-for-video extract queue (v1.27.0, EXPERIMENTAL) -----
// Mirrors the pre-transcode queue directly above -- single worker (never runs
// alongside a video transcode job's own concerns, but IS its own independent
// worker/queue so a slow video transcode never blocks an audio pre-warm, and
// vice versa), same TRANSCODE_DIR, same atomic `.tmp`-then-rename finalize,
// same arg-ARRAY spawn (never a shell string). This is a second JOB KIND
// sharing every existing cache mechanism (LRU eviction, age sweep, orphan
// cleanup, live-watch protection via markServed/recordServed) rather than a
// forked cache subsystem -- see audioPath's own comment and
// isCompletedTranscode/isInFlightTranscode above.
const audioExtractQueue = [];
let audioExtractBusy = false;
const audioExtractProgress = {}; // id -> percent complete (0-100) while a job runs

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

// Pure: the exact FFmpeg argument ARRAY (never a shell string -- no
// interpolation, no injection surface) for extracting an audio-only AAC/M4A
// sidecar from a video source. `-vn` drops video entirely; AAC/160k/stereo +
// faststart mirrors the video transcode's own audio settings exactly, so the
// sidecar sounds identical to the audio track the user was already hearing.
// Exported for unit tests (asserts the array shape + `-vn` + no shell
// interpolation) without needing a real ffmpeg binary.
function buildAudioExtractArgs(srcPath, tmpPath) {
  return [
    '-i', srcPath,
    '-vn', '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
    '-movflags', '+faststart',
    '-y', tmpPath
  ];
}

function queueAudioExtract(id, srcPath) {
  if (!ffmpegAvailable) return;
  if (audioExtractQueue.some(job => job.id === id)) return; // already queued
  audioExtractQueue.push({ id, srcPath });
  processAudioExtractQueue();
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
          evictTranscodeCache(effectiveCacheCap(getCachedDatabase().settings), outPath);
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

// Pure: pull a small, normalized set of embedded metadata tags from ffprobe
// output (accepts the parsed object OR the raw stdout string). Whitelisted so we
// never surface junk; returns {} on anything malformed. Unit-tested — ffprobe
// isn't installed in CI, so keeping the parsing separate from the spawn matters.
// NOTE: 'synopsis' is deliberately excluded -- yt-dlp's --embed-metadata writes
// the same text into BOTH 'description' and 'synopsis' (plus the source URL
// into 'comment'), which made the watch page show an identical Description
// and Synopsis line for every downloaded item. Dropping it here is a blanket
// change (not conditioned on the file's source); a non-yt-dlp file carrying a
// genuinely distinct synopsis tag will also no longer surface it -- an
// accepted, narrow limitation (see docs/exec-plans/active/2026-07-06-v1.13-polish.md item 7).
const EMBEDDED_TAG_WHITELIST = [
  'title', 'artist', 'album', 'date', 'genre', 'composer',
  'description', 'comment', 'show', 'copyright',
];
function parseFfprobeTags(input) {
  let j = input;
  if (typeof input === 'string') {
    try { j = JSON.parse(input); } catch (_) { return {}; }
  }
  if (!j || typeof j !== 'object') return {};
  const raw = (j.format && j.format.tags) || {};
  if (!raw || typeof raw !== 'object') return {};
  const lower = {};
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) lower[k.toLowerCase()] = v.trim();
  }
  const out = {};
  for (const key of EMBEDDED_TAG_WHITELIST) {
    if (lower[key]) out[key] = lower[key];
  }
  // "year" is a common alias for date (ID3 etc.) — fall back to it.
  if (!out.date && lower.year) out.date = lower.year;
  // description and comment are frequently identical — dedup (case-insensitive).
  if (out.description && out.comment && out.description.toLowerCase() === out.comment.toLowerCase()) {
    delete out.comment;
  }
  return out;
}

// C5-local (v1.24): parse a single embedded-date STRING into epoch ms.
// Handles two shapes seen in the wild: ffmpeg's own ISO-8601-ish
// `creation_time` (e.g. "2023-04-01T12:00:00.000000Z", parseable by
// `Date.parse`) and yt-dlp's `--embed-metadata`, which frequently writes the
// compact `YYYYMMDD` form (its `upload_date` shape, e.g. "20230401") into the
// `date` tag -- a form `Date.parse` does NOT recognize (returns NaN) on
// Node/V8. Pure; never throws; returns `NaN` (not a value) on anything
// unparseable so the caller's `Number.isFinite` check can skip it uniformly.
function parseDateStringMs(raw) {
  const s = String(raw).trim();
  if (/^\d{8}$/.test(s)) {
    const year = Number(s.slice(0, 4));
    const month = Number(s.slice(4, 6));
    const day = Number(s.slice(6, 8));
    return Date.UTC(year, month - 1, day);
  }
  return Date.parse(s);
}

// C5-local (v1.24): pull an embedded release/creation date out of ffprobe's
// format tags (accepts the parsed object OR the raw stdout string -- same
// robustness contract as `parseFfprobeTags`/`parseFfprobeStreams`: a
// try/catch JSON.parse, never throws, degrades to `null` on anything
// malformed). Deliberately reads directly from `format.tags` rather than
// `parseFfprobeTags`'s whitelisted/lowercased output: `creation_time` is not
// (and should not become) part of `EMBEDDED_TAG_WHITELIST` -- that list also
// drives the "embedded info" block rendered on the watch page, and surfacing
// a raw timestamp there was never asked for. Checked in order of
// specificity: `creation_time` (a full timestamp) -> `date` -> `year` (a
// bare year is still better than nothing). Returns epoch ms, or `null` if no
// tag is present/parseable -- the caller (`deriveReleaseDate`) treats `null`
// as "fall through to the mtime fallback".
function parseEmbeddedReleaseDateMs(input) {
  let j = input;
  if (typeof input === 'string') {
    try { j = JSON.parse(input); } catch (_) { return null; }
  }
  if (!j || typeof j !== 'object') return null;
  const raw = (j.format && j.format.tags) || {};
  if (!raw || typeof raw !== 'object') return null;
  const lower = {};
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) lower[k.toLowerCase()] = v.trim();
  }
  const candidates = [lower.creation_time, lower.date, lower.year];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const ms = parseDateStringMs(candidate);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

// C5-local (v1.24): the release-date PRECEDENCE helper -- embedded date (from
// a probe the scan already ran) wins; filesystem `mtime` is the fragile-but-
// honest last resort (it resets on copy, but every local file has one).
// Pure and deliberately tiny/decoupled from `parseEmbeddedReleaseDateMs` so
// the SCHEMA-ONLY BACKFILL PATH (an already-indexed item whose entry
// predates this field) can call it with `embeddedMs=null` to force the
// mtime-only branch WITHOUT spawning a fresh probe -- see the scan loop's
// backfill branches below, which pass `null` here on purpose (the
// thumbnail-backfill-regression lesson: adding this field to an existing
// item must never trigger re-processing). Returns epoch ms, or `null` only
// if `mtimeMs` itself is unusable (never expected in practice -- every
// scanned file has a `stat` result).
function deriveReleaseDate(embeddedMs, mtimeMs) {
  if (Number.isFinite(embeddedMs)) return embeddedMs;
  if (Number.isFinite(mtimeMs) && mtimeMs > 0) return mtimeMs;
  return null;
}

// v1.33 T1: pull the ORIGINAL source URL out of ffprobe's format tags.
// yt-dlp's `--embed-metadata` (and metube, which wraps yt-dlp) writes the
// video's canonical webpage URL into the `purl` tag and (usually) `comment`
// too. `purl` is checked first (it is EXACTLY this, by definition); `comment`
// is the fallback (it can also carry free-form text, so the downstream
// `classifySingleVideo` gate decides whether it is actually a YouTube video
// URL). Same accepts-object-or-raw-stdout / never-throws contract as
// `parseEmbeddedReleaseDateMs` above, and deliberately reads RAW `format.tags`
// for the same reason that function does: `purl` is not (and should not
// become) part of EMBEDDED_TAG_WHITELIST -- that list also drives the watch
// page's "embedded info" block, and a raw URL line there was never asked for.
// Returns the raw tag string (untrusted -- callers MUST validate through
// classifySingleVideo), or `null`.
function parseEmbeddedSourceUrl(input) {
  let j = input;
  if (typeof input === 'string') {
    try { j = JSON.parse(input); } catch (_) { return null; }
  }
  if (!j || typeof j !== 'object') return null;
  const raw = (j.format && j.format.tags) || {};
  if (!raw || typeof raw !== 'object') return null;
  const lower = {};
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) lower[k.toLowerCase()] = v.trim();
  }
  const candidates = [lower.purl, lower.comment];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) return candidate;
  }
  return null;
}

// v1.33 T1: validate an untrusted URL-ish string (an embedded `purl`/`comment`
// tag, typically) down to a safe YouTube video id, through the SAME
// `classifySingleVideo` gate every other untrusted URL in the yt-dlp module
// crosses -- never a home-grown regex. Returns the 11-char id, or `null` for
// anything that is not a well-formed single-video YouTube URL. Pure, never
// throws (classifySingleVideo fails closed on garbage input).
function youtubeIdFromUrlString(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  const classified = classifySingleVideo(raw);
  return classified.ok ? classified.videoId : null;
}

// v1.33 T1: the reheat batch's LOCAL tags probe (deps-injected into
// lib/ytdlp/index.js's runRepullMetadataBatch as `probeEmbeddedTags`) -- a
// single, cheap, network-free ffprobe of the file's embedded format tags.
// Returns `{ releaseDateMs, sourceUrl, title }` (each `null` when the probe
// SUCCEEDED but the tag is absent/unparseable), or `null` -- the whole value,
// not a field -- on ffmpeg-unavailable / spawn error / empty or malformed
// probe output. Never rejects. The null-vs-object distinction is
// LOAD-BEARING (gate fix, adversarial WARNING): the reheat batch treats an
// all-null OBJECT as "this file genuinely carries nothing" (safe to mark the
// item exhausted/complete) but a `null` RESULT as "the probe itself failed,
// transiently" (the item must stay retryable) -- collapsing the two would
// let a brief ffmpeg hiccup permanently foreclose an item's future
// discovery. Reuses `buildFfprobeArgs` (the single source of truth for probe
// args) and the SAME parse helpers the scan's own probe uses, so the two can
// never disagree about what an embedded tag means. NEVER touches thumbnails
// or runs ffmpeg -- probe-only, exactly like `probeCodecsOnly` above (the
// thumbnail-backfill-regression lesson).
// `title` is returned RAW off the tag (trimmed by the extraction below) --
// the persist path (`recordRepulledItemMeta`) sanitizes it through
// `ytdlp.sanitizeCapturedTitle` before anything is stored.
function probeEmbeddedTags(filePath) {
  return new Promise((resolve) => {
    if (!ffmpegAvailable) { resolve(null); return; }
    execFile('ffprobe', buildFfprobeArgs(filePath), { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) { resolve(null); return; }
      let j;
      try {
        j = JSON.parse(stdout);
      } catch (_) {
        // Malformed probe output = the probe FAILED (transient) -- null, per
        // the contract above, never an all-null "genuinely nothing" object.
        resolve(null);
        return;
      }
      let releaseDateMs = null;
      let sourceUrl = null;
      let title = null;
      try { releaseDateMs = parseEmbeddedReleaseDateMs(j); } catch (_) { releaseDateMs = null; }
      try { sourceUrl = parseEmbeddedSourceUrl(j); } catch (_) { sourceUrl = null; }
      const rawTags = (j && j.format && j.format.tags) || {};
      if (rawTags && typeof rawTags === 'object') {
        for (const k of Object.keys(rawTags)) {
          if (k.toLowerCase() === 'title' && typeof rawTags[k] === 'string' && rawTags[k].trim() !== '') {
            title = rawTags[k].trim();
            break;
          }
        }
      }
      resolve({ releaseDateMs, sourceUrl, title });
    });
  });
}

// FR-1b (v1.18.0): the browser-compatible codec allowlist — deliberately
// conservative (H.264/AVC video + AAC audio ONLY; HEVC/VP9/AV1/AC-3/DTS/
// E-AC-3 etc. are NOT allowlisted despite partial device support), mirroring
// the `TRANSCODE_EXTENSIONS` pattern above. ffprobe reports `h264`; `avc1` is
// included defensively (some tools/containers surface that name instead).
const PLAYABLE_VIDEO_CODECS = new Set(['h264', 'avc1']);
const PLAYABLE_AUDIO_CODECS = new Set(['aac']);

// Feature A (v1.26.1, Shorts player-size jump): sane upper bound for a
// probed OR client-reported video width/height -- shared by
// `parseFfprobeStreams` (below) and the `POST /api/videos/:id/dimensions`
// lazy-backfill endpoint's own validation, so both paths agree on what
// counts as a plausible dimension. 8192 comfortably covers 8K video (the
// largest anything in this library is realistically going to be) while
// still rejecting garbage (a corrupt probe, or a malicious/buggy client
// POST body).
const MAX_MEDIA_DIMENSION = 8192;

// Pure: true only for a finite, positive, integer dimension within
// MAX_MEDIA_DIMENSION -- the single validity gate both the ffprobe stream
// parse and the dimensions-backfill endpoint use.
function isValidMediaDimension(n) {
  return Number.isInteger(n) && n > 0 && n <= MAX_MEDIA_DIMENSION;
}

// F3 (v1.26.1 two-reviewer follow-up, NIT): the ONLY input shapes the
// `POST /api/videos/:id/dimensions` body is allowed to carry a
// width/height as, BEFORE it's handed to `Number(...)`. `Number()` alone
// happily coerces plenty of non-numeric-looking JSON values that are not
// remotely "a number the client measured" -- `Number([1920])` -> `1920`
// (single-element array unwrap), `Number(true)` -> `1`, `Number('0x10')` ->
// `16` (hex-string parse) -- all of which would otherwise sail through
// `isValidMediaDimension` as a plausible-looking positive integer. A plain
// `number` (the normal shape: `JSON.stringify({ width: videoWidth, ... })`
// from player.js always sends a real JS number) or a base-10 digit-only
// string (defensive: some other JSON client) are the only two shapes
// accepted; anything else (array, boolean, object, hex/exponential/
// whitespace-padded string, `null`/`undefined`) is rejected here, before
// `Number()` ever runs.
function isPrimitiveNumericInput(v) {
  if (typeof v === 'number') return true;
  return typeof v === 'string' && /^\d+$/.test(v);
}

// Pure: pull the first video/audio stream's codec_name (+ the video
// stream's width/height, Feature A v1.26.1) out of ffprobe's -show_entries
// stream=codec_name,codec_type,width,height:stream_disposition=attached_pic
// output (accepts the parsed object OR the raw stdout string — same
// robustness contract as parseFfprobeTags: JSON.parse in a try/catch, never
// throws, returns {} on anything malformed). Returns { videoCodec,
// audioCodec, width, height }; each key is simply absent (undefined) when
// that stream type isn't present in the probe output, or (width/height
// only) when the reported value isn't a sane positive integer
// (isValidMediaDimension).
//
// Cover-art / attached_pic trap: many VIDEO-container files (.mp4/.mkv/
// .mov/.webm/.m4v) carry an embedded COVER-ART image as its own
// `codec_type: 'video'` stream (codec_name mjpeg/png,
// `disposition.attached_pic === 1`). Picking the FIRST video stream
// unconditionally can select that cover-art stream instead of the real
// video track when it happens to be ordered first — wrongly flagging an
// otherwise-playable file for transcode (or hiding a genuinely
// non-allowlisted real codec behind an allowlisted-looking cover-art one).
// We skip any stream whose `disposition.attached_pic === 1` when picking
// the video stream; audio-stream selection is unaffected. Missing/undefined
// disposition info degrades safely to "not attached_pic" (an ordinary video
// stream), so a probe whose output lacks disposition entries at all still
// behaves exactly as it did before this fix. If every video stream in the
// file is attached_pic (no real video track — effectively an audio file in
// a video container), `videoCodec` is left absent/undefined (never
// flagged).
// Pure: the video stream's rotation in DEGREES, from ffprobe's
// `side_data_list` (requested via `stream_side_data=rotation`, see
// `buildFfprobeArgs`). Modern ffmpeg reports a container/track-level
// rotation (e.g. a phone-shot portrait video stored with CODED landscape
// dims) as a "Display Matrix" `side_data_list` entry carrying a signed
// `rotation` field (90/-90/180/270/-270/etc, degrees) -- NOT the legacy
// `rotate` stream TAG this codebase doesn't request. Returns `0` (no
// rotation / not present / unparseable) on anything else, so a caller can
// always safely test `Math.abs(rotation) % 180 === 90` without a separate
// presence check. Only the FIRST `side_data_list` entry that actually
// carries a `rotation` key is used -- a stream can carry other, unrelated
// side_data entries (e.g. "Content Light Level") the field is simply absent
// from.
function firstStreamRotation(stream) {
  const list = Array.isArray(stream.side_data_list) ? stream.side_data_list : [];
  for (const sd of list) {
    if (sd && Object.prototype.hasOwnProperty.call(sd, 'rotation')) {
      const r = Number(sd.rotation);
      if (Number.isFinite(r)) return r;
    }
  }
  return 0;
}

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

// Pure: true only on a POSITIVE identification of a non-allowlisted codec.
// `undefined`/missing codecs (a probe that failed, or hasn't run yet) always
// return false — a failed/ambiguous probe must never *falsely* flag a file
// for transcoding (the "degrade safely" contract in docs/RELIABILITY.md).
function codecNeedsTranscode(videoCodec, audioCodec) {
  if (videoCodec && !PLAYABLE_VIDEO_CODECS.has(videoCodec)) return true;
  if (audioCodec && !PLAYABLE_AUDIO_CODECS.has(audioCodec)) return true;
  return false;
}

// Shared ffprobe arg-array builder (v1.18.1 hotfix extraction) -- SINGLE
// source of truth for the probe args `extractMetadataAndThumbnail` and the
// codec-only `probeCodecsOnly` (below) both use, so the two spawns can never
// silently drift apart. `execFile` (not `exec`) so `filePath` is passed as
// its own arg-array element rather than interpolated into a shell command
// string -- this narrows the pre-existing injection surface on this line
// without widening anything.
// Feature A (v1.26.1): `width,height` added to the stream fields -- purely
// additive to the SAME probe (no second spawn); `parseFfprobeStreams` is
// what actually reads them back out (see its own comment for the
// attached_pic/cover-art guard).
// F2 (v1.26.1 two-reviewer follow-up): `stream_side_data=rotation` added,
// same "purely additive to the same probe" reasoning -- surfaces each
// stream's `side_data_list` (a "Display Matrix" entry's `rotation` field, on
// a rotation-flagged phone-shot video) in the JSON output, which
// `firstStreamRotation`/`parseFfprobeStreams` read back out to correct
// coded-vs-display width/height (see their own comments).
function buildFfprobeArgs(filePath) {
  return [
    '-v', 'error',
    '-show_entries', 'format=duration:format_tags:stream=codec_name,codec_type,width,height:stream_disposition=attached_pic:stream_side_data=rotation',
    '-of', 'json',
    filePath,
  ];
}

// v1.18.1 hotfix: a lightweight, CODEC-ONLY probe used by the scan's
// legacy-video backfill branch (below, ~line 1280s). Runs ONLY the ffprobe
// codec probe -- the SAME args `extractMetadataAndThumbnail` uses (via
// `buildFfprobeArgs`, so the two can never diverge) -- and parses the result
// with the existing `parseFfprobeStreams`. It NEVER runs an ffmpeg frame-grab
// / art-extraction spawn and NEVER touches the thumbnail file: that is
// precisely what lets a pre-v1.18 (or probe-failed) video's codec fields be
// backfilled without re-generating (and thus clobbering) its existing
// thumbnail -- the v1.18.0 regression this hotfix fixes. Same degrade-safe
// contract as `extractMetadataAndThumbnail`'s codec fields: `videoCodec`/
// `audioCodec` are always an explicit lowercased string or `null` (never
// `undefined`) -- `null` on ffmpeg-unavailable, a probe error, or
// unparseable/absent stream data.
function probeCodecsOnly(filePath) {
  return new Promise((resolve) => {
    if (!ffmpegAvailable) {
      resolve({ videoCodec: null, audioCodec: null });
      return;
    }
    execFile('ffprobe', buildFfprobeArgs(filePath), { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      let videoCodec = null;
      let audioCodec = null;
      if (!err && stdout) {
        try {
          const streams = parseFfprobeStreams(stdout);
          videoCodec = streams.videoCodec !== undefined ? streams.videoCodec : null;
          audioCodec = streams.audioCodec !== undefined ? streams.audioCodec : null;
        } catch (_) { videoCodec = null; audioCodec = null; }
      }
      resolve({ videoCodec, audioCodec });
    });
  });
}

// Extract duration and thumbnail using FFmpeg
function extractMetadataAndThumbnail(filePath, mediaId, isAudio) {
  return new Promise((resolve) => {
    const thumbName = `${mediaId}.jpg`;
    const thumbPath = path.join(THUMBNAIL_DIR, thumbName);

    if (!ffmpegAvailable) {
      // FIX (v1.18.0 two-reviewer follow-up): explicit `null`, not an absent
      // key, even on this "ffmpeg isn't installed at all" path -- so a
      // no-ffmpeg deployment's reuse-guard `hasCodecFields` check (below,
      // ~line 1241) sees the codec keys as present (probed once, no usable
      // codec) instead of re-extracting (ffprobe attempt + ffmpeg thumbnail
      // attempt) every video item on every single scan forever.
      return resolve({ duration: 0, hasThumbnail: false, artist: '', tags: {}, videoCodec: null, audioCodec: null, embeddedReleaseDateMs: null, embeddedSourceUrl: null, width: null, height: null });
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
        } catch (_) {}
      }

      if (isAudio) {
        // Try to extract embedded audio artwork. `execFile` (not `exec`) so
        // `filePath`/`thumbPath` are passed as opaque argv elements, never
        // shell-interpreted -- a media file path containing shell
        // metacharacters could otherwise be a command-injection vector
        // (matches the ffprobe `execFile` hardening above).
        execFile('ffmpeg', ['-i', filePath, '-an', '-vcodec', 'copy', '-y', thumbPath], (artErr) => {
          resolve({ duration, artist, tags, videoCodec, audioCodec, embeddedReleaseDateMs, embeddedSourceUrl, width, height, hasThumbnail: !artErr && fs.existsSync(thumbPath) });
        });
      } else {
        // Extract video frame (at 2 seconds or 10% of duration, whichever is
        // smaller). `execFile` (not `exec`) for the same arg-array/no-shell
        // reason as the audio-art branch above.
        const timestamp = duration > 5 ? 2 : Math.max(0, duration / 2);
        execFile('ffmpeg', ['-ss', String(timestamp), '-i', filePath, '-vframes', '1', '-q:v', '2', '-y', thumbPath], (frameErr) => {
          resolve({ duration, artist, tags, videoCodec, audioCodec, embeddedReleaseDateMs, embeddedSourceUrl, width, height, hasThumbnail: !frameErr && fs.existsSync(thumbPath) });
        });
      }
    });
  });
}

// v1.19.1 hotfix: shared "restore a genuinely-missing thumbnail" helper,
// extracted from the `legacyVideoCodecBackfillOnly` branch so the plain
// `reusable` fast-path (below) can call the SAME logic for VIDEO items whose
// thumbnail was clobbered/lost by a prior v1.18.0 scan but which already
// carry codec fields (and so never reach the backfill-only branch). Restores
// the on-disk thumbnail ONLY if it is genuinely missing -- either the item's
// own `hasThumbnail` flag is false, or the on-disk .jpg is absent/empty. A
// present, non-empty thumbnail is left completely untouched -- no frame-grab,
// ever, for a file that already has one. Returns `true` iff a restore was
// actually attempted (so the caller knows to persist `dbChanged`), `false`
// otherwise.
async function restoreMissingThumbnail(existing, id, filePath) {
  const thumbPath = path.join(THUMBNAIL_DIR, `${id}.jpg`);
  let thumbnailMissing = !existing.hasThumbnail;
  if (!thumbnailMissing) {
    try {
      thumbnailMissing = !fs.existsSync(thumbPath) || fs.statSync(thumbPath).size === 0;
    } catch (_) {
      thumbnailMissing = true;
    }
  }
  if (!thumbnailMissing) return false;

  console.log(`Restoring missing thumbnail for legacy video: ${path.basename(filePath)}`);
  try {
    const thumbMeta = await extractMetadataAndThumbnail(filePath, id, false);
    existing.hasThumbnail = !!thumbMeta.hasThumbnail;
  } catch (err) {
    console.error(`Error restoring thumbnail for ${path.basename(filePath)}:`, err);
  }
  return true;
}

// A6 (v1.24 UX Round, Wave 5): additive `hasSubtitles` detection, shared by
// every scan branch below that reuses an `existing` entry. SCHEMA-ONLY --
// `findSubtitleSidecar` only stats/reads the containing directory (no
// ffmpeg, no thumbnail/transcode work), so calling this can never trigger
// the thumbnail-backfill-regression class of bug. Deliberately recomputed on
// EVERY scan (unlike the one-time `releaseDate` backfill above, which only
// fills a missing field once) -- a subtitle sidecar a user drops in, or
// removes, later is picked up (or cleared) on the very next scan, not just
// once. Mutates `existing.hasSubtitles` in place and returns `true` iff the
// value actually changed (so callers know whether to set `dbChanged`).
// `dirCache` (v1.30, A1 / AC1.3): an OPTIONAL per-scan `Map<dir, string[]>`
// (see `runScanDirectories`) forwarded straight into `findSubtitleSidecar`
// -- memoizes each directory's listing across every file scanned from it
// THIS PASS, closing the O(N^2) `readdirSync` storm at Dean's ~1300-item
// scale. It is discarded at the end of the scan pass (see call site), so a
// sidecar dropped/removed between scans is still picked up on the very next
// one -- this does NOT change the "recomputed every scan" contract
// described above, only how many times the directory is actually listed on
// disk within a single pass.
function applyHasSubtitlesDetection(existing, filePath, dirCache) {
  const hasSubtitles = !!subtitles.findSubtitleSidecar(filePath, undefined, dirCache);
  if (existing.hasSubtitles === hasSubtitles) return false;
  existing.hasSubtitles = hasSubtitles;
  return true;
}

// Live scan state, surfaced via /api/scan-status for the setup/home UI.
// `rescanRequested` is an internal bookkeeping flag (never serialized by
// /api/scan-status) for the coalesced-follow-up mechanism in
// `scanDirectories`, below.
// v1.30 A2 (AC2.2): `processed`/`total`/`phase` added for the cooperative
// scan's progress reporting -- see `runScanDirectories` for how they're
// driven. Guaranteed monotonic (non-regressing) WITHIN one pass; a fresh
// pass (incl. a coalesced follow-up) legitimately resets them to 0 at its
// own start, exactly like `lastScan` only reflects the most recently
// COMPLETED pass. `phase` is one of 'idle' | 'walking' | 'syncing'.
let scanState = { scanning: false, lastScan: null, rescanRequested: false, processed: 0, total: 0, phase: 'idle' };

// v1.30 A2 (AC1.1): cooperative-scan batch size. Both the directory walk
// (`scanDirRecursive`) and the metadata-merge loop (`runScanDirectories`)
// share one `{ count }` counter object (see `maybeYieldScan`) and yield to
// the event loop (`await new Promise(setImmediate)`) every
// `SCAN_YIELD_BATCH` entries processed, so no single synchronous stretch of
// a large scan (even one dominated by cheap, no-I/O reuse fast-paths for
// thousands of UNCHANGED items) can block concurrent requests for longer
// than the design's ~50ms heartbeat bound. `setImmediate` (a real macrotask)
// is used deliberately over a plain `await Promise.resolve()` -- the latter
// is a microtask and would never actually cede control to the event loop's
// poll phase (where incoming HTTP connections/reads are serviced), even
// across thousands of iterations (Node drains the whole microtask queue
// before advancing).
const SCAN_YIELD_BATCH = 64;

// v1.30 A2 (AC1.1): shared cooperative-yield helper -- see `SCAN_YIELD_BATCH`
// above. `yieldState` is a plain `{ count: number }` object threaded through
// both the recursive walk and the metadata-merge loop for ONE scan pass so
// the 64-entry budget is shared across the whole pass, not reset per
// directory/phase (which could otherwise let many small directories each
// stay under budget while the pass as a whole never yields).
async function maybeYieldScan(yieldState) {
  yieldState.count++;
  if (yieldState.count % SCAN_YIELD_BATCH === 0) {
    await new Promise(setImmediate);
  }
}

// FR3.4: hard cap on coalesced follow-up passes per `scanDirectories()` call.
// `runScanDirectories` yields at every awaited `extractMetadataAndThumbnail`
// call, so under CONTINUOUS new-file ingest plus sustained /api/scan (or
// /api/config) requests, `rescanRequested` can keep getting re-set before the
// drain loop rechecks it -- an unbounded `while (scanState.rescanRequested)`
// would then chain passes forever, wedging `scanState.scanning` true
// permanently (a livelock: every /api/scan call gets a perpetual 409). Set to
// 1 so fix C's guarantee still holds -- a rescan requested during an
// in-flight scan still runs at least once more after it -- while making the
// drain provably bounded regardless of how many requests arrive.
const MAX_RESCAN_FOLLOWUPS = 1;

// tech-debt tracker #3: the bounded drain above can exit with
// `scanState.rescanRequested` still true (its follow-up budget spent) --
// e.g. a folder-add lands DURING the one allowed follow-up pass. That
// pending rescan must not be silently dropped: with auto-scan Off there is
// no periodic timer (armScanTimer) to self-heal it, so the added folder's
// media would otherwise sit unindexed until a manual "Scan now". Instead of
// widening the per-invocation bound (which would reintroduce the FR3.4
// livelock risk), `scheduleDeferredRescan` arms exactly ONE deferred,
// rate-limited, `unref()`'d re-entry into the already-bounded
// `scanDirectories()` -- single-guarded (`if (deferredRescanTimer) return`)
// so sustained demand never stacks more than one pending timer, just keeps
// re-arming itself every DEFERRED_RESCAN_DELAY_MS until the demand settles.
let deferredRescanTimer = null;
const DEFERRED_RESCAN_DELAY_MS = 5000;
function scheduleDeferredRescan() {
  if (deferredRescanTimer) return; // never stack/chain more than one pending
  deferredRescanTimer = setTimeout(() => {
    deferredRescanTimer = null;
    scanDirectories().catch(console.error);
  }, DEFERRED_RESCAN_DELAY_MS);
  deferredRescanTimer.unref(); // never keep the process (or a test runner) alive
}

// Test-observability accessor: exposes the current module-level
// `deferredRescanTimer` (or null), mirroring `currentScanTimer` below, so
// tests can assert a deferred follow-up was (or wasn't) armed without
// reaching into module internals, and can clear it in teardown.
function currentDeferredRescanTimer() {
  return deferredRescanTimer;
}

// Public entry point: tracks scanning state around the actual scan.
// Overlap guard: while a scan is already running, a new call never starts a
// second concurrent `runScanDirectories` -- but instead of silently dropping
// the request, it records `rescanRequested` so the in-flight scan runs a
// BOUNDED number of coalesced follow-up passes (MAX_RESCAN_FOLLOWUPS, above)
// after it finishes (many requests during a scan collapse into at most that
// many follow-ups, never an unbounded/livelocked chain). This covers EVERY
// caller of scanDirectories() — the periodic timer (armScanTimer, below), the
// background scan kicked off by POST /api/config, and any manual trigger —
// so two scans never run concurrently, and a requested scan is never
// silently lost (though under sustained continuous demand a request made
// after the follow-up budget is exhausted waits for the NEXT demand cycle,
// which is the trade-off that keeps this provably bounded).
async function scanDirectories() {
  if (scanState.scanning) {
    scanState.rescanRequested = true;
    return;
  }
  scanState.scanning = true;
  try {
    let followups = 0;
    do {
      scanState.rescanRequested = false;
      await runScanDirectories();
      followups++;
    } while (scanState.rescanRequested && followups <= MAX_RESCAN_FOLLOWUPS);
  } finally {
    // Read BEFORE clearing `scanning` (tech-debt #3): if the drain above
    // exited because its follow-up budget was spent -- not because demand
    // stopped -- `rescanRequested` is still true here. Arm exactly one
    // deferred, rate-limited follow-up for it instead of dropping it.
    const stillPending = scanState.rescanRequested;
    scanState.scanning = false;
    scanState.lastScan = new Date().toISOString();
    // v1.30 A2 (AC2.2): terminal state for this call -- `processed`/`total`
    // are left at whatever the last pass reached (a normal completion has
    // processed === total; an exception mid-pass leaves a lower snapshot,
    // which is still an accurate "how far it got" rather than being reset).
    scanState.phase = 'idle';
    if (stillPending) scheduleDeferredRescan();
  }
}

// FR-G hardening (v1.12.0, yt-dlp module parity): normalize a scan root to
// its canonical, real filesystem path BEFORE the `Set`-dedup below, which
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

// Scan directories and sync with database
async function runScanDirectories() {
  // v1.30 A3: intentionally left on `loadDatabase()`, not switched to the
  // cache -- this is the scan's own Phase-1 snapshot (background job, not a
  // request/serve-path read; runs once per scan pass, not per request). The
  // scan's authoritative write-back already goes through `updateDatabase`'s
  // own fresh-read-inside-the-lock (below), independent of this snapshot, so
  // leaving this on a genuinely fresh disk read keeps the T1/T2 scan-cache
  // interaction boundary unchanged from this task.
  const db = loadDatabase();
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
  // thumbnails, transcode sidecars, and `db.progress` entries from
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
  for (const rawRoot of [...(db.folders || []), ...ytdlp.extraScanRoots(ytdlpConfig)]) {
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
  // existence-check seam, reused by selectPrunableIds' mount-loss guard below).
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

  for (const [filePath, info] of scannedFiles.entries()) {
    const id = getMediaId(filePath);
    const isAudio = AUDIO_EXTENSIONS.includes(info.ext);

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
      applyHasSubtitlesDetection(existing, filePath, perScanReaddirCache);

      newMetadata[id] = existing;
      dbChanged = true;
    } else {
      // New or updated file
      console.log(`Scanning new/updated file: ${info.name}`);
      // v1.20.0 FR-2: mark this id as freshly-scanned -- see the Phase-2
      // channel-identity bridge, below.
      freshlyScannedIds.add(id);

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
        // applyHasSubtitlesDetection's comment above for why this cheap
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
      pruneMissing: db.settings.pruneMissing,
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
    }
  }

  // Re-read-merge-on-save, now formalized as ONE serialized updateDatabase
  // mutator: the scan holds its own Phase-1 `db` snapshot across many awaited
  // extractMetadataAndThumbnail calls, so writing it back directly would
  // clobber ANY db.settings/folders/folderSettings/progress/lastServedAt/
  // transcodeStatus written concurrently (POST /api/settings, POST
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
      // reheat batch (`recordRepulledItemMeta`, below) writes `sourceTitle`/
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
        }
      }

      // v1.20.0 FR-2: bridge each freshly-scanned yt-dlp download's captured
      // channel identity onto its db.metadata item, inside the SAME
      // serialized mutator that already owns db.ytdlp -- ytdlp.consumeDownloadChannelMeta
      // reads+re-validates+DELETES fresh.ytdlp.downloadMeta[videoId]
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
        if (videoId) {
          // v1.33 T1: the bracket id IS this item's YouTube id -- persist it
          // (the new/updated branch above already set it from the same
          // bracket, but this also covers the AC20 race window where the
          // item was indexed before this bridge pass).
          item.youtubeId = videoId;
          const consumed = ytdlp.consumeDownloadChannelMeta(fresh, videoId);
          if (consumed) {
            item.channelUrl = consumed.channelUrl;
            if (consumed.channelHandleUrl) item.channelHandleUrl = consumed.channelHandleUrl;
            if (consumed.channelId) item.channelId = consumed.channelId;
            if (consumed.channelName) item.channelName = consumed.channelName;
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
            // above.
            if (typeof consumed.channelAvatarUrl === 'string' && consumed.channelAvatarUrl !== '') {
              item.channelAvatarUrl = consumed.channelAvatarUrl;
            }
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
      if (!item.channelUrl && matchRootFolder(item.filePath, ytdlpDownloadRoots)) {
        const backfilled = ytdlp.backfillChannelIdentityFromFolder(fresh, item, ytdlpConfig);
        if (backfilled) {
          item.channelUrl = backfilled.channelUrl;
          // AC80: writing channelName here is what makes the real creator
          // name (not the generic "Downloads"/folder label) appear on the
          // watch page + cards -- resolveChannelName (common.js) already
          // ranks a captured item.channelName first; no client change needed.
          if (backfilled.channelName) item.channelName = backfilled.channelName;
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

    fresh.metadata = mergeScannedMetadata(fresh.metadata, newMetadata);
    for (const id of prunable) {
      delete fresh.progress[id]; // apply prune to the FRESH progress map
      // Also drop the write-throttle map entry (FR3.2): without this, a
      // pruned id's persistedServedAt entry lingers forever (unbounded growth
      // under churn) and can suppress lastServedAt persistence if the same id
      // is re-added (e.g. same path restored) within RECENT_STREAM_MS.
      clearPersistedServedAt(id);
    }
    return true;
  });
  if (dbChanged) console.log('Database synced successfully.');
}

// Periodic scan timer, driven by the persisted `scanIntervalMinutes`
// preference (see `scanIntervalMs`, above) rather than a hardcoded interval.
// Re-invokable: clears any previously-armed timer before (re-)arming, so a
// settings change can re-arm it live later (POST /api/settings) without a
// restart. `.unref()` so an armed timer never keeps the process — or a test
// runner that happens to call this directly — alive. Arms no timer at all
// when the effective interval is Off (scanIntervalMs returns null).
let scanTimer = null;
function armScanTimer() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  // v1.30 A3: intentionally left on `loadDatabase()`, not switched to the
  // cache -- called only at boot and on a scanIntervalMinutes settings
  // change (infrequent, not a request/serve-path read).
  const db = loadDatabase();
  const ms = scanIntervalMs(db.settings.scanIntervalMinutes);
  if (ms) {
    scanTimer = setInterval(() => scanDirectories().catch(console.error), ms).unref();
  }
  return scanTimer;
}

// Test-observability accessor: exposes the current module-level `scanTimer`
// (or null) without reaching into module internals, so tests can assert the
// timer's identity/interval was (or wasn't) re-armed by a given call.
function currentScanTimer() {
  return scanTimer;
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
      if (isYtdlpIntermediate(file.name)) {
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

// Middleware
app.use(express.json());
// v1.28.0 (iOS Shortcuts robustness): without this, a malformed JSON body
// (e.g. a Shortcut that mis-serializes its own payload) makes `express.json()`
// throw, and Express's DEFAULT error handler renders that as an HTML stack
// page -- useless to any JSON API caller (a Shortcut, curl, the browser
// fetch()s in public/js/*). A 4-arg (error-handling) middleware placed
// immediately AFTER `express.json()` intercepts a body-parser failure and
// turns it into a clean JSON error response. Every OTHER error is passed
// through UNTOUCHED via `next(err)` -- this never changes how any route's
// successful body parsing behaves, and never swallows an unrelated error (a
// thrown route-handler error, etc.) that some other part of the app may
// still want to handle its own way.
//
// v1.28.0 (two-reviewer gate follow-up, F1): originally only matched
// `err.type === 'entity.parse.failed'` (a malformed-JSON body); broadened to
// use the shared `formatBodyParserError` mapping (lib/bodyParserErrors.js)
// so an OVERSIZED JSON body (`entity.too.large`, body-parser's default
// 100kb cap -- previously fell through to the same HTML stack page this
// middleware exists to prevent) and an unsupported encoding/charset also get
// a clean JSON response. The identical mapping function is reused, via a
// SEPARATE middleware registration, by lib/ytdlp/index.js's `express.text()`
// route (see that file's own comment, and `formatBodyParserError`'s own doc
// comment, for why a single shared middleware INSTANCE can't cover both --
// Express's error-handling stack only ever walks forward from where the
// error was raised, so a middleware registered here, before
// `ytdlp.registerRoutes` runs below, can never see an error from a route
// that call registers).
app.use((err, req, res, next) => {
  const mapped = formatBodyParserError(err);
  if (mapped) {
    return res.status(mapped.status).json(mapped.body);
  }
  return next(err);
});
// Serve the app assets with revalidation (no-cache) so updated HTML/JS/CSS show up
// immediately behind caches (browsers, nginx) instead of serving stale files.
// ETag/Last-Modified still allow cheap 304s when nothing changed.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache');
  }
}));

// API: Get library folders list
//
// FR-G part 2 (v1.12.0, yt-dlp module parity): merges the yt-dlp module's
// download directory into the RESPONSE as a synthetic, display-only folder
// entry, WITHOUT ever writing it into `db.folders` -- this is Dean-approved
// and intentionally SOFTENS the prior locked decision C7(ii) ("`GET
// /api/config` never lists a folder the operator didn't add"). Reconciliation
// note: `extraScanRoots()` remains the sole AUTHORITATIVE scan root
// (`runScanDirectories` above reads it directly, never this response) and
// keeps the E1 mount-loss OR-gate intact regardless of whether this synthetic
// entry is present here -- no scan/prune decision anywhere depends on this
// merge. It self-heals on every request (derived fresh from `extraScanRoots`
// each time, never a one-time materialization into `db.folders`): if an
// operator "removes" it from the UI, there is nothing persisted to remove --
// it reappears on the next GET as long as the module still contributes a
// root. Disabled (and the download dir was never created) -> `extraScanRoots`
// returns `[]` -> no synthetic entry, byte-identical to pre-FR-G behavior
// (AC4/46).
app.get('/api/config', (req, res) => {
  const db = getCachedDatabase(); // v1.30 A3: hot GET reader
  const folders = [...(db.folders || [])];
  const folderSettings = { ...(db.folderSettings || {}) };
  const ytdlpConfig = ytdlp.parseYtdlpConfig();
  const synthRoots = ytdlp.extraScanRoots(ytdlpConfig); // [] when disabled & dir absent
  for (const root of synthRoots) {
    if (!folders.some(f => path.resolve(f) === root)) {
      // Item 3 (v1.13.0, order persistence): a prior reorder (persisted via
      // POST /api/config's synthetic folderSettings[root].order, alongside
      // the existing name rename) sticks -- splice the synthetic root in at
      // its stored display index instead of always appending last. A
      // missing/non-integer order (never reordered, or a stale/cleared
      // value) falls back to `folders.length`, reproducing the prior
      // always-append-last behavior byte-for-byte (backward compatible).
      // `order` is display-only: it is never read by any scan/prune path,
      // and `extraScanRoots()` above remains the sole authoritative root.
      const storedOrder = folderSettings[root] && folderSettings[root].order;
      const idx = Number.isInteger(storedOrder) ? Math.max(0, Math.min(storedOrder, folders.length)) : folders.length;
      folders.splice(idx, 0, root);
    }
    // A prior rename (persisted via POST /api/config's synthetic
    // folderSettings allowance below) sticks; otherwise default to a
    // friendly 'Downloads' label so the sidebar never shows a bare path.
    if (!folderSettings[root] || typeof folderSettings[root].name !== 'string' || !folderSettings[root].name) {
      folderSettings[root] = { ...(folderSettings[root] || {}), name: (folderSettings[root] && folderSettings[root].name) || 'Downloads' };
    }
  }
  // FR-4 (v1.19.0): additive, READ-ONLY, response-only field so the client
  // can robustly identify which `folders` entry is the synthetic download
  // root (e.g. to disable its remove button) without re-deriving/guessing a
  // path match itself. This is exactly `synthRoots` above -- never persisted,
  // never accepted back on POST, and does not change any synthetic-root
  // HANDLING (the splice/rename/order logic above, and the db.folders-
  // exclusion in POST /api/config below, are both untouched).
  res.json({ folders, folderSettings, syntheticFolders: synthRoots });
});

// API: Save folder configuration
app.post('/api/config', async (req, res) => {
  const { folders, folderSettings } = req.body;
  if (!Array.isArray(folders)) {
    return res.status(400).json({ error: 'folders must be an array of paths' });
  }

  // FR-G part 2: the module's synthetic download-dir root(s) are never
  // written into `db.folders` here, but a `folderSettings` entry keyed by a
  // synthetic root's resolved path IS allowed to persist on its own (e.g. a
  // rename) even though the root itself is absent from `folders` -- this is
  // how a rename sticks across restarts without the folder ever becoming a
  // "real" `db.folders` row (see GET /api/config above). Computed BEFORE the
  // `validFolders` loop below (FIX-2) so that loop can exclude a synthetic
  // root a client round-tripped back from `GET /api/config`'s display-only
  // merge.
  const ytdlpConfig = ytdlp.parseYtdlpConfig();
  const syntheticRoots = new Set(ytdlp.extraScanRoots(ytdlpConfig));

  // Validate that folders exist locally, and DEDUPLICATE a submitted list
  // using a resolved key -- WITHOUT rewriting the persisted spelling itself.
  //
  // FIX-1 (two-reviewer gate, BLOCKER, data-loss regression, same class as
  // the scan-side fix above): this used to `path.resolve()` every surviving
  // entry and persist THAT into `db.folders`. `getMediaId` hashes the
  // absolute `filePath` a file was scanned under, so rewriting an EXISTING
  // operator's stored folder spelling here -- even one that already resolved
  // to itself, but especially a relative/symlink/bind-mount spelling that
  // doesn't -- would change every file's id under that root on the very next
  // scan, and `pruneMissing` (default ON) would reap the old ids' metadata/
  // thumbnails/`db.progress` the same way the scan-side bug did. A save that
  // didn't intend to change anything must leave existing stored strings
  // byte-identical.
  //
  // The fix: `path.resolve` is used ONLY as a comparison key to drop a
  // submitted entry that resolves to one already kept (or to a synthetic
  // root, FIX-2 below) -- the ORIGINAL (trimmed, as-submitted) string is
  // what's pushed into `validFolders` and ultimately persisted.
  const validFolders = [];
  const seenResolved = new Set();
  // The client's `folderSettings` object is keyed by whatever folder string
  // it last received -- remember the resolved form for each submitted
  // original so the settings lookup below still finds it, independent of
  // `validFolders` now holding un-resolved spellings.
  const resolvedFromOriginal = new Map();
  // QW2 (fast-follow, correctness fix): resolved key -> the ORIGINAL
  // (trimmed, as-submitted) spelling that actually survived into
  // `validFolders` for that resolved root. `db.folders` (via FIX-1) stores
  // the original submitted spelling, not the resolved one -- so
  // `db.folderSettings` must be keyed the SAME way, or a non-canonical
  // spelling (trailing separator, relative path, a `.`/`..` segment -- not
  // symlinks, those are a separate FR-G concern) ends up with `db.folders`
  // and `db.folderSettings` keyed by two DIFFERENT strings. The client's
  // rename/hidden lookups (`resolveChannelName` in public/js/common.js,
  // public/js/main.js, and the GET /api/videos hidden-folder filter below)
  // all index `folderSettings` by the RAW as-scanned spelling
  // (`item.rootFolder`, which comes from `db.folders`) -- so a resolved-key
  // mismatch here made the setting silently unreachable, even though it was
  // faithfully persisted.
  const originalByResolved = new Map();
  // Item 3 (v1.13.0, order persistence): resolved synthetic root -> its
  // display index in the SUBMITTED `folders` order (the count of real
  // folders that preceded it), derived purely from client-submitted
  // position -- no new client logic needed, the client already sends the
  // reordered array via the existing up/down Setup-page controls. Never
  // read by any scan/prune path.
  const syntheticOrders = new Map();
  for (const folder of folders) {
    if (typeof folder !== 'string') continue;
    const trimmed = folder.trim();
    if (!trimmed || !fs.existsSync(trimmed)) continue;
    const resolved = path.resolve(trimmed);
    resolvedFromOriginal.set(trimmed, resolved);
    if (seenResolved.has(resolved)) continue;
    seenResolved.add(resolved);
    // FIX-2 (two-reviewer gate, BLOCKER-adjacent, C7 reap-surface reopened):
    // `GET /api/config` merges the module's synthetic download-dir root into
    // its RESPONSE for display purposes only (never into `db.folders`) -- but
    // a normal settings-page save round-trips that same `folders` array back
    // into THIS handler. Without this check, the synthetic entry passed the
    // (typeof-string/trim/existsSync)-only filter above and got persisted
    // into `db.folders` on the very next save, reopening the exact
    // "downloadDir must never be in db.folders" violation C3/C7 exists to
    // prevent (disable-reap risk: a `db.folders`-resident downloadDir can be
    // evicted by a later save, or double-walked alongside `extraScanRoots`).
    // Excluded here, unconditionally -- its `folderSettings` entry (a rename)
    // is untouched by this and still persists via `cleanSettings` below.
    if (syntheticRoots.has(resolved)) {
      // Record its intended display index (== how many real folders
      // preceded it in the submitted order) BEFORE skipping it -- it is
      // still never pushed into `validFolders`/`db.folders`.
      syntheticOrders.set(resolved, validFolders.length);
      continue;
    }
    validFolders.push(trimmed);
    originalByResolved.set(resolved, trimmed); // QW2
  }

  // Keep per-folder settings (display name / hidden), pruned to folders that
  // still exist OR are a synthetic root.
  const cleanSettings = {};
  if (folderSettings && typeof folderSettings === 'object') {
    for (const [key, s] of Object.entries(folderSettings)) {
      if (!s || typeof s !== 'object') continue;
      const resolvedKey = resolvedFromOriginal.get(key) || path.resolve(key);
      if (!seenResolved.has(resolvedKey) && !syntheticRoots.has(resolvedKey)) continue;
      // QW2: the dedup/synthetic-root MEMBERSHIP CHECK above stays keyed by
      // the resolved path (that part was already correct) -- but the key we
      // actually STORE under matches `db.folders`' spelling for that root: a
      // synthetic root (never in `db.folders`, always already a resolved
      // path from `extraScanRoots`) keeps the resolved key unchanged; a real
      // `db.folders` entry is stored under the SAME original spelling that
      // survived into `validFolders`, so the client's `item.rootFolder`
      // lookups can actually find it.
      const storageKey = syntheticRoots.has(resolvedKey) ? resolvedKey : (originalByResolved.get(resolvedKey) || resolvedKey);
      cleanSettings[storageKey] = {
        name: typeof s.name === 'string' ? s.name.trim() : '',
        hidden: !!s.hidden,
        // v1.14.0 item 3: "Hide from sidebar" -- distinct from `hidden`
        // ("Hide from home"). Independently boolean-coerced (never dropped
        // like the pre-fix whitelist did), so a folder can be hidden from
        // one, both, or neither, in any combination. Backfill for a legacy
        // entry that never set it: `undefined` -> `false` (not hidden).
        hiddenFromSidebar: !!s.hiddenFromSidebar
      };
      // Item 3 (v1.13.0, order persistence): `order` is ONLY ever written
      // for a synthetic root -- real (`db.folders`) folders keep their
      // order purely positional in `db.folders`, exactly as before this
      // change. Prefer the index just derived from the submitted `folders`
      // array (`syntheticOrders`); fall back to a client-submitted `s.order`
      // so a save that doesn't round-trip the synthetic root inside
      // `folders` (but still round-trips its `folderSettings` entry, e.g.
      // a rename-only save) doesn't silently drop a previously-stored
      // order. Only stored when it resolves to an integer.
      if (syntheticRoots.has(resolvedKey)) {
        const order = syntheticOrders.has(resolvedKey) ? syntheticOrders.get(resolvedKey) : (Number.isInteger(s.order) ? s.order : undefined);
        if (Number.isInteger(order)) cleanSettings[storageKey].order = order;
      }
    }
  }

  try {
    await updateDatabase(db => {
      db.folders = validFolders;
      db.folderSettings = cleanSettings;
      return true;
    });
  } catch (err) {
    // Express 4 does not catch a rejected async-handler promise, so a
    // rejection left unguarded here would hang the request instead of
    // returning 500 (mirrors POST /api/scan's pattern above).
    console.error('Error saving folder configuration:', err);
    return res.status(500).json({ error: `Could not save folder configuration: ${err.message}` });
  }

  // Respond with the locally-computed values (not a `db` read back out of the
  // mutator) -- they're already known and identical to what was just saved.
  res.json({ success: true, folders: validFolders, folderSettings: cleanSettings });

  // Sync directories asynchronously in background
  scanDirectories().catch(console.error);
});

// API: Scan files on demand.
// v1.30 A2 (AC2.1, CONTRACT CHANGE from the old synchronous 200/409): the
// scan itself can now take a while even though it never blocks the event
// loop (AC1.1), so this handler no longer `await`s it -- it fires
// `scanDirectories()` fire-and-forget (mirroring `POST /api/config`'s own
// background-scan trigger just above) and responds immediately. A scan
// already in flight still flags the coalesced follow-up (unchanged
// semantics, AC2.5) instead of starting a second concurrent scan; either way
// the response is `202 { scanning: true, alreadyInProgress }` -- there is no
// longer a 409/500 branch here: `scanDirectories()`'s own internal try/finally
// (above) already logs and settles `scanState` on any error, and `.catch`
// below guards the fire-and-forget call against an unhandled rejection.
app.post('/api/scan', (req, res) => {
  const alreadyInProgress = scanState.scanning;
  if (alreadyInProgress) {
    scanState.rescanRequested = true;
  } else {
    scanDirectories().catch(console.error);
  }
  res.status(202).json({ scanning: true, alreadyInProgress });
});

// FR-3 (v1.18.0): bounds the `transcodeNames` list GET /api/scan-status
// returns below -- codec-based detection (T2/FR-1b) can flag substantially
// more files than the old extension-only set on a large library, so the
// names array is capped rather than unbounded (fork #6 in the exec plan).
const TRANSCODE_LIST_CAP = 10;

// API: Live scan/transcode status for progress feedback in the UI
app.get('/api/scan-status', (req, res) => {
  const db = getCachedDatabase(); // v1.30 A3: hot GET reader (was the one T2 left on loadDatabase)
  const items = Object.values(db.metadata);
  // Same filter that has always produced the `transcoding` count -- this is
  // T2's generalized, codec-aware `needsTranscode`/`transcodeStatus` (a
  // codec-flagged HEVC .mp4 rides this exact filter, not a divergent one).
  const pending = items.filter(i =>
    i.needsTranscode && i.transcodeStatus && i.transcodeStatus !== 'ready' && i.transcodeStatus !== 'failed'
  );
  const transcodeNames = pending.slice(0, TRANSCODE_LIST_CAP).map(i => i.title || i.name);
  const transcodeOverflow = Math.max(0, pending.length - transcodeNames.length);
  res.json({
    scanning: scanState.scanning,
    lastScan: scanState.lastScan,
    // v1.30 A2 (AC2.2): cooperative-scan progress -- see `scanState`'s own
    // doc comment for the monotonic-within-a-pass contract. The db read
    // above now goes through `getCachedDatabase()` (v1.30 A3, T4).
    processed: scanState.processed,
    total: scanState.total,
    phase: scanState.phase,
    fileCount: items.length,
    folderCount: (db.folders || []).length,
    transcoding: pending.length,
    transcodeNames,
    transcodeOverflow
  });
});

// Valid POST /api/settings values for the two enum-like fields. `cacheMaxBytes`
// and `pruneMissing` are validated inline (positive-int-or-null, boolean).
const SCAN_INTERVAL_VALID_VALUES = new Set([0, ...SCAN_INTERVAL_MINUTE_OPTIONS]);
const CACHE_MAX_AGE_DAYS_VALID_VALUES = new Set([0, 7, 14, 30, 90]);

// Shape returned by both GET and POST /api/settings — the five persisted keys
// plus a read-only `effectiveCacheMaxBytes` (UI prefill for the "no override"
// case, since cacheMaxBytes:null defers to the env var / 5 GB default).
function settingsResponse(settings) {
  return {
    scanIntervalMinutes: settings.scanIntervalMinutes,
    pruneMissing: settings.pruneMissing,
    cacheMaxBytes: settings.cacheMaxBytes,
    cacheMaxAgeDays: settings.cacheMaxAgeDays,
    defaultView: settings.defaultView,
    autoplayNext: settings.autoplayNext,
    backgroundAudioForVideo: settings.backgroundAudioForVideo,
    effectiveCacheMaxBytes: effectiveCacheCap(settings),
    // v1.32 (custom logo): READ-ONLY here -- managed exclusively by the
    // dedicated POST/DELETE /api/settings/logo routes below (never via the
    // generic POST /api/settings merge; the key is deliberately absent from
    // KNOWN_KEYS so a stray write 400s).
    customLogo: typeof settings.customLogoMime === 'string' && settings.customLogoMime !== '',
    // v1.33.1: the DARK-mode variant's own read-only flag (same managed-by-
    // dedicated-routes posture; `customLogoDarkMime` is likewise absent from
    // KNOWN_KEYS so a stray generic-settings write 400s).
    customLogoDark: typeof settings.customLogoDarkMime === 'string' && settings.customLogoDarkMime !== ''
  };
}

// ---- v1.32: replaceable header logo ("white-label") -------------------------
//
// A user-uploaded image (PNG/JPEG/WebP only -- SVG is deliberately excluded:
// an SVG can carry scripts and this file is served from the app's own
// origin) stored as a single file in DATA_DIR and swapped in for the "FileTube"
// text logo client-side (public/js/common.js's applyCustomLogoIfSet). Size
// cap 1 MB; magic-byte sniffed server-side so a mislabeled Content-Type can
// never plant a non-image; atomic write (tmp+rename) like every other
// DATA_DIR artifact.
const CUSTOM_LOGO_FILENAME = 'custom-logo.bin';
// v1.33.1: the DARK-mode variant's own file. The original filename stays the
// LIGHT/default variant so an existing v1.32 upload keeps working untouched.
const CUSTOM_LOGO_DARK_FILENAME = 'custom-logo-dark.bin';
const CUSTOM_LOGO_MAX_BYTES = 1024 * 1024;
const CUSTOM_LOGO_TYPES = {
  'image/png': (buf) => buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47,
  'image/jpeg': (buf) => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  'image/webp': (buf) => buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP',
};

// v1.33.1: variant plumbing. Anything that isn't exactly the string 'dark'
// (absent, garbage, an array from a repeated query param) normalizes to
// 'light' -- fail-closed to the pre-variant behavior.
function resolveLogoVariant(raw) {
  return raw === 'dark' ? 'dark' : 'light';
}

function customLogoPath(variant) {
  return path.join(DATA_DIR, variant === 'dark' ? CUSTOM_LOGO_DARK_FILENAME : CUSTOM_LOGO_FILENAME);
}

// The settings key holding each variant's verified MIME type. The light key
// keeps its v1.32 name (`customLogoMime`) for back-compat with an existing
// upload's persisted settings.
function customLogoMimeKey(variant) {
  return variant === 'dark' ? 'customLogoDarkMime' : 'customLogoMime';
}

// Serves the uploaded logo (404 when none is set -- the client's boot check
// treats that as "keep the text logo"). `no-cache` so a replacement shows up
// on the next load without a stale-cache fight.
app.get('/logo', (req, res) => {
  const db = getCachedDatabase();
  // v1.33.1: variant-aware with CROSS-FALLBACK -- ?variant=dark serves the
  // dark logo when set, else the light one; the plain /logo (light) likewise
  // falls back to a dark-only upload. "If only one is uploaded it is used
  // for both" (Dean). 404 only when NEITHER variant is set.
  const requested = resolveLogoVariant(req.query.variant);
  const fallback = requested === 'dark' ? 'light' : 'dark';
  const mimeFor = (v) => {
    const m = db.settings && typeof db.settings[customLogoMimeKey(v)] === 'string' ? db.settings[customLogoMimeKey(v)] : '';
    return m && Object.prototype.hasOwnProperty.call(CUSTOM_LOGO_TYPES, m) ? m : '';
  };
  let variant = requested;
  let mime = mimeFor(requested);
  if (!mime) {
    variant = fallback;
    mime = mimeFor(fallback);
  }
  if (!mime) {
    return res.status(404).json({ error: 'No custom logo configured' });
  }
  try {
    const bytes = fs.readFileSync(customLogoPath(variant));
    res.setHeader('Content-Type', mime);
    // v1.32 gate fix: same defense-in-depth header the subtitle route
    // already sets for user-influenced content -- the bytes are magic-byte
    // verified images, but never let a browser second-guess the type.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(bytes);
  } catch (err) {
    // Setting says yes but the file is gone (manual deletion, restored
    // db.json without the data file) -- degrade to "no logo", never a crash.
    console.error('Error serving custom logo (treating as unset):', err && err.message);
    return res.status(404).json({ error: 'No custom logo configured' });
  }
});

// Upload: raw image body (route-scoped express.raw -- this app deliberately
// has no multipart dependency), validated by allowlisted Content-Type AND
// magic bytes, capped at 1 MB.
app.post(
  '/api/settings/logo',
  express.raw({ type: Object.keys(CUSTOM_LOGO_TYPES), limit: CUSTOM_LOGO_MAX_BYTES }),
  async (req, res) => {
    const mime = (req.headers['content-type'] || '').split(';')[0].trim();
    if (!Object.prototype.hasOwnProperty.call(CUSTOM_LOGO_TYPES, mime)) {
      return res.status(400).json({ error: 'Logo must be image/png, image/jpeg, or image/webp' });
    }
    const bytes = req.body;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      return res.status(400).json({ error: 'Empty upload' });
    }
    if (!CUSTOM_LOGO_TYPES[mime](bytes)) {
      return res.status(400).json({ error: 'File content does not match its image type' });
    }
    // Atomic write, same tmp+rename discipline as saveDatabase/runlog.
    // v1.32 gate fix (adversarial): the file write happens INSIDE the
    // updateDatabase mutator -- the single-writer FIFO then guarantees
    // bytes-on-disk and customLogoMime always land together, closing the
    // two-concurrent-uploads window where /logo could briefly serve one
    // upload's bytes under the other's Content-Type.
    // v1.33.1: variant-scoped -- ?variant=dark lands in its own file + its
    // own settings key, never touching the light variant (and vice versa).
    const variant = resolveLogoVariant(req.query.variant);
    const target = customLogoPath(variant);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      await updateDatabase(db => {
        fs.writeFileSync(tmp, bytes);
        fs.renameSync(tmp, target);
        db.settings = { ...db.settings, [customLogoMimeKey(variant)]: mime };
        return true;
      });
    } catch (err) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best-effort */ }
      console.error('Error saving custom logo:', err);
      return res.status(500).json({ error: `Could not save logo: ${err.message}` });
    }
    return res.json({ ok: true });
  },
  // Route-scoped error handler: an oversized body raised by express.raw's
  // limit becomes a clean JSON 413, mirroring the body-parser mapping the
  // one-shot download route uses.
  (err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      return res.status(413).json({ error: 'Logo too large (max 1 MB)' });
    }
    return next(err);
  }
);

// Reset to the default text logo.
app.delete('/api/settings/logo', async (req, res) => {
  // v1.33.1: variant-scoped -- DELETE ?variant=dark removes only the dark
  // variant; the plain DELETE keeps its v1.32 meaning (the light/default one).
  const variant = resolveLogoVariant(req.query.variant);
  const mimeKey = customLogoMimeKey(variant);
  try {
    await updateDatabase(db => {
      if (db.settings && mimeKey in db.settings) {
        const next = { ...db.settings };
        delete next[mimeKey];
        db.settings = next;
      }
      return true;
    });
    try { fs.unlinkSync(customLogoPath(variant)); } catch { /* already gone -- fine */ }
  } catch (err) {
    console.error('Error removing custom logo:', err);
    return res.status(500).json({ error: `Could not remove logo: ${err.message}` });
  }
  return res.json({ ok: true });
});

// API: Read the Automation & Storage settings for Settings-page prefill.
app.get('/api/settings', (req, res) => {
  const db = getCachedDatabase(); // v1.30 A3: hot GET reader
  res.json(settingsResponse(db.settings));
});

// API: Update the Automation & Storage settings. Body may be a PARTIAL object
// (only the keys the user changed). Validates every provided key against its
// allowed range before touching anything — on any invalid field the whole
// request is rejected with 400 and nothing is persisted. Only the four known
// keys are accepted; an unrecognized key is rejected too, keeping db.settings
// free of arbitrary/typo'd keys.
app.post('/api/settings', async (req, res) => {
  const body = req.body || {};
  const KNOWN_KEYS = ['scanIntervalMinutes', 'pruneMissing', 'cacheMaxBytes', 'cacheMaxAgeDays', 'defaultView', 'autoplayNext', 'backgroundAudioForVideo'];
  for (const key of Object.keys(body)) {
    if (!KNOWN_KEYS.includes(key)) {
      return res.status(400).json({ error: `unknown settings key: ${key}` });
    }
  }
  if ('scanIntervalMinutes' in body && !SCAN_INTERVAL_VALID_VALUES.has(body.scanIntervalMinutes)) {
    return res.status(400).json({ error: 'scanIntervalMinutes must be one of 0, 30, 60, 360, 720, 1440' });
  }
  if ('pruneMissing' in body && typeof body.pruneMissing !== 'boolean') {
    return res.status(400).json({ error: 'pruneMissing must be a boolean' });
  }
  if ('cacheMaxBytes' in body) {
    const v = body.cacheMaxBytes;
    if (v !== null && !(Number.isInteger(v) && v > 0)) {
      return res.status(400).json({ error: 'cacheMaxBytes must be null or a positive integer' });
    }
  }
  if ('cacheMaxAgeDays' in body && !CACHE_MAX_AGE_DAYS_VALID_VALUES.has(body.cacheMaxAgeDays)) {
    return res.status(400).json({ error: 'cacheMaxAgeDays must be one of 0, 7, 14, 30, 90' });
  }
  // v1.14.0 item 4: defaultView is a free-form folder path/key (the same
  // identity as a folderSettings key / ?root= param) or '' for "Most
  // Recent" -- only a string type check here (never validated against the
  // currently configured folders): a folder can be temporarily unmounted/
  // renamed/removed without 400ing a save, and the CLIENT falls back to
  // Most Recent at render time when the stored folder no longer exists
  // (resolveDefaultView in public/js/common.js), so this route never needs
  // to reject a since-removed folder path.
  if ('defaultView' in body && typeof body.defaultView !== 'string') {
    return res.status(400).json({ error: 'defaultView must be a string (folder path, or empty for Most Recent)' });
  }
  // v1.16.0 FR-3 (T3): autoplayNext -- boolean, mirrors pruneMissing's own
  // validation exactly.
  if ('autoplayNext' in body && typeof body.autoplayNext !== 'boolean') {
    return res.status(400).json({ error: 'autoplayNext must be a boolean' });
  }
  // v1.27.0 (EXPERIMENTAL): backgroundAudioForVideo -- boolean, mirrors
  // autoplayNext's own validation exactly.
  if ('backgroundAudioForVideo' in body && typeof body.backgroundAudioForVideo !== 'boolean') {
    return res.status(400).json({ error: 'backgroundAudioForVideo must be a boolean' });
  }

  // All provided keys validated -- safe to merge and persist. `prevInterval`
  // and the merged `saved` settings are captured via closure from INSIDE the
  // mutator (the fresh-inside-the-lock db), not from a separate outer read.
  let prevInterval;
  let saved;
  try {
    await updateDatabase(db => {
      prevInterval = db.settings.scanIntervalMinutes; // captured BEFORE the merge
      db.settings = { ...db.settings, ...body };
      saved = db.settings;
      return true;
    });
  } catch (err) {
    // Express 4 does not catch a rejected async-handler promise, so a
    // rejection left unguarded here would hang the request instead of
    // returning 500 (mirrors POST /api/scan's pattern above).
    console.error('Error saving settings:', err);
    return res.status(500).json({ error: `Could not save settings: ${err.message}` });
  }
  // Re-arm the periodic scan timer live ONLY when scanIntervalMinutes actually
  // changed, so an interval change takes effect immediately with no restart.
  // armScanTimer() does clearInterval + setInterval, which RESETS the
  // countdown -- re-arming unconditionally on every save (even for an
  // unrelated setting, or the same interval value) would defer the periodic
  // scan indefinitely if settings are saved more often than the interval.
  if (saved.scanIntervalMinutes !== prevInterval) armScanTimer();
  res.json(settingsResponse(saved));
});

// API: Current transcode-cache size on disk, for the Settings-page display.
app.get('/api/cache/size', (req, res) => {
  const db = getCachedDatabase(); // v1.30 A3: pure read on a request/serve path
  res.json({
    bytes: transcodeCacheSize(TRANSCODE_DIR),
    effectiveCacheMaxBytes: effectiveCacheCap(db.settings)
  });
});

// API: "Clear cache now" -- delete cached transcodes (video *.mp4 AND
// background-audio *.m4a, v1.27.0 -- one coherent cache, see
// isCompletedTranscode) on demand. Excludes any in-flight write (*.tmp.mp4/
// *.tmp.m4a — deleting it would corrupt the write in progress) and anything
// currently protected by
// activeProtectedPaths (the same recentlyServed-within-RECENT_STREAM_MS set
// evictTranscodeCache/sweepAgedTranscodes use) so a clear can never yank a
// file out from under an actively-watched stream. Does NOT touch
// db.metadata[id].lastServedAt -- a future re-transcode naturally re-records
// it on next watch. Per-file
// try/catch so a single failed unlink never fails the whole clear.
// F1 (two-reviewer gate, v1.27.0): DOES clear a cleared item's stale
// `audioStatus` (mirrors evictTranscodeCache/sweepAgedTranscodes's own
// clearAudioStatus call, above) -- a manual "Clear cache now" is exactly as
// capable of invalidating a `'ready'` background-audio sidecar as automatic
// eviction/aging is.
app.post('/api/cache/clear', (req, res) => {
  let entries;
  try { entries = fs.readdirSync(TRANSCODE_DIR); } catch (_) { entries = []; }
  const now = Date.now();
  const protectedPaths = activeProtectedPaths(now);
  let removed = 0;
  let freedBytes = 0;
  for (const name of entries) {
    if (!isCompletedTranscode(name)) continue;
    const p = path.join(TRANSCODE_DIR, name);
    if (protectedPaths.has(p)) continue;
    try {
      const size = fs.statSync(p).size;
      fs.unlinkSync(p);
      removed++;
      freedBytes += size;
      if (name.endsWith('.m4a')) clearAudioStatus(path.basename(name, '.m4a'));
    } catch (e) {
      console.error(`Failed to clear cached transcode ${p}:`, e.message);
    }
  }
  res.json({ success: true, removed, freedBytes });
});

// API: Get list of videos/audio
//
// v1.30 A5 (T6, API CHANGE): paginated + server-authoritative sort/filter.
// Response shape changed from a bare array to `{ items, total, offset,
// limit }` -- see docs/exec-plans/active/2026-07-11-v1.30-scale-perf-and-
// polish.md ("### A5 -- pagination contract") and ARCHITECTURE.md. Pipeline:
// getCachedDatabase() -> hidden-folder filter (home only, unchanged) ->
// search -> root/folder filter -> format filter -> sort the FULL filtered
// list (lib/videoQuery.js, seeded when `sort=random`) -> slice
// [offset, offset+limit) -> overlay pending progress on the SLICED page only
// -> respond with `total` = the full filtered length (before slicing).
app.get('/api/videos', (req, res) => {
  const db = getCachedDatabase(); // v1.30 A3: hot GET reader
  const search = (req.query.search || '').toLowerCase().trim();
  const folderFilter = req.query.folder || '';
  const rootFilter = req.query.root || ''; // a configured folder path — matches everything under it (recursive)
  const sort = typeof req.query.sort === 'string' ? req.query.sort : 'newest';
  const format = req.query.format; // videoQuery.filterByFormat already treats anything but 'video'/'audio' as 'both'
  const limit = videoQuery.normalizeLimit(req.query.limit);
  const offset = videoQuery.normalizeOffset(req.query.offset);
  const seed = videoQuery.normalizeSeed(req.query.seed);

  let list = Object.values(db.metadata);

  // Is a file located under a given folder path? (that folder or any descendant)
  const underFolder = (filePath, folder) =>
    filePath === folder || filePath.startsWith(folder + '/') || filePath.startsWith(folder + '\\');

  // On the default (home/recent) view — no explicit filter — hide files from folders
  // the user marked hidden (their whole subtree). Opening a folder still shows everything.
  if (!search && !folderFilter && !rootFilter) {
    const settings = db.folderSettings || {};
    const hiddenFolders = Object.keys(settings).filter(f => settings[f] && settings[f].hidden);
    if (hiddenFolders.length > 0) {
      list = list.filter(item => !hiddenFolders.some(hf => underFolder(item.filePath, hf)));
    }
  }

  // Search filter
  if (search) {
    list = list.filter(item => videoQuery.matchesSearch(item, search));
  }

  // Mapped-folder filter: recursive — everything under the configured folder (incl. subfolders).
  if (rootFilter) {
    list = list.filter(item => underFolder(item.filePath, rootFilter));
  }

  // Folder uploader (channel) filter: files whose immediate parent matches.
  if (folderFilter) {
    list = list.filter(item => item.folderName === folderFilter);
  }

  // Media-type (format) filter — new in v1.30 A5; server-authoritative
  // replacement for the client's local filterByMediaType.
  list = videoQuery.filterByFormat(list, format);

  // `total` is the full filtered length, BEFORE slicing to a page — this is
  // what makes AC3.2's "page(sort,filter) == sort(filter(full)).slice(...)"
  // property hold, and what lets the client know when it has reached the end.
  const total = list.length;

  // Sort the FULL filtered list, then slice — never sort only the current
  // page (that would break cross-window ordering at page boundaries).
  // `random` is seeded from the client's `seed` query param so sequential
  // page fetches sharing a seed observe one stable shuffle; an absent/
  // invalid seed falls back to one-shot (non-reproducible) randomness.
  const rng = sort === 'random' && seed !== undefined ? videoQuery.createSeededRng(seed) : undefined;
  const sorted = videoQuery.sortItems(list, sort, rng);
  const page = sorted.slice(offset, offset + limit);

  // Overlay progress only on the sliced page — v1.30 A4: `effectiveProgress`
  // overlays any not-yet-flushed `pendingProgress` entry over the cache
  // (read-your-writes). Doing this AFTER slicing (not over the full filtered
  // list) keeps the per-request cost bounded to the page size.
  const items = page.map(item => {
    const progress = effectiveProgress(item.id) || { timestamp: 0, duration: 0 };
    return {
      ...item,
      progress: progress.timestamp,
      progressPercent: progress.duration > 0 ? (progress.timestamp / progress.duration) * 100 : 0
    };
  });

  res.json({ items, total, offset, limit });
});

// API: Get details for single video/audio
app.get('/api/videos/:id', (req, res) => {
  const db = getCachedDatabase(); // v1.30 A3: hot GET reader
  const item = db.metadata[req.params.id];
  if (!item) {
    return res.status(404).json({ error: 'Media file not found' });
  }

  // v1.30 A4: overlay any not-yet-flushed `pendingProgress` entry (read-your-writes).
  const progress = effectiveProgress(item.id) || { timestamp: 0 };
  // v1.25 QoL bugfix: serve-time fallback for the watch page's uploader
  // avatar. `item.channelAvatarUrl` (a persisted, item-level capture) stays
  // authoritative when present; only when it is EMPTY does this look up the
  // yt-dlp subscription whose channelUrl/channelId matches this item's own
  // captured identity and use THAT subscription's already-validated avatar
  // (`ytdlp.resolveItemChannelAvatarUrl`, lib/ytdlp/store.js -- read-only,
  // re-validates before returning, never persisted here). This covers any
  // subscribed channel's item, including a MeTube-imported video the scan
  // never routed through the yt-dlp download tree at all. A no-match (or the
  // module disabled -- `db.ytdlp.subscriptions` is simply absent/empty then)
  // leaves `channelAvatarUrl` empty, and the client's own resolveAvatarSource
  // (public/js/common.js) already falls back to a first-letter avatar.
  let channelAvatarUrl = item.channelAvatarUrl;
  if ((typeof channelAvatarUrl !== 'string' || channelAvatarUrl === '') && ytdlp.isEnabled(ytdlp.parseYtdlpConfig())) {
    // v1.30 A3 cache-coherency note: `resolveItemChannelAvatarUrl` calls
    // `ensureYtdlp(db)` internally, which BACKFILLS `db.ytdlp` (and its
    // nested subscription/pin entries) IN PLACE on a legacy/partial shape.
    // Before this route read through the cache, `db` was always a fresh,
    // per-request `loadDatabase()` throwaway, so that in-place backfill was
    // harmless. Now that `db` is the SHARED `getCachedDatabase()` object,
    // handing it straight into a function that mutates nested fields in
    // place would violate the "cache replaced by reference, never mutated
    // in place" invariant the whole read-cache's coherency argument depends
    // on -- so this lookup gets its own deep-cloned `ytdlp` namespace
    // (structuredClone, only reached when the avatar is genuinely missing)
    // instead of the live cache reference. Every other field of `db` is
    // still shared/read-only here -- only `.ytdlp` is ever written by
    // `ensureYtdlp`.
    const dbForAvatarLookup = { ...db, ytdlp: db.ytdlp ? structuredClone(db.ytdlp) : undefined };
    channelAvatarUrl = ytdlp.resolveItemChannelAvatarUrl(dbForAvatarLookup, item);
  }
  // v1.33 T2 (Share button): the ORIGINAL YouTube watch URL, derived at
  // serve time from the persisted `youtubeId` through the same buildWatchUrl
  // gate the re-pull path uses (it re-validates the id and returns null on
  // anything unsafe -- the spread's own raw `youtubeId` is informational;
  // THIS field is the one the client shares).
  const watchUrl = typeof item.youtubeId === 'string' ? buildWatchUrl(item.youtubeId) : null;
  res.json({
    ...item,
    ...(channelAvatarUrl ? { channelAvatarUrl } : {}),
    ...(watchUrl ? { watchUrl } : {}),
    progress: progress.timestamp,
    transcodeProgress: transcodeProgress[item.id] || 0,
    // v1.27.0 (EXPERIMENTAL): `audioStatus` itself already rides the `...item`
    // spread (db.metadata[id].audioStatus, set by setAudioStatus -- mirrors
    // transcodeStatus's own spread-through); only the live in-memory percent
    // needs adding explicitly, mirroring transcodeProgress just above.
    audioProgress: audioExtractProgress[item.id] || 0,
    // v1.30 C2: `liked` is DERIVED from `db.liked` membership at request
    // time -- never persisted on the item itself. Membership IS the like
    // state (see POST/DELETE /api/liked/:id below); this is purely a
    // read-time convenience so the watch page's initial paint doesn't need a
    // second `GET /api/liked` round-trip just to know this one item's state.
    liked: Array.isArray(db.liked) && db.liked.includes(item.id)
  });
});

// API: Get watch progress -- v1.30 A4: overlay any not-yet-flushed
// `pendingProgress` entry (read-your-writes); see `effectiveProgress` above.
app.get('/api/progress/:id', (req, res) => {
  const progress = effectiveProgress(req.params.id) || { timestamp: 0 };
  res.json(progress);
});

// API: Save watch progress
// v1.30 A4 (AC4.1/AC4.2/AC4.3): rewritten from a per-ping `updateDatabase`
// call (one atomic write+fsync every ~4s while a video plays) into the
// progress-write coalescer -- validate, compute the value, stage it in
// `pendingProgress`, arm the shared debounce timer if needed, and respond
// immediately. No disk I/O happens on this request at all; the batched
// write happens later, on `flushPendingProgress` (the timer, or a shutdown
// handler). The 400 (bad input) / 404 (unknown id) semantics and the stored
// value's shape (`{timestamp, duration, updatedAt}`, same duration-fallback
// precedence) are BYTE-IDENTICAL to the pre-A4 per-ping behavior -- only the
// persistence timing changed. Synchronous now (no `await`): there is nothing
// left in this handler that can reject.
app.post('/api/progress', (req, res) => {
  const { id, timestamp, duration } = req.body;
  if (!id || typeof timestamp !== 'number') {
    return res.status(400).json({ error: 'id and numeric timestamp are required' });
  }
  const db = getCachedDatabase(); // v1.30 A3: hot GET reader (existence check only)
  const item = db.metadata[id];
  if (!item) {
    return res.status(404).json({ error: 'Media not found' });
  }
  pendingProgress.set(id, {
    timestamp,
    duration: duration || item.duration || 0,
    updatedAt: new Date().toISOString()
  });
  armProgressFlushTimerIfNeeded();
  res.json({ success: true });
});

// API: Delete video/audio file
app.delete('/api/videos/:id', async (req, res) => {
  // v1.30 A3: a PURE read to look up `item` -- never mutated here, and the
  // actual persisted mutation below goes through its own `updateDatabase`
  // call (which loads a fresh copy inside the lock), so this is safe on the
  // cache: it is not a direct load->mutate->save site.
  const db = getCachedDatabase();
  const item = db.metadata[req.params.id];
  if (!item) {
    return res.status(404).json({ error: 'Media file not found' });
  }

  const filePath = item.filePath;
  // Opt-in "remove from library anyway" -- only meaningful once the client has
  // already seen the read-only/permission-denied error below and asked us to
  // proceed. See docs/exec-plans/active/2026-07-06-v1.13-polish.md item 5.
  const removeAnyway = req.query.removeAnyway === 'true' || req.query.removeAnyway === '1';
  let fileRemainsOnDisk = false;

  try {
    // Delete actual file from filesystem
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted file from disk: ${filePath}`);
    } else {
      console.warn(`File did not exist on disk when trying to delete: ${filePath}`);
    }

    // Clean up thumbnail
    const thumbPath = path.join(THUMBNAIL_DIR, `${item.id}.jpg`);
    if (fs.existsSync(thumbPath)) {
      fs.unlinkSync(thumbPath);
    }

    // Clean up transcoded MP4 sidecar, if any
    const transcodeFile = transcodedPath(item.id);
    if (fs.existsSync(transcodeFile)) {
      fs.unlinkSync(transcodeFile);
    }
  } catch (err) {
    const readOnly = err && (err.code === 'EROFS' || err.code === 'EACCES');
    const alreadyGone = err && err.code === 'ENOENT';

    if (alreadyGone) {
      // The file (or a sidecar) is already absent on disk -- the desired end
      // state ("not on disk") is already true, so a delete here is a SUCCESS,
      // not a failure. (Reached when existsSync() saw the file but the unlink
      // then hit ENOENT: an external delete/move, a stored-path mismatch, or a
      // TOCTOU race.) Best-effort the remaining sidecars and FALL THROUGH to
      // the DB cleanup below so the orphaned library entry is finally removed
      // -- fixes delete failing with a 500 and leaving the item stuck in the
      // list, still appearing playable.
      console.warn(`Delete: file already gone (${filePath}) -- removing the library entry anyway.`);
      const thumbPath = path.join(THUMBNAIL_DIR, `${item.id}.jpg`);
      try { if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath); } catch (_) { /* best-effort */ }
      const transcodeFile = transcodedPath(item.id);
      try { if (fs.existsSync(transcodeFile)) fs.unlinkSync(transcodeFile); } catch (_) { /* best-effort */ }
      // (fileRemainsOnDisk stays false -- the file is genuinely gone.)
    } else if (readOnly && removeAnyway) {
      // The caller has already been told about the read-only/permission
      // failure and explicitly asked to remove the library entry anyway.
      // Best-effort the sidecars too, but a sidecar failure must never block
      // the db cleanup below -- the underlying file is deliberately left on
      // disk either way, and will be re-indexed on the mount's next rescan.
      fileRemainsOnDisk = true;
      const thumbPath = path.join(THUMBNAIL_DIR, `${item.id}.jpg`);
      try { if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath); } catch (_) { /* best-effort */ }
      const transcodeFile = transcodedPath(item.id);
      try { if (fs.existsSync(transcodeFile)) fs.unlinkSync(transcodeFile); } catch (_) { /* best-effort */ }
    } else if (readOnly) {
      // Distinct, actionable failure -- db is left COMPLETELY untouched (the
      // updateDatabase cleanup below never runs) so the client can offer a
      // "remove from library anyway?" follow-up (re-request with
      // ?removeAnyway=true) rather than silently losing the library entry.
      console.error(`Cannot delete file ${filePath} (${err.code}):`, err.message);
      return res.status(409).json({
        error: `Could not delete the file: this location is read-only or permission-denied (${err.code}). The file was not removed.`,
        code: err.code,
        readOnly: true,
      });
    } else {
      // FS failure -- db is left completely untouched (the updateDatabase
      // metadata/progress cleanup below never runs), preserving today's
      // 500-on-FS-failure contract.
      console.error(`Error deleting file ${filePath}:`, err);
      return res.status(500).json({ error: `Could not delete file: ${err.message}` });
    }
  }

  // Clean up database entries -- either after the FS cleanup above succeeded,
  // or after an opt-in removeAnyway on a read-only/permission failure.
  // Idempotent under a concurrent duplicate delete (deleting an already-gone
  // key is a no-op either way; `return true` unconditionally is fine since
  // the mutator's `delete` calls are naturally idempotent).
  try {
    await updateDatabase(freshDb => {
      delete freshDb.metadata[item.id];
      delete freshDb.progress[item.id];
      return true;
    });
  } catch (err) {
    // Express 4 does not catch a rejected async-handler promise, so a
    // rejection left unguarded here would hang the request instead of
    // returning 500. The file (and its thumbnail/transcode sidecar) is
    // already gone from disk at this point -- only the db-metadata cleanup
    // failed to persist.
    console.error(`Error updating database after deleting ${filePath}:`, err);
    return res.status(500).json({ error: `File deleted from disk but failed to update database: ${err.message}` });
  }

  if (fileRemainsOnDisk) {
    return res.json({
      success: true,
      fileRemainsOnDisk: true,
      message: 'Removed from your library. Note: the file remains on disk -- if this location is still scanned, it may reappear on the next scan.',
    });
  }

  res.json({ success: true, message: 'File deleted successfully' });
});

// ---- v1.30 C2 (Visual polish cluster): Like -> "Liked" playlist --------
//
// Like state IS membership in `db.liked` (an array of media ids) -- there is
// no separate boolean flag anywhere (not on `db.metadata[id]`, not in
// settings) to ever drift out of sync with it. All three routes below are
// REAL mutations through `updateDatabase`: unlike the progress coalescer
// (v1.30 A4), every invocation here produces exactly ONE atomic write+fsync
// -- the mutator always `return`s `true` (never skips the save), the same
// "naturally idempotent, always-write" posture `DELETE /api/videos/:id`
// already uses for its own db-cleanup step above (see that handler's own
// comment) -- so AC4.2's "1:1 write-per-invocation, not batched" holds even
// on a duplicate add / a remove-of-a-non-member.

// API: Like an item (idempotent add). 404s exactly like the other single-id
// routes above if the id isn't a real library item -- mirrors
// `DELETE /api/videos/:id`'s own existence-check-then-mutate shape.
app.post('/api/liked/:id', async (req, res) => {
  const db = getCachedDatabase(); // v1.30 A3: hot GET reader (existence check only)
  const item = db.metadata[req.params.id];
  if (!item) {
    return res.status(404).json({ error: 'Media file not found' });
  }
  await updateDatabase(freshDb => {
    if (!Array.isArray(freshDb.liked)) freshDb.liked = [];
    if (!freshDb.liked.includes(item.id)) freshDb.liked.push(item.id);
    return true; // always exactly 1 atomic write per invocation (AC4.2), even on an idempotent re-add
  });
  res.json({ success: true, liked: true });
});

// API: Unlike an item (idempotent remove). No existence-in-metadata gate --
// removing membership for an id that's already absent (or was since deleted
// from the library entirely) is itself the desired end state, nothing to
// 404 on.
app.delete('/api/liked/:id', async (req, res) => {
  const id = req.params.id;
  await updateDatabase(freshDb => {
    if (!Array.isArray(freshDb.liked)) freshDb.liked = [];
    freshDb.liked = freshDb.liked.filter(likedId => likedId !== id);
    return true; // always exactly 1 atomic write per invocation (AC4.2), even on a non-member remove
  });
  res.json({ success: true, liked: false });
});

// API: List liked items -- reuses the SAME `{items,total,offset,limit}`
// shaping / sort+pagination pipeline `GET /api/videos` (T6, A5) established,
// scoped down to the ids currently present in `db.liked`. Read-only; never
// mutates membership.
app.get('/api/liked', (req, res) => {
  const db = getCachedDatabase(); // v1.30 A3: hot GET reader
  const likedIds = new Set(Array.isArray(db.liked) ? db.liked : []);
  const sort = typeof req.query.sort === 'string' ? req.query.sort : 'newest';
  const limit = videoQuery.normalizeLimit(req.query.limit);
  const offset = videoQuery.normalizeOffset(req.query.offset);
  const seed = videoQuery.normalizeSeed(req.query.seed);

  let list = Object.values(db.metadata).filter(item => likedIds.has(item.id));
  // v1.32: the Liked view is now a real library scope (main.js's ?liked=1)
  // -- honor the same format toggle the home grid forwards, so
  // videos/audio/both filtering behaves identically in both views.
  if (typeof req.query.format === 'string') {
    list = videoQuery.filterByFormat(list, req.query.format);
  }

  // `total` is the full liked-set length (after format filtering), BEFORE
  // slicing to a page -- same contract as GET /api/videos's own `total`.
  const total = list.length;

  const rng = sort === 'random' && seed !== undefined ? videoQuery.createSeededRng(seed) : undefined;
  const sorted = videoQuery.sortItems(list, sort, rng);
  const page = sorted.slice(offset, offset + limit);

  const items = page.map(item => {
    const progress = effectiveProgress(item.id) || { timestamp: 0, duration: 0 };
    return {
      ...item,
      liked: true, // every item in this listing is, by construction, a liked member
      progress: progress.timestamp,
      progressPercent: progress.duration > 0 ? (progress.timestamp / progress.duration) * 100 : 0
    };
  });

  res.json({ items, total, offset, limit });
});

// ---- C1 (v1.24 UX Round, Wave 3): move files between folders + id re-key --
//
// LOAD-BEARING GROUNDING FACT (docs/exec-plans/active/2026-07-09-v1.24-ux-round.md
// Design section): `getMediaId(filePath)` is `md5(filePath)` -- the media id
// is a hash of the PATH, not of content. Watch progress (`db.progress[id]`),
// thumbnails (`THUMBNAIL_DIR/<id>.jpg`) and transcode sidecars
// (`transcodedPath(id)`) are all keyed by that id. A naive `fs.rename`-then-
// rescan would therefore make a moved file look like a delete (old id
// pruned, progress lost) + a brand-new add (new id, no history). The two
// functions below exist specifically to prevent that: `computeMoveTarget`
// resolves + CONFINES the destination (pure, zero filesystem access) before
// any FS op ever runs; `moveItemToFolder` does the FS move, then re-keys
// `db.metadata`/`db.progress` and renames the thumbnail/transcode/subtitle
// sidecars from the OLD path-derived id to the NEW one, all inside ONE
// `updateDatabase` mutator -- so the next scan finds the file already
// indexed under its new-path id and takes the reuse fast-path, history
// intact, not a delete+new-add.

/**
 * Which folders is a move allowed to land in? Mirrors `runScanDirectories`'s
 * own `currentFolders` construction (server.js, scan path): the operator's
 * configured `db.folders` PLUS the yt-dlp module's own download root(s)
 * (`ytdlp.extraScanRoots`, a no-op empty array when the module is disabled --
 * this never opens a route/surface the disabled-module no-op guarantee
 * forbids). Deliberately the RAW, un-realpath'd spellings (never
 * `fs.realpathSync`'d) -- see FIX-1's comment above `runScanDirectories` for
 * why resolving a scan root's spelling would silently change every
 * `getMediaId` hash under it. Dedup doesn't matter here (this is a pure
 * membership check, not something walked), so no `normalizeScanRoot` dedup
 * pass is needed.
 */
function configuredLibraryRoots(db) {
  const ytdlpConfig = ytdlp.parseYtdlpConfig();
  return [...((db && db.folders) || []), ...ytdlp.extraScanRoots(ytdlpConfig)];
}

/**
 * Pure: resolve and CONFINE a move's destination. `filePath` is the item's
 * CURRENT on-disk path (trusted -- it is already indexed in `db.metadata`);
 * `targetFolder` is UNTRUSTED client input; `allowedRoots` is the server's
 * own configured library roots (`configuredLibraryRoots`, above). No
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
 * id). `allowedRoots` (`configuredLibraryRoots`, below) is therefore an
 * OPERATOR-TRUSTED, absolute/canonical surface, not something re-verified
 * against the real filesystem tree at move time: a symlink an operator
 * chooses to plant inside a configured root is out of the external threat
 * model on this single-user LAN box, same as everywhere else this codebase
 * makes that call.
 *
 * Returns `{ ok:true, newPath }` on success, `{ ok:false, error }` otherwise.
 */
function computeMoveTarget(filePath, targetFolder, allowedRoots) {
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

  const baseName = path.basename(filePath);
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
 * caller's own try/catch (mirroring every other route in this file) can log
 * and 500.
 *
 * @param {{loadDatabase: Function, updateDatabase: Function, getMediaId: Function, fs?: object}} deps
 * @param {string} id current media id
 * @param {string} targetFolder untrusted client-supplied destination folder
 */
async function moveItemToFolder(deps, id, targetFolder) {
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
  const target = computeMoveTarget(item.filePath, targetFolder, allowedRoots);
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
      try {
        fsImpl.copyFileSync(oldPath, newPath, fs.constants.COPYFILE_EXCL);
      } catch (copyErr) {
        if (copyErr && copyErr.code === 'EEXIST') {
          return { ok: false, status: 409, error: 'A file already exists at the destination' };
        }
        return { ok: false, status: 500, error: `Could not move the file across devices: ${copyErr.message}` };
      }
    } else {
      return { ok: false, status: 500, error: `Could not move the file: ${err.message}` };
    }
  }

  // The exclusive link/copy above succeeded: the file's bytes now exist at
  // BOTH oldPath and newPath (same inode via hard link, or an independent
  // copy cross-device). Remove the source. If THIS fails, degrade
  // gracefully rather than discarding a move that already succeeded: log and
  // continue -- the file is correctly readable at `newPath` either way. A
  // crash between the link/copy above and this unlink leaves a self-healing
  // dual hardlink (same inode, same content -- NOT data loss, and strictly
  // safer than the previous silent-clobber this replaces); the next scan
  // simply sees the file twice until the stale directory entry is cleaned up.
  try {
    fsImpl.unlinkSync(oldPath);
  } catch (err) {
    console.error(`Move: file linked/copied to ${newPath} but the old path ${oldPath} could not be removed:`, err.message);
  }

  // Single updateDatabase mutator, AFTER the FS move above succeeded:
  // re-key db.metadata/db.progress and rename every id-keyed sidecar. Every
  // sidecar rename is best-effort/idempotent (own try/catch) -- a thumbnail/
  // transcode/subtitle rename failure never blocks the re-key itself; the
  // file is already physically moved, so degrading gracefully here (log +
  // continue) beats leaving the db half-migrated.
  const oldId = id;
  let mutatorResult;
  try {
    mutatorResult = await updateDb((freshDb) => {
      const freshItem = freshDb.metadata[oldId];
      if (!freshItem) return false; // concurrently deleted -- nothing left to re-key

      const newId = computeId(newPath);

      freshItem.filePath = newPath;
      freshItem.id = newId;
      // Mirrors scanDirRecursive's own folderName derivation (immediate
      // parent dir basename) so the moved item's folder label doesn't go
      // stale until the next scan recomputes it anyway.
      freshItem.folderName = path.basename(path.dirname(newPath)) || freshItem.folderName;

      delete freshDb.metadata[oldId];
      freshDb.metadata[newId] = freshItem;

      if (Object.prototype.hasOwnProperty.call(freshDb.progress, oldId)) {
        freshDb.progress[newId] = freshDb.progress[oldId];
        delete freshDb.progress[oldId];
      }

      try {
        const oldThumb = path.join(THUMBNAIL_DIR, `${oldId}.jpg`);
        const newThumb = path.join(THUMBNAIL_DIR, `${newId}.jpg`);
        if (fsImpl.existsSync(oldThumb)) fsImpl.renameSync(oldThumb, newThumb);
      } catch (thumbErr) {
        console.error(`Move: failed to re-key thumbnail for ${oldId} -> ${newId}:`, thumbErr.message);
      }

      try {
        const oldTranscode = transcodedPath(oldId);
        const newTranscode = transcodedPath(newId);
        if (fsImpl.existsSync(oldTranscode)) fsImpl.renameSync(oldTranscode, newTranscode);
      } catch (transcodeErr) {
        console.error(`Move: failed to re-key transcode sidecar for ${oldId} -> ${newId}:`, transcodeErr.message);
      }

      // Subtitle sidecar (A6, T16 shipped in Wave 5; this rename is a T16
      // completion follow-up). Reuses `lib/subtitles.js`'s own
      // `findSubtitleSidecar` -- the SAME resolver the scan's `hasSubtitles`
      // detection and the `GET /api/subtitles/:id` serve route use -- so this
      // rename can never disagree with what those two consider "this item's
      // sidecar." That resolver's real priority order is (1) an
      // explicit-language VTT, `<base>.<lang>.vtt` (the shape yt-dlp's own
      // downloads actually land in per `OUTPUT_TEMPLATE`, e.g.
      // "Title [id].en.vtt"), (2) a bare `<base>.vtt`, (3) a bare `<base>.srt`
      // -- NOT just the bare-name shapes a naive `.vtt`/`.srt` loop would
      // catch. Whatever suffix follows the OLD basename (".en.vtt", ".vtt",
      // or ".srt") is preserved verbatim on the NEW basename, so a
      // language-tagged sidecar keeps its language tag across the move.
      try {
        const newDir = path.dirname(newPath);
        const oldBase = path.basename(oldPath, path.extname(oldPath));
        const newBase = path.basename(newPath, path.extname(newPath));
        const sidecar = subtitles.findSubtitleSidecar(oldPath, fsImpl);
        if (sidecar) {
          const oldSubName = path.basename(sidecar.path);
          const suffix = oldSubName.slice(oldBase.length); // e.g. ".en.vtt", ".vtt", ".srt"
          const newSub = path.join(newDir, newBase + suffix);
          if (fsImpl.existsSync(sidecar.path)) fsImpl.renameSync(sidecar.path, newSub);
        }
      } catch (subErr) {
        console.error(`Move: failed to re-key subtitle sidecar for ${oldId} -> ${newId}:`, subErr.message);
      }

      return newId;
    });
  } catch (err) {
    return {
      ok: false, status: 500,
      error: `File moved on disk but the database update failed: ${err.message}`,
      newPath,
    };
  }

  if (mutatorResult === false) {
    return { ok: false, status: 404, error: 'Media file was removed before the move could be recorded' };
  }

  return { ok: true, oldId, newId: mutatorResult, newPath };
}

// API: Move a video/audio file into another configured library folder (C1).
// Body: `{ targetFolder }`. See `moveItemToFolder`'s own comment for the full
// confinement + id re-key design -- this route is a thin HTTP wrapper around
// it. T19 (Wave 7, B2 Phase 2) calls `moveItemToFolder` directly for its own
// physical-reconcile move, without going through this route.
app.post('/api/videos/:id/move', async (req, res) => {
  const targetFolder = req.body && req.body.targetFolder;
  let result;
  try {
    result = await moveItemToFolder({ loadDatabase, updateDatabase, getMediaId }, req.params.id, targetFolder);
  } catch (err) {
    console.error(`Error moving file ${req.params.id}:`, err);
    return res.status(500).json({ error: `Could not move file: ${err.message}` });
  }
  if (!result.ok) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json({ success: true, id: result.newId, filePath: result.newPath });
});

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
// relocates the file via T9's `moveItemToFolder` (above) -- the SAME atomic
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
// see the `require.main === module` block below) is a harmless no-op once the
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
// path in this file gets; nothing here bypasses it.
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

// ---- Metadata+subtitle re-pull backfill (v1.25 QoL follow-up) -------------
// A user-triggered "re-pull" job re-fetches yt-dlp metadata (release date,
// channel avatar) and subtitles for an already-downloaded item, WITHOUT
// touching the media file itself -- so, unlike `moveItemToFolder`/
// `migrateOneOffsIntoChannelFolders` above, the item's id is completely
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
// `ytdlp.registerRoutes(app, {...})` call, below in this file) -- NOT a
// second `require('../../server')` from `lib/ytdlp/index.js`. That module is
// itself `require()`d near the top of THIS file, before `module.exports` is
// assigned, so a `require('../../server')` from inside it would only ever
// observe an incomplete (still-`{}`) exports object -- the deps bridge is
// what avoids that circular-require trap, exactly like every other
// server.js-owned primitive this module already receives.
//   - `enumerateRepullableItems` takes `(db, config)` directly (no db access
//     of its own) -- the caller already has a fresh `db` (from `deps.loadDatabase()`)
//     and its own parsed yt-dlp config in hand.
//   - `recordRepulledItemMeta` takes `(deps, mediaId, meta, nowMs)` -- pass
//     the SAME `deps` object `registerRoutes` itself received.

/**
 * Pure eligibility gate: classify every `db.metadata` item as re-pullable or
 * not, without touching the filesystem or the database. An item is eligible
 * iff it physically lives under the module's own yt-dlp download root
 * (`ytdlp.extraScanRoots(config)`) -- mirroring the scan bridge's own
 * scoping so a non-yt-dlp library file is never fed a re-pull job.
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
 * Each eligible item's own `metadataRepulledAt` (already set by a prior
 * `recordRepulledItemMeta` call, or absent) is surfaced as `alreadyRepulled`
 * so the caller can decide whether to skip it (a `force` re-run is the
 * caller's own concern -- this helper only classifies, it never filters on
 * that flag itself).
 *
 * @param {object} db a `loadDatabase()`-shaped db snapshot
 * @param {object} config a parsed yt-dlp config (`ytdlp.parseYtdlpConfig()`)
 * @returns {{items: Array<{mediaId: string, filePath: string, videoId: string|null, watchUrl: string|null, alreadyRepulled: boolean}>, eligible: number, ineligible: number}}
 */
function enumerateRepullableItems(db, config) {
  const result = { items: [], eligible: 0, ineligible: 0 };
  const metadata = (db && db.metadata) || {};
  const downloadRoots = ytdlp.extraScanRoots(config);
  if (downloadRoots.length === 0) {
    result.ineligible = Object.keys(metadata).length;
    return result;
  }

  for (const id of Object.keys(metadata)) {
    const item = metadata[id];
    if (!item || typeof item.filePath !== 'string' || item.filePath === '') {
      result.ineligible++;
      continue;
    }
    // Same double-scoping as the scan's own channel-identity bridge: rooted
    // under the download dir AND filename-shaped like a yt-dlp download.
    if (!matchRootFolder(item.filePath, downloadRoots)) {
      result.ineligible++;
      continue;
    }
    const baseName = path.basename(item.filePath, path.extname(item.filePath));
    // v1.33 T1: filename `[id]` bracket first; else a previously-persisted
    // `youtubeId` (scan backfill / a prior reheat's own discovery),
    // re-checked through isSafeVideoId (untrusted-until-proven, same as
    // every other persisted-then-reread field). An item with NEITHER is no
    // longer ineligible: it flows through with null videoId/watchUrl so the
    // batch worker's LOCAL ffprobe pass (embedded date/purl/title -- the
    // only shot a bracket-less metube-era import gets) still runs; the
    // worker derives a watch URL from an embedded purl on the fly when one
    // exists (see runRepullMetadataBatch, lib/ytdlp/index.js).
    const bracketId = extractYtdlpVideoId(baseName);
    const videoId = bracketId || (isSafeVideoId(item.youtubeId) ? item.youtubeId : null);
    const watchUrl = videoId ? buildWatchUrl(videoId) : null;

    result.items.push({
      mediaId: getMediaId(item.filePath),
      filePath: item.filePath,
      videoId,
      watchUrl,
      alreadyRepulled: !!item.metadataRepulledAt,
    });
    result.eligible++;
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
 *   `consumeDownloadChannelMeta` bridge already applies, ~line 1769) -- a
 *   re-pull is a deliberate refresh, not a gap-fill, so it must never lose to
 *   a stale/mtime-derived value the way the scan's ADDITIVE
 *   `hasOwnProperty`-guarded backfills (~1526/1563) do.
 * - `meta.channelAvatarUrl`, when a non-empty string, is set the same way.
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
 *   happens here), so `db.progress[mediaId]` and every id-keyed sidecar
 *   (thumbnail, transcode) stay bound to the exact same id, untouched.
 * - A `mediaId` no longer present in `db.metadata` (the item was deleted
 *   concurrently, mid-run) is a safe no-op: the mutator returns `false`
 *   (skips the save) and this function resolves to `false`.
 *
 * @param {{loadDatabase?: Function, updateDatabase: Function, getMediaId?: Function}} deps
 * @param {string} mediaId
 * @param {{releaseDate?: number, channelAvatarUrl?: string, filePath: string, markComplete?: boolean}} meta
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
    if (typeof m.channelAvatarUrl === 'string' && m.channelAvatarUrl !== '') {
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

// API: Library-wide "fun stats" dashboard (C4, v1.24 UX Round Wave 3).
// Computed LIVE from `db.metadata` on every request via the pure helpers in
// `lib/stats.js` -- deliberately no cached aggregate (see that module's
// header comment): at home-server scale an O(n) pass per request is trivial
// and always fresh, and a cache would need its own invalidation story for no
// real benefit.
app.get('/api/stats', (req, res) => {
  const db = getCachedDatabase(); // v1.30 A3: pure read on a request/serve path
  res.json(stats.computeLibraryStats(db.metadata));
});

// API: Record a watch-page open, for C4 "most-watched" (v1.24 UX Round,
// Wave 3). A dedicated, separate route -- deliberately NOT folded into
// `POST /api/progress` (fires repeatedly throughout playback via periodic
// timestamp saves, which would over-count a single watch many times over)
// and NOT hung off `GET /video/:id` (the Range-serve route, which fires many
// times per single playback -- once per byte-range chunk a browser
// requests). Callers (the watch page) are expected to call this ONCE per
// watch-page open. `viewCount` is an additive integer that defaults to 0
// when absent on an existing record -- a pre-v1.24 record simply has no
// `viewCount` field yet, treated as zero here rather than ever triggering a
// re-processing/re-scan pass to "fill it in" (the thumbnail-backfill-
// regression lesson: a field default is not a reason to reprocess).
app.post('/api/videos/:id/view', async (req, res) => {
  let notFound = false;
  let viewCount = 0;
  try {
    await updateDatabase(db => {
      const item = db.metadata[req.params.id];
      if (!item) {
        notFound = true;
        return false;
      }
      const current = (typeof item.viewCount === 'number' && Number.isFinite(item.viewCount) && item.viewCount >= 0) ? item.viewCount : 0;
      item.viewCount = current + 1;
      viewCount = item.viewCount;
      return true;
    });
  } catch (err) {
    // Express 4 does not catch a rejected async-handler promise, so a
    // rejection left unguarded here would hang the request instead of
    // returning 500 (mirrors POST /api/progress's own pattern above).
    console.error(`Error recording view for ${req.params.id}:`, err);
    return res.status(500).json({ error: `Could not record view: ${err.message}` });
  }
  if (notFound) return res.status(404).json({ error: 'Media file not found' });
  res.json({ success: true, viewCount });
});

// API: lazy per-item dimensions backfill (Feature A, v1.26.1, Shorts
// player-size jump). The scan only ever captures `width`/`height` on a
// video's initial (new/updated-file) probe -- see the comment above
// `newMetadata[id].width = meta.width` -- so any item indexed before this
// release, or whose original probe failed to yield usable dims, has none.
// Rather than a library-wide re-probe sweep on upgrade (the exact class of
// regression the thumbnail-backfill lesson warns against), the PLAYER
// itself calls this once it has genuinely observed the real dimensions
// (`<video>`'s own `videoWidth`/`videoHeight` at `loadedmetadata`,
// player.js) -- so the FIRST play of a legacy item settles late (same as
// today) but the SECOND play is jump-free. Fire-and-forget from the client:
// this endpoint's own success/failure never affects playback.
//
// Validates: a positive-integer, sane-bounded (`isValidMediaDimension`,
// shared with the ffprobe-side parse above) width/height; the item exists;
// the item is a VIDEO (never audio -- mirrors the scan's own `!isAudio`
// guard). No-clobber: an item that already carries BOTH `width` and
// `height` is left completely untouched -- this endpoint only ever fills a
// gap, exactly like the release-date/hasSubtitles backfills elsewhere in
// this file. A malformed/late-arriving/duplicate POST (e.g. a stray second
// `loadedmetadata` firing for the same load) is therefore always safe to
// retry: it either fills the gap once or silently no-ops.
app.post('/api/videos/:id/dimensions', async (req, res) => {
  const body = req.body || {};
  // F3: reject a non-primitive-numeric body BEFORE Number() ever runs -- see
  // isPrimitiveNumericInput's own comment for exactly which shapes this
  // guards against ([1920], true, '0x10', etc.).
  if (!isPrimitiveNumericInput(body.width) || !isPrimitiveNumericInput(body.height)) {
    return res.status(400).json({ error: `width and height must be positive integers <= ${MAX_MEDIA_DIMENSION}` });
  }
  const width = Number(body.width);
  const height = Number(body.height);
  if (!isValidMediaDimension(width) || !isValidMediaDimension(height)) {
    return res.status(400).json({ error: `width and height must be positive integers <= ${MAX_MEDIA_DIMENSION}` });
  }
  let notFound = false;
  let wrongType = false;
  let applied = false;
  try {
    await updateDatabase(db => {
      const item = db.metadata[req.params.id];
      if (!item) {
        notFound = true;
        return false;
      }
      if (item.type !== 'video') {
        wrongType = true;
        return false;
      }
      if (item.width && item.height) {
        return false; // no-clobber: dims already known -- nothing to do
      }
      item.width = width;
      item.height = height;
      applied = true;
      return true;
    });
  } catch (err) {
    // Express 4 does not catch a rejected async-handler promise, so a
    // rejection left unguarded here would hang the request instead of
    // returning 500 (mirrors POST /api/videos/:id/view's own pattern above).
    console.error(`Error recording dimensions for ${req.params.id}:`, err);
    return res.status(500).json({ error: `Could not record dimensions: ${err.message}` });
  }
  if (notFound) return res.status(404).json({ error: 'Media file not found' });
  if (wrongType) return res.status(400).json({ error: 'Dimensions only apply to video items' });
  res.json({ success: true, applied });
});

// API: Serve a subtitle track for a media item (A6, v1.24 UX Round, Wave 5).
// Deliberately lives HERE, not in the yt-dlp module -- subtitle GRAB is
// yt-dlp-module-adjacent (lib/ytdlp/args.js's buildYtdlpDownloadArgs), but
// subtitle SERVE is a general library feature, exactly like /video/:id and
// /thumbnail/:id above, and must work for LOCAL files with the yt-dlp module
// completely disabled (FILETUBE_YTDLP_ENABLED unset). This route touches
// nothing in lib/ytdlp -- only db.metadata/fs/lib/subtitles -- so it is
// reachable regardless of module enablement, same as those two routes.
//
// Trust boundary: `item.filePath` is an already-trusted, already-indexed
// path (the scan only ever writes db.metadata entries for files it walked
// under a configured library root) -- `findSubtitleSidecar` only ever reads
// the SAME directory that trusted path already lives in (see its own
// comment, lib/subtitles.js), so there is no separate confinement check to
// perform here: the confinement already happened once, at scan time,
// mirroring GET /video/:id's own trust posture. The only untrusted input is
// `:id` itself, and a hostile/unknown id simply misses the db.metadata
// lookup and 404s, same as every other /api/*/:id route in this file.
//
// A `.srt` sidecar is converted to VTT ON THE FLY via srtToVtt (no cached
// copy ever written to disk -- cheap, pure, string-only work); a `.vtt`
// sidecar is served as-is. 404s when the id is unknown, the sidecar read
// fails, or no sidecar exists at all.
app.get('/api/subtitles/:id', (req, res) => {
  const db = getCachedDatabase(); // v1.30 A3: hot GET reader
  const item = db.metadata[req.params.id];
  if (!item) {
    return res.status(404).json({ error: 'Media file not found' });
  }
  const sidecar = subtitles.findSubtitleSidecar(item.filePath);
  if (!sidecar) {
    return res.status(404).json({ error: 'No subtitle track available for this item' });
  }
  let vttText;
  try {
    const raw = fs.readFileSync(sidecar.path, 'utf8');
    vttText = sidecar.format === 'srt' ? subtitles.srtToVtt(raw) : raw;
  } catch (err) {
    console.error(`Error reading subtitle sidecar for ${req.params.id}:`, err);
    return res.status(404).json({ error: 'Subtitle file could not be read' });
  }
  res.setHeader('Content-Type', 'text/vtt');
  // FIX-7 (two-reviewer gate, cheap hardening): defense-in-depth alongside
  // the explicit `text/vtt` Content-Type above -- a browser that ignores (or
  // sniffs past) that header for any reason can never reinterpret this
  // response as something else (e.g. HTML) purely from its bytes.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(vttText);
});

// Serve extracted thumbnail or fallback placeholder
app.get('/thumbnail/:id', (req, res) => {
  const db = getCachedDatabase(); // v1.30 A3 (AC3.3 headline route): hot GET reader
  const item = db.metadata[req.params.id];
  const thumbPath = path.join(THUMBNAIL_DIR, `${req.params.id}.jpg`);

  if (item && item.hasThumbnail && fs.existsSync(thumbPath)) {
    return res.sendFile(thumbPath);
  }

  // Fallback: Generate SVG placeholder based on whether it is audio or video
  const isAudio = item ? item.type === 'audio' : false;
  const title = item ? item.title : 'Media';
  const bgColor = isAudio ? '#2b3e50' : '#4a154b';
  const icon = isAudio ? 
    `<path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" fill="#ffffff"/>` : 
    `<path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" fill="#ffffff"/>`;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" width="160" height="90">
      <rect width="160" height="90" fill="${bgColor}"/>
      <g transform="translate(68, 20) scale(1.2)">
        ${icon}
      </g>
      <text x="80" y="70" font-family="Arial, sans-serif" font-size="7" fill="#cccccc" text-anchor="middle" font-weight="bold">
        ${escapeHtml(title.length > 25 ? title.substring(0, 22) + '...' : title)}
      </text>
      <text x="80" y="80" font-family="Arial, sans-serif" font-size="5" fill="#888888" text-anchor="middle">
        ${isAudio ? 'AUDIO' : 'VIDEO'}
      </text>
    </svg>
  `;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(svg);
});

// HTML escaping helper
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Live on-demand transcode (desktop only — iOS Safari can't play a non-seekable
// live MP4). Pipes a fragmented H.264/AAC MP4 from FFmpeg; the client "seeks" by
// reloading at ?t=<seconds> (fast -ss input seek).
function streamLiveTranscode(req, res, item) {
  if (!ffmpegAvailable) {
    return res.status(503).json({ error: 'FFmpeg is not available for transcoding' });
  }
  const srcPath = item.filePath;
  if (!fs.existsSync(srcPath)) {
    return res.status(404).json({ error: 'File does not exist on disk' });
  }
  const start = Math.max(0, parseFloat(req.query.t) || 0);

  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' });

  const args = [];
  if (start > 0) args.push('-ss', String(start));
  args.push(
    '-i', srcPath,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', String(TRANSCODE_CRF), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', 'pipe:1'
  );

  let proc;
  try {
    proc = spawn('ffmpeg', args);
  } catch (e) {
    console.error(`Live transcode failed to start for ${srcPath}:`, e.message);
    return res.status(500).end();
  }
  proc.stdout.pipe(res);
  let errTail = '';
  proc.stderr.on('data', d => { errTail = (errTail + d.toString()).slice(-800); });
  proc.on('error', (e) => { console.error(`Live transcode error for ${srcPath}:`, e.message); try { res.end(); } catch (_) {} });
  proc.on('close', (code) => {
    if (code && code !== 0 && code !== 255) console.error(`Live transcode exit ${code} for ${srcPath}:\n${errTail}`);
    try { res.end(); } catch (_) {}
  });
  req.on('close', () => { proc.kill('SIGKILL'); });
}

// FR-3 (v1.19.0, download-to-device): builds a header-injection-SAFE
// `Content-Disposition: attachment` value from a media item's display
// `title` (never the raw on-disk name, which may carry yt-dlp's
// `--restrict-filenames`/`[id]` suffix or ffmpeg-transcode naming) and its
// ORIGINAL extension. Two forms, per RFC 6266 (and RFC 5987 for the
// extended parameter):
//  - an ASCII `filename="..."` fallback for legacy clients:
//    `replace(/[^\x20-\x7E]/g, '_')` strips every character OUTSIDE the
//    printable-ASCII range 0x20-0x7E -- this removes CR/LF and every other
//    control character -- and a second pass strips `"`/`\` (the two
//    characters a quoted-string would otherwise need backslash-escaping
//    for). A title containing CR/LF/quotes can therefore never terminate
//    the header early or inject a second header/param.
//  - a `filename*=UTF-8''<percent-encoded>` form carrying the REAL
//    (possibly non-ASCII) name: `encodeURIComponent` percent-encodes CR/LF
//    (`%0D`/`%0A`) and every other unsafe byte, so this form is equally
//    injection-safe and also gives modern browsers the correct non-ASCII
//    display name. `encodeURIComponent` over-encodes a few characters RFC
//    5987 technically allows bare (e.g. `!`) -- browsers accept this.
// Pure, no I/O -- exported for unit tests (see test/unit).
function contentDispositionAttachment(title, ext) {
  const safeExt = String(ext || '').replace(/[^A-Za-z0-9.]/g, '');
  const rawName = (title === undefined || title === null || title === '') ? 'download' : String(title);
  const fullName = rawName + safeExt;
  const asciiName = fullName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'download';
  // `encodeURIComponent` does not encode `'` (it is not in its reserved set),
  // but RFC 5987's `ext-value` grammar treats `'` as a delimiter (it separates
  // charset/language/value) -- so a bare `'` here is not a valid `attr-char`
  // and must be percent-encoded to keep the `filename*` value well-formed.
  const encoded = encodeURIComponent(fullName).replace(/'/g, '%27');
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}

// Shared Range-request byte-serving helper (v1.27.0), factored out of
// GET /video/:id's own Range-parsing/response-header logic so GET /audio/:id
// (the background-audio sidecar, below) can reuse the EXACT same mechanics
// rather than a forked copy that could silently drift. This owns ONLY the
// bytes-on-disk half: the existence check (-> 404 "File does not exist on
// disk", the same message/shape `/video/:id` already returns) and the
// Range vs. whole-file response. It does NOT do any id -> filePath
// resolution, db lookups, or the 404-on-unknown-id/503-in-progress handling
// -- callers own those (they differ meaningfully between /video/:id's
// transcode-in-progress branch and /audio/:id's extract-in-progress branch).
// `onServe(filePath)`, when provided, is invoked once the file is confirmed
// to exist and BEFORE any header is written -- both call sites use it for
// the existing markServed/recordServed live-watch protection.
//
// `/video/:id` is regression-locked to be byte-identical before/after this
// refactor (see test/integration/download-media.test.js and
// test/integration/audio-endpoint.test.js's own /video/:id parity checks).
function sendRangeable(req, res, filePath, contentType, onServe) {
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File does not exist on disk' });
  }
  if (onServe) onServe(filePath);

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    // F4 (two-reviewer gate): a malformed/reversed Range header (e.g.
    // `bytes=10-3` [end < start], `bytes=potato` [non-numeric -> NaN], or
    // `bytes=-5` [a suffix-range shape this simple parser doesn't support --
    // parses to a NaN start]) used to fall straight through to
    // `fs.createReadStream(filePath, { start, end })` with a NaN or
    // nonsensical range. That either threw synchronously -- an unhandled
    // exception Express's default error handler turns into a 500 whose body
    // includes a stack trace (leaking this server's absolute filesystem
    // paths) to an UNAUTHENTICATED caller -- or produced an undefined
    // stream. This was pre-existing on `/video/:id`; sharing this helper
    // makes it newly reachable on `/audio/:id` too, so it's fixed once, here,
    // for both. Every malformed shape (including the pre-existing
    // out-of-bounds `start >= fileSize` case) is now rejected the SAME way:
    // 416, with a `Content-Range: bytes */<size>` header giving the complete
    // length, per RFC 7233 §4.4 ("MUST send a Content-Range header field
    // with an unsatisfied-range value" alongside a 416) -- one unified,
    // spec-compliant shape rather than two different bodies for two
    // different malformed-input classes.
    if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < start || start >= fileSize) {
      res.status(416).set('Content-Range', `bytes */${fileSize}`).send('Requested range not satisfiable');
      return;
    }

    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    };

    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': contentType,
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
}

// Media streaming endpoint supporting Range requests (highly important for HTML5 seeking/skipping)
app.get('/video/:id', (req, res) => {
  const db = getCachedDatabase(); // v1.30 A3: hot GET reader
  const item = db.metadata[req.params.id];
  if (!item) {
    return res.status(404).json({ error: 'Media file not found' });
  }

  // FR-3 (v1.19.0): a download-intent request (`?download=1`) ALWAYS
  // bypasses the needsTranscode/live-transcode branch below and serves the
  // ORIGINAL file (`item.filePath`) -- even when a cached transcode already
  // exists -- because the transcode is a browser-playability sidecar, never
  // the canonical file a "Download" click should hand back. This is the
  // ONLY thing `download=1` changes: the id -> `db.metadata[id]` lookup, the
  // 404s, and the Range-capable send below are otherwise identical to
  // ordinary playback.
  const isDownload = req.query.download === '1';

  let filePath = item.filePath;

  // Browser-incompatible containers (AVI, etc.):
  //  - desktop asks for ?live=1 -> live transcode, plays instantly (not iOS-safe)
  //  - otherwise -> serve the pre-transcoded MP4 (seekable; works on iOS)
  if (item.needsTranscode && !isDownload) {
    if (req.query.live === '1') {
      return streamLiveTranscode(req, res, item);
    }
    const out = transcodedPath(item.id);
    if (fs.existsSync(out)) {
      filePath = out; // ready — stream it with full Range support
    } else {
      // Lazy transcode: kick off the conversion on first mobile request (not on scan),
      // then tell the client to wait/poll. Only AVIs actually watched on mobile get cached.
      if (item.transcodeStatus !== 'failed') {
        queueTranscode(item.id, item.filePath);
      }
      return res.status(503).json({ error: 'transcoding', status: item.transcodeStatus || 'pending' });
    }
  }

  // v1.27.0: this existence check (-> 404, byte-identical message) is kept
  // HERE, in the exact same place it always was, rather than folded into
  // `sendRangeable` below -- so this route's observable behavior (including
  // response ORDER relative to `isDownload`'s Content-Disposition header,
  // never set on a 404) is provably unchanged by the Range-serving refactor.
  // `sendRangeable` re-checks existence too (its own contract, shared with
  // GET /audio/:id below) -- a harmless, cheap redundant `fs.existsSync` on
  // this path, not a behavior change.
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File does not exist on disk' });
  }

  // Is the file we're about to send the cached transcoded copy? (Never true
  // for a download request -- `isDownload` skips the branch above that's the
  // only place `filePath` is ever set to `transcodedPath(item.id)`.)
  const servingCachedTranscode = filePath === transcodedPath(item.id);
  const contentType = servingCachedTranscode ? 'video/mp4' : (mime.lookup(filePath) || (item.type === 'audio' ? 'audio/mpeg' : 'video/mp4'));

  if (isDownload) {
    res.setHeader('Content-Disposition', contentDispositionAttachment(item.title, item.ext));
  }

  // The actual Range-vs-whole-file response now lives in the shared
  // `sendRangeable` helper (above) -- byte-identical to the inline version
  // this replaced. Serving a cached transcode? Mark it recently-served so
  // eviction leaves it alone while it's being watched, and persist the
  // last-served timestamp (throttled/no-clobber) that the age-retention
  // sweep keys off -- unchanged from before the refactor, just relocated
  // into the shared `onServe` callback.
  sendRangeable(req, res, filePath, contentType, () => {
    if (servingCachedTranscode) {
      markServed(filePath);
      recordServed(item.id);
    }
  });
});

// GET /audio/:id (v1.27.0, background-audio-for-video, EXPERIMENTAL): serves
// the audio-only sidecar extracted from a VIDEO item, for the mobile
// background-audio handoff (see docs comment on queueAudioExtract above).
// Mirrors GET /video/:id's transcode-in-progress 503 contract exactly (same
// `{ error, status }` shape) so the client's existing polling/error-handling
// patterns generalize with no special-casing.
//
//  - Unknown id -> 404 `{ error: 'Media file not found' }` (same shape as
//    /video/:id).
//  - Item is type 'audio' (not a video) -> 404. Simplest-correct choice:
//    this endpoint exists to hand a VIDEO's audio track off to a hidden
//    <audio> element while its own <video> is suspended in the background --
//    an audio item is ALREADY just audio (no video to suspend, no handoff to
//    perform), so there is no sidecar and never will be one. A 503 (implying
//    "come back later, this will become ready") would be actively
//    misleading here; the client-side handoff logic is gated on
//    `data.type !== 'audio'` and is never expected to call this for an
//    audio item at all, so this 404 is purely a defense-in-depth contract,
//    not a path any correct client should exercise.
//  - `audioPath(id)` already on disk -> served via the SAME `sendRangeable`
//    helper `/video/:id` uses (Range support + the live-watch protection).
//  - No sidecar yet, ffmpeg unavailable -> 503 `{ error: 'ffmpeg unavailable' }`
//    -- never silently 404s (that would look like "no such media"), and
//    never enqueues a doomed job.
//  - No sidecar yet, ffmpeg available -> enqueue extraction
//    (`queueAudioExtract`) and return 503 `{ error: 'extracting', status }`.
//    The client's real background-event handoff logic never calls this
//    endpoint mid-event (there's no time to wait on a fresh extraction --
//    see player.js's `shouldHandOffToBackgroundAudio`, which only ever acts
//    on an ALREADY-known-ready status); this 503 path exists for the
//    pre-warm route below and any other caller that DOES want to kick off
//    (and eventually observe) extraction.
//
// F1 (two-reviewer gate, v1.27.0): heals a stale `audioStatus: 'ready'`
// discovered at request time. Without this, an evicted/aged-out sidecar
// (see evictTranscodeCache/sweepAgedTranscodes) left `audioStatus: 'ready'`
// in `db.metadata` (before the cache-deletion healing above was added) --
// or a sidecar removed by any OTHER means (a manual `rm` in TRANSCODE_DIR,
// a restore from an older backup, etc.) -- would let a client that trusts a
// cached 'ready' snapshot (see player.js setupForMedia's own comment) skip
// straight to a real background handoff and 503 with no sidecar to serve,
// silently pausing instead of handing off. Both call sites below only ever
// reach this AFTER their own `fs.existsSync(audioPath(...))` check has
// already failed, so `item.audioStatus === 'ready'` at this point is
// PROVABLY stale -- this is the earliest point it can be corrected (there is
// no scan-time reconciliation for audio the way `reconcileTranscode`
// provides for `transcodeStatus`; extraction is entirely on-demand, never
// scan-driven -- see queueAudioExtract's own comment).
//
// v1.30 A3 update (cache-coherency, HIGHEST gate): this used to mutate
// `item.audioStatus` IN PLACE, relying on `item` always being each request's
// own freshly-`loadDatabase()`-read, per-request-throwaway object. Now that
// `GET /audio/:id` (below) reads through `getCachedDatabase()`, `item` can be
// a reference into the SHARED cached db object -- mutating it in place here
// would violate the cache's "replaced by reference, never mutated in place"
// invariant (the persisted write still goes through `setAudioStatus` ->
// `updateDatabase`, which is the one place allowed to replace the cache; see
// its own comment above `dbCache`). So this now returns the healed status
// instead of mutating `item`, and both call sites use the RETURN VALUE for
// the rest of their own logic rather than re-reading `item.audioStatus`.
function healStaleAudioReady(item) {
  if (item.audioStatus === 'ready') {
    setAudioStatus(item.id, 'pending');
    return 'pending';
  }
  return item.audioStatus;
}

app.get('/audio/:id', (req, res) => {
  const db = getCachedDatabase();
  const item = db.metadata[req.params.id];
  if (!item) {
    return res.status(404).json({ error: 'Media file not found' });
  }
  if (item.type === 'audio') {
    return res.status(404).json({ error: 'Media file not found' });
  }
  const out = audioPath(item.id);
  if (fs.existsSync(out)) {
    return sendRangeable(req, res, out, 'audio/mp4', () => {
      markServed(out);
      recordServed(item.id);
    });
  }
  // F1: sidecar confirmed missing -- heal any stale 'ready' NOW. Use the
  // returned (healed) status below, never `item.audioStatus` again -- see
  // healStaleAudioReady's own comment for why `item` must not be mutated.
  const healedAudioStatus = healStaleAudioReady(item);
  if (!ffmpegAvailable) {
    return res.status(503).json({ error: 'ffmpeg unavailable' });
  }
  if (healedAudioStatus !== 'failed') {
    queueAudioExtract(item.id, item.filePath);
  }
  return res.status(503).json({ error: 'extracting', status: healedAudioStatus || 'pending' });
});

// POST /api/videos/:id/prepare-audio (v1.27.0, EXPERIMENTAL): the pre-warm
// hook for the background-audio handoff. The client fires this the moment a
// mobile playback session starts for a VIDEO with the `backgroundAudioForVideo`
// setting ON, so the audio-extract sidecar is USUALLY ready before the first
// real background event needs it (there's no time to extract mid-handoff --
// see GET /audio/:id's own comment). Deliberately a cheap POST that never
// serves bytes -- not a GET /audio/:id HEAD-style kick: a HEAD request would
// need the exact same 503-vs-200 branching as a real GET (Express's HEAD
// handling for a GET route already strips the body, but the 503 JSON error
// body callers actually want to read is exactly what HEAD throws away), and
// a bare `fetch(..., { method: 'HEAD' })` against a Range-serving route is
// easy to confuse with an accidental real playback request on a slow
// connection. This route only enqueues (or reports "already ready") and
// returns a tiny JSON status -- no Range/streaming machinery at all.
// Idempotent and bounded by queueAudioExtract's own de-dupe guard (mirrors
// queueTranscode's) -- never enqueues a second job for an id already
// queued/in-flight, and never re-enqueues once a sidecar already exists on
// disk.
app.post('/api/videos/:id/prepare-audio', (req, res) => {
  // v1.30 A3: intentionally left on `loadDatabase()`, not switched to the
  // cache -- outside T4's explicit hot-GET-reader scope (a POST pre-warm
  // hook, not a GET route), and staying on a fresh per-request throwaway
  // object here costs nothing meaningful (this route never streams bytes).
  const db = loadDatabase();
  const item = db.metadata[req.params.id];
  if (!item) {
    return res.status(404).json({ error: 'Media file not found' });
  }
  if (item.type === 'audio') {
    return res.status(400).json({ error: 'prepare-audio only applies to video items' });
  }
  if (fs.existsSync(audioPath(item.id))) {
    return res.json({ audioStatus: 'ready' });
  }
  // F1: sidecar confirmed missing -- heal any stale 'ready' NOW. Use the
  // returned (healed) status below, never `item.audioStatus` again -- see
  // healStaleAudioReady's own comment (above GET /audio/:id) for why `item`
  // is never mutated in place.
  const healedAudioStatus = healStaleAudioReady(item);
  if (!ffmpegAvailable) {
    return res.status(503).json({ error: 'ffmpeg unavailable' });
  }
  if (healedAudioStatus !== 'failed') {
    queueAudioExtract(item.id, item.filePath);
  }
  res.json({ audioStatus: healedAudioStatus || 'pending' });
});

// Optional yt-dlp subscription module (v1.11.0): registered AFTER every
// existing route so enabling it can never shadow/interfere with one. This
// call is a no-op when FILETUBE_YTDLP_ENABLED is unset/off --
// registerRoutes' first line early-returns before adding anything to the
// router, so every /api/subscriptions* request falls through to Express's
// native 404 (see lib/ytdlp/index.js). `deps` are the existing primitives
// the module's later tasks (persistence/poll) need; T1 doesn't call any of
// them from the disabled path. `recordRepulledItemMeta`/`enumerateRepullableItems`
// (v1.25 QoL follow-up, metadata+subtitle re-pull backfill) are bridged
// through this SAME deps object -- see their own header comments (above
// `migrateOneOffsIntoChannelFolders`'s `GET /api/stats` neighbor) for the
// full wiring-contract rationale (a `require('../../server')` from inside
// lib/ytdlp/index.js would hit a circular-require trap; this deps object is
// what avoids it, exactly like every other primitive below).
ytdlp.registerRoutes(app, {
  updateDatabase,
  loadDatabase,
  scanDirectories,
  getMediaId,
  recordRepulledItemMeta,
  enumerateRepullableItems,
  // v1.33 T1: the reheat batch's LOCAL tags probe (cheap ffprobe, no
  // network) -- server.js owns ffmpeg/ffprobe, so the yt-dlp module gets it
  // deps-injected like every other server-owned primitive above.
  probeEmbeddedTags,
  // v1.29.0 T3: the app's own DATA_DIR (resolved above, the SAME directory
  // db.json lives in) -- threaded through so lib/ytdlp/index.js's run-log
  // emit sites (`processSubscription`/`runOneShot`, via `deps.dataDir`) know
  // where to write `ytdlp-runs.jsonl`, without lib/ytdlp/index.js ever
  // resolving DATA_DIR/config.downloadDir itself (see lib/ytdlp/runlog.js's
  // own module comment).
  dataDir: DATA_DIR,
});

// Start the server — but only when run directly (`node server.js`), not when
// required by the test suite. This lets tests import `app` and the pure helpers
// without binding a port or triggering a real scan.
if (require.main === module) {
  // Defense-in-depth: every genuine db.json write path already guards its own
  // `updateDatabase` call with a try/catch or `.catch`, but a stray unguarded
  // rejection/throw slipping past that (a bug, not an expected path) must LOG
  // rather than hang a request or crash the process -- Node 22's default for
  // an unhandled rejection is to terminate. Log-only, never exit.
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
  });

  // v1.30 A4 (AC4.3, shutdown flush): persist any queued-but-not-yet-flushed
  // watch position before the process actually exits, on every graceful-exit
  // path the design calls for. Reuses `flushPendingProgress` itself -- the
  // SAME serialized `updateDatabase` write the periodic debounce timer uses
  // (see its own comment above `pendingProgress`), so this can never race a
  // concurrent in-flight real mutation with a second, direct-to-disk bypass.
  // `process.exit(0)` after a SIGTERM/SIGINT flush restores the pre-A4
  // immediate-exit-on-signal behavior (now WITH a flush first) -- registered
  // only inside this `require.main === module` guard (mirrors every other
  // startup/shutdown side effect in this block) so importing this module for
  // tests never installs a listener that would swallow Ctrl-C or otherwise
  // change process-signal behavior during a test run; `flushPendingProgress`
  // itself stays independently exported/testable (see its own comment) for
  // exercising the flush semantics directly. On a hard SIGKILL none of this
  // runs at all -- the accepted, bounded carve-out is losing at most one
  // `PROGRESS_FLUSH_MS` window of watch-position-only data; db.json itself
  // is never left torn either way (saveDatabase's write-temp-then-rename is
  // unaffected).
  const flushProgressOnExit = (exitAfter) => () => {
    flushPendingProgress().finally(() => {
      if (exitAfter) process.exit(0);
    });
  };
  process.on('SIGTERM', flushProgressOnExit(true));
  process.on('SIGINT', flushProgressOnExit(true));
  process.on('beforeExit', flushProgressOnExit(false));

  // Transcode-cache hygiene on startup: drop any orphaned *.tmp.mp4 left by a
  // killed transcode, then enforce the size cap.
  const orphans = cleanupOrphanTmp(TRANSCODE_DIR);
  if (orphans) console.log(`Cleaned up ${orphans} orphaned transcode temp file(s).`);
  // Same idea for db.json's own atomic-write temp files: a SIGKILL/OOM
  // between saveDatabase's openSync(tmp) and its rename can leave an orphan
  // `db.json.<pid>.<seq>.tmp` behind; sweep it on every boot.
  const dbOrphans = cleanupOrphanDbTmp(DATA_DIR);
  if (dbOrphans) console.log(`Cleaned up ${dbOrphans} orphaned db.json temp file(s).`);
  // Age sweep runs as a separate step immediately before the size-cap
  // eviction (never folded into evictTranscodeCache itself).
  sweepAgedTranscodes(Date.now());
  // v1.30 A3: this is the process's first-ever db read, so `getCachedDatabase()`
  // here is exactly one `loadDatabase()` call (same as before) and has the
  // added benefit of pre-warming the cache before `app.listen` below, so the
  // very first request already hits a warm cache.
  evictTranscodeCache(effectiveCacheCap(getCachedDatabase().settings));

  // T4 (v1.25 QoL) + the scan/timer sequence below are wrapped in a single
  // async IIFE (this file is CommonJS -- no top-level `await`) so the
  // one-time migration can be `await`ed to full completion BEFORE
  // `scanDirectories()` ever runs for the first time in this process and
  // BEFORE either timer that could later trigger a scan (`armScanTimer`'s
  // periodic re-scan, `ytdlp.startBackground`'s poll timer -- a completed
  // subscription download also triggers `scanDirectories()`, see
  // lib/ytdlp/index.js) is armed. This is what "serialized against
  // scanDirectories" actually means here: nothing in this function has
  // called `scanDirectories()` yet, so there is no route (e.g. `POST
  // /api/config`, `POST /api/scan`) that could kick off a concurrent scan
  // while the migration's `updateDatabase` re-key mutators are in flight --
  // a concurrent scan mid-migration could otherwise re-hash a mid-move old
  // path as a delete before the re-key mutator commits, losing watch
  // history. When the yt-dlp module is disabled, `migrateOneOffsIntoChannelFolders`
  // returns its zeroed summary synchronously (no `await` is ever actually
  // suspended), so this IIFE falls through to `armScanTimer()`/
  // `ytdlp.startBackground()`/`app.listen()`/the deferred boot scan in the
  // exact same synchronous tick as before this change -- the disabled-module
  // startup-timing no-op guarantee holds.
  (async () => {
    const ytdlpStartupConfig = ytdlp.parseYtdlpConfig();
    try {
      await migrateOneOffsIntoChannelFolders({ loadDatabase, updateDatabase, getMediaId }, ytdlpStartupConfig);
    } catch (err) {
      // Never let a migration bug block startup -- log and continue exactly
      // like every other best-effort startup step above (cleanupOrphanTmp/
      // cleanupOrphanDbTmp/sweepAgedTranscodes never abort startup either).
      console.error('yt-dlp one-off migration failed unexpectedly (continuing startup):', err && err.message);
    }

    // Arm the periodic re-scan timer per the persisted scanIntervalMinutes
    // preference (default 30 minutes; armScanTimer arms no timer at all when
    // the preference is Off). Lives here, not at module top-level, so
    // importing the module for tests never keeps the event loop alive.
    armScanTimer();

    // Same no-op guarantee as registerRoutes above: startBackground early-
    // returns (and arms no timer) when the yt-dlp module is disabled. Placed
    // inside this guard (not at module top-level) so importing server.js for
    // tests never arms the yt-dlp poll timer either.
    // v1.29.0 T3: same `dataDir: DATA_DIR` threading as the `registerRoutes`
    // deps bundle above -- this is a SEPARATE deps object (`startBackground`
    // -> `armYtdlpTimer` -> the scheduled `runPoll` closure), so it needs its
    // own copy for the scheduled-poll run-log emit path to work, not just the
    // route-triggered one.
    ytdlp.startBackground({ updateDatabase, loadDatabase, scanDirectories, getMediaId, dataDir: DATA_DIR });

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`==================================================`);
      console.log(`  FileTube server running at http://localhost:${PORT}`);
      console.log(`==================================================`);

      // v1.30 A2 (AC2.4): the initial boot scan now runs AFTER the server is
      // already accepting connections, not before -- previously
      // `scanDirectories()` was kicked off (and, pre-A2, fully `await`ed by
      // any caller) BEFORE this `app.listen()` call, so route-serving was
      // sequenced behind the scan's first synchronous stretch. `setImmediate`
      // defers the boot scan by one full event-loop turn past this listen
      // callback, so a request issued immediately after boot (e.g. `GET
      // /api/config`) is never queued behind it -- the scan itself is also
      // cooperative (AC1.1/AC1.2) so it doesn't re-introduce blocking once it
      // does start.
      setImmediate(() => {
        scanDirectories().catch(console.error);
      });
    });
  })();
}

// Exported for testing (see test/). Importing this module has no side effects
// beyond ensuring the data directories exist; it never starts listening.
module.exports = {
  app,
  needsTranscode,
  transcodedPath,
  matchRootFolder,
  // C1 (v1.24 UX Round, Wave 3): move-files + id re-key -- re-exported so
  // tests (and T19's Wave 7 physical-reconcile move) can call these directly.
  // See the functions' own comments (above `POST /api/videos/:id/move`) for
  // the full confinement + re-key design.
  computeMoveTarget,
  moveItemToFolder,
  configuredLibraryRoots,
  getMediaId,
  // T4 (v1.25 QoL): the one-time flat-one-off-into-channel-folder migration --
  // re-exported so tests can call it directly (mirroring T9's own
  // moveItemToFolder export above) without booting a real server process.
  migrateOneOffsIntoChannelFolders,
  // Metadata+subtitle re-pull backfill (v1.25 QoL follow-up): re-exported so
  // tests can call these directly (mirroring `moveItemToFolder`'s own
  // testing contract) without booting a real server process. See their
  // header comments (above `migrateOneOffsIntoChannelFolders`) for the full
  // deps-bridge wiring contract lib/ytdlp/index.js's `registerRoutes` uses.
  recordRepulledItemMeta,
  enumerateRepullableItems,
  cleanDisplayTitle,
  extractYtdlpVideoId,
  contentDispositionAttachment,
  normalizeScanRoot,
  loadDatabase,
  saveDatabase,
  updateDatabase,
  // v1.30 A3 (in-memory DB read cache): re-exported so tests can exercise the
  // cache directly and assert AC3.3's O(1)-loads claim (mirrors every other
  // DB-layer primitive's own testing contract above).
  getCachedDatabase,
  __getLoadDatabaseCallCount,
  // v1.30 A4 (progress-write coalescer): re-exported so tests can exercise
  // the batching/overlay/write-count claims directly, without booting a real
  // server process or sleeping out `PROGRESS_FLUSH_MS` (mirrors A3's own
  // testing-contract pattern immediately above). See each symbol's own
  // comment (above `pendingProgress`, near `getCachedDatabase`) for what it
  // does.
  pendingProgress,
  PROGRESS_FLUSH_MS,
  effectiveProgress,
  flushPendingProgress,
  currentProgressFlushTimer,
  __getSaveDatabaseCallCount,
  reconcileTranscode,
  parseFfprobeTags,
  parseFfprobeStreams,
  codecNeedsTranscode,
  probeCodecsOnly,
  // Feature A (v1.26.1, Shorts player-size jump): shared by the ffprobe
  // stream parse and the dimensions-backfill route's own validation -- see
  // their comments above.
  isValidMediaDimension,
  MAX_MEDIA_DIMENSION,
  // F3 (v1.26.1 two-reviewer follow-up): re-exported so tests can exercise
  // the primitive-shape guard directly (see its own comment above).
  isPrimitiveNumericInput,
  // C5-local (v1.24): the release-date precedence helpers -- re-exported so
  // tests can exercise the embedded-date parsing / embedded->mtime
  // precedence directly, without a real ffprobe binary (mirrors
  // `parseFfprobeTags`/`parseFfprobeStreams`'s existing testing contract).
  parseEmbeddedReleaseDateMs,
  deriveReleaseDate,
  // v1.33 T1: embedded source-URL / youtubeId derivation + the reheat's
  // local tags probe -- re-exported under the same testing contract as
  // parseEmbeddedReleaseDateMs above.
  parseEmbeddedSourceUrl,
  youtubeIdFromUrlString,
  deriveScanYoutubeId,
  probeEmbeddedTags,
  PLAYABLE_VIDEO_CODECS,
  PLAYABLE_AUDIO_CODECS,
  parseCacheCap,
  resolveTranscodeDir,
  parseCrf,
  selectEvictions,
  cleanupOrphanTmp,
  cleanupOrphanDbTmp,
  evictTranscodeCache,
  activeProtectedPaths,
  isCompletedTranscode,
  isInFlightTranscode,
  scanIntervalMs,
  selectAgedOut,
  selectPrunableIds,
  // v1.33 T4 (tech-debt #10, Option C): the empty-but-present mountpoint
  // detector -- re-exported under the same testing contract as
  // selectPrunableIds above.
  detectVanishedRoots,
  mergeScannedMetadata,
  transcodeCacheSize,
  effectiveCacheCap,
  recordServed,
  clearPersistedServedAt,
  sweepAgedTranscodes,
  // v1.27.0 (background-audio-for-video, EXPERIMENTAL): re-exported so tests
  // can exercise the audio-extract sidecar's own pure/queue helpers and the
  // shared Range-serving helper directly (mirrors every other
  // transcode-cache primitive's own testing contract above).
  audioPath,
  buildAudioExtractArgs,
  queueAudioExtract,
  setAudioStatus,
  // F1 (two-reviewer gate, v1.27.0): re-exported so tests can exercise the
  // stale-'ready' healing helpers directly (mirrors setAudioStatus's own
  // testing contract above).
  clearAudioStatus,
  healStaleAudioReady,
  sendRangeable,
  scanState,
  scanDirectories,
  armScanTimer,
  currentScanTimer,
  currentDeferredRescanTimer,
  TRANSCODE_CACHE_MAX_BYTES,
  TRANSCODE_CRF,
  TRANSCODE_DIR,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  TRANSCODE_EXTENSIONS,
  // v1.15.1 hotfix: re-exported so tests can exercise the exact predicate
  // scanDirRecursive uses to exclude yt-dlp's own intermediate/partial
  // download artifacts (see lib/ytdlpIntermediates.js).
  isYtdlpIntermediate,
  // Optional yt-dlp subscription module (v1.11.0) -- re-exported so tests can
  // observe the dormant-wiring no-op guarantee without a second require of
  // lib/ytdlp (see AC1-9 in docs/exec-plans/active/2026-07-05-yt-dlp-integration-module.md).
  currentYtdlpPollTimer: ytdlp.currentYtdlpPollTimer,
  parseYtdlpConfig: ytdlp.parseYtdlpConfig,
  isEnabled: ytdlp.isEnabled,
};
