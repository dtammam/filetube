# T1 — E3 favicon (v1.24 UX Round, Wave 1)

**Cluster E · FR E3 · Gate: light + four-shell parity check · Depends on: none**

Context: v1.24 bundles ~25 UX improvements on one branch. Design +
per-task breakdown: `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md`
(read the `## Design` "Clusters E / F / G" note and the `## Task breakdown`
T1 entry). This task is fully self-contained.

## Files you own (edit ONLY these)
- `public/index.html` — the icon `<link>` block ONLY (lines ~7–9).
- `public/watch.html` — the icon `<link>` block ONLY.
- `public/setup.html` — the icon `<link>` block ONLY.
- `lib/ytdlp/views/subscriptions.html` — the icon `<link>` block ONLY.
- `public/favicon.ico` — NEW multi-res asset.

Keep your diff to the icon block so parity is trivially verifiable.

## Scope
- Add a real multi-resolution `favicon.ico` to `public/` (16/32/48 at least).
- Add `<link rel="icon" href="/favicon.ico" sizes="any">` to the icon block,
  **byte-identical across all four shells**. Confirm the existing
  `apple-touch-icon` / `sizes` / shortcut-icon / SVG + PNG `rel=icon` lines stay
  present and byte-identical across all four shells.
- Verify `favicon.ico` is actually served (it sits in `public/`, statically
  served — confirm the route reaches it).

## Frozen contracts
- The four shells' icon `<link>` block must be byte-identical to each other
  after your change (four-shell parity discipline).

## Acceptance criteria (exec-plan E3)
- [UNIT][E] A regression test / lint-style assertion proves the icon `<link>`
  block is byte-identical across all four shells after the change.
- [MANUAL][E] A real multi-res `favicon.ico` is present and picked up by at
  least one browser that previously missed the tab icon (Dean verifies).

## Standard footer (v1.24 UX Round — every SDE task)
- **Node 22 toolchain:** prepend to PATH before any npm/node command:
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- **Verify before done:** `npm test` (baseline 1735 green) and `npm run lint`
  (0 errors + 8 pre-existing `public/js/common.js` warnings — add none, don't
  "fix" the 8). Every new pure helper gets `node:test` coverage + a regression
  lock.
- **Standards:** CommonJS, 2-space/semicolons/single-quotes, vanilla DOM,
  `textContent` over `innerHTML`, NO new runtime dependencies.
- **Ownership:** edit ONLY the files listed above. Need another file? STOP and
  report — do not edit it.
- **Git:** the COORDINATOR owns ALL git. Do NOT commit/branch/stage/push. Report:
  files changed (one line each), new tests, Node 22 `npm test` + `npm run lint`
  results.
