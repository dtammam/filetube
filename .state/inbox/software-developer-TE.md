# SDE Task TE — FR-4: Era-theme light-mode contrast token-value audit (Wave 3)

Feature: **v1.22.0 "Player Parity + Roadmap"** — branch `feature/v1.22-player-parity`.
Exec plan (READ `## Design (FR-2..FR-10)` → the `### FR-4` subsection): `docs/exec-plans/active/2026-07-08-v1.22-player-parity.md`.
Standards: `docs/CONTRIBUTING.md`.

**Wave 3** — runs in PARALLEL with TD (FR-3, watch.html/watch.js only). You touch
ONLY `public/css/style.css` — disjoint from TD. Do not start until the coordinator
confirms Wave 2 integrated.

## Context
Some elements (the "Subscribed" neutral button explicitly called out by Dean,
possibly others) render grey-on-white / low-contrast in LIGHT mode under certain
era skins. Every relevant surface is ALREADY token-driven — this is a
**token-VALUE** fix, NOT a missing-token bug.

## Scope
The theme system is `[data-theme="2005|2009|2014|2021"][data-mode="light|dark"]`
blocks in `style.css`. For each era's `[data-mode="light"]` block, audit the
foreground/background pairings most likely to be grey-on-white:
- The neutral `.btn` state (`--btn-bg` light greys paired with `--text-primary`)
  — the "Subscribed" button drops `.btn-primary` for the neutral `.btn`.
- `--text-secondary` on the era's card/page background.
- Any per-era `.btn` override (e.g. the 2009 glossy `.btn`).

For each offending era×light combo, adjust the **token VALUE in that specific
block only** (darken `--text-secondary`, or lift/darken `--btn-bg`/its paired
text). NEVER a new hardcoded color. NEVER touch that token in dark mode or in a
non-flagged era's light mode (AC29/AC30). Keep it scoped to the offending tokens —
no broad restyle.

## Verification
No automated contrast tooling exists or is added (AC31). **Dean's on-device pass
across the affected era×light combos is the arbiter for the final values** — pick
reasonable AA-clearing values and report exactly which era×light tokens you changed
and from→to values so Dean can confirm.

## Acceptance criteria owned: AC28, AC29, AC30, AC31.

## Gate & reporting
- **Gate:** light single-QA + Dean on-device arbiter.
- Run Node 22 lint; fix failures. **Report:** files changed, a table of each
  era×light token changed (from → to) and the element it affects.

---
**Toolchain:** Node 22 at `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin` — prepend to PATH. Lint: `npm run lint`. Absolute paths.
**Git:** COORDINATOR owns ALL git. Do NOT commit. Report files-changed + lint output only.
