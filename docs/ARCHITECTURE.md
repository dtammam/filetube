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
