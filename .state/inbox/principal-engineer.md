# Principal Engineer — SHORT design note: HR1b finding D (DELETE-vs-scan membership resurrection)

You are the Principal Engineer. This is a **narrow, single-issue design note** — NOT a
redesign. Produce the exact reconciliation rule for one concurrency bug the two-reviewer
QA gate surfaced, so the Software Developer can implement it correctly next. Do NOT write
application code; write the rule + tests into the exec plan. Do NOT design the mechanical
HR1a fixes (those are already scoped to the SDE) or anything else.

## The issue (finding D — PRE-EXISTING, but we are fixing it)

EM decision (flagged to Dean): FIX this, don't tech-debt-track it — it is the SAME
stale-snapshot clobber class this branch is named for closing, just at the MEMBERSHIP
dimension; leaving it undercuts the "class eliminated" headline claim. It edits the subtle,
load-bearing scan Phase-2 reconcile, so it gets your short note first.

The scan Phase-2 mutator (server.js:1003-1031) does:

```js
fresh.metadata = mergeScannedMetadata(fresh.metadata, newMetadata);
```

`newMetadata` is built in **Phase 1** (outside the lock, server.js ~985+) from a
pre-delete snapshot of the filesystem. Membership is taken WHOLESALE from `newMetadata`.
So a `DELETE /api/videos/:id` that COMMITS during the scan (removing `db.metadata[id]` +
unlinking the file, via the serialized `updateDatabase`) is UNDONE: the id is resurrected
as a dangling entry (file gone, entry back) until the next prune scan.

## Read first

- `server.js`: the Phase-1 scan snapshot / `newMetadata` build (~825 for the initial
  `loadDatabase()` snapshot; the extraction loop building `newMetadata`), the `selectPrunableIds`
  and `prunable` set, `mergeScannedMetadata` (server.js:410), and the Phase-2 mutator
  (1003-1031, incl. the FR3.3 transcodeStatus seed and the progress/persistedServedAt prune).
- `docs/exec-plans/active/2026-07-05-harden-db-writes-and-logo.md` — its `## Design` section
  (the scan-collapse invariants). Append your note there.
- `.state/feature-state.json` — `review_hr1.D_delete_vs_scan_resurrection` and the `HR1b` task.
- v1.8.0's mount-loss guard / `mergeScannedMetadata` (lastServedAt-only-advances) / FR3.3
  contracts you must not regress: `docs/exec-plans/completed/2026-07-05-settings-automation-cache.md`.

## Proposed rule (confirm or refine, then specify exactly)

In the Phase-2 mutator, reconcile membership against the FRESH (in-lock) db:

- An id in `newMetadata` that WAS present in the Phase-1 db snapshot but is NOW ABSENT from
  `fresh.metadata` was DELETED concurrently -> do NOT resurrect it (drop it from the merge).
- A genuinely-NEW id the scan found (absent from BOTH the Phase-1 snapshot AND `fresh.metadata`)
  is still ADDED (that's the scan's whole job).
- An id present in `fresh.metadata` and still scanned is merged as today.

This requires capturing the Phase-1 snapshot's metadata id-set (the keys of the scan-start
`loadDatabase()` snapshot) and passing it into the reconcile. Specify: where that id-set is
captured, the exact change at/around the `mergeScannedMetadata` call (whether the drop happens
in the mutator before/within the merge, or by extending `mergeScannedMetadata`'s contract — your
call, but keep it auditable and keep `mergeScannedMetadata`'s lastServedAt-max semantics intact).

## Must confirm no regression

- **Mount-loss guard:** a missing/unmounted root still retains its entries (they're absent from
  `newMetadata` because unscanned, but must NOT be dropped — the drop rule must key off
  "was in Phase-1 snapshot AND scanned in newMetadata AND now absent from fresh", i.e. a genuine
  concurrent delete, NOT "unscanned this pass"). Make the distinction explicit so an unmounted
  root or an unreadable subtree is NOT mistaken for a concurrent delete.
- **`lastServedAt` on-disk authority:** unchanged (mergeScannedMetadata still only advances).
- **FR3.3 transcodeStatus seed:** unchanged.
- **Prune path:** the existing `prunable`/mount-loss prune of genuinely-gone files still applies;
  the new drop rule is specifically for a CONCURRENT delete during the scan.

## Deliverable

Append a short "### HR1b (finding D) — DELETE-vs-scan membership reconciliation" subsection to the
exec plan's `## Design`: the confirmed rule, the exact change site(s), the mount-loss/lastServedAt/
FR3.3/prune non-regression argument, and the regression test spec:

- **Headline test:** a `DELETE /api/videos/:id` committing DURING an in-flight scan leaves the entry
  DELETED (not resurrected) after the scan save — must FAIL pre-fix, PASS after (mirror the
  scan-clobber harness in `test/integration/scan-api.test.js`; no FFmpeg).
- Plus: a genuinely-new scanned id is still added; the non-concurrent case is unchanged; an
  unmounted-root / unreadable-subtree entry is NOT dropped (guard against the false-positive).

This note is design-only — no code, no conflict with HR1a (which edits routes/saveDatabase/
recordServed/loadDatabase/startup). Sequencing: the HR1b SDE task runs AFTER HR1a build-verifies
AND this note lands. When done, tell the coordinator the D note is ready.
