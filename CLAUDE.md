# CLAUDE.md

FileTube is a self-hosted media server resembling old-school YouTube. It is a
Node.js/Express monolith that scans local media folders, extracts durations and
thumbnails via FFmpeg, and streams video/audio to a retro YouTube-style web UI -
with on-demand transcoding of browser-incompatible containers (e.g. AVI) to MP4.

This file is the Claude Code entry point for this repo. It codifies the
working method ("lean mode") that has shipped every release since ~v1.26.
The method is not advisory: every section here is the contract.

## How we work: lean mode

You (the main session) run the entire software lifecycle directly -
design, implement, test, release. There are no role hand-offs. Subagents
are used for exactly two things: **independent review** (the two-reviewer
gate, whose seats are codified agents in `.claude/agents/`) and optional
**design exploration** on big waves.

Dean's trust rests on two pillars, and neither is ever traded for speed:

1. **The two-reviewer gate** - your work is never merged on your own say-so.
2. **Ruthless honesty** - failures reported verbatim, regressions scored as
   regressions, known gaps disclosed in release notes.

### Lifecycle of a wave

1. **Intake.** For anything non-trivial, ask Dean your questions first -
   numbered, each with your recommendation inline so he can reply "agree"
   or override per number. Challenge the problem framing before
   solutioning (perception -> framing -> solutioning); no performative
   agreement.
2. **Design (big waves only).** Produce a written exec plan committed to
   `docs/exec-plans/active/<name>.md`. It doubles as the reviewers' spec
   and survives context compaction. Small fixes skip this. When the work
   is measurable (counts, deltas, sites), the plan's numbers must be
   MACHINE-DERIVED, never hand-enumerated, and stated as predictions the
   tools re-verify at every commit.
3. **Implement** in small, independently-testable task commits, each with
   its tests, each green before the next. Commit messages explain the WHY
   and record the MEASURED results (suite counts, tool output) - never
   projected ones.
4. **The two-reviewer gate** (below). Full gate for waves; a single
   adversarial "slim gate" for hotfixes/docs/minor batches. **Anything
   that can lose data gets the full gate, never slim** - brief the
   adversarial seat to destroy the data, demand runnable repros and
   mutation-tested fixes.
5. **Fix round.** Apply every finding - including non-blocking ones when
   cheap. Then delta re-confirm with the SAME reviewer agents
   (SendMessage); repeat until both APPROVE. Reviewers' prescriptions get
   verified too - theirs have been wrong before.
6. **Dual-Node suites.** Full test run on BOTH Node versions before
   release, SEQUENTIALLY, with reviewers idle (see Environment). Report
   counts verbatim. Node 24's reporter prints `ℹ`, not `#` - an empty
   grep is not green.
7. **Release ceremony:** `npm version X.Y.Z --no-git-tag-version` ->
   ROADMAP.md "Shipped" entry (honest: include what the gate caught and
   any known gaps) -> move the exec plan to `completed/` when its Stop
   closes -> commit on `release/vX.Y.Z` -> `git merge --no-ff` into main
   -> `git tag vX.Y.Z` -> push all refs. The tag push auto-publishes
   Docker (X.Y.Z + latest); **the Docker pull onto Dean's server is
   always Dean's.** Waves RELEASE with Dean's device pass PENDING and
   disclosed - never merged-but-unreleased.
8. **Memory + report.** Update persistent memory (condense in-flight
   briefs into a shipped record with the lessons), then report: outcome
   first, what the gate caught, then Dean's **on-device probe list**. His
   device pass is the final arbiter of "done."

### The two-reviewer gate

The seats are CODIFIED agents - spawn them by type, never ad-hoc
general-purpose prompts:

- **QA seat** - the `quality-assurance` agent: correctness, security,
  regressions, standards, comment accuracy (stale/lying comments are
  findings). It has Bash and runs the instruments itself.
- **Adversarial seat** - the `adversarial-reviewer` agent: assumes both
  the implementer AND QA missed something; breaks claims by measurement,
  mutation-tests bindings, verifies prescriptions including its own,
  restores the tree byte-identical.

The per-wave brief still comes from you in the task prompt: branch,
commit range, spec docs, and - for the adversarial seat - the NAMED
attack surfaces you know about. The agent files carry the standing
discipline; the brief carries the wave. Both seats report
CRITICAL/WARNING/SUGGESTION + APPROVE / REQUEST CHANGES; both must
APPROVE before merge. Delta re-confirmation goes to the SAME agent
instances via SendMessage.

Slim gate = the adversarial seat alone, same rules.

Expect the gate to find real things in your work. That is it working,
not failing.

### Standing norms (non-negotiable)

- EVERY change - docs, hotfixes, fix rounds, harness tweaks - goes
  branch -> gate -> `merge --no-ff` -> push. No direct-to-main commits,
  no exceptions for size.
- Test failures are reported verbatim, with counts, before any framing.
- A regression is a regression even when inconvenient; say so plainly.
- Known gaps ship DISCLOSED (ROADMAP + report), never silently.
- Accepted residuals go in `docs/exec-plans/tech-debt-tracker.md` with a
  revisit trigger.
- If you skipped a step (gate, a Node version), the release notes say so.
- Never run release-qualifying suites while a reviewer works the tree,
  and never switch branches under an active reviewer.
- Mutation-test against a COMMIT, never the dirty tree.
- Verify every commit landed (`git log`) - the pre-commit hook runs the
  full unit suite and REFUSES red; a refused commit swallowed by a piped
  command is the known "phantom commit" failure mode.

### Where the rest lives

| What | Where |
| ---- | ----- |
| Narrative companion: communicating with Dean, repo-specific lessons | `docs/CLAUDE-WORKING-STYLE.md` |
| Current project state + hard-won lessons | Persistent memory (auto-loaded each session) |
| Portable, repo-agnostic spec of this methodology | `docs/references/lean-mode-methodology.md` |
| Active exec plans / tech debt | `docs/exec-plans/active/`, `docs/exec-plans/tech-debt-tracker.md` |
| System architecture / coding standards (incl. the MANDATORY design-token rules) | `docs/ARCHITECTURE.md`, `docs/CONTRIBUTING.md` |
| Release/Docker tagging mechanics | `docs/RELEASING.md` |
| The retired 2025 multi-agent pipeline this repo was seeded with (archive only - never route work through it) | `docs/references/legacy-agent-pipeline.md` |

## Environment

- Export the fnm Node PATH before EVERY npm/node/git-hook command (the
  pre-commit hook lints + runs the unit suite and needs it):
  `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`
- Dual-Node verification uses v22.23.1 and v24.14.0 (swap the version in
  the path above). Sequential, never parallel with anything.

## Project configuration

- **Language/framework:** JavaScript (Node.js 22 LTS; `engines` >=20) / Express 4
- **Build command:** `npm ci` (installs dependencies; no compile step - interpreted app)
- **Test command:** `npm test` (unit + integration via `node:test`); `npm run test:unit` for the fast subset
- **Lint command:** `npm run lint` (ESLint); `npm run lint:css` (the design-token census); `npm run ledger:check` (census ledger binding)
- **Format command:** None configured
- **Run command:** `npm start` (`node server.js`)
- Vendored client libs are allowed (`public/vendor/`, eslint-ignored);
  new SERVER runtime deps are not (ffmpeg + optional yt-dlp only).
