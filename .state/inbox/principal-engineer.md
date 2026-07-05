# Principal Engineer — Remediation Design (review round 1): Settings: Automation & Cache Housekeeping

You are the principal-engineer agent for FileTube. The feature is fully implemented
(T1-T8, 168 tests green) but the **two-reviewer QA gate returned CHANGES REQUESTED** —
both reviewers independently confirmed a whole-db clobber race. Produce a **scoped
remediation design** for the confirmed findings before the SDE implements. This is a
targeted design pass, NOT a re-design of the feature. Do NOT write application code.

## Read first
- `.state/feature-state.json` → `review_round_1` — the full consolidated triage (verdict,
  MUST-FIX A/B/C, SHOULD-FIX D/E, cleanup, non-blocking, re-review plan). This is the
  authoritative finding list.
- `docs/exec-plans/active/2026-07-05-settings-automation-cache.md` — the exec plan (your
  original `## Design` + the AC accounting). **Write your remediation into a NEW
  `## Remediation design (review round 1)` section** near the end; don't rewrite the
  original design/AC above it.
- `docs/CONTRIBUTING.md` / `docs/RELIABILITY.md` — standards; the "never let one bad
  file/dir take down a scan — reconcile per-item and continue" invariant is directly
  relevant to Root Cause B.
- `server.js` — the exact CURRENT seams (verified line numbers):
  - `recordServed(id)` at **378** (full-DB read on the hot path — finding E).
  - `scanDirectories()` overlap guard `if (scanState.scanning) return;` at **611-612**.
  - `runScanDirectories`: the `db.metadata = newMetadata; saveDatabase(db)` clobber at
    **742** (Root Cause A), the mount-loss comment at **692**.
  - `scanDirRecursive` at **770**, its swallowed read error at **775** (Root Cause B-ii).
  - `POST /api/config` background `scanDirectories().catch(...)` at **865** (Root Cause C).
  - `armScanTimer()` at **756**; the unconditional re-arm + wrong "safe no-op" comment at
    **960-963** (finding D).
  - `SCAN_INTERVAL_MINUTE_OPTIONS` at **197** vs `SCAN_INTERVAL_VALID_VALUES` at **903**
    (cleanup 2).
  - The triplicated "actively-served protected paths" set: `evictTranscodeCache` ~181-184,
    `sweepAgedTranscodes` ~269-272, `/api/cache/clear` ~988-991 (cleanup 1).
  - `selectPrunableIds` (exported, unit-tested in `test/unit/settings-helpers.test.js`).

## What to design (resolve each; confirm or refine the reviewers' fix direction)

### Root Cause A — whole-db clobber race (MUST-FIX; the headline, independently confirmed)
`runScanDirectories` holds a stale whole-db snapshot across many `await`ed
`extractMetadataAndThumbnail` calls, then overwrites the entire object at save. Concurrent
`POST /api/settings` writes and `recordServed` `lastServedAt` writes made during a scan are
reverted — the latter can cause a genuinely-watched transcode to be wrongly aged-out.
Design the fix: before the final save, **re-read the fresh db from disk and write back only
scan-owned data** (metadata) while preserving concurrently-written `db.settings`,
`db.folders`, `db.folderSettings`, `db.progress`, AND any `lastServedAt` written to
surviving metadata entries during the scan. Specify exactly how the merge treats each
metadata entry (a scan-updated entry vs a concurrently-touched `lastServedAt` on a surviving
entry) so no field is lost in either direction. Note the interaction with finding E (below)
— your A and E designs must be coherent about where `lastServedAt` is the source of truth.
Specify the regression test: interleave a settings write / `recordServed` with an in-flight
scan and assert neither is lost.

### Root Cause B — mount-loss guard too shallow (MUST-FIX; a data-loss gap in the guard we shipped)
The guard only checks TOP-LEVEL roots. Design a fix that makes **"could not enumerate this
directory/subtree" a first-class signal**, so entries under ANY un-enumerable path are
RETAINED regardless of depth:
- (i) Nested/child mount dropping under a present root: the top root exists, so the current
  guard doesn't fire and `pruneMissing` prunes the vanished subtree. 
- (ii) `scanDirRecursive` swallows a subdir read error (EACCES/EIO) at 775 and returns, so a
  transiently-unreadable subtree looks like mass deletion.
- (iii) `selectPrunableIds`' guard is skipped when `entry.rootFolder` is falsy (legacy
  pre-backfill entries).
Design direction to confirm/refine: propagate an "unreadable/incomplete" path set out of
`scanDirRecursive` (a dir that errored, or a configured subpath that vanished mid-scan), and
feed it into the prune decision so any entry whose `filePath` is under an un-enumerable path
is retained — not just top-level missing roots. Decide whether this **extends
`selectPrunableIds`' signature** (e.g. add an `incompletePaths`/`unreadablePaths` param) —
that's acceptable now (we're fixing a real correctness gap); if you change its contract,
say so and require its unit tests be updated. Handle falsy-`rootFolder` conservatively
(derive via `matchRootFolder`, or default to retain). Specify regression tests for: a
nested-mount drop, a subdirectory read error, and a `rootFolder`-less legacy entry under a
missing root.

### Root Cause C — overlap guard drops the /api/config background rescan (MUST-FIX)
`if (scanState.scanning) return;` silently no-ops the fire-and-forget rescan that `POST
/api/config` triggers when folders change — so newly-added folders are never indexed (and
with interval Off, never recovered). Design a **"rescan requested" flag** (or small queue)
so a scan requested while one is running runs once after the current finishes. Make sure a
manual `/api/scan` and the timer path benefit too, without allowing unbounded stacking (one
pending follow-up is enough). Confirm this doesn't reintroduce the overlap the guard was
added to prevent.

### Finding D — timer re-arm resets the countdown (SHOULD-FIX)
`POST /api/settings` calls `armScanTimer()` unconditionally; clear+recreate resets the
periodic countdown, so frequent saves defer the scan indefinitely. Design: re-arm ONLY when
`scanIntervalMinutes` actually changed (compare old vs new before saving), and correct the
false "safe no-op" comment.

### Finding E — recordServed full-DB read on every Range request (SHOULD-FIX, hot path)
The ~10-min throttle skips the WRITE but still does a synchronous full-`db.json` READ on
every `/video` Range request. Design an **in-memory last-persisted-served map (id -> ts)**
(or reuse the in-memory `recentlyServed`) to short-circuit the throttle WITHOUT a disk read;
only `loadDatabase` when actually persisting. Ensure this stays coherent with the Root
Cause A merge (A must still persist `lastServedAt` correctly, and E must not lose a served
signal across a restart any worse than today). Note startup behavior (the in-memory map is
empty on boot — is that acceptable? it just means the first serve after boot persists).

### Cleanup (fold in since we're editing this code — PE decides scope)
- One shared **"actively-served protected paths"** helper replacing the triplication; the two
  new copies (`sweepAgedTranscodes`, `/api/cache/clear`) currently OMIT `evictTranscodeCache`'s
  stale-entry pruning — the shared helper should include it. **Decide explicitly:** can the
  helper be introduced WITHOUT changing `evictTranscodeCache`'s behavior (keeping the frozen
  `transcode-cache.test.js` green), or is it now acceptable to touch `evictTranscodeCache`
  (un-freeze it) given we're fixing correctness here? State the call and the test impact.
- One source for the scan-interval value lists (197 vs 903).
- `gbToBytes` (`public/js/common.js`): clamp sub-1-byte positives to `null` so a tiny GB input
  doesn't POST `cacheMaxBytes:0` and trip a misleading 400.
- The `.tmp.mp4` exclusion predicate copy-pasted ~4 sites → optionally one shared filter.

### Non-blocking (PE's call: fold in or tech-debt-track)
- `sweepAgedTranscodes` + `evictTranscodeCache` each do an independent readdir+statSync
  back-to-back at both call sites (double directory pass per produce). If you don't fold it
  into the shared-enumeration work, add it to `docs/exec-plans/tech-debt-tracker.md`.

## Also produce: a recommended fix-round task grouping
The coordinator will have the EM break your design into SDE fix task(s). Recommend the
grouping: the scan-lifecycle cluster (A + C + D, and possibly B) is cohesive and could be
ONE SDE task; E + the cleanup could be another; or split further if you see risk. State your
recommendation and the rationale (keep each task independently testable and build-verifiable).
Flag any ORDERING constraints (e.g. B's `selectPrunableIds` signature change should land with
its test update; A and E should land together since they share `lastServedAt` ownership).

## Deliverable
Write the `## Remediation design (review round 1)` section into the exec plan: for each of
A/B/C/D/E + cleanup, give the concrete approach (function/seam, data shape, and the specific
regression test each needs), the frozen-helper/`selectPrunableIds`-contract decisions, and the
recommended task grouping + ordering. Update `docs/ARCHITECTURE.md` only if a fix introduces a
genuinely new invariant worth recording (e.g. the re-read-merge-on-save rule). Then update
`.state/feature-state.json`: append a remediation-design-complete history entry (you may leave
`artifacts.design` as-is — it already points at this exec plan). Do NOT write code or the task
breakdown — the EM breaks your remediation design into fix task(s) next.
