'use strict';

// [UNIT] v1.148 T2 - the dependency audit gate's pure decision core
// (scripts/audit-check.js evaluateAudit/validateExceptions) plus the CLI
// product itself (spawn-level exit codes through a PATH-shimmed npm - gate
// round 1, adversarial W2: the exit code IS the gate, and a main()-level
// mutant survived the pure-core-only suite).
//
// Fixture provenance, stated honestly (gate round 1, QA W1): the GHSA ids,
// urls, titles and via-OBJECT shapes are taken from the REAL
// `npm audit --json` document captured on this repo's pre-T1 lockfile (the
// 4 live advisories healed in T1); the chain-reference STRING entry
// (eslint below) is MODELED on npm's documented via form - the captured
// document happened to contain none, and the earlier claim that it did was
// a QA finding. Fail-closed is the load-bearing posture: garbage in any
// input must red, never allow.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { evaluateAudit, validateExceptions } = require('../../scripts/audit-check.js');

// ---- fixtures (trimmed from the real pre-T1 audit document) ----------------

const GHSA_BRACE_1 = 'GHSA-3jxr-9vmj-r5cp';
const GHSA_BRACE_2 = 'GHSA-mh99-v99m-4gvg';
const GHSA_JSYAML = 'GHSA-5p4m-2wfm-xmqj';
const GHSA_BODYPARSER = 'GHSA-v422-hmwv-36x6'; // low - must NOT gate

function cleanDoc() {
  return {
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
  };
}

function vulnerableDoc() {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      'body-parser': {
        name: 'body-parser', severity: 'low',
        via: [{ source: 1099846, name: 'body-parser', dependency: 'body-parser', title: 'body-parser vulnerable to denial of service when invalid limit value silently disables size enforcement', url: `https://github.com/advisories/${GHSA_BODYPARSER}`, severity: 'low', range: '<1.20.6' }],
        effects: ['express'], range: '<1.20.6', nodes: ['node_modules/body-parser'], fixAvailable: true,
      },
      'brace-expansion': {
        name: 'brace-expansion', severity: 'high',
        via: [
          { source: 1106310, name: 'brace-expansion', dependency: 'brace-expansion', title: 'brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups', url: `https://github.com/advisories/${GHSA_BRACE_1}`, severity: 'high', range: '<=1.1.17' },
          { source: 1106311, name: 'brace-expansion', dependency: 'brace-expansion', title: 'brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash', url: `https://github.com/advisories/${GHSA_BRACE_2}`, severity: 'high', range: '<=1.1.17' },
        ],
        effects: ['minimatch'], range: '<=1.1.17', nodes: ['node_modules/brace-expansion'], fixAvailable: true,
      },
      'js-yaml': {
        name: 'js-yaml', severity: 'high',
        via: [{ source: 1106400, name: 'js-yaml', dependency: 'js-yaml', title: 'JS-YAML: Quadratic CPU consumption in !!omap resolution', url: `https://github.com/advisories/${GHSA_JSYAML}`, severity: 'high', range: '4.0.0 - 4.3.0' }],
        effects: ['eslint'], range: '4.0.0 - 4.3.0', nodes: ['node_modules/js-yaml'], fixAvailable: true,
      },
      // The chain-reference shape: a package whose vulnerability exists only
      // VIA another (string entries, no advisory object of its own).
      eslint: {
        name: 'eslint', severity: 'high',
        via: ['js-yaml'], effects: [], range: '*', nodes: ['node_modules/eslint'], fixAvailable: true,
      },
    },
    metadata: { vulnerabilities: { info: 0, low: 1, moderate: 0, high: 3, critical: 0, total: 4 } },
  };
}

function exceptions(...ids) {
  return {
    comment: 'test fixture',
    exceptions: ids.map((advisory) => ({
      advisory,
      reason: 'accepted for testing purposes with a real-length reason',
      added: '2026-08-18',
      revisit: 'the next audit-check wave',
    })),
  };
}

const EMPTY = { comment: '', exceptions: [] };

// ---- the happy and failing paths -------------------------------------------

test('clean audit + empty exceptions -> ok with counts echoed', () => {
  const v = evaluateAudit(cleanDoc(), EMPTY);
  assert.equal(v.ok, true);
  assert.deepEqual(v.offending, []);
  assert.deepEqual(v.stale, []);
  assert.equal(v.counts.high, 0);
});

test('high advisories gate; low does not; chain strings resolve via the root entry without error', () => {
  const v = evaluateAudit(vulnerableDoc(), EMPTY);
  assert.equal(v.ok, false);
  assert.equal(v.failClosed, undefined, 'a real finding is a FAIL, never fail-closed');
  const ids = v.offending.map((a) => a.id).sort();
  assert.deepEqual(ids, [GHSA_BRACE_1, GHSA_JSYAML, GHSA_BRACE_2].sort(), 'exactly the three unique HIGH advisories - the low body-parser one never gates');
});

test('a fully-excepting exceptions file turns the same document green (and records what it excepted)', () => {
  const v = evaluateAudit(vulnerableDoc(), exceptions(GHSA_BRACE_1, GHSA_BRACE_2, GHSA_JSYAML));
  assert.equal(v.ok, true);
  assert.equal(v.excepted.length, 3);
  assert.deepEqual(v.stale, []);
});

test('a partial exceptions file leaves the remainder offending', () => {
  const v = evaluateAudit(vulnerableDoc(), exceptions(GHSA_JSYAML));
  assert.equal(v.ok, false);
  assert.deepEqual(v.offending.map((a) => a.id).sort(), [GHSA_BRACE_1, GHSA_BRACE_2].sort());
});

test('a stale exception WARNS (listed) but never reds a clean tree', () => {
  const v = evaluateAudit(cleanDoc(), exceptions(GHSA_JSYAML));
  assert.equal(v.ok, true);
  assert.deepEqual(v.stale, [GHSA_JSYAML]);
});

test('critical severity gates like high; severity casing is normalized', () => {
  const doc = cleanDoc();
  doc.vulnerabilities.evil = {
    name: 'evil', severity: 'critical',
    via: [{ title: 'bad', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', severity: 'CRITICAL' }],
  };
  doc.metadata.vulnerabilities.critical = 1;
  const v = evaluateAudit(doc, EMPTY);
  assert.equal(v.ok, false);
  assert.equal(v.offending[0].id, 'GHSA-aaaa-bbbb-cccc');
});

test('an unidentifiable high advisory (no GHSA url) still gates and cannot be excepted', () => {
  const doc = cleanDoc();
  doc.vulnerabilities.mystery = {
    name: 'mystery', severity: 'high',
    via: [{ title: 'no url here', severity: 'high' }],
  };
  doc.metadata.vulnerabilities.high = 1;
  const v = evaluateAudit(doc, EMPTY);
  assert.equal(v.ok, false);
  assert.match(v.offending[0].id, /^UNIDENTIFIED:mystery:/);
  // And the synthetic id can never enter the exceptions file: it fails the
  // GHSA shape validation, which fails the WHOLE file closed.
  const hostile = { exceptions: [{ advisory: v.offending[0].id, reason: 'trying to allowlist the unnameable', added: '2026-08-18', revisit: 'a real trigger' }] };
  assert.match(validateExceptions(hostile).error, /not a GHSA id/);
});

// ---- fail-closed on every malformed input ----------------------------------

test('garbage audit documents fail CLOSED, never allow', () => {
  for (const bad of [null, 'nope', 42, {}, { metadata: {} }, { metadata: { vulnerabilities: {} } }, { vulnerabilities: {} }]) {
    const v = evaluateAudit(bad, EMPTY);
    assert.equal(v.ok, false, `expected fail for ${JSON.stringify(bad)}`);
    assert.ok(v.failClosed, 'and it must be the CLOSED kind');
  }
});

test('the attribution cross-check: metadata claims high/critical the walk cannot attribute -> fail closed', () => {
  const doc = cleanDoc();
  doc.vulnerabilities.ghost = { name: 'ghost', severity: 'high', via: ['someone-else'] };
  doc.metadata.vulnerabilities.high = 1;
  const v = evaluateAudit(doc, EMPTY);
  assert.equal(v.ok, false);
  assert.match(v.failClosed, /no advisory could be attributed/);
});

test('malformed exceptions files fail CLOSED (a typo must never allow)', () => {
  const cases = [
    null,
    {},
    { exceptions: 'not-an-array' },
    { exceptions: [null] },
    { exceptions: [{ advisory: 'not-a-ghsa', reason: 'long enough reason here', added: '2026-08-18', revisit: 'y' }] },
    { exceptions: [{ advisory: GHSA_JSYAML, reason: 'short', added: '2026-08-18', revisit: 'y' }] },
    { exceptions: [{ advisory: GHSA_JSYAML, reason: 'long enough reason here', added: '2026-08-18', revisit: '' }] },
    { exceptions: [{ advisory: GHSA_JSYAML, reason: 'long enough reason here', revisit: 'a real trigger' }] }, // missing added (QA S1)
    { exceptions: [{ advisory: GHSA_JSYAML, reason: 'long enough reason here', added: 'not-a-date', revisit: 'a real trigger' }] },
  ];
  for (const bad of cases) {
    const v = evaluateAudit(cleanDoc(), bad);
    assert.equal(v.ok, false, `expected fail for ${JSON.stringify(bad)}`);
    assert.match(v.failClosed || '', /invalid exceptions file/);
  }
});

// ---- the COMMITTED exceptions file is bound to the validator ---------------

test('docs/audit-exceptions.json parses, validates, and is EMPTY (the healthy state)', () => {
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'audit-exceptions.json'), 'utf8'));
  const result = validateExceptions(real);
  assert.equal(result.error, undefined, 'the committed file must satisfy the validator it feeds');
  assert.deepEqual([...result.ids], [], 'empty is the healthy state; a non-empty file is a conscious, reviewed decision');
});

// ---- gate round 1 additions -------------------------------------------------

test('adversarial S2: an UNWALKABLE high/critical via shape fails closed even when other advisories attribute', () => {
  // Format-drift model: one high package with a via the walk cannot read,
  // while a NORMAL high advisory coexists (and is even excepted) - the
  // pre-hardening zero-attribution check alone would read this green.
  for (const badVia of [undefined, null, 42, {}, [], [42], [null]]) {
    const doc = vulnerableDoc();
    doc.vulnerabilities.driftpkg = { name: 'driftpkg', severity: 'high', via: badVia };
    doc.metadata.vulnerabilities.high += 1;
    const v = evaluateAudit(doc, exceptions(GHSA_BRACE_1, GHSA_BRACE_2, GHSA_JSYAML));
    assert.equal(v.ok, false, `expected fail for via=${JSON.stringify(badVia)}`);
    assert.match(v.failClosed || '', /unwalkable via shape/, `and it must be the CLOSED kind for via=${JSON.stringify(badVia)}`);
  }
  // A LOW-severity unwalkable entry does not gate (severity floor holds).
  const doc = cleanDoc();
  doc.vulnerabilities.lowdrift = { name: 'lowdrift', severity: 'low', via: 42 };
  assert.equal(evaluateAudit(doc, EMPTY).ok, true);
});

test('adversarial W2: the CLI exit code is the product - four spawn-level scenarios through a PATH-shimmed npm', () => {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-audit-shim-'));
  try {
    const fixtureFile = path.join(shimDir, 'doc.json');
    fs.writeFileSync(path.join(shimDir, 'npm'), `#!/bin/sh\ncat "${fixtureFile}"\n`, { mode: 0o755 });
    const script = path.join(__dirname, '..', '..', 'scripts', 'audit-check.js');
    const runCli = () => spawnSync(process.execPath, [script], {
      env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` },
      encoding: 'utf8',
      timeout: 30000,
    });
    fs.writeFileSync(fixtureFile, JSON.stringify(vulnerableDoc()));
    let r = runCli();
    assert.equal(r.status, 1, `vulnerable must exit 1 (stderr: ${r.stderr})`);
    assert.match(r.stderr, /GHSA-/, 'and it names the advisories');
    fs.writeFileSync(fixtureFile, JSON.stringify({ error: { code: 'ENETWORK', summary: 'registry unreachable' } }));
    r = runCli();
    assert.equal(r.status, 1, 'npm error document must exit 1 (fail closed)');
    assert.match(r.stderr, /npm audit itself errored/);
    fs.writeFileSync(fixtureFile, 'not json at all');
    r = runCli();
    assert.equal(r.status, 1, 'unparseable stdout must exit 1 (fail closed)');
    fs.writeFileSync(fixtureFile, JSON.stringify(cleanDoc()));
    r = runCli();
    assert.equal(r.status, 0, `clean must exit 0 (stderr: ${r.stderr})`);
    assert.match(r.stdout, /audit-check: OK/);
  } finally {
    fs.rmSync(shimDir, { recursive: true, force: true });
  }
});
