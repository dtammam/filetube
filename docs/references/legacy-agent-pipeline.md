# Legacy: the handoff-harness agent pipeline (retired ~v1.26)

This repo was seeded with the multi-agent SDLC pipeline from
[handoff-harness](https://github.com/dtammam/handoff-harness). Dean retired
it in favor of lean mode (see `CLAUDE.md` and
`docs/CLAUDE-WORKING-STYLE.md`); this file preserves the reference so the
installed `.claude/` files remain understandable. **Nothing here is an
instruction to a working session.**

## What the pipeline was

One orchestrator (engineering-manager) tracked lifecycle state in
`.state/feature-state.json` and routed work to specialist agents through
inbox files (`.state/inbox/<agent>.md`), one stage per invocation, with
explicit user approval at every stage transition:

```text
Bootstrap → Discovery → Design → Tasks → Implementation → Verification
→ (optional Review) → Acceptance → Done
```

## Agents (`.claude/agents/`)

| Agent | Role | Status today |
| ----- | ---- | ------------ |
| `engineering-manager` | Orchestrator | Unused |
| `product-manager` | Requirements & acceptance | Unused |
| `principal-engineer` | Technical design | Unused |
| `software-developer` | Implementation | Unused |
| `build-specialist` | Build & test runner | Unused |
| `quality-assurance` | Code review | **STILL USED** — the lean-mode gate's QA seat |

## Commands (`.claude/commands/`)

| Command | Purpose | Status today |
| ------- | ------- | ------------ |
| `/kickoff`, `/kickoff-complex` | Feature intake | Unused |
| `/prep-pm-discover`, `/prep-pe-design`, `/prep-em-tasks`, `/prep-sde-implement`, `/prep-build-verify`, `/prep-qa-review`, `/prep-pm-accept`, `/prep-em-done` | Stage routing | Unused |
| `/run-pm`, `/run-pe`, `/run-sde`, `/run-build`, `/run-qa` | Specialist invocation (mobile workflow) | Unused |
| `/show-me` | Pipeline status report | Unused |
| `/seed` | One-shot onboarding / placeholder filling | Unused (already seeded) |
| `/commit-only`, `/commit-and-push` | Quality-gated commits | **Still usable** |

## State files (`.state/`)

`feature-state.json` (lifecycle state) and `inbox/*.md` (per-agent
prompts) were the pipeline's coordination mechanism. They went stale when
the pipeline was retired and were removed from the repo at v1.41.19; the
history has them if archaeology is ever needed (last real entry: the
v1.31 hardening wave).

## Mobile workflow

Two Happy Coder sessions against the same working directory — a
persistent EM session issuing `/kickoff` + `/prep-*`, and an ephemeral
specialist session running `/run-*`. Superseded by lean mode's single
autonomous session.

## Docs the pipeline introduced (still maintained)

`docs/ARCHITECTURE.md`, `docs/CONTRIBUTING.md`, `docs/RELIABILITY.md`,
and the `docs/exec-plans/` structure (active/completed/future +
tech-debt-tracker) all predate lean mode but remain in active use — lean
mode kept the artifacts and dropped the ceremony.

`docs/AGENTS.md` is the exception: its content is pure pipeline
procedure (stage transitions, agent boundaries, state-file
coordination), but its header marks it HUMAN-MAINTAINED — no agent may
modify it. It awaits Dean's own edit or retirement; until then, treat it
as historical alongside this file.

## Other v1 remnants on disk (inert, kept for the record)

- `scripts/run-*.sh` — specialist launchers; they read `.state/inbox/*`
  and now fail closed (exit 1) since `.state/` was removed.
- `setup.sh` — the v1 install verifier; its expected-dirs check now
  reports `.state/*` as missing. Harmless; do not "fix" by recreating
  `.state/`.
- `.harness/manifest.json` — the v1 install manifest; still lists the
  deleted `.state/**/.gitkeep` files as harness-owned. A future harness
  update pass should regenerate it.
- The five retired agent definitions and seventeen retired commands
  under `.claude/` carry a `LEGACY` marker in their descriptions as of
  v1.41.19 so tool rosters can't route sessions into the dead pipeline.
