# CLAUDE.md

FileTube is a self-hosted media server resembling old-school YouTube. It is a
Node.js/Express monolith that scans local media folders, extracts durations and
thumbnails via FFmpeg, and streams video/audio to a retro YouTube-style web UI —
with on-demand transcoding of browser-incompatible containers (e.g. AVI) to MP4.

This file is the Claude Code entry point for this repo. It codifies the
working method that has shipped every release since ~v1.26 ("lean mode").
The multi-agent pipeline this repo was originally seeded with is **legacy**
— see the Legacy section at the bottom. Do not follow it.

## How we work: lean mode

You (the main session) run the entire software lifecycle directly —
design, implement, test, release. There are no role hand-offs. Subagents
are used for exactly two things: **independent review** (the two-reviewer
gate) and optional **design exploration** on big waves.

Dean's trust rests on two pillars, and neither is ever traded for speed:

1. **The two-reviewer gate** — your work is never merged on your own say-so.
2. **Ruthless honesty** — failures reported verbatim, regressions scored as
   regressions, known gaps disclosed in release notes.

### Lifecycle of a wave

1. **Intake.** For anything non-trivial, ask Dean your questions first —
   numbered, each with your recommendation inline so he can reply "agree"
   or override per number.
2. **Design (big waves only).** Produce a written exec plan committed to
   `docs/exec-plans/active/<name>.md`. It doubles as the reviewers' spec
   and survives context compaction. Small fixes skip this.
3. **Implement** in small, independently-testable task commits, each with
   its tests, each green before the next. Commit messages explain the WHY.
4. **The two-reviewer gate** (below). Full gate for waves; a single
   adversarial "slim gate" for hotfixes/minor batches. **Anything that can
   lose data gets the full gate, never slim** — brief the adversarial seat
   to destroy the data, demand runnable repros and mutation-tested fixes.
5. **Fix round.** Apply every finding — including non-blocking ones when
   cheap. Then delta re-confirm with the SAME reviewer agents
   (SendMessage); repeat until both APPROVE.
6. **Dual-Node suites.** Full test run on BOTH Node versions before
   release (see Environment below).
7. **Release ceremony:** `npm version X.Y.Z --no-git-tag-version` →
   ROADMAP.md "Shipped" entry (honest: include what the gate caught and
   any known gaps) → move the exec plan to `completed/` → commit on
   `release/vX.Y.Z` → `git merge --no-ff` into main → `git tag vX.Y.Z` →
   push all three refs. **Docker publish is always Dean's.**
8. **Memory + report.** Update persistent memory (condense in-flight
   briefs into a shipped record with the lessons), then report: outcome
   first, what the gate caught, then Dean's **on-device probe list**. His
   device pass is the final arbiter of "done."

### The two-reviewer gate

Spawn TWO independent subagents against the branch diff:

- **QA seat** — the repo's `quality-assurance` agent type: correctness,
  security, regressions, standards, comment accuracy (stale comments are
  findings here).
- **Adversarial seat** — a `general-purpose` agent prompted to assume both
  the implementer AND QA missed something. Name the attack surfaces you
  know about, demand verification against primary sources (read the
  third-party source code, never accept "the docs say"), and require a
  concrete failure scenario per finding.

Both report CRITICAL/WARNING/SUGGESTION + APPROVE / REQUEST CHANGES; both
must APPROVE before release. Score findings honestly. When a reviewer
prescribes a fix, prefer their prescription; when you deviate, tell them
why in the delta message — and verify their prescriptions too.

Expect the gate to find real things in your work. That is it working,
not failing.

### Honesty norms (non-negotiable)

- Test failures are reported verbatim, with counts, before any framing.
- A regression is a regression even when inconvenient; say so plainly.
- Known gaps ship DISCLOSED (ROADMAP + report), never silently.
- Accepted residuals go in `docs/exec-plans/tech-debt-tracker.md` with a
  revisit trigger.
- If you skipped a step (gate, a Node version), the release notes say so.

### Where the rest lives

| What | Where |
| ---- | ----- |
| Narrative companion: communicating with Dean, repo-specific lessons | `docs/CLAUDE-WORKING-STYLE.md` |
| Current project state + hard-won lessons | Persistent memory (auto-loaded each session) |
| Portable, repo-agnostic spec of this methodology | `docs/references/lean-mode-methodology.md` |
| Active exec plans / tech debt | `docs/exec-plans/active/`, `docs/exec-plans/tech-debt-tracker.md` |
| System architecture / coding standards | `docs/ARCHITECTURE.md`, `docs/CONTRIBUTING.md` |
| Release/Docker tagging mechanics | `docs/RELEASING.md` |

## Environment

- Export the fnm Node PATH before EVERY npm/node/git-hook command (the
  pre-commit hook lints and needs it):
  `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`
- Dual-Node verification uses v22.23.1 and v24.14.0 (swap the version in
  the path above).

## Project configuration

- **Language/framework:** JavaScript (Node.js 22 LTS; `engines` ≥20) / Express 4
- **Build command:** `npm ci` (installs dependencies; no compile step — interpreted app)
- **Test command:** `npm test` (unit + integration via `node:test`); `npm run test:unit` for the fast subset
- **Lint command:** `npm run lint` (ESLint)
- **Format command:** None configured
- **Run command:** `npm start` (`node server.js`)
- Vendored client libs are allowed (`public/vendor/`, eslint-ignored);
  new SERVER runtime deps are not (ffmpeg + optional yt-dlp only).

## Legacy: the handoff-harness pipeline

This repo was seeded with the multi-agent SDLC pipeline from
[handoff-harness](https://github.com/dtammam/handoff-harness)
(engineering-manager → product-manager → principal-engineer → …, driven
by `/kickoff`, `/prep-*`, `/run-*` commands and `.state/` files). Dean
retired that ceremony in favor of lean mode around v1.26. **Do not route
work through the pipeline agents or commands, and do not read or write
`.state/` files.**

What survives from the install and is still in use:

- `.claude/agents/quality-assurance.md` — the gate's QA seat.
- `.claude/hooks/session-start.sh` — session context injection.
- `/commit-only`, `/commit-and-push` — quality-gated commit commands.

The full pipeline reference (agent roster, command tables, state schema)
is preserved in `docs/references/legacy-agent-pipeline.md`.
