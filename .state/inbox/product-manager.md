# Product Manager — ACCEPTANCE: v1.29 Downloads Reliability Wave

You are the Product Manager validating the v1.29 Downloads Reliability Wave for
ACCEPTANCE. All 9 implementation tasks (T1–T9) plus three gate-fix rounds
(GF1/GF2/GF3) are built and verified; the two-reviewer gate (QA + adversarial)
plus a delta re-gate, a focused re-gate, and a same-session delta-confirm have
run. Your job: **verify each acceptance criterion against the FINAL code and the
latest test output — explicit PASS/FAIL per criterion. "Looks good" is NOT
acceptance.** Do NOT implement fixes; report only. Do NOT commit.

## Read first
1. `docs/exec-plans/active/2026-07-11-v1.29-downloads-reliability.md` — the
   `## Deliverables / "done" looks like` (7 items), `## Requirements` (R0–R4),
   and `## Acceptance criteria` (**27 ACs across Deliverables 1–7 + the 4
   AC-FM-A/B/C/D** failure-masking criteria). These are what you validate.
2. `.state/feature-state.json` — the `tasks` array (T1–T9 + GF1/GF2/GF3, each with
   `sde_report`/`build_verify`), `gate_results` (incl. `gf1_regate`,
   `gf2_deans_fix`, `gf2_regate`, `gf3_deans_resolution`), `em_ratifications`,
   `pre_release_gates` (Node 22 CLEARED), and `gate_watch_items` (v1.28.1 anomaly
   CLEARED).
3. The wave's code + tests (see the changed-file list in state) — validate ACs
   against the ACTUAL code, not just the plan text.

## What to validate — every deliverable + every AC

Go through all 7 deliverables and give an explicit PASS/FAIL for each of the 27
ACs + the 4 AC-FM criteria, each citing the concrete observable signal (a status
string, a JSONL line, a DOM element/class, a grid refresh, an argv flag, a README
row, a passing test):

- **Deliverable 1 / AC1.x** — real failure reason surfaced live AND persisted
  across restart (bounded/sanitized, not "exit code 1").
- **Deliverable 2 / AC2.x** — capped JSONL run log under `data/`; `/subscriptions`
  history view; disabled-module no-op (no file, 404).
- **Deliverable 3 / AC3.x** — retry buttons on error/partial rows + one-shot rows
  + one-off modal error; visible "queued behind current run" (busy body).
- **Deliverable 4 / AC4.x** — non-blocking one-shot (modal → chip), in-place grid
  refresh via `loadLibrary`, NEVER `window.location.reload` (BUG-2 spy).
- **Deliverable 5 / AC5.x + AC-FM-A/B/D** — honest partial-success accounting;
  the both-directions failure-masking criteria (see the ratified evolutions below).
- **Deliverable 6 / AC6.x** — resilience argv flags with env overrides, byte-
  identical injection-guard posture (AC6.3), README ENV rows.
- **Deliverable 7 / AC7.x** — `npm test` + `npm run lint` green (final:
  **3420/3420, 0 lint errors / 7 baseline warnings on Node 22.23.1**); two-reviewer
  gate passed; version bump + release notes (NOTE: the v1.29.0 version bump +
  ROADMAP Shipped entry is the close-out task T10 — AC7.4's release-notes artifact
  is produced at close-out, so mark AC7.4 as "pending close-out" rather than FAIL
  if the bump hasn't landed yet, and confirm the plan/ROADMAP target is in place).

## TWO ratified semantic evolutions vs the ORIGINAL AC text (validate against THESE, not the stale original)

Dean approved two semantic changes during the gate rounds. The original AC-FM
text predates them; validate the CODE against the ratified semantics and note the
evolution explicitly in your report (do NOT flag them as failures):

1. **All-unattributed / zero-attributed runs classify as `error`** (not partial).
   The original AC-FM-B repro (2 unattributed / 2 targets, zero attributed) was
   first expected to be `partial`; the delta re-gate found that crediting a
   success there is Direction-A phantom-success masking (yt-dlp emits byte-
   identical templated stderr — 429/age-gate — across distinct videos). The
   Dean-approved supersession: with **zero attributed evidence of a real target
   boundary, the run is `error`** (Direction-A-safe; cutoff frozen so Retry
   re-lists the same window). Validate that the code does this and that AC-FM-A
   (real failures still surface) and AC-FM-B (genuine partials — WITH an
   attributed boundary — still report partial with honest counts) both hold under
   the ratified semantics.
2. **`remainingAfterAttributed === 1` is deliberately conservative:** an
   unattributed failure consumes the last remaining slot → `error`/`succeeded:0`
   (AC-FM-D intentionally wins over reserve-at-least-one, by design; consequence
   is one extra retry cycle, never a lost window). Dean-approved; the doc comment
   and a boundary-lock test (9 attributed + 1 unattributed / 10 → error/0/10) pin
   it. Validate the code matches.

## Deliverable
An acceptance report with an explicit **PASS/FAIL per criterion** (all 27 ACs +
AC-FM-A/B/C/D + the 7 deliverables), each citing its observable signal; a clear
note on the two ratified semantic evolutions (validated against the ratified
semantics, not the stale AC text); AC7.4 marked pending-close-out if the version
bump hasn't landed; and an overall **ACCEPT / DO NOT ACCEPT** recommendation. If
any criterion FAILS, name it precisely (do NOT rationalize — thumbnail-backfill
lesson). Do NOT implement fixes or commit.

On ACCEPT, the orchestrator runs close-out (T10: version bump to v1.29.0, ROADMAP
Shipped entry, commit/tag/push/Docker) via `/prep-em-done`.
