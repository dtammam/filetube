# Software Developer — Fix Round 3b (FR3b): FR3.3 transcodeStatus clobber (PE option b)

You are the software-developer agent for FileTube. Implement **FR3b only** — the single
FR3.3 fix below, exactly as the principal-engineer designed it — then stop and report.
FR3a (the three mechanical fixes) is merged and build-verified (suite at 190); build on it.
This is the LAST remediation task before the final focused re-review. You have no shared
context with the EM.

## Read first
- `docs/exec-plans/active/2026-07-05-settings-automation-cache.md` → the
  `## Remediation design (review round 1)` section, subsection **`### FR3.3 — transcodeStatus
  merge rule`** — the PE's authoritative design (option b). Follow it exactly.
- `.state/feature-state.json` → `review_round_2.FR3_3_transcodeStatus_clobber` and the `FR3b` task.
- `server.js` — the exact seam (the `runScanDirectories` tail, current line numbers):
  - the reconcile loop at **863-868**:
    ```
    for (const item of Object.values(newMetadata)) {
      const newRoot = matchRootFolder(item.filePath, currentFolders);
      if (item.rootFolder !== newRoot) { item.rootFolder = newRoot; dbChanged = true; }
      if (reconcileTranscode(item)) dbChanged = true;
    }
    ```
  - the save block at **870-890**, where `const fresh = loadDatabase()` currently sits at
    **878** (inside `if (dbChanged)`), followed by `mergeScannedMetadata` (879), the prune loop
    (880-887), and `saveDatabase(fresh)` (888).
  - `reconcileTranscode(item)` body at **583-599** (DO NOT change it), `setTranscodeStatus` at
    **~415-419**, `mergeScannedMetadata` at **346-355** (DO NOT change it), the re-queue trigger
    at **~1398** (`if (item.transcodeStatus !== 'failed')`).

## The problem (why this matters)
`runScanDirectories` reuses the STALE scan-start snapshot for a surviving entry and runs
`reconcileTranscode` on it; a `setTranscodeStatus('processing'/'failed')` a transcode worker
wrote to disk DURING the scan is then reverted at save. Erasing `'failed'` re-queues the item
(the `!== 'failed'` trigger) → a wasted re-transcode loop whenever a scan coincides.

## The fix — PE option (b), implement EXACTLY as designed
Seed `reconcileTranscode` from the FRESH on-disk `transcodeStatus` instead of the stale
snapshot, so reconcile's "leave in-flight alone" branch preserves a worker's concurrent
`processing`/`failed`, while reconcile still legitimately WINS with `'ready'` (finished MP4 on
disk) and still CLEARS a stale `'ready'`. **Both `mergeScannedMetadata` and `reconcileTranscode`
bodies stay UNCHANGED** — the only edit is in the `runScanDirectories` tail:

1. **Move `const fresh = loadDatabase()` UP** — out of the `if (dbChanged)` save block (878) to
   **just before the reconcile loop** (before 863-864). This is safe because the reconcile-loop →
   save tail has **NO `await`** — one fresh read here is identical to a save-time read.
2. **Seed each item's status from `fresh` before reconciling.** Inside the reconcile loop, BEFORE
   the `reconcileTranscode(item)` call, add:
   ```js
   const priorStatus = fresh.metadata[item.id] && fresh.metadata[item.id].transcodeStatus;
   if (priorStatus === undefined) delete item.transcodeStatus;
   else item.transcodeStatus = priorStatus;
   ```
   (This overwrites the stale snapshot's `transcodeStatus` with the current on-disk value, so
   `reconcileTranscode`'s "in-flight → leave alone" branch sees the worker's concurrent write and
   preserves it, while its MP4-present → `'ready'` and stale-`'ready'` → clear branches still
   apply correctly.)
3. **The save block reuses the moved `fresh`** — do NOT call `loadDatabase()` a second time in
   the save block; use the `fresh` read in step 1. Keep `mergeScannedMetadata(fresh.metadata,
   newMetadata)`, the prune loop (incl. FR3.2's `clearPersistedServedAt`), and `saveDatabase(fresh)`
   exactly as they are otherwise.

Accepted minor cost (PE-approved): one `loadDatabase()` now runs on every scan (including no-op
scans) instead of only when `dbChanged`. That's fine.

## Regression tests (integration, mirror the existing scan-clobber harness in scan-api.test.js)
1. **[INTEGRATION] HEADLINE:** a mid-scan `setTranscodeStatus(id, 'failed')` on a surviving entry
   SURVIVES the scan's final save, AND `GET /video/:id` returns the failed status **without
   re-enqueuing** the item. This MUST fail under the current code (proves it's a real guard).
2. **[INTEGRATION]** A legitimate `'ready'` (a finished MP4 present on disk) still WINS over a
   stale `'processing'`/absent snapshot after the scan.
3. **[INTEGRATION]** A stale `'ready'` with NO cached MP4 is still CLEARED by the scan.
4. **[INTEGRATION]** Conflict edge — MP4 present AND a concurrent `'failed'` write → `'ready'`
   wins (a real finished file beats an in-flight-failed signal).

## Out of scope / constraints
- **`mergeScannedMetadata` and `reconcileTranscode` bodies stay UNCHANGED** — only the seed +
  the moved `fresh` read in the `runScanDirectories` tail.
- **`test/unit/transcode-cache.test.js` stays UNMODIFIED**, and **`test/unit/database.test.js`'s
  `reconcileTranscode` cases stay green and UNMODIFIED** (you didn't change `reconcileTranscode`,
  so they must still pass as-is — proof the body is untouched).
- Do NOT touch the FR3a fixes (per-file-stat `unreadable.add`, persistedServedAt prune-delete,
  bounded drain) — leave intact.
- Everything additive/zero-regression except the intended FR3.3 change.
- **PATH export before `npm`**; `npm run lint` 0 errors; run `npm run test:unit` during dev and
  `npm test` (full, 190+ now) before reporting; fix any failure you introduce.

## When done
Report a concise summary: the moved `fresh = loadDatabase()`, the per-item status seed before
`reconcileTranscode`, confirmation the save block reuses `fresh` (no double read) and that
`mergeScannedMetadata`/`reconcileTranscode` bodies are byte-unchanged; the 4 new integration
tests; and the `npm run lint` + `npm test` results. This is the last remediation task — after
the EM routes the build-specialist to verify FR3b, the coordinator does the FINAL focused
re-review of the FR3 hunks, then acceptance → PR/v1.8.0. Do not edit `.state/feature-state.json`
(EM owns task status).
