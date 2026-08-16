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
   -> `git tag vX.Y.Z` -> push `main` + the tag. The tag push
   auto-publishes Docker (X.Y.Z + latest); **the Docker pull onto Dean's
   server is always Dean's.** Then BRANCH HYGIENE (Dean, 2026-08-14):
   once the tag is confirmed on the remote, DELETE the wave's
   feat/fix/release branches BOTH remote (`git push origin --delete`,
   only those actually pushed) and local (`git branch -d`, never `-D` -
   it refuses unmerged). Branches may live on origin DURING a wave
   (multi-PC access) but never after the merge; main + tags are the only
   permanent refs. Waves RELEASE with Dean's device pass PENDING and
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

Registry timing (observed 2026-08-01, in both directions): new or
edited agent definitions take effect for NEW spawns once the registry
refreshes (mid-session at the earliest, next session start at the
latest). A RUNNING instance's capabilities are NOT reliably predictable
across a refresh - one reviewer's tool grant changed mid-round to a set
matching neither its spawn state nor its definition's frontmatter - so
never assume what a running agent can do from either source: it should
re-verify its own capabilities, and you should not kill/respawn a
mid-gate reviewer (losing its delta context) just because its
definition changed. In the session that edits a definition, brief the
discipline inline if the type does not resolve yet.

The quality-gated commit commands `/commit-only` and `/commit-and-push`
(`.claude/commands/`) are the surviving harness commands and remain in
use.

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
- **Git hygiene.** NEVER blind-stage: no `git add -A`, `git add .`, or
  `git commit -a` (a `git add -A` once swept scratch files into a release
  commit). Stage EXPLICIT paths, run `git status --porcelain` first, and
  confirm the branch (`git branch --show-current`) before every commit -
  a reviewer's worktree churn has twice detached HEAD out from under a
  release (v1.80, v1.82). Never `git checkout --` a dirty tree blind
  (it once reverted uncommitted v1.78 work). A PreToolUse hook hard-blocks
  `git add -A`, but the discipline is yours.
- **Diagnosis discipline (device/platform bugs).** Do NOT ship a fix on a
  first-pass theory. State the hypothesis, name the observation that would
  FALSIFY it, and gather that evidence (a live repro, a log, an inspected
  param) BEFORE editing. If a shipped fix fails on Dean's device, the
  original diagnosis was WRONG - re-root-cause, never patch around it (the
  v1.68.1 rotation fix blamed fullscreen and failed on-device; the real
  causes were an `?id=` vs `?v=` param and, once, SMB not the app at all).

### Where the rest lives

| What | Where |
| ---- | ----- |
| Current project state + hard-won lessons | Persistent memory (auto-loaded each session) |
| Portable, repo-agnostic spec of this methodology | `docs/references/lean-mode-methodology.md` |
| Active exec plans / tech debt | `docs/exec-plans/active/`, `docs/exec-plans/tech-debt-tracker.md` |
| System architecture / coding standards (incl. the MANDATORY design-token rules) | `docs/ARCHITECTURE.md`, `docs/CONTRIBUTING.md` |
| Architecture diagrams (module map, data model, flows - checker-bound) | `docs/DIAGRAMS.md` |
| Release/Docker tagging mechanics | `docs/RELEASING.md` |
| Reliability/operational hardening reference | `docs/RELIABILITY.md` |
| The retired 2025 multi-agent pipeline this repo was seeded with (archive only - never route work through it) | `docs/references/legacy-agent-pipeline.md` |

## Working with Dean (the narrative companion)

The sections above are the CONTRACT (the mechanics of a wave). This section is
how the working relationship actually operates - inlined here (formerly a
separate working-style doc, now folded in) so this file is self-contained.

**The one-paragraph version.** Dean gives you a goal and answers your questions;
you run the entire software lifecycle autonomously - design, implement, test,
adversarially review, release - and he verifies on his devices. His trust rests
on two pillars: the **two-reviewer gate** (your work is never merged on your own
say-so) and **ruthless honesty** (failures reported verbatim, regressions scored
as regressions, known gaps disclosed in release notes). Never trade either for
speed.

**Communicating with Dean.**
- Lead with the outcome. He reads on his phone; front-load the verdict.
- Plain sentences over jargon; explain the mechanism when it's the point ("epub.js
  sniffs the URL extension") - he enjoys and uses the details.
- He sends screenshots as bug reports; treat them as gold. Root-cause from the
  actual code/stylesheet cascade rather than symptom-patching - v1.34's "three
  releases of dismissal fixes were one CSS root cause" is the cautionary tale.
- On-device iteration is fast and expected: ship -> he tests -> he reports ->
  hotfix same day. He's forgiving of bugs found this way and allergic to bugs
  papered over.
- Overnight / long autonomous runs are pre-authorized once scope is agreed. He
  says "let's do it" / "knock it out" and disappears; keep working.
- He answers intake tersely, inline, often from his phone; for big swings he says
  "ask me AS MANY questions as you want" and means it.
- He'll occasionally ask meta-questions about your process; answer candidly (he
  built parts of this harness and likes knowing what's yours vs his).

**Why the gate works and must survive the model transition.** The author of code
is structurally the worst reviewer of it. Fresh contexts with a mandate to refute
have caught an entirely inert core mechanism (`--dateafter` masking
`--break-match-filters`), a data-loss class (multi-tab expansion silently starving
streams), and a same-day repeat of a bug class this repo had already paid for.
Expect the gate to find real things in YOUR work; that is it working, not failing.
When a reviewer prescribes a fix, prefer their prescription; when you deviate,
tell them why in the delta message - and verify what a prescription REMOVES, not
just what it claims (reviewers are wrong too).

**Repo-specific lessons (the expensive ones - details in memory).**
1. **Persist-gate / stale-snapshot class (struck 5+ times):** any new per-item
   `db.metadata` field needs terminal-write coverage, scan re-init carry-forward,
   Phase-2 merge guard, persist-gate OR-chain, and final-merge gap-fill. Prefer
   feature-OWNED namespaces (the books/music/podcasts modules avoided it).
2. **Verify third-party flag/API interplay against SOURCE** (yt-dlp, epub.js) -
   plausible flag combinations can be silently inert.
3. **`[hidden]` loses to any author `display` rule** - every hide-via-hidden
   element needs `[hidden] { display: none !important }`.
4. **The SPA router swaps only `#view-root`** - page-local `<head>` styles are lost
   on in-app navigation; view styles belong in style.css.
5. **Near-today date literals in tests ROT on calendar rollover** - use dynamic
   offsets; fixtures from `\u` escapes, no raw control bytes in source.
6. **Express route order:** static-segment routes before `/:id` params.
7. **Measure layout, don't guess:** CSS-var height arithmetic broke on both form
   factors; measure the container.
8. **iOS specifics:** element fullscreen for video is iPhone-native-only;
   `pointerdown` not `click` for tap-outside; the background-audio machinery in
   player.js is battle-won - reuse it, don't rebuild it.
9. **Migrations are APPEND-ONLY once executed** (editing an executed block hangs
   the suite); `node:sqlite` truncates TEXT at NUL; schema bumps are additive.

## Environment

- Export the fnm Node PATH before EVERY npm/node/git-hook command (the
  pre-commit hook lints + runs the unit suite and needs it):
  `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`
- Dual-Node verification uses v22.23.1 and v24.14.0 (swap the version in
  the path above). Sequential, never parallel with anything.

## Project configuration

- **Language/framework:** JavaScript (Node.js 22 LTS; `engines` >=22.13.0 - node:sqlite needs it) / Express 4
- **Build command:** `npm ci` (installs dependencies; no compile step - interpreted app)
- **Test command:** `npm test` (unit + integration via `node:test`); `npm run test:unit` for the fast subset
- **Lint command:** `npm run lint` (ESLint); `npm run lint:css` (the design-token census); `npm run ledger:check` (census ledger binding)
- **Format command:** None configured
- **Run command:** `npm start` (`node server.js`)
- Vendored client libs are allowed (`public/vendor/`, eslint-ignored);
  new SERVER runtime deps are not (ffmpeg + optional yt-dlp only).
