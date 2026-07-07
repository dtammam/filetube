# Software Developer inbox — T6 (FR-7 proper download icon)

Feature: **v1.17.0 "Polish"** (feature_id `v1.17-polish`), branch
`feature/v1.17-polish` off `main` (v1.16.0). This is **Task T6**. It runs in
**parallel** with T1/T2/T3/T5/T7.

Review tier: **LIGHTER single-QA**; visual review across icon sets/eras/light-dark.

Locked product decision (open decision #2): ship a **real multi-icon-set SVG
mask**, NOT a patched Unicode glyph — the download icon must theme and vary by era
like every other chrome icon.

## Read first

- `.state/feature-state.json` — the `tasks` entry `"id": "T6"` is authoritative.
- `docs/exec-plans/active/2026-07-06-v1.17-polish.md` — read **`## Design` →
  `### FR-7 — Proper download icon across the icon sets`** in full, plus FR-7 ACs.
- `docs/CONTRIBUTING.md`.
- `public/assets/icons/README.md` — how the existing Material-Symbols assets are
  sourced/licensed (match it exactly for the new asset).
- `public/css/style.css` — the icon-set-axis section (~1737-1878): the base mask
  group (~1740-1751), the outlined mask-image assignment (~1764-1775), the
  `@supports` currentColor fill guard (~1781-1782), the `[data-icons="rounded"]`
  and `[data-icons="filled"]` blocks, the `[data-icons="emoji"]` neutralize group,
  and the OLD fixed-glyph rule `.icon-download::before { content: "\2B07"; }`
  (~1790-1793). `public/js/common.js` usages
  `injectOneOffDownloadButtonIfEnabled` (~1192/1217 — already emit
  `<i class="icon-download">`, need no change).
- `test/unit/shuffle-rescan-icon.test.js` and `test/unit/icon-assets.test.js` —
  the icon-set coverage test pattern to extend.

## Task — implement THIS ONE task only (FR-7)

1. **Add the SVG asset** (Material Symbols `download` / `file_download`) to all
   three set directories: `public/assets/icons/download.svg`,
   `public/assets/icons/rounded/download.svg`, and
   `public/assets/icons/filled/download.svg` — sourced/licensed exactly as the
   existing icons per `public/assets/icons/README.md`.
2. **Wire `.icon-download`** into every icon-set block in `public/css/style.css`,
   matching the treatment of a sibling chrome icon (e.g. `.icon-delete`): the base
   mask group, the outlined mask-image assignment, the `@supports` currentColor
   fill guard, the `[data-icons="rounded"]` block, the `[data-icons="filled"]`
   block, and the `[data-icons="emoji"]` neutralize group + an emoji `::before`
   (recommend `U+1F4E5` inbox tray).
3. **Remove** the old fixed-glyph rule `.icon-download::before { content:
   "\2B07"; }` (~1790-1793). Existing HTML/JS usages need no change (they already
   emit `<i class="icon-download">`).
4. **Extend the icon-set unit test** (style of
   `test/unit/shuffle-rescan-icon.test.js` / `icon-assets.test.js`) to assert the
   new asset + mask coverage across the sets.

## Hard constraints (non-negotiable)

- Must render correctly and consistently across all relevant icon sets
  (Outlined/Rounded/Filled/Emoji) AND all 4 eras (2005/2009/2014/2021), light/dark
  — same wiring as the other chrome icons (currentColor themed via mask).
- License/source the new SVG per `public/assets/icons/README.md`; do NOT introduce
  a differently-licensed asset. **No new runtime dependencies.**
- 2-space/semicolons/single-quotes; lint 0.

## Tests

Extend the existing icon-set `node:test` to cover `.icon-download`'s asset+mask
presence across the three sets (and the emoji neutralize/`::before`), matching how
the sibling icons are asserted.

## Toolchain / commands

Node 22 is the standard. Before any npm/node command export the fnm node PATH,
then use the Node 22 test toolchain bin:
`/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`.
Run `npm run lint` (0 warnings) and `npm test`; fix any failure before reporting.

## Git — DO NOT commit

The **coordinator owns ALL git**. Do NOT stage, commit, or push. Report files
changed + full test/lint output; the coordinator commits per task.

## Report back

- Files changed (paths + one-line summary each), listing the three new
  `download.svg` assets, the `.icon-download` wiring added to each icon-set block,
  and confirmation the old `\2B07` `::before` rule was removed.
- The extended icon-set unit test + Node 22 pass/fail output; lint result.
- The source/license of the new SVG (per README).
- Any deviation from the design or new fork (with a recommendation).
