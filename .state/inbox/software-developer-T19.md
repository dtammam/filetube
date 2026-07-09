# T19 — B2 Phase 2 physical move on subscribe (v1.24, Wave 7) — HEAVIEST GATE

**Cluster B · FR B2-Phase-2 · Gate: HEAVIEST two-reviewer ADVERSARIAL ·
Depends on: T9 (C1 move machinery), T18 (serialize-after)**

Read at wave start, IN FULL: `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md`
`## Design` — the "Load-bearing grounding fact" (the `getMediaId` id re-key
invariant) + B2 Phase 2 + C1; `## Task breakdown` T19.
**Serialize-after T18 on `lib/ytdlp/index.js` — edit only after T18 lands.
Re-read `index.js` fresh first.**

## Files you own (edit ONLY this)
- `lib/ytdlp/index.js` — **serialize-after T18.**

Call T9's exported `moveItemToFolder(deps, id, targetFolder)` from `server.js` —
do NOT re-implement the move, and do NOT edit `server.js`. If you find you MUST
edit `server.js`, STOP and report (it is owned by T18 this wave; you would need
to serialize after it).

## Scope
- Trigger = the SUBSCRIBE action itself (`POST /api/subscriptions`),
  fire-and-forget AFTER the subscription persists — NOT on every poll, NOT a
  manual button.
- For each item whose captured `channelUrl` matches the new subscription AND
  whose current path is already UNDER the download root AND whose folder
  `!== resolveChannelDir(config, sub)`: physically move it into `channelDir` by
  REUSING T9's move machinery (id re-key + `db.metadata`/`db.progress` migration +
  thumbnail/transcode/subtitle sidecar rename + progress preservation).
- **Confinement:** only items already under the download root are eligible (a
  user's own local-library file is NEVER moved into a channel folder). Target =
  `resolveChannelDir(config, sub)` + basename, re-checked via `isPathUnder`.
- **Idempotent:** skip items already under `channelDir` — re-subscribe / duplicate
  subscribe never re-moves.
- **Dedup archive untouched** (keys by extractor+id, not path — no re-download on
  the next poll).
- **Scan-safe** via the id re-key (moved file already indexed under its new-path
  id → next scan is a reuse, not delete+add).

## Frozen cross-file contracts
- Uses T9's `moveItemToFolder(deps, id, targetFolder)` (do not fork it).
- `index.js` serialized after T18.
- **Disabled-module no-op** preserved.

## Acceptance criteria (exec-plan B2 Phase 2)
- [UNIT][B] the physical move preserves `db.metadata[id].filePath` consistency,
  thumbnail/transcode sidecar keys, and watch progress — verified the SAME way as
  the C1 move ACs (not a divergent implementation).
- [UNIT][B] the next scan after a physical move does NOT treat the moved file as
  delete+new-add (no watch-progress loss, no duplicate entry).
- [MANUAL][B] subscribing to a channel with prior one-offs moves those files
  exactly once (not repeatedly on every poll); dedup state unaffected.
- [PROCESS][B] HEAVIEST two-reviewer gate; reviewed with the same
  path-confinement + scan-interaction rigor as delete + yt-dlp download.

## Standard footer (v1.24 UX Round — every SDE task)
- **Node 22 toolchain:** prepend to PATH:
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- **Verify:** `npm test` (baseline 1735 green) + `npm run lint` (0 errors + 8
  pre-existing `common.js` warnings baseline — add none). Add the
  watch-progress-survives-a-scan regression test (the id re-key invariant).
- **Standards:** CommonJS, 2-space/semicolons/single-quotes; wrap FS calls in
  try/catch, degrade gracefully; no new runtime deps.
- **Ownership:** edit ONLY `lib/ytdlp/index.js` (after T18). Need `server.js` or
  another file? STOP/report.
- **Git:** COORDINATOR owns ALL git. Do NOT commit/branch/stage/push. Report
  files changed + tests + Node 22 `npm test`/`npm run lint` results.
