#!/usr/bin/env node
'use strict';
/*
 * precommit-related-tests - choose the unit tests a commit must run before it lands.
 *
 *     node scripts/precommit-related-tests.js
 *
 * Run from the root of the tree being committed (the hook's $PWD, which may be a
 * worktree). Reads the STAGED paths from git (renames split into old and new path).
 * Exit codes: 0 - a related set was chosen: stdout is the unit test files, one per
 * line (possibly none: a commit that only touches non-unit tests); stderr says what
 * was chosen and why / 3 - FALL BACK to the whole unit suite: stderr names the reason.
 * The hook also treats any other exit (a crash) as a fallback: a broken selector must
 * fail toward MORE testing, never less.
 *
 * Why (ci slim, Dean 2026-10-11): every commit ran all ~9.2k unit tests (~6 minutes on
 * a quiet box) to guard a one-file change. pre-push still runs the FULL suite plus the
 * geometry census, so nothing reaches GitHub untested; this hook only has to be a fast,
 * honest first net.
 *
 * Mapping, per staged path:
 *   - a staged unit test runs itself; a staged test under another test/ dir runs the
 *     unit tests that name it (usually none: pre-push runs those suites);
 *   - a Markdown / docs path adds the docs-reading unit tests (the docs censuses);
 *   - any other file X selects every test/unit/*.test.js whose text names X: its repo
 *     path (with or without the extension), its basename, or `/name` + a quote;
 *   - FALLBACK to the whole unit suite when X is named by no unit test, when anything
 *     staged is under test/helpers/, hooks/, scripts/ or is package*.json, or when more than MAX_SOURCE_FILES non-test files are staged.
 */
const fs = require('fs');
const path = require('path');
const { DOCS_MD, docsReadingTests, stagedPaths } = require('./precommit-docs-fast-path');

const MAX_SOURCE_FILES = 40;
const EXIT_FALLBACK = 3;

// Shared machinery: a change here can move any test, so no name mapping is trusted.
const SHARED = /^(test\/helpers\/|hooks\/|scripts\/|package(-lock)?\.json$)/;
const UNIT_TEST = /^test\/unit\/[^/]+\.test\.js$/;
const ANY_TEST = /^test\//;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The spellings under which a unit test can name the file at `rel`.
function referencePatterns(rel) {
  const ext = path.extname(rel);
  const base = path.basename(rel);
  const stem = path.basename(rel, ext);
  const noExt = ext ? rel.slice(0, -ext.length) : rel;
  const pats = [escapeRe(rel), escapeRe(base)];
  // `require('../../lib/foo')` / `'/foo'` in a path.join: the extensionless forms.
  if (ext) pats.push(escapeRe(noExt) + '[\'"`]', '/' + escapeRe(stem) + '[\'"`]');
  return new RegExp(pats.join('|'));
}

function unitTestFiles(root) {
  const dir = path.join(root, 'test', 'unit');
  return fs.readdirSync(dir).filter((n) => n.endsWith('.test.js')).sort().map((n) => path.join('test', 'unit', n));
}

function select(paths, root, read = (f) => fs.readFileSync(f, 'utf8'), listUnit = unitTestFiles) {
  const staged = [...new Set(paths.filter(Boolean))];
  const reasons = [];
  const fallback = (why) => ({ fallback: true, reason: why, tests: [], reasons });
  if (staged.length === 0) return { fallback: false, tests: [], reasons: ['nothing staged'] };

  const shared = staged.find((p) => SHARED.test(p));
  if (shared) return fallback(`${shared} is shared machinery (test helper / hook / script / package manifest)`);

  const chosen = new Map(); // test file -> why
  const own = staged.filter((p) => UNIT_TEST.test(p) && fs.existsSync(path.join(root, p)));
  for (const t of own) chosen.set(t, 'staged itself');

  const sources = staged.filter((p) => !UNIT_TEST.test(p));
  const docs = sources.filter((p) => DOCS_MD.test(p));
  const code = sources.filter((p) => !DOCS_MD.test(p));
  const nonUnitTests = code.filter((p) => ANY_TEST.test(p));
  const realSources = code.filter((p) => !ANY_TEST.test(p));

  if (realSources.length > MAX_SOURCE_FILES) return fallback(`${realSources.length} source files staged (more than ${MAX_SOURCE_FILES})`);

  if (docs.length > 0) {
    for (const t of docsReadingTests(root, read)) if (!chosen.has(t)) chosen.set(t, 'reads docs/ (a docs path is staged)');
  }

  const unit = listUnit(root);
  const texts = new Map();
  const textOf = (rel) => {
    if (!texts.has(rel)) {
      try { texts.set(rel, read(path.join(root, rel))); } catch { texts.set(rel, ''); }
    }
    return texts.get(rel);
  };

  for (const p of nonUnitTests) {
    const re = referencePatterns(p);
    for (const t of unit) if (re.test(textOf(t)) && !chosen.has(t)) chosen.set(t, `names ${p}`);
  }
  for (const p of realSources) {
    const re = referencePatterns(p);
    let found = 0;
    for (const t of unit) {
      if (!re.test(textOf(t))) continue;
      found += 1;
      if (!chosen.has(t)) chosen.set(t, `names ${p}`);
    }
    if (found === 0) return fallback(`no unit test names ${p}`);
  }

  for (const [t, why] of chosen) reasons.push(`${t}: ${why}`);
  return { fallback: false, tests: [...chosen.keys()], reasons };
}

function main() {
  const root = process.cwd();
  const out = select(stagedPaths(root), root);
  if (out.fallback) {
    process.stderr.write(`→ related-tests: whole unit suite (${out.reason})\n`);
    return EXIT_FALLBACK;
  }
  process.stderr.write(`→ related-tests: ${out.tests.length} unit test file(s)\n`);
  for (const r of out.reasons) process.stderr.write(`    ${r}\n`);
  if (out.tests.length) process.stdout.write(out.tests.join('\n') + '\n');
  return 0;
}

module.exports = { select, referencePatterns, MAX_SOURCE_FILES, EXIT_FALLBACK, SHARED };

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (e) {
    process.stderr.write(`→ related-tests: selector failed (${e.message}); whole unit suite\n`);
    process.exitCode = EXIT_FALLBACK;
  }
}
