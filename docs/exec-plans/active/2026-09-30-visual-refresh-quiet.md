---
plan: visual-refresh-quiet
harness: v2 · lean
branch: ci/visual-refresh-quiet
anchor: outcome
status: Building
design: Approved 2026-09-30 (Dean, Q&A: bot PR auto-merged; drop the main diff and reuse the PR shots)
gate: adversary + security-brief (the bot now merges to main with the workflow token)
---

# Visual: quiet on main, baselines that actually refresh

## Diagnosis (measured 2026-09-30)

The last 5 red `Visual` runs on `main` (36780658161, 36751900908, 36715187067, 36713086585,
36676816303) all failed in ONE job, `baseline-refresh`, with
`pull request create failed: GraphQL: GitHub Actions is not permitted to create or approve pull
requests (createPullRequest)`. Every diff leg passed. The repo setting was off
(`can_approve_pull_request_reviews: false`), so no refresh has landed since a5c9c24e (v1.344.1): PR
#61's comment listed 88 changed scenes, most of them drift from earlier releases. Each release ran
36 container legs (~10 min each): 12 on the PR, then 12 `visual` + 12 `rebaseline` on `main`.

## Outcome

1. A merge to `main` is no longer red for a look change; red means a crashed capture or a failed refresh.
2. The baselines follow `main` with no step from Dean (the bot opens AND merges a baselines-only PR).
3. A release runs 12 visual legs, not 36: no diff on the push to `main`, and the refresh reuses the
   PR run's shots when that run shot the exact merged tree (all 12 legs uploaded), else re-shoots.

## Changes

- `.github/workflows/visual.yml`: `visual` on `pull_request` only; new `refresh-source` (read-only,
  push to main, skipped for a baselines merge); `rebaseline` needs it and runs on main only without a
  reusable run; `baseline-refresh` downloads either set, serialized by a concurrency group, and merges
  its own PR after the existing baselines-only path check.
- `test/unit/visual-workflow.test.js` binds all of the above.
- `docs/RELEASING.md`, `AGENTS.md`, `docs/LESSONS.md` (section 13), the PR comment wording.
- Repo setting `can_approve_pull_request_reviews` turned on (via `gh api`) before the merge.

## Reachability evidence

Dry run of the `refresh-source` script against the real v1.348.0 merge e15e645e: `behind=0`, trees
equal, PR run 36779173824 found with 12 `visual-shots-*` artifacts. The first live run is this
branch's own merge; it should refresh the stale baselines and merge the baselines PR.

## Attack surfaces for the gate

- The bot merges to `main`: can anything but PNGs under `test/visual/baselines/` reach that merge?
- Reuse correctness: can a reused set be partial, from another tree, or from a run that did not pass?
- Job graph: `needs` + `if` on skipped/failed upstream jobs (dispatch, `rebaseline/*`, a baselines
  merge, a `refresh-source` failure); can a refresh loop or silently do nothing?
- The fork case: a fork PR's run uploads artifacts from fork-controlled workflow code.

## Gate

(verdicts below, bound to the sha reviewed)
