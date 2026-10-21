---
plan: listing-overflow
harness: v2 · full
branch: fix/v1.393.0-listing-overflow
anchor: spec
status: Approved, not started
next: builder - cut the branch from main @d0d1a785, Step 0 (reproduce ERR_STRING_TOO_LONG wedging the gate, red), then W1
design: Approved 2026-10-20 @d0d1a785
gate: pending
builder: standard
---

# v1.393.0 - a listing that is too big never wedges the download queue

Kickoff 2026-10-20 (Server/Web Root, Opus). **Builder: Standard (Sonnet), Dean's pick:** the cause is measured on
production and the rulings are concrete. R3 (the gate watchdog) is the subtle part, and its stop rule applies
literally. v1.392.0 shipped a real fix, and the hang came back on the device the same day. So this re-root-causes
the hang. One release, version **1.393.0**.

## Why (measured on production, v1.392.0, container `filetube`, 2026-10-20)

Dean: a one-off download sat at "Queued - 1 ahead, waiting 3 h". Evidence collected read-only via the Docker Host Root:

- `/api/subscriptions/status` at 21:19Z: subscription `9ec383037ab6ce0a5b18bd85cdfc83f3` ("Scott Hanselman",
  `lastCheckedAt: null`, never checked) has been in `state: 'listing'` since **12:25:35Z** (9 h). "PsyopAnime" is
  `queued` behind it. The one-off has `queuedAhead: 1`. `breaker: null`. Engine `busy: null`, `autoUpdate: false`.
- `ps` in the container: ONLY `tini` (PID 1) and `node server.js`. **No yt-dlp and no helper exists.** So this is not
  F1 of v1.392.0.
- The container log, right after the previous channel's list pass:
  ```
  Uncaught exception: Error: Cannot create a string longer than 0x1fffffe8 characters
      at Object.slice (node:buffer:640:37)
      at Buffer.toString (node:buffer:868:14)
      at finish (/app/lib/ytdlp/run.js:1006:67)
      at ChildProcess.<anonymous> (/app/lib/ytdlp/run.js:990:41)
      ...
      at ChildProcess._handle.onexit (node:internal/child_process:304:5) { code: 'ERR_STRING_TOO_LONG' }
  yt-dlp: a poll is already running; this trigger is coalesced ...
  ```
- One-off trace: every one-off that reached the gate finished in 20-70 s. The stuck ones sat in `gate-wait` until a
  restart (2026-10-18 13:43, 2026-10-19 18:42, 2026-10-20 14:43). That is the same signature on earlier days.

## Root cause

**C1 (the wedge).** `spawnYtdlp`'s `finish` (lib/ytdlp/run.js, around 990-1030 at d0d1a785) sets `settled = true`,
THEN does `Buffer.concat(stdoutChunks).toString('utf8')`. On more than about 512 MB of stdout, that throws
`ERR_STRING_TOO_LONG`. The throw escapes the `'close'` listener. server.js's log-only `uncaughtException` handler
(server.js:7310) keeps the process alive. The promise never resolves, because the latch is already set and nothing
re-settles it. So `runList` never returns, the heavy gate is held forever, and `pollBusy` stays true. **Any throw
inside any settle body has the same effect.** That is the bug class, and the string is just today's trigger.

**C2 (the trigger).** The list pass buffers every byte of `--dump-json` output (one full info-dict per video:
formats, automatic_captions URLs, and so on), up to `--playlist-end` 200 by default (`DEFAULT_LIST_SCAN_CAP`). A fresh
channel-root sub with no captured `channelId` has no break-early (args.js `resolveBreakEarlyTarget`). So a channel
whose entries are large enough produces more than 512 MB. The list consumer (`rules.parseYtdlpVideoList` and the
index.js list pass) uses only a handful of fields per entry.

**C3 (no escape).** A Cancel on a `listing` subscription is deliberately refused (index.js, around 7093/7149: "no
tracked child"), so today only a restart frees it. **Worse:** after a restart, the v1.392.0 catch-up poll reaches the
same channel and wedges again.

Gate: APPROVED r1 @35d23677 - security-brief

## Rulings (settled at kickoff - do not reopen)

| # | Question | Ruling |
|---|----------|--------|
| R1 | Settle bodies never throw | Every settle body in run.js (`spawnYtdlp.finish`, `spawnYtdlpDownload`'s close/exit/grace settle, stream-error and `'error'` handlers) and engine.js `runEngineProcess` resolves inside a try/catch. A throw after the latch resolves `{ ok: false, code: 'ESETTLE', error: <safe message> }` and logs one line, never an orphaned promise. Shared helper preferred. Test: inject a throw at each settle site (a stub decoder or concat), and the promise resolves and the gate releases. |
| R2 | The list pass never buffers the whole output | Parse stdout line by line AS IT ARRIVES (the existing bounded line-splitter pattern). Keep only the fields the list consumer reads, as a slim object per entry. Builder: enumerate them from `rules.parseYtdlpVideoList` and every reader of its output, then prove the list pass result is byte-identical to today's on a fixture of real `--dump-json` lines. The total kept is bounded. A single line over a hard cap (named constant, e.g. 16 MB) is skipped and counted, never a crash. The run's result stays the same shape for callers. Do NOT switch the argv to `--print` templates in this release (a different extractor contract, separate risk); note it as Planned if the builder thinks it is better. |
| R3 | Gate backstop | Add a **watchdog on `pollBusy` and on gate jobs**: if a single gate job runs longer than its own worst-case budget (list cap 60 min + download ceilings + grace; derive it, do not guess), log one loud line `gate job exceeded its budget: kind label ms`, and release the gate for the NEXT job. The hung job's late result is ignored, and its activity row is set to `error` "stopped: exceeded its time budget". This is the belt to R1's braces. Brief the Adversary specifically on whether releasing can run two yt-dlp at once (it may only release a job whose child is gone or group-killed). |
| R4 | Cancel frees a listing | Cancel on a `listing` subscription kills the list child's group (track the list child like the download child) and settles it. The row goes to `cancelled` and the poll moves to the next channel. |
| R5 | Instrument | The log-only `uncaughtException` handler also records the exception into the one-off trace file (`kind: 'uncaught'`, the first stack lines), so the next unexpected throw shows up in Settings > Troubleshooting > Download trace without docker access. Also wire the subscription lane's `onTrace` (ROADMAP Planned "A subscription download has no trace hook"), with the same trace lines tagged by subscription id. |
| R6 | Tests | Reproduce C1 first through the real spawn: a fake yt-dlp script that writes more than 0x1fffffe8 bytes of `{"id":...}` lines to stdout. If that is too slow or too memory-heavy in CI, prove the same throw by injecting a `Buffer.toString` that throws ERR_STRING_TOO_LONG at the real call site, and say which in the evidence. Red on d0d1a785 (the promise never settles, and the next gate job never runs). Green on the branch. Mutate R1's guard, R2's streaming (revert to concat), R3's watchdog and R4's cancel: each must go red. **Fake pids are sacrificial detached `sleep` processes, never 0/1/negative (LESSONS: the v1.392.0 kill(-1) incident).** Memory: the big-output test must not hold more than about 50 MB in the test process (the streaming must be what keeps it small). |
| R7 | Gate | Full gate: adversary + qa + security-brief. Brief the Adversary to wedge the gate a THIRD way: any other throw-after-latch, an `await` with no bound inside `runExclusive`, or a podcast or engine job. |

## Step 0 (builder, before W1)

- Read AGENTS.md, docs/LESSONS.md (sections 0, 2, 11, 13), and the completed plan
  docs/exec-plans/completed/2026-10-20-download-hang.md (its evidence and its LESSONS line).
- Cut `fix/v1.393.0-listing-overflow` from main @d0d1a785.
- Write R6's repro and watch it wedge the gate on main (red). If it does NOT wedge, STOP and tell the Root.
- Measure C2: from the box, run the real list argv for one public channel with `--playlist-end 5` and report the bytes
  per entry. That gives the per-entry size that turns 200 entries into more than 512 MB. Put the number in the
  evidence. Do not hit Dean's production.

## Waves

1. **W1 - settle bodies never throw (R1)**: run.js and engine.js. Tests per R6.
2. **W2 - the streaming list parse (R2)**, plus a byte-identical fixture proof.
3. **W3 - Cancel frees a listing (R4)**, and the gate-job budget watchdog (R3).
4. **W4 - instruments (R5).**
5. **W5 - close-out**:
   - ROADMAP: this bug moves to Shipped. Remove the "no trace hook" Planned item if W4 covered it. File Planned items
     for anything the builder noted.
   - LESSONS: "a settle latch set before work that can throw orphans the promise; a log-only uncaughtException turns
     a crash into a silent wedge; never buffer an unbounded child stdout".
   - DEVICE-CHECKS:
     - The Scott Hanselman channel checks and finishes (or fails with a message) within an hour.
     - A one-off queued behind a poll runs.
     - Cancel on a listing row frees the queue.
   - releases.json.

## Stop rules

- If the Step 0 repro does not wedge on main, stop and tell the Root.
- If R2's byte-identical proof cannot be made (the consumer needs a field that is itself huge), ask Dean.
- If R3's watchdog cannot be made safe against two concurrent yt-dlp, drop R3, keep R1 + R4, and say so.

## Release

Follow docs/RELEASING.md and AGENTS.md: the protected-main PR flow, dual-Node 22.23.1 + 24.20.0, image smoke, and the
plan closed out with `node scripts/plan-complete.js <this plan> "Shipped v1.393.0" --apply` in the release PR. Dean
authorizes the merge.

## Not in scope

- The `[Errno 13] Permission denied` on /media/ytdlp/SteveTerreberry (a host folder-permission problem; the Root
  handles it with Dean).
- A partial run's cutoff skipping failed videos (ROADMAP Planned).

## Evidence (builder fills)

- Step 0 repro on main (red):
- C2 bytes per entry:
- Branch (green), mutants and their red tests:
- Suites (counts, both Nodes):
- Image smoke:
- Gate verdicts (sha):
Gate: CHANGES r1 @35d23677 - qa

Gate: CHANGES r1 @35d23677 - adversary
