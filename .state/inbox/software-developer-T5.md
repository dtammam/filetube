# T5 — C5 release-date capture for LOCAL files (v1.24, Wave 1)

**Cluster C · FR C5-local · Gate: light-to-medium (scan-safety) · Depends on: none**

Context + design: `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md`
(`## Design` C5 + the "Load-bearing grounding fact"; `## Task breakdown` T5).

## Files you own (edit ONLY this)
- `server.js` — SOLE `server.js` owner in Wave 1 (scan/probe path).

## Scope
- Capture `db.metadata[id].releaseDate` (**epoch milliseconds**) for LOCAL files:
  precedence chain — embedded date via ffprobe (`format.tags.creation_time` /
  `date`, from the probe the scan ALREADY runs) → filesystem `mtime` fallback
  (fragile — resets on copy — the honest last resort).
- **CRITICAL scan-safety (the thumbnail-backfill-regression lesson):**
  `releaseDate` is derived from data the scan already has (`mtime` is a `stat`
  we already do; embedded date only when we already probe). The additive
  backfill for already-indexed items must **NOT trigger any re-probe,
  re-thumbnail, or re-transcode pass**, and must not touch any unrelated
  per-item state. A schema-only addition, not a re-processing pass.
- This establishes the `db.metadata.releaseDate` write path in the
  scan/downloadMeta merge that T11 (Wave 3, yt-dlp `upload_date` capture) reuses.

## Frozen cross-file contracts
- Field `releaseDate` = **epoch ms or null** on `db.metadata[id]` (consumed by
  T3's `sortItems` release-date case; extended by T11's yt-dlp capture in W3).
- Keep the downloadMeta→`db.metadata` merge GENERIC where possible so T11 can add
  its field without a `server.js` edit in W3.

## Acceptance criteria (exec-plan C5)
- [UNIT][C] `releaseDate` populated from embedded date → mtime fallback for a
  local file (pure helper covered by `node:test`).
- [PROCESS][C] The schema-only backfill does NOT re-extract thumbnails or touch
  unrelated per-item state during a backfill scan — **this is a HARD gate; add a
  regression test proving no re-processing is triggered.**

## Standard footer (v1.24 UX Round — every SDE task)
- **Node 22 toolchain:** prepend to PATH:
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- **Verify:** `npm test` (baseline 1735 green) + `npm run lint` (0 errors + 8
  pre-existing `common.js` warnings baseline — add none). Keep FFmpeg out of the
  automated suite; test the pure date-selection helper with fixtures.
- **Standards:** CommonJS, 2-space/semicolons/single-quotes; wrap FS/probe calls
  in try/catch and degrade gracefully (RELIABILITY.md); no new runtime deps.
- **Ownership:** edit ONLY `server.js`. Need another file? STOP/report.
- **Git:** COORDINATOR owns ALL git. Do NOT commit/branch/stage/push. Report
  files changed + tests + Node 22 `npm test`/`npm run lint` results.
