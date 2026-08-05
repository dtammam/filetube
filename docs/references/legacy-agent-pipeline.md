# Legacy: the handoff-harness agent pipeline (retired ~v1.26)

This repo was seeded with the multi-agent SDLC pipeline from
[handoff-harness](https://github.com/dtammam/handoff-harness). Dean retired
it in favor of lean mode (see `CLAUDE.md`). **The installed `.claude/` pipeline files
(five role agents; the `/kickoff`, `/prep-*`, `/run-*`, `/seed`,
`/show-me` commands) were DELETED in the 2026-08-01 harness cleanup** -
this file is now the ONLY record of what they were. **Nothing here is an
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
coordination); its header marked it HUMAN-MAINTAINED — no agent may
modify it — so its retirement was reserved for Dean. **He ruled
"Delete" on 2026-08-01 and it was removed in the v1.62.0 ratchet wave**;
this paragraph is its record.

## Other v1 remnants — final disposition (2026-08-01 harness cleanup)

Nothing of the v1 install remains on disk except this archive and the
still-used survivors. For the record (past tense - the gate caught this
section describing deleted files in the present tense, the repo's own
lying-doc class, in the very commit that deleted them):

- `scripts/run-*.sh` (five specialist launchers) — DELETED. They had
  read `.state/inbox/*` and failed closed since `.state/` was removed.
- `setup.sh` — SURVIVES, modernized: it keeps the load-bearing
  `core.hooksPath` wiring and chmod passes; the `.state/*` expected-dirs
  checks and the `/seed` epilogue were removed. Do not recreate
  `.state/`.
- `.harness/manifest.json` — DELETED in the same cleanup. It was the v1
  install manifest and listed all the deleted agents/commands/scripts
  (and `.state/**/.gitkeep`) as harness-owned; with nothing reading it
  and 27 of its entries pointing at files removed by this cleanup alone
  (31 counting the `.state/**/.gitkeep` entries retired back at
  v1.41.19), it was stale beyond regeneration.
- The five retired agent definitions and seventeen retired commands
  under `.claude/` (which had carried `LEGACY` markers since v1.41.19)
  — DELETED. This document is their only record.
