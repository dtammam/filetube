# T3 — C2 item count + C3 format toggle + C5 sort case + F1 avatar fallback (v1.24, Wave 1)

**Cluster C/F · FR C2, C3, C5-sort, F1-fallback · Gate: light · Depends on: none**

Context + design: `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md`
(`## Design` C2/C3, C5, "Clusters E/F/G" F1; `## Task breakdown` T3).

## Files you own (edit ONLY this)
- `public/js/common.js` — SOLE `common.js` owner in Wave 1. (Note: the 8
  pre-existing lint warnings live here — do NOT fix them and do NOT add new ones.)

## Scope
- **C2:** pure `countItems(list)` → "N items" in every section header (home,
  folder, playlist, channel). Header count reflects the active C3 filter.
- **C3:** pure `filterByMediaType(list, mode)` partitioning video-only /
  audio-only / both (missing/ambiguous type FAILS SAFE to "both"); a persisted
  `localStorage` preference matching the existing sort-preference persistence
  pattern; the toggle applies everywhere the library is browsed.
  **Inject the count + format-toggle controls via `createElement`/`textContent`
  — do NOT add static markup to any HTML shell** (T1 owns the shells this wave).
- **C5-sort:** add a `release-date` case to `sortItems` (~L867) reading
  `item.releaseDate` with `addedAt` fallback for items with no captured date.
  Every existing case (`newest`/`oldest`/`title-*`/`size-*`/`random`) stays
  **byte-identical**; the current DEFAULT sort is **regression-locked** by a test.
  Add "Release date" as a NEW option in the sort dropdown (available-only — NOT
  the default; Dean's decision 8).
- **F1-fallback:** pure `deriveAvatar(name)` → deterministic color+glyph from
  era-theme tokens (same input → same output). Apply the avatar precedence —
  use `channelAvatarUrl` when present, else `deriveAvatar` — to the
  sidebar/playlists folder-icon render and the subs-list render.

## Frozen cross-file contracts
- **Export `deriveAvatar(name)` from `common.js`** so `watch.js` (T4, same wave)
  can call it. Agree the exact global/export name with the coordinator; T4's
  inbox references `deriveAvatar`.
- Read item field `releaseDate` = **epoch milliseconds** or null (populated by
  T5 in `server.js` this wave; absent items fall back to `addedAt`).
- Read item/channel field `channelAvatarUrl` = string URL or null (populated by
  T11 in Wave 3; null now — build the precedence now so T11 never re-touches a
  client file).

## Acceptance criteria (exec-plan C2, C3, C5, F1)
- [UNIT] `countItems`, `filterByMediaType` (incl. ambiguous→both), `sortItems`
  `release-date` case + a test that LOCKS the existing default, `deriveAvatar`
  stability. [UNIT] every existing `sortItems` case unchanged byte-for-byte.
- [MANUAL] accurate "N items" updating with the filter; toggle persists across
  reload; same channel → same generated avatar everywhere.

## Standard footer (v1.24 UX Round — every SDE task)
- **Node 22 toolchain:** prepend to PATH:
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- **Verify:** `npm test` (baseline 1735 green) + `npm run lint` (0 errors + the
  8 pre-existing `common.js` warnings baseline — add NONE, fix NONE). Every new
  pure helper gets `node:test` coverage + a regression lock.
- **Standards:** CommonJS, 2-space/semicolons/single-quotes, vanilla DOM,
  `textContent` over `innerHTML`, no new runtime deps.
- **Ownership:** edit ONLY `public/js/common.js`. Need another file? STOP/report.
- **Git:** COORDINATOR owns ALL git. Do NOT commit/branch/stage/push. Report
  files changed + tests + Node 22 `npm test`/`npm run lint` results.
