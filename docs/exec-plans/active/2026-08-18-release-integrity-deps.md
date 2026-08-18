# Release integrity + dependency automation (test the artifact you ship; drift arrives as PRs)

Status: ACTIVE (implementing). Owner: main session. Target: v1.148.0, FULL two-seat gate (Dean, 2026-08-18: "full treatment versus slim-gate ... a pretty fundamental way of changing CI and handling dependencies").

Dean's intake (all six recommendations accepted as proposed; his one
question - revertibility - answered: every piece is pure config, one
revert commit restores today's behavior):
1. Dependabot (not Renovate).
2. Three ecosystems: npm (weekly, minor+patch grouped), docker (the
   node:22-alpine base FROM - NOT the yt-dlp ARG pin), github-actions.
3. NO auto-merge, ever - bot PRs wait for Dean; merging one is a normal
   slim wave.
4. Audit gate in CI: fail on high/critical, full tree (runtime + dev),
   with a committed empty-by-default exceptions file (advisory id +
   reason + revisit trigger) so an override is a reviewed commit. Dean
   explicitly accepted the a-few-reds-a-year cost ("part of the game").
5. Build ONCE -> smoke-test THAT image -> push THAT SAME local image as
   every tag. Smoke = boots on a clean data dir, serves the first-run
   page, refuses an unauthenticated API call. No media/e2e in the smoke.
6. Single-arch (amd64) stays - build-once/load/test/push depends on it.

## Framing

Two "not first class" gaps from the same assessment: (1) docker-publish
qualifies the SOURCE then REBUILDS for the push - the shipped artifact
is never the tested artifact (tech-debt #154(d), now pulled out of the
pre-exposure bundle: it is release integrity, not exposure posture);
(3) no dependency automation and no audit gate - drift is invisible and
advisories are discovered by accident (this wave's own baseline proves
it: 4 standing advisories, 3 high, found the moment we measured).

## Machine-derived facts (re-verified at every commit)

- `npm audit` baseline on main (2026-08-18): 4 vulnerabilities - 1 low
  (body-parser <1.20.6, a runtime transitive via express), 3 high
  (brace-expansion, js-yaml, undici - all dev-tree transitives via
  eslint/jsdom). ALL report "fix available via npm audit fix" (semver-
  range lockfile bumps, no majors). T1 fixes them so the gate is born
  GREEN with an EMPTY exceptions file.
- Workflows today: ci.yml 99 lines (lint + token ratchet + test on a
  22/24 matrix); docker-publish.yml 144 lines (qualify matrix +
  secret-scan -> publish: metadata-action tags edge/X.Y.Z/X.Y/X/latest/
  sha, build-push-action with push:true - build and push in ONE step,
  never booted; QEMU/buildx set up but no platforms key = amd64 only).
- The v1.129 C6 protections in docker-publish (concurrency groups, the
  tag==package.json assertion) must SURVIVE the redesign untouched.
- MEASURED smoke contract (real server, clean temp DATA_DIR, this box):
  GET /login -> 302 -> /welcome -> 200 (first-run page); GET /api/stats
  unauthenticated -> 401. These exact codes are what the smoke asserts -
  measured, not guessed.
- No docker on the dev box: the workflow YAML cannot be executed
  locally. Mitigations: (a) a workflow_dispatch DRY-RUN mode
  (build + smoke, NO push) so the pipeline is validated in CI before
  the next real tag; (b) comment-stripped source-lock tests on the
  workflow files; (c) this is a NAMED attack surface for the gate.
- Suite baseline: 7183/7183 pass 0 fail (v22.23.1 AND v24.14.0,
  v1.147.0 release runs).

## Tasks (small, independently green, in order)

- **T1 - heal the baseline.** `npm audit fix` (lockfile-only bumps),
  re-run `npm audit` (expect 0) and the FULL suite. The gate must be
  born green; the 4 advisories die as the wave's first proof of value.
- **T2 - the audit gate.** scripts/audit-check.js: spawns
  `npm audit --json` (injectable for tests), fails on any high/critical
  advisory whose GHSA id is not in docs/audit-exceptions.json
  (committed, empty array, schema {advisory, reason, added, revisit});
  stale exceptions WARN (never red - a fixed advisory disappearing must
  not break CI); malformed audit output / audit-spawn failure = FAIL
  CLOSED with the raw error shown. `npm run audit:check` script;
  ci.yml gains the step ONCE (not per matrix leg where avoidable);
  fixture-driven unit tests (pass/fail/exception/stale/malformed).
  NOT in the pre-commit/pre-push hooks - it needs the registry, and
  network-dependent local gates are the exact class v1.147's refused
  tag just paid for.
- **T3 - dependabot.** .github/dependabot.yml: npm weekly grouped
  minor+patch, docker weekly, github-actions weekly; PR limit bounded.
  Source-lock test binds the three ecosystems + the no-auto-merge
  posture (no auto-merge config may appear).
- **T4 - build once, smoke, promote.** docker-publish.yml publish job:
  build with load:true to a local candidate tag (labels from
  metadata-action, gha cache kept); NEW smoke step - run the candidate
  against a fresh anonymous volume, poll /login (follow redirects)
  until terminal 200 within a bounded window, assert /api/stats == 401,
  dump docker logs on ANY failure, clean stop; then login + `docker
  tag`/`docker push` the SAME LOCAL IMAGE to every metadata tag
  (edge/semver/latest/sha) - the pushed artifact IS the smoked
  artifact, image id + digests echoed to the step summary. QEMU setup
  dropped (single-arch, decision 6). workflow_dispatch trigger added:
  dry-run = qualify + secret-scan + build + smoke with ALL push-side
  steps skipped. The C6 concurrency block and the tag==package.json
  assertion survive byte-identical.
- **T5 - docs + tracker truth.** RELEASING.md: the promote-by-identity
  flow, the dispatch dry-run (and that it is the REQUIRED validation
  step after this wave merges, before the next tag), the audit gate's
  exception process, revert notes for all three pieces. Tech-debt #154
  row: (d) closed by this wave, (a)-(c) remain with the same trigger.
  Dockerfile untouched.

## Named attack surfaces (the gate's brief)

1. CI YAML is UNEXECUTABLE locally - every claim about the pipeline is
   static until the dispatch dry-run. Attack the YAML the way v1.144.1
   was bitten: per-job checkout shapes, event-type conditionals
   (push-tag vs push-branch vs workflow_dispatch on EVERY push-side
   step), metadata-action behavior under dispatch, the concurrency
   groups' interaction with the new trigger.
2. The promote step's central claim: the pushed bytes ARE the smoked
   bytes. Attack the tag/push loop (newline handling of the metadata
   tags list, shell quoting, a tag list that is empty under some event),
   and whether any step between smoke and push can rebuild or mutate.
3. Smoke flakiness: poll budget vs a cold runner; port collisions;
   the fresh-volume assumption; the measured 302->200 chain (what if a
   future release adds a user-seeding env and /welcome dies?); does a
   failed smoke reliably dump logs and fail the job?
4. audit-check fail-open holes: exceptions file parsing (hostile/
   malformed), GHSA-id matching (via/advisory shapes in npm's JSON),
   severity spellings, the stale-exception WARN path accidentally
   swallowing a real advisory, audit network failure being read as
   clean, exit-code vs JSON disagreement.
5. Dependabot config validity (a bad schema = the bot silently does
   NOTHING - who would notice?); the docker ecosystem touching the
   yt-dlp ARG (it must not); grouped PRs vs the no-auto-merge posture.
6. The new lock tests' porosity: comment-strip ONCE (5th-strike class),
   and whether the locks bind anything real or just spellings.

## Risks / disclosed

- The pipeline's first real execution is the post-merge dispatch
  dry-run, then the v1.148.0 tag itself - if the YAML is wrong the tag
  push fails closed (qualify/smoke red blocks publish; nothing ships
  untested, which is the new invariant working).
- An upstream advisory can red all CI overnight with no local change -
  accepted by Dean at intake; the exceptions file is the escape hatch
  and each use is a reviewed commit.
- Dependabot noise is bounded (weekly, grouped, PR-capped) and fully
  revertible by deleting one file.

## Stop

All six intake decisions implemented; audit baseline healed; locks
green; FULL two-seat gate both APPROVE; dual-Node sequential verbatim;
ceremony (ROADMAP + ledger + tech-debt updates); post-merge dispatch
dry-run executed and reported before the tag. Release as v1.148.0.
Gate: FULL (Dean's explicit ruling).
