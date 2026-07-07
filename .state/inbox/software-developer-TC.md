# SDE Task TC — FR-5: Pins in the desktop sidebar (Wave 2)

Feature: **v1.22.0 "Player Parity + Roadmap"** — branch `feature/v1.22-player-parity`.
Exec plan (READ `## Design (FR-2..FR-10)` → the `### FR-5` subsection in full): `docs/exec-plans/active/2026-07-08-v1.22-player-parity.md`.
Standards: `docs/CONTRIBUTING.md`.

**Wave 2.** Do not start until the coordinator confirms Wave 1 integrated.
You touch `public/js/common.js`, `public/js/main.js`, `public/js/watch.js`,
`public/js/setup.js`, `public/css/style.css` — later client tasks serialize AFTER you.

## Context
v1.21 shipped channel pins ONLY in the mobile Playlists sheet. `#sidebar-folders-list`
(desktop left-nav) lives OUTSIDE `#view-root`, so `renderSidebarFolders` is
independently duplicated in three files (`main.js:208`, `watch.js:982`,
`setup.js:241`). Add the desktop-sidebar pin counterpart WITHOUT de-duplicating
those three folder renderers (out of scope — larger/riskier refactor).

## Scope
1. **`common.js`:** add ONE shared `renderPinnedSidebar(pins)` mirroring the
   existing `renderPinnedPlaylists` (common.js:2333) EXACTLY — reuse the same pure
   `derivePinnedPlaylistEntries` (common.js:2303, AC34) and the same
   `createElement`/`textContent`/`createTextNode`-only construction (a pin label
   is creator-controlled/untrusted — NEVER `innerHTML`, AC35). Make it idempotent
   (remove any prior `#sidebar-pinned-section` first).
2. **Placement:** insert a SEPARATE sibling container `#sidebar-pinned-section`
   immediately AFTER `#sidebar-folders-list` (NOT a child), so the frequent
   folder-list `innerHTML` rebuilds (drag-reorder) never wipe the pins.
3. **Three call sites:** in each of `main.js`/`watch.js`/`setup.js` `init()`,
   fetch `GET /api/subscriptions/pins` (404 → `[]`, AC37) and call
   `renderPinnedSidebar(pins)` — same chained-fetch pattern `openPlaylistsSheet`
   uses (common.js:2394). Each pin is
   `<a href="/?root=<encodeURIComponent(channelDir)>" class="sidebar-item">` with
   an `icon-star`, identical to the mobile sheet (AC32).
4. **`style.css`:** small `#sidebar-pinned-section` heading/spacing rule using era
   tokens only (AC73). No hardcoded colors.

## Hard invariant (AC36)
Read-only consumer of the existing gated pin store + routes. NEVER writes
`db.folders`/`folderSettings`; introduces no new write surface. `POST /api/config`
must remain untouched. Regression-lock the existing `db.ytdlp.pins`-only invariant
(reuse the `test/integration/ytdlp-pins.test.js` posture).

## Tests
Unit: `renderPinnedSidebar` uses `createTextNode`/`textContent` only (AC35), reuses
`derivePinnedPlaylistEntries` (AC34). Integration: pin store never touches
`db.folders`/`folderSettings` (AC36); disabled-module → pins fetch 404 → `[]` →
folders-only sidebar, byte-identical to today (AC37).

## Acceptance criteria owned: AC32, AC33, AC34, AC35, AC36, AC37, AC38, AC73, AC75.

## Gate & reporting
- **Gate:** two-reviewer (folders/config invariant).
- Run Node 22 tests + lint; fix failures. **Report:** files changed, confirmation
  the pins are a sibling (not child) of `#sidebar-folders-list`, test output.

---
**Toolchain:** Node 22 at `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin` — prepend to PATH. Test: `npm test`. Lint: `npm run lint`. Absolute paths.
**Git:** COORDINATOR owns ALL git. Do NOT commit. Report files-changed + test/lint output only.
