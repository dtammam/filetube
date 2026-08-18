'use strict';

// [UNIT] v1.148 T2 - the dependency audit gate's pure decision core
// (scripts/audit-check.js evaluateAudit/validateExceptions). Fixtures are
// TRIMMED FROM REAL `npm audit --json` output captured on this repo's own
// pre-T1 lockfile (the 4 live advisories healed in T1) - real GHSA ids,
// real via shapes, real chain-reference strings - not invented schema.
// Fail-closed is the load-bearing posture: garbage in any input must red,
// never allow.

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
  const hostile = { exceptions: [{ advisory: v.offending[0].id, reason: 'trying to allowlist the unnameable', added: 'x', revisit: 'y' }] };
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
    { exceptions: [{ advisory: 'not-a-ghsa', reason: 'long enough reason here', added: 'x', revisit: 'y' }] },
    { exceptions: [{ advisory: GHSA_JSYAML, reason: 'short', added: 'x', revisit: 'y' }] },
    { exceptions: [{ advisory: GHSA_JSYAML, reason: 'long enough reason here', added: 'x', revisit: '' }] },
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
