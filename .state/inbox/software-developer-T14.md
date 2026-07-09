# T14 — A2 per-item download failure attribution (v1.24, Wave 5)

**Cluster A · FR A2 (FR-3+FR-7 phase a) · Gate: TWO-REVIEWER · Depends on: none**

Read at wave start: `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md`
(`## Design` A2; `## Task breakdown` T14). **Re-read `lib/ytdlp/index.js` +
`lib/ytdlp/run.js` fresh at wave start.**

## Files you own (edit ONLY these)
- `lib/ytdlp/failures.js` (NEW)
- `lib/ytdlp/run.js` — W5 owner (T15 SERIALIZES AFTER you on this file).
- `lib/ytdlp/index.js` — W5 owner (T15 SERIALIZES AFTER you on this file).
- `public/js/common.js` — status-chip failure render (JS-only; reuse the EXISTING
  chip element — do NOT add shell markup). T15 serializes after you here too.
- `lib/ytdlp/views/subscriptions.html` + `lib/ytdlp/client/subscriptions.js` —
  per-item failure list.

## Scope
- New pure `parseItemFailureLine(line, knownIds)` (`failures.js`) recognizing
  yt-dlp's `ERROR: [<extractor>] <id>: <reason>` shape → `{ videoId, reason }`
  ONLY when `id ∈ knownIds`, else `{ videoId: null, reason }` (an "unattributed"
  entry — surfaced, NEVER misattributed to the wrong id, NEVER silently dropped).
  `reason` control-char-stripped + length-capped.
- `spawnYtdlpDownload` gains `opts.knownIds` (the target-id set) + accumulates
  matched failures into a bounded `itemFailures[]` — SAME bounded-capture posture
  and cap constant as the existing `channelMeta[]` (SF3: bounded, no unbounded
  buffer). Reasons pass through the existing `redactString` (SF1: cookies-path
  redaction preserved).
- `runSubscriptionCycle` maps `itemFailures` onto the activity LiveEntry via
  `activity.setSubscription(sub.id, { failures: [{ videoId, title?, reason }] })`
  (`title` from captured `channelMeta`/list metadata when available). NO
  `activity.js` change (`mergeEntry` shallow-merges). Backward-compatible: absent
  when nothing failed.
- `GET /api/subscriptions/status` returns the snapshot verbatim (no route
  change). Render the per-item `{ channel, video, reason }` list on the home
  status chip (`common.js`, reusing the existing element) + the subscriptions
  view.
- Phase (b) root-cause fixes are captured as follow-on sub-tasks once reasons are
  visible — do NOT guess them now.

## Frozen cross-file contracts
- `run.js`, `index.js`, `common.js` are serialized T14 → T15 (you merge first).
- Activity LiveEntry additive field `failures: [{ videoId, title?, reason }]`.
- **Disabled-module no-op** preserved.

## Acceptance criteria (exec-plan A2)
- [UNIT][A] parser attributes a per-video failure line to the right survivor id
  given the target-id list; never drops/misattributes.
- [UNIT][A] the status snapshot carries a per-item `{videoId, reason}` list,
  backward-compatible when nothing failed.
- [UNIT][A] SF1 (redaction) + SF3 (bounded) unaffected.
- [MANUAL][A] the status UI shows channel + video + human-readable reason for a
  real reproduced partial failure.
- [PROCESS][A] phase (b) root causes captured as their own sub-tasks.

## Standard footer (v1.24 UX Round — every SDE task)
- **Node 22 toolchain:** prepend to PATH:
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- **Verify:** `npm test` (baseline 1735 green) + `npm run lint` (0 errors + 8
  pre-existing `common.js` warnings baseline — add none). The pure parser gets
  `node:test` coverage + a regression lock.
- **Standards:** CommonJS, 2-space/semicolons/single-quotes; arg-array spawn
  discipline preserved; `textContent` over `innerHTML`; no new runtime deps.
- **Ownership:** edit ONLY the six files above. Need another file? STOP/report.
- **Git:** COORDINATOR owns ALL git. Do NOT commit/branch/stage/push. Report
  files changed + tests + Node 22 `npm test`/`npm run lint` results.
