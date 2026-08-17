'use strict';

// [UNIT] v1.144 (Dean): the release LEDGER checker - docs/releases.json is
// the user-facing release-notes source of truth (published to GitHub
// Releases by scripts/sync-github-releases.js via CI, linked from the
// account menu's version row). The checker makes the ceremony unable to
// ship a release without its human-facing note, and keeps the ledger
// honest against the tag history (the DIAGRAMS.md checker posture: the
// artifact re-verifies itself against reality on every run).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'releases.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const SEMVER = /^\d+\.\d+\.\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function semverKey(v) {
  const [a, b, c] = v.split('.').map(Number);
  return a * 1e8 + b * 1e4 + c;
}

test('ledger: every entry is a complete {version, date, title, intent} record', () => {
  assert.ok(Array.isArray(ledger) && ledger.length > 0, 'non-empty array');
  for (const e of ledger) {
    assert.match(e.version, SEMVER, `version shape: ${e.version}`);
    assert.match(e.date, ISO_DATE, `date shape at ${e.version}`);
    assert.ok(typeof e.title === 'string' && e.title.trim() !== '', `title at ${e.version}`);
    assert.ok(typeof e.intent === 'string' && e.intent.trim() !== '', `intent at ${e.version}`);
    assert.deepStrictEqual(Object.keys(e).sort(), ['date', 'intent', 'title', 'version'],
      `no stray fields at ${e.version}`);
  }
});

test('ledger: versions strictly ascending and unique; dates non-decreasing', () => {
  for (let i = 1; i < ledger.length; i++) {
    assert.ok(semverKey(ledger[i].version) > semverKey(ledger[i - 1].version),
      `ascending/unique at ${ledger[i - 1].version} -> ${ledger[i].version}`);
    assert.ok(ledger[i].date >= ledger[i - 1].date,
      `dates non-decreasing at ${ledger[i].version}`);
  }
});

test('ledger: the RUNNING version has its note, and it is the newest entry (the ceremony cannot ship without writing it)', () => {
  const last = ledger[ledger.length - 1];
  assert.strictEqual(last.version, pkg.version,
    `package.json is ${pkg.version} but the ledger's newest entry is ${last.version} - the release ceremony adds the ledger entry IN the release commit, alongside the version bump`);
});

test('ledger: the tone tripwire - titles and intents carry NO process jargon (pure user language, Dean\'s ruling)', () => {
  // A blocklist is porous by nature (#157) - this is a tripwire against the
  // obvious leaks, not the editorial contract itself.
  const JARGON = /\b(gate|mutant|adversarial|dual-?node|reviewer|APPROVE|test suite|unit test|regression[- ]lock|source[- ]lock|semver|refactor|jsdom|localStorage|RBAC|schema v\d)\b/i;
  for (const e of ledger) {
    const hit = (e.title + ' ' + e.intent).match(JARGON);
    assert.ok(!hit, `process jargon "${hit && hit[0]}" in ${e.version} - release notes are for the humans using the app`);
  }
});

test('ledger: complete against the tag history (every tag has a note; no phantom entries)', (t) => {
  let tags;
  try {
    tags = execFileSync('git', ['tag'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter((l) => /^v\d+\.\d+\.\d+$/.test(l)).map((l) => l.slice(1));
  } catch (_) {
    tags = [];
  }
  if (tags.length === 0) {
    // A shallow/tagless checkout (CI) cannot run the census - the shape,
    // ordering, running-version, and tone tests above still hold it honest.
    t.diagnostic('git tags unavailable (shallow checkout?) - tag census skipped');
    return;
  }
  const entries = new Set(ledger.map((e) => e.version));
  const missing = tags.filter((v) => !entries.has(v));
  assert.deepStrictEqual(missing, [], `tags with no ledger entry: ${missing.join(', ')}`);
  // Every entry is a real tag OR the running (not-yet-tagged) version - the
  // release commit adds the entry BEFORE the tag exists.
  const tagSet = new Set(tags);
  const phantoms = ledger.map((e) => e.version).filter((v) => !tagSet.has(v) && v !== pkg.version);
  assert.deepStrictEqual(phantoms, [], `ledger entries for versions that were never tagged: ${phantoms.join(', ')}`);
});

// ---- the publisher's pure planner (scripts/sync-github-releases.js) --------

const { planReleaseSync, formatReleaseTitle, formatReleaseBody } = require('../../scripts/sync-github-releases.js');

test('planReleaseSync: creates only for tags with a ledger entry and NO existing release (idempotent by construction)', () => {
  const mini = [
    { version: '1.0.0', date: '2026-07-04', title: 'A', intent: 'a.' },
    { version: '1.1.0', date: '2026-07-04', title: 'B', intent: 'b.' },
    { version: '1.2.0', date: '2026-07-04', title: 'C', intent: 'c.' },
  ];
  const plan = planReleaseSync(['v1.0.0', 'v1.1.0', 'v1.2.0', 'v9.9.9', 'not-a-tag'], ['v1.0.0'], mini);
  assert.deepStrictEqual(plan.toCreate.map((e) => e.version), ['1.1.0', '1.2.0'],
    'existing releases skipped; only ledgered tags created');
  assert.deepStrictEqual(plan.unledgered, ['v9.9.9'], 'a hand-pushed tag with no entry is reported, never invented');
  const rerun = planReleaseSync(['v1.0.0', 'v1.1.0', 'v1.2.0'], ['v1.0.0', 'v1.1.0', 'v1.2.0'], mini);
  assert.deepStrictEqual(rerun.toCreate, [], 're-running after full sync creates nothing');
});

test('release title/body: user-language shape, dated footer', () => {
  const e = { version: '1.143.0', date: '2026-08-17', title: 'The feed remembers your filter', intent: 'Pick Audio and it stays.' };
  assert.strictEqual(formatReleaseTitle(e), 'v1.143.0 - The feed remembers your filter');
  assert.strictEqual(formatReleaseBody(e), 'Pick Audio and it stays.\n\n_Released 2026-08-17._\n');
});
