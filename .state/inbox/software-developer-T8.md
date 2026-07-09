# T8 — A4 poll-timing helper + B3/B4 gated routes (v1.24, Wave 2)

**Cluster A/B · FR A4, B3-route, B4-route · Gate: light · Depends on: T7**

Read at wave start: `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md`
(`## Design` A4 + "B3 / B4 / B"; `## Task breakdown` T8).
**Re-read `lib/ytdlp/index.js` fresh at wave start** (chronic-hot, 5-of-7 waves).

## Files you own (edit ONLY this)
- `lib/ytdlp/index.js` — Wave 2 owner. **New routes + helper only.**

## Scope
- **A4:** pure `computeNextPollDue(lastCheckedMs, intervalMs)` → next-due epoch
  (or `null` when `intervalMs === 0`). Surface last-pulled / next-pull-estimate
  fields in the `GET /api/subscriptions/status`/`settings` response (T6 renders
  them). No new persistence — reuse `sub.lastCheckedAt` + the armed interval.
- **B4-route:** `POST /api/subscriptions/reorder` calling T7's
  `reorderSubscriptions(deps, orderedIds)`.
- **B3-route:** pin-from-watch route reusing the EXISTING gated pins store
  (`/api/subscriptions/pins`) — add a route ONLY if an existing pins route does
  not already suffice; the pin record shape must be IDENTICAL to the existing
  subscriptions-page pin flow (single source of truth). NEVER write `db.folders`.
- All routes/handlers inside the `isEnabled` gate.

## Frozen cross-file contracts
- Imports `reduceReorder`/`reorderSubscriptions` from `store.js` (T7).
- Exposes to T6: `POST /api/subscriptions/reorder`, the pin route, and the
  poll-timing fields on the status/settings response.
- **Disabled-module no-op:** `FILETUBE_YTDLP_ENABLED=false` → none of these
  routes/fields reachable.

## Acceptance criteria (exec-plan A4, B4, B3)
- [UNIT] `computeNextPollDue` (incl. the `intervalMs===0 → null` case);
  reorder route persists the new order; B3 pin record shape identical to the
  existing pin flow. [MANUAL] via T6's UI (poll display, DnD persistence, pin).

## Standard footer (v1.24 UX Round — every SDE task)
- **Node 22 toolchain:** prepend to PATH:
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- **Verify:** `npm test` (baseline 1735 green) + `npm run lint` (0 errors + 8
  pre-existing `common.js` warnings baseline — add none). Pure helpers get tests.
- **Standards:** CommonJS, 2-space/semicolons/single-quotes; arg-array spawn
  discipline unaffected; no new runtime deps.
- **Ownership:** edit ONLY `lib/ytdlp/index.js`. Need another file? STOP/report.
- **Git:** COORDINATOR owns ALL git. Do NOT commit/branch/stage/push. Report
  files changed + tests + Node 22 `npm test`/`npm run lint` results.
