---
plan: visual-refresh-quiet
harness: v2 · lean
branch: ci/visual-refresh-quiet
anchor: outcome
status: Gate passed
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

Gate: APPROVED r1 @c13116fb — security-brief

Security r1 findings (no CRITICAL, no WARNING). Gaps: no shell, so no `git diff`; I read visual.yml whole at the working tree (clean, on c13116fb per session status) and could not query repo settings or remote branches.
- NOTE-1 (LOW, fix recommended): `gh pr merge "$branch"` merges whatever head the branch has at merge time; the path check ran on the local commit. Only write-access actors can move the branch in that window, so no outside attacker. Fix: `gh pr merge "$branch" --merge --match-head-commit "$(git rev-parse HEAD)"`.
- NOTE-2 (MEDIUM suspicion, verify): docker-publish.yml has no `permissions:` block, so it gets the repo default token. If the default is write, turning on "create and approve PRs" lets code run by `npm ci`/`npm test` on main (dev deps, which Dependabot auto-merges at patch/minor) open AND merge its own non-workflow PR to main. Most of this path existed before (push to an open same-repo PR branch, then merge it), so the flip widens it only a little. Verify `default_workflow_permissions` is `read` in the same `gh api` call that flips the setting, or add `permissions: contents: read` to docker-publish.yml.
- NOTE-3 (LOW suspicion): refresh-source picks any successful pull_request run whose head_sha is HEAD^2, newest first. A fork can open its own PR at that public sha. Against main it runs the same tree, so no harm. Against another existing repo branch it runs a different merged tree, and the refresh could commit baselines from it: wrong pixels, no code. Fix: also require the run's pull_requests[] to include the merged PR number and base.ref == main.
- NOTE-4 (LOW): baselines are checked by path only, not by content. Any bytes named *.png can land. This is reachable only through code Dean already merged (the same trust the rebaseline path had before). Fix: check the PNG magic bytes and a size cap before `cp`.
- NOTE-5 (INFO): the close loop matches any open PR whose head is `chore/baselines-*`, so a same-repo PR with that name gets closed and its branch deleted. Fork heads are skipped by gh (not verified).
Checked and safe: in each `run:` block the `${{ }}` values are only matrix, run_id and env-routed (verified). head_commit.message is used only in an `if:`, where a crafted title can skip a refresh but cannot inject. baseline-refresh runs no repo code (no npm, no hooks, persist-credentials false). `git add -A -- test/visual/baselines` limits what gets staged. The job permissions are the minimum. download-artifact v4 (4.1.3 and later) rejects zip path traversal (should be safe, not re-read).

### Adversary r1 @c13116fb: FAIL (CHANGES)

1. WARNING: `rebaseline-merge` (plain `needs: rebaseline`, no `if`) is SKIPPED whenever `refresh-source` was skipped or failed: GitHub docs ("a failure or skip applies to all jobs in the dependency chain from the point of failure or skip onwards") and actions/runner#2205 (open, same shape). So workflow_dispatch and a push to `rebaseline/*` run 12 legs and publish NO `visual-baselines` (the RELEASING.md fallback is dead), and a `refresh-source` failure burns 12 legs for nothing. The test binds the bug (`merge.if === undefined`). Fix: `if: ${{ !cancelled() && needs.rebaseline.result == 'success' }}`, update the test and the "plain needs, no if" comments; prove it with one `rebaseline/*` push after merge.
2. WARNING: the ancestry check is presence-bound only: `behind=0` hardcoded, the compare reversed, or `.ahead_by` all stay 16/16 green. a5dfec5e is a real merge with equal trees and behind_by 1, so the tree check alone would reuse a wrong-tree run. Bind the exact compare line.
3. NOTE: surviving mutants also: no `set -euo pipefail` in refresh-source (fail-safe), no `github-token` on the reuse download (loud), `--limit 1`, no `persist-credentials: false`.
4. NOTE: the concurrency group serializes but does not order: merge X (re-shoot, ~10 min) then Y (reuse) lets X's refresh land after Y's (conflict and red, or a stale scene). Self-heals on the next merge.
5. NOTE (suspicion): the reuse matches a run by head sha only; a PR run against a non-main base (stacked or retargeted PR) shot merge(other base, head), not head.
6. NOTE: RELEASING.md "(on since 2026-09-30)" is false today (`can_approve_pull_request_reviews: false`, measured); flip before merge. The ruleset's `require_extra_approval_for_unattributed_changes: true` has unknown effect on a bot merge; `gh pr merge` is first reached live on this merge.
7. NOTE: AGENTS.md "the one bot merge this repo allows" contradicts dependabot-auto-merge.yml; docs/exec-plans/active/2026-09-29-next-waves.md:84 still says "It never merges itself".

Gate: CHANGES r1 @c13116fb - adversary

### Architect r1 response
- Adversary 1: `rebaseline-merge` gets `if: ${{ !cancelled() && needs.rebaseline.result == 'success' }}`, test and comments updated. Live proof owed: one `rebaseline/*` push after merge.
- Adversary 2: the exact compare line is bound, plus `github-token` on the reuse download (3).
- Security NOTE-1: `gh pr merge ... --match-head-commit "$(git rev-parse HEAD)"`, bound.
- Security NOTE-2: measured `default_workflow_permissions: read` (unchanged by the flip).
- Security NOTE-3 / Adversary 5: a run's `.pull_requests` is EMPTY once its PR merged (measured on runs 36779173824, 36750264978, 36712253603), so a base filter would disable reuse; instead the run's `head_repository.full_name` must be this repo (forks excluded). A same-repo PR into another base at the same head sha stays a known NOTE.
- Adversary 6: setting flipped 2026-09-30 (`can_approve_pull_request_reviews: true`, measured). Adversary 7: AGENTS.md claim removed; next-waves line marked superseded.
- Not taken: Adversary 4 (ordering, self-heals next merge), Security NOTE-4 (content check; same trust as the re-shoot path), NOTE-5.
- Live dry run of the r2 script: e15e645e reuses 36779173824; a5dfec5e and 3fa48a32 re-shoot.

### Adversary r2 @56e2124c: PASS

- 1 fixed as prescribed: the three mutants (no `if`, `!= 'skipped'`, bare `!cancelled()`) all go red. The live `rebaseline/*` proof is still owed after the merge.
- 2 fixed as prescribed: `behind=0`, the reversed compare and `.ahead_by` all go red. Dropping `github-token` now goes red too.
- New fork filter: dropping it, hardcoding `from`, or reading `.repository` instead all go red. Run live, the script still reuses 36779173824 (e15e645e) and 36750264978 (774d6901) and re-shoots a5dfec5e and 3fa48a32. With `gh` stubbed to return a fork or `null` head repo, it prints "not this repo" and reuses nothing. `--match-head-commit` exists in gh 2.101.0, and dropping it or pointing it at HEAD~1 goes red.
- Setting measured: `can_approve_pull_request_reviews: true`. Tests 16/16 pass, eslint exit 0.
- Accepted as disclosed: 4 (ordering self-heals), and 5 only for a same-repo PR into another base.

Gate: APPROVED r2 @56e2124c - adversary

### Security r2 @56e2124c
Gaps: still no shell. I re-read visual.yml at the working tree, which I did not confirm is 56e2124c. I have not seen the `git diff` output or the repo settings myself.
- NOTE-1 fixed as prescribed (line 395). `git rev-parse HEAD` runs after `git commit`, so it binds the merge to the checked bot commit.
- NOTE-3 fixed differently, and the change is acceptable. The head-repo filter (lines 237-238) drops fork runs, including a `null` head repo, which prints "null" and does not match. It also means fork-made artifacts can no longer reach the reuse download, which narrows NOTE-4. A `gh api` failure stops the job under `set -e`, and `rebaseline` then re-shoots, so a failure is safe. `${from}` is only echoed inside quotes, so nothing is injected. What remains: a PR from a branch in this repo, at the same head sha but into a different base. Only people with write access can make one, so this is accepted as a NOTE.
- NOTE-2 settled by the Architect's measurement (`default_workflow_permissions: read`), which I have not checked myself. A read default means docker-publish.yml gets a read-only token, so the flip does not widen its exposure.
- NOTE-4 and NOTE-5 not taken; accepted on the stated reasoning.
- New in the delta: the `rebaseline-merge` `if` changes no security surface, because its token is contents: read and it only merges this run's own artifacts. Nothing new found.

Gate: APPROVED r2 @56e2124c — security-brief
