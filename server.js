const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');
const mime = require('mime-types');
require('dotenv').config();

// Optional yt-dlp subscription module (v1.11.0): dormant by default.
// Requiring it has NO side effects -- it only defines functions; every side
// effect it can cause (route registration, timer arming) is gated behind
// `isEnabled(config)` inside the functions themselves. See
// lib/ytdlp/index.js for the dormant-wiring mechanism.
const ytdlp = require('./lib/ytdlp');

const app = express();
const PORT = process.env.PORT || 3000;

// Dynamic data directory for Docker volume persistence
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : (fs.existsSync('/app/data') ? '/app/data' : __dirname);
const DB_FILE = path.join(DATA_DIR, 'db.json');
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');
// Browser-incompatible containers (e.g. AVI) are pre-transcoded to MP4 here on scan.
const TRANSCODE_DIR = path.join(DATA_DIR, 'transcoded');

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

// Default automation/cache-housekeeping settings. `0` means "Off" for
// scanIntervalMinutes/cacheMaxAgeDays; `cacheMaxBytes: null` defers to the
// env var / built-in default rather than a UI-set override.
const DEFAULT_SETTINGS = {
  scanIntervalMinutes: 30,
  pruneMissing: true,
  cacheMaxBytes: null,
  cacheMaxAgeDays: 30
};

// Per-key merge so a partial/older `settings` object keeps whatever keys it
// already has and only gets the missing ones defaulted (mirrors the
// `folderSettings` backfill pattern below).
function withDefaultSettings(settings) {
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

// Ensure database file exists
function loadDatabase() {
  if (!fs.existsSync(DB_FILE)) {
    const initialDb = {
      folders: [],
      folderSettings: {},
      progress: {},
      metadata: {},
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
    db.settings = withDefaultSettings(db.settings); // backfill for older databases
    return db;
  } catch (err) {
    console.error('Error reading db.json, resetting database:', err);
    // Every code path out of loadDatabase must hand back a settings-bearing DB.
    return { folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: withDefaultSettings() };
  }
}

// Monotonic counter (per-process) that, combined with the pid, guarantees a
// unique same-directory temp filename per save -- see saveDatabase below.
let dbTmpSeq = 0;

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
function saveDatabase(db) {
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
    if (result !== false) saveDatabase(db); // atomic write-temp-then-rename
    return result;
  });
  dbWriteChain = run.catch(() => {}); // keep the chain alive past a failure
  return run;
}

// Media extensions
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];
const ALL_EXTENSIONS = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS];

// Containers browsers can't decode natively — pre-transcoded to MP4 on scan.
// (Extend this list if other formats fail to play in the browser.)
const TRANSCODE_EXTENSIONS = ['.avi', '.flv', '.wmv', '.mpg', '.mpeg'];

function needsTranscode(ext) {
  return TRANSCODE_EXTENSIONS.includes(ext);
}
function transcodedPath(id) {
  return path.join(TRANSCODE_DIR, `${id}.mp4`);
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

// Pure: given files [{path, size, atimeMs}], return the paths to delete so the
// total size drops to <= maxBytes. Never returns a *.tmp.mp4 (in-flight write)
// or keepPath (the just-produced file) — though keepPath's size still counts
// toward the total. Evicts least-recently-used first (atime asc, then path).
function selectEvictions(files, maxBytes, protectedPaths) {
  // protectedPaths may be a single path, an array, or a Set — never evicted,
  // though their size still counts toward the total.
  const keep = protectedPaths instanceof Set
    ? protectedPaths
    : new Set(protectedPaths ? [].concat(protectedPaths) : []);
  const eligible = files.filter(f => !f.path.endsWith('.tmp.mp4'));
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

// Delete orphaned *.tmp.mp4 files (left if a transcode process was killed
// mid-write). Returns the count removed. Safe to call on startup.
function cleanupOrphanTmp(dir) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch (_) { return 0; }
  let removed = 0;
  for (const name of entries) {
    if (!name.endsWith('.tmp.mp4')) continue;
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

// True for a finished transcoded MP4 (`*.mp4` that is NOT the in-flight
// `*.tmp.mp4` write). Shared by every site that enumerates TRANSCODE_DIR so
// the exclusion can't drift between copies.
function isCompletedTranscode(name) {
  return name.endsWith('.mp4') && !name.endsWith('.tmp.mp4');
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
    try { fs.unlinkSync(p); removed++; console.log(`Evicted from transcode cache: ${p}`); }
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
    if (f.path.endsWith('.tmp.mp4')) continue;
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
      const id = path.basename(name, '.mp4');
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
    try { fs.unlinkSync(p); removed++; console.log(`Aged out of transcode cache: ${p}`); }
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

// Sum of st.size for non-*.tmp.mp4 *.mp4 files in dir. Used for the Settings
// "current cache size" display. try/catch so a missing/unreadable dir or a
// file that vanished mid-scan (readdir vs stat race) never throws.
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
  const srcMeta = loadDatabase().metadata[id];
  const totalDuration = (srcMeta && srcMeta.duration) || 0;
  console.log(`Transcoding to MP4: ${srcPath}`);

  // H.264 + AAC in an MP4 with a front-loaded moov atom (+faststart) for smooth streaming.
  // ultrafast + yuv420p: fastest conversion, broadly compatible (incl. iOS Safari).
  const args = [
    '-i', srcPath,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
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
          evictTranscodeCache(effectiveCacheCap(loadDatabase().settings), outPath);
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
  item.needsTranscode = needsTranscode(item.ext);
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
const EMBEDDED_TAG_WHITELIST = [
  'title', 'artist', 'album', 'date', 'genre', 'composer',
  'description', 'comment', 'synopsis', 'show', 'copyright',
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

// Extract duration and thumbnail using FFmpeg
function extractMetadataAndThumbnail(filePath, mediaId, isAudio) {
  return new Promise((resolve) => {
    const thumbName = `${mediaId}.jpg`;
    const thumbPath = path.join(THUMBNAIL_DIR, thumbName);
    
    if (!ffmpegAvailable) {
      return resolve({ duration: 0, hasThumbnail: false, artist: '', tags: {} });
    }

    // Get duration + all format tags (artist -> channel name; the rest -> the
    // additive "embedded info" block on the watch page).
    const ffprobeCmd = `ffprobe -v error -show_entries format=duration:format_tags -of json "${filePath}"`;
    // Bump maxBuffer well above exec's 1MB default — files with large embedded
    // tags (long descriptions/lyrics) could otherwise overflow it, set `err`, and
    // regress duration to 0 (which would also mis-time the thumbnail grab).
    exec(ffprobeCmd, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      let duration = 0;
      let artist = '';
      let tags = {};
      if (!err && stdout) {
        try {
          const j = JSON.parse(stdout);
          duration = parseFloat(j.format && j.format.duration) || 0;
          const rawTags = (j.format && j.format.tags) || {};
          artist = (rawTags.artist || rawTags.ARTIST || rawTags.Artist || '').trim();
          // Tag extraction is best-effort — never let it break duration/thumbnail.
          try { tags = parseFfprobeTags(j); } catch (_) { tags = {}; }
        } catch (_) {}
      }

      if (isAudio) {
        // Try to extract embedded audio artwork
        const extractArtCmd = `ffmpeg -i "${filePath}" -an -vcodec copy -y "${thumbPath}"`;
        exec(extractArtCmd, (artErr) => {
          resolve({ duration, artist, tags, hasThumbnail: !artErr && fs.existsSync(thumbPath) });
        });
      } else {
        // Extract video frame (at 2 seconds or 10% of duration, whichever is smaller)
        const timestamp = duration > 5 ? 2 : Math.max(0, duration / 2);
        const extractFrameCmd = `ffmpeg -ss ${timestamp} -i "${filePath}" -vframes 1 -q:v 2 -y "${thumbPath}"`;
        exec(extractFrameCmd, (frameErr) => {
          resolve({ duration, artist, tags, hasThumbnail: !frameErr && fs.existsSync(thumbPath) });
        });
      }
    });
  });
}

// Live scan state, surfaced via /api/scan-status for the setup/home UI.
// `rescanRequested` is an internal bookkeeping flag (never serialized by
// /api/scan-status) for the coalesced-follow-up mechanism in
// `scanDirectories`, below.
let scanState = { scanning: false, lastScan: null, rescanRequested: false };

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
    if (stillPending) scheduleDeferredRescan();
  }
}

// Scan directories and sync with database
async function runScanDirectories() {
  const db = loadDatabase();
  const currentFolders = db.folders || [];
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

  for (const folder of currentFolders) {
    if (!fs.existsSync(folder)) {
      console.warn(`Configured folder does not exist: ${folder}`);
      missingRoots.add(folder);
      continue;
    }
    scanDirRecursive(folder, folder, scannedFiles, unreadablePaths);
  }

  // Update db.metadata
  const newMetadata = {};
  let dbChanged = false;

  for (const [filePath, info] of scannedFiles.entries()) {
    const id = getMediaId(filePath);
    
    // If metadata already exists and file hasn't changed (based on size/mtime), reuse it
    if (db.metadata[id] && db.metadata[id].filePath === filePath && db.metadata[id].size === info.size) {
      newMetadata[id] = db.metadata[id];
    } else {
      // New or updated file
      console.log(`Scanning new/updated file: ${info.name}`);
      const isAudio = AUDIO_EXTENSIONS.includes(info.ext);
      
      // Initialize metadata entry
      newMetadata[id] = {
        id,
        name: info.name,
        title: path.basename(info.name, info.ext),
        filePath,
        folderName: info.folderName,
        size: info.size,
        ext: info.ext,
        type: isAudio ? 'audio' : 'video',
        addedAt: info.addedAt,
        duration: 0,
        hasThumbnail: false,
        artist: '',
        needsTranscode: !isAudio && needsTranscode(info.ext)
      };

      try {
        const meta = await extractMetadataAndThumbnail(filePath, id, isAudio);
        newMetadata[id].duration = meta.duration;
        newMetadata[id].hasThumbnail = meta.hasThumbnail;
        newMetadata[id].artist = meta.artist || '';
        newMetadata[id].tags = meta.tags || {};
      } catch (err) {
        console.error(`Error extracting metadata for ${info.name}:`, err);
      }
      dbChanged = true;
    }
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

// Recursive directory scanning helper
function scanDirRecursive(rootFolder, dirPath, results, unreadable) {
  let files;
  try {
    files = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    console.error(`Error reading directory ${dirPath}:`, err);
    // First-class "could not enumerate this subtree" signal, at ANY depth --
    // a transiently-unreadable directory (EACCES/EIO/ESTALE, a dropped nested
    // mount) must never be mistaken for its contents having been deleted.
    // selectPrunableIds retains every entry under this path. A child dir that
    // vanishes/becomes unreadable mid-recursion throws on its OWN readdirSync
    // call below and is recorded there, so nested depth is covered too.
    if (unreadable) unreadable.add(dirPath);
    return;
  }

  for (const file of files) {
    const fullPath = path.join(dirPath, file.name);
    if (file.isDirectory()) {
      scanDirRecursive(rootFolder, fullPath, results, unreadable);
    } else if (file.isFile()) {
      const ext = path.extname(file.name).toLowerCase();
      if (ALL_EXTENSIONS.includes(ext)) {
        try {
          const stats = fs.statSync(fullPath);
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
            folderName
          });
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
    }
  }
}

// Middleware
app.use(express.json());
// Serve the app assets with revalidation (no-cache) so updated HTML/JS/CSS show up
// immediately behind caches (browsers, nginx) instead of serving stale files.
// ETag/Last-Modified still allow cheap 304s when nothing changed.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache');
  }
}));

// API: Get library folders list
app.get('/api/config', (req, res) => {
  const db = loadDatabase();
  res.json({ folders: db.folders || [], folderSettings: db.folderSettings || {} });
});

// API: Save folder configuration
app.post('/api/config', async (req, res) => {
  const { folders, folderSettings } = req.body;
  if (!Array.isArray(folders)) {
    return res.status(400).json({ error: 'folders must be an array of paths' });
  }

  // Validate that folders exist locally
  const validFolders = [];
  for (const folder of folders) {
    const trimmed = folder.trim();
    if (trimmed && fs.existsSync(trimmed)) {
      validFolders.push(trimmed);
    }
  }

  // Keep per-folder settings (display name / hidden), pruned to folders that still exist.
  const cleanSettings = {};
  if (folderSettings && typeof folderSettings === 'object') {
    for (const folder of validFolders) {
      const s = folderSettings[folder];
      if (s && typeof s === 'object') {
        cleanSettings[folder] = {
          name: typeof s.name === 'string' ? s.name.trim() : '',
          hidden: !!s.hidden
        };
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

// API: Scan files on demand
app.post('/api/scan', async (req, res) => {
  // Explicit pre-check: scanDirectories() itself no-ops (beyond flagging a
  // coalesced follow-up) while a scan is already running (overlap guard), so
  // without this check the route would misleadingly return 200 for a request
  // that triggered nothing new synchronously. Surface a 409 instead so
  // callers (and the UI) know a scan is already in flight -- but also flag
  // the follow-up so a manual "Scan now" fired during a scan isn't lost: the
  // in-flight scan will run one more pass for it after it finishes.
  if (scanState.scanning) {
    scanState.rescanRequested = true;
    return res.status(409).json({ error: 'scan already in progress' });
  }
  try {
    await scanDirectories();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Live scan/transcode status for progress feedback in the UI
app.get('/api/scan-status', (req, res) => {
  const db = loadDatabase();
  const items = Object.values(db.metadata);
  const transcoding = items.filter(i =>
    i.needsTranscode && i.transcodeStatus && i.transcodeStatus !== 'ready' && i.transcodeStatus !== 'failed'
  ).length;
  res.json({
    scanning: scanState.scanning,
    lastScan: scanState.lastScan,
    fileCount: items.length,
    folderCount: (db.folders || []).length,
    transcoding
  });
});

// Valid POST /api/settings values for the two enum-like fields. `cacheMaxBytes`
// and `pruneMissing` are validated inline (positive-int-or-null, boolean).
const SCAN_INTERVAL_VALID_VALUES = new Set([0, ...SCAN_INTERVAL_MINUTE_OPTIONS]);
const CACHE_MAX_AGE_DAYS_VALID_VALUES = new Set([0, 7, 14, 30, 90]);

// Shape returned by both GET and POST /api/settings — the four persisted keys
// plus a read-only `effectiveCacheMaxBytes` (UI prefill for the "no override"
// case, since cacheMaxBytes:null defers to the env var / 5 GB default).
function settingsResponse(settings) {
  return {
    scanIntervalMinutes: settings.scanIntervalMinutes,
    pruneMissing: settings.pruneMissing,
    cacheMaxBytes: settings.cacheMaxBytes,
    cacheMaxAgeDays: settings.cacheMaxAgeDays,
    effectiveCacheMaxBytes: effectiveCacheCap(settings)
  };
}

// API: Read the Automation & Storage settings for Settings-page prefill.
app.get('/api/settings', (req, res) => {
  const db = loadDatabase();
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
  const KNOWN_KEYS = ['scanIntervalMinutes', 'pruneMissing', 'cacheMaxBytes', 'cacheMaxAgeDays'];
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
  const db = loadDatabase();
  res.json({
    bytes: transcodeCacheSize(TRANSCODE_DIR),
    effectiveCacheMaxBytes: effectiveCacheCap(db.settings)
  });
});

// API: "Clear cache now" -- delete cached transcodes on demand. Excludes
// *.tmp.mp4 (an in-flight transcode write; deleting it would corrupt the
// transcode in progress) and anything currently protected by
// activeProtectedPaths (the same recentlyServed-within-RECENT_STREAM_MS set
// evictTranscodeCache/sweepAgedTranscodes use) so a clear can never yank a
// file out from under an actively-watched stream. Does NOT touch
// db.metadata[id].lastServedAt -- a future re-transcode naturally re-records
// it on next watch. Per-file
// try/catch so a single failed unlink never fails the whole clear.
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
    } catch (e) {
      console.error(`Failed to clear cached transcode ${p}:`, e.message);
    }
  }
  res.json({ success: true, removed, freedBytes });
});

// API: Get list of videos/audio
app.get('/api/videos', (req, res) => {
  const db = loadDatabase();
  const search = (req.query.search || '').toLowerCase().trim();
  const folderFilter = req.query.folder || '';
  const rootFilter = req.query.root || ''; // a configured folder path — matches everything under it (recursive)

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
    list = list.filter(item => item.title.toLowerCase().includes(search) || item.folderName.toLowerCase().includes(search));
  }

  // Mapped-folder filter: recursive — everything under the configured folder (incl. subfolders).
  if (rootFilter) {
    list = list.filter(item => underFolder(item.filePath, rootFilter));
  }

  // Folder uploader (channel) filter: files whose immediate parent matches.
  if (folderFilter) {
    list = list.filter(item => item.folderName === folderFilter);
  }

  // Map progress to lists
  const resultList = list.map(item => {
    const progress = db.progress[item.id] || { timestamp: 0, duration: 0 };
    return {
      ...item,
      progress: progress.timestamp,
      progressPercent: progress.duration > 0 ? (progress.timestamp / progress.duration) * 100 : 0
    };
  });

  // Sort by date added descending (newest first)
  resultList.sort((a, b) => b.addedAt - a.addedAt);

  res.json(resultList);
});

// API: Get details for single video/audio
app.get('/api/videos/:id', (req, res) => {
  const db = loadDatabase();
  const item = db.metadata[req.params.id];
  if (!item) {
    return res.status(404).json({ error: 'Media file not found' });
  }

  const progress = db.progress[item.id] || { timestamp: 0 };
  res.json({
    ...item,
    progress: progress.timestamp,
    transcodeProgress: transcodeProgress[item.id] || 0
  });
});

// API: Get watch progress
app.get('/api/progress/:id', (req, res) => {
  const db = loadDatabase();
  const progress = db.progress[req.params.id] || { timestamp: 0 };
  res.json(progress);
});

// API: Save watch progress
app.post('/api/progress', async (req, res) => {
  const { id, timestamp, duration } = req.body;
  if (!id || typeof timestamp !== 'number') {
    return res.status(400).json({ error: 'id and numeric timestamp are required' });
  }

  // The existence check moves INSIDE the mutator so it runs against the
  // fresh-inside-the-lock db, not a separately-read (potentially stale)
  // snapshot; `notFound` is captured via closure and handled after the await.
  let notFound = false;
  try {
    await updateDatabase(db => {
      if (!db.metadata[id]) {
        notFound = true;
        return false;
      }
      db.progress[id] = {
        timestamp,
        duration: duration || db.metadata[id].duration || 0,
        updatedAt: new Date().toISOString()
      };
      return true;
    });
  } catch (err) {
    // Express 4 does not catch a rejected async-handler promise, so a
    // rejection left unguarded here would hang the request instead of
    // returning 500 (mirrors POST /api/scan's pattern above).
    console.error('Error saving watch progress:', err);
    return res.status(500).json({ error: `Could not save watch progress: ${err.message}` });
  }
  if (notFound) return res.status(404).json({ error: 'Media not found' });
  res.json({ success: true });
});

// API: Delete video/audio file
app.delete('/api/videos/:id', async (req, res) => {
  const db = loadDatabase();
  const item = db.metadata[req.params.id];
  if (!item) {
    return res.status(404).json({ error: 'Media file not found' });
  }

  const filePath = item.filePath;

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
    // FS failure -- db is left completely untouched (the updateDatabase
    // metadata/progress cleanup below never runs), preserving today's
    // 500-on-FS-failure contract.
    console.error(`Error deleting file ${filePath}:`, err);
    return res.status(500).json({ error: `Could not delete file: ${err.message}` });
  }

  // Clean up database entries only after the FS cleanup above succeeded.
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

  res.json({ success: true, message: 'File deleted successfully' });
});

// Serve extracted thumbnail or fallback placeholder
app.get('/thumbnail/:id', (req, res) => {
  const db = loadDatabase();
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
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
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

// Media streaming endpoint supporting Range requests (highly important for HTML5 seeking/skipping)
app.get('/video/:id', (req, res) => {
  const db = loadDatabase();
  const item = db.metadata[req.params.id];
  if (!item) {
    return res.status(404).json({ error: 'Media file not found' });
  }

  let filePath = item.filePath;

  // Browser-incompatible containers (AVI, etc.):
  //  - desktop asks for ?live=1 -> live transcode, plays instantly (not iOS-safe)
  //  - otherwise -> serve the pre-transcoded MP4 (seekable; works on iOS)
  if (item.needsTranscode) {
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

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File does not exist on disk' });
  }

  // Serving a cached transcode? Mark it recently-served so eviction leaves it
  // alone while it's being watched, and persist the last-served timestamp
  // (throttled/no-clobber) that the age-retention sweep keys off.
  if (item.needsTranscode && filePath === transcodedPath(item.id)) {
    markServed(filePath);
    recordServed(item.id);
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const contentType = item.needsTranscode ? 'video/mp4' : (mime.lookup(filePath) || (item.type === 'audio' ? 'audio/mpeg' : 'video/mp4'));

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize) {
      res.status(416).send('Requested range not satisfiable\n' + start + ' >= ' + fileSize);
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
});

// Optional yt-dlp subscription module (v1.11.0): registered AFTER every
// existing route so enabling it can never shadow/interfere with one. This
// call is a no-op when FILETUBE_YTDLP_ENABLED is unset/off --
// registerRoutes' first line early-returns before adding anything to the
// router, so every /api/subscriptions* request falls through to Express's
// native 404 (see lib/ytdlp/index.js). `deps` are the existing primitives
// the module's later tasks (persistence/poll) need; T1 doesn't call any of
// them from the disabled path.
ytdlp.registerRoutes(app, { updateDatabase, loadDatabase, scanDirectories, getMediaId });

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
  evictTranscodeCache(effectiveCacheCap(loadDatabase().settings));

  // Scan on startup and then periodically per the persisted scanIntervalMinutes
  // preference (default 30 minutes; armScanTimer arms no timer at all when the
  // preference is Off). These live here, not at module top-level, so importing
  // the module for tests neither scans nor keeps the event loop alive.
  scanDirectories().catch(console.error);
  armScanTimer();

  // Same no-op guarantee as registerRoutes above: startBackground early-
  // returns (and arms no timer) when the yt-dlp module is disabled. Placed
  // inside this guard (not at module top-level) so importing server.js for
  // tests never arms the yt-dlp poll timer either.
  ytdlp.startBackground({ updateDatabase, loadDatabase, scanDirectories, getMediaId });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`==================================================`);
    console.log(`  FileTube server running at http://localhost:${PORT}`);
    console.log(`==================================================`);
  });
}

// Exported for testing (see test/). Importing this module has no side effects
// beyond ensuring the data directories exist; it never starts listening.
module.exports = {
  app,
  needsTranscode,
  transcodedPath,
  matchRootFolder,
  getMediaId,
  loadDatabase,
  saveDatabase,
  updateDatabase,
  reconcileTranscode,
  parseFfprobeTags,
  parseCacheCap,
  selectEvictions,
  cleanupOrphanTmp,
  cleanupOrphanDbTmp,
  evictTranscodeCache,
  activeProtectedPaths,
  isCompletedTranscode,
  scanIntervalMs,
  selectAgedOut,
  selectPrunableIds,
  mergeScannedMetadata,
  transcodeCacheSize,
  effectiveCacheCap,
  recordServed,
  clearPersistedServedAt,
  sweepAgedTranscodes,
  scanState,
  scanDirectories,
  armScanTimer,
  currentScanTimer,
  currentDeferredRescanTimer,
  TRANSCODE_CACHE_MAX_BYTES,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  TRANSCODE_EXTENSIONS,
  // Optional yt-dlp subscription module (v1.11.0) -- re-exported so tests can
  // observe the dormant-wiring no-op guarantee without a second require of
  // lib/ytdlp (see AC1-9 in docs/exec-plans/active/2026-07-05-yt-dlp-integration-module.md).
  currentYtdlpPollTimer: ytdlp.currentYtdlpPollTimer,
  parseYtdlpConfig: ytdlp.parseYtdlpConfig,
  isEnabled: ytdlp.isEnabled,
};
