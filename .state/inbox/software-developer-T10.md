# T10 — C4 fun stats page + viewCount (v1.24, Wave 3)

**Cluster C · FR C4 · Gate: light · Depends on: T9 (server.js serialize-after)**

Read at wave start: `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md`
(`## Design` C4; `## Task breakdown` T10). **Serialize-after T9 on `server.js`
— merge/edit `server.js` only after T9 has landed.**

## Files you own (edit ONLY these)
- `lib/stats.js` (NEW)
- `public/stats.html` (NEW)
- `public/js/stats.js` (NEW)
- `server.js` — **serialize-after T9** (routes only: `GET /api/stats`,
  `POST /api/videos/:id/view`).
- `public/index.html` — nav link to the stats page (sole W3 owner of this file).

## Scope
- Pure aggregation helpers in `lib/stats.js`: count, total duration, total size,
  breakdowns by folder/channel/type, longest/shortest/newest. Unit-tested
  against a synthetic `db.metadata` fixture.
- `GET /api/stats` computed LIVE from `db.metadata` per request (O(n), always
  fresh — no cached aggregate).
- **Most-watched:** minimal additive `db.metadata[id].viewCount` (default 0),
  incremented ONCE per watch-page open via a dedicated `POST /api/videos/:id/view`
  (NOT on every `POST /api/progress`, NOT on `/video/:id` Range serve). If the
  round shrinks, most-watched is the explicit drop-candidate — the rest of the
  page stands without it.
- Retro-dashboard `stats.html` on-brand with the current era theme, reachable
  from the nav.

## Frozen cross-file contracts
- `db.metadata[id].viewCount` additive integer, default 0. Additive backfill —
  do NOT trigger any re-processing pass (backfill-regression lesson).
- Nav link in `index.html` only; if the nav is shared across shells and must be
  four-shell-identical, keep the stats page reachable from the main app nav and
  flag any parity need to the coordinator.

## Acceptance criteria (exec-plan C4)
- [UNIT][C] pure aggregation helpers against a synthetic fixture.
- [MANUAL][C] the page renders real numbers from the live library, reachable from
  the nav, on-brand with the era theme.
- [PROCESS][C] most-watched is backed by the new `viewCount` field (explicitly
  designed) OR explicitly scoped out — not left ambiguous.

## Standard footer (v1.24 UX Round — every SDE task)
- **Node 22 toolchain:** prepend to PATH:
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- **Verify:** `npm test` (baseline 1735 green) + `npm run lint` (0 errors + 8
  pre-existing `common.js` warnings baseline — add none). Pure helpers get
  `node:test` coverage.
- **Standards:** CommonJS, 2-space/semicolons/single-quotes, vanilla DOM,
  `textContent` over `innerHTML`, no new runtime deps.
- **Ownership:** edit ONLY the five files above; `server.js` only after T9.
  Need another file? STOP/report.
- **Git:** COORDINATOR owns ALL git. Do NOT commit/branch/stage/push. Report
  files changed + tests + Node 22 `npm test`/`npm run lint` results.
