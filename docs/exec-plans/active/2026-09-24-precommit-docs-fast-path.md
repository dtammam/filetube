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
  a move out of docs/ into code is not docs-only). Docs-only = non-empty and every path matches
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
- AC2 a rename out of docs/ into code takes the full hook. (CLI rename test)
- AC3 the selection carries the four docs censuses and skips an unrelated test, and is a small
  slice. (docsReadingTests on the real tree)
- AC4 zero docs-reading tests found = exit 2, never a silent zero-test pass. (CLI exit 2 test)
- AC5 the hook wiring: resolved beside the hook, guarded by the file check and the exit code,
  placed before the full checks, and the full checks remain. (hook source lock, comments stripped)
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
the sandbox git helper `tests 8 pass 2 fail 6` (the guard fires before any write), decoy unchanged.
Lesson: a test that shells out to git must never inherit the hook's GIT_* env.
