---
plan: precommit-docs-fast-path
harness: v2 · lean
branch: chore/precommit-docs-fast-path
anchor: outcome
status: Building
next: slim gate (adversary; hooks/** is harness-and-config), then merge ahead of the wave release v1.317.0
design: Approved 2026-09-24 (Dean: "Yes you can add. Let's knock this out faster." on the docs-only fast path proposal)
gate: pending
---

# Pre-commit docs-only fast path

## The ask

Dean (2026-09-24), after the music wave's gate rounds spent most of their wall clock in the
pre-commit hook: make the gate loop take fewer, faster swings. The proposal he approved: when
every staged path is Markdown under docs/, the pre-commit hook runs only the unit tests that
read docs/, not the whole unit suite. Code commits keep the full hook; pre-push keeps the full
suite; no --no-verify anywhere.

## Measured cost (before)

- Every commit ran eslint, the token ratchet and the full unit suite: 6966 tests, 261 s on an
  idle box (the M3 verdict commit 07fe5eda), 10-15 minutes with three builders running.
- Per branch in this wave about 4 of 7 commits touch only a plan doc (r1 verdicts, fix record,
  r2 verdicts, close-out).
- The docs-reading selection is 38 of 481 unit files. A broader pattern (any `.md` mention)
  picked 89 files and ran 2171 tests in 146 s under load; the extra 51 files only mention
  CONTRIBUTING.md or README.md in comments, so the narrow pattern is the one shipped.

## Design

- scripts/precommit-docs-fast-path.js decides. It reads the STAGED paths with
  `git diff --cached --name-only --no-renames -z` (a rename is listed as its old AND new path, so
  a move of CODE INTO docs/ is not docs-only: with rename detection on, only the new docs path
  would be listed and a code deletion would look docs-only). Docs-only = non-empty and every path matches
  `^docs/.+\.md$`. It then greps test/unit/*.test.js each run (dynamic, never a hardcoded list)
  for a docs/ path, a quoted 'docs' path segment, or exec-plans.
- Exit 0 prints the tests; exit 1 = not docs-only; exit 2 = docs-only but no test found. The
  hook takes the fast path only on exit 0, so every failure mode falls through to the FULL
  checks (more testing, never less).
- hooks/pre-commit resolves the script BESIDE ITSELF (`$(dirname "$0")/../scripts/...`), because
  core.hooksPath points every worktree at the main checkout's hooks/ and an older branch may not
  carry the script; a missing script falls through to the full checks.
- Out of scope: pre-push (unchanged, full suite), CI (unchanged), root Markdown (ROADMAP.md is
  not under docs/ and keeps the full hook), docs/releases.json (JSON; its ledger test is not
  a docs/ reader by this pattern and must run on a release commit, which is never docs-only
  anyway since it carries package.json).

## Acceptance (binding tests in test/unit/precommit-docs-fast-path.test.js)

- AC1 classification: docs Markdown only = fast; any code path, root Markdown, JSON or SVG under
  docs/, an unanchored lookalike, or nothing staged = full. (isDocsOnly table + CLI exit 1 cases)
- AC2 a rename of code INTO docs/ (the direction --no-renames protects) and a rename out of
  docs/ both take the full hook. (the two CLI rename tests)
- AC3 the selection carries all 11 unit tests measured to read docs/ at runtime (gate r1 trace),
  skips an unrelated test, and is a small slice. (docsReadingTests on the real tree)
- AC4 zero docs-reading tests found = exit 2, never a silent zero-test pass. (CLI exit 2 test)
- AC5 the hook wiring: resolved beside the hook, guarded by the file check and the exit code,
  placed before the full checks, and the full checks remain (hook source lock); AND the REAL hook,
  run by a real `git commit` in a sandbox repo, refuses a docs-only commit whose docs-reading test
  fails (non-zero, HEAD unchanged) and lands a passing one (the end-to-end test).
- AC6 end to end: the real hook, run in this worktree with only a docs file staged, prints the
  fast-path line and passes; with a code file staged it runs the full checks. (recorded below)

## Build record

- Files: scripts/precommit-docs-fast-path.js (new), hooks/pre-commit (the fast-path block before
  the eslint step), test/unit/precommit-docs-fast-path.test.js (new, 8 tests).
- Targeted: precommit-docs-fast-path + ci-pipeline-locks + comment-debt-census
  `# tests 29 # pass 29 # fail 0`; eslint on the two new JS files exit 0.
- AC6 end to end (this worktree's hook run directly with ONLY this plan staged, 3 builders on
  the box): printed "docs-only commit: the docs-reading unit tests", `tests 1281 pass 1281
  fail 0`, "Pre-commit checks passed (docs-only).", exit 0, 3m00s wall. The code commit of this
  branch runs the full hook (the main checkout's hook is the old one until this merges).

## Incident during the build (disclosed)

The first commit attempt ran the full hook, which ran this branch's new test INSIDE a real
pre-commit, where git exports GIT_DIR / GIT_INDEX_FILE for the repo being committed. The CLI
tests' throwaway-repo git calls inherited them and operated on the REAL repo: the fixture
`seed` commit landed on this branch (1eafa3a4), fixture paths were staged in this worktree's
index, and `git init` flipped the shared repo config's core.bare to true (every checkout's git
refused work-tree operations until it was reset). The two CLI tests that read the staged set
failed (`tests 6977 pass 6975 fail 2`), so the hook refused the commit.
Repair: core.bare reset to false in the main repo config (git status verified in the main
checkout and the sibling worktrees); this branch's ref moved back to 660d4f5b with a mixed reset
(working files kept); no other ref was touched (the seed commit was only ever on this branch).
Fix: every child process in the test runs with an env stripped of EVERY GIT_* variable, and each
sandbox asserts its git dir is its own before any write. Proof against a decoy repo exported as
GIT_DIR/GIT_INDEX_FILE (with and without GIT_WORK_TREE): fixed test `tests 8 pass 8 fail 0`,
decoy unchanged (1 commit, core.bare false, index a.txt); mutant with the sanitizer removed from
the sandbox git helper `tests 8 pass 2 fail 6`, decoy unchanged. CORRECTED at gate r1 (adversary
W3): that decoy was a plain repo; under the env a WORKTREE hook really gets (GIT_DIR = the
worktree's gitdir, GIT_INDEX_FILE, no GIT_WORK_TREE, GIT_CONFIG_PARAMETERS) the same mutant
flipped the decoy's core.bare before the post-init check fired, so that check only DETECTED
damage, and the seat measured 3 pass / 5 fail, not 2 / 6. See the r1 fix record for the real guard.
Lesson: a test that shells out to git must never inherit the hook's GIT_* env.

## Gate r1 - adversary (@94e4f023)

Measured in a clone and a `git archive 94e4f023` sandbox under /tmp, plus throwaway decoy repos; no mutant ever ran in this repo or inside a real hook here.

Verified (ran it, saw it):
- Claims: targeted precommit-docs-fast-path + ci-pipeline-locks + comment-debt-census `# tests 29 # pass 29 # fail 0`; eslint on the two new JS files exit 0; the fast-path selection is 39 files, `# tests 1281 # pass 1281 # fail 0`, 2m06s wall.
- Selection completeness by MEASUREMENT, not grep: the full unit suite run with an fs/child_process trace preload (NODE_OPTIONS, so spawned node CLIs too), `# tests 6977 # pass 6977 # fail 0`. 11 test files touch docs/ at runtime (audit-check, comment-debt-census, critter-manager, docs-diagrams-census, docs-link-census, docs-status-census, exec-plans-census, precommit-docs-fast-path, release-ledger, shimmer-tranche2, tech-debt-census); all 11 are in the 39. No unit test lists docs via git (the only whole-tree `git ls-files` calls filter `*.js`). eslint ignores `docs/**`; the token ratchet reads no docs file. Skipping both on a docs-only stage loses nothing.
- Staged-set fidelity in a decoy with the committed selector: `git commit <docs path>` with code staged uses a next-index lock and classifies docs-only (the commit is docs-only; the staged code stays staged); `-i` (index.lock, the same branch as `-a`) and a code pathspec exit 1; a conflicted merge's commit exits 1; a clean merge runs no pre-commit at all (unchanged). Rename docs->code, `git mv` code->docs, delete-code+add-docs all exit 1; a trailing-newline name exits 1; space+unicode docs names exit 0. The real hook in a decoy and in a decoy WORKTREE (core.hooksPath absolute, selector found beside it): a docs commit breaking a docs-reading test is REFUSED, a good one passes, a test file named with a space and umlaut runs, a code commit falls through to eslint.
- Fail-closed: `mapfile <<< ""` yields one empty element and `node --test ""` prints "Could not find ''" and exits 1 (unreachable anyway: zero tests exits 2). Selector mutants RED: drop `^` (7/1), drop `$` (7/1), drop `--cached` (6/2), drop `-z` (6/2), swap exit codes (4/4), drop `length > 0` (6/2), drop the zero-tests guard (7/1), READS_DOCS = exec-plans only (7/1), every->some (5/3).
- Incident fix: the committed test run with a decoy exported as GIT_DIR/GIT_INDEX_FILE (with and without GIT_WORK_TREE) AND with the exact env a pre-commit hook gets in a worktree leaves the decoy byte-identical (commits, core.bare false, index, config md5).

Findings:
- W1 WARNING (surviving mutant, the guard the plan names): removing `--no-renames` from stagedPaths stays `# pass 8 # fail 0`. The rename test drives docs->code, which exits 1 even WITH rename detection (the new path is code). The direction the flag actually guards is code->docs: with the mutant, git mv lib/x.js docs/x.md in a decoy lists only the docs path and exits 0 (fast path while deleting a code file); the committed selector exits 1. AC2 and the Design bullet describe the wrong direction. Fix: add the code->docs rename CLI case (identical content, so git pairs it) asserting exit 1; confirm the mutant goes red.
- W2 WARNING (presence-not-binding on the property that makes this safe): the AC5 hook lock matches substrings, so these hook mutants all stay `# pass 8 # fail 0`: `|| true` after the fast-path `node --test`, `exit 0` before it, `set +e` in the block, and a `:` prefix that no-ops the run. End to end in a decoy, the committed hook refuses a docs commit that breaks a docs-reading test; the `|| true` hook prints "Pre-commit checks passed (docs-only)." and the commit lands. AC6 is a one-time manual record, not a binding. Fix: a behavioral test that runs the real hooks/pre-commit in a sandbox repo (sanitized env, a node_modules dir, the tmp-cleanup helper, one failing docs-reading test) and asserts non-zero exit + HEAD unchanged, plus the passing case exits 0; re-run the four mutants.
- W3 WARNING (divergent fixture in the disclosed incident proof; lying comment): the test comment says the sandbox proves its git dir is its own "before any write", and the plan says the sanitizer-removed mutant leaves the decoy unchanged. That holds only for a plain-repo decoy (GIT_DIR=<repo>/.git), which `git init` re-initializes without touching config. The env git actually exports to pre-commit in a WORKTREE (captured: GIT_DIR=<main>/.git/worktrees/<wt>, GIT_INDEX_FILE=<that>/index, no GIT_WORK_TREE, plus GIT_CONFIG_PARAMETERS) is the incident's shape: under it the same mutant flips the decoy's shared core.bare false->true (config md5 41e5bf16 -> b237deb5) and only THEN do 5 tests fail on the guard. The guard detects damage, it does not prevent it; CLEAN_ENV is the only real protection (and it holds). Also the plan's mutant count "pass 2 fail 6" did not reproduce: I measured `# pass 3 # fail 5` for that mutant. Fix: guard BEFORE the first git call (assert the env handed to every child has no GIT_* key, or pin GIT_DIR=<sandbox>/.git and GIT_WORK_TREE=<sandbox> explicitly in the sandbox env), correct the comment and the incident record, and re-prove with the worktree-shaped decoy.
- W4 WARNING (selection completeness only partly bound): dropping the quoted-segment alternative from READS_DOCS stays `# pass 8 # fail 0` yet loses docs-diagrams-census, a measured runtime reader of docs/ (dropping exec-plans loses no runtime reader). AC3 pins four censuses but not docs-diagrams-census. Scenario: a later "tighten the pattern" edit drops that branch, and a docs-only commit breaking docs/DIAGRAMS.md skips the census that reads it, suite green. Fix: pin every measured runtime reader above (at least docs-diagrams-census) in AC3; confirm the mutant goes red.
- S1 SUGGESTION (disclose): `git diff --cached` is against HEAD, so `--amend` with a docs-only stage takes the fast path while the amended commit carries HEAD's code (measured in a decoy). Safe when HEAD's code went through the full hook; not when it arrived hook-less (cherry-pick, rebase, clean merge), which used to get a full run on the amend. pre-push still runs everything. Add it to the out-of-scope list.
- S2 SUGGESTION: sandbox() registers its cleanup (t.after) only after it returns, so when the git-dir guard or any earlier step throws, the mkdtemp dir leaks (the tmp-cleanup preload only collects a filetube- prefix). Measured: each guard-firing mutant run left 5 ft-precommit-fast-* dirs in /tmp (I removed the 25 mine made; 10 from 01:49, before this review, are still there). Register cleanup before the first git call, or use the filetube- prefix.
- Not executed: `git commit -a` itself (this box's PreToolUse hook blocks the command text; I did not route around it). `-i` takes the same index.lock path and was verified; `-a` is should-work, not verified.

Gate: CHANGES r1 @94e4f023 — adversary

## r1 fix record (gate r1 @94e4f023, adversary CHANGES)

| Finding | Change | Binding test | Mutant (sandbox from `git write-tree` of the staged fix) |
|---|---|---|---|
| W1 --no-renames unbound | new CLI test: `git mv lib/x.js docs/x.md` must exit 1; AC2 + Design name the right direction | "a rename of CODE INTO docs/" | drop --no-renames: `pass 9 fail 1` |
| W2 hook lock is presence-only | new end-to-end test: the real hooks/pre-commit (copied with the selector and tmp-cleanup into a sandbox repo, node_modules resolved by the hook's own upward walk) run by a real `git commit`: a docs test that fails refuses the commit and leaves HEAD; a passing one lands and prints the docs-only line | "the real hook on a docs-only commit" | `|| true` after the run `9/1`; `exit 0` before it `9/1`; `set -e` removed `9/1` |
| W3 guard detected, did not prevent | CLEAN_ENV also drops NODE_TEST_CONTEXT (the nested hook run); an assert at MODULE LOAD that no GIT_* key reaches a child, before any child process exists; comment and the incident record corrected | load-time assert | sanitizer removed, run under a decoy WORKTREE-shaped hook env (GIT_DIR = decoy worktree gitdir, GIT_INDEX_FILE, GIT_CONFIG_PARAMETERS, no GIT_WORK_TREE): `pass 0 fail 1` at load, decoy unchanged (1 commit, core.bare false, worktree index a); fixed file under the same env `pass 10 fail 0`, decoy unchanged |
| W4 selection partly pinned | AC3 pins all 11 measured runtime docs readers | "docsReadingTests: ... every measured runtime docs reader" | drop the quoted-docs alternative: `9/1` (docs-diagrams-census lost) |
| S2 sandbox leaks on throw | cleanup registered first thing in sandbox(t); the 10 empty dirs left by the incident runs removed | - | a full run leaves 0 ft-precommit-fast dirs |
| S1 --amend | DISCLOSED, out of scope: an amend with only docs staged takes the fast path while the amended commit carries HEAD's code; it matters only when HEAD's code skipped the hook (cherry-pick, rebase, a clean merge); pre-push runs the full suite on every push | - | - |

Targeted after the fix: precommit-docs-fast-path `tests 10 pass 10 fail 0`; eslint exit 0.
