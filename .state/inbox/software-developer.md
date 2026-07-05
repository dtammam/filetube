# Software Developer — Fix Round 2 (FR2): hot-path E + cleanup 1-4

You are the software-developer agent for FileTube. Implement **FR2 only** — the final
fix-round task below — then stop and report. FR1 (the scan-lifecycle cluster A+B+C+D) is
merged and build-verified; build on it. This is the LAST implementation task before the
focused re-review. You have no shared context with the EM.

## Read first
- `docs/exec-plans/active/2026-07-05-settings-automation-cache.md` → the
  **`## Remediation design (review round 1)`** section — the settled approach for E +
  cleanup 1-4. Follow it precisely.
- `.state/feature-state.json` → `review_round_1` (findings E + cleanup) and the `FR2` task.
- `docs/CONTRIBUTING.md` — standards; tests ship with the change.
- `server.js` — current seams (locate by name; line numbers shifted after FR1):
  - `recordServed(id)` — the throttle that still does a full `loadDatabase` on the hot path.
  - `evictTranscodeCache` — builds an "actively-served protected paths" set from
    `recentlyServed`/`RECENT_STREAM_MS` AND prunes stale `recentlyServed` entries.
  - `sweepAgedTranscodes` and `POST /api/cache/clear` — each has a COPY of that protected-set
    build that OMITS the stale-entry pruning (the bug to fix via the shared helper).
  - the ~4 `.tmp.mp4` exclusion predicate sites; `SCAN_INTERVAL_MINUTE_OPTIONS` +
    `SCAN_INTERVAL_VALID_VALUES`.
- `public/js/common.js` — `gbToBytes` (+ its `typeof module` export guard);
  `test/unit/gb-bytes.test.js`.
- `test/unit/transcode-cache.test.js` — **MUST stay byte-identical** (the un-freeze proof).

## FR2 scope — one hot-path fix + four cleanups

### E — recordServed hot-path disk read (SHOULD-FIX, streaming hot path)
`recordServed` currently reads+parses the ENTIRE `db.json` on EVERY `/video` Range request;
the ~10-min throttle only skips the WRITE, not the READ. Fix:
- Add a **dedicated module-level `persistedServedAt` Map** (`id -> last-persisted timestamp`).
  On the hot path, short-circuit the throttle with a **Map lookup and NO `loadDatabase`**: if
  the map shows this id was persisted within `RECENT_STREAM_MS`, return immediately. Only when
  it's DUE (no entry, or older than the window) do you `loadDatabase` + set `lastServedAt` +
  `saveDatabase`, and then update the map.
- **Keep it a DEDICATED map — do NOT reuse `recentlyServed`** (that map has different
  semantics/lifecycle; conflating them is a bug risk).
- **Coherence with FR1's contract (critical):** on-disk `db.metadata[id].lastServedAt` remains
  the single source of truth; `recordServed` is still the only writer; the map is a
  **write-throttle only — never read as truth** and never fed into `mergeScannedMetadata`.
  Empty on boot ⇒ the first serve per item persists once (acceptable).
- **Headline test:** prove there's NO hot-path read — e.g. persist once, delete `db.json`, then
  do a within-window serve and assert `db.json` is NOT recreated/read (stays absent within the
  throttle window); an out-of-window serve persists once (recreates/writes it). Plus: a burst
  still yields ≤1 persisted write.

### Cleanup 1 — un-freeze evictTranscodeCache behind a shared helper
- Extract **`activeProtectedPaths(now)`** — a shared helper that reproduces
  `evictTranscodeCache`'s EXACT behavior: build the protected-paths set from `recentlyServed`
  within `RECENT_STREAM_MS` **AND prune the stale `recentlyServed` entries** (the side effect the
  two copies omit).
- Have **`evictTranscodeCache`, `sweepAgedTranscodes`, and `POST /api/cache/clear`** all call
  `activeProtectedPaths(now)` instead of their inline copies. This fixes the two buggy copies
  (they now also prune stale entries) and de-duplicates.
- **CRITICAL — `test/unit/transcode-cache.test.js` must stay UNMODIFIED and green.** That is the
  proof the `evictTranscodeCache` un-freeze is behavior-preserving. The PE verified the frozen
  evict test never populates `recentlyServed` nor asserts its pruning, so extracting the helper
  must not change any observable behavior of `evictTranscodeCache`. If you find yourself needing
  to edit that test file, STOP — your extraction changed behavior; rework it instead.

### Cleanup 2 — shared `.tmp.mp4` predicate
Add **`isCompletedTranscode(name)`** (a `*.mp4` that is NOT `*.tmp.mp4`) and use it at the ~4
sites that currently copy-paste that exclusion predicate. Keep the semantics identical at each
site.

### Cleanup 3 — one source for the scan-interval values
Derive **`SCAN_INTERVAL_VALID_VALUES`** from `SCAN_INTERVAL_MINUTE_OPTIONS`, e.g.
`new Set([0, ...SCAN_INTERVAL_MINUTE_OPTIONS])`, so the two lists can't drift.

### Cleanup 4 — gbToBytes sub-1-byte clamp
`gbToBytes` (`public/js/common.js`): a tiny positive GB input currently rounds to `0` bytes, and
setup.html then POSTs `cacheMaxBytes: 0`, which the server 400-rejects with a misleading message.
**Clamp sub-1-byte positive results to `null`** (= "use default") so the UI never POSTs 0. Update
`test/unit/gb-bytes.test.js` with a tiny-positive → null case (and confirm the existing cases
still pass).

## Out of scope for FR2 (do NOT touch)
- FR1's scan-lifecycle code (`mergeScannedMetadata`, `selectPrunableIds` contract, the
  `rescanRequested` drain, the timer re-arm) — done and verified; leave intact.
- Any product behavior beyond these fixes. Everything additive/zero-regression except the
  intended E + cleanup changes.

## Constraints / reminders
- **`test/unit/transcode-cache.test.js` stays UNMODIFIED** — the un-freeze proof. Verify with an
  empty diff on that file.
- **PATH export before `npm`** (project environment step) before `npm run lint` / `npm test`.
- `npm run lint` zero errors (baseline unused-export warnings allowed).
- Run `npm run test:unit` during development and `npm test` (full, 184+ now) before reporting;
  fix any failure you introduce.

## When done
Report a concise summary: the E `persistedServedAt` map + the no-hot-path-read proof test; the
`activeProtectedPaths` extraction and the three call sites now using it (with the two stale-prune
bugs fixed); the `isCompletedTranscode` predicate sites; the `SCAN_INTERVAL_VALID_VALUES` derive;
the `gbToBytes` clamp + test; confirmation that `transcode-cache.test.js` is byte-identical; and
the `npm run lint` + `npm test` results. This is the last implementation task — after the EM
routes the build-specialist to verify FR2, the coordinator runs a focused re-review on the FR1+FR2
hunks, then acceptance → PR/v1.8.0. Do not edit `.state/feature-state.json` (EM owns task status).
