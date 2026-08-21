# Stats-table per-item delete (Dean) - DESTRUCTIVE

Status: IN PROGRESS (branch `feat/stats-table-delete`)

Dean prunes his library by sorting the Stats "Videos & audio" table by size, then
searches for the item and deletes it from a card. Bypass that: add the tried-and-
true trash icon + two-tap confirm directly to the Stats tables that show deletable
media, same flow as a card (DELETE /api/videos/:id -> Trash, recoverable/purgeable).

DESTRUCTIVE -> FULL two-reviewer gate, never slim. The primary attack surface is the
v1.159 class: a two-tap delete inside a RE-RENDERING sortable table (sort/filter
rebuilds the row) must not let an arm survive a re-render into a one-tap delete.

## Intake (Dean's answers)
- Tables: Videos & audio + Most watched + Duplicates.
- Capability: MATCH the card delete - library-write (admin OR the modify-library
  flag), computed admin-OR-flag like main.js's fetchCardCornerState.
- After delete: remove the row (non-optimistic, on a confirmed 2xx); totals/tiles
  refresh on the next Stats load (not live).
- Duplicates: EXPAND each group row to per-copy deletes (a dup row is a GROUP of N
  copies; the user deletes exactly the copies they choose - zero wrong-file risk,
  reuses the single-item pattern).

## Data (all client-side already; NO server change)
- /api/library-items items carry `id` (server.js ~15202) - add to the A/V row.
- Most-watched entries carry `id` (lib/stats.js pickSummary ~131) - add to the row.
- Duplicate group.items are `{ id, filePath, size }` (lib/stats.js buildDuplicateGroup
  ~322), visibility-scoped already (visibleMetadataFor) - the expando lists these.

## Design
- Capability: stats.js fetches /api/auth/me once; `canModifyLibrary = role==='admin'
  || canModifyLibrary===true`. All delete affordances gated on it (a read-only
  viewer sees the tables with NO delete controls; the server DELETE is RBAC-gated
  regardless).
- Shared `buildStatsDeleteAction(mediaId, title, onDeleted, armRef)` in stats.js:
  the card/notification two-tap arm (nextArmState) -> DELETE /api/videos/:id ->
  deleteResultToast -> onDeleted(). NON-OPTIMISTIC (row leaves only on 2xx; failure
  re-enables). One-armed-at-a-time via a shared `armRef`.
- RE-RENDER SAFETY (v1.159): the LOAD-BEARING guarantee is the closure-local
  armState (a re-render rebuilds every button idle) - bound by a behavioural test
  (arm, re-sort, tap the SAME item -> it re-ARMS, never deletes). `onRender`/
  resetStatsArm is DEFENSIVE belt-and-suspenders only (clears a dangling armRef);
  the two gate seats disagreed on whether it binds, and a self-run mutation settled
  it: neutering resetStatsArm keeps the destructive suite green.

## Accepted residual (disclosed, both seats non-blocking)
- Duplicates in-place: deleting a copy that does NOT collapse the group updates the
  row DATA (recomputeRowAggregates) + the open panel, but the group row's
  Copies/Total/Reclaim CELLS stay stale until the next sort/filter re-render.
  Cosmetic, self-heals; a table.update would fix the cells but re-collapse the
  expando (worse for multi-copy pruning), and it matches Dean's "totals refresh
  next load" ruling. Left as-is.
- Row removal: keep the table handle from buildSortableTable; on delete, splice the
  row from the caller's `rows` array and call `table.update(rows)` (removal survives
  a later sort).
- A/V + Most watched: `actions: (row) => canModify ? buildStatsDeleteAction(...) :
  null`, `onRender: resetArm`.
- Duplicates: `actions: (row, tr) => canModify ? expandToggle` - the toggle attaches
  a full-row expando (the Users-access-editor pattern: a .stable-row child spanning
  grid-column 1/-1) listing each copy (filePath + size) with its own
  buildStatsDeleteAction. Deleting a copy removes it from group.items + the expando;
  when a group drops to <=1 copy, remove the whole group row via table.update.

## Gate + release
- FULL gate (destructive). Brief adversarial to DESTROY: arm-survives-a-re-sort ->
  one-tap delete; the WRONG id deleted (row/copy id mix-up after a sort); the
  capability gate bypass; the Duplicates expando deleting the wrong copy; non-optimism.
- Dual-Node. Device probes: sort A/V by size, delete the biggest (two-tap) -> to
  Trash, restorable; Most watched delete; expand a duplicate, delete a specific
  copy; a read-only account sees NO delete buttons.
