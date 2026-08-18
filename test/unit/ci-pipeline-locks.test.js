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

function stripped(rel) {
  const raw = fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
  return raw.replace(/^\s*#.*$/gm, '');
}

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
  assert.equal((PUBLISH.match(/docker\/build-push-action/g) || []).length, 1, 'exactly ONE build - a second build is the rebuild sin this wave kills');
  assert.match(PUBLISH, /load: true/);
  assert.match(PUBLISH, /tags: filetube-candidate:local/);
  assert.doesNotMatch(PUBLISH, /^\s*push: true\s*$/m, 'the old build-and-push spelling is gone');
});

test('docker-publish: the smoke asserts the MEASURED contract and blocks the push on failure', () => {
  const smoke = PUBLISH.slice(PUBLISH.indexOf('Smoke-test the built image'), PUBLISH.indexOf('Log in to Docker Hub'));
  assert.match(smoke, /docker run -d --name smoke/);
  assert.match(smoke, /curl -sL[^\n]*\/login/, 'polls /login FOLLOWING redirects (302 -> /welcome -> 200, measured 2026-08-18)');
  assert.match(smoke, /"\$code" = "200"/);
  assert.match(smoke, /\/api\/stats/);
  assert.match(smoke, /"\$api" = "401"/, 'the unauthenticated API contract (measured)');
  assert.match(smoke, /docker logs smoke/, 'a failed smoke dumps the container logs');
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
  assert.match(PUBLISH, /needs: \[qualify, secret-scan\]/, 'publish still blocks on qualify + secret scan');
});

test('docker-publish: single-arch by decision - no QEMU, no platforms key (intake decision 6)', () => {
  assert.doesNotMatch(PUBLISH, /setup-qemu/);
  assert.doesNotMatch(PUBLISH, /platforms:/);
});

test('NO auto-merge, ever: neither dependabot.yml nor any workflow contains auto-merge machinery', () => {
  // Dean's intake decision 3. Auto-merge for dependency PRs arrives via a
  // dependabot key or a workflow calling the merge API on dependabot PRs -
  // bind the absence in every pipeline file, comment-stripped.
  const files = ['.github/dependabot.yml', '.github/workflows/ci.yml', '.github/workflows/docker-publish.yml', '.github/workflows/release-notes.yml'];
  for (const f of files) {
    assert.doesNotMatch(stripped(f), /auto-?merge/i, `${f} must carry no auto-merge`);
  }
});
