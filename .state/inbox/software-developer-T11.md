# T11 — C5 yt-dlp release-date + C6 channel-avatar capture (v1.24, Wave 3)

**Cluster C · FR C5-ytdlp, C6 · Gate: light-to-medium · Depends on: T5, T3/T4 (W1)**

Read at wave start: `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md`
(`## Design` C5 + C6; `## Task breakdown` T11). **Re-read `lib/ytdlp/index.js`
fresh at wave start** (chronic-hot, 5-of-7 waves).

## Files you own (edit ONLY these)
- `lib/ytdlp/index.js` — Wave 3 owner.
- `lib/ytdlp/args.js`
- `lib/ytdlp/store.js`

**Do NOT edit `server.js`** (owned by T9/T10 this wave) or any client file (the
render side was already built in Wave 1 by T3/T4 — see contracts below).

## Scope
- **C5-ytdlp:** extend `CHANNEL_META_PRINT_TEMPLATE`'s `.{...}j` field set with
  `upload_date`/`release_date`. **Fixed-literal, JSON-escaped, one-line-safe —
  never interpolated with per-video data** (same posture as the existing
  channel-identity capture). `parseChannelMetaLine` + `sanitizeCapturedChannelMeta`
  carry a bounded, validated `YYYYMMDD`→epoch-ms value onto the `downloadMeta`
  bridge → `db.metadata[id].releaseDate` at scan (reuses the write path T5
  established in Wave 1).
- **C6:** extend the SAME print template with the channel thumbnail URL
  (fixed-literal field add; validated/bounded like `channelUrl` in
  `sanitizeCapturedChannelMeta`). Store as `channelAvatarUrl` on the subscription
  record (`store.js`) and carry it onto `downloadMeta` → `db.metadata`.
- **Rely on the GENERIC `downloadMeta→db.metadata` merge** (established by
  T5/the existing bridge) so you do NOT edit `server.js`. If the bridge turns out
  to be field-enumerated (needs a `server.js` line to carry the new field),
  **STOP and report to the coordinator** — do not edit `server.js` this wave.

## Frozen cross-file contracts
- `db.metadata[id].releaseDate` = epoch ms (T3's `sortItems` reads it; T5
  established it).
- `db.metadata[id].channelAvatarUrl` + subscription-record `channelAvatarUrl` =
  string URL or null. The render precedence (`channelAvatarUrl` else
  `deriveAvatar`) is ALREADY built in `common.js`/`watch.js` (T3/T4) — you only
  POPULATE the field; do NOT touch a client file.
- **Disabled-module no-op:** no avatar/date fetch, route, or UI reachable with
  `FILETUBE_YTDLP_ENABLED=false`.

## Acceptance criteria (exec-plan C5, C6)
- [UNIT] the print-template additions are fixed-literal with no new
  attacker-controlled interpolation; captured date/avatar are validated + bounded.
- [MANUAL][C6] a subscribed channel with a real avatar shows it as the folder
  icon (sidebar/playlists) instead of the generic glyph.
- [MANUAL][C5] "Release date" sort correctly orders a mixed library of yt-dlp
  downloads + local files.
- [PROCESS] disabled-module no-op holds; additive backfill triggers no
  re-processing.

## Standard footer (v1.24 UX Round — every SDE task)
- **Node 22 toolchain:** prepend to PATH:
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- **Verify:** `npm test` (baseline 1735 green) + `npm run lint` (0 errors + 8
  pre-existing `common.js` warnings baseline — add none). Pure parse/sanitize
  helpers get `node:test` coverage.
- **Standards:** CommonJS, 2-space/semicolons/single-quotes; arg-array spawn
  discipline + `--` separator + no `shell:true` preserved; no new runtime deps.
- **Ownership:** edit ONLY the three lib files above. Need `server.js` or a
  client file? STOP/report.
- **Git:** COORDINATOR owns ALL git. Do NOT commit/branch/stage/push. Report
  files changed + tests + Node 22 `npm test`/`npm run lint` results.
