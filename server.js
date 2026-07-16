const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream');
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
// v1.41.6: `validateChannelUrl` -- the SINGLE channel-URL validator this app
// has (lib/ytdlp/url.js; `store.sanitizeCapturedChannelMeta` and
// `args.requireValidUrl` are both built on it, and nothing here forks it) --
// re-validates a persisted `item.channelUrl` at the one boundary where it
// decides whether a USER FILE gets physically moved. See
// `relocateHydratedImportIntoChannelFolder`.
const { buildWatchUrl, classifySingleVideo, isSafeVideoId, validateChannelUrl, extractMediaRef } = require('./lib/ytdlp/url');
// v1.15.1 hotfix: pure predicate for yt-dlp's own intermediate/partial-
// download artifacts (merge temps, per-format fragments, `.part`/`.ytdl`
// markers) left in its download dir mid-download or after a killed/failed
// download -- see lib/ytdlpIntermediates.js's module comment for why this
// is a standalone LEAF module rather than something scanDirRecursive (below)
// defines locally: lib/ytdlp/index.js's own best-effort post-failure cleanup
// needs the exact same predicate, and a leaf module lets both sides
// `require()` it directly without any circular dependency.
const { isYtdlpIntermediate } = require('./lib/ytdlpIntermediates');
// v1.37.0 books: the db.books namespace owner + the pure scanner core --
// see docs/exec-plans/active/v1.37.0-books.md. Both are leaf modules over
// deps this file already provides (loadDatabase/updateDatabase/getMediaId);
// requiring them has no side effects (the ytdlp direct-require posture).
const booksStore = require('./lib/books/store');
const booksScan = require('./lib/books/scan');
// v1.38.0 TTS "Listen from Here": pure leaf helpers (env-config parse, engine
// argv builders, chapter chunker). Same direct-require posture as the store.
const booksTtsConfig = require('./lib/books/tts-config');
const booksTtsEngine = require('./lib/books/tts-engine');
const booksTtsChunk = require('./lib/books/tts-chunk');
const booksZip = require('./lib/books/zip'); // chapter XHTML extraction for TTS
// C4 "fun stats" page (v1.24 UX Round, Wave 3): pure aggregation helpers over
// `db.metadata`, unit-tested on their own against a synthetic fixture. See
// lib/stats.js's header comment and `GET /api/stats` below for the full
// live-compute rationale.
const stats = require('./lib/stats');
// v1.41.0: app version + repo URL, surfaced on the Stats "About" section
// (FileTube version links to its own release tag). The only place the client
// learns the version; nothing else reads package.json server-side.
const APP_VERSION = require('./package.json').version;
const REPO_URL = 'https://github.com/dtammam/filetube';
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
// v1.37.0 books: covers live in a BOOKS-OWNED dir -- never THUMBNAIL_DIR,
// so the media scan's thumbnail unlink loop can never touch a book cover
// and the book scanner's cover pruning can never touch a video thumbnail.
const BOOKCOVER_DIR = path.join(DATA_DIR, '.bookcovers');
// v1.38.0 TTS: per-chapter synthesized audio cache (<key>.m4a + <key>.blocks.json),
// a sibling of the thumbnail/cover caches. Created on demand by the worker.
const TTS_CACHE_DIR = path.join(DATA_DIR, 'tts-cache');

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
  backgroundAudioForVideo: false,
  // v1.34 (Dean): the DEFAULT home sort -- what the library renders when a
  // browser has no explicit per-browser dropdown pick (localStorage
  // `filetube_sort`) yet. Dean's "real-YouTube feed" flip: release-date is
  // the out-of-the-box order now that the v1.33 trust chain landed. An
  // explicit dropdown pick still wins in that browser (see main.js).
  defaultSort: 'release-date',
  // v1.34 T4 (Dean): when ON, mobile VIDEO keeps the CUSTOM control bar in
  // the FULL player instead of the native iOS strip (public/js/player.js
  // applyControlsMode). OFF by default -- native is today's behavior; this
  // is the opt-in trial lever for the custom mobile experience.
  mobileCustomPlayer: false,
  // v1.35 (Dean, EXPERIMENTAL): deterministic background audio -- when ON,
  // (a) freshly-downloaded yt-dlp videos get their .m4a audio sidecar
  // extracted at scan time (not lazily on first watch), and (b) .m4a
  // sidecars are PINNED: exempt from the automatic size-cap eviction and
  // age sweep (the manual Settings "Clear cache" button still clears them
  // -- explicit user intent wins). ~1MB per minute of audio on disk.
  preExtractAudio: false,
  // v1.41.6 (Dean's MeTube-import relocation): after the reheat hydrates an
  // imported video with its real channel identity (v1.41.5), physically MOVE
  // the file into that channel's folder under the yt-dlp download dir, so an
  // import becomes indistinguishable from a native download (it appears under
  // the channel's sidebar folder, can be pinned, and its channel link
  // resolves). ON by default -- this is Dean's explicit ask and the whole
  // point of the release; the toggle exists so an operator who wants their
  // library left physically where it is can say so. The relocation is the
  // ONLY setting here that MOVES USER FILES, so every eligibility rule around
  // it is deliberately conservative (see relocateHydratedImportIntoChannelFolder).
  relocateHydratedImports: true
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
      // v1.41.3: deletion tombstones -- { [id]: { filePath, deletedAt } },
      // written by DELETE /api/videos/:id, consumed by the scan (see the
      // tombstone block in the scan's per-file loop for the full contract).
      deleteTombstones: {},
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
    // v1.41.3: backfill `deleteTombstones` like every other top-level key.
    if (!db.deleteTombstones || typeof db.deleteTombstones !== 'object' || Array.isArray(db.deleteTombstones)) db.deleteTombstones = {};
    db.settings = withDefaultSettings(db.settings); // backfill for older databases
    return db;
  } catch (err) {
    console.error('Error reading db.json, resetting database:', err);
    // Every code path out of loadDatabase must hand back a settings-bearing DB.
    return { folders: [], folderSettings: {}, progress: {}, metadata: {}, liked: [], deleteTombstones: {}, settings: withDefaultSettings() };
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
  // v1.35 (preExtractAudio): while the setting is ON, .m4a background-audio
  // sidecars are PINNED -- never candidates for the automatic size-cap
  // eviction (this function) or the age sweep (below). The manual Settings
  // "Clear cache" button (POST /api/cache/clear) still removes them --
  // explicit user intent wins over the pin. They still COUNT toward the
  // displayed cache size (honest accounting).
  const pinAudioSidecars = !!(getCachedDatabase().settings || {}).preExtractAudio;
  const files = [];
  for (const name of entries) {
    if (!isCompletedTranscode(name)) continue;
    if (pinAudioSidecars && name.endsWith('.m4a')) continue;
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
  // v1.35 (preExtractAudio): same sidecar pin as evictTranscodeCache -- see
  // its comment there.
  const pinAudioSidecars = !!(db.settings || {}).preExtractAudio;
  const files = [];
  for (const name of entries) {
    if (!isCompletedTranscode(name)) continue;
    if (pinAudioSidecars && name.endsWith('.m4a')) continue;
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

// ---- v1.41.3: deletion tombstones (tech-debt #32 + #35a) -------------------
//
// "Delete stays gone" has TWO adversaries. v1.36.2's delete-time archive
// append made deletion authoritative against yt-dlp RE-DOWNLOADS; these
// tombstones make it authoritative against the SCANNER. The class they
// close: any delete that reports success while the file survives on disk --
// the resolver falsely concluding "already gone" on a name that doesn't
// round-trip (tech-debt #35a: invalid-UTF-8/metube-era names, exotic mount
// charset mappings), an opt-in removeAnyway on a transient EBUSY (#32), or
// a TOCTOU between the unlink and the next scan. In every variant the next
// scan re-discovered the file and resurrected the library entry under the
// same path-hashed id.
//
// Contract: DELETE /api/videos/:id records { filePath, deletedAt } under the
// item's id in db.deleteTombstones (same mutator that removes the metadata
// entry). When a scan re-discovers a tombstoned id, it holds the file's TRUE
// on-disk path (its own readdir produced it -- no stored-name round-trip
// problem can exist at this point), so:
//   - file mtime  > deletedAt -> NEWER content at the same path (a deliberate
//     re-download or a restored copy): drop the tombstone, index normally.
//   - file mtime <= deletedAt -> the very file the user already deleted:
//     retry the unlink AT THE SCANNED PATH. Success -> stays gone, tombstone
//     consumed. Failure -> depends on the errno (v1.41.10):
//       * ENOENT on a path this scan JUST enumerated is the SMB/CIFS
//         DELETE_PENDING signature (an open handle somewhere pins an
//         already-deleted file; every new open is refused as "not found"
//         while the dirent stays enumerable). The file is neither indexable
//         content nor an undeletable-volume case: keep it hidden and KEEP
//         the tombstone, retrying every scan until the dirent disappears.
//         The 90-day prune below is the backstop against a handle that
//         never closes becoming a silent forever-suppress.
//       * every other errno (EBUSY/EPERM/EROFS/...): drop the tombstone and
//         index the file honestly (it exists and we cannot remove it --
//         hiding it would be a lie), with a log line naming the errno.
// Outside the delete-pending case, every scan encounter consumes the
// tombstone -- each delete buys one deferred retry, never a suppress-list.
//
// Tombstones are minted ONLY for UNVERIFIED delete conclusions -- resolver
// `gone`, ENOENT `alreadyGone`, removeAnyway, and (v1.41.10) a watched
// unlinkSync whose leaf the parent dir STILL enumerates as unopenable
// afterward (delete-pending: the unlink "succeeded" without the file going
// away, which is the definition of unverified). A verified-AND-gone unlink
// mints nothing, so a normal delete can never arm a trap for a later
// mtime-preserving restore (rsync -a/Syncthing/backup tools); a still-
// enumerated-but-OPENABLE leaf after a verified unlink is a brand-new file
// that landed in the window and also mints nothing (adversarial-gate
// CRITICAL, v1.41.10: tombstoning it would schedule the reap of content the
// user never deleted).
//
// Growth bounds: pruned on every write (age + FIFO cap). A lingering
// tombstone is inert unless a file appears that the scan can bind back to
// this delete: EITHER at that exact path (primary key = md5(path)), OR --
// after the v1.41.9 SEAM 2 secondary match -- a yt-dlp file in the SAME
// PARENT DIR with the SAME EXTENSION and SAME `[id]` bracket (a divergent
// leaf spelling of the very file that was deleted; see the scan's SEAM 2
// block, which is dirname+ext-confined precisely so a same-id copy in a
// DIFFERENT folder is never touched). With an mtime predating the delete
// that IS the deleted file, so acting on it late still honors the user's
// delete. This INCLUDES the mount-outage case
// (intended): a vanished parent dir resolves as `gone` -> the delete
// "succeeds" unverified and mints a tombstone -> when the mount returns,
// the next scan completes the deletion the user was already told happened.
// (A parent that is present but UNREADABLE -- EACCES/EPERM -- still 409s
// without touching the db, unless the caller opts into removeAnyway.)
const DELETE_TOMBSTONE_CAP = 500;
const DELETE_TOMBSTONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// Pure, in-place prune: drops malformed/expired entries, then FIFO-caps by
// deletedAt (oldest first). `now` injectable for tests. Exported.
function pruneDeleteTombstones(tombstones, now = Date.now()) {
  for (const id of Object.keys(tombstones)) {
    const t = tombstones[id];
    if (!t || typeof t.deletedAt !== 'number' || now - t.deletedAt > DELETE_TOMBSTONE_MAX_AGE_MS) {
      delete tombstones[id];
    }
  }
  const ids = Object.keys(tombstones);
  if (ids.length > DELETE_TOMBSTONE_CAP) {
    ids.sort((a, b) => tombstones[a].deletedAt - tombstones[b].deletedAt);
    for (const id of ids.slice(0, ids.length - DELETE_TOMBSTONE_CAP)) delete tombstones[id];
  }
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
//
// v1.41.5 WIDENED (Dean's explicit call): this id is now also what makes an
// item eligible for the reheat's NETWORK pass from ANY library root, not just
// the module's own download dir -- see `enumerateRepullableItems`. That makes
// this the FIRST code path that aims a yt-dlp network call at a file FileTube
// did not download itself (Dean's MeTube-era .mp3/.mp4 imports, whose only
// link back to YouTube is exactly this tag). The blast radius of a forged tag
// is unchanged in KIND (a well-formed YouTube video URL, fetched read-only,
// `--skip-download`; the media file is never touched) and now also covers the
// channel identity written back onto the item -- which the never-overwrite
// guard in `recordRepulledItemMeta` keeps from ever re-pointing an item that
// already has one. A file with NO such tag and no `[id]` bracket is never
// fetched at all (its local probe finds nothing and the item is skipped).
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

// ---- v1.38.0 TTS "Listen from Here" engine availability (yt-dlp opt-in posture)
//
// Strictly opt-in like yt-dlp: the engine binary + (for Piper) a voice model
// must be present, else the feature stays dark and the reader is fully
// functional. `ttsEngineAvailable` is the async probe result; `ttsAvailable()`
// ANDs it with ffmpeg (needed for the WAV->m4a encode), read at request time so
// both async boot probes have settled by the time any route is hit.
const ttsConfig = booksTtsConfig.parseTtsConfig(process.env);
let ttsEngineAvailable = false;
let ttsEngineVersion = null; // v1.41.0: shown on the Stats About section (espeak-ng only; see parseEngineVersion)
(function probeTtsEngine() {
  const bin = booksTtsConfig.activeBin(ttsConfig);
  // `--version` may be unknown to a given engine build; ONLY a spawn failure
  // (ENOENT: not installed) disqualifies it. A binary that runs but exits
  // non-zero on --version is still present and usable.
  // A 5s timeout is defense-in-depth: no real piper/espeak build blocks on
  // stdin during --version, but a misconfigured binary that did would otherwise
  // wedge the probe (execFile has no default timeout) and leave TTS silently
  // stuck "unavailable" with no log.
  execFile(bin, ['--version'], { timeout: 5000 }, (err, stdout) => {
    if (err && err.code === 'ENOENT') {
      console.log(`TTS engine '${ttsConfig.engine}' (${bin}) not found on PATH -- "Listen from Here" disabled (books still work).`);
      return;
    }
    if (ttsConfig.engine === 'piper' && (!ttsConfig.piperModel || !fs.existsSync(ttsConfig.piperModel))) {
      console.log('TTS: piper is present but FILETUBE_TTS_PIPER_MODEL is unset or missing on disk -- "Listen from Here" disabled.');
      return;
    }
    ttsEngineAvailable = true;
    // v1.41.0: capture the version for the Stats About section (espeak-ng only).
    ttsEngineVersion = booksTtsConfig.parseEngineVersion(ttsConfig.engine, stdout);
    console.log(`TTS engine '${ttsConfig.engine}' is available -- "Listen from Here" enabled.`);
  });
})();

function ttsAvailable() {
  return ttsEngineAvailable && ffmpegAvailable;
}

// ---- v1.38.0 TTS "Listen from Here" synthesis worker ------------------------
//
// Single-worker serialized FIFO (mirrors the audio-extract queue's shape): one
// chapter at a time, engine + ffmpeg SPAWNED PER JOB and gone after (RAM-light
// by architecture), synthesizing on demand + exactly one chapter ahead, and
// DEFERRING while a yt-dlp download/poll is active (Dean's less-spiky choice).
// Cache: TTS_CACHE_DIR/<key>.m4a + <key>.blocks.json, key =
// sha1(bookId:spineIndex:engine:voice:rate:ttsRev). EPUB only (PDF has no
// server-side text extraction here); a non-epub/absent book is a no-op.
// How long the worker waits before re-checking the download-defer gate.
// Env-overridable so tests can shrink the re-check window (the PROGRESS_FLUSH_MS
// test posture); 5 s in production is invisible next to synthesis time.
const TTS_DEFER_POLL_MS = Number(process.env.FILETUBE_TTS_DEFER_POLL_MS) || 5000;
const ttsQueue = [];
let ttsBusy = false;

function ttsSettings() {
  return booksStore.readBooks(getCachedDatabase()).settings || {};
}

// The cache key folds in engine/voice/rate/ttsRev, so a settings change
// transparently re-synthesizes into a NEW file and the old one ages out; a
// block-rule change (READER_TTS_REV) invalidates every cached chapter.
function ttsCacheKey(bookId, spineIndex) {
  const s = ttsSettings();
  const voice = ttsConfig.engine === 'espeak-ng' ? ttsConfig.espeakVoice : (s.voice || '');
  const rate = booksTtsEngine.clampRate(s.rate);
  const raw = `${bookId}:${spineIndex}:${ttsConfig.engine}:${voice}:${rate}:${booksTtsChunk.READER_TTS_REV}`;
  return crypto.createHash('sha1').update(raw).digest('hex');
}
function ttsM4aPath(key) { return path.join(TTS_CACHE_DIR, `${key}.m4a`); }
function ttsBlocksPath(key) { return path.join(TTS_CACHE_DIR, `${key}.blocks.json`); }

// The key to SERVE for (bookId, spineIndex): prefer the key that was ACTUALLY
// synthesized (recorded on the status row), so once a settings-write route
// exists (selectable voice/rate is a reserved seam), a settings change between
// synth and playback can't make the serve route recompute a DIFFERENT key than
// /status reported 'ready' for -> a spurious 404 (gate finding, v1.38.0). Falls
// back to the current-settings key only when no status row exists yet.
function ttsServeKey(bookId, spineIndex) {
  const audio = booksStore.readBooks(getCachedDatabase()).audio[bookId];
  const entry = audio && audio[String(spineIndex)];
  return (entry && entry.key) ? entry.key : ttsCacheKey(bookId, spineIndex);
}

// Look up a validated EPUB chapter for (bookId, spineIndex). Returns null for
// an unknown/non-epub book or an out-of-range chapter -- every caller (worker
// AND routes) funnels validation through this ONE place.
function resolveTtsChapter(bookId, spineIndex) {
  const book = booksStore.readBooks(getCachedDatabase()).items[bookId];
  if (!book || book.format !== 'epub' || !Array.isArray(book.spine)) return null;
  const idx = Number(spineIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= book.spine.length) return null;
  return { book, spineIndex: idx, spineEntry: book.spine[idx] };
}

// Set status without awaiting -- the no-clobber mutator is idempotent and the
// worker's own control flow never depends on the write having landed.
function setTtsStatus(bookId, spineIndex, patch) {
  booksStore.setBookAudioStatus({ updateDatabase }, bookId, spineIndex, { ...patch, updatedAt: new Date().toISOString() })
    .catch((err) => console.error(`TTS: failed to persist status for ${bookId}/${spineIndex}:`, err && err.message));
}

// Enqueue a chapter for synthesis (idempotent). Returns the CURRENT
// {status, key} so the ensure route can answer immediately. `prefetch` marks a
// one-chapter-ahead job: its own completion does NOT chain another prefetch, so
// synthesis stays "the chapter you asked for + exactly one ahead", never a
// runaway whole-book cascade. A user ensure (prefetch=false) is what advances
// the read-ahead as the reader moves through the book.
function queueChapterTts(bookId, spineIndex, prefetch = false) {
  if (!ttsAvailable()) return { status: 'unavailable', key: null };
  const chapter = resolveTtsChapter(bookId, spineIndex);
  if (!chapter) return { status: 'unsupported', key: null };
  const idx = chapter.spineIndex;
  const key = ttsCacheKey(bookId, idx);
  if (fs.existsSync(ttsM4aPath(key)) && fs.existsSync(ttsBlocksPath(key))) {
    setTtsStatus(bookId, idx, { status: 'ready', key });
    return { status: 'ready', key };
  }
  if (!ttsQueue.some((j) => j.bookId === bookId && j.spineIndex === idx)) {
    ttsQueue.push({ bookId, spineIndex: idx, key, prefetch });
    setTtsStatus(bookId, idx, { status: 'pending', key });
  }
  processTtsQueue();
  return { status: 'pending', key };
}

function processTtsQueue() {
  if (ttsBusy || ttsQueue.length === 0) return;
  // Defer (do NOT dequeue) while a download/poll is in flight -- re-arm a short,
  // unref'd timer and try again. A synth already in progress is never killed;
  // only the NEXT dequeue waits. One-directional: downloads never wait for TTS.
  if (ytdlp.isHeavyJobActive && ytdlp.isHeavyJobActive()) {
    setTimeout(processTtsQueue, TTS_DEFER_POLL_MS).unref();
    return;
  }
  const job = ttsQueue.shift();
  ttsBusy = true;
  runChapterSynthesis(job)
    .then((result) => {
      ttsBusy = false;
      // One chapter ahead: only after a USER-requested job (not a prefetch —
      // that would cascade into whole-book pregeneration), only on success, and
      // only within spine bounds (queueChapterTts re-validates + dedups +
      // short-circuits if already cached).
      if (result && result.ok && !job.prefetch) queueChapterTts(job.bookId, job.spineIndex + 1, true);
      processTtsQueue();
    })
    .catch((err) => {
      ttsBusy = false;
      console.error(`TTS synthesis failed for ${job.bookId}/${job.spineIndex}:`, err && err.message);
      setTtsStatus(job.bookId, job.spineIndex, { status: 'failed', key: job.key });
      processTtsQueue();
    });
}

// Spawn the active engine for ONE block, piping text to stdin (never an argv
// token). Resolves when the child exits 0 and the WAV exists; rejects otherwise.
function synthesizeBlock(text, wavPath, rate) {
  return new Promise((resolve, reject) => {
    let bin;
    let args;
    if (ttsConfig.engine === 'espeak-ng') {
      bin = ttsConfig.espeakBin;
      args = booksTtsEngine.buildEspeakArgs({ voice: ttsConfig.espeakVoice, wavOut: wavPath, rate });
    } else {
      bin = ttsConfig.piperBin;
      args = booksTtsEngine.buildPiperArgs({ model: ttsConfig.piperModel, config: ttsConfig.piperConfig, wavOut: wavPath, rate });
    }
    let proc;
    try {
      proc = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (err) { reject(err); return; }
    let stderrTail = '';
    proc.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-2048); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(wavPath)) resolve();
      else reject(new Error(`${ttsConfig.engine} exited ${code}${stderrTail ? `: ${stderrTail.trim()}` : ''}`));
    });
    proc.stdin.on('error', () => { /* EPIPE if the child died early -- surfaced via close */ });
    proc.stdin.end(text);
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    let proc;
    try { proc = spawn('ffmpeg', args); } catch (err) { reject(err); return; }
    let stderrTail = '';
    proc.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-2048); });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderrTail.trim()}`))));
  });
}

// Duration (seconds) of a PCM WAV by parsing its header -- avoids an ffprobe
// spawn per block. Scans RIFF chunks for `fmt ` (byte rate) and `data` (size);
// duration = dataSize / byteRate. Returns 0 on anything unparseable.
function wavDurationSec(wavPath) {
  try {
    const buf = fs.readFileSync(wavPath);
    if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return 0;
    let byteRate = 0;
    let dataSize = 0;
    let off = 12;
    while (off + 8 <= buf.length) {
      const id = buf.toString('ascii', off, off + 4);
      const size = buf.readUInt32LE(off + 4);
      if (id === 'fmt ' && off + 8 + 16 <= buf.length) byteRate = buf.readUInt32LE(off + 8 + 8);
      else if (id === 'data') { dataSize = size; break; }
      off += 8 + size + (size % 2); // chunks are word-aligned
    }
    return byteRate > 0 ? dataSize / byteRate : 0;
  } catch (_) { return 0; }
}

// The synthesis pipeline for one chapter: extract XHTML -> chunk -> synth each
// block -> concat to m4a -> write blocks.json. Atomic .tmp->rename finalize.
async function runChapterSynthesis({ bookId, spineIndex, key }) {
  const chapter = resolveTtsChapter(bookId, spineIndex);
  if (!chapter) {
    // The book was pruned/removed between enqueue and now. Drop the stale
    // pending row WITHOUT recreating an audio map for a gone book
    // (clearBookAudioStatus is a no-op when the map is already absent).
    booksStore.clearBookAudioStatus({ updateDatabase }, bookId, spineIndex)
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

// v1.38.0 T12: boot reconcile — the transcode-reconcile posture for TTS.
// Sweeps orphaned work dirs / temp files from a killed synth, then resets stale
// audio status: a 'pending'/'processing' entry has no live worker after a fresh
// boot, and a 'ready' entry whose cache file vanished is a lie. 'failed' entries
// are left as-is (a later ensure re-queues them since no cache file exists).
function reconcileTtsCacheAtBoot() {
  try {
    for (const name of fs.readdirSync(TTS_CACHE_DIR)) {
      if (name.startsWith('.tmp-') || name.endsWith('.tmp.m4a') || name.endsWith('.blocks.json.tmp')) {
        try { fs.rmSync(path.join(TTS_CACHE_DIR, name), { recursive: true, force: true }); } catch (_) { /* best-effort */ }
      }
    }
  } catch (_) { /* no tts-cache dir yet */ }
  updateDatabase((db) => {
    const ns = booksStore.ensureBooks(db);
    let changed = false;
    for (const bookId of Object.keys(ns.audio)) {
      const chapters = ns.audio[bookId];
      for (const idx of Object.keys(chapters)) {
        const e = chapters[idx];
        const fileGone = !e || !e.key || !fs.existsSync(ttsM4aPath(e.key)) || !fs.existsSync(ttsBlocksPath(e.key));
        const inFlightStale = e && (e.status === 'processing' || e.status === 'pending');
        if (inFlightStale || (e && e.status === 'ready' && fileGone)) { delete chapters[idx]; changed = true; }
      }
      if (Object.keys(chapters).length === 0) { delete ns.audio[bookId]; changed = true; }
    }
    return changed;
  }).catch((err) => console.error('TTS boot reconcile failed:', err && err.message));
}

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

// ---- v1.34 T3 (Dean): chapters -----------------------------------------------
//
// Three sources, resolved at serve time (GET /api/videos/:id) in priority
// order: `chaptersManual` (the per-video editor -- MANUAL ALWAYS WINS) ->
// `chapters` (embedded file chapters, captured by the probe below) ->
// timestamp lines parsed out of the embedded description tag. The two
// parsers here are pure and share one normalized shape:
// `{ startTime: <finite seconds >= 0>, title: <trimmed string, may be ''> }`,
// sorted ascending, deduplicated on startTime, count-capped.

const MAX_CHAPTERS = 300;
const MAX_CHAPTER_TITLE_LENGTH = 200;

// Normalize/bound one candidate chapter; null when unusable. Titles are
// control-stripped and length-capped on code points (the same posture as
// the yt-dlp module's sanitizeCapturedTitle -- emoji survive).
function normalizeChapter(startTime, rawTitle) {
  const t = Number(startTime);
  if (!Number.isFinite(t) || t < 0) return null;
  let title = typeof rawTitle === 'string' ? rawTitle : '';
  // eslint-disable-next-line no-control-regex
  title = title.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (title.length > MAX_CHAPTER_TITLE_LENGTH) title = Array.from(title).slice(0, MAX_CHAPTER_TITLE_LENGTH).join('');
  return { startTime: t, title };
}

// Sort ascending + dedup on startTime (first wins) + cap the count. Shared
// tail of both parsers so their outputs are interchangeable.
function finalizeChapters(list) {
  const sorted = list.slice().sort((a, b) => a.startTime - b.startTime);
  const out = [];
  for (const ch of sorted) {
    if (out.length > 0 && ch.startTime === out[out.length - 1].startTime) continue;
    out.push(ch);
    if (out.length >= MAX_CHAPTERS) break;
  }
  return out;
}

// Read ffprobe's top-level `chapters` array (present once buildFfprobeArgs
// passes -show_chapters). Same robustness contract as parseFfprobeTags/
// parseFfprobeStreams: accepts the parsed object OR raw stdout, try/catch
// JSON.parse, NEVER throws, degrades to []. Uses `start_time` (float-seconds
// string) -- `start`/`end` are time_base ticks and deliberately ignored.
function parseFfprobeChapters(input) {
  let j = input;
  if (typeof input === 'string') {
    try { j = JSON.parse(input); } catch (_) { return []; }
  }
  if (!j || typeof j !== 'object' || !Array.isArray(j.chapters)) return [];
  const out = [];
  for (const raw of j.chapters) {
    if (!raw || typeof raw !== 'object') continue;
    const title = raw.tags && typeof raw.tags === 'object' && typeof raw.tags.title === 'string' ? raw.tags.title : '';
    const ch = normalizeChapter(raw.start_time, title);
    if (ch) out.push(ch);
  }
  return finalizeChapters(out);
}

// A leading (optionally bracketed) "H:MM:SS" / "MM:SS" / "M:SS" timestamp
// followed by an optional separator and the chapter title -- the classic
// YouTube-description chapter-list line, and the SAME grammar the manual
// editor's textarea uses (one grammar owner; the client posts raw text and
// THIS parses it).
const CHAPTER_LINE = /^\s*[([]?\s*((?:\d{1,3}:)?\d{1,2}:\d{2})\s*[)\]]?\s*[-–—:.]?\s*(.*)$/;

function chapterTimestampToSeconds(str) {
  const parts = String(str).split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return NaN;
  if (parts.length === 3) return (parts[0] * 60 + parts[1]) * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return NaN;
}

// Parse "0:00 Intro"-style lines out of free text (a description, or the
// chapters editor's textarea). LENIENT: any line whose leading token parses
// as a timestamp contributes; everything else is ignored. Pure, never
// throws, [] on anything unusable. Callers apply their own acceptance rules
// on top (see deriveDescriptionChapters below for the description gate).
function parseChapterLines(text) {
  if (typeof text !== 'string' || text === '') return [];
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = CHAPTER_LINE.exec(line);
    if (!m) continue;
    const secs = chapterTimestampToSeconds(m[1]);
    if (!Number.isFinite(secs)) continue;
    const ch = normalizeChapter(secs, m[2]);
    if (ch) out.push(ch);
  }
  return finalizeChapters(out);
}

// The DESCRIPTION acceptance gate: a description only counts as carrying a
// chapter list when it parses to at least TWO chapters and the first starts
// at 0:00 -- YouTube's own convention, and the difference between "a chapter
// list" and "a stray timestamp mentioned in prose". Manual edits face no
// such gate (the editor's textarea goes through bare parseChapterLines).
function deriveDescriptionChapters(description) {
  const parsed = parseChapterLines(description);
  if (parsed.length < 2 || parsed[0].startTime !== 0) return [];
  return parsed;
}

// Serve-time precedence resolver -- the ONE place the three sources meet.
// Returns { chapters, chaptersSource } for the GET /api/videos/:id payload;
// chapters is [] with source null when no source yields anything.
function resolveItemChapters(item) {
  if (Array.isArray(item.chaptersManual) && item.chaptersManual.length > 0) {
    return { chapters: item.chaptersManual, chaptersSource: 'manual' };
  }
  if (Array.isArray(item.chapters) && item.chapters.length > 0) {
    return { chapters: item.chapters, chaptersSource: 'embedded' };
  }
  const fromDescription = deriveDescriptionChapters(item.tags && item.tags.description);
  if (fromDescription.length > 0) {
    return { chapters: fromDescription, chaptersSource: 'description' };
  }
  return { chapters: [], chaptersSource: null };
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
      let chapters = [];
      try { releaseDateMs = parseEmbeddedReleaseDateMs(j); } catch (_) { releaseDateMs = null; }
      try { sourceUrl = parseEmbeddedSourceUrl(j); } catch (_) { sourceUrl = null; }
      try { chapters = parseFfprobeChapters(j); } catch (_) { chapters = []; }
      const rawTags = (j && j.format && j.format.tags) || {};
      if (rawTags && typeof rawTags === 'object') {
        for (const k of Object.keys(rawTags)) {
          if (k.toLowerCase() === 'title' && typeof rawTags[k] === 'string' && rawTags[k].trim() !== '') {
            title = rawTags[k].trim();
            break;
          }
        }
      }
      resolve({ releaseDateMs, sourceUrl, title, chapters });
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
// v1.34 T3 (chapters): `-show_chapters` added -- purely additive to the SAME
// single probe (no second spawn); `parseFfprobeChapters` (below) reads the
// resulting top-level `chapters` array back out. Both probe paths (the
// scan's extractMetadataAndThumbnail and the reheat's probeEmbeddedTags)
// share this builder, so both emit chapters for free.
function buildFfprobeArgs(filePath) {
  return [
    '-v', 'error',
    '-show_entries', 'format=duration:format_tags:stream=codec_name,codec_type,width,height:stream_disposition=attached_pic:stream_side_data=rotation',
    '-show_chapters',
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
          resolve({ duration, artist, tags, videoCodec, audioCodec, embeddedReleaseDateMs, embeddedSourceUrl, chapters, width, height, hasThumbnail: !artErr && fs.existsSync(thumbPath) });
        });
      } else {
        // Extract video frame (at 2 seconds or 10% of duration, whichever is
        // smaller). `execFile` (not `exec`) for the same arg-array/no-shell
        // reason as the audio-art branch above.
        const timestamp = duration > 5 ? 2 : Math.max(0, duration / 2);
        execFile('ffmpeg', ['-ss', String(timestamp), '-i', filePath, '-vframes', '1', '-q:v', '2', '-y', thumbPath], (frameErr) => {
          resolve({ duration, artist, tags, videoCodec, audioCodec, embeddedReleaseDateMs, embeddedSourceUrl, chapters, width, height, hasThumbnail: !frameErr && fs.existsSync(thumbPath) });
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
  const deleteTombstones = (db.deleteTombstones && typeof db.deleteTombstones === 'object') ? db.deleteTombstones : {};
  const consumedTombstoneIds = new Set();

  for (const [filePath, info] of scannedFiles.entries()) {
    const id = getMediaId(filePath);
    const isAudio = AUDIO_EXTENSIONS.includes(info.ext);

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
      // v1.41.10: remembered so the delete-pending branch below can restore it
      // -- its un-consume makes this file's net db effect zero, and leaving
      // dbChanged forced-true would rewrite db.json on every scan for as long
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
          const freshTombstone = freshDb.deleteTombstones && freshDb.deleteTombstones[tombstoneKey];
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
          fs.unlinkSync(filePath);
          console.log(`Scan: removed a deleted file that had survived its delete (deferred retry): ${filePath}`);
          // Best-effort .vtt subtitle-sidecar sweep, keyed off the SCANNED
          // basename (the original delete's sweep keyed off the stored
          // spelling and, in the #35a class, missed them) -- mirrors the
          // DELETE route's own v1.36.2 sweep; never blocks the scan.
          try {
            const dir = path.dirname(filePath);
            const base = path.basename(filePath, path.extname(filePath));
            for (const name of fs.readdirSync(dir)) {
              if (name.startsWith(`${base}.`) && name.endsWith('.vtt')) {
                try { fs.unlinkSync(path.join(dir, name)); } catch (_) { /* best-effort */ }
              }
            }
          } catch (_) { /* best-effort -- e.g. the dir vanished */ }
          // Keep /api/scan-status honest for this pass: this file was
          // processed (its processing was the removal), and the cooperative
          // yield must not be skipped on a reap-heavy pass.
          scanState.processed++;
          await maybeYieldScan(yieldState);
          continue; // stays gone -- never re-indexed
        } catch (err) {
          if (err && err.code === 'ENOENT') {
            // v1.41.10: unlink says "no such file" for a path THIS SCAN just
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
      // v1.35 (preExtractAudio): a freshly-indexed yt-dlp-rooted VIDEO is a
      // download -- queue its sidecar extraction (after the save; see the
      // collector's comment above) when the setting is ON.
      // (Read from the scan's Phase-1 snapshot -- a toggle flipped ON
      // mid-scan catches the NEXT scan's fresh files; already-indexed items
      // stay lazy-on-first-watch by design. Accepted narrow window.)
      if (db.settings && db.settings.preExtractAudio === true &&
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
            // v1.34 T3: reheat-refreshed embedded chapters ride the same
            // completed-mid-scan adoption.
            if (Array.isArray(freshItem.chapters)) {
              item.chapters = freshItem.chapters;
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
          // v1.41.13: the same mid-scan-reheat gap-fill for the universal
          // source identity (persist-gate checkpoint). Keyed on sourceExtractor
          // as a unit (never mix one item's extractor with another's id), and
          // gap-fill only -- a fresh bracket-re-derivation this scan still wins.
          if (!item.sourceExtractor && typeof freshItem.sourceExtractor === 'string' && freshItem.sourceExtractor !== '') {
            item.sourceExtractor = freshItem.sourceExtractor;
            if (freshItem.sourceId) item.sourceId = freshItem.sourceId;
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
          const consumedU = ytdlp.consumeUniversalDownloadMeta(fresh, path.basename(item.filePath));
          if (consumedU) {
            item.sourceExtractor = consumedU.sourceExtractor;
            item.sourceId = consumedU.sourceId;
            if (consumedU.channelName) item.channelName = consumedU.channelName;
            if (typeof consumedU.releaseDate === 'number' && Number.isFinite(consumedU.releaseDate)) {
              item.releaseDate = consumedU.releaseDate;
            }
            if (typeof consumedU.sourceTitle === 'string' && consumedU.sourceTitle !== '') {
              item.sourceTitle = consumedU.sourceTitle;
              item.title = consumedU.sourceTitle;
            }
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
            const consumedYt = ytdlp.consumeDownloadChannelMeta(fresh, mediaRef.id);
            if (consumedYt) {
              item.channelUrl = consumedYt.channelUrl;
              if (consumedYt.channelHandleUrl) item.channelHandleUrl = consumedYt.channelHandleUrl;
              if (consumedYt.channelId) item.channelId = consumedYt.channelId;
              if (consumedYt.channelName) item.channelName = consumedYt.channelName;
              if (consumedYt.channelAvatarUrl) item.channelAvatarUrl = consumedYt.channelAvatarUrl;
              if (typeof consumedYt.releaseDate === 'number' && Number.isFinite(consumedYt.releaseDate)) item.releaseDate = consumedYt.releaseDate;
              if (typeof consumedYt.sourceTitle === 'string' && consumedYt.sourceTitle !== '') { item.sourceTitle = consumedYt.sourceTitle; item.title = consumedYt.sourceTitle; }
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
    if (consumedTombstoneIds.size && fresh.deleteTombstones && typeof fresh.deleteTombstones === 'object') {
      for (const id of consumedTombstoneIds) delete fresh.deleteTombstones[id];
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
    scanTimer = setInterval(() => {
      scanDirectories().catch(console.error);
      // v1.37.0 books: piggyback on the media interval (exec plan §2) --
      // no second timer, and a books-less install no-ops.
      scanBooks().catch(console.error);
    }, ms).unref();
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
    // v1.37.0 gate fix (adversarial W1): the books design's HARD INVARIANT
    // -- "book roots may never overlap media roots in EITHER direction" --
    // was only enforced on the books side (POST /api/books/config). Enforce
    // the reverse here too: a media folder that equals, contains, or lives
    // inside a configured BOOK root is rejected, or a later media save
    // could silently double-own a subtree the two scanners' prune/merge
    // semantics would then fight over.
    const bookRoots = booksStore.ensureBooks(loadDatabase()).folders;
    for (const bookRoot of bookRoots) {
      const resolvedBookRoot = path.resolve(bookRoot);
      if (resolved === resolvedBookRoot || ytdlpArgs.isPathUnder(resolved, resolvedBookRoot) || ytdlpArgs.isPathUnder(resolvedBookRoot, resolved)) {
        return res.status(400).json({ error: `Media folder overlaps a book folder: ${trimmed} <-> ${bookRoot}` });
      }
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

// ---- Books (v1.37.0) --------------------------------------------------------
//
// The book library's server half: its OWN folder config (`db.books.folders`
// -- never `db.folders`), its own scanner with the media scan's
// overlap/coalescing discipline, and cover storage under BOOKCOVER_DIR.
// Everything degrades to a no-op on a books-less install (zero folders =
// zero scans = zero db writes = the disabled-module posture ytdlp set).
// Full design: docs/exec-plans/active/v1.37.0-books.md.

let bookScanState = { scanning: false, lastScan: null, rescanRequested: false };
// v1.37.0 gate fix (adversarial W4): the single deferred follow-up timer --
// see scanBooks' finally block.
let deferredBookRescanTimer = null;

// Test-observability accessor, mirroring currentScanTimer/scanState reads.
function currentBookScanState() {
  return bookScanState;
}

async function runBookScan() {
  // Phase-1 read (no lock): folders + the previous items snapshot. All the
  // slow work (walk, zip reads, cover extraction) happens against this
  // snapshot, off the writer lock -- the media scan's own discipline.
  const db = loadDatabase();
  const ns = booksStore.ensureBooks(db);
  const folders = ns.folders.slice();
  if (folders.length === 0 && Object.keys(ns.items).length === 0) return; // books-less: total no-op
  const { items, covers, survivingIds, missingRoots } = await booksScan.collectBooks(folders, ns.items, getMediaId);
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

  const pruneMissing = !!(db.settings && db.settings.pruneMissing);
  const prunedIds = [];
  const prunedAudioKeys = []; // v1.38.0: TTS cache keys of pruned books, deleted below
  await updateDatabase((fresh) => {
    const freshNs = booksStore.ensureBooks(fresh);
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
    const prunable = new Set(booksStore.selectPrunableBookIds(freshNs.items, survivingIds, { missingRoots: effectiveMissingRoots, pruneMissing }));
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
  });

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

// Overlap/coalescing guard -- the scanDirectories discipline (a scan
// requested mid-scan runs exactly one follow-up pass, never a concurrent
// second walker).
async function scanBooks() {
  if (bookScanState.scanning) {
    bookScanState.rescanRequested = true;
    return;
  }
  bookScanState.scanning = true;
  try {
    let followups = 0;
    do {
      bookScanState.rescanRequested = false;
      await runBookScan();
      followups++;
    } while (bookScanState.rescanRequested && followups <= MAX_RESCAN_FOLLOWUPS);
  } catch (err) {
    console.error('books: scan failed:', err);
  } finally {
    // v1.37.0 gate fix (adversarial W4 -- tech-debt #3's lesson ported): a
    // rescan requested during the FINAL follow-up pass must not be silently
    // dropped when the budget is spent -- arm exactly one deferred,
    // rate-limited re-entry (single-guarded, unref'd, never stacked).
    const stillPending = bookScanState.rescanRequested;
    bookScanState.scanning = false;
    bookScanState.lastScan = new Date().toISOString();
    if (stillPending && !deferredBookRescanTimer) {
      deferredBookRescanTimer = setTimeout(() => {
        deferredBookRescanTimer = null;
        scanBooks().catch(console.error);
      }, 5000);
      deferredBookRescanTimer.unref();
    }
  }
}

app.get('/api/books/config', (req, res) => {
  res.json({ folders: booksStore.readBooks(getCachedDatabase()).folders });
});

app.post('/api/books/config', async (req, res) => {
  const { folders } = req.body || {};
  if (!Array.isArray(folders) || !folders.every((f) => typeof f === 'string' && f.trim() !== '')) {
    return res.status(400).json({ error: 'folders must be an array of non-empty strings' });
  }
  const resolved = [];
  const seen = new Set();
  for (const raw of folders) {
    const folder = path.resolve(raw.trim());
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
      return res.status(400).json({ error: `Folder does not exist: ${folder}` });
    }
    if (seen.has(folder)) continue;
    seen.add(folder);
    resolved.push(folder);
  }
  // HARD INVARIANT (exec plan §2): book roots may never overlap media roots
  // in EITHER direction -- a file must have exactly one owner, or the two
  // scanners' prune/merge semantics fight over it.
  const mediaFolders = (getCachedDatabase().folders || []).map((f) => path.resolve(f));
  for (const bookRoot of resolved) {
    for (const mediaRoot of mediaFolders) {
      if (bookRoot === mediaRoot || ytdlpArgs.isPathUnder(bookRoot, mediaRoot) || ytdlpArgs.isPathUnder(mediaRoot, bookRoot)) {
        return res.status(400).json({ error: `Book folder overlaps a media folder: ${bookRoot} <-> ${mediaRoot}` });
      }
    }
  }
  try {
    await updateDatabase((db) => {
      booksStore.ensureBooks(db).folders = resolved;
      return true;
    });
  } catch (err) {
    return res.status(500).json({ error: `Could not save book folders: ${err.message}` });
  }
  res.json({ folders: resolved });
  scanBooks().catch(console.error);
});

app.post('/api/books/scan', (req, res) => {
  const alreadyInProgress = bookScanState.scanning;
  if (alreadyInProgress) {
    bookScanState.rescanRequested = true;
  } else {
    scanBooks().catch(console.error);
  }
  res.status(202).json({ scanning: true, alreadyInProgress });
});

app.get('/api/books/scan-status', (req, res) => {
  res.json(bookScanState);
});

// v1.38.0 TTS: the reader calls this to decide whether to light the "Listen
// from Here" control. `available` is the SAME gate every synthesis route
// enforces (engine binary + Piper model + ffmpeg). Static-segment route,
// declared before the `/api/books/:id/...` params (route-order lesson).
app.get('/api/books/tts/config', (req, res) => {
  res.json({ available: ttsAvailable(), engine: ttsConfig.engine });
});

// ---- Books: progress coalescer (T6 -- the v1.30 A4 discipline, books-owned) --
//
// A structural twin of `pendingProgress`/`flushPendingProgress` above (see
// that section's full rationale): reading-position pings are frequent and
// cheap-to-lose, so they stage here and flush as ONE atomic write per
// window. Deliberately NOT routed through `POST /api/progress` -- its value
// shape ({timestamp,duration}) cannot express a CFI locator, and its flush
// guard is `db.metadata[id]` (books live in db.books.items).
const pendingBookProgress = new Map();
let bookProgressFlushTimer = null;

function currentBookProgressFlushTimer() {
  return bookProgressFlushTimer;
}

function flushPendingBookProgress() {
  if (bookProgressFlushTimer) {
    clearTimeout(bookProgressFlushTimer);
    bookProgressFlushTimer = null;
  }
  if (pendingBookProgress.size === 0) return Promise.resolve(false);
  const snapshot = new Map(pendingBookProgress);
  pendingBookProgress.clear();
  return updateDatabase((db) => {
    const ns = booksStore.ensureBooks(db);
    for (const [id, value] of snapshot) {
      // Same deleted-between-ping-and-flush guard as the media coalescer: a
      // flush must never resurrect progress for a pruned book.
      if (ns.items[id]) ns.progress[id] = value;
    }
    return true;
  }).catch((err) => {
    console.error('Error flushing batched book progress:', err);
  });
}

function armBookProgressFlushTimerIfNeeded() {
  if (bookProgressFlushTimer) return;
  bookProgressFlushTimer = setTimeout(flushPendingBookProgress, PROGRESS_FLUSH_MS);
  bookProgressFlushTimer.unref();
}

// Read-your-writes overlay -- pending first, then the cache's last-flushed
// value (the effectiveProgress posture).
function effectiveBookProgress(id) {
  if (pendingBookProgress.has(id)) return pendingBookProgress.get(id);
  const ns = booksStore.readBooks(getCachedDatabase());
  return ns.progress[id] || null;
}

// ---- Books: read APIs + file/cover serving (T5) ------------------------------

// Sort comparators -- the /api/videos sort-key posture (unknown keys fall
// back to the default) with book-native keys.
function sortBookList(list, sortKey) {
  const byTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
  switch (sortKey) {
    case 'title-asc': return list.sort(byTitle);
    case 'title-desc': return list.sort((a, b) => byTitle(b, a));
    case 'author': return list.sort((a, b) => String(a.author || '').localeCompare(String(b.author || ''), undefined, { sensitivity: 'base' }) || byTitle(a, b));
    case 'recent-progress': return list.sort((a, b) => String((b.progress && b.progress.updatedAt) || '').localeCompare(String((a.progress && a.progress.updatedAt) || '')));
    case 'recent':
    default: return list.sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
  }
}

// The public item shape: everything the cards/reader need, progress overlaid
// (effective = pending-first), spine included only on the detail route (the
// list stays light for hundreds of books).
function publicBookListItem(item) {
  const progress = effectiveBookProgress(item.id);
  return {
    id: item.id,
    title: item.title,
    author: item.author,
    format: item.format,
    folderName: item.folderName,
    rootFolder: item.rootFolder,
    size: item.size,
    addedAt: item.addedAt,
    hasCover: item.hasCover === true,
    pageCount: item.pageCount,
    progress: progress ? { percent: progress.percent, updatedAt: progress.updatedAt } : null,
  };
}

app.get('/api/books', (req, res) => {
  const ns = booksStore.readBooks(getCachedDatabase());
  let list = Object.values(ns.items);
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  if (search !== '') {
    list = list.filter((i) => [i.title, i.author, i.folderName]
      .some((field) => typeof field === 'string' && field.toLowerCase().includes(search)));
  }
  const root = typeof req.query.root === 'string' ? req.query.root : '';
  if (root !== '') {
    // The home grid's `underFolder` idiom: the folder itself or anything
    // beneath it (path-prefix on the item's file path).
    list = list.filter((i) => typeof i.filePath === 'string' && (i.filePath === root || i.filePath.startsWith(root.endsWith(path.sep) ? root : root + path.sep)));
  }
  let shaped = list.map(publicBookListItem);
  if (req.query.filter === 'reading') {
    shaped = shaped.filter((i) => i.progress && i.progress.percent > 0 && i.progress.percent < 98);
    shaped.sort((a, b) => String((b.progress && b.progress.updatedAt) || '').localeCompare(String((a.progress && a.progress.updatedAt) || '')));
  } else {
    sortBookList(shaped, typeof req.query.sort === 'string' ? req.query.sort : 'recent');
  }
  const total = shaped.length;
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 10000) : 100;
  res.json({ items: shaped.slice(offset, offset + limit), total, offset, limit });
});

// ROUTE ORDER: the static-segment GETs (/folders, /pins) MUST register
// before the /:id param route or Express matches :id="folders".
// Shelf aggregation for the books page's chips: unique parent directories
// with counts, joined against the shelf pins so the chip renders its pin
// state (T10's pin gesture). Exposing shelf DIR paths to the operator's own
// UI is the same trust level as /api/config exposing db.folders.
app.get('/api/books/folders', (req, res) => {
  const ns = booksStore.readBooks(getCachedDatabase());
  const byDir = new Map();
  for (const item of Object.values(ns.items)) {
    if (typeof item.filePath !== 'string') continue;
    const dir = path.dirname(item.filePath);
    const existing = byDir.get(dir);
    if (existing) existing.count += 1;
    else byDir.set(dir, { name: item.folderName || path.basename(dir), dir, count: 1 });
  }
  const pinByDir = new Map(ns.pins.map((p) => [p.dir, p]));
  const folders = [...byDir.values()].map((f) => {
    const pin = pinByDir.get(f.dir);
    return { ...f, pinned: Boolean(pin), pinId: pin ? pin.id : null };
  });
  res.json({ folders });
});

app.get('/api/books/pins', (req, res) => {
  // Pre-shaped for the shared pinned-sidebar renderer: `channelDir` is the
  // field name the renderer already keys on; `href` overrides its default
  // `/?root=` link to the books page (the ONLY shared-renderer widening).
  const pins = booksStore.listShelfPins({ loadDatabase });
  res.json(pins.map((p) => ({ id: p.id, channelDir: p.dir, label: p.label, href: `/books?root=${encodeURIComponent(p.dir)}` })));
});

app.get('/api/books/:id', (req, res) => {
  const ns = booksStore.readBooks(getCachedDatabase());
  const item = ns.items[req.params.id];
  if (!item) return res.status(404).json({ error: 'Book not found' });
  res.json({
    ...publicBookListItem(item),
    filePath: item.filePath,
    spine: Array.isArray(item.spine) ? item.spine : [],
    locator: (effectiveBookProgress(item.id) || {}).locator || null,
  });
});

const BOOK_CONTENT_TYPES = { epub: 'application/epub+zip', pdf: 'application/pdf' };

// SECURITY INVARIANT (gate, adversarial S2): this route serves
// item.filePath UNCHECKED because db.books.items rows are written
// EXCLUSIVELY by the book scanner (paths confined to configured book
// roots) and the cover-backfill route (which never touches filePath). Any
// future writer of items[*].filePath MUST re-establish confinement here or
// this becomes an arbitrary-file-read.
app.get('/book/:id/file', (req, res) => {
  const ns = booksStore.readBooks(getCachedDatabase());
  const item = ns.items[req.params.id];
  if (!item) return res.status(404).json({ error: 'Book not found' });
  if (!fs.existsSync(item.filePath)) return res.status(404).json({ error: 'Book file missing on disk' });
  res.setHeader('Content-Type', BOOK_CONTENT_TYPES[item.format] || 'application/octet-stream');
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(`${item.title || 'book'}.${item.format}`)}"`);
  }
  // sendFile provides Accept-Ranges/206 natively -- what pdf.js range
  // loading wants; harmless for the whole-file EPUB fetch.
  res.sendFile(item.filePath);
});

// ---- v1.38.0 TTS "Listen from Here" routes ----------------------------------
//
// All file paths derive from the deterministic cache key over a
// scanner-validated (bookId, spineIndex) -- never from a client path fragment,
// so there is no arbitrary-file-read surface (mirrors /book/:id/file's own
// membership check). The static `tts` segment sits under the already-matched
// `:id`, so there is no route-order ambiguity with /book/:id/file.

// Enqueue synthesis (idempotent). 503 if the engine/model/ffmpeg aren't
// configured; 404 for an unknown/non-epub book or out-of-range chapter.
app.post('/book/:id/tts/:spineIndex/ensure', (req, res) => {
  if (!ttsAvailable()) return res.status(503).json({ error: 'Text-to-speech is not configured on this server' });
  const chapter = resolveTtsChapter(req.params.id, req.params.spineIndex);
  if (!chapter) return res.status(404).json({ error: 'No such book chapter for text-to-speech' });
  // Use the NORMALIZED integer index everywhere (not the raw route param) so
  // '02'/'2e0'/' 2 ' all address the SAME cache key/status row that ensure
  // synthesizes under (gate finding: raw-vs-normalized key mismatch).
  const result = queueChapterTts(req.params.id, chapter.spineIndex);
  res.json(result);
});

// Honest per-chapter status for the reader's poll.
app.get('/api/books/:id/tts/:spineIndex/status', (req, res) => {
  const idx = Number(req.params.spineIndex);
  if (!Number.isInteger(idx) || idx < 0) return res.json({ status: 'none', durationSec: null });
  const audio = booksStore.readBooks(getCachedDatabase()).audio[req.params.id];
  const entry = audio && audio[String(idx)];
  if (!entry) return res.json({ status: 'none', durationSec: null });
  res.json({ status: entry.status, durationSec: typeof entry.durationSec === 'number' ? entry.durationSec : null });
});

// Serve the synthesized chapter audio (sendFile => Accept-Ranges/206 native).
app.get('/book/:id/tts/:spineIndex', (req, res) => {
  const chapter = resolveTtsChapter(req.params.id, req.params.spineIndex);
  if (!chapter) return res.status(404).json({ error: 'No such book chapter' });
  const key = ttsServeKey(req.params.id, chapter.spineIndex);
  const m4a = ttsM4aPath(key);
  if (!fs.existsSync(m4a)) return res.status(404).json({ error: 'Audio not ready' });
  // Protect an actively-streaming chapter from a concurrent "Clear cache now"
  // (the RECENT_STREAM_MS set the transcode serve path already uses).
  markServed(m4a);
  res.setHeader('Content-Type', 'audio/mp4');
  res.sendFile(m4a);
});

// The blockIndex -> startSec map the reader uses to seek to the right paragraph.
app.get('/book/:id/tts/:spineIndex/blocks', (req, res) => {
  const chapter = resolveTtsChapter(req.params.id, req.params.spineIndex);
  if (!chapter) return res.status(404).json({ error: 'No such book chapter' });
  const key = ttsServeKey(req.params.id, chapter.spineIndex);
  const blocksPath = ttsBlocksPath(key);
  if (!fs.existsSync(blocksPath)) return res.status(404).json({ error: 'Audio not ready' });
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(blocksPath);
});

app.get('/bookcover/:id', (req, res) => {
  const ns = booksStore.readBooks(getCachedDatabase());
  const item = ns.items[req.params.id];
  if (!item) return res.status(404).json({ error: 'Book not found' });
  if (item.hasCover === true && item.coverExt) {
    const coverPath = path.join(BOOKCOVER_DIR, `${item.id}${item.coverExt}`);
    if (fs.existsSync(coverPath)) {
      res.setHeader('Content-Type', item.coverExt === '.png' ? 'image/png' : 'image/jpeg');
      // Covers are immutable per id (a changed file gets a new path-hash id
      // only if the path changes; a re-extracted cover overwrites in place,
      // so cap the cache at a day rather than immutable).
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(coverPath);
    }
  }
  // Book-styled SVG placeholder -- title/author text, escaped exactly like
  // the /thumbnail fallback (a hostile title must never become markup).
  const title = String(item.title || 'Book');
  const author = String(item.author || '');
  const svg = `
    <svg width="160" height="240" viewBox="0 0 160 240" xmlns="http://www.w3.org/2000/svg">
      <rect width="160" height="240" fill="#3a3f58"/>
      <rect x="8" y="8" width="144" height="224" fill="none" stroke="#8890b5" stroke-width="2"/>
      <text x="80" y="110" font-family="Georgia, serif" font-size="13" fill="#e8e8f0" text-anchor="middle" font-weight="bold">
        ${escapeHtml(title.length > 20 ? `${title.substring(0, 18)}...` : title)}
      </text>
      <text x="80" y="132" font-family="Georgia, serif" font-size="9" fill="#aab" text-anchor="middle">
        ${escapeHtml(author.length > 26 ? `${author.substring(0, 24)}...` : author)}
      </text>
      <text x="80" y="220" font-family="Arial, sans-serif" font-size="8" fill="#778" text-anchor="middle">${item.format === 'pdf' ? 'PDF' : 'EPUB'}</text>
    </svg>
  `;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(svg);
});

// PDF cover backfill (T5/§2): the reader has page 1 decoded anyway; it POSTs
// a one-shot JPEG/PNG snapshot. Magic-byte sniffed, bounded, NO-CLOBBER
// (the dimensions-backfill contract), atomic tmp+rename.
// (Own sniffer literals rather than referencing CUSTOM_LOGO_TYPES: that
// const is declared LATER in this file -- a module-load-time reference here
// would be a temporal-dead-zone boot crash. Same magic bytes.)
const BOOK_COVER_TYPES = {
  'image/jpeg': (buf) => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  'image/png': (buf) => buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47,
};
const BOOK_COVER_MAX_BYTES = 512 * 1024;

app.post(
  '/api/books/:id/cover',
  express.raw({ type: Object.keys(BOOK_COVER_TYPES), limit: BOOK_COVER_MAX_BYTES }),
  async (req, res) => {
    const ns = booksStore.readBooks(getCachedDatabase());
    const item = ns.items[req.params.id];
    if (!item) return res.status(404).json({ error: 'Book not found' });
    if (item.hasCover === true) return res.status(200).json({ applied: false, reason: 'already has a cover' });
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const sniff = BOOK_COVER_TYPES[mime];
    const bytes = req.body;
    if (!sniff || !Buffer.isBuffer(bytes) || bytes.length === 0 || !sniff(bytes)) {
      return res.status(400).json({ error: 'body must be a real JPEG or PNG image' });
    }
    const ext = mime === 'image/png' ? '.png' : '.jpg';
    const finalPath = path.join(BOOKCOVER_DIR, `${item.id}${ext}`);
    const tmpPath = `${finalPath}.tmp`;
    try {
      fs.mkdirSync(BOOKCOVER_DIR, { recursive: true });
      fs.writeFileSync(tmpPath, bytes);
      fs.renameSync(tmpPath, finalPath);
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort */ }
      return res.status(500).json({ error: `Could not store cover: ${err.message}` });
    }
    // Optional pageCount rides along (?pages=), validated as a plausible
    // positive integer -- the isValidMediaDimension posture.
    const rawPages = parseInt(req.query.pages, 10);
    const pageCount = Number.isInteger(rawPages) && rawPages > 0 && rawPages < 100000 ? rawPages : undefined;
    try {
      await updateDatabase((db) => {
        const freshNs = booksStore.ensureBooks(db);
        const fresh = freshNs.items[item.id];
        if (!fresh) return false; // pruned between read and write: drop
        if (fresh.hasCover !== true) {
          fresh.hasCover = true;
          fresh.coverExt = ext;
        }
        if (pageCount !== undefined && fresh.pageCount === undefined) fresh.pageCount = pageCount;
        return true;
      });
    } catch (err) {
      return res.status(500).json({ error: `Cover stored but the record update failed: ${err.message}` });
    }
    res.json({ applied: true });
  },
);

// ---- Books: shelf pins (T10 server half -- the ytdlp pins route shapes) ----

app.post('/api/books/pins', async (req, res) => {
  const ns = booksStore.readBooks(getCachedDatabase());
  const validation = booksStore.validateShelfPinInput(req.body, ns.folders);
  if (!validation.ok) return res.status(400).json({ error: validation.error });
  try {
    const record = await booksStore.addShelfPin({ loadDatabase, updateDatabase, getMediaId }, validation.value);
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: `Could not pin shelf: ${err.message}` });
  }
});

app.delete('/api/books/pins/:id', async (req, res) => {
  try {
    const removed = await booksStore.removeShelfPin({ loadDatabase, updateDatabase }, req.params.id);
    if (!removed) return res.status(404).json({ error: 'Pin not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Could not unpin shelf: ${err.message}` });
  }
});

app.post('/api/books/pins/reorder', async (req, res) => {
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds) || !orderedIds.every((id) => typeof id === 'string' && id !== '')) {
    return res.status(400).json({ error: 'orderedIds must be an array of non-empty strings' });
  }
  try {
    await booksStore.reorderShelfPins({ loadDatabase, updateDatabase }, orderedIds);
    res.json(booksStore.listShelfPins({ loadDatabase }));
  } catch (err) {
    res.status(500).json({ error: `Could not reorder shelf pins: ${err.message}` });
  }
});

// The clean /books URL (express.static already serves /books.html; this
// mirrors the ytdlp module's own /subscriptions sendFile).
app.get('/books', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'books.html'));
});

app.post('/api/books/:id/progress', (req, res) => {
  const ns = booksStore.readBooks(getCachedDatabase());
  const item = ns.items[req.params.id];
  if (!item) return res.status(404).json({ error: 'Book not found' });
  const { locator, percent } = req.body || {};
  if (!locator || typeof locator !== 'object' || locator.kind !== item.format) {
    return res.status(400).json({ error: `locator.kind must be '${item.format}' for this book` });
  }
  if (item.format === 'epub' && typeof locator.cfi !== 'string') {
    return res.status(400).json({ error: 'locator.cfi must be a string for an epub' });
  }
  if (item.format === 'pdf' && !(Number.isInteger(locator.page) && locator.page > 0)) {
    return res.status(400).json({ error: 'locator.page must be a positive integer for a pdf' });
  }
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    return res.status(400).json({ error: 'percent must be a number in [0, 100]' });
  }
  // Bound the stored locator to the known fields (a hostile ping must not
  // grow db.json with arbitrary keys), spineIndex/blockIndex validated as
  // non-negative integers when present (the wave-2 listen-from-here keys).
  const clean = { kind: locator.kind };
  if (item.format === 'epub') {
    clean.cfi = String(locator.cfi).slice(0, 2000);
    if (Number.isInteger(locator.spineIndex) && locator.spineIndex >= 0) clean.spineIndex = locator.spineIndex;
    if (Number.isInteger(locator.blockIndex) && locator.blockIndex >= 0) clean.blockIndex = locator.blockIndex;
  } else {
    clean.page = locator.page;
  }
  pendingBookProgress.set(item.id, { locator: clean, percent, updatedAt: new Date().toISOString() });
  armBookProgressFlushTimerIfNeeded();
  res.json({ success: true });
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

// v1.34: the defaultSort allowlist -- exactly the #sort-select option values
// (public/index.html) / lib/videoQuery.js sortItems cases. Kept in sync by
// the settings tests.
// 'random' is deliberately NOT offered as a site-wide DEFAULT (gate fix):
// prev/next and autoplay-next re-derive their order per event, so a random
// DEFAULT would make "Next" jump arbitrarily and "Prev" almost never return
// -- an explicit per-browser dropdown pick of "Feeling lucky" keeps its
// existing (session-shuffle) behavior and is unaffected by this allowlist.
const VALID_DEFAULT_SORTS = new Set(['newest', 'oldest', 'release-date', 'title-asc', 'title-desc', 'size-desc', 'size-asc']);
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
    // v1.34: the default home sort (see DEFAULT_SETTINGS).
    defaultSort: settings.defaultSort,
    // v1.34 T4: custom-vs-native mobile video controls (see DEFAULT_SETTINGS).
    mobileCustomPlayer: settings.mobileCustomPlayer,
    // v1.35: deterministic background audio (see DEFAULT_SETTINGS).
    preExtractAudio: settings.preExtractAudio,
    // v1.41.6: relocate hydrated imports into their channel folder (see
    // DEFAULT_SETTINGS) -- ON by default.
    relocateHydratedImports: settings.relocateHydratedImports,
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
  // v1.41.6 DELIBERATE key-set change (this list is locked by
  // test/unit/database.test.js's DEFAULT_SETTINGS deep-equal and
  // test/integration/settings-cache-api.test.js's full-shape assertion, both
  // updated in the same commit): `relocateHydratedImports` joins the set --
  // the reheat's "move a hydrated import into its channel folder" lever.
  const KNOWN_KEYS = ['scanIntervalMinutes', 'pruneMissing', 'cacheMaxBytes', 'cacheMaxAgeDays', 'defaultView', 'autoplayNext', 'backgroundAudioForVideo', 'defaultSort', 'mobileCustomPlayer', 'preExtractAudio', 'relocateHydratedImports'];
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
  // v1.34: the default home sort -- allowlisted to exactly the sort keys the
  // library dropdown offers (public/index.html #sort-select / videoQuery's
  // sortItems cases), so a stray/garbage value can never persist.
  if ('defaultSort' in body && !VALID_DEFAULT_SORTS.has(body.defaultSort)) {
    return res.status(400).json({ error: 'defaultSort must be one of: ' + [...VALID_DEFAULT_SORTS].join(', ') });
  }
  if ('mobileCustomPlayer' in body && typeof body.mobileCustomPlayer !== 'boolean') {
    return res.status(400).json({ error: 'mobileCustomPlayer must be a boolean' });
  }
  if ('preExtractAudio' in body && typeof body.preExtractAudio !== 'boolean') {
    return res.status(400).json({ error: 'preExtractAudio must be a boolean' });
  }
  // v1.41.6: relocateHydratedImports -- boolean, mirrors preExtractAudio's own
  // validation exactly. A non-boolean here would decide whether user FILES get
  // moved, so it 400s like every other typed key rather than being coerced.
  if ('relocateHydratedImports' in body && typeof body.relocateHydratedImports !== 'boolean') {
    return res.status(400).json({ error: 'relocateHydratedImports must be a boolean' });
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
  // v1.38.0: also purge the TTS audio cache (nuke-all, like the transcode side
  // above). Skip in-flight work dirs/temps -- the worker cleans those itself.
  let ttsFiles;
  try { ttsFiles = fs.readdirSync(TTS_CACHE_DIR); } catch (_) { ttsFiles = []; }
  const sparedTtsKeys = new Set(); // keys whose audio survived (actively streaming)
  for (const name of ttsFiles) {
    if (name.startsWith('.tmp-') || name.endsWith('.tmp.m4a') || name.endsWith('.blocks.json.tmp')) continue;
    const p = path.join(TTS_CACHE_DIR, name);
    // Never yank a chapter audio out from under an ACTIVE listen session -- the
    // same recentlyServed protection the transcode loop above uses. The .m4a is
    // protected via markServed on serve; also spare its sibling .blocks.json.
    if (name.endsWith('.m4a') && protectedPaths.has(p)) { sparedTtsKeys.add(name.slice(0, -'.m4a'.length)); continue; }
    if (name.endsWith('.blocks.json') && protectedPaths.has(path.join(TTS_CACHE_DIR, `${name.slice(0, -'.blocks.json'.length)}.m4a`))) continue;
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) continue;
      fs.unlinkSync(p);
      removed++;
      freedBytes += st.size;
    } catch (e) {
      console.error(`Failed to clear cached TTS audio ${p}:`, e.message);
    }
  }
  // Drop the status rows whose files we deleted, but KEEP a spared (actively
  // streaming) chapter's row so its /status stays truthful while it plays on.
  updateDatabase((db) => {
    const ns = booksStore.ensureBooks(db);
    for (const bookId of Object.keys(ns.audio)) {
      const chapters = ns.audio[bookId];
      for (const idx of Object.keys(chapters)) {
        const entry = chapters[idx];
        if (!entry || !entry.key || !sparedTtsKeys.has(entry.key)) delete chapters[idx];
      }
      if (Object.keys(chapters).length === 0) delete ns.audio[bookId];
    }
    return true;
  }).catch((err) => console.error('Failed to reset book audio status on cache clear:', err && err.message));
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
      progressPercent: progress.duration > 0 ? (progress.timestamp / progress.duration) * 100 : 0,
      // v1.40.0: per-item liked flag so the grid can render each card's Like
      // control in its correct initial state (same derivation as the single
      // GET /api/videos/:id route and the by-construction flag on /api/liked).
      liked: Array.isArray(db.liked) && db.liked.includes(item.id)
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
  // v1.34 T3: the resolved chapter list (manual > embedded > description --
  // see resolveItemChapters) plus its provenance for the editor UI. The
  // spread's own raw `chapters`/`chaptersManual` are superseded by the
  // resolved keys below (object-literal order).
  const resolvedChapters = resolveItemChapters(item);
  res.json({
    ...item,
    ...(channelAvatarUrl ? { channelAvatarUrl } : {}),
    ...(watchUrl ? { watchUrl } : {}),
    chapters: resolvedChapters.chapters,
    chaptersSource: resolvedChapters.chaptersSource,
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

// v1.36.2 (Dean: "sticky post-deletion" -- the "doesn't delete" half): the
// errno classes the DELETE route treats as RECOVERABLE -- the actionable
// 409 with the "remove from library anyway?" follow-up, instead of an
// un-actionable 500 dead end. EROFS/EACCES are the original v1.13 pair
// (read-only/permission mounts); EBUSY (the file is open -- being streamed
// or transcoded -- or an overlay lock) and EPERM (NFS/SMB/overlay volume
// drivers) joined in v1.36.2 after production deletes on Docker volumes
// died at the generic 500 with no escape hatch. Exported for unit coverage.
const RECOVERABLE_DELETE_CODES = new Set(['EROFS', 'EACCES', 'EBUSY', 'EPERM']);

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

// v1.41.10: after a delete path believes the file is gone (a watched
// unlinkSync OR an ENOENT "already gone"), ask the PARENT DIRECTORY's own
// enumeration -- raw bytes, the same modality the scanner trusts. A file in
// SMB/CIFS DELETE_PENDING (an open handle somewhere pins an already-deleted
// file) keeps its dirent enumerable while existsSync/unlink/open all report
// ENOENT -- readdir is the one observable that distinguishes "gone" from
// "undead". Accepts the same string-or-Buffer path shapes the delete route
// resolves (realPathRaw is a Buffer for non-round-tripping names). Returns
// true ONLY when the exact leaf bytes are still listed; on any doubt
// (unreadable dir, separator-less path) it returns false, so a false positive
// can never downgrade an honest delete into a tombstoned one.
function leafStillEnumerated(p) {
  let dirPart;
  let leafBuf;
  if (Buffer.isBuffer(p)) {
    const sep = p.lastIndexOf(path.sep.charCodeAt(0));
    if (sep < 0) return false;
    dirPart = p.subarray(0, sep);
    leafBuf = p.subarray(sep + 1);
  } else {
    dirPart = path.dirname(p);
    leafBuf = Buffer.from(path.basename(p), 'utf8');
  }
  if (leafBuf.length === 0) return false;
  try {
    return fs.readdirSync(dirPart, { encoding: 'buffer' }).some((e) => e.equals(leafBuf));
  } catch (_) {
    return false;
  }
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
  // v1.41.3: true ONLY when this handler itself watched fs.unlinkSync succeed
  // on the resolved on-disk path. Every OTHER success-reporting conclusion
  // (resolver `gone`, ENOENT `alreadyGone`, removeAnyway) is UNVERIFIED --
  // the file may in fact survive -- and mints a deletion tombstone below so
  // the next scan can finish the job (or honestly re-index). A verified
  // unlink mints NOTHING: the file is provably gone, and a same-path file
  // appearing later (even with an old mtime -- rsync -a, Syncthing, a backup
  // restore all preserve mtimes) is the user putting content BACK, which the
  // scan must index, never reap.
  let unlinkVerified = false;

  // v1.37.5: resolve the stored path to the REAL on-disk entry (handles an
  // NFC/NFD-variant name that `existsSync(item.filePath)` would miss) BEFORE
  // touching the db -- see `resolveOnDiskPath`'s doc comment for the bug this
  // closes.
  const resolved = resolveOnDiskPath(filePath);
  if (resolved.realPath === null && resolved.unreadable) {
    // We could not even ENUMERATE the parent dir (EACCES/EPERM/ENOTDIR), so we
    // cannot confirm the file is gone. Dropping the library entry here is
    // exactly the "disappears from the list but the file survives -> rescan
    // resurrects it" bug -- so leave the db COMPLETELY untouched and surface a
    // recoverable 409 (same opt-in `removeAnyway` follow-up as a read-only
    // volume). Only once the caller explicitly accepts does the entry go.
    if (!removeAnyway) {
      const code = resolved.unreadable.code;
      console.error(`Cannot delete ${filePath}: parent directory un-enumerable (${code || 'unknown'}); library entry left intact.`);
      return res.status(409).json({
        error: `Could not delete the file: its folder could not be read (${code || 'unknown'}), so removal can't be confirmed. The file was not removed.`,
        code,
        readOnly: true,
      });
    }
    fileRemainsOnDisk = true; // removeAnyway: caller accepts it may reappear on the next scan.
  }
  // The concrete path we unlink + hang sidecar cleanup off of. Null only when
  // the file is genuinely absent (`gone`) or unconfirmable-but-removeAnyway.
  const mediaPathOnDisk = resolved.realPath;

  // v1.41.10: close OUR OWN live streaming handles on everything this delete
  // is about to unlink, and wait (bounded) for the fds to actually close
  // BEFORE the unlink. An open read handle turns an SMB/CIFS delete into
  // server-side DELETE_PENDING -- the dirent stays enumerable until the last
  // holder closes while every retry reports ENOENT -- and this process was
  // itself the holder in the incident this fixes (seek-abandoned Range
  // streams; see activeMediaStreams' header). Registry keys are the exact
  // strings handed to createReadStream: the stored path, the resolved
  // on-disk variant, and the two id-keyed sidecars a player may be pulling.
  const releasePaths = new Set([filePath, transcodedPath(item.id), audioPath(item.id)]);
  // Defensive: today no route streams the RESOLVED variant when it differs
  // from item.filePath (players receive item.filePath verbatim), so this Set
  // member is a no-op lookup -- it exists so a future caller that streams the
  // resolved spelling is covered without anyone having to remember this line.
  if (mediaPathOnDisk) releasePaths.add(mediaPathOnDisk);
  // Parallel: the bounded waits overlap, so even the pathological all-wedged
  // case delays the DELETE by one 3s cap, not one per path.
  const releasedStreams = (await Promise.all([...releasePaths].map((p) => destroyMediaStreams(p))))
    .reduce((a, b) => a + b, 0);
  if (releasedStreams > 0) {
    console.log(`Delete: destroyed ${releasedStreams} live read stream(s) on ${filePath} before unlinking.`);
  }

  try {
    // Delete actual file from filesystem
    if (mediaPathOnDisk) {
      // SEAM 1: when the resolver matched a non-round-tripping name via its raw
      // bytes (`realPathRaw`, a Buffer path), unlink THAT actual dirent -- the
      // string `mediaPathOnDisk` is a lossy U+FFFD reconstruction that would
      // ENOENT. For every ordinary case realPathRaw is absent and this is the
      // plain string path.
      fs.unlinkSync(resolved.realPathRaw || mediaPathOnDisk);
      unlinkVerified = true;
      if (mediaPathOnDisk !== filePath) {
        console.log(`Deleted file from disk (resolved a Unicode/name variant of the stored path): ${mediaPathOnDisk}`);
      } else {
        console.log(`Deleted file from disk: ${mediaPathOnDisk}`);
      }
    } else if (!fileRemainsOnDisk) {
      // resolved.gone: genuinely absent (parent dir readable with no matching
      // entry, or the dir itself is gone). The desired end state ("not on
      // disk") already holds -> SUCCESS; fall through to remove the orphaned
      // library entry, matching the v1.36.2 alreadyGone contract below.
      console.warn(`File not on disk when deleting (already gone): ${filePath}`);
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

    // v1.36.2 (Dean): clean up subtitle sidecars living NEXT TO the media
    // file (`<basename>.<lang>.vtt`, written by the yt-dlp download's
    // --write-subs). Best-effort: an orphaned .vtt can't resurrect a
    // library item (not a media extension), but leaving it litters the
    // channel folder forever. Never blocks the delete.
    try {
      // v1.37.5: hang sidecar cleanup off the RESOLVED on-disk path (its
      // `<basename>.<lang>.vtt` neighbours share the real file's exact name),
      // falling back to the stored path when the media file was already gone.
      const mediaPath = mediaPathOnDisk || filePath;
      const dir = path.dirname(mediaPath);
      const base = path.basename(mediaPath, path.extname(mediaPath));
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith(`${base}.`) && name.endsWith('.vtt')) {
          try { fs.unlinkSync(path.join(dir, name)); } catch (_) { /* best-effort */ }
        }
      }
    } catch (_) { /* best-effort -- e.g. the dir itself is gone */ }
  } catch (err) {
    // v1.36.2 (Dean: "sticky post-deletion" -- the "doesn't delete" half):
    // EBUSY (file open/streaming, an overlay lock) and EPERM (NFS/SMB/
    // overlay volume drivers) previously fell to the generic 500 below --
    // an un-actionable dead end with NO removeAnyway escape hatch, so the
    // item just stayed. They are now classified with EROFS/EACCES as
    // RECOVERABLE: the client gets the same actionable 409 + the same
    // opt-in "remove from library anyway" follow-up.
    const readOnly = err && RECOVERABLE_DELETE_CODES.has(err.code);
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
      // disk. v1.41.3: the unverified tombstone minted below means the next
      // scan RETRIES the unlink once (a transient EBUSY usually clears);
      // only if that retry also fails is the file re-indexed.
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
        error: `Could not delete the file: this location is read-only, permission-denied, or the file is busy (${err.code}). The file was not removed.`,
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

  // v1.41.10: post-verify against the parent directory. BOTH success shapes
  // above -- a watched unlinkSync AND the ENOENT->"already gone" conclusion --
  // can lie when the server holds the file in DELETE_PENDING (an open handle
  // this process failed to release, or one on another machine entirely): the
  // unlink "succeeds" or ENOENTs, yet the dirent stays enumerable and the next
  // scan re-indexes it. If the exact leaf bytes are still listed AND the leaf
  // is unopenable, the file is NOT gone: say so (fileRemainsOnDisk +
  // deletePending below), and downgrade unlinkVerified so the tombstone mint
  // fires -- by the tombstone contract (v1.41.3) a conclusion contradicted by
  // the directory itself is the definition of unverified.
  //
  // Adversarial-gate CRITICAL (C1, this release): "still enumerated" ALONE
  // must never downgrade a VERIFIED unlink. An external writer can land a
  // brand-new file at the same leaf inside the unlink->readdir window (an
  // in-flight yt-dlp re-download completing -- the archive append below only
  // gates FUTURE download starts -- or a sync-client restore), and tombstoning
  // THAT file schedules the scan to reap content the user never deleted:
  // yt-dlp's default --mtime backdating defeats the scan's mtime<=deletedAt
  // gate, and the fresh-db guards can't help (the tombstone is fresh; the
  // metadata entry was just removed). Proven with a runnable repro against
  // this branch; main kept the file. So discriminate undead-vs-recreated by
  // OPENABILITY -- the incident's own signature: a DELETE_PENDING dirent is
  // enumerable while every NEW open is refused (Linux cifs maps
  // STATUS_DELETE_PENDING to ENOENT), whereas a recreated file opens fine.
  // Deliberately an open, NOT existsSync: with actimeo=1 a stat can be
  // answered from the client attribute cache for up to a second after the
  // unlink and would misclassify a genuinely-pending file as recreated; an
  // open is a real server round-trip. (An enumerated survivor that opens
  // EACCES is misread as pending -- accepted: the worst case is one tombstone
  // whose scan-side reap still re-checks mtime and the fresh-db guards.)
  //
  // Known residual (QA W1, disclosed): the OPPOSITE miss -- a stale
  // client-side directory cache omitting a genuinely-pinned survivor -- makes
  // this check pass, no tombstone is minted, and the next scan re-indexes the
  // survivor once. Self-healing: deleting the re-indexed card again lands in
  // the ENOENT shape above, which readdir (by then long past any cache TTL)
  // catches and tombstones. One extra user delete, never data loss.
  let deletePending = false;
  if (!fileRemainsOnDisk) {
    const checkPath = resolved.realPathRaw || mediaPathOnDisk || filePath;
    if (leafStillEnumerated(checkPath)) {
      let openable = false;
      try {
        fs.closeSync(fs.openSync(checkPath, 'r'));
        openable = true;
      } catch (_) { /* unopenable: the delete-pending signature */ }
      if (!openable) {
        deletePending = true;
        fileRemainsOnDisk = true;
        unlinkVerified = false;
        console.warn(`Delete: ${filePath} is STILL enumerated by its parent directory and refuses opens after the unlink (server-side delete-pending: an open handle somewhere is pinning it) -- reporting honestly and minting a tombstone.`);
      } else if (unlinkVerified) {
        // Enumerated AND openable after a watched unlink: a NEW file landed at
        // this leaf inside the window. It is not the user's delete target --
        // keep the verified conclusion (and therefore NO tombstone) so the
        // next scan indexes it as the new content it is.
        console.log(`Delete: a different file appeared at ${filePath} immediately after the unlink -- leaving it alone (new content, not ours to remove).`);
      }
      // (ENOENT shape + openable: keep the pre-existing v1.41.3 contract
      // exactly -- success + unverified tombstone; the scan's mtime and
      // fresh-db checks decide what the surviving bytes are.)
    }
  }

  // v1.36.2 (Dean: "sticky post-deletion" -- the "comes back" half): make
  // DELETION authoritative for staying gone. "Delete stays gone" previously
  // relied entirely on the id already being in the shared download archive
  // from the ORIGINAL download -- but one-offs download with
  // --no-download-archive (their post-hoc append is best-effort and can
  // fail), and an archive file lost to an ephemeral volume has no entry, so
  // such a video was re-downloaded by the next subscription poll inside its
  // window. Appending here (idempotent, never-throws --
  // recordOneShotInArchive) closes that class for every yt-dlp-managed item
  // regardless of how it was originally downloaded. Scoped exactly like the
  // repull enumeration: rooted under a download dir AND carrying a
  // recoverable youtube id (filename [id] bracket, else the persisted
  // youtubeId re-checked through isSafeVideoId).
  try {
    const ytdlpConfig = ytdlp.parseYtdlpConfig();
    if (ytdlp.isEnabled(ytdlpConfig) && matchRootFolder(filePath, ytdlp.extraScanRoots(ytdlpConfig))) {
      const baseName = path.basename(filePath, path.extname(filePath));
      // v1.41.13: archive by the item's real SOURCE. A legacy YouTube item
      // keeps `youtube <id>` (from the [id] bracket or the persisted
      // youtubeId). A universal item records `<extractor> <sourceId>` -- the
      // RAW sourceId from metadata (authoritative, matches make_archive_id),
      // never the sanitized on-disk bracket (design D5). extractMediaRef also
      // recovers the source for a legacy-less item that carries the new bracket.
      const youtubeId = extractYtdlpVideoId(baseName) || (isSafeVideoId(item.youtubeId) ? item.youtubeId : null);
      if (youtubeId) {
        ytdlp.recordOneShotInArchive(ytdlpConfig, youtubeId, 'youtube');
      } else if (typeof item.sourceExtractor === 'string' && item.sourceExtractor !== '' && typeof item.sourceId === 'string' && item.sourceId !== '') {
        ytdlp.recordOneShotInArchive(ytdlpConfig, item.sourceId, item.sourceExtractor);
      }
    }
  } catch (err) {
    // Best-effort by contract -- a failed archive append must never block
    // the delete (the worst case is the pre-v1.36.2 behavior).
    console.error(`Delete: failed to record ${item.id} in the yt-dlp archive (continuing):`, err && err.message);
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
      // v1.41.3: mint the deletion tombstone (tech-debt #32/#35a) in the SAME
      // mutator that removes the entry -- but ONLY for an UNVERIFIED
      // conclusion (see unlinkVerified's declaration): a false "already gone"
      // on a non-round-tripping name, or a deliberately-skipped unlink
      // (removeAnyway on a transient EBUSY). The scan's deferred-retry
      // contract (pruneDeleteTombstones' header) finishes those deletes. A
      // VERIFIED unlink mints nothing -- tombstoning it would turn every
      // normal delete into a 90-day unlink trap for mtime-preserving
      // restores (adversarial-gate CRITICAL, this release).
      if (!unlinkVerified) {
        if (!freshDb.deleteTombstones || typeof freshDb.deleteTombstones !== 'object' || Array.isArray(freshDb.deleteTombstones)) freshDb.deleteTombstones = {};
        // SEAM 2 (defense-in-depth): the tombstone is keyed by md5(storedPath),
        // but the scanner can only recompute md5(realDiskPath) -- and in this
        // whole bug class those two DIVERGE, so the scanner's direct key lookup
        // never matches and the tombstone sits dead for 90 days while the
        // survivor is re-indexed. Record the yt-dlp id too (the stable
        // invariant on BOTH the stored and the on-disk name) so the scan can
        // recover the match by id when SEAM 1 could not unlink at delete time
        // (a truly-unreadable parent -> removeAnyway, or an unforeseen
        // divergence). Same two-source trust order as the archive append above:
        // the stored basename's `[id]` bracket, else the persisted youtubeId
        // re-checked through isSafeVideoId. null for a non-yt-dlp file (its
        // secondary match never fires -- see the scan's SEAM 2 block).
        const tombstoneYoutubeId = extractYtdlpVideoId(path.basename(filePath, path.extname(filePath)))
          || (isSafeVideoId(item.youtubeId) ? item.youtubeId : null);
        // v1.41.13 (design D4): a non-YouTube item records its source ref too,
        // so the scan's SEAM-2 secondary match can bind a divergent-spelling
        // survivor by identity (same folder + ext, exactly like the YouTube
        // id match). The bracket observed at delete time is stored alongside
        // the raw ref -- SEAM-2 matches on the bracket pair (both sides read
        // dirents -> both sanitized), never raw-vs-bracket (design D5).
        const deleteBracket = extractMediaRef(path.basename(filePath, path.extname(filePath)));
        const tombstoneSourceRef = (item.sourceExtractor && item.sourceId)
          ? { extractor: item.sourceExtractor, id: item.sourceId, bracketId: deleteBracket && !tombstoneYoutubeId ? deleteBracket.id : undefined }
          : null;
        freshDb.deleteTombstones[item.id] = {
          filePath, deletedAt: Date.now(), youtubeId: tombstoneYoutubeId,
          ...(tombstoneSourceRef ? { sourceRef: tombstoneSourceRef } : {}),
        };
        pruneDeleteTombstones(freshDb.deleteTombstones);
      }
      // tech-debt #5 (v1.30-era): mirror the scan-prune path so a
      // manually-deleted recently-served video doesn't strand a
      // persistedServedAt Map entry until id-reuse/restart.
      clearPersistedServedAt(item.id);
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
      ...(deletePending ? { deletePending: true } : {}),
      message: deletePending
        ? 'Removed from your library, but the storage side reports the file is still held open (by another program or device), so it stays on disk until that handle closes. Library scans will keep it hidden and keep retrying the deletion.'
        : 'Removed from your library. Note: the file itself could not be deleted -- the next library scan will retry the deletion once; if it still cannot be deleted, it will reappear.',
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
// `db.metadata`/`db.progress`/`db.liked`/`db.deleteTombstones` and renames the
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
 * v1.41.7 (Dean has NO backup of his media -- no spare storage, so a bulk file
 * op runs on irreplaceable files with no safety net): checksum a file by
 * STREAMING it through sha256 in chunks. Used to verify a cross-filesystem copy
 * by CONTENT before the source (the only other copy) is unlinked -- see
 * `moveItemToFolder`'s EXDEV branch.
 *
 * MEMORY BEHAVIOR (load-bearing -- these are multi-GB video files): a read
 * stream pulls the file in bounded chunks (Node's default 64 KiB highWaterMark)
 * and `hash.update` folds each chunk into fixed-size internal state, so the file
 * is NEVER read whole into a Buffer -- peak memory is one chunk plus the digest
 * state, constant regardless of file size. `fsImpl.createReadStream` is honored
 * (defaulting to the real `fs`) purely so a test's injected fs can drive this
 * deterministically; every real caller uses the real module.
 *
 * Rejects on any read error -- the caller treats an unreadable file as a FAILED
 * verification and leaves the source untouched (never deletes what it could not
 * prove).
 */
function hashFileStreaming(filePath, fsImpl) {
  const createReadStream = (fsImpl && typeof fsImpl.createReadStream === 'function')
    ? fsImpl.createReadStream
    : fs.createReadStream;
  return new Promise((resolve, reject) => {
    let stream;
    try {
      stream = createReadStream(filePath);
    } catch (err) {
      reject(err);
      return;
    }
    const hash = crypto.createHash('sha256');
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
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
  // only copy of the file sat at a path db.json still said was deleted. A crash,
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
    await updateDb((freshDb) => {
      if (!freshDb.deleteTombstones || typeof freshDb.deleteTombstones !== 'object') return false;
      if (!Object.prototype.hasOwnProperty.call(freshDb.deleteTombstones, newIdForTombstone)) return false;
      delete freshDb.deleteTombstones[newIdForTombstone];
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
  // and can be backlogged for seconds during a scan -- in which db.json pointed
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

      if (Object.prototype.hasOwnProperty.call(freshDb.progress, oldId)) {
        freshDb.progress[newId] = freshDb.progress[oldId];
        delete freshDb.progress[oldId];
      }

      // v1.30 C2: LIKED state is membership in `db.liked` (an ARRAY of media
      // ids -- there is no boolean on the item), so it is id-keyed exactly
      // like `db.progress` and has to follow the re-key. It did not, until
      // v1.41.6: every move since v1.30 (the C1 route, the T4 one-off
      // migration) silently DROPPED the item's Like -- the id in the array
      // stopped matching any item and the heart came back empty, with no way
      // for the user to know why. Written back in place (same index) so the
      // liked-view's array order -- which is what `likedItems` renders by --
      // is preserved rather than bumping the item to the end.
      if (Array.isArray(freshDb.liked)) {
        const likedIndex = freshDb.liked.indexOf(oldId);
        if (likedIndex !== -1) freshDb.liked[likedIndex] = newId;
      }

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
      if (freshDb.deleteTombstones && typeof freshDb.deleteTombstones === 'object') {
        delete freshDb.deleteTombstones[newId];
        delete freshDb.deleteTombstones[oldId];
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
    //   - `saveDatabase` writes a temp file, fsyncs it, then ATOMICALLY renames it
    //     over DB_FILE. The only statements after that rename are two plain
    //     assignments (`dbCache = db; dbCacheValid = true;`), which cannot throw.
    //     So any throw is at or before the atomic rename: DB_FILE is untouched.
    //   - `loadDatabase` re-reads and re-parses the file on every call and never
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

/**
 * Carry a moved item's PROCESS-MEMORY state from its old id/path to its new ones.
 * Called by `moveItemToFolder` immediately AFTER its `updateDatabase` mutator has
 * committed -- never from inside it (see that call site's comment: a rolled-back
 * db must not leave these maps re-keyed).
 *
 *  - `pendingProgress`: a watch position posted seconds ago is still in this
 *    debounced staging Map, and `flushPendingProgress` DROPS any id whose
 *    `db.metadata[id]` has gone -- which is exactly what the re-key does to the
 *    old id. Without this carry, a move silently destroys the viewer's position.
 *  - `persistedServedAt` (S-1): the serve-write throttle. Left behind, the dead id
 *    lingers forever (the unbounded-growth + suppressed-re-add leak that map's own
 *    comment documents) while the new id has no entry at all.
 *  - `recentlyServed`: PATH-keyed live-watch protection, so a file that was being
 *    streamed keeps its cache-eviction protection at its new path.
 */
function rekeyInFlightState(oldId, newId, oldPath, newPath) {
  if (pendingProgress.has(oldId)) {
    pendingProgress.set(newId, pendingProgress.get(oldId));
    pendingProgress.delete(oldId);
  }
  const servedAt = persistedServedAt.get(oldId);
  clearPersistedServedAt(oldId);
  if (servedAt !== undefined) persistedServedAt.set(newId, servedAt);
  if (recentlyServed.has(oldPath)) {
    recentlyServed.set(newPath, recentlyServed.get(oldPath));
    recentlyServed.delete(oldPath);
  }
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

// v1.41.7 (Dean has NO media backup): the nearest EXISTING ancestor of a
// (possibly not-yet-created) directory. The real relocation `mkdirSync`s the
// channel folder, but the DRY-RUN preview must classify the move -- hardlink vs
// cross-filesystem copy -- WITHOUT creating anything. A directory-to-be always
// lands on the same filesystem as the existing parent it will be created under,
// so stat that. Confined destinations always sit under an existing download
// root, so this terminates well before the filesystem root; the bounded loop is
// pure belt-and-braces.
function nearestExistingDir(dir, fsImpl) {
  let current = path.resolve(dir);
  for (let i = 0; i < 128; i++) {
    if (fsImpl.existsSync(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return current; // filesystem root -- stop
    current = parent;
  }
  return current;
}

// v1.41.7 (Dean has NO media backup): a BEST-EFFORT PREDICTION of whether the
// real move will be a same-filesystem HARD LINK (linkSync -- no bytes copied,
// same inode) or a cross-filesystem COPY (bytes duplicated, source deleted after
// a checksum match). Determined WITHOUT moving anything: `st.dev` is the
// filesystem device id, and a hard link can only span files on the same device
// -- so equal `dev` PREDICTS `linkSync` will succeed, unequal PREDICTS the EXDEV
// copy path. The destination DIR may not exist yet (the real move creates it), so
// compare against the nearest existing ancestor.
//
// This is a PREDICTION, not a guarantee (gate fix, HONESTY 2, adversarial): a
// mount boundary between the nearest existing ancestor and the to-be-created leaf
// (autofs/automount, a nested mount) can make an ancestor stat same-device while
// the created leaf is cross-device; and a same-dev filesystem that does not
// support hard links (some FUSE/SMB) makes `linkSync` throw. Neither endangers a
// file -- the executor's copy path is the checksum-verified one, and a link that
// hard-fails leaves the source intact -- but the hardlink/copy split is FALSE
// CONFIDENCE about METHOD/COST if read as certain. The preview modal discloses
// this explicitly; the guarantee Dean relies on is the checksum, not this label.
// Returns `'unknown'` (never a guess) when either side can't be stat'd.
function classifyTransfer(sourcePath, destinationDir, fsImpl) {
  try {
    const srcDev = fsImpl.statSync(sourcePath).dev;
    const destDev = fsImpl.statSync(nearestExistingDir(destinationDir, fsImpl)).dev;
    const sameDevice = srcDev === destDev;
    return { transfer: sameDevice ? 'hardlink' : 'copy', sameDevice };
  } catch {
    return { transfer: 'unknown', sameDevice: null };
  }
}

// v1.41.7 (Dean has NO media backup -- and wants the preview honest about what a
// reheat touches AND IN WHAT WAY): a reheat does TWO things per item -- (1)
// hydrate/refresh channel metadata (no file touch), and (2) maybe relocate the
// file. This classifies the METADATA half from PERSISTED STATE ONLY -- never a
// network call, never an ffprobe:
//   - 'up-to-date'  -- the item already carries the reheat marker
//     (`metadataRepulledAt`), so a NON-force reheat SKIPS its metadata pass
//     entirely (see `runRepullMetadataBatch`'s `if (item.alreadyRepulled &&
//     !force)` branch). No metadata will change. This is exactly the
//     `!!item.metadataRepulledAt` predicate `enumerateRepullableItems` uses for
//     its `alreadyRepulled` flag -- so the preview and the executor cannot drift.
//   - 'may-refresh' -- no marker yet, so the reheat WILL attempt a metadata pass.
//     Whether it actually changes anything depends on the network/ffprobe result,
//     which we deliberately do NOT fetch -- so we say "may be refreshed", never
//     assert it will. (Never overstate: Dean's rule.)
// Kept as its own tiny exported helper so BOTH `planImportRelocation` and the
// preview builder read the metadata effect from the SAME place.
function classifyMetadataEffect(item) {
  return (item && item.metadataRepulledAt) ? 'up-to-date' : 'may-refresh';
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
function planImportRelocation(deps, config, mediaId, dbSnapshot) {
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
  if (db.settings && db.settings.relocateHydratedImports === false) {
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

  // Identity, re-validated at the write boundary (db.json is a file anything
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
  if (activeProtectedPaths(Date.now()).has(item.filePath)) {
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
  if (ytdlp.hasAmbiguousChannelSubscription(db, channelForJoin)) {
    return skipWithItem('ambiguous-subscription');
  }

  let targetDir;
  try {
    targetDir = ytdlp.resolveChannelDirForChannel(db, config, channelForJoin);
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
//     (re-validated HERE, at the write boundary, not trusted from db.json) AND
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
async function relocateHydratedImportIntoChannelFolder(deps, config, mediaId) {
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
  const plan = planImportRelocation(deps, config, mediaId);
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
        { loadDatabase: loadDb, updateDatabase: updateDb },
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
// @returns {{moves: Array, skips: Array, summary: object}}
function buildImportRelocationPreview(deps, config) {
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
    // ONE shared decision -- identical to what the executor would decide for this
    // item right now. No fetch, no ffprobe: purely persisted db state + read-only
    // fs stats. The already-loaded `db` snapshot is threaded in (perf: no per-item
    // reload) -- the decision LOGIC is byte-identical to the executor's, only the
    // db source differs.
    const plan = planImportRelocation(deps, config, mediaId, db);
    const item = metadata[mediaId];
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
      totalItems: ids.length,
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

// v1.41.6 gate fix (adversarial WARNING): is ffmpeg queued on, or actively
// working on, this item? Two independent signals, because neither alone is
// complete:
//   - the QUEUES (`transcodeQueue`/`audioExtractQueue`) hold not-yet-started jobs
//     pinned to `{id, srcPath}` -- a move invalidates `srcPath` and the worker
//     then drops the job silently, leaving the status stuck forever;
//   - the item's own `transcodeStatus`/`audioStatus` is what a RUNNING job sets
//     (the busy job's id is not tracked anywhere else), and it also covers a job
//     queued before a restart.
// Pure: reads module state and the item, touches nothing.
function isMediaJobInFlight(item) {
  const id = item && item.id;
  const busyStatuses = new Set(['pending', 'processing']);
  if (item && busyStatuses.has(item.transcodeStatus)) return true;
  if (item && busyStatuses.has(item.audioStatus)) return true;
  if (typeof id === 'string' && id !== '') {
    if (transcodeQueue.some((job) => job && job.id === id)) return true;
    if (audioExtractQueue.some((job) => job && job.id === id)) return true;
  }
  return false;
}

// The `%(title)s` half of the relocated file's native name (see
// `relocateHydratedImportIntoChannelFolder`). Prefers the REAL title the reheat
// just pulled from yt-dlp (`sourceTitle`) over the item's display title, which
// for an import is only ever its own filename; falls back to the current
// basename with any existing `[id]` bracket stripped (`cleanDisplayTitle`) so a
// re-run can never produce `Title [id] [id]`.
//
// Sanitization is a CONSERVATIVE, path-safe fold of our own -- deliberately NOT
// byte-identical to what yt-dlp produces (gate fix, QA WARNING: this comment used
// to claim it "mirrors --windows-filenames", which is false). yt-dlp maps the
// reserved characters to FULL-WIDTH lookalikes (`?` -> `？`) and imposes no length
// cap; we replace them with `-` and bound the length. Consequence, stated
// plainly: the name FileTube builds for a relocated import generally DIFFERS from
// the one yt-dlp would have written for the same video, so yt-dlp's own
// "file already exists" skip cannot be relied on as a second line of defense
// against a re-download -- the `.ytdlp-archive.txt` append is the ONLY thing
// standing between a relocated import and a duplicate download, which is why an
// archive-append failure is now surfaced to the batch instead of logged and
// forgotten (see the caller).
//
// What it does do: strip control characters, fold the path-dangerous set
// `/ \ : * ? " < > |`, kill traversal sequences, and refuse leading/trailing dots
// and spaces -- while KEEPING spaces, unicode and ordinary punctuation, which is
// what makes a native download's filename human-readable. `sanitizeChannelName`
// (lib/ytdlp/args.js) is deliberately NOT reused: it is a strict A-Z0-9 allowlist
// built for a single FOLDER segment and would fold a real video title into
// unreadable dashes ("Dr. Strangelove" -> "Dr- Strangelove"). The traversal
// guarantee does NOT rest on this sanitizer anyway -- `computeMoveTarget`
// structurally rejects any name that is not a single path segment, and
// `resolveChannelDir` confines the folder -- the same two-layer posture SF4
// documents for the download path itself.
//
// LENGTH IS MEASURED IN BYTES (gate fix, adversarial WARNING). `NAME_MAX` is 255
// BYTES on ext4/overlayfs, not 255 characters: the previous 120-CHARACTER cap let
// a 120-char CJK title through as 360 bytes and a 120-char emoji title as 480,
// both of which ENAMETOOLONG -- so the feature silently failed for an entire
// realistic class of titles (proven with a runnable repro). The budget below is
// what remains of 255 after the ` [<11-char id>]` suffix (15 bytes) and the file
// extension, with room to spare; truncation cuts on a CODE-POINT boundary
// (spread into an array of code points, never `slice` on UTF-16 units), so a
// multi-byte sequence -- or an astral-plane emoji's surrogate pair -- can never
// be cut in half into a replacement character.
const RELOCATION_TITLE_MAX_BYTES = 200; // 200 + " [11-char id]" (15) + ".webm" (5) = 220 bytes, comfortably inside NAME_MAX (255)

// Truncate `s` to at most `maxBytes` UTF-8 bytes, never splitting a code point.
function truncateToBytes(s, maxBytes) {
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return s;
  let out = '';
  let used = 0;
  for (const cp of s) { // string iteration is by CODE POINT, not UTF-16 unit
    const size = Buffer.byteLength(cp, 'utf8');
    if (used + size > maxBytes) break;
    out += cp;
    used += size;
  }
  return out;
}

function resolveRelocationTitle(item) {
  const raw = (typeof item.sourceTitle === 'string' && item.sourceTitle.trim() !== '')
    ? item.sourceTitle
    : cleanDisplayTitle(path.basename(item.filePath, path.extname(item.filePath)));
  let cleaned = String(raw || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\.\./g, '-') // no traversal sequence can survive, in any ordering
    .trim()
    // No leading dot or dash: a leading dot is a hidden file (the scan's own
    // walk skips dotfiles), and a leading dash is the classic
    // filename-looks-like-a-flag hazard. `sanitizeChannelName` strips leading
    // dashes for the same reason.
    .replace(/^[-. ]+/, '');
  cleaned = truncateToBytes(cleaned, RELOCATION_TITLE_MAX_BYTES).trim();
  // No trailing dot/space (Windows-hostile, and a trailing dot next to the
  // ` [id]` suffix reads as a broken name everywhere else).
  cleaned = cleaned.replace(/[. ]+$/, '');
  return cleaned === '' ? 'video' : cleaned;
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
 *      `deriveScanYoutubeId` documents, above) or a prior reheat.
 *   3. else `null` id -- still enumerated (never a network call: the worker
 *      gates its spawn on a watch URL) purely so the worker's LOCAL,
 *      network-free ffprobe tags pass can still upgrade it from an embedded
 *      `purl` a pre-v1.33 scan never stored. A genuine home video with no
 *      tags at all resolves nothing there, is marked `exhausted`, counted
 *      `skipped`, and never touches the network.
 * `withSourceId` counts (2)+(1) -- the items a network pass will actually
 * run for -- so the caller can report an honest blast radius instead of
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
 * @returns {{items: Array<{mediaId: string, filePath: string, videoId: string|null, watchUrl: string|null, inDownloadRoot: boolean, alreadyRepulled: boolean}>, eligible: number, ineligible: number, withSourceId: number}}
 */
function enumerateRepullableItems(db, config) {
  const result = { items: [], eligible: 0, ineligible: 0, withSourceId: 0 };
  const metadata = (db && db.metadata) || {};
  const downloadRoots = ytdlp.extraScanRoots(config);

  for (const id of Object.keys(metadata)) {
    const item = metadata[id];
    if (!item || typeof item.filePath !== 'string' || item.filePath === '') {
      result.ineligible++;
      continue;
    }
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
      inDownloadRoot: !!matchRootFolder(item.filePath, downloadRoots),
      alreadyRepulled: !!item.metadataRepulledAt,
    });
    result.eligible++;
    if (videoId) result.withSourceId++;
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
 *   folder-based backfill (~line 3562, `if (!item.channelUrl)`): an item that
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
 *   happens here), so `db.progress[mediaId]` and every id-keyed sidecar
 *   (thumbnail, transcode) stay bound to the exact same id, untouched.
 * - A `mediaId` no longer present in `db.metadata` (the item was deleted
 *   concurrently, mid-run) is a safe no-op: the mutator returns `false`
 *   (skips the save) and this function resolves to `false`.
 *
 * @param {{loadDatabase?: Function, updateDatabase: Function, getMediaId?: Function}} deps
 * @param {string} mediaId
 * @param {{releaseDate?: number, channelAvatarUrl?: string, channel?: {channelUrl: string, channelHandleUrl?: string, channelId?: string, channelName?: string}, filePath: string, markComplete?: boolean}} meta
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
    if (c && typeof c.channelUrl === 'string' && c.channelUrl !== '' && attributable) {
      if (!item.channelUrl) {
        // A genuine gap -- exactly Dean's MeTube imports (a folder name is all
        // they ever had). Write the identity as a UNIT: all of it comes from
        // this one video's own info dict, so it can never be mixed.
        item.channelUrl = c.channelUrl;
        if (typeof c.channelHandleUrl === 'string' && c.channelHandleUrl !== '') item.channelHandleUrl = c.channelHandleUrl;
        if (typeof c.channelId === 'string' && c.channelId !== '') item.channelId = c.channelId;
        if (typeof c.channelName === 'string' && c.channelName !== '') item.channelName = c.channelName;
      } else {
        // Already attributed to this SAME channel -- fill genuine per-field
        // gaps only (e.g. a folder-backfilled item that got a handle URL but
        // no channelId), never re-point or rewrite what is already there. The
        // existing `channelUrl` is deliberately NOT normalized to the
        // canonical form: rewriting it is an overwrite, not a gap-fill, and
        // every consumer already joins on channelId/handle alike.
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
    if (typeof m.channelAvatarUrl === 'string' && m.channelAvatarUrl !== '' && (!c || attributable)) {
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

// API: Library-wide "fun stats" dashboard (C4, v1.24 UX Round Wave 3).
// Computed LIVE from `db.metadata` on every request via the pure helpers in
// `lib/stats.js` -- deliberately no cached aggregate (see that module's
// header comment): at home-server scale an O(n) pass per request is trivial
// and always fresh, and a cache would need its own invalidation story for no
// real benefit.
app.get('/api/stats', (req, res) => {
  const db = getCachedDatabase(); // v1.30 A3: pure read on a request/serve path
  const books = booksStore.readBooks(db);
  // v1.41.0 (Dean): the Stats page is now the whole-library + About hub --
  // fold in book inventory and the version/links "system" block. yt-dlp version
  // moved here from the Subscriptions page; rows the client hides when a thing
  // isn't installed (ytdlp not enabled -> null; TTS not available).
  const ytdlpEnabled = ytdlp.isEnabled(ytdlp.parseYtdlpConfig());
  res.json({
    ...stats.computeLibraryStats(db.metadata),
    books: stats.computeBookStats(books.items, books.audio),
    system: {
      version: APP_VERSION,
      repoUrl: REPO_URL,
      ytdlp: { enabled: ytdlpEnabled, version: ytdlpEnabled ? ytdlp.getCachedYtdlpVersion() : null },
      tts: { available: ttsAvailable(), engine: ttsConfig.engine, version: ttsEngineVersion },
    },
  });
});

// v1.41.11 (Dean: "see files that are truly duplicates so I can clean them
// up -- wasted storage"): the duplicates report. Same posture as /api/stats
// directly above -- a pure O(n) transform over db.metadata per request (see
// computeDuplicateReport's header in lib/stats.js for the two sections and
// the injected-extractor contract). READ-ONLY by design: no delete actions
// anywhere on this surface (Dean's no-data-loss norm); he cleans up by hand.
app.get('/api/duplicates', (req, res) => {
  const db = getCachedDatabase(); // pure read on a request path (v1.30 A3)
  res.json(stats.computeDuplicateReport(db.metadata, { extractVideoId: extractYtdlpVideoId }));
});

// The same report as a downloadable CSV (Dean: "exportable output"). Static
// ASCII filename -- contentDispositionAttachment is for media titles; nothing
// here needs RFC 5987. One row per file, section-tagged; see
// duplicateReportToCsv for the quoting + formula-defusal contract.
// Synchronous O(n) on the request thread, same posture as /api/stats above --
// the v1.41.11 gate probed a pathological 100k-item library at ~390ms report
// + ~230ms CSV, acceptable at home-server scale; revisit only if libraries
// grow an order of magnitude past that.
app.get('/api/duplicates.csv', (req, res) => {
  const db = getCachedDatabase();
  const csv = stats.duplicateReportToCsv(stats.computeDuplicateReport(db.metadata, { extractVideoId: extractYtdlpVideoId }));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="filetube-duplicates.csv"');
  res.send(csv);
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

// v1.34 T3 (Dean): the per-video CHAPTERS EDITOR endpoint. The client posts
// the editor textarea's RAW TEXT (one "0:00 Title" line per chapter -- the
// same grammar description parsing uses; parseChapterLines is the single
// grammar owner) and the parsed result is stored as `chaptersManual` --
// MANUAL ALWAYS WINS at serve time (resolveItemChapters). Empty/whitespace
// text CLEARS the manual list (falling back to embedded/description).
// Mirrors the dimensions route's exact updateDatabase + async-rejection
// pattern above. The scan never writes chaptersManual, and the Phase-2
// final-merge guard mirrors it from the fresh db unconditionally, so an
// edit landing mid-scan can never be reverted.
app.post('/api/videos/:id/chapters', async (req, res) => {
  const body = req.body || {};
  if (typeof body.text !== 'string') {
    return res.status(400).json({ error: 'text must be a string (one "0:00 Title" line per chapter; empty to clear)' });
  }
  if (body.text.length > 20000) {
    return res.status(400).json({ error: 'Chapter text too large (max 20000 characters)' });
  }
  const clearing = body.text.trim() === '';
  const parsed = clearing ? [] : parseChapterLines(body.text);
  if (!clearing && parsed.length === 0) {
    return res.status(400).json({ error: 'No valid chapter lines found — use one "0:00 Title" line per chapter' });
  }
  let notFound = false;
  let resolved = null;
  try {
    await updateDatabase(db => {
      const item = db.metadata[req.params.id];
      if (!item) {
        notFound = true;
        return false;
      }
      if (clearing) {
        if ('chaptersManual' in item) delete item.chaptersManual;
      } else {
        item.chaptersManual = parsed;
      }
      resolved = resolveItemChapters(item);
      return true;
    });
  } catch (err) {
    console.error(`Error saving chapters for ${req.params.id}:`, err);
    return res.status(500).json({ error: `Could not save chapters: ${err.message}` });
  }
  if (notFound) return res.status(404).json({ error: 'Media file not found' });
  res.json({ success: true, ...resolved });
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
  // v1.34 T2 (desktop CC sync): `?offset=<seconds>` serves the document with
  // every cue shifted earlier by that amount -- the client's live-transcode
  // playback re-points its <track> here after a live seek, because the
  // ffmpeg pipe's timeline restarts at 0 while cue times are absolute (see
  // shiftVttCues' own comment, lib/subtitles.js). Bounded parse: absent/
  // garbage/negative/absurd values serve the unshifted document, never a 400
  // (a broken offset should degrade to v1.33 behavior, not kill captions).
  const rawOffset = req.query.offset;
  const offset = typeof rawOffset === 'string' ? Number(rawOffset) : NaN;
  if (Number.isFinite(offset) && offset > 0 && offset <= 60 * 60 * 24) {
    vttText = subtitles.shiftVttCues(vttText, offset);
  }
  // v1.41.1 (Dean): normalize every cue to bottom-center (last, so it keeps
  // whatever times the optional shift produced). CSS can't reposition native
  // cues, so we fix it at the source for both SRT-derived and .vtt captions.
  vttText = subtitles.centerVttCues(vttText);
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

// ---- v1.41.10: live media read-stream registry ------------------------------
// WHY (the "undeletable emoji files" incident, 2026-07-16): every browser seek
// aborts its in-flight Range request, and `source.pipe(dest)` does NOT destroy
// the source fs.ReadStream when the destination closes early -- each abandoned
// request stranded one open fd on the media file, forever (~180 were found
// pinned on three files in production). On an SMB/CIFS volume an open handle
// turns a delete into server-side DELETE_PENDING: the dirent stays enumerable
// until the LAST handle closes, every new open (including unlink's own
// open-for-delete) is refused with a status the kernel maps to ENOENT, the
// DELETE route concluded "already gone", and the next scan re-indexed the
// survivor -- the resurrect loop, with the filename's emoji as an innocent
// bystander. Two duties:
//   1. sendRangeable() pipes via stream.pipeline(), which DOES destroy the
//      source on premature response close -- no stranded fd in the first place
//      (and a mid-stream fs read error lands in its callback instead of being
//      an unhandled 'error' event).
//   2. DELETE /api/videos/:id calls destroyMediaStreams() on every path it is
//      about to unlink, so deleting a video mid-playback cannot leave OUR OWN
//      handle pinning the file into DELETE_PENDING.
// Keyed by the exact filePath string handed to fs.createReadStream -- the same
// string the DELETE route resolves, so lookups are plain Map hits.
// SCOPE (QA gate, disclosed): only fs.ReadStreams flow through here -- a live
// transcode (`?live=1`) pins the source via ffmpeg's OWN fd, which no registry
// entry can destroy. That path is covered by the post-verify + tombstone +
// scan-suppress net instead (the delete reports deletePending honestly and the
// scan keeps the item hidden until ffmpeg exits -- its req-close SIGKILL makes
// that prompt). Tracked in tech-debt as the residual of this class.
const activeMediaStreams = new Map(); // filePath -> Set<fs.ReadStream>

function registerMediaStream(filePath, stream) {
  let set = activeMediaStreams.get(filePath);
  if (!set) {
    set = new Set();
    activeMediaStreams.set(filePath, set);
  }
  set.add(stream);
  // fs streams autoDestroy by default, and 'close' fires exactly once after
  // any terminal outcome (normal end, error, or destroy) -- the one hook that
  // can never leak a registry entry.
  stream.once('close', () => {
    set.delete(stream);
    if (set.size === 0) activeMediaStreams.delete(filePath);
  });
}

// Destroy every live read stream on `filePath` and wait -- bounded -- for
// their fds to actually close (the close(2) is async in libuv; an unlink
// issued while the fd is still open is exactly the DELETE_PENDING trap on
// network filesystems). Resolves with the number of streams destroyed. On
// timeout the caller's unlink proceeds anyway: the worst case is the pre-fix
// behavior, never a hung DELETE request.
function destroyMediaStreams(filePath, timeoutMs = 3000) {
  const set = activeMediaStreams.get(filePath);
  if (!set || set.size === 0) return Promise.resolve(0);
  const streams = [...set];
  const allClosed = Promise.all(streams.map((s) => new Promise((resolve) => {
    if (s.closed || s.destroyed) return resolve();
    s.once('close', resolve);
  })));
  for (const s of streams) {
    try { s.destroy(); } catch (_) { /* already torn down */ }
  }
  // NOT unref'd: the cap must be able to fire even when this timer is the
  // only thing left on the loop (it lives only for the duration of a DELETE
  // request, so it never holds an idle process open in practice).
  let timer;
  const cap = new Promise((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  return Promise.race([allClosed, cap]).then(() => {
    clearTimeout(timer);
    return streams.length;
  });
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
    registerMediaStream(filePath, file);
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    };

    res.writeHead(206, head);
    // pipeline, NOT .pipe(): destroys `file` when the response goes away first
    // (every seek aborts the previous Range request) -- see the registry header
    // above. The error argument is deliberately ignored: a premature client
    // close is routine, and a mid-stream read error already destroyed both ends.
    pipeline(file, res, () => {});
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': contentType,
    };
    res.writeHead(200, head);
    const file = fs.createReadStream(filePath);
    registerMediaStream(filePath, file);
    pipeline(file, res, () => {});
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
    // v1.41.6 (gate fix): mark the item's SOURCE path live-watched on EVERY
    // serve, not just when a cached transcode is being served. `recentlyServed`
    // was previously fed only by the cache paths it protects from eviction --
    // there was no signal anywhere for "someone is watching this library file
    // right now". The import-relocation needs exactly that signal: it must not
    // move a file mid-playback (the client would keep using the old, now-dead id
    // for the rest of the session -- see its `recently-watched` clause). Purely
    // additive for the eviction/age-sweep readers of this set: they only ever
    // test membership for files INSIDE the cache directory, and a library path
    // is never one of those.
    markServed(item.filePath);
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
      // v1.41.6 (gate fix): the SOURCE path too -- a background-audio handoff is
      // an active viewing session, and the import-relocation must not re-key an
      // item out from under the client that is mid-playback. See the same mark
      // in `GET /video/:id` for the full reasoning.
      markServed(item.filePath);
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
  // v1.41.6: the reheat's import-relocation seam -- server.js owns the move +
  // id re-key machinery (`moveItemToFolder`) and `db.settings`, so the yt-dlp
  // module gets this deps-injected like every other server-owned primitive
  // (the same circular-require-avoiding bridge `recordRepulledItemMeta` uses).
  // The batch calls it per item, AFTER that item's hydration has persisted.
  relocateHydratedImport: relocateHydratedImportIntoChannelFolder,
  // v1.41.7 (Dean has NO media backup): the DRY-RUN preview seam. server.js owns
  // the shared `planImportRelocation` decision + `db.settings`, so the yt-dlp
  // module's `POST /api/ytdlp/repull-metadata/preview` route gets this deps-
  // injected like every other server-owned primitive. It is READ-ONLY -- it
  // never writes db.json, moves a file, or spawns anything.
  previewImportRelocations: buildImportRelocationPreview,
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
    // v1.37.0 books: both coalescers flush on every graceful-exit path --
    // the book flush shares the media flush's exact loss-bound contract.
    Promise.allSettled([flushPendingProgress(), flushPendingBookProgress()]).then(() => {
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
  // v1.38.0 T12: TTS cache hygiene -- sweep orphaned synth temps and reset any
  // stale 'processing'/'pending' or file-less 'ready' audio status.
  reconcileTtsCacheAtBoot();
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
        // v1.37.0 books: the boot book-scan rides the same deferred slot --
        // a books-less install makes this a pure no-op (zero folders).
        scanBooks().catch(console.error);
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
  // v1.41.10: the live media read-stream registry (leaked-fd/DELETE_PENDING
  // fix) + the delete route's parent-dir post-verify -- exported for direct
  // test coverage (see activeMediaStreams' header for the incident).
  activeMediaStreams,
  registerMediaStream,
  destroyMediaStreams,
  leafStillEnumerated,
  // v1.36.2: the recoverable-delete errno set -- exported for unit coverage.
  RECOVERABLE_DELETE_CODES,
  // v1.37.5: stored-path -> real on-disk entry resolver (NFC/NFD-aware) --
  // exported for unit coverage of the delete-doesn't-delete fix.
  resolveOnDiskPath,
  // v1.41.3: deletion-tombstone prune (pure, in-place) + its bounds --
  // exported for unit coverage of the delete-resurrect fix.
  pruneDeleteTombstones,
  DELETE_TOMBSTONE_CAP,
  DELETE_TOMBSTONE_MAX_AGE_MS,
  // v1.37.0 books: scanner + state accessor + cover dir, exported for the
  // books integration tests (same posture as scanDirectories/THUMBNAIL_DIR).
  scanBooks,
  // v1.38.0 TTS: boot reconcile (stale-status/orphan-temp sweep), exported for
  // direct test coverage (mirrors reconcileTranscode's own testing contract).
  reconcileTtsCacheAtBoot,
  currentBookScanState,
  BOOKCOVER_DIR,
  flushPendingBookProgress,
  currentBookProgressFlushTimer,
  effectiveBookProgress,
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
  // v1.41.6: the reheat's import-relocation (move a hydrated MeTube import into
  // its channel folder + native filename) and the pure title->filename helper it
  // builds the destination name with -- exported for direct test coverage, the
  // same posture as `moveItemToFolder`/`migrateOneOffsIntoChannelFolders` above.
  relocateHydratedImportIntoChannelFolder,
  // v1.41.7 (Dean has NO media backup): the shared move/skip DECISION
  // (`planImportRelocation` -- the ONE predicate both the executor above and the
  // preview below call, so a preview can never drift from the real op), the
  // DRY-RUN preview builder over the whole library, the hardlink-vs-copy
  // classifier, and the streaming checksum used to verify a cross-filesystem
  // copy before the source is deleted. Exported for direct test coverage, same
  // posture as `moveItemToFolder`/`relocateHydratedImportIntoChannelFolder`.
  planImportRelocation,
  buildImportRelocationPreview,
  classifyTransfer,
  classifyMetadataEffect,
  hashFileStreaming,
  resolveRelocationTitle,
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
  // v1.34 T3 (chapters): the pure parsers/resolver, re-exported under the
  // same testing contract.
  parseFfprobeChapters,
  parseChapterLines,
  deriveDescriptionChapters,
  resolveItemChapters,
  normalizeChapter,
  finalizeChapters,
  MAX_CHAPTERS,
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
