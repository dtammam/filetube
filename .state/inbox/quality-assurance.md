# Two-reviewer gate (Reviewer 1 of 2 — QA) — v1.29 Downloads Reliability Wave

You are the **quality-assurance** reviewer, the FIRST of TWO independent
reviewers gating the v1.29 Downloads Reliability Wave before acceptance. A second
adversarial reviewer runs separately. **BOTH reviewers must independently APPROVE
for the gate to pass** — your verdict is not overridden by the other's and does
not override it.

Do NOT modify code, tests, or state. Do NOT commit. Produce a review report:
findings tagged **CRITICAL / WARNING / SUGGESTION** with `file:line` references,
and an overall verdict **APPROVE / REQUEST CHANGES / NEEDS DISCUSSION**.

## What shipped (the whole wave)

v1.29 makes downloads trustworthy: real failure reasons surfaced + persisted; a
durable capped JSONL run log; retry that actually retries with visible busy-
coalescing; non-blocking one-shot (modal → corner chip → in-place refresh);
honest partial-success accounting; yt-dlp pacing/retry flags; a download history
view. 9 tasks, all implemented + independently build-verified (final suite
3399/3399, lint 0 errors / 7 baseline warnings).

## Read first (authoritative context)

1. `.state/feature-state.json` — the `tasks` array (T1–T9, each with `sde_report`
   + `done_when`), `constraints`, `key_anchors`, `em_ratifications`,
   `tech_debt_in_reach`, `gate_watch_items`, and `pre_release_gates`.
2. `docs/exec-plans/active/2026-07-11-v1.29-downloads-reliability.md` — the full
   `## Requirements` (R0–R4), `## Acceptance criteria` (AC1–AC7 + AC-FM-A/B/C/D),
   and `## Design`. Review the code AGAINST these — every AC should be satisfied
   and honestly testable.
3. `docs/CONTRIBUTING.md` + `docs/RELIABILITY.md` (standards: CommonJS, node:test,
   textContent, no new deps, degrade-not-crash, disabled-module no-op).

## The wave's changed files (scope your review to these)

- `lib/ytdlp/runlog.js` (new), `lib/ytdlp/run.js` (T1), `lib/ytdlp/failures.js`
  (T2), `lib/ytdlp/index.js` (T3/T5/T9), `lib/ytdlp/config.js` + `lib/ytdlp/args.js`
  (T7), `lib/ytdlp/client/subscriptions.js` (T4/T6/T9), `public/js/common.js` (T6/T8),
  `public/js/main.js` (T8), `README.md` (T7), plus the new/changed tests under
  `test/`. `server.js` got only `dataDir: DATA_DIR` added to two deps bundles (T3).

## CRITICAL — diff-scoping (gate_watch_items)

The git index/worktree holds **PRE-v1.28.1 content** for files the v1.28.1 icon
release touched (5 HTML shells incl. `lib/ytdlp/views/subscriptions.html`,
favicons, icons, `pwa-icons.test.js`, `package.json@1.28.0`, ROADMAP) — a merge
artifact, NOT wave work. A targeted `git restore` of those paths is prepared and
awaiting Dean (release-blocking, tracked). **Scope your diff review to the wave's
files only** (diff each wave file vs HEAD). **IGNORE the staged pre-v1.28.1
content in the icon/shell/package files** — it is not part of this wave and must
not be reviewed as such. If you see `subscriptions.html` as "changed", that is the
anomaly, not a T-task edit (T9 explicitly did NOT touch it — verify that).

## Focus areas (verify correctness, security, performance, standards)

- **Failure-masking, BOTH directions (the headline hazard, `failures.js`
  `computeDownloadOutcome` + `index.js` threading):** a total/channel-level
  failure must still surface as an error with the real reason (AC-FM-A); a
  some-succeed-some-fail run must be `partial` with failures attributed, never a
  false success or a whole-channel "failed" (AC-FM-B); unattributed failures never
  inflate `succeeded` (AC-FM-D). Confirm the three arms are exhaustive/disjoint.
- **Injection guard byte-identity (`args.js`, AC6.3):** the pacing/retry flags are
  additive; host allowlist / `--` separator / FORBIDDEN_CHARS / SF4 / decoded-id
  charset / `shell:false` untouched; `player_client` value charset-validated.
  Confirm the two byte-identical argv deepEqual locks actually pin this.
- **BUG-2 reload contract (`common.js`/`main.js`, T8):** `window.location.reload`
  is never called on the one-shot done path; refresh is in-place via
  `loadLibrary`; `decideOneOffTerminalAction` still `rescan:false`. Confirm the
  spy test genuinely proves it.
- **Real-reason surfacing + persistence + restart (`run.js`/`index.js`/`runlog.js`,
  AC1/AC2):** bounded/sanitized (no unbounded/control-char/`innerHTML` paths);
  `lastStatus` survives restart; run-log capped/rotated at 500 with atomic writes;
  disabled-module no-op (no file, no route).
- **Cancellation ordering (R0.8):** a cancelled run persists `lastStatus:'cancelled'`
  + run-log `outcome:'cancelled'`, never a synthesized error — even with non-empty
  stderr; the cancel-latch hoist (T3) is correct.
- **Repull discriminator (`index.js` T5):** `onDecision` fires synchronously before
  the first await; routes keep 202; body `{started,reason}` correct; no double-send;
  backward-compatible.
- **Standards:** textContent-only for server/user strings; no new deps; degrade-not-
  crash; disabled no-op holds across every new surface.

## SDE-flagged deviation to scrutinize (T9)

`detectNewlyTerminalRuns` in `subscriptions.js` uses **state-comparison between
poll ticks** (prev snapshot states vs new) rather than T8's id-seen-set. SDE
rationale: subscription ids are permanent, so a seen-set would fire once ever.
**Verify the transition semantics:** it must fire the history re-fetch exactly on
a run's entry into a terminal state (done/error/cancelled), not on steady-state,
and must not miss or duplicate re-fetches across ticks. Judge whether the
deviation is sound.

## Honest-scoring guidance (thumbnail-backfill lesson)

Score findings HONESTLY. A real regression (e.g. a scan/backfill that re-does
work on upgrade, a masked failure, a broken invariant) is CRITICAL/WARNING on its
merits — do NOT rationalize it away as "one-time" or "acceptable" to keep the gate
green. Equally, do not inflate style nits into blockers. If something needs Dean's
judgment, use NEEDS DISCUSSION.

## Deliverable
Report: findings (CRITICAL/WARNING/SUGGESTION with file:line), an explicit
per-headline-hazard assessment (failure-masking both directions, injection-guard,
BUG-2, cancellation, run-log, restart, the T9 deviation), and the verdict
(APPROVE / REQUEST CHANGES / NEEDS DISCUSSION). Note the standing **Node 22
pre-release re-run** as a release-gate reminder (all per-task verifies ran on Node
24). Do NOT modify code or commit. The orchestrator collects BOTH reviewers'
verdicts; both must APPROVE to pass.
