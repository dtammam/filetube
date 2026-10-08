---
plan: art-version-flake
harness: v2 · lean
branch: fix/art-version-flake
anchor: outcome
status: Approved @9b9a7435
next: W1 (the fixture's pictures get distinct versions + a distinctness floor), then W2 (records), then the gate (adversary)
design: v1.377.0's PR #115 CI (ci (24) red once, rerun green) + a read of the test; Dean's device pass of v1.377.0 and v1.376.0 W5 (2026-10-08). Base main 9b9a7435 (v1.377.0).
gate: pending
---

# A flaky art-version RBAC test, and the v1.377.0 device-pass records

Read first: AGENTS.md; docs/LESSONS.md sections 0, 1, 2 (test binding: "can the test actually fail?"), 13; this plan.
This is a test-and-docs change: NO version bump, no tag, no ledger entry (nothing a user sees changes); main
publishes `edge` as usual after the merge.

## 0. Step 0 (the builder reads this first)

- Environment: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"` before EVERY node /
  npm / git command; dual-Node suites use v22.23.1 then v24.20.0 (Node 24's reporter prints `ℹ`, not `#`). `gh` is
  ~/.local/bin/gh. No jq.
- Git: work on `fix/art-version-flake` (this plan is committed there). Stage EXPLICIT paths, commit with
  `git commit -F <file>`, never --no-verify, never force-push, never pipe a commit or push; verify with git log /
  git ls-remote. main is PROTECTED: push the branch, `gh pr create`, wait for ci (22), ci (24), audit, secret-scan.
- Stop rules (AskUserQuestion): the gate reaches round 3; the measurement in W1 does not reproduce the collision (the
  diagnosis below would then be wrong - re-root-cause, do not patch).
- Reporting: no step-by-step ceremony; report at decision points and at the end in the 4-line status shape
  (~/.claude/CLAUDE.md "Working from the phone"); push a notification when the gate closes and when the PR merges.

## 1. Outcome

`test/integration/music-art-version.test.js` "RBAC: a member never receives a hidden item's id or version; ..." never
fails by chance. Seen on PR #115 (ci (24), verbatim): `AssertionError [ERR_ASSERTION]: a hidden picture's version
(muzz57d6-a) never reaches the member` at music-art-version.test.js:154; tests 11750, pass 11736, fail 1; the rerun
passed.

## 2. Diagnosis (to be MEASURED in W1 before the fix)

A picture's version is `Math.floor(mtimeMs).toString(36) + '-' + size.toString(36)` (lib/music/artVersion.js
`versionOfStat`). In the test's `before()`, `ALBUMART_DIR/<tWall.albumArtKey>.jpg` is written as `'WALL-COVER'` (10
bytes, VISIBLE to the member) and `THUMBNAIL_DIR/<libHidden.id>.jpg` as `'HIDDEN-ART'` (10 bytes, HIDDEN), neither with
`setTime`: written in the same millisecond, they get the SAME version (`-a` = 10 bytes), so the visible cover's version
string equals the hidden picture's and the assertion `!sent.includes(v)` fails although nothing leaked. Falsifying
observation: force both files to one mtime (setTime to the same ms) on base and the test goes red deterministically;
give them different mtimes and it is green. (Not a product defect: two different pictures sharing a version string is
a harmless cache-buster collision - the version carries no item identity.)

## 3. Waves

- **W1 The fixture's pictures get distinct versions.** First the measurement above (red with a forced shared mtime,
  pasted verbatim). Then `setTime` every fixture picture in `before()` to its own millisecond (the WALL cover, the
  SECRET cover, OWN-ART already has one, HIDDEN-ART), and add an anti-vacuity floor at the top of the RBAC test (or in
  `before()`): the four fixture versions are pairwise distinct - the RBAC check is meaningful only if the hidden
  version is unique. Mutants (in a /tmp git-archive sandbox of the committed fix, LESSONS 2): (a) give the hidden
  thumbnail the wall cover's mtime -> the floor goes red by name; (b) drop the floor and keep the shared mtime -> the
  RBAC test goes red (the original failure, now deterministic). Run the file 20 times in a loop on Node 22 and on Node 24
  (`for i in $(seq 20); do node --test test/integration/music-art-version.test.js ...; done`): 40 of 40 green.
- **W2 Records of Dean's device pass (2026-10-08: "all 4 are now good").** docs/DEVICE-CHECKS.md: mark the three
  v1.377.0 lines and v1.376.0's "line under the controls" line `[x]` with `(Dean 2026-10-08: "good")`, the existing
  pattern. ROADMAP.md Planned > Bugs: the "thin line of the picture's colours at the bottom edge of the phone player"
  item gets Dean's result appended - Ambient OFF makes it go away (his answer 2026-10-08), so the cause is the ambient
  glow's bloom below the control bar on the phone; the item stays OPEN as the fix to make (drop or clip the phone's
  below-bar bloom; measure first) - do not fix it here. Close out docs/exec-plans/active/2026-09-29-next-waves.md:
  all five waves shipped (W1 visual report-only, W2 v1.341.4, W3 v1.342.0, W4 v1.343.0, W5 v1.344.0) -> `node
  scripts/plan-complete.js docs/exec-plans/active/2026-09-29-next-waves.md "Shipped v1.344.0" --apply`, update any
  path reference it lists, `git add` the moved file. LESSONS.md section 2: add one line to the existing "random-seeded /
  flaky" or "divergent-fixture" class (dedupe, bump the strike count): fixtures whose derived keys (mtime + size)
  can coincide make a leak test fail by chance - give each fixture a distinct key and assert distinctness first.

## 4. Gate

The adversary seat (`.claude/agents/adversary`; test + docs only, no route / auth / runtime code: the floor). Brief it
to break the claim "never fails by chance" (other fixture pairs with equal size and mtime in this file and its
siblings: grep `writeFileSync` without `setTime` in test/integration/music-art-*.test.js) and to verify the W2 records
against Dean's words above. Verdict line into section 6 below, bound to the sha.

## 5. Ship

Full `npm test` on Node 22.23.1 then 24.20.0 at the gated tree (both summaries verbatim). Push the branch (with
`GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"`), `gh pr create`, wait for ci (22),
ci (24), audit, secret-scan green (visual is a report), `gh pr merge --merge` (Dean authorizes merging on green; if the
tool refuses, ask him), `git checkout main && git pull --ff-only`, delete the branch (`git branch -d`; the remote one is
auto-deleted - check `git ls-remote --heads origin`). No tag.

## 6. Gate verdicts

(pending)

## 7. Evidence (the builder fills this)

- W1: the forced-collision red (verbatim), the fix, the floor, the two mutants and their results, the 40-run loop.
- W2: the lines changed. The gate verdict. Both suite summaries. Residuals, if any.
