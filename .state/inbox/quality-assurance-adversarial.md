# Two-reviewer gate (Reviewer 2 of 2 — ADVERSARIAL) — v1.30 Scale Performance + Polish Wave

You are the **adversarial** reviewer, reviewer 2 of the mandatory two-reviewer
gate. Your job is to try to BREAK this wave — find the correctness hole, the
silently-weakened guard, the race, the regression the happy-path tests miss. Be
skeptical of "already held" / "conformance" claims and of tests that assert a
guard only in the easy direction. Report CRITICAL / WARNING / SUGGESTION with
`file:line`, and a verdict: **APPROVE / REQUEST CHANGES / NEEDS DISCUSSION**. You
do NOT fix — you attack and report.

> Activate only once T13's build-specialist PASS is confirmed (all 13 tasks
> through the build gate). If it isn't yet, stop and tell the user.

## Environment (for any CI-parity run)

```bash
export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"
node --version   # expect v22.23.1
```
Use Node 22.23.1 for CI parity. Self-reported: `npm test` 3593/3593, lint clean.
(The v1.29 gate precedent: the adversarial reviewer found a CRITICAL the QA
reviewer missed — a byte-identical templated stderr collapsing distinct failures
into phantom successes. Bring that energy.)

## Read first

Same as the QA inbox: `.state/feature-state.json` (all `sde_report`s,
`open_gate_decision` GD-1, `tasks[].T9.gate_reviewer_notes`,
`two_reviewer_gate_plan`), the exec plan (FR1–FR8, AC1.1–AC8.5, Design,
Constraints), and `docs/{CONTRIBUTING,RELIABILITY,ARCHITECTURE}.md`. Review the
full `git diff main`.

## Attack surfaces — go hard here

- **T4 cache coherency (the highest-risk claim):** try to construct a torn/stale
  read. Is there ANY code path that reads `getCachedDatabase()`, mutates the
  returned object in place, and thereby corrupts the cache for the next reader?
  Any write that does NOT go through `updateDatabase` (a direct
  `loadDatabase→mutate→saveDatabase`, or a `saveDatabase` call that forgets to
  refresh the cache)? Any `await` between a save and its cache-set that opens a
  window? Confirm the two in-place-mutation fixes (`healStaleAudioReady`,
  `/api/videos/:id` avatar `structuredClone`) actually close the hole and aren't
  the only two.
- **T5 progress carve-out:** can anything OTHER than watch position enter the
  batched/relaxed path? Can a flush race a real mutation and drop or overwrite it?
  On the shutdown flush, can a `SIGKILL` mid-rename tear the file? Is the ≤5s bound
  actually bounded, or can a jammed timer extend it? Are the AC4.2 1:1 assertions
  real (mutation-test them mentally: would they fail if a route were batched)?
- **T2 cooperative scan:** does making the walk async open a TOCTOU between the
  `unreadable` set and prune? Can a mount that drops mid-scan get its items pruned?
  Does the overlap guard actually prevent two concurrent `runScanDirectories`, or
  can the non-blocking 202 path start a second one? Does the metadata-merge-loop
  yield (the SDE's extra catch) preserve atomicity of the final merge?
- **T8 one-shot visibility:** can the done-edge STILL be silently dropped in any
  ordering (e.g. refresh returns true but the render didn't actually include the
  item; or `markHomeGridDirty` set but `restoreHomeFromCache` reattaches the stale
  node anyway)? Can the visibility/pageshow catch-up double-fire a refresh or
  re-consume a job? Is the `location.reload` spy truly across ALL paths (incl.
  error branches)? Did the `loadFreshHomeView` change leak listeners or break
  the BUG-2 contract in a way the happy-path test misses?
- **T6/T7 pagination:** does the full-list caller path (`limit=1000000` clamped to
  `MAX_LIMIT=10000`) SILENTLY truncate related/prev-next/autoplay above 10000? Is
  that acceptable or a latent correctness bug to flag? Does the seeded `random`
  actually stay stable across pages, or can a re-roll desync? Does the sentinel
  double-fetch a page under fast scroll?

## AC8.4 — prove EXERCISED, not present

For each both-directions guard AC (AC1.4/1.5, AC1.6/1.7, AC2.5, AC4.2/4.3, AC5.2):
open the test and mentally (or actually) mutate the guard away — would the test
fail? If a converse-direction assertion is missing or toothless, that's a finding.

## GD-1 + T9 deviations + Dean-on-device

- **GD-1:** take a position — is hash-letter (loses the 'Alice'→'Q' mnemonic)
  actually worse for Dean's "recognizable avatar" intent than first-letter +
  deterministic color? Recommend keep or revert (one-line).
- **T9:** verify the 127→12 token mapping is genuinely no-visual-change (spot-check
  a few of the 127 replacements against their token values) and the true input
  floor wasn't misidentified.
- Confirm **AC7.6 / GD-1 / AC4.5** are recorded as Dean-on-device veto items, NOT
  fake-passed.

## Standards / security

Untrusted creator text stays textContent/createElement (C5 subs avatar, C2 like
button) — hunt for any innerHTML interpolation of a channel name/title. Confirm
SQLite stayed deferred (tech-debt #28, no native dep). No service worker. Node
22 AND 24 green (AC8.1/8.2).

## Deliverable from you

Findings (CRITICAL/WARNING/SUGGESTION with `file:line`), your GD-1 position,
explicit AC8.4 exercised-not-present findings per guard, and a verdict:
**APPROVE / REQUEST CHANGES / NEEDS DISCUSSION**. If you and the QA reviewer
diverge, say so. Do not edit code.

When done, return to the EM session and report your verdict.
