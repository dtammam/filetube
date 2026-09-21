---
plan: chaptered-queue-advance
harness: v2 · lean
branch: fix/chaptered-queue-advance
anchor: spec
status: Building
next: run the review gate (adversary + qa + security-brief) at the committed sha
gate: pending
---

# Chaptered video played from "Queued" never advances to the next item

Fixes tech-debt **#230** (Dean intake, /music desktop). Nav-only, no data seam.

## Problem / root cause

A chaptered video played as audio has `player.currentId = "<vid>::c<idx>"` (the
synthetic chapter-track id), while its `/api/queue` entry records the BASE media
id (`<vid>`). The server-queue advance guard compared the pointer entry's
`mediaId` against the RAW current id:

- `handleAutoplayNext`'s ended cascade — `player.js` (was `pointerEntry.mediaId === endedId`)
- `manualTrackStep`'s prev/next — `player.js` (was `pointerEntry.mediaId === steppedId`)

`"<vid>" === "<vid>::c<idx>"` is always false, so the advance to the next queued
item was silently skipped and playback fell back to in-video chapter nav, which
walks/loops WITHIN the same file — Dean's "looped back into the same album".

The progress-save path already solved the identical `::c`-vs-base split
(`saveProgressToServer` uses `currentData.baseMediaId`); the two queue-advance
guards never got the same treatment.

The scrub-vs-playthrough asymmetry in the original report is DISCHARGED as
not-a-second-mechanism: both ended paths are byte-identical in code (verified),
and the discriminating details were unsure — most likely a different manual
interaction or an `/api/queue` fetch race, not a distinct path.

## Fix

One pure, exported helper both guards route through (kills the duplicated
match rule too — no drift between the two siblings):

```
queuePointerMatchesPlaying(pointerEntry, playingId, baseMediaId)
  -> pointerEntry.mediaId === (baseMediaId || playingId)
```

Both live guards now call it with `currentData && currentData.baseMediaId`, so a
chaptered item matches on the base id and a non-chapter item matches on the raw
id exactly as before.

## Acceptance

- AC1: a chaptered `::c` current id matches its base-id `/api/queue` entry, so a
  chaptered video played from "Queued" advances to the NEXT queued item at end.
- AC2: a non-chapter item's match behavior is byte-unchanged (raw-id compare).
- AC3: a DIFFERENT queue entry never falsely matches; a null/malformed pointer
  never matches.
- AC4: BOTH guards (ended cascade + manualTrackStep) route through the one helper.
- AC5: dual-Node full suite green (v22.23.1 + v24.20.0).

## Verification (implementer, pre-gate)

- New test `test/unit/player-queue-chapter-advance.test.js` (7 cases): the pure
  helper + comment-stripped source-locks on both guards + a "the old raw-id
  compare is GONE" removal check. Mutation-verified: reverting the helper's
  `baseMediaId || playingId` to `playingId` reds AC1 (branch is bound, not vacuous).
- Rebound the two existing source-locks in `test/unit/queue-chrome-client.test.js`
  that pinned the old raw compare (they RED-caught the change; rebound to the
  base-id-aware guard, binding the fix rather than loosening).
- Full suite: **8861/8861, 0 fail** on Node v22.23.1 AND v24.20.0.

## Notes for the gate (attack surfaces)

- **Reachability (crown-jewel class):** confirm `currentData.baseMediaId` is
  actually populated at ended/step time for a Queued chaptered video (loadTrack
  sets it for `source: 'library-chapter'`; the save path already depends on it).
  A green helper test that never runs in production would be worthless.
- **Over-match:** confirm the base-id match cannot advance the queue for a
  DIFFERENT item than the one playing (base id must not collide across entries).
- **Non-chapter regression:** the raw-id path must stay byte-identical for the
  overwhelming-common non-chapter case.
- **Comment-porous source-lock class:** the new locks strip comments once before
  asserting; confirm they can't pass on a comment-shadowed writer.

## Gate

(seats write their verdicts here, bound to the reviewed sha)
