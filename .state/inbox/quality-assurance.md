# Code review — v1.24 UX Round, Wave 2 (Subscriptions, T6+T7+T8)

You are the quality-assurance reviewer. Review Wave 2 (Subscriptions) before it
ships as v1.24.1. This is a **light-tier** review per the exec plan's per-cluster
review tiers (subscriptions UI wiring against already-existing or simple new
endpoints, gated store only, no security-critical spawn/URL-validator surface) —
but apply full rigor to the constraint checks below.

## Context to load first
- `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md` — `## Design` sections
  A4, A5/B1, and "B3 / B4 / B — subscriptions"; the Wave 2 disjointness proof;
  `docs/CONTRIBUTING.md`; `docs/RELIABILITY.md`.
- The three Wave 2 tasks and their frozen contracts:
  - **T7** `lib/ytdlp/store.js`: new persisted `order` field (backfilled by
    array index in `ensureYtdlp`, mirroring `paused`/`skipShorts`); pure
    `reduceReorder(subs, orderedIds)`; `reorderSubscriptions` mutator;
    `listSubscriptions` sorts by `order`.
  - **T8** `lib/ytdlp/index.js`: pure `computeNextPollDue(lastCheckedMs,
    intervalMs)`; `POST /api/subscriptions/reorder`; pin-from-watch route;
    poll-timing fields on `GET /api/subscriptions/status`/`settings`.
  - **T6** `public/index.html`, `lib/ytdlp/views/subscriptions.html`,
    `lib/ytdlp/client/subscriptions.js`, `public/js/watch.js`: A5 repull-all
    control, B1 per-channel repull button (shown only for subscription
    `channelDir` views), A4 poll display, B3 pin-from-watch control, B4 DnD
    reorder reusing `common.js` `moveArrayItem`/`computeDropIndex` verbatim.

## Method
Run `git diff main` to see all Wave 2 changed files. Review each for correctness,
and specifically verify these round-invariant constraints:
1. **Disabled-module no-op:** with `FILETUBE_YTDLP_ENABLED=false`, none of the
   new routes / status fields / DOM controls are reachable (all inside the
   `isEnabled` gate).
2. **`db.folders` boundary:** the pin path (B3) and the order/reorder path (B4)
   write ONLY the gated subs/pins store — NEVER `db.folders`.
3. **Single source of truth:** the B3 pin record shape is IDENTICAL to the
   existing subscriptions-page pin flow (no forked persistence).
4. **No forked reorder logic:** B4 reuses `common.js` `moveArrayItem`/
   `computeDropIndex` verbatim; `common.js` is NOT edited in Wave 2.
5. **No new backend route for A5/B1:** they wire the ALREADY-EXISTING
   `POST /api/subscriptions/repull` and `POST /api/subscriptions/:id/repull`.
6. **Standards:** `textContent` over `innerHTML` for all new DOM; vanilla DOM;
   CommonJS; no new runtime dependencies; pure helpers have `node:test` coverage
   + a regression lock (`reduceReorder`, `computeNextPollDue`).
7. **Four-shell parity:** if any shared-shell icon/control markup changed, it
   stays byte-identical across the four shells (Wave 2 is not expected to touch
   the shared icon block — flag if it did).

## Report back (to the coordinator via your final message)
Findings as CRITICAL / WARNING / SUGGESTION with `file:line` references, then an
overall verdict: APPROVE / REQUEST CHANGES / NEEDS DISCUSSION. Do NOT edit code,
do NOT commit — review only.
