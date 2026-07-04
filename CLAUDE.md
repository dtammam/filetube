# CLAUDE.md

FileTube is a self-hosted media server resembling old-school YouTube. It is a
Node.js/Express monolith that scans local media folders, extracts durations and
thumbnails via FFmpeg, and streams video/audio to a retro YouTube-style web UI —
with on-demand transcoding of browser-incompatible containers (e.g. AVI) to MP4.

This file is the Claude Code entry point for this repo.

## Agent architecture

This repo uses a multi-agent SDLC pipeline. Do NOT try to handle the full
lifecycle in a single session. Delegate to specialist agents.

## What YOU (the main session) do

You are NOT any of the agents listed below. You are the user's interface.
Your only job is to:
1. Receive the user's request
2. Invoke the engineering-manager agent via the Agent tool
3. Relay results back to the user
4. Pass the user's approval/feedback back to the engineering-manager

Do NOT roleplay as the engineering-manager. Do NOT directly invoke
product-manager, principal-engineer, software-developer, or any other
agent. Always go through engineering-manager.

If you catch yourself coordinating the pipeline, reading state files,
or delegating to specialist agents directly — STOP. You are doing the
engineering-manager's job. Invoke it instead.

### Agents (`.claude/agents/`)

| Agent | Role | When |
|-------|------|------|
| `engineering-manager` | Orchestrator | Any feature/bug/refactor — start here |
| `product-manager` | Requirements & acceptance | Discovery and Acceptance stages |
| `principal-engineer` | Technical design | Design stage |
| `software-developer` | Implementation | Implementation stage (per task) |
| `build-specialist` | Build & test runner | After each implementation task |
| `quality-assurance` | Code review | Optional, before acceptance |

### Commands (`.claude/commands/`)

| Command | Purpose |
|---------|---------|
| `/kickoff` | Simple intake for single-domain changes |
| `/kickoff-complex` | Plan-gated intake for multi-domain/risky changes |
| `/commit-only` | Stage and commit with quality gates |
| `/commit-and-push` | Stage, commit, push with quality gates |
| `/run-pm` | Invoke product-manager (mobile workflow) |
| `/run-pe` | Invoke principal-engineer (mobile workflow) |
| `/run-sde` | Invoke software-developer (mobile workflow) |
| `/run-build` | Invoke build-specialist (mobile workflow) |
| `/run-qa` | Invoke quality-assurance (mobile workflow) |
| `/show-me` | Read-only pipeline status report |
| `/seed` | One-shot project onboarding and placeholder filling |
| `/prep-pm-discover` | Prep Discovery -- route to Product Manager |
| `/prep-pe-design` | Prep Design -- route to Principal Engineer |
| `/prep-em-tasks` | Prep Tasks -- EM breaks design into tasks |
| `/prep-sde-implement` | Prep Implementation -- route to Software Developer |
| `/prep-build-verify` | Prep Verification -- route to Build Specialist |
| `/prep-qa-review` | Prep Review -- route to Quality Assurance |
| `/prep-pm-accept` | Prep Acceptance -- route to Product Manager |
| `/prep-em-done` | Close feature -- commit, push, PR, optional release |

### Key files

| File | Purpose |
|------|---------|
| `.state/feature-state.json` | Lifecycle state (EM reads/writes) |
| `.state/inbox/*.md` | Agent inbox files (EM writes, specialists read) |
| `docs/ARCHITECTURE.md` | System architecture (generated during onboarding) |
| `docs/CONTRIBUTING.md` | Coding standards (all agents read) |
| `docs/exec-plans/active/*.md` | Active execution plans |
| `docs/exec-plans/tech-debt-tracker.md` | Technical debt tracking |

### Mobile workflow

Two Happy Coder sessions against the same working directory:
- **Session 1 (EM):** Persistent. Uses `/kickoff` and pipeline commands.
- **Session 2 (Specialists):** Ephemeral. Uses `/run-*` commands to invoke agents.

### Project-specific configuration

<!-- Fill these in after hydration -->
- **Language/framework:** JavaScript (Node.js ≥16) / Express 4
- **Build command:** `npm ci` (installs dependencies; no compile step — interpreted app)
- **Test command:** None configured yet (no test suite)
- **Lint command:** None configured
- **Format command:** None configured
- **Run command:** `npm start` (`node server.js`)
