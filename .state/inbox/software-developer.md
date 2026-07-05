# Software Developer — HR2: restore recordServed's up-front throttle without re-leaking

You are the Software Developer. Implement **HR2 ONLY** — a small, surgical fix to
`recordServed` that restores the streaming-hot-path write-throttle while KEEPING
finding-C's no-leak fix. This is the LAST hardening fix before the review cycle stops.
You have no shared context with the EM — everything you need is below. Do NOT touch
T3 (mobile logo) or any other function.

## Context

The HR1a finding-C fix moved `persistedServedAt.set(id, now)` from BEFORE the
`updateDatabase` enqueue to INSIDE the mutator (to stop leaking a throttle-map entry for
a concurrently-deleted id). That fixed the leak but reintroduced a HOT-PATH regression the
focused re-review caught:

While `dbWriteChain` is backlogged (e.g. during a scan), `persistedServedAt.get(id)` stays
`undefined`, so a burst of same-id `/video` Range requests EACH pass the hot-path
short-circuit and enqueue their OWN `updateDatabase` — each doing a full synchronous
`loadDatabase()` inside the lock. This is the redundant-read amplification the v1.8.0
`persistedServedAt` map was built to prevent. Bounded (drains turn-by-turn; only the first
commit actually writes) but it's on the streaming hot path and reachable whenever a
scan/backlog overlaps streaming.

## Current code (server.js:582-601)

```js
function recordServed(id) {
  const now = Date.now();
  const last = persistedServedAt.get(id);
  if (last !== undefined && (now - last) < RECENT_STREAM_MS) return undefined; // hot path: no disk read, no lock
  return updateDatabase(db => {
    const entry = db.metadata[id];
    if (!entry) return false; // concurrently deleted/pruned -- never mark the throttle map
    if (typeof entry.lastServedAt === 'number' && (now - entry.lastServedAt) < RECENT_STREAM_MS) {
      persistedServedAt.set(id, now);
      return false;
    }
    entry.lastServedAt = now;
    persistedServedAt.set(id, now);
    return true;
  }).catch(err => console.error('Error persisting lastServedAt:', err));
}
```

## The fix (satisfy BOTH the throttle AND finding-C's no-leak)

1. **Restore the up-front optimistic set BEFORE the enqueue** — right after the hot-path
   short-circuit (line 585, `if (last !== undefined ...) return undefined;`), add
   `persistedServedAt.set(id, now);` before the `return updateDatabase(...)`. This restores
   burst de-dup: requests 2..N for the same id within the window now short-circuit on the
   hot path instead of each enqueuing a `loadDatabase`.
2. **Undo the optimistic set in the mutator's no-entry branch** — in the
   `if (!entry) return false;` branch (line 588), add `persistedServedAt.delete(id);` before
   `return false`, so a concurrently-deleted/pruned id leaves NO leaked throttle entry
   (preserves finding-C exactly).
3. Keep the hot-path short-circuit (585) and the already-fresh mutator branch (593-596) as
   they are. The two in-branch `persistedServedAt.set(id, now)` calls at 594/598 become
   redundant with the up-front set but are harmless — you may leave them or remove them; the
   correctness contract is: optimistic set up front, delete on no-entry.

## DO NOT TOUCH

- `updateDatabase`'s body and `mergeScannedMetadata`'s body stay unchanged.
- HR1a's route try/catch / loadDatabase backfill / temp sweep — untouched.
- HR1b's Phase-2 drop loop — untouched.
- The `clearPersistedServedAt` prune helper — untouched.

## Tests

- **(a)** the existing finding-C no-leak test (`recordServed` for a NON-EXISTENT id leaves
  NO `persistedServedAt` entry after the call) must STILL pass — now the entry is set
  optimistically then deleted by the mutator's no-entry branch. Confirm it stays green.
- **(b)** NEW test — a burst of N same-id `recordServed` calls made WHILE a write is queued
  (`dbWriteChain` backlogged) enqueues only ONE `updateDatabase` (requests 2..N short-circuit
  on the hot path). This must FAIL against the current in-mutator-only ordering (where all N
  enqueue) and PASS after the up-front set. Assert on the number of `updateDatabase`/
  `loadDatabase` invocations (e.g. spy/count) or the number of enqueued writes. Put it where
  the recordServed/throttle behavior is already exercised (`test/integration/age-sweep.test.js`
  or a sibling); mirror the existing harness, no FFmpeg.

## Hard constraints

- `test/unit/transcode-cache.test.js` stays FROZEN / byte-identical.
- Full suite green (**216 existing + your new test**); every timer `unref()`'d (clean exit).
- `npm run lint` 0 errors (no new warnings beyond the 11-warning baseline).
- Scoped OUT: T3 (mobile logo) and any re-touch of HR1a/HR1b.
- Before any npm/node command: `export PATH="/home/coder/.local/share/fnm/node-versions/v24.14.0/installation/bin:$PATH"`.
- Run `npm run lint` and `npm test` and fix any failures before reporting done. Report the
  files changed and tests added.

When done, tell the coordinator HR2 is complete so the EM can route to the build-specialist
(`/prep-build-verify`). After HR2 build-verifies, the coordinator does a TARGETED re-review of
just the `recordServed` function; if clean, the review cycle STOPS and we move to T3 (logo) + PR.
