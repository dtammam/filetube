'use strict';

// [UNIT] v1.135 - the DIAGRAMS.md census, checker-first (the v1.129 docs-truth
// discipline applied to diagrams, which rot FASTER than prose because nobody
// re-reads a picture). Three bindings, all LIVE-DERIVED - never hand-counted:
//   1. every repo path the document names exists on disk;
//   2. every persisted namespace (doc_kv + doc_single, parsed from
//      lib/db/sqlite.js's own LOCK lists) and every CREATE TABLE name appears
//      in the document - a rename/addition reds this file until the diagram
//      is updated;
//   3. the headline counts the document states (namespace/singleton/table
//      counts, schema version) match the live derivation.
// Route counts are deliberately NOT bound (high churn - they are stated as a
// dated "measured at" snapshot in prose, the ARCHITECTURE.md "~140" posture).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const DOC = fs.readFileSync(path.join(ROOT, 'docs', 'DIAGRAMS.md'), 'utf8');
const SQLITE_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'db', 'sqlite.js'), 'utf8');

// ---- 1. every named repo path exists ---------------------------------------

test('every repo path named in DIAGRAMS.md exists on disk', () => {
  // Path-shaped tokens: dir-prefixed files anywhere in the doc (mermaid
  // labels included - they are not backticked), plus the bare root files the
  // doc names. DATA_DIR artifacts (filetube.db, session-secret, ...) are
  // runtime files, not repo paths - the prefix allowlist excludes them.
  const pathRe = /\b(?:lib|public|docs|scripts|test|roku)\/[A-Za-z0-9_./-]*[A-Za-z0-9_-]/g;
  const found = new Set(DOC.match(pathRe) || []);
  found.add('server.js');
  found.add('CLAUDE.md');
  assert.ok(found.size > 15, `sanity: the doc names real paths (found ${found.size})`);
  const missing = [...found].filter((p) => !fs.existsSync(path.join(ROOT, p)));
  assert.deepStrictEqual(missing, [],
    'DIAGRAMS.md names repo paths that do not exist (renamed/deleted?) - update the diagram:\n  ' + missing.join('\n  '));
});

// ---- live derivation from the schema source --------------------------------

function parseList(src, marker) {
  const start = src.indexOf(marker);
  assert.ok(start !== -1, `expected ${marker} in lib/db/sqlite.js`);
  // Strip comments FIRST (the house strip-once-at-read rule - an apostrophe
  // in a block comment otherwise derails the quote matcher; this bit THIS
  // census's own first draft).
  const block = src.slice(start, src.indexOf('];', start))
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const kvNamespaces = parseList(SQLITE_SRC, 'const DOC_KV_NAMESPACES');
const singletonNames = parseList(SQLITE_SRC, 'const SINGLETON_NAMES');
// Comment-stripped for the table sweep too: prose like "the CREATE TABLE
// above" in a comment matched the first draft's regex (comment-porous
// CHECKERS are a thing, not just comment-porous locks).
const SQLITE_CODE = SQLITE_SRC.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const tables = [...SQLITE_CODE.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/g)].map((m) => m[1]);
const relationalTables = [...new Set(tables)].filter((t) => t !== 'doc_kv' && t !== 'doc_single');
const schemaVersion = (() => {
  const m = /const SCHEMA_VERSION = (\d+);/.exec(SQLITE_SRC);
  assert.ok(m, 'expected SCHEMA_VERSION in lib/db/sqlite.js');
  return Number(m[1]);
})();

// ---- 2. every namespace + table appears in the data-model section ----------

test('every doc_kv namespace, doc_single name, and relational table appears in DIAGRAMS.md', () => {
  assert.ok(kvNamespaces.length >= 10 && singletonNames.length >= 10 && relationalTables.length >= 20,
    `sanity: live derivation looks real (${kvNamespaces.length}/${singletonNames.length}/${relationalTables.length})`);
  const missing = [...kvNamespaces, ...singletonNames, ...relationalTables].filter((n) => !DOC.includes(n));
  assert.deepStrictEqual(missing, [],
    'persisted names missing from DIAGRAMS.md (new namespace/table? renamed?) - update diagram 2:\n  ' + missing.join('\n  '));
});

// ---- 3. the stated headline counts match the live derivation ---------------

test('the headline counts DIAGRAMS.md states are the live-derived truth', () => {
  assert.ok(DOC.includes(`${kvNamespaces.length} \`doc_kv\` namespaces`),
    `the doc must state ${kvNamespaces.length} doc_kv namespaces (live-derived)`);
  assert.ok(DOC.includes(`${singletonNames.length} \`doc_single\` names`),
    `the doc must state ${singletonNames.length} doc_single names (live-derived)`);
  assert.ok(DOC.includes(`${relationalTables.length} relational tables`),
    `the doc must state ${relationalTables.length} relational tables (live-derived)`);
  assert.ok(DOC.includes(`schema version ${schemaVersion}`),
    `the doc must state schema version ${schemaVersion} (live-derived)`);
});

// ---- mermaid hygiene --------------------------------------------------------

test('every mermaid fence is balanced (an unclosed fence renders the rest of the doc as code)', () => {
  const fences = DOC.match(/^```/gm) || [];
  assert.strictEqual(fences.length % 2, 0, 'odd number of ``` fences');
  const opens = DOC.match(/^```mermaid$/gm) || [];
  assert.strictEqual(opens.length, 6, `expected the 6 diagrams (5 sections, SPA section has 2); found ${opens.length} mermaid fences`);
});
