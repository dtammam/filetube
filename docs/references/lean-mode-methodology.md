# Lean Mode — a portable methodology spec

A repo-agnostic specification of the working method proven on FileTube
across v1.26 → v1.41.x (~90 releases). Written so it can seed other
repositories — hand this document to an onboarding agent (or a future
handoff-harness) and it describes exactly what to install and how to
operate. FileTube-specific values appear only as `{{PLACEHOLDER}}`
examples.

## 1. The model in one paragraph

The human gives a goal and answers questions; one AI session runs the
entire software lifecycle autonomously — design, implement, test,
adversarially review, release — and the human verifies in their real
environment. Trust rests on two pillars: **the two-reviewer gate** (work
is never merged on the author's say-so) and **ruthless honesty**
(failures reported verbatim, regressions scored as regressions, known
gaps disclosed in release notes). Neither is ever traded for speed.

## 2. Why this shape (lessons that produced it)

- **Role separation was ceremony; review independence is the value.**
  A staged pipeline (PM → architect → developer → QA agents, state files,
  per-stage approvals) was tried first. Splitting *implementation* across
  role agents lost context at every hand-off and added latency without
  catching more bugs. What actually catches bugs is a **fresh context
  with a mandate to refute** — so lean mode keeps one implementing
  session and spends the multi-agent budget entirely on independent
  review.
- **The author of code is structurally its worst reviewer.** The gate has
  repeatedly found CRITICALs the implementer could not see: inert
  third-party flag combinations, data-loss mechanisms that kept the test
  suite green, same-day repeats of bug classes already paid for once.
  Expect the gate to find real things; that is it working, not failing.
- **Human approval moved to the edges.** Instead of approving every stage
  transition, the human approves scope at intake and verifies the result
  on their own devices. Everything between is autonomous, made safe by
  the gate + honesty norms.
- **State that isn't exercised rots.** Pipeline state files went stale
  and actively misled later sessions. Durable state belongs in artifacts
  that later work actually reads: exec plans, a tech-debt tracker, a
  ROADMAP shipped-log, and persistent memory.

## 3. Roles

- **Main session** (the implementer): full lifecycle, all code, all git.
- **QA reviewer** (subagent, fresh context): correctness, security,
  regressions, standards, comment accuracy — stale comments are findings.
- **Adversarial reviewer** (subagent, fresh context): assumes both the
  implementer AND QA missed something; must verify claims against
  primary sources and produce a concrete failure scenario per finding.
- **Design explorer** (optional subagent, big waves): read-only
  explore/plan pass that drafts the exec plan for the main session to
  refine.
- **The human**: sets goals, answers intake questions, runs the final
  in-environment verification, owns deploy/publish.

## 4. Lifecycle of a wave

1. **Intake.** For anything non-trivial, ask the human questions FIRST —
   numbered, each with a recommendation inline so they can reply "agree"
   or override per number. Scope agreed = autonomy authorized.
2. **Design (big waves only).** A written exec plan committed to
   `docs/exec-plans/active/<name>.md`: goals, non-goals, design,
   task breakdown, risks, acceptance. It doubles as the reviewers' spec
   and survives context compaction. Small fixes skip this.
3. **Implement** in small, independently-testable task commits, each with
   its tests, each green before the next. Commit messages explain WHY —
   they are load-bearing documentation.
4. **Two-reviewer gate** (§5). Full gate for waves; slim gate (single
   adversarial reviewer) for hotfixes/minor batches. **Escalation rule:
   anything that can lose or corrupt user data gets the FULL gate, never
   slim** — brief the adversarial seat to actively destroy the data,
   demand runnable repros, and mutation-test the fixes (prove the test
   fails when the fix is reverted).
5. **Fix round.** Apply EVERY finding — including non-blocking ones when
   cheap ("worth a spot in the next round" usually means "do it now").
   Then **delta re-confirm**: message the SAME reviewer agents describing
   each fix against their findings; they verify the diff and give a delta
   verdict. Repeat until both APPROVE.
6. **Verification matrix.** Full test suite on every supported runtime
   version (e.g. `{{RUNTIME_MATRIX}}` — for FileTube, Node 22 + 24).
   Known flakes are documented, not chased silently.
7. **Release ceremony** (adapt to the repo's `{{RELEASE_PROCESS}}`):
   version bump → honest changelog/ROADMAP entry (include what the gate
   caught and any known gaps) → move the exec plan to `completed/` →
   release branch → no-ff merge to main → tag → push. Production
   deploy/publish belongs to the human.
8. **Memory + report.** Persist a shipped record with the lessons
   (§7), then report: outcome first, what the gate caught, then a
   concrete **verification probe list** the human can run in their
   environment. Their pass is the final arbiter of "done."

## 5. The two-reviewer gate (the heart)

Spawn TWO independent review subagents against the branch diff:

**QA seat.** Reviews for correctness, security, performance, regressions,
standards compliance, test quality (no tautological tests), and comment
accuracy. Reports findings as CRITICAL / WARNING / SUGGESTION with
file:line references and an overall verdict: APPROVE / REQUEST CHANGES.

**Adversarial seat.** Prompted explicitly to assume the implementer and
QA both missed something. The brief must:

- Name the attack surfaces the implementer knows about — this frees the
  reviewer to hunt the ones nobody named.
- Demand **verification against primary sources** — read the third-party
  library/tool's actual source code; never accept "the docs say."
- Require a **concrete failure scenario** per finding (inputs/state →
  wrong outcome), not vibes.
- For data-touching changes: try to construct inputs that destroy data
  while the suite stays green.

**Protocol.** Both must APPROVE before release. Score findings honestly —
never rationalize a real regression as a "one-time cost." When a reviewer
prescribes a fix, prefer their prescription; when deviating, say why in
the delta message — and verify their prescriptions too (reviewers can be
wrong in ways that regress other cases). Delta re-confirm goes to the
same agents (preserved context), not fresh ones.

## 6. Honesty norms (non-negotiable)

- Test failures reported verbatim, with counts, before any framing.
- A regression is a regression even when inconvenient.
- Known gaps ship DISCLOSED (changelog + report), never silently.
- Accepted residuals go in `docs/exec-plans/tech-debt-tracker.md` with a
  revisit trigger; every reviewer non-blocking note is fixed or filed.
- Skipped steps (a gate, a runtime version) are named in release notes.
- The report to the human distinguishes "verified" from "should work."

## 7. Durable state (what survives between sessions)

| Artifact | Purpose |
| -------- | ------- |
| `CLAUDE.md` | Operating contract: methodology summary + project config |
| Persistent memory (or `docs/` equivalent) | Shipped records with LESSONS, active-work briefs, environment quirks |
| `docs/exec-plans/active|completed|future/` | Wave designs; the reviewers' spec |
| `docs/exec-plans/tech-debt-tracker.md` | Numbered accepted residuals + revisit triggers |
| `ROADMAP.md` (or CHANGELOG) | Honest shipped-log incl. what the gate caught |
| `docs/ARCHITECTURE.md`, `docs/CONTRIBUTING.md` | System context + standards the reviewers enforce |

Memory discipline: condense in-flight briefs into one shipped record per
release, lead with the lesson (the expensive mistake class, stated
generally), and delete what turned out wrong. Convert relative dates to
absolute.

## 8. What to install in a new repo

Minimum viable lean-mode install (the handoff-harness v2 shape):

1. **`CLAUDE.md`** from a template: methodology summary (§4–§6 condensed),
   `{{PROJECT_CONFIG}}` placeholders (build/test/lint/run commands,
   runtime matrix), environment quirks.
2. **Two reviewer agent definitions** (`.claude/agents/`):
   `quality-assurance.md` (QA seat) and `adversarial-reviewer.md`
   (refutation seat, primary-source mandate baked in).
3. **Session-start hook**: inject branch/dirty state, active exec plans,
   tech-debt count. Nothing that can go stale silently.
4. **Docs skeleton**: `docs/exec-plans/{active,completed,future}/`,
   `tech-debt-tracker.md`, `ARCHITECTURE.md` + `CONTRIBUTING.md`
   placeholders, `ROADMAP.md` with a Shipped section.
5. **Commit-quality hooks** (pre-commit lint/test where the stack allows)
   and optional `/commit-only`, `/commit-and-push` commands.
6. **Seed flow**: one-shot auto-detect of stack/commands to fill
   placeholders (the v1 `/seed` design remains sound).

What NOT to install: lifecycle state files, stage-routing commands, role
agents for implementation. If they exist from a v1 install, archive them
(see `legacy-agent-pipeline.md` for how FileTube did it).

## 9. Calibration knobs (per repo / per human)

- **Gate depth:** full vs slim threshold; data-loss surfaces always full.
- **Autonomy level:** FileTube runs full-autonomous with overnight
  pre-authorization; a new repo may start with per-wave approval until
  trust is earned.
- **Verification matrix:** which runtimes/targets must be green.
- **Release ceremony:** map §4.7 onto the repo's actual process.
- **The human's arbiter step:** define what "verified in my environment"
  means for this project (on-device pass, staging deploy, etc.).
