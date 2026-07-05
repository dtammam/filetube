# Software Developer — Task 2: deferred-rescan tail (tech-debt #3)

You are the Software Developer. Implement **Task 2 ONLY** — the deferred-rescan
tail fold-in. This is part of the HARDENING commit (with Task 1), NOT the mobile
logo (Task 3). You have no shared context with the EM — everything you need is
below or in the referenced files. Do NOT touch Task 3 (logo CSS).

## Context

Task 1 (the serialized `updateDatabase` + atomic `saveDatabase` + 7-writer
conversion + scan collapse) is DONE and build-verified (lint 0, npm test 201/201).
Task 2 closes the v1.8.0 **FR3.4** edge: the coalesced rescan drain in
`scanDirectories` is bounded (`MAX_RESCAN_FOLLOWUPS = 1`) so it can't livelock, but
when the drain budget is exhausted with `scanState.rescanRequested` still `true`,
that pending rescan is currently DROPPED. Symptom: with auto-scan Off, a folder-add
landing during the single follow-up pass isn't indexed until a manual "Scan now".
No data loss (the folder is persisted), but the media doesn't appear until a rescan.
This is tech-debt tracker **Active #3**.

## Read first

- `docs/exec-plans/active/2026-07-05-harden-db-writes-and-logo.md` — the `## Design`
  section's "Fold-in #3 (MANDATORY): deferred-rescan tail" gives the exact snippet and
  rationale. It is authoritative.
- `.state/feature-state.json` — the T2 task entry (`tasks[1]`) for `done_when`.
- `docs/exec-plans/tech-debt-tracker.md` — Active #3 (move to Closed) and Active #2
  (leave OPEN — deferred per the design; do NOT touch the double-readdir code).
- `docs/CONTRIBUTING.md` (node:test; every change ships tests) / `docs/RELIABILITY.md`.

## Current seams (verified line numbers)

- `scanState = { scanning, lastScan, rescanRequested }` — server.js:777.
- `MAX_RESCAN_FOLLOWUPS = 1` — server.js:789.
- `scanDirectories()` — server.js:804. The bounded drain is the do/while at 812-816;
  the `finally` clears `scanState.scanning` and sets `lastScan` at 817-820. The drain
  exits with `scanState.rescanRequested` possibly STILL `true` (budget spent) — that is
  the drop this task fixes.

## What to build (per the design — do not deviate)

Add, at module level near `scanDirectories`:

```js
let deferredRescanTimer = null;
const DEFERRED_RESCAN_DELAY_MS = 5000;
function scheduleDeferredRescan() {
  if (deferredRescanTimer) return;        // never stack/chain more than one
  deferredRescanTimer = setTimeout(() => {
    deferredRescanTimer = null;
    scanDirectories().catch(console.error);
  }, DEFERRED_RESCAN_DELAY_MS);
  deferredRescanTimer.unref();            // never keep the process/test alive
}
```

Hook it into `scanDirectories`'s `finally`: **read `scanState.rescanRequested` BEFORE
clearing `scanning`**, and call `scheduleDeferredRescan()` when it is still set. For
example, capture `const stillPending = scanState.rescanRequested;` at the top of the
`finally`, then after setting `scanState.scanning = false` / `lastScan`, do
`if (stillPending) scheduleDeferredRescan();`. (The deferred pass runs later, after
`scanning` is already false, so it re-enters cleanly.)

Add a `currentDeferredRescanTimer()` test accessor (returns `deferredRescanTimer`) and
export it via `module.exports` alongside the existing scan exports.

Why this is safe/bounded (keep these properties):

- **No livelock:** the drain itself stays bounded per invocation (`MAX_RESCAN_FOLLOWUPS`
  unchanged); the deferred timer just re-enters that bounded scan after a 5 s gap. Under
  sustained demand it self-heals in discrete 5 s-spaced passes, not a tight loop.
- **At most one pending:** the `if (deferredRescanTimer) return;` guard prevents stacking.
- **Never keeps the process alive:** `.unref()`, so `node:test` exits cleanly.
- **No dangling timer:** the callback nulls its own handle; tests must clear it in teardown.

Do NOT change `MAX_RESCAN_FOLLOWUPS`, the drain loop condition, or the overlap guard
(`if (scanState.scanning) { scanState.rescanRequested = true; return; }`).

## tech-debt-tracker update

In `docs/exec-plans/tech-debt-tracker.md`: move **Active #3** to the **Closed** table with
a resolution noting the deferred `unref()`'d single-guarded 5 s rescan tail. Leave **Active #2**
(double `readdir` over `TRANSCODE_DIR`) OPEN — it is explicitly deferred by the design; do not
touch `sweepAgedTranscodes`/`evictTranscodeCache`.

## Test (per the design's Tests #5)

Add an integration test (in `test/integration/scan-api.test.js`, mirroring the existing scan
harness — no FFmpeg): with `scanIntervalMinutes` Off, drive `scanDirectories` so the drain
exits with `scanState.rescanRequested` still `true` (budget spent). Assert:

- exactly ONE `unref()`'d timer is scheduled — `currentDeferredRescanTimer()` is non-null, and
  a SECOND exhaustion while one is pending does NOT stack a second timer;
- running/firing the deferred pass indexes the pending folder's work;
- no dangling timer / clean exit — clear the timer in teardown.

## Hard constraints

- Full suite stays green (**201 existing + your new test**); `test/unit/transcode-cache.test.js`
  stays FROZEN / byte-identical.
- Every timer `unref()`'d; no dangling timer under `node:test` (clean exit, no hang).
- `npm run lint` 0 errors (no new warnings beyond the 11-warning baseline).
- Scoped OUT of Task 2: the mobile logo CSS (Task 3) and fold-in #2 (double readdir, deferred).
- Before any npm/node command: `export PATH="/home/coder/.local/share/fnm/node-versions/v24.14.0/installation/bin:$PATH"`.
- Run `npm run lint` and `npm test` and fix any failures before reporting done. Report the files
  changed and tests added.

When done, tell the coordinator Task 2 is complete so the EM can route to the build-specialist
(`/prep-build-verify`). After T2 build-verifies, the two-reviewer QA gate runs on the combined
T1+T2 hardening, then Task 3 (logo).
