#!/usr/bin/env node
'use strict';

// v1.42: pre-upgrade DRY-RUN of the db.json -> SQLite migration (owner
// request, 2026-07-17: "I'm planning on continuing to use my existing
// database... there should be at least a script for a one-time database
// migration").
//
// The REAL migration is automatic: the first v1.42 boot imports db.json into
// DATA_DIR/filetube.db and never modifies db.json (old tags keep working
// against it forever — the parallel-run contract). This script exists for
// peace of mind BEFORE that first boot: it runs the exact same import code
// (lib/db/sqlite.js's importDbJson — one code path, no drift; the v1.41.7
// preview/executor lesson) against a THROWAWAY temp directory, then verifies
// round-trip fidelity and prints per-namespace row counts. Your db.json is
// opened read-only and is byte-for-byte untouched — verified by hash.
//
// Usage:
//   node scripts/migrate-check.js [/path/to/db.json]
// (defaults to $DATA_DIR/db.json, falling back to ./db.json)
//
// Exit code 0 = the migration will succeed with full fidelity.
// Exit code 1 = a problem was found; NOTHING was migrated; fix and re-run.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { importDbJson, readPersistedDatabase, SQLITE_FILENAME, DOC_KV_NAMESPACES } = require('../lib/db/sqlite');

function fail(msg) {
  console.error(`\nMIGRATION CHECK FAILED: ${msg}`);
  console.error('Nothing was migrated; your db.json has not been touched.');
  process.exit(1);
}

const argPath = process.argv[2];
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : process.cwd();
const jsonPath = argPath ? path.resolve(argPath) : path.join(dataDir, 'db.json');

if (!fs.existsSync(jsonPath)) fail(`no db.json found at ${jsonPath} (pass the path explicitly: node scripts/migrate-check.js /path/to/db.json)`);

const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hashBefore = hash(jsonPath);
const sizeKb = (fs.statSync(jsonPath).size / 1024).toFixed(1);
console.log(`Checking ${jsonPath} (${sizeKb} KB) against the v1.42 import (dry run, throwaway output)...`);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-migrate-check-'));
let summary;
try {
  try {
    summary = importDbJson(jsonPath, path.join(tmpDir, SQLITE_FILENAME), { log: () => {} });
  } catch (err) {
    fail(err.message);
  }

  // Fidelity: deep-equal modulo the two DOCUMENTED transforms (exec plan
  // AC1): (1) metadata items lose their embedded viewCount, which moves to
  // the viewCounts namespace; (2) empty per-key namespaces have zero rows
  // and assemble as absent.
  const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const expected = JSON.parse(JSON.stringify(parsed)); // deep copy
  const expectedViewCounts = {};
  if (expected.metadata && typeof expected.metadata === 'object') {
    for (const id of Object.keys(expected.metadata)) {
      const item = expected.metadata[id];
      if (item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'viewCount')) {
        const vc = item.viewCount;
        if (typeof vc === 'number' && Number.isFinite(vc) && vc > 0) expectedViewCounts[id] = vc;
        delete item.viewCount;
      }
    }
  }
  if (Object.keys(expectedViewCounts).length > 0) expected.viewCounts = expectedViewCounts;
  const dropEmpty = (obj, key) => {
    if (obj && obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key]) && Object.keys(obj[key]).length === 0) delete obj[key];
  };
  for (const ns of DOC_KV_NAMESPACES) {
    const parts = ns.split('.');
    if (parts.length === 1) dropEmpty(expected, parts[0]);
    else if (expected[parts[0]]) dropEmpty(expected[parts[0]], parts[1]);
  }

  const assembled = readPersistedDatabase(tmpDir);
  const a = JSON.stringify(sortKeysDeep(assembled));
  const e = JSON.stringify(sortKeysDeep(expected));
  if (a !== e) {
    // Point at the first differing top-level key to make the report useful.
    const keys = new Set([...Object.keys(assembled), ...Object.keys(expected)]);
    for (const k of keys) {
      if (JSON.stringify(sortKeysDeep(assembled[k])) !== JSON.stringify(sortKeysDeep(expected[k]))) {
        fail(`round-trip fidelity mismatch in namespace '${k}' — do NOT upgrade; report this output`);
      }
    }
    fail('round-trip fidelity mismatch — do NOT upgrade; report this output');
  }

  if (hash(jsonPath) !== hashBefore) fail('db.json changed during the check — this must never happen; report it');

  console.log('\nImport summary (rows per namespace):');
  for (const [ns, count] of Object.entries(summary)) console.log(`  ${ns}: ${count}`);
  console.log('\nRound-trip fidelity: OK (deep-equal modulo the documented viewCounts extraction)');
  console.log('db.json untouched: OK (sha256 verified)');
  console.log('\nMIGRATION CHECK PASSED. The first v1.42 boot will import this database');
  console.log('automatically; db.json stays as-is for any old-tag instance.');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeysDeep(value[k]);
    return out;
  }
  return value;
}
