---
plan: download-hang
harness: v2 · full
branch: fix/v1.392.0-download-hang
anchor: spec
status: Shipped v1.392.0
next: none - shipped; Dean owes the v1.392.0 lines in docs/DEVICE-CHECKS.md
design: Approved 2026-10-20 @0b3bbbe6
gate: APPROVED r3 @381d7001 (adversary + qa + security-brief)
builder: smart
---

# v1.392.0 - downloads never wedge until the container is recreated

Kickoff 2026-10-20 (Server/Web Root, Opus). **Builder: Smart (Opus).** One release, version **1.392.0**.

## Why

Dean, 2026-10-20: "consistent issues with downloads getting stuck and needing a FileTube repull. It seems untenable."
He clears it by **recreating the container** (asked at kickoff). Reported before on 2026-09-30 and 2026-10-09. v1.365.0
only added an instrument (the one-off download trace), and nobody ever read a trace from a stuck download. **This plan fixes
the defects the code shows, with no device trace.** Dean ruled "fix both now". So every fix must be proven against a
REPRODUCED hang in a test, and the next stuck download must explain itself in the logs (LESSONS: a diagnosis by inference
fails, so the instrument ships with the fix).

Outcome: a stuck yt-dlp job is cleared by the watchdog or by Cancel. The jobs queued behind it then run, and the
scheduled poll keeps running, all without a restart.

## Findings (read at @0b3bbbe6; the builder re-verifies each one at Step 0)

**F1 (the wedge; it explains "only a container recreate clears it").** `spawnYtdlpDownload` settles ONLY on
`child.on('close')` (`lib/ytdlp/run.js:1396`), on `'error'` (1388) and on stream errors (1301, 1339). The stall watchdog
(1142-1146, 10 min) and the absolute timeout (1357-1362, 180 min) only call `child.kill(SIGKILL)` on the yt-dlp pid. They
never kill its process group, and they never settle the promise. yt-dlp's helpers can outlive it: ffmpeg (merges,
HLS/DASH downloads, postprocessors) and node (the challenge solver). A helper that keeps the inherited stdout/stderr pipe
open means `'close'` never fires. The code's own comments name that gap (run.js:1009-1011, oneshotTrace.js:3-7). After
that:
- `runDownload` never returns.
- The heavy queue (`lib/heavyGate.js`, one promise chain with no per-job time limit) blocks every later job: channels,
  one-offs, reheat, probes and podcasts.
- `pollBusy` stays true, so every scheduled tick and every re-pull is coalesced as "busy" (index.js:3933-3946).
- Cancel does the same single kill.
- The stuck sweep skips the job because it is still listed in `activeOneShotChildren` (index.js:638).

The list path `spawnYtdlp` (run.js:692-879) has the same settle-only-on-close shape (839).

The image has no init process (Dockerfile `CMD [ "npm", "start" ]`, so npm runs as PID 1). Orphans are never reaped, and
a SIGTERM never reaches node.

**F2 (a missed poll after every restart).** `startBackground` (index.js:8335-8377) only arms a `setInterval` of
`pollMinutes` (default 60 min). It never polls at boot and never persists when the last poll ran. Every container restart,
which means every release under `pull_policy: always`, pushes the next poll out a full interval. Releases less than an
hour apart mean no poll ever runs. The engine timer already solved this with a persisted `lastCheckAt`
(index.js:5922-5958). The poll needs the same.

**Noted, NOT in scope (ROADMAP Planned, filed in W4):**
- (a) A `partial` run moves the cutoff to today, so a video that failed in it is never listed again (index.js:3731,
  rules.js:263).
- (b) `waitForOneShotTerminal` (index.js:4396) polls with no time limit.
- (c) A subscription download has no trace hook.

## Rulings (settled at kickoff - do not reopen)

| # | Question | Ruling |
|---|----------|--------|
| R1 | How a job settles | Both spawners (`spawnYtdlp`, `spawnYtdlpDownload`) settle on the **child's `'exit'` plus a short grace period** (default 5 s, a named constant) if `'close'` has not come by then. The late pipes are destroyed, and trailing decoder bytes are flushed as the close path does today. A kill (stall, timeout, cancel) also schedules a settle at kill time plus the grace period, even if `'exit'` never comes. The result must carry the same shape and the same `stalled`/`timedOut`/cancel flags as today, so callers are unchanged. Settling twice is impossible (the existing `settled` latch). |
| R2 | Killing helpers | Spawn yt-dlp with `detached: true` (its own process group) and kill with `process.kill(-pid, sig)`. Fall back to `child.kill` if the group kill throws (ESRCH). This applies to every kill path: stall, timeout, cancel (both routes, index.js:7139+) and the list timeout. After the yt-dlp process exits, kill its group anyway, so a helper left behind never outlives the job. `detached` must not stop the server's own shutdown from killing children; check what `server.js` does on SIGTERM. Never `child.unref()`. |
| R3 | Init process | Use **tini in the image** (`apk add tini`, `ENTRYPOINT ["/sbin/tini", "--"]`, `CMD ["node", "server.js"]`). That way every self-hoster gets reaping and signal forwarding without editing compose. Do not use the compose `init: true`, because it would double up with tini. State the image change in the release notes. The image smoke test (RELEASING) must still pass. |
| R4 | Queue backstop | No per-job time limit on `heavyGate`. With R1, every job settles. A gate-level timeout would run a second job beside a still-running one. Add a test proving that a job whose child never closes its pipes releases the gate. |
| R5 | Boot poll (F2) | Persist `lastPollAt` (the timer's ledger, next to the engine's, in the same store and the same atomic write). At boot, if `pollMinutes > 0` and `lastPollAt` is missing or older than `pollMinutes`, run ONE catch-up poll after a short delay (default 2 min after boot, a named constant, so the server and the requeued one-offs come up first). It goes through the normal `runPoll` (pollBusy, the breaker, backoff all still apply). Then keep the interval. `pollMinutes = 0` stays manual-only. Read-only media mode stays a no-op. A first boot with no ledger counts as due. |
| R6 | The hang explains itself | When a settle comes from the exit-plus-grace or kill-plus-grace path (not from `'close'`), log ONE line to the container log and the one-off trace: the pid, why it settled, ms since exit, and whether the group kill found survivors (ESRCH or not). A runlog row for the run marks `settledBy: 'exit-grace' or 'kill-grace'`. If the hang comes back, the next trace says which path it took. |
| R7 | Tests | Each fix is proven against a REPRODUCED hang, red on main @0b3bbbe6 and green on the branch, through the real `child_process.spawn`: a fake `yt-dlp` script that forks a grandchild holding stdout open (`sleep 600 &` with inherited stdio), then exits or hangs. Cases: exit with a lingering grandchild; a stall kill with a grandchild; cancel with a grandchild; the list path's timeout. Each asserts that the promise settles within grace + slack, that the grandchild is DEAD afterwards (`process.kill(pid, 0)` throws ESRCH), and that the next queued job runs. Mutate R1's grace settle and R2's group kill: each must turn a test red. The boot poll: a due ledger polls once, a fresh ledger does not poll, `pollMinutes 0` never polls, and the ledger survives a reload. Clean up the fake processes in `after` (LESSONS: straggler processes). |
| R8 | Gate | Full gate: adversary + qa + security-brief. It is a process-lifecycle change in the server, and it touches the Dockerfile and the image's entrypoint. Brief the Adversary to make a job hang in a way R1 and R2 do not cover. |

## Step 0 (builder, before W1)

- Cut `fix/v1.392.0-download-hang` from main @0b3bbbe6. Read docs/LESSONS.md, the sections on child processes, flakes and
  reachability.
- Write the R7 grandchild repro and **watch it hang on main** (a test with a timeout, red). If it does NOT hang on main,
  F1 is wrong: STOP and tell the Root before building anything.
- Re-verify F2 on main (a boot with a stale ledger arms the interval only).

## Waves

1. **W1 - settle and kill (F1, R1, R2, R6).** run.js, both spawners and every kill site, including the cancel routes.
   Tests per R7.
2. **W2 - the image (R3).** Dockerfile tini plus CMD. Docs: CONFIGURATION or the README, wherever the image's run
   command is described.
3. **W3 - boot catch-up poll (F2, R5).** index.js plus the store ledger. Tests per R7.
4. **W4 - close-out.**
   - ROADMAP: the stuck-download bug moves to Shipped. File the three out-of-scope items as Planned.
   - LESSONS: "a child's `'close'` waits for every holder of its pipes; settle on exit, kill the group".
   - DEVICE-CHECKS: next time a download looks stuck, wait for the stall watchdog (10 min) or press Cancel. It clears
     without a restart, and the queue behind it moves. After an update, subscriptions check within a few minutes.
   - releases.json.

## Stop rules

- If the Step 0 repro does not hang on main, stop and tell the Root.
- If `detached` changes how the server shuts down in a way R2 does not cover, ask Dean.
- If tini breaks the image smoke test or the bundled yt-dlp, ask Dean.

## Release

Follow docs/RELEASING.md and AGENTS.md: the protected-main PR flow, dual-Node 22.23.1 + 24.20.0, and the plan closed out
with `node scripts/plan-complete.js <this plan> "Shipped v1.392.0" --apply` in the release PR. Dean authorizes the merge.

## Evidence (builder fills)

- Step 0 repro on main (red output): test/integration/ytdlp-grandchild-hang.test.js at 8d8ca7eb (main's code): `# tests 11 # pass 1 # fail 10`.
  Every hang case red with its own message ("the download promise never settled: a grandchild holding the pipes wedged it",
  "a stall kill never settled the job", "a timeout kill never settled the job", "a list timeout kill never settled", "the gate
  stayed held by the wedged first job", "Cancel must kill the whole yt-dlp group, grandchild included"); the one green case is
  the clean-exit control. 0 stray `sleep 600` after. F2 on main (scratchpad f2-probe.js, production 2 min delay, interval 60
  min, a subscription, boot with no ledger): main `polls in the first 130 s after boot = 0`; branch `= 1` (at +120 s).
- Branch results (green), the mutants and their red tests: grandchild-hang 18/18 at 0e238bef (the seat's count; the
  earlier "19" was a miscount), 21/21 at af7b8002 after the r1 tests (Node 22), boot-poll 8/8, trace tests 32/32,
  ci-pipeline-locks + dockerfile 24/24. Mutants in a /tmp `git archive` sandbox, diffed against a pristine copy, each red by name:
  R1 grace settle off -> 10 red (escaped-group exit, stall, kill-grace, list, heavy gate, cancels, runlog, trace, server exit);
  R2 group kill off -> 10 red (exit, stall, timeout, list x2, all four cancels, trace); R2 exit-time group kill off -> 3 red;
  detached off (download) -> 8 red; detached off (list) -> 2 red; each cancel site back to `child.kill` (one-off, playlist,
  stop-all, single) -> red by its own case (they first SURVIVED, masked by the exit-time group kill; a delegating spy on
  `run.killYtdlp` now binds the wiring, 85af3a95); server exit hook off -> 1 red; runlog settledBy off -> 2 red; trace settle
  off -> 1 red. W3: boot call off -> 2 red; sanitizer drops the ledger -> 4 red; due ignores the ledger -> 2 red; record off
  -> 2 red; record on every poll -> 1 red; read-only guard off -> 1 red; interval 0 polls -> 2 red. 19/19 killed.
  Gate r1 fixes (@af7b8002), each red by its own case: late-pipe destroy off (download; list); liveGroups delete at exit off;
  liveGroups kept on kill-grace off; group signal after exit; groupSurvivors set at kill time; the instanceof guard off.
  INCIDENT: the instanceof-guard test first used `fake.pid = 1`; its mutant ran `process.kill(-1, 'SIGKILL')` and killed every
  process the user owned (every tmux / Claude session on the box, twice, 03:36 and 03:44). The fixture now uses a sacrificial
  detached `sleep` (af7b8002); re-run, the mutant is red only by "the sacrificial sleeper is alive", 0 stray processes.
  LESSONS 2 records the class.
- Suites (counts, both Nodes): @b61731d8 Node 22.23.1 `npm test`: tests 12570, pass 12557, fail 0, skipped 13 (exit 0).
  Node 24.20.0 first run in a `git archive` copy: 9 fail, all environmental (`fatal: not a git repository` from tests that
  `git ls-files`, an EISDIR through the symlinked node_modules); re-run in a real git worktree @0e238bef: tests 12570,
  pass 12557, fail 0, skipped 13 (exit 0).
  Release suites @381d7001 (the approved sha): Node 24.20.0 tests 12573, pass 12560, fail 0, skipped 13 (exit 0). Node
  22.23.1, run CONCURRENTLY with the Node 24 suite: tests 12573, pass 12557, fail 3 (books-api.test.js "T6: progress pings
  coalesce" expected 1 batch, actual 0, and the dependent "T6: filter=reading" expected 2, actual 1; music-radio-series-r1
  "game station 165.2 ms vs real-genre 63.1 ms", the known timing-ratio flake). Neither file nor its modules is in this diff;
  both files alone 3/3 green (38/38 each run); Node 22.23.1 re-run ALONE @381d7001: tests 12573, pass 12560, fail 0,
  skipped 13 (exit 0).
- Image smoke test and PID 1: publish dry run 39363539226 (workflow_dispatch @0e238bef; Dockerfile and docker-publish.yml
  unchanged since): secret-scan, qualify (22), audit, publish all success. Smoke, verbatim: `smoke OK: /login -> 200 (via
  /welcome), /api/stats unauth -> 401, PID 1 = tini, node under it, yt-dlp 2026.08.17.073947, docker stop -> exit 0`.
- Gate verdicts (sha):
  - Gate: APPROVED r1 @0e238bef — security-brief (N1 kill-grace drops the group from the exit list; N2 tini unpinned,
    advisory; N3 a future lastPollAt suppresses the boot poll)
  - Gate: CHANGES r1 @0e238bef — qa (W1 groupSurvivors on kill-grace always true and DEVICE-CHECKS overclaimed "which
    helper"; N1 module header; N2 group signal after exit; N3 an unmeasured restart-timing claim)
  - Gate: APPROVED r1 @0e238bef — adversary (no hang outside R1/R2 found; NOTEs: late-pipe destroy, liveGroups cleanup, the
    done latch, the instanceof guard, the retry settledBy merge unbound; the escaped-helper and D-state gaps; the test count)
  - Fixed in 4402c4db + af7b8002 (above). Accepted: adversary N3 (masked by the after-exit guard), N5 (disclosed in ROADMAP),
    security N2 (matches the existing apk posture).
  - Gate: APPROVED r2 @af7b8002 — security-brief (N1, N3 fixed; new N4: playlist-job.test.js:204 still had a made-up pid 4242)
  - Gate: APPROVED r2 @af7b8002 — qa (W1, N1-N3 fixed; 93/93 Node 22, 131/131 Node 24 on its targeted set)
  - Gate: APPROVED r2 @af7b8002 — adversary (every r1 fix's mutant red, box intact; new N8: the same pid 4242)
  - The pid 4242 removal (a test fixture, not bookkeeping) goes back to the same seats for r3.
  - Gate: APPROVED r3 @381d7001 — security-brief (N4 fixed; N2 advisory)
  - Gate: APPROVED r3 @381d7001 — adversary (N8 fixed; playlist-job 32/32; the plan's evidence matches its runs)
  - Gate: APPROVED r3 @381d7001 — qa (pid gone; grandchild-hang + playlist-job 53/53; evidence lines checked)
  - Close-out after approval at 381d7001 is bookkeeping only (no seat re-check, RELEASING step 1); bound by
    `git diff --name-only 381d7001..HEAD`: ROADMAP.md docs/exec-plans/completed/2026-10-20-download-hang.md (docs and the plan move only; package.json /
    package-lock.json unchanged since the approval, the version bump landed before the gate in b61731d8).

## Done means

- The grandchild repro is red on main and green on the branch.
- The full dual-Node suite passes (22.23.1 and 24.20.0).
- The image builds and the smoke test passes, with PID 1 = tini.
- The full gate is APPROVED.
- v1.392.0 is tagged and the tag's Publish Docker Image run is green.
