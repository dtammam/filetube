# Software Developer — T3 (Item 2): mobile logo top-left

You are the Software Developer. Implement **T3 ONLY** — the mobile logo cosmetic
change. This is Item 2, a SEPARATE commit from ALL the db.json hardening (Item 1),
CSS-only, low-risk. You have no shared context with the EM — everything you need is
below. Do NOT touch server.js or any hardening code.

## Goal

On MOBILE, move the logo to TOP-LEFT on BOTH the home page and the watch/video page,
matching the desktop layout (which is already top-left — leave desktop alone). Remove the
centered `.mobile-logo` treatment. The search stays FULL-WIDTH on the row below the logo.
Decision is locked by Dean; do not re-open it. This is `[MANUAL]`-visual (Dean confirms
on-device) + `[PROCESS]` (lint/tests green) — build-specialist verify only, NOT the
two-reviewer gate.

## Read first

- `docs/exec-plans/active/2026-07-05-harden-db-writes-and-logo.md` — the `## Design`
  section's "### Item 2 — mobile logo top-left (CSS only)" is authoritative.
- `.state/feature-state.json` — the `T3` task entry for `done_when`.
- `public/css/style.css` — the mobile app-shell block (see exact lines below).

## Exact change (two edits, both inside ONE block)

The target is the **"Mobile app shell: header restructure"** block, which starts at
`public/css/style.css:1583` (the lead comment `/* ---- Mobile app shell: header
restructure ... */`). Make BOTH edits inside THIS block only:

1. `.mobile-logo img` (style.css:1610-1614): change `margin: 0 auto;` (line 1614) to
   `margin: 0;`. Keep `display: block;` and `height: 28px; width: 28px;`.
2. `.header-left` (style.css:1617-1619, the one INSIDE this mobile app-shell block):
   change `justify-content: center;` (line 1619) to `justify-content: flex-start;`.
   Keep `width: 100%;` and `gap: 0;`.

Also update this block's lead comment (around 1583-1585) from describing a "Centered logo"
to "Top-left logo + full-width search below it".

IMPORTANT — pick the RIGHT rule: there are OTHER `.header-left` and `justify-content:
center` declarations elsewhere in the file (e.g. a `.header-left` at ~1515/1561 in a
different breakpoint, and many unrelated `justify-content: center` lines). Edit ONLY the
two declarations inside the mobile app-shell block starting at line 1583. Do not touch any
other rule.

## What stays exactly as-is

- The header stays `flex-direction: column`, so `.header-search` stays `width: 100%`
  full-width on the row BELOW the logo (do not change `.header-search`).
- `.logo` stays hidden, `.mobile-logo` stays shown, `.header-right` stays hidden.
- The bottom-nav app-shell (Home/Playlists/Dark/Settings) is untouched.
- `safe-area-inset-top` handling: the header's `padding: calc(8px + env(safe-area-inset-top))
  ...` and `min-height` are untouched.
- Desktop (>768px) is provably unchanged — both edits are inside the mobile `@media` block.
- a11y: `aria-label="FileTube home"` and the logo's link-to-home + tab order are DOM-driven
  and untouched (CSS-only change). No `public/js/*.js` selector breaks (no class/id/DOM change).
- No icon-set (Outlined/Rounded/Filled/Emoji/Auto) or theme (light/dark) regression — only
  alignment changes.

## Scope / constraints

- `public/css/style.css` is the only file you should need to change. NO server.js / backend
  changes (if you think one is genuinely needed, STOP and flag it rather than editing server.js).
- Both `index.html` (home) and `watch.html` (watch) share this header + stylesheet, so this
  one CSS change covers both. `setup.html` shares the header too (no `.header-search`) — glance
  that it stays visually consistent, but no separate edit is expected.
- `npm run lint` 0 errors (no new warnings beyond the 11-warning baseline); `npm test` stays
  green (this is CSS-only; confirm no existing test asserts on header markup — none is expected).
- `test/unit/transcode-cache.test.js` and all other suites stay green/unmodified.
- Before any npm/node command: `export PATH="/home/coder/.local/share/fnm/node-versions/v24.14.0/installation/bin:$PATH"`.
- Run `npm run lint` and `npm test` and fix any failures before reporting done. Report the
  exact lines changed.

When done, tell the coordinator T3 is complete so the EM can route to the build-specialist
(`/prep-build-verify`). After T3 build-verifies, the coordinator takes the whole branch to a PR
(two commits: the hardening + the logo). Dean does the [MANUAL] on-device visual confirmation on the PR.
