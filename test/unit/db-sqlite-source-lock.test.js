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

// Source roots. Includes test/ (a test requiring node:sqlite directly would
// bypass the one-module rule too) AND public/ client source — the latter can't
// require node builtins, but the RAW-control-byte lock below MUST cover it (a
// v1.44.2 gate caught a raw NUL in public/js/music.js that this lock had missed
// because public/ was excluded). Vendored third-party libs (public/vendor/*,
// eslint-ignored, e.g. minified jszip which legitimately carries control bytes)
// are skipped by `walk` — the lock governs OUR source, not shipped minified deps.
const SCAN_ROOTS = ['server.js', 'lib', 'scripts', 'test', 'public'];

// Strip // line-comments and block-comments so a comment MENTIONING a
// require (e.g. "does NOT require('node:sqlite')") can't trip the match —
// the lock cares about real requires, not prose. Crude but sufficient: it
// over-strips string literals that look like comments, which only ever
// makes the lock MORE permissive on strings (never a false positive), and
// no real require lives inside a string.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // avoid eating the '//' in 'http://'
}

function walk(entry, out) {
  const full = path.join(ROOT, entry);
  const stat = fs.statSync(full);
  if (stat.isFile()) {
    if (entry.endsWith('.js')) out.push(entry);
    return;
  }
  for (const child of fs.readdirSync(full)) {
    // Skip node_modules, dotfiles, and vendored third-party libs (public/vendor/*
    // — eslint-ignored; minified deps legitimately carry control bytes and are
    // not OUR source for any of these locks).
    if (child === 'node_modules' || child === 'vendor' || child.startsWith('.')) continue;
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
    // Match require/import of the builtin, comments stripped first so a
    // comment mentioning the string in prose is fine (this test's own
    // stated contract, now actually enforced).
    const src = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    if (/require\(\s*['"]node:sqlite['"]\s*\)/.test(src) || /from\s+['"]node:sqlite['"]/.test(src)) {
      offenders.push(rel);
    }
  }
  assert.deepStrictEqual(offenders, [],
    `node:sqlite required outside the adapter: ${offenders.join(', ')} — all SQLite API touches belong in lib/db/sqlite.js (exec plan locked intake #1)`);
});

test('no RAW control bytes in server-side source (the v1.37.5 lesson, institutionalized)', () => {
  // Raw control bytes (NUL etc.) in source render INVISIBLY in editors and
  // diffs, trip binary sniffers (ugrep silently skipped lib/db/sqlite.js
  // while it carried raw U+0000 separators — empty grep looked like "no
  // matches"), and copy-paste as landmines. Control characters belong in
  // source only as ESCAPE SEQUENCES ('\\u0000'). Tab and newline are the
  // only raw control bytes allowed.
  const files = [];
  for (const root of SCAN_ROOTS) walk(root, files);
  const offenders = [];
  for (const rel of files) {
    const buf = fs.readFileSync(path.join(ROOT, rel));
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) {
        offenders.push(`${rel} (byte 0x${b.toString(16)} at offset ${i})`);
        break;
      }
    }
  }
  assert.deepStrictEqual(offenders, [],
    `raw control bytes in source: ${offenders.join(', ')} — write them as escape sequences instead`);
});

test('no third-party sqlite driver is required anywhere', () => {
  const files = [];
  for (const root of SCAN_ROOTS) walk(root, files);
  const offenders = [];
  for (const rel of files) {
    const src = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    if (/require\(\s*['"](?:better-sqlite3|sqlite3?|knex|sequelize)['"]\s*\)/.test(src)) {
      offenders.push(rel);
    }
  }
  assert.deepStrictEqual(offenders, [],
    `third-party DB driver required: ${offenders.join(', ')} — the documented fallback (better-sqlite3) is a deliberate flip, not a drive-by (exec plan locked intake #1)`);
});
