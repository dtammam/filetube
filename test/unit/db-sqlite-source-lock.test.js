'use strict';

// [UNIT] v1.42 T1 — node:sqlite source lock.
//
// `node:sqlite` is EXPERIMENTAL on both project Node versions; the exec plan
// (v1.42-multiuser-tranche.md, locked intake #1) accepts it ONLY with the
// mitigation that every API touch lives in ONE adapter module, so an API
// change across Node majors is a one-file fix. This lock enforces that
// mitigation structurally: any `node:sqlite` reference outside
// lib/db/sqlite.js (or a bare 'sqlite'/'sqlite3'/'better-sqlite3' require
// anywhere) fails the suite and forces the conversation.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const ALLOWED = path.join('lib', 'db', 'sqlite.js');

// Server-side source roots. Deliberately excludes test/ (tests may use the
// adapter's own exports but a test requiring node:sqlite directly would
// bypass the one-module rule too — so tests ARE included) and public/
// (client code can't require node builtins anyway, but scanning it is
// cheap and keeps the rule simple).
const SCAN_ROOTS = ['server.js', 'lib', 'scripts', 'test'];

function walk(entry, out) {
  const full = path.join(ROOT, entry);
  const stat = fs.statSync(full);
  if (stat.isFile()) {
    if (entry.endsWith('.js')) out.push(entry);
    return;
  }
  for (const child of fs.readdirSync(full)) {
    if (child === 'node_modules' || child.startsWith('.')) continue;
    walk(path.join(entry, child), out);
  }
}

test('node:sqlite is required ONLY by lib/db/sqlite.js', () => {
  const files = [];
  for (const root of SCAN_ROOTS) walk(root, files);
  assert.ok(files.length > 200, `sanity: expected to scan a real tree, got ${files.length} files`);

  const offenders = [];
  for (const rel of files) {
    if (rel === ALLOWED) continue;
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // Match require/import of the builtin. Comments mentioning the string
    // in prose are fine; a require() is not.
    if (/require\(\s*['"]node:sqlite['"]\s*\)/.test(src) || /from\s+['"]node:sqlite['"]/.test(src)) {
      offenders.push(rel);
    }
  }
  assert.deepStrictEqual(offenders, [],
    `node:sqlite required outside the adapter: ${offenders.join(', ')} — all SQLite API touches belong in lib/db/sqlite.js (exec plan locked intake #1)`);
});

test('no third-party sqlite driver is required anywhere', () => {
  const files = [];
  for (const root of SCAN_ROOTS) walk(root, files);
  const offenders = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (/require\(\s*['"](?:better-sqlite3|sqlite3?|knex|sequelize)['"]\s*\)/.test(src)) {
      offenders.push(rel);
    }
  }
  assert.deepStrictEqual(offenders, [],
    `third-party DB driver required: ${offenders.join(', ')} — the documented fallback (better-sqlite3) is a deliberate flip, not a drive-by (exec plan locked intake #1)`);
});
