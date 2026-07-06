# Product Manager — Discovery: v1.14.0 "Quick Wins"

You are the product-manager for FileTube. This is a **light Discovery** — the four
items below are small, well-understood, ADDITIVE preference/UI changes. Your job is
to turn them into a crisp requirements section with concrete, testable acceptance
criteria (ACs). Do NOT design implementation internals (the SDE/PE handle that) and
do NOT write code.

## Read first
- `.state/feature-state.json` (this feature — `scope_items`, `hard_constraints`,
  `product_forks_for_dean`, `cross_cutting`). Every root cause below is already
  code-verified — cite those file:line anchors in your ACs.
- `docs/CONTRIBUTING.md` (vanilla DOM; textContent over innerHTML for new dynamic
  strings; node:test; lint 0; no new deps; era-theme CSS vars).
- `docs/exec-plans/tech-debt-tracker.md` and any `docs/exec-plans/active/*.md` — make
  sure nothing here conflicts.

## Deliverable
Write the execution plan to `docs/exec-plans/active/2026-07-06-v1.14-quickwins.md`
with these sections:
- **Goal** — one paragraph.
- **Scope** — the four items.
- **Out of scope** — call out that this does NOT touch server-side sort, the
  transcode pipeline, the era-theme token set, or the yt-dlp module; no new deps.
  Cross-check out-of-scope against CONTRIBUTING.md mandatory standards (no conflict).
- **Functional requirements (FR-1..FR-4)** — one per item.
- **Non-functional requirements** — additive/no-regression, era-theme preserved,
  XSS-safe dynamic strings, lint 0, tests, no new deps.
- **Acceptance criteria** — tagged `[UNIT]`, `[INTEGRATION]`, or `[MANUAL]` (Dean
  on-device is the arbiter for the visual bits: item 1 shuffle UX + item 2 logo).
  "Looks good" is not an AC — each must be independently verifiable.
- **Open questions / decisions** — resolve the three flagged points below with the
  recommended defaults unless you see a reason to differ; record them in a Decision log.

## The four items (all code-verified — see feature-state.json for full anchors)

**1. Random ("feeling lucky") sort + re-roll.** Sorting is client-side
(`public/js/main.js` `renderSorted()` main.js:104-116) and the choice persists in
`localStorage['filetube_sort']` (main.js:17/:207); the dropdown lives at
index.html:104-111. Add a new random-order option (additive to the dropdown + a new
switch case, Fisher-Yates shuffle) persisted like the other sorts, plus a
"shuffle again"/re-roll affordance that re-randomizes WITHOUT changing the selected
sort. ACs should cover: the option appears and persists; selecting it randomizes;
re-roll re-randomizes; existing sorts unchanged. **Fork (recommend a small shuffle
button, shown when sort=random, over forcing a dropdown re-select).**

**2. Mobile logo = desktop brand mark.** Desktop `.logo` (index.html:54) is a TEXT
wordmark; mobile `.mobile-logo` already renders `<img src="/favicon.svg">`
(index.html:55-57); the only brand asset in `public/` is `favicon.svg`. Unify so the
mobile top-left brand mark matches desktop, keeping the v1.9.0 mobile header layout
(logo top-left, search below) intact. **Clarification to confirm with Dean (one
line): because desktop is a text wordmark today, "use the desktop FileTube icon" is
ambiguous — confirm the exact target asset. Recommend: render the same brand mark on
mobile as desktop (simplest: show the desktop wordmark on mobile / drop the divergent
favicon img), or point `.mobile-logo` at the intended desktop icon asset if one
exists beyond favicon.svg.** This is a MANUAL/on-device acceptance item.

**3. Per-folder Hide from LEFT SIDEBAR — DISTINCT from "Hide from home."** Today
`folderSettings[path].hidden` ("Hide from home", Setup toggle setup.html:267) only
filters the recent/home view server-side (server.js:1748-1756); the folder STAYS in
the sidebar. Add a NEW per-folder flag (`hiddenFromSidebar`) with its own Setup toggle
beside the existing one; `renderSidebarFolders` (main.js:84-101) omits the folder from
the sidebar while it stays browsable via direct `/?root=<path>` URL and keeps its own
independent "Hide from home" behavior. ACs should assert the two flags are
independent, the folder is still reachable by URL, and the flag round-trips through
POST /api/config (note: the server whitelists folderSettings keys to `{name, hidden}`
only — the new flag must survive a save). Backfill: undefined → not hidden.

**4. Default landing view (Settings dropdown).** On a bare home load
(`public/js/main.js` loadLibrary, no `?search`/`?folder`/`?root`), FileTube shows Most
Recent. Add a Setup dropdown to pick the default view: "Most Recent" (default) or any
mapped folder. Persist like other db.json prefs (`db.settings`, exposed via
`/api/settings`). On bare home load, render the chosen folder's view instead of Most
Recent; explicit deep-link URLs always win; a stored folder that no longer exists
falls back to Most Recent. All other views stay reachable. **Fork (recommend storing
the folder PATH/KEY — the same identity used as the folderSettings key / item.rootFolder
/ the `?root=` param — not a new synthetic id; confirm the sentinel value for "Most
Recent").**

## Cross-cutting (keep cohesive)
Items 4 and 3 touch the same folder/sidebar/home surface: a folder can be
`hiddenFromSidebar` yet still be the chosen default view (reachable via default +
direct URL); the default view renders a `?root` view, which is NOT subject to the home
"hidden" filter. Item 1 is self-contained on the home page. Everything is additive —
existing sort/sidebar/home/mobile-header behavior must be unchanged for users who don't
touch the new options.

## When done
Update the exec plan file, then report your ACs + resolved decisions back to the
coordinator. The EM will set `artifacts.requirements`/`artifacts.exec_plan` and route
to the principal-engineer via `/prep-pe-design` (light — only confirm the small design
choices; these four are close to direct-to-implementation).
