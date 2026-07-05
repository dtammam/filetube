# Principal Engineer — SHORT design note: FR3.3 transcodeStatus merge rule

You are the principal-engineer agent for FileTube. This is a **narrow, single-issue design
note** — NOT a re-design. Review round 2 (focused re-review of remediation commit b0388d6)
found one subtle finding, FR3.3, that interacts with `reconcileTranscode`'s legitimate scan
updates and needs a designed rule before the SDE implements it. The other three round-2
findings (FR3.1/3.2/3.4) are mechanical and are already routed to the SDE — do NOT design
those. Do NOT write application code.

## Read first
- `.state/feature-state.json` → `review_round_2.FR3_3_transcodeStatus_clobber` (the finding).
- `docs/exec-plans/active/2026-07-05-settings-automation-cache.md` → your
  `## Remediation design (review round 1)` section (the A↔E `lastServedAt`-single-source-of-truth
  merge contract you already set — FR3.3 is the analogous question for `transcodeStatus`).
- `server.js` — the exact seams:
  - `mergeScannedMetadata(freshMetadata, newMetadata)` at **346-355** — currently rescues ONLY
    `lastServedAt` (max-merge on surviving entries).
  - `setTranscodeStatus(id, status)` at **~415-419** — the concurrent writer that sets
    `'processing'`/`'ready'`/`'failed'` during transcode jobs (no-clobber, writes db.json).
  - `reconcileTranscode(item)` at **581-599** — runs in `runScanDirectories`'s per-item loop
    (over `newMetadata`, BEFORE the merge/save): sets `'ready'` when a finished MP4 exists,
    clears a stale `'ready'` when the MP4 is gone, clears status when `!needsTranscode`.
  - `runScanDirectories`: surviving-entry reuse (`newMetadata[id] = db.metadata[id]`, the STALE
    scan-start snapshot), then the reconcile loop, then the re-read-merge save.
  - The re-queue trigger at **~1398** (`if (item.transcodeStatus !== 'failed')`) — an erased
    `'failed'` gets the item re-queued, causing the wasted re-transcode loop.

## The problem (precisely)
`runScanDirectories` reuses the STALE scan-start snapshot for a surviving entry, runs
`reconcileTranscode` on it, then merges into a FRESH re-read at save. `mergeScannedMetadata`
rescues `lastServedAt` from fresh but NOT `transcodeStatus` — so a `setTranscodeStatus('failed'`
or `'processing')` that a transcode job wrote to disk DURING the scan is reverted to the stale
snapshot value. Erasing `'failed'` re-queues the item every time a scan coincides (bounded,
self-heals, but wasteful). We must preserve the concurrently-written in-flight `transcodeStatus`
**without** clobbering the scan's LEGITIMATE `reconcileTranscode` decisions (a real `'ready'`
when an MP4 appeared; clearing a genuinely-stale `'ready'`).

## What to design (just this)
Specify the exact `transcodeStatus` reconcile rule for `mergeScannedMetadata` (or a small
restructure if you prefer — e.g. have the reconcile step read fresh), such that for a SURVIVING
entry:
- A concurrently-written in-flight status (`'processing'`/`'failed'`) on `fresh` is PRESERVED
  when the scan's own reconcile did not make a legitimate authoritative change (i.e. the scan's
  value is just the stale snapshot carried forward).
- The scan's reconcile still WINS when it legitimately set `'ready'` (a finished MP4 is present)
  or legitimately cleared a stale `'ready'`/`!needsTranscode` status.
Think through the concrete cases and state the decision for each: fresh=`failed`/`processing`
vs scan-reconcile=unchanged-stale / =`ready`(MP4 appeared) / =cleared(MP4 gone) / =cleared
(no longer needsTranscode). Give the rule as a short deterministic predicate the SDE can
implement, and confirm it composes with the existing `lastServedAt` max-merge (both fields
reconciled in the same pass). Note any residual/edge case you deliberately leave (bounded) so
it's documented, not guessed.

## Deliverable
Append a short subsection (e.g. `### FR3.3 — transcodeStatus merge rule`) to the exec plan's
`## Remediation design (review round 1)` section with: the rule, the per-case decisions, whether
it lives in `mergeScannedMetadata` or a reconcile restructure, and the required tests (a mid-scan
`'failed'` on a surviving entry survives the scan save and the item is NOT re-queued; a scan that
legitimately marks `'ready'` still wins; a stale `'ready'` is still cleared). Then update
`.state/feature-state.json` with a short history entry noting the FR3.3 note is done. Do NOT write
code or touch the mechanical FR3a fixes. The EM will route the FR3b SDE implementation against
your note after FR3a build-verifies.
