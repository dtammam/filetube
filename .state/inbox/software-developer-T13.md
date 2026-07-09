# T13 — D2 resume threshold + Setting, D3 docked resume prompt (v1.24, Wave 4)

**Cluster D · FR D2, D3 · Gate: light-to-medium · Depends on: T12 (serialize-after)**

Read at wave start: `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md`
(`## Design` "Cluster D" D2/D3; `## Task breakdown` T13).
**Serialize-after T12 on `public/js/player.js` — edit only after T12 lands.**

## Files you own (edit ONLY these)
- `public/js/player.js` — **serialize-after T12.**
- The D2 Settings-surface file — **confirm with the coordinator at wave start.**
  If the Setting lives in `watch.js`, it too serializes after T12; if it lives in
  a settings panel elsewhere, that file must be disjoint from T12's files.

## Scope
- **D2:** `shouldShowResumeOverlay` (`player.js` ~L189) gains a CONFIGURABLE
  threshold (default ~60s): skip the resume prompt below it, still prompt above.
  UPDATE the existing `>5s` unit test to the new behavior (do not silently break
  it). Expose the threshold as a Settings option that takes effect WITHOUT a page
  reload.
- **D3:** a pure decision helper picks ONE deterministic docked behavior
  (recommended: suppress-while-DOCKED + auto-resume-in-mini, expanding to FULL
  only when a resume decision is genuinely needed). Do NOT implement both
  behaviors. Reuse `resolveMobileFormFactor`/`isMobileFormFactor` — never a
  second mobile signal.

## Frozen cross-file contracts
- `player.js` serialized T12 → T13 (you edit after T12). Do not touch T12's
  flash-fix surface beyond what D2/D3 need.

## Acceptance criteria (exec-plan D2, D3)
- [UNIT][D] `shouldShowResumeOverlay` skips below the threshold (default ~60s),
  still prompts above; existing `>5s` test UPDATED not broken.
- [UNIT][D] the pure docked-decision helper (single deterministic behavior).
- [MANUAL][D] the Setting takes effect without reload; the resume decision is
  legible + tappable while docked on a real device.

## Standard footer (v1.24 UX Round — every SDE task)
- **Node 22 toolchain:** prepend to PATH:
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- **Verify:** `npm test` (baseline 1735 green) + `npm run lint` (0 errors + 8
  pre-existing `common.js` warnings baseline — add none). Pure helpers get tests.
- **Standards:** vanilla DOM, `textContent` over `innerHTML`, no new runtime deps.
- **Ownership:** edit ONLY `player.js` (after T12) + the confirmed Settings file.
  Need another file? STOP/report.
- **Git:** COORDINATOR owns ALL git. Do NOT commit/branch/stage/push. Report
  files changed + tests + Node 22 `npm test`/`npm run lint` results.
