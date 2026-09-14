'use strict';

// [UNIT] v1.135 - the DIAGRAMS.md census, checker-first (the v1.129 docs-truth
// discipline applied to diagrams, which rot FASTER than prose because nobody
// re-reads a picture). Three bindings, all LIVE-DERIVED - never hand-counted:
//   1. every repo path the document names exists on disk;
//   2. every CREATE TABLE name appears in the document - a rename/addition
//      reds this file until the diagram is updated (until Wave 7 the two
//      doc-model namespace lists were parsed and bound here too; v33 dropped
//      the document tables and the lists with them);
//   3. the headline counts the document states (table count, schema version,
//      the document tables' drop version) match the live derivation.
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
  // Gate S4: bare filenames in mermaid node labels sit outside the
  // dir-prefixed regex - bind the ones the diagrams name to their real
  // homes so a rename cannot leave a label stale silently.
  ['crypto.js', 'store.js', 'visibility.js', 'gate.js'].forEach((f) => found.add('lib/auth/' + f));
  ['main.js', 'watch.js', 'music.js', 'podcasts.js', 'books.js', 'read.js',
    'history.js', 'stats.js', 'setup.js', 'common.js', 'player.js'].forEach((f) => found.add('public/js/' + f));
  assert.ok(found.size > 15, `sanity: the doc names real paths (found ${found.size})`);
  const missing = [...found].filter((p) => !fs.existsSync(path.join(ROOT, p)));
  assert.deepStrictEqual(missing, [],
    'DIAGRAMS.md names repo paths that do not exist (renamed/deleted?) - update the diagram:\n  ' + missing.join('\n  '));
});

// ---- live derivation from the schema source --------------------------------

// ONE comment-stripped view of the source for every derivation (gate S2:
// the first draft stripped // for the lists but both comment kinds only for
// the table sweep - a future block comment with an apostrophe inside a list
// would have derailed the quote matcher; comment-porous CHECKERS are a
// thing, not just comment-porous locks - prose like "the CREATE TABLE
// above" bit the table sweep's first draft too).
const SQLITE_CODE = SQLITE_SRC.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

// Wave 7: the document tables are created by the v1 block and DROPPED by a
// later block; the drop's version is the one number the diagram states about
// them, derived from the block that contains the DROP statements.
const docDropVersion = (() => {
  const m = /if \(current < (\d+)\) \{(?:(?!if \(current <)[\s\S])*?DROP TABLE IF EXISTS doc_kv/.exec(SQLITE_CODE);
  assert.ok(m, 'expected the block that drops doc_kv in lib/db/sqlite.js');
  assert.ok(/DROP TABLE IF EXISTS doc_single/.test(SQLITE_CODE), 'and doc_single is dropped too');
  assert.ok(!/const DOC_KV_NAMESPACES|const SINGLETON_NAMES/.test(SQLITE_CODE), 'the doc-model lists are gone from the source');
  return Number(m[1]);
})();
const tables = [...SQLITE_CODE.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/g)].map((m) => m[1]);
const relationalTables = [...new Set(tables)].filter((t) => t !== 'doc_kv' && t !== 'doc_single');
const schemaVersion = (() => {
  const m = /const SCHEMA_VERSION = (\d+);/.exec(SQLITE_SRC);
  assert.ok(m, 'expected SCHEMA_VERSION in lib/db/sqlite.js');
  return Number(m[1]);
})();

// ---- 2. every namespace + table appears in the data-model section ----------

test('every relational table appears in the DATA-MODEL section, boundary-delimited', () => {
  // The relational-migration arc drained doc_kv one namespace per wave (13 at
  // v1.290 -> 0 at Wave 6, tables dropped in Wave 7) while the relational
  // roster grew, so the sanity floor is the roster: a live derivation always sees the names it saw
  // at v1.290 (13 + 18 + 30 = 61), just partitioned differently.
  assert.ok(relationalTables.length >= 61,
    `sanity: live derivation looks real (${relationalTables.length} relational tables)`);
  // Gate W3 (measured porosity): whole-doc String.includes let 11 of 53
  // names be dropped from diagram 2 and stay green - `progress` matched
  // inside `books.progress`, `user_queue` inside `user_queue_state`, bare
  // words matched prose in other sections. Two fixes: scope the search to
  // the data-model SECTION, and require the name delimited by
  // non-name-characters on both sides.
  const sectionStart = DOC.indexOf('## 2. Data model');
  const sectionEnd = DOC.indexOf('## 3.');
  assert.ok(sectionStart !== -1 && sectionEnd > sectionStart, 'the data-model section exists');
  // Scope to the section's MERMAID BLOCKS, not its prose - the ownership
  // prose below diagram 2 mentions several names, so a name dropped from a
  // DIAGRAM box could otherwise stay green via prose (the M8 survivor).
  const section = (DOC.slice(sectionStart, sectionEnd).match(/```mermaid[\s\S]*?```/g) || []).join('\n');
  assert.ok(section.length > 500, 'the data-model section carries its mermaid blocks');
  const appears = (name) => {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^A-Za-z0-9_.])${esc}(?![A-Za-z0-9_.])`).test(section);
  };
  // KNOWN single survivor (gate delta, mutant-proven, shipped disclosed):
  // dropping the `notifications` TABLE from the NOTIF box's list stays green
  // because the box HEADER "notifications + push" boundary-matches in the
  // same block. 1 of 53; both source-side vectors (add/rename) still red;
  // closing it means structurally parsing the ·-separated lists - not worth
  // it. Do not over-trust "boundary-delimited" past this named residual.
  const missing = relationalTables.filter((n) => !appears(n));
  assert.deepStrictEqual(missing, [],
    'persisted names missing from diagram 2 (new namespace/table? renamed?) - update the data-model section:\n  ' + missing.join('\n  '));
});

// ---- 3. the stated headline counts match the live derivation ---------------

test('the headline counts DIAGRAMS.md states are the live-derived truth', () => {
  assert.ok(DOC.includes(`no document tables (\`doc_kv\` and \`doc_single\` were dropped in schema v${docDropVersion})`),
    `the doc must state that the document tables were dropped in schema v${docDropVersion} (live-derived)`);
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
