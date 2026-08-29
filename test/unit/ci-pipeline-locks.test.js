'use strict';

// [UNIT] v1.148 - source locks on the CI/CD pipeline files. The workflows
// cannot EXECUTE locally (no GitHub runner, no docker on the dev box), so
// these locks are drift tripwires, not behavioral proof - the behavioral
// validation is the workflow_dispatch dry-run (docs/RELEASING.md). Honest
// scope: a lock here binds that a mechanism EXISTS and its load-bearing
// spelling; it cannot bind that GitHub interprets it as intended.
//
// Comment discipline (the repo's 5th-strike class): every YAML file is
// stripped of full-line comments ONCE at read, so a mechanism mentioned in
// comment prose can never satisfy a lock. (Inline trailing comments are
// deliberately NOT stripped - a '#' can legally appear inside YAML strings,
// and none of the locked spellings below carry trailing comments.)

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');
const yaml = require('js-yaml'); // declared devDependency (gate round 1, adversarial S1)

function raw(rel) {
  return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
}

function stripped(rel) {
  return raw(rel).replace(/^\s*#.*$/gm, '');
}

const PIPELINE_FILES = [
  '.github/dependabot.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/docker-publish.yml',
  '.github/workflows/release-notes.yml',
  '.github/workflows/dependabot-auto-merge.yml', // v1.206: the tiered auto-merge workflow
];

test('every pipeline YAML parses (an invalid dependabot.yml = the bot silently does nothing FOREVER)', () => {
  for (const f of PIPELINE_FILES) {
    assert.doesNotThrow(() => yaml.load(raw(f)), `${f} must be valid YAML`);
  }
});

const CI = stripped('.github/workflows/ci.yml');
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

// ---- T2: the audit gate ----------------------------------------------------

test('ci.yml carries the audit job wired to npm run audit:check (its own job, no npm ci needed)', () => {
  assert.match(CI, /^ {2}audit:$/m, 'the audit job exists');
  const jobBody = CI.slice(CI.indexOf('\n  audit:'), CI.indexOf('\n  ci:'));
  assert.match(jobBody, /npm run audit:check/, 'the job runs the gate script');
  assert.doesNotMatch(jobBody, /npm ci/, 'lockfile-only: the job must not install');
});

test('package.json audit:check points at the real script, and the script exists with its exports', () => {
  assert.equal(PKG.scripts['audit:check'], 'node scripts/audit-check.js');
  const mod = require('../../scripts/audit-check.js');
  assert.equal(typeof mod.evaluateAudit, 'function');
  assert.equal(typeof mod.validateExceptions, 'function');
});

test('the audit gate stays OUT of the local git hooks (network-dependent local gates: the v1.147 scar)', () => {
  for (const hook of ['hooks/pre-commit', 'hooks/pre-push']) {
    const body = fs.readFileSync(path.join(__dirname, '..', '..', hook), 'utf8');
    assert.doesNotMatch(body, /audit/, `${hook} must not run the audit gate`);
  }
});

// ---- T3: dependabot --------------------------------------------------------

const DEPENDABOT = stripped('.github/dependabot.yml');

test('dependabot watches exactly the three agreed ecosystems, weekly', () => {
  const ecosystems = [...DEPENDABOT.matchAll(/package-ecosystem: "([a-z-]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(ecosystems, ['docker', 'github-actions', 'npm']);
  assert.equal((DEPENDABOT.match(/interval: "weekly"/g) || []).length, 3, 'every ecosystem is weekly');
  assert.equal((DEPENDABOT.match(/open-pull-requests-limit:/g) || []).length, 3, 'every ecosystem is PR-bounded');
});

test('npm updates group minor+patch (majors arrive individually for individual scrutiny)', () => {
  assert.match(DEPENDABOT, /applies-to: version-updates/);
  assert.match(DEPENDABOT, /update-types:\s*\n\s*- "minor"\s*\n\s*- "patch"/);
});

// ---- T4: build once, smoke, promote by identity ----------------------------

const PUBLISH = stripped('.github/workflows/docker-publish.yml');

test('docker-publish: the build step LOADS a local candidate and nothing builds-and-pushes in one breath', () => {
  assert.equal((PUBLISH.match(/docker\/build-push-action/g) || []).length, 1, 'exactly ONE action build - a second build is the rebuild sin this wave kills');
  // Gate round 1 (adversarial W1-B): a RAW `docker build` run-step would
  // also be a second build - bind its absence in the whole stripped file.
  assert.doesNotMatch(PUBLISH, /docker build /, 'no raw docker build anywhere');
  // Anchored spellings (W1-F: an inline `# load: true` comment satisfied
  // the old unanchored lock).
  assert.match(PUBLISH, /^\s*load: true\s*$/m);
  assert.match(PUBLISH, /^\s*tags: filetube-candidate:local\s*$/m);
  assert.doesNotMatch(PUBLISH, /^\s*push: true\s*$/m, 'the old build-and-push spelling is gone');
  // Gate round 1 (adversarial W1-C): a quoted `push: 'true'` (or ANY push
  // key) inside the BUILD step would ship before the smoke - the build
  // step's slice must carry no push key at all.
  const buildStep = PUBLISH.slice(PUBLISH.indexOf('Build image (load only'), PUBLISH.indexOf('Smoke-test the built image'));
  assert.doesNotMatch(buildStep, /push:/, 'the build step must not push, under any spelling');
});

test('docker-publish: the smoke asserts the MEASURED contract and blocks the push on failure', () => {
  const smoke = PUBLISH.slice(PUBLISH.indexOf('Smoke-test the built image'), PUBLISH.indexOf('Log in to Docker Hub'));
  assert.match(smoke, /docker run -d --name smoke/);
  assert.match(smoke, /curl -sL --max-time \d+[^\n]*\/login/, 'polls /login FOLLOWING redirects, time-bounded (302 -> /welcome -> 200, measured 2026-08-18)');
  assert.match(smoke, /"\$code" = "200"/);
  assert.match(smoke, /--max-time \d+[^\n]*\/api\/stats/);
  assert.match(smoke, /"\$api" = "401"/, 'the unauthenticated API contract (measured)');
  assert.match(smoke, /docker logs smoke/, 'a failed smoke dumps the container logs');
  // Gate round 1 (adversarial W1-A, the named mutant): fail() must
  // actually FAIL - deleting its exit survived every lock.
  assert.match(smoke, /exit 1/, 'the smoke failure path exits nonzero - without this a broken image pushes');
});

test('docker-publish: promotion is BY IDENTITY (docker tag + push of the smoked image), push-event-gated', () => {
  const promote = PUBLISH.slice(PUBLISH.indexOf('Log in to Docker Hub'));
  assert.equal((promote.match(/if: github\.event_name == 'push'/g) || []).length, 2, 'login AND promote are both push-gated (the dispatch dry-run skips them)');
  assert.match(promote, /docker tag filetube-candidate:local "\$t"/);
  assert.match(promote, /docker push "\$t"/);
  assert.match(promote, /refusing a silent no-op publish/, 'an empty tag list on a push event is an error, never a quiet skip');
});

test('docker-publish: the dry-run trigger exists and the v1.129 C6 protections survive byte-for-byte', () => {
  assert.match(PUBLISH, /^\s*workflow_dispatch:\s*$/m);
  assert.match(PUBLISH, /group: docker-publish-\$\{\{ github\.ref_type \}\}/, 'C6 concurrency lane');
  assert.match(PUBLISH, /cancel-in-progress: false/);
  assert.match(PUBLISH, /Assert tag matches package\.json version/, 'C6 tag==version refusal');
  assert.match(PUBLISH, /needs: \[qualify, secret-scan, audit\]/, 'publish blocks on qualify + secret scan + the audit gate');
});

test('docker-publish: the audit gate is MIRRORED onto the release path (QA W2 - tag pushes skip ci.yml)', () => {
  assert.match(PUBLISH, /^ {2}audit:$/m, 'docker-publish carries its own audit job, the v1.123 qualify/secret-scan mirroring pattern');
  const jobBody = PUBLISH.slice(PUBLISH.indexOf('\n  audit:'), PUBLISH.indexOf('\n  secret-scan:'));
  assert.match(jobBody, /npm run audit:check/);
  assert.doesNotMatch(jobBody, /npm ci/, 'lockfile-only here too');
});

test('docker-publish: single-arch by decision - no QEMU, no platforms key (intake decision 6)', () => {
  assert.doesNotMatch(PUBLISH, /setup-qemu/);
  assert.doesNotMatch(PUBLISH, /platforms:/);
});

// ---- T5: TIERED auto-merge (v1.206, Dean 2026-08-29 - REVERSES v1.148's
// no-auto-merge). Replaces the old "NO auto-merge, ever" lock. Binds the tier
// split in the workflow + that the machinery is CONTAINED to that one file.
const AUTOMERGE = stripped('.github/workflows/dependabot-auto-merge.yml');

test('auto-merge: the machinery is CONTAINED to the dependabot-auto-merge workflow (never in ci/docker-publish/release-notes/dependabot.yml)', () => {
  // The other pipeline files must carry no auto-merge - the surface stays one
  // reviewable file (comment-stripped, so a mention in prose cannot satisfy it).
  for (const f of ['.github/dependabot.yml', '.github/workflows/ci.yml', '.github/workflows/docker-publish.yml', '.github/workflows/release-notes.yml']) {
    assert.doesNotMatch(stripped(f), /auto-?merge/i, `${f} must carry no auto-merge machinery`);
  }
  assert.match(AUTOMERGE, /auto-merge/i, 'the auto-merge workflow is where it lives');
});

test('auto-merge: acts ONLY on dependabot PRs, via fetch-metadata + gh pr merge --auto', () => {
  assert.match(AUTOMERGE, /if:\s*github\.actor == 'dependabot\[bot\]'/, 'gated to dependabot as the actor');
  assert.match(AUTOMERGE, /uses:\s*dependabot\/fetch-metadata@/, 'reads the PR metadata');
  assert.match(AUTOMERGE, /gh pr merge --auto/, 'arms GitHub auto-merge (held until required checks pass)');
});

test('auto-merge: the AUTO tier EXCLUDES majors, runtime deps, docker, and jsdom (Dean tiers)', () => {
  // The load-bearing gates in the `if:` condition. Removing any one widens the
  // auto lane past Dean's tiering.
  assert.match(AUTOMERGE, /update-type != 'version-update:semver-major'/, 'github-actions arm: no majors');
  assert.match(AUTOMERGE, /dependency-type == 'direct:development'/, 'npm arm: DEV deps only (runtime = production = manual)');
  assert.match(AUTOMERGE, /!contains\(steps\.meta\.outputs\.dependency-names, 'jsdom'\)/, 'npm arm: never jsdom');
  assert.match(AUTOMERGE, /update-type == 'version-update:semver-minor'/, 'npm arm: minor allowed');
  assert.match(AUTOMERGE, /update-type == 'version-update:semver-patch'/, 'npm arm: patch allowed');
  // The docker ecosystem never appears in the auto condition -> base-image
  // bumps (and any docker update) always fall through to manual.
  const cond = AUTOMERGE.slice(AUTOMERGE.indexOf('if: >'), AUTOMERGE.indexOf('run:'));
  assert.doesNotMatch(cond, /package-ecosystem == 'docker'/, 'the Docker ecosystem is never auto-merged');
});

test('auto-merge: the npm group is DEV-ONLY so a grouped PR can never carry a runtime dep past the direct:development gate', () => {
  assert.match(DEPENDABOT, /npm-minor-patch:\s+applies-to: version-updates\s+dependency-type: "development"/,
    'the npm-minor-patch group restricts to dependency-type development');
});
