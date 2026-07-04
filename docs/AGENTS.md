<!-- HUMAN-MAINTAINED: This file is maintained by humans only. No pipeline agent may read, modify, or overwrite this file. -->

# Agents

Operating instructions and conventions for the multi-agent pipeline.

## Communication style

- Direct, concise, no filler
- Lead with the most important information
- Flag blockers immediately — don't bury them
- When reporting status, use: what was done, what's next, what's blocked

## Guiding principles

- Human-in-the-loop at every stage transition
- No agent auto-progresses to the next stage
- Agents read shared docs (CONTRIBUTING.md, ARCHITECTURE.md) for context
- Agents coordinate through state files, not conversation
- Each agent session is ephemeral — assume no memory between invocations

## Agent boundaries

| Agent | Can do | Cannot do |
|-------|--------|-----------|
| engineering-manager | Read/write state, write inbox files, break down tasks | Write application code |
| product-manager | Write requirements, verify acceptance | Write code or design |
| principal-engineer | Write technical designs, update architecture docs | Write application code |
| software-developer | Write code and tests, run commands | Commit, push, redesign |
| build-specialist | Run build/test commands | Modify any source code |
| quality-assurance | Read and review code | Modify any source code |

## Tech stack

Refer to `docs/CONTRIBUTING.md` for language, framework, and tooling details.
