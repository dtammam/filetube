# Software Developer inbox — T4 (v1.21 FR-6: library grid mobile density)

Feature: **v1.21.0 "The Polish Release"** (feature_id `v1.21-polish-release`),
branch `feature/v1.21-polish-release` (off `main` at v1.20.0). This file
**supersedes any prior-feature content.** This is **Task T4**, **Wave 3** — runs
ALONE (you edit `public/css/style.css`, which is strictly serialized across all
CSS tasks). **Start only after the coordinator confirms T3 is integrated.** No
logical dependencies; blocks nothing. (This task is small; the coordinator may
alternatively fold it into an adjacent task's session — follow the coordinator's
routing.)

**Review tier: LIGHT single-QA.** Dean's on-device pass is the arbiter for
"comfortable" density. CSS-only.

## Environment

- **Node 22 toolchain bin** (prepend to PATH before any npm/node command):
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- Use absolute paths (cwd resets between bash calls).

## Git — DO NOT commit

The **coordinator (EM) owns ALL git.** Do NOT `git add`/`commit`/`branch`/
`stash`/`push`. Report exact files changed + full `npm run lint` (0 warnings)
output. Fix any failure before reporting done.

## Read first (you share NO memory with the EM)

- `docs/exec-plans/active/2026-07-08-v1.21-polish-release.md` — the **## Design**
  section **"FR-6 — mobile grid density (LIGHT, CSS-only)"** and **AC40–AC44**.
- `docs/ui-research-2026-07.md` §2 (drop the `minmax()` floor / explicit
  breakpoints so phones show 2 columns; 16:9/object-fit already shipped).
- Live code: `public/css/style.css` — the existing `.video-grid` rules: the
  desktop rule `grid-template-columns: repeat(auto-fill, minmax(210px,1fr))`
  (outside any media query — DO NOT touch) and the v1.15.0
  `@media (max-width:768px)` rule (`minmax(140px,1fr)`, 12px gap).

## Task — implement THIS ONE task only (FR-6)

Add a narrower phone breakpoint that guarantees exactly 2 comfortable columns,
deterministically:

- `@media (max-width:480px) { .video-grid { grid-template-columns: repeat(2, 1fr); } }`
  (tune gap/padding as needed for comfort per the Design).
- Leave the existing `@media (max-width:768px)` rule and the desktop
  `minmax(210px,1fr)`/20px-gap rule **untouched** (AC42).
- The already-shipped `aspect-ratio:16/9; object-fit:cover` thumbnail treatment
  is unchanged (AC40); cards stay uniform with or without a thumbnail (AC43).

Wrap your change in ONE labeled section
`/* === v1.21 FR-6: mobile grid density === */` so it is a distinct, disjoint
region from every other task's `style.css` edits.

## Tests

None required (CSS-only; on-device Dean pass is the arbiter). Run `npm run lint`
(0 warnings) and confirm the full `npm test` suite still passes on Node 22.

## File-ownership / serialization contract (STRICT — shared tree)

- You edit ONLY `public/css/style.css`, and within it ONLY your labeled `FR-6`
  section. Do NOT touch the desktop `.video-grid` rule, other tasks' sections, or
  any other file. (Other Wave-1 tasks T2/T3 own their own `style.css` sections.)

## Report back

The exact CSS added (the breakpoint + any gap/padding); confirmation the desktop
rule and the 16:9/object-fit treatment are untouched; lint + Node 22 test result;
a note that Dean's on-device pass confirms "comfortable" 2-column density.
