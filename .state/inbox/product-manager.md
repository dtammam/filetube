# Acceptance — v1.30 Scale Performance + Polish Wave

You are the **product-manager**, running the **Acceptance** stage. Validate every
acceptance criterion against the FINAL post-GF1 code and report an explicit
**PASS / FAIL / DEFERRED** for EACH — "looks good" is not acceptance. You do NOT
implement fixes; you report only.

## Environment (for any CI-parity check)

```bash
export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"
node --version   # expect v22.23.1
```

## State of the wave (all through the gate)

- **All 13 tasks (T1–T13) VERIFIED** through the build gate; see
  `.state/feature-state.json` `tasks[]` — each has a `sde_report` +
  `build_verification`.
- **Two-reviewer gate PASSED** — QA APPROVE + adversarial APPROVE; AC8.4
  exercised-not-present independently verified across every guard. See
  `two_reviewer_gate_plan.outcome`.
- **GD-1 resolved** (`resolved_gate_decision`): the avatar glyph was reverted to
  first-letter (deterministic color + C5 wiring kept) via GF1; adversarial
  re-confirmed the delta (APPROVE). Latest suite: **3593/3593, lint 0 errors / 7
  baseline, Node 22.23.1**.
- Tech-debt filed this wave: **#28** (SQLite deferred), **#29** (MAX_LIMIT=10000
  full-list truncation), **#30** (matchesSearch null-guard note).

## Read first

1. `docs/exec-plans/active/2026-07-11-v1.30-scale-perf-and-polish.md` — the
   authoritative `## Acceptance Criteria` (**AC1.1–AC8.5, 48 ACs**) + `## Requirements`
   (FR1–FR8). These are your checklist.
2. `.state/feature-state.json` — the per-task reports/verifications, the gate
   outcome, `resolved_gate_decision` (GD-1), `gf_rounds` (GF1).

## What to validate

Go through **all 48 ACs (AC1.1 → AC8.5)** and mark each **PASS / FAIL / DEFERRED**
with a one-line justification tied to concrete evidence (a test name, a route
behavior, a build/gate record). Group by deliverable. In particular:

- **Deliverables 1–4 (responsiveness, AC1.x/AC2.x/AC3.x/AC4.x):** these are the
  observable/mechanism-locked criteria — validate against the actual tests
  (heartbeat stall bound, scan-while-serving latency, 202-ack-before-completion,
  scan-status progress, thumbnail-route O(1) loads, ≥5:1 progress batching,
  pagination cross-window correctness). Confirm the mechanism named in each AC is
  the thing tested (not "feels fast").
- **Both-directions guard ACs (AC1.4/1.5, AC1.6/1.7, AC2.5, AC4.2/4.3, AC5.2):**
  confirm BOTH directions are exercised (the gate already verified AC8.4
  exercised-not-present — you may cite that, but confirm the criterion holds).
- **Deliverable 5 (one-shot visibility, AC5.1–5.4):** all three surfaces + reload-never.
- **Deliverable 6 (chip, AC6.1–6.4):** idle-hidden / active-shown / queued≠active /
  no-dequeue-on-queued.
- **Deliverable 7 (visual, AC7.1–7.5):** token static-scan, 16px floor, like→Liked
  membership round-trip, deterministic avatar both-directions (now first-letter +
  deterministic color, post-GF1), subs/settings-header via the shared resolver.

## Dean-on-device items — record, do NOT fake-pass (this is mandatory)

These SHIP but are **Dean's on-device (post-release) arbiter items** — mark them
**DEFERRED (Dean-on-device)**, NOT PASS, with a note that the machine-checkable
sub-parts (where any) did pass:

- **AC7.6** — elegant buttons + overall "typography reads consistent" feel. Its
  machine guards (AC7.1 tokens, AC7.2 floor still green after the C4 polish) PASS;
  the subjective quality is Dean's iPhone pass.
- **GD-1** — avatar glyph is first-letter + deterministic color, adopted per
  unanimous two-reviewer consensus; Dean may re-open on-device. Note it as a
  resolved-but-Dean-may-revisit ledger item.
- **Carried-over v1.29 AC4.5** — navigate-during-download *feel* (the non-blocking
  one-shot). Code-complete + test-verified in v1.29 and not regressed here (T8
  BUG-2 intact); still awaits Dean's on-device confirmation. Carry it forward on
  the ledger.

Do not report these as automated PASS — the pipeline does not wait on Dean's
device (release proceeds while he is away; his pass is the post-release arbiter).

## AC8.x process criteria (satisfiable from records — cite them)

- **AC8.1 / AC8.2** — `npm test` green on Node 22 AND Node 24. Node 22.23.1 is
  recorded green (3593/3593). For **Node 24 (AC8.2)**: check whether a Node-24 run
  is recorded anywhere; if it is NOT independently evidenced, mark AC8.2 **FAIL or
  DEFERRED-pending-Node24-run** and flag it as a release-gate item to resolve
  BEFORE `/prep-em-done` (it is deliverable 8's explicit extra check). Do not assume
  it; require evidence.
- **AC8.3** — `npm run lint` zero errors (recorded: 0 errors / 7 baseline). PASS.
- **AC8.4** — two-reviewer gate completed + recorded, incl. the exercised-not-present
  verification of the both-directions guards. PASS (cite the gate outcome).
- **AC8.5** — v1.30.0 released (merge/tag/push). This is NOT done yet (release is
  the Done stage, after your acceptance) — mark **PENDING (post-acceptance)**.

## Deliverable from you

A per-AC PASS/FAIL/DEFERRED table (all 48), the Dean-on-device ledger (AC7.6 / GD-1
/ AC4.5) explicitly marked DEFERRED-Dean-on-device, an explicit call on **AC8.2
(Node 24)** with evidence or a flag, and an overall verdict: **ACCEPT** (ready for
release close-out) or **ACCEPT-WITH-CONDITIONS** (name them, e.g. run Node 24
first) or **REJECT** (name the failing ACs). Report only — do NOT implement.

When done, return to the EM session:
- **ACCEPT →** run `/prep-em-done` (v1.30.0 close-out + release).
- **ACCEPT-WITH-CONDITIONS / REJECT →** report so the EM routes a fix (e.g. a
  Node-24 verification run, or a gate-fix round) before Done.
