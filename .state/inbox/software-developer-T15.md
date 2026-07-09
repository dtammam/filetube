# T15 — A3 cancel an in-progress download (v1.24, Wave 5)

**Cluster A · FR A3 · Gate: light-to-medium (spawn-lifecycle) · Depends on: T14 (serialize)**

Read at wave start: `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md`
(`## Design` A3; `## Task breakdown` T15).
**Serialize-after T14 on `run.js`, `index.js`, AND `common.js` — edit each only
after T14 has landed. Re-read them fresh first.**

## Files you own (edit ONLY these, all serialize-after T14)
- `lib/ytdlp/run.js`
- `lib/ytdlp/index.js`
- `public/js/common.js` (cancel control on the home status chip)

## Scope
- `spawnYtdlpDownload` gains `opts.onChild(child)`, invoked synchronously right
  after a successful `cp.spawn` (an opt-in registration hook, not a global
  registry).
- `runOneShot` passes an `onChild` that stores the handle in a module-level
  `Map<jobId, ChildProcess>` in `index.js`, deleted when the promise settles.
- New route `POST /api/ytdlp/download/:jobId/cancel` (inside the `isEnabled`
  gate): if the job has a live handle → `child.kill('SIGKILL')` (same posture as
  the existing timeout-kill; the partial file is reaped by
  `cleanupFailedDownloadIntermediates`) + `activity.setOneShot(jobId,
  { state: 'cancelled' })` (a NEW terminal state, distinct from `error`). An id
  with no live handle → clean `404`, never a crash.
- Add `'cancelled'` to `activity.TERMINAL_STATES` so it TTL-prunes like
  `done`/`error`.
- Scope note: cancel targets the ONE-SHOT path (the home status chip's
  cancellable job). Subscription-poll cancellation stays OUT.
- Add a cancel control to the home status chip (`common.js`).

## Frozen cross-file contracts
- Serialized after T14 on all three shared files.
- `'cancelled'` is a new terminal activity state (not `error`).
- **Disabled-module no-op** preserved.

## Acceptance criteria (exec-plan A3)
- [UNIT][A] cancelling a tracked in-progress spawn sends `SIGKILL` and
  transitions to `cancelled`, never `error`.
- [UNIT][A] cancelling an id with no in-progress job is a clean no-op (404),
  never a crash.
- [MANUAL][A] cancelling a real download stops the yt-dlp process (no orphan) and
  the partial file is cleaned up the same way a failed/timed-out download is.

## Standard footer (v1.24 UX Round — every SDE task)
- **Node 22 toolchain:** prepend to PATH:
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- **Verify:** `npm test` (baseline 1735 green) + `npm run lint` (0 errors + 8
  pre-existing `common.js` warnings baseline — add none). New logic gets tests.
- **Standards:** CommonJS, 2-space/semicolons/single-quotes; arg-array spawn
  discipline + no `shell:true`; `textContent` over `innerHTML`; no new runtime
  deps.
- **Ownership:** edit ONLY the three files above (after T14). Need another file?
  STOP/report.
- **Git:** COORDINATOR owns ALL git. Do NOT commit/branch/stage/push. Report
  files changed + tests + Node 22 `npm test`/`npm run lint` results.
