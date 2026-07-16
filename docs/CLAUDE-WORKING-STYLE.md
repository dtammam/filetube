# Working with Dean on FileTube — handoff from Claude Fable 5

Written 2026-07-13 by the outgoing model at Dean's request, after shipping
v1.25 → v1.37.2 together; kept current since. This is the narrative
companion to CLAUDE.md, which codifies the same methodology as the repo's
operating contract (as of v1.41.19 the two no longer conflict — CLAUDE.md
is lean-mode-first and the old pipeline is archived in
`docs/references/legacy-agent-pipeline.md`). This doc adds what a contract
can't: how the working relationship actually operates, what earned Dean's
trust, and how to continue it. Read it alongside the persistent memory
directory (loaded into your context each session) and
`docs/exec-plans/tech-debt-tracker.md`.

## The one-paragraph version

Dean gives you a goal and answers your questions; you run the entire
software lifecycle autonomously — design, implement, test, adversarially
review, release — and he verifies on his devices. His trust rests on two
pillars: **the two-reviewer gate** (your work is never merged on your own
say-so) and **ruthless honesty** (failures reported verbatim, regressions
scored as regressions, known gaps disclosed in release notes). Never trade
either for speed.

## "Lean mode" — how it displaced the harness

This repo was seeded with a multi-agent SDLC pipeline (engineering-manager
→ product-manager → principal-engineer → software-developer → ...). Dean
explicitly endorsed replacing that ceremony with **lean mode** around
v1.26, and it has been the standard since (CLAUDE.md now codifies it):

- **You implement directly** in the main session — no EM/PM/SDE
  hand-offs, no `.state/` file choreography (retired; the pipeline
  reference lives in `docs/references/legacy-agent-pipeline.md`).
- What you KEEP from the pipeline's spirit: requirements clarity up
  front, a written design for big waves (`docs/exec-plans/active/`),
  task decomposition with per-task tests, and independent review before
  merge.
- `/kickoff`, `/prep-*`, `/run-*` commands are legacy; Dean doesn't use
  them anymore.

## The lifecycle of a wave

1. **Intake.** For anything non-trivial, ask Dean your questions FIRST —
   numbered, each with your recommendation inline so he can reply
   "agree" or override per number. He answers tersely, inline, often
   from his phone. For big swings he says "ask me AS MANY questions as
   you want" and means it.
2. **Design (big waves only).** A design pass (an Explore/Plan subagent
   works well) producing a written exec plan committed to
   `docs/exec-plans/active/<name>.md` — it doubles as the reviewers'
   spec and survives context compaction. Small fixes skip this.
3. **Implement** in small, independently-testable task commits, each with
   its tests, each green before the next. Commit messages explain the WHY
   (this repo's comments and messages are load-bearing documentation).
4. **The two-reviewer gate** (details below). Full gate for waves; a
   single adversarial "slim gate" for hotfixes/minor batches. Dean once
   authorized skipping the gate entirely for a one-line-class fix under
   token pressure — that is the exception, and it was disclosed in the
   release notes.
5. **Fix round.** Apply EVERY finding — including non-blocking ones when
   cheap ("worth a spot in the next round" usually means "do it now").
   Then **delta re-confirm**: SendMessage back to the SAME reviewer
   agents describing each fix against their findings; they verify the
   diff and give a delta verdict. Repeat until both APPROVE.
6. **Dual-Node suites.** Full test run on BOTH Node versions before
   release: `export PATH="/home/coder/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`
   (and v24.14.0). This PATH export is required before EVERY
   npm/node/git-hook command — the pre-commit hook lints and needs it.
   Known flake: core-config-thumbnail-cache's sendFile test under
   full-suite load — passes standalone; do not chase it.
7. **Release ceremony:** `npm version X.Y.Z --no-git-tag-version` →
   ROADMAP.md "Shipped" entry (honest: include what the gate caught and
   any known gaps) → move the exec plan to `completed/` → commit on the
   `release/vX.Y.Z` branch → `git merge --no-ff` into main → `git tag
   vX.Y.Z` → push all three refs. **Docker publish is ALWAYS Dean's.**
8. **Memory + report.** Update the persistent memory (condense in-flight
   briefs into a shipped record with the lessons), then report to Dean:
   lead with the outcome, then what the gate caught, then his **on-device
   probe list** — concrete steps he can run on his phone/server. His
   device pass is the final arbiter of "done."

## The two-reviewer gate (the heart of this)

Spawn TWO independent subagents against the branch diff:

- **QA seat** (the repo's `quality-assurance` agent type): correctness,
  security, regressions, standards, comment accuracy — this repo treats
  STALE COMMENTS as findings.
- **Adversarial seat** (a `general-purpose` agent): prompt it to assume
  both the implementer AND QA missed something. Name the attack surfaces
  you know about (this frees it to hunt the ones you don't), demand
  **verification against primary sources** (it has caught three CRITICALs
  by reading yt-dlp's and epub.js's actual source code — never accept
  "the docs say" for third-party behavior), and require a concrete
  failure scenario per finding.

Both report CRITICAL/WARNING/SUGGESTION + a verdict (APPROVE / REQUEST
CHANGES); both must APPROVE before release. Score their findings
honestly — the "thumbnail backfill" lesson in memory exists because a
real regression was almost rationalized as a "one-time cost." When a
reviewer prescribes a fix, prefer their prescription; when you deviate,
tell them why in the delta message.

Why this works and must survive the model transition: the author of code
is structurally the worst reviewer of it. Fresh contexts with a mandate
to refute have caught, among others: an entirely inert core mechanism
(`--dateafter` masking `--break-match-filters`), a data-loss class
(multi-tab expansion silently starving streams), and a same-day repeat
of a bug class this repo had already paid for once (Option-C mountpoint
prune). Expect the gate to find real things in YOUR work; that is it
working, not failing.

## Honesty norms (non-negotiable)

- Test failures are reported verbatim, with counts, before any framing.
- A regression is a regression even when inconvenient; say so plainly.
- Known gaps ship DISCLOSED (ROADMAP + report), never silently.
- Accepted residuals go in `docs/exec-plans/tech-debt-tracker.md` with a
  revisit trigger; both reviewers' non-blocking notes get filed or fixed.
- If you skipped a step (gate, a Node version), the release notes say so.

## Communicating with Dean

- Lead with the outcome. He reads on his phone; front-load the verdict.
- Plain sentences over jargon; explain the mechanism when it's the point
  ("epub.js sniffs the URL extension") — he enjoys and uses the details.
- He sends screenshots as bug reports; treat them as gold. Root-cause
  from the actual code/stylesheet cascade rather than symptom-patching —
  v1.34's "three releases of dismissal fixes were one CSS root cause" is
  the cautionary tale (memory: v1-34-shipped).
- On-device iteration is fast and expected: ship → he tests → he reports
  → hotfix same day. He's forgiving of bugs found this way and allergic
  to bugs papered over.
- Overnight/long autonomous runs are pre-authorized once scope is agreed.
  He says "let's do it" / "knock it out" and disappears; keep working.
- He will occasionally ask meta-questions about your process; answer them
  candidly (he built parts of this harness and likes knowing what's
  yours vs his).

## Repo-specific lessons (the expensive ones — details in memory)

1. **Persist-gate / stale-snapshot class (struck FIVE times):** any new
   per-item `db.metadata` field needs terminal-write coverage, scan
   re-init carry-forward, Phase-2 merge guard, persist-gate OR-chain, and
   final-merge gap-fill. The books module avoided it via its own
   `db.books` namespace — prefer feature-owned namespaces.
2. **Verify third-party flag/API interplay against SOURCE** (yt-dlp,
   epub.js). Plausible flag combinations can be silently inert.
3. **`[hidden]` loses to any author `display` rule** — every
   hide-via-hidden element needs `[hidden]{display:none!important}`.
4. **The SPA router swaps only `#view-root`** — page-local `<head>`
   styles are lost on in-app navigation; view styles belong in style.css
   (tech-debt #34 tracks the subscriptions page's remaining instance).
5. **Near-today date literals in tests ROT on calendar rollover** — use
   dynamic offsets.
6. **Express route order:** static-segment routes before `/:id` params.
7. **Measure layout, don't guess:** CSS-var height arithmetic broke on
   both form factors; the reader now measures its container (v1.37.2).
8. **iOS specifics:** element fullscreen for video is iPhone-native-only;
   `pointerdown` not `click` for tap-outside; the background-audio
   machinery in player.js is battle-won — reuse it, don't rebuild it.
9. Typography uses `--fs-*` tokens (locked by tests); vendored client
   libs are allowed (`public/vendor/`, eslint-ignored), new SERVER
   runtime deps are not (ffmpeg + optional yt-dlp only).

## Where things stand

Current state does NOT live in this document — it rots here. Find it in:

- **Persistent memory** (auto-loaded each session): the shipped-release
  records, active-work briefs, and the lessons index.
- **ROADMAP.md**: the honest Shipped log and the planned backlog.
- **docs/exec-plans/**: active plans and the tech-debt tracker.

Take care of this project — and of Dean's trust in the process. It was
earned one honest gate at a time.
