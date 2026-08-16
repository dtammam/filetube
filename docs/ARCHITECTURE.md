# FileTube Architecture

Current-state reference, rewritten 2026-08-15 (v1.124.1) - the previous edition
described the pre-v1.42 db.json era. Facts here are anchored to real files;
when this document and the code disagree, the code wins and this file is the
bug. History lives in ROADMAP.md and docs/exec-plans/completed/, not here.

**Visual companion: [docs/DIAGRAMS.md](DIAGRAMS.md)** (v1.135) - the module
map, data model, scan pipeline, watch/stream flow, and client/player
lifecycle as Mermaid diagrams, checker-bound by
`test/unit/docs-diagrams-census.test.js` so they cannot silently rot.

FileTube is a self-hosted media server styled after old-school YouTube: a
Node.js/Express monolith that scans local folders, extracts durations/
thumbnails/chapters via FFmpeg, and streams video, audio, books, and podcasts
to a retro web UI - transcoding browser-incompatible containers on demand.
One process, one SQLite file, no server-side runtime deps beyond ffmpeg and
(optionally) yt-dlp.

## System overview

- **`server.js`** (~17k lines) - the monolith host: boot/env, the DB
  load/save/update/cache layer, the media scan + every FFmpeg pipeline
  (transcode/audio/storyboard/preview/Roku/TTS queues), trash, move/relocate,
  auth routes + user management, the books and music route surfaces,
  backup/restore, notifications, queue, stats, and byte streaming
  (`sendRangeable`). ~140 route registrations.
- **`lib/`** (~28k lines of server-side modules; excludes lib/ytdlp's
  browser-served client assets under `client/` + `views/`) - extracted modules. Two own their whole route
  surface via `registerRoutes(app, deps)` with dependency injection:
  `lib/podcasts/` and `lib/ytdlp/`. The rest are pure/feature libraries the
  monolith calls (see the inventory below).
- **`public/`** - the client: static page shells + an SPA-lite router that
  swaps only `#view-root`, one persistent player host, one token-governed
  stylesheet.
- **`roku/`** - a sideloadable BrightScript channel speaking the same API.

## Storage - SQLite via `node:sqlite`

**`lib/db/sqlite.js` is the only file allowed to touch `node:sqlite`**
(source-locked by `test/unit/db-sqlite-source-lock.test.js`; the API is
experimental on both supported Node versions, so an API shift is a one-file
fix). The store is `DATA_DIR/filetube.db`, WAL mode (falling back to DELETE on
network filesystems, with a log line), `PRAGMA foreign_keys = ON`,
`BEGIN IMMEDIATE` transactions.

Schema version: `PRAGMA user_version`, currently **18**
(`SCHEMA_VERSION`, lib/db/sqlite.js). `migrateSchema()` is a forward-only
chain and blocks are **APPEND-ONLY once executed** - editing an executed block
strands existing databases (this happened; the lesson is written into the
source). A late table gets a new version, full stop. Since v1.127 two more
rules apply (see RELEASING.md "Schema versions and the rollback floor"): any
new persisted NAMESPACE bumps the version in the same commit (v18 is such a
marker, for v1.126's `folderDisplayNames`), and a build REFUSES at boot any
database stamped newer than itself. Rollback floor: databases touched by
>=v1.126 are not writable by <=v1.125.

Two buckets coexist in the one file:

1. **The document store** - the old db.json object shape, persisted per row:
   `doc_kv(namespace, key, json)` for per-item namespaces (`metadata`,
   `progress`, `trash`, `books.items`, `music.tracks`, `podcasts.episodes`,
   `ytdlp.downloadMeta`, ...) and `doc_single(name, json)` for small whole
   objects (`folders`, `settings`, `podcasts.subscriptions`, ...). The two
   namespace lists are a LOCK: `assertNoUnknownKeys()` throws on any key
   outside them, so a new namespace can never be silently dropped. `save()` is
   a diff-save against a per-row snapshot - only changed rows are written, in
   one transaction.
2. **Relational per-user tables** - everything user-scoped: `users`,
   `user_progress`, `user_liked`, `user_watched`, `user_queue`,
   `user_restrictions`, `user_search_history`, `user_feed_hidden`,
   notifications/push tables, and the per-place progress/liked/pins tables for
   books, music, and podcasts. The accessor layer is `lib/auth/store.js`.

Integrity guards worth knowing: `node:sqlite` truncates TEXT at NUL
(row keys are refused loudly if they carry one); hostile `__proto__` row keys
round-trip as inert data via `Object.defineProperty`; the module-level
`backup()` API is deliberately unused (unsafe under same-process writes) -
backup bundles are SELECT-assembled.

**db.json is a read-only legacy artifact.** Boot: `filetube.db` exists → use
it; else import `db.json` once (strict - unknown keys ABORT rather than lose
data), atomically; else fresh schema. Nothing writes db.json anymore
(byte-hash-locked by `test/integration/dbjson-frozen.test.js`).

Write path in the monolith: `updateDatabase(mutatorFn)` is a single in-process
promise-chain mutex (mutators are synchronous; returning false skips the
save); `getCachedDatabase()` is the read-through cache whose readers get a
throwing Proxy under test (mutating a cached read is a bug, loudly).

## Auth + RBAC

`lib/auth/` - four files: `gate.js` (the middleware + cookies + rate limit),
`crypto.js` (scrypt passwords, HMAC session tokens), `store.js` (per-user
tables), `visibility.js` (the ONE pure visibility decision).

- **Session secret**: `FILETUBE_SESSION_SECRET` env → `DATA_DIR/session-secret`
  file → minted fresh (0600). Fail-closed on short/placeholder values.
- **Cookie**: name is per-instance (`ft_session_` + hash of DATA_DIR - prod and
  beta share a host), HMAC-signed `{uid, tokenVersion}`, 30-day TTL, HttpOnly,
  SameSite=Lax, Secure when HTTPS is trusted (`FILETUBE_TRUST_PROXY=1`).
- **The gate**: ONE `app.use(authGate)` covers every route, static asset, and
  byte stream by default. A small exact allowlist serves the pre-login surface
  (login/welcome/logo/fonts/icons, traversal-refused). Each request re-checks
  the user row (disabled / bumped tokenVersion = dead cookie NOW). Login is
  token-bucket rate-limited per (ip|username), fail-open.
- **Roles + capabilities**: `admin` | `member`, plus two grantable member
  capabilities - `canManageSubscriptions` (channel/podcast registry) and
  `canModifyLibrary` (destructive content actions; default off). Guards:
  `requireAdmin`, `requireManageSubscriptions`, `requireModifyLibrary`.
- **Per-user visibility restrictions** (`user_restrictions` +
  `lib/auth/visibility.js`, pure): kinds `path` (boundary-correct prefix),
  `folder` (video channel), `show` (podcast), `library` (whole place), and
  `mode: allowlist` to flip the semantics default-deny. Admin is an EMPTY
  index - no role branch to forget. server.js wraps this as `mediaVisibleTo`,
  `trackVisibleTo`, `podcastEpisodeVisibleTo`, `bookVisibleTo`,
  `trashRecordVisibleTo`, `restrictedVideoMutation`.
- **The forcing nets** (tests that fail on ABSENCE): `route-write-
  classification.test.js` enumerates every mutating route from the live
  Express table and forces each into a capability class AND a visibility class
  (`enforced` | `personal` | `n/a`) - an unclassified new route reds the
  suite; `rbac-census` + `route-census` sweep the read surfaces and the
  gate's allowlist.
- **Mutation audit**: a middleware after the gate logs every mutating request
  with its actor (born from a real incident: a screenshot harness issuing live
  DELETEs).

## The media pipeline

- **Scan**: one entry point with overlap-coalescing; a fully async walker that
  skips trash dirs and in-flight transcode temps, yields cooperatively, and
  records unreadable directories. `id = md5(filePath)` - path-derived, which
  is why every move/relocate has an explicit re-key lane. Reuse fast-path: an
  unchanged file's metadata is never re-extracted.
- **Prune policy** (the data-loss-hardened part, uniform across places): an
  indexed item is pruned only when (a) pruneMissing is on, (b) it vanished
  from the walk, (c) its ROOT is not missing/unmounted (mount-loss guard),
  (d) its path is not under a directory that ERRORED this walk (transient-
  EACCES guard - media `unreadablePaths`, music + books `erroredDirs`), and
  (e) the root didn't "vanish" wholesale (a mounted-but-empty root prunes
  nothing, loudly).
- **FFmpeg**: metadata + thumbnails; chapters and embedded tags via ffprobe;
  on-demand H.264/AAC transcode (queue + live-stream fallback) with
  `+faststart`; storyboard sprites and hover preview clips (pure planners in
  `lib/storyboard.js` / `lib/previewClip.js`); `.m4a` background-audio sidecar
  extraction; Roku compat renditions; TTS synthesis for books. Caches are
  size-capped LRU with age sweeps; in-flight files are eviction-protected.
- **Trash** (soft delete): atomic rename into a per-root `.filetube-trash`
  dir (same filesystem - no copy), records in `db.trash`, per-item
  restore/purge routes only (deliberately no bulk delete), double-gated
  (capability + visibility), retention-swept on the scan interval.
- **Background work**: ONE scan interval drives media+books+music scans and
  the trash sweep; ytdlp and podcasts each own an unref'd poll timer (0 =
  manual-only); heavy jobs (yt-dlp runs, enclosure downloads) serialize
  through `lib/heavyGate.js` - one FIFO promise chain, never wedged by a
  failing job.

## The media places

- **Video** (core, in server.js): roots `db.folders`; namespaces `metadata`,
  `viewCounts`, `trash`, `deleteTombstones`; per-user progress/liked/watched/
  feed-hidden/queue. Browse contract lives in `lib/videoQuery.js`, kept in
  provable parity with the client's sort (`videoquery-parity.test.js`).
- **Music** (v1.44): `db.music.*`; separate roots (three-way overlap-rejected
  against video and books roots); embedded tags win over the
  `Artist/Album/NN Title` path convention per-field; `/track/:id` +
  `/albumart/:id` bytes.
- **Books** (v1.37): `db.books.*`; dependency-free ZIP/OPF readers for EPUB
  metadata + covers (PDF by filename); per-user reading position, manual
  finished latch; optional TTS (espeak-ng in the image; Piper opt-in) with an
  m4a chunk cache.
- **Podcasts** (v1.69): `lib/podcasts/`; private-RSS engine. Feed URLs are
  CREDENTIALS (Patreon auth tokens) and live OUTSIDE the db in
  `DATA_DIR/podcast-feeds.json` (0600) - structurally excluded from backups.
  The feed reader is a bounded scanner, not an XML parser (XXE inert); the
  enclosure fetcher applies the SSRF envelope per redirect hop, streams to
  `.ptpart` + fsync + atomic rename, honors write backpressure. Episode
  records double as the download archive (a tombstone blocks re-download).
- **yt-dlp subscriptions** (`lib/ytdlp/`, the largest subsystem; strictly
  opt-in via `FILETUBE_YTDLP_ENABLED`): channel subscriptions + one-off
  downloads. `run.js` is the only child_process caller (argv arrays, never
  shell); `url.js` re-validates every URL immediately before spawn;
  per-video failure attribution; durable run/failure logs; the one-off API
  accepts an `X-FileTube-Token` (iOS Shortcut) as session-less auth for
  exactly that route.

## The client

- **Shells**: every `public/*.html` page is a complete server-rendered
  document; the router is progressive enhancement.
- **SPA-lite router** (`common.js`): swaps ONLY `#view-root` (header, nav,
  and the player host stay mounted), pushState + a single-entry home view
  cache; every view registers listeners through one per-view AbortController.
  THE consequence that bites: page-local `<head>` styles are lost on in-app
  nav - view styles belong in `style.css` (source-locked).
- **The player** (`player.js`): ONE `#player-host` cloned once, moved between
  FULL / DOCKED / CLOSED by reparenting. Battle-won subsystems - reuse, never
  rebuild: the iOS background-audio handoff (hidden `<audio>` playing the
  `.m4a` sidecar), the caption overlay (`.cc-overlay`, both audio AND video
  render through it since v1.124 - `track.mode='showing'` native paint is
  retired), faux fullscreen (`.css-fullscreen`, the iOS mechanism) vs NATIVE
  fullscreen (desktop `requestFullscreen()`) - anything gating on fullscreen
  must handle BOTH (v1.124.1's lesson), and the controls auto-hide covers
  both immersive forms.
- **Design tokens**: `style.css` is governed by `scripts/css-token-lint.js`
  (colors, font sizes/weights, z-index, shadows...); the census is ZERO and
  ratcheted in pre-commit + CI (self-canary first, so a broken linter fails
  loud). `token-exempt` comments are the escape hatch, with reasons.
- **Eras + modes**: two orthogonal axes on `<html>` - `data-theme` (2005 /
  2009 / 2014 / 2021) and `data-mode` (light/dark). Three home layouts with
  precedence modern > feed > classic (`resolveHomeLayout`, pure).
- **PWA + push**: `filetube-worker.js` is PUSH-ONLY by hard contract (never a
  fetch handler, never Cache Storage - a fetch handler breaks background
  media on WebKit; the filename avoids ad-blocker lists). VAPID keys in
  DATA_DIR (0600), never in backups.

## Roku

A BrightScript channel (`roku/`) using the normal API with the session cookie
in the Roku registry. Server-side compat renditions (`lib/rokuCompat.js` +
server.js wiring) fix the two Roku-specific demuxer issues (embedded cover-art
track → lossless strip; rotation side-data → upright re-encode), cache-only,
served exclusively to `?compat=roku`, never mutating the original file.

## Configuration

Core env: `PORT`, `DATA_DIR` (everything hangs off it), `FILETUBE_SESSION_SECRET`,
`FILETUBE_TRUST_PROXY`, `FILETUBE_API_TOKEN`, `FILETUBE_READ_ONLY_MEDIA` /
`FILETUBE_READONLY` (safe-mode levers), transcode/roku cache dirs + caps,
`FILETUBE_PODCASTS_DIR`, `FILETUBE_TTS_*`, and ~20 `FILETUBE_YTDLP_*` vars
(every parse defensive, nothing throws at startup). Docker: node:22-alpine +
ffmpeg + espeak-ng + pip yt-dlp; `VOLUME /app/data`; explicit COPYs (never
`COPY . .` - a leaked local file can't enter the image).

CI (`.github/workflows/ci.yml`): pinned gitleaks working-tree scan + a
dual-Node (22/24) lint + token-ratchet + full-suite matrix. Publish
(`docker-publish.yml`): gated - the image only builds after a qualify job
re-runs the dual-Node suite and the secret scan on the exact ref; tags
`edge`/`sha-*` from main, semver + `latest` from `v*` tags.

## Testing

`node:test`, no runner deps. 346 unit files (pure logic, jsdom, source
locks) + 190 integration files (real server, real Express table, real SQLite
in temp DATA_DIRs); full suite 6,986 tests (all counts measured at v1.135.0
INCLUDING this wave's own additions; they grow every wave), run on BOTH
Node 22 and 24 before every release. The house pattern is the FORCING NET - tests that fail
on absence (an unclassified route, an unlisted namespace, a view style outside
style.css) so a discipline can't be silently skipped. Auth in tests is a real
minted cookie, never an env bypass. The pre-commit hook runs lint + the unit
suite and refuses red; the pre-push hook runs the full suite.

## Where the rest lives

- Working method + hard-won lessons: `CLAUDE.md` (the contract),
  `docs/references/lean-mode-methodology.md` (portable spec).
- Coding standards incl. the MANDATORY design-token rules:
  `docs/CONTRIBUTING.md`.
- Operational/reliability posture: `docs/RELIABILITY.md`.
- Release mechanics: `docs/RELEASING.md`. Config detail: `docs/CONFIGURATION.md`.
- Plans: `docs/exec-plans/{active,completed,archive}/`;
  debt: `docs/exec-plans/tech-debt-tracker.md`.
