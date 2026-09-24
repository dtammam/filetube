#!/usr/bin/env node
'use strict';
/*
 * precommit-docs-fast-path - decide whether a commit may take the pre-commit
 * hook's DOCS-ONLY fast path, and if so which unit tests it must still run.
 *
 *     node scripts/precommit-docs-fast-path.js
 *
 * Run from the root of the tree being committed (the hook's $PWD, which may be
 * a worktree). Reads the STAGED paths from git (renames split into their old
 * and new path, so a move out of or into docs/ is seen on both sides).
 * Exit codes: 0 docs-only - prints the docs-reading unit test files, one per
 * line / 1 not docs-only (or nothing staged) - the hook runs its full checks /
 * 2 docs-only but no docs-reading test was found - the hook runs its full
 * checks (a broken selector must fail toward MORE testing, never less).
 *
 * Why (Dean, 2026-09-24): every commit ran the whole unit suite (~7000 tests,
 * 10-15 minutes with several builders on the box), including the many commits
 * that only touch a plan doc (gate verdicts, fix records, close-outs). A
 * commit whose every staged path is Markdown under docs/ cannot change code,
 * so it runs only the unit tests that READ docs/ (the docs-link, docs-status,
 * exec-plans and tech-debt censuses and their kin). The selection is DYNAMIC
 * (grep of test/unit each run, never a hardcoded list) so a new docs-reading
 * test joins on its own. pre-push still runs the full suite.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DOCS_MD = /^docs\/.+\.md$/;
// A test reads docs/ when its source names the directory as a path
// ("docs/..."), as a path segment ('docs' in a path.join), or names the
// exec-plans tree. Over-inclusion is safe (a comment mention only costs time).
const READS_DOCS = /docs\/|['"`]docs['"`]|exec-plans/;

function isDocsOnly(paths) {
  const list = paths.filter(Boolean);
  return list.length > 0 && list.every((p) => DOCS_MD.test(p));
}

function docsReadingTests(root, read = (f) => fs.readFileSync(f, 'utf8')) {
  const dir = path.join(root, 'test', 'unit');
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter((n) => n.endsWith('.test.js'))
    .sort()
    .map((n) => path.join('test', 'unit', n))
    .filter((rel) => READS_DOCS.test(read(path.join(root, rel))));
}

function stagedPaths(cwd) {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--no-renames', '-z'], { cwd, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

function main() {
  const root = process.cwd();
  if (!isDocsOnly(stagedPaths(root))) return 1;
  const tests = docsReadingTests(root);
  if (tests.length === 0) return 2;
  process.stdout.write(tests.join('\n') + '\n');
  return 0;
}

module.exports = { isDocsOnly, docsReadingTests, stagedPaths, DOCS_MD, READS_DOCS };

if (require.main === module) process.exitCode = main();
