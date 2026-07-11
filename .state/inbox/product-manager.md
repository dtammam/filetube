# Discovery Inbox — Product Manager

**Feature:** v1.31 yt-dlp Download Hardening
**Stage:** Discovery
**Target release:** v1.31.0

You are the Product Manager for a plan-gated feature that is already APPROVED at
the strategy level. Your job is NOT to re-decide scope — it is to convert the
approved execution plan into **requirements + observable, testable acceptance
criteria (ACs)** that specialists downstream can implement and verify against.

## Read first (authoritative, in this order)

1. `docs/exec-plans/active/2026-07-12-v1.31-ytdlp-hardening.md` — the Dean-approved
   plan. Goal, verified current reality (with file:line map), the H0 prime
   hypothesis, scope P0–P6, out-of-scope, constraints, and the 7 deliverables.
   **This is the source of truth. Do not contradict it.**
2. `.state/feature-state.json` — carries H0, the P0–P6 pillars, constraints, the
   regression surfaces, the gate-weight map, and the file:line sweep anchors.
3. `docs/CONTRIBUTING.md` — coding/testing standards all agents follow.
4. `docs/RELIABILITY.md` — error-handling, logging, and testing-strategy budget
   (graceful degrade over crash; one bad channel must never take down a run;
   explicit status codes + JSON error bodies; every new change ships with tests;
   FFmpeg/live-network stay OUT of the automated suite).

## What to produce

Add a `## Requirements` section and a `## Acceptance Criteria` section to the
exec plan **in place** (append; do not rewrite the existing sections). Then set
`artifacts.requirements` in `.state/feature-state.json` to the exec-plan path and
leave `stage` as `discovery` (the EM advances stages, not you).

Structure the requirements as functional requirements (FR1…) mapped to the seven
deliverables, and give each an explicit AC block (AC1.x…) with **observable pass
conditions and cited evidence sources**. "Looks good" / "works" is never an AC —
every AC must be checkable by a test, a code-grep, or an inspectable artifact.

## The 7 deliverables (from the plan) — cover every one

1. A full poll run against many channels under throttling either **completes or
   aborts EARLY** with an honest breaker status — never a uniform 20-channel
   timeout cascade.
2. Timeout/stall reasons **name the phase and duration**; bare "timed out and was
   killed" no longer exists in the codebase.
3. A Shortcut one-shot submitted mid-run **starts within ≤1 channel's work**, its
   queued state (and position) is visible in status/chip/history, and it
   **survives a server restart** (requeued, never silently lost).
4. A stalled download is reclaimed within the **idle window (default ~10 min)**,
   not 180 minutes, and retries per policy.
5. Repull responses' busy/started state is visible **wherever repull can be
   triggered**.
6. yt-dlp version visible in the UI with a staleness note.
7. `npm test` + lint green on Node 22 + 24; two-reviewer gate passed; v1.31.0
   released per repo convention.

## Special care — non-negotiable AC quality bars

These are where the gate weight sits. Write ACs to this standard:

### A. Deterministic, fixture-driven — NO live network
The breaker (P2), stall watchdog (P3), and durable queue (P4) behaviors MUST have
ACs verifiable with **fixtures / fakes / injected clocks / stubbed spawn**, never
by hitting YouTube. Examples of the shape required (make them concrete, not these
literal words):
- Breaker: "given a stubbed channel runner that fails N consecutive times, the run
  aborts after exactly the configured threshold, persists status
  `run paused after N consecutive failures; retrying at <time>`, and does NOT
  invoke the runner for the remaining channels" — plus the reset direction: "a
  success before the threshold resets the counter to 0."
- Watchdog: "given a fake child emitting no stdout progress for the configured
  idle window (via injected timer), the process receives SIGKILL and the failure
  reason is the exact stall string" — plus the negative: "a child that emits
  progress within the window is NOT killed."
- Durable queue: "an accepted-but-not-started job written to the persisted queue is
  requeued on a simulated restart and eventually yields a runlog/history line;
  the persistence write is atomic and the file is bounded."

### B. Phase-named timeout reasons — EXACT-STRING criteria
Deliverable 2 needs ACs that pin the **exact reason strings** (or an exact,
enumerated format) for each phase/duration, e.g. "list pass timed out after 5m",
"download stalled — killed after 10m idle", "download hit the 180m ceiling".
Include a codebase-grep AC asserting the bare legacy string
"timed out and was killed" is **absent** from source (exercised-not-present style).
Reasons must interpolate the *actual* configured duration, not a hardcoded literal
that can drift from config.

### C. P1 invariants — BOTH-DIRECTIONS ACs in the v1.29 AC-FM style
For the queue decomposition, write paired ACs (property-holds AND
violation-is-caught) for each load-bearing invariant:
- **--download-archive single-writer:** at most one yt-dlp process writes the
  archive at any instant across the decomposed per-channel jobs (strict serial
  spawn). Positive: serialization holds under concurrent job submission. Negative:
  a test that would observe two overlapping archive writers fails/is caught.
- **runExclusive never-wedge tail:** the promise-chain FIFO never permanently
  wedges — a job that throws/rejects/times out still releases the tail so the next
  job runs. Positive: after a failing job the next job proceeds. Negative: a
  regression that swallows the release is detectable.
- **Priority ordering:** one-shot > repull > scheduled poll; a one-shot enqueued
  mid-run runs after at most one in-flight channel completes (≤1 channel wait),
  provably via a fixture with a controllable in-flight job.

### D. Regression-surface ACs (v1.29 + v1.30) — additive only
Pin ACs that the following are PRESERVED (not regressed) by this wave:
- v1.29: outcome classification (success/partial/error/cancelled),
  zero-attributed⇒error, cancel-latch ordering, runlog schema **additive-only**
  (new fields may be added; existing field names/semantics unchanged), retry
  affordances, AC6.3 argv byte-identity posture (new flags/args added with the
  same injection-guard discipline — literals or validated values only, never near
  `--`).
- v1.30: chip conformance, one-shot three-surface visibility, BUG-2 reload-never.

### E. Config ACs
Every new knob is a `FILETUBE_YTDLP_*` env var, bounds-checked in `config.js` via
the established `parse*` pattern, with a documented default and clamped bounds.
Write an AC per new knob (breaker threshold, inter-channel sleep, idle window,
list-pass budget/timeout, any queue-persistence bound).

### F. H0 gating AC
Add an AC that T0 must **verify H0's arithmetic against the code** (request budget
per list pass vs the 5-min timeout at `run.js:105`) and record the finding BEFORE
the P0 fix lands. The fix's AC is conditional on that verification (confirm or
falsify + adjust).

## Boundaries

- Do NOT design the solution (that is the Principal Engineer's next stage). Stay at
  the "what/observable" level; you may reference file:line anchors from the plan as
  evidence pointers, but do not prescribe the implementation.
- Do NOT expand scope beyond P0–P6. Cross-check the out-of-scope list — nothing you
  write may require parallel yt-dlp, runtime auto-update, cookie automation, or a UI
  redesign. Nothing may conflict with CONTRIBUTING.md mandatory standards.
- Do NOT write application code or tests.

## When done

- Exec plan has `## Requirements` (FR1…) + `## Acceptance Criteria` (AC1.x…)
  covering all 7 deliverables, meeting bars A–F above.
- `.state/feature-state.json` `artifacts.requirements` points at the exec-plan path.
- Report back a concise summary: FR count, AC count, and which ACs carry the
  heaviest gate weight (P1 invariants, phase-string exactness, breaker/watchdog/
  queue determinism). Then the user returns to the EM and runs `/prep-pe-design`.
