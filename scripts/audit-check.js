'use strict';

// v1.148 T2 (release integrity + dependency automation): the dependency
// audit gate. Runs `npm audit --json --package-lock-only` (lockfile-only:
// no node_modules needed, so the CI job is checkout + node + this script)
// and FAILS on any HIGH or CRITICAL advisory whose GHSA id is not listed
// in docs/audit-exceptions.json - the committed, empty-by-default escape
// hatch, so an override is always a reviewed commit, never a shrug.
//
// Posture (Dean's intake rulings, exec plan 2026-08-18):
// - Severity floor: high + critical. Full tree (runtime AND dev deps).
// - FAIL CLOSED everywhere: malformed audit output, a malformed exceptions
//   file, an audit spawn/network failure, or high/critical counts we could
//   not attribute to a GHSA id all exit 1 with the raw evidence printed.
//   A gate that fails open on its own bugs is decoration.
// - STALE exceptions (an id listed but no longer reported) WARN, never
//   red: a fixed advisory disappearing must not break CI - but the warning
//   nags until the entry is removed.
// - CI-ONLY by design: this needs the npm registry, and network-dependent
//   LOCAL gates are the exact class the v1.147.0 refused-tag scar paid
//   for. It is deliberately NOT in the pre-commit/pre-push hooks.
//
// The decision core (evaluateAudit) is PURE and exported for the unit
// suite. Fixture provenance, stated honestly (gate round 1, QA W1): the
// GHSA ids, urls, titles and via-OBJECT shapes are taken from the REAL
// `npm audit --json` document captured on this repo's pre-T1 lockfile;
// the chain-reference STRING entry is modeled on npm's documented via
// form - the captured document happened to contain none. The full real
// document was separately fed through evaluateAudit during the gate
// (offending = exactly its 5 high GHSA ids).

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const EXCEPTIONS_PATH = path.join(__dirname, '..', 'docs', 'audit-exceptions.json');
const FAILING_SEVERITIES = new Set(['high', 'critical']);
const GHSA_PATTERN = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4,5}-[a-z0-9]{4,5}$/;
// npm audit JSON can be large on unlucky trees; bounded but generous.
const MAX_AUDIT_BUFFER = 32 * 1024 * 1024;

/**
 * Extract every HIGH/CRITICAL advisory from an `npm audit --json` document.
 * Advisories live as OBJECT entries in each vulnerability's `via` array
 * (string entries are chain references to other packages, whose own map
 * entries carry the root advisory objects - the walk visits every entry,
 * so chains resolve without special-casing). The GHSA id is taken from the
 * advisory url tail. Returns null when the document is not a recognizable
 * audit report (the caller fails closed).
 *
 * @param {*} doc parsed `npm audit --json` output
 * @returns {{advisories: Map<string, object>, meta: object} | null}
 */
function extractAdvisories(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const meta = doc.metadata && doc.metadata.vulnerabilities;
  if (!meta || typeof meta !== 'object') return null;
  const vulns = doc.vulnerabilities;
  if (!vulns || typeof vulns !== 'object') return null;
  const advisories = new Map();
  // Gate round 1 (adversarial S2 hardening): every FAILING-severity package
  // entry must be walkable - carrying a non-empty via array whose entries
  // are objects (advisories) or strings (chain references). A future npm
  // format drift that made some high/critical entries unwalkable would
  // otherwise slip past the zero-attribution cross-check whenever at least
  // one OTHER advisory still attributed. Unwalkable = fail closed.
  const unwalkable = [];
  for (const name of Object.keys(vulns)) {
    const entry = vulns[name];
    const entrySeverity = entry && typeof entry.severity === 'string' ? entry.severity.toLowerCase() : '';
    if (!entry || !Array.isArray(entry.via) || entry.via.length === 0 ||
        entry.via.some((v) => !v || (typeof v !== 'object' && typeof v !== 'string'))) {
      if (FAILING_SEVERITIES.has(entrySeverity)) unwalkable.push(name);
      continue;
    }
    for (const via of entry.via) {
      if (!via || typeof via !== 'object') continue; // string = chain reference
      const severity = typeof via.severity === 'string' ? via.severity.toLowerCase() : '';
      if (!FAILING_SEVERITIES.has(severity)) continue;
      const url = typeof via.url === 'string' ? via.url : '';
      const idMatch = /GHSA-[a-z0-9]{4}-[a-z0-9]{4,5}-[a-z0-9]{4,5}$/.exec(url);
      // An unidentifiable high/critical advisory is recorded under a
      // synthetic key so it can NEVER be excepted (fail-closed: you cannot
      // allowlist what you cannot name).
      const id = idMatch ? idMatch[0] : `UNIDENTIFIED:${name}:${via.title || 'unknown'}`;
      if (!advisories.has(id)) {
        advisories.set(id, { id, severity, package: name, title: via.title || '', url });
      }
    }
  }
  return { advisories, meta, unwalkable };
}

/**
 * Validate docs/audit-exceptions.json. Shape:
 *   { "comment": "...", "exceptions": [ { advisory, reason, added, revisit } ] }
 * Malformed anything returns { error } - the CLI fails closed on it (a
 * typo'd exceptions file must never silently allow).
 *
 * @param {*} doc parsed exceptions file
 * @returns {{ids: Set<string>} | {error: string}}
 */
function validateExceptions(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.exceptions)) {
    return { error: 'exceptions file must be an object with an "exceptions" array' };
  }
  const ids = new Set();
  for (const e of doc.exceptions) {
    if (!e || typeof e !== 'object') return { error: 'every exception must be an object' };
    if (typeof e.advisory !== 'string' || !GHSA_PATTERN.test(e.advisory)) {
      return { error: `exception advisory ${JSON.stringify(e.advisory)} is not a GHSA id` };
    }
    if (typeof e.reason !== 'string' || e.reason.trim().length < 15) {
      return { error: `exception ${e.advisory} needs a reason of at least 15 characters (the forcing-net justification convention)` };
    }
    // Gate round 1 (QA S1): the docs promised an added date; enforce it.
    if (typeof e.added !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.added)) {
      return { error: `exception ${e.advisory} needs an added date (YYYY-MM-DD)` };
    }
    if (typeof e.revisit !== 'string' || e.revisit.trim() === '') {
      return { error: `exception ${e.advisory} needs a revisit trigger (the tech-debt-tracker convention)` };
    }
    ids.add(e.advisory);
  }
  return { ids };
}

/**
 * The pure decision: audit document + exceptions document -> verdict.
 *
 * @param {*} auditDoc parsed `npm audit --json`
 * @param {*} exceptionsDoc parsed docs/audit-exceptions.json
 * @returns {{ok: boolean, failClosed?: string, offending?: object[], stale?: string[], excepted?: string[], counts?: object}}
 */
function evaluateAudit(auditDoc, exceptionsDoc) {
  const extracted = extractAdvisories(auditDoc);
  if (!extracted) return { ok: false, failClosed: 'unrecognizable npm audit output' };
  const exceptions = validateExceptions(exceptionsDoc);
  if (exceptions.error) return { ok: false, failClosed: `invalid exceptions file: ${exceptions.error}` };

  const { advisories, meta, unwalkable } = extracted;
  if (unwalkable.length > 0) {
    return { ok: false, failClosed: `high/critical package entr${unwalkable.length === 1 ? 'y' : 'ies'} with an unwalkable via shape (npm format drift?): ${unwalkable.join(', ')}` };
  }
  const failingCount = (Number(meta.high) || 0) + (Number(meta.critical) || 0);
  // Attribution cross-check: metadata claims failing-severity vulns that
  // the walk could not attribute to a single advisory -> fail closed.
  // (Distinct advisories can outnumber metadata's per-PACKAGE counts, so
  // only the zero-attribution direction is checkable.)
  if (failingCount > 0 && advisories.size === 0) {
    return { ok: false, failClosed: `metadata reports ${failingCount} high/critical but no advisory could be attributed` };
  }

  const offending = [];
  const excepted = [];
  for (const adv of advisories.values()) {
    if (exceptions.ids.has(adv.id)) excepted.push(adv.id);
    else offending.push(adv);
  }
  const stale = [...exceptions.ids].filter((id) => !advisories.has(id));
  return { ok: offending.length === 0, offending, stale, excepted, counts: meta };
}

function main() {
  let exceptionsDoc;
  try {
    exceptionsDoc = JSON.parse(fs.readFileSync(EXCEPTIONS_PATH, 'utf8'));
  } catch (err) {
    console.error(`audit-check: FAIL (closed) - could not read/parse ${EXCEPTIONS_PATH}: ${err.message}`);
    process.exit(1);
  }
  // npm audit exits 1 whenever vulnerabilities exist, so the exit code is
  // NOT a failure signal here - the JSON on stdout is the product either
  // way; only an empty/unparseable stdout is a real (fail-closed) error.
  execFile('npm', ['audit', '--json', '--package-lock-only'], { maxBuffer: MAX_AUDIT_BUFFER }, (err, stdout) => {
    let auditDoc;
    try {
      auditDoc = JSON.parse(stdout);
    } catch (_) {
      console.error('audit-check: FAIL (closed) - npm audit produced no parseable JSON.');
      if (err) console.error(String(err.message).slice(0, 2000));
      process.exit(1);
    }
    // npm surfaces registry/network failures as an { error } document.
    if (auditDoc && auditDoc.error) {
      console.error('audit-check: FAIL (closed) - npm audit itself errored:', JSON.stringify(auditDoc.error).slice(0, 2000));
      process.exit(1);
    }
    const verdict = evaluateAudit(auditDoc, exceptionsDoc);
    for (const id of verdict.stale || []) {
      console.warn(`audit-check: WARNING - stale exception ${id} (no longer reported; remove it from docs/audit-exceptions.json)`);
    }
    if (!verdict.ok) {
      if (verdict.failClosed) {
        console.error(`audit-check: FAIL (closed) - ${verdict.failClosed}`);
      } else {
        console.error(`audit-check: FAIL - ${verdict.offending.length} high/critical advisor${verdict.offending.length === 1 ? 'y' : 'ies'} not covered by docs/audit-exceptions.json:`);
        for (const adv of verdict.offending) {
          console.error(`  ${adv.id} [${adv.severity}] ${adv.package}: ${adv.title} ${adv.url}`);
        }
        console.error('Fix with `npm audit fix` (preferred), or add a reviewed exception with a reason + revisit trigger.');
      }
      process.exit(1);
    }
    const c = verdict.counts;
    console.log(`audit-check: OK - high:${c.high} critical:${c.critical} (low:${c.low} moderate:${c.moderate} info:${c.info}); excepted:${verdict.excepted.length}; stale:${verdict.stale.length}`);
  });
}

if (require.main === module) main();

module.exports = { evaluateAudit, extractAdvisories, validateExceptions };
