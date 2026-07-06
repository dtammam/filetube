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
  mobile lazy-transcode "preparing…" overlay + polling.
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
  — keep the download directory on stable, always-mounted storage. The poll
  mirrors
  `armScanTimer` (`.unref()`'d, re-armable, off when the interval is 0), and
  long downloads run OUTSIDE the `updateDatabase` lock (only a short
  last-checked/status write re-enters it). Security-critical surface (command
  injection, path traversal, cookies handling); ships behind the full
  two-reviewer QA gate.

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

## Constraints

- Single-node, single-process; state lives on local disk (no external services).
- Requires FFmpeg/FFprobe on PATH; without them, metadata/transcode features degrade.
- Node.js 22 LTS (`engines` ≥20).
- The transcode cache in `data/transcoded/` is **bounded**: a size-capped LRU
  eviction (default 5 GB, `TRANSCODE_CACHE_MAX_BYTES`/UI override) plus an optional
  age-retention sweep (default 30 days) keep it from growing unbounded. Age is keyed
  off a FileTube-controlled `db.metadata[id].lastServedAt` timestamp (filesystem
  atime is only a fallback, being unreliable under `relatime`/`noatime`).
- iOS Safari cannot play a non-seekable live stream, which is why mobile uses the
  pre-transcoded, seekable MP4 path.
