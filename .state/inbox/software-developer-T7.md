# T7 — B4 subscription order field + reorder reducer/mutator (v1.24, Wave 2)

**Cluster B · FR B4-store · Gate: light · Depends on: none**

Read at wave start: `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md`
(`## Design` "B3 / B4 / B — subscriptions"; `## Task breakdown` T7).

## Files you own (edit ONLY this)
- `lib/ytdlp/store.js`

## Scope
- Add a persisted `order` field to the subscription record, backfilled by
  current array index in `ensureYtdlp` (mirrors how `paused`/`skipShorts` are
  backfilled), persisting on next write. Defaults sensibly for existing
  un-ordered subscriptions.
- Pure `reduceReorder(subs, orderedIds)`: assign `order` = position for ids in
  `orderedIds`; IGNORE unknown ids; ids missing from `orderedIds` keep tail
  order. No side effects.
- `reorderSubscriptions(deps, orderedIds)` mutator that persists via the gated
  subs store (NEVER `db.folders`).
- `listSubscriptions` consumers sort by `order`.

## Frozen cross-file contracts
- **Export `reduceReorder` and `reorderSubscriptions`** for T8's reorder route.
  Confirm the exact export names with the coordinator; T8 imports them.
- `order` is an integer field on each subscription record.
- Disabled-module no-op preserved (store changes are module-owned).

## Acceptance criteria (exec-plan B4)
- [UNIT][B] `order` field backfill defaults sensibly for existing un-ordered
  subscriptions; `reduceReorder` assigns positions, ignores unknown ids, keeps
  missing ids in tail order (pure, `node:test`).

## Standard footer (v1.24 UX Round — every SDE task)
- **Node 22 toolchain:** prepend to PATH:
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- **Verify:** `npm test` (baseline 1735 green) + `npm run lint` (0 errors + 8
  pre-existing `common.js` warnings baseline — add none). Pure helpers get
  `node:test` coverage + a regression lock.
- **Standards:** CommonJS, 2-space/semicolons/single-quotes, no new runtime deps.
- **Ownership:** edit ONLY `lib/ytdlp/store.js`. Need another file? STOP/report.
- **Git:** COORDINATOR owns ALL git. Do NOT commit/branch/stage/push. Report
  files changed + tests + Node 22 `npm test`/`npm run lint` results.
