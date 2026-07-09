# T18 — B2 Phase 1 reconcile: virtual channel grouping (v1.24, Wave 7)

**Cluster B · FR B2-Phase-1 · Gate: TWO-REVIEWER · Depends on: none**

Read at wave start: `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md`
(`## Design` B2 Phase 1; `## Task breakdown` T18). **Re-read `server.js` +
`lib/ytdlp/index.js` fresh at wave start.** T19 SERIALIZES AFTER you on
`index.js`.

## Files you own (edit ONLY these)
- `server.js` — Wave 7 owner.
- `lib/ytdlp/index.js` — Wave 7 owner (T19 serializes after you).

## Scope
- Server-side query-time union in `GET /api/videos`: when the requested
  `?root=<dir>` equals a subscription's resolved `channelDir`, ADDITIONALLY
  include items whose captured `db.metadata[id].channelUrl` equals that
  subscription's `channelUrl`, regardless of physical folder, DEDUPLICATED by id.
- Pure `unionChannelItems(items, channelDir, channelUrl)` (union of "under
  `channelDir`" and "matching `channelUrl`", dedup by id) — unit-tested. An item
  already under `channelDir` is NEVER double-counted.
- Read-only, NO file movement (that is T19, Phase 2).

## Frozen cross-file contracts
- `index.js` serialized T18 → T19 (you merge first). Leave the physical-move
  (on-subscribe) work for T19.
- Reuses the existing `db.metadata[id].channelUrl` field (FR-2 bridge).
- **Disabled-module no-op** preserved for any yt-dlp-module touch.

## Acceptance criteria (exec-plan B2 Phase 1)
- [UNIT][B] `unionChannelItems` returns the deduplicated union for a channel
  view.
- [UNIT][B] an item already under `channelDir` is never double-counted when it
  also matches by `channelUrl`.
- [MANUAL][B] a one-off downloaded before subscribing, later subscribed to that
  channel, now appears in the channel's folder view — WITHOUT any file moving.

## Standard footer (v1.24 UX Round — every SDE task)
- **Node 22 toolchain:** prepend to PATH:
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- **Verify:** `npm test` (baseline 1735 green) + `npm run lint` (0 errors + 8
  pre-existing `common.js` warnings baseline — add none). The pure union helper
  gets `node:test` coverage.
- **Standards:** CommonJS, 2-space/semicolons/single-quotes, no new runtime deps.
- **Ownership:** edit ONLY `server.js` + `lib/ytdlp/index.js`. Need another file?
  STOP/report.
- **Git:** COORDINATOR owns ALL git. Do NOT commit/branch/stage/push. Report
  files changed + tests + Node 22 `npm test`/`npm run lint` results.
