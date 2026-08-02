# Architecture

<!-- This file is generated during onboarding by scanning the existing codebase. -->
<!-- If hydrating into a brownfield repo, the onboarding agent populates this. -->
<!-- If greenfield, fill this in as the project takes shape. -->

## Overview

FileTube is a single-process Node.js/Express monolith that turns local media
folders into a self-hosted, YouTube-style streaming site. The server scans
configured folders, uses FFmpeg/FFprobe to extract durations and thumbnails,
persists lightweight metadata to a JSON file database, and serves both a static
retro web UI and Range-aware media streaming endpoints. Browser-incompatible
containers (e.g. AVI) are transcoded to MP4 — lazily and on demand — so mobile
clients (iOS Safari) can play them.

## Components

- **`server.js`** — the entire backend: Express routes, folder scanning, the
  JSON database (`db.json`), FFmpeg metadata/thumbnail extraction, the
  single-worker transcode queue, and the `/video/:id` streaming endpoint.
- **`public/`** — static frontend (HTML + CSS + vanilla JS). `public/js/watch.js`
  drives the watch page, including desktop live-transcode playback and the
  mobile lazy-transcode "preparing…" overlay + polling. ALL styling (CSS and
  JS-applied) runs on the governed design-token system — see the MANDATORY
  section in `docs/CONTRIBUTING.md` and the contract in
  `docs/references/design-token-audit-v1.1.md` before changing any style value.
- **FFmpeg / FFprobe** — external binaries invoked via `child_process.spawn` for
  thumbnails, duration probing, and transcoding to H.264/AAC MP4.
- **Data directory (`data/`)** — persistent state: `db.json` (metadata),
  `thumbnails/`, and `transcoded/` (cached MP4 sidecars).
- **Docker** — `Dockerfile` (Node 22 Alpine + ffmpeg) and `docker-compose.yml`
  for deployment; media folders and `data/` are mounted as volumes.
- **`lib/ytdlp/` — optional yt-dlp subscription module (v1.11.0, dormant by
  default).** A self-contained directory of pure helpers (config/ENV parse, URL
  allowlist, argument-array builders, path-confinement resolver, `shouldSkip`
  rules, premiere poll-and-defer, archive dedup) plus a thin wiring surface
  (`registerRoutes`, `armYtdlpTimer`/`currentYtdlpPollTimer`, `runPoll`,
  `startBackground`). It is **inert unless `FILETUBE_YTDLP_ENABLED` is truthy**:
  `require()`-ing it is side-effect-free, and every side effect (route
  registration, poll arming, directory creation, presence check) early-returns
  when disabled — so with the flag off FileTube is byte-identical to today (no
  `/subscriptions` route or nav link, no poll timer, no yt-dlp assumption). When
  enabled it spawns a **pinned, bundled** yt-dlp as a child process
  (arg-array, never a shell) to download channel subscriptions into
  `FILETUBE_YTDLP_DOWNLOAD_DIR`. Each channel's metadata LISTING is capped to
  its newest `FILETUBE_YTDLP_MAX_VIDEOS` videos (default 25; `0` = unlimited)
  via yt-dlp's own `--playlist-end` flag, so a fresh subscribe never attempts
  a channel's entire back-catalog. The download tree is scanned via a
  **module-owned scan root** (`extraScanRoots()`, merged into the scanner's
  folder set) rather than by injecting into the client-owned `db.folders` — so
  the existing scanner indexes the results (one source of truth, normal delete
  semantics) while `GET`/`POST /api/config` never see or evict it.
  `extraScanRoots()` contributes the resolved download directory whenever
  **the module is enabled OR the directory exists on disk** (an OR-gate, not
  either condition alone):
  - **never-enabled** ⇒ the directory was never created ⇒ inert, `[]` —
    byte-identical to a never-enabled install (the fresh-install no-op
    guarantee is unchanged).
  - **enabled** ⇒ always contributed, **unconditionally, even if the
    directory is transiently absent** (an NFS/external-drive unmount, a
    rename, or an EACCES) — this is deliberate: it is what lands the download
    root in the scanner's `missingRoots` set so the mandatory mount-loss guard
    (below) protects previously-downloaded content instead of the default-on
    prune-missing pass reaping it. (An earlier revision of this gate checked
    only `fs.existsSync`, dropping the enabled flag from the decision
    entirely — an infra hiccup while enabled would then silently defeat the
    mount-loss guard and permanently delete downloaded content's metadata,
    thumbnails, transcode sidecars, and watch-progress. Fixed: enabled always
    means "a scan root," full stop.)
  - **was-enabled-then-disabled, directory still holds content** ⇒ still
    contributed (`fs.existsSync` is true) ⇒ still scanned, so the default-on
    prune-missing pass never deletes that content just because the module was
    turned off (disabling stops new downloads and polling, but never destroys
    what was already downloaded).
  - **disabled AND the directory is simultaneously, transiently absent** ⇒
    `[]` — a **known, narrow limitation**: with the module off, a volume
    unmount coinciding with that off state is unprotected (the same reap the
    mount-loss guard would otherwise prevent). This is inherent to
    deliberately NOT persisting a "managed root" marker independent of
    `config.enabled`/`fs.existsSync` (see the module-owned scan-root design
    above) — not closed by design; revisit only if it proves to bite in
    practice.
  Subscriptions persist in `db.json` under `db.ytdlp` via the same
  `updateDatabase` primitive; dedup is yt-dlp's own `--download-archive` file
  (a deleted video stays recorded, never re-downloaded) — FileTube's own
  delete/prune-missing paths intentionally never touch this file (only the
  media metadata/thumbnail/transcode sidecar), so a deleted download stays
  gone across future polls. This guarantee is only as durable as the archive
  file itself: it lives inside `FILETUBE_YTDLP_DOWNLOAD_DIR`, so if that
  directory is a network share (SMB/NFS) that is transiently unmounted at
  poll time, or is wiped outright, dedup state is lost and a subsequent poll
  re-downloads each subscribed channel's videos up to its `maxVideos` window
  — keep the download directory on stable, always-mounted storage. A **second,
  deliberately-separate** dotfile lives beside the archive:
  `.ytdlp-skiplist.txt` (v1.37.5), the permanent per-video SKIP list a user's
  "Skip" action on a failed-download row writes to (`args.resolveSkiplistPath`
  / `index.js` `recordSkip`). It shares the archive's `<extractor> <id>` line
  format (so `rules.isArchived` doubles as its membership check) and the
  survivor loop consults it once per cycle to exclude skipped ids from every
  channel's downloads forever — kept distinct from the archive so "already
  downloaded" and "deliberately rejected" never bleed together (a skip stays
  independently inspectable, and clearing the archive to force a re-download
  never un-skips a rejected video). The poll mirrors
  `armScanTimer` (`.unref()`'d, re-armable, off when the interval is 0), and
  long downloads run OUTSIDE the `updateDatabase` lock (only a short
  last-checked/status write re-enters it). Security-critical surface (command
  injection, path traversal, cookies handling); ships behind the full
  two-reviewer QA gate.
- **`lib/ytdlp/runlog.js` — durable, capped per-run history (v1.29.0).** A
  small module-owned writer/reader for a JSON Lines file, `ytdlp-runs.jsonl`,
  living in the same directory as `db.json` (the app `DATA_DIR`, NOT
  `FILETUBE_YTDLP_DOWNLOAD_DIR` — the log is app state, not media, and must
  stay on stable local disk even when downloads target a network share). It is
  **separate from `db.json`** deliberately: an append-mostly history must not
  bloat the re-read-merge-on-save `db.json` snapshot or contend on the
  `updateDatabase` mutex. Each **completed** run (subscription poll cycle or
  one-shot) appends exactly ONE terminal line: `{ ts, kind, id, name, outcome
  (success|partial|error|cancelled), succeeded, failed, reason, failures[] }`,
  every string sanitized/bounded by the same `sanitizeReason`/
  `MAX_REASON_LENGTH` (lib/ytdlp/failures.js) and `MAX_STATUS_LENGTH`
  (lib/ytdlp/index.js) posture the live status already uses. The file is
  **bounded**: each write reads, trims to the newest `YTDLP_RUNLOG_MAX_ENTRIES`
  (500) lines, and atomically rewrites (temp file + `rename`, mirroring
  `saveDatabase`), so it can never grow without bound. It obeys the same
  disabled-module no-op guarantee as the rest of `lib/ytdlp`: the writer is
  only ever called from enabled-only code paths and the read route
  (`GET /api/subscriptions/history`) is registered only inside the
  `isEnabled`-gated `registerRoutes`, so with `FILETUBE_YTDLP_ENABLED` off no
  file is ever created and no route is reachable. `/subscriptions` renders this
  log as a capped download-history list.

## Data flow

1. **Scan:** on startup / rescan, the server walks configured folders, and for
   each media file computes a stable id (hash), probes duration, extracts a
   thumbnail, and reconciles transcode status — writing all of it to `db.json`.
   Scanning does **not** transcode anything.
2. **Browse:** the frontend fetches metadata via JSON API endpoints and renders
   the grid/watch UI, using `/thumbnail/:id` for posters.
3. **Playback:** the client hits `/video/:id`, which serves the file with HTTP
   Range support. For AVI/incompatible containers: desktop requests `?live=1`
   (live FFmpeg pipe, not written to disk); mobile triggers a lazy, one-at-a-time
   transcode to a cached MP4 in `data/transcoded/` and polls until ready.

## Key decisions

<!-- Record significant architectural decisions here. -->

- **Lazy transcoding:** AVIs are converted only when actually watched on mobile,
  not up front on scan, to avoid converting the whole library (huge disk cost).
- **Single-worker transcode queue:** jobs run one at a time (`transcodeBusy`
  gate) to avoid overloading a home server with parallel FFmpeg runs.
  v1.27.0 added a second, independent single-worker queue for background-audio
  extraction (`audioExtractBusy`), so up to 2 FFmpeg processes can run
  concurrently — deliberate: a slow video transcode must never starve a
  background-audio prewarm. Revisit if on-device CPU contention shows.
- **Atomic MP4 finalize:** transcodes write to a `.tmp.mp4` and are renamed on
  success, so a half-written file is never served.
- **JSON file database:** `db.json` instead of a real DB — simple, portable,
  good enough for a single-user home media server.
- **Server-side automation settings:** scan cadence, prune-on-scan, and transcode-
  cache size/age limits are persisted in a top-level `db.settings` object (not
  per-browser `localStorage`), backfilled with defaults on load like
  `folderSettings`. Scan pruning carries a mandatory mount-loss guard: a
  missing/unmounted root folder never prunes its library entries (a mount failure is
  not a deletion). The periodic scan is armed by `armScanTimer()`, which reads
  `db.settings.scanIntervalMinutes` and re-arms live (no restart) whenever
  `POST /api/settings` changes it; `GET/POST /api/settings`, `GET /api/cache/size`,
  and `POST /api/cache/clear` expose these settings and the transcode-cache
  housekeeping to the Settings UI.
- **Re-read-merge-on-save (concurrency invariant):** every `db.json` writer
  (`setTranscodeStatus`, `recordServed`, the scan's final merge, `POST
  /api/config`, `POST /api/settings`, `POST /api/progress`, `DELETE
  /api/videos/:id`) is serialized through one in-process async-mutex,
  `updateDatabase(mutatorFn)` — a module-level promise chain that, per call,
  loads a FRESH `db` from disk, applies the caller's synchronous mutator, and
  (unless the mutator returns `false`) saves atomically. Because the read,
  mutate, and save happen inside one serialized critical section, no two
  writers can ever race a read-modify-write against each other; a failed
  mutation is isolated so it rejects only that caller's promise and never
  wedges the chain for subsequent writes. `saveDatabase` itself is atomic
  on disk (write to a unique same-directory temp file, `fsync`, then
  `rename` over `db.json`), so a crash mid-write can never leave a
  half-written/truncated database — the temp is cleaned up on any failure
  and the original is left intact. Readers (`loadDatabase()`) are
  unchanged: every GET route still reads fresh from disk and never observes
  a torn file, thanks to the atomic rename. The long-running scan still
  never writes back a whole-`db.json` snapshot taken at its start —
  concurrent writes (settings, folders, watch progress, `lastServedAt`)
  would be clobbered — but instead of a standalone explicit re-read, its
  final merge (root backfill, the FR3.3 `transcodeStatus` seed,
  `mergeScannedMetadata`, and the progress/`persistedServedAt` prune) runs as
  ONE `updateDatabase` mutator, so it merges into the fresh
  db-at-lock-time rather than overwriting the scan's start-of-scan snapshot;
  `db.metadata[id].lastServedAt` is never regressed by this merge (the
  on-disk value is the source of truth; in-memory serve maps like
  `persistedServedAt` are only write-throttles). The scan's FFmpeg-awaiting
  extraction loop runs entirely OUTSIDE the lock, so writes stay unblocked
  for the whole scan — only the final synchronous merge+save is serialized.

- **In-memory DB read cache (v1.30, A3):** hot GET routes
  (`/thumbnail/:id`, `/video/:id`, `/audio/:id`, `/api/videos`,
  `/api/videos/:id`, `/api/progress/:id`, `/api/config`, `/api/settings`,
  `/api/scan-status`, subtitles) read through `getCachedDatabase()` instead of a
  per-request `loadDatabase()` (readFileSync + `JSON.parse` of the whole db).
  The cache is a read-through of the *last committed write*: `updateDatabase`
  still loads a FRESH copy from disk inside the lock, applies the mutator, and
  `saveDatabase`s atomically — the re-read-merge-on-save invariant above is
  UNCHANGED — and, on a successful save, sets the cache to the just-saved object
  inside the same synchronous critical section (no `await` between save and
  cache-set). Coherency rests on: one serialized writer chain; Node's
  single-threaded synchronous readers (a reader runs entirely before or after a
  write's tick, never interleaved); this process being the ONLY writer of
  `db.json`; and the cached object being replaced by reference, never mutated in
  place. This is why deferring SQLite is safe at this scale (the whole db is
  ~1 MB and lives in memory); see the v1.30 Design's A6 verdict and tech-debt
  tracker #28 for the revisit triggers.
- **Batched progress writes (v1.30, A4):** `POST /api/progress` no longer does a
  whole-file write+fsync per 4 s ping. Latest-position-wins entries accumulate in
  an in-memory `pendingProgress` map and flush as ONE atomic `updateDatabase`
  write per ≤5 s window (and once more on `SIGTERM`/`SIGINT`/`beforeExit`).
  Reads overlay `pendingProgress` over the cache for read-your-writes. This is a
  DELIBERATE, BOUNDED durability relaxation for WATCH POSITION ONLY: a hard
  `SIGKILL` can lose ≤5 s of watch position, never corruption, never anything
  else. Every OTHER mutation (delete, config, settings, scan final-merge, the
  `db.liked` routes) keeps the 1:1 atomic-write+fsync guarantee unchanged.
- **Paginated `/api/videos` (v1.30, A5):** the endpoint now takes
  `limit`/`offset` (default 60/0) plus server-authoritative `sort`, `format`,
  and `seed` (for stable `random` across pages), in addition to the existing
  `search`/`folder`/`root`. It applies filter+sort across the FULL library
  before slicing, and returns `{ items, total, offset, limit }` (was a bare
  array). The client renders the first page and appends one page per
  IntersectionObserver sentinel trigger. Sort/filter/search semantics therefore
  apply across the whole library, not just the first window. The comparators/
  predicates live in the pure `lib/videoQuery.js` module (shared contract with
  the client's `sortItems`/`filterByMediaType`).
- **Cooperative, non-blocking scan (v1.30, A2):** `POST /api/scan` returns `202`
  immediately (fire-and-forget, like `POST /api/config`) and the walk runs
  cooperatively (async `fs.promises` + batch-yielding every N entries) so it
  never blocks the event loop for more than a bounded stretch; the boot scan is
  kicked off AFTER `app.listen` so route serving is never gated behind it. The
  client polls `/api/scan-status` (now carrying `processed`/`total`/`phase`) and
  refreshes the grid in place on completion — never `window.location.reload`.
  The overlap-coalescing guard, mount-loss/prune protections, and incremental
  ffprobe/thumbnail reuse are all preserved (the walk is made cooperative INSIDE
  the existing guard, not around it).
- **`db.liked` (v1.30, C2):** a top-level array of media ids; "like" state IS
  membership in this Liked collection (no separate boolean flag). Managed via
  `POST`/`DELETE`/`GET /api/liked`, each a real mutation through
  `updateDatabase` (atomic, backfilled to `[]` by `loadDatabase` like the other
  top-level keys).

## Constraints

- Single-node, single-process; state lives on local disk (no external services).
- Requires FFmpeg/FFprobe on PATH; without them, metadata/transcode features degrade.
- Node.js 22 LTS (`engines` >=22.13.0 - node:sqlite needs it).
- The transcode cache in `data/transcoded/` is **bounded**: a size-capped LRU
  eviction (default 5 GB, `TRANSCODE_CACHE_MAX_BYTES`/UI override) plus an optional
  age-retention sweep (default 30 days) keep it from growing unbounded. Age is keyed
  off a FileTube-controlled `db.metadata[id].lastServedAt` timestamp (filesystem
  atime is only a fallback, being unreliable under `relatime`/`noatime`).
- iOS Safari cannot play a non-seekable live stream, which is why mobile uses the
  pre-transcoded, seekable MP4 path.

## Podcasts module (v1.69.0)

A fourth media class: podcast RSS subscriptions (free feeds and private
tokened ones - Patreon's "listen in other podcast apps" export) downloaded
as an offline audio cache and browsed in a first-class Podcasts place.
Design record: `docs/exec-plans/active/v1.69-podcasts-place.md` (moves to
`completed/` at its Stop).

- **Namespace**: `db.podcasts` (`subscriptions/episodes/settings`), owned by
  `lib/podcasts/store.js` (ensure/read split, the music discipline). Episode
  records are guid-derived-id keyed and DOUBLE as the download archive: a
  `tombstone`/`deleted-on-disk` record blocks re-download forever (the ytdlp
  "deleted stays gone" law). No scanner and no `db.metadata` involvement -
  the engine writes episode records itself, structurally retiring the
  persist-gate class (the books precedent).
- **SECRETS**: a feed URL is a CREDENTIAL (Patreon `?auth=` tokens; the
  enclosure URLs embed the same token). Full URLs live ONLY in
  `<DATA_DIR>/podcast-feeds.json` (0600, atomic writes, corrupt-file
  preserved aside), which is structurally outside backup bundles; db records
  carry origin+pathname display form only, and EVERY feed-derived string
  (guid/link/title/description/author - the parser's guid fallback adopts
  the enclosure URL, which carries the token) passes `redactSecretText`
  (stored secrets + generic token shapes) at the persist boundary, as do
  error/status strings. Raw enclosure URLs live in memory only for the
  duration of a poll cycle (re-derived from the fresh feed each time -
  Patreon signs them with expiring tokens anyway); what persists is at
  most their redacted form. (v1.69 gate #2: the boundary redaction exists
  because a guid-less item or a feed echoing its own tokened URL in prose
  measurably leaked into the db/backup/API before it.) Consequence,
  disclosed: a bundle restored onto a fresh box marks tokened subs
  `secretMissing` and the UI asks for the URL again (same-feed display-form
  match required).
- **Fetching**: `lib/podcasts/fetchGuard.js` on the shortlink.js SSRF
  envelope - guardHop (literal private/loopback reject + fail-closed DNS
  resolve-then-check) on the start URL and EVERY manual redirect hop, for
  feeds AND enclosures (feed-author-controlled = hostile). Enclosures
  stream to a dot-prefixed `.ptpart` then fsync + atomic rename; any
  failure unlinks the partial (a kill loses at most one partial, swept at
  boot). Caps: 25 MB feeds, 2 GB/episode, absolute wall-clock deadlines.
  Downloads serialize through the server-wide heavy-job gate
  (`lib/heavyGate.js`, extracted verbatim from lib/ytdlp at v1.69 T2) so a
  42 GB back-catalog backfill never runs alongside a yt-dlp job.
- **Parser**: `lib/podcasts/feed.js`, a bounded indexOf scanner - NOT an
  XML parser. No entity-expansion machinery exists, so XXE/billion-laughs
  are structurally inert; caps everywhere with truncation FLAGS (silent
  truncation forbidden); malformed input degrades, never throws.
- **Files**: `<root>/<sanitized show title>/<title, <=100ch> [rss=<guidKey>].mp3`
  (the universal bracket - `extractMediaRef` parses these with zero
  changes); root = `db.podcasts.settings.downloadDir` >
  `FILETUBE_PODCASTS_DIR` > `<DATA_DIR>/podcasts`, confined by the
  resolveChannelDir two-line defense and joined to the FOUR-way
  media/books/music/podcasts root-overlap rejection. Show cover downloads
  once as `cover.jpg|png`. Reconcile tombstones `deleted-on-disk` only
  while the root EXISTS (the mount-loss law); an unmounted root prunes
  nothing.
- **Per-user state**: schema v9 `user_podcast_progress` +
  `user_podcast_played` (resume + played latch, manual toggle + >=95%
  auto-latch), episode-id keyed - the TENTH id-keyed carrier: delete half
  `removePodcastEpisodeState`, NO re-key half by construction (ids derive
  from guid, not path), per-user backup halves ride the users bundle.
  Progress pings are direct row upserts (no coalescer): SQLite row writes
  are cheap and podcast listening is low-concurrency - revisit only if
  write volume ever shows.
- **The place**: `/podcasts` (shell + lazy `/js/podcasts.js` view), a
  Library-section nav entry gated on CONTENT (>=1 show; zero subscriptions
  renders byte-identical chrome). Episodes play in the DOCKED mini-player
  with `resumeMode: 'podcast'` - ALWAYS resumes silently (the music 600s
  smart-restart rule deliberately not inherited). A yt-dlp subscription
  toggled `libraryPlace: 'podcasts'` (D15) surfaces as a show whose
  episodes are its channel dir's db.metadata items - watch-page playback
  and watch-history state, read-only played latch.
- **No destructive per-episode verb ships in v1.69** (amended at T7): the
  v1.65 trash machinery is welded to db.metadata, and a bare unlink would
  violate the every-delete-is-recoverable law - sub deletion keeps files
  on disk (disclosed in the confirm), external deletions reconcile to
  tombstones. A trash-integrated episode delete is tracked tech debt.

## Books module (v1.37.0)

A third media class alongside video/audio: EPUB + PDF libraries scanned from
operator-configured folders, read in-app, with per-book position/percent
progress. Design record: `docs/exec-plans/active/v1.37.0-books.md`.

- **Namespace**: everything lives under `db.books`
  (`folders/items/progress/pins/settings`), owned by `lib/books/store.js`
  (`ensureBooks` backfill). Deliberately NOT `db.metadata`: the media scan's
  Phase-2 merge never sees books, structurally retiring the persist-gate bug
  class for this feature. Book ids reuse `getMediaId(filePath)`.
- **Scanner**: `lib/books/scan.js` (pure walk/extract) + `scanBooks()` in
  server.js (own `bookScanState` with the media scan's overlap/coalescing
  discipline; boot/manual/config-save/interval-piggyback triggers). EPUB
  metadata comes from a dependency-free zip reader (`lib/books/zip.js`,
  central-directory authority, zip-bomb caps) + a scoped OPF scanner
  (`lib/books/opf.js`); covers extract to `DATA_DIR/.bookcovers/`. Every
  malformed book degrades to a filename-titled card -- never a scan abort.
  Book roots may not overlap media roots (rejected at config save, both
  directions).
- **Serving**: `GET /api/books` (videos-contract parity + `filter=reading`),
  `GET /api/books/:id` (spine + locator), `GET /book/:id/file` (native 206
  ranges), `GET /bookcover/:id` (real cover else escaped SVG placeholder),
  `POST /api/books/:id/cover` (the PDF page-1 client backfill: magic-sniffed,
  no-clobber). Progress pings coalesce in a books-owned twin of the v1.30
  progress coalescer.
- **Client**: `/books` (cover-card grid, shelf chips w/ pin toggles) and
  `/read.html?b=<id>` (reader chassis; vendored epub.js/JSZip/pdf.js under
  `public/vendor/`, lazily loaded by the reader only). Locators:
  `{kind:'epub', cfi, spineIndex, blockIndex}` / `{kind:'pdf', page}` --
  `blockIndex` counts block elements (`READER_BLOCK_SELECTOR` in read.js) and
  is the dual-implementation contract for wave-2 TTS "Listen from Here".
  Shelf pins join the existing pinned-playlists sidebar via `fetchAllPins` +
  the one deliberate renderer widening (optional `href`).
- **Disabled-module posture**: zero configured folders = no nav link, no home
  row, no scans, no db writes -- byte-identical chrome (the ytdlp guarantee).
- **Wave 2 (v1.37.1, designed not built)**: server-side TTS (Piper default /
  espeak-ng fallback, strictly opt-in binaries), one-chapter-at-a-time
  serialized synthesis to `DATA_DIR/tts-cache/<key>.m4a` +
  `<key>.blocks.json` (blockIndex -> startSec: the Listen-from-Here index),
  played through the existing background-audio machinery.
