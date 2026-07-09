# T9 — C1 move files between folders + id re-key (v1.24, Wave 3)

**Cluster C · FR C1 · Gate: TWO-REVIEWER (path confinement + scan) · Depends on: none**

Read at wave start: `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md` —
ESPECIALLY the `## Design` "Load-bearing grounding fact" (the `getMediaId` id
re-key invariant — the single most important thing in this round) and the C1
section; `## Task breakdown` T9. **Re-read `server.js` fresh at wave start.**

## Files you own (edit ONLY these)
- `server.js` — Wave 3 owner (T10 also touches it but SERIALIZES AFTER you).
- `public/js/common.js` — sole W3 `common.js` owner (the "Move to…" picker).

## Scope
- `POST /api/videos/:id/move` with body `{ targetFolder }`, mirroring the
  `DELETE /api/videos/:id` pattern (~L2319).
- **Confinement:** resolve the target under an ALLOWED mount using the SAME
  discipline as delete + yt-dlp paths; reject BEFORE any filesystem op if it
  escapes. Pure `computeMoveTarget(filePath, targetFolder, allowedRoots)` →
  `{ ok, newPath }` (unit-tested).
- Same-device → `fs.rename`; cross-device (`EXDEV`) → copy+`unlink` fallback.
- **Inside ONE `updateDatabase` mutator** (after the FS work): compute
  `newId = getMediaId(newPath)`; RE-KEY `db.metadata[oldId]→newId` (with
  `filePath` updated); move `db.progress[oldId]→newId`; `fs.rename` the thumbnail
  `<oldId>.jpg→<newId>.jpg`, the transcode sidecar
  (`transcodedPath(oldId)→transcodedPath(newId)`), and any subtitle sidecar —
  each best-effort/idempotent. Result: the next scan sees the file already
  indexed under its new-path id → reuse fast-path, NOT delete+new-add.
- **Client:** a per-item "Move to…" picker over known folders in `common.js`.
- **Export a reusable `moveItemToFolder(deps, id, targetFolder)`** from
  `server.js` — T19 (Wave 7, B2 Phase 2) calls it. Agree the signature with the
  coordinator so T19 does not need to edit `server.js`.

## Frozen cross-file contracts
- Exported `moveItemToFolder(deps, id, targetFolder)` for T19.
- `server.js` is serialized T9 → T10 this wave (you merge first).

## Acceptance criteria (exec-plan C1)
- [UNIT][C] out-of-mount target rejected before any FS op; same-device vs
  cross-device both end in identical `db.metadata` state (id unchanged-by-path
  semantics, `filePath` updated, sidecars intact/regenerated).
- [UNIT][C] **watch progress for a moved item survives the next scan unchanged
  — MANDATORY regression test** (the `getMediaId` invariant).
- [MANUAL][C] a real move via the picker; item appears in its new folder,
  playable, history intact.
- [PROCESS][C] focused two-reviewer gate (path confinement + scan interaction).

## Standard footer (v1.24 UX Round — every SDE task)
- **Node 22 toolchain:** prepend to PATH:
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- **Verify:** `npm test` (baseline 1735 green) + `npm run lint` (0 errors + 8
  pre-existing `common.js` warnings baseline — add none). Wrap FS calls in
  try/catch, degrade gracefully; keep FFmpeg out of the automated suite.
- **Standards:** CommonJS, 2-space/semicolons/single-quotes, `textContent` over
  `innerHTML`, no new runtime deps.
- **Ownership:** edit ONLY `server.js` + `public/js/common.js`. Need another
  file? STOP/report.
- **Git:** COORDINATOR owns ALL git. Do NOT commit/branch/stage/push. Report
  files changed + tests + Node 22 `npm test`/`npm run lint` results.
