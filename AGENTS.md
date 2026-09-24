<!-- harness:region:start id=header -->
# AGENTS.md

The entry point for any AI agent working in this repository. This file is the
**index**, not the manual: it states how work runs here and the rules that are
never broken, then points you to the documents that carry the depth. Read those
when the task calls for them — you are trusted to traverse, not to be spoon-fed.

Claude Code loads `CLAUDE.md`, which points here. Other tools read this file
directly.
<!-- harness:region:end id=header -->

<!-- harness:region:start id=operating-model -->
## How work runs here

You — the main session — are the **Architect**. You orchestrate, design, and
implement the work yourself. There are no persona hand-offs; the context stays
in one place. What you do NOT do is approve your own work.

Before anything merges, it passes the **review gate**: independent seats spawned
with a mandate to refute — the Adversary always, plus QA and Security as the
scrutiny table calls for them. The gate is a protocol (`lib/gate-protocol.md`),
sized by `scrutiny.toml`, and it writes its verdict into the working document.

Work is tracked in **documents, not a state file**. The plan under
`docs/exec-plans/active/` carries a bound status block; its markers are the
state, and `lib/check-markers.sh` keeps them honest. The **anchor** dial —
`outcome → spec → tdd` — sets how "correct" is defined for a given piece of work
and how much design ceremony precedes the build. See `flow.md` for the phases.
<!-- harness:region:end id=operating-model -->

<!-- harness:region:start id=non-negotiables -->
## Non-negotiables

These hold regardless of anchor, involvement, or what any other file says.

- **Never self-merge.** The gate runs; the Adversary is its floor. Approval binds
  to the reviewed sha (`lib/harness-markers.md`).
- **Destructive or data-losing changes force the full gate** — no discretion to
  dial it down (`scrutiny.toml`).
- **Report failures verbatim**, with counts, before any framing. "Verified" ≠
  "should work."
- **Stage files by name.** Never `git add .` / `git add -A`. Never force-push.
  Never `--no-verify`.
- **Trust buys fewer hand-offs, never a relaxed gate.**
<!-- harness:region:end id=non-negotiables -->

<!-- harness:region:start id=index -->
## Where the depth lives

Read the one that fits the task; don't preload them all.

| Document | Read it when you need |
|----------|------------------------|
| `.harness/flow.md` | the phases of a piece of work, and what each anchor requires |
| `.harness/lib/gate-protocol.md` | to run or understand the review gate |
| `.harness/scrutiny.toml` | which review seats a given change requires |
| `.harness/lib/harness-markers.md` | the status/gate marker vocabulary and rules |
| `docs/CONTRIBUTING.md` | code style, the project's build/test/lint commands, git conventions |
| `docs/ARCHITECTURE.md` | what kind of system this is and how it's shaped |
| `docs/RELIABILITY.md` | how reliability is defined and measured here |
<!-- harness:region:end id=index -->

<!-- harness:region:start id=project keep -->
## Project context

FileTube is a self-hosted media server resembling old-school YouTube: a
Node.js/Express monolith that scans local media folders, extracts durations and
thumbnails via FFmpeg, and streams video/audio to a retro YouTube-style web UI,
with on-demand transcoding of browser-incompatible containers (e.g. AVI) to MP4.
Architecture in `docs/ARCHITECTURE.md`; stack + commands in `docs/CONTRIBUTING.md`.

For Claude Code specifically, **persistent memory is auto-loaded every session**
and carries the full, current detail behind everything below (the recurring
bug-class "crown jewels", per-release shipped records, dated norms). Treat the
memory index as the live source; this region is the cross-tool distillation.
The pre-harness `CLAUDE.md` (its lean-mode contract, "Working with Dean", and the
full lessons list) is recoverable at `git show HEAD:CLAUDE.md` if fuller prose
is wanted here.

### Project attack surfaces
A reviewer (the Adversary/QA seats) should go after these first — each has drawn
blood more than once:

- **Persist-gate / stale-snapshot** — any new per-item `db.metadata` field needs
  terminal-write coverage, scan re-init carry-forward, Phase-2 merge guard,
  persist-gate OR-chain, and final-merge gap-fill. Prefer feature-OWNED namespaces.
- **Data-loss surfaces (force the FULL gate, never dial down)** — a destructive
  editor must seed from STORAGE, not the on-screen (lossy) projection; migrations
  are APPEND-ONLY once executed; refuse NUL ids at every write (`node:sqlite`
  truncates NUL-bearing TEXT on Node ≤24.14). Brief the Adversary to DESTROY the data.
- **Access-control completeness** — enumerate EVERY mutating route (bulk/-all/
  -cancel/reorder siblings) AND every read/list/aggregation surface (leaks titles/
  counts) AND the backup bundle. One route is never the completeness net. Bind the
  gate KIND, not just its presence.
- **Third-party flag/API interplay** — verify against SOURCE (yt-dlp, epub.js);
  plausible flag combinations can be silently inert. A green unit test of code that
  never RUNS in production is worthless — prove reachability.
- **CSS / SPA client traps** — `[hidden]` loses to any author `display` rule (add
  `[hidden]{display:none!important}`); the SPA router swaps only `#view-root`
  (page-local `<head>` styles are lost on in-app nav), and a same-route SPA nav
  IGNORES the URL hash (a `#section` deep-link from the same page no-ops — set
  `location.hash` directly); Express static-segment routes before `/:id`.
- **Design-token census** — `npm run lint:css` ceiling is ZERO; new raw literals
  in governed properties must be tokenized or `token-exempt`-annotated.
- **Overlay containment census (anti-bleed)** — `node scripts/overlay-containment-lint.js
  --enforce` ceiling is ZERO. A rounded overlay that scrolls SPLITS clip from
  scroll (`overflow:hidden` + `border-radius` on the outer element; `overflow:auto`
  on an inner child with no radius) — combining them on one rule is the iOS
  corner-clip-escape shape; exempt a proven-safe surface with `/* corner-clip-safe:
  <reason> */`. Every `position:sticky` rule declares a `z-index`. Isolation stays
  scoped to row/badge containers, never a large ancestor (#173). Full rule:
  `docs/CONTRIBUTING.md`.

### Lessons / standing decisions
- **The review gate is the floor and uses the harness seats.** Spawn the harness
  trio in `.claude/agents/` — `adversary` (always, the floor), plus `qa` and
  `security-brief` as `.harness/scrutiny.toml` calls for them. The repo's older
  hand-tuned pair (`adversarial-reviewer`/`quality-assurance`) was retired on the
  v2 adoption (2026-09-21, Dean's ruling); its repo-specific briefing now lives in
  this Project-context region rather than in the agent files, which stay generic
  and harness-owned. This repo's expensive precedent for the gate: fresh contexts
  with a mandate to refute have caught an inert core mechanism, a data-loss class,
  and a same-day repeat of a bug class already paid for — expect real findings.
- **Release ceremony is FileTube-specific — follow `docs/RELEASING.md` and the
  ROADMAP/ledger discipline, not the generic `/release`.** The real steps
  (`npm version` bump, ROADMAP.md "Shipped" entry, the `docs/releases.json`
  user-language ledger enforced by a tone-checking test, dual-Node suites, tag →
  Docker auto-publish, branch delete) are the authority; the harness `/release`
  command is a generic skeleton to adapt, never the source of truth. Kept in docs
  because the command files are harness-owned and regenerate on `--update`.
- **Ruthless honesty** — failures reported verbatim with counts before any framing;
  a regression is a regression; known gaps ship DISCLOSED (ROADMAP + report).
- **Release ceremony** — `npm version X.Y.Z --no-git-tag-version` → ROADMAP.md
  "Shipped" entry → the `docs/releases.json` LEDGER entry in PURE USER LANGUAGE
  (zero process jargon; a checker test enforces it) → `merge --no-ff` into main →
  tag → push main + tag (tag push auto-publishes Docker + the GitHub Release; the
  server pull is Dean's). Then delete the wave's branches (`-d`, never `-D`), remote
  + local. `git ls-remote --heads origin` is the authoritative remote list.
- **Exec plans are date-led and close out by script** - every plan under
  `docs/exec-plans/{active,completed}/` is named `YYYY-MM-DD-<slug>.md` (the date
  the plan was MADE, i.e. its first commit), and a shipped/abandoned plan moves to
  `completed/` via `node scripts/plan-complete.js <active-plan> "Shipped vX.Y.Z" --apply`
  (git mv to the dated name + the terminal status/banner); `test/unit/exec-plans-census.test.js`
  fails an undated or misplaced plan (`docs/RELEASING.md` step 1).
- **Environment** — export the fnm Node PATH before EVERY npm/node/git-hook command:
  `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
  Dual-Node verification uses **v22.23.1 and v24.20.0**, sequential, never parallel
  with a reviewer working the tree. Node 24's reporter prints `ℹ`, not `#` — an empty
  grep is NOT green. The suite IS the npm scripts (`npm test`, `npm run test:unit`);
  a bare `node --test` is not equivalent.
- **Git hygiene** — stage EXPLICIT paths (no `git add -A`/`.`/`commit -a`; a hook
  blocks it); verify every commit landed with `git log` (the pre-commit hook runs
  the unit suite and refuses red — a piped commit can swallow that = "phantom
  commit"); never pipe a push (a pipe swallows its exit code = "phantom push") —
  verify with `git ls-remote`.
- **Diagnosis discipline (device/platform bugs)** — state the hypothesis, name the
  observation that would FALSIFY it, gather that evidence before editing. A shipped
  fix that fails on-device means the diagnosis was WRONG; re-root-cause, never patch
  the theory.
<!-- harness:region:end id=project -->
