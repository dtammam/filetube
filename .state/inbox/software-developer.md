# Software Developer — HR1b: finding D (DELETE-vs-scan membership resurrection)

You are the Software Developer. Implement **HR1b ONLY** — the finding-D membership
reconciliation in the scan Phase-2 mutator, exactly per the Principal Engineer's note.
This is the LAST hardening fix. You have no shared context with the EM — everything you
need is below. Do NOT touch T3 (mobile logo) or re-open HR1a's error-handling changes.

## Context

HR1a (route try/catch, saveDatabase rethrow, recordServed leak, loadDatabase backfill,
temp sweep) is DONE and build-verified (lint 0, npm test 212/212). HR1b closes finding D,
the last item from the two-reviewer gate.

**The bug:** the scan builds `newMetadata` in Phase 1 (outside the lock) from a pre-delete
snapshot. The Phase-2 mutator sets `fresh.metadata = mergeScannedMetadata(fresh.metadata,
newMetadata)`, taking membership WHOLESALE from `newMetadata`. So a `DELETE /api/videos/:id`
that COMMITS during the scan (removing `db.metadata[id]` via the serialized `updateDatabase`)
is UNDONE — the id is resurrected as a dangling entry until the next prune scan. This is the
same stale-snapshot clobber class this branch closes, at the membership dimension.

## Read first

- `docs/exec-plans/active/2026-07-05-harden-db-writes-and-logo.md` — the `## Design` section's
  "### HR1b (finding D) — DELETE-vs-scan membership reconciliation" subsection is AUTHORITATIVE.
- `.state/feature-state.json` — the `HR1b` task entry (`pe_rule`) and `review_hr1.D_delete_vs_scan_resurrection`.
- `server.js` — `runScanDirectories`: the Phase-1 snapshot (`const db = loadDatabase()` ~825),
  `survivingIds`/`oldIds` at server.js:994-995, the `selectPrunableIds`/`prunable` computation,
  and the Phase-2 mutator (`await updateDatabase(fresh => { ... })` at ~1003), whose
  `fresh.metadata = mergeScannedMetadata(fresh.metadata, newMetadata)` is at ~1021.
- `test/integration/scan-clobber.test.js` / `test/integration/scan-api.test.js` — the interleave
  harness to mirror (no FFmpeg; concurrency simulated by interleaving synchronous calls in the same
  tick, then awaiting).

## The reconciliation rule (per the PE — implement exactly)

A single per-id test keyed on "was this id in the Phase-1 snapshot?":

- **(in Phase-1 snapshot) AND (now ABSENT from `fresh.metadata`)** = concurrently DELETEd
  during the scan -> **DROP** it from `newMetadata` (don't resurrect).
- **still present in `fresh.metadata`** (including mount-loss / unreadable / toggle-off RETAINED
  entries) -> **KEEP** (merged as today).
- **NOT in the Phase-1 snapshot** (a genuinely-new scanned file) -> **KEEP/ADD** (the scan's job).

The "was in the Phase-1 snapshot" column is the load-bearing discriminator: the naive
"absent-from-fresh -> drop" rule is WRONG (it would eat genuinely-new files).

## Exact change

1. Capture the Phase-1 id-set. There is already `const oldIds = Object.keys(db.metadata);` at
   server.js:995 (where `db` is the scan-start snapshot). Add right after it:

   ```js
   const phase1Ids = new Set(oldIds);
   ```

   `phase1Ids` is closed over into the Phase-2 mutator (no new read, no lock).

2. In the Phase-2 mutator, immediately BEFORE
   `fresh.metadata = mergeScannedMetadata(fresh.metadata, newMetadata);` (~1021), add the drop loop:

   ```js
   // finding D: a DELETE that committed DURING this scan removed the id from the
   // fresh (in-lock) db. newMetadata was built from a pre-delete Phase-1 snapshot,
   // so merging it wholesale would RESURRECT the just-deleted entry. Drop any id
   // that was present at Phase-1 but is now absent from fresh -- a genuine concurrent
   // delete -- while still adding genuinely-new scanned ids (absent from phase1Ids).
   for (const id of Object.keys(newMetadata)) {
     if (phase1Ids.has(id) && !Object.prototype.hasOwnProperty.call(fresh.metadata, id)) {
       delete newMetadata[id];
     }
   }
   ```

   (Per the PE's optional note, you MAY hoist this drop loop above the reconcile loop — the
   reconcileTranscode probe of a to-be-dropped id is harmless existsSync-only, but hoisting
   avoids it entirely. Either placement before the merge is acceptable.)

## DO NOT TOUCH

- `mergeScannedMetadata`'s body stays **byte-unchanged** (its lastServedAt-max contract + its
  `database.test.js` unit cases must stay green unmodified — proof the merge itself is untouched).
- `updateDatabase`'s body stays unchanged.
- HR1a's error-handling / loadDatabase backfill / temp-sweep changes — leave them exactly as they are.
- `selectPrunableIds` and the mount-loss/prune path are untouched (the drop is orthogonal — a
  concurrently-deleted id was surviving at snapshot time so it's not in `prunable`; the drop closes
  exactly prune's blind spot).

## Tests (integration; mirror the scan-clobber/scan-api harness; no FFmpeg)

1. **HEADLINE** — a `DELETE /api/videos/:id` committing DURING a scan (after Phase-1 builds
   `newMetadata`, before Phase-2 commits) leaves the id DELETED (not resurrected) after the scan
   save. Must FAIL against pre-fix code (id resurrected) and PASS after.
2. A mount-loss-retained entry (missing/unmounted root) is NOT wrongly dropped by the new loop
   (false-positive guard — it's still in `fresh`, so KEEP).
3. A genuinely-new scanned file (absent from the Phase-1 snapshot) is STILL added.
4. The non-concurrent case (no delete during the scan) is unchanged — normal scan behavior holds.

## Hard constraints

- `test/unit/transcode-cache.test.js` stays FROZEN / byte-identical; `database.test.js`
  `mergeScannedMetadata`/reconcile cases stay green unmodified.
- Full suite green (**212 existing + your new tests**); every timer `unref()`'d (clean exit).
- `npm run lint` 0 errors (no new warnings beyond the 11-warning baseline).
- Scoped OUT: T3 (mobile logo) and any re-touch of HR1a.
- Before any npm/node command: `export PATH="/home/coder/.local/share/fnm/node-versions/v24.14.0/installation/bin:$PATH"`.
- Run `npm run lint` and `npm test` and fix any failures before reporting done. Report the files
  changed and tests added.

When done, tell the coordinator HR1b is complete so the EM can route to the build-specialist
(`/prep-build-verify`). After HR1b build-verifies, the coordinator runs a focused re-review of the
combined HR1 hunks, then T3 (logo), then the PR.
