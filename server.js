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
// v1.111 (Dean, streaming Tier 1): faststart detection + safe in-place remux.
const faststart = require('./lib/faststart');
// v1.69: the podcasts place (RSS subscription engine). First-class like
// music/books - routes always registered, nav gated client-side on content.
const podcasts = require('./lib/podcasts');
const podcastStore = require('./lib/podcasts/store');
const heavyGate = require('./lib/heavyGate');
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
const ytdlpStore = require('./lib/ytdlp/store'); // Wave 5: the ytdlp namespace's feature store (FEATURE, createYtdlpStore)
// Metadata+subtitle re-pull backfill (v1.25 QoL follow-up): `buildWatchUrl` is
// a pure, side-effect-free helper (lib/ytdlp/url.js's own module comment) that
// `lib/ytdlp/index.js` already requires internally but does not re-export --
// required directly here, the exact same posture as `ytdlpArgs` above, so
// `enumerateRepullableItems` (lib/ytdlp/relocation.js) can turn a recovered
// yt-dlp video id back into a canonical watch URL for the re-pull job to fetch.
// v1.33 T1/T2: `classifySingleVideo` turns an embedded `purl`/`comment` tag's
// URL into a validated {videoId, watchUrl} (the ONLY id source for a
// bracket-less metube-era filename) -- Wave 6 moved its ONE caller here
// (`youtubeIdFromUrlString`) into lib/scan/identity.js, which now requires it
// from lib/ytdlp/url.js directly with exactly this posture, so it is no longer
// destructured in this file; `isSafeVideoId` guards the persisted
// `youtubeId` field on both write paths -- same direct-require posture as
// `buildWatchUrl` below.
// v1.41.6: `validateChannelUrl` -- the SINGLE channel-URL validator this app
// has (lib/ytdlp/url.js; `store.sanitizeCapturedChannelMeta` and
// `args.requireValidUrl` are both built on it, and nothing here forks it) --
// re-validates a persisted `item.channelUrl` at the one boundary where it
// decides whether a USER FILE gets physically moved. See
// `relocateHydratedImportIntoChannelFolder`.
const { buildWatchUrl, isSafeVideoId, validateChannelUrl, extractMediaRef } = require('./lib/ytdlp/url');
// v1.15.1 hotfix: pure predicate for yt-dlp's own intermediate/partial-
// download artifacts (merge temps, per-format fragments, `.part`/`.ytdl`
// markers) left in its download dir mid-download or after a killed/failed
// download -- see lib/ytdlpIntermediates.js's module comment for why this
// is a standalone LEAF module rather than something scanDirRecursive (below)
// defines locally: lib/ytdlp/index.js's own best-effort post-failure cleanup
// needs the exact same predicate, and a leaf module lets both sides
// `require()` it directly without any circular dependency.
const { isYtdlpIntermediate } = require('./lib/ytdlpIntermediates');
const { TRASH_DIR_NAME, computeTrashTarget } = require('./lib/trashPaths');

// Wave 6 of the relational-migration arc: the scan pipeline's PURE helpers now
// live in lib/scan/ as small, directly-testable modules. They are re-exported
// from this file's module.exports unchanged (the SAME function objects), so
// every existing `require('../../server').<helper>` keeps working, and the
// call sites below are untouched - the names are identical.
//
// Two scan helpers deliberately did NOT move and still live below:
// `reconcileTranscode` (it reads TRANSCODE_DIR through `transcodedPath` and
// stats the cache, so it is not pure) and `needsTranscode`/
// `codecNeedsTranscode` (their non-native-container list is source-locked OUT
// OF THIS FILE'S TEXT by test/unit/tv-scan.test.js, which parses that array's
// declaration straight out of server.js to prove TV_EXTENSIONS never drifts
// from it - moving the constant silently breaks that lock; note that naming
// the declaration verbatim in a comment breaks it too, which is how this was
// found).
const scanRoots = require('./lib/scan/roots');
const scanMerge = require('./lib/scan/merge');
const scanIdentity = require('./lib/scan/identity');
const scanCaptured = require('./lib/scan/captured');
const scanProbe = require('./lib/scan/probe');
const { matchRootFolder, normalizeScanRoot, detectVanishedRoots } = scanRoots;
const { selectPrunableIds, mergeScannedMetadata } = scanMerge;
const { extractYtdlpVideoId, youtubeIdFromUrlString, deriveScanYoutubeId, deriveReleaseDate } = scanIdentity;
const { applyCapturedViewCount, applyCapturedFollowerCount, collectDownloadNotification } = scanCaptured;
const { applyHasSubtitlesDetection } = scanProbe;

// v1.77 glyph pool: the SAME registry the browser loads as a plain script
// (public/js/glyph-pool.js is dual-mode). Requiring it here rather than
// re-declaring the valid ids server-side is the whole point - a folder glyph
// the server accepts but the client cannot paint, or vice versa, is exactly
// the drift this shared module exists to make impossible. It is a pure leaf
// module (no side effects, no deps), like lib/trashPaths above.
const glyphPool = require('./public/js/glyph-pool');
// v1.37.0 books: the db.books namespace owner + the pure scanner core --
// see docs/exec-plans/completed/2026-07-12-v1.37.0-books.md. Both are leaf modules over
// deps this file already provides (loadDatabase/updateDatabase/getMediaId);
// requiring them has no side effects (the ytdlp direct-require posture).
const booksStore = require('./lib/books/store');
const queueStore = require('./lib/queue/store');
const booksScan = require('./lib/books/scan');
// v1.78 device handoff: the ephemeral presence store. Same pure-leaf posture
// as the queue reducers - it owns liveness semantics and nothing else.
const presenceStore = require('./lib/presence/store');
// v1.44 music library: same direct-require namespace-owner posture as books.
const musicStore = require('./lib/music/store');
const homeFeed = require('./lib/home/feed'); // v1.79: pure home-feed row assembler
const musicScan = require('./lib/music/scan');
const musicQuery = require('./lib/music/query');
// Wave 7b, slice S1a (the monolith split, docs/exec-plans/active/
// 2026-09-13-sqlite-relational-migration.md): four route groups now live in
// their own modules and register through `registerRoutes(app, deps)` - the
// lib/ytdlp + lib/podcasts pattern. Requiring them has no side effects (pure
// leaves over the deps this file hands in at each call site below).
const queueRoutes = require('./lib/queue/routes');
const notificationsRoutes = require('./lib/notifications/routes');
const pushRoutes = require('./lib/push/routes');
const userRoutes = require('./lib/user/routes');
// Wave 7b, slice S1b: the identity routes (/api/auth, /api/users, /api/me)
// and the pre-auth-era per-user media state routes (/api/liked,
// /api/progress), same pattern - each registers at the call site below that
// holds its original routing position.
const authRoutes = require('./lib/auth/routes');
const mediaUserRoutes = require('./lib/media/user-routes');
// Wave 7b, slice S2: the book library's whole HTTP surface (/api/books, /book,
// /bookcover) and the book scan's single pass; scanBooks, its overlap/coalescing
// guard, stays in this file (other callers and the exports still reach it here).
const booksRoutes = require('./lib/books/routes');
const booksScanRunner = require('./lib/books/scanRunner');
// Wave G: the pure projection of library audio (db.metadata type 'audio') into
// the Music library - eligibility + track shaping, no I/O.
const libraryAudio = require('./lib/music/libraryAudio');
// v1.195 TV Shows (UI "Shows"): feature-owned db.tv namespace + pure scan/parse.
const tvStore = require('./lib/tv/store');
const tvScan = require('./lib/tv/scan');
const tvParse = require('./lib/tv/parse');
// v1.38.0 TTS "Listen from Here": pure leaf helpers (env-config parse, engine
// argv builders, chapter chunker). Same direct-require posture as the store.
const booksTtsConfig = require('./lib/books/tts-config');
const booksTtsEngine = require('./lib/books/tts-engine');
const booksTtsChunk = require('./lib/books/tts-chunk');
const booksZip = require('./lib/books/zip'); // chapter XHTML extraction for TTS
// C4 "fun stats" page (v1.24 UX Round, Wave 3): pure aggregation helpers over
// `db.metadata`, unit-tested on their own against a synthetic fixture. See
// lib/stats.js's header comment and `GET /api/stats` (now in
// lib/media/routes.js) for the full live-compute rationale.
const stats = require('./lib/stats');
// v1.42: FileTube requires Node >= 22.13 (the first line where node:sqlite
// is available unflagged; engines bumped from >=20 — a BREAKING change,
// disclosed in the release notes). Checked explicitly BEFORE the adapter
// require so an old Node fails with THIS message instead of a cryptic
// module-not-found deep in a require chain. The Docker image (node:22-alpine)
// already satisfies it.
function nodeVersionSupported(version) {
  const [major, minor] = String(version).split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 13);
}
if (!nodeVersionSupported(process.versions.node)) {
  console.error(`FATAL: FileTube v1.42+ requires Node >= 22.13 (found ${process.versions.node}). The SQLite persistence layer is built on the node:sqlite builtin. Upgrade Node (the official Docker image already ships Node 22).`);
  process.exit(1);
}
// v1.42: the SQLite persistence adapter — the ONLY module that touches
// node:sqlite (source-locked). server.js owns the seam (loadDatabase/
// saveDatabase/updateDatabase/getCachedDatabase, all unchanged in contract);
// the adapter owns storage. See lib/db/sqlite.js's header.
const sqliteDb = require('./lib/db/sqlite');
// v1.41.0: app version + repo URL, surfaced on the Stats "About" section
// (FileTube version links to its own release tag). The only place the client
// learns the version; nothing else reads package.json server-side.
const APP_VERSION = require('./package.json').version;
const REPO_URL = 'https://github.com/dtammam/filetube';
// A6 subtitles (v1.24 UX Round, Wave 5): pure srtToVtt + findSubtitleSidecar,
// shared by the scan's additive `hasSubtitles` detection below and
// `GET /api/subtitles/:id` -- see lib/subtitles.js's header comment.
const subtitles = require('./lib/subtitles');
// Transcript export (Dean): the sidecar as readable plain text, served by
// `GET /api/transcript/:id` (now in lib/media/routes.js) -- same sidecar
// resolver as the subtitles route, so "has captions" and "has a transcript"
// can never disagree.
const transcript = require('./lib/transcript');
// v1.30 A5 (T6): pure sort comparators + format/search predicates +
// pagination-parameter normalizers shared with the client's own
// sortItems/filterByMediaType -- see lib/videoQuery.js's header comment and
// `GET /api/videos` (now in lib/media/routes.js) for the paginated,
// server-authoritative pipeline.
const videoQuery = require('./lib/videoQuery');
const searchRegistry = require('./lib/search/registry'); // v1.205 Wave B: universal-search provider registry
const rokuCompatLib = require('./lib/rokuCompat'); // v1.46: pure verdict/args logic

const app = express();
const PORT = process.env.PORT || 3000;

// Dynamic data directory for Docker volume persistence
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : (fs.existsSync('/app/data') ? '/app/data' : __dirname);
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');
// v1.37.0 books: covers live in a BOOKS-OWNED dir -- never THUMBNAIL_DIR,
// so the media scan's thumbnail unlink loop can never touch a book cover
// and the book scanner's cover pruning can never touch a video thumbnail.
const BOOKCOVER_DIR = path.join(DATA_DIR, '.bookcovers');
// v1.44 music: album art lives in a MUSIC-OWNED dir (same isolation rule as
// .bookcovers) -- keyed by album (md5 of the album grouping key), NOT by track
// id, so all tracks of an album share one art file. The music scan's prune is
// the ONLY writer that unlinks here, and only when an album's LAST track is
// pruned; no cross-module unlink can ever touch it.
const ALBUMART_DIR = path.join(DATA_DIR, '.albumart');
// v1.195 TV Shows: per-episode thumbnail cache (<episodeId>.jpg), an ffmpeg frame
// grab like the video library's storyboard - one file per episode. The tv scan's
// prune is the only writer that unlinks here.
const TV_THUMB_DIR = path.join(DATA_DIR, '.tvthumbs');
// (v1.198: the v1.196 admin-set custom-poster store + upload routes were REMOVED
// per Dean - posters come from the folder image / generated frame only.)
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

// v1.46 Roku compatibility renditions: ON-REQUEST, CACHE-ONLY copies served
// exclusively to `?compat=roku` requests (the Roku channel). Never mutates a
// library file; deleting this directory loses nothing but rebuild time.
// Deliberately SEPARATE from TRANSCODE_DIR: renditions are keyed by source
// size+mtime (sidecar JSON), a stronger invalidation contract than the
// id-only transcode cache, and their lifecycle must never entangle with the
// scan-reconciled transcodeStatus machinery.
function resolveRokuCompatDir(env, dataDir) {
  const raw = env && env.ROKU_COMPAT_DIR;
  return raw ? path.resolve(raw) : path.join(dataDir, 'roku-compat');
}
const ROKU_COMPAT_DIR = resolveRokuCompatDir(process.env, DATA_DIR);

// Create directories if they don't exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ---- v1.42: SQLite persistence (lib/db/sqlite.js) ---------------------------
// The database lives in DATA_DIR/filetube.db from this release on. Boot order
// (exec plan v1.42-multiuser-tranche.md, "Migration (boot order)"):
// filetube.db exists → use it; else a fresh empty schema. Wave 7 of the
// relational-migration arc (v1.296) removed the one-time import of the
// pre-v1.42 JSON file: a pre-v1.42 instance upgrades by running any
// v1.42-v1.295 build once first (docs/CONFIGURATION.md); the legacy file,
// if one is still beside the database, is never named, probed or read.
const { adapter: dbAdapter } = sqliteDb.openAdapter(DATA_DIR, {
  log: (line) => console.log(line),
});

// ---- v1.43: auth (users + sessions) ----------------------------------------
// The gate itself is installed as ONE app.use below (after the body-parser
// error handler, before the shell catch-all — see the auth-gate block).
// Everything cryptographic lives in lib/auth/crypto.js; accounts in
// lib/auth/store.js; the middleware/allowlist/limiter in lib/auth/gate.js.
const authCrypto = require('./lib/auth/crypto');
const createUserStore = require('./lib/auth/store');
const authGateLib = require('./lib/auth/gate');
const visibility = require('./lib/auth/visibility'); // v1.80 RBAC: the ONE visibility decision
const userStore = createUserStore(dbAdapter);
// Wave 1 of the relational-migration arc (v1.291): the per-item view counter
// left the document model for its own table (lib/media/viewCounts.js). Every
// runtime read/write of a view count goes through this store - never
// `db.viewCounts`, which the save-lock now refuses.
const createViewCountStore = require('./lib/media/viewCounts');
const viewCountStore = createViewCountStore(dbAdapter);
// Wave 2 (v1.292): the frozen pre-auth watch positions (adopted once by the
// first admin) and the deferred-delete tombstones are relational too. Their
// writes that must be atomic with a doc commit (the delete's tombstone mint,
// the move/trash/restore retirements, the scan's consumption) run INSIDE the
// save transaction via inSaveTransaction (below updateDatabase).
const createProgressStore = require('./lib/media/progress');
const createDeleteTombstoneStore = require('./lib/media/deleteTombstones');
const progressStore = createProgressStore(dbAdapter);
const tombstoneStore = createDeleteTombstoneStore(dbAdapter);
const { pruneDeleteTombstones, DELETE_TOMBSTONE_CAP, DELETE_TOMBSTONE_MAX_AGE_MS } = createDeleteTombstoneStore;
// Wave 3 (v1.293): the trashed-item records (the only way back for a trashed
// file) are relational too - minted/retired inside the doc commit's
// transaction like the tombstones; the retention sweep queries trashed_at.
const createTrashRecordStore = require('./lib/media/trashRecords');
const trashStore = createTrashRecordStore(dbAdapter);
// Fail-closed at boot: a short/placeholder secret throws here (before listen).
const SESSION_SECRET = authGateLib.resolveSessionSecret(DATA_DIR, process.env, (line) => console.log(line));
const AUTH_COOKIE_NAME = authGateLib.cookieNameFor(DATA_DIR);
const TRUST_PROXY = process.env.FILETUBE_TRUST_PROXY === '1';
const loginRateLimiter = authGateLib.createRateLimiter();
// The Shortcut API token (intake #1): when set, POST /api/ytdlp/download
// accepts it via header as an alternative to a session cookie. Unset =
// mechanism off (that endpoint is cookie-gated like everything else).
const API_TOKEN = (typeof process.env.FILETUBE_API_TOKEN === 'string' && process.env.FILETUBE_API_TOKEN.length > 0)
  ? process.env.FILETUBE_API_TOKEN : null;
if (TRUST_PROXY) {
  console.log('[auth] FILETUBE_TRUST_PROXY=1 — X-Forwarded-Proto is trusted; the session cookie gets Secure on https requests (required for a TLS-terminating reverse proxy).');
}
if (API_TOKEN) {
  console.log('[auth] FILETUBE_API_TOKEN is set — the one-off download endpoint (POST /api/ytdlp/download) accepts it via the X-FileTube-Token header for the iOS Shortcut.');
}

// ---- v1.66 web push ---------------------------------------------------------
// VAPID identity resolves at boot beside the session secret (same fail-closed
// posture, same DATA_DIR-file home, same never-rides-bundles rule). The
// delivery instance closes over LAZY readers (getCachedDatabase /
// notificationsFeatureEnabled are hoisted declarations called per round, not
// here) and is triggered DETACHED from the scan flush - never awaited there.
const pushKeysLib = require('./lib/push/keys');
const pushDeliverLib = require('./lib/push/deliver');
const pushShortlink = require('./lib/ytdlp/shortlink');
const PUSH_VAPID = pushKeysLib.resolveVapidKeys(DATA_DIR, process.env, (line) => console.log(line));
// Test seams: integration suites swap the transport (capture/starve sends
// without a network) and the guard's DNS lookup (fixture endpoints do not
// resolve publicly). Production always uses the default HTTPS transport and
// the real resolver.
let pushTransportOverride = null;
let pushGuardLookupOverride = null;
function __setPushTransportForTests(fn) { pushTransportOverride = typeof fn === 'function' ? fn : null; }
function __setPushGuardLookupForTests(fn) { pushGuardLookupOverride = typeof fn === 'function' ? fn : null; }
// v1.73: the push payload's meta, kind-dispatched - the row rides in WHOLE
// (kind CARRIED). Podcast rows resolve against the episodes map and skip
// when the episode is pruned OR trashed (a push must never deep-link a
// non-playable episode); media rows keep the pre-v1.73 shape. Named +
// exported so the trashed-skip and both arms are BINDABLE (adversarial
// gate W1: the inline version survived its mutants).
function resolvePushMeta(db, row) {
  const mediaId = row && typeof row === 'object' ? row.mediaId : row; // tolerate the pre-v1.73 call shape
  const kind = row && typeof row === 'object' && row.kind === 'podcast' ? 'podcast' : 'media';
  if (kind === 'podcast') {
    const ep = podcastsDb.parts.episodes.get(mediaId) || null; // Wave 5 (gate pass B): a point query, never the whole table per push row
    if (!ep || ep.status !== 'downloaded') return null; // pruned/trashed between insert and delivery - skip
    const sub = podcastsDb.readPart('subscriptions').find((x) => x && x.id === ep.subId);
    return { title: ep.title, channel: sub ? sub.name : 'Podcast', kind: 'podcast' };
  }
  const item = db.metadata && db.metadata[mediaId];
  if (!item) return null;
  // v1.246 (Dean): carry the media TYPE (+ chaptered) so payloadForRow deep-links an AUDIO
  // download's notification into the music skin (pushMusicUrl -> /music?play=), a video into
  // the watch page - the server mirror of musicHrefForItem's client routing.
  const chaptered = (Array.isArray(item.chapters) && item.chapters.length >= 2) || (Number(item.chapterCount) >= 2);
  return { title: item.title || item.name, channel: item.folderName, kind: 'media', type: item.type, chaptered };
}

const pushDelivery = pushDeliverLib.createPushDelivery({
  store: userStore,
  vapidKeys: PUSH_VAPID,
  guardHop: (url) => pushShortlink.guardHop(url, { lookup: pushGuardLookupOverride || undefined }),
  enabled: () => notificationsFeatureEnabled(getCachedDatabase()),
  resolveMeta: (row) => resolvePushMeta(getCachedDatabase(), row),
  transport: (opts) => (pushTransportOverride || pushDeliverLib.defaultTransport)(opts),
});

// ---- v1.42: the beta safe-mode lever (exec plan AC8, owner-approved) --------
// FILETUBE_READ_ONLY_MEDIA=1 turns the parallel-run operational rules ("no
// deletes, no moves, no downloads from the beta") from remembered into
// enforced: every operation that mutates SHARED state (media dirs, yt-dlp
// sidecar files) refuses with an honest 403, the scan's tombstone-retry
// unlink is disarmed (an imported prod tombstone must never reap a live
// shared file — design review F1), and the boot one-off migrator is skipped.
// Per-DATA_DIR instance state (caches, thumbnails, settings, likes,
// progress, backup/restore, the custom logo) stays fully live.
const READ_ONLY_MEDIA = process.env.FILETUBE_READ_ONLY_MEDIA === '1';
if (READ_ONLY_MEDIA) {
  console.log('[safe-mode] FILETUBE_READ_ONLY_MEDIA=1 — this instance will not delete, move, download, reheat, or skip-list any media. Reads, playback, likes, progress, and settings work normally.');
}
function refuseIfReadOnlyMedia(res) {
  if (!READ_ONLY_MEDIA) return false;
  res.status(403).json({
    error: 'read-only media mode: this instance runs with FILETUBE_READ_ONLY_MEDIA=1 (parallel-run beta protection) — media deletes and moves are disabled here. Run them from the primary instance instead.',
    readOnlyMedia: true,
  });
  return true;
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
if (!fs.existsSync(ROKU_COMPAT_DIR)) {
  fs.mkdirSync(ROKU_COMPAT_DIR, { recursive: true });
}
try {
  fs.accessSync(ROKU_COMPAT_DIR, fs.constants.W_OK);
} catch (e) {
  console.error(`Roku-compat cache directory is not writable: ${ROKU_COMPAT_DIR} (${e.message}). Roku compatibility renditions will fail until this is fixed.`);
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
  // v1.65: trash retention (days a trashed item survives before auto-purge).
  // 0 = keep forever (the cacheMaxAgeDays "Off" sentinel).
  trashRetentionDays: 30,
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
  // v1.121 (Dean, EXPERIMENTAL): background-audio position PRE-SYNC -- the
  // client-side lock-blip tuning. When ON, the (paused, pre-armed) hidden
  // background-audio sidecar's position periodically tracks the playing video,
  // so its buffer window follows the watcher and the lock-time handoff seek
  // lands already-buffered (costs periodic range-requests while a mobile video
  // plays). Client-only lever (player.js reads it off GET /api/settings);
  // pairs with backgroundAudioForVideo + preExtractAudio above.
  bgAudioSyncPosition: false,
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
  relocateHydratedImports: true,
  // v1.51 (Dean): the notification bell's instance-wide kill switch. ON by
  // default. When OFF the bell endpoints answer 404 (so no client ever
  // injects the bell), but the feed still ACCUMULATES server-side --
  // flipping it back on must not leave a gap in history (exec-plan
  // decision 8). NOTE: `notificationsSeededAt` (the one-shot seeding stamp)
  // also lives in db.settings but is deliberately NOT here or in KNOWN_KEYS
  // -- it is internal bookkeeping, never a user-settable value.
  notificationsEnabled: true,
  // v1.201 (Dean): the "Share with AI" prompts - named preambles sent in
  // front of a transcript through the share sheet. Instance-wide (admin
  // edits, everyone reads), several allowed (a summary prompt, an analysis
  // prompt...). An EMPTY list hides the AI action. Validated by
  // validateTranscriptAiPrompts below; ids are server-assigned.
  transcriptAiPrompts: [
    { id: 'summarize', name: 'Summarize', text: "I'm sharing a video transcript below. Summarize the narrative and key points, then note anything notable or questionable." }
  ],
  // v1.202 (Dean): manual channel attribution is now OPT-IN. It earned its
  // keep once - mass re-attributing a backlog of mis-attributed older
  // downloads - and a clean-from-the-start library never needs it. OFF hides
  // the watch-page Attribute button and the folder-view bulk tool, and the
  // attribution routes answer 404 (after the admin check). Settings ->
  // Experimental.
  attributeControlEnabled: false
};

// Wave 4 of the relational-migration arc: the app settings live in
// app_settings (one row per key) behind lib/config/settings.js. The store
// merges DEFAULT_SETTINGS (this file's policy) on every get(), which is what
// `withDefaultSettings(db.settings)` did at load time. Reads are
// `settingsStore.get()` / `getKey(k)`; writes inside a mutator ride
// `inSaveTransaction` so a failed doc save rolls the setting back too.
const createSettingsStore = require('./lib/config/settings');
const settingsStore = createSettingsStore(dbAdapter, { defaults: DEFAULT_SETTINGS });
// Wave 4 (second group): the folder config - the root list (library_folders,
// operator order), the per-root settings map (library_folder_settings) and
// the per-channel-folder display names (channel_folder_display_names). The
// config POST replaces the first two inside the doc commit's transaction;
// the channel heal writes a display name the same way.
const createFolderStore = require('./lib/config/folders');
const createFolderSettingsStore = require('./lib/config/folderSettings');
const createFolderDisplayNameStore = require('./lib/config/folderDisplayNames');
const folderStore = createFolderStore(dbAdapter);
const folderSettingsStore = createFolderSettingsStore(dbAdapter);
const folderDisplayNameStore = createFolderDisplayNameStore(dbAdapter);
// Wave 4 (third group): the FROZEN pre-auth likes (media_liked) - read once by
// the first admin's adoption, otherwise only carried by the rename / trash /
// restore / purge mutators (in-transaction re-keys), like the Wave 2 carriers.
const createLikedStore = require('./lib/media/liked');
const likedStore = createLikedStore(dbAdapter);
// Wave 5: the content modules' namespaces as feature stores - read() is the
// readX(db) snapshot, mutate() runs the module's own normaliser + reducers on
// a fresh holder and writes the DIFF inside the doc commit (the hook is
// hoisted; every mutate() runs inside an updateDatabase tick).
const tvDb = tvStore.createTvStore(dbAdapter, { inSaveTransaction });
const musicDb = musicStore.createMusicStore(dbAdapter, { inSaveTransaction });
const booksDb = booksStore.createBooksStore(dbAdapter, { inSaveTransaction });
const podcastsDb = podcastStore.createPodcastsStore(dbAdapter, { inSaveTransaction });
const ytdlpDb = ytdlpStore.createYtdlpStore(dbAdapter, { inSaveTransaction });

// Module-level `loadDatabase` call counter (v1.30 A3, AC3.3 instrumentation):
// every `loadDatabase()` call anywhere in this file increments it, including
// the one-time populate inside `getCachedDatabase()` (below the DB layer) and
// the fresh-read-inside-the-lock in `updateDatabase`. See
// `__getLoadDatabaseCallCount()` (test accessor, mirrors `currentScanTimer`'s
// own test-observability style, exported near the bottom of this file) for
// how tests read it back out.
let loadDatabaseCallCount = 0;

// Load the database: assemble from SQLite rows (v1.42; the adapter preserves
// the exact object shape the pre-v1.42 JSON file produced) and re-apply the SAME backfills
// this function has always applied to a partial/legacy source (review F3:
// import stores namespaces raw; backfill stays load-time-owned — so a DB
// imported from a legacy-shape file behaves identically to loading that
// file directly, and future DEFAULT_SETTINGS keys keep appearing without
// a re-import). A fresh/empty DB assembles to {} and the backfills below
// produce exactly the old initial-create defaults — no eager write needed;
// the first real saveDatabase persists them.
function loadDatabase() {
  loadDatabaseCallCount++;
  const db = dbAdapter.load();
  // Backfill EVERY top-level key (not just folderSettings/settings) so a
  // partial/legacy source (an imported legacy file, or an empty-namespace
  // normalization — see lib/db/sqlite.js's load() comment) can never make a
  // mutator throw a TypeError against a missing `folders`/`progress`/
  // `metadata`.
  // (pre-v1.294: `folders`, `folderSettings` and `folderDisplayNames` were
  // backfilled here. Wave 4 moved them to library_folders /
  // library_folder_settings / channel_folder_display_names behind
  // folderStore / folderSettingsStore / folderDisplayNameStore - no longer
  // keys of this object.)
  // (v1.42-v1.291: `progress` was backfilled here. Wave 2 moved it to
  // media_progress / progressStore - no longer a key of this object.)
  if (!db.metadata || typeof db.metadata !== 'object') db.metadata = {};
  // (v1.30-v1.293: `liked` was backfilled here. Wave 4 moved it to media_liked
  // / likedStore - no longer a key of this object.)
  // (v1.41.3-v1.291: `deleteTombstones` was backfilled here. Wave 2 moved it
  // to media_delete_tombstones / tombstoneStore - no longer a key of this object.)
  // (v1.42-v1.290: `viewCounts` was backfilled here. Wave 1 of the relational
  // arc moved it to media_view_counts / viewCountStore - it is no longer a key
  // of this object, and the save-lock refuses it if one appears.)
  // (v1.65-v1.292: `trash` was backfilled here. Wave 3 moved it to
  // media_trash / trashStore - no longer a key of this object.)
  // (v1.42-v1.294: when a container namespace EXISTED, its per-key sub-
  // namespaces were backfilled here, because an empty doc_kv namespace has
  // zero rows and assembles as absent. Wave 5 moved every container to its
  // feature-store tables - nothing is backfilled on this object any more.)
  // (v1.42-v1.293: the books sub-keys were backfilled here. Wave 5 moved the
  // books namespace to its tables behind booksDb - no longer a key of this object.)
  // (v1.42-v1.294: the ytdlp sub-keys were backfilled here. Wave 5 moved the
  // ytdlp namespace to its tables behind ytdlpDb - no longer a key of this object.)
  // Wave G: when the music container exists, backfill `channels` (the per-folder
  // "show in Music" marks) the same way books.progress/ytdlp.downloadMeta are
  // backfilled - so the eligibility predicate and the write route never touch an
  // undefined. music.tracks/folders/settings stay musicStore-owned (lazy ensure).
  // (Wave G-v1.293: `music.channels` was backfilled here. Wave 5 moved the music
  // namespace to its tables behind musicDb - no longer a key of this object.)
  // (pre-v1.294: `settings` was backfilled here with DEFAULT_SETTINGS. Wave 4
  // moved it to app_settings / settingsStore - no longer a key of this object.)
  return db;
}

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

// Atomic on-disk save (v1.42): ONE SQLite transaction via the adapter's
// diff-save — per-row serialized JSON compared against the last commit's
// snapshot, so only changed/inserted/deleted rows are written. A crash
// leaves either the OLD committed state fully intact (crash before COMMIT)
// or the NEW one (crash after) — SQLite's journal guarantees no torn state,
// the same either/or contract the old write-temp+fsync+rename provided for
// the pre-v1.42 JSON file.
//
// Durability note: guards against PROCESS crashes (this app's threat model
// per RELIABILITY.md); power-loss durability follows SQLite's WAL semantics
// (synchronous=NORMAL default) — a power cut can revert the very last
// commit(s) on some filesystems but can never produce a torn/half-written
// database.
//
// On a failed transaction the adapter ROLLS BACK (on-disk state untouched,
// diff snapshot unchanged) and the error is RETHROWN so the caller
// (updateDatabase) REJECTS instead of silently resolving a false success.
// Stays SYNCHRONOUS on purpose: the mutate-then-save critical section
// inside updateDatabase (below) must complete in a single tick.
//
// v1.30 A3 (in-memory DB read cache): on a SUCCESSFUL save, `db` (the
// just-written object) BECOMES the read cache -- set here, immediately after
// the commit, with no `await` in between (this whole function is
// synchronous). `saveDatabase` is the SOLE writer of `dbCache`; every real
// caller today reaches it exclusively through `updateDatabase`'s
// fresh-read-inside-the-lock (see that function's own comment), so this is
// still "one write's critical section, one cache-set". See the coherency
// argument above `dbCache`'s own declaration for why this can never produce
// a torn/stale read. On a FAILED save (the catch branch below, which
// rethrows) the cache is deliberately left untouched -- an unpersisted `db`
// must never become the cache.
// Test-only one-shot save-failure injector (v1.42). Pre-SQLite, tests forced
// a persist failure by stubbing fs.writeFileSync/fs.renameSync — the seam the
// adapter closed. This is the sanctioned replacement (same posture as the
// __get*CallCount observability accessors): arm it, and the NEXT saveDatabase
// call throws before touching the adapter, exercising the exact
// route-returns-500 / prior-state-intact / chain-not-wedged contracts the
// old stubs exercised. Self-disarms after one shot; inert in production.
let failNextSaveError = null;
function __failNextSaveForTests(err) {
  failNextSaveError = err instanceof Error ? err : new Error('simulated save failure (test injection)');
}

// Wave 2: `effects` - the mutator's inSaveTransaction queue, run inside the
// adapter's save transaction (see updateDatabase). Direct callers (test
// seeding) pass nothing.
function saveDatabase(db, effects = []) {
  saveDatabaseCallCount++;
  try {
    if (failNextSaveError) {
      const injected = failNextSaveError;
      failNextSaveError = null;
      throw injected;
    }
    // v1.42: one SQLite transaction replaces write-temp+fsync+rename — the
    // adapter diffs per-row serialized JSON against its last-commit snapshot
    // and writes only changed/inserted/deleted rows (a one-item mutation is
    // one row, not a 175 KB whole-file rewrite). Crash safety comes from the
    // transaction (the pre-v1.42 orphan-tmp sweep is gone since Wave 7). Stays
    // SYNCHRONOUS: the mutate-then-save critical section inside
    // updateDatabase must complete in a single tick, exactly as before.
    dbAdapter.save(db, effects.length > 0 ? { alsoInTransaction: () => { for (const fn of effects) fn(); } } : {});
    dbCache = db;
    dbCacheValid = true;
  } catch (err) {
    console.error('Error saving database:', err);
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
// Every database writer routes through this single in-process async-mutex
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
// Wave 2: relational writes that must be ATOMIC with the doc commit. A
// mutator calls `inSaveTransaction(fn)`; the queued fns run inside the
// adapter's save transaction (after the doc rows, before COMMIT), so a
// throw rolls both back and a crash leaves both or neither - the v1.41.3
// tombstone contract ("mint in the SAME mutator that removes the entry")
// keeps its atomicity now that the tombstone is a row in another table.
// Valid ONLY inside a mutator tick; a mutator that queues effects and then
// returns `false` (no save) is a programming error and throws loudly rather
// than silently dropping the effects.
let saveEffects = null;
function inSaveTransaction(fn) {
  if (!saveEffects) throw new Error('inSaveTransaction: only valid inside an updateDatabase mutator');
  saveEffects.push(fn);
}
function updateDatabase(mutatorFn) {
  const run = dbWriteChain.then(() => {
    const db = loadDatabase();             // fresh read INSIDE the lock
    saveEffects = [];
    let result;
    let effects;
    try {
      result = mutatorFn(db);              // synchronous mutate
    } finally {
      effects = saveEffects;
      saveEffects = null;
    }
    // A skipped save (result === false, e.g. a no-op/guard branch) leaves
    // the existing cache untouched: `saveDatabase` (and its cache-set, see
    // its own comment above) is simply never called on this branch.
    if (result !== false) saveDatabase(db, effects); // atomic write-temp-then-rename + cache-set
    else if (effects.length > 0) throw new Error('updateDatabase: a mutator queued inSaveTransaction effects but returned false (no save) - effects would be lost');
    return result;
  });
  dbWriteChain = run.catch(() => {}); // keep the chain alive past a failure
  return run;
}

// ---- In-memory DB read cache (v1.30 A3, AC3.3) ----------------------------
// A read-through cache in front of `updateDatabase`'s mutex, so hot GET
// readers stop paying a `readFileSync` + `JSON.parse` of the whole legacy file
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
//   3. This process is the ONLY writer of the database (single-node,
//      single-process -- see ARCHITECTURE.md), so nothing outside this
//      process can make the cache silently drift from disk between writes.
//      (Test suites that seed the database directly should go through the
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
  // v1.42 dev/test aliasing guard (exec plan known-risk #2): the diff-save
  // trusts that NOTHING mutates the last-committed object — a reader that
  // mutated the cache would change state the diff can never see (it compares
  // the NEXT fresh load against the snapshot, both derived from disk, so the
  // mutation silently haunts only in-memory reads). Under the test runner
  // (NODE_TEST_CONTEXT) or an explicit opt-in, hand readers a throwing Proxy
  // instead of the raw object so any cache mutation fails LOUDLY at the
  // mutation site. A throwing Proxy, deliberately NOT Object.freeze:
  // server.js is not strict mode, so writes to a frozen object are silent
  // no-ops — masking the exact bug this guard exists to catch (design
  // review F7).
  return DB_CACHE_GUARD ? guardAgainstMutation(dbCache) : dbCache;
}

// See getCachedDatabase directly above. Wrap-on-read with a WeakMap proxy
// cache so object identity stays stable across property accesses; only
// mutation traps throw — reads, enumeration, and JSON serialization pass
// through untouched.
const DB_CACHE_GUARD = Boolean(process.env.NODE_TEST_CONTEXT || process.env.FILETUBE_DB_CACHE_GUARD);
const mutationGuardProxies = new WeakMap();
function guardAgainstMutation(value) {
  if (value === null || typeof value !== 'object') return value;
  let proxy = mutationGuardProxies.get(value);
  if (!proxy) {
    proxy = new Proxy(value, {
      get(target, prop, receiver) {
        return guardAgainstMutation(Reflect.get(target, prop, receiver));
      },
      set(target, prop) {
        throw new Error(`Read-cache mutation: attempted to set '${String(prop)}' on an object served by getCachedDatabase(). Mutate through updateDatabase()'s fresh load instead — the diff-save cannot see cache mutations (v1.42).`);
      },
      deleteProperty(target, prop) {
        throw new Error(`Read-cache mutation: attempted to delete '${String(prop)}' on an object served by getCachedDatabase(). Mutate through updateDatabase()'s fresh load instead (v1.42).`);
      },
      defineProperty(target, prop) {
        throw new Error(`Read-cache mutation: attempted to define '${String(prop)}' on an object served by getCachedDatabase(). Mutate through updateDatabase()'s fresh load instead (v1.42).`);
      },
    });
    mutationGuardProxies.set(value, proxy);
  }
  return proxy;
}

// v1.42: wipe-and-replace the persisted state coherently — the ONE primitive
// behind both the instance-restore endpoint and the tests' between-case
// reset (which used to be an rm of the JSON file). Everything the design-delta
// review's F5 demands happens here, in one exclusive section:
//   1. the adapter wipes + repopulates inside ONE transaction and rebuilds
//      its diff snapshot from disk,
//   2. both progress coalescers are cleared AND their timers cancelled (a
//      pre-wipe ping whose id exists in the new state must never flush OVER
//      freshly-restored rows),
//   3. the read cache is invalidated so the next read reflects the new state
//      with zero intervening writes.
// Enqueued on the write chain so it can never interleave with a mutator's
// load-mutate-save tick.
// v1.42 (gate W4): monotonic counter of wipe-and-replace events. A scan
// captures it at Phase-1 time and its final merge refuses to commit across a
// bump — the walk's snapshot describes a database that no longer exists.
let persistedStateEpoch = 0;
function __getPersistedStateEpoch() {
  return persistedStateEpoch;
}

function replacePersistedState(populateFn) {
  const run = dbWriteChain.then(() => {
    dbAdapter.exclusiveReplace(populateFn || (() => {}));
    persistedStateEpoch++;
    pendingProgress.clear();
    if (progressFlushTimer) {
      clearTimeout(progressFlushTimer);
      progressFlushTimer = null;
    }
    pendingBookProgress.clear();
    if (bookProgressFlushTimer) {
      clearTimeout(bookProgressFlushTimer);
      bookProgressFlushTimer = null;
    }
    pendingMusicProgress.clear();
    if (musicProgressFlushTimer) {
      clearTimeout(musicProgressFlushTimer);
      musicProgressFlushTimer = null;
    }
    dbCache = null;
    dbCacheValid = false;
  });
  dbWriteChain = run.catch(() => {});
  return run;
}

// Test primitive (v1.42): the between-test reset. Pre-v1.42 lifecycle tests
// deleted the JSON file between cases and let loadDatabase re-create defaults;
// deleting an OPEN SQLite database out from under its connection is not a
// thing, so tests call this instead.
function __resetDatabaseForTests() {
  // v1.43: deliberately does NOT clear the `users` table itself. Pre-auth
  // suites mint ONE admin in before() (via the auth test helper) to
  // authenticate through the gate; that admin must survive each case's reset
  // so its session cookie stays valid all suite. Only the auth-flow suite,
  // which tests the zero-users funnel, wipes users — via __clearUsersForTests
  // below. Per-user STATE (progress/liked/pins), however, IS wiped — chunk 4b
  // moved it into the per-user tables, outside exclusiveReplace's wipe, and a case's
  // watch positions must not bleed into the next (the pre-4b reset semantics,
  // restored for the new home).
  return replacePersistedState(null).then(() => {
    try { userStore.__clearUserStateForTests(); } catch (_) { /* user tables absent in an odd harness */ }
  });
}
// Test-only: wipe users (the auth-flow suite's zero-users precondition).
function __clearUsersForTests() {
  try { userStore.__clearAllUsersForTests(); } catch (_) { /* users table absent in an odd harness */ }
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
// same or different ids) inside one window collapse into ONE durable write
// (AC4.1). Nothing else ever routes through this Map --
// `DELETE /api/videos/:id`, `POST /api/config`, `POST /api/settings`, and
// the scan's final merge all still call `updateDatabase` directly, exactly
// once per invocation (AC4.2); see each of their own call sites, unchanged
// by this section.
//
// v1.43 (per-user scoping): watch positions belong to a USER now, so the
// staging key is `<userId>:<mediaId>` (userId is an integer, mediaId is hex
// -- ':' can't collide) and each entry carries `{userId, mediaId, value}`.
// The flush upserts the batch into the relational `user_progress` table via
// `userStore.setProgressBatch` (ONE SQLite transaction per window -- the
// AC4.1 contract survives the move) instead of mutating the frozen pre-auth
// `progress` record (a doc namespace until Wave 2 of the relational arc; the
// `media_progress` table since), which is retained untouched as the frozen
// pre-auth record the exec plan's adoption section describes. The cutover
// is total: no reader falls back to `db.progress` (a read-through fallback
// after adoption is the divergence bug farm design finding #6 warned
// about).
const pendingProgress = new Map();
function pendingProgressKey(userId, mediaId) {
  return `${userId}:${mediaId}`;
}

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
// durable write -- covers the full window in a single SQLite transaction no
// matter how many users/ids/pings it holds. The `db.metadata[mediaId]`
// guard drops an id that was deleted (via `DELETE /api/videos/:id`) between
// its ping and this flush, so a flush can never resurrect state for a
// removed item. A no-op (nothing pending -- e.g. the shutdown handler
// firing with an empty batch) skips the write chain entirely. Shared by the
// debounce timer (`armProgressFlushTimerIfNeeded`, below) AND the shutdown
// handlers (registered under `require.main === module`, near
// `app.listen`), and directly exported so tests can trigger a flush
// deterministically instead of waiting out `PROGRESS_FLUSH_MS`.
//
// v1.43: the batch upserts into `user_progress` (userStore.setProgressBatch,
// one transaction) instead of the frozen pre-auth progress record
// (`media_progress` since Wave 2 - never written by playback). It still rides
// `updateDatabase`'s write chain -- with a mutator that returns `false`
// (no doc-table save) -- for two load-bearing reasons: (1) the mutator's
// fresh in-lock `db` is what makes the deleted-between-ping-and-flush guard
// race-free, and (2) chain ordering preserves the v1.42 F5 restore
// contract (a flush enqueued before a wipe-and-replace lands before it or
// not at all -- `replacePersistedState` clears this Map inside its own
// chained step, exactly as before).
let progressFlushWriteCount = 0;
function __getProgressFlushWriteCount() {
  return progressFlushWriteCount;
}
function flushPendingProgress() {
  if (progressFlushTimer) {
    clearTimeout(progressFlushTimer);
    progressFlushTimer = null;
  }
  if (pendingProgress.size === 0) return Promise.resolve(false);
  const snapshot = [...pendingProgress.values()];
  pendingProgress.clear();
  return updateDatabase(db => {
    // OWN-property guard (v1.42 __proto__ lesson) -- same reasoning as the
    // POST route's staging check; the flush is the last gate before a row.
    const rows = snapshot.filter(entry => Object.prototype.hasOwnProperty.call(db.metadata, entry.mediaId));
    if (rows.length > 0) {
      userStore.setProgressBatch(rows);
      progressFlushWriteCount++;
    }
    return false; // per-user rows only -- never a doc-table write from a flush
  }).then(() => true).catch(err => {
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
// `pendingProgress` until the next flush commits it -- so every progress
// READER checks the overlay first, making a client's own just-saved
// position visible immediately. Falls through to the user's committed
// `user_progress` row (a warm prepared-statement point SELECT -- the
// design-delta SUGGESTION-6 no-full-reparse contract) when nothing is
// pending. NEVER consults the frozen pre-auth `db.progress` record: the
// adoption cutover is total (design finding #6 -- a read-through fallback
// is the divergence bug farm).
function effectiveProgress(userId, id) {
  const pending = pendingProgress.get(pendingProgressKey(userId, id));
  if (pending) return pending.value;
  return userStore.getOneProgress(userId, id) || undefined;
}

// v1.80 RBAC: the per-request visibility index for req.user. Built ONCE per
// request and cached on req (many routes filter the same list). An ADMIN gets
// an EMPTY index -> isBlocked always false -> sees everything, with no role
// branch scattered across routes.
function userRestrictionIndex(req) {
  if (!req || !req.user) return visibility.buildRestrictionIndex([]);
  if (req._ftRestrictionIndex) return req._ftRestrictionIndex;
  const rows = req.user.role === 'admin' ? [] : userStore.getRestrictions(req.user.id);
  const idx = visibility.buildRestrictionIndex(rows);
  req._ftRestrictionIndex = idx;
  return idx;
}

// v1.80 RBAC: per-kind visibility for req.user. ONE decision, reused by the list
// filters AND the serve routes so they can never diverge. A missing item is not
// visible (the caller 404s anyway). Descriptors mirror lib/auth/visibility.js.
function mediaVisibleTo(req, item) {
  return !!item && !visibility.isBlocked(userRestrictionIndex(req), {
    kind: 'media', filePath: item.filePath, folderName: item.folderName, rootFolder: item.rootFolder,
  });
}
// v1.127 Wave A (external review round 2, HIGH): a req-FREE snapshot of the
// mediaVisibleTo decision, for work that outlives its request - the
// bulk-attribution selector re-runs inside updateDatabase and its move loop
// runs AFTER the 202 response, where holding `req` would be a leak. Captures
// the requester's restriction index ONCE; the descriptor is the FULL canonical
// media descriptor and must stay byte-identical to mediaVisibleTo's above
// (the v1.126 lesson: never a hand-built narrower one - a bare
// {kind,folderName} check misses PATH-kind and allowlist restrictions).
function mediaVisiblePredicate(req) {
  const idx = userRestrictionIndex(req);
  return (item) => !!item && !visibility.isBlocked(idx, {
    kind: 'media', filePath: item.filePath, folderName: item.folderName, rootFolder: item.rootFolder,
  });
}
function trackVisibleTo(req, track) {
  return !!track && !visibility.isBlocked(userRestrictionIndex(req), {
    kind: 'track', filePath: track.filePath, folderName: track.folderName, rootFolder: track.rootFolder,
  });
}
// v1.80 RBAC: podcast episode/show visibility. Accepts an episode {subId,
// filePath} OR a bare {subId} (the show-art route). Passed into the podcasts
// module via deps (episodeVisibleTo) so that module routes THROUGH this one
// decision. `ep` falsy -> not visible (the caller 404s an unknown id anyway).
function podcastEpisodeVisibleTo(req, ep) {
  return !!ep && !visibility.isBlocked(userRestrictionIndex(req), { kind: 'podcast', subId: ep.subId, filePath: ep.filePath });
}
function bookVisibleTo(req, book) {
  return !!book && !visibility.isBlocked(userRestrictionIndex(req), { kind: 'book', filePath: book.filePath, folderName: book.folderName });
}
// v1.195 TV Shows RBAC: an episode's visibility routes through the SAME single
// decision point (kind:'tv'). Path/rootFolder restrictions bite generically; a
// whole-library 'tv' restriction (creatable in Settings since v1.196, when 'tv'
// joined VALID_LIBRARY_VALUES + the setup checkbox roster) bites via
// KIND_TO_LIBRARY. `ep` falsy -> not visible (the serve route 404s an unknown id
// before reaching here anyway).
function tvEpisodeVisibleTo(req, ep) {
  return !!ep && !visibility.isBlocked(userRestrictionIndex(req), { kind: 'tv', filePath: ep.filePath, rootFolder: ep.rootFolder });
}
// v1.128 Wave B: does the requester carry ANY restriction? Admins get an empty
// index (userRestrictionIndex returns buildRestrictionIndex([]) for role
// 'admin'), and an unrestricted member gets one too - for BOTH, every
// visibility list/config surface must stay BYTE-IDENTICAL to its pre-Wave-B
// output (an empty folder must not vanish from an unrestricted user's sidebar).
// So the metadata-filtering config surfaces gate on THIS: filter only when the
// requester actually has a restriction (allowlist mode, or any listed unit).
// Same emptiness test isBlocked would short-circuit on, made explicit so a
// caller can skip the whole filter pass.
function requesterHasRestrictions(req) {
  const idx = userRestrictionIndex(req);
  return idx.mode === 'allowlist'
    || idx.paths.length > 0
    || idx.folders.size > 0
    || idx.shows.size > 0
    || idx.libraries.size > 0;
}
// v1.128 Wave B (L2/L3): filter a configured-ROOTS list to the roots a
// restricted member can actually see (holds >=1 item that passes `visiblePred`).
// Admin + unrestricted member get the list back UNCHANGED (byte-identical),
// including empty roots - the visibility filter never prunes a folder from a
// user who has no restriction to enforce. `items` is the store's item/track
// list; each item is matched to its root by path prefix.
function visibleConfigRoots(req, roots, items, visiblePred) {
  const list = Array.isArray(roots) ? roots : [];
  if (!requesterHasRestrictions(req)) return list;
  const visibleRoots = new Set();
  for (const item of items) {
    if (!item || typeof item.filePath !== 'string') continue;
    if (!visiblePred(req, item)) continue;
    const root = matchRootFolder(item.filePath, list);
    if (root) visibleRoots.add(root);
  }
  return list.filter((r) => visibleRoots.has(r));
}
// v1.128 Wave B: return the db.metadata MAP filtered to items the requester
// may see - the SAME transform /api/stats builds inline (id -> item), extracted
// so the duplicates report and scan-status share it. Admin + unrestricted
// member get the SAME map object back (byte-identical downstream output).
function visibleMetadataFor(req, metadata) {
  const map = metadata || {};
  if (!requesterHasRestrictions(req)) return map;
  const out = {};
  for (const id of Object.keys(map)) if (mediaVisibleTo(req, map[id])) out[id] = map[id];
  return out;
}
// v1.123 T3 (security): the trash MUTATION routes (restore/purge) must share the
// trash LIST's visibility posture - a restricted member must not restore or
// PERMANENTLY purge a trashed item hidden from them. Builds the SAME media
// descriptor the GET /api/trash filter builds (from the snapshot, or the
// record's own path fields for a snapshot-less orphan). A missing record is
// "visible" so the route's own 404 path reports it neutrally (no oracle).
function trashRecordVisibleTo(req, rec) {
  return !rec || !visibility.isBlocked(userRestrictionIndex(req), {
    kind: 'media',
    filePath: (rec.item && rec.item.filePath) || rec.originalPath,
    folderName: rec.item && rec.item.folderName,
    rootFolder: rec.rootFolder || (rec.item && rec.item.rootFolder),
  });
}
// v1.80 RBAC (security-gate W1): a restricted member must not delete / move /
// mutate an item they cannot even SEE. Returns true (and 404s) when the id's
// media item is restricted for req.user. Admin's empty index never restricts.
function restrictedVideoMutation(req, res, id) {
  const db = getCachedDatabase();
  const it = db.metadata && Object.prototype.hasOwnProperty.call(db.metadata, id) ? db.metadata[id] : null;
  if (it && !mediaVisibleTo(req, it)) { res.status(404).json({ error: 'Media file not found' }); return true; }
  return false;
}

// v1.78 device handoff -------------------------------------------------------
//
// The process-wide presence map. It sits beside effectiveProgress on purpose:
// that function is what makes this feature CHEAP. Position is already near-live
// server-side (a ping every ~4s, coalesced), so presence never needs to carry
// or persist a position for playback - it carries only "who is playing what,
// where, and how recently". The destination surface resumes off effectiveProgress
// exactly as it does today, which is why AC5 adds no new position plumbing.
//
// Deliberately NOT persisted (Dean's ruling 5): a restart clears it and the
// feature degrades to plain history resume. No schema migration in this wave.
const presence = presenceStore.createPresenceStore();

// The ONE presence writer. Every progress handler funnels through it so the
// device fields are parsed, validated and capped in exactly one place - the
// v1.41.4 "seat that forgot to call the shared helper" scar, applied forward.
//
// CONTRACT (named attack surface #5): this is a pure SIDE EFFECT of a progress
// ping. It reads only from `body`, never writes to `res`, never throws for bad
// input (the store refuses silently), and its return value is ignored by every
// caller. A ping without device fields therefore behaves BYTE-IDENTICALLY to
// pre-v1.78 - which is what keeps old cached clients and Roku working.
//
// The user id comes from `req.user.id` - the auth gate's value - and NEVER from
// the body, so there is no path by which a client can write into another user's
// presence bucket (attack surface #3).
function recordPresenceFromPing(req, kind, mediaId, position, duration) {
  const body = req && req.body ? req.body : {};
  if (!body.deviceId) return; // no device identity -> no presence, silently
  presence.record(req.user.id, {
    deviceId: body.deviceId,
    deviceLabel: body.deviceLabel,
    mediaId,
    kind,
    position,
    duration,
    // 'paused' is the explicit stop beacon; anything else (including absent)
    // is a live play ping.
    state: body.presenceState === 'paused' ? 'paused' : 'playing',
    at: body.presenceAt,
  });
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
// transcodedPath moved to lib/media/transcode.js (Wave 7b slice S8).

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
// v1.46: the roku-compat rendition cache gets its OWN cap (same default,
// same parse rules) -- 'strip' remuxes are near-source-sized, so sharing the
// transcode cap would let Roku renditions starve browser-compat transcodes.
const ROKU_COMPAT_CACHE_MAX_BYTES = parseCacheCap(process.env.ROKU_COMPAT_CACHE_MAX_BYTES);

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

// isInFlightTranscode + selectEvictions moved to lib/media/transcode.js (Wave 7b slice S8).

// Delete orphaned *.tmp.mp4 / *.tmp.m4a files (left if a transcode or
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

// Transcodes served to a client recently (path -> last-served epoch ms).
// Eviction never deletes a file served within RECENT_STREAM_MS, so a file a user
// is actively watching can't be pulled out from under them. This is the real
// protection against the eviction-vs-stream race — it does NOT rely on atime,
// which is unreliable under Linux relatime/noatime.
const recentlyServed = new Map();
const RECENT_STREAM_MS = 10 * 60 * 1000; // 10 minutes
function markServed(p) { recentlyServed.set(p, Date.now()); }

// isCompletedTranscode + activeProtectedPaths + evictTranscodeCache moved to lib/media/transcode.js (Wave 7b slice S8).

// ---- Roku compatibility renditions (v1.46) ----
// On-request, cache-only fixes for the two file classes Roku's hardware
// rejects but browsers play fine: embedded cover-art image tracks ('strip',
// lossless remux) and rotation-flagged phone videos ('rotate', re-encode
// that bakes the pixels upright). Decision rules and ffmpeg argv live in
// lib/rokuCompat.js (pure, unit-tested); this block owns the impure parts:
// the lazy per-request probe, the sidecar cache (verdict + source
// size/mtime signature -- the invalidation the id-keyed transcode cache
// lacks), a single-worker build queue whose in-flight id IS deduped (unlike
// queueTranscode's pending-only check), and LRU cap eviction. Fail-open
// everywhere: any probe/stat/build problem serves the ORIGINAL file --
// a broken compat layer must never block playback that used to work.

function rokuCompatRenditionPath(id) {
  return path.join(ROKU_COMPAT_DIR, `${id}.mp4`);
}
function rokuCompatSidecarPath(id) {
  return path.join(ROKU_COMPAT_DIR, `${id}.json`);
}

// the roku-compat queue state + rokuCompatBlocked() moved to lib/media/transcode.js (Wave 7b slice S8).

// Sidecar reads treat any parse failure as "no verdict yet" -- which is also
// why writes are a plain writeFileSync (no tmp+rename): a torn write from a
// crash self-heals as a re-probe on the next request.
function readRokuCompatSidecar(id) {
  try { return JSON.parse(fs.readFileSync(rokuCompatSidecarPath(id), 'utf8')); }
  catch (_) { return null; }
}
function writeRokuCompatSidecar(id, meta) {
  try { fs.writeFileSync(rokuCompatSidecarPath(id), JSON.stringify(meta)); }
  catch (e) { console.error(`roku-compat: failed to persist sidecar for ${id}:`, e.message); }
}

function probeForRokuCompat(filePath) {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', buildFfprobeArgs(filePath), { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
}

// resolveRokuCompat + queueRokuCompatBuild + processRokuCompatQueue + evictRokuCompatCache moved to lib/media/transcode.js (Wave 7b slice S8).

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

// selectAgedOut + sweepAgedTranscodes moved to lib/media/transcode.js (Wave 7b slice S8).

// selectPrunableIds moved to lib/scan/merge.js (Wave 6 scan extraction).

// detectVanishedRoots moved to lib/scan/roots.js (Wave 6 scan extraction).

// mergeScannedMetadata moved to lib/scan/merge.js (Wave 6 scan extraction).

// transcodeCacheSize moved to lib/media/transcode.js (Wave 7b slice S8).

// effectiveCacheCap moved to lib/media/transcode.js (Wave 7b slice S8).

// matchRootFolder moved to lib/scan/roots.js (Wave 6 scan extraction).

// Generate deterministic ID from filepath
function getMediaId(filePath) {
  return crypto.createHash('md5').update(filePath).digest('hex');
}

// v1.94.1: order a scan's collected files NEWEST-first, so the per-file loop
// generates thumbnail/sprite/preview-clip sidecars for the most-recently-added
// videos (what the default home view shows) before the rest - a big backfill
// otherwise fills folders in walk order and leaves the home view empty at first.
// Recency = the item's persisted `addedAt` (the home sort key) if the db knows
// it, else a brand-new file's derived `addedAt`, else its mtime. Pure + stable
// (the sort key is precomputed once per file); ordering never changes the end
// state, only which files finish first. Returns [{ fp, fileInfo, recency }].
function orderScannedByRecency(scannedFiles, metadata) {
  const meta = metadata && typeof metadata === 'object' ? metadata : {};
  const arr = Array.from(scannedFiles.entries()).map(([fp, fileInfo]) => {
    const existing = meta[getMediaId(fp)];
    const recency = (existing && typeof existing.addedAt === 'number') ? existing.addedAt
      : (fileInfo && typeof fileInfo.addedAt === 'number') ? fileInfo.addedAt
        : (fileInfo && typeof fileInfo.mtimeMs === 'number') ? fileInfo.mtimeMs
          : 0;
    return { fp, fileInfo, recency };
  });
  arr.sort((a, b) => b.recency - a.recency); // newest first
  return arr;
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

// extractYtdlpVideoId moved to lib/scan/identity.js (Wave 6 scan extraction).

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
// item's id in the media_delete_tombstones table (Wave 2 of the relational
// arc: INSIDE the same save transaction that removes the metadata entry, via
// inSaveTransaction - the "same mutator" atomicity, kept across two
// tables). When a scan re-discovers a tombstoned id, it holds the file's TRUE
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
// Wave 2: the growth bound (DELETE_TOMBSTONE_CAP / _MAX_AGE_MS) and the pure
// in-place prune moved to lib/media/deleteTombstones.js with the table they
// govern; `tombstoneStore.prune()` applies them to the rows. The names are
// re-exported from there (see the store construction near userStore).

// deriveScanYoutubeId moved to lib/scan/identity.js (Wave 6 scan extraction).

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
  return booksDb.read().settings || {};
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
  const audio = booksDb.parts.audio.get(bookId); // Wave 5 (gate pass B): a point query
  const entry = audio && audio[String(spineIndex)];
  return (entry && entry.key) ? entry.key : ttsCacheKey(bookId, spineIndex);
}

// Look up a validated EPUB chapter for (bookId, spineIndex). Returns null for
// an unknown/non-epub book or an out-of-range chapter -- every caller (worker
// AND routes) funnels validation through this ONE place.
function resolveTtsChapter(bookId, spineIndex) {
  const book = booksDb.parts.items.get(bookId); // Wave 5 (gate pass B): a point query
  if (!book || book.format !== 'epub' || !Array.isArray(book.spine)) return null;
  const idx = Number(spineIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= book.spine.length) return null;
  return { book, spineIndex: idx, spineEntry: book.spine[idx] };
}

// Set status without awaiting -- the no-clobber mutator is idempotent and the
// worker's own control flow never depends on the write having landed.
function setTtsStatus(bookId, spineIndex, patch) {
  booksStore.setBookAudioStatus({ updateDatabase, booksDb }, bookId, spineIndex, { ...patch, updatedAt: new Date().toISOString() })
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

// runChapterSynthesis moved to lib/media/transcode.js (Wave 7b slice S8).

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
  updateDatabase(() => booksDb.mutate((db) => {
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
  })).catch((err) => console.error('TTS boot reconcile failed:', err && err.message));
}

// ---- Pre-transcode queue (AVI and other non-web containers -> MP4) ----
// Jobs run one at a time to avoid overloading a home server with parallel FFmpeg runs.
const transcodeQueue = [];
const transcodeProgress = {}; // id -> percent complete (0-100) while a job runs

// setTranscodeStatus moved to lib/media/transcode.js (Wave 7b slice S8).

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

// processTranscodeQueue moved to lib/media/transcode.js (Wave 7b slice S8).

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
const audioExtractProgress = {}; // id -> percent complete (0-100) while a job runs

// setAudioStatus moved to lib/media/transcode.js (Wave 7b slice S8).

// clearAudioStatus moved to lib/media/transcode.js (Wave 7b slice S8).

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

// --- v1.92 Storyboard sprites (scrub preview + card autoplay preview) -------
// Pure planning/gating/arg-building lives in lib/storyboard.js (standalone, so
// scripts and unit tests require it without booting the server). The same
// sprite asset drives BOTH the seek-bar scrub preview and the card preview
// (desktop hover / mobile in-view autoplay). v1.93.2: the geometry descriptor
// is DERIVED at read time from the video's persisted duration/dims
// (storyboardDescriptor, below) - it is NOT persisted on db.metadata. The
// sprite FILE on disk is the only state; serving and the scan's heal check both
// key off it (the old persisted descriptor never reached the database on a large
// library, so nothing served - see the v1.93.2 header on storyboardDescriptor).
const { planStoryboard, shouldGenerateStoryboard, buildStoryboardFrameArgs, buildStoryboardAssembleArgs, storyboardSeekTimes } = require('./lib/storyboard');

// v1.94: animated hover PREVIEW CLIP (a muted MP4 montage). Same disk-keyed
// model as the storyboard sprite (no persisted db flag; the on-disk clip is the
// state; eligibility derived by previewClipEligible). The sprite stays for the
// seek-bar SCRUB; this drives the card HOVER.
const { planPreviewClip, previewClipEligible, buildPreviewClipArgs } = require('./lib/previewClip');

// On-disk preview-clip path (content-addressed by media id, beside the .sb.jpg).
function previewClipPath(id) {
  return path.join(THUMBNAIL_DIR, `${id}.pv.mp4`);
}

// On-disk sprite path (content-addressed by media id, like the .jpg thumbnail).
function storyboardPath(id) {
  return path.join(THUMBNAIL_DIR, `${id}.sb.jpg`);
}

// v1.93.2: the storyboard geometry descriptor is DERIVED, never persisted. A
// sprite is a disk-regenerable sidecar whose grid is fully determined by the
// video's (already-persisted) duration + dimensions, so serving, the scan's
// "already generated?" check, and the client geometry ALL key off the on-disk
// `<id>.sb.jpg` + this pure derivation - not a db flag. WHY: the old per-item
// `storyboard` descriptor was only committed at the END of a full scan pass; on
// a large library that finish line was never crossed (v1.92 too slow, v1.93.0
// OOM'd), so 0 of 2943 prod records ever carried it and NOTHING served, while
// the scan re-generated every video forever (its "missing" test read the same
// unpersisted flag). Keying on the on-disk sprite makes generated sprites serve
// immediately and the scan converge, with no dependence on a completed pass.
// count/cols/rows/interval come straight from planStoryboard(duration) - the
// SAME plan the generator tiled - so they always match the on-disk sprite's
// grid. tileH here approximates the tile aspect for the client preview box; the
// sprite's real tile height is set by ffmpeg `scale=tileW:-2` on the true source
// aspect (independent of this value), so an approximation is harmless.
function storyboardDescriptor(item) {
  if (!item || item.type !== 'video') return null;
  const plan = planStoryboard(item.duration);
  if (!plan) return null;
  const w = item.width, h = item.height;
  const tileH = (Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0)
    ? Math.max(2, Math.round(plan.tileW * h / w))
    : Math.round(plan.tileW * 9 / 16);
  return { ...plan, tileH };
}

function queueAudioExtract(id, srcPath) {
  if (!ffmpegAvailable) return;
  if (audioExtractQueue.some(job => job.id === id)) return; // already queued
  audioExtractQueue.push({ id, srcPath });
  processAudioExtractQueue();
}

// processAudioExtractQueue moved to lib/media/transcode.js (Wave 7b slice S8).

// The transcode / background-audio-extract / roku-compat rendition QUEUE machinery
// moved VERBATIM to lib/media/transcode.js in Wave 7b (slice S8); server.js hands its
// collaborators in through `deps` and keeps exporting every queue-API function it
// exported before, as the SAME object. The queue arrays and progress maps STAY here
// (isMediaJobInFlight + the lib/config/lib/media routes read them) and cross as the
// same references; `ffmpegAvailable` is a `let` an async boot probe flips, so it
// crosses as the live reader `ffmpegIsAvailable()` (the one non-byte-identical token).
const transcodeQueues = require('./lib/media/transcode'); // Wave 7b S8: require at the call site so parallel slices never edit one hunk
// `queueTranscode` / `queueAudioExtract` STAY in server.js (Rule 3: they read the
// staying `ffmpegAvailable` let and the staying queue arrays, and only CALL the moved
// process functions), so they stay byte-identical and exported as themselves.
const {
  transcodedPath, isInFlightTranscode, selectEvictions, isCompletedTranscode, activeProtectedPaths,
  evictTranscodeCache, resolveRokuCompat, evictRokuCompatCache, selectAgedOut, sweepAgedTranscodes,
  transcodeCacheSize, effectiveCacheCap, runChapterSynthesis, processTranscodeQueue, setAudioStatus,
  clearAudioStatus, processAudioExtractQueue, reconcileTranscode,
} = transcodeQueues.createTranscodeQueues({
  fs, path, spawn, getCachedDatabase, loadDatabase, updateDatabase, settingsStore, recordServed,
  TRANSCODE_DIR, TRANSCODE_CRF, TRANSCODE_CACHE_MAX_BYTES, RECENT_STREAM_MS, recentlyServed,
  transcodeQueue, transcodeProgress, audioExtractQueue, audioExtractProgress,
  audioPath, buildAudioExtractArgs, needsTranscode,
  ROKU_COMPAT_DIR, ROKU_COMPAT_CACHE_MAX_BYTES, rokuCompatLib, rokuCompatRenditionPath,
  readRokuCompatSidecar, writeRokuCompatSidecar, probeForRokuCompat, configuredLibraryRoots,
  TTS_CACHE_DIR, booksDb, booksStore, booksTtsChunk, booksTtsEngine, booksZip,
  resolveTtsChapter, runFfmpeg, setTtsStatus, synthesizeBlock, ttsBlocksPath, ttsM4aPath, ttsSettings, wavDurationSec,
  ffmpegIsAvailable: () => ffmpegAvailable,
});

// The byte-stream ROUTES (/thumbnail, /storyboard, /preview, /video) and the shared
// Range helper `sendRangeable` moved VERBATIM to lib/media/streams.js in Wave 7b
// (slice S8). `sendRangeable` is built here from the factory because it also feeds the
// lib/tv and lib/music audio routes (registered below) and stays exported; the four
// routes themselves register at their original spot (see mediaStreams.registerRoutes).
const mediaStreams = require('./lib/media/streams'); // Wave 7b S8: require at the call site so parallel slices never edit one hunk
const { sendRangeable } = mediaStreams.createMediaStreams({ fs, pipeline, registerMediaStream });

// applyCapturedViewCount moved to lib/scan/captured.js (Wave 6 scan extraction).

// applyCapturedFollowerCount moved to lib/scan/captured.js (Wave 6 scan extraction).

// collectDownloadNotification moved to lib/scan/captured.js (Wave 6 scan extraction).

// v1.51 notification bell, exec-plan decision 4: one-shot upgrade seeding.
// The first boot after the upgrade pre-populates the feed with the newest
// yt-dlp-provenance items as ALREADY-SEEN, ALREADY-READ history (panel full,
// badge 0, no dots), then stamps `settings.notificationsSeededAt` so it can
// never run twice. The stamp is written even when there was nothing (or no
// need) to seed — a restored instance whose feed already has rows must not
// get a second seeding on its next boot. Provenance = youtubeId OR
// sourceExtractor OR channelUrl: anything the yt-dlp pipeline ever
// identified, which deliberately includes MeTube-era hydrated imports.
const NOTIFICATION_SEED_COUNT = 30;
async function seedNotificationHistoryOnce(nowMs = Date.now()) {
  const db = loadDatabase();
  if (settingsStore.getKey('notificationsSeededAt') !== undefined) return 0; // Wave 4
  let seeded = 0;
  if (userStore.countNotifications() === 0) {
    const candidates = Object.values(db.metadata || {})
      .filter((it) => it && (
        (typeof it.youtubeId === 'string' && it.youtubeId !== '') ||
        (typeof it.sourceExtractor === 'string' && it.sourceExtractor !== '') ||
        (typeof it.channelUrl === 'string' && it.channelUrl !== '')))
      .filter((it) => typeof it.addedAt === 'number' && Number.isFinite(it.addedAt) && it.addedAt > 0)
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, NOTIFICATION_SEED_COUNT);
    // GATE ROUND 2 (adversarial, repro'd): clamp to nowMs. addedAt can sit in
    // the FUTURE (rsync -t from a clock-skewed machine onto a btime-less
    // filesystem), and a seeded row newer than the seed-time last_seen_at is
    // a day-one badge that mark-seen cannot zero until wall clock catches
    // up. Past rows keep their real ordering; future ones collapse to "now".
    seeded = userStore.seedNotifications(candidates.map((it) => ({ mediaId: it.id, createdAt: Math.min(it.addedAt, nowMs) })), nowMs);
  }
  await updateDatabase(() => {
    if (settingsStore.getKey('notificationsSeededAt') !== undefined) return false;
    // Wave 4: the stamp is a settings row, written inside the same commit.
    inSaveTransaction(() => settingsStore.set('notificationsSeededAt', nowMs));
  });
  return seeded;
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
// accepted, narrow limitation (see docs/exec-plans/completed/2026-07-06-v1.13-polish.md item 7).
const EMBEDDED_TAG_WHITELIST = [
  'title', 'artist', 'album', 'date', 'genre', 'composer',
  'description', 'comment', 'show', 'copyright',
  // v1.44 music: album grouping + track ordering. `albumartist`/`track`/`disc`
  // are the canonical ffmpeg tag names; common aliases (album_artist,
  // tracknumber, discnumber) are folded in by the post-processing below.
  'albumartist', 'track', 'disc',
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
  // v1.44 music: fold common alias spellings into the canonical keys (the
  // whitelist only copies exact matches, so these aliases need explicit
  // fallbacks). `album_artist`/`album artist` (ffmpeg/ID3 TPE2),
  // `tracknumber`/`track_number`, `discnumber`/`disc_number`.
  if (!out.albumartist && (lower.album_artist || lower['album artist'])) {
    out.albumartist = lower.album_artist || lower['album artist'];
  }
  if (!out.track && (lower.tracknumber || lower.track_number)) {
    out.track = lower.tracknumber || lower.track_number;
  }
  if (!out.disc && (lower.discnumber || lower.disc_number)) {
    out.disc = lower.discnumber || lower.disc_number;
  }
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

// deriveReleaseDate moved to lib/scan/identity.js (Wave 6 scan extraction).

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

// youtubeIdFromUrlString moved to lib/scan/identity.js (Wave 6 scan extraction).

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

// One `ffmpeg` invocation as a promise resolving to the error (or null on
// success). Never rejects. maxBuffer bounds the captured stderr (loglevel error
// keeps it tiny even for the many grab calls).
function runFfmpegQuiet(args) {
  return new Promise((resolve) => {
    execFile('ffmpeg', args, { maxBuffer: 16 * 1024 * 1024 }, (err) => resolve(err || null));
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
  if (!ffmpegAvailable) return false;
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

// v1.92/v1.93.2: ensure the storyboard SPRITE FILE exists for a REUSED item
// (the backfill path for the whole existing library, which never re-runs
// extractMetadataAndThumbnail). v1.93.2: keyed purely on the ON-DISK sprite, NOT
// on a persisted db flag - so it CONVERGES (a sprite already on disk is skipped)
// with no dependence on a completed scan pass, and it writes NOTHING to the db
// (the descriptor is derived at read time by storyboardDescriptor). An eligible
// video whose sprite is absent/empty is (re)generated; an ineligible item
// (audio/too short) has any stale sidecar removed. No return value - the caller
// no longer sets dbChanged for the storyboard (the sprite is its own state).
async function restoreMissingStoryboard(existing, id, filePath) {
  const outPath = storyboardPath(id);
  if (!shouldGenerateStoryboard(existing)) {
    // Ineligible: no valid sprite should exist for this id - drop a stale one.
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) { /* best-effort */ }
    return;
  }
  let present = false;
  try { present = fs.existsSync(outPath) && fs.statSync(outPath).size > 0; } catch (_) { present = false; }
  if (present) return; // already on disk -> converged, no ffmpeg

  console.log(`Restoring missing storyboard for: ${path.basename(filePath)}`);
  try {
    await extractStoryboard(filePath, id, existing.duration);
  } catch (err) {
    console.error(`Error restoring storyboard for ${path.basename(filePath)}:`, err);
  }
}

// v1.94: generate the animated hover PREVIEW CLIP (a muted MP4 montage) for a
// VIDEO (best-effort). Returns true iff a valid clip was written. One ffmpeg
// pass (buildPreviewClipArgs: N fast input-seeks -> trim/scale/concat -> H.264),
// NO temp files. Owns only the FILE - no db field (eligibility is derived at
// read time by previewClipEligible). Never throws.
async function extractPreviewClip(filePath, id, duration) {
  if (!ffmpegAvailable) return false;
  const outPath = previewClipPath(id);
  const plan = planPreviewClip(duration);
  if (!plan) {
    // Ineligible (e.g. an in-place replace with a sub-5s clip): drop any stale clip.
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) { /* best-effort */ }
    return false;
  }
  try {
    const err = await runFfmpegQuiet(buildPreviewClipArgs(filePath, outPath, plan));
    let ok = false;
    try { ok = !err && fs.existsSync(outPath) && fs.statSync(outPath).size > 0; } catch (_) { ok = false; }
    if (!ok) {
      try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) { /* best-effort */ }
      return false;
    }
    return true;
  } catch (_) {
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) { /* best-effort */ }
    return false;
  }
}

// v1.94: ensure the preview-clip FILE exists for a REUSED item - the disk-keyed
// heal, mirroring restoreMissingStoryboard: keyed on the on-disk clip (converges
// with no dependence on a completed pass), writes NOTHING to the db, and an
// ineligible item (audio/too short) has any stale clip removed. No return value.
async function restoreMissingPreviewClip(existing, id, filePath) {
  const outPath = previewClipPath(id);
  if (!previewClipEligible(existing)) {
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) { /* best-effort */ }
    return;
  }
  let present = false;
  try { present = fs.existsSync(outPath) && fs.statSync(outPath).size > 0; } catch (_) { present = false; }
  if (present) return; // already on disk -> converged, no ffmpeg

  console.log(`Restoring missing preview clip for: ${path.basename(filePath)}`);
  try {
    await extractPreviewClip(filePath, id, existing.duration);
  } catch (err) {
    console.error(`Error restoring preview clip for ${path.basename(filePath)}:`, err);
  }
}

// applyHasSubtitlesDetection moved to lib/scan/probe.js (Wave 6 scan extraction).

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
const scanState = { scanning: false, lastScan: null, rescanRequested: false, processed: 0, total: 0, phase: 'idle' };

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

// normalizeScanRoot moved to lib/scan/roots.js (Wave 6 scan extraction).

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
  const scanEpochAtStart = persistedStateEpoch;
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
      if (!existing && !isAudio && !READ_ONLY_MEDIA && ffmpegAvailable &&
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
    if (scanEpochAtStart !== persistedStateEpoch) {
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
  // Called only at boot and on a scanIntervalMinutes settings change
  // (infrequent, not a request/serve-path read). Wave 4: the settings table.
  const ms = scanIntervalMs(settingsStore.getKey('scanIntervalMinutes'));
  if (ms) {
    scanTimer = setInterval(() => {
      scanDirectories().catch(console.error);
      // v1.37.0 books: piggyback on the media interval (exec plan §2) --
      // no second timer, and a books-less install no-ops.
      scanBooks().catch(console.error);
      // v1.44 music: same piggyback slot; a music-less install no-ops.
      scanMusic().catch(console.error);
      // v1.195 TV Shows: same piggyback slot; a Shows-less install no-ops.
      scanTv().catch(console.error);
      // v1.65: trash retention sweep, same piggyback slot (no second timer).
      sweepTrash().catch(console.error);
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

// Middleware
//
// v1.43.1 (A1, Dean's prod restore 413): the global JSON parser SKIPS
// /api/admin/restore. The global express.json() keeps body-parser's default
// 100 kb cap, and because it runs before every route, it used to throw
// entity.too.large for any real backup bundle (~MBs of metadata + accounts
// + logo b64) BEFORE the restore route's own route-scoped parser was ever
// reached — that route's larger limit had been dead code since v1.42, and
// the tiny test fixture masked it. Excluding the path here (rather than
// raising the global cap) does two jobs:
//   1. the restore route's route-scoped express.json({limit}) becomes the
//      ONE parser that owns that body, restoring its limit's meaning;
//   2. the AUTH GATE below runs before any multi-MB parse happens, so the
//      large-body allowance is confined to authenticated admins — a global
//      32mb cap would hand every unauthenticated caller a pre-auth memory
//      amplifier on every JSON route.
// Matching is on the normalized path (case-folded, trailing slashes
// stripped) because Express's default router matches routes
// case-INsensitively and tolerates trailing slashes — a skip keyed on the
// exact string would let `/api/admin/restore/` reach the route through the
// global 100 kb parser again, resurrecting the dead-limit bug for that
// spelling.
const globalJsonParser = express.json();
const RESTORE_ROUTE_PATH = '/api/admin/restore';
function isRestorePath(reqPath) {
  return typeof reqPath === 'string'
    && reqPath.replace(/\/+$/, '').toLowerCase() === RESTORE_ROUTE_PATH;
}
// Method-scoped to POST (the only verb registered on that path — exec-plan
// consistency, adversarial-seat NOTE-5): a GET/PUT there 404s with its body
// unread either way; scoping the skip keeps this predicate exactly as narrow
// as the route it exists for. Verified against express/path-to-regexp
// source: both this middleware's req.path and the router match the same raw
// undecoded pathname, and the router's non-strict case-insensitive regexp
// accepts exactly the spellings the normalized compare accepts — no spelling
// reaches the route through the wrong parser in either direction.
app.use((req, res, next) => {
  if (req.method === 'POST' && isRestorePath(req.path)) return next();
  return globalJsonParser(req, res, next);
});
// v1.28.0 (iOS Shortcuts robustness): without this, a malformed JSON body
// (e.g. a Shortcut that mis-serializes its own payload) makes `express.json()`
// throw, and Express's DEFAULT error handler renders that as an HTML stack
// page -- useless to any JSON API caller (a Shortcut, curl, the browser
// fetch()s under public/js). A 4-arg (error-handling) middleware placed
// [Wave 7b, S1b: that path is spelled without a star on purpose. The source
// locks strip BLOCK comments before line comments, so a literal slash-star
// inside a line comment opens a pseudo-block that runs to the next star-slash
// - here it used to swallow 218 lines of server.js, and when this slice moved
// the login route whose inline "non-fatal" comment accidentally closed it, the
// swallow grew to 898 lines and took a musicDb.mutate call with it (the
// comment-porous source-lock class, v1.50/v1.77/v1.133). Removing the star
// restores the locks' reach. Three more such stars remain in this file's line
// comments - two active openers plus one that currently sits inside the first
// one's swallow and would open its own the moment that one is removed
// (tech-debt #228: the shared stripper strips in the wrong order).]
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

// ---- v1.43: the auth gate + auth routes ------------------------------------
// ONE app.use, installed HERE (after express.json + the body-parser error
// handler, BEFORE the shell catch-all + static + all ytdlp routes at the
// bottom), so it covers every route, static asset, and byte stream by
// default (design + drift #1). The allowlist lets the login surface through;
// everything else needs a valid session (or funnels to /welcome when no
// users exist yet). Pages redirect to /login; APIs 401.
//
// Test bypass: the SECURITY of the gate is proven by lib/auth's own unit
// suites (crypto/store/gate, 50+ tests) and by dedicated integration tests
// (auth-flow) that exercise the REAL gate end-to-end. For every OTHER
// integration test — which predates auth and asserts route behavior, not
// auth — the gate is bypassed via a helper that seeds a test session, so
// those suites keep testing what they test. The bypass is NOT an env flag
// (an env that disables auth is a prod foot-gun); it is the presence of a
// valid session cookie, exactly like a real browser. See
// test/helpers/auth.js.
const authGate = authGateLib.createAuthGate({
  store: userStore,
  secret: SESSION_SECRET,
  cookieName: AUTH_COOKIE_NAME,
  trustProxy: TRUST_PROXY,
  apiToken: API_TOKEN, // the Shortcut token for POST /api/ytdlp/download
});
app.use(authGate);

// ---- 2026-07-30 capture-safety hardening (P2 + P3-audit) -------------------
// Incident: a screenshot-harness scene issued real DELETE /api/videos/:id
// calls against a live library, and the container's silence (no request
// logging) made it nearly undetectable. Two structural answers, both
// mounted AFTER the auth gate so req.user is attributable:
//
// 1) AUDIT: every mutating request logs one structured line on finish -
//    method, path, status, user. Middleware placement covers every
//    destructive route, present and future, by construction (no per-route
//    wiring to forget).
// 2) FILETUBE_READONLY=1: refuse every mutating VERB for instances that
//    exist to be photographed or paralleled. Deliberately distinct from
//    FILETUBE_READ_ONLY_MEDIA (the v1.42 beta lever, which by design
//    keeps likes/progress/settings writable): this one rejects all
//    POST/PUT/PATCH/DELETE except the session POSTs (login/logout/first-
//    run setup) and the relocation dry-run preview, which is read-only by
//    server contract. HONEST LIMIT (gate finding): verb-only enforcement
//    cannot stop the media-serving GETs from writing to the transcode/
//    rendition CACHE (queueTranscode/queueAudioExtract/roku remux) -
//    cache-only and self-healing, disclosed in docs/CONFIGURATION.md and
//    tech-debt #65. Read per-request so tests toggle without a re-require.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const READONLY_ALLOWED_POSTS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  // First-run provisioning: the auth gate already allowlists setup pre-auth
  // (and 409s it once users exist) - without this, a fresh zero-user
  // instance under FILETUBE_READONLY could never create its first admin
  // (gate finding).
  '/api/auth/setup',
  '/api/ytdlp/repull-metadata/preview',
]);
// Extracted as a factory (gate DELTA-B) so a unit test can mount EXACTLY
// this middleware on a throwaway app with a deferred handler and prove the
// close-path fires - the in-place integration test raced a synchronous 404
// against the socket teardown and was vacuously green on the finish path.
function createMutationAuditMiddleware(log = null) {
  // log resolves at CALL time, not factory time: a default-parameter
  // console.log would freeze the reference at require, and the audit
  // tests' console interceptor (and anything else that wraps logging)
  // would silently see nothing.
  return (req, res, next) => {
    if (!MUTATING_METHODS.has(req.method)) return next();
    // 'finish' AND 'close', once-guarded: a client that tears the socket
    // down mid-request (fire-and-forget fetch, a capture context closing)
    // never fires 'finish', and the mutation may still have completed
    // inside the route - exactly the shape the audit exists to catch (gate
    // CRITICAL-2). originalUrl, not path: ?removeAnyway=true is a
    // materially different destructive operation from a bare DELETE and
    // must not log identically. 'incomplete' marks a response that never
    // fully went out (res.statusCode alone would claim a 200 that no
    // client ever received).
    let audited = false;
    const emit = () => {
      if (audited) return;
      audited = true;
      const who = (req.user && (req.user.username || req.user.name || req.user.id)) || req.auditActor || 'unauthenticated';
      const incomplete = res.writableEnded ? '' : ' incomplete';
      (log || console.log)(`[audit] ${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode}${incomplete} user=${who}`);
    };
    res.on('finish', emit);
    res.on('close', emit);
    return next();
  };
}
app.use(createMutationAuditMiddleware());
app.use((req, res, next) => {
  if (process.env.FILETUBE_READONLY !== '1') return next();
  if (!MUTATING_METHODS.has(req.method)) return next();
  if (req.method === 'POST' && READONLY_ALLOWED_POSTS.has(req.path)) return next();
  return res.status(403).json({
    error: 'read-only mode: this instance runs with FILETUBE_READONLY=1 - every mutating request is rejected (capture/parallel-run protection).',
    readOnly: true,
  });
});
if (process.env.FILETUBE_READONLY === '1') {
  console.log('[read-only] FILETUBE_READONLY=1 - every mutating VERB is rejected except login/logout/setup and the relocation dry-run preview. (Media-serving GETs may still write to the transcode cache - see docs/CONFIGURATION.md.)');
}

// Set/clear the session cookie for a user id (+ current tv).
function issueSessionCookie(res, req, user) {
  const token = authCrypto.signSession({ uid: user.id, tv: user.tokenVersion }, SESSION_SECRET);
  res.setHeader('Set-Cookie', authGateLib.serializeCookie(AUTH_COOKIE_NAME, token, {
    maxAgeSeconds: authCrypto.SESSION_SECONDS_DEFAULT,
    secure: authGateLib.requestIsHttps(req, TRUST_PROXY),
  }));
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', authGateLib.serializeCookie(AUTH_COOKIE_NAME, '', { expired: true }));
}
// NOTE (v1.43.1 health review): with FILETUBE_TRUST_PROXY=1 the first
// X-Forwarded-For hop is trusted as the client ip — the fronting proxy MUST
// overwrite/sanitize inbound XFF (NPM's default proxy headers do), or a
// client can rotate the header to mint a fresh rate bucket per attempt. The
// limiter is defense-in-depth (async scrypt is the real login cost); the
// per-(ip,username) bucket shape itself is revisited in v1.44's rate-limit
// hardening (tech-debt tracker).
function rateKey(req, username) {
  const ip = (TRUST_PROXY && typeof req.headers['x-forwarded-for'] === 'string'
    ? req.headers['x-forwarded-for'].split(',')[0].trim()
    : (req.socket && req.socket.remoteAddress)) || 'unknown';
  return `${ip}|${String(username || '').toLowerCase()}`;
}

// ---- the identity routes ----------------------------------------------------
// Wave 7b (slice S1b): sign-in/sign-out and the current user (/api/auth), the
// display-pref mirror (POST /api/me/settings) and admin user management
// (/api/users) moved VERBATIM to lib/auth/routes.js and register from here, in
// their original source order - AHEAD of the shell wildcard and the static
// layer, which is the routing position this call site preserves. The login
// dummy hash, the settings allowlist, the new-account default, the rule
// messages, the restriction enums and the resolveTargetUser /
// wouldRemoveLastAdmin / readAccessMode / unitRows helpers moved with them
// (the routes were their only readers); requireAdmin, publicUser and the
// session-cookie pair stayed here because other code reads them.
authRoutes.registerRoutes(app, {
  authCrypto,
  avatarInfo, // GET /api/auth/me merges the photo's presence + cache-bust version
  booksDb,
  clearSessionCookie,
  // The user-delete cascade drops that user's staged (un-flushed) pings before
  // the row goes, so no flush batch ever carries a vanished user_id.
  dropPendingProgressForUser,
  glyphPool, // LIBRARY_GLYPH_SLOTS - the settings allowlist spreads from the registry
  issueSessionCookie,
  likedStore, // the frozen pre-auth likes /api/auth/setup adopts into the first admin
  loginRateLimiter,
  progressStore, // the frozen pre-auth positions, adopted by the same route
  publicUser,
  rateKey, // the (ip, username) login-rate bucket key
  requireAdmin,
  unlinkAvatar, // the user-delete cascade: no orphaned profile image / sticker
  unlinkSticker,
  userStore,
  ytdlpDb,
});

// Test-only: mint a genuine session cookie for tests (see the export comment).
function __mintTestSession(opts = {}) {
  const username = opts.username || 'testadmin';
  let user = userStore.getByUsername(username);
  if (!user) {
    if (userStore.countUsers() === 0) {
      user = userStore.createFirstAdmin(
        { username, displayName: username, passwordHash: 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
        null, new Date().toISOString()
      );
    } else {
      user = userStore.createUser(
        { username, displayName: username, passwordHash: 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', role: opts.role || 'admin', canManageSubscriptions: true },
        new Date().toISOString()
      );
    }
  }
  const token = authCrypto.signSession({ uid: user.id, tv: user.tokenVersion }, SESSION_SECRET);
  return { cookie: `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`, user: publicUser(user), cookieName: AUTH_COOKIE_NAME, token };
}

// The safe public projection of a user row (never the password hash).
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, displayName: u.displayName,
    role: u.role, canManageSubscriptions: u.canManageSubscriptions,
    // v1.81 write-RBAC: the client reads this off /api/auth/me to hide the
    // delete/move/edit affordances for a member who lacks it (server is the
    // real gate; hiding is UX only).
    canModifyLibrary: u.canModifyLibrary,
  };
}

// ---- v1.43 chunk 4c: admin user management ---------------------------------
// The admin-only PREDICATES. The /api/users routes they gate moved to
// lib/auth/routes.js in Wave 7b (slice S1b) - see the authRoutes.registerRoutes
// call above - and reach these through `deps`; the predicates themselves stayed
// because routes all over this file (and the ytdlp/podcasts modules) gate on
// them. The gate already guarantees a signed-in req.user; these add the role
// check. Response shapes there reuse publicUser / listUsers' projection — a
// password hash can never ride any of them.

function requireAdmin(req, res) {
  if (!req.user || req.user.role !== 'admin') {
    // v1.171 (QA S3): domain-neutral copy - this helper gates users, the logo,
    // AND the critter pool; "can manage users" lied on two of the three.
    res.status(403).json({ error: 'Admin access required.' });
    return false;
  }
  return true;
}

// v1.80 RBAC: admin OR the per-user `canManageSubscriptions` capability may
// MUTATE the shared channel registry. A plain member (incl. a kid account) may
// browse subscriptions but never add/remove/edit them. Passed into the ytdlp
// module via deps so its routes route through this one predicate. Closes the
// census finding that the flag was settable-but-unenforced.
function requireManageSubscriptions(req, res) {
  if (req.user && (req.user.role === 'admin' || req.user.canManageSubscriptions)) return true;
  res.status(403).json({ error: 'You do not have permission to manage subscriptions.' });
  return false;
}

// v1.81 write-RBAC: admin OR the per-user `canModifyLibrary` capability may
// MUTATE library CONTENT - delete/move/edit media, run scans, clear the
// transcode cache, purge/restore trash. Default OFF for members (existing
// members lose these until an admin grants it - Dean-approved). THE single
// decision point (the v1.41.4 one-writer scar): every content-mutating route
// routes through this one predicate; passed into the podcasts module via deps
// exactly like requireManageSubscriptions. This is deliberately the FIRST guard
// in each handler - a capability-less member gets a uniform 403 and never
// reaches the existence-revealing 404 of restrictedVideoMutation (no id oracle).
function requireModifyLibrary(req, res) {
  if (req.user && (req.user.role === 'admin' || req.user.canModifyLibrary)) return true;
  res.status(403).json({ error: 'You do not have permission to modify the library.' });
  return false;
}

// Remove every staged (not-yet-flushed) progress/book-progress/music ping owned
// by a user id, across all THREE coalescers — called when a user is deleted so
// a vanished user_id never reaches a flush batch (gate WARNING-1).
function dropPendingProgressForUser(userId) {
  for (const [key, entry] of [...pendingProgress]) {
    if (entry.userId === userId) pendingProgress.delete(key);
  }
  for (const [key, entry] of [...pendingBookProgress]) {
    if (entry.userId === userId) pendingBookProgress.delete(key);
  }
  for (const [key, entry] of [...pendingMusicProgress]) {
    if (entry.userId === userId) pendingMusicProgress.delete(key);
  }
}
// v1.41.18 (Dean): kill the header logo FOUC at the SOURCE. The header shells
// are static HTML, so the "FileTube" text wordmark always painted before
// common.js could swap in a configured custom logo -- a flash on every refresh.
// The v1.41.17 client approach (a localStorage flag stamped pre-paint) could
// not cover the FIRST paint -- the flag is only written after a prior
// successful load -- and collapsed if storage was cleared/blocked. Fix it
// server-side: when a custom logo is configured, bake `ft-custom-logo` onto
// <html> at serve time so the wordmark-hiding CSS (.ft-custom-logo .logo) is in
// force before ANY parsing. HTML is served no-cache (revalidated each load), so
// this is always current, needs no bootstrap, and depends on nothing
// client-side. Only full-page loads/refreshes hit this; in-app SPA nav keeps
// the header, so there is no FOUC there to fix.
const FOUC_SHELL_FILES = new Set(['index.html', 'watch.html', 'stats.html', 'setup.html', 'read.html', 'books.html', 'music.html', 'tv.html', 'podcasts.html', 'history.html', 'login.html', 'welcome.html']);
function shellHtmlForRequestPath(p) {
  if (p === '/' || p === '/index.html') return 'index.html';
  if (p === '/books' || p === '/books.html') return 'books.html';
  if (p === '/music' || p === '/music.html') return 'music.html';
  if (p === '/tv' || p === '/tv.html') return 'tv.html';
  // v1.69 gate fix (adversarial #4): without this arm the pretty /podcasts
  // route - the one every nav link uses - fell through to a bare sendFile
  // with no custom-logo injection and the wrong cache header, while only
  // the never-linked /podcasts.html behaved.
  if (p === '/podcasts' || p === '/podcasts.html') return 'podcasts.html';
  if (p === '/history' || p === '/history.html') return 'history.html';
  // v1.43 auth: the pretty routes /login and /welcome serve their shells (the
  // gate above lets them through the allowlist; here they get the same
  // custom-logo/no-cache treatment as every other shell).
  if (p === '/login') return 'login.html';
  if (p === '/welcome') return 'welcome.html';
  const bare = p.startsWith('/') ? p.slice(1) : p;
  return FOUC_SHELL_FILES.has(bare) ? bare : null;
}
// Inject `ft-custom-logo` into the shell's <html> tag, preserving any existing
// class/attrs. Idempotent: never doubles the class if it is somehow present.
function injectCustomLogoClass(html) {
  return html.replace(/<html\b([^>]*)>/i, (full, attrs) => {
    const a = attrs || '';
    if (/\bft-custom-logo\b/.test(a)) return full;
    const classMatch = /\bclass\s*=\s*"([^"]*)"/i.exec(a);
    if (classMatch) {
      const replaced = a.replace(classMatch[0], `class="${classMatch[1]} ft-custom-logo"`);
      return `<html${replaced}>`;
    }
    return `<html${a} class="ft-custom-logo">`;
  });
}
// v1.90: stamp the running app version into the shell <head> as a meta tag, so
// the client can render "vX.Y.Z" (account menu footer + Settings page) with ZERO
// extra fetch. Idempotent; inserted right after <head>. APP_VERSION comes from
// package.json (`\d+\.\d+\.\d+`), but escape the quote/angle chars defensively.
function injectVersionMeta(html) {
  if (/<meta\s+name="ft-version"/i.test(html)) return html;
  const safe = String(APP_VERSION).replace(/[<>"&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' }[c]));
  const tag = `<meta name="ft-version" content="${safe}">`;
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/(<head\b[^>]*>)/i, `$1${tag}`);
  return html; // no <head> (not a shell we template) -- leave untouched
}
// Read a header shell from disk and send it with the custom-logo class injected
// when one is configured. Returns false (having sent nothing) if the file can't
// be read, so callers can fall through. Shared by the static-shell middleware
// below AND the yt-dlp module's gated /subscriptions route (dep-injected), so
// EVERY header-bearing page gets the identical zero-flash treatment.
function sendShellHtml(res, absFilePath) {
  let html;
  try {
    html = fs.readFileSync(absFilePath, 'utf8');
  } catch (_) {
    return false;
  }
  // v1.89: the header now ALWAYS resolves to an image -- the bundled default
  // banner when no custom logo is uploaded (see GET /logo), or the upload when
  // there is one. So stamp `ft-custom-logo` unconditionally, collapsing the
  // text wordmark pre-paint on every shell so the banner never flashes "FileTube"
  // text first. (Whether a custom logo was UPLOADED is reported separately to the
  // Settings->Logo controls straight off settings.customLogoMime/customLogoDarkMime
  // -- see GET /api/settings.) If the shipped asset is ever unreadable, /logo 404s
  // and the client's boot probe clears the class, restoring the text wordmark as
  // the safety fallback.
  html = injectCustomLogoClass(html);
  html = injectVersionMeta(html); // v1.90: expose the running version to the client
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(html);
  return true;
}
app.get('*', (req, res, next) => {
  const shell = shellHtmlForRequestPath(req.path);
  if (!shell) return next();
  if (!sendShellHtml(res, path.join(__dirname, 'public', shell))) return next();
});
// Serve the app assets with revalidation (no-cache) so updated HTML/JS/CSS show up
// immediately behind caches (browsers, nginx) instead of serving stale files.
// ETag/Last-Modified still allow cheap 304s when nothing changed.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache');
  }
}));

// Wave 7b (slice S10b): the media-folder config (GET/POST /api/config), the
// per-folder display-name and Music-flag routes and the on-demand scan
// trigger moved VERBATIM to lib/config/routes.js, together with GLYPH_IDS -
// the folder-glyph allowlist the config POST was the only referrer of. The
// three path groups interleave in one contiguous block, so they register as
// ONE ordered block here, exactly where GET /api/config sat. The module's
// require sits at its call site (not in the top require block) so the split's
// parallel slices never edit the same hunk.
const configRoutes = require('./lib/config/routes');
configRoutes.registerConfigRoutes(app, {
  DATA_DIR, // the podcasts-root probe in the media-folder overlap net
  booksDb,
  folderDisplayNameStore,
  folderSettingsStore,
  folderStore,
  foldersOverlap,
  glyphPool, // the shared glyph registry, handed in (R2 gate W2: the first cut required it a second time)
  fs,
  getCachedDatabase,
  inSaveTransaction, // the folder list + the settings map write inside ONE doc commit
  libraryAudio, // the channel-mark predicate the music-flag routes share with the projection
  loadDatabase,
  matchRootFolder,
  mediaVisibleTo, // v1.80 RBAC: the per-user visibility gate for media items
  musicDb,
  path,
  podcasts,
  requesterHasRestrictions,
  requireAdmin,
  requireModifyLibrary,
  scanDirectories,
  scanState, // the LIVE scan-state object (never reassigned, only mutated)
  tvDb,
  updateDatabase,
  ytdlp,
  ytdlpArgs,
});

// ---- Books (v1.37.0) --------------------------------------------------------
//
// The book library's server half: its OWN folder config (`db.books.folders`
// -- never `db.folders`), its own scanner with the media scan's
// overlap/coalescing discipline, and cover storage under BOOKCOVER_DIR.
// Everything degrades to a no-op on a books-less install (zero folders =
// zero scans = zero db writes = the disabled-module posture ytdlp set).
// Full design: docs/exec-plans/completed/2026-07-12-v1.37.0-books.md.

const bookScanState = { scanning: false, lastScan: null, rescanRequested: false };
// v1.37.0 gate fix (adversarial W4): the single deferred follow-up timer --
// see scanBooks' finally block.
let deferredBookRescanTimer = null;

// Test-observability accessor, mirroring currentScanTimer/scanState reads.
function currentBookScanState() {
  return bookScanState;
}

// Wave 7b (slice S2): ONE pass - the walk, the cover writes, the merge and the
// pruned books' hygiene - moved VERBATIM to lib/books/scanRunner.js. scanBooks
// below is unchanged and stays here: it owns bookScanState, the single deferred
// rescan timer and the follow-up budget, and other callers (the media scan, the
// boot path) and the integration tests reach it through this file's exports.
const { runBookScan } = booksScanRunner.createBookScanRunner({
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
});

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

// Wave 7b (slice S2): the books HTTP surface - /api/books, /book and
// /bookcover - moved VERBATIM to lib/books/routes.js, together with the five
// module-scope names the moved routes were the only referrers of
// (BOOK_CONTENT_TYPES, BOOK_COVER_TYPES, BOOK_COVER_MAX_BYTES, sortBookList,
// publicBookListItem). The three path groups interleave, so they register as
// ONE ordered block here - exactly where GET /api/books/config sat - and the
// reading-position ping registers separately further down, where it sat.
booksRoutes.registerRoutes(app, {
  BOOKCOVER_DIR,
  DATA_DIR, // the podcasts-root probe in the book-folder overlap net
  bookScanState, // the LIVE scan-state object (never reassigned, only mutated)
  bookVisibleTo, // v1.80 RBAC: the per-user visibility gate for book items
  booksDb,
  booksStore,
  contentDispositionAttachment,
  effectiveBookProgress, // pending-first reading position, per user
  escapeHtml,
  express, // only for express.raw on the cover upload
  folderStore,
  foldersOverlap,
  fs,
  getCachedDatabase,
  getMediaId,
  markServed, // keeps a streaming TTS chapter out of the cache sweep
  musicDb,
  path,
  podcasts,
  queueChapterTts,
  requireAdmin,
  requireModifyLibrary,
  resolveTtsChapter,
  scanBooks, // the overlap/coalescing scan guard (still this file's)
  ttsAvailable,
  ttsBlocksPath,
  ttsConfig,
  ttsM4aPath,
  ttsServeKey,
  tvDb,
  updateDatabase,
  userStore,
  visibleConfigRoots,
  ytdlpArgs,
});

// ---- Books: progress coalescer (T6 -- the v1.30 A4 discipline, books-owned) --
//
// A structural twin of `pendingProgress`/`flushPendingProgress` above (see
// that section's full rationale): reading-position pings are frequent and
// cheap-to-lose, so they stage here and flush as ONE durable write per
// window. Deliberately NOT routed through `POST /api/progress` -- its value
// shape ({timestamp,duration}) cannot express a CFI locator, and its flush
// guard is book membership (the books catalog's own table since Wave 5 -
// lib/books/store.js).
//
// v1.43 (chunk 4b): reading positions belong to a USER -- same rework as
// the media coalescer above: keys are `<userId>:<bookId>`, entries carry
// `{userId, bookId, value}`, the flush batch-upserts `user_book_progress`
// (one transaction) via the return-false mutator that keeps the
// deleted-between-ping-and-flush guard race-free and preserves the restore
// ordering. `db.books.progress` is the frozen pre-auth record; the cutover
// is total.
const pendingBookProgress = new Map();
let bookProgressFlushTimer = null;

function currentBookProgressFlushTimer() {
  return bookProgressFlushTimer;
}

let bookProgressFlushWriteCount = 0;
function __getBookProgressFlushWriteCount() {
  return bookProgressFlushWriteCount;
}
function flushPendingBookProgress() {
  if (bookProgressFlushTimer) {
    clearTimeout(bookProgressFlushTimer);
    bookProgressFlushTimer = null;
  }
  if (pendingBookProgress.size === 0) return Promise.resolve(false);
  const snapshot = [...pendingBookProgress.values()];
  pendingBookProgress.clear();
  return updateDatabase((db) => {
    const ns = booksDb.read();
    // Same deleted-between-ping-and-flush guard as the media coalescer: a
    // flush must never resurrect progress for a pruned book. OWN-property
    // (the v1.42 __proto__ lesson), same as the media flush above.
    const rows = snapshot.filter((entry) => Object.prototype.hasOwnProperty.call(ns.items, entry.bookId));
    if (rows.length > 0) {
      userStore.setBookProgressBatch(rows);
      bookProgressFlushWriteCount++;
    }
    return false; // per-user rows only -- never a doc-table write from a flush
  }).then(() => true).catch((err) => {
    console.error('Error flushing batched book progress:', err);
  });
}

function armBookProgressFlushTimerIfNeeded() {
  if (bookProgressFlushTimer) return;
  bookProgressFlushTimer = setTimeout(flushPendingBookProgress, PROGRESS_FLUSH_MS);
  bookProgressFlushTimer.unref();
}

// Read-your-writes overlay -- pending first, then the user's committed
// `user_book_progress` row (the effectiveProgress posture; never the frozen
// db.books.progress record).
function effectiveBookProgress(userId, id) {
  const pending = pendingBookProgress.get(pendingProgressKey(userId, id));
  if (pending) return pending.value;
  return userStore.getOneBookProgress(userId, id);
}

// The clean /books URL (express.static already serves /books.html; this
// mirrors the ytdlp module's own /subscriptions sendFile).
app.get('/tv', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv.html'));
});
app.get('/music', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'music.html'));
});

app.get('/books', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'books.html'));
});

// v1.69: the clean /podcasts URL (same posture as /music and /books).
app.get('/podcasts', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'podcasts.html'));
});

booksRoutes.registerProgressRoute(app, {
  armBookProgressFlushTimerIfNeeded, // arms the bookProgressFlushTimer flushPendingBookProgress owns
  booksDb,
  pendingBookProgress, // the coalescer's staging Map - the LIVE object, never a copy
  pendingProgressKey,
});

// Wave 7b (slice S10b): GET /api/scan-status moved VERBATIM to
// lib/config/routes.js with TRANSCODE_LIST_CAP, the transcodeNames cap it was
// the only reader of.
configRoutes.registerScanStatusRoute(app, {
  folderStore,
  getCachedDatabase,
  mediaVisibleTo, // v1.80 RBAC: the per-user visibility gate for media items
  requesterHasRestrictions,
  scanState, // the LIVE scan-state object (never reassigned, only mutated)
  visibleConfigRoots,
  visibleMetadataFor,
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
// v1.65: same allowed set for the trash retention (0 = keep forever).
const TRASH_RETENTION_DAYS_VALID_VALUES = new Set([0, 7, 14, 30, 90]);

// ---- Music library (v1.44) --------------------------------------------------
//
// The music library's server half: its OWN folder config (`db.music.folders`
// -- never db.folders/db.books.folders), its own scanner with the media/books
// mount-loss discipline, album art under ALBUMART_DIR, and per-user liked/
// progress/resume through userStore. Everything degrades to a no-op on a
// music-less install (zero folders = zero scans = zero db writes). Full
// design: docs/exec-plans/completed/2026-07-17-v1.44-music-library.md.

const musicScanState = { scanning: false, lastScan: null, rescanRequested: false };
let deferredMusicRescanTimer = null;

function currentMusicScanState() {
  return musicScanState;
}

// The injected ffprobe probe (server-side spawn; lib/music/scan.js stays
// CI-testable by never spawning itself). One probe yields the tags, the audio
// codec (for the ALAC transcode gate, T7), the duration, and whether the file
// carries an embedded cover picture. Degrade-safe: null on ffmpeg-unavailable
// or any probe/parse error (the file still indexes by path-convention).
function probeMusicTrack(filePath) {
  return new Promise((resolve) => {
    if (!ffmpegAvailable) { resolve(null); return; }
    execFile('ffprobe', buildFfprobeArgs(filePath), { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) { resolve(null); return; }
      let parsed;
      try { parsed = JSON.parse(stdout); } catch (_) { resolve(null); return; }
      let tags = {};
      let streams = {};
      try { tags = parseFfprobeTags(parsed); } catch (_) { tags = {}; }
      try { streams = parseFfprobeStreams(parsed); } catch (_) { streams = {}; }
      let durationSec = 0;
      const d = parsed && parsed.format && Number(parsed.format.duration);
      if (Number.isFinite(d) && d > 0) durationSec = d;
      const strs = parsed && Array.isArray(parsed.streams) ? parsed.streams : [];
      const hasEmbeddedArt = strs.some((s) => s && s.disposition && s.disposition.attached_pic === 1);
      resolve({ tags, durationSec, codec: streams.audioCodec || null, hasEmbeddedArt });
    });
  });
}

function albumArtExists(albumArtKey) {
  return fs.existsSync(path.join(ALBUMART_DIR, `${albumArtKey}.jpg`))
    || fs.existsSync(path.join(ALBUMART_DIR, `${albumArtKey}.png`));
}

// v1.44 T7: the ALAC transcode gate. CONSERVATIVE, positive-identification
// only — only a probed `alac` codec transcodes; a null/unknown/absent codec
// (probe failed or ffmpeg absent) NEVER flags a file (the "degrade safely"
// contract — a false transcode would be worse than a direct stream that the
// browser might handle). Everything else (mp3/aac/flac/pcm) streams natively.
function musicCodecNeedsTranscode(codec) {
  return typeof codec === 'string' && codec.toLowerCase() === 'alac';
}

// A tiny, MUSIC-OWNED transcode queue (never the video audio-extract queue,
// which writes db.metadata[id].audioStatus — a music id would pollute the
// video namespace). Renditions land at audioPath(id) so they share the
// TRANSCODE_DIR cache management (LRU eviction, tmp cleanup, age sweep) for
// free; readiness is tracked by FILE EXISTENCE alone (no db write on the hot
// path). Reuses buildAudioExtractArgs (-vn AAC/160k m4a) — for an ALAC source
// `-vn` also drops any embedded cover-art video stream, exactly right.
const musicTranscodeQueue = [];
let musicTranscodeBusy = false;
function queueMusicTranscode(id, srcPath) {
  if (!ffmpegAvailable) return;
  if (musicTranscodeQueue.some((job) => job.id === id)) return; // already queued
  musicTranscodeQueue.push({ id, srcPath });
  processMusicTranscodeQueue();
}
function processMusicTranscodeQueue() {
  if (musicTranscodeBusy || musicTranscodeQueue.length === 0) return;
  const { id, srcPath } = musicTranscodeQueue.shift();
  if (!fs.existsSync(srcPath)) { processMusicTranscodeQueue(); return; }
  const outPath = audioPath(id);
  if (fs.existsSync(outPath)) { processMusicTranscodeQueue(); return; }
  musicTranscodeBusy = true;
  const tmpPath = `${outPath}.tmp.m4a`;
  let proc;
  try {
    proc = spawn('ffmpeg', buildAudioExtractArgs(srcPath, tmpPath));
  } catch (e) {
    console.error(`music: failed to start ALAC transcode for ${srcPath}:`, e.message);
    musicTranscodeBusy = false;
    processMusicTranscodeQueue();
    return;
  }
  proc.stderr.on('data', () => { /* drain */ });
  proc.on('error', (e) => {
    console.error(`music: ALAC transcode process error for ${srcPath}:`, e.message);
    try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort */ }
    musicTranscodeBusy = false;
    processMusicTranscodeQueue();
  });
  proc.on('close', (code) => {
    musicTranscodeBusy = false;
    if (code === 0) {
      try { fs.renameSync(tmpPath, outPath); } catch (e) {
        console.error(`music: could not finalize ALAC rendition for ${srcPath}:`, e.message);
        try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort */ }
      }
    } else {
      console.error(`music: ALAC transcode failed (exit ${code}) for ${srcPath}`);
      try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort */ }
    }
    processMusicTranscodeQueue();
  });
}

// Resolve one album's art (best-effort, idempotent, never throws): embedded
// attached-pic via ffmpeg (re-encoded to a consistent .jpg), else a sidecar
// cover.jpg/folder.jpg/front.* copied verbatim. Skips entirely if the album
// already has an art file.
async function extractAlbumArt(job) {
  if (!job || typeof job.albumArtKey !== 'string') return;
  const jpgPath = path.join(ALBUMART_DIR, `${job.albumArtKey}.jpg`);
  const pngPath = path.join(ALBUMART_DIR, `${job.albumArtKey}.png`);
  if (fs.existsSync(jpgPath) || fs.existsSync(pngPath)) return; // idempotent
  try { fs.mkdirSync(ALBUMART_DIR, { recursive: true }); } catch (_) { /* best-effort */ }
  if (job.hasEmbeddedArt && ffmpegAvailable) {
    const tmp = `${jpgPath}.tmp.jpg`;
    const ok = await new Promise((resolve) => {
      execFile('ffmpeg', ['-v', 'error', '-i', job.sourceFilePath, '-an', '-map', '0:v:0', '-frames:v', '1', '-c:v', 'mjpeg', '-y', tmp], { maxBuffer: 16 * 1024 * 1024 }, (err) => resolve(!err));
    });
    if (ok) {
      try { fs.renameSync(tmp, jpgPath); return; } catch (_) { /* fall through to sidecar */ }
    }
    try { fs.unlinkSync(tmp); } catch (_) { /* best-effort */ }
  }
  const sidecar = musicScan.findSidecarArt(job.dir);
  if (sidecar) {
    const dest = path.extname(sidecar).toLowerCase() === '.png' ? pngPath : jpgPath;
    const tmp = `${dest}.tmp`;
    try {
      fs.copyFileSync(sidecar, tmp);
      fs.renameSync(tmp, dest);
    } catch (_) {
      try { fs.unlinkSync(tmp); } catch (_) { /* best-effort */ }
    }
  }
}

// Wave 7b (slice S3): ONE pass - the walk + probe, the merge, the per-user
// prune and the pruned tracks' art/rendition hygiene - moved VERBATIM to
// lib/music/scanRunner.js. scanMusic below is unchanged and stays here: it owns
// musicScanState, the single deferred rescan timer and the follow-up budget,
// and other callers (the media-scan timer, the boot path, the music routes) and
// the integration tests reach it through this file's exports. probeMusicTrack
// and extractAlbumArt stay above because they read the mutable `ffmpegAvailable`
// (see the module's header) - they cross as deps.
const musicScanRunner = require('./lib/music/scanRunner'); // Wave 7b R2: the require sits at its call site so parallel slices never touch the same hunk
const { runMusicScan } = musicScanRunner.createMusicScanRunner({
  ALBUMART_DIR,
  albumArtExists,
  audioPath,
  extractAlbumArt,
  fs,
  getMediaId,
  musicDb,
  musicScan,
  musicStore,
  path,
  probeMusicTrack,
  settingsStore,
  updateDatabase,
  userStore,
});

// Overlap/coalescing guard -- the scanBooks discipline verbatim (a scan
// requested mid-scan runs exactly one follow-up pass, never a concurrent
// second walker; a rescan requested during the final pass arms one deferred,
// unref'd, single-guarded re-entry).
async function scanMusic() {
  if (musicScanState.scanning) {
    musicScanState.rescanRequested = true;
    return;
  }
  musicScanState.scanning = true;
  try {
    let followups = 0;
    do {
      musicScanState.rescanRequested = false;
      await runMusicScan();
      followups++;
    } while (musicScanState.rescanRequested && followups <= MAX_RESCAN_FOLLOWUPS);
  } catch (err) {
    console.error('music: scan failed:', err);
  } finally {
    const stillPending = musicScanState.rescanRequested;
    musicScanState.scanning = false;
    musicScanState.lastScan = new Date().toISOString();
    if (stillPending && !deferredMusicRescanTimer) {
      deferredMusicRescanTimer = setTimeout(() => {
        deferredMusicRescanTimer = null;
        scanMusic().catch(console.error);
      }, 5000);
      deferredMusicRescanTimer.unref();
    }
  }
}

// Wave 7b (slice S3): the music HTTP surface - /api/music, /track, /albumart
// and /audio - moved VERBATIM to lib/music/routes.js, together with the two
// module-scope names the moved routes were the only referrers of
// (MUSIC_CONTENT_TYPES, musicArtPlaceholderSvg). The music routes are not one
// contiguous run, so they register in FOUR calls, each exactly where its own
// block's first route sat: this config/scan block, the read APIs below, the
// track/art block after slice S1a's userRoutes call, and /audio far below.
const musicRoutes = require('./lib/music/routes'); // Wave 7b R2: the require sits at its call site so parallel slices never touch the same hunk
musicRoutes.registerConfigRoutes(app, {
  DATA_DIR,
  booksDb,
  folderStore,
  foldersOverlap,
  fs,
  getCachedDatabase,
  musicDb,
  musicScanState, // the LIVE object (currentMusicScanState exports the same one)
  musicStore,
  path,
  podcasts,
  requireAdmin,
  requireModifyLibrary,
  scanMusic, // the overlap/coalescing guard, still this file's
  trackVisibleTo,
  tvDb,
  updateDatabase,
  visibleConfigRoots,
  ytdlpArgs,
});

// ---- Music: per-user progress coalescer (T8) --------------------------------
//
// A DEDICATED coalescer (never the video/book ones): the video flush filters
// on db.metadata and the book flush on db.books.items, but music ids live in
// db.music.tracks. Same >=5:1 write-amp contract (one transaction per flush
// window), same FK-poison guard (userStore.setMusicProgressBatch filters
// deleted users before the txn), same deleted-track guard (a flush must never
// resurrect progress for a pruned track). Staging key is `<userId>:<trackId>`
// (pendingProgressKey, shared).
const pendingMusicProgress = new Map();
let musicProgressFlushTimer = null;
let musicProgressFlushWriteCount = 0;
function __getMusicProgressFlushWriteCount() {
  return musicProgressFlushWriteCount;
}
function currentMusicProgressFlushTimer() {
  return musicProgressFlushTimer;
}
function flushPendingMusicProgress() {
  if (musicProgressFlushTimer) {
    clearTimeout(musicProgressFlushTimer);
    musicProgressFlushTimer = null;
  }
  if (pendingMusicProgress.size === 0) return Promise.resolve(false);
  const snapshot = [...pendingMusicProgress.values()];
  pendingMusicProgress.clear();
  return updateDatabase((db) => {
    const ns = musicDb.read();
    // Deleted-between-ping-and-flush guard (OWN-property, the __proto__ lesson):
    // never resurrect progress for a pruned track.
    const rows = snapshot.filter((entry) => Object.prototype.hasOwnProperty.call(ns.tracks, entry.trackId));
    if (rows.length > 0) {
      userStore.setMusicProgressBatch(rows);
      musicProgressFlushWriteCount++;
    }
    return false; // per-user rows only -- never a doc-table write from a flush
  }).then(() => true).catch((err) => {
    console.error('Error flushing batched music progress:', err);
  });
}
function armMusicProgressFlushTimerIfNeeded() {
  if (musicProgressFlushTimer) return;
  musicProgressFlushTimer = setTimeout(flushPendingMusicProgress, PROGRESS_FLUSH_MS);
  musicProgressFlushTimer.unref();
}
// Read-your-writes overlay: pending first, then the committed user_music_progress row.
function effectiveMusicProgress(userId, id) {
  const pending = pendingMusicProgress.get(pendingProgressKey(userId, id));
  if (pending) return pending.value;
  return userStore.getOneMusicProgress(userId, id);
}

// ---- Music: read APIs + track/art serving (T6) ------------------------------

// OWN-property track lookup (gate ADV-WARNING-2): a bare `tracks[id]` treats
// inherited Object.prototype keys ('__proto__'/'constructor'/'toString') as
// existing tracks, so a crafted id would pass every route's existence check
// and write a junk per-user row that then rides the backup. Every music route
// resolves a track through this, mirroring the video like route's
// hasOwnProperty guard and the coalescer's own deleted-track filter.
function ownTrack(tracks, id) {
  return Object.prototype.hasOwnProperty.call(tracks, id) ? tracks[id] : undefined;
}

// The public list-item shape for a track: the track record plus this user's
// liked flag and resume position (per-user, keyed by req.user.id -- never the
// frozen doc record). filePath is deliberately NOT surfaced (path scrub).
function publicTrackListItem(track, userId, likedSet, progressMap) {
  const liked = likedSet ? likedSet.has(track.id) : false;
  const prog = progressMap ? progressMap[track.id] : null;
  // Wave G: a PROJECTED library-audio track (source 'library') streams the mp3
  // from the media byte route, arts from its YouTube thumbnail, and saves
  // progress to the MEDIA store - so it carries its own routes + a source marker
  // for the client's loadTrack to branch on, and its art/transcode flags come
  // from the media item, NOT the music-namespace albumart/codec paths.
  // v1.221: a chapter-track (source 'library-chapter') is a library track too - it
  // needs the same media-route markers, plus its chapterStartSec seek offset.
  const isLib = track.source === 'library' || track.source === 'library-chapter';
  const isChapter = track.source === 'library-chapter';
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    trackNo: track.trackNo,
    discNo: track.discNo,
    durationSec: track.durationSec,
    year: track.year,
    genre: track.genre,
    ext: track.ext,
    folderName: track.folderName,
    // v1.44.2: the composite album grouping key (derived, not stored) — the
    // client needs it to drill into a track's album from the "Playing from
    // <Album>" line (the album/artist drill filters on this exact key).
    albumKey: musicStore.albumKeyFor(track),
    albumArtKey: track.albumArtKey,
    // A library track's art is its media thumbnail (served via /albumart/:id ->
    // thumbnail fallback); a native track's is the extracted album-art file.
    hasArt: isLib ? !!track.hasEmbeddedArt : !!(track.albumArtKey && albumArtExists(track.albumArtKey)),
    // Gate QA-CRITICAL: the client keys its transcode-prewarm poll off this,
    // so an ALAC track's first play waits for the rendition instead of
    // silently failing on the /track/:id 503. A library track never uses the
    // /track prewarm path (it streams from /video), so it never prewarms.
    needsTranscode: isLib ? false : musicCodecNeedsTranscode(track.codec),
    liked,
    // v1.222: resumeSec (absolute file position) rides a chapter's progress so a
    // resume-tap seeks there, not to the chapter head.
    progress: prog ? Object.assign({ position: prog.position, duration: prog.duration, updatedAt: prog.updatedAt }, typeof prog.resumeSec === 'number' ? { resumeSec: prog.resumeSec } : {}) : null,
    // The projection markers (absent on native tracks): the client's loadTrack
    // prefers these routes over the /track,/albumart,/api/music/progress
    // defaults.
    ...(isLib ? {
      source: track.source, // 'library' or 'library-chapter'
      streamSrc: track.streamSrc,
      artUrl: track.artUrl,
      progressEndpoint: track.progressEndpoint,
    } : {}),
    // v1.221: the seek offset for a virtual chapter-track (the client seeks the
    // one file here on play; absent on a plain track).
    ...(isChapter ? { chapterStartSec: track.chapterStartSec } : {}),
  };
}

// Wave G / v1.242: the projected library-audio tracks this user sees in Music.
// UNCONDITIONAL now (the opt-in master toggle is retired): every db.metadata audio
// item is eligible UNLESS its channel is explicitly marked 'off', passes the MEDIA
// visibility gate (NOT trackVisibleTo - these are media items, a distinct restriction
// kind), and does not collide with a native music-track id (dedup: the real track wins), is
// shaped into a music-track record. `nativeTracks` is the already-RBAC-filtered
// native list, so the dedup set only holds ids this user may already see.
function projectedLibraryTracks(req, nativeTracks) {
  // v1.242 (Dean): audio-only items project into Music UNCONDITIONALLY - no per-user
  // opt-in (the old default-OFF `musicIncludesLibrary` gate is retired), no genre/majority
  // heuristic. Every `type:'audio'` item is in Music unless its channel is explicitly
  // marked 'off'. Instant + library-wide (this reads db.metadata live). RBAC (mediaVisibleTo)
  // below is UNCHANGED, so a restricted user still cannot see hidden audio.
  const db = getCachedDatabase();
  const ytView = ytdlpDb.holder(['subscriptions', 'channelAvatars']); // Wave 5: the avatar registry + subscriptions, ONE read per request (resolveItemChannelAvatarUrl is read-only)
  const marks = musicDb.readPart('channels'); // Wave 5: the music_channels table (one table, not four)
  const allAudio = Object.values(db.metadata || {}).filter((it) => it && it.type === 'audio');
  const nativeIds = new Set(nativeTracks.map((t) => t.id));
  const out = [];
  for (const item of allAudio) {
    if (!libraryAudio.isEligibleAudioUniversal(item, marks)) continue; // audio, unless channel opted-out
    if (!mediaVisibleTo(req, item)) continue; // the MEDIA gate (RBAC) - unchanged
    if (nativeIds.has(item.id)) continue; // a file in both roots: the native track wins
    // v1.221 chapter-albums: a chaptered file expands into one virtual track per
    // chapter (else a single track). resolveChapters is server.js's own resolver
    // (embedded|manual|description); the chapter-tracks share the file's title as
    // their album, so groupAlbums folds them into one Album.
    const tracks = libraryAudio.expandAudioToTracks(item, (it) => resolveItemChapters(it).chapters);
    // Music redesign Slice 1: carry the channel avatar so the artist circle has a
    // real picture (the resolver is READ-ONLY: item -> channelId registry ->
    // subscription). Native music tracks have no channel, so no avatar.
    const avatarUrl = ytdlp.resolveItemChannelAvatarUrl(ytView, item) || '';
    for (const track of tracks) { track.avatarUrl = avatarUrl; out.push(track); }
  }
  return out;
}

// v1.215 (Dean's device pass on v1.214): a PROJECTED library track saves its
// position to the MEDIA store - its progressEndpoint is '/api/progress', not
// '/api/music/progress' (v1.210 unified its resume with the feed). So its resume
// position AND its "recent-listening" membership have to be read from getProgress
// (the media store) and normalized to the music {position,duration,updatedAt}
// shape; native tracks stay on getMusicProgress. Both stores get their pending
// in-memory writes overlaid (read-your-writes, mirroring the /api/videos
// recent readers) so a track the user JUST played is present before the periodic
// flush. Before this, a played library artist (Dean's NESTALGIA) never showed up
// in "Recently played" / "Jump back in" - those tracks' positions were in the
// media store, invisible to the music-store-only recent filter.
function musicListProgressMap(userId, tracks) {
  const music = userStore.getMusicProgress(userId); // fresh object; safe to mutate
  for (const [, e] of pendingMusicProgress) { if (e.userId === userId) music[e.trackId] = e.value; }
  const media = userStore.getProgress(userId); // fresh object; safe to mutate
  for (const [, e] of pendingProgress) { if (e.userId === userId) media[e.mediaId] = e.value; }
  // Null-proto merge target, matching the source maps' own contract (store.js):
  // a hostile track/media id of literally '__proto__' (smuggled via a crafted
  // restore bundle) assigns an OWN key here instead of reparenting `out`.
  const out = Object.create(null);
  for (const t of tracks) {
    if (t.source === 'library-chapter') {
      // v1.222: a CHAPTER play saves to the MEDIA store under the BASE file id at
      // the file-absolute position (the whole file plays, seeked to the chapter).
      // Surface progress on ONLY the chapter whose [start, start+span) CONTAINS
      // that position - so a file's N chapters collapse to ONE recent-listening
      // entry (the "chapter you were in"), its bar shows the WITHIN-chapter offset,
      // and resumeSec carries the absolute file position for a resume-tap.
      const baseId = String(t.id).replace(/::c\d+$/, '');
      const m = media[baseId];
      if (m) {
        const abs = Number(m.timestamp) || 0;
        const start = Number(t.chapterStartSec) || 0;
        const span = Number(t.durationSec) || 0;
        const end = span > 0 ? start + span : Infinity;
        if (abs >= start && abs < end) {
          out[t.id] = { position: abs - start, duration: span, updatedAt: m.updatedAt, resumeSec: abs };
        }
      }
    } else if (t.source === 'library') {
      const m = media[t.id];
      if (m) out[t.id] = { position: m.timestamp, duration: m.duration, updatedAt: m.updatedAt };
    } else {
      const p = music[t.id];
      if (p) out[t.id] = p;
    }
  }
  return out;
}

// Wave 7b (slice S3): the music read APIs through POST /api/music/resume,
// moved VERBATIM to lib/music/routes.js and registering here, where GET
// /api/music sat. publicTrackListItem, musicListProgressMap,
// projectedLibraryTracks and ownTrack stay above (two register blocks and,
// for the last two, /api/search + /api/home read them) and cross as deps.
musicRoutes.registerLibraryRoutes(app, {
  folderDisplayNameStore,
  getCachedDatabase,
  libraryAudio,
  mediaVisibleTo,
  musicDb,
  musicListProgressMap,
  musicQuery,
  ownTrack,
  projectedLibraryTracks,
  publicTrackListItem,
  trackVisibleTo,
  userStore,
  videoQuery,
});

// ---- the per-user state routes ----------------------------------------------
// Wave 7b (slice S1a): the per-user state routes - /api/prefs, /api/watched,
// /api/feed-hidden, /api/history, /api/search-history - moved VERBATIM to
// lib/user/routes.js and register from here, in their original source order.
// The prefs allowlist binding and the search-history cap +
// normalizeSearchTerm moved with them (the routes were their only readers);
// server.js still re-exports normalizeSearchTerm as the SAME function object.
userRoutes.registerRoutes(app, {
  getCachedDatabase,
  mediaVisibleTo,
  // The progress coalescer's staging Map + its key builder: the history and
  // feed-hidden reads overlay not-yet-flushed pings (read-your-writes) and
  // the history/watched deletes purge them in the same synchronous handler.
  pendingProgress,
  pendingProgressKey,
  resolveModernGridItem, // the modern-grid projection GET /api/feed-hidden renders through
  restrictedVideoMutation, // v1.80 RBAC (S-b): no restricted-id oracle, no persist
  userStore,
  videoQuery, // normalizeLimit/normalizeOffset/deriveWatchState for the history page
  ytdlp, // resolveItemChannelAvatarUrl for the history cards
  ytdlpDb,
});

// Wave 7b (slice S3): the progress ping, the track detail and the /track +
// /albumart byte routes, moved VERBATIM to lib/music/routes.js and registering
// here, where POST /api/music/progress sat - after the S1a user-state routes
// above, whose registration splits the music surface in two.
musicRoutes.registerTrackRoutes(app, {
  ALBUMART_DIR,
  THUMBNAIL_DIR,
  armMusicProgressFlushTimerIfNeeded, // assigns this file's musicProgressFlushTimer
  audioPath,
  contentDispositionAttachment,
  effectiveMusicProgress,
  escapeHtml,
  fs,
  getCachedDatabase,
  mediaVisibleTo,
  musicCodecNeedsTranscode,
  musicDb,
  musicListProgressMap,
  ownTrack,
  path,
  pendingMusicProgress,
  pendingProgressKey,
  projectedLibraryTracks,
  publicTrackListItem,
  queueMusicTranscode,
  recordPresenceFromPing,
  sendRangeable,
  trackVisibleTo,
  userStore,
});

// ---- TV Shows library (v1.195) ----------------------------------------------
//
// A first-class media type (UI "Shows") over a Plex-shaped folder tree
// <root>/<Show>/<Season N|Specials>/<Show SxxEyy - Title>. The db.tv namespace is
// feature-owned by lib/tv/store.js (the persist-gate discipline); the pure walk +
// parse + grouping live in lib/tv/{scan,parse}.js. Episodes ARE video files and
// stream/transcode through the EXISTING video pipeline (a later phase) - only the
// browse/organization layer is new. Everything degrades to a no-op on a Shows-less
// install (zero folders + zero episodes = zero scans = zero db writes).

const tvScanState = { scanning: false, lastScan: null, rescanRequested: false };
let deferredTvRescanTimer = null;
function currentTvScanState() { return tvScanState; }

// The injected ffprobe probe (server-side spawn; lib/tv/scan.js stays CI-testable
// by never spawning itself). Yields duration (episode length + the thumbnail
// timestamp), the video codec, and the container. Degrade-safe: null on
// ffmpeg-unavailable or any parse error (the episode still indexes by filename).
function probeTvEpisode(filePath) {
  return new Promise((resolve) => {
    if (!ffmpegAvailable) { resolve(null); return; }
    execFile('ffprobe', buildFfprobeArgs(filePath), { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) { resolve(null); return; }
      let parsed;
      try { parsed = JSON.parse(stdout); } catch (_) { resolve(null); return; }
      let streams = {};
      try { streams = parseFfprobeStreams(parsed); } catch (_) { streams = {}; }
      let durationSec = 0;
      const d = parsed && parsed.format && Number(parsed.format.duration);
      if (Number.isFinite(d) && d > 0) durationSec = d;
      const container = (parsed && parsed.format && typeof parsed.format.format_name === 'string') ? parsed.format.format_name : null;
      // v1.195 (gate): audioCodec too, so the serve route's needsTranscode() can
      // be CODEC-aware like the main video path - an HEVC-video or AC3/DTS-audio
      // file in a browser-native container (.mp4/.mov) must still transcode.
      resolve({ durationSec, codec: streams.videoCodec || null, audioCodec: streams.audioCodec || null, container });
    });
  });
}

function tvThumbPath(id) { return path.join(TV_THUMB_DIR, `${id}.jpg`); }
function tvThumbExists(id) { return fs.existsSync(tvThumbPath(id)); }

// One ffmpeg frame grab per episode (the video-library storyboard posture: a
// single -vframes 1 at a modest offset, atomic tmp+rename). Best-effort - a
// failed grab just leaves the episode with the generated-poster fallback.
function extractTvThumb(job) {
  return new Promise((resolve) => {
    if (!ffmpegAvailable) { resolve(false); return; }
    const src = job && job.filePath;
    const id = job && job.id;
    if (!src || !id || !fs.existsSync(src)) { resolve(false); return; }
    const outPath = tvThumbPath(id);
    if (fs.existsSync(outPath)) { resolve(true); return; }
    try { fs.mkdirSync(TV_THUMB_DIR, { recursive: true }); } catch (_) { /* best-effort */ }
    const tmpPath = `${outPath}.tmp.jpg`;
    const ts = (Number.isFinite(job.durationSec) && job.durationSec > 20) ? Math.min(60, Math.round(job.durationSec * 0.1)) : 5;
    execFile('ffmpeg', ['-ss', String(ts), '-i', src, '-vframes', '1', '-q:v', '2', '-y', tmpPath], (err) => {
      if (err) { try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort */ } resolve(false); return; }
      try { fs.renameSync(tmpPath, outPath); resolve(true); }
      catch (_) { try { fs.unlinkSync(tmpPath); } catch (_2) { /* best-effort */ } resolve(false); }
    });
  });
}

// Wave 7b (slice S4): ONE pass - the walk, the merge, the prune carriers and
// the thumbnail hygiene - moved VERBATIM to lib/tv/scanRunner.js. scanTv below
// is unchanged and stays here: it owns tvScanState, the single deferred rescan
// timer and the follow-up budget, and the media scan's timer, the boot path and
// this file's exports all reach the scan through it.
const tvScanRunner = require('./lib/tv/scanRunner'); // Wave 7b S4: the module's require sits at its call site so parallel slices never touch the same hunk
const { runTvScan } = tvScanRunner.createTvScanRunner({
  extractTvThumb,
  fs,
  getMediaId,
  probeTvEpisode,
  settingsStore,
  tvDb,
  tvScan,
  tvStore,
  tvThumbExists,
  tvThumbPath,
  updateDatabase,
  userStore,
});

// Overlap/coalescing guard -- the scanMusic discipline verbatim.
async function scanTv() {
  if (tvScanState.scanning) { tvScanState.rescanRequested = true; return; }
  tvScanState.scanning = true;
  try {
    let followups = 0;
    do {
      tvScanState.rescanRequested = false;
      await runTvScan();
      followups++;
    } while (tvScanState.rescanRequested && followups <= MAX_RESCAN_FOLLOWUPS);
  } catch (err) {
    console.error('tv: scan failed:', err);
  } finally {
    const stillPending = tvScanState.rescanRequested;
    tvScanState.scanning = false;
    tvScanState.lastScan = new Date().toISOString();
    if (stillPending && !deferredTvRescanTimer) {
      deferredTvRescanTimer = setTimeout(() => {
        deferredTvRescanTimer = null;
        scanTv().catch(console.error);
      }, 5000);
      deferredTvRescanTimer.unref();
    }
  }
}

// v1.195: two resolved absolute roots overlap if identical or one nests the other
// (either direction). The shared both-directions test for the library-root
// ownership net - the tv config route AND the reciprocal clauses in the
// media/book/music/podcast config routes all call THIS one helper.
function foldersOverlap(a, b) {
  return a === b || ytdlpArgs.isPathUnder(a, b) || ytdlpArgs.isPathUnder(b, a);
}

const tvRoutes = require('./lib/tv/routes'); // Wave 7b S4: the module's require sits at its call site so parallel slices never touch the same hunk
tvRoutes.registerRoutes(app, {
  DATA_DIR,
  TRANSCODE_CRF,
  TRANSCODE_DIR, // the SHARED transcode cache the tv renditions + sidecars live in
  booksDb,
  buildAudioExtractArgs, // reused unchanged by the tv audio lane
  contentDispositionAttachment,
  escapeHtml,
  // The mutable seam: ffmpegAvailable is a `let` an async boot probe flips long
  // after this call, so it crosses as a LIVE reader, never as a boot-time value.
  ffmpegIsAvailable: () => ffmpegAvailable,
  folderStore,
  foldersOverlap, // the shared both-directions root-overlap test
  fs,
  getCachedDatabase,
  markServed, // protects an actively-streaming rendition/sidecar from a cache sweep
  musicDb,
  needsTranscode,
  path,
  podcasts,
  requireAdmin,
  requireModifyLibrary,
  scanTv, // the overlap/coalescing scan guard - still this file's
  sendRangeable,
  spawn,
  tvDb,
  tvEpisodeVisibleTo, // v1.195 RBAC: the single visibility decision for an episode
  tvParse,
  tvScan,
  tvScanState, // the LIVE scan-state object (currentTvScanState exports the same one)
  tvStore,
  tvThumbPath, // shared with the scan pass (lib/tv/scanRunner.js)
  updateDatabase,
  userStore,
  videoQuery,
  visibleConfigRoots,
  visibleTvEpisodes, // shared with GET /api/search
});

// The visible-episode array for the requester (the SINGLE visibility decision).
function visibleTvEpisodes(req) {
  const ns = tvDb.read();
  return Object.values(ns.episodes || {}).filter((ep) => tvEpisodeVisibleTo(req, ep));
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

// v1.89: the BUNDLED default banner logo, shipped in the image (under public/,
// which the Dockerfile copies) so every install shows the FileTube banner out
// of the box instead of the plain text wordmark. dark mode -> the white-text
// banner (legible on a dark header); light mode -> the black-text banner. A
// user's Settings->Logo upload still fully overrides this (see GET /logo: the
// default only fills the no-upload case); the text wordmark now survives only
// as the missing-asset safety fallback. PNG, so the mime is fixed.
const DEFAULT_LOGO_DIR = path.join(__dirname, 'public', 'assets', 'brand');
function defaultLogoPath(variant) {
  return path.join(DEFAULT_LOGO_DIR, variant === 'dark' ? 'filetube-banner-white.png' : 'filetube-banner-black.png');
}
// v1.89: stream the bundled default banner for `variant` (always PNG). Returns
// false (having sent nothing) if the shipped asset can't be read, so callers
// 404 and the client degrades to the text wordmark. Same defense-in-depth
// nosniff/no-cache headers as the uploaded-logo path.
// The bytes are memoized per variant (slim-gate S2): the default banners are
// IMMUTABLE bundled assets, so a single read per variant replaces the
// per-request readFileSync that /logo (HEAD+GET on every page load) would
// otherwise incur on every default install. A read failure is not cached, so a
// transiently-unreadable asset self-heals on a later hit.
const defaultLogoBytesCache = new Map(); // 'light' | 'dark' -> Buffer
function serveDefaultLogo(res, variant) {
  try {
    let bytes = defaultLogoBytesCache.get(variant);
    if (!bytes) {
      bytes = fs.readFileSync(defaultLogoPath(variant));
      defaultLogoBytesCache.set(variant, bytes);
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(bytes);
    return true;
  } catch (err) {
    console.error('Error serving default logo (falling through to text wordmark):', err && err.message);
    return false;
  }
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
  // v1.33.1: variant-aware with CROSS-FALLBACK -- ?variant=dark serves the
  // dark logo when set, else the light one; the plain /logo (light) likewise
  // falls back to a dark-only upload. "If only one is uploaded it is used
  // for both" (Dean).
  // v1.89: when NEITHER variant is uploaded, serve the BUNDLED default banner
  // for the requested variant (both default variants ship, so no cross-fallback
  // needed there) -- the header shows the FileTube banner out of the box. A
  // user upload still fully overrides. 404 only if even the shipped asset is
  // unreadable, which makes the client degrade to the text wordmark.
  const requested = resolveLogoVariant(req.query.variant);
  const fallback = requested === 'dark' ? 'light' : 'dark';
  const mimeFor = (v) => {
    const stored = settingsStore.getKey(customLogoMimeKey(v)); // Wave 4
    const m = typeof stored === 'string' ? stored : '';
    return m && Object.prototype.hasOwnProperty.call(CUSTOM_LOGO_TYPES, m) ? m : '';
  };
  let variant = requested;
  let mime = mimeFor(requested);
  if (!mime) {
    variant = fallback;
    mime = mimeFor(fallback);
  }
  if (!mime) {
    if (serveDefaultLogo(res, requested)) return;
    return res.status(404).json({ error: 'No logo available' });
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
    // The upload setting says yes but the bytes are gone (manual deletion,
    // restored database without the data file) -- v1.89: fall back to the
    // bundled default banner rather than a bare 404, so the header still
    // shows a logo; only 404 (text wordmark) if the default is also gone.
    console.error('Error serving custom logo (falling back to default banner):', err && err.message);
    if (serveDefaultLogo(res, requested)) return;
    return res.status(404).json({ error: 'No logo available' });
  }
});

// Wave 7b (slice S10b): the custom-logo upload + reset moved VERBATIM to
// lib/config/routes.js. GET /logo stays here (its own route group), and so do
// the logo helpers above - that route reads them too.
configRoutes.registerLogoSettingsRoutes(app, {
  CUSTOM_LOGO_MAX_BYTES,
  CUSTOM_LOGO_TYPES,
  customLogoMimeKey,
  customLogoPath,
  express, // only for express.raw on the logo upload
  fs,
  inSaveTransaction,
  requireAdmin,
  resolveLogoVariant,
  settingsStore,
  updateDatabase,
});

// ---- v1.82: per-user profile avatar -----------------------------------------
// Disk-only, mirroring the custom-logo upload/serve pattern above, but PER USER
// and with NO persisted metadata (so no schema/settings change): the file's
// presence IS the state, its mtime is the cache-bust version, and the serve
// route sniffs the real mime from magic bytes. An unset avatar -> the client
// renders an initials monogram. Wave 7b (slice S1b): the three routes moved to
// lib/auth/routes.js (registerAvatarRoutes, called below); these constants and
// helpers stayed here because AVATARS_DIR has a reader outside the group
// (POST /api/admin/restore), and splitting one file's machinery across two
// would leave the directory constant defined in both.
const AVATAR_MAX_BYTES = 1024 * 1024;
const AVATARS_DIR = path.join(DATA_DIR, 'avatars');
// Own allowlist + magic-byte sniffers (an intentional copy of the logo's, per
// the same "let the two features diverge" note at CUSTOM_LOGO_TYPES): a profile
// photo and the instance logo are unrelated.
const AVATAR_TYPES = {
  'image/png': (buf) => buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47,
  'image/jpeg': (buf) => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  'image/webp': (buf) => buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP',
};
function avatarPath(userId) {
  // userId is always a validated positive integer at every call site, so the
  // join can never traverse out of AVATARS_DIR.
  return path.join(AVATARS_DIR, `${userId}.bin`);
}
// Presence + an mtime the client cache-busts the <img> with (?v=<version>).
function avatarInfo(userId) {
  try {
    const st = fs.statSync(avatarPath(userId));
    return { present: true, version: Math.floor(st.mtimeMs) };
  } catch {
    return { present: false, version: 0 };
  }
}
function sniffAvatarMime(buf) {
  for (const mime of Object.keys(AVATAR_TYPES)) {
    if (AVATAR_TYPES[mime](buf)) return mime;
  }
  return null;
}
// Remove a user's avatar file - called on the user-delete cascade so a reaped
// (and never-reused) id leaves no orphaned image. Best-effort.
function unlinkAvatar(userId) {
  try { fs.unlinkSync(avatarPath(userId)); } catch { /* absent -- fine */ }
}

// Wave 7b (slice S1b): the profile-photo routes - GET /api/users/:id/avatar,
// POST|DELETE /api/me/avatar - moved VERBATIM to lib/auth/routes.js. They
// register HERE, behind the shell wildcard and the static layer, because that
// is where they have always been; the helpers and constants above stayed and
// cross in through deps.
authRoutes.registerAvatarRoutes(app, {
  AVATARS_DIR,
  AVATAR_MAX_BYTES,
  AVATAR_TYPES, // the mime allowlist AND its magic-byte sniffers
  avatarInfo,
  avatarPath,
  express, // express.raw - the upload parser, built at REGISTRATION time
  fs,
  sniffAvatarMime,
  unlinkAvatar,
});

// ---- v1.238: per-user custom PLAYER STICKER (the speed-menu sticker icon) ----
// A deliberate second copy of the avatar machinery above, not a shared helper:
// the sticker and the profile photo are unrelated features that happen to share
// an upload shape, and the "v1.82: per-user profile avatar" header above in
// this file already documents WHY these diverge rather than fold (a line
// number would rot - Wave 7b moved this code once already). Same properties:
// PER USER, self-service (no by-id
// write route -> a member can only set THEIR OWN), disk-only (presence IS the
// state, mtime is the cache-bust version, no persisted db metadata -> no schema
// bump and, like avatars, NOT carried in the backup bundle), mime sniffed from
// magic bytes on serve. The device-local `ft-sticker` choice decides logo vs
// preset vs emoji vs THIS custom image; an unset/deleted file -> the client
// falls back to whatever `ft-sticker` names (default: the FileTube logo).
// Wave 7b (slice S1b): the three routes moved to lib/auth/routes.js
// (registerStickerRoutes, called below); these constants and helpers stayed,
// keeping this copy symmetric with the avatar machinery above.
const STICKER_MAX_BYTES = 1024 * 1024;
const STICKERS_DIR = path.join(DATA_DIR, 'stickers');
// Own allowlist + magic-byte sniffers (SVG is deliberately excluded - an inline
// SVG is a script-injection vector, and the sticker is rendered as an <img>).
const STICKER_TYPES = {
  'image/png': (buf) => buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47,
  'image/jpeg': (buf) => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  'image/webp': (buf) => buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP',
};
function stickerPath(userId) {
  // userId is always a validated positive integer at every call site, so the
  // join can never traverse out of STICKERS_DIR.
  return path.join(STICKERS_DIR, `${userId}.bin`);
}
function stickerInfo(userId) {
  try {
    const st = fs.statSync(stickerPath(userId));
    return { present: true, version: Math.floor(st.mtimeMs) };
  } catch {
    return { present: false, version: 0 };
  }
}
function sniffStickerMime(buf) {
  for (const mime of Object.keys(STICKER_TYPES)) {
    if (STICKER_TYPES[mime](buf)) return mime;
  }
  return null;
}
// Reaped on the user-delete cascade so a never-reused id leaves no orphan.
function unlinkSticker(userId) {
  try { fs.unlinkSync(stickerPath(userId)); } catch { /* absent -- fine */ }
}

// Wave 7b (slice S1b): the player-sticker routes - GET|POST|DELETE
// /api/me/sticker - moved VERBATIM to lib/auth/routes.js, registering here for
// the same reason the avatar routes do (their original position behind the
// shell wildcard, and after the sticker constants above).
authRoutes.registerStickerRoutes(app, {
  STICKERS_DIR,
  STICKER_MAX_BYTES,
  STICKER_TYPES, // the mime allowlist AND its magic-byte sniffers (no SVG)
  express, // express.raw - the upload parser, built at REGISTRATION time
  fs,
  sniffStickerMime,
  stickerInfo,
  stickerPath,
  unlinkSticker,
});

// ---- v1.42: instance backup / restore ---------------------------------------
// Wave 7b (slice S7): the WHOLE machinery - GET /api/admin/backup, POST
// /api/admin/restore, validateBackupBundle, validateFeatureBundle, the three
// bundle-format constants (BACKUP_SCHEMA, BACKUP_NAMESPACE_KEYS,
// RELATIONAL_BUNDLE_KEYS - the two routes and the validator were their only
// referrers, by espree census and by grep over lib/ test/ scripts/), the
// mid-populate test seam (its `let` and its setter travel together: both of
// its touch points are in the slice) and the pure store-only zip builder that
// sat ~4,800 lines below - moved VERBATIM to lib/admin/backup.js. Nothing of
// the bundle format is left here.
//
// The restore route is the file's one true data-loss surface (it wipes every
// table inside one transaction), so the ORDER is the contract, not a detail:
// every validator still runs BEFORE the wipe. registerRoutes sits exactly
// where GET /api/admin/backup was and nothing was registered between the two
// routes, so one call reproduces the stack.
//
// The two names the module exports DIRECTLY are the two this file exported
// before the move - buildStoreZip (also handed to the critter-pool download
// route below) and the mid-populate test seam's setter - so both keep being the
// SAME function objects, provably by object identity rather than by source
// text. validateFeatureBundle is NOT destructured: server.js never exported it
// and validateBackupBundle is its only caller.
const adminBackup = require('./lib/admin/backup');
const { buildStoreZip, __failNextRestorePopulateForTests } = adminBackup;
const { validateBackupBundle } = adminBackup.createBackup({
  CUSTOM_LOGO_MAX_BYTES, // restore is the SECOND write path to the logo: same cap,
  CUSTOM_LOGO_TYPES,     // same magic-byte sniffers as the upload route's
  TRASH_DIR_NAME, // the trash records' path confinement (v1.65 gate fix C2)
  TRASH_RETENTION_DAYS_VALID_VALUES, // the retention enum the sweep also clamps
  path,
  sqliteDb, // FEATURE_DEFS: the per-container part specs validateFeatureBundle walks
  userStore, // validateUsername, over the bundle's account set
});
adminBackup.registerRoutes(app, {
  APP_VERSION,
  AVATARS_DIR, // a users-replacing restore wipes every stored avatar (v1.82 S4)
  booksDb,
  contentDispositionAttachment,
  customLogoMimeKey,
  customLogoPath,
  express, // express.json({ limit: '32mb' }) - the route-scoped bundle parser, built at REGISTRATION time
  folderDisplayNameStore,
  folderSettingsStore,
  folderStore,
  formatBodyParserError, // the route-scoped 4-arg handler's mapping (the global one can never reach this route)
  fs,
  issueSessionCookie, // re-issued against the RESTORED admin row
  likedStore,
  musicDb,
  podcastsDb,
  progressStore,
  replacePersistedState, // the exclusive wipe-and-repopulate transaction
  requireAdmin,
  settingsStore,
  sqliteDb, // importParsedJson, inside that same transaction
  tombstoneStore,
  trashStore,
  tvDb,
  updateDatabase,
  userStore,
  validateBackupBundle, // from the factory above - it runs BEFORE the wipe
  viewCountStore,
  ytdlpDb,
});

// Wave 7b (slice S10b): GET + POST /api/settings moved VERBATIM to
// lib/config/routes.js, together with settingsResponse (the shape both
// return) and validateTranscriptAiPrompts + its three shape constants - the
// routes were their only referrers. The four enum allowlists stay here: two
// of the four have readers outside the slice.
configRoutes.registerSettingsRoutes(app, {
  CACHE_MAX_AGE_DAYS_VALID_VALUES,
  DEFAULT_SETTINGS, // settingsResponse's transcriptAiPrompts fallback
  SCAN_INTERVAL_VALID_VALUES,
  TRASH_RETENTION_DAYS_VALID_VALUES,
  VALID_DEFAULT_SORTS,
  armScanTimer, // re-arms the periodic scan when the interval changes
  effectiveCacheCap, // settingsResponse's read-only effectiveCacheMaxBytes
  inSaveTransaction,
  requireAdmin,
  settingsStore,
  updateDatabase,
});

// ---- v1.51: the notification bell -----------------------------------------
//
// Visibility rule (exec-plan decision 9): yt-dlp module enabled AND at least
// one subscription AND the instance-wide settings toggle on. Disabled means
// 404 on every bell endpoint -- the client's boot probe (its first badge
// fetch) then injects nothing, the same fail-closed 2xx-probe posture as the
// subscriptions nav link. GENERATION is deliberately not gated here (the
// feed keeps accumulating while the bell is off -- decision 8); this gate is
// about what a browser can see.
function notificationsFeatureEnabled(_db) {
  if (!ytdlp.isEnabled(ytdlp.parseYtdlpConfig())) return false;
  const subs = ytdlpDb.readPart('subscriptions'); // Wave 5: from its table (one point query)
  if (subs.length < 1) return false;
  return settingsStore.getKey('notificationsEnabled') !== false; // Wave 4
}

// ---- the bell, web push and the playback queue ------------------------------
// Wave 7b (slice S1a): these three route groups moved VERBATIM to
// lib/notifications/routes.js, lib/push/routes.js and lib/queue/routes.js and
// register from here, in their original order. notificationsFeatureEnabled
// (above) stayed in server.js - the push delivery bundle reads it too - and
// crosses as the SAME function object to both modules.
notificationsRoutes.registerRoutes(app, {
  getCachedDatabase,
  mediaVisibleTo,
  notificationsFeatureEnabled,
  podcastEpisodeVisibleTo,
  podcastsDb,
  resolveItemChapters, // the panel's chapterCount for audio rows
  trashStore, // the panel filters rows whose media is in the trash
  userStore,
  ytdlp, // resolveItemChannelAvatarUrl + the engine-row shaping
  ytdlpDb,
});

pushRoutes.registerRoutes(app, {
  PUSH_VAPID,
  getCachedDatabase,
  notificationsFeatureEnabled,
  // A live READER, not the value: __setPushGuardLookupForTests reassigns this
  // `let` long after the routes register, so destructuring the value would
  // freeze the subscribe route's SSRF-guard seam to its boot-time null.
  pushGuardLookup: () => pushGuardLookupOverride,
  pushShortlink,
  userStore,
});

queueRoutes.registerRoutes(app, {
  getCachedDatabase,
  mediaVisibleTo,
  musicDb,
  ownTrack, // the OWN-property track lookup shapedQueue uses (shared with the music routes)
  podcastEpisodeVisibleTo,
  podcastsDb,
  queueStore,
  trackVisibleTo,
  userStore,
});

// Wave 7b (slice S10b): the transcode-cache size read and "Clear cache now"
// moved VERBATIM to lib/config/routes.js. The cache machinery they call
// (transcodeCacheSize, effectiveCacheCap, activeProtectedPaths,
// clearAudioStatus, the in-flight/completed predicates) stays here - it is the
// transcode queues' own, and crosses as deps.
configRoutes.registerCacheRoutes(app, {
  ROKU_COMPAT_DIR,
  TRANSCODE_DIR,
  TTS_CACHE_DIR,
  activeProtectedPaths, // the recently-served set a clear must never yank a file out of
  booksDb,
  booksStore,
  clearAudioStatus,
  effectiveCacheCap,
  fs,
  isCompletedTranscode,
  isInFlightTranscode,
  path,
  requireModifyLibrary,
  settingsStore,
  transcodeCacheSize,
  updateDatabase,
});

// Wave 7b (slice S10a of the monolith split, docs/exec-plans/active/
// 2026-09-13-sqlite-relational-migration.md): the media BROWSE routes -
// GET /api/search, GET /api/videos, GET /api/home, GET /api/channels and
// GET /api/videos/:id - moved VERBATIM to lib/media/routes.js. The call sits
// exactly where GET /api/search was registered, so the routing order is
// unchanged.
const mediaRoutes = require('./lib/media/routes'); // Wave 7b S10a: the require sits at its call site so parallel slices never touch the same hunk
mediaRoutes.registerBrowseRoutes(app, {
  audioExtractProgress, // the live per-id extract progress Map - the OBJECT, never a copy
  bookVisibleTo,
  booksDb,
  buildWatchUrl, // lib/ytdlp/url - the search results' canonical watch links
  effectiveProgress, // the stored position with any un-flushed ping overlaid
  folderDisplayNameStore,
  folderSettingsStore,
  getCachedDatabase,
  homeFeed, // lib/home/feed - the pure home-row assembler
  mediaVisibleTo,
  musicDb,
  ownTrack,
  path,
  pendingProgress, // the progress coalescer's staging Map - the LIVE object, never a copy
  podcastEpisodeVisibleTo,
  podcastsDb,
  previewClipEligible,
  projectedLibraryTracks,
  resolveHomeItem,
  resolveItemChapters,
  resolveModernGridItem,
  searchRegistry, // lib/search/registry - the universal-search provider list
  storyboardDescriptor,
  trackVisibleTo,
  transcodeProgress,
  userStore,
  videoQuery, // lib/videoQuery - the shared sort/filter/pagination primitives
  visibleTvEpisodes,
  ytdlp,
  ytdlpDb,
});

// v1.79 home feed --------------------------------------------------------------
//
// Wave 7b (slice S10a): the ROUTE itself now lives in lib/media/routes.js; the
// two id-to-card resolvers below stayed (other readers + the exports).
//
// GET /api/home assembles the per-user, YouTube-style row feed. It mirrors
// v1.78's GET /api/handoff posture exactly: the pure lib/home/feed.js selects
// ids from LIGHT per-user candidate records; THIS route resolves the selected
// ids to render fields. The client supplies nothing - every title, thumbnail
// and href is server-resolved from our own records (an XSS/lie vector
// otherwise). See docs/exec-plans/completed/2026-08-05-v1.79-home-feed.md.
//
// Scope (intake ruling 6): the two personal-engagement rows (continue-watching,
// from-liked) MIX all three player-carried kinds - media (video + yt-dlp audio),
// music tracks, podcast episodes - matching the existing merged Continue-
// listening row and the mixed Liked playlist. The library-browsing rows
// (recently-added, new-from-subs, per-channel, watch-again) are the MEDIA
// library (db.metadata), which already includes yt-dlp MP3s (type:'audio') -
// the literal ask - while music/podcasts keep their own dedicated surfaces.

// Resolve ONE selected feed id + kind into what a card renders, or null when it
// is no longer playable (deleted/pruned/trashed/not-downloaded) - a dead-link
// card is worse than a missing one, so null drops the item (the handoff rule).
// Named + exported so both the resolution and every not-playable skip are
// test-bindable (the v1.73 W1 lesson). Own-property checks throughout (the
// v1.42 __proto__ row-key lesson).
function resolveHomeItem(db, id, kind, progressPercent) {
  const enc = encodeURIComponent(id);
  if (kind === 'track') {
    const track = musicDb.parts.tracks.get(id); // Wave 5 (gate pass B): a point query - this runs once PER ITEM of every home row
    if (!track) return null;
    return { id, kind, title: track.title || 'Track', subtitle: track.artist || '', thumbnailUrl: `/albumart/${enc}`, href: `/music?play=${enc}`, progressPercent };
  }
  if (kind === 'podcast') {
    const ep = podcastsDb.parts.episodes.get(id) || null; // Wave 5 (gate pass B): a point query, per item
    if (!ep || ep.status !== 'downloaded') return null;
    const sub = podcastsDb.readPart('subscriptions').find((x) => x && x.id === ep.subId);
    return { id, kind, title: ep.title || 'Episode', subtitle: sub ? sub.name : 'Podcast', thumbnailUrl: `/podcastart/${encodeURIComponent(ep.subId)}`, href: `/podcasts?play=${enc}`, progressPercent };
  }
  const item = db.metadata && Object.prototype.hasOwnProperty.call(db.metadata, id) ? db.metadata[id] : null;
  if (!item) return null;
  // v1.92 note: the horizontal home-ROW card (buildFeedCardHtml/buildVideoRowCardHtml)
  // does NOT render a .card-preview overlay, so no storyboard descriptor is sent
  // here - the preview lives on the main + modern GRID cards (buildCardHtml),
  // fed by /api/videos (spreads ...item) and resolveModernGridItem.
  // v1.236 (Dean): carry `type` + `chapterCount` so the client can reroute an AUDIO download
  // to the music player from the ROW feed too (the card otherwise has no audio/chapter signal).
  // Additive + read-only; chapterCount only for audio (video never reroutes). The client
  // (buildFeedCardHtml -> musicHrefForItem) makes the flag-gated, library-bound decision.
  const isAudio = item.type === 'audio';
  return {
    id, kind: 'media', title: item.title || item.name || 'Video', subtitle: item.folderName || '',
    thumbnailUrl: `/thumbnail/${enc}`, href: `/watch.html?v=${enc}`, progressPercent,
    ...(item.type ? { type: item.type } : {}),
    ...(isAudio ? { chapterCount: (resolveItemChapters(item).chapters || []).length } : {}),
  };
}

// v1.84 Modern Mode: resolve a grid candidate into the RICH card shape the
// client's buildCardHtml expects (a superset of resolveHomeItem's row-card
// fields). Media cards carry the channel identity + view count + channel avatar
// (via the SAME resolver that feeds subscription avatars - Dean's call) + type +
// duration; podcast cards carry subId/showName so cardKindPresentation renders
// them. Returns null when the id is no longer resolvable (the dead-link drop).
// The `rec` already carries the per-user progress/watch booleans the gather
// computed under RBAC, so this never re-derives them.
function resolveModernGridItem(db, rec, ytView) {
  if (rec.kind === 'podcast') {
    const ep = podcastsDb.parts.episodes.get(rec.id) || null; // Wave 5 (gate pass B): a point query, per card
    if (!ep || ep.status !== 'downloaded') return null;
    const sub = podcastsDb.readPart('subscriptions').find((x) => x && x.id === ep.subId);
    return {
      id: rec.id, kind: 'podcast', title: ep.title || 'Episode',
      subId: ep.subId, showName: sub ? sub.name : 'Podcast',
      addedAt: rec.addedAt, progressPercent: rec.progressPercent, liked: rec.liked,
      duration: typeof ep.durationSec === 'number' ? ep.durationSec : 0, type: 'audio',
    };
  }
  const item = db.metadata && Object.prototype.hasOwnProperty.call(db.metadata, rec.id) ? db.metadata[rec.id] : null;
  if (!item) return null;
  // v1.85 (#4): field-COMPLETE for every card corner. The classic /api/videos
  // item carries `ext` (download filename) and `watchUrl` (the Share corner);
  // the grid item omitted them, so a bottom-left corner set to Share (or any
  // control needing watchUrl/ext - and, v1.203, hasSubtitles) rendered EMPTY in modern mode while
  // download/delete - which need only id - showed. Match the /api/videos
  // projection: derive watchUrl the same way, include ext.
  const watchUrl = typeof item.youtubeId === 'string' ? buildWatchUrl(item.youtubeId) : null;
  return {
    id: rec.id, kind: 'media', title: item.title || item.name || 'Video',
    folderName: item.folderName || '', channelName: item.channelName || '',
    channelAvatarUrl: ytdlp.resolveItemChannelAvatarUrl(ytView, item) || '',
    sourceViewCount: typeof item.sourceViewCount === 'number' ? item.sourceViewCount : undefined,
    sourceViewCountCapturedAt: item.sourceViewCountCapturedAt,
    addedAt: rec.addedAt, progressPercent: rec.progressPercent, liked: rec.liked,
    duration: typeof item.duration === 'number' ? item.duration : 0, type: rec.type,
    // v1.236: chapterCount for audio so the client can route a chaptered download to its album
    // (::c0) from the modern grid (which, unlike /api/videos, carries no `chapters` array).
    ...(rec.type === 'audio' ? { chapterCount: (resolveItemChapters(item).chapters || []).length } : {}),
    ext: typeof item.ext === 'string' ? item.ext : '',
    ...(watchUrl ? { watchUrl } : {}),
    // v1.93.2: DERIVED storyboard descriptor for the modern-grid card's
    // hover/in-view preview (eligible videos only; omitted otherwise). The card
    // preloads /storyboard/:id and reveals the overlay only on a successful load
    // (main.js StoryboardCards), so sending geometry before the sprite exists is
    // harmless (poster stays until the file is generated).
    storyboard: storyboardDescriptor(item) || undefined,
    hasPreview: previewClipEligible(item) || undefined, // v1.94: card hover clip eligibility
    // v1.203: the Transcript corner renders only with captions - the same
    // field-COMPLETE rule as watchUrl/ext above (a corner needing a field
    // the projection drops renders EMPTY in modern mode - the v1.85 #4 class).
    ...(item.hasSubtitles === true ? { hasSubtitles: true } : {}),
  };
}

// Wave 7b (slice S1a): POST|DELETE /api/watched/:id (the manual watched
// latch) moved VERBATIM to lib/user/routes.js - see the
// userRoutes.registerRoutes call beside the cross-device preference sync.

// Wave 7b (slice S1b): GET /api/progress/:id and POST /api/progress (the
// write coalescer's ingress) moved VERBATIM to lib/media/user-routes.js.
mediaUserRoutes.registerProgressRoutes(app, {
  armProgressFlushTimerIfNeeded,
  effectiveProgress, // the stored position with any un-flushed ping overlaid
  getCachedDatabase,
  // The coalescer's staging Map itself (never a snapshot): POST stages into
  // the LIVE object the flush timer drains.
  pendingProgress,
  pendingProgressKey,
  recordPresenceFromPing, // v1.78 device handoff, last - after every other effect
  userStore,
  videoQuery, // WATCHED_PCT - the watched latch's threshold
});

// v1.78 device handoff: resolve a presence entry into what the card RENDERS.
//
// Every display field is resolved SERVER-side from our own records - the
// client supplies an id and a device label, never a title, thumbnail or
// destination. That is the whole reason this function exists: a client-
// supplied title would be an XSS vector and a lie vector at once.
//
// Returns null when the item is no longer playable (deleted, pruned, trashed,
// rescanned away). The card is an OFFER; offering a dead link is worse than
// offering nothing, so a null here reads to the client exactly like "no
// presence" - the same silent, graceful nothing as a cold server (#9/#10).
//
// Named + exported (not inlined into the route) so both arms and the
// not-playable skips are BINDABLE by test - the v1.73 adversarial W1 lesson,
// where an inlined resolver survived all its mutants.
function resolveHandoffTarget(db, seen) {
  if (!seen || typeof seen.mediaId !== 'string') return null;
  const id = seen.mediaId;
  const enc = encodeURIComponent(id);

  if (seen.kind === 'podcast') {
    const ep = podcastsDb.parts.episodes.get(id) || null; // Wave 5 (gate pass B): a point query
    // Same rule as the push resolver: a non-downloaded episode is not
    // playable, so it is not offerable.
    if (!ep || ep.status !== 'downloaded') return null;
    const sub = podcastsDb.readPart('subscriptions').find((x) => x && x.id === ep.subId);
    return {
      title: ep.title || 'Episode',
      subtitle: sub ? sub.name : 'Podcast',
      thumbnailUrl: `/podcastart/${encodeURIComponent(ep.subId)}`,
      href: `/podcasts?play=${enc}`,
      // `durationSec` is the stored field on both podcast episodes and music
      // tracks (media items use `duration`). The ping's own duration wins when
      // it has one - it came from the real decoded media element.
      duration: seen.duration || ep.durationSec || 0,
    };
  }

  if (seen.kind === 'track') {
    const track = musicDb.parts.tracks.get(id); // Wave 5 (gate pass B): a point query
    if (!track) return null;
    return {
      title: track.title || 'Track',
      subtitle: track.artist || '',
      thumbnailUrl: `/albumart/${enc}`,
      href: `/music?play=${enc}`,
      duration: seen.duration || track.durationSec || 0,
    };
  }

  // OWN-property check, not a bare index (the v1.42 row-key lesson): a bare
  // `db.metadata[id]` hands back Object.prototype for id='__proto__' and would
  // resolve a phantom item with an undefined title.
  const item = db.metadata && Object.prototype.hasOwnProperty.call(db.metadata, id)
    ? db.metadata[id]
    : null;
  if (!item) return null;
  return {
    title: item.title || item.name || 'Video',
    subtitle: item.folderName || '',
    thumbnailUrl: `/thumbnail/${enc}`,
    href: `/watch.html?v=${enc}`,
    duration: seen.duration || item.duration || 0,
  };
}

// v1.78 device handoff: the ONE read endpoint the card polls.
//
// `deviceId` identifies the CALLER so it is never offered its own playback
// (AC7). It is a query param rather than a body field because this is a GET,
// and it is used ONLY to exclude - it is never a key, so a forged or omitted
// value can widen what you see to your own devices and NEVER to another
// user's (the bucket is keyed by req.user.id from the auth gate - #3).
// v1.78: an item that RAN OUT is not continuable, so it is not offerable.
//
// Without this the card offers to "continue" something the user just finished:
// on 'ended' the player's pause path fires one last beacon carrying the end
// position, so presence sits at ~100% and lingers there for the full 30
// minutes. This repo already rules that finished is not in-progress - the
// Continue-watching row excludes latched/finished items on the same principle.
//
// Deliberately 99%, NOT the 95% watched threshold: at 96% of a two-hour film
// there are still five minutes left and continuing is a real thing to want.
// This suppresses "the credits rolled", nothing more. Pure + exported so the
// boundary is bindable rather than a magic number inside a route.
const HANDOFF_FINISHED_PCT = 99;
function isFinishedPresence(seen) {
  if (!seen || !(seen.duration > 0)) return false; // unknown duration -> never suppress
  return (seen.position / seen.duration) * 100 >= HANDOFF_FINISHED_PCT;
}

// Wave 7b (slice S10a): GET /api/handoff and DELETE /api/videos/:id moved
// VERBATIM to lib/media/routes.js. A SECOND call, not part of the browse
// bundle above, because mediaUserRoutes.registerProgressRoutes sits between
// them and the routing order has to stay byte-for-byte what it was.
mediaRoutes.registerHandoffAndDeleteRoutes(app, {
  THUMBNAIL_DIR, // the hard-delete sweep's thumbnail/storyboard/preview roots
  audioPath,
  clearPersistedServedAt, // the delete path's served-at reset
  destroyMediaStreams, // kills in-flight range streams before a file is unlinked
  extractMediaRef,
  extractYtdlpVideoId,
  fs,
  getCachedDatabase,
  getMediaId,
  inSaveTransaction, // the delete path batches every store write into one commit
  isFinishedPresence, // the handoff's "already watched to the end" predicate
  isSafeVideoId,
  leafStillEnumerated,
  loadDatabase,
  matchRootFolder,
  mediaVisibleTo,
  musicDb,
  path,
  podcastEpisodeVisibleTo,
  podcastsDb,
  presence, // lib/presence/store - the device-handoff liveness reducer
  previewClipPath,
  progressStore,
  refuseIfReadOnlyMedia,
  requireModifyLibrary,
  resolveHandoffTarget,
  resolveOnDiskPath,
  restrictedVideoMutation,
  storyboardPath,
  tombstoneStore,
  trackVisibleTo,
  transcodedPath,
  // Wave 7b (slice S5): the soft-delete mover now lives in lib/media/trash.js
  // and reaches server.js as a `const` from the createTrashOps call BELOW this
  // line (the factory sits beside the /api/trash routes because
  // RECOVERABLE_DELETE_CODES, one of its deps, is declared after this call).
  // This deps object is evaluated EAGERLY, so a bare `trashItem` here would be
  // a temporal-dead-zone ReferenceError at require time - it must be a lazy
  // wrapper. It is bound by the loudest possible test: unwrap it and every one
  // of the ~230 suites that require server.js dies at boot.
  trashItem: (...args) => trashItem(...args),
  updateDatabase,
  userStore,
  viewCountStore,
  ytdlp,
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

// Wave 7b (slice S1b): the Liked playlist - POST|DELETE /api/liked/:id and
// GET /api/liked - moved VERBATIM to lib/media/user-routes.js, together with
// the three shapedLiked*Items projections the listing is the only reader of.
mediaUserRoutes.registerLikedRoutes(app, {
  albumArtExists, // the liked-track arm's cover-art presence probe
  bookVisibleTo,
  booksDb,
  effectiveBookProgress,
  effectiveMusicProgress,
  effectiveProgress,
  getCachedDatabase,
  mediaVisibleTo, // v1.80 RBAC: the per-user visibility gate for media items
  musicDb,
  ownTrack, // the music store's own-track lookup (a track row by id)
  pendingProgress, // the coalescer's staging Map - the LIVE object (read-your-writes)
  podcastEpisodeVisibleTo,
  podcastsDb,
  previewClipEligible,
  restrictedVideoMutation, // v1.80 RBAC (S-b): no restricted-id oracle, no persist
  storyboardDescriptor,
  trackVisibleTo,
  userStore,
  videoQuery,
  ytdlp, // resolveItemChannelAvatarUrl for the Liked cards
  ytdlpDb,
});

// Wave 7b (slice S1a): the three /api/feed-hidden routes moved VERBATIM to
// lib/user/routes.js - see the userRoutes.registerRoutes call beside the
// cross-device preference sync.

// Wave 7b (slice S1a): GET|DELETE /api/history, DELETE /api/history/:id and
// the four /api/search-history routes (with SEARCH_HISTORY_CAP and
// normalizeSearchTerm) moved VERBATIM to lib/user/routes.js - see the
// userRoutes.registerRoutes call beside the cross-device preference sync.

// ---- v1.65 trash: the core + the four /api/trash routes ---------------------
//
// Wave 7b (slice S5): `trashItem`, `trashOrphanFile`, `restoreTrashItem`,
// `purgeTrashItem` and `sweepTrash` - the soft-delete core, the only way back
// for a trashed file - moved VERBATIM to lib/media/trash.js, and the four
// /api/trash routes moved with them into that module's `registerRoutes`. The
// register call sits exactly where GET /api/trash was, so the routing order is
// unchanged.
//
// The FACTORY is built HERE, immediately above the register call, instead of
// where `trashItem` was declared ~950 lines below: the moved functions are
// `const` bindings now, and a register call's deps object is evaluated
// EAGERLY, so the routes can only be handed `restoreTrashItem` and
// `purgeTrashItem` after `createTrashOps` has returned. Everything the factory
// takes already exists at this line - the last of the non-hoisted ones,
// `RECOVERABLE_DELETE_CODES`, is declared ~230 lines above; the rest are
// hoisted function declarations or early consts. None of them is a `let` or is
// ever reassigned (an AST pass over this file's module scope), so nothing has
// to cross as a live accessor.
const trashOps = require('./lib/media/trash'); // Wave 7b S5: the require sits at its call site so parallel slices never edit one hunk
const {
  trashItem, trashOrphanFile, restoreTrashItem, purgeTrashItem, sweepTrash,
} = trashOps.createTrashOps({
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
});

trashOps.registerRoutes(app, {
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
});

// ---- C1 (v1.24 UX Round, Wave 3): move files between folders + id re-key --
//
// Wave 7b (slice S5): `computeMoveTarget` and `moveItemToFolder` - with the
// LOAD-BEARING grounding-fact block that says why they exist (a media id is
// `md5(filePath)`, so a naive rename-then-rescan reads as a delete plus a
// brand-new add) - moved VERBATIM to lib/media/move.js; the factory call sits
// below, at `computeMoveTarget`'s own declaration site.
// `configuredLibraryRoots` (the allowed-roots list the pair is handed) stays
// here: ten callers.

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
// Wave 4: the root list comes from the table; the doc snapshot is no longer
// consulted (the parameter stays for the ten callers' shape).
function configuredLibraryRoots(_db) {
  const ytdlpConfig = ytdlp.parseYtdlpConfig();
  return [...folderStore.list(), ...ytdlp.extraScanRoots(ytdlpConfig)];
}

// Wave 7b (slice S5): `computeMoveTarget` and `moveItemToFolder` (with their
// JSDoc) moved VERBATIM to lib/media/move.js. The factory call sits HERE, at
// `computeMoveTarget`'s own declaration site, so every later reference - POST
// /api/videos/:id/move's register call, the bulk mover's, the import
// relocation's runtime calls and this file's own re-exports - reads the same
// initialized bindings the hoisted declarations used to give them. None of the
// 16 deps is a `let`, so none crosses as a live accessor.
const moveOps = require('./lib/media/move'); // Wave 7b S5: the require sits at its call site so parallel slices never edit one hunk
const { computeMoveTarget, moveItemToFolder } = moveOps.createMoveOps({
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
});

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
 *  - v1.43: the relational `user_progress`/`user_liked` rows (not process
 *    memory, but the same after-the-commit ordering argument applies -- see
 *    the inline comment).
 */
function rekeyInFlightState(oldId, newId, oldPath, newPath) {
  // v1.43: pendingProgress is keyed `<userId>:<mediaId>` -- carry EVERY
  // user's staged position for the moved item, not just one entry.
  for (const [key, entry] of [...pendingProgress]) {
    if (entry.mediaId === oldId) {
      pendingProgress.delete(key);
      pendingProgress.set(pendingProgressKey(entry.userId, newId), { ...entry, mediaId: newId });
    }
  }
  // The COMMITTED per-user rows follow the same post-commit posture as the
  // maps here: re-keying them inside the mutator would leave the relational
  // rows pointing at a `newId` the rolled-back doc tables never learned
  // about. `UPDATE OR REPLACE`, so a collision with an already-re-keyed row
  // can't throw. (user_liked rides along -- the v1.41.6 lesson says every
  // id-keyed carrier moves in the SAME commit as the namespace it mirrors.)
  try {
    userStore.rekeyMediaState(oldId, newId);
  } catch (err) {
    console.error(`Move: failed to re-key per-user progress/liked for ${oldId} -> ${newId}:`, err.message);
  }
  // Wave 1: the relational view counter follows the item to its new id
  // (move, trash and restore all pass through here - one seam, three
  // callers). OR REPLACE inside the store: a collision at the destination
  // cannot throw.
  try {
    viewCountStore.rekey(oldId, newId);
  } catch (err) {
    console.error(`Move: failed to re-key the view count for ${oldId} -> ${newId}:`, err.message);
  }
  const servedAt = persistedServedAt.get(oldId);
  clearPersistedServedAt(oldId);
  if (servedAt !== undefined) persistedServedAt.set(newId, servedAt);
  if (recentlyServed.has(oldPath)) {
    recentlyServed.set(newPath, recentlyServed.get(oldPath));
    recentlyServed.delete(oldPath);
  }
}

// ---- v1.65 trash core -------------------------------------------------------
//
// Wave 7b (slice S5): `trashItem` (with its whole ordering-discipline design
// comment), `trashOrphanFile`, `restoreTrashItem`, `purgeTrashItem` and
// `sweepTrash` moved VERBATIM to lib/media/trash.js. The factory that hands
// them their collaborators is called beside the /api/trash routes above, which
// need two of them at registration time. `trashRecordPlacement` (the ONE
// restorability authority the restore and the sweep share) and
// `rekeyInFlightState` (the post-commit carry the move, the trash and the
// restore all pass through, over maps the rest of this file reads and writes)
// stay in server.js and cross as deps.

// v1.65 gate round 4 (adversarial W1): the ONE authority on "is this trash
// record restorable where it says it belongs". restoreTrashItem and
// sweepTrash both consult it -- the sweep's S-2 invariant ("never
// auto-destroy a record restore would refuse") is only true if both sites
// ask the SAME question, and the hand-copied version had already diverged
// (it dropped the absolute/no-dotdot check and the trash-dir gate, so two
// corrupt shapes were refused by restore yet reaped by the sweep -- the
// seat measured both).
//
// The two shapes the app itself constructs: the destination sits under a
// configured library root, or under the trash dir's own parent tree (which
// for an app-created record IS the item's own directory -- the
// unattributable-file fallback). Residual by design: tech-debt #74.
//
// CONSUMPTION CONTRACT (gate round 4 + QA S1): only `.restorable` is read,
// by exactly the two call sites above; the sub-fields are diagnostic. The
// inner `trashConfined &&` inside `destConfined` is redundant for
// `.restorable`'s VALUE but LOAD-BEARING as a crash guard -- without it,
// `path.dirname(path.dirname(trashPath))` evaluates on a possibly-undefined
// trashPath and THROWS, which inside sweepTrash's record loop would reject
// the whole boot/scan-slot sweep. Do not "simplify" it away.
function trashRecordPlacement(rec, roots) {
  const isCleanAbs = (v) => typeof v === 'string' && path.isAbsolute(v) && !v.split(/[\\/]/).includes('..');
  const isWithin = (child, parent) => {
    const c = path.resolve(child);
    const p = path.resolve(parent);
    return c === p || c.startsWith(p + path.sep);
  };
  const trashPath = rec ? rec.trashPath : undefined;
  const originalPath = rec ? rec.originalPath : undefined;
  const list = Array.isArray(roots) ? roots.filter((r) => typeof r === 'string' && r !== '') : [];
  const trashConfined = isCleanAbs(trashPath) && path.basename(path.dirname(trashPath)) === TRASH_DIR_NAME;
  const destConfined = isCleanAbs(originalPath) && (
    list.some((r) => isWithin(originalPath, r))
    || (trashConfined && isWithin(originalPath, path.dirname(path.dirname(trashPath))))
  );
  return { trashConfined, destConfined, restorable: trashConfined && destConfined };
}

// Wave 7b (slice S10a): POST /api/videos/:id/move moved VERBATIM to
// lib/media/routes.js. It registers HERE, after the trash routes and after the
// site where moveItemToFolder was declared (slice S5: the createMoveOps call),
// exactly as before.
mediaRoutes.registerMoveRoute(app, {
  getMediaId,
  loadDatabase,
  moveItemToFolder, // lib/media/move.js's collision-safe file mover (slice S5)
  refuseIfReadOnlyMedia,
  requireModifyLibrary,
  restrictedVideoMutation,
  updateDatabase,
});

// Wave 7b (slice S6): the reheat's import-RELOCATION and metadata-REPULL
// planners moved VERBATIM to lib/ytdlp/relocation.js (the one-time one-off
// migration, the shared move/skip decision, the executor, the whole-library
// dry-run preview, and the repull enumeration + writer). The factory call sits
// exactly where the first of the six - `migrateOneOffsIntoChannelFolders` - was
// declared, which is above every call site and above the
// `ytdlp.registerRoutes(app, {...})` call two of them are bridged through; the
// six names below are the SAME function objects this file still exports.
const relocationModule = require('./lib/ytdlp/relocation'); // Wave 7b S6: the require sits at its call site so parallel slices never touch the same hunk
const {
  migrateOneOffsIntoChannelFolders,
  planImportRelocation,
  relocateHydratedImportIntoChannelFolder,
  buildImportRelocationPreview,
  enumerateRepullableItems,
  recordRepulledItemMeta,
} = relocationModule.createRelocation({
  READ_ONLY_MEDIA,
  activeProtectedPaths, // (now) -> the recently-served path Set a relocation must not yank a file out of
  buildWatchUrl,
  classifyMetadataEffect,
  classifyTransfer,
  extractYtdlpVideoId,
  finalizeChapters,
  fs,
  getMediaId,
  isMediaJobInFlight, // reads transcodeQueue/audioExtractQueue, which stay here
  isSafeVideoId,
  matchRootFolder,
  // LAZY: slice S5 turns this hoisted declaration into a `const` from a factory
  // call BELOW this line, so a direct binding would be a boot-time TDZ error.
  moveItemToFolder: (...args) => moveItemToFolder(...args),
  normalizeChapter,
  path,
  resolveRelocationTitle,
  settingsStore,
  subtitles,
  validateChannelUrl,
  ytdlp,
  ytdlpArgs,
  ytdlpDb,
});

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

/**
 * v1.56 (Dean's bulk subscriber-count reheat): the ONE fan-out writer that
 * stamps a channel-level probed follower count onto EVERY library item
 * attributed to that channel -- the v1.41.4 discipline (one writer, every
 * site calls it; the batch worker in lib/ytdlp/index.js is its only caller,
 * deps-injected through the same circular-require-avoiding bridge as
 * `recordRepulledItemMeta` (lib/ytdlp/relocation.js)).
 *
 * MATCH RULE mirrors `recordRepulledItemMeta`'s `sameChannel`: when BOTH the
 * item and the probe/target know a channelId, the id decides (a canonical
 * `/channel/UC…` URL and a handle `/@name` URL for the same channel must
 * match; two different channels behind a coincidentally-equal URL string must
 * not). URL equality -- against the TARGET's url (what the items themselves
 * carried at enumeration) and the PROBE's canonical url alike, on both
 * `channelUrl` and `channelHandleUrl` -- is the fallback when either side has
 * no id. Items with no channel identity at all never match anything.
 *
 * SUPERSEDE UNCONDITIONALLY, count + capture date written as a UNIT -- the
 * v1.54 decision, unchanged: subscriber counts legitimately fall, a reheat is
 * a deliberate refresh, and the label carries its own "as of" date. The count
 * is re-validated at this write boundary through the SAME standalone
 * validator every other consumer uses (`ytdlp.parseCapturedFollowerCount`),
 * never trusted from the caller; an invalid count is a no-op that resolves 0
 * and never touches the database.
 *
 * MANUAL ATTRIBUTION (v1.53) is deliberately NOT a barrier here: a manually-
 * attributed item's IDENTITY is Dean's alone, but the count belongs to the
 * channel that identity names -- refreshing it rewrites nothing hand-set.
 *
 * Resolves the number of items actually stamped. A mutator pass that matches
 * nothing returns `false` (skips the save entirely) and resolves 0.
 *
 * @param {{updateDatabase: Function}} deps
 * @param {{channelId?: string|null, channelUrl?: string|null}} target the
 *   enumeration target (`collectDistinctChannelAvatarTargets` shape)
 * @param {{followerCount: number, channelId?: string|null, channelUrl?: string|null}} probed
 *   the `probeChannelFollowerCount` result for that target
 * @param {number} [nowMs] injectable clock (the `recordRepulledItemMeta` pattern)
 * @returns {Promise<number>} items updated
 */
async function recordChannelFollowerCountFanout(deps, target, probed, nowMs = Date.now()) {
  const d = deps || {};
  if (typeof d.updateDatabase !== 'function') return 0;
  const t = target && typeof target === 'object' ? target : {};
  const p = probed && typeof probed === 'object' ? probed : {};
  const followers = ytdlp.parseCapturedFollowerCount(p.followerCount);
  if (followers === null) return 0;

  const str = (v) => (typeof v === 'string' && v !== '' ? v : null);
  // The probe's channelId (canonical, fresh) and the target's (what the
  // library already knew) are the SAME channel by construction -- the probe
  // was run against the target's own URL -- so either id may vouch for a
  // match.
  const knownIds = new Set([str(t.channelId), str(p.channelId)].filter(Boolean));
  const knownUrls = new Set([str(t.channelUrl), str(p.channelUrl)].filter(Boolean));
  if (knownIds.size === 0 && knownUrls.size === 0) return 0;

  let updated = 0;
  await d.updateDatabase((db) => {
    // Defensive reset: updateDatabase runs the mutator exactly ONCE (no
    // retry path exists -- gate fix, the original comment here claimed
    // otherwise), but a count computed inside the closure belongs inside it.
    updated = 0;
    for (const item of Object.values(db.metadata || {})) {
      if (!item) continue;
      const itemId = str(item.channelId);
      let matches;
      if (itemId && knownIds.size > 0) {
        matches = knownIds.has(itemId);
      } else {
        const itemUrl = str(item.channelUrl);
        const itemHandle = str(item.channelHandleUrl);
        matches = (itemUrl !== null && knownUrls.has(itemUrl))
          || (itemHandle !== null && knownUrls.has(itemHandle));
      }
      if (!matches) continue;
      item.sourceFollowerCount = followers;
      item.sourceFollowerCountCapturedAt = nowMs;
      updated += 1;
    }
    return updated > 0;
  });
  return updated;
}

// v1.115 (Dean, A1): PURE pin-label refresh. A channel PIN is a SNAPSHOT
// { id, channelDir, label, pinnedAt } whose `label` was frozen at pin time (a
// gated data-safety invariant -- store.js), so a name backfill does NOT reach it
// live. After a channel's items get a new name, re-derive the label for any pin
// whose `channelDir` basename matches one of THIS channel's item folders. Mutates
// the passed `db` in place (called inside the fanout's updateDatabase closure,
// holding the lock); returns the count of pins relabelled. Never throws; a
// blank/absent name is a no-op. RESPECTS the snapshot design -- a deliberate
// label write keyed by the folder match, not a conversion to a live join.
function refreshPinLabelsForBackfilledChannel(db, target, name, pinsHolder = db) { // Wave 5: the items come from `db` (the doc), the pins from `pinsHolder` = { ytdlp: { pins } } (a feature-store holder inside ytdlpDb.mutate; defaults to db for a holder-shaped caller)
  // v1.115 gate fix (both seats): the pin label is a durable write too -- strip
  // control chars/NUL here as well (the pin-label reducer store.js:2071 does).
  // eslint-disable-next-line no-control-regex
  const trimmed = typeof name === 'string' ? name.replace(/[\x00-\x1f\x7f]/g, '').trim() : '';
  if (trimmed === '') return 0;
  const pins = pinsHolder && pinsHolder.ytdlp && Array.isArray(pinsHolder.ytdlp.pins) ? pinsHolder.ytdlp.pins : null;
  if (!pins || pins.length === 0) return 0;
  const t = target && typeof target === 'object' ? target : {};
  // v1.115 gate fix (adversarial SUGGESTION-1): key on the channel's item FOLDER
  // PATHS (dirname of filePath), not the folder BASENAME -- two channels in
  // different roots sharing a folder basename ("News") would otherwise both get
  // relabelled. A pin's channelDir IS the channel's download folder, and this
  // channel's items live under it, so dirname(filePath) === channelDir is the
  // precise association.
  const dirs = new Set();
  for (const item of Object.values((db && db.metadata) || {})) {
    if (!item) continue;
    const matches = t.channelId
      ? item.channelId === t.channelId
      : (!!t.channelUrl && (item.channelUrl === t.channelUrl || item.channelHandleUrl === t.channelUrl));
    if (matches && typeof item.filePath === 'string' && item.filePath !== '') dirs.add(path.dirname(item.filePath));
  }
  if (dirs.size === 0) return 0;
  let relabelled = 0;
  for (const pin of pins) {
    if (!pin || typeof pin.channelDir !== 'string' || pin.channelDir === '') continue;
    if (dirs.has(pin.channelDir) && pin.label !== trimmed) { pin.label = trimmed; relabelled += 1; }
  }
  return relabelled;
}

// v1.115 (Dean, A1): server.js's ONE channel->items name writer, deps-injected
// into the name-backfill batch exactly like `recordChannelFollowerCountFanout`.
// Runs the tested pure `ytdlp.applyBackfilledChannelName` (which enforces the
// attribution / cross-channel / bad-name-only / bound guards) + the pin-label
// refresh INSIDE the ONE serialized `updateDatabase` mutator, persisting only
// when something changed. Returns the item count written.
async function recordChannelNameBackfillFanout(deps, target, probed, nowMs = Date.now()) {
  void nowMs;
  const d = deps || {};
  if (typeof d.updateDatabase !== 'function') return 0;
  const name = probed && typeof probed.channelName === 'string' ? probed.channelName : '';
  if (name.trim() === '') return 0;
  let updated = 0;
  await d.updateDatabase((db) => {
    updated = ytdlp.applyBackfilledChannelName((db && db.metadata) || {}, target, name);
    // Wave 5: the frozen pre-auth pins live in ytdlp_pins - the relabel is a
    // nested feature mutate riding this same commit (skipped when nothing matched).
    if (updated > 0) ytdlpDb.mutate((yh) => refreshPinLabelsForBackfilledChannel(db, target, name, yh) > 0);
    return updated > 0;
  });
  return updated;
}

// v1.116 (Dean): the LOCAL-heal fanout writer -- mirrors the network fanout but
// takes a folder-scoped heal target (its own local ground truth, no probe) and
// adopts the full identity UNIT (id/name/url/handle/avatar) onto the bad
// siblings, then re-labels the channel pin to the real name. Runs inside ONE
// serialized updateDatabase mutator (the caller holds the lock).
async function recordLocalChannelHealFanout(deps, target) {
  const d = deps || {};
  if (typeof d.updateDatabase !== 'function') return 0;
  if (!target || !target.identity || !target.identity.channelId) return 0;
  let updated = 0;
  await d.updateDatabase((db) => {
    updated = ytdlp.applyLocalChannelHeal((db && db.metadata) || {}, target);
    if (updated > 0) {
      // The pin re-label already keys on the channel's item folder full paths,
      // and the healed items now carry the canonical id -- pass the canonical
      // identity so the pin adopts the real name.
      ytdlpDb.mutate((yh) => refreshPinLabelsForBackfilledChannel(db, { channelId: target.identity.channelId }, target.identity.channelName, yh) > 0); // Wave 5: ytdlp_pins, same commit
      // v1.126: a folder that healed to ONE canonical name also writes the
      // per-folder display map, so every folder-LABEL surface (the `?folder=`
      // header, the channels bar, pins' fallback) heals with it. folderName
      // comes from a healed ITEM (the scan's top-level-segment field), never
      // from the folderKey path (nested channel dirs would mis-key on the
      // basename). OVERWRITE posture (the v1.116 lesson): a heal that runs
      // again with a fresher canonical name wins - never gated on absence.
      const healName = typeof target.identity.channelName === 'string' ? target.identity.channelName.trim() : '';
      if (healName !== '') {
        for (const it of Object.values(db.metadata || {})) {
          if (!it || typeof it.folderName !== 'string' || it.folderName === '') continue;
          if (it.channelId !== target.identity.channelId) continue;
          if (ytdlp.folderKeyOf(it) !== target.folderKey) continue;
          // Wave 4: the map is a table; the write rides the doc commit through
          // the deps seam (the unit harness supplies its own).
          d.setFolderDisplayName(it.folderName, healName);
          break;
        }
      }
    }
    return updated > 0;
  });
  return updated;
}

// Wave 7b (slice S10b): GET /api/storage-summary moved VERBATIM to
// lib/config/routes.js. (The /api/stats section banner that used to sit here
// went with GET /api/stats to lib/media/routes.js in slice S10a - the R2 gate
// caught the orphaned banner the parallel merge left behind.)
configRoutes.registerStorageSummaryRoute(app, {
  getCachedDatabase,
  mediaVisibleTo, // v1.80 RBAC: the per-user visibility gate for media items
  stats,
  withEffectiveViewCounts,
});

// Wave 7b (slice S10a): GET /api/library-items moved VERBATIM to
// lib/media/routes.js.
mediaRoutes.registerLibraryItemsRoute(app, {
  getCachedDatabase,
  mediaVisibleTo,
  withEffectiveViewCounts, // overlays the per-user view-count store onto db.metadata
});

// ---- v1.166 (Dean): Sneaky critter mode - THE FOLDER IS THE MANIFEST -------
// `public/critters/` is enumerated name-agnostically: ANY image file dropped in
// becomes a critter (no array-to-filename matching, Dean's explicit ruling), and
// a sound file with the SAME BASENAME becomes that critter's tap noise. Dean
// populates the folder with big crisp transparent PNGs; the CLIENT owns display
// size, so source dimensions never matter. Pure mapping split out for unit
// coverage (the route itself is readdir + this).
const CRITTER_IMAGE_EXTS = new Set(['.png', '.webp', '.gif', '.svg', '.jpg', '.jpeg']);
const CRITTER_SOUND_EXTS = new Set(['.mp3', '.wav', '.m4a', '.ogg']);
// v1.185: the sound-file collection (basename -> filename), extracted so the
// owned pairing (buildCritterListing) and the exposed voice pool
// (buildCritterVoicePool) share ONE source of truth - the same deterministic,
// raw-extname, sorted, last-write-wins rules. (Was inlined in buildCritterListing.)
function collectCritterSoundMap(fileNames) {
  const names = Array.isArray(fileNames) ? fileNames.filter((n) => typeof n === 'string') : [];
  const sounds = new Map();
  // v1.179 gate W: iterate SORTED (readdir order is filesystem-dependent) so
  // a basename with two sound extensions (rex.mp3 + rex.wav) resolves to a
  // deterministic last-write-wins - lexicographic, never folder-churn-lucky.
  // This pins BOTH the owned pairing and the voice pool's member.
  for (const name of [...names].sort()) {
    // Strip with the RAW extname (gate S1): lowercasing the ext before
    // basename() left `Mopsy.MP3` unstripped and the pairing silently died.
    const rawExt = path.extname(name);
    if (CRITTER_SOUND_EXTS.has(rawExt.toLowerCase())) sounds.set(path.basename(name, rawExt), name);
  }
  return sounds;
}

// v1.185 (Dean): the FULL sound pool as client URLs, sorted + deduped-by-basename
// - every sound file in the folder, whether or not any critter's name matches
// it. The client's "random sound each tap" preference draws from THIS (the
// per-critter `voice` field is a lossy hash-assignment that can miss files no
// critter's hash landed on). Same order/dedup as the owned pairing.
function buildCritterVoicePool(fileNames) {
  return [...collectCritterSoundMap(fileNames).values()].sort()
    .map((n) => '/critters/' + encodeURIComponent(n));
}

function buildCritterListing(fileNames) {
  const names = Array.isArray(fileNames) ? fileNames.filter((n) => typeof n === 'string') : [];
  const sounds = collectCritterSoundMap(names);
  const out = [];
  const seen = new Set(); // gate S3: `mopsy.png` + `mopsy.webp` is ONE critter -
  // the no-duplicates-per-page rule is keyed on id, so the id must be unique
  // here (first image in sorted order wins).
  // v1.179 (Dean: "if a given character doesn't have an MP3 with the
  // corresponding name, I still want them to get a sound that is not our
  // boop"): the VOICE POOL. Every sound file in the folder, sorted, is a
  // borrowable voice. An exact-basename match still wins outright (`sound`
  // stays the OWNED pairing - the manager's music-note badge keeps meaning
  // "has its own sound"); a critter without one borrows deterministically -
  // a stable hash of its id picks from the pool, so a nameless-match critter
  // keeps the SAME voice everywhere, every session (identity, not a
  // soundboard). The synth chirp remains only when the folder has no sounds.
  const voicePool = [...sounds.values()].sort();
  const voiceFor = (id) => {
    if (!voicePool.length) return null;
    let h = 0;
    for (let i = 0; i < id.length; i += 1) h = ((h * 31) + id.charCodeAt(i)) >>> 0;
    return '/critters/' + encodeURIComponent(voicePool[h % voicePool.length]);
  };
  for (const name of names.filter((n) => CRITTER_IMAGE_EXTS.has(path.extname(n).toLowerCase())).sort()) {
    const base = path.basename(name, path.extname(name));
    if (seen.has(base)) continue;
    seen.add(base);
    const owned = sounds.has(base) ? '/critters/' + encodeURIComponent(sounds.get(base)) : null;
    out.push({
      id: base,
      img: '/critters/' + encodeURIComponent(name),
      sound: owned,
      voice: owned || voiceFor(base),
    });
  }
  return out;
}

// v1.171 (QA S1/adversarial S2 closure): one resolver for the critter folder.
// CRITTERS_DIR is a TEST seam ONLY (the destructive integration suite seeds a
// temp folder instead of the repo's real one) - NOT a deploy override: the
// static handler serves /critters/<name> from public/critters/ regardless, so
// pointing the API elsewhere would 404 every thumbnail (QA delta finding).
// The default is the compose-mount lockstep path (see docker-compose.yml).
const crittersDir = () => process.env.CRITTERS_DIR || path.join(__dirname, 'public', 'critters');

// Wave 7b (slice S10a): GET /api/critters moved VERBATIM to
// lib/media/routes.js. It registers on its OWN here, ahead of the management
// routes below, because the deps object at a call site is evaluated EAGERLY:
// the upload vocabulary (CRITTER_UPLOAD_*) is declared further down and would
// still be in its temporal dead zone at this line.
mediaRoutes.registerCritterListingRoute(app, {
  buildCritterListing, // the pool projection the client engine consumes
  buildCritterVoicePool, // the per-critter sound map the listing carries
  crittersDir, // resolves against server.js's __dirname, so it cannot move here
  fs,
});

// ---- v1.171 (Dean): critter pool MANAGEMENT (web UI) -----------------------
// Wave 7b (slice S10a): the five /api/critters ROUTES now live in
// lib/media/routes.js (with listCritterFiles and the two size caps); what is
// left here is the shape/type vocabulary they are handed as deps.
// The folder stays the manifest (v1.166): these routes are WRITERS to
// public/critters/, never a registry - folder drop-in keeps working and the
// Docker compose bind makes web uploads land on the host. All management is
// ADMIN-ONLY (Dean's intake ruling; the logo-upload posture - the pool is
// server-wide). Upload mirrors the logo route exactly: route-scoped
// express.raw (this app deliberately has no multipart dependency),
// Content-Type allowlist AND magic bytes, size caps, tmp+rename atomicity.
// SVG is deliberately NOT uploadable (a same-origin stored-XSS vector when
// fetched directly); Dean's own folder drop-ins may still use it.

const CRITTER_UPLOAD_IMAGE_TYPES = {
  'image/png': (buf) => buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47,
  'image/jpeg': (buf) => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  'image/webp': (buf) => buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP',
  'image/gif': (buf) => buf.length > 6 && buf.toString('ascii', 0, 4) === 'GIF8',
};
const CRITTER_UPLOAD_SOUND_TYPES = {
  'audio/mpeg': (buf) => buf.length > 3 && (buf.toString('ascii', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)),
  'audio/wav': (buf) => buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE',
  'audio/x-wav': (buf) => CRITTER_UPLOAD_SOUND_TYPES['audio/wav'](buf),
  'audio/mp4': (buf) => buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp',
  'audio/x-m4a': (buf) => buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp',
  'audio/ogg': (buf) => buf.length > 4 && buf.toString('ascii', 0, 4) === 'OggS',
};
// The extension a given upload mime may carry - the name AND the bytes must
// agree with the declared type, or the upload is refused.
const CRITTER_UPLOAD_EXT_FOR_MIME = {
  'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'], 'image/gif': ['.gif'],
  'audio/mpeg': ['.mp3'], 'audio/wav': ['.wav'], 'audio/x-wav': ['.wav'],
  'audio/mp4': ['.m4a'], 'audio/x-m4a': ['.m4a'], 'audio/ogg': ['.ogg'],
};

// PURE filename gate for uploads. Returns the accepted name or null. The
// accepted name is later joined under public/critters/ ONLY after this, plus
// a resolved-dirname belt at the write site.
function sanitizeCritterUploadName(name, mime) {
  if (typeof name !== 'string') return null;
  const n = name.trim();
  if (!n || n.length > 80) return null;
  if (n.includes('/') || n.includes('\\')) return null;
  for (let i = 0; i < n.length; i += 1) {
    const cc = n.charCodeAt(i);
    if (cc < 0x20 || cc === 0x7f) return null; // NUL + control bytes
  }
  if (n.startsWith('.')) return null; // dotfiles, '.', '..'
  if (path.basename(n) !== n) return null; // belt: basename equality
  const allowedExts = CRITTER_UPLOAD_EXT_FOR_MIME[mime];
  if (!allowedExts) return null;
  const ext = path.extname(n).toLowerCase();
  if (!allowedExts.includes(ext)) return null;
  if (!path.basename(n, path.extname(n))) return null; // an extension alone is not a name
  return n;
}

// Wave 7b (slice S10a): the critters MANAGEMENT routes, the aggregate reads
// and the per-item mutations (/api/stats, /api/duplicates and
// /api/duplicates.csv, the view/dimensions/chapters mutations, the manual
// channel-attribution cluster, /api/subtitles and /api/transcript) moved
// VERBATIM to lib/media/routes.js, together with the attribution helpers and
// the critters lister that only they referenced. One call for the lot: they
// were already contiguous here, and this is the first line at which every
// constant handed in below has been initialized.
mediaRoutes.registerLibraryRoutes(app, {
  APP_VERSION,
  CRITTER_IMAGE_EXTS,
  CRITTER_SOUND_EXTS,
  CRITTER_UPLOAD_EXT_FOR_MIME,
  CRITTER_UPLOAD_IMAGE_TYPES,
  CRITTER_UPLOAD_SOUND_TYPES,
  MAX_MEDIA_DIMENSION,
  REPO_URL,
  bookVisibleTo,
  booksDb,
  buildStoreZip,
  configuredLibraryRoots, // the bulk selector's root confinement
  crittersDir, // resolves against server.js's __dirname, so it cannot move here
  express, // the critters upload's route-scoped express.raw parser
  extractYtdlpVideoId,
  folderStore,
  fs,
  getCachedDatabase,
  getMediaId,
  isPrimitiveNumericInput,
  isValidMediaDimension,
  likedStore,
  loadDatabase,
  matchRootFolder,
  mediaVisiblePredicate, // the restriction-aware predicate the bulk selector filters on
  mediaVisibleTo,
  moveItemToFolder, // lib/media/move.js's collision-safe file mover (slice S5)
  musicDb,
  parseChapterLines,
  path,
  progressStore,
  refuseIfReadOnlyMedia,
  requireAdmin,
  requireModifyLibrary,
  resolveItemChapters,
  restrictedVideoMutation,
  sanitizeCritterUploadName,
  settingsStore,
  stats, // lib/stats - the pure aggregation helpers behind GET /api/stats
  subtitles, // lib/subtitles - srtToVtt + findSubtitleSidecar
  tombstoneStore,
  trackVisibleTo,
  transcript, // lib/transcript - the sidecar as plain text
  ttsAvailable,
  ttsConfig,
  ttsEngineVersion: () => ttsEngineVersion, // LIVE reader: a server.js `let` an async probe fills in after boot
  updateDatabase,
  userStore,
  validateChannelUrl, // lib/ytdlp/url - the one channel-URL gate the capture path uses
  viewCountStore,
  visibleMetadataFor, // the duplicates report's restriction-scoped metadata view
  withEffectiveViewCounts, // overlays the per-user view-count store onto db.metadata
  ytdlp,
  ytdlpDb,
});

// API: Record a watch-page open, for C4 "most-watched" (v1.24 UX Round,
// Wave 3). Wave 7b (slice S10a): that route - POST /api/videos/:id/view - now
// lives in lib/media/routes.js; the two count resolvers below stayed.
// A dedicated, separate route -- deliberately NOT folded into
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
// v1.42: the counter was extracted OUT of the metadata item (into a doc
// namespace then; since Wave 1 into the media_view_counts table).
// `viewCount` was the one non-rebuildable field embedded in the rebuildable
// `metadata` namespace, and in place it was demonstrably clobber-prone: the
// scan's changed-file re-init and Phase-2 merge both drop it, so a view
// recorded mid-scan was silently reverted (the 5-strike persist-gate class;
// exec plan v1.42, design finding #8). A legacy embedded `item.viewCount`
// (a pre-v1.42 item that was never imported/extracted) is honored as the
// STARTING value the first time the id is counted or read — the item field
// itself is left frozen in place and simply superseded (never mutated, never
// "backfilled": the thumbnail-backfill lesson).
// Wave 1 (relational-migration arc, v1.291): the counter now lives in the
// `media_view_counts` TABLE behind viewCountStore, not in `db.viewCounts`.
// `counts` is one getAll() snapshot ({ id: count }) so a full-library overlay
// costs one query, not one per item. The legacy embedded floor is unchanged.
function effectiveViewCount(counts, db, id) {
  const fromTable = Object.prototype.hasOwnProperty.call(counts, id) ? counts[id] : undefined;
  if (typeof fromTable === 'number' && Number.isFinite(fromTable) && fromTable >= 0) return fromTable;
  const item = db.metadata ? db.metadata[id] : undefined;
  const legacy = item ? item.viewCount : undefined;
  return (typeof legacy === 'number' && Number.isFinite(legacy) && legacy >= 0) ? legacy : 0;
}

// Read-side overlay for the stats page: a NEW metadata map whose items carry
// their effective view count (table first, legacy floor second), so lib/stats
// stays a pure item-shape consumer. Copies are deliberate — readers must
// never mutate `getCachedDatabase()`'s object (the read-cache contract).
function withEffectiveViewCounts(db) {
  const counts = viewCountStore.getAll();
  const out = {};
  for (const id of Object.keys(db.metadata || {})) {
    const { viewCount: _legacy, ...rest } = db.metadata[id];
    const effective = effectiveViewCount(counts, db, id);
    out[id] = effective > 0 ? { ...rest, viewCount: effective } : rest;
  }
  return out;
}

// The four byte-stream routes register HERE, in their original order (no app.use or
// wildcard layer sits between /thumbnail and /video, so the routing signature is
// unchanged). `sendRangeable` and its require were built right after the transcode
// factory above (it also feeds the lib/tv + lib/music audio routes registered later).
mediaStreams.registerRoutes(app, {
  getCachedDatabase, mediaVisibleTo, trashStore, THUMBNAIL_DIR, escapeHtml, path, fs,
  storyboardPath, storyboardDescriptor, previewClipPath, previewClipEligible,
  transcodedPath, queueTranscode, resolveRokuCompat, streamLiveTranscode, markServed,
  recordServed, mime, contentDispositionAttachment, sendRangeable,
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

// sendRangeable moved to lib/media/streams.js (Wave 7b slice S8).

// GET /video/:id moved to lib/media/streams.js (Wave 7b slice S8); it registers above with the other byte-stream routes.

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

// Wave 7b (slice S3): GET /audio/:id - the background-audio sidecar byte route
// whose contract the comment block above describes - moved VERBATIM to
// lib/music/routes.js and registering here, where it sat. `ffmpegAvailable` is a
// mutable `let` this file flips from an async boot probe, so it crosses as the
// live reader `ffmpegIsAvailable()` (the ONE non-byte-identical expression in
// the slice; test/unit/music-audio-seam.test.js proves the seam live).
musicRoutes.registerAudioRoute(app, {
  audioPath,
  ffmpegIsAvailable: () => ffmpegAvailable,
  fs,
  getCachedDatabase,
  healStaleAudioReady,
  markServed,
  mediaVisibleTo,
  queueAudioExtract,
  recordServed,
  sendRangeable,
});

// Wave 7b (slice S10a): POST /api/videos/:id/prepare-audio moved VERBATIM to
// lib/media/routes.js. It registers HERE, after GET /audio/:id, exactly as
// before.
mediaRoutes.registerPrepareAudioRoute(app, {
  audioPath,
  ffmpegIsAvailable: () => ffmpegAvailable, // LIVE reader: a server.js `let` the async ffmpeg probe flips after boot
  fs,
  healStaleAudioReady, // re-derives audioStatus when the sidecar is gone
  loadDatabase,
  mediaVisibleTo,
  queueAudioExtract,
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
// through this SAME deps object -- see their own header comments (now in
// lib/ytdlp/relocation.js) for the
// full wiring-contract rationale (a `require('../../server')` from inside
// lib/ytdlp/index.js would hit a circular-require trap; this deps object is
// what avoids it, exactly like every other primitive below).
// v1.146 (downloader-engine): the bell producer for engine events (updated
// / update-failed / reverted). The id encodes the whole payload (kind
// 'engine' rows are admin-only at every read surface); a null id (unknown
// event) records nothing. Never throws into the caller - a lost bell must
// not break an install flow or a boot.
function recordEngineEvent(event, version) {
  try {
    const id = ytdlp.buildEngineNotificationId(event, version);
    if (!id) return;
    userStore.recordNotifications([{ mediaId: id, createdAt: Date.now(), kind: 'engine' }]);
  } catch (err) {
    console.error('Engine bell event failed (continuing):', err && err.message);
  }
}

ytdlp.registerRoutes(app, {
  requireManageSubscriptions, // v1.80 RBAC: gate for channel-registry mutations
  // v1.146 (downloader-engine): the engine routes are ADMIN-only - they
  // cause pip to execute code from PyPI. Same guard function POST
  // /api/settings uses; the module side fails CLOSED if this is absent.
  requireAdmin,
  // v1.146: the bell producer for engine events - shared with the
  // startBackground bundle below (its own copy of the deps object, but the
  // SAME function; the v1.29 separate-bundles lesson).
  recordEngineEvent,
  mediaVisibleTo, // v1.123 T3: visibility axis for the per-item repull/relocate routes
  // v1.127 Wave A: the req-FREE visibility snapshot for LIBRARY-WIDE reheat
  // work (batch + preview) - the per-item route got its axis in v1.123; the
  // batch and relocation preview enumerate the whole library and needed the
  // same decision in a form that survives past the 202 response.
  mediaVisiblePredicate,
  updateDatabase,
  ytdlpDb, // Wave 5: the namespace's feature store - every read + write in the module goes through it
  loadDatabase,
  scanDirectories,
  getMediaId,
  recordRepulledItemMeta,
  // v1.56 (Dean's bulk subscriber-count reheat): the channel->items fan-out
  // writer -- server.js owns db.metadata, so the module's reheat-subs batch
  // gets it deps-injected like `recordRepulledItemMeta` above.
  recordChannelFollowerCountFanout,
  // v1.115 (Dean, A1): the channel->items NAME fan-out writer (+ pin-label
  // refresh), deps-injected into the name-backfill batch the same way.
  recordChannelNameBackfillFanout,
  // v1.116 (Dean): the LOCAL-heal fan-out writer (adopts the canonical identity
  // UNIT from a same-folder sibling), deps-injected into the same batch.
  recordLocalChannelHealFanout,
  // Wave 4: the heal's display-name write goes to channel_folder_display_names
  // INSIDE the doc commit (this dep is called from within the mutator above).
  setFolderDisplayName: (name, value) => inSaveTransaction(() => folderDisplayNameStore.set(name, value)),
  enumerateRepullableItems,
  // v1.43 (chunk 4b): channel pins are per-user (user_channel_pins rows).
  // The pin routes keep lib/ytdlp/store.js's PURE reducers as the single
  // source of pin semantics and persist through this two-call backend --
  // deps-injected like every other server-owned primitive (the same
  // circular-require-avoiding bridge as the rest of this object). `list`
  // returns pin_order-sorted records (the listPins order contract).
  userChannelPins: {
    list: (userId) => userStore.getChannelPins(userId),
    replace: (userId, pins) => userStore.setChannelPins(userId, pins),
  },
  // v1.41.6: the reheat's import-relocation seam -- server.js owns the move +
  // id re-key machinery (`moveItemToFolder`) and the settings store, so the yt-dlp
  // module gets this deps-injected like every other server-owned primitive
  // (the same circular-require-avoiding bridge `recordRepulledItemMeta` uses).
  // The batch calls it per item, AFTER that item's hydration has persisted.
  relocateHydratedImport: relocateHydratedImportIntoChannelFolder,
  // v1.41.18 (Dean): the shared shell-renderer so the module's GATED
  // /subscriptions page (a native 404 when the module is off -- server.js's
  // static middleware deliberately does NOT hijack it, preserving AC3) gets the
  // SAME server-side custom-logo-class injection every other header shell does,
  // killing the text-wordmark FOUC there too.
  sendShellHtml,
  // v1.41.7 (Dean has NO media backup): the DRY-RUN preview seam. server.js owns
  // the shared `planImportRelocation` decision + the settings store, so the yt-dlp
  // module's `POST /api/ytdlp/repull-metadata/preview` route gets this deps-
  // injected like every other server-owned primitive. It is READ-ONLY -- it
  // never writes the database, moves a file, or spawns anything.
  previewImportRelocations: buildImportRelocationPreview,
  // v1.49 (Dean's per-video reheat): the SAME shared decision function the
  // executor and the library-wide preview already call, now needed for ONE
  // item -- the per-video route proposes the move to the user (destination +
  // hard-link-vs-copy) and only then, on their confirm, calls
  // `relocateHydratedImport` above. Handing the route this function rather
  // than letting it re-derive "would it move, and to where?" is what keeps
  // the confirm dialog from ever describing a move different to the one that
  // actually happens (the v1.41.7 anti-drift contract).
  planImportRelocation,
  // v1.33 T1: the reheat batch's LOCAL tags probe (cheap ffprobe, no
  // network) -- server.js owns ffmpeg/ffprobe, so the yt-dlp module gets it
  // deps-injected like every other server-owned primitive above.
  probeEmbeddedTags,
  // v1.29.0 T3: the app's own DATA_DIR (resolved above, the SAME directory
  // the database lives in) -- threaded through so lib/ytdlp/index.js's run-log
  // emit sites (`processSubscription`/`runOneShot`, via `deps.dataDir`) know
  // where to write `ytdlp-runs.jsonl`, without lib/ytdlp/index.js ever
  // resolving DATA_DIR/config.downloadDir itself (see lib/ytdlp/runlog.js's
  // own module comment).
  dataDir: DATA_DIR,
});

// v1.69 (D15): the yt-dlp "file under Podcasts" surfacing. A ytdlp sub with
// libraryPlace === 'podcasts' appears in the Podcasts place as a show whose
// episodes are its channel dir's db.metadata items - watch-page playback and
// watch-history state, untouched (D14d: dock-first parity is a follow-up).
// Server-owned (db.metadata + ytdlpConfig + userStore live here) and
// deps-injected into the podcasts module like every other bridge below.
// Gated on ytdlp.isEnabled: a disabled ytdlp module surfaces nothing (its
// routes are gone; the podcasts place must not advertise dead shows).
function ytdlpPodcastItemDateMs(item) {
  if (item && typeof item.releaseDate === 'number' && Number.isFinite(item.releaseDate)) return item.releaseDate;
  if (item && typeof item.addedAt === 'number' && Number.isFinite(item.addedAt)) return item.addedAt;
  return 0;
}
function ytdlpPodcastItemsUnder(db, dir, itemVisible) {
  const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
  const items = [];
  for (const id of Object.keys(db.metadata || {})) {
    if (!Object.prototype.hasOwnProperty.call(db.metadata, id)) continue;
    const it = db.metadata[id];
    if (it && typeof it.filePath === 'string' && it.filePath.startsWith(prefix)) {
      // v1.128 Wave B (L10/L11): these are yt-dlp MEDIA items filed under
      // Podcasts. `itemVisible` is an optional (item)->boolean predicate
      // (mediaVisibleTo bound to the requester). The EPISODES path passes it to
      // filter per-episode; the SHOWS path calls this WITHOUT it (it needs the
      // raw count to decide the all-hidden drop) and filters afterward. Absent
      // = no filtering (episodes for admin/unrestricted, and the health count).
      if (typeof itemVisible === 'function' && !itemVisible(it)) continue;
      items.push(it);
    }
  }
  items.sort((a, b) => ytdlpPodcastItemDateMs(b) - ytdlpPodcastItemDateMs(a));
  return items;
}
function listYtdlpPodcastShows(db, itemVisible) {
  const cfg = ytdlp.parseYtdlpConfig();
  if (!ytdlp.isEnabled(cfg)) return [];
  const subs = ytdlpDb.readPart('subscriptions') // Wave 5: from its table
    .filter((s) => s && s.libraryPlace === 'podcasts');
  return subs.map((sub) => {
    // v1.128 Wave B (L10, gate WARNING-1 fix): decide the show-level drop from
    // RAW-vs-VISIBLE counts, NOT from predicate-presence. `mediaItemVisible`
    // hands a predicate to EVERY requester (admin included - it just returns
    // true for all their items), so gating the drop on `typeof itemVisible ===
    // 'function'` wrongly dropped a genuinely-EMPTY external show (subscribed,
    // nothing downloaded yet) for admins too. Capture the unfiltered count so
    // the drop below fires ONLY for an all-HIDDEN show.
    let rawItems = [];
    try { rawItems = ytdlpPodcastItemsUnder(db, ytdlpArgs.resolveChannelDir(cfg, sub)); } catch (_) { rawItems = []; }
    const items = typeof itemVisible === 'function' ? rawItems.filter(itemVisible) : rawItems;
    return {
      id: `yt:${sub.id}`,
      name: sub.name || sub.channelUrl,
      author: '',
      description: '',
      source: 'ytdlp',
      paused: sub.paused === true,
      backfill: null,
      episodeCount: items.length,
      downloadedCount: items.length,
      pendingCount: 0,
      failedCount: 0,
      newestPubDateMs: items.length ? ytdlpPodcastItemDateMs(items[0]) : null,
      artUrl: items.length ? `/thumbnail/${items[0].id}` : null,
      lastStatus: typeof sub.lastStatus === 'string' ? sub.lastStatus : '',
      secretMissing: false,
      __rawCount: rawItems.length, // internal: drop decision only, stripped below
    };
  })
    // v1.128 Wave B (L10): drop a show ONLY when it HAD items but the requester
    // can see none (an all-hidden show, whose name + count would otherwise
    // leak). A genuinely-empty show (rawCount 0) is kept for EVERYONE, so admin
    // + unrestricted stay byte-identical to pre-Wave-B (for them visible==raw,
    // so this only ever keeps). An all-hidden show never occurs for an admin.
    .filter((show) => show.__rawCount === 0 || show.episodeCount > 0)
    .map((show) => { const { __rawCount, ...rest } = show; return rest; });
}
function listYtdlpPodcastEpisodes(db, showId, userId, itemVisible) {
  const shows = listYtdlpPodcastShows(db, itemVisible);
  const show = shows.find((s) => s.id === showId);
  if (!show) return null;
  const sub = ytdlpDb.readPart('subscriptions').find((s) => s && `yt:${s.id}` === showId);
  let items = [];
  try { items = ytdlpPodcastItemsUnder(db, ytdlpArgs.resolveChannelDir(ytdlp.parseYtdlpConfig(), sub), itemVisible); } catch (_) { items = []; }
  const progress = userStore.getProgress(userId);
  const watched = userStore.getWatchedTimes(userId);
  return {
    show,
    episodes: items.map((it) => ({
      id: it.id,
      subId: showId,
      title: cleanDisplayTitle(it.title || it.name || ''),
      description: '',
      link: '',
      pubDateMs: ytdlpPodcastItemDateMs(it) || null,
      durationSec: typeof it.duration === 'number' ? it.duration : null,
      status: 'downloaded',
      bytes: null,
      downloadedAt: null,
      progress: Object.prototype.hasOwnProperty.call(progress, it.id)
        ? { position: progress[it.id].timestamp, duration: progress[it.id].duration, updatedAt: progress[it.id].updatedAt }
        : null,
      played: Object.prototype.hasOwnProperty.call(watched, it.id),
      // Media items keep their watch-page playback (D14d) - the client
      // navigates here instead of dock-loading /episode/:id.
      watchHref: `/watch.html?v=${encodeURIComponent(it.id)}`,
    })),
  };
}

// v1.69: the podcasts module's deps bundle - the same circular-require-
// avoiding bridge as ytdlp's above. runExclusive is the SHARED heavy-job
// gate (lib/heavyGate), so podcast enclosure downloads serialize against
// yt-dlp polls/one-shots instead of competing for disk and network.
podcasts.registerRoutes(app, {
  updateDatabase,
  podcastsDb, // Wave 5: the namespace's feature store - every read + write in the module goes through it
  loadDatabase,
  getCachedDatabase,
  getSettings: () => settingsStore.get(), // Wave 4
  getLibraryFolders: () => folderStore.list(), // Wave 4
  getMusicFolders: () => musicDb.read().folders, // Wave 5
  getBookFolders: () => booksDb.read().folders, // Wave 5
  dataDir: DATA_DIR,
  userStore,
  // v1.73: the poll's notification bridge (route-triggered checks run the
  // same engine as the timer - both deps bundles carry pushDelivery; the
  // feature flag gates DELIVERY inside deliver.js, never the record - QA
  // gate W3).
  pushDelivery,
  runExclusive: heavyGate.runExclusive,
  sendRangeable,
  contentDispositionAttachment,
  listExternalShows: listYtdlpPodcastShows,
  listExternalEpisodes: listYtdlpPodcastEpisodes,
  recordPresenceFromPing, // v1.78: the ONE presence writer, shared by all three kinds
  episodeVisibleTo: podcastEpisodeVisibleTo, // v1.80 RBAC: per-user episode/show visibility
  // v1.128 Wave B (L10/L11): external (yt-dlp) podcast shows/episodes are MEDIA
  // items, so their per-requester visibility is the MEDIA decision, not the
  // podcast one - the module binds this to req and passes it into
  // listExternalShows/Episodes so a restricted member sees no hidden yt-dlp show.
  mediaVisibleTo,
  requireManageSubscriptions, // v1.80 RBAC gate: the podcast registry parallels the ytdlp one
  requireModifyLibrary, // v1.81 write-RBAC gate: episode delete is a CONTENT delete, not registry mgmt
});

// Start the server — but only when run directly (`node server.js`), not when
// required by the test suite. This lets tests import `app` and the pure helpers
// without binding a port or triggering a real scan.
if (require.main === module) {
  // Defense-in-depth: every genuine database write path already guards its own
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
  // `PROGRESS_FLUSH_MS` window of watch-position-only data; the database
  // itself is never left torn either way (a SQLite transaction commits whole
  // or not at all).
  const flushProgressOnExit = (exitAfter) => () => {
    // v1.37.0 books: both coalescers flush on every graceful-exit path --
    // the book flush shares the media flush's exact loss-bound contract.
    Promise.allSettled([flushPendingProgress(), flushPendingBookProgress(), flushPendingMusicProgress()]).then(() => {
      if (exitAfter) process.exit(0);
    });
  };
  process.on('SIGTERM', flushProgressOnExit(true));
  process.on('SIGINT', flushProgressOnExit(true));
  process.on('beforeExit', flushProgressOnExit(false));

  // Transcode-cache hygiene on startup: drop any orphaned *.tmp.mp4 left by a
  // killed transcode, then enforce the size cap.
  const orphans = cleanupOrphanTmp(TRANSCODE_DIR) + cleanupOrphanTmp(ROKU_COMPAT_DIR);
  if (orphans) console.log(`Cleaned up ${orphans} orphaned transcode temp file(s).`);
  // Age sweep runs as a separate step immediately before the size-cap
  // eviction (never folded into evictTranscodeCache itself).
  sweepAgedTranscodes(Date.now());
  // v1.65: trash retention sweep at boot (async, never blocks startup).
  sweepTrash().catch((err) => console.error('Trash sweep at boot failed:', err));
  // v1.38.0 T12: TTS cache hygiene -- sweep orphaned synth temps and reset any
  // stale 'processing'/'pending' or file-less 'ready' audio status.
  reconcileTtsCacheAtBoot();
  // v1.30 A3: this is the process's first-ever db read, so `getCachedDatabase()`
  // here is exactly one `loadDatabase()` call (same as before) and has the
  // added benefit of pre-warming the cache before `app.listen` below, so the
  // very first request already hits a warm cache.
  evictTranscodeCache(effectiveCacheCap(settingsStore.get())); // Wave 4
  // v1.46 (gate W3): the roku-compat cache honors a LOWERED cap at boot too,
  // not only after the next successful build.
  evictRokuCompatCache();

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
      // The safe-mode skip lives INSIDE migrateOneOffsIntoChannelFolders
      // (guarded at the function, not the call site, so it is testable and
      // covers any future caller — QA-gate warning, v1.42).
      await migrateOneOffsIntoChannelFolders({ loadDatabase, updateDatabase, getMediaId }, ytdlpStartupConfig);
    } catch (err) {
      // Never let a migration bug block startup -- log and continue exactly
      // like every other best-effort startup step above (cleanupOrphanTmp/
      // sweepAgedTranscodes never aborts startup either).
      console.error('yt-dlp one-off migration failed unexpectedly (continuing startup):', err && err.message);
    }

    // v1.51: one-shot notification-history seeding (exec-plan decision 4).
    // Best-effort like every startup step here — a seeding failure must
    // never block boot, and the un-stamped flag simply retries next boot.
    try {
      await seedNotificationHistoryOnce();
    } catch (err) {
      console.error('Notification-history seeding failed (continuing startup):', err && err.message);
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
    // v1.146: + recordEngineEvent so the engine's boot recovery and daily
    // auto-update tick can bell their outcomes (same producer as the
    // routes bundle - each bundle carries its own reference, v1.29 lesson).
    ytdlp.startBackground({
      updateDatabase, ytdlpDb, loadDatabase, scanDirectories, getMediaId, dataDir: DATA_DIR, recordEngineEvent, // Wave 5: ytdlpDb
      // Wave 4: the root list is a table; the stale-downloadDir migration reads and prunes it here.
      getLibraryFolders: () => folderStore.list(),
      removeLibraryFolder: (p) => folderStore.remove(p),
      inSaveTransaction,
      // (the channel heal's setFolderDisplayName dep lives in the ROUTES bundle -
      // the heal batch runs from there, never from the timer poll.)
    });

    // v1.69 podcasts: boot hygiene (.ptpart sweep + reconcile) + the poll
    // timer. Early-returns doing NOTHING (no dir, no timer) with zero
    // subscriptions - the fresh-install no-op guarantee. Inside this guard
    // for the same reason as ytdlp's: importing server.js for tests must
    // never arm a poll timer.
    podcasts.startBackground({
      updateDatabase,
      podcastsDb, // Wave 5
      loadDatabase,
      getCachedDatabase,
      getSettings: () => settingsStore.get(), // Wave 4: app settings are a store
      getLibraryFolders: () => folderStore.list(), // Wave 4: the root list is a table
      getMusicFolders: () => musicDb.read().folders, // Wave 5
      getBookFolders: () => booksDb.read().folders, // Wave 5
      dataDir: DATA_DIR,
      userStore,
      // v1.73: the timer-run poll notifies + pushes exactly like the
      // route-triggered one (its own deps bundle - the ytdlp lesson above).
      pushDelivery,
      runExclusive: heavyGate.runExclusive,
      now: () => Date.now(),
    });

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
        // v1.44 music: same deferred boot slot; music-less = pure no-op.
        scanMusic().catch(console.error);
        // v1.195 TV Shows: same deferred boot slot; Shows-less = pure no-op.
        scanTv().catch(console.error);
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
  // v1.166: the pure critter-folder -> manifest mapping (Sneaky critter mode).
  buildCritterListing,
  buildCritterVoicePool,
  collectCritterSoundMap,
  sanitizeCritterUploadName,
  buildStoreZip,
  CRITTER_UPLOAD_IMAGE_TYPES,
  CRITTER_UPLOAD_SOUND_TYPES,
  // 2026-07-30 hardening: exported so the capture harness's request policy
  // can assert its allowlist stays a subset of this one (twin contracts),
  // and so the audit middleware's close-path is provable with a deferred
  // handler (gate DELTA-B).
  READONLY_ALLOWED_POSTS,
  createMutationAuditMiddleware,
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
  // v1.78 device handoff: the card's display resolver (both arms + the
  // not-playable skips are bindable this way), and the presence singleton
  // itself. The singleton is exported ONLY as a test seam: it is process-wide
  // module state, so a suite that leaves entries behind would leak presence
  // into the next test file's expectations. Every handoff test clears it in
  // beforeEach.
  resolveHandoffTarget,
  resolveHomeItem,
  // v1.85 #1: exported for the unit test. Wave 7b (S1a): it moved to
  // lib/user/routes.js with the search-history routes, so this re-export is
  // the SAME function object through both doors (the Wave 6 extraction rule).
  normalizeSearchTerm: userRoutes.normalizeSearchTerm,

  isFinishedPresence,
  HANDOFF_FINISHED_PCT,
  __presenceForTests: presence,
  // v1.37.0 books: scanner + state accessor + cover dir, exported for the
  // books integration tests (same posture as scanDirectories/THUMBNAIL_DIR).
  scanBooks,
  // v1.38.0 TTS: boot reconcile (stale-status/orphan-temp sweep), exported for
  // direct test coverage (mirrors reconcileTranscode's own testing contract).
  reconcileTtsCacheAtBoot,
  currentBookScanState,
  BOOKCOVER_DIR,
  // v1.44 music: scanner + state accessor + art dir + probe/art helpers,
  // exported for the music integration tests (same posture as scanBooks/
  // BOOKCOVER_DIR). probeMusicTrack/extractAlbumArt are injected in tests via
  // stubs where ffmpeg is absent.
  scanMusic,
  currentMusicScanState,
  ALBUMART_DIR,
  albumArtExists,
  musicCodecNeedsTranscode,
  // v1.195 TV Shows: scanner + state + probe/thumb helpers (same export posture as
  // scanMusic; probeTvEpisode/extractTvThumb are ffmpeg spawns, injected/absent in CI).
  scanTv,
  runTvScan,
  currentTvScanState,
  TV_THUMB_DIR,
  probeTvEpisode,
  flushPendingMusicProgress,
  currentMusicProgressFlushTimer,
  effectiveMusicProgress,
  __getMusicProgressFlushWriteCount,
  flushPendingBookProgress,
  currentBookProgressFlushTimer,
  effectiveBookProgress,
  __getBookProgressFlushWriteCount,
  matchRootFolder,
  // C1 (v1.24 UX Round, Wave 3): move-files + id re-key -- re-exported so
  // tests (and T19's Wave 7 physical-reconcile move) can call these directly.
  // See the functions' own comments (above `POST /api/videos/:id/move`) for
  // the full confinement + re-key design.
  computeMoveTarget,
  moveItemToFolder,
  trashItem,
  restoreTrashItem,
  purgeTrashItem,
  sweepTrash,
  configuredLibraryRoots,
  getMediaId,
  // T4 (v1.25 QoL): the one-time flat-one-off-into-channel-folder migration --
  // re-exported so tests can call it directly (mirroring T9's own
  // moveItemToFolder export above) without booting a real server process.
  migrateOneOffsIntoChannelFolders,
  // Metadata+subtitle re-pull backfill (v1.25 QoL follow-up): re-exported so
  // tests can call these directly (mirroring `moveItemToFolder`'s own
  // testing contract) without booting a real server process. See their
  // header comments (in lib/ytdlp/relocation.js) for the full
  // deps-bridge wiring contract lib/ytdlp/index.js's `registerRoutes` uses.
  recordRepulledItemMeta,
  // v1.56: the bulk sub-count reheat's channel->items fan-out writer --
  // exported for direct test coverage, same posture as recordRepulledItemMeta.
  recordChannelFollowerCountFanout,
  // v1.115 (Dean, A1): the name fan-out writer + the pure pin-label refresh --
  // exported for direct test coverage.
  recordChannelNameBackfillFanout,
  refreshPinLabelsForBackfilledChannel,
  // v1.116 (Dean): the local-heal fan-out writer -- exported for direct tests.
  recordLocalChannelHealFanout,
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
  resolvePushMeta, // v1.73: bindable push-meta arms (adversarial W1)
  normalizeScanRoot,
  loadDatabase,
  saveDatabase,
  updateDatabase,
  // v1.42: the coherent wipe-and-replace primitive (restore endpoint + the
  // tests' between-case reset — pre-v1.42 tests deleted the JSON file between
  // cases; an OPEN SQLite database cannot be deleted out from under its
  // connection, so tests call __resetDatabaseForTests() instead). See
  // replacePersistedState's own comment for the F5 coherency contract.
  replacePersistedState,
  __resetDatabaseForTests,
  __failNextSaveForTests,
  __getPersistedStateEpoch,
  // v1.43: test-only session minting. Creates an admin if none exists and
  // returns a valid session cookie header value, so pre-auth integration
  // suites authenticate through the REAL gate (the gate's security is proven
  // by lib/auth's unit suites + the auth-flow integration test; other suites
  // just need to be logged in to test what they test). NOT an auth bypass —
  // it produces a genuine cookie exactly like a browser login would.
  __mintTestSession,
  __clearUsersForTests,
  // Wave 1 (relational-migration arc): the media view-count store, exported
  // so integration tests seed and read counts through the SAME API the
  // routes use (the doc-model `viewCounts` key is refused by the save-lock).
  viewCountStore,
  // Wave 2: the frozen pre-auth positions + the deferred-delete tombstones
  // (their doc keys are refused by the save-lock too), and the in-save
  // transaction hook for tests that bind the atomicity contract.
  progressStore,
  tombstoneStore,
  inSaveTransaction,
  // Wave 3: the trashed-item records.
  trashStore,
  settingsStore, // Wave 4
  folderStore, // Wave 4
  folderSettingsStore, // Wave 4
  folderDisplayNameStore, // Wave 4
  likedStore, // Wave 4
  tvDb, // Wave 5
  musicDb, // Wave 5
  booksDb, // Wave 5
  podcastsDb, // Wave 5
  ytdlpDb, // Wave 5
  __failNextRestorePopulateForTests, // Wave 5: the mid-populate rollback seam
  // v1.66: push test seams - swap the transport (capture/starve sends with
  // no network), swap the SSRF guard's DNS lookup (fixture endpoints), and
  // drive a delivery round directly.
  __setPushTransportForTests,
  __setPushGuardLookupForTests,
  pushDelivery,
  userStore,
  AUTH_COOKIE_NAME,
  // v1.42 AC7: the Node-floor predicate, exported so the boot check's
  // boundary (22.13 = first unflagged node:sqlite) is testable without
  // spawning per-version binaries.
  nodeVersionSupported,
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
  pendingProgressKey,
  PROGRESS_FLUSH_MS,
  effectiveProgress,
  flushPendingProgress,
  currentProgressFlushTimer,
  // v1.43 (per-user coalescer): the flush no longer writes the doc tables, so
  // AC4.1's write-amplification claim is asserted against this counter (one
  // increment per committed user_progress batch transaction) instead of
  // __getSaveDatabaseCallCount.
  __getProgressFlushWriteCount,
  __getSaveDatabaseCallCount,
  reconcileTranscode,
  parseFfprobeTags,
  // v1.48 gate fix (adversarial SUGGESTION S1): exported for direct testing,
  // mirroring parseFfprobeTags/reconcileTranscode's own testability posture.
  applyCapturedViewCount,
  // Wave 6 (scan extraction): the follower-count sibling and the subtitle
  // detection were the only two moved helpers this list did not already carry.
  // Both are re-exported for the same reason every sibling above is - a test
  // must be able to reach the SAME function object through either door.
  applyCapturedFollowerCount,
  applyHasSubtitlesDetection,
  // v1.51 notification bell (unit/integration surface; userStore is already
  // exported above).
  collectDownloadNotification,
  seedNotificationHistoryOnce,
  // v1.53 gate round 2 (M21): deterministic single-flight testing -- the
  // latch is module state, and a real stalled-mover race is untestable
  // without it. Test-only, the __-prefix convention.
  // Wave 7b (slice S10a): the latch moved to lib/media/routes.js with the two
  // bulk routes that assign it, so this re-exports THAT module's setter as the
  // SAME function object - the only way the seam can still reach the one
  // variable the routes read.
  __setAttributeBulkInProgressForTests: mediaRoutes.__setAttributeBulkInProgressForTests,
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
  orderScannedByRecency, // v1.94.1: newest-first scan ordering (pure, unit-tested)
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
  // v1.92 storyboard sprites (pure): planner, arg-builders, gate, path.
  planStoryboard,
  buildStoryboardFrameArgs,
  buildStoryboardAssembleArgs,
  shouldGenerateStoryboard,
  storyboardPath,
  // v1.93.2: derived (not persisted) storyboard descriptor - serve/scan/client
  // all key off the on-disk sprite + this pure derivation.
  storyboardDescriptor,
  // v1.92 storyboard generation + on-disk-keyed heal (integration-tested).
  extractStoryboard,
  restoreMissingStoryboard,
  // v1.94 preview clip (hover): path, derived eligibility, generation + heal.
  previewClipPath,
  previewClipEligible,
  extractPreviewClip,
  restoreMissingPreviewClip,
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
  // lib/ytdlp (see AC1-9 in docs/exec-plans/completed/2026-07-05-yt-dlp-integration-module.md).
  currentYtdlpPollTimer: ytdlp.currentYtdlpPollTimer,
  parseYtdlpConfig: ytdlp.parseYtdlpConfig,
  isEnabled: ytdlp.isEnabled,
};
