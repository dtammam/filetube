# T2 — F2 more elegant buttons (v1.24 UX Round, Wave 1)

**Cluster F · FR F2 · Gate: light · Depends on: none**

Context + design: `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md`
(`## Design` "Clusters E / F / G" → F2; `## Task breakdown` T2).

## Files you own (edit ONLY this)
- `public/css/style.css` — you are the SOLE `style.css` owner in Wave 1.

## Scope
- CSS-only polish pass on button styles: subtler bevels/rounding, tighter
  spacing/typography, cleaner hover. Polish, NOT a redesign.
- Keep the era-theme system intact — do not hardcode colors that break under a
  different era theme; keep deriving from era-theme tokens. Spot-check every
  era theme still renders buttons correctly.

## Frozen contracts
- **No markup/class-contract change** — CSS-only; no call site should need
  touching. Do not rename/remove any button class other pages rely on.

## Acceptance criteria (exec-plan F2)
- [MANUAL][F] Visual pass reduces bevel/blockiness while every era theme still
  renders correctly (Dean verifies feel).
- [PROCESS][F] No button markup/class contract changes.

## Standard footer (v1.24 UX Round — every SDE task)
- **Node 22 toolchain:** prepend to PATH:
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- **Verify:** `npm test` (baseline 1735 green) + `npm run lint` (0 errors + 8
  pre-existing `common.js` warnings baseline — add none).
- **Standards:** 2-space/semicolons/single-quotes, no new runtime deps.
- **Ownership:** edit ONLY `public/css/style.css`. Need another file? STOP/report.
- **Git:** COORDINATOR owns ALL git. Do NOT commit/branch/stage/push. Report
  files changed + tests + Node 22 `npm test`/`npm run lint` results.
