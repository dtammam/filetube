# T12 — D1 player flash on Prev/Next (v1.24, Wave 4)

**Cluster D · FR D1 · Gate: light-to-medium (player-non-regression) · Depends on: none**

Read at wave start: `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md`
(`## Design` "Cluster D — player-adjacent" D1; `## Task breakdown` T12).

## Files you own (edit ONLY these)
- `public/js/player.js` — Wave 4 owner (T13 SERIALIZES AFTER you on this file).
- `public/js/watch.js`

## Scope
- Eliminate the ~¼s blank/flash of the persistent `<video>` host during SPA
  Prev/Next navigation on the watch page.
- Root-cause the watch-view re-render tear-down / frame-clear-before-poster; fix
  THAT specific mechanism.
- **Do NOT structurally change the persistent `<video>` host reparenting model**
  (`expand`/`dock`/`close`, `player.js` ~L7–47) — only fix the flash's root
  cause.
- Reuse the single shared mobile-detection seam
  (`resolveMobileFormFactor`/`isMobileFormFactor`) if needed — never a second
  "is this mobile" signal.

## Frozen cross-file contracts
- `player.js` is serialized T12 → T13 this wave (you merge first). Leave the
  `shouldShowResumeOverlay`/resume-decision surface for T13.

## Acceptance criteria (exec-plan D1)
- [MANUAL][D] Tapping Prev/Next no longer shows a visible blank/flash on at
  least one real mobile device (Dean's on-device pass).
- [UNIT][D] a regression test against the SPECIFIC mechanism fixed (re-render
  tear-down/remount or frame-clear-before-poster) — not a "looks fine" check.
- [PROCESS][D] the reparenting model is structurally unchanged.

## Standard footer (v1.24 UX Round — every SDE task)
- **Node 22 toolchain:** prepend to PATH:
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- **Verify:** `npm test` (baseline 1735 green) + `npm run lint` (0 errors + 8
  pre-existing `common.js` warnings baseline — add none).
- **Standards:** vanilla DOM, `textContent` over `innerHTML`, no new runtime deps.
- **Ownership:** edit ONLY `public/js/player.js` + `public/js/watch.js`. Need
  another file? STOP/report.
- **Git:** COORDINATOR owns ALL git. Do NOT commit/branch/stage/push. Report
  files changed + tests + Node 22 `npm test`/`npm run lint` results.
