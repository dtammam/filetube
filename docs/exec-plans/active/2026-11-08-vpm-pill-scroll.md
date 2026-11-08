---
plan: vpm-pill-scroll
harness: v2 · light
branch: fix/vpm-pill-scroll
anchor: outcome
status: Kickoff done; build not started
next: the builder reads Step 0, then W1
design: Dean, 2026-11-08 (v1.405.0): "merge now, fix after"; R4 ruling "Scroll inside the pill"
gate: pending (adversary; test-only diff)
builder: standard
---

# Geometry VPM: scroll a pill tab into view before its hit test (test-only, rides on v1.405.0)

Kickoff 2026-11-08 (FileTube Root). **Builder: Standard (Sonnet).** A test harness fix, no product code.

## Why

Since v1.405.0 the Modern pill scrolls sideways when its tabs do not fit (Dean's R4 ruling, "Scroll inside the pill").
`visual (2021, desktop)` > Geometry checks fails on every PR, verbatim (run 42457047200):
`FAIL  VPM/home/320x568  (7 tabs, 0 covers)` / `bottom-bar you: its centre hits main#main-content.main-content, not the tab`.
`collectVPM` (test/geometry/checks.js ~643-649) hit-tests each tab's centre where it sits; at 320 px the You tab is
scrolled past the pill's edge, so its centre is outside the pill and correctly hits the content. The check is
measuring an unreachable-by-design position, not a covered tab.

## Requirements

- **R1.** In `collectVPM`, before each tab's hit test, bring the tab into view INSIDE the pill by setting the nav's
  own `scrollLeft` (never `scrollIntoView`, which can also scroll the page and move every other measurement), then
  measure; restore the nav's `scrollLeft` after the loop.
- **R2.** The check must still catch the real bug class: a tab that cannot be reached at all (the pill does not scroll,
  `scrollWidth` <= `clientWidth`, yet the tab lies outside it) or a tab covered after scrolling. Add a line to the
  failure text that says the tab was scrolled into view.
- **R3.** Retro looks (no scrolling bar) and the other VPM sizes: same results as today (all `ok`).

## Step 0

AGENTS.md; docs/LESSONS.md section 3 and 11 ("presence-not-binding": mutate it, watch it red); the
completed plan docs/exec-plans/completed/2026-11-08-glass-tab-pill.md (R4 and its Evidence); test/geometry/checks.js
and how the Visual workflow runs the geometry checks locally (`grep -rn "checks.js" .github package.json scripts`).
Environment, git rules and push as in AGENTS.md (fnm Node 22 PATH; stage by name; `-F` commit files; no `--no-verify`).
Stop rule: if the measured cause is NOT the pill's scroll (e.g. the You tab is covered while in view), stop and ask Dean
(AskUserQuestion) - that would be a product bug in v1.405.0, not a test fix.

## W1

R1-R3, then prove it both ways on the real geometry run: 320x568 goes `ok`; a mutant that disables the pill's
horizontal scroll (CSS `overflow-x: hidden` on the Modern `.bottom-nav`) or puts a cover over a scrolled tab goes red.
Report both outputs verbatim in Evidence.

## Gate and merge

Adversary seat (test-only diff, nothing near data or a boundary). No version bump, no ledger entry: close the plan as
"Shipped on v1.405.0" with `node scripts/plan-complete.js` in the same PR. PR via the protected-main flow; ask Dean
before `gh pr merge`.

## Out of scope

Any change to the pill itself; the other Visual cells; baselines.

## Evidence

(builder fills in)
