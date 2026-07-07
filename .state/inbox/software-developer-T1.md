# Software Developer inbox — T1 (FR-1 + FR-2 mobile layout, ANCHOR)

Feature: **v1.17.0 "Polish"** (feature_id `v1.17-polish`), branch
`feature/v1.17-polish` off `main` (v1.16.0). This is **Task T1**, the anchor of
the branch. It runs in **parallel** with T2/T3/T5/T6/T7 — you touch only mobile
layout CSS (and shells/`main.js` markup **only if** the diagnostic forces it).

Review tier: **LIGHTER single-QA** — but **Dean's on-device pass (iOS Safari,
phone width) is the ARBITER**. There is NO headless-browser/E2E infra in this
repo (`docs/RELIABILITY.md`), so you cannot claim the visual fix as
`[UNIT]`/`[INTEGRATION]`; the one testable artifact is the console diagnostic.

## Read first

- `.state/feature-state.json` — the `tasks` entry `"id": "T1"` is the
  authoritative scope; also read `hard_constraints` and `cross_cutting`.
- `docs/exec-plans/active/2026-07-06-v1.17-polish.md` — read **`## Design` →
  `### FR-1 + FR-2 — joint mobile-layout investigation`** in full (it lists what
  was already ruled OUT so you do not churn it, the mandatory diagnostic, the
  ranked suspects, and the FR-2 safe-area hypothesis), plus FR-1/FR-2 acceptance
  criteria and the `## Decision log`.
- `docs/CONTRIBUTING.md` (standards) and `docs/RELIABILITY.md` (no E2E harness).
- `public/css/style.css` — especially the header/search-box CSS (~303-344), the
  mobile column layout (~1987-2022), `#sort-select` (~517-526), the mobile
  portrait `.player-container { max-height:45vh }` cap (~2226-2230), the fixed
  `header`/`.app-container` safe-area rules (~1990/1996), `.bottom-nav`
  (~1941-1955), and the `.playlists-sheet-backdrop :not([hidden])` precedent.

## Task — implement THIS ONE task only (FR-1 + FR-2)

**Step 0 (MANDATORY, gates the fix). NAME the offender before touching CSS.**
Per the AC you must identify the specific element that overflows `100vw`, not
"some CSS somewhere," and you must NOT add another `overflow-x:hidden` /
`min-width:0` band-aid on top of the existing ones. Run this in Safari Web
Inspector (on-device or the responsive simulator) on the home, watch, and setup
pages at 375-414px width and record the output in your report + the Decision log:

```js
[...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).map(e => e.tagName + '.' + e.className + ' -> ' + Math.round(e.getBoundingClientRect().right))
```

**FR-1 fix.** Apply the source fix to the NAMED offender only. The ranked prime
suspect is the home sort `<select id="sort-select">` (no `max-width`/`min-width:0`;
its longest option "I'm Feeling Lucky (random)" gives a large intrinsic width and
it refuses to shrink inside the wrapped `.section-actions` row, pushing past the
viewport). If confirmed: `.section-actions .sort-select { max-width:100%;
min-width:0; }` and ensure `.section-actions { min-width:0 }`. If the diagnostic
points elsewhere, fix **that** element with the same discipline (constrain the
offender via `max-width:100%`/`min-width:0`/`flex-wrap`), never a shell-level
`overflow-x` mask. Then re-verify the folded-in "certain videos wrong-size" /
"cards read large" reports — these are almost certainly symptoms of the same
zoom-out, not separate bugs. The 45vh mobile player cap is correct as written;
do not change it unless on-device proves otherwise.

**FR-2 fix (watch-page scroll-jump).** Hypothesis: iOS dynamic-viewport
(address-bar collapse) recompute — `env(safe-area-inset-top)` is baked into BOTH
the fixed `header` `min-height: calc(96px + env(safe-area-inset-top))` AND
`.app-container { padding-top: calc(96px + env(safe-area-inset-top)) }`, so when
the address bar collapses on scroll both jump together and the content block
shifts (read as the bottom panel jumping; video-dependent because only
long-enough pages scroll; a refresh settles it). Fix direction: make the content
top **invariant** across the address-bar animation — give `.app-container` a
stable pixel `padding-top` and absorb the notch inset separately (dedicated fixed
spacer, or move the inset onto `header` padding only, not the content offset).
Secondary suspect: the fixed `.bottom-nav` / docked `#player-dock` bottom offset
repainting at stale positions during the same animation — verify whether the
"panel" Dean sees is the bottom nav and apply the same stable-offset approach.

Record in the `## Decision log` whether one root-cause fix closed both or they
diverged (the design's conclusion is they diverge: FR-1 = X-axis `>100vw`
overflow, FR-2 = Y-axis safe-area recompute — investigated jointly, two fixes).

## Hard constraints (non-negotiable)

- **No `overflow-x:hidden` / new blanket band-aid** — the AC forbids it and this
  bug has regressed behind exactly such patches before. Fix the measured offender.
- **No regressions** to the header/search collapse, docked mini-player,
  resume overlay, skip controls, dock/expand transition, or other pages' notch
  handling (the header/`.app-container` rules are shared by all four shells — if
  you change the safe-area offset, verify home + watch + setup on-device).
- Any new/changed CSS uses existing **era-theme tokens** — no hardcoded colors
  that break the 2005/2009/2014/2021 eras or light/dark modes.
- No new runtime dependencies. 2-space indent, semicolons, single quotes,
  `textContent` (not `innerHTML`) for any NEW dynamic strings. Lint 0 warnings.
- Prefer CSS-only fixes; only touch `public/*.html` /
  `lib/ytdlp/views/subscriptions.html` / `public/js/main.js` if markup genuinely
  must change to constrain the offender — do NOT expand into other FRs' surfaces.

## Tests

No pure DOM helper is expected here (the design says extract none — there is no
pure decision to extract; the console diagnostic is the testable artifact).
If your fix happens to produce a pure helper, add `node:test` coverage. Otherwise
the arbiter is Dean's on-device pass. `npm run lint` must be 0 warnings and
`npm test` must stay green on Node 22.

## Toolchain / commands

Node 22 is the standard. Before any npm/node command export the fnm node PATH
(per repo convention), then use the Node 22 test toolchain:

- Node 22 test toolchain bin: `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`

Run `npm run lint` (0 warnings) and `npm test`; fix any failure before reporting.

## Git — DO NOT commit

The **coordinator owns ALL git**. Do NOT stage, commit, or push. Report files
changed + full test/lint output; the coordinator commits per task.

## Report back

- The **console-diagnostic output** (the named offending element[s]) — this is
  required evidence, not optional.
- Files changed (paths + one-line summary each) and the exact CSS rules added/
  changed for FR-1 and FR-2.
- Whether FR-1 and FR-2 resolved to one fix or two (for the Decision log), and
  whether the folded-in wrong-size/cards-large symptoms cleared once overflow was
  gone.
- Lint + Node 22 test result.
- Any deviation from the design or new fork (with a recommendation) — do NOT
  expand scope into other FRs' files.
